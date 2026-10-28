// backend/rd-finance.js
// The rules and the sums behind RaceOS Finance. No database and no Wix in here, so every rule can be tested on its own.
//
// Amounts inside are WHOLE PAISE (integers), so a sum is always exact. The backend hands rupees to the screens.
// Everything Finance records is append-only: a payment that was entered by mistake is voided (kept, struck through,
// with who and why), never edited or deleted, so the books can always be explained.

export const MAX_PAISE = 99999999999; // about 100 crore rupees: far more than any race needs, far below where numbers go inexact
export const MODES = ['bank', 'upi', 'cash', 'cheque', 'card', 'other'];
export const LEDGER_TYPES = ['income', 'expense', 'withdrawal', 'deposit', 'bill'];
export const INVOICE_KINDS = ['sponsor', 'partner', 'other'];
export const DEFAULT_ORG = { name: 'Visakha Trail Running Association', address: '', pan: '', gstin: '', bank: '', upi: '', terms: 'Payment is due by the due date. Please quote the invoice number with your payment.', signatory: '', invPrefix: 'INV' };

/* ---------- small helpers ---------- */
// Text typed by a person: control characters (including the line and paragraph separators) and the characters that flip the
// direction of text (they can make one name look like another on a printed invoice) are replaced by a space or dropped; the
// rest is cut to length.
export const cleanText = (v, n) => String(v === undefined || v === null || typeof v === 'object' ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, n || 200);
export const lc = (v) => String(v || '').trim().toLowerCase();
export const catKey = (c) => lc(c).replace(/[^a-z0-9]/g, '');
const sameCat = (a, b) => {
  const x = catKey(a);
  const y = catKey(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};
export const holderKey = (h) => lc(cleanText(h, 40));
// A stored paise value (text) as a whole number, never negative, never beyond the limit. Anything odd counts as 0.
export const P = (v) => {
  const x = typeof v === 'number' ? v : parseInt(String(v === undefined || v === null ? '' : v), 10);
  return Number.isFinite(x) && x > 0 ? Math.min(Math.trunc(x), MAX_PAISE) : 0;
};
export const rupees = (p) => Math.round(Number(p) || 0) / 100;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
export function parseJson(s, dflt) {
  try {
    const v = typeof s === 'string' && s ? JSON.parse(s) : s;
    return v === undefined || v === null ? dflt : v;
  } catch (e) {
    return dflt;
  }
}
// A key that makes a request safe to send twice (the screen makes a new one each time a form is opened).
export const isKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(k);

/* ---------- money in, money out ---------- */
// "1234.5" or 1234.5 becomes 123450. Text with letters or commas, negatives, more than two decimals, exponents,
// arrays, objects and NaN all give null. Zero gives null unless zeroOk.
export function toPaise(v, zeroOk) {
  let s;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    s = String(v);
  } else if (typeof v === 'string') s = v.trim();
  else return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const p = parseInt(m[1], 10) * 100 + parseInt((m[2] || '0').padEnd(2, '0'), 10);
  if (p > MAX_PAISE || (p === 0 && !zeroOk)) return null;
  return p;
}
// 12345650 -> "1,23,456.50" (Indian digit grouping).
export function fmt(p) {
  const n = Math.max(0, Math.trunc(Number(p) || 0));
  const rup = String(Math.floor(n / 100));
  const last3 = rup.slice(-3);
  const rest = rup.slice(0, -3);
  const g = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return g + '.' + String(n % 100).padStart(2, '0');
}
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const w100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const w1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? w100(r) : '');
};
// 12345650 -> "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only"
export function inWords(p) {
  if (!Number.isInteger(p) || p < 0 || p > MAX_PAISE) return '';
  const rup = Math.floor(p / 100);
  const ps = p % 100;
  const parts = [];
  const crore = Math.floor(rup / 10000000);
  const lakh = Math.floor(rup / 100000) % 100;
  const thou = Math.floor(rup / 1000) % 100;
  const rest = rup % 1000;
  if (crore) parts.push(w100(crore) + ' Crore');
  if (lakh) parts.push(w100(lakh) + ' Lakh');
  if (thou) parts.push(w100(thou) + ' Thousand');
  if (rest) parts.push(w1000(rest));
  const rupeesText = parts.join(' ');
  if (!rup && !ps) return 'Rupees Zero Only';
  const paiseText = ps ? w100(ps) + ' Paise' : '';
  if (!rup) return paiseText + ' Only';
  return 'Rupees ' + rupeesText + (ps ? ' and ' + paiseText : '') + ' Only';
}

