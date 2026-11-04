#!/usr/bin/env node
// ArkPay Phase 0: verify every external credential before product code runs.
// Usage: node scripts/test-connections.mjs  (or: pnpm test:connections)
// Exit 0 = all probes passed. Anything else names the failing probe + fix hint.
// This script never prints secret values — only names, statuses, and identifiers.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (name, detail) => results.push({ name, status: 'PASS', detail });
const fail = (name, detail, hint) =>
  results.push({ name, status: 'FAIL', detail, hint });

// --- minimal .env parse (zero deps) ---
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
    // A blank `KEY=` is a placeholder, not a value: treat it as unset so it can
    // never shadow a real secret injected via process.env (Replit Secrets).
    if (v === '') continue;
    out[m[1]] = v;
  }
  return out;
}

// Precedence: non-empty process.env wins (Replit Secrets / host env), then the
// .env file fills any gaps. Standard dotenv behaviour, and it means an empty
// `KEY=` line in .env cannot block a value supplied by the environment.
const injected = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v),
);
const env = { ...loadEnvFile(join(ROOT, '.env')), ...injected };
const missing = (vars) => vars.filter((v) => !env[v]);

async function readBody(res, limit = 300) {
  const text = await res.text().catch(() => '');
  return text.slice(0, limit);
}

async function probePayPal() {
  const name = 'PayPal sandbox OAuth + invoices list';
  const miss = missing(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']);
  if (miss.length)
    return fail(
      name,
      `missing ${miss.join(', ')}`,
      'Fill PayPal sandbox REST app credentials in .env (developer.paypal.com → Dashboard → Apps & Credentials → Sandbox).',
    );
  const basic = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
  ).toString('base64');
  let token;
  try {
    const res = await fetch(
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
    );
    if (!res.ok)
      return fail(
        name,
        `OAuth HTTP ${res.status}: ${await readBody(res)}`,
        'Check the id/secret pair and that the app is a SANDBOX app (live creds fail here).',
      );
    const json = await res.json();
    token = json.access_token;
    if (!token) return fail(name, 'OAuth 200 but no access_token in body', 'Unexpected PayPal response — retry, then check API status.');
  } catch (e) {
    return fail(name, `network error: ${e.message}`, 'Check outbound network access to api-m.sandbox.paypal.com.');
  }
  try {
    const res = await fetch(
      'https://api-m.sandbox.paypal.com/v2/invoicing/invoices?page_size=1',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok)
      return fail(
        name,
        `invoices list HTTP ${res.status}: ${await readBody(res)}`,
        'Token works but the invoicing call failed — check the REST app has invoicing features enabled.',
      );
    return ok(name, 'OAuth 200 + access_token, invoices list 200');
  } catch (e) {
    return fail(name, `network error: ${e.message}`, 'Check outbound network access to api-m.sandbox.paypal.com.');
  }
}

async function probeMeta() {
  const name = 'OpenAI-compatible LLM chat completion';
  const miss = missing(['META_MODEL_URL', 'META_MODEL_API_KEY', 'META_MODEL_NAME']);
  if (miss.length)
    return fail(
      name,
      `missing ${miss.join(', ')}`,
      'Fill META_MODEL_URL (e.g. https://api.meta.ai/v1), META_MODEL_API_KEY and META_MODEL_NAME in .env.',
    );
  const base = env.META_MODEL_URL.replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.META_MODEL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      // No max_tokens: the parameter name is unverified for this endpoint and
      // a wrong one could false-fail the probe. Prompt "ok" answers briefly anyway.
      body: JSON.stringify({
        model: env.META_MODEL_NAME,
        messages: [{ role: 'user', content: 'ok' }],
      }),
    });
    // Read the FULL body: truncating before JSON.parse turns valid JSON into a
    // false "non-JSON body" failure. Only slice for error display.
    const text = await res.text().catch(() => '');
    if (!res.ok)
      return fail(
        name,
        `HTTP ${res.status}: ${text.slice(0, 500)}`,
        'Check META_MODEL_URL (base https://api.meta.ai/v1, no double path), key validity, and model id at dev.meta.ai/docs.',
      );
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return fail(
        name,
        `HTTP 200 but non-JSON body: ${text.slice(0, 200)}`,
        'Unexpected endpoint — confirm META_MODEL_URL points at the Model API.',
      );
    }
    const choice =
      json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text;
    if (choice === undefined)
      return fail(
        name,
        'HTTP 200 but no completion choice in body',
        'Confirm the Chat Completions response shape at dev.meta.ai/docs/protocols/chat-completions.',
      );
    return ok(name, `HTTP 200, model "${env.META_MODEL_NAME}" answered`);
  } catch (e) {
    return fail(name, `network error: ${e.message}`, 'Check outbound network access to your META_MODEL_URL host.');
  }
}

