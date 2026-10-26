// tests/web_list_probe.mjs <api-url> <scope> - what the read-only `overrides` list holds for a scope
// on a fresh connection, and again after 4 s on the same subscription.
const ws = new WebSocket(process.argv[2].replace(/^http/, "ws") + "/v1/ws");
const scope = process.argv[3];
let id = 0;
const frames = [];
ws.onmessage = (m) => frames.push(JSON.parse(m.data));
ws.onopen = () => {
  ws.send(JSON.stringify({ t: "hello", id: ++id, protocol: 1, token: "admin@example.com:demo" }));
  ws.send(JSON.stringify({ t: "open_table", id: ++id, table: "overrides", where: [["scope", "eq", scope]] }));
  setTimeout(() => {
    for (const f of frames) if (["rows", "members", "changed"].includes(f.t)) console.log(f.t, JSON.stringify(f.ids ?? f.events ?? []));
    ws.close();
  }, 4500);
};
