// BACKEND TESTS (Results): who may do what, waves and corrals, the start list, importing results, the board, corrections and
// voids, and awards, on one in-memory database with the real RaceOS and Results backends.
//   R1 who may call what   R2 settings   R3 waves   R4 placing runners   R5 the start list   R6 importing results
//   R7 the board           R8 awards      R9 corrections and voids        R10 settings change the answers   R11 the other race
import * as R from './racedir.test.mjs';
import * as S from './results.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Results backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const rows = (t) => [...(DB[t] || new Map()).values()];
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const NAMES = Object.keys(S).filter((n) => /^res[A-Z]/.test(n));
let kseq = 0;
const K = () => 'res' + Date.now().toString(36) + (++kseq).toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- the world ---------- */
const HASH = A.hashPassword('Res-pass-1');
const mkStaff = (username, role) => wd.insert('ExpoStaff', { username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['desk1', 'desk']];
for (const [u, r] of WHO) await mkStaff(u, r);
const TOK = {};
for (const [u] of WHO) {
  TOK[u] = A.newToken();
  await wd.insert('ExpoSessions', { token: TOK[u], username: u, desk: '', expires: new Date(Date.now() + 3600000).toISOString() }, SA);
}
const RD = istDay(60);
const Y = +RD.slice(0, 4);
const EVA = (await R.saveEvent({ token: TOK.boss, name: 'Results Run A', date: RD, venue: 'Beach' })).event.id;
const EVB = (await R.saveEvent({ token: TOK.boss, name: 'Results Run B', date: istDay(90), venue: 'Hills' })).event.id;
await R.saveCats({ token: TOK.boss, ev: EVA, cats: [{ name: '10 K', km: 10, price: 800, cap: 500 }, { name: '21 K', km: 21.0975, price: 1200, cap: 500 }] });
await R.saveCats({ token: TOK.boss, ev: EVB, cats: [{ name: '10 K', km: 10, price: 800, cap: 500 }] });
const FORM = (g, d, a, e) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: a }, { name: 'Expected finish', value: e }]);
const dob = (age) => '01/01/' + (Y - age);
const idOf = (ev, bib) => 'REG~' + ev.slice(-6) + '~' + bib;
const reg = (ev, bib, name, cat, g, d, a, e, status) =>
  wd.insert('RDRegs', { _id: idOf(ev, bib), event: ev, name, cat, bib, status: status || 'ok', phone: '98123' + bib.padStart(5, '0'), email: 'p' + bib + '@example.com', form: FORM(g, d, a, e), at: new Date().toISOString() }, SA);
const PEOPLE = [
  ['101', 'Asha', '10 K', 'Female', dob(36), '', '55:00'], ['102', 'Bina', '10 K', 'F', dob(31), '', '56:00'], ['103', 'Chitra', '10 K', 'F', dob(26), '', '57:00'],
  ['104', 'Dev', '10 K', 'M', dob(46), '', '50:00'], ['105', 'Esha', '10 K', 'F', dob(36), '', '55:00'], ['106', 'Farid', '10 K', 'M', '', '17', ''],
  ['109', 'Gopal', '10 K', 'M', '', '25', ''], ['110', 'Hari', '10 K', '', '', '', ''],
  ['201', 'Indu', '21 K', 'F', dob(41), '', '1:50:00'], ['202', 'Jai', '21 K', 'M', dob(51), '', ''], ['203', 'Kiran', '21 K', 'F', dob(29), '', ''],
];
for (const p of PEOPLE) await reg(EVA, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
await reg(EVA, '111', 'Unpaid Uma', '10 K', 'F', dob(30), '', '', 'pending');
await reg(EVB, '101', 'Other Race Olga', '10 K', 'F', dob(33), '', '54:00');
const REGID = (bib, ev) => idOf(ev || EVA, bib);
const call = (fn, who, o, ev) => S[fn](Object.assign({ token: who === null ? undefined : TOK[who], ev: ev === undefined ? EVA : ev }, o || {}));
const SETTINGS = { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: 'Gender', dob: 'Date of birth', age: 'Age', seed: 'Expected finish' } };
const LEAK = new RegExp('p1\\d\\d@example|98123\\d{5}|@example\\.com|' + [36, 31, 26, 46, 41, 51, 29, 33].map((n) => '01/01/' + (Y - n) + '|' + (Y - n) + '-01-01').join('|'));
const noLeak = (o, msg) => ok(!LEAK.test(JSON.stringify(o)), msg);

