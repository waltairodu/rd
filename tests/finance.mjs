// COMPONENT + INTEGRATION TESTS (backend): wix/director/finance.web.js on one database with the real RaceOS backend.
// Invoices, orders (estimate / advance / actual), reimbursement claims, cash withdrawals, the ledger and the summary,
// the rules that keep money honest (no overpayment, no spending cash that is not held, no double entry, nothing deleted),
// what a lead may and may not see, and the figures against an independent recount straight from the stored rows.
import * as R from './racedir.test.mjs';
import * as F from './finance.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Finance: backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const TODAY = istDay(0);
const fyNow = (() => {
  const y = parseInt(TODAY.slice(0, 4), 10);
  const m = parseInt(TODAY.slice(5, 7), 10);
  const a = m >= 4 ? y : y - 1;
  return a + '-' + String((a + 1) % 100).padStart(2, '0');
})();
let kseq = 0;
const K = () => 'key' + Date.now().toString(36) + (++kseq).toString(36) + Math.random().toString(36).slice(2, 8);
const rows = (t) => [...(DB[t] || new Map()).values()];
const rupee = (p) => p / 100;

/* ---------- the world ---------- */
global.__COLS.add('Import910');
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const tok = {};
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['lead.two', 'Lead Two', 'lead'], ['view.one', 'Viewer One', 'viewer'], ['coach.one', 'Coach One', 'coach']]) {
  const s = await R.saveTeam({ token: OT, username: u, name, role });
  if (role === 'coach') {
    // a coach cannot log in to RaceOS; give the coach a session as the coach page would, to show Finance still refuses it
    tok[u] = A.newToken();
    await wd.insert('ExpoSessions', { token: tok[u], username: u, desk: '', expires: new Date(Date.now() + 3600000).toISOString() }, SA);
  } else tok[u] = (await R.login({ username: u, password: s.secret })).token;
}
const DT = tok['dir.two'];
let L1 = tok['lead.one'];
const L2 = tok['lead.two'];
const ev = (await R.saveEvent({ token: OT, name: 'VHM 5th edition', date: istDay(30), venue: 'RK Beach' })).event;
const ev2 = (await R.saveEvent({ token: OT, name: 'Ultribe Paderu', date: istDay(60), venue: 'Paderu' })).event;
const EV = ev.id;
const EV2 = ev2.id;
const call = (fn, t, o, e) => F[fn](Object.assign({ token: t, ev: e || EV }, o));
const must = async (fn, t, o, e) => {
  try {
    return await call(fn, t, o, e);
  } catch (x) {
    console.log('  unexpected error from ' + fn + ': ' + x.message);
    return { error: x.message };
  }
};
const log = (name, t) => rows('RDLedger').filter((r) => r.event === (t || EV)).length;

/* ---------- F1. the details printed on invoices ---------- */
const s0 = await call('finSettings', OT);
eq([s0.org.name, s0.org.invPrefix, s0.org.gstin], ['Visakha Trail Running Association', 'INV', ''], 'F1 details start with the association name and the INV prefix');
const s1 = await call('finSaveSettings', OT, { address: 'Siripuram, Visakhapatnam', pan: 'aaatv1234k', gstin: '', upi: 'vtra@okbank', bank: 'HDFC Bank, A/c 0000, IFSC HDFC0000001', signatory: 'V. Yogeshwar Rao', terms: 'Pay within 15 days.' });
eq([s1.org.pan, s1.org.address, s1.org.signatory], ['AAATV1234K', 'Siripuram, Visakhapatnam', 'V. Yogeshwar Rao'], 'F1 details saved (PAN is made upper case)');
await refused(call('finSaveSettings', OT, { pan: 'ABC' }), 'bad_pan', 'F1 a PAN that is not a PAN is refused');
await refused(call('finSaveSettings', OT, { gstin: '37AAATV1234K1' }), 'bad_gstin', 'F1 a GSTIN that is not a GSTIN is refused');
await refused(call('finSaveSettings', OT, { upi: 'not an upi' }), 'bad_upi', 'F1 a UPI id that is not a UPI id is refused');
await refused(call('finSaveSettings', OT, { invPrefix: 'bad prefix!' }), 'bad_prefix', 'F1 an invoice prefix with odd characters is refused');
await refused(call('finSaveSettings', OT, { name: '' }), 'name_needed', 'F1 the name cannot be emptied');
eq((await call('finSettings', DT)).org.pan, 'AAATV1234K', 'F1 the second director sees the saved details');
await call('finSaveSettings', OT, { gstin: '37AAATV1234K1Z5' });
eq((await call('finSettings', OT)).org.gstin, '37AAATV1234K1Z5', 'F1 a real-looking GSTIN is accepted');

