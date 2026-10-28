// backend/finance.web.js
// Finance for RaceOS (Velo): invoices, reimbursement claims, cash withdrawals, orders (estimate, advance, actual) and the
// race's income and expenses. It uses the same logins as RaceOS (the session token the page already holds).
//
//   director (admin or director)  everything in here
//   lead                          can raise a reimbursement claim and see, change or cancel THEIR OWN claims. Nothing else.
//   viewer, desk, coach, other    refused (money is not theirs to see)
//
// Everything is append-only: a payment, bill or entry made by mistake is VOIDED (kept, with who and why), never edited or
// deleted. An invoice, once raised, is never edited either (cancel it and raise a new one); numbers are never reused.
// A request can be sent twice (double click, bad network): each create carries a key, and the same key does nothing twice.
// Money is held in whole paise (rd-finance.js) so sums are exact.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { kindOf, unameOf, tidyError } from './rd-auth.js';
import { MODES, INVOICE_KINDS, DEFAULT_ORG, cleanText, lc, holderKey, toPaise, rupees as R, inWords, istToday, addDays, validDate, fyOf, docId, docNumber, tailSeq, payId, cleanInvoiceLines, cleanClaimLines, normLedger, normInvoice, normOrder, normClaim, orgOut, invoiceState, orderState, claimState, cashBook, cashOut, regRevenue, summary, summaryOut, isKey, parseJson } from './rd-finance.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'finance');
    }
  });

