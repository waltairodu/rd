#!/bin/sh
# usage: tests/run.sh script.mjs
# Makes test copies of the Wix backend modules (setup key replaced), links the mock Wix modules, runs the script.
cd "$(dirname "$0")"
cp ../wix/director/rd-auth.js rd-auth.test.mjs
sed "s#'./rd-auth.js'#'./rd-auth.test.mjs'#; s#'./rd-privacy.js'#'./rd-privacy.test.mjs'#" ../wix/expo/exposoft.web.js > exposoft.test.mjs
# The helper files, as plain copies (the unit suites test them on their own)
cp ../wix/director/ai-core.js ai-core.test.mjs
cp ../wix/director/rd-approvals.js rd-approvals.test.mjs
cp ../wix/director/rd-finance.js rd-finance.test.mjs
cp ../wix/director/rd-results.js rd-results.test.mjs
sed "s#'./rd-results.js'#'./rd-results.test.mjs'#" ../wix/director/rd-print.js > rd-print.test.mjs
sed "s#'./rd-results.js'#'./rd-results.test.mjs'#" ../wix/director/rd-data.js > rd-data.test.mjs
sed "s#'./rd-results.js'#'./rd-results.test.mjs'#; s#'./rd-print.js'#'./rd-print.test.mjs'#" ../wix/director/rd-comms.js > rd-comms.test.mjs
sed "s#'./rd-results.js'#'./rd-results.test.mjs'#; s#'./rd-print.js'#'./rd-print.test.mjs'#; s#'./rd-comms.js'#'./rd-comms.test.mjs'#" ../wix/director/rd-waiver.js > rd-waiver.test.mjs
sed "s#'./rd-results.js'#'./rd-results.test.mjs'#; s#'./rd-comms.js'#'./rd-comms.test.mjs'#" ../wix/director/rd-privacy.js > rd-privacy.test.mjs
sed "s#'./rd-results.js'#'./rd-results.test.mjs'#; s#'./rd-comms.js'#'./rd-comms.test.mjs'#" ../wix/director/rd-report.js > rd-report.test.mjs
cp ../wix/director/rd-auth.js rd-auth.test.mjs
# The web modules are the built files, the ones the pack ships (tools/inline_backend.mjs puts the helper code inside each of them).
# Only the setup key is replaced, so that the tests can use it.
rm -rf built-tmp
node ../tools/inline_backend.mjs --out built-tmp || exit 1
for f in built-tmp/*.web.js; do
  b=$(basename "$f" .web.js)
  sed "s/^const SETUP_KEY = 'change-this-key'/const SETUP_KEY = 'k-test'/" "$f" > "$b.test.mjs"
done
echo "export { sha256 as __sha256 };" >> training.test.mjs
mkdir -p node_modules
for m in wix-web-module wix-data wix-auth wix-data.v2 wix-events.v2 wix-fetch wix-secrets-backend wix-crm-backend; do rm -rf node_modules/$m; ln -s ../mocks/$m node_modules/$m; done
node "$@"
