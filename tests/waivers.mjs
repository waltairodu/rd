// BACKEND TESTS (Waivers): who may call what, the text in versions, which question of the registration form is the waiver, the list of
// people and where each stands, papers recorded on the day (once only, two screens at once, a call that runs out of time), a record that
// was a mistake, the papers to print, the "waiver" choice of a message, the other race, and what is kept, on one in-memory database with
// the real RaceOS, Communications and Waivers backends.
//   V1 who may call what   V2 overview   V3 the text   V4 the setup   V5 the list   V6 papers recorded   V7 a mistake   V8 papers to print
//   V9 messages   V10 the other race   V11 what is kept   V12 the volunteer waiver
import * as R from './racedir.test.mjs';
import * as CM from './comms.test.mjs';
import * as WV from './waivers.test.mjs';
import * as W from './rd-waiver.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Waivers backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const rows = (t) => [...(DB[t] || new Map()).values()];
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const NAMES = Object.keys(WV).filter((n) => /^wv[A-Z]/.test(n)).sort();
const snap = () => JSON.stringify(Object.keys(DB).sort().map((k) => [k, [...DB[k].entries()]]));
// the clock: a slow write moves it on
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
let slow = 0;
const realInsert = wd.insert;
wd.insert = (...a) => {
  if (slow && a[0] === 'RDWaivers') skew += slow;
  return realInsert.apply(wd, a);
};
// nothing is ever deleted
let removes = 0;
for (const fn of ['bulkRemove', 'remove', 'truncate']) {
  if (typeof wd[fn] === 'function') {
    const f = wd[fn];
    wd[fn] = (...a) => {
      removes++;
      return f.apply(wd, a);
    };
  }
}
const LEAK = /@example\.com|98123\d{5}|0891234567/;

