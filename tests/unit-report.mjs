// UNIT TESTS (Report rules): which reports there are and who may run them, the tables of every report from plain rows, the words that
// group people (a phone number or an e-mail address typed where a word was asked for is never shown), the totals, and a table as a CSV
// file (a word can never start a formula, a number stays a number). The library has no database and no Wix in it, so every rule is
// tested on its own.
//   R1 the reports   R2 registrations   R3 race day   R4 volunteers   R5 waivers   R6 messages   R7 money   R8 CSV   R9 hostile input
import * as P from './rd-report.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: Report rules');
const fc = String.fromCharCode;

const HOSTILE = [undefined, null, true, false, 0, -1, 1.5, NaN, Infinity, '', ' ', 'x'.repeat(5000), fc(0), fc(0x202e), {}, [], [[]], [null], [1, 2], ['a', 'b'], { toString() { throw new Error('boom'); } }, { length: 1e9 }, () => 1, [{ status: {} }, null, 7, 'x', [], { cat: {}, size: [], at: {}, form: {} }]];
const throws = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return e.message;
  }
};
const shapeOk = (tables) =>
  Array.isArray(tables) &&
  tables.every(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      typeof t.title === 'string' &&
      typeof t.note === 'string' &&
      Array.isArray(t.cols) &&
      t.cols.every((c) => typeof c.label === 'string' && P.KINDS.includes(c.kind)) &&
      Array.isArray(t.rows) &&
      t.rows.length <= P.MAX_ROWS &&
      t.rows.every((r) => Array.isArray(r) && r.length <= t.cols.length && r.every((v) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string')),
  );
const T = (tables, id) => tables.find((t) => t.id === id);
const R = (tables, id, label) => (T(tables, id).rows.find((r) => r[0] === label) || []).slice(1);

/* ---------- R1 the reports ---------- */
{
  eq(P.REPORTS.map((r) => r.id), ['reg', 'race', 'vol', 'waiver', 'msg', 'money'], 'R1 six reports, in this order');
  eq(P.REPORTS.filter((r) => r.need === 'director').map((r) => r.id), ['money'], 'R1 only Money is for directors');
  ok(P.REPORTS.every((r) => r.title && r.what && /^[a-z]+$/.test(r.id)), 'R1 each report has an id, a title and a line saying what it is');
  eq(P.allowedFor('director').map((r) => r.id), ['reg', 'race', 'vol', 'waiver', 'msg', 'money'], 'R1 a director may run all six');
  eq(P.allowedFor('lead').map((r) => r.id), ['reg', 'race', 'vol', 'waiver', 'msg'], 'R1 a lead may run five: not Money');
  for (const h of HOSTILE) ok(!P.allowedFor(h).some((r) => r.id === 'money'), 'R1 Money is for nobody but a director, whatever the role looks like: ' + String(typeof h));
  for (const r of P.REPORTS) eq(P.reportOf(r.id), r, 'R1 reportOf finds ' + r.id);
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Money', ' money', 'money ', 'MONEY', 'reg ', 'REG', '', null, undefined, 5, {}, [], ['reg'], { toString: () => 'reg' }]) {
    eq(P.reportOf(bad), null, 'R1 reportOf refuses ' + JSON.stringify(bad === undefined ? 'undefined' : typeof bad === 'object' ? 'an object' : bad));
  }
  eq(P.KINDS, ['text', 'n', 'r', 'p'], 'R1 four kinds of column');
}

/* ---------- R2 registrations ---------- */
const ST = { map: { gender: 'Gender', dob: 'DOB', age: 'Age', seed: '' }, ageRule: 'raceday', bands: [18, 30, 40, 50, 60] };
const RACE = { raceDate: '2027-02-07', cats: [{ name: '21 K' }, { name: '10 K' }] };
const form = (g, dob, age) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'DOB', value: dob || '' }, { name: 'Age', value: age || '' }]);
const NAME = 'Zed Person';
const PHONE = '9812345678';
const MAIL = 'zed.person@example.com';
const reg = (o) => Object.assign({ _id: 'r' + Math.random(), name: NAME, phone: PHONE, email: MAIL, bib: '777', bibName: 'ZED', cat: '10 K', size: 'M', status: 'ok', at: '2026-12-01T10:00:00.000Z', form: '' }, o);
const REGS = [
  reg({ cat: '21 K', size: 'XL', form: form('M', '1990-05-01'), at: '2026-12-01T10:00:00.000Z' }),
  reg({ cat: '21 K', size: 'm', form: form('F', '1997-05-01'), at: '2026-12-01T20:00:00.000Z' }),
  reg({ cat: '10 K', size: 'S', form: form('F', '', '65'), at: '2026-12-02T03:00:00.000Z' }),
  reg({ cat: '10 K', size: '', status: 'unpaid', form: form('X'), at: '2026-12-03T00:00:00.000Z' }),
  reg({ cat: '10 k ', size: '2XL', form: form('M', '2012-01-01'), at: '2026-12-03T10:00:00.000Z' }),
  reg({ cat: 'Ultra', size: '9876543210', at: '2026-12-03T11:00:00.000Z' }),
  reg({ cat: '', size: 'a@b.com', at: '2026-12-04T11:00:00.000Z' }),
  reg({ cat: '=HYPERLINK("x")', size: 'M', at: '2026-12-04T12:00:00.000Z' }),
  reg({ cat: '10 K', size: 'XXL', at: undefined }),
];
{
  const t = P.regReport(REGS, { st: ST, race: RACE });
  eq(t.map((x) => x.id), ['summary', 'cats', 'gender', 'ages', 'sizes', 'days'], 'R2 six tables, in this order');
  ok(shapeOk(t), 'R2 every table has the same shape');
  eq(T(t, 'summary').rows, [['Registered', 9], ['Paid', 8], ['Not paid or cancelled', 1]], 'R2 how many registered, paid and not paid');
  const cats = T(t, 'cats').rows;
  eq(cats.slice(0, 2), [['21 K', 2, 2, 0], ['10 K', 4, 3, 1]], 'R2 categories come in the order of the race, "10 k " counted with "10 K" under the race\'s own spelling');
  eq(cats[cats.length - 2][0], '(no category)', 'R2 a registration with no category comes last, before the total');
  eq(cats.map((r) => r[0]).sort(), ['(no category)', '10 K', '21 K', '=HYPERLINK("x")', 'Total', 'Ultra'].sort(), 'R2 a category the race does not list still gets its row');
  eq(cats[cats.length - 1], ['Total', 9, 8, 1], 'R2 the totals row');
  eq(T(t, 'gender').rows, [['Men', 2, 2, 0], ['Women', 2, 2, 0], ['Other', 1, 0, 1], ['Not recorded', 4, 4, 0], ['Total', 9, 8, 1]], 'R2 gender: four rows and a total');
  eq(T(t, 'ages').rows, [['Under 18', 1, 1, 0], ['18-29', 1, 1, 0], ['30-39', 1, 1, 0], ['40-49', 0, 0, 0], ['50-59', 0, 0, 0], ['60+', 1, 1, 0], ['Age not known', 5, 4, 1], ['Total', 9, 8, 1]], 'R2 age groups from a date of birth on race day or a declared age; the others are "Age not known"');
  eq(T(t, 'sizes').rows, [['S', 1, 1, 0], ['m', 2, 2, 0], ['XL', 1, 1, 0], ['XXL', 1, 1, 0], ['2XL', 1, 1, 0], ['Other', 2, 2, 0], ['Not given', 1, 0, 1], ['Total', 9, 8, 1]], 'R2 sizes in the order of a size chart, "m" and "M" together, a phone number and an e-mail address as "Other", none given last');
  eq(T(t, 'days').rows, [['2026-12-01', 1, 1], ['2026-12-02', 2, 3], ['2026-12-03', 3, 6], ['2026-12-04', 2, 8]], 'R2 days are Indian days (20:00 UTC is the next morning), with the total so far');
  eq(T(t, 'days').note, 'Registrations without a date (1) are left out of this table.', 'R2 the registrations without a date are counted in a note');
  ok(/Gender comes from the registration question/.test(T(t, 'gender').note) && /not kept/.test(T(t, 'ages').note), 'R2 the gender and age tables say where the answer comes from');
  const all = JSON.stringify(t);
  for (const secret of [NAME, PHONE, MAIL, '777', 'ZED', '1990-05-01', '1997-05-01', '2012-01-01']) ok(!all.includes(secret), 'R2 no table holds ' + secret);
  const ye = P.regReport(REGS, { st: Object.assign({}, ST, { ageRule: 'yearend' }), race: RACE });
  eq(R(ye, 'ages', '30-39'), [2, 2, 0], 'R2 on year end the one born on 1 May 1997 is 30, on race day 29');
  eq(R(t, 'ages', '30-39'), [1, 1, 0], 'R2 on race day that person is in the 18-29 group');
  const noMap = P.regReport(REGS, { st: Object.assign({}, ST, { map: {} }), race: RACE });
  eq(R(noMap, 'gender', 'Not recorded'), [9, 8, 1], 'R2 with no question chosen everybody is Not recorded');
  eq(R(noMap, 'ages', 'Age not known'), [9, 8, 1], 'R2 and nobody has an age');
  const nb = P.regReport(REGS, { st: Object.assign({}, ST, { bands: [] }), race: RACE });
  eq(T(nb, 'ages').rows.map((r) => r[0]), ['All ages', 'Age not known', 'Total'], 'R2 with no age groups set there is one group');
  eq(P.regReport([], { st: ST, race: RACE }).map((x) => x.rows.length), [3, 3, 5, 8, 0, 0], 'R2 no registrations: only the fixed rows (the race\'s categories, the genders and the age groups, each with a total)');
  const many = [];
  for (let i = 0; i < 500; i++) many.push(reg({ cat: 'Cat ' + String(i).padStart(3, '0'), at: '2026-01-01T00:00:00.000Z' }));
  const big = P.regReport(many, { st: ST, race: RACE });
  eq([T(big, 'cats').rows.length, T(big, 'cats').rows[399], /Only the first 400 rows are shown\./.test(T(big, 'cats').note)], [400, ['Total', 500, 500, 0], true], 'R2 past 400 rows a table is cut, the totals row stays and counts every row');
  const days = [];
  for (let i = 0; i < 450; i++) days.push(reg({ at: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString() }));
  eq(T(P.regReport(days, { st: ST, race: RACE }), 'days').rows.length, 400, 'R2 450 days of registrations: 400 rows');
  const long = P.regReport([reg({ cat: 'C'.repeat(300), size: 'X'.repeat(300) })], { st: ST, race: RACE });
  ok(T(long, 'cats').rows.every((r) => r[0].length <= 60) && T(long, 'sizes').rows[0][0] === 'Other', 'R2 a word is cut at 60 characters; a long size is "Other"');
  for (const size of ['123', '1990', '10/05/1990', 'ab12345', '+91 98123 45678', '42', '7', '--', '1 2']) eq(T(P.regReport([reg({ size })], { st: ST, race: RACE }), 'sizes').rows, [['Other', 1, 1, 0], ['Total', 1, 1, 0]], 'R2 a size that is not a size is never shown: ' + size);
  eq(T(P.regReport([reg({ size: '123' }), reg({ size: '3XL' }), reg({ size: 'W-M' })], { st: ST, race: RACE }), 'sizes').rows.map((r) => r[0]), ['3XL', 'W-M', 'Other', 'Total'], 'R2 sizes with letters stay, digits only are "Other"');
}

