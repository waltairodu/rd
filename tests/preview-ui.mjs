// The stand-alone approvals preview page (docs/approvals-preview.html): runs the real library in a browser-like page.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = fs.readFileSync('../docs/approvals-preview.html', 'utf8');
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>';
function open() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('JSERR', e.message); fail++; });
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  return dom.window;
}
const w = open(), d = w.document;
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const set = (el, v) => { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const row = (k) => d.querySelector('.row[data-key="' + k + '"]');
const f = (g, k) => d.querySelector('[data-g="' + g + '"][data-k="' + k + '"]');
const addDays = (iso, n) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ta = () => d.querySelector('#letter-text');
await sleep(50);

/* first view */
ok(d.title === 'Race approvals template' || /Race Approvals Template/i.test(d.title), 'page title: ' + d.title);
ok(d.querySelectorAll('#permits .row').length === 16 && d.querySelectorAll('#signoffs .row').length === 9, '16 permits and 9 sign-offs are listed');
const date = f('race', 'date').value;
ok(/^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + 'T00:00:00Z').getUTCDay() === 0, 'the sample race date is a Sunday: ' + date);
ok(row('police').querySelector('[data-f=due]').value === addDays(date, -45) && row('police').querySelector('[data-f=lead]').value === '45', 'police is due 45 days before');
ok(row('police').querySelector('[data-f=party]').value === 'Commissioner of Police, Visakhapatnam', 'authority names the city');
ok(row('forest').classList.contains('off') && !row('forest').querySelector('[data-f=on]').checked, 'forest is off for a road race');
ok(row('police').classList.contains('is-open') && !d.querySelector('#letter').hidden && row('police').contains(d.querySelector('#letter')), 'the police letter is open inside its row');
ok(/the 6th edition of Vizag Half Marathon/.test(ta().value) && /Respected Sir\/Madam/.test(ta().value) && /Beach Road, Visakhapatnam/.test(ta().value), 'the letter is filled from the details');
ok(/phone number/.test(txt(d.querySelector('#letter-missing'))) && !d.querySelector('#letter-missing').hidden, 'the missing phone number is listed');
ok(/to fill in/.test(txt(d.querySelector('#blanks'))), 'blanks are counted: ' + txt(d.querySelector('#blanks')));
ok(/6th edition/.test(txt(d.querySelector('#racebar'))) && /days to go/.test(txt(d.querySelector('#racebar'))), 'race bar: ' + txt(d.querySelector('#racebar')));
ok(/Police permission/.test(txt(d.querySelector('#summary'))) && /10 permits and 8 sign-offs/.test(txt(d.querySelector('#summary'))), 'summary: ' + txt(d.querySelector('#summary')));
ok(row('rd-weather').querySelector('[data-f=time]').value === '03:30' && row('rd-final').querySelector('[data-f=time]').value === '05:20', 'sign-off times follow the 05:30 flag-off');

/* edit the edition, date and venue */
set(f('race', 'edition'), '7');
ok(/the 7th edition/.test(ta().value) && /7th edition/.test(txt(d.querySelector('#racebar'))), 'a new edition changes the letter and the bar');
const d2 = addDays(date, 14);
set(f('race', 'date'), d2);
ok(row('police').querySelector('[data-f=due]').value === addDays(d2, -45) && row('venue').querySelector('[data-f=due]').value === addDays(d2, -45), 'a new date moves every due date');
ok(new RegExp(d2.slice(0, 4)).test(ta().value) && /Sunday/.test(ta().value), 'and the letter');
set(f('race', 'venue'), 'GITAM University, Visakhapatnam');
ok(/GITAM University/.test(ta().value), 'a new venue is in the letter');
set(f('race', 'start'), '04:45');
ok(row('rd-weather').querySelector('[data-f=time]').value === '02:45', 'a new flag-off time moves the sign-offs');
ok(/before 6:00 am/.test((function () { click(row('sound').querySelector('[data-act=open]')); return ta().value; })()), 'the early start adds the paragraph about loudspeakers before 6 am');
click(row('police').querySelector('[data-act=open]'));

/* hand-typed dates stay */
const due = row('police').querySelector('[data-f=due]');
set(due, addDays(d2, -60));
ok(!row('police').querySelector('[data-act=follow]').hidden, 'a hand-typed date offers to follow the race date again');
set(f('race', 'date'), date);
ok(due.value === addDays(d2, -60) && row('civic').querySelector('[data-f=due]').value === addDays(date, -30), 'a typed date stays; others follow');
click(row('police').querySelector('[data-act=follow]'));
ok(due.value === addDays(date, -45) && row('police').querySelector('[data-act=follow]').hidden, 'Follow the race date resets it');
const lead = row('civic').querySelector('[data-f=lead]');
set(lead, '50');
ok(row('civic').querySelector('[data-f=due]').value === addDays(date, -50), 'changing the days changes the date');
set(lead, '');
ok(row('civic').querySelector('[data-f=due]').value === addDays(date, -30), 'clearing the days goes back to the suggestion');

