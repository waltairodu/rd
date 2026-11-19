// backend/privacy.web.js
// Privacy for RaceOS (Velo): showing one phone number or e-mail address that a list hides, a file with all the contact details, the
// trail of who looked, and erasing a person. It uses the same logins as RaceOS (the session token the page already holds).
//
//   director (admin or director)  show, the contact files, the trail, erase
//   lead                          show (one detail of one person, with a reason)
//   viewer, desk, coach, other    refused
//
// The lists of RaceOS (registrations, volunteers, pacers) and the Expo desk carry a mask instead of a phone number or an e-mail address
// (rd-privacy.js). A show gives one detail of one person, needs a reason, and is written in the audit trail BEFORE the detail is given: when
// the note cannot be written nothing is shown. At most forty shows an hour for each login. A contact file and an erase are written the
// same way. Erasing keeps each row (bib, ticket, category, size, times) and empties what says who the person is, so that counts, stock and
// money still add up and a refresh from Wix Events or findmybib does not bring the person back. It touches RaceOS's own copies only: Wix
// Events, Wix Contacts and the findmybib collection are not changed from here.
import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { kindOf, unameOf, tidyError, takeSlot, slotKey } from './rd-auth.js';
import { T, cleanText, lc } from './rd-results.js';
import { SA, C, all, rows, getEvent } from './rd-data.js';
import {
  may, REASONS, REVEALS_PER_HOUR, SHOW_MS, revealRequest, revealAction, revealDetail, revealTarget, exportRequest, exportRows, exportPage, exportName, EXPORTS,
  LOG_ACTIONS, LOG_ROWS, logOut, isErased, CONFIRM_WORD, MAX_PLAN, personKeys, isPerson, planItem, keysOf, summaryText, erasedRow,
} from './rd-privacy.js';

// Every method below goes through this: an error this module does not know (a native error, or the text of a failed read) is logged and
// answered with 'server_error' only, so no internal detail ever reaches the browser. These are the only codes that leave.
const CODES = new Set([
  'not_logged_in', 'not_allowed', 'director_only', 'no_event', 'setup_needed', 'server_error',
  'pv_bad_request', 'pv_need_reason', 'pv_not_found', 'pv_too_many', 'pv_audit_failed', 'pv_bad_person', 'pv_need_confirm', 'pv_stale', 'pv_too_big',
]);
const guarded = (fn) => async (arg) => {
  try {
    return await fn(arg);
  } catch (e) {
    const t = tidyError(e, 'privacy');
    if (t && typeof t.message === 'string' && CODES.has(t.message)) throw t;
    try {
      console.error('privacy: ' + (e && e.stack ? e.stack : e));
    } catch (x) {
      // logging is best effort
    }
    throw new Error('server_error');
  }
};

const VOLS = 'RDVolunteers';
const PACERS = 'RDPacers';
const QUALS = 'RDQuals';
const RATE = 'RDRate';
const RUNNERS = 'Runners';
const CHECKS = 'ExpoCheckins';
const ATH = 'TrainAthletes';
const ATOK = 'TrainTokens';
const ENR = 'TrainEnroll';
const SESN = 'TrainSessions';
const MSG = 'TrainMsgs';
const COLLECTION = { reg: C.REGS, vol: VOLS, pacer: PACERS, runner: RUNNERS, athlete: ATH, check: CHECKS, qual: QUALS, waiver: C.WAIV, enroll: ENR, session: SESN, msg: MSG };
const FILE_SOURCE = { regs: C.REGS, vols: VOLS, pacers: PACERS };
const HOUR_MS = 3600000;
const nowIso = () => new Date().toISOString();

