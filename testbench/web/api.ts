// Types mirror server/*.ts responses; kept separate so the UI bundle has no server imports.

export interface TargetInfo {
  name: string;
  baseUrl: string;
  contextFields: { brand: string; customer: string };
  brandSource: string;
  environments: { key: string; backend: boolean; frontend: boolean }[];
}

export interface Brand {
  key: string;
  displayName: string;
  active: boolean;
}

export interface BrandResult {
  brands: Brand[];
  source: string;
  error?: string;
}

export interface FlagRow {
  name: string;
  frontend: boolean | null;
  sdk: boolean | null;
  match: boolean | null;
  stale?: boolean;
}

export interface SdkStatus {
  state: 'starting' | 'ready' | 'error' | 'no-token';
  lastError?: string;
  lastSyncAt?: string;
  flagCount?: number;
}

export interface Evaluation {
  target: string;
  environment: string;
  context: Record<string, unknown>;
  frontend: { ok: boolean; error?: string; exchangeId?: number };
  sdk: { ok: boolean; error?: string; status: SdkStatus };
  rows: FlagRow[];
  evaluatedAt: string;
}

export interface Exchange {
  id: number;
  at: string;
  target: string;
  environment: string;
  source: 'frontend-api' | 'sdk';
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status?: number;
  responseHeaders: Record<string, string>;
  responseBody?: string;
  durationMs: number;
  error?: string;
}

export interface LatencyStats {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface StressSnapshot {
  id: string;
  options: {
    target: string;
    environment: string;
    mode: 'frontend' | 'client' | 'mixed';
    concurrency: number;
    durationSec: number;
    brandMode: string;
    brandCount: number;
    checkSample: number;
  };
  state: 'running' | 'stopping' | 'done' | 'failed';
  startedAt: string;
  elapsedSec: number;
  requests: number;
  rps: number;
  bytes: number;
  statuses: Record<string, number>;
  byEndpoint: Record<string, LatencyStats>;
  latency: LatencyStats;
  histogram: { upToMs: number; count: number }[];
  timeline: { t: number; requests: number; errors: number; p50: number; p95: number }[];
  errors: number;
  errorSamples: string[];
  checks: {
    compared: number;
    mismatches: number;
    skipped: number;
    note?: string;
    samples: { context: Record<string, unknown>; onlyFrontend: string[]; onlySdk: string[] }[];
  };
  watch: { flag?: string; seconds: { t: number; flag: string; byBrand: Record<string, { on: number; total: number }> }[] };
  failure?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  targets: () =>
    fetch('/bench/targets').then((r) => json<{ sdkRefreshMs: number; targets: TargetInfo[] }>(r)),
  brands: (target: string) =>
    fetch(`/bench/brands?target=${encodeURIComponent(target)}`).then((r) => json<BrandResult>(r)),
  evaluate: (body: { target: string; environment: string; brand: string; customer: string }) =>
    fetch('/bench/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Evaluation>(r)),
  resetSdk: (target: string, environment: string) =>
    fetch('/bench/sdk-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, environment }),
    }).then((r) => json<{ ok: true }>(r)),
  exchanges: () => fetch('/bench/exchanges').then((r) => json<Exchange[]>(r)),
  clearExchanges: () => fetch('/bench/exchanges', { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  stress: () =>
    fetch('/bench/stress').then((r) =>
      json<{
        limits: { concurrency: number; durationSec: number };
        current?: StressSnapshot;
        history: StressSnapshot[];
      }>(r),
    ),
  stressStart: (body: Record<string, unknown>) =>
    fetch('/bench/stress/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<StressSnapshot>(r)),
  definition: (target: string, environment: string, flag: string) =>
    fetch(
      `/bench/definition?target=${encodeURIComponent(target)}&environment=${environment}&flag=${encodeURIComponent(flag)}`,
    ).then((r) => r.json() as Promise<unknown>),
  flags: (target: string, environment: string) =>
    fetch(`/bench/flags?target=${encodeURIComponent(target)}&environment=${environment}`).then((r) =>
      json<{ flags: string[]; error?: string }>(r),
    ),
  stressWatch: (flag: string) =>
    fetch('/bench/stress/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flag }),
    }).then((r) => json<{ ok: true }>(r)),
  stressStop: () => fetch('/bench/stress/stop', { method: 'POST' }).then((r) => json<{ ok: true }>(r)),
};
