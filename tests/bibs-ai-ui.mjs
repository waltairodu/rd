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


const future = day(5);
global.__SECRETS = {};
const t0 = (await D.login({ username: 'boss', password: 'pw' })).token;
await wd.insert('ExpoConfig', { _id: 'VHM5', name: 'VHM 5th edition', json: JSON.stringify({ bibLot: 50, shirtLot: { S: 1, M: 20 } }) }, SA);
const A = await login('boss');
const { w, d } = A;
// create the race through Setup; the Expo race is picked from a list
await sleep(150);
let f = d.querySelector('#eventForm');
ok(f && f.elements.expoId.tagName === 'SELECT' && /VHM 5th edition/.test(txt(f.elements.expoId)), 'race form: Expo race is a dropdown of real Expo races');
set(w, f.elements.name, 'Vizag Half'); set(w, f.elements.date, future); set(w, f.elements.expoId, 'VHM5');
submit(w, f); await sleep(400);
const ev = (await D.listEvents({ token: t0 })).events[0];
ok(ev.expoId === 'VHM5', 'race saved with the chosen Expo race');
await D.saveCats({ token: t0, ev: ev.id, cats: [{ name: '21.1K', km: 21, price: 1000, cap: 100 }, { name: '10K', km: 10, price: 500, cap: 100 }] });
for (let i = 1; i <= 4; i++) await wd.insert('RDRegs', { _id: ev.id + '~t' + i, event: ev.id, ticketNumber: 't' + i, name: 'Runner ' + i, cat: i < 3 ? '21.1K' : '10K', status: 'ok', size: i <= 2 ? 'S' : 'M', at: day(-i) + 'T05:00:00.000Z', phone: '98765432' + i, email: '' }, SA);

// ---- Bibs and sync tab
await tab(w, d, 'bibs'); await sleep(300);
let app = txt(d.querySelector('#app'));
ok(/Linked to Expo race VHM 5th edition/.test(app) && /4 paid/.test(app), 'bibs tab: linked, paid count');
ok(/4.*without a bib/.test(app) && !!d.querySelector('[data-act="assignBibs"]') && !!d.querySelector('[data-act="sendExpo"]'), 'bibs tab: sync figures and the two buttons');
click(w, d.querySelector('[data-act="assignBibs"]')); await sleep(300);
ok(/Save bib number ranges first|bib number ranges/.test(txt(d.body)), 'assign without a plan shows a plain message');
const bf = d.querySelector('#bibForm');
set(w, bf.elements.bibs, '21.1K | 1001 | 1999\n10K | 2001 | 2999'); submit(w, bf); await sleep(400);
ok(/Saved 2 ranges/.test(txt(d.body)) && /1001 to 1999/.test(txt(d.querySelector('#app'))), 'ranges saved and shown');
set(w, d.querySelector('#bibForm').elements.bibs, '21.1K | 50 | 10\n'); submit(w, d.querySelector('#bibForm')); await sleep(300);
ok(/Check the ranges/.test(txt(d.body)), 'bad ranges: plain message');
click(w, d.querySelector('[data-act="assignBibs"]')); await sleep(400);
ok(/Numbered 4 runners/.test(txt(d.querySelector('#app'))), 'assign: result message');
click(w, d.querySelector('[data-act="sendExpo"]')); await sleep(400);
ok(/Sent 4 new runners to the Expo desk/.test(txt(d.querySelector('#app'))), 'send: result message');
app = txt(d.querySelector('#app'));
ok(/Runners at the desk4/.test(app) && /T-shirt sizes: needed against stock/.test(app) && /short/.test(app), 'after sending: desk figures and short stock flagged');
click(w, d.querySelector('[data-act="sendExpo"]')); await sleep(300);
ok(/Sent 0 new runners/.test(txt(d.querySelector('#app'))), 'sending again adds nobody');
ok(/Latest/.test(app) && /Desk activity/.test(app), 'activity cards present');
ok(!/9876543/.test(app), 'no phone numbers on the Bibs tab');
// overview shows the alert
await tab(w, d, 'overview'); await sleep(300);
ok(/T-shirt stock is short for size S/.test(txt(d.querySelector('#app'))), 'overview alert for short T-shirt stock');
// viewer: read only
const V = await login('view1'); await sleep(200);
await tab(V.w, V.d, 'bibs'); await sleep(300);
ok(/Runners at the desk4/.test(txt(V.d.querySelector('#app'))) && !V.d.querySelector('[data-act="assignBibs"]') && !V.d.querySelector('#bibForm'), 'viewer sees figures but no buttons or form');

