/**
 * Pure pre-draft-confirm helpers: the "should I draft this?" Telegram ask
 * sent for email money requests before any draft exists. No Nest imports —
 * unit-tested via `pnpm --filter @arkpay/api test:predraft`.
 */

export type PredraftVerb = 'draft-yes' | 'draft-no';

export function predraftCallback(verb: PredraftVerb, emailId: string): string {
  return `${verb}:${emailId}`;
}

export function reviewCallback(emailId: string): string {
  return `review-no:${emailId}`;
}

export interface PredraftAskData {
  emailId: string;
  kind: 'INVOICE_REQUEST' | 'PAYMENT_REQUEST';
  from: string;
  subject: string | null;
  payeeName: string;
  payeeEmail: string | null;
  amount: string;
  currency: string;
  purpose: string;
  confidence: number;
}

export interface PredraftAsk {
  text: string;
  keyboard: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
}

export interface ReviewNoticeData {
  emailId: string;
  kind: 'INVOICE_REQUEST' | 'PAYMENT_REQUEST';
  from: string;
  subject: string | null;
  payeeName: string;
  amount: string;
  currency: string;
  purpose: string;
  confidence: number;
  /** Display-ready reason the email stopped, e.g. what is missing. */
  reason: string;
}

export interface UnreadableNoticeData {
  emailId: string;
  from: string;
  subject: string | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Renders the pre-draft ask (Telegram HTML). All email-derived text is
 * escaped: the extraction came from a stranger's email, so it is untrusted
 * input even though it passed schema validation.
 */
export function buildPredraftAsk(data: PredraftAskData): PredraftAsk {
  const money = `${data.currency} ${data.amount}`;
  const who = data.payeeEmail
    ? `${data.payeeName} (${data.payeeEmail})`
    : data.payeeName;
  const action =
    data.kind === 'INVOICE_REQUEST'
      ? `🧾 Invoice: send ${money} to ${who} for ${data.purpose}`
      : `💸 Payment: pay ${money} to ${who} for ${data.purpose}`;
  const subject = data.subject
    ? `“${data.subject.slice(0, 120)}”`
    : '(no subject)';
  const confidence = `${Math.round(data.confidence * 100)}%`;
  const text = [
    '📨 <b>Money request by email</b>',
    `From: ${escapeHtml(data.from.slice(0, 160))} — ${escapeHtml(subject)}`,
    '',
    escapeHtml(action),
    `<i>Understood with ${confidence} confidence. Nothing is drafted yet.</i>`,
    '',
    'Should I draft this? The draft will still come back as an approval card.',
  ].join('\n');
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          {
            text: '✅ Yes, draft it',
            callback_data: predraftCallback('draft-yes', data.emailId),
          },
        ],
        [
          {
            text: '🚫 Ignore',
            callback_data: predraftCallback('draft-no', data.emailId),
          },
        ],
      ],
    },
  };
}

function ignoreKeyboard(emailId: string): PredraftAsk['keyboard'] {
  return {
    inline_keyboard: [
      [
        {
          text: '🚫 Ignore',
          callback_data: reviewCallback(emailId),
        },
      ],
    ],
  };
}

/**
 * "Needs one thing" notice for a NEEDS_REVIEW money email: what was
 * understood, what is missing, and how to unblock it (reply with the
 * PayPal email). All email-derived text is escaped.
 */
export function buildReviewNotice(data: ReviewNoticeData): PredraftAsk {
  const money = `${data.currency} ${data.amount}`;
  const what =
    data.kind === 'INVOICE_REQUEST'
      ? `🧾 Invoice: send ${money} to ${data.payeeName} for ${data.purpose}`
      : `💸 Payment: pay ${money} to ${data.payeeName} for ${data.purpose}`;
  const subject = data.subject
    ? `“${data.subject.slice(0, 120)}”`
    : '(no subject)';
  const confidence = `${Math.round(data.confidence * 100)}%`;
  const text = [
    '📨 <b>Money request needs one thing</b>',
    `From: ${escapeHtml(data.from.slice(0, 160))} — ${escapeHtml(subject)}`,
    '',
    escapeHtml(what),
    `<b>Missing:</b> ${escapeHtml(data.reason)}`,
    `<i>Understood with ${confidence} confidence. Reply with the PayPal email to continue, or ignore.</i>`,
  ].join('\n');
  return { text, keyboard: ignoreKeyboard(data.emailId) };
}

/**
 * Dead-end notice for an email the extractor could not read at all: no
 * facts are claimed, and the user is pointed at the email itself.
 */
export function buildUnreadableNotice(data: UnreadableNoticeData): PredraftAsk {
  const subject = data.subject
    ? `“${data.subject.slice(0, 120)}”`
    : '(no subject)';
  const text = [
    "📨 <b>Money email I couldn't read</b>",
    `From: ${escapeHtml(data.from.slice(0, 160))} — ${escapeHtml(subject)}`,
    '',
    "I couldn't confidently extract this one, so I did nothing. Open the email, then tell me what to do — or ignore.",
  ].join('\n');
  return { text, keyboard: ignoreKeyboard(data.emailId) };
}
