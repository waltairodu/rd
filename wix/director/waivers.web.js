// backend/waivers.web.js
// Waivers for RaceOS (Velo): the text of the waiver (every save is a new version), which question of the registration form is the waiver,
// who has signed (from the form, from the volunteer sign-up page and from papers recorded here), the papers to print, and a record of
// every paper signed on the day. It uses the same logins as RaceOS (the session token the page already holds).
//
//   director (admin or director)  saves the text, says which question is the waiver, records papers, voids a record, prints
//   lead                          can LOOK and PRINT, and record a paper that was signed (a lead often runs the desk)
//   viewer, desk, coach, other    refused
//
// Nothing is ever deleted or changed: a text save makes the next version, a paper signed makes a record, and a mistake is voided with a
// reason (the record stays, marked). A record is made only once: its row id holds the person and the number of the record, and a row id can
// be made only once, so two people recording the same paper together, or a call that is repeated, never make two. The collection holds
// ids, versions and the short note staff typed; it holds no phone number, e-mail address or date of birth. A paper carries a name, a bib
// and a category, and nothing else.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { kindOf, unameOf, tidyError } from './rd-auth.js';
import { cleanText, lc, catKey } from './rd-results.js';
import { SA, C, rows, getEvent, raceOf, knownCats } from './rd-data.js';
import { oneLine, pieces } from './rd-comms.js';
import {
  MAX_VERSIONS, MAX_NOTE, MAX_IDS, LIST_PAGE, CHUNK_FORMS, CHUNK_LIST, MAX_COPIES, WHO, FILTERS, MODES, SCOPES, PLACEHOLDERS, VOLUNTEER_VERSION,
  STARTER_TITLE, STARTER_TEXT, SET_KEYS, MAX_TITLE, MAX_TEXT, MIN_TEXT, MAX_ACCEPT, MAX_QUESTION, MAX_ANSWER,
  cleanWaiver, cleanSettings, questionsOf, bookOf, nextSig, nextVer, ids, runnerState, volunteerState, waiverRunners, waiverVolunteers, personLine, listOf, countsOf, sigsOf,
  volunteerWaiverText, renderForms, renderBlanks, renderList, sheetHead, titleOf, pageOf,
} from './rd-waiver.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'waivers');
    }
  });

const WAIV = C.WAIV;
const VOLS = 'RDVolunteers';
const nowIso = () => new Date().toISOString();
const BUDGET_MS = 9000; // a record call stops starting new people after this long (a web method has 14 seconds)
const CONCURRENT = 5; // records being made at the same moment within one call

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
// Every method starts here. need: 'director' (directors only) or 'staff' (directors and leads).
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
  if (need === 'director' && kind !== 'director') throw new Error('director_only');
  await ensureCollections();
  return { role: kind, name: String(u.name || unameOf(u)), username: String(unameOf(u)) };
}
async function audit(a, action, target, detail) {
  try {
    await wixData.insert(C.AUDIT, { at: nowIso(), by: a.username, action, target: cleanText(target, 60), detail: cleanText(detail, 200) }, SA);
  } catch (e) {
    // the note is lost, the change is not
  }
}
// Writes a whole row: replaces the one that is there, or makes it.
async function put(col, row) {
  const old = await wixData.get(col, row._id, SA).catch(() => null);
  if (old) return wixData.update(col, row, SA);
  try {
    return await wixData.insert(col, row, SA);
  } catch (e) {
    return wixData.update(col, row, SA);
  }
}
const safeRows = (col, ev) => rows(col, ev).catch(() => []);
const row = (e, kind, ref, sub, who, why, json, a) => ({ event: e._id, kind, ref, sub, who, status: '', why, json, by: a.username, at: nowIso() });

