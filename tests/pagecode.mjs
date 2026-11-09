// The page code finds its HTML embed even when the element ID is missing or wrong.
import fs from 'fs';
import * as RD from './racedir.test.mjs';
import * as EX from './exposoft.test.mjs';
import * as TR from './training.test.mjs';
import * as FN from './finance.test.mjs';
import * as PR from './print.test.mjs';
import * as CM from './comms.test.mjs';
import * as WV from './waivers.test.mjs';
import * as PUB from './runner.test.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const files = [['director/director-page-code.js', '#dirFrame'], ['director/volunteer-page-code.js', '#volFrame'], ['training/athlete-page-code.js', '#trainFrame'], ['training/coach-page-code.js', '#coachFrame'], ['director/runner-page-code.js', '#runFrame']];
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
    const g = new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'pub', 'console', src + '\n; return 0;');
    g($w, wixLocation, {}, {}, {}, {}, {}, {}, con);
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
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'console', src)($w, { query: {} }, rd, {}, {}, {}, {}, console);
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
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'console', src)($w, { query: {} }, {}, expo, {}, {}, {}, console);
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

// The Finance branch: relays only the Finance methods, with the token it is given; no way to reach other modules through it.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  let ready, handler = null; const posts = []; const seen = [];
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
  const fin = { finOverview: async (a) => { seen.push(a); return { fine: 1 }; }, login: async () => ({ token: 'leak' }), finRaiseInvoice: async () => { throw new Error('bad_lines'); } };
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'console', src)($w, { query: {} }, { dashboard: async () => ({ rd: 1 }) }, {}, {}, {}, fin, console);
  ready();
  const call = async (id, method, mod, arg) => { await handler({ data: { kind: 'call', id, method, mod, arg: arg || {} } }); return posts.find((p) => p.id === id) || {}; };
  const r1 = await call(1, 'finOverview', 'fin', { token: 'T'.repeat(30), ev: 'e1' });
  ok(r1.ok === true && seen[0] && seen[0].token === 'T'.repeat(30) && seen[0].ev === 'e1', 'Finance branch: finOverview is relayed with the token and race it was given');
  const r2 = await call(2, 'finListInvoices', 'fin');
  ok(r2.ok === false && r2.error === 'backend_old', 'Finance branch: a listed method missing in the backend says backend_old, not a crash');
  const r3 = await call(3, 'finRaiseInvoice', 'fin');
  ok(r3.ok === false && r3.error === 'bad_lines', 'Finance branch: an error from the backend is passed on as its plain code');
  for (const [id, m] of [[4, 'login'], [5, 'dashboard'], [6, 'listTeam'], [7, '__proto__'], [8, 'constructor'], [9, 'toString'], [10, 'hasOwnProperty'], [11, 'finnish']]) {
    const r = await call(id, m, 'fin');
    ok(r.ok === false && r.error === 'page_code_old', 'Finance branch: "' + m + '" is refused (only Finance methods go through)');
  }
  const r12 = await call(12, ['finOverview'], 'fin');
  ok(r12.ok === false, 'Finance branch: a method that is not a string is refused');
  const r13 = await call(13, 'finOverview', 'rd');
  ok(r13.ok === false && r13.error === 'page_code_old', 'a Finance method sent without the Finance tag is not relayed through the RaceOS branch');
}

