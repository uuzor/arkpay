import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_MS } from './tenant.constants';

export interface RequestSession {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
  workspace: { id: string; name: string; timezone: string; currency: string };
}

/**
 * DB-backed opaque sessions: the cookie holds an unguessable random token,
 * only its sha256 lives in the database, and expiry is enforced on every
 * resolve (expired rows are purged lazily).
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  static parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (header ?? '').split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim();
      if (!key) continue;
      try {
        out[key] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        out[key] = part.slice(eq + 1).trim();
      }
    }
    return out;
  }

  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: SessionService.hashToken(token),
        expiresAt,
      },
    });
    return { token, expiresAt };
  }

  /** Null = anonymous. Sessions without a workspace (deleted data) die here. */
  async resolve(token: string | undefined): Promise<RequestSession | null> {
    if (!token) return null;
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: SessionService.hashToken(token) },
      include: { user: { include: { workspace: true } } },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now() || !row.user.workspace) {
      await this.prisma.session
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      return null;
    }
    return {
      user: {
        id: row.user.id,
        email: row.user.email,
        name: row.user.name,
        avatarUrl: row.user.avatarUrl,
      },
      workspace: {
        id: row.user.workspace.id,
        name: row.user.workspace.name,
        timezone: row.user.workspace.timezone,
        currency: row.user.workspace.currency,
      },
    };
  }

  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({
      where: { tokenHash: SessionService.hashToken(token) },
    });
  }
}
