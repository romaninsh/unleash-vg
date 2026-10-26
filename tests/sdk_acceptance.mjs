// tests/sdk_acceptance.mjs <sdk-dir> <base-url> <backend-token> <frontend-token>
// Spec 09 A3 with official SDKs: the backend Node SDK (unleash-client, evaluating locally from
// /api/client/features) and the frontend SDK (unleash-proxy-client, asking /api/frontend) must
// give the spec 03 truth tables. <sdk-dir> holds node_modules with both packages.
import { createRequire } from "node:module";
import path from "node:path";

const [sdkDir, base, backendToken, frontendToken] = process.argv.slice(2);
const require = createRequire(path.join(path.resolve(sdkDir), "package.json"));
const { initialize } = require("unleash-client");
const { UnleashClient, InMemoryStorageProvider } = require("unleash-proxy-client");

// [flag, context, expected] - production, sample data (spec 03 examples 2, 3, 4; A3).
const cases = [
  ["debit-card-payments", { userId: "5", properties: { brand: "bank-a" } }, true],
  ["debit-card-payments", { userId: "5" }, true],                                  // no brand -> default
  ["debit-card-payments", {}, true],                                               // nothing at all, 100% -> ON
  ["debit-card-payments", { userId: "1001", properties: { brand: "bank-b" } }, false],
  ["debit-card-payments", { userId: "1001", properties: { brand: "bank-c" } }, true], // allowlist
  ["debit-card-payments", { properties: { brand: "bank-c" } }, false],             // partial rollout, no customer -> OFF
  ["sso-login", { properties: { brand: "bank-a" } }, true],                        // example 3
  ["sso-login", { properties: { brand: "bank-b" } }, false],
  ["sso-login", {}, false],
  ["legacy-transfer-screen", { userId: "5" }, false],                              // example 4
  ["push-notifications-v2", { userId: "3001" }, true],                             // 10% + allowlisted
  ["new-onboarding-flow", {}, false],                                              // 25%, no customer -> OFF
];

let fail = 0;
const check = (who, [flag, ctx, want], got) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${who.padEnd(9)} ${flag.padEnd(24)} ${JSON.stringify(ctx).padEnd(48)} want ${want} got ${got}`);
};

// Backend SDK: fetches /api/client/features and evaluates locally.
const backend = initialize({ url: `${base}/api`, appName: "acceptance-backend", customHeaders: { Authorization: backendToken },
  refreshInterval: 60000, metricsInterval: 0, disableMetrics: true });
await new Promise((resolve, reject) => { backend.once("synchronized", resolve); backend.once("error", reject); });
for (const c of cases) check("backend", c, backend.isEnabled(c[0], { ...c[1] }));
backend.destroy();

// Frontend SDK: one client per context, as an app would after updateContext().
for (const c of cases) {
  const client = new UnleashClient({ url: `${base}/api/frontend`, clientKey: frontendToken, appName: "acceptance-frontend",
    refreshInterval: 0, disableMetrics: true, storageProvider: new InMemoryStorageProvider(), context: c[1] });
  await client.start();
  check("frontend", c, client.isEnabled(c[0]));
  client.stop();
}

console.log(fail ? `FAIL: ${fail} case(s)` : "PASS: official SDKs agree with spec 03");
process.exit(fail ? 1 : 0);
