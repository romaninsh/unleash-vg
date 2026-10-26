import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBenchApp, type BenchApp } from '../server/app.ts';
import { listBrands } from '../server/brands.ts';
import { ConfigError, parseConfig, type BenchConfig } from '../server/config.ts';
import { buildContext, frontendQuery } from '../server/context.ts';
import { BACKEND_TOKEN, FRONTEND_TOKEN, startFakeTarget, type FakeTarget } from './fake-target.ts';

describe('config', () => {
  it('applies defaults and resolves sqlite paths relative to the config file', () => {
    const cfg = parseConfig(
      { targets: [{ name: 'a', baseUrl: 'http://x/', brands: { type: 'sqlite', path: 'db.sqlite' } }] },
      '/cfg',
    );
    expect(cfg.port).toBe(4300);
    expect(cfg.targets[0]!.baseUrl).toBe('http://x');
    expect(cfg.targets[0]!.brands).toEqual({ type: 'sqlite', path: '/cfg/db.sqlite' });
    expect(cfg.targets[0]!.contextFields).toEqual({ brand: 'brand', customer: 'userId' });
  });

  it('rejects unknown environments and duplicate names', () => {
    const t = { name: 'a', baseUrl: 'http://x', brands: { type: 'static', brands: [] } };
    expect(() => parseConfig({ targets: [{ ...t, tokens: { staging: {} } }] }, '/')).toThrow(ConfigError);
    expect(() => parseConfig({ targets: [t, t] }, '/')).toThrow(/duplicate/);
  });
});

describe('context', () => {
  const target = parseConfig(
    { targets: [{ name: 'a', baseUrl: 'http://x', brands: { type: 'static', brands: [] } }] },
    '/',
  ).targets[0]!;

  it('puts userId top-level and brand into properties', () => {
    const ctx = buildContext(target, 'production', { brand: 'bank-c', customer: '1001' });
    expect(ctx.userId).toBe('1001');
    expect(ctx.properties).toEqual({ brand: 'bank-c' });
    expect(frontendQuery(ctx)).toBe(
      'appName=testbench&environment=production&userId=1001&properties%5Bbrand%5D=bank-c',
    );
  });

  it('omits brand and customer when not selected', () => {
    const ctx = buildContext(target, 'uat', { brand: null, customer: null });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.properties).toEqual({});
  });

  it('uses properties for a custom customer field', () => {
    const t = { ...target, contextFields: { brand: 'tenant', customer: 'customerId' } };
    const ctx = buildContext(t, 'uat', { brand: 'bank-a', customer: '7' });
    expect(ctx.properties).toEqual({ customerId: '7', tenant: 'bank-a' });
  });
});

describe('brands', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bench-'));
    const db = new DatabaseSync(join(dir, 'flags.db'));
    db.exec(`CREATE TABLE brands (key TEXT PRIMARY KEY, display_name TEXT, active INTEGER);
             INSERT INTO brands VALUES ('bank-b','Bank B',0), ('bank-a','Bank A',1);`);
    db.close();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads brands from a sqlite brands table', async () => {
    const r = await listBrands({ type: 'sqlite', path: join(dir, 'flags.db') });
    expect(r.error).toBeUndefined();
    expect(r.brands).toEqual([
      { key: 'bank-a', displayName: 'Bank A', active: true },
      { key: 'bank-b', displayName: 'Bank B', active: false },
    ]);
  });

  it('reports a missing database instead of throwing', async () => {
    const r = await listBrands({ type: 'sqlite', path: join(dir, 'nope.db') });
    expect(r.brands).toEqual([]);
    expect(r.error).toMatch(/not found/);
  });
});

describe('evaluate against a fake target', () => {
  let fake: FakeTarget;
  let app: BenchApp;
  let base: string;

  beforeAll(async () => {
    fake = await startFakeTarget();
    const config: BenchConfig = parseConfig(
      {
        port: 0,
        targets: [
          {
            name: 'fake',
            baseUrl: fake.url,
            tokens: { production: { backend: BACKEND_TOKEN, frontend: FRONTEND_TOKEN } },
            brands: { type: 'static', brands: [{ key: 'bank-a' }, { key: 'bank-b' }, { key: 'bank-c' }] },
          },
        ],
      },
      '/',
    );
    app = createBenchApp(config);
    base = `http://127.0.0.1:${await app.listen(0)}`;
  });
  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  const evaluate = async (brand: string, customer: string) => {
    const res = await fetch(`${base}/bench/evaluate`, {
      method: 'POST',
      body: JSON.stringify({ target: 'fake', environment: 'production', brand, customer }),
    });
    return res.json();
  };
  const row = (ev: any, name: string) => ev.rows.find((r: any) => r.name === name);

  it('evaluates via both paths and agrees where the target is correct', async () => {
    const ev = await evaluate('bank-a', '5555');
    expect(ev.frontend.ok).toBe(true);
    expect(ev.sdk.ok).toBe(true);
    expect(row(ev, 'debit-card-payments')).toMatchObject({ frontend: true, sdk: true, match: true });
    expect(row(ev, 'sso-login')).toMatchObject({ frontend: true, sdk: true, match: true, stale: true });
  });

  it('applies brand overrides and allowlists through the real SDK', async () => {
    expect(row(await evaluate('bank-b', '1001'), 'debit-card-payments')).toMatchObject({ sdk: false, match: true });
    // bank-c customer 1001 is allowlisted: SDK says ON, the fake frontend says OFF → mismatch is reported.
    expect(row(await evaluate('bank-c', '1001'), 'debit-card-payments')).toMatchObject({
      frontend: false,
      sdk: true,
      match: false,
    });
  });

  it('flags a disagreement between Frontend API and SDK', async () => {
    const ev = await evaluate('bank-a', '5555');
    expect(row(ev, 'dark-mode')).toMatchObject({ frontend: true, sdk: false, match: false });
  });

  it('records frontend and SDK traffic for the inspector', async () => {
    const list = await (await fetch(`${base}/bench/exchanges`)).json();
    const fe = list.find((e: any) => e.source === 'frontend-api');
    expect(fe.url).toContain('properties%5Bbrand%5D=');
    expect(fe.requestHeaders.authorization ?? fe.requestHeaders.Authorization).toMatch(/…\(\d+ chars\)$/);
    expect(list.some((e: any) => e.source === 'sdk' && e.url.endsWith('/api/client/features'))).toBe(true);
  });

  it('reports a missing token instead of failing', async () => {
    const res = await fetch(`${base}/bench/evaluate`, {
      method: 'POST',
      body: JSON.stringify({ target: 'fake', environment: 'uat', brand: 'bank-a', customer: '1' }),
    });
    const ev = await res.json();
    expect(ev.frontend).toMatchObject({ ok: false, error: expect.stringMatching(/no frontend token/) });
    expect(ev.sdk).toMatchObject({ ok: false, error: expect.stringMatching(/no backend token/) });
  });
});
