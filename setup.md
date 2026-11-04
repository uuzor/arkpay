# ArkPay setup (Day 1)

Prereqs: Node 20+, pnpm, Docker.

## 1. Workspace

```bash
mkdir arkpay && cd arkpay
git init
pnpm init
printf "packages:\n  - 'apps/*'\n" > pnpm-workspace.yaml
mkdir apps

# API: pin Nest 10 so nestjs-telegraf peer deps match
pnpm dlx @nestjs/cli@10 new apps/api -p pnpm --skip-git

# Web
pnpm create next-app@latest apps/web --ts --app --tailwind --eslint --use-pnpm --no-src-dir --import-alias "@/*"
```

Add an MIT `LICENSE` file at the repo root now (hackathon requirement).

## 2. Database (Postgres + Prisma)

Copy `docker-compose.yml` to the repo root, then:

```bash
docker compose up -d

cd apps/api
pnpm add @prisma/client@6
pnpm add -D prisma@6
pnpm prisma init --datasource-provider postgresql
# replace prisma/schema.prisma with the one provided
```

`apps/api/.env`:

```
DATABASE_URL="postgresql://arkpay:arkpay@localhost:5432/arkpay"
```

```bash
pnpm prisma migrate dev --name init
```

(Pinned to Prisma 6 because Prisma 7 changed the generator and config setup. Upgrade later if you want.)

## 3. API dependencies

```bash
cd apps/api
pnpm add @nestjs/config zod telegraf nestjs-telegraf @paypal/agent-toolkit googleapis
```

Check `pnpm why @nestjs/core` shows 10.x before adding nestjs-telegraf.

## 4. Suggested module layout (apps/api/src)

```
llm/          LlmProvider interface + OpenAI-compatible provider (extract only, no tools)
ingest/       Gmail polling, stores raw Email rows
safety/       Payment Safety Engine (pure, deterministic, unit-tested)
approvals/    action hashing, single-use approvals, expiry
telegram/     bot, cards, callbacks
paypal/       execution service: invoices (toolkit fn calls), payouts (REST), webhooks
contacts/     contacts book
audit/        append-only audit writer
```

Rule: only `paypal/` ever sees PayPal credentials, and nothing from `paypal/` is exposed to the LLM.

## 5. LlmProvider sketch

```ts
export interface ExtractionResult {
  kind: 'PAYMENT_REQUEST' | 'INVOICE_REQUEST' | 'NOISE';
  payeeName?: string; payeeEmail?: string;
  amount?: string; currency?: string;
  purpose?: string; dueDate?: string;
  injectionSignals: string[];
  confidence: number;
}

export interface LlmProvider {
  extract(emailText: string): Promise<ExtractionResult>; // validate with zod after
}
```

## 6. Day 1 done-when

Create one sandbox invoice from a script in `apps/api` and see it in the PayPal sandbox dashboard. Commit.