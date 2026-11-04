/** Calendar helpers for payroll periods. Periods are always `YYYY-MM`. */

export function isValidPeriod(period: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  const year = Number(period.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

/** The `YYYY-MM` containing `date` in the schedule's IANA timezone. */
export function periodInTimezone(date: Date, timezone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  if (!year || !month) throw new Error(`cannot resolve period in ${timezone}`);
  return `${year}-${month}`;
}

/** Shift a period by whole months (negative = earlier). */
export function shiftPeriod(period: string, months: number): string {
  if (!isValidPeriod(period)) throw new Error(`invalid period: ${period}`);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function periodForOccurrence(
  occurrence: Date,
  timezone = 'UTC',
  offsetMonths = 0,
): string {
  return shiftPeriod(periodInTimezone(occurrence, timezone), offsetMonths);
}
