// COMPONENT + INTEGRATION TESTS (screen): the Waivers tab of the Director page, in jsdom, on the real RaceOS, Messages and Waivers backend
// code. A director writes the waiver (each save is a new version), says which question of the registration form is the waiver, sees who has
// signed (and who signed only an older text), records papers signed on the day (a lead too), marks a record as a mistake (a director only),
// prints a page for each person, a sign-in list or blank pages, and picks the "waiver" choice in Messages. A lead can look, print and record.
// A viewer has no such tab. Everything goes through the buttons and fields a person would use. Also: markup in a name stays text on every
// screen, no phone number or e-mail address of a person reaches the screen or a printed paper, an answer that arrives late does not overwrite
// a newer one, a double press records once, a call that runs out of time on the server is finished by the page, switching race or logging
// out clears everything, an old page code or a lost session is explained, and the typed text survives a refused save.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as CM from './comms.test.mjs';
import * as WV from './waivers.test.mjs';
import * as W from './rd-waiver.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Waivers: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const jserr = [];
const calls = [];
const FAIL = new Map(); // method -> { code, skip }: the code is given instead of the real answer, once, after skipping that many calls
const DELAY = new Map(); // method -> [ms, ...]: the next answers are held back that long
const TAMPER = new Map(); // method -> function: changes the answer before the page gets it
const OLD = { wv: false, comms: false }; // the page code on the site does not know these calls yet
const REPL = { wv: 0, comms: 0 }; // how many calls of each kind have been answered
const printed = [];
const downloads = [];
// the clock: a slow write on the server moves it on (a call that runs out of time)
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
let slowLeft = 0;
let failWrites = false; // every write to the waivers collection fails (a server that gets nowhere)
const realInsert = wd.insert;
wd.insert = (...a) => {
  if (failWrites && a[0] === 'RDWaivers') throw new Error('write failed');
  if (slowLeft > 0 && a[0] === 'RDWaivers') {
    slowLeft--;
    skew += 4000;
  }
  return realInsert.apply(wd, a);
};

/* ---------- the world ---------- */
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
const TB = (await R.login({ username: 'dir.two', password: pw['dir.two'] })).token;
const RD = istDay(40);
const mkRace = async (name, venue, cats) => {
  const e = (await R.saveEvent({ token: OT, name, date: RD, venue })).event.id;
  await R.saveCats({ token: OT, ev: e, cats });
  return e;
};
const K10 = { name: '10 K', km: 10, price: 800, cap: 9000 };
const K21 = { name: '21 K', km: 21.0975, price: 1200, cap: 9000 };
const EV = await mkRace('VHM Waiver Edition', 'RK Beach', [K10, K21]);
const EV2 = await mkRace('Other Waiver Run', 'Paderu', [K10]);
const EVP = await mkRace('Paging Run', 'Stadium', [K10]);
const EVL = await mkRace('Left Run', 'Stadium', [K10]);
const EVN = await mkRace('Bare Run', 'Stadium', [K10]);
const Q = 'I agree to the waiver';
const FORM = (ans) => JSON.stringify([{ name: 'Gender', value: 'F' }, { name: Q, value: ans }]);
const regId = (ev, key) => 'REG~' + ev.slice(-6) + '~' + key;
const reg = (ev, p) => wd.insert('RDRegs', { _id: regId(ev, p.key || p.bib), event: ev, name: p.name, cat: p.cat || '10 K', bib: p.bib || '', bibName: '', size: 'M', status: p.status || 'ok', phone: p.phone || '', email: p.email || '', form: p.noform ? '[]' : FORM(p.ans === undefined ? '' : p.ans), at: '2027-01-05T08:00:00.000Z' }, SA);
const EVIL1 = '<img src=x onerror="window.__pwn=1">Eve';
const EVIL2 = '=HYPERLINK("http://evil","click")';
const EVIL3 = 'Zed & "Sons" <b>bold</b>';
const PPL = [
  { bib: '101', name: 'Asha Rao', ans: 'Yes', email: 'asha@example.com', phone: '9812300101' },
  { bib: '102', name: 'BINA RAO', ans: 'yes.', email: 'bina@example.com', phone: '9812300102' },
  { bib: '103', name: 'Chitra Devi', ans: 'No', email: 'chitra@example.com', phone: '9812300103' },
  { bib: '104', name: 'Dev Raman', ans: '', email: '', phone: '9812300104' },
  { bib: '105', name: 'Esha Nair', ans: 'I agree', cat: '21 K', email: 'esha@example.com', phone: '' },
  { bib: '106', name: 'Farah Khan', noform: true, cat: '21 K', email: 'farah@example.com', phone: '9812300106' },
  { bib: '1', name: EVIL1, ans: '', email: 'eve@example.com', phone: '9812300107' },
  { bib: '2', name: EVIL2, ans: '', email: 'f@example.com', phone: '9812300301' },
  { bib: '3', name: EVIL3, ans: '', email: 'zed@example.com', phone: '9812300302' },
  { key: 'nina', bib: '', name: 'Nina Nobib', ans: '', email: 'nina@example.com', phone: '9812300999' },
  { bib: '111', name: 'Unpaid Uma', ans: 'yes', status: 'pending', email: 'uma@example.com', phone: '9812300111' },
];
for (const p of PPL) await reg(EV, p);
await reg(EV2, { bib: '101', name: 'Other Race Olga', ans: 'yes', email: 'olga@example.com', phone: '9812300777' });
for (let i = 0; i < 130; i++) await reg(EVP, { bib: String(1000 + i), name: 'Runner ' + (1000 + i), ans: i % 2 ? 'yes' : '', email: 'r' + i + '@example.com', phone: '98123' + String(i).padStart(5, '0') });
for (let i = 0; i < 20; i++) await reg(EVL, { bib: String(3000 + i), name: 'Left Runner ' + i, ans: '', email: 'l' + i + '@example.com', phone: '98123' + String(70000 + i) });
const vol = (ev, n, name, status, waiver) => wd.insert('RDVolunteers', { _id: 'VOL~' + ev.slice(-6) + '~' + n, event: ev, name, phone: '98123005' + String(n).padStart(2, '0'), email: 'vol' + n + '@example.com', club: '', status, code: 'C' + n, waiverAt: waiver ? '2027-01-03T09:00:00.000Z' : '', waiverVersion: waiver ? 'v1' : '', createdAt: new Date().toISOString(), notes: '' }, SA);
await vol(EV, 1, 'Vol One', 'approved', true);
await vol(EV, 2, 'Vol Two', 'applied', false);
await vol(EV, 3, 'Vol Three', 'declined', true);
await vol(EV, 4, 'Vol Four', 'approved', false);
await vol(EV2, 5, 'Vol Other', 'approved', false);
const ID = (key) => regId(EV, key);
const VID = (n) => 'VOL~' + EV.slice(-6) + '~' + n;
// what must never reach a screen or a paper: an address or a phone number of a person
const PII = /@example\.com|98123\d{5}|0891234567/;
const T1 = { title: 'Waiver for {race}', text: 'I agree to take part in {race} on {date} at {venue} at my own risk. I am {name}, bib {bib}, {cat}. <img src=x onerror="window.__pwn=1">' };
const TEXT = (n) => ({ title: 'Waiver for {race} (' + n + ')', text: 'I agree to take part in {race} on {date} at {venue} at my own risk, wording number ' + n + '. I am {name}, bib {bib}, {cat}.' });
// the other races: a saved text and a setup, made on the server so the screens start from them
await WV.wvSaveSettings({ token: OT, ev: EVP, question: Q, accept: ['yes'], formVersion: 1, minVersion: 1 });
await WV.wvSaveText(Object.assign({ token: OT, ev: EVP, base: 0 }, TEXT('P')));
await WV.wvSaveText(Object.assign({ token: OT, ev: EVL, base: 0 }, TEXT('L')));