/* ---------- who is asking ---------- */
async function staffRows() {
  try {
    const out = [];
    for (let skip = 0; skip < 5000; skip += 1000) {
      const r = await wixData.query(C.STAFF).ascending('_id').skip(skip).limit(1000).find(SA);
      out.push(...r.items);
      if (r.items.length < 1000) break;
    }
    return out;
  } catch (e) {
    throw new Error('setup_needed');
  }
}
// Every method starts here: a live session of a director or a lead, and (when `need` is given) of someone who may do that.
async function cauth(arg, need) {
  // A token is text. A list or an object that would turn into a token when printed is not one.
  const t = arg && typeof arg.token === 'string' ? arg.token : '';
  if (t.length < 20) throw new Error('not_logged_in');
  let sess;
  try {
    sess = (await wixData.query(C.SESS).eq('token', t).limit(1).find(SA)).items[0];
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === lc(sess.username));
  if (!u) throw new Error('not_logged_in');
  const kind = kindOf(u);
  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');
  if (need && !may(kind, need)) throw new Error('director_only');
  return { role: kind, name: String(u.name || unameOf(u)), username: String(unameOf(u)) };
}
// A note in the audit trail. It is written BEFORE what it is about is given, and when it cannot be written nothing is given.
async function record(a, action, target, detail) {
  try {
    await wixData.insert(C.AUDIT, { at: nowIso(), by: a.username, action, target: cleanText(target, 60), detail: cleanText(detail, 200) }, SA);
  } catch (e) {
    throw new Error('pv_audit_failed');
  }
}
const raceOut = (e) => ({ id: e._id, name: cleanText(e.name, 80), date: typeof e.date === 'string' ? e.date : '', venue: cleanText(e.venue, 120) });

/* ---------- showing one detail ---------- */
// One detail of one person: the phone number or the e-mail address, with a reason.
export const pvReveal = webMethod(Permissions.Anyone, guarded(async (arg) => {
  const a = await cauth(arg, 'reveal');
  const q = revealRequest(arg);
  const e = await getEvent(arg.ev);
  const row = await wixData.get(COLLECTION[q.kind], q.id, SA).catch(() => null);
  if (!row || row.event !== e._id || isErased(row)) throw new Error('pv_not_found');
  const value = cleanText(T(row[q.field]), 120);
  if (!value) throw new Error('pv_not_found');
  // Forty an hour for each login. The slots (see takeSlot) cannot be raced: a burst of requests at the same moment still gets forty.
  let slot = '';
  try {
    slot = await takeSlot(wixData, RATE, slotKey('rev', a.username), REVEALS_PER_HOUR, HOUR_MS, SA);
  } catch (x) {
    throw new Error('setup_needed');
  }
  if (!slot) throw new Error('pv_too_many');
  await record(a, revealAction(q.field), e.name, revealDetail(q.kind, q.id, q.reason));
  return { value, field: q.field, kind: q.kind, id: q.id, ms: SHOW_MS };
}));

/* ---------- a file with the contact details ---------- */
// One page (a thousand rows) of a CSV file of registrations, volunteers or pacers WITH phone numbers and e-mail addresses. Directors only.
// Every page asked for is written in the audit trail (the kind, the rows and the reason, never a detail).
export const pvExport = webMethod(Permissions.Anyone, guarded(async (arg) => {
  const a = await cauth(arg, 'export');
  const q = exportRequest(arg);
  const e = await getEvent(arg.ev);
  const list = exportRows(q.kind, await rows(FILE_SOURCE[q.kind], e._id));
  const page = exportPage(q.kind, list, q.from);
  await record(a, 'contacts exported', e.name, EXPORTS[q.kind].title + ': rows ' + (page.count ? q.from + 1 + '-' + (q.from + page.count) : 'none') + ' of ' + page.total + ' · ' + q.reason);
  return Object.assign({ name: exportName(e.name, q.kind) }, page);
}));

