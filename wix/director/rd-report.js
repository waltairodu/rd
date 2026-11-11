// backend/rd-report.js
// Reports for RaceOS: counts and totals, never a person. A report is a few tables of numbers and labels, and every table can be saved as
// a CSV file. No database and no Wix in here, so every rule can be tested on its own.
//
// What makes a report safe to hand round: it is built from counts only. A name, a bib, a phone number, an e-mail address or a date of
// birth is read to put somebody in a group (an age is worked out and thrown away) and is never copied into a table. The words that
// are in a table are the ones that group people (a category, a size, a role, a template, a status), typed by the team or by a runner on
// a form: they are cleaned, shown as text and never as markup, and a cell of a CSV file can never start a formula.
import { T, cleanText, catKey, regInfo, ageOf, bandList, bandOf, fmtTime, parseJson } from './rd-results.js';
import { csvCell, STARTERS, templateOf } from './rd-comms.js';

/* ---------- what there is ---------- */
export const MAX_ROWS = 400; // rows in one table (days of registration, roles)
export const MAX_WORD = 60; // characters in a word of a table
// need: 'staff' (a director or a lead) or 'director'.
export const REPORTS = [
  { id: 'reg', title: 'Registrations', what: 'Who registered and paid, by category, gender, age group, T-shirt size and day.', need: 'staff' },
  { id: 'race', title: 'Race day', what: 'Finishers, DNF, DNS and DSQ by category, and the finishing times.', need: 'staff' },
  { id: 'vol', title: 'Volunteers', what: 'Volunteers by status, and shifts filled and hours by role.', need: 'staff' },
  { id: 'waiver', title: 'Waivers', what: 'How many have signed, by category and by how they signed.', need: 'staff' },
  { id: 'msg', title: 'Messages', what: 'Messages sent, failed and skipped, by template.', need: 'staff' },
  { id: 'money', title: 'Money', what: 'Income, expenses, invoices, orders, claims and cash.', need: 'director' },
];
export const reportOf = (id) => (typeof id === 'string' ? REPORTS.find((r) => r.id === id) || null : null);
// The reports a role may run: a director all of them, a lead all but the money.
export const allowedFor = (role) => REPORTS.filter((r) => r.need === 'staff' || role === 'director');
export const KINDS = ['text', 'n', 'r', 'p']; // words, a count, rupees, a percentage

/* ---------- small things ---------- */
const objs = (list) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const cnt = (v) => Math.max(0, Math.round(num(v)));
const rs = (v) => Math.round(num(v) * 100) / 100;
// A word that groups people. Something that looks like a phone number or an e-mail address is never shown: a runner may have typed one
// where a word was asked for, and a report must not carry it.
const word = (v, dflt) => {
  const s = cleanText(T(v), MAX_WORD);
  return !s ? dflt : /@|\d{6,}/.test(s) ? 'Other' : s;
};
// A T-shirt size: a few letters and digits, as in XL or 2XL. Anything longer, without a letter, or with a long run of digits is 'Other'.
const sizeWord = (v) => {
  const s = word(v, '');
  return !s ? '' : s.length > 12 || !/[a-z]/i.test(s) || /\d{3,}/.test(s) ? 'Other' : s;
};
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const col = (label, kind) => ({ label, kind });
// A table. Past MAX_ROWS the rows are cut, but a row of totals at the end is kept (it counts every row, the ones cut included).
function tbl(id, title, cols, rows, note) {
  const cut = rows.length > MAX_ROWS;
  const last = rows.length ? rows[rows.length - 1] : null;
  const kept = !cut ? rows : last && last[0] === 'Total' ? rows.slice(0, MAX_ROWS - 1).concat([last]) : rows.slice(0, MAX_ROWS);
  return { id, title, cols, rows: kept, note: ((note ? note + ' ' : '') + (cut ? 'Only the first ' + MAX_ROWS + ' rows are shown.' : '')).trim() };
}
// A row of totals under the rows of counts: the first cell is the label, the rest are summed (a column named in `skip` is left blank).
function withTotal(rows, ncols, skip) {
  if (!rows.length) return rows;
  const sums = [];
  for (let c = 1; c <= ncols; c++) sums.push(skip && skip.includes(c) ? '' : Math.round(rows.reduce((s, r) => s + num(r[c]), 0) * 100) / 100);
  return rows.concat([['Total'].concat(sums)]);
}
// Counts by group. `order` lists the groups that always get a row, [key, label]; any other group follows, sorted by `cmp` (else by label).
// `tests` say which column a person counts in. The label of a group that is not listed is the first one seen.
function tally(items, keyOf, labelOf, tests, order, cmp) {
  const m = new Map();
  (order || []).forEach((p) => m.set(p[0], { label: p[1], v: tests.map(() => 0), extra: false }));
  items.forEach((x) => {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, { label: labelOf(x), v: tests.map(() => 0), extra: true });
    const g = m.get(k);
    tests.forEach((f, i) => {
      if (f(x)) g.v[i]++;
    });
  });
  const all = Array.from(m.values());
  const rest = all.filter((g) => g.extra).sort(cmp || ((a, b) => a.label.localeCompare(b.label)));
  return all
    .filter((g) => !g.extra)
    .concat(rest)
    .map((g) => [g.label].concat(g.v));
}
const istDay = (iso) => {
  const t = Date.parse(T(iso));
  return Number.isFinite(t) ? new Date(t + 5.5 * 3600000).toISOString().slice(0, 10) : '';
};

