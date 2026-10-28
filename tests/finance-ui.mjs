// COMPONENT + INTEGRATION TESTS (screen): the Finance screen of the Director page, in jsdom, on the real backend code.
// A director raises invoices, takes payments, runs orders (estimate, advance, actual), decides and pays claims, handles
// cash and the ledger; a lead sees and raises only their own claims; a viewer has no Finance at all. Everything goes
// through the buttons and forms a person would use. Also: no HTML from a typed name ever becomes markup, spreadsheets
// cannot run a formula from an exported cell, a double click makes one record, a retry after an error reuses its key.
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as R from './racedir.test.mjs';
import * as F from './finance.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Finance: screens');
const SA = { suppressAuth: true };
const DB = global.__DB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync('../wix/director/director-embed.html', 'utf8');
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const TODAY = istDay(0);
const rows = (t) => [...(DB[t] || new Map()).values()];
const jserr = [];
const calls = [];

/* ---------- the world ---------- */
global.__COLS.add('Import910');
await R.ensureSetup({ key: 'k-test', username: 'owner', password: 'Owner-Pass-2026' });
const OT = (await R.login({ username: 'owner', password: 'Owner-Pass-2026' })).token;
const pw = { owner: 'Owner-Pass-2026' };
for (const [u, name, role] of [['dir.two', 'Director Two', 'director'], ['lead.one', 'Lead One', 'lead'], ['lead.two', 'Lead Two', 'lead'], ['view.one', 'Viewer One', 'viewer']]) {
  pw[u] = (await R.saveTeam({ token: OT, username: u, name, role })).secret;
}
const ev = (await R.saveEvent({ token: OT, name: 'VHM 5th edition', date: istDay(30), venue: 'RK Beach' })).event;
const ev2 = (await R.saveEvent({ token: OT, name: 'Ultribe Paderu', date: istDay(60), venue: 'Paderu' })).event;
const EV = ev.id;
await R.savePlanItem({ token: OT, ev: EV, kind: 'sponsor', title: 'Gold sponsor', party: 'Acme Pvt Ltd', amount: '100000', status: 'committed' });
const spRow = rows('RDPlan').find((r) => r.kind === 'sponsor');

/* ---------- a page, the way a browser would run it ---------- */
const blobs = [];
const downloads = [];
const printed = [];
function openPage() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jserr.push(e.message));
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const d = w.document;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = (b) => {
    blobs.push(b);
    return 'blob:test';
  };
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  Object.defineProperty(w.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      return { document: { open() {}, write(h) { printed.push(h); }, close() {} }, focus() {}, print() { printed.push('PRINT'); } };
    },
  });
  w.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.kind !== 'call') return;
    calls.push({ method: m.method, mod: m.mod || 'rd', arg: m.arg });
    const mod = m.mod === 'fin' ? F : R;
    try {
      const r = await mod[m.method](m.arg);
      w.postMessage({ kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) }, '*');
    } catch (x) {
      w.postMessage({ kind: 'result', id: m.id, ok: false, error: x.message }, '*');
    }
  });
  return { w, d };
}
const q = (d, s) => d.querySelector(s);
const qa = (d, s) => [...d.querySelectorAll(s)];
// the text a person reads: neighbouring elements are separated by a space (textContent would run them together)
const txt = (el) => {
  if (!el) return '';
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) out.push(n.nodeValue);
    else {
      for (const c of n.childNodes) walk(c);
      out.push(' ');
    }
  };
  walk(el);
  return out.join('').replace(/\s+/g, ' ').trim();
};
const set = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const change = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const until = async (fn, ms) => {
  const t = Date.now();
  while (Date.now() - t < (ms || 3000)) {
    try {
      if (fn()) return true;
    } catch (x) {
      // not there yet
    }
    await sleep(15);
  }
  return false;
};
const toastOf = (d) => txt(q(d, '#toast'));
const clearToast = (d) => {
  const t = q(d, '#toast');
  t.textContent = '';
  t.hidden = true;
};
// click something and wait until the condition holds
const go = async (P, el, cond) => {
  clearToast(P.d);
  click(P.w, el);
  return cond ? until(cond) : (await sleep(120), true);
};
const sendForm = async (P, form, cond) => {
  clearToast(P.d);
  submit(P.w, form);
  return cond ? until(cond) : (await sleep(120), true);
};
const fill = (P, form, vals) => {
  for (const [k, v] of Object.entries(vals)) {
    const el = form.elements[k];
    if (!el) throw new Error('no field ' + k);
    if (el.tagName === 'SELECT') change(P.w, el, v);
    else set(P.w, el, v);
  }
};
const login = async (user) => {
  const P = openPage();
  await sleep(40);
  set(P.w, q(P.d, '#lgUser'), user);
  set(P.w, q(P.d, '#lgPass'), pw[user]);
  submit(P.w, q(P.d, '#loginForm'));
  await until(() => q(P.d, '.tab'));
  return P;
};
const tabBtn = (d, t) => q(d, `[data-tab="${t}"]`);
// click something that loads data, and wait until the server has been asked and the answer drawn
const settle = async (P, el) => {
  const n = calls.length;
  clearToast(P.d);
  click(P.w, el);
  await until(() => calls.length > n);
  await sleep(120);
  await until(() => !/Loading\.\.\./.test(txt(q(P.d, '.content'))));
};
const sub = (P, id) => settle(P, q(P.d, `[data-act="fin-sub"][data-sub="${id}"]`));
const trs = (d) => qa(d, 'tr').filter((r) => r.querySelector('td'));
const rowWith = (d, t) => trs(d).find((r) => txt(r).includes(t));
const btnIn = (scope, act, attrs) => qa(scope, `[data-act="${act}"]` + Object.entries(attrs || {}).map(([k, v]) => `[${k}="${v}"]`).join(''))[0];
const FM = (n) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
const blobText = (w, b) =>
  new Promise((res) => {
    const r = new w.FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(b);
  });
const fin = (m) => calls.filter((c) => c.mod === 'fin' && (!m || c.method === m));

/* ---------- U1. who sees Finance ---------- */
const A = await login('owner');
{
  const { d } = A;
  const t = tabBtn(d, 'fin');
  ok(!!t && txt(t) === 'Finance', 'U1 a director has a Finance tab');
  ok(txt(q(d, '.side')).includes('Accounts'), 'U1 it sits in its own group in the side menu');
  await settle(A, t);
  const subs = qa(d, '[data-act="fin-sub"]').map(txt);
  eq(subs, ['Summary', 'Invoices', 'Orders', 'Claims', 'Cash', 'Ledger', 'Details'], 'U1 the director gets seven sections');
  ok(q(d, '[role="tablist"][aria-label="Finance sections"]') !== null, 'U1 the sections are a labelled tab list');
  ok(await until(() => /Income received/.test(txt(q(d, '#app')))), 'U1 the Summary opens first');
  const s = txt(q(d, '#app'));
  ok(/Paid out/.test(s) && /Net so far/.test(s) && /Projected result/.test(s) && /Cash in hand/.test(s) && /Invoices to collect/.test(s), 'U1 Summary shows its eight figures');
  ok(fin('finOverview').length === 1 && fin('finOverview')[0].arg.ev === EV, 'U1 Summary was asked for the selected race');
}
const mark = calls.length;
const L1 = await login('lead.one');
{
  const { d } = L1;
  const t = tabBtn(d, 'fin');
  ok(!!t && txt(t) === 'My claims', 'U1 a lead has "My claims", not Finance');
  await settle(L1, t);
  ok(qa(d, '[data-act="fin-sub"]').length === 0, 'U1 a lead has no Finance sections');
  ok(!!btnIn(d, 'fin-new', { 'data-k': 'clm-new' }), 'U1 a lead can start a claim');
  ok(calls.slice(mark).filter((c) => c.mod === 'fin').length > 0 && calls.slice(mark).filter((c) => c.mod === 'fin').every((c) => c.method === 'finListClaims'), 'U1 a lead screen only asks for claims');
}
const V1 = await login('view.one');
ok(!tabBtn(V1.d, 'fin'), 'U1 a viewer has no Finance tab');
ok(!/Finance|My claims/.test(txt(q(V1.d, '.side'))), 'U1 a viewer sees nothing about Finance in the menu');

