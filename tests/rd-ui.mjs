// Tests for the combined /rd page: Race Director with the Expo desk inside it (wix/director/rd-embed.html, built by tools/build_rd.py).
import fs from 'fs';
import { execSync } from 'child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as D from './racedir.test.mjs';
import * as X from './exposoft.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
execSync('python3 ../tools/build_rd.py');
const html = fs.readFileSync('../wix/director/rd-embed.html', 'utf8');
ok(/var EXPO_SRC="<!doctype html>/i.test(html) && !/var EXPO_SRC=null/.test(html), 'built page contains the Expo desk');
ok((html.match(/<\/script>/g) || []).length === 2, 'built page: only the two real script end tags (main script and height reporter), none leaked from the embedded Expo page');
ok(fs.readFileSync('../wix/director/director-embed.html', 'utf8').includes('var EXPO_SRC=null;'), 'source director page still has the placeholder');
const pc = fs.readFileSync('../wix/director/director-page-code.js', 'utf8');
const exAllowed = pc.match(/const EXPO_ALLOWED = \[([^\]]*)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
ok(exAllowed.every((m) => typeof X[m] === 'function') && exAllowed.includes('issue') && exAllowed.includes('login'), 'page code: every Expo method it allows exists');
const expoPc = fs.readFileSync('../wix/expo/exposoft-page-code.js', 'utf8').match(/const ALLOWED = \[([^\]]*)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
ok(JSON.stringify(expoPc) === JSON.stringify(exAllowed), 'page code: same Expo method list as the stand-alone Expo page');

await wd.insert('ExpoConfig', { _id: 'Import910', name: 'VHM', json: JSON.stringify({ bibLot: 100, shirtLot: { XS: 0, S: 5, M: 5, L: 5, XL: 0, XXL: 0 } }) }, SA);
for (let k = 1; k <= 3; k++) await wd.insert('Runners', { _id: 'Import910~R' + k, event: 'Import910', bib: 'R' + k, name: 'Runner ' + k, cat: '21K', size: 'M', phone: '900000000' + k, email: '', example: '', checkedInAt: '', checkedInDesk: '', bibAt: '', bibDesk: '', shirtSize: '', shirtAt: '', shirtDesk: '' }, SA);
for (const [u, r, desks, race] of [['boss', 'admin', '', ''], ['dir', 'director', '', ''], ['lead1', 'lead', '', ''], ['view1', 'viewer', '', ''], ['desk1', '', 'Desk 1', 'Import910']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks, race, name: u, failCount: '0', lockUntil: '' }, SA);

const calls = [];
function open() {
  // Like the real thing: the Wix page (outer window) holds the page-code relay; the /rd page is a frame in it;
  // the Expo desk is a frame inside that.
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('JSERR', e.message); fail++; });
  const outer = new JSDOM('<body></body>', { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const ow = outer.window;
  const fr = ow.document.createElement('iframe');
  ow.document.body.appendChild(fr);
  const w = fr.contentWindow;
  const cd = fr.contentDocument;
  cd.open();
  // jsdom ignores iframe srcdoc, so write the page into the frame the way a browser would load it.
  Object.defineProperty(w.HTMLIFrameElement.prototype, 'srcdoc', { configurable: true, set(v) { const f = this; setTimeout(() => { const c2 = f.contentDocument; c2.open(); c2.write(v); c2.close(); f.dispatchEvent(new w.Event('load')); }, 20); }, get() { return ''; } });
  cd.write(html);
  cd.close();
  const d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  ow.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    const mod = m.mod === 'expo' ? X : D;
    calls.push((m.mod || 'rd') + ':' + m.method);
    try {
      const r = m.method === 'ping' ? { pong: true } : await mod[m.method](m.arg);
      w.postMessage({ kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) }, '*');
    } catch (x) { w.postMessage({ kind: 'result', id: m.id, ok: false, error: x.message }, '*'); }
  });
  return { w, d };
}
const set = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
async function login(user, pw) {
  const s = open(); await sleep(60);
  set(s.w, s.d.querySelector('#lgUser'), user); set(s.w, s.d.querySelector('#lgPass'), pw || 'pw'); submit(s.w, s.d.querySelector('#loginForm'));
  await sleep(500);
  return s;
}
const inner = (s) => { const f = s.d.querySelector('#expoFrame'); return f && f.contentDocument; };

