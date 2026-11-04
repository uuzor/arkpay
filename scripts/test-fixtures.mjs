#!/usr/bin/env node
// ArkPay Phase 3 gate: extraction fixture suite.
// Usage: pnpm --filter @arkpay/api test:fixtures   (builds first, then runs this)
// Exit 0 = score >= 90% (18/20). Anything else fails with per-fixture diffs.
//
// Zero new dependencies: imports the COMPILED provider, schema, formatter, and
// fixtures from apps/api/dist, so the gate exercises the real shipped code.
// Each fixture makes one live LLM call (plus at most one provider retry).
// Secrets are never printed — only names, statuses, and extraction diffs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'api', 'dist', 'llm');

const PASS_NEEDED = 18;

// --- minimal .env parse (same precedence as test-connections.mjs) ---
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
    if (v === '') continue;
    out[m[1]] = v;
  }
  return out;
}

const env = {
  ...loadEnvFile(join(ROOT, '.env')),
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)),
};
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

// --- comparison helpers ---
const norm = (v) =>
  v == null ? null : String(v).trim().replace(/\s+/g, ' ').toLowerCase();
const numEq = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.005;
};
const FIELD_EQ = {
  kind: (a, b) => a === b,
  payeeName: (a, b) => norm(a) === norm(b),
  payeeEmail: (a, b) => norm(a) === norm(b),
  amount: numEq,
  currency: (a, b) => norm(a) === norm(b),
  purpose: (a, b) => norm(a) === norm(b),
  dueDate: (a, b) => (a ?? null) === (b ?? null),
};

async function main() {
  for (const f of ['fixtures.js', 'openai-compatible.provider.js']) {
    if (!existsSync(join(DIST, f))) {
      console.error(
        `Missing ${join(DIST, f)} — run "pnpm --filter @arkpay/api build" first (test:fixtures does this).`,
      );
      process.exit(2);
    }
  }
  const { FIXTURES } = await import(
    pathToFileURL(join(DIST, 'fixtures.js')).href
  );
  const { OpenAiCompatibleProvider } = await import(
    pathToFileURL(join(DIST, 'openai-compatible.provider.js')).href
  );
  const { ExtractionSchema } = await import(
    pathToFileURL(join(DIST, 'extraction.schema.js')).href
  );
  const { formatEmailForExtraction } = await import(
    pathToFileURL(join(DIST, 'llm.provider.js')).href
  );

  // Minimal ConfigService stand-in: the provider only calls config.get(key).
  const config = { get: (key, def) => process.env[key] ?? def };
  const provider = new OpenAiCompatibleProvider(config);

  let passed = 0;
  for (const fx of FIXTURES) {
    const diffs = [];
    let actual = null;
    try {
      const text = formatEmailForExtraction(
        { from: fx.from, subject: fx.subject },
        fx.body,
      );
      actual = await provider.extract(text);
      // Belt-and-braces: the provider validates internally; re-validating here
      // proves the schema itself accepts what the runner scored.
      ExtractionSchema.parse(actual);
    } catch (e) {
      diffs.push(`extraction failed: ${e instanceof Error ? e.message : e}`);
    }
    if (actual) {
      for (const [field, eq] of Object.entries(FIELD_EQ)) {
        if (!eq(actual[field], fx.expected[field])) {
          diffs.push(
            `${field}: expected ${JSON.stringify(fx.expected[field])}, got ${JSON.stringify(actual[field])}`,
          );
        }
      }
      const gotSignals = (actual.injectionSignals ?? []).map((s) =>
        String(s).toUpperCase(),
      );
      for (const want of fx.expectSignals ?? []) {
        if (!gotSignals.includes(String(want).toUpperCase())) {
          diffs.push(
            `injectionSignals: missing "${want}" (got [${gotSignals.join(', ')}])`,
          );
        }
      }
      if (fx.expectSignals?.length === 0 && gotSignals.length > 0) {
        diffs.push(
          `injectionSignals: expected none, got [${gotSignals.join(', ')}]`,
        );
      }
    }
    if (diffs.length === 0) {
      passed += 1;
      console.log(`[PASS] ${fx.id} (${actual.kind}, conf=${actual.confidence})`);
    } else {
      console.log(`[FAIL] ${fx.id}`);
      for (const d of diffs) console.log(`       ${d}`);
    }
  }

  console.log(`\nScore: ${passed}/${FIXTURES.length} (need >= ${PASS_NEEDED})`);
  process.exit(passed >= PASS_NEEDED ? 0 : 1);
}

main().catch((e) => {
  console.error(`runner crashed: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