/* ---------- R3 race day ---------- */
{
  const rows = [
    { cat: '10 K', gender: 'M', status: 'fin', t: 360000 },
    { cat: '10 K', gender: 'F', status: 'fin', t: 400000 },
    { cat: '10 K', gender: 'F', status: 'fin', t: 500000 },
    { cat: '10 K', gender: 'X', status: 'fin', t: 450000 },
    { cat: '10 K', gender: 'M', status: 'fin', t: 0 },
    { cat: '10 K', gender: 'M', status: 'dnf', t: 0 },
    { cat: '10 K', gender: 'M', status: 'dnf', t: 123456 }, // a time on a row that did not finish is not a finishing time
    { cat: '21 K', gender: 'F', status: 'dsq', t: 654321 },
    { cat: '21 K', gender: 'M', status: 'fin', t: 720000 },
    { cat: '21 K', gender: '', status: 'fin', t: 800001 },
  ];
  const summary = { cats: [{ cat: '10 K', fin: 5, dnf: 1, dns: 2, dsq: 1 }, { cat: '21 K', fin: 2, dnf: 0, dns: 0, dsq: 0 }] };
  const t = P.raceReport({ rows, summary });
  eq(t.map((x) => x.id), ['cats', 'times', 'gender'], 'R3 three tables');
  ok(shapeOk(t), 'R3 every table has the same shape');
  eq(T(t, 'cats').rows, [['10 K', 5, 1, 2, 1, 83.3], ['21 K', 2, 0, 0, 0, 100], ['Total', 7, 1, 2, 1, 87.5]], 'R3 finishers, DNF, DNS, DSQ and the finish rate (DNS and DSQ left out of it)');
  eq(T(t, 'times').rows, [['10 K', 4, '1:00:00', '1:10:50', '1:23:20'], ['21 K', 2, '2:00:00', '2:06:40.01', '2:13:20.01']], 'R3 fastest, median and slowest of those with a time (an even count: the middle two averaged, to a hundredth of a second)');
  eq(T(t, 'gender').rows, [['10 K', 1, 2, 1, 0, 4], ['21 K', 1, 0, 0, 1, 2], ['Total', 2, 2, 1, 1, 6]], 'R3 finishers by gender, "Not recorded" when the gender is not known');
  const odd = P.raceReport({ rows: [360000, 400000, 500000].map((x) => ({ cat: 'A', gender: 'M', status: 'fin', t: x })), summary: { cats: [{ cat: 'A', fin: 3, dnf: 0, dns: 0, dsq: 0 }] } });
  eq(T(odd, 'times').rows, [['A', 3, '1:00:00', '1:06:40', '1:23:20']], 'R3 an odd count: the middle one');
  const empty = P.raceReport({ rows: [], summary: { cats: [] } });
  eq(empty.map((x) => x.rows.length), [0, 0, 0], 'R3 no results: no rows');
  ok(/No results are loaded yet/.test(T(empty, 'cats').note), 'R3 and a note says so');
  eq(P.raceReport({ rows: [{ cat: '', status: 'fin', t: 100 }], summary: { cats: [{ cat: '', fin: 1, dnf: 0, dns: 0, dsq: 0 }] } })[0].rows[0][0], '(no category)', 'R3 a result with no category is "(no category)"');
  const all = JSON.stringify(P.raceReport({ rows: [{ cat: '10 K', gender: 'M', status: 'fin', t: 360000, name: NAME, bib: '777', phone: PHONE, email: MAIL, dob: '1990-05-01' }], summary: { cats: [{ cat: '10 K', fin: 1, dnf: 0, dns: 0, dsq: 0 }] } }));
  for (const secret of [NAME, '777', PHONE, MAIL, '1990-05-01']) ok(!all.includes(secret), 'R3 no table holds ' + secret);
}