/* ---------- F2. invoices ---------- */
const lines = [{ desc: 'Title sponsorship', qty: 1, rate: '500000', taxPct: 18 }, { desc: 'Banner space', qty: 2, rate: '10000', taxPct: 0 }];
await rows('RDPlan'); // (sponsor row for the link check)
await wd.insert('RDPlan', { _id: 'sp1', event: EV, kind: 'sponsor', title: 'Acme Corp', phase: 'cash', status: 'committed', amount: '610000', amount2: '' }, SA);
const k1 = K();
const i1 = await call('finRaiseInvoice', OT, { party: 'Acme Corp', partyAddr: 'Madhurawada, Visakhapatnam', partyGstin: '37abcde1234f1z5', partyEmail: 'accounts@acme.example', lines, notes: 'Title sponsor of VHM', sponsorId: 'sp1', key: k1 });
eq(i1.number, 'INV/' + fyNow + '/0001', 'F2 the first invoice is INV/' + fyNow + '/0001');
const li = await call('finListInvoices', OT);
const v1 = li.invoices[0];
eq([v1.subtotal, v1.tax, v1.total, v1.totalWords, v1.status, v1.balance, v1.partyGstin], [520000, 90000, 610000, 'Rupees Six Lakh Ten Thousand Only', 'issued', 610000, '37ABCDE1234F1Z5'], 'F2 totals, amount in words, status and balance');
eq([v1.lines[0].amount, v1.lines[0].tax, v1.lines[1].amount, v1.date, v1.due], [500000, 90000, 20000, TODAY, istDay(15)], 'F2 lines worked out; due date is 15 days after the invoice date');
eq([v1.org.name, v1.org.upi, v1.org.gstin], ['Visakha Trail Running Association', 'vtra@okbank', '37AAATV1234K1Z5'], 'F2 the details are copied onto the invoice when it is raised');
// the same key twice: nothing new is made
const again = await call('finRaiseInvoice', OT, { party: 'Acme Corp', lines, key: k1 });
ok(again.again === true && again.id === i1.id, 'F2 sending the same key again returns the same invoice');
eq(again.number, i1.number, 'F2 and the repeat answers with the same invoice number too');
eq(rows('RDInvoices').length, 1, 'F2 and no second invoice exists');
await refused(call('finRaiseInvoice', DT, { party: 'Acme Corp', lines, key: k1 }), 'busy_try_again', 'F2 another login using that key gets nothing back of the first one');
// settings change later: the raised invoice keeps what it had
await call('finSaveSettings', OT, { invPrefix: 'vtra/inv', upi: 'new@okbank' });
const i2 = await call('finRaiseInvoice', OT, { party: 'Beta Foods', kind: 'partner', lines: [{ desc: 'Stall', qty: 1, rate: '25000' }], key: K() });
eq(i2.number, 'VTRA/INV/' + fyNow + '/0002', 'F2 a new prefix applies to the next invoice and the number carries on (0002)');
const li2 = (await call('finListInvoices', OT)).invoices;
eq([li2.find((x) => x.id === i1.id).org.upi, li2.find((x) => x.id === i2.id).org.upi], ['vtra@okbank', 'new@okbank'], 'F2 the first invoice kept its original details; the second has the new ones');
await call('finSaveSettings', OT, { invPrefix: 'INV', upi: 'vtra@okbank' });
// an invoice dated in the previous financial year has that year's own numbering
const fyStart = fyNow.slice(0, 4) + '-04-01';
const prevDate = new Date(Date.parse(fyStart + 'T00:00:00Z') - 20 * 86400000).toISOString().slice(0, 10);
const prevFy = (parseInt(fyNow.slice(0, 4), 10) - 1) + '-' + fyNow.slice(2, 4);
if ((Date.parse(TODAY) - Date.parse(prevDate)) / 86400000 <= 360) {
  const i3 = await call('finRaiseInvoice', OT, { party: 'Old Co', date: prevDate, lines: [{ desc: 'Earlier support', qty: 1, rate: '1000' }], key: K() });
  eq(i3.number, 'INV/' + prevFy + '/0001', 'F2 an invoice dated ' + prevDate + ' is numbered in ' + prevFy + ' (its own sequence, starting at 0001)');
} else ok(true, 'F2 (the previous year is more than a year back today, so that check is skipped)');
// bad input
for (const [o, code, what] of [
  [{ party: 'A' }, 'name_needed', 'a one-letter name'], [{ party: 'Acme', kind: 'weird' }, 'bad_kind', 'an unknown kind'], [{ party: 'Acme', partyEmail: 'nope' }, 'bad_email', 'a bad email'],
  [{ party: 'Acme', partyGstin: '123' }, 'bad_gstin', 'a bad GSTIN'], [{ party: 'Acme', date: '2026-02-30' }, 'bad_fdate', 'an impossible date'], [{ party: 'Acme', date: istDay(5) }, 'bad_fdate', 'a date in the future'],
  [{ party: 'Acme', date: istDay(-400) }, 'bad_fdate', 'a date over a year back'], [{ party: 'Acme', due: istDay(-3) }, 'bad_fdate', 'a due date before the invoice date'], [{ party: 'Acme', lines: [] }, 'bad_lines', 'no lines'],
  [{ party: 'Acme', lines: [{ desc: 'x', qty: 1, rate: '5' }] }, 'bad_lines', 'a one-letter description'], [{ party: 'Acme', lines: [{ desc: 'Item', qty: 1, rate: '-5' }] }, 'bad_lines', 'a negative rate'],
  [{ party: 'Acme', lines: [{ desc: 'Item', qty: 1, rate: '5' }], sponsorId: 'nope' }, 'no_such_sponsor', 'a sponsor that does not exist'], [{ party: 'Acme', lines: [{ desc: 'Item', qty: 1, rate: '5' }], key: 'x' }, 'bad_key', 'a bad key'],
]) {
  const before = rows('RDInvoices').length;
  const got = await err(call('finRaiseInvoice', OT, Object.assign({ lines: [{ desc: 'Item', qty: 1, rate: '5' }] }, o)));
  ok(got === code && rows('RDInvoices').length === before, 'F2 invoice with ' + what + ' is refused (' + code + ') and nothing is saved' + (got === code ? '' : '   [got ' + (got || 'no error') + ']'));
}
await call('finSaveSettings', OT, { gstin: '' });
const sp2 = await wd.insert('RDPlan', { event: EV2, kind: 'sponsor', title: 'Other race sponsor', phase: 'cash', status: 'lead', amount: '1' }, SA);
await refused(call('finRaiseInvoice', OT, { party: 'Acme', lines, sponsorId: sp2._id }), 'no_such_sponsor', 'F2 a sponsor of a different race cannot be linked');
// payments
const p1 = await call('finPayInvoice', OT, { id: i1.id, amount: '300000', mode: 'bank', ref: 'UTR1001', key: K() });
let vi = (await call('finListInvoices', OT)).invoices.find((x) => x.id === i1.id);
eq([vi.status, vi.received, vi.balance, vi.payments.length, vi.payments[0].ref], ['part', 300000, 310000, 1, 'UTR1001'], 'F2 part payment: part paid, balance 3,10,000');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '320000' }), 'too_much', 'F2 paying more than the balance is refused');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '0' }), 'bad_money', 'F2 a payment of nothing is refused');
await refused(call('finPayInvoice', OT, { id: i1.id }), 'bad_money', 'F2 a payment with no amount is refused');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '100', mode: 'barter' }), 'bad_mode', 'F2 an unknown payment mode is refused');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '100', date: istDay(-40) }), 'bad_fdate', 'F2 a payment dated before the invoice is refused');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '100', date: istDay(9) }), 'bad_fdate', 'F2 a payment dated in the future is refused');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '100', mode: 'cash' }), 'holder_needed', 'F2 a cash payment says who holds the cash');
await refused(call('finPayInvoice', OT, { id: 'inv~nope', amount: '100' }), 'no_item', 'F2 an unknown invoice is "no_item"');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '100' }, EV2), 'no_item', 'F2 an invoice of another race cannot be paid from here');
const p2 = await call('finPayInvoice', OT, { id: i1.id, amount: '250000', tds: '60000', mode: 'upi', ref: 'UPI-77', key: K() });
vi = (await call('finListInvoices', OT)).invoices.find((x) => x.id === i1.id);
eq([vi.status, vi.received, vi.tds, vi.balance], ['paid', 550000, 60000, 0], 'F2 money plus tax withheld settles the invoice');
await refused(call('finPayInvoice', OT, { id: i1.id, amount: '1' }), 'too_much', 'F2 a paid invoice takes no more');
await refused(call('finCancelInvoice', OT, { id: i1.id, reason: 'wrong party' }), 'has_payments', 'F2 an invoice with payments cannot be cancelled');
await refused(call('finCancelInvoice', OT, { id: i2.id, reason: 'x' }), 'reason_needed', 'F2 cancelling needs a reason');
await refused(call('finVoid', OT, { id: p2.id }), 'reason_needed', 'F2 voiding needs a reason');
await call('finVoid', OT, { id: p2.id, reason: 'entered on the wrong invoice' });
vi = (await call('finListInvoices', OT)).invoices.find((x) => x.id === i1.id);
eq([vi.status, vi.balance, vi.payments.length, vi.payments[1].void, vi.payments[1].voidReason], ['part', 310000, 2, true, 'entered on the wrong invoice'], 'F2 a voided payment stays in the list, struck through, and the invoice is open again');
await refused(call('finVoid', OT, { id: p2.id, reason: 'again' }), 'already_void', 'F2 a payment cannot be voided twice');
await call('finCancelInvoice', OT, { id: i2.id, reason: 'raised by mistake' });
await refused(call('finPayInvoice', OT, { id: i2.id, amount: '100' }), 'invoice_cancelled', 'F2 a cancelled invoice takes no payment');
await refused(call('finCancelInvoice', OT, { id: i2.id, reason: 'again' }), 'already_cancelled', 'F2 an invoice is cancelled once');
const i4 = await call('finRaiseInvoice', OT, { party: 'Gamma', lines: [{ desc: 'Item', qty: 1, rate: '100' }], key: K() });
eq(i4.number, 'INV/' + fyNow + '/0003', 'F2 a cancelled invoice keeps its number: the next one is 0003, nothing is reused');
// payments in parallel never go over the total
const i5 = await call('finRaiseInvoice', OT, { party: 'Parallel Co', lines: [{ desc: 'Item', qty: 1, rate: '5000' }], key: K() });
const par = await Promise.all(Array.from({ length: 10 }, () => err(call('finPayInvoice', OT, { id: i5.id, amount: '1000', key: K() }))));
const parOk = par.filter((x) => x === '').length;
const parNo = par.filter((x) => x === 'too_much').length;
ok(parOk === 5 && parNo === 5, 'F2 ten payments of 1,000 sent at the same moment on a 5,000 invoice: exactly 5 go in, 5 are refused (' + parOk + ' in, ' + parNo + ' too_much, others: ' + par.filter((x) => x && x !== 'too_much').join() + ')');
const i5v = (await call('finListInvoices', OT)).invoices.find((x) => x.id === i5.id);
eq([i5v.status, i5v.received, i5v.balance], ['paid', 5000, 0], 'F2 and the invoice is exactly paid');
// raising in parallel never repeats or skips a number
const before = rows('RDInvoices').length;
const mk = await Promise.all(Array.from({ length: 12 }, (x, n) => err(call('finRaiseInvoice', OT, { party: 'Bulk ' + n, lines: [{ desc: 'Item', qty: 1, rate: '10' }], key: K() }))));
ok(mk.every((x) => x === ''), 'F2 twelve invoices raised at the same moment all succeed' + (mk.some((x) => x) ? ' [' + mk.filter((x) => x).join() + ']' : ''));
const nums = rows('RDInvoices').filter((r) => r.fy === fyNow).map((r) => parseInt(r.seq, 10)).sort((a, b) => a - b);
eq(nums, Array.from({ length: nums.length }, (x, n) => n + 1), 'F2 invoice numbers of the year are 1..' + nums.length + ' with no repeat and no gap');
// the same key sent five times at once makes one invoice
const kk = K();
await Promise.all(Array.from({ length: 5 }, () => err(call('finRaiseInvoice', OT, { party: 'Twice Co', lines: [{ desc: 'Item', qty: 1, rate: '10' }], key: kk }))));
eq(rows('RDInvoices').filter((r) => r.party === 'Twice Co').length, 1, 'F2 the same key sent five times at the same moment makes one invoice');