/* ---------- R1 who may call what ---------- */
{
  ok(NAMES.length === 12, 'R1 control: the Results backend has 12 methods (' + NAMES.length + ')');
  const VIEW = ['resOverview', 'resStartList', 'resBoard', 'resAwards'];
  const DIRONLY = NAMES.filter((n) => !VIEW.includes(n));
  for (const n of VIEW) {
    ok((await err(call(n, 'boss'))) === '' && (await err(call(n, 'dir2'))) === '' && (await err(call(n, 'lead1'))) === '', 'R1 ' + n + ': directors and leads may look');
    const bad = [];
    for (const w of ['view1', 'coach1', 'desk1']) if ((await err(call(n, w))) !== 'not_allowed') bad.push(w);
    ok(!bad.length, 'R1 ' + n + ': viewers, coaches and desk staff are refused (' + bad.join(',') + ')');
    await refused(call(n, null), 'not_logged_in', 'R1 ' + n + ': no login');
    await refused(S[n]({ token: 'x'.repeat(30), ev: EVA }), 'not_logged_in', 'R1 ' + n + ': a made-up login');
    await refused(S[n]({ token: TOK.boss, ev: 'nope' }), 'no_event', 'R1 ' + n + ': a race that does not exist');
  }
  for (const n of DIRONLY) {
    await refused(call(n, 'lead1', { settings: SETTINGS, waves: [], rev: 0, mode: 'seed', text: 'bib,time\n1,1:00:00' }), 'director_only', 'R1 ' + n + ': a lead is told "directors only"');
    const bad = [];
    for (const w of ['view1', 'coach1', 'desk1']) if ((await err(call(n, w))) !== 'not_allowed') bad.push(w);
    ok(!bad.length, 'R1 ' + n + ': viewers, coaches and desk staff are refused (' + bad.join(',') + ')');
    await refused(call(n, null), 'not_logged_in', 'R1 ' + n + ': no login');
  }
}

/* ---------- R2 settings ---------- */
{
  const ff = await call('resFormFields', 'boss');
  eq(ff.fields.map((x) => [x.name, x.count]), [['Gender', 11], ['Date of birth', 9], ['Age', 2], ['Expected finish', 6]], 'R2 the registration form questions are listed with how many answered');
  ok(ff.count === 12 && !JSON.stringify(ff).includes('example.com'), 'R2 12 registrations counted and no answer text holds an e-mail address');
  const o0 = await call('resOverview', 'boss');
  eq([o0.counts.regs, o0.counts.paid, o0.counts.placed, o0.waves.length, o0.settings.rankBy], [12, 11, 0, 0, 'chip'], 'R2 before any setup: 12 registrations, 11 paid, nobody placed, no waves, default settings');
  for (const bad of [null, 'x', [], { rankBy: 'x' }, { ageRule: 5 }, { bands: [30, 18] }, { overallDepth: 11 }, { map: 'x' }]) await refused(call('resSaveSettings', 'boss', { settings: bad }), 'bad_settings', 'R2 refused settings ' + JSON.stringify(bad));
  const sv = await call('resSaveSettings', 'boss', { settings: Object.assign({ extra: 1, evil: { a: 1 } }, SETTINGS) });
  eq(sv.settings, SETTINGS, 'R2 settings are saved; unknown names are dropped');
  const o1 = await call('resOverview', 'lead1');
  eq([o1.settings.map.seed, o1.bands], ['Expected finish', ['Under 18', '18-29', '30-39', '40-49', '50-59', '60+']], 'R2 a lead sees the saved settings and the age groups');
  ok(rows('RDAudit').some((a) => a.action === 'results settings saved'), 'R2 the change is in the audit log');
}