/* questions */
const trail = d.querySelector('[data-scope=trail]');
set(trail, true);
ok(!row('forest').classList.contains('off') && row('forest').querySelector('[data-f=on]').checked && !row('rd-kit').classList.contains('off'), 'the trail answer adds forest, village consent and the kit check');
ok(/Divisional|District Forest Officer/.test(row('forest').querySelector('[data-f=party]').value), 'forest authority: ' + row('forest').querySelector('[data-f=party]').value);
ok(/12 permits and 9 sign-offs/.test(txt(d.querySelector('#summary'))), 'the count follows: ' + txt(d.querySelector('#summary')));
set(row('village').querySelector('[data-f=on]'), false);
set(trail, false);
ok(row('forest').classList.contains('off') && row('village').classList.contains('off') && !row('village').querySelector('[data-f=on]').checked, 'a line you switched off stays off, and the trail answer off drops the rest');
set(d.querySelector('[data-scope=roads]'), false);
ok(row('police').classList.contains('is-open'), 'the police letter is still open');
ok(/Although the route is largely away from public roads/.test(ta().value), 'without roads the police letter changes');
set(d.querySelector('[data-scope=roads]'), true);

/* documents and edits */
const docs = () => [...d.querySelectorAll('#docs input')];
ok(docs().length === 8 && /0 of 8 ready/.test(txt(d.querySelector('#docs-count'))) && /Letter · 0\/8/.test(txt(row('police').querySelector('[data-act=open]'))), 'eight documents, none ready');
set(docs()[0], true); set(docs()[2], true);
ok(/2 of 8 ready/.test(txt(d.querySelector('#docs-count'))) && /Letter · 2\/8/.test(txt(row('police').querySelector('[data-act=open]'))), 'ticking documents updates the count and the button');
ta().value = ta().value + '\n\nP.S. typed by hand';
ta().dispatchEvent(new w.Event('input', { bubbles: true }));
ok(!d.querySelector('#l-rebuild').hidden && d.querySelector('#letter-missing').hidden, 'a typed-in letter offers Rebuild');
set(f('race', 'edition'), '8');
ok(/P\.S\. typed by hand/.test(ta().value) && /7th edition/.test(ta().value), 'your edits are kept when the details change');
set(docs()[1], true);
ok(/P\.S\. typed by hand/.test(ta().value), 'and when a document is ticked');
click(d.querySelector('#l-rebuild'));
ok(!/P\.S\./.test(ta().value) && /8th edition/.test(ta().value), 'Rebuild brings back the text from the details');
set(d.querySelector('#letter-date'), '2027-01-05');
ok(/Date: 5 January 2027/.test(ta().value), 'the letter date can be set');
/* another letter keeps its own text */
click(row('civic').querySelector('[data-act=open]'));
ok(row('civic').classList.contains('is-open') && !row('police').classList.contains('is-open') && /Municipal|GVMC|Commissioner/.test(ta().value) && d.querySelectorAll('#docs input').length === 6, 'opening another letter closes the first; it has its own six documents');
click(row('civic').querySelector('[data-act=open]'));
ok(d.querySelector('#letter').hidden && !row('civic').classList.contains('is-open'), 'clicking again closes it');

/* copy */
click(row('police').querySelector('[data-act=open]'));
let copied = '';
Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
click(d.querySelector('#l-copy')); await sleep(40);
ok(/Respected Sir\/Madam/.test(copied) && /Letter copied/.test(txt(d.querySelector('#toast'))), 'Copy puts the letter on the clipboard');

/* sign-offs */
click(row('rd-weather').querySelector('[data-act=note]'));
ok(!row('rd-weather').querySelector('.signote').hidden && /forecast/i.test(txt(row('rd-weather').querySelector('.signote'))), 'What to check opens the sign-off notes');
set(row('rd-weather').querySelector('[data-f=offset]'), '180');
ok(row('rd-weather').querySelector('[data-f=time]').value === '01:45', 'minutes before changes the time (04:45 - 180 min)');

/* clear and sample */
click(d.querySelector('#b-clear'));
ok(f('race', 'name').value === '' && f('race', 'date').value === '' && row('police').querySelector('[data-f=due]').value === '' && /Set the race date/.test(txt(row('police').querySelector('.rel'))), 'Clear all details empties the form and the dates');
ok(/\[race date\]/.test(ta().value) || d.querySelector('#letter').hidden, 'letters show blanks');
click(row('police').querySelector('[data-act=open]'));
ok(/\[race date\]/.test(ta().value) && /\[venue\]/.test(ta().value) && /\[organiser name\]/.test(ta().value) && /to fill in/.test(txt(d.querySelector('#blanks'))), 'with nothing typed the letter shows what is missing');
click(d.querySelector('#b-sample'));
ok(f('race', 'name').value === 'Vizag Half Marathon' && row('police').querySelector('[data-f=due]').value !== '', 'Use sample details brings it back');
ok(!/[<>]/.test(txt(d.querySelector('#racebar')).replace(/\|/g, '')), 'no stray markup in the race bar');

/* html in a field is shown as text */
set(f('race', 'name'), '<img src=x onerror=alert(1)>');
ok(!d.querySelector('#racebar img') && /<img/.test(txt(d.querySelector('#racebar'))), 'typed HTML is shown as text');

console.log('Preview: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
