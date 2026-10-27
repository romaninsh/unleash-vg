// tests/web_archive_probe.mjs <api-url> <flag-service-url> - Archive's writes as the web page sends
// them, on a temporary flag that the test deletes again (its history stays, by design).
import { connect, ok, refused, equal, done, rows, sleep } from "./probe.mjs";

const api = process.argv[2];
const name = `zz-archive-check-${Date.now().toString(36)}`, rid = `flag:${name}`;
const tom = await connect(api, "tom.berg@example.com:demo");
const admin = await connect(api, "admin@example.com:demo");

ok("tom creates the flag", await tom.send({ t: "flash", table: "flag_edits", patch: { id: name, name, edit_scope: "all", created_by: "tom.berg@example.com" } }));
ok("tom archives it", await tom.send({ t: "flash", table: "flag_edits", rid, patch: { archived: true, archived_by: "tom.berg@example.com" } }));
ok("tom revives it", await tom.send({ t: "flash", table: "flag_edits", rid, patch: { archived: false } }));
ok("tom archives it again", await tom.send({ t: "flash", table: "flag_edits", rid, patch: { archived: true, archived_by: "tom.berg@example.com" } }));
refused("tom deletes permanently (must be refused)", await tom.send({ t: "delete", table: "flag_deletes", rid }));
ok("admin deletes permanently", await admin.send({ t: "delete", table: "flag_deletes", rid }));
await sleep(1000);
const hist = await admin.send({ t: "open_table", table: "history", where: [["flag", "eq", name]], sort: ["created_at", "asc"] });
equal("history", rows(hist).map((r) => [r.created_by, r.summary]), [
  ["tom.berg@example.com", `Flag ${name} created`],
  ["tom.berg@example.com", `${name} archived`],
  ["tom.berg@example.com", `${name} revived (all environments switched off)`],
  ["tom.berg@example.com", `${name} archived`],
  ["admin@example.com", `${name} deleted permanently`],
]);
tom.close(); admin.close();
done();
