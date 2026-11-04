#!/usr/bin/env node
/**
 * Stage the legacy .env Gmail mailbox onto the owner workspace so the
 * per-workspace poller (10c) syncs it from stored credentials. Probes the
 * refresh token first (getProfile) so a dead token never stages.
 * Idempotent — re-running overwrites. Prints no secrets.
 *
 * Run: pnpm --filter @arkpay/api owner:connect-gmail
 */
const { PrismaService } = require('../apps/api/dist/prisma/prisma.service');
const {
  GmailAuthService,
} = require('../apps/api/dist/ingest/gmail-auth.service');
const {
  GmailClientService,
} = require('../apps/api/dist/ingest/gmail-client.service');
const {
  OWNER_WORKSPACE_ID,
} = require('../apps/api/dist/auth/tenant.constants');

(async () => {
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN ?? '').trim();
  if (!refreshToken) {
    console.error('GMAIL_REFRESH_TOKEN is not set — nothing staged');
    process.exit(1);
  }
  // Structural ConfigService: the auth service only calls .get().
  const config = { get: (key) => process.env[key] };
  const client = new GmailClientService(new GmailAuthService(config));
  const profile = await client.getProfile({
    refreshToken,
    cacheKey: 'stage-gmail',
  });
  console.log(`probe ok: ${profile.emailAddress}`);

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
        gmailRefreshToken: refreshToken,
        gmailAddress: profile.emailAddress,
      },
    });
    console.log(
      `staged gmail on ${OWNER_WORKSPACE_ID}: ${profile.emailAddress}`,
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(`stage failed: ${e.message}`);
  process.exit(1);
});