/* ---------- U2. the details printed on invoices ---------- */
await sub(A, 'set');
{
  const { d } = A;
  const f = q(d, '#finSetForm');
  ok(!!f && f.elements.name.value === 'Visakha Trail Running Association' && f.elements.invPrefix.value === 'INV', 'U2 details start with the association name and INV');
  fill(A, f, { pan: 'ABC' });
  await sendForm(A, f, () => toastOf(d));
  ok(/PAN does not look right/.test(toastOf(d)), 'U2 a wrong PAN gets a plain message: ' + toastOf(d));
  fill(A, f, { pan: 'aaatv1234k', gstin: '37AAATV1234K1Z5', upi: 'vtra@okbank', invPrefix: 'vtra', signatory: 'V. Yogeshwar Rao', address: 'Siripuram, Visakhapatnam', bank: 'HDFC Bank, A/c 0000, IFSC HDFC0000001' });
  await sendForm(A, q(d, '#finSetForm'), () => /Details saved/.test(toastOf(d)));
  ok(/Details saved/.test(toastOf(d)), 'U2 good details are saved');
  const arg = fin('finSaveSettings').pop().arg;
  ok(arg.pan === 'aaatv1234k' && arg.invPrefix === 'vtra' && arg.upi === 'vtra@okbank', 'U2 the screen sent exactly what was typed');
  const row = rows('RDFinSet').find((r) => r._id === 'settings');
  const org = JSON.parse(row.json);
  eq([org.pan, org.invPrefix, org.gstin], ['AAATV1234K', 'VTRA', '37AAATV1234K1Z5'], 'U2 the server made PAN and prefix upper case');
}