/* ---------- registrations ---------- */
const SIZE_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', '3xl', '4xl', '5xl'];
const sizeKey = (s) => T(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
// A size on the chart first, in the order of the chart; then any other size; then the 'Other' row that stands for the unusable ones.
const sizeRank = (label) => {
  const i = SIZE_ORDER.indexOf(sizeKey(label));
  return i >= 0 ? i : label === 'Other' ? 100 : 99;
};
// regs: the registrations of one race. ctx: { st: the results settings (gender, age and band rules), race: { raceDate, cats } }.
export function regReport(regs, ctx) {
  const st = (ctx && ctx.st) || {};
  const race = (ctx && ctx.race) || {};
  const people = objs(regs).map((r) => {
    const i = regInfo(r, st.map);
    const age = ageOf(i, race.raceDate, st.ageRule);
    return { paid: r.status === 'ok', cat: word(r.cat, ''), gender: i.gender, age, size: sizeWord(r.size), day: istDay(r.at) };
  });
  const paid = people.filter((p) => p.paid).length;
  const T3 = [() => true, (p) => p.paid, (p) => !p.paid];
  const H3 = [col('Registered', 'n'), col('Paid', 'n'), col('Not paid', 'n')];
  const out = [];
  out.push(tbl('summary', 'Registrations', [col('Measure', 'text'), col('People', 'n')], [['Registered', people.length], ['Paid', paid], ['Not paid or cancelled', people.length - paid]]));
  const catOrder = (Array.isArray(race.cats) ? race.cats : []).filter((c) => c && typeof c.name === 'string' && catKey(c.name)).map((c) => [catKey(c.name), word(c.name, '')]);
  const catRows = tally(people, (p) => catKey(p.cat) || '', (p) => p.cat || '(no category)', T3, catOrder, (a, b) => (a.label === '(no category)') - (b.label === '(no category)') || a.label.localeCompare(b.label));
  out.push(tbl('cats', 'By category', [col('Category', 'text')].concat(H3), withTotal(catRows, 3)));
  const gOrder = [['M', 'Men'], ['F', 'Women'], ['X', 'Other'], ['', 'Not recorded']];
  out.push(tbl('gender', 'By gender', [col('Gender', 'text')].concat(H3), withTotal(tally(people, (p) => p.gender, () => '', T3, gOrder), 3), 'Gender comes from the registration question chosen in Waves & results (Settings). Until one is chosen, everybody is Not recorded.'));
  const bounds = Array.isArray(st.bands) ? st.bands : [];
  const aOrder = bandList(bounds).map((b) => [b, b]).concat([['', 'Age not known']]);
  out.push(tbl('ages', 'By age group', [col('Age group', 'text')].concat(H3), withTotal(tally(people, (p) => (p.age === null ? '' : bandOf(p.age, bounds)), () => '', T3, aOrder), 3), 'Age comes from the date of birth or age questions chosen in Waves & results (Settings), worked out on the day set there (race day or 31 December), and is not kept.'));
  const sizeRows = tally(people, (p) => sizeKey(p.size) || '', (p) => p.size || 'Not given', T3, [], (a, b) => (a.label === 'Not given') - (b.label === 'Not given') || sizeRank(a.label) - sizeRank(b.label) || a.label.localeCompare(b.label));
  out.push(tbl('sizes', 'By T-shirt size', [col('T-shirt size', 'text')].concat(H3), withTotal(sizeRows, 3)));
  const dayCount = new Map();
  let undated = 0;
  people.forEach((p) => {
    if (p.day) dayCount.set(p.day, (dayCount.get(p.day) || 0) + 1);
    else undated++;
  });
  let run = 0;
  const dayRows = Array.from(dayCount.keys())
    .sort()
    .map((d) => {
      run += dayCount.get(d);
      return [d, dayCount.get(d), run];
    });
  out.push(tbl('days', 'By day of registration', [col('Date', 'text'), col('New', 'n'), col('Total so far', 'n')], dayRows, undated ? 'Registrations without a date (' + undated + ') are left out of this table.' : ''));
  return out;
}

/* ---------- race day ---------- */
const median = (sorted) => {
  const n = sorted.length;
  if (!n) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
};
// b: the board of the race (rows and a summary), as results.web.js and print.web.js make it.
export function raceReport(b) {
  const rows = objs(b && b.rows);
  const sum = (b && b.summary) || {};
  const cats = objs(sum.cats);
  const out = [];
  const catRows = cats.map((c) => {
    const fin = cnt(c.fin);
    const dnf = cnt(c.dnf);
    return [word(c.cat, '(no category)'), fin, dnf, cnt(c.dns), cnt(c.dsq), pct(fin, fin + dnf)];
  });
  const total = catRows.length ? [['Total', catRows.reduce((s, r) => s + r[1], 0), catRows.reduce((s, r) => s + r[2], 0), catRows.reduce((s, r) => s + r[3], 0), catRows.reduce((s, r) => s + r[4], 0), pct(catRows.reduce((s, r) => s + r[1], 0), catRows.reduce((s, r) => s + r[1] + r[2], 0))]] : [];
  out.push(tbl('cats', 'Results by category', [col('Category', 'text'), col('Finished', 'n'), col('DNF', 'n'), col('DNS', 'n'), col('DSQ', 'n'), col('Finish rate %', 'p')], catRows.concat(total), catRows.length ? 'Finish rate is the finishers out of the finishers and those who did not finish (DNS and DSQ are left out).' : 'No results are loaded yet.'));
  const by = new Map();
  rows
    .filter((x) => x.status === 'fin' && num(x.t) > 0)
    .forEach((x) => {
      const k = catKey(x.cat) || '';
      if (!by.has(k)) by.set(k, { cat: word(x.cat, '(no category)'), t: [], g: { M: 0, F: 0, X: 0, '': 0 } });
      const e = by.get(k);
      e.t.push(Math.round(num(x.t)));
      e.g[x.gender === 'M' || x.gender === 'F' || x.gender === 'X' ? x.gender : '']++;
    });
  const order = catRows.map((r) => catKey(r[0]) || '');
  const keys = Array.from(by.keys()).sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) || a.localeCompare(b));
  const timeRows = keys.map((k) => {
    const e = by.get(k);
    const s = e.t.slice().sort((a, b) => a - b);
    return [e.cat, s.length, fmtTime(s[0]), fmtTime(median(s)), fmtTime(s[s.length - 1])];
  });
  out.push(tbl('times', 'Finishing times by category', [col('Category', 'text'), col('Finishers', 'n'), col('Fastest', 'text'), col('Median', 'text'), col('Slowest', 'text')], timeRows, 'The time each result is ranked by (chip or gun, as set in Waves & results).'));
  const gRows = withTotal(keys.map((k) => [by.get(k).cat, by.get(k).g.M, by.get(k).g.F, by.get(k).g.X, by.get(k).g[''], by.get(k).t.length]), 5);
  out.push(tbl('gender', 'Finishers by gender', [col('Category', 'text'), col('Men', 'n'), col('Women', 'n'), col('Other', 'n'), col('Not recorded', 'n'), col('Finishers', 'n')], gRows));
  return out;
}

