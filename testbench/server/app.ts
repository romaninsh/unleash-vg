import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { listBrands } from './brands.ts';
import { ENVIRONMENTS, type BenchConfig, type Target } from './config.ts';
import { evaluate } from './evaluate.ts';
import { Recorder } from './recorder.ts';
import { SDK_REFRESH_MS, SdkPool } from './sdk-pool.ts';
import { LIMITS, StressRun, validateOptions, type StressSnapshot } from './stress.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** Hop-by-hop / length headers that must not be copied when relaying a buffered body. */
const SKIP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export interface BenchApp {
  server: Server;
  recorder: Recorder;
  pool: SdkPool;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createBenchApp(config: BenchConfig, opts: { staticDir?: string } = {}): BenchApp {
  const recorder = new Recorder();
  let boundPort = config.port;
  const pool = new SdkPool(
    (t, env) => `http://127.0.0.1:${boundPort}/proxy/${encodeURIComponent(t.name)}/${env}/api/`,
  );
  let stress: StressRun | undefined;
  const stressHistory: StressSnapshot[] = [];
  const targets = new Map(config.targets.map((t) => [t.name, t]));
  const sseClients = new Set<ServerResponse>();

  function broadcast(event: string, data: unknown) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(line);
  }
  recorder.subscribe((ex) => broadcast('exchange', ex));

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://bench');
    const path = url.pathname;

    if (path.startsWith('/proxy/')) return proxy(req, res, path, url.search);

    if (path === '/bench/targets' && req.method === 'GET') {
      return sendJson(res, 200, {
        sdkRefreshMs: SDK_REFRESH_MS,
        targets: config.targets.map((t) => ({
          name: t.name,
          baseUrl: t.baseUrl,
          contextFields: t.contextFields,
          brandSource: t.brands.type,
          environments: ENVIRONMENTS.map((env) => ({
            key: env,
            backend: Boolean(t.tokens[env]?.backend),
            frontend: Boolean(t.tokens[env]?.frontend),
          })),
        })),
      });
    }

    if (path === '/bench/brands' && req.method === 'GET') {
      const t = targetOr404(url.searchParams.get('target'), res);
      if (!t) return;
      return sendJson(res, 200, await listBrands(t.brands));
    }

    if (path === '/bench/evaluate' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const t = targetOr404(body.target, res);
      if (!t) return;
      if (!ENVIRONMENTS.includes(body.environment)) return sendJson(res, 400, { error: 'unknown environment' });
      const result = await evaluate({ recorder, pool }, t, body.environment, {
        brand: body.brand || null,
        customer: body.customer || null,
      });
      return sendJson(res, 200, result);
    }

    if (path === '/bench/sdk-reset' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      pool.reset(String(body.target), String(body.environment));
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/bench/exchanges' && req.method === 'GET') return sendJson(res, 200, recorder.list());
    if (path === '/bench/exchanges' && req.method === 'DELETE') {
      recorder.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/bench/stream' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (path === '/bench/stress' && req.method === 'GET') {
      return sendJson(res, 200, { limits: LIMITS, current: stress?.snapshot(), history: stressHistory });
    }

    if (path === '/bench/stress/start' && req.method === 'POST') {
      if (stress && stress.snapshot().state !== 'done' && stress.snapshot().state !== 'failed') {
        return sendJson(res, 409, { error: 'a stress run is already in progress' });
      }
      let opts;
      try {
        opts = validateOptions(JSON.parse((await readBody(req)) || '{}'));
      } catch (e) {
        return sendJson(res, 400, { error: (e as Error).message });
      }
      const t = targetOr404(opts.target, res);
      if (!t) return;
      const run = new StressRun(opts, t, pool);
      stress = run;
      const tick = setInterval(() => broadcast('stress', run.snapshot()), 500);
      run.done.then(() => {
        clearInterval(tick);
        const final = run.snapshot();
        stressHistory.unshift(final);
        stressHistory.splice(20);
        broadcast('stress', final);
      });
      return sendJson(res, 202, run.snapshot());
    }

    if (path === '/bench/stress/watch' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      stress?.setWatch(typeof body.flag === 'string' ? body.flag : undefined);
      if (stress) broadcast('stress', stress.snapshot());
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/bench/flags' && req.method === 'GET') {
      const t = targetOr404(url.searchParams.get('target'), res);
      if (!t) return;
      const entry = pool.get(t, url.searchParams.get('environment') ?? 'production');
      await entry.ready;
      const names = (entry.client?.getFeatureToggleDefinitions() ?? []).map((d) => d.name).sort();
      return sendJson(res, 200, { flags: names, error: entry.status.lastError });
    }

    // One flag's compiled definition, fetched on demand (whole sets can be tens of MB).
    if (path === '/bench/definition' && req.method === 'GET') {
      const t = targetOr404(url.searchParams.get('target'), res);
      if (!t) return;
      const entry = pool.get(t, url.searchParams.get('environment') ?? 'production');
      await entry.ready;
      const def = entry.client?.getFeatureToggleDefinition(url.searchParams.get('flag') ?? '');
      return sendJson(res, def ? 200 : 404, def ?? { error: 'not in the client API payload' });
    }

    if (path === '/bench/stress/stop' && req.method === 'POST') {
      stress?.stop();
      return sendJson(res, 200, { ok: true });
    }

    if (path.startsWith('/bench/')) return sendJson(res, 404, { error: 'not found' });
    return serveStatic(res, path);
  }

  /** /proxy/<target>/<env>/<rest> → <baseUrl>/<rest>; used by the SDK instances. */
  async function proxy(req: IncomingMessage, res: ServerResponse, path: string, search: string) {
    const [, , rawName, env, ...rest] = path.split('/');
    const t = targetOr404(decodeURIComponent(rawName ?? ''), res);
    if (!t) return;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === 'connection' || k === 'content-length' || v === undefined) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const r = await recorder.fetch(
      { target: t.name, environment: env ?? '?', source: 'sdk' },
      `${t.baseUrl}/${rest.join('/')}${search}`,
      { method: req.method, headers, body },
    );
    if (r.status === undefined) return sendJson(res, 502, { error: r.exchange.error });
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (!SKIP_RESPONSE_HEADERS.has(k)) out[k] = v;
    });
    res.writeHead(r.status, out);
    res.end(r.body);
  }

  function targetOr404(name: unknown, res: ServerResponse): Target | undefined {
    const t = typeof name === 'string' ? targets.get(name) : undefined;
    if (!t) sendJson(res, 404, { error: `unknown target ${String(name)}` });
    return t;
  }

  function serveStatic(res: ServerResponse, path: string) {
    const dir = opts.staticDir;
    if (!dir || !existsSync(dir)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('UI not built — run `npm start`');
    }
    let file = normalize(join(dir, path));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) file = join(dir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }

  return {
    server,
    recorder,
    pool,
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          boundPort = (server.address() as AddressInfo).port;
          resolve(boundPort);
        });
      });
    },
    close() {
      stress?.stop();
      pool.destroyAll();
      for (const r of sseClients) r.end();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