/* ---------- R4 volunteers ---------- */
{
  const vols = [{ status: 'applied', name: NAME, phone: PHONE }, { status: 'approved', waiverAt: '2027-01-01T00:00:00.000Z' }, { status: 'approved' }, { status: 'declined', waiverAt: 'x' }, { status: 'weird' }, {}];
  const shifts = [{ _id: 's1', role: 'Marshal', need: '3' }, { _id: 's2', role: 'marshal', need: 2 }, { _id: 's3', role: 'Water point', need: '4' }, { _id: 's4', role: 'Start line', need: 'x' }];
  const asg = [
    { shiftId: 's1', status: 'confirmed', hours: '3.5', checkedInAt: '2027-02-07T01:00:00.000Z' },
    { shiftId: 's1', status: 'pending', hours: 0 },
    { shiftId: 's2', status: 'declined', hours: 5 },
    { shiftId: 's2', status: 'confirmed', hours: 4 },
    { shiftId: 's3', status: 'pending', hours: 200 },
    { shiftId: 'zz', status: 'confirmed', hours: 9 },
    { shiftId: 's4', status: 'pending', hours: -2 },
  ];
  const t = P.volReport(vols, shifts, asg);
  eq(t.map((x) => x.id), ['status', 'roles'], 'R4 two tables');
  ok(shapeOk(t), 'R4 every table has the same shape');
  eq(T(t, 'status').rows, [['Applied (waiting)', 1, 0], ['Approved', 2, 1], ['Declined', 1, 1], ['Other', 2, 0], ['Total', 6, 2]], 'R4 volunteers by status, with those who accepted the waiver online; an unknown status is "Other"');
  eq(T(t, 'roles').rows, [['Marshal', 5, 3, 2, 2, 1, 7.5], ['Start line', 0, 1, 0, 0, 0, 0], ['Water point', 4, 1, 0, 3, 0, 0], ['Total', 9, 5, 2, 5, 1, 7.5]], 'R4 roles: "Marshal" and "marshal" together; declined places and places on unknown shifts not counted; hours over 100 or under 0 not counted; still needed never below 0');
  ok(!JSON.stringify(t).includes(NAME) && !JSON.stringify(t).includes(PHONE), 'R4 no name or phone number');
  eq(P.volReport([], [], []).map((x) => x.rows.length), [5, 0], 'R4 nothing: the five status rows (with a total) and no roles');
  eq(R(P.volReport([], [{ _id: 'a', role: 'R', need: 1 }], [{ shiftId: 'a', status: 'pending' }, { shiftId: 'a', status: 'pending' }]), 'roles', 'R'), [1, 2, 0, 0, 0, 0], 'R4 more taken than needed: still needed is 0');
  eq(R(P.volReport([], [{ _id: 'a', role: '9876543210', need: 1 }], []), 'roles', 'Other'), [1, 0, 0, 1, 0, 0], 'R4 a role that looks like a phone number is "Other"');
}

