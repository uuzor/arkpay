// Phase-1 spike: create + send one sandbox invoice through our own services.
// Run: pnpm --filter @arkpay/api spike:invoice -- --to <sandbox-buyer-email> [--amount 1.00] [--workspace owner]
// Re-send an existing invoice (idempotency check): spike:invoice -- --invoice <id>
// Verify: the invoice appears in the PayPal sandbox dashboard.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OWNER_WORKSPACE_ID } from './auth/tenant.constants';
import { PaypalInvoicesService } from './paypal/paypal-invoices.service';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

async function main() {
  const to = arg('to');
  const existing = arg('invoice');
  if (!to && !existing) {
    console.error(
      'Usage: spike:invoice -- --to <sandbox-buyer-email> [--amount 1.00]\n' +
        '       spike:invoice -- --invoice <invoice-id>   # idempotent resend',
    );
    process.exit(2);
  }
  const amount = arg('amount', '1.00') as string;
  const workspace = arg('workspace', OWNER_WORKSPACE_ID) as string;
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const invoices = app.get(PaypalInvoicesService);
    if (existing) {
      // Send again: PayPal returns 422 INVOICE_ALREADY_SENT, which the service
      // treats as success. Proves the retry path never fails a sent invoice.
      await invoices.sendInvoice(existing, workspace);
      console.log(`resent (idempotent): id=${existing} — no duplicate send`);
      return;
    }
    if (!to) throw new Error('missing --to recipient');
    const draft = await invoices.createDraftInvoice(
      {
        recipientEmail: to,
        currency: 'USD',
        note: 'ArkPay Phase-1 sandbox spike',
        items: [{ name: 'Spike line item', quantity: 1, unitAmount: amount }],
      },
      workspace,
    );
    console.log(`draft created: id=${draft.id} status=${draft.status}`);
    await invoices.sendInvoice(draft.id, workspace);
    console.log(
      `sent: id=${draft.id} — confirm in the sandbox dashboard (recipient: ${to})`,
    );
  } finally {
    // The bot is never launched in one-shot CLI contexts (launchOptions:
    // false), but nestjs-telegraf's shutdown hook calls bot.stop() anyway
    // and telegraf throws "Bot is not running!". That is shutdown noise —
    // swallow it, but never over a real failure from the body above.
    try {
      await app.close();
    } catch (closeErr) {
      const msg = closeErr instanceof Error ? closeErr.message : String(closeErr);
      if (/Bot is not running/i.test(msg)) {
        console.log(`(ignored shutdown noise: ${msg})`);
      } else {
        throw closeErr;
      }
    }
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`spike failed: ${msg}`);
  process.exit(1);
});