/* ---------- a page, the way a browser would run it ---------- */
function openPage(opts) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const d = w.document;
  try {
    w.localStorage.setItem('rd.ev', (opts && opts.ev) || EV);
  } catch (x) {
    // no storage: the page opens on the first race
  }
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => 'blob:test';
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
    const mod = m.mod || 'rd';
    const rec = { method: m.method, mod, arg: m.arg };
    calls.push(rec);
    P.calls.push(rec);
    const track = mod === 'wv' || mod === 'comms';
    const reply = (o) => {
      if (track) REPL[mod]++;
      w.postMessage(Object.assign({ kind: 'result', id: m.id }, o), '*');
    };
    if (track && OLD[mod]) return reply({ ok: false, error: 'page_code_old' });
    const f = track ? FAIL.get(m.method) : null;
    if (f) {
      if (f.skip > 0) f.skip--;
      else {
        FAIL.delete(m.method);
        return reply({ ok: false, error: f.code });
      }
    }
    const lib = mod === 'wv' ? WV : mod === 'comms' ? CM : R;
    try {
      if (m.method === 'wvRecord') skew = 0;
      const r = await lib[m.method](m.arg);
      let out = JSON.parse(JSON.stringify(r === undefined ? null : r));
      if (track) {
        const dl = DELAY.get(m.method);
        if (dl && dl.length) await sleep(dl.shift());
        const tp = TAMPER.get(m.method);
        if (tp) out = tp(out) || out;
      }
      reply({ ok: true, result: out });
    } catch (x) {
      reply({ ok: false, error: x.message });
    }
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
  while (Date.now() - t < (ms || 4000)) {
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
const login = async (user, opts) => {
  const P = openPage(opts);
  await sleep(40);
  set(P.w, q(P.d, '#lgUser'), user);
  set(P.w, q(P.d, '#lgPass'), pw[user]);
  submit(P.w, q(P.d, '#loginForm'));
  await until(() => q(P.d, '.tab'));
  return P;
};
const tabBtn = (d, t) => q(d, `[data-tab="${t}"]`);
const content = (d) => txt(q(d, '.content'));
const wvc = (m) => calls.filter((c) => c.mod === 'wv' && (!m || c.method === m));
const cmc = (m) => calls.filter((c) => c.mod === 'comms' && (!m || c.method === m));
const act = (d, a, extra) => q(d, `[data-act="${a}"]${extra || ''}`);
const label = (d, a) => txt(act(d, a));
// every call has been answered and drawn, and nothing new was asked for a moment
const settle = async (ms) => {
  let last = -1;
  let stable = 0;
  const t = Date.now();
  while (Date.now() - t < (ms || 10000)) {
    const n = wvc().length + cmc().length;
    if (n === last && REPL.wv + REPL.comms >= n) {
      if (++stable >= 4) return;
    } else stable = 0;
    last = n;
    await sleep(20);
  }
};
const listText = (d) => txt(q(d, '#wvList'));
const listReady = (d) => /Showing \d+ to \d+ of \d+|Nobody matches these choices/.test(listText(d)) && !/Loading\.\.\./.test(listText(d));
const listTable = (d) => qa(d, '#wvList table').find((t) => /\bName\b/.test(txt(t.rows[0])));
const people = (d) => {
  const t = listTable(d);
  return t ? [...t.rows].slice(1).map((tr) => [...tr.cells].map(txt)) : [];
};
const namesOf = (d, vols) => people(d).map((r) => r[vols ? 1 : 2]);
const pager = (d) => txt(q(d, '#wvList [role="status"]'));
const findSel = (d, n) => q(d, `#wvFindForm [name="${n}"]`);
const optsOf = (el) => [...el.options].map((o) => o.textContent);
const pickBox = (d, id) => q(d, `.wv-pick[data-id="${id}"]`);
const recBtn = (d) => act(d, 'wv-rec');
const barText = (d) => txt(q(d, '#wvBar'));
const sumText = (d) => txt(q(d, '#wvSum'));
const subs = (d) => qa(d, '[data-act="wv-sub"]').map(txt);
const openTab = async (P) => {
  const n = wvc('wvOverview').length;
  clearToast(P.d);
  click(P.w, tabBtn(P.d, 'wv'));
  await until(() => wvc('wvOverview').length > n);
  await until(() => q(P.d, '#wvFindForm') || /Try again/.test(content(P.d)));
  await until(() => !q(P.d, '#wvFindForm') || listReady(P.d));
  await settle();
};
const subTo = async (P, id) => {
  click(P.w, act(P.d, 'wv-sub', `[data-sub="${id}"]`));
  await settle();
};
// changes a choice of the "People" form and waits for the new list
const pick = async (P, name, value) => {
  const n = wvc('wvList').length;
  change(P.w, findSel(P.d, name), value);
  await until(() => wvc('wvList').length > n);
  await until(() => listReady(P.d));
  await settle();
};
const search = async (P, text) => {
  const n = wvc('wvList').length;
  set(P.w, findSel(P.d, 'q'), text);
  submit(P.w, q(P.d, '#wvFindForm'));
  await until(() => wvc('wvList').length > n);
  await until(() => listReady(P.d));
  await settle();
};
const tickAll = (P, ids) => ids.forEach((id) => tick(P.w, pickBox(P.d, id), true));
// the Record button: the first press asks "Sure?", the second does it
const confirmRec = async (P) => {
  click(P.w, recBtn(P.d));
  click(P.w, recBtn(P.d));
  await settle();
  await until(() => listReady(P.d));
  await settle();
};
const switchRace = async (P, ev) => {
  const n = wvc('wvOverview').length;
  change(P.w, q(P.d, '#evPick'), ev);
  await until(() => wvc('wvOverview').length > n);
  await until(() => q(P.d, '#wvFindForm') || /Try again/.test(content(P.d)));
  await settle();
};
const noPii = (d, msg) => {
  const h = d.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '');
  const m = PII.exec(h);
  ok(!m, msg + (m ? ' [found near: ' + h.slice(Math.max(0, m.index - 80), m.index + 60).replace(/\s+/g, ' ') + ']' : ''));
};
// nothing typed in as a name ever became markup on the screen
const noMarkup = (P, msg) => {
  const { d, w } = P;
  const live = [w.__pwn, qa(d, '[onerror], [onclick], [onload]').length, qa(d, '.content img, .content iframe, .content object, .content embed, .content script, .content a[href^="javascript"]').length];
  eq(live, [undefined, 0, 0], msg);
};
const docs = () => printed.filter((p) => p !== 'PRINT');
const forms = (h) => (h.match(/class="wf"/g) || []).length;

/* ---------- U1. who sees the tab ---------- */
const A = await login('owner');
{
  const { d } = A;
  const t = tabBtn(d, 'wv');
  ok(!!t && txt(t) === 'Waivers', 'U1 a director has a "Waivers" tab');
  ok(/Volunteers\s+Messages\s+Waivers\s+Pacers/.test(txt(q(d, '.side'))), 'U1 it sits in the People group of the side menu, after Messages');
  await openTab(A);
  eq(subs(d), ['Who has signed', 'Waiver text', 'Print papers', 'Setup'], 'U1 the director gets four sections');
  ok(q(d, '[role="tablist"][aria-label="Waiver sections"]') !== null, 'U1 the sections are a labelled tab list');
  const first = wvc('wvOverview')[0];
  ok(!!first && first.arg.ev === EV && first.arg.token.length >= 20, 'U1 the overview was asked for the selected race, with the login token');
  ok(wvc().length > 0 && wvc().every((c) => c.mod === 'wv'), 'U1 every call of the tab is tagged for the Waivers side of the page code');
}
const L1 = await login('lead.one');
{
  const { d } = L1;
  ok(!!tabBtn(d, 'wv') && txt(tabBtn(d, 'wv')) === 'Waivers', 'U1 a lead has the tab too');
  await openTab(L1);
  eq(subs(d), ['Who has signed', 'Waiver text', 'Print papers'], 'U1 a lead gets three sections, no "Setup"');
  ok(/You can see who has signed, print papers and record a paper that was signed\. Directors change the text and the setup, and mark a record as a mistake\./.test(content(d)), 'U1 and is told what a director does');
  ok(!q(d, '#wvSetForm') && !q(d, '#wvTextForm'), 'U1 and has no form to change the setup or the text');
}
const V1 = await login('view.one');
ok(!tabBtn(V1.d, 'wv'), 'U1 a viewer has no Waivers tab');
ok(!/Waivers/.test(txt(q(V1.d, '.side'))), 'U1 a viewer sees nothing about it in the menu');
ok(V1.calls.every((c) => c.mod !== 'wv'), 'U1 and the viewer\'s page never called the Waivers server');

/* ---------- U2. the first screen: no text, no setup ---------- */
{
  const { d } = A;
  const f = q(d, '#wvFindForm');
  eq(['who', 'filter', 'cat', 'q'].map((n) => !!f.elements.namedItem(n)), [true, true, true, true], 'U2 the form has who, show, category and a search');
  eq(optsOf(findSel(d, 'who')), ['Runners (paid)', 'Volunteers'], 'U2 runners or volunteers');
  eq(optsOf(findSel(d, 'filter')), ['Still to sign', 'Not signed at all', 'Signed an older version only', 'Signed', 'Everyone'], 'U2 five ways to look at the list');
  eq(optsOf(findSel(d, 'cat')), ['All categories', '10 K', '21 K'], 'U2 the categories of the race');
  ok(/Runners \(paid\) 10 people 0 signed 10 not signed/.test(sumText(d)), 'U2 ten paid runners, none has signed (the unpaid one is not counted): ' + sumText(d).slice(0, 120));
  ok(/No question of the registration form is set as the waiver yet, so only papers recorded here count\. Directors can set it in Setup\./.test(sumText(d)), 'U2 and the page says that no question of the form is the waiver yet');
  ok(/10 K 8 0 0 8 21 K 2 0 0 2/.test(sumText(d)), 'U2 each category: 10 K has 8 runners, 21 K has 2');
  ok(/Volunteers \(not declined\) 3 people 1 signed 2 not signed 1 on the sign-up page/.test(sumText(d)), 'U2 three volunteers (the declined one is not counted), one signed on the sign-up page');
  eq(namesOf(d), [EVIL1, EVIL2, EVIL3, 'Asha Rao', 'BINA RAO', 'Chitra Devi', 'Dev Raman', 'Esha Nair', 'Farah Khan', 'Nina Nobib'], 'U2 "Still to sign" is all ten, in bib order, the one with no bib last; the markup in names is text');
  ok(pager(d) === 'Showing 1 to 10 of 10', 'U2 "Showing 1 to 10 of 10": ' + pager(d));
  eq(people(d)[9].slice(1, 5), ['-', 'Nina Nobib', '10 K', 'Not signed'], 'U2 a runner without a bib has a dash, and has not signed');
  ok(qa(d, '[data-act="wv-page"]').length === 2 && qa(d, '[data-act="wv-page"]').every((b) => b.disabled), 'U2 there is no previous and no next page for ten people');
  ok(qa(d, '.wv-pick').length === 10, 'U2 everyone who has not signed has a box to tick');
  noMarkup(A, 'U2 the names that are markup made no picture, no handler and ran nothing');
  ok(/Save the waiver text first \(Waiver text\)\. Papers are recorded against a saved version\./.test(barText(d)), 'U2 the Record box says to save the waiver text first');
  ok(label(d, 'wv-rec') === 'Record 0 papers as signed' && recBtn(d).disabled, 'U2 and the Record button is off');
  tick(A.w, pickBox(d, ID('103')), true);
  ok(label(d, 'wv-rec') === 'Record 1 paper as signed' && recBtn(d).disabled, 'U2 ticking one person says "1 paper" (singular), and the button stays off until a text is saved');
  tick(A.w, pickBox(d, ID('103')), false);
  ok(label(d, 'wv-rec') === 'Record 0 papers as signed', 'U2 un-ticking takes it back');
  noPii(d, 'U2 the screen holds no address or phone number');
}

