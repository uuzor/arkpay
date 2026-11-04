import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { parseGmailMessage, type ParsedEmail } from './email-parser';
import type { GmailTokenSource } from './gmail-auth.service';
import {
  GmailApiError,
  GmailClientService,
  type GmailHistoryResponse,
} from './gmail-client.service';

export interface SyncResult {
  mode: 'full' | 'history';
  mailbox: string;
  fetched: number;
  inserted: number;
  checkpoint: string;
  skipped?: boolean;
}

/**
 * One mailbox to sync: the workspace's stored Gmail connection. Supplied by
 * the per-workspace poller and the manual run endpoint; required.
 */
export interface SyncConnection {
  workspaceId: string;
  refreshToken: string;
  gmailAddress?: string | null;
}

/**
 * Gmail → Postgres ingest.
 *
 * First run does a bounded full sync and anchors the cursor at the historyId
 * observed BEFORE listing, so messages that arrive during the sync are picked
 * up by the next history poll (the unique gmailId makes that overlap harmless).
 * Every later run walks `history.list` from the stored cursor. Inserts and the
 * cursor advance share one transaction.
 */
@Injectable()
export class GmailIngestService {
  private readonly logger = new Logger(GmailIngestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: GmailClientService,
  ) {}

  private get fullSyncMax(): number {
    const raw = Number(
      this.config.get<string>('GMAIL_FULL_SYNC_MAX') ?? 50,
    );
    return Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 500) : 50;
  }

  /**
   * Upper bound on new messages fetched per history tick. A long server
   * pause can leave a large backlog; capping keeps us inside Gmail's per-user
   * quota and the cursor advances only past records we actually processed.
   */
  private get historyMax(): number {
    const raw = Number(this.config.get<string>('GMAIL_HISTORY_MAX') ?? 40);
    return Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 40;
  }

  async syncOnce(connection: SyncConnection): Promise<SyncResult> {
    const source: GmailTokenSource = {
      refreshToken: connection.refreshToken,
      cacheKey: connection.workspaceId,
    };
    if (this.running) {
      return {
        mode: 'history',
        mailbox: connection.gmailAddress ?? '',
        fetched: 0,
        inserted: 0,
        checkpoint: '',
        skipped: true,
      };
    }
    this.running = true;
    try {
      // Read the cursor baseline before listing so nothing slips through the
      // gap between the full sync and the first history poll.
      const profile = await this.client.getProfile(source);
      const mailbox = connection.gmailAddress || profile.emailAddress;
      const checkpoint = await this.prisma.gmailCheckpoint.findUnique({
        where: { mailbox },
      });
      // The connection owns its tenant outright.
      const workspaceId = connection.workspaceId;

      if (!checkpoint) {
        return await this.fullSync(
          mailbox,
          profile.historyId,
          workspaceId,
          source,
        );
      }

      try {
        return await this.historySync(
          mailbox,
          checkpoint.historyId,
          workspaceId,
          source,
        );
      } catch (e) {
        if (e instanceof GmailApiError && (e.status === 404 || e.status === 410)) {
          this.logger.warn(
            `Gmail history cursor expired for ${mailbox}; falling back to full sync`,
          );
          return await this.fullSync(
            mailbox,
            profile.historyId,
            workspaceId,
            source,
          );
        }
        throw e;
      }
    } finally {
      this.running = false;
    }
  }

  async status(workspaceId: string) {
    const connection = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { gmailAddress: true },
    });
    const mailbox = connection?.gmailAddress ?? null;
    const tenant = { workspaceId };
    const [checkpoint, emailCount, newest] = await Promise.all([
      mailbox
        ? this.prisma.gmailCheckpoint.findUnique({ where: { mailbox } })
        : Promise.resolve(null),
      this.prisma.email.count({ where: tenant }),
      this.prisma.email.findFirst({
        where: tenant,
        orderBy: { receivedAt: 'desc' },
        select: {
          gmailId: true,
          from: true,
          subject: true,
          status: true,
          receivedAt: true,
        },
      }),
    ]);
    return { mailbox, checkpoint, emailCount, newest };
  }

  private async fullSync(
    mailbox: string,
    baselineHistoryId: string,
    workspaceId: string,
    source: GmailTokenSource,
  ): Promise<SyncResult> {
    const listing = await this.client.listInboxMessageIds(
      this.fullSyncMax,
      source,
    );
    const ids = (listing.messages ?? []).map((m) => m.id);
    const rows = await this.fetchNew(ids, source);
    const inserted = await this.persist(
      rows,
      mailbox,
      baselineHistoryId,
      workspaceId,
    );
    this.logger.log(
      `Full sync for ${mailbox}: ${ids.length} listed, ${inserted} new, cursor ${baselineHistoryId}`,
    );
    return {
      mode: 'full',
      mailbox,
      fetched: ids.length,
      inserted,
      checkpoint: baselineHistoryId,
    };
  }

  private async historySync(
    mailbox: string,
    startHistoryId: string,
    workspaceId: string,
    source: GmailTokenSource,
  ): Promise<SyncResult> {
    const { ids, historyId, truncated } = await this.collectHistory(
      startHistoryId,
      this.historyMax,
      source,
    );
    const rows = await this.fetchNew(ids, source);
    const inserted = await this.persist(rows, mailbox, historyId, workspaceId);
    this.logger.log(
      `History sync for ${mailbox}: ${ids.length} added, ${inserted} new, cursor ${historyId}${truncated ? ' (capped; continuing next tick)' : ''}`,
    );
    return {
      mode: 'history',
      mailbox,
      fetched: ids.length,
      inserted,
      checkpoint: historyId,
    };
  }

  /**
   * Walks history pages until the next record would exceed `maxMessages`.
   * When capped, the returned cursor is the last FULLY processed history
   * record id, so the next tick resumes exactly there — no skipped mail.
   */
  private async collectHistory(
    startHistoryId: string,
    maxMessages: number,
    source: GmailTokenSource,
  ): Promise<{ ids: string[]; historyId: string; truncated: boolean }> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latest = startHistoryId;
    let cursor = startHistoryId;
    let truncated = false;

    do {
      const page: GmailHistoryResponse = await this.client.listHistory(
        startHistoryId,
        source,
        pageToken,
      );
      for (const record of page.history ?? []) {
        const recordIds: string[] = [];
        for (const added of record.messagesAdded ?? []) {
          const message = added.message;
          if (!message?.id) continue;
          // Only ingest mail landing in the inbox; ignore label churn elsewhere.
          if (message.labelIds && !message.labelIds.includes('INBOX')) continue;
          if (!ids.has(message.id)) recordIds.push(message.id);
        }
        // Always finish a single record; only stop BETWEEN records.
        if (ids.size > 0 && ids.size + recordIds.length > maxMessages) {
          truncated = true;
          break;
        }
        for (const id of recordIds) ids.add(id);
        if (record.id) cursor = record.id;
      }
      if (truncated) break;
      if (page.historyId) latest = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);

    return {
      ids: [...ids],
      historyId: truncated ? cursor : latest,
      truncated,
    };
  }

  /** Skip ids already stored, then fetch the rest in small parallel batches. */
  private async fetchNew(
    ids: string[],
    source: GmailTokenSource,
  ): Promise<ParsedEmail[]> {
    if (ids.length === 0) return [];
    const existing = await this.prisma.email.findMany({
      where: { gmailId: { in: ids } },
      select: { gmailId: true },
    });
    const seen = new Set(existing.map((e) => e.gmailId));
    const missing = ids.filter((id) => !seen.has(id));

    const rows: ParsedEmail[] = [];
    const transient: Error[] = [];
    for (let i = 0; i < missing.length; i += 5) {
      const chunk = missing.slice(i, i + 5);
      const settled = await Promise.allSettled(
        chunk.map((id) => this.client.getMessage(id, source)),
      );
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          try {
            rows.push(parseGmailMessage(result.value));
          } catch (e) {
            // A structurally broken message would fail identically forever;
            // skip it rather than blocking the cursor for the whole mailbox.
            this.logger.warn(
              `Skipping unparseable Gmail message ${chunk[index]}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          return;
        }
        const reason = result.reason;
        // 404 = the message vanished between list and get; safe to skip.
        if (reason instanceof GmailApiError && reason.status === 404) {
          this.logger.warn(
            `Skipping deleted Gmail message ${chunk[index]}: ${reason.message}`,
          );
          return;
        }
        // Quota/429/5xx/auth: do NOT skip. Throwing leaves the cursor where it
        // was, so the next tick retries; already-stored ids are deduped.
        transient.push(
          reason instanceof Error ? reason : new Error(String(reason)),
        );
      });
    }
    if (transient.length > 0) {
      throw new Error(
        `Gmail fetch failed for ${transient.length} message(s); cursor not advanced. ` +
          `First error: ${transient[0].message}`,
      );
    }
    return rows;
  }

  /** Inserts and the checkpoint advance commit together, or not at all. */
  private persist(
    rows: ParsedEmail[],
    mailbox: string,
    historyId: string,
    workspaceId: string,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      let inserted = 0;
      if (rows.length > 0) {
        const result = await tx.email.createMany({
          data: rows.map((row) => ({
            workspaceId,
            gmailId: row.gmailId,
            threadId: row.threadId,
            from: row.from,
            subject: row.subject,
            body: row.body,
            receivedAt: row.receivedAt,
          })),
          skipDuplicates: true,
        });
        inserted = result.count;
      }
      await tx.gmailCheckpoint.upsert({
        where: { mailbox },
        create: { mailbox, workspaceId, historyId },
        update: { historyId, lastSyncAt: new Date() },
      });
      return inserted;
    });
  }
}
