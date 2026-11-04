/** Typed PayPal error so callers can distinguish 404 (gone) from transient. */
export class PaypalApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaypalApiError';
  }
}