/* ---------- U3. the text of the waiver ---------- */
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const verRows = (ev) => rows('RDWaivers').filter((r) => r.kind === 'ver' && r.event === (ev || EV));
const textIn = (d) => q(d, '#wvTextForm').elements.namedItem('text');
const titleIn = (d) => q(d, '#wvTextForm').elements.namedItem('title');
const saveLabel = (d) => txt(q(d, '#wvTextForm [type="submit"]'));
const verTable = (d) => qa(d, '.content table').find((t) => /Characters/.test(txt(t.rows[0])));
const verLines = (d) => [...verTable(d).rows].slice(1).map((tr) => [...tr.cells].map(txt));
const saveText = async (P) => {
  const n = wvc('wvSaveText').length;
  clearToast(P.d);
  submit(P.w, q(P.d, '#wvTextForm'));
  await until(() => wvc('wvSaveText').length > n);
  await settle();
};
const typeText = (P, title, text) => {
  set(P.w, titleIn(P.d), title);
  set(P.w, textIn(P.d), text);
};
{
  const { d, w } = A;
  await subTo(A, 'text');
  ok(/No text has been saved yet\. Edit the standard wording below and save it as version 1\./.test(content(d)), 'U3 before any text: the page says none has been saved');
  eq([titleIn(d).value, textIn(d).value], [W.STARTER_TITLE, W.STARTER_TEXT], 'U3 the standard wording is in the form to start from');
  eq([titleIn(d).maxLength, textIn(d).maxLength], [80, 8000], 'U3 the form allows 80 characters for the title and 8,000 for the text');
  ok(saveLabel(d) === 'Save as version 1' && !act(d, 'wv-latest') && !!act(d, 'wv-starter'), 'U3 the button says "Save as version 1"; there is no "Back to the latest saved" yet');
  ok(/\{race\} \{date\} \{venue\} \{name\} \{bib\} \{cat\}/.test(content(d)), 'U3 the words that are filled in on each paper are listed');
  ok(!/Saved versions/.test(content(d)), 'U3 there is no list of versions yet');
  ok(norm(content(d)).includes(norm(W.volunteerWaiverText('VHM Waiver Edition'))) && /Volunteer waiver/.test(content(d)) && /fixed in the software/.test(content(d)), 'U3 the volunteer waiver is shown, as it is fixed');
  // typing and going back to the standard wording
  typeText(A, 'Something else', 'Typed words that are long enough to be a waiver.');
  click(w, act(d, 'wv-starter'));
  eq([titleIn(d).value, textIn(d).value], [W.STARTER_TITLE, W.STARTER_TEXT], 'U3 "Use the standard wording" puts it back');
  // the first version (a text with markup in it)
  typeText(A, T1.title, T1.text);
  await saveText(A);
  ok(toastOf(d) === 'Saved as version 1', 'U3 saving says "Saved as version 1": ' + toastOf(d));
  const sent = wvc('wvSaveText').pop().arg;
  eq([sent.title, sent.text, sent.base], [T1.title, T1.text, 0], 'U3 the server was sent the title, the text and "version 0 is what I saw"');
  eq(verRows().length, 1, 'U3 one version is saved');
  const v1 = JSON.parse(verRows()[0].json);
  ok(!/[<>]/.test(v1.text) && /img src=x onerror=/.test(v1.text), 'U3 the angle brackets of the text were taken out on the server');
  eq([textIn(d).value, titleIn(d).value], [v1.text, v1.title], 'U3 the form now shows what was saved');
  ok(saveLabel(d) === 'Save as version 2' && !!act(d, 'wv-latest') && /The latest is version 1\s*\./.test(content(d)), 'U3 the button now says "Save as version 2" and "Back to the latest saved" is there');
  eq(verLines(d).map((l) => l.slice(0, 4)), [['1', T1.title, String(v1.text.length), 'owner']], 'U3 the list of versions has it: version, title, characters, who');
  ok(verLines(d)[0][4].length > 4, 'U3 with the time');
  // looking at an older version
  click(w, act(d, 'wv-view', '[data-id="1"]'));
  await settle();
  ok(/Version 1: Waiver for \{race\}/.test(content(d)) && qa(d, '.content pre').some((p) => p.textContent === v1.text), 'U3 "Show" opens version 1 in full');
  eq(wvc('wvText').pop().arg.ver, 1, 'U3 by asking the server for version 1');
  noMarkup(A, 'U3 the markup of the text made no picture and ran nothing');
  click(w, act(d, 'wv-view-close'));
  ok(!/Version 1: Waiver for \{race\}/.test(content(d)), 'U3 "Close" hides it');
  // another director saves version 2 while this one is typing
  typeText(A, 'Typed by the first director', TEXT('A-typed').text);
  const T2 = TEXT(2);
  await WV.wvSaveText({ token: TB, ev: EV, base: 1, title: T2.title, text: T2.text });
  await saveText(A);
  ok(/Somebody saved a newer version while you were typing\. Your text is kept/.test(toastOf(d)), 'U3 saving on top of a version somebody else made is refused, and says so: ' + toastOf(d).slice(0, 80));
  eq([titleIn(d).value, textIn(d).value], ['Typed by the first director', TEXT('A-typed').text], 'U3 and the typed text is still in the form');
  eq(verRows().map((r) => JSON.parse(r.json).title), [T1.title.replace(/[<>]/g, ''), T2.title], 'U3 nothing of it was saved: version 2 is the other director\'s');
  await subTo(A, 'status');
  await subTo(A, 'text');
  eq([titleIn(d).value, textIn(d).value], ['Typed by the first director', TEXT('A-typed').text], 'U3 going to another section and back keeps the typed text');
  ok(saveLabel(d) === 'Save as version 3' && /The latest is version 2\s*\./.test(content(d)) && verLines(d).map((l) => l[0]).join() === '2,1', 'U3 and shows the new version: "Save as version 3", newest first');
  click(w, act(d, 'wv-latest'));
  eq([titleIn(d).value, textIn(d).value], [T2.title, T2.text], 'U3 "Back to the latest saved" gives version 2 back');
  // the third version
  const T3 = { title: 'Waiver for {race} (final)', text: TEXT(3).text };
  typeText(A, T3.title, T3.text);
  await saveText(A);
  ok(toastOf(d) === 'Saved as version 3' && verRows().length === 3 && verLines(d).map((l) => l[0]).join() === '3,2,1', 'U3 now it is saved as version 3: ' + toastOf(d));
  // the same again
  await saveText(A);
  ok(/That is the same as the latest version\. Change something first\./.test(toastOf(d)) && verRows().length === 3, 'U3 saving the same text again is refused and no version is made: ' + toastOf(d));
  // what the server refuses leaves the typed text where it is
  const before = JSON.stringify(verRows());
  const BAD = [
    ['short', T3.title, /The waiver needs a title and some text \(at least 20 characters\)\./, 'a text that is too short'],
    [T3.text + ' more words here', '', /The waiver needs a title and some text/, 'no title'],
    ['You give me your {phone} number, which is not allowed here.', T3.title, /uses a word in curly brackets that does not exist/, 'a word in curly brackets that does not exist'],
    ['x'.repeat(8001), T3.title, /The waiver is too long: 80 characters for the title and 8,000 for the text\./, 'a text of 8,001 characters'],
  ];
  for (const [text, title, re, what] of BAD) {
    typeText(A, title, text);
    await saveText(A);
    ok(re.test(toastOf(d)), 'U3 ' + what + ' is refused with its own message: ' + toastOf(d).slice(0, 70));
    eq([titleIn(d).value, textIn(d).value], [title, text], 'U3 and the typed text is still there (' + what + ')');
  }
  eq(JSON.stringify(verRows()), before, 'U3 nothing was written by any of those');
  click(w, act(d, 'wv-latest'));
  eq([titleIn(d).value, textIn(d).value], [T3.title, T3.text], 'U3 "Back to the latest saved" gives version 3');
  noPii(d, 'U3 the screen holds no address or phone number');
}
{
  // a lead can read the text, and the versions, but not change them
  const { d, w } = L1;
  await subTo(L1, 'text');
  ok(!q(d, '#wvTextForm') && !act(d, 'wv-starter') && !act(d, 'wv-latest'), 'U3 a lead has no form for the text');
  ok(/Version 3: Waiver for \{race\} \(final\)/.test(content(d)) && qa(d, '.content pre').some((p) => norm(p.textContent) === norm(TEXT(3).text)), 'U3 but reads the latest version in full');
  eq(verLines(d).map((l) => l[0]), ['3', '2', '1'], 'U3 and sees the three versions');
  click(w, act(d, 'wv-view', '[data-id="1"]'));
  await settle();
  ok(/Version 1: Waiver for \{race\}/.test(content(d)), 'U3 and can open an older one');
  noMarkup(L1, 'U3 the lead\'s screen made no picture from the markup either');
}

/* ---------- U4. the setup: which question of the registration form is the waiver ---------- */
const setForm = (d) => q(d, '#wvSetForm');
const setEl = (d, n) => setForm(d).elements.namedItem(n);
const setRows = () => rows('RDWaivers').filter((r) => r.kind === 'set' && r.event === EV);
const saveSetup = async (P) => {
  const n = wvc('wvSaveSettings').length;
  clearToast(P.d);
  submit(P.w, setForm(P.d));
  await until(() => wvc('wvSaveSettings').length > n);
  await settle();
};
{
  const { d, w } = A;
  await subTo(A, 'set');
  eq(optsOf(setEl(d, 'question')), ['None: the waiver is not on the form', 'Gender (10 answered)', 'I agree to the waiver (5 answered)'], 'U4 the questions of the registration form are offered, with how many answered');
  eq(optsOf(setEl(d, 'formVersion')), ['Version 1', 'Version 2', 'Version 3'], 'U4 the form can show any of the three saved versions');
  eq(optsOf(setEl(d, 'minVersion')), ['Version 1', 'Version 2', 'Version 3'], 'U4 and any of them can be the lowest that counts');
  eq(['question', 'formVersion', 'minVersion', 'accept'].map((n) => setEl(d, n).value), ['', '1', '1', W.defaultSettings().accept.join('\n')], 'U4 at first: no question, version 1 twice, and the usual answers (yes, i agree, ...) ready');
  ok(/No question set/.test(content(d)) && /How this works/.test(content(d)), 'U4 "No question set", and a short help');
  eq(setRows().length, 0, 'U4 nothing is saved yet');
  change(w, setEl(d, 'question'), Q);
  set(w, setEl(d, 'accept'), 'Yes\nI agree\n   \n');
  await saveSetup(A);
  const a = wvc('wvSaveSettings').pop().arg;
  eq([a.question, a.accept, a.formVersion, a.minVersion], [Q, ['Yes', 'I agree'], 1, 1], 'U4 the server was sent the question, the answers (blank lines dropped) and two whole numbers');
  ok(toastOf(d) === 'Setup saved', 'U4 saving says "Setup saved": ' + toastOf(d));
  eq((await WV.wvOverview({ token: OT, ev: EV })).settings, { question: Q, accept: ['yes', 'i agree'], formVersion: 1, minVersion: 1 }, 'U4 the answers are kept in a plain way');
  eq([setEl(d, 'question').value, setEl(d, 'accept').value], [Q, 'yes\ni agree'], 'U4 and the form shows the setup that was saved');
  ok(/3 of 10 paid runners count as signed on the form/.test(content(d)), 'U4 three of the ten paid runners count as signed on the form: ' + content(d).slice(0, 200));
  eq(setRows().length, 1, 'U4 one row holds the setup');
  // what the server refuses leaves the typed answers where they are
  const before = JSON.stringify(setRows());
  set(w, setEl(d, 'accept'), new Array(13).fill('').map((x, i) => 'answer' + i).join('\n'));
  await saveSetup(A);
  ok(/Check the setup: a question of the form, up to 12 answers, and versions that exist\./.test(toastOf(d)), 'U4 thirteen answers are refused: ' + toastOf(d).slice(0, 60));
  eq(setEl(d, 'accept').value.split('\n').length, 13, 'U4 and the typed answers are still there');
  set(w, setEl(d, 'accept'), 'yes\ni agree');
  change(w, setEl(d, 'formVersion'), '9');
  await saveSetup(A);
  ok(/Check the setup/.test(toastOf(d)), 'U4 a version that does not exist is refused: ' + toastOf(d).slice(0, 60));
  eq(JSON.stringify(setRows()), before, 'U4 nothing was written by either');
  change(w, setEl(d, 'formVersion'), '1');
  noPii(d, 'U4 the screen holds no address or phone number');
}

