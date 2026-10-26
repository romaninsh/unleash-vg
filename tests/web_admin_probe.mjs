// tests/web_admin_probe.mjs <api-url> - the admin screens' entities answer admins only.
// Read-only: opens each entity as an admin, an editor and a viewer and counts rows.
const url = process.argv[2].replace(/^http/, "ws") + "/v1/ws";

async function rowsFor(token, tables) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const f = JSON.parse(m.data);
    if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
  };
  const send = (f) => new Promise((res) => { f.id = ++id; pending.set(f.id, res); ws.send(JSON.stringify(f)); setTimeout(() => res({ t: "timeout" }), 5000); });
  await new Promise((r) => (ws.onopen = r));
  await send({ t: "hello", protocol: 1, token });
  const out = {};
  for (const table of tables) {
    const r = await send({ t: "open_table", table });
    out[table] = r.t === "rows" ? (r.ids ?? []).length : `${r.t}: ${r.message ?? ""}`;
  }
  ws.close();
  return out;
}

const tables = ["brand_admin", "token_admin", "user_admin", "settings_admin"];
for (const who of ["admin@example.com", "maria.lopez@example.com", "support@example.com"]) {
  console.log(who.padEnd(26), JSON.stringify(await rowsFor(`${who}:demo`, tables)));
}
