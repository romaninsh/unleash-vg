// tests/web_readonly_probe.mjs <api-url> - the read views refuse writes (even from an admin)
// and answer quickly. Every write targets a throwaway flag, zz-readonly-probe, which the probe
// creates first; remove it afterwards with:
//   echo "DELETE flag:\`zz-readonly-probe\`;" | tests/surql.sh
const ws = new WebSocket(process.argv[2].replace(/^http/, "ws") + "/v1/ws");
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const f = JSON.parse(m.data);
  if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
};
const send = (f) => new Promise((res) => { f.id = ++id; pending.set(f.id, res); ws.send(JSON.stringify(f)); setTimeout(() => res({ t: "timeout" }), 10000); });
await new Promise((r) => (ws.onopen = r));
await send({ t: "hello", protocol: 1, token: "admin@example.com:demo" });

const F = "zz-readonly-probe";
const made = await send({ t: "flash", table: "flag_edits", patch: { id: F, name: F, description: "probe", edit_scope: "all", created_by: "probe", updated_by: "probe" } });
console.log("throwaway flag:".padEnd(26), made.t, made.message ?? "");

let bad = 0;
for (const [table, rid, patch] of [
  ["flags", `flag:${F}`, { description: "hacked" }],
  ["flags", `flag:${F}`, { stale: true, tags: "x", name_sort: "x" }],
  ["environments", `flag_env:${F}@production`, { is_on: true }],
  ["environments", `flag_env:${F}@production`, { rule_rollout: 5, rule_allowlist: "x", rule_revision: 99 }],
  ["environments", `flag_env:${F}@production`, { detail: "x", seen: "x", default_label: "x" }],
  ["overrides", null, { scope: `${F}@uat`, rollout: 5 }],
  ["flags", null, { name: "zz-readonly-probe-2" }],
  ["environments", null, { flag_name: F }],
  ["archived", `flag:${F}`, { name: "renamed" }],
  // invalid date: if this ever passes the API's read-only check, SurrealDB still refuses it
  ["history", null, { created_at: "not-a-date", summary: "forged entry" }],
  ["tags", null, { name: "zz-probe" }],
  ["config", "settings:main", { unused_flag_days: 1 }],
  ["flag_names", null, { name: "zz-probe" }],
  ["brands", "brand:bank-a", { display_name: "hacked" }],
  // read-only by naming (like environments): the database refuses the unknown field
  ["compiled", `flag_env:${F}@production`, { served: "{}" }],
  ["usage", `flag_env:${F}@production`, { usage_day: "x", seen_text: "x" }],
]) {
  const r = await send({ t: "flash", table, ...(rid && { rid }), patch });
  // environments relies on the database refusing (table/web_env.yaml); the rest must be
  // refused by the API itself as read-only
  const byNaming = ["environments", "compiled", "usage"].includes(table);
  if (r.t === "flashed" || (!byNaming && !/read-only/.test(r.message ?? ""))) bad++;
  console.log(`write to ${table}:`.padEnd(26), Object.keys(patch).join(","), "->", r.t === "flashed" ? "ACCEPTED (bad)" : `refused (${r.t}: ${(r.message ?? "").slice(0, 70)})`);
}
for (const [table, rid] of [["flags", `flag:${F}`], ["environments", `flag_env:${F}@uat`], ["archived", `flag:${F}`]]) {
  const r = await send({ t: "delete", table, rid });
  if (r.t === "flashed" || r.t === "deleted") bad++;
  console.log(`delete via ${table}:`.padEnd(26), r.t === "rejected" ? `refused (${(r.message ?? "").slice(0, 70)})` : `${r.t} (bad)`);
}
for (const [label, frame] of [
  ["flag list, first 200", { t: "open_table", table: "flags", sort: ["name_sort", "asc"], limit: 200 }],
  ["one flag", { t: "open_table", table: "flags", where: [["name", "eq", "debit-card-payments"]] }],
  ["one environment card", { t: "open_table", table: "environments", where: [["flag_name", "eq", "debit-card-payments"], ["env_key", "eq", "production"]] }],
  ["overrides of a card", { t: "open_table", table: "overrides", where: [["scope", "eq", "debit-card-payments@production"]] }],
  ["history of a flag", { t: "open_table", table: "history", where: [["flag", "eq", "debit-card-payments"]], sort: ["created_at", "desc"], limit: 50 }],
  ["archived", { t: "open_table", table: "archived" }],
]) {
  const t0 = performance.now();
  const r = await send(frame);
  console.log(label.padEnd(26), r.t, `${(r.ids ?? []).length} rows`, `${Math.round(performance.now() - t0)} ms`);
}
console.log(bad ? `FAIL: ${bad} write(s) accepted` : "OK: every write refused");
ws.close();
process.exitCode = bad ? 1 : 0;