/* ---------- R5 waivers ---------- */
{
  const c = {
    runners: { total: 10, signed: 6, older: 1, none: 3, by: { form: 4, paper: 2 }, cats: [{ cat: '10 K', total: 6, signed: 4, older: 1, none: 1 }, { cat: '21 K', total: 4, signed: 2, older: 0, none: 2 }] },
    volunteers: { total: 3, signed: 1, older: 0, none: 2, by: { online: 1 } },
  };
  const t = P.waiverReport(c);
  eq(t.map((x) => x.id), ['runners', 'how', 'volunteers'], 'R5 three tables');
  ok(shapeOk(t), 'R5 every table has the same shape');
  eq(T(t, 'runners').rows, [['10 K', 6, 4, 1, 1], ['21 K', 4, 2, 0, 2], ['All runners', 10, 6, 1, 3]], 'R5 runners by category and in all');
  eq(T(t, 'how').rows, [['On the registration form', 4, 0], ['On paper on the day', 2, 0], ['On the volunteer sign-up page', 0, 1]], 'R5 where people signed');
  eq(T(t, 'volunteers').rows, [['Volunteers not declined', 3, 1, 0, 2]], 'R5 volunteers');
  eq(P.waiverReport({ runners: { total: '5', signed: '3', older: -1, none: 'x', cats: [] }, volunteers: {} })[0].rows, [['All runners', 5, 3, 0, 0]], 'R5 numbers typed as text are read, damaged ones are 0');
  eq(P.waiverReport({}).map((x) => x.rows.length), [0, 3, 1], 'R5 nothing: no category rows, the how rows and one volunteers row');
}

