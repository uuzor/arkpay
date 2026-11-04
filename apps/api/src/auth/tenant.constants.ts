/**
 * Shared tenant constants. Pure values only — importable from any module
 * without creating a dependency cycle.
 */

/** Fixed id of the legacy single-tenant workspace (migration backfill). */
export const OWNER_WORKSPACE_ID = 'owner';

/** Session cookie name. */
export const SESSION_COOKIE = 'arkpay_session';

/** Session lifetime: 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
