/** Parse a raw `From:` header into a display name + lowercased address. */
export interface ParsedSender {
  name: string;
  email: string;
}

export function parseSender(from: string | null | undefined): ParsedSender {
  const raw = (from ?? '').trim();
  const angle = /^(.*?)<\s*([^>\s]+)\s*>\s*$/.exec(raw);
  if (angle) {
    const email = angle[2].trim().toLowerCase();
    const name =
      angle[1].trim().replace(/^"(.*)"$/, '$1').trim() ||
      email.split('@')[0] ||
      email;
    return { name, email };
  }
  const email = raw.toLowerCase();
  // No "@" means this is not an address at all (e.g. the "(unknown)"
  // fallback) — return an empty email so callers never store garbage as a
  // PayPal address. findOrCreateFromSender already maps '' to undefined.
  if (!email.includes('@')) {
    return { name: raw || '(unknown)', email: '' };
  }
  return { name: raw, email };
}