/* ---------- R6 messages ---------- */
{
  const tpl = { name: 'Race week news', kind: 'runner', subject: 'Hello {race}', body: 'Hello {firstname}' };
  const rows = [
    { kind: 'tpl', ref: 't1', json: JSON.stringify(tpl) },
    { kind: 'bat', ref: 'b1' },
    { kind: 'bat', ref: 'b2' },
    { kind: 'rcp', sub: 't1', status: 'sent', why: '', who: NAME },
    { kind: 'rcp', sub: 't1', status: 'sent', why: '' },
    { kind: 'rcp', sub: 't1', status: 'sent', why: 'whatsapp' },
    { kind: 'rcp', sub: 't1', status: 'failed', why: 'no_email' },
    { kind: 'rcp', sub: 't1', status: 'skipped' },
    { kind: 'rcp', sub: 't1', status: 'sending' },
    { kind: 'rcp', sub: 'bib', status: 'sent', why: '' },
    { kind: 'rcp', sub: 'gone', status: 'failed' },
    { kind: 'rcp', sub: 't1', status: 'weird' },
  ];
  const t = P.msgReport(rows);
  eq(t.map((x) => x.id), ['summary', 'templates'], 'R6 two tables');
  ok(shapeOk(t), 'R6 every table has the same shape');
  eq(T(t, 'summary').rows, [['Batches prepared', 2], ['Messages made (one for each person in a batch)', 9], ['Sent by e-mail', 3], ['WhatsApp chats marked sent', 1], ['Failed', 2], ['Skipped', 1], ['Still sending', 1]], 'R6 the totals');
  eq(T(t, 'templates').rows, [['(a template that is gone)', 1, 0, 0, 1, 0, 0], ['Race week news', 7, 2, 1, 1, 1, 1], ['Your bib', 1, 1, 0, 0, 0, 0], ['Total', 9, 3, 1, 2, 1, 1]], 'R6 by template: a saved name, a starter name, and a template that is gone');
  ok(!JSON.stringify(t).includes(NAME), 'R6 no name');
  eq(P.msgReport([]).map((x) => x.rows.length), [7, 0], 'R6 nothing: the seven summary rows are all 0');
  eq(R(P.msgReport([{ kind: 'tpl', ref: 'z', json: '{bad' }, { kind: 'rcp', sub: 'z', status: 'sent' }]), 'templates', '(a template that is gone)'), [1, 1, 0, 0, 0, 0], 'R6 a damaged template row does not name anything');
}