/* ---------- arguments ---------- */
const bad = (code) => new Error(code);
const whoOf = (v) => {
  if (typeof v !== 'string' || !WHO.includes(v)) throw bad('wv_bad_who');
  return v;
};
const subOf = (who) => (who === 'volunteers' ? 'volunteer' : 'runner');
const fromOf = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  if (!Number.isInteger(v) || v < 0 || v > 1000000) throw bad('wv_bad_from');
  return v;
};
const idOf = (v) => {
  if (typeof v !== 'string' || !v || v.length > 120) throw bad('wv_bad_id');
  return v;
};
const pickOf = (v, list, dflt, code) => {
  const x = v === undefined ? dflt : v;
  if (typeof x !== 'string' || !list.includes(x)) throw bad(code);
  return x;
};
const queryOf = (v) => {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'string' || v.length > 80) throw bad('wv_bad_query');
  return cleanText(v, 40);
};
const copiesOf = (v) => {
  if (v === undefined) return 1;
  if (!Number.isInteger(v) || v < 1 || v > MAX_COPIES) throw bad('wv_bad_copies');
  return v;
};
// A category of the race, written the way the race writes it ('' for all). Volunteers have none.
const catOf = (v, who, cats) => {
  if (v === undefined || v === '') return '';
  if (who !== 'runners' || typeof v !== 'string') throw bad('wv_bad_cat');
  const hit = cats.find((c) => catKey(c) === catKey(v));
  if (!hit) throw bad('wv_bad_cat');
  return hit;
};

/* ---------- what is on record ---------- */
const bookFor = async (ev) => bookOf(await rows(WAIV, ev));
// The people a waiver is asked of (paid runners; volunteers who are not declined) and the categories of the race.
async function peopleOf(e, who) {
  if (who === 'volunteers') return { people: waiverVolunteers(await safeRows(VOLS, e._id)).filter((v) => v.event === e._id), cats: [] };
  const regs = await rows(C.REGS, e._id);
  return { people: waiverRunners(regs), cats: knownCats(raceOf(e), regs), regs };
}
// One person of this race who a waiver is asked of, or null (somebody else's registration, an unpaid one and a declined volunteer are none).
async function personById(e, who, id) {
  const r = await wixData.get(who === 'volunteers' ? VOLS : C.REGS, id, SA).catch(() => null);
  if (!r || r.event !== e._id) return null;
  if (who === 'volunteers' ? r.status === 'declined' : r.status !== 'ok') return null;
  return r;
}
async function byIds(col, list) {
  const out = [];
  for (const part of pieces(list, 100)) {
    const r = await wixData.query(col).hasSome('_id', part).limit(1000).find(SA);
    out.push(...r.items);
  }
  return out;
}
// The waiver that is asked of a kind of person: the latest saved text for runners; the fixed text of the sign-up page for volunteers.
function waiverFor(who, book, e) {
  if (who === 'volunteers') return { title: 'Volunteer waiver', text: volunteerWaiverText(e.name), ver: VOLUNTEER_VERSION };
  const v = book.versions[book.versions.length - 1];
  if (!v) throw bad('wv_none');
  return { title: v.title, text: v.text, ver: v.ver };
}
const recordOf = (s) => ({ id: s.id, ver: s.ver, how: s.how, note: s.note, by: s.by, at: s.at, void: s.void });

/* ---------- looking ---------- */
export const wvOverview = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'staff');
  const e = await getEvent(arg.ev);
  const [regs, vols, book] = await Promise.all([rows(C.REGS, e._id), safeRows(VOLS, e._id), bookFor(e._id)]);
  const race = raceOf(e);
  const cats = knownCats(race, regs);
  const last = book.versions[book.versions.length - 1] || null;
  return {
    me: { role: a.role, name: a.name },
    race: { id: e._id, name: oneLine(e.name, 80), date: typeof e.date === 'string' ? e.date : '', venue: oneLine(e.venue, 120) },
    cats,
    settings: book.settings,
    latest: book.latest,
    versions: book.versions.map((v) => ({ ver: v.ver, title: v.title, chars: v.text.length, by: v.by, at: v.at })),
    text: last ? { ver: last.ver, title: last.title, text: last.text } : null,
    starter: { title: STARTER_TITLE, text: STARTER_TEXT },
    volunteer: { ver: VOLUNTEER_VERSION, title: 'Volunteer waiver', text: volunteerWaiverText(e.name) },
    questions: questionsOf(regs),
    counts: { runners: countsOf('runner', waiverRunners(regs), book, cats), volunteers: countsOf('volunteer', waiverVolunteers(vols).filter((v) => v.event === e._id), book) },
    words: PLACEHOLDERS,
    limits: { title: MAX_TITLE, text: MAX_TEXT, minText: MIN_TEXT, versions: MAX_VERSIONS, note: MAX_NOTE, ids: MAX_IDS, accept: MAX_ACCEPT, question: MAX_QUESTION, answer: MAX_ANSWER, copies: MAX_COPIES, page: LIST_PAGE },
  };
});

