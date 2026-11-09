// backend/rd-waiver.js
// The rules behind waivers. No database and no Wix in here, so every rule can be tested on its own.
//
// A waiver text belongs to one race and is VERSIONED: a save never changes an older version, it makes the next one, so what a
// runner agreed to can always be shown. Who has signed comes from two places: the answer to ONE question of the registration form
// (the director says which question and which answers count) and the records a director or lead keeps for papers signed on the
// day. A volunteer's sign-up page records its own waiver, and a paper signed by a volunteer who was added by staff is recorded the
// same way as a runner's. A record is never deleted: a mistake is voided, with a reason, and both stay.
//
// Everything a person typed (the waiver text, a note) and everything a runner typed (a name) goes into a page through esc().
// A waiver paper carries a name, a bib and a category and nothing else: no phone number, e-mail address or date of birth.
import { T, cleanText, lc, catKey, bibKey, parseJson, formAnswers } from './rd-results.js';
import { oneLine, cleanBody, byPerson } from './rd-comms.js';
import { esc, fill, longDate, docHead, DOC_FOOT, pageOf } from './rd-print.js';

export const MAX_TITLE = 80;
export const MAX_TEXT = 8000;
export const MIN_TEXT = 20;
export const MAX_VERSIONS = 60;
export const MAX_NOTE = 100;
export const MAX_PER_PERSON = 9; // records of one person (voided ones count)
export const MAX_ACCEPT = 12;
export const MAX_ANSWER = 60;
export const MAX_QUESTION = 100;
export const MAX_IDS = 100; // people recorded by one call
export const LIST_PAGE = 100; // people on one page of the list
export const CHUNK_FORMS = 30; // forms (a page each) in one call
export const CHUNK_LIST = 120; // lines of a sign-in list in one call
export const MAX_COPIES = 50;
export const WHO = ['runners', 'volunteers'];
export const FILTERS = ['todo', 'none', 'older', 'signed', 'all']; // todo: has not signed the version that counts (none and older)
export const MODES = ['forms', 'list'];
export const SCOPES = ['todo', 'all', 'one', 'blank'];
export const DEFAULT_ACCEPT = ['yes', 'true', 'i agree', 'agree', 'agreed', 'i accept', 'accept', 'accepted'];
export const PLACEHOLDERS = ['race', 'date', 'venue', 'name', 'bib', 'cat'];
export const VOLUNTEER_VERSION = 1;

/* ---------- the text a director starts from ---------- */
export const STARTER_TITLE = 'Participant waiver and release';
export const STARTER_TEXT =
  'I am entering {race} on {date} at {venue} of my own free will. I have read the race information and I will follow the rules and the instructions of the organisers, marshals and medical staff.\n\n' +
  'I confirm that I am medically fit to take part and have trained for the distance I entered. I understand that trail running carries risks, including falls, uneven ground, weather, animals, traffic and exhaustion, and that I take part at my own risk.\n\n' +
  'I understand that the organisers, their volunteers and sponsors are not liable for injury, illness, loss or damage that happens to me, to the extent the law allows. I agree to be given first aid, and to be taken for emergency medical treatment if the medical staff think it is needed.\n\n' +
  'I allow the organisers to use photographs and video taken at the event, and to show my name and result in the results list.\n\n' +
  'I will run only with my own bib and will not pass it to anyone else.';
// What the volunteer sign-up page makes a volunteer agree to (racedir.web.js says the same words; a test keeps the two together).
export const volunteerWaiverText = (name) =>
  'I volunteer at ' +
  oneLine(name, 80) +
  ' of my own choice. I will follow instructions from the organisers, I am fit to do my role, and I understand that the organisers (VTRA) are not liable for personal injury or loss to the extent the law allows.';

