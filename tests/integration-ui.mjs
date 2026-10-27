// INTEGRATION TESTS (screens): the combined /rd page in a simulated browser, driven by typing and clicking.
// The director makes a desk login on the Team screen, hands over the PIN, the desk person logs in at the same page and
// lands on their desk, hands over a bib, and the director then sees them, signs them out, changes the PIN and removes them.
import * as D from './racedir.test.mjs';
import * as X from './exposoft.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
import { makeHarness, sleep } from './rd-harness.mjs';
const { ok, done } = suite('Integration: screens');
const SA = { suppressAuth: true };
const H = makeHarness({ D, X, onJsError: (e) => ok(false, 'a script error in the page: ' + e.message) });
const { log, set, change, submit, click, txt, inner, login } = H;

await wd.insert('ExpoConfig', { _id: 'Import910', name: 'VHM', json: JSON.stringify({ bibLot: 100, shirtLot: { M: 50, S: 50 } }) }, SA);
for (const [bib, name] of [['101', 'Runner One'], ['102', 'Runner Two']])
  await wd.insert('Runners', { _id: 'Import910~' + bib, event: 'Import910', bib, name, cat: '21K', size: 'M', phone: '9000000' + bib, email: '', example: '', checkedInAt: '', checkedInDesk: '', bibAt: '', bibDesk: '', shirtSize: '', shirtAt: '', shirtDesk: '' }, SA);
await wd.insert('ExpoStaff', { username: 'boss', password: A.hashPassword('pw-boss'), role: 'admin', desks: '', race: '', name: 'The Boss', failCount: '0', lockUntil: '' }, SA);
await wd.insert('ExpoStaff', { username: 'lead1', password: A.hashPassword('pw-lead1'), role: 'lead', desks: '', race: '', name: 'Lead One', failCount: '0', lockUntil: '' }, SA);
const presence = async (u) => (await wd.get('ExpoPresence', u, SA).catch(() => null)) || null;
const runner = (id) => wd.get('Runners', id, SA);
const rowOf = (u) => [...global.__DB.ExpoStaff.values()].find((r) => r.username === u);
const arm = async (s, sel) => {
  click(s.w, s.d.querySelector(sel));
  await sleep(80);
  click(s.w, s.d.querySelector(sel));
  await sleep(500);
};

/* ---------- the director opens the Team screen and makes a desk login ---------- */
const dir = await login('boss', 'pw-boss');
ok(dir.d.querySelector('[data-tab="team"]'), 'the director sees the Team tab');
click(dir.w, dir.d.querySelector('[data-tab="team"]'));
await sleep(500);
ok(dir.d.querySelector('#teamForm') && /Add a login/.test(txt(dir.d.querySelector('#teamForm'))), 'Team screen opens with the Add a login form');
ok(dir.d.querySelector('tr[data-user="boss"]') && /You/.test(txt(dir.d.querySelector('tr[data-user="boss"]'))), 'the list shows the director, marked as you');
ok(!dir.d.querySelector('[data-act="teamDel"][data-id="boss"]'), 'there is no Remove button on your own row');
ok(dir.d.querySelector('#tfRole').value === 'desk' && dir.d.querySelectorAll('input[data-desk]').length === 3, 'the form starts as a desk login with three desks to tick');
ok(dir.d.querySelector('#tfRace').value === 'Import910', 'with only one race, it is already chosen');
set(dir.w, dir.d.querySelector('#tfName'), 'Meera Desk');
ok(dir.d.querySelector('#tfUser').value === 'meera.desk', 'the username is suggested from the name: ' + dir.d.querySelector('#tfUser').value);
// no desk ticked yet: the server refuses and the screen says so
submit(dir.w, dir.d.querySelector('#teamForm'));
await sleep(400);
ok(/desk/i.test(txt(dir.d.querySelector('#toast'))) && !dir.d.querySelector('#secretCard'), 'saving with no desk ticked is refused with a message, and no PIN is made');
ok(!rowOf('meera.desk'), '  nothing was saved');
const box = dir.d.querySelector('input[data-desk][value="Desk 1 - BIB"]');
box.checked = true;
change(dir.w, box);
submit(dir.w, dir.d.querySelector('#teamForm'));
await sleep(600);
const card = dir.d.querySelector('#secretCard');
ok(card && /Hand this over now/.test(txt(card)), 'saving shows the hand-over card');
const pin = txt(dir.d.querySelector('#secPin')).trim();
ok(dir.d.querySelector('#secUser').textContent === 'meera.desk' && /^[1-9]\d{5}$/.test(pin), 'the card shows the username and a 6-digit PIN');
ok(/PIN/.test(txt(card)), 'it says PIN (not password) for a desk login');
const meera = dir.d.querySelector('tr[data-user="meera.desk"]');
ok(meera && /Desk 1 - BIB/.test(txt(meera)) && /VHM/.test(txt(meera)), 'the new login is in the list with its desk and race');
ok(rowOf('meera.desk') && A.isHashed(rowOf('meera.desk').password), 'the PIN is stored hashed');
click(dir.w, dir.d.querySelector('[data-act="secretClose"]'));
await sleep(100);
ok(!dir.d.querySelector('#secretCard') && !txt(dir.d.body).includes(pin), 'closing the card removes the PIN from the page');
ok(/login created/.test(txt(dir.d.body)) && /meera\.desk/.test(txt(dir.d.querySelector('.card:last-child'))), 'Recent changes lists the new login');
// A duplicate username is refused
click(dir.w, dir.d.querySelector('[data-act="teamNew"]'));
await sleep(100);
set(dir.w, dir.d.querySelector('#tfName'), 'Meera Again');
set(dir.w, dir.d.querySelector('#tfUser'), 'meera.desk');
const b2 = dir.d.querySelector('input[data-desk][value="Desk 2 - Tshirt"]');
b2.checked = true;
change(dir.w, b2);
submit(dir.w, dir.d.querySelector('#teamForm'));
await sleep(500);
ok(/already|taken/i.test(txt(dir.d.querySelector('#toast'))) && !dir.d.querySelector('#secretCard'), 'a username already in use is refused with a message');
// The director logs out
click(dir.w, dir.d.querySelector('[data-act="logout"]'));
await sleep(500);
ok(dir.d.querySelector('#loginForm') && !dir.d.querySelector('[data-tab="team"]'), 'the director logs out to the login');

