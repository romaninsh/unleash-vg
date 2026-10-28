#!/usr/bin/env bash
# tests/import_default_tokens.sh - add the six fixed local-development SDK tokens
# (docs/spec/reference-data/default-tokens.json, the bench's example config uses them) to the
# local stack's database, through the flag service's own `import-token`. Local only: these
# secrets are public, never import them into a hosted database. Skips a token that is already
# there, so it can run again. Env: COMPOSE_PROJECT (default: found from the folder name).
set -euo pipefail
cd "$(dirname "$0")/.."
P="${COMPOSE_PROJECT:-$(docker compose ls --format json | python3 -c 'import json,sys; print(next(p["Name"] for p in json.load(sys.stdin) if sys.argv[1] in p["Name"]))' "$(basename "$PWD")")}"
python3 -c 'import json; [print(t["name"], t["type"], t["environment"], t["secret"], sep="\t") for t in json.load(open("docs/spec/reference-data/default-tokens.json"))["tokens"]]' |
  while IFS=$'\t' read -r name type env secret; do
    # by name: the backend and frontend secrets of one environment share their first 24
    # characters (the lookup), so the lookup can't tell them apart
    have="$(echo "RETURN count(SELECT id FROM api_token WHERE name = '$name');" | tests/surql.sh - -f | tail -1 | sed 's/^#1 OK  //')"
    if [ "$have" != "0" ]; then echo "already there: $name"; continue; fi
    # < /dev/null: exec would otherwise read the loop's remaining lines
    docker compose -p "$P" -f composer.yaml exec -T flag-service flag-service import-token "$name" "$type" "$env" "$secret" < /dev/null
  done
