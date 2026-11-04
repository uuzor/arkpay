#!/usr/bin/env node
// One-time Gmail OAuth helper: exchange a consent grant for a refresh token.
//
// Usage:
//   pnpm gmail:oauth                      # local callback listener (auto-finish)
//   pnpm gmail:oauth -- --exchange <url>  # paste the redirected URL / bare code
//
// Reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REDIRECT_URI from
// process.env or .env, then writes GMAIL_REFRESH_TOKEN (and GMAIL_ADDRESS)
// back into .env. Secrets are never printed — only masked confirmations.

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, '.env');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function loadEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    // Blank `KEY=` lines are placeholders, not values.
    if (v === '') continue;
    out[m[1]] = v;
  }
  return out;
}

function setEnvVar(path, key, value) {
  const text = readFileSync(path, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(text)
    ? text.replace(re, line)
    : `${text.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(path, next, 'utf8');
}

// Non-empty process.env (Replit Secrets) wins; .env fills the gaps.
const injected = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v),
);
const env = { ...loadEnvFile(ENV_PATH), ...injected };

const missing = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'].filter(
  (v) => !env[v],
);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} in .env (or process env).`);
  process.exit(1);
}

let redirect;
try {
  redirect = new URL(
    env.GMAIL_REDIRECT_URI || 'http://localhost:3001/auth/gmail/callback',
  );
} catch {
  console.error('GMAIL_REDIRECT_URI is not a valid URL.');
  process.exit(1);
}

/** Exchange an authorization code, persist the token, return the address. */
async function exchangeCode(rawCode) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      code: rawCode,
      grant_type: 'authorization_code',
      redirect_uri: redirect.toString(),
    }),
  });
  const body = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`token exchange HTTP ${tokenRes.status}: ${body.slice(0, 500)}`);
  }
  const json = JSON.parse(body);
  if (!json.refresh_token) {
    throw new Error(
      'no refresh_token returned — revoke the app at myaccount.google.com/permissions and retry',
    );
  }

  setEnvVar(ENV_PATH, 'GMAIL_REFRESH_TOKEN', json.refresh_token);
  let address = '';
  if (json.access_token) {
    try {
      const profileRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { Authorization: `Bearer ${json.access_token}` } },
      );
      if (profileRes.ok) {
        address = (await profileRes.json()).emailAddress ?? '';
        if (address) setEnvVar(ENV_PATH, 'GMAIL_ADDRESS', address);
      }
    } catch {
      // Profile is a convenience; the refresh token is already saved.
    }
  }
  return { length: json.refresh_token.length, address };
}

// --- manual mode: exchange a pasted redirect URL or bare code ---
const argv = process.argv.slice(2);
const exIdx = argv.indexOf('--exchange');
if (exIdx !== -1) {
  const raw = argv[exIdx + 1];
  if (!raw) {
    console.error('Usage: pnpm gmail:oauth -- --exchange <redirect-url-or-code>');
    process.exit(2);
  }
  let code = raw;
  try {
    const u = new URL(raw);
    code = u.searchParams.get('code') ?? raw;
  } catch {
    // Not a URL — assume it is the bare code.
  }
  try {
    const { length, address } = await exchangeCode(code);
    console.log(
      `Saved GMAIL_REFRESH_TOKEN to .env (${length} chars)${address ? ` for ${address}` : ''}.`,
    );
    process.exit(0);
  } catch (e) {
    console.error(`Exchange failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

// --- local callback mode ---
if (redirect.hostname !== 'localhost' && redirect.hostname !== '127.0.0.1') {
  console.error(
    `GMAIL_REDIRECT_URI must point at localhost for callback mode (got ${redirect.hostname}).`,
  );
  console.error('Use --exchange <redirect-url> with a public redirect instead.');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', env.GMAIL_CLIENT_ID);
authUrl.searchParams.set('redirect_uri', redirect.toString());
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // forces a refresh_token even on re-consent
authUrl.searchParams.set('include_granted_scopes', 'true');
authUrl.searchParams.set('state', state);

const port = Number(redirect.port || 80);
const callbackPath = redirect.pathname;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname !== callbackPath) {
    res.writeHead(404).end('Not found');
    return;
  }
  const reply = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem;max-width:40rem">${message}</body>`,
    );
  };

  if (url.searchParams.get('error')) {
    reply(
      400,
      `<h2>Authorization denied</h2><p>${url.searchParams.get('error')}</p>`,
    );
    server.close(() => process.exit(1));
    return;
  }
  if (url.searchParams.get('state') !== state) {
    reply(400, '<h2>State mismatch</h2><p>Restart the helper and try again.</p>');
    server.close(() => process.exit(1));
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    reply(400, '<h2>No code returned</h2>');
    server.close(() => process.exit(1));
    return;
  }

  try {
    const { length, address } = await exchangeCode(code);
    reply(
      200,
      `<h2>Gmail connected</h2><p>Refresh token saved to <code>.env</code>${address ? ` for <b>${address}</b>` : ''}. You can close this tab.</p>`,
    );
    console.log(
      `Saved GMAIL_REFRESH_TOKEN to .env (${length} chars)${address ? ` for ${address}` : ''}.`,
    );
    server.close(() => process.exit(0));
  } catch (e) {
    reply(
      500,
      `<h2>Exchange failed</h2><pre>${String(e).slice(0, 300)}</pre>`,
    );
    console.error(`Exchange failed: ${e instanceof Error ? e.message : e}`);
    server.close(() => process.exit(1));
  }
});

server.on('error', (e) => {
  console.error(`Could not listen on ${redirect.host}:${port} — ${e.message}`);
  console.error(
    'Stop whatever is using that port or use --exchange <redirect-url>.',
  );
  process.exit(1);
});

server.listen(port, redirect.hostname, () => {
  console.log('Open this URL and approve read-only Gmail access:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting for the callback on ${redirect.toString()} ...`);
});
