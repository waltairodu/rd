// COMPONENT + INTEGRATION TESTS (screen): the Messages tab of the Director page, in jsdom, on the real backend code and a stand-in for the
// Wix contacts and triggered e-mails. A director picks who gets a message and which one, sees how many people that reaches and how the
// message looks, prepares a batch and sends it (a big one in pages, with a stop button, a resume after a failure, a retry for the people
// who did not get it), opens WhatsApp chats and marks them, downloads a file of the people, sends a test e-mail, writes and archives
// messages and sets up the Wix e-mail. A lead can only look. A viewer has no such tab. Everything goes through the buttons and fields a
// person would use. Also: markup in a name stays text (and so does an answer full of it, on every screen), a link that is not a WhatsApp link never becomes a link, an answer that arrives
// late does not overwrite a newer one, a double click prepares once, switching race mid-send stops it safely, an old page code or a lost
// session is explained, and logging out clears it.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as CM from './comms.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Messages: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const CRM = global.__CRM;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const jserr = [];
const calls = [];
const answers = [];
const FAIL = new Map(); // method -> { code, skip }: the code is given instead of the real answer, once, after skipping that many calls
const REPLIED = new Map(); // method -> how many calls the page has been answered for
const DELAY = new Map(); // method -> [ms, ...]: the next answers are held back that long
const TAMPER = new Map(); // method -> function: changes the answer before the page gets it
const OLD = { comms: false }; // the page code on the site does not know the Messages calls yet
const DOT = ' · ';

/* ---------- the world ---------- */
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
const RD = istDay(30);
const mkRace = async (name, venue, cats) => {
  const e = (await R.saveEvent({ token: OT, name, date: RD, venue })).event.id;
  await R.saveCats({ token: OT, ev: e, cats });
  return e;
};
const K10 = { name: '10 K', km: 10, price: 800, cap: 9000 };
const K21 = { name: '21 K', km: 21.0975, price: 1200, cap: 9000 };
const K5 = { name: '5 K', km: 5, price: 500, cap: 9000 };
const EV = await mkRace('VHM Comms Edition', 'RK Beach', [K10, K21, K5]);
const EV2 = await mkRace('Ultribe Paderu', 'Paderu', [K10]);
const EVC = await mkRace('Big Run', 'Stadium', [K10]);
const EVS = await mkRace('Stop Run', 'Stadium', [K10]);
const EVT = await mkRace('Switch Run', 'Stadium', [K10]);
const EVX = await mkRace('Huge File Run', 'Stadium', [K10]);
const reg = (e, p) => wd.insert('RDRegs', { _id: 'REG~' + e.slice(-6) + '~' + (p.bib || p.key), event: e, name: p.name, cat: p.cat, bib: p.bib || '', bibName: p.bibName || '', size: p.size || 'M', status: p.status || 'ok', phone: p.phone || '', email: p.email || '', form: '[]', at: new Date().toISOString() }, SA);
const EVIL1 = '<img src=x onerror="window.__pwn=1">Eve';
const EVIL2 = '=HYPERLINK("http://evil","click")';
const EVIL3 = 'Zed & "Sons" <b>bold</b>';
const PPL = [
  { bib: '101', name: 'Asha Rao', cat: '10 K', email: 'asha@example.com', phone: '9812300101', size: 'M', bibName: 'ASHA' },
  { bib: '102', name: 'BINA RAO', cat: '10 K', email: 'Bina@Example.com', phone: '9812300102', size: 'S' },
  { bib: '103', name: 'Chitra Devi', cat: '10 K', email: 'chitra@example.com', phone: '919812300103', size: 'L' },
  { bib: '104', name: 'Dev Raman', cat: '10 K', email: '', phone: '9812300104', size: 'XL' },
  { bib: '105', name: 'Esha Nair', cat: '10 K', email: 'not-an-email', phone: '', size: 'M' },
  { key: 'nina', name: 'Nina Nobib', cat: '10 K', email: 'nina@example.com', phone: '9812300999', size: 'M' },
  { bib: '111', name: 'Unpaid Uma', cat: '10 K', email: 'uma@example.com', phone: '9812300111', size: 'M', status: 'pending' },
  { bib: '201', name: 'Indu Menon', cat: '21 K', email: 'indu@example.com', phone: '9812300201', size: 'S' },
  { bib: '202', name: 'Jai Shah', cat: '21 K', email: 'jai@example.com', phone: '0891234567', size: 'L' },
  { bib: '203', name: 'Kiran Das', cat: '21 K', email: 'indu@example.com', phone: '9812300203', size: 'M' },
  { bib: '1', name: EVIL1, cat: '5 K', email: 'eve@example.com', phone: '9812300106', size: 'M' },
  { bib: '2', name: EVIL2, cat: '5 K', email: 'f@example.com', phone: '9812300301', size: 'M' },
  { bib: '3', name: EVIL3, cat: '5 K', email: 'zed@example.com', phone: '9812300302', size: 'M' },
];
for (const p of PPL) await reg(EV, p);
await reg(EV2, { bib: '101', name: 'Other Race Olga', cat: '10 K', email: 'olga@example.com', phone: '9812300777' });
const crowd = async (ev, first, n, tag) => {
  for (let i = 0; i < n; i++) {
    const b = String(first + i);
    await reg(ev, { bib: b, name: 'Runner ' + b, cat: '10 K', email: tag + b + '@example.com', phone: '98123' + b.padStart(5, '0') });
  }
};
await crowd(EVC, 1001, 130, 'r');
await crowd(EVS, 2001, 60, 's');
await crowd(EVT, 3001, 60, 't');
await crowd(EVX, 4001, 1003, 'x');
const vol = (ev, n, name, phone, email, status) => wd.insert('RDVolunteers', { event: ev, name, phone, email, club: '', status, code: 'C' + n, waiverAt: '', waiverVersion: '', createdAt: new Date().toISOString(), notes: '' }, SA);
await vol(EV, 1, 'Vol One', '9812300501', 'vol1@example.com', 'approved');
await vol(EV, 2, 'Vol Two', '9812300502', '', 'applied');
await vol(EV, 3, 'Vol Three', '9812300503', 'vol3@example.com', 'declined');
await vol(EV, 4, 'Vol Four', '9812300504', 'vol4@example.com', 'approved');
// what must never reach a screen: an address or a phone number of a person
const PII = /(?<!\byou)@example\.com|98123\d{5}|0891234567/;