// ---- director: Expo desk tab
{
  calls.length = 0;
  const s = await login('boss');
  ok(s.d.querySelector('[data-tab="expo"]') && /BIB & Expo/.test(txt(s.d.querySelector('.tabs'))), 'admin sees the Expo desk tab');
  ok(s.d.querySelector('#expoWrap').hidden && !s.d.querySelector('#expoFrame'), 'Expo desk is not loaded until its tab is opened');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(1800);
  const f = s.d.querySelector('#expoFrame');
  ok(f && !s.d.querySelector('#expoWrap').hidden, 'opening the tab shows the Expo desk frame');
  const id = inner(s);
  ok(id && id.querySelector('#loginForm') && id.querySelector('#loginForm').hidden, 'Expo desk logged in by itself with the same login (no second login form)');
  ok(calls.filter((c) => c === 'expo:login').length === 1, 'Expo login went to the Expo backend through the page, once');
  ok(!calls.slice(calls.indexOf('expo:login')).some((c) => c.startsWith('rd:') && /login/.test(c)), 'the Director backend was not asked to log in twice');
  click(s.w, s.d.querySelector('[data-tab="overview"]')); await sleep(300);
  ok(s.d.querySelector('#expoWrap').hidden && s.d.querySelector('#expoFrame'), 'leaving the tab hides the desk but keeps it (it keeps its state)');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(100);
  ok(!s.d.querySelector('#expoWrap').hidden && inner(s).querySelector('#loginForm').hidden, 'coming back shows the same logged-in desk');
  click(s.w, s.d.querySelector('[data-act="logout"]')); await sleep(700);
  ok(!s.d.querySelector('#expoFrame') && s.d.querySelector('#loginForm') && s.d.querySelector('#expoWrap').hidden, 'logout removes the Expo desk and returns to the login');
  ok(calls.includes('expo:logout'), 'logout also ended the Expo session');
}
// ---- director role works too; lead and viewer do not get the Expo tab
{
  const s = await login('dir');
  ok(s.d.querySelector('[data-tab="expo"]'), 'director role sees the Expo desk tab');
}
for (const u of ['lead1', 'view1']) {
  const s = await login(u);
  ok(s.d.querySelector('.tabs') && !s.d.querySelector('[data-tab="expo"]'), u + ' does not see the Expo desk tab');
  ok(!s.d.querySelector('#expoFrame'), u + ': no Expo frame at all');
}
// ---- desk login: straight to the Expo desk, no Director
{
  calls.length = 0;
  const s = await login('desk1');
  ok(!s.d.querySelector('.tabs') && /Expo desk/.test(txt(s.d.querySelector('#app'))), 'desk login sees only the Expo desk, no Director tabs');
  ok(!s.d.querySelector('#expoWrap').hidden && s.d.querySelector('#expoFrame'), 'desk login: Expo frame shown');
  await sleep(1500);
  const id = inner(s);
  ok(calls.filter((c) => c === 'expo:login').length === 1 && id && !id.querySelector('#app').hidden && id.querySelector('#gate').hidden, 'desk login: Expo desk logged in by itself, through the Expo backend');
  click(s.w, s.d.querySelector('[data-act="logout"]')); await sleep(700);
  ok(!s.d.querySelector('#expoFrame') && s.d.querySelector('#loginForm'), 'desk login: logout returns to the login');
}
// ---- wrong password never gets in
{
  const s = await login('desk1', 'nope');
  ok(s.d.querySelector('#loginForm') && !s.d.querySelector('#expoFrame') && /Wrong username/.test(txt(s.d.querySelector('#app'))), 'wrong password: stays on login, no Expo frame');
}
// ---- the Expo frame cannot reach Director methods
{
  const s = await login('boss');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(1500);
  const before = calls.length;
  inner(s).defaultView.parent.postMessage({ kind: 'call', id: 99, method: 'saveEvent', arg: { name: 'x' } }, '*');
  await sleep(200);
  ok(calls.slice(before).every((c) => c.startsWith('expo:')), 'calls from the Expo frame are always sent to the Expo backend, never to the Director backend');
}
console.log(`RD page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
