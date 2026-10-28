// UNIT TESTS: wix/director/rd-finance.js on its own (no database, no Wix): money in whole paise, amounts in words,
// Indian digit grouping, financial years and numbering, invoice and claim lines with tax, the state of an invoice,
// an order and a claim, the cash book, registration takings and the race summary.
import * as F from './rd-finance.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: finance rules');

/* ---------- money in and out ---------- */
for (const [v, want] of [['0.5', 50], ['1234.5', 123450], [1234.5, 123450], ['1234.56', 123456], [5, 500], ['  75  ', 7500], ['00012', 1200], ['999999999.99', 99999999999], [0.01, 1], ['100', 10000]]) eq(F.toPaise(v), want, 'toPaise(' + JSON.stringify(v) + ') = ' + want);
const bad = ['', ' ', 'abc', '1,000', '₹500', '5.555', '5.', '.5', '-5', -5, '+5', '1e3', 1e21, 1e-7, NaN, Infinity, -Infinity, null, undefined, true, [], [5], {}, { a: 1 }, '0', 0, '0.00', '1000000000', '9999999999', '12 34', '5\n6', '0x10', '१२३'];
let rejected = 0;
for (const v of bad) if (F.toPaise(v) === null) rejected++;
ok(rejected === bad.length, 'toPaise refuses all ' + bad.length + ' odd or hostile amounts (text, commas, symbols, negatives, exponents, NaN, Infinity, arrays, objects, zero, 10-digit rupees): ' + rejected + '/' + bad.length);
eq(F.toPaise('0', true), 0, 'zero is allowed when asked for');
eq(F.toPaise('0.00', true), 0, '0.00 is allowed when asked for');
eq(F.toPaise('-1', true), null, 'a negative is refused even when zero is allowed');
eq(F.P('12345'), 12345, 'P reads a stored amount');
eq([F.P('-5'), F.P('abc'), F.P(''), F.P(null), F.P(undefined), F.P({}), F.P('1.9'), F.P('12abc')], [0, 0, 0, 0, 0, 0, 1, 12], 'P turns anything odd into a safe whole number (never negative)');
eq(F.P('99999999999999999999'), F.MAX_PAISE, 'P never goes beyond the largest amount');
eq([F.rupees(12345), F.rupees(5), F.rupees(0), F.rupees(-250)], [123.45, 0.05, 0, -2.5], 'rupees()');

