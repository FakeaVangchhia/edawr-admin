/**
 * Display formatting. Nothing here computes a bill.
 *
 * The rule this project is built on: **money is decided by the server.** Every
 * price, fee and total is a `Decimal` in Django, quantised ROUND_HALF_UP in
 * `api/pricing.py`, and arrives here as a JSON number purely so it can be
 * displayed. Nothing in this file adds two amounts together, and nothing in the
 * console should — a second pricing engine in TypeScript will disagree with the
 * first one the day a fee changes.
 *
 * Note the console shows **exact** amounts, always. The rider app rounds to
 * whole rupees, which is a real bug: a basket ending in .50 produces a doorstep
 * argument and a till that will not reconcile. The console is the screen that
 * settles those arguments, so it shows what was actually charged.
 */

const INR_EXACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUMBER = new Intl.NumberFormat('en-IN');

/** Exact rupees and paise. The default everywhere a charge is shown. */
export function money(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return INR_EXACT.format(Number.isFinite(amount) ? amount : 0);
}

/**
 * Whole rupees, for headline tiles and chart axes only.
 *
 * Never for a line item or a total the customer paid. Two paise of rounding on
 * a KPI tile is noise; two paise on a receipt is a discrepancy someone has to
 * explain.
 */
export function moneyRounded(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return INR_COMPACT.format(Number.isFinite(amount) ? amount : 0);
}

export function count(value: number | null | undefined): string {
  return NUMBER.format(Number(value ?? 0));
}

export function percent(value: number | null | undefined, digits = 1): string {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount : 0).toFixed(digits)}%`;
}

/**
 * The change from the previous period, as a signed percentage.
 *
 * Returns null when there is nothing to compare against. A jump from zero is
 * not "+100%" and not "+∞" — it is a first sale, and the honest rendering of it
 * is no comparison at all rather than a number that looks like a trend.
 */
export function delta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const DATE_ONLY = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateTime(value: string | null | undefined): string {
  const date = parse(value);
  return date ? DATE_TIME.format(date) : '—';
}

export function dateOnly(value: string | null | undefined): string {
  const date = parse(value);
  return date ? DATE_ONLY.format(date) : '—';
}

/**
 * "4 min ago", "2 h ago", "3 d ago".
 *
 * Used on the order board, where the useful question is "how long has this been
 * sitting there", not "at what o'clock did it arrive". Both are shown — this in
 * the column, the absolute time in the tooltip — because relative time alone is
 * useless once someone needs to write it down.
 */
export function relativeTime(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

/**
 * An age the *server* measured, as "12s" / "4m" / "2h".
 *
 * Deliberately not `relativeTime`, and the difference matters. `relativeTime`
 * subtracts a timestamp from `Date.now()`, so it is only as right as the
 * viewer's clock — a console on a laptop four minutes fast would show every
 * rider as four minutes stale, and a manager would go looking for a fault in
 * the phones. `age_seconds` arrives already computed against the clock that
 * decided `is_stale`, so the badge and the number can never disagree.
 *
 * Terse on purpose: this sits in a table cell that refreshes every few seconds,
 * where "12s" reads at a glance and "12 seconds ago" is noise.
 */
export function ageFromSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Kilometres as "1.8 km", or an em dash when the distance is unknown.
 *
 *  **Null is not zero.** An order placed without geolocation has no distance to
 *  anything, and the API sends `null` rather than `0` precisely so this renders
 *  as "unknown" instead of "the rider is already there". */
export function distanceKm(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} km`;
}

/** Minutes as "12 min" or "1 h 25 min". */
export function minutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const whole = Math.round(value);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** `+919812345678` reads as `+91 98123 45678`. */
export function phone(value: string | null | undefined): string {
  if (!value) return '—';
  const match = value.match(/^\+91(\d{5})(\d{5})$/);
  return match ? `+91 ${match[1]} ${match[2]}` : value;
}

/**
 * Margin as a percentage of the selling price.
 *
 * A zero cost price means "not recorded", not "pure profit" — a product nobody
 * has entered a cost for would otherwise report a confident 100% margin and
 * pollute every average it appears in.
 */
export function marginPercent(price: number, costPrice: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(costPrice)) return null;
  if (price <= 0 || costPrice <= 0) return null;
  return ((price - costPrice) / price) * 100;
}

/** An ISO `YYYY-MM-DD` for a date input, in the viewer's local time. */
export function isoDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

export function today(): string {
  return isoDate(new Date());
}
