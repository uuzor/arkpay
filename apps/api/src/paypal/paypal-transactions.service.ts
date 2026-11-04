import { Injectable, Logger } from '@nestjs/common';
import { PaypalAuthService } from './paypal-auth.service';

export interface TransactionRow {
  id: string;
  date: string;
  type: string;
  status: string;
  email: string;
  name: string;
  gross: string;
  fee: string;
  currency: string;
}

export interface TransactionSearchResult {
  available: boolean;
  reason?: string;
  start?: string;
  end?: string;
  windows?: number;
  total?: number;
  truncated?: boolean;
  totals?: Record<string, string>;
  rows?: TransactionRow[];
}

const WINDOW_MS = 31 * 86_400_000;
const PAGE_SIZE = 100;
const MAX_ROWS = 500;
const MAX_WINDOWS = 40; // ~3.4 years; beyond that, narrow the range
const MAX_RANGE_MS = 3 * 366 * 86_400_000;

/**
 * PayPal transaction search without the 31-day ceiling: splits any range
 * into monthly API windows, pages each one, and merges the rows. "How did
 * Q3 look" becomes three windows behind one call.
 */
@Injectable()
export class PaypalTransactionsService {
  private readonly logger = new Logger(PaypalTransactionsService.name);

  constructor(private readonly auth: PaypalAuthService) {}

  async searchAll(
    startInput: string,
    endInput: string,
    workspaceId: string,
    query?: string,
    limit = 100,
  ): Promise<TransactionSearchResult> {
    const start = this.parseDay(startInput, 'startDate');
    const end = this.parseDay(endInput, 'endDate');
    if (start.getTime() > end.getTime()) {
      throw new Error('startDate must be on or before endDate (YYYY-MM-DD)');
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      throw new Error('range too wide — max 3 years per search');
    }
    const cap = Math.min(Math.max(limit || 100, 1), MAX_ROWS);

    // Build ≤31-day windows covering [start, end-of-end-day].
    const endMs = end.getTime() + 86_400_000 - 1;
    const windows: Array<{ from: string; to: string }> = [];
    for (
      let cursor = start.getTime();
      cursor <= endMs && windows.length < MAX_WINDOWS;
      cursor += WINDOW_MS
    ) {
      windows.push({
        from: new Date(cursor).toISOString(),
        to: new Date(Math.min(cursor + WINDOW_MS - 1, endMs)).toISOString(),
      });
    }

    const merged: TransactionRow[] = [];
    for (const w of windows) {
      const rows = await this.searchWindow(w.from, w.to, workspaceId);
      if (rows === null) {
        return {
          available: false,
          reason:
            'PayPal denied the transaction read (reporting scope missing on the REST app)',
        };
      }
      merged.push(...rows);
    }
    merged.sort((a, b) => a.date.localeCompare(b.date));

    const q = query?.trim().toLowerCase();
    const filtered = q
      ? merged.filter((r) =>
          `${r.email} ${r.name} ${r.id} ${r.type}`.toLowerCase().includes(q),
        )
      : merged;

    // Per-currency gross totals over the FULL set, so "how did Q3 look"
    // answers even when rows are capped.
    const totals: Record<string, string> = {};
    for (const r of filtered) {
      if (!r.currency || !r.gross) continue;
      totals[r.currency] = (
        Number(totals[r.currency] ?? 0) + Number(r.gross)
      ).toFixed(2);
    }

    return {
      available: true,
      start: startInput,
      end: endInput,
      windows: windows.length,
      total: filtered.length,
      truncated: filtered.length > cap,
      totals,
      rows: filtered.slice(0, cap),
    };
  }

  private parseDay(input: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test((input ?? '').trim())) {
      throw new Error(`${field} must be YYYY-MM-DD`);
    }
    const d = new Date(`${input.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`${field} is not a date`);
    return d;
  }

  /**
   * One ≤31-day window with full pagination. Returns null on 403
   * (reporting scope missing) so callers report it honestly.
   */
  private async searchWindow(
    from: string,
    to: string,
    workspaceId: string,
  ): Promise<TransactionRow[] | null> {
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const rows: TransactionRow[] = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const url = new URL(`${baseUrl}/v1/reporting/transactions`);
      url.searchParams.set('start_date', from);
      url.searchParams.set('end_date', to);
      url.searchParams.set('fields', 'all');
      url.searchParams.set('page_size', String(PAGE_SIZE));
      url.searchParams.set('page', String(page));
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        this.logger.warn(
          'PayPal transaction read denied (reporting scope missing)',
        );
        return null;
      }
      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `PayPal transaction search failed: HTTP ${res.status} ${text.slice(0, 300)}`,
        );
      }
      const json = JSON.parse(text) as {
        transaction_details?: unknown[];
        total_pages?: number;
      };
      const details = json.transaction_details ?? [];
      for (const d of details) rows.push(this.mapRow(d));
      const totalPages = json.total_pages ?? 1;
      if (page >= totalPages || details.length === 0) break;
      page += 1;
    }
    return rows;
  }

  private mapRow(d: any): TransactionRow {
    const info = d?.transaction_info ?? {};
    const payer = d?.payer_info ?? {};
    const payee = d?.payee_info ?? {};
    const amt = info.transaction_amount ?? {};
    const fee = info.fee_amount ?? {};
    const payerName = [payer?.payer_name?.given_name, payer?.payer_name?.surname]
      .filter(Boolean)
      .join(' ');
    const payeeName = [payee?.payee_name?.given_name, payee?.payee_name?.surname]
      .filter(Boolean)
      .join(' ');
    return {
      id: String(info.transaction_id ?? ''),
      date: String(
        info.transaction_initiation_date ?? info.transaction_updated_date ?? '',
      ),
      type: String(info.transaction_event_code ?? ''),
      status: String(info.transaction_status ?? ''),
      email: String(payer?.email_address ?? payee?.email_address ?? ''),
      name: payerName || payeeName,
      gross: String(amt.value ?? ''),
      fee: String(fee.value ?? ''),
      currency: String(amt.currency_code ?? ''),
    };
  }
}
