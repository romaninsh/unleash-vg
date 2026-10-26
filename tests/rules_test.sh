#!/usr/bin/env bash
# tests/rules_test.sh - the database rules the admin app relies on (spec 09 acceptance A2's
# compilation examples are in service/src/compile/tests.rs), run on a throw-away SurrealDB database `rules_test`
# loaded from tests/schema.surql + tests/seed.surql + tests/events.surql.
set -uo pipefail
cd "$(dirname "$0")/.."
export SURREAL_DB=rules_test

echo "REMOVE DATABASE IF EXISTS rules_test;" | tests/surql.sh - -q >/dev/null
for f in schema seed events; do tests/surql.sh "tests/$f.surql" -q || { echo "FAIL - loading $f.surql"; exit 1; }; done

# Q <surql>: run, print the last statement's result as canonical JSON (sorted keys) or "ERR <message>".
Q() {
  echo "$1" | tests/surql.sh - -f 2>&1 | tail -1 | python3 -c '
import json, sys
line = sys.stdin.read().strip()
if " ERR " in line: print("ERR " + line.split(" ERR ", 1)[1]); sys.exit()
print(json.dumps(json.loads(line.split("  ", 1)[1]), sort_keys=True, separators=(",", ":")))'
}

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "FAIL - $1"; echo "  expected: $2"; echo "  got:      $3"; fail=1; fi; }
errs() { case "$2" in ERR*"$1"*) echo yes ;; *) echo "no: $2" ;; esac; }

# Compilation (spec 03's four examples) is tested in the flag service: service/src/compile/tests.rs.
# The flags below set up the database rules checked after them.
mk() { Q "CREATE flag:$1 SET name = '$1', description = 'test'; UPDATE type::record('flag_env', '$1@production') SET enabled = true;" >/dev/null; }

