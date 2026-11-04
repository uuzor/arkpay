import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Markup, Telegraf } from 'telegraf';
import { AuditService } from '../audit/audit.service';
import { parseSender } from '../contacts/sender';
import { ExtractionSchema } from '../llm/extraction.schema';
import {
  buildPredraftAsk,
  buildReviewNotice,
  buildUnreadableNotice,
} from '../pipeline/predraft';
import { PrismaService } from '../prisma/prisma.service';
import { cleanSnippet, expiryText, timeAgo } from './snippet';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Destination chat for a workspace, or null when nothing is linked.
   * Fail-closed: unlinked workspaces get NO card — never another chat.
   */
  private async chatForWorkspace(
    workspaceId?: string | null,
  ): Promise<string | null> {
    if (!workspaceId) return null;
    const link = await this.prisma.telegramLink.findUnique({
      where: { workspaceId },
      select: { telegramId: true },
    });
    return link?.telegramId ?? null;
  }

  /** Skip audit shared by the card senders when no chat is linked. */
  private async skipCard(
    actionId: string,
    workspaceId: string | null,
    extra: Record<string, string> = {},
  ): Promise<number> {
    this.logger.warn(
      `no linked Telegram chat for workspace ${workspaceId}; card skipped (action ${actionId})`,
    );
    await this.audit.log(actionId, 'CARD_SKIPPED', {
      reason: 'workspace telegram not linked',
      ...extra,
    });
    return 0;
  }

  /**
   * Send (or re-send) the decision card for one action to its workspace's
   * linked chat. Returns the message id, or 0 when unlinked (fail-closed).
   */
  async sendDecisionCard(actionId: string): Promise<number> {
    const action = await this.prisma.action.findUnique({
      where: { id: actionId },
      include: { email: true, contact: true },
    });
    if (!action) throw new Error(`action ${actionId} not found`);
    if (action.status === 'BLOCKED') {
      return this.sendBlockedNotice(actionId);
    }

    const chatId = await this.chatForWorkspace(action.workspaceId);
    if (!chatId) return this.skipCard(actionId, action.workspaceId);
    // The primary button states the action AND the amount; callback data is
    // unchanged so handlers don't move.
    const money = `${action.currency} ${Number(action.amount).toFixed(2)}`;
    const primary =
      action.type === 'INVOICE' ? `🧾 Send ${money}` : `💸 Pay ${money}`;
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(primary, `approve:${action.id}`),
        Markup.button.callback('✏️ Edit', `edit:${action.id}`),
      ],
      [Markup.button.callback('🚫 Ignore', `ignore:${action.id}`)],
    ]).reply_markup;

    const message = await this.bot.telegram.sendMessage(
      chatId,
      this.renderCard(action),
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      },
    );

    await this.audit.log(action.id, 'CARD_SENT', {
      messageId: message.message_id,
      chatId,
    });
    return message.message_id;
  }

  /**
   * Visible dead-end for a Safety Engine block: the same facts as a decision
   * card, but no approve button exists and the reason is written out. The
   * audit trail remains the source of truth.
   */
  async sendBlockedNotice(
    actionId: string,
    reasons: string[] = [],
  ): Promise<number> {
    const action = await this.prisma.action.findUnique({
      where: { id: actionId },
      include: { email: true, contact: true },
    });
    if (!action) throw new Error(`action ${actionId} not found`);

    const chatId = await this.chatForWorkspace(action.workspaceId);
    if (!chatId) return this.skipCard(actionId, action.workspaceId);
    const why =
      reasons.length > 0
        ? reasons
        : action.safetySummary
          ? [action.safetySummary]
          : ['a safety policy check failed'];
    const text = [
      this.renderCard(action, '🚫 Blocked by the Payment Safety Engine'),
      '',
      `<b>Why:</b> ${why.map(escapeHtml).join('; ')}`,
      '<b>No money moved.</b> This action cannot be approved or executed.',
      action.policyVersion
        ? `<i>Policy ${escapeHtml(action.policyVersion)}</i>`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const message = await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
    });
    await this.audit.log(action.id, 'BLOCKED_NOTICE', {
      messageId: message.message_id,
      chatId,
      reasons: why,
    });
    return message.message_id;
  }

  /**
   * Pre-draft ask for one email: "should I draft this?" No action row exists
   * yet, so there is no audit row either — the email row (AWAITING_CONFIRM +
   * stored extraction) is the record. Returns the message id, or 0 when the
   * email already moved on, the stored extraction is stale, or no chat is
   * linked (fail-closed: /pending re-sends once a chat exists).
   */
  async sendPredraftAsk(emailId: string): Promise<number> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
    });
    if (!email || email.status !== 'AWAITING_CONFIRM' || !email.extractedJson) {
      this.logger.warn(
        `pre-draft ask skipped for ${emailId}: not awaiting confirm`,
      );
      return 0;
    }
    const parsed = ExtractionSchema.safeParse(email.extractedJson);
    if (!parsed.success) {
      this.logger.warn(
        `pre-draft ask skipped for ${emailId}: stored extraction stale`,
      );
      return 0;
    }
    // Bound to a const so the kind guard below narrows the union.
    const extraction = parsed.data;
    if (
      extraction.kind !== 'INVOICE_REQUEST' &&
      extraction.kind !== 'PAYMENT_REQUEST'
    ) {
      this.logger.warn(
        `pre-draft ask skipped for ${emailId}: stored extraction is not a money request`,
      );
      return 0;
    }
    const chatId = await this.chatForWorkspace(email.workspaceId);
    if (!chatId) {
      this.logger.warn(
        `no linked Telegram chat for workspace ${email.workspaceId}; pre-draft ask held (email ${emailId})`,
      );
      return 0;
    }
    const { text, keyboard } = buildPredraftAsk({
      emailId: email.id,
      kind: extraction.kind,
      from: email.from,
      subject: email.subject,
      payeeName: extraction.payeeName ?? 'Unknown',
      payeeEmail: extraction.payeeEmail ?? null,
      amount: extraction.amount ?? '?',
      currency: extraction.currency ?? 'USD',
      purpose: extraction.purpose ?? '',
      confidence: extraction.confidence,
    });
    const message = await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    this.logger.log(
      `pre-draft ask sent for ${emailId} (message ${message.message_id})`,
    );
    return message.message_id;
  }

  /**
   * "Needs one thing" notice for a NEEDS_REVIEW email with a stored
   * extraction: what was understood + what is missing. The user unblocks it
   * by replying with the PayPal email (or tapping Ignore). Returns the
   * message id, or 0 when there is nothing to say or nowhere to say it.
   */
  async sendReviewNotice(emailId: string): Promise<number> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
    });
    if (
      !email ||
      email.status !== 'NEEDS_REVIEW' ||
      !email.extractedJson ||
      !email.reviewReason
    ) {
      this.logger.warn(
        `review notice skipped for ${emailId}: not a reviewable email`,
      );
      return 0;
    }
    const parsed = ExtractionSchema.safeParse(email.extractedJson);
    if (!parsed.success) {
      this.logger.warn(
        `review notice skipped for ${emailId}: stored extraction stale`,
      );
      return 0;
    }
    // Bound to a const so the kind guard below narrows the union.
    const extraction = parsed.data;
    if (
      extraction.kind !== 'INVOICE_REQUEST' &&
      extraction.kind !== 'PAYMENT_REQUEST'
    ) {
      this.logger.warn(
        `review notice skipped for ${emailId}: stored extraction is not a money request`,
      );
      return 0;
    }
    const chatId = await this.chatForWorkspace(email.workspaceId);
    if (!chatId) {
      this.logger.warn(
        `no linked Telegram chat for workspace ${email.workspaceId}; review notice held (email ${emailId})`,
      );
      return 0;
    }
    const { text, keyboard } = buildReviewNotice({
      emailId: email.id,
      kind: extraction.kind,
      from: email.from,
      subject: email.subject,
      payeeName: extraction.payeeName ?? 'Unknown',
      amount: extraction.amount ?? '?',
      currency: extraction.currency ?? 'USD',
      purpose: extraction.purpose ?? '',
      confidence: extraction.confidence,
      reason: email.reviewReason,
    });
    const message = await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    this.logger.log(
      `review notice sent for ${emailId} (message ${message.message_id})`,
    );
    return message.message_id;
  }

  /**
   * Dead-end notice for an email the extractor could not read: claims no
   * facts, points at the email. Same 0-when-skipped convention.
   */
  async sendUnreadableNotice(emailId: string): Promise<number> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
      select: { id: true, workspaceId: true, status: true, from: true, subject: true },
    });
    if (!email || email.status !== 'NEEDS_REVIEW') {
      this.logger.warn(
        `unreadable notice skipped for ${emailId}: not a review email`,
      );
      return 0;
    }
    const chatId = await this.chatForWorkspace(email.workspaceId);
    if (!chatId) {
      this.logger.warn(
        `no linked Telegram chat for workspace ${email.workspaceId}; unreadable notice held (email ${emailId})`,
      );
      return 0;
    }
    const { text, keyboard } = buildUnreadableNotice({
      emailId: email.id,
      from: email.from,
      subject: email.subject,
    });
    const message = await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    this.logger.log(
      `unreadable notice sent for ${emailId} (message ${message.message_id})`,
    );
    return message.message_id;
  }

  /**
   * Plain follow-up message (execution receipts) to a workspace's chat.
   * Unlinked workspaces get nothing — a lost receipt never becomes a leak.
   */
  async sendMessage(
    text: string,
    workspaceId?: string | null,
  ): Promise<void> {
    const chatId = await this.chatForWorkspace(workspaceId);
    if (!chatId) {
      this.logger.warn(
        `no linked Telegram chat for workspace ${workspaceId}; message skipped`,
      );
      return;
    }
    await this.bot.telegram.sendMessage(chatId, text);
  }

  /** Follow-up for one action — routes via the action's own workspace. */
  async sendActionMessage(actionId: string, text: string): Promise<void> {
    const action = await this.prisma.action.findUnique({
      where: { id: actionId },
      select: { workspaceId: true },
    });
    await this.sendMessage(text, action?.workspaceId);
  }

  /** Follow-up for one batch — routes via the batch's workspace. */
  async sendBatchMessage(batchId: string, text: string): Promise<void> {
    const member = await this.prisma.action.findFirst({
      where: { batchId },
      select: { workspaceId: true },
    });
    await this.sendMessage(text, member?.workspaceId);
  }

  /** Send a generated statement or extracted file to a workspace's chat. */
  async sendDocument(
    buffer: Buffer,
    filename: string,
    caption?: string,
    workspaceId?: string | null,
  ): Promise<void> {
    const chatId = await this.chatForWorkspace(workspaceId);
    if (!chatId) {
      this.logger.warn(
        `no linked Telegram chat for workspace ${workspaceId}; document ${filename} skipped`,
      );
      return;
    }
    await this.bot.telegram.sendDocument(
      chatId,
      { source: buffer, filename },
      caption ? { caption } : undefined,
    );
  }

  /**
   * The batch "parent card": total + EVERY recipient + flags + excluded, with
   * one approve/ignore pair for the whole group. Callback data carries only
   * the batch id. Returns the message id, or 0 when unlinked (fail-closed).
   */
  async sendBatchCard(
    batchId: string,
    excluded: { name: string; reason: string }[] = [],
  ): Promise<number> {
    const members = await this.prisma.action.findMany({
      where: { batchId, status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      include: { contact: true },
    });
    if (members.length === 0) {
      throw new Error(`batch ${batchId} has no pending members`);
    }
    const chatId = await this.chatForWorkspace(members[0].workspaceId);
    if (!chatId) {
      for (const m of members) {
        await this.skipCard(m.id, m.workspaceId, { batchId });
      }
      return 0;
    }
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve batch', `approve-batch:${batchId}`),
        Markup.button.callback('🚫 Ignore', `ignore-batch:${batchId}`),
      ],
    ]).reply_markup;
    const message = await this.bot.telegram.sendMessage(
      chatId,
      this.renderBatchCard(members, excluded, batchId),
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
    for (const m of members) {
      await this.audit.log(m.id, 'CARD_SENT', {
        batchId,
        messageId: message.message_id,
        chatId,
      });
    }
    return message.message_id;
  }

  private renderBatchCard(
    members: Array<{
      payeeName: string;
      payeePaypal: string;
      amount: unknown;
      currency: string;
      purpose: string;
      riskFlags: string[];
      expiresAt: Date;
    }>,
    excluded: { name: string; reason: string }[],
    batchId: string,
    banner?: string,
  ): string {
    const totals = new Map<string, number>();
    for (const m of members) {
      totals.set(m.currency, (totals.get(m.currency) ?? 0) + Number(m.amount));
    }
    const totalLine = [...totals.entries()]
      .map(([cur, sum]) => `${escapeHtml(cur)} ${sum.toFixed(2)}`)
      .join(' + ');
    const soonest = members
      .map((m) => m.expiresAt.getTime())
      .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);

    const lines = [
      banner
        ? `<b>${escapeHtml(banner)}</b>`
        : `💸 <b>Pay ${members.length} team member(s)?</b>`,
      '',
      `<b>Total:</b> ${totalLine}`,
      '',
    ];
    for (const m of members) {
      const flags =
        m.riskFlags.length > 0
          ? ` ⚠️ ${m.riskFlags.map(escapeHtml).join(', ')}`
          : '';
      lines.push(
        `• ${escapeHtml(m.payeeName)} (${escapeHtml(m.payeePaypal)}) — ${escapeHtml(m.currency)} ${Number(m.amount).toFixed(2)}${flags}`,
      );
    }
    for (const e of excluded) {
      lines.push(
        `• <i>excluded: ${escapeHtml(e.name)} — ${escapeHtml(e.reason)}</i>`,
      );
    }
    lines.push(
      '',
      `<b>For:</b> ${escapeHtml(members[0].purpose)}`,
      '',
      `<code>${escapeHtml(batchId)}</code> · ${expiryText(new Date(soonest))}`,
    );
    return lines.join('\n');
  }

  /**
   * Card v2: written for the human deciding, not the engineer debugging.
   * Labels follow the action type ("Bill to" vs "Pay"); internal metrics
   * (confidence, risk) appear only when they need attention; the quote is a
   * sanitized sentence from the exact source email, or omitted. A banner
   * replaces the header once the card reaches a terminal state.
   */
  private renderCard(
    action: {
      id: string;
      type: string;
      payeeName: string;
      payeePaypal: string;
      amount: unknown;
      currency: string;
      purpose: string;
      confidence: number | null;
      riskFlags: string[];
      expiresAt: Date;
      contact: {
        kind: string;
        payCount: number;
        usualAmount: unknown;
        currency: string;
      } | null;
      email: {
        from: string;
        subject: string | null;
        body: string;
        receivedAt: Date;
      } | null;
    },
    banner?: string,
  ): string {
    const isInvoice = action.type === 'INVOICE';
    const money = `${escapeHtml(action.currency)} ${Number(action.amount).toFixed(2)}`;

    const lines = [
      banner
        ? `<b>${escapeHtml(banner)}</b>`
        : isInvoice
          ? `🧾 <b>${escapeHtml(action.payeeName)} asked for an invoice</b>`
          : `💸 <b>Pay ${escapeHtml(action.payeeName)}?</b>`,
      '',
      `<b>${money}</b>`,
      '',
      isInvoice
        ? `<b>Bill to:</b> ${escapeHtml(action.payeePaypal)}`
        : `<b>PayPal:</b> ${escapeHtml(action.payeePaypal)}`,
      `<b>For:</b> ${escapeHtml(action.purpose)}`,
    ];
    const contactLine = this.contactLine(action.type, action.contact);
    if (contactLine) lines.push(contactLine);
    if (action.confidence !== null && action.confidence < 0.8) {
      lines.push(
        `⚠️ <b>Confidence:</b> ${Math.round(action.confidence * 100)}% — double-check the details`,
      );
    }
    if (action.riskFlags.length > 0) {
      lines.push(
        `⚠️ <b>Risk:</b> ${action.riskFlags.map(escapeHtml).join(', ')}`,
      );
    }
    if (action.email) {
      const sender = parseSender(action.email.from).name;
      lines.push(
        '',
        `— ${escapeHtml(sender)} · ${timeAgo(action.email.receivedAt)}`,
      );
      const quote = cleanSnippet(action.email.body);
      if (quote) lines.push(`<i>“${escapeHtml(quote)}”</i>`);
    }
    lines.push(
      '',
      `<code>${escapeHtml(action.id)}</code> · ${expiryText(action.expiresAt)}`,
    );
    return lines.join('\n');
  }

  /**
   * Contact line follows the relationship. Payout history (payCount, usual
   * amounts) is learned from money OUT, so invoice cards don't quote it —
   * "Known client" vs "New — first invoice" is the honest signal there.
   */
  private contactLine(
    type: string,
    contact: {
      kind: string;
      payCount: number;
      usualAmount: unknown;
      currency: string;
    } | null,
  ): string | null {
    if (!contact) return null;
    if (type === 'INVOICE') {
      return contact.payCount > 0
        ? `<b>Client:</b> Known`
        : `<b>Client:</b> New — first invoice`;
    }
    if (contact.payCount === 0) return `<b>Contact:</b> New payee`;
    const kind =
      contact.kind === 'STAFF'
        ? 'staff member'
        : contact.kind === 'SUPPLIER'
          ? 'supplier'
          : 'client';
    const usual = contact.usualAmount
      ? ` · usual ${escapeHtml(contact.currency)} ${Number(contact.usualAmount).toFixed(2)}`
      : '';
    return `<b>Contact:</b> Known ${kind} · ${contact.payCount} payment(s)${usual}`;
  }

  private async cardTarget(
    actionId: string,
  ): Promise<{ chatId: string | number; messageId: number } | null> {
    const sent = await this.prisma.auditLog.findFirst({
      where: { actionId, event: 'CARD_SENT' },
      orderBy: { createdAt: 'desc' },
    });
    const detail = sent?.detail as {
      messageId?: number;
      chatId?: string | number;
    } | null;
    if (
      !detail ||
      typeof detail.messageId !== 'number' ||
      detail.chatId === undefined
    ) {
      return null;
    }
    return { chatId: detail.chatId, messageId: detail.messageId };
  }

  /**
   * Rewrite a sent card in place: terminal banner, buttons removed. Never
   * throws — cards older than Telegram's ~48h edit window simply stay as-is.
   */
  async updateCardStatus(actionId: string, banner: string): Promise<void> {
    try {
      const target = await this.cardTarget(actionId);
      if (!target) return;
      const action = await this.prisma.action.findUnique({
        where: { id: actionId },
        include: { email: true, contact: true },
      });
      if (!action) return;
      await this.bot.telegram.editMessageText(
        target.chatId,
        target.messageId,
        undefined,
        this.renderCard(action, banner),
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        },
      );
    } catch (e) {
      this.logger.warn(
        `card edit skipped for ${actionId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Batch twin: one message covers all members, so one edit settles it. */
  async updateBatchCardStatus(batchId: string, banner: string): Promise<void> {
    try {
      const members = await this.prisma.action.findMany({
        where: { batchId },
        orderBy: { createdAt: 'asc' },
      });
      if (members.length === 0) return;
      const target = await this.cardTarget(members[0].id);
      if (!target) return;
      await this.bot.telegram.editMessageText(
        target.chatId,
        target.messageId,
        undefined,
        this.renderBatchCard(members, [], batchId, banner),
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        },
      );
    } catch (e) {
      this.logger.warn(
        `batch card edit skipped for ${batchId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