const STAFF = 'ExpoStaff';
const SESS = 'ExpoSessions';
const EVENTS = 'RDEvents';
const REGS = 'RDRegs';
const PLAN = 'RDPlan';
const AUDIT = 'RDAudit';
const INVS = 'RDInvoices';
const ORDS = 'RDOrders';
const CLMS = 'RDClaims';
const LED = 'RDLedger';
const FSET = 'RDFinSet';
const SA = { suppressAuth: true };
const MAXROWS = 1000;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const UPI_RE = /^[\w.\-]{2,}@[A-Za-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const nowIso = () => new Date().toISOString();
// A choice such as a mode, a type or a phase must arrive as text. A list or an object is never turned into text to pass.
const sOnly = (v) => (typeof v === 'string' ? v : '');

async function all(q) {
  const out = [];
  for (let skip = 0; skip < 20000; skip += MAXROWS) {
    const r = await q().skip(skip).limit(MAXROWS).find(SA);
    out.push(...r.items);
    if (r.items.length < MAXROWS) break;
  }
  return out;
}
const rows = (c, ev) => all(() => wixData.query(c).eq('event', ev).ascending('_id'));

/* ---------- who is asking ---------- */
async function staffRows() {
  try {
    const out = [];
    for (let skip = 0; skip < 5000; skip += MAXROWS) {
      const r = await wixData.query(STAFF).ascending('_id').skip(skip).limit(MAXROWS).find(SA);
      out.push(...r.items);
      if (r.items.length < MAXROWS) break;
    }
    return out;
  } catch (e) {
    throw new Error('setup_needed');
  }
}
// Every Finance method starts here. need: 'director' (directors only) or 'claims' (directors and leads).
async function fauth(arg, need) {
  const t = String((arg && arg.token) || '');
  if (t.length < 20) throw new Error('not_logged_in');
  let sess;
  try {
    sess = (await wixData.query(SESS).eq('token', t).limit(1).find(SA)).items[0];
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === lc(sess.username));
  if (!u) throw new Error('not_logged_in');
  const kind = kindOf(u);
  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');
  if (need === 'director' && kind !== 'director') throw new Error('director_only');
  await ensureCollections();
  return { role: kind, name: String(u.name || unameOf(u)), username: String(unameOf(u)) };
}
async function audit(a, action, target, detail) {
  try {
    await wixData.insert(AUDIT, { at: nowIso(), by: a.username, action, target: cleanText(target, 60), detail: cleanText(detail, 200) }, SA);
  } catch (e) {
    // the note is lost, the change is not
  }
}
async function getEvent(ev) {
  const id = typeof ev === 'string' ? ev : '';
  const it = id ? await wixData.get(EVENTS, id, SA).catch(() => null) : null;
  if (!it) throw new Error('no_event');
  return it;
}
// A row of this race, or an error that says nothing about rows of other races.
async function getOf(col, id, e) {
  const row = typeof id === 'string' && id ? await wixData.get(col, id, SA).catch(() => null) : null;
  if (!row || row.event !== e._id) throw new Error('no_item');
  return row;
}

/* ---------- safe to send twice ---------- */
// The same key from the same login does nothing the second time and answers with what the first time made.
let lastClean = 0;
// A repeated request answers with the number of the document the first request made, as the first answer did.
async function withNumber(col, out) {
  if (out && out.again && !out.number) {
    const row = await wixData.get(col, out.id, SA).catch(() => null);
    if (row && row.number) out.number = String(row.number);
  }
  return out;
}
async function once(a, kind, key, make) {
  if (key === undefined || key === null || key === '') return make();
  if (!isKey(key)) throw new Error('bad_key');
  const id = 'k~' + kind + '~' + key;
  try {
    await wixData.insert(FSET, { _id: id, kind: 'key', by: a.username, at: nowIso(), ref: '', json: '' }, SA);
  } catch (e) {
    const old = await wixData.get(FSET, id, SA).catch(() => null);
    if (!old) throw e;
    if (old.by === a.username && old.ref) return { id: old.ref, again: true };
    throw new Error('busy_try_again');
  }
  let out;
  try {
    out = await make();
  } catch (e) {
    await wixData.bulkRemove(FSET, [id], SA).catch(() => null);
    throw e;
  }
  await wixData.update(FSET, { _id: id, kind: 'key', by: a.username, at: nowIso(), ref: out.id, json: '' }, SA).catch(() => null);
  if (Date.now() - lastClean > 3600000) {
    lastClean = Date.now();
    try {
      const old = await wixData.query(FSET).lt('at', new Date(Date.now() - 3 * 86400000).toISOString()).limit(200).find(SA);
      const gone = old.items.filter((x) => String(x._id).startsWith('k~') && x.at).map((x) => x._id);
      if (gone.length) await wixData.bulkRemove(FSET, gone, SA);
    } catch (e) {
      // clean-up is best effort
    }
  }
  return out;
}
// Numbered documents: the number is part of the row's id, and an id can be inserted only once. If two people raise one at
// the same moment, one of them simply gets the next number. No number is ever used twice or skipped.
async function insertNumbered(col, kind, fy, build) {
  const have = await all(() => wixData.query(col).eq('fy', fy).ascending('_id'));
  let seq = have.reduce((m, r) => Math.max(m, tailSeq(r._id)), 0) + 1;
  for (let k = 0; k < 25; k++, seq++) {
    const id = docId(kind, fy, seq);
    try {
      return await wixData.insert(col, build(id, seq), SA);
    } catch (err) {
      const taken = await wixData.get(col, id, SA).catch(() => null);
      if (!taken) throw err;
    }
  }
  throw new Error('busy_try_again');
}
// A payment, bill or refund on one invoice, order or claim. It is checked against what is already recorded for that
// document and takes the next number; two payments sent at the same moment cannot both pass the check.
async function postRow(srcId, check, build) {
  for (let k = 0; k < 20; k++) {
    const have = (await all(() => wixData.query(LED).eq('sourceId', srcId).ascending('_id'))).map(normLedger);
    check(have);
    const id = payId(srcId, have.reduce((m, r) => Math.max(m, tailSeq(r.id)), 0) + 1);
    try {
      return await wixData.insert(LED, build(id), SA);
    } catch (err) {
      const taken = await wixData.get(LED, id, SA).catch(() => null);
      if (!taken) throw err;
    }
  }
  throw new Error('busy_try_again');
}
// Cash paid out or put back must come out of cash the person actually holds. Checked after the row is in, so two cash
// payments sent at the same moment cannot both spend the same cash: the later one is taken back out.
async function verifyCash(e, holder, newId) {
  const led = (await rows(LED, e._id)).map(normLedger);
  const h = cashBook(led).holders.find((x) => holderKey(x.holder) === holderKey(holder));
  if (h && h.inHand < 0) {
    await wixData.bulkRemove(LED, [newId], SA);
    throw new Error('not_enough_cash');
  }
}

/* ---------- reading ---------- */
async function loadAll(evId) {
  const [inv, ord, clm, led] = await Promise.all([rows(INVS, evId), rows(ORDS, evId), rows(CLMS, evId), rows(LED, evId)]);
  return { inv: inv.map(normInvoice), ord: ord.map(normOrder), clm: clm.map(normClaim), led: led.map(normLedger) };
}
async function settingsOrg() {
  const row = await wixData.get(FSET, 'settings', SA).catch(() => null);
  return orgOut(parseJson(row && row.json, {}));
}
const byAtAsc = (x, y) => String(x.at || '').localeCompare(String(y.at || '')) || String(x.id).localeCompare(String(y.id));
const payOut = (r, nos) => ({
  id: r.id,
  type: r.type,
  amount: R(r.amount),
  tds: R(r.tds),
  cat: r.cat,
  party: r.party,
  mode: r.mode,
  date: r.date,
  ref: r.ref,
  note: r.note,
  phase: r.phase,
  source: r.source,
  sourceId: r.sourceId,
  sourceNo: (nos && nos.get(r.sourceId)) || '',
  holder: r.holder,
  by: r.by,
  at: r.at,
  void: r.void,
  voidBy: r.voidBy,
  voidAt: r.voidAt,
  voidReason: r.voidReason,
});
function invOut(i, led, today) {
  const s = invoiceState(i, led, today);
  return {
    id: i.id, number: i.number, fy: i.fy, kind: i.kind, party: i.party, partyAddr: i.partyAddr, partyGstin: i.partyGstin, partyEmail: i.partyEmail, date: i.date, due: i.due,
    lines: i.lines.map((l) => ({ desc: l.desc, qty: l.qty, rate: R(l.rate), taxPct: l.taxPct, amount: R(l.amount), tax: R(l.tax) })),
    subtotal: R(i.subtotal), tax: R(i.tax), total: R(i.total), totalWords: inWords(i.total),
    received: R(s.received), tds: R(s.tds), balance: R(s.balance), status: s.status, overdue: s.overdue,
    notes: i.notes, org: i.org, sponsorId: i.sponsorId, by: i.by, at: i.at, cancelReason: i.cancelReason, cancelledBy: i.cancelledBy, cancelledAt: i.cancelledAt,
    payments: s.payments.sort(byAtAsc).map((r) => payOut(r)),
  };
}
function ordOut(o, led) {
  const s = orderState(o, led);
  return {
    id: o.id, number: o.number, vendor: o.vendor, vendorContact: o.vendorContact, title: o.title, cat: o.cat, estimate: R(o.estimate), date: o.date, status: s.state, cancelled: o.status === 'cancelled', notes: o.notes, by: o.by, at: o.at, cancelReason: o.cancelReason,
    billed: R(s.billed), actual: s.actual === null ? null : R(s.actual), advance: R(s.advance), later: R(s.later), refunded: R(s.refunded), paid: R(s.paid), balance: R(s.balance), refundDue: R(s.refundDue), variance: s.variance === null ? null : s.variance / 100,
    bills: s.bills.sort(byAtAsc).map((r) => payOut(r)), payments: s.payments.sort(byAtAsc).map((r) => payOut(r)),
  };
}
function clmOut(c, led, me) {
  const s = claimState(c, led);
  return {
    id: c.id, number: c.number, payee: c.payee, payTo: c.payTo,
    lines: c.lines.map((l) => ({ date: l.date, desc: l.desc, cat: l.cat, amount: R(l.amount), bill: l.bill })),
    total: R(c.total), totalWords: inWords(c.total), approved: R(s.approved), approvedWords: s.approved ? inWords(s.approved) : '', paid: R(s.paid), balance: R(s.balance), status: s.status,
    notes: c.notes, by: c.by, byName: c.byName, at: c.at, decidedBy: c.decidedBy, decidedAt: c.decidedAt, decisionNote: c.decisionNote, selfApproved: c.selfApproved, mine: c.by === me.username,
    payments: s.payments.sort(byAtAsc).map((r) => payOut(r)),
  };
}
function docNumbers(L) {
  const m = new Map();
  L.inv.forEach((x) => m.set(x.id, x.number));
  L.ord.forEach((x) => m.set(x.id, x.number));
  L.clm.forEach((x) => m.set(x.id, x.number));
  return m;
}

export const finOverview = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const L = await loadAll(e._id);
  const [regs, plan] = await Promise.all([rows(REGS, e._id).catch(() => []), rows(PLAN, e._id).catch(() => [])]);
  const j = parseJson(e.json, {});
  const cats = Array.isArray(j.cats) ? j.cats.filter((c) => c && typeof c === 'object') : [];
  const s = summary(L.inv, L.ord, L.clm, L.led, plan.filter((p) => p.kind === 'budget'), regRevenue(cats, regs), istToday());
  return { summary: summaryOut(s), me: { role: a.role, name: a.name } };
});