// The Print branch of the director page code: relays only the six print methods, with the token it is given.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  let ready, handler = null; const posts = []; const seen = [];
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
  const prn = { prnOverview: async (a) => { seen.push(a); return { fine: 1 }; }, prnBibs: async () => { throw new Error('bad_bib'); }, login: async () => ({ token: 'leak' }) };
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'res', 'prn', 'console', src)($w, { query: {} }, { dashboard: async () => ({ rd: 1 }) }, {}, {}, {}, {}, {}, prn, console);
  ready();
  const call = async (id, method, mod, arg) => { await handler({ data: { kind: 'call', id, method, mod, arg: arg || {} } }); return posts.find((p) => p.id === id) || {}; };
  const r1 = await call(1, 'prnOverview', 'prn', { token: 'T'.repeat(30), ev: 'e1' });
  ok(r1.ok === true && seen[0] && seen[0].token === 'T'.repeat(30) && seen[0].ev === 'e1', 'Print branch: prnOverview is relayed with the token and race it was given');
  const r2 = await call(2, 'prnCerts', 'prn');
  ok(r2.ok === false && r2.error === 'backend_old', 'Print branch: a listed method missing in the backend says backend_old, not a crash');
  const r3 = await call(3, 'prnBibs', 'prn');
  ok(r3.ok === false && r3.error === 'bad_bib', 'Print branch: an error from the backend is passed on as its plain code');
  for (const [id, m] of [[4, 'login'], [5, 'dashboard'], [6, 'listTeam'], [7, '__proto__'], [8, 'constructor'], [9, 'toString'], [10, 'hasOwnProperty'], [11, 'prn'], [12, 'prnBibs '], [13, 'PRNBIBS'], [14, 'resBoard'], [15, 'pubFind']]) {
    const r = await call(id, m, 'prn');
    ok(r.ok === false && r.error === 'page_code_old', 'Print branch: "' + m + '" is refused (only the six print methods go through)');
  }
  const r16 = await call(16, ['prnOverview'], 'prn');
  ok(r16.ok === false, 'Print branch: a method that is not a string is refused');
  const r17 = await call(17, 'prnOverview', 'rd');
  ok(r17.ok === false && r17.error === 'page_code_old', 'a print method sent without the print tag is not relayed through the RaceOS branch');
  const r18 = await call(18, 'prnOverview', 'fin');
  ok(r18.ok === false && r18.error === 'page_code_old', 'a print method sent with the Finance tag is not relayed through the Finance branch');
  const r19 = await call(19, 'prnOverview', 'prn', null);
  ok(r19.ok === true && seen[1] && Object.keys(seen[1]).length === 0, 'Print branch: a call with no argument reaches the backend as an empty object (the backend then says not_logged_in)');
}

// The Messages branch of the director page code: relays only the twelve Messages methods, with the token it is given.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  let ready, handler = null; const posts = []; const seen = [];
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
  const comms = { cmOverview: async (a) => { seen.push(a); return { fine: 1 }; }, cmSend: async () => { throw new Error('no_batch'); }, login: async () => ({ token: 'leak' }) };
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'res', 'prn', 'comms', 'console', src)($w, { query: {} }, { dashboard: async () => ({ rd: 1 }) }, {}, {}, {}, {}, {}, {}, comms, console);
  ready();
  const call = async (id, method, mod, arg) => { await handler({ data: { kind: 'call', id, method, mod, arg: arg || {} } }); return posts.find((p) => p.id === id) || {}; };
  const r1 = await call(1, 'cmOverview', 'comms', { token: 'T'.repeat(30), ev: 'e1' });
  ok(r1.ok === true && seen[0] && seen[0].token === 'T'.repeat(30) && seen[0].ev === 'e1', 'Messages branch: cmOverview is relayed with the token and race it was given');
  const r2 = await call(2, 'cmExport', 'comms');
  ok(r2.ok === false && r2.error === 'backend_old', 'Messages branch: a listed method missing in the backend says backend_old, not a crash');
  const r3 = await call(3, 'cmSend', 'comms');
  ok(r3.ok === false && r3.error === 'no_batch', 'Messages branch: an error from the backend is passed on as its plain code');
  for (const [id, m] of [[4, 'login'], [5, 'dashboard'], [6, 'listTeam'], [7, '__proto__'], [8, 'constructor'], [9, 'toString'], [10, 'hasOwnProperty'], [11, 'comms'], [12, 'cmSend '], [13, 'CMSEND'], [14, 'prnBibs'], [15, 'finOverview'], [16, 'pubFind'], [17, 'cmSendAll'], [18, 'cm']]) {
    const r = await call(id, m, 'comms');
    ok(r.ok === false && r.error === 'page_code_old', 'Messages branch: "' + m + '" is refused (only the twelve Messages methods go through)');
  }
  const r19 = await call(19, ['cmOverview'], 'comms');
  ok(r19.ok === false, 'Messages branch: a method that is not a string is refused');
  const r20 = await call(20, 'cmOverview', 'rd');
  ok(r20.ok === false && r20.error === 'page_code_old', 'a Messages method sent without the Messages tag is not relayed through the RaceOS branch');
  const r21 = await call(21, 'cmOverview', 'prn');
  ok(r21.ok === false && r21.error === 'page_code_old', 'a Messages method sent with the Print tag is not relayed through the Print branch');
  const r22 = await call(22, 'cmOverview', 'comms', null);
  ok(r22.ok === true && seen[1] && Object.keys(seen[1]).length === 0, 'Messages branch: a call with no argument reaches the backend as an empty object (the backend then says not_logged_in)');
  const r23 = await call(23, 'prnOverview', 'comms');
  ok(r23.ok === false && r23.error === 'page_code_old', 'a Print method sent with the Messages tag is refused');
}