/* ---------- dates and numbering ---------- */
export const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
export const istToday = (now) => new Date((now === undefined ? Date.now() : now) + 5.5 * 3600000).toISOString().slice(0, 10);
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// The Indian financial year, April to March: 2026-10-27 is in "2026-27", 2027-03-31 too.
export function fyOf(iso) {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  const a = m >= 4 ? y : y - 1;
  return a + '-' + String((a + 1) % 100).padStart(2, '0');
}
export const docId = (kind, fy, seq) => kind + '~' + fy + '~' + String(seq).padStart(6, '0');
export const docNumber = (prefix, fy, seq) => prefix + '/' + fy + '/' + String(seq).padStart(4, '0');
export const cleanPrefix = (v, dflt) => {
  const s = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9\-/]{0,11}$/.test(s) ? s : dflt;
};
// The row number of a numbered row id such as p~inv~2026-27~000012~003 (the last part), or 0.
export const tailSeq = (id) => {
  const m = /~(\d{1,6})$/.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : 0;
};
export const payId = (sourceId, n) => 'p~' + sourceId + '~' + String(n).padStart(3, '0');

/* ---------- the lines of an invoice and of a claim ---------- */
const pct100 = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const x = parseInt(m[1], 10) * 100 + parseInt((m[2] || '0').padEnd(2, '0'), 10);
  return x <= 10000 ? x : null;
};
// Up to 30 lines of description, quantity, rate and tax percent. Tax is worked out on each line in whole paise.
export function cleanInvoiceLines(list) {
  if (!Array.isArray(list) || !list.length || list.length > 30) throw new Error('bad_lines');
  let subtotal = 0;
  let tax = 0;
  const lines = list.map((l) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw new Error('bad_lines');
    const desc = cleanText(l.desc, 160);
    const qn = typeof l.qty === 'number' ? l.qty : typeof l.qty === 'string' && /^\d{1,6}$/.test(l.qty.trim()) ? parseInt(l.qty, 10) : NaN;
    const rate = toPaise(l.rate);
    const pc = pct100(l.taxPct);
    if (desc.length < 2 || !Number.isInteger(qn) || qn < 1 || qn > 100000 || rate === null || pc === null) throw new Error('bad_lines');
    if (rate > MAX_PAISE / qn) throw new Error('bad_money');
    const amount = qn * rate;
    const t = Math.round((amount * pc) / 10000);
    subtotal += amount;
    tax += t;
    return { desc, qty: qn, rate, taxPct: pc / 100, amount, tax: t };
  });
  const total = subtotal + tax;
  if (total > MAX_PAISE) throw new Error('bad_money');
  return { lines, subtotal, tax, total };
}
// Up to 30 lines of date, what was bought, category, amount and bill reference.
export function cleanClaimLines(list, today) {
  if (!Array.isArray(list) || !list.length || list.length > 30) throw new Error('bad_lines');
  let total = 0;
  const lines = list.map((l) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw new Error('bad_lines');
    const desc = cleanText(l.desc, 160);
    const amount = toPaise(l.amount);
    const date = cleanText(l.date, 10);
    if (desc.length < 2 || amount === null) throw new Error('bad_lines');
    if (!validDate(date) || date > addDays(today, 1)) throw new Error('bad_fdate');
    total += amount;
    return { date, desc, cat: cleanText(l.cat, 40) || 'Other', amount, bill: cleanText(l.bill, 120) };
  });
  if (total > MAX_PAISE) throw new Error('bad_money');
  return { lines, total };
}
// When less than the claimed total is approved, each line is cut in proportion (whole paise; the largest line takes the
// rounding), so the categories still add up to exactly what was approved.
export function allocate(lines, approved) {
  const total = sum(lines, (l) => l.amount);
  if (!total || approved <= 0) return lines.map((l) => Object.assign({}, l, { amount: 0 }));
  if (approved >= total) return lines.map((l) => Object.assign({}, l));
  const out = lines.map((l) => Object.assign({}, l, { amount: Math.floor((l.amount * approved) / total) }));
  const left = approved - sum(out, (l) => l.amount);
  let big = 0;
  out.forEach((l, i) => {
    if (lines[i].amount > lines[big].amount) big = i;
  });
  out[big].amount += left;
  return out;
}

