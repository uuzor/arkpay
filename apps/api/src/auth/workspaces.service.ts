import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { SecretBoxService } from '../common/secret-box.service';
import { PrismaService } from '../prisma/prisma.service';
import { nextRunAfter } from '../scheduler/recurrence';
import { systemSeedDefinitions } from '../scheduler/system-seeds';
import { OWNER_WORKSPACE_ID } from './tenant.constants';

const LINK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * The scopes the app must have for ArkPay's money paths. Payouts appears in
 * two spellings across PayPal's docs and token responses, so accept either.
 */
const PAYPAL_SCOPE_REQUIREMENTS: { label: string; scopes: string[] }[] = [
  {
    label: 'Invoicing',
    scopes: ['https://uri.paypal.com/services/invoicing'],
  },
  {
    label: 'Payouts',
    scopes: [
      'https://uri.paypal.com/payments/payouts',
      'https://uri.paypal.com/services/payments/payouts',
    ],
  },
  {
    label: 'Transaction search',
    scopes: ['https://uri.paypal.com/services/reporting/search/read'],
  },
  {
    label: 'Webhooks',
    scopes: ['https://uri.paypal.com/services/applications/webhooks'],
  },
];

function missingPaypalScopes(granted: string[]): string[] {
  const set = new Set(granted);
  return PAYPAL_SCOPE_REQUIREMENTS.filter(
    (req) => !req.scopes.some((scope) => set.has(scope)),
  ).map((req) => req.label);
}
const LINK_CODE_LEN = 6;

