// COMPONENT + INTEGRATION TESTS (screen): the Waves & results tab of the Director page, in jsdom, on the real backend code.
// A director sets the rules, builds the waves, places the runners, moves one by hand, imports the timing file, corrects and
// voids a result, reads the awards and takes CSV and print-outs. A lead can only look. A viewer has no such tab.
// Everything goes through the buttons and forms a person would use. Also: markup in a name stays text, spreadsheets cannot run
// a formula from an exported cell, a date of birth is never on the screen, in a file or in a print-out, a double click makes one
// import, a retry after an error reuses its key, an old page code or a lost session is explained, and logging out clears it.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as RS from './results.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Results: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const jserr = [];
const calls = [];
const answers = [];
const FAIL = new Map(); // method -> error code, given once instead of the real answer
const OLD = { res: false }; // the page code on the site does not know the Results calls yet

/* ---------- the world ---------- */
global.__COLS.add('Import910');
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
const RD = istDay(30);
const Y = +RD.slice(0, 4);
const ev = (await R.saveEvent({ token: OT, name: 'VHM Results Edition', date: RD, venue: 'RK Beach' })).event;
const ev2 = (await R.saveEvent({ token: OT, name: 'Ultribe Paderu', date: istDay(60), venue: 'Paderu' })).event;
const EV = ev.id;
const EV2 = ev2.id;
await R.saveCats({ token: OT, ev: EV, cats: [{ name: '10 K', km: 10, price: 800, cap: 500 }, { name: '21 K', km: 21.0975, price: 1200, cap: 500 }] });
await R.saveCats({ token: OT, ev: EV2, cats: [{ name: '10 K', km: 10, price: 800, cap: 500 }] });
const FORM = (g, d, a, e) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: a }, { name: 'Expected finish', value: e }]);
const dob = (age) => '01/01/' + (Y - age);
const idOf = (e, bib) => 'REG~' + e.slice(-6) + '~' + bib;
const reg = (e, bib, name, cat, g, d, a, x, status) =>
  wd.insert('RDRegs', { _id: idOf(e, bib), event: e, name, cat, bib, status: status || 'ok', phone: '98123' + bib.padStart(5, '0'), email: 'p' + bib + '@example.com', form: FORM(g, d, a, x), at: new Date().toISOString() }, SA);