/* ---------- U3. invoices ---------- */
await sub(A, 'inv');
let inv1;
let NO1;
{
  const { d, w } = A;
  ok(/No invoices yet/.test(txt(q(d, '.content'))), 'U3 an empty list says how to start');
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'inv-new' }), () => q(d, '#finForm'));
  let f = q(d, '#finForm');
  ok(f.getAttribute('data-kind') === 'inv-new', 'U3 the invoice form opens');
  const sel = f.elements.sponsorId;
  ok(!!sel && /Acme Pvt Ltd · ₹1,00,000/.test(txt(sel)), 'U3 sponsors from the plan can be picked, with their amount');
  change(w, sel, spRow._id);
  ok(f.elements.party.value === 'Acme Pvt Ltd', 'U3 picking a sponsor fills the name');
  const l1 = q(f, 'tr.fl');
  ok(l1.querySelector('.fl-d').value === 'Sponsorship: Acme Pvt Ltd' && l1.querySelector('.fl-r').value === '100000', 'U3 and the first line (description and amount)');
  ok(/Total ₹1,00,000/.test(txt(q(f, '#finTot'))), 'U3 the total is shown while typing');
  await go(A, btnIn(f, 'fin-lineAdd', { 'data-t': 'inv' }));
  const l2 = qa(f, 'tr.fl')[1];
  set(w, l2.querySelector('.fl-d'), 'Banner space');
  set(w, l2.querySelector('.fl-q'), '3');
  set(w, l2.querySelector('.fl-r'), '1500');
  set(w, l2.querySelector('.fl-t'), '18');
  eq(txt(q(f, '#finTot')), 'Subtotal ₹1,04,500 · Tax ₹810 · Total ₹1,05,310', 'U3 subtotal, tax and total are worked out on the screen');
  eq(txt(l2.querySelector('.fl-a')), '₹4,500', 'U3 each line shows its amount');
  await go(A, btnIn(l2, 'fin-lineDel'));
  ok(qa(f, 'tr.fl').length === 1 && /Total ₹1,00,000/.test(txt(q(f, '#finTot'))), 'U3 removing a line takes it out of the total');
  await go(A, btnIn(f, 'fin-lineDel'));
  ok(qa(f, 'tr.fl').length === 1 && q(f, 'tr.fl .fl-d').value === '' && q(f, 'tr.fl .fl-q').value === '1', 'U3 the last line is cleared, not removed');
  set(w, q(f, 'tr.fl .fl-d'), 'Sponsorship: Acme Pvt Ltd');
  set(w, q(f, 'tr.fl .fl-r'), '100000');
  await go(A, btnIn(f, 'fin-lineAdd', { 'data-t': 'inv' }));
  const l2b = qa(f, 'tr.fl')[1];
  set(w, l2b.querySelector('.fl-d'), 'Banner space');
  set(w, l2b.querySelector('.fl-q'), '3');
  set(w, l2b.querySelector('.fl-r'), '1500');
  set(w, l2b.querySelector('.fl-t'), '18');
  eq(txt(q(f, '#finTot')), 'Subtotal ₹1,04,500 · Tax ₹810 · Total ₹1,05,310', 'U3 the totals are the same again after re-adding the line');
  // a retry after an error uses the same key, and a double click makes one invoice
  const before = rows('RDInvoices').length;
  fill(A, f, { party: '<img src=x onerror="window.__pwn=1">Acme & Sons "Ltd"', partyEmail: 'bad email', partyGstin: '', partyAddr: 'Vizag', notes: 'Thank you' });
  await sendForm(A, f, () => toastOf(d));
  ok(/valid email/i.test(toastOf(d)) && rows('RDInvoices').length === before, 'U3 a bad email is refused with a plain message and nothing is saved: ' + toastOf(d));
  ok(q(d, '#finForm') === f && f.elements.party.value.startsWith('<img'), 'U3 the form stays open with everything typed');
  fill(A, f, { partyEmail: 'accounts@acme.example' });
  clearToast(d);
  submit(w, f);
  submit(w, f);
  submit(w, f);
  ok(await until(() => /Invoice .* raised/.test(toastOf(d))), 'U3 the invoice is raised: ' + toastOf(d));
  await sleep(150);
  eq(rows('RDInvoices').length - before, 1, 'U3 three quick clicks made one invoice');
  const sent = fin('finRaiseInvoice');
  ok(sent.length >= 2 && sent[0].arg.key === sent[1].arg.key && /^k[a-z0-9]{8,}$/.test(sent[0].arg.key), 'U3 the retry after the error carried the same request key: ' + sent.map((c) => c.arg.key).join(' / '));
  const row = rows('RDInvoices')[0];
  ok(/^VTRA\/\d{4}-\d{2}\/0001$/.test(row.number), 'U3 numbered from the saved prefix: ' + row.number);
  inv1 = row._id;
  NO1 = row.number;
  eq([row.total, row.tax, row.subtotal], ['10531000', '81000', '10450000'], 'U3 the stored amounts (in paise) match the screen');
  const sp = JSON.parse(row.org);
  ok(sp.name === 'Visakha Trail Running Association' && sp.pan === 'AAATV1234K', 'U3 the invoice keeps a copy of the details it was raised with');
  ok(row.sponsorId === spRow._id, 'U3 it is linked to the sponsor');
  // what is shown
  const r = rowWith(d, row.number);
  ok(!!r && /₹1,05,310/.test(txt(r)) && /Unpaid/.test(txt(r)), 'U3 the list shows the invoice, its total and "Unpaid"');
  ok(!q(d, 'img') && w.__pwn === undefined, 'U3 HTML typed as a name stays text: no picture was made and nothing ran');
  ok(txt(r).includes('<img src=x onerror="window.__pwn=1">Acme & Sons "Ltd"'), 'U3 the name is shown exactly as typed');
  ok(/Banner space/.test(txt(q(d, '.content'))) && /Siripuram|Vizag/.test(txt(q(d, '.content'))), 'U3 the opened row shows lines and address');
}
{
  // KPI cards
  const s = txt(q(A.d, '.content'));
  ok(/Invoiced ₹1,05,310/.test(s) && /To collect ₹1,05,310/.test(s) && /Overdue 0/.test(s), 'U3 the cards: invoiced, to collect, overdue');
}
// payments
{
  const { d, w } = A;
  const r = rowWith(d, NO1);
  await go(A, btnIn(r, 'fin-new', { 'data-k': 'inv-pay' }), () => q(d, '#finForm[data-kind="inv-pay"]'));
  let f = q(d, '#finForm');
  ok(f.elements.amount.value === '105310' && f.elements.tds.value === '0', 'U3 the payment form starts with the full balance');
  fill(A, f, { amount: '50000', tds: '5000', mode: 'bank', ref: 'UTR123' });
  await sendForm(A, f, () => /Payment recorded/.test(toastOf(d)));
  ok(/Payment recorded/.test(toastOf(d)), 'U3 a part payment with tax withheld is recorded');
  let row = rowWith(d, NO1);
  ok(/Part paid/.test(txt(row)) && /₹55,000/.test(txt(row)) && /₹50,310/.test(txt(row)), 'U3 status "Part paid", received 55,000 (with TDS), balance 50,310');
  const pay = rows('RDLedger').find((x) => x.sourceId === inv1);
  eq([pay.amount, pay.tds, pay.type, pay.mode], ['5000000', '500000', 'income', 'bank'], 'U3 stored as money 50,000 and TDS 5,000');
  // too much
  await go(A, btnIn(rowWith(d, NO1), 'fin-new', { 'data-k': 'inv-pay' }), () => q(d, '#finForm[data-kind="inv-pay"]'));
  f = q(d, '#finForm');
  fill(A, f, { amount: '60000', tds: '0' });
  await sendForm(A, f, () => toastOf(d));
  ok(/more than what is left/.test(toastOf(d)), 'U3 paying more than the balance is refused in plain words: ' + toastOf(d));
  fill(A, f, { amount: '50310' });
  await sendForm(A, f, () => /Payment recorded/.test(toastOf(d)));
  row = rowWith(d, NO1);
  ok(/Paid/.test(txt(row)) && !btnIn(row, 'fin-new', { 'data-k': 'inv-pay' }) && !btnIn(row, 'fin-cancel'), 'U3 fully paid: no more "Receive payment", no cancel');
  // void the last payment
  const v = qa(d, '[data-act="fin-void"]');
  ok(v.length === 2, 'U3 each payment has a Void button');
  await go(A, v[v.length - 1], () => q(d, '#finForm[data-kind="void"]'));
  f = q(d, '#finForm');
  ok(/Void payment on/.test(txt(f)) || /Void /.test(txt(f)), 'U3 voiding asks for a reason');
  fill(A, f, { reason: 'ab' });
  await sendForm(A, f, () => toastOf(d));
  ok(/short reason/.test(toastOf(d)), 'U3 a reason of two letters is refused: ' + toastOf(d));
  fill(A, f, { reason: 'Cheque bounced' });
  await sendForm(A, f, () => /Voided/.test(toastOf(d)));
  row = rowWith(d, NO1);
  ok(/Part paid/.test(txt(row)) && /₹50,310/.test(txt(row)), 'U3 after the void the invoice is part paid again with 50,310 to collect');
  const struck = qa(d, 'tr.strike');
  ok(struck.length === 1 && /voided by owner: Cheque bounced/.test(txt(struck[0])), 'U3 the voided payment stays, struck through, with who and why');
  eq(rows('RDLedger').filter((x) => x.sourceId === inv1).length, 2, 'U3 nothing was deleted: both payments are still stored');
}
// a second invoice, then cancel it
let inv2;
{
  const { d, w } = A;
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'inv-new' }), () => q(d, '#finForm[data-kind="inv-new"]'));
  const f = q(d, '#finForm');
  fill(A, f, { party: 'Zed Foods', invKind: 'partner' });
  const l1 = q(f, 'tr.fl');
  set(w, l1.querySelector('.fl-d'), 'Stall');
  set(w, l1.querySelector('.fl-r'), '2500.50');
  await sendForm(A, f, () => /Invoice .* raised/.test(toastOf(d)));
  const rs = rows('RDInvoices');
  eq(rs.length, 2, 'U3 a second invoice');
  const row2 = rs.find((r) => r.party === 'Zed Foods');
  inv2 = row2._id;
  ok(/\/0002$/.test(row2.number), 'U3 it takes the next number: ' + row2.number);
  eq([row2.total, row2.kind], ['250050', 'partner'], 'U3 amounts with paise are kept exactly');
  const r = rowWith(d, 'Zed Foods');
  await go(A, btnIn(r, 'fin-cancel', { 'data-what': 'invoice' }), () => q(d, '#finForm[data-kind="cancel"]'));
  const cf = q(d, '#finForm');
  fill(A, cf, { reason: 'Raised by mistake' });
  await sendForm(A, cf, () => /Invoice cancelled/.test(toastOf(d)));
  const r2 = rowWith(d, 'Zed Foods');
  ok(r2.classList.contains('strike') && /Cancelled/.test(txt(r2)), 'U3 a cancelled invoice stays in the list, struck through');
  ok(!btnIn(r2, 'fin-new', { 'data-k': 'inv-pay' }), 'U3 a cancelled invoice takes no payment');
  eq(rows('RDInvoices').length, 2, 'U3 cancelling does not delete');
}
// print and Word
{
  const { d, w } = A;
  const r = rowWith(d, NO1);
  await go(A, btnIn(r, 'fin-print-inv'), () => printed.length > 0);
  await sleep(300);
  const doc = printed.find((p) => p !== 'PRINT') || '';
  ok(/INVOICE/.test(doc) && /VTRA\/\d{4}-\d{2}\/0001/.test(doc), 'U3 Print makes an invoice page with its number');
  ok(doc.includes('&lt;img src=x onerror=&quot;window.__pwn=1&quot;&gt;Acme &amp; Sons &quot;Ltd&quot;') && !/<img/i.test(doc), 'U3 the printed page has the typed name as text, not as markup');
  ok(/Visakha Trail Running Association/.test(doc) && /AAATV1234K/.test(doc) && /37AAATV1234K1Z5/.test(doc) && /HDFC Bank/.test(doc) && /vtra@okbank/.test(doc), 'U3 it carries the details saved for the association, bank and UPI');
  ok(/One Lakh Five Thousand Three Hundred Ten Rupees Only|Rupees One Lakh/.test(doc), 'U3 the total is also written in words: ' + (doc.match(/Rupees[^<]*/) || [''])[0]);
  ok(/Received/.test(doc) && /Balance due/.test(doc) && /₹50,310/.test(doc), 'U3 it shows what was received and the balance due');
  ok(printed.includes('PRINT'), 'U3 the browser print dialog is asked for');
  const nb = blobs.length;
  await go(A, btnIn(rowWith(d, NO1), 'fin-word-inv'), () => blobs.length > nb);
  ok(blobs.length === nb + 1 && /^VTRA-\d{4}-\d{2}-0001\.doc$/.test(downloads[downloads.length - 1]), 'U3 Word downloads a .doc named after the invoice: ' + downloads[downloads.length - 1]);
  const t = await blobText(w, blobs[blobs.length - 1]);
  ok(blobs[blobs.length - 1].type === 'application/msword' && /<html/.test(t) && !/<img/i.test(t) && /Banner space/.test(t), 'U3 the Word file is the same page, with nothing active in it');
  const cancelled = trs(d).find((x) => /Zed Foods/.test(txt(x)));
  const nb2 = printed.length;
  await go(A, btnIn(cancelled, 'fin-print-inv'), () => printed.length > nb2);
  await sleep(300);
  ok(/CANCELLED/.test(printed.filter((p) => p !== 'PRINT').pop()), 'U3 a cancelled invoice prints with a CANCELLED stamp');
}

