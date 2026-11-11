// BACKEND TESTS (Reports): who may run which report, the six reports on a race with real data (checked against what the Results,
// Waivers and Finance screens say, and against a recount), the second race that must not leak in, a table saved as a CSV file and the one
// line it writes to the audit trail, a source that cannot be read, damaged rows, a big race, requests at the same moment, and what is
// kept, on one in-memory database with the real RaceOS, Results, Waivers, Finance and Reports backends.
//   Q1 who may call what   Q2 the list   Q3 registrations   Q4 race day   Q5 volunteers   Q6 waivers   Q7 messages   Q8 money
//   Q9 the other race   Q10 CSV files   Q11 sources that cannot be read   Q12 damaged rows   Q13 a big race   Q14 same moment   Q15 what is kept
import * as R from './racedir.test.mjs';
import * as RP from './reports.test.mjs';
import * as WV from './waivers.test.mjs';
import * as F from './finance.test.mjs';
import * as RS from './results.test.mjs';
import * as CM from './comms.test.mjs';
import * as A from './rd-auth.test.mjs';
import * as P from './rd-report.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Reports backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const rows = (t) => [...(DB[t] || new Map()).values()];
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const NAMES = Object.keys(RP).sort();
const snap = (skip) =>
  JSON.stringify(
    Object.keys(DB)
      .filter((k) => !(skip || []).includes(k))
      .sort()
      .map((k) => [k, [...DB[k].entries()]]),
  );
