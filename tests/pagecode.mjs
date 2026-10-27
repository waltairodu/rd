// The page code finds its HTML embed even when the element ID is missing or wrong.
import fs from 'fs';
import * as RD from './racedir.test.mjs';
import * as EX from './exposoft.test.mjs';
import * as TR from './training.test.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const files = [['director/director-page-code.js', '#dirFrame'], ['director/volunteer-page-code.js', '#volFrame'], ['training/athlete-page-code.js', '#trainFrame'], ['training/coach-page-code.js', '#coachFrame']];
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

// The Expo desk has no login of its own: the page code lists no login, logout or setup for it, and passes the token it is given.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  let ready, handler = null; const posts = []; const seen = [];
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
  const expo = { enter: async (a) => { seen.push(a); return { desk: 'x' }; }, login: async () => ({ token: 'leak' }), logout: async () => ({}), ensureSetup: async () => ({}), issue: async () => ({}) };
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'console', src)($w, { query: {} }, {}, expo, {}, {}, console);
  ready();
  const call = async (id, method, mod, arg) => { await handler({ data: { kind: 'call', id, method, mod: mod || 'expo', arg: arg || {} } }); return posts.find((p) => p.id === id) || {}; };
  const r1 = await call(1, 'enter', 'expo', { token: 'T'.repeat(30) });
  ok(r1.ok === true && seen[0] && seen[0].token === 'T'.repeat(30), 'Expo branch: enter is relayed with the token it was given');
  for (const [id, m] of [[2, 'login'], [3, 'logout'], [4, 'ensureSetup']]) {
    const r = await call(id, m, 'expo');
    ok(r.ok === false && r.error === 'page_code_old', 'Expo branch: ' + m + ' is not relayed (no Expo login, logout or setup)');
  }
  ok((await call(5, 'ping', 'expo')).result && (await call(5, 'ping', 'expo')).result.pong === true, 'Expo branch: ping answers');
  const r6 = await call(6, 'whoami', 'expo');
  ok(r6.ok === false && r6.error === 'backend_old', 'Expo branch: a listed method missing in the backend says backend_old, not a crash');
  const r7 = await call(7, 'issue', 'expo', {});
  ok(r7.ok === true, 'Expo branch: issue is relayed');
  for (const [id, m] of [[8, '__proto__'], [9, 'constructor'], [10, 'toString'], [11, 'hasOwnProperty']]) {
    const r = await call(id, m, 'expo');
    ok(r.ok === false && r.error === 'page_code_old', 'Expo branch: "' + m + '" is refused, not looked up on the module');
  }
  const r12 = await call(12, ['enter'], 'expo');
  ok(r12.ok === false, 'Expo branch: a method that is not a string is refused');
  const r13 = await call(13, 'enter', 'other');
  ok(r13.ok === false || r13.id === undefined, 'a call tagged with an unknown module is not sent to the Expo backend');
}

// The method lists in the page code and the backends say the same thing.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8');
  const list = (name) => src.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'))[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  const A = list('ALLOWED'), E = list('EXPO_ALLOWED'), T = list('TRAIN_ALLOWED');
  ok(A.every((m) => typeof RD[m] === 'function'), 'every Director method the page code relays exists in the backend');
  ok(E.every((m) => typeof EX[m] === 'function'), 'every Expo method the page code relays exists in the backend');
  ok(T.every((m) => typeof TR[m] === 'function'), 'every Training method the page code relays exists in the backend');
  ok(['listTeam', 'saveTeam', 'resetTeamSecret', 'signOutTeam', 'removeTeam'].every((m) => A.includes(m)), 'the Team methods are relayed');
  ok(!E.some((m) => ['login', 'logout', 'ensureSetup'].includes(m)) && E.includes('enter'), 'Expo list: enter, and no login, logout or setup');
  ok(new Set(A).size === A.length && new Set(E).size === E.length, 'no method listed twice');
  ok(!Object.keys(EX).some((m) => ['login', 'logout', 'ensureSetup'].includes(m)), 'the Expo backend itself has no login, logout or setup');
  ok(!fs.existsSync('../wix/expo/exposoft-page-code.js'), 'the stand-alone Expo page code is gone');
}
console.log(`Page code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