/* ---------- details printed on invoices ---------- */
export const finSettings = webMethod(Permissions.Anyone, async (arg) => {
  await fauth(arg, 'director');
  return { org: await settingsOrg() };
});
export const finSaveSettings = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const cur = await settingsOrg();
  const has = (k) => arg[k] !== undefined;
  const next = Object.assign({}, cur);
  if (has('name')) next.name = cleanText(arg.name, 100);
  if (next.name.length < 2) throw new Error('name_needed');
  if (has('address')) next.address = cleanText(arg.address, 240);
  if (has('pan')) {
    next.pan = cleanText(arg.pan, 12).toUpperCase();
    if (next.pan && !PAN_RE.test(next.pan)) throw new Error('bad_pan');
  }
  if (has('gstin')) {
    next.gstin = cleanText(arg.gstin, 20).toUpperCase();
    if (next.gstin && !GSTIN_RE.test(next.gstin)) throw new Error('bad_gstin');
  }
  if (has('bank')) next.bank = cleanText(arg.bank, 200);
  if (has('upi')) {
    next.upi = cleanText(arg.upi, 60);
    if (next.upi && !UPI_RE.test(next.upi)) throw new Error('bad_upi');
  }
  if (has('terms')) next.terms = cleanText(arg.terms, 400);
  if (has('signatory')) next.signatory = cleanText(arg.signatory, 80);
  if (has('invPrefix')) {
    const p = String(arg.invPrefix === null ? '' : arg.invPrefix).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9\-/]{0,11}$/.test(p)) throw new Error('bad_prefix');
    next.invPrefix = p;
  }
  const clean = orgOut(next);
  const old = await wixData.get(FSET, 'settings', SA).catch(() => null);
  const row = { _id: 'settings', kind: 'settings', by: a.username, at: nowIso(), ref: '', json: JSON.stringify(clean) };
  if (old) await wixData.update(FSET, row, SA);
  else await wixData.insert(FSET, row, SA);
  await audit(a, 'finance details saved', 'settings', clean.name);
  return { org: clean };
});