/* ---------- R3 waves ---------- */
const WAVES = [{ cat: '10 K', name: 'Wave 1', start: '06:00', corrals: 'A, B', cap: 3 }, { cat: '10 K', name: 'Wave 2', start: '06:10', corrals: ['C'], cap: 0 }, { cat: '21 K', name: 'Elite', start: '05:30', corrals: '', cap: '' }];
{
  const r = await call('resSaveWaves', 'boss', { rev: 0, waves: WAVES });
  eq(r, { rev: 1, moved: 0 }, 'R3 waves are saved (revision 1)');
  const o = await call('resOverview', 'boss');
  eq(o.waves.map((w) => [w.id, w.cat, w.name, w.start, w.corrals, w.cap, w.count]), [['w1', '10 K', 'Wave 1', '06:00', ['A', 'B'], 3, 0], ['w2', '10 K', 'Wave 2', '06:10', ['C'], 0, 0], ['w3', '21 K', 'Elite', '05:30', [], 0, 0]], 'R3 each wave has an id, start, corrals and capacity');
  await refused(call('resSaveWaves', 'boss', { rev: 0, waves: WAVES }), 'changed_reload', 'R3 a second person saving from an old copy is told to reload');
  await refused(call('resSaveWaves', 'boss', { waves: WAVES }), 'bad_waves', 'R3 no revision number is refused');
  await refused(call('resSaveWaves', 'boss', { rev: 1, waves: [{ cat: '5 K', name: 'X', start: '06:00', corrals: '', cap: 0 }] }), 'bad_waves', 'R3 a category the race does not have is refused');
  await refused(call('resSaveWaves', 'boss', { rev: 1, waves: [WAVES[0], WAVES[0]] }), 'bad_waves', 'R3 two waves with the same name are refused');
  await refused(call('resSaveWaves', 'boss', { rev: 1, waves: 'x' }), 'bad_waves', 'R3 a wave list that is not a list is refused');
  eq((await call('resOverview', 'boss')).rev, 1, 'R3 refused saves change nothing (still revision 1)');
}

