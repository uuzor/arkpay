import { Injectable, Logger } from '@nestjs/common';
import { PaypalAuthService } from './paypal-auth.service';

export type PaypalBalanceResult =
  | {
      available: true;
      balances: Array<{
        currency: string;
        available: string | null;
        total: string | null;
        withheld: string | null;
      }>;
    }
  | {
      available: false;
      reason: string;
    };

/**
 * PayPal wallet balances (`/v1/reporting/balances`). This endpoint needs the
 * Reporting / Transaction Search scope on the REST app; without it PayPal
 * returns 403. We report that honestly instead of substituting invoice totals.
 */
@Injectable()
export class PaypalBalancesService {
  private readonly logger = new Logger(PaypalBalancesService.name);

  constructor(private readonly auth: PaypalAuthService) {}

  async getBalances(
    currency = 'USD',
    workspaceId: string,
  ): Promise<PaypalBalanceResult> {
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const url = new URL(`${baseUrl}/v1/reporting/balances`);
    url.searchParams.set('currency_code', currency.toUpperCase());
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (res.status === 403) {
      this.logger.warn(
        'PayPal balance read denied (reporting scope missing on the REST app)',
      );
      return {
        available: false,
        reason:
          'PayPal denied the balance request because the REST app does not have the Reporting/Transaction Search scope. I can show ArkPay invoices, payouts and pending actions instead.',
      };
    }
    if (!res.ok) {
      throw new Error(
        `PayPal balance lookup failed: HTTP ${res.status} ${text.slice(0, 300)}`,
      );
    }
    let body: {
      balances?: Array<{
        currency_code?: string;
        available_balance?: { value?: string; currency_code?: string };
        total_balance?: { value?: string; currency_code?: string };
        withheld_balance?: { value?: string; currency_code?: string };
      }>;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error('PayPal balance lookup returned non-JSON');
    }
    const balances = (body.balances ?? []).map((b) => ({
      currency:
        b.available_balance?.currency_code ??
        b.total_balance?.currency_code ??
        currency.toUpperCase(),
      available: b.available_balance?.value ?? null,
      total: b.total_balance?.value ?? null,
      withheld: b.withheld_balance?.value ?? null,
    }));
    return { available: true, balances };
  }
}
