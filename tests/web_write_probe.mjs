// tests/web_write_probe.mjs <api-url> - the web page's write paths over the raw protocol, as Maria
// (editor, all environments) and Tom (editor, no production). Uses a temporary flag zz-web-check;
// remove it afterwards with:  UPDATE flag:`zz-web-check` SET archived = true; DELETE flag:`zz-web-check`;
const url = process.argv[2].replace(/^http/, "ws") + "/v1/ws";

function connect(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const runs = new Map();
    const send = (f) => new Promise((res) => {
      f.id = ++id;
      pending.set(f.id, res);
      ws.send(JSON.stringify(f));
      setTimeout(() => res({ t: "timeout" }), 5000);
    });
    ws.onmessage = (m) => {
      const f = JSON.parse(m.data);
      if (f.t === "run" && (f.result !== undefined || f.error)) runs.get(f.run)?.(f);
      if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
    };
    const invoke = (action, args) => new Promise(async (res) => {
      const run = crypto.randomUUID();
      runs.set(run, res);
      await send({ t: "invoke", run, action, args });
      setTimeout(() => res({ t: "timeout" }), 8000);
    });
    ws.onopen = async () => resolve({ ws, send, invoke, hello: await send({ t: "hello", protocol: 1, token }) });
  });
}

const say = (what, r) => console.log(what.padEnd(46), r.t, r.message ?? (r.result ? JSON.stringify(r.result) : "") ?? "");
const maria = await connect("maria.lopez@example.com:demo");
say("maria signs in", maria.hello);
say("create flag zz-web-check", await maria.send({ t: "flash", table: "flag_edits", patch: {
  id: "zz-web-check", name: "zz-web-check", description: "temporary web check", tags: "web", edit_scope: "all",
  created_by: "maria.lopez@example.com", updated_by: "maria.lopez@example.com" } }));
const tomTry = await connect("support@example.com:demo");
say("viewer: create flag (must be refused)", await tomTry.send({ t: "flash", table: "flag_edits", patch: {
  id: "zz-viewer-check", name: "zz-viewer-check", edit_scope: "all", updated_by: "support@example.com" } }));
tomTry.ws.close();
say("switch uat on + 25%", await maria.send({ t: "flash", table: "environment_edits", rid: "flag_env:zz-web-check@uat",
  patch: { enabled: true, default_rollout: 25, updated_by: "maria.lopez@example.com" } }));
const add = await maria.send({ t: "flash", table: "override_edits",
  patch: { scope: "zz-web-check@uat", brand: "brand:bank-c", env_key: "uat", updated_by: "maria.lopez@example.com" } });
say("add override bank-c (copies default)", add);
// the page takes ids from the read-only `overrides` list, which re-reads every 2 s
await new Promise((r) => setTimeout(r, 3000));
const listed = await maria.send({ t: "open_table", table: "overrides", where: [["scope", "eq", "zz-web-check@uat"]] });
const listId = listed.ids?.[0];
console.log("  override id from the list:", listId, "| id in the flash reply:", add.rid ?? add.record?.id);
const key = String(add.rid ?? add.record?.id).split(":").slice(1).join(":");
for (const candidate of [`brand_override:${key}`, `web_override_edit:${key}`, key]) {
  const r = await maria.send({ t: "open_records", table: "override_edits", ids: [candidate] });
  console.log("  open_records override_edits", candidate.padEnd(46), "found:", (r.records && Object.keys(r.records).length) || 0, "missing:", JSON.stringify(r.missing ?? []));
}
const rid = add.rid ?? add.record?.id;
say("change override to OFF + 2 customers", await maria.send({ t: "flash", table: "override_edits", rid,
  patch: { rollout: 0, allowlist: "77 78", updated_by: "maria.lopez@example.com" } }));
await maria.send({ t: "flash", table: "override_edits", rid, patch: { updated_by: "maria.lopez@example.com" } });
say("remove override", await maria.send({ t: "delete", table: "override_edits", rid }));
say("mark stale", await maria.send({ t: "flash", table: "flag_edits", rid: "flag:zz-web-check", patch: { stale: true, updated_by: "maria.lopez@example.com" } }));

const tom = await connect("tom.berg@example.com:demo");
say("tom: switch production on (must be refused)", await tom.send({ t: "flash", table: "environment_edits", rid: "flag_env:zz-web-check@production",
  patch: { enabled: true, updated_by: "tom.berg@example.com" } }));
say("tom: add production override (must be refused)", await tom.send({ t: "flash", table: "override_edits",
  patch: { scope: "zz-web-check@production", brand: "brand:bank-a", env_key: "production", updated_by: "tom.berg@example.com" } }));

const hist = await maria.send({ t: "open_table", table: "history", where: [["flag", "eq", "zz-web-check"]], sort: ["created_at", "asc"] });
const recs = Array.isArray(hist.records) ? hist.records : Object.values(hist.records ?? {});
console.log("  history rows:", recs.length);
for (const r of recs) console.log("  history:", String(r.created_by).padEnd(26), r.summary);
maria.ws.close(); tom.ws.close();
