// tests/web_list_probe.mjs <api-url> <flag-service-url> - the read-only `overrides` list for the
// seeded scope chat-support@uat (one override) on a fresh connection, and that the same
// subscription still holds it after the list's 2 s re-read.
import { connect, equal, done, sleep } from "./probe.mjs";

const SCOPE = "chat-support@uat", OVERRIDE = "brand_override:4379ed0ecbbf7dd102cac01e20bc3ba7";
const s = await connect(process.argv[2], "admin@example.com:demo");
const first = await s.send({ t: "open_table", table: "overrides", where: [["scope", "eq", SCOPE]] });
equal(`${SCOPE}: the seeded override`, first.ids, [OVERRIDE]);
await sleep(3000);
const members = s.pushed.filter((f) => f.sub === first.sub && f.t === "members").at(-1)?.ids ?? first.ids;
equal(`${SCOPE}: the subscription still holds it after a re-read`, members, [OVERRIDE]);
s.close();
done();