/* ---------- invoices ---------- */
export const finListInvoices = webMethod(Permissions.Anyone, async (arg) => {
  await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const L = await loadAll(e._id);
  const today = istToday();
  return { invoices: L.inv.map((i) => invOut(i, L.led, today)).sort((x, y) => String(y.id).localeCompare(String(x.id))), org: await settingsOrg() };
});
export const finRaiseInvoice = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const today = istToday();
  const kind = arg.kind === undefined || arg.kind === '' ? 'sponsor' : sOnly(arg.kind);
  if (!INVOICE_KINDS.includes(kind)) throw new Error('bad_kind');
  const party = cleanText(arg.party, 100);
  if (party.length < 2) throw new Error('name_needed');
  const partyEmail = cleanText(arg.partyEmail, 80);
  if (partyEmail && !EMAIL_RE.test(partyEmail)) throw new Error('bad_email');
  const partyGstin = cleanText(arg.partyGstin, 20).toUpperCase();
  if (partyGstin && !GSTIN_RE.test(partyGstin)) throw new Error('bad_gstin');
  const date = arg.date ? cleanText(arg.date, 10) : today;
  if (!validDate(date) || date > addDays(today, 1) || date < addDays(today, -366)) throw new Error('bad_fdate');
  const due = arg.due ? cleanText(arg.due, 10) : addDays(date, 15);
  if (!validDate(due) || due < date || due > addDays(date, 1095)) throw new Error('bad_fdate');
  const L = cleanInvoiceLines(arg.lines);
  let sponsorId = '';
  if (arg.sponsorId) {
    sponsorId = cleanText(arg.sponsorId, 80);
    const sp = await wixData.get(PLAN, sponsorId, SA).catch(() => null);
    if (!sp || sp.event !== e._id || sp.kind !== 'sponsor') throw new Error('no_such_sponsor');
  }
  const org = await settingsOrg();
  const fy = fyOf(date);
  const out = await once(a, 'inv', arg.key, async () => {
    const row = await insertNumbered(INVS, 'inv', fy, (id, seq) => ({
      _id: id, event: e._id, fy, seq: String(seq), number: docNumber(org.invPrefix, fy, seq), kind, party, partyAddr: cleanText(arg.partyAddr, 240), partyGstin, partyEmail, date, due,
      lines: JSON.stringify(L.lines), subtotal: String(L.subtotal), tax: String(L.tax), total: String(L.total), status: 'issued', notes: cleanText(arg.notes, 400), org: JSON.stringify(org), sponsorId,
      by: a.username, at: nowIso(), cancelReason: '', cancelledBy: '', cancelledAt: '',
    }));
    return { id: row._id, number: row.number };
  });
  if (!out.again) await audit(a, 'invoice raised', out.number, party + ' ' + L.total / 100);
  return withNumber(INVS, out);
});
export const finCancelInvoice = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(INVS, arg.id, e);
  const reason = cleanText(arg.reason, 160);
  if (reason.length < 3) throw new Error('reason_needed');
  if (row.status === 'cancelled') throw new Error('already_cancelled');
  const led = (await all(() => wixData.query(LED).eq('sourceId', row._id).ascending('_id'))).map(normLedger);
  if (led.some((r) => !r.void && r.type === 'income')) throw new Error('has_payments');
  await wixData.update(INVS, Object.assign({}, row, { status: 'cancelled', cancelReason: reason, cancelledBy: a.username, cancelledAt: nowIso() }), SA);
  await audit(a, 'invoice cancelled', row.number, reason);
  return { ok: true };
});

/* ---------- what the screens send with a payment ---------- */
function payFields(arg, today, minDate) {
  const mode = arg.mode === undefined || arg.mode === '' ? 'bank' : sOnly(arg.mode);
  if (!MODES.includes(mode)) throw new Error('bad_mode');
  const date = arg.date ? cleanText(arg.date, 10) : today;
  if (!validDate(date) || date > addDays(today, 1) || date < addDays(today, -731) || (minDate && date < minDate)) throw new Error('bad_fdate');
  const holder = mode === 'cash' ? cleanText(arg.holder, 40) : '';
  if (mode === 'cash' && holder.length < 2) throw new Error('holder_needed');
  return { mode, date, holder, ref: cleanText(arg.ref, 80), note: cleanText(arg.note, 200) };
}
const base = (a, e, f, o) => Object.assign({ event: e._id, type: 'expense', amount: '0', tds: '0', cat: '', party: '', mode: f.mode, date: f.date, ref: f.ref, note: f.note, phase: '', source: 'manual', sourceId: '', holder: f.holder, by: a.username, at: nowIso(), void: '', voidBy: '', voidAt: '', voidReason: '' }, o);