/* ---------- digit grouping and words ---------- */
eq([F.fmt(0), F.fmt(5), F.fmt(99), F.fmt(100), F.fmt(123456), F.fmt(12345650), F.fmt(100000000), F.fmt(1000000000), F.fmt(99999999999)], ['0.00', '0.05', '0.99', '1.00', '1,234.56', '1,23,456.50', '10,00,000.00', '1,00,00,000.00', '99,99,99,999.99'], 'fmt groups digits the Indian way (1,23,456.50)');
eq(F.fmt(-50), '0.00', 'fmt never shows a negative amount');
eq(F.inWords(0), 'Rupees Zero Only', 'in words: zero');
eq(F.inWords(100), 'Rupees One Only', 'in words: one rupee');
eq(F.inWords(50), 'Fifty Paise Only', 'in words: fifty paise');
eq(F.inWords(150), 'Rupees One and Fifty Paise Only', 'in words: Rupees One and Fifty Paise');
eq(F.inWords(1000), 'Rupees Ten Only', 'in words: ten');
eq(F.inWords(1900), 'Rupees Nineteen Only', 'in words: nineteen');
eq(F.inWords(2100), 'Rupees Twenty-One Only', 'in words: twenty-one');
eq(F.inWords(10000), 'Rupees One Hundred Only', 'in words: one hundred');
eq(F.inWords(100000), 'Rupees One Thousand Only', 'in words: one thousand');
eq(F.inWords(1000000), 'Rupees Ten Thousand Only', 'in words: ten thousand');
eq(F.inWords(10000000), 'Rupees One Lakh Only', 'in words: one lakh');
eq(F.inWords(12345650), 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only', 'in words: 1,23,456.50');
eq(F.inWords(500000000), 'Rupees Fifty Lakh Only', 'in words: fifty lakh');
eq(F.inWords(1000000000), 'Rupees One Crore Only', 'in words: one crore');
eq(F.inWords(F.MAX_PAISE), 'Rupees Ninety-Nine Crore Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine and Ninety-Nine Paise Only', 'in words: the largest amount');
eq([F.inWords(-1), F.inWords(1.5), F.inWords('5'), F.inWords(null), F.inWords(F.MAX_PAISE + 1)], ['', '', '', '', ''], 'in words: anything that is not a whole, allowed amount gives nothing');
// Every amount from 0 to 3000 paise and a spread of larger ones: the words never contain a double space, an undefined, or a lowercase start.
let wordsOk = 0;
let wordsTotal = 0;
const samples = [];
for (let n = 0; n <= 3000; n++) samples.push(n);
for (let n = 3100; n < 99999999999; n = Math.floor(n * 1.07) + 11) samples.push(n);
for (const n of samples) {
  wordsTotal++;
  const w = F.inWords(n);
  if (/^[A-Z]/.test(w) && w.endsWith(' Only') && !/ {2}|undefined|NaN|null/.test(w)) wordsOk++;
}
ok(wordsOk === wordsTotal, 'in words is clean for ' + wordsTotal + ' amounts (capitalised, ends with Only, no double spaces or undefined): ' + wordsOk + '/' + wordsTotal);

/* ---------- financial year and numbering ---------- */
eq([F.fyOf('2026-10-27'), F.fyOf('2027-03-31'), F.fyOf('2026-04-01'), F.fyOf('2026-03-31'), F.fyOf('2026-01-15'), F.fyOf('2099-12-31'), F.fyOf('2100-02-01')], ['2026-27', '2026-27', '2026-27', '2025-26', '2025-26', '2099-00', '2099-00'], 'financial year runs April to March (including the 2099-00 rollover)');
eq([F.docId('inv', '2026-27', 7), F.docNumber('INV', '2026-27', 7), F.docNumber('VTRA/INV', '2026-27', 12345)], ['inv~2026-27~000007', 'INV/2026-27/0007', 'VTRA/INV/2026-27/12345'], 'document id and number');
eq([F.tailSeq('inv~2026-27~000012'), F.tailSeq('p~inv~2026-27~000012~003'), F.tailSeq('i123'), F.tailSeq(''), F.tailSeq(undefined), F.tailSeq('x~12abc')], [12, 3, 0, 0, 0, 0], 'tailSeq reads the number at the end of an id');
eq(F.payId('ord~2026-27~000001', 4), 'p~ord~2026-27~000001~004', 'payment id');
eq([F.cleanPrefix('inv', 'X'), F.cleanPrefix('VTRA/INV', 'X'), F.cleanPrefix('', 'X'), F.cleanPrefix('a b', 'X'), F.cleanPrefix('x'.repeat(13), 'X'), F.cleanPrefix('-A', 'X'), F.cleanPrefix(null, 'X'), F.cleanPrefix({}, 'X'), F.cleanPrefix('A<B>', 'X')], ['INV', 'VTRA/INV', 'X', 'X', 'X', 'X', 'X', 'X', 'X'], 'invoice prefix: letters, digits, dash, slash; otherwise the default');
eq([F.validDate('2026-02-29'), F.validDate('2028-02-29'), F.validDate('2026-13-01'), F.validDate('26-01-01'), F.validDate(''), F.validDate(null), F.validDate('2026-1-1')], [false, true, false, false, false, false, false], 'validDate');
eq([F.istToday(Date.parse('2026-10-26T20:00:00Z')), F.istToday(Date.parse('2026-10-26T18:29:59Z')), F.addDays('2026-02-28', 1), F.addDays('2026-03-01', -1)], ['2026-10-27', '2026-10-26', '2026-03-01', '2026-02-28'], 'India date and adding days');
eq([F.isKey('abcdefgh'), F.isKey('a'.repeat(40)), F.isKey('a'.repeat(41)), F.isKey('short'), F.isKey('has space1'), F.isKey('ok_key-123'), F.isKey(12345678), F.isKey(null), F.isKey('é'.repeat(10))], [true, true, false, false, false, true, false, false, false], 'request keys');
eq([F.cleanText('  hi\u0000there\n', 20), F.cleanText({ a: 1 }, 5), F.cleanText(['x'], 5), F.cleanText(null, 5), F.cleanText('abcdefgh', 3), F.cleanText(12, 5)], ['hi there', '', '', '', 'abc', '12'], 'cleanText strips control characters, ignores objects, cuts to length');
eq([F.cleanText('Acme\u202eLtd\u202c', 20), F.cleanText('\u2066x\u2069', 5), F.cleanText('Ravi \u200eK', 20)], ['AcmeLtd', 'x', 'Ravi \u200eK'], 'cleanText drops the characters that flip text direction (look-alike names) and keeps ordinary marks');
eq([F.cleanText('a\u2028b\u2029c', 20), F.cleanText('x\u0085y\u009fz', 20), F.cleanText('\u007fq', 5)], ['a b c', 'x y z', 'q'], 'cleanText turns line and paragraph separators and the C1 control characters into a space as well');

/* ---------- invoice lines and tax ---------- */
const il = F.cleanInvoiceLines([{ desc: 'Title sponsorship', qty: 1, rate: '500000', taxPct: 18 }, { desc: 'Banner space', qty: '3', rate: '1234.56', taxPct: '5' }, { desc: 'Stall', qty: 2, rate: '10000' }]);
eq(il.lines.map((l) => [l.amount, l.tax]), [[50000000, 9000000], [370368, 18518], [2000000, 0]], 'lines: amount and tax per line in paise');
eq([il.subtotal, il.tax, il.total], [52370368, 9018518, 61388886], 'invoice totals add up exactly');
eq(il.lines[0].taxPct, 18, 'tax percent kept');
// Independent check with BigInt on random lines.
let taxOk = 0;
const rnd = (n) => Math.floor(Math.random() * n);
for (let t = 0; t < 3000; t++) {
  const qty = 1 + rnd(500);
  const rate = 1 + rnd(99999999);
  const pc = rnd(2801) / 100; // 0.00 to 28.00
  if (BigInt(qty) * BigInt(rate) > BigInt(F.MAX_PAISE)) continue;
  const r = F.cleanInvoiceLines([{ desc: 'item', qty, rate: (rate / 100).toFixed(2), taxPct: pc.toFixed(2) }]);
  const amount = BigInt(qty) * BigInt(rate);
  const pcN = BigInt(Math.round(pc * 100));
  const taxWant = (amount * pcN * 2n + 10000n) / 20000n; // round half up
  if (BigInt(r.lines[0].amount) === amount && BigInt(r.lines[0].tax) === taxWant && r.total === Number(amount + taxWant)) taxOk++;
  else console.log('  mismatch', qty, rate, pc, r.lines[0], String(taxWant));
}
ok(taxOk > 2500, 'tax on a line is exact (checked against BigInt arithmetic on random lines): ' + taxOk);
const badInv = [
  [undefined, 'no list'], [[], 'empty list'], ['x', 'text instead of a list'], [{}, 'object instead of a list'], [Array.from({ length: 31 }, () => ({ desc: 'ab', qty: 1, rate: '1' })), '31 lines'],
  [[{ desc: 'a', qty: 1, rate: '1' }], 'one-letter description'], [[{ desc: 'ab', qty: 0, rate: '1' }], 'quantity 0'], [[{ desc: 'ab', qty: 1.5, rate: '1' }], 'fractional quantity'], [[{ desc: 'ab', qty: '1.5', rate: '1' }], 'fractional quantity text'],
  [[{ desc: 'ab', qty: -1, rate: '1' }], 'negative quantity'], [[{ desc: 'ab', qty: 100001, rate: '1' }], 'quantity above 100000'], [[{ desc: 'ab', qty: 1, rate: '0' }], 'zero rate'], [[{ desc: 'ab', qty: 1, rate: '-5' }], 'negative rate'],
  [[{ desc: 'ab', qty: 1, rate: 'ten' }], 'rate in words'], [[{ desc: 'ab', qty: 1, rate: '1', taxPct: '101' }], 'tax above 100'], [[{ desc: 'ab', qty: 1, rate: '1', taxPct: '18.555' }], 'tax with three decimals'], [[{ desc: 'ab', qty: 1, rate: '1', taxPct: -1 }], 'negative tax'],
  [[{ desc: 'ab', qty: 1, rate: '1', taxPct: 'abc' }], 'tax in letters'], [[null], 'null line'], [[[1, 2]], 'a line that is a list'], [[{ qty: 1, rate: '1' }], 'no description'],
  [[{ desc: 'ab', qty: 100000, rate: '999999999' }], 'amount above the limit'], [[{ desc: 'ab', qty: 1, rate: '999999999.99', taxPct: 28 }], 'total above the limit once tax is added'],
];
let invRefused = 0;
for (const [v, what] of badInv) {
  try {
    F.cleanInvoiceLines(v);
    console.log('  FAIL accepted:', what);
  } catch (e) {
    if (/^(bad_lines|bad_money)$/.test(e.message)) invRefused++;
  }
}
ok(invRefused === badInv.length, 'invoice lines: ' + badInv.length + ' bad inputs are all refused with a plain code: ' + invRefused + '/' + badInv.length);
eq(F.cleanInvoiceLines([{ desc: 'Free line', qty: 1, rate: '10', taxPct: '' }]).lines[0].taxPct, 0, 'an empty tax percent means 0');

/* ---------- claim lines ---------- */
const cl = F.cleanClaimLines([{ date: '2026-10-20', desc: 'Water cans for aid station', cat: 'Aid stations', amount: '1200.50', bill: 'Bill 77' }, { date: '2026-10-27', desc: 'Auto fare', amount: 150 }], '2026-10-27');
eq([cl.total, cl.lines[0].amount, cl.lines[1].cat], [135050, 120050, 'Other'], 'claim lines: total in paise, category defaults to Other');
const badCl = [
  [[], 'empty'], ['x', 'text'], [Array.from({ length: 31 }, () => ({ date: '2026-10-20', desc: 'ab', amount: '1' })), '31 lines'], [[{ date: '2026-10-20', desc: 'a', amount: '1' }], 'short description'],
  [[{ date: '2026-10-20', desc: 'ab', amount: '0' }], 'zero amount'], [[{ date: '2026-10-20', desc: 'ab', amount: 'x' }], 'letters amount'], [[{ date: '2026-12-01', desc: 'ab', amount: '1' }], 'a spend dated in the future'],
  [[{ date: '2026-02-30', desc: 'ab', amount: '1' }], 'impossible date'], [[{ desc: 'ab', amount: '1' }], 'no date'], [[null], 'null'],
];
let clRefused = 0;
for (const [v, what] of badCl) {
  try {
    F.cleanClaimLines(v, '2026-10-27');
    console.log('  FAIL accepted:', what);
  } catch (e) {
    if (/^(bad_lines|bad_money|bad_fdate)$/.test(e.message)) clRefused++;
  }
}
ok(clRefused === badCl.length, 'claim lines: ' + badCl.length + ' bad inputs are all refused: ' + clRefused + '/' + badCl.length);
// Cutting an approved amount across lines
const al = [{ cat: 'A', amount: 10000 }, { cat: 'B', amount: 30000 }, { cat: 'C', amount: 10000 }];
eq(F.allocate(al, 25000).map((l) => l.amount), [5000, 15000, 5000], 'half approved: every line halved');
eq(F.allocate(al, 50000).map((l) => l.amount), [10000, 30000, 10000], 'fully approved: lines unchanged');
eq(F.allocate(al, 0).map((l) => l.amount), [0, 0, 0], 'nothing approved: nothing');
eq(F.allocate(al, 70000).map((l) => l.amount), [10000, 30000, 10000], 'approving more than claimed changes nothing');
let allocOk = 0;
for (let t = 0; t < 1500; t++) {
  const lines = Array.from({ length: 1 + rnd(8) }, () => ({ cat: 'c' + rnd(4), amount: 1 + rnd(500000) }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const approved = 1 + rnd(total);
  const out = F.allocate(lines, approved);
  const sumOut = out.reduce((s, l) => s + l.amount, 0);
  if (sumOut === approved && out.every((l, i) => l.amount >= 0 && l.amount <= lines[i].amount + 1 && Number.isInteger(l.amount))) allocOk++;
}
ok(allocOk === 1500, 'cutting an approval across lines always adds up to exactly what was approved (1500 random claims): ' + allocOk + '/1500');

/* ---------- stored rows with odd values ---------- */
const led = (o) => F.normLedger(Object.assign({ _id: 'l' + Math.random(), event: 'e1', type: 'expense', amount: '0', mode: 'bank', source: 'manual', sourceId: '' }, o));
const oddL = F.normLedger({ _id: 'x', type: 'weird', amount: '-5', tds: 'abc', mode: 'bitcoin', date: '2026-13-45', phase: 'x', source: 'y', holder: { a: 1 }, void: 'no' });
eq([oddL.type, oddL.amount, oddL.tds, oddL.mode, oddL.date, oddL.phase, oddL.source, oddL.holder, oddL.void], ['expense', 0, 0, 'other', '', '', 'manual', '', false], 'a ledger row with odd stored values becomes safe defaults');
const oddI = F.normInvoice({ _id: 'i', lines: 'not json', org: '[1,2]', total: '-1', status: 'weird', kind: 'weird' });
eq([oddI.lines, oddI.total, oddI.status, oddI.kind, oddI.org.name], [[], 0, 'issued', 'other', F.DEFAULT_ORG.name], 'an invoice with odd stored values becomes safe defaults');
const oddC = F.normClaim({ _id: 'c', lines: '{"a":1}', status: 'weird', approved: '9'.repeat(30) });
eq([oddC.lines, oddC.status, oddC.approved], [[], 'submitted', F.MAX_PAISE], 'a claim with odd stored values becomes safe defaults');
eq(F.normOrder({ _id: 'o', estimate: 'abc', status: 'x' }).estimate, 0, 'an order with an odd estimate reads as 0');
const org = F.orgOut({ name: '', pan: 'abcde1234f', gstin: 'x', upi: '<b>', invPrefix: 'bad prefix!', terms: 'x'.repeat(900) });
eq([org.name, org.pan, org.invPrefix, org.terms.length], [F.DEFAULT_ORG.name, 'ABCDE1234F', 'INV', 400], 'organisation details are cleaned');

/* ---------- invoices ---------- */
const inv = F.normInvoice({ _id: 'inv~1', total: '1000000', status: 'issued', due: '2026-11-10', lines: '[]' });
const pay = (id, o) => led(Object.assign({ type: 'income', source: 'invoice', sourceId: id }, o));
let st = F.invoiceState(inv, [], '2026-10-27');
eq([st.status, st.balance, st.overdue], ['issued', 1000000, false], 'new invoice: issued, whole balance, not overdue');
st = F.invoiceState(inv, [], '2026-11-11');
eq([st.status, st.overdue], ['issued', true], 'past the due date: overdue');
st = F.invoiceState(inv, [pay('inv~1', { amount: '400000' })], '2026-11-11');
eq([st.status, st.received, st.balance, st.overdue], ['part', 400000, 600000, true], 'part paid is still overdue after the due date');
st = F.invoiceState(inv, [pay('inv~1', { amount: '400000' }), pay('inv~1', { amount: '540000', tds: '60000' })], '2026-10-27');
eq([st.status, st.received, st.tds, st.settled, st.balance], ['paid', 940000, 60000, 1000000, 0], 'money plus tax withheld at source settles the invoice');
st = F.invoiceState(inv, [pay('inv~1', { amount: '1000000', void: 'yes' })], '2026-10-27');
eq([st.status, st.received], ['issued', 0], 'a voided payment does not count');
st = F.invoiceState(inv, [pay('inv~OTHER', { amount: '1000000' })], '2026-10-27');
eq(st.received, 0, 'a payment on another invoice does not count');
st = F.invoiceState(inv, [led({ type: 'expense', source: 'invoice', sourceId: 'inv~1', amount: '1000000' })], '2026-10-27');
eq(st.received, 0, 'an expense row can never settle an invoice');
st = F.invoiceState(Object.assign({}, inv, { status: 'cancelled' }), [], '2026-11-11');
eq([st.status, st.overdue], ['cancelled', false], 'a cancelled invoice is never overdue');
st = F.invoiceState(inv, [pay('inv~1', { amount: '1000000' })], '2026-11-11');
eq([st.status, st.overdue], ['paid', false], 'a paid invoice is never overdue');

/* ---------- orders: estimate, advance, actual ---------- */
const ord = F.normOrder({ _id: 'ord~1', estimate: '5000000', status: 'open' });
const op = (o) => led(Object.assign({ source: 'order', sourceId: 'ord~1' }, o));
let os = F.orderState(ord, []);
eq([os.state, os.paid, os.balance, os.actual, os.variance], ['estimate', 0, 5000000, null, null], 'order with only an estimate');
os = F.orderState(ord, [op({ type: 'expense', phase: 'advance', amount: '2000000' })]);
eq([os.state, os.advance, os.paid, os.balance, os.actual], ['advance', 2000000, 2000000, 3000000, null], 'advance paid before any bill: balance is estimate minus advance');
os = F.orderState(ord, [op({ type: 'expense', phase: 'advance', amount: '2000000' }), op({ type: 'bill', amount: '4200000' })]);
eq([os.state, os.actual, os.variance, os.paid, os.balance, os.refundDue], ['billed', 4200000, -800000, 2000000, 2200000, 0], 'billed under the estimate: actual 42,000 against 50,000, 22,000 still to pay');
os = F.orderState(ord, [op({ type: 'expense', phase: 'advance', amount: '2000000' }), op({ type: 'bill', amount: '4200000' }), op({ type: 'expense', phase: 'payment', amount: '2200000' })]);
eq([os.state, os.paid, os.balance], ['settled', 4200000, 0], 'order settled');
os = F.orderState(ord, [op({ type: 'expense', phase: 'advance', amount: '5000000' }), op({ type: 'bill', amount: '4200000' })]);
eq([os.state, os.refundDue, os.balance], ['refund', 800000, 0], 'advance larger than the bill: a refund is due from the vendor');
os = F.orderState(ord, [op({ type: 'expense', phase: 'advance', amount: '5000000' }), op({ type: 'bill', amount: '4200000' }), op({ type: 'income', phase: 'refund', amount: '800000' })]);
eq([os.state, os.refundDue, os.paid], ['settled', 0, 4200000], 'refund received: settled again');
os = F.orderState(ord, [op({ type: 'bill', amount: '5500000' })]);
eq([os.variance, os.balance], [500000, 5500000], 'billed over the estimate: variance +5,000');
os = F.orderState(ord, [op({ type: 'expense', phase: 'advance', amount: '2000000', void: 'yes' }), op({ type: 'bill', amount: '100', void: 'yes' })]);
eq([os.state, os.paid, os.billed], ['estimate', 0, 0], 'voided rows do not count');
os = F.orderState(Object.assign({}, ord, { status: 'cancelled' }), []);
eq(os.state, 'cancelled', 'cancelled order');
os = F.orderState(ord, [op({ type: 'bill', amount: '1000000' }), op({ type: 'bill', amount: '500000' })]);
eq(os.billed, 1500000, 'two bills add up');
eq(F.orderState(ord, [led({ source: 'order', sourceId: 'ord~2', type: 'expense', phase: 'advance', amount: '100' })]).paid, 0, 'a payment on another order does not count');

/* ---------- claims ---------- */
const clm = F.normClaim({ _id: 'clm~1', total: '300000', approved: '250000', status: 'approved' });
const cp = (o) => led(Object.assign({ type: 'expense', source: 'claim', sourceId: 'clm~1' }, o));
let cs = F.claimState(clm, []);
eq([cs.status, cs.approved, cs.balance], ['approved', 250000, 250000], 'approved claim, nothing paid');
cs = F.claimState(clm, [cp({ amount: '100000' })]);
eq([cs.status, cs.paid, cs.balance], ['part', 100000, 150000], 'part paid');
cs = F.claimState(clm, [cp({ amount: '100000' }), cp({ amount: '150000' })]);
eq([cs.status, cs.balance], ['paid', 0], 'paid in full (the approved amount, not the claimed one)');
cs = F.claimState(clm, [cp({ amount: '250000', void: 'yes' })]);
eq(cs.status, 'approved', 'a voided payment puts the claim back to approved');
eq(F.claimState(F.normClaim({ _id: 'clm~1', total: '300000', status: 'submitted' }), []).status, 'submitted', 'submitted stays submitted');
eq(F.claimState(F.normClaim({ _id: 'clm~1', total: '300000', approved: '99', status: 'rejected' }), []).approved, 0, 'a rejected claim has nothing approved');
eq(F.claimState(clm, [cp({ amount: '100000', source: 'order' })]).paid, 0, 'a payment recorded on another kind of document does not count');

/* ---------- cash book ---------- */
const cr = (o) => led(Object.assign({ mode: 'cash' }, o));
const book = F.cashBook([
  cr({ type: 'withdrawal', amount: '5000000', holder: 'Ravi' }),
  cr({ type: 'withdrawal', amount: '1000000', holder: 'ravi ' }),
  cr({ type: 'expense', amount: '1500000', holder: 'RAVI' }),
  cr({ type: 'deposit', amount: '500000', holder: 'Ravi' }),
  cr({ type: 'income', amount: '200000', holder: 'Ravi' }),
  cr({ type: 'withdrawal', amount: '2000000', holder: 'Sita' }),
  cr({ type: 'expense', amount: '2500000', holder: 'Sita' }),
  cr({ type: 'expense', amount: '999999', holder: 'Ravi', void: 'yes' }),
  led({ type: 'expense', mode: 'upi', amount: '777777', holder: 'Ravi' }),
]);
const ravi = book.holders.find((h) => h.holder.toLowerCase().trim() === 'ravi');
const sita = book.holders.find((h) => h.holder === 'Sita');
eq(book.holders.length, 2, 'one holder per person, whatever the capital letters or spaces');
eq([ravi.withdrawn, ravi.spent, ravi.deposited, ravi.received, ravi.inHand], [6000000, 1500000, 500000, 200000, 4200000], 'Ravi: withdrawn - spent - put back + received = in hand');
eq(sita.inHand, -500000, 'Sita spent more cash than she held: negative in hand is visible');
eq([book.withdrawn, book.spent, book.inHand], [8000000, 4000000, 3700000], 'cash totals ignore voided rows and non-cash payments');

/* ---------- registration takings ---------- */
const cats = [{ name: '21.1 km Half Marathon', price: 1200 }, { name: '10K Run', price: 800.5 }, { name: '5K Fun Run', price: 0 }];
const rr = F.regRevenue(cats, [{ cat: '21.1 km Half Marathon', status: 'ok' }, { cat: '21.1KM half marathon', status: 'ok' }, { cat: '10K Run', status: 'ok' }, { cat: '10K Run', status: 'pending' }, { cat: '5K Fun Run', status: 'ok' }, { cat: 'Unknown', status: 'ok' }, { cat: '10K', status: 'ok' }]);
eq(rr, { paid: 6, unpaid: 1, revenue: 120000 * 2 + 80050 * 2 + 0 + 0, pending: 80050 }, 'takings: paid registrations at their category price (names matched loosely, like the dashboard)');
eq(F.regRevenue([], [{ cat: 'x', status: 'ok' }]), { paid: 1, unpaid: 0, revenue: 0, pending: 0 }, 'no categories: counted but no money');
eq(F.regRevenue(undefined, []), { paid: 0, unpaid: 0, revenue: 0, pending: 0 }, 'no categories and no registrations');

/* ---------- the race summary ---------- */
const I = (id, total, o) => F.normInvoice(Object.assign({ _id: id, total: String(total), subtotal: String(total), status: 'issued', due: '2026-12-01', lines: '[]' }, o));
const O = (id, est, cat) => F.normOrder({ _id: id, estimate: String(est), cat, status: 'open', vendor: 'V' });
const C = (id, total, approved, status, lines) => F.normClaim({ _id: id, total: String(total), approved: String(approved), status, lines: JSON.stringify(lines || []) });
const L = (o) => led(o);
const invoices = [I('inv1', 5900000), I('inv2', 1000000), I('inv3', 700000, { status: 'cancelled' })];
const orders = [O('o1', 5000000, 'Finisher items'), O('o2', 3000000, 'Timing and results'), F.normOrder({ _id: 'o3', estimate: '999', status: 'cancelled', cat: 'Awards' })];
const claims = [
  C('c1', 600000, 450000, 'approved', [{ date: '2026-10-01', desc: 'Cans', cat: 'Aid stations', amount: 400000 }, { date: '2026-10-01', desc: 'Auto', cat: 'Logistics', amount: 200000 }]),
  C('c2', 100000, 0, 'submitted', [{ date: '2026-10-02', desc: 'Tape', cat: 'Route and marking', amount: 100000 }]),
  C('c3', 50000, 0, 'rejected', []),
];
const ledger = [
  L({ type: 'income', source: 'invoice', sourceId: 'inv1', amount: '2000000', tds: '200000', mode: 'bank' }),
  L({ type: 'income', source: 'manual', amount: '300000', cat: 'Donation', mode: 'upi' }),
  L({ type: 'bill', source: 'order', sourceId: 'o1', amount: '4200000' }),
  L({ type: 'expense', source: 'order', sourceId: 'o1', phase: 'advance', amount: '5000000', cat: 'Finisher items' }),
  L({ type: 'expense', source: 'order', sourceId: 'o2', phase: 'advance', amount: '1000000', cat: 'Timing and results' }),
  L({ type: 'expense', source: 'claim', sourceId: 'c1', amount: '200000' }),
  L({ type: 'expense', source: 'manual', amount: '90000', cat: 'Admin' }),
  L({ type: 'expense', source: 'manual', amount: '55555', cat: 'Admin', void: 'yes' }),
  L({ type: 'withdrawal', mode: 'cash', holder: 'Ravi', amount: '1000000' }),
];
const budget = [{ kind: 'budget', phase: 'expense', cat: 'Finisher items', amount: '45000', status: 'planned' }, { kind: 'budget', phase: 'expense', cat: 'Aid stations', amount: '10000', status: 'planned' }, { kind: 'budget', phase: 'expense', cat: 'Awards', amount: '5000', status: 'cancelled' }, { kind: 'budget', phase: 'income', cat: 'Income', amount: '100000', status: 'planned' }];
const S = F.summary(invoices, orders, claims, ledger, budget, { paid: 100, unpaid: 3, revenue: 12000000, pending: 360000 }, '2026-10-27');
eq([S.income.invoiced, S.income.received, S.income.tds, S.income.outstanding, S.income.other, S.income.total], [6900000, 2000000, 200000, 4700000, 300000, 14300000], 'income: invoiced (cancelled left out), received, TDS, outstanding, other, total with registrations');
eq([S.expenses.paid, S.expenses.refundDue, S.expenses.owed, S.expenses.committed, S.expenses.pendingClaims], [6290000, 800000, 250000, 2000000, 100000], 'expenses: paid out, refund due from a vendor, owed on bills and claims, committed but not billed, pending claims');
eq(S.expenses.projected, 6290000 + 250000 + 2000000 + 100000 - 800000, 'projected cost = paid + owed + committed + pending claims - refund due');
eq(S.result.net, 14300000 - 6290000, 'net so far = income received - money paid out');
eq(S.result.projected, 14300000 + 4700000 - S.expenses.projected, 'projected result');
eq(S.budget, { cost: 5500000, income: 10000000 }, 'budget totals leave out cancelled lines');
const cat = (n) => S.byCat.find((c) => c.cat === n);
eq([cat('Finisher items').budget, cat('Finisher items').estimate, cat('Finisher items').actual], [4500000, 5000000, 4200000], 'by category: Finisher items budget, estimate and actual (the bill)');
eq([cat('Aid stations').actual, cat('Logistics').actual, cat('Route and marking')], [300000, 150000, undefined], 'approved claim spread over its categories in proportion; a pending claim is not a cost yet');
eq(cat('Admin').actual, 90000, 'direct expense counts, a voided one does not');
eq(S.byCat.reduce((s, c) => s + c.actual, 0), S.expenses.cost, 'the categories add up to the total cost');
eq([S.orders.count, S.orders.estimate, S.orders.billed, S.orders.advance, S.orders.paid, S.orders.balance, S.orders.refundDue], [2, 8000000, 4200000, 6000000, 6000000, 0, 800000], 'orders: cancelled one left out; estimate, billed, advance, paid');
eq([S.claims.pending.count, S.claims.pending.amount, S.claims.approved.count, S.claims.approved.balance, S.claims.paid], [1, 100000, 1, 250000, 200000], 'claims: pending, approved and unpaid, paid');
eq([S.cash.withdrawn, S.cash.inHand], [1000000, 1000000], 'cash: withdrawn and in hand');
eq([S.income.invoices.count, S.income.invoices.overdueCount], [2, 0], 'invoices: counted without the cancelled one, none overdue yet');
const S2 = F.summary(invoices, orders, claims, ledger, budget, { paid: 0, unpaid: 0, revenue: 0, pending: 0 }, '2026-12-02');
eq([S2.income.invoices.overdueCount, S2.income.invoices.overdueAmount], [2, 4700000], 'after the due date both open invoices are overdue');
const out = F.summaryOut(S);
eq([out.income.total, out.expenses.paid, out.result.net, out.byCat.length > 0, out.cash.inHand, out.income.registrations.paid], [143000, 62900, 80100, true, 10000, 100], 'the screen figures are in rupees (counts stay counts)');
const empty = F.summaryOut(F.summary([], [], [], [], [], { paid: 0, unpaid: 0, revenue: 0, pending: 0 }, '2026-10-27'));
eq([empty.income.total, empty.expenses.paid, empty.result.net, empty.byCat, empty.cash.holders], [0, 0, 0, [], []], 'an empty race gives all zeros, no errors');

done();
