// backend/rd-privacy.js
// Privacy rules for RaceOS, as plain functions: how a phone number and an e-mail address are hidden, who may see one in full, what a
// "show" has to say, what a contact export holds, and what is left of a person who asks to be erased. No database and no Wix in here, so
// every rule can be tested on its own.
//
// The idea: a list of people never carries a full phone number or e-mail address. It carries a mask (the last four digits of a number, the
// first letter of an address). Seeing one in full is a "show" of one person's one detail, with a reason, written in the audit trail, for
// directors and leads. A file with all the contact details is for directors, with a reason, and is written in the audit trail too.
// Erasing a person keeps the row (its bib, ticket and category, so that the counts and the money still add up) and empties everything
// that says who the person is.
import { T, cleanText, lc } from './rd-results.js';
import { csvLines, toCsv } from './rd-comms.js';

export const BULLET = '•';
const DOTS = BULLET.repeat(6);
const THREE = BULLET.repeat(3);

/* ---------- masks ---------- */
export const digitsOf = (v) => T(v).replace(/\D/g, '');
export const last10 = (v) => digitsOf(v).slice(-10);
// '98480 12345' -> '••••••2345'. Fewer than seven digits is not a phone number: nothing of it is shown. Nothing at all -> ''.
export function maskPhone(v) {
  const d = digitsOf(v);
  if (!d) return '';
  return DOTS + (d.length >= 7 ? d.slice(-4) : '');
}
// The first character of a word, when it is a plain letter or digit; anything else (a sign that could start a formula, a tag) is hidden too.
const first = (s) => {
  const c = Array.from(T(s))[0] || '';
  return /^[A-Za-z0-9]$/.test(c) ? c.toLowerCase() : BULLET;
};
// 'rahul.k@gmail.com' -> 'r•••@g•••.com'. Something that is not an address is hidden whole. Nothing at all -> ''.
export function maskEmail(v) {
  const s = T(v).trim();
  if (!s) return '';
  const at = s.lastIndexOf('@');
  if (at < 1 || at > s.length - 2) return DOTS;
  const dom = s.slice(at + 1);
  const dot = dom.lastIndexOf('.');
  const tld = dot > 0 ? dom.slice(dot) : '';
  return first(s.slice(0, at)) + THREE + '@' + first(dom) + THREE + (/^\.[A-Za-z]{2,12}$/.test(tld) ? tld.toLowerCase() : '');
}
// An example answer from a registration form (shown while the team picks which field is which): an address or a number is masked,
// anything else (a size, a name for the bib) is shown as it is.
export function maskSample(v) {
  const s = T(v);
  if (s.indexOf('@') > 0) return maskEmail(s);
  if (digitsOf(s).length >= 7) return maskPhone(s);
  return s;
}

/* ---------- who may do what ---------- */
export const MAY = { reveal: ['director', 'lead'], export: ['director'], log: ['director'], erase: ['director'] };
export const may = (role, what) => typeof role === 'string' && typeof what === 'string' && Object.prototype.hasOwnProperty.call(MAY, what) && MAY[what].includes(role);

/* ---------- showing one detail ---------- */
export const KINDS = ['reg', 'vol', 'pacer'];
export const FIELDS_OF = { reg: ['phone', 'email'], vol: ['phone', 'email'], pacer: ['phone'] };
export const REASONS = [
  ['contact', 'To contact them about the race'],
  ['fix', 'To check or correct their details'],
  ['pay', 'A payment or refund question'],
  ['safety', 'Safety or an emergency'],
  ['other', 'Another reason'],
];
export const reasonOf = (v) => (typeof v === 'string' && REASONS.some((r) => r[0] === v) ? v : '');
export const REVEALS_PER_HOUR = 40;
export const SHOW_MS = 30000; // how long the screen keeps a shown detail
// What was asked, checked: { kind, id, field, reason }. Throws 'pv_bad_request' or 'pv_need_reason'.
export function revealRequest(arg) {
  const a = arg && typeof arg === 'object' ? arg : {};
  if (typeof a.kind !== 'string' || !Object.prototype.hasOwnProperty.call(FIELDS_OF, a.kind)) throw new Error('pv_bad_request');
  if (typeof a.field !== 'string' || !FIELDS_OF[a.kind].includes(a.field)) throw new Error('pv_bad_request');
  if (typeof a.id !== 'string' || !a.id || a.id.length > 150) throw new Error('pv_bad_request');
  const reason = reasonOf(a.reason);
  if (!reason) throw new Error('pv_need_reason');
  return { kind: a.kind, id: a.id, field: a.field, reason };
}
// The audit trail words for a show. The detail holds the kind and the id of the row (never the number or the address) and the reason.
export const revealAction = (field) => (field === 'email' ? 'reveal e-mail' : 'reveal phone');
export const revealDetail = (kind, id, reason) => cleanText(kind + ' ' + id + ' · ' + reason, 200);
// The kind, id and reason in a detail written by revealDetail; null for anything else.
export function revealTarget(detail) {
  const m = /^(reg|vol|pacer) (\S{1,150}) · (contact|fix|pay|safety|other)$/.exec(T(detail));
  return m ? { kind: m[1], id: m[2], reason: m[3] } : null;
}