/* ---------- F3. orders: estimate, advance, actual ---------- */
const o1 = await call('finSaveOrder', OT, { vendor: 'MedalCo', title: 'Finisher medals', cat: 'Finisher items', estimate: '50000', vendorContact: '9000000000', key: K() });
eq(o1.number, 'PO/' + fyNow + '/0001', 'F3 the first order is PO/' + fyNow + '/0001');
let ov = (await call('finListOrders', OT)).orders.find((x) => x.id === o1.id);
eq([ov.status, ov.estimate, ov.paid, ov.balance, ov.actual], ['estimate', 50000, 0, 50000, null], 'F3 a new order has only an estimate');
await refused(call('finPayOrder', OT, { id: o1.id, amount: '50001', phase: 'advance' }), 'too_much', 'F3 an advance over the estimate is refused');
await call('finPayOrder', OT, { id: o1.id, amount: '20000', phase: 'advance', mode: 'upi', ref: 'ADV-1', key: K() });
ov = (await call('finListOrders', OT)).orders.find((x) => x.id === o1.id);
eq([ov.status, ov.advance, ov.paid, ov.balance], ['advance', 20000, 20000, 30000], 'F3 advance paid: 20,000 paid, 30,000 left against the estimate');
await refused(call('finSaveOrder', OT, { id: o1.id, vendor: 'MedalCo', title: 'Finisher medals', estimate: '15000' }), 'estimate_below_paid', 'F3 the estimate cannot be set below what is already paid');
await call('finAddBill', OT, { id: o1.id, amount: '42000', no: 'MC-2210', note: 'final bill', key: K() });
ov = (await call('finListOrders', OT)).orders.find((x) => x.id === o1.id);
eq([ov.status, ov.actual, ov.variance, ov.balance, ov.paid, ov.bills.length], ['billed', 42000, -8000, 22000, 20000, 1], 'F3 actual 42,000 against an estimate of 50,000 (8,000 under), 22,000 still to pay');
await refused(call('finPayOrder', OT, { id: o1.id, amount: '22001' }), 'too_much', 'F3 once billed, payments are capped at the bill');
await call('finPayOrder', OT, { id: o1.id, amount: '22000', phase: 'payment', mode: 'bank', ref: 'NEFT-5', key: K() });
ov = (await call('finListOrders', OT)).orders.find((x) => x.id === o1.id);
eq([ov.status, ov.paid, ov.balance, ov.advance, ov.later], ['settled', 42000, 0, 20000, 22000], 'F3 settled: 20,000 advance plus 22,000 later = the bill');
await refused(call('finPayOrder', OT, { id: o1.id, amount: '1' }), 'too_much', 'F3 a settled order takes nothing more');
await refused(call('finCancelOrder', OT, { id: o1.id, reason: 'x y z' }), 'has_activity', 'F3 an order with bills or payments cannot be cancelled');
// an advance bigger than the bill: refund due from the vendor
const o2 = await call('finSaveOrder', OT, { vendor: 'Banner House', title: 'Banners', cat: 'Marketing and media', estimate: '10000', key: K() });
await call('finPayOrder', OT, { id: o2.id, amount: '10000', phase: 'advance', mode: 'cheque', ref: 'CH 4411', key: K() });
await call('finAddBill', OT, { id: o2.id, amount: '8000', no: 'BH-9', key: K() });
ov = (await call('finListOrders', OT)).orders.find((x) => x.id === o2.id);
eq([ov.status, ov.refundDue, ov.balance], ['refund', 2000, 0], 'F3 advance 10,000 against a bill of 8,000: 2,000 refund due from the vendor');
await refused(call('finRefundOrder', OT, { id: o2.id, amount: '10001' }), 'too_much', 'F3 a refund cannot be more than what was paid');
await call('finRefundOrder', OT, { id: o2.id, amount: '2000', mode: 'bank', ref: 'REF-1', key: K() });
ov = (await call('finListOrders', OT)).orders.find((x) => x.id === o2.id);
eq([ov.status, ov.refundDue, ov.paid, ov.refunded], ['settled', 0, 8000, 2000], 'F3 refund received: settled at 8,000');
// cancelling a fresh order, editing, validation
const o3 = await call('finSaveOrder', OT, { vendor: 'Tent Co', title: 'Tents', cat: 'Logistics', estimate: '5000', key: K() });
await call('finSaveOrder', OT, { id: o3.id, vendor: 'Tent Co', title: 'Tents (6)', cat: 'Logistics', estimate: '6500' });
eq((await call('finListOrders', OT)).orders.find((x) => x.id === o3.id).estimate, 6500, 'F3 an order can be changed while nothing has been paid');
await call('finCancelOrder', OT, { id: o3.id, reason: 'booked elsewhere' });
await refused(call('finPayOrder', OT, { id: o3.id, amount: '10' }), 'order_cancelled', 'F3 a cancelled order takes no payment');
await refused(call('finAddBill', OT, { id: o3.id, amount: '10' }), 'order_cancelled', 'F3 a cancelled order takes no bill');
await refused(call('finSaveOrder', OT, { id: o3.id, vendor: 'Tent Co', title: 'Tents', estimate: '1' }), 'order_cancelled', 'F3 a cancelled order cannot be edited');
for (const [o, code, what] of [[{ vendor: 'A', title: 'Item', estimate: '5' }, 'name_needed', 'a one-letter vendor'], [{ vendor: 'Vendor', title: 'Item', estimate: '0' }, 'bad_money', 'a zero estimate'], [{ vendor: 'Vendor', title: 'Item', estimate: 'lots' }, 'bad_money', 'an estimate in words'], [{ vendor: 'Vendor', title: 'Item', estimate: '5', date: '2026-02-30' }, 'bad_fdate', 'an impossible date']]) {
  const b = rows('RDOrders').length;
  const got = await err(call('finSaveOrder', OT, o));
  ok(got === code && rows('RDOrders').length === b, 'F3 order with ' + what + ' is refused (' + code + ') and nothing is saved');
}
await refused(call('finPayOrder', OT, { id: o1.id, amount: '5', phase: 'gift' }), 'bad_pay_phase', 'F3 an unknown payment kind is refused');
// parallel payments on an order stay within the estimate
const o4 = await call('finSaveOrder', OT, { vendor: 'Parallel Printers', title: 'Bibs', cat: 'Admin', estimate: '3000', key: K() });
const op = await Promise.all(Array.from({ length: 8 }, () => err(call('finPayOrder', OT, { id: o4.id, amount: '1000', phase: 'advance', key: K() }))));
ok(op.filter((x) => x === '').length === 3 && op.filter((x) => x === 'too_much').length === 5, 'F3 eight advances of 1,000 on a 3,000 order sent at the same moment: 3 go in, 5 are refused');