/* ---------- the privacy screen ---------- */
// The race, what a contact file would hold, and the trail of who looked (the newest hundred notes about contact details).
export const pvList = webMethod(Permissions.Anyone, guarded(async (arg) => {
  const a = await cauth(arg, 'log');
  const e = await getEvent(arg.ev);
  const counts = {};
  for (const k of Object.keys(FILE_SOURCE)) counts[k] = exportRows(k, await rows(FILE_SOURCE[k], e._id)).length;
  const trail = (await wixData.query(C.AUDIT).hasSome('action', LOG_ACTIONS).descending('at').limit(LOG_ROWS).find(SA)).items.map(logOut);
  // Who a show was about, by the name the row has now (the trail keeps no name, so an erased person shows as erased).
  const want = { reg: [], vol: [], pacer: [] };
  trail.forEach((r) => {
    const t = revealTarget(r.detail);
    if (t && /^reveal /.test(r.action)) want[t.kind].push(t.id);
  });
  const names = new Map();
  for (const k of Object.keys(want)) {
    const ids = Array.from(new Set(want[k]));
    if (ids.length) (await wixData.query(COLLECTION[k]).hasSome('_id', ids).limit(1000).find(SA)).items.forEach((x) => names.set(k + '~' + x._id, cleanText(x.name, 80)));
  }
  const log = trail.map((r) => {
    const t = /^reveal /.test(r.action) ? revealTarget(r.detail) : null;
    return Object.assign({}, r, { kind: t ? t.kind : '', reason: t ? t.reason : '', who: t ? names.get(t.kind + '~' + t.id) || '' : '' });
  });
  return {
    me: { role: a.role, name: a.name },
    race: raceOut(e),
    reasons: REASONS.map((r) => ({ id: r[0], text: r[1] })),
    perHour: REVEALS_PER_HOUR,
    files: Object.keys(EXPORTS).map((k) => ({ kind: k, title: EXPORTS[k].title, rows: counts[k] })),
    log,
  };
}));

/* ---------- erasing a person ---------- */
const nameKey = (v) => lc(T(v)).replace(/[^a-z0-9]/g, '');
const readAll = (col) => all(() => wixData.query(col).ascending('_id'));
// A source that cannot be read (the module is not set up, or the read failed) is named in `unread` and counts as empty, so the screen can
// say so. The registrations and the races are the exception: they have to be readable, or nothing is done.
const pull = async (unread, label, col) => {
  try {
    return await readAll(col);
  } catch (e) {
    if (!unread.includes(label)) unread.push(label);
    return [];
  }
};
// Every row of RaceOS (every race) that is this person, each with what the screen shows of it: registrations, Expo runners (the same
// number or address, or the same bib and name as a registration found), volunteers, pacers and a training account.
async function findPeople(keys) {
  const unread = [];
  const events = await readAll(C.EVENTS);
  const raceOfId = new Map(events.map((x) => [x._id, cleanText(x.name, 80)]));
  const raceOfExpo = new Map(events.filter((x) => x.expoId).map((x) => [String(x.expoId), cleanText(x.name, 80)]));
  const found = [];
  const take = (kind, row, race) => found.push({ kind, row, item: planItem(kind, row, race) });
  const regs = (await readAll(C.REGS)).filter((r) => !isErased(r) && isPerson(r, keys));
  regs.forEach((r) => take('reg', r, raceOfId.get(r.event) || ''));
  const same = new Map();
  regs.forEach((r) => {
    const ev = events.find((x) => x._id === r.event);
    if (ev && ev.expoId && T(r.bib).trim()) same.set(String(ev.expoId) + '~' + T(r.bib).trim(), nameKey(r.name));
  });
  const slot = (r) => T(r.event) + '~' + T(r.bib).trim();
  (await pull(unread, 'Expo runners', RUNNERS))
    .filter((r) => !isErased(r) && (isPerson(r, keys) || (same.has(slot(r)) && same.get(slot(r)) === nameKey(r.name))))
    .forEach((r) => take('runner', r, raceOfExpo.get(T(r.event)) || ''));
  (await pull(unread, 'Volunteers', VOLS)).filter((r) => !isErased(r) && isPerson(r, keys)).forEach((r) => take('vol', r, raceOfId.get(r.event) || ''));
  (await pull(unread, 'Pacers', PACERS)).filter((r) => !isErased(r) && isPerson(r, keys)).forEach((r) => take('pacer', r, raceOfId.get(r.event) || ''));
  (await pull(unread, 'Training accounts', ATH)).filter((r) => !isErased(r) && isPerson(r, keys)).forEach((r) => take('athlete', r, ''));
  return { found, unread };
}
// The rows that hang on a person and carry words or a picture of them: the hand-over records of a runner, the qualification claims and
// the waiver notes of a registration, the waiver notes of a volunteer, and a training account's notes and messages.
async function dependents(x, unread) {
  const id = String(x.row._id);
  const find = async (label, col, field, ids) => {
    try {
      return (await wixData.query(col).hasSome(field, ids).limit(1000).find(SA)).items;
    } catch (e) {
      if (!unread.includes(label)) unread.push(label);
      return [];
    }
  };
  if (x.kind === 'runner') return [['check', await find('Hand-over records', CHECKS, '_id', [id, id + '#shirt'])]];
  if (x.kind === 'reg') return [['qual', await find('Qualification claims', QUALS, 'runnerId', [id])], ['waiver', await find('Waiver records', C.WAIV, 'ref', [id])]];
  if (x.kind === 'vol') return [['waiver', await find('Waiver records', C.WAIV, 'ref', [id])]];
  if (x.kind === 'athlete') {
    const enr = await find('Training enrolments', ENR, 'athlete', [id]);
    return [['enroll', enr], ['session', await find('Training sessions', SESN, 'athlete', [id])], ['msg', enr.length ? await find('Training messages', MSG, 'enroll', enr.map((n) => String(n._id))) : []]];
  }
  return [];
}