/* ---------- U4. orders: estimate, advance, actual ---------- */
await sub(A, 'ord');
let ord1;
{
  const { d, w } = A;
  ok(/No orders yet/.test(txt(q(d, '.content'))), 'U4 an empty list says what an order is for');
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'ord-new' }), () => q(d, '#finForm[data-kind="ord-new"]'));
  const f = q(d, '#finForm');
  ok(!!q(d, '#finCat') && qa(d, '#finCat option').length >= 10, 'U4 categories are suggested from the budget list');
  fill(A, f, { vendor: 'Medal Works', title: '1,000 finisher medals', cat: 'Awards', estimate: '50000', vendorContact: '98480 00000' });
  await sendForm(A, f, () => /Order PO\/.* created/.test(toastOf(d)));
  const o = rows('RDOrders')[0];
  ord1 = o._id;
  ok(/^PO\/\d{4}-\d{2}\/0001$/.test(o.number) && o.estimate === '5000000', 'U4 the order is numbered and the estimate stored in paise: ' + o.number);
  let r = rowWith(d, 'Medal Works');
  ok(/Estimate only/.test(txt(r)) && /₹50,000/.test(txt(r)) && /no bill yet/.test(txt(r)), 'U4 an order with no bill shows "Estimate only" and "no bill yet"');
  // advance
  await go(A, btnIn(r, 'fin-new', { 'data-k': 'ord-pay' }), () => q(d, '#finForm[data-kind="ord-pay"]'));
  let pf = q(d, '#finForm');
  ok(pf.elements.phase.value === 'advance', 'U4 the first payment is offered as an advance');
  fill(A, pf, { amount: '20000', mode: 'upi', ref: 'UPI-77' });
  await sendForm(A, pf, () => /Payment recorded/.test(toastOf(d)));
  r = rowWith(d, 'Medal Works');
  ok(/Advance paid/.test(txt(r)) && /₹20,000/.test(txt(r)) && /₹30,000/.test(txt(r)) && /est\./.test(txt(r)), 'U4 after the advance: advance 20,000, 30,000 left against the estimate');
  // the vendor's bill
  await go(A, btnIn(r, 'fin-new', { 'data-k': 'ord-bill' }), () => q(d, '#finForm[data-kind="ord-bill"]'));
  let bf = q(d, '#finForm');
  fill(A, bf, { amount: '45000', no: 'MW/221' });
  await sendForm(A, bf, () => /Bill added/.test(toastOf(d)));
  r = rowWith(d, 'Medal Works');
  ok(/Billed/.test(txt(r)) && /₹45,000/.test(txt(r)) && /₹25,000/.test(txt(r)) && /₹5,000 under/.test(txt(r)), 'U4 after the bill: actual 45,000, 25,000 to pay, ₹5,000 under the estimate');
  // too much, then the rest
  await go(A, btnIn(r, 'fin-new', { 'data-k': 'ord-pay' }), () => q(d, '#finForm[data-kind="ord-pay"]'));
  pf = q(d, '#finForm');
  ok(pf.elements.phase.value === 'payment' && pf.elements.amount.value === '25000', 'U4 once billed, the next payment is a payment and starts at the balance');
  fill(A, pf, { amount: '25001' });
  await sendForm(A, pf, () => toastOf(d));
  ok(/more than what is left/.test(toastOf(d)), 'U4 paying beyond the bill is refused: ' + toastOf(d));
  fill(A, pf, { amount: '25000', mode: 'cheque', ref: 'CHQ 0042' });
  await sendForm(A, pf, () => /Payment recorded/.test(toastOf(d)));
  r = rowWith(d, 'Medal Works');
  ok(/Settled/.test(txt(r)), 'U4 paid in full: "Settled"');
  // refund of part of it
  await go(A, btnIn(r, 'fin-new', { 'data-k': 'ord-refund' }), () => q(d, '#finForm[data-kind="ord-refund"]'));
  const rf = q(d, '#finForm');
  fill(A, rf, { amount: '1000', mode: 'bank' });
  await sendForm(A, rf, () => /Refund recorded/.test(toastOf(d)));
  r = rowWith(d, 'Medal Works');
  ok(/Billed/.test(txt(r)) && /₹1,000/.test(txt(r)), 'U4 a refund received brings 1,000 back to pay');
  // detail rows
  const det = txt(q(d, '.content'));
  ok(/Advance paid/.test(det) && /Bill MW\/221/.test(det) && /Refund received/.test(det), 'U4 the opened order lists the advance, the bill and the refund');
  ok(!btnIn(rowWith(d, 'Medal Works'), 'fin-cancel'), 'U4 an order with bills and payments cannot be cancelled');
  // totals row and cards
  ok(/Estimated ₹50,000/.test(txt(q(d, '.content'))) && /Billed \(actual\) ₹45,000/.test(txt(q(d, '.content'))) && /Paid so far ₹44,000/.test(txt(q(d, '.content'))), 'U4 the cards: estimated, billed, paid so far');
  // an order with nothing on it can be cancelled
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'ord-new' }), () => q(d, '#finForm[data-kind="ord-new"]'));
  fill(A, q(d, '#finForm'), { vendor: 'Flex Printers', title: 'Banners', estimate: '3000.75' });
  await sendForm(A, q(d, '#finForm'), () => /Order PO\/.* created/.test(toastOf(d)));
  eq(rows('RDOrders').find((x) => x.vendor === 'Flex Printers').estimate, '300075', 'U4 an estimate with paise is kept exactly');
  const fr = rowWith(d, 'Flex Printers');
  await go(A, btnIn(fr, 'fin-new', { 'data-k': 'ord-new', 'data-id': rows('RDOrders').find((x) => x.vendor === 'Flex Printers')._id }), () => q(d, '#finForm[data-kind="ord-new"]'));
  ok(q(d, '#finForm').elements.vendor.value === 'Flex Printers' && q(d, '#finForm').elements.estimate.value === '3000.75', 'U4 Edit opens the order with its values');
  fill(A, q(d, '#finForm'), { estimate: '3500' });
  await sendForm(A, q(d, '#finForm'), () => /Saved|created/.test(toastOf(d)));
  eq(rows('RDOrders').find((x) => x.vendor === 'Flex Printers').estimate, '350000', 'U4 the estimate was changed');
  await go(A, btnIn(rowWith(d, 'Flex Printers'), 'fin-cancel', { 'data-what': 'order' }), () => q(d, '#finForm[data-kind="cancel"]'));
  fill(A, q(d, '#finForm'), { reason: 'Not needed' });
  await sendForm(A, q(d, '#finForm'), () => /Order cancelled/.test(toastOf(d)));
  ok(rowWith(d, 'Flex Printers').classList.contains('strike') && /Cancelled/.test(txt(rowWith(d, 'Flex Printers'))), 'U4 a cancelled order stays, struck through');
}

