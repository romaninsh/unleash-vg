import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig, type Target } from '../server/config.ts';
import { SdkPool } from '../server/sdk-pool.ts';
import { Histogram, StressRun, validateOptions } from '../server/stress.ts';
import { BACKEND_TOKEN, FRONTEND_TOKEN, startFakeTarget, type FakeTarget } from './fake-target.ts';

describe('Histogram', () => {
  it('computes percentiles within bin resolution', () => {
    const h = new Histogram();
    for (let i = 1; i <= 1000; i++) h.add(i / 10); // 0.1 … 100 ms, uniform
    const s = h.stats();
    expect(s.count).toBe(1000);
    expect(s.p50).toBeCloseTo(50, 0);
    expect(s.p95).toBeCloseTo(95, 0);
    expect(s.p99).toBeCloseTo(99, 0);
    expect(s.max).toBe(100);
  });

  it('handles slow outliers in the coarse range', () => {
    const h = new Histogram();
    for (let i = 0; i < 99; i++) h.add(2);
    h.add(1500);
    expect(h.percentile(50)).toBeLessThanOrEqual(2.1);
    expect(h.percentile(100)).toBe(1500);
    expect(h.display().at(-1)!.upToMs).toBe(2500);
  });
});

describe('validateOptions', () => {
  it('rejects out-of-range concurrency and unknown modes', () => {
    const base = { target: 't', environment: 'production', brandMode: 'none', durationSec: 1 } as const;
    expect(() => validateOptions({ ...base, mode: 'frontend', concurrency: 0 })).toThrow(/concurrency/);
    expect(() => validateOptions({ ...base, mode: 'nope' as any, concurrency: 1 })).toThrow(/mode/);
  });
});

describe('StressRun against a fake target', () => {
  let fake: FakeTarget;
  let target: Target;
  let pool: SdkPool;

  beforeAll(async () => {
    fake = await startFakeTarget();
    target = parseConfig(
      {
        targets: [
          {
            name: 'fake',
            baseUrl: fake.url,
            tokens: { production: { backend: BACKEND_TOKEN, frontend: FRONTEND_TOKEN } },
            brands: { type: 'static', brands: [] },
          },
        ],
      },
      '/',
    ).targets[0]!;
    pool = new SdkPool((t) => `${t.baseUrl}/api/`);
  });
  afterAll(async () => {
    pool.destroyAll();
    await fake.close();
  });

  const opts = (o: object) =>
    validateOptions({
      target: 'fake',
      environment: 'production',
      concurrency: 4,
      durationSec: 1,
      brandMode: 'random',
      brands: ['bank-a', 'bank-b', 'bank-c'],
      customerMin: 1,
      customerMax: 5000,
      ...o,
    });

  it('floods the Frontend API and catches wrong answers by sampling against the SDK', async () => {
    const run = new StressRun(opts({ mode: 'frontend', checkSample: 1 }), target, pool);
    await run.done;
    const s = run.snapshot();
    expect(s.state).toBe('done');
    expect(s.requests).toBeGreaterThan(50);
    expect(s.statuses['200']).toBe(s.requests);
    expect(s.errors).toBe(0);
    expect(s.latency.p95).toBeGreaterThan(0);
    expect(s.timeline.length).toBeGreaterThanOrEqual(1);
    // The fake's Frontend API wrongly reports dark-mode ON.
    expect(s.checks.compared).toBeGreaterThan(0);
    expect(s.checks.mismatches).toBe(s.checks.compared);
    expect(s.checks.samples[0]!.onlyFrontend).toContain('dark-mode');
    // Random customers and brands, not one repeated context.
    const fe = fake.requests.filter((r) => r.path === '/api/frontend');
    expect(new Set(fe.map((r) => r.query.get('userId'))).size).toBeGreaterThan(fe.length / 10);
    expect(new Set(fe.map((r) => r.query.get('properties[brand]')))).toEqual(new Set(['bank-a', 'bank-b', 'bank-c']));
  });

  it('polls the Client API conditionally and records 304s', async () => {
    const run = new StressRun(opts({ mode: 'client', checkSample: 0, concurrency: 2 }), target, pool);
    await run.done;
    const s = run.snapshot();
    expect(s.statuses['304']).toBeGreaterThan(0);
    expect(Object.keys(s.byEndpoint)).toEqual(['GET /api/client/features (conditional)']);
  });

  it('tracks a watched flag ON share per brand, and can switch flags mid-run', async () => {
    const run = new StressRun(
      opts({ mode: 'frontend', checkSample: 0, durationSec: 2, watchFlag: 'debit-card-payments' }),
      target,
      pool,
    );
    await new Promise((r) => setTimeout(r, 1100));
    run.setWatch('sso-login');
    await run.done;
    const w = run.snapshot().watch;
    expect(w.flag).toBe('sso-login');
    const sum = (flag: string, brand: string) =>
      w.seconds
        .filter((s) => s.flag === flag)
        .reduce((a, s) => ({ on: a.on + (s.byBrand[brand]?.on ?? 0), total: a.total + (s.byBrand[brand]?.total ?? 0) }), {
          on: 0,
          total: 0,
        });
    // Fake frontend: debit-card-payments ON for bank-a, OFF for bank-b and bank-c; sso-login ON everywhere.
    expect(sum('debit-card-payments', 'bank-a').total).toBeGreaterThan(0);
    expect(sum('debit-card-payments', 'bank-a').on).toBe(sum('debit-card-payments', 'bank-a').total);
    expect(sum('debit-card-payments', 'bank-b').on).toBe(0);
    const sso = sum('sso-login', 'bank-b');
    expect(sso.total).toBeGreaterThan(0);
    expect(sso.on).toBe(sso.total);
  });

  it('fails cleanly when a token is missing', async () => {
    const run = new StressRun(opts({ mode: 'frontend', environment: 'uat' }), target, pool);
    await run.done;
    expect(run.snapshot()).toMatchObject({ state: 'failed', failure: expect.stringMatching(/missing frontend token/) });
  });
});