// The Waivers branch of the director page code: relays only the nine Waivers methods, with the token it is given.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  let ready, handler = null; const posts = []; const seen = [];
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
  const waiv = { wvOverview: async (a) => { seen.push(a); return { fine: 1 }; }, wvSaveText: async () => { throw new Error('wv_stale'); }, login: async () => ({ token: 'leak' }) };
  new Function('$w', 'wixLocation', 'rd', 'expo', 'train', 'tr', 'fin', 'res', 'prn', 'comms', 'wv', 'console', src)($w, { query: {} }, { dashboard: async () => ({ rd: 1 }) }, {}, {}, {}, {}, {}, {}, {}, waiv, console);
  ready();
  const call = async (id, method, mod, arg) => { await handler({ data: { kind: 'call', id, method, mod, arg: arg || {} } }); return posts.find((p) => p.id === id) || {}; };
  const r1 = await call(1, 'wvOverview', 'wv', { token: 'T'.repeat(30), ev: 'e1' });
  ok(r1.ok === true && seen[0] && seen[0].token === 'T'.repeat(30) && seen[0].ev === 'e1', 'Waivers branch: wvOverview is relayed with the token and race it was given');
  const r2 = await call(2, 'wvVoid', 'wv');
  ok(r2.ok === false && r2.error === 'backend_old', 'Waivers branch: a listed method missing in the backend says backend_old, not a crash');
  const r3 = await call(3, 'wvSaveText', 'wv');
  ok(r3.ok === false && r3.error === 'wv_stale', 'Waivers branch: an error from the backend is passed on as its plain code');
  for (const [id, m] of [[4, 'login'], [5, 'dashboard'], [6, 'listTeam'], [7, '__proto__'], [8, 'constructor'], [9, 'toString'], [10, 'hasOwnProperty'], [11, 'wv'], [12, 'wvSaveText '], [13, 'WVSAVETEXT'], [14, 'prnBibs'], [15, 'finOverview'], [16, 'pubFind'], [17, 'wvSaveAll'], [18, 'cmOverview'], [19, 'cmSend'], [20, 'wvDelete'], [21, 'wvRemove']]) {
    const r = await call(id, m, 'wv');
    ok(r.ok === false && r.error === 'page_code_old', 'Waivers branch: "' + m + '" is refused (only the nine Waivers methods go through)');
  }
  const r22 = await call(22, ['wvOverview'], 'wv');
  ok(r22.ok === false, 'Waivers branch: a method that is not a string is refused');
  for (const [id, mod] of [[23, 'rd'], [24, 'comms'], [25, 'prn'], [26, 'fin'], [27, 'res'], [28, 'expo'], [29, 'train'], [30, 'WV'], [31, ' wv'], [32, 'waivers']]) {
    const r = await call(id, 'wvOverview', mod);
    ok(r.ok === false && r.error === 'page_code_old', 'a Waivers method sent with the "' + mod + '" tag is not relayed through that branch');
  }
  const r33 = await call(33, 'wvOverview', 'wv', null);
  ok(r33.ok === true && seen[1] && Object.keys(seen[1]).length === 0, 'Waivers branch: a call with no argument reaches the backend as an empty object (the backend then says not_logged_in)');
  const r34 = await call(34, 'cmOverview', 'wv');
  ok(r34.ok === false && r34.error === 'page_code_old', 'a Messages method sent with the Waivers tag is refused');
  const r35 = await call(35, 'wvOverview', 'wv', { token: 'T'.repeat(30), ev: 'e1', method: 'wvVoid', mod: 'comms' });
  ok(r35.ok === true && seen[2] && seen[2].method === 'wvVoid' && seen.length === 3, 'Waivers branch: a method or tag hidden inside the argument changes nothing (the call still goes to the method it names)');
}

