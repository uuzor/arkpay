import type { GmailMessage, GmailMessagePart } from './gmail-client.service';

/** Cap stored bodies so one huge newsletter can't bloat the row. */
const MAX_BODY_CHARS = 100_000;

export interface ParsedEmail {
  gmailId: string;
  threadId?: string;
  from: string;
  subject: string;
  /** Raw, untrusted text. Never executed — scanned by the Safety Engine later. */
  body: string;
  receivedAt: Date;
}

function header(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | undefined {
  const found = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value;
}

function decodeBase64Url(data: string | undefined): string {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectBody(
  part: GmailMessagePart | undefined,
  out: { text?: string; html?: string },
): void {
  if (!part) return;
  const decoded = decodeBase64Url(part.body?.data);
  if (decoded) {
    if (part.mimeType === 'text/plain' && !out.text) out.text = decoded;
    else if (part.mimeType === 'text/html' && !out.html) out.html = decoded;
  }
  for (const child of part.parts ?? []) collectBody(child, out);
}

/**
 * Gmail message → Email row fields. Prefers text/plain, falls back to a
 * tag-stripped HTML body, then Gmail's snippet. Body is stored raw/untrusted.
 */
export function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const headers = message.payload?.headers;
  const parts: { text?: string; html?: string } = {};
  collectBody(message.payload, parts);

  const text = parts.text ?? (parts.html ? htmlToText(parts.html) : '');
  const body = (text || message.snippet || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_BODY_CHARS);

  const internal = Number(message.internalDate);
  const dateHeader = header(headers, 'date');
  const parsedDate = dateHeader ? new Date(dateHeader) : null;
  const receivedAt =
    Number.isFinite(internal) && internal > 0
      ? new Date(internal)
      : parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate
        : new Date();

  return {
    gmailId: message.id,
    threadId: message.threadId,
    from: header(headers, 'from') ?? '(unknown)',
    subject: header(headers, 'subject') ?? '(no subject)',
    body,
    receivedAt,
  };
}
