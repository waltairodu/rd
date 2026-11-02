// COMPONENT + INTEGRATION TESTS (screen): the public /runner page, in jsdom. The real page, the real page code and the real server
// code (runner.web.js on the same database the director screens use) run together; only the browser is pretended.
// A runner looks themselves up by bib or name and sees what the director has switched on: start time and corral, result and places,
// a certificate to print. Nothing shows for a race that is switched off, and switching it off takes effect at once. Also: markup in
// a name stays text, nothing is written, nothing private is ever on the page (date of birth, age, phone, e-mail, payment), a search
// cannot list the race (a bib or three letters, ten at most), a double press asks once, a crafted call for a staff method is
// refused by the page code, an old page code or backend is explained to a runner in plain words, and a late "init" still opens the
// race the link names.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as RS from './results.test.mjs';
import * as PR from './print.test.mjs';
import * as PUB from './runner.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Runner page: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/runner-embed.html', 'utf8');
const pageSrc = fs.readFileSync('../wix/director/runner-page-code.js', 'utf8').replace(/^import .*$/gm, '');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const snap = () => JSON.stringify(Object.keys(DB).sort().map((k) => [k, [...DB[k].entries()]]));
const jserr = [];
const calls = [];
const answers = [];
const printed = [];
const MISSING = new Set(); // names the backend file on the site does not have yet
const FAILPUB = new Map(); // method -> error code, thrown once instead of the real answer
const OLDCODE = { on: false }; // the page code on the site is older than the page
// the clock that the 30-second memory of the server looks at
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const later = () => {
  skew += 31000;
};

/* ---------- the world ---------- */
global.__COLS.add('Import910');
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
let RD = istDay(30);
if (/-01-01$/.test(RD)) RD = istDay(31);
const Y = +RD.slice(0, 4);
const mkRace = async (name, venue, cats) => {
  const e = (await R.saveEvent({ token: OT, name, date: RD, venue })).event.id;
  await R.saveCats({ token: OT, ev: e, cats });
  return e;
};
const TWO = [{ name: '10 K', km: 10, price: 800, cap: 500 }, { name: '21 K', km: 21.0975, price: 1200, cap: 500 }];
const ONE = [{ name: '10 K', km: 10, price: 800, cap: 500 }];
const EV = await mkRace('Run Day A', 'Beach Road', TWO);
const EV2 = await mkRace('Run Day B', 'Hill Top', ONE);
const EV3 = await mkRace('Run Day Hidden', 'Secret Place', ONE);
const EVC = await mkRace('Run Day Big', 'Stadium', ONE);
const FORM = (g, d, a, x) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: a }, { name: 'Expected finish', value: x }]);
const dob = (age) => '01/01/' + (Y - age);
const idOf = (e, bib, n) => 'REG~' + e.slice(-6) + '~' + (bib || 'x' + n);
const reg = (e, bib, name, cat, g, age, status, bibName, n) =>
  wd.insert('RDRegs', { _id: idOf(e, bib, n), event: e, name, cat, bib, bibName: bibName || '', status: status || 'ok', phone: '98123' + String(bib || '0').padStart(5, '0'), email: 'p' + bib + '@example.com', form: FORM(g, dob(age), '', '55:00'), at: new Date().toISOString() }, SA);
