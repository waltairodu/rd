// backend/rd-comms.js
// Messages to runners and volunteers: templates and their {placeholders}, the people a message goes to, the e-mail as Wix wants it, the
// WhatsApp link and the CSV file. No database and no Wix in here, so every rule can be tested on its own.
//
// What a runner (or a template) typed never becomes markup: a message is plain text, with no angle brackets, no control or
// direction-changing characters and no line breaks in a subject. A phone number only ever becomes digits in a https://wa.me/ address,
// and a cell of a CSV file can never start a formula.
import { T, cleanText, lc, catKey, bibCmp, fmtTime, P } from './rd-results.js';
import { fill, ordinal, longDate } from './rd-print.js';

/* ---------- limits ---------- */
export const MAX_RCP = 5000; // people in one batch
export const MEM_CHUNK = 500; // ids in one stored list
export const SEND_CHUNK = 25; // people one send call may handle
export const LINK_CHUNK = 25; // WhatsApp links in one page
export const MARK_CHUNK = 50; // people marked as messaged in one call
export const EXPORT_CHUNK = 1000; // rows of an export in one page
export const MAX_TEMPLATES = 40;
export const MAX_SUBJECT = 120;
export const MAX_BODY = 4000;
export const MAX_PARA = 1200;
export const MAX_WA = 1000;
export const DEFAULT_NVARS = 6;
export const MAX_NVARS = 12;
export const DEFAULT_CC = '91';
export const DASH = '\u2013'; // what stands in for a value that is not known
export const NBSP = '\u00a0'; // what stands in for a paragraph that is not used

/* ---------- plain text ---------- */
// A lone half of an emoji cannot be written into an address or a file: it is dropped.
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Characters that hide or reverse text, none of which a message needs (the joiners that Telugu and emoji need stay).
const HIDDEN = /[\u200b\u200e\u200f\u2060\ufeff]/g;
// Cuts at n characters without splitting an emoji in two.
export function safeCut(s, n) {
  const t = T(s);
  if (t.length <= n) return t;
  const c = t.charCodeAt(n - 1);
  return t.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}
