#!/usr/bin/env bash
# tests/audit_leak_check.sh - no audit entry carries a password, a token secret or their hashes:
# counts audit_event rows whose pre_data or data has one of those keys, prints the count only (the
# rows themselves may hold the secret) and exits 1 when it isn't 0. Database: as tests/surql.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
KEYS="'\"password\"', '\"new_password\"', '\"password_hash\"', '\"new_secret\"', '\"secret_hash\"'"
out="$(echo "RETURN count(SELECT id FROM audit_event WHERE
  [$KEYS].any(|\$k| string::contains((pre_data ?? '') + ' ' + (data ?? ''), \$k)));" | tests/surql.sh - -f)" \
  || { echo "FAIL - audit leak check could not query the database"; exit 1; }
n="$(echo "$out" | tail -1 | sed -n 's/^#1 OK  //p')"
if [ "$n" = "0" ]; then
  echo "ok - no audit entry holds a password, a secret or a hash"
else
  echo "FAIL - ${n:-?} audit entries hold a password, a secret or a hash"
  exit 1
fi
