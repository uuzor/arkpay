import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Gmail OAuth refresh-token flow with an in-memory access-token cache.
 * Only the ingest module reads GMAIL_* credentials.
 */
/**
 * Per-workspace Gmail credentials. `cacheKey` (the workspace id) scopes the
 * in-memory token cache so two connected mailboxes never share a token.
 */
export interface GmailTokenSource {
  refreshToken: string;
  cacheKey: string;
}

@Injectable()
export class GmailAuthService {
  private readonly logger = new Logger(GmailAuthService.name);
  private cached = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  /**
   * @param source the workspace's stored Gmail credentials; required, cached
   *   per workspace. There is no shared mailbox.
   */
  async getAccessToken(source: GmailTokenSource): Promise<string> {
    const hit = this.cached.get(source.cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.token;
    }
    const clientId = this.config.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = source.refreshToken;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN are not set',
      );
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Gmail OAuth refresh failed: HTTP ${res.status} ${text.slice(0, 300)}` +
          ' — if this is invalid_grant, re-run: pnpm gmail:oauth',
      );
    }
    const json = JSON.parse(text) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) {
      throw new Error('Gmail OAuth refresh returned no access_token');
    }
    // 60s skew so a token cannot expire mid-request.
    const entry = {
      token: json.access_token,
      expiresAt: Date.now() + Math.max(30, (json.expires_in ?? 3600) - 60) * 1000,
    };
    this.cached.set(source.cacheKey, entry);
    this.logger.log('Gmail access token refreshed');
    return entry.token;
  }

  invalidate(cacheKey?: string): void {
    if (cacheKey === undefined) this.cached.clear();
    else this.cached.delete(cacheKey);
  }
}