/* ---------- R4 placing runners ---------- */
const placeOf = async () => {
  const sl = await call('resStartList', 'boss');
  const m = {};
  sl.sections.forEach((s) => s.corrals.forEach((c) => c.runners.forEach((x) => (m[x.bib] = [s.id, c.corral]))));
  return m;
};
{
  const key = K();
  const a1 = await call('resAssign', 'boss', { mode: 'seed', key });
  eq([a1.placed, a1.unplaced], [11, 0], 'R4 by expected finish time: all 11 paid runners are placed');
  const m = await placeOf();
  eq(['104', '101', '105'].map((b) => m[b]), [['w1', 'A'], ['w1', 'A'], ['w1', 'B']], 'R4 the three fastest expected times fill Wave 1 (capacity 3), split over corrals A and B');
  eq(['102', '103', '106', '109', '110'].map((b) => m[b]), [['w2', 'C'], ['w2', 'C'], ['w2', 'C'], ['w2', 'C'], ['w2', 'C']], 'R4 the rest go to Wave 2; runners with no expected time go last');
  eq(['201', '202', '203'].map((b) => m[b]), [['w3', ''], ['w3', ''], ['w3', '']], 'R4 the 21 K runners are all in their own wave (no corral)');
  ok(!m['111'], 'R4 the runner who has not paid is not placed');
  const n = rows('RDWaveAssign').length;
  const again = await call('resAssign', 'boss', { mode: 'seed', key });
  ok(again.again === true && rows('RDWaveAssign').length === n, 'R4 the same request sent twice does nothing twice');
  await refused(call('resAssign', 'dir2', { mode: 'seed', key }), 'busy_try_again', 'R4 another login using the same key is told to try again');
  await refused(call('resAssign', 'boss', { mode: 'random' }), 'bad_mode', 'R4 an unknown mode is refused');
  await refused(call('resAssign', 'boss', { mode: 'seed', cat: '5 K' }), 'bad_cat', 'R4 a category the race does not have is refused');
  await refused(call('resAssign', 'boss', { mode: 'seed', key: 'a b' }), 'bad_key', 'R4 a bad repeat key is refused');
  // by hand
  await refused(call('resPlace', 'boss', { regId: REGID('111'), wave: 'w2' }), 'not_paid', 'R4 a runner who has not paid cannot be placed');
  await refused(call('resPlace', 'boss', { regId: REGID('103'), wave: 'w3' }), 'wrong_category', 'R4 a 10 K runner cannot go in a 21 K wave');
  await refused(call('resPlace', 'boss', { regId: REGID('106'), wave: 'w2', corral: 'Z' }), 'bad_corral', 'R4 a corral the wave does not have is refused');
  await refused(call('resPlace', 'boss', { regId: REGID('106'), wave: 'w9' }), 'bad_wave', 'R4 a wave that does not exist is refused');
  await refused(call('resPlace', 'boss', { regId: REGID('106') }), 'bad_wave', 'R4 no wave given is refused');
  await refused(call('resPlace', 'boss', { regId: REGID('109'), wave: 'w1', corral: 'B' }), 'wave_full', 'R4 a full wave refuses one more');
  await refused(call('resPlace', 'boss', { regId: 'REG~nope', wave: 'w1' }), 'no_item', 'R4 a registration that does not exist');
  await refused(call('resPlace', 'boss', { regId: REGID('101', EVB), wave: 'w1' }), 'no_item', 'R4 a registration of another race is "no_item"');
  const out = await call('resPlace', 'boss', { regId: REGID('105'), wave: '' });
  eq([out.wave, (await placeOf())['105']], ['', undefined], 'R4 a runner can be taken out of a wave');
  const inn = await call('resPlace', 'boss', { regId: REGID('109'), wave: 'w1', corral: 'b' });
  eq([inn.wave, inn.corral, (await placeOf())['109']], ['w1', 'B', ['w1', 'B']], 'R4 by hand: a runner goes into Wave 1, corral B (typed "b", stored "B")');
  // redo keeps the hand placement
  const redo = await call('resAssign', 'boss', { mode: 'bib', redo: true });
  const m2 = await placeOf();
  eq([redo.placed, redo.unplaced, m2['109']], [10, 0, ['w1', 'B']], 'R4 placing again by bib: the runner put in by hand stays where they are');
  eq(['101', '102'].map((b) => m2[b][0]), ['w1', 'w1'], 'R4 the lowest bibs fill the rest of Wave 1');
  eq(['103', '104', '105', '106', '110'].map((b) => m2[b][0]), ['w2', 'w2', 'w2', 'w2', 'w2'], 'R4 the other bibs go to Wave 2');
  ok(rows('RDWaveAssign').filter((x) => x.how === 'manual').length === 1 && rows('RDWaveAssign').every((x) => x.event === EVA), 'R4 exactly one hand placement is recorded as manual, and every row belongs to this race');
  // many requests at the same moment for a wave with one place left
  await call('resPlace', 'boss', { regId: REGID('102'), wave: '' });
  const racers = ['102', '103', '104', '105', '106'];
  const res = await Promise.all(racers.map((b) => err(call('resPlace', 'boss', { regId: REGID(b), wave: 'w1' }))));
  const inW1 = rows('RDWaveAssign').filter((x) => x.wave === 'w1').length;
  ok(inW1 <= 3 && res.every((x) => x === '' || x === 'wave_full'), 'R4 five people placed at once into a wave with one place left: it never goes over its capacity (' + inW1 + ' of 3), the others are told it is full');
}

/* ---------- R5 the start list ---------- */
{
  const sl = await call('resStartList', 'lead1');
  eq(sl.sections.map((s) => [s.id, s.name, s.start]), [['w3', 'Elite', '05:30'], ['w1', 'Wave 1', '06:00'], ['w2', 'Wave 2', '06:10']], 'R5 the start list is in start-time order');
  ok(sl.counts.paid === 11 && sl.counts.placed + sl.counts.unplaced === 11 && sl.unassigned.every((r) => r.bib), 'R5 every paid runner is on the list: placed or listed as not placed');
  noLeak(sl, 'R5 the start list holds no phone number, e-mail address or date of birth');
  ok(!JSON.stringify(sl).includes('Unpaid Uma'), 'R5 a runner who has not paid is not on it');
  await call('resAssign', 'boss', { mode: 'bib', redo: true });
}

