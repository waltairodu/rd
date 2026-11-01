// COMPONENT + INTEGRATION TESTS (screen): the Bibs & certificates tab of the Director page, in jsdom, on the real backend code.
// A director sees the bib and the certificate as they will print, changes them and watches the preview follow, saves them, prints
// all, one category, one bib or spare bibs, and decides what the public runner page shows. A lead can only preview and print. A
// viewer has no such tab. Everything goes through the buttons and fields a person would use. Also: markup in a name stays text,
// the preview frame cannot run anything, an unsaved design is saved before printing (so the paper is the preview), a big race is
// printed in pages and joined, a failed page prints nothing, a double click prints once, an old page code or a lost session is
// explained, and logging out clears it.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as RS from './results.test.mjs';
import * as PR from './print.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Print: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const jserr = [];
const calls = [];
const answers = [];
const FAIL = new Map(); // method -> { code, skip }: the code is given instead of the real answer, once, after skipping that many calls
const REPLIED = new Map(); // method -> how many calls the page has been answered for
const OLD = { prn: false }; // the page code on the site does not know the Print calls yet

/* ---------- the world ---------- */
global.__COLS.add('Import910');
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
let RD = istDay(30);
if (/-01-01$/.test(RD)) RD = istDay(31); // a race on 1 January would look like a date of birth to the leak check below
const Y = +RD.slice(0, 4);
const mkRace = async (name, venue, cats) => {
  const e = (await R.saveEvent({ token: OT, name, date: RD, venue })).event.id;
  await R.saveCats({ token: OT, ev: e, cats });
  return e;
};
const TWO = [{ name: '10 K', km: 10, price: 800, cap: 500 }, { name: '21 K', km: 21.0975, price: 1200, cap: 500 }];
const EV = await mkRace('VHM Print Edition', 'RK Beach', TWO);
const EV2 = await mkRace('Ultribe Paderu', 'Paderu', [{ name: '10 K', km: 10, price: 800, cap: 500 }]);
const EVE = await mkRace('Empty Run', 'Nowhere', [{ name: '10 K', km: 10, price: 800, cap: 500 }]);
const EVC = await mkRace('Big Run', 'Stadium', [{ name: '10 K', km: 10, price: 800, cap: 500 }]);
const FORM = (g, d, a, x) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: a }, { name: 'Expected finish', value: x }]);
const dob = (age) => '01/01/' + (Y - age);
const idOf = (e, bib, n) => 'REG~' + e.slice(-6) + '~' + (bib || 'x' + n);
const reg = (e, bib, name, cat, g, d, a, x, status, bibName, n) =>
  wd.insert('RDRegs', { _id: idOf(e, bib, n), event: e, name, cat, bib, bibName: bibName || '', status: status || 'ok', phone: '98123' + String(bib || '0').padStart(5, '0'), email: 'p' + bib + '@example.com', form: FORM(g, d, a, x), at: new Date().toISOString() }, SA);
const EVIL1 = '<img src=x onerror="window.__pwn=1">Eve';
const EVIL2 = '=HYPERLINK("http://evil","click")';
const EVIL3 = 'Zed & "Sons" <b>bold</b>';
const EVIL4 = '@cmd|calc';
const PEOPLE = [
  ['101', 'Asha', '10 K', 'Female', dob(36), '', '55:00', 'ASHA'], ['102', 'Bina', '10 K', 'F', dob(31), '', '56:00'], ['103', 'Chitra', '10 K', 'F', dob(26), '', '57:00'],
  ['104', 'Dev', '10 K', 'M', dob(46), '', '50:00'], ['105', 'Esha', '10 K', 'F', dob(36), '', '55:00'], ['106', 'Farid', '10 K', 'M', '', '17', ''],
  ['107', 'Hari', '10 K', '', '', '', ''],
  ['201', 'Indu', '21 K', 'F', dob(41), '', '1:50:00'], ['202', 'Jai', '21 K', 'M', dob(51), '', ''], ['203', 'Kiran', '21 K', 'F', dob(29), '', ''],
  ['301', EVIL1, '10 K', 'F', dob(28), '', '48:00'], ['302', EVIL2, '10 K', 'M', dob(33), '', ''], ['303', EVIL3, '21 K', 'M', dob(44), '', ''], ['304', EVIL4, '10 K', 'M', dob(29), '', ''],
];
for (const p of PEOPLE) await reg(EV, p[0], p[1], p[2], p[3], p[4], p[5], p[6], 'ok', p[7]);
await reg(EV, '111', 'Unpaid Uma', '10 K', 'F', dob(30), '', '', 'pending');
await reg(EV, '', 'No Bib Nina', '10 K', 'F', dob(30), '', '', 'ok', '', 1);
await reg(EV2, '101', 'Other Race Olga', '10 K', 'F', dob(33), '', '54:00');
for (let i = 1; i <= 130; i++) await reg(EVC, String(1000 + i), 'Runner ' + i, '10 K', i % 2 ? 'F' : 'M', dob(30 + (i % 20)), '', '');
const SET = { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: 'Gender', dob: 'Date of birth', age: 'Age', seed: 'Expected finish' } };
for (const e of [EV, EVC]) await RS.resSaveSettings({ token: OT, ev: e, settings: SET });
// what must never reach a screen, a file or a print-out
const PII = /98123\d{5}|@example\.com|01\/01\/(19|20)\d\d|(19|20)\d\d-01-01|p\d{3,4}@/;
const CSV = [
  'bib,chip,gun,status,name,category,gender,age',
  '101,55:10,55:15,,,,,', '999,59:30,59:35,,Walk In Wanda,10 K,F,40', '102,56:20,56:25,,,,,', '103,57:30,57:35,,,,,', '104,50:00,50:05,,,,,', '105,58:00,58:05,,,,,', '106,45:00,45:04,,,,,', '107,,,DNF,,,,',
  '201,1:50:00,1:50:10,,,,,', '202,1:40:00,1:40:05,,,,,', '203,,,DNS,,,,', '301,47:00,47:03,,,,,', '302,48:00,48:03,,,,,', '303,1:35:00,1:35:06,,,,,', '304,49:00,49:03,,,,,',
].join('\n');
const BIG = ['bib,chip'].concat(Array.from({ length: 60 }, (x, i) => String(1001 + i) + ',' + Math.floor((2400 + i * 13) / 60) + ':' + String((2400 + i * 13) % 60).padStart(2, '0'))).join('\n');

