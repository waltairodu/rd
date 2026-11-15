// COMPONENT + INTEGRATION TESTS (screens): hidden phone numbers and e-mail addresses on the Director page and at the Expo desk, in jsdom, on
// the real RaceOS, Expo and Privacy backend code. Every list shows the dots and no full number or address reaches the page (every tab, every
// role); the Show button asks for a reason first, the detail is on the screen for a short time only and is then thrown away (a timer, leaving
// the tab, changing the race, the page going to the background, a login that ends, an erase); a late answer is dropped; a refused or failed
// call is explained; a WhatsApp chat of a volunteer exists only while that volunteer's number is shown; the Privacy tab (directors only) saves
// the contact files page by page, lists who looked, and erases a person (nothing ticked by default, ERASE typed, only the ticked rows);
// editing a pacer never saves the dots; nothing the server sends (a name like <img onerror>) ever becomes markup.
//   U0 the page script   U1 who sees what   U2 the lists hold dots only   U3 showing one detail   U4 it goes away again   U5 when it fails
//   U6 the Privacy tab   U7 the files   U8 erasing a person   U9 editing a pacer   U10 spreadsheets from the lists   U11 an old page code
//   U12 the Expo desk
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as PV from './privacy.test.mjs';
import * as P from './rd-privacy.test.mjs';
import * as F from './finance.test.mjs';
import * as RS from './results.test.mjs';
import * as PR from './print.test.mjs';
import * as CM from './comms.test.mjs';
import * as WV from './waivers.test.mjs';
import * as RP from './reports.test.mjs';
import * as TR from './training.test.mjs';
import * as X from './exposoft.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Privacy: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const expoHtml = fs.readFileSync('../wix/expo/exposoft-embed.html', 'utf8');
const pageCode = fs.readFileSync('../wix/director/director-page-code.js', 'utf8');
const backendSrc = fs.readFileSync('../wix/director/privacy.web.js', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const rows = (t) => [...(DB[t] || new Map()).values()];
const B = P.BULLET;
const MASK = (last4) => B.repeat(6) + last4;
const jserr = [];
const calls = [];
const FAIL = new Map(); // method -> { code, skip }: the code is given instead of the real answer, once
const DELAY = new Map(); // method -> [ms, ...]: the next answers are held back that long
const TAMPER = new Map(); // method -> function: changes the answer before the page gets it
const OLD = { pv: false }; // the page code on the site does not know the Privacy calls yet
const downloads = [];
const blobs = [];
let pending = 0;
let kseq = 0;

/* ---------- the world ---------- */
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
const RD = istDay(40);
const mkRace = async (name, venue) => {
  const e = (await R.saveEvent({ token: OT, name, date: RD, venue })).event.id;
  await R.linkWixEvent({ token: OT, ev: e, wixEventId: 'WX-' + e.slice(-6) });
  return e;
};
const EV = await mkRace('VHM Privacy Edition', 'RK Beach');
const EV2 = await mkRace('Other Privacy Run', 'Paderu');
const IMG = '<img src=x onerror="window.__pwn=1">';
const reg = (ev, ticket, p) => wd.insert('RDRegs', Object.assign({ _id: ev + '~' + ticket, event: ev, ticketNumber: ticket, orderNumber: 'O' + ticket, guestId: 'g' + ticket, bibName: '', size: 'M', status: 'ok', form: '', at: '2026-11-01T10:00:00.000Z', cat: '10 K', bib: '' }, p), SA);
await reg(EV, 'T101', { name: 'Asha Rao', phone: '9848012345', email: 'asha.rao@example.com', bib: '101' });
await reg(EV, 'T102', { name: 'Bina Rao', phone: '+91 98480 12345', email: 'bina.rao@example.com', bib: '102' }); // the same number: a family
await reg(EV, 'T103', { name: 'Chitra Devi', phone: '9812300103', email: 'chitra@example.com', bib: '103', cat: '21 K' });
await reg(EV, 'T104', { name: 'Eve ' + IMG, phone: '9812300107', email: 'eve@example.com', bib: '104' });
await reg(EV, 'T105', { name: 'Dev Raman', phone: '', email: '', bib: '105' });
await reg(EV2, 'T201', { name: 'Olga Other', phone: '9812300777', email: 'olga@example.com', bib: '201' });
const vol = (ev, id, p) => wd.insert('RDVolunteers', Object.assign({ _id: id, event: ev, club: '', status: 'approved', code: 'C' + id.toUpperCase(), notes: '', waiverAt: '', waiverVersion: '', createdAt: '2026-11-02T00:00:00.000Z' }, p), SA);
await vol(EV, 'v1', { name: 'Asha Volunteer', phone: '9848012345', email: 'asha.rao@example.com', club: 'VTRA Vizag' });
await vol(EV, 'v2', { name: 'Sita Sharma', phone: '9000000002', email: 'sita@example.com' });
await vol(EV, 'v3', { name: 'Vol ' + IMG, phone: '9000000003', email: 'vol3@example.com' });
const pacer = (ev, id, p) => wd.insert('RDPacers', Object.assign({ _id: id, event: ev, group: '2:00', status: 'approved', notes: '' }, p), SA);
await pacer(EV, 'p1', { name: 'Kiran Pacer', phone: '9111111111' });
await pacer(EV, 'p2', { name: 'Asha Pacer', phone: '+91 98480-12345' });
const RAWS = ['9848012345', '98480 12345', '98480-12345', '9812300103', '9812300107', '9000000002', '9000000003', '9111111111', 'asha.rao@example.com', 'bina.rao@example.com', 'chitra@example.com', 'eve@example.com', 'sita@example.com', 'vol3@example.com'];
const idOf = { asha: EV + '~T101', bina: EV + '~T102', chitra: EV + '~T103', eve: EV + '~T104' };
const audits = (action) => rows('RDAudit').filter((r) => (action ? r.action === action : true));

/* ---------- a page, the way a browser would run it ---------- */
const MODS = { rd: R, pv: PV, fin: F, res: RS, prn: PR, comms: CM, wv: WV, rp: RP, train: TR };
function openPage() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const longTimers = [];
  const dom = new JSDOM(html, {
    virtualConsole: vc,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.com/',
    beforeParse(win) {
      const st = win.setTimeout;
      win.setTimeout = function (fn, ms, ...a) {
        if (ms >= 10000) longTimers.push(ms);
        // a test can hold back the page's own clean-up (the timer that throws away a shown detail) to look at the moment before it runs
        if (win.__slowSweep && typeof fn === 'function' && fn.name === 'pvSweep') ms = (ms || 0) + win.__slowSweep;
        return st.call(this, fn, ms, ...a);
      };
    },
  });
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
  const Pg = { w, d, calls: [], longTimers };
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    const mod = m.mod || 'rd';
    const rec = { method: m.method, mod, arg: m.arg };
    calls.push(rec);
    Pg.calls.push(rec);
    pending++;
    const reply = (o) => {
      pending--;
      w.postMessage(Object.assign({ kind: 'result', id: m.id }, o), '*');
    };
    if (mod === 'pv' && OLD.pv) return reply({ ok: false, error: 'page_code_old' });
    const lib = MODS[mod];
    if (!lib) return reply({ ok: false, error: 'page_code_old' });
    const f = mod === 'pv' ? FAIL.get(m.method) : null;
    if (f) {
      if (f.skip > 0) f.skip--;
      else {
        FAIL.delete(m.method);
        const held = DELAY.get(m.method);
        if (held && held.length) await sleep(held.shift());
        return reply({ ok: false, error: f.code });
      }
    }
    if (typeof lib[m.method] !== 'function') return reply({ ok: false, error: 'backend_old' });
    try {
      const r = await lib[m.method](m.arg);
      let out = JSON.parse(JSON.stringify(r === undefined ? null : r));
      if (mod === 'pv') {
        const dl = DELAY.get(m.method);
        if (dl && dl.length) await sleep(dl.shift());
        const tp = TAMPER.get(m.method);
        if (tp) out = tp(out, m.arg) || out;
      } else {
        const tp = TAMPER.get(mod + ':' + m.method); // e.g. 'rd:listRegs': the lists of the other backends, changed on the way
        if (tp) out = tp(out, m.arg) || out;
      }
      reply({ ok: true, result: out });
    } catch (x) {
      reply({ ok: false, error: x.message });
    }
  });
  return Pg;
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
const idle = async (ms) => {
  let stable = 0;
  const t = Date.now();
  while (Date.now() - t < (ms || 10000)) {
    if (pending === 0) {
      if (++stable >= 4) return true;
    } else stable = 0;
    await sleep(20);
  }
  return false;
};
const login = async (user) => {
  const Pg = openPage();
  await sleep(40);
  set(Pg.w, q(Pg.d, '#lgUser'), user);
  set(Pg.w, q(Pg.d, '#lgPass'), pw[user]);
  submit(Pg.w, q(Pg.d, '#loginForm'));
  await until(() => q(Pg.d, '.tab'));
  await idle();
  return Pg;
};
const tabBtn = (d, t) => q(d, `[data-tab="${t}"]`);
const toastOf = (d) => txt(q(d, '#toast'));
const clearToast = (d) => {
  const t = q(d, '#toast');
  t.textContent = '';
  t.hidden = true;
};
const content = (d) => txt(q(d, '.content'));
const pvc = (m) => calls.filter((c) => c.mod === 'pv' && (!m || c.method === m));
const act = (d, a, extra) => q(d, `[data-act="${a}"]${extra || ''}`);
const openTab = async (Pg, t) => {
  clearToast(Pg.d);
  click(Pg.w, tabBtn(Pg.d, t));
  await idle();
  await sleep(30);
  await idle();
};
const rowOf = (d, name) => qa(d, 'tr').find((tr) => txt(tr).includes(name));
const showBtn = (d, name, field) => q(rowOf(d, name), `[data-act="pv-ask"][data-field="${field}"]`);
const rawIn = (d) => {
  const h = d.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '');
  return RAWS.filter((x) => h.includes(x));
};
const noMarkup = (Pg, msg) => {
  const { d, w } = Pg;
  const live = [w.__pwn, qa(d, '[onerror], [onclick], [onload]').length, qa(d, '.content img, .content iframe, .content object, .content embed, .content script, .content a[href^="javascript"]').length];
  eq(live, [undefined, 0, 0], msg);
};
const askCard = (d) => q(d, '#pvAskBox .pvask');
// press Show on a person's number, pick the reason and confirm; returns once the answer is drawn (or refused)
const reveal = async (Pg, name, field, reason) => {
  const b = showBtn(Pg.d, name, field);
  click(Pg.w, b);
  await until(() => askCard(Pg.d));
  if (reason) change(Pg.w, q(Pg.d, '#pvReason'), reason);
  click(Pg.w, act(Pg.d, 'pv-go'));
  await idle();
  await sleep(30);
};
const tabbing = async (Pg, t) => {
  await openTab(Pg, t);
};