/* ---------- R6 importing results ---------- */
const CSV = [
  'bib,chip,gun,status,name,category,gender,age',
  '101,55:10,55:15,,,,,', '102,56:20,56:25,,,,,', '103,57:30,57:35,,,,,', '104,50:00,50:05,,,,,', '105,55:10,55:20,,,,,', '106,,,DNF,,,,',
  '109,48:00,48:04,,,,,', '110,58:00,58:06,,,,,', '201,1:50:00,1:50:10,,,,,', '202,1:40:00,1:40:05,,,,,', '203,1:55:00,1:55:20,,,,,',
  '777,59:00,59:05,,Walk In,10 K,M,45',
].join('\n');
{
  const dry = await call('resImport', 'boss', { text: CSV, dry: true });
  ok(dry.dry === true && dry.summary.items === 12 && dry.summary.matched === 11 && dry.summary.unmatched === 1 && dry.errors.length === 0, 'R6 a trial run reads 12 lines: 11 match a registration, 1 is a walk-in; no errors');
  eq([dry.summary.fin, dry.summary.dnf], [11, 1], 'R6 the trial run counts 11 finishers and 1 DNF');
  eq((await call('resBoard', 'boss')).rows.length, 0, 'R6 a trial run saves nothing');
  await refused(call('resImport', 'boss', { text: 5 }), 'bad_text', 'R6 a file that is not text is refused');
  await refused(call('resImport', 'boss', { text: 'bib,time\n' }), 'nothing_to_save', 'R6 a file with no results saves nothing');
  const BAD = 'bib,chip\n101,55:10\n101,56:10\n999,1:00:00\nZZ!,1:00:00\n102,abc\n';
  const dryBad = await call('resImport', 'boss', { text: BAD, dry: true });
  eq(dryBad.errors.map((e) => e.line), [3, 4, 5, 6], 'R6 each bad line is reported with its line number');
  await refused(call('resImport', 'boss', { text: BAD }), 'has_errors', 'R6 a file with bad lines is not saved unless the director says to skip them');
  eq((await call('resBoard', 'boss')).rows.length, 0, 'R6 ...and nothing was saved');
  const key = K();
  const im = await call('resImport', 'boss', { text: CSV, key });
  eq([im.saved, im.replaced, im.kept, im.skipped], [12, 0, 0, 0], 'R6 the import saves 12 results');
  const again = await call('resImport', 'boss', { text: CSV, key });
  ok(again.again === true && rows('RDResults').length === 12, 'R6 the same import sent twice saves nothing twice');
  const im2 = await call('resImport', 'boss', { text: CSV });
  eq([im2.saved, im2.replaced, im2.kept], [0, 0, 12], 'R6 importing the same file again keeps what is there (nothing is overwritten)');
  const im3 = await call('resImport', 'boss', { text: 'bib,chip\n101,55:00\n', replace: true });
  eq([im3.saved, im3.replaced], [0, 1], 'R6 "replace" overwrites that one runner, and the old values are kept in the row');
  ok(JSON.parse(rows('RDResults').find((r) => r.bib === '101').prev || '{}').chipCs === '3310' + '0' || rows('RDResults').find((r) => r.bib === '101').prev.includes('331000'), 'R6 the replaced result keeps its earlier time');
  await call('resImport', 'boss', { text: 'bib,chip\n101,55:10,\n', replace: true });
  const sk = await call('resImport', 'boss', { text: 'bib,chip\n102,56:20\nZZ!,1:00:00\n', skipErrors: true, replace: true });
  eq([sk.replaced, sk.skipped], [1, 1], 'R6 with "skip bad lines" the good lines are saved and the bad ones counted');
  ok(rows('RDResults').every((r) => r.event === EVA), 'R6 every result belongs to this race');
}

