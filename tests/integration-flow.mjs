// INTEGRATION TESTS (backend): the whole chain on one database, with the real RaceOS, Expo and Training backends together.
// First-time setup -> the director makes desk logins on the Team screen -> each person logs in once -> the Expo desk
// starts with that same login -> bibs and T-shirts are handed over -> the director sees it, signs people out, resets,
// changes and removes logins -> other roles cannot get in anywhere they should not.
import * as R from './racedir.test.mjs';
import * as X from './exposoft.test.mjs';
import * as T from './training.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Integration: backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const D1 = 'Desk 1 - BIB';
const D2 = 'Desk 2 - Tshirt';
const D3 = 'Desk 3 - Misc';
const PK = { by: 'self', method: 'selfie', selfie: 'data:image/jpeg;base64,' + 'A'.repeat(1200) };
const day = (o) => new Date(Date.now() + 5.5 * 3600000 + o * 86400000).toISOString().slice(0, 10);
const runnerRow = (id) => wd.get('Runners', id, SA);
const presence = async (u) => (await wd.get('ExpoPresence', u, SA).catch(() => null)) || null;
const secrets = {};

/* ---------- 1. first-time setup, then the races ---------- */
global.__COLS.add('Import910');
global.__COLS.add('Import909');
const su = await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
ok(/admin owner added/.test(su.summary), 'setup made the first admin');
const owner = await R.login({ username: 'owner', password: 'Owner-Pass-2026' });
const OT = owner.token;
ok(owner.role === 'director' && owner.canManage, 'the admin logs in to RaceOS as director');
const races = await X.listEvents({ token: OT });
eq(races.map((r) => r.id).sort(), ['Import909', 'Import910'], 'the Expo desk finds both race collections with the director\'s one login');
await X.saveConfig({ token: OT, ev: 'Import910', name: 'VHM', bibLot: 200, shirtLot: { S: 2, M: 50, L: 50 } });
await X.saveConfig({ token: OT, ev: 'Import909', name: 'Ultribe Paderu', bibLot: 100, shirtLot: { M: 20 } });
const rowsA = [
  { bib: '101', name: 'Runner One', cat: '21K', size: 'M', phone: '9000000001', email: 'one@example.com' },
  { bib: '102', name: 'Runner Two', cat: '21K', size: 'S', phone: '9000000002', email: 'two@example.com' },
  { bib: '103', name: 'Runner Three', cat: '10K', size: 'M', phone: '9000000003' },
  { bib: '104', name: 'Runner Four', cat: '10K', size: 'L', phone: '9000000004' },
  { bib: '105', name: 'Runner Five', cat: '5K', size: 'S', phone: '9000000005' },
  { bib: '106', name: 'Runner Six', cat: '5K', size: '', phone: '9000000006' },
];
ok((await X.importRunners({ token: OT, ev: 'Import910', rows: rowsA })).added === 6, 'six VHM runners imported by the director');
ok((await X.importRunners({ token: OT, ev: 'Import909', rows: [{ bib: 'U1', name: 'Ultra One', cat: '50K', size: 'M' }, { bib: 'U2', name: 'Ultra Two', cat: '50K', size: 'M' }] })).added === 2, 'two Ultribe runners imported');
const ev = (await R.saveEvent({ token: OT, name: 'VHM 5th edition', date: day(3), venue: 'RK Beach', expoId: 'Import910' })).event;
ok(ev.expoId === 'Import910', 'the RaceOS race is linked to the Expo race');

