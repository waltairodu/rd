// UNIT TESTS: the Team screen's backend methods and the first-time setup, one method at a time
// (wix/director/racedir.web.js: listTeam, saveTeam, resetTeamSecret, signOutTeam, removeTeam, ensureSetup).
import * as R from './racedir.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Unit: Team screen');
const SA = { suppressAuth: true };
const DB = global.__DB;
const D1 = 'Desk 1 - BIB';
const D2 = 'Desk 2 - Tshirt';
const D3 = 'Desk 3 - Misc';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rowOf = (u) => [...(DB.ExpoStaff || new Map()).values()].find((r) => String(r.username || r.title || '').toLowerCase() === u);
const sessionsOf = (u) => [...(DB.ExpoSessions || new Map()).values()].filter((s) => String(s.username).toLowerCase() === u);
const audits = () => [...(DB.RDAudit || new Map()).values()];
const secretsSeen = [];

/* ---------- first-time setup (runs on an empty database) ---------- */
await refused(R.ensureSetup({ key: 'wrong' }), 'Wrong setup key', 'setup: wrong key refused');
await refused(R.ensureSetup({}), 'Wrong setup key', 'setup: no key refused');
await refused(R.ensureSetup(), 'Wrong setup key', 'setup: no argument at all refused');
ok(!DB.ExpoStaff || DB.ExpoStaff.size === 0, 'setup: wrong keys created no login');
let e = await err(R.ensureSetup({ key: 'k-test', username: 'ab', password: 'Str0ng-Pass!' }));
ok(/^Username needs/.test(e), 'setup: a 2-letter username is refused');
e = await err(R.ensureSetup({ key: 'k-test', username: 'owner', password: 'abc' }));
ok(/^Username needs/.test(e), 'setup: a 3-character password is refused');
e = await err(R.ensureSetup({ key: 'k-test', username: 'owner', password: 'x'.repeat(73) }));
ok(/^Username needs/.test(e), 'setup: a 73-character password is refused');
e = await err(R.ensureSetup({ key: 'k-test', username: 'bad name!', password: 'Str0ng-Pass!' }));
ok(/^Username needs/.test(e), 'setup: a username with a space and "!" is refused');
await refused(R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Password' }), 'That password is too easy to guess', 'setup: "Password" is refused as too easy');
await refused(R.ensureSetup({ key: 'k-test', username: 'ownerx', password: 'ownerx' }), 'That password is too easy to guess', 'setup: a password equal to the username is refused');
ok(!DB.ExpoStaff || DB.ExpoStaff.size === 0, 'setup: refused attempts created no login');
let su = await R.ensureSetup({ key: 'k-test', username: 'Owner', password: 'Str0ng-Pass!' });
ok(/admin owner added/.test(su.summary), 'setup: the first admin is added (username lower-cased): ' + su.summary);
const owner = rowOf('owner');
ok(owner && owner.role === 'admin' && A.isHashed(owner.password) && !JSON.stringify(owner).includes('Str0ng-Pass!'), 'setup: the admin password is stored hashed, never as typed');
ok(owner.failCount === '0' && owner.lockUntil === '', 'setup: the admin row starts with no failures and no lock');
su = await R.ensureSetup({ key: 'k-test', username: 'second', password: 'An0ther-Pass!' });
ok(/logins already exist, none added/.test(su.summary) && !rowOf('second'), 'setup: a second run adds no second admin');
const first = await R.login({ username: 'OWNER', password: 'Str0ng-Pass!' });
ok(first.role === 'director' && first.canManage, 'setup: the new admin logs in (username not case sensitive) as director');

/* ---------- the logins and races used below ---------- */
await wd.insert('ExpoConfig', { _id: 'Import910', name: 'VHM', json: '{}' }, SA);
await wd.insert('ExpoConfig', { _id: 'Import909', name: 'Ultribe Paderu', json: '{}' }, SA);
const base = { failCount: '0', lockUntil: '', desks: '', race: '' };
const mk = (username, role, password, extra) => wd.insert('ExpoStaff', Object.assign({ username, password: password === undefined ? A.hashPassword('pw-' + username) : password, role, name: username.toUpperCase() }, base, extra || {}), SA);
await mk('boss', 'admin');
await mk('dir2', 'director');
await mk('lead1', 'lead');
await mk('view1', 'viewer');
await mk('coach1', 'coach');
await mk('odd1', 'volunteer');
await mk('hand1', '', 'typed-by-hand', { name: 'Hand Typed' });
await wd.insert('ExpoStaff', { title: 'oldtimer', password: 'pw-oldtimer', role: '', name: 'Old Timer', failCount: '0', lockUntil: '', desks: '', race: 'Import910' }, SA);
const L = (u) => R.login({ username: u, password: 'pw-' + u });
const boss = await L('boss');
const dir2 = await L('dir2');
const lead = await L('lead1');
const view = await L('view1');
const T = boss.token;
await mk('deskman', 'desk', undefined, { desks: D1, race: 'Import910' });
const deskTok = (await L('deskman')).token;

/* ---------- who may use the Team methods ---------- */
const teamCalls = (tok) => [
  ['listTeam', R.listTeam({ token: tok })],
  ['saveTeam', R.saveTeam({ token: tok, username: 'x-user', name: 'X User', role: 'lead' })],
  ['resetTeamSecret', R.resetTeamSecret({ token: tok, username: 'lead1' })],
  ['signOutTeam', R.signOutTeam({ token: tok, username: 'lead1' })],
  ['removeTeam', R.removeTeam({ token: tok, username: 'lead1' })],
];
for (const [who, tok, code] of [['a lead', lead.token, 'director_only'], ['a viewer', view.token, 'director_only'], ['desk staff', deskTok, 'not_allowed'], ['nobody (no token)', undefined, 'not_logged_in'], ['a forged token', 'f'.repeat(40), 'not_logged_in'], ['a short token', 'abc', 'not_logged_in']])
  for (const [m, p] of teamCalls(tok)) await refused(p, code, m + ' refused for ' + who);
ok(!rowOf('x-user') && rowOf('lead1'), 'none of the refused calls changed anything');
ok((await R.listTeam({ token: dir2.token })).team.length > 0, 'a second director may use the Team screen');

/* ---------- listTeam ---------- */
let lt = await R.listTeam({ token: T });
const names = lt.team.map((m) => m.username);
ok(names[0] === 'boss' || names[0] === 'dir2' || names[0] === 'owner', 'directors are listed first');
const roleSeq = lt.team.map((m) => m.role);
const order = { director: 0, lead: 1, viewer: 2, desk: 3, coach: 4, other: 5 };
ok(roleSeq.every((r, i) => i === 0 || order[roleSeq[i - 1]] <= order[r]), 'the list is ordered director, lead, viewer, desk, coach, other: ' + roleSeq.join(','));
ok(lt.you === 'boss' && lt.team.filter((m) => m.you).length === 1 && lt.team.find((m) => m.you).username === 'boss', 'exactly one row is marked as you');
eq(lt.desks, [D1, D2, D3], 'listTeam names the three desks');
eq(lt.roles, ['director', 'lead', 'viewer', 'desk', 'coach'], 'listTeam names the roles that can be given');
eq(lt.races.map((r) => r.id).sort(), ['Import909', 'Import910'], 'listTeam names the races');
const j = JSON.stringify(lt);
ok(!/h1\$/.test(j) && !/pw-boss|pw-dir2|typed-by-hand|pw-oldtimer|Str0ng/.test(j), 'listTeam never contains a password or a hash');
ok(lt.team.every((m) => !('password' in m) && 'hasPassword' in m && 'handTyped' in m), 'a member has hasPassword and handTyped, no password field');
const hand = lt.team.find((m) => m.username === 'hand1');
ok(hand.role === 'desk' && hand.anyDesk && hand.desks.length === 3 && hand.handTyped, 'a hand-made login with no role: desk, any desk, password typed by hand');
const bossRow = lt.team.find((m) => m.username === 'boss');
ok(bossRow.role === 'director' && !bossRow.handTyped && bossRow.hasPassword, 'a hashed director: has a password, not hand typed');
eq(bossRow.desks, [], 'a director has no desks listed');
const old = lt.team.find((m) => m.username === 'oldtimer');
ok(old && old.role === 'desk' && old.race === 'Import910' && old.raceName === 'VHM', 'a login whose username is in the Title column is listed, with its race name');
ok(lt.team.find((m) => m.username === 'odd1').role === 'other', 'a login with an unknown role is listed as other');
ok(lt.team.find((m) => m.username === 'coach1').role === 'coach', 'a coach is listed');
ok(lt.team.find((m) => m.username === 'deskman').desks.join() === D1 && lt.team.find((m) => m.username === 'deskman').race === 'Import910', 'a desk login lists its desk and race');
await wd.insert('ExpoPresence', { _id: 'deskman', username: 'deskman', desk: D1, seen: new Date().toISOString() }, SA);
lt = await R.listTeam({ token: T });
ok(lt.team.find((m) => m.username === 'deskman').atDesk === D1, 'a login seen at a desk a moment ago shows that desk');
await wd.update('ExpoPresence', { _id: 'deskman', username: 'deskman', desk: D1, seen: new Date(Date.now() - 10 * 60000).toISOString() }, SA);
lt = await R.listTeam({ token: T });
ok(lt.team.find((m) => m.username === 'deskman').atDesk === '', 'a desk not seen for ten minutes shows as free');
await wd.bulkRemove('ExpoPresence', ['deskman'], SA);

/* ---------- saveTeam: making logins ---------- */
const mkArg = (o) => Object.assign({ token: T, username: 'asha', name: 'Asha Rao', role: 'desk', desks: [D1], race: 'Import910' }, o);
await refused(R.saveTeam(mkArg({ username: '' })), 'bad_username', 'empty username refused');
for (const bad of ['ab', 'a b', 'asha!', 'a'.repeat(31), '-asha', '.asha', '_asha', 'as/ha', 'as\\ha', "as'ha", 'as"ha', 'as;ha', 'as<ha>', 'ఆషా', 'as\u0000ha', 'as\nha', 'as ha', 'as@ha.com', '../etc', '%41sha', 'as,ha'])
  await refused(R.saveTeam(mkArg({ username: bad })), 'bad_username', 'username ' + JSON.stringify(bad) + ' refused');
for (const good of ['abc', 'a.b', 'a_b', 'a-b', 'a1b2c3', '0abc', 'x'.repeat(30)]) {
  const r = await R.saveTeam(mkArg({ username: good, role: 'viewer', desks: undefined, race: undefined }));
  ok(r.member.username === good, 'username ' + JSON.stringify(good) + ' accepted');
}
await refused(R.saveTeam(mkArg({ username: 'u-role1', role: 'root' })), 'bad_role', 'role "root" refused');
await refused(R.saveTeam(mkArg({ username: 'u-role2', role: 'admin' })), 'bad_role', 'role "admin" is not a role name on the Team screen (it is "director")');
await refused(R.saveTeam(mkArg({ username: 'u-role3', role: '' })), 'bad_role', 'empty role refused');
await refused(R.saveTeam(mkArg({ username: 'u-role4', role: undefined })), 'bad_role', 'missing role refused');
await refused(R.saveTeam(mkArg({ username: 'u-role5', role: ['desk'] })), 'bad_role', 'an array as the role is refused');
await refused(R.saveTeam(mkArg({ username: 'u-role6', role: '__proto__' })), 'bad_role', 'role "__proto__" refused');
await refused(R.saveTeam(mkArg({ username: 'u-role7', role: 'DESK' })), 'bad_role', 'role names are exact (DESK refused)');
await refused(R.saveTeam(mkArg({ username: 'u-name1', name: '' })), 'name_needed', 'empty name refused');
await refused(R.saveTeam(mkArg({ username: 'u-name2', name: 'A' })), 'name_needed', 'one-letter name refused');
await refused(R.saveTeam(mkArg({ username: 'u-name3', name: '   ' })), 'name_needed', 'blank name refused');
await refused(R.saveTeam(mkArg({ username: 'u-name4', name: undefined })), 'name_needed', 'missing name refused');
ok(!rowOf('u-role1') && !rowOf('u-name1') && !rowOf('u-role5'), 'refused calls saved nothing');

// A desk login
let c = await R.saveTeam(mkArg({}));
secretsSeen.push(c.secret);
ok(/^[1-9]\d{5}$/.test(c.secret), 'a new desk login gets a generated 6-digit PIN, shown once: ' + c.secret.replace(/./g, '*'));
ok(c.warn === '' && c.member.username === 'asha' && c.member.role === 'desk' && c.member.desks.join() === D1 && c.member.race === 'Import910' && c.member.raceName === 'VHM', 'the answer describes the new login');
ok(!JSON.stringify(c.member).includes(c.secret) && !JSON.stringify(c.member).includes('h1$'), 'the member part of the answer holds no secret and no hash');
let r1 = rowOf('asha');
ok(r1.role === 'desk' && r1.desks === D1 && r1.race === 'Import910' && r1.name === 'Asha Rao' && r1.failCount === '0' && r1.lockUntil === '', 'the stored row: role, desk, race, name, no failures');
ok(A.isHashed(r1.password) && !JSON.stringify(r1).includes(c.secret), 'the stored password is a hash, not the PIN');
const al = await R.login({ username: 'asha', password: c.secret });
ok(al.role === 'desk' && !al.canWrite && !al.canManage, 'the new desk login can log in with the PIN, as a desk session');
await R.logout({ token: al.token });
ok(!sessionsOf('asha').length, 'logging out ends that session');
await refused(R.login({ username: 'asha', password: '000000' }), 'bad_login', 'and not with another PIN');
await refused(R.saveTeam(mkArg({})), 'username_taken', 'the same username again is refused');
await refused(R.saveTeam(mkArg({ username: 'ASHA' })), 'username_taken', '  in any letter case');
await refused(R.saveTeam(mkArg({ username: 'Boss', role: 'lead' })), 'username_taken', 'a username already used by a director cannot be taken');
await refused(R.saveTeam(mkArg({ username: 'oldtimer', role: 'lead' })), 'username_taken', 'a username kept in the Title column counts as taken');

// desks
await refused(R.saveTeam(mkArg({ username: 'dk1', desks: [] })), 'desk_needed', 'a desk login needs a desk (empty list)');
await refused(R.saveTeam(mkArg({ username: 'dk2', desks: undefined })), 'desk_needed', 'a desk login needs a desk (missing)');
await refused(R.saveTeam(mkArg({ username: 'dk3', desks: '' })), 'desk_needed', 'a desk login needs a desk (empty text)');
await refused(R.saveTeam(mkArg({ username: 'dk4', desks: ['  ', ''] })), 'desk_needed', 'a desk login needs a desk (blank entries)');
await refused(R.saveTeam(mkArg({ username: 'dk5', desks: ['Desk 9'] })), 'bad_desk', 'an unknown desk is refused');
await refused(R.saveTeam(mkArg({ username: 'dk6', desks: [D1, 'Finish line'] })), 'bad_desk', 'one unknown desk among good ones refuses the whole call');
await refused(R.saveTeam(mkArg({ username: 'dk7', desks: new Array(11).fill(D1) })), 'bad_desk', 'more than 10 desk entries are refused');
ok(!rowOf('dk1') && !rowOf('dk5') && !rowOf('dk6'), '  and nothing is saved');
c = await R.saveTeam(mkArg({ username: 'dk8', desks: 'Desk 3 - Misc, Desk 1 - BIB, 1' }));
ok(rowOf('dk8').desks === D1 + ',' + D3, 'desks written as text are tidied: canonical names, fixed order, no repeats: ' + rowOf('dk8').desks);
c = await R.saveTeam(mkArg({ username: 'dk9', desks: ['3', 'tshirt', 'bib'] }));
ok(rowOf('dk9').desks === D1 + ',' + D2 + ',' + D3, 'short names (3, tshirt, bib) become the full names');
c = await R.saveTeam(mkArg({ username: 'dk10', desks: [D2] }));
ok(rowOf('dk10').desks === D2, 'a one-desk login');

// races
await refused(R.saveTeam(mkArg({ username: 'rc1', race: 'Nowhere' })), 'bad_race', 'an unknown race is refused');
await refused(R.saveTeam(mkArg({ username: 'rc2', race: undefined })), 'race_needed', 'with two races, a desk login must be given one');
await refused(R.saveTeam(mkArg({ username: 'rc3', race: '' })), 'race_needed', '  (empty race too)');
c = await R.saveTeam(mkArg({ username: 'rc4', race: 'ultribe paderu' }));
ok(rowOf('rc4').race === 'Import909' && c.member.raceName === 'Ultribe Paderu', 'a race typed by name (any case) is stored as its id');
c = await R.saveTeam(mkArg({ username: 'rc5', race: 'IMPORT909' }));
ok(rowOf('rc5').race === 'Import909', 'a race typed as its id in capitals is stored as the id');
c = await R.saveTeam(mkArg({ username: 'rc6', race: '  VHM  ' }));
ok(rowOf('rc6').race === 'Import910', 'spaces around a race name are ignored');
// lead / viewer / director / coach carry no desks or race
c = await R.saveTeam(mkArg({ username: 'ld2', role: 'lead', desks: [D1], race: 'Import910', name: 'Lead Two' }));
ok(/^[A-HJ-NP-Za-km-z2-9]{10}$/.test(c.secret), 'a new lead gets a generated 10-character password');
secretsSeen.push(c.secret);
ok(rowOf('ld2').role === 'lead' && rowOf('ld2').desks === '' && rowOf('ld2').race === '', 'a lead is stored with no desks and no race, even if some were sent');
ok(c.member.desks.length === 0, '  and its listing shows no desks');
c = await R.saveTeam(mkArg({ username: 'dr2', role: 'director', name: 'Dir Two' }));
ok(rowOf('dr2').role === 'admin' && c.member.role === 'director', 'a new director is stored with the role "admin"');
c = await R.saveTeam(mkArg({ username: 'vw2', role: 'viewer', name: 'Sponsor Viewer' }));
ok(rowOf('vw2').role === 'viewer', 'a viewer');
c = await R.saveTeam(mkArg({ username: 'ch2', role: 'coach', name: 'Coach Two' }));
ok(rowOf('ch2').role === 'coach', 'a coach');
await refused(R.login({ username: 'ch2', password: c.secret }), 'not_allowed', 'a coach cannot use RaceOS (coach page only)');
// names
c = await R.saveTeam(mkArg({ username: 'nm1', name: '  Ravi\tKumar\nSingh  ' }));
ok(rowOf('nm1').name === 'Ravi Kumar Singh', 'control characters in a name become spaces: ' + JSON.stringify(rowOf('nm1').name));
c = await R.saveTeam(mkArg({ username: 'nm2', name: 'N'.repeat(100) }));
ok(rowOf('nm2').name.length === 60, 'a long name is cut to 60 characters');
c = await R.saveTeam(mkArg({ username: 'nm3', name: '<img src=x onerror=alert(1)>' }));
ok(rowOf('nm3').name === '<img src=x onerror=alert(1)>', 'markup in a name is stored as plain text (the screen must escape it; see the security tests)');
// own passwords
c = await R.saveTeam(mkArg({ username: 'pw1', password: 'Open-Sesame-9', role: 'viewer' }));
ok(c.secret === '' && A.checkPassword(rowOf('pw1').password, 'Open-Sesame-9'), 'a password typed by the director is used as given and nothing is shown back');
await refused(R.saveTeam(mkArg({ username: 'pw2', password: 'abc12', role: 'viewer' })), 'bad_password', 'a 5-character password is refused');
await refused(R.saveTeam(mkArg({ username: 'pw3', password: 'x'.repeat(73), role: 'viewer' })), 'bad_password', 'a 73-character password is refused');
c = await R.saveTeam(mkArg({ username: 'pw4', password: 'x1'.repeat(36), role: 'viewer' }));
ok(A.checkPassword(rowOf('pw4').password, 'x1'.repeat(36)), 'a 72-character password is accepted');
for (const weak of ['password', 'PASSWORD', 'Password', '123456', 'qwerty123', 'admin123', 'letmein', 'welcome', 'vtra123', 'visakha'])
  await refused(R.saveTeam(mkArg({ username: 'pw5', password: weak, role: 'viewer' })), 'weak_password', 'weak password "' + weak + '" refused');
await refused(R.saveTeam(mkArg({ username: 'samepw', password: 'samepw', role: 'viewer' })), 'weak_password', 'a password equal to the username is refused');
await refused(R.saveTeam(mkArg({ username: 'SamePw2', password: 'samepw2', role: 'viewer' })), 'weak_password', '  even in another letter case');
ok(!rowOf('pw5') && !rowOf('pw2'), 'weak or bad passwords saved nothing');
// mass assignment
c = await R.saveTeam(mkArg({ username: 'mass1', failCount: '-99', lockUntil: '2999-01-01T00:00:00Z', _id: 'hijack', _owner: 'x', isAdmin: true, admin: true, sessions: ['x'], authToken: 'y'.repeat(40) }));
const mrow = rowOf('mass1');
ok(!DB.ExpoStaff.has('hijack') && mrow._id !== 'hijack', 'an _id sent in the call is ignored');
ok(Object.keys(mrow).every((k) => ['_id', '_updatedDate', 'username', 'password', 'role', 'desks', 'race', 'name', 'failCount', 'lockUntil'].includes(k)), 'only the known columns are written (' + Object.keys(mrow).join(',') + ')');
ok(mrow.failCount === '0' && mrow.lockUntil === '', 'failCount and lockUntil sent in the call are ignored');
await R.login({ username: 'mass1', password: c.secret });
ok(true, '  and the new login can log in at once');

/* ---------- saveTeam: changing logins ---------- */
const ed = (o) => R.saveTeam(Object.assign({ token: T, edit: true, username: 'asha', name: 'Asha Rao', role: 'desk', desks: [D1], race: 'Import910' }, o));
await refused(R.saveTeam(mkArg({ username: 'ghost1', edit: true })), 'no_member', 'changing a login that does not exist is refused');
const pinAsha = secretsSeen[0];
let s1 = (await R.login({ username: 'asha', password: pinAsha })).token;
let s2 = (await R.login({ username: 'asha', password: pinAsha })).token;
ok((await R.whoami({ token: s1 })).role === 'desk', 'two sessions of asha are open');
// a change of name alone leaves sessions alone
let ec = await ed({ name: 'Asha R. Rao' });
ok(rowOf('asha').name === 'Asha R. Rao' && ec.secret === '', 'changing the name saves it and shows no secret');
ok(A.checkPassword(rowOf('asha').password, pinAsha), '  and the password stays as it was');
ok((await R.whoami({ token: s1 })).role === 'desk' && sessionsOf('asha').length === 2, '  and her sessions stay open');
// a change of desk ends sessions
await wd.insert('ExpoPresence', { _id: 'asha', username: 'asha', desk: D1, seen: new Date().toISOString() }, SA);
ec = await ed({ desks: [D2] });
ok(rowOf('asha').desks === D2, 'changing the desk saves it');
ok(sessionsOf('asha').length === 0, '  and ends every session of that login');
await refused(R.whoami({ token: s1 }), 'not_logged_in', '  so the old token stops working');
ok(!DB.ExpoPresence.has('asha'), '  and frees the desk she was holding');
s1 = (await R.login({ username: 'asha', password: pinAsha })).token;
ec = await ed({ desks: [D2], race: 'Import909' });
ok(rowOf('asha').race === 'Import909' && sessionsOf('asha').length === 0, 'changing the race ends her sessions too');
s1 = (await R.login({ username: 'asha', password: pinAsha })).token;
ec = await ed({ desks: [D2], race: 'Import909', password: 'Brand-New-Pin-77' });
ok(ec.secret === '' && A.checkPassword(rowOf('asha').password, 'Brand-New-Pin-77') && !A.checkPassword(rowOf('asha').password, pinAsha), 'a new password replaces the old one');
ok(sessionsOf('asha').length === 0, '  and ends her sessions');
await refused(R.login({ username: 'asha', password: pinAsha }), 'bad_login', '  the old PIN no longer works');
ok((await R.login({ username: 'asha', password: 'Brand-New-Pin-77' })).role === 'desk', '  the new password does');
// a password change clears a lock
for (let k = 0; k < 5; k++) await err(R.login({ username: 'asha', password: 'wrong' + k }));
await refused(R.login({ username: 'asha', password: 'Brand-New-Pin-77' }), 'locked', 'five wrong tries lock the login');
ok((await R.listTeam({ token: T })).team.find((m) => m.username === 'asha').locked, '  and the Team screen shows it as locked');
ec = await ed({ desks: [D2], race: 'Import909', password: 'Another-Pin-4242' });
ok(rowOf('asha').failCount === '0' && rowOf('asha').lockUntil === '', 'a new password clears the lock');
ok((await R.login({ username: 'asha', password: 'Another-Pin-4242' })).role === 'desk', '  and she can log in');
// edit without sending the password keeps it; role kept as spelled
await mk('Cap1', 'Director');
ec = await R.saveTeam({ token: T, edit: true, username: 'cap1', name: 'Cap One', role: 'director' });
ok(rowOf('cap1').role === 'Director' && A.checkPassword(rowOf('cap1').password, 'pw-Cap1'), 'editing a director whose role is spelled "Director" keeps that spelling and the password');
ec = await R.saveTeam({ token: T, edit: true, username: 'hand1', name: 'Hand Typed', role: 'desk', desks: [D3], race: 'Import910' });
ok(rowOf('hand1').role === 'desk' && rowOf('hand1').desks === D3, 'a hand-made login with no role gets role "desk" when saved from the Team screen');
ok(rowOf('hand1').password === 'typed-by-hand' && ec.member.handTyped, '  its hand-typed password is left as it was until its first login hashes it');
await R.login({ username: 'hand1', password: 'typed-by-hand' });
ok(A.isHashed(rowOf('hand1').password), '  and that first login replaces it by a hash');
ok(!(await R.listTeam({ token: T })).team.find((m) => m.username === 'hand1').handTyped, '  so the Team screen no longer flags it');
// the Title-column login
ec = await R.saveTeam({ token: T, edit: true, username: 'oldtimer', name: 'Old Timer', role: 'desk', desks: [D2], race: 'Import910' });
const ot = rowOf('oldtimer');
ok(ot.username === 'oldtimer' && ot.title === 'oldtimer' && ot.desks === D2, 'a login kept in the Title column can be changed; it gains a username column');
// your own login
await refused(R.saveTeam({ token: T, edit: true, username: 'boss', name: 'Boss', role: 'lead' }), 'own_role', 'a director cannot change their own role');
await refused(R.saveTeam({ token: T, edit: true, username: 'BOSS', name: 'Boss', role: 'desk', desks: [D1], race: 'Import910' }), 'own_role', '  in any letter case');
const bossSecond = (await L('boss')).token;
ec = await R.saveTeam({ token: T, edit: true, username: 'boss', name: 'The Boss', role: 'director' });
ok(rowOf('boss').name === 'The Boss', 'a director can change their own name');
ok((await R.whoami({ token: T })).role === 'director' && (await R.whoami({ token: bossSecond })).role === 'director', '  and both their sessions stay open');
ec = await R.saveTeam({ token: T, edit: true, username: 'boss', name: 'The Boss', role: 'director', password: 'Boss-New-Pass-5' });
ok((await R.whoami({ token: T })).role === 'director', 'changing their own password keeps the session they are using');
await refused(R.whoami({ token: bossSecond }), 'not_logged_in', '  and ends their other sessions');
ec = await R.saveTeam({ token: T, edit: true, username: 'boss', name: 'The Boss', role: 'director', password: 'pw-boss' });
ok(ec.secret === '', 'put the password back for the tests below');
// one director changes another
ec = await R.saveTeam({ token: T, edit: true, username: 'dir2', name: 'Dir Two', role: 'lead' });
ok(rowOf('dir2').role === 'lead', 'a director can change another director to lead');
await refused(R.whoami({ token: dir2.token }), 'not_logged_in', '  and that person\'s session ends at once');
await refused(R.listTeam({ token: dir2.token }), 'not_logged_in', '  so they cannot use the Team screen any more');
// race column missing
const realInsert = wd.insert;
const realUpdate = wd.update;
wd.insert = async (col, row, o) => {
  if (col === 'ExpoStaff' && row.race) throw new Error('unknown field race');
  return realInsert(col, row, o);
};
wd.update = async (col, row, o) => {
  if (col === 'ExpoStaff' && row.race) throw new Error('unknown field race');
  return realUpdate(col, row, o);
};
c = await R.saveTeam(mkArg({ username: 'norace1', race: 'Import910' }));
ok(c.warn === 'race_column_missing' && rowOf('norace1') && !rowOf('norace1').race, 'a staff collection with no "race" column: the login is saved without it and the answer warns');
ok(/^[1-9]\d{5}$/.test(c.secret), '  and the PIN is still shown');
await refused(R.saveTeam(mkArg({ username: 'norace2', role: 'viewer' })), '', 'a login with no race to save is unaffected by the missing column');
wd.insert = realInsert;
wd.update = realUpdate;

/* ---------- resetTeamSecret ---------- */
const before = (await R.login({ username: 'lead1', password: 'pw-lead1' })).token;
let rs = await R.resetTeamSecret({ token: T, username: 'lead1' });
secretsSeen.push(rs.secret);
ok(rs.username === 'lead1' && /^[A-HJ-NP-Za-km-z2-9]{10}$/.test(rs.secret), 'resetting a lead gives a new 10-character password');
await refused(R.login({ username: 'lead1', password: 'pw-lead1' }), 'bad_login', '  the old password stops working');
ok((await R.login({ username: 'lead1', password: rs.secret })).role === 'lead', '  the new one works');
await refused(R.whoami({ token: before }), 'not_logged_in', '  and the old session ended');
ok(A.isHashed(rowOf('lead1').password), '  and it is stored hashed');
rs = await R.resetTeamSecret({ token: T, username: 'deskman' });
ok(/^[1-9]\d{5}$/.test(rs.secret), 'resetting a desk login gives a 6-digit PIN');
secretsSeen.push(rs.secret);
await wd.insert('ExpoPresence', { _id: 'deskman', username: 'deskman', desk: D1, seen: new Date().toISOString() }, SA);
for (let k = 0; k < 5; k++) await err(R.login({ username: 'deskman', password: 'bad' + k }));
ok((await R.listTeam({ token: T })).team.find((m) => m.username === 'deskman').locked, 'a locked desk login');
rs = await R.resetTeamSecret({ token: T, username: 'deskman' });
secretsSeen.push(rs.secret);
ok(rowOf('deskman').failCount === '0' && rowOf('deskman').lockUntil === '', '  a reset clears the lock');
ok(!DB.ExpoPresence.has('deskman'), '  and frees the desk');
ok((await R.login({ username: 'deskman', password: rs.secret })).role === 'desk', '  and the new PIN works');
const bt = (await R.login({ username: 'boss', password: 'pw-boss' })).token;
rs = await R.resetTeamSecret({ token: T, username: 'boss' });
ok((await R.whoami({ token: T })).role === 'director', 'a director resetting their own password stays logged in');
await refused(R.whoami({ token: bt }), 'not_logged_in', '  and their other sessions end');
await R.saveTeam({ token: T, edit: true, username: 'boss', name: 'The Boss', role: 'director', password: 'pw-boss' });
await refused(R.resetTeamSecret({ token: T, username: 'nobody' }), 'no_member', 'resetting a login that does not exist is refused');
await refused(R.resetTeamSecret({ token: T }), 'no_member', 'resetting with no username is refused');
await refused(R.resetTeamSecret({ token: T, username: '' }), 'no_member', 'resetting with an empty username is refused');

/* ---------- signOutTeam ---------- */
const w1 = (await L('view1')).token;
const w2 = (await L('view1')).token;
ok(sessionsOf('view1').length >= 2, 'view1 has sessions open');
let so = await R.signOutTeam({ token: T, username: 'view1' });
ok(so.ok && so.ended >= 2 && sessionsOf('view1').length === 0, 'signing a login out ends all its sessions (' + so.ended + ')');
await refused(R.whoami({ token: w1 }), 'not_logged_in', '  the token no longer works');
ok((await L('view1')).role === 'viewer', '  and the person can log in again');
so = await R.signOutTeam({ token: T, username: 'view1' });
await wd.insert('ExpoPresence', { _id: 'view1', username: 'view1', desk: D2, seen: new Date().toISOString() }, SA);
await R.signOutTeam({ token: T, username: 'view1' });
ok(!DB.ExpoPresence.has('view1'), '  signing out frees a desk the login held');
const mine1 = (await L('boss')).token;
so = await R.signOutTeam({ token: T, username: 'boss' });
ok((await R.whoami({ token: T })).role === 'director', 'signing yourself out keeps the session you are using');
await refused(R.whoami({ token: mine1 }), 'not_logged_in', '  and ends your other sessions');
await refused(R.signOutTeam({ token: T, username: 'nobody' }), 'no_member', 'signing out a login that does not exist is refused');

/* ---------- removeTeam ---------- */
const rt = (await R.saveTeam(mkArg({ username: 'temp1', race: 'Import910' })));
const tt = (await R.login({ username: 'temp1', password: rt.secret })).token;
await wd.insert('ExpoPresence', { _id: 'temp1', username: 'temp1', desk: D1, seen: new Date().toISOString() }, SA);
ok((await R.removeTeam({ token: T, username: 'temp1' })).ok, 'a login can be removed');
ok(!rowOf('temp1') && sessionsOf('temp1').length === 0 && !DB.ExpoPresence.has('temp1'), '  its row, sessions and desk hold are gone');
await refused(R.whoami({ token: tt }), 'not_logged_in', '  and its token stops working');
await refused(R.login({ username: 'temp1', password: rt.secret }), 'bad_login', '  and it cannot log in');
await refused(R.removeTeam({ token: T, username: 'temp1' }), 'no_member', 'removing it again is refused');
await refused(R.removeTeam({ token: T, username: 'boss' }), 'own_login', 'a director cannot remove their own login');
await refused(R.removeTeam({ token: T, username: 'BOSS' }), 'own_login', '  in any letter case');
ok(!!rowOf('boss'), '  and it is still there');
await refused(R.removeTeam({ token: T, username: '' }), 'no_member', 'removing with no username is refused');
await R.removeTeam({ token: T, username: 'oldtimer' });
ok(!rowOf('oldtimer'), 'a login kept in the Title column can be removed');

/* ---------- the audit notes ---------- */
const all = audits();
ok(all.length > 20, 'the changes above left ' + all.length + ' audit notes');
ok(all.every((n) => n.at && n.by && n.action && n.target !== undefined), 'every note has a time, a person, an action and a target');
ok(all.some((n) => n.action === 'login created' && n.target === 'asha' && /desk: Desk 1 - BIB/.test(n.detail)), 'creating a desk login is noted with its desk');
ok(all.some((n) => n.action === 'login changed' && n.target === 'asha' && /password changed/.test(n.detail)), 'a password change is noted (without the password)');
ok(all.some((n) => n.action === 'password reset' && n.target === 'lead1'), 'a reset is noted');
ok(all.some((n) => n.action === 'signed out' && n.target === 'view1'), 'a sign-out is noted');
ok(all.some((n) => n.action === 'login removed' && n.target === 'temp1'), 'a removal is noted');
const everyAuditText = JSON.stringify(all);
ok(secretsSeen.length >= 5 && secretsSeen.every((s) => s && !everyAuditText.includes(s)), 'no generated PIN or password appears in any audit note (' + secretsSeen.length + ' checked)');
ok(!/h1\$/.test(everyAuditText) && !/Brand-New-Pin-77|Another-Pin-4242|Open-Sesame-9|Boss-New-Pass-5/.test(everyAuditText), 'no typed password or hash appears in any audit note');
lt = await R.listTeam({ token: T });
ok(lt.recent.length === 15, 'the Team screen shows the 15 newest notes');
ok(lt.recent.every((n, i) => i === 0 || lt.recent[i - 1].at >= n.at), '  newest first');
await sleep(5);
await R.signOutTeam({ token: T, username: 'lead1' });
lt = await R.listTeam({ token: T });
ok(lt.recent[0].action === 'signed out' && lt.recent[0].target === 'lead1' && lt.recent[0].by === 'boss', 'the newest note is the latest change, with who made it');

/* ---------- setup key guessing is limited ---------- */
for (let k = 0; k < 9; k++) await err(R.ensureSetup({ key: 'guess' + k }));
await refused(R.ensureSetup({ key: 'k-test', username: 'late', password: 'Str0ng-Pass!' }), 'busy_try_later', 'after 10 wrong setup keys in an hour, even the right key is refused until the hour is over');

done();