/* ---------- U5. claims: a lead raises their own ---------- */
let c1;
{
  const { d, w } = L1;
  await settle(L1, tabBtn(d, 'fin'));
  ok(/You have not raised a claim/.test(txt(q(d, '.content'))), 'U5 an empty list tells a lead what to do');
  await go(L1, btnIn(d, 'fin-new', { 'data-k': 'clm-new' }), () => q(d, '#finForm[data-kind="clm-new"]'));
  let f = q(d, '#finForm');
  ok(f.elements.payee.value === 'Lead One', 'U5 "Pay to" starts as the lead\'s own name');
  const l1 = q(f, 'tr.cl');
  ok(l1.querySelector('.cl-dt').value === TODAY, 'U5 the date of a line starts as today');
  set(w, l1.querySelector('.cl-d'), 'Tea & snacks <b>for volunteers</b>');
  set(w, l1.querySelector('.cl-c'), 'Volunteers');
  set(w, l1.querySelector('.cl-a'), '600');
  set(w, l1.querySelector('.cl-b'), 'Bill 14');
  await go(L1, btnIn(f, 'fin-lineAdd', { 'data-t': 'clm' }));
  const l2 = qa(f, 'tr.cl')[1];
  set(w, l2.querySelector('.cl-d'), 'Route map printouts');
  set(w, l2.querySelector('.cl-a'), '250.50');
  ok(/Total ₹850.50/.test(txt(q(f, '#finTot'))), 'U5 the total follows the lines: ' + txt(q(f, '#finTot')));
  fill(L1, f, { payTo: 'lead1@upi', notes: 'Both for the expo' });
  // a line with a future date is refused with a plain message, and nothing is saved
  set(w, l2.querySelector('.cl-dt'), istDay(10));
  await sendForm(L1, f, () => toastOf(d));
  ok(/not allowed here|real date/.test(toastOf(d)) && rows('RDClaims').length === 0, 'U5 a line dated in the future is refused: ' + toastOf(d));
  set(w, l2.querySelector('.cl-dt'), TODAY);
  await sendForm(L1, f, () => /Claim sent/.test(toastOf(d)));
  ok(/Claim sent/.test(toastOf(d)), 'U5 the claim is sent');
  const c = rows('RDClaims')[0];
  c1 = c._id;
  ok(/^CLM\/\d{4}-\d{2}\/0001$/.test(c.number) && c.by === 'lead.one' && c.status === 'submitted' && c.total === '85050', 'U5 numbered, owned by the lead, waiting: ' + c.number);
  const r = rowWith(d, c.number);
  ok(/Waiting/.test(txt(r)) && /₹850.50/.test(txt(r)), 'U5 the list shows it as waiting');
  await go(L1, btnIn(r, 'fin-open'), () => /Route map printouts/.test(txt(q(d, '.content'))));
  ok(txt(q(d, '.content')).includes('Tea & snacks <b>for volunteers</b>') && !qa(d, 'b').some((b) => /for volunteers/.test(txt(b))), 'U5 a tag typed in a description is shown as text, not turned into markup');
  ok(!btnIn(d, 'fin-new', { 'data-k': 'clm-decide' }) && !btnIn(d, 'fin-new', { 'data-k': 'clm-pay' }) && qa(d, '[data-act="fin-void"]').length === 0, 'U5 a lead has no Decide, Pay or Void buttons');
  // edit while waiting
  await go(L1, btnIn(rowWith(d, c.number), 'fin-new', { 'data-k': 'clm-new' }), () => q(d, '#finForm[data-kind="clm-new"]'));
  f = q(d, '#finForm');
  ok(qa(f, 'tr.cl').length === 2 && qa(f, 'tr.cl')[1].querySelector('.cl-a').value === '250.5', 'U5 Edit opens the claim with its lines');
  set(w, qa(f, 'tr.cl')[1].querySelector('.cl-a'), '150');
  await sendForm(L1, f, () => /Claim changed/.test(toastOf(d)));
  eq(rows('RDClaims')[0].total, '75000', 'U5 the lines were changed: total 750');
  ok(/₹750/.test(txt(rowWith(d, c.number))), 'U5 the list shows the new total');
  // print the voucher
  const np = printed.length;
  await go(L1, btnIn(rowWith(d, c.number), 'fin-print-clm'), () => printed.length > np);
  await sleep(300);
  const v = printed.filter((p) => p !== 'PRINT').pop();
  ok(/Reimbursement voucher/.test(v) && /CLM\/\d{4}-\d{2}\/0001/.test(v) && /Tea &amp; snacks &lt;b&gt;for volunteers&lt;\/b&gt;/.test(v) && !/<b>for volunteers/.test(v), 'U5 the voucher shows the claim, with typed tags as text');
  ok(/Claimed by/.test(v) && /Approved by/.test(v) && /Received by/.test(v), 'U5 the voucher has the three signature lines');
}
// a second lead, and what each can see
let c2;
{
  const L2 = await login('lead.two');
  const { d, w } = L2;
  await settle(L2, tabBtn(d, 'fin'));
  ok(!/CLM\/\d{4}-\d{2}\/0001/.test(txt(q(d, '.content'))) && !/Lead One/.test(txt(q(d, '.content'))), 'U5 a second lead does not see the first lead\'s claim');
  await go(L2, btnIn(d, 'fin-new', { 'data-k': 'clm-new' }), () => q(d, '#finForm'));
  const f = q(d, '#finForm');
  const l1 = q(f, 'tr.cl');
  set(w, l1.querySelector('.cl-d'), 'Auto fare to the venue');
  set(w, l1.querySelector('.cl-a'), '300');
  await sendForm(L2, f, () => /Claim sent/.test(toastOf(d)));
  c2 = rows('RDClaims').find((x) => x.by === 'lead.two')._id;
  ok(trs(d).length === 1 && !/Tea/.test(txt(q(d, '.content'))), 'U5 the second lead sees only their own claim');
  // withdraw it (two clicks)
  const b = btnIn(rowWith(d, 'CLM/'), 'fin-cclaim');
  ok(!!b && txt(b) === 'Withdraw', 'U5 a lead can withdraw a waiting claim');
  click(w, b);
  await sleep(60);
  ok(txt(btnIn(d, 'fin-cclaim')) === 'Sure?', 'U5 withdrawing asks "Sure?" first');
  ok(rows('RDClaims').find((x) => x._id === c2).status === 'submitted', 'U5 the first click changed nothing');
  await go(L2, btnIn(d, 'fin-cclaim'), () => /withdrawn/.test(toastOf(d)));
  eq(rows('RDClaims').find((x) => x._id === c2).status, 'cancelled', 'U5 the second click withdrew it');
  // raise another to be decided by the director
  await go(L2, btnIn(d, 'fin-new', { 'data-k': 'clm-new' }), () => q(d, '#finForm'));
  const f2 = q(d, '#finForm');
  set(w, q(f2, 'tr.cl .cl-d'), 'Auto fare, second trip');
  set(w, q(f2, 'tr.cl .cl-a'), '300');
  await sendForm(L2, f2, () => /Claim sent/.test(toastOf(d)));
  c2 = rows('RDClaims').find((x) => x.by === 'lead.two' && x.status === 'submitted')._id;
  L2.w.close();
}