/* ---------- F4. reimbursement claims ---------- */
const cLines = [{ date: TODAY, desc: 'Water cans for aid station 2', cat: 'Aid stations', amount: '4000', bill: 'Bill 77' }, { date: TODAY, desc: 'Auto to the venue', cat: 'Logistics', amount: '2000' }];
const c1 = await call('finSaveClaim', L1, { lines: cLines, payTo: 'lead1@upi', notes: 'Bought on the way', key: K() });
eq(c1.number, 'CLM/' + fyNow + '/0001', 'F4 a lead raises a claim: CLM/' + fyNow + '/0001');
let lc1 = (await call('finListClaims', L1)).claims;
eq([lc1.length, lc1[0].payee, lc1[0].total, lc1[0].status, lc1[0].mine, lc1[0].payTo], [1, 'Lead One', 6000, 'submitted', true, 'lead1@upi'], 'F4 the lead sees it: payee is the lead, total 6,000, submitted');
const c2 = await call('finSaveClaim', L2, { lines: [{ date: TODAY, desc: 'Tape and cones', cat: 'Route and marking', amount: '1500' }], payee: 'Volunteer Ganesh', payTo: 'ganesh@upi', key: K() });
lc1 = (await call('finListClaims', L1)).claims;
eq(lc1.map((c) => c.id), [c1.id], 'F4 a lead sees only their own claims, not the other lead\'s');
eq((await call('finListClaims', L2)).claims.map((c) => [c.payee, c.byName]), [['Volunteer Ganesh', 'Lead Two']], 'F4 a lead can raise a claim for someone else who spent (the payee), and still sees it as theirs');
eq((await call('finListClaims', OT)).claims.length, 2, 'F4 a director sees every claim');
await refused(call('finSaveClaim', L1, { id: c2.id, lines: cLines }), 'no_item', 'F4 a lead cannot edit another lead\'s claim');
await refused(call('finCancelClaim', L1, { id: c2.id }), 'no_item', 'F4 a lead cannot cancel another lead\'s claim');
await refused(call('finDecideClaim', L1, { id: c1.id, decision: 'approve' }), 'director_only', 'F4 a lead cannot approve (not even their own)');
await refused(call('finPayClaim', L1, { id: c1.id, amount: '1' }), 'director_only', 'F4 a lead cannot pay');
await call('finSaveClaim', L1, { id: c1.id, lines: cLines.concat([{ date: TODAY, desc: 'Ice for the finish line', cat: 'Finisher items', amount: '500' }]), payTo: 'lead1@upi' });
eq((await call('finListClaims', L1)).claims[0].total, 6500, 'F4 a lead can edit their claim while it is waiting (now 6,500)');
await call('finSaveClaim', L1, { id: c1.id, lines: cLines, payTo: 'lead1@upi', notes: 'Bought on the way' });
for (const [o, code, what] of [[{ lines: [] }, 'bad_lines', 'no lines'], [{ lines: [{ date: istDay(10), desc: 'Future spend', amount: '5' }] }, 'bad_fdate', 'a spend dated in the future'], [{ lines: [{ date: TODAY, desc: 'Item', amount: '-5' }] }, 'bad_lines', 'a negative amount'], [{ payee: 'X', lines: cLines }, 'name_needed', 'a one-letter payee']]) {
  const b = rows('RDClaims').length;
  const got = await err(call('finSaveClaim', L1, o));
  ok(got === code && rows('RDClaims').length === b, 'F4 claim with ' + what + ' is refused (' + code + ') and nothing is saved');
}
await refused(call('finPayClaim', OT, { id: c1.id, amount: '100' }), 'claim_not_approved', 'F4 a claim that is not approved cannot be paid');
await refused(call('finDecideClaim', OT, { id: c1.id, decision: 'maybe' }), 'bad_decision', 'F4 a decision is approve or reject');
await refused(call('finDecideClaim', OT, { id: c1.id, decision: 'reject' }), 'reason_needed', 'F4 rejecting needs a reason');
await refused(call('finDecideClaim', OT, { id: c1.id, decision: 'approve', approved: '6001' }), 'bad_money', 'F4 approving more than claimed is refused');
await call('finDecideClaim', OT, { id: c1.id, decision: 'approve', approved: '4500', note: 'ice not allowed' });
lc1 = (await call('finListClaims', L1)).claims[0];
eq([lc1.status, lc1.approved, lc1.balance, lc1.decidedBy, lc1.selfApproved, lc1.approvedWords], ['approved', 4500, 4500, 'owner', false, 'Rupees Four Thousand Five Hundred Only'], 'F4 approved at 4,500 of 6,000, and the lead sees the decision');
await refused(call('finSaveClaim', L1, { id: c1.id, lines: cLines }), 'not_editable', 'F4 a decided claim can no longer be edited');
await refused(call('finCancelClaim', L1, { id: c1.id }), 'not_editable', 'F4 a lead cannot withdraw a claim after it is decided');
await call('finPayClaim', OT, { id: c1.id, amount: '2000', mode: 'upi', ref: 'UPI-9', key: K() });
lc1 = (await call('finListClaims', L1)).claims[0];
eq([lc1.status, lc1.paid, lc1.balance, lc1.payments.length], ['part', 2000, 2500, 1], 'F4 part paid: the lead sees 2,000 paid and 2,500 to come');
await refused(call('finPayClaim', OT, { id: c1.id, amount: '2501' }), 'too_much', 'F4 more than the approved balance is refused');
await refused(call('finDecideClaim', OT, { id: c1.id, decision: 'approve', approved: '1000' }), 'below_paid', 'F4 the approval cannot be cut below what is already paid');
await refused(call('finDecideClaim', OT, { id: c1.id, decision: 'reject', note: 'changed my mind' }), 'has_payments', 'F4 a claim with payments cannot be rejected');
await refused(call('finCancelClaim', OT, { id: c1.id }), 'has_payments', 'F4 a claim with payments cannot be cancelled');
const cp = await call('finPayClaim', OT, { id: c1.id, mode: 'bank', ref: 'NEFT-12', key: K() });
lc1 = (await call('finListClaims', L1)).claims[0];
eq([lc1.status, lc1.paid, lc1.balance], ['paid', 4500, 0], 'F4 no amount given: the whole balance is paid; the claim is paid');
await refused(call('finPayClaim', OT, { id: c1.id, mode: 'bank' }), 'already_paid', 'F4 a paid claim is not paid twice');
// withdrawing, rejecting, a director's own claim
await call('finCancelClaim', L2, { id: c2.id });
eq((await call('finListClaims', L2)).claims[0].status, 'cancelled', 'F4 a lead can withdraw their own claim while it is waiting');
await refused(call('finCancelClaim', L2, { id: c2.id }), 'already_cancelled', 'F4 and only once');
const c3 = await call('finSaveClaim', OT, { lines: [{ date: TODAY, desc: 'Fuel for the recce', cat: 'Logistics', amount: '3000' }], payee: 'Owner', key: K() });
await call('finDecideClaim', OT, { id: c3.id, decision: 'approve' });
const c3v = (await call('finListClaims', OT)).claims.find((c) => c.id === c3.id);
eq([c3v.status, c3v.approved, c3v.selfApproved, c3v.by], ['approved', 3000, true, 'owner'], 'F4 a director\'s own claim can be approved but is flagged "approved by the claimant"');
const c4 = await call('finSaveClaim', L1, { lines: [{ date: TODAY, desc: 'Printouts', cat: 'Admin', amount: '300' }], key: K() });
await call('finDecideClaim', DT, { id: c4.id, decision: 'reject', note: 'No bill attached' });
const c4v = (await call('finListClaims', L1)).claims.find((c) => c.id === c4.id);
eq([c4v.status, c4v.decisionNote, c4v.approved], ['rejected', 'No bill attached', 0], 'F4 a rejected claim shows the reason to the lead');
await refused(call('finPayClaim', OT, { id: c4.id, amount: '1' }), 'claim_not_approved', 'F4 a rejected claim cannot be paid');
const c5 = await call('finSaveClaim', L1, { lines: [{ date: TODAY, desc: 'Parking', cat: 'Logistics', amount: '100' }], key: K() });
await call('finDecideClaim', OT, { id: c5.id, decision: 'approve' });
await call('finCancelClaim', OT, { id: c5.id });
eq((await call('finListClaims', OT)).claims.find((c) => c.id === c5.id).status, 'cancelled', 'F4 a director can cancel an approved claim that is not yet paid');
// the lead never sees payments of other people's claims through their own list
const leadPays = JSON.stringify((await call('finListClaims', L1)).claims);
ok(!leadPays.includes('Fuel for the recce') && !leadPays.includes('Tape and cones'), 'F4 the lead\'s list holds nothing of the director\'s or the other lead\'s claims');
// double pay with the same key
const c6 = await call('finSaveClaim', L1, { lines: [{ date: TODAY, desc: 'Snacks for volunteers', cat: 'Volunteers', amount: '1000' }], key: K() });
await call('finDecideClaim', OT, { id: c6.id, decision: 'approve' });
const pk = K();
const dbl = await Promise.all([err(call('finPayClaim', OT, { id: c6.id, mode: 'upi', key: pk })), err(call('finPayClaim', OT, { id: c6.id, mode: 'upi', key: pk })), err(call('finPayClaim', OT, { id: c6.id, mode: 'upi', key: pk }))]);
eq(rows('RDLedger').filter((r) => r.sourceId === c6.id).length, 1, 'F4 a payment sent three times with one key is made once (' + dbl.map((x) => x || 'ok').join(', ') + ')');
const c7 = await call('finSaveClaim', L1, { lines: [{ date: TODAY, desc: 'Banner ties', cat: 'Marketing and media', amount: '1000' }], key: K() });
await call('finDecideClaim', OT, { id: c7.id, decision: 'approve' });
const pc = await Promise.all(Array.from({ length: 4 }, () => err(call('finPayClaim', OT, { id: c7.id, mode: 'upi', key: K() }))));
eq(rows('RDLedger').filter((r) => r.sourceId === c7.id && r.void !== 'yes').length, 1, 'F4 four different payment requests for one 1,000 claim at the same moment: exactly one is paid (' + pc.map((x) => x || 'ok').join(', ') + ')');