/* ---------- the world ---------- */
const HASH = A.hashPassword('Wv-pass-1');
const mkStaff = (username, role) => wd.insert('ExpoStaff', { username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['desk1', 'desk']];
for (const [u, r] of WHO) await mkStaff(u, r);
const TOK = {};
for (const [u] of WHO) {
  TOK[u] = A.newToken();
  await wd.insert('ExpoSessions', { token: TOK[u], username: u, desk: '', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
}
const call = (m, who, a) => WV[m](Object.assign({ token: TOK[who] }, a));
const RD = istDay(60);
const CATS = [{ name: '10 K', km: 10, price: 800, cap: 9000 }, { name: '21 K', km: 21.0975, price: 1200, cap: 9000 }];
const mkRace = async (name, cats) => {
  const ev = (await R.saveEvent({ token: TOK.boss, name, date: RD, venue: 'Beach Road <b>' })).event.id;
  await R.saveCats({ token: TOK.boss, ev, cats });
  return ev;
};
const EVA = await mkRace('Waiver Run A', CATS);
const EVB = await mkRace('Waiver Run B', CATS.slice(0, 1));
const EVC = await mkRace('Waiver Run C', CATS.slice(0, 1));
const EVP = await mkRace('Waiver Run P big', CATS.slice(0, 1));
const Q = 'I agree to the waiver';
const FORM = (ans) => JSON.stringify([{ name: 'Gender', value: 'F' }, { name: Q, value: ans }]);
const regId = (ev, key) => 'REG~' + ev.slice(-6) + '~' + key;
const reg = (ev, p) => wd.insert('RDRegs', { _id: regId(ev, p.key || p.bib), event: ev, name: p.name, cat: p.cat || '10 K', bib: p.bib || '', bibName: '', size: 'M', status: p.status || 'ok', phone: p.phone || '', email: p.email || '', form: p.noform ? '[]' : FORM(p.ans === undefined ? '' : p.ans), at: '2027-01-05T08:00:00.000Z' }, SA);
const PPL = [
  { bib: '101', name: 'Asha Rao', ans: 'Yes', email: 'asha@example.com', phone: '9812300101' },
  { bib: '102', name: 'BINA RAO', ans: 'yes.', email: 'bina@example.com', phone: '9812300102' },
  { bib: '103', name: 'Chitra Devi', ans: 'No', email: 'chitra@example.com', phone: '9812300103' },
  { bib: '104', name: 'Dev Raman', ans: '', email: '', phone: '9812300104' },
  { bib: '105', name: 'Esha Nair', ans: 'I agree', cat: '21 K', email: 'esha@example.com', phone: '' },
  { bib: '106', name: 'Farah Khan', noform: true, cat: '21 K', email: 'farah@example.com', phone: '9812300106' },
  { bib: '107', name: '<img src=x onerror=1>Eve', ans: '', email: 'eve@example.com', phone: '9812300107' },
  { key: 'nina', bib: '', name: 'Nina Nobib', ans: '', email: 'nina@example.com', phone: '9812300999' },
  { bib: '111', name: 'Unpaid Uma', ans: 'yes', status: 'pending', email: 'uma@example.com', phone: '9812300111' },
];
for (const p of PPL) await reg(EVA, p);
await reg(EVB, { bib: '101', name: 'Other Race Olga', ans: 'yes', email: 'olga@example.com', phone: '9812300777' });
const ID = (key) => regId(EVA, key);
const vol = (ev, n, name, status, waiver) => wd.insert('RDVolunteers', { _id: 'VOL~' + ev.slice(-6) + '~' + n, event: ev, name, phone: '98123005' + String(n).padStart(2, '0'), email: 'vol' + n + '@example.com', club: '', status, code: 'C' + n, waiverAt: waiver ? '2027-01-03T09:00:00.000Z' : '', waiverVersion: waiver ? 'v1' : '', createdAt: new Date().toISOString(), notes: '' }, SA);
await vol(EVA, 1, 'Vol One', 'approved', true);
await vol(EVA, 2, 'Vol Two', 'applied', false);
await vol(EVA, 3, 'Vol Three', 'declined', true);
await vol(EVA, 4, 'Vol Four', 'approved', false);
await vol(EVB, 5, 'Vol Other', 'approved', false);
const VID = (n) => 'VOL~' + EVA.slice(-6) + '~' + n;
const T1 = { title: 'Waiver for {race}', text: 'I agree to take part in {race} on {date} at {venue} at my own risk. I am {name}, bib {bib}, {cat}.' };
const T2 = { title: 'Waiver for {race} (2nd)', text: 'I agree to take part in {race} on {date} at {venue} at my own risk and I accept the new rules. I am {name}, bib {bib}, {cat}.' };
const SET = { question: Q, accept: ['Yes', 'I agree'], formVersion: 1, minVersion: 1 };
const bibsOf = (r) => r.items.map((l) => l.bib).filter(Boolean);
const namesOf = (r) => r.items.map((l) => l.name);
const list = (who, o, extra) => call('wvList', who || 'boss', Object.assign({ ev: EVA, who: 'runners' }, o || {}, extra || {}));
const sigRows = (ev, ref) => rows('RDWaivers').filter((r) => r.kind === 'sig' && (!ev || r.event === ev) && (!ref || r.ref === ref));
const state = async (key) => (await list('boss', { filter: 'all' })).items.find((l) => l.id === ID(key));

/* ---------- V1 who may call what ---------- */
{
  const ARGS = {
    wvOverview: { ev: EVA },
    wvText: { ev: EVA },
    wvList: { ev: EVA, who: 'runners' },
    wvRecords: { ev: EVA, who: 'runners', id: ID('101') },
    wvSheet: { ev: EVA, who: 'volunteers', mode: 'forms', scope: 'blank' },
    wvRecord: { ev: EVA, who: 'runners', ids: [ID('103')], ver: 1 },
    wvSaveText: Object.assign({ ev: EVA, base: 0 }, T1),
    wvSaveSettings: Object.assign({ ev: EVA }, SET),
    wvVoid: { ev: EVA, id: 'sig~x', reason: 'because' },
  };
  eq(NAMES, ['wvList', 'wvOverview', 'wvRecord', 'wvRecords', 'wvSaveSettings', 'wvSaveText', 'wvSheet', 'wvText', 'wvVoid'], 'V1 the backend has these nine methods');
  eq(Object.keys(ARGS).sort(), NAMES, 'V1 every method is tried below');
  const DIRONLY = ['wvSaveText', 'wvSaveSettings', 'wvVoid'];
  const before = snap();
  for (const m of NAMES) {
    await refused(WV[m](ARGS[m]), 'not_logged_in', 'V1 ' + m + ' needs a login');
    for (const bad of ['', 'short', 'x'.repeat(19), ['t'.repeat(30)], { toString: () => TOK.boss }, 12345678901234567890, null, true]) {
      const got = await err(WV[m](Object.assign({}, ARGS[m], { token: bad })));
      ok(got === 'not_logged_in', 'V1 ' + m + ' refuses a token that is not a real one: ' + JSON.stringify(bad) + (got === 'not_logged_in' ? '' : ' [got ' + got + ']'));
    }
    for (const u of ['view1', 'coach1', 'desk1']) await refused(call(m, u, ARGS[m]), 'not_allowed', 'V1 ' + m + ' is not for a ' + u);
  }
  for (const m of DIRONLY) await refused(call(m, 'lead1', ARGS[m]), 'director_only', 'V1 ' + m + ' is for directors only');
  eq(snap(), before, 'V1 nothing was written by any refused call');
  // a session that has run out, and one of a person who is no longer on the team
  const old = A.newToken();
  await wd.insert('ExpoSessions', { token: old, username: 'boss', desk: '', expires: new Date(Date.now() - 1000).toISOString() }, SA);
  const nan = A.newToken();
  await wd.insert('ExpoSessions', { token: nan, username: 'boss', desk: '', expires: 'not a date' }, SA);
  const gone = A.newToken();
  await wd.insert('ExpoSessions', { token: gone, username: 'nobody', desk: '', expires: new Date(Date.now() + 1e7).toISOString() }, SA);
  for (const t of [old, nan, gone]) await refused(WV.wvOverview({ token: t, ev: EVA }), 'not_logged_in', 'V1 a session that has run out, has no date or belongs to nobody is not a login');
  for (const u of ['boss', 'dir2', 'lead1']) {
    const got = await err(call('wvOverview', u, { ev: EVA }));
    ok(got === '', 'V1 an admin, a director and a lead can open the screen' + (got ? ' [got ' + got + ']' : ''));
  }
  for (const u of ['boss', 'dir2', 'lead1']) {
    for (const m of ['wvList', 'wvRecords']) {
      const got = await err(call(m, u, ARGS[m]));
      ok(got === '', 'V1 ' + u + ' can look: ' + m + (got ? ' [got ' + got + ']' : ''));
    }
  }
  await refused(WV.wvOverview({ token: TOK.boss }), 'no_event', 'V1 a race is needed');
  for (const ev of ['nope', '', null, 5, ['x'], {}]) await refused(WV.wvOverview({ token: TOK.boss, ev }), 'no_event', 'V1 a race that does not exist is refused: ' + JSON.stringify(ev));
  await refused(WV.wvOverview(null), 'not_logged_in', 'V1 no argument at all');
  await refused(WV.wvOverview('x'), 'not_logged_in', 'V1 an argument that is not an object');
}

/* ---------- V2 the overview ---------- */
{
  const o = await call('wvOverview', 'boss', { ev: EVA });
  eq(Object.keys(o).sort(), ['cats', 'counts', 'latest', 'limits', 'me', 'questions', 'race', 'settings', 'starter', 'text', 'versions', 'volunteer', 'words'], 'V2 the overview holds these parts');
  eq([o.me.role, o.latest, o.text, o.versions, o.settings], ['director', 0, null, [], W.defaultSettings()], 'V2 at first: no text, no version, the standard setup');
  eq(o.race, { id: EVA, name: 'Waiver Run A', date: RD, venue: 'Beach Road b' }, 'V2 the race, with the markup of its venue taken out');
  eq(o.cats, ['10 K', '21 K'], 'V2 the categories of the race');
  eq([o.starter.title, o.starter.text], [W.STARTER_TITLE, W.STARTER_TEXT], 'V2 the standard wording is offered');
  eq(o.volunteer, { ver: 1, title: 'Volunteer waiver', text: W.volunteerWaiverText('Waiver Run A') }, 'V2 the volunteer waiver is shown, fixed');
  eq(o.words, ['race', 'date', 'venue', 'name', 'bib', 'cat'], 'V2 the words a text may use');
  eq(o.questions.map((q) => [q.name, q.count]), [['Gender', 8], ['I agree to the waiver', 5]], 'V2 the questions of the registration form, with how many answered (paid or not)');
  eq([o.counts.runners.total, o.counts.runners.none, o.counts.runners.signed, o.counts.volunteers.total, o.counts.volunteers.signed, o.counts.volunteers.none, o.counts.volunteers.by], [8, 8, 0, 3, 1, 2, { online: 1 }], 'V2 paid runners and volunteers who are not declined, and where they stand');
  ok(!LEAK.test(JSON.stringify(o)) && !/Asha Rao|Chitra/.test(JSON.stringify(o)), 'V2 the overview holds no name, phone number or address of a person');
  ok(!JSON.stringify(o).includes('"Yes"') && !JSON.stringify(o).includes('yes.'), 'V2 and no answer of the form');
  const l = await call('wvOverview', 'lead1', { ev: EVA });
  eq(JSON.stringify(Object.assign({}, l, { me: 0 })), JSON.stringify(Object.assign({}, o, { me: 0 })), 'V2 a lead sees the same');
  eq(l.me.role, 'lead', 'V2 and is told they are a lead');
}

/* ---------- V3 the text ---------- */
{
  await refused(call('wvText', 'boss', { ev: EVA }), 'wv_none', 'V3 before a text is saved there is none to show');
  let before = snap();
  const BAD = [
    [{ title: '', text: T1.text }, 'wv_bad_text'], [{ title: 'T', text: 'short' }, 'wv_bad_text'], [{ title: 'T', text: 5 }, 'wv_bad_text'], [{ title: ['T'], text: T1.text }, 'wv_bad_text'], [{ title: 'T', text: 'x'.repeat(8001) }, 'wv_too_long'], [{ title: 'T'.repeat(81), text: T1.text }, 'wv_too_long'],
    [{ title: 'T', text: 'You give me your {phone} number, which is not allowed here.' }, 'wv_placeholder'], [{ title: 'T {email}', text: T1.text }, 'wv_placeholder'],
  ];
  for (const [b, code] of BAD) await refused(call('wvSaveText', 'boss', Object.assign({ ev: EVA, base: 0 }, b)), code, 'V3 a bad text is refused: ' + JSON.stringify(b).slice(0, 70));
  for (const base of [undefined, -1, 1.5, '0', null, 10000, [0], {}]) await refused(call('wvSaveText', 'boss', Object.assign({ ev: EVA, base }, T1)), 'wv_bad_version', 'V3 the version the screen showed must be a whole number: ' + JSON.stringify(base));
  await refused(call('wvSaveText', 'boss', Object.assign({ ev: EVA, base: 1 }, T1)), 'wv_stale', 'V3 a text saved on top of a version that does not exist is out of date');
  eq(snap(), before, 'V3 nothing was written by a refused save');
  const s1 = await call('wvSaveText', 'dir2', Object.assign({ ev: EVA, base: 0 }, T1));
  eq(s1, { ver: 1, title: T1.title, text: T1.text }, 'V3 the first save is version 1');
  await refused(call('wvSaveText', 'boss', Object.assign({ ev: EVA, base: 0 }, T2)), 'wv_stale', 'V3 a screen that did not see version 1 cannot save over it');
  await refused(call('wvSaveText', 'boss', Object.assign({ ev: EVA, base: 1 }, T1)), 'wv_same', 'V3 the same text again is not a new version');
  const s2 = await call('wvSaveText', 'boss', Object.assign({ ev: EVA, base: 1 }, T2));
  eq([s2.ver, s2.title], [2, T2.title], 'V3 a change is version 2');
  const o = await call('wvOverview', 'lead1', { ev: EVA });
  eq([o.latest, o.versions.map((v) => [v.ver, v.title, v.by, v.chars]), o.text.ver, o.text.text === T2.text], [2, [[1, T1.title, 'dir2', T1.text.length], [2, T2.title, 'boss', T2.text.length]], 2, true], 'V3 the overview lists both versions (without their text) and the latest in full');
  eq(await call('wvText', 'lead1', { ev: EVA, ver: 1 }), { ver: 1, title: T1.title, text: T1.text, by: 'dir2', at: o.versions[0].at }, 'V3 version 1 is still exactly as it was saved');
  eq((await call('wvText', 'lead1', { ev: EVA })).ver, 2, 'V3 with no number the latest is shown');
  await refused(call('wvText', 'boss', { ev: EVA, ver: 9 }), 'wv_no_item', 'V3 a version that does not exist');
  for (const ver of [0, -1, 1.5, '1', null, 10000, [1], {}]) await refused(call('wvText', 'boss', { ev: EVA, ver }), 'wv_bad_version', 'V3 a version number must be a whole number: ' + JSON.stringify(ver));
  eq(rows('RDWaivers').filter((r) => r.kind === 'ver' && r.event === EVA).map((r) => r._id).sort(), [W.ids.ver(EVA, 1), W.ids.ver(EVA, 2)], 'V3 each version is its own row, with its number in the row id');
  eq(rows('RDAudit').filter((r) => r.action === 'waiver text saved').map((r) => [r.by, r.detail]), [['dir2', 'version 1, ' + T1.text.length + ' characters'], ['boss', 'version 2, ' + T2.text.length + ' characters']], 'V3 each save is noted (who, which version), without the text');
  // two screens save at the same moment: one version is made, the other is told it is out of date
  const T3 = { title: 'Waiver for {race} (3rd)', text: 'I agree to take part in {race} on {date} at {venue} at my own risk, third wording. I am {name}, bib {bib}, {cat}.' };
  const T3b = { title: 'Waiver for {race} (3rd b)', text: 'I agree to take part in {race} on {date} at {venue} at my own risk, other third wording. I am {name}, bib {bib}, {cat}.' };
  const both = await Promise.all([err(call('wvSaveText', 'boss', Object.assign({ ev: EVA, base: 2 }, T3))), err(call('wvSaveText', 'dir2', Object.assign({ ev: EVA, base: 2 }, T3b)))]);
  eq(both.slice().sort(), ['', 'wv_stale'], 'V3 two saves at the same moment: one version is made, the other is told it is out of date');
  eq(rows('RDWaivers').filter((r) => r.kind === 'ver' && r.event === EVA).length, 3, 'V3 and there are three versions, not four');
  // the limit
  for (let n = 1; n <= 60; n++) await realInsert.call(wd, 'RDWaivers', { _id: W.ids.ver(EVC, n), event: EVC, kind: 'ver', ref: String(n), sub: '', who: '', status: '', why: '', json: JSON.stringify({ title: 'V' + n, text: 'The text of version number ' + n + ', long enough.' }), by: 'boss', at: new Date().toISOString() }, SA);
  await refused(call('wvSaveText', 'boss', Object.assign({ ev: EVC, base: 60 }, T1)), 'wv_too_many', 'V3 there is room for 60 versions');
}

/* ---------- V4 the setup ---------- */
{
  // the tests below need two versions: the third was made in V3 to test two saves at once, so it is the latest. A setup can name up to it.
  const o0 = await call('wvOverview', 'boss', { ev: EVA });
  eq(o0.latest, 3, 'V4 three versions are saved');
  const before = snap();
  const BAD = [{ question: 5 }, { question: '<>' }, { accept: 'yes' }, { accept: [] }, { accept: [5] }, { accept: ['  '] }, { accept: new Array(13).fill('a').map((x, i) => x + i) }, { formVersion: 4 }, { minVersion: 4 }, { formVersion: 0 }, { minVersion: 1.5 }, { formVersion: '1' }];
  for (const b of BAD) await refused(call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET, b)), 'wv_bad_settings', 'V4 a bad setup is refused: ' + JSON.stringify(b));
  for (const k of ['question', 'accept', 'formVersion', 'minVersion']) {
    const a = Object.assign({ ev: EVA }, SET);
    delete a[k];
    await refused(call('wvSaveSettings', 'boss', a), 'wv_bad_settings', 'V4 all four parts must be sent (' + k + ' is missing)');
  }
  eq(snap(), before, 'V4 nothing was written by a refused setup');
  const s = await call('wvSaveSettings', 'dir2', Object.assign({ ev: EVA }, SET));
  eq(s.settings, { question: Q, accept: ['yes', 'i agree'], formVersion: 1, minVersion: 1 }, 'V4 the setup is saved, the answers in a plain way');
  eq((await call('wvOverview', 'lead1', { ev: EVA })).settings, s.settings, 'V4 and read back');
  eq(rows('RDWaivers').filter((r) => r.kind === 'set' && r.event === EVA).length, 1, 'V4 one row holds the setup');
  const s2 = await call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET, { accept: ['Yes', 'I agree', 'ok'] }));
  eq(s2.settings.accept, ['yes', 'i agree', 'ok'], 'V4 a change replaces the setup');
  eq(rows('RDWaivers').filter((r) => r.kind === 'set' && r.event === EVA).length, 1, 'V4 and there is still one row');
  await call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET));
  eq(rows('RDAudit').filter((r) => r.action === 'waiver settings saved').length, 3, 'V4 each save of the setup is noted');
  ok(!rows('RDAudit').some((r) => r.action === 'waiver settings saved' && /i agree/.test(JSON.stringify(r))), 'V4 the note says how many answers, not which');
  // who has signed on the form
  eq(bibsOf(await list('boss', { filter: 'signed' })), ['101', '102', '105'], 'V4 runners who gave an accepted answer have signed (any case, with or without a full stop); the unpaid one is not asked');
  eq(bibsOf(await list('boss', { filter: 'todo' })), ['103', '104', '106', '107'], 'V4 the others have not, whether they said no, gave no answer or had no form');
  const c = (await call('wvOverview', 'boss', { ev: EVA })).counts.runners;
  eq([c.total, c.signed, c.none, c.by, c.cats.map((x) => [x.cat, x.total, x.signed, x.none])], [8, 3, 5, { form: 3 }, [['10 K', 6, 2, 4], ['21 K', 2, 1, 1]]], 'V4 the counts, in all and per category');
  const l = await state('101');
  eq([l.state, l.ver, l.how, l.at], ['signed', 1, 'form', '2027-01-05T08:00:00.000Z'], 'V4 a signature on the form is of the version the form shows, from the day of the registration');
}

