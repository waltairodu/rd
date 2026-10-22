// UI tests for the Coaching tab in the Director page (assigning coaches through the Training backend), in jsdom, talking to the real backend code with mock Wix modules.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as D from './racedir.test.mjs';
import * as T from './training.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirHtml = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
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
      const r = await (m.mod === 'train' ? T : D)[m.method](m.arg);
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



await T.ensureTrainSetup({ key: 'k-test' });
await wd.insert('ExpoStaff', { username: 'coachA', password: 'pw', role: 'coach', desks: '', name: 'COACH A', failCount: '0', lockUntil: '' }, SA);
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + o * 86400000).toISOString().slice(0, 10);
const plan = (await T.openPlans()).plans[0];
const mkAth = async (n, name) => { const r = await T.athleteSignup({ name, phone: '98480100' + n, pin: '123456', level: 'Beginner' }); const tk = (await T.athleteLogin({ phone: '98480100' + n, pin: '123456' })).token; await T.enrollPlan({ token: tk, planId: plan.id, startDate: istDay(-2) }); return tk; };
const t1 = await mkAth('11', 'Uma Rao'), t2 = await mkAth('12', 'Ravi Kumar'), t3 = await mkAth('13', 'Sita Devi');
await T.requestCoaching({ token: t1, note: 'First 10K' });
await D.saveEvent({ token: (await D.login({ username: 'boss', password: 'pw' })).token, name: 'VHM', date: istDay(30) });
const rows = (d) => [...d.querySelectorAll('tr')].filter((r) => r.querySelector('td'));
const rowOf = (d, t) => rows(d).find((r) => txt(r).includes(t));

const A = await login('boss');
{
  const { w, d } = A;
  ok(d.querySelector('[data-tab="coaching"]'), 'director sees the Coaching tab');
  await tab(w, d, 'coaching');
  const t = txt(d.querySelector('#app'));
  ok(/Runners on a plan\s*3/.test(t) && /Want a coach\s*1/.test(t), 'summary: 3 runners, 1 wants a coach: ' + t.slice(0, 120));
  ok(rows(d)[0] && /Uma Rao/.test(txt(rows(d)[0])) && /Wants a coach/.test(txt(rows(d)[0])) && /First 10K/.test(txt(rows(d)[0])), 'the request is listed first with the runner note');
  ok(rows(d).every((r) => r.querySelector('select[data-act="cassign"]')), 'every runner without a coach has an Assign coach box, requested or not');
  ok([...rowOf(d, 'Ravi Kumar').querySelectorAll('option')].some((o) => o.value === 'coachA') && [...rowOf(d, 'Ravi Kumar').querySelectorAll('option')].some((o) => o.value === 'boss'), 'coach and director logins are offered');
  // assign a runner who did not request
  const sel = rowOf(d, 'Ravi Kumar').querySelector('select'); sel.value = 'coachA'; change(w, sel); await sleep(500);
  ok(/Coached by COACH A/.test(txt(rowOf(d, 'Ravi Kumar'))) && !rowOf(d, 'Ravi Kumar').querySelector('select'), 'runner who never asked is now coached; box gone');
  // assign the requester
  const sel2 = rowOf(d, 'Uma Rao').querySelector('select'); sel2.value = 'coachA'; change(w, sel2); await sleep(500);
  ok(/Coached by COACH A/.test(txt(rowOf(d, 'Uma Rao'))) && /Want a coach\s*0/.test(txt(d.querySelector('#app'))), 'requester assigned, request count drops');
  const hs = await T.myHome({ token: t1 });
  ok(JSON.stringify(hs).includes('coachA') || JSON.stringify(hs).toLowerCase().includes('coach a'), 'runner side now shows the coach');
  // stop coaching: two clicks
  click(w, rowOf(d, 'Ravi Kumar').querySelector('[data-act="cstop"]')); await sleep(80);
  ok(/Sure\?/.test(txt(rowOf(d, 'Ravi Kumar'))), 'stop asks "Sure?" first');
  click(w, rowOf(d, 'Ravi Kumar').querySelector('[data-act="cstop"]')); await sleep(500);
  ok(/Free plan/.test(txt(rowOf(d, 'Ravi Kumar'))) && rowOf(d, 'Ravi Kumar').querySelector('select'), 'back on the free plan, assign box returns');
  // decline a new request
  await T.requestCoaching({ token: t3, note: 'Help' });
  await tab(w, d, 'overview'); await tab(w, d, 'coaching');
  click(w, rowOf(d, 'Sita Devi').querySelector('[data-act="cdecline"]')); await sleep(80);
  click(w, rowOf(d, 'Sita Devi').querySelector('[data-act="cdecline"]')); await sleep(500);
  ok(/Free plan/.test(txt(rowOf(d, 'Sita Devi'))), 'declined request goes back to the free plan');
}
{
  const { w, d } = await login('lead1');
  ok(!d.querySelector('[data-tab="coaching"]'), 'lead has no Coaching tab');
}
{
  const { w, d } = await login('view1');
  ok(!d.querySelector('[data-tab="coaching"]'), 'viewer has no Coaching tab');
}
// the page code relays only the five Training methods
const pc = fs.readFileSync('../wix/director/director-page-code.js', 'utf8');
const allowed = pc.match(/const TRAIN_ALLOWED = \[([^\]]*)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
ok(allowed.length === 5 && allowed.every((x) => typeof T[x] === 'function') && !allowed.some((x) => /^(savePlan|removePlan|coach|saveTrain|tLogin)/.test(x)), 'page code relays only the five Coaching methods, all of which exist');
ok(pc.includes("import * as train from 'backend/training.web'"), 'page code imports the training backend');

console.log(`Coaching UI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
