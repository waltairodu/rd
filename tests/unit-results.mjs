// UNIT TESTS (Results rules): times, bibs, gender, date of birth and age, age bands, settings, ranking, awards, waves and
// corrals, and the results-file reader. The library has no database and no Wix in it, so every rule is tested on its own.
import * as L from './rd-results.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: Results rules');

const HOSTILE = [undefined, null, true, false, 0, -1, 1.5, NaN, Infinity, 5400, '', ' ', 'x'.repeat(5000), '\u0000', '\u202e', {}, [], [[]], { toString() { throw new Error('boom'); } }, () => 1, Symbol('s').description];
const noThrow = (fn) => HOSTILE.every((h) => { try { fn(h); return true; } catch (e) { return false; } });

/* ---------- U1 times ---------- */
{
  const T = L.parseTime;
  eq([T('1:45:30'), T('45:30'), T('1:45:30.5'), T('1:45:30.567'), T('1:45:30.05'), T('0:00:00.01'), T(' 2:00:00 ')], [633000, 273000, 633050, 633056, 633005, 1, 720000], 'U1 times read as centiseconds; hundredths are cut, never rounded');
  eq([T('0:00:00'), T('0:00'), T('1:60:00'), T('1:45:60'), T('48:00:00'), T('99:99:99'), T('1:2:3'), T('1:45:30.'), T('1,45,30'), T('abc'), T('-1:00:00'), T('1:45:30 pm'), T('１:45:30')], [null, null, null, null, null, null, null, null, null, null, null, null, null], 'U1 times that are not times (zero, 60 minutes, 48 hours, one-digit seconds, commas, words, minus, full-width digits) give null');
  ok(T('47:59:59.99') === 47 * 360000 + 59 * 6000 + 5999 && T('47:59:59.99') <= L.MAX_CS, 'U1 the longest time is 47:59:59.99, inside the 48 hour limit');
  ok(HOSTILE.every((h) => T(h) === null), 'U1 numbers, lists, objects, null and other non-text never pass as a time');
  eq([L.fmtTime(633000), L.fmtTime(633050), L.fmtTime(633005), L.fmtTime(633000, true), L.fmtTime(6000), L.fmtTime(0), L.fmtTime(-5), L.fmtTime(NaN), L.fmtTime('x'), L.fmtTime(null)], ['1:45:30', '1:45:30.50', '1:45:30.05', '1:45:30.00', '0:01:00', '', '', '', '', ''], 'U1 times are written back as h:mm:ss, with hundredths only when there are some');
  ok(noThrow(L.fmtTime) && noThrow(L.parseTime), 'U1 neither time function throws on hostile input');
  eq([L.catKm('25 K - Debut Trail', []), L.catKm('10K', []), L.catKm('Half Marathon', []), L.catKm('Marathon', []), L.catKm('Fun Run', []), L.catKm('10 K', [{ name: '10 K', km: 9.8 }]), L.catKm('0 K', []), L.catKm('900 K', [])], [25, 10, 21.0975, 42.195, null, 9.8, null, null], 'U1 the distance comes from the category list first, then from the name');
  eq([L.paceWarn(100000, 10), L.paceWarn(330000, 10), L.paceWarn(2500000, 10), L.paceWarn(0, 10), L.paceWarn(330000, null)], ['fast', '', 'slow', '', ''], 'U1 a pace under 2:30 or over 40:00 a km is flagged as a typing slip');
}

/* ---------- U2 bibs ---------- */
{
  eq([L.bibKey('101'), L.bibKey(' ab-12 '), L.bibKey(101), L.bibKey('0123'), L.bibKey('A'.repeat(12)), L.bibKey('A'.repeat(13)), L.bibKey(''), L.bibKey('1 2'), L.bibKey('1/2'), L.bibKey("1'"), L.bibKey('<b>'), L.bibKey(-1), L.bibKey(1.5), L.bibKey(null), L.bibKey({}), L.bibKey(['1'])], ['101', 'AB-12', '101', '0123', 'A'.repeat(12), '', '', '', '', '', '', '', '', '', '', ''], 'U2 a bib is 1 to 12 letters, digits or dashes; anything else is no bib');
  eq(['2', '10', 'A1', 'B1', '1A'].sort(L.bibCmp), ['2', '10', '1A', 'A1', 'B1'], 'U2 bibs sort as numbers first (2 before 10), then with letters');
  const m = new Map([['123', 'x'], ['A9', 'y']]);
  eq([L.findByBib(m, '123'), L.findByBib(m, '0123'), L.findByBib(m, 'A9'), L.findByBib(m, '0A9'), L.findByBib(m, ''), L.findByBib(m, '124')], ['x', 'x', 'y', null, null, null], 'U2 a timing file that drops leading zeros still finds the bib');
  ok(noThrow(L.bibKey), 'U2 bibKey never throws');
  const m2 = new Map([['0102', 'p'], ['7', 'q'], ['007', 'r'], ['00', 's']]);
  eq([L.findByBib(m2, '102'), L.findByBib(m2, '0102'), L.findByBib(m2, '00102'), L.findByBib(m2, '7'), L.findByBib(m2, '07'), L.findByBib(m2, '007'), L.findByBib(m2, '0'), L.findByBib(m2, 'X1'), L.findByBib(null, '1'), L.findByBib(m2, 5)], ['p', 'p', 'p', 'q', null, 'r', 's', null, null, null], 'U2 a file that drops a leading zero finds the registered bib; with two registered bibs of the same number ("7" and "007") nothing is guessed');
}

