// tests/web_admin_probe.mjs <api-url> <flag-service-url> - the admin screens' entities answer
// admins only. Read-only: opens each entity as an admin, an editor and a viewer.
import { connect, check, done } from "./probe.mjs";

const api = process.argv[2];
const tables = ["brand_admin", "token_admin", "user_admin", "settings_admin"];
for (const [who, admin] of [["admin@example.com", true], ["maria.lopez@example.com", false], ["support@example.com", false]]) {
  const s = await connect(api, `${who}:demo`);
  for (const table of tables) {
    const r = await s.send({ t: "open_table", table });
    const n = (r.ids ?? []).length;
    if (admin) check(`${who}: ${table} has rows`, r.t === "rows" && n > 0, `${r.t}, ${n} rows ${r.message ?? ""}`);
    else check(`${who}: ${table} is empty`, r.t === "rows" && n === 0, `${r.t}, ${n} rows ${r.message ?? ""}`);
  }
  s.close();
}
done();