/* ---------- U6. the director decides and pays; cash ---------- */
await sub(A, 'clm');
{
  const { d, w } = A;
  const s = txt(q(d, '.content'));
  ok(/CLM\//.test(s) && /Lead One/.test(s) && /Lead Two/.test(s), 'U6 the director sees claims from both leads, with who raised them');
  ok(/Waiting for a decision 2/.test(s), 'U6 the card counts what is waiting');
  const r1 = rows('RDClaims').find((x) => x._id === c1);
  await go(A, btnIn(rowWith(d, r1.number), 'fin-new', { 'data-k': 'clm-decide' }), () => q(d, '#finForm[data-kind="clm-decide"]'));
  let f = q(d, '#finForm');
  ok(f.elements.approved.value === '750' && /Route map printouts/.test(txt(f)), 'U6 the decision form shows the lines and starts at the full amount');
  fill(A, f, { approved: '800' });
  await go(A, btnIn(f, 'fin-approve'), () => toastOf(d));
  ok(/amount/i.test(toastOf(d)) && rows('RDClaims').find((x) => x._id === c1).status === 'submitted', 'U6 approving for more than claimed is refused: ' + toastOf(d));
  fill(A, f, { approved: '700', note: 'Route maps trimmed' });
  await go(A, btnIn(f, 'fin-approve'), () => /Approved/.test(toastOf(d)));
  const row = rows('RDClaims').find((x) => x._id === c1);
  eq([row.status, row.approved, row.decidedBy], ['approved', '70000', 'owner'], 'U6 approved for 700 of 750');
  const lines = JSON.parse(row.lines);
  ok(lines.length === 2, 'U6 the claim keeps both lines');
  let r = rowWith(d, r1.number);
  ok(/Approved/.test(txt(r)) && /₹700/.test(txt(r)), 'U6 the list shows "Approved" and 700');
  ok(!/approved by the claimant/.test(txt(r)), 'U6 it was not the director\'s own claim');
  // reject the other one: a reason is needed
  const r2 = rows('RDClaims').find((x) => x._id === c2);
  await go(A, btnIn(rowWith(d, r2.number), 'fin-new', { 'data-k': 'clm-decide' }), () => q(d, '#finForm[data-kind="clm-decide"]'));
  f = q(d, '#finForm');
  await go(A, btnIn(f, 'fin-reject'), () => toastOf(d));
  ok(/short reason/.test(toastOf(d)) && rows('RDClaims').find((x) => x._id === c2).status === 'submitted', 'U6 rejecting without a reason is refused and changes nothing');
  fill(A, f, { note: 'Please attach the receipt' });
  await go(A, btnIn(f, 'fin-reject'), () => /Rejected/.test(toastOf(d)));
  const rj = rowWith(d, r2.number);
  ok(rj.classList.contains('strike') && /Rejected/.test(txt(rj)), 'U6 a rejected claim stays, struck through');
  eq(rows('RDClaims').find((x) => x._id === c2).decisionNote, 'Please attach the receipt', 'U6 the reason is stored');
}
// cash: pay a claim in cash only from cash somebody holds
{
  const { d, w } = A;
  const r1 = rows('RDClaims').find((x) => x._id === c1);
  await go(A, btnIn(rowWith(d, r1.number), 'fin-new', { 'data-k': 'clm-pay' }), () => q(d, '#finForm[data-kind="clm-pay"]'));
  let f = q(d, '#finForm');
  ok(f.elements.amount.value === '700', 'U6 the payment starts at what is left to pay');
  fill(A, f, { amount: '400', mode: 'cash', holder: '' });
  await sendForm(A, f, () => toastOf(d));
  ok(/name of the person holding the cash/.test(toastOf(d)), 'U6 a cash payment needs the holder: ' + toastOf(d));
  fill(A, f, { holder: 'Ravi' });
  await sendForm(A, f, () => toastOf(d));
  ok(/does not hold that much cash/.test(toastOf(d)) && rows('RDLedger').filter((x) => x.mode === 'cash').length === 0, 'U6 cash nobody holds cannot be spent, and nothing is left behind: ' + toastOf(d));
  // take cash from the bank (Cash section)
  await sub(A, 'cash');
  ok(/No cash recorded yet/.test(txt(q(d, '.content'))), 'U6 the cash screen starts empty');
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'cash', 'data-t': 'withdrawal' }), () => q(d, '#finForm[data-kind="cash"]'));
  f = q(d, '#finForm');
  ok(f.elements.type.value === 'withdrawal', 'U6 "Take cash from the bank" opens as a withdrawal');
  fill(A, f, { holder: 'Ravi', amount: '5000', ref: 'Slip 12' });
  await sendForm(A, f, () => /Saved/.test(toastOf(d)));
  let s = txt(q(d, '.content'));
  ok(/Cash in hand ₹5,000/.test(s) && /Ravi/.test(s), 'U6 Ravi now holds 5,000');
  // pay the claim in cash and the rest by UPI
  await sub(A, 'clm');
  await go(A, btnIn(rowWith(d, r1.number), 'fin-new', { 'data-k': 'clm-pay' }), () => q(d, '#finForm[data-kind="clm-pay"]'));
  f = q(d, '#finForm');
  fill(A, f, { amount: '400', mode: 'cash', holder: 'ravi' });
  await sendForm(A, f, () => /Payment recorded/.test(toastOf(d)));
  let r = rowWith(d, r1.number);
  ok(/Part paid/.test(txt(r)) && /₹400/.test(txt(r)) && /₹300/.test(txt(r)), 'U6 paid 400 in cash: part paid, 300 to pay (Ravi\'s name matched without case)');
  await go(A, btnIn(r, 'fin-new', { 'data-k': 'clm-pay' }), () => q(d, '#finForm[data-kind="clm-pay"]'));
  f = q(d, '#finForm');
  ok(f.elements.amount.value === '300', 'U6 the next payment starts at 300');
  fill(A, f, { mode: 'upi', ref: 'UPI-9' });
  await sendForm(A, f, () => /Payment recorded/.test(toastOf(d)));
  r = rowWith(d, r1.number);
  ok(/Paid/.test(txt(r)) && !btnIn(r, 'fin-new', { 'data-k': 'clm-pay' }) && !btnIn(r, 'fin-cclaim'), 'U6 paid in full: no Pay, no Cancel');
  // the cash left: 4,600; spending 6,000 is refused; voiding the withdrawal that was spent from is refused
  await sub(A, 'cash');
  ok(/₹4,600/.test(txt(q(d, '.content'))), 'U6 4,600 is left in Ravi\'s hands');
  const w1 = rows('RDLedger').find((x) => x.type === 'withdrawal');
  await go(A, qa(d, '[data-act="fin-void"]').find((b) => /cash entry of ₹5,000/.test(b.getAttribute('data-label'))), () => q(d, '#finForm[data-kind="void"]'));
  fill(A, q(d, '#finForm'), { reason: 'Wrong person' });
  await sendForm(A, q(d, '#finForm'), () => toastOf(d));
  ok(/already been spent/.test(toastOf(d)) && rows('RDLedger').find((x) => x._id === w1._id).void !== 'yes', 'U6 a withdrawal that was spent from cannot be voided: ' + toastOf(d));
  // put 1,000 back
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'cash', 'data-t': 'deposit' }), () => q(d, '#finForm[data-kind="cash"]'));
  ok(q(d, '#finForm').elements.type.value === 'deposit', 'U6 "Put cash back" opens as a deposit');
  fill(A, q(d, '#finForm'), { holder: 'Ravi', amount: '1000' });
  await sendForm(A, q(d, '#finForm'), () => /Saved/.test(toastOf(d)));
  ok(/Cash in hand ₹3,600/.test(txt(q(d, '.content'))), 'U6 after putting 1,000 back, 3,600 is in hand');
  // keep what was typed when the kind is switched
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'cash', 'data-t': 'withdrawal' }), () => q(d, '#finForm'));
  fill(A, q(d, '#finForm'), { holder: 'Sunil', amount: '250', note: 'for tea' });
  change(w, q(d, '#finForm').elements.type, 'deposit');
  await sleep(60);
  const nf = q(d, '#finForm');
  ok(nf.elements.holder.value === 'Sunil' && nf.elements.amount.value === '250' && nf.elements.note.value === 'for tea' && nf.elements.type.value === 'deposit', 'U6 switching the kind keeps what was typed');
  await go(A, btnIn(nf, 'fin-cancelForm'), () => !q(d, '#finForm'));
  ok(!q(d, '#finForm'), 'U6 Cancel closes the form');
}
// the director's own claim carries a flag
{
  const { d, w } = A;
  await sub(A, 'clm');
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'clm-new' }), () => q(d, '#finForm[data-kind="clm-new"]'));
  const f = q(d, '#finForm');
  set(w, q(f, 'tr.cl .cl-d'), 'Courier charges');
  set(w, q(f, 'tr.cl .cl-a'), '120');
  await sendForm(A, f, () => /Claim sent/.test(toastOf(d)));
  const own = rows('RDClaims').find((x) => x.by === 'owner');
  await go(A, btnIn(rowWith(d, own.number), 'fin-new', { 'data-k': 'clm-decide' }), () => q(d, '#finForm[data-kind="clm-decide"]'));
  ok(/This is your own claim/.test(txt(q(d, '#finForm'))), 'U6 the decision form says it is the director\'s own claim');
  await go(A, btnIn(q(d, '#finForm'), 'fin-approve'), () => /Approved/.test(toastOf(d)));
  ok(/approved by the claimant/.test(txt(rowWith(d, own.number))) && rows('RDClaims').find((x) => x._id === own._id).selfApproved === 'yes', 'U6 approving your own claim is flagged "approved by the claimant"');
}

