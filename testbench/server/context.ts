import type { Target } from './config.ts';

/** Fields the Unleash context carries at top level; everything else lives in `properties`. */
const TOP_LEVEL = new Set(['userId', 'sessionId', 'remoteAddress', 'environment', 'appName', 'currentTime']);

export interface Selection {
  brand: string | null;
  customer: string | null;
}

export interface UnleashContext {
  appName: string;
  environment: string;
  userId?: string;
  sessionId?: string;
  properties: Record<string, string>;
  [k: string]: unknown;
}

export function buildContext(target: Target, environment: string, sel: Selection): UnleashContext {
  const ctx: UnleashContext = { appName: 'testbench', environment, properties: {} };
  const put = (field: string, value: string) => {
    if (TOP_LEVEL.has(field)) ctx[field] = value;
    else ctx.properties[field] = value;
  };
  if (sel.customer) put(target.contextFields.customer, sel.customer);
  if (sel.brand) put(target.contextFields.brand, sel.brand);
  return ctx;
}

/** Query string the way browser/mobile SDKs send it: top-level fields plain, the rest as properties[x]. */
export function frontendQuery(ctx: UnleashContext): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'properties' || v === undefined) continue;
    q.append(k, String(v));
  }
  for (const [k, v] of Object.entries(ctx.properties)) q.append(`properties[${k}]`, v);
  return q.toString();
}
