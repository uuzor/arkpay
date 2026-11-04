import { z } from 'zod';

/**
 * What the model may propose — and nothing else. Code validates every field
 * here before anything downstream trusts it (idea.md §6: validate in code,
 * not in the prompt). Empty strings are coerced to null so "not stated" and
 * "stated empty" behave identically.
 */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullish(),
  );

export const ExtractionSchema = z
  .object({
    kind: z.enum(['PAYMENT_REQUEST', 'INVOICE_REQUEST', 'NOISE']),
    payeeName: optionalText(200),
    payeeEmail: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().email().max(320).nullish(),
    ),
    // Plain decimal string, e.g. "450.00". The preprocess tolerates a numeric
    // JSON value and strips thousand separators / stray symbols ("1,200" →
    // "1200") so formatting quirks never fail an otherwise good extraction.
    amount: z.preprocess(
      (v) => {
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        if (typeof v === 'string') {
          const cleaned = v.replace(/[$,\s]/g, '');
          return cleaned === '' ? null : cleaned;
        }
        return v;
      },
      z
        .string()
        .regex(
          /^\d+(\.\d{1,2})?$/,
          'amount must be a plain decimal like "450.00"',
        )
        .nullish(),
    ),
    currency: z.preprocess(
      (v) => {
        if (typeof v !== 'string') return v;
        const upper = v.trim().toUpperCase();
        return upper === '' ? null : upper;
      },
      z
        .string()
        .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code')
        .nullish(),
    ),
    purpose: optionalText(500),
    dueDate: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
        .nullish(),
    ),
    injectionSignals: z
      .array(z.string().trim().min(1).max(120))
      .default([]),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((val, ctx) => {
    // A money action without a payee, amount, currency, or purpose is not
    // actionable — reject it so the email lands in NEEDS_REVIEW instead of
    // flowing downstream with holes. NOISE carries no requirements.
    if (val.kind !== 'NOISE') {
      for (const field of [
        'payeeName',
        'amount',
        'currency',
        'purpose',
      ] as const) {
        if (val[field] == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for ${val.kind}`,
          });
        }
      }
    }
  });

export type ExtractionResult = z.infer<typeof ExtractionSchema>;