/* ---------- 2. the director makes everyone's login on the Team screen ---------- */
const team = [
  ['bib.desk', 'Bib Desk Anil', 'desk', [D1], 'Import910'],
  ['shirt.desk', 'Shirt Desk Bala', 'desk', [D2], 'Import910'],
  ['misc.desk', 'Misc Desk Chitra', 'desk', [D3], 'Import910'],
  ['float', 'Floater Divya', 'desk', [D1, D2], 'Import910'],
  ['ult.desk', 'Ultribe Desk Esha', 'desk', [D2], 'Import909'],
  ['lead.one', 'Lead One', 'lead'],
  ['view.one', 'Viewer One', 'viewer'],
  ['coach.one', 'Coach One', 'coach'],
  ['dir.two', 'Director Two', 'director'],
];
for (const [u, name, role, desks, race] of team) {
  const r = await R.saveTeam({ token: OT, username: u, name, role, desks, race });
  secrets[u] = r.secret;
  ok(r.secret && r.member.username === u, 'Team: created ' + u + ' (' + role + ')');
}
ok(team.filter((t) => t[2] === 'desk').every((t) => /^\d{6}$/.test(secrets[t[0]])), 'desk logins got 6-digit PINs');
ok(['lead.one', 'view.one', 'coach.one', 'dir.two'].every((u) => secrets[u].length === 10), 'the other logins got 10-character passwords');
const LG = (u) => R.login({ username: u, password: secrets[u] });
const start = async (u) => {
  const r = await LG(u);
  const e = await X.enter({ token: r.token });
  return Object.assign({ token: r.token, login: r, entered: e }, e);
};

/* ---------- 3. each desk person logs in once and is at their desk ---------- */
const bib = await start('bib.desk');
ok(bib.login.role === 'desk' && !bib.login.canWrite && !bib.login.canManage, 'bib desk login: a desk session');
ok(bib.desk === D1 && bib.deskChosen && bib.race === 'Import910' && bib.raceName === 'VHM', 'one login, then enter: at Desk 1 - BIB for race VHM, nothing more to choose');
ok(bib.can.give.join() === 'check,bib' && bib.can.undo.join() === 'check,bib' && !bib.can.addRunner, 'the rules for that desk come with it');
ok(!JSON.stringify(bib.entered).includes(bib.token) && !/h1\$|password/i.test(JSON.stringify(bib.entered)), 'enter never repeats the token and holds no hash or password');
ok((await presence('bib.desk')).desk === D1, 'the desk is held');
const page = await X.loadPage({ token: bib.token, ev: 'Import910' });
ok(page.runners.length === 6 && page.runners.every((r) => r.id.startsWith('Import910~')), 'the desk loads its race\'s runners');
let r1 = await X.issue({ token: bib.token, id: 'Import910~101', check: true, bib: true, pickup: PK });
ok(r1.done.join() === 'check,bib', 'bib desk: check-in and bib handed over');
let row = await runnerRow('Import910~101');
ok(row.bibDesk === D1 && row.checkedInDesk === D1 && !row.shirtAt, 'recorded at Desk 1 - BIB, no shirt');
await refused(X.issue({ token: bib.token, id: 'Import910~102', shirtSize: 'S', pickup: PK }), 'wrong_desk', 'bib desk cannot give a T-shirt');
await refused(X.addRunner({ token: bib.token, ev: 'Import910', bib: '999', name: 'Walk In' }), 'wrong_desk', 'bib desk cannot add a runner');
await refused(X.saveConfig({ token: bib.token, ev: 'Import910', bibLot: 1, shirtLot: {} }), 'admin_only', 'bib desk cannot change stock');
await refused(X.importRunners({ token: bib.token, ev: 'Import910', rows: [{ bib: '1', name: 'Zed' }] }), 'admin_only', 'bib desk cannot import runners');

