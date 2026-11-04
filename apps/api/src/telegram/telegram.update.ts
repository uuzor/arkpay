import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  Action,
  Command,
  Ctx,
  Hears,
  On,
  Start,
  Update,
} from 'nestjs-telegraf';
import { ActionType } from '@prisma/client';
import type { Context } from 'telegraf';
import { PDFParse } from 'pdf-parse';
import { AgentService, type AgentReply } from '../agent/agent.service';
import { WorkspacesService } from '../auth/workspaces.service';
import { VisionService } from '../llm/vision.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PayrollService } from '../payouts/payroll.service';
import { isValidPeriod, periodInTimezone } from '../payouts/payroll-period';
import { PayoutsService } from '../payouts/payouts.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { SafetyService } from '../safety/safety.service';
import {
  DecisionService,
  type DecisionVerb,
} from '../approvals/decision.service';
import { EMAIL_RE } from './drafts.service';
import { TelegramService } from './telegram.service';
import { TranscriptionService } from './transcription.service';

interface CallbackContext {
  from?: { id: number; username?: string };
  match?: RegExpExecArray;
  answerCbQuery(text?: string, extra?: { show_alert?: boolean }): Promise<unknown>;
  editMessageReplyMarkup(markup: {
    inline_keyboard: unknown[];
  }): Promise<unknown>;
}