/* ---------- U5. who has signed ---------- */
{
  const { d, w } = A;
  await subTo(A, 'status');
  ok(/Runners \(paid\) 10 people 3 signed 7 not signed 3 on the registration form/.test(sumText(d)), 'U5 three have signed on the form: ' + sumText(d).slice(0, 120));
  ok(!/No question of the registration form is set/.test(sumText(d)) && /10 K 8 2 0 6 21 K 2 1 0 1/.test(sumText(d)), 'U5 and the numbers of each category follow: ' + sumText(d).slice(0, 250));
  eq(namesOf(d), [EVIL1, EVIL2, EVIL3, 'Chitra Devi', 'Dev Raman', 'Farah Khan', 'Nina Nobib'], 'U5 "Still to sign" is the seven who have not');
  ok(pager(d) === 'Showing 1 to 7 of 7', 'U5 "Showing 1 to 7 of 7": ' + pager(d));
  await pick(A, 'filter', 'all');
  eq(namesOf(d).length, 10, 'U5 "Everyone" is ten');
  eq(people(d).filter((r) => r[4] !== 'Not signed').map((r) => [r[2], r[4]]), [['Asha Rao', 'Signed, version 1 on the registration form'], ['BINA RAO', 'Signed, version 1 on the registration form'], ['Esha Nair', 'Signed, version 1 on the registration form']], 'U5 a signature on the form says which version and where (any case, with or without a full stop)');
  await pick(A, 'filter', 'signed');
  eq(namesOf(d), ['Asha Rao', 'BINA RAO', 'Esha Nair'], 'U5 "Signed" is those three');
  ok(qa(d, '.wv-pick').length === 0, 'U5 and nobody who has signed has a box to tick');
  await pick(A, 'filter', 'none');
  eq(namesOf(d).length, 7, 'U5 "Not signed at all" is the seven');
  await pick(A, 'filter', 'older');
  ok(namesOf(d).length === 0 && pager(d) === 'Nobody matches these choices.', 'U5 nobody has signed only an older version yet: ' + pager(d));
  await pick(A, 'filter', 'all');
  await pick(A, 'cat', '21 K');
  eq(namesOf(d), ['Esha Nair', 'Farah Khan'], 'U5 one category');
  eq(JSON.stringify(wvc('wvList').pop().arg), JSON.stringify({ token: wvc('wvList').pop().arg.token, ev: EV, who: 'runners', filter: 'all', from: 0, cat: '21 K' }), 'U5 and the server is asked for exactly that');
  await pick(A, 'cat', '');
  ok(!('cat' in wvc('wvList').pop().arg), 'U5 "All categories" sends no category');
  await search(A, 'rao');
  eq(namesOf(d), ['Asha Rao', 'BINA RAO'], 'U5 a search finds part of a name, in any case');
  await search(A, '103');
  eq(namesOf(d), ['Chitra Devi'], 'U5 and a bib');
  await search(A, '<b>x');
  ok(namesOf(d).length === 0 && !/Something went wrong/.test(toastOf(d)) && pager(d) === 'Nobody matches these choices.', 'U5 a search made of markup finds nobody and breaks nothing');
  await search(A, 'a'.repeat(100));
  eq(wvc('wvList').pop().arg.q.length, 40, 'U5 a search is cut to 40 characters before it is sent');
  await search(A, '');
  ok(namesOf(d).length === 10 && !('q' in wvc('wvList').pop().arg), 'U5 an empty search is everyone, and sends no search');
  noMarkup(A, 'U5 the names that are markup are text in every list');
  eq(namesOf(d).slice(0, 3), [EVIL1, EVIL2, EVIL3], 'U5 (they are shown as typed)');
  ok(qa(d, '#wvList [data-act="wv-recs"]').length === 10 && qa(d, '#wvList [data-act="wv-print-one"]').length === 10, 'U5 each line has "Records" and "Print paper"');
  // volunteers
  await pick(A, 'who', 'volunteers');
  ok(!findSel(d, 'cat'), 'U5 volunteers have no category to choose');
  eq(people(d).map((r) => [r[1], r[2], r[3]]), [['Vol Four', 'approved', 'Not signed'], ['Vol One', 'approved', 'Signed, version 1 on the sign-up page'], ['Vol Two', 'applied', 'Not signed']], 'U5 the volunteers who are not declined, with their status and where they stand');
  ok(/Volunteers/.test(txt(q(d, '#wvList h3'))) && /They sign the volunteer waiver\./.test(barText(d)) && !q(d, '#wvRecForm [name="ver"]'), 'U5 a volunteer paper has no version to choose');
  await pick(A, 'filter', 'todo');
  eq(namesOf(d, true), ['Vol Four', 'Vol Two'], 'U5 volunteers who still have to sign');
  eq(wvc('wvList').pop().arg.who, 'volunteers', 'U5 the server is asked about volunteers');
  await pick(A, 'who', 'runners');
  ok(!!findSel(d, 'cat') && findSel(d, 'cat').value === '' && namesOf(d).length === 7, 'U5 back to runners the category is back at "All categories": 7 still to sign');
  // an answer that comes back late does not overwrite a newer one
  DELAY.set('wvList', [600]);
  const n0 = wvc('wvList').length;
  change(w, findSel(d, 'filter'), 'signed');
  change(w, findSel(d, 'filter'), 'all');
  await until(() => wvc('wvList').length >= n0 + 2);
  await until(() => namesOf(d).length === 10 && listReady(d));
  ok(REPL.wv < wvc().length && pager(d) === 'Showing 1 to 10 of 10', 'U5 two quick changes show the second one while the first is still on its way: ' + pager(d));
  await settle();
  ok(namesOf(d).length === 10 && pager(d) === 'Showing 1 to 10 of 10', 'U5 the slow answer for the first one arrived and was dropped');
  await pick(A, 'filter', 'todo');
  // the lowest version that counts: a new text that everybody has to sign again
  await subTo(A, 'set');
  change(w, setEl(d, 'minVersion'), '2');
  await saveSetup(A);
  ok(toastOf(d) === 'Setup saved', 'U5 the lowest version that counts is raised to 2');
  await subTo(A, 'status');
  ok(/Runners \(paid\) 10 people 0 signed 3 signed an older version only 7 not signed/.test(sumText(d)), 'U5 the three who signed version 1 on the form are now "signed an older version only": ' + sumText(d).slice(0, 140));
  eq(namesOf(d).length, 10, 'U5 and everyone has to sign again, so "Still to sign" is all ten');
  await pick(A, 'filter', 'older');
  eq(people(d).map((r) => [r[2], r[4]]), [['Asha Rao', 'Only version 1 on the registration form'], ['BINA RAO', 'Only version 1 on the registration form'], ['Esha Nair', 'Only version 1 on the registration form']], 'U5 "Signed an older version only" lists them, and says which version');
  await subTo(A, 'set');
  change(w, setEl(d, 'minVersion'), '1');
  await saveSetup(A);
  ok(toastOf(d) === 'Setup saved', 'U5 and it is put back to 1');
  await subTo(A, 'status');
  await pick(A, 'filter', 'todo');
  eq(namesOf(d).length, 7, 'U5 seven have to sign again');
  noPii(d, 'U5 the screen holds no address or phone number');
}
{
  // a race of 130 runners: a hundred at a time
  const { d, w } = A;
  await switchRace(A, EVP);
  eq(optsOf(findSel(d, 'filter'))[0], 'Still to sign', 'U5 another race starts at "Still to sign"');
  ok(pager(d) === 'Showing 1 to 65 of 65', 'U5 half of its 130 runners have signed on the form, so 65 are to sign: ' + pager(d));
  await pick(A, 'filter', 'all');
  const next = () => qa(d, '[data-act="wv-page"]').find((b) => txt(b) === 'Next');
  const prev = () => qa(d, '[data-act="wv-page"]').find((b) => txt(b) === 'Previous');
  ok(namesOf(d).length === 100 && pager(d) === 'Showing 1 to 100 of 130' && !next().disabled && prev().disabled, 'U5 a page is a hundred people: "Showing 1 to 100 of 130", Next is on, Previous is off: ' + pager(d));
  tickAll(A, qa(d, '.wv-pick').slice(0, 2).map((b) => b.getAttribute('data-id')));
  ok(label(d, 'wv-rec') === 'Record 2 papers as signed', 'U5 two people are ticked');
  let n = wvc('wvList').length;
  click(w, next());
  await until(() => wvc('wvList').length > n && listReady(d));
  await settle();
  eq(wvc('wvList').pop().arg.from, 100, 'U5 Next asks for the people from number 100');
  ok(namesOf(d).length === 30 && pager(d) === 'Showing 101 to 130 of 130' && next().disabled && !prev().disabled, 'U5 the last page has the 30 that are left: ' + pager(d));
  ok(label(d, 'wv-rec') === 'Record 0 papers as signed', 'U5 and the ticks of the first page are gone');
  n = wvc('wvList').length;
  click(w, prev());
  await until(() => wvc('wvList').length > n && listReady(d));
  await settle();
  ok(wvc('wvList').pop().arg.from === 0 && pager(d) === 'Showing 1 to 100 of 130', 'U5 Previous goes back to the first page');
  n = wvc('wvList').length;
  click(w, next());
  await until(() => wvc('wvList').length > n && listReady(d));
  await settle();
  await pick(A, 'filter', 'todo');
  ok(wvc('wvList').pop().arg.from === 0 && pager(d) === 'Showing 1 to 65 of 65', 'U5 a new choice on the second page starts again from the first: ' + pager(d));
  await switchRace(A, EV);
  ok(namesOf(A.d).length === 7 && !/Runner 1/.test(content(A.d)), 'U5 back in the first race, with its own people');
}