/* ---------- U7. the ledger ---------- */
await sub(A, 'led');
{
  const { d, w } = A;
  const total = rows('RDLedger').length;
  ok(trs(d).length === total, 'U7 the ledger lists every entry (' + total + ')');
  // add income with a formula-looking name, and a payment made
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'entry', 'data-t': 'income' }), () => q(d, '#finForm[data-kind="entry"]'));
  let f = q(d, '#finForm');
  ok(f.elements.type.value === 'income', 'U7 "Add money received" opens as income');
  fill(A, f, { party: '=HYPERLINK("http://evil.example","click")', cat: 'Donations', amount: '1000', mode: 'bank', ref: '+91 98765 43210' });
  await sendForm(A, f, () => /Saved/.test(toastOf(d)));
  await go(A, btnIn(d, 'fin-new', { 'data-k': 'entry', 'data-t': 'expense' }), () => q(d, '#finForm[data-kind="entry"]'));
  f = q(d, '#finForm');
  ok(f.elements.type.value === 'expense', 'U7 "Add a payment made" opens as an expense');
  fill(A, f, { party: 'Bank charges', cat: 'Admin', amount: '118', mode: 'bank' });
  await sendForm(A, f, () => /Saved/.test(toastOf(d)));
  ok(trs(d).length === total + 2, 'U7 both entries appear');
  // filter and search
  change(w, q(d, '#finLf'), 'income');
  await sleep(60);
  ok(trs(d).every((r) => /Money in/.test(txt(r))) && trs(d).length >= 3, 'U7 "Money in" shows only money in: ' + trs(d).length + ' rows');
  change(w, q(d, '#finLf'), 'all');
  await sleep(40);
  set(w, q(d, '#finQ'), 'bank charges');
  await sleep(80);
  ok(trs(d).length === 1 && /Bank charges/.test(txt(trs(d)[0])), 'U7 search narrows to one entry');
  ok(document_active(d) === 'finQ', 'U7 typing in the search box keeps the cursor in it');
  set(w, q(d, '#finQ'), 'nothing like this');
  await sleep(80);
  ok(/Nothing matches/.test(txt(q(d, '.content'))), 'U7 a search with no match says so');
  set(w, q(d, '#finQ'), '');
  await sleep(60);
  // CSV
  const nb = blobs.length;
  await go(A, btnIn(d, 'fin-csv-led'), () => blobs.length > nb);
  const csv = await blobText(w, blobs[blobs.length - 1]);
  const lines = csv.split('\n');
  ok(downloads[downloads.length - 1] === 'ledger.csv' && lines[0].startsWith('Date,Kind,Party'), 'U7 the CSV has a header and a sensible name');
  ok(csv.includes('"\'=HYPERLINK(""http://evil.example"",""click"")"'), 'U7 a name that starts with = gets a leading quote so a spreadsheet will not run it');
  ok(csv.includes(',+91 98765 43210,') || csv.includes('+91 98765 43210'), 'U7 a phone-like reference is left alone');
  ok(!/\n=/.test(csv) && !lines.some((l) => /^[=+@-]/.test(l)), 'U7 no line starts with a formula character');
  // void an entry with a reason
  const bc = rowWith(d, 'Bank charges');
  set(w, q(d, '#finQ'), 'bank charges');
  await sleep(80);
  await go(A, btnIn(rowWith(d, 'Bank charges'), 'fin-void'), () => q(d, '#finForm[data-kind="void"]'));
  fill(A, q(d, '#finForm'), { reason: 'Duplicate entry' });
  await sendForm(A, q(d, '#finForm'), () => /Voided/.test(toastOf(d)));
  ok(/voided by owner: Duplicate entry/.test(txt(rowWith(d, 'Bank charges'))) && rowWith(d, 'Bank charges').classList.contains('strike'), 'U7 a voided entry stays, struck through, with who and why');
  set(w, q(d, '#finQ'), '');
  await sleep(60);
  change(w, q(d, '#finLf'), 'void');
  await sleep(60);
  ok(trs(d).length >= 2 && trs(d).every((r) => r.classList.contains('strike')), 'U7 "Voided entries" lists the voided ones (' + trs(d).length + ')');
}

