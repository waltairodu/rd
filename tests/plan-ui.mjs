// UI tests for the planning tabs (Plan, Money, Approvals, Ceremonies, Logistics), in jsdom, talking to the real backend code with mock Wix modules.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as D from './racedir.test.mjs';
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


const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + o * 86400000).toISOString().slice(0, 10);
const bossTok = (await D.login({ username: 'boss', password: 'pw' })).token;
const ev = (await D.saveEvent({ token: bossTok, name: 'VHM', date: istDay(30), venue: 'RK Beach' })).event;
const rows = (d) => [...d.querySelectorAll('tr')].filter((r) => r.querySelector('td'));
const rowOf = (d, t) => rows(d).find((r) => txt(r).includes(t));
const A = await login('boss');
{
  const { w, d } = A;
  const tabs = [...d.querySelectorAll('.tab')].map((t) => t.getAttribute('data-tab'));
  ok(['plan', 'money', 'approvals', 'ceremonies', 'logistics'].every((t) => tabs.includes(t)), 'director sees all five planning tabs: ' + tabs.join());
  // overview
  ok(/Plan tasks done/.test(txt(d.querySelector('#app'))) && /Permits approved/.test(txt(d.querySelector('#app'))) && /Spent of budget/.test(txt(d.querySelector('#app'))), 'overview shows plan, permit and budget cards');
  ok([...d.querySelectorAll('.alert')].some((a) => /permits? not approved/.test(txt(a))), 'overview alert about permits');
  const goBtn = [...d.querySelectorAll('.alert button')].find((b) => b.getAttribute('data-tab') === 'approvals');
  click(w, goBtn); await sleep(250);
  ok(d.querySelector('.tab[aria-selected="true"]').getAttribute('data-tab') === 'approvals', 'alert button opens the Approvals tab');

  // plan tab
  await tab(w, d, 'plan');
  ok(rows(d).length >= 32 && /Tasks done/.test(txt(d.querySelector('#app'))) && /Debrief and lessons/.test(txt(d.querySelector('#app'))), 'plan tab lists the starter tasks and the lessons section');
  ok(/90 days or more before/.test(txt(d.querySelector('#app'))) && /After the race/.test(txt(d.querySelector('#app'))), 'tasks grouped by when');
  const r0 = rowOf(d, 'Fix the race date');
  const sel = r0.querySelector('select[data-act="pstatus"]');
  sel.value = 'done'; change(w, sel); await sleep(300);
  ok(rowOf(d, 'Fix the race date').querySelector('select').value === 'done' && /1 <small>\/ 32/.test(d.querySelector('.kpi .n').innerHTML), 'changing a status saves and updates the counter');
  // add a task
  click(w, d.querySelector('[data-act="pnew"][data-kind="task"]')); await sleep(80);
  const f = d.querySelector('#planForm');
  ok(f && f.getAttribute('data-kind') === 'task' && /Add task/.test(txt(f)), 'add form opens in the task section');
  set(w, f.elements.title, '<img src=x onerror=alert(1)> Book the sound system'); set(w, f.elements.owner, 'Asha'); set(w, f.elements.due, istDay(-3)); set(w, f.elements.cat, 'Operations');
  submit(w, f); await sleep(350);
  const nr = rowOf(d, 'Book the sound system');
  ok(nr && !d.querySelector('#app img') && /overdue/.test(txt(nr)) && /Asha/.test(txt(nr)), 'new task shown as text, marked overdue, owner shown');
  ok(!d.querySelector('#planForm'), 'form closes after saving');
  // edit it
  click(w, nr.querySelector('[data-act="pedit"]')); await sleep(80);
  const f2 = d.querySelector('#planForm');
  ok(f2 && /Edit task/.test(txt(f2)) && f2.elements.owner.value === 'Asha' && f2.elements.title.value.includes('Book the sound'), 'edit form is filled in');
  set(w, f2.elements.owner, 'Ravi'); set(w, f2.elements.due, istDay(5)); submit(w, f2); await sleep(350);
  ok(/Ravi/.test(txt(rowOf(d, 'Book the sound system'))) && !/overdue/.test(txt(rowOf(d, 'Book the sound system'))), 'edit saved, no longer overdue');
  // cancel
  click(w, d.querySelector('[data-act="pnew"][data-kind="lesson"]')); await sleep(60);
  ok(d.querySelector('#planForm') && d.querySelector('#planForm').getAttribute('data-kind') === 'lesson', 'lesson form opens in its own section');
  click(w, d.querySelector('[data-act="pcancel"]')); await sleep(60);
  ok(!d.querySelector('#planForm'), 'cancel closes the form');
  // bad input shows the message
  click(w, d.querySelector('[data-act="pnew"][data-kind="task"]')); await sleep(60);
  const f3 = d.querySelector('#planForm'); set(w, f3.elements.title, 'x');
  submit(w, f3); await sleep(300);
  ok(/give it a name/i.test(txt(d.querySelector('#toast'))) && d.querySelector('#planForm'), 'a refused save shows a clear message and keeps the form open: ' + txt(d.querySelector('#toast')));
  click(w, d.querySelector('[data-act="pcancel"]')); await sleep(60);
  // delete: two clicks
  const dr = rowOf(d, 'Book the sound system');
  click(w, dr.querySelector('[data-act="pdel"]')); await sleep(80);
  ok(rowOf(d, 'Book the sound system') && /Sure\?/.test(txt(rowOf(d, 'Book the sound system'))), 'first click asks "Sure?"');
  click(w, rowOf(d, 'Book the sound system').querySelector('[data-act="pdel"]')); await sleep(300);
  ok(!rowOf(d, 'Book the sound system'), 'second click removes it');
  click(w, d.querySelector('[data-act="pcsv"][data-kind="task"]')); await sleep(60);
  ok(true, 'csv button does not crash');

  // money tab
  await tab(w, d, 'money');
  let t = txt(d.querySelector('#app'));
  ok(/Planned costs/.test(t) && /Sponsor cash promised/.test(t) && /Costs by category|Budget/.test(t), 'money tab: summary cards');
  ok(/Nothing here yet/.test(txt([...d.querySelectorAll('.card')].find((c) => /^Sponsors/.test(txt(c.querySelector('h3'))) ))) , 'sponsors empty at first');
  ok(!d.querySelector('[data-act="pseed"][data-kind="sponsor"]'), 'no starter list for sponsors');
  click(w, d.querySelector('[data-act="pnew"][data-kind="budget"]')); await sleep(60);
  const bf = d.querySelector('#planForm');
  set(w, bf.elements.title, 'Chip timing'); set(w, bf.elements.cat, 'Timing and results'); set(w, bf.elements.amount, '85000'); set(w, bf.elements.amount2, '90000'); set(w, bf.elements.party, 'TimingCo');
  submit(w, bf); await sleep(350);
  t = txt(d.querySelector('#app'));
  ok(/Chip timing/.test(t) && /85,000/.test(t) && /90,000/.test(t) && /over by/.test(t), 'budget line saved, shown in rupees, category flagged over');
  ok(/Planned costs\s*₹85,000/.test(t) && /spent so far ₹90,000/.test(t), 'summary card follows the budget');
  const pr = rowOf(d, 'Chip timing');
  const ps = pr.querySelector('select'); ps.value = 'paid'; change(w, ps); await sleep(300);
  ok(rowOf(d, 'Chip timing').querySelector('select').value === 'paid', 'budget line marked paid');
  click(w, d.querySelector('[data-act="pnew"][data-kind="sponsor"]')); await sleep(60);
  const sf = d.querySelector('#planForm');
  set(w, sf.elements.title, 'Acme Shoes'); set(w, sf.elements.cat, 'Gold'); set(w, sf.elements.amount, '200000'); set(w, sf.elements.party, 'Ravi'); sf.elements.status.value = 'committed';
  submit(w, sf); await sleep(350);
  t = txt(d.querySelector('#app'));
  ok(/Acme Shoes/.test(t) && /Committed/.test(t) && /Sponsor cash promised\s*₹2,00,000/.test(t), 'sponsor saved under its stage, promised cash in Indian digit grouping');
  // empty budget -> starter list button
  const all = (await wd.query('RDPlan').eq('event', ev.id).eq('kind', 'budget').limit(1000).find(SA)).items.map((x) => x._id);
  await wd.bulkRemove('RDPlan', all, SA);
  await tab(w, d, 'plan'); await tab(w, d, 'money');
  const seedBtn = d.querySelector('[data-act="pseed"][data-kind="budget"]');
  ok(!!seedBtn, 'empty budget offers the starter list');
  click(w, seedBtn); await sleep(400);
  ok(rowOf(d, 'Medals') && /Registration revenue/.test(txt(d.querySelector('#app'))), 'starter budget loaded');

  // approvals: sign-off records the name
  await tab(w, d, 'approvals');
  const ar = rowOf(d, 'Weather go or no-go');
  const as = ar.querySelector('select'); as.value = 'approved'; change(w, as); await sleep(300);
  ok(/BOSS/i.test(txt(rowOf(d, 'Weather go or no-go'))) && /Race-day sign-offs\s*1/.test(txt(d.querySelector('#app'))), 'sign-off shows who approved and updates the counter');
  ok(/Permits and permissions/.test(txt(d.querySelector('#app'))) && /Race-day sign-offs/.test(txt(d.querySelector('#app'))), 'approvals grouped into permits and sign-offs');

  // ceremonies
  await tab(w, d, 'ceremonies');
  t = txt(d.querySelector('#app'));
  ok(/Before the race/.test(t) && /During the race/.test(t) && /After the race/.test(t) && rowOf(d, 'Flag-off for each category'), 'ceremonies in three phases');
  click(w, d.querySelector('[data-act="pnew"][data-kind="ceremony"]')); await sleep(60);
  const cf = d.querySelector('#planForm'); set(w, cf.elements.title, 'Lamp lighting by chief guest'); cf.elements.phase.value = 'pre'; set(w, cf.elements.time, '05:20'); set(w, cf.elements.party, 'Chief guest');
  submit(w, cf); await sleep(350);
  ok(/05:20/.test(txt(rowOf(d, 'Lamp lighting'))) && /Chief guest/.test(txt(rowOf(d, 'Lamp lighting'))), 'ceremony item with time and host saved');

  // logistics
  await tab(w, d, 'logistics');
  t = txt(d.querySelector('#app'));
  ok(/Supplies at the site/.test(t) && /Contacts and vendors/.test(t) && /Documents and links/.test(t), 'logistics: supplies, contacts, documents');
  click(w, d.querySelector('[data-act="pnew"][data-kind="supply"]')); await sleep(60);
  const uf = d.querySelector('#planForm'); set(w, uf.elements.title, 'Salt tablets'); set(w, uf.elements.cat, 'Nutrition'); set(w, uf.elements.amount, '500'); set(w, uf.elements.amount2, '120'); set(w, uf.elements.ref, 'tabs');
  submit(w, uf); await sleep(350);
  const sr = rowOf(d, 'Salt tablets');
  ok(sr && sr.querySelector('.short') && /500 tabs/.test(txt(sr)) && /Short of quantity\s*1/.test(txt(d.querySelector('#app'))), 'short supply highlighted and counted');
  click(w, d.querySelector('[data-act="pnew"][data-kind="doc"]')); await sleep(60);
  const df = d.querySelector('#planForm'); set(w, df.elements.title, 'Police permission letter'); set(w, df.elements.link, 'https://drive.example.com/abc');
  submit(w, df); await sleep(350);
  const lk = rowOf(d, 'Police permission letter').querySelector('a');
  ok(lk && lk.getAttribute('href') === 'https://drive.example.com/abc' && lk.getAttribute('rel') === 'noopener' && lk.getAttribute('target') === '_blank', 'document link opens safely');
  click(w, d.querySelector('[data-act="pnew"][data-kind="doc"]')); await sleep(60);
  const df2 = d.querySelector('#planForm'); set(w, df2.elements.title, 'Bad link doc'); set(w, df2.elements.link, 'javascript:alert(1)');
  submit(w, df2); await sleep(300);
  ok(!rowOf(d, 'Bad link doc'), 'a script link is not saved');
}