const EVIL1 = '<img src=x onerror="window.__pwn=1">Eve';
const EVIL2 = '=HYPERLINK("http://evil","click")';
const EVIL3 = 'Zed & "Sons" <b>bold</b>';
const EVIL4 = '@cmd|calc';
const PEOPLE = [
  ['101', 'Asha', '10 K', 'Female', dob(36), '', '55:00'], ['102', 'Bina', '10 K', 'F', dob(31), '', '56:00'], ['103', 'Chitra', '10 K', 'F', dob(26), '', '57:00'],
  ['104', 'Dev', '10 K', 'M', dob(46), '', '50:00'], ['105', 'Esha', '10 K', 'F', dob(36), '', '55:00'], ['106', 'Farid', '10 K', 'M', '', '17', ''],
  ['107', 'Hari', '10 K', '', '', '', ''],
  ['201', 'Indu', '21 K', 'F', dob(41), '', '1:50:00'], ['202', 'Jai', '21 K', 'M', dob(51), '', ''], ['203', 'Kiran', '21 K', 'F', dob(29), '', ''],
  ['301', EVIL1, '10 K', 'F', dob(28), '', '48:00'], ['302', EVIL2, '10 K', 'M', dob(33), '', ''], ['303', EVIL3, '21 K', 'M', dob(44), '', ''], ['304', EVIL4, '10 K', 'M', dob(29), '', ''],
];
for (const p of PEOPLE) await reg(EV, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
await reg(EV, '111', 'Unpaid Uma', '10 K', 'F', dob(30), '', '', 'pending');
await reg(EV2, '101', 'Other Race Olga', '10 K', 'F', dob(33), '', '54:00');
// what must never reach a screen, a file or a print-out
const PII = /98123\d{5}|@example\.com|01\/01\/(19|20)\d\d|(19|20)\d\d-01-01/;

/* ---------- a page, the way a browser would run it ---------- */
const blobs = [];
const downloads = [];
const printed = [];
function openPage() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const d = w.document;
  // the race the page opens on (the list is in id order, which is not the order the races were made in)
  try {
    w.localStorage.setItem('rd.ev', EV);
  } catch (x) {
    // no storage: the page opens on the first race
  }
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = (b) => {
    blobs.push(b);
    return 'blob:test';
  };
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  Object.defineProperty(w.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      return { document: { open() {}, write(h) { printed.push(h); }, close() {} }, focus() {}, print() { printed.push('PRINT'); } };
    },
  });
  const P = { w, d, calls: [] };
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    const rec = { method: m.method, mod: m.mod || 'rd', arg: m.arg };
    calls.push(rec);
    P.calls.push(rec);
    const reply = (o) => w.postMessage(Object.assign({ kind: 'result', id: m.id }, o), '*');
    if (m.mod === 'res' && OLD.res) return reply({ ok: false, error: 'page_code_old' });
    if (m.mod === 'res' && FAIL.has(m.method)) {
      const code = FAIL.get(m.method);
      FAIL.delete(m.method);
      return reply({ ok: false, error: code });
    }
    const mod = m.mod === 'res' ? RS : R;
    try {
      const r = await mod[m.method](m.arg);
      const out = JSON.parse(JSON.stringify(r === undefined ? null : r));
      if (m.mod === 'res') answers.push({ method: m.method, out });
      reply({ ok: true, result: out });
    } catch (x) {
      reply({ ok: false, error: x.message });
    }
  });
  return P;
}
const q = (d, s) => d.querySelector(s);
const qa = (d, s) => [...d.querySelectorAll(s)];
// the text a person reads: neighbouring elements are separated by a space (textContent would run them together)
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
const set = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const change = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const tick = (w, el, on) => {
  el.checked = on;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
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
const toastOf = (d) => txt(q(d, '#toast'));
const clearToast = (d) => {
  const t = q(d, '#toast');
  t.textContent = '';
  t.hidden = true;
};
const go = async (P, el, cond) => {
  clearToast(P.d);
  click(P.w, el);
  return cond ? until(cond) : (await sleep(120), true);
};
const sendForm = async (P, form, cond) => {
  clearToast(P.d);
  submit(P.w, form);
  return cond ? until(cond) : (await sleep(120), true);
};
const fill = (P, form, vals) => {
  for (const [k, v] of Object.entries(vals)) {
    const el = form.elements[k];
    if (!el) throw new Error('no field ' + k);
    if (el.tagName === 'SELECT') change(P.w, el, v);
    else set(P.w, el, v);
  }
};
const login = async (user) => {
  const P = openPage();
  await sleep(40);
  set(P.w, q(P.d, '#lgUser'), user);
  set(P.w, q(P.d, '#lgPass'), pw[user]);
  submit(P.w, q(P.d, '#loginForm'));
  await until(() => q(P.d, '.tab'));
  return P;
};
const tabBtn = (d, t) => q(d, `[data-tab="${t}"]`);
const settle = async (P, el) => {
  const n = calls.length;
  clearToast(P.d);
  click(P.w, el);
  await until(() => calls.length > n);
  await sleep(120);
  await until(() => !/Loading\.\.\./.test(txt(q(P.d, '.content'))));
};
const sub = (P, id) => settle(P, q(P.d, `[data-act="res-sub"][data-sub="${id}"]`));
const trs = (d) => qa(d, 'tr').filter((r) => r.querySelector('td'));
const rowWith = (d, t) => trs(d).find((r) => txt(r).includes(t));
const rowBib = (d, bib) => trs(d).find((r) => r.children[1] && txt(r.children[1]) === bib); // the board: Place, Bib, ...
const slRow = (d, bib) => trs(d).find((r) => r.children[0] && txt(r.children[0]) === bib); // start list: Bib, Name, Move
const btnIn = (scope, act, attrs) => qa(scope, `[data-act="${act}"]` + Object.entries(attrs || {}).map(([k, v]) => `[${k}="${v}"]`).join(''))[0];
const blobText = (w, b) =>
  new Promise((res) => {
    const r = new w.FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(b);
  });
const res = (m) => calls.filter((c) => c.mod === 'res' && (!m || c.method === m));
const content = (d) => txt(q(d, '.content'));
const dbWaves = (e) => {
  const list = rows('RDResSet').filter((x) => x.kind === 'waves' && x.ref === (e || EV)).sort((a, b) => (a._id < b._id ? -1 : 1));
  const last = list[list.length - 1];
  return last ? JSON.parse(last.json).waves : [];
};
const awardBlocks = (d, cat, label) => {
  const h3 = qa(d, 'h3').find((h) => txt(h).startsWith(cat + ' '));
  const card = h3 && h3.closest('.card');
  const h4 = card && qa(card, 'h4').find((h) => txt(h).startsWith(label));
  if (!h4) return null;
  const out = [];
  for (let n = h4.nextElementSibling; n && n.tagName !== 'H4'; n = n.nextElementSibling) {
    if (!n.querySelector('b')) continue; // a note under the last group is not an award table
    out.push({ label: txt(n.querySelector('b')), bibs: qa(n, 'tr').filter((r) => r.querySelector('td')).map((r) => txt(r.children[1])) });
  }
  return out;
};
const bibsOnBoard = (d) => trs(d).filter((r) => r.querySelector('[data-act="res-fix"]') || r.children.length >= 9).map((r) => txt(r.children[1]));
const CSV = [
  'bib,chip,gun,status,name,category,gender,age',
  '101,55:10,55:15,,,,,', '999,59:30,59:35,,Walk In Wanda,10 K,F,40', '102,56:20,56:25,,,,,', '103,57:30,57:35,,,,,', '104,50:00,50:05,,,,,', '105,58:00,58:05,,,,,', '106,45:00,45:04,,,,,', '107,1:01:00,1:01:05,,,,,',
  '201,1:50:00,1:50:10,,,,,', '202,1:40:00,1:40:05,,,,,', '203,2:05:00,2:05:09,,,,,', '301,47:00,47:03,,,,,', '302,48:00,48:03,,,,,', '303,1:35:00,1:35:06,,,,,', '304,49:00,49:03,,,,,',
].join('\n');

/* ---------- U1. who sees Results ---------- */
const A = await login('owner');
{
  const { d } = A;
  const t = tabBtn(d, 'res');
  ok(!!t && txt(t) === 'Waves & results', 'U1 a director has a "Waves & results" tab');
  ok(/Race day/.test(txt(q(d, '.side'))), 'U1 it sits in the Race day group of the side menu');
  await settle(A, t);
  const subs = qa(d, '[data-act="res-sub"]').map(txt);
  eq(subs, ['Results', 'Import', 'Awards', 'Waves', 'Start list', 'Setup'], 'U1 the director gets six sections');
  ok(q(d, '[role="tablist"][aria-label="Results sections"]') !== null, 'U1 the sections are a labelled tab list');
  ok(/No results yet\. Open Import/.test(content(d)), 'U1 an empty board says where to start');
  ok(res('resBoard').length === 1 && res('resBoard')[0].arg.ev === EV, 'U1 the board was asked for the selected race');
}
const L1 = await login('lead.one');
{
  const { d } = L1;
  const t = tabBtn(d, 'res');
  ok(!!t && txt(t) === 'Waves & results', 'U1 a lead has the tab too');
  await settle(L1, t);
  eq(qa(d, '[data-act="res-sub"]').map(txt), ['Results', 'Awards', 'Start list'], 'U1 a lead gets three sections: Results, Awards, Start list');
  ok(/Directors make the changes/.test(content(d)), 'U1 and is told that directors make the changes');
  ok(!q(d, '[data-act="res-sub"][data-sub="imp"]') && !q(d, '[data-act="res-sub"][data-sub="wav"]') && !q(d, '[data-act="res-sub"][data-sub="set"]'), 'U1 no Import, Waves or Setup for a lead');
}
const V1 = await login('view.one');
ok(!tabBtn(V1.d, 'res'), 'U1 a viewer has no Waves & results tab');
ok(!/Waves & results/.test(txt(q(V1.d, '.side'))), 'U1 a viewer sees nothing about it in the menu');

/* ---------- U2. setup ---------- */
await sub(A, 'set');
{
  const { d } = A;
  const f = q(d, '#resSetForm');
  ok(!!f && f.elements.rankBy.value === 'chip' && f.elements.ageRule.value === 'raceday' && f.elements.bands.value === '18, 30, 40, 50, 60' && f.elements.overallDepth.value === '3' && f.elements.groupDepth.value === '3' && f.elements.overallExcl.checked === true, 'U2 setup starts with the standard rules (chip time, age on race day, 18/30/40/50/60, top 3, no repeats)');
  ok(/never shown on screen, in a file or in a print-out/.test(txt(f)), 'U2 the screen says a date of birth is never shown');
  const opts = qa(f.elements.mGender, 'option').map(txt);
  ok(opts[0] === 'Not used' && opts.some((o) => /^Gender \(\d+ answered\)$/.test(o)) && opts.some((o) => /^Date of birth \(\d+ answered\)$/.test(o)) && opts.some((o) => /^Expected finish \(\d+ answered\)$/.test(o)), 'U2 each mapping lists the registration questions with how many answered (' + opts.join(' | ') + ')');
  fill(A, f, { bands: '30, 18' });
  await sendForm(A, f, () => toastOf(d));
  ok(/Those settings are not valid/.test(toastOf(d)) && rows('RDResSet').filter((x) => x._id === 'set~' + EV).length === 0, 'U2 age groups that do not rise are refused in plain words and nothing is saved: ' + toastOf(d));
  fill(A, f, { bands: '18, 30, 40, 50, 60', mGender: 'Gender', mDob: 'Date of birth', mAge: 'Age', mSeed: 'Expected finish' });
  await sendForm(A, f, () => /Setup saved/.test(toastOf(d)));
  ok(/Setup saved/.test(toastOf(d)), 'U2 good setup is saved');
  const sent = res('resSaveSettings').pop().arg.settings;
  ok(sent.rankBy === 'chip' && sent.bands === '18, 30, 40, 50, 60' && sent.map.gender === 'Gender' && sent.map.dob === 'Date of birth' && sent.overallExcl === true, 'U2 the screen sent exactly what was chosen');
  const st = JSON.parse(rows('RDResSet').find((x) => x._id === 'set~' + EV).json);
  eq([st.map.gender, st.map.dob, st.map.age, st.map.seed, st.bands], ['Gender', 'Date of birth', 'Age', 'Expected finish', [18, 30, 40, 50, 60]], 'U2 stored for this race, with the age groups as numbers');
  ok(!rows('RDResSet').some((x) => x._id === 'set~' + EV2), 'U2 and not for the other race');
  const f2 = q(d, '#resSetForm');
  ok(f2.elements.mGender.value === 'Gender' && f2.elements.mSeed.value === 'Expected finish', 'U2 the form shows what was saved');
}

/* ---------- U3. waves ---------- */
await sub(A, 'wav');
const wrow = (d, i) => qa(d, 'tr.wv')[i];
const setWave = (P, i, o) => {
  const r = wrow(P.d, i);
  if (o.cat !== undefined) change(P.w, r.querySelector('.wv-c'), o.cat);
  if (o.name !== undefined) set(P.w, r.querySelector('.wv-n'), o.name);
  if (o.start !== undefined) set(P.w, r.querySelector('.wv-s'), o.start);
  if (o.corrals !== undefined) set(P.w, r.querySelector('.wv-k'), o.corrals);
  if (o.cap !== undefined) set(P.w, r.querySelector('.wv-p'), o.cap);
};
{
  const { d } = A;
  ok(/No waves yet/.test(content(d)) && /14 paid runners/.test(content(d)) && /0 placed/.test(content(d)), 'U3 an empty Waves screen says there are no waves and 14 paid runners (the unpaid one is not counted)');
  for (let i = 0; i < 3; i++) await go(A, q(d, '[data-act="res-wav-add"]'), () => qa(d, 'tr.wv').length === i + 1);
  ok(qa(d, 'tr.wv').length === 3 && qa(d, 'tr.wv').every((r) => r.querySelector('.wv-s').value === '06:00' && r.querySelector('.wv-p').value === '0'), 'U3 "Add a wave" adds a row with a start of 06:00 and no limit');
  setWave(A, 0, { cat: '10 K', name: 'Wave 1', start: '06:00', corrals: 'A, B', cap: '3' });
  setWave(A, 1, { cat: '10 K', name: 'Wave 1', start: '06:10', corrals: 'C', cap: '0' });
  setWave(A, 2, { cat: '21 K', name: 'Elite', start: '25:99', corrals: '', cap: '0' });
  await go(A, q(d, '[data-act="res-wav-save"]'), () => toastOf(d));
  ok(/Check the waves/.test(toastOf(d)) && dbWaves().length === 0, 'U3 a start time of 25:99 and a repeated name are refused in plain words, and nothing is saved: ' + toastOf(d));
  ok(qa(d, 'tr.wv').length === 3 && wrow(d, 2).querySelector('.wv-s').value === '25:99', 'U3 the rows stay as typed');
  setWave(A, 1, { name: 'Wave 2' });
  setWave(A, 2, { start: '05:30' });
  await go(A, q(d, '[data-act="res-wav-save"]'), () => /Waves saved/.test(toastOf(d)));
  ok(/Waves saved/.test(toastOf(d)), 'U3 corrected waves are saved: ' + toastOf(d));
  const sent = res('resSaveWaves').pop().arg;
  ok(sent.rev === 0 && sent.waves.length === 3 && sent.waves[0].corrals === 'A, B' && sent.waves[0].cap === '3' && !('id' in sent.waves[0]), 'U3 the screen sent the revision it had (0) and the rows as typed');
  const stored = dbWaves();
  eq(stored.map((x) => [x.id, x.cat, x.name, x.start, x.corrals, x.cap]), [['w1', '10 K', 'Wave 1', '06:00', ['A', 'B'], 3], ['w2', '10 K', 'Wave 2', '06:10', ['C'], 0], ['w3', '21 K', 'Elite', '05:30', [], 0]], 'U3 stored with ids, corrals as a list and the capacity as a number');
  ok(qa(d, 'tr.wv').length === 3 && qa(d, 'tr.wv').every((r) => /^w\d$/.test(r.getAttribute('data-wid'))) && txt(wrow(d, 0).children[5]) === '0', 'U3 after saving the rows carry their ids and show how many are placed (0)');
}
{
  // two directors on the same waves: the second to save is told, and loses nothing of the first
  const B = await login('dir.two');
  await settle(B, tabBtn(B.d, 'res'));
  await sub(B, 'wav');
  ok(qa(B.d, 'tr.wv').length === 3, 'U3 a second director sees the same three waves');
  const { d } = A;
  await go(A, q(d, '[data-act="res-wav-add"]'), () => qa(d, 'tr.wv').length === 4);
  setWave(A, 3, { cat: '10 K', name: 'Late wave', start: '06:20', corrals: 'D', cap: '0' });
  await go(A, q(d, '[data-act="res-wav-save"]'), () => /Waves saved/.test(toastOf(d)));
  ok(dbWaves().length === 4, 'U3 the first director saves a fourth wave');
  setWave(B, 0, { cap: '9' });
  await go(B, q(B.d, '[data-act="res-wav-save"]'), () => toastOf(B.d));
  ok(/Someone else changed the waves/.test(toastOf(B.d)) && dbWaves().length === 4 && dbWaves()[0].cap === 3, 'U3 the second director is told someone else changed the waves, and the first one\'s work is untouched: ' + toastOf(B.d));
  await sub(B, 'board');
  await sub(B, 'wav');
  ok(qa(B.d, 'tr.wv').length === 4 && wrow(B.d, 0).querySelector('.wv-p').value === '3', 'U3 opening Waves again shows the current four waves, not the old draft');
  // take the fourth away again
  // (the waves are kept in the order of the race's categories, so the new 10 K wave is not the last row)
  const lateAt = qa(d, 'tr.wv').findIndex((r) => r.querySelector('.wv-n').value === 'Late wave');
  ok(lateAt === 2 && wrow(d, 3).querySelector('.wv-n').value === 'Elite', 'U3 after saving the rows are in the order of the race\'s categories: the new 10 K wave sits above the 21 K wave');
  await go(A, btnIn(d, 'res-wav-del', { 'data-id': String(lateAt) }), () => qa(d, 'tr.wv').length === 3);
  await go(A, q(d, '[data-act="res-wav-save"]'), () => /Waves saved/.test(toastOf(d)));
  ok(dbWaves().length === 3 && dbWaves().every((x) => x.name !== 'Late wave'), 'U3 a removed wave is gone after saving');
}

/* ---------- U4. placing the runners ---------- */
{
  const { d } = A;
  const f = q(d, '#resPlaceForm');
  ok(!!f && f.elements.mode.value === 'seed' && f.elements.redo.checked === false, 'U4 the placing form starts with "fastest expected time first"');
  await sendForm(A, f, () => /\d+ placed/.test(txt(q(d, '#resPlaceForm'))));
  const out = txt(q(d, '#resPlaceForm'));
  ok(/14 placed/.test(out) && !/without room/.test(out), 'U4 14 runners are placed, none without room: ' + out.slice(-60));
  const sent = res('resAssign').pop().arg;
  ok(/^k[a-z0-9]{8,}$/.test(sent.key) && sent.mode === 'seed' && sent.redo === false && !('cat' in sent), 'U4 the request carries a repeat key and what was chosen');
  const as = rows('RDWaveAssign').filter((x) => x.event === EV);
  eq([as.length, as.filter((x) => x.wave === 'w1').length, as.filter((x) => x.wave === 'w2').length, as.filter((x) => x.wave === 'w3').length], [14, 3, 7, 4], 'U4 wave 1 is full (3), wave 2 takes the rest of the 10 K (7), the elite wave takes the 21 K (4)');
  ok(!as.some((x) => x.regId === idOf(EV, '111')), 'U4 the runner who has not paid is not placed');
  ok(/14 placed/.test(content(d)) && txt(wrow(d, 0).children[5]) === '3' && txt(wrow(d, 1).children[5]) === '7' && txt(wrow(d, 2).children[5]) === '4', 'U4 the waves table shows the numbers placed: 3, 7 and 4');
}

/* ---------- U5. the start list ---------- */
await sub(A, 'sl');
{
  const { d, w } = A;
  const heads = qa(d, 'h3').map(txt);
  ok(heads.some((h) => /^10 K: Wave 1 starts 06:00 · 3 of 3 runners/.test(h)) && heads.some((h) => /^10 K: Wave 2 starts 06:10 · 7 runners/.test(h)) && heads.some((h) => /^21 K: Elite starts 05:30 · 4 runners/.test(h)), 'U5 the list shows each wave with its start time and how full it is (' + heads.join(' | ') + ')');
  ok(!/Unpaid Uma|Not placed in a wave/.test(content(d)), 'U5 the runner who has not paid is not listed, and nobody is left unplaced');
  const a1 = rows('RDWaveAssign').find((x) => x.regId === idOf(EV, '102'));
  const sel = (bib) => slRow(d, bib).querySelector('.res-wave');
  ok(!!sel('104') && sel('104').value === 'w1' && qa(sel('104'), 'option').map((o) => o.value).join() === ',w1,w2', 'U5 each runner has a wave menu with only the waves of their own category');
  // wave 1 is full: moving a fourth runner in is refused
  eq([a1.wave], ['w2'], 'U5 control: Bina is in wave 2');
  change(w, sel('102'), 'w1');
  await until(() => toastOf(d));
  ok(/That wave is full/.test(toastOf(d)) && rows('RDWaveAssign').find((x) => x.regId === idOf(EV, '102')).wave === 'w2', 'U5 a move into a full wave is refused in plain words and nothing changes: ' + toastOf(d));
  // make room, then move
  clearToast(d);
  await sub(A, 'sl');
  change(w, sel('104'), 'w2');
  await until(() => /Placed/.test(toastOf(d)));
  const m1 = rows('RDWaveAssign').find((x) => x.regId === idOf(EV, '104'));
  ok(/Placed/.test(toastOf(d)) && m1.wave === 'w2' && m1.how === 'manual' && m1.by === 'owner', 'U5 moving a runner by hand is saved as "manual", by the director');
  ok(txt(qa(d, 'h3').find((h) => /Wave 1 starts/.test(txt(h)))).includes('2 of 3 runners'), 'U5 the list is redrawn: wave 1 now has 2 of 3');
  clearToast(d);
  change(w, sel('102'), 'w1');
  await until(() => /Placed/.test(toastOf(d)));
  ok(rows('RDWaveAssign').find((x) => x.regId === idOf(EV, '102')).wave === 'w1', 'U5 with room made, the move works');
  // corral
  const cor = (bib) => slRow(d, bib).querySelector('.res-corral');
  ok(!!cor('102') && qa(cor('102'), 'option').map((o) => o.value).join() === ',A,B', 'U5 a runner in a wave with corrals gets a corral menu (A, B)');
  clearToast(d);
  change(w, cor('102'), 'B');
  await until(() => /Corral saved/.test(toastOf(d)));
  ok(rows('RDWaveAssign').find((x) => x.regId === idOf(EV, '102')).corral === 'B', 'U5 a corral is saved');
  ok(!slRow(d, '202').querySelector('.res-corral'), 'U5 a wave without corrals has no corral menu');
  // take out
  clearToast(d);
  change(w, sel('202'), '');
  await until(() => /Taken out/.test(toastOf(d)));
  ok(/Not placed in a wave/.test(content(d)) && !!slRow(d, '202') && !slRow(d, '202').querySelector('.res-corral') && !rows('RDWaveAssign').some((x) => x.regId === idOf(EV, '202')), 'U5 taking a runner out of the wave lists them under "Not placed in a wave"');
  clearToast(d);
  const un = slRow(d, '202').querySelector('.res-wave');
  ok(qa(un, 'option').map((o) => o.value).join() === ',w3', 'U5 and offers only the waves of their category');
  change(w, un, 'w3');
  await until(() => /Placed/.test(toastOf(d)));
  ok(rows('RDWaveAssign').find((x) => x.regId === idOf(EV, '202')).wave === 'w3', 'U5 and they can be placed again');
}
{
  // placing again never moves a runner placed by hand
  const { d } = A;
  await sub(A, 'wav');
  const f = q(d, '#resPlaceForm');
  const before = rows('RDWaveAssign').filter((x) => x.how === 'manual').map((x) => x.regId + x.wave + x.corral).sort();
  f.elements.redo.checked = true;
  await sendForm(A, f, () => res('resAssign').length === 2);
  await sleep(200);
  ok(res('resAssign').pop().arg.redo === true, 'U5 "Place again" sends redo');
  const after = rows('RDWaveAssign').filter((x) => x.how === 'manual').map((x) => x.regId + x.wave + x.corral).sort();
  eq(after, before, 'U5 "Place again" leaves every runner placed by hand where they were (' + before.length + ')');
  ok(rows('RDWaveAssign').filter((x) => x.event === EV).length === 14, 'U5 and still 14 placements');
}

/* ---------- U6. importing the timing file ---------- */
await sub(A, 'imp');
{
  const { d, w } = A;
  const saveBtn = () => q(d, '[data-act="res-imp-save"]');
  ok(saveBtn().disabled === true, 'U6 "Save results" is off until a file has been checked');
  await go(A, q(d, '[data-act="res-imp-check"]'));
  ok(/Paste the results or choose a file first/.test(toastOf(d)) && res('resImport').length === 0, 'U6 "Check" with nothing pasted says so and asks nothing of the server: ' + toastOf(d));
  const BAD = ['bib,chip,gun,name,category,status', '101,55:10,55:15,,,', 'abc!,55:00,,,,', '105,xx:yy,,,,', '106,45:00,45:04,,21 K,', '<b>999</b>,50:00,,,,'].join('\n');
  set(w, q(d, '#resText'), BAD);
  await go(A, q(d, '[data-act="res-imp-check"]'), () => /with a problem/.test(content(d)));
  const c = content(d);
  ok(/1 lines read/.test(c) && /4 lines with a problem/.test(c), 'U6 checking shows what the file holds and "4 lines with a problem": ' + c.slice(c.indexOf('What the file holds'), c.indexOf('What the file holds') + 120));
  const list = qa(d, 'ul.clean li').map(txt);
  ok(list.some((x) => /^Line 3: Bib "abc!" is not a bib number/.test(x)) && list.some((x) => /^Line 4: Bib 105: "xx:yy" is not a time/.test(x)) && list.some((x) => /^Line 5: Bib 106 is registered for "10 K" but the file says "21 K"/.test(x)), 'U6 each problem names its line and says what is wrong (' + list.join(' | ').slice(0, 300) + ')');
  ok(!q(d, 'ul.clean b b') && !/<b>999/.test(q(d, 'ul.clean').innerHTML) && list.some((x) => /^Line 6: Bib "b999\/b" is not a bib number/.test(x)), 'U6 a bib typed as markup is not repeated back as markup');
  ok(saveBtn().disabled === true, 'U6 with problems, "Save results" stays off');
  tick(w, q(d, '#resSkip'), true);
  await sleep(50);
  ok(saveBtn().disabled === false, 'U6 ticking "skip lines with problems" turns it on');
  await go(A, saveBtn(), () => /saved/.test(toastOf(d)));
  ok(/1 saved, 4 lines skipped/.test(toastOf(d)) && rows('RDResults').filter((x) => x.event === EV).length === 1, 'U6 saving keeps the one good line and says 4 were skipped: ' + toastOf(d));
  const sent = res('resImport').filter((x) => !x.arg.dry).pop().arg;
  ok(sent.skipErrors === true && sent.replace === false && /^k[a-z0-9]{8,}$/.test(sent.key), 'U6 the request carries "skip", "replace" and a key');
  ok(q(d, '#resText').value === '' && saveBtn().disabled === true, 'U6 after saving the box is empty again and Save is off');
}
{
  // the whole file: a server error on the first Save, then a retry (same key), then three quick clicks
  const { d, w } = A;
  const saveBtn = () => q(d, '[data-act="res-imp-save"]');
  set(w, q(d, '#resText'), CSV);
  await go(A, q(d, '[data-act="res-imp-check"]'), () => /No problems found/.test(content(d)));
  const c = content(d);
  ok(/15 lines read/.test(c) && /14 match a registration/.test(c) && /1 not registered/.test(c) && /15 finished/.test(c) && /14 new/.test(c), 'U6 the whole file: 15 lines, 14 registered, 1 not registered, 15 finished, 14 new');
  ok(/Columns used: .*bib/.test(c) && qa(d, 'table tr').some((r) => /Walk In Wanda/.test(txt(r)) && /\bno\b/.test(txt(r.lastElementChild))), 'U6 the sample shows the unregistered runner with "no" under Registered');
  ok(saveBtn().disabled === false, 'U6 with no problems, Save is on');
  const nBefore = rows('RDResults').length;
  FAIL.set('resImport', 'server_error');
  await go(A, saveBtn(), () => toastOf(d));
  ok(toastOf(d) !== '' && !/saved/.test(toastOf(d)) && rows('RDResults').length === nBefore, 'U6 a server error is said in plain words and nothing is saved: ' + toastOf(d));
  ok(q(d, '#resText').value.startsWith('bib,chip,gun'), 'U6 the pasted file is still there');
  clearToast(d);
  click(w, saveBtn());
  click(w, saveBtn());
  click(w, saveBtn());
  await until(() => /saved/.test(toastOf(d)));
  await sleep(150);
  ok(/14 saved, 1 kept as they were/.test(toastOf(d)), 'U6 the retry saves 14 and keeps the one already saved: ' + toastOf(d));
  const real = res('resImport').filter((x) => !x.arg.dry);
  ok(real.length === 3 && real[1].arg.key === real[2].arg.key && real[1].arg.key !== real[0].arg.key, 'U6 three quick clicks sent one request, and it carried the same key as the failed attempt (' + real.map((x) => x.arg.key).join(' / ') + ')');
  eq(rows('RDResults').filter((x) => x.event === EV).length, 15, 'U6 the race now has 15 results (14 registered runners and the walk-in)');
  ok(rows('RDResults').filter((x) => x.event === EV2).length === 0, 'U6 and the other race has none');
  const wanda = rows('RDResults').find((x) => x.event === EV && x.bib === '999');
  ok(wanda && wanda.name === 'Walk In Wanda' && wanda.cat === '10 K' && wanda.regId === '' && wanda.by === 'owner', 'U6 the walk-in is stored with the name and category from the file, by the director');
}
{
  // choosing a file
  const { d, w } = A;
  const inp = q(d, '#resFile');
  const file = new w.File(['bib,chip\n101,55:10\n'], 'timing.csv', { type: 'text/csv' });
  Object.defineProperty(inp, 'files', { configurable: true, value: [file] });
  inp.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok(await until(() => q(d, '#resText').value === 'bib,chip\n101,55:10\n'), 'U6 a chosen file is read into the box');
  const big = new w.File(['x'.repeat(1600000)], 'big.csv', { type: 'text/csv' });
  const inp2 = q(d, '#resFile');
  Object.defineProperty(inp2, 'files', { configurable: true, value: [big] });
  clearToast(d);
  inp2.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => toastOf(d));
  ok(/too big/.test(toastOf(d)), 'U6 a file over 1.5 MB is turned away at once: ' + toastOf(d));
  set(w, q(d, '#resText'), '');
}

