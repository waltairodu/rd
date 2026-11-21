// What a person sees when a backend file or a page code is missing.
//  P: the Director page code works out which backend file to look at (the "backend check") and says it in the error it relays;
//  E: the Director screen shows that sentence, escaped and cut to a safe length;
//  V: the volunteer, athlete, coach and runner page codes and screens say it in plain words, with no technical details;
//  G: the setup guide says what each sentence means, and the 11 backend files carry the end marker the guide tells you to look for.
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
const rows = [...PC.matchAll(/\['([\w.-]+\.web\.js)', (\w+), (\w+)\]/g)].map((m) => ({ file: m[1], ns: m[2], list: m[3] }));
const N = {};
rows.forEach((r) => { N[r.file] = listOf(r.list).length; });

eq(rows.map((r) => r.file), ['racedir.web.js', 'exposoft.web.js', 'training.web.js', 'finance.web.js', 'results.web.js', 'print.web.js', 'comms.web.js', 'waivers.web.js', 'reports.web.js', 'privacy.web.js'], 'P0 the check knows the ten web modules the page imports');
const dirOf = (f) => (f === 'exposoft.web.js' ? 'wix/expo' : f === 'training.web.js' ? 'wix/training' : 'wix/director');
// each web module is one file that holds everything it needs, so the check names no helper file (there is none to get wrong)
const checkText = PC.slice(PC.indexOf('function modules()'), PC.indexOf('$w.onReady'));
ok(checkText.length > 500 && !/rd-[a-z]+\.js|ai-core\.js/.test(checkText), 'P0 the backend check names no helper file');
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
// A site where the given web modules are empty (missing, cut, misnamed or left out by Wix's build), and some modules are older copies
function site(o) {
  o = o || {};
  const empty = o.empty || [], old = o.old || {};
  const w = {};
  for (const r of rows) {
    if (empty.includes(r.file)) { w[r.ns] = {}; continue; }
    const mod = full(r);
    (old[r.file] || []).forEach((m) => { delete mod[m]; });
    w[r.ns] = mod;
  }
  return w;
}
const FIRST = listOf('ALLOWED')[0];
const none = (f) => f + ' has none of its ' + N[f] + ' methods: paste ' + f + ' again, then save and publish';
const ALLGONE = 'none of the ' + rows.length + ' backend files answers: check that the Backend list has the 11 files of this pack with exactly these names, paste each one whole, then save and publish';
const ALLFILES = rows.map((r) => r.file);