/* ---------- R7 the board ---------- */
let BOARD;
{
  BOARD = await call('resBoard', 'lead1');
  const by = (b) => BOARD.rows.find((x) => x.bib === b);
  eq(BOARD.rows.length, 12, 'R7 12 results on the board');
  eq(['109', '104', '101', '105', '102', '103', '110', '777'].map((b) => by(b).place), [1, 2, 3, 3, 5, 6, 7, 8], 'R7 10 K places follow the chip time; the tie shares a place (3, 3) and the next is 5');
  eq(['101', '105', '102', '103'].map((b) => by(b).gplace), [1, 1, 3, 4], 'R7 women are placed among women');
  eq(['109', '104', '777'].map((b) => by(b).gplace), [1, 2, 3], 'R7 men are placed among men');
  eq(['101', '102', '103', '104', '105', '106', '109', '777'].map((b) => by(b).ageGroup), ['30-39', '30-39', '18-29', '40-49', '30-39', 'Under 18', '18-29', '40-49'], 'R7 age groups come from the date of birth on race day, or the age written down');
  eq(['101', '105', '102', '103'].map((b) => by(b).aplace), [1, 1, 3, 1], 'R7 age-group places are among the same gender and band');
  ok(by('106').status === 'dnf' && by('106').place === null, 'R7 a DNF has no place');
  ok(by('777').flags.includes('unmatched') && by('777').name === 'Walk In', 'R7 a bib that is not registered is flagged and keeps the name from the file');
  ok(by('110').flags.includes('nogender') && by('110').flags.includes('noage'), 'R7 a runner with no gender and no age is flagged');
  eq(by('201').place, 2, 'R7 21 K: the 1:50:00 finisher is 2nd behind the 1:40:00 finisher');
  eq([BOARD.summary.total, BOARD.summary.fin, BOARD.summary.dnf, BOARD.summary.unmatched], [12, 11, 1, 1], 'R7 the summary counts');
  noLeak(BOARD, 'R7 the board holds no phone number, e-mail address or date of birth');
  ok(BOARD.rows.every((r) => !('dob' in r) && !('phone' in r) && !('email' in r) && !('regId' in r)), 'R7 no row has a date-of-birth, phone, e-mail or registration field');
}

/* ---------- R8 awards ---------- */
{
  const aw = await call('resAwards', 'lead1');
  const c10 = aw.awards.cats.find((c) => c.cat === '10 K');
  const f = c10.groups.find((g) => g.gender === 'F');
  const m = c10.groups.find((g) => g.gender === 'M');
  eq(f.overall.map((x) => [x.bib, x.place]), [['101', 1], ['105', 1], ['102', 3]], 'R8 10 K women overall: a tie for first takes both, then third');
  eq(m.overall.map((x) => [x.bib, x.place]), [['109', 1], ['104', 2], ['777', 3]], 'R8 10 K men overall: the top three');
  eq(f.ageGroups.map((g) => [g.band, g.list.map((x) => x.bib)]), [['18-29', ['103']]], 'R8 a woman who took an overall place is not listed again in her age group');
  eq(c10.missing.map((x) => [x.bib, x.why]), [['110', 'gender']], 'R8 a finisher with no gender is listed as missing');
  eq(aw.awards.cats.map((c) => c.cat), ['10 K', '21 K'], 'R8 categories in order');
  noLeak(aw, 'R8 awards hold no phone number, e-mail address or date of birth');
  ok(aw.awards.cats.every((c) => c.groups.every((g) => g.overall.every((x) => !('dob' in x)))), 'R8 no award row has a date of birth');
}