/* ---------- V5 the list ---------- */
{
  for (let i = 0; i < 130; i++) await reg(EVP, { bib: String(1000 + i), name: 'Runner ' + (1000 + i), ans: i % 2 ? 'yes' : '', email: 'r' + i + '@example.com', phone: '98123' + String(i).padStart(5, '0') });
  await call('wvSaveSettings', 'boss', { ev: EVP, question: Q, accept: ['yes'], formVersion: 1, minVersion: 1 });
  const p1 = await call('wvList', 'lead1', { ev: EVP, who: 'runners', filter: 'all' });
  eq([p1.items.length, p1.next, p1.total, p1.from], [100, 100, 130, 0], 'V5 a page is 100 people, with where the next starts');
  const p2 = await call('wvList', 'lead1', { ev: EVP, who: 'runners', filter: 'all', from: 100 });
  eq([p2.items.length, p2.next, p2.total, p2.items[0].bib], [30, null, 130, '1100'], 'V5 the last page has the rest and no next');
  const p3 = await call('wvList', 'lead1', { ev: EVP, who: 'runners', filter: 'all', from: 130 });
  eq([p3.items.length, p3.next], [0, null], 'V5 past the end there is nobody');
  eq((await call('wvList', 'boss', { ev: EVP, who: 'runners', filter: 'signed' })).total, 65, 'V5 half of them have signed');
  eq((await call('wvList', 'boss', { ev: EVP, who: 'runners', filter: 'todo', from: 50 })).items.length, 15, 'V5 and the filter is applied before the page is cut');
  for (const from of [-1, 1.5, '5', 1000001, NaN, [0], {}]) await refused(call('wvList', 'boss', { ev: EVP, who: 'runners', from }), 'wv_bad_from', 'V5 a place in the list must be a whole number up to a million: ' + JSON.stringify(from));
  for (const who of [undefined, 'runner', 'ALL', '', 5, ['runners'], null]) await refused(call('wvList', 'boss', { ev: EVA, who }), 'wv_bad_who', 'V5 runners or volunteers: ' + JSON.stringify(who));
  for (const filter of ['signed ', 'unsigned', '', 5, null, ['all']]) await refused(call('wvList', 'boss', { ev: EVA, who: 'runners', filter }), 'wv_bad_filter', 'V5 a filter that is not one of the five: ' + JSON.stringify(filter));
  for (const cat of ['5 K', 5, ['10 K'], 'x'.repeat(100)]) await refused(call('wvList', 'boss', { ev: EVA, who: 'runners', cat }), 'wv_bad_cat', 'V5 a category that is not in the race: ' + String(JSON.stringify(cat)).slice(0, 30));
  await refused(call('wvList', 'boss', { ev: EVA, who: 'volunteers', cat: '10 K' }), 'wv_bad_cat', 'V5 volunteers have no categories');
  for (const q of [5, ['a'], {}, 'x'.repeat(81)]) await refused(call('wvList', 'boss', { ev: EVA, who: 'runners', q }), 'wv_bad_query', 'V5 a search must be up to 80 characters of text: ' + String(JSON.stringify(q)).slice(0, 30));
  eq(namesOf(await list('boss', { filter: 'all', cat: '21K' })), ['Esha Nair', 'Farah Khan'], 'V5 by category, however it is written');
  eq(namesOf(await list('boss', { filter: 'all', q: 'rao' })), ['Asha Rao', 'BINA RAO'], 'V5 by part of a name');
  eq(namesOf(await list('boss', { filter: 'all', q: '103' })), ['Chitra Devi'], 'V5 by bib');
  eq(namesOf(await list('boss', { filter: 'all', q: '' })).length, 8, 'V5 an empty search is everyone');
  const all = await list('boss', { filter: 'all' });
  eq(all.items.map((l) => l.bib), ['101', '102', '103', '104', '105', '106', '107', ''], 'V5 in bib order, the runner with no bib last');
  ok(!all.items.some((l) => l.name === 'Unpaid Uma'), 'V5 a runner who has not paid is not asked');
  ok(!LEAK.test(JSON.stringify(all)) && all.items.every((l) => Object.keys(l).sort().join() === 'at,bib,cat,how,id,name,state,ver'), 'V5 a line has a name, a bib, a category and where the person stands, nothing of the registration');
  ok(all.items.find((l) => l.bib === '107').name === '<img src=x onerror=1>Eve', 'V5 a name is passed on as it was typed (the screen shows it as text)');
  const v = await list('boss', { who: 'volunteers', filter: 'all' });
  eq(v.items.map((l) => [l.name, l.vstatus, l.state, l.how]), [['Vol Four', 'approved', 'none', ''], ['Vol One', 'approved', 'signed', 'online'], ['Vol Two', 'applied', 'none', '']], 'V5 volunteers who are not declined, by name, with their status and whether they signed on the sign-up page');
  ok(!LEAK.test(JSON.stringify(v)), 'V5 no phone number or address of a volunteer');
  eq((await list('boss', { who: 'volunteers', filter: 'signed' })).items.map((l) => l.name), ['Vol One'], 'V5 volunteers who signed');
  const b = await call('wvList', 'boss', { ev: EVB, who: 'runners', filter: 'all' });
  eq([b.total, b.items.map((l) => l.name)], [1, ['Other Race Olga']], 'V5 another race has its own people');
}