export const finPayInvoice = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(INVS, arg.id, e);
  const inv = normInvoice(row);
  if (inv.status === 'cancelled') throw new Error('invoice_cancelled');
  const amount = arg.amount === undefined || arg.amount === '' || arg.amount === null ? 0 : toPaise(arg.amount, true);
  const tds = arg.tds === undefined || arg.tds === '' || arg.tds === null ? 0 : toPaise(arg.tds, true);
  if (amount === null || tds === null || amount + tds <= 0) throw new Error('bad_money');
  const f = payFields(arg, istToday(), inv.date);
  const out = await once(a, 'ipay', arg.key, async () => {
    const r = await postRow(
      inv.id,
      (have) => {
        const st = invoiceState(inv, have, '');
        if (st.settled + amount + tds > inv.total) throw new Error('too_much');
      },
      (id) => base(a, e, f, { _id: id, type: 'income', amount: String(amount), tds: String(tds), cat: inv.kind === 'sponsor' ? 'Sponsorship' : inv.kind === 'partner' ? 'Partnership' : 'Other income', party: inv.party, source: 'invoice', sourceId: inv.id }),
    );
    return { id: r._id };
  });
  if (!out.again) await audit(a, 'payment received', inv.number, (amount + tds) / 100 + ' ' + f.mode);
  return out;
});
/* ---------- orders: estimate, advance, actual ---------- */
export const finListOrders = webMethod(Permissions.Anyone, async (arg) => {
  await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const L = await loadAll(e._id);
  return { orders: L.ord.map((o) => ordOut(o, L.led)).sort((x, y) => String(y.id).localeCompare(String(x.id))) };
});
export const finSaveOrder = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const today = istToday();
  const vendor = cleanText(arg.vendor, 100);
  const title = cleanText(arg.title, 120);
  if (vendor.length < 2 || title.length < 2) throw new Error('name_needed');
  const estimate = toPaise(arg.estimate);
  if (estimate === null) throw new Error('bad_money');
  const date = arg.date ? cleanText(arg.date, 10) : today;
  if (!validDate(date) || date > addDays(today, 1) || date < addDays(today, -731)) throw new Error('bad_fdate');
  const fields = { vendor, vendorContact: cleanText(arg.vendorContact, 120), title, cat: cleanText(arg.cat, 40) || 'Other', estimate: String(estimate), date, notes: cleanText(arg.notes, 400) };
  if (arg.id) {
    const old = await getOf(ORDS, arg.id, e);
    if (old.status === 'cancelled') throw new Error('order_cancelled');
    const led = (await all(() => wixData.query(LED).eq('sourceId', old._id).ascending('_id'))).map(normLedger);
    const st = orderState(normOrder(old), led);
    if (st.billed === 0 && st.paid > estimate) throw new Error('estimate_below_paid');
    await wixData.update(ORDS, Object.assign({}, old, fields), SA);
    await audit(a, 'order changed', old.number, title + ' ' + estimate / 100);
    return { id: old._id };
  }
  const fy = fyOf(today);
  const out = await once(a, 'ord', arg.key, async () => {
    const row = await insertNumbered(ORDS, 'ord', fy, (id, seq) => Object.assign({ _id: id, event: e._id, fy, seq: String(seq), number: docNumber('PO', fy, seq), status: 'open', by: a.username, at: nowIso(), cancelReason: '' }, fields));
    return { id: row._id, number: row.number };
  });
  if (!out.again) await audit(a, 'order raised', out.number, vendor + ' ' + estimate / 100);
  return withNumber(ORDS, out);
});
async function openOrder(arg, e) {
  const row = await getOf(ORDS, arg.id, e);
  const ord = normOrder(row);
  if (ord.status === 'cancelled') throw new Error('order_cancelled');
  return ord;
}
export const finAddBill = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const ord = await openOrder(arg, e);
  const amount = toPaise(arg.amount);
  if (amount === null) throw new Error('bad_money');
  const f = payFields(Object.assign({}, arg, { mode: 'other' }), istToday());
  const out = await once(a, 'bill', arg.key, async () => {
    const r = await postRow(
      ord.id,
      (have) => {
        if (have.filter((x) => !x.void && x.type === 'bill').reduce((s, x) => s + x.amount, 0) + amount > 99999999999) throw new Error('bad_money');
      },
      (id) => base(a, e, f, { _id: id, type: 'bill', amount: String(amount), cat: ord.cat, party: ord.vendor, mode: 'other', source: 'order', sourceId: ord.id, ref: cleanText(arg.no, 80) }),
    );
    return { id: r._id };
  });
  if (!out.again) await audit(a, 'bill added', ord.number, amount / 100);
  return out;
});
export const finPayOrder = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const ord = await openOrder(arg, e);
  const amount = toPaise(arg.amount);
  if (amount === null) throw new Error('bad_money');
  const phase = arg.phase === undefined || arg.phase === '' ? 'payment' : sOnly(arg.phase);
  if (phase !== 'advance' && phase !== 'payment') throw new Error('bad_pay_phase');
  const f = payFields(arg, istToday());
  const out = await once(a, 'opay', arg.key, async () => {
    const r = await postRow(
      ord.id,
      (have) => {
        const st = orderState(ord, have);
        if (amount > st.balance) throw new Error('too_much');
      },
      (id) => base(a, e, f, { _id: id, type: 'expense', amount: String(amount), cat: ord.cat, party: ord.vendor, phase, source: 'order', sourceId: ord.id }),
    );
    if (f.mode === 'cash') await verifyCash(e, f.holder, r._id);
    return { id: r._id };
  });
  if (!out.again) await audit(a, 'order payment', ord.number, amount / 100 + ' ' + phase + ' ' + f.mode);
  return out;
});
export const finRefundOrder = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const ord = await openOrder(arg, e);
  const amount = toPaise(arg.amount);
  if (amount === null) throw new Error('bad_money');
  const f = payFields(arg, istToday());
  const out = await once(a, 'oref', arg.key, async () => {
    const r = await postRow(
      ord.id,
      (have) => {
        const st = orderState(ord, have);
        if (amount > st.paid) throw new Error('too_much');
      },
      (id) => base(a, e, f, { _id: id, type: 'income', amount: String(amount), cat: ord.cat, party: ord.vendor, phase: 'refund', source: 'order', sourceId: ord.id }),
    );
    return { id: r._id };
  });
  if (!out.again) await audit(a, 'refund received', ord.number, amount / 100 + ' ' + f.mode);
  return out;
});
export const finCancelOrder = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(ORDS, arg.id, e);
  const reason = cleanText(arg.reason, 160);
  if (reason.length < 3) throw new Error('reason_needed');
  if (row.status === 'cancelled') throw new Error('already_cancelled');
  const led = (await all(() => wixData.query(LED).eq('sourceId', row._id).ascending('_id'))).map(normLedger);
  if (led.some((r) => !r.void)) throw new Error('has_activity');
  await wixData.update(ORDS, Object.assign({}, row, { status: 'cancelled', cancelReason: reason }), SA);
  await audit(a, 'order cancelled', row.number, reason);
  return { ok: true };
});