/* ---------- volunteers ---------- */
const VSTATUS = [['applied', 'Applied (waiting)'], ['approved', 'Approved'], ['declined', 'Declined'], ['other', 'Other']];
// vols, shifts and assigns: the rows of one race.
export function volReport(vols, shifts, assigns) {
  const V = objs(vols);
  const out = [];
  const stOf = (v) => (['applied', 'approved', 'declined'].includes(v.status) ? v.status : 'other');
  const sRows = tally(V, stOf, () => '', [() => true, (v) => !!T(v.waiverAt)], VSTATUS);
  out.push(tbl('status', 'Volunteers by status', [col('Status', 'text'), col('Volunteers', 'n'), col('Accepted the waiver online', 'n')], withTotal(sRows, 2)));
  const A = objs(assigns).filter((a) => a.status !== 'declined');
  const roles = new Map();
  const roleOf = new Map();
  objs(shifts).forEach((s) => {
    const k = catKey(s.role) || '';
    if (!roles.has(k)) roles.set(k, { label: word(s.role, '(no role)'), need: 0, taken: 0, conf: 0, inn: 0, hours: 0 });
    roles.get(k).need += cnt(s.need);
    roleOf.set(T(s._id), k);
  });
  A.forEach((a) => {
    const k = roleOf.get(T(a.shiftId));
    if (k === undefined) return;
    const e = roles.get(k);
    e.taken++;
    if (a.status === 'confirmed') e.conf++;
    if (T(a.checkedInAt)) e.inn++;
    const h = num(a.hours);
    if (h > 0 && h <= 100) e.hours += h;
  });
  const rRows = Array.from(roles.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((e) => [e.label, e.need, e.taken, e.conf, Math.max(0, e.need - e.taken), e.inn, Math.round(e.hours * 10) / 10]);
  out.push(tbl('roles', 'Shifts by role', [col('Role', 'text'), col('Places needed', 'n'), col('Taken', 'n'), col('Confirmed', 'n'), col('Still needed', 'n'), col('Checked in', 'n'), col('Hours recorded', 'n')], withTotal(rRows, 6), 'Taken is every place somebody holds who has not been declined.'));
  return out;
}

/* ---------- waivers ---------- */
const HOW = { form: 'On the registration form', paper: 'On paper on the day', online: 'On the volunteer sign-up page' };
// c: { runners, volunteers }, the counts that rd-waiver.js makes (total, signed, older, none, by, and the categories for runners).
export function waiverReport(c) {
  const R = (c && c.runners) || {};
  const Vo = (c && c.volunteers) || {};
  const row = (label, x) => [label, cnt(x.total), cnt(x.signed), cnt(x.older), cnt(x.none)];
  const H = [col('Paid runners', 'n'), col('Signed', 'n'), col('Signed an older version only', 'n'), col('Not signed', 'n')];
  const out = [];
  const catRows = objs(R.cats).map((x) => row(word(x.cat, '(no category)'), x));
  out.push(tbl('runners', 'Runners by category', [col('Category', 'text')].concat(H), catRows.concat(catRows.length || cnt(R.total) ? [row('All runners', R)] : []), 'Only runners who have paid are asked to sign.'));
  const hows = Object.keys(HOW);
  out.push(tbl('how', 'How people signed', [col('Where', 'text'), col('Runners', 'n'), col('Volunteers', 'n')], hows.map((k) => [HOW[k], cnt(R.by && R.by[k]), cnt(Vo.by && Vo.by[k])])));
  out.push(tbl('volunteers', 'Volunteers', [col('Who', 'text'), col('Volunteers', 'n'), col('Signed', 'n'), col('Signed an older version only', 'n'), col('Not signed', 'n')], [row('Volunteers not declined', Vo)]));
  return out;
}

/* ---------- messages ---------- */
// rows: the rows of the Messages collection of one race (templates, batches and one row for each person a message was made for).
export function msgReport(rows) {
  const list = objs(rows);
  const names = new Map(STARTERS.map((s) => [s.id, s.name]));
  list
    .filter((r) => r.kind === 'tpl')
    .forEach((r) => {
      const t = templateOf(r.json, parseJson);
      if (t) names.set(T(r.ref), t.name);
    });
  const rcp = list.filter((r) => r.kind === 'rcp');
  const wa = (r) => r.why === 'whatsapp';
  const tests = [() => true, (r) => r.status === 'sent' && !wa(r), (r) => r.status === 'sent' && wa(r), (r) => r.status === 'failed', (r) => r.status === 'skipped', (r) => r.status === 'sending'];
  const tRows = tally(rcp, (r) => T(r.sub), (r) => names.get(T(r.sub)) || '(a template that is gone)', tests, []);
  const sumRow = (n) => tRows.reduce((s, r) => s + r[n], 0);
  const out = [];
  out.push(tbl('summary', 'Messages', [col('Measure', 'text'), col('Count', 'n')], [['Batches prepared', list.filter((r) => r.kind === 'bat').length], ['Messages made (one for each person in a batch)', rcp.length], ['Sent by e-mail', sumRow(2)], ['WhatsApp chats marked sent', sumRow(3)], ['Failed', sumRow(4)], ['Skipped', sumRow(5)], ['Still sending', sumRow(6)]]));
  out.push(tbl('templates', 'By template', [col('Template', 'text'), col('Messages', 'n'), col('Sent by e-mail', 'n'), col('WhatsApp chats', 'n'), col('Failed', 'n'), col('Skipped', 'n'), col('Still sending', 'n')], withTotal(tRows, 6)));
  return out;
}

/* ---------- money ---------- */
// s: the money summary in rupees (summaryOut of rd-finance.js). Only totals: nobody is named.
export function moneyReport(s) {
  const g = (o, k) => (o && typeof o === 'object' ? o[k] : undefined);
  const inc = (s && s.income) || {};
  const exp = (s && s.expenses) || {};
  const res = (s && s.result) || {};
  const ord = (s && s.orders) || {};
  const clm = (s && s.claims) || {};
  const cash = (s && s.cash) || {};
  const reg = inc.registrations || {};
  const out = [];
  out.push(tbl('result', 'Income and expenses', [col('Line', 'text'), col('Rupees', 'r')], [
    ['Registrations (paid)', rs(reg.revenue)],
    ['Invoices received', rs(inc.received)],
    ['Other income', rs(inc.other)],
    ['Total income', rs(inc.total)],
    ['Paid out so far', rs(exp.paid)],
    ['Net so far', rs(res.net)],
    ['Still to be received (invoices)', rs(inc.outstanding)],
    ['Still to be paid (orders and claims)', rs(exp.owed)],
    ['Committed (orders not yet billed)', rs(exp.committed)],
    ['Expected net at the end', rs(res.projected)],
  ]));
  out.push(tbl('invoices', 'Invoices', [col('Line', 'text'), col('Rupees', 'r')], [['Invoiced', rs(inc.invoiced)], ['Received', rs(inc.received)], ['Tax deducted at source', rs(inc.tds)], ['Outstanding', rs(inc.outstanding)], ['Overdue (amount)', rs(g(inc.invoices, 'overdueAmount'))]], 'Overdue invoices: ' + cnt(g(inc.invoices, 'overdueCount')) + '.'));
  out.push(tbl('orders', 'Orders: estimate, advance and actual', [col('Line', 'text'), col('Rupees', 'r')], [['Estimate', rs(ord.estimate)], ['Billed (actual)', rs(ord.billed)], ['Advance paid', rs(ord.advance)], ['Paid in all', rs(ord.paid)], ['Balance to pay', rs(ord.balance)], ['Refund due', rs(ord.refundDue)]], 'Orders: ' + cnt(ord.count) + '.'));
  const pend = clm.pending || {};
  const appr = clm.approved || {};
  out.push(tbl('claims', 'Reimbursement claims', [col('Line', 'text'), col('Claims', 'n'), col('Rupees', 'r')], [['Waiting for a decision', cnt(pend.count), rs(pend.amount)], ['Approved, still to pay', cnt(appr.count), rs(appr.balance)], ['Paid in all', '', rs(clm.paid)]], 'Claims already paid are shown as an amount only.'));
  const byCat = objs(s && s.byCat).map((c) => [word(c.cat, 'Other'), rs(c.budget), rs(c.estimate), rs(c.actual)]);
  out.push(tbl('cats', 'Budget, estimate and actual by category', [col('Category', 'text'), col('Budget', 'r'), col('Estimated by orders', 'r'), col('Actual', 'r')], withTotal(byCat, 3)));
  out.push(tbl('cash', 'Cash', [col('Line', 'text'), col('Rupees', 'r')], [['Withdrawn', rs(cash.withdrawn)], ['Deposited back', rs(cash.deposited)], ['Spent', rs(cash.spent)], ['Received', rs(cash.received)], ['In hand', rs(cash.inHand)]], 'Totals only: no name of the person who holds cash is shown in a report.'));
  return out;
}

/* ---------- a table as a file ---------- */
const numText = (v, kind) => (kind === 'r' ? v.toFixed(2) : kind === 'p' ? v.toFixed(1) : Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
// A CSV file of one table. Words are quoted and can never start a formula (csvCell); a number is written as a number, so a loss stays -1500.00.
export function tableCsv(t) {
  const cols = Array.isArray(t && t.cols) ? t.cols : [];
  const rows = Array.isArray(t && t.rows) ? t.rows : [];
  const lines = [cols.map((c) => csvCell(c && c.label)).join(',')];
  rows.forEach((r) => lines.push((Array.isArray(r) ? r : []).map((v, i) => (typeof v === 'number' ? (Number.isFinite(v) ? numText(v, cols[i] && cols[i].kind) : '""') : csvCell(v))).join(',')));
  return lines.join('\r\n') + '\r\n';
}
const slug = (s) => T(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// A file name that is plain letters, digits and dashes whatever the race is called.
export const csvName = (race, report, table) => [slug(race), slug(report), slug(table)].filter(Boolean).join('-') + '.csv';