const EVIL = '<img src=x onerror="window.__pwn=1">Eve';
const PEOPLE = [
  ['101', 'Asha Rao', '10 K', 'F', 36, 'ASHA'], ['102', 'Bina Rao', '10 K', 'F', 31], ['103', 'Chitra Devi', '10 K', 'F', 26], ['104', 'Dev Raman', '10 K', 'M', 46], ['105', 'Esha Nair', '10 K', 'F', 36],
  ['106', EVIL, '10 K', 'F', 29], ['107', 'Hari Om', '10 K', 'M', 40], ['201', 'Indu Menon', '21 K', 'F', 41], ['202', 'Jai Shah', '21 K', 'M', 51], ['203', 'Kiran Das', '21 K', 'F', 29],
];
for (const p of PEOPLE) await reg(EV, p[0], p[1], p[2], p[3], p[4], 'ok', p[5]);
await reg(EV, '111', 'Unpaid Uma', '10 K', 'F', 30, 'pending');
await reg(EV, '', 'No Bib Nina', '10 K', 'F', 30, 'ok', '', 1);
await reg(EV2, '101', 'Other Race Olga', '10 K', 'F', 33);
await reg(EV3, '101', 'Hidden Hema', '10 K', 'F', 33);
for (let i = 1; i <= 130; i++) await reg(EVC, String(1000 + i), 'Runner ' + i, '10 K', i % 2 ? 'F' : 'M', 30 + (i % 20));
const SET = { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: 'Gender', dob: 'Date of birth', age: 'Age', seed: 'Expected finish' } };
for (const e of [EV, EV2, EVC]) await RS.resSaveSettings({ token: OT, ev: e, settings: SET });
await RS.resSaveWaves({ token: OT, ev: EV, rev: 0, waves: [{ cat: '10 K', name: 'Wave 1', start: '06:00', corrals: 'A, B', cap: 0 }, { cat: '21 K', name: 'Elite', start: '05:30', corrals: '', cap: 0 }] });
await RS.resAssign({ token: OT, ev: EV, mode: 'bib', key: 'runner-ui-key-1' });
await RS.resSaveWaves({ token: OT, ev: EV2, rev: 0, waves: [{ cat: '10 K', name: 'Hill wave', start: '07:15', corrals: '', cap: 0 }] });
await RS.resAssign({ token: OT, ev: EV2, mode: 'bib', key: 'runner-ui-key-2' });
const CSV = ['bib,chip,status,name,category,gender,age', '101,55:10,,,,,', '102,56:20,,,,,', '103,57:30,,,,,', '104,50:00,,,,,', '105,58:00,,,,,', '106,45:00,,,,,', '107,,DNF,,,,', '201,1:50:00,,,,,', '202,1:40:00,,,,,', '203,,DNS,,,,', '999,59:30,,Walk In Wanda,10 K,F,40'].join('\n');
await RS.resImport({ token: OT, ev: EV, text: CSV, key: 'runner-ui-key-3' });
const BIG = ['bib,chip'].concat(Array.from({ length: 60 }, (x, i) => String(1001 + i) + ',' + Math.floor((2400 + i * 13) / 60) + ':' + String((2400 + i * 13) % 60).padStart(2, '0'))).join('\n');
await RS.resImport({ token: OT, ev: EVC, text: BIG, key: 'runner-ui-key-4' });
await PR.prnSaveTemplate({ token: OT, ev: EV, kind: 'cert', tpl: { title: 'Well Run', sign1Name: 'Yogi', sign1Role: 'Race Director' } });
const pub = (e, o) => PR.prnSavePublish({ token: OT, ev: e, pub: Object.assign({ startList: false, results: false, certs: false, note: '' }, o) });
await pub(EV, { startList: true, results: true, certs: true, note: 'Times are provisional' });
await pub(EV2, { startList: true });
await pub(EVC, { startList: false, results: true });
// EV3 stays off
const PII = /98123\d{5}|@example\.com|01\/01\/(19\d\d|20[01]\d)|(19\d\d|20[01]\d)-01-01|p\d{3,4}@|"dob"|"phone"|"email"|"age"|"tshirt"|"paid"|"status":"ok"/;

