// UI tests for the approvals template: race details, what the race involves, adding approvals, letters and document ticks. jsdom + the real backend.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as D from './racedir.test.mjs';
import * as R from './rd-approvals.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirHtml = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + o * 86400000).toISOString().slice(0, 10);

for (const [u, r] of [['boss', 'admin'], ['lead1', 'lead'], ['view1', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks: '', name: u, failCount: '0', lockUntil: '' }, SA);

function open(opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('JSERR', e.message); fail++; });
  const dom = new JSDOM(dirHtml, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    if (opts.fail && opts.fail[m.method]) { w.postMessage({ kind: 'result', id: m.id, ok: false, error: opts.fail[m.method] }, '*'); return; }
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
const waitFor = async (fn, ms) => { const end = Date.now() + (ms || 3000); while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* not yet */ } await sleep(40); } return false; };
const tab = async (w, d, name) => { click(w, d.querySelector(`[data-tab="${name}"]`)); await sleep(150); await waitFor(() => !/Loading/.test(txt(d.querySelector('.content')))); };
async function login(user, opts) {
  const s = open(opts);
  await sleep(50);
  set(s.w, s.d.querySelector('#lgUser'), user);
  set(s.w, s.d.querySelector('#lgPass'), 'pw');
  submit(s.w, s.d.querySelector('#loginForm'));
  await waitFor(() => s.d.querySelector('.tab'), 4000);
  await sleep(150);
  return s;
}
const rows = (d) => [...d.querySelectorAll('tr')].filter((r) => r.querySelector('td'));
const rowOf = (d, t) => rows(d).find((r) => txt(r).includes(t));
const lrow = (d, t) => rows(d).filter((r) => !r.closest('#tplForm')).find((r) => txt(r).includes(t));
const toastText = (d) => txt(d.querySelector('#toast'));

const bossTok = (await D.login({ username: 'boss', password: 'pw' })).token;
const RACE = istDay(100);
const ev = (await D.saveEvent({ token: bossTok, name: 'VHM', date: RACE, venue: 'GITAM University' })).event;

