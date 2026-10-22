#!/bin/sh
# Runs every test suite. Exits non-zero if any fails.
cd "$(dirname "$0")"
[ -d node_modules/jsdom ] || npm i --no-audit --no-fund jsdom@24 >/dev/null 2>&1
rc=0
for t in scen.mjs ui.mjs director.mjs plan.mjs director-ui.mjs plan-ui.mjs coaching-ui.mjs pagecode.mjs training.mjs training-ui.mjs rd-ui.mjs; do
  out=$(./run.sh "$t" 2>&1); code=$?
  printf '%s: %s\n' "$t" "$(echo "$out" | tail -1)"
  [ $code -eq 0 ] || { rc=1; echo "$out" | grep FAIL; }
done
exit $rc
