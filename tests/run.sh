#!/bin/sh
# usage: tests/run.sh script.mjs
# Makes test copies of the Wix backend modules (setup key replaced), links the mock Wix modules, runs the script.
cd "$(dirname "$0")"
sed "s/^const SETUP_KEY = 'change-this-key'/const SETUP_KEY = 'k-test'/" ../wix/expo/exposoft.web.js > exposoft.test.mjs
cp ../wix/director/ai-core.js ai-core.test.mjs
cp ../wix/director/rd-approvals.js rd-approvals.test.mjs
if [ -f ../wix/director/racedir.web.js ]; then
  sed "s/^const SETUP_KEY = 'change-this-key'/const SETUP_KEY = 'k-test'/; s#'./ai-core.js'#'./ai-core.test.mjs'#; s#'./rd-approvals.js'#'./rd-approvals.test.mjs'#" ../wix/director/racedir.web.js > racedir.test.mjs
fi
if [ -f ../wix/training/training.web.js ]; then
  sed "s/^const SETUP_KEY = 'change-this-key'/const SETUP_KEY = 'k-test'/; s#'./ai-core.js'#'./ai-core.test.mjs'#" ../wix/training/training.web.js > training.test.mjs
  echo "export { sha256 as __sha256 };" >> training.test.mjs
fi
mkdir -p node_modules
for m in wix-web-module wix-data wix-auth wix-data.v2 wix-events.v2 wix-fetch wix-secrets-backend; do rm -rf node_modules/$m; ln -s ../mocks/$m node_modules/$m; done
node "$@"
