#!/usr/bin/env node
/**
 * Stage the legacy .env PayPal app onto the owner workspace so execution
 * resolves credentials from the DB. Writes first, then proves via the
 * strict workspace path — dead creds are wiped back off. Copies
 * PAYPAL_WEBHOOK_ID too when set; that subscription belongs to this app.
 * Idempotent. Prints no secrets.
 *
 * Run: pnpm --filter @arkpay/api owner:connect-paypal
 */
const { PrismaService } = require('../apps/api/dist/prisma/prisma.service');
const {
  PaypalAuthService,
} = require('../apps/api/dist/paypal/paypal-auth.service');
const {
  OWNER_WORKSPACE_ID,
} = require('../apps/api/dist/auth/tenant.constants');

(async () => {
  const clientId = (process.env.PAYPAL_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET ?? '').trim();
  const mode = (process.env.PAYPAL_MODE ?? 'sandbox').trim();
  const webhookId = (process.env.PAYPAL_WEBHOOK_ID ?? '').trim() || null;
  if (!clientId || !clientSecret) {
    console.error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set — nothing staged');
    process.exit(1);
  }
  if (mode !== 'sandbox' && mode !== 'live') {
    console.error(`PAYPAL_MODE must be sandbox or live, got "${mode}"`);
    process.exit(1);
  }
  const prisma = new PrismaService();
  try {
    await prisma.workspace.upsert({
      where: { id: OWNER_WORKSPACE_ID },
      create: { id: OWNER_WORKSPACE_ID, name: 'My workspace' },
      update: {},
    });
    await prisma.workspace.update({
      where: { id: OWNER_WORKSPACE_ID },
      data: {
        paypalClientId: clientId,
        paypalClientSecret: clientSecret,
        paypalMode: mode,
        ...(webhookId ? { paypalWebhookId: webhookId } : {}),
      },
    });
    try {
      const ctx = await new PaypalAuthService(prisma).context(
        OWNER_WORKSPACE_ID,
      );
      console.log(
        `probe ok: ${mode} token acquired (${ctx.token.length} chars)`,
      );
    } catch (e) {
      await prisma.workspace.update({
        where: { id: OWNER_WORKSPACE_ID },
        data: { paypalClientId: null, paypalClientSecret: null },
      });
      throw e;
    }
    console.log(
      `staged paypal on ${OWNER_WORKSPACE_ID}: mode=${mode}` +
        (webhookId ? ` webhook=${webhookId}` : ' (no webhook id)'),
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(`stage failed: ${e.message}`);
  process.exit(1);
});
