/** Pure helpers for the reports: easy to test without a database. */

/** Percentage with 2 decimals from integers (no float drift): 12345/20000 -> 61.73. null when there is no target. */
export function percent(achieved: number, target: number): number | null {
  if (!Number.isFinite(achieved) || !Number.isFinite(target) || target <= 0) return null;
  const bp = (BigInt(Math.max(0, Math.round(achieved))) * 10_000n * 2n + BigInt(target)) / (2n * BigInt(target)); // basis points, half-up
  return Number(bp) / 100;
}

/** Inclusive number of calendar days between two YYYY-MM-DD dates. */
export function daysInclusive(start: string, end: string): number {
  const ms = Date.parse(end.slice(0, 10) + 'T00:00:00Z') - Date.parse(start.slice(0, 10) + 'T00:00:00Z');
  return Math.floor(ms / 86_400_000) + 1;
}

/** Daily share of a period target, rounded up so that days * dailyTarget >= targetAmount. */
export function dailyTarget(targetAmount: number, start: string, end: string): number {
  const days = daysInclusive(start, end);
  return days <= 0 ? 0 : Math.floor((targetAmount + days - 1) / days);
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';
export function agingBucket(ageDays: number): AgingBucket {
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

export interface Column {
  key: string;
  header: string;
}

/**
 * CSV for Excel: UTF-8 with BOM (so Arabic opens correctly), CRLF, quoted when needed.
 * Text that starts with = + - @ gets a leading apostrophe (CSV/formula injection); real numbers are left alone.
 */
export function toCsv(columns: Column[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(','));
  return '\uFEFF' + [head, ...body].join('\r\n') + '\r\n';
}
