/** Returns the date-only (YYYY-MM-DD) portion of a Date in UTC. */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns today's date (YYYY-MM-DD) in UTC. */
export function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns yesterday's date (YYYY-MM-DD) in UTC. */
export function getYesterdayString(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Builds a UTC Date at midnight for a YYYY-MM-DD string. */
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Builds a UTC Date at 23:59:59.999 for a YYYY-MM-DD string (inclusive end-of-day). */
export function toEndOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

/** Builds a UTC Date at midnight for the first day of a YYYY-MM month. */
export function toMonthStart(value: string): Date {
  return new Date(`${value}-01T00:00:00.000Z`);
}

/** Builds a UTC Date at midnight for the first day of the next month of a YYYY-MM string. */
export function toNextMonthStart(value: string): Date {
  const parts = value.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}
