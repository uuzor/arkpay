/**
 * Shared tenant constants. Pure values only — importable from any module
 * without creating a dependency cycle.
 */

/** Fixed id of the legacy single-tenant workspace (migration backfill). */
export const OWNER_WORKSPACE_ID = 'owner';

/**
 * Fixed id of the shared judge-demo workspace (POST /auth/demo). The id is
 * the policy hook: payout execution and connection edits refuse for this
 * workspace wherever it appears, independent of the DEMO_MODE flag.
 */
export const DEMO_WORKSPACE_ID = 'demo';

/** Stable identity for the demo user row that owns the demo workspace. */
export const DEMO_USER_GOOGLESUB = 'demo-judge';
export const DEMO_USER_EMAIL = 'judge@arkpay.demo';

/** Session cookie name. */
export const SESSION_COOKIE = 'arkpay_session';

/** Session lifetime: 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