/* ---------- stored rows, brought into a known shape ---------- */
// What is stored can have been edited by hand: text is cut to length, numbers are whole and never negative.
export function normLedger(r) {
  return {
    id: r._id,
    event: String(r.event || ''),
    type: LEDGER_TYPES.includes(r.type) ? r.type : 'expense',
    amount: P(r.amount),
    tds: P(r.tds),
    cat: cleanText(r.cat, 40),
    party: cleanText(r.party, 80),
    mode: MODES.includes(r.mode) ? r.mode : 'other',
    date: validDate(r.date) ? r.date : '',
    ref: cleanText(r.ref, 80),
    note: cleanText(r.note, 200),
    phase: ['advance', 'payment', 'refund'].includes(r.phase) ? r.phase : '',
    source: ['invoice', 'order', 'claim', 'manual'].includes(r.source) ? r.source : 'manual',
    sourceId: String(r.sourceId || ''),
    holder: cleanText(r.holder, 40),
    by: cleanText(r.by, 60),
    at: String(r.at || ''),
    void: r.void === 'yes',
    voidBy: cleanText(r.voidBy, 60),
    voidAt: String(r.voidAt || ''),
    voidReason: cleanText(r.voidReason, 160),
  };
}
export function normInvoice(r) {
  const lines = (Array.isArray(parseJson(r.lines, [])) ? parseJson(r.lines, []) : []).filter((l) => l && typeof l === 'object').slice(0, 30).map((l) => ({ desc: cleanText(l.desc, 160), qty: Math.max(1, P(l.qty)), rate: P(l.rate), taxPct: Math.min(100, Math.max(0, Number(l.taxPct) || 0)), amount: P(l.amount), tax: P(l.tax) }));
  const org = parseJson(r.org, {});
  return {
    id: r._id,
    event: String(r.event || ''),
    number: String(r.number || ''),
    fy: String(r.fy || ''),
    kind: INVOICE_KINDS.includes(r.kind) ? r.kind : 'other',
    party: cleanText(r.party, 100),
    partyAddr: cleanText(r.partyAddr, 240),
    partyGstin: cleanText(r.partyGstin, 20),
    partyEmail: cleanText(r.partyEmail, 80),
    date: validDate(r.date) ? r.date : '',
    due: validDate(r.due) ? r.due : '',
    lines,
    subtotal: P(r.subtotal),
    tax: P(r.tax),
    total: P(r.total),
    status: r.status === 'cancelled' ? 'cancelled' : 'issued',
    notes: cleanText(r.notes, 400),
    org: orgOut(org),
    sponsorId: String(r.sponsorId || ''),
    by: cleanText(r.by, 60),
    at: String(r.at || ''),
    cancelReason: cleanText(r.cancelReason, 160),
    cancelledBy: cleanText(r.cancelledBy, 60),
    cancelledAt: String(r.cancelledAt || ''),
  };
}
export function normOrder(r) {
  return {
    id: r._id,
    event: String(r.event || ''),
    number: String(r.number || ''),
    fy: String(r.fy || ''),
    vendor: cleanText(r.vendor, 100),
    vendorContact: cleanText(r.vendorContact, 120),
    title: cleanText(r.title, 120),
    cat: cleanText(r.cat, 40),
    estimate: P(r.estimate),
    date: validDate(r.date) ? r.date : '',
    status: r.status === 'cancelled' ? 'cancelled' : 'open',
    notes: cleanText(r.notes, 400),
    by: cleanText(r.by, 60),
    at: String(r.at || ''),
    cancelReason: cleanText(r.cancelReason, 160),
  };
}
export function normClaim(r) {
  const lines = (Array.isArray(parseJson(r.lines, [])) ? parseJson(r.lines, []) : []).filter((l) => l && typeof l === 'object').slice(0, 30).map((l) => ({ date: validDate(l.date) ? l.date : '', desc: cleanText(l.desc, 160), cat: cleanText(l.cat, 40) || 'Other', amount: P(l.amount), bill: cleanText(l.bill, 120) }));
  return {
    id: r._id,
    event: String(r.event || ''),
    number: String(r.number || ''),
    fy: String(r.fy || ''),
    payee: cleanText(r.payee, 80),
    payTo: cleanText(r.payTo, 160),
    lines,
    total: P(r.total),
    approved: P(r.approved),
    status: ['submitted', 'approved', 'rejected', 'cancelled'].includes(r.status) ? r.status : 'submitted',
    notes: cleanText(r.notes, 400),
    by: cleanText(r.by, 60),
    byName: cleanText(r.byName, 80),
    at: String(r.at || ''),
    decidedBy: cleanText(r.decidedBy, 60),
    decidedAt: String(r.decidedAt || ''),
    decisionNote: cleanText(r.decisionNote, 200),
    selfApproved: r.selfApproved === 'yes',
  };
}
export function orgOut(o) {
  const x = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  return {
    name: cleanText(x.name, 100) || DEFAULT_ORG.name,
    address: cleanText(x.address, 240),
    pan: cleanText(x.pan, 12).toUpperCase(),
    gstin: cleanText(x.gstin, 20).toUpperCase(),
    bank: cleanText(x.bank, 200),
    upi: cleanText(x.upi, 60),
    terms: cleanText(x.terms, 400),
    signatory: cleanText(x.signatory, 80),
    invPrefix: cleanPrefix(x.invPrefix, DEFAULT_ORG.invPrefix),
  };
}