/* ---------- a page, the way a browser would run it ---------- */
const pubApi = {};
for (const k of ['pubRaces', 'pubFind', 'pubCert']) {
  const fn = async (a) => {
    if (FAILPUB.has(k)) {
      const c = FAILPUB.get(k);
      FAILPUB.delete(k);
      throw new Error(c);
    }
    const r = await PUB[k](a);
    answers.push({ method: k, out: JSON.parse(JSON.stringify(r)) });
    return r;
  };
  Object.defineProperty(pubApi, k, { enumerable: true, get: () => (MISSING.has(k) ? undefined : fn) });
}
function openRunner(ev, o) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/runner' + (ev ? '?ev=' + ev : '') });
  const w = dom.window;
  const d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      return { document: { open() {}, write(h) { printed.push(h); }, close() {} }, focus() {}, print() { printed.push('PRINT'); } };
    },
  });
  const P = { w, d, calls: [], posts: [], heights: [] };
  // the page code of the site: the real file, with the Wix names given to it
  let handler = null;
  let ready = null;
  const frame = {
    onMessage: (fn) => {
      handler = fn;
    },
    postMessage: (m) => {
      P.posts.push(m);
      w.postMessage(m, '*');
    },
    set height(v) {
      P.heights.push(v);
    },
  };
  const $w = (sel) => (sel === '#runFrame' ? frame : {});
  $w.onReady = (fn) => {
    ready = fn;
  };
  new Function('$w', 'wixLocation', 'pub', 'console', pageSrc)($w, { query: ev ? { ev } : {} }, pubApi, console);
  ready();
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || (m.kind !== 'call' && m.kind !== 'hello' && m.kind !== 'resize')) return;
    if (m.kind === 'call') {
      const rec = { method: m.method, arg: m.arg, id: m.id };
      calls.push(rec);
      P.calls.push(rec);
    }
    if (o && o.lateInit && m.kind === 'hello') {
      await sleep(o.lateInit);
    }
    if (OLDCODE.on && m.kind === 'call') {
      frame.postMessage({ kind: 'result', id: m.id, ok: false, error: 'page_code_old' });
      return;
    }
    await handler({ data: m });
  });
  return P;
}
const q = (d, s) => d.querySelector(s);
const qa = (d, s) => [...d.querySelectorAll(s)];
const txt = (el) => {
  if (!el) return '';
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) out.push(n.nodeValue);
    else {
      for (const c of n.childNodes) walk(c);
      out.push(' ');
    }
  };
  walk(el);
  return out.join('').replace(/\s+/g, ' ').trim();
};
const until = async (fn, ms) => {
  const t = Date.now();
  while (Date.now() - t < (ms || 3000)) {
    try {
      if (fn()) return true;
    } catch (x) {
      // not there yet
    }
    await sleep(15);
  }
  return false;
};
const find = (P, ms) => P.calls.filter((c) => c.method === 'pubFind').length;
const typeQ = (P, v) => {
  const i = q(P.d, '#q');
  i.value = v;
  i.dispatchEvent(new P.w.Event('input', { bubbles: true }));
};
const press = (P) => q(P.d, '#findForm').dispatchEvent(new P.w.Event('submit', { cancelable: true, bubbles: true }));
// types a question, presses "Find me" and waits for the answer to be drawn
const search = async (P, v) => {
  const n = find(P);
  typeQ(P, v);
  press(P);
  await until(() => find(P) > n || /Please type your bib number/.test(txt(q(P.d, '#results'))));
  await until(() => !q(P.d, '#go').disabled);
  await sleep(30);
  return txt(q(P.d, '#results'));
};
const opened = async (P) => {
  await until(() => q(P.d, '#findForm'));
  await sleep(30);
};
const arts = (P) => qa(P.d, '#results article');
const bibsShown = (P) => arts(P).map((a) => txt(q(a, '.bibno')));
const art = (P, bib) => arts(P).find((a) => txt(q(a, '.bibno')) === bib);

/* ---------- V1. opening the page ---------- */
const board = await RS.resBoard({ token: OT, ev: EV });
const ordT = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const brow = (bib) => board.rows.find((x) => x.bib === bib);
const A = openRunner(EV);
await opened(A);
{
  const { d } = A;
  eq(A.posts[0], { kind: 'init', ev: EV }, 'V1 the page code answers "hello" with the race named in the link');
  eq(txt(q(d, 'h1')), 'Run Day A', 'V1 the race is the heading');
  ok(/Beach Road/.test(txt(q(d, '.wrap'))) && new RegExp(String(Y)).test(txt(q(d, '.wrap'))), 'V1 with its date and place');
  ok(txt(q(d, '.note')) === 'Times are provisional', 'V1 the director\'s note is at the top');
  ok(/See your start time and your result\./.test(txt(q(d, '#hint'))) && /at least three letters/.test(txt(q(d, '#hint'))), 'V1 the hint says what can be seen and what to type');
  eq(arts(A).length, 0, 'V1 before a search no runner is shown');
  ok(!!q(d, 'label.f #q') && q(d, '#q').getAttribute('maxlength') === '60' && q(d, '#results').getAttribute('aria-live') === 'polite', 'V1 the field has a label, 60 letters at most, and the answers are announced to a screen reader');
  eq(A.calls.map((c) => c.method), ['pubFind'], 'V1 the page asked once, for the race, with an empty question');
  eq(A.calls[0].arg, { ev: EV, q: '' }, 'V1 and nobody was named');
  ok(!q(d, 'input[type=password]') && !q(d, '#lgUser'), 'V1 there is no login on this page');
}