/* ---------- the desk person logs in at the same page ---------- */
log.calls.length = 0;
log.tokens.length = 0;
const wrong = await login('meera.desk', '123456');
ok(wrong.d.querySelector('#loginForm') && !wrong.d.querySelector('#expoFrame') && /Wrong username/.test(txt(wrong.d.querySelector('#app'))), 'a wrong PIN stays on the login with a clear message');
log.calls.length = 0;
const desk = await login('meera.desk', pin, 1800);
ok(!desk.d.querySelector('.tabs'), 'the desk person sees no RaceOS tabs');
ok(desk.d.querySelector('#expoFrame') && !desk.d.querySelector('#expoWrap').hidden, 'the Expo desk is shown straight away');
const id = inner(desk);
ok(id && !id.querySelector('#app').hidden && id.querySelector('#gate').hidden && id.querySelector('#deskName').value === 'Desk 1 - BIB', 'they are at Desk 1 - BIB with nothing to choose');
ok(log.calls.filter((c) => c === 'rd:login').length === 1 && log.calls.filter((c) => c === 'expo:enter').length === 1 && !log.calls.includes('expo:login'), 'one login call, then one enter call: no second login');
ok(!log.calls.some((c) => c.startsWith('rd:') && c !== 'rd:login'), 'no RaceOS method was called for the desk person');
ok((await presence('meera.desk')).desk === 'Desk 1 - BIB', 'the desk is held');
// Hand over a bib (no selfie is needed for the bib alone: switch the check-in off)
set(id.defaultView, id.querySelector('#q'), '101');
await sleep(200);
const res = id.querySelector('.res[data-act="open"]');
ok(res && /Runner One/.test(txt(res)), 'searching for bib 101 finds Runner One');
click(id.defaultView, res);
await sleep(300);
const checkTog = id.querySelector('#panel [data-item="check"][data-act="pick"]');
ok(checkTog && id.querySelector('#panel [data-item="bib"][data-act="pick"]') && !id.querySelector('#panel [data-item="shirt"][data-act="pick"]'), 'the BIB desk offers check-in and bib, not the T-shirt');
click(id.defaultView, checkTog);
await sleep(100);
const confirm = id.querySelector('#panel [data-act="confirm"]');
ok(confirm && !confirm.disabled && /bib/i.test(txt(confirm)), 'with check-in switched off, handing over the bib alone can be confirmed: ' + txt(confirm));
click(id.defaultView, confirm);
await sleep(700);
let r101 = await runner('Import910~101');
ok(r101.bibAt && r101.bibDesk === 'Desk 1 - BIB' && !r101.checkedInAt && !r101.shirtAt, 'the bib was handed over and recorded at Desk 1 - BIB');
ok(log.args.filter((a) => a.mod === 'expo').every((a) => a.arg && a.arg.token === log.tokens[0]), 'every Expo call carried the desk person\'s one session token');

