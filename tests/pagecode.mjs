// The page code finds its HTML embed even when the element ID is missing or wrong.
import fs from 'fs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const files = [['director/director-page-code.js', '#dirFrame'], ['director/volunteer-page-code.js', '#volFrame'], ['training/athlete-page-code.js', '#trainFrame'], ['training/coach-page-code.js', '#coachFrame'], ['expo/exposoft-page-code.js', '#expoFrame']];
for (const [f, id] of files) {
  const src = fs.readFileSync('../wix/' + f, 'utf8').replace(/^import .*$/gm, '');
  for (const mode of ['byId', 'wrongId', 'noEmbed']) {
    let ready, attached = 0, errs = [];
    let handler = null;
    const comp = { onMessage: (fn) => { attached++; handler = fn; }, postMessage: () => {} };
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
    if (mode === 'byId') {
      await handler({ data: { kind: 'resize', height: 1234.4 } });
      ok(comp.height === 1234, f + ': resize message sets the embed height');
      await handler({ data: { kind: 'resize', height: 40 } });
      ok(comp.height === 300, f + ': height never below 300');
      await handler({ data: { kind: 'resize', height: 99999 } });
      ok(comp.height === 20000, f + ': height capped at 20000');
      comp.height = 777; await handler({ data: { kind: 'resize', height: 'abc' } }); await handler({ data: { kind: 'resize' } });
      ok(comp.height === 777, f + ': a bad height is ignored');
    }
    if (mode !== 'noEmbed') ok(attached === 1, f + ' [' + mode + ']: message handler attached');
    else ok(attached === 0 && errs.length === 1 && /No HTML embed/.test(errs[0]), f + ' [noEmbed]: clear console message instead of a crash');
  }
}

// The director page code answers with an error (instead of staying silent) for a method it does not list or a backend that lacks it.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  let ready, handler = null; const posts = [];
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
  const rd = { overview: async () => ({ fine: 1 }) };
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'console', src)($w, { query: {} }, rd, {}, {}, {}, console);
  ready();
  await handler({ data: { kind: 'call', id: 1, method: 'overview', arg: {} } });
  await handler({ data: { kind: 'call', id: 2, method: 'notListedAnywhere', arg: {} } });
  await handler({ data: { kind: 'call', id: 3, method: 'dashboard', arg: {} } });
  await handler({ data: { kind: 'call', id: 4, method: 'x', mod: 'train', arg: {} } });
  const by = (id) => posts.find((p) => p.id === id) || {};
  ok(by(1).ok === true, 'listed method works');
  ok(by(2).ok === false && by(2).error === 'page_code_old', 'unlisted method: error, not silence');
  ok(by(3).ok === false && by(3).error === 'backend_old', 'listed method missing in the backend: backend_old');
  ok(by(4).ok === false && by(4).error === 'page_code_old', 'unlisted training method: error');
}
console.log(`Page code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