/* ---------- V2. a bib ---------- */
{
  const { d } = A;
  const before = snap();
  await search(A, '104');
  eq(bibsShown(A), ['104'], 'V2 a bib finds that runner');
  const a = art(A, '104');
  const asg = rows('RDWaveAssign').find((x) => x.regId === 'REG~' + EV.slice(-6) + '~104');
  ok(/Dev Raman/.test(txt(a)) && /10 K/.test(txt(a)), 'V2 with the name and category');
  ok(new RegExp('Start 06:00 · Wave 1' + (asg && asg.corral ? ' · Corral ' + asg.corral : '')).test(txt(a)), 'V2 the start time, the wave and the corral the director gave: ' + txt(a).slice(0, 120));
  ok(/0:50:00/.test(txt(q(a, '.time'))), 'V2 the finish time is the biggest thing');
  const cells = qa(a, '.cell').map(txt);
  const r104 = brow('104');
  eq(cells, [ordT(r104.place) + ' in category', ordT(r104.gplace) + ' Men', ordT(r104.aplace) + ' 40-49 age group'], 'V2 and the places, as the results board has them: in the category (' + r104.place + '), among men (' + r104.gplace + '), in the age group (' + r104.aplace + ')');
  ok(!!q(a, '[data-cert]') && /Your certificate/.test(txt(q(a, '[data-cert]'))), 'V2 a finisher is offered a certificate');
  ok(!/Unpaid|Nina|98123|@example/.test(txt(q(d, '.wrap'))), 'V2 nothing private is on the page');
  ok(snap() === before, 'V2 asking changed nothing in the database');
  await search(A, '0104');
  eq(bibsShown(A), ['104'], 'V2 a bib typed with a zero in front finds the same runner');
  await search(A, '  104  ');
  eq(bibsShown(A), ['104'], 'V2 and spaces around it do not matter');
  eq(A.calls.filter((c) => c.method === 'pubFind').pop().arg, { ev: EV, q: '104' }, 'V2 and the server is asked with the spaces taken off');
}

/* ---------- V3. a name ---------- */
{
  const { d } = A;
  await search(A, 'rao');
  eq(bibsShown(A), ['101', '102'], 'V3 three letters of a name find the runners, in any case');
  await search(A, 'SHA r');
  eq(bibsShown(A), ['101'], 'V3 and a space between words does not stop the search');
  let t = await search(A, 'ra');
  ok(/Please type at least three letters of your name, or your bib number/.test(t) && !arts(A).length, 'V3 two letters is not a search: ' + t);
  t = await search(A, '9999');
  ok(/Nobody with that bib number is shown here/.test(t), 'V3 a bib that is not there: ' + t);
  t = await search(A, 'zzzz');
  ok(/Nobody found for “zzzz”/.test(t), 'V3 a name that is not there: ' + t);
  for (const x of ['unpaid', 'nina', '111', 'hidden', 'olga']) {
    t = await search(A, x);
    ok(!arts(A).length, 'V3 not found here: "' + x + '" (unpaid, no bib yet, or in another race)');
  }
  const n0 = find(A);
  t = await search(A, '');
  ok(/Please type your bib number, or at least three letters of your name/.test(t) && find(A) === n0, 'V3 an empty question is explained without asking the server again');
  await search(A, '   ');
  ok(find(A) === n0 && /Please type your bib number/.test(txt(q(d, '#results'))), 'V3 spaces only: the same');
  t = await search(A, '99');
  ok(/Nobody with that bib number is shown here/.test(t), 'V3 a short bib that is not there says so too: ' + t);
  // markup in a name
  await search(A, 'eve');
  eq(bibsShown(A), ['106'], 'V3 a name that holds markup is found');
  ok(txt(q(art(A, '106'), 'h2')) === EVIL, 'V3 and shown exactly as typed, as text');
  ok(qa(d, 'img[src="x"]').length === 0 && A.w.__pwn === undefined && !/<img src=x/.test(q(d, '#results').innerHTML), 'V3 nothing was run and no picture was made from it');
  // ten at most
  const B = openRunner(EVC);
  await opened(B);
  const t2 = await search(B, 'runner');
  eq([bibsShown(B).length, /These are the first ten/.test(t2)], [10, true], 'V3 130 runners match "runner": ten are shown, with a line saying so');
  eq(find(B), 2, 'V3 and the server was asked once for it');
  await search(B, 'runner 12');
  eq(bibsShown(B), ['1012'], 'V3 more of the name narrows it down to one');
}