/* ---------- U6. recording papers that were signed on the day ---------- */
const sigRowsOf = (ev, ref) => rows('RDWaivers').filter((r) => r.kind === 'sig' && (!ev || r.event === ev) && (!ref || r.ref === ref));
const verSel = (d) => q(d, '#wvRecForm [name="ver"]');
const noteEl = (d) => q(d, '#wvRecForm [name="note"]');
{
  const { d, w } = A;
  eq(optsOf(verSel(d)), ['Version 3 (Waiver for {race} (final))', 'Version 2 (Waiver for {race} (2))', 'Version 1 (Waiver for {race})'], 'U6 a paper is recorded against a saved version: the latest is offered first');
  eq(verSel(d).value, '3', 'U6 and is the one chosen');
  change(w, verSel(d), '1');
  tickAll(A, [ID('103')]);
  set(w, noteEl(d), 'at the desk');
  ok(label(d, 'wv-rec') === 'Record 1 paper as signed' && !recBtn(d).disabled, 'U6 one person ticked: "Record 1 paper as signed"');
  const n = wvc('wvRecord').length;
  click(w, recBtn(d));
  ok(label(d, 'wv-rec') === 'Sure? Record 1 paper' && wvc('wvRecord').length === n, 'U6 the first press asks "Sure? Record 1 paper" and sends nothing');
  click(w, recBtn(d));
  await settle();
  await until(() => listReady(d));
  await settle();
  eq(wvc('wvRecord').length, n + 1, 'U6 the second press sends one call');
  const a = wvc('wvRecord').pop().arg;
  eq([a.who, a.ids, a.note, a.ver], ['runners', [ID('103')], 'at the desk', 1], 'U6 for the runner, with the note and version 1');
  ok(toastOf(d) === '1 paper recorded', 'U6 "1 paper recorded": ' + toastOf(d));
  eq(namesOf(d).includes('Chitra Devi'), false, 'U6 she is no longer to sign');
  ok(/4 signed 6 not signed/.test(sumText(d)) && /1 on paper/.test(sumText(d)), 'U6 the numbers moved: four have signed, one of them on paper: ' + sumText(d).slice(0, 140));
  eq(sigRowsOf(EV, ID('103')).map((r) => [r.why, r.by, r.json, r.who]), [['at the desk', 'owner', '{"ver":1}', 'paper']], 'U6 one record of version 1 was kept, with the note and who made it');
  ok(label(d, 'wv-rec') === 'Record 0 papers as signed' && recBtn(d).disabled && noteEl(d).value === '', 'U6 the ticks and the note are cleared');
  // the "Sure?" is only for what was ticked when it was pressed
  tickAll(A, [ID('104')]);
  click(w, recBtn(d));
  ok(label(d, 'wv-rec') === 'Sure? Record 1 paper', 'U6 armed for one person');
  tickAll(A, [ID('106')]);
  ok(label(d, 'wv-rec') === 'Record 2 papers as signed', 'U6 ticking another person puts the button back to its first state');
  click(w, recBtn(d));
  ok(label(d, 'wv-rec') === 'Sure? Record 2 papers', 'U6 armed for two');
  change(w, verSel(d), '2');
  ok(label(d, 'wv-rec') === 'Record 2 papers as signed' && verSel(d).value === '2', 'U6 choosing another version does the same');
  change(w, verSel(d), '1');
  click(w, recBtn(d));
  click(w, act(d, 'wv-selclear'));
  ok(label(d, 'wv-rec') === 'Record 0 papers as signed' && qa(d, '.wv-pick').every((b) => !b.checked), 'U6 "Clear ticks" clears them, and the button is off');
  tickAll(A, [ID('104')]);
  click(w, recBtn(d));
  click(w, act(d, 'wv-selpage'));
  ok(label(d, 'wv-rec') === 'Record 6 papers as signed', 'U6 "Tick everyone on this page who has not signed" ticks the six (and the button is not armed)');
  click(w, act(d, 'wv-selclear'));
  eq(wvc('wvRecord').length, n + 1, 'U6 none of that sent anything');
  // a whole category at once, one of them left out
  await pick(A, 'cat', '10 K');
  eq(namesOf(d), [EVIL1, EVIL2, EVIL3, 'Dev Raman', 'Nina Nobib'], 'U6 the 10 K runners who have not signed');
  click(w, act(d, 'wv-selpage'));
  tick(w, pickBox(d, ID('nina')), false);
  ok(label(d, 'wv-rec') === 'Record 4 papers as signed', 'U6 ticking all and taking one off leaves four');
  await confirmRec(A);
  const b = wvc('wvRecord').pop().arg;
  eq([b.who, b.ids.length, 'note' in b, b.ver, b.ids.includes(ID('nina'))], ['runners', 4, false, 1, false], 'U6 one call for the four, with no note (the old one was cleared) and version 1');
  ok(toastOf(d) === '4 papers recorded', 'U6 "4 papers recorded": ' + toastOf(d));
  eq(namesOf(d), ['Nina Nobib'], 'U6 only Nina is left to sign in 10 K');
  await pick(A, 'cat', '');
  eq(namesOf(d), ['Farah Khan', 'Nina Nobib'], 'U6 two are left in the race: Farah and Nina');
  ok(/8 signed 2 not signed/.test(sumText(d)) && /5 on paper/.test(sumText(d)), 'U6 eight have signed, five on paper: ' + sumText(d).slice(0, 150));
  noPii(d, 'U6 the screen holds no address or phone number');
}
{
  // volunteers: the volunteer waiver, no version, and what the server says about the people it could not record
  const { d, w } = A;
  await pick(A, 'who', 'volunteers');
  tickAll(A, [VID(2)]);
  ok(label(d, 'wv-rec') === 'Record 1 paper as signed' && !recBtn(d).disabled, 'U6 a volunteer paper needs no text and no version');
  await confirmRec(A);
  const a = wvc('wvRecord').pop().arg;
  eq([a.who, a.ids, 'ver' in a, 'note' in a], ['volunteers', [VID(2)], false, false], 'U6 the call has no version and no note');
  ok(toastOf(d) === '1 paper recorded' && !namesOf(d, true).includes('Vol Two'), 'U6 recorded: ' + toastOf(d));
  await pick(A, 'filter', 'all');
  eq(people(d).filter((r) => r[1] === 'Vol Two').map((r) => r[3]), ['Signed, version 1 on paper'], 'U6 Vol Two has signed the volunteer waiver on paper');
  await pick(A, 'filter', 'todo');
  tickAll(A, [VID(4)]);
  await WV.wvRecord({ token: TB, ev: EV, who: 'volunteers', ids: [VID(4)] });
  await confirmRec(A);
  ok(toastOf(d) === '0 papers recorded, 1 had already signed', 'U6 somebody else recorded the same paper a moment before: "0 papers recorded, 1 had already signed": ' + toastOf(d));
  eq(sigRowsOf(EV, VID(4)).length, 1, 'U6 and there is still one record');
  ok(namesOf(d, true).length === 0 && pager(d) === 'Nobody matches these choices.', 'U6 nobody is left to sign');
  await pick(A, 'who', 'runners');
  // a runner who is no longer there when the button is pressed
  tickAll(A, [ID('106')]);
  const row = DB.RDRegs.get(ID('106'));
  row.status = 'pending';
  await confirmRec(A);
  row.status = 'ok';
  ok(toastOf(d) === '0 papers recorded, 1 not found', 'U6 a runner whose payment was taken back is "not found": ' + toastOf(d));
  eq(sigRowsOf(EV, ID('106')).length, 0, 'U6 and nothing was recorded for her');
  await pick(A, 'filter', 'todo');
  // two presses in a row record once
  tickAll(A, [ID('106')]);
  DELAY.set('wvRecord', [400]);
  const n = wvc('wvRecord').length;
  click(w, recBtn(d));
  click(w, recBtn(d));
  click(w, recBtn(d));
  click(w, recBtn(d));
  await settle();
  await until(() => listReady(d));
  await settle();
  eq(wvc('wvRecord').length, n + 1, 'U6 four quick presses on the button make one call');
  eq(sigRowsOf(EV, ID('106')).length, 1, 'U6 and one record');
  // a refused call: the server fails, nothing is kept, and the ticks are given up
  tickAll(A, [ID('nina')]);
  FAIL.set('wvRecord', { code: 'server_error' });
  await confirmRec(A);
  ok(/Something went wrong on the server\. Try again; if it keeps happening, tell the Race Director\./.test(toastOf(d)), 'U6 a failure is said in words: ' + toastOf(d));
  eq(sigRowsOf(EV, ID('nina')).length, 0, 'U6 and nothing was recorded');
  ok(namesOf(d).includes('Nina Nobib') && label(d, 'wv-rec') === 'Record 0 papers as signed', 'U6 she is still to sign and nothing is ticked');
}
{
  // a server that gets nowhere (every write fails): it gives everybody back and records nobody. The page asks once, says so and stops
  const { d, w } = A;
  tickAll(A, [ID('nina')]);
  failWrites = true;
  const n = wvc('wvRecord').length;
  await confirmRec(A);
  failWrites = false;
  eq(wvc('wvRecord').length, n + 1, 'U6 a server that records nobody and gives everybody back is asked once, not again and again');
  ok(/No answer from the server\. Try again\./.test(toastOf(d)), 'U6 the page says so in words: ' + toastOf(d));
  eq(sigRowsOf(EV, ID('nina')).length, 0, 'U6 and nothing was recorded');
  ok(namesOf(d).includes('Nina Nobib') && label(d, 'wv-rec') === 'Record 0 papers as signed', 'U6 she is still to sign and nothing is ticked');
}
{
  // a call that runs out of time on the server: the page sends the rest again
  const { d, w } = A;
  await switchRace(A, EVL);
  eq(namesOf(d).length, 20, 'U6 a race with twenty runners to sign');
  click(w, act(d, 'wv-selpage'));
  ok(label(d, 'wv-rec') === 'Record 20 papers as signed', 'U6 all twenty ticked');
  slowLeft = 5;
  const n = wvc('wvRecord').length;
  await confirmRec(A);
  slowLeft = 0;
  skew = 0;
  const sent = wvc('wvRecord').slice(n).map((c) => c.arg.ids.length);
  eq(sent, [20, 15], 'U6 the server did five, ran out of time and gave back fifteen: the page sent those again');
  ok(toastOf(d) === '20 papers recorded', 'U6 and says twenty were recorded: ' + toastOf(d));
  eq(sigRowsOf(EVL).length, 20, 'U6 twenty records, one for each');
  ok(namesOf(d).length === 0 && /20 signed 0 not signed/.test(sumText(d)), 'U6 nobody is left to sign: ' + sumText(d).slice(0, 80));
  await switchRace(A, EV);
}