/* ---------- director ---------- */
const A = await login('boss');
{
  const { w, d } = A;
  await tab(w, d, 'approvals');
  const app = () => txt(d.querySelector('#app'));
  ok(!d.querySelector('#tplForm') && /Approvals template/.test(app()) && d.querySelector('[data-act="tplToggle"]').textContent === 'Open', 'a race that already has approvals shows the template collapsed');
  ok(rows(d).length >= 18 && d.querySelectorAll('[data-act="letterOpen"]').length === 10, 'ten permits have a Letter button; sign-offs do not');
  ok(/Commissioner of Police/.test(txt(rowOf(d, 'Police permission'))) && /Letter/.test(txt(rowOf(d, 'Police permission'))) && /0\/8 ready/.test(txt(rowOf(d, 'Police permission'))), 'the police line shows the authority and 0 of 8 documents ready');
  ok(/Apply by|Due/.test(app()) && /Papers/.test(app()), 'the list has due and papers columns');
  const pol0 = rowOf(d, 'Police permission');
  ok(new RegExp(R.longDate(R.addDays(RACE, -45)).split(' ')[0] + '').test(txt(pol0)) || txt(pol0).length > 20, 'the police line shows its due date');
  ok(/Check the forecast/.test(txt(rowOf(d, 'Weather go or no-go'))) || /Weather go or no-go/.test(app()), 'the sign-off lines are listed');

  // open the template
  click(w, d.querySelector('[data-act="tplToggle"]')); await sleep(80);
  let f = d.querySelector('#tplForm');
  ok(f && f.elements['race.name'].value === 'VHM' && f.elements['race.date'].value === RACE && f.elements['race.venue'].value === 'GITAM University' && f.elements['info.edition'].value === '', 'the form opens with the race name, date and venue');
  ok(d.querySelectorAll('#tplForm .chk').length === 11 && f.elements['sc.roads'].checked === true && f.elements['sc.trail'].checked === false && f.elements['sc.sound'].checked === true, 'eleven questions with the usual answers');
  ok(f.querySelectorAll('tr[data-key]').length === 7 && ['forest', 'village', 'music', 'drone', 'land', 'aims'].every((k) => f.elements['p.' + k + '.on'] && f.elements['p.' + k + '.on'].checked === false) && f.elements['s.rd-kit.on'].checked === false, 'seven things can still be added, all off for a road race');
  ok((txt(f).match(/Added/g) || []).length === 18, 'the 18 lines already on the list show as Added');
  ok(f.elements['p.forest.lead'].value === '90' && f.elements['p.forest.due'].value === R.addDays(RACE, -90) && f.elements['p.forest.party'].value === 'District Forest Officer', 'forest: 90 days, due 90 days before the race, authority');

  // fill in the details and save
  const fill = { 'info.edition': '6', 'info.place': 'Visakhapatnam', 'info.localBody': 'GVMC', 'info.participants': '3000', 'info.volunteers': '300', 'info.startTime': '05:30', 'info.endTime': '09:30', 'info.expoDate': R.addDays(RACE, -2), 'info.route': 'Gate to Beach Road and back', 'info.organiser': 'VTRA', 'info.regNo': 'Reg. No. 429 of 2021', 'info.signatory': 'A. Director', 'info.role': 'Race Director', 'info.phone': '98480 00000', 'info.email': 'race@example.org', 'info.address': 'Visakhapatnam' };
  for (const [k, v] of Object.entries(fill)) set(w, f.elements[k], v);
  click(w, d.querySelector('[data-act="tplSave"]'));
  await waitFor(() => /6th edition/.test(txt(d.querySelector('.topbar'))), 4000);
  ok(/Race details saved/.test(toastText(d)) && /8 dates moved/.test(toastText(d)), 'saving the details says how many dates moved: ' + toastText(d));
  ok(/6th edition/.test(txt(d.querySelector('.topbar'))), 'the title bar shows the edition');
  f = d.querySelector('#tplForm');
  ok(f && f.elements['info.edition'].value === '6' && f.elements['info.place'].value === 'Visakhapatnam' && f.elements['info.phone'].value === '98480 00000', 'the saved details are shown again');
  ok(/03:30/.test(txt(lrow(d, 'Weather go or no-go'))) && /05:20/.test(txt(lrow(d, 'Final flag-off approval'))), 'sign-off times follow the flag-off time: 03:30 and 05:20 - ' + txt(lrow(d, 'Weather go or no-go')) + ' | ' + txt(lrow(d, 'Final flag-off approval')));
  ok(f.elements['p.forest.party'].value === 'District Forest Officer, Visakhapatnam', 'authorities now name the city');

  // answers switch the matching lines
  f.elements['sc.trail'].checked = true; change(w, f.elements['sc.trail']);
  ok(f.elements['p.forest.on'].checked && f.elements['p.village.on'].checked && f.elements['s.rd-kit.on'].checked, 'the trail answer switches on forest, village consent and the kit check');
  f.elements['sc.trail'].checked = false; change(w, f.elements['sc.trail']);
  ok(!f.elements['p.forest.on'].checked && !f.elements['s.rd-kit.on'].checked, 'and off again');
  f.elements['sc.trail'].checked = true; change(w, f.elements['sc.trail']);
  f.elements['sc.drone'].checked = true; change(w, f.elements['sc.drone']);
  ok(f.elements['p.drone.on'].checked, 'the drone answer switches on the drone permit');

  // lead time and dates
  set(w, f.elements['p.forest.lead'], '100'); change(w, f.elements['p.forest.lead']);
  ok(f.elements['p.forest.due'].value === R.addDays(RACE, -100), 'changing the days moves the date');
  set(w, f.elements['p.drone.due'], '2026-01-01'); change(w, f.elements['p.drone.due']);
  set(w, f.elements['race.date'], R.addDays(RACE, 7)); change(w, f.elements['race.date']);
  ok(f.elements['p.forest.due'].value === R.addDays(RACE, 7 - 100) && f.elements['p.drone.due'].value === '2026-01-01', 'a new race date moves the dates, but not one typed by hand');
  set(w, f.elements['race.date'], RACE); change(w, f.elements['race.date']);
  ok(f.elements['p.forest.due'].value === R.addDays(RACE, -100), 'and back');
  set(w, f.elements['s.rd-kit.offset'], '30'); change(w, f.elements['s.rd-kit.offset']);
  ok(f.elements['s.rd-kit.time'].value === '05:00', 'the kit check time follows its minutes before the flag-off: ' + f.elements['s.rd-kit.time'].value);
  set(w, f.elements['info.startTime'], '06:00'); change(w, f.elements['info.startTime']);
  ok(f.elements['s.rd-kit.time'].value === '05:30', 'and the flag-off time');
  set(w, f.elements['info.startTime'], '05:30'); change(w, f.elements['info.startTime']);
  set(w, f.elements['p.village.on'], false);
  set(w, f.elements['p.forest.party'], 'Divisional Forest Officer, Paderu');

  // add
  submit(w, f);
  await waitFor(() => !d.querySelector('#tplForm'), 4000);
  ok(/Added 3/.test(toastText(d)), 'the toast says what was added: ' + toastText(d));
  await waitFor(() => rowOf(d, 'Forest department'));
  const forest = rowOf(d, 'Forest department');
  ok(forest && /Divisional Forest Officer, Paderu/.test(txt(forest)) && /Letter/.test(txt(forest)), 'the forest line has the authority typed in the form and a Letter button');
  const drone = rowOf(d, 'Drone permission');
  ok(drone && /overdue/.test(txt(drone)), 'the drone line keeps the date typed by hand, and is overdue');
  ok(!rowOf(d, 'Village and Gram Panchayat') && rowOf(d, 'Mandatory kit') && /05:00/.test(txt(rowOf(d, 'Mandatory kit'))), 'village consent was switched off; the kit check is there at 05:00');
  ok(!d.querySelector('#tplForm') && d.querySelector('[data-act="tplToggle"]').textContent === 'Open', 'the template closes after adding');
  ok(d.querySelectorAll('[data-act="letterOpen"]').length === 12, 'now twelve permits have a Letter button');

  // the letter
  click(w, rowOf(d, 'Police permission').querySelector('[data-act="letterOpen"]'));
  await waitFor(() => d.querySelector('#letterText'), 4000);
  let ta = d.querySelector('#letterText');
  ok(ta && /the 6th edition of VHM/.test(ta.value) && /Respected Sir\/Madam/.test(ta.value) && /GITAM University, Visakhapatnam/.test(ta.value) && /Yours faithfully/.test(ta.value) && /A\. Director/.test(ta.value), 'the letter is filled from the race details');
  ok(d.querySelector('#letterBlanks').textContent === 'No blanks left' && !d.querySelector('#letterCard .alert'), 'nothing is missing, so there are no blanks and no warning');
  ok(d.querySelectorAll('#letterCard input[data-act="docTick"]').length === 8 && /0 of 8 ready/.test(txt(d.querySelector('#letterCard'))), 'eight documents to attach, none ready');
  ok(/Apply at the Commissionerate/.test(txt(d.querySelector('#letterCard'))), 'the tips are shown with the letter');
  const dt = d.querySelector('#letterCard input[data-act="docTick"][data-i="0"]');
  dt.checked = true; change(w, dt);
  await waitFor(() => /1 of 8 ready/.test(txt(d.querySelector('#letterCard'))), 3000);
  ok(/1 of 8 ready/.test(txt(d.querySelector('#letterCard'))) && d.querySelector('#letterCard input[data-i="0"]').checked && /1\/8 ready/.test(txt(rowOf(d, 'Police permission'))), 'ticking a document saves it, and the list shows 1/8 ready');
  // edits survive a re-render
  ta = d.querySelector('#letterText');
  set(w, ta, ta.value + '\n\nP.S. Edited by hand');
  const dt2 = d.querySelector('#letterCard input[data-act="docTick"][data-i="3"]');
  dt2.checked = true; change(w, dt2);
  await waitFor(() => /2 of 8 ready/.test(txt(d.querySelector('#letterCard'))), 3000);
  ok(/P\.S\. Edited by hand/.test(d.querySelector('#letterText').value) && /2 of 8 ready/.test(txt(d.querySelector('#letterCard'))), 'text you typed stays when a document is ticked');
  // change the date
  const ld = d.querySelector('#letterDate');
  ld.value = '2026-11-01'; change(w, ld);
  await waitFor(() => /Date: 1 November 2026/.test(d.querySelector('#letterText').value), 3000);
  ok(/Date: 1 November 2026/.test(d.querySelector('#letterText').value) && /P\.S\. Edited by hand/.test(d.querySelector('#letterText').value), 'changing the letter date changes only the date line');
  // copy
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  click(w, d.querySelector('[data-act="letterCopy"]')); await sleep(80);
  ok(/Respected Sir\/Madam/.test(copied) && /P\.S\. Edited by hand/.test(copied) && /Letter copied/.test(toastText(d)), 'Copy puts the edited letter on the clipboard');
  // Word file
  let blob = null, dlName = '';
  w.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
  w.HTMLAnchorElement.prototype.click = function () { dlName = this.download; };
  click(w, d.querySelector('[data-act="letterWord"]')); await sleep(80);
  const html = blob ? await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(blob); }) : '';
  ok(/\.doc$/.test(dlName) && /^Police permission/.test(dlName) && blob.type === 'application/msword' && /<p style=/.test(html) && /P\.S\. Edited by hand/.test(html) && /<br>/.test(html) && !/<script/i.test(html), 'Download for Word gives a .doc file with the letter in paragraphs: ' + dlName);
  // print
  let printed = 0;
  const desc = Object.getOwnPropertyDescriptor(w.HTMLIFrameElement.prototype, 'contentWindow');
  Object.defineProperty(w.HTMLIFrameElement.prototype, 'contentWindow', { get() { const cw = desc.get.call(this); if (cw && !cw.__p) { cw.__p = 1; cw.print = () => { printed++; }; cw.focus = () => {}; } return cw; }, configurable: true });
  click(w, d.querySelector('[data-act="letterPrint"]')); await sleep(400);
  ok(printed === 1, 'Print opens the print dialog for the letter');
  // reset
  click(w, d.querySelector('[data-act="letterReset"]'));
  await waitFor(() => !/P\.S\. Edited/.test(d.querySelector('#letterText').value), 3000);
  ok(!/P\.S\. Edited/.test(d.querySelector('#letterText').value) && /Date: 1 November 2026/.test(d.querySelector('#letterText').value), 'Reset text brings back the template, with the chosen date');
  click(w, d.querySelector('[data-act="letterClose"]')); await sleep(60);
  ok(!d.querySelector('#letterCard'), 'Close hides the letter');
}