/* ---------- F5. cash ---------- */
const w1 = await call('finAddCash', OT, { type: 'withdrawal', amount: '10000', holder: 'Ravi', ref: 'ATM-1', note: 'for expo', key: K() });
let cash = (await call('finCash', OT)).cash;
eq([cash.withdrawn, cash.inHand, cash.holders[0].holder, cash.holders[0].inHand], [10000, 10000, 'Ravi', 10000], 'F5 withdrawal: Ravi holds 10,000');
await refused(call('finAddCash', OT, { type: 'withdrawal', amount: '500', holder: 'R' }), 'holder_needed', 'F5 a withdrawal names who holds the cash');
await refused(call('finAddCash', OT, { type: 'borrow', amount: '500', holder: 'Ravi' }), 'bad_type', 'F5 a cash movement is a withdrawal or a deposit');
await refused(call('finAddCash', OT, { type: 'withdrawal', amount: '0', holder: 'Ravi' }), 'bad_money', 'F5 a withdrawal of nothing is refused');
await call('finPayClaim', OT, { id: c3.id, mode: 'cash', holder: 'ravi', ref: 'cash voucher 1', key: K() });
cash = (await call('finCash', OT)).cash;
eq([cash.holders.length, cash.holders[0].spent, cash.holders[0].inHand], [1, 3000, 7000], 'F5 a claim paid in cash comes out of Ravi\'s cash (holder matched without regard to capitals): 7,000 left');
const nBefore = log();
await refused(call('finAddEntry', OT, { type: 'expense', amount: '8000', party: 'Tent hire', cat: 'Logistics', mode: 'cash', holder: 'Ravi', key: K() }), 'not_enough_cash', 'F5 spending more cash than the holder has is refused');
eq(log(), nBefore, 'F5 and nothing is left in the ledger by the refused payment');
const c8 = await call('finSaveClaim', L1, { lines: [{ date: TODAY, desc: 'Sweets for the finish line', cat: 'Volunteers', amount: '500' }], key: K() });
await call('finDecideClaim', OT, { id: c8.id, decision: 'approve' });
await refused(call('finPayClaim', OT, { id: c8.id, mode: 'cash', holder: 'Nobody' }), 'not_enough_cash', 'F5 a holder who never took cash out has none to pay from');
eq((await call('finListClaims', OT)).claims.find((c) => c.id === c8.id).paid, 0, 'F5 and the refused cash payment left the claim unpaid');
await refused(call('finAddCash', OT, { type: 'deposit', amount: '8000', holder: 'Ravi' }), 'not_enough_cash', 'F5 putting back more than is held is refused');
await call('finAddCash', OT, { type: 'deposit', amount: '2000', holder: 'Ravi', ref: 'CDM-5', key: K() });
cash = (await call('finCash', OT)).cash;
eq([cash.deposited, cash.holders[0].inHand], [2000, 5000], 'F5 2,000 put back: 5,000 in hand');
await refused(call('finVoid', OT, { id: w1.id, reason: 'entered twice' }), 'cash_already_spent', 'F5 a withdrawal that has been spent from cannot be voided');
const manual = await call('finAddEntry', OT, { type: 'expense', amount: '1200', party: 'Tea stall', cat: 'Volunteers', mode: 'cash', holder: 'Ravi', note: 'tea for crew', key: K() });
eq((await call('finCash', OT)).cash.holders[0].inHand, 3800, 'F5 a small direct cash expense: 3,800 left');
await call('finVoid', OT, { id: manual.id, reason: 'paid by someone else' });
eq((await call('finCash', OT)).cash.holders[0].inHand, 5000, 'F5 voiding it gives the cash back to the holder: 5,000');
const sw = await call('finAddCash', OT, { type: 'withdrawal', amount: '3000', holder: 'Sita', key: K() });
const cs = await Promise.all(Array.from({ length: 6 }, (x, n) => err(call('finAddEntry', OT, { type: 'expense', amount: '1000', party: 'Vendor ' + n, cat: 'Admin', mode: 'cash', holder: 'Sita', key: K() }))));
const sitaNow = (await call('finCash', OT)).cash.holders.find((h) => h.holder === 'Sita');
ok(sitaNow.inHand >= 0 && sitaNow.spent <= 3000, 'F5 six cash expenses of 1,000 at the same moment from 3,000 never take Sita below zero (in hand ' + sitaNow.inHand + '; refused: ' + cs.filter((x) => x === 'not_enough_cash').length + ')');
const later = await err(call('finAddEntry', OT, { type: 'expense', amount: '500', party: 'After the storm', cat: 'Admin', mode: 'cash', holder: 'Sita', key: K() }));
ok(later === '' || later === 'not_enough_cash', 'F5 and cash payments work normally again afterwards');
await refused(call('finVoid', OT, { id: sw.id, reason: 'mistake' }), 'cash_already_spent', 'F5 Sita\'s withdrawal cannot be voided if that would leave her below zero');
// two withdrawals of one person, each safe to void alone, voided at the same moment by two directors
const tw1 = await call('finAddCash', OT, { type: 'withdrawal', amount: '1000', holder: 'Tara', key: K() });
const tw2 = await call('finAddCash', OT, { type: 'withdrawal', amount: '1000', holder: 'Tara', key: K() });
await call('finAddEntry', OT, { type: 'expense', amount: '1000', party: 'Tara spends', cat: 'Admin', mode: 'cash', holder: 'Tara', key: K() });
const tv = await Promise.all([err(call('finVoid', OT, { id: tw1.id, reason: 'void one' })), err(call('finVoid', DT, { id: tw2.id, reason: 'void two' }))]);
const tara = (await call('finCash', OT)).cash.holders.find((h) => h.holder === 'Tara');
ok(tara.inHand >= 0, 'F5 two withdrawals of the same person voided at the same moment never leave them below zero (in hand ' + tara.inHand + '; answers: ' + tv.map((x) => x || 'done').join(', ') + ')');
ok(tv.filter((x) => x === '').length <= 1 && tv.every((x) => x === '' || x === 'cash_already_spent'), 'F5 at most one of the two goes through, the other is told the cash is already spent');
await call('finAddEntry', OT, { type: 'income', amount: '700', party: 'Stall rent in cash', cat: 'Other income', mode: 'cash', holder: 'Ravi', key: K() });
eq((await call('finCash', OT)).cash.holders.find((h) => h.holder === 'Ravi').inHand, 5700, 'F5 cash received adds to what the holder holds');
const ce = (await call('finCash', OT)).entries;
ok(ce.length >= 5 && ce.every((e) => e.type === 'withdrawal' || e.type === 'deposit' || e.mode === 'cash'), 'F5 the cash list holds only cash movements and cash payments');

