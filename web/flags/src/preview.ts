// "Would this brand / customer get the flag?" for the flag page's preview (spec 05 screen 3).
//
// The Vantage API can't run server logic for signed-in staff (FEEDBACK.md), so the page
// evaluates what SDKs receive itself: the feature the flag service compiled is run through
// Unleash's own rules for the only shapes we compile - `flexibleRollout` with IN / NOT_IN
// constraints - using Unleash's percentage hash (murmur3, x86 32-bit, seed 0). The SDK
// service evaluates the same JSON with Unleash's engine; tests/preview_parity.ts compares.

export type Constraint = { contextName: string; operator: string; values: string[]; inverted?: boolean; caseInsensitive?: boolean };
export type Strategy = { name: string; constraints?: Constraint[]; parameters?: Record<string, string> };
export type Feature = { name: string; enabled: boolean; strategies: Strategy[] };
export type Context = { userId?: string; sessionId?: string; properties: Record<string, string> };

/** murmur3 x86 32-bit of the text's UTF-8 bytes. */
export function murmur3(text: string, seed = 0): number {
  const bytes = new TextEncoder().encode(text);
  const data = (i: number) => bytes[i] ?? 0;
  const c1 = 0xcc9e2d51, c2 = 0x1b873593;
  let h = seed >>> 0;
  const blocks = bytes.length & ~3;
  for (let i = 0; i < blocks; i += 4) {
    let k = data(i) | (data(i + 1) << 8) | (data(i + 2) << 16) | (data(i + 3) << 24);
    k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  let k = 0;
  switch (bytes.length & 3) {
    case 3: k ^= data(blocks + 2) << 16; // falls through
    case 2: k ^= data(blocks + 1) << 8; // falls through
    case 1: k ^= data(blocks); k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k;
  }
  h ^= bytes.length;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** Unleash's bucket for an id in a group: 1..100. */
export const bucket = (id: string, groupId: string) => (murmur3(`${groupId}:${id}`) % 100) + 1;

function contextValue(ctx: Context, name: string): string | undefined {
  if (name === "userId") return ctx.userId;
  if (name === "sessionId") return ctx.sessionId;
  return ctx.properties[name];
}

function constraintHolds(c: Constraint, ctx: Context): boolean {
  const v = contextValue(ctx, c.contextName);
  const hit = v !== undefined && c.values.some((x) => (c.caseInsensitive ? x.toLowerCase() === v.toLowerCase() : x === v));
  const result = c.operator === "IN" ? hit : c.operator === "NOT_IN" ? !hit : false;
  return c.inverted ? !result : result;
}

function strategyHolds(s: Strategy, ctx: Context): boolean {
  if (!(s.constraints ?? []).every((c) => constraintHolds(c, ctx))) return false;
  if (s.name === "default") return true;
  if (s.name !== "flexibleRollout") return false;
  const p = s.parameters ?? {};
  const pct = Number(p.rollout ?? 0);
  const stickiness = p.stickiness ?? "default";
  // "default" stickiness: userId, else sessionId, else random - at 100% any value is inside.
  const id = stickiness === "default" ? (ctx.userId ?? ctx.sessionId ?? (pct >= 100 ? "random" : undefined)) : contextValue(ctx, stickiness);
  if (id === undefined) return false;
  return pct > 0 && bucket(id, p.groupId ?? "") <= pct;
}

/** What an SDK would answer for this context. */
export const isEnabled = (f: Feature, ctx: Context) => f.enabled && f.strategies.some((s) => strategyHolds(s, ctx));

export type Rule = { rollout: number; allowlist: string[] };

/**
 * Why: the same answer worked out from the saved rules (switch, which scope decides, allowlist,
 * rollout bucket), so a person sees the reason. `scope` is the brand override's name or
 * "the default rule".
 */
export function explain(opts: { enabled: boolean; env: string; scope: string; rule: Rule; customer: string; groupId: string }): { on: boolean; why: string } {
  const { enabled, env, scope, rule, customer, groupId } = opts;
  if (!enabled) return { on: false, why: `The ${env} switch is OFF, so nobody gets it.` };
  if (rule.rollout >= 100) return { on: true, why: `${scope} is ON for everyone.` };
  if (customer && rule.allowlist.includes(customer)) return { on: true, why: `Customer ${customer} is on the list of ${scope}.` };
  if (rule.rollout <= 0) {
    return { on: false, why: rule.allowlist.length ? `${scope} is ON only for its listed customers, and ${customer || "no customer"} isn't one.` : `${scope} is OFF.` };
  }
  if (!customer) return { on: false, why: `${scope} is ${rule.rollout}% of customers - a ${rule.rollout}% rollout needs a customer ID.` };
  const b = bucket(customer, groupId);
  return b <= rule.rollout
    ? { on: true, why: `Customer ${customer} falls at ${b}%, inside the ${rule.rollout}% rollout of ${scope}.` }
    : { on: false, why: `Customer ${customer} falls at ${b}%, outside the ${rule.rollout}% rollout of ${scope}.` };
}