// The public runner page code: three read-only public methods and nothing else; the race comes from the link.
{
  const src = fs.readFileSync('../wix/director/runner-page-code.js', 'utf8').replace(/^import .*$/gm, '');
  const build = (query, pub) => {
    let ready, handler = null; const posts = [];
    const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
    const $w = (sel) => (sel === '#runFrame' ? comp : {}); $w.onReady = (fn) => { ready = fn; };
    new Function('$w', 'wixLocation', 'pub', 'console', src)($w, { query }, pub, console);
    ready();
    return { posts, comp, send: async (data) => { await handler({ data }); }, call: async (id, method, arg, extra) => { await handler({ data: Object.assign({ kind: 'call', id, method, arg }, extra || {}) }); return posts.find((p) => p.id === id) || {}; } };
  };
  const seen = [];
  const pub = { pubRaces: async (a) => { seen.push(['pubRaces', a]); return { races: [] }; }, pubFind: async (a) => { seen.push(['pubFind', a]); return { items: [] }; }, pubCert: async () => { throw new Error('no_certificate'); }, prnBibs: async () => ({ leak: 1 }), login: async () => ({ token: 'leak' }) };
  const P = build({ ev: 'RACE1' }, pub);
  await P.send({ kind: 'hello' });
  ok(P.posts[0] && P.posts[0].kind === 'init' && P.posts[0].ev === 'RACE1', 'Runner page code: "hello" is answered with the race named in the link');
  const P0 = build({}, pub);
  await P0.send({ kind: 'hello' });
  ok(P0.posts[0].ev === '', 'Runner page code: no race in the link: an empty race (the page then lists the races that show something)');
  const P1 = build({ ev: ['a', 'b'] }, pub);
  await P1.send({ kind: 'hello' });
  ok(typeof P1.posts[0].ev === 'string', 'Runner page code: the race is always text, even when the link says it twice');
  const r1 = await P.call(1, 'pubFind', { ev: 'RACE1', q: 'asha' });
  ok(r1.ok === true && seen.some((x) => x[0] === 'pubFind' && x[1].q === 'asha'), 'Runner page code: pubFind is relayed');
  const r2 = await P.call(2, 'pubRaces');
  ok(r2.ok === true && seen.some((x) => x[0] === 'pubRaces' && Object.keys(x[1]).length === 0), 'Runner page code: pubRaces is relayed (no argument becomes an empty object)');
  const r3 = await P.call(3, 'pubCert', { ev: 'RACE1', bib: '1' });
  ok(r3.ok === false && r3.error === 'no_certificate', 'Runner page code: an error from the server is passed on as its plain code');
  const P2 = build({}, { pubRaces: pub.pubRaces });
  const r4 = await P2.call(4, 'pubFind', {});
  ok(r4.ok === false && r4.error === 'backend_old', 'Runner page code: a listed method missing in the backend says backend_old, not a crash');
  const before = seen.length;
  for (const [id, m] of [[10, 'prnBibs'], [11, 'login'], [12, 'resBoard'], [13, 'listRegs'], [14, '__proto__'], [15, 'constructor'], [16, 'toString'], [17, 'hasOwnProperty'], [18, 'pubFind '], [19, 'PUBFIND'], [20, ''], [21, 'pub'], [22, 'pubFind\n'], [23, 'pubFind\u0000']]) {
    const r = await P.call(id, m, { token: 'x'.repeat(30) });
    ok(r.ok === false && r.error === 'page_code_old', 'Runner page code: "' + String(m).replace(/\W/g, '?') + '" is refused, never run');
  }
  for (const [id, m] of [[30, ['pubFind']], [31, { toString: () => 'pubFind' }], [32, 5], [33, null], [34, undefined]]) {
    const r = await P.call(id, m, {});
    ok(r.ok === false, 'Runner page code: a method that is not a text is refused (' + id + ')');
  }
  ok(seen.length === before, 'Runner page code: none of the refused calls reached the server');
  // a staff tag does not open anything on this page
  const r5 = await P.call(40, 'prnBibs', {}, { mod: 'prn' });
  ok(r5.ok === false && r5.error === 'page_code_old', 'Runner page code: the print tag opens nothing on the public page');
  const r6 = await P.call(41, 'pubFind', { ev: 'RACE1', q: 'asha' }, { mod: 'fin' });
  ok(r6.ok === true, 'Runner page code: a stray tag on a public method is harmless (it still only reaches the public method)');
  // messages that are not calls
  const n = P.posts.length;
  for (const m of [null, undefined, 5, 'x', [], {}, { kind: 'nonsense' }, { kind: 'result', id: 1, ok: true }, { kind: 'init', ev: 'x' }]) await P.send(m);
  ok(P.posts.length === n, 'Runner page code: messages that are not calls get no answer and run nothing');
  // resize
  await P.send({ kind: 'resize', height: 1234.4 });
  ok(P.comp.height === 1234, 'Runner page code: resize sets the height');
  await P.send({ kind: 'resize', height: 1 });
  ok(P.comp.height === 300, 'Runner page code: not below 300');
  await P.send({ kind: 'resize', height: 1e9 });
  ok(P.comp.height === 20000, 'Runner page code: not above 20000');
  // the page code imports nothing from staff modules
  const raw = fs.readFileSync('../wix/director/runner-page-code.js', 'utf8');
  const imports = raw.match(/^import .*$/gm) || [];
  ok(imports.length === 2 && imports.every((l) => /from 'wix-location'|from 'backend\/runner\.web'/.test(l)), 'Runner page code: it imports only wix-location and the public backend file');
}