/* ---------- F6. the ledger and direct entries ---------- */
const e1 = await call('finAddEntry', OT, { type: 'income', amount: '3000', party: 'Anonymous donor', cat: 'Donation', mode: 'upi', ref: 'UPI-D1', key: K() });
const e2 = await call('finAddEntry', OT, { type: 'expense', amount: '450', party: 'Bank charges', cat: 'Admin', mode: 'bank', key: K() });
for (const [o, code, what] of [[{ type: 'transfer', amount: '5', party: 'Xx' }, 'bad_type', 'an unknown type'], [{ type: 'expense', amount: '5', party: 'X' }, 'name_needed', 'a one-letter name'], [{ type: 'expense', amount: '-5', party: 'Xx' }, 'bad_money', 'a negative amount'], [{ type: 'expense', amount: '5', party: 'Xx', mode: 'cash' }, 'holder_needed', 'cash with no holder']]) {
  const b = log();
  const got = await err(call('finAddEntry', OT, o));
  ok(got === code && log() === b, 'F6 entry with ' + what + ' is refused (' + code + ') and nothing is saved');
}
const led = await call('finLedger', OT);
ok(led.rows.length === rows('RDLedger').filter((r) => r.event === EV).length && led.rows.some((r) => r.id === e1.id) && !led.truncated, 'F6 the ledger lists every row of the race (' + led.rows.length + ')');
ok(led.rows.find((r) => r.id === p2.id).void === true && led.rows.find((r) => r.id === p2.id).sourceNo === i1.number, 'F6 voided rows stay in the ledger, and a row says which document it belongs to');
await refused(call('finVoid', OT, { id: 'nope', reason: 'abc' }), 'no_item', 'F6 voiding an unknown row is "no_item"');
await refused(call('finVoid', OT, { id: e1.id, reason: 'abc' }, EV2), 'no_item', 'F6 a row of another race cannot be voided from here');
for (const t of ['RDInvoices', 'RDOrders', 'RDClaims', 'RDLedger']) {
  const gone = await err(wd.get(t, 'x'));
  ok(gone === '', 'F6 (reading ' + t + ' works)');
}
const ledBefore = rows('RDLedger').length;
await call('finVoid', OT, { id: e2.id, reason: 'bank reversed the charge' });
eq([rows('RDLedger').length, rows('RDLedger').find((r) => r._id === e2.id).amount], [ledBefore, '45000'], 'F6 voiding keeps the row and its amount (nothing is deleted or changed)');

/* ---------- F7. the summary against an independent recount ---------- */
await R.saveCats({ token: OT, ev: EV, cats: [{ name: '21.1 km Half Marathon', km: 21.1, price: 1200, cap: 500 }, { name: '10K Run', km: 10, price: 800, cap: 500 }] });
for (let n = 0; n < 7; n++) await wd.insert('RDRegs', { event: EV, name: 'Runner ' + n, cat: n < 4 ? '21.1 km Half Marathon' : '10K Run', status: 'ok', at: new Date().toISOString() }, SA);
await wd.insert('RDRegs', { event: EV, name: 'Unpaid One', cat: '10K Run', status: 'pending', at: new Date().toISOString() }, SA);
await wd.insert('RDPlan', { event: EV, kind: 'budget', title: 'Medals', cat: 'Finisher items', phase: 'expense', status: 'planned', amount: '45000', amount2: '' }, SA);
await wd.insert('RDPlan', { event: EV, kind: 'budget', title: 'Aid', cat: 'Aid stations', phase: 'expense', status: 'planned', amount: '10000', amount2: '' }, SA);
await wd.insert('RDPlan', { event: EV, kind: 'budget', title: 'Sponsors', cat: 'Income', phase: 'income', status: 'planned', amount: '600000', amount2: '' }, SA);
const sm = (await call('finOverview', OT)).summary;
// independent recount straight from the stored rows (not using the library)
const LE = rows('RDLedger').filter((r) => r.event === EV && r.void !== 'yes');
const sumP = (a, f) => a.reduce((s, r) => s + parseInt(f(r), 10), 0);
const invRows = rows('RDInvoices').filter((r) => r.event === EV && r.status !== 'cancelled');
const incInv = sumP(LE.filter((r) => r.type === 'income' && r.source === 'invoice'), (r) => r.amount);
const incOther = sumP(LE.filter((r) => r.type === 'income' && r.source === 'manual'), (r) => r.amount);
const expAll = sumP(LE.filter((r) => r.type === 'expense'), (r) => r.amount);
const refunds = sumP(LE.filter((r) => r.type === 'income' && r.phase === 'refund'), (r) => r.amount);
const regsRev = 4 * 120000 + 3 * 80000;
eq(sm.income.registrations, { paid: 7, unpaid: 1, revenue: regsRev / 100, pending: 800 }, 'F7 ticket takings: 4 x 1,200 + 3 x 800 paid, one 800 ticket pending');
eq([sm.income.received, sm.income.other, sm.income.invoiced], [rupee(incInv), rupee(incOther), rupee(sumP(invRows, (r) => r.total))], 'F7 invoice money received, other income and invoiced total match the stored rows');
eq(sm.income.total, rupee(regsRev + incInv + incOther), 'F7 total income = tickets + invoice money + other income');
eq(sm.expenses.paid, rupee(expAll - refunds), 'F7 money paid out = all payments less vendor refunds');
eq(sm.result.net, sm.income.total - sm.expenses.paid, 'F7 net so far = income - paid out');
const cashHold = sumP(LE.filter((r) => r.type === 'withdrawal'), (r) => r.amount) + sumP(LE.filter((r) => r.mode === 'cash' && r.type === 'income'), (r) => r.amount) - sumP(LE.filter((r) => r.type === 'deposit'), (r) => r.amount) - sumP(LE.filter((r) => r.mode === 'cash' && r.type === 'expense'), (r) => r.amount);
eq(sm.cash.inHand, rupee(cashHold), 'F7 cash in hand = withdrawn + cash received - put back - cash spent');
ok(sm.cash.holders.every((h) => h.inHand >= 0), 'F7 nobody holds negative cash');
const byc = (n) => sm.byCat.find((c) => c.cat === n);
eq([byc('Finisher items').budget, byc('Finisher items').estimate, byc('Finisher items').actual], [45000, 50000, 42000], 'F7 Finisher items: budget 45,000, estimate 50,000, actual 42,000 (the bill)');
eq(byc('Aid stations').actual, 3000, 'F7 Aid stations: the 4,500 approved of 6,000 is spread in proportion (3,000 here, 1,500 on Logistics)');
eq(byc('Marketing and media').actual, 8000 + 1000, 'F7 Marketing and media: the banner bill (8,000) plus an approved claim (1,000)');
eq(sm.byCat.reduce((s, c) => s + c.actual, 0), sm.expenses.cost, 'F7 the categories add up to the total cost');
eq([sm.budget.cost, sm.budget.income], [55000, 600000], 'F7 budget totals come from the plan');
eq([sm.orders.count, sm.orders.billed, sm.orders.refundDue], [3, 50000, 0], 'F7 orders: three live orders (the cancelled one is left out), billed 50,000');
const openPast = rows('RDInvoices').filter((r) => r.event === EV && r.status !== 'cancelled' && r.due < TODAY && !['paid'].includes(r.status)).filter((r) => {
  const got = rows('RDLedger').filter((l) => l.sourceId === r._id && l.void !== 'yes').reduce((a, l) => a + parseInt(l.amount, 10) + parseInt(l.tds || '0', 10), 0);
  return got < parseInt(r.total, 10);
}).length;
ok(sm.income.invoices.count >= 5 && sm.income.invoices.count === invRows.length && sm.income.invoices.overdueCount === openPast, 'F7 invoices counted without the cancelled one (' + sm.income.invoices.count + '); overdue = open invoices past their due date (' + openPast + ')');
// the director's registration takings agree with the dashboard
const dash = await R.dashboard({ token: OT, ev: EV });
eq(sm.income.registrations.revenue, dash.revenue, 'F7 ticket takings equal the RaceOS dashboard revenue (' + dash.revenue + ')');
// another race is separate
const sm2 = (await call('finOverview', OT, {}, EV2)).summary;
eq([sm2.income.total, sm2.expenses.paid, sm2.orders.count, sm2.cash.holders.length], [0, 0, 0, 0], 'F7 a second race starts empty: nothing from the first leaks in');
eq((await call('finListInvoices', OT, {}, EV2)).invoices.length + (await call('finListOrders', OT, {}, EV2)).orders.length + (await call('finListClaims', OT, {}, EV2)).claims.length + (await call('finLedger', OT, {}, EV2)).rows.length, 0, 'F7 the second race has no invoices, orders, claims or ledger rows');
await refused(call('finOverview', OT, {}, 'no-such-race'), 'no_event', 'F7 an unknown race is "no_event"');
await refused(F.finOverview({ token: OT }), 'no_event', 'F7 no race given is "no_event"');

