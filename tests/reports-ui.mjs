// COMPONENT + INTEGRATION TESTS (screen): the Reports tab of the Director page, in jsdom, on the real RaceOS, Results, Messages, Waivers,
// Finance and Reports backend code. A director picks a report and sees its tables (the numbers on the screen are the numbers the server
// sent), the Money report is for directors only (a lead has no such button), any table can be saved as a CSV file (one press saves once,
// the file starts with a byte-order mark so a spreadsheet reads it right, a word that looks like a formula is made safe), a report can
// be made again, an answer that arrives late does not overwrite a newer pick, a failed call is explained, a lost session ends the page,
// and nothing the server sends (a category called <img onerror>) ever becomes markup. A viewer has no such tab.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as RP from './reports.test.mjs';
import * as RS from './results.test.mjs';
import * as CM from './comms.test.mjs';
import * as F from './finance.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Reports: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const fc = String.fromCharCode;
const jserr = [];
const calls = [];
const FAIL = new Map(); // method -> { code, skip }: the code is given instead of the real answer, once
const DELAY = new Map(); // method -> [ms, ...]: the next answers are held back that long
const TAMPER = new Map(); // method -> function: changes the answer before the page gets it
const OLD = { rp: false }; // the page code on the site does not know the Reports calls yet
const REPL = { rp: 0 }; // how many Reports calls have been answered
const downloads = [];
const blobs = [];
let kseq = 0;
const K = () => 'uk' + (++kseq).toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- the world ---------- */
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
const RD = istDay(40);
const RDY = parseInt(RD.slice(0, 4), 10);
const mkRace = async (name, venue, cats) => {
  const e = (await R.saveEvent({ token: OT, name, date: RD, venue })).event.id;
  await R.saveCats({ token: OT, ev: e, cats });
  await RS.resSaveSettings({ token: OT, ev: e, settings: { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], map: { gender: 'Gender', dob: 'Date of birth', age: '', seed: '' } } });
  return e;
};
const K10 = { name: '10 K', km: 10, price: 800, cap: 9000 };
const K21 = { name: '21 K', km: 21.0975, price: 1200, cap: 9000 };
const EV = await mkRace('VHM Report Edition', 'RK Beach', [K10, K21]);
const EV2 = await mkRace('Other Report Run', 'Paderu', [K10]);
const EVE = await mkRace('Empty Report Run', 'Stadium', [K10]);
const EVB = await mkRace('Big Report Run', 'Stadium', [K10]);
const IMG = '<img src=x onerror="window.__pwn=1">';
const FORMULA = '=HYPERLINK("http://evil","click")';
const form = (g, age) => JSON.stringify([{ name: 'Gender', value: g || '' }, { name: 'Date of birth', value: age ? RDY - age + '-01-01' : '' }]);
const regId = (ev, key) => 'REG~' + ev.slice(-6) + '~' + key;
const reg = (ev, p) => wd.insert('RDRegs', { _id: regId(ev, p.key || p.bib), event: ev, name: p.name, cat: p.cat === undefined ? '10 K' : p.cat, bib: p.bib || '', bibName: '', size: p.size === undefined ? 'M' : p.size, status: p.status || 'ok', phone: p.phone || '', email: p.email || '', form: form(p.g, p.age), at: p.at || '2026-11-03T05:00:00.000Z' }, SA);
const PPL = [
  { bib: '101', name: 'Asha Rao', g: 'F', age: 25, size: 'M', email: 'asha@example.com', phone: '9812300101' },
  { bib: '102', name: 'BINA RAO', g: 'F', age: 45, size: 'S', email: 'bina@example.com', phone: '9812300102', at: '2026-11-01T20:00:00.000Z' },
  { bib: '103', name: 'Chitra Devi', g: 'F', age: 62, size: 'L', email: 'chitra@example.com', phone: '9812300103', at: '2026-11-02T03:00:00.000Z' },
  { bib: '104', name: 'Dev Raman', cat: '21 K', g: 'M', age: 33, size: 'XL', email: 'dev@example.com', phone: '9812300104' },
  { bib: '105', name: 'Esha Nair', cat: '21 K', g: 'M', age: 16, size: 'M', email: 'esha@example.com', phone: '' },
  { bib: '106', name: 'Farah Khan', cat: '21 K', size: '', status: 'pending', email: 'farah@example.com', phone: '9812300106' },
  { bib: '107', name: 'Eve ' + IMG, cat: IMG, g: 'X', age: 28, size: 'a@b.com', email: 'eve@example.com', phone: '9812300107' },
  { bib: '108', name: 'Zed "Sons" <b>bold</b>', cat: FORMULA, g: 'M', age: 51, size: '9876543210', email: 'zed@example.com', phone: '9812300302' },
];
for (const p of PPL) await reg(EV, p);
await reg(EV2, { bib: '101', name: 'Other Race Olga', g: 'F', age: 33, email: 'olga@example.com', phone: '9812300777' });
const big = [];
for (let i = 0; i < 460; i++) big.push({ _id: 'REG~big~' + i, event: EVB, name: 'B' + i, cat: 'Category ' + String(i).padStart(3, '0'), bib: String(8000 + i), bibName: '', size: 'M', status: 'ok', phone: '', email: '', form: '', at: '2026-11-03T05:00:00.000Z' });
await wd.bulkInsert('RDRegs', big, SA);
const res = (ev, o) => wd.insert('RDResults', Object.assign({ _id: 'rs~' + ev + '~' + o.bib, event: ev, name: '', gender: '', dob: '', age: '', note: '', regId: '', by: 'owner', at: '2027-02-07T03:00:00.000Z', void: 'no', voidBy: '', voidAt: '', voidReason: '', prev: '' }, o), SA);
for (const [bib, cat, cs] of [['101', '10 K', 360000], ['102', '10 K', 400000], ['103', '10 K', 500000], ['104', '21 K', 720000]]) await res(EV, { bib, cat, status: 'fin', gunCs: String(cs), chipCs: String(cs) });
await res(EV, { bib: '105', cat: '21 K', status: 'dnf', gunCs: '0', chipCs: '0' });
const shift = async (ev, role, start, end, need) => (await R.saveShift({ token: OT, ev, role, date: RD, start, end, need, location: 'Somewhere' })).id;
const S1 = await shift(EV, 'Marshal', '07:00', '11:00', 3);
await shift(EV, IMG, '12:00', '15:00', 2);
await wd.insert('RDVolunteers', { _id: 'VOL~' + EV.slice(-6) + '~1', event: EV, name: 'Vol One', phone: '9812300501', email: 'vol1@example.com', club: '', status: 'approved', code: 'C1', waiverAt: '', waiverVersion: '', createdAt: new Date().toISOString(), notes: '' }, SA);
await R.assignShift({ token: OT, ev: EV, volunteerId: 'VOL~' + EV.slice(-6) + '~1', shiftId: S1 });
await CM.cmSaveTemplate({ token: OT, ev: EV, id: 'news1', name: 'Race week news', kind: 'runner', subject: 'Hello {race}', body: 'Hello {firstname}' });
await wd.insert('RDComms', { _id: 'rcp~1', event: EV, kind: 'rcp', ref: 'b1', sub: 'news1', who: regId(EV, '101'), status: 'sent', why: '', json: '', by: 'owner', at: '2027-01-01T00:00:00.000Z' }, SA);
const fin$ = (fn, o) => F[fn](Object.assign({ token: OT, ev: EV }, o));
const inv = await fin$('finRaiseInvoice', { party: 'Acme Corp', lines: [{ desc: 'Title sponsorship', qty: 1, rate: '500000', taxPct: 18 }, { desc: 'Banner space', qty: 2, rate: '10000', taxPct: 0 }], key: K() });
await fin$('finPayInvoice', { id: inv.id, amount: '300000', mode: 'bank', ref: 'UTR1', key: K() });
const ord = await fin$('finSaveOrder', { vendor: 'Medal House', title: 'Finisher medals', cat: FORMULA, estimate: '2500000', key: K() });
await fin$('finPayOrder', { id: ord.id, amount: '1000000', phase: 'advance', mode: 'bank', ref: 'ADV-1', key: K() });
await fin$('finAddCash', { type: 'withdrawal', amount: '500000', holder: 'Cash Holder Ravi', key: K() });
const PII = /@example\.com|98123\d{5}|Asha Rao|BINA RAO|Chitra Devi|Dev Raman|Esha Nair|Farah Khan|Vol One|Acme|Medal House|Ravi/;
const LIST = await RP.rpList({ token: OT, ev: EV });
const TITLE = Object.fromEntries(LIST.reports.map((r) => [r.id, r.title]));
const REPORTS = ['reg', 'race', 'vol', 'waiver', 'msg', 'money'];