/* ---------- U3 gender, date of birth, age ---------- */
{
  eq(['Male', 'm', 'MEN', ' f ', 'Female', 'woman', 'M.', 'other', 'Non-binary', 'x', 'prefer not to say', '', 'male female', '1'].map(L.normGender), ['M', 'M', 'M', 'F', 'F', 'F', 'M', 'X', 'X', 'X', '', '', '', ''], 'U3 gender words become M, F or X; anything else is "not recorded"');
  ok(HOSTILE.every((h) => L.normGender(h) === ''), 'U3 non-text gender is never read');
  eq(['1989-05-12', '12/05/1989', '12-5-1989', '12.05.1989', '12 May 1989', 'May 12, 1989', '05/06/1990', '12/25/1990', '1989-05-12T10:00:00Z', '1990-6-5'].map(L.normDob), ['1989-05-12', '1989-05-12', '1989-05-12', '1989-05-12', '1989-05-12', '1989-05-12', '1990-06-05', '1990-12-25', '1989-05-12', '1990-06-05'], 'U3 dates of birth in the usual shapes become ISO dates, day first');
  eq(['31/02/1990', '1990-13-01', '00/00/0000', '12/05/1800', '12/05/2200', 'yesterday', '', '32/01/1990', '1990-02-29', '2000-02-29'].map(L.normDob), ['', '', '', '', '', '', '', '', '', '2000-02-29'], 'U3 impossible dates (31 February, month 13, 1800, 29 February in a common year) give nothing; a real leap day is kept');
  ok(HOSTILE.every((h) => L.normDob(h) === ''), 'U3 non-text date of birth is never read');
  eq([L.ageOn('1990-06-15', '2027-06-14'), L.ageOn('1990-06-15', '2027-06-15'), L.ageOn('1990-06-15', '2027-12-31'), L.ageOn('2030-01-01', '2027-01-01'), L.ageOn('1890-01-01', '2027-01-01'), L.ageOn('1990-06-15', 'x'), L.ageOn(null, '2027-01-01'), L.ageOn('2027-01-01', '2027-01-01')], [36, 37, 37, null, null, null, null, 0], 'U3 age counts completed years: the day before the birthday is still the old age; a future or 120+ year-old birth gives null');
  eq([L.ageDate('2027-02-07', 'raceday'), L.ageDate('2027-02-07', 'yearend'), L.ageDate('2027-02-07', 'x'), L.ageDate('bad', 'raceday'), L.ageDate(null, 'raceday')], ['2027-02-07', '2027-12-31', '2027-02-07', '', ''], 'U3 the age date is the race day or 31 December of the race year');
  eq(['35', 35, ' 35 ', '3', '2', '110', '111', '35.5', 'abc', '', null, undefined, {}, [], '١٢'].map(L.declaredAge), [35, 35, 35, 3, null, 110, null, null, null, null, null, null, null, null, null], 'U3 a written-down age is a whole number from 3 to 110');
  eq([L.ageOf({ dob: '1990-06-15' }, '2027-02-07', 'raceday'), L.ageOf({ dob: '1990-06-15' }, '2027-02-07', 'yearend'), L.ageOf({ age: '40' }, '2027-02-07', 'raceday'), L.ageOf({ dob: '2030-01-01', age: 41 }, '2027-02-07', 'raceday'), L.ageOf({ dob: '', age: '' }, '2027-02-07', 'raceday'), L.ageOf(null, '2027-02-07', 'raceday'), L.ageOf({ dob: '1990-06-15' }, '', 'raceday')], [36, 37, 40, 41, null, null, null], 'U3 the date of birth wins over a written age; an impossible date of birth falls back to the written age; nothing known gives null');
  eq([[18, 30], '18, 30 40;50', [], '', [5, 99], [4], [100], ['a'], [18, 18], [30, 18], [18.5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], null, {}, 'x'].map(L.cleanBands), [[18, 30], [18, 30, 40, 50], [], [], [5, 99], null, null, null, null, null, null, null, null, null, null], 'U3 band boundaries: whole numbers 5 to 99, rising, at most 12');
  eq([L.bandList([18, 30, 40, 50, 60]), L.bandList([]), L.bandList(null), L.bandList([40])], [['Under 18', '18-29', '30-39', '40-49', '50-59', '60+'], ['All ages'], ['All ages'], ['Under 40', '40+']], 'U3 the age groups are named from the boundaries');
  const B = [18, 30, 40, 50, 60];
  eq([17, 18, 29, 30, 59, 60, 99].map((a) => L.bandOf(a, B)), ['Under 18', '18-29', '18-29', '30-39', '50-59', '60+', '60+'], 'U3 a runner is in the band their age falls in, boundaries included');
  eq(L.bandOf(25, []), 'All ages', 'U3 with no boundaries everyone is in one band');
}