/* ---------- U7. the records of a person, and a record that was a mistake ---------- */
const recPanel = (d) => qa(d, '#wvList table').find((t) => /Recorded by/.test(txt(t.rows[0])));
const recLines = (d) => (recPanel(d) ? [...recPanel(d).rows].slice(1).map((tr) => [...tr.cells].map(txt)) : []);
const openRecs = async (P, id) => {
  const n = wvc('wvRecords').length;
  click(P.w, act(P.d, 'wv-recs', `[data-id="${id}"]`));
  await until(() => wvc('wvRecords').length > n);
  await settle();
};
const voidBtn = (d) => act(d, 'wv-void');
const reasonEl = (d) => q(d, '#wvVoidForm [name="reason"]');
{
  const { d, w } = A;
  await pick(A, 'filter', 'all');
  await openRecs(A, ID('103'));
  eq(wvc('wvRecords').pop().arg.who + '/' + wvc('wvRecords').pop().arg.id, 'runners/' + ID('103'), 'U7 "Records" asks for the records of that runner');
  ok(/Papers of Chitra Devi \(bib 103\)/.test(content(d)) && /Signed, version 1 on paper/.test(txt(q(d, '#wvList'))), 'U7 the panel names the person and where she stands');
  eq(recLines(d).map((l) => l.slice(0, 4)), [['Version 1', 'on paper', 'at the desk', 'owner']], 'U7 one record: the version, how, the note, who made it');
  ok(!!voidBtn(d) && !!reasonEl(d), 'U7 a director can mark it as a mistake, and gives a reason');
  click(w, act(d, 'wv-recs', `[data-id="${ID('103')}"]`));
  ok(!/Papers of Chitra Devi/.test(content(d)), 'U7 pressing "Records" again closes the panel');
  await openRecs(A, ID('101'));
  ok(/Papers of Asha Rao \(bib 101\)/.test(content(d)) && /No paper has been recorded for this person\. A signature on the registration form or the sign-up page is not listed here\./.test(content(d)) && /Signed, version 1 on the registration form/.test(txt(q(d, '#wvList'))), 'U7 a runner who signed on the form has no paper: the panel says so, and where she stands');
  ok(!voidBtn(d) && !reasonEl(d), 'U7 and there is nothing to mark');
  await openRecs(A, ID('103'));
  // a mistake needs a reason
  const nv = wvc('wvVoid').length;
  click(w, voidBtn(d));
  ok(txt(voidBtn(d)) === 'Sure?', 'U7 the first press on "Mark as a mistake" asks "Sure?"');
  click(w, voidBtn(d));
  await settle();
  ok(toastOf(d) === 'Say why it is a mistake, in a few words.' && wvc('wvVoid').length === nv, 'U7 without a reason nothing is sent: ' + toastOf(d));
  ok(txt(voidBtn(d)) === 'Mark as a mistake', 'U7 and the button is back to its first state');
  // a call the server refuses
  set(w, reasonEl(d), 'a test');
  FAIL.set('wvVoid', { code: 'wv_voided' });
  click(w, voidBtn(d));
  click(w, voidBtn(d));
  await settle();
  ok(toastOf(d) === 'That record was already voided.' && wvc('wvVoid').length === nv + 1, 'U7 a record that somebody else already marked says so: ' + toastOf(d));
  // the real thing
  set(w, reasonEl(d), 'wrong <b>person</b>');
  click(w, voidBtn(d));
  click(w, voidBtn(d));
  await settle();
  await until(() => /Voided/.test(content(d)));
  await settle();
  const v = wvc('wvVoid').pop().arg;
  eq([v.id, v.reason], [W.ids.sig(EV, 'runner', ID('103'), 1), 'wrong <b>person</b>'], 'U7 the server was sent the record and the reason');
  ok(toastOf(d) === 'Marked as a mistake', 'U7 "Marked as a mistake": ' + toastOf(d));
  const lines = recLines(d);
  ok(lines.length === 1 && /Voided/.test(lines[0][5]) && /by owner/.test(lines[0][5]) && /wrong bperson\/b/.test(lines[0][5]), 'U7 the record stays, marked "Voided", with who and why (markup taken out): ' + (lines[0] || []).join(' | ').slice(0, 140));
  ok(!voidBtn(d) && !reasonEl(d) && qa(d, '#wvList b').length === 0, 'U7 there is nothing left to mark, and the reason made no markup');
  ok(/Papers of Chitra Devi/.test(content(d)) && /Not signed/.test(txt(q(d, '#wvList'))), 'U7 and she has not signed any more');
  ok(/8 signed 2 not signed/.test(sumText(d)), 'U7 the numbers followed: ' + sumText(d).slice(0, 120));
  eq(rows('RDWaivers').filter((r) => r.kind === 'vd' && r.event === EV).length, 1, 'U7 one mark was kept');
  // a filter closes the panel
  await pick(A, 'filter', 'todo');
  ok(!/Papers of Chitra Devi/.test(content(d)) && namesOf(d).includes('Chitra Devi'), 'U7 choosing another list closes the panel; she is to sign again');
  noMarkup(A, 'U7 the screens made no markup from the reason');
}
{
  // a lead looks at the same records, and cannot mark one; a lead records a volunteer's paper in a race with no text
  const { d, w } = L1;
  await subTo(L1, 'status');
  await pick(L1, 'filter', 'all');
  await openRecs(L1, ID('103'));
  const l = recLines(d);
  ok(l.length === 1 && /Voided/.test(l[0][5]) && /by owner/.test(l[0][5]), 'U7 a lead sees the mark, who made it and why');
  await openRecs(L1, ID('104'));
  const l2 = recLines(d);
  ok(l2.length === 1 && l2[0][5] === 'Counts' && !voidBtn(d) && !reasonEl(d), 'U7 and a record that counts has no button and no reason box for a lead');
  await switchRace(L1, EV2);
  ok(/Save the waiver text first/.test(barText(d)) && recBtn(d).disabled, 'U7 in a race with no text a lead cannot record a runner\'s paper');
  await pick(L1, 'who', 'volunteers');
  tickAll(L1, [`VOL~${EV2.slice(-6)}~5`]);
  ok(label(d, 'wv-rec') === 'Record 1 paper as signed' && !recBtn(d).disabled, 'U7 but can record a volunteer\'s');
  await confirmRec(L1);
  ok(toastOf(d) === '1 paper recorded', 'U7 the lead records it: ' + toastOf(d));
  eq(sigRowsOf(EV2).map((r) => [r.by, r.sub]), [['lead.one', 'volunteer']], 'U7 and it says who recorded it');
  await switchRace(L1, EV);
}