/* ---------- R7 money ---------- */
{
  const s = {
    income: { registrations: { revenue: 1000.456 }, received: 500, other: 250, total: 1750.46, outstanding: 300, invoiced: 800, tds: 20, invoices: { overdueAmount: 100, overdueCount: 2 } },
    expenses: { paid: 600, owed: 150, committed: 400 },
    result: { net: -1500.5, projected: 20 },
    orders: { count: 4, estimate: 900, billed: 700, advance: 200, paid: 500, balance: 200, refundDue: 10 },
    claims: { pending: { count: 2, amount: 80 }, approved: { count: 1, balance: 30 }, paid: 410 },
    cash: { withdrawn: 1000, deposited: 100, spent: 700, received: 50, inHand: 250, holders: [{ holder: NAME, inHand: 250 }] },
    byCat: [{ cat: 'Awards', budget: 1000, estimate: 800, actual: 700 }, { cat: 'Admin', budget: 500, estimate: 300, actual: 250.5 }],
  };
  const t = P.moneyReport(s);
  eq(t.map((x) => x.id), ['result', 'invoices', 'orders', 'claims', 'cats', 'cash'], 'R7 six tables');
  ok(shapeOk(t), 'R7 every table has the same shape');
  eq(T(t, 'result').rows.find((r) => r[0] === 'Net so far'), ['Net so far', -1500.5], 'R7 a loss is a negative number');
  eq(T(t, 'result').rows.find((r) => r[0] === 'Registrations (paid)'), ['Registrations (paid)', 1000.46], 'R7 rupees to the paisa');
  eq(T(t, 'invoices').rows[4], ['Overdue (amount)', 100], 'R7 overdue invoices');
  ok(/Overdue invoices: 2\./.test(T(t, 'invoices').note), 'R7 and how many');
  eq(T(t, 'orders').rows, [['Estimate', 900], ['Billed (actual)', 700], ['Advance paid', 200], ['Paid in all', 500], ['Balance to pay', 200], ['Refund due', 10]], 'R7 orders: estimate, advance and actual');
  eq(T(t, 'claims').rows, [['Waiting for a decision', 2, 80], ['Approved, still to pay', 1, 30], ['Paid in all', '', 410]], 'R7 claims');
  eq(T(t, 'cats').rows, [['Awards', 1000, 800, 700], ['Admin', 500, 300, 250.5], ['Total', 1500, 1100, 950.5]], 'R7 budget, estimate and actual by category with a total');
  eq(T(t, 'cash').rows, [['Withdrawn', 1000], ['Deposited back', 100], ['Spent', 700], ['Received', 50], ['In hand', 250]], 'R7 cash totals');
  ok(!JSON.stringify(t).includes(NAME), 'R7 the name of the person who holds cash is never in a report');
  for (const h of HOSTILE) {
    const x = P.moneyReport(h);
    ok(shapeOk(x) && x.length === 6, 'R7 hostile input still gives six clean tables: ' + typeof h);
  }
}