const shirt = await start('shirt.desk');
ok(shirt.desk === D2 && shirt.can.give.join() === 'shirt', 'shirt desk login lands at Desk 2 - Tshirt');
await refused(X.issue({ token: shirt.token, id: 'Import910~103', shirtSize: 'L', pickup: PK }), 'size_locked', 'the T-shirt size is the registered one (M), not what is typed');
r1 = await X.issue({ token: shirt.token, id: 'Import910~103', shirtSize: 'M', pickup: PK });
ok(r1.done.join() === 'shirt', 'shirt desk: T-shirt handed over in the registered size');
ok((await runnerRow('Import910~103')).shirtDesk === D2, '  recorded at Desk 2 - Tshirt');
ok((await X.getPickup({ token: shirt.token, id: 'Import910~103' })).shirtPickup.method === 'selfie', '  with the selfie proof kept');
await refused(X.issue({ token: shirt.token, id: 'Import910~106', shirtSize: 'M', pickup: PK }), 'no_registered_size', 'a runner with no registered size gets no shirt');
ok((await X.issue({ token: shirt.token, id: 'Import910~103', shirtSize: 'M', pickup: PK })).clash.join() === 'T-shirt', 'the same T-shirt twice is a clash, not a second one');
ok((await X.issue({ token: shirt.token, id: 'Import910~102', shirtSize: 'S', pickup: PK })).done.join() === 'shirt', 'S shirt 1 of 2 in stock');
ok((await X.issue({ token: shirt.token, id: 'Import910~105', shirtSize: 'S', pickup: PK })).done.join() === 'shirt', 'S shirt 2 of 2 in stock');

const misc = await start('misc.desk');
ok(misc.desk === D3 && misc.can.addRunner, 'misc desk login lands at Desk 3 - Misc and may add runners');
ok((await X.addRunner({ token: misc.token, ev: 'Import910', bib: '999', name: 'Walk In' })).runner.bib === '999', 'misc desk adds a walk-in runner');
await refused(X.issue({ token: misc.token, id: 'Import910~104', bib: true }), 'wrong_desk', 'misc desk hands nothing over');
ok((await X.revert({ token: misc.token, id: 'Import910~103', items: ['shirt'] })).runner.shirtIssued === false, 'misc desk can undo a T-shirt (corrections desk)');
ok((await X.issue({ token: shirt.token, id: 'Import910~103', shirtSize: 'M', pickup: PK })).done.join() === 'shirt', '  and it can then be given again');

const ult = await start('ult.desk');
ok(ult.race === 'Import909' && ult.raceName === 'Ultribe Paderu' && ult.desk === D2, 'Ultribe desk login: its own race and desk');
const up = await X.loadPage({ token: ult.token, ev: 'Import910' });
ok(up.runners.length === 2 && up.runners.every((r) => r.id.startsWith('Import909~')), 'asking that login for another race still returns only its own');
await refused(X.issue({ token: ult.token, id: 'Import910~104', shirtSize: 'L', pickup: PK }), 'not_found', 'and it cannot hand over to a runner of the other race');
ok((await X.listEvents({ token: ult.token })).map((r) => r.id).join() === 'Import909', 'and it sees only its own race in the list');

const fl = await start('float');
ok(!fl.deskChosen && fl.desks.join() === D1 + ',' + D2, 'a login with two desks must choose one');
await refused(X.issue({ token: fl.token, id: 'Import910~104', bib: true }), 'no_desk', '  and hands nothing over before it does');
await refused(X.chooseDesk({ token: fl.token, desk: D3 }), 'bad_desk', '  and cannot choose a desk that is not on its login');
ok((await X.chooseDesk({ token: fl.token, desk: D2 })).desk === D2, '  chooses Desk 2');
ok((await X.issue({ token: fl.token, id: 'Import910~104', shirtSize: 'L', pickup: PK })).done.join() === 'shirt', '  and then works that desk');

/* ---------- 4. one login, one desk ---------- */
const fl2 = await start('float');
await refused(X.chooseDesk({ token: fl2.token, desk: D1 }), 'desk_busy', 'the same login on a second device cannot take another desk while the first is working');
await R.logout({ token: fl.token });
ok(!(await presence('float')), 'logging out of RaceOS frees the desk');
ok((await X.chooseDesk({ token: fl2.token, desk: D1 })).desk === D1, 'and then the second device can take Desk 1');

