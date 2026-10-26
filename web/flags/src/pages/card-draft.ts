// The staged edits of one environment card (spec 05 screen 3): the default rule and every
// brand override, saved together in one write that the database applies atomically and
// refuses when the card changed since `baseRev` (tests/events.surql, flag_env_changes).
import { allowlistProblems, listItems } from "../format";

export type Mode = "OFF" | "ON" | "%";
export type Rule = { rollout: number; allowlist: string };
export type OverrideDraft = Rule & { brand: string };
export type Draft = { baseRev: number; def: Rule; overrides: OverrideDraft[] };

export const modeOf = (rollout: number): Mode => (rollout >= 100 ? "ON" : rollout <= 0 ? "OFF" : "%");
/** The rollout after picking a mode: % from ON or OFF starts at 50. */
export const rolloutFor = (mode: Mode, current: number) =>
  mode === "ON" ? 100 : mode === "OFF" ? 0 : current > 0 && current < 100 ? current : 50;

const canon = (r: Rule) => `${r.rollout}|${listItems(r.allowlist).join(",")}`;

/** Same rules (allowlists compared as the database stores them: split, de-duplicated). */
export function sameRules(a: Omit<Draft, "baseRev">, b: Omit<Draft, "baseRev">): boolean {
  if (canon(a.def) !== canon(b.def) || a.overrides.length !== b.overrides.length) return false;
  const byBrand = new Map(b.overrides.map((o) => [o.brand, o]));
  return a.overrides.every((o) => { const x = byBrand.get(o.brand); return !!x && canon(o) === canon(x); });
}

/**
 * Everything that would stop a save, in words. `active` = brand keys that may get a new
 * override; `saved` = brands that already have one here.
 */
export function problems(d: Draft, names: Map<string, string>, active: Set<string>, saved: Set<string>): string[] {
  const out: string[] = [];
  const check = (label: string, r: Rule) => {
    if (!Number.isInteger(r.rollout) || r.rollout < 0 || r.rollout > 100) out.push(`${label}: the percentage must be a whole number from 1 to 99`);
    // a list is kept even when hidden behind ON, so it is checked too
    for (const p of allowlistProblems(r.allowlist)) out.push(`${label}: ${p}`);
  };
  check("Default rule", d.def);
  for (const o of d.overrides) {
    const name = names.get(o.brand) ?? o.brand;
    check(name, o);
    if (!saved.has(o.brand) && !active.has(o.brand)) out.push(`${name} is inactive - it can't get a new override`);
  }
  return out;
}

/** The write that saves a draft: the rule fields plus the complete override set as JSON. */
export function saveFields(d: Draft, by: string) {
  return {
    default_rollout: d.def.rollout,
    default_allowlist: listItems(d.def.allowlist).join(","),
    pending_overrides: JSON.stringify(d.overrides.map((o) => ({ brand: o.brand, rollout: o.rollout, allowlist: listItems(o.allowlist).join(",") }))),
    expected_revision: d.baseRev,
    updated_by: by,
  };
}

/** "Changed by X at T - …" from the database means someone else saved this card first. */
export const isConflict = (message: string) => /Changed by .+ at /.test(message);
