import type { ExtractionResult } from './extraction.schema';

/**
 * Thrown when the model output cannot be parsed or schema-validated, even
 * after one retry. Callers treat this as "could not read" (NEEDS_REVIEW) —
 * never as an empty result, and never as a reason to guess.
 */
export class LlmExtractionError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string,
    /**
     * True for transport failures (network, timeout, HTTP 4xx/5xx from the
     * provider): the email was never read, so callers must leave it NEW for
     * a later tick — never mark it NEEDS_REVIEW, which would poison the
     * backlog on every provider outage.
     */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmExtractionError';
  }
}

/** The seam: one method, strict output. Providers are swappable behind it. */
export interface LlmProvider {
  extract(emailText: string): Promise<ExtractionResult>;
}

export interface EmailHeaders {
  from: string;
  subject?: string | null;
  date?: string | null;
}

/**
 * Single email→text formatter shared by the service and the fixture runner,
 * so fixtures exercise the exact bytes production sends to the model.
 */
export function formatEmailForExtraction(
  headers: EmailHeaders,
  body: string,
): string {
  const lines = [`From: ${headers.from}`];
  if (headers.subject) lines.push(`Subject: ${headers.subject}`);
  if (headers.date) lines.push(`Date: ${headers.date}`);
  return `${lines.join('\n')}\n\n${body}`;
}
