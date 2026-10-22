// UI tests for the athlete page and the coach desk (jsdom), talking to the real Training backend with mock Wix modules.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as T from './training.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const athHtml = fs.readFileSync('../wix/training/athlete-embed.html', 'utf8');
const coachHtml = fs.readFileSync('../wix/training/coach-embed.html', 'utf8');
const ATH_ALLOWED = ['openPlans', 'athleteSignup', 'athleteLogin', 'athleteLogout', 'changePin', 'enrollPlan', 'endPlan', 'myHome', 'mySessions', 'logSession', 'addMySession', 'requestCoaching', 'cancelCoachingRequest', 'myMessages', 'sendMyMessage'];
const pageCode = (f) => fs.readFileSync('../wix/training/' + f, 'utf8');
for (const [f, id] of [['athlete-page-code.js', 'trainFrame'], ['coach-page-code.js', 'coachFrame']]) {
  const src = pageCode(f);
  ok(src.includes("$w('#" + id + "')") && src.includes("backend/training.web"), f + ': element id and backend import');
  const m = src.match(/const ALLOWED = \[([^\]]*)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  ok(m.every((x) => typeof T[x] === 'function'), f + ': every allowed method exists in the backend');
  if (f.startsWith('athlete')) ok(JSON.stringify(m) === JSON.stringify(ATH_ALLOWED) && !m.some((x) => /^(coach|assign|savePlan|removePlan|listAthletes|athleteDetail|tLogin|saveTrain)/.test(x)), 'athlete page exposes no staff methods');
}
function open(html) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('JSERR', e.message); fail++; });
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m) return;
    if (m.kind === 'hello') { w.postMessage({ kind: 'init' }, '*'); return; }
    if (m.kind !== 'call') return;
    try {
      const r = await T[m.method](m.arg);
      w.postMessage({ kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) }, '*');
    } catch (x) { w.postMessage({ kind: 'result', id: m.id, ok: false, error: x.message }, '*'); }
  });
  return { w, d };
}
const set = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const submit = (w, f, submitter) => { const ev = new w.Event('submit', { cancelable: true, bubbles: true }); if (submitter) ev.submitter = submitter; f.dispatchEvent(ev); };
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');