/* ---------- F8. who may use Finance ---------- */
for (const [who, t, wantRead, wantClaim] of [['a viewer', tok['view.one'], 'not_allowed', 'not_allowed'], ['a coach', tok['coach.one'], 'not_allowed', 'not_allowed'], ['a lead', L1, 'director_only', null], ['a director', DT, null, null]]) {
  eq(await err(call('finOverview', t)), wantRead || '', 'F8 ' + who + ' opening the summary -> ' + (wantRead || 'allowed'));
  eq(await err(call('finListClaims', t)), wantClaim || '', 'F8 ' + who + ' opening claims -> ' + (wantClaim || 'allowed'));
}
eq(await err(F.finOverview({})), 'not_logged_in', 'F8 no login: refused');
eq(await err(F.finListClaims({ token: 'x'.repeat(64), ev: EV })), 'not_logged_in', 'F8 a made-up token: refused');
await R.signOutTeam({ token: OT, username: 'lead.one' });
eq(await err(call('finListClaims', L1)), 'not_logged_in', 'F8 a lead who is signed out loses Finance at once');
tok['lead.one'] = (await R.login({ username: 'lead.one', password: (await R.resetTeamSecret({ token: OT, username: 'lead.one' })).secret })).token;
L1 = tok['lead.one'];
eq(await err(call('finListClaims', L1)), '', 'F8 and can use claims again after logging in');
await R.saveTeam({ token: OT, edit: true, username: 'lead.two', role: 'viewer', name: 'Lead Two' });
eq(await err(call('finListClaims', L2)), 'not_logged_in', 'F8 a lead whose role is changed is signed out at once');
const l2pass = (await R.resetTeamSecret({ token: OT, username: 'lead.two' })).secret;
const l2new = (await R.login({ username: 'lead.two', password: l2pass })).token;
eq(await err(call('finListClaims', l2new)), 'not_allowed', 'F8 and as a viewer has no claims');
eq(await err(call('finSaveClaim', l2new, { lines: cLines })), 'not_allowed', 'F8 or any way to raise one');

/* ---------- F9. the audit trail ---------- */
const au = rows('RDAudit');
const acts = new Set(au.map((r) => r.action));
for (const a of ['invoice raised', 'payment received', 'invoice cancelled', 'order raised', 'bill added', 'order payment', 'refund received', 'claim raised', 'claim approved', 'claim rejected', 'claim paid', 'claim cancelled', 'cash withdrawn', 'cash put back', 'expense entered', 'income entered', 'entry voided', 'finance details saved']) ok(acts.has(a), 'F9 the audit log has "' + a + '"');
ok(au.filter((r) => r.action === 'entry voided').every((r) => r.by === 'owner' && /\S/.test(r.detail)), 'F9 every void records who did it and why');
ok(au.filter((r) => r.action === 'claim raised').some((r) => r.by === 'lead.one'), 'F9 a lead\'s claim is logged under the lead\'s name');
ok(!JSON.stringify(au).includes(OT) && !JSON.stringify(au).includes(L1), 'F9 the audit log never holds a session token');

/* ---------- F10. rows that were edited by hand ---------- */
await wd.insert('RDLedger', { _id: 'junk1', event: EV, type: 'weird', amount: '-99', tds: 'x', mode: 'bitcoin', date: 'soon', source: 'invoice', sourceId: 'inv~000', holder: { a: 1 }, at: 5 }, SA);
await wd.insert('RDInvoices', { _id: 'junk-inv', event: EV, fy: fyNow, number: 5, kind: {}, party: null, lines: '{{{', org: 'nope', total: '-5', status: 'who knows' }, SA);
await wd.insert('RDOrders', { _id: 'junk-ord', event: EV, fy: fyNow, estimate: 'abc', status: 7 }, SA);
await wd.insert('RDClaims', { _id: 'junk-clm', event: EV, fy: fyNow, lines: 'x', total: 'y', by: 'lead.one', status: 'what' }, SA);
for (const [fn, who] of [['finOverview', OT], ['finListInvoices', OT], ['finListOrders', OT], ['finListClaims', OT], ['finListClaims', L1], ['finCash', OT], ['finLedger', OT]]) {
  const got = await err(call(fn, who));
  ok(got === '', 'F10 ' + fn + ' still answers with hand-edited rows in the database' + (got ? ' [' + got + ']' : ''));
}
for (const t of ['RDLedger', 'RDInvoices', 'RDOrders', 'RDClaims']) await wd.bulkRemove(t, ['junk1', 'junk-inv', 'junk-ord', 'junk-clm'], SA);