/* ---------- V6 papers recorded on the day ---------- */
let REC103;
{
  const rec = (who, a) => call('wvRecord', who, Object.assign({ ev: EVA, who: 'runners', ver: 1 }, a));
  const r1 = await rec('lead1', { ids: [ID('103')], note: 'signed at the desk' });
  eq(r1, { recorded: 1, already: 0, unknown: 0, full: 0, left: [] }, 'V6 a lead records a paper');
  const s = await state('103');
  eq([s.state, s.ver, s.how], ['signed', 1, 'paper'], 'V6 and the runner has signed');
  const rr = await call('wvRecords', 'boss', { ev: EVA, who: 'runners', id: ID('103') });
  eq(rr.records.map((x) => [x.ver, x.how, x.note, x.by, x.void]), [[1, 'paper', 'signed at the desk', 'lead1', null]], 'V6 the record says the version, how, the note and who made it');
  REC103 = rr.records[0].id;
  eq(REC103, W.ids.sig(EVA, 'runner', ID('103'), 1), 'V6 its row id holds the person and the number');
  eq(rr.person.state, 'signed', 'V6 the person is shown with where they stand');
  eq(await rec('lead1', { ids: [ID('103')] }), { recorded: 0, already: 1, unknown: 0, full: 0, left: [] }, 'V6 recording the same paper again changes nothing');
  eq(sigRows(EVA, ID('103')).length, 1, 'V6 there is still one record');
  eq(await rec('boss', { ids: [ID('101')] }), { recorded: 0, already: 1, unknown: 0, full: 0, left: [] }, 'V6 a runner who has signed on the form is left as they are');
  // people who cannot be recorded
  const mixed = await rec('lead1', { ids: [ID('104'), regId(EVB, '101'), 'REG~nothing', ID('111'), ID('107'), VID(1), ID('104')] });
  eq(mixed, { recorded: 2, already: 0, unknown: 4, full: 0, left: [] }, 'V6 a runner of another race, a made-up id, an unpaid runner and a volunteer are counted and left out; a name given twice is recorded once');
  eq(sigRows(EVB).length, 0, 'V6 nothing was recorded in the other race');
  const n = await rec('lead1', { ids: [ID('106')], note: 'a<b>c' + ' '.repeat(20) + 'd'.repeat(150) });
  eq(n.recorded, 1, 'V6 a note with markup and spaces is accepted');
  const note = sigRows(EVA, ID('106'))[0].why;
  ok(note.length === 100 && note.startsWith('abc') && !/[<>]/.test(note), 'V6 and is stored without markup and cut to 100 characters');
  eq((await call('wvRecords', 'boss', { ev: EVA, who: 'runners', id: ID('106') })).records[0].note, note, 'V6 (and shown so)');
  // what is refused
  const before = snap();
  for (const ver of [undefined, 0, 4, 1.5, '1', null, [1], -1]) await refused(rec('lead1', { ids: [ID('105')], ver }), 'wv_bad_version', 'V6 a runner\'s paper is for a saved version: ' + JSON.stringify(ver));
  for (const ids of [undefined, [], 'x', [5], [''], [null], ['x'.repeat(121)], new Array(101).fill('a'), {}, ID('101')]) await refused(rec('lead1', { ids }), 'wv_bad_ids', 'V6 one to 100 ids, each a text: ' + String(JSON.stringify(ids)).slice(0, 40));
  for (const note2 of [5, ['x'], {}, 'x'.repeat(301)]) await refused(rec('lead1', { ids: [ID('105')], note: note2 }), 'wv_bad_note', 'V6 a note is up to 300 characters of text: ' + String(JSON.stringify(note2)).slice(0, 30));
  for (const who of [undefined, 'runner', 5]) await refused(call('wvRecord', 'lead1', { ev: EVA, who, ids: [ID('105')], ver: 1 }), 'wv_bad_who', 'V6 runners or volunteers: ' + JSON.stringify(who));
  eq(snap(), before, 'V6 nothing was written by any of those');
  // volunteers: the volunteer waiver, always version 1
  eq(await call('wvRecord', 'lead1', { ev: EVA, who: 'volunteers', ids: [VID(2), VID(3), ID('101')] }), { recorded: 1, already: 0, unknown: 2, full: 0, left: [] }, 'V6 a paper for a volunteer (the version is the volunteer waiver\'s); a declined volunteer and a runner are left out');
  eq((await list('boss', { who: 'volunteers', filter: 'signed' })).items.map((l) => [l.name, l.how]), [['Vol One', 'online'], ['Vol Two', 'paper']], 'V6 and the volunteer has signed');
  await refused(call('wvRecord', 'lead1', { ev: EVA, who: 'volunteers', ids: [VID(4)], ver: 2 }), 'wv_bad_version', 'V6 a volunteer paper cannot be for another version');
  eq((await call('wvRecord', 'lead1', { ev: EVA, who: 'volunteers', ids: [VID(4)], ver: 1 })).recorded, 1, 'V6 (version 1 may be named)');
  eq(await call('wvRecord', 'lead1', { ev: EVA, who: 'volunteers', ids: [VID(1)] }), { recorded: 0, already: 1, unknown: 0, full: 0, left: [] }, 'V6 a volunteer who signed on the sign-up page is left as they are');
  // after all this only Nina has not signed
  eq(namesOf(await list('boss', { filter: 'todo' })), ['Nina Nobib'], 'V6 only one runner is left to sign');
  // the lowest version that counts
  await call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET, { minVersion: 2 }));
  eq(bibsOf(await list('boss', { filter: 'older' })), ['101', '102', '103', '104', '105', '106', '107'], 'V6 when version 2 is the lowest that counts, everybody who signed version 1 is "older"');
  eq(namesOf(await list('boss', { filter: 'todo' })).length, 8, 'V6 and has to sign again');
  await refused(rec('lead1', { ids: [ID('101')], ver: 1 }), 'wv_bad_version', 'V6 a paper for a version below the lowest that counts is refused');
  eq((await rec('lead1', { ids: [ID('101')], ver: 2 })).recorded, 1, 'V6 a paper for version 2 is recorded');
  eq(bibsOf(await list('boss', { filter: 'signed' })), ['101'], 'V6 and that runner has signed');
  const got2 = await call('wvRecords', 'boss', { ev: EVA, who: 'runners', id: ID('101') });
  eq(got2.records.map((x) => [x.ver, x.how]), [[2, 'paper']], 'V6 (the signature on the form is not listed as a record)');
  eq((await state('101')).ver, 2, 'V6 the best signature is shown');
  await call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET));
  eq(bibsOf(await list('boss', { filter: 'signed' })), ['101', '102', '103', '104', '105', '106', '107'], 'V6 with version 1 counting again, they have all signed');
  // ... a person can have 9 records, no more
  const P9 = ID('nina');
  for (let i = 1; i <= 9; i++) await realInsert.call(wd, 'RDWaivers', { _id: W.ids.sig(EVA, 'runner', P9, i), event: EVA, kind: 'sig', ref: P9, sub: 'runner', who: 'paper', status: '', why: '', json: JSON.stringify({ ver: 1 }), by: 'boss', at: '2027-01-0' + i + 'T10:00:00.000Z' }, SA);
  for (let i = 1; i <= 9; i++) await realInsert.call(wd, 'RDWaivers', { _id: W.ids.vd(W.ids.sig(EVA, 'runner', P9, i)), event: EVA, kind: 'vd', ref: W.ids.sig(EVA, 'runner', P9, i), sub: '', who: '', status: '', why: 'test', json: '', by: 'boss', at: '2027-01-10T10:00:00.000Z' }, SA);
  eq(await rec('lead1', { ids: [P9] }), { recorded: 0, already: 0, unknown: 0, full: 1, left: [] }, 'V6 a person can have nine records (voided ones count), no more');
  eq((await state('nina')).state, 'none', 'V6 (nine voided records leave them not signed)');
  // two screens record the same paper at the same moment
  await reg(EVA, { key: 'race', bib: '150', name: 'Race Runner', ans: '', email: 'race@example.com', phone: '9812300150' });
  const racers2 = await Promise.all(new Array(8).fill(0).map((_, i) => rec(['boss', 'dir2', 'lead1'][i % 3], { ids: [regId(EVA, 'race')] })));
  eq([racers2.reduce((n, r) => n + r.recorded, 0), racers2.reduce((n, r) => n + r.already, 0), sigRows(EVA, regId(EVA, 'race')).length], [1, 7, 1], 'V6 eight calls at the same moment for the same person make one record');
  // a call that runs out of time hands back the people not done yet
  const ids20 = [];
  for (let i = 0; i < 20; i++) {
    await reg(EVA, { key: 'slow' + i, bib: String(500 + i), name: 'Slow ' + i, ans: '', email: 'slow' + i + '@example.com', phone: '98123' + String(60000 + i) });
    ids20.push(regId(EVA, 'slow' + i));
  }
  slow = 4000;
  const first = await rec('boss', { ids: ids20 });
  slow = 0;
  skew = 0;
  ok(first.recorded === 5 && first.left.length === 15 && first.already === 0, 'V6 a call that takes too long stops and hands back the people it did not do (' + first.recorded + ' recorded, ' + first.left.length + ' left)');
  const second = await rec('boss', { ids: first.left.concat(ids20.slice(0, 5)) });
  eq([second.recorded, second.already, second.left.length], [15, 5, 0], 'V6 sending them again records the rest and leaves the first five alone');
  eq(ids20.map((id) => sigRows(EVA, id).length).join(''), '1'.repeat(20), 'V6 each of the twenty has exactly one record');
  const aud = rows('RDAudit').filter((r) => r.action === 'waiver papers recorded');
  ok(aud.length >= 5 && !LEAK.test(JSON.stringify(aud)) && !/Asha|Chitra|Slow 1/.test(JSON.stringify(aud)) && aud.every((r) => /version \d|: \d+ recorded/.test(r.detail)), 'V6 the notes say how many, never who, and the note typed is not copied');
}