/* ---------- U7. the results board ---------- */
await sub(A, 'board');
{
  const { d, w } = A;
  const c = content(d);
  ok(/15 finished/.test(c) && /1 not registered/.test(c) && /1 without gender/.test(c) && /1 without age/.test(c), 'U7 the board counts 15 finished, 1 not registered, 1 without gender, 1 without age');
  const bibs = bibsOnBoard(d);
  eq(bibs.length, 15, 'U7 15 rows');
  const ten = bibs.filter((b) => ['106', '301', '302', '304', '104', '101', '102', '103', '105', '999', '107'].includes(b));
  eq(ten, ['106', '301', '302', '304', '104', '101', '102', '103', '105', '999', '107'], 'U7 the 10 K is in order of chip time: 45:00, 47:00, 48:00, 49:00, 50:00, 55:10, 56:20, 57:30, 58:00, 59:30, 1:01:00');
  const twentyOne = bibs.filter((b) => ['303', '202', '201', '203'].includes(b));
  eq(twentyOne, ['303', '202', '201', '203'], 'U7 and the 21 K by its own times');
  eq(txt(rowBib(d, '106').children[0]), '1', 'U7 the fastest 10 K runner is place 1');
  const hari = rowBib(d, '107');
  ok(/no gender/.test(txt(hari)) && /no age/.test(txt(hari)), 'U7 a runner without gender and age is marked, not left out');
  ok(/not registered/.test(txt(rowBib(d, '999'))), 'U7 the walk-in is marked "not registered"');
  ok(txt(rowBib(d, '106').children[5]).startsWith('Under 18') && txt(rowBib(d, '104').children[5]).startsWith('40-49') && txt(rowBib(d, '104').children[5]).includes('(46)'), 'U7 age groups come from the registration (a plain age of 17, a date of birth of 46) and show the age');
  ok(txt(rowBib(d, '106').children[7]) === '1' && txt(rowBib(d, '106').children[8]) === '1', 'U7 gender place and age-group place are shown');
  // hostile names stay text
  ok(!q(d, '.content img') && w.__pwn === undefined, 'U7 a name typed as an HTML picture stays text: no picture was made and nothing ran');
  ok(txt(rowBib(d, '301').children[2]) === EVIL1 && txt(rowBib(d, '302').children[2]) === EVIL2 && txt(rowBib(d, '303').children[2]) === EVIL3 && txt(rowBib(d, '304').children[2]) === EVIL4, 'U7 and each name is shown exactly as typed');
  ok(!q(d, '.content table b') || !qa(d, '.content table b').some((b) => /bold/.test(txt(b))), 'U7 "<b>bold</b>" in a name made no bold text');
  // category filter
  change(w, q(d, '#resCat'), '21 K');
  eq(bibsOnBoard(d), ['303', '202', '201', '203'], 'U7 the category menu shows the 21 K only');
  change(w, q(d, '#resCat'), '');
  eq(bibsOnBoard(d).length, 15, 'U7 and "All categories" shows everyone again');
}
{
  // correcting a result
  const { d } = A;
  await go(A, btnIn(rowBib(d, '103'), 'res-fix'), () => q(d, '#resForm[data-kind="fix"]'));
  const f = q(d, '#resForm');
  ok(/Correct bib 103, Chitra/.test(txt(f)) && f.elements.chip.value === '0:57:30' && f.elements.status.value === 'fin' && f.elements.dob.value === '', 'U7 the correction form holds the result, and the date of birth box is empty (it is never shown)');
  ok(/leave empty to keep what is stored/.test(txt(f)), 'U7 and says so');
  await sendForm(A, f, () => toastOf(d));
  ok(/Nothing was changed/.test(toastOf(d)) && res('resSaveRow').length === 0, 'U7 pressing Save with nothing changed says so and asks nothing of the server: ' + toastOf(d));
  fill(A, f, { chip: '57:40' });
  await sendForm(A, f, () => toastOf(d));
  ok(res('resSaveRow').length === 1 && toastOf(d) !== '' && !/Correction saved/.test(toastOf(d)) && rows('RDResults').find((x) => x._id === 'rs~' + EV + '~103').chipCs === '345000', 'U7 without a reason the correction is refused and the time is as it was: ' + toastOf(d));
  fill(A, f, { reason: 'Mat read the wrong chip' });
  await sendForm(A, f, () => /Correction saved/.test(toastOf(d)));
  ok(/Correction saved/.test(toastOf(d)), 'U7 with a reason it is saved');
  eq(Object.keys(res('resSaveRow').pop().arg.fields), ['chip'], 'U7 only the field that changed was sent');
  ok(/57:40/.test(txt(rowBib(d, '103'))) && !q(d, '#resForm'), 'U7 the board shows the new time and the form is closed');
  const row = rows('RDResults').find((x) => x._id === 'rs~' + EV + '~103');
  const prev = JSON.parse(row.prev);
  ok(row.chipCs === '346000' && row.by === 'owner' && prev.chipCs === '345000' && prev.by === 'owner', 'U7 the row holds the new time (57:40) and keeps the old one (57:30) with who wrote it');
}
{
  // voiding and restoring
  const { d } = A;
  const before = bibsOnBoard(d).length;
  await go(A, btnIn(rowBib(d, '105'), 'res-voidform'), () => q(d, '#resForm[data-kind="void"]'));
  const f = q(d, '#resForm');
  ok(/Void the result of bib 105, Esha/.test(txt(f)) && /stays in the list, apart/.test(txt(f)), 'U7 the void form explains that the result stays in the list, apart');
  await sendForm(A, f, () => toastOf(d));
  ok(!/Result voided/.test(toastOf(d)) && rows('RDResults').find((x) => x._id === 'rs~' + EV + '~105').void === 'no', 'U7 a void without a reason is refused: ' + toastOf(d));
  fill(A, f, { reason: 'Cut the course' });
  await sendForm(A, f, () => /Result voided/.test(toastOf(d)));
  ok(/Result voided/.test(toastOf(d)) && bibsOnBoard(d).length === before - 1 && !rowBib(d, '105'), 'U7 the result leaves the ranking');
  const vd = qa(d, 'h3').find((h) => /Voided results/.test(txt(h))).closest('.card');
  ok(/105/.test(txt(vd)) && /Esha/.test(txt(vd)) && /Cut the course/.test(txt(vd)) && /owner/.test(txt(vd)), 'U7 it is listed under "Voided results" with the reason and who did it');
  eq(txt(rowBib(d, '999').children[0]), '9', 'U7 the places below it moved up (the walk-in went from 10 to 9)');
  await go(A, btnIn(vd, 'res-restore'), () => /Result restored/.test(toastOf(d)));
  ok(/Result restored/.test(toastOf(d)) && !!rowBib(d, '105') && txt(rowBib(d, '999').children[0]) === '10' && !qa(d, 'h3').some((h) => /Voided results/.test(txt(h))), 'U7 restoring puts it back in its place');
}