mk ex1
mk ex2
Q "CREATE brand_override SET scope = 'ex2@production', brand = brand:\`bank-c\`, rollout = 10, allowlist = '1001, 1002';
   CREATE brand_override SET scope = 'ex2@production', brand = brand:\`bank-b\`, rollout = 0;" >/dev/null
mk ex3
mk ex4

before="$(Q "RETURN (SELECT VALUE revision_id FROM environment ORDER BY sort_order);")"
Q "UPDATE flag_env:\`ex1@uat\` SET default_rollout = 50;" >/dev/null
after="$(Q "RETURN (SELECT VALUE revision_id FROM environment ORDER BY sort_order);")"
check "a uat change bumps only uat's revision" "same changed same" \
  "$(python3 -c 'import json,sys; b,a=json.loads(sys.argv[1]),json.loads(sys.argv[2]); print(" ".join("same" if x==y else "changed" for x,y in zip(b,a)))' "$before" "$after")"

check "flag names follow the Unleash format" yes "$(errs "name" "$(Q "CREATE flag:bad SET name = 'bad name!';")")"
check "flag names are unique including archived" yes "$(errs "already" "$(Q "CREATE flag:\`beta-budget-planner\` SET name = 'beta-budget-planner';")")"
check "only archived flags can be deleted" yes "$(errs "Only archived flags" "$(Q "DELETE flag:ex1;")")"
check "names sort with numbers by value, long numbers included" '["a-2","a-10","a-999999999999","a-1792248689566"]' \
  "$(Q "LET \$k = ['a-1792248689566', 'a-10', 'a-999999999999', 'a-2'].map(|\$n| { n: \$n, k: fn::natural_key(\$n) }); RETURN (SELECT n, k FROM \$k ORDER BY k).map(|\$r| \$r.n);")"
check "one environment of a flag can't be deleted" yes "$(errs "always has all its environments" "$(Q "DELETE flag_env:\`ex1@uat\`;")")"
check "new override copies the default rule" "50" \
  "$(Q "CREATE brand_override SET scope = 'ex1@uat', brand = brand:\`bank-a\`; RETURN (SELECT VALUE rollout FROM brand_override WHERE scope = 'ex1@uat')[0];")"
check "allowlists are tidied and de-duplicated" '"7,8,9"' \
  "$(Q "UPDATE flag_env:\`ex1@uat\` SET default_allowlist = ' 7 8
8;9,,7 '; RETURN flag_env:\`ex1@uat\`.default_allowlist;")"
check "inactive brands can't get new overrides" yes "$(errs "inactive" "$(Q "CREATE brand_override SET scope = 'ex1@uat', brand = brand:\`bank-f\`;")")"
check "a brand with overrides can't be deleted" yes "$(errs "deactivate it instead" "$(Q "DELETE brand:\`bank-a\`;")")"
check "audit events can't be changed" yes "$(errs "cannot be changed" "$(Q "UPDATE audit_event SET summary = 'x';")")"
Q "UPDATE flag:ex1 SET archived = true; UPDATE flag:ex1 SET archived = false;" >/dev/null
check "revive switches every environment OFF" "0" "$(Q "RETURN count(SELECT id FROM flag_env WHERE flag = flag:ex1 AND enabled = true);")"
check "archive stamps and revive clears archived_at" "null" "$(Q "RETURN flag:ex1.archived_at;")"
check "every rule change is audited" "1" \
  "$(Q "RETURN count(SELECT id FROM audit_event WHERE flag = 'ex2' AND type = 'feature-brand-override-added' AND brand = 'bank-c' AND summary CONTAINS '10% + 2 customers');")"
check "a failed change writes no audit event" "0" \
  "$(Q "CREATE brand_override SET scope = 'ex1@uat', brand = brand:\`bank-f\`; RETURN count(SELECT id FROM audit_event WHERE brand = 'bank-f' AND type CONTAINS 'override');" )"
Q "UPDATE flag_env:\`ex3@uat\` SET enabled = true, updated_by = 'tom.berg@example.com';" >/dev/null
Q "UPDATE flag_env:\`ex3@uat\` SET enabled = false;" >/dev/null
check "web changes are logged under the person, then attribution resets" '["tom.berg@example.com","admin"]' \
  "$(Q "RETURN (SELECT VALUE created_by FROM audit_event WHERE flag = 'ex3' AND environment = 'uat' ORDER BY created_at, summary DESC);")"
check "an override's env_key follows its scope" '"production"' \
  "$(Q "RETURN (SELECT VALUE env_key FROM brand_override WHERE scope = 'ex2@production')[0];")"
check "a token is stored as a hash only, with lookup and hint" '[true,true,"default:uat.0123456789ab...",null,true,true]' \
  "$(Q "CREATE api_token:t1 SET name = 'web token', type = 'frontend', environment = 'uat', new_secret = 'default:uat.0123456789abcdef0123456789abcdef', created_by = 'admin@example.com';
        LET \$t = api_token:t1;
        RETURN [string::starts_with(\$t.secret_hash, '\$argon2id'), crypto::argon2::compare(\$t.secret_hash, 'default:uat.0123456789abcdef0123456789abcdef'),
                \$t.hint, \$t.new_secret, \$t.lookup = 'default:uat.0123456789ab', record::id(\$t.environment) = 'uat'];")"
check "a token's secret can't be swapped later" yes "$(errs "secret_hash" "$(Q "UPDATE api_token:t1 SET secret_hash = crypto::argon2::generate('other');")")"
check "a temporary password is stored as a hash only and must be changed" '[true,null,true,true]' \
  "$(Q "UPDATE app_user SET new_password = 'Temp-Pass-1234' WHERE email = 'tom.berg@example.com';
        LET \$u = (SELECT * FROM app_user WHERE email = 'tom.berg@example.com')[0];
        RETURN [crypto::argon2::compare(\$u.password_hash, 'Temp-Pass-1234'), \$u.new_password, \$u.must_change_password,
                time::now() - \$u.password_changed_at < 1m];")"
check "a password set directly (desktop reset) is stamped too; other edits don't move the stamp" '[true,true]' \
  "$(Q "UPDATE app_user SET password_hash = crypto::argon2::generate('x') WHERE email = 'ana.silva@example.com';
        LET \$a = (SELECT VALUE password_changed_at FROM app_user WHERE email = 'ana.silva@example.com')[0];
        UPDATE app_user SET name = 'Ana S.' WHERE email = 'ana.silva@example.com';
        LET \$b = (SELECT VALUE password_changed_at FROM app_user WHERE email = 'ana.silva@example.com')[0];
        RETURN [\$a != NONE, \$a = \$b];")"
# (Vantage writes the audit log; here one entry stands in for the flag's history.)
Q "CREATE audit_event SET type = 'feature-created', flag = 'ex4', summary = 'Flag ex4 created';
   UPDATE flag:ex4 SET archived = true; DELETE flag:ex4;" >/dev/null
check "deleting an archived flag removes its environments and keeps its history" "[0,1]" \
  "$(Q "RETURN [count(SELECT id FROM flag_env WHERE flag = flag:ex4), count(SELECT id FROM audit_event WHERE flag = 'ex4' AND type = 'feature-created')];")"

# whole-card save from the web: one write carries the default rule and the complete override set
check "a card save applies the rule and every override in one write, under the person" \
  '[["bank-b"],30,null,null,"maria@example.com","maria@example.com"]' \
  "$(Q "UPDATE flag_env:\`ex1@uat\` SET default_rollout = 30, expected_revision = flag_env:\`ex1@uat\`.revision,
          pending_overrides = '[{\"brand\":\"bank-b\",\"rollout\":0,\"allowlist\":\"7\"}]', updated_by = 'maria@example.com';
        LET \$fe = flag_env:\`ex1@uat\`;
        RETURN [(SELECT VALUE brand.key FROM brand_override WHERE scope = 'ex1@uat'), \$fe.default_rollout, \$fe.pending_overrides,
                \$fe.expected_revision,
                (SELECT VALUE created_by FROM audit_event WHERE flag = 'ex1' AND type = 'feature-brand-override-removed')[0],
                (SELECT VALUE created_by FROM audit_event WHERE flag = 'ex1' AND type = 'feature-brand-override-added' AND brand = 'bank-b')[0]];")"
check "a card save from an old revision is refused and names who changed it" yes \
  "$(errs "Changed by maria@example.com" "$(Q "UPDATE flag_env:\`ex1@uat\` SET default_rollout = 77, expected_revision = 1, pending_overrides = '[]';")")"
check "a card save that fails anywhere changes nothing" '[30,["bank-b"]]' \
  "$(Q "UPDATE flag_env:\`ex1@uat\` SET default_rollout = 11, expected_revision = flag_env:\`ex1@uat\`.revision,
          pending_overrides = '[{\"brand\":\"bank-b\",\"rollout\":0},{\"brand\":\"bank-f\",\"rollout\":50}]';
        RETURN [flag_env:\`ex1@uat\`.default_rollout, (SELECT VALUE brand.key FROM brand_override WHERE scope = 'ex1@uat')];")"
check "there is always an active admin" yes \
  "$(errs "At least one active admin" "$(Q "UPDATE app_user SET role = 'viewer' WHERE email = 'admin@example.com';")")"
check "context field names are identifiers and differ" yes \
  "$(errs "customer_context_field" "$(Q "UPDATE settings:main SET customer_context_field = 'brand';")")"
check "web origins must be http(s) addresses" yes \
  "$(errs "frontend_cors_origins" "$(Q "UPDATE settings:main SET frontend_cors_origins = 'not a url';")")"
check "web origins are tidied: one per line, no trailing slash, no repeats" '"https://a.example\n*"' \
  "$(Q "UPDATE settings:main SET frontend_cors_origins = 'https://a.example/, https://a.example  *';
        RETURN settings:main.frontend_cors_origins;")"
check "tags in use are counted on live flags only" '[1,1,0]' \
  "$(Q "CREATE flag:tg1 SET name = 'tg1', tags = 'zz-one,zz-two';
        LET \$a = known_tag:\`zz-one\`.flags; LET \$b = known_tag:\`zz-two\`.flags;
        UPDATE flag:tg1 SET archived = true;
        RETURN [\$a, \$b, count(SELECT id FROM known_tag WHERE name IN ['zz-one', 'zz-two'])];")"
check "the list's search text, tag key and last activity are kept" '["tg2 pay by card",",cards,team:x,",true]' \
  "$(Q "CREATE flag:tg2 SET name = 'tg2', description = 'Pay by CARD', tags = 'Cards, team:x';
        RETURN [flag:tg2.search_text, flag:tg2.tags_key, flag:tg2.last_activity = <string> flag:tg2.created_at];")"

echo "REMOVE DATABASE IF EXISTS rules_test;" | tests/surql.sh - -q >/dev/null
if [ "$fail" = 0 ]; then echo "PASS: database rules hold"; else echo "FAIL"; exit 1; fi
