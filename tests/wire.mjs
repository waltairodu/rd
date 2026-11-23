// FAILURES ARE ANSWERED: what the live site does to a thrown error, and what the pack does about it.
// On 22 November 2026 the sign-in on the live site showed "Unable to handle the request. Contact the site administrator or view site monitoring logs
// for more information." and the database had counted three wrong passwords. Wix does not pass on the message of an error that a web method throws; it
// puts its own text there. So a wrong password could not be told from a crash, and every other message of the screen (session ended, locked, not
// allowed, a field to fill in) was lost the same way. Now the page code passes WIRE (2) as the second argument of every call it relays, and a backend
// method that is asked this way returns { __rdError: 'code' }, a plain value that always arrives, instead of throwing; the page code gives the screen the
// same ok:false and code that it always got from a throw. Without WIRE (an older page code, the other suites, a call inside a backend file) a method
// throws as before, so a page code and a backend file of different versions still work together.
//   W1  the helper       failure(): the answer has one key, a code or a short text, nothing else; WIRE is 2
//   W2  the backend      all 11 files: asked this way no method rejects, whatever it is given; not asked, it throws as before; the sign-ins as values
//   W3  the page codes   all 5 page codes: ask for it on every call; an answer becomes ok:false + code, a value ok:true, a real throw still ok:false
//   W4  the screen       the real sign-in screen with the real page code and the real backend: what a person reads after a wrong password, a lock, Wix's own text
//   W5  the sources      every wrapper has the same shape, the page codes ask on every relayed call and post through one function, the guides say it
import fs from 'fs';
import wd from 'wix-data';
import { suite, resetDb, tenMinutesLater } from './lib.mjs';
import { makeHarness, sleep } from './rd-harness.mjs';
import * as D from './racedir.test.mjs';
import * as X from './exposoft.test.mjs';
import * as T from './training.test.mjs';
import * as FN from './finance.test.mjs';
import * as RS from './results.test.mjs';
import * as PR from './print.test.mjs';
import * as CM from './comms.test.mjs';
import * as WV from './waivers.test.mjs';
import * as RP from './reports.test.mjs';
import * as PV from './privacy.test.mjs';
import * as PUB from './runner.test.mjs';
import * as A from './rd-auth.test.mjs';

const { ok, eq, err, done } = suite('Failures are answers');
const SA = { suppressAuth: true };
const read = (f) => fs.readFileSync('../' + f, 'utf8');
const KEY = '__rdError';
const W = A.WIRE;
const isAnswer = (r) => !!r && typeof r === 'object' && typeof r[KEY] === 'string';

/* ---------- W1: the helper ---------- */
eq(W, 2, 'W1 WIRE is 2');
eq(A.FAILURE_KEY, KEY, 'W1 the key is __rdError');
eq(A.failure(new Error('bad_login')), { [KEY]: 'bad_login' }, 'W1 an error becomes { __rdError: its message }');
eq(A.failure('plain_code'), { [KEY]: 'plain_code' }, 'W1 a thrown text is the code');
eq(A.failure(new Error('not_logged_in|with details')), { [KEY]: 'not_logged_in|with details' }, 'W1 the code|details form is kept whole');
for (const [v, name] of [[undefined, 'undefined'], [null, 'null'], [{}, 'an object without a message'], [5, 'a number'], [new Error(''), 'an empty message'], [{ message: 7 }, 'a message that is not text'], [[], 'an array'], [true, 'true']]) {
  eq(A.failure(v), { [KEY]: 'server_error' }, 'W1 ' + name + ' becomes server_error (no "[object Object]" or "undefined" on the screen)');
}
eq(A.failure({ get message() { throw new Error('getter'); } }), { [KEY]: 'server_error' }, 'W1 a message that cannot be read becomes server_error');
eq(A.failure(new Error('x'.repeat(900)))[KEY].length, 500, 'W1 a long message is cut to 500 characters');
eq(Object.keys(A.failure(new Error('a'))), [KEY], 'W1 the answer has exactly one key');

