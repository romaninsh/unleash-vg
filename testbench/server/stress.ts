import { randomUUID } from 'node:crypto';
import type { Target } from './config.ts';
import { buildContext, frontendQuery } from './context.ts';
import type { SdkPool } from './sdk-pool.ts';

/**
 * Load generator: N concurrent workers hammer one target × environment with random customers until
 * the duration is up. Latency is measured to the end of the response body and kept in a fixed
 * histogram (0.1 ms resolution below 100 ms, 1 ms above), so percentiles stay exact enough for
 * millions of requests without storing them all.
 */

export type StressMode = 'frontend' | 'client' | 'mixed';
export type BrandMode = 'selected' | 'random' | 'none';

export interface StressOptions {
  target: string;
  environment: string;
  mode: StressMode;
  concurrency: number;
  durationSec: number;
  brandMode: BrandMode;
  selectedBrand?: string;
  brands: string[];
  customerMode: 'range' | 'uuid';
  customerMin: number;
  customerMax: number;
  /** Client API: send If-None-Match with the last ETag, as polling SDKs do. */
  conditional: boolean;
  /** Fraction (0–1) of Frontend API answers re-checked against the official SDK. */
  checkSample: number;
  /** Flag whose ON share is tracked per second; can be changed while running. */
  watchFlag?: string;
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

export interface SecondBucket {
  t: number; // seconds since start
  requests: number;
  errors: number;
  p50: number;
  p95: number;
}

export interface Mismatch {
  context: Record<string, unknown>;
  onlyFrontend: string[];
  onlySdk: string[];
}

/** Per-second ON/total counts for the watched flag, split by brand ('' = no brand). */
export interface WatchSecond {
  t: number;
  flag: string;
  byBrand: Record<string, { on: number; total: number }>;
}

export interface StressSnapshot {
  id: string;
  options: Omit<StressOptions, 'brands'> & { brandCount: number };
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
  timeline: SecondBucket[];
  errors: number;
  errorSamples: string[];
  checks: { compared: number; mismatches: number; skipped: number; note?: string; samples: Mismatch[] };
  /** Flag being watched now (Frontend API answers only) and its per-second ON share by brand. */
  watch: { flag?: string; seconds: WatchSecond[] };
  failure?: string;
}

// A public bench lowers these (BENCH_STRESS_MAX_WORKERS, BENCH_STRESS_MAX_SECONDS) so it can show a
// live flag change without being a load tool against the target.
export const LIMITS = {
  concurrency: Number(process.env.BENCH_STRESS_MAX_WORKERS ?? 256),
  durationSec: Number(process.env.BENCH_STRESS_MAX_SECONDS ?? 3600),
};

// ---------------------------------------------------------------- histogram

const FINE_BINS = 1000; // 0.1 ms bins up to 100 ms
const COARSE_BINS = 9900; // 1 ms bins up to 10 s

export class Histogram {
  private bins = new Float64Array(FINE_BINS + COARSE_BINS + 1);
  count = 0;
  sum = 0;
  min = Infinity;
  max = 0;

  add(ms: number): void {
    this.count++;
    this.sum += ms;
    if (ms < this.min) this.min = ms;
    if (ms > this.max) this.max = ms;
    this.bins[binOf(ms)]!++;
  }

  percentile(p: number): number {
    if (this.count === 0) return 0;
    const want = Math.ceil((p / 100) * this.count);
    let seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i]!;
      if (seen >= want) return Math.min(upperOf(i), this.max);
    }
    return this.max;
  }

  stats(): LatencyStats {
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      count: this.count,
      min: this.count ? r(this.min) : 0,
      mean: this.count ? r(this.sum / this.count) : 0,
      p50: r(this.percentile(50)),
      p90: r(this.percentile(90)),
      p95: r(this.percentile(95)),
      p99: r(this.percentile(99)),
      max: r(this.max),
    };
  }

  /** Coarse display buckets (log-ish edges) for the histogram chart. */
  display(): { upToMs: number; count: number }[] {
    const edges = [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 150, 250, 500, 1000, 2500, 10000];
    const out = edges.map((upToMs) => ({ upToMs, count: 0 }));
    for (let i = 0; i < this.bins.length; i++) {
      const c = this.bins[i]!;
      if (!c) continue;
      const ms = upperOf(i);
      const slot = edges.findIndex((e) => ms <= e);
      out[slot === -1 ? out.length - 1 : slot]!.count += c;
    }
    // Trim empty tail so the chart uses its width.
    let last = out.length - 1;
    while (last > 0 && out[last]!.count === 0) last--;
    return out.slice(0, last + 1);
  }
}

