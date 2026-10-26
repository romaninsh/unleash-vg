import type { StressSnapshot } from './api.ts';

/**
 * Performance limits for the stress tiles, derived from the first local benchmark (2026-10-17,
 * 32 workers, Frontend API, random brand + customer): 16–22k req/s, p50 1.3–1.8 ms, p95 2.4–4.2 ms,
 * p99 5.3–6.1 ms, 0 errors, 0 wrong answers. "good" sits just above what both implementations
 * achieved; "critical" is where it becomes a real problem (p99 50 ms = spec 09 A10).
 *
 * Severity is 0 (fine) … 1 (critical), interpolated on a log scale between the two limits, so
 * colours shift gradually instead of flipping at one number.
 */
export const LIMITS = {
  /** req/s per 32 workers; scaled down linearly for fewer workers. */
  throughput: { good: 12_000, critical: 3_000 },
  p50: { good: 2.5, critical: 10 },
  p95: { good: 6, critical: 25 },
  p99: { good: 10, critical: 50 },
  /** fraction of requests */
  errorRate: { critical: 0.01 },
  /** fraction of checked answers; any wrong answer is at least "serious" */
  wrongRate: { critical: 0.001 },
};

export const MIN_REQUESTS = 200;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const logLerp = (v: number, good: number, bad: number) =>
  v <= 0 ? 0 : clamp(Math.log(v / good) / Math.log(bad / good));

export type Level = 'none' | 'good' | 'warning' | 'serious' | 'critical';

export interface Verdict {
  severity: number;
  level: Level;
  limit: string;
}

export function level(severity: number): Level {
  if (severity <= 0) return 'good';
  if (severity < 0.4) return 'warning';
  if (severity < 0.75) return 'serious';
  return 'critical';
}

function verdict(severity: number, limit: string): Verdict {
  return { severity, level: level(severity), limit };
}

export function assess(s: StressSnapshot): Record<'throughput' | 'p50' | 'p95' | 'p99' | 'errors' | 'wrong', Verdict> | undefined {
  if (s.requests < MIN_REQUESTS) return undefined;
  const scale = Math.min(1, s.options.concurrency / 32);
  const tGood = LIMITS.throughput.good * scale;
  const tBad = LIMITS.throughput.critical * scale;
  const lat = (v: number, l: { good: number; critical: number }, name: string) =>
    verdict(logLerp(v, l.good, l.critical), `${name}: ok ≤ ${l.good} ms, critical ≥ ${l.critical} ms`);

  const errRate = s.errors / s.requests;
  const wrongRate = s.checks.compared ? s.checks.mismatches / s.checks.compared : 0;

  return {
    throughput: verdict(
      s.rps >= tGood ? 0 : logLerp(tGood / Math.max(1, s.rps), 1, tGood / tBad),
      `ok ≥ ${Math.round(tGood).toLocaleString()} req/s, critical ≤ ${Math.round(tBad).toLocaleString()} req/s (for ${s.options.concurrency} workers)`,
    ),
    p50: lat(s.latency.p50, LIMITS.p50, 'p50'),
    p95: lat(s.latency.p95, LIMITS.p95, 'p95'),
    p99: lat(s.latency.p99, LIMITS.p99, 'p99'),
    // Any error is at least a warning; 1% of requests is critical.
    errors: verdict(
      errRate === 0 ? 0 : Math.max(0.15, logLerp(errRate, LIMITS.errorRate.critical / 1000, LIMITS.errorRate.critical)),
      'ok = 0, critical ≥ 1% of requests',
    ),
    // A wrong answer is a correctness bug: never below "serious".
    wrong: verdict(
      s.checks.mismatches === 0 ? 0 : Math.max(0.5, logLerp(wrongRate, LIMITS.wrongRate.critical / 100, LIMITS.wrongRate.critical)),
      'ok = 0; any wrong answer is serious, ≥ 0.1% critical',
    ),
  };
}

const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/** Gradual tile tint: border in the status colour, background tint growing with severity. */
export function tileStyle(v: Verdict | undefined): React.CSSProperties {
  if (!v) return {};
  if (v.level === 'good') return { borderLeft: `4px solid ${STATUS.good}` };
  const c = STATUS[v.level as 'warning' | 'serious' | 'critical'];
  const alpha = Math.round((0.08 + 0.22 * v.severity) * 255)
    .toString(16)
    .padStart(2, '0');
  return { borderLeft: `4px solid ${c}`, background: `${c}${alpha}` };
}

export const LEVEL_LABEL: Record<Level, string> = {
  none: '',
  good: '✓ OK',
  warning: '▲ Watch',
  serious: '▲ Slow',
  critical: '✖ Too slow',
};