/**
 * Workspace provisioning, connection state, and tenant resolution. HTTP
 * routes resolve via SessionAuthGuard; Telegram resolves via pairing links
 * below — both fail closed with no owner fallback.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secrets: SecretBoxService,
  ) {}

  /**
   * Linked workspace for a Telegram user id, or null when the user never
   * tapped /link <code>. Callers fail closed: no link, no tenant, no data.
   */
  async resolveForTelegram(
    telegramId: string | number,
  ): Promise<string | null> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { telegramId: String(telegramId) },
      select: { workspaceId: true },
    });
    return link?.workspaceId ?? null;
  }

  /**
   * The first signup adopts the legacy owner workspace (sets ownerId);
   * later signups get fresh workspaces with seeded schedules + link code.
   * The adoption UPDATE-WHERE is atomic, so two simultaneous first signups
   * cannot both win — the loser provisions a fresh workspace.
   */
  async provisionForUser(userId: string, email: string): Promise<string> {
    const owned = await this.prisma.workspace.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (owned) return owned.id;
    const adopted = await this.prisma.workspace.updateMany({
      where: { id: OWNER_WORKSPACE_ID, ownerId: null },
      data: { ownerId: userId },
    });
    if (adopted.count === 1) {
      await this.issueLinkCode(OWNER_WORKSPACE_ID);
      return OWNER_WORKSPACE_ID;
    }
    const workspace = await this.prisma.workspace.create({
      data: { ownerId: userId, name: `${email}'s workspace` },
    });
    await this.seedSchedules(workspace.id);
    await this.issueLinkCode(workspace.id);
    return workspace.id;
  }

  async seedSchedules(workspaceId: string): Promise<void> {
    const defs = systemSeedDefinitions({
      payrollCron: this.config.get<string>('PAYROLL_CRON') ?? '0 9 1 * *',
      payrollTimezone: this.config.get<string>('PAYROLL_TIMEZONE') ?? 'UTC',
      payrollEnabled:
        (this.config.get<string>('PAYROLL_ENABLED') ?? 'true') !== 'false',
      followupCron: this.config.get<string>('FOLLOWUP_CRON') ?? '0 */6 * * *',
      followupEnabled:
        (this.config.get<string>('FOLLOWUP_ENABLED') ?? 'false') === 'true',
    });
    for (const def of defs) {
      const nextRunAt = nextRunAfter(
        {
          trigger: def.trigger,
          cron: def.cron,
          timezone: def.timezone,
        },
        new Date(),
      );
      try {
        await this.prisma.schedule.create({
          data: {
            workspaceId,
            title: def.title,
            detail: def.detail,
            kind: def.kind,
            payload: def.payload,
            status: def.status,
            trigger: def.trigger,
            cron: def.cron,
            timezone: def.timezone,
            misfireGraceMinutes: def.misfireGraceMinutes,
            nextRunAt,
            systemKey: def.systemKey,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  async issueLinkCode(
    workspaceId: string,
  ): Promise<{ linkCode: string; linked: boolean }> {
    const existing = await this.prisma.telegramLink.findUnique({
      where: { workspaceId },
    });
    if (existing) {
      return { linkCode: existing.linkCode, linked: !!existing.telegramId };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Array.from(
        { length: LINK_CODE_LEN },
        () => LINK_ALPHABET[randomBytes(1)[0] % LINK_ALPHABET.length],
      ).join('');
      try {
        const created = await this.prisma.telegramLink.create({
          data: { workspaceId, linkCode: `ARKPAY-${suffix}` },
        });
        return { linkCode: created.linkCode, linked: false };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new Error('could not mint a unique Telegram link code');
  }

  async linkTelegram(
    linkCode: string,
    telegramId: string | number,
  ): Promise<{ workspaceId: string }> {
    const code = linkCode.trim().toUpperCase();
    const link = await this.prisma.telegramLink.findUnique({
      where: { linkCode: code },
    });
    if (!link) {
      throw new NotFoundException(
        'unknown link code — check the dashboard for the current one',
      );
    }
    if (link.telegramId && link.telegramId !== String(telegramId)) {
      throw new BadRequestException(
        'that code is already linked to a different Telegram account',
      );
    }
    if (!link.telegramId) {
      const clash = await this.prisma.telegramLink.findUnique({
        where: { telegramId: String(telegramId) },
      });
      if (clash && clash.workspaceId !== link.workspaceId) {
        throw new BadRequestException(
          'this Telegram account is already linked to another workspace',
        );
      }
      await this.prisma.telegramLink.update({
        where: { id: link.id },
        data: { telegramId: String(telegramId), linkedAt: new Date() },
      });
    }
    return { workspaceId: link.workspaceId };
  }

  /** Workspace profile with connection status; secrets are never returned. */
  async profile(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        telegramLink: {
          select: { telegramId: true, linkCode: true, linkedAt: true },
        },
      },
    });
    if (!workspace) throw new NotFoundException('workspace not found');
    const { gmailRefreshToken, paypalClientSecret, ...rest } = workspace;
    return {
      ...rest,
      gmailConnected: !!gmailRefreshToken,
      paypalConnected: !!(workspace.paypalClientId && paypalClientSecret),
      paypalMissingScopes: missingPaypalScopes(workspace.paypalScopes ?? []),
    };
  }

  async updateProfile(
    workspaceId: string,
    input: { name?: string; timezone?: string; currency?: string },
  ) {
    const data: { name?: string; timezone?: string; currency?: string } = {};
    if (input.name !== undefined) {
      const name = input.name.trim().replace(/\s+/g, ' ');
      if (!name) throw new BadRequestException('name is required');
      data.name = name.slice(0, 80);
    }
    if (input.timezone !== undefined) {
      const timezone = input.timezone.trim();
      if (!timezone) throw new BadRequestException('timezone is required');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        throw new BadRequestException(`invalid timezone: ${timezone}`);
      }
      data.timezone = timezone;
    }
    if (input.currency !== undefined) {
      const currency = input.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new BadRequestException(`invalid currency: ${input.currency}`);
      }
      data.currency = currency;
    }
    await this.prisma.workspace.update({ where: { id: workspaceId }, data });
    return this.profile(workspaceId);
  }

  /**
   * Store per-workspace PayPal credentials only after they pass a live
   * client-credentials probe — a typo never bricks the workspace.
   */
  async connectPaypal(
    workspaceId: string,
    input: {
      clientId?: string;
      clientSecret?: string;
      mode?: string;
      webhookId?: string;
    },
  ) {
    const clientId = input.clientId?.trim();
    const clientSecret = input.clientSecret?.trim();
    const mode = (input.mode ?? 'sandbox').trim();
    const webhookId = input.webhookId?.trim() || undefined;
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'PayPal clientId and clientSecret are required',
      );
    }
    if (mode !== 'sandbox' && mode !== 'live') {
      throw new BadRequestException('mode must be sandbox or live');
    }
    const probe = await WorkspacesService.probePaypal(
      clientId,
      clientSecret,
      mode,
    );
    if (!probe.ok) {
      throw new BadRequestException(
        `PayPal credentials rejected: ${probe.error ?? 'unknown error'}`,
      );
    }
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        paypalClientId: clientId,
        // Secrets never sit in plaintext after this point.
        paypalClientSecret: this.secrets.encrypt(clientSecret),
        paypalMode: mode,
        paypalAccountId: probe.accountId ?? null,
        paypalAppId: probe.appId ?? null,
        paypalScopes: probe.scopes ?? [],
        ...(webhookId ? { paypalWebhookId: webhookId } : {}),
      },
    });
    return this.profile(workspaceId);
  }

  /**
   * Decrypted PayPal app credentials for server-side calls. Legacy plaintext
   * rows are upgraded to ciphertext on first read; a missing key fails closed
   * only for encrypted rows, so a rollout can finish the backfill safely.
   */
  async paypalCredentials(workspaceId: string): Promise<{
    clientId: string;
    clientSecret: string;
    mode: 'sandbox' | 'live';
  }> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        paypalClientId: true,
        paypalClientSecret: true,
        paypalMode: true,
      },
    });
    if (!ws?.paypalClientId || !ws?.paypalClientSecret) {
      throw new BadRequestException(
        'PayPal is not connected for this workspace',
      );
    }
    const clientSecret = this.secrets.decrypt(ws.paypalClientSecret);
    if (!this.secrets.isEncrypted(ws.paypalClientSecret)) {
      try {
        await this.prisma.workspace.update({
          where: { id: workspaceId },
          data: { paypalClientSecret: this.secrets.encrypt(clientSecret) },
        });
      } catch {
        // Rolling out the key after the code is safe: plaintext still reads.
      }
    }
    return {
      clientId: ws.paypalClientId,
      clientSecret,
      mode: ws.paypalMode === 'live' ? 'live' : 'sandbox',
    };
  }

  async connectGmail(
    workspaceId: string,
    refreshToken: string,
    address: string,
  ): Promise<void> {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { gmailRefreshToken: refreshToken, gmailAddress: address },
    });
  }

  /**
   * One-shot PayPal client-credentials probe. Local by design: importing
   * PaypalModule here would cycle with the invoices controller, which needs
   * tenant resolution from this module.
   */
  private static async probePaypal(
    clientId: string,
    clientSecret: string,
    mode: string,
  ): Promise<{
    ok: boolean;
    error?: string;
    appId?: string;
    accountId?: string;
    scopes?: string[];
  }> {
    const base =
      mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    try {
      const res = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 140)}` };
      }
      const json = (await res.json()) as {
        access_token?: string;
        app_id?: string;
        scope?: string;
      };
      const scopes = (json.scope ?? '').split(' ').filter(Boolean);
      let accountId: string | undefined;
      if (json.access_token) {
        try {
          // Client-credentials tokens expose an OIDC subject but not the
          // merchant email; the email requires a user-consent token.
          const info = await fetch(
            `${base}/v1/identity/oauth2/userinfo?schema=paypalv1.1`,
            { headers: { Authorization: `Bearer ${json.access_token}` } },
          );
          if (info.ok) {
            const profile = (await info.json()) as {
              sub?: string;
              user_id?: string;
            };
            accountId = profile.sub ?? profile.user_id;
          }
        } catch {
          // Identity lookup is best-effort; the probe already succeeded.
        }
      }
      return { ok: true, appId: json.app_id, accountId, scopes };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