// Who would be erased: every row that is this person, masked, with a key for each. Nothing is changed.
export const pvErasePlan = webMethod(Permissions.Anyone, guarded(async (arg) => {
  await cauth(arg, 'erase');
  const keys = personKeys(arg);
  const { found, unread } = await findPeople(keys);
  return { items: found.slice(0, MAX_PLAN).map((x) => x.item), total: found.length, capped: found.length > MAX_PLAN, unread };
}));

// Erases the rows the director ticked (each must be one the plan lists), after the note in the audit trail.
export const pvErase = webMethod(Permissions.Anyone, guarded(async (arg) => {
  const a = await cauth(arg, 'erase');
  const keys = personKeys(arg);
  if (arg.confirm !== CONFIRM_WORD) throw new Error('pv_need_confirm');
  const want = keysOf(arg.keys);
  const { found, unread } = await findPeople(keys);
  if (found.length > MAX_PLAN) throw new Error('pv_too_big');
  const byKey = new Map(found.map((x) => [x.item.key, x]));
  if (want.some((k) => !byKey.has(k))) throw new Error('pv_stale');
  const picked = want.map((k) => byKey.get(k));
  const counts = {};
  picked.forEach((x) => (counts[x.kind] = (counts[x.kind] || 0) + 1));
  await record(a, 'person erased', 'RaceOS', summaryText(counts));
  for (const x of picked) {
    const rest = await dependents(x, unread);
    await wixData.update(COLLECTION[x.kind], erasedRow(x.kind, x.row), SA);
    for (const [kind, list] of rest) for (const r of list) await wixData.update(COLLECTION[kind], erasedRow(kind, r), SA);
    if (x.kind === 'athlete') {
      let toks = [];
      try {
        toks = (await wixData.query(ATOK).eq('athlete', String(x.row._id)).limit(1000).find(SA)).items;
      } catch (e) {
        if (!unread.includes('Training sign-ins')) unread.push('Training sign-ins');
      }
      if (toks.length) await wixData.bulkRemove(ATOK, toks.map((t) => t._id), SA);
    }
  }
  return { erased: counts, summary: summaryText(counts), unread };
}));
// END privacy.web.js
