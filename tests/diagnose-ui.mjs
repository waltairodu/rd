// What a person sees when a backend file or a page code is missing.
//  P: the Director page code works out which backend file to look at (the "backend check") and says it in the error it relays;
//  E: the Director screen shows that sentence, escaped and cut to a safe length;
//  V: the volunteer, athlete, coach and runner page codes and screens say it in plain words, with no technical details;
//  G: the setup guide says what each sentence means, and the 22 backend files carry the end marker the guide tells you to look for.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const eq = (a, b, m) => { const same = JSON.stringify(a) === JSON.stringify(b); ok(same, m + (same ? '' : '\n         got  ' + JSON.stringify(a) + '\n         want ' + JSON.stringify(b))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => fs.readFileSync('../' + f, 'utf8');

// ---------------------------------------------------------------- P: the Director page code
const PC = read('wix/director/director-page-code.js');
const listOf = (name) => [...PC.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const rows = [...PC.matchAll(/\['([\w.-]+\.web\.js)', (\w+), (\w+), \[([^\]]*)\]\]/g)].map((m) => ({ file: m[1], ns: m[2], list: m[3], needs: [...m[4].matchAll(/'([^']+)'/g)].map((x) => x[1]) }));
const N = {};
rows.forEach((r) => { N[r.file] = listOf(r.list).length; });

eq(rows.map((r) => r.file), ['racedir.web.js', 'exposoft.web.js', 'training.web.js', 'finance.web.js', 'results.web.js', 'print.web.js', 'comms.web.js', 'waivers.web.js', 'reports.web.js', 'privacy.web.js'], 'P0 the check knows the ten web modules the page imports');
// the plain files each web module really imports, directly or through another plain file
const dirOf = (f) => (f === 'exposoft.web.js' ? 'wix/expo' : f === 'training.web.js' ? 'wix/training' : 'wix/director');
const importsOf = (f) => [...read(dirOf(f) + '/' + f).matchAll(/from '\.\/([\w.-]+\.js)'/g)].map((m) => m[1]);
const closure = (f) => { const seen = new Set(), todo = [f]; while (todo.length) { const x = todo.pop(); for (const y of importsOf(x)) if (!seen.has(y)) { seen.add(y); todo.push(y); } } return [...seen].sort(); };
for (const r of rows) eq(r.needs, closure(r.file), 'P0 ' + r.file + ': the files the check expects are exactly the files it imports');
// each module is imported under the name the check uses for it
const imported = Object.fromEntries([...PC.matchAll(/import \* as (\w+) from 'backend\/([\w-]+)\.web';/g)].map((m) => [m[1], m[2] + '.web.js']));
for (const r of rows) eq(imported[r.ns], r.file, 'P0 the page imports ' + r.file + ' as ' + r.ns + ' and the check uses the same name');
// each list holds the methods of its module (every one is a real method of the module's file)
for (const r of rows) {
  const src = read(dirOf(r.file) + '/' + r.file);
  const exported = new Set([...src.matchAll(/^export const (\w+) = /gm)].map((m) => m[1]));
  const gone = listOf(r.list).filter((m) => !exported.has(m));
  eq(gone, [], 'P0 every method the page may call in ' + r.file + ' exists in the file');
}

const NAMES = ['rd', 'expo', 'train', 'tr', 'fin', 'res', 'prn', 'comms', 'wv', 'rp', 'pv', 'pub'];
function director(w) {
  const posts = [];
  let handler, ready;
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {});
  $w.onReady = (fn) => { ready = fn; };
  new Function('$w', 'wixLocation', ...NAMES, 'console', PC.replace(/^import .*$/gm, ''))($w, { query: {} }, ...NAMES.map((k) => w[k] || {}), console);
  ready();
  let n = 0;
  return {
    async call(method, extra) {
      const id = ++n;
      await handler({ data: Object.assign({ kind: 'call', id, method, arg: {} }, extra || {}) });
      return posts.find((p) => p.id === id) || null;
    },
    raw: async (data) => handler({ data }),
    posts,
  };
}
const full = (r) => Object.fromEntries(listOf(r.list).map((m) => [m, async () => ({ ran: m })]));
// A site where the given plain/web files are missing (every module that imports one is empty), the given web modules are empty, and some modules are older copies
function site(o) {
  o = o || {};
  const missing = o.missing || [], empty = o.empty || [], old = o.old || {};
  const w = {};
  for (const r of rows) {
    if (missing.some((f) => f === r.file || r.needs.includes(f)) || empty.includes(r.file)) { w[r.ns] = {}; continue; }
    const mod = full(r);
    (old[r.file] || []).forEach((m) => { delete mod[m]; });
    w[r.ns] = mod;
  }
  return w;
}
const FIRST = listOf('ALLOWED')[0];
const none = (f) => f + ' has none of its ' + N[f] + ' methods';

{ // P1: nothing wrong, nothing said
  const d = director(site());
  const r = await d.call(FIRST);
  ok(r && r.ok === true && r.result.ran === FIRST, 'P1 with every file in place a listed method runs and answers');
  const r2 = await d.call(listOf('FIN_ALLOWED')[0], { mod: 'fin' });
  ok(r2 && r2.ok === true, 'P1 and so does a method of another module');
}
{ // P2: one plain file missing that three web modules import: it is named first, as the most likely cause
  const d = director(site({ missing: ['rd-privacy.js'] }));
  const r = await d.call(FIRST);
  eq(r.error, 'backend_old|most likely missing or misnamed: rd-privacy.js; ' + none('racedir.web.js') + '; ' + none('exposoft.web.js') + '; ' + none('privacy.web.js'), 'P2 a missing rd-privacy.js is named, then the three modules that cannot load without it');
  ok(r.ok === false, 'P2 the answer is a refusal');
}
{ // P3: a file that only one module imports
  const d = director(site({ missing: ['rd-approvals.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|most likely missing or misnamed: rd-approvals.js; ' + none('racedir.web.js'), 'P3 a missing rd-approvals.js: it is named, and racedir.web.js is the one module that cannot load');
}
{ // P4: two files missing at once: both are named, the one that explains more modules first
  const d = director(site({ missing: ['rd-privacy.js', 'rd-finance.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|check that these files exist with exactly these names: rd-privacy.js, rd-finance.js; ' + none('racedir.web.js') + '; ' + none('exposoft.web.js') + '; ' + none('finance.web.js') + '; 2 more modules have none of their methods', 'P4 two missing files are both named (the bigger one first), and the modules beyond three are counted');
}
{ // P5: rd-auth.js is imported by all ten modules: all ten are empty and the one file is named
  const d = director(site({ missing: ['rd-auth.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|most likely missing or misnamed: rd-auth.js; ' + none('racedir.web.js') + '; ' + none('exposoft.web.js') + '; ' + none('training.web.js') + '; 7 more modules have none of their methods', 'P5 with rd-auth.js missing all ten modules are empty and rd-auth.js is the file named');
}
{ // P6: ai-core.js is needed even though the AI is never used: its absence empties racedir.web.js and training.web.js
  const d = director(site({ missing: ['ai-core.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|most likely missing or misnamed: ai-core.js; ' + none('racedir.web.js') + '; ' + none('training.web.js'), 'P6 a missing ai-core.js is named (racedir.web.js and training.web.js cannot load without it)');
}
{ // P7: one web module empty while every file it imports is there: the module itself is the suspect
  const d = director(site({ empty: ['training.web.js'] }));
  eq((await d.call('assignCoach', { mod: 'train' })).error, 'backend_old|every file training.web.js imports is there, so paste training.web.js again, then save and publish; ' + none('training.web.js'), 'P7 a lone empty module: the files are fine, paste the module again');
  ok((await d.call(FIRST)).ok === true, 'P7 and the other modules keep working');
}
{ // P8: an older copy of a module
  const d = director(site({ old: { 'finance.web.js': ['finAddEntry', 'finVoid'] } }));
  eq((await d.call('finVoid', { mod: 'fin' })).error, 'backend_old|finance.web.js has ' + (N['finance.web.js'] - 2) + ' of ' + N['finance.web.js'] + ' methods (missing finAddEntry, finVoid)', 'P8 an older finance.web.js: how many methods it has and which are missing');
  ok((await d.call('finLedger', { mod: 'fin' })).ok === true, 'P8 a method the older copy has still runs');
}
{ // P9: a long list of missing methods is cut after four
  const gone = listOf('ALLOWED').slice(-6);
  const d = director(site({ old: { 'racedir.web.js': gone } }));
  eq((await d.call(gone[0])).error, 'backend_old|racedir.web.js has ' + (N['racedir.web.js'] - 6) + ' of ' + N['racedir.web.js'] + ' methods (missing ' + gone.slice(0, 4).join(', ') + ', ...)', 'P9 six missing methods: four are named, then "..."');
}
{ // P10: more than two older copies
  const d = director(site({ old: { 'finance.web.js': ['finVoid'], 'results.web.js': ['resAwards'], 'print.web.js': ['prnSavePublish'] } }));
  eq((await d.call('finVoid', { mod: 'fin' })).error, 'backend_old|finance.web.js has ' + (N['finance.web.js'] - 1) + ' of ' + N['finance.web.js'] + ' methods (missing finVoid); results.web.js has ' + (N['results.web.js'] - 1) + ' of ' + N['results.web.js'] + ' methods (missing resAwards); 1 more module is an older copy', 'P10 two older copies are named, a third is counted');
  const d2 = director(site({ old: { 'finance.web.js': ['finVoid'], 'results.web.js': ['resAwards'], 'print.web.js': ['prnSavePublish'], 'comms.web.js': ['cmTest'] } }));
  ok(/; 2 more modules are older copies$/.test((await d2.call('finVoid', { mod: 'fin' })).error), 'P10 and with four, "2 more modules are older copies"');
}
{ // P11: empty and older at once: the empty ones come first
  const d = director(site({ empty: ['training.web.js'], old: { 'finance.web.js': ['finVoid'] } }));
  const e = (await d.call('assignCoach', { mod: 'train' })).error;
  ok(e.indexOf('every file training.web.js imports is there') < e.indexOf('training.web.js has none') && e.indexOf('training.web.js has none') < e.indexOf('finance.web.js has'), 'P11 advice first, then the empty module, then the older copy: ' + e);
}
{ // P12: four modules cannot load: three are listed, the fourth is counted (singular); five: "2 more modules" (plural)
  const d = director(site({ missing: ['rd-waiver.js', 'rd-approvals.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|check that these files exist with exactly these names: rd-waiver.js, rd-approvals.js; ' + none('racedir.web.js') + '; ' + none('comms.web.js') + '; ' + none('waivers.web.js') + '; 1 more module has none of its methods', 'P12 a fourth module that cannot load is "1 more module has none of its methods"');
  const d2 = director(site({ missing: ['rd-waiver.js', 'rd-approvals.js', 'rd-finance.js'] }));
  eq((await d2.call(FIRST)).error, 'backend_old|check that these files exist with exactly these names: rd-waiver.js, rd-approvals.js, rd-finance.js; ' + none('racedir.web.js') + '; ' + none('finance.web.js') + '; ' + none('comms.web.js') + '; 2 more modules have none of their methods', 'P12 five modules that cannot load: three listed, "2 more modules have none of their methods"');
}
{ // P13: nothing found wrong: the last sentence is still advice. The first look at the method fails, the second finds every method.
  let looks = 0;
  const rd = new Proxy(full(rows[0]), { get(t, k) { if (k === FIRST) { looks++; return looks === 1 ? undefined : t[k]; } return t[k]; } });
  const w = site(); w.rd = rd;
  const d = director(w);
  eq((await d.call(FIRST)).error, 'backend_old|every backend module answers, so paste the newest backend files and publish', 'P13 when every module answers, the sentence is still advice');
}
{ // P14: what is relayed for a method the page code does not list
  const d = director(site());
  eq((await d.call('notListedAnywhere')).error, 'page_code_old|does not list notListedAnywhere', 'P14 an unlisted method: page_code_old and its name');
  eq((await d.call('x', { mod: 'train' })).error, 'page_code_old|does not list x', 'P14 the same for a method of another module');
  eq((await d.call('__proto__')).error, 'page_code_old|does not list __proto__', 'P14 a name from the prototype is not a method');
  eq((await d.call('constructor')).error, 'page_code_old|does not list constructor', 'P14 constructor is not a method');
}
{ // P15: hostile or odd method names never get past the letters, digits, dots and dashes
  const d = director(site());
  eq((await d.call('<img src=x onerror=alert(1)>')).error, 'page_code_old|does not list imgsrcxonerroralert1', 'P15 markup in a method name is stripped to letters and digits');
  eq((await d.call('a'.repeat(500))).error, 'page_code_old|does not list ' + 'a'.repeat(40), 'P15 a long name is cut to 40 characters');
  eq((await d.call('')).error, 'page_code_old|does not list this method', 'P15 an empty name: "this method"');
  eq((await d.call('<>')).error, 'page_code_old|does not list this method', 'P15 a name of nothing but markup: "this method"');
  for (const odd of [null, undefined, 7, {}, ['a'], true]) {
    const r = await d.call(odd);
    ok(r && r.ok === false && /^page_code_old\|does not list [\w.\- ]*$/.test(r.error), 'P15 a method that is ' + JSON.stringify(odd) + ' is refused without a crash: ' + (r && r.error));
  }
  const r = await d.call('x<script>', { mod: '<b>' });
  ok(r.ok === false && !/[<>]/.test(r.error), 'P15 an odd module name changes nothing, nothing in the answer can be markup: ' + r.error);
}
{ // P16: the page code never stops answering because of a strange message
  const d = director(site());
  let threw = false;
  for (const data of [null, undefined, 5, 'x', {}, { kind: 'call' }, { kind: 'call', id: 'a', method: 'x' }, { kind: 'result' }, { kind: 'hello' }]) {
    try { await d.raw(data); } catch (e) { threw = true; }
  }
  ok(!threw, 'P16 nothing the embed sends can make the message handler throw');
}
{ // P17: the check is read-only, short and works on a site where every module is empty
  const d = director(site({ missing: ['rd-auth.js'] }));
  const r = await d.call(FIRST);
  ok(r.error.length <= 'backend_old|'.length + 420, 'P17 the sentence stays within 420 characters (' + r.error.length + ')');
  const w = {};
  const d2 = director(w);
  const r2 = await d2.call(FIRST);
  ok(r2.ok === false && /^backend_old\|most likely missing or misnamed: rd-auth\.js; racedir\.web\.js has none/.test(r2.error), 'P17 with no module found at all, rd-auth.js is named first: ' + r2.error);
}
{ // P18: a backend method that throws still answers with its own message (the check is only for a method that is not there)
  const w = site();
  w.rd[FIRST] = async () => { throw new Error('not_logged_in'); };
  const d = director(w);
  const r = await d.call(FIRST);
  ok(r.ok === false && r.error === 'not_logged_in', 'P18 a thrown "not_logged_in" is relayed as it is');
  w.rd[FIRST] = async () => { throw 'plain text'; };
  eq((await director(w).call(FIRST)).error, 'plain text', 'P18 a thrown text is relayed as it is');
}

// ---------------------------------------------------------------- E: the Director screen
const dirHtml = read('wix/director/director-embed.html');
function open(html, answer) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.addEventListener('message', (e) => {
    const m = e.data;
    if (!m) return;
    if (m.kind === 'hello') { w.postMessage({ kind: 'init', ev: 'EV1' }, '*'); return; }
    if (m.kind !== 'call') return;
    const a = answer(m);
    if (a) w.postMessage(Object.assign({ kind: 'result', id: m.id }, a), '*');
  });
  return { w, d, errors };
}
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
// what a person can read on the page: its text without the page's own script and style
const visible = (d) => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((x) => x.remove()); return txt(c); };
async function tryLogin(error) {
  const s = open(dirHtml, () => ({ ok: false, error }));
  await sleep(50);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new s.w.Event('input', { bubbles: true })); };
  set(s.d.querySelector('#lgUser'), 'boss');
  set(s.d.querySelector('#lgPass'), 'pw');
  s.d.querySelector('#loginForm').dispatchEvent(new s.w.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(250);
  return s;
}

// The embed's own words for an error: its ERR table and msg function, run exactly as written in the file (the rest of the page is not needed).
function words(html) {
  const i = html.indexOf('var ERR={');
  const j = html.indexOf('var msg=', i);
  const k = html.indexOf('};', j) + 2;
  if (i < 0 || j < 0) return null;
  return new Function(html.slice(i, k) + '\nreturn msg;')();
}
const BACKEND = 'The backend file is out of date. Paste the latest backend files, then publish.';
const PAGECODE = 'This page\'s code is out of date. Paste the latest page-code.js for this page, then publish.';
{
  const detail = 'most likely missing or misnamed: rd-privacy.js; racedir.web.js has none of its 73 methods';
  const s = await tryLogin('backend_old|' + detail);
  eq(txt(s.d.querySelector('#lgErr')), BACKEND + ' (' + detail + ')', 'E1 the login screen says the sentence for backend_old and the file to look at in brackets');
  eq(txt(s.d.querySelector('#toast')), BACKEND + ' (' + detail + ')', 'E1 the pop-up message carries the same words');
  ok(!!s.d.querySelector('#loginForm'), 'E1 and the login form stays, ready to try again');
  eq(s.errors, [], 'E1 no script error on the screen');
}
{
  const s = await tryLogin('page_code_old|does not list login');
  eq(txt(s.d.querySelector('#lgErr')), PAGECODE + ' (does not list login)', 'E2 page_code_old: the sentence and the method the page code does not list');
}
{ // E3: details that are markup are shown as text, never run
  const bad = '<img src=x onerror="window.__hit=1"><b>bold</b>';
  const s = await tryLogin('backend_old|' + bad);
  const el = s.d.querySelector('#lgErr');
  ok(!el.querySelector('img') && !el.querySelector('b') && !s.d.querySelector('img[src="x"]') && s.w.__hit === undefined, 'E3 markup in the details is not turned into elements and does not run');
  ok(txt(el).includes('<img src=x onerror="window.__hit=1"><b>bold</b>'), 'E3 it is shown as the text it is');
  ok(!s.d.querySelector('#toast img') && !s.d.querySelector('#toast b') && txt(s.d.querySelector('#toast')).includes('<img src=x'), 'E3 and so is the pop-up message');
  eq(s.errors, [], 'E3 no script error');
}
{ // E4: long details are cut at 400 characters
  const s = await tryLogin('backend_old|' + 'x'.repeat(2000));
  const t = txt(s.d.querySelector('#lgErr'));
  eq(t, BACKEND + ' (' + 'x'.repeat(400) + ')', 'E4 2,000 characters of details are cut to 400');
}
{ // E5: an answer with no details is the plain sentence, as before
  const s = await tryLogin('backend_old');
  eq(txt(s.d.querySelector('#lgErr')), BACKEND, 'E5 backend_old alone is the plain sentence, with no empty brackets');
  const s2 = await tryLogin('backend_old|');
  eq(txt(s2.d.querySelector('#lgErr')), BACKEND, 'E5 and so is a bar with nothing after it');
  const s3 = await tryLogin('bad_login');
  ok(/password|username|login/i.test(txt(s3.d.querySelector('#lgErr'))) && !/\(/.test(txt(s3.d.querySelector('#lgErr'))), 'E5 an ordinary login error is unchanged: ' + txt(s3.d.querySelector('#lgErr')));
}
{ // E6: the words for an error code
  const msg = words(dirHtml);
  ok(typeof msg === 'function', 'E6 the screen has its message function');
  eq(msg('weird_code|some detail'), 'Something went wrong (weird_code) (some detail)', 'E6 an unknown code is shown with its details');
  eq(msg('constructor'), 'Something went wrong (constructor)', 'E6 a name from the prototype is not a known code');
  eq(msg('__proto__|x'), 'Something went wrong (__proto__) (x)', 'E6 nor is __proto__');
  eq(msg('toString'), 'Something went wrong (toString)', 'E6 nor toString');
  eq(msg(undefined), 'Something went wrong ()', 'E6 no code at all');
  eq(msg('backend_old|' + 'y'.repeat(401)), BACKEND + ' (' + 'y'.repeat(400) + ')', 'E6 details of 401 characters: 400 are shown');
  eq(msg('backend_old|' + 'y'.repeat(400)), BACKEND + ' (' + 'y'.repeat(400) + ')', 'E6 details of 400 characters: all are shown');
  eq(msg('a'.repeat(300)), 'Something went wrong (' + 'a'.repeat(120) + ')', 'E6 a long unknown code is cut to 120 characters');
  eq(msg('a|b|c'), 'Something went wrong (a) (b|c)', 'E6 only the first bar splits the code from the details');
  ok(/page code is missing from this page or a backend file is missing/.test(msg('timeout')) && /If a page shows an error/.test(msg('timeout')), 'E6 "no answer in time" says where to look: ' + msg('timeout'));
  ok(msg('timeout').startsWith('No answer from the server in time. Try again.'), 'E6 and still starts with the old sentence');
  eq(msg('not_logged_in'), msg('not_logged_in|'), 'E6 a known code with an empty bar is the plain sentence');
}
{ // E7: a failure after login shows the same words in the same place (the page that did not load, and the pop-up message)
  // background calls the screen does not wait for may be refused too: the browser logs them, nothing else
  const unhandled = [];
  const keep = (e) => unhandled.push(String((e && e.message) || e));
  process.on('unhandledRejection', keep);
  const s = open(dirHtml, (m) => {
    if (m.method === 'login') return { ok: true, result: { token: 'tok1', role: 'director', name: 'Boss', expoOnly: false } };
    if (m.method === 'listEvents') return { ok: true, result: { events: [{ id: 'EV1', name: 'Test Race', date: '2027-01-31', venue: '', distance: '' }] } };
    return { ok: false, error: 'backend_old|finance.web.js has 17 of 23 methods (missing finVoid)' };
  });
  await sleep(50);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new s.w.Event('input', { bubbles: true })); };
  set(s.d.querySelector('#lgUser'), 'boss');
  set(s.d.querySelector('#lgPass'), 'pw');
  s.d.querySelector('#loginForm').dispatchEvent(new s.w.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(500);
  const all = visible(s.d);
  ok(!s.d.querySelector('#loginForm'), 'E7 the login went through');
  const sentence = BACKEND + ' (finance.web.js has 17 of 23 methods (missing finVoid))';
  eq(txt(s.d.querySelector('#toast')), sentence, 'E7 the pop-up message has the sentence and the file to look at');
  ok(all.includes('This page did not load' + sentence), 'E7 the page that did not load says the same: ' + all.slice(all.indexOf('This page did not load'), all.indexOf('This page did not load') + 200));
  await sleep(50);
  process.off('unhandledRejection', keep);
  ok(unhandled.every((x) => x.startsWith('backend_old|')), 'E7 nothing else went wrong in the background: ' + JSON.stringify(unhandled));
  eq(s.errors, [], 'E7 no script error while a screen fails');
}
ok(/If a page shows an error/.test(dirHtml) && /SETUP\.md/.test(dirHtml), 'E8 the Director screen names the part of the guide to read');

// ---------------------------------------------------------------- V: the public pages
const PLAIN = 'This page is not set up correctly yet. Please tell the organiser.';
const pubs = [
  ['volunteer', 'wix/director/volunteer-page-code.js', '#volFrame', 'rd', 'wix/director/volunteer-embed.html', ['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus']],
  ['athlete', 'wix/training/athlete-page-code.js', '#trainFrame', 'tr', 'wix/training/athlete-embed.html', null],
  ['coach', 'wix/training/coach-page-code.js', '#coachFrame', 'tr', 'wix/training/coach-embed.html', null],
];
function publicPage(file, id, ns, mods) {
  const posts = [];
  let handler, ready;
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === id ? comp : {});
  $w.onReady = (fn) => { ready = fn; };
  new Function('$w', 'wixLocation', ...NAMES, 'console', read(file).replace(/^import .*$/gm, ''))($w, { query: {} }, ...NAMES.map((k) => (k === ns ? mods : {})), console);
  ready();
  let n = 0;
  return { async call(method) { const i = ++n; await handler({ data: { kind: 'call', id: i, method, arg: {} } }); return posts.find((p) => p.id === i) || null; } };
}
for (const [name, file, id, ns, embed, listed] of pubs) {
  const src = read(file);
  const allowed = listed || [...src.match(/const ALLOWED = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const first = allowed[0];
  const have = publicPage(file, id, ns, Object.fromEntries(allowed.map((m) => [m, async () => ({ ran: m })])));
  const r = await have.call(first);
  ok(r.ok === true && r.result.ran === first, 'V1 ' + name + ': a listed method runs');
  const empty = publicPage(file, id, ns, {});
  const r2 = await empty.call(first);
  ok(r2.ok === false && r2.error === 'backend_old', 'V2 ' + name + ': a listed method the backend does not have is answered "backend_old", plain: ' + JSON.stringify(r2 && r2.error));
  const r3 = await have.call('notListedAnywhere');
  ok(r3 && r3.ok === false && r3.error === 'page_code_old', 'V3 ' + name + ': a method the page code does not list is answered "page_code_old", plain, not ignored: ' + JSON.stringify(r3 && r3.error));
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const r4 = await have.call(bad);
    ok(r4 && r4.ok === false && r4.error === 'page_code_old', 'V3 ' + name + ': "' + bad + '" is not a method');
  }
  const thrower = publicPage(file, id, ns, Object.fromEntries(allowed.map((m) => [m, async () => { throw new Error('bad_pin'); }])));
  const r5 = await thrower.call(first);
  ok(r5.ok === false && r5.error === 'bad_pin', 'V4 ' + name + ': a method that throws still answers with its own message');
  ok(!/does not list|most likely|methods/.test(JSON.stringify([r2, r3])), 'V5 ' + name + ': no technical words reach a visitor');
}
{ // the runner page code was already plain
  const posts = [];
  let handler, ready;
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === '#runFrame' ? comp : {});
  $w.onReady = (fn) => { ready = fn; };
  new Function('$w', 'wixLocation', ...NAMES, 'console', read('wix/director/runner-page-code.js').replace(/^import .*$/gm, ''))($w, { query: {} }, ...NAMES.map(() => ({})), console);
  ready();
  await handler({ data: { kind: 'call', id: 1, method: 'pubRaces', arg: {} } });
  await handler({ data: { kind: 'call', id: 2, method: 'nope', arg: {} } });
  eq([posts.find((p) => p.id === 1).error, posts.find((p) => p.id === 2).error], ['backend_old', 'page_code_old'], 'V6 runner: the same two plain answers');
}

// the public screens
async function pageSays(html, error, boot) {
  const s = open(html, () => ({ ok: false, error }));
  await sleep(boot || 450);
  return s;
}
const embeds = [['volunteer', 'wix/director/volunteer-embed.html'], ['athlete', 'wix/training/athlete-embed.html'], ['coach', 'wix/training/coach-embed.html']];
for (const [name, file] of embeds) {
  const html = read(file);
  const msg = words(html);
  ok(typeof msg === 'function', 'V7 ' + name + ': the screen has its message function');
  for (const c of ['page_code_old', 'backend_old']) {
    ok(msg(c).startsWith(PLAIN) && !/page-code\.js|backend file|paste/i.test(msg(c).replace(/\(Organiser:[^)]*\)/, '')), 'V7 ' + name + ': ' + c + ' is said in plain words for a visitor: ' + msg(c));
    eq(msg(c + '|does not list openEvents'), msg(c), 'V7 ' + name + ': details after the bar are never shown (' + c + ')');
  }
  ok(/Organiser: see "If a page shows an error" in SETUP\.md/.test(msg('backend_old')), 'V7 ' + name + ': one short line tells the organiser where to read');
  ok(/tell the organiser/.test(msg('timeout')) && /connection/.test(msg('timeout')), 'V7 ' + name + ': "no answer" says what to try, and whom to tell: ' + msg('timeout'));
  eq(msg('weird_code|detail'), 'Something went wrong. Please try again.', 'V7 ' + name + ': an unknown code is the plain fallback, details dropped');
  eq(msg('constructor'), 'Something went wrong. Please try again.', 'V7 ' + name + ': a name from the prototype is not a code');
  eq(msg(undefined), 'Something went wrong. Please try again.', 'V7 ' + name + ': no code at all is the fallback');
  eq(msg('server_error'), 'Something went wrong. Please try again.', 'V7 ' + name + ': a server error is the plain fallback');
  const t = await pageSays(html, 'page_code_old|does not list openEvents');
  if (name === 'coach') { // the coach page starts at its login form: the first call is the login
    const f = t.d.querySelector('#loginForm');
    f.elements.username.value = 'coach1'; f.elements.password.value = 'pw';
    f.dispatchEvent(new t.w.Event('submit', { cancelable: true, bubbles: true }));
    await sleep(300);
  }
  const body = visible(t.d);
  ok(body.includes(PLAIN) && !/does not list|openEvents/.test(body), 'V8 ' + name + ': the screen says the plain sentence and none of the details');
  eq(t.errors, [], 'V8 ' + name + ': no script error');
}
{ // the runner screen keeps its own words
  const html = read('wix/director/runner-embed.html');
  const msg = words(html);
  eq(msg('page_code_old|does not list pubRaces'), 'This page is being updated. Please try again in a few minutes.', 'V9 runner: details after the bar are never shown');
  eq(msg('weird|x'), 'Something went wrong. Please try again in a moment.', 'V9 runner: an unknown code is the plain fallback');
  eq(msg('constructor'), 'Something went wrong. Please try again in a moment.', 'V9 runner: a name from the prototype is not a code');
}

// ---------------------------------------------------------------- G: the setup guide and the files
const GUIDE = read('docs/SETUP.md');
const WEB = ['racedir.web.js', 'exposoft.web.js', 'training.web.js', 'finance.web.js', 'results.web.js', 'print.web.js', 'runner.web.js', 'comms.web.js', 'waivers.web.js', 'reports.web.js', 'privacy.web.js'];
const PLAINF = ['rd-auth.js', 'ai-core.js', 'rd-approvals.js', 'rd-finance.js', 'rd-results.js', 'rd-print.js', 'rd-data.js', 'rd-comms.js', 'rd-waiver.js', 'rd-report.js', 'rd-privacy.js'];
const ALL22 = WEB.concat(PLAINF);
const section = (GUIDE.split(/^## If a page shows an error\s*$/m)[1] || '').split(/^## /m)[0];
ok(section.length > 3000, 'G1 the guide has the section "If a page shows an error" (' + section.length + ' characters)');
for (const f of ALL22) {
  ok(fs.existsSync('../' + dirOf(f) + '/' + f), 'G2 ' + f + ' is in the pack');
  const t = read(dirOf(f) + '/' + f);
  ok(t.endsWith('\n// END ' + f + '\n') && (t.match(/^\/\/ END /gm) || []).length === 1, 'G2 ' + f + ' ends with the line "// END ' + f + '", once');
  ok(section.includes('`' + f + '`'), 'G3 the guide names ' + f + ' in its check of the 22 files');
  ok(new RegExp('\\| 1-backend/' + f.replace(/\./g, '\\.') + ' \\|').test(GUIDE), 'G3 the table in section A lists ' + f);
}
eq(new Set(ALL22).size, 22, 'G3 the guide counts 22 distinct backend files');
ok(/All 22 files below are needed: none is optional/.test(GUIDE) && /check 1/i.test(section) && /All 22 backend files exist/.test(section), 'G4 the guide says all 22 are needed');
ok(/ai-core\.js[^\n]*\*\*Required, even if you never use the AI features\.\*\*/.test(GUIDE) && !/Optional AI helper/.test(GUIDE) && !/ai-core[^\n]*optional/i.test(GUIDE.replace(/AI features \(optional[^\n]*/g, '')), 'G4 ai-core.js is said to be required, never optional');
ok(/Ctrl\+End/.test(section) && /`\/\/ END` followed by the file's own name/.test(section), 'G5 the guide tells you to look for the end marker with Ctrl+End');
ok(/Developer Tools > Logging Tools > Wix Logs/.test(section), 'G6 the guide says where Wix shows server errors');
ok(/volFrame/.test(section) && /Do not make the volunteer page by duplicating \/rd/.test(section), 'G7 the guide says not to duplicate /rd for the volunteer page, and the element ID to use');
ok(/Save, then Publish|\*\*Save\*\*, then \*\*Publish\*\*/.test(section) && /\?rc=test-site/.test(section), 'G8 the guide says to save, publish and test at the real address, not ?rc=test-site');
// the guide quotes the sentences the screen shows
ok(section.includes('"' + BACKEND + '"') && section.includes('"' + PAGECODE + '"'), 'G9 the guide quotes the two sentences of the Director screen word for word');
ok(dirHtml.includes("This page\\'s code is out of date. Paste the latest page-code.js for this page, then publish.") && dirHtml.includes(BACKEND), 'G9 and the screen still says them');
ok(section.includes('"No answer from the server in time."') && section.includes('"Something went wrong (server_error)"') && section.includes('"Wix Events did not answer"') && section.includes('"Wix Events refused access"'), 'G9 the guide quotes the other sentences it explains');
ok(dirHtml.includes('Wix Events did not answer') && dirHtml.includes('Wix Events refused access'), 'G9 and the screen says the two Wix Events sentences');
// the guide explains every sentence the page code can build
for (const phrase of ['most likely missing or misnamed', 'check that these files exist with exactly these names', 'every file racedir.web.js imports is there, so paste racedir.web.js again, then save and publish', 'has none of its', 'methods (missing', 'more modules have none of their methods', 'more module is an older copy', 'every backend module answers, so paste the newest backend files and publish']) {
  ok(section.includes(phrase), 'G10 the guide explains the bracket sentence "' + phrase + '"');
}
for (const phrase of ['most likely missing or misnamed: ', 'check that these files exist with exactly these names: ', 'every file ', ' imports is there, so paste ', ' again, then save and publish', ' has none of its ', ' methods (missing ', ' more modules have none of their methods', ' more module has none of its methods', ' more modules are older copies', ' more module is an older copy', 'every backend module answers, so paste the newest backend files and publish']) {
  ok(PC.includes(phrase), 'G10 the page code still builds the phrase "' + phrase.trim() + '"');
}
ok(/^## If a page shows an error\s*$/m.test(GUIDE) && /"If a page shows an error" in SETUP\.md/.test(dirHtml), 'G11 the screen and the guide use the same name for the section');
ok(/Events|Registrations/.test(GUIDE) && /only when this screen asks for it/.test(GUIDE), 'G12 the guide says the Wix Events connection is opened only on the Registrations screen');
ok(/## If a page shows an error/.test(GUIDE) && GUIDE.indexOf('## If a page shows an error') > GUIDE.indexOf('## C. Your Wix plan') && GUIDE.indexOf('## If a page shows an error') < GUIDE.indexOf('## Expo desk rules'), 'G13 the section sits after the first-time steps and before the screens');

console.log('Diagnose: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
