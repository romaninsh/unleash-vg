#!/usr/bin/env bash
# tests/surql.sh <file.surql | -> - run SurrealQL against the project's local SurrealDB (composer.yaml)
# and print one line per statement; exits 1 if any statement failed.
# Env: SURREAL_HTTP (base URL; default: the compose stack's published port, found from
# COMPOSE_PROJECT or `docker compose ls`), SURREAL_HTTP_AUTH (user:pass, default root:root; the
# level follows the NS/DB headers sent), SURREAL_NS/SURREAL_DB (default flags/flags).
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${SURREAL_HTTP:-}" ]; then
  # Vantage names the stack <installation>-<folder>-<hash>, so the folder name finds it.
  P="${COMPOSE_PROJECT:-$(docker compose ls --format json | python3 -c 'import json,sys; print(next(p["Name"] for p in json.load(sys.stdin) if sys.argv[1] in p["Name"]))' "$(basename "$PWD")")}"
  SURREAL_HTTP="http://127.0.0.1:$(docker compose -p "$P" -f composer.yaml port surrealdb 8000 | cut -d: -f2)"
fi
AUTH="${SURREAL_HTTP_AUTH:-root:root}"
NS="${SURREAL_NS:-flags}"; DB="${SURREAL_DB:-flags}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat "${1:--}" > "$TMP/all.surql"
# The HTTP endpoint refuses bodies over ~1 MB: big files (one statement per line) go in line chunks.
if [ "$(wc -c < "$TMP/all.surql")" -gt 900000 ]; then
  split -l 10 "$TMP/all.surql" "$TMP/part."
else
  mv "$TMP/all.surql" "$TMP/part.aa"
fi
status=0
for part in "$TMP"/part.*; do
{ echo "DEFINE NAMESPACE IF NOT EXISTS $NS; USE NS $NS; DEFINE DATABASE IF NOT EXISTS $DB; USE NS $NS DB $DB;"; cat "$part"; } > "$TMP/body"
curl -s -X POST "$SURREAL_HTTP/sql" -u "$AUTH" -H "Surreal-NS: $NS" -H "Surreal-DB: $DB" \
  -H "Accept: application/json" --data-binary "@$TMP/body" \
  | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    res = json.loads(raw)
except ValueError:
    print("ERR (not JSON)", raw[:2000]); sys.exit(1)
if isinstance(res, dict):
    print("ERR", res); sys.exit(1)
bad = 0
quiet = "-q" in sys.argv
for i, r in enumerate(res[4:], 1):
    if r["status"] != "OK":
        bad += 1
        print("#%d ERR %s" % (i, r["result"]))
    elif not quiet:
        out = json.dumps(r["result"], default=str)
        print("#%d OK  %s" % (i, out if "-f" in sys.argv else out[:400]))
sys.exit(1 if bad else 0)
' "${2:-}" || status=1
done
exit $status
