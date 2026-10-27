// tests/web_readonly_probe.mjs <api-url> <flag-service-url> - the read views refuse writes, even
// from an admin, as read-only, and answer within the reply wait. Every write targets a throwaway
// flag that the probe creates first and deletes at the end.
import { connect, ok, refused, done } from "./probe.mjs";

const admin = await connect(process.argv[2], "admin@example.com:demo");
const F = `zz-readonly-probe-${Date.now().toString(36)}`;
ok("create the throwaway flag", await admin.send({ t: "flash", table: "flag_edits", patch: {
  id: F, name: F, description: "probe", edit_scope: "all", created_by: "admin@example.com" } }));

for (const [table, rid, patch] of [
  ["flags", `flag:${F}`, { description: "hacked" }],
  ["flags", `flag:${F}`, { stale: true, tags: "x", name_sort: "x" }],
  ["flags", null, { name: `${F}-2` }],
  ["environments", `flag_env:${F}@production`, { enabled: true }],
  ["environments", `flag_env:${F}@production`, { default_rollout: 5, default_allowlist: "x", revision: 99 }],
  ["environments", null, { flag_name: F }],
  ["overrides", null, { scope: `${F}@uat`, rollout: 5 }],
  ["archived", `flag:${F}`, { name: "renamed" }],
  // invalid date: if this ever passes the API's read-only check, SurrealDB still refuses it
  ["history", null, { created_at: "not-a-date", summary: "forged entry" }],
  ["tags", null, { name: "zz-probe" }],
  ["config", "settings:main", { unused_flag_days: 1 }],
  ["flag_names", null, { name: "zz-probe" }],
  ["brands", "brand:bank-a", { display_name: "hacked" }],
  ["compiled", `flag_env:${F}@production`, { feature: "{}" }],
  ["usage", null, { flag: F, environment: "production", app_name: "x" }],
]) {
  const r = await admin.send({ t: "flash", table, ...(rid && { rid }), patch });
  refused(`write to ${table}: ${Object.keys(patch).join(",")}`, r, /read-only/);
}
for (const [table, rid] of [["flags", `flag:${F}`], ["environments", `flag_env:${F}@uat`], ["archived", `flag:${F}`]]) {
  refused(`delete via ${table}`, await admin.send({ t: "delete", table, rid }), /read-only/);
}
for (const [label, frame] of [
  ["read: flag list, first 200", { t: "open_table", table: "flags", sort: ["name_sort", "asc"], limit: 200 }],
  ["read: one flag", { t: "open_table", table: "flags", where: [["name", "eq", "debit-card-payments"]] }],
  ["read: one environment card", { t: "open_table", table: "environments", where: [["flag_name", "eq", "debit-card-payments"], ["env_key", "eq", "production"]] }],
  ["read: overrides of a card", { t: "open_table", table: "overrides", where: [["scope", "eq", "debit-card-payments@production"]] }],
  ["read: history of a flag", { t: "open_table", table: "history", where: [["flag", "eq", "debit-card-payments"]], sort: ["created_at", "desc"], limit: 50 }],
  ["read: archived", { t: "open_table", table: "archived" }],
]) {
  ok(label, await admin.send(frame));
}

ok("clean-up: archive", await admin.send({ t: "flash", table: "flag_edits", rid: `flag:${F}`,
  patch: { archived: true, archived_by: "admin@example.com" } }));
ok("clean-up: delete", await admin.send({ t: "delete", table: "flag_deletes", rid: `flag:${F}` }));
admin.close();
done();