// ---- lead: reads money, cannot change it
{
  const { w, d } = await login('lead1');
  ok(d.querySelector('[data-tab="money"]'), 'lead sees the Money tab');
  await tab(w, d, 'money');
  ok(rows(d).length > 0 && !d.querySelector('[data-act="pnew"][data-kind="budget"]') && !d.querySelector('[data-act="pnew"][data-kind="sponsor"]'), 'lead: money lists shown, no Add');
  ok([...d.querySelectorAll('select[data-act="pstatus"]')].every((s) => s.disabled) && !d.querySelector('[data-act="pedit"]') && !d.querySelector('[data-act="pdel"]'), 'lead: money rows are read only');
  await tab(w, d, 'plan');
  ok(d.querySelector('[data-act="pnew"][data-kind="task"]') && d.querySelector('[data-act="pedit"]') && !d.querySelector('[data-act="pdel"]'), 'lead: can add and edit tasks, cannot delete');
  const sel = rowOf(d, 'Confirm ambulances').querySelector('select'); sel.value = 'doing'; change(w, sel); await sleep(300);
  ok(rowOf(d, 'Confirm ambulances').querySelector('select').value === 'doing', 'lead changes a task status');
  await tab(w, d, 'logistics');
  ok(/Contacts and vendors/.test(txt(d.querySelector('#app'))), 'lead sees contacts');
}