/* ---------- W2: the backend files ---------- */
const MODS = { racedir: D, exposoft: X, training: T, finance: FN, results: RS, print: PR, comms: CM, waivers: WV, reports: RP, privacy: PV, runner: PUB };
const names = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function' && !k.startsWith('__'));
eq(Object.keys(MODS).length, 11, 'W2 all 11 backend files are loaded');
eq(await D.health(), { ok: true }, 'W2 a method that works answers its value, asked either way');
eq(await D.health({}, W), { ok: true }, 'W2 and asked with WIRE');
// asked this way: an answer; not asked: a throw, as before
{
  const asked = await D.login({ username: 'nobody', password: 'x' }, W);
  ok(isAnswer(asked) && asked[KEY] === 'bad_login', 'W2 asked with WIRE a wrong login comes back as a value');
  eq(await err(D.login({ username: 'nobody', password: 'x' })), 'bad_login', 'W2 called with one argument (an older page code, the other suites) it throws as before');
  for (const other of [1, '2', true, {}, null, undefined, 3]) {
    eq(await err(D.login({ username: 'nobody', password: 'x' }, other)), 'bad_login', 'W2 only WIRE itself asks: ' + JSON.stringify(other) + ' still throws');
  }
}
const SHAPES = [undefined, null, {}, { token: 'nope' }, 'text', 42, [], { token: 'a'.repeat(64), ev: 'EV1', id: 'x', username: 'u', password: 'p', key: 'k', arg: {} }, { username: {}, password: [], token: {} }];
let calls = 0;
for (const [id, mod] of Object.entries(MODS)) {
  const rejected = [];
  const bad = [];
  let n = 0;
  for (const name of names(mod)) {
    n++;
    for (const shape of SHAPES) {
      calls++;
      try {
        const r = await mod[name](shape, W);
        if (isAnswer(r) && (Object.keys(r).length !== 1 || !r[KEY] || r[KEY].length > 500)) bad.push(name);
      } catch (e) {
        rejected.push(name + ' <- ' + JSON.stringify(shape) + ': ' + ((e && e.message) || e));
      }
    }
  }
  eq(rejected.slice(0, 3), [], 'W2 ' + id + ': asked with WIRE none of its ' + n + ' methods throws, whatever it is given' + (rejected.length > 3 ? ' (and ' + (rejected.length - 3) + ' more)' : ''));
  eq(bad, [], 'W2 ' + id + ': every failure it answers has one key and a code of at most 500 characters');
}
ok(calls > 1500, 'W2 ' + calls + ' calls made');
// the same refusal reaches the caller either way: as the thrown code, or as the answer with that code
{
  const differ = [];
  let tried = 0;
  for (const [id, mod] of Object.entries(MODS)) {
    for (const name of names(mod)) {
      if (name === 'ensureSetup' || name === 'ensureTrainSetup') continue; // a wrong setup key is counted: the second call is a try later and is told so (checked in the suites for the setup keys)
      for (const shape of [{}, { token: 'nope' }]) {
        tried++;
        const thrown = await err(mod[name](shape));
        const answered = await mod[name](shape, W);
        if (!(thrown !== '' ? isAnswer(answered) && answered[KEY] === thrown : !isAnswer(answered))) differ.push(id + '.' + name + ' ' + JSON.stringify(shape) + ': threw "' + thrown + '", answered ' + JSON.stringify(answered));
      }
    }
  }
  eq(differ, [], 'W2 for every method and two bad calls: the code it throws is the code it answers (' + tried + ' pairs)');
}
resetDb();