/* ---------- the text of a waiver ---------- */
const werr = (m) => new Error(m);
const holes = (s) => {
  const out = [];
  T(s).replace(/\{([A-Za-z][A-Za-z0-9_]{0,19})\}/g, (all, k) => {
    out.push(k.toLowerCase());
    return all;
  });
  return out;
};
// A waiver as typed: { title, text }. Angle brackets, control and direction characters are removed; a {word} that is not one of the
// listed placeholders is refused, so a typing slip never reaches a runner's paper. Throws 'wv_bad_text' or 'wv_placeholder'.
export function cleanWaiver(raw) {
  // A title and a text are text: a number or a list that would turn into one when printed is not a waiver.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.title !== 'string' || typeof raw.text !== 'string') throw werr('wv_bad_text');
  // Cut one character past the limit: a text that is too long is refused, never silently shortened.
  const title = oneLine(raw.title, MAX_TITLE + 1);
  const text = cleanBody(raw.text, MAX_TEXT + 1);
  if (!title || text.length < MIN_TEXT) throw werr('wv_bad_text');
  if (title.length > MAX_TITLE || text.length > MAX_TEXT) throw werr('wv_too_long');
  if (holes(title).concat(holes(text)).some((k) => !PLACEHOLDERS.includes(k))) throw werr('wv_placeholder');
  return { title, text };
}
// A saved version as the screens need it (damaged text gives null, so a bad row can never stop a screen).
export function versionOf(row) {
  if (!row || typeof row !== 'object') return null;
  const m = /^[1-9]\d{0,3}$/.exec(T(row.ref));
  const o = parseJson(row.json, null);
  if (!m || !o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (typeof o.title !== 'string' || typeof o.text !== 'string') return null;
  const title = oneLine(o.title, MAX_TITLE);
  const text = cleanBody(o.text, MAX_TEXT);
  if (!title || !text) return null;
  return { ver: parseInt(m[0], 10), title, text, by: oneLine(row.by, 60), at: T(row.at).slice(0, 40) };
}

/* ---------- settings: which question of the form is the waiver ---------- */
// An answer compared in a plain way: small letters, one space between words, no full stop or mark at the end.
export const normAnswer = (v) => T(v).toLowerCase().replace(/\s+/g, ' ').replace(/[.!\s]+$/, '').trim();
export const defaultSettings = () => ({ question: '', accept: DEFAULT_ACCEPT.slice(), formVersion: 1, minVersion: 1 });
export const SET_KEYS = ['question', 'accept', 'formVersion', 'minVersion'];
const okVer = (v, top) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= Math.max(1, top);
// Settings as typed. latest: the newest saved version (0 when there is none). Throws 'wv_bad_settings'.
export function cleanSettings(raw, latest) {
  const bad = () => werr('wv_bad_settings');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  for (const k of Object.keys(raw)) if (!SET_KEYS.includes(k)) throw bad();
  const top = Number.isInteger(latest) && latest > 0 ? latest : 1;
  let question = '';
  if (raw.question !== undefined && raw.question !== '') {
    if (typeof raw.question !== 'string') throw bad();
    question = oneLine(raw.question, MAX_QUESTION);
    if (!question) throw bad();
  }
  let accept = DEFAULT_ACCEPT.slice();
  if (raw.accept !== undefined) {
    if (!Array.isArray(raw.accept) || raw.accept.length > MAX_ACCEPT) throw bad();
    const seen = new Set();
    accept = [];
    for (const a of raw.accept) {
      if (typeof a !== 'string') throw bad();
      const n = normAnswer(oneLine(a, MAX_ANSWER + 20));
      if (!n || n.length > MAX_ANSWER) throw bad();
      if (!seen.has(n)) {
        seen.add(n);
        accept.push(n);
      }
    }
    if (!accept.length) throw bad();
  }
  const formVersion = raw.formVersion === undefined ? 1 : raw.formVersion;
  const minVersion = raw.minVersion === undefined ? 1 : raw.minVersion;
  if (!okVer(formVersion, top) || !okVer(minVersion, top)) throw bad();
  return { question, accept, formVersion, minVersion };
}
// Settings as stored: a damaged or missing part falls back to the default, so a bad row can never stop a screen.
export function settingsOf(stored) {
  const o = parseJson(stored, {});
  const d = defaultSettings();
  if (!o || typeof o !== 'object' || Array.isArray(o)) return d;
  const q = typeof o.question === 'string' ? oneLine(o.question, MAX_QUESTION) : '';
  const acc = Array.isArray(o.accept)
    ? Array.from(new Set(o.accept.filter((a) => typeof a === 'string').map((a) => normAnswer(a)).filter((a) => a && a.length <= MAX_ANSWER))).slice(0, MAX_ACCEPT)
    : [];
  const v = (x) => (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 9999 ? x : 1);
  return { question: q, accept: acc.length ? acc : d.accept, formVersion: v(o.formVersion), minVersion: v(o.minVersion) };
}
// Does this answer of the form count as signed? An empty answer never does.
export function accepted(answer, list) {
  const a = normAnswer(answer);
  return !!a && Array.isArray(list) && list.includes(a);
}
// The questions a registration form asks, with how many answered: names and counts only, never an answer (a question may hold a phone
// number or a date of birth). The names are written the same way settings write them, so a name picked here matches when it is read.
export function questionsOf(regs) {
  const f = new Map();
  (Array.isArray(regs) ? regs : []).slice(0, 3000).forEach((r) => {
    formAnswers(r && r.form).forEach((v, k) => {
      const n = oneLine(k, MAX_QUESTION);
      if (!n) return;
      const x = f.get(n) || { name: n, count: 0 };
      if (v) x.count++;
      f.set(n, x);
    });
  });
  return Array.from(f.values()).slice(0, 60);
}
// The answer a registration gave to the question (''  when it did not answer).
export function answerOf(form, question) {
  if (!question) return '';
  let hit = '';
  formAnswers(form).forEach((v, k) => {
    if (!hit && oneLine(k, MAX_QUESTION) === question) hit = v;
  });
  return hit;
}
// "v2" or 2 as the number 2 (a stored volunteer version that cannot be read counts as 1).
export const verNum = (v) => {
  const m = /^v?(\d{1,4})$/i.exec(T(v).trim());
  const n = m ? parseInt(m[1], 10) : 0;
  return n >= 1 ? n : 1;
};

/* ---------- what is on record: versions, settings, papers ---------- */
export const ids = {
  ver: (ev, n) => 'ver~' + ev + '~' + String(n).padStart(6, '0'),
  set: (ev) => 'set~' + ev,
  sig: (ev, sub, ref, n) => 'sig~' + ev + '~' + sub + '~' + ref + '~' + String(n).padStart(2, '0'),
  vd: (sig) => 'vd~' + sig,
};
const HOWS = ['paper'];
// The rows of one race read from the collection -> { versions (oldest first), latest, settings, sigs (all, with void marks), byRef }.
export function bookOf(rowsOfRace) {
  const rows = Array.isArray(rowsOfRace) ? rowsOfRace.filter((r) => r && typeof r === 'object') : [];
  const versions = rows
    .filter((r) => r.kind === 'ver')
    .map(versionOf)
    .filter(Boolean)
    .sort((a, b) => a.ver - b.ver);
  const latest = versions.length ? versions[versions.length - 1].ver : 0;
  const setRow = rows.find((r) => r.kind === 'set');
  const settings = settingsOf(setRow && setRow.json);
  const voids = new Map();
  rows
    .filter((r) => r.kind === 'vd')
    .forEach((r) => {
      if (!voids.has(T(r.ref))) voids.set(T(r.ref), { by: oneLine(r.by, 60), at: T(r.at).slice(0, 40), reason: oneLine(r.why, MAX_NOTE) });
    });
  const sigs = rows
    .filter((r) => r.kind === 'sig' && (r.sub === 'runner' || r.sub === 'volunteer') && T(r.ref) && /^[1-9]\d{0,3}$/.test(T(parseJson(r.json, {}).ver)))
    .map((r) => ({
      id: T(r._id),
      sub: r.sub,
      ref: T(r.ref),
      ver: parseInt(T(parseJson(r.json, {}).ver), 10),
      how: HOWS.includes(r.who) ? r.who : 'paper',
      note: oneLine(r.why, MAX_NOTE),
      by: oneLine(r.by, 60),
      at: T(r.at).slice(0, 40),
      void: voids.get(T(r._id)) || null,
    }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  // Every row id in use is taken, whether the row can be read or not: a damaged row is never written over, and never blocks the next
  // record or the next saved text either (they take the next free number).
  const taken = new Set(rows.map((r) => T(r._id)));
  const byRef = new Map();
  sigs.forEach((s) => {
    const k = s.sub + '|' + s.ref;
    if (!byRef.has(k)) byRef.set(k, []);
    byRef.get(k).push(s);
  });
  return { versions, latest, settings, sigs, byRef, taken };
}
export const sigsOf = (book, sub, ref) => book.byRef.get(sub + '|' + T(ref)) || [];
// The number the next saved text gets: the first after the latest that can be read whose row id is not used (a damaged row keeps its id),
// or 0 when the numbers up to MAX_VERSIONS are used.
export function nextVer(book, ev) {
  const taken = book && book.taken instanceof Set ? book.taken : new Set();
  const top = book && Number.isInteger(book.latest) && book.latest > 0 ? book.latest : 0;
  for (let n = top + 1; n <= MAX_VERSIONS; n++) if (!taken.has(ids.ver(T(ev), n))) return n;
  return 0;
}
// The number the next record of a person gets: the first of 1 to MAX_PER_PERSON whose row id is not used yet, or 0 when all are used
// (voided records and damaged rows use theirs too).
export function nextSig(book, ev, sub, ref) {
  const taken = book && book.taken instanceof Set ? book.taken : new Set();
  for (let n = 1; n <= MAX_PER_PERSON; n++) if (!taken.has(ids.sig(T(ev), T(sub), T(ref), n))) return n;
  return 0;
}

// The best of the ways a person has signed: the highest version, then the latest. min: the lowest version that counts.
function stateOf(cands, min) {
  let best = null;
  cands.forEach((c) => {
    if (!best || c.ver > best.ver || (c.ver === best.ver && T(c.at) > T(best.at))) best = c;
  });
  if (!best) return { state: 'none', ver: 0, how: '', at: '' };
  return { state: best.ver >= min ? 'signed' : 'older', ver: best.ver, how: best.how, at: T(best.at).slice(0, 40) };
}
// A runner: the answer on the registration form, and the papers recorded for the registration.
export function runnerState(reg, book) {
  const st = book.settings;
  const c = [];
  if (st.question && reg && accepted(answerOf(reg.form, st.question), st.accept)) c.push({ how: 'form', ver: st.formVersion, at: T(reg.at) });
  sigsOf(book, 'runner', reg && reg._id)
    .filter((s) => !s.void)
    .forEach((s) => c.push({ how: s.how, ver: s.ver, at: s.at }));
  return stateOf(c, st.minVersion);
}
// A volunteer: the waiver of the sign-up page, and the papers recorded for the volunteer.
export function volunteerState(vol, book) {
  const c = [];
  if (vol && T(vol.waiverAt)) c.push({ how: 'online', ver: verNum(vol.waiverVersion), at: T(vol.waiverAt) });
  sigsOf(book, 'volunteer', vol && vol._id)
    .filter((s) => !s.void)
    .forEach((s) => c.push({ how: s.how, ver: s.ver, at: s.at }));
  return stateOf(c, VOLUNTEER_VERSION);
}
// Everybody a waiver is asked of: the runners who have paid, and the volunteers who have not been declined.
export const waiverRunners = (regs) => (Array.isArray(regs) ? regs : []).filter((r) => r && r.status === 'ok');
export const waiverVolunteers = (vols) => (Array.isArray(vols) ? vols : []).filter((v) => v && v.status !== 'declined');

/* ---------- the people, as a list ---------- */
// One line of the list: a name, a bib and a category and where the person stands. Nothing else of the registration.
export function personLine(sub, row, book) {
  const s = sub === 'runner' ? runnerState(row, book) : volunteerState(row, book);
  const base = { id: T(row._id), name: cleanText(row.name, 80), state: s.state, ver: s.ver, how: s.how, at: s.at };
  return sub === 'runner'
    ? Object.assign(base, { bib: bibKey(row.bib), cat: cleanText(row.cat, 60) })
    : Object.assign(base, { bib: '', cat: '', vstatus: cleanText(row.status, 20) });
}
export const matchesFilter = (line, filter) => (filter === 'all' ? true : filter === 'todo' ? line.state !== 'signed' : line.state === filter);
// The lines of one list, in bib order. q: part of a name, or a bib; cat: a category of the race ('' for all).
const objects = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []);
export function listOf(sub, rows, book, o) {
  const opt = o && typeof o === 'object' ? o : {};
  const q = lc(cleanText(opt.q, 40));
  const bq = bibKey(opt.q);
  return objects(rows)
    .map((r) => personLine(sub, r, book))
    .filter((l) => matchesFilter(l, opt.filter || 'all'))
    .filter((l) => !opt.cat || catKey(l.cat) === catKey(opt.cat))
    .filter((l) => !q || lc(l.name).includes(q) || (bq && l.bib === bq))
    .sort(byPerson);
}
// Counts: how many have signed (and how), signed only an older version, or not signed; for runners also per category.
export function countsOf(sub, rows, book, cats) {
  const lines = objects(rows).map((r) => personLine(sub, r, book));
  const sum = (ls) => ({ total: ls.length, signed: ls.filter((l) => l.state === 'signed').length, older: ls.filter((l) => l.state === 'older').length, none: ls.filter((l) => l.state === 'none').length });
  const out = Object.assign(sum(lines), { by: {} });
  lines.filter((l) => l.state === 'signed').forEach((l) => (out.by[l.how] = (out.by[l.how] || 0) + 1));
  if (sub === 'runner') {
    out.cats = (Array.isArray(cats) ? cats : []).map((c) => Object.assign({ cat: cleanText(c, 60) }, sum(lines.filter((l) => catKey(l.cat) === catKey(c)))));
  }
  return out;
}

/* ---------- papers to print ---------- */
const CSS =
  '@page{size:210mm 297mm;margin:14mm}@media screen{body{padding:10mm}}' +
  '.wf{page-break-after:always;break-after:page}.wf:last-child{page-break-after:auto;break-after:auto}' +
  'h1{font-size:18pt;margin:0 0 2mm}.sub{font-size:10pt;color:#444;margin:0 0 6mm}' +
  'p{font-size:11pt;line-height:1.4;margin:0 0 3mm}' +
  '.who{margin:8mm 0 6mm;padding:3mm 4mm;border:0.4mm solid #333;font-size:11pt}.who b{font-size:13pt}' +
  '.sign{display:flex;gap:8mm;margin-top:14mm;font-size:11pt}.sign div{flex:1;border-top:0.4mm solid #000;padding-top:1.5mm}' +
  '.ft{margin-top:8mm;font-size:8pt;color:#666}' +
  'table{width:100%;border-collapse:collapse;margin:4mm 0}th,td{border:0.3mm solid #444;padding:2mm;font-size:10pt;text-align:left;vertical-align:middle}' +
  'th{background:#eee}td.s{width:58mm;height:10mm}td.d{width:26mm}td.b{width:18mm}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}' +
  '.say{font-size:10pt;margin:4mm 0 2mm;font-weight:700}';
const LINE = '__________________';
// vars: the words to fill in; null for a text that is fixed (the volunteer waiver holds the race's name, and a {word} inside that name is not one of ours).
const paras = (text, vars) =>
  T(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => '<p>' + esc(vars ? fill(p, vars) : p).replace(/\n/g, '<br>') + '</p>')
    .join('');
// The words {race}, {date}, {venue} and, for one person's paper, {name}, {bib} and {cat}. A blank paper has lines to write on.
export function waiverVars(race, person) {
  const r = race || {};
  const p = person || null;
  return {
    race: cleanText(r.name, 80),
    date: longDate(r.date) || cleanText(r.date, 20),
    venue: cleanText(r.venue, 120),
    name: p ? cleanText(p.name, 80) : LINE,
    bib: p ? bibKey(p.bib) || '-' : LINE,
    cat: p ? cleanText(p.cat, 60) || '-' : LINE,
  };
}
const subLine = (v) => esc([v.race, v.date, v.venue].filter(Boolean).join(' · '));
// One person's paper to sign, one page. wv: { title, text, ver }.
export function renderForm(wv, race, person, who) {
  const v = waiverVars(race, person);
  const vol = who === 'volunteers';
  const head = '<h1>' + esc(fill(wv.title, v)) + '</h1><div class="sub">' + subLine(v) + '</div>';
  const who1 = vol
    ? '<div class="who">Name: <b>' + esc(v.name) + '</b></div>'
    : '<div class="who">Name: <b>' + esc(v.name) + '</b> &nbsp;&middot;&nbsp; Bib: <b>' + esc(v.bib) + '</b> &nbsp;&middot;&nbsp; Category: <b>' + esc(v.cat) + '</b></div>';
  const sign = '<div class="sign"><div>Signature</div><div>Date</div></div>';
  const foot = '<div class="ft">Waiver version ' + esc(String(wv.ver)) + ' &middot; ' + esc(v.race) + '</div>';
  return '<section class="wf">' + head + paras(wv.text, vol ? null : v) + who1 + sign + foot + '</section>';
}
// The page around a list of papers.
export const sheetHead = (title) => docHead(title, CSS);
// The title of the page that holds the papers: the title of the waiver with the race's words filled in.
export const titleOf = (wv, race) => fill(wv && wv.title, waiverVars(race, null));
export const sheetFoot = DOC_FOOT;
export function renderForms(wv, race, people, who) {
  return objects(people)
    .map((p) => renderForm(wv, race, p, who))
    .join('');
}
// A blank paper, copies times.
export function renderBlanks(wv, race, who, copies) {
  const n = Number.isInteger(copies) && copies >= 1 ? Math.min(copies, MAX_COPIES) : 1;
  return renderForm(wv, race, null, who).repeat(n);
}
// A sign-in list: the waiver on top of the first piece, then lines to sign. rows: person lines; first: this is the first piece.
export function renderList(wv, race, rows, who, first) {
  const v = waiverVars(race, null);
  const vol = who === 'volunteers';
  const top = first
    ? '<h1>' + esc(fill(wv.title, v)) + '</h1><div class="sub">' + subLine(v) + ' &middot; waiver version ' + esc(String(wv.ver)) + '</div>' + paras(wv.text, vol ? null : v) + '<div class="say">By signing next to my name I confirm that I have read this waiver and that I agree to it.</div>'
    : '<div class="sub">' + subLine(v) + ' &middot; waiver version ' + esc(String(wv.ver)) + ' &middot; sign-in list</div>';
  const th = vol ? '<th>Name</th><th>Signature</th><th>Date</th>' : '<th>Bib</th><th>Name</th><th>Category</th><th>Signature</th><th>Date</th>';
  const tr = objects(rows)
    .map((r) =>
      vol
        ? '<tr><td>' + esc(r.name) + '</td><td class="s"></td><td class="d"></td></tr>'
        : '<tr><td class="b"><b>' + esc(r.bib) + '</b></td><td>' + esc(r.name) + '</td><td>' + esc(r.cat) + '</td><td class="s"></td><td class="d"></td></tr>'
    )
    .join('');
  return '<section>' + top + '<table><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table></section>';
}
export { pageOf };
