import { describe, expect, it } from "vitest";
import { isConflict, problems, rolloutFor, sameRules, saveFields, type Draft } from "./card-draft";

const draft: Draft = {
  baseRev: 7,
  def: { rollout: 25, allowlist: " 1, 2 2;3 " },
  overrides: [{ brand: "bank-b", rollout: 0, allowlist: "" }],
};

describe("card draft", () => {
  it("picking % from ON or OFF starts at 50, and keeps a partial rollout", () => {
    expect(rolloutFor("%", 100)).toBe(50);
    expect(rolloutFor("%", 0)).toBe(50);
    expect(rolloutFor("%", 30)).toBe(30);
    expect(rolloutFor("ON", 30)).toBe(100);
  });
  it("compares allowlists as the database stores them", () => {
    expect(sameRules(draft, { def: { rollout: 25, allowlist: "1,2,3" }, overrides: [{ brand: "bank-b", rollout: 0, allowlist: "" }] })).toBe(true);
    expect(sameRules(draft, { def: { rollout: 25, allowlist: "1,2" }, overrides: draft.overrides })).toBe(false);
    expect(sameRules(draft, { def: draft.def, overrides: [] })).toBe(false);
  });
  it("saves the rule and the full override set in one write", () => {
    expect(saveFields(draft, "ann@example.com")).toEqual({
      default_rollout: 25,
      default_allowlist: "1,2,3",
      pending_overrides: '[{"brand":"bank-b","rollout":0,"allowlist":""}]',
      expected_revision: 7,
      updated_by: "ann@example.com",
    });
  });
  it("lists what stops a save, including lists hidden behind ON", () => {
    const big = Array.from({ length: 1001 }, (_, i) => String(i)).join(",");
    const d: Draft = { baseRev: 1, def: { rollout: 100, allowlist: big }, overrides: [{ brand: "bank-f", rollout: 50, allowlist: "" }] };
    const p = problems(d, new Map([["bank-f", "Roadside Club"]]), new Set(["bank-a"]), new Set());
    expect(p).toEqual(["Default rule: 1001 customers - at most 1000 per rule", "Roadside Club is inactive - it can't get a new override"]);
    // an override that already exists for an inactive brand may still be changed
    expect(problems({ ...d, def: { rollout: 100, allowlist: "" } }, new Map(), new Set(), new Set(["bank-f"]))).toEqual([]);
  });
  it("recognises the database's conflict message", () => {
    expect(isConflict("Error while processing event flag_env_changes: An error occurred: Changed by tom@x at 2026-10-17T10:00:00Z - your edits were not saved")).toBe(true);
    expect(isConflict("The value isn't allowed")).toBe(false);
  });
});