/* ---------- a page, the way a browser would run it ---------- */
const downloads = [];
const printed = [];
function openPage(opts) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(html, {
    virtualConsole: vc,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.com/',
    beforeParse(win) {
      try {
        if (opts && opts.base) win.localStorage.setItem('rd.base', opts.base);
      } catch (x) {
        // no storage: the standard address
      }
    },
  });
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
    const rec = { method: m.method, mod: m.mod || 'rd', arg: m.arg };
    calls.push(rec);
    P.calls.push(rec);
    const isP = m.mod === 'prn';
    const reply = (o) => {
      if (isP) REPLIED.set(m.method, (REPLIED.get(m.method) || 0) + 1);
      w.postMessage(Object.assign({ kind: 'result', id: m.id }, o), '*');
    };
    if (isP && OLD.prn) return reply({ ok: false, error: 'page_code_old' });
    const f = isP ? FAIL.get(m.method) : null;
    if (f) {
      if (f.skip > 0) f.skip--;
      else {
        FAIL.delete(m.method);
        return reply({ ok: false, error: f.code });
      }
    }
    const mod = isP ? PR : m.mod === 'res' ? RS : R;
    try {
      const r = await mod[m.method](m.arg);
      const out = JSON.parse(JSON.stringify(r === undefined ? null : r));
      if (isP) answers.push({ method: m.method, out });
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
const prn = (m) => calls.filter((c) => c.mod === 'prn' && (!m || c.method === m));
const pvText = (d) => txt(q(d, '#prnPvWho'));
const pvDone = (d) => !!q(d, '#prnPvWho') && pvText(d) !== '' && !/Loading the preview/.test(pvText(d));
const srcdoc = (d) => {
  const f = q(d, '#prnPv');
  return f ? f.getAttribute('srcdoc') || '' : '';
};
const form = (d) => q(d, '#prnForm');
const docs = () => printed.filter((x) => x !== 'PRINT');
const lastDoc = () => docs()[docs().length - 1] || '';
const count = (s, re) => (s.match(re) || []).length;
const bibsIn = (s) => (s.match(/<div class="n"[^>]*>([^<]*)</g) || []).map((x) => x.replace(/^.*>([^<]*)<$/, '$1'));
const certsIn = (s) => count(s, /<section class="cert">/g);
// opens the tab and waits until the first preview is drawn
const openTab = async (P) => {
  const n = prn('prnOverview').length;
  clearToast(P.d);
  click(P.w, tabBtn(P.d, 'prn'));
  await until(() => prn('prnOverview').length > n);
  await until(() => q(P.d, '#prnForm') && pvDone(P.d));
  await quiet();
};
const subTo = async (P, id) => {
  const n = prn('prnOverview').length;
  click(P.w, q(P.d, `[data-act="prn-sub"][data-sub="${id}"]`));
  await until(() => prn('prnOverview').length > n);
  await sleep(60);
  if (id !== 'pub') await until(() => pvDone(P.d));
  await quiet();
};
// waits until every preview asked for has been answered and no new one is coming (the screen waits 400 ms after the last key)
const quiet = async () => {
  for (let i = 0; i < 40; i++) {
    await until(() => (REPLIED.get('prnPreview') || 0) >= prn('prnPreview').length, 4000);
    const n = prn().length;
    await sleep(480);
    if (prn().length === n && (REPLIED.get('prnPreview') || 0) >= prn('prnPreview').length) return;
  }
};
// waits until a change on the screen has reached the server as a new preview, and has been drawn
const previewed = async (P, n0) => {
  await until(() => prn('prnPreview').length > n0);
  await until(() => (REPLIED.get('prnPreview') || 0) >= prn('prnPreview').length); // every preview asked for has been answered
  await sleep(60);
  await until(() => pvDone(P.d));
};
const pressPrint = async (P, act, nDocs) => {
  clearToast(P.d);
  click(P.w, q(P.d, `[data-act="${act}"]`));
  return until(() => docs().length > nDocs || /Something went wrong|nothing to print|has no |Type the bib|Check the design|spare bibs|out of step/.test(toastOf(P.d)), 5000);
};

/* ---------- U1. who sees the tab ---------- */
const A = await login('owner');
{
  const { d } = A;
  const t = tabBtn(d, 'prn');
  ok(!!t && txt(t) === 'Bibs & certificates', 'U1 a director has a "Bibs & certificates" tab');
  ok(/Race day/.test(txt(q(d, '.side'))), 'U1 it sits in the Race day group of the side menu');
  await openTab(A);
  eq(qa(d, '[data-act="prn-sub"]').map(txt), ['Bibs', 'Certificates', 'Runner page'], 'U1 the director gets three sections');
  ok(q(d, '[role="tablist"][aria-label="Bibs and certificates sections"]') !== null, 'U1 the sections are a labelled tab list');
  ok(prn('prnOverview').length === 1 && prn('prnOverview')[0].arg.ev === EV, 'U1 the overview was asked for the selected race');
  ok(/14 bibs to print/.test(content(d)) && /1 paid without a bib yet/.test(content(d)) && /15 paid runners/.test(content(d)), 'U1 the top says 14 bibs to print, 1 paid without a bib yet, 15 paid runners (the unpaid one is not counted): ' + content(d).slice(0, 160));
}
const L1 = await login('lead.one');
{
  const { d } = L1;
  const t = tabBtn(d, 'prn');
  ok(!!t && txt(t) === 'Bibs & certificates', 'U1 a lead has the tab too');
  await openTab(L1);
  eq(qa(d, '[data-act="prn-sub"]').map(txt), ['Bibs', 'Certificates'], 'U1 a lead gets two sections, no "Runner page"');
  ok(/You can preview and print bibs and certificates\. Directors change the design\./.test(content(d)), 'U1 and is told that directors change the design');
}
const V1 = await login('view.one');
ok(!tabBtn(V1.d, 'prn'), 'U1 a viewer has no Bibs & certificates tab');
ok(!/Bibs & certificates/.test(txt(q(V1.d, '.side'))), 'U1 a viewer sees nothing about it in the menu');

/* ---------- U2. the bib design and its preview ---------- */
const DEF = { wmm: '190', hmm: '140', page: 'A4', orient: 'portrait', accent: '#1b5e9b', title: '{race}', subtitle: '{date} · {venue}', nameMode: 'either', sponsors: '', footer: '' };
const readForm = (f) => ({ wmm: f.elements.wmm.value, hmm: f.elements.hmm.value, page: f.elements.page.value, orient: f.elements.orient.value, accent: f.elements.accent.value, title: f.elements.title.value, subtitle: f.elements.subtitle.value, nameMode: f.elements.nameMode.value, sponsors: f.elements.sponsors.value, footer: f.elements.footer.value, showCat: f.elements.showCat.checked, tearoff: f.elements.tearoff.checked, holes: f.elements.holes.checked });
{
  const { d, w } = A;
  const f = form(d);
  eq(readForm(f), Object.assign({}, DEF, { showCat: true, tearoff: false, holes: true }), 'U2 an unsaved race shows the standard bib design in the form');
  ok(/Showing bib 101, Asha/.test(pvText(d)), 'U2 the preview shows the first runner with a bib: ' + pvText(d));
  const fr = q(d, '#prnPv');
  ok(!!fr && fr.hasAttribute('sandbox') && fr.getAttribute('sandbox') === '', 'U2 the preview is in a frame that is allowed to do nothing (sandbox with no permissions)');
  ok(/class="bib"/.test(srcdoc(d)) && /ASHA/.test(srcdoc(d)) && /VHM Print Edition/.test(srcdoc(d)) && /RK Beach/.test(srcdoc(d)), 'U2 the preview is the bib of Asha, with her bib name, the race and the venue');
  ok(!PII.test(srcdoc(d)), 'U2 the preview holds no phone number, e-mail address or date of birth');
  ok(/Words in curly brackets are filled in for each runner: \{race\} \{date\} \{venue\} \{cat\} \{bib\} \{name\} \{bibname\}\./.test(txt(f)) && /static\.wixstatic\.com, vtra\.run, www\.vtra\.run/.test(txt(f)), 'U2 the form lists the words it can fill in and where pictures may come from');
  const rowsC = qa(f, '.pc-row');
  eq(rowsC.map((r) => [r.getAttribute('data-cat'), r.querySelector('.pc-auto').checked, r.querySelector('.pc-col').disabled]), [['10 K', true, true], ['21 K', true, true]], 'U2 each category is on "Automatic" colour, its colour field off');
  // one change draws one new preview, however many keys it took
  const n0 = prn('prnPreview').length;
  set(w, f.elements.title, 'The');
  set(w, f.elements.title, 'The Big');
  set(w, f.elements.title, 'The Big Run');
  ok(!q(d, '#prnDirty').hidden, 'U2 typing marks the design "Not saved yet"');
  await previewed(A, n0);
  await sleep(500);
  eq(prn('prnPreview').length - n0, 1, 'U2 three quick keystrokes asked the server for one preview, not three');
  const pa = prn('prnPreview').pop().arg;
  ok(pa.kind === 'bib' && pa.tpl.title === 'The Big Run' && pa.tpl.wmm === '190' && pa.tpl.showCat === true && pa.tpl.tearoff === false && pa.tpl.holes === true && !('bib' in pa) && pa.tpl.catColors && Object.keys(pa.tpl.catColors).length === 0, 'U2 the preview was asked for with the whole design as typed (and no own colours)');
  ok(/The Big Run/.test(srcdoc(d)), 'U2 and the preview shows the new heading');
  eq(rows('RDPrint').filter((x) => x._id === 'tpl~' + EV + '~bib').length, 0, 'U2 nothing is saved by previewing');
  // a wrong value: the message is on the preview line and the last good preview stays
  const good = srcdoc(d);
  const n1 = prn('prnPreview').length;
  set(w, f.elements.wmm, '5');
  await until(() => prn('prnPreview').length > n1 && /Check the design/.test(pvText(d)));
  ok(/Check the design\. A bib is 80 to 300 mm wide/.test(pvText(d)) && srcdoc(d) === good, 'U2 a bib 5 mm wide is explained on the preview line and the last good preview stays: ' + pvText(d).slice(0, 80));
  set(w, f.elements.wmm, '200');
  await until(() => /Showing bib 101/.test(pvText(d)));
  ok(/width:200mm/.test(srcdoc(d)), 'U2 correcting it draws the 200 mm bib');
  // sponsors, and a picture address that is not allowed
  const n2 = prn('prnPreview').length;
  set(w, f.elements.sponsors, 'Acme Sports\nhttps://static.wixstatic.com/media/s.png');
  await previewed(A, n2);
  ok(/<span>Acme Sports<\/span>/.test(srcdoc(d)) && /<img src="https:\/\/static\.wixstatic\.com\/media\/s\.png"/.test(srcdoc(d)), 'U2 a sponsor is a name, or a picture from an allowed site');
  const n3 = prn('prnPreview').length;
  set(w, f.elements.sponsors, 'Acme Sports\nhttps://evil.example/x.png');
  await until(() => prn('prnPreview').length > n3 && /picture address must start with https/.test(pvText(d)));
  ok(/picture address must start with https:\/\/ and be on your Wix media or vtra\.run/.test(pvText(d)), 'U2 a picture from another site is refused in plain words: ' + pvText(d).slice(0, 90));
  set(w, f.elements.sponsors, 'Acme Sports');
  await until(() => /Showing bib 101/.test(pvText(d)));
  // an own colour for one category
  const au = qa(f, '.pc-row')[1].querySelector('.pc-auto');
  const co = qa(f, '.pc-row')[1].querySelector('.pc-col');
  const n4 = prn('prnPreview').length;
  tick(w, au, false);
  ok(co.disabled === false, 'U2 unticking Automatic frees the colour field');
  set(w, co, '#c0392b');
  await previewed(A, n4);
  eq(prn('prnPreview').pop().arg.tpl.catColors, { '21 K': '#c0392b' }, 'U2 only the category with an own colour is sent');
  // save
  clearToast(d);
  submit(w, f);
  await until(() => /Bib design saved/.test(toastOf(d)));
  ok(/Bib design saved/.test(toastOf(d)), 'U2 saving says so');
  const sv = prn('prnSaveTemplate').pop().arg;
  ok(sv.kind === 'bib' && sv.tpl.title === 'The Big Run' && sv.tpl.wmm === '200' && sv.tpl.sponsors === 'Acme Sports' && sv.tpl.catColors['21 K'] === '#c0392b' && typeof sv.token === 'string' && sv.token.length >= 20, 'U2 the screen sent the whole design with the login token');
  const row = rows('RDPrint').find((x) => x._id === 'tpl~' + EV + '~bib');
  const js = row && JSON.parse(row.json);
  ok(!!row && row.event === EV && row.by === 'owner' && js.title === 'The Big Run' && js.wmm === 200 && js.sponsors[0] === 'Acme Sports' && js.catColors['21 K'] === '#c0392b', 'U2 stored for this race, by the director, with the bib width as a number');
  ok(q(d, '#prnDirty').hidden, 'U2 and "Not saved yet" is gone');
  ok(rows('RDAudit').some((a) => a.action === 'bib design saved' && a.by === 'owner'), 'U2 the audit log has the save');
  ok(!rows('RDPrint').some((x) => x._id === 'tpl~' + EV2 + '~bib'), 'U2 and no design is stored for the other race');
}
{
  // the saved design is what the next visit shows
  const B = await login('dir.two');
  await openTab(B);
  const f = form(B.d);
  eq([f.elements.title.value, f.elements.wmm.value, f.elements.sponsors.value, qa(f, '.pc-row')[1].querySelector('.pc-auto').checked, qa(f, '.pc-row')[1].querySelector('.pc-col').value, qa(f, '.pc-row')[0].querySelector('.pc-auto').checked], ['The Big Run', '200', 'Acme Sports', false, '#c0392b', true], 'U2 a second director sees the saved design: title, width, sponsor, the 21 K colour, and 10 K still automatic');
  ok(/The Big Run/.test(srcdoc(B.d)) && /width:200mm/.test(srcdoc(B.d)), 'U2 and its preview');
  eq(B.calls.filter((c) => c.method === 'prnPreview').pop().arg.tpl.title, 'The Big Run', 'U2 the preview of an opened screen is made from the design the form holds');
}
{
  // back to the standard design
  const { d, w } = A;
  const f = form(d);
  const n = prn('prnPreview').length;
  clearToast(d);
  click(w, q(d, '[data-act="prn-reset"]'));
  await previewed(A, n);
  const f2 = form(d);
  eq(readForm(f2), Object.assign({}, DEF, { showCat: true, tearoff: false, holes: true }), 'U2 "Back to the standard design" fills every field with the standard one (the same values an unsaved race loads from the server)');
  ok(qa(f2, '.pc-row').every((r) => r.querySelector('.pc-auto').checked), 'U2 and puts every category back on Automatic');
  ok(!q(d, '#prnDirty').hidden, 'U2 it is not saved until Save is pressed');
  ok(JSON.parse(rows('RDPrint').find((x) => x._id === 'tpl~' + EV + '~bib').json).title === 'The Big Run', 'U2 the stored design is still the old one');
  void f;
  submit(w, f2);
  await until(() => /Bib design saved/.test(toastOf(d)));
  eq(JSON.parse(rows('RDPrint').find((x) => x._id === 'tpl~' + EV + '~bib').json).title, '{race}', 'U2 saved, the standard design is stored');
}

/* ---------- U3. choosing who to preview ---------- */
await quiet();
{
  const { d, w } = A;
  const box = q(d, '#prnPvBib');
  let n = prn('prnPreview').length;
  set(w, box, '104');
  await previewed(A, n);
  ok(/Showing bib 104, Dev/.test(pvText(d)) && prn('prnPreview').pop().arg.bib === '104' && /<div class="n"[^>]*>104</.test(srcdoc(d)), 'U3 a bib typed in "Preview for bib" is the one shown: ' + pvText(d) + ' | ' + JSON.stringify(prn('prnPreview').pop().arg).slice(0, 80) + ' | ' + (srcdoc(d).match(/<div class="n"[^>]*>[^<]*</) || ['no n'])[0]);
  const keep = srcdoc(d);
  for (const [b, rx] of [['999', /That bib has no bib to show/], ['111', /That bib has no bib to show/], ['<b>', /A bib number is letters, digits or dashes/]]) {
    n = prn('prnPreview').length;
    set(w, q(d, '#prnPvBib'), b);
    await until(() => prn('prnPreview').length > n && rx.test(pvText(d)));
    ok(rx.test(pvText(d)) && srcdoc(d) === keep, 'U3 "' + b + '" is explained and the old preview stays: ' + pvText(d).slice(0, 70));
  }
  n = prn('prnPreview').length;
  set(w, q(d, '#prnPvBib'), '');
  await previewed(A, n);
  ok(/Showing bib 101, Asha/.test(pvText(d)) && !('bib' in prn('prnPreview').pop().arg), 'U3 emptying the box goes back to the first runner');
  // evil names
  n = prn('prnPreview').length;
  set(w, q(d, '#prnPvBib'), '301');
  await previewed(A, n);
  const s = srcdoc(d);
  ok(/Showing bib 301, /.test(pvText(d)) && /&lt;img src=x onerror/.test(s) && !/<img src=x/.test(s) && !/<script/i.test(s), 'U3 a name that holds markup is text in the preview');
  ok(w.__pwn === undefined && qa(d, 'img[src="x"]').length === 0, 'U3 and nothing ran');
  set(w, q(d, '#prnPvBib'), '');
}
{
  // a race with nobody is previewed with a made-up runner
  const B = await login('owner', { ev: EVE });
  await openTab(B);
  ok(/made-up runner/.test(pvText(B.d)) && /SAMPLE/.test(srcdoc(B.d)) && /<div class="n"[^>]*>123</.test(srcdoc(B.d)), 'U3 a race with nobody is previewed with a made-up runner (bib 123, SAMPLE): ' + pvText(B.d) + ' | ' + content(B.d).slice(0, 120));
  ok(/0 bibs to print/.test(content(B.d)), 'U3 and says 0 bibs to print');
}

/* ---------- U4. printing bibs ---------- */
{
  const { d, w } = A;
  const n0 = docs().length;
  const ok1 = await pressPrint(A, 'prn-print-all', n0);
  await sleep(200);
  const doc = lastDoc();
  ok(ok1 && docs().length === n0 + 1 && printed[printed.length - 1] === 'PRINT', 'U4 "Print all bibs" prints one document, and the print window is opened');
  ok(/^<!DOCTYPE html>/.test(doc) && /<\/body><\/html>$/.test(doc), 'U4 it is a whole page, from the start of the document to its end');
  eq(bibsIn(doc).length, 14, 'U4 with the 14 bibs (not the unpaid runner, not the paid runner with no bib yet)');
  ok(/&lt;b&gt;bold&lt;\/b&gt;/.test(doc) && !/<b>bold<\/b>/.test(doc) && !/<img src=x/.test(doc) && !/<script/i.test(doc), 'U4 a name with markup is printed as text');
  ok(!PII.test(doc), 'U4 the print-out holds no phone number, e-mail address or date of birth');
  ok(/14 bibs sent to the printer/.test(toastOf(d)), 'U4 the screen says how many were sent: ' + toastOf(d));
  const c1 = prn('prnBibs').pop().arg;
  ok(!('from' in c1) && !('cat' in c1) && !('spares' in c1) && !('only' in c1), 'U4 the first request asks for everything, from the start');
  ok(rows('RDAudit').filter((a) => a.action === 'bibs printed' && a.target === 'VHM Print Edition').length === 1, 'U4 the audit log has the print');
  // one category
  change(w, q(d, '#prnCat'), '21 K');
  const n1 = docs().length;
  await pressPrint(A, 'prn-print-all', n1);
  eq(bibsIn(lastDoc()), ['201', '202', '203', '303'], 'U4 one category prints only its bibs, in bib order');
  ok(prn('prnBibs').pop().arg.cat === '21 K', 'U4 and was asked for by category');
  change(w, q(d, '#prnCat'), '');
  // spares
  set(w, q(d, '#prnSpFrom'), '900');
  set(w, q(d, '#prnSpTo'), '903');
  const n2 = docs().length;
  await pressPrint(A, 'prn-print-all', n2);
  const b2 = bibsIn(lastDoc());
  ok(b2.length === 18 && b2.slice(-4).join() === '900,901,902,903', 'U4 spare bibs 900 to 903 come after the 14 runners\' bibs: ' + b2.slice(-5));
  ok(JSON.stringify(prn('prnBibs').pop().arg.spares) === JSON.stringify({ from: 900, to: 903 }), 'U4 sent as whole numbers');
  set(w, q(d, '#prnSpFrom'), '100');
  set(w, q(d, '#prnSpTo'), '102');
  const n3 = docs().length;
  await pressPrint(A, 'prn-print-all', n3);
  const b3 = bibsIn(lastDoc());
  ok(b3.length === 15 && b3[14] === '100', 'U4 a spare number a runner already has (101, 102) is left out: ' + b3.slice(-3));
  const nb = prn('prnBibs').length;
  for (const [a, b] of [['x', '5'], ['5', ''], ['', '5'], ['1', '99999999']]) {
    set(w, q(d, '#prnSpFrom'), a);
    set(w, q(d, '#prnSpTo'), b);
    clearToast(d);
    click(w, q(d, '[data-act="prn-print-all"]'));
    await until(() => /spare bibs/.test(toastOf(d)), 2000);
    ok(/For spare bibs give the first and the last number/.test(toastOf(d)), 'U4 spare bibs "' + a + '" to "' + b + '" are explained: ' + toastOf(d).slice(0, 50));
  }
  ok(prn('prnBibs').length === nb + 1, 'U4 only the request the server could judge (1 to 99999999) went to it, the rest never left the screen');
  set(w, q(d, '#prnSpFrom'), '');
  set(w, q(d, '#prnSpTo'), '');
  // one bib
  set(w, q(d, '#prnOne'), '104');
  const n4 = docs().length;
  await pressPrint(A, 'prn-print-one', n4);
  eq(bibsIn(lastDoc()), ['104'], 'U4 "Print this bib" prints that bib alone');
  ok(prn('prnBibs').pop().arg.only === '104', 'U4 and asked for it by number');
  for (const b of ['999', '111']) {
    set(w, q(d, '#prnOne'), b);
    const nn = docs().length;
    await pressPrint(A, 'prn-print-one', nn);
    ok(/Bib .* has no bib to print: it may be unpaid or not given yet/.test(toastOf(d)) && docs().length === nn, 'U4 bib ' + b + ' (unpaid or not there) is explained and nothing is printed: ' + toastOf(d).slice(0, 60));
  }
  set(w, q(d, '#prnOne'), '');
  const nc = prn('prnBibs').length;
  await pressPrint(A, 'prn-print-one', docs().length);
  ok(/Type the bib number first/.test(toastOf(d)) && prn('prnBibs').length === nc, 'U4 an empty "one bib" asks for the number and sends nothing');
  set(w, q(d, '#prnOne'), '<x>');
  await pressPrint(A, 'prn-print-one', docs().length);
  ok(/A bib number is letters, digits or dashes/.test(toastOf(d)), 'U4 a bib that is not a bib is explained: ' + toastOf(d));
  set(w, q(d, '#prnOne'), '');
}
{
  // a double click prints once
  const { d, w } = A;
  const nb = prn('prnBibs').length;
  const nd = docs().length;
  const b = q(d, '[data-act="prn-print-all"]');
  click(w, b);
  click(w, b);
  await until(() => docs().length > nd);
  await sleep(300);
  ok(prn('prnBibs').length === nb + 1 && docs().length === nd + 1, 'U4 a double click on Print asks the server once and prints once');
}

/* ---------- U5. an unsaved design is saved first ---------- */
{
  const { d, w } = A;
  const f = form(d);
  set(w, f.elements.title, 'Saved By Printing');
  await until(() => /Saved By Printing/.test(srcdoc(d)));
  eq(JSON.parse(rows('RDPrint').find((x) => x._id === 'tpl~' + EV + '~bib').json).title, '{race}', 'U5 control: the stored design has not changed yet');
  const n = calls.length;
  const nd = docs().length;
  await pressPrint(A, 'prn-print-all', nd);
  const after = calls.slice(n).filter((c) => c.mod === 'prn').map((c) => c.method);
  eq(after.slice(0, 2), ['prnSaveTemplate', 'prnBibs'], 'U5 printing saves the design on screen first, then asks for the bibs');
  ok(/Saved By Printing/.test(lastDoc()), 'U5 so the paper is the design that was in the preview');
  eq(JSON.parse(rows('RDPrint').find((x) => x._id === 'tpl~' + EV + '~bib').json).title, 'Saved By Printing', 'U5 and the design is stored');
  ok(q(d, '#prnDirty').hidden, 'U5 "Not saved yet" is gone');
  // a design with a wrong value is not printed
  set(w, form(d).elements.hmm, '5');
  await until(() => /Check the design/.test(pvText(d)));
  const nb = prn('prnBibs').length;
  const nd2 = docs().length;
  await pressPrint(A, 'prn-print-all', nd2);
  ok(/Check the design/.test(toastOf(d)) && prn('prnBibs').length === nb && docs().length === nd2, 'U5 a design with a wrong value is refused in plain words and nothing is printed: ' + toastOf(d).slice(0, 60));
  set(w, form(d).elements.hmm, '140');
  await until(() => /Showing bib/.test(pvText(d)));
  const nd3 = docs().length;
  await pressPrint(A, 'prn-print-all', nd3);
  ok(docs().length === nd3 + 1, 'U5 after the wrong value is corrected, printing works again (the screen was not left busy)');
  click(w, q(d, '[data-act="prn-reset"]'));
  await sleep(100);
  submit(w, form(d));
  await until(() => /Bib design saved/.test(toastOf(d)));
}

/* ---------- U6. certificates ---------- */
{
  const { d, w } = A;
  await subTo(A, 'cert');
  const f = form(d);
  eq(qa(d, '[data-act="prn-sub"]').map((b) => b.getAttribute('aria-selected')), ['false', 'true', 'false'], 'U6 the Certificates section is the open one');
  ok(/0 finishers/.test(content(d)) && /certificates appear once results are in/.test(content(d)), 'U6 before results the screen says 0 finishers: ' + content(d).slice(0, 100));
  ok(q(d, '[data-act="prn-print-all"]').disabled === true && q(d, '[data-act="prn-print-one"]').disabled === true, 'U6 and Print is off');
  ok(/made-up runner/.test(pvText(d)) && /Sample Runner/.test(srcdoc(d)) && /Certificate of Achievement/.test(srcdoc(d)), 'U6 the preview uses a made-up runner and the standard heading');
  eq([f.elements.orient.value, f.elements.border.value, f.elements.accent.value, f.elements.bg.value, f.elements.stats.checked, f.elements.intro.value], ['landscape', 'double', '#1b5e9b', '#ffffff', true, 'This is to certify that'], 'U6 the form shows the standard certificate');
  ok(/Words in curly brackets are filled in for each finisher: \{name\} \{bib\} \{cat\} \{race\} \{date\} \{venue\} \{time\} \{place\} \{gender\} \{gplace\} \{agegroup\} \{aplace\} \{pace\}\./.test(txt(f)), 'U6 the form lists the words it can fill in');
}
// the timing results arrive
await RS.resImport({ token: OT, ev: EV, text: CSV, key: 'prn-ui-1' });
await RS.resImport({ token: OT, ev: EVC, text: BIG, key: 'prn-ui-2' });
{
  const { d, w } = A;
  await subTo(A, 'bib');
  await subTo(A, 'cert');
  ok(/13 finishers/.test(content(d)) && !/certificates appear once/.test(content(d)), 'U6 once results are in: 13 finishers (not the DNF, not the DNS): ' + content(d).slice(0, 80));
  ok(q(d, '[data-act="prn-print-all"]').disabled === false, 'U6 and Print is on');
  ok(/Showing bib 106, Farid/.test(pvText(d)) && /Farid/.test(srcdoc(d)) && /0:45:00/.test(srcdoc(d)) && /1st/.test(srcdoc(d)), 'U6 the preview is the winner of the first category (Farid, 45:00, 1st): ' + pvText(d));
  ok(!PII.test(srcdoc(d)), 'U6 the certificate preview holds no phone number, e-mail address or date of birth');
  const f = form(d);
  let n = prn('prnPreview').length;
  set(w, f.elements.title, 'Well Run');
  set(w, f.elements.body, 'Finished the {cat} in {time}.\nWell done {name}!');
  set(w, f.elements.sign1Name, 'Yogi');
  set(w, f.elements.sign1Role, 'Race Director');
  await previewed(A, n);
  ok(/Well Run/.test(srcdoc(d)) && /Finished the 10 K in 0:45:00\.<br>Well done Farid!/.test(srcdoc(d)) && /Yogi/.test(srcdoc(d)) && /Race Director/.test(srcdoc(d)), 'U6 the preview follows the heading, the words and the signature');
  n = prn('prnPreview').length;
  set(w, f.elements.logo, 'https://evil.example/logo.png');
  await until(() => prn('prnPreview').length > n && /picture address must start with https/.test(pvText(d)));
  ok(/picture address must start with https/.test(pvText(d)), 'U6 a logo from another site is refused in plain words');
  set(w, f.elements.logo, '');
  await until(() => /Showing bib/.test(pvText(d)));
  n = prn('prnPreview').length;
  change(w, f.elements.orient, 'portrait');
  await previewed(A, n);
  ok(/@page\{size:210mm 297mm/.test(srcdoc(d)), 'U6 portrait is drawn as portrait');
  change(w, f.elements.orient, 'landscape');
  await until(() => /@page\{size:297mm 210mm/.test(srcdoc(d)));
  set(w, q(d, '#prnPvBib'), '104');
  await until(() => /Showing bib 104, Dev/.test(pvText(d)));
  ok(/Well done Dev!/.test(srcdoc(d)) && /0:50:00/.test(srcdoc(d)), 'U6 a finisher chosen by bib is shown');
  set(w, q(d, '#prnPvBib'), '107');
  await until(() => /has no certificate/.test(pvText(d)));
  ok(/That runner has no certificate: it may not have finished\./.test(pvText(d)), 'U6 a runner who did not finish has no certificate to preview: ' + pvText(d));
  set(w, q(d, '#prnPvBib'), '');
  await until(() => /Showing bib 106/.test(pvText(d)));
  clearToast(d);
  submit(w, form(d));
  await until(() => /Certificate design saved/.test(toastOf(d)));
  const row = rows('RDPrint').find((x) => x._id === 'tpl~' + EV + '~cert');
  ok(!!row && JSON.parse(row.json).title === 'Well Run' && JSON.parse(row.json).sign1Name === 'Yogi' && JSON.parse(row.json).body === 'Finished the {cat} in {time}.\nWell done {name}!', 'U6 the certificate design is saved: ' + toastOf(d));
  ok(rows('RDAudit').some((a) => a.action === 'certificate design saved' && a.by === 'owner'), 'U6 the audit log has it');
  // print all
  const nd = docs().length;
  await pressPrint(A, 'prn-print-all', nd);
  await sleep(150);
  let doc = lastDoc();
  ok(docs().length === nd + 1 && printed[printed.length - 1] === 'PRINT', 'U6 "Print all certificates" prints one document');
  eq(certsIn(doc), 13, 'U6 with 13 certificates, one for each finisher');
  ok(/Well Run/.test(doc) && /Walk In Wanda/.test(doc) && !/Hari/.test(doc) && !/Kiran/.test(doc), 'U6 the walk-in who finished has one; the DNF (Hari) and the DNS (Kiran) have none');
  ok(!/<img src=x/.test(doc) && !/<script/i.test(doc) && /&lt;b&gt;bold&lt;\/b&gt;/.test(doc) && !PII.test(doc), 'U6 names with markup are text, and no phone number, e-mail address or date of birth is printed');
  ok(/13 certificates sent to the printer/.test(toastOf(d)), 'U6 the screen says how many: ' + toastOf(d));
  ok(rows('RDAudit').filter((a) => a.action === 'certificates printed' && a.target === 'VHM Print Edition').length === 1, 'U6 the audit log has the print');
  // one category, one certificate
  change(w, q(d, '#prnCat'), '21 K');
  const n2 = docs().length;
  await pressPrint(A, 'prn-print-all', n2);
  eq(certsIn(lastDoc()), 3, 'U6 one category: the three 21 K finishers (Indu, Jai, Evil Zed)');
  change(w, q(d, '#prnCat'), '');
  set(w, q(d, '#prnOne'), '202');
  const n3 = docs().length;
  await pressPrint(A, 'prn-print-one', n3);
  ok(certsIn(lastDoc()) === 1 && /Jai/.test(lastDoc()) && /1:40:00/.test(lastDoc()), 'U6 one certificate, for bib 202');
  for (const b of ['107', '203', '111']) {
    set(w, q(d, '#prnOne'), b);
    const nn = docs().length;
    await pressPrint(A, 'prn-print-one', nn);
    ok(/has no certificate: it may not have finished/.test(toastOf(d)) && docs().length === nn, 'U6 bib ' + b + ' has no certificate and nothing is printed: ' + toastOf(d).slice(0, 70));
  }
  set(w, q(d, '#prnOne'), '');
  // a voided result has no certificate
  const board = await RS.resBoard({ token: OT, ev: EV });
  const r202 = board.rows.find((x) => x.bib === '202');
  await RS.resVoid({ token: OT, ev: EV, id: r202.id, reason: 'wrong bib' });
  await subTo(A, 'bib');
  await subTo(A, 'cert');
  ok(/12 finishers/.test(content(d)), 'U6 a result that is voided is no longer a finisher: ' + content(d).slice(0, 60));
  await RS.resVoid({ token: OT, ev: EV, id: r202.id, undo: true });
}
{
  // 130 bibs and 60 certificates are printed in pages and joined
  const B = await login('owner', { ev: EVC });
  const { d, w } = B;
  await openTab(B);
  ok(/130 bibs to print/.test(content(d)), 'U6 control: the big race has 130 bibs to print');
  const seen = [];
  const mo = new w.MutationObserver(() => {
    const m = txt(q(d, '#app')).match(/Preparing the bibs: \d+ of \d+/);
    if (m && !seen.includes(m[0])) seen.push(m[0]);
  });
  mo.observe(q(d, '#app'), { childList: true, subtree: true, characterData: true });
  const nb = prn('prnBibs').length;
  const nd = docs().length;
  const before = rows('RDAudit').filter((a) => a.action === 'bibs printed' && a.target === 'Big Run').length;
  await pressPrint(B, 'prn-print-all', nd);
  await sleep(150);
  mo.disconnect();
  const mine = B.calls.filter((c) => c.method === 'prnBibs').map((c) => c.arg.from);
  eq(mine, [undefined, 60, 120], 'U6 130 bibs were asked for in three pages: from the start, from 60, from 120');
  ok(prn('prnBibs').length === nb + 3, 'U6 three requests in all');
  const doc = lastDoc();
  const all = bibsIn(doc);
  eq([docs().length, all.length, new Set(all).size, all[0], all[129]], [nd + 1, 130, 130, '1001', '1130'], 'U6 one document with the 130 bibs, each once, in order');
  eq((doc.match(/<!DOCTYPE html>/g) || []).length, 1, 'U6 and the start of the document appears once, not once for each page');
  ok(seen.includes('Preparing the bibs: 60 of 130') && seen.includes('Preparing the bibs: 120 of 130'), 'U6 the screen showed its progress while it worked: ' + seen.join(' | '));
  ok(!/Preparing the/.test(content(d)), 'U6 and the progress line is gone afterwards');
  eq(rows('RDAudit').filter((a) => a.action === 'bibs printed' && a.target === 'Big Run').length - before, 1, 'U6 the three pages are one line in the audit log');
  // certificates, 60 in three pages
  await subTo(B, 'cert');
  ok(/60 finishers/.test(content(d)), 'U6 control: 60 finishers in the big race');
  const nd2 = docs().length;
  await pressPrint(B, 'prn-print-all', nd2);
  await sleep(150);
  eq(B.calls.filter((c) => c.method === 'prnCerts').map((c) => c.arg.from), [undefined, 25, 50], 'U6 60 certificates were asked for in three pages: from the start, from 25, from 50');
  eq([certsIn(lastDoc()), (lastDoc().match(/<!DOCTYPE html>/g) || []).length], [60, 1], 'U6 one document with 60 certificates');
  // a page that fails stops the whole print-out
  await subTo(B, 'bib');
  FAIL.set('prnBibs', { code: 'server_error', skip: 1 });
  const nd3 = docs().length;
  await pressPrint(B, 'prn-print-all', nd3);
  await sleep(150);
  ok(/Something went wrong on the server/.test(toastOf(d)) && docs().length === nd3, 'U6 when the second page fails nothing is printed (no half print-out) and the screen says so: ' + toastOf(d));
  ok(!/Preparing the/.test(content(d)), 'U6 and the progress line is cleared');
  const nd4 = docs().length;
  await pressPrint(B, 'prn-print-all', nd4);
  ok(docs().length === nd4 + 1 && bibsIn(lastDoc()).length === 130, 'U6 and the next press prints all 130 (the screen was not left busy)');
}

/* ---------- U7. the runner page's switches ---------- */
{
  const { d, w } = A;
  await subTo(A, 'pub');
  const f = q(d, '#prnPubForm');
  ok(!!f && f.elements.startList.checked === false && f.elements.results.checked === false && f.elements.certs.checked === false && f.elements.certs.disabled === true && f.elements.note.value === '', 'U7 every switch starts off, certificates cannot be ticked while results are off');
  ok(/Nothing is shown until you turn a switch on/.test(content(d)) && /never shows a date of birth, an age, a phone number, an e-mail address/.test(content(d)) && /up to 30 seconds/.test(content(d)), 'U7 the screen says what is and is not shown');
  ok(/The page is off/.test(content(d)), 'U7 and that the page is off');
  eq(q(d, '#prnLink').value, 'https://www.vtra.run/runner?ev=' + encodeURIComponent(EV), 'U7 the link to share is on the site and opens this race');
  const a = q(d, 'a.btn');
  ok(!!a && a.getAttribute('href') === q(d, '#prnLink').value && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel')), 'U7 "Open" opens it in a new tab without giving it this page');
  tick(w, f.elements.startList, true);
  clearToast(d);
  submit(w, f);
  await until(() => /The runner page is on/.test(toastOf(d)));
  const sv = prn('prnSavePublish').pop().arg;
  eq(sv.pub, { startList: true, results: false, certs: false, note: '' }, 'U7 only the start list is switched on');
  const row = rows('RDPrint').find((x) => x._id === 'pub~' + EV);
  eq(JSON.parse(row.json), { startList: true, results: false, certs: false, note: '' }, 'U7 stored for this race');
  ok(/The page is on/.test(content(d)), 'U7 the screen says the page is on');
  ok(rows('RDAudit').some((x) => x.action === 'runner page changed' && /start list on, results off, certificates off/.test(x.detail)), 'U7 the audit log has the change');
  // results, then certificates
  const g = q(d, '#prnPubForm');
  tick(w, g.elements.results, true);
  ok(g.elements.certs.disabled === false, 'U7 ticking results lets certificates be ticked');
  tick(w, g.elements.certs, true);
  tick(w, g.elements.results, false);
  ok(g.elements.certs.checked === false && g.elements.certs.disabled === true, 'U7 unticking results unticks certificates and switches them off');
  tick(w, g.elements.results, true);
  tick(w, g.elements.certs, true);
  set(w, g.elements.note, '  Times are provisional  ');
  submit(w, g);
  await until(() => prn('prnSavePublish').length === 2 && /The runner page is on/.test(toastOf(d)));
  await sleep(100);
  eq(prn('prnSavePublish').pop().arg.pub, { startList: true, results: true, certs: true, note: 'Times are provisional' }, 'U7 all three on, with the note trimmed');
  eq(JSON.parse(rows('RDPrint').find((x) => x._id === 'pub~' + EV).json), { startList: true, results: true, certs: true, note: 'Times are provisional' }, 'U7 stored');
  // the screen never sends certificates without results
  const h = q(d, '#prnPubForm');
  h.elements.results.checked = false; // as if the tick was lost without a change event
  h.elements.certs.disabled = false;
  h.elements.certs.checked = true;
  submit(w, h);
  await until(() => prn('prnSavePublish').length === 3);
  eq(prn('prnSavePublish').pop().arg.pub.certs, false, 'U7 even then the screen sends certificates off when results are off');
  // all off again
  const k = q(d, '#prnPubForm');
  tick(w, k.elements.startList, false);
  clearToast(d);
  submit(w, k);
  await until(() => /The runner page is off/.test(toastOf(d)));
  ok(/The runner page is off/.test(toastOf(d)) && /The page is off/.test(content(d)), 'U7 with every switch off the screen says the page is off');
  // another race has its own switches
  change(w, q(d, '#evPick'), EV2);
  await until(() => prn('prnOverview').pop().arg.ev === EV2);
  await sleep(150);
  ok(!rows('RDPrint').some((x) => x._id === 'pub~' + EV2), 'U7 nothing is stored for the other race');
}
{
  // a site that does not use /volunteer in its address base
  const B = await login('owner', { base: 'https://example.org/club/volunteer' });
  await openTab(B);
  await subTo(B, 'pub');
  eq(q(B.d, '#prnLink').value, 'https://example.org/club/runner?ev=' + encodeURIComponent(EV), 'U7 the link follows the site address kept in the settings');
  const C = await login('owner', { base: 'javascript:alert(1)//volunteer' });
  await openTab(C);
  await subTo(C, 'pub');
  eq(q(C.d, '#prnLink').value, 'https://www.vtra.run/runner?ev=' + encodeURIComponent(EV), 'U7 a saved site address that is not a web address is ignored: the standard link is shown');
  ok(!/javascript:/i.test(q(C.d, '.content').innerHTML), 'U7 and nothing of it is on the screen');
}

/* ---------- U8. a lead can look and print, nothing more ---------- */
{
  const { d, w } = L1;
  const f = form(d);
  ok(!!f.querySelector('fieldset') && f.querySelector('fieldset').disabled === true, 'U8 for a lead every field of the design is switched off');
  ok(!f.querySelector('button[type="submit"]') && !q(d, '[data-act="prn-reset"]') && !q(d, '#prnDirty'), 'U8 and there is no Save, no "Back to the standard design", no "Not saved yet"');
  ok(/Showing bib 101, Asha/.test(pvText(d)), 'U8 the lead sees the preview');
  const lp = L1.calls.filter((c) => c.method === 'prnPreview').pop().arg;
  ok(!('tpl' in lp), 'U8 which is made from the saved design (the screen sends no draft)');
  let n = L1.calls.filter((c) => c.method === 'prnPreview').length;
  set(w, q(d, '#prnPvBib'), '104');
  await until(() => L1.calls.filter((c) => c.method === 'prnPreview').length > n && /Showing bib 104/.test(pvText(d)));
  ok(/Showing bib 104, Dev/.test(pvText(d)), 'U8 a lead can choose who to preview');
  const nd = docs().length;
  await pressPrint(L1, 'prn-print-all', nd);
  ok(docs().length === nd + 1 && bibsIn(lastDoc()).length === 14, 'U8 a lead can print all bibs');
  set(w, q(d, '#prnOne'), '202');
  const nd2 = docs().length;
  await pressPrint(L1, 'prn-print-one', nd2);
  ok(docs().length === nd2 + 1 && bibsIn(lastDoc()).join() === '202', 'U8 and one bib');
  await subTo(L1, 'cert');
  const nd3 = docs().length;
  await pressPrint(L1, 'prn-print-all', nd3);
  ok(docs().length === nd3 + 1 && certsIn(lastDoc()) === 13, 'U8 and the certificates');
  submit(w, form(d));
  change(w, form(d).elements.title, 'Lead Was Here');
  await sleep(500);
  ok(!L1.calls.some((c) => c.method === 'prnSaveTemplate' || c.method === 'prnSavePublish'), 'U8 nothing a lead does sends a save');
  ok(!rows('RDPrint').some((x) => /Lead Was Here/.test(x.json || '')), 'U8 and nothing a lead typed is stored');
}

/* ---------- U9. when something is wrong ---------- */
{
  const { d } = A;
  change(A.w, q(d, '#evPick'), EV);
  await until(() => prn('prnOverview').pop().arg.ev === EV);
  await sleep(200);
  OLD.prn = true;
  await subTo(A, 'cert').catch(() => {});
  await until(() => /page's code is out of date/.test(content(d)));
  ok(/page's code is out of date/.test(content(d)) && !!q(d, '[data-act="retry"]'), 'U9 an old page code is explained, with a "Try again" button: ' + content(d).slice(0, 100));
  OLD.prn = false;
  await go(A, q(d, '[data-act="retry"]'), () => q(d, '#prnForm'));
  await sleep(100);
  ok(!!q(d, '#prnForm') && !/out of date/.test(content(d)), 'U9 once the code is updated, "Try again" shows the design');
  FAIL.set('prnOverview', { code: 'backend_old', skip: 0 });
  await go(A, q(d, '[data-act="prn-sub"][data-sub="bib"]'), () => /backend file is out of date/.test(content(d)));
  ok(/backend file is out of date/.test(content(d)), 'U9 an old backend file is explained: ' + content(d).slice(0, 100));
  await go(A, q(d, '[data-act="retry"]'), () => q(d, '#prnForm'));
  ok(!!q(d, '#prnForm'), 'U9 and "Try again" works');
  // the preview fails on its own: the screen does not break
  FAIL.set('prnPreview', { code: 'server_error', skip: 0 });
  const n = prn('prnPreview').length;
  set(A.w, form(d).elements.footer, 'Fail once');
  await until(() => prn('prnPreview').length > n && /Something went wrong on the server/.test(pvText(d)));
  ok(/Something went wrong on the server/.test(pvText(d)) && !!srcdoc(d), 'U9 a preview that fails is explained on its line, and the old preview stays');
  set(A.w, form(d).elements.footer, '');
  await until(() => /Showing bib/.test(pvText(d)));
}
{
  // the session ends in the middle of it
  const B = await login('owner');
  await openTab(B);
  FAIL.set('prnBibs', { code: 'not_logged_in', skip: 0 });
  click(B.w, q(B.d, '[data-act="prn-print-all"]'));
  await until(() => q(B.d, '#loginForm'));
  ok(!!q(B.d, '#loginForm') && /Your session ended/.test(txt(B.d.body)) && !/Asha|Wave 1|VHM Print/.test(B.d.body.innerHTML), 'U9 a lost session returns to the login screen with an explanation, and no names stay on the page');
}

/* ---------- U10. another race, and logging out ---------- */
{
  const B = await login('owner');
  await openTab(B);
  ok(/Showing bib 101, Asha/.test(pvText(B.d)) && /14 bibs to print/.test(content(B.d)), 'U10 control: the first race');
  change(B.w, q(B.d, '#evPick'), EV2);
  await until(() => prn('prnOverview').pop().arg.ev === EV2);
  await until(() => /Other Race Olga/.test(srcdoc(B.d)) || /Showing bib 101, Other/.test(pvText(B.d)));
  await sleep(100);
  ok(/Showing bib 101, Other Race Olga/.test(pvText(B.d)) && /1 bib to print/.test(content(B.d)) && !/Asha/.test(srcdoc(B.d)), 'U10 another race shows its own runners (and says "1 bib", not "1 bibs")');
  eq(form(B.d).elements.title.value, '{race}', 'U10 and its own design: the first race\'s design is not carried over');
  ok(prn('prnPreview').pop().arg.ev === EV2, 'U10 the server was asked for that race');
  change(B.w, q(B.d, '#evPick'), EV);
  await until(() => prn('prnOverview').pop().arg.ev === EV);
  await sleep(150);
  ok(/Showing bib 101, Asha/.test(pvText(B.d)), 'U10 back to the first race, its runners are back');
  await go(B, q(B.d, '[data-act="logout"]'), () => q(B.d, '#loginForm'));
  ok(!!q(B.d, '#loginForm') && !/Asha|Wave 1|VHM Print|Big Run/.test(B.d.body.innerHTML), 'U10 logging out leaves no names or designs on the page');
}

/* ---------- U11. the whole run ---------- */
{
  ok(!answers.some((a) => PII.test(JSON.stringify(a.out))), 'U11 across the whole run, none of the ' + answers.length + ' answers of the Print server held a phone number, e-mail address or date of birth');
  ok(!prn().some((c) => !c.arg || typeof c.arg.token !== 'string' || c.arg.token.length < 20), 'U11 every Print call was sent with a login token');
  ok(prn().every((c) => !!c.arg.ev), 'U11 and named the race');
  const sent = JSON.stringify(prn().map((c) => Object.assign({}, c.arg, { token: undefined, head: undefined })));
  ok(!/98123\d{5}|@example\.com/.test(sent), 'U11 nothing the screen sent held a phone number or an e-mail address');
  const methods = [...new Set(prn().map((c) => c.method))].sort();
  eq(methods, ['prnBibs', 'prnCerts', 'prnOverview', 'prnPreview', 'prnSavePublish', 'prnSaveTemplate'], 'U11 the run used all six Print methods');
  ok(prn().every((c) => c.mod === 'prn'), 'U11 and every one was tagged for the Print side of the page code');
  ok(docs().every((x) => /^<!DOCTYPE html>/.test(x) && /<\/body><\/html>$/.test(x) && !/<script/i.test(x)), 'U11 all ' + docs().length + ' print-outs are whole pages with no script in them');
  eq(jserr, [], 'U11 no script error was raised on any page');
}
done();
