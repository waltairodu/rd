#!/bin/sh
# Runs every test suite once, prints the results by kind of test and writes docs/TESTING.md.
# Exits non-zero if any check fails or an older suite passes fewer checks than tests/baseline.txt.
cd "$(dirname "$0")"
[ -d node_modules/jsdom ] || npm i --no-audit --no-fund jsdom@24 >/dev/null 2>&1
exec python3 report.py "$@"