// One saved version of the text, or the latest when none is named.
export const wvText = webMethod(Permissions.Anyone, async (arg) => {
  await cauth(arg, 'staff');
  const e = await getEvent(arg.ev);
  const book = await bookFor(e._id);
  let want = book.latest;
  if (arg.ver !== undefined) {
    if (!Number.isInteger(arg.ver) || arg.ver < 1 || arg.ver > 9999) throw bad('wv_bad_version');
    want = arg.ver;
  }
  const v = book.versions.find((x) => x.ver === want);
  if (!v) throw bad(book.versions.length ? 'wv_no_item' : 'wv_none');
  return { ver: v.ver, title: v.title, text: v.text, by: v.by, at: v.at };
});

// A page of people with where each stands: a name, a bib, a category and a state, nothing else of the registration.
export const wvList = webMethod(Permissions.Anyone, async (arg) => {
  await cauth(arg, 'staff');
  const e = await getEvent(arg.ev);
  const who = whoOf(arg.who);
  const filter = pickOf(arg.filter, FILTERS, 'all', 'wv_bad_filter');
  const q = queryOf(arg.q);
  const from = fromOf(arg.from);
  const [book, pp] = await Promise.all([bookFor(e._id), peopleOf(e, who)]);
  const cat = catOf(arg.cat, who, pp.cats);
  const pg = pageOf(listOf(subOf(who), pp.people, book, { filter, cat, q }), from, LIST_PAGE);
  return { who, from, next: pg.next, total: pg.total, items: pg.items };
});

// The records of one person, the voided ones marked.
export const wvRecords = webMethod(Permissions.Anyone, async (arg) => {
  await cauth(arg, 'staff');
  const e = await getEvent(arg.ev);
  const who = whoOf(arg.who);
  const r = await personById(e, who, idOf(arg.id));
  if (!r) throw bad('wv_no_item');
  const book = await bookFor(e._id);
  const sub = subOf(who);
  return { person: personLine(sub, r, book), records: sigsOf(book, sub, r._id).map(recordOf) };
});

/* ---------- the papers ---------- */
// Papers to print, a page at a time (the head only on the first). mode 'forms': a page for each person (or blank pages);
// mode 'list': one sign-in list with the waiver on top. scope: 'todo' (those who still need to sign), 'all', 'one' (a person) or 'blank'.
export const wvSheet = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'staff');
  const e = await getEvent(arg.ev);
  const who = whoOf(arg.who);
  const mode = pickOf(arg.mode, MODES, undefined, 'wv_bad_mode');
  const scope = pickOf(arg.scope, SCOPES, undefined, 'wv_bad_scope');
  if (mode === 'list' && (scope === 'one' || scope === 'blank')) throw bad('wv_bad_scope');
  const from = fromOf(arg.from);
  const copies = scope === 'blank' ? copiesOf(arg.copies) : 1;
  if (scope !== 'blank' && arg.copies !== undefined) throw bad('wv_bad_copies');
  if (scope !== 'one' && arg.id !== undefined) throw bad('wv_bad_id');
  const book = await bookFor(e._id);
  const wv = waiverFor(who, book, e);
  const race = raceOf(e);
  const sub = subOf(who);
  const head = sheetHead(titleOf(wv, race));
  if (scope === 'blank') {
    if (from !== 0) throw bad('wv_bad_from');
    if (arg.cat !== undefined && arg.cat !== '') throw bad('wv_bad_cat');
    await audit(a, 'waiver papers printed', e.name, who + ' blank: ' + copies);
    return { head, body: renderBlanks(wv, race, who, copies), count: copies, from: 0, next: null, total: copies, ver: wv.ver };
  }
  let list;
  if (scope === 'one') {
    const r = await personById(e, who, idOf(arg.id));
    if (!r) throw bad('wv_no_item');
    list = [personLine(sub, r, book)];
  } else {
    const pp = await peopleOf(e, who);
    list = listOf(sub, pp.people, book, { filter: scope === 'todo' ? 'todo' : 'all', cat: catOf(arg.cat, who, pp.cats) });
  }
  const pg = pageOf(list, from, mode === 'forms' ? CHUNK_FORMS : CHUNK_LIST);
  const body = !pg.items.length ? '' : mode === 'forms' ? renderForms(wv, race, pg.items, who) : renderList(wv, race, pg.items, who, from === 0);
  if (from === 0) await audit(a, 'waiver papers printed', e.name, who + ' ' + mode + ' ' + scope + ': ' + pg.total);
  return { head, body, count: pg.items.length, from, next: pg.next, total: pg.total, ver: wv.ver };
});