/* ---------- R9 corrections and voids ---------- */
const rid = (bib, ev) => 'rs~' + (ev || EVA) + '~' + bib;
{
  const fix = (fields, reason, who, id, ev) => call('resSaveRow', who || 'boss', { id: id || rid('102'), fields, reason: reason === undefined ? 'checked the finish sheet' : reason }, ev);
  await refused(fix({ chip: '56:00' }, ''), 'reason_needed', 'R9 a correction needs a reason');
  await refused(fix({ chip: '56:00' }, 'ab'), 'reason_needed', 'R9 a reason of two letters is not a reason');
  await refused(fix({ chip: '5:6' }), 'bad_time', 'R9 a bad time is refused');
  await refused(fix({ chip: 5600 }), 'bad_time', 'R9 a time that is not text is refused');
  await refused(fix({ status: 'zzz' }), 'bad_status', 'R9 an unknown status is refused');
  await refused(fix({ gender: 'zzz' }), 'bad_gender', 'R9 an unknown gender is refused');
  await refused(fix({ age: '150' }), 'bad_age', 'R9 an age of 150 is refused');
  await refused(fix({ dob: '31/02/1990' }), 'bad_dob', 'R9 an impossible date of birth is refused');
  await refused(fix({ cat: 'Nope' }), 'bad_cat', 'R9 a category the race does not have is refused');
  await refused(fix('x'), 'bad_field', 'R9 fields that are not an object are refused');
  await refused(fix({ status: 'fin', chip: '', gun: '' }), 'time_needed', 'R9 a finisher must have a time');
  await refused(fix({ chip: '56:00' }, undefined, 'lead1'), 'director_only', 'R9 a lead cannot correct a result');
  await refused(fix({ chip: '56:00' }, undefined, 'boss', rid('101', EVB)), 'no_item', 'R9 a result of the other race is "no_item" here');
  await refused(fix({ chip: '56:00' }, undefined, 'boss', 'nope'), 'no_item', 'R9 a result that does not exist');
  const before = rows('RDResults').find((r) => r.bib === '102');
  const r1 = await fix({ chip: '56:00', gun: '56:05', note: 'photo finish checked' });
  ok(r1.ok && r1.changed.includes('chipCs') && r1.changed.includes('gunCs') && r1.changed.includes('note'), 'R9 a correction changes the time and the note');
  const after = rows('RDResults').find((r) => r.bib === '102');
  ok(after.chipCs === '336000' && JSON.parse(after.prev).chipCs === before.chipCs && after.by === 'boss', 'R9 the new time is saved and the old one is kept in the row, with who changed it');
  ok(rows('RDAudit').some((a) => a.action === 'result corrected' && a.detail.includes('checked the finish sheet')), 'R9 the correction and its reason are in the audit log');
  eq(await fix({ chip: '56:00' }), { ok: true, same: true }, 'R9 saving the same value again changes nothing');
  const g = await fix({ status: 'fin', chip: '1:00:00' }, 'timing mat found a time', 'boss', rid('106'));
  ok(g.ok && (await call('resBoard', 'boss')).rows.find((x) => x.bib === '106').status === 'fin', 'R9 a DNF becomes a finisher when a time is given');
  const dobFix = await fix({ dob: dob(52) }, 'age from the registration form', 'boss', rid('110'));
  ok(dobFix.ok, 'R9 a date of birth can be added');
  const bRow = (await call('resBoard', 'boss')).rows.find((x) => x.bib === '110');
  ok(bRow.age === 52 && !JSON.stringify(bRow).includes(String(Y - 52)), 'R9 the board shows the age, never the date of birth');
  // void
  await refused(call('resVoid', 'boss', { id: rid('103') }), 'reason_needed', 'R9 voiding needs a reason');
  await refused(call('resVoid', 'lead1', { id: rid('103'), reason: 'wrong bib' }), 'director_only', 'R9 a lead cannot void');
  await refused(call('resVoid', 'boss', { id: rid('103', EVB), reason: 'wrong bib' }), 'no_item', 'R9 a result of the other race cannot be voided from this one');
  eq(await call('resVoid', 'boss', { id: rid('103'), reason: 'wrong bib' }), { ok: true }, 'R9 a result can be voided with a reason');
  await refused(call('resVoid', 'boss', { id: rid('103'), reason: 'again' }), 'voided', 'R9 voiding twice is refused');
  await refused(fix({ chip: '56:00' }, undefined, 'boss', rid('103')), 'voided', 'R9 a voided result cannot be corrected');
  const b2 = await call('resBoard', 'boss');
  ok(b2.voided.length === 1 && b2.voided[0].bib === '103' && b2.voided[0].voidReason === 'wrong bib' && !b2.rows.some((x) => x.bib === '103'), 'R9 a voided result is listed apart and does not count');
  ok(rows('RDResults').find((r) => r.bib === '103'), 'R9 ...and the row is still in the database');
  await refused(call('resVoid', 'boss', { id: rid('104'), undo: true }), 'not_voided', 'R9 restoring a result that was not voided is refused');
  eq(await call('resVoid', 'boss', { id: rid('103'), undo: true }), { ok: true }, 'R9 a voided result can be restored');
  ok((await call('resBoard', 'boss')).rows.some((x) => x.bib === '103'), 'R9 ...and it counts again');
  ok(['result voided', 'result restored'].every((t) => rows('RDAudit').some((a) => a.action === t)), 'R9 voids and restores are in the audit log');
}

