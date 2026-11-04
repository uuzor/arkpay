import { Injectable, Logger } from '@nestjs/common';
import { ContactKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseSender, type ParsedSender } from './sender';

export interface FindOrCreateContactInput {
  name: string;
  paypalEmail?: string | null;
  kind?: ContactKind;
}

/**
 * Contacts book: match-or-create on PayPal email, then name+kind, all scoped
 * to one workspace so tenants never see each other's people. Every method
 * takes the tenant explicitly — the 10a threading pattern the other services
 * copy in 10b.
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private normalizeEmail(email?: string | null): string | undefined {
    const value = email?.trim().toLowerCase();
    return value || undefined;
  }

  async findOrCreate(input: FindOrCreateContactInput, workspaceId: string) {
    const name = this.normalizeName(input.name);
    if (!name) throw new Error('contact name is required');
    if (!workspaceId) throw new Error('workspaceId is required');
    const kind = input.kind ?? ContactKind.CLIENT;
    const paypalEmail = this.normalizeEmail(input.paypalEmail);

    if (paypalEmail) {
      const byEmail = await this.prisma.contact.findFirst({
        where: {
          workspaceId,
          paypalEmail: { equals: paypalEmail, mode: 'insensitive' },
        },
      });
      if (byEmail) {
        if (!byEmail.paypalEmail) {
          return this.prisma.contact.update({
            where: { id: byEmail.id },
            data: { paypalEmail },
          });
        }
        return byEmail;
      }
    }

    const existing = await this.prisma.contact.findUnique({
      where: { workspaceId_name_kind: { workspaceId, name, kind } },
    });
    if (existing) {
      if (!existing.paypalEmail && paypalEmail) {
        return this.prisma.contact.update({
          where: { id: existing.id },
          data: { paypalEmail },
        });
      }
      return existing;
    }

    try {
      return await this.prisma.contact.create({
        data: { workspaceId, name, kind, paypalEmail },
      });
    } catch (e) {
      // Two concurrent ingests can race on the unique workspace+name+kind
      // constraint.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const raced = await this.prisma.contact.findUnique({
          where: { workspaceId_name_kind: { workspaceId, name, kind } },
        });
        if (raced) return raced;
      }
      throw e;
    }
  }

  async findOrCreateFromSender(
    from: string | null | undefined,
    kind: ContactKind = ContactKind.CLIENT,
    workspaceId: string,
  ) {
    const sender: ParsedSender = parseSender(from);
    return this.findOrCreate(
      {
        name: sender.name,
        paypalEmail: sender.email || undefined,
        kind,
      },
      workspaceId,
    );
  }

  /**
   * Learn from a completed payment: running average of amounts, increment the
   * counter, and stamp lastPaidAt. Called by execution after money moves.
   * When workspaceId is given, a cross-tenant contact id is refused.
   */
  async recordPayment(
    contactId: string,
    amount: number | string,
    currency = 'USD',
    workspaceId?: string,
  ) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) throw new Error(`contact ${contactId} not found`);
    if (workspaceId && contact.workspaceId !== workspaceId) {
      throw new Error(`contact ${contactId} belongs to another workspace`);
    }

    const paid = Number(amount);
    if (!Number.isFinite(paid) || paid <= 0) {
      throw new Error(`invalid payment amount: ${amount}`);
    }
    const prior = contact.usualAmount ? Number(contact.usualAmount) : null;
    const next =
      prior === null
        ? paid
        : (prior * contact.payCount + paid) / (contact.payCount + 1);

    const updated = await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        usualAmount: next.toFixed(2),
        currency,
        payCount: { increment: 1 },
        lastPaidAt: new Date(),
      },
    });
    this.logger.log(
      `Contact ${updated.name}: usual ${updated.currency} ${updated.usualAmount} after ${updated.payCount} payment(s)`,
    );
    return updated;
  }

  list(workspaceId: string, kind?: ContactKind, limit = 50) {
    if (!workspaceId) throw new Error('workspaceId is required');
    return this.prisma.contact.findMany({
      where: { workspaceId, ...(kind ? { kind } : {}) },
      orderBy: [{ lastPaidAt: 'desc' }, { firstSeenAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async getById(id: string, workspaceId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, workspaceId },
      include: {
        actions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            type: true,
            status: true,
            amount: true,
            currency: true,
            purpose: true,
            createdAt: true,
          },
        },
        _count: { select: { actions: true } },
      },
    });
    if (!contact) throw new Error(`contact ${id} not found`);
    return contact;
  }

  async update(
    id: string,
    input: { name?: string; paypalEmail?: string | null; kind?: ContactKind },
    workspaceId: string,
  ) {
    const owned = await this.prisma.contact.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!owned) throw new Error(`contact ${id} not found`);
    const data: {
      name?: string;
      paypalEmail?: string | null;
      kind?: ContactKind;
    } = {};
    if (input.name !== undefined) {
      const name = this.normalizeName(input.name);
      if (!name) throw new Error('contact name is required');
      data.name = name;
    }
    if (input.paypalEmail !== undefined) {
      data.paypalEmail = this.normalizeEmail(input.paypalEmail) ?? null;
    }
    if (input.kind !== undefined) data.kind = input.kind;
    try {
      return await this.prisma.contact.update({ where: { id }, data });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new Error('a contact with that name and kind already exists');
      }
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new Error(`contact ${id} not found`);
      }
      throw e;
    }
  }
}
