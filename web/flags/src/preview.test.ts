import { describe, expect, it } from "vitest";
import { bucket, explain, isEnabled, murmur3, type Context, type Feature } from "./preview";

describe("murmur3 (x86 32-bit, seed 0)", () => {
  it("matches the reference values", () => {
    expect(murmur3("")).toBe(0);
    expect(murmur3("hello")).toBe(0x248bfa47);
    expect(murmur3("Hello, world!")).toBe(0xc0363e43);
    expect(murmur3("The quick brown fox jumps over the lazy dog")).toBe(0x2e4ff723);
  });
  it("buckets are 1..100", () => {
    for (let i = 0; i < 500; i++) {
      const b = bucket(String(i), "flag");
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(100);
    }
  });
});

// spec 03 shape: brand override (bank-c 10% + customers 1001,1002), default ON for others but bank-b OFF
const feature: Feature = {
  name: "pay",
  enabled: true,
  strategies: [
    { name: "flexibleRollout", constraints: [{ contextName: "brand", operator: "IN", values: ["bank-c"] }], parameters: { rollout: "10", stickiness: "userId", groupId: "pay" } },
    { name: "flexibleRollout", constraints: [{ contextName: "brand", operator: "IN", values: ["bank-c"] }, { contextName: "userId", operator: "IN", values: ["1001", "1002"] }], parameters: { rollout: "100", stickiness: "default", groupId: "pay" } },
    { name: "flexibleRollout", constraints: [{ contextName: "brand", operator: "NOT_IN", values: ["bank-b", "bank-c"] }], parameters: { rollout: "100", stickiness: "default", groupId: "pay" } },
  ],
};
const ctx = (brand?: string, userId?: string): Context => ({ userId, properties: brand ? { brand } : {} });

describe("isEnabled", () => {
  it("follows brand overrides, allowlists and the default rule", () => {
    expect(isEnabled(feature, ctx("bank-c", "1001"))).toBe(true); // allowlisted
    expect(isEnabled(feature, ctx("bank-b", "1001"))).toBe(false); // override OFF
    expect(isEnabled(feature, ctx("bank-a"))).toBe(true); // default ON, no customer needed
    expect(isEnabled(feature, ctx())).toBe(true); // no brand: default
    expect(isEnabled(feature, ctx("bank-c"))).toBe(false); // 10% needs a customer id
  });
  it("puts a customer in the rollout exactly when their bucket is within it", () => {
    for (const id of ["5", "77", "4242", "9999"]) {
      expect(isEnabled(feature, ctx("bank-c", id))).toBe(bucket(id, "pay") <= 10);
    }
  });
  it("is OFF when the switch is off", () => {
    expect(isEnabled({ ...feature, enabled: false }, ctx("bank-a"))).toBe(false);
  });
});

describe("explain", () => {
  const base = { env: "production", scope: "the Greenfield Stores override", groupId: "pay" };
  it("says why", () => {
    expect(explain({ ...base, enabled: false, rule: { rollout: 100, allowlist: [] }, customer: "" }).why).toMatch(/switch is OFF/);
    expect(explain({ ...base, enabled: true, rule: { rollout: 10, allowlist: ["1001"] }, customer: "1001" })).toMatchObject({ on: true });
    expect(explain({ ...base, enabled: true, rule: { rollout: 10, allowlist: [] }, customer: "" }).why).toMatch(/needs a customer ID/);
    expect(explain({ ...base, enabled: true, rule: { rollout: 0, allowlist: [] }, customer: "1" })).toEqual({ on: false, why: "the Greenfield Stores override is OFF." });
  });
});