await T.ensureTrainSetup({ key: 'k-test' });
for (const [u, r] of [['boss', 'admin'], ['coachA', 'coach'], ['coachB', 'coach']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);

// ---- athlete: sign up, pick a plan, log a workout
const A = open(athHtml);
await sleep(300);
{
  const { w, d } = A;
  ok(d.querySelector('#authForm') && /Free 8-week plans/.test(txt(d.querySelector('#app'))), 'athlete: login screen with the free plan promise');
  click(w, d.querySelector('[data-act="mode"]')); await sleep(50);
  const f = d.querySelector('#authForm');
  ok(f.elements.website && d.querySelector('.hp'), 'athlete: hidden honeypot field present');
  set(w, f.elements.name, 'Uma <b>Rao</b>'); set(w, f.elements.phone, '9848011111'); set(w, f.elements.pin, '12'); submit(w, f); await sleep(300);
  ok(/6 digits/.test(txt(d.querySelector('#app'))), 'athlete: short PIN message');
  set(w, d.querySelector('#authForm').elements.pin, '123456'); submit(w, d.querySelector('#authForm')); await sleep(500);
  ok(/Pick your plan/.test(txt(d.querySelector('#app'))) && d.querySelectorAll('.planForm').length === 3, 'athlete: signed up, three plans to pick');
  ok(!/<b>Rao/.test(d.querySelector('#app').innerHTML) && /Uma/.test(txt(d.querySelector('#app'))), 'athlete: name is escaped');
  const pf = d.querySelectorAll('.planForm')[0];
  const mon = new Date(); mon.setDate(mon.getDate() - 3);
  set(w, pf.elements.startDate, mon.getFullYear() + '-' + String(mon.getMonth() + 1).padStart(2, '0') + '-' + String(mon.getDate()).padStart(2, '0'));
  submit(w, pf); await sleep(600);
  ok(/Today/.test(txt(d.querySelector('.nav'))) && /5K Starter/.test(txt(d.querySelector('#app'))), 'athlete: plan started, home screen');
  click(w, d.querySelector('[data-act="tab"][data-tab="plan"]')); await sleep(400);
  ok(/Week 1/.test(txt(d.querySelector('#app'))) && /Week 8/.test(txt(d.querySelector('#app'))), 'athlete: plan shows 8 weeks');
  const open1 = [...d.querySelectorAll('[data-act="logOpen"]')][0]; click(w, open1); await sleep(80);
  const lf = d.querySelector('.logForm');
  ok(lf, 'athlete: log form opens');
  set(w, lf.elements.aKm, '4.5'); set(w, lf.elements.aMin, '32'); set(w, lf.elements.rpe, '6'); set(w, lf.elements.note, 'felt <i>good</i>');
  submit(w, lf, lf.querySelector('[data-status="done"]')); await sleep(600);
  ok(/Done: 4.5 km/.test(txt(d.querySelector('#app'))) && !/<i>good/.test(d.querySelector('#app').innerHTML), 'athlete: logged, shown, note escaped');
  click(w, d.querySelector('[data-act="tab"][data-tab="coach"]')); await sleep(300);
  ok(/Want a coach/.test(txt(d.querySelector('#app'))) && /Free for now/.test(txt(d.querySelector('#app'))) && !d.querySelector('#sendMsg'), 'athlete: free plan shows the coaching offer, no message box');
  const rq = d.querySelector('#reqForm'); set(w, rq.elements.note, 'First 5K'); submit(w, rq); await sleep(400);
  ok(/Requested/.test(txt(d.querySelector('#app'))), 'athlete: coaching requested');
}

// ---- director assigns, coach works
const D = open(coachHtml);
await sleep(100);
{
  const { w, d } = D;
  ok(d.querySelector('#loginForm') && !d.querySelector('.tabs'), 'coach: login first');
  const f = d.querySelector('#loginForm'); set(w, f.elements.username, 'boss'); set(w, f.elements.password, 'bad'); submit(w, f); await sleep(300);
  ok(/Wrong username/.test(txt(d.querySelector('#app'))), 'coach: wrong password message');
  set(w, d.querySelector('#loginForm').elements.username, 'boss'); set(w, d.querySelector('#loginForm').elements.password, 'pw'); submit(w, d.querySelector('#loginForm')); await sleep(600);
  ok(d.querySelector('.tabs') && /Settings/.test(txt(d.querySelector('.tabs'))) && /want a coach/.test(txt(d.querySelector('#app'))), 'director: athletes tab with the request, Settings tab present');
  const unc = [...d.querySelectorAll('tr')].filter((r) => /Free plan|Wants a coach/.test(txt(r)));
  ok(unc.length > 0 && unc.every((r) => r.querySelector('[data-assign]')), 'director: every runner without a coach has an Assign coach box, requested or not');
  const sel = d.querySelector('[data-assign]'); sel.value = 'coachA'; change(w, sel); await sleep(600);
  ok(/Coached · COACHA/.test(txt(d.querySelector('#app'))), 'director: coach assigned');
  ok([...d.querySelectorAll('tr')].filter((r) => /Coached/.test(txt(r))).every((r) => !r.querySelector('[data-assign]')), 'director: no Assign box on a runner who already has a coach');
  click(w, d.querySelector('[data-act="tab"][data-tab="settings"]')); await sleep(300);
  const sf = d.querySelector('#setForm'); set(w, sf.elements.coachedPrice, '1500 per month'); submit(w, sf); await sleep(300);
  ok(/1500 per month/.test(txt(d.querySelector('#app'))), 'director: price setting saved');
  click(w, d.querySelector('[data-act="tab"][data-tab="plans"]')); await sleep(300);
  click(w, d.querySelector('[data-act="newPlan"]')); await sleep(50);
  const pf = d.querySelector('#planForm'); set(w, pf.elements.name, 'My 1-week plan'); set(w, pf.elements.weeks, '1'); set(w, pf.elements.workouts, '1, 1, easy, Easy jog, 3, 20, relaxed\n1, 7, long, Long, 6, 40'); submit(w, pf); await sleep(400);
  ok(/My 1-week plan/.test(txt(d.querySelector('#app'))), 'director: plan created from the text lines');
  click(w, d.querySelector('[data-act="openPlan"][data-id]')); await sleep(300);
  set(w, d.querySelector('#planForm').elements.workouts, '9, 9, easy, bad'); submit(w, d.querySelector('#planForm')); await sleep(300);
  ok(/Check the workout lines/.test(txt(d.querySelector('#toast'))), 'director: bad workout lines give a clear message');
  click(w, d.querySelector('[data-act="logout"]'));
}
const C = open(coachHtml);
await sleep(100);
{
  const { w, d } = C;
  set(w, d.querySelector('#loginForm').elements.username, 'coachA'); set(w, d.querySelector('#loginForm').elements.password, 'pw'); submit(w, d.querySelector('#loginForm')); await sleep(600);
  ok(!/Settings/.test(txt(d.querySelector('.tabs'))) && /Uma/.test(txt(d.querySelector('#app'))), 'coach: sees own athlete, no Settings tab');
  ok(/Uma/.test(txt(d.querySelector('#app'))) && !/<b>Rao/.test(d.querySelector('#app').innerHTML), 'coach: athlete name escaped');
  click(w, d.querySelector('[data-act="open"]')); await sleep(500);
  ok(d.querySelector('#sesForm') && d.querySelector('#coachMsg') && d.querySelector('.fbForm'), 'coach: detail with add-workout, messages and feedback');
  const fb = d.querySelector('.fbForm'); set(w, fb.elements.text, 'Nice <u>work</u>'); submit(w, fb); await sleep(500);
  ok(/Nice <u>work<\/u>/.test(txt(d.querySelector('.fb'))) && !d.querySelector('.fb u'), 'coach: feedback saved and shown as text, not markup');
  const sf = d.querySelector('#sesForm'); const dt = new Date(); dt.setDate(dt.getDate() + 5);
  set(w, sf.elements.date, dt.toISOString().slice(0, 10)); set(w, sf.elements.title, 'Hill repeats'); set(w, sf.elements.km, '6'); submit(w, sf); await sleep(500);
  ok(/Hill repeats/.test(txt(d.querySelector('#app'))), 'coach: workout added');
  const cm = d.querySelector('#coachMsg'); set(w, cm.elements.text, 'Great start. Hills on Sunday.'); submit(w, cm); await sleep(500);
  ok(/Great start/.test(txt(d.querySelector('#app'))), 'coach: message sent');
}
// ---- athlete sees coach feedback and messages, and can reply
{
  const { w, d } = A;
  click(w, d.querySelector('[data-act="tab"][data-tab="coach"]')); await sleep(200);
  // refresh the home so the athlete sees the active coach
  const A2 = open(athHtml); await sleep(100);
  set(A2.w, A2.d.querySelector('#authForm').elements.phone, '9848011111'); set(A2.w, A2.d.querySelector('#authForm').elements.pin, '123456'); submit(A2.w, A2.d.querySelector('#authForm')); await sleep(600);
  ok(/Coach \(1\)/.test(txt(A2.d.querySelector('.nav'))) && /coached/.test(txt(A2.d.querySelector('#app'))), 'athlete: sees one unread message and the coached label');
  click(A2.w, A2.d.querySelector('[data-act="tab"][data-tab="coach"]')); await sleep(500);
  ok(/Great start/.test(txt(A2.d.querySelector('#thread'))) && A2.d.querySelector('#sendMsg'), 'athlete: reads the coach message, message box open');
  const sm = A2.d.querySelector('#sendMsg'); set(A2.w, sm.elements.text, 'Thanks coach!'); submit(A2.w, sm); await sleep(500);
  ok(/Thanks coach/.test(txt(A2.d.querySelector('#thread'))), 'athlete: reply sent');
  click(A2.w, A2.d.querySelector('[data-act="tab"][data-tab="plan"]')); await sleep(400);
  ok(/Nice/.test(txt(A2.d.querySelector('#app'))) && /Hill repeats/.test(txt(A2.d.querySelector('#app'))), 'athlete: sees feedback and the coach\'s new workout');
  click(A2.w, A2.d.querySelector('[data-act="logout"]')); await sleep(100);
  ok(A2.d.querySelector('#authForm'), 'athlete: log out returns to login');
}
// ---- another coach sees nothing
{
  const O = open(coachHtml); await sleep(100);
  set(O.w, O.d.querySelector('#loginForm').elements.username, 'coachB'); set(O.w, O.d.querySelector('#loginForm').elements.password, 'pw'); submit(O.w, O.d.querySelector('#loginForm')); await sleep(600);
  ok(!/Uma/.test(txt(O.d.querySelector('#app'))) && /No athletes here yet/.test(txt(O.d.querySelector('#app'))), 'coach B: sees none of coach A\'s athletes');
}
console.log(`Training UI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