// ---- Ask RaceOS tab, no key
await tab(w, d, 'ai'); await sleep(400);
app = txt(d.querySelector('#app'));
ok(/Today's briefing/.test(app) && /Rule-based mode/.test(app) && /ANTHROPIC_API_KEY/.test(app), 'AI tab: rule-based mode explained');
ok(d.querySelector('#aiQ').disabled === true && !d.querySelector('[data-act="aiWrite"]'), 'AI tab: Ask and write-up disabled without a key');
ok(/Registrations by race day/.test(app) && /Volunteers/.test(app) && /Expected result/.test(app), 'forecast cards shown to a director');
ok(!!d.querySelector('#draftForm'), 'draft form shown');
let df = d.querySelector('#draftForm');
set(w, df.elements.kind, 'runner_update'); set(w, df.elements.notes, 'Pickup on Friday'); submit(w, df); await sleep(400);
ok(/From a template/.test(txt(d.querySelector('#app'))) && /Vizag Half/.test(d.querySelector('#dBody').value) && /Pickup on Friday/.test(d.querySelector('#dBody').value) && d.querySelector('#dSubject').value.length > 3, 'template draft appears with subject and body');
// sponsor kinds show a sponsor chooser
await D.savePlanItem({ token: t0, ev: ev.id, kind: 'sponsor', phase: 'cash', title: 'Acme Bank', party: 'Acme Bank', amount: 50000, status: 'committed' });
// viewer: no money, no draft form
await tab(V.w, V.d, 'ai'); await sleep(400);
const va = txt(V.d.querySelector('#app'));
ok(/Today's briefing/.test(va) && !/Expected result/.test(va) && !V.d.querySelector('#draftForm') && !/₹/.test(va), 'viewer: briefing without money or drafts');

// ---- with a key
global.__SECRETS = { ANTHROPIC_API_KEY: 'sk-ant-test-0123456789abcdefghij' };
let reply = 'You are on track.';
global.__FETCH = async () => ({ status: 200, ok: true, json: async () => ({ content: [{ type: 'text', text: reply }] }) });
await tab(w, d, 'overview'); await sleep(100);
await tab(w, d, 'ai'); await sleep(400);
app = txt(d.querySelector('#app'));
ok(/AI connected/.test(app) && !d.querySelector('#aiQ').disabled && !!d.querySelector('[data-act="aiWrite"]'), 'with a key: connected, Ask and write-up enabled');
set(w, d.querySelector('#aiQ'), 'Are we on track?'); submit(w, d.querySelector('#askForm')); await sleep(500);
ok(/You are on track\./.test(txt(d.querySelector('#app'))) && /Are we on track\?/.test(txt(d.querySelector('#app'))), 'Ask shows the question and the answer');
click(w, d.querySelector('[data-act="aiChip"]')); await sleep(500);
ok(/What should I do first today\?/.test(txt(d.querySelector('#app'))), 'suggested question chip asks it');
reply = 'VHM is 5 days away.\n- Print the bibs.';
click(w, d.querySelector('[data-act="aiWrite"]')); await sleep(500);
ok(/Print the bibs\./.test(txt(d.querySelector('#app'))), 'AI briefing text shown');
reply = 'Subject: Pickup details\n\nHello runners, pickup is Friday.';
df = d.querySelector('#draftForm');
set(w, df.elements.kind, 'runner_update'); submit(w, df); await sleep(500);
ok(/Written by AI/.test(txt(d.querySelector('#app'))) && d.querySelector('#dSubject').value === 'Pickup details' && /pickup is Friday/.test(d.querySelector('#dBody').value), 'AI draft split into subject and body');
global.__FETCH = async () => ({ status: 429, ok: false, json: async () => ({}) });
set(w, d.querySelector('#aiQ'), 'another question'); submit(w, d.querySelector('#askForm')); await sleep(400);
ok(/AI service is busy/.test(txt(d.body)), 'AI errors show a plain message');
console.log(`Bibs and AI UI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
