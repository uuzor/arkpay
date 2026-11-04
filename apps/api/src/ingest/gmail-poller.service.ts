import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import { DecisionService } from '../approvals/decision.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  GmailIngestService,
  type SyncConnection,
} from './gmail-ingest.service';

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;

/**
 * Started explicitly from main.ts (not from module init), so one-shot CLI
 * contexts like the invoice spike never begin polling.
 */
@Injectable()
export class GmailPollerService implements OnModuleDestroy {
  private readonly logger = new Logger(GmailPollerService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ingest: GmailIngestService,
    private readonly pipeline: PipelineService,
    private readonly decision: DecisionService,
    private readonly telegram: TelegramService,
  ) {}

  start(): void {
    if (this.timer) return;
    if ((this.config.get<string>('GMAIL_POLL_ENABLED') ?? 'true') === 'false') {
      this.logger.log('Gmail polling disabled (GMAIL_POLL_ENABLED=false)');
      return;
    }
    const raw = Number(
      this.config.get<string>('GMAIL_POLL_INTERVAL_MS') ?? DEFAULT_INTERVAL_MS,
    );
    const interval =
      Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
    this.logger.log(`Gmail poller starting (every ${Math.round(interval / 1000)}s)`);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), interval);
    // Don't hold the process open just for the poller.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    await this.syncAllMailboxes();
    // Pipeline: turn NEW emails into actions/cards (or terminal statuses).
    try {
      const run = await this.pipeline.processNewEmails(5);
      if (!run.skipped && (run.carded > 0 || run.errors.length > 0)) {
        this.logger.log(
          `pipeline: ${run.carded} card(s), ${run.ignored} ignored, ${run.needsReview} review, ${run.errors.length} error(s)`,
        );
      }
    } catch (e) {
      this.logger.error(
        `pipeline run failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // Expiry sweep: retire stale approvals and rewrite their cards.
    try {
      const expired = await this.decision.expireStale(25);
      for (const id of expired) {
        await this.telegram.updateCardStatus(
          id,
          '⌛ Expired — no action taken',
        );
      }
      if (expired.length > 0) {
        this.logger.log(`expired ${expired.length} stale approval(s)`);
      }
    } catch (e) {
      this.logger.error(
        `expiry sweep failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * One sync per connected mailbox, sequentially. A revoked token on one
   * mailbox must not starve the others: failures are logged per mailbox.
   */
  private async syncAllMailboxes(): Promise<void> {
    const connections = await this.prisma.workspace.findMany({
      where: { gmailRefreshToken: { not: null } },
      select: { id: true, gmailAddress: true, gmailRefreshToken: true },
    });
    for (const connection of connections) {
      await this.syncOne({
        workspaceId: connection.id,
        refreshToken: connection.gmailRefreshToken as string,
        gmailAddress: connection.gmailAddress,
      });
    }
  }

  private async syncOne(connection: SyncConnection): Promise<void> {
    try {
      const result = await this.ingest.syncOnce(connection);
      const label = `${result.mailbox} (${connection.workspaceId})`;
      if (result.skipped) {
        this.logger.warn(
          `Gmail sync still running; skipping this tick for ${label}`,
        );
      } else if (result.inserted > 0) {
        this.logger.log(
          `Gmail ${result.mode} sync for ${label} stored ${result.inserted} new email(s) (cursor ${result.checkpoint})`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Gmail poll failed for ${connection.gmailAddress ?? connection.workspaceId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
