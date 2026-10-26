// tests/web_sort_probe.mjs <api-url> - what the server returns for the flags list with a name
// filter combined with each sort direction (diagnosing a reversed sort that drops the filter).
const ws = new WebSocket(process.argv[2].replace(/^http/, "ws") + "/v1/ws");
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const f = JSON.parse(m.data);
  if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
};
const send = (f) => new Promise((res) => { f.id = ++id; pending.set(f.id, res); ws.send(JSON.stringify(f)); setTimeout(() => res({ t: "timeout" }), 10000); });
await new Promise((r) => (ws.onopen = r));
await send({ t: "hello", protocol: 1, token: "support@example.com:demo" });
for (const dir of ["asc", "desc"]) {
  const r = await send({ t: "open_table", table: "flags", where: [["name", "like", "test-"]], sort: ["name_sort", dir], limit: 200 });
  const recs = r.records ?? {};
  const names = (r.ids ?? []).slice(0, 4).map((i) => (Array.isArray(recs) ? recs.find((x) => x.id === i) : recs[i])?.name ?? i);
  console.log(dir, r.t, `total ${r.total}`, names.join(", "), r.message ?? "");
}
ws.close();