/* ---------- reimbursement claims ---------- */
export const finListClaims = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'claims');
  const e = await getEvent(arg.ev);
  const [clm, led] = await Promise.all([rows(CLMS, e._id), rows(LED, e._id)]);
  const L = led.map(normLedger);
  // A lead sees only the claims they raised themselves.
  const mine = clm.map(normClaim).filter((c) => a.role === 'director' || c.by === a.username);
  const mineIds = new Set(mine.map((c) => c.id));
  const own = a.role === 'director' ? L : L.filter((r) => r.source === 'claim' && mineIds.has(r.sourceId));
  return { claims: mine.map((c) => clmOut(c, own, a)).sort((x, y) => String(y.id).localeCompare(String(x.id))), role: a.role };
});
export const finSaveClaim = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'claims');
  const e = await getEvent(arg.ev);
  const today = istToday();
  const payee = cleanText(arg.payee, 80) || a.name;
  if (payee.length < 2) throw new Error('name_needed');
  const L = cleanClaimLines(arg.lines, today);
  const fields = { payee, payTo: cleanText(arg.payTo, 160), lines: JSON.stringify(L.lines), total: String(L.total), notes: cleanText(arg.notes, 400) };
  if (arg.id) {
    const old = await getOf(CLMS, arg.id, e);
    if (a.role !== 'director' && old.by !== a.username) throw new Error('no_item');
    if (old.status !== 'submitted') throw new Error('not_editable');
    await wixData.update(CLMS, Object.assign({}, old, fields), SA);
    return { id: old._id };
  }
  const fy = fyOf(today);
  const out = await once(a, 'clm', arg.key, async () => {
    const row = await insertNumbered(CLMS, 'clm', fy, (id, seq) => Object.assign({ _id: id, event: e._id, fy, seq: String(seq), number: docNumber('CLM', fy, seq), approved: '0', status: 'submitted', by: a.username, byName: a.name, at: nowIso(), decidedBy: '', decidedAt: '', decisionNote: '', selfApproved: '' }, fields));
    return { id: row._id, number: row.number };
  });
  if (!out.again) await audit(a, 'claim raised', out.number, payee + ' ' + L.total / 100);
  return withNumber(CLMS, out);
});
export const finDecideClaim = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(CLMS, arg.id, e);
  const clm = normClaim(row);
  const decision = sOnly(arg.decision);
  if (decision !== 'approve' && decision !== 'reject') throw new Error('bad_decision');
  if (clm.status !== 'submitted' && clm.status !== 'approved') throw new Error('not_open');
  const led = (await all(() => wixData.query(LED).eq('sourceId', row._id).ascending('_id'))).map(normLedger);
  const paid = claimState(clm, led).paid;
  const note = cleanText(arg.note, 200);
  let approved = 0;
  if (decision === 'approve') {
    approved = arg.approved === undefined || arg.approved === '' || arg.approved === null ? clm.total : toPaise(arg.approved);
    if (approved === null || approved > clm.total) throw new Error('bad_money');
    if (approved < paid) throw new Error('below_paid');
  } else {
    if (note.length < 3) throw new Error('reason_needed');
    if (paid > 0) throw new Error('has_payments');
  }
  await wixData.update(CLMS, Object.assign({}, row, { status: decision === 'approve' ? 'approved' : 'rejected', approved: String(approved), decidedBy: a.username, decidedAt: nowIso(), decisionNote: note, selfApproved: decision === 'approve' && clm.by === a.username ? 'yes' : '' }), SA);
  await audit(a, 'claim ' + (decision === 'approve' ? 'approved' : 'rejected'), clm.number, decision === 'approve' ? approved / 100 + (clm.by === a.username ? ' (own claim)' : '') : note);
  return { ok: true };
});
export const finPayClaim = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(CLMS, arg.id, e);
  const clm = normClaim(row);
  if (clm.status !== 'approved') throw new Error('claim_not_approved');
  const amount = arg.amount === undefined || arg.amount === '' || arg.amount === null ? null : toPaise(arg.amount);
  if (arg.amount !== undefined && arg.amount !== '' && arg.amount !== null && amount === null) throw new Error('bad_money');
  const f = payFields(arg, istToday());
  const out = await once(a, 'cpay', arg.key, async () => {
    let paidNow = 0;
    const r = await postRow(
      clm.id,
      (have) => {
        const st = claimState(clm, have);
        paidNow = amount === null ? st.balance : amount;
        if (paidNow <= 0 || paidNow > st.balance) throw new Error(st.balance <= 0 ? 'already_paid' : 'too_much');
      },
      (id) => base(a, e, f, { _id: id, type: 'expense', amount: String(paidNow), cat: (clm.lines[0] && clm.lines[0].cat) || 'Reimbursements', party: clm.payee, source: 'claim', sourceId: clm.id }),
    );
    if (f.mode === 'cash') await verifyCash(e, f.holder, r._id);
    return { id: r._id };
  });
  if (!out.again) await audit(a, 'claim paid', clm.number, (amount === null ? 'balance' : amount / 100) + ' ' + f.mode);
  return out;
});
export const finCancelClaim = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'claims');
  const e = await getEvent(arg.ev);
  const row = await getOf(CLMS, arg.id, e);
  if (a.role !== 'director' && row.by !== a.username) throw new Error('no_item');
  if (row.status === 'cancelled') throw new Error('already_cancelled');
  // The raiser can withdraw a claim only until it is decided. A director can cancel up to payment.
  if (a.role !== 'director' && row.status !== 'submitted') throw new Error('not_editable');
  const led = (await all(() => wixData.query(LED).eq('sourceId', row._id).ascending('_id'))).map(normLedger);
  if (led.some((r) => !r.void && r.type === 'expense')) throw new Error('has_payments');
  await wixData.update(CLMS, Object.assign({}, row, { status: 'cancelled', approved: '0' }), SA);
  await audit(a, 'claim cancelled', row.number, '');
  return { ok: true };
});