/* ---------- V4. what a runner who did not finish sees ---------- */
{
  await search(A, 'hari');
  const a = art(A, '107');
  ok(!!a && /Did not finish/.test(txt(a)) && !q(a, '.time') && !q(a, '[data-cert]'), 'V4 a DNF shows "Did not finish", no time and no certificate');
  ok(/Start 06:00 · Wave 1/.test(txt(a)), 'V4 and still shows the start they had');
  await search(A, 'kiran');
  const b = art(A, '203');
  ok(!!b && /Did not start/.test(txt(b)) && !q(b, '[data-cert]') && /Start 05:30 · Elite/.test(txt(b)) && !/Corral/.test(txt(b)), 'V4 a DNS shows "Did not start" and the Elite wave, which has no corrals');
  await search(A, 'wanda');
  const c = art(A, '999');
  ok(!!c && /0:59:30/.test(txt(c)) && !/start time has not been announced/.test(txt(c)) && !/Start /.test(txt(q(c, '.start') || c)), 'V4 a walk-in who finished has a result and no start line: ' + txt(c).slice(0, 100));
}

/* ---------- V5. a certificate ---------- */
{
  const { d, w } = A;
  await search(A, 'asha');
  const btn = q(art(A, '101'), '[data-cert]');
  const n = A.calls.filter((c) => c.method === 'pubCert').length;
  const nd = printed.length;
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => q(d, '#certCard'));
  await sleep(40);
  eq(A.calls.filter((c) => c.method === 'pubCert').length, n + 1, 'V5 pressing "Your certificate" asks for it once');
  eq(A.calls.filter((c) => c.method === 'pubCert').pop().arg, { ev: EV, bib: '101' }, 'V5 by race and bib, and nothing else');
  const fr = q(d, '#certFr');
  ok(!!fr && fr.hasAttribute('sandbox') && fr.getAttribute('sandbox') === '', 'V5 it is drawn in a frame that is allowed to do nothing');
  const sd = fr.getAttribute('srcdoc');
  ok(/^<!DOCTYPE html>/.test(sd) && /<\/html>$/.test(sd) && /Well Run/.test(sd) && /Asha Rao/.test(sd) && /0:55:10/.test(sd) && sd.includes(ordT(brow('101').place)) && /Yogi/.test(sd) && /Race Director/.test(sd), 'V5 a whole certificate with the director\'s design, her name, time and place (' + ordT(brow('101').place) + ')');
  ok(!/<script|javascript:|onerror=/i.test(sd) && !PII.test(sd), 'V5 no script, and nothing private in it');
  ok(/Certificate for Asha Rao/.test(txt(q(d, '#certCard h2'))) && /width:\d+px/.test(fr.getAttribute('style')) && /scale\(/.test(fr.getAttribute('style')), 'V5 shrunk to fit the screen');
  w.document.querySelector('[data-act="print"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(300);
  ok(printed.length === nd + 2 && printed[printed.length - 2] === sd && printed[printed.length - 1] === 'PRINT', 'V5 "Print or save as PDF" prints exactly that page');
  w.document.querySelector('[data-act="close"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  ok(!q(d, '#certCard') && arts(A).length === 1, 'V5 "Close" puts it away and keeps the search');
  // the markup name has a certificate: as text
  await search(A, 'eve');
  q(art(A, '106'), '[data-cert]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => q(d, '#certFr'));
  const s2 = q(d, '#certFr').getAttribute('srcdoc');
  ok(/&lt;img src=x onerror/.test(s2) && !/<img src=x/.test(s2) && w.__pwn === undefined, 'V5 the certificate of a name with markup shows it as text');
  eq(txt(q(d, '#certCard h2')), 'Certificate for ' + EVIL, 'V5 and so does its heading on the page');
  // searching again drops the certificate
  await search(A, '104');
  ok(!q(d, '#certCard'), 'V5 a new search clears the certificate');
}

/* ---------- V6. only what the director switched on ---------- */
{
  // start list only
  const B = openRunner(EV2);
  await opened(B);
  ok(!q(B.d, '.note') && /See your start time\./.test(txt(q(B.d, '#hint'))) && !/result/i.test(txt(q(B.d, '#hint'))), 'V6 a race with only the start list says so, and has no note');
  await search(B, 'olga');
  const a = art(B, '101');
  ok(/Start 07:15 · Hill wave/.test(txt(a)) && !q(a, '.time') && !q(a, '.cell') && !q(a, '[data-cert]'), 'V6 it shows the start and no result');
  ok(!/Results can take up to 30 seconds/.test(txt(q(B.d, '.wrap'))), 'V6 and does not talk about results');
  // results only
  const C = openRunner(EVC);
  await opened(C);
  ok(/See your result\./.test(txt(q(C.d, '#hint'))) && /Results can take up to 30 seconds/.test(txt(q(C.d, '.wrap'))), 'V6 a race with only results says so, and that a correction can take 30 seconds');
  await search(C, '1001');
  const b = art(C, '1001');
  ok(!!q(b, '.time') && !/Start /.test(txt(b)) && !q(b, '[data-cert]'), 'V6 it shows the result and no start, and no certificate (that switch is off)');
  await search(C, '1100');
  ok(!arts(C).length, 'V6 a runner with no result is not listed when only results are shown');
  // turning a switch off takes effect at once
  await pub(EV, { startList: true, results: false, certs: false, note: 'Start list only now' });
  await search(A, '104');
  ok(arts(A).length === 1 && !q(art(A, '104'), '.time') && /Start 06:00/.test(txt(art(A, '104'))), 'V6 the director turns results off: the next search shows no result, at once');
  ok(txt(q(A.d, '.note')) === 'Start list only now' && /See your start time\./.test(txt(q(A.d, '#hint'))) && !/result/i.test(txt(q(A.d, '#hint'))) && !/up to 30 seconds/.test(txt(q(A.d, '.wrap'))), 'V6 and the note, the hint and the foot of the page follow the switches as they are now');
  await pub(EV, { startList: true, results: true, certs: true, note: '' });
  later();
  await search(A, 'asha');
  q(art(A, '101'), '[data-cert]').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => q(A.d, '#certFr'));
  ok(!!q(A.d, '#certFr'), 'V6 switched on again, the certificate opens');
  await pub(EV, { startList: true, results: true, certs: false, note: '' });
  q(A.d, '[data-act="close"]').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  q(art(A, '101'), '[data-cert]').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => /There is no certificate for that bib|not showing anything/.test(txt(q(A.d, '#certBox'))) || q(A.d, '#certBox .err'));
  ok(/not showing anything|no certificate/.test(txt(q(A.d, '#certBox'))) && !q(A.d, '#certFr'), 'V6 certificates switched off while the page is open: the next press gets no certificate, and an explanation: ' + txt(q(A.d, '#certBox')).slice(0, 80));
  await pub(EV, { startList: true, results: true, certs: true, note: 'Times are provisional' });
  later();
  // everything off while the page is open
  await pub(EV2, {});
  await search(B, 'olga');
  ok(/That race is not showing anything on this page/.test(txt(q(B.d, '#results'))) && !arts(B).length, 'V6 every switch off: the next search says the race is not showing anything, at once');
  await pub(EV2, { startList: true });
}

/* ---------- V7. choosing a race ---------- */
{
  const P = openRunner('');
  await until(() => qa(P.d, '[data-ev]').length > 0);
  const names = qa(P.d, '[data-ev]').map((b) => txt(b).replace(/ · .*$/, ''));
  eq(names.sort(), ['Run Day A', 'Run Day B', 'Run Day Big'], 'V7 with no race in the link the page lists the races that show something (and not the hidden one)');
  ok(txt(q(P.d, 'h1')) === 'Find your bib and result' && !q(P.d, '#findForm'), 'V7 and offers no search until one is chosen');
  eq(P.calls.map((c) => c.method), ['pubRaces'], 'V7 it asked only for the list');
  qa(P.d, '[data-ev]').find((b) => /Run Day B/.test(txt(b))).dispatchEvent(new P.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => q(P.d, '#findForm'));
  eq(txt(q(P.d, 'h1')), 'Run Day B', 'V7 choosing one opens it');
  eq(P.calls.map((c) => c.method), ['pubRaces', 'pubFind'], 'V7 with one more request');
  await search(P, 'olga');
  ok(bibsShown(P).join() === '101', 'V7 and the search works');
  // a link to a race that shows nothing
  const H = openRunner(EV3);
  await until(() => /not showing anything/.test(txt(q(H.d, '.wrap'))));
  ok(/That race is not showing anything on this page/.test(txt(q(H.d, '.wrap'))) && !/Hidden Hema|Secret Place|Run Day Hidden/.test(H.d.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '')), 'V7 a link to a race that is switched off says so, and says nothing about the race');
  ok(qa(H.d, '[data-ev]').length === 3 && !q(H.d, '#findForm'), 'V7 and lists the three races that do show something');
  const N = openRunner('nope');
  await until(() => /not showing anything/.test(txt(q(N.d, '.wrap'))));
  ok(/That race is not showing anything on this page/.test(txt(q(N.d, '.wrap'))) && qa(N.d, '[data-ev]').length === 3, 'V7 a link to a race that does not exist is answered the same way');
}