/* ---------- U4 settings ---------- */
{
  const D = L.cleanSettings({});
  eq(D, { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: '', dob: '', age: '', seed: '' } }, 'U4 empty settings are the defaults');
  const bad = (v) => { try { L.cleanSettings(v); return false; } catch (e) { return e.message === 'bad_settings'; } };
  ok([null, undefined, [], 'x', 5, true, { rankBy: 'x' }, { rankBy: 5 }, { ageRule: 'x' }, { bands: 'x' }, { bands: [30, 18] }, { overallDepth: 0 }, { overallDepth: 11 }, { overallDepth: 2.5 }, { overallDepth: 'x' }, { groupDepth: -1 }, { overallExcl: 'yes' }, { overallExcl: 1 }, { map: 'x' }, { map: null }, { map: [] }].every(bad), 'U4 settings that make no sense are refused with bad_settings (21 kinds)');
  const s = L.cleanSettings({ rankBy: 'gun', ageRule: 'yearend', bands: '20,40', overallDepth: '5', groupDepth: 2, overallExcl: false, map: { gender: ' Sex ', dob: 'DOB', age: '', seed: 'Expected', evil: 'x', '__proto__': 'y' }, extra: 1, '__proto__': { x: 1 } });
  eq(s, { rankBy: 'gun', ageRule: 'yearend', bands: [20, 40], overallDepth: 5, groupDepth: 2, overallExcl: false, map: { gender: 'Sex', dob: 'DOB', age: '', seed: 'Expected' } }, 'U4 only the known settings are kept; extra names are dropped');
  ok(L.cleanSettings({ map: { gender: { toString: 1 }, dob: ['x'], age: 5, seed: null } }).map.gender === '', 'U4 field names that are not text are dropped');
  eq([L.settingsOf(undefined), L.settingsOf('{bad json'), L.settingsOf('{"rankBy":"nope"}'), L.settingsOf('[1]'), L.settingsOf('null')], [D, D, D, D, D], 'U4 stored settings that are missing or damaged fall back to the defaults, so a bad row can never stop a screen');
  eq(L.settingsOf(JSON.stringify({ rankBy: 'gun' })).rankBy, 'gun', 'U4 good stored settings are read');
}

/* ---------- U5 what a registration says ---------- */
const FORM = (g, d, a, e) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: a }, { name: 'Expected', value: e }]);
const MAP = { gender: 'Gender', dob: 'Date of birth', age: 'Age', seed: 'Expected' };
{
  const reg = { _id: 'E~1', bib: '0123', name: 'Asha K', cat: '10 K', status: 'ok', form: FORM('Female', '15/06/1990', ' 36 ', '55:00') };
  eq(L.regInfo(reg, MAP), { id: 'E~1', bib: '0123', name: 'Asha K', cat: '10 K', gender: 'F', dob: '1990-06-15', age: 36, seedCs: 330000, paid: true }, 'U5 a registration gives bib, name, category, gender, date of birth, age and expected time');
  eq(L.regInfo(reg, {}), { id: 'E~1', bib: '0123', name: 'Asha K', cat: '10 K', gender: '', dob: '', age: null, seedCs: 0, paid: true }, 'U5 with no questions chosen nothing is read from the form');
  const odd = L.regInfo({ _id: 'x', bib: '1 2', name: 'A\u0000B\u202e', cat: 'C\n', status: 'unpaid', form: '{bad' }, MAP);
  eq([odd.bib, odd.name, odd.cat, odd.paid, odd.gender], ['', 'A B', 'C', false, ''], 'U5 a damaged form and odd text give safe values');
  ok(noThrow((h) => L.regInfo(h, MAP)) && noThrow((h) => L.regInfo({ form: h, _id: 1 }, h)), 'U5 regInfo never throws on hostile input');
  const fa = L.formAnswers(JSON.stringify([{ name: 'A', value: '1' }, { name: 'A', value: '2' }, { name: 'B', value: 5 }, { name: 7, value: 'x' }, null, 'x']));
  eq([...fa.entries()], [['A', '1'], ['B', '']], 'U5 form answers: the first answer to a question counts; non-text answers and malformed items are ignored');
  const ff = L.formFields([{ form: FORM('M', '1/1/1990', '36', '') }, { form: FORM('F', '2/2/1991', '', '') }, { form: FORM('M', '3/3/1992', '30', '') }, { form: FORM('F', '4/4/1993', '31', '') }, { form: '[]' }]);
  eq(ff.map((x) => [x.name, x.count, x.sample.length]), [['Gender', 4, 2], ['Date of birth', 4, 3], ['Age', 3, 3], ['Expected', 0, 0]], 'U5 each question is listed with how many answered and up to three different sample answers');
}