/* ---------- U0. the page script ---------- */
{
  const names = [...html.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
  const seen = new Map();
  names.forEach((n) => seen.set(n, (seen.get(n) || 0) + 1));
  const twice = [...seen].filter((x) => x[1] > 1).map((x) => x[0]);
  ok(names.length > 300 && twice.length === 0, 'U0 the page script declares every function once' + (twice.length ? ': ' + twice.join(', ') : ''));
  // the list of reasons on the screen is the list the server accepts, in the same order
  const m = html.match(/var PV_REASONS=\[(.*?)\];/);
  const onPage = m ? [...m[1].matchAll(/\['([a-z]+)','([^']+)'\]/g)].map((x) => [x[1], x[2]]) : [];
  eq(onPage, P.REASONS, 'U0 the reasons on the screen are the reasons the server accepts, word for word');
  const secs = html.match(/PV_SHOW_MS=(\d+),PV_PER_HOUR=(\d+)/);
  eq([Number(secs[1]), Number(secs[2])], [P.SHOW_MS, P.REVEALS_PER_HOUR], 'U0 the time a detail stays and the hourly limit on the screen are the server\'s');
  // every error code the Privacy server can answer has a sentence on the screen
  const codes = [...backendSrc.match(/const CODES = new Set\(\[([\s\S]*?)\]\);/)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  const missing = codes.filter((c) => !new RegExp('(?:^|[\\s,{])' + c + ":'").test(html));
  eq(missing, [], 'U0 every error code of the Privacy server has its own sentence on the screen');
  // the calls the page makes are the calls the page code lets through
  const allowed = pageCode.match(/const PV_ALLOWED = \[([^\]]*)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  const made = [...new Set([...html.matchAll(/pva\('([A-Za-z]+)'/g)].map((x) => x[1]))].sort();
  eq(made, allowed.slice().sort(), 'U0 the five calls the screens make are the five the page code relays');
  // a number is turned into a WhatsApp address in one place only, and only from a detail that was shown
  ok((html.match(/wa\.me\/91/g) || []).length === 1 && /function pvWaLink\(/.test(html) && !/String\(v\.phone/.test(html), 'U0 a WhatsApp address is made from a phone number in one place only, and only from a detail that was shown (the Messages tab gets its chats from the server)');
  // nothing on the page stores a detail in the browser
  const blockSrc = html.slice(html.indexOf('PRIVACY-BEGIN'), html.indexOf('PRIVACY-END'));
  ok(blockSrc.length > 5000 && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(blockSrc), 'U0 the privacy code never stores anything in the browser');
}

/* ---------- U1. who sees what ---------- */
const AD = await login('owner');
const D2 = await login('dir.two');
const L1 = await login('lead.one');
const V1 = await login('view.one');
{
  ok(!!tabBtn(AD.d, 'pv') && txt(tabBtn(AD.d, 'pv')) === 'Privacy', 'U1 a director has a "Privacy" tab');
  ok(/Admin\s+Team\s+Privacy\s+Settings/.test(txt(q(AD.d, '.side'))), 'U1 it is in the Admin group');
  ok(!!tabBtn(D2.d, 'pv'), 'U1 so has every director login');
  ok(!tabBtn(L1.d, 'pv') && !/Privacy/.test(txt(q(L1.d, '.side'))), 'U1 a lead has no such tab and nothing about it in the menu');
  ok(!tabBtn(V1.d, 'pv') && !/Privacy/.test(txt(q(V1.d, '.side'))), 'U1 a viewer has none either');
  ok(L1.calls.every((c) => c.mod !== 'pv') && V1.calls.every((c) => c.mod !== 'pv'), 'U1 and their pages never called the Privacy server');
  // a tab button made up by hand (the page is the person\'s own): the page still asks nothing
  for (const Pg of [L1, V1]) {
    const forged = Pg.d.createElement('button');
    forged.setAttribute('data-act', 'tab');
    forged.setAttribute('data-tab', 'pv');
    q(Pg.d, '.content').appendChild(forged);
    click(Pg.w, forged);
    await sleep(250);
    await idle();
    ok(Pg.calls.every((c) => c.mod !== 'pv') && !/Files with contact details|Erase a person/.test(content(Pg.d)), 'U1 a Privacy tab button made up by hand shows a lead or a viewer nothing and calls nothing');
    forged.remove();
    click(Pg.w, tabBtn(Pg.d, 'overview'));
    await idle();
  }
}

/* ---------- U2. the lists hold dots only ---------- */
{
  await openTab(AD, 'regs');
  eq(rawIn(AD.d), [], 'U2 Registrations: no full number or address is on the page');
  const ar = rowOf(AD.d, 'Asha Rao');
  ok(!!ar && txt(ar).includes(MASK('2345')) && /a•••@e•••\.com/.test(txt(ar)), 'U2 Registrations: a number shows as ••••••2345 and an address as a•••@e•••.com');
  ok(/Phone numbers and e-mail addresses are hidden\. Press Show to see one for 30 seconds/.test(content(AD.d)), 'U2 Registrations: the screen says so');
  ok(!!showBtn(AD.d, 'Asha Rao', 'phone') && !!showBtn(AD.d, 'Asha Rao', 'email'), 'U2 Registrations: a director has a Show button for the number and for the address');
  const none = rowOf(AD.d, 'Dev Raman');
  ok(none && !q(none, '[data-act="pv-ask"]') && txt(none).includes('–'), 'U2 Registrations: a person with no number or address has nothing to show (a dash, no button)');
  // the search works on what is on the screen
  set(AD.w, q(AD.d, '#regQ'), '2345');
  await sleep(60);
  ok(!!rowOf(AD.d, 'Asha Rao') && !!rowOf(AD.d, 'Bina Rao') && !rowOf(AD.d, 'Chitra Devi'), 'U2 Registrations: the last four digits find the people they belong to');
  set(AD.w, q(AD.d, '#regQ'), '9848012345');
  await sleep(60);
  ok(!rowOf(AD.d, 'Asha Rao'), 'U2 Registrations: a whole number finds nobody (the page does not have it)');
  set(AD.w, q(AD.d, '#regQ'), '');
  await sleep(60);
  await openTab(AD, 'volunteers');
  eq(rawIn(AD.d), [], 'U2 Volunteers: no full number or address is on the page');
  ok(txt(rowOf(AD.d, 'Sita Sharma')).includes(MASK('0002')) && /code CV2/.test(txt(rowOf(AD.d, 'Sita Sharma'))), 'U2 Volunteers: the number is dots and the check-in code is still there');
  ok(qa(AD.d, 'a[href*="wa.me"]').length === 0, 'U2 Volunteers: there is no WhatsApp address while no number is shown');
  ok(/last 4 digits/.test(q(AD.d, '#volQ').getAttribute('placeholder')), 'U2 Volunteers: the search box says what it searches');
  await openTab(AD, 'pacers');
  eq(rawIn(AD.d), [], 'U2 Pacers: no full number is on the page');
  ok(txt(rowOf(AD.d, 'Kiran Pacer')).includes(MASK('1111')), 'U2 Pacers: the number is dots');
  // every other tab, for every kind of login: the page never holds a full number or address
  const TABS = ['overview', 'regs', 'bibs', 'quals', 'plan', 'money', 'approvals', 'ceremonies', 'logistics', 'fin', 'volunteers', 'comms', 'wv', 'pacers', 'coaching', 'res', 'prn', 'raceday', 'safety', 'rp', 'team', 'pv', 'setup'];
  const leaks = [];
  for (const [who, Pg] of [['director', AD], ['lead', L1], ['viewer', V1]]) {
    for (const t of TABS) {
      if (!tabBtn(Pg.d, t)) continue;
      await openTab(Pg, t);
      const l = rawIn(Pg.d);
      if (l.length) leaks.push(who + '/' + t + ': ' + l.join(', '));
    }
  }
  eq(leaks, [], 'U2 every tab, for a director, a lead and a viewer: no full number or address on the page');
  const lv = L1.d;
  await openTab(L1, 'volunteers');
  ok(!!showBtn(lv, 'Sita Sharma', 'phone'), 'U2 a lead has the Show button');
  await openTab(V1, 'volunteers');
  const vv = V1.d;
  ok(!q(vv, '[data-act="pv-ask"]') && /Phone numbers and e-mail addresses are hidden for your login\./.test(content(vv)) && txt(rowOf(vv, 'Sita Sharma')).includes(MASK('0002')), 'U2 a viewer sees dots, no Show button, and is told they are hidden for their login');
  await openTab(V1, 'regs');
  ok(!q(V1.d, '[data-act="pv-ask"]'), 'U2 a viewer has none in Registrations either');
}

/* ---------- U3. showing one detail ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'regs');
  const before = pvc('pvReveal').length;
  click(w, showBtn(d, 'Asha Rao', 'phone'));
  await until(() => askCard(d));
  ok(/Show the phone number of Asha Rao/.test(txt(askCard(d))) && /written in the audit trail/.test(txt(askCard(d))) && /30 seconds/.test(txt(askCard(d))) && /40 an hour/.test(txt(askCard(d))), 'U3 pressing Show asks first: who, what, that it is noted, for how long, and the hourly limit');
  eq(qa(d, '#pvReason option').map((o) => [o.value, txt(o)]), [['', 'Pick a reason']].concat(P.REASONS), 'U3 the reasons to pick from are the server\'s five');
  click(w, act(d, 'pv-go'));
  await sleep(60);
  ok(/Pick a reason first\./.test(txt(askCard(d))) && pvc('pvReveal').length === before, 'U3 pressing Show without a reason is told to pick one and asks the server nothing');
  eq(rawIn(d), [], 'U3 and nothing is shown');
  click(w, act(d, 'pv-cancel'));
  ok(!askCard(d) && pvc('pvReveal').length === before, 'U3 Cancel closes the question and asks the server nothing');
  // a real one
  const notesBefore = audits('reveal phone').length;
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  const call = pvc('pvReveal')[pvc('pvReveal').length - 1];
  ok(call.arg.kind === 'reg' && call.arg.id === idOf.asha && call.arg.field === 'phone' && call.arg.reason === 'contact' && call.arg.ev === EV && call.arg.token.length >= 20, 'U3 the server is asked for that one detail of that one person, with the reason and the login token');
  ok(!askCard(d), 'U3 the question closes');
  const cell = q(rowOf(d, 'Asha Rao'), '.pvv');
  eq(cell && txt(cell), '9848012345', 'U3 the number is shown in its place');
  ok(!!q(rowOf(d, 'Asha Rao'), '[data-act="pv-hide"]'), 'U3 with a Hide button');
  ok(txt(rowOf(d, 'Bina Rao')).includes(MASK('2345')) && !txt(rowOf(d, 'Bina Rao')).includes('9848012345'), 'U3 the same number of another person (a family) is still hidden');
  eq(qa(d, '.pvv').length, 1, 'U3 nothing else was shown');
  eq((d.body.innerHTML.match(/9848012345/g) || []).length, 1, 'U3 the number is on the page once, in that cell');
  eq(audits('reveal phone').length, notesBefore + 1, 'U3 one note was written in the audit trail');
  const note = audits('reveal phone').pop();
  ok(note.detail === 'reg ' + idOf.asha + ' · contact' && !/9848012345|Asha/.test(JSON.stringify(note)), 'U3 the note holds who looked, which row and why, and no number and no name');
  // hide again
  click(w, q(rowOf(d, 'Asha Rao'), '[data-act="pv-hide"]'));
  ok(qa(d, '.pvv').length === 0 && txt(rowOf(d, 'Asha Rao')).includes(MASK('2345')) && !!showBtn(d, 'Asha Rao', 'phone'), 'U3 Hide puts the dots and the Show button back');
  eq(rawIn(d), [], 'U3 and the number is gone from the page');
  // an e-mail address
  await reveal(Pg, 'Chitra Devi', 'email', 'fix');
  eq(txt(q(rowOf(d, 'Chitra Devi'), '.pvv')), 'chitra@example.com', 'U3 an e-mail address is shown the same way');
  ok(audits('reveal e-mail').length === 1 && /fix$/.test(audits('reveal e-mail')[0].detail), 'U3 and noted as an e-mail, with its reason');
  click(w, q(rowOf(d, 'Chitra Devi'), '[data-act="pv-hide"]'));
  // a volunteer: the WhatsApp chat exists only while the number is shown
  await openTab(Pg, 'volunteers');
  await reveal(Pg, 'Asha Volunteer', 'phone', 'contact');
  const vr = rowOf(d, 'Asha Volunteer');
  eq(txt(q(vr, '.pvv')), '9848012345', 'U3 Volunteers: the number is shown');
  const wa = q(vr, 'a[href*="wa.me"]');
  ok(!!wa && wa.getAttribute('href').startsWith('https://wa.me/919848012345?text=') && /Hi%20Asha%2C/.test(wa.getAttribute('href')) && /CV1/.test(decodeURIComponent(wa.getAttribute('href'))) && wa.getAttribute('target') === '_blank' && /noopener/.test(wa.getAttribute('rel')), 'U3 Volunteers: and the WhatsApp chat appears, made from that number, opening in a new tab safely');
  eq(qa(d, 'a[href*="wa.me"]').length, 1, 'U3 Volunteers: only for that one volunteer');
  click(w, q(vr, '[data-act="pv-hide"]'));
  ok(qa(d, 'a[href*="wa.me"]').length === 0, 'U3 Volunteers: hiding takes the WhatsApp chat away with the number');
  eq(rawIn(d), [], 'U3 Volunteers: and the number is gone from the page');
  // a pacer
  await openTab(Pg, 'pacers');
  await reveal(Pg, 'Kiran Pacer', 'phone', 'safety');
  eq(txt(q(rowOf(d, 'Kiran Pacer'), '.pvv')), '9111111111', 'U3 Pacers: the number is shown');
  click(w, q(rowOf(d, 'Kiran Pacer'), '[data-act="pv-hide"]'));
  // a lead may show one too
  await openTab(L1, 'volunteers');
  await reveal(L1, 'Sita Sharma', 'phone', 'contact');
  eq(txt(q(rowOf(L1.d, 'Sita Sharma'), '.pvv')), '9000000002', 'U3 a lead can show one number');
  ok(audits('reveal phone').pop().by === 'lead.one', 'U3 and the note says it was the lead');
  click(L1.w, q(rowOf(L1.d, 'Sita Sharma'), '[data-act="pv-hide"]'));
  // a Show button made up by hand on a viewer's page: the server says no and the page shows nothing
  await openTab(V1, 'volunteers');
  const fake = V1.d.createElement('button');
  fake.setAttribute('data-act', 'pv-ask');
  fake.setAttribute('data-kind', 'vol');
  fake.setAttribute('data-id', 'v2');
  fake.setAttribute('data-field', 'phone');
  q(V1.d, '.content').appendChild(fake);
  click(V1.w, fake);
  await sleep(100);
  ok(!askCard(V1.d) && V1.calls.every((c) => c.method !== 'pvReveal'), 'U3 a Show button made up by hand on a viewer\'s page opens nothing and calls nothing');
  fake.remove();
}

/* ---------- U4. it goes away again ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  // the time is the server's, never longer than thirty seconds
  TAMPER.set('pvReveal', (out) => Object.assign(out, { ms: 1100 }));
  await openTab(Pg, 'regs');
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  eq(txt(q(rowOf(d, 'Asha Rao'), '.pvv')), '9848012345', 'U4 shown');
  ok(await until(() => !q(d, '.pvv'), 3500), 'U4 after the time the server gave it is hidden by itself');
  ok(txt(rowOf(d, 'Asha Rao')).includes(MASK('2345')) && !!showBtn(d, 'Asha Rao', 'phone') && rawIn(d).length === 0, 'U4 the dots and the Show button are back, and the number is not on the page');
  TAMPER.delete('pvReveal');
  const t0 = Pg.longTimers.length;
  TAMPER.set('pvReveal', (out) => Object.assign(out, { ms: 99999999 }));
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  const timers = Pg.longTimers.slice(t0);
  ok(timers.length >= 1 && timers.every((ms) => ms <= 30100), 'U4 a time longer than thirty seconds is cut to thirty (the longest wait asked for was ' + Math.max(0, ...timers) + ' ms)');
  TAMPER.delete('pvReveal');
  // leaving the tab
  eq(txt(q(rowOf(d, 'Asha Rao'), '.pvv')), '9848012345', 'U4 shown again');
  await openTab(Pg, 'volunteers');
  await openTab(Pg, 'regs');
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 going to another tab and back hides it');
  // changing the race
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  change(w, q(d, '#evPick'), EV2);
  await idle();
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 changing the race hides it');
  change(w, q(d, '#evPick'), EV);
  await idle();
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 and so does changing back');
  // the page going to the background
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  ok(qa(d, '.pvv').length === 1, 'U4 shown again');
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => true });
  d.dispatchEvent(new w.Event('visibilitychange'));
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => false });
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 the page going to the background hides it');
  // a question that is open goes away too
  click(w, showBtn(d, 'Asha Rao', 'phone'));
  await until(() => askCard(d));
  await openTab(Pg, 'pacers');
  ok(!askCard(d), 'U4 an open question is dropped when the tab changes');
  // an answer that arrives after the question was dropped is thrown away
  await openTab(Pg, 'regs');
  DELAY.set('pvReveal', [400]);
  const n0 = pvc('pvReveal').length;
  click(w, showBtn(d, 'Asha Rao', 'phone'));
  await until(() => askCard(d));
  change(w, q(d, '#pvReason'), 'contact');
  click(w, act(d, 'pv-go'));
  await until(() => pvc('pvReveal').length > n0);
  click(w, act(d, 'pv-cancel')); // changed their mind while it was on its way
  await sleep(700);
  await idle();
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 an answer that arrives after Cancel is not shown');
  DELAY.set('pvReveal', [400]);
  click(w, showBtn(d, 'Asha Rao', 'phone'));
  await until(() => askCard(d));
  change(w, q(d, '#pvReason'), 'contact');
  click(w, act(d, 'pv-go'));
  await sleep(50);
  await openTab(Pg, 'volunteers'); // moved on
  await sleep(600);
  await idle();
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 an answer that arrives after the tab changed is not shown');
  await openTab(Pg, 'regs');
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 and it is not there when the tab is opened again');
  // a second press while the first is on its way asks once
  DELAY.set('pvReveal', [300]);
  const n1 = pvc('pvReveal').length;
  click(w, showBtn(d, 'Asha Rao', 'phone'));
  await until(() => askCard(d));
  change(w, q(d, '#pvReason'), 'contact');
  const go = act(d, 'pv-go');
  click(w, go);
  await sleep(30);
  const go2 = act(d, 'pv-go');
  if (go2) click(w, go2);
  if (go2) click(w, go2);
  await sleep(500);
  await idle();
  eq(pvc('pvReveal').length - n1, 1, 'U4 pressing Show again while the first is on its way asks the server once');
  click(w, q(rowOf(d, 'Asha Rao'), '[data-act="pv-hide"]'));
  // logging out and in again
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  click(w, act(d, 'logout'));
  await idle();
  ok(!!q(d, '#loginForm') && rawIn(d).length === 0, 'U4 logging out leaves the login page and no number on it');
  set(w, q(d, '#lgUser'), 'owner');
  set(w, q(d, '#lgPass'), pw.owner);
  submit(w, q(d, '#loginForm'));
  await until(() => q(d, '.tab'));
  await idle();
  await openTab(Pg, 'regs');
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4 and after logging in again nothing is shown');
}

/* ---------- U4b. a detail whose time is up is not drawn ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'regs');
  w.__slowSweep = 2500; // the page's clean-up is held back, so the moment between "time is up" and "thrown away" can be looked at
  TAMPER.set('pvReveal', (out) => Object.assign(out, { ms: 1000 }));
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  TAMPER.delete('pvReveal');
  eq(txt(q(rowOf(d, 'Asha Rao'), '.pvv')), '9848012345', 'U4b shown, for one second');
  await sleep(1150); // the second is up; the page has not thrown it away yet
  await reveal(Pg, 'Chitra Devi', 'email', 'fix'); // draws every cell again
  eq(qa(d, '.pvv').map(txt), ['chitra@example.com'], 'U4b a cell drawn after the time was up shows the dots again, and only the new detail is on the page');
  ok(!d.body.innerHTML.includes('9848012345') && txt(rowOf(d, 'Asha Rao')).includes(MASK('2345')) && !!showBtn(d, 'Asha Rao', 'phone'), 'U4b the number is not on the page (the dots and the Show button are back)');
  w.__slowSweep = 0;
  click(w, q(rowOf(d, 'Chitra Devi'), '[data-act="pv-hide"]'));
  await sleep(200);
  ok(qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U4b control: and nothing is left shown afterwards');
}

/* ---------- U5. when it fails ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'regs');
  const cases = [
    ['pv_too_many', /You have shown as many details as you may this hour/],
    ['pv_audit_failed', /The note in the audit trail could not be saved, so nothing was shown/],
    ['pv_not_found', /That detail is not there any more/],
    ['pv_need_reason', /Pick a reason first/],
    ['director_only', /Only a director/],
    ['not_allowed', /cannot use this page/],
    ['server_error', /Something went wrong on the server/],
    ['timeout', /No answer from the server/],
    ['pv_something_new', /Something went wrong \(pv_something_new\)/],
  ];
  for (const [code, re] of cases) {
    FAIL.set('pvReveal', { code });
    await reveal(Pg, 'Asha Rao', 'phone', 'contact');
    ok(re.test(txt(askCard(d))) && qa(d, '.pvv').length === 0 && rawIn(d).length === 0, 'U5 "' + code + '" is explained in the question, which stays open, and nothing is shown');
    // the same question can be tried again
    ok(!!act(d, 'pv-go') && !act(d, 'pv-go').disabled, 'U5 and the Show button works again');
    click(w, act(d, 'pv-cancel'));
  }
  // after a refusal the very next try works
  FAIL.set('pvReveal', { code: 'pv_too_many' });
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  click(w, act(d, 'pv-go'));
  await idle();
  await sleep(30);
  eq(qa(d, '.pvv').map(txt), ['9848012345'], 'U5 trying again after a refusal works');
  click(w, q(rowOf(d, 'Asha Rao'), '[data-act="pv-hide"]'));
  // the real server says the hourly limit is used up: forty shown, the forty-first is refused with the same words
  // (the hourly limit itself is tested against the real server in the backend suite)
  // the login ended
  FAIL.set('pvReveal', { code: 'not_logged_in' });
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  await until(() => q(d, '#loginForm'));
  ok(!!q(d, '#loginForm') && /Your session ended/.test(txt(q(d, '#lgErr'))) && rawIn(d).length === 0, 'U5 a login that has ended goes back to the login page, with nothing shown');
  set(w, q(d, '#lgUser'), 'owner');
  set(w, q(d, '#lgPass'), pw.owner);
  submit(w, q(d, '#loginForm'));
  await until(() => q(d, '.tab'));
  await idle();
  // what comes back is only ever text
  TAMPER.set('pvReveal', (out) => Object.assign(out, { value: IMG + '<script>window.__pwn=2</script>' }));
  await openTab(Pg, 'regs');
  await reveal(Pg, 'Asha Rao', 'phone', 'contact');
  ok(txt(q(rowOf(d, 'Asha Rao'), '.pvv')).includes('<img src=x'), 'U5 a detail with markup in it is shown as the characters it is');
  noMarkup(Pg, 'U5 and never becomes an element');
  TAMPER.delete('pvReveal');
  click(w, q(rowOf(d, 'Asha Rao'), '[data-act="pv-hide"]'));
  // a name with markup in it, in the question, the list and the trail
  await openTab(Pg, 'regs');
  await reveal(Pg, 'Eve', 'phone', 'contact');
  ok(/Eve <img src=x onerror="window\.__pwn=1">/.test(txt(rowOf(d, 'Eve'))), 'U5 a name with markup in it is shown as text in the list');
  noMarkup(Pg, 'U5 and nothing became an element');
  click(w, q(rowOf(d, 'Eve'), '[data-act="pv-hide"]'));
  click(w, showBtn(d, 'Eve', 'phone'));
  await until(() => askCard(d));
  ok(/Show the phone number of Eve <img/.test(txt(askCard(d))), 'U5 and in the question');
  noMarkup(Pg, 'U5 and the question made no element either');
  click(w, act(d, 'pv-cancel'));
  // the dots of a list are text too: whatever a list sends in place of a number or an address is drawn as the characters it is
  const SCRIPT3 = '<script>window.__pwn=3</script>';
  const hostile = (out) => {
    for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k].forEach((r) => { if (r && typeof r === 'object') { if ('phone' in r) r.phone = IMG; if ('email' in r) r.email = '<b>x</b>' + SCRIPT3; } });
    return out;
  };
  for (const m of ['listRegs', 'listVolunteers', 'listPacers']) TAMPER.set('rd:' + m, hostile);
  for (const [tab, who] of [['regs', 'Asha Rao'], ['volunteers', 'Asha Volunteer'], ['pacers', 'Kiran Pacer']]) {
    await openTab(Pg, 'overview');
    await openTab(Pg, tab);
    ok(txt(rowOf(d, who)).includes('<img src=x onerror="window.__pwn=1">'), 'U5 ' + tab + ': the dots of a list that has markup in them are shown as the characters they are');
    noMarkup(Pg, 'U5 ' + tab + ': and never become an element');
    if (tab === 'regs') ok(txt(rowOf(d, who)).includes('<b>x</b>' + SCRIPT3), 'U5 regs: an address with markup in it is shown as text too');
  }
  for (const m of ['listRegs', 'listVolunteers', 'listPacers']) TAMPER.delete('rd:' + m);
  await openTab(Pg, 'overview');
  await openTab(Pg, 'regs');
  eq(rawIn(d), [], 'U5 control: with the real lists the page holds no full number or address');
}

/* ---------- U6. the Privacy tab ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  const n0 = pvc('pvList').length;
  await openTab(Pg, 'pv');
  const first = pvc('pvList')[n0];
  ok(!!first && first.arg.ev === EV && first.arg.token.length >= 20, 'U6 the tab asks for the selected race, with the login token');
  ok(pvc().every((c) => ['pvList', 'pvReveal', 'pvExport', 'pvErasePlan', 'pvErase'].includes(c.method)), 'U6 every call is one of the five');
  const c = content(d);
  ok(/Every list in RaceOS and at the Expo desk hides phone numbers and e-mail addresses/.test(c) && /up to 40 an hour/.test(c) && /never the number or address/.test(c), 'U6 the tab explains the rules');
  ok(/Files with contact details/.test(c) && /Erase a person/.test(c) && /Who looked/.test(c), 'U6 and has the three cards');
  const live = {
    regs: rows('RDRegs').filter((r) => r.event === EV && r.name !== P.ERASED).length,
    vols: rows('RDVolunteers').filter((r) => r.event === EV && r.name !== P.ERASED).length,
    pacers: rows('RDPacers').filter((r) => r.event === EV && r.name !== P.ERASED).length,
  };
  eq(qa(d, '[data-act="pv-file"]').map(txt), [`Registrations (${live.regs})`, `Volunteers (${live.vols})`, `Pacers (${live.pacers})`], 'U6 the three files are offered, with how many people each holds');
  ok(/Wix Events, Wix Contacts and the findmybib list keep their own copy/.test(c), 'U6 the erase card says where else a person has to be erased');
  // the trail: who showed what, in words, newest first
  const trail = qa(d, '.card').find((x) => /Who looked/.test(txt(q(x, 'h3'))));
  const tr = [...trail.querySelectorAll('tr')].slice(1).map((r) => [...r.cells].map(txt));
  ok(tr.length >= 6, 'U6 the trail lists the shows made so far (' + tr.length + ' rows)');
  ok(tr.some((r) => r[1] === 'owner' && /Showed a phone number of Asha Rao/.test(r[2]) && /To contact them about the race/.test(r[2]) && r[3] === 'VHM Privacy Edition'), 'U6 a row says who showed whose number, why, and in which race');
  ok(tr.some((r) => /Showed an e-mail address of Chitra Devi/.test(r[2]) && /To check or correct their details/.test(r[2])), 'U6 an e-mail address too, with its reason in words');
  ok(tr.some((r) => r[1] === 'lead.one'), 'U6 a lead\'s show is there under the lead\'s name');
  ok(/^\d/.test(tr[0][0]) || /[A-Z][a-z]{2}/.test(tr[0][0]), 'U6 each row has a date and time (' + tr[0][0] + ')');
  eq(rawIn(d), [], 'U6 the tab holds no full number or address');
  ok(!/9848012345|asha\.rao@example\.com/.test(JSON.stringify(tr)), 'U6 and the trail itself holds none');
  // a note with markup in every field (the server would never send one; the page must not rely on it) is drawn as text
  TAMPER.set('pvList', (out) => Object.assign(out, { log: [{ at: '2026-11-14T05:00:00.000Z', by: IMG, action: 'contacts exported', target: IMG, detail: IMG + '<script>window.__pwn=2</script>', race: IMG, kind: '', reason: '', who: '' }].concat(out.log) }));
  await openTab(Pg, 'overview');
  await openTab(Pg, 'pv');
  const hostRow = [...qa(d, '.card').find((x) => /Who looked/.test(txt(q(x, 'h3')))).querySelectorAll('tr')].slice(1)[0];
  const hostCells = [...hostRow.cells].map(txt);
  ok(hostCells.every((x, i) => i === 0 || x.includes('<img src=x onerror="window.__pwn=1">')) && /contacts exported <img src=x onerror="window\.__pwn=1"><script>window\.__pwn=2<\/script>/.test(hostCells[2]), 'U6 a note with markup in its fields is drawn as the characters it is (who, what, the detail, the race)');
  noMarkup(Pg, 'U6 and never becomes an element');
  TAMPER.delete('pvList');
  await openTab(Pg, 'overview');
  await openTab(Pg, 'pv');
  ok(!/contacts exported <img src=x/.test(content(d)) && !/window\.__pwn=2/.test(content(d)), 'U6 control: with the real trail the note with markup is not there');
  // a failure is explained and can be tried again
  // (a page that has not opened the tab before: the first load fails)
  FAIL.set('pvList', { code: 'server_error' });
  await openTab(D2, 'pv');
  ok(/Something went wrong on the server/.test(content(D2.d)) && !!act(D2.d, 'retry') && !/Files with contact details/.test(content(D2.d)), 'U6 a first load that fails is explained, with a Try again button and none of the cards');
  click(D2.w, act(D2.d, 'retry'));
  await idle();
  await sleep(40);
  ok(/Files with contact details/.test(content(D2.d)) && /Erase a person/.test(content(D2.d)), 'U6 Try again loads the tab');
  // (a page that already has the tab: a failed refresh keeps what is there and says so)
  FAIL.set('pvList', { code: 'server_error' });
  await openTab(Pg, 'overview');
  await openTab(Pg, 'pv');
  ok(/Files with contact details/.test(content(d)) && /Something went wrong on the server/.test(toastOf(d)), 'U6 a refresh that fails keeps the tab as it was and says why');
}

/* ---------- U7. the files ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'pv');
  const nb = blobs.length;
  const n0 = pvc('pvExport').length;
  click(w, act(d, 'pv-file', '[data-kind="regs"]'));
  await sleep(100);
  ok(/Pick a reason first\./.test(toastOf(d)) && pvc('pvExport').length === n0 && blobs.length === nb, 'U7 a file without a reason is refused on the screen: no call, no file');
  change(w, q(d, '#pvFileReason'), 'contact');
  click(w, act(d, 'pv-file', '[data-kind="regs"]'));
  await until(() => pvc('pvExport').length > n0);
  await idle();
  await sleep(60);
  eq(pvc('pvExport').length - n0, 1, 'U7 one page was enough for this race');
  const call = pvc('pvExport')[n0];
  ok(call.arg.kind === 'regs' && call.arg.reason === 'contact' && call.arg.from === 0 && call.arg.ev === EV, 'U7 the call names the kind, the reason, the start, and the race');
  const blob = blobs[blobs.length - 1];
  ok(blobs.length === nb + 1 && /vhm-privacy-edition-regs-with-contacts\.csv$/.test(downloads[downloads.length - 1]), 'U7 one file was saved, named after the race and what it holds (' + downloads[downloads.length - 1] + ')');
  ok(blob.text.charCodeAt(0) === 0xfeff && blob.text.slice(1).startsWith('"Name","Ticket","Category","T-shirt size","Bib","Bib name","Payment","Phone","E-mail"\r\n'), 'U7 it starts with a byte-order mark and the heading row, so a spreadsheet reads it right');
  ok(blob.text.includes('9848012345') && blob.text.includes('asha.rao@example.com') && blob.text.includes('chitra@example.com'), 'U7 it holds the full numbers and addresses (that is what it is for)');
  eq(blob.text.split('\r\n').filter(Boolean).length - 1, rows('RDRegs').filter((r) => r.event === EV).length, 'U7 and one row for each person of this race');
  ok(!blob.text.includes('9812300777') && !blob.text.includes('olga@example.com'), 'U7 and nobody from another race');
  ok(/Saved vhm-privacy-edition-regs-with-contacts\.csv \(5 rows\)\. It is written in the audit trail\./.test(toastOf(d)), 'U7 the screen says what was saved');
  const note = audits('contacts exported').pop();
  ok(note && note.by === 'owner' && /^Registrations: rows 1-5 of 5 · contact$/.test(note.detail) && !/9848012345|asha/i.test(JSON.stringify(note)), 'U7 the audit trail has a note with who, which file, how many rows and why, and none of the details');
  const trail = qa(d, '.card').find((x) => /Who looked/.test(txt(q(x, 'h3'))));
  ok(/contacts exported/.test(txt(trail)) && /Registrations: rows 1-5 of 5 · contact/.test(txt(trail)), 'U7 and the trail on the screen shows it at once');
  eq(rawIn(d), [], 'U7 the page itself still holds no full number');
  // volunteers and pacers
  for (const [kind, label] of [['vols', 'Volunteers'], ['pacers', 'Pacers']]) {
    const nb2 = blobs.length;
    click(w, act(d, 'pv-file', `[data-kind="${kind}"]`));
    await until(() => blobs.length > nb2);
    await idle();
    ok(blobs.length === nb2 + 1 && blobs[blobs.length - 1].text.slice(1).startsWith('"Name",'), 'U7 the ' + label + ' file is saved');
  }
  ok(blobs[blobs.length - 2].text.includes('9000000002') && blobs[blobs.length - 1].text.includes('9111111111'), 'U7 each with its numbers');
  // a name that looks like a formula or markup is made safe in the file
  // (the real server does it; the page saves the text as it got it)
  const volText = blobs[blobs.length - 2].text;
  ok(volText.includes(IMG.replace(/"/g, '""')) || volText.includes('"Vol ' + IMG.replace(/"/g, '""') + '"'), 'U7 a name with markup is in the file as plain text');
  // several pages are put together in order, once each
  const full = blobs.find((x) => x.text.slice(1).startsWith('"Name","Ticket","Category"')).text;
  const lines = full.slice(1).split('\r\n').filter(Boolean);
  TAMPER.set('pvExport', (out, arg) => {
    if (arg.from !== 0 || out.total < 3) return out;
    const head = out.csv.split('\r\n').filter(Boolean);
    return Object.assign({}, out, { csv: head.slice(0, 3).join('\r\n') + '\r\n', count: 2, next: 2 });
  });
  const nb3 = blobs.length;
  const n1 = pvc('pvExport').length;
  click(w, act(d, 'pv-file', '[data-kind="regs"]'));
  await until(() => blobs.length > nb3);
  await idle();
  TAMPER.delete('pvExport');
  eq(pvc('pvExport').slice(n1).map((c) => c.arg.from), [0, 2], 'U7 a file of several pages asks for each page in turn, from where the server said the next starts');
  eq(blobs[blobs.length - 1].text.slice(1).split('\r\n').filter(Boolean), lines, 'U7 and the pages are put together in order, the heading once');
  // one press makes one file
  DELAY.set('pvExport', [300]);
  const nb4 = blobs.length;
  const n2 = pvc('pvExport').length;
  const fb = act(d, 'pv-file', '[data-kind="pacers"]');
  click(w, fb);
  await sleep(40);
  ok(qa(d, '[data-act="pv-file"]').every((b) => b.disabled) && /Preparing/.test(txt(act(d, 'pv-file', '[data-kind="pacers"]'))), 'U7 while a file is made, the three buttons are off and one says Preparing');
  for (const b of qa(d, '[data-act="pv-file"]')) click(w, b);
  await sleep(600);
  await idle();
  eq([pvc('pvExport').length - n2, blobs.length - nb4], [1, 1], 'U7 extra presses while a file is made change nothing: one call, one file');
  // failures
  for (const [code, re] of [['pv_audit_failed', /could not be saved, so nothing was shown/], ['director_only', /Only a director/], ['pv_need_reason', /Pick a reason first/], ['server_error', /Something went wrong on the server/]]) {
    FAIL.set('pvExport', { code });
    const nb5 = blobs.length;
    click(w, act(d, 'pv-file', '[data-kind="regs"]'));
    await sleep(120);
    await idle();
    ok(re.test(toastOf(d)) && blobs.length === nb5 && !!act(d, 'pv-file', '[data-kind="regs"]') && !act(d, 'pv-file', '[data-kind="regs"]').disabled, 'U7 "' + code + '" is explained, no file is saved, and the button works again');
    clearToast(d);
  }
  // a file in the middle of several pages that fails saves nothing
  TAMPER.set('pvExport', (out, arg) => (arg.from === 0 && out.total >= 3 ? Object.assign({}, out, { count: 2, next: 2 }) : out));
  FAIL.set('pvExport', { code: 'server_error', skip: 1 });
  const nb6 = blobs.length;
  click(w, act(d, 'pv-file', '[data-kind="regs"]'));
  await sleep(200);
  await idle();
  TAMPER.delete('pvExport');
  ok(blobs.length === nb6 && /Something went wrong on the server/.test(toastOf(d)), 'U7 if a later page fails, no half file is saved');
  // a lead cannot reach the server for a file even by forging the button
  const fb2 = L1.d.createElement('button');
  fb2.setAttribute('data-act', 'pv-file');
  fb2.setAttribute('data-kind', 'regs');
  q(L1.d, '.content').appendChild(fb2);
  click(L1.w, fb2);
  await sleep(150);
  ok(L1.calls.every((x) => x.method !== 'pvExport') && !/Pick a reason|Saved/.test(toastOf(L1.d)), 'U7 a made-up file button on a lead\'s page does nothing');
  fb2.remove();
}

/* ---------- U8. erasing a person ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'pv');
  const find = async (phone, email) => {
    set(w, q(d, '#pvFindForm [name="phone"]'), phone);
    set(w, q(d, '#pvFindForm [name="email"]'), email);
    const n = pvc('pvErasePlan').length;
    submit(w, q(d, '#pvFindForm'));
    await until(() => pvc('pvErasePlan').length > n);
    await idle();
    await sleep(40);
  };
  const erasedBox = () => txt(q(d, '#pvErase'));
  // nothing, or too little
  await find('', '');
  ok(/Type a whole phone number \(10 digits\) or a whole e-mail address\./.test(erasedBox()), 'U8 Find with nothing typed is told what to type');
  await find('98480', '');
  ok(/Type a whole phone number/.test(erasedBox()) && !q(d, '[data-act="pv-tick"]'), 'U8 a short number is refused too, and lists nobody');
  await find('9000099999', '');
  ok(/Nobody found with that number or address\./.test(erasedBox()), 'U8 a number nobody has says so');
  // the family's number
  await find('98480 12345', '');
  const items = qa(d, '#pvErase tr').slice(1).map((tr) => [...tr.cells].map(txt));
  eq(items.map((r) => [r[1].replace(/ Bib.*$/, ''), r[2]]).sort(), [['Asha Pacer', 'Pacer'], ['Asha Rao', 'Registration'], ['Asha Volunteer', 'Volunteer'], ['Bina Rao', 'Registration']], 'U8 Find lists every row of the number: two registrations (a family), a volunteer and a pacer');
  ok(items.every((r) => r[3] === 'VHM Privacy Edition' || r[3] === '–') && items.every((r) => /••••••2345/.test(r[4])), 'U8 each with its race, and only the dots');
  const planHtml = q(d, '#pvErase table').outerHTML;
  eq(RAWS.filter((x) => planHtml.includes(x)), [], 'U8 the list holds no full number or address (the box above it holds what the director typed)');
  const call = pvc('pvErasePlan').pop();
  ok(call.arg.phone === '98480 12345' && call.arg.email === '' && !('ev' in call.arg && call.arg.ev === undefined), 'U8 the number is sent as typed');
  ok(qa(d, '[data-act="pv-tick"]').length === 4 && qa(d, '[data-act="pv-tick"]').every((c) => !c.checked), 'U8 nothing is ticked at first');
  ok(act(d, 'pv-erase').disabled && /Erase 0 rows/.test(txt(act(d, 'pv-erase'))), 'U8 and the Erase button is off');
  ok(/4 rows found/.test(erasedBox()) && /tick only the rows that are this person/.test(erasedBox()), 'U8 the screen counts the rows and says a family can share a number');
  click(w, act(d, 'pv-tickall'));
  ok(qa(d, '[data-act="pv-tick"]').every((c) => c.checked) && /Erase 4 rows/.test(txt(act(d, 'pv-erase'))), 'U8 Tick all ticks them');
  click(w, act(d, 'pv-tickno'));
  ok(qa(d, '[data-act="pv-tick"]').every((c) => !c.checked) && /Erase 0 rows/.test(txt(act(d, 'pv-erase'))), 'U8 Tick none clears them');
  // tick Asha's registration and her volunteer row only
  const tick = (name, kindText) => {
    const tr = qa(d, '#pvErase tr').find((x) => txt(x).includes(name) && txt(x).includes(kindText));
    const c = q(tr, '[data-act="pv-tick"]');
    c.checked = true;
    c.dispatchEvent(new w.Event('change', { bubbles: true }));
    return c.getAttribute('data-key');
  };
  const k1 = tick('Asha Rao', 'Registration');
  const k2 = tick('Asha Volunteer', 'Volunteer');
  ok(k1 === 'reg~' + idOf.asha && k2 === 'vol~v1', 'U8 the ticks carry the keys of those rows');
  ok(/Erase 2 rows/.test(txt(act(d, 'pv-erase'))) && act(d, 'pv-erase').disabled, 'U8 two ticked: the button counts them and is still off (nothing typed)');
  for (const v of ['', 'erase', 'ERASE ', 'Erase', 'YES', ' ERASE', 'ERAS']) {
    set(w, q(d, '#pvConfirm'), v);
    ok(act(d, 'pv-erase').disabled, 'U8 "' + v + '" does not switch the button on');
  }
  // the same when the screen is drawn again from what it holds (another tab and back): the word typed so far is still ERAS, the ticks are there, the button is off
  await openTab(Pg, 'overview');
  await openTab(Pg, 'pv');
  ok(q(d, '#pvConfirm').value === 'ERAS' && qa(d, '[data-act="pv-tick"]:checked').length === 2 && /Erase 2 rows/.test(txt(act(d, 'pv-erase'))) && act(d, 'pv-erase').disabled, 'U8 drawn again with two ticked and "ERAS" typed, the button is still off');
  set(w, q(d, '#pvConfirm'), 'ERASE');
  await openTab(Pg, 'overview');
  await openTab(Pg, 'pv');
  ok(q(d, '#pvConfirm').value === 'ERASE' && !act(d, 'pv-erase').disabled, 'U8 and drawn again with ERASE typed, it is on');
  set(w, q(d, '#pvConfirm'), 'ERAS');
  // a click on a button that is off does nothing
  const n3 = pvc('pvErase').length;
  click(w, act(d, 'pv-erase'));
  await sleep(80);
  eq(pvc('pvErase').length, n3, 'U8 pressing the button while it is off asks the server nothing');
  // a failure: the plan changed behind the screen
  set(w, q(d, '#pvConfirm'), 'ERASE');
  ok(!act(d, 'pv-erase').disabled, 'U8 ERASE typed: the button is on');
  FAIL.set('pvErase', { code: 'pv_stale' });
  click(w, act(d, 'pv-erase'));
  await until(() => pvc('pvErase').length > n3);
  await idle();
  await sleep(40);
  ok(/The people found have changed\. Press Find again\./.test(erasedBox()) && rows('RDRegs').find((r) => r._id === idOf.asha).name === 'Asha Rao' && rows('RDVolunteers').find((r) => r._id === 'v1').name === 'Asha Volunteer', 'U8 a refusal is explained and nothing was erased');
  ok(qa(d, '[data-act="pv-tick"]:checked').length === 2 && qa(d, '#pvConfirm').length === 1, 'U8 and the ticks are still there to try again');
  // the real thing
  set(w, q(d, '#pvConfirm'), 'ERASE');
  const n4 = pvc('pvErase').length;
  // a question about showing a detail that is open at that moment (a Show button made up by hand here) is closed by the erase
  const ask = d.createElement('button');
  ask.setAttribute('data-act', 'pv-ask');
  ask.setAttribute('data-kind', 'reg');
  ask.setAttribute('data-id', idOf.asha);
  ask.setAttribute('data-field', 'phone');
  q(d, '.content').appendChild(ask);
  click(w, ask);
  await until(() => askCard(d));
  ok(!!askCard(d), 'U8 control: a question about a number is open on this tab');
  // a detail that is on the screen goes away with the erase
  click(w, act(d, 'pv-erase'));
  await until(() => pvc('pvErase').length > n4);
  await idle();
  await sleep(60);
  const er = pvc('pvErase').pop();
  ok(er.arg.confirm === 'ERASE' && er.arg.phone === '98480 12345' && er.arg.email === '' && JSON.stringify(er.arg.keys.slice().sort()) === JSON.stringify([k1, k2].sort()) && er.arg.token.length >= 20, 'U8 the call holds only the two ticked keys, the word, and the number the plan was made for');
  ok(/Erased: 1 registration, 1 volunteer\./.test(content(d)) && /Erased: 1 registration, 1 volunteer/.test(toastOf(d)), 'U8 the screen says what was erased');
  ok(!askCard(d), 'U8 and the open question about a number is closed (nothing that was being shown stays on the screen)');
  ok(!q(d, '[data-act="pv-tick"]') && !q(d, '#pvConfirm'), 'U8 the list and the confirm box are gone');
  const R1 = rows('RDRegs').find((r) => r._id === idOf.asha);
  const R2 = rows('RDRegs').find((r) => r._id === idOf.bina);
  const V1r = rows('RDVolunteers').find((r) => r._id === 'v1');
  const P2 = rows('RDPacers').find((r) => r._id === 'p2');
  ok(R1.name === P.ERASED && R1.phone === '' && R1.email === '' && R1.bib === '101' && R1.ticketNumber === 'T101', 'U8 the registration lost the person and kept the bib and ticket');
  ok(V1r.name === P.ERASED && V1r.phone === '' && V1r.email === '' && V1r.club === '', 'U8 the volunteer row lost the person');
  ok(R2.name === 'Bina Rao' && R2.phone === '+91 98480 12345' && P2.name === 'Asha Pacer' && P2.phone === '+91 98480-12345', 'U8 the family member and the pacer who were not ticked are untouched');
  ok(/person erased/.test(content(d)) && /1 registration, 1 volunteer/.test(content(d)), 'U8 the trail on the screen has the erase');
  const note = audits('person erased').pop();
  ok(note && note.by === 'owner' && note.detail === '1 registration, 1 volunteer' && !/Asha|9848012345/.test(JSON.stringify(note)), 'U8 and the note names no person and no number');
  // the lists now
  await openTab(Pg, 'regs');
  const er1 = rowOf(d, P.ERASED);
  ok(!!er1 && !q(er1, '[data-act="pv-ask"]') && !rowOf(d, 'Asha Rao'), 'U8 Registrations: the erased person is "(erased)", with nothing to show');
  eq(rawIn(d).filter((x) => /98480|asha\.rao/.test(x)).length <= 0, true, 'U8 Registrations: the erased number is nowhere');
  // the same person, found again, now only has what was not ticked
  await openTab(Pg, 'pv');
  await find('9848012345', '');
  eq(qa(d, '#pvErase tr').slice(1).map((tr) => txt(tr.cells[1]).replace(/ Bib.*$/, '')).sort(), ['Asha Pacer', 'Bina Rao'], 'U8 searching again finds only the rows that are left');
  // by e-mail
  await find('', 'Chitra@Example.com');
  eq(qa(d, '#pvErase tr').slice(1).map((tr) => [txt(tr.cells[1]).replace(/ Bib.*$/, ''), txt(tr.cells[2])]), [['Chitra Devi', 'Registration']], 'U8 an e-mail address finds a person whatever its case');
  // warnings about places that could not be read
  TAMPER.set('pvErasePlan', (out) => Object.assign(out, { unread: ['Expo runners', 'Volunteers'] }));
  await find('9812300103', '');
  ok(/These could not be read, so nobody was looked for in them: Expo runners, Volunteers\./.test(erasedBox()), 'U8 places that could not be read are named');
  TAMPER.delete('pvErasePlan');
  TAMPER.set('pvErase', (out) => Object.assign(out, { unread: ['Hand-over records'] }));
  tick('Chitra Devi', 'Registration');
  set(w, q(d, '#pvConfirm'), 'ERASE');
  click(w, act(d, 'pv-erase'));
  await idle();
  await sleep(60);
  TAMPER.delete('pvErase');
  ok(/Erased: 1 registration\./.test(erasedBox()) && /These could not be read, so what hangs on the person in them was not changed: Hand-over records\./.test(erasedBox()), 'U8 after an erase the same is said about what hangs on the person');
  // refusals of the plan
  for (const [code, re] of [['pv_too_big', /more than 200 rows/], ['director_only', /Only a director/], ['server_error', /Something went wrong on the server/]]) {
    FAIL.set('pvErasePlan', { code });
    await find('9812300999', '');
    ok(re.test(erasedBox()) && !q(d, '[data-act="pv-tick"]') && !act(d, 'pv-erase'), 'U8 "' + code + '" is explained and nothing can be erased from it');
  }
  // the Find button is off while it looks
  DELAY.set('pvErasePlan', [300]);
  set(w, q(d, '#pvFindForm [name="phone"]'), '9812300107');
  const n5 = pvc('pvErasePlan').length;
  submit(w, q(d, '#pvFindForm'));
  await sleep(40);
  submit(w, q(d, '#pvFindForm'));
  ok(q(d, '#pvFindForm button').disabled && /Looking/.test(txt(q(d, '#pvFindForm button'))), 'U8 the Find button says Looking and is off while it looks');
  await sleep(500);
  await idle();
  eq(pvc('pvErasePlan').length - n5, 1, 'U8 a second Find while it looks asks once');
  // a name with markup in the list
  ok(/Eve <img src=x onerror="window\.__pwn=1">/.test(txt(q(d, '#pvErase'))), 'U8 a name with markup is shown as text in the list');
  noMarkup(Pg, 'U8 and made no element');
}

/* ---------- U9. editing a pacer ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'pacers');
  click(w, q(rowOf(d, 'Kiran Pacer'), '[data-act="pacerEdit"]'));
  await sleep(60);
  const f = q(d, '#pacerForm');
  const ph = q(f, '[name="phone"]');
  ok(ph.value === '' && /Keep ••••••1111/.test(ph.getAttribute('placeholder')), 'U9 the edit form does not hold the dots: the box is empty and says the number is kept');
  ok(!f.innerHTML.includes('9111111111') && rawIn(d).length === 0, 'U9 and the form holds no full number');
  set(w, q(f, '[name="name"]'), 'Kiran Pacer Two');
  const n = Pg.calls.length;
  submit(w, f);
  await until(() => Pg.calls.slice(n).some((c) => c.method === 'savePacer'));
  await idle();
  const sp = Pg.calls.slice(n).find((c) => c.method === 'savePacer');
  ok(sp.arg.phone === '' && sp.arg.id === 'p1' && sp.arg.name === 'Kiran Pacer Two', 'U9 saving sends the name and an empty number');
  eq(rows('RDPacers').find((r) => r._id === 'p1').phone, '9111111111', 'U9 and the number on file is untouched');
  eq(rows('RDPacers').find((r) => r._id === 'p1').name, 'Kiran Pacer Two', 'U9 while the name was changed');
  // a new number typed in the box replaces it
  click(w, q(rowOf(d, 'Kiran Pacer Two'), '[data-act="pacerEdit"]'));
  await sleep(60);
  set(w, q(d, '#pacerForm [name="phone"]'), '98765 43210');
  submit(w, q(d, '#pacerForm'));
  await idle();
  await sleep(60);
  eq(rows('RDPacers').find((r) => r._id === 'p1').phone, '9876543210', 'U9 a number typed in the box replaces the one on file');
  // a bad one is refused and explained
  click(w, q(rowOf(d, 'Kiran Pacer Two'), '[data-act="pacerEdit"]'));
  await sleep(60);
  set(w, q(d, '#pacerForm [name="phone"]'), '123');
  submit(w, q(d, '#pacerForm'));
  await idle();
  await sleep(60);
  ok(/Please enter a valid phone number/.test(toastOf(d)) && rows('RDPacers').find((r) => r._id === 'p1').phone === '9876543210', 'U9 a short number is refused, explained, and the number on file stays');
  // a new pacer has an ordinary box
  click(w, act(d, 'pacerCancel') || q(d, '[data-act="pacerCancel"]'));
  await sleep(40);
  ok(q(d, '#pacerForm [name="phone"]').getAttribute('placeholder') === 'Mobile' && q(d, '#pacerForm [name="phone"]').value === '', 'U9 a new pacer\'s form has an ordinary Mobile box');
  // a pacer who has no number
  await pacer(EV, 'p3', { name: 'No Number Pacer', phone: '' });
  await openTab(Pg, 'regs');
  await openTab(Pg, 'pacers');
  click(w, q(rowOf(d, 'No Number Pacer'), '[data-act="pacerEdit"]'));
  await sleep(60);
  ok(/No number saved/.test(q(d, '#pacerForm [name="phone"]').getAttribute('placeholder')), 'U9 a pacer with no number says so in the box');
  click(w, q(d, '[data-act="pacerCancel"]'));
}

/* ---------- U10. spreadsheets from the lists ---------- */
{
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'regs');
  const nb = blobs.length;
  click(w, act(d, 'regCsv'));
  await sleep(80);
  const t1 = blobs[blobs.length - 1].text;
  ok(blobs.length === nb + 1 && /^Name,Email \(hidden\),Phone \(hidden\),Ticket,/.test(t1), 'U10 the Registrations file says in its heading that the details are hidden');
  ok(RAWS.every((x) => !t1.includes(x)) && t1.includes(MASK('2345')), 'U10 and holds the dots, never a full number or address');
  await openTab(Pg, 'volunteers');
  const nb2 = blobs.length;
  click(w, act(d, 'csv'));
  await sleep(80);
  const t2 = blobs[blobs.length - 1].text;
  ok(blobs.length === nb2 + 1 && /^Name,Mobile \(hidden\),Email \(hidden\),Club,/.test(t2) && RAWS.every((x) => !t2.includes(x)), 'U10 the Volunteers file is the same');
  // a lead has the same files (dots only) and no way to a file with the details
  await openTab(L1, 'volunteers');
  click(L1.w, act(L1.d, 'csv'));
  await sleep(80);
  ok(RAWS.every((x) => !blobs[blobs.length - 1].text.includes(x)), 'U10 a lead\'s file holds the dots as well');
}

/* ---------- U11. an old page code ---------- */
{
  OLD.pv = true;
  const Pg = AD;
  const { d, w } = Pg;
  await openTab(Pg, 'pv');
  ok(/This page's code is out of date/.test(content(d)) || /This page's code is out of date/.test(toastOf(d)), 'U11 the Privacy tab says the page code is out of date');
  await openTab(Pg, 'regs');
  eq(rawIn(d), [], 'U11 the lists still show only dots');
  await reveal(Pg, 'Bina Rao', 'phone', 'contact');
  ok(/This page's code is out of date/.test(txt(askCard(d))) && qa(d, '.pvv').length === 0, 'U11 and a Show says so in the question, and shows nothing');
  click(w, act(d, 'pv-cancel'));
  OLD.pv = false;
  FAIL.set('pvReveal', { code: 'backend_old' });
  await reveal(Pg, 'Bina Rao', 'phone', 'contact');
  ok(/The backend file is out of date/.test(txt(askCard(d))), 'U11 an old backend file is explained too');
  click(w, act(d, 'pv-cancel'));
}

/* ---------- U12. the Expo desk ---------- */
{
  await wd.insert('ExpoConfig', { _id: 'Import910', name: 'Privacy Run A', json: JSON.stringify({ bibLot: 50, shirtLot: { M: 20, L: 20 } }) }, SA);
  const mkRunner = (bib, name, phone, email) => wd.insert('Runners', { _id: 'Import910~' + bib, event: 'Import910', bib, name, bibName: '', cat: '10K', size: 'M', phone, email, example: '', checkedInAt: '', checkedInDesk: '', bibAt: '', bibDesk: '', shirtSize: '', shirtAt: '', shirtDesk: '' }, SA);
  await mkRunner('101', 'Asha Rao', '9848012345', 'asha.rao@example.com');
  await mkRunner('103', 'Chitra Devi', '9812300103', 'chitra@example.com');
  await mkRunner('107', 'Gita Nine', '9000012345', 'gita@example.com'); // the same last four digits as Asha
  const tail = '})();\n</script>';
  const page = expoHtml.replace(tail, 'window.__t={get S(){return S},search:search,exportRoster:exportRoster};' + tail);
  ok(expoHtml.includes(tail), 'U12 the Expo page ends the way the test expects');
  await wd.insert('ExpoStaff', { username: 'xd1', password: A.hashPassword('Xd1-pass-1'), role: 'desk', name: 'xd1', failCount: '0', lockUntil: '', desks: 'Desk 1 - BIB', race: 'Import910' }, SA);
  const tok = A.newToken();
  await wd.insert('ExpoSessions', { token: tok, username: 'xd1', desk: 'Desk 1 - BIB', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(page, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(win) { win.HTMLElement.prototype.scrollIntoView = () => {}; } });
  const w = dom.window;
  const d = w.document;
  const xblobs = [];
  w.URL.createObjectURL = () => 'blob:x';
  w.Blob = function (parts) {
    this.text = parts.join('');
    xblobs.push(this);
  };
  w.HTMLAnchorElement.prototype.click = function () {};
  const answer = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.parent }));
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    try {
      const r = await X[m.method](Object.assign({}, m.arg, { token: tok }));
      answer({ kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) });
    } catch (x) {
      answer({ kind: 'result', id: m.id, ok: false, error: x.message });
    }
  });
  await sleep(700);
  if (!d.querySelector('#pickForm').hidden) {
    d.querySelector('#pickForm').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
    await sleep(800);
  }
  const S = w.__t.S;
  ok(S.runners && S.runners.length >= 3, 'U12 the Expo desk has its runners (' + (S.runners || []).length + ')');
  const asha = S.runners.find((r) => r.bib === '101');
  ok(asha && asha.phone === MASK('2345') && /^a•••@e•••\.com$/.test(asha.email) && !/\d{5}/.test(asha.phone), 'U12 the desk holds dots: ' + (asha && asha.phone) + ' ' + (asha && asha.email));
  const rawHere = RAWS.concat(['9000012345', 'gita@example.com']).filter((x) => d.body.innerHTML.includes(x) || JSON.stringify(S.runners).includes(x));
  eq(rawHere, [], 'U12 no full number or address is in the desk page or its data');
  const ph = d.querySelector('#q').getAttribute('placeholder');
  ok(ph === 'Bib number, name or last 4 digits of the phone', 'U12 the search box says what it searches (' + ph + ')');
  const names = (qs) => w.__t.search(qs).list.map((r) => r.name);
  eq(names('2345').sort(), ['Asha Rao', 'Gita Nine'], 'U12 the last four digits find the runners they belong to');
  ok(names('9848012345').includes('Asha Rao'), 'U12 a whole number said out loud finds the runner by its last four digits');
  ok(names('9848012345').length >= 1 && names('9848012345').length <= 8, 'U12 and lists the few runners with those four digits to choose from');
  eq(names('asha.rao@example.com'), [], 'U12 an e-mail address finds nobody (the desk does not have it)');
  eq(names('chitra'), ['Chitra Devi'], 'U12 a name still works');
  eq(names('101'), ['Asha Rao'], 'U12 and so does a bib');
  eq(names('12'), [], 'U12 two digits are not a phone search');
  w.__t.exportRoster();
  await sleep(50);
  const csv = xblobs[xblobs.length - 1] ? xblobs[xblobs.length - 1].text : '';
  ok(/^.?"?bib"?,"?name"?,"?category"?,"?phone_hidden"?,"?registered_size"?,/.test(csv) && csv.includes(MASK('2345')) && !/9848012345|asha\.rao@example/.test(csv), 'U12 the desk\'s own CSV is headed phone_hidden and holds dots only');
  ok(rawIn(d).length === 0, 'U12 still nothing in the page');
}

ok(jserr.length === 0, 'the page raised no script errors' + (jserr.length ? ': ' + jserr.slice(0, 3).join(' | ') : ''));
done();
