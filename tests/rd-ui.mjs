// Tests for the combined /rd page: Race Director with the Expo desk inside it (wix/director/rd-embed.html, built by tools/build_rd.py).
// One login for everything: the Expo desk has no login of its own; the page adds its session token to the desk's calls.
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
ok(exAllowed.every((m) => typeof X[m] === 'function') && exAllowed.includes('issue') && exAllowed.includes('enter'), 'page code: every Expo method it allows exists, including enter');
ok(!exAllowed.some((m) => ['login', 'logout', 'ensureSetup'].includes(m)), 'page code: the Expo desk has no login, logout or setup to call');
ok(!fs.existsSync('../wix/expo/exposoft-page-code.js'), 'there is no stand-alone Expo page any more');
const expoSrc = fs.readFileSync('../wix/expo/exposoft-embed.html', 'utf8');
ok(!/id="loginForm"|id="setupForm"|lgUser|lgPass|ensureSetup|sessionStorage|autologin/.test(expoSrc), 'Expo desk page: no login form, no first-time setup, no stored token, no auto-login');
ok(!/data-act="logout"/.test(expoSrc), 'Expo desk page: no Log out button of its own');
ok(!/autologin|S\.cred/.test(fs.readFileSync('../wix/director/director-embed.html', 'utf8')), 'RaceOS page: no credential replay into the Expo desk');

await wd.insert('ExpoConfig', { _id: 'Import910', name: 'VHM', json: JSON.stringify({ bibLot: 100, shirtLot: { XS: 0, S: 5, M: 5, L: 5, XL: 0, XXL: 0 } }) }, SA);
for (let k = 1; k <= 3; k++) await wd.insert('Runners', { _id: 'Import910~R' + k, event: 'Import910', bib: 'R' + k, name: 'Runner ' + k, cat: '21K', size: 'M', phone: '900000000' + k, email: '', example: '', checkedInAt: '', checkedInDesk: '', bibAt: '', bibDesk: '', shirtSize: '', shirtAt: '', shirtDesk: '' }, SA);
for (const [u, r, desks, race] of [['boss', 'admin', '', ''], ['dir', 'director', '', ''], ['lead1', 'lead', '', ''], ['view1', 'viewer', '', ''], ['desk1', '', 'Desk 1', 'Import910'], ['deskb', 'desk', 'Desk 2', 'Import910'], ['coach1', 'coach', '', '']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks, race, name: u, failCount: '0', lockUntil: '' }, SA);

const calls = [];      // 'rd:method' or 'expo:method', in order
const expoArgs = [];   // the argument of every Expo call as the page code received it
const frameSent = [];  // every message the Expo desk frame itself sent to the RaceOS page
let tokens = [];       // tokens handed out by RaceOS login
function open() {
  // Like the real thing: the Wix page (outer window) holds the page-code relay; the /rd page is a frame in it;
  // the Expo desk is a frame inside that. Messages from the desk carry their real sender, as in a browser.
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
  Object.defineProperty(w.HTMLIFrameElement.prototype, 'srcdoc', { configurable: true, set(v) {
    const f = this;
    setTimeout(() => {
      const iw = f.contentWindow;
      const proxy = { postMessage(data) { frameSent.push(data); w.dispatchEvent(new w.MessageEvent('message', { data, source: iw })); } };
      Object.defineProperty(iw, 'parent', { configurable: true, get() { return proxy; } });
      // What the RaceOS page sends down to the desk frame arrives as coming from the page itself (the frame's parent).
      iw.postMessage = (data) => setTimeout(() => iw.dispatchEvent(new iw.MessageEvent('message', { data, source: proxy })), 0);
      const c2 = f.contentDocument; c2.open(); c2.write(v); c2.close(); f.dispatchEvent(new w.Event('load'));
    }, 20);
  }, get() { return ''; } });
  cd.write(html);
  cd.close();
  const d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  ow.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    const mod = m.mod === 'expo' ? X : D;
    calls.push((m.mod || 'rd') + ':' + m.method);
    if (m.mod === 'expo') expoArgs.push(m.arg);
    try {
      const r = m.method === 'ping' ? { pong: true } : await mod[m.method](m.arg);
      if (m.method === 'login' && r && r.token) tokens.push(r.token);
      w.postMessage({ kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) }, '*');
    } catch (x) { w.postMessage({ kind: 'result', id: m.id, ok: false, error: x.message }, '*'); }
  });
  return { w, d, ow };
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
const presence = async (u) => (await wd.get('ExpoPresence', u, SA).catch(() => null)) || null;

