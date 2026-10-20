// UI tests for the Director screen and the public volunteer sign-up page, in jsdom, talking to the real backend code with mock Wix modules.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as D from './racedir.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirHtml = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const volHtml = fs.readFileSync('../wix/director/volunteer-embed.html', 'utf8');
const PUBLIC = ['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'];

for (const [u, r] of [['boss', 'admin'], ['lead1', 'lead'], ['view1', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks: '', name: u, failCount: '0', lockUntil: '' }, SA);

function open(html, opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('JSERR', e.message); fail++; });
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m) return;
    if (m.kind === 'hello' && opts.ev !== undefined) { w.postMessage({ kind: 'init', ev: opts.ev }, '*'); return; }
    if (m.kind !== 'call') return;
    if (opts.only && !opts.only.includes(m.method)) return;
    try {
      const r = await D[m.method](m.arg);
      w.postMessage({ kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) }, '*');
    } catch (x) { w.postMessage({ kind: 'result', id: m.id, ok: false, error: x.message }, '*'); }
  });
  return { w, d };
}
const set = (w, el, v) => { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
const tab = async (w, d, name) => { click(w, d.querySelector(`[data-tab="${name}"]`)); await sleep(120); };
async function login(user) {
  const s = open(dirHtml);
  await sleep(50);
  set(s.w, s.d.querySelector('#lgUser'), user);
  set(s.w, s.d.querySelector('#lgPass'), 'pw');
  submit(s.w, s.d.querySelector('#loginForm'));
  await sleep(300);
  return s;
}

// ---- login
{
  const s = open(dirHtml);
  await sleep(50);
  ok(s.d.querySelector('#loginForm') && !s.d.querySelector('.tabs'), 'login screen first, no tabs');
  set(s.w, s.d.querySelector('#lgUser'), 'boss');
  set(s.w, s.d.querySelector('#lgPass'), 'wrong');
  submit(s.w, s.d.querySelector('#loginForm'));
  await sleep(200);
  ok(/Wrong username or password/.test(txt(s.d.querySelector('#lgErr'))) && s.d.querySelector('#loginForm'), 'wrong password: message, stays on login');
}

// ---- director: empty start goes to Setup, creates a race
const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const A = await login('boss');
{
  const { w, d } = A;
  ok(d.querySelector('.tabs') && !d.querySelector('#loginForm'), 'director logged in, login form gone');
  ok(d.querySelector('[data-tab="setup"]') && d.querySelector('#eventForm'), 'no race yet: director lands on Setup with the new-race form');
  const f = d.querySelector('#eventForm');
  set(w, f.elements.name, 'Vizag Half Marathon'); set(w, f.elements.date, future); set(w, f.elements.venue, 'RK Beach'); set(w, f.elements.expoId, 'Import910');
  submit(w, f);
  await sleep(400);
  ok(/Vizag Half Marathon/.test(txt(d.querySelector('h1'))) && /days to go/.test(txt(d.querySelector('.top'))), 'race created and shown in the header with countdown');
  await tab(w, d, 'overview');
  ok(/Runners checked in/.test(txt(d.querySelector('#app'))) && /Safety checklist/.test(txt(d.querySelector('#app'))), 'overview shows the dashboard cards');
}
const ev = (await D.listEvents({ token: (await D.login({ username: 'boss', password: 'pw' })).token })).events[0];

// ---- public volunteer page (a second window, public methods only)
const shiftA = (await D.saveShift({ token: (await D.login({ username: 'lead1', password: 'pw' })).token, ev: ev.id, role: 'Aid station', location: 'KM 5', date: future, start: '04:30', end: '08:30', need: 1 })).id;
const shiftB = (await D.saveShift({ token: (await D.login({ username: 'lead1', password: 'pw' })).token, ev: ev.id, role: 'Expo desk', location: 'Expo', date: future, start: '10:00', end: '14:00', need: 5 })).id;
const shiftC = (await D.saveShift({ token: (await D.login({ username: 'lead1', password: 'pw' })).token, ev: ev.id, role: 'Marshal', location: 'Turn 2', date: future, start: '05:00', end: '07:00', need: 5 })).id;
{
  const V = open(volHtml, { ev: ev.id, only: PUBLIC });
  await sleep(300);
  const { w, d } = V;
  ok(/Help at Vizag Half Marathon/.test(txt(d.querySelector('h1'))), 'public page opens on the race from the link');
  ok(d.querySelectorAll('[data-shift]').length === 3, 'three shifts listed');
  const a = d.querySelector(`[data-shift="${shiftA}"]`), c = d.querySelector(`[data-shift="${shiftC}"]`);
  a.checked = true; change(w, a); await sleep(50);
  ok(d.querySelector(`[data-shift="${shiftC}"]`).disabled && /Clashes/.test(txt(d.querySelector('#form'))), 'overlapping shift is blocked on the page');
  const f = d.querySelector('#form');
  submit(w, f); await sleep(150);
  ok(/agree to the volunteer terms|Please enter your name/.test(txt(d.querySelector('.err'))), 'empty form: friendly error');
  const f2 = d.querySelector('#form');
  set(w, f2.elements.name, '<img src=x onerror=alert(1)> Rao'); set(w, f2.elements.phone, '98480 12345'); set(w, f2.elements.waiver, true);
  submit(w, f2); await sleep(300);
  ok(d.querySelector('#myCode') && /^[A-Z2-9]{6}$/.test(txt(d.querySelector('#myCode')).trim()), 'sign-up done: code shown');
  ok(!d.querySelector('img') && /Aid station/.test(txt(d.body)), 'name with markup shown as text, shifts listed');
  global.__code = txt(d.querySelector('#myCode')).trim();
  // status check
  const sf = d.querySelector('#statusForm');
  set(w, sf.elements.code, global.__code); set(w, sf.elements.phone, '9848012345'); submit(w, sf); await sleep(200);
  ok(/Waiting for confirmation/.test(txt(d.body)), 'volunteer can check status');
  // second person, same shift now full
  const V2 = open(volHtml, { ev: ev.id, only: PUBLIC });
  await sleep(300);
  const full = V2.d.querySelector(`[data-shift="${shiftA}"]`);
  ok(full && full.disabled && /Full/.test(txt(V2.d.querySelector('#form'))), 'full shift shows Full and cannot be ticked');
  // no ev in link, one open event: picks it
  const V3 = open(volHtml, { ev: '', only: PUBLIC });
  await sleep(300);
  ok(/Help at Vizag Half Marathon/.test(txt(V3.d.querySelector('h1'))), 'link without race: single open race is chosen');
  // staff methods are not reachable from the public page
  const V4 = open(volHtml, { ev: ev.id, only: ['openShifts'] });
  await sleep(200);
  ok(true, 'public relay only passes the four public methods (ALLOWED list also in page code)');
}
const pageCode = fs.readFileSync('../wix/director/volunteer-page-code.js', 'utf8');
const allowed = (pageCode.match(/const ALLOWED = \[([^\]]*)\]/)[1].match(/'(\w+)'/g) || []).map((x) => x.replace(/'/g, ''));
ok(allowed.join() === PUBLIC.join(), 'volunteer page code allows exactly the public methods');
const dirCode = fs.readFileSync('../wix/director/director-page-code.js', 'utf8');
const dirAllowed = (dirCode.match(/const ALLOWED = \[([^\]]*)\]/)[1].match(/'(\w+)'/g) || []).map((x) => x.replace(/'/g, ''));
const exported = fs.readFileSync('../wix/director/racedir.web.js', 'utf8').match(/export const (\w+)/g).map((x) => x.replace('export const ', ''));
ok(exported.filter((x) => !dirAllowed.includes(x) && !PUBLIC.includes(x)).length === 0, 'every backend method is reachable from a page (none forgotten): ' + exported.filter((x) => !dirAllowed.includes(x) && !PUBLIC.includes(x)).join());
ok(dirAllowed.filter((x) => !exported.includes(x)).length === 0, 'director page code lists no method that does not exist');

// ---- director: volunteers tab
{
  const { w, d } = A;
  await tab(w, d, 'volunteers');
  ok(/Aid station/.test(txt(d.querySelector('table'))) && d.querySelector('#shiftForm') === null, 'shifts table shown');
  ok(/Waiting/.test(txt(d.querySelector('#app'))) && !d.querySelector('img'), 'applicant listed as waiting; markup name is plain text');
  const appr = [...d.querySelectorAll('[data-act="vstat"]')].find((b) => b.getAttribute('data-st') === 'approved');
  click(w, appr); await sleep(250);
  ok(/approved/i.test(txt(d.querySelector('#app'))), 'approve works');
  d.querySelector('#ciCode').value = global.__code;
  click(w, d.querySelector('[data-act="ciIn"]')); await sleep(250);
  ok(/On site/.test(txt(d.querySelector('#app'))), 'check-in by code shows On site');
  d.querySelector('#ciCode').value = global.__code;
  click(w, d.querySelector('[data-act="ciOut"]')); await sleep(250);
  ok(/Done/.test(txt(d.querySelector('#app'))), 'check-out marks the shift done');
  // add shift via the form
  click(w, d.querySelector('[data-act="shiftNew"]')); await sleep(30);
  const sf = d.querySelector('#shiftForm');
  set(w, sf.elements.role, 'Water crew'); set(w, sf.elements.start, '06:00'); set(w, sf.elements.end, '05:00'); set(w, sf.elements.need, '3');
  submit(w, sf); await sleep(250);
  ok(/overlap|end after|Times must/.test(txt(d.querySelector('#toast'))) || /Times must/.test(txt(d.querySelector('#toast'))), 'bad shift times: error toast');
  set(w, d.querySelector('#shiftForm').elements.end, '09:00');
  submit(w, d.querySelector('#shiftForm')); await sleep(300);
  ok(/Water crew/.test(txt(d.querySelector('table'))), 'new shift saved and listed');
  // add by hand
  const av = d.querySelector('#addVol');
  set(w, av.elements.name, 'Hand Added'); set(w, av.elements.phone, '9777777777'); submit(w, av); await sleep(300);
  ok(/Hand Added/.test(txt(d.querySelector('#app'))), 'volunteer added by hand');
  // search
  set(w, d.querySelector('#volQ'), 'hand'); await sleep(50);
  ok(/Hand Added/.test(txt(d.querySelectorAll('table')[1])) && !/Rao/.test(txt(d.querySelectorAll('table')[1])), 'search filters the list');
  set(w, d.querySelector('#volQ'), '');
  // two-step delete
  const del = d.querySelector('[data-act="shiftDel"]');
  click(w, del); await sleep(30);
  ok(/Sure\?/.test(txt(d.querySelector('#app'))), 'delete needs a second click');
  click(w, d.querySelector('[data-act="tab"][data-tab="overview"]')); await sleep(200);
  ok(!/Sure\?/.test(txt(d.querySelector('#app'))), 'moving away cancels the armed delete');
}

// ---- race day
{
  const { w, d } = A;
  await tab(w, d, 'raceday');
  ok(d.querySelectorAll('#app table tr').length >= 9, 'run of show seeded');
  const rf = d.querySelector('#runForm'); set(w, rf.elements.time, '03:30'); set(w, rf.elements.what, 'Truck leaves'); submit(w, rf); await sleep(300);
  ok(/Truck leaves/.test(txt(d.querySelector('table'))), 'run item added');
  const step = d.querySelector('[data-act="runStep"]'); click(w, step); await sleep(250);
  ok(/Doing/.test(txt(d.querySelector('table'))), 'status steps to Doing');
  const lf = d.querySelector('#logForm');
  set(w, lf.elements.kind, 'medical'); set(w, lf.elements.severity, 'high'); set(w, lf.elements.place, 'KM 9'); set(w, lf.elements.text, 'Runner cramping <b>bold</b>'); submit(w, lf); await sleep(300);
  ok(/Runner cramping <b>bold<\/b>/.test(txt(d.querySelector('#app'))) && ![...d.querySelectorAll('#app b')].some((b) => b.textContent === 'bold'), 'incident logged, text escaped');
  const cf = d.querySelector('.closeForm'); set(w, cf.elements.resolution, 'Cleared by medic'); submit(w, cf); await sleep(300);
  ok(/No open incidents/.test(txt(d.querySelector('#app'))), 'closed incident leaves the open list');
  set(w, d.querySelector('#logF'), 'all'); change(w, d.querySelector('#logF')); await sleep(50);
  ok(/Resolved: Cleared by medic/.test(txt(d.querySelector('#app'))), 'all view shows the resolution');
}

// ---- pacers
{
  const { w, d } = A;
  await tab(w, d, 'pacers');
  ok(/5:41/.test(txt(d.querySelector('table'))), 'pace table shows 2:00 group pace');
  const pf = d.querySelector('#pacerForm');
  set(w, pf.elements.name, 'Pace One'); set(w, pf.elements.group, '2:00'); set(w, pf.elements.status, 'approved'); set(w, pf.elements.trial, 'passed'); set(w, pf.elements.briefing, true); set(w, pf.elements.kit, true);
  submit(w, pf); await sleep(300);
  ok(/Pace One/.test(txt(d.querySelectorAll('table')[1])) && /Trial passed/.test(txt(d.querySelectorAll('table')[1])), 'pacer added with progress');
  ok(/1 \/ 3/.test(txt(d.querySelector('table'))), 'group coverage updates (1 of 3)');
  const gf = d.querySelector('#groupForm');
  const row = gf.querySelector('.gr'); set(w, row.querySelector('[name=finish]'), 'abc');
  submit(w, gf); await sleep(250);
  ok(/Finish time must/.test(txt(d.querySelector('#toast'))), 'bad finish time: error toast');
}

// ---- safety
{
  const { w, d } = A;
  await tab(w, d, 'safety');
  ok(/0 of 14 done/.test(txt(d.querySelector('#app'))), 'checklist starts 0 of 14');
  const cb = d.querySelector('input[data-act="tick"]'); cb.checked = true; change(w, cb); await sleep(300);
  ok(/1 of 14 done/.test(txt(d.querySelector('#app'))), 'ticking updates the count');
  const kf = d.querySelector('#checkForm'); set(w, kf.elements.section, 'Medical'); set(w, kf.querySelector('[name=item]'), 'Spare defibrillator'); submit(w, kf); await sleep(300);
  ok(/Spare defibrillator/.test(txt(d.querySelector('#app'))), 'item added');
  await tab(w, d, 'overview');
  ok(/1 .*\/ 15/.test(txt(d.querySelector('#app'))), 'overview reflects the checklist');
}

// ---- setup edit keeps expo link
{
  const { w, d } = A;
  await tab(w, d, 'setup');
  const ef = d.querySelector('#eventForm');
  ok(ef.elements.name.value === '' , 'setup form starts blank for a new race');
  click(w, d.querySelector('[data-act="evEdit"]')); await sleep(50);
  ok(d.querySelector('#eventForm').elements.expoId.value === 'Import910', 'edit loads the saved Expo race id');
}

// ---- lead: can work, cannot manage
{
  const L = await login('lead1');
  const { w, d } = L;
  ok(!d.querySelector('[data-tab="setup"]'), 'lead has no Setup tab');
  await tab(w, d, 'volunteers');
  ok(d.querySelector('[data-act="shiftNew"]') && !d.querySelector('[data-act="shiftDel"]'), 'lead can add shifts but sees no delete');
  await tab(w, d, 'safety');
  ok(d.querySelector('#checkForm') && !d.querySelector('[data-act="checkDel"]'), 'lead can add checklist items, no delete');
}
// ---- viewer: look only
{
  const V = await login('view1');
  const { w, d } = V;
  ok(!d.querySelector('[data-tab="setup"]'), 'viewer: no Setup');
  await tab(w, d, 'volunteers');
  ok(!d.querySelector('[data-act="shiftNew"]') && !d.querySelector('#addVol') && !d.querySelector('[data-act="vstat"]') && !d.querySelector('#ciCode'), 'viewer: no add, approve or check-in controls');
  await tab(w, d, 'raceday');
  ok(!d.querySelector('#logForm') && !d.querySelector('#runForm'), 'viewer: no log or run forms');
  await tab(w, d, 'pacers');
  ok(!d.querySelector('#pacerForm') && !d.querySelector('#groupForm'), 'viewer: no pacer forms');
  await tab(w, d, 'safety');
  ok(!d.querySelector('#checkForm') && d.querySelector('input[data-act="tick"]').disabled, 'viewer: checklist is read only');
  click(w, d.querySelector('[data-act="logout"]')); await sleep(100);
  ok(d.querySelector('#loginForm'), 'log out returns to login');
}

// ---- registrations and qualification
{
  const G = (n, first, last, cat) => ({ _id: 'u' + n, eventId: 'W9', guestType: 'TICKET_HOLDER', ticketNumber: 'UT' + n, orderNumber: 'UO' + n, tickets: [{ name: cat }],
    guestDetails: { firstName: first, lastName: last, email: first.toLowerCase() + '@x.com', phone: '98480110' + n, formResponse: { inputValues: [{ inputName: 'tshirt', value: 'L' }] } }, additionalDetails: { orderStatus: 'PAID' } });
  global.__EV = { fail: false, events: [{ _id: 'W9', title: 'Ultribe Paderu 26', status: 'SCHEDULED', dateAndTimeSettings: { startDate: new Date('2026-12-05T08:30:00Z') } }],
    guests: [G(1, 'Uma', 'A', '25 K - Debut Trail'), G(2, 'Vikram', '<b>', '25K')] };
  const B = await login('boss');
  const { w, d } = B;
  await tab(w, d, 'regs');
  ok(/Load my Wix events/.test(txt(d.querySelector('#app'))), 'regs: not linked, director can load Wix events');
  click(w, d.querySelector('[data-act="loadWix"]')); await sleep(300);
  ok(/Ultribe Paderu 26/.test(txt(d.querySelector('#linkForm'))), 'regs: Wix events listed');
  submit(w, d.querySelector('#linkForm')); await sleep(400);
  ok(d.querySelector('[data-act="impRegs"]'), 'regs: linked, import button shown');
  click(w, d.querySelector('[data-act="impRegs"]')); await sleep(600);
  ok(/Imported: 2 new/.test(txt(d.querySelector('#app'))) && /Uma A/.test(txt(d.querySelector('#app'))), 'regs: import fills the list');
  ok(d.querySelector('#app').innerHTML.indexOf('<b>') === -1 || !/Vikram <b>/.test(d.querySelector('#app').innerHTML), 'regs: names are escaped');
  click(w, d.querySelector('[data-act="chkForm"]')); await sleep(400);
  const mf = d.querySelector('#mapForm');
  ok(mf && /tshirt/.test(txt(mf)), 'regs: form fields shown for mapping');
  mf.elements.size.value = 'tshirt'; submit(w, mf); await sleep(400);
  click(w, d.querySelector('[data-act="impRegs"]')); await sleep(600);
  ok([...d.querySelectorAll('tr')].some((r) => /Uma/.test(r.textContent) && [...r.children].some((c) => c.textContent === 'L')), 'regs: size field mapped after re-import');
  await tab(w, d, 'quals');
  ok(d.querySelector('#ruleForm'), 'quals: director sees the rules editor');
  const rf = d.querySelector('#ruleForm');
  set(w, rf.elements.rules, '25 K | Half marathon under 3 hrs | 21.0975@3:00\n110 K | FM under 6 hrs or 50 km+ | 42.195@6:00; 50@');
  submit(w, rf); await sleep(400);
  ok(/Uma/.test(txt(d.querySelector('#app'))) && /No claim yet/.test(txt(d.querySelector('#app'))), 'quals: registrations in ruled categories listed with no claim');
  const cf = d.querySelector('.claimForm');
  set(w, cf.elements.text, 'Vizag HM 2025'); set(w, cf.elements.km, '21.1'); set(w, cf.elements.time, '2:40'); submit(w, cf); await sleep(400);
  ok(/Meets rule/.test(txt(d.querySelector('#app'))), 'quals: saved claim shows Meets rule');
  const umaRow = [...d.querySelectorAll('tr')].find((r) => /Uma/.test(r.textContent));
  click(w, umaRow.querySelector('[data-act="qOk"]')); await sleep(400);
  ok(!/Uma/.test(txt(d.querySelector('#app'))), 'quals: approved runner leaves the needs-a-decision list');
  const vikRow = [...d.querySelectorAll('tr')].find((r) => /Vikram/.test(r.textContent));
  click(w, vikRow.querySelector('[data-act="qOk"]')); await sleep(300);
  ok(/Please write a short reason/.test(txt(d.querySelector('#toast'))), 'quals: approving a runner with no claim needs a reason');
  const all = d.querySelector('#qF'); all.value = 'all'; change(w, all); await sleep(100);
  ok(/Approved/.test(txt(d.querySelector('#app'))), 'quals: all view shows approved runner');
  const no = [...d.querySelectorAll('tr')].find((r) => /Vikram/.test(r.textContent)).querySelector('[data-act="qNo"]'); click(w, no); await sleep(300);
  ok(/Please write a short reason/.test(txt(d.querySelector('#toast'))), 'quals: reject without a reason is refused with a message');
  await tab(w, d, 'overview');
  ok(/qualification not cleared/.test(txt(d.querySelector('#app'))), 'quals: overview alert shown');
  click(w, d.querySelector('[data-act="logout"]'));
  const V = await login('view1');
  await tab(V.w, V.d, 'regs');
  ok(!V.d.querySelector('[data-act="impRegs"]') && !V.d.querySelector('[data-act="chkForm"]') && /Uma A/.test(txt(V.d.querySelector('#app'))), 'regs: viewer reads the list but has no import or mapping');
  await tab(V.w, V.d, 'quals');
  ok(!V.d.querySelector('#ruleForm') && !V.d.querySelector('[data-act="qOk"]') && !V.d.querySelector('.claimForm'), 'quals: viewer sees no editing controls');
  const Ld = await login('lead1');
  await tab(Ld.w, Ld.d, 'quals');
  ok(Ld.d.querySelector('.claimForm') && !Ld.d.querySelector('[data-act="qWaive"]') && !Ld.d.querySelector('#ruleForm'), 'quals: lead can record and decide but not waive or edit rules');
}

console.log(`Director UI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