/* ---------- U6 ranking and the board ---------- */
{
  eq([...L.placeAll([{ id: 'a', t: 10 }, { id: 'b', t: 20 }, { id: 'c', t: 20 }, { id: 'd', t: 30 }]).entries()], [['a', 1], ['b', 2], ['c', 2], ['d', 4]], 'U6 the same time shares a place and the next place is skipped (1, 2, 2, 4)');
  eq([L.timeOf({ chipCs: '100', gunCs: '120' }, 'chip'), L.timeOf({ chipCs: '100', gunCs: '120' }, 'gun'), L.timeOf({ chipCs: 100 }, 'gun'), L.timeOf({ gunCs: 120 }, 'chip'), L.timeOf({}, 'chip'), L.timeOf({ chipCs: -5, gunCs: 'x' }, 'chip')], [100, 120, 100, 120, 0, 0], 'U6 a runner is ranked on the chip or gun time as chosen, else on the other one');
  const st = L.cleanSettings({});
  const regsList = [
    { _id: 'E~101', bib: '101', name: 'Asha', cat: '10 K', status: 'ok', form: FORM('Female', '15/06/1990', '', '') },
    { _id: 'E~102', bib: '102', name: 'Bina', cat: '10 K', status: 'ok', form: FORM('F', '1995-03-01', '', '') },
    { _id: 'E~103', bib: '103', name: 'Chitra', cat: '10 K', status: 'ok', form: FORM('F', '2000-01-01', '', '') },
    { _id: 'E~104', bib: '104', name: 'Dev', cat: '10 K', status: 'ok', form: FORM('M', '1980-01-01', '', '') },
    { _id: 'E~105', bib: '105', name: 'Esha', cat: '10 K', status: 'ok', form: FORM('F', '1990-06-15', '', '') },
    { _id: 'E~106', bib: '106', name: 'Farid', cat: '10 K', status: 'ok', form: FORM('M', '', '17', '') },
    { _id: 'E~109', bib: '109', name: 'Gopal', cat: '10 K', status: 'ok', form: FORM('M', '', '25', '') },
    { _id: 'E~110', bib: '110', name: 'Hari', cat: '10 K', status: 'ok', form: FORM('', '', '', '') },
    { _id: 'E~201', bib: '201', name: 'Indu', cat: '21 K', status: 'ok', form: FORM('F', '1985-01-01', '', '') },
  ];
  const regs = new Map(regsList.map((r) => L.regInfo(r, MAP)).map((i) => [i.bib, i]));
  const R = (id, bib, status, chip, gun, extra) => Object.assign({ _id: id, bib, status, chipCs: String(chip || 0), gunCs: String(gun || 0) }, extra || {});
  const results = [
    R('r1', '101', 'fin', 330000, 331000), R('r2', '102', 'fin', 336000, 337000), R('r3', '103', 'fin', 342000, 343000), R('r4', '104', 'fin', 300000, 301000), R('r5', '105', 'fin', 330000, 331500),
    R('r6', '106', 'dnf', 0, 0), R('r7', '777', 'fin', 400000, 401000, { name: 'Walk In', cat: '10 K', gender: 'Male', age: '45' }), R('r8', '108', 'fin', 310000, 311000, { void: 'yes', voidReason: 'wrong bib', voidBy: 'boss', voidAt: 't' }),
    R('r9', '109', 'fin', 0, 100000), R('r10', '110', 'fin', 350000, 351000), R('r11', '201', 'fin', 900000, 901000), R('r12', '101', 'zzz', 5, 5, { _id: 'r12' }),
  ];
  results.pop(); // (a damaged status is checked below)
  const b = L.board(results, regs, { settings: st, raceDate: '2027-02-07', cats: [] });
  const by = (bib) => b.rows.find((x) => x.bib === bib);
  eq(b.rows.map((x) => x.bib), ['101', '105', '102', '103', '104', '109', '110', '777', '106', '201'].sort((x, y) => 0) && b.rows.map((x) => x.bib), 'U6 (rows listed)');
  eq(['109', '104', '101', '105', '102', '103', '110', '777'].map((k) => by(k).place), [1, 2, 3, 3, 5, 6, 7, 8], 'U6 overall places in a category follow the time, ties share a place (3, 3, then 5); a runner with only a gun time is ranked on it');
  eq(['101', '105', '102', '103'].map((k) => by(k).gplace), [1, 1, 3, 4], 'U6 women are placed among women (tie, then 3, 4)');
  eq(['109', '104'].map((k) => by(k).gplace), [1, 2], 'U6 men are placed among men');
  eq(['101', '105', '102', '103', '104', '109', '106'].map((k) => by(k).ageGroup), ['30-39', '30-39', '30-39', '18-29', '40-49', '18-29', 'Under 18'], 'U6 age groups come from the date of birth on race day, or the written age');
  eq(['101', '105', '102', '103'].map((k) => by(k).aplace), [1, 1, 3, 1], 'U6 age-group places are among the same gender in the same band');
  eq([by('777').gender, by('777').age, by('777').name, by('777').flags], ['M', 45, 'Walk In', ['unmatched']], 'U6 a bib that is not registered is shown with what the file said, and is flagged');
  ok(by('110').flags.includes('nogender') && by('110').flags.includes('noage') && by('110').aplace === null && by('110').gplace === null, 'U6 a finisher with no gender and no age is flagged and gets no gender or age-group place');
  ok(by('109').flags.includes('nochip') && by('109').flags.includes('fast'), 'U6 a finisher with no chip time is flagged, and a 10 K in 16 minutes is flagged as fast');
  ok(by('106').status === 'dnf' && by('106').place === null && b.summary.dnf === 1, 'U6 a DNF has no place');
  ok(b.voided.length === 1 && b.voided[0].bib === '108' && b.voided[0].voidReason === 'wrong bib' && !b.rows.some((x) => x.bib === '108'), 'U6 a voided result is listed apart and does not count');
  eq([b.summary.total, b.summary.fin, b.summary.dnf, b.summary.unmatched, b.summary.noGender, b.summary.noAge, b.summary.voided], [10, 9, 1, 1, 1, 1, 1], 'U6 the summary counts finishers, DNFs and problems');
  eq(b.summary.cats.map((c) => [c.cat, c.fin, c.dnf]), [['10 K', 8, 1], ['21 K', 1, 0]], 'U6 the summary is per category');
  eq(L.board([R('x1', '101', 'weird', 5, 5)], regs, { settings: st, raceDate: '2027-02-07', cats: [] }).rows[0].status, 'dnf', 'U6 a damaged status is shown as DNF and never ranked');
  const gun = L.board([R('g1', '101', 'fin', 500, 300), R('g2', '102', 'fin', 100, 400)], regs, { settings: L.cleanSettings({ rankBy: 'gun' }), raceDate: '2027-02-07', cats: [] });
  eq(gun.rows.map((x) => [x.bib, x.place]), [['101', 1], ['102', 2]], 'U6 ranking by gun time reverses the order of this pair');
  const ye = L.board([R('y1', '101', 'fin', 330000, 0)], regs, { settings: L.cleanSettings({ ageRule: 'yearend' }), raceDate: '2027-02-07', cats: [] });
  eq(ye.rows[0].age, 37, 'U6 with the year-end rule the age is worked out on 31 December');
  eq(L.board([], regs, { settings: st, raceDate: '', cats: [] }).summary.total, 0, 'U6 no results gives an empty board');
  ok(noThrow((h) => L.board([{ _id: h, bib: h, status: h, chipCs: h, gunCs: h, gender: h, dob: h, age: h, cat: h, name: h, note: h }], regs, { settings: st, raceDate: '2027-02-07', cats: [] })), 'U6 a result row full of hostile values never makes the board throw');
  ok(!JSON.stringify(b).includes('1990-06-15') && !JSON.stringify(b).includes('1995-03-01'), 'U6 no date of birth is in the board');

  /* ---------- U7 awards ---------- */
  const aw = L.computeAwards(b.rows, st);
  const cat10 = aw.cats.find((c) => c.cat === '10 K');
  const women = cat10.groups.find((g) => g.gender === 'F');
  const men = cat10.groups.find((g) => g.gender === 'M');
  eq(women.overall.map((x) => [x.bib, x.place]), [['101', 1], ['105', 1], ['102', 3]], 'U7 women overall: a tie for first takes both, then third place (depth 3)');
  eq(men.overall.map((x) => [x.bib, x.place]), [['109', 1], ['104', 2], ['777', 3]], 'U7 men overall: the top three');
  eq(women.ageGroups.map((g) => [g.band, g.list.map((x) => x.bib)]), [['18-29', ['103']]], 'U7 a runner who took an overall place is not in the age-group list again (the 30-39 women all did)');
  eq(women.ageGroups[0].finishers, 1, 'U7 the age group shows how many finished in it');
  const noExcl = L.computeAwards(b.rows, L.cleanSettings({ overallExcl: false }));
  const w2 = noExcl.cats.find((c) => c.cat === '10 K').groups.find((g) => g.gender === 'F');
  eq(w2.ageGroups.map((g) => [g.band, g.list.map((x) => x.bib)]), [['18-29', ['103']], ['30-39', ['101', '105', '102']]], 'U7 with the "also in age group" setting the overall winners are in their age group too');
  eq(cat10.missing.map((m) => [m.bib, m.why]), [['110', 'gender']], 'U7 a finisher with no gender is listed as missing, and no award is given to them');
  const d1 = L.computeAwards(b.rows, L.cleanSettings({ overallDepth: 1, groupDepth: 1 }));
  eq(d1.cats.find((c) => c.cat === '10 K').groups.find((g) => g.gender === 'F').overall.map((x) => x.bib), ['101', '105'], 'U7 depth one still gives both runners tied for first');
  eq(aw.cats.map((c) => c.cat), ['10 K', '21 K'], 'U7 categories are in order');
  ok(!JSON.stringify(aw).includes('1990-06-15') && aw.cats[0].groups.every((g) => g.overall.every((x) => !('dob' in x))), 'U7 no date of birth in the awards');
  ok(noThrow((h) => L.computeAwards([{ status: 'fin', t: h, cat: h, gender: h, ageGroup: h, bib: h }], { overallDepth: h, groupDepth: h, bands: h })), 'U7 awards never throw on hostile rows');
}