/* ---------- a page, the way a browser would run it ---------- */
function openPage() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const d = w.document;
  try {
    w.localStorage.setItem('rd.ev', EV);
  } catch (x) {
    // no storage: the page opens on the first race
  }
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => 'blob:test';
  w.Blob = function (parts, o) {
    this.text = parts.join('');
    this.type = (o && o.type) || '';
    blobs.push(this);
  };
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  const P = { w, d, calls: [] };
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    const mod = m.mod || 'rd';
    const rec = { method: m.method, mod, arg: m.arg };
    calls.push(rec);
    P.calls.push(rec);
    const track = mod === 'rp';
    const reply = (o) => {
      if (track) REPL.rp++;
      w.postMessage(Object.assign({ kind: 'result', id: m.id }, o), '*');
    };
    if (track && OLD.rp) return reply({ ok: false, error: 'page_code_old' });
    const f = track ? FAIL.get(m.method) : null;
    if (f) {
      if (f.skip > 0) f.skip--;
      else {
        FAIL.delete(m.method);
        const held = DELAY.get(m.method);
        if (held && held.length) await sleep(held.shift());
        return reply({ ok: false, error: f.code });
      }
    }
    const lib = mod === 'rp' ? RP : R;
    try {
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
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
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
  return norm(out.join(''));
};
const set = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const change = (w, el, v) => {
  el.value = v;
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
const content = (d) => txt(q(d, '.content'));
const rpc = (m) => calls.filter((c) => c.mod === 'rp' && (!m || c.method === m));
const act = (d, a, extra) => q(d, `[data-act="${a}"]${extra || ''}`);
// every call has been answered and drawn, and nothing new was asked for a moment
const settle = async (ms) => {
  let last = -1;
  let stable = 0;
  const t = Date.now();
  while (Date.now() - t < (ms || 10000)) {
    const n = rpc().length;
    if (n === last && REPL.rp >= n) {
      if (++stable >= 4) return;
    } else stable = 0;
    last = n;
    await sleep(20);
  }
};
const openTab = async (P) => {
  const n = rpc('rpList').length;
  clearToast(P.d);
  click(P.w, tabBtn(P.d, 'rp'));
  await until(() => rpc('rpList').length > n);
  await settle();
};
const pickBtn = (d, id) => act(d, 'rp-pick', `[data-id="${id}"]`);
const pickReport = async (P, id) => {
  const n = rpc('rpRun').length;
  click(P.w, pickBtn(P.d, id));
  await until(() => rpc('rpRun').length > n);
  await settle();
};
const cards = (d) => qa(d, '.rp-table');
const tableRows = (card) => {
  const t = card.querySelector('table');
  return t ? [...t.rows].map((tr) => [...tr.cells].map(txt)) : null;
};
const fmR = (n) => {
  n = Number(n) || 0;
  const a = Math.abs(n);
  return (n < 0 ? '-' : '') + fc(0x20b9) + a.toLocaleString('en-IN', { minimumFractionDigits: Math.round(a) === a ? 0 : 2, maximumFractionDigits: 2 });
};
const fmt = (v, kind) => (typeof v === 'number' ? (kind === 'r' ? fmR(v) : kind === 'p' ? v.toFixed(1) + '%' : v.toLocaleString('en-IN')) : norm(v));
// what the screen must show for the tables the server sent
const shown = (out) => out.tables.map((t) => ({ title: norm(t.title), rows: t.rows.length ? [t.cols.map((c) => norm(c.label))].concat(t.rows.map((r) => r.map((v, i) => fmt(v, t.cols[i] && t.cols[i].kind)))) : null }));
const onScreen = (d) => cards(d).map((c) => ({ title: txt(c.querySelector('h3')), rows: tableRows(c) }));
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

/* ---------- U0. the page script declares every function once ---------- */
// A second function with the same name silently replaces the first one for the whole page (the Results screens would start calling the
// Reports server). Every `function name(` at the start of a line in the page must be unique.
{
  const names = [...html.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
  const seen = new Map();
  names.forEach((n) => seen.set(n, (seen.get(n) || 0) + 1));
  const twice = [...seen].filter((x) => x[1] > 1).map((x) => x[0]);
  ok(names.length > 300, 'U0 the check reads the page script (' + names.length + ' functions)');
  ok(twice.length === 0, 'U0 no function is declared twice in the Director page: ' + twice.join(', '));
  ok(/function rpa\(m,a,ms\)\{return api\(m,a,ms,'rp'\)\}/.test(html) && /function ra\(m,a,ms\)\{return api\(m,a,ms,'res'\)\}/.test(html), 'U0 the Results helper still talks to Results and the Reports helper to Reports');
}

/* ---------- U1. who sees the tab ---------- */
const A = await login('owner');
{
  const { d } = A;
  const t = tabBtn(d, 'rp');
  ok(!!t && txt(t) === 'Reports', 'U1 a director has a "Reports" tab');
  ok(/Race day\s+Waves & results\s+Bibs & certificates\s+Race day\s+Safety\s+Reports\s+Reports\s+Admin/.test(txt(q(d, '.side'))) || /Safety\s+Reports\s+Reports/.test(txt(q(d, '.side'))), 'U1 it has a group of its own in the side menu, after Race day: ' + txt(q(d, '.side')).slice(-120));
}
const L1 = await login('lead.one');
ok(!!tabBtn(L1.d, 'rp') && txt(tabBtn(L1.d, 'rp')) === 'Reports', 'U1 a lead has the tab too');
const V1 = await login('view.one');
ok(!tabBtn(V1.d, 'rp'), 'U1 a viewer has no Reports tab');
ok(!/Reports/.test(txt(q(V1.d, '.side'))), 'U1 a viewer sees nothing about it in the menu');
ok(V1.calls.every((c) => c.mod !== 'rp'), 'U1 and the viewer\'s page never called the Reports server');
{
  // a tab button made up by hand (the page is the viewer's own): the page still asks the Reports server for nothing
  const forged = V1.d.createElement('button');
  forged.setAttribute('data-act', 'tab');
  forged.setAttribute('data-tab', 'rp');
  q(V1.d, '.content').appendChild(forged);
  click(V1.w, forged);
  await sleep(300);
  ok(V1.calls.every((c) => c.mod !== 'rp'), 'U1 a Reports tab button made up by hand does not make a viewer\'s page call the Reports server');
  forged.remove();
  click(V1.w, tabBtn(V1.d, 'overview'));
  await sleep(200);
}

/* ---------- U2. the first screen: pick a report ---------- */
{
  const { d } = A;
  await openTab(A);
  const first = rpc('rpList')[0];
  ok(!!first && first.arg.ev === EV && first.arg.token.length >= 20, 'U2 the list was asked for the selected race, with the login token');
  ok(rpc().every((c) => c.mod === 'rp'), 'U2 every call of the tab is tagged for the Reports side of the page code');
  eq(qa(d, '[data-act="rp-pick"]').map(txt), REPORTS.map((id) => TITLE[id]), 'U2 a director gets six reports to pick from');
  ok(q(d, '[role="tablist"][aria-label="Reports"]') !== null && qa(d, '[data-act="rp-pick"]').every((b) => b.getAttribute('role') === 'tab' && b.getAttribute('aria-selected') === 'false'), 'U2 they are a labelled tab list, none picked');
  ok(/Pick a report/.test(content(d)) && LIST.reports.every((r) => content(d).includes(norm(r.what))), 'U2 each report is described');
  ok(/Counts and totals only\. A report never shows a name, a bib, a phone number, an e-mail address or a date of birth, and any table can be saved as a CSV file\./.test(content(d)) && !/Money report is for directors/.test(content(d)), 'U2 and the page says what a report is');
  eq(cards(d).length, 0, 'U2 and no table is shown before a pick');
  // a lead
  const l = L1.d;
  await openTab(L1);
  eq(qa(l, '[data-act="rp-pick"]').map(txt), REPORTS.filter((r) => r !== 'money').map((id) => TITLE[id]), 'U2 a lead gets five: no Money');
  ok(/The Money report is for directors\./.test(content(l)), 'U2 and is told Money is for directors');
  ok(!/Money/.test(content(l).replace(/The Money report is for directors\./, '')), 'U2 and nothing else of it is on the lead\'s screen');
}

/* ---------- U3. each report on screen is what the server sent ---------- */
{
  const { d } = A;
  for (const id of REPORTS) {
    await pickReport(A, id);
    const server = await RP.rpRun({ token: OT, ev: EV, report: id });
    const want = shown(server);
    const got = onScreen(d);
    eq(got, want, 'U3 ' + id + ': every table, heading, column and number on the screen is what the server sent');
    ok(pickBtn(d, id).getAttribute('aria-selected') === 'true' && pickBtn(d, id).className.includes('pri') && qa(d, '[data-act="rp-pick"][aria-selected="true"]').length === 1, 'U3 ' + id + ': its button is the picked one, and only it');
    ok(norm(content(d)).includes(norm(server.report.what)) && /Made \S+/.test(content(d)) && !!act(d, 'rp-refresh'), 'U3 ' + id + ': it says what it is and when it was made, and has "Refresh"');
    eq(qa(d, '[data-act="rp-csv"]').map((b) => b.getAttribute('data-id')), server.tables.map((t) => t.id), 'U3 ' + id + ': every table has a "Save as CSV" button');
    ok(!/Not read/.test(content(d)), 'U3 ' + id + ': nothing was left unread');
    noPii(d, 'U3 ' + id + ': the screen holds no name, address or phone number');
    noMarkup(A, 'U3 ' + id + ': nothing a person typed became markup');
  }
  // a few numbers a director would read
  await pickReport(A, 'reg');
  const t = onScreen(d);
  eq(t[0].rows.slice(1), [['Registered', '8'], ['Paid', '7'], ['Not paid or cancelled', '1']], 'U3 reg: eight registered, seven paid, one not');
  ok(onScreen(d)[1].rows.some((r) => r.join('|') === '10 K|3|3|0') && onScreen(d)[1].rows.some((r) => r.join('|') === '21 K|3|2|1') && onScreen(d)[1].rows.some((r) => r.join('|') === 'Total|8|7|1'), 'U3 reg: by category: 10 K has 3, 21 K has 3 (one not paid), the total is 8');
  await pickReport(A, 'money');
  const m = content(d);
  ok(m.includes(fc(0x20b9) + '6,10,000') && m.includes(fc(0x20b9) + '3,00,000') && m.includes(fc(0x20b9) + '3,10,000'), 'U3 money: rupees are written the Indian way: invoiced ' + fc(0x20b9) + '6,10,000, received ' + fc(0x20b9) + '3,00,000, outstanding ' + fc(0x20b9) + '3,10,000');
  ok(/-₹|-₹/.test(m) || /Net so far/.test(m), 'U3 money: the result of the race is shown (a loss with a minus sign)');
  await pickReport(A, 'race');
  ok(/83\.3%|80\.0%|75\.0%|100\.0%/.test(content(d)), 'U3 race: the finish rate is a percentage with one decimal');
}

/* ---------- U4. the same on the lead\'s screen: five reports, none is Money ---------- */
{
  const { d } = L1;
  for (const id of REPORTS.filter((r) => r !== 'money')) {
    await pickReport(L1, id);
    const server = await RP.rpRun({ token: OT, ev: EV, report: id });
    eq(onScreen(d), shown(server), 'U4 ' + id + ': a lead sees the same tables');
  }
  ok(!pickBtn(d, 'money'), 'U4 and there is no Money button to press');
  const n = L1.calls.filter((c) => c.mod === 'rp' && c.arg.report === 'money').length;
  eq([n, L1.calls.filter((c) => c.method === 'rpRun').length], [0, 5], 'U4 the lead\'s page never asked for the Money report (it ran five reports)');
  // a button made up by hand for the Money report: the page only runs the reports on its own list
  const forged = d.createElement('button');
  forged.setAttribute('data-act', 'rp-pick');
  forged.setAttribute('data-id', 'money');
  q(d, '.content').appendChild(forged);
  const runs = L1.calls.filter((c) => c.method === 'rpRun').length;
  click(L1.w, forged);
  await sleep(200);
  eq(L1.calls.filter((c) => c.method === 'rpRun').length, runs, 'U4 a pick button made up for the Money report asks the server for nothing');
  forged.remove();
}

/* ---------- U5. saving a table as a CSV file ---------- */
{
  const { d, w } = A;
  await pickReport(A, 'reg');
  const a0 = rows('RDAudit').length;
  const dl0 = downloads.length;
  const catsBtn = act(d, 'rp-csv', '[data-id="cats"]');
  clearToast(d);
  click(w, catsBtn);
  click(w, catsBtn);
  await until(() => downloads.length > dl0);
  await settle();
  eq(rpc('rpCsv').length, 1, 'U5 two presses at once ask the server once');
  eq(rpc('rpCsv')[0].arg.report + '/' + rpc('rpCsv')[0].arg.table, 'reg/cats', 'U5 it asked for the table that was pressed');
  eq(downloads.slice(dl0), ['vhm-report-edition-reg-cats.csv'], 'U5 one file was saved, named after the race, the report and the table');
  const b = blobs[blobs.length - 1];
  ok(b.type === 'text/csv;charset=utf-8' && b.text.charCodeAt(0) === 0xfeff, 'U5 it is text/csv, UTF-8, and starts with a byte-order mark so that a spreadsheet reads it right');
  const server = (await RP.rpCsv({ token: OT, ev: EV, report: 'reg', table: 'cats' })).csv;
  eq(b.text.slice(1), server, 'U5 and the rest is the file the server made');
  ok(b.text.includes('"\'=HYPERLINK(""http://evil"",""click"")"') && !/(^|,|\r\n)"?=HYPERLINK/.test(b.text.slice(1)), 'U5 a category that looks like a formula has a quote put in front of it');
  ok(/^"Category","[^"]+","[^"]+","[^"]+"\r\n/.test(b.text.slice(1)) && /\r\n$/.test(b.text), 'U5 a header of labels, lines that end with a return and a line feed');
  ok(!PII.test(b.text), 'U5 the file holds no name, address or phone number');
  eq(toastOf(d), 'Saved vhm-report-edition-reg-cats.csv', 'U5 a toast says what was saved');
  const au = rows('RDAudit').filter((r) => r.action === 'report saved as CSV');
  eq([rows('RDAudit').length - a0, au[au.length - 2].by, au[au.length - 2].detail.startsWith('reg / cats')], [2, 'owner', true], 'U5 one line went to the audit trail for the press, under the director\'s name (the other is the test\'s own check call)');
  // a second press after the first was answered saves again
  click(w, catsBtn);
  await until(() => downloads.length > dl0 + 1);
  await settle();
  eq(downloads.length - dl0, 2, 'U5 pressing again later saves again');
  // every table of every report can be saved from the screen
  for (const id of REPORTS) {
    await pickReport(A, id);
    for (const btn of qa(d, '[data-act="rp-csv"]')) {
      const n = downloads.length;
      click(w, btn);
      await until(() => downloads.length > n);
      await settle();
      ok(downloads.length === n + 1 && /^vhm-report-edition-[a-z]+-[a-z0-9]+\.csv$/.test(downloads[downloads.length - 1]), 'U5 ' + id + ' / ' + btn.getAttribute('data-id') + ' was saved as ' + downloads[downloads.length - 1]);
    }
  }
  // a save that fails says so, saves nothing, and does not lock the button
  await pickReport(A, 'reg');
  const dn = downloads.length;
  FAIL.set('rpCsv', { code: 'server_error' });
  clearToast(d);
  click(w, act(d, 'rp-csv', '[data-id="sizes"]'));
  await until(() => /Something went wrong on the server/.test(toastOf(d)));
  await settle();
  ok(/Something went wrong on the server/.test(toastOf(d)) && downloads.length === dn, 'U5 a save that failed says so and saves nothing: ' + toastOf(d).slice(0, 60));
  click(w, act(d, 'rp-csv', '[data-id="sizes"]'));
  await until(() => downloads.length > dn);
  ok(downloads.length === dn + 1, 'U5 and the button still works afterwards');
  await settle();
  // a lead saves a table too, under the lead's name
  await pickReport(L1, 'vol');
  const a1 = rows('RDAudit').length;
  const l0 = downloads.length;
  click(L1.w, act(L1.d, 'rp-csv', '[data-id="roles"]'));
  await until(() => downloads.length > l0);
  await settle();
  const last = rows('RDAudit')[rows('RDAudit').length - 1];
  eq([rows('RDAudit').length - a1, last.by, last.detail.startsWith('vol / roles')], [1, 'lead.one', true], 'U5 a lead can save a table, and it is written under the lead\'s name');
}

/* ---------- U6. markup in a category or a role stays text ---------- */
{
  const { d } = A;
  await pickReport(A, 'reg');
  ok(content(d).includes(IMG) && content(d).includes(FORMULA), 'U6 a category that is a picture tag, and one that is a formula, are shown as the text they are');
  noMarkup(A, 'U6 and made no picture, no handler, no script');
  await pickReport(A, 'vol');
  ok(content(d).includes(IMG), 'U6 so is a role called that');
  noMarkup(A, 'U6 (roles)');
  await pickReport(A, 'money');
  ok(content(d).includes(FORMULA), 'U6 so is an order category called a formula');
  noMarkup(A, 'U6 (money)');
}

/* ---------- U7. late answers, refresh, and another race ---------- */
{
  const { d, w } = A;
  // two picks, the first slower: the screen is the second's
  await pickReport(A, 'reg');
  DELAY.set('rpRun', [600, 0]);
  const n = rpc('rpRun').length;
  click(w, pickBtn(d, 'vol'));
  click(w, pickBtn(d, 'msg'));
  await until(() => rpc('rpRun').length >= n + 2);
  await settle();
  const server = await RP.rpRun({ token: OT, ev: EV, report: 'msg' });
  eq(onScreen(d), shown(server), 'U7 two picks one after the other, the first answered late: the screen is the second report\'s');
  ok(pickBtn(d, 'msg').getAttribute('aria-selected') === 'true' && pickBtn(d, 'vol').getAttribute('aria-selected') === 'false', 'U7 and so is the picked button');
  // a pick that fails late does not take the screen from the pick made after it
  clearToast(d);
  FAIL.set('rpRun', { code: 'server_error', skip: 0 });
  DELAY.set('rpRun', [500]);
  const nf = rpc('rpRun').length;
  click(w, pickBtn(d, 'vol'));
  await until(() => rpc('rpRun').length > nf);
  click(w, pickBtn(d, 'reg'));
  await until(() => rpc('rpRun').length > nf + 1);
  await sleep(800);
  await settle();
  const serverReg = await RP.rpRun({ token: OT, ev: EV, report: 'reg' });
  eq(onScreen(d), shown(serverReg), 'U7 a pick that fails late does not take the screen from the pick made after it');
  eq(toastOf(d), '', 'U7 and its failure says nothing');
  FAIL.clear();
  DELAY.clear();
  // refresh asks again and shows what is there now
  const before = onScreen(d)[0].rows;
  await pickReport(A, 'reg');
  const regRows0 = onScreen(d)[0].rows;
  await reg(EV, { bib: '120', name: 'Late Larry', g: 'M', age: 30, email: 'larry@example.com' });
  const n2 = rpc('rpRun').length;
  click(w, act(d, 'rp-refresh'));
  await until(() => rpc('rpRun').length > n2);
  await settle();
  eq(onScreen(d)[0].rows[1], ['Registered', '9'], 'U7 "Refresh" asks again and shows the new registration: 9, not 8 (' + JSON.stringify(regRows0[1]) + ' before)');
  ok(before.length > 0, 'U7 (the earlier report had rows)');
  // another race while a report is on its way
  DELAY.set('rpRun', [600]);
  const n3 = rpc('rpRun').length;
  click(w, pickBtn(d, 'reg'));
  await until(() => rpc('rpRun').length > n3);
  const nl = rpc('rpList').length;
  change(w, q(d, '#evPick'), EV2);
  await until(() => rpc('rpList').length > nl);
  await sleep(900);
  await settle();
  ok(/Pick a report/.test(content(d)) && cards(d).length === 0, 'U7 switching race while a report is coming: the old answer is dropped and the new race starts at "Pick a report"');
  await pickReport(A, 'reg');
  eq(onScreen(d)[0].rows[1], ['Registered', '1'], 'U7 the other race shows its own count: 1');
  eq(rpc('rpList').slice(-1)[0].arg.ev, EV2, 'U7 and the list was asked for the other race');
  // the Reports tab opened again after the race was changed on another screen: nothing of the old race is drawn while it loads
  click(w, tabBtn(d, 'overview'));
  await sleep(400);
  change(w, q(d, '#evPick'), EV);
  await sleep(400);
  const nr = rpc('rpList').length;
  click(w, tabBtn(d, 'rp'));
  eq(cards(d).length, 0, 'U7 the Reports tab opened after the race was changed on another screen draws nothing of the old race while it loads');
  await until(() => rpc('rpList').length > nr);
  await settle();
  ok(/Pick a report/.test(content(d)) && cards(d).length === 0, 'U7 and the race it is on now starts at "Pick a report"');
  // back to the first race
  const nb = rpc('rpList').length;
  change(w, q(d, '#evPick'), EV);
  await until(() => rpc('rpList').length > nb);
  await settle();
  ok(/Pick a report/.test(content(d)), 'U7 and back again it starts from nothing too');
}

/* ---------- U8. nothing yet, and a lot ---------- */
{
  const { d, w } = A;
  const nl = rpc('rpList').length;
  change(w, q(d, '#evPick'), EVE);
  await until(() => rpc('rpList').length > nl);
  await settle();
  await pickReport(A, 'reg');
  const server = await RP.rpRun({ token: OT, ev: EVE, report: 'reg' });
  eq(onScreen(d), shown(server), 'U8 a race with nobody registered: the tables are what the server sent');
  ok((content(d).match(/Nothing to count yet\./g) || []).length >= 2, 'U8 and the empty tables say "Nothing to count yet."');
  await pickReport(A, 'race');
  ok(/Nothing to count yet\./.test(content(d)) && /No results are loaded yet/.test(content(d)), 'U8 the race-day report with no results says so');
  const nb = rpc('rpList').length;
  change(w, q(d, '#evPick'), EVB);
  await until(() => rpc('rpList').length > nb);
  await settle();
  const t0 = Date.now();
  await pickReport(A, 'reg');
  const c = onScreen(d).find((x) => x.title === 'By category');
  eq([c.rows.length, c.rows[c.rows.length - 1].slice(0, 2)], [401, ['Total', '460']], 'U8 460 categories: the header, 400 rows, and the total last');
  ok(/Only the first 400 rows are shown\./.test(content(d)), 'U8 and the screen says that only 400 are shown');
  ok(Date.now() - t0 < 8000, 'U8 in good time (' + (Date.now() - t0) + ' ms)');
  const nr = rpc('rpList').length;
  change(w, q(d, '#evPick'), EV);
  await until(() => rpc('rpList').length > nr);
  await settle();
}

/* ---------- U9. a call that does not work ---------- */
{
  const { d, w } = A;
  const switchRace = async (ev) => {
    const n = rpc('rpList').length;
    change(w, q(d, '#evPick'), ev);
    await until(() => rpc('rpList').length > n);
    await settle();
  };
  // an old backend file: the first load of a race's list fails
  FAIL.set('rpList', { code: 'backend_old' });
  await switchRace(EV2);
  ok(/The backend file is out of date\. Paste the latest backend files, then publish\./.test(content(d)) && !!act(d, 'retry') && !act(d, 'rp-pick'), 'U9 a backend file that does not have Reports yet says so, with "Try again", and no list');
  click(w, act(d, 'retry'));
  await until(() => act(d, 'rp-pick'));
  await settle();
  ok(qa(d, '[data-act="rp-pick"]').length === 6, 'U9 "Try again" loads the tab once it is right');
  // a page code that does not know the calls
  OLD.rp = true;
  await switchRace(EV);
  ok(/This page's code is out of date\. Paste the latest page-code\.js for this page, then publish\./.test(content(d)) && !!act(d, 'retry'), 'U9 a page code that does not know the Reports calls says so, with "Try again"');
  OLD.rp = false;
  click(w, act(d, 'retry'));
  await until(() => act(d, 'rp-pick'));
  await settle();
  // a list that cannot be fetched again leaves the list that is there, and says so
  FAIL.set('rpList', { code: 'server_error' });
  await openTab(A);
  ok(qa(d, '[data-act="rp-pick"]').length === 6 && /Something went wrong on the server/.test(toastOf(d)), 'U9 a list that fails to load a second time keeps the one on the screen, and a message says so');
  // a report that fails, then works
  FAIL.set('rpRun', { code: 'server_error' });
  clearToast(d);
  click(w, pickBtn(d, 'vol'));
  await until(() => /Something went wrong on the server/.test(content(d)));
  await settle();
  ok(/Something went wrong on the server\. Try again; if it keeps happening, tell the Race Director\./.test(content(d)) && cards(d).length === 0 && !!act(d, 'retry'), 'U9 a report that fails says so, shows no table, and has "Try again"');
  click(w, act(d, 'retry'));
  await until(() => cards(d).length > 0);
  await settle();
  const server = await RP.rpRun({ token: OT, ev: EV, report: 'vol' });
  eq(onScreen(d), shown(server), 'U9 "Try again" runs the report that was picked');
  // a report that times out
  FAIL.set('rpRun', { code: 'timeout' });
  click(w, act(d, 'rp-refresh'));
  await until(() => /No answer from the server\. Try again\./.test(content(d)));
  await settle();
  ok(/No answer from the server\. Try again\./.test(content(d)) && cards(d).length === 0, 'U9 a call that runs out of time says so, and shows no table');
  click(w, act(d, 'retry'));
  await until(() => cards(d).length > 0);
  await settle();
  // sources the server could not read
  TAMPER.set('rpRun', (o) => Object.assign(o, { unread: ['Shifts', 'Messages'] }));
  click(w, act(d, 'rp-refresh'));
  await until(() => /Not read/.test(content(d)));
  await settle();
  ok(/Not read \(nothing set up yet, or it could not be read, so counted as zero\): Shifts, Messages\./.test(content(d)), 'U9 a source that could not be read is named on the screen, so a zero is never taken for a count');
  TAMPER.delete('rpRun');
  // a refusal
  await pickReport(A, 'reg');
  FAIL.set('rpRun', { code: 'rp_bad_report' });
  click(w, act(d, 'rp-refresh'));
  await until(() => /That report is not available/.test(content(d)));
  ok(/That report is not available\. Reload the page and pick again\./.test(content(d)), 'U9 a report the server does not know says to reload');
  FAIL.set('rpCsv', { code: 'rp_bad_table' });
  await pickReport(A, 'reg');
  clearToast(d);
  click(w, act(d, 'rp-csv', '[data-id="cats"]'));
  await until(() => /That table is not in this report/.test(toastOf(d)));
  ok(/That table is not in this report\. Reload the page and try again\./.test(toastOf(d)), 'U9 a table the server does not know says to reload');
  FAIL.set('rpRun', { code: 'director_only' });
  click(w, act(d, 'rp-refresh'));
  await until(() => /Only a director/.test(content(d)));
  ok(/Only a director login can do that\./.test(content(d)), 'U9 and Money for someone who may not says so');
  await settle();
  FAIL.clear();
}

/* ---------- U10. whatever the server sends is text: every string, on every report ---------- */
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
  TAMPER.set('rpList', (o) => poison(o));
  TAMPER.set('rpRun', (o) => poison(o));
  await openTab(A);
  ok(qa(d, '[data-act="rp-pick"]').length === 6 && qa(d, '[data-act="rp-pick"]').every((b) => txt(b) === PAY), 'U10 every report title is the hostile text, shown as text');
  noMarkup(A, 'U10 the list made no picture, no script and no handler from it');
  for (const id of REPORTS) {
    await pickReport(A, id);
    ok(cards(d).length > 0 && content(d).includes('</textarea>'), 'U10 ' + id + ': every word of the tables is the hostile text');
    noMarkup(A, 'U10 ' + id + ': the tables made nothing live');
  }
  // numbers that are really text
  TAMPER.set('rpRun', (o) => {
    o = poison(o);
    o.tables.forEach((t) => t.rows.forEach((r, i) => r.forEach((v, j) => (t.rows[i][j] = PAY))));
    return o;
  });
  await pickReport(A, 'reg');
  noMarkup(A, 'U10 numbers that are really text are not markup either');
  // tables that are not tables
  TAMPER.set('rpRun', (o) => ({ report: { id: 'reg', title: 'T', what: 'W' }, made: 5, tables: [{ id: 'x', title: 'X', cols: [{ label: 'A', kind: 'text' }], rows: [['a', 'b', 'c']], note: '' }], unread: [] }));
  await pickReport(A, 'reg');
  ok(jserr.length === e0, 'U10 an answer with a row longer than its header raises no script error');
  ok(jserr.length === e0, 'U10 and no script error was raised by any of it');
  TAMPER.clear();
  await openTab(A);
  await pickReport(A, 'reg');
  eq(onScreen(d)[0].rows[1], ['Registered', '9'], 'U10 with the real answers back, the real numbers are shown again');
}

/* ---------- U10b. ids and the "not read" words are text too; numbers are written the Indian way ---------- */
{
  const X = await login('owner');
  const { d } = X;
  const e0 = jserr.length;
  const all = (o) => (typeof o === 'string' ? PAY : Array.isArray(o) ? o.map(all) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, all(v)])) : o);
  // the list: ids, titles and descriptions, every one hostile
  TAMPER.set('rpList', (o) => all(o));
  await openTab(X);
  const btns = qa(d, '[data-act="rp-pick"]');
  ok(btns.length === 6 && btns.every((b) => b.getAttribute('data-id') === PAY && txt(b) === PAY), 'U10b a report id and title full of quotes and tags stay text and stay inside their attributes');
  ok(/Pick a report/.test(content(d)) && content(d).split(PAY).length - 1 >= 12, 'U10b the "Pick a report" card shows each title and description as text');
  noMarkup(X, 'U10b the list made nothing live');
  // the tables: ids, notes and the words that name what could not be read
  TAMPER.set('rpList', (o) => poison(o)); // the ids stay real, so that a report can be picked
  TAMPER.set('rpRun', (o) => {
    o = all(o);
    o.unread = [PAY, PAY];
    return o;
  });
  await openTab(X);
  await pickReport(X, 'reg');
  const saves = qa(d, '[data-act="rp-csv"]');
  ok(saves.length === 6 && saves.every((b) => b.getAttribute('data-id') === PAY), 'U10b a table id full of quotes and tags stays inside its attribute (6 tables, 6 buttons)');
  ok(/Not read/.test(content(d)) && content(d).split(PAY).length - 1 >= 14, 'U10b the words that name what could not be read are shown as text');
  noMarkup(X, 'U10b the tables made nothing live');
  // the way numbers are written: Indian grouping, the rupee sign, one decimal in a percentage
  TAMPER.set('rpRun', () => ({ report: { id: 'reg', title: 'Registrations', what: 'x' }, made: new Date().toISOString(), tables: [{ id: 'n', title: 'Numbers', cols: [{ label: 'Line', kind: 'text' }, { label: 'People', kind: 'n' }, { label: 'Rupees', kind: 'r' }, { label: 'Rate', kind: 'p' }], rows: [['Big', 1234567, 610000, 66.66]], note: '' }], unread: [] }));
  await pickReport(X, 'reg');
  const cells = tableRows(cards(d)[0])[1];
  eq(cells, ['Big', (1234567).toLocaleString('en-IN'), fmR(610000), '66.7%'], 'U10b numbers are grouped the Indian way, rupees carry the rupee sign, a percentage has one decimal');
  ok(cells[1] !== '1234567' && /,/.test(cells[1]), 'U10b a big count is grouped (' + cells[1] + ')');
  TAMPER.clear();
  ok(jserr.length === e0, 'U10b no script error was raised by any of it');
}

