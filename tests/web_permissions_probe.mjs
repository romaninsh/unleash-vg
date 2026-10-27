// tests/web_permissions_probe.mjs <api-url> <flag-service-url> - what each seeded role may change,
// over the raw protocol. Writes only no-op patches on the seeded flag `test`: an environment's
// switch set to the value it has, and edit_scope "all", which the database always sets.
import { connect, ok, refused, equal, done, rows } from "./probe.mjs";

const api = process.argv[2];
const ENVS = ["development", "uat", "production"];
for (const [email, editable, editsFlags] of [
  ["admin@example.com", ENVS, true],
  ["maria.lopez@example.com", ENVS, true],
  ["tom.berg@example.com", ["development", "uat"], true],
  ["support@example.com", [], false],
]) {
  const s = await connect(api, `${email}:demo`);
  const me = rows(await s.send({ t: "open_table", table: "me" }))[0];
  equal(`${email}: me`, me?.email, email);
  for (const env of ENVS) {
    const rid = `flag_env:test@${env}`;
    const current = rows(await s.send({ t: "open_records", table: "environment_edits", ids: [rid] }))[0];
    if (editable.includes(env)) {
      ok(`${email}: edit ${env}`, await s.send({ t: "flash", table: "environment_edits", rid, patch: { enabled: current?.enabled } }));
    } else {
      equal(`${email}: ${env} is out of reach`, current, undefined);
      refused(`${email}: edit ${env} (must be refused)`, await s.send({ t: "flash", table: "environment_edits", rid, patch: { enabled: false } }));
    }
  }
  const flag = await s.send({ t: "flash", table: "flag_edits", rid: "flag:test", patch: { edit_scope: "all" } });
  if (editsFlags) ok(`${email}: edit flag metadata`, flag);
  else refused(`${email}: edit flag metadata (must be refused)`, flag);
  const all = await s.send({ t: "open_table", table: "flags", limit: 3 });
  ok(`${email}: read flags`, all);
  s.close();
}
done();