/* ---------- V7 a mistake ---------- */
{
  const bad = (a) => call('wvVoid', 'boss', Object.assign({ ev: EVA, id: REC103, reason: 'wrong person' }, a));
  await refused(call('wvVoid', 'lead1', { ev: EVA, id: REC103, reason: 'wrong person' }), 'director_only', 'V7 only a director can mark a record as a mistake');
  for (const reason of [undefined, '', '   ', '<>', 5, ['x'], {}, 'x'.repeat(301)]) await refused(bad({ reason }), 'wv_bad_reason', 'V7 a reason is needed: ' + JSON.stringify(reason));
  for (const id of [undefined, '', 5, ['x'], {}, 'x'.repeat(121)]) await refused(bad({ id }), 'wv_bad_id', 'V7 the record must be named: ' + JSON.stringify(id));
  for (const id of ['nothing', W.ids.ver(EVA, 1), W.ids.set(EVA), W.ids.sig(EVA, 'runner', 'nobody', 1), W.ids.vd(REC103)]) await refused(bad({ id }), 'wv_no_item', 'V7 only a paper that was recorded can be marked: ' + id.slice(0, 30));
  const rowBefore = JSON.stringify(rows('RDWaivers').find((r) => r._id === REC103));
  eq(await bad({ reason: ' wrong <b>person</b> ' }), { voided: true }, 'V7 a director marks a record as a mistake');
  const rr = await call('wvRecords', 'lead1', { ev: EVA, who: 'runners', id: ID('103') });
  eq(rr.records.map((x) => [x.id, x.void && x.void.by, x.void && x.void.reason]), [[REC103, 'boss', 'wrong bperson/b']], 'V7 the record stays, marked with who and why (markup taken out)');
  eq(JSON.stringify(rows('RDWaivers').find((r) => r._id === REC103)), rowBefore, 'V7 the record itself was not changed');
  eq((await state('103')).state, 'none', 'V7 and the runner has not signed again');
  await refused(bad({}), 'wv_voided', 'V7 a record can be marked once');
  const again = await call('wvRecord', 'lead1', { ev: EVA, who: 'runners', ids: [ID('103')], ver: 1 });
  eq(again.recorded, 1, 'V7 the paper can be recorded again');
  eq(sigRows(EVA, ID('103')).map((r) => r._id.slice(-2)).sort(), ['01', '02'], 'V7 as record number 2');
  eq((await state('103')).state, 'signed', 'V7 and the runner has signed again');
  const second = sigRows(EVA, ID('103')).find((r) => r._id.endsWith('02'))._id;
  const both = await Promise.all([err(call('wvVoid', 'boss', { ev: EVA, id: second, reason: 'one' })), err(call('wvVoid', 'dir2', { ev: EVA, id: second, reason: 'two' }))]);
  eq(both.slice().sort(), ['', 'wv_voided'], 'V7 two directors marking the same record at the same moment: one does it, the other is told it was done');
  eq(rows('RDWaivers').filter((r) => r.kind === 'vd' && r.ref === second).length, 1, 'V7 there is one mark');
  eq((await state('103')).state, 'none', 'V7 runner 103 is left not signed (for the papers below)');
  const aud = rows('RDAudit').filter((r) => r.action === 'waiver record voided');
  ok(aud.length === 2 && !LEAK.test(JSON.stringify(aud)) && aud.every((r) => !/wrong|person|one|two/.test(r.detail)), 'V7 each mark is noted without the reason or any name');
  await refused(call('wvVoid', 'boss', { ev: EVB, id: second, reason: 'other race' }), 'wv_no_item', 'V7 a record of one race cannot be marked from another');
}