/* ---------- U8. awards ---------- */
await sub(A, 'aw');
{
  const { d, w } = A;
  const c = content(d);
  ok(/Top 3 overall and top 3 in each age group/.test(c) && /not listed again in their age group/.test(c), 'U8 the awards say how many places and that overall winners are not listed twice');
  ok(qa(d, 'h3').some((h) => /^10 K 11 finishers/.test(txt(h))) && qa(d, 'h3').some((h) => /^21 K 4 finishers/.test(txt(h))), 'U8 each category shows its finishers (11 in the 10 K, 4 in the 21 K)');
  const women = awardBlocks(d, '10 K', 'Women');
  const men = awardBlocks(d, '10 K', 'Men');
  ok(!!women && !!men, 'U8 the 10 K has Women and Men');
  eq(women[0].bibs, ['301', '101', '102'], 'U8 10 K women, overall: 47:00, 55:10, 56:20');
  eq(men[0].bibs, ['106', '302', '304'], 'U8 10 K men, overall: 45:00, 48:00, 49:00');
  const mAge = Object.fromEntries(men.slice(1).map((b) => [b.label.replace(/\s*\(.*$/, ''), b.bibs]));
  eq(mAge, { '40-49': ['104'] }, 'U8 10 K men by age group: only Dev (40-49); the overall winners are not listed again, so the other groups are empty and not shown');
  const wAge = Object.fromEntries(women.slice(1).map((b) => [b.label.replace(/\s*\(.*$/, ''), b.bibs]));
  eq(wAge, { '18-29': ['103'], '30-39': ['105'], '40-49': ['999'] }, 'U8 10 K women by age group: Chitra (18-29), Esha (30-39) and the walk-in (40-49)');
  eq(awardBlocks(d, '21 K', 'Women')[0].bibs, ['201', '203'], 'U8 21 K women, overall');
  eq(awardBlocks(d, '21 K', 'Men')[0].bibs, ['303', '202'], 'U8 21 K men, overall');
  ok(/No award can be given until this is filled in: 107 Hari \(gender\)/.test(c), 'U8 a runner without a gender is named, with what is missing: ' + c.slice(c.indexOf('No award')).slice(0, 110));
  const card10 = qa(d, 'h3').find((h) => /^10 K/.test(txt(h))).closest('.card');
  ok(!q(d, '.content img') && w.__pwn === undefined && txt(card10).includes(EVIL1), 'U8 the name typed as an HTML picture is shown as text in the awards');
  change(w, q(d, '#resCat'), '21 K');
  ok(!qa(d, 'h3').some((h) => /^10 K/.test(txt(h))) && qa(d, 'h3').some((h) => /^21 K/.test(txt(h))), 'U8 the category menu narrows the awards');
  change(w, q(d, '#resCat'), '');
}
{
  // the director fills in what is missing, on the Results tab; the date of birth is read for the age and never shown
  const { d } = A;
  await sub(A, 'board');
  await go(A, btnIn(rowBib(d, '107'), 'res-fix'), () => q(d, '#resForm[data-kind="fix"]'));
  const f = q(d, '#resForm');
  fill(A, f, { gender: 'M', dob: '02/02/1990', reason: 'Asked at the desk' });
  await sendForm(A, f, () => /Correction saved/.test(toastOf(d)));
  ok(/Correction saved/.test(toastOf(d)), 'U8 a missing gender and a date of birth are filled in');
  const hari = rowBib(d, '107');
  ok(!/no gender|no age/.test(txt(hari)) && /^30-39 \(3\d\)$/.test(txt(hari.children[5])), 'U8 the marks are gone and the age shows, worked out from the date of birth: ' + txt(hari.children[5]));
  ok(!/02\/02\/1990|1990-02-02/.test(d.body.innerHTML) && !answers.some((a) => /02\/02\/1990|1990-02-02/.test(JSON.stringify(a.out))), 'U8 the date of birth typed is nowhere on the screen or in any answer of the server');
  const stored = rows('RDResults').find((x) => x._id === 'rs~' + EV + '~107');
  ok(stored.dob === '1990-02-02' && stored.gender === 'M', 'U8 (it is kept in the result row, for working out the age again if the race day moves)');
  await sub(A, 'aw');
  const men = awardBlocks(d, '10 K', 'Men');
  ok(!/No award can be given/.test(content(d)) && men.some((b) => /^30-39/.test(b.label) && b.bibs.join() === '107'), 'U8 now Hari is in the men\'s 30-39, and the "no award can be given" note is gone');
}

/* ---------- U9. files and print-outs ---------- */
await sub(A, 'board');
{
  const { d, w } = A;
  const n0 = blobs.length;
  await go(A, q(d, '[data-act="res-csv-board"]'));
  ok(blobs.length === n0 + 1 && downloads.pop() === 'results.csv', 'U9 the board downloads as results.csv');
  const t = await blobText(w, blobs[blobs.length - 1]);
  const lines = t.trim().split('\r\n');
  eq(lines[0], 'Place,Bib,Name,Category,Gender,Age,Age group,Status,Time,Chip time,Gun time,Gender place,Age group place,Notes', 'U9 the columns of the results file');
  eq(lines.length, 16, 'U9 one line for each of the 15 results');
  ok(!PII.test(t), 'U9 the file holds no phone number, e-mail address or date of birth');
  ok(t.includes('"\'=HYPERLINK(""http://evil"",""click"")"') && t.includes("'@cmd|calc"), 'U9 a name that looks like a formula (= or @) is written with a leading quote, so a spreadsheet shows it as text');
  ok(t.includes(EVIL1.replace(/"/g, '""')), 'U9 markup in a name is kept as plain text in the file');
  change(w, q(d, '#resCat'), '21 K');
  await go(A, q(d, '[data-act="res-csv-board"]'));
  const t2 = await blobText(w, blobs[blobs.length - 1]);
  eq(t2.trim().split('\r\n').length, 5, 'U9 with the 21 K chosen the file holds the 21 K only (4 lines and the header)');
  change(w, q(d, '#resCat'), '');
  const p0 = printed.length;
  await go(A, q(d, '[data-act="res-print-board"]'));
  await sleep(250);
  const ph = printed[p0];
  ok(/<h1>Results<\/h1>/.test(ph) && ph.includes('VHM Results Edition') && !/<img/.test(ph) && ph.includes('&lt;img src=x onerror=&quot;window.__pwn=1&quot;&gt;Eve'), 'U9 the print-out is titled with the race, and markup in a name is escaped');
  ok(!PII.test(ph), 'U9 and holds no phone number, e-mail address or date of birth');
  ok(printed.includes('PRINT'), 'U9 and the print dialog was asked for');
}
await sub(A, 'aw');
{
  const { d, w } = A;
  await go(A, q(d, '[data-act="res-csv-aw"]'));
  ok(downloads.pop() === 'awards.csv', 'U9 the awards download as awards.csv');
  const t = await blobText(w, blobs[blobs.length - 1]);
  const lines = t.trim().split('\r\n');
  eq(lines[0], 'Category,Gender,Award,Place,Bib,Name,Age group,Time', 'U9 the columns of the awards file');
  ok(lines.some((l) => /^10 K,Women,Overall,1,301,/.test(l)) && lines.some((l) => /^10 K,Men,40-49,1,104,Dev,/.test(l)), 'U9 it holds the overall and the age-group places');
  ok(!PII.test(t) && t.includes("'=HYPERLINK") && t.includes("'@cmd|calc"), 'U9 no personal details, and formula-looking names are guarded');
  const p0 = printed.length;
  await go(A, q(d, '[data-act="res-print-aw"]'));
  await sleep(250);
  ok(/<h1>Awards<\/h1>/.test(printed[p0]) && !/<img/.test(printed[p0]) && !PII.test(printed[p0]), 'U9 the awards print-out is escaped and holds no personal details');
}
await sub(A, 'sl');
{
  const { d, w } = A;
  await go(A, q(d, '[data-act="res-csv-sl"]'));
  ok(downloads.pop() === 'start-list.csv', 'U9 the start list downloads as start-list.csv');
  const t = await blobText(w, blobs[blobs.length - 1]);
  const lines = t.trim().split('\r\n');
  eq(lines[0], 'Category,Wave,Start,Corral,Bib,Name', 'U9 the columns of the start list file');
  eq(lines.length, 15, 'U9 14 placed runners and the header');
  ok(!PII.test(t) && !/Unpaid Uma/.test(t), 'U9 no personal details, and not the runner who has not paid');
  ok(lines.some((l) => /^10 K,Wave 1,06:00,B,102,Bina$/.test(l)), 'U9 the hand move to corral B is in the file');
  change(w, q(d, '#resCat'), '21 K');
  const p0 = printed.length;
  await go(A, q(d, '[data-act="res-print-sl"]'));
  await sleep(250);
  ok(/<h1>Start list<\/h1>/.test(printed[p0]) && !/Wave 2/.test(printed[p0]) && /Elite/.test(printed[p0]), 'U9 the printed start list follows the category chosen');
  change(w, q(d, '#resCat'), '');
}

/* ---------- U10. a lead can only look ---------- */
{
  const { d } = L1;
  await sub(L1, 'board');
  ok(bibsOnBoard(d).length === 15 && !q(d, '[data-act="res-fix"]') && !q(d, '[data-act="res-voidform"]'), 'U10 a lead sees all 15 results and has no Fix or Void');
  await sub(L1, 'sl');
  ok(!q(d, '.res-wave') && !q(d, '.res-corral') && /Wave 1 starts 06:00/.test(content(d)), 'U10 a lead sees the start list and has no Move menus');
  await sub(L1, 'aw');
  ok(awardBlocks(d, '10 K', 'Women')[0].bibs.join() === '301,101,102', 'U10 a lead reads the same awards');
  const m = L1.calls.filter((c) => c.mod === 'res').map((c) => c.method).filter((v, i, a) => a.indexOf(v) === i).sort();
  ok(m.length === 4 && m.every((x) => ['resBoard', 'resAwards', 'resStartList', 'resOverview'].includes(x)), 'U10 a lead\'s screen only asks the server for things to look at (' + m.join(', ') + ')');
  ok(!PII.test(d.body.innerHTML), 'U10 and shows no phone number, e-mail address or date of birth');
}

/* ---------- U11. when things go wrong ---------- */
{
  // the site's page code does not know the Results calls yet
  const { d } = A;
  OLD.res = true;
  await sub(A, 'aw');
  await sub(A, 'board');
  ok(/page's code is out of date/.test(content(d)) && !!q(d, '[data-act="retry"]'), 'U11 an old page code is explained, with a "Try again" button: ' + content(d).slice(0, 120));
  OLD.res = false;
  await go(A, q(d, '[data-act="retry"]'), () => bibsOnBoard(d).length === 15);
  ok(bibsOnBoard(d).length === 15, 'U11 once the code is updated, "Try again" shows the board');
  // an old backend file
  FAIL.set('resAwards', 'backend_old');
  await sub(A, 'aw');
  ok(/backend file is out of date/.test(content(d)), 'U11 an old backend file is explained: ' + content(d).slice(0, 100));
  await go(A, q(d, '[data-act="retry"]'), () => /Top 3 overall/.test(content(d)));
  ok(/Top 3 overall/.test(content(d)), 'U11 and "Try again" works');
}
{
  // another race has its own, empty results
  const { d, w } = A;
  await sub(A, 'board');
  change(w, q(d, '#evPick'), EV2);
  await until(() => /No results yet/.test(content(d)));
  ok(/No results yet/.test(content(d)) && !/Asha|Walk In Wanda/.test(content(d)), 'U11 another race shows its own empty board, with nothing of the first');
  ok(res('resBoard').pop().arg.ev === EV2, 'U11 and the server was asked for that race');
  await sub(A, 'sl');
  ok(/No waves yet/.test(content(d)) && /Not placed in a wave/.test(content(d)) && /Other Race Olga/.test(content(d)) && !/Asha|Wave 1/.test(content(d)), 'U11 the start list of the other race has no waves and lists its own paid runner as not placed');
  change(w, q(d, '#evPick'), EV);
  await until(() => bibsOnBoard(d).length === 15);
  ok(bibsOnBoard(d).length === 15 && res('resBoard').pop().arg.ev === EV, 'U11 back to the first race, its 15 results are there');
}
{
  // the session ends in the middle of it
  const { d } = A;
  FAIL.set('resAwards', 'not_logged_in');
  await sub(A, 'aw');
  await until(() => q(d, '#loginForm'));
  ok(!!q(d, '#loginForm') && /Your session ended/.test(txt(d.body)) && !/Asha|Walk In Wanda|Wave 1/.test(d.body.innerHTML), 'U11 a lost session returns to the login screen with an explanation, and no results stay on the page');
}
{
  // logging out clears everything
  const B = await login('owner');
  await settle(B, tabBtn(B.d, 'res'));
  ok(bibsOnBoard(B.d).length === 15, 'U11 control: a director\'s board before logging out');
  await go(B, q(B.d, '[data-act="logout"]'), () => q(B.d, '#loginForm'));
  ok(!!q(B.d, '#loginForm') && !/Walk In Wanda|Asha|Wave 1/.test(B.d.body.innerHTML), 'U11 logging out leaves no names or waves on the page');
}

/* ---------- U12. the whole run ---------- */
{
  ok(!answers.some((a) => PII.test(JSON.stringify(a.out))), 'U12 across the whole run, none of the ' + answers.length + ' answers of the Results server held a phone number, e-mail address or date of birth');
  ok(!res().some((c) => /^res(Save|Void|Place|Assign|Import)/.test(c.method) && !!c.arg && c.arg.token && c.arg.token.length < 20), 'U12 every change was sent with a login token');
  const sentTexts = JSON.stringify(res().map((c) => Object.assign({}, c.arg, { token: undefined })));
  ok(!/98123\d{5}|@example\.com/.test(sentTexts), 'U12 and nothing the screen sent held a phone number or an e-mail address');
  ok(res().every((c) => !!c.arg.ev), 'U12 every Results call named the race');
  const methods = [...new Set(res().map((c) => c.method))].sort();
  ok(methods.length >= 10, 'U12 the run used ' + methods.length + ' of the 12 Results methods (' + methods.join(', ') + ')');
  eq(jserr, [], 'U12 no script error was raised on any page');
}
done();