/* ---------- V8. the page code, and what it refuses ---------- */
{
  const { w } = A;
  const before = snap();
  // what the page has asked for so far (measured before the crafted calls below, which are not the page's own)
  const used = [...new Set(calls.map((c) => c.method))].sort();
  const tokenSent = calls.some((c) => c.arg && 'token' in c.arg);
  const n = A.posts.length;
  const crafted = [['prnBibs', { token: OT, ev: EV }], ['prnOverview', { token: OT, ev: EV }], ['login', { username: 'owner', password: 'Owner-Pass-2026' }], ['listRegs', { token: OT, ev: EV }], ['resBoard', { token: OT, ev: EV }], ['constructor', {}], ['__proto__', {}], ['toString', {}], ['pubFind ', { ev: EV, q: 'asha' }], ['PUBFIND', { ev: EV, q: 'asha' }]];
  crafted.forEach(([method, arg], i) => w.postMessage({ kind: 'call', id: 9000 + i, method, arg }, '*'));
  await sleep(300);
  const rep = A.posts.slice(n).filter((p) => p.kind === 'result' && p.id >= 9000);
  ok(rep.length === 10 && rep.every((p) => p.ok === false && p.error === 'page_code_old'), 'V8 a staff method, a login, or a name that is not one of the three is answered "page_code_old", never run (' + rep.length + ' answers)');
  eq(snap(), before, 'V8 and nothing changed');
  for (const m of [null, undefined, 5, 'x', [], { kind: 'call' }, { kind: 'call', id: 1, method: ['pubFind'] }, { kind: 'call', id: 2, method: { toString: () => 'pubFind' } }]) {
    w.postMessage(m, '*');
  }
  await sleep(150);
  ok(A.posts.slice(n).filter((p) => p.kind === 'result' && p.ok === true).length === 0, 'V8 messages that are not calls (nothing, numbers, text, a method given as a list or an object) run nothing');
  // the page asks only for the three
  eq(used, ['pubCert', 'pubFind', 'pubRaces'], 'V8 across the run the page asked for exactly the three public methods');
  ok(!tokenSent, 'V8 and never sent a login token');
  // resize
  w.postMessage({ kind: 'resize', height: 1234.4 }, '*');
  w.postMessage({ kind: 'resize', height: 'abc' }, '*');
  w.postMessage({ kind: 'resize', height: 99999 }, '*');
  await sleep(100);
  ok(A.heights.includes(1234) && A.heights.includes(20000) && !A.heights.some((h) => !(h >= 300 && h <= 20000)), 'V8 the page code sizes the frame to what the page reports, between 300 and 20000, and ignores nonsense');
}