// ---- director: Expo desk tab
{
  calls.length = 0; expoArgs.length = 0; frameSent.length = 0; tokens = [];
  const s = await login('boss');
  ok(s.d.querySelector('[data-tab="expo"]') && /BIB & Expo/.test(txt(s.d.querySelector('.tabs'))), 'admin sees the Expo desk tab');
  ok(s.d.querySelector('#expoWrap').hidden && !s.d.querySelector('#expoFrame'), 'Expo desk is not loaded until its tab is opened');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(1800);
  const f = s.d.querySelector('#expoFrame');
  ok(f && !s.d.querySelector('#expoWrap').hidden, 'opening the tab shows the Expo desk frame');
  const id = inner(s);
  ok(id && !id.querySelector('#loginForm') && !id.querySelector('#lgUser') && !id.querySelector('#setupForm'), 'Expo desk has no login form and no first-time setup');
  ok(calls.filter((c) => c === 'expo:enter').length === 1, 'Expo desk started with one enter call through the page');
  ok(!calls.some((c) => c === 'expo:login') && calls.filter((c) => c === 'rd:login').length === 1, 'no second login: RaceOS logged in once, the Expo desk never logs in');
  ok(expoArgs.length > 0 && expoArgs.every((a) => a && typeof a.token === 'string' && a.token === tokens[0]), 'every Expo call carries the one RaceOS session token (added by the page)');
  ok(frameSent.length > 0 && frameSent.every((m) => !m.arg || m.arg.token === undefined), 'the Expo desk frame itself never holds or sends a token');
  ok(!id.querySelector('#pickForm').hidden && id.querySelector('#pkRace').parentNode.hidden && !id.querySelector('#pkDesk').parentNode.hidden, 'director is asked only for the desk (one race exists)');
  id.querySelector('#pkDesk').value = 'Desk 3 - Misc';
  submit(id.defaultView, id.querySelector('#pickForm')); await sleep(900);
  ok(!id.querySelector('#app').hidden && id.querySelector('#gate').hidden, 'director chose a desk and is at the work screen');
  ok(!id.querySelector('[data-act="logout"]'), 'no Log out button inside the Expo desk');
  ok((await presence('boss')) && (await presence('boss')).desk === 'Desk 3 - Misc', 'the desk the director took is held');
  click(s.w, s.d.querySelector('[data-tab="overview"]')); await sleep(300);
  ok(s.d.querySelector('#expoWrap').hidden && s.d.querySelector('#expoFrame'), 'leaving the tab hides the desk but keeps it (it keeps its state)');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(100);
  ok(!s.d.querySelector('#expoWrap').hidden && !inner(s).querySelector('#app').hidden, 'coming back shows the same desk, still working');
  click(s.w, s.d.querySelector('[data-act="logout"]')); await sleep(700);
  ok(!s.d.querySelector('#expoFrame') && s.d.querySelector('#loginForm') && s.d.querySelector('#expoWrap').hidden, 'logout removes the Expo desk and returns to the login');
  ok(calls.includes('rd:logout') && !calls.includes('expo:logout'), 'logout ends the one session (there is no separate Expo session)');
  ok(!(await presence('boss')), 'logout freed the desk the director was holding');
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
  ok(!s.d.querySelector('[data-tab="team"]'), u + ' does not see the Team screen');
}
// ---- desk login: straight to the Expo desk, no Director
for (const [u, desk] of [['desk1', 'Desk 1 - BIB'], ['deskb', 'Desk 2 - Tshirt']]) {
  calls.length = 0; expoArgs.length = 0; frameSent.length = 0; tokens = [];
  const s = await login(u);
  ok(!s.d.querySelector('.tabs') && /Expo desk/.test(txt(s.d.querySelector('#app'))), u + ': sees only the Expo desk, no Director tabs');
  ok(!s.d.querySelector('#expoWrap').hidden && s.d.querySelector('#expoFrame'), u + ': Expo frame shown');
  await sleep(1500);
  const id = inner(s);
  ok(id && !id.querySelector('#app').hidden && id.querySelector('#gate').hidden, u + ': straight into the work screen (race and desk are fixed), no picker');
  ok(id && id.querySelector('#deskName').value === desk, u + ': desk shown is ' + desk);
  ok(calls.filter((c) => c === 'expo:enter').length === 1 && !calls.some((c) => c === 'expo:login'), u + ': one enter call, no Expo login');
  ok(!calls.some((c) => c.startsWith('rd:') && c !== 'rd:login'), u + ': no Director method was called for a desk login (not even to list races)');
  ok((await presence(u)) && (await presence(u)).desk === desk, u + ': holds its desk');
  click(s.w, s.d.querySelector('[data-act="logout"]')); await sleep(700);
  ok(!s.d.querySelector('#expoFrame') && s.d.querySelector('#loginForm'), u + ': logout returns to the login');
  ok(!(await presence(u)), u + ': logout freed the desk at once');
}
// ---- wrong password never gets in; coach logins are sent to the coach page
{
  const s = await login('desk1', 'nope');
  ok(s.d.querySelector('#loginForm') && !s.d.querySelector('#expoFrame') && /Wrong username/.test(txt(s.d.querySelector('#app'))), 'wrong password: stays on login, no Expo frame');
  const c = await login('coach1');
  ok(c.d.querySelector('#loginForm') && !c.d.querySelector('#expoFrame') && /coach page/i.test(txt(c.d.querySelector('#app'))), 'coach login: stays on the login with a note that coaches use the coach page');
}
// ---- the Expo frame cannot reach Director methods, and only the Expo frame may speak for the desk
{
  const s = await login('boss');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(1500);
  const before = calls.length;
  inner(s).defaultView.parent.postMessage({ kind: 'call', id: 99, method: 'saveEvent', arg: { name: 'x' } }, '*');
  await sleep(200);
  ok(calls.slice(before).length > 0 && calls.slice(before).every((c) => c.startsWith('expo:')), 'calls from the Expo frame are always sent to the Expo backend, never to the Director backend');
  // a message from any other window (no sender, or a sibling) must not be answered with the session token
  const before2 = calls.length;
  s.w.postMessage({ kind: 'call', id: 100, method: 'issue', arg: { id: 'Import910~R1', bib: true } }, '*');
  s.w.dispatchEvent(new s.w.MessageEvent('message', { data: { kind: 'call', id: 101, method: 'importRunners', arg: { rows: [] } }, source: s.ow }));
  await sleep(250);
  ok(calls.length === before2, 'a call from the page itself, or from any window other than the Expo frame, is ignored (no token is added for it)');
  // open-team: the frame may ask for the Team screen, nobody else
  s.w.postMessage({ kind: 'open-team' }, '*'); await sleep(100);
  ok(!s.d.querySelector('#teamForm'), 'open-team from another sender is ignored');
  inner(s).defaultView.parent.postMessage({ kind: 'open-team' }, '*'); await sleep(500);
  ok(s.d.querySelector('#teamForm'), 'open-team from the Expo desk opens the Team screen for a director');
}
// ---- the session ends (a director signs the login out) while the desk is open: the page returns to the login
{
  const s = await login('boss');
  click(s.w, s.d.querySelector('[data-tab="expo"]')); await sleep(1500);
  for (const x of (await wd.query('ExpoSessions').limit(1000).find(SA)).items) if (x.username === 'boss') await wd.bulkRemove('ExpoSessions', [x._id], SA);
  inner(s).defaultView.parent.postMessage({ kind: 'call', id: 77, method: 'whoami', arg: {} }, '*'); await sleep(500);
  ok(s.d.querySelector('#loginForm') && !s.d.querySelector('#expoFrame') && /session ended/i.test(txt(s.d.querySelector('#app'))), 'session ended behind the desk: back to the login with a clear note');
}
console.log(`RD page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