/* ---------- a page, the way a browser would run it ---------- */
const downloads = [];
const blobs = [];
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
  const OB = w.Blob;
  w.Blob = class extends OB {
    constructor(parts, o) {
      super(parts, o);
      blobs.push({ text: parts.map(String).join(''), type: o && o.type });
    }
  };
  const P = { w, d, calls: [] };
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    const rec = { method: m.method, mod: m.mod || 'rd', arg: m.arg };
    calls.push(rec);
    P.calls.push(rec);
    const isC = m.mod === 'comms';
    const reply = (o) => {
      if (isC) REPLIED.set(m.method, (REPLIED.get(m.method) || 0) + 1);
      w.postMessage(Object.assign({ kind: 'result', id: m.id }, o), '*');
    };
    if (isC && OLD.comms) return reply({ ok: false, error: 'page_code_old' });
    const f = isC ? FAIL.get(m.method) : null;
    if (f) {
      if (f.skip > 0) f.skip--;
      else {
        FAIL.delete(m.method);
        return reply({ ok: false, error: f.code });
      }
    }
    const mod = isC ? CM : R;
    try {
      const r = await mod[m.method](m.arg);
      let out = JSON.parse(JSON.stringify(r === undefined ? null : r));
      if (isC) {
        answers.push({ method: m.method, out });
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
const cmc = (m) => calls.filter((c) => c.mod === 'comms' && (!m || c.method === m));
const auText = (d) => txt(q(d, '#cmAu'));
const pvText = (d) => txt(q(d, '#cmPv'));
const goText = (d) => txt(q(d, '#cmGo'));
const selOf = (d, n) => q(d, `#cmAudForm [name="${n}"]`);
const optsOf = (el) => [...el.options].map((o) => o.textContent);
const act = (d, a, extra) => q(d, `[data-act="${a}"]${extra || ''}`);
const label = (d, a) => txt(act(d, a));
const wait = async (cond, ms) => until(cond, ms || 6000);
// every audience and preview asked for has been answered and drawn
const settled = async () => {
  await until(() => (REPLIED.get('cmAudience') || 0) >= cmc('cmAudience').length && (REPLIED.get('cmPreview') || 0) >= cmc('cmPreview').length, 8000);
  await sleep(60);
};
const drawn = (d) => !/Counting\.\.\./.test(auText(d)) && !/Loading the preview/.test(pvText(d));
const openTab = async (P) => {
  const n = cmc('cmOverview').length;
  clearToast(P.d);
  click(P.w, tabBtn(P.d, 'comms'));
  await until(() => cmc('cmOverview').length > n);
  await until(() => q(P.d, '#cmAudForm') || /Try again/.test(content(P.d)));
  await settled();
  await until(() => drawn(P.d));
};
const subTo = async (P, id) => {
  const n = cmc('cmOverview').length;
  click(P.w, act(P.d, 'cm-sub', `[data-sub="${id}"]`));
  if (id === 'hist') await until(() => cmc('cmOverview').length > n);
  if (id === 'send') {
    await settled();
    await until(() => drawn(P.d));
  }
  await sleep(60);
};
// changes a choice of the audience form and waits for the new answers
const pick = async (P, name, value) => {
  const n = cmc('cmAudience').length;
  change(P.w, selOf(P.d, name), value);
  await until(() => cmc('cmAudience').length > n);
  await settled();
  await until(() => drawn(P.d));
};
const pressTwice = async (P, a) => {
  click(P.w, act(P.d, a));
  await sleep(30);
  click(P.w, act(P.d, a));
};
const switchRace = async (P, ev) => {
  const n = cmc('cmOverview').length;
  change(P.w, q(P.d, '#evPick'), ev);
  await until(() => cmc('cmOverview').length > n);
  await until(() => q(P.d, '#cmAudForm'));
  await settled();
  await until(() => drawn(P.d));
};
const finished = (P) => wait(() => /Finished\./.test(goText(P.d)) || /Stopped:|Paused at|out of step|Something went wrong/.test(goText(P.d)), 20000);
const subjectsOf = (list) => list.map((s) => s.variables.subject).sort();
const bibsSent = (pre) => CRM.sent.map((s) => s.variables.subject).filter((s) => s.indexOf(pre) === 0);
const rcpOf = (ev) => rows('RDComms').filter((x) => x.kind === 'rcp' && x.event === ev);
const batchesOf = (ev) => rows('RDComms').filter((x) => x.kind === 'bat' && x.event === ev);
const noPii = (d, msg) => {
  const h = d.body.innerHTML.replace(/href="https:\/\/wa\.me\/[^"]*"/g, '');
  const m = PII.exec(h);
  ok(!m, msg + (m ? ' [found near: ' + h.slice(Math.max(0, m.index - 80), m.index + 60).replace(/\s+/g, ' ') + ']' : ''));
};
const crmReset = () => {
  CRM.contacts.clear();
  CRM.sent.length = 0;
  CRM.calls.length = 0;
  CRM.fail = {};
  CRM.delay = 0;
  CRM.n = 0;
};

/* ---------- U1. who sees the tab ---------- */
const A = await login('owner');
{
  const { d } = A;
  const t = tabBtn(d, 'comms');
  ok(!!t && txt(t) === 'Messages', 'U1 a director has a "Messages" tab');
  ok(/Volunteers\s+Messages\s+Pacers/.test(txt(q(d, '.side'))), 'U1 it sits in the People group of the side menu, after Volunteers');
  await openTab(A);
  eq(qa(d, '[data-act="cm-sub"]').map(txt), ['Send', 'History', 'Templates', 'Settings'], 'U1 the director gets four sections');
  ok(q(d, '[role="tablist"][aria-label="Messages sections"]') !== null, 'U1 the sections are a labelled tab list');
  ok(cmc('cmOverview').length === 1 && cmc('cmOverview')[0].arg.ev === EV && cmc('cmOverview')[0].arg.token.length >= 20, 'U1 the overview was asked for the selected race, with the login token');
  ok(cmc().every((c) => c.mod === 'comms'), 'U1 every call of the tab is tagged for the Messages side of the page code');
}
const L1 = await login('lead.one');
{
  const { d } = L1;
  ok(!!tabBtn(d, 'comms') && txt(tabBtn(d, 'comms')) === 'Messages', 'U1 a lead has the tab too');
  await openTab(L1);
  eq(qa(d, '[data-act="cm-sub"]').map(txt), ['Who gets it', 'History', 'Templates'], 'U1 a lead gets three sections, no "Settings"');
  ok(/Directors send the messages\./.test(content(d)), 'U1 and is told that directors send the messages');
}
const V1 = await login('view.one');
ok(!tabBtn(V1.d, 'comms'), 'U1 a viewer has no Messages tab');
ok(!/Messages/.test(txt(q(V1.d, '.side'))), 'U1 a viewer sees nothing about it in the menu');
ok(V1.calls.every((c) => c.mod !== 'comms'), 'U1 and the viewer\'s page never called the Messages server');

/* ---------- U2. the first screen ---------- */
{
  const { d } = A;
  const f = q(d, '#cmAudForm');
  eq(['who', 'pay', 'cat', 'bib', 'result', 'wave', 'notSent', 'tplId'].map((n) => !!f.elements.namedItem(n)), [true, true, true, true, true, true, true, true], 'U2 the form has who, payment, category, bib, result, wave, "already got" and message');
  eq(optsOf(selOf(d, 'tplId')), ['Your bib', 'Race kit collection', 'Race week information', 'Thank you and results'], 'U2 the four standard messages for runners are offered');
  eq(optsOf(selOf(d, 'cat')), ['All categories', '10 K', '21 K', '5 K'], 'U2 the categories of the race are offered');
  ok(/Runners · paid/.test(auText(d)) && /12 people/.test(auText(d)) && /10 with an e-mail address/.test(auText(d)) && /10 with a WhatsApp number/.test(auText(d)), 'U2 "Runners · paid": 12 people, 10 with an e-mail address, 10 with a WhatsApp number (the unpaid one is not counted): ' + auText(d).slice(0, 200));
  ok(/\{bib\} is blank for 1 person\. They would see a dash instead\./.test(auText(d)), 'U2 the one paid runner without a bib is called out');
  ok(/and 4 more\./.test(auText(d)) && qa(d, '#cmAu tr').length === 9, 'U2 eight people are listed, then "and 4 more"');
  const au = cmc('cmAudience')[0].arg;
  eq(au.aud, { who: 'runners', pay: 'paid', cat: '', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'U2 the first question to the server is the whole race, paid runners');
  ok(au.tplId === 'bib', 'U2 about the first message');
  // the first runner is one whose name is markup: it stays text, nothing runs
  ok(/Showing bib 1, /.test(pvText(d)) && /onerror/.test(pvText(d)), 'U2 the preview shows the first runner by bib, whose name is markup: ' + pvText(d).slice(0, 140));
  ok(q(d, '#cmAu img') === null && q(d, '#cmPv img') === null && A.w.__pwn === undefined, 'U2 the markup in names made no picture and ran nothing');
  ok(/Subject: Your bib for VHM Comms Edition: 1 /.test(pvText(d)) && /Venue: RK Beach/.test(pvText(d)), 'U2 the preview has the subject and the race filled in');
  ok(!q(d, '#cmTestTo'), 'U2 there is no test box until the Wix e-mail is set up');
  ok(/The Wix e-mail is not set up yet\./.test(goText(d)) && !!act(d, 'cm-goset'), 'U2 the Send card says the Wix e-mail is not set up, with a button to Settings');
  ok(label(d, 'cm-prep') === 'Prepare to send to 10 people', 'U2 and offers to prepare for the 10 who have an address: ' + label(d, 'cm-prep'));
  eq(qa(d, '.cm-col').filter((c) => c.checked).map((c) => c.value), ['name', 'bib', 'cat', 'email'], 'U2 the file offers nine columns, four ticked: name, bib, category, e-mail');
  noPii(d, 'U2 the screen holds no address or phone number');
}

/* ---------- U3. choosing who ---------- */
{
  const { d, w } = A;
  await pick(A, 'cat', '10 K');
  const aud = cmc('cmAudience').pop().arg.aud;
  eq(aud, { who: 'runners', pay: 'paid', cat: '10 K', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'U3 choosing 10 K asks the server for exactly that');
  ok(/Runners · paid · 10 K/.test(auText(d)) && /6 people/.test(auText(d)) && /4 with an e-mail address/.test(auText(d)) && /5 with a WhatsApp number/.test(auText(d)), 'U3 six people, four with an address, five with a number: ' + auText(d).slice(0, 160));
  ok(/Showing bib 101, Asha Rao/.test(pvText(d)) && /Subject: Your bib for VHM Comms Edition: 101/.test(pvText(d)) && /Hello Asha,/.test(pvText(d)) && /Your bib number for VHM Comms Edition is 101\./.test(pvText(d)), 'U3 the preview is the message to Asha: ' + pvText(d).slice(0, 200));
  ok(/Category: 10 K T-shirt size: M Race day: .+ Venue: RK Beach/.test(pvText(d)), 'U3 with her category, T-shirt size, the date and the venue');
  ok(/As a WhatsApp message/.test(pvText(d)), 'U3 and a WhatsApp version');
  await pick(A, 'pay', 'all');
  ok(/paid and unpaid/.test(auText(d)) && /7 people/.test(auText(d)), 'U3 "Paid and not paid" adds the unpaid runner: 7');
  await pick(A, 'pay', 'unpaid');
  ok(/Runners · not paid · 10 K/.test(auText(d)) && /1 person/.test(auText(d)) && !/1 people/.test(auText(d)), 'U3 "Not paid yet" is one person, said in the singular');
  await pick(A, 'pay', 'paid');
  await pick(A, 'bib', 'none');
  ok(/without a bib/.test(auText(d)) && /1 person/.test(auText(d)) && /Showing Nina Nobib/.test(pvText(d)), 'U3 "No bib yet" is Nina, and the preview has no bib in it: ' + pvText(d).slice(0, 80));
  await pick(A, 'bib', 'has');
  ok(/5 people/.test(auText(d)), 'U3 "Has a bib" is five');
  await pick(A, 'bib', 'any');
  await pick(A, 'result', 'fin');
  ok(/Nobody matches these choices\./.test(auText(d)) && /0 people/.test(auText(d)) && /made-up runner \(nobody matches these choices yet\)/.test(pvText(d)), 'U3 a result nobody has gives "Nobody matches", and the preview uses a made-up runner');
  ok(label(d, 'cm-prep') === 'Nobody here can be reached this way' && act(d, 'cm-prep').disabled, 'U3 and nothing can be prepared');
  await pick(A, 'result', 'any');
  await pick(A, 'wave', 'has');
  ok(/0 people/.test(auText(d)), 'U3 nobody is in a wave yet');
  await pick(A, 'wave', 'none');
  ok(/6 people/.test(auText(d)), 'U3 and all six are "not in a wave yet"');
  await pick(A, 'wave', 'any');
  // an answer that comes back late does not overwrite a newer one
  DELAY.set('cmAudience', [500]);
  change(w, selOf(d, 'cat'), '10 K');
  change(w, selOf(d, 'cat'), '21 K');
  await settled();
  await until(() => /21 K/.test(auText(d)) && drawn(d));
  ok(/Runners · paid · 21 K/.test(auText(d)) && /3 people/.test(auText(d)), 'U3 two quick changes show the second one: ' + auText(d).slice(0, 80));
  await sleep(700);
  ok(/Runners · paid · 21 K/.test(auText(d)) && /3 people/.test(auText(d)), 'U3 the slow answer for the first one arrived and was dropped');
  // the message: a message of the same kind, nothing else
  await pick(A, 'cat', '');
  change(w, selOf(d, 'tplId'), 'kit');
  await until(() => cmc('cmPreview').pop().arg.tplId === 'kit');
  await settled();
  ok(/Race kit collection/.test(pvText(d)) === false && /Subject: Your race kit for VHM Comms Edition/.test(pvText(d)), 'U3 choosing another message shows that one: ' + pvText(d).slice(0, 100));
  ok(/This message uses \{link\}, but this race has no link yet\. Add it in Settings\./.test(pvText(d)), 'U3 a message that uses {link} warns when the race has none');
  change(w, selOf(d, 'tplId'), 'bib');
  await settled();
}

/* ---------- U4. volunteers ---------- */
{
  const { d } = A;
  await pick(A, 'who', 'volunteers');
  eq(['pay', 'cat', 'bib', 'result', 'wave'].map((n) => !!selOf(d, n)), [false, false, false, false, false], 'U4 volunteers have no payment, category, bib, result or wave to choose');
  ok(!!selOf(d, 'vstatus') && eq(optsOf(selOf(d, 'vstatus')), ['Any status', 'Applied', 'Approved', 'Reserve', 'Declined'], 'U4 they have a status') !== 0, 'U4 the status is a choice');
  eq(optsOf(selOf(d, 'tplId')), ['Volunteer reminder'], 'U4 only the message for volunteers is offered');
  const aud = cmc('cmAudience').pop().arg.aud;
  eq(aud, { who: 'volunteers', vstatus: 'any', notSent: '', uncertain: false }, 'U4 the question to the server holds no runner choice');
  ok(/Volunteers/.test(auText(d)) && /4 people/.test(auText(d)) && /3 with an e-mail address/.test(auText(d)) && /4 with a WhatsApp number/.test(auText(d)), 'U4 four volunteers, three with an address, four with a number: ' + auText(d).slice(0, 140));
  ok(!/Bib/.test(txt(q(d, '#cmAu table'))) && !/Category/.test(txt(q(d, '#cmAu table'))), 'U4 the list has no bib or category columns');
  ok(/Showing Vol Four/.test(pvText(d)) && /Hello Vol,/.test(pvText(d)) && /Thank you for volunteering at VHM Comms Edition/.test(pvText(d)), 'U4 the preview is the message to the first volunteer by name: ' + pvText(d).slice(0, 120));
  await pick(A, 'vstatus', 'approved');
  ok(/Volunteers · approved/.test(auText(d)) && /2 people/.test(auText(d)), 'U4 "Approved" is two');
  await pick(A, 'who', 'runners');
  ok(!!selOf(d, 'pay') && !selOf(d, 'vstatus') && selOf(d, 'cat').value === '' && /12 people/.test(auText(d)), 'U4 back to runners, the runner choices are back at their standard and the status is gone');
  eq(cmc('cmAudience').pop().arg.aud, { who: 'runners', pay: 'paid', cat: '', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'U4 and the server is asked about runners only');
}

/* ---------- U5. setting up the Wix e-mail ---------- */
{
  const { d, w } = A;
  await pick(A, 'cat', '10 K');
  clearToast(d);
  const n = cmc('cmPrepare').length;
  click(w, act(d, 'cm-prep'));
  await until(() => /Add the Wix e-mail ID in Settings first\./.test(toastOf(d)));
  ok(cmc('cmPrepare').length === n + 1 && /^[A-Za-z0-9_-]{8,40}$/.test(cmc('cmPrepare').pop().arg.key) && cmc('cmPrepare').pop().arg.via === 'email' && cmc('cmPrepare').pop().arg.tplId === 'bib', 'U5 preparing before the e-mail is set up is refused by the server, and the screen says why');
  eq(batchesOf(EV).length, 0, 'U5 and nothing was made');
  click(w, act(d, 'cm-goset'));
  await sleep(60);
  const f = q(d, '#cmSetForm');
  ok(!!f && f.elements.emailId.value === '' && f.elements.nvars.value === '6' && f.elements.cc.value === '91' && f.elements.link.value === '', 'U5 the Settings screen opens with no e-mail ID, six paragraph places, country code 91 and no race link');
  ok(/E-mail is not set up yet/.test(content(d)) && /subject\s*,\s*p1\s*,\s*p2\s*,\s*p3\s*,\s*p4\s*,\s*p5\s*,\s*p6\b/.test(content(d)) && !/<\/?b>/.test(content(d)), 'U5 it says the e-mail is not set up and which variables the Wix e-mail needs');
  const tries = [['emailId', 'bad id!'], ['cc', 'abc'], ['link', 'http://insecure.example/x'], ['link', 'javascript:alert(1)'], ['emailId', 'x'.repeat(81)]];
  for (const [k, v] of tries) {
    const before = { emailId: f.elements.emailId.value, cc: f.elements.cc.value, link: f.elements.link.value };
    set(w, f.elements[k], v);
    clearToast(d);
    submit(w, f);
    await until(() => /Check the settings/.test(toastOf(d)));
    ok(/Check the settings: the e-mail ID has letters/.test(toastOf(d)), 'U5 a wrong ' + k + ' (' + v.slice(0, 20) + ') is refused with an explanation');
    set(w, f.elements[k], before[k]);
  }
  eq(rows('RDComms').filter((x) => x.kind === 'cfg' || x.kind === 'rc').length, 0, 'U5 none of those was saved');
  set(w, f.elements.emailId, 'vtra_mail');
  set(w, f.elements.link, 'https://www.vtra.run/vhm');
  clearToast(d);
  submit(w, f);
  await until(() => /Settings saved/.test(toastOf(d)));
  const sa = cmc('cmSaveSettings').pop().arg;
  ok(sa.emailId === 'vtra_mail' && sa.nvars === 6 && sa.cc === '91' && sa.link === 'https://www.vtra.run/vhm', 'U5 the settings were sent as typed (paragraphs as a number)');
  ok(/E-mail is set up/.test(content(d)), 'U5 and the screen says the e-mail is set up');
  eq(JSON.parse(rows('RDComms').find((x) => x._id === 'cfg').json), { emailId: 'vtra_mail', nvars: 6, cc: '91' }, 'U5 the site settings are kept');
  eq(JSON.parse(rows('RDComms').find((x) => x._id === 'rc~' + EV).json), { link: 'https://www.vtra.run/vhm' }, 'U5 and the link of this race');
  await subTo(A, 'send');
  ok(!/not set up yet/.test(goText(d)) && !!q(d, '#cmPv #cmTestTo'), 'U5 back on Send, no warning, and the preview now has a test box');
}

/* ---------- U6. preparing and sending a small batch ---------- */
let B1 = '';
{
  const { d, w } = A;
  await pick(A, 'cat', '21 K');
  ok(label(d, 'cm-prep') === 'Prepare to send to 3 people', 'U6 21 K: three people can get an e-mail');
  const n = cmc('cmPrepare').length;
  clearToast(d);
  click(w, act(d, 'cm-prep'));
  await until(() => cmc('cmPrepare').length > n && /Prepared: 3 people/.test(toastOf(d)));
  await until(() => /3 waiting/.test(goText(d)));
  const pa = cmc('cmPrepare').pop().arg;
  eq(pa.aud, { who: 'runners', pay: 'paid', cat: '21 K', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'U6 the batch is prepared for exactly the choices on the screen');
  B1 = pa.key;
  ok(/Your bib E-mail/.test(goText(d)) && /Runners · paid · 21 K · 3 people/.test(goText(d)) && /0 sent/.test(goText(d)) && /3 waiting/.test(goText(d)), 'U6 the batch card says what it is: message, e-mail, who, how many, nothing sent, three waiting: ' + goText(d).slice(0, 200));
  ok(label(d, 'cm-prep') === 'Prepared (see below)' && act(d, 'cm-prep').disabled, 'U6 and the Prepare button says it is done');
  eq(CRM.sent.length, 0, 'U6 nothing has been sent yet');
  ok(label(d, 'cm-send') === 'Send e-mails to 3 people', 'U6 the Send button says what it will do');
  clearToast(d);
  click(w, act(d, 'cm-send'));
  await sleep(80);
  ok(label(d, 'cm-send') === 'Sure? Send now' && cmc('cmSend').length === 0 && CRM.sent.length === 0, 'U6 the first press only asks "Sure?", nothing goes out');
  click(w, act(d, 'cm-send'));
  ok(await finished(A), 'U6 the second press sends: ' + goText(d).slice(0, 200));
  await until(() => /3 sent/.test(goText(d)) && !/waiting/.test(goText(d)));
  ok(/Finished\. This time: sent 3\./.test(goText(d)) && /3 sent/.test(goText(d)) && !/waiting/.test(goText(d)), 'U6 it finishes: sent 3, none waiting: ' + goText(d).slice(0, 200));
  const cs = cmc('cmSend');
  ok(cs.length === 1 && cs[0].arg.batch === B1 && cs[0].arg.from === 0, 'U6 one send call, from the start, for that batch');
  eq(subjectsOf(CRM.sent), ['Your bib for VHM Comms Edition: 201', 'Your bib for VHM Comms Edition: 202', 'Your bib for VHM Comms Edition: 203'], 'U6 three e-mails went out, one for each runner');
  ok(CRM.sent.every((s) => s.emailId === 'vtra_mail') && CRM.sent.find((s) => /: 201$/.test(s.variables.subject)).variables.p1 === 'Hello Indu,', 'U6 through the Wix e-mail that was set up, with the first name in the first paragraph');
  eq(CRM.contacts.size, 2, 'U6 Indu and Kiran share an address, so Wix has two contacts for the three e-mails');
  ok(!act(d, 'cm-send') && !!act(d, 'cm-rep') && !!act(d, 'cm-close'), 'U6 nothing is left to send, so there is no Send button; the numbers and Close are there');
  eq(rcpOf(EV).filter((x) => x.ref === B1).map((x) => x.status), ['sent', 'sent', 'sent'], 'U6 the log has three rows, all "sent"');
  ok(rows('RDAudit').filter((x) => /e-mail (batch prepared|sending started|sending finished)/.test(x.action)).length >= 3, 'U6 the audit trail has preparing, starting and finishing');
  noPii(d, 'U6 the screen holds no address or phone number');
  // changing the choices makes a new batch possible; the old card stays, saying what it is
  await pick(A, 'cat', '10 K');
  ok(label(d, 'cm-prep') === 'Prepare to send to 4 people' && !act(d, 'cm-prep').disabled && /Runners · paid · 21 K · 3 people/.test(goText(d)), 'U6 a new choice can be prepared again, and the old card still says "21 K"');
  click(w, act(d, 'cm-close'));
  await sleep(60);
  ok(!/21 K · 3 people/.test(goText(d)), 'U6 Close takes the card away');
}

/* ---------- U7. history ---------- */
{
  const { d, w } = A;
  await subTo(A, 'hist');
  const trs = qa(d, '.content table tr').slice(1);
  ok(trs.length === 1 && /Your bib/.test(txt(trs[0])) && /Runners · paid · 21 K/.test(txt(trs[0])) && /E-mail/.test(txt(trs[0])) && /\b3\b/.test(txt(trs[0])), 'U7 the history lists the batch: message, who, how, people');
  const n = cmc('cmBatch').length;
  click(w, act(d, 'cm-open'));
  await until(() => cmc('cmBatch').length > n && /3 sent/.test(goText(d)));
  ok(cmc('cmBatch').pop().arg.batch === B1 && /prepared/.test(goText(d)) && /3 sent/.test(goText(d)), 'U7 opening it asks how it went and shows three sent');
  click(w, act(d, 'cm-close'));
  await sleep(40);
  ok(!q(d, '#cmGo') || txt(q(d, '#cmGo')) === '', 'U7 Close takes it away, and nothing about sending is left in the history');
}

/* ---------- U8. a failure, a resume, a retry (a big race) ---------- */
let BC = '';
{
  const { d, w } = A;
  crmReset();
  await subTo(A, 'send');
  await switchRace(A, EVC);
  ok(/130 people/.test(auText(d)) && /130 with an e-mail address/.test(auText(d)), 'U8 the big race: 130 people, all with an address');
  CRM.fail.email = () => {
    throw new Error('Wix is down (code 77)');
  };
  click(w, act(d, 'cm-prep'));
  await until(() => /130 waiting/.test(goText(d)));
  BC = cmc('cmPrepare').pop().arg.key;
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  await wait(() => /Stopped:/.test(goText(d)), 15000);
  ok(/Stopped: several e-mails in a row did not go out\./.test(goText(d)), 'U8 when every e-mail fails the sending stops after a few, and says so');
  await until(() => /not sent/.test(goText(d)) && /waiting/.test(goText(d)));
  const failed = rows('RDComms').filter((x) => x.kind === 'rcp' && x.ref === BC && x.status === 'failed').length;
  ok(failed >= 3 && failed <= 8 && cmc('cmSend').filter((c) => c.arg.batch === BC).length === 1, 'U8 only ' + failed + ' people were tried (3 to 8), in one call; the other ' + (130 - failed) + ' were left alone');
  ok(new RegExp(failed + ' not sent').test(goText(d)) && new RegExp(130 - failed + ' waiting').test(goText(d)), 'U8 the card says ' + failed + ' not sent, ' + (130 - failed) + ' waiting');
  ok(/Not sent: Wix is down \(code 77\)/.test(goText(d)) && /Runner 1001\b/.test(goText(d)), 'U8 the people who did not get it are listed with the reason, by name: ' + goText(d).slice(0, 260));
  ok(label(d, 'cm-send') === 'Resume: send to the people not yet handled' && !!act(d, 'cm-retry'), 'U8 the button now says Resume, and a retry can be prepared');
  eq(CRM.sent.length, 0, 'U8 no e-mail went out');
  // Wix works again: resume goes on with the people who were not tried
  CRM.fail = {};
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  ok(await finished(A), 'U8 resume runs: ' + goText(d).slice(0, 120));
  await until(() => new RegExp(130 - failed + ' sent').test(goText(d)));
  ok(new RegExp('Finished\\. This time: sent ' + (130 - failed) + '\\.').test(goText(d)) && new RegExp(failed + ' not sent').test(goText(d)) && !/waiting/.test(goText(d)), 'U8 it finishes: ' + (130 - failed) + ' sent, ' + failed + ' not sent, none waiting: ' + goText(d).slice(0, 220));
  const calls2 = cmc('cmSend').filter((c) => c.arg.batch === BC);
  ok(calls2[1].arg.from === failed || calls2[1].arg.from === calls2[0].arg.from + failed, 'U8 the second round started right after the people already tried (at ' + calls2[1].arg.from + ')');
  eq(CRM.sent.length, 130 - failed, 'U8 and sent to everybody else, once each');
  // the retry: the people who did not get it, as a new batch
  click(w, act(d, 'cm-retry'));
  await until(() => /not yet sent/.test(auText(d)) && drawn(d));
  await settled();
  ok(/Runners · paid · not yet sent "Your bib"/.test(auText(d)) && new RegExp(failed + ' people').test(auText(d)) && selOf(d, 'notSent').value === 'bib', 'U8 "Prepare a retry" goes to Send with "leave out people who already got Your bib": ' + auText(d).slice(0, 120));
  eq(cmc('cmAudience').pop().arg.aud.notSent, 'bib', 'U8 the question to the server carries it');
  ok(label(d, 'cm-prep') === 'Prepare to send to ' + failed + ' people', 'U8 and the retry batch is exactly the people who did not get it');
  click(w, act(d, 'cm-prep'));
  await until(() => new RegExp(failed + ' waiting').test(goText(d)));
  ok(cmc('cmPrepare').pop().arg.key !== BC, 'U8 the retry is a new batch, with its own key');
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  ok(await finished(A), 'U8 the retry runs');
  await until(() => new RegExp(failed + ' sent').test(goText(d)));
  eq(CRM.sent.length, 130, 'U8 now all 130 have their e-mail');
  eq(new Set(CRM.sent.map((s) => s.variables.subject)).size, 130, 'U8 each of them exactly one');
  eq([rcpOf(EVC).filter((x) => x.status === 'sent').length, rcpOf(EVC).filter((x) => x.status === 'failed').length], [130, failed], 'U8 the log: 130 sent, ' + failed + ' failed (the first try of the ones who got it on the retry)');
  noPii(d, 'U8 the screen holds no address or phone number');
}

/* ---------- U9. stop in the middle, then go on ---------- */
{
  const { d, w } = A;
  crmReset();
  await switchRace(A, EVS);
  CRM.delay = 25;
  click(w, act(d, 'cm-prep'));
  await until(() => /60 waiting/.test(goText(d)));
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  await wait(() => /25 of 60 handled/.test(goText(d)), 10000);
  ok(/Sending\.\.\. 25 of 60 handled\./.test(goText(d)) && /Keep this page open\./.test(goText(d)), 'U9 while it sends, the card says how far it is');
  ok(!!act(d, 'cm-stop') && !act(d, 'cm-send') && !act(d, 'cm-close') && !act(d, 'cm-rep'), 'U9 and offers Stop, nothing else that could disturb it');
  ok(q(d, '#cmGo .bar i') && /width:\d+%/.test(q(d, '#cmGo .bar i').getAttribute('style')), 'U9 with a bar');
  {
    // Prepare is shut while it sends; pressing it anyway (a stale click, a script) asks the server for nothing
    const np = cmc('cmPrepare').length;
    const pb = act(d, 'cm-prep');
    ok(!pb || pb.disabled, 'U9 the Prepare button is not open while it sends');
    if (pb) click(w, pb);
    await sleep(120);
    eq(cmc('cmPrepare').length, np, 'U9 and pressing it anyway asks the server for nothing');
  }
  click(w, act(d, 'cm-stop'));
  await wait(() => /Paused at/.test(goText(d)), 10000);
  const paused = (/Paused at (\d+) of 60/.exec(goText(d)) || [])[1];
  ok(+paused >= 25 && +paused < 60, 'U9 Stop pauses it after the step it is in (at ' + paused + ' of 60)');
  const sentThen = CRM.sent.length;
  await sleep(300);
  eq(CRM.sent.length, sentThen, 'U9 and nothing more goes out while it is paused');
  ok(label(d, 'cm-send') === 'Resume: send to the people not yet handled' && !!act(d, 'cm-close'), 'U9 the button says Resume, and Close works again');
  CRM.delay = 0;
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  ok(await finished(A), 'U9 resume goes on');
  await until(() => /60 sent/.test(goText(d)));
  eq(CRM.sent.length, 60, 'U9 in the end 60 e-mails went out');
  eq(new Set(CRM.sent.map((s) => s.variables.subject)).size, 60, 'U9 one for each runner, none twice');
}

/* ---------- U10. switching race in the middle of sending ---------- */
{
  const { d, w } = A;
  crmReset();
  await switchRace(A, EVT);
  CRM.delay = 25;
  click(w, act(d, 'cm-prep'));
  await until(() => /60 waiting/.test(goText(d)));
  const BT = cmc('cmPrepare').pop().arg.key;
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  await wait(() => /25 of 60 handled/.test(goText(d)), 10000);
  const nSend = cmc('cmSend').length;
  await switchRace(A, EV2);
  await sleep(900);
  ok(!cmc('cmSend').slice(nSend).some((c) => c.arg.ev === EV2) && cmc('cmSend').slice(nSend).length <= 1, 'U10 switching race stops the sending: no more send calls, and none for the other race');
  eq(rcpOf(EV2).length, 0, 'U10 the other race has no log rows');
  ok(/1 person/.test(auText(d)) && /Showing bib 101, Other Race Olga/.test(pvText(d)) && !/Runner 3/.test(auText(d) + pvText(d)), 'U10 the other race shows its own people');
  const part = rcpOf(EVT).filter((x) => x.ref === BT).length;
  ok(part >= 25 && part < 60, 'U10 the first race got part of the batch (' + part + ' of 60)');
  CRM.delay = 0;
  await switchRace(A, EVT);
  await subTo(A, 'hist');
  click(w, act(d, 'cm-open'));
  await until(() => /waiting/.test(goText(d)) && /sent/.test(goText(d)));
  ok(new RegExp(part + ' sent').test(goText(d)) && new RegExp(60 - part + ' waiting').test(goText(d)), 'U10 opened from the history, the batch shows ' + part + ' sent and ' + (60 - part) + ' waiting: ' + goText(d).slice(0, 160));
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  ok(await finished(A), 'U10 Resume from the history finishes it');
  await until(() => /60 sent/.test(goText(d)));
  eq(CRM.sent.length, 60, 'U10 60 e-mails in all');
  eq(new Set(CRM.sent.map((s) => s.variables.subject)).size, 60, 'U10 none of them twice');
}

/* ---------- U10b. switching race on ANOTHER tab in the middle of sending ---------- */
{
  const EVW = await mkRace('Tab Switch Run', 'Stadium', [K10]);
  await crowd(EVW, 5001, 60, 'w');
  const B = await login('owner', { ev: EVW });
  const { d, w } = B;
  crmReset();
  await openTab(B);
  CRM.delay = 25;
  click(w, act(d, 'cm-prep'));
  await until(() => /60 waiting/.test(goText(d)));
  click(w, act(d, 'cm-send'));
  await sleep(60);
  click(w, act(d, 'cm-send'));
  await wait(() => /25 of 60 handled/.test(goText(d)), 10000);
  const nSend = cmc('cmSend').length;
  click(w, tabBtn(d, 'volunteers'));
  await sleep(150);
  change(w, q(d, '#evPick'), EV2);
  await sleep(900);
  const after = cmc('cmSend').slice(nSend);
  ok(after.length <= 1 && !after.some((c) => c.arg.ev === EV2), 'U10 changing the race while on another tab stops the sending too: at most the call already out, and none for the other race (' + after.length + ' more)');
  const part = rcpOf(EVW).length;
  ok(part >= 25 && part < 60, 'U10 the first race got part of the batch (' + part + ' of 60)');
  CRM.delay = 0;
  crmReset();
}

/* ---------- U11. a double click prepares once ---------- */
{
  const { d, w } = A;
  await switchRace(A, EV);
  await pick(A, 'cat', '10 K');
  await pick(A, 'tplId', 'raceweek');
  ok(/\{wave\} is blank for 6 people/.test(auText(d)) && /\{start\} is blank for 6 people/.test(auText(d)) && /\{corral\} is blank for 6 people/.test(auText(d)), 'U11 a message that uses waves says how many people have none yet');
  const nb = batchesOf(EV).length;
  const n = cmc('cmPrepare').length;
  click(w, act(d, 'cm-prep'));
  click(w, act(d, 'cm-prep'));
  await until(() => /waiting/.test(goText(d)));
  await sleep(150);
  eq([cmc('cmPrepare').length - n, batchesOf(EV).length - nb], [1, 1], 'U11 two quick presses made one call and one batch');
  const key = cmc('cmPrepare').pop().arg.key;
  eq(rows('RDComms').filter((x) => x.kind === 'mem' && x.ref === key).length, 1, 'U11 with one list of people');
  click(w, act(d, 'cm-close'));
}

/* ---------- U12. WhatsApp ---------- */
let BW = '';
{
  const { d, w } = A;
  await pick(A, 'tplId', 'bib');
  click(w, act(d, 'cm-via', '[data-via="whatsapp"]'));
  await sleep(40);
  ok(act(d, 'cm-via', '[data-via="whatsapp"]').getAttribute('aria-pressed') === 'true' && act(d, 'cm-via', '[data-via="email"]').getAttribute('aria-pressed') === 'false', 'U12 WhatsApp is chosen');
  ok(label(d, 'cm-prep') === 'Prepare to send to 5 people', 'U12 five of the six have a number: ' + label(d, 'cm-prep'));
  click(w, act(d, 'cm-prep'));
  await until(() => /WhatsApp/.test(goText(d)) && /Show the chats/.test(goText(d)));
  BW = cmc('cmPrepare').pop().arg.key;
  ok(cmc('cmPrepare').pop().arg.via === 'whatsapp' && /1 left out \(no WhatsApp number\)/.test(goText(d)) && !act(d, 'cm-send'), 'U12 the batch is a WhatsApp batch, with the one without a number left out, and there is no e-mail Send button');
  ok(/The chats hold phone numbers\. Opening them is written in the audit trail\./.test(goText(d)), 'U12 the screen says opening the chats is audited');
  eq(cmc('cmLinks').length, 0, 'U12 no number has been fetched yet');
  click(w, act(d, 'cm-wa'));
  await until(() => qa(d, '#cmGo a').length > 0);
  const links = qa(d, '#cmGo a');
  eq(links.length, 5, 'U12 five chats');
  ok(links.every((a) => /^https:\/\/wa\.me\/91981230\d{4}\?text=[A-Za-z0-9%._~!*'()-]+$/.test(a.getAttribute('href')) && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel')) && /noreferrer/.test(a.getAttribute('rel'))), 'U12 each is a wa.me link, opens in a new tab, and without a reference to this page');
  ok(links[0].getAttribute('href').indexOf('https://wa.me/919812300101?text=') === 0 && decodeURIComponent(links[0].getAttribute('href').split('text=')[1]).indexOf('*Your bib for VHM Comms Edition: 101*') === 0 && /Hello Asha,/.test(decodeURIComponent(links[0].getAttribute('href'))), 'U12 the first chat is Asha\'s number with her message ready in it');
  ok(/People 1 to 5 of 5/.test(goText(d)) && act(d, 'cm-wa-next').disabled && act(d, 'cm-wa-prev').disabled, 'U12 one page: Back and Next are off');
  noPii(d, 'U12 apart from the chat links, the screen holds no phone number');
  ok(!/98123\d/.test(txt(q(d, '#cmGo'))), 'U12 and no number is written on the screen');
  const id0 = act(d, 'cm-wa-mark').getAttribute('data-id');
  click(w, act(d, 'cm-wa-mark'));
  await until(() => qa(d, '#cmGo a').length === 4);
  ok(cmc('cmMark').pop().arg.status === 'sent' && eq(cmc('cmMark').pop().arg.ids, [id0], 'U12 marking sends the one id') !== 0 && /Done/.test(goText(d)), 'U12 "Mark as sent" marks that person, who shows as Done');
  click(w, act(d, 'cm-wa-skip'));
  await until(() => qa(d, '#cmGo a').length === 3);
  ok(cmc('cmMark').pop().arg.status === 'skipped', 'U12 "Leave out" marks the next one as left out');
  click(w, act(d, 'cm-wa-all'));
  await until(() => qa(d, '#cmGo a').length === 0);
  ok(cmc('cmMark').pop().arg.ids.length === 3 && !act(d, 'cm-wa-all'), 'U12 "Mark everybody on this page" marks the other three in one go, and the button goes');
  await until(() => /4 sent/.test(goText(d)) && /1 left out/.test(goText(d)));
  ok(/4 sent/.test(goText(d)) && /1 left out/.test(goText(d)), 'U12 the numbers follow: 4 sent, 1 left out: ' + goText(d).slice(0, 160));
  eq(rcpOf(EV).filter((x) => x.ref === BW).map((x) => x.status).sort(), ['sent', 'sent', 'sent', 'sent', 'skipped'], 'U12 the log has the five marks');
  eq(rows('RDAudit').filter((x) => x.action === 'WhatsApp links opened').length, 1, 'U12 opening the chats was written in the audit trail once');
  click(w, act(d, 'cm-close'));
  // a big batch comes in pages of 25
  await switchRace(A, EVC);
  click(w, act(d, 'cm-via', '[data-via="whatsapp"]'));
  await sleep(40);
  click(w, act(d, 'cm-prep'));
  await until(() => /Show the chats/.test(goText(d)));
  click(w, act(d, 'cm-wa'));
  await until(() => qa(d, '#cmGo a').length === 25);
  ok(/People 1 to 25 of 130/.test(goText(d)) && !act(d, 'cm-wa-next').disabled && act(d, 'cm-wa-prev').disabled, 'U12 a big batch shows 25 at a time');
  const nl = cmc('cmLinks').length;
  click(w, act(d, 'cm-wa-next'));
  await until(() => /People 26 to 50 of 130/.test(goText(d)));
  ok(cmc('cmLinks').length === nl + 1 && cmc('cmLinks').pop().arg.from === 25, 'U12 Next asks for the next 25');
  click(w, act(d, 'cm-wa-prev'));
  await sleep(60);
  ok(/People 1 to 25 of 130/.test(goText(d)) && cmc('cmLinks').length === nl + 1, 'U12 Back shows the first page again without asking the server');
  // a link that is not a WhatsApp link never becomes a link: page 3 is fetched fresh, with four of its links changed on the way
  TAMPER.set('cmLinks', (o) => {
    o.items[0].link = 'javascript:alert(1)';
    o.items[1].link = 'https://evil.example/?text=x';
    o.items[2].link = 'https://wa.me/919812300101?text=<script>';
    o.items[3].link = 'https://wa.me/12345?text=hi';
    return o;
  });
  click(w, act(d, 'cm-wa-next'));
  await sleep(60);
  click(w, act(d, 'cm-wa-next'));
  await until(() => /People 51 to 75 of 130/.test(goText(d)));
  await sleep(60);
  eq(qa(d, '#cmGo a').length, 21, 'U13 four links that are not WhatsApp links are not made into links');
  ok(!qa(d, '#cmGo a').some((a) => !/^https:\/\/wa\.me\/\d+\?text=/.test(a.getAttribute('href'))) && !/javascript:|evil\.example|<script/i.test(q(d, '#cmGo').innerHTML), 'U13 and none of their text is on the page');
  ok((goText(d).match(/No number/g) || []).length === 4, 'U13 those four say "No number"');
  TAMPER.delete('cmLinks');
  click(w, act(d, 'cm-close'));
}

/* ---------- U14. a file of the people ---------- */
{
  const { d, w } = A;
  await switchRace(A, EV);
  await pick(A, 'cat', '10 K');
  const nd = downloads.length;
  const nb = blobs.length;
  clearToast(d);
  click(w, act(d, 'cm-file'));
  await until(() => downloads.length > nd && /File ready/.test(toastOf(d)));
  const ex = cmc('cmExport').pop().arg;
  eq([ex.aud, ex.cols, ex.from], [{ who: 'runners', pay: 'paid', cat: '10 K', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, ['name', 'bib', 'cat', 'email'], 0], 'U14 the file is asked for with the people chosen on the screen and the four ticked columns');
  eq(downloads.slice(nd), ['vhm-comms-edition-people.csv'], 'U14 and is named after the race');
  const b = blobs[nb];
  ok(b.type === 'text/csv;charset=utf-8' && b.text.charCodeAt(0) === 65279, 'U14 it is a CSV file with a byte-order mark, so a spreadsheet reads the letters right');
  const lines = b.text.slice(1).split('\r\n').filter((x) => x !== '');
  eq(lines[0], '"Name","Bib","Category","E-mail"', 'U14 the first line is the column names');
  eq(lines.length, 7, 'U14 then one line for each of the six people');
  ok(lines[1] === '"Asha Rao","101","10 K","asha@example.com"' && lines[2] === '"BINA RAO","102","10 K","bina@example.com"', 'U14 the first two rows are Asha and Bina, the address in lower case');
  ok(/6 rows in the file\./.test(txt(q(d, '#cmFileMsg'))), 'U14 the screen says 6 rows');
  // a name that is a formula does not become one
  await pick(A, 'cat', '5 K');
  const nb2 = blobs.length;
  click(w, act(d, 'cm-file'));
  await until(() => blobs.length > nb2);
  const l2 = blobs[nb2].text.slice(1).split('\r\n').filter((x) => x !== '');
  ok(l2.length === 4 && !l2.some((x) => /^"=|,"=|^"@|^"\+|^"-/.test(x)) && l2.some((x) => x.indexOf('"\'=HYPERLINK') === 0), 'U14 a name that starts with = gets a quote mark in front, so a spreadsheet will not run it: ' + l2[2]);
  // columns
  await pick(A, 'cat', '10 K');
  for (const c of qa(d, '.cm-col')) tick(w, c, false);
  const nc = cmc('cmExport').length;
  clearToast(d);
  click(w, act(d, 'cm-file'));
  await sleep(100);
  ok(/Tick at least one column\./.test(toastOf(d)) && cmc('cmExport').length === nc, 'U14 with no column ticked, nothing is asked for');
  tick(w, q(d, '.cm-col[value="name"]'), true);
  tick(w, q(d, '.cm-col[value="phone"]'), true);
  const nb3 = blobs.length;
  click(w, act(d, 'cm-file'));
  await until(() => blobs.length > nb3);
  eq(cmc('cmExport').pop().arg.cols, ['name', 'phone'], 'U14 columns go in the order of the list, whatever the order they were ticked in');
  ok(blobs[nb3].text.slice(1).split('\r\n')[1] === '"Asha Rao","9812300101"', 'U14 a phone number is in the file when the director ticks it (it is a file they asked for, written in the audit trail)');
  ok(rows('RDAudit').filter((x) => x.action === 'audience exported').length === 3, 'U14 each download was written in the audit trail');
  // nobody to write
  await pick(A, 'result', 'fin');
  const nd2 = downloads.length;
  click(w, act(d, 'cm-file'));
  await until(() => /no file/.test(txt(q(d, '#cmFileMsg'))));
  ok(downloads.length === nd2, 'U14 with nobody chosen there is no file');
  await pick(A, 'result', 'any');
  // a big race comes in pages and is joined
  await switchRace(A, EVX);
  const nx = cmc('cmExport').length;
  const nb4 = blobs.length;
  click(w, act(d, 'cm-file'));
  await until(() => blobs.length > nb4, 10000);
  eq(cmc('cmExport').slice(nx).map((c) => c.arg.from), [0, 1000], 'U14 a race of 1003 is asked for in two pages');
  const l4 = blobs[nb4].text.slice(1).split('\r\n').filter((x) => x !== '');
  ok(l4.length === 1004 && l4[0] === '"Name","Bib","Category","E-mail"' && l4.filter((x) => x === l4[0]).length === 1, 'U14 and joined into one file: the column names once, then 1003 rows');
  ok(/1003 rows in the file\./.test(txt(q(d, '#cmFileMsg'))), 'U14 the screen says 1003 rows');
  await switchRace(A, EV);
}

/* ---------- U15. a test e-mail ---------- */
{
  const { d, w } = A;
  await subTo(A, 'set');
  const to = q(d, '#cmTestTo');
  const tp = q(d, '#cmTestTpl');
  eq(optsOf(tp), ['Your bib', 'Race kit collection', 'Race week information', 'Thank you and results', 'Volunteer reminder'], 'U15 the test can use any message that is not archived');
  clearToast(d);
  click(w, act(d, 'cm-test'));
  await sleep(80);
  ok(/Type the address to send the test to\./.test(toastOf(d)) && cmc('cmTest').length === 0, 'U15 with no address nothing is sent');
  set(w, to, 'me@vtra.run');
  ok(q(d, '#cmTestTo') === to && to.value === 'me@vtra.run', 'U15 typing the address does not rebuild the field');
  crmReset();
  click(w, act(d, 'cm-test'));
  await until(() => /Test sent to me@vtra\.run/.test(txt(q(d, '#cmTestMsg'))));
  eq(cmc('cmTest').pop().arg.to, 'me@vtra.run', 'U15 the test goes to the address typed');
  ok(cmc('cmTest').pop().arg.tplId === 'bib' && CRM.sent.length === 1 && CRM.sent[0].variables.subject === '[TEST] Your bib for VHM Comms Edition: 123' && CRM.sent[0].emailId === 'vtra_mail', 'U15 it is the chosen message with made-up details, marked [TEST], through the Wix e-mail');
  set(w, to, 'nope');
  click(w, act(d, 'cm-test'));
  await until(() => /valid email address/.test(txt(q(d, '#cmTestMsg'))));
  ok(CRM.sent.length === 1, 'U15 an address that is not one is refused, and nothing is sent');
  CRM.contacts.set('u-quiet', { _id: 'u-quiet', info: { name: { first: 'Quiet' }, emails: [{ email: 'quiet@vtra.run' }], extendedFields: { 'emailSubscriptions.subscriptionStatus': 'UNSUBSCRIBED' } } });
  set(w, to, 'quiet@vtra.run');
  click(w, act(d, 'cm-test'));
  await until(() => /Not sent: that address asked not to get e-mails\./.test(txt(q(d, '#cmTestMsg'))));
  ok(CRM.sent.length === 1, 'U15 somebody who asked Wix not to get e-mails does not get a test, and the screen says why');
  CRM.fail.email = () => {
    throw new Error('Wix says no (code 12)');
  };
  set(w, to, 'me@vtra.run');
  click(w, act(d, 'cm-test'));
  await until(() => /Not sent: Wix says no \(code 12\)/.test(txt(q(d, '#cmTestMsg'))));
  CRM.fail = {};
  ok(CRM.sent.length === 1, 'U15 when Wix refuses, the screen shows what Wix said');
  change(w, tp, 'volunteer');
  click(w, act(d, 'cm-test'));
  await until(() => /Test sent/.test(txt(q(d, '#cmTestMsg'))) && CRM.sent.length === 2);
  ok(cmc('cmTest').pop().arg.tplId === 'volunteer' && /^\[TEST\] Thank you for volunteering at VHM Comms Edition$/.test(CRM.sent[1].variables.subject), 'U15 another message can be tested');
  click(w, act(d, 'cm-test'));
  await until(() => /Test sent/.test(txt(q(d, '#cmTestMsg'))) && CRM.sent.length === 3);
  click(w, act(d, 'cm-test'));
  await until(() => /Five test e-mails were sent in the last hour/.test(txt(q(d, '#cmTestMsg'))));
  ok(CRM.sent.length === 3 && rows('RDComms').filter((x) => x.kind === 'tst' && x.event === EV && x.status !== 'refused').length === 5, 'U15 the sixth test within the hour is refused');
  noPii(d, 'U15 the screen holds no address or phone number');
}

/* ---------- U16. the messages themselves ---------- */
{
  const { d, w } = A;
  await subTo(A, 'tpl');
  const cards = () => qa(d, '.content .card').filter((c) => /Subject:/.test(txt(c)));
  eq(cards().length, 5, 'U16 five standard messages');
  ok(cards().every((c) => /Standard wording/.test(txt(c)) && !!c.querySelector('[data-act="cm-tpl-edit"]') && !!c.querySelector('[data-act="cm-tpl-arch"]')), 'U16 each says "Standard wording" and has Edit and Archive');
  ok(/Volunteers/.test(txt(cards()[4])) && /Runners/.test(txt(cards()[0])), 'U16 and who it goes to');
  click(w, act(d, 'cm-tpl-new'));
  await sleep(60);
  const f = () => q(d, '#cmTplForm');
  ok(!!f() && /Words in curly brackets are filled in for each person: \{name\} \{firstname\} \{bib\} \{bibname\} \{cat\} \{size\} \{wave\} \{start\} \{corral\} \{time\} \{place\} \{race\} \{date\} \{venue\} \{link\}\./.test(txt(f())), 'U16 "New message" opens a form that lists the words for runners');
  change(w, f().elements.kind, 'volunteer');
  await sleep(40);
  ok(/\{name\} \{firstname\} \{race\} \{date\} \{venue\} \{link\}\./.test(txt(f())), 'U16 choosing volunteers lists the words for volunteers');
  change(w, f().elements.kind, 'runner');
  await sleep(40);
  set(w, f().elements.name, 'Pre-race tips');
  set(w, f().elements.subject, 'Tips for {race}');
  set(w, f().elements.body, 'Hello {firstname},\n\nWarm up well, {nmae}.\n\nSee you at {venue}.');
  ok(/Not a word that can be filled in: \{nmae\}\. Check the spelling, or take it out\./.test(txt(q(d, '#cmEUnk'))), 'U16 a word that does not exist is called out as it is typed');
  clearToast(d);
  submit(w, f());
  await until(() => /uses a word in curly brackets that does not exist/.test(toastOf(d)));
  ok(!!f() && f().elements.name.value === 'Pre-race tips' && /nmae/.test(f().elements.body.value), 'U16 the server refuses it, the form stays open with what was typed');
  const bad = cmc('cmSaveTemplate').pop().arg;
  ok(/^t[a-z0-9]{6,}$/.test(bad.id) && bad.kind === 'runner' && bad.archived === false, 'U16 the message has an id of its own, made on the screen');
  set(w, f().elements.body, 'Hello {firstname},\n\nWarm up well.\n\nSee you at {venue}.');
  ok(q(d, '#cmEUnk').textContent === '', 'U16 mending the word clears the warning');
  click(w, act(d, 'cm-tpl-pv'));
  await until(() => /Showing a made-up runner/.test(txt(q(d, '#cmEPv'))));
  eq(cmc('cmPreview').pop().arg.tpl, { name: 'Pre-race tips', kind: 'runner', subject: 'Tips for {race}', body: 'Hello {firstname},\n\nWarm up well.\n\nSee you at {venue}.' }, 'U16 "Show how it looks" previews the text typed, without saving');
  ok(/Subject: Tips for VHM Comms Edition/.test(txt(q(d, '#cmEPv'))) && /Hello Sample,/.test(txt(q(d, '#cmEPv'))) && /See you at RK Beach\./.test(txt(q(d, '#cmEPv'))), 'U16 with made-up details');
  eq(rows('RDComms').filter((x) => x.kind === 'tpl').length, 0, 'U16 nothing was saved by that');
  clearToast(d);
  submit(w, f());
  await until(() => /Message saved/.test(toastOf(d)));
  await until(() => !f() && cards().length === 6);
  ok(!f() && cards().length === 6 && /Pre-race tips/.test(txt(cards()[5])) && /Runners/.test(txt(cards()[5])) && !/Standard wording/.test(txt(cards()[5])), 'U16 saving closes the form and the message is in the list');
  eq(rows('RDComms').filter((x) => x.kind === 'tpl').length, 1, 'U16 and kept');
  // it can be chosen on the Send screen
  await subTo(A, 'send');
  ok(optsOf(selOf(d, 'tplId')).indexOf('Pre-race tips') === 5 - 1, 'U16 the Send screen offers it as a message');
  await subTo(A, 'tpl');
  // edit a standard message
  click(w, act(d, 'cm-tpl-edit', '[data-id="bib"]'));
  await sleep(60);
  ok(!!f() && f().elements.name.value === 'Your bib' && !f().elements.kind && q(f(), 'input[disabled]').value === 'Runners', 'U16 Edit opens the standard message; who it goes to cannot be changed');
  set(w, f().elements.subject, 'Bib {bib} for {race}');
  submit(w, f());
  await until(() => /Message saved/.test(toastOf(d)));
  await until(() => !f());
  ok(/Edited/.test(txt(cards()[0])) && !/Standard wording/.test(txt(cards()[0])) && /Subject: Bib \{bib\} for \{race\}/.test(txt(cards()[0])), 'U16 it now says "Edited" and shows the new subject');
  // a name that is markup stays text
  click(w, act(d, 'cm-tpl-new'));
  await sleep(60);
  set(w, f().elements.name, '<b>Bold</b> & "q"');
  set(w, f().elements.subject, '<img src=x onerror=1>Hi {race}');
  set(w, f().elements.body, 'Hello {firstname}.\n\n<script>window.__pwn2=1</script>');
  submit(w, f());
  await until(() => /Message saved/.test(toastOf(d)));
  await until(() => !f());
  const mk = [!q(d, '.content img'), !q(d, '.content script'), A.w.__pwn2 === undefined, content(d).indexOf('bBold/b & "q"') >= 0, content(d).indexOf('scriptwindow.__pwn2=1/script') >= 0, rows('RDComms').filter((x) => x.kind === 'tpl').every((x) => !/[<>]/.test(x.json))];
  ok(mk.every(Boolean), 'U16 markup in a message loses its angle brackets when kept, is shown as plain text, and runs nothing ' + JSON.stringify(mk));
  // archive and restore
  const nameOf = (i) => txt(cards()[i].querySelector('b'));
  const idx = cards().findIndex((c) => /Pre-race tips/.test(txt(c)));
  click(w, cards()[idx].querySelector('[data-act="cm-tpl-arch"]'));
  await until(() => /Message archived/.test(toastOf(d)));
  await until(() => /Archived/.test(txt(cards()[idx])));
  ok(cmc('cmSaveTemplate').pop().arg.archived === true && /Restore/.test(txt(cards()[idx])), 'U16 Archive marks it archived and the button becomes Restore');
  await subTo(A, 'send');
  ok(optsOf(selOf(d, 'tplId')).indexOf('Pre-race tips') < 0 && optsOf(selOf(d, 'notSent')).indexOf('Pre-race tips (archived)') >= 0, 'U16 an archived message is not offered to send, but can still be used to leave out people who got it');
  await subTo(A, 'tpl');
  click(w, cards()[idx].querySelector('[data-act="cm-tpl-arch"]'));
  await until(() => /Message restored/.test(toastOf(d)));
  await subTo(A, 'send');
  ok(optsOf(selOf(d, 'tplId')).indexOf('Pre-race tips') >= 0, 'U16 Restore brings it back');
  await subTo(A, 'tpl');
  eq(nameOf(0), 'Your bib', 'U16 the list keeps its order');
  noPii(d, 'U16 the screen holds no address or phone number');
}

/* ---------- U17. a lead looks, and cannot change ---------- */
{
  const { d, w } = L1;
  await subTo(L1, 'send');
  ok(!!selOf(d, 'tplId') && /12 people/.test(auText(d)) && /Showing bib 1, /.test(pvText(d)), 'U17 a lead sees who a message reaches and how it looks');
  ok(!act(d, 'cm-prep') && !act(d, 'cm-file') && !q(d, '#cmGo') && !q(d, '#cmTestTo') && !/Send it/.test(content(d)) && !/A file of these people/.test(content(d)), 'U17 and has no Send card, no file, no test box');
  await subTo(L1, 'tpl');
  ok(!act(d, 'cm-tpl-new') && !act(d, 'cm-tpl-edit') && !act(d, 'cm-tpl-arch') && qa(d, '.content .card').filter((c) => /Subject:/.test(txt(c))).length >= 5, 'U17 the messages are listed without New, Edit or Archive');
  await subTo(L1, 'hist');
  ok(qa(d, '[data-act="cm-open"]').length === batchesOf(EV).length && batchesOf(EV).length === 3 && qa(d, '.content table tr').length === 4, 'U17 the history lists the three batches of this race, and none of the other races\'');
  const n = cmc('cmBatch').length;
  click(w, act(d, 'cm-open'));
  await until(() => cmc('cmBatch').length > n && /sent|waiting/.test(goText(d)));
  ok(!!act(d, 'cm-rep') && !!act(d, 'cm-close') && !act(d, 'cm-send') && !act(d, 'cm-retry') && !act(d, 'cm-wa') && !act(d, 'cm-wa-mark'), 'U17 an opened batch shows how it went, with no way to send, retry or open chats');
  const used = [...new Set(L1.calls.filter((c) => c.mod === 'comms').map((c) => c.method))].sort();
  ok(used.every((m) => ['cmOverview', 'cmAudience', 'cmPreview', 'cmBatch'].includes(m)), 'U17 the lead\'s page only used the four looking methods: ' + used.join(', '));
  ok(!PII.test(L1.d.body.innerHTML), 'U17 the lead\'s page holds no address or phone number');
}

/* ---------- U18. old page code, a lost session, logging out ---------- */
{
  const X = await login('dir.two');
  OLD.comms = true;
  clearToast(X.d);
  click(X.w, tabBtn(X.d, 'comms'));
  await until(() => /out of date/.test(content(X.d)));
  ok(/This page's code is out of date\. Paste the latest page-code\.js for this page, then publish\./.test(content(X.d)) && !!act(X.d, 'retry'), 'U18 a page code that does not know the Messages calls is explained, with Try again');
  OLD.comms = false;
  click(X.w, act(X.d, 'retry'));
  await until(() => q(X.d, '#cmAudForm'));
  await settled();
  ok(!!q(X.d, '#cmAudForm'), 'U18 after the page code is mended, Try again opens the tab');
  // a choice is made, then the session ends
  await pick(X, 'cat', '10 K');
  const row = rows('ExpoSessions').filter((r) => r.username === 'dir.two').pop();
  await wd.update('ExpoSessions', Object.assign({}, row, { expires: new Date(Date.now() - 1000).toISOString() }), SA);
  change(X.w, selOf(X.d, 'bib'), 'has');
  await until(() => q(X.d, '#loginForm'));
  ok(!!q(X.d, '#loginForm') && /Your session ended\. Please log in again\./.test(txt(q(X.d, '#lgErr'))), 'U18 a lost session goes to the login page with the reason');
  ok(!/Asha|Runners|10 K/.test(X.d.body.innerHTML.replace(/<form id="loginForm"[\s\S]*$/, '')), 'U18 and the page holds nothing of the tab');
  set(X.w, q(X.d, '#lgUser'), 'dir.two');
  set(X.w, q(X.d, '#lgPass'), pw['dir.two']);
  submit(X.w, q(X.d, '#loginForm'));
  await until(() => q(X.d, '.tab'));
  await openTab(X);
  ok(selOf(X.d, 'cat').value === '' && selOf(X.d, 'bib').value === 'any' && /12 people/.test(auText(X.d)), 'U18 logging in again starts the tab from the standard choices');
  clearToast(X.d);
  click(X.w, act(X.d, 'logout'));
  await until(() => q(X.d, '#loginForm'));
  ok(!!q(X.d, '#loginForm') && !/Asha|Wave|VHM Comms/.test(X.d.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '')), 'U18 logging out leaves no names or messages on the page');
}

/* ---------- U20. a hostile answer: whatever the server says, the screens show it as text ---------- */
{
  const PAY = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script> &amp; "\'';
  const SHOWN = new Set(['name', 'tplName', 'label', 'by', 'bib', 'cat', 'venue', 'subject', 'body', 'why', 'status', 'whatsapp', 'emailId', 'link', 'head']);
  const evil = (o, k) => {
    if (typeof o === 'string') return k && SHOWN.has(k) ? PAY + o : o;
    if (Array.isArray(o)) return o.map((x) => evil(x, k === 'paras' ? 'name' : k));
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([key, v]) => [key, evil(v, key)]));
    return o;
  };
  TAMPER.set('cmOverview', (o) => evil(o));
  TAMPER.set('cmPreview', (o) => evil(o));
  TAMPER.set('cmAudience', (o) => {
    const r = evil(o);
    r.missing = Object.assign({}, r.missing, { [PAY]: 4 });
    return r;
  });
  TAMPER.set('cmBatch', (o) => {
    const r = evil(o);
    r.problems = [{ name: PAY, bib: PAY, status: PAY, why: PAY }];
    r.moreProblems = 2;
    return r;
  });
  const H = await login('owner', { ev: EV });
  const { d, w } = H;
  const live = () => [w.__pwn, qa(d, '[onerror], [onclick], [onload], [onfocus]').length, qa(d, '.content img, .content iframe, .content object, .content embed, .content script, .content a[href^="javascript"]').length];
  const asText = /<img src=x onerror="window\.__pwn=1">/;
  const sub = async (name) => {
    click(w, qa(d, '[data-act="cm-sub"]').find((x) => txt(x) === name));
    await sleep(150);
  };
  await openTab(H);
  eq(live(), [undefined, 0, 0], 'U20 the first screen, with markup in every name, label, subject and message it is told, has no live element and ran no script');
  ok(asText.test(auText(d)) && asText.test(pvText(d)) && /\{<img src=x/.test(auText(d)), 'U20 and shows that text as it is: in the audience (names, bibs, categories, the blank placeholders) and in the preview');
  await subTo(H, 'hist');
  eq(live(), [undefined, 0, 0], 'U20 the history has none either');
  ok(asText.test(content(d)), 'U20 and shows the batch labels and message names as text');
  const nb = cmc('cmBatch').length;
  click(w, act(d, 'cm-open'));
  await until(() => cmc('cmBatch').length > nb);
  await sleep(150);
  eq(live(), [undefined, 0, 0], 'U20 an opened batch has none');
  ok((goText(d).match(/<img src=x onerror="window\.__pwn=1">/g) || []).length >= 4, 'U20 and the person it did not reach (name, bib, state and reason) is shown as text');
  await sub('Templates');
  eq(live(), [undefined, 0, 0], 'U20 the list of messages has none');
  ok(asText.test(content(d)), 'U20 and shows their names and subjects as text');
  click(w, qa(d, '[data-act="cm-tpl-edit"]')[0]);
  await sleep(150);
  eq(live(), [undefined, 0, 0], 'U20 an open message has none');
  ok(qa(d, '#cmTplForm input, #cmTplForm textarea').some((el) => el.value.indexOf('<img src=x onerror=') === 0), 'U20 and its fields hold the hostile text as a value, not as markup');
  await sub('Settings');
  eq(live(), [undefined, 0, 0], 'U20 the settings have none');
  ok(qa(d, 'input').some((el) => el.value.indexOf('<img src=x onerror=') === 0), 'U20 and its fields hold the hostile text as a value');
  for (const m of ['cmOverview', 'cmPreview', 'cmAudience', 'cmBatch']) TAMPER.delete(m);
}

/* ---------- U19. the whole run ---------- */
{
  const keep = answers.filter((a) => a.method !== 'cmLinks' && a.method !== 'cmExport');
  ok(!keep.some((a) => PII.test(JSON.stringify(a.out))), 'U19 across the whole run, none of the ' + keep.length + ' answers of the Messages server (leaving out the chat links and the file) held an address or a phone number');
  const links = answers.filter((a) => a.method === 'cmLinks');
  ok(links.length > 0 && links.every((a) => !/@example\.com/.test(JSON.stringify(a.out))), 'U19 the chat links hold phone numbers and no address');
  ok(!cmc().some((c) => !c.arg || typeof c.arg.token !== 'string' || c.arg.token.length < 20), 'U19 every Messages call was sent with a login token');
  ok(cmc().every((c) => !!c.arg.ev), 'U19 and named the race');
  const sent = JSON.stringify(cmc().map((c) => Object.assign({}, c.arg, { token: undefined })));
  ok(!/98123\d{5}|@example\.com/.test(sent), 'U19 nothing the screen sent held an address or a phone number of a runner');
  const methods = [...new Set(cmc().map((c) => c.method))].sort();
  eq(methods, ['cmAudience', 'cmBatch', 'cmExport', 'cmLinks', 'cmMark', 'cmOverview', 'cmPrepare', 'cmPreview', 'cmSaveSettings', 'cmSaveTemplate', 'cmSend', 'cmTest'], 'U19 the run used all twelve Messages methods');
  ok(cmc().every((c) => c.mod === 'comms'), 'U19 and every one was tagged for the Messages side of the page code');
  const dup = {};
  for (const s of CRM.sent) if (!/^\[TEST\]/.test(s.variables.subject)) dup[s.variables.subject] = (dup[s.variables.subject] || 0) + 1;
  eq(Object.values(dup).filter((n) => n > 1), [], 'U19 no person was sent the same message twice in the last stretch of the run');
  eq(jserr, [], 'U19 no script error was raised on any page');
}
done();