@Update()
@Injectable()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    private readonly decision: DecisionService,
    private readonly telegram: TelegramService,
    private readonly approvals: ApprovalsService,
    private readonly payouts: PayoutsService,
    private readonly payroll: PayrollService,
    private readonly agent: AgentService,
    private readonly transcription: TranscriptionService,
    private readonly vision: VisionService,
    private readonly audit: AuditService,
    private readonly safety: SafetyService,
    private readonly workspaces: WorkspacesService,
    // Cycle with PipelineModule (pipeline sends cards via TelegramService)
    // is request-time safe via forwardRef on both modules.
    @Inject(forwardRef(() => PipelineService))
    private readonly pipeline: PipelineService,
  ) {}

  /**
   * Link-gated entry: resolves the sender's workspace, else nudges to /link.
   * Returns null after replying — handlers return early on null.
   */
  private async requireLink(ctx: Context): Promise<string | null> {
    const workspaceId = await this.workspaces.resolveForTelegram(
      ctx.from?.id ?? 0,
    );
    if (!workspaceId) {
      await ctx.reply(
        'This Telegram chat is not linked to an ArkPay workspace yet. Get your pairing code from the dashboard (Settings → Telegram), then send /link ARKPAY-XXXXXX here.',
      );
      return null;
    }
    return workspaceId;
  }

  @Start()
  async start(@Ctx() ctx: Context): Promise<void> {
    await this.runAgent(ctx, 'Hello');
  }

  @Command('help')
  async help(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(this.agent.helpText());
  }

  @Command('status')
  async status(@Ctx() ctx: Context): Promise<void> {
    await this.runAgent(ctx, 'Show my account summary.');
  }

  @Command('safety')
  async safetyPolicy(@Ctx() ctx: Context): Promise<void> {
    const workspaceId = await this.requireLink(ctx);
    if (!workspaceId) return;
    const policy = await this.safety.policy(workspaceId);
    const c = policy.config;
    await ctx.reply(
      [
        `🛡 Payment Safety Engine · ${policy.version}`,
        `Currency allow-list: ${c.currencyAllowlist.join(', ')}`,
        `Auto-approve max: ${c.autoApproveMaxAmount} (0 = always human)`,
        `Vendor/day: ${c.vendorDailyCap} · Global/day: ${c.globalDailyCap}`,
        `Invoice max: ${c.invoiceMaxAmount}`,
        `Batch: ${c.batchMaxItems} items / ${c.batchMaxTotal} total`,
        `Duplicate window: ${c.duplicateWindowHours}h · anomaly factor: ${c.amountAnomalyFactor}x`,
        '',
        ...policy.rules.map((rule) => `• ${rule}`),
      ].join('\n'),
    );
  }

  @Command('blocked')
  async blocked(@Ctx() ctx: Context): Promise<void> {
    const workspaceId = await this.requireLink(ctx);
    if (!workspaceId) return;
    const rows = await this.safety.listBlocked(8, workspaceId);
    if (rows.length === 0) {
      await ctx.reply('No blocked actions. The Safety Engine has not stopped anything.');
      return;
    }
    const lines = ['🚫 Recent Safety Engine blocks', ''];
    for (const row of rows) {
      lines.push(
        `${row.id}`,
        `${row.type} · ${row.currency} ${Number(row.amount).toFixed(2)} → ${row.payeeName} (${row.payeePaypal})`,
        `${row.riskFlags.join(', ') || 'policy check'} · ${row.createdAt.toISOString()}`,
        `Trace: /trace ${row.id}`,
        '',
      );
    }
    await ctx.reply(lines.join('\n').slice(0, 4096));
  }

  @Command('trace')
  async trace(@Ctx() ctx: Context): Promise<void> {
    const workspaceId = await this.requireLink(ctx);
    if (!workspaceId) return;
    const actionId = (this.messageText(ctx) ?? '')
      .replace(/^\/trace\s*/i, '')
      .trim();
    if (!actionId) {
      await ctx.reply('Usage: /trace <actionId>. Use /blocked to list recent blocks.');
      return;
    }
    const trace = await this.audit.trace(actionId, workspaceId);
    if (!trace) {
      await ctx.reply(`No action found for ${actionId}.`);
      return;
    }
    await ctx.reply(this.renderTrace(trace).slice(0, 4096));
  }

  private renderTrace(trace: {
    id: string;
    type: string;
    status: string;
    payeeName: string;
    payeePaypal: string;
    amount: unknown;
    currency: string;
    purpose: string;
    riskFlags: string[];
    policyVerdict: string | null;
    policyVersion: string | null;
    safetySummary: string | null;
    paypalRef: string | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    email: { from: string; subject: string | null; body: string } | null;
    audit: Array<{ event: string; detail: unknown; createdAt: Date }>;
  }): string {
    const lines = [
      `Action ${trace.id}`,
      `${trace.status} · ${trace.type} · ${trace.currency} ${Number(trace.amount).toFixed(2)}`,
      `Payee: ${trace.payeeName} (${trace.payeePaypal})`,
      `Purpose: ${trace.purpose}`,
      `Policy: ${trace.policyVerdict ?? 'not evaluated'} · ${trace.policyVersion ?? 'n/a'}`,
      `Flags: ${trace.riskFlags.join(', ') || 'none'}`,
      trace.safetySummary ? `Why: ${trace.safetySummary}` : '',
      trace.paypalRef ? `PayPal ref: ${trace.paypalRef}` : '',
      trace.approvedBy
        ? `Approved by: ${trace.approvedBy} at ${trace.approvedAt?.toISOString() ?? 'n/a'}`
        : '',
      '',
      '— Source email —',
      trace.email
        ? `${trace.email.from} · ${trace.email.subject ?? '(no subject)'}\n${trace.email.body.slice(0, 700)}`
        : '(no source email)',
      '',
      '— Audit trail —',
      ...trace.audit.map(
        (row) =>
          `${row.createdAt.toISOString()} ${row.event} ${JSON.stringify(row.detail ?? {}).slice(0, 600)}`,
      ),
    ];
    return lines.filter(Boolean).join('\n');
  }

  @Command('balance')
  async balance(@Ctx() ctx: Context): Promise<void> {
    await this.runAgent(ctx, 'What is my PayPal balance?');
  }

  @Command('spent')
  async spent(@Ctx() ctx: Context): Promise<void> {
    await this.runAgent(ctx, 'What did I spend this month?');
  }

  @Command('emails')
  async emails(@Ctx() ctx: Context): Promise<void> {
    const args = (this.messageText(ctx) ?? '').replace(/^\/emails\s*/i, '').trim();
    await this.runAgent(ctx, args ? `Find emails about ${args}.` : 'Show my latest emails.');
  }

  @Command('invoice')
  async invoice(@Ctx() ctx: Context): Promise<void> {
    const args = (this.messageText(ctx) ?? '').replace(/^\/invoice\s*/i, '').trim();
    await this.runAgent(ctx, `Create an invoice: ${args}`);
  }

  @Command('followup')
  async followup(@Ctx() ctx: Context): Promise<void> {
    const args = (this.messageText(ctx) ?? '').replace(/^\/followup\s*/i, '').trim();
    await this.runAgent(ctx, `Follow up on ${args}`);
  }

  @Command('schedules')
  async schedules(@Ctx() ctx: Context): Promise<void> {
    await this.runAgent(ctx, 'List my scheduled jobs and their next run.');
  }

  @Command('payroll')
  async payrollPrep(@Ctx() ctx: Context): Promise<void> {
    const workspaceId = await this.requireLink(ctx);
    if (!workspaceId) return;
    const arg = (this.messageText(ctx) ?? '')
      .replace(/^\/payroll\s*/i, '')
      .trim();
    const period = arg || periodInTimezone(new Date(), 'UTC');
    if (!isValidPeriod(period)) {
      await ctx.reply('Usage: /payroll [YYYY-MM]');
      return;
    }
    try {
      const prepared = await this.payroll.prepare(period, {
        preparedBy: 'telegram',
        workspaceId,
      });
      if (!prepared.created || !prepared.batch) {
        await ctx.reply(
          `Payroll ${period} was already prepared (batch ${prepared.run.batchId}). Use /pending to resend the card.`,
        );
        return;
      }
      await this.telegram.sendBatchCard(
        prepared.batch.batchId,
        prepared.batch.excluded,
      );
      await ctx.reply(
        `Payroll ${period} prepared: ${prepared.batch.included.length} recipient(s), total ${prepared.batch.currency} ${prepared.batch.total}. Approve the card to pay.`,
      );
    } catch (e) {
      await ctx.reply(
        `Could not prepare payroll ${period}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  @Command('statement')
  async statement(@Ctx() ctx: Context): Promise<void> {
    const args = (this.messageText(ctx) ?? '').replace(/^\/statement\s*/i, '').trim();
    await this.runAgent(ctx, `Generate a PDF statement for ${args || 'this month'}.`);
  }

  @Command('reset')
  async reset(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!(await this.requireLink(ctx))) return;
    await this.agent.clearHistory(ctx.from.id);
    this.agent.cancelPending(ctx.from.id);
    await ctx.reply('Conversation history cleared.');
  }

  @Command('whoami')
  async whoami(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    this.logger.log(
      `whoami: id=${ctx.from.id} username=${ctx.from.username ?? 'n/a'}`,
    );
    const linked = await this.workspaces.resolveForTelegram(ctx.from.id);
    await ctx.reply(
      `Telegram user id: ${ctx.from.id}\n` +
        `Username: ${ctx.from.username ? `@${ctx.from.username}` : 'n/a'}\n` +
        `Linked: ${linked ? `yes (${linked})` : 'no — send /link <code> from your dashboard'}`,
    );
  }

  @Command('pending')
  async pending(@Ctx() ctx: Context): Promise<void> {
    const workspaceId = await this.requireLink(ctx);
    if (!workspaceId) return;
    const actions = await this.decision.listPending(25, workspaceId);
    const awaiting = await this.pipeline.listAwaitingConfirm(workspaceId);
    const needsReview = await this.pipeline.listNeedsReview(workspaceId);
    if (
      actions.length === 0 &&
      awaiting.length === 0 &&
      needsReview.length === 0
    ) {
      await ctx.reply('No pending approvals.');
      return;
    }
    // Singles get their own cards; batch members collapse into one card each.
    const singles = actions
      .filter((a) => a.type !== ActionType.PAYOUT_BATCH)
      .slice(0, 5);
    const batchIds = [
      ...new Set(
        actions
          .filter((a) => a.type === ActionType.PAYOUT_BATCH && a.batchId)
          .map((a) => a.batchId as string),
      ),
    ].slice(0, 2);
    if (actions.length > 0) {
      await ctx.reply(
        `${actions.length} open approval(s) (${singles.length} single(s), ${batchIds.length} batch(es)):`,
      );
      for (const action of singles) {
        await this.telegram.sendDecisionCard(action.id);
      }
      for (const batchId of batchIds) {
        await this.telegram.sendBatchCard(batchId);
      }
    }
    // Pre-draft asks have no action yet — re-surface them so a missed ask
    // never strands an email.
    if (awaiting.length > 0) {
      await ctx.reply(
        `${awaiting.length} email(s) waiting for draft confirm:`,
      );
      for (const email of awaiting.slice(0, 3)) {
        await this.telegram.sendPredraftAsk(email.id);
      }
    }
    // Same for review notices: re-send so a missed one never strands an email.
    if (needsReview.length > 0) {
      await ctx.reply(
        `${needsReview.length} email(s) needing review (reply with the missing PayPal email):`,
      );
      for (const email of needsReview.slice(0, 2)) {
        await this.telegram.sendReviewNotice(email.id);
      }
    }
  }

  @Hears(/^(\/payteam|pay my team)$/i)
  async payTeam(@Ctx() ctx: Context): Promise<void> {
    const workspaceId = await this.requireLink(ctx);
    if (!workspaceId) return;
    try {
      const result = await this.payouts.assembleTeamBatch({}, { workspaceId });
      await this.telegram.sendBatchCard(result.batchId, result.excluded);
      await ctx.reply(
        `Team batch assembled: ${result.included.length} recipient(s), total ${result.currency} ${result.total}.` +
          (result.excluded.length > 0
            ? ` ${result.excluded.length} excluded (see card).`
            : ''),
      );
    } catch (e) {
      await ctx.reply(
        `Could not assemble team batch: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  @Command('cancel')
  async cancel(@Ctx() ctx: Context): Promise<void> {
    await this.runAgent(ctx, 'cancel');
  }

  /** Pair this chat to a workspace: /link ARKPAY-XXXXXX (see dashboard). */
  @Command('link')
  async link(@Ctx() ctx: Context): Promise<void> {
    const code = (this.messageText(ctx) ?? '')
      .replace(/^\/link\s*/i, '')
      .trim();
    if (!code) {
      await ctx.reply(
        'Usage: /link ARKPAY-XXXXXX — the code is on your dashboard under Settings → Telegram.',
      );
      return;
    }
    if (!ctx.from) return;
    try {
      await this.workspaces.linkTelegram(code, ctx.from.id);
      await ctx.reply(
        '✅ This Telegram chat is now linked to your ArkPay workspace. Approval cards will arrive here.',
      );
    } catch (e) {
      await ctx.reply(
        `Could not link: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Free-text conversation: questions, commands, invoice instructions. */
  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    const text = this.messageText(ctx);
    if (!text || text.startsWith('/')) return;
    this.logger.log(
      `text from ${ctx.from?.id ?? 'unknown'} (${text.length} chars): ${text.slice(0, 80)}`,
    );
    // The dedicated pay-team listener owns this phrase.
    if (/(pay my team|payteam|payroll)/i.test(text)) return;
    await this.runAgent(ctx, text);
  }

  /**
   * Ephemeral progress note ("Transcribing…", "Reading…"). The id comes
   * back so the handler can delete the note before the real reply lands —
   * the chat shows the answer, not the scaffolding.
   */
  private async sendStatus(ctx: Context, text: string): Promise<number | null> {
    try {
      const sent = await ctx.reply(text);
      return (sent as { message_id?: number } | undefined)?.message_id ?? null;
    } catch {
      return null;
    }
  }

  /** Best-effort status cleanup: a stale note is cosmetic, never fatal. */
  private async clearStatus(ctx: Context, id: number | null): Promise<void> {
    if (id == null) return;
    try {
      await ctx.deleteMessage(id);
    } catch {
      // Already gone (manual delete, race) — the reply still goes out.
    }
  }

  /** Voice notes: download from Telegram, transcribe, then act. */
  @On('voice')
  async onVoice(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.requireLink(ctx))) return;
    const voice = (ctx.message as { voice?: { file_id: string } } | undefined)
      ?.voice;
    if (!voice?.file_id) return;
    const statusId = await this.sendStatus(ctx, '🎤 Transcribing…');
    try {
      const audio = await this.downloadFile(ctx, voice.file_id);
      const transcript = await this.transcription.transcribe(audio, 'ogg');
      await this.clearStatus(ctx, statusId);
      if (!transcript) {
        await ctx.reply('I couldn’t hear any speech in that voice note.');
        return;
      }
      await this.runAgent(ctx, transcript);
    } catch (e) {
      await this.clearStatus(ctx, statusId);
      await ctx.reply(
        `Voice transcription failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** PDF / text / CSV / JSON / audio documents. */
  @On('document')
  async onDocument(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.requireLink(ctx))) return;
    const doc = (
      ctx.message as
        | {
            document?: {
              file_id: string;
              file_name?: string;
              mime_type?: string;
              file_size?: number;
            };
          }
        | undefined
    )?.document;
    if (!doc?.file_id) return;
    if ((doc.file_size ?? 0) > 20 * 1024 * 1024) {
      await ctx.reply('That file is larger than Telegram’s 20 MB bot limit.');
      return;
    }
    const statusId = await this.sendStatus(ctx, '📄 Reading…');
    try {
      const buffer = await this.downloadFile(ctx, doc.file_id);
      const name = doc.file_name ?? 'document';
      const mime = doc.mime_type ?? '';
      let text = '';
      if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
        const parser = new PDFParse({ data: buffer });
        try {
          const parsed = await parser.getText();
          text = parsed.text;
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      } else if (
        mime.startsWith('text/') ||
        mime === 'application/json' ||
        /\.(txt|csv|md|json)$/i.test(name)
      ) {
        text = buffer.toString('utf8');
      } else if (mime.startsWith('audio/')) {
        const format = mime.includes('mpeg')
          ? 'mp3'
          : mime.includes('m4a')
            ? 'm4a'
            : mime.includes('wav')
              ? 'wav'
              : mime.includes('webm')
                ? 'webm'
                : 'ogg';
        text = await this.transcription.transcribe(buffer, format);
      } else if (
        mime.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif)$/i.test(name)
      ) {
        text = await this.describeImageForAgent(
          buffer,
          mime.startsWith('image/') ? mime : 'image/jpeg',
        );
      } else {
        await this.clearStatus(ctx, statusId);
        await ctx.reply(
          'I can read PDF, text, CSV, JSON, audio and image files right now. Video analysis is next.',
        );
        return;
      }
      // A PDF with (almost) no extractable text is a scan — the vision model
      // needs pixels, and this server has no PDF renderer, so ask for photos
      // instead of hallucinating over an empty string.
      if (
        (mime === 'application/pdf' || /\.pdf$/i.test(name)) &&
        text.replace(/\s+/g, '').length < 50
      ) {
        await this.clearStatus(ctx, statusId);
        await ctx.reply(
          'That PDF looks scanned (no readable text inside). Send me photos of the pages and I’ll read them.',
        );
        return;
      }
      await this.clearStatus(ctx, statusId);
      const reply = await this.agent.run(
        ctx.from!.id,
        `I uploaded a document named ${name}. Here is its text:\n\n${text.slice(0, 20_000)}\n\nAnalyze it. If it is a money request, use create_invoice_draft. Otherwise summarize what it is.`,
      );
      await this.sendAgentReply(ctx, reply);
    } catch (e) {
      await this.clearStatus(ctx, statusId);
      await ctx.reply(
        `I couldn’t read that file: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  @On('photo')
  async onPhoto(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.requireLink(ctx))) return;
    const photos = (
      ctx.message as { photo?: Array<{ file_id: string; file_size?: number }> } | undefined
    )?.photo;
    const best = photos?.[photos.length - 1];
    if (!best?.file_id) return;
    this.logger.log(`photo from ${ctx.from?.id ?? 'unknown'}`);
    const statusId = await this.sendStatus(ctx, '🖼️ Reading…');
    try {
      const buffer = await this.downloadFile(ctx, best.file_id);
      const seen = await this.describeImageForAgent(buffer, 'image/jpeg');
      const caption = (
        ctx.message as { caption?: string } | undefined
      )?.caption?.trim();
      await this.clearStatus(ctx, statusId);
      await this.runAgent(
        ctx,
        `I uploaded a photo${caption ? ` with caption "${caption}"` : ''}. Here is what it shows:\n\n${seen.slice(0, 20_000)}\n\nAnalyze it. If it is a bill, receipt or money request, extract payee/amount/purpose and use create_invoice_draft or request_payout. Otherwise summarize what it is.`,
      );
    } catch (e) {
      await this.clearStatus(ctx, statusId);
      await ctx.reply(
        `I couldn’t read that photo: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Vision prompt shared by photos and image documents. */
  private describeImageForAgent(buffer: Buffer, mime: string): Promise<string> {
    return this.vision.describeImage(
      buffer,
      mime,
      'Describe everything visible in this image in plain text. If it is a receipt, invoice, bill or payment screenshot, transcribe the merchant/payee name, every amount with its currency, the date, and any reference numbers — exactly as shown, no guessing. If it is not a financial document, describe what it is in two sentences.',
    );
  }

  @On('audio')
  async onAudio(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.requireLink(ctx))) return;
    const audio = (
      ctx.message as { audio?: { file_id: string; mime_type?: string } } | undefined
    )?.audio;
    if (!audio?.file_id) return;
    this.logger.log(`audio from ${ctx.from?.id ?? 'unknown'}`);
    const statusId = await this.sendStatus(ctx, '🎤 Transcribing…');
    try {
      const buffer = await this.downloadFile(ctx, audio.file_id);
      const format = (audio.mime_type ?? '').includes('mpeg')
        ? 'mp3'
        : (audio.mime_type ?? '').includes('m4a')
          ? 'm4a'
          : 'ogg';
      const transcript = await this.transcription.transcribe(buffer, format);
      await this.clearStatus(ctx, statusId);
      if (!transcript) {
        await ctx.reply('I couldn’t hear any speech in that audio.');
        return;
      }
      await this.runAgent(ctx, transcript);
    } catch (e) {
      await this.clearStatus(ctx, statusId);
      await ctx.reply(
        `Audio transcription failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Never leave a supported-chat user with silence. */
  @On('message')
  async onUnsupportedMessage(@Ctx() ctx: Context): Promise<void> {
    // Silent for strangers (no sticker-spam); linked users get the nudge below.
    const linked = await this.workspaces.resolveForTelegram(ctx.from?.id ?? 0);
    if (!linked) return;
    const message = ctx.message as
      | {
          text?: string;
          voice?: unknown;
          document?: unknown;
          photo?: unknown;
          audio?: unknown;
        }
      | undefined;
    if (!message) return;
    if (
      message.text ||
      message.voice ||
      message.document ||
      message.photo ||
      message.audio
    ) {
      return;
    }
    this.logger.log(
      `unsupported message from ${ctx.from?.id ?? 'unknown'}: ${Object.keys(message).join(',')}`,
    );
    await ctx.reply(
      'I can handle text, voice notes, PDFs, text/CSV files and photos. Try /help for examples.',
    );
    this.logger.log('unsupported-message fallback sent');
  }

  @Action(/^(approve|ignore|edit):(.+)$/)
  async onDecision(@Ctx() ctx: CallbackContext): Promise<void> {
    const verb = ctx.match?.[1];
    const actionId = ctx.match?.[2];
    if (!verb || !actionId) {
      await ctx.answerCbQuery('Malformed action');
      return;
    }

    if (verb === 'edit') {
      await ctx.answerCbQuery(
        'Conversational edit is not wired yet — POST /approvals/<id>/supersede to revise (it voids this approval), or Ignore to cancel.',
        { show_alert: true },
      );
      return;
    }

    const result = await this.decision.decide(
      actionId,
      verb as DecisionVerb,
      ctx.from?.id,
    );
    this.logger.log(
      `decision ${verb} ${actionId} by ${ctx.from?.id ?? 'unknown'}: ${result.reason}`,
    );

    switch (result.reason) {
      case 'approved':
        // Execution must not depend on Telegram's UI calls succeeding: the
        // approval is already durable in Postgres. Start it first, then answer.
        this.executeInBackground(actionId);
        await this.answer(ctx, 'Approved ✅ — executing…');
        await this.clearButtons(ctx);
        break;
      case 'ignored':
        await this.answer(ctx, 'Ignored 🚫');
        await this.telegram.updateCardStatus(actionId, '🚫 Ignored');
        break;
      case 'already_handled':
        await this.answer(ctx, `Already ${result.status}`, true);
        await this.clearButtons(ctx);
        break;
      case 'expired':
        await this.answer(ctx, 'This approval expired.', true);
        await this.telegram.updateCardStatus(
          actionId,
          '⌛ Expired — no action taken',
        );
        break;
      case 'forbidden':
        await this.answer(
          ctx,
          'This chat is not linked. Send /link <code> from your dashboard.',
          true,
        );
        break;
      default:
        await this.answer(ctx, 'Action not found', true);
    }
  }

  @Action(/^(draft-yes|draft-no):(.+)$/)
  async onPredraftDecision(@Ctx() ctx: CallbackContext): Promise<void> {
    const verb = ctx.match?.[1];
    const emailId = ctx.match?.[2];
    if (!verb || !emailId) {
      await ctx.answerCbQuery('Malformed action');
      return;
    }
    const workspaceId = await this.workspaces.resolveForTelegram(
      ctx.from?.id ?? 0,
    );
    if (!workspaceId) {
      await this.answer(
        ctx,
        'This chat is not linked. Send /link <code> from your dashboard.',
        true,
      );
      return;
    }
    if (verb === 'draft-yes') {
      const result = await this.pipeline.confirmDraftProposal(
        emailId,
        workspaceId,
      );
      this.logger.log(
        `predraft confirm ${emailId} by ${ctx.from?.id ?? 'unknown'}: ${result.outcome}`,
      );
      switch (result.outcome) {
        case 'drafted':
          await this.answer(ctx, 'Draft created — approval card sent ✅');
          await this.clearButtons(ctx);
          break;
        case 'blocked':
          await this.answer(
            ctx,
            'Policy now blocks this — see the notice. No draft was carded.',
            true,
          );
          await this.clearButtons(ctx);
          break;
        case 'already':
          await this.answer(ctx, 'Already handled.', true);
          await this.clearButtons(ctx);
          break;
        case 'stale':
          await this.answer(
            ctx,
            'This request went stale — flagged for review.',
            true,
          );
          await this.clearButtons(ctx);
          break;
        case 'foreign':
          await this.answer(ctx, 'That request is not yours.', true);
          break;
        default:
          await this.answer(ctx, 'Request not found', true);
      }
      return;
    }
    const result = await this.pipeline.declineDraftProposal(
      emailId,
      workspaceId,
    );
    this.logger.log(
      `predraft decline ${emailId} by ${ctx.from?.id ?? 'unknown'}: ${result.outcome}`,
    );
    switch (result.outcome) {
      case 'declined':
        await this.answer(ctx, 'Ignored 🚫 — no draft was created');
        await this.clearButtons(ctx);
        break;
      case 'already':
        await this.answer(ctx, 'Already handled.', true);
        await this.clearButtons(ctx);
        break;
      case 'foreign':
        await this.answer(ctx, 'That request is not yours.', true);
        break;
      default:
        await this.answer(ctx, 'Request not found', true);
    }
  }

  @Action(/^review-no:(.+)$/)
  async onReviewDismiss(@Ctx() ctx: CallbackContext): Promise<void> {
    const emailId = ctx.match?.[1];
    if (!emailId) {
      await ctx.answerCbQuery('Malformed action');
      return;
    }
    const workspaceId = await this.workspaces.resolveForTelegram(
      ctx.from?.id ?? 0,
    );
    if (!workspaceId) {
      await this.answer(
        ctx,
        'This chat is not linked. Send /link <code> from your dashboard.',
        true,
      );
      return;
    }
    const result = await this.pipeline.dismissEmailReview(emailId, workspaceId);
    this.logger.log(
      `review dismiss ${emailId} by ${ctx.from?.id ?? 'unknown'}: ${result.outcome}`,
    );
    switch (result.outcome) {
      case 'dismissed':
        await this.answer(ctx, 'Ignored 🚫 — no draft was created');
        await this.clearButtons(ctx);
        break;
      case 'already':
        await this.answer(ctx, 'Already handled.', true);
        await this.clearButtons(ctx);
        break;
      case 'foreign':
        await this.answer(ctx, 'That request is not yours.', true);
        break;
      default:
        await this.answer(ctx, 'Request not found', true);
    }
  }

  private messageText(ctx: Context): string | undefined {
    return (ctx.message as { text?: string } | undefined)?.text;
  }

  private async runAgent(ctx: Context, text: string): Promise<void> {
    if (!ctx.from) return;
    if (!(await this.requireLink(ctx))) return;
    // Loading feedback: model turns take 10s+, and a silent chat reads as
    // broken. Telegram shows "typing…" ~5s per call, so refresh it.
    const tick = async (): Promise<void> => {
      try {
        await ctx.sendChatAction('typing');
      } catch {
        // Chat gone; the reply send below will fail loudly enough.
      }
    };
    await tick();
    const typing = setInterval(() => void tick(), 4000);
    try {
      try {
        if (await this.maybeResolveEmailField(ctx, text)) return;
      } catch (e) {
        this.logger.warn(
          `email resolve failed, falling through to agent: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const reply = await this.agent.run(ctx.from.id, text);
      this.logger.log(
        `agent reply to ${ctx.from.id}: ${reply.document ? 'document ' : ''}${reply.text ? `${reply.text.slice(0, 60)}` : '(empty)'}`,
      );
      await this.sendAgentReply(ctx, reply);
    } catch (e) {
      this.logger.error(
        `agent failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      await ctx.reply(
        `Something went wrong: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearInterval(typing);
    }
  }

  /**
   * Reply-to-resolve for NEEDS_REVIEW emails: a bare PayPal email answers the
   * review notice. Skipped while an agent draft is live — the foreground
   * conversation owns bare-email replies then.
   */
  private async maybeResolveEmailField(
    ctx: Context,
    text: string,
  ): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId || !EMAIL_RE.test(text.trim())) return false;
    if (this.agent.hasLivePending(userId)) return false;
    const workspaceId = await this.workspaces.resolveForTelegram(userId);
    if (!workspaceId) return false;
    const res = await this.pipeline.resolveMissingPayeeEmail(
      workspaceId,
      text.trim(),
    );
    if (!res.handled) return false;
    this.logger.log(
      `email resolve by ${userId}: ${res.emailId} → ${res.outcome}`,
    );
    switch (res.outcome) {
      case 'asked':
        await ctx.reply(
          'Got it — the draft question is on its way. Confirm it to proceed.',
        );
        break;
      case 'blocked':
        await ctx.reply(
          'Saved, but policy now blocks this one — see the notice. No draft was made.',
        );
        break;
      default:
        await ctx.reply(
          'Hmm — that request already moved on. Use /pending to see open items.',
        );
        break;
    }
    return true;
  }

  private async sendAgentReply(
    ctx: Context,
    reply: AgentReply,
  ): Promise<void> {
    if (reply.document) {
      // Back to the chat that asked, never the global approver.
      await ctx.replyWithDocument(
        { source: reply.document.buffer, filename: reply.document.filename },
        reply.document.caption ? { caption: reply.document.caption } : undefined,
      );
    }
    if (reply.text) {
      await ctx.reply(reply.text.slice(0, 4096));
    }
  }

  private async downloadFile(ctx: Context, fileId: string): Promise<Buffer> {
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(link.href);
    if (!res.ok) throw new Error(`file download HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Telegram UI failures are logged, never allowed to abort the money path. */
  private async answer(
    ctx: CallbackContext,
    text: string,
    alert = false,
  ): Promise<void> {
    try {
      await ctx.answerCbQuery(text, alert ? { show_alert: true } : undefined);
    } catch (e) {
      this.logger.warn(
        `callback answer failed (${text}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Fire-and-forget execution after an Approve tap: the callback answers fast
   * while PayPal runs in the background, then a receipt (or failure) message
   * follows. Execution is idempotent, so a crash here just means a manual
   * POST /approvals/:id/execute retry.
   */
  private executeInBackground(actionId: string): void {
    void (async () => {
      try {
        const result =
          await this.approvals.executeApprovedAction(actionId);
        if (result.ok) {
          await this.telegram.updateCardStatus(
            actionId,
            `✅ Sent · ${result.paypalRef}`,
          );
          await this.telegram.sendActionMessage(
            actionId,
            `✅ Invoice sent: ${result.paypalRef} (action ${actionId})`,
          );
        } else if (result.reason === 'blocked') {
          await this.telegram.updateCardStatus(
            actionId,
            '🚫 Blocked by the Payment Safety Engine',
          );
          await this.telegram.sendActionMessage(
            actionId,
            `🚫 Blocked at execution: ${result.detail ?? 'policy check failed'}. No money moved. Use /trace ${actionId} for the audit trail.`,
          );
        } else {
          await this.telegram.updateCardStatus(
            actionId,
            `⚠️ Not sent — ${result.reason}`,
          );
          await this.telegram.sendActionMessage(
            actionId,
            `⚠️ Invoice not sent (${result.reason}). ${result.detail ?? ''} Retry: POST /approvals/${actionId}/execute`,
          );
        }
      } catch (e) {
        this.logger.error(
          `background execution crashed for ${actionId}: ${e instanceof Error ? e.message : String(e)}`,
        );
        try {
          await this.telegram.sendActionMessage(
            actionId,
            `⚠️ Execution crashed for ${actionId}; retry via POST /approvals/${actionId}/execute`,
          );
        } catch {
          // Bot unreachable — the audit trail still has the truth.
        }
      }
    })();
  }

  @Action(/^(approve-batch|ignore-batch):(.+)$/)
  async onBatchDecision(@Ctx() ctx: CallbackContext): Promise<void> {
    const verb = ctx.match?.[1] === 'approve-batch' ? 'approve' : 'ignore';
    const batchId = ctx.match?.[2];
    if (!batchId) {
      await ctx.answerCbQuery('Malformed action');
      return;
    }
    const result = await this.decision.decideBatch(
      batchId,
      verb as DecisionVerb,
      ctx.from?.id,
    );
    this.logger.log(
      `batch decision ${verb} ${batchId} by ${ctx.from?.id ?? 'unknown'}: ${result.reason}`,
    );

    switch (result.reason) {
      case 'approved':
        // Same rule as singles: money first, UI second, UI failures logged.
        this.executeBatchInBackground(batchId);
        await this.answer(ctx, 'Batch approved ✅ — executing…');
        await this.clearButtons(ctx);
        break;
      case 'ignored':
        await this.answer(ctx, 'Batch ignored 🚫');
        await this.telegram.updateBatchCardStatus(batchId, '🚫 Ignored');
        break;
      case 'already_handled':
        await this.answer(ctx, `Already ${result.status ?? 'handled'}`, true);
        await this.clearButtons(ctx);
        break;
      case 'expired':
        await this.answer(ctx, 'This approval expired.', true);
        await this.telegram.updateBatchCardStatus(
          batchId,
          '⌛ Expired — no action taken',
        );
        break;
      case 'forbidden':
        await this.answer(
          ctx,
          'This chat is not linked. Send /link <code> from your dashboard.',
          true,
        );
        break;
      default:
        await this.answer(ctx, 'Batch not found', true);
    }
  }

  private executeBatchInBackground(batchId: string): void {
    void (async () => {
      try {
        const result = await this.approvals.executeBatch(batchId);
        const settled = result.settled;
        const tally = settled
          ? `${settled.executed} paid, ${settled.failed} failed, ${settled.pending} pending`
          : 'no tally';
        if (result.ok) {
          await this.telegram.updateBatchCardStatus(
            batchId,
            `✅ Sent · ${result.paypalRef}`,
          );
          await this.telegram.sendBatchMessage(
            batchId,
            `✅ Batch sent: ${tally} (PayPal batch ${result.paypalRef})`,
          );
        } else if (result.reason === 'blocked') {
          await this.telegram.updateBatchCardStatus(
            batchId,
            '🚫 Blocked by the Payment Safety Engine',
          );
          await this.telegram.sendBatchMessage(
            batchId,
            `🚫 Batch blocked at execution: ${result.detail ?? 'policy check failed'}. No money moved. Use /blocked and /trace for the audit trail.`,
          );
        } else {
          await this.telegram.updateBatchCardStatus(
            batchId,
            `⚠️ Not fully sent — ${result.reason}`,
          );
          await this.telegram.sendBatchMessage(
            batchId,
            `⚠️ Batch not fully sent (${result.reason}: ${tally}). ${result.detail ?? ''} Retry: POST /approvals/batch/${batchId}/execute`,
          );
        }
      } catch (e) {
        this.logger.error(
          `background batch execution crashed for ${batchId}: ${e instanceof Error ? e.message : String(e)}`,
        );
        try {
          await this.telegram.sendBatchMessage(
            batchId,
            `⚠️ Batch execution crashed for ${batchId}; retry via POST /approvals/batch/${batchId}/execute`,
          );
        } catch {
          // Bot unreachable — the audit trail still has the truth.
        }
      }
    })();
  }

  private async clearButtons(ctx: CallbackContext): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {
      // Message too old to edit — the DB transition already happened.
    }
  }
}