/* ---------- V8 papers to print ---------- */
{
  const sheet = (a, who) => call('wvSheet', who || 'lead1', Object.assign({ ev: EVA, who: 'runners', mode: 'forms', scope: 'todo' }, a));
  const pages = (html) => (html.match(/class="wf"/g) || []).length;
  const o = await sheet({});
  eq([o.count, o.total, o.next, o.from, o.ver], [2, 2, null, 0, 3], 'V8 a page for each runner who has to sign (103 and Nina), with the latest version');
  ok(/^<!DOCTYPE html>/.test(o.head) && /<title>Waiver for Waiver Run A \(3rd( b)?\)<\/title>/.test(o.head), 'V8 the head is the page around the papers, with the title of the waiver and the race filled in');
  ok(!/<\/?(html|body)/.test(o.body) && pages(o.body) === 2, 'V8 the body holds only the pages');
  ok(/Chitra Devi/.test(o.body) && /Nina Nobib/.test(o.body) && !/Asha Rao/.test(o.body), 'V8 the papers are for the people who still have to sign');
  ok(/I agree to take part in Waiver Run A on /.test(o.body) && /at Beach Road/.test(o.body) && !/Beach Road <b>/.test(o.body) && /bib 103, 10 K/.test(o.body), 'V8 the race and the person are filled in');
  ok(!LEAK.test(o.body) && !/chitra@|9812300103/.test(o.body), 'V8 a paper carries no phone number or address');
  eq((await sheet({ scope: 'all' })).count, 29, 'V8 everyone (the 29 runners who have paid)');
  eq((await sheet({ scope: 'all', cat: '21 K' })).count, 2, 'V8 one category');
  const one = await sheet({ scope: 'one', id: ID('107') });
  ok(one.count === 1 && !/<img/.test(one.body) && /&lt;img src=x onerror=1&gt;Eve/.test(one.body), 'V8 one person\'s paper, a name that is markup shown as text');
  const blank = await sheet({ scope: 'blank', copies: 3 });
  eq([blank.count, blank.total, pages(blank.body), /_{10}/.test(blank.body)], [3, 3, 3, true], 'V8 three blank pages');
  eq(pages((await sheet({ scope: 'blank' })).body), 1, 'V8 one blank page unless more are asked for');
  const lst = await sheet({ mode: 'list', scope: 'all' });
  ok(lst.count === 29 && /By signing next to my name/.test(lst.body) && /<th>Bib<\/th>/.test(lst.body) && /Asha Rao/.test(lst.body) && pages(lst.body) === 0, 'V8 a sign-in list with the waiver on top and a line for each runner');
  // errors
  const before = snap();
  await refused(sheet({ scope: 'one' }), 'wv_bad_id', 'V8 one person needs an id');
  await refused(sheet({ scope: 'one', id: regId(EVB, '101') }), 'wv_no_item', 'V8 a runner of another race');
  await refused(sheet({ scope: 'one', id: ID('111') }), 'wv_no_item', 'V8 a runner who has not paid');
  await refused(sheet({ scope: 'todo', id: ID('101') }), 'wv_bad_id', 'V8 an id only goes with one person');
  await refused(sheet({ mode: 'list', scope: 'one', id: ID('101') }), 'wv_bad_scope', 'V8 a list is not for one person');
  await refused(sheet({ mode: 'list', scope: 'blank' }), 'wv_bad_scope', 'V8 nor blank');
  for (const copies of [0, 51, 1.5, '2', null, [2]]) await refused(sheet({ scope: 'blank', copies }), 'wv_bad_copies', 'V8 copies of a blank paper: 1 to 50: ' + JSON.stringify(copies));
  await refused(sheet({ copies: 2 }), 'wv_bad_copies', 'V8 copies only go with blank pages');
  await refused(sheet({ scope: 'blank', from: 5 }), 'wv_bad_from', 'V8 blank pages come in one piece');
  await refused(sheet({ scope: 'blank', cat: '10 K' }), 'wv_bad_cat', 'V8 a blank page has no category');
  for (const [k, v, code] of [['mode', 'pdf', 'wv_bad_mode'], ['mode', undefined, 'wv_bad_mode'], ['scope', 'everyone', 'wv_bad_scope'], ['scope', undefined, 'wv_bad_scope'], ['who', 'all', 'wv_bad_who'], ['cat', 'x', 'wv_bad_cat'], ['from', -1, 'wv_bad_from']]) await refused(sheet({ [k]: v }), code, 'V8 a wrong ' + k + ': ' + v);
  eq(snap(), before, 'V8 nothing was written by any of those');
  // paging: 130 runners, 30 forms or 120 list lines a time
  await call('wvSaveText', 'boss', Object.assign({ ev: EVP, base: 0 }, T1));
  const pp = (a) => call('wvSheet', 'boss', Object.assign({ ev: EVP, who: 'runners', mode: 'forms', scope: 'all' }, a));
  const seq = [];
  for (let from = 0, g = 0; g < 10; g++) {
    const r = await pp({ from });
    seq.push([r.count, r.next, r.total]);
    if (r.next === null) break;
    from = r.next;
  }
  eq(seq, [[30, 30, 130], [30, 60, 130], [30, 90, 130], [30, 120, 130], [10, null, 130]], 'V8 forms come 30 pages at a time');
  const ls = [];
  for (let from = 0, g = 0; g < 10; g++) {
    const r = await pp({ mode: 'list', from });
    ls.push([r.count, r.next, /By signing next to my name/.test(r.body)]);
    if (r.next === null) break;
    from = r.next;
  }
  eq(ls, [[120, 120, true], [10, null, false]], 'V8 a list comes 120 lines at a time, the waiver only in the first piece');
  const printed = rows('RDAudit').filter((r) => r.action === 'waiver papers printed');
  eq(printed.filter((r) => r.target === 'Waiver Run P big').map((r) => r.detail), ['runners forms all: 130', 'runners list all: 130'], 'V8 printing is noted once for a whole job, not for each piece');
  ok(!LEAK.test(JSON.stringify(printed)) && printed.every((r) => !/Chitra|Nina|Asha/.test(r.detail)), 'V8 the note holds counts, no names');
  // a race with no saved text cannot print a runner's paper; volunteers have a fixed text
  await refused(call('wvSheet', 'boss', { ev: EVB, who: 'runners', mode: 'forms', scope: 'all' }), 'wv_none', 'V8 save the waiver text before printing runners\' papers');
  const vp = await call('wvSheet', 'boss', { ev: EVB, who: 'volunteers', mode: 'forms', scope: 'all' });
  ok(vp.count === 1 && vp.ver === 1 && /I volunteer at Waiver Run B of my own choice/.test(vp.body) && /Vol Other/.test(vp.body) && !/Bib:/.test(vp.body), 'V8 volunteers get the volunteer waiver, version 1, with a name only');
  const vl = await call('wvSheet', 'boss', { ev: EVA, who: 'volunteers', mode: 'list', scope: 'todo' });
  eq([vl.count, /Vol Two/.test(vl.body), /Vol One/.test(vl.body)], [0, false, false], 'V8 every volunteer has signed by now, so a list of those who still need to has no one');
  // "still to sign" includes those who signed only an older version
  await call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET, { minVersion: 2 }));
  const older = await sheet({});
  eq(older.count, 28, 'V8 papers for those who signed an older version too (everyone but 101, who signed version 2)');
  await call('wvSaveSettings', 'boss', Object.assign({ ev: EVA }, SET));
}

