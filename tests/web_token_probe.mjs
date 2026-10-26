// tests/web_token_probe.mjs <web-api-url> <flag-service-url> - a token created the way the web
// admin page creates it works on the flag service, and stops working once revoked. Also adds,
// renames and deletes a scratch brand. Leaves only audit entries behind.
import { randomBytes } from "node:crypto";

const url = process.argv[2].replace(/^http/, "ws") + "/v1/ws";
const service = process.argv[3];
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const f = JSON.parse(m.data);
  if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
};
const send = (f) => new Promise((res) => { f.id = ++id; pending.set(f.id, res); ws.send(JSON.stringify(f)); setTimeout(() => res({ t: "timeout" }), 5000); });
await new Promise((r) => (ws.onopen = r));
await send({ t: "hello", protocol: 1, token: "admin@example.com:demo" });
const say = (what, r) => console.log(what.padEnd(52), r.t ?? r, r.message ?? "");

const secret = `default:production.${randomBytes(28).toString("hex")}`;
const created = await send({ t: "flash", table: "token_admin", patch: {
  name: "zz web probe", type: "backend", environment: "production", source: "created", new_secret: secret,
  created_by: "admin@example.com", admin_scope: "all" } });
say("admin creates a backend production token", created);
const features = await fetch(`${service}/api/client/features`, { headers: { Authorization: secret } });
const body = await features.json();
say("flag service accepts it", `${features.status} (${body.features?.length} flags, env ${body.query?.environment})`);
const tokens = await send({ t: "open_table", table: "token_admin", where: [] });
const recs = Array.isArray(tokens.records) ? tokens.records : Object.values(tokens.records ?? {});
const mine = recs.find((r) => r.name === "zz web probe");
say("stored without the secret", mine ? `hint=${mine.hint} new_secret=${mine.new_secret}` : "not found");
say("admin revokes it", await send({ t: "delete", table: "token_admin", rid: mine?.id }));
console.log("waiting 31 s for the service's token cache to expire…");
await new Promise((r) => setTimeout(r, 31000));
say("flag service now refuses it", String((await fetch(`${service}/api/client/features`, { headers: { Authorization: secret } })).status));

say("admin adds brand zz-probe", await send({ t: "flash", table: "brand_admin", patch: { id: "zz-probe", key: "zz-probe", display_name: "Probe", active: true, admin_scope: "all" } }));
say("admin renames it", await send({ t: "flash", table: "brand_admin", rid: "brand:zz-probe", patch: { display_name: "Probe Bank" } }));
say("admin deletes it", await send({ t: "delete", table: "brand_admin", rid: "brand:zz-probe" }));
say("deleting bank-b (has overrides) is refused", await send({ t: "delete", table: "brand_admin", rid: "brand:bank-b" }));
ws.close();