/* ---------- U8 waves and corrals ---------- */
{
  const bad = (list, ctx) => { try { L.cleanWaves(list, ctx); return false; } catch (e) { return e.message === 'bad_waves'; } };
  const W = (o) => Object.assign({ cat: '10 K', name: 'Wave 1', start: '06:00', corrals: 'A, B', cap: 100 }, o || {});
  const ok1 = L.cleanWaves([W(), W({ name: 'Wave 2', start: '06:10', corrals: ['C'], cap: '50' })], { cats: ['10 K', '21 K'] });
  eq(ok1.waves, [{ id: 'w1', cat: '10 K', name: 'Wave 1', start: '06:00', corrals: ['A', 'B'], cap: 100 }, { id: 'w2', cat: '10 K', name: 'Wave 2', start: '06:10', corrals: ['C'], cap: 50 }], 'U8 waves are read, given ids, and put in start order');
  eq(ok1.next, 3, 'U8 the next new id is counted on');
  eq(L.cleanWaves([W({ cat: '10k' })], { cats: ['10 K'] }).waves[0].cat, '10 K', 'U8 a category typed loosely is matched to the real one');
  eq(L.cleanWaves([W({ id: 'w5', name: 'Old' }), W({ name: 'New', start: '07:00' })], { ids: ['w5'], next: 6 }).waves.map((w) => w.id), ['w5', 'w6'], 'U8 an existing id is kept, and a new one takes the next number');
  ok([
    'x', null, {}, [null], [[]], ['x'], Array.from({ length: 41 }, (_, i) => W({ name: 'W' + i })),
    [W({ name: '' })], [W({ name: '-x' })], [W({ name: 'x'.repeat(31) })], [W({ name: '<b>' })], [W({ cat: '' })], [W({ cat: 5 })], [W({ cat: 'Nope' })],
    [W({ start: '24:00' }), ], [W({ start: '6:00' })], [W({ start: '06:60' })], [W({ start: '06:00:00' })], [W({ start: 600 })], [W({ start: null })],
    [W(), W()], [W(), W({ name: 'WAVE 1' })], [W({ corrals: 'A, a' })], [W({ corrals: Array.from({ length: 9 }, (_, i) => 'C' + i) })], [W({ corrals: ['A'.repeat(13)] })], [W({ corrals: ['<i>'] })], [W({ corrals: {} })], [W({ corrals: [{}] })],
    [W({ cap: -1 })], [W({ cap: 5001 })], [W({ cap: 1.5 })], [W({ cap: 'x' })], [W({ cap: {} })], [W({ id: 'w9' })], [W({ id: 'x1' })], [W({ id: 'w1' }), W({ id: 'w1', name: 'Dup' })],
  ].every((l, i) => bad(l, { cats: ['10 K', '21 K'], ids: ['w1'] })), 'U8 waves that make no sense are refused (37 kinds: not a list, 41 waves, bad names, categories, times, corrals, capacities, ids)');
  eq(L.cleanWaves([W({ cap: '' }), W({ name: 'No cap', cap: undefined, start: '07:00' }), W({ name: 'Null cap', cap: null, start: '08:00' })], {}).waves.map((w) => w.cap), [0, 0, 0], 'U8 no capacity means no limit');
  eq(L.cleanWaves([W({ corrals: undefined })], {}).waves[0].corrals, [], 'U8 a wave may have no corrals');
  eq(L.wavesOf(JSON.stringify({ waves: ok1.waves, next: 3, rev: 4 })), { waves: ok1.waves, next: 3, rev: 4 }, 'U8 stored waves are read back');
  eq([L.wavesOf(undefined), L.wavesOf('{bad'), L.wavesOf('{"waves":"x"}'), L.wavesOf('{"waves":[{"cat":""}],"rev":2}')], [{ waves: [], next: 1, rev: 0 }, { waves: [], next: 1, rev: 0 }, { waves: [], next: 1, rev: 0 }, { waves: [], next: 1, rev: 2 }], 'U8 stored waves that are missing or damaged become an empty list');

  const ws = [{ id: 'w1', corrals: ['A', 'B'], cap: 3 }, { id: 'w2', corrals: ['C'], cap: 0 }];
  const run = (id, bib, seed, extra) => Object.assign({ id, bib, seedCs: seed, wave: '', corral: '', how: '' }, extra || {});
  const rs = [run('a', '5', 400000), run('b', '3', 300000), run('c', '9', 0), run('d', '1', 500000), run('e', '2', 350000), run('f', '4', 0)];
  const r1 = L.autoAssign(rs, ws, { mode: 'seed' });
  eq(Object.entries(r1.placed).map(([k, v]) => [k, v.wave, v.corral]).sort(), [['a', 'w1', 'B'], ['b', 'w1', 'A'], ['c', 'w2', 'C'], ['d', 'w2', 'C'], ['e', 'w1', 'A'], ['f', 'w2', 'C']], 'U8 the fastest expected times fill the first wave up to its capacity, the rest go on; runners with no time go last');
  eq(r1.unplaced, [], 'U8 nobody is left out when there is room');
  const r2 = L.autoAssign(rs, ws, { mode: 'bib' });
  eq(Object.entries(r2.placed).filter(([, v]) => v.wave === 'w1').map(([k]) => k).sort(), ['d', 'e', 'b'].sort(), 'U8 bib order fills the first wave with bibs 1, 2, 3');
  const r3 = L.autoAssign(rs, [{ id: 'w1', corrals: [], cap: 2 }], { mode: 'seed' });
  eq([Object.keys(r3.placed).length, r3.unplaced.length], [2, 4], 'U8 runners who do not fit are returned as unplaced');
  eq(Object.values(r3.placed).map((v) => v.corral), ['', ''], 'U8 a wave with no corrals gives no corral');
  const kept = [run('a', '5', 400000, { wave: 'w1', corral: 'A', how: 'manual' }), run('b', '3', 300000, { wave: 'w1', corral: 'B', how: 'auto' }), run('c', '9', 0)];
  const r4 = L.autoAssign(kept, [{ id: 'w1', corrals: ['A', 'B'], cap: 2 }, { id: 'w2', corrals: [], cap: 0 }], { mode: 'seed' });
  eq([r4.placed.a, r4.placed.b, r4.placed.c], [undefined, undefined, { wave: 'w2', corral: '' }], 'U8 without redo, runners already placed (by hand or earlier) stay, use up room, and only the new one is placed');
  const r5 = L.autoAssign(kept, [{ id: 'w1', corrals: ['A', 'B'], cap: 2 }, { id: 'w2', corrals: [], cap: 0 }], { mode: 'seed', redo: true });
  eq([r5.placed.a, r5.placed.b && r5.placed.b.wave, r5.placed.c && r5.placed.c.wave], [undefined, 'w1', 'w2'], 'U8 with redo, the automatic placements are made again and the manual one still never moves');
  eq(L.autoAssign([run('z', '1', 0, { wave: 'gone', how: 'manual' })], ws, { mode: 'bib' }).placed.z.wave, 'w1', 'U8 a placement in a wave that no longer exists does not count');
  eq(L.autoAssign([], ws, {}), { placed: {}, unplaced: [] }, 'U8 no runners, nothing to do');
  ok(noThrow((h) => L.autoAssign([{ id: h, bib: h, seedCs: h, wave: h, corral: h, how: h }], [{ id: 'w1', corrals: h, cap: h }], { mode: h })), 'U8 autoAssign never throws on hostile rows');

  const sl = L.startList([{ id: '1', bib: '12', name: 'A', cat: '10 K', wave: 'w1', corral: 'B' }, { id: '2', bib: '3', name: 'B', cat: '10 K', wave: 'w1', corral: 'B' }, { id: '3', bib: '7', name: 'C', cat: '10 K', wave: 'w1', corral: 'Z' }, { id: '4', bib: '', name: 'D', cat: '21 K', wave: '', corral: '' }, { id: '5', bib: '8', name: 'E', cat: '21 K', wave: 'w9', corral: '' }],
    [{ id: 'w1', cat: '10 K', name: 'Wave 1', start: '06:00', corrals: ['A', 'B'], cap: 5 }]);
  eq(sl.sections.map((s) => [s.name, s.count, s.corrals.map((c) => [c.corral, c.runners.map((r) => r.bib)])]), [['Wave 1', 3, [['A', []], ['B', ['3', '12']], ['(no corral)', ['7']]]]], 'U8 the start list has a section per wave, runners in bib order in each corral, and strays in "(no corral)"');
  eq(sl.unassigned.map((r) => r.id), ['5', '4'], 'U8 runners with no wave (or a wave that is gone) are listed last, in bib order');
}