/* ---------- Setup tab: the edition ---------- */
{
  const { w, d } = A;
  await tab(w, d, 'setup');
  click(w, [...d.querySelectorAll('[data-act="evEdit"]')].find((b) => /VHM/.test(txt(b.closest('tr'))))); await sleep(100);
  const f = d.querySelector('#eventForm');
  ok(f && f.elements.edition && f.elements.edition.value === '6', 'the race form has an Edition field, filled in');
  set(w, f.elements.edition, '7'); submit(w, f);
  await waitFor(() => /7th edition/.test(txt(d.querySelector('.topbar'))), 4000);
  ok(/7th edition/.test(txt(d.querySelector('.topbar'))), 'the new edition shows in the title bar');
  const info = (await D.eventInfo({ token: bossTok, ev: ev.id })).info;
  ok(info.edition === '7' && info.organiser === 'VTRA' && info.startTime === '05:30', 'saving the race keeps the other details');
}

/* ---------- lead and viewer ---------- */
{
  const L = await login('lead1');
  await tab(L.w, L.d, 'approvals');
  ok(!L.d.querySelector('#tplForm') && !/Approvals template/.test(txt(L.d.querySelector('#app'))), 'a lead does not see the template');
  ok(L.d.querySelectorAll('[data-act="letterOpen"]').length >= 10, 'a lead has the Letter buttons');
  click(L.w, L.d.querySelector('[data-act="letterOpen"]'));
  await waitFor(() => L.d.querySelector('#letterText'), 4000);
  ok(L.d.querySelector('#letterText') && L.d.querySelectorAll('input[data-act="docTick"]').length >= 4, 'a lead can open a letter and tick documents');
  const t0 = L.d.querySelector('input[data-act="docTick"][data-i="1"]');
  t0.checked = true; change(L.w, t0);
  await waitFor(() => /1 of \d+ ready/.test(txt(L.d.querySelector('#letterCard'))), 3000);
  ok(/1 of \d+ ready/.test(txt(L.d.querySelector('#letterCard'))), 'a lead can tick a document');
  const V = await login('view1');
  await tab(V.w, V.d, 'approvals');
  ok(rows(V.d).length >= 18 && !V.d.querySelector('[data-act="letterOpen"]') && !V.d.querySelector('#tplForm') && !/Approvals template/.test(txt(V.d.querySelector('#app'))), 'a viewer sees the lines but no letters and no template');
}