/* ---------- R10 settings change the answers ---------- */
{
  await call('resSaveSettings', 'boss', { settings: Object.assign({}, SETTINGS, { rankBy: 'gun' }) });
  const b = await call('resBoard', 'boss');
  const by = (x) => b.rows.find((r) => r.bib === x);
  eq(['101', '105'].map((x) => by(x).place), [3, 4], 'R10 ranking by gun time breaks the chip-time tie (101 finished the gun time before 105)');
  await call('resSaveSettings', 'boss', { settings: Object.assign({}, SETTINGS, { bands: [20, 40], overallExcl: false }) });
  const aw = await call('resAwards', 'boss');
  const f = aw.awards.cats.find((c) => c.cat === '10 K').groups.find((g) => g.gender === 'F');
  ok(aw.bands.join('|') === 'Under 20|20-39|40+' && f.ageGroups.some((g) => g.band === '20-39' && g.list.some((x) => x.bib === '101')), 'R10 with other age groups, and "also in age group" switched on, the overall winners are in their age group too');
  await call('resSaveSettings', 'boss', { settings: SETTINGS });
}

/* ---------- R11 the other race ---------- */
{
  const b = await call('resBoard', 'boss', {}, EVB);
  eq(b.rows.length, 0, 'R11 the other race has no results of its own yet, and none of this race');
  await call('resSaveSettings', 'boss', { settings: SETTINGS }, EVB);
  await call('resSaveWaves', 'boss', { rev: 0, waves: [{ cat: '10 K', name: 'Only wave', start: '07:00', corrals: 'A', cap: 0 }] }, EVB);
  const a = await call('resAssign', 'boss', { mode: 'bib' }, EVB);
  eq([a.placed, a.unplaced], [1, 0], 'R11 the other race places its own one runner');
  const imp = await call('resImport', 'boss', { text: 'bib,chip\n101,54:00\n' }, EVB);
  eq(imp.saved, 1, 'R11 results are saved for the other race (bib 101 there is another runner)');
  eq((await call('resBoard', 'boss', {}, EVB)).rows.map((x) => [x.bib, x.name]), [['101', 'Other Race Olga']], 'R11 the other race shows its own runner under bib 101');
  const mine = await call('resBoard', 'boss');
  ok(mine.rows.find((x) => x.bib === '101').name === 'Asha' && mine.rows.length === 12, 'R11 this race is unchanged: bib 101 is still Asha, and there are 12 results');
  ok(rows('RDWaveAssign').filter((x) => x.event === EVA).every((x) => x.regId.includes(EVA.slice(-6))) && rows('RDWaveAssign').filter((x) => x.event === EVB).every((x) => x.regId.includes(EVB.slice(-6))), 'R11 every placement points at a registration of its own race');
  ok(['results settings saved', 'waves saved', 'runners placed in waves', 'results imported'].every((t) => rows('RDAudit').some((a2) => a2.action === t)), 'R11 settings, waves, placing and importing are all in the audit log');
}
done();