/* ---------- V9. when something is wrong ---------- */
{
  // an old page code
  const P = openRunner(EV);
  await opened(P);
  OLDCODE.on = true;
  const t = await search(P, 'asha');
  OLDCODE.on = false;
  ok(/This page is being updated\. Please try again in a few minutes/.test(t) && !/page_code_old|Paste/.test(t), 'V9 an old page code is explained to a runner in plain words, with no instructions for staff: ' + t);
  const tn = await search(P, 'asha');
  ok(bibsShown(P).join() === '101', 'V9 after the old page code, the next search works: ' + tn.slice(0, 100));
  // an old backend file
  MISSING.add('pubCert');
  q(art(P, '101'), '[data-cert]').dispatchEvent(new P.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => /being updated/.test(txt(q(P.d, '#certBox'))));
  MISSING.delete('pubCert');
  ok(/This page is being updated/.test(txt(q(P.d, '#certBox'))) && !q(P.d, '#certFr'), 'V9 an old backend file is explained the same way');
  q(art(P, '101'), '[data-cert]').dispatchEvent(new P.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => q(P.d, '#certFr'));
  ok(!!q(P.d, '#certFr'), 'V9 and the certificate opens once the file is there');
  // a server error
  FAILPUB.set('pubFind', 'server_error');
  const t3 = await search(P, 'raman');
  ok(/Something went wrong\. Please try again in a moment\./.test(t3) && !/server_error/.test(t3), 'V9 a server error is explained in plain words, without its code: ' + t3);
  const tm = await search(P, 'raman');
  ok(bibsShown(P).join() === '104', 'V9 after a server error, the next search works: ' + bibsShown(P).join() + ' / ' + tm.slice(0, 100));
  // a double press asks once
  const n = find(P);
  typeQ(P, 'bina');
  press(P);
  press(P);
  await until(() => find(P) > n);
  await sleep(250);
  eq(find(P) - n, 1, 'V9 pressing "Find me" twice at once asks the server once');
  ok(!q(P.d, '#go').disabled && bibsShown(P).join() === '102', 'V9 and the button is back afterwards');
}
{
  // "init" arrives after the page has already given up waiting and listed the races
  const P = openRunner(EV2, { lateInit: 1500 });
  await until(() => qa(P.d, '[data-ev]').length > 0, 2500);
  ok(qa(P.d, '[data-ev]').length > 0, 'V9 control: after 1.2 seconds without an answer the page lists the races');
  await until(() => q(P.d, '#findForm'), 3000);
  ok(!!q(P.d, '#findForm') && txt(q(P.d, 'h1')) === 'Run Day B', 'V9 when the answer from the page code comes late, the race in the link is opened after all');
}
{
  // nothing shows at all
  const keep = [[EV, { startList: true, results: true, certs: true, note: 'Times are provisional' }], [EV2, { startList: true }], [EVC, { results: true }]];
  for (const [e] of keep) await pub(e, {});
  later();
  const P = openRunner('');
  await until(() => /No race is showing anything here at the moment/.test(txt(q(P.d, '.wrap'))));
  ok(/No race is showing anything here at the moment/.test(txt(q(P.d, '.wrap'))) && !qa(P.d, '[data-ev]').length && !q(P.d, '#findForm'), 'V9 with every race switched off the page says so and shows no race');
  const one = openRunner(EV2);
  await until(() => /not showing anything/.test(txt(q(one.d, '.wrap'))));
  ok(/That race is not showing anything/.test(txt(q(one.d, '.wrap'))), 'V9 and a link to any of them says the same');
  await pub(EV2, { startList: true });
  later();
  const solo = openRunner('');
  await until(() => q(solo.d, '#findForm'));
  eq(txt(q(solo.d, 'h1')), 'Run Day B', 'V9 when exactly one race shows, the page opens on it without asking');
  for (const [e, f] of keep) await pub(e, f);
}

/* ---------- V10. the whole run ---------- */
{
  ok(!answers.some((a) => PII.test(JSON.stringify(a.out))), 'V10 across the whole run, none of the ' + answers.length + ' answers held a phone number, e-mail address, date of birth, age, payment status or the like');
  const fields = new Set();
  answers.filter((a) => a.method === 'pubFind').forEach((a) => (a.out.items || []).forEach((it) => Object.keys(it).forEach((k) => fields.add(k))));
  eq([...fields].sort(), ['bib', 'cat', 'cert', 'name', 'result', 'start'], 'V10 a runner is described by these six things and nothing else');
  const pubkeys = new Set();
  answers.filter((a) => a.method === 'pubFind').forEach((a) => (a.out.items || []).forEach((it) => it.result && Object.keys(it.result).forEach((k) => pubkeys.add(k))));
  eq([...pubkeys].sort(), ['ageGroup', 'aplace', 'gender', 'gplace', 'place', 'status', 'time'], 'V10 and a result by these');
  ok(!answers.some((a) => a.method === 'pubCert' && /<script|javascript:/i.test(a.out.html)), 'V10 no certificate had a script in it');
  eq(jserr, [], 'V10 no script error was raised on any page');
}
done();