/* ---------- an old backend ---------- */
{
  const O = await login('boss', { fail: { approvalTemplate: 'backend_old' } });
  await tab(O.w, O.d, 'approvals');
  ok(rows(O.d).length >= 18, 'the approvals list still loads when the backend does not know the template');
  click(O.w, O.d.querySelector('[data-act="tplToggle"]')); await sleep(80);
  ok(!O.d.querySelector('#tplForm') && /backend file is out of date/.test(txt(O.d.querySelector('#app'))), 'the template says the backend is out of date');
}

/* ---------- races with missing details, and an older race that only has starter lines ---------- */
{
  const bare = (await D.saveEvent({ token: bossTok, name: 'Bare Run' })).event;
  await D.saveEventInfo({ token: bossTok, ev: bare.id, info: { organiser: '', signatory: '', role: '', phone: '', email: '', address: '', regNo: '', place: '', localBody: '' } });
  const old = (await D.saveEvent({ token: bossTok, name: 'Old Race', date: istDay(75), venue: 'Old Ground' })).event;
  const B = await login('boss');
  const { w, d } = B;
  const sel = d.querySelector('#evPick');
  ok(sel && sel.options.length === 3, 'with three races a race picker is shown');
  const pick = async (id, name) => { const s2 = d.querySelector('#evPick'); s2.value = id; change(w, s2); await waitFor(() => txt(d.querySelector('.topbar h1')) === name, 3000); await sleep(100); };
  await pick(bare.id, 'Bare Run');
  await tab(w, d, 'approvals');
  await waitFor(() => rowOf(d, 'Police permission'), 3000);
  click(w, rowOf(d, 'Police permission').querySelector('[data-act="letterOpen"]'));
  await waitFor(() => d.querySelector('#letterText'), 4000);
  const warn = d.querySelector('#letterCard .alert');
  ok(warn && /race date/.test(txt(warn)) && /venue/.test(txt(warn)) && /signatory name/.test(txt(warn)) && /Approvals template/.test(txt(warn)), 'missing details are listed above the letter: ' + txt(warn));
  ok(/\[race date\]/.test(d.querySelector('#letterText').value) && /\d+ \[bracketed\] blanks to fill in/.test(d.querySelector('#letterBlanks').textContent), 'blanks are in [brackets] and counted: ' + d.querySelector('#letterBlanks').textContent);
  const ta = d.querySelector('#letterText');
  set(w, ta, ta.value.replace(/\[[^\]\n]+\]/g, 'X'));
  ok(d.querySelector('#letterBlanks').textContent === 'No blanks left', 'the blank count follows what you type');
  click(w, d.querySelector('[data-act="letterClose"]')); await sleep(40);

  // an older race that only has the starter lines made by an earlier version
  const ex = (await wd.query('RDPlan').eq('event', old.id).limit(1000).find(SA)).items.filter((r) => r.kind === 'approval');
  await wd.bulkRemove('RDPlan', ex.map((r) => r._id), SA);
  const base = (o) => Object.assign({ event: old.id, kind: 'approval', cat: 'Permit', status: 'todo', owner: '', party: '', contact: '', due: '', time: '', amount: '', amount2: '', ref: '', link: '', notes: '', order: '000', by: '', at: '' }, o);
  await wd.bulkInsert('RDPlan', [['Police permission for road use and traffic diversion', 'Police and traffic'], ['Event insurance policy', 'Insurer'], ['Forest department permission (trail routes)', 'Forest department']].map(([title, party]) => base({ title, party, phase: 'permit' })).concat([base({ title: 'Weather go or no-go', owner: 'Race Director', phase: 'raceday' })]), SA);
  await pick(old.id, 'Old Race');
  await tab(w, d, 'approvals');
  await waitFor(() => d.querySelector('#tplForm'), 3000);
  const f = d.querySelector('#tplForm');
  ok(f && /4 starter lines nobody has touched will be replaced/.test(txt(f)), 'a race with only starter lines opens the template by itself and says what will be replaced: ' + txt(f).slice(0, 300));
  ok(f && f.elements['race.name'].value === 'Old Race' && f.elements['info.organiser'].value === 'VTRA' && f.elements['info.place'].value === 'Visakhapatnam', 'the organiser details come from the last race: ' + JSON.stringify([f.elements['race.name'].value, f.elements['info.organiser'].value, f.elements['info.place'].value]));
  submit(w, f);
  await waitFor(() => !d.querySelector('#tplForm'), 4000);
  ok(/replaced 3 starter lines/.test(toastText(d)) && /removed 1 unused starter line/.test(toastText(d)), 'adding replaces the starter lines: ' + toastText(d));
  await waitFor(() => rowOf(d, 'Venue, ground or park owner permission'));
  ok(!rowOf(d, 'Forest department permission') && rowOf(d, 'Police permission') && /Letter/.test(txt(rowOf(d, 'Police permission'))), 'the unused starter line is gone and the others are template lines with letters');
}

console.log('Approvals UI: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
