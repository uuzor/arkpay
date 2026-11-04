import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL_PROFILE_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/profile';

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Google OAuth 2.0 code flow over raw fetch (no SDK): sign-in uses
 * openid/email/profile, while Gmail connect is a separate flow with the
 * readonly Gmail scope + offline access so each workspace keeps its own
 * refresh token. CSRF `state` is HMAC-signed and stateless — no storage.
 */
@Injectable()
export class GoogleAuthService {
  constructor(private readonly config: ConfigService) {}

  private clientId(): string {
    const id =
      this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() ||
      this.config.get<string>('GMAIL_CLIENT_ID')?.trim();
    if (!id) {
      throw new Error('GOOGLE_CLIENT_ID (or GMAIL_CLIENT_ID) is not set');
    }
    return id;
  }

  private clientSecret(): string {
    const secret =
      this.config.get<string>('GOOGLE_CLIENT_SECRET')?.trim() ||
      this.config.get<string>('GMAIL_CLIENT_SECRET')?.trim();
    if (!secret) {
      throw new Error(
        'GOOGLE_CLIENT_SECRET (or GMAIL_CLIENT_SECRET) is not set',
      );
    }
    return secret;
  }

  private sessionSecret(): string {
    const secret = this.config.get<string>('SESSION_SECRET')?.trim();
    if (!secret) throw new Error('SESSION_SECRET is not set');
    return secret;
  }

  webAppUrl(): string {
    return (
      this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  redirectUri(kind: 'login' | 'gmail'): string {
    const override = (
      kind === 'login'
        ? this.config.get<string>('GOOGLE_REDIRECT_URI')
        : this.config.get<string>('GOOGLE_GMAIL_REDIRECT_URI')
    )?.trim();
    if (override) return override;
    const port = process.env.API_PORT ?? 3001;
    const base = (
      this.config.get<string>('API_PUBLIC_URL') ?? `http://localhost:${port}`
    ).replace(/\/+$/, '');
    return `${base}/auth/${kind === 'login' ? 'google/callback' : 'gmail/callback'}`;
  }

  /** `purpose:workspace:random.signature` — the workspace binding is signed. */
  signState(purpose: 'login' | 'gmail', workspaceId = '-'): string {
    const random = randomBytes(16).toString('hex');
    const payload = `${purpose}:${workspaceId}:${random}`;
    const sig = createHmac('sha256', this.sessionSecret())
      .update(payload)
      .digest('hex');
    return `${payload}.${sig}`;
  }

  verifyState(
    state: string,
    purpose: 'login' | 'gmail',
  ): { workspaceId: string } {
    const dot = state.lastIndexOf('.');
    if (dot < 0) throw new Error('bad state');
    const payload = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = createHmac('sha256', this.sessionSecret())
      .update(payload)
      .digest('hex');
    const actual = Buffer.from(sig, 'hex');
    const wanted = Buffer.from(expected, 'hex');
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      throw new Error('bad state');
    }
    const [found, workspaceId] = payload.split(':');
    if (found !== purpose || !workspaceId) throw new Error('bad state');
    return { workspaceId };
  }

  loginUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri('login'),
      response_type: 'code',
      scope: 'openid email profile',
      state: this.signState('login'),
    });
    return `${AUTH_URL}?${params}`;
  }

  gmailConnectUrl(workspaceId: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri('gmail'),
      response_type: 'code',
      scope:
        'openid email profile https://www.googleapis.com/auth/gmail.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state: this.signState('gmail', workspaceId),
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(
    code: string,
    kind: 'login' | 'gmail',
  ): Promise<{ accessToken: string; refreshToken?: string }> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: this.redirectUri(kind),
        grant_type: 'authorization_code',
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Google token exchange failed: HTTP ${res.status}`);
    }
    const json = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!json.access_token) {
      throw new Error('Google token exchange returned no access_token');
    }
    return { accessToken: json.access_token, refreshToken: json.refresh_token };
  }

  async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Google userinfo failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!json.sub || !json.email) {
      throw new Error('Google userinfo returned no sub/email');
    }
    return {
      sub: json.sub,
      email: json.email,
      name: json.name,
      picture: json.picture,
    };
  }

  async fetchGmailAddress(accessToken: string): Promise<string> {
    const res = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail profile failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { emailAddress?: string };
    if (!json.emailAddress) {
      throw new Error('Gmail profile returned no emailAddress');
    }
    return json.emailAddress;
  }
}