/* ---------- 5. what the director sees ---------- */
const tm = await R.listTeam({ token: OT });
const at = (u) => tm.team.find((m) => m.username === u).atDesk;
ok(at('bib.desk') === D1 && at('shirt.desk') === D2 && at('misc.desk') === D3 && at('float') === D1 && at('ult.desk') === D2, 'the Team screen shows who is at which desk');
const sum = await R.expoSummary({ token: OT, ev: ev.id });
ok(sum.totals.runners === 7 && sum.totals.checkedIn === 1 && sum.totals.bibs === 1 && sum.totals.shirts === 4, 'RaceOS summary matches what the desks did: ' + JSON.stringify(sum.totals));
ok(sum.desks.some((d) => d.desk === D1 && d.bibs === 1) && sum.desks.some((d) => d.desk === D2 && d.shirts === 4), 'the summary credits each desk');
ok(sum.recent.every((x) => /^[A-Za-z]+( [A-Z]\.)?$/.test(x.who)), 'names in the summary are shortened: ' + sum.recent.map((x) => x.who).join(', '));
ok(!/9000000|@example|phone|email/i.test(JSON.stringify(sum)), 'the summary holds no phone numbers or e-mail addresses');
ok(sum.sizes.find((z) => z.size === 'S').given === 2, 'T-shirt stock used is counted');

/* ---------- 6. the director changes access and it bites at once ---------- */
await R.signOutTeam({ token: OT, username: 'bib.desk' });
await refused(X.loadPage({ token: bib.token, ev: 'Import910' }), 'not_logged_in', 'signed out by the director: the desk token stops working');
ok(!(await presence('bib.desk')), '  and the desk is free');
const bib2 = await start('bib.desk');
ok(bib2.desk === D1, '  and the same PIN logs in again, to the same desk');
const oldShirtPin = secrets['shirt.desk'];
const reset = await R.resetTeamSecret({ token: OT, username: 'shirt.desk' });
await refused(X.loadPage({ token: shirt.token, ev: 'Import910' }), 'not_logged_in', 'new PIN: the old session ends');
await refused(R.login({ username: 'shirt.desk', password: oldShirtPin }), 'bad_login', '  the old PIN stops working');
secrets['shirt.desk'] = reset.secret;
const shirt2 = await start('shirt.desk');
ok(shirt2.desk === D2, '  the new PIN works and lands at the desk');
await R.saveTeam({ token: OT, edit: true, username: 'shirt.desk', name: 'Shirt Desk Bala', role: 'desk', desks: [D3], race: 'Import910' });
await refused(X.loadPage({ token: shirt2.token, ev: 'Import910' }), 'not_logged_in', 'moving a login to another desk ends its session');
const shirt3 = await start('shirt.desk');
ok(shirt3.desk === D3 && shirt3.can.give.length === 0, '  and its next login lands at the new desk with that desk\'s rules');
await R.saveTeam({ token: OT, edit: true, username: 'ult.desk', name: 'Ultribe Desk Esha', role: 'desk', desks: [D2], race: 'Import910' });
const ult2 = await start('ult.desk');
ok(ult2.race === 'Import910', 'changing the race of a login moves it (after a new login)');
await refused(X.loadPage({ token: ult.token }), 'not_logged_in', '  the old session was ended');
await R.removeTeam({ token: OT, username: 'misc.desk' });
await refused(X.loadPage({ token: misc.token, ev: 'Import910' }), 'not_logged_in', 'a removed login: its token stops working');
await refused(R.login({ username: 'misc.desk', password: secrets['misc.desk'] }), 'bad_login', '  and it cannot log in');
ok(!(await presence('misc.desk')), '  and holds no desk');