/* ---------- U8. the summary agrees with the figures ---------- */
await sub(A, 'sum');
{
  const { d } = A;
  const S = (await F.finOverview({ token: OT, ev: EV })).summary;
  const s = txt(q(d, '.content'));
  ok(s.includes('Income received ' + FM(S.income.total)), 'U8 income received on screen = backend: ' + FM(S.income.total));
  ok(s.includes('Paid out ' + FM(S.expenses.paid)), 'U8 paid out on screen = backend: ' + FM(S.expenses.paid));
  ok(s.includes('Cash in hand ' + FM(S.cash.inHand)), 'U8 cash in hand on screen = backend: ' + FM(S.cash.inHand));
  ok(s.includes('Invoices to collect ' + FM(S.income.outstanding)), 'U8 invoices to collect = backend: ' + FM(S.income.outstanding));
  // independent recount from the stored rows
  const led = rows('RDLedger').filter((r) => r.event === EV && r.void !== 'yes');
  const sumP = (f) => led.filter(f).reduce((a, r) => a + parseInt(r.amount, 10), 0);
  const moneyIn = sumP((r) => r.type === 'income' && r.phase !== 'refund');
  const moneyOut = sumP((r) => r.type === 'expense');
  const refunds = sumP((r) => r.type === 'income' && r.phase === 'refund');
  ok(S.expenses.paid === (moneyOut - refunds) / 100, 'U8 paid out = all payments less refunds, recounted from the stored rows: ' + (moneyOut - refunds) / 100);
  ok(Math.round(S.income.received * 100) + Math.round(S.income.other * 100) === moneyIn, 'U8 income received + other income = all money in, recounted from the stored rows');
  eq(S.orders.billed, 45000, 'U8 the order bill counts as actual cost');
  ok(/Medal Works|Awards/.test(s) || /Costs by category/.test(s), 'U8 costs by category are listed');
  const nb = blobs.length;
  await go(A, btnIn(d, 'fin-csv-sum'), () => blobs.length > nb);
  const csv = await blobText(A.w, blobs[blobs.length - 1]);
  ok(csv.startsWith('Category,Budget,Ordered (estimates),Actual cost') && /Awards,/.test(csv), 'U8 the costs-by-category CSV downloads');
}

/* ---------- U9. privacy between people and between races ---------- */
{
  // lead one logs out and lead two logs in on the same page object: nothing of the first remains
  const P = await login('lead.one');
  await settle(P, tabBtn(P.d, 'fin'));
  ok(/₹700/.test(txt(q(P.d, '.content'))) && /Paid/.test(txt(q(P.d, '.content'))), 'U9 the lead sees their own claim as paid, with 700 approved');
  ok(!/Lead Two|Courier|Auto fare/.test(txt(q(P.d, '.content'))), 'U9 and nobody else\'s');
  const lc = fin('finListClaims').pop();
  ok(lc.mod === 'fin' && lc.arg.token && lc.arg.ev === EV, 'U9 the screen asks as the logged-in person for the selected race');
  await go(P, btnIn(P.d, 'logout'), () => q(P.d, '#loginForm'));
  ok(!!q(P.d, '#loginForm') && !/CLM\/|₹/.test(txt(q(P.d, '#app'))), 'U9 after logout nothing of the claims is left on the page');
  set(P.w, q(P.d, '#lgUser'), 'lead.two');
  set(P.w, q(P.d, '#lgPass'), pw['lead.two']);
  submit(P.w, q(P.d, '#loginForm'));
  await until(() => q(P.d, '.tab'));
  await settle(P, tabBtn(P.d, 'fin'));
  ok(!/Tea|₹700|Lead One/.test(txt(q(P.d, '.content'))), 'U9 the next person to log in on the same page sees none of the first person\'s claims');
  ok(/Rejected/.test(txt(q(P.d, '.content'))) && /Cancelled/.test(txt(q(P.d, '.content'))) && trs(P.d).length === 2, 'U9 lead two sees their own two claims: the rejected one and the withdrawn one');
  P.w.close();
}
{
  // a second race has its own money
  const { d, w } = A;
  await sub(A, 'inv');
  ok(trs(d).length >= 2, 'U9 race one has its invoices');
  const sel = q(d, '#evPick');
  ok(!!sel, 'U9 with two races there is a race picker');
  change(w, sel, ev2.id);
  await until(() => /No invoices yet/.test(txt(q(d, '.content'))));
  ok(/No invoices yet/.test(txt(q(d, '.content'))), 'U9 switching to the second race shows none of the first race\'s invoices');
  ok(fin('finListInvoices').pop().arg.ev === ev2.id, 'U9 the invoices were asked for the second race');
  await sub(A, 'sum');
  ok(/Income received ₹0/.test(txt(q(d, '.content'))), 'U9 and the second race\'s summary is empty');
  change(w, q(d, '#evPick'), EV);
  await until(() => /Income received ₹/.test(txt(q(d, '.content'))) && !/Income received ₹0/.test(txt(q(d, '.content'))));
  ok(!/Income received ₹0/.test(txt(q(d, '.content'))), 'U9 and back to the first race its figures return');
}

/* ---------- U10. the second director and error messages ---------- */
{
  const D2 = await login('dir.two');
  const { d } = D2;
  await settle(D2, tabBtn(d, 'fin'));
  ok(qa(d, '[data-act="fin-sub"]').length === 7, 'U10 a second director has the same seven sections');
  await sub(D2, 'clm');
  ok(trs(d).length >= 3, 'U10 and sees every claim');
  ok(/Lead One/.test(txt(q(d, '.content'))), 'U10 with who raised them');
  D2.w.close();
}
{
  // every message the finance screens can show is a sentence, never a bare code
  const src = html;
  const codes = ['bad_money', 'bad_fdate', 'bad_lines', 'bad_gstin', 'bad_pan', 'bad_upi', 'bad_prefix', 'bad_mode', 'bad_pay_phase', 'bad_type', 'bad_decision', 'bad_key', 'no_such_sponsor', 'holder_needed', 'reason_needed', 'too_much', 'not_enough_cash', 'cash_already_spent', 'already_void', 'already_cancelled', 'already_paid', 'has_payments', 'has_activity', 'invoice_cancelled', 'order_cancelled', 'estimate_below_paid', 'not_editable', 'not_open', 'claim_not_approved', 'below_paid', 'busy_try_again'];
  ok(codes.every((c) => new RegExp('\\b' + c + ":'").test(src)), 'U10 every finance error code has a plain-words message in the page: ' + codes.filter((c) => !new RegExp('\\b' + c + ":'").test(src)).join(','));
  // the codes that other screens already used keep their own words
  ok(/not_approved:'This volunteer is not approved yet\.'/.test(src) && /bad_phase:'Pick a valid group\.'/.test(src) && /no_sponsor:'Choose a sponsor from the plan\.'/.test(src), 'U10 messages used by older screens were not overwritten');
}

/* ---------- U11. the viewer cannot get at Finance by any route ---------- */
{
  const { d, w } = V1;
  ok(!tabBtn(d, 'fin') && qa(d, '[data-act^="fin-"]').length === 0, 'U11 a viewer has no Finance buttons');
  const v = await (async () => {
    try {
      return await F.finOverview({ token: (await R.login({ username: 'view.one', password: pw['view.one'] })).token, ev: EV });
    } catch (x) {
      return { error: x.message };
    }
  })();
  eq(v.error, 'not_allowed', 'U11 and the server refuses the viewer who asks directly');
}

ok(jserr.length === 0, 'no JavaScript error on any screen: ' + jserr.slice(0, 3).join(' | '));
for (const P of [A, L1, V1]) P.w.close();
done();

function document_active(d) {
  return d.activeElement && d.activeElement.id;
}
