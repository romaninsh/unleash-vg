// tests/web_write_probe.mjs <api-url> <flag-service-url> - the web page's write paths over the raw
// protocol, as Maria (editor, all environments) and Tom (editor, no production), on a temporary
// flag that the admin deletes again at the end (its history stays, by design).
import { connect, ok, refused, equal, done, rows, sleep } from "./probe.mjs";

const api = process.argv[2];
const F = `zz-web-check-${Date.now().toString(36)}`;
const maria = await connect(api, "maria.lopez@example.com:demo");

ok("maria creates the flag", await maria.send({ t: "flash", table: "flag_edits", patch: {
  id: F, name: F, description: "temporary web check", tags: "web", edit_scope: "all", created_by: "maria.lopez@example.com" } }));
const viewer = await connect(api, "support@example.com:demo");
refused("viewer: create a flag (must be refused)", await viewer.send({ t: "flash", table: "flag_edits", patch: {
  id: `${F}-viewer`, name: `${F}-viewer`, edit_scope: "all" } }));
viewer.close();
ok("switch uat on + 25%", await maria.send({ t: "flash", table: "environment_edits", rid: `flag_env:${F}@uat`,
  patch: { enabled: true, default_rollout: 25, updated_by: "maria.lopez@example.com" } }));
ok("add override bank-c (copies the default)", await maria.send({ t: "flash", table: "override_edits",
  patch: { scope: `${F}@uat`, brand: "brand:bank-c", env_key: "uat" } }));
// the page takes override ids from the read-only `overrides` list, which re-reads every 2 s
await sleep(3000);
const listed = await maria.send({ t: "open_table", table: "overrides", where: [["scope", "eq", `${F}@uat`]] });
equal("the override is listed", (listed.ids ?? []).length, 1);
const rid = listed.ids?.[0];
ok("change the override to 2 customers only", await maria.send({ t: "flash", table: "override_edits", rid,
  patch: { rollout: 0, allowlist: "77,78" } }));
ok("remove the override", await maria.send({ t: "delete", table: "override_edits", rid }));
ok("mark stale", await maria.send({ t: "flash", table: "flag_edits", rid: `flag:${F}`, patch: { stale: true } }));

const tom = await connect(api, "tom.berg@example.com:demo");
refused("tom: switch production on (must be refused)", await tom.send({ t: "flash", table: "environment_edits",
  rid: `flag_env:${F}@production`, patch: { enabled: true, updated_by: "tom.berg@example.com" } }));
refused("tom: add a production override (must be refused)", await tom.send({ t: "flash", table: "override_edits",
  patch: { scope: `${F}@production`, brand: "brand:bank-a", env_key: "production" } }));
tom.close();

const hist = await maria.send({ t: "open_table", table: "history", where: [["flag", "eq", F]], sort: ["created_at", "asc"] });
equal("history", rows(hist).map((r) => [r.created_by, r.summary]), [
  ["maria.lopez@example.com", `Flag ${F} created`],
  ["maria.lopez@example.com", "uat switched ON, Default: ON -> 25%"],
  ["maria.lopez@example.com", "uat - Greenfield Stores: override added, 25%"],
  ["maria.lopez@example.com", "uat - Greenfield Stores: 25% -> Only 2 customers"],
  ["maria.lopez@example.com", "uat - Greenfield Stores: override removed (was Only 2 customers, now follows default)"],
  ["maria.lopez@example.com", `${F} marked stale`],
]);

ok("clean-up: archive", await maria.send({ t: "flash", table: "flag_edits", rid: `flag:${F}`,
  patch: { archived: true, archived_by: "maria.lopez@example.com" } }));
maria.close();
const admin = await connect(api, "admin@example.com:demo");
ok("clean-up: admin deletes it", await admin.send({ t: "delete", table: "flag_deletes", rid: `flag:${F}` }));
admin.close();
done();
