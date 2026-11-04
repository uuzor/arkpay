import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ExtractionResult } from './extraction.schema';
import { formatEmailForExtraction, LlmExtractionError } from './llm.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

/** Upper bound on email body characters sent to the model per extraction. */
const MAX_BODY_CHARS = 20_000;

export type ClassifyStatus = Extract<EmailStatus, 'IGNORED' | 'NEEDS_REVIEW'>;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly provider: OpenAiCompatibleProvider,
  ) {}

  /** Below this confidence an extraction is flagged, never acted on. */
  private get minConfidence(): number {
    const raw = Number(
      this.config.get<string>('LLM_MIN_CONFIDENCE') ?? 0.6,
    );
    if (!Number.isFinite(raw)) return 0.6;
    return Math.min(Math.max(raw, 0), 1);
  }

  /**
   * Extract + decide the terminal status, if any. NOISE → IGNORED,
   * low-confidence → NEEDS_REVIEW, otherwise null meaning "proceed to the
   * downstream pipeline" (contacts/cards in Phase 4+), which re-reads the
   * returned result instead of re-calling the model.
   */
  async classify(emailText: string): Promise<{
    result: ExtractionResult;
    status: ClassifyStatus | null;
  }> {
    const result = await this.provider.extract(emailText);
    if (result.kind === 'NOISE') return { result, status: 'IGNORED' };
    if (result.confidence < this.minConfidence) {
      return { result, status: 'NEEDS_REVIEW' };
    }
    return { result, status: null };
  }

  /**
   * Classify one stored NEW email and persist terminal statuses. Valid,
   * confident extractions stay NEW — the downstream pipeline claims them and
   * carries the extraction into the Action's extractedJson. Unreadable emails
   * (model failure after retry) land in NEEDS_REVIEW, never guessed.
   */
  async processStoredEmail(emailId: string): Promise<{
    result: ExtractionResult | null;
    status: EmailStatus;
  }> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
    });
    if (!email) throw new Error(`Email ${emailId} not found`);
    if (email.status !== 'NEW') {
      return { result: null, status: email.status };
    }
    const text = formatEmailForExtraction(
      { from: email.from, subject: email.subject },
      email.body.slice(0, MAX_BODY_CHARS),
    );
    let result: ExtractionResult;
    let status: ClassifyStatus | null;
    try {
      ({ result, status } = await this.classify(text));
    } catch (e) {
      if (!(e instanceof LlmExtractionError)) throw e;
      // Transport outage (provider down, no balance, timeout): the email was
      // never read. Rethrow so the pipeline counts an error and the email
      // stays NEW for the next tick — flagging it NEEDS_REVIEW here would
      // permanently bury the whole backlog on any provider blip.
      if (e.retryable) throw e;
      this.logger.warn(`Email ${emailId} unreadable, flagging: ${e.message}`);
      await this.mark(emailId, 'NEEDS_REVIEW');
      return { result: null, status: 'NEEDS_REVIEW' };
    }
    if (status) await this.mark(emailId, status);
    this.logger.log(
      `Email ${emailId}: ${result.kind} conf=${result.confidence.toFixed(2)} → ${status ?? 'NEW (pipeline)'}`,
    );
    return { result, status: status ?? 'NEW' };
  }

  /** Single UPDATE-WHERE so two workers can never mark the same email twice. */
  private async mark(emailId: string, status: ClassifyStatus): Promise<void> {
    await this.prisma.email.updateMany({
      where: { id: emailId, status: 'NEW' },
      data: { status },
    });
  }
}