// The method lists in the page code and the backends say the same thing.
{
  const src = fs.readFileSync('../wix/director/director-page-code.js', 'utf8');
  const list = (name) => src.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'))[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  const A = list('ALLOWED'), E = list('EXPO_ALLOWED'), T = list('TRAIN_ALLOWED'), FI = list('FIN_ALLOWED');
  ok(A.every((m) => typeof RD[m] === 'function'), 'every Director method the page code relays exists in the backend');
  ok(E.every((m) => typeof EX[m] === 'function'), 'every Expo method the page code relays exists in the backend');
  ok(T.every((m) => typeof TR[m] === 'function'), 'every Training method the page code relays exists in the backend');
  ok(FI.every((m) => typeof FN[m] === 'function') && Object.keys(FN).every((m) => FI.includes(m)) && new Set(FI).size === FI.length, 'the Finance list and the Finance backend are the same ' + FI.length + ' methods (none missing, none extra, none twice)');
  const PN = list('PRN_ALLOWED');
  ok(PN.every((m) => typeof PR[m] === 'function') && Object.keys(PR).filter((m) => typeof PR[m] === 'function').every((m) => PN.includes(m)) && new Set(PN).size === PN.length, 'the Print list and the print backend are the same ' + PN.length + ' methods (none missing, none extra, none twice)');
  ok(!PN.some((m) => A.includes(m) || E.includes(m) || T.includes(m) || FI.includes(m)), 'no print method is also listed under another module');
  const CMA = list('COMMS_ALLOWED');
  ok(CMA.length === 12 && CMA.every((m) => typeof CM[m] === 'function') && Object.keys(CM).filter((m) => typeof CM[m] === 'function').every((m) => CMA.includes(m)) && new Set(CMA).size === CMA.length, 'the Messages list and the Messages backend are the same ' + CMA.length + ' methods (none missing, none extra, none twice)');
  ok(CMA.every((m) => /^cm[A-Z]/.test(m)) && !CMA.some((m) => PN.includes(m) || A.includes(m) || E.includes(m) || T.includes(m) || FI.includes(m)), 'no Messages method is also listed under another module');
  const WVA = list('WV_ALLOWED');
  ok(WVA.length === 9 && WVA.every((m) => typeof WV[m] === 'function') && Object.keys(WV).filter((m) => typeof WV[m] === 'function').every((m) => WVA.includes(m)) && new Set(WVA).size === WVA.length, 'the Waivers list and the Waivers backend are the same ' + WVA.length + ' methods (none missing, none extra, none twice)');
  ok(WVA.every((m) => /^wv[A-Z]/.test(m)) && !WVA.some((m) => CMA.includes(m) || PN.includes(m) || A.includes(m) || E.includes(m) || T.includes(m) || FI.includes(m)), 'no Waivers method is also listed under another module');
  const rsrc = fs.readFileSync('../wix/director/runner-page-code.js', 'utf8');
  const RA = rsrc.match(/const ALLOWED = \[([^\]]*)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  ok(RA.length === 3 && RA.every((m) => typeof PUB[m] === 'function') && Object.keys(PUB).filter((m) => typeof PUB[m] === 'function').every((m) => RA.includes(m)), 'the runner page lists the three public methods, and the public backend has no others');
  ok(RA.every((m) => /^pub[A-Z]/.test(m)) && !RA.some((m) => PN.includes(m) || A.includes(m)), 'and they are public names, kept apart from every staff list');
  ok(['listTeam', 'saveTeam', 'resetTeamSecret', 'signOutTeam', 'removeTeam'].every((m) => A.includes(m)), 'the Team methods are relayed');
  ok(!E.some((m) => ['login', 'logout', 'ensureSetup'].includes(m)) && E.includes('enter'), 'Expo list: enter, and no login, logout or setup');
  ok(new Set(A).size === A.length && new Set(E).size === E.length, 'no method listed twice');
  ok(!Object.keys(EX).some((m) => ['login', 'logout', 'ensureSetup'].includes(m)), 'the Expo backend itself has no login, logout or setup');
  ok(!fs.existsSync('../wix/expo/exposoft-page-code.js'), 'the stand-alone Expo page code is gone');
}
console.log(`Page code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