/* ---------- U8. printing: a page for each person, a sign-in list, blank pages ---------- */
const prSel = (d, n) => q(d, `#wvPrintForm [name="${n}"]`);
const lastDoc = () => docs()[docs().length - 1] || '';
const printNow = async (P, expect) => {
  const nd = docs().length;
  clearToast(P.d);
  click(P.w, act(P.d, 'wv-print'));
  await until(() => docs().length > nd || (expect === 'none' && /nothing to print|Something went wrong|out of step|No answer|out of date/.test(toastOf(P.d))), 10000);
  await settle();
  await sleep(250);
  return docs().length - nd;
};
const sheetArg = () => {
  const a = Object.assign({}, wvc('wvSheet').pop().arg);
  delete a.token;
  delete a.ev;
  return a;
};
{
  const { d, w } = A;
  await subTo(A, 'print');
  eq(optsOf(prSel(d, 'pwho')), ['Runners (paid)', 'Volunteers'], 'U8 papers for runners or volunteers');
  eq(optsOf(prSel(d, 'pmode')), ['A page for each person, to sign', 'One sign-in list, the waiver on top'], 'U8 a page for each person, or one sign-in list');
  eq(optsOf(prSel(d, 'pscope')), ['People who still need to sign', 'Everyone', 'Blank pages (for people who join on the day)'], 'U8 for those who still need to sign, everyone, or blank pages');
  eq(optsOf(prSel(d, 'pcat')), ['All categories', '10 K', '21 K'], 'U8 the categories of the race');
  ok(!prSel(d, 'pcopies') && /A paper carries a name, a bib and a category and nothing else\. Runners get the latest saved version of the waiver\./.test(content(d)), 'U8 a paper carries a name, a bib and a category only; no copies box until "blank"');
  ok(!act(d, 'wv-print').disabled && !/Save the waiver text first/.test(content(d)), 'U8 the race has a saved text, so Print is on');
  // a page for each person who has not signed
  const n1 = await printNow(A);
  eq(n1, 1, 'U8 one document is printed');
  eq(wvc('wvSheet').length, 1, 'U8 after one call');
  eq(sheetArg(), { who: 'runners', mode: 'forms', scope: 'todo' }, 'U8 the server was asked for the runners who have to sign, a page each');
  const h = lastDoc();
  ok(/^<!DOCTYPE html>/.test(h) && /<title>Waiver for VHM Waiver Edition \(final\)<\/title>/.test(h) && /<\/body><\/html>$/.test(h), 'U8 it is a whole page with the title of the latest text and the race filled in');
  ok(forms(h) === 2 && /Chitra Devi/.test(h) && /Nina Nobib/.test(h) && !/Asha Rao/.test(h), 'U8 two papers: Chitra (her record was a mistake) and Nina, and nobody who has signed');
  ok(/wording number 3/.test(h) && /at RK Beach/.test(h) && /bib 103, 10 K/.test(h), 'U8 with the latest wording, the race and the person filled in');
  ok(!PII.test(h) && !/chitra@|9812300103/.test(h), 'U8 and no phone number or address');
  ok(toastOf(d) === '2 papers sent to the printer' && printed[printed.length - 1] === 'PRINT', 'U8 "2 papers sent to the printer", and the print window was asked for: ' + toastOf(d));
  // everyone of one category
  change(w, prSel(d, 'pscope'), 'all');
  change(w, prSel(d, 'pcat'), '21 K');
  await printNow(A);
  eq(sheetArg(), { who: 'runners', mode: 'forms', scope: 'all', cat: '21 K' }, 'U8 everyone of one category');
  ok(forms(lastDoc()) === 2 && /Esha Nair/.test(lastDoc()) && /Farah Khan/.test(lastDoc()), 'U8 two papers: Esha and Farah');
  // a sign-in list
  change(w, prSel(d, 'pcat'), '');
  change(w, prSel(d, 'pmode'), 'list');
  await printNow(A);
  eq(sheetArg(), { who: 'runners', mode: 'list', scope: 'all' }, 'U8 one sign-in list for everyone');
  const l = lastDoc();
  ok(forms(l) === 0 && /By signing next to my name/.test(l) && /<th>Bib<\/th>/.test(l) && /Asha Rao/.test(l) && /Nina Nobib/.test(l), 'U8 the waiver on top and a line for each runner');
  ok(l.includes('&lt;img src=x onerror=&quot;window.__pwn=1&quot;&gt;Eve') && !/<img/i.test(l) && !PII.test(l), 'U8 a name that is markup is printed as text, and no phone number or address is on the list');
  // blank pages
  change(w, prSel(d, 'pmode'), 'forms');
  change(w, prSel(d, 'pscope'), 'blank');
  ok(!prSel(d, 'pcat') && !!prSel(d, 'pcopies') && prSel(d, 'pcopies').value === '1', 'U8 blank pages: no category, a box for the number of copies (1)');
  set(w, prSel(d, 'pcopies'), '3');
  await printNow(A);
  eq(sheetArg(), { who: 'runners', mode: 'forms', scope: 'blank', copies: 3 }, 'U8 three blank pages');
  ok(forms(lastDoc()) === 3 && /_{10}/.test(lastDoc()) && !/Chitra Devi|Asha Rao/.test(lastDoc()), 'U8 three pages with lines to fill in, and no names');
  for (const [typed, want] of [['0', 1], ['99', 1], ['abc', 1], ['50', 50]]) {
    set(w, prSel(d, 'pcopies'), typed);
    await printNow(A);
    eq(sheetArg().copies, want, 'U8 "' + typed + '" copies is sent as ' + want + ' (1 to 50 only)');
  }
  // the sign-in list has no blank pages: the choice falls back to "still need to sign"
  change(w, prSel(d, 'pmode'), 'list');
  ok(prSel(d, 'pscope').value === 'todo' && optsOf(prSel(d, 'pscope')).length === 2, 'U8 a sign-in list has no "blank pages", and the choice goes back to "still need to sign"');
  await printNow(A);
  eq(sheetArg(), { who: 'runners', mode: 'list', scope: 'todo' }, 'U8 and that is what is asked for');
  ok(/Chitra Devi/.test(lastDoc()) && /Nina Nobib/.test(lastDoc()) && !/Asha Rao/.test(lastDoc()), 'U8 the two who have to sign');
  change(w, prSel(d, 'pmode'), 'forms');
  // volunteers
  change(w, prSel(d, 'pwho'), 'volunteers');
  ok(!prSel(d, 'pcat') && /Volunteers get the volunteer waiver\./.test(content(d)), 'U8 volunteers have no category, and get the volunteer waiver');
  const nd0 = docs().length;
  await printNow(A, 'none');
  ok(toastOf(d) === 'There is nothing to print.' && docs().length === nd0, 'U8 every volunteer has signed, so there is nothing to print and no empty page is made: ' + toastOf(d));
  change(w, prSel(d, 'pscope'), 'all');
  await printNow(A);
  const vp = lastDoc();
  ok(forms(vp) === 3 && /Vol One/.test(vp) && /Vol Two/.test(vp) && /Vol Four/.test(vp) && !/Vol Three/.test(vp), 'U8 three volunteers (not the declined one)');
  ok(/I volunteer at VHM Waiver Edition of my own choice/.test(vp) && !/Bib:/.test(vp) && !PII.test(vp), 'U8 with the volunteer waiver, a name only, no phone number or address');
  change(w, prSel(d, 'pwho'), 'runners');
  // one person, from the list
  await subTo(A, 'status');
  await pick(A, 'filter', 'all');
  const nd1 = docs().length;
  click(w, act(d, 'wv-print-one', `[data-id="${ID('1')}"]`));
  await until(() => docs().length > nd1);
  await settle();
  eq(sheetArg(), { who: 'runners', mode: 'forms', scope: 'one', id: ID('1') }, 'U8 "Print paper" on a line asks for that one person');
  ok(forms(lastDoc()) === 1 && lastDoc().includes('&lt;img src=x onerror=&quot;window.__pwn=1&quot;&gt;Eve') && !/<img src=x/i.test(lastDoc()), 'U8 one paper, the name that is markup printed as text');
  ok(toastOf(d) === '1 paper sent to the printer', 'U8 "1 paper sent to the printer" (singular): ' + toastOf(d));
  noPii(d, 'U8 the screen holds no address or phone number');
}
{
  // a race with no text: runners cannot be printed, volunteers can
  const { d, w } = A;
  await switchRace(A, EV2);
  await subTo(A, 'print');
  ok(/Save the waiver text first \(Waiver text\), then print\./.test(content(d)) && act(d, 'wv-print').disabled, 'U8 with no text saved a runner\'s paper cannot be printed: Print is off and says why');
  change(w, prSel(d, 'pwho'), 'volunteers');
  ok(!act(d, 'wv-print').disabled && !/Save the waiver text first \(Waiver text\), then print\./.test(content(d)), 'U8 volunteers can be printed without a saved text');
  change(w, prSel(d, 'pscope'), 'all');
  await printNow(A);
  ok(forms(lastDoc()) === 1 && /Vol Other/.test(lastDoc()) && /I volunteer at Other Waiver Run of my own choice/.test(lastDoc()), 'U8 the volunteer of that race gets the volunteer waiver of that race');
}
{
  // 130 runners: the papers are asked for in pieces and printed as one document
  const { d, w } = A;
  await switchRace(A, EVP);
  await subTo(A, 'print');
  change(w, prSel(d, 'pscope'), 'all');
  DELAY.set('wvSheet', [150, 150, 150, 150, 150]);
  const n = wvc('wvSheet').length;
  const nd = docs().length;
  click(w, act(d, 'wv-print'));
  await until(() => /Preparing the papers: \d+ of 130/.test(txt(q(d, '#wvProg'))), 5000);
  ok(act(d, 'wv-print').disabled && /Preparing the papers: \d+ of 130/.test(txt(q(d, '#wvProg'))), 'U8 while it works the page says how far it is, and Print is off: ' + txt(q(d, '#wvProg')));
  click(w, act(d, 'wv-print'));
  await until(() => docs().length > nd, 10000);
  await settle();
  await sleep(250);
  const pieces = wvc('wvSheet').slice(n).map((c) => c.arg.from);
  eq(pieces, [undefined, 30, 60, 90, 120], 'U8 the papers came in five pieces of 30, asked for one after the other');
  ok(docs().length === nd + 1 && forms(lastDoc()) === 130 && (lastDoc().match(/<!DOCTYPE html>/g) || []).length === 1 && /<\/body><\/html>$/.test(lastDoc()), 'U8 and are one document of 130 papers with one head');
  ok(toastOf(d) === '130 papers sent to the printer' && txt(q(d, '#wvProg')) === '' && !act(d, 'wv-print').disabled, 'U8 "130 papers sent to the printer", the progress is cleared and Print is on again: ' + toastOf(d));
  // a failure in the middle prints nothing
  const nd2 = docs().length;
  FAIL.set('wvSheet', { code: 'server_error', skip: 2 });
  await printNow(A, 'none');
  ok(/Something went wrong on the server/.test(toastOf(d)) && docs().length === nd2 && txt(q(d, '#wvProg')) === '' && !act(d, 'wv-print').disabled, 'U8 a failure on the third piece prints nothing, says so, and Print is on again: ' + toastOf(d).slice(0, 60));
  // a server that does not move on is stopped
  TAMPER.set('wvSheet', (o) => Object.assign(o, { next: 0 }));
  await printNow(A, 'none');
  TAMPER.delete('wvSheet');
  ok(toastOf(d) === 'The list got out of step. Press the button again.' && docs().length === nd2, 'U8 a server that keeps saying "start from 0" is stopped: ' + toastOf(d));
  await switchRace(A, EV);
}