/* ---------- papers signed on the day ---------- */
// Records that people signed a paper waiver. Recording somebody who has already signed this version (or a newer one) changes nothing.
// People who are not in this race, or who a waiver is not asked of, are counted and left out. If the time budget runs out the people not
// yet done are handed back ('left') to be sent again.
export const wvRecord = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'staff');
  const e = await getEvent(arg.ev);
  const who = whoOf(arg.who);
  const sub = subOf(who);
  const want = arg.ids;
  if (!Array.isArray(want) || !want.length || want.length > MAX_IDS || Array.from(want).some((x) => typeof x !== 'string' || !x || x.length > 120)) throw bad('wv_bad_ids');
  let note = '';
  if (arg.note !== undefined && arg.note !== '') {
    if (typeof arg.note !== 'string' || arg.note.length > MAX_NOTE * 3) throw bad('wv_bad_note');
    note = oneLine(arg.note, MAX_NOTE);
  }
  const book = await bookFor(e._id);
  // A volunteer's paper is for the volunteer waiver; a runner's is for a saved version that still counts.
  let ver = VOLUNTEER_VERSION;
  if (who === 'volunteers') {
    if (arg.ver !== undefined && arg.ver !== VOLUNTEER_VERSION) throw bad('wv_bad_version');
  } else {
    if (!Number.isInteger(arg.ver) || arg.ver < book.settings.minVersion || arg.ver > book.latest) throw bad('wv_bad_version');
    ver = arg.ver;
  }
  const uniq = Array.from(new Set(want));
  const found = new Map((await byIds(who === 'volunteers' ? VOLS : C.REGS, uniq)).filter((r) => r.event === e._id && (who === 'volunteers' ? r.status !== 'declined' : r.status === 'ok')).map((r) => [String(r._id), r]));
  const out = { recorded: 0, already: 0, unknown: 0, full: 0, left: [] };
  const todo = [];
  uniq.forEach((id) => {
    const r = found.get(id);
    if (!r) {
      out.unknown++;
      return;
    }
    const st = sub === 'runner' ? runnerState(r, book) : volunteerState(r, book);
    if (st.state === 'signed' && st.ver >= ver) {
      out.already++;
      return;
    }
    const n = nextSig(book, e._id, sub, id);
    if (!n) {
      out.full++;
      return;
    }
    todo.push({ id, n });
  });
  const t0 = Date.now();
  const failed = [];
  const one = async (p) => {
    const rid = ids.sig(e._id, sub, p.id, p.n);
    try {
      await wixData.insert(WAIV, Object.assign({ _id: rid }, row(e, 'sig', p.id, sub, 'paper', note, JSON.stringify({ ver }), a)), SA);
      out.recorded++;
    } catch (x) {
      // A row id can be made only once: if the row is there now, another call made it and the paper is on record. If it is not, the
      // write failed, and the person is handed back to be sent again.
      const there = await wixData.get(WAIV, rid, SA).catch(() => null);
      if (there) out.already++;
      else failed.push(p.id);
    }
  };
  for (let i = 0; i < todo.length; i += CONCURRENT) {
    if (Date.now() - t0 > BUDGET_MS) {
      out.left = todo.slice(i).map((p) => p.id);
      break;
    }
    await Promise.all(todo.slice(i, i + CONCURRENT).map(one));
  }
  out.left = out.left.concat(failed);
  if (out.recorded) await audit(a, 'waiver papers recorded', e.name, who + ' version ' + ver + ': ' + out.recorded + ' recorded' + (note ? ', note given' : ''));
  return out;
});

