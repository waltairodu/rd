#!/bin/sh
# usage: sh tests/days.sh
# Runs the suites that build dates from "today" on three other days: the days when a race 30, 60 or 90 days away falls on
# 1 January (a date that looks like a date of birth to the privacy checks). Prints one line per suite; exits 1 if any fails.
# It takes about four minutes, so it is not part of tests/all.sh: run it before a release, and after any change to a date check.
cd "$(dirname "$0")"
fail=0
for k in 30 60 90; do
  skew=$(node -e "
    const k = $k, now = Date.now() + 5.5 * 3600000;
    const jan1 = Date.UTC(new Date(now).getUTCFullYear() + 1, 0, 1);
    console.log(String(jan1 - k * 86400000 + (now % 86400000) - now));")
  echo "== a race $k days away is on 1 January (clock moved by $skew ms) =="
  for s in print.mjs pentest-print.mjs runner-ui.mjs pentest-results.mjs results.mjs results-ui.mjs print-ui.mjs; do
    out=$(SKEW_MS=$skew sh run.sh -r ./skew.cjs $s 2>&1 | grep -E "passed|FAIL" | tr '\n' ' ')
    printf '%-20s %s\n' "$s" "$out"
    case "$out" in *" 0 failed"*) ;; *) fail=1 ;; esac
  done
done
[ $fail -eq 0 ] && echo "ALL DAYS OK" || echo "SOME DAY FAILED"
exit $fail