function binOf(ms: number): number {
  if (ms < 100) return Math.floor(ms * 10);
  return Math.min(FINE_BINS + Math.floor(ms - 100), FINE_BINS + COARSE_BINS);
}

function upperOf(bin: number): number {
  return bin < FINE_BINS ? (bin + 1) / 10 : 100 + (bin - FINE_BINS + 1);
}

// ---------------------------------------------------------------- run

export function validateOptions(o: Partial<StressOptions>): StressOptions {
  const int = (v: unknown, lo: number, hi: number, name: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${name} must be an integer ${lo}–${hi}`);
    return n;
  };
  if (!o.target || !o.environment) throw new Error('target and environment are required');
  if (!['frontend', 'client', 'mixed'].includes(o.mode as string)) throw new Error('mode must be frontend, client or mixed');
  if (!['selected', 'random', 'none'].includes(o.brandMode as string)) throw new Error('brandMode must be selected, random or none');
  const customerMin = int(o.customerMin ?? 1, 0, 1e12, 'customerMin');
  const customerMax = int(o.customerMax ?? 1_000_000, customerMin, 1e12, 'customerMax');
  const sample = Number(o.checkSample ?? 0.02);
  if (!(sample >= 0 && sample <= 1)) throw new Error('checkSample must be 0–1');
  return {
    target: o.target,
    environment: o.environment,
    mode: o.mode as StressMode,
    concurrency: int(o.concurrency, 1, LIMITS.concurrency, 'concurrency'),
    durationSec: int(o.durationSec, 1, LIMITS.durationSec, 'durationSec'),
    brandMode: o.brandMode as BrandMode,
    selectedBrand: o.selectedBrand || undefined,
    brands: Array.isArray(o.brands) ? o.brands.map(String) : [],
    customerMode: o.customerMode === 'uuid' ? 'uuid' : 'range',
    customerMin,
    customerMax,
    conditional: o.conditional !== false,
    checkSample: sample,
    watchFlag: typeof o.watchFlag === 'string' && o.watchFlag ? o.watchFlag : undefined,
  };
}

/** Matches a flag in a Frontend API body; only enabled flags are listed there (spec 04). */
function flagMatcher(flag: string): RegExp {
  return new RegExp(`"name"\\s*:\\s*"${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
}

export class StressRun {
  readonly id = randomUUID();
  private readonly startedAt = new Date();
  private startMs = performance.now();
  private state: StressSnapshot['state'] = 'running';
  private failure?: string;
  private all = new Histogram();
  private perEndpoint = new Map<string, Histogram>();
  private perSecond = new Map<number, { h: Histogram; errors: number }>();
  private statuses: Record<string, number> = {};
  private errors = 0;
  private errorSamples: string[] = [];
  private bytes = 0;
  private etag?: string;
  private checks: StressSnapshot['checks'] = { compared: 0, mismatches: 0, skipped: 0, samples: [] };
  private stopRequested = false;
  private watchFlag?: string;
  private watchRe?: RegExp;
  private watchSeconds = new Map<number, WatchSecond>();
  readonly options: StressOptions;
  private target: Target;
  private pool: SdkPool;
  readonly done: Promise<void>;

  constructor(options: StressOptions, target: Target, pool: SdkPool) {
    this.options = options;
    this.target = target;
    this.pool = pool;
    this.setWatch(options.watchFlag);
    this.done = this.run().catch((e) => {
      this.state = 'failed';
      this.failure = (e as Error).message;
    });
  }

  /** Start (or switch) tracking a flag's ON share; earlier seconds keep the flag they measured. */
  setWatch(flag: string | undefined): void {
    this.watchFlag = flag || undefined;
    this.watchRe = this.watchFlag ? flagMatcher(this.watchFlag) : undefined;
  }

  stop(): void {
    if (this.state === 'running') this.state = 'stopping';
    this.stopRequested = true;
  }

  private async run(): Promise<void> {
    const o = this.options;
    const env = o.environment as keyof Target['tokens'];
    const tokens = this.target.tokens[env];
    if ((o.mode !== 'client' && !tokens?.frontend) || (o.mode !== 'frontend' && !tokens?.backend)) {
      throw new Error(`missing ${o.mode === 'client' ? 'backend' : o.mode === 'frontend' ? 'frontend' : 'backend/frontend'} token for ${o.environment}`);
    }
    if (o.brandMode === 'random' && o.brands.length === 0) throw new Error('brandMode random needs a brand list');

    // Correctness sampling needs a ready SDK for this target/env; warm it before the clock starts.
    let sdk: ReturnType<SdkPool['get']> | undefined;
    if (o.checkSample > 0 && o.mode !== 'client') {
      sdk = this.pool.get(this.target, o.environment);
      await sdk.ready;
      if (!sdk.client || sdk.status.state !== 'ready') {
        this.checks.note = `SDK not ready (${sdk.status.lastError ?? sdk.status.state}) — correctness sampling off`;
        sdk = undefined;
      }
    }

    this.startMs = performance.now();
    const deadline = this.startMs + o.durationSec * 1000;
    const worker = async () => {
      while (!this.stopRequested && performance.now() < deadline) {
        const useClient = o.mode === 'client' || (o.mode === 'mixed' && Math.random() < 0.2);
        if (useClient) await this.clientRequest(tokens!.backend!);
        else await this.frontendRequest(tokens!.frontend!, sdk);
      }
    };
    await Promise.all(Array.from({ length: o.concurrency }, worker));
    this.state = 'done';
  }

  private pickCustomer(): string {
    const o = this.options;
    if (o.customerMode === 'uuid') return randomUUID();
    return String(o.customerMin + Math.floor(Math.random() * (o.customerMax - o.customerMin + 1)));
  }

  private pickBrand(): string | null {
    const o = this.options;
    if (o.brandMode === 'none') return null;
    if (o.brandMode === 'selected') return o.selectedBrand ?? null;
    return o.brands[Math.floor(Math.random() * o.brands.length)]!;
  }

  private async frontendRequest(token: string, sdk: ReturnType<SdkPool['get']> | undefined) {
    const ctx = buildContext(this.target, this.options.environment, {
      brand: this.pickBrand(),
      customer: this.pickCustomer(),
    });
    const res = await this.timed('GET /api/frontend', `${this.target.baseUrl}/api/frontend?${frontendQuery(ctx)}`, {
      Authorization: token,
      'unleash-appname': 'testbench-stress',
    });
    if (!res || res.status !== 200) return;
    if (this.watchRe && this.watchFlag) {
      const field = this.target.contextFields.brand;
      const brand = String(ctx.properties[field] ?? ctx[field] ?? '');
      const t = Math.floor((res.at - this.startMs) / 1000);
      let sec = this.watchSeconds.get(t);
      if (!sec || sec.flag !== this.watchFlag) {
        // A flag switch mid-second restarts that second for the new flag.
        sec = { t, flag: this.watchFlag, byBrand: {} };
        this.watchSeconds.set(t, sec);
      }
      const c = (sec.byBrand[brand] ??= { on: 0, total: 0 });
      c.total++;
      if (this.watchRe.test(res.body)) c.on++;
    }
    if (!sdk?.client) return;
    if (Math.random() >= this.options.checkSample) return;
    try {
      const fe = new Set(
        ((JSON.parse(res.body).toggles ?? []) as { name: string; enabled: boolean }[])
          .filter((t) => t.enabled)
          .map((t) => t.name),
      );
      const local = new Set(
        (sdk.client.getFeatureToggleDefinitions() ?? [])
          .map((d) => d.name)
          .filter((n) => sdk.client!.isEnabled(n, ctx as any)),
      );
      this.checks.compared++;
      const onlyFrontend = [...fe].filter((n) => !local.has(n));
      const onlySdk = [...local].filter((n) => !fe.has(n));
      if (onlyFrontend.length || onlySdk.length) {
        this.checks.mismatches++;
        if (this.checks.samples.length < 5) this.checks.samples.push({ context: ctx, onlyFrontend, onlySdk });
      }
    } catch {
      this.checks.skipped++;
    }
  }

  private async clientRequest(token: string) {
    const headers: Record<string, string> = { Authorization: token, 'unleash-appname': 'testbench-stress' };
    if (this.options.conditional && this.etag) headers['If-None-Match'] = this.etag;
    const res = await this.timed(
      this.options.conditional ? 'GET /api/client/features (conditional)' : 'GET /api/client/features',
      `${this.target.baseUrl}/api/client/features`,
      headers,
    );
    const etag = res?.headers.get('etag');
    if (etag) this.etag = etag;
  }

  private async timed(endpoint: string, url: string, headers: Record<string, string>) {
    const t0 = performance.now();
    let status: string;
    let body = '';
    let resHeaders: Headers | undefined;
    let statusNum: number | undefined;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      body = await res.text();
      statusNum = res.status;
      status = String(res.status);
      resHeaders = res.headers;
      this.bytes += body.length;
      if (res.status >= 400) this.noteError(`HTTP ${res.status} ${endpoint}: ${body.slice(0, 160)}`);
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      status = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? 'network');
      this.noteError(`${status} ${endpoint}: ${err.cause?.code ?? err.message}`);
    }
    const ms = performance.now() - t0;
    const sec = Math.floor((t0 - this.startMs) / 1000);
    this.statuses[status] = (this.statuses[status] ?? 0) + 1;
    this.all.add(ms);
    let eh = this.perEndpoint.get(endpoint);
    if (!eh) this.perEndpoint.set(endpoint, (eh = new Histogram()));
    eh.add(ms);
    let b = this.perSecond.get(sec);
    if (!b) this.perSecond.set(sec, (b = { h: new Histogram(), errors: 0 }));
    b.h.add(ms);
    if (statusNum === undefined || statusNum >= 400) b.errors++;
    return statusNum === undefined ? undefined : { status: statusNum, body, headers: resHeaders!, at: t0 };
  }

  private noteError(msg: string) {
    this.errors++;
    if (this.errorSamples.length < 5 && !this.errorSamples.includes(msg)) this.errorSamples.push(msg);
  }

  snapshot(): StressSnapshot {
    const { brands, ...rest } = this.options;
    const elapsedSec = Math.min((performance.now() - this.startMs) / 1000, this.options.durationSec);
    const timeline = [...this.perSecond.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({
        t,
        requests: v.h.count,
        errors: v.errors,
        p50: Math.round(v.h.percentile(50) * 100) / 100,
        p95: Math.round(v.h.percentile(95) * 100) / 100,
      }));
    return {
      id: this.id,
      options: { ...rest, brandCount: brands.length },
      state: this.state,
      startedAt: this.startedAt.toISOString(),
      elapsedSec: Math.round(elapsedSec * 10) / 10,
      requests: this.all.count,
      rps: elapsedSec > 0 ? Math.round(this.all.count / elapsedSec) : 0,
      bytes: this.bytes,
      statuses: { ...this.statuses },
      byEndpoint: Object.fromEntries([...this.perEndpoint.entries()].map(([k, h]) => [k, h.stats()])),
      latency: this.all.stats(),
      histogram: this.all.display(),
      timeline,
      errors: this.errors,
      errorSamples: [...this.errorSamples],
      checks: { ...this.checks, samples: [...this.checks.samples] },
      watch: {
        flag: this.watchFlag,
        seconds: [...this.watchSeconds.values()]
          .sort((a, b) => a.t - b.t)
          .map((s) => ({ ...s, byBrand: structuredClone(s.byBrand) })),
      },
      failure: this.failure,
    };
  }
}
