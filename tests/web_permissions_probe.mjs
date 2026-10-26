// tests/web_permissions_probe.mjs <api-url> <token> - checks the flags web API's permissions over
// the raw protocol (node 22+). Writes only no-op patches (updated_by: null), so no data changes.
const url = process.argv[2], token = process.argv[3];
const ws = new WebSocket(url.replace(/^http/, "ws") + "/v1/ws");
let id = 0;
const pending = new Map();
const send = (f) => new Promise((res) => {
  f.id = ++id;
  pending.set(f.id, res);
  ws.send(JSON.stringify(f));
  setTimeout(() => res({ t: "timeout" }), 4000);
});
ws.onmessage = (m) => {
  const f = JSON.parse(m.data);
  if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
};
ws.onopen = async () => {
  const hello = await send({ t: "hello", protocol: 1, token });
  console.log("sign-in:", hello.t, hello.principal ?? hello.message ?? "");
  if (hello.t !== "welcome") { ws.close(); return; }
  const me = await send({ t: "open_table", table: "me" });
  console.log("me:", JSON.stringify(Object.values(me.records ?? {})[0] ?? me));
  for (const env of ["development", "uat", "production"]) {
    const r = await send({ t: "flash", table: "environment_edits", rid: `flag_env:test@${env}`, patch: { updated_by: null } });
    console.log(`edit ${env}:`, r.t, r.message ?? "");
  }
  const fl = await send({ t: "flash", table: "flag_edits", rid: "flag:test", patch: { updated_by: null } });
  console.log("edit flag metadata:", fl.t, fl.message ?? "");
  const all = await send({ t: "open_table", table: "flags", limit: 3 });
  console.log("read flags:", all.t, "total", all.total);
  ws.close();
};