/* ---------- changing: the text, the question, a mistake (directors) ---------- */
// Saves the text as the next version. base is the version the screen was showing (0 when there was none): if somebody has saved since,
// nothing is saved and the screen must be refreshed first.
export const wvSaveText = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const wv = cleanWaiver({ title: arg.title, text: arg.text });
  if (!Number.isInteger(arg.base) || arg.base < 0 || arg.base > 9999) throw bad('wv_bad_version');
  const book = await bookFor(e._id);
  if (book.latest !== arg.base) throw bad('wv_stale');
  const last = book.versions[book.versions.length - 1];
  if (last && last.title === wv.title && last.text === wv.text) throw bad('wv_same');
  const n = nextVer(book, e._id); // 0 when the numbers up to MAX_VERSIONS are all used (by saved texts or by damaged rows)
  if (!n) throw bad('wv_too_many');
  try {
    await wixData.insert(WAIV, Object.assign({ _id: ids.ver(e._id, n) }, row(e, 'ver', String(n), '', '', '', JSON.stringify(wv), a)), SA);
  } catch (x) {
    throw bad('wv_stale');
  }
  await audit(a, 'waiver text saved', e.name, 'version ' + n + ', ' + wv.text.length + ' characters');
  return { ver: n, title: wv.title, text: wv.text };
});

// Which question of the registration form is the waiver, which answers count as signed, which version that question showed, and the
// lowest version that still counts.
export const wvSaveSettings = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  if (SET_KEYS.some((k) => arg[k] === undefined)) throw bad('wv_bad_settings');
  const book = await bookFor(e._id);
  const s = cleanSettings({ question: arg.question, accept: arg.accept, formVersion: arg.formVersion, minVersion: arg.minVersion }, book.latest);
  await put(WAIV, Object.assign({ _id: ids.set(e._id) }, row(e, 'set', '', '', '', '', JSON.stringify(s), a)));
  await audit(a, 'waiver settings saved', e.name, (s.question ? 'question set' : 'no question') + ', ' + s.accept.length + ' answers, form shows version ' + s.formVersion + ', version ' + s.minVersion + ' or newer counts');
  return { settings: s };
});

// Marks a record as a mistake. The record stays, with who voided it and why.
export const wvVoid = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const id = idOf(arg.id);
  if (typeof arg.reason !== 'string' || arg.reason.length > MAX_NOTE * 3) throw bad('wv_bad_reason');
  const reason = oneLine(arg.reason, MAX_NOTE);
  if (!reason) throw bad('wv_bad_reason');
  const rec = await wixData.get(WAIV, id, SA).catch(() => null);
  if (!rec || rec.kind !== 'sig' || rec.event !== e._id) throw bad('wv_no_item');
  try {
    await wixData.insert(WAIV, Object.assign({ _id: ids.vd(id) }, row(e, 'vd', id, '', '', reason, '', a)), SA);
  } catch (x) {
    throw bad('wv_voided');
  }
  await audit(a, 'waiver record voided', e.name, rec.sub + ' record, reason given');
  return { voided: true };
});

/* ---------- collections ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  return [{ _id: WAIV, displayName: WAIV, permissions: LOCKED, fields: ['event', 'kind', 'ref', 'sub', 'who', 'status', 'why', 'json', 'by', 'at'].map(textField) }];
}
let checked = false;
// Creates the collection the first time a director or lead opens the tab (only when it is missing).
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