// the sign-in, as values
const rowOf = (u) => [...global.__DB.ExpoStaff.values()].find((r) => r.username === u);
const sessionsOf = (u) => [...(global.__DB.ExpoSessions || new Map()).values()].filter((r) => r.username === u);
const wired = (mod) => Object.fromEntries(names(mod).map((n) => [n, (a) => mod[n](a, W)]));
const DW = wired(D);
const TW = wired(T);
await wd.insert('ExpoStaff', { username: 'boss', password: A.hashPassword('pw-boss-1'), role: 'admin', desks: '', race: '', name: 'The Boss', failCount: '0', lockUntil: '' }, SA);
await wd.insert('ExpoStaff', { username: 'old1', password: 'plain-pass', role: 'lead', desks: '', race: '', name: 'Old One', failCount: '0', lockUntil: '' }, SA);
await wd.insert('ExpoStaff', { username: 'coach1', password: A.hashPassword('pw-coach-1'), role: 'coach', desks: '', race: '', name: 'Coach One', failCount: '0', lockUntil: '' }, SA);
eq(await DW.login({ username: 'boss', password: 'nope' }), { [KEY]: 'bad_login' }, 'W2 a wrong password is answered bad_login');
eq(rowOf('boss').failCount, '1', 'W2 and it is counted (the database showed this on the live site while the screen showed Wix\'s text)');
eq(await DW.login({ username: 'nobody', password: 'nope' }), { [KEY]: 'bad_login' }, 'W2 an unknown username is answered the same');
eq(await DW.login({ username: 'boss' }), { [KEY]: 'bad_login' }, 'W2 no password is bad_login');
eq(await DW.login({ username: {}, password: [] }), { [KEY]: 'bad_login' }, 'W2 objects instead of text are bad_login');
eq(await DW.login(), { [KEY]: 'bad_login' }, 'W2 no argument at all is bad_login');
eq(rowOf('boss').failCount, '1', 'W2 none of those counted against boss');
for (let i = 2; i <= 5; i++) eq(await DW.login({ username: 'boss', password: 'nope' }), { [KEY]: i < 5 ? 'bad_login' : 'locked' }, 'W2 wrong password number ' + i + ' is answered ' + (i < 5 ? 'bad_login' : 'locked'));
ok(Date.parse(rowOf('boss').lockUntil) > Date.now(), 'W2 the fifth wrong password locks the login');
eq(await DW.login({ username: 'boss', password: 'pw-boss-1' }), { [KEY]: 'locked' }, 'W2 while it is locked even the right password is answered locked');
eq(sessionsOf('boss').length, 0, 'W2 and no session was made');
await wd.update('ExpoStaff', Object.assign({}, rowOf('boss'), { lockUntil: '', failCount: '0' }), SA);
tenMinutesLater();
{
  const g = await DW.login({ username: 'boss', password: 'pw-boss-1' });
  ok(!isAnswer(g) && typeof g.token === 'string' && g.token.length >= 32 && g.role === 'director', 'W2 after the lock the right password gets in: a token, the role, and no answer of failure');
  eq(sessionsOf('boss').length, 1, 'W2 one session was made');
  const me = await DW.whoami({ token: g.token });
  ok(!isAnswer(me) && me.role === 'director', 'W2 whoami with that token answers its value (not a failure)');
  eq(await DW.whoami({ token: 'nope' }), { [KEY]: 'not_logged_in' }, 'W2 whoami with a bad token is answered not_logged_in');
  eq(await DW.listVolunteers({}), { [KEY]: 'not_logged_in' }, 'W2 a method with no token is answered not_logged_in');
  eq(await DW.logout({ token: g.token }), { ok: true }, 'W2 logout answers ok');
  eq(await DW.whoami({ token: g.token }), { [KEY]: 'not_logged_in' }, 'W2 and the token no longer works');
}
{
  const g = await DW.login({ username: 'old1', password: 'plain-pass' });
  ok(!isAnswer(g) && typeof g.token === 'string', 'W2 a login typed by hand in the CMS still works');
  ok(A.isHashed(rowOf('old1').password), 'W2 and is hashed by that first login');
}
eq(await TW.tLogin({ username: 'coach1', password: 'wrong' }), { [KEY]: 'bad_login' }, 'W2 the coach sign-in answers bad_login as a value too');
ok(typeof (await TW.tLogin({ username: 'coach1', password: 'pw-coach-1' })).token === 'string', 'W2 and lets the right password in');
eq(await TW.tWhoami({ token: 'nope' }), { [KEY]: 'not_logged_in' }, 'W2 the coach whoami with a bad token is answered not_logged_in');
for (const [id, mod, fn] of [['Finance', FN, 'finOverview'], ['Results', RS, 'resOverview'], ['Print', PR, 'prnOverview'], ['Messages', CM, 'cmOverview'], ['Waivers', WV, 'wvOverview'], ['Reports', RP, 'rpList'], ['Privacy', PV, 'pvList'], ['Expo desk', X, 'enter']]) {
  const r = await mod[fn]({}, W);
  ok(isAnswer(r) && r[KEY] === 'not_logged_in', 'W2 ' + id + ': a call with no session is answered not_logged_in (' + JSON.stringify(r) + ')');
}
// an unexpected fault inside a method (a collection that cannot be read): Privacy and Reports answer only the code "server_error" and keep the detail
// in the log. Asked with WIRE that is an answer, not asked it is thrown (the other nine files give back the text they were thrown, so they need no such test)
{
  const gb = await DW.login({ username: 'boss', password: 'pw-boss-1' });
  const day = new Date(Date.now() + 5.5 * 3600000 + 60 * 86400000).toISOString().slice(0, 10);
  const evN = (await D.saveEvent({ token: gb.token, name: 'Wire Run', date: day, venue: 'Beach Road' })).event.id;
  const DOWN = new Set();
  const realQuery = wd.query;
  wd.query = (name, ...rest) => {
    if (DOWN.has(name)) throw new Error('down ' + name + ' secret-detail');
    return realQuery.call(wd, name, ...rest);
  };
  const e1 = console.error;
  const logged = [];
  console.error = (m) => logged.push(String(m));
  try {
    for (const [id, mod, fn, extra, col] of [['Privacy', PV, 'pvList', {}, 'RDAudit'], ['Reports', RP, 'rpRun', { report: 'reg' }, 'RDRegs']]) {
      const arg = Object.assign({ token: gb.token, ev: evN }, extra);
      ok(!isAnswer(await mod[fn](arg, W)), 'W2 ' + id + ': with everything readable ' + fn + ' answers its value');
      DOWN.add(col);
      const thrown = await err(mod[fn](arg));
      const answered = await mod[fn](arg, W);
      DOWN.delete(col);
      eq(thrown, 'server_error', 'W2 ' + id + ': a collection that cannot be read is thrown as "server_error" when not asked with WIRE');
      eq(answered, { [KEY]: 'server_error' }, 'W2 ' + id + ': and answered as { __rdError: "server_error" } when asked with WIRE');
      ok(!/secret-detail|down /.test(thrown + JSON.stringify(answered)), 'W2 ' + id + ': the detail is in neither');
    }
  } finally {
    wd.query = realQuery;
    console.error = e1;
  }
  ok(logged.some((m) => /secret-detail/.test(m)), 'W2 the detail went to the log');
}
resetDb();