async function probeTelegram() {
  const name = 'Telegram bot token (getMe)';
  const miss = missing(['TELEGRAM_BOT_TOKEN']);
  if (miss.length)
    return fail(
      name,
      'missing TELEGRAM_BOT_TOKEN',
      'Paste the @BotFather token into .env.',
    );
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
    );
    // Read the FULL body: slicing before JSON.parse can produce
    // "Unterminated string" on valid JSON. Only slice for error display.
    const text = await res.text().catch(() => '');
    if (!res.ok)
      return fail(
        name,
        `HTTP ${res.status}: ${text.slice(0, 300)}`,
        'Token rejected — re-check the @BotFather token for typos.',
      );
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return fail(
        name,
        `HTTP ${res.status} but non-JSON body: ${text.slice(0, 200)}`,
        'Unexpected response — confirm api.telegram.org is reachable and the token is well-formed.',
      );
    }
    if (!json.ok)
      return fail(name, `ok:false — ${text}`, 'Token rejected — re-check the @BotFather token for typos.');
    return ok(name, `bot @${json.result.username} (id ${json.result.id})`);
  } catch (e) {
    return fail(name, `network error: ${e.message}`, 'Check outbound network access to api.telegram.org.');
  }
}

async function probeGmail() {
  const name = 'Gmail OAuth refresh + profile';
  const miss = missing(['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']);
  if (miss.length)
    return fail(
      name,
      `missing ${miss.join(', ')}`,
      'Fill the Google Cloud OAuth client (testing mode) + refresh token in .env.',
    );
  let access;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID,
        client_secret: env.GMAIL_CLIENT_SECRET,
        refresh_token: env.GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok)
      return fail(
        name,
        `refresh HTTP ${res.status}: ${await readBody(res)}`,
        'Refresh token invalid/expired or OAuth client misconfigured — re-run the OAuth consent flow and update .env.',
      );
    access = (await res.json()).access_token;
    if (!access) return fail(name, 'refresh 200 but no access_token', 'Unexpected Google response — retry.');
  } catch (e) {
    return fail(name, `network error: ${e.message}`, 'Check outbound network access to Google APIs.');
  }
  try {
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${access}` } },
    );
    if (!res.ok)
      return fail(
        name,
        `profile HTTP ${res.status}: ${await readBody(res)}`,
        'Token works but Gmail API call failed — enable the Gmail API on the Cloud project.',
      );
    const json = await res.json();
    return ok(name, `inbox ${json.emailAddress}`);
  } catch (e) {
    return fail(name, `network error: ${e.message}`, 'Check outbound network access to Google APIs.');
  }
}

function probeDb() {
  const name = 'Postgres schema (prisma migrate status)';
  const miss = missing(['DATABASE_URL']);
  if (miss.length)
    return fail(name, 'missing DATABASE_URL', 'Set DATABASE_URL in .env.');
  const proc = spawnSync(
    'pnpm',
    ['--filter', '@arkpay/api', 'exec', 'prisma', 'migrate', 'status'],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
      encoding: 'utf8',
      timeout: 120000,
    },
  );
  if (proc.error)
    return fail(
      name,
      `could not run pnpm: ${proc.error.message}`,
      'Install Node 20 + pnpm 9 and run pnpm install first.',
    );
  const out = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  if (proc.status !== 0 || !out.includes('up to date'))
    return fail(
      name,
      `migrate status failed: ${out.slice(0, 300)}`,
      'Start Postgres (pnpm db:up) and apply migrations (pnpm db:migrate).',
    );
  return ok(name, 'Database schema is up to date');
}

const probes = [probePayPal, probeMeta, probeTelegram, probeGmail, probeDb];

let failed = 0;
for (const probe of probes) {
  // eslint-disable-next-line no-await-in-loop
  await probe();
}
for (const r of results) {
  const mark = r.status === 'PASS' ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${r.name}\n      ${r.detail}`);
  if (r.status !== 'PASS') {
    failed += 1;
    if (r.hint) console.log(`      fix: ${r.hint}`);
  }
}
console.log(
  failed === 0
    ? `\nAll ${results.length} probes passed.`
    : `\n${failed} of ${results.length} probes failed.`,
);
process.exit(failed === 0 ? 0 : 1);