/* ---------- U9. Messages: the "waiver" choice ---------- */
const cmSel = (d, n) => q(d, `#cmAudForm [name="${n}"]`);
const auText = (d) => txt(q(d, '#cmAu'));
const cmDrawn = (d) => !/Counting\.\.\./.test(auText(d)) && !/Loading the preview/.test(txt(q(d, '#cmPv')));
const openMessages = async (P) => {
  const n = cmc('cmOverview').length;
  clearToast(P.d);
  click(P.w, tabBtn(P.d, 'comms'));
  await until(() => cmc('cmOverview').length > n);
  await until(() => q(P.d, '#cmAudForm') || /Try again/.test(content(P.d)));
  await settle();
  await until(() => cmDrawn(P.d));
};
const cmPick = async (P, name, value) => {
  const n = cmc('cmAudience').length;
  change(P.w, cmSel(P.d, name), value);
  await until(() => cmc('cmAudience').length > n);
  await settle();
  await until(() => cmDrawn(P.d));
};
{
  const { d } = A;
  await openMessages(A);
  eq(optsOf(cmSel(d, 'waiver')), ['Signed or not', 'Has signed the waiver', 'Has not signed the current waiver'], 'U9 the audience form of Messages has a waiver choice');
  eq(cmSel(d, 'waiver').value, 'any', 'U9 which starts at "Signed or not"');
  eq(cmc('cmAudience')[0].arg.aud, { who: 'runners', pay: 'paid', cat: '', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'U9 and the question to the server then holds no waiver choice at all');
  ok(/10 people/.test(auText(d)), 'U9 ten paid runners: ' + auText(d).slice(0, 80));
  await cmPick(A, 'waiver', 'unsigned');
  eq(cmc('cmAudience').pop().arg.aud.waiver, 'unsigned', 'U9 "Has not signed the current waiver" sends waiver: unsigned');
  ok(/waiver not signed/.test(auText(d)) && /2 people/.test(auText(d)), 'U9 two people (Chitra and Nina), and the audience says so: ' + auText(d).slice(0, 120));
  await cmPick(A, 'waiver', 'signed');
  ok(cmc('cmAudience').pop().arg.aud.waiver === 'signed' && /waiver signed/.test(auText(d)) && /8 people/.test(auText(d)), 'U9 "Has signed the waiver" is the other eight: ' + auText(d).slice(0, 120));
  await cmPick(A, 'waiver', 'any');
  ok(!('waiver' in cmc('cmAudience').pop().arg.aud) && /10 people/.test(auText(d)), 'U9 back to "Signed or not": the choice is not sent, and it is everyone');
  await cmPick(A, 'who', 'volunteers');
  await cmPick(A, 'waiver', 'signed');
  ok(cmc('cmAudience').pop().arg.aud.who === 'volunteers' && /4 people/.test(auText(d)), 'U9 volunteers who have signed: all four (the audience takes every status, and the one who was declined had signed on the sign-up page): ' + auText(d).slice(0, 120));
  await cmPick(A, 'waiver', 'unsigned');
  ok(/Nobody matches these choices\./.test(auText(d)), 'U9 and none who have not');
  noPii(d, 'U9 the Messages screen holds no address or phone number');
  const E = await login('lead.one');
  await openMessages(E);
  ok(!!cmSel(E.d, 'waiver') && cmSel(E.d, 'waiver').value === 'any', 'U9 a lead sees the choice too');
}

/* ---------- U10. switching race, a late answer, a page that is out of date, a lost session, logging out ---------- */
{
  const { d, w } = A;
  await openTab(A);
  await pick(A, 'filter', 'all');
  tickAll(A, [ID('nina')]);
  set(w, noteEl(d), 'for nina');
  ok(label(d, 'wv-rec') === 'Record 1 paper as signed', 'U10 a person is ticked and a note typed');
  await subTo(A, 'text');
  typeText(A, 'Typed draft in the first race', 'A draft that was not saved yet, but is long enough to be a text.');
  await switchRace(A, EV2);
  ok(namesOf(d).join() === 'Other Race Olga' && label(d, 'wv-rec') === 'Record 0 papers as signed' && noteEl(d).value === '', 'U10 another race shows its own people, with nothing ticked and no note');
  await subTo(A, 'text');
  eq([titleIn(d).value, textIn(d).value], [W.STARTER_TITLE, W.STARTER_TEXT], 'U10 and the standard wording, not what was typed for the other race');
  await switchRace(A, EV);
  await subTo(A, 'text');
  eq(titleIn(d).value, 'Waiver for {race} (final)', 'U10 back in the first race the text is the saved one: what was typed and not saved was let go');
  await subTo(A, 'status');
  await pick(A, 'filter', 'all');
  ok(label(d, 'wv-rec') === 'Record 0 papers as signed' && noteEl(d).value === '' && qa(d, '.wv-pick').every((b) => !b.checked), 'U10 and nobody is ticked');
  // an answer for the first race that arrives after the screen is on the second
  DELAY.set('wvList', [600]);
  change(w, findSel(d, 'filter'), 'signed');
  const no = wvc('wvOverview').length;
  change(w, q(d, '#evPick'), EV2);
  await until(() => wvc('wvOverview').length > no);
  await until(() => namesOf(d).join() === 'Other Race Olga' && listReady(d));
  ok(REPL.wv < wvc().length, 'U10 the slow answer of the first race is still on its way');
  await settle();
  ok(namesOf(d).join() === 'Other Race Olga' && pager(d) === 'Showing 1 to 1 of 1', 'U10 when it arrives it is dropped: the screen is still the second race\'s: ' + pager(d));
  await switchRace(A, EV);
  // a page code that does not know the calls, and a backend file that does not
  OLD.wv = true;
  await openTab(A);
  ok(/This page's code is out of date\. Paste the latest page-code\.js for this page, then publish\./.test(content(d)) && !!act(d, 'retry') && !q(d, '#wvFindForm'), 'U10 a page code that does not know the Waivers calls says so, with "Try again"');
  OLD.wv = false;
  FAIL.set('wvOverview', { code: 'backend_old' });
  click(w, act(d, 'retry'));
  await settle();
  ok(/The backend file is out of date\. Paste the latest backend files, then publish\./.test(content(d)) && !q(d, '#wvFindForm'), 'U10 an old backend file says so too');
  click(w, act(d, 'retry'));
  await until(() => q(d, '#wvFindForm') && listReady(d));
  await settle();
  ok(!!q(d, '#wvFindForm') && namesOf(d).length === 2, 'U10 "Try again" loads the tab once it is right: ' + namesOf(d).join());
  // a list that could not be fetched
  FAIL.set('wvList', { code: 'server_error' });
  change(w, findSel(d, 'filter'), 'all');
  await until(() => /Something went wrong/.test(listText(d)));
  await settle();
  const again = qa(d, '#wvList [data-act="wv-page"]').find((b) => txt(b) === 'Try again');
  ok(!!again && /Something went wrong on the server/.test(listText(d)), 'U10 a list that could not be fetched says so, with "Try again" in the list');
  click(w, again);
  await until(() => listReady(d));
  await settle();
  ok(namesOf(d).length === 10, 'U10 and "Try again" fetches it: ' + namesOf(d).length);
  // recording on a page code that does not know it
  tickAll(A, [ID('nina')]);
  FAIL.set('wvRecord', { code: 'page_code_old' });
  const nr = sigRowsOf(EV).length;
  await confirmRec(A);
  ok(/This page's code is out of date/.test(toastOf(d)) && sigRowsOf(EV).length === nr, 'U10 recording on an old page code says so, and records nothing: ' + toastOf(d).slice(0, 50));
}

/* ---------- U11. whatever the server sends is text: every string, on every screen ---------- */
const PAY = '</textarea></pre></td></tr></table><img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script> &amp; "\'';
const poison = (o, key) => {
  if (typeof o === 'string') return key === 'id' ? o : PAY;
  if (Array.isArray(o)) return o.map((x) => poison(x, key));
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, poison(v, k)]));
  return o;
};
{
  const { d, w } = A;
  const e0 = jserr.length;
  for (const m of ['wvOverview', 'wvList', 'wvText']) TAMPER.set(m, (o) => poison(o));
  // the records of a person: one record, and one marked as a mistake, with every word of them hostile
  TAMPER.set('wvRecords', (o) => poison(Object.assign({}, o, { records: [{ id: 'sig~a~1', ver: 1, how: 'paper', note: 'n', by: 'b', at: 'a', void: null }, { id: 'sig~a~2', ver: 1, how: 'paper', note: 'n', by: 'b', at: 'a', void: { by: 'b', at: 'a', reason: 'r' } }] })));
  await openTab(A);
  await pick(A, 'filter', 'all');
  ok(namesOf(d).length === 10 && namesOf(d).every((n) => n === PAY), 'U11 every name in the list is the hostile text, shown as text');
  noMarkup(A, 'U11 the status screen made no picture, no script and no handler from it');
  await openRecs(A, ID('101'));
  ok(/Papers of/.test(content(d)) && /Voided/.test(content(d)) && /Mark as a mistake/.test(content(d)), 'U11 the records panel opens, with a record that counts and one that is marked as a mistake');
  noMarkup(A, 'U11 nor did the records panel');
  await subTo(A, 'text');
  noMarkup(A, 'U11 nor the text screen (title, text, versions, volunteer waiver)');
  click(w, act(d, 'wv-view', '[data-id="1"]'));
  await settle();
  noMarkup(A, 'U11 nor the opened version');
  // what a director typed into the box comes back as text too, even when it holds the end of the box
  typeText(A, PAY, PAY);
  await subTo(A, 'set');
  await subTo(A, 'text');
  ok(titleIn(d).value === PAY && textIn(d).value === PAY, 'U11 a text typed into the box, with the end of the box and a picture inside it, is the same text when the screen is drawn again');
  noMarkup(A, 'U11 and made no picture, no script and no handler from the typed text either');
  await subTo(A, 'set');
  noMarkup(A, 'U11 nor the setup screen (questions, answers)');
  await subTo(A, 'print');
  noMarkup(A, 'U11 nor the print screen (categories)');
  ok(jserr.length === e0, 'U11 and no script error was raised by any of it');
  // the numbers too
  TAMPER.set('wvList', (o) => Object.assign(poison(o), { total: PAY, next: PAY, from: PAY }));
  TAMPER.set('wvOverview', (o) => {
    o = poison(o);
    o.latest = PAY;
    o.versions.forEach((v) => {
      v.ver = PAY;
      v.chars = PAY;
    });
    o.text.ver = PAY;
    o.counts.runners.cats.forEach((c) => {
      c.total = PAY;
      c.signed = PAY;
      c.older = PAY;
      c.none = PAY;
    });
    return o;
  });
  TAMPER.set('wvRecords', (o) => {
    o = poison(o);
    o.records.forEach((r) => {
      r.ver = PAY;
    });
    return o;
  });
  await subTo(A, 'status');
  await openTab(A);
  noMarkup(A, 'U11 numbers that are really text are not markup either (status)');
  ok(/Nobody matches these choices\./.test(pager(d)) && qa(d, '[data-act="wv-page"]').every((b) => /^\d+$/.test(b.getAttribute('data-from'))), 'U11 a total that is not a number reads as nobody, and the page buttons hold whole numbers only: ' + pager(d));
  await subTo(A, 'text');
  noMarkup(A, 'U11 (text)');
  ok(/The latest is\s+version\s+0\s*\./.test(content(d)) && verLines(d).every((l) => /^\d+$/.test(l[0]) && /^\d+$/.test(l[2])), 'U11 version numbers that are not numbers read as 0: ' + content(d).slice(0, 160));
  ok(jserr.length === e0, 'U11 still no script error');
  for (const m of ['wvOverview', 'wvList', 'wvRecords', 'wvText']) TAMPER.delete(m);
  await subTo(A, 'status');
  await openTab(A);
  ok(namesOf(d).length === 10 && namesOf(d).includes('Asha Rao') && !namesOf(d).includes(PAY), 'U11 with the real answers back, the real people are shown again');
}
{
  // the session ends in the middle of a screen, then the person logs out
  const { d, w } = A;
  FAIL.set('wvList', { code: 'not_logged_in' });
  await pick(A, 'filter', 'all').catch(() => {});
  await until(() => q(d, '#loginForm'));
  ok(!!q(d, '#loginForm') && /Your session ended\. Please log in again\./.test(txt(q(d, '#app'))), 'U10 a lost session goes back to the login page, and says so');
  ok(!/Nina Nobib|Chitra Devi|Asha Rao|Waiver for|VHM Waiver/.test(txt(q(d, '#app'))), 'U10 and nothing of the waivers is left on the page');
  set(w, q(d, '#lgUser'), 'owner');
  set(w, q(d, '#lgPass'), pw.owner);
  submit(w, q(d, '#loginForm'));
  await until(() => q(d, '.tab'));
  await openTab(A);
  ok(namesOf(d).join() === 'Chitra Devi,Nina Nobib' && label(d, 'wv-rec') === 'Record 0 papers as signed' && pager(d) === 'Showing 1 to 2 of 2', 'U10 logging in again starts the tab from nothing: ' + namesOf(d).join());
  click(w, act(d, 'logout'));
  await sleep(80);
  ok(!!q(d, '#loginForm') && !/Nina Nobib|Chitra Devi|Asha Rao|Waiver for|VHM Waiver/.test(txt(q(d, '#app'))), 'U10 logging out leaves nothing of the waivers on the page');
}
{
  // a viewer who forces the call gets nothing: the server says no
  const r = await WV.wvList({ token: (await R.login({ username: 'view.one', password: pw['view.one'] })).token, ev: EV, who: 'runners', filter: 'all', from: 0 }).then(() => 'answered', (x) => x.message);
  eq(r, 'not_allowed', 'U12 a viewer who asks the server for the list anyway is refused');
}

/* ---------- the end: no page raised a script error ---------- */
ok(jserr.length === 0, 'no page raised a script error' + (jserr.length ? ' [' + jserr.slice(0, 3).join(' | ') + ']' : ''));
done();