/* ---------- where an invoice, an order or a claim stands ---------- */
// An invoice is settled by money received plus tax withheld at source (TDS) that the payer deducted.
export function invoiceState(inv, rows, today) {
  const mine = rows.filter((r) => !r.void && r.source === 'invoice' && r.sourceId === inv.id && r.type === 'income');
  const received = sum(mine, (r) => r.amount);
  const tds = sum(mine, (r) => r.tds);
  const settled = received + tds;
  const balance = Math.max(0, inv.total - settled);
  const status = inv.status === 'cancelled' ? 'cancelled' : settled <= 0 ? 'issued' : balance > 0 ? 'part' : 'paid';
  const open = status === 'issued' || status === 'part';
  return { received, tds, settled, balance, status, overdue: open && !!inv.due && !!today && inv.due < today, payments: rows.filter((r) => r.source === 'invoice' && r.sourceId === inv.id && r.type === 'income') };
}
// An order: what we expect (estimate), what the vendor really billed (actual), and what has been paid (advance and more).
export function orderState(ord, rows) {
  const mine = rows.filter((r) => !r.void && r.source === 'order' && r.sourceId === ord.id);
  const billed = sum(mine.filter((r) => r.type === 'bill'), (r) => r.amount);
  const advance = sum(mine.filter((r) => r.type === 'expense' && r.phase === 'advance'), (r) => r.amount);
  const later = sum(mine.filter((r) => r.type === 'expense' && r.phase !== 'advance'), (r) => r.amount);
  const refunded = sum(mine.filter((r) => r.type === 'income' && r.phase === 'refund'), (r) => r.amount);
  const paid = Math.max(0, advance + later - refunded);
  const hasBill = billed > 0;
  const cap = hasBill ? billed : ord.estimate; // the most that may be paid now
  const balance = Math.max(0, cap - paid);
  const refundDue = hasBill ? Math.max(0, paid - billed) : 0;
  const state = ord.status === 'cancelled' ? 'cancelled' : !hasBill ? (paid > 0 ? 'advance' : 'estimate') : paid > billed ? 'refund' : paid === billed ? 'settled' : 'billed';
  return { billed, advance, later, refunded, paid, actual: hasBill ? billed : null, balance, refundDue, variance: hasBill ? billed - ord.estimate : null, state, bills: rows.filter((r) => r.source === 'order' && r.sourceId === ord.id && r.type === 'bill'), payments: rows.filter((r) => r.source === 'order' && r.sourceId === ord.id && r.type !== 'bill') };
}
// A claim: what was claimed, what the director approved, what has been paid out.
export function claimState(clm, rows) {
  const mine = rows.filter((r) => !r.void && r.source === 'claim' && r.sourceId === clm.id && r.type === 'expense');
  const paid = sum(mine, (r) => r.amount);
  const approved = clm.status === 'approved' ? clm.approved : 0;
  const balance = Math.max(0, approved - paid);
  const status = clm.status !== 'approved' ? clm.status : paid <= 0 ? 'approved' : balance > 0 ? 'part' : 'paid';
  return { paid, approved, balance, status, payments: rows.filter((r) => r.source === 'claim' && r.sourceId === clm.id && r.type === 'expense') };
}

