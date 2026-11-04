import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WorkspacesService } from '../auth/workspaces.service';

// Sandbox base URL verified against PayPal's REST authentication docs.
const BASE_URLS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

type PaypalMode = keyof typeof BASE_URLS;

/** Token + endpoint for one PayPal app. */
export interface PaypalContext {
  token: string;
  baseUrl: string;
}

interface PaypalCredentials {
  clientId: string;
  clientSecret: string;
  mode: PaypalMode;
}

/**
 * Per-workspace PayPal credentials. Every caller passes the executing
 * workspace; unconnected workspaces fail closed — there is no shared app.
 */
@Injectable()
export class PaypalAuthService {
  private readonly logger = new Logger(PaypalAuthService.name);
  private cached = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly workspaces: WorkspacesService) {}

  /**
   * OAuth client-credentials token + endpoint, cached until just before
   * expiry. One retry on transient failures; a genuinely unconnected
   * workspace fails immediately instead of being retried.
   */
  async context(workspaceId: string): Promise<PaypalContext> {
    try {
      return await this.contextOnce(workspaceId);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      await new Promise((r) => setTimeout(r, 700));
      return this.contextOnce(workspaceId);
    }
  }

  private async contextOnce(workspaceId: string): Promise<PaypalContext> {
    const creds = await this.resolveCredentials(workspaceId);
    const baseUrl = BASE_URLS[creds.mode];
    const hit = this.cached.get(workspaceId);
    if (hit && hit.expiresAt > Date.now()) {
      return { token: hit.token, baseUrl };
    }
    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `PayPal OAuth failed: HTTP ${res.status} ${body.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    // 60s skew so we never hand out a token that dies mid-request.
    const entry = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    this.cached.set(workspaceId, entry);
    this.logger.log('PayPal access token refreshed');
    return { token: entry.token, baseUrl };
  }

  private async resolveCredentials(
    workspaceId: string,
  ): Promise<PaypalCredentials> {
    try {
      return await this.workspaces.paypalCredentials(workspaceId);
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw new BadRequestException(
          `${e.message} — add credentials under Settings → PayPal`,
        );
      }
      throw new Error(
        `PayPal credential lookup failed (${e instanceof Error ? e.message : String(e)}); please try again`,
      );
    }
  }
}
