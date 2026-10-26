import type { Target } from './config.ts';
import { buildContext, frontendQuery, type Selection, type UnleashContext } from './context.ts';
import type { Recorder } from './recorder.ts';
import type { SdkPool, SdkStatus } from './sdk-pool.ts';

export interface FlagRow {
  name: string;
  /** Result from the target's Frontend API (server-side evaluation). null = path unavailable. */
  frontend: boolean | null;
  /** Result from the official Node SDK evaluating the target's Client API payload. */
  sdk: boolean | null;
  match: boolean | null;
  stale?: boolean;
}

export interface PathResult {
  ok: boolean;
  error?: string;
  exchangeId?: number;
}

export interface Evaluation {
  target: string;
  environment: string;
  context: UnleashContext;
  frontend: PathResult;
  sdk: PathResult & { status: SdkStatus };
  rows: FlagRow[];
  evaluatedAt: string;
}

export async function evaluate(
  deps: { recorder: Recorder; pool: SdkPool },
  target: Target,
  environment: string,
  sel: Selection,
): Promise<Evaluation> {
  const context = buildContext(target, environment, sel);
  const [fe, sdk] = await Promise.all([
    evalFrontend(deps.recorder, target, environment, context),
    evalSdk(deps.pool, target, environment, context),
  ]);

  const names = new Set<string>([...fe.enabled, ...sdk.results.keys()]);
  const rows: FlagRow[] = [...names].sort().map((name) => {
    const frontend = fe.ok ? fe.enabled.has(name) : null;
    const s = sdk.results.get(name);
    const sdkVal = s ? s.enabled : sdk.ok ? false : null;
    return {
      name,
      frontend,
      sdk: sdkVal,
      match: frontend === null || sdkVal === null ? null : frontend === sdkVal,
      stale: s?.stale,
    };
  });

  return {
    target: target.name,
    environment,
    context,
    frontend: { ok: fe.ok, error: fe.error, exchangeId: fe.exchangeId },
    sdk: { ok: sdk.ok, error: sdk.error, status: sdk.status },
    rows,
    evaluatedAt: new Date().toISOString(),
  };
}

async function evalFrontend(recorder: Recorder, target: Target, env: string, ctx: UnleashContext) {
  const token = target.tokens[env as keyof Target['tokens']]?.frontend;
  const enabled = new Set<string>();
  if (!token) return { ok: false, enabled, error: `no frontend token configured for ${env}` };

  const r = await recorder.fetch(
    { target: target.name, environment: env, source: 'frontend-api' },
    `${target.baseUrl}/api/frontend?${frontendQuery(ctx)}`,
    { headers: { Authorization: token, Accept: 'application/json', 'unleash-appname': 'testbench' } },
  );
  const exchangeId = r.exchange.id;
  if (r.status === undefined) return { ok: false, enabled, exchangeId, error: `request failed: ${r.exchange.error}` };
  if (r.status !== 200) return { ok: false, enabled, exchangeId, error: `HTTP ${r.status}` };
  const ctype = r.headers.get('content-type') ?? '';
  if (!ctype.includes('json')) {
    return { ok: false, enabled, exchangeId, error: `not JSON (${ctype || 'no content-type'}) — endpoint not implemented?` };
  }
  try {
    const body = JSON.parse(r.body) as { toggles?: { name: string; enabled: boolean }[] };
    if (!Array.isArray(body.toggles)) return { ok: false, enabled, exchangeId, error: 'response has no "toggles" array' };
    for (const t of body.toggles) if (t.enabled) enabled.add(t.name);
    return { ok: true, enabled, exchangeId };
  } catch (e) {
    return { ok: false, enabled, exchangeId, error: `invalid JSON: ${(e as Error).message}` };
  }
}

async function evalSdk(pool: SdkPool, target: Target, env: string, ctx: UnleashContext) {
  const entry = pool.get(target, env);
  await entry.ready;
  const results = new Map<string, { enabled: boolean; stale?: boolean }>();
  const status = { ...entry.status };
  if (!entry.client || entry.status.state !== 'ready') {
    return { ok: false, results, status, error: entry.status.lastError ?? `SDK ${entry.status.state}` };
  }
  for (const def of entry.client.getFeatureToggleDefinitions() ?? []) {
    results.set(def.name, {
      enabled: entry.client.isEnabled(def.name, ctx as any),
      stale: def.stale,
    });
  }
  return { ok: true, results, status };
}