{ // P1: nothing wrong, nothing said
  const d = director(site());
  const r = await d.call(FIRST);
  ok(r && r.ok === true && r.result.ran === FIRST, 'P1 with every file in place a listed method runs and answers');
  const r2 = await d.call(listOf('FIN_ALLOWED')[0], { mod: 'fin' });
  ok(r2 && r2.ok === true, 'P1 and so does a method of another module');
}
{ // P2: one web module is empty (missing, cut, misnamed or left out by Wix's build): it is named, with what to do, and the others keep working
  const d = director(site({ empty: ['privacy.web.js'] }));
  const r = await d.call('pvList', { mod: 'pv' });
  eq(r.error, 'backend_old|' + none('privacy.web.js'), 'P2 an empty privacy.web.js is named, with the advice to paste it again');
  ok(r.ok === false, 'P2 the answer is a refusal');
  ok((await d.call(FIRST)).ok === true, 'P2 and the other modules keep working');
}
{ // P3: the biggest module empty
  const d = director(site({ empty: ['racedir.web.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|' + none('racedir.web.js'), 'P3 an empty racedir.web.js is named');
  ok((await d.call(listOf('FIN_ALLOWED')[0], { mod: 'fin' })).ok === true, 'P3 and finance.web.js still answers');
}
{ // P4: two empty at once: both are named, in the order the page lists the modules (not the order they were emptied)
  const d = director(site({ empty: ['finance.web.js', 'racedir.web.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|' + none('racedir.web.js') + '; ' + none('finance.web.js'), 'P4 two empty modules are both named, racedir.web.js first');
}
{ // P5: three empty modules are all named, with no "more"
  const d = director(site({ empty: ['racedir.web.js', 'exposoft.web.js', 'training.web.js'] }));
  eq((await d.call(FIRST)).error, 'backend_old|' + none('racedir.web.js') + '; ' + none('exposoft.web.js') + '; ' + none('training.web.js'), 'P5 three empty modules are all named');
}
{ // P6: every module empty (nothing pasted yet, or Wix built none of them): one line of advice, not ten sentences
  const d = director(site({ empty: ALLFILES }));
  eq((await d.call(FIRST)).error, 'backend_old|' + ALLGONE, 'P6 with every module empty the sentence is one line of advice');
  eq((await d.call('assignCoach', { mod: 'train' })).error, 'backend_old|' + ALLGONE, 'P6 and the same for a method of another module');
}
{ // P7: a lone empty training.web.js
  const d = director(site({ empty: ['training.web.js'] }));
  eq((await d.call('assignCoach', { mod: 'train' })).error, 'backend_old|' + none('training.web.js'), 'P7 a lone empty training.web.js: paste it again');
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
{ // P11: empty and older at once: the empty ones (with their advice) come first
  const d = director(site({ empty: ['training.web.js'], old: { 'finance.web.js': ['finVoid'] } }));
  const e = (await d.call('assignCoach', { mod: 'train' })).error;
  ok(e.indexOf('training.web.js has none of its') >= 0 && e.indexOf('training.web.js has none of its') < e.indexOf('paste training.web.js again') && e.indexOf('paste training.web.js again') < e.indexOf('finance.web.js has '), 'P11 the empty module and its advice, then the older copy: ' + e);
}
{ // P12: four modules empty: three are listed, the fourth is counted (singular); five: "2 more modules" (plural)
  const four = ['racedir.web.js', 'exposoft.web.js', 'training.web.js', 'finance.web.js'];
  const d = director(site({ empty: four }));
  eq((await d.call(FIRST)).error, 'backend_old|' + none('racedir.web.js') + '; ' + none('exposoft.web.js') + '; ' + none('training.web.js') + '; 1 more module has none of its methods', 'P12 a fourth empty module is "1 more module has none of its methods"');
  const d2 = director(site({ empty: four.concat(['results.web.js']) }));
  eq((await d2.call(FIRST)).error, 'backend_old|' + none('racedir.web.js') + '; ' + none('exposoft.web.js') + '; ' + none('training.web.js') + '; 2 more modules have none of their methods', 'P12 five empty modules: three listed, "2 more modules have none of their methods"');
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
  const d = director(site({ empty: ALLFILES }));
  const r = await d.call(FIRST);
  ok(r.error.length <= 'backend_old|'.length + 420, 'P17 the sentence stays within 420 characters (' + r.error.length + ')');
  // the longest case: nine of the ten empty, one older copy cannot exist at the same time, so nine empty and the tenth answering
  const nine = director(site({ empty: ALLFILES.slice(0, 9) }));
  const rn = await nine.call(FIRST);
  ok(rn.error.length <= 'backend_old|'.length + 420 && /; 6 more modules have none of their methods$/.test(rn.error), 'P17 nine empty modules: three named, six counted, still within 420 characters (' + rn.error.length + ')');
  // empty plus older: the cut at 420 never removes the advice that comes first
  const mix = director(site({ empty: ALLFILES.slice(0, 3), old: { 'finance.web.js': listOf('FIN_ALLOWED').slice(-6), 'results.web.js': listOf('RES_ALLOWED').slice(-6), 'print.web.js': listOf('PRN_ALLOWED').slice(-3) } }));
  const rm = await mix.call(FIRST);
  ok(rm.error.length <= 'backend_old|'.length + 420 && rm.error.startsWith('backend_old|' + none('racedir.web.js')), 'P17 empty and older modules together: still within 420 characters and the advice is first (' + rm.error.length + ')');
  const w = {};
  const d2 = director(w);
  const r2 = await d2.call(FIRST);
  ok(r2.ok === false && r2.error === 'backend_old|' + ALLGONE, 'P17 with no module found at all the sentence is the all-empty advice: ' + r2.error);
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
const BACKEND = 'The backend file is out of date. Paste the latest backend files, then publish. Then read the build report (build.log) that Wix writes when you publish: SETUP.md, check 6.';
const PAGECODE = 'This page\'s code is out of date. Paste the latest page-code.js for this page, then publish.';
{
  const detail = 'racedir.web.js has none of its 73 methods: paste racedir.web.js again, then save and publish';
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
const OLDHELPERS = ['rd-auth.js', 'ai-core.js', 'rd-approvals.js', 'rd-finance.js', 'rd-results.js', 'rd-print.js', 'rd-data.js', 'rd-comms.js', 'rd-waiver.js', 'rd-report.js', 'rd-privacy.js'];
const section = (GUIDE.split(/^## If a page shows an error\s*$/m)[1] || '').split(/^## /m)[0];
ok(section.length > 3000, 'G1 the guide has the section "If a page shows an error" (' + section.length + ' characters)');
for (const f of WEB) {
  ok(fs.existsSync('../' + dirOf(f) + '/' + f), 'G2 ' + f + ' is in the pack');
  const t = read(dirOf(f) + '/' + f);
  ok(t.endsWith('\n// END ' + f + '\n') && (t.match(/^\/\/ END /gm) || []).length === 1, 'G2 ' + f + ' ends with the line "// END ' + f + '", once');
  ok(section.includes('`' + f + '`'), 'G3 the guide names ' + f + ' in its check of the 11 files');
  ok(new RegExp('\\| 1-backend/' + f.replace(/\./g, '\\.') + ' \\|').test(GUIDE), 'G3 the table in section A lists ' + f);
}
eq(new Set(WEB).size, 11, 'G3 the guide counts 11 distinct backend files');
ok(/\*\*All 11 files below are needed: none is optional\.\*\*/.test(GUIDE) && /check 1/i.test(section) && /All 11 backend files exist/.test(section), 'G4 the guide says all 11 are needed');
// no helper file is a file to add any more; the guide says to delete the old ones, in the quick start, in section A and in check 1
for (const f of OLDHELPERS) {
  ok(!new RegExp('\\| 1-backend/' + f.replace(/\./g, '\\.') + ' \\|').test(GUIDE), 'G4 the table of files has no row for the old helper ' + f);
  ok(GUIDE.split('`' + f + '`').length - 1 >= 3, 'G4 the guide names the old helper ' + f + ' where it says to delete it (quick start, section A, check 1)');
}
ok(/\*\*Delete the old helper files\*\*/.test(GUIDE) && /\*\*Delete all eleven\*\*/.test(GUIDE) && /delete them, because one that is only half pasted can stop Wix's build/.test(section), 'G4 the guide says to delete the eleven old helper files');
ok(!/\b22 (backend )?files\b/.test(GUIDE) && !/two backend files, `(finance|results|comms|waivers|reports|privacy)\.web\.js`/.test(GUIDE), 'G4 nothing in the guide still counts 22 files or asks for a helper beside a web module');
// the quick start at the top of the guide: how to run it and log in
const QS = (GUIDE.split(/^## Quick start: run it and log in\s*$/m)[1] || '').split(/^## A\. /m)[0];
ok(QS.length > 1800 && GUIDE.indexOf('## Quick start: run it and log in') < GUIDE.indexOf('## A. The files and where each one goes'), 'Q1 the guide opens with a quick start that comes before section A (' + QS.length + ' characters)');
ok(/1\. \*\*Backend: 11 files\.\*\*/.test(QS) && /\*\*Dev Mode\*\*/.test(QS) && /Add web module/.test(QS) && /Ctrl\+End/.test(QS) && /`\/\/ END`/.test(QS), 'Q2 the quick start says to turn Dev Mode on, add 11 web modules and check the END line');
ok(/2\. \*\*Delete the old helper files\*\*/.test(QS) && /\*\*after\*\* step 1/.test(QS), 'Q3 the quick start says to delete the old helper files after pasting the new ones');
ok(/3\. \*\*Pages: five\.\*\*/.test(QS) && /4\. \*\*Save, then Publish\.\*\*/.test(QS) && /View build\.log/.test(QS), 'Q4 the quick start covers the five pages, Save and Publish and the build report');
ok(/5\. \*\*Open the published address\*\* `https:\/\/www\.vtra\.run\/rd`: not the Editor's Preview/.test(QS) && /\?rc=test-site/.test(QS), 'Q5 the quick start says to open the published address, not the Editor\'s Preview');
ok(/6\. \*\*Sign in\*\* with the username `master`/.test(QS) && /\*\*change that password on the Team screen at once\*\*/.test(QS) && /not written in any file of this pack/.test(QS), 'Q6 the quick start says to sign in as master, to change that password at once, and that no file holds it');
ok(['/rd', '/coach', '/train', '/volunteer', '/runner'].every((x) => QS.includes('**' + x + '**')) && /\/volunteer\*\* and \*\*\/runner\*\* are public pages and have no login/.test(QS), 'Q7 the quick start says who signs in where (/rd, /coach, /train; /volunteer and /runner are public)');
const DBS = (GUIDE.split(/^## D\. The database collections \(37\)\s*$/m)[1] || '').split(/^## /m)[0];
ok(DBS.length > 1500 && /\*\*Sandbox\*\*/.test(DBS) && /\*\*Live\*\*/.test(DBS) && /set to the site admin/.test(DBS) && /`admin`, `director`, `lead1`, `coach1`, `desk1`, `user1` and `user2`/.test(DBS), 'Q8 section D says where the data is (Sandbox and Live), that every collection is locked, and which seven old logins need new passwords (' + DBS.length + ' characters)');
{
  const UP = read('docs/UPGRADE.md');
  ok(/^## 2\. Delete the 11 old helper files\s*$/m.test(UP) && /\*\*Only after step 1\.\*\*/.test(UP) && /Give the seven older logins new passwords/.test(UP) && /^# Package 6c /m.test(UP), 'Q9 UPGRADE.md says to delete the 11 helper files after step 1 and to give the seven older logins new passwords');
}
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
for (const phrase of ['racedir.web.js has none of its 73 methods: paste racedir.web.js again, then save and publish', 'none of the 10 backend files answers: check that the Backend list has the 11 files of this pack with exactly these names, paste each one whole, then save and publish', 'has none of its', 'methods (missing', 'more modules have none of their methods', 'more module is an older copy', 'every backend module answers, so paste the newest backend files and publish']) {
  ok(section.includes(phrase), 'G10 the guide explains the bracket sentence "' + phrase + '"');
}
for (const phrase of ['none of the ', ' backend files answers: check that the Backend list has the 11 files of this pack with exactly these names, paste each one whole, then save and publish', ': paste ', ' again, then save and publish', ' has none of its ', ' methods (missing ', ' more modules have none of their methods', ' more module has none of its methods', ' more modules are older copies', ' more module is an older copy', 'every backend module answers, so paste the newest backend files and publish']) {
  ok(PC.includes(phrase), 'G10 the page code still builds the phrase "' + phrase.trim() + '"');
}
ok(/^## If a page shows an error\s*$/m.test(GUIDE) && /"If a page shows an error" in SETUP\.md/.test(dirHtml), 'G11 the screen and the guide use the same name for the section');
ok(/Events|Registrations/.test(GUIDE) && /only when this screen asks for it/.test(GUIDE), 'G12 the guide says the Wix Events connection is opened only on the Registrations screen');
ok(/## If a page shows an error/.test(GUIDE) && GUIDE.indexOf('## If a page shows an error') > GUIDE.indexOf('## C. Your Wix plan') && GUIDE.indexOf('## If a page shows an error') < GUIDE.indexOf('## Expo desk rules'), 'G13 the section sits after the first-time steps and before the screens');

// ---------------------------------------------------------------- G14: Wix's own build report (Wix scans every code file when you publish)
{
  const UPG = read('docs/UPGRADE.md');
  const top = UPG.split(/^# Package 6 \(Privacy\)/m)[0];
  ok(/nearly every error has one of six causes/.test(section) && /most problems end at check 1, 2 or 6/.test(section), 'G14 the guide counts six causes and points at check 6');
  ok(/^6\. \*\*Wix's own build report has no error\.\*\*/m.test(section), 'G14 check 6 of the guide is the build report');
  ok(/View build\.log/.test(section) && /Proceed with publishing/.test(section) && /Developer Tools/.test(section) && /Latest build/.test(section) && /`build\.log`/.test(section), 'G14 check 6 says where the report is (pop-up, then Developer Tools > Latest build > build.log)');
  ok(/left out, and every method in it then looks missing/.test(section), 'G14 check 6 says why a file with an error looks like an old file');
  ok(/Read the table below, then checks 1, 2, 4 and 6\./.test(section) && /Checks 5, 1, 4 and 6\./.test(section), 'G14 the table of sentences points at check 6 too');
  ok(/\*\*Publish\*\* the site\.[^\n]*View build\.log[^\n]*check 6/.test(GUIDE), 'G14 the first-time steps tell you about the pop-up when you publish');
  ok(/View build\.log/.test(top) && /Latest build/.test(top) && /check 6/.test(top), 'G14 the upgrade page tells you about the pop-up and the report');
  // the line the guide says to replace is in racedir.web.js, word for word, once
  const oldLine = (section.match(/replace the line `(const eventsApi = \(\) => import\('wix-events\.v2'\);)`/) || [])[1] || '';
  const racedirSrc = read('wix/director/racedir.web.js');
  ok(oldLine !== '' && racedirSrc.split(oldLine).length === 2, 'G14 the line the guide says to replace is in racedir.web.js, once, word for word');
  const block = (section.match(/```js\n([\s\S]*?)```/) || [])[1] || '';
  eq(block.trim().split('\n').map((l) => l.trim()), ["import * as wixEventsModule from 'wix-events.v2';", 'const eventsApi = async () => wixEventsModule;'], 'G14 the guide gives the two replacement lines (indented under item 6 in the source; the page shows them flush)');
}

console.log('Diagnose: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
