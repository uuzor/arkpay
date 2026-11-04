import { Injectable } from '@nestjs/common';
import { GmailAuthService, GmailTokenSource } from './gmail-auth.service';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailMessageRef {
  id: string;
  threadId?: string;
}

export interface GmailMessagePart {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

export interface GmailHistoryResponse {
  history?: Array<{
    id?: string;
    messages?: GmailMessageRef[];
    messagesAdded?: Array<{
      message?: GmailMessageRef & { labelIds?: string[] };
    }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

/** Thin REST client over the Gmail v1 API. No SDK, one token source. */
@Injectable()
export class GmailClientService {
  constructor(private readonly auth: GmailAuthService) {}

  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    source: GmailTokenSource,
  ): Promise<T> {
    const token = await this.auth.getAccessToken(source);
    const url = new URL(`${BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new GmailApiError(
        res.status,
        `Gmail ${path} failed: HTTP ${res.status} ${text.slice(0, 400)}`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  getProfile(source: GmailTokenSource): Promise<GmailProfile> {
    return this.request<GmailProfile>('profile', {}, source);
  }

  /** Newest-first inbox listing. Used for the first full sync. */
  listInboxMessageIds(
    limit: number,
    source: GmailTokenSource,
    pageToken?: string,
  ): Promise<{ messages?: GmailMessageRef[]; nextPageToken?: string }> {
    return this.request(
      'messages',
      {
        maxResults: Math.min(Math.max(limit, 1), 500),
        q: 'in:inbox',
        pageToken,
      },
      source,
    );
  }

  getMessage(id: string, source: GmailTokenSource): Promise<GmailMessage> {
    return this.request(
      `messages/${encodeURIComponent(id)}`,
      { format: 'full' },
      source,
    );
  }

  /** Changes since a history cursor. 404/410 means the cursor expired. */
  listHistory(
    startHistoryId: string,
    source: GmailTokenSource,
    pageToken?: string,
  ): Promise<GmailHistoryResponse> {
    return this.request(
      'history',
      {
        startHistoryId,
        historyTypes: 'messageAdded',
        maxResults: 500,
        pageToken,
      },
      source,
    );
  }
}
