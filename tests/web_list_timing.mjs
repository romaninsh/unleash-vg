// tests/web_list_timing.mjs <api-url> - how long the web API takes to deliver the flags list.
const ws = new WebSocket(process.argv[2].replace(/^http/, "ws") + "/v1/ws");
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const f = JSON.parse(m.data);
  if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
};
const send = (f) => new Promise((res) => { f.id = ++id; pending.set(f.id, res); ws.send(JSON.stringify(f)); setTimeout(() => res({ t: "timeout" }), 30000); });
await new Promise((r) => (ws.onopen = r));
await send({ t: "hello", protocol: 1, token: "support@example.com:demo" });
for (const [label, frame] of [
  ["whole list", { t: "open_table", table: "flags", sort: ["name", "asc"] }],
  ["first 50", { t: "open_table", table: "flags", sort: ["name", "asc"], limit: 50 }],
  ["search 'test-49'", { t: "open_table", table: "flags", where: [["name", "like", "test-49"]] }],
]) {
  const t0 = performance.now();
  const r = await send(frame);
  console.log(label.padEnd(18), r.t, `${(r.ids ?? []).length} rows of ${r.total}`, `${Math.round(performance.now() - t0)} ms`);
}
ws.close();