/* ---------- V9 messages ---------- */
{
  const aud = (o) => CM.cmAudience({ token: TOK.boss, ev: EVA, aud: Object.assign({ who: 'runners' }, o) });
  const un = await aud({ waiver: 'unsigned' });
  eq([un.total, un.sample.map((s) => s.name).sort()], [2, ['Chitra Devi', 'Nina Nobib']], 'V9 a message can go to the runners who have not signed');
  ok(/waiver not signed/.test(un.label), 'V9 and the audience says so');
  const sg = await aud({ waiver: 'signed' });
  eq(sg.total, 27, 'V9 or to those who have');
  eq((await aud({})).total, 29, 'V9 without a choice, to all of them');
  eq((await aud({ waiver: 'any' })).total, 29, 'V9 "any" is the same');
  await refused(aud({ waiver: 'maybe' }), 'bad_audience', 'V9 any other choice is refused');
  const vu = await CM.cmAudience({ token: TOK.boss, ev: EVA, aud: { who: 'volunteers', vstatus: 'approved', waiver: 'unsigned' } });
  eq(vu.total, 0, 'V9 volunteers: all approved ones have signed by now');
  const vs = await CM.cmAudience({ token: TOK.boss, ev: EVA, aud: { who: 'volunteers', vstatus: 'applied', waiver: 'signed' } });
  eq(vs.total, 1, 'V9 and the one who applied signed on paper');
  // a batch is frozen when it is prepared
  await CM.cmSaveSettings({ token: TOK.boss, ev: EVA, emailId: 'vtra_mail', nvars: 6, cc: '91', link: 'https://www.vtra.run/x' });
  const key = 'wvk' + Date.now().toString(36);
  const pre = await CM.cmPrepare({ token: TOK.boss, ev: EVA, key, tplId: 'bib', aud: { who: 'runners', waiver: 'unsigned' }, via: 'email' });
  eq(pre.total, 2, 'V9 a batch to the runners who have not signed has them');
  await call('wvRecord', 'lead1', { ev: EVA, who: 'runners', ids: [ID('103')], ver: 1 });
  const again = await CM.cmPrepare({ token: TOK.boss, ev: EVA, key, tplId: 'bib', aud: { who: 'runners', waiver: 'unsigned' }, via: 'email' });
  eq([again.again, again.total], [true, 2], 'V9 and keeps them even after one of them signs');
  ok(/waiver not signed/.test(pre.label), 'V9 the batch says who it is for');
}