/* ---------- cash in hand ---------- */
// Cash taken out of the bank is held by a person. Cash payments they make come out of what they hold; cash they
// receive goes into it; what is put back is taken out. What is left is "in hand" and must be accounted for.
export function cashBook(rows) {
  const m = new Map();
  const of = (h) => {
    const k = holderKey(h);
    if (!m.has(k)) m.set(k, { holder: cleanText(h, 40), withdrawn: 0, deposited: 0, spent: 0, received: 0, inHand: 0 });
    return m.get(k);
  };
  for (const r of rows) {
    if (r.void) continue;
    if (r.type === 'withdrawal') of(r.holder).withdrawn += r.amount;
    else if (r.type === 'deposit') of(r.holder).deposited += r.amount;
    else if (r.mode === 'cash' && r.type === 'expense') of(r.holder).spent += r.amount;
    else if (r.mode === 'cash' && r.type === 'income') of(r.holder).received += r.amount;
  }
  const holders = [...m.values()].map((h) => Object.assign(h, { inHand: h.withdrawn + h.received - h.deposited - h.spent })).sort((a, b) => a.holder.localeCompare(b.holder));
  return { holders, withdrawn: sum(holders, (h) => h.withdrawn), deposited: sum(holders, (h) => h.deposited), spent: sum(holders, (h) => h.spent), received: sum(holders, (h) => h.received), inHand: sum(holders, (h) => h.inHand) };
}

/* ---------- registrations ---------- */
// Takings from tickets: every paid registration at the price of its category (the same rule as the dashboard).
export function regRevenue(cats, regs) {
  let paid = 0;
  let unpaid = 0;
  let revenue = 0;
  let pending = 0;
  const list = Array.isArray(cats) ? cats : [];
  for (const r of regs) {
    const k = catKey(r.cat);
    let i = list.findIndex((c) => catKey(c.name) === k);
    if (i < 0) i = list.findIndex((c) => sameCat(c.name, r.cat));
    const price = i >= 0 ? Math.round((Number(list[i].price) || 0) * 100) : 0;
    if (r.status === 'ok') {
      paid++;
      revenue += price;
    } else {
      unpaid++;
      pending += price;
    }
  }
  return { paid, unpaid, revenue, pending };
}