/* ---------- a file with the contact details ---------- */
export const EXPORT_PAGE = 1000;
export const EXPORTS = {
  regs: { title: 'Registrations', head: ['Name', 'Ticket', 'Category', 'T-shirt size', 'Bib', 'Bib name', 'Payment', 'Phone', 'E-mail'] },
  vols: { title: 'Volunteers', head: ['Name', 'Club', 'Status', 'Phone', 'E-mail'] },
  pacers: { title: 'Pacers', head: ['Name', 'Pace group', 'Status', 'Phone'] },
};
export const exportKindOf = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPORTS, v) ? v : '');
// What was asked, checked: { kind, reason, from }. Throws 'pv_bad_request' or 'pv_need_reason'.
export function exportRequest(arg) {
  const a = arg && typeof arg === 'object' ? arg : {};
  const kind = exportKindOf(a.kind);
  if (!kind) throw new Error('pv_bad_request');
  const reason = reasonOf(a.reason);
  if (!reason) throw new Error('pv_need_reason');
  let from = 0;
  if (a.from !== undefined) {
    if (typeof a.from !== 'number' || !Number.isInteger(a.from) || a.from < 0 || a.from > 1000000) throw new Error('pv_bad_request');
    from = a.from;
  }
  return { kind, reason, from };
}
// A row of the file for one stored row. A row of an erased person has nothing to give and is left out (null).
export function exportCells(kind, r) {
  if (!r || typeof r !== 'object' || isErased(r)) return null;
  if (kind === 'regs') return [r.name, r.ticketNumber, r.cat, r.size, r.bib, r.bibName, r.status === 'unpaid' ? 'pending' : 'paid', r.phone, r.email];
  if (kind === 'vols') return [r.name, r.club, r.status, r.phone, r.email];
  if (kind === 'pacers') return [r.name, r.group, r.status, r.phone];
  return null;
}
// The rows of the file (erased people left out) in a steady order, and one page of them as CSV text (the heading on the first page only).
export function exportRows(kind, list) {
  const rows = (Array.isArray(list) ? list : []).map((r) => exportCells(kind, r)).filter(Boolean);
  return rows.sort((a, b) => T(a[0]).localeCompare(T(b[0])) || T(a[1]).localeCompare(T(b[1])));
}
export function exportPage(kind, rows, from) {
  const part = rows.slice(from, from + EXPORT_PAGE);
  return { csv: from === 0 ? toCsv(EXPORTS[kind].head, part) : csvLines(part), count: part.length, from, next: from + part.length < rows.length ? from + part.length : null, total: rows.length };
}
export const exportName = (race, kind) => {
  const slug = (s) => T(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return [slug(race), slug(kind), 'with-contacts'].filter(Boolean).join('-') + '.csv';
};

/* ---------- the trail ---------- */
// The audit trail notes that are about contact details (the privacy screen lists these and no others).
export const LOG_ACTIONS = ['reveal phone', 'reveal e-mail', 'contacts exported', 'audience exported', 'WhatsApp links opened', 'person erased'];
export const LOG_ROWS = 100;
export function logOut(r) {
  const a = r && typeof r === 'object' ? r : {};
  return { at: cleanText(a.at, 40), by: cleanText(a.by, 60), action: cleanText(a.action, 40), race: cleanText(a.target, 60), detail: cleanText(a.detail, 200) };
}

/* ---------- erasing a person ---------- */
export const ERASED = '(erased)';
export const isErased = (r) => !!r && typeof r === 'object' && r.name === ERASED;
export const CONFIRM_WORD = 'ERASE';
export const MAX_PLAN = 200;
export const PEOPLE = {
  reg: ['registration', 'registrations'],
  runner: ['Expo runner', 'Expo runners'],
  vol: ['volunteer', 'volunteers'],
  pacer: ['pacer', 'pacers'],
  athlete: ['training account', 'training accounts'],
};
export const PLAN_KINDS = Object.keys(PEOPLE);
// '2 registrations, 1 volunteer' ('nothing' when there is nothing).
export function summaryText(counts) {
  const c = counts && typeof counts === 'object' ? counts : {};
  const bits = PLAN_KINDS.filter((k) => Number(c[k]) > 0).map((k) => Number(c[k]) + ' ' + PEOPLE[k][Number(c[k]) === 1 ? 0 : 1]);
  return bits.length ? bits.join(', ') : 'nothing';
}
// Who is being looked for: { phone, email } (the last ten digits; a lower-case address), at least one. Throws 'pv_bad_person'.
// A short number or a half address would match people who are not meant.
export function personKeys(arg) {
  const a = arg && typeof arg === 'object' ? arg : {};
  const phone = digitsOf(a.phone);
  const email = lc(T(a.email));
  if (!phone && !email) throw new Error('pv_bad_person');
  if (phone && phone.length < 10) throw new Error('pv_bad_person');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('pv_bad_person');
  return { phone: phone.slice(-10), email };
}
// Whether a stored row is this person: the same number (last ten digits) or the same address (any case).
export function isPerson(row, keys) {
  if (!row || typeof row !== 'object' || !keys) return false;
  if (keys.phone && last10(row.phone) === keys.phone) return true;
  return !!keys.email && lc(T(row.email)) === keys.email;
}
// What the screen is shown for one row that would be erased. The details are masked; a name is shown, as it is in every list.
export function planItem(kind, row, race) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    key: kind + '~' + T(r._id),
    kind,
    race: cleanText(race, 80),
    name: cleanText(r.name, 80),
    bib: kind === 'reg' || kind === 'runner' ? cleanText(r.bib, 20) : '',
    phone: maskPhone(r.phone),
    email: maskEmail(r.email),
  };
}
// The keys the director ticked: a list of 1 to MAX_PLAN keys, each once. Throws 'pv_bad_request'.
export function keysOf(v) {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PLAN) throw new Error('pv_bad_request');
  const out = [];
  for (const k of v) {
    if (typeof k !== 'string' || k.length > 170 || !/^(reg|runner|vol|pacer|athlete)~[^\s].*$/.test(k) || out.includes(k)) throw new Error('pv_bad_request');
    out.push(k);
  }
  return out;
}
export const splitKey = (k) => {
  const i = T(k).indexOf('~');
  return { kind: T(k).slice(0, i), id: T(k).slice(i + 1) };
};
// What is left of a row once its person is erased: the same row without anything that says who the person is. Nothing that counts
// (a bib, a ticket, a category, a size, the times of a hand-over) is touched. An unknown kind changes nothing.
const PATCH = {
  reg: { name: ERASED, email: '', phone: '', bibName: '', form: '' },
  runner: { name: ERASED, bibName: '', phone: '', email: '' },
  // a volunteer's code is replaced with text that a typed code (always upper case) can never equal, so no one can use it to reach the row
  vol: { name: ERASED, phone: '', email: '', club: '', notes: '', code: ERASED },
  pacer: { name: ERASED, phone: '', notes: '' },
  // an athlete signs in with a phone number (digits) and a PIN; text that digits can never equal keeps the account out of every sign-in
  athlete: { name: ERASED, phone: ERASED, salt: '', pinHash: '', goal: '', goalDate: '' },
  check: { name: '', friendName: '', friendPhone: '', selfie: '' },
  qual: { name: ERASED, link: '', note: '' },
  waiver: { why: '' },
  enroll: { reqNote: '' },
  session: { aNote: '', feedback: '' },
  msg: { name: '', text: '' },
};
export const ERASE_KINDS = Object.keys(PATCH);
export function erasedRow(kind, row) {
  if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(PATCH, kind)) return row;
  return Object.assign({}, row, PATCH[kind]);
}
// END rd-privacy.js