/* ---------- V10 the other race ---------- */
{
  const o = await call('wvOverview', 'boss', { ev: EVB });
  eq([o.latest, o.settings, o.counts.runners.total, o.counts.runners.none, o.counts.volunteers.total], [0, W.defaultSettings(), 1, 1, 1], 'V10 another race has no text, no setup and nobody recorded');
  await refused(call('wvText', 'boss', { ev: EVB }), 'wv_none', 'V10 and no text');
  eq((await call('wvRecords', 'boss', { ev: EVA, who: 'runners', id: ID('101') })).person.id, ID('101'), 'V10 control: a runner is found in its own race');
  await refused(call('wvRecords', 'boss', { ev: EVB, who: 'runners', id: ID('101') }), 'wv_no_item', 'V10 but not through another race');
  await refused(call('wvRecords', 'boss', { ev: EVA, who: 'runners', id: regId(EVB, '101') }), 'wv_no_item', 'V10 nor the other way round');
  await refused(call('wvRecords', 'boss', { ev: EVA, who: 'runners', id: ID('111') }), 'wv_no_item', 'V10 a runner who has not paid has no papers');
  await refused(call('wvRecords', 'boss', { ev: EVA, who: 'volunteers', id: VID(3) }), 'wv_no_item', 'V10 nor a declined volunteer');
  await refused(call('wvRecords', 'boss', { ev: EVA, who: 'volunteers', id: ID('101') }), 'wv_no_item', 'V10 a runner is not a volunteer');
  ok(sigRows(EVB).length === 0 && rows('RDWaivers').filter((r) => r.event === EVB).length === 0, 'V10 nothing of the work in the first race is in the second');
}

/* ---------- V11 what is kept ---------- */
{
  const all = rows('RDWaivers');
  ok(all.length > 60, 'V11 there are rows to look at (' + all.length + ')');
  eq([...new Set(all.map((r) => r.kind))].sort(), ['set', 'sig', 'vd', 'ver'], 'V11 four kinds of row: versions, the setup, papers and marks');
  ok(all.every((r) => ['event', 'kind', 'ref', 'sub', 'who', 'status', 'why', 'json', 'by', 'at'].every((k) => typeof r[k] === 'string')), 'V11 each row has the ten text fields');
  const prefix = { ver: 'ver~', set: 'set~', sig: 'sig~', vd: 'vd~' };
  ok(all.every((r) => r._id.startsWith(prefix[r.kind])), 'V11 a row id says what it is');
  const text = JSON.stringify(all.filter((r) => r.kind !== 'ver'));
  ok(!LEAK.test(text) && !/Asha Rao|Chitra Devi|Nina Nobib|Vol One|Dev Raman|Slow \d/.test(text), 'V11 no row holds a name, phone number or address of a person (only the id of the registration)');
  ok(!/Asha Rao|Chitra Devi|@example\.com/.test(JSON.stringify(all.filter((r) => r.kind === 'ver'))), 'V11 and the texts are what the directors typed');
  eq(removes, 0, 'V11 nothing was ever deleted');
  const rawAud = JSON.stringify(rows('RDAudit').filter((r) => /^waiver /.test(r.action)));
  ok(rawAud.length > 100 && !LEAK.test(rawAud), 'V11 the audit notes of all this hold no personal details');
  const sigs = all.filter((r) => r.kind === 'sig');
  ok(sigs.every((r) => r.who === 'paper' && (r.sub === 'runner' || r.sub === 'volunteer') && /^\{"ver":\d+\}$/.test(r.json)), 'V11 a paper is a person of one kind, "paper" and a version');
  eq(sigs.filter((r) => r.by === 'lead1').length > 0 && sigs.filter((r) => r.by === 'boss').length > 0, true, 'V11 and says who recorded it');
}

/* ---------- V12 the volunteer waiver is the one the sign-up page shows ---------- */
{
  const SH = (await R.saveShift({ token: TOK.boss, ev: EVA, role: 'Marshal', location: 'KM 2', date: istDay(70), start: '05:00', end: '08:00', need: 6 })).id;
  const open = await R.openShifts({ ev: EVA });
  eq(open.waiver, W.volunteerWaiverText('Waiver Run A'), 'V12 the text a volunteer agrees to on the sign-up page is the text papers carry');
  const su = await R.volunteerSignup({ ev: EVA, name: 'Fresh Volunteer', phone: '9848099999', email: 'fresh@example.org', club: 'VTRA', shifts: [SH], waiver: true });
  const vrow = rows('RDVolunteers').find((v) => v.event === EVA && v.name === 'Fresh Volunteer');
  eq([W.verNum(vrow.waiverVersion), !!vrow.waiverAt], [W.VOLUNTEER_VERSION, true], 'V12 and the version it records is the volunteer waiver\'s version');
  const l = await list('boss', { who: 'volunteers', filter: 'all', q: 'Fresh' });
  eq(l.items.map((x) => [x.name, x.state, x.how, x.ver]), [['Fresh Volunteer', 'signed', 'online', 1]], 'V12 so a volunteer who signed up online has signed');
  ok(!!su.code, 'V12 (the sign-up worked)');
}

done();