/* ---------- R8 a table as a CSV file ---------- */
{
  const tb = {
    id: 't',
    title: 'T',
    cols: [{ label: 'Name', kind: 'text' }, { label: 'Rupees', kind: 'r' }, { label: 'Count', kind: 'n' }, { label: 'Rate %', kind: 'p' }],
    rows: [['=1+1', -1500, 3, 66.66], ['+cmd', 0.5, 0, 100], ['-x', 1234.5, 2, 0], ['@a', 1000, 7, 5], [fc(9) + '=x', 0, 0, 0], [fc(13) + '+y', 0, 0, 0], ['a"b,c', 1, 1, 1], ['ok', NaN, Infinity, 'x']],
  };
  const lines = P.tableCsv(tb).split('\r\n');
  eq(lines[0], '"Name","Rupees","Count","Rate %"', 'R8 the header: every label quoted');
  eq(lines[1], '"\'=1+1",-1500.00,3,66.7', 'R8 a word starting with = gets a ", a loss stays a number');
  eq(lines.slice(2, 6), ['"\'+cmd",0.50,0,100.0', '"\'-x",1234.50,2,0.0', '"\'@a",1000.00,7,5.0', '"\'=x",0.00,0,0.0'], 'R8 + - @ and a tab in front of = are all made safe');
  eq(lines[6], '"\'+y",0.00,0,0.0', 'R8 a return in front of + too');
  eq(lines[7], '"a""b,c",1.00,1,1.0', 'R8 quotes are doubled and a comma stays inside the quotes');
  eq(lines[8], '"ok","","","x"', 'R8 a number that is not a number is an empty cell, never NaN or Infinity; a word in a number column is still a safe word');
  eq([lines.length, lines[9]], [10, ''], 'R8 every line ends with a return and a line feed');
  for (const l of lines.slice(1, 9)) ok(!/(^|,)[=+\-@]/.test(l.replace(/^-?\d+(\.\d+)?/, '')) || /^"/.test(l), 'R8 no cell of a line starts with a formula sign: ' + l);
  eq(P.tableCsv({ cols: [{ label: 'A', kind: 'n' }], rows: [[1], [1.26]] }), '"A"\r\n1\r\n1.3\r\n', 'R8 a count with a fraction is rounded to one place');
  for (const h of HOSTILE) ok(typeof P.tableCsv(h) === 'string', 'R8 hostile table gives text, not an error: ' + typeof h);
  eq(P.tableCsv({ cols: 5, rows: 'x' }), '\r\n', 'R8 a table with no columns is an empty line');
  eq(P.csvName('Vizag Half Marathon 2027', 'reg', 'cats'), 'vizag-half-marathon-2027-reg-cats.csv', 'R8 a file name from the race, the report and the table');
  for (const race of ['', '../../etc/passwd', '<script>', 'a/b\\c', 'x'.repeat(200), 'Ultra Trail: 50 K (v2)', fc(0x202e) + 'evil', 12345, null, undefined, {}]) {
    const n = P.csvName(race, 'reg', 'cats');
    ok(/^[a-z0-9-]+\.csv$/.test(n) && n.length <= 40 * 3 + 4 + 6, 'R8 the file name is plain letters, digits and dashes whatever the race is called: ' + JSON.stringify(typeof race === 'string' ? race.slice(0, 20) : String(race)) + ' -> ' + n.slice(0, 30));
  }
}

/* ---------- R9 hostile input to every builder ---------- */
{
  const builders = {
    regReport: (h) => P.regReport(h, { st: h, race: h }),
    regReport2: (h) => P.regReport([h, { cat: h, size: h, status: h, at: h, form: h, name: h }], h),
    raceReport: (h) => P.raceReport(h),
    raceReport2: (h) => P.raceReport({ rows: [h, { cat: h, gender: h, status: 'fin', t: h }], summary: { cats: [h, { cat: h, fin: h, dnf: h, dns: h, dsq: h }] } }),
    volReport: (h) => P.volReport(h, h, h),
    volReport2: (h) => P.volReport([h, { status: h, waiverAt: h }], [h, { _id: h, role: h, need: h }], [h, { shiftId: h, status: h, hours: h, checkedInAt: h }]),
    waiverReport: (h) => P.waiverReport(h),
    waiverReport2: (h) => P.waiverReport({ runners: h, volunteers: { by: h, total: h } }),
    msgReport: (h) => P.msgReport(h),
    msgReport2: (h) => P.msgReport([h, { kind: 'rcp', sub: h, status: h, why: h }, { kind: 'tpl', ref: h, json: h }]),
    moneyReport: (h) => P.moneyReport(h),
  };
  for (const [name, fn] of Object.entries(builders)) {
    let bad = 0;
    for (const h of HOSTILE) {
      try {
        if (!shapeOk(fn(h))) bad++;
      } catch (e) {
        bad++;
      }
    }
    ok(bad === 0, 'R9 ' + name + ' never throws and always gives clean tables (' + bad + ' of ' + HOSTILE.length + ' hostile inputs went wrong)');
  }
  ok(throws(() => P.tableCsv(undefined)) === '', 'R9 an empty table is not an error');
}
done();
