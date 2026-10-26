/** Every HTTP exchange with a target goes through here so the UI can inspect it. */

export type ExchangeSource = 'frontend-api' | 'sdk';

export interface Exchange {
  id: number;
  at: string;
  target: string;
  environment: string;
  source: ExchangeSource;
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

const MAX_EXCHANGES = 300;
const MAX_BODY = 256 * 1024;

type Listener = (e: Exchange) => void;

export class Recorder {
  private items: Exchange[] = [];
  private nextId = 1;
  private listeners = new Set<Listener>();

  list(): Exchange[] {
    return [...this.items].reverse();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear(): void {
    this.items = [];
  }

  private push(e: Exchange): void {
    this.items.push(e);
    if (this.items.length > MAX_EXCHANGES) this.items.shift();
    for (const l of this.listeners) l(e);
  }

  /** fetch() wrapper that records request and response. Never throws for HTTP errors. */
  async fetch(
    meta: { target: string; environment: string; source: ExchangeSource },
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ exchange: Exchange; status?: number; headers: Headers; body: string }> {
    const method = init.method ?? 'GET';
    const started = performance.now();
    const exchange: Exchange = {
      id: this.nextId++,
      at: new Date().toISOString(),
      ...meta,
      method,
      url,
      requestHeaders: redact(init.headers ?? {}),
      requestBody: truncate(init.body),
      responseHeaders: {},
      durationMs: 0,
    };
    try {
      const res = await fetch(url, {
        method,
        headers: init.headers,
        body: init.body,
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text();
      exchange.status = res.status;
      exchange.responseHeaders = Object.fromEntries(res.headers.entries());
      exchange.responseBody = truncate(body);
      exchange.durationMs = Math.round(performance.now() - started);
      this.push(exchange);
      return { exchange, status: res.status, headers: res.headers, body };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      exchange.error = err.cause?.code ? `${err.cause.code}: ${err.message}` : err.message;
      exchange.durationMs = Math.round(performance.now() - started);
      this.push(exchange);
      return { exchange, headers: new Headers(), body: '' };
    }
  }
}

function truncate(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY) + `\n… truncated (${s.length} bytes total)` : s;
}

/** Show enough of a token to identify it, not enough to reuse it from a screenshot. */
function redact(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = k.toLowerCase() === 'authorization' && v.length > 24 ? `${v.slice(0, 24)}…(${v.length} chars)` : v;
  }
  return out;
}
