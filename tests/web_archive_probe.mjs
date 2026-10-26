// tests/web_archive_probe.mjs <api-url> - Archive's writes as the web page sends them, on a
// temporary flag zz-archive-check that the test deletes again (its history stays, by design).
const url = process.argv[2].replace(/^http/, "ws") + "/v1/ws";

function connect(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const send = (f) => new Promise((res) => {
      f.id = ++id;
      pending.set(f.id, res);
      ws.send(JSON.stringify(f));
      setTimeout(() => res({ t: "timeout" }), 5000);
    });
    ws.onmessage = (m) => {
      const f = JSON.parse(m.data);
      if (f.id && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
    };
    ws.onopen = async () => { await send({ t: "hello", protocol: 1, token }); resolve({ ws, send }); };
  });
}

const say = (what, r) => console.log(what.padEnd(48), r.t, r.message ?? "");
const name = "zz-archive-check", rid = `flag:${name}`;
const tom = await connect("tom.berg@example.com:demo");
const admin = await connect("admin@example.com:demo");

say("tom creates the flag", await tom.send({ t: "flash", table: "flag_edits", patch: { id: name, name, edit_scope: "all", created_by: "tom.berg@example.com", updated_by: "tom.berg@example.com" } }));
say("tom archives it", await tom.send({ t: "flash", table: "flag_edits", rid, patch: { archived: true, updated_by: "tom.berg@example.com" } }));
say("tom revives it", await tom.send({ t: "flash", table: "flag_edits", rid, patch: { archived: false, updated_by: "tom.berg@example.com" } }));
say("tom archives it again", await tom.send({ t: "flash", table: "flag_edits", rid, patch: { archived: true, updated_by: "tom.berg@example.com" } }));
say("tom deletes permanently (must be refused)", await tom.send({ t: "delete", table: "flag_deletes", rid }));
say("admin marks it", await admin.send({ t: "flash", table: "flag_deletes", rid, patch: { updated_by: "admin@example.com" } }));
say("admin deletes permanently", await admin.send({ t: "delete", table: "flag_deletes", rid }));
await new Promise((r) => setTimeout(r, 3500)); // history re-reads every 3 s
const hist = await admin.send({ t: "open_table", table: "history", where: [["flag", "eq", name]], sort: ["created_at", "asc"] });
const recs = Array.isArray(hist.records) ? hist.records : Object.values(hist.records ?? {});
for (const r of recs) console.log("  history:", String(r.created_by).padEnd(24), r.summary);
tom.ws.close(); admin.ws.close();
