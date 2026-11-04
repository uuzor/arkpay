/**
 * Display quoting for approval cards: turn a raw stored email body into one
 * short, clean, relevant sentence. Stored bodies can contain HTML, CSS,
 * boilerplate, and tracking URLs — none of that may reach the card, where
 * the user verifies the action from the quote.
 */

const MONEY_RE = /[$€£₦]\s?[\d,]+|\d[\d,]*\s?(USD|EUR|GBP|NGN)\b/i;

function stripMarkup(text: string): string {
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** A sentence carrying CSS/HTML residue is never quotable. */
function isResidue(sentence: string): boolean {
  return (
    sentence.includes('{') ||
    sentence.includes('}') ||
    /:\s*[a-z-]+\s*;/i.test(sentence) ||
    sentence.includes('!important')
  );
}

function truncateWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars).replace(/\s+\S*$/, '');
  return `${cut || text.slice(0, maxChars)}…`;
}

export function cleanSnippet(body: string, maxChars = 160): string {
  const text = stripMarkup(body).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isResidue(s));
  if (sentences.length === 0) return '';
  // Prefer the sentence carrying the money — it's the one justifying the card.
  const picked =
    sentences.find((s) => MONEY_RE.test(s)) ?? sentences[0] ?? '';
  return truncateWords(picked, maxChars);
}

/** "just now" / "2 min ago" / "3 h ago" / "Nov 2". */
export function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Expires in 14 min" / "Expires in 3 h" / "Expires Nov 5" / "Expired". */
export function expiryText(expiresAt: Date): string {
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `Expires in ${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Expires in ${hours} h`;
  return `Expires ${expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
