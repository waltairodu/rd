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

const day = (o) => new Date(Date.now() + 5.5 * 3600000 + o * 86400000).toISOString().slice(0, 10);

const future = day(20);
const A = await login('boss');
const { w, d } = A;
await sleep(100);
// create the race then categories via the Setup form
const f = d.querySelector('#eventForm');
set(w, f.elements.name, 'Vizag Half'); set(w, f.elements.date, future); set(w, f.elements.venue, 'RK Beach');
submit(w, f); await sleep(400);
const ev = (await D.listEvents({ token: (await D.login({ username: 'boss', password: 'pw' })).token })).events[0];
await tab(w, d, 'setup');
const cf = d.querySelector('#catForm');
ok(!!cf, 'setup shows the categories form for a saved race');
set(w, cf.elements.cats, '21.1K | 21.1 | 1500 | 100\n10K | 10 | 800 | 50\n5K');
submit(w, cf); await sleep(400);
ok(/Saved 3 categories/.test(txt(d.body)), 'categories saved with a toast');
const t = (await D.login({ username: 'boss', password: 'pw' })).token;
ok((await D.listEvents({ token: t })).events[0].cats.length === 3, 'categories stored');
// bad input shows the friendly message
set(w, d.querySelector('#catForm').elements.cats, '10K | x | -5'); submit(w, d.querySelector('#catForm')); await sleep(300);
ok(/Check the categories/.test(txt(d.body)), 'bad categories show a plain message');

// registrations
for (let i = 1; i <= 6; i++) await wd.insert('RDRegs', { _id: ev.id + '~t' + i, event: ev.id, ticketNumber: 't' + i, name: 'R' + i, cat: i < 4 ? '21.1K' : '10K', status: 'ok', at: day(-i) + 'T05:00:00.000Z', size: '', phone: '', email: '' }, SA);
await tab(w, d, 'overview'); await sleep(300);
const app = txt(d.querySelector('#app'));
ok(/Total registrations/.test(app) && /6/.test(app), 'overview: total registrations card');
ok(/Revenue/.test(app) && /₹/.test(app), 'overview: revenue card for a director');
ok(!!d.querySelector('svg[aria-label^="Registrations over time"]'), 'overview: trend line chart drawn');
ok(!!d.querySelector('svg[aria-label="Registrations by category"]') && /50%/.test(app), 'overview: category donut with percentages');
ok(/21\.1K/.test(app) && /Fee/.test(app), 'overview: category table with fees');
ok(d.querySelectorAll('.rcard').length === 1 && /Vizag Half/.test(txt(d.querySelector('.rcard'))), 'overview: race card listed');
ok(/Quick actions/.test(app) && !!d.querySelector('[data-act="tab"][data-tab="regs"]'), 'overview: quick actions');
ok(/Race readiness/.test(app) && /Needs attention/.test(app), 'overview: readiness and attention still shown');
click(w, d.querySelector('[data-act="openRace"]')); await sleep(300);
ok(/Total registrations/.test(txt(d.querySelector('#app'))), 'open race keeps the dashboard working');

// viewer: no money anywhere on the dashboard
const V = await login('view1'); await sleep(200);
await tab(V.w, V.d, 'overview'); await sleep(300);
const va = txt(V.d.querySelector('#app'));
ok(/Total registrations/.test(va) && !/Revenue/.test(va) && !/₹/.test(va), 'viewer sees counts but no revenue or fees');
ok(!V.d.querySelector('#catForm'), 'viewer has no categories form');

// empty race: no crash
const E2 = (await D.saveEvent({ token: t, name: 'Empty race', date: day(40) })).event.id;
await tab(w, d, 'setup'); await sleep(100);
w.postMessage({ kind: 'noop' }, '*');
console.log(`dash-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