// One line: control and direction characters gone, no angle brackets, cut to n.
export const oneLine = (v, n) => safeCut(cleanText(T(v).replace(LONE, '').replace(HIDDEN, ''), 10000).replace(/[<>]/g, '').trim(), n || 200);
// Several lines (the body of a message): lines kept, runs of blank lines and spaces cut, no angle brackets, cut to n.
export function cleanBody(v, n) {
  const s = T(v)
    .replace(LONE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(HIDDEN, '')
    .replace(/[<>]/g, '');
  const out = [];
  s.split('\n').forEach((l) => {
    const t = l.replace(/[ \t]+/g, ' ').trim();
    if (t || (out.length && out[out.length - 1])) out.push(t);
  });
  while (out.length && !out[out.length - 1]) out.pop();
  return safeCut(out.join('\n'), n || MAX_BODY).trim();
}

/* ---------- e-mail addresses and phone numbers ---------- */
// One plain address in lower case, or ''. A list of addresses, a name with the address, a quote, a bracket or a space is not one.
const EMAIL_RE = /^[a-z0-9._%+-]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
export function cleanEmail(v) {
  const s = lc(v);
  if (!s || s.length > 120 || s.includes('..') || s.startsWith('.') || s.includes('.@')) return '';
  return EMAIL_RE.test(s) ? s : '';
}
// A country code: one to three digits, not starting with 0.
export const okCc = (v) => typeof v === 'string' && /^[1-9]\d{0,2}$/.test(v);
// The number as WhatsApp wants it: digits only, country code first, no plus. A ten digit number gets the country code; a number
// written with 0 or 00 in front is cleaned; anything that cannot be a mobile number (under 11 digits with its country code) gives ''. With the code 91 (India) a number
// must be a mobile one (it starts with 6 to 9).
export function waNumber(raw, cc) {
  let d = T(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  const c = okCc(cc) ? cc : DEFAULT_CC;
  if (d.length === 10) d = c + d;
  if (d.length < 11 || d.length > 15 || d.startsWith('0')) return '';
  if (c === '91' && d.startsWith('91') && d.length === 12 && !/^91[6-9]\d{9}$/.test(d)) return '';
  if (/^(\d)\1+$/.test(d)) return '';
  return d;
}
// The address of a chat with a message ready in it. '' when the number is not one.
export function waLink(number, text) {
  if (!/^[1-9]\d{10,14}$/.test(T(number))) return '';
  try {
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(T(text).replace(LONE, ''));
  } catch (e) {
    return '';
  }
}
// A link to put in a message: https, a host, a short address, nothing that could end a line or a quote.
const LINK_RE = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{2,5})?(\/[A-Za-z0-9._~\-/%+=@:,;!*()&?#]*)?$/i;
export function cleanLink(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length <= 200 && LINK_RE.test(s) ? s : '';
}

/* ---------- placeholders ---------- */
export const VARS = {
  runner: ['name', 'firstname', 'bib', 'bibname', 'cat', 'size', 'wave', 'start', 'corral', 'time', 'place', 'race', 'date', 'venue', 'link'],
  volunteer: ['name', 'firstname', 'race', 'date', 'venue', 'link'],
};
export const KINDS = ['runner', 'volunteer'];
const WAVE_VARS = ['wave', 'start', 'corral'];
const RESULT_VARS = ['time', 'place'];
const PH = /\{([A-Za-z][A-Za-z0-9_]{0,19})\}/g;
// The names of the placeholders a text uses (lower case, each once).
export function usedVars(text) {
  const out = [];
  T(text).replace(PH, (all, k) => {
    const n = k.toLowerCase();
    if (!out.includes(n)) out.push(n);
    return all;
  });
  return out;
}
// What a template needs read before it can be filled: the waves, the results, the race link.
export function needsOf(tpl) {
  const used = usedVars(T(tpl && tpl.subject) + '\n' + T(tpl && tpl.body));
  return { used, waves: used.some((u) => WAVE_VARS.includes(u)), results: used.some((u) => RESULT_VARS.includes(u)), link: used.includes('link') };
}
// Placeholders a template uses that its kind does not have.
export const unknownVars = (tpl, kind) => needsOf(tpl).used.filter((u) => !(VARS[kind] || []).includes(u));

// The first name, for "Hello {firstname}". A name typed all in capitals is written with a capital for each word.
export function properName(name) {
  const n = oneLine(name, 80);
  if (n && n === n.toUpperCase() && n !== n.toLowerCase()) return n.toLowerCase().replace(/(^|[\s'-])([a-z\u00c0-\u024f])/g, (m, a, b) => a + b.toUpperCase());
  return n;
}
export const firstName = (name) => properName(name).split(/\s+/)[0] || '';

// Every value a placeholder can take, as plain one-line text; DASH where it is not known.
//   who:  { name, bib, bibName, cat, size, wave, start, corral, time, place } (all optional)
//   race: { name, date, venue, link }
export function varsFor(who, race) {
  const w = who && typeof who === 'object' ? who : {};
  const r = race && typeof race === 'object' ? race : {};
  const v = (x, n) => oneLine(x, n || 120) || DASH;
  const name = properName(w.name);
  return {
    name: name || DASH,
    firstname: firstName(w.name) || DASH,
    bib: v(w.bib, 12),
    bibname: v(w.bibName, 40),
    cat: v(w.cat, 60),
    size: v(w.size, 12),
    wave: v(w.wave, 30),
    start: v(w.start, 12),
    corral: v(w.corral, 12),
    time: v(w.time, 20),
    place: v(w.place, 12),
    race: v(r.name, 80),
    date: v(longDate(r.date) || r.date, 40),
    venue: v(r.venue, 120),
    link: cleanLink(r.link) || DASH,
  };
}

/* ---------- starter templates ---------- */
// Each says only what the registration, the waves and the results tell. The director edits and saves them, or writes new ones.
export const STARTERS = [
  { id: 'bib', kind: 'runner', name: 'Your bib', subject: 'Your bib for {race}: {bib}', body: 'Hello {firstname},\n\nYour bib number for {race} is {bib}.\n\nCategory: {cat}\nT-shirt size: {size}\nRace day: {date}\nVenue: {venue}\n\nSee you at the start line!' },
  { id: 'kit', kind: 'runner', name: 'Race kit collection', subject: 'Your race kit for {race}', body: 'Hello {firstname},\n\nYour race kit for {race} (bib {bib}, T-shirt size {size}) is ready for you to collect.\n\nCollection details: {link}' },
  { id: 'raceweek', kind: 'runner', name: 'Race week information', subject: '{race}: your start details', body: 'Hello {firstname},\n\n{race} is on {date} at {venue}.\n\nYour bib: {bib} ({cat})\nWave: {wave}\nStart time: {start}\nCorral: {corral}\n\nFull race information: {link}' },
  { id: 'thanks', kind: 'runner', name: 'Thank you and results', subject: 'Thank you for running {race}', body: 'Hello {firstname},\n\nThank you for running {race}!\n\nYour time: {time}\nPlace in {cat}: {place}\n\nFull results: {link}' },
  { id: 'volunteer', kind: 'volunteer', name: 'Volunteer reminder', subject: 'Thank you for volunteering at {race}', body: 'Hello {firstname},\n\nThank you for volunteering at {race} on {date} at {venue}.\n\nYour shift details and any updates: {link}' },
];

/* ---------- a template ---------- */
const bad = () => new Error('bad_template');
const TPL_ID = /^[a-z0-9][a-z0-9_-]{1,39}$/i;
export const okTplId = (v) => typeof v === 'string' && TPL_ID.test(v);
// A template as typed: { name, kind, subject, body, archived }. Throws 'bad_template', or 'unknown_placeholder' when it uses a
// {name} that its kind does not have (a typo would otherwise go out to everyone).
export function cleanTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  if (typeof raw.name !== 'string' || typeof raw.subject !== 'string' || typeof raw.body !== 'string') throw bad();
  if (typeof raw.kind !== 'string' || !KINDS.includes(raw.kind)) throw bad();
  if (raw.archived !== undefined && typeof raw.archived !== 'boolean') throw bad();
  const name = oneLine(raw.name, 60);
  const subject = oneLine(raw.subject, MAX_SUBJECT);
  const body = cleanBody(raw.body, MAX_BODY);
  if (!name || !subject || !body) throw bad();
  if (raw.subject.length > MAX_SUBJECT * 4 || raw.body.length > MAX_BODY * 3) throw bad();
  const t = { name, kind: raw.kind, subject, body, archived: raw.archived === true };
  if (unknownVars(t, t.kind).length) throw new Error('unknown_placeholder');
  return t;
}
// A stored template back into the same shape, whatever the row holds. null when it is not one.
export function templateOf(stored, parse) {
  const o = parse(stored, null);
  try {
    return cleanTemplate(o);
  } catch (e) {
    return null;
  }
}

/* ---------- settings ---------- */
export const SETTINGS_DEFAULT = { emailId: '', nvars: DEFAULT_NVARS, cc: DEFAULT_CC };
const EMAIL_ID = /^[A-Za-z0-9_-]{1,80}$/;
// The site-wide settings as typed. Throws 'bad_settings'.
export function cleanSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad_settings');
  const out = {};
  if (raw.emailId === undefined) out.emailId = '';
  else if (typeof raw.emailId === 'string' && (raw.emailId.trim() === '' || EMAIL_ID.test(raw.emailId.trim()))) out.emailId = raw.emailId.trim();
  else throw new Error('bad_settings');
  const n = raw.nvars === undefined ? DEFAULT_NVARS : typeof raw.nvars === 'string' && /^\d{1,2}$/.test(raw.nvars.trim()) ? parseInt(raw.nvars, 10) : raw.nvars;
  if (!Number.isInteger(n) || n < 1 || n > MAX_NVARS) throw new Error('bad_settings');
  out.nvars = n;
  if (raw.cc === undefined || raw.cc === '') out.cc = DEFAULT_CC;
  else if (okCc(raw.cc)) out.cc = raw.cc;
  else throw new Error('bad_settings');
  return out;
}
export function settingsOf(stored, parse) {
  try {
    return cleanSettings(parse(stored, {}));
  } catch (e) {
    return Object.assign({}, SETTINGS_DEFAULT);
  }
}
// The link of a race (where {link} points): '' (none) or a https address. Throws 'bad_settings'.
export function cleanRaceLink(v) {
  if (v === undefined || v === null || v === '') return '';
  const l = cleanLink(v);
  if (!l) throw new Error('bad_settings');
  return l;
}

/* ---------- the message of one person ---------- */
// The message as Wix sends it: a subject and up to nvars paragraphs (a blank line starts a new paragraph; more paragraphs than the e-mail
// has places for are joined into the last one). variables is what is handed to the Wix e-mail: subject, p1 ... pN.
export function buildMessage(tpl, vars, nvars) {
  const n = Number.isInteger(nvars) && nvars >= 1 && nvars <= MAX_NVARS ? nvars : DEFAULT_NVARS;
  const subject = oneLine(fill(T(tpl && tpl.subject), vars), MAX_SUBJECT + 60);
  const text = cleanBody(fill(T(tpl && tpl.body), vars), MAX_BODY + 1000);
  let paras = text ? text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];
  let joined = 0;
  if (paras.length > n) {
    joined = paras.length - n;
    paras = paras.slice(0, n - 1).concat([paras.slice(n - 1).join('\n\n')]);
  }
  let cut = false;
  paras = paras.map((p) => {
    if (p.length > MAX_PARA) cut = true;
    return safeCut(p, MAX_PARA);
  });
  const variables = { subject };
  for (let i = 1; i <= n; i++) variables['p' + i] = paras[i - 1] || NBSP;
  return { subject, paras, variables, joined, cut };
}
// The same message for a chat: the subject in bold, then the text, at most MAX_WA characters.
export function waText(msg) {
  const subject = T(msg && msg.subject).replace(/\*/g, '');
  const body = (msg && Array.isArray(msg.paras) ? msg.paras : []).join('\n\n');
  const all = subject ? '*' + subject + '*\n\n' + body : body;
  if (all.length <= MAX_WA) return { text: all, cut: false };
  const head = safeCut(all, MAX_WA - 1);
  const at = head.lastIndexOf(' ');
  return { text: (at > MAX_WA * 0.6 ? head.slice(0, at) : head).trimEnd() + '\u2026', cut: true };
}

/* ---------- who a message goes to ---------- */
const PAY = ['paid', 'unpaid', 'all'];
const HAS = ['any', 'has', 'none'];
const RES = ['any', 'fin', 'dnf', 'dns', 'dsq', 'none'];
const VSTAT = ['any', 'applied', 'approved', 'reserve', 'declined'];
const WAIVER = ['any', 'signed', 'unsigned'];
const AUD_KEYS = ['who', 'pay', 'cat', 'bib', 'result', 'wave', 'vstatus', 'waiver', 'notSent', 'uncertain'];
const RUNNER_KEYS = ['pay', 'cat', 'bib', 'result', 'wave'];
const abad = () => new Error('bad_audience');
// An audience as typed. ctx: { cats: the categories of the race, tpls: the ids of the templates that exist }. Throws 'bad_audience'.
export function cleanAud(raw, ctx) {
  const c = ctx || {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw abad();
  for (const k of Object.keys(raw)) if (!AUD_KEYS.includes(k)) throw abad();
  if (raw.who !== 'runners' && raw.who !== 'volunteers') throw abad();
  const pickOf = (v, list, d) => {
    if (v === undefined) return d;
    if (typeof v !== 'string' || !list.includes(v)) throw abad();
    return v;
  };
  const out = { who: raw.who };
  if (raw.who === 'runners') {
    if (raw.vstatus !== undefined) throw abad();
    out.pay = pickOf(raw.pay, PAY, 'paid');
    let cat = '';
    if (raw.cat !== undefined && raw.cat !== '') {
      if (typeof raw.cat !== 'string') throw abad();
      cat = (Array.isArray(c.cats) ? c.cats : []).find((x) => catKey(x) === catKey(raw.cat)) || '';
      if (!cat) throw abad();
    }
    out.cat = cat;
    out.bib = pickOf(raw.bib, HAS, 'any');
    out.result = pickOf(raw.result, RES, 'any');
    out.wave = pickOf(raw.wave, HAS, 'any');
  } else {
    if (RUNNER_KEYS.some((k) => raw[k] !== undefined)) throw abad();
    out.vstatus = pickOf(raw.vstatus, VSTAT, 'any');
  }
  // Whether the person has signed the waiver (only a choice other than 'any' is kept, so an audience without one reads as before).
  const wv = pickOf(raw.waiver, WAIVER, 'any');
  if (wv !== 'any') out.waiver = wv;
  let ns = '';
  if (raw.notSent !== undefined && raw.notSent !== '') {
    if (!okTplId(raw.notSent) || !(Array.isArray(c.tpls) ? c.tpls : []).includes(raw.notSent)) throw abad();
    ns = raw.notSent;
  }
  out.notSent = ns;
  if (raw.uncertain !== undefined && typeof raw.uncertain !== 'boolean') throw abad();
  out.uncertain = raw.uncertain === true;
  return out;
}
// The audience in words, for the screen and the log (names of categories and templates only, nobody's details).
export function audLabel(aud, tplName) {
  if (!aud || typeof aud !== 'object') return '';
  const a = aud;
  const parts = [];
  if (a.who === 'volunteers') {
    parts.push('Volunteers');
    if (a.vstatus && a.vstatus !== 'any') parts.push(a.vstatus);
  } else {
    parts.push('Runners');
    parts.push(a.pay === 'all' ? 'paid and unpaid' : a.pay === 'unpaid' ? 'not paid' : 'paid');
    if (a.cat) parts.push(oneLine(a.cat, 60));
    if (a.bib === 'has') parts.push('with a bib');
    if (a.bib === 'none') parts.push('without a bib');
    if (a.result && a.result !== 'any') parts.push(a.result === 'none' ? 'no result yet' : 'result: ' + a.result);
    if (a.wave === 'has') parts.push('in a wave');
    if (a.wave === 'none') parts.push('not in a wave');
  }
  if (a.waiver === 'signed') parts.push('waiver signed');
  if (a.waiver === 'unsigned') parts.push('waiver not signed');
  if (a.notSent) parts.push('not yet sent "' + oneLine(tplName || a.notSent, 60) + '"');
  return parts.join(' \u00b7 ');
}
// The order a batch is sent in: bib order, those without a bib after them by name.
export const byPerson = (a0, b0) => {
  const a = a0 && typeof a0 === 'object' ? a0 : {};
  const b = b0 && typeof b0 === 'object' ? b0 : {};
  return bibCmp(T(a.bib) || '~', T(b.bib) || '~') || T(a.name).localeCompare(T(b.name)) || T(a.id).localeCompare(T(b.id));
};
// The people an audience picks out of everybody. people: [{ id, name, bib, cat, paid, status, wave, vstatus, ... }]; sent is the set
// of ids that have had this template already (only used when the audience asks for those who have not).
export function pickAudience(people, aud, sent) {
  const s = sent instanceof Set ? sent : new Set();
  return (Array.isArray(people) ? people : [])
    .filter((p) => {
      // a person whose waiver is not known is in neither list (the caller reads the waivers whenever an audience asks)
      if ((aud.waiver === 'signed' || aud.waiver === 'unsigned') && p.waiver !== aud.waiver) return false;
      if (aud.who === 'runners') {
        if (aud.pay === 'paid' && !p.paid) return false;
        if (aud.pay === 'unpaid' && p.paid) return false;
        if (aud.cat && catKey(p.cat) !== catKey(aud.cat)) return false;
        if (aud.bib === 'has' && !p.bib) return false;
        if (aud.bib === 'none' && p.bib) return false;
        if (aud.result === 'none' && p.status) return false;
        if (aud.result !== 'any' && aud.result !== 'none' && p.status !== aud.result) return false;
        if (aud.wave === 'has' && !p.wave) return false;
        if (aud.wave === 'none' && p.wave) return false;
      } else if (aud.vstatus !== 'any' && p.vstatus !== aud.vstatus) return false;
      return !(aud.notSent && s.has(p.id));
    })
    .sort(byPerson);
}
// What a person is reached by. 'email' needs one plain address; 'whatsapp' needs a number WhatsApp can open.
export const reachedBy = (p, via, cc) => (p && typeof p === 'object' ? (via === 'whatsapp' ? !!waNumber(p.phone, cc) : !!cleanEmail(p.email)) : false);
// A list cut into pieces of at most size.
export function pieces(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ---------- the send log ---------- */
export const STATUSES = ['sending', 'sent', 'failed', 'skipped'];
// Why something failed, safe to keep in the log: no address, no long number, no markup, 80 characters.
export function whyOf(e) {
  const m = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : typeof e === 'string' ? e : '';
  return oneLine(m, 300)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[address]')
    .replace(/\d{6,}/g, '#')
    .replace(/[&"'`]/g, '')
    .slice(0, 80);
}
// What a time and place read as in a message.
export const resultVars = (row) => (row && row.status === 'fin' ? { time: fmtTime(P(row.t)), place: ordinal(row.place) } : { time: '', place: '' });

/* ---------- a file of rows ---------- */
// One cell of a CSV file: text, quoted. A cell that would start a formula in a spreadsheet (= + - @ or a tab or a return in front)
// gets a ' in front, and line breaks become spaces.
export function csvCell(v) {
  let s = T(v).replace(LONE, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
// Lines of cells, each line ended with a return and a line feed ('' when there are none).
export const csvLines = (rows) => (Array.isArray(rows) && rows.length ? rows.map((r) => (Array.isArray(r) ? r : []).map(csvCell).join(',')).join('\r\n') + '\r\n' : '');
export const toCsv = (head, rows) => csvLines([Array.isArray(head) ? head : []].concat(Array.isArray(rows) ? rows : []));
export const EXPORT_COLS = ['name', 'bib', 'cat', 'size', 'email', 'phone', 'wave', 'start', 'corral'];
export const EXPORT_HEAD = { name: 'Name', bib: 'Bib', cat: 'Category', size: 'T-shirt size', email: 'E-mail', phone: 'Phone', wave: 'Wave', start: 'Start', corral: 'Corral' };
// The columns of an export as typed: a list of known column names, each once, at least one. Throws 'bad_columns'.
export function cleanCols(v) {
  if (v === undefined) return ['name', 'bib', 'cat', 'email'];
  if (!Array.isArray(v) || !v.length || v.length > EXPORT_COLS.length) throw new Error('bad_columns');
  const out = [];
  for (const c of v) {
    if (typeof c !== 'string' || !EXPORT_COLS.includes(c) || out.includes(c)) throw new Error('bad_columns');
    out.push(c);
  }
  return out;
}
