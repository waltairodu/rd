#!/bin/sh
# usage: tests/run.sh script.mjs
# Makes test copies of the Wix backend modules (setup key replaced), links the mock Wix modules, runs the script.
cd "$(dirname "$0")"
cp ../wix/director/rd-auth.js rd-auth.test.mjs
sed "s#'./rd-auth.js'#'./rd-auth.test.mjs'#" ../wix/expo/exposoft.web.js > exposoft.test.mjs
cp ../wix/director/ai-core.js ai-core.test.mjs
cp ../wix/director/rd-approvals.js rd-approvals.test.mjs
if [ -f ../wix/director/racedir.web.js ]; then
  sed "s/^const SETUP_KEY = 'change-this-key'/const SETUP_KEY = 'k-test'/; s#'./ai-core.js'#'./ai-core.test.mjs'#; s#'./rd-approvals.js'#'./rd-approvals.test.mjs'#; s#'./rd-auth.js'#'./rd-auth.test.mjs'#" ../wix/director/racedir.web.js > racedir.test.mjs
fi
if [ -f ../wix/training/training.web.js ]; then
  sed "s/^const SETUP_KEY = 'change-this-key'/const SETUP_KEY = 'k-test'/; s#'./ai-core.js'#'./ai-core.test.mjs'#; s#'./rd-auth.js'#'./rd-auth.test.mjs'#" ../wix/training/training.web.js > training.test.mjs
  echo "export { sha256 as __sha256 };" >> training.test.mjs
fi
if [ -f ../wix/director/finance.web.js ]; then
  cp ../wix/director/rd-finance.js rd-finance.test.mjs
  sed "s#'./rd-auth.js'#'./rd-auth.test.mjs'#; s#'./rd-finance.js'#'./rd-finance.test.mjs'#" ../wix/director/finance.web.js > finance.test.mjs
fi
if [ -f ../wix/director/results.web.js ]; then
  cp ../wix/director/rd-results.js rd-results.test.mjs
  sed "s#'./rd-auth.js'#'./rd-auth.test.mjs'#; s#'./rd-results.js'#'./rd-results.test.mjs'#" ../wix/director/results.web.js > results.test.mjs
fi
mkdir -p node_modules
for m in wix-web-module wix-data wix-auth wix-data.v2 wix-events.v2 wix-fetch wix-secrets-backend; do rm -rf node_modules/$m; ln -s ../mocks/$m node_modules/$m; done
node "$@"