// ---- viewer: no money, no contacts, no editing
{
  const { w, d } = await login('view1');
  ok(!d.querySelector('[data-tab="money"]'), 'viewer: no Money tab');
  ok(!/Spent of budget/.test(txt(d.querySelector('#app'))) && /Plan tasks done/.test(txt(d.querySelector('#app'))), 'viewer overview: no money card, plan card present');
  await tab(w, d, 'plan');
  ok(!d.querySelector('[data-act="pnew"]') && !d.querySelector('[data-act="pedit"]') && [...d.querySelectorAll('select[data-act="pstatus"]')].every((s) => s.disabled), 'viewer: plan is read only');
  await tab(w, d, 'logistics');
  const t = txt(d.querySelector('#app'));
  ok(/Supplies/.test(t) && !/Contacts and vendors/.test(t) && !/Traffic police contact/.test(t), 'viewer: supplies yes, contacts hidden');
  await tab(w, d, 'approvals');
  ok(rows(d).length >= 20 && !d.querySelector('[data-act="pnew"]'), 'viewer: approvals visible, read only');
}

// ---- every page reports its content height to the Wix page
for (const f of ['../wix/director/director-embed.html', '../wix/director/volunteer-embed.html', '../wix/training/athlete-embed.html', '../wix/training/coach-embed.html', '../wix/expo/exposoft-embed.html']) {
  const dom = open(fs.readFileSync(f, 'utf8'));
  const got = [];
  dom.w.addEventListener('message', (e) => { if (e.data && e.data.kind === 'resize') got.push(e.data.height); });
  await sleep(400);
  ok(got.length >= 1 && got.every((h) => typeof h === 'number' && h > 0), f.split('/').pop() + ': posts its height to the page');
}

console.log(`Plan UI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