/* ---------- F11. random operations, then the books are checked ---------- */
let seed = 20261027;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];
const amt = () => String(1 + Math.floor(rand() * 3000)) + (rand() < 0.3 ? '.' + String(Math.floor(rand() * 100)).padStart(2, '0') : '');
const EVF = (await R.saveEvent({ token: OT, name: 'Fuzz race', date: istDay(20), venue: 'Anywhere' })).event.id;
const fz = (fn, o) => err(F[fn](Object.assign({ token: OT, ev: EVF, key: K() }, o)));
const holders = ['Ravi', 'Sita', 'Mohan'];
const ids = { inv: [], ord: [], clm: [], led: [] };
const ALLOWED_FUZZ = new Set(['', 'too_much', 'not_enough_cash', 'already_paid', 'has_payments', 'has_activity', 'below_paid', 'cash_already_spent', 'already_void', 'claim_not_approved', 'not_open', 'already_cancelled', 'invoice_cancelled', 'order_cancelled', 'estimate_below_paid', 'not_editable', 'bad_money']);
let fuzzBad = [];
let fuzzOk = 0;
const holdersOk = () => {
  const L = rows('RDLedger').filter((r) => r.event === EVF && r.void !== 'yes');
  for (const h of holders) {
    const hh = h.toLowerCase();
    const bal = L.filter((r) => String(r.holder).toLowerCase() === hh).reduce((s, r) => s + (r.type === 'withdrawal' ? 1 : r.type === 'income' && r.mode === 'cash' ? 1 : r.type === 'deposit' || (r.type === 'expense' && r.mode === 'cash') ? -1 : 0) * parseInt(r.amount, 10), 0);
    if (bal < 0) return false;
  }
  return true;
};
for (let step = 0; step < 220; step++) {
  const r = rand();
  let got = '';
  if (r < 0.1) {
    const o = await F.finRaiseInvoice({ token: OT, ev: EVF, key: K(), party: 'Fuzz Co ' + step, lines: [{ desc: 'Item ' + step, qty: 1 + Math.floor(rand() * 3), rate: amt(), taxPct: pick([0, 5, 18]) }] }).catch((e) => ({ error: e.message }));
    if (o.id) ids.inv.push(o.id);
    got = o.error || '';
  } else if (r < 0.2) {
    const o = await F.finSaveOrder({ token: OT, ev: EVF, key: K(), vendor: 'Vendor ' + step, title: 'Order ' + step, cat: pick(['Admin', 'Logistics', 'Awards']), estimate: amt() }).catch((e) => ({ error: e.message }));
    if (o.id) ids.ord.push(o.id);
    got = o.error || '';
  } else if (r < 0.3) {
    const o = await F.finSaveClaim({ token: pick([OT, L1]), ev: EVF, key: K(), lines: [{ date: TODAY, desc: 'Spend ' + step, cat: pick(['Admin', 'Logistics']), amount: amt() }, { date: TODAY, desc: 'Other spend', cat: 'Awards', amount: amt() }] }).catch((e) => ({ error: e.message }));
    if (o.id) ids.clm.push(o.id);
    got = o.error || '';
  } else if (r < 0.4 && ids.inv.length) got = await fz('finPayInvoice', { id: pick(ids.inv), amount: amt(), tds: rand() < 0.3 ? amt() : undefined, mode: pick(['bank', 'upi', 'cash']), holder: pick(holders) });
  else if (r < 0.5 && ids.ord.length) got = await fz(pick(['finPayOrder', 'finPayOrder', 'finAddBill', 'finRefundOrder']), { id: pick(ids.ord), amount: amt(), phase: pick(['advance', 'payment']), mode: pick(['bank', 'cash']), holder: pick(holders) });
  else if (r < 0.56 && ids.clm.length) got = await fz('finDecideClaim', { id: pick(ids.clm), decision: pick(['approve', 'approve', 'reject']), approved: rand() < 0.5 ? amt() : undefined, note: 'because' });
  else if (r < 0.64 && ids.clm.length) got = await fz('finPayClaim', { id: pick(ids.clm), amount: rand() < 0.5 ? amt() : undefined, mode: pick(['bank', 'cash']), holder: pick(holders) });
  else if (r < 0.7) got = await fz('finAddCash', { type: pick(['withdrawal', 'withdrawal', 'deposit']), amount: amt(), holder: pick(holders) });
  else if (r < 0.78) got = await fz('finAddEntry', { type: pick(['income', 'expense']), amount: amt(), party: 'Someone', cat: 'Admin', mode: pick(['bank', 'cash', 'upi']), holder: pick(holders) });
  else if (r < 0.85) {
    const live = rows('RDLedger').filter((x) => x.event === EVF && x.void !== 'yes');
    if (live.length) got = await fz('finVoid', { id: pick(live)._id, reason: 'fuzz void' });
  } else if (r < 0.9 && ids.inv.length) got = await fz('finCancelInvoice', { id: pick(ids.inv), reason: 'fuzz cancel' });
  else if (r < 0.94 && ids.ord.length) got = await fz('finCancelOrder', { id: pick(ids.ord), reason: 'fuzz cancel' });
  else if (ids.clm.length) got = await fz('finCancelClaim', { id: pick(ids.clm) });
  if (!ALLOWED_FUZZ.has(got)) fuzzBad.push(step + ':' + got);
  // after every step: the rules that must always hold
  const invOk = rows('RDInvoices').filter((x) => x.event === EVF).every((iv) => {
    const paidSum = rows('RDLedger').filter((l) => l.sourceId === iv._id && l.void !== 'yes' && l.type === 'income').reduce((s, l) => s + parseInt(l.amount, 10) + parseInt(l.tds || '0', 10), 0);
    return paidSum <= parseInt(iv.total, 10);
  });
  const clmOk = rows('RDClaims').filter((x) => x.event === EVF).every((c) => {
    const paidSum = rows('RDLedger').filter((l) => l.sourceId === c._id && l.void !== 'yes' && l.type === 'expense').reduce((t, l) => t + parseInt(l.amount, 10), 0);
    return c.status === 'approved' ? paidSum <= parseInt(c.approved, 10) : paidSum === 0;
  });
  if (got === '') fuzzOk++;
  if (!invOk || !clmOk || !holdersOk()) {
    fuzzBad.push('step ' + step + ': ' + (!invOk ? 'an invoice is overpaid ' : '') + (!clmOk ? 'a claim is paid beyond its approval, or paid while not approved ' : '') + (!holdersOk() ? 'a holder has negative cash' : ''));
    break;
  }
}
ok(!fuzzBad.length, 'F11 220 random operations (raise, pay, bill, refund, approve, reject, cancel, withdraw, deposit, void; many of them invalid): every answer is a plain code' + (fuzzBad.length ? ' [' + fuzzBad.slice(0, 5).join('; ') + ']' : ''));
ok(fuzzOk >= 70, 'F11 the random run really did things: ' + fuzzOk + ' of 220 operations went through, the rest were refused');
ok(holdersOk(), 'F11 after all of it nobody holds negative cash');
const fzNums = [...rows('RDInvoices'), ...rows('RDOrders'), ...rows('RDClaims')].filter((r) => r.event === EVF).map((r) => r.number);
eq(fzNums.length, new Set(fzNums).size, 'F11 every document number is unique (' + fzNums.length + ' documents)');
const smf = (await F.finOverview({ token: OT, ev: EVF })).summary;
const LF = rows('RDLedger').filter((r) => r.event === EVF && r.void !== 'yes');
const sP = (a) => a.reduce((s, r) => s + parseInt(r.amount, 10), 0);
eq(smf.expenses.paid, rupee(sP(LF.filter((r) => r.type === 'expense')) - sP(LF.filter((r) => r.type === 'income' && r.phase === 'refund'))), 'F11 the summary\'s "paid out" equals the recount of the stored rows after the random run');
ok(smf.cash.holders.every((h) => h.inHand >= 0) && Math.abs(smf.cash.inHand - rupee(sP(LF.filter((r) => r.type === 'withdrawal')) + sP(LF.filter((r) => r.type === 'income' && r.mode === 'cash')) - sP(LF.filter((r) => r.type === 'deposit')) - sP(LF.filter((r) => r.type === 'expense' && r.mode === 'cash')))) < 0.001, 'F11 and so does cash in hand');
ok(smf.byCat.reduce((s, c) => s + c.actual, 0) === smf.expenses.cost, 'F11 and the categories still add up to the cost');

done();