/* ---------- cash ---------- */
export const finCash = webMethod(Permissions.Anyone, async (arg) => {
  await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const L = await loadAll(e._id);
  const nos = docNumbers(L);
  const book = cashOut(cashBook(L.led));
  const moves = L.led.filter((r) => r.type === 'withdrawal' || r.type === 'deposit' || (r.mode === 'cash' && (r.type === 'expense' || r.type === 'income')));
  return { cash: book, entries: moves.sort((x, y) => byAtAsc(y, x)).slice(0, 500).map((r) => payOut(r, nos)) };
});
export const finAddCash = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const type = sOnly(arg.type);
  if (type !== 'withdrawal' && type !== 'deposit') throw new Error('bad_type');
  const amount = toPaise(arg.amount);
  if (amount === null) throw new Error('bad_money');
  const holder = cleanText(arg.holder, 40);
  if (holder.length < 2) throw new Error('holder_needed');
  const f = payFields(Object.assign({}, arg, { mode: 'cash', holder }), istToday());
  const out = await once(a, 'cash', arg.key, async () => {
    const row = await wixData.insert(LED, base(a, e, f, { type, amount: String(amount), cat: 'Cash', party: holder, mode: 'cash', holder }), SA);
    if (type === 'deposit') await verifyCash(e, holder, row._id);
    return { id: row._id };
  });
  if (!out.again) await audit(a, type === 'withdrawal' ? 'cash withdrawn' : 'cash put back', holder, amount / 100);
  return out;
});