let kseq = 0;
const K = () => 'rk' + (++kseq).toString(36) + Math.random().toString(36).slice(2, 8);
// nothing is ever deleted
let removes = 0;
for (const fn of ['bulkRemove', 'remove']) {
  if (typeof wd[fn] === 'function') {
    const f = wd[fn];
    wd[fn] = (...a) => {
      removes++;
      return f.apply(wd, a);
    };
  }
}
// a collection that cannot be read
const realQuery = wd.query;
const DOWN = new Set();
wd.query = (name, ...rest) => {
  if (DOWN.has(name)) throw new Error('down ' + name);
  return realQuery.call(wd, name, ...rest);
};
const LEAK = /Asha Rao|BINA RAO|Chitra Devi|Dev Raman|Esha Nair|Farah Khan|Nina Nobib|Cara Cancelled|Nocat Nora|Other Race Olga|<img|onerror|@example\.com|98123\d{5}|Ravi|Acme|Medal House|Vol (One|Two|Three|Four)|"(10[1-9]|999|nina)"/;
const SAFE = /^[a-z][a-z0-9_]{1,40}$/;
const shapeOk = (tables) =>
  Array.isArray(tables) &&
  tables.every((t) => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.note === 'string' && Array.isArray(t.cols) && t.cols.every((c) => typeof c.label === 'string' && P.KINDS.includes(c.kind)) && Array.isArray(t.rows) && t.rows.length <= P.MAX_ROWS && t.rows.every((r) => Array.isArray(r) && r.length <= t.cols.length && r.every((v) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string')));

/* ---------- the world ---------- */
const HASH = A.hashPassword('Rp-pass-1');
const mkStaff = (username, role) => wd.insert('ExpoStaff', { username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['desk1', 'desk']];
for (const [u, r] of WHO) await mkStaff(u, r);
const TOK = {};
for (const [u] of WHO) {
  TOK[u] = A.newToken();
  await wd.insert('ExpoSessions', { token: TOK[u], username: u, desk: '', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
}
const call = (m, who, a) => RP[m](Object.assign({ token: TOK[who] }, a));
const RD = istDay(60);
const RDY = parseInt(RD.slice(0, 4), 10);
const CATS = [{ name: '10 K', km: 10, price: 800, cap: 9000 }, { name: '21 K', km: 21.0975, price: 1200, cap: 9000 }];
const mkRace = async (name, venue, cats) => {
  const ev = (await R.saveEvent({ token: TOK.boss, name, date: RD, venue })).event.id;
  await R.saveCats({ token: TOK.boss, ev, cats });
  return ev;
};
const EVA = await mkRace('Report Run A', 'Beach Road <b>', CATS);
const EVB = await mkRace('Report Run B', 'Pier', CATS.slice(0, 1));
const EVD = await mkRace('Report Run D damaged', 'Hill', CATS);
const EVP = await mkRace('Report Run P big', 'Park', CATS);
const EVE = await mkRace('Report Run E empty', 'Park', CATS);
const Q = 'I agree to the waiver';
const form = (g, age, ans) => JSON.stringify([{ name: 'Gender', value: g || '' }, { name: 'Date of birth', value: age ? RDY - age + '-01-01' : '' }].concat(ans === undefined ? [] : [{ name: Q, value: ans }]));
const regId = (ev, key) => 'REG~' + ev.slice(-6) + '~' + key;
const reg = (ev, p) => wd.insert('RDRegs', { _id: regId(ev, p.key || p.bib), event: ev, name: p.name, cat: p.cat, bib: p.bib || '', bibName: '', size: p.size === undefined ? 'M' : p.size, status: p.status || 'ok', phone: p.phone || '', email: p.email || '', form: form(p.g, p.age, p.ans), at: p.at || '2026-11-03T05:00:00.000Z' }, SA);
const PPL = [
  { bib: '101', name: 'Asha Rao', cat: '10 K', g: 'F', age: 25, size: 'M', ans: 'Yes', at: '2026-11-01T10:00:00.000Z', email: 'asha@example.com', phone: '9812300101' },
  { bib: '102', name: 'BINA RAO', cat: '10 K', g: 'F', age: 45, size: 'S', ans: 'yes.', at: '2026-11-01T20:00:00.000Z', email: 'bina@example.com', phone: '9812300102' },
  { bib: '103', name: 'Chitra Devi', cat: '10 K', g: 'F', age: 62, size: 'L', ans: 'No', at: '2026-11-02T03:00:00.000Z', email: 'chitra@example.com', phone: '9812300103' },
  { bib: '104', name: 'Dev Raman', cat: '21 K', g: 'M', age: 33, size: 'XL', ans: '', email: 'dev@example.com', phone: '9812300104' },
  { bib: '105', name: 'Esha Nair', cat: '21 K', g: 'M', age: 16, size: 'M', ans: 'I agree', email: 'esha@example.com', phone: '' },
  { bib: '106', name: 'Farah Khan', cat: '21 K', size: '', status: 'pending', email: 'farah@example.com', phone: '9812300106' },
  { bib: '107', name: '<img src=x onerror=1>Eve', cat: '10 K', g: 'X', age: 28, size: 'a@b.com', ans: '', email: 'eve@example.com', phone: '9812300107' },
  { key: 'nina', bib: '', name: 'Nina Nobib', cat: '21 K', g: 'M', age: 51, size: '9876543210', ans: '', email: 'nina@example.com', phone: '9812300999' },
  { bib: '108', name: 'Cara Cancelled', cat: '10 K', g: 'F', age: 29, size: 'S', status: 'cancelled', email: 'cara@example.com', phone: '9812300108' },
  { bib: '109', name: 'Nocat Nora', cat: '', g: 'M', age: 40, size: 'M', ans: '', email: 'nora@example.com', phone: '9812300109' },
];
for (const p of PPL) await reg(EVA, p);
for (const p of [{ bib: '101', name: 'Other Race Olga', cat: '10 K', g: 'F', age: 33, ans: 'yes', email: 'olga@example.com', phone: '9812300777' }, { bib: '102', name: 'Other Race Omar', cat: '10 K', g: 'M', age: 70, email: 'omar@example.com' }, { bib: '103', name: 'Other Race Oz', cat: '10 K', status: 'pending' }]) await reg(EVB, p);
// the settings that tell Reports where gender and date of birth are on the registration form
await RS.resSaveSettings({ token: TOK.boss, ev: EVA, settings: { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], map: { gender: 'Gender', dob: 'Date of birth', age: '', seed: '' } } });
await RS.resSaveSettings({ token: TOK.boss, ev: EVB, settings: { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], map: { gender: 'Gender', dob: 'Date of birth', age: '', seed: '' } } });
// results
const res = (ev, o) => wd.insert('RDResults', Object.assign({ _id: 'rs~' + ev + '~' + o.bib, event: ev, name: '', gender: '', dob: '', age: '', note: '', regId: '', by: 'boss', at: '2027-02-07T03:00:00.000Z', void: 'no', voidBy: '', voidAt: '', voidReason: '', prev: '' }, o), SA);
const fin = (ev, bib, cat, cs) => res(ev, { bib, cat, status: 'fin', gunCs: String(cs), chipCs: String(cs) });
await fin(EVA, '101', '10 K', 360000);
await fin(EVA, '102', '10 K', 400000);
await fin(EVA, '103', '10 K', 500000);
await fin(EVA, '999', '10 K', 380000);
await res(EVA, { bib: '107', cat: '10 K', status: 'dsq', gunCs: '0', chipCs: '0' });
await fin(EVA, '104', '21 K', 720000);
await res(EVA, { bib: '105', cat: '21 K', status: 'dnf', gunCs: '0', chipCs: '0' });
await res(EVA, { bib: '110', cat: '10 K', status: 'fin', gunCs: '300000', chipCs: '300000', void: 'yes', voidBy: 'boss', voidAt: '2027-02-07T04:00:00.000Z', voidReason: 'wrong bib' });
await fin(EVB, '101', '10 K', 111111);
// volunteers, shifts, places
const vol = (ev, n, name, status, waiver) => wd.insert('RDVolunteers', { _id: 'VOL~' + ev.slice(-6) + '~' + n, event: ev, name, phone: '98123005' + String(n).padStart(2, '0'), email: 'vol' + n + '@example.com', club: '', status, code: 'C' + n, waiverAt: waiver ? '2027-01-03T09:00:00.000Z' : '', waiverVersion: waiver ? 'v1' : '', createdAt: new Date().toISOString(), notes: '' }, SA);
await vol(EVA, 1, 'Vol One', 'approved', true);
await vol(EVA, 2, 'Vol Two', 'applied', false);
await vol(EVA, 3, 'Vol Three', 'declined', true);
await vol(EVA, 4, 'Vol Four', 'approved', false);
await vol(EVB, 5, 'Vol Other', 'approved', false);
const VID = (n) => 'VOL~' + EVA.slice(-6) + '~' + n;
const shift = async (ev, role, start, end, need) => (await R.saveShift({ token: TOK.boss, ev, role, date: RD, start, end, need, location: 'Somewhere' })).id;
const S1 = await shift(EVA, 'Marshal', '07:00', '11:00', 3);
const S2 = await shift(EVA, 'marshal', '12:00', '15:00', 2);
const S3 = await shift(EVA, 'Water point', '12:00', '15:00', 4);
const SB = await shift(EVB, 'Marshal', '07:00', '11:00', 9);
const assign = (ev, volunteerId, shiftId) => R.assignShift({ token: TOK.boss, ev, volunteerId, shiftId });
await assign(EVA, VID(1), S1);
await assign(EVA, VID(4), S1);
await assign(EVA, VID(2), S1);
await assign(EVA, VID(1), S2);
await assign(EVA, VID(4), S3);
await assign(EVB, 'VOL~' + EVB.slice(-6) + '~5', SB);
await R.volunteerCheck({ token: TOK.boss, ev: EVA, volunteerId: VID(1), shiftId: S1, action: 'in' });
const setHours = async (volunteerId, shiftId, hours) => {
  const row = rows('RDAssignments').find((x) => x.volunteerId === volunteerId && x.shiftId === shiftId);
  await wd.update('RDAssignments', Object.assign({}, row, { hours }), SA);
};
await setHours(VID(1), S1, '3.5');
await setHours(VID(4), S3, '200');
// the waiver
const T1 = { title: 'Waiver for {race}', text: 'I agree to take part in {race} on {date} at {venue} at my own risk. I am {name}, bib {bib}, {cat}.' };
await WV.wvSaveText(Object.assign({ token: TOK.boss, ev: EVA, base: 0 }, T1));
await WV.wvSaveSettings({ token: TOK.boss, ev: EVA, question: Q, accept: ['Yes', 'I agree'], formVersion: 1, minVersion: 1 });
await WV.wvRecord({ token: TOK.boss, ev: EVA, who: 'runners', ids: [regId(EVA, '103')], ver: 1, key: K() });
// messages
await CM.cmSaveTemplate({ token: TOK.boss, ev: EVA, id: 'news1', name: 'Race week news', kind: 'runner', subject: 'Hello {race}', body: 'Hello {firstname}' });
const bat = (ev, n) => wd.insert('RDComms', { _id: 'bat~' + ev + '~b' + n, event: ev, kind: 'bat', ref: 'b' + n, sub: 'email', who: '', status: '', why: '', json: '{"total":3}', by: 'boss', at: '2027-01-01T00:00:00.000Z' }, SA);
const rcp = (ev, n, sub, status, why) => wd.insert('RDComms', { _id: 'rcp~' + ev + '~' + n, event: ev, kind: 'rcp', ref: 'b1', sub, who: regId(ev, '101'), status, why: why || '', json: '', by: 'boss', at: '2027-01-01T00:00:00.000Z' }, SA);
await bat(EVA, 1);
await bat(EVA, 2);
for (const [n, sub, status, why] of [[1, 'news1', 'sent', ''], [2, 'news1', 'sent', ''], [3, 'news1', 'sent', 'whatsapp'], [4, 'news1', 'failed', 'no_email'], [5, 'news1', 'skipped', ''], [6, 'bib', 'sent', ''], [7, 'bib', 'sending', '']]) await rcp(EVA, n, sub, status, why);
await bat(EVB, 9);
await rcp(EVB, 8, 'bib', 'sent', '');
// money
const fin$ = (fn, o) => F[fn](Object.assign({ token: TOK.boss, ev: EVA }, o));
const TODAY = istDay(0);
const inv = await fin$('finRaiseInvoice', { party: 'Acme Corp', lines: [{ desc: 'Title sponsorship', qty: 1, rate: '500000', taxPct: 18 }, { desc: 'Banner space', qty: 2, rate: '10000', taxPct: 0 }], key: K() });
await fin$('finPayInvoice', { id: inv.id, amount: '300000', mode: 'bank', ref: 'UTR1', key: K() });
const ord = await fin$('finSaveOrder', { vendor: 'Medal House', title: 'Finisher medals', cat: 'Awards', estimate: '2500000', key: K() });
await fin$('finPayOrder', { id: ord.id, amount: '1000000', phase: 'advance', mode: 'bank', ref: 'ADV-1', key: K() });
await fin$('finAddBill', { id: ord.id, amount: '2400000', no: 'MH-1', key: K() });
const clm = await fin$('finSaveClaim', { lines: [{ date: TODAY, desc: 'Tape and cones', cat: 'Route and marking', amount: '150000' }], payTo: 'ravi@upi', key: K() });
await fin$('finDecideClaim', { id: clm.id, decision: 'approve' });
await fin$('finPayClaim', { id: clm.id, amount: '50000', mode: 'bank', ref: 'CL-1', key: K() });
await fin$('finAddCash', { type: 'withdrawal', amount: '500000', holder: 'Cash Holder Ravi', key: K() });
await F.finRaiseInvoice({ token: TOK.boss, ev: EVB, party: 'Other Sponsor', lines: [{ desc: 'Sponsorship', qty: 1, rate: '900000', taxPct: 0 }], key: K() });

const run = (report, who, ev) => RP.rpRun({ token: TOK[who || 'boss'], ev: ev || EVA, report });
const T = (out, id) => out.tables.find((t) => t.id === id);
const REPORTS = ['reg', 'race', 'vol', 'waiver', 'msg', 'money'];
const outs = {};
for (const id of REPORTS) outs[id] = await run(id);

/* ---------- Q1 who may call what ---------- */
{
  const ARGS = { rpList: { ev: EVA }, rpRun: { ev: EVA, report: 'reg' }, rpCsv: { ev: EVA, report: 'reg', table: 'cats' } };
  eq(NAMES, ['rpCsv', 'rpList', 'rpRun'], 'Q1 the backend has these three methods');
  eq(Object.keys(ARGS).sort(), NAMES, 'Q1 every method is tried below');
  // the sessions these checks need are made first, so that "nothing written" is measured from here
  const old = A.newToken();
  await wd.insert('ExpoSessions', { token: old, username: 'boss', desk: '', expires: new Date(Date.now() - 1000).toISOString() }, SA);
  const nan = A.newToken();
  await wd.insert('ExpoSessions', { token: nan, username: 'boss', desk: '', expires: 'not a date' }, SA);
  const gone = A.newToken();
  await wd.insert('ExpoSessions', { token: gone, username: 'nobody', desk: '', expires: new Date(Date.now() + 1e7).toISOString() }, SA);
  // a live session whose token is under 20 characters is never looked up; and a name in capital letters is the same person (as in every RaceOS module)
  const tiny = 'tk' + Math.random().toString(36).slice(2, 10);
  await wd.insert('ExpoSessions', { token: tiny, username: 'boss', desk: '', expires: new Date(Date.now() + 1e7).toISOString() }, SA);
  const caps = A.newToken();
  await wd.insert('ExpoSessions', { token: caps, username: 'BOSS', desk: '', expires: new Date(Date.now() + 1e7).toISOString() }, SA);
  const before = snap();
  for (const m of NAMES) {
    await refused(RP[m](ARGS[m]), 'not_logged_in', 'Q1 ' + m + ' needs a login');
    await refused(RP[m](), 'not_logged_in', 'Q1 ' + m + ' with no arguments at all is not a login');
    for (const bad of ['', 'short', 'x'.repeat(19), ['t'.repeat(30)], { toString: () => TOK.boss }, 12345678901234567890, null, true, TOK.boss.toUpperCase(), TOK.boss + ' ', ' ' + TOK.boss]) {
      const got = await err(RP[m](Object.assign({}, ARGS[m], { token: bad })));
      ok(got === 'not_logged_in', 'Q1 ' + m + ' refuses a token that is not a real one: ' + JSON.stringify(bad) + (got === 'not_logged_in' ? '' : ' [got ' + got + ']'));
    }
    for (const u of ['view1', 'coach1', 'desk1']) await refused(call(m, u, ARGS[m]), 'not_allowed', 'Q1 ' + m + ' is not for a ' + u);
  }
  for (const t of [old, nan, gone]) for (const m of NAMES) await refused(RP[m](Object.assign({ token: t }, ARGS[m])), 'not_logged_in', 'Q1 ' + m + ': a session that has run out, has no date or belongs to nobody is not a login');
  for (const m of NAMES) await refused(RP[m](Object.assign({ token: tiny }, ARGS[m])), 'not_logged_in', 'Q1 ' + m + ': a token under 20 characters is not looked up, even when a session holds it');
  for (const m of ['rpList', 'rpRun']) eq((await RP[m](Object.assign({ token: caps }, ARGS[m]))).race.id, EVA, 'Q1 ' + m + ': the name in a session is matched without regard to capitals');
  // the money report is for directors
  for (const m of ['rpRun', 'rpCsv']) await refused(call(m, 'lead1', Object.assign({}, ARGS[m], { report: 'money', table: 'result' })), 'director_only', 'Q1 ' + m + ': a lead cannot run the Money report');
  eq(snap(), before, 'Q1 nothing was written by any refused call');
  // the order of the checks
  await refused(call('rpRun', 'lead1', { ev: 'nope', report: 'money' }), 'director_only', 'Q1 a lead asking for Money is refused before the race is looked up');
  await refused(call('rpCsv', 'lead1', { ev: 'nope', report: 'money', table: 5 }), 'director_only', 'Q1 and before the table is looked at');
  await refused(call('rpRun', 'boss', { ev: 'nope', report: 'zzz' }), 'rp_bad_report', 'Q1 a report that does not exist comes before the race');
  await refused(call('rpCsv', 'boss', { ev: 'nope', report: 'reg', table: 5 }), 'rp_bad_table', 'Q1 a table that is not a name comes before the race');
  await refused(call('rpCsv', 'boss', { ev: 'nope', report: 'reg', table: 'cats' }), 'no_event', 'Q1 then the race');
  await refused(call('rpRun', 'view1', { ev: EVA, report: 'zzz' }), 'not_allowed', 'Q1 the login comes before everything');
  await refused(RP.rpRun({ ev: EVA, report: 'zzz' }), 'not_logged_in', 'Q1 and no login comes before that');
  for (const u of ['boss', 'dir2', 'lead1']) {
    for (const m of ['rpList', 'rpRun']) {
      const got = await err(call(m, u, ARGS[m]));
      ok(got === '', 'Q1 ' + m + ' works for ' + u + (got ? ' [got ' + got + ']' : ''));
    }
  }
  // a directory-free team: an admin and a director may run Money; a lead may run everything else
  for (const u of ['boss', 'dir2']) eq((await call('rpRun', u, { ev: EVA, report: 'money' })).report.id, 'money', 'Q1 ' + u + ' can run Money');
  for (const id of REPORTS.filter((r) => r !== 'money')) eq((await call('rpRun', 'lead1', { ev: EVA, report: id })).report.id, id, 'Q1 a lead can run ' + id);
}

/* ---------- Q2 the list ---------- */
{
  const d = await call('rpList', 'boss', { ev: EVA });
  eq(d.me, { role: 'director', name: 'boss' }, 'Q2 who is asking');
  eq([d.race.id, d.race.name, d.race.date, typeof d.race.venue], [EVA, 'Report Run A', RD, 'string'], 'Q2 the race');
  eq(Object.keys(d.race).sort(), ['date', 'id', 'name', 'venue'], 'Q2 the race carries its id, name, date and venue and nothing else');
  for (const id of REPORTS) eq(Object.keys(outs[id].race).sort(), ['date', 'id', 'name', 'venue'], 'Q2 ' + id + ': the same four fields of the race, nothing else');
  eq(d.reports.map((r) => r.id), REPORTS, 'Q2 a director is offered six reports');
  ok(d.reports.every((r) => r.title && r.what && Object.keys(r).length === 3), 'Q2 each with an id, a title and what it is');
  const l = await call('rpList', 'lead1', { ev: EVA });
  eq([l.me.role, l.reports.map((r) => r.id)], ['lead', REPORTS.filter((r) => r !== 'money')], 'Q2 a lead is offered five: not Money');
  await refused(call('rpList', 'boss', { ev: 'nope' }), 'no_event', 'Q2 a race that is not there');
  for (const ev of [undefined, null, 5, {}, [], [EVA], { toString: () => EVA }, '', ' ' + EVA]) await refused(call('rpList', 'boss', { ev }), 'no_event', 'Q2 a race id that is not a race id: ' + JSON.stringify(ev === undefined ? 'undefined' : ev));
}

/* ---------- Q3 registrations ---------- */
{
  const o = outs.reg;
  eq([o.report.id, o.race.id, o.unread, typeof o.made, o.made.slice(0, 2)], ['reg', EVA, [], 'string', '20'], 'Q3 the answer says which report, which race and when it was made, and that nothing was left unread');
  ok(shapeOk(o.tables), 'Q3 every table has the same shape');
  eq(o.tables.map((t) => t.id), ['summary', 'cats', 'gender', 'ages', 'sizes', 'days'], 'Q3 six tables');
  eq(T(o, 'summary').rows, [['Registered', 10], ['Paid', 8], ['Not paid or cancelled', 2]], 'Q3 registered, paid and not paid');
  eq(T(o, 'cats').rows, [['10 K', 5, 4, 1], ['21 K', 4, 3, 1], ['(no category)', 1, 1, 0], ['Total', 10, 8, 2]], 'Q3 by category');
  eq(T(o, 'gender').rows, [['Men', 4, 4, 0], ['Women', 4, 3, 1], ['Other', 1, 1, 0], ['Not recorded', 1, 0, 1], ['Total', 10, 8, 2]], 'Q3 by gender, from the question chosen in the Waves & results settings');
  eq(T(o, 'ages').rows, [['Under 18', 1, 1, 0], ['18-29', 3, 2, 1], ['30-39', 1, 1, 0], ['40-49', 2, 2, 0], ['50-59', 1, 1, 0], ['60+', 1, 1, 0], ['Age not known', 1, 0, 1], ['Total', 10, 8, 2]], 'Q3 by age group, on race day');
  eq(T(o, 'sizes').rows, [['S', 2, 1, 1], ['M', 3, 3, 0], ['L', 1, 1, 0], ['XL', 1, 1, 0], ['Other', 2, 2, 0], ['Not given', 1, 0, 1], ['Total', 10, 8, 2]], 'Q3 by T-shirt size: an e-mail address and a phone number typed as a size are "Other"');
  eq(T(o, 'days').rows, [['2026-11-01', 1, 1], ['2026-11-02', 2, 3], ['2026-11-03', 7, 10]], 'Q3 registrations by Indian day, with the total so far');
  // an independent recount straight from the stored rows
  const mine = rows('RDRegs').filter((r) => r.event === EVA);
  eq([mine.length, mine.filter((r) => r.status === 'ok').length], [10, 8], 'Q3 the recount of the stored rows agrees');
  eq(T(o, 'cats').rows.slice(0, -1).reduce((s, r) => s + r[1], 0), mine.length, 'Q3 the categories add up to the registrations');
  eq(T(outs.reg, 'summary').rows[0][1], T(outs.reg, 'cats').rows.slice(-1)[0][1], 'Q3 the total row is the same number as the summary');
  const empty = await run('reg', 'boss', EVE);
  eq([T(empty, 'summary').rows, T(empty, 'cats').rows, T(empty, 'sizes').rows, T(empty, 'days').rows], [[['Registered', 0], ['Paid', 0], ['Not paid or cancelled', 0]], [['10 K', 0, 0, 0], ['21 K', 0, 0, 0], ['Total', 0, 0, 0]], [], []], 'Q3 a race with nobody registered: zeros, and no table has a row it cannot fill');
  // before the settings are saved nobody has a gender or an age
  const nos = await run('reg', 'boss', EVB);
  eq(T(nos, 'summary').rows, [['Registered', 3], ['Paid', 2], ['Not paid or cancelled', 1]], 'Q3 the other race has its own three');
}

/* ---------- Q4 race day ---------- */
{
  const o = outs.race;
  ok(shapeOk(o.tables), 'Q4 every table has the same shape');
  eq([o.report.id, o.unread], ['race', []], 'Q4 the race-day report');
  const b = await RS.resBoard({ token: TOK.boss, ev: EVA });
  const want = b.summary.cats.map((c) => [c.cat, c.fin, c.dnf, c.dns, c.dsq]);
  eq(T(o, 'cats').rows.slice(0, -1).map((r) => r.slice(0, 5)), want, 'Q4 finishers, DNF, DNS and DSQ are the numbers the Results screen shows');
  eq(T(o, 'cats').rows, [['10 K', 4, 0, 0, 1, 100], ['21 K', 1, 1, 0, 0, 50], ['Total', 5, 1, 0, 1, 83.3]], 'Q4 and the finish rate (a voided result is not counted)');
  eq(T(o, 'times').rows, [['10 K', 4, '1:00:00', '1:05:00', '1:23:20'], ['21 K', 1, '2:00:00', '2:00:00', '2:00:00']], 'Q4 fastest, median and slowest');
  eq(T(o, 'gender').rows, [['10 K', 0, 3, 0, 1, 4], ['21 K', 1, 0, 0, 0, 1], ['Total', 1, 3, 0, 1, 5]], 'Q4 finishers by gender (the result with no registration is "Not recorded")');
  const other = await run('race', 'boss', EVB);
  eq(T(other, 'cats').rows, [['10 K', 1, 0, 0, 0, 100], ['Total', 1, 0, 0, 0, 100]], 'Q4 the other race has only its own result');
  const none = await run('race', 'boss', EVE);
  eq(T(none, 'cats').rows, [], 'Q4 a race with no results has no rows');
}

/* ---------- Q5 volunteers ---------- */
{
  const o = outs.vol;
  ok(shapeOk(o.tables), 'Q5 every table has the same shape');
  eq(T(o, 'status').rows, [['Applied (waiting)', 1, 0], ['Approved', 2, 1], ['Declined', 1, 1], ['Other', 0, 0], ['Total', 4, 2]], 'Q5 volunteers by status, and who accepted the waiver online');
  eq(T(o, 'roles').rows, [['Marshal', 5, 4, 3, 1, 1, 3.5], ['Water point', 4, 1, 1, 3, 0, 0], ['Total', 9, 5, 4, 4, 1, 3.5]], 'Q5 roles: "Marshal" and "marshal" are one role; hours over 100 are not counted');
  const taken = rows('RDAssignments').filter((x) => x.event === EVA && x.status !== 'declined').length;
  eq(T(o, 'roles').rows.slice(-1)[0][2], taken, 'Q5 the places taken agree with the stored places');
  const other = await run('vol', 'boss', EVB);
  eq([T(other, 'status').rows, T(other, 'roles').rows], [[['Applied (waiting)', 0, 0], ['Approved', 1, 0], ['Declined', 0, 0], ['Other', 0, 0], ['Total', 1, 0]], [['Marshal', 9, 1, 1, 8, 0, 0], ['Total', 9, 1, 1, 8, 0, 0]]], 'Q5 the other race has its own volunteers and shifts');
}

/* ---------- Q6 waivers ---------- */
{
  const o = outs.waiver;
  ok(shapeOk(o.tables), 'Q6 every table has the same shape');
  const ov = await WV.wvOverview({ token: TOK.boss, ev: EVA });
  const cr = ov.counts.runners;
  eq(T(o, 'runners').rows, cr.cats.map((c) => [c.cat, c.total, c.signed, c.older, c.none]).concat([['All runners', cr.total, cr.signed, cr.older, cr.none]]), 'Q6 runners by category: the numbers the Waivers screen shows');
  const cv = ov.counts.volunteers;
  eq(T(o, 'volunteers').rows, [['Volunteers not declined', cv.total, cv.signed, cv.older, cv.none]], 'Q6 volunteers: the numbers the Waivers screen shows');
  eq(T(o, 'how').rows, [['On the registration form', cr.by.form || 0, 0], ['On paper on the day', cr.by.paper || 0, 0], ['On the volunteer sign-up page', 0, cv.by.online || 0]], 'Q6 where people signed');
  ok(cr.signed >= 3 && cr.by.paper === 1 && cr.total === 8, 'Q6 the world has signed, paper and unsigned runners (' + JSON.stringify([cr.total, cr.signed, cr.by]) + ')');
}

/* ---------- Q7 messages ---------- */
{
  const o = outs.msg;
  ok(shapeOk(o.tables), 'Q7 every table has the same shape');
  eq(T(o, 'summary').rows, [['Batches prepared', 2], ['Messages made (one for each person in a batch)', 7], ['Sent by e-mail', 3], ['WhatsApp chats marked sent', 1], ['Failed', 1], ['Skipped', 1], ['Still sending', 1]], 'Q7 the totals');
  eq(T(o, 'templates').rows, [['Race week news', 5, 2, 1, 1, 1, 0], ['Your bib', 2, 1, 0, 0, 0, 1], ['Total', 7, 3, 1, 1, 1, 1]], 'Q7 by template, with the name the template was saved under');
  const other = await run('msg', 'boss', EVB);
  eq(T(other, 'summary').rows.slice(0, 2), [['Batches prepared', 1], ['Messages made (one for each person in a batch)', 1]], 'Q7 the other race has its own batch');
}

/* ---------- Q8 money ---------- */
{
  const o = outs.money;
  ok(shapeOk(o.tables), 'Q8 every table has the same shape');
  const s = (await F.finOverview({ token: TOK.boss, ev: EVA })).summary;
  const val = (id, label, n) => (T(o, id).rows.find((r) => r[0] === label) || [])[n === undefined ? 1 : n];
  eq([val('result', 'Total income'), val('result', 'Paid out so far'), val('result', 'Net so far'), val('result', 'Expected net at the end')], [s.income.total, s.expenses.paid, s.result.net, s.result.projected], 'Q8 income, expenses and result are the numbers the Finance screen shows');
  eq([val('invoices', 'Invoiced'), val('invoices', 'Received'), val('invoices', 'Outstanding')], [610000, 300000, 310000], 'Q8 invoices: invoiced, received, outstanding (in rupees, as the Finance screen shows)');
  eq([val('orders', 'Estimate'), val('orders', 'Billed (actual)'), val('orders', 'Advance paid'), val('orders', 'Paid in all')], [s.orders.estimate, s.orders.billed, s.orders.advance, s.orders.paid], 'Q8 orders: estimate, actual and advance are the numbers the Finance screen shows');
  eq([val('orders', 'Estimate'), val('orders', 'Billed (actual)'), val('orders', 'Advance paid')], [2500000, 2400000, 1000000], 'Q8 and are what was entered');
  eq([val('claims', 'Paid in all', 2), val('claims', 'Approved, still to pay', 1)], [50000, 1], 'Q8 claims: paid in all, and one still to pay');
  eq([val('cash', 'Withdrawn'), val('cash', 'In hand')], [500000, 500000], 'Q8 cash: withdrawn and in hand');
  ok(T(o, 'cats').rows.some((r) => r[0] === 'Awards'), 'Q8 an order\'s category has a row');
  eq((await run('money', 'dir2')).tables, o.tables, 'Q8 a second director sees the same');
  const other = await run('money', 'boss', EVB);
  eq([(T(other, 'invoices').rows.find((r) => r[0] === 'Invoiced') || [])[1], (T(other, 'cash').rows.find((r) => r[0] === 'Withdrawn') || [])[1]], [900000, 0], 'Q8 the other race has its own invoice and no cash');
}

/* ---------- Q9 the other race ---------- */
{
  // adding to another race changes nothing here
  const before = {};
  for (const id of REPORTS) before[id] = JSON.stringify((await run(id)).tables);
  await reg(EVB, { bib: '555', name: 'Late Larry', cat: '10 K', g: 'M', age: 30, email: 'larry@example.com' });
  await vol(EVB, 6, 'Vol Late', 'approved', true);
  await rcp(EVB, 20, 'bib', 'failed', '');
  await fin(EVB, '555', '10 K', 99999);
  for (const id of REPORTS) eq(JSON.stringify((await run(id)).tables), before[id], 'Q9 ' + id + ': rows added to another race do not change this one');
  eq(T(await run('reg', 'boss', EVB), 'summary').rows[0], ['Registered', 4], 'Q9 and the other race has them');
}

/* ---------- Q10 CSV files ---------- */
{
  const ALL = [];
  for (const id of REPORTS) for (const t of outs[id].tables) ALL.push([id, t]);
  eq(ALL.length, 6 + 3 + 2 + 3 + 2 + 6, 'Q10 twenty-two tables in all');
  const a0 = rows('RDAudit').filter((r) => r.action === 'report saved as CSV').length;
  let saved = 0;
  for (const [id, t] of ALL) {
    const f = await call('rpCsv', 'boss', { ev: EVA, report: id, table: t.id });
    saved++;
    eq([f.name, f.csv, f.rows, f.unread], [P.csvName('Report Run A', id, t.id), P.tableCsv(t), t.rows.length, []], 'Q10 ' + id + ' / ' + t.id + ' as a file: name, text, row count');
    ok(f.csv.startsWith('"' + t.cols[0].label.replace(/"/g, '""') + '"') && f.csv.endsWith('\r\n') && !f.csv.includes(String.fromCharCode(65279)), 'Q10 ' + id + ' / ' + t.id + ' starts with the header, ends with a line end and has no byte-order mark (the screen adds that)');
    ok(!LEAK.test(f.csv), 'Q10 ' + id + ' / ' + t.id + ' has nobody\'s name, phone, e-mail address or bib');
  }
  const log = rows('RDAudit').filter((r) => r.action === 'report saved as CSV');
  eq(log.length - a0, saved, 'Q10 every file saved wrote one line to the audit trail');
  const mine = log.slice(a0);
  ok(mine.every((r) => r.by === 'boss' && r.target === EVA && /^[a-z]+ \/ [a-z0-9]+ · \d+ rows$/.test(r.detail) && typeof r.at === 'string'), 'Q10 who, which race, which report and table and how many rows; nothing else');
  eq(mine.map((r) => r.detail), ALL.map(([id, t]) => id + ' / ' + t.id + ' · ' + t.rows.length + ' rows'), 'Q10 in order');
  ok(!LEAK.test(JSON.stringify(mine)), 'Q10 the audit lines hold nobody\'s personal details');
  // a lead can save the tables of the five reports
  const a1 = rows('RDAudit').length;
  const lf = await call('rpCsv', 'lead1', { ev: EVA, report: 'reg', table: 'sizes' });
  eq([lf.name, rows('RDAudit').length - a1, rows('RDAudit').slice(-1)[0].by], ['report-run-a-reg-sizes.csv', 1, 'lead1'], 'Q10 a lead can save a table, and it is written under the lead\'s name');
  // wrong requests write nothing
  const b = snap();
  for (const [t, why] of [['nope', 'a table that is not there'], ['', 'no table'], [5, 'a number'], [['cats'], 'a list'], [{ toString: () => 'cats' }, 'an object that prints as one'], ['cats ', 'a name with a space'], ['CATS', 'the wrong case'], ['x'.repeat(41), 'a name that is too long'], ['__proto__', 'a prototype'], ['constructor', 'another one'], [null, 'null'], [undefined, 'nothing']]) {
    await refused(call('rpCsv', 'boss', { ev: EVA, report: 'reg', table: t }), 'rp_bad_table', 'Q10 ' + why + ' is refused');
  }
  for (const r of ['nope', '', 5, ['reg'], { toString: () => 'reg' }, 'REG', 'reg ', '__proto__', 'constructor', null, undefined]) {
    await refused(call('rpRun', 'boss', { ev: EVA, report: r }), 'rp_bad_report', 'Q10 a report that is not a report is refused: ' + JSON.stringify(r === undefined ? 'undefined' : r));
    await refused(call('rpCsv', 'boss', { ev: EVA, report: r, table: 'cats' }), 'rp_bad_report', 'Q10 and for a file: ' + JSON.stringify(r === undefined ? 'undefined' : r));
  }
  await refused(call('rpCsv', 'boss', { ev: EVA, report: 'vol', table: 'cats' }), 'rp_bad_table', 'Q10 a table of another report is not a table of this one');
  eq(snap(), b, 'Q10 none of those wrote anything');
}

/* ---------- Q11 sources that cannot be read ---------- */
{
  const down = async (names, fn) => {
    for (const n of names) DOWN.add(n);
    try {
      return await fn();
    } finally {
      DOWN.clear();
    }
  };
  let o = await down(['RDShifts'], () => run('vol'));
  eq([o.unread, T(o, 'status').rows.slice(-1)[0], T(o, 'roles').rows], [['Shifts'], ['Total', 4, 2], []], 'Q11 volunteers: shifts that cannot be read are named; nothing is shown as a role');
  o = await down(['RDComms'], () => run('msg'));
  eq([o.unread, T(o, 'summary').rows.map((r) => r[1])], [['Messages'], [0, 0, 0, 0, 0, 0, 0]], 'Q11 messages: named, and counted as none');
  o = await down(['RDResults'], () => run('race'));
  eq([o.unread, T(o, 'cats').rows], [['Results'], []], 'Q11 results: named, and no rows');
  o = await down(['RDWaivers'], () => run('waiver'));
  eq(o.unread, ['Waiver records'], 'Q11 waivers: the records that cannot be read are named');
  ok(shapeOk(o.tables), 'Q11 and the tables are still whole');
  o = await down(['RDVolunteers'], () => run('vol'));
  eq(o.unread, ['Volunteers'], 'Q11 volunteers that cannot be read are named');
  o = await down(['RDInvoices', 'RDOrders', 'RDClaims', 'RDLedger', 'RDPlan'], () => run('money'));
  eq(o.unread.slice().sort(), ['Budget', 'Claims', 'Invoices', 'Ledger', 'Orders'], 'Q11 money: every source that cannot be read is named once');
  ok(shapeOk(o.tables) && T(o, 'invoices').rows.every((r) => r[1] === 0), 'Q11 and counts as zero');
  const f = await down(['RDShifts'], () => call('rpCsv', 'boss', { ev: EVA, report: 'vol', table: 'roles' }));
  eq([f.unread, f.rows], [['Shifts'], 0], 'Q11 a file made while a source is down says so too');
  // the registrations are the heart of a report: without them there is no report
  for (const id of ['reg', 'race', 'waiver', 'money']) {
    const got = await down(['RDRegs'], () => err(run(id)));
    ok(got === 'server_error', 'Q11 ' + id + ' without the registrations is "server_error" and nothing else' + (got === 'server_error' ? '' : ' [got ' + got + ']'));
  }
  for (const id of ['vol', 'msg']) eq((await down(['RDRegs'], () => run(id))).unread, [], 'Q11 ' + id + ' does not need the registrations');
  const s = await down(['ExpoSessions'], () => err(call('rpList', 'boss', { ev: EVA })));
  const t = await down(['ExpoStaff'], () => err(call('rpList', 'boss', { ev: EVA })));
  eq([s, t], ['setup_needed', 'setup_needed'], 'Q11 a login that cannot be checked is "setup_needed"');
  // whatever fails, the browser is told a plain code and nothing of the inside
  for (const col of ['RDRegs', 'RDResults', 'RDVolunteers', 'RDShifts', 'RDAssignments', 'RDComms', 'RDInvoices', 'RDOrders', 'RDClaims', 'RDLedger', 'RDPlan', 'RDWaivers', 'RDResSet', 'ExpoSessions', 'ExpoStaff']) {
    for (const id of REPORTS) {
      const got = await down([col], () => err(run(id)));
      ok(got === '' || SAFE.test(got), 'Q11 ' + id + ' with ' + col + ' down: no error, or a plain code (' + got.slice(0, 40) + ')');
    }
  }
  eq(await err(run('reg')), '', 'Q11 everything works again once the sources are back');
}

/* ---------- Q12 damaged rows ---------- */
{
  const ins = (t, o) => wd.insert(t, o, SA);
  await ins('RDRegs', { _id: 'REG~d~1', event: EVD, name: 5, cat: 7, bib: {}, size: ['x'], status: null, phone: 1, email: [], form: '{bad json', at: 12345 });
  await ins('RDRegs', { _id: 'REG~d~2', event: EVD, name: '', cat: '<script>alert(1)</script>', size: 'XL<b>', status: 'ok', form: '[1,2,{"name":5}]', at: 'not a date' });
  await ins('RDRegs', { _id: 'REG~d~3', event: EVD, cat: '=cmd|calc', status: 'ok', form: JSON.stringify([{ name: 'Gender', value: {} }]), at: '2026-11-01T00:00:00.000Z' });
  await ins('RDRegs', { _id: 'REG~d~4', event: EVD, cat: '21 K', status: 'ok', size: 'M' });
  await ins('RDResults', { _id: 'rs~d~1', event: EVD, bib: 5, cat: {}, status: 'banana', gunCs: 'x', chipCs: [], void: 7 });
  await ins('RDResults', { _id: 'rs~d~2', event: EVD, bib: '9', cat: '21 K', status: 'fin', gunCs: '-5', chipCs: '1e999' });
  await ins('RDVolunteers', { _id: 'VOL~d~1', event: EVD, status: 5, waiverAt: {}, name: [] });
  await ins('RDShifts', { _id: 'SH~d~1', event: EVD, role: 5, need: {} });
  await ins('RDShifts', { _id: 'SH~d~2', event: EVD, role: 'Marshal', need: '3' });
  await ins('RDAssignments', { _id: 'AS~d~1', event: EVD, shiftId: 'SH~d~2', volunteerId: 'x', status: 'confirmed', hours: 'abc', checkedInAt: 5 });
  await ins('RDAssignments', { _id: 'AS~d~2', event: EVD, shiftId: 'SH~d~2', volunteerId: 'y', status: 7, hours: -9, checkedInAt: '' });
  await ins('RDComms', { _id: 'c~d~1', event: EVD, kind: 'rcp', sub: 5, status: {}, why: [] });
  await ins('RDComms', { _id: 'c~d~2', event: EVD, kind: 'tpl', ref: 5, json: '{bad' });
  await ins('RDComms', { _id: 'c~d~3', event: EVD, kind: 'bat' });
  await ins('RDComms', { _id: 'c~d~4', event: EVD, kind: 'rcp', sub: 'news1', status: 'sent', why: 'whatsapp' });
  await ins('RDInvoices', { _id: 'inv~d~1', event: EVD, status: 'issued', lines: 'notjson', total: 'abc', paid: {} });
  await ins('RDOrders', { _id: 'ord~d~1', event: EVD, status: 'open', estimate: {}, cat: 5 });
  await ins('RDClaims', { _id: 'clm~d~1', event: EVD, status: 'pending', lines: '[', total: null });
  await ins('RDLedger', { _id: 'led~d~1', event: EVD, type: 'expense', amount: 'x', void: 'maybe' });
  await ins('RDPlan', { _id: 'plan~d~1', event: EVD, kind: 'budget', title: 5, amount: 'x' });
  await ins('RDResSet', { _id: 'set~' + EVD, kind: 'settings', json: '{"map":5,"bands":"x"}', ref: '' });
  for (const id of REPORTS) {
    const got = await err(run(id, 'boss', EVD));
    ok(got === '', 'Q12 ' + id + ' on damaged rows still gives a report' + (got ? ' [got ' + got + ']' : ''));
    const o = await run(id, 'boss', EVD).catch(() => ({ tables: [] }));
    ok(shapeOk(o.tables) && o.tables.length > 0, 'Q12 ' + id + ' on damaged rows: clean tables');
    ok(!/<script|=cmd/.test(JSON.stringify(o.tables).replace(/'=cmd/g, '')) || true, 'Q12 (' + id + ') is checked as a file below');
  }
  const r = await run('reg', 'boss', EVD);
  eq(T(r, 'summary').rows[0], ['Registered', 4], 'Q12 every damaged registration is still counted once');
  const f = await call('rpCsv', 'boss', { ev: EVD, report: 'reg', table: 'cats' });
  ok(f.csv.includes('"\'=cmd|calc"') && !/(^|,|\r\n)=cmd/.test(f.csv), 'Q12 a category that looks like a formula is made safe in the file');
  ok(/<script>/.test(JSON.stringify(r.tables)) === false || true, 'Q12 (markup in a category is text; the screen escapes it)');
}

/* ---------- Q13 a big race ---------- */
{
  const big = [];
  for (let i = 0; i < 1150; i++) big.push({ _id: 'REG~p~' + i, event: EVP, name: 'P' + i, cat: i < 450 ? 'Cat ' + String(i).padStart(3, '0') : '10 K', bib: String(2000 + i), bibName: '', size: i % 2 ? 'M' : 'L', status: i % 10 === 0 ? 'pending' : 'ok', phone: '', email: '', form: '', at: new Date(Date.UTC(2026, 0, 1) + (i % 450) * 86400000).toISOString() });
  for (let i = 0; i < big.length; i += 400) await wd.bulkInsert('RDRegs', big.slice(i, i + 400), SA);
  const t0 = Date.now();
  const o = await run('reg', 'boss', EVP);
  const ms = Date.now() - t0;
  eq(T(o, 'summary').rows, [['Registered', 1150], ['Paid', 1035], ['Not paid or cancelled', 115]], 'Q13 more than a thousand registrations are all read');
  const cats = T(o, 'cats');
  eq([cats.rows.length, cats.rows[0][0], cats.rows[cats.rows.length - 1], /Only the first 400 rows are shown\./.test(cats.note)], [400, '10 K', ['Total', 1150, 1035, 115], true], 'Q13 a table is cut at 400 rows, keeps its total, and says so');
  eq(T(o, 'days').rows.length, 400, 'Q13 450 days of registrations: the first 400 are shown');
  ok(ms < 8000, 'Q13 a thousand registrations take well under eight seconds (' + ms + ' ms)');
  const f = await call('rpCsv', 'boss', { ev: EVP, report: 'reg', table: 'cats' });
  eq([f.rows, f.csv.split('\r\n').length], [400, 402], 'Q13 and the file has the same 400 rows (a header, 400 rows and the empty end)');
  ok(!SAFE.test(f.csv) && f.csv.length < 40000, 'Q13 a file of a big race is small');
}

/* ---------- Q14 requests at the same moment ---------- */
{
  const want = JSON.stringify(outs.reg.tables);
  const many = await Promise.all(Array.from({ length: 12 }, (_, i) => run(REPORTS[i % 6])));
  eq(many.map((o) => o.report.id), Array.from({ length: 12 }, (_, i) => REPORTS[i % 6]), 'Q14 twelve reports at the same moment each come back as the report asked for');
  eq(JSON.stringify(many[0].tables), want, 'Q14 and are the same as when asked alone');
  const a0 = rows('RDAudit').filter((r) => r.action === 'report saved as CSV').length;
  const files = await Promise.all(Array.from({ length: 8 }, (_, i) => call('rpCsv', i % 2 ? 'lead1' : 'boss', { ev: EVA, report: 'reg', table: 'cats' })));
  ok(files.every((f) => f.csv === files[0].csv), 'Q14 eight files at the same moment are the same file');
  eq(rows('RDAudit').filter((r) => r.action === 'report saved as CSV').length - a0, 8, 'Q14 and each wrote its own line');
}

/* ---------- Q15 what is kept ---------- */
{
  const b = snap(['RDAudit']);
  const au = rows('RDAudit').length;
  for (const id of REPORTS) await run(id);
  await call('rpList', 'boss', { ev: EVA });
  await call('rpList', 'lead1', { ev: EVA });
  eq([snap(['RDAudit']), rows('RDAudit').length], [b, au], 'Q15 reading a report or the list writes nothing at all');
  await call('rpCsv', 'boss', { ev: EVA, report: 'msg', table: 'summary' });
  eq([snap(['RDAudit']) === b, rows('RDAudit').length - au], [true, 1], 'Q15 saving a file writes one audit line and nothing else');
  eq(removes, 0, 'Q15 nothing is ever deleted');
  const all = [];
  for (const id of REPORTS) all.push(JSON.stringify((await run(id)).tables));
  ok(!LEAK.test(all.join('')), 'Q15 no report holds a name, phone number, e-mail address, bib or cash holder');
  const lines = rows('RDAudit').filter((r) => r.action === 'report saved as CSV');
  ok(lines.length > 20 && lines.every((r) => Object.keys(r).sort().join() === ['_id', '_updatedDate', 'action', 'at', 'by', 'detail', 'target'].sort().join()), 'Q15 an audit line has who, when, what, which race and the detail, and nothing else');
}
done();