/* ---------- 7. the other roles, across all three backends ---------- */
const lead = await LG('lead.one');
const view = await LG('view.one');
const dir2 = await LG('dir.two');
ok(lead.role === 'lead' && view.role === 'viewer' && dir2.role === 'director', 'lead, viewer and second director log in to RaceOS');
await refused(X.enter({ token: lead.token }), 'not_allowed', 'a lead cannot start the Expo desk');
await refused(X.loadPage({ token: lead.token, ev: 'Import910' }), 'not_allowed', 'a lead cannot read the Expo runners');
await refused(X.enter({ token: view.token }), 'not_allowed', 'a viewer cannot start the Expo desk');
await refused(X.issue({ token: view.token, id: 'Import910~104', bib: true }), 'not_allowed', 'a viewer cannot hand anything over');
ok((await X.enter({ token: dir2.token })).role === 'admin', 'a second director can use the Expo desk');
await refused(R.listEvents({ token: bib2.token }), 'not_allowed', 'a desk login cannot use RaceOS');
await refused(R.saveTeam({ token: bib2.token, username: 'sneaky', name: 'Sneaky', role: 'director' }), 'not_allowed', 'a desk login cannot make itself a director');
await refused(R.login({ username: 'coach.one', password: secrets['coach.one'] }), 'not_allowed', 'a coach cannot use RaceOS');
const coach = await T.tLogin({ username: 'coach.one', password: secrets['coach.one'] });
ok(coach.role === 'coach', 'the coach logs in to the coach page with the password the Team screen made');
await refused(X.enter({ token: coach.token }), 'not_allowed', 'the coach token does not open the Expo desk');
await refused(R.listEvents({ token: coach.token }), 'not_allowed', 'the coach token does not open RaceOS');
await refused(T.tWhoami({ token: bib2.token }), 'not_allowed', 'a desk token does not open the coach page');
ok((await T.tWhoami({ token: OT })).role === 'director', 'the director\'s token works on the coach page too (one login, shared)');

/* ---------- 8. a hand-made desk login from before ---------- */
await wd.insert('ExpoStaff', { username: 'legacy1', password: 'abc-123-xyz', role: '', desks: '1', race: 'Import910', name: 'Legacy One', failCount: '0', lockUntil: '' }, SA);
ok((await R.listTeam({ token: OT })).team.find((m) => m.username === 'legacy1').handTyped, 'the Team screen flags a password typed by hand');
const lg = await R.login({ username: 'legacy1', password: 'abc-123-xyz' });
const lgEnter = await X.enter({ token: lg.token });
ok(lg.role === 'desk' && lgEnter.desk === D1 && lgEnter.race === 'Import910', 'it still works end to end: login, enter, at its desk');
ok(A.isHashed((await wd.get('ExpoStaff', [...DB.ExpoStaff.values()].find((x) => x.username === 'legacy1')._id, SA)).password), 'its first login replaced the typed password by a hash');
ok(!(await R.listTeam({ token: OT })).team.find((m) => m.username === 'legacy1').handTyped, 'and the Team screen no longer flags it');
ok((await R.login({ username: 'legacy1', password: 'abc-123-xyz' })).role === 'desk', 'the same password still works afterwards');

/* ---------- 9. sessions expire ---------- */
const tok = (await LG('float')).token;
const sRow = [...DB.ExpoSessions.values()].find((s) => s.token === tok);
await wd.update('ExpoSessions', Object.assign({}, sRow, { expires: new Date(Date.now() - 1000).toISOString() }), SA);
await refused(X.whoami({ token: tok }), 'not_logged_in', 'an expired session stops working on the Expo desk');
await refused(R.whoami({ token: tok }), 'not_logged_in', '  and on RaceOS');

/* ---------- 10. nothing sensitive is left lying around ---------- */
const staff = [...DB.ExpoStaff.values()];
ok(staff.length >= 10 && staff.every((s) => A.isHashed(s.password)), 'every stored password is a hash (' + staff.length + ' logins)');
const dump = JSON.stringify(Object.fromEntries(Object.entries(DB).map(([k, v]) => [k, [...v.values()]])));
ok(!Object.values(secrets).some((s) => dump.includes(s)), 'no PIN or password the Team screen handed out appears anywhere in the database');
ok(!dump.includes('Owner-Pass-2026') && !dump.includes('abc-123-xyz'), 'neither does the owner\'s password or the legacy password');
ok(!DB.Import910 && !DB.Import909, 'nothing was ever written to the findmybib source collections');
const audit = [...DB.RDAudit.values()];
ok(audit.some((n) => n.action === 'login created' && n.target === 'bib.desk') && audit.some((n) => n.action === 'login removed' && n.target === 'misc.desk') && audit.some((n) => n.action === 'password reset' && n.target === 'shirt.desk'), 'the Team screen has a note of each change');

done();
