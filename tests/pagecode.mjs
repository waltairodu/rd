// The page code finds its HTML embed even when the element ID is missing or wrong.
import fs from 'fs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const files = [['director/director-page-code.js', '#dirFrame'], ['director/volunteer-page-code.js', '#volFrame'], ['training/athlete-page-code.js', '#trainFrame'], ['training/coach-page-code.js', '#coachFrame'], ['expo/exposoft-page-code.js', '#expoFrame']];
for (const [f, id] of files) {
  const src = fs.readFileSync('../wix/' + f, 'utf8').replace(/^import .*$/gm, '');
  for (const mode of ['byId', 'wrongId', 'noEmbed']) {
    let ready, attached = 0, errs = [];
    const comp = { onMessage: () => { attached++; }, postMessage: () => {} };
    const $w = (sel) => {
      if (sel === id) return mode === 'byId' ? comp : {};            // a missing element has no onMessage
      if (sel === 'HtmlComponent') return mode === 'noEmbed' ? {} : comp;
      return {};
    };
    $w.onReady = (fn) => { ready = fn; };
    const wixLocation = { query: {} };
    const con = { error: (m) => errs.push(m) };
    const g = new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'console', src + '\n; return 0;');
    g($w, wixLocation, {}, {}, {}, {}, con);
    let threw = false;
    try { ready(); } catch (e) { threw = true; }
    ok(!threw, f + ' [' + mode + ']: onReady does not throw');
    if (mode !== 'noEmbed') ok(attached === 1, f + ' [' + mode + ']: message handler attached');
    else ok(attached === 0 && errs.length === 1 && /No HTML embed/.test(errs[0]), f + ' [noEmbed]: clear console message instead of a crash');
  }
}
console.log(`Page code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