/* ---------- U9 reading a results file ---------- */
{
  const regsList = [
    { _id: 'E~101', bib: '101', name: 'Asha', cat: '10 K - Trail', status: 'ok', form: FORM('F', '15/06/1990', '', '') },
    { _id: 'E~102', bib: '0102', name: 'Bina', cat: '10 K - Trail', status: 'ok', form: '[]' },
    { _id: 'E~201', bib: '201', name: 'Indu', cat: '21 K', status: 'ok', form: '[]' },
  ];
  const regs = new Map(regsList.map((r) => L.regInfo(r, MAP)).map((i) => [i.bib, i]));
  const ctx = { regs, known: ['10 K - Trail', '21 K'], rankBy: 'chip' };
  const rd = (t, c) => L.readResults(t, c || ctx);
  const a = rd('Bib,Name,Time,Category\n101,Whoever,"1:05:30",10K\n102,,59:10.5,\n201,,2:05:00.25,21 K\n');
  eq(a.items.map((i) => [i.bib, i.name, i.cat, i.status, i.chipCs, i.gunCs, i.matched]), [['101', 'Asha', '10 K - Trail', 'fin', 393000, 0, true], ['0102', 'Bina', '10 K - Trail', 'fin', 355050, 0, true], ['201', 'Indu', '21 K', 'fin', 750025, 0, true]], 'U9 a plain results file is read; the registration decides the name; "10K" is matched to "10 K - Trail"; a dropped zero in the bib still matches');
  eq(a.errors, [], 'U9 a good file has no errors');
  eq(rd('bib,time\n101,1:05:30', Object.assign({}, ctx, { rankBy: 'gun' })).items[0].gunCs, 393000, 'U9 a plain time is taken as the gun time when ranking by gun');
  const b = rd('bib;chip;gun;status\n101;1:00:00;1:00:05;\n102;;;DNF\n201;;;dns\n');
  eq(b.items.map((i) => [i.bib, i.status, i.chipCs, i.gunCs]), [['101', 'fin', 360000, 360500], ['0102', 'dnf', 0, 0], ['201', 'dns', 0, 0]], 'U9 semicolons work as separators; chip and gun are both kept; DNF and DNS need no time');
  eq(rd('bib\ttime\n101\t1:00:00\n').items.length, 1, 'U9 tab-separated files (pasted from a sheet) work');
  eq(rd('\ufeffbib,time\r\n101,1:00:00\r\n\r\n102,1:01:00\r\n').items.length, 2, 'U9 a byte-order mark, Windows line ends and blank lines are fine');
  eq(rd('bib,name,time\n101,"Smith, John ""JJ""",1:00:00\n').items[0].name, 'Asha', 'U9 quoted cells with commas and quotes are read (the registered name still wins)');
  const e = rd('bib,time\n101,1:00:00\n101,1:01:00\nABC!,1:00:00\n,1:00:00\n102,abc\n102,25:61\n999,1:00:00\n201,\n102,1:02:00\n');
  eq(e.errors.map((x) => x.line), [3, 4, 5, 6, 7, 8, 9], 'U9 every bad line is reported with its line number: duplicate bib, bad bib, no bib, bad time x2, unknown bib, no time');
  ok(e.errors[0].text.includes('line 2') && e.errors[4].text.includes('is not a time'), 'U9 the error says what is wrong and where the first copy was');
  eq(e.items.map((i) => i.bib), ['101', '0102'], 'U9 the good lines are still read (the first copy of a repeated bib counts)');
  const c = rd('bib,time,name,category,gender,dob,age\n555,2:00:00,Walk In,21 K,M,1/2/1980,\n556,2:00:00,,,,,\n557,2:00:00,Q,21 K,Zed,,\n558,2:00:00,Q,21 K,,31/02/1990,\n559,2:00:00,Q,21 K,,,150\n560,2:00:00,Q,21 K,,,41\n');
  eq(c.items.map((i) => [i.bib, i.name, i.cat, i.gender, i.dob, i.age, i.matched]), [['555', 'Walk In', '21 K', 'M', '1980-02-01', '', false], ['560', 'Q', '21 K', '', '', '41', false]], 'U9 a bib that is not registered needs a name and a category in the file; gender, date of birth and age in the file are checked');
  eq(c.errors.map((x) => x.line), [3, 4, 5, 6], 'U9 an unknown bib with no name, a bad gender, a bad date and a bad age are each refused on their line');
  eq([rd('').errors.length, rd('   \n\n').errors.length, rd(null).errors.length, rd(undefined).errors.length, rd(5400).errors.length, rd({}).errors.length], [1, 1, 1, 1, 1, 1], 'U9 an empty file or a non-text file is refused with one clear error');
  eq([rd('name,time\nA,1:00:00').errors[0].line, rd('bib\n101').errors[0].line, rd('bib,name\n101,A').errors[0].line], [1, 1, 1], 'U9 a file with no bib column, or no time column, is refused on the first line');
  ok(rd('bib,time\n101,"1:00:00').errors[0].text.includes('quotation'), 'U9 an unclosed quotation mark is refused');
  ok(rd('x'.repeat(L.MAX_CSV_CHARS + 1)).errors[0].text.includes('too big'), 'U9 a file over the size limit is refused');
  ok(rd('bib,time\n' + Array.from({ length: L.MAX_ROWS + 1 }, (_, i) => i + ',1:00:00').join('\n')).errors[0].text.includes('Too many'), 'U9 more than 5000 lines is refused');
  ok(rd(Array.from({ length: L.MAX_COLS + 1 }, (_, i) => 'c' + i).join(',') + '\n').errors[0].text.includes('Too many columns'), 'U9 more than 20 columns is refused');
  const h = rd('bib,time,name\n101,1:00:00,"=HYPERLINK(""http://x"")"\n555,1:00:00,"<img src=x onerror=alert(1)>"\n', Object.assign({}, ctx));
  eq(h.items.map((i) => i.name), ['Asha'], 'U9 text in the file cannot become a name for a registered runner (the other line has no category, so it is refused)');
  ok(h.errors.length === 1 && !h.errors[0].text.includes('<'), 'U9 an error never repeats markup back');
  const hs = rd('bib,time,name,category\n555,1:00:00,"=1+1\u202e<b>x",21 K\n');
  ok(!hs.items[0].name.includes('\u202e') && hs.items[0].name === '=1+1<b>x', 'U9 direction-changing characters are dropped from names (formula and markup are escaped later, where they are shown)');
  ok(noThrow((x) => L.readResults(x, { regs, known: x, rankBy: x })) && noThrow((x) => L.parseCsv(x)), 'U9 the reader and the CSV parser never throw on hostile input');
  eq(L.parseCsv('a,b\n"x\ny",2').rows, [['a', 'b'], ['x\ny', '2']], 'U9 a quoted cell may hold a line break');
  eq(['DNF', 'dnf', 'Retired', 'finished', 'Did not start', 'DQ', 'disqualified', '', undefined, 'xx', 5].map(L.normStatus), ['dnf', 'dnf', 'dnf', 'fin', 'dns', 'dsq', 'dsq', '', '', null, null], 'U9 status words are understood; blank means "the time decides"; anything else is refused');
  eq([L.canonCat('25K', ['25 K - Debut Trail', '10 K']), L.canonCat('10 k', ['25 K - Debut Trail', '10 K']), L.canonCat('K', ['25 K', '10 K']), L.canonCat('1', ['10 K', '15 K']), L.canonCat('Ultra', ['10 K']), L.canonCat('', ['10 K']), L.canonCat(null, [])], ['25 K - Debut Trail', '10 K', 'K', '1', 'Ultra', '', ''], 'U9 a category in a file is matched to the real one only when it plainly is that one');
}

/* ---------- U10 small helpers ---------- */
{
  eq([L.cleanText('a\u0000b\u2028c\u202ed', 10), L.cleanText({}, 5), L.cleanText(null), L.cleanText('x'.repeat(500), 20).length, L.cleanText('  hi  ')], ['a b c d'.replace('c d', 'c' + 'd'), '', '', 20, 'hi'].map((x, i) => (i === 0 ? 'a bcd'.replace('a bcd', 'a b' + ' ' + 'cd').replace('b  cd', 'b cd') : x)), 'U10 text: control characters become a space, direction marks are dropped, objects give nothing, length is cut');
  eq([L.isKey('abcdefgh'), L.isKey('abc'), L.isKey('a'.repeat(41)), L.isKey('ab cdefgh'), L.isKey('ab~cdefgh'), L.isKey(12345678), L.isKey(null), L.isKey('ab-cd_ef12')], [true, false, false, false, false, false, false, true], 'U10 a repeat key is 8 to 40 safe characters');
  eq([L.P('12'), L.P(12), L.P('0'), L.P(-3), L.P('x'), L.P(1.9), L.P(null)], [12, 12, 0, 0, 0, 1, 0], 'U10 stored numbers are whole numbers above zero or 0');
}
done();