/* ---------- the ledger ---------- */
export const finLedger = webMethod(Permissions.Anyone, async (arg) => {
  await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const L = await loadAll(e._id);
  const nos = docNumbers(L);
  const list = L.led.sort((x, y) => byAtAsc(y, x));
  return { rows: list.slice(0, 3000).map((r) => payOut(r, nos)), truncated: list.length > 3000, holders: cashBook(L.led).holders.map((h) => h.holder) };
});
// Income or an expense that does not belong to an invoice, an order or a claim (a small direct payment, a bank
// charge, a donation, anything else).
export const finAddEntry = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const type = sOnly(arg.type);
  if (type !== 'income' && type !== 'expense') throw new Error('bad_type');
  const amount = toPaise(arg.amount);
  if (amount === null) throw new Error('bad_money');
  const party = cleanText(arg.party, 80);
  if (party.length < 2) throw new Error('name_needed');
  const f = payFields(arg, istToday());
  const cat = cleanText(arg.cat, 40) || (type === 'income' ? 'Other income' : 'Other');
  const out = await once(a, 'entry', arg.key, async () => {
    const row = await wixData.insert(LED, base(a, e, f, { type, amount: String(amount), cat, party, source: 'manual' }), SA);
    if (type === 'expense' && f.mode === 'cash') await verifyCash(e, f.holder, row._id);
    return { id: row._id };
  });
  if (!out.again) await audit(a, type === 'income' ? 'income entered' : 'expense entered', party, amount / 100 + ' ' + f.mode);
  return out;
});
// A mistake is voided, not deleted: it stays in the list struck through, with who voided it and why.
export const finVoid = webMethod(Permissions.Anyone, async (arg) => {
  const a = await fauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const reason = cleanText(arg.reason, 160);
  if (reason.length < 3) throw new Error('reason_needed');
  const row = await getOf(LED, arg.id, e);
  if (row.void === 'yes') throw new Error('already_void');
  const led = (await rows(LED, e._id)).map(normLedger);
  const r = led.find((x) => x.id === row._id);
  // Taking back a withdrawal (or cash received) that has already been spent would leave the holder with less than nothing.
  if (r && (r.type === 'withdrawal' || (r.type === 'income' && r.mode === 'cash'))) {
    const after = led.map((x) => (x.id === r.id ? Object.assign({}, x, { void: true }) : x));
    const h = cashBook(after).holders.find((x) => holderKey(x.holder) === holderKey(r.holder));
    if (h && h.inHand < 0) throw new Error('cash_already_spent');
  }
  await wixData.update(LED, Object.assign({}, row, { void: 'yes', voidBy: a.username, voidAt: nowIso(), voidReason: reason }), SA);
  // Two voids made at the same moment could each look safe on their own. Checked again now that this one is in: if the
  // cash of that person would be below nothing, this void is taken back.
  if (r && (r.type === 'withdrawal' || (r.type === 'income' && r.mode === 'cash'))) {
    const now = (await rows(LED, e._id)).map(normLedger);
    const h2 = cashBook(now).holders.find((x) => holderKey(x.holder) === holderKey(r.holder));
    if (h2 && h2.inHand < 0) {
      await wixData.update(LED, row, SA);
      throw new Error('cash_already_spent');
    }
  }
  await audit(a, 'entry voided', row.type + ' ' + (row.sourceId || row._id), reason);
  return { ok: true };
});

/* ---------- collections ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  const def = (id, fields) => ({ _id: id, displayName: id, permissions: LOCKED, fields: fields.map(textField) });
  return [
    def(INVS, ['event', 'fy', 'seq', 'number', 'kind', 'party', 'partyAddr', 'partyGstin', 'partyEmail', 'date', 'due', 'lines', 'subtotal', 'tax', 'total', 'status', 'notes', 'org', 'sponsorId', 'by', 'at', 'cancelReason', 'cancelledBy', 'cancelledAt']),
    def(ORDS, ['event', 'fy', 'seq', 'number', 'vendor', 'vendorContact', 'title', 'cat', 'estimate', 'date', 'status', 'notes', 'by', 'at', 'cancelReason']),
    def(CLMS, ['event', 'fy', 'seq', 'number', 'payee', 'payTo', 'lines', 'total', 'approved', 'status', 'notes', 'by', 'byName', 'at', 'decidedBy', 'decidedAt', 'decisionNote', 'selfApproved']),
    def(LED, ['event', 'type', 'amount', 'tds', 'cat', 'party', 'mode', 'date', 'ref', 'note', 'phase', 'source', 'sourceId', 'holder', 'by', 'at', 'void', 'voidBy', 'voidAt', 'voidReason']),
    def(FSET, ['kind', 'by', 'at', 'ref', 'json']),
  ];
}
let checked = false;
// Creates the Finance collections the first time a director or lead uses Finance (only collections that are missing).
async function ensureCollections() {
  if (checked) return;
  const create = elevate(collections.createDataCollection);
  for (const d of collectionDefs()) {
    try {
      await wixData.query(d._id).limit(1).find(SA);
      continue;
    } catch (e) {
      // missing, so create it below
    }
    try {
      await create(d);
    } catch (e) {
      // it may already exist (created at the same moment by another request)
    }
  }
  checked = true;
}