/* ---------- the director sees the person at the desk ---------- */
const dir2 = await login('boss', 'pw-boss');
click(dir2.w, dir2.d.querySelector('[data-tab="team"]'));
await sleep(500);
ok(/At Desk 1 - BIB now/.test(txt(dir2.d.querySelector('tr[data-user="meera.desk"]'))), 'the Team screen shows "At Desk 1 - BIB now" for her');
// ---- sign out ends her session and the desk page returns to the login
await arm(dir2, '[data-act="teamOut"][data-id="meera.desk"]');
ok(/Signed out \(1 session\)/.test(txt(dir2.d.querySelector('#toast'))), 'Sign out (after "Sure?") reports one session ended: ' + txt(dir2.d.querySelector('#toast')));
ok(!(await presence('meera.desk')), '  and frees her desk');
inner(desk).defaultView.parent.postMessage({ kind: 'call', id: 501, method: 'whoami', arg: {} }, '*');
await sleep(500);
ok(desk.d.querySelector('#loginForm') && !desk.d.querySelector('#expoFrame') && /session ended/i.test(txt(desk.d.querySelector('#app'))), 'her desk page notices and returns to the login with a clear note');
// ---- a new PIN
const oldPin = pin;
await arm(dir2, '[data-act="teamReset"][data-id="meera.desk"]');
const card2 = dir2.d.querySelector('#secretCard');
const pin2 = txt(dir2.d.querySelector('#secPin')).trim();
ok(card2 && /^[1-9]\d{5}$/.test(pin2) && pin2 !== oldPin, 'New PIN shows a new PIN once: ' + pin2.replace(/./g, '*'));
const stale = await login('meera.desk', oldPin);
ok(stale.d.querySelector('#loginForm') && !stale.d.querySelector('#expoFrame'), 'the old PIN no longer logs in');
const fresh = await login('meera.desk', pin2, 1500);
ok(fresh.d.querySelector('#expoFrame') && inner(fresh) && inner(fresh).querySelector('#deskName').value === 'Desk 1 - BIB', 'the new PIN logs in to the desk');
// ---- edit: change the desk
click(dir2.w, dir2.d.querySelector('[data-act="teamEdit"][data-id="meera.desk"]'));
await sleep(200);
ok(dir2.d.querySelector('#tfUser').readOnly && dir2.d.querySelector('#tfUser').value === 'meera.desk', 'editing: the username cannot be changed');
const e1 = dir2.d.querySelector('input[data-desk][value="Desk 1 - BIB"]');
const e2 = dir2.d.querySelector('input[data-desk][value="Desk 2 - Tshirt"]');
e1.checked = false;
change(dir2.w, e1);
e2.checked = true;
change(dir2.w, e2);
submit(dir2.w, dir2.d.querySelector('#teamForm'));
await sleep(600);
ok(rowOf('meera.desk').desks === 'Desk 2 - Tshirt', 'the new desk is saved');
ok(!dir2.d.querySelector('#secretCard'), 'a change that sets no password shows no PIN');
inner(fresh).defaultView.parent.postMessage({ kind: 'call', id: 502, method: 'whoami', arg: {} }, '*');
await sleep(500);
ok(fresh.d.querySelector('#loginForm') && !fresh.d.querySelector('#expoFrame'), 'changing her desk ended her session');
const moved = await login('meera.desk', pin2, 1500);
ok(inner(moved) && inner(moved).querySelector('#deskName').value === 'Desk 2 - Tshirt', 'she logs in again and is at Desk 2 - Tshirt');
// ---- remove
await arm(dir2, '[data-act="teamDel"][data-id="meera.desk"]');
ok(!dir2.d.querySelector('tr[data-user="meera.desk"]') && !rowOf('meera.desk'), 'Remove (after "Sure?") takes her off the list and out of the database');
const gone = await login('meera.desk', pin2);
ok(gone.d.querySelector('#loginForm') && !gone.d.querySelector('#expoFrame'), 'and she can no longer log in');

/* ---------- a lead does not get any of this ---------- */
const lead = await login('lead1', 'pw-lead1');
ok(lead.d.querySelector('.tabs') && !lead.d.querySelector('[data-tab="team"]') && !lead.d.querySelector('[data-tab="expo"]'), 'a lead sees neither the Team tab nor the Expo desk tab');
ok(!lead.d.querySelector('#teamForm') && !lead.d.querySelector('#expoFrame'), '  and neither screen is on the page');

ok(log.jsErrors.length === 0, 'no script error in any page during the whole flow (' + log.jsErrors.length + ')');
done();