/* ---------- the race's income and expenses ---------- */
// invoices, orders, claims, ledger: normalised rows (see norm*). budget: raw plan rows of kind 'budget'. regs: regRevenue().
export function summary(inv, ord, clm, led, budget, regs, today) {
  const live = led.filter((r) => !r.void);
  const incomeRows = live.filter((r) => r.type === 'income');
  const invoices = inv.filter((i) => i.status !== 'cancelled');
  const invStates = invoices.map((i) => ({ i, s: invoiceState(i, led, today) }));
  const invoiced = sum(invoices, (i) => i.total);
  const received = sum(invStates, (x) => x.s.received);
  const tds = sum(invStates, (x) => x.s.tds);
  const outstanding = sum(invStates, (x) => x.s.balance);
  const overdue = invStates.filter((x) => x.s.overdue);
  const otherIncome = sum(incomeRows.filter((r) => r.source === 'manual'), (r) => r.amount);
  const incomeTotal = regs.revenue + received + otherIncome;

  const orders = ord.filter((o) => o.status !== 'cancelled').map((o) => ({ o, s: orderState(o, led) }));
  const claims = clm.map((c) => ({ c, s: claimState(c, led) }));
  const expenseRows = live.filter((r) => r.type === 'expense');
  const refundRows = live.filter((r) => r.type === 'income' && r.phase === 'refund');
  const paid = Math.max(0, sum(expenseRows, (r) => r.amount) - sum(refundRows, (r) => r.amount));
  const owedOrders = sum(orders.filter((x) => x.s.actual !== null), (x) => x.s.balance);
  const owedClaims = sum(claims.filter((x) => x.c.status === 'approved'), (x) => x.s.balance);
  const committed = sum(orders.filter((x) => x.s.actual === null), (x) => Math.max(0, x.o.estimate - x.s.paid));
  const pendingClaims = sum(claims.filter((x) => x.c.status === 'submitted'), (x) => x.c.total);
  const refundDue = sum(orders, (x) => x.s.refundDue);
  const direct = live.filter((r) => r.type === 'expense' && r.source === 'manual');

  // by category: budget, what orders were estimated at, what it really cost
  const cats = new Map();
  const slot = (name) => {
    const k = catKey(name) || 'other';
    if (!cats.has(k)) cats.set(k, { cat: cleanText(name, 40) || 'Other', budget: 0, estimate: 0, actual: 0 });
    return cats.get(k);
  };
  let budgetCost = 0;
  let budgetIncome = 0;
  for (const b of budget) {
    if (['cancelled', 'declined'].includes(b.status)) continue;
    const amt = Math.round((Number(b.amount) || 0) * 100);
    if (b.phase === 'income') budgetIncome += amt;
    else {
      budgetCost += amt;
      slot(b.cat || 'Other').budget += amt;
    }
  }
  for (const x of orders) {
    const c = slot(x.o.cat || 'Other');
    c.estimate += x.o.estimate;
    c.actual += x.s.billed;
  }
  for (const x of claims) {
    if (x.c.status !== 'approved') continue;
    for (const l of allocate(x.c.lines, x.c.approved)) slot(l.cat).actual += l.amount;
  }
  for (const r of direct) slot(r.cat || 'Other').actual += r.amount;
  const byCat = [...cats.values()].filter((c) => c.budget || c.estimate || c.actual).sort((a, b) => a.cat.localeCompare(b.cat));
  const cost = sum(byCat, (c) => c.actual);
  const projectedCost = paid + owedOrders + owedClaims + committed + pendingClaims - refundDue;

  const cash = cashBook(led);
  const orderSum = (f) => sum(orders, (x) => f(x));
  return {
    income: { registrations: regs, invoiced, received, tds, outstanding, other: otherIncome, total: incomeTotal, invoices: { count: invoices.length, overdueCount: overdue.length, overdueAmount: sum(overdue, (x) => x.s.balance) } },
    expenses: { paid, cost, owed: owedOrders + owedClaims, committed, pendingClaims, refundDue, projected: projectedCost },
    result: { net: incomeTotal - paid, projected: incomeTotal + outstanding - projectedCost },
    budget: { cost: budgetCost, income: budgetIncome },
    byCat,
    orders: { count: orders.length, estimate: orderSum((x) => x.o.estimate), billed: orderSum((x) => x.s.billed), advance: orderSum((x) => x.s.advance), paid: orderSum((x) => x.s.paid), balance: orderSum((x) => (x.s.actual !== null ? x.s.balance : 0)), refundDue },
    claims: { pending: { count: claims.filter((x) => x.c.status === 'submitted').length, amount: pendingClaims }, approved: { count: claims.filter((x) => x.c.status === 'approved' && x.s.balance > 0).length, balance: owedClaims }, paid: sum(claims, (x) => x.s.paid) },
    cash,
  };
}
export const cashOut = (c) => ({ holders: c.holders.map((h) => ({ holder: h.holder, withdrawn: rupees(h.withdrawn), deposited: rupees(h.deposited), spent: rupees(h.spent), received: rupees(h.received), inHand: rupees(h.inHand) })), withdrawn: rupees(c.withdrawn), deposited: rupees(c.deposited), spent: rupees(c.spent), received: rupees(c.received), inHand: rupees(c.inHand) });
// The same figures with money in rupees for the screens (counts stay counts).
export function summaryOut(s) {
  const R = rupees;
  const o = s.orders;
  return {
    income: { registrations: { paid: s.income.registrations.paid, unpaid: s.income.registrations.unpaid, revenue: R(s.income.registrations.revenue), pending: R(s.income.registrations.pending) }, invoiced: R(s.income.invoiced), received: R(s.income.received), tds: R(s.income.tds), outstanding: R(s.income.outstanding), other: R(s.income.other), total: R(s.income.total), invoices: { count: s.income.invoices.count, overdueCount: s.income.invoices.overdueCount, overdueAmount: R(s.income.invoices.overdueAmount) } },
    expenses: { paid: R(s.expenses.paid), cost: R(s.expenses.cost), owed: R(s.expenses.owed), committed: R(s.expenses.committed), pendingClaims: R(s.expenses.pendingClaims), refundDue: R(s.expenses.refundDue), projected: R(s.expenses.projected) },
    result: { net: R(s.result.net), projected: R(s.result.projected) },
    budget: { cost: R(s.budget.cost), income: R(s.budget.income) },
    byCat: s.byCat.map((c) => ({ cat: c.cat, budget: R(c.budget), estimate: R(c.estimate), actual: R(c.actual) })),
    orders: { count: o.count, estimate: R(o.estimate), billed: R(o.billed), advance: R(o.advance), paid: R(o.paid), balance: R(o.balance), refundDue: R(o.refundDue) },
    claims: { pending: { count: s.claims.pending.count, amount: R(s.claims.pending.amount) }, approved: { count: s.claims.approved.count, balance: R(s.claims.approved.balance) }, paid: R(s.claims.paid) },
    cash: cashOut(s.cash),
  };
}
