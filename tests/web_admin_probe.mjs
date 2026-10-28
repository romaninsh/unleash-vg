// tests/web_admin_probe.mjs <api-url> <flag-service-url> - the admin screens' entities answer
// admins only. Opens each entity as an admin, an editor and a viewer. The seed has no API tokens,
// so the admin creates a throwaway one first and deletes it at the end.
import { randomBytes } from "node:crypto";
import { connect, ok, check, done, rows } from "./probe.mjs";

const api = process.argv[2];
const admin = await connect(api, "admin@example.com:demo");
const token = `zz admin probe ${Date.now().toString(36)}`;
ok("admin creates a throwaway token", await admin.send({ t: "flash", table: "token_admin", patch: {
  name: token, type: "backend", environment: "development", source: "created",
  new_secret: `default:development.${randomBytes(28).toString("hex")}`, created_by: "admin@example.com", admin_scope: "all" } }));

const tables = ["brand_admin", "token_admin", "user_admin", "settings_admin"];
for (const [who, isAdmin] of [["admin@example.com", true], ["maria.lopez@example.com", false], ["support@example.com", false]]) {
  const s = who === "admin@example.com" ? admin : await connect(api, `${who}:demo`);
  for (const table of tables) {
    const r = await s.send({ t: "open_table", table });
    const n = (r.ids ?? []).length;
    if (isAdmin) check(`${who}: ${table} has rows`, r.t === "rows" && n > 0, `${r.t}, ${n} rows ${r.message ?? ""}`);
    else check(`${who}: ${table} is empty`, r.t === "rows" && n === 0, `${r.t}, ${n} rows ${r.message ?? ""}`);
  }
  if (s !== admin) s.close();
}

const mine = rows(await admin.send({ t: "open_table", table: "token_admin", where: [] })).find((r) => r.name === token);
ok("clean-up: admin deletes the token", await admin.send({ t: "delete", table: "token_admin", rid: mine?.id }));
admin.close();
done();