/* ---------- U11. a lost session, logging out ---------- */
{
  const { d, w } = A;
  FAIL.set('rpRun', { code: 'not_logged_in' });
  click(w, act(d, 'rp-refresh'));
  await until(() => q(d, '#loginForm'));
  ok(!!q(d, '#loginForm') && /Your session ended\. Please log in again\./.test(txt(q(d, '#app'))), 'U11 a lost session goes back to the login page, and says so');
  ok(!/Registered|Category|Race week news|VHM Report/.test(txt(q(d, '#app'))), 'U11 and nothing of the reports is left on the page');
  set(w, q(d, '#lgUser'), 'owner');
  set(w, q(d, '#lgPass'), pw.owner);
  submit(w, q(d, '#loginForm'));
  await until(() => q(d, '.tab'));
  await openTab(A);
  ok(/Pick a report/.test(content(d)) && cards(d).length === 0, 'U11 logging in again starts the tab from nothing');
  await pickReport(A, 'reg');
  click(w, act(d, 'logout'));
  await sleep(80);
  ok(!!q(d, '#loginForm') && !/Registered|Category|Race week news|VHM Report/.test(txt(q(d, '#app'))), 'U11 logging out leaves nothing of the reports on the page');
  // another person on the same page sees only their own list
  set(w, q(d, '#lgUser'), 'lead.one');
  set(w, q(d, '#lgPass'), pw['lead.one']);
  submit(w, q(d, '#loginForm'));
  await until(() => q(d, '.tab'));
  await openTab(A);
  eq(qa(d, '[data-act="rp-pick"]').map(txt), REPORTS.filter((r) => r !== 'money').map((id) => TITLE[id]), 'U11 a lead who logs in on the same page gets five reports, and nothing is left from the director');
  ok(cards(d).length === 0, 'U11 and no table from the director\'s last report');
}
{
  // a viewer who forces the call gets nothing: the server says no
  const t = (await R.login({ username: 'view.one', password: pw['view.one'] })).token;
  const r = await RP.rpRun({ token: t, ev: EV, report: 'reg' }).then(() => 'answered', (x) => x.message);
  eq(r, 'not_allowed', 'U12 a viewer who asks the server for a report anyway is refused');
  const l = (await R.login({ username: 'lead.one', password: pw['lead.one'] })).token;
  const r2 = await RP.rpRun({ token: l, ev: EV, report: 'money' }).then(() => 'answered', (x) => x.message);
  eq(r2, 'director_only', 'U12 and a lead who asks for Money anyway is refused');
}

/* ---------- the end: no page raised a script error ---------- */
ok(jserr.length === 0, 'no page raised a script error' + (jserr.length ? ' [' + jserr.slice(0, 3).join(' | ') + ']' : ''));
done();
