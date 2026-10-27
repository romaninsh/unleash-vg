// tests/web_token_probe.mjs <api-url> <flag-service-url> - a token created the way the web admin
// page creates it works on the flag service, and stops working once revoked (after the service's
// token cache lifetime, TOKEN_CACHE_SECS, default 1). Also adds, renames and deletes a scratch
// brand. Leaves only audit entries behind.
import { randomBytes } from "node:crypto";
import { connect, ok, refused, equal, check, done, rows, sleep } from "./probe.mjs";

const [api, service] = process.argv.slice(2);
const cacheSecs = Number(process.env.TOKEN_CACHE_SECS ?? 1);
const run = Date.now().toString(36);
const admin = await connect(api, "admin@example.com:demo");

// the flag service's reply status, or the reason it gave none
async function features(secret) {
  try {
    const r = await fetch(`${service}/api/client/features`, { headers: { Authorization: secret }, signal: AbortSignal.timeout(5000) });
    return { status: r.status, body: r.ok ? await r.json() : null };
  } catch (e) {
    return { status: `no reply from ${service}: ${e.message}` };
  }
}

const name = `zz web probe ${run}`;
const secret = `default:production.${randomBytes(28).toString("hex")}`;
ok("admin creates a backend production token", await admin.send({ t: "flash", table: "token_admin", patch: {
  name, type: "backend", environment: "production", source: "created", new_secret: secret,
  created_by: "admin@example.com", admin_scope: "all" } }));
const accepted = await features(secret);
check("the flag service accepts it for production", accepted.status === 200 && accepted.body?.query?.environment === "production",
  `status ${accepted.status}, environment ${accepted.body?.query?.environment}`);
const mine = rows(await admin.send({ t: "open_table", table: "token_admin", where: [] })).find((r) => r.name === name);
check("it is stored with a hint and without the secret", mine?.hint && !mine.new_secret && !JSON.stringify(mine).includes(secret),
  mine ? `hint=${mine.hint} new_secret=${mine.new_secret}` : "not found");
ok("admin revokes it", await admin.send({ t: "delete", table: "token_admin", rid: mine?.id }));
await sleep((cacheSecs + 1) * 1000);
equal("the flag service now refuses it", (await features(secret)).status, 401);

const brand = `zz-probe-${run}`;
ok("admin adds a scratch brand", await admin.send({ t: "flash", table: "brand_admin", patch: { id: brand, key: brand, display_name: "Probe", active: true, admin_scope: "all" } }));
ok("admin renames it", await admin.send({ t: "flash", table: "brand_admin", rid: `brand:${brand}`, patch: { display_name: "Probe Bank" } }));
ok("admin deletes it", await admin.send({ t: "delete", table: "brand_admin", rid: `brand:${brand}` }));
refused("deleting bank-b, which has overrides (must be refused)", await admin.send({ t: "delete", table: "brand_admin", rid: "brand:bank-b" }));
admin.close();
done();