/* ---------- W3: the page codes ---------- */
const NAMES = ['rd', 'expo', 'train', 'tr', 'fin', 'res', 'prn', 'comms', 'wv', 'rp', 'pv', 'pub'];
function page(file, frameId, mods) {
  const src = read(file).replace(/^import .*$/gm, '');
  const posts = [];
  let handler, ready;
  const comp = { onMessage: (fn) => { handler = fn; }, postMessage: (m) => posts.push(m) };
  const $w = (sel) => (sel === frameId ? comp : {});
  $w.onReady = (fn) => { ready = fn; };
  new Function('$w', 'wixLocation', ...NAMES, 'console', src)($w, { query: {} }, ...NAMES.map((k) => mods[k] || {}), { error() {}, log() {} });
  ready();
  let n = 0;
  return async (method, extra) => {
    const id = ++n;
    await handler({ data: Object.assign({ kind: 'call', id, method, arg: { a: 1 } }, extra || {}) });
    return posts.find((p) => p.id === id) || null;
  };
}
// Each page code, each module it relays to: [file, frame id, namespace, a method it lists, the tag the screen puts on the call]
const RELAYS = [
  ['wix/director/director-page-code.js', '#dirFrame', 'rd', 'whoami', undefined],
  ['wix/director/director-page-code.js', '#dirFrame', 'expo', 'enter', 'expo'],
  ['wix/director/director-page-code.js', '#dirFrame', 'train', 'listAthletes', 'train'],
  ['wix/director/director-page-code.js', '#dirFrame', 'fin', 'finOverview', 'fin'],
  ['wix/director/director-page-code.js', '#dirFrame', 'res', 'resOverview', 'res'],
  ['wix/director/director-page-code.js', '#dirFrame', 'prn', 'prnOverview', 'prn'],
  ['wix/director/director-page-code.js', '#dirFrame', 'comms', 'cmOverview', 'comms'],
  ['wix/director/director-page-code.js', '#dirFrame', 'wv', 'wvOverview', 'wv'],
  ['wix/director/director-page-code.js', '#dirFrame', 'rp', 'rpList', 'rp'],
  ['wix/director/director-page-code.js', '#dirFrame', 'pv', 'pvList', 'pv'],
  ['wix/director/volunteer-page-code.js', '#volFrame', 'rd', 'openEvents', undefined],
  ['wix/director/runner-page-code.js', '#runFrame', 'pub', 'pubRaces', undefined],
  ['wix/training/athlete-page-code.js', '#trainFrame', 'tr', 'openPlans', undefined],
  ['wix/training/coach-page-code.js', '#coachFrame', 'tr', 'tLogin', undefined],
];
eq(RELAYS.length, 14, 'W3 14 relays are checked (10 in the Director page, 1 in each of the other four)');
for (const [file, frameId, ns, method, mod] of RELAYS) {
  const label = file.replace(/^wix\/\w+\//, '') + ' -> ' + ns + '.' + method;
  const tag = mod ? { mod } : {};
  const seen = [];
  const run = (fn) => page(file, frameId, { [ns]: { [method]: async (a, wire) => { seen.push({ arg: a, wire }); return fn(); } } })(method, tag);
  const a = await run(async () => ({ [KEY]: 'shift_full' }));
  ok(a && a.ok === false && a.error === 'shift_full' && a.result === undefined, 'W3 ' + label + ': an answer { __rdError } reaches the screen as ok:false with the code (' + JSON.stringify(a) + ')');
  eq(seen[0], { arg: { a: 1 }, wire: 2 }, 'W3 ' + label + ': the call passes the screen\'s argument and asks for answers with WIRE (2)');
  const b = await run(async () => ({ rows: [1, 2] }));
  ok(b && b.ok === true && JSON.stringify(b.result) === '{"rows":[1,2]}' && b.error === undefined, 'W3 ' + label + ': a value reaches it as ok:true');
  const c = await run(async () => ({ [KEY]: 5, rows: [] }));
  ok(c && c.ok === true, 'W3 ' + label + ': a value that merely has that key with something else than text is not a failure');
  const d = await run(async () => { throw new Error('boom'); });
  ok(d && d.ok === false && d.error === 'boom', 'W3 ' + label + ': a real throw (Wix refusing to run a file, an older backend file) still reaches it as ok:false with its message');
  const e = await run(async () => { throw 'plain text'; });
  ok(e && e.ok === false && e.error === 'plain text', 'W3 ' + label + ': so does a thrown text');
  for (const v of [undefined, null, 0, '', [], 'text']) {
    const f = await run(async () => v);
    ok(f && f.ok === true && JSON.stringify(f.result) === JSON.stringify(v), 'W3 ' + label + ': ' + JSON.stringify(v) + ' is a value');
  }
  const g = await run(async () => ({ [KEY]: 'a|b details' }));
  ok(g && g.ok === false && g.error === 'a|b details', 'W3 ' + label + ': code|details goes through whole');
}
// the real director page code in front of the real backend
{
  await wd.insert('ExpoStaff', { username: 'boss', password: A.hashPassword('pw-boss-2'), role: 'admin', desks: '', race: '', name: 'The Boss', failCount: '0', lockUntil: '' }, SA);
  const call = page('wix/director/director-page-code.js', '#dirFrame', { rd: D, expo: X, train: T });
  const wrong = await call('login', { arg: { username: 'boss', password: 'nope' } });
  ok(wrong.ok === false && wrong.error === 'bad_login', 'W3 director page + backend: a wrong password reaches the screen as the code bad_login (' + JSON.stringify(wrong) + ')');
  const right = await call('login', { arg: { username: 'boss', password: 'pw-boss-2' } });
  ok(right.ok === true && typeof right.result.token === 'string' && right.result.role === 'director', 'W3 director page + backend: the right one as ok:true with a token');
  const who = await call('whoami', { arg: { token: 'nope' } });
  ok(who.ok === false && who.error === 'not_logged_in', 'W3 director page + backend: a bad token as not_logged_in');
  const exp = await call('enter', { mod: 'expo', arg: { token: 'nope' } });
  ok(exp.ok === false && typeof exp.error === 'string' && exp.error.length > 0, 'W3 the expo desk calls come back as codes too (' + JSON.stringify(exp) + ')');
  const tr = await call('listAthletes', { mod: 'train', arg: { token: 'nope' } });
  ok(tr.ok === false && typeof tr.error === 'string' && tr.error.length > 0, 'W3 and the coaching calls (' + JSON.stringify(tr) + ')');
}
resetDb();

/* ---------- W4: the real sign-in screen, the real page code, the real backend ---------- */
const PC = read('wix/director/director-page-code.js').replace(/^import .*$/gm, '');
let relayHandler;
const waiting = new Map();
let current = { rd: D, expo: X, train: T };
{
  const comp = { onMessage: (fn) => { relayHandler = fn; }, postMessage: (r) => { const w = waiting.get(r.id); if (w) w(r); } };
  const $w = (sel) => (sel === '#dirFrame' ? comp : {});
  let ready;
  $w.onReady = (fn) => { ready = fn; };
  // the page code gets one object per module; reading through `current` lets a test swap what 'rd' does between sign-ins
  const proxy = (k) => new Proxy({}, { get: (t, p) => (current[k] ? current[k][p] : undefined), has: (t, p) => !!current[k] && p in current[k] });
  new Function('$w', 'wixLocation', ...NAMES, 'console', PC)($w, { query: {} }, ...NAMES.map((k) => proxy(k)), { error() {}, log() {} });
  ready();
}
const relay = (m, reply) => {
  waiting.set(m.id, (r) => (r.ok ? reply(m, true, r.result) : reply(m, false, r.error)));
  return relayHandler({ data: Object.assign({ kind: 'call' }, m) });
};
const H = makeHarness({ D, X, T, relay, onJsError: (e) => ok(false, 'a script error in the page: ' + e.message) });
const { set, submit, change, txt } = H;
await wd.insert('ExpoStaff', { username: 'boss', password: A.hashPassword('pw-boss-3'), role: 'admin', desks: '', race: '', name: 'The Boss', failCount: '0', lockUntil: '' }, SA);
const attempt = async (s, user, pw) => {
  set(s.w, s.d.querySelector('#lgUser'), user);
  set(s.w, s.d.querySelector('#lgPass'), pw);
  submit(s.w, s.d.querySelector('#loginForm'));
  await sleep(500);
};
{
  const s = H.open();
  await sleep(80);
  const pass = s.d.querySelector('#lgPass');
  const show = s.d.querySelector('#lgShow');
  ok(!!show && show.type === 'checkbox' && /Show password/.test(txt(show.parentElement)), 'W4 the sign-in form has a "Show password" box');
  ok(pass.type === 'password', 'W4 the password starts hidden');
  set(s.w, pass, 'abc123');
  show.checked = true; change(s.w, show);
  ok(pass.type === 'text' && pass.value === 'abc123', 'W4 ticking the box shows what was typed, and keeps it');
  show.checked = false; change(s.w, show);
  ok(pass.type === 'password' && pass.value === 'abc123', 'W4 unticking hides it again');
  for (const id of ['#lgUser', '#lgPass']) {
    const el = s.d.querySelector(id);
    ok(el.getAttribute('autocapitalize') === 'none' && el.getAttribute('autocorrect') === 'off' && el.getAttribute('spellcheck') === 'false', 'W4 ' + id + ' is not capitalised or corrected by a phone keyboard');
  }
  // a password shown while typing is what is sent
  set(s.w, s.d.querySelector('#lgUser'), 'boss');
  set(s.w, pass, 'pw-boss-3');
  show.checked = true; change(s.w, show);
  submit(s.w, s.d.querySelector('#loginForm'));
  await sleep(500);
  ok(!s.d.querySelector('#loginForm') && !!s.d.querySelector('.tabs'), 'W4 a password typed with the box ticked signs in');
}
resetDb();
await wd.insert('ExpoStaff', { username: 'boss', password: A.hashPassword('pw-boss-3'), role: 'admin', desks: '', race: '', name: 'The Boss', failCount: '0', lockUntil: '' }, SA);
{
  const s = H.open();
  await sleep(80);
  await attempt(s, 'boss', 'wrong-one');
  eq(txt(s.d.querySelector('#lgErr')), 'Wrong username or password.', 'W4 a wrong password: the screen says "Wrong username or password." (not Wix\'s text, not "Something went wrong")');
  eq(txt(s.d.querySelector('#toast')), 'Wrong username or password.', 'W4 and so does the pop-up');
  ok(!!s.d.querySelector('#loginForm') && !s.d.querySelector('.tabs'), 'W4 and the form stays for another try');
  eq(rowOf('boss').failCount, '1', 'W4 the database counted it');
  await attempt(s, 'nobody', 'x');
  eq(txt(s.d.querySelector('#lgErr')), 'Wrong username or password.', 'W4 an unknown username reads the same');
  eq(rowOf('boss').failCount, '1', 'W4 and counts against nobody');
  await attempt(s, 'boss', 'wrong-two');
  await attempt(s, 'boss', 'wrong-three');
  await attempt(s, 'boss', 'wrong-four');
  await attempt(s, 'boss', 'wrong-five');
  eq(txt(s.d.querySelector('#lgErr')), 'Too many wrong tries. Wait 10 minutes.', 'W4 the fifth wrong password: "Too many wrong tries. Wait 10 minutes."');
  await attempt(s, 'boss', 'pw-boss-3');
  eq(txt(s.d.querySelector('#lgErr')), 'Too many wrong tries. Wait 10 minutes.', 'W4 the right password during the lock says the same, and does not get in');
  ok(!s.d.querySelector('.tabs') && sessionsOf('boss').length === 0, 'W4 no session while locked');
  await wd.update('ExpoStaff', Object.assign({}, rowOf('boss'), { lockUntil: '', failCount: '0' }), SA);
  tenMinutesLater();
  await attempt(s, 'boss', 'pw-boss-3');
  ok(!s.d.querySelector('#loginForm') && !!s.d.querySelector('.tabs'), 'W4 after the lock the right password signs in');
  eq(sessionsOf('boss').length, 1, 'W4 and one session exists');
}
{
  // Wix itself refuses to run the backend (a file with a build error, a module that cannot be loaded): its own text arrives as a thrown error
  const WIX = 'Unable to handle the request. Contact the site administrator or view site monitoring logs for more information.';
  current = { rd: { login: async () => { throw new Error(WIX); } }, expo: X, train: T };
  const s = H.open();
  await sleep(80);
  await attempt(s, 'boss', 'pw-boss-3');
  const t = txt(s.d.querySelector('#lgErr'));
  ok(/Wix could not run the backend/.test(t) && /not a wrong password/.test(t) && /build\.log/.test(t), 'W4 Wix\'s own text is explained: Wix could not run the backend, not a wrong password, read build.log (' + t.slice(0, 90) + '...)');
  ok(!/Something went wrong/.test(t) && !/Contact the site administrator/.test(t), 'W4 and the raw Wix text is not shown to the person');
  current = { rd: { login: async () => { throw new Error('Error: ' + WIX); } }, expo: X, train: T };
  await attempt(s, 'boss', 'pw-boss-3');
  ok(/Wix could not run the backend/.test(txt(s.d.querySelector('#lgErr'))), 'W4 the same with the "Error: " in front, as the live site wrote it');
  current = { rd: { login: async () => { throw new Error('something_else'); } }, expo: X, train: T };
  await attempt(s, 'boss', 'pw-boss-3');
  eq(txt(s.d.querySelector('#lgErr')), 'Something went wrong (something_else)', 'W4 any other unknown text is still shown as before');
  current = { rd: D, expo: X, train: T };
}
resetDb();
{
  // an older page code does not pass WIRE: the backend throws as before and the screen says the same words
  await wd.insert('ExpoStaff', { username: 'boss', password: A.hashPassword('pw-boss-3'), role: 'admin', desks: '', race: '', name: 'The Boss', failCount: '0', lockUntil: '' }, SA);
  const old = makeHarness({ D, X, T });
  const s = old.open();
  await sleep(80);
  old.set(s.w, s.d.querySelector('#lgUser'), 'boss');
  old.set(s.w, s.d.querySelector('#lgPass'), 'nope');
  old.submit(s.w, s.d.querySelector('#loginForm'));
  await sleep(500);
  eq(old.txt(s.d.querySelector('#lgErr')), 'Wrong username or password.', 'W4 an older page code (no WIRE) with this backend: the screen still says "Wrong username or password."');
}
resetDb();

/* ---------- W5: the sources ---------- */
const MODFILES = ['wix/director/racedir.web.js', 'wix/director/comms.web.js', 'wix/director/finance.web.js', 'wix/director/print.web.js', 'wix/director/privacy.web.js', 'wix/director/reports.web.js', 'wix/director/results.web.js', 'wix/director/runner.web.js', 'wix/director/waivers.web.js', 'wix/expo/exposoft.web.js', 'wix/training/training.web.js'];
for (const f of MODFILES) {
  const t = read(f);
  const g = t.indexOf('const guarded = (fn) => async (arg, wire) => {');
  const end = t.indexOf('\n};', g);
  const body = t.slice(g, end);
  ok(g > 0, 'W5 ' + f + ': the wrapper takes (arg, wire)');
  ok((body.match(/if \(wire === WIRE\) return failure\(/g) || []).length >= 1 && (body.replace(/wire === WIRE/g, '').match(/\bwire\b/g) || []).length === 1, 'W5 ' + f + ': it answers only when wire is exactly WIRE (the one other mention of wire is the parameter)');
  ok(/\bthrow\b/.test(body), 'W5 ' + f + ': and throws as before when it is not');
  ok(/import \{[^}]*\bfailure\b[^}]*\bWIRE\b[^}]*\} from '\.\/rd-auth\.js';/.test(t), 'W5 ' + f + ': imports failure and WIRE from rd-auth.js');
  ok(!/\bunfail\b/.test(t), 'W5 ' + f + ': nothing in it reads an answer of its own methods (it calls them with one argument, so they throw)');
  // the file's own calls of its own methods pass one argument only
  const exported = [...t.matchAll(/^export const (\w+) = webMethod\(/gm)].map((m) => m[1]);
  const own = [];
  t.split('\n').forEach((ln, i) => {
    for (const n of exported) {
      if (new RegExp('(?<![\\w.$])' + n + '\\s*\\(').test(ln) && !new RegExp('^export const ' + n + ' = webMethod').test(ln) && !/^\s*\/\//.test(ln)) own.push({ n, i: i + 1, ln });
    }
  });
  ok(own.every((c) => !/WIRE/.test(c.ln)), 'W5 ' + f + ': a call of one of its own methods does not ask for an answer (' + own.map((c) => c.n + '@' + c.i).join(', ') + ')');
}
for (const [f, n] of [['wix/director/director-page-code.js', 10], ['wix/director/volunteer-page-code.js', 1], ['wix/director/runner-page-code.js', 1], ['wix/training/athlete-page-code.js', 1], ['wix/training/coach-page-code.js', 1]]) {
  const t = read(f);
  eq((t.match(/^const WIRE = 2;$/gm) || []).length, 1, 'W5 ' + f + ': WIRE is 2, the same as rd-auth.js says');
  eq((t.match(/\[msg\.method\]\(msg\.arg \|\| \{\}, WIRE\)/g) || []).length, n, 'W5 ' + f + ': ' + n + ' relayed call(s) ask for answers');
  eq((t.match(/\[msg\.method\]\(/g) || []).length, n, 'W5 ' + f + ': and every relayed call is one of them');
  eq((t.match(/function answer\(/g) || []).length, 1, 'W5 ' + f + ': one function answers the screen');
  eq((t.match(/answer\(frame, msg\.id, result\);/g) || []).length, n, 'W5 ' + f + ': ' + n + ' relay(s) answer through it');
  // ok:true with a result is posted only inside answer() (the director page code also answers the Expo desk's "ping" with its own pong)
  eq((t.match(/ok: true, result/g) || []).length, f.includes('director-page') ? 2 : 1, 'W5 ' + f + ': ok:true with a result is posted only inside it');
  ok(t.includes("typeof result.__rdError === 'string'"), 'W5 ' + f + ': an answer is told by its key being text');
}
ok(read('wix/director/rd-auth.js').includes('export const WIRE = 2;') && read('wix/director/rd-auth.js').includes(KEY), 'W5 rd-auth.js defines WIRE = 2 and the key');
for (const f of ['wix/director/director-embed.html', 'wix/director/rd-embed.html']) {
  const t = read(f);
  ok(/wix_refused:'Wix could not run the backend/.test(t) && /unable to handle the request/i.test(t), 'W5 ' + f + ' explains Wix\'s own text');
  ok(t.includes('id="lgShow"') && t.includes("t.id==='lgShow'"), 'W5 ' + f + ' has the Show password box and its handler');
}
ok(read('wix/director/rd-embed.html').length > read('wix/director/director-embed.html').length, 'W5 rd-embed.html is the built one (it holds the Expo desk too)');
for (const [f, what] of [
  ['docs/SETUP.md', 'Wix could not run the backend'],
  ['docs/SETUP.md', 'Before Package 6e the same text also appeared for an ordinary wrong password'],
  ['docs/UPGRADE.md', '# Package 6e (the sign-in message)'],
  ['docs/UPGRADE.md', 'put it back after pasting'],
]) ok(read(f).includes(what), 'W5 ' + f + ' says "' + what + '"');

done();
