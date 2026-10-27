// tests/web_sort_probe.mjs <api-url> <flag-service-url> - the flags list keeps a name filter with
// either sort direction (a reversed sort once dropped the filter).
import { connect, equal, done, rows } from "./probe.mjs";

const CARD_FLAGS = ["card-freeze", "debit-card-payments", "virtual-cards"];
const s = await connect(process.argv[2], "support@example.com:demo");
for (const [dir, expected] of [["asc", CARD_FLAGS], ["desc", [...CARD_FLAGS].reverse()]]) {
  const r = await s.send({ t: "open_table", table: "flags", where: [["name", "like", "card"]], sort: ["name_sort", dir], limit: 200 });
  const byId = new Map(rows(r).map((x) => [x.id, x.name]));
  equal(`name like "card", sorted ${dir}`, (r.ids ?? []).map((i) => byId.get(i)), expected);
}
s.close();
done();
