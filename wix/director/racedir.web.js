// backend/racedir.web.js
// Race Director backend for Wix (Velo), Phase 1: command centre, volunteers (public sign-up, approval,
// shifts, check-in and hours), race-day run of show and incident log, pacers, safety checklist.
//
// ONE login for everything in RaceOS, including the Expo desk. Logins are rows of the ExpoStaff collection and are
// made and changed on the Team screen (methods listTeam, saveTeam, resetTeamSecret, signOutTeam, removeTeam), not by
// hand in the CMS. Role column:
//   admin or director  everything, including events, settings and the Team
//   lead               volunteers, race day, pacers and safety (read and write), no events or deletes
//   viewer             read only (sponsor or partner); sees no budget, sponsor or contact details
//   desk               Expo desk staff: works the Expo desk and nothing else. Every method here refuses a desk
//                      session except whoami and logout. (A row with no role is a desk login too.)
//   coach              the coach page only; refused here
//   anything else is refused.
// Passwords are stored hashed (rd-auth.js). A password typed by hand into the CMS still works and is hashed at the
// first login. Every method except login, ensureSetup, openShifts, volunteerSignup and volunteerStatus needs a session token.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { wixEventsV2, guests } from 'wix-events.v2';
import { aiEnabled, askClaude, scrub, GROUND_RULES } from './ai-core.js';
import { SCOPES, LEGACY_TITLES, cleanScope, suggest, planRows as templateRows, follow, itemByKey, permitByKey, renderLetter, editionLabel } from './rd-approvals.js';
import { checkPassword, hashPassword, needsUpgrade, genPin, genPassword, newToken, kindOf as staffKind, DESKS, canonDesk, parseDesks, deskValueOf, tidyError, takeSlot, freeSlots, slotKey } from './rd-auth.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'racedir');
    }
  });

const STAFF = 'ExpoStaff';
const SESS = 'ExpoSessions';
const PRES = 'ExpoPresence';
const EXPO_CHECKS = 'ExpoCheckins';
const AUDIT = 'RDAudit';
const RUNNERS = 'Runners';
const EVENTS = 'RDEvents';
const SHIFTS = 'RDShifts';
const VOLS = 'RDVolunteers';
const ASSIGN = 'RDAssignments';
const LOG = 'RDLog';
const RUN = 'RDRunOfShow';
const PACERS = 'RDPacers';
const CHECK = 'RDChecklist';
const RATE = 'RDRate';
const QUALS = 'RDQuals';
const REGS = 'RDRegs';

// Choose your own secret. It is asked on setup so that only you can create the collections and the first admin.
const SETUP_KEY = 'change-this-key';
const SESSION_HOURS = 12;
const SA = { suppressAuth: true };
const MAXROWS = 1000;
const SIGNUPS_PER_HOUR = 200;
const WAIVER_VERSION = 'v1';

const lc = (v) => String(v || '').trim().toLowerCase();
const unameOf = (u) => (u.username !== undefined && u.username !== null && u.username !== '' ? u.username : u.title);
const clean = (v, n) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n || 200);
const int = (v, d) => {
  const x = parseInt(v, 10);
  return Number.isFinite(x) ? x : d || 0;
};
const nowIso = () => new Date().toISOString();

function same(a, b) {
  const x = String(a);
  const y = String(b);
  let d = x.length ^ y.length;
  for (let k = 0; k < Math.max(x.length, y.length); k++) d |= (x.charCodeAt(k) || 0) ^ (y.charCodeAt(k) || 0);
  return d === 0;
}
// A short code a volunteer shows at check-in. No look-alike letters.
function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let k = 0; k < 6; k++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}
// Sortable claim stamp: time plus a random tail, so two claims in the same millisecond still have a fixed order.
const newSeq = () => nowIso() + '-' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
function phoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
const validPhone = (d) => /^[6-9]\d{9}$/.test(d);
const validEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

// Reads all rows of a query, page by page.
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

/* ---------- logins and roles ---------- */
// staffKind (rd-auth.js) reads the role column. Here: director, lead, viewer and desk may log in; coach and anything else may not.
const roleOf = (u) => {
  const k = staffKind(u);
  return k === 'coach' || k === 'other' ? 'none' : k;
};
const CAN = { director: { write: true, manage: true }, lead: { write: true, manage: false }, viewer: { write: false, manage: false }, desk: { write: false, manage: false } };

// Every login, however many there are (read a page at a time, so no login is ever out of sight).
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

// Checks the session token and returns who it belongs to, whatever the role (desk staff included).
async function session(arg) {
  const t = String((arg && arg.token) || '');
  if (t.length < 20) throw new Error('not_logged_in');
  let sess;
  try {
    sess = (await wixData.query(SESS).eq('token', t).limit(1).find(SA)).items[0];
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === lc(sess.username));
  if (!u) throw new Error('not_logged_in');
  const role = roleOf(u);
  if (role === 'none') throw new Error('not_allowed');
  return { role, can: CAN[role], user: u, name: String(u.name || unameOf(u)), username: String(unameOf(u)), sess };
}
// Every Director method uses this one: desk staff have a session, but nothing here is theirs to use.
async function auth(arg, need) {
  const a = await session(arg);
  if (a.role === 'desk') throw new Error('not_allowed');
  if (need === 'write' && !a.can.write) throw new Error('read_only');
  if (need === 'manage' && !a.can.manage) throw new Error('director_only');
  return a;
}
const meOf = (a) => ({ role: a.role, name: a.name, canWrite: a.can.write, canManage: a.can.manage });

// Writes login bookkeeping (failure count, lock, password upgrade) onto the row as it is NOW, not onto the copy read a
// moment ago, so a change made on the Team screen in between is never undone. A password upgrade is applied only if the
// stored password is still the one that was read (a reset made in between wins).
async function patchStaff(u, patch) {
  const fresh = await wixData.get(STAFF, u._id, SA).catch(() => null);
  if (!fresh) return;
  const p = Object.assign({}, patch);
  if (p.password !== undefined && String(fresh.password || '') !== String(u.password || '')) delete p.password;
  if (!Object.keys(p).length) return;
  await wixData.update(STAFF, Object.assign({}, fresh, p), SA);
}

// Frees the desk a login was holding (the Expo desk keeps one row per login in ExpoPresence).
async function releaseDeskPresence(username, desk) {
  const key = lc(username);
  try {
    const row = await wixData.get(PRES, key, SA).catch(() => null);
    if (row && (!desk || row.desk === desk)) await wixData.bulkRemove(PRES, [key], SA);
  } catch (e) {
    // nothing to release
  }
}
// Ends every session of a login (except one token) and frees its desk.
async function dropAccess(username, exceptToken, keepDesk) {
  const sess = await wixData.query(SESS).eq('username', username).limit(200).find(SA);
  const gone = sess.items.filter((x) => x.token !== exceptToken);
  if (gone.length) await wixData.bulkRemove(SESS, gone.map((x) => x._id), SA);
  if (!keepDesk) await releaseDeskPresence(username);
  return gone.length;
}

export const health = webMethod(Permissions.Anyone, async () => ({ ok: true }));

// A password that is checked against when the username does not exist, so that a wrong username takes as long to
// refuse as a wrong password (otherwise the response time would tell an attacker which usernames are real).
const DUMMY_HASH = 'h1$0123456789abcdef$0000000000000000000000000000000000000000000000000000000000000000';
const LOGIN_TRIES = 5;
const LOGIN_WINDOW_MS = 10 * 60000;

export const login = webMethod(Permissions.Anyone, async (arg) => {
  // Only plain text is accepted. An array or object in either field is a wrong login, never turned into text.
  const typed = !!arg && typeof arg.username === 'string' && typeof arg.password === 'string';
  const username = typed ? lc(arg.username) : '';
  const password = typed ? arg.password : '';
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === username);
  if (!u || !username || !password) {
    checkPassword(DUMMY_HASH, password || 'x');
    throw new Error('bad_login');
  }
  if (u.lockUntil && Date.parse(u.lockUntil) > Date.now()) throw new Error('locked');
  // Only a few tries can be under way at the same moment, however fast they are sent: the count in the row is read and
  // written back, so a burst of requests would all see the same number. The slots (see takeSlot) cannot be raced.
  const gate = slotKey('att', unameOf(u));
  let slot = '';
  try {
    slot = await takeSlot(wixData, RATE, gate, LOGIN_TRIES, LOGIN_WINDOW_MS, SA);
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!slot) throw new Error('locked');
  const good = checkPassword(u.password, password);
  if (!good) {
    const fails = int(u.failCount) + 1;
    await patchStaff(u, fails >= 5 ? { failCount: '0', lockUntil: new Date(Date.now() + 10 * 60000).toISOString() } : { failCount: String(fails) });
    throw new Error(fails >= 5 ? 'locked' : 'bad_login');
  }
  await freeSlots(wixData, RATE, gate, LOGIN_TRIES, LOGIN_WINDOW_MS, SA);
  // A good login clears the failures, and replaces a password typed by hand in the CMS with its hash.
  // (A row with no failures to clear is not written at all.)
  const patch = {};
  if ((u.failCount && u.failCount !== '0') || u.lockUntil) Object.assign(patch, { failCount: '0', lockUntil: '' });
  if (needsUpgrade(u.password)) patch.password = hashPassword(password);
  if (Object.keys(patch).length) await patchStaff(u, patch);
  if (roleOf(u) === 'none') throw new Error('not_allowed');
  await ensureCollections();
  try {
    const old = await wixData.query(SESS).lt('expires', nowIso()).limit(100).find(SA);
    if (old.items.length) await wixData.bulkRemove(SESS, old.items.map((x) => x._id), SA);
  } catch (e) {
    // clean-up is best effort
  }
  const sess = await wixData.insert(SESS, { token: newToken(), username: unameOf(u), desk: '', expires: new Date(Date.now() + SESSION_HOURS * 3600000).toISOString() }, SA);
  const role = roleOf(u);
  return Object.assign({ token: sess.token }, meOf({ role, can: CAN[role], name: String(u.name || unameOf(u)) }));
});

export const logout = webMethod(Permissions.Anyone, async (arg) => {
  const t = String((arg && arg.token) || '');
  if (t.length < 20) return { ok: true };
  const r = await wixData.query(SESS).eq('token', t).limit(5).find(SA);
  // Logging out frees the Expo desk this session was holding, so the next person can take it at once.
  for (const x of r.items) if (x.desk) await releaseDeskPresence(x.username, x.desk);
  if (r.items.length) await wixData.bulkRemove(SESS, r.items.map((x) => x._id), SA);
  return { ok: true };
});

export const whoami = webMethod(Permissions.Anyone, async (arg) => meOf(await session(arg)));

/* ---------- events ---------- */
const DEFAULT_GROUPS = [
  { label: '1:30', finish: 5400, need: 2 },
  { label: '1:45', finish: 6300, need: 2 },
  { label: '2:00', finish: 7200, need: 3 },
  { label: '2:15', finish: 8100, need: 2 },
  { label: '2:30', finish: 9000, need: 2 },
  { label: '3:00', finish: 10800, need: 2 },
];
const DEFAULT_CHECKLIST = [
  ['Medical', 'Ambulance on site and route to hospital confirmed'],
  ['Medical', 'Medical posts marked on the course map'],
  ['Medical', 'Doctors and first-aiders briefed'],
  ['Route', 'Course measured and marked'],
  ['Route', 'Traffic police permission in hand'],
  ['Route', 'Barricades and cones at turns and crossings'],
  ['Weather', 'Heat or rain plan agreed (what we do, who decides)'],
  ['Weather', 'Extra water and ice for hot mornings'],
  ['Crowd', 'Start line corrals or waves planned'],
  ['Crowd', 'Marshals at every crossing'],
  ['Communication', 'Control room phone list printed'],
  ['Communication', 'Walkie-talkies or WhatsApp group tested'],
  ['Permits', 'Event permission letters collected'],
  ['Permits', 'Insurance in place'],
];
const DEFAULT_RUN = [
  ['04:00', 'Course, aid stations and finish gantry set up', 'Operations'],
  ['04:30', 'Volunteer check-in and briefing', 'Volunteers'],
  ['05:00', 'Medical team in position', 'Medical'],
  ['05:15', 'Pacers at the start with flags', 'Pacers'],
  ['05:30', 'Start line announcements', 'Announcer'],
  ['05:45', 'Flag-off', 'Race Director'],
  ['08:00', 'Last finisher cut-off check', 'Operations'],
  ['09:00', 'Awards and closing', 'Race Director'],
];

// What is stored for a race can have been edited by hand or written by another tool. Everything handed to the screens
// is brought into the shape the screens expect (text cut to length, numbers real, lists of plain records), so odd data
// shows up as empty or default rather than breaking a screen.
const plainRecords = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, max) : []);
const realNum = (v) => (v === '' || v === null || v === undefined || typeof v === 'object' || !Number.isFinite(Number(v)) ? 0 : Number(v));
function groupsOut(v) {
  const list = plainRecords(v, 12)
    .map((g) => ({ label: clean(g.label, 12), finish: realNum(g.finish), need: realNum(g.need) }))
    .filter((g) => g.label && g.finish > 0);
  return list.length ? list : DEFAULT_GROUPS;
}
const qualsOut = (v) =>
  plainRecords(v, 30)
    .map((r) => ({ cat: clean(r.cat, 60), text: clean(r.text, 160), alts: plainRecords(r.alts, 6).map((a) => ({ minKm: realNum(a.minKm), maxSec: realNum(a.maxSec) })) }))
    .filter((r) => r.cat);
const catsOut = (v) =>
  plainRecords(v, 20)
    .map((c) => ({ name: clean(c.name, 40), km: realNum(c.km), price: realNum(c.price), cap: realNum(c.cap) }))
    .filter((c) => c.name);
const bibsOut = (v) =>
  plainRecords(v, 30)
    .map((r) => ({ cat: clean(r.cat, 60), from: Math.trunc(realNum(r.from)), to: Math.trunc(realNum(r.to)) }))
    .filter((r) => r.cat);
function wixMapOut(m) {
  const out = {};
  if (m && typeof m === 'object' && !Array.isArray(m)) Object.keys(m).slice(0, 30).forEach((k) => { if (typeof m[k] === 'string') out[clean(k, 40)] = clean(m[k], 120); });
  return out;
}
function eventOut(it) {
  let j = {};
  try {
    j = it.json ? JSON.parse(it.json) : {};
  } catch (e) {
    j = {};
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) j = {};
  const t = it.date ? Date.parse(it.date + 'T00:00:00+05:30') : NaN;
  return {
    id: it._id,
    name: it.name || '',
    date: it.date || '',
    venue: it.venue || '',
    expoId: it.expoId || '',
    status: it.status || 'open',
    distanceKm: realNum(j.distanceKm) || 21.0975,
    groups: groupsOut(j.groups),
    quals: qualsOut(j.quals),
    edition: clean(j.info && j.info.edition, 20),
    editionText: editionLabel(clean(j.info && j.info.edition, 20)),
    wixEventId: typeof j.wixEventId === 'string' ? clean(j.wixEventId, 80) : '',
    bannerUrl: typeof j.bannerUrl === 'string' ? clean(j.bannerUrl, 300) : '',
    cats: catsOut(j.cats),
    bibs: bibsOut(j.bibs),
    wixMap: wixMapOut(j.wixMap),
    daysToGo: Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86400000) : null,
  };
}
async function getEvent(ev, opts) {
  const id = String(ev || '');
  const it = id ? await wixData.get(EVENTS, id, SA).catch(() => null) : null;
  if (!it || (opts && opts.openOnly && (it.status || 'open') !== 'open')) throw new Error('no_event');
  return it;
}

export const listEvents = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const list = await all(() => wixData.query(EVENTS).ascending('_id'));
  return { events: list.map(eventOut) };
});

export const saveEvent = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  const has = (k) => arg[k] !== undefined;
  const old = arg.id ? await getEvent(arg.id) : null;
  // On an update, only the fields that are sent change; the rest are kept.
  const name = has('name') || !old ? clean(arg.name, 80) : old.name;
  if (name.length < 2) throw new Error('name_needed');
  const date = has('date') || !old ? clean(arg.date, 10) : old.date || '';
  if (date && !validDate(date)) throw new Error('bad_date');
  if (has('status') && !['open', 'closed', 'archived'].includes(arg.status)) throw new Error('bad_status');
  const status = has('status') ? arg.status : old ? old.status || 'open' : 'open';
  const dist = Number(arg.distanceKm);
  if (has('distanceKm') && !(dist >= 1 && dist <= 100)) throw new Error('bad_distance');
  const banner = has('bannerUrl') ? clean(arg.bannerUrl, 300) : '';
  if (banner && !/^https:\/\/[^\s'"()<>\\]+$/i.test(banner)) throw new Error('bad_link');
  const base = {
    name,
    date,
    venue: has('venue') || !old ? clean(arg.venue, 120) : old.venue || '',
    expoId: has('expoId') || !old ? clean(arg.expoId, 100) : old.expoId || '',
    status,
  };
  const edition = has('edition') ? clean(arg.edition, 20) : null;
  if (old) {
    let j = {};
    try {
      j = old.json ? JSON.parse(old.json) : {};
    } catch (e) {
      j = {};
    }
    if (has('distanceKm')) j.distanceKm = dist;
    if (has('bannerUrl')) j.bannerUrl = banner;
    if (edition !== null) j.info = Object.assign({}, j.info && typeof j.info === 'object' ? j.info : {}, { edition });
    const saved = await wixData.update(EVENTS, Object.assign({}, old, base, { json: JSON.stringify(j) }), SA);
    // Approval lines that came from the template move with a new race date.
    const start = infoOf(old).startTime;
    const moved = await followRace(old._id, { date: old.date || '', start }, { date: base.date, start });
    return { event: eventOut(saved), by: a.username, moved };
  }
  const info = Object.assign({}, await inheritedInfo(), edition !== null ? { edition } : {});
  const saved = await wixData.insert(EVENTS, Object.assign(base, { json: JSON.stringify({ distanceKm: has('distanceKm') ? dist : 21.0975, groups: DEFAULT_GROUPS, bannerUrl: banner, info }) }), SA);
  await wixData.bulkInsert(CHECK, DEFAULT_CHECKLIST.map(([section, item], k) => ({ event: saved._id, section, item, done: '', doneBy: '', doneAt: '', order: String(k).padStart(3, '0') })), SA);
  await wixData.bulkInsert(RUN, DEFAULT_RUN.map(([time, what, owner]) => ({ event: saved._id, time, what, owner, status: 'todo' })), SA);
  await seedPlan(saved._id, Object.keys(PLAN_DEFAULTS), saved);
  return { event: eventOut(saved), by: a.username };
});

/* ---------- shifts ---------- */
async function shiftCounts(ev) {
  const asg = await rows(ASSIGN, ev);
  const c = new Map();
  for (const x of asg) {
    if (x.status === 'declined') continue;
    const e = c.get(x.shiftId) || { taken: 0, confirmed: 0, checkedIn: 0 };
    e.taken++;
    if (x.status === 'confirmed') e.confirmed++;
    if (x.checkedInAt && !x.checkedOutAt) e.checkedIn++;
    c.set(x.shiftId, e);
  }
  return c;
}
// Position of one claim among everyone holding the shift, in claim order. A claim ranked beyond the shift's
// need loses. Two people taking the last spot at the same moment get different ranks, so exactly one wins.
async function claimRank(ev, shiftId, asgId) {
  const list = (await rows(ASSIGN, ev)).filter((x) => x.shiftId === shiftId && x.status !== 'declined');
  list.sort((a, b) => String(a.seq || '').localeCompare(String(b.seq || '')) || String(a._id).localeCompare(String(b._id)));
  return list.findIndex((x) => x._id === asgId) + 1;
}
function shiftOut(s, c) {
  const k = c.get(s._id) || { taken: 0, confirmed: 0, checkedIn: 0 };
  const need = int(s.need);
  return { id: s._id, role: s.role || '', location: s.location || '', date: s.date || '', start: s.start || '', end: s.end || '', need, notes: s.notes || '', taken: k.taken, confirmed: k.confirmed, onSite: k.checkedIn, left: Math.max(0, need - k.taken) };
}
const shiftSort = (a, b) => (a.date + a.start + a.role).localeCompare(b.date + b.start + b.role);

export const listShifts = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  await getEvent(arg.ev);
  const c = await shiftCounts(arg.ev);
  return { shifts: (await rows(SHIFTS, arg.ev)).map((s) => shiftOut(s, c)).sort(shiftSort) };
});

export const saveShift = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  await getEvent(arg.ev);
  const role = clean(arg.role, 60);
  if (role.length < 2) throw new Error('role_needed');
  const date = clean(arg.date, 10);
  if (!validDate(date)) throw new Error('bad_date');
  const start = clean(arg.start, 5);
  const end = clean(arg.end, 5);
  if (!validTime(start) || !validTime(end) || end <= start) throw new Error('bad_time');
  const need = int(arg.need, -1);
  if (need < 1 || need > 500) throw new Error('bad_need');
  const body = { event: arg.ev, role, location: clean(arg.location, 100), date, start, end, need: String(need), notes: clean(arg.notes, 300) };
  if (arg.id) {
    const old = await wixData.get(SHIFTS, String(arg.id), SA).catch(() => null);
    if (!old || old.event !== arg.ev) throw new Error('no_shift');
    const c = await shiftCounts(arg.ev);
    const taken = (c.get(old._id) || { taken: 0 }).taken;
    if (need < taken) throw new Error('need_below_taken');
    await wixData.update(SHIFTS, Object.assign({}, old, body), SA);
    return { id: old._id };
  }
  const saved = await wixData.insert(SHIFTS, body, SA);
  return { id: saved._id };
});

export const removeShift = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await wixData.get(SHIFTS, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_shift');
  const asg = (await rows(ASSIGN, arg.ev)).filter((x) => x.shiftId === old._id);
  if (asg.some((x) => x.checkedInAt)) throw new Error('shift_has_checkins');
  if (asg.length) await wixData.bulkRemove(ASSIGN, asg.map((x) => x._id), SA);
  await wixData.bulkRemove(SHIFTS, [old._id], SA);
  return { ok: true };
});

/* ---------- volunteers: public sign-up ---------- */
async function rateGate(ev) {
  const key = ev + '|' + nowIso().slice(0, 13);
  const row = await wixData.get(RATE, key, SA).catch(() => null);
  const n = row ? int(row.n) : 0;
  if (n >= SIGNUPS_PER_HOUR) throw new Error('busy_try_later');
  await wixData.save(RATE, { _id: key, n: String(n + 1) }, SA);
}

// Public: open races, so the sign-up page can pick one when the link has no race in it.
export const openEvents = webMethod(Permissions.Anyone, async () => {
  let list;
  try {
    list = await all(() => wixData.query(EVENTS).ascending('_id'));
  } catch (e) {
    throw new Error('setup_needed');
  }
  return { events: list.filter((x) => (x.status || 'open') === 'open').map((x) => ({ id: x._id, name: x.name, date: x.date || '' })) };
});

// Public: what a would-be volunteer sees. No names, no phone numbers.
export const openShifts = webMethod(Permissions.Anyone, async (arg) => {
  let it;
  try {
    it = await getEvent(arg && arg.ev, { openOnly: true });
  } catch (e) {
    if (e && e.message === 'no_event') throw e;
    throw new Error('setup_needed');
  }
  const c = await shiftCounts(it._id);
  const shifts = (await rows(SHIFTS, it._id)).map((s) => shiftOut(s, c)).sort(shiftSort);
  const e = eventOut(it);
  return { event: { id: e.id, name: e.name, date: e.date, venue: e.venue }, waiver: waiverText(e.name), shifts: shifts.map((s) => ({ id: s.id, role: s.role, location: s.location, date: s.date, start: s.start, end: s.end, notes: s.notes, left: s.left })) };
});
const waiverText = (name) => 'I volunteer at ' + name + ' of my own choice. I will follow instructions from the organisers, I am fit to do my role, and I understand that the organisers (VTRA) are not liable for personal injury or loss to the extent the law allows.';

export const volunteerSignup = webMethod(Permissions.Anyone, async (arg) => {
  if (!arg) throw new Error('bad_request');
  if (arg.website) return { ok: true, code: newCode(), shifts: [] }; // hidden field filled by a bot: pretend it worked
  const it = await getEvent(arg.ev, { openOnly: true });
  const name = clean(arg.name, 80);
  if (name.length < 2) throw new Error('name_needed');
  const phone = phoneDigits(arg.phone);
  if (!validPhone(phone)) throw new Error('bad_phone');
  const email = clean(arg.email, 120).toLowerCase();
  if (!validEmail(email)) throw new Error('bad_email');
  if (arg.waiver !== true) throw new Error('waiver_needed');
  const ids = Array.from(new Set((Array.isArray(arg.shifts) ? arg.shifts : []).map((x) => String(x)))).slice(0, 10);
  if (!ids.length) throw new Error('pick_a_shift');
  const shifts = await rows(SHIFTS, it._id);
  const picked = ids.map((id) => shifts.find((s) => s._id === id));
  if (picked.some((s) => !s)) throw new Error('no_shift');
  // two picked shifts may not overlap
  for (let i = 0; i < picked.length; i++)
    for (let j = i + 1; j < picked.length; j++)
      if (picked[i].date === picked[j].date && picked[i].start < picked[j].end && picked[j].start < picked[i].end) throw new Error('shifts_overlap');
  const have = (await rows(VOLS, it._id)).find((v) => v.phone === phone);
  if (have) throw new Error('already_signed_up');
  await rateGate(it._id);
  // capacity check first, then claim with a re-check to stop two people taking the last spot together
  const c = await shiftCounts(it._id);
  for (const s of picked) if (int(s.need) - (c.get(s._id) || { taken: 0 }).taken < 1) throw new Error('shift_full');
  const vol = await wixData.insert(VOLS, { event: it._id, name, phone, email, club: clean(arg.club, 80), status: 'applied', code: newCode(), waiverAt: nowIso(), waiverVersion: WAIVER_VERSION, createdAt: nowIso(), notes: '' }, SA);
  const made = [];
  try {
    for (const s of picked) {
      const a = await wixData.insert(ASSIGN, { event: it._id, volunteerId: vol._id, shiftId: s._id, status: 'pending', checkedInAt: '', checkedOutAt: '', hours: '', seq: newSeq() }, SA);
      made.push(a._id);
      if ((await claimRank(it._id, s._id, a._id)) > int(s.need)) throw new Error('shift_full');
    }
  } catch (e) {
    if (made.length) await wixData.bulkRemove(ASSIGN, made, SA);
    await wixData.bulkRemove(VOLS, [vol._id], SA);
    throw e;
  }
  return { ok: true, code: vol.code, name, shifts: picked.map((s) => ({ role: s.role, location: s.location, date: s.date, start: s.start, end: s.end })) };
});

// Public: a volunteer checks their own status with the code and the phone number they signed up with.
export const volunteerStatus = webMethod(Permissions.Anyone, async (arg) => {
  const it = await getEvent(arg && arg.ev);
  const code = clean(arg && arg.code, 10).toUpperCase();
  const phone = phoneDigits(arg && arg.phone);
  const v = (await rows(VOLS, it._id)).find((x) => x.code === code && x.phone === phone);
  if (!v) throw new Error('not_found');
  const shifts = await rows(SHIFTS, it._id);
  const asg = (await rows(ASSIGN, it._id)).filter((x) => x.volunteerId === v._id);
  return { name: v.name, status: v.status, shifts: asg.map((x) => { const s = shifts.find((y) => y._id === x.shiftId) || {}; return { role: s.role || '', location: s.location || '', date: s.date || '', start: s.start || '', end: s.end || '', status: x.status }; }) };
});

/* ---------- volunteers: staff side ---------- */
function volOut(v, asg, shifts) {
  const mine = asg.filter((x) => x.volunteerId === v._id);
  return {
    id: v._id,
    name: v.name,
    phone: v.phone,
    email: v.email || '',
    club: v.club || '',
    status: v.status,
    code: v.code,
    createdAt: v.createdAt || '',
    notes: v.notes || '',
    waiver: !!v.waiverAt,
    hours: Math.round(mine.reduce((s, x) => s + (Number(x.hours) || 0), 0) * 10) / 10,
    shifts: mine.map((x) => {
      const s = shifts.find((y) => y._id === x.shiftId) || {};
      return { assignId: x.id || x._id, shiftId: x.shiftId, role: s.role || '', date: s.date || '', start: s.start || '', end: s.end || '', status: x.status, checkedInAt: x.checkedInAt || '', checkedOutAt: x.checkedOutAt || '', hours: x.hours || '' };
    }),
  };
}

export const listVolunteers = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  await getEvent(arg.ev);
  const [vols, asg, shifts] = await Promise.all([rows(VOLS, arg.ev), rows(ASSIGN, arg.ev), rows(SHIFTS, arg.ev)]);
  return { volunteers: vols.map((v) => volOut(v, asg, shifts)).sort((a, b) => a.name.localeCompare(b.name)) };
});

export const setVolunteerStatus = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const v = await wixData.get(VOLS, String(arg.id || ''), SA).catch(() => null);
  if (!v || v.event !== arg.ev) throw new Error('no_volunteer');
  const st = arg.status;
  if (!['applied', 'approved', 'declined'].includes(st)) throw new Error('bad_status');
  const asg = (await rows(ASSIGN, arg.ev)).filter((x) => x.volunteerId === v._id);
  if (st === 'declined' && asg.some((x) => x.checkedInAt)) throw new Error('already_checked_in');
  await wixData.update(VOLS, Object.assign({}, v, { status: st }), SA);
  const next = st === 'approved' ? 'confirmed' : st === 'declined' ? 'declined' : 'pending';
  for (const x of asg) if (!x.checkedInAt && x.status !== next) await wixData.update(ASSIGN, Object.assign({}, x, { status: next }), SA);
  return { ok: true };
});

export const setVolunteerNote = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const v = await wixData.get(VOLS, String(arg.id || ''), SA).catch(() => null);
  if (!v || v.event !== arg.ev) throw new Error('no_volunteer');
  await wixData.update(VOLS, Object.assign({}, v, { notes: clean(arg.notes, 300) }), SA);
  return { ok: true };
});

// Staff add a volunteer by hand (already approved).
export const addVolunteer = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const it = await getEvent(arg.ev);
  const name = clean(arg.name, 80);
  if (name.length < 2) throw new Error('name_needed');
  const phone = phoneDigits(arg.phone);
  if (!validPhone(phone)) throw new Error('bad_phone');
  if ((await rows(VOLS, it._id)).some((v) => v.phone === phone)) throw new Error('already_signed_up');
  const v = await wixData.insert(VOLS, { event: it._id, name, phone, email: clean(arg.email, 120).toLowerCase(), club: clean(arg.club, 80), status: 'approved', code: newCode(), waiverAt: '', waiverVersion: '', createdAt: nowIso(), notes: 'added by staff' }, SA);
  return { id: v._id, code: v.code };
});

export const assignShift = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const v = await wixData.get(VOLS, String(arg.volunteerId || ''), SA).catch(() => null);
  const s = await wixData.get(SHIFTS, String(arg.shiftId || ''), SA).catch(() => null);
  if (!v || v.event !== arg.ev) throw new Error('no_volunteer');
  if (!s || s.event !== arg.ev) throw new Error('no_shift');
  if (v.status === 'declined') throw new Error('volunteer_declined');
  const asg = await rows(ASSIGN, arg.ev);
  if (asg.some((x) => x.volunteerId === v._id && x.shiftId === s._id && x.status !== 'declined')) throw new Error('already_assigned');
  const mine = asg.filter((x) => x.volunteerId === v._id && x.status !== 'declined');
  const shifts = await rows(SHIFTS, arg.ev);
  for (const x of mine) {
    const o = shifts.find((y) => y._id === x.shiftId);
    if (o && o.date === s.date && o.start < s.end && s.start < o.end) throw new Error('shifts_overlap');
  }
  const c = await shiftCounts(arg.ev);
  if (int(s.need) - (c.get(s._id) || { taken: 0 }).taken < 1) throw new Error('shift_full');
  const a = await wixData.insert(ASSIGN, { event: arg.ev, volunteerId: v._id, shiftId: s._id, status: v.status === 'approved' ? 'confirmed' : 'pending', checkedInAt: '', checkedOutAt: '', hours: '', seq: newSeq() }, SA);
  if ((await claimRank(arg.ev, s._id, a._id)) > int(s.need)) {
    await wixData.bulkRemove(ASSIGN, [a._id], SA);
    throw new Error('shift_full');
  }
  return { id: a._id };
});

export const unassignShift = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const a = await wixData.get(ASSIGN, String(arg.assignId || ''), SA).catch(() => null);
  if (!a || a.event !== arg.ev) throw new Error('no_assignment');
  if (a.checkedInAt) throw new Error('already_checked_in');
  await wixData.bulkRemove(ASSIGN, [a._id], SA);
  return { ok: true };
});

// Check-in and check-out by the volunteer's code (typed or scanned) or by id.
export const volunteerCheck = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  await getEvent(arg.ev);
  const action = arg.action === 'out' ? 'out' : 'in';
  const vols = await rows(VOLS, arg.ev);
  const code = clean(arg.code, 10).toUpperCase();
  const v = arg.volunteerId ? vols.find((x) => x._id === arg.volunteerId) : code ? vols.find((x) => x.code === code) : null;
  if (!v) throw new Error('not_found');
  if (v.status !== 'approved') throw new Error('not_approved');
  const shifts = await rows(SHIFTS, arg.ev);
  const mine = (await rows(ASSIGN, arg.ev)).filter((x) => x.volunteerId === v._id && x.status === 'confirmed');
  if (!mine.length) throw new Error('no_confirmed_shift');
  let a;
  if (arg.shiftId) a = mine.find((x) => x.shiftId === arg.shiftId);
  else if (action === 'out') a = mine.find((x) => x.checkedInAt && !x.checkedOutAt);
  else {
    const open = mine.filter((x) => !x.checkedInAt);
    if (open.length > 1) {
      // more than one shift waiting: use the one starting soonest, and tell the caller
      open.sort((p, q) => {
        const sp = shifts.find((y) => y._id === p.shiftId) || {};
        const sq = shifts.find((y) => y._id === q.shiftId) || {};
        return (sp.date + sp.start).localeCompare(sq.date + sq.start);
      });
    }
    a = open[0] || mine.find((x) => x.checkedInAt && !x.checkedOutAt);
  }
  if (!a) throw new Error('nothing_to_check');
  const s = shifts.find((y) => y._id === a.shiftId) || {};
  const label = { name: v.name, role: s.role || '', start: s.start || '', end: s.end || '' };
  if (action === 'in') {
    if (a.checkedInAt) throw new Error('already_in');
    await wixData.update(ASSIGN, Object.assign({}, a, { checkedInAt: nowIso() }), SA);
    return Object.assign({ ok: true, action }, label);
  }
  if (!a.checkedInAt) throw new Error('not_checked_in');
  if (a.checkedOutAt) throw new Error('already_out');
  const out = nowIso();
  const hrs = Math.max(0, Math.round(((Date.parse(out) - Date.parse(a.checkedInAt)) / 3600000) * 10) / 10);
  await wixData.update(ASSIGN, Object.assign({}, a, { checkedOutAt: out, hours: String(hrs) }), SA);
  return Object.assign({ ok: true, action, hours: hrs }, label);
});

/* ---------- race day: run of show ---------- */
export const listRun = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  await getEvent(arg.ev);
  const list = (await rows(RUN, arg.ev)).map((x) => ({ id: x._id, time: x.time, what: x.what, owner: x.owner || '', status: x.status || 'todo' }));
  return { items: list.sort((a, b) => a.time.localeCompare(b.time) || a.what.localeCompare(b.what)) };
});
export const saveRunItem = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  await getEvent(arg.ev);
  const time = clean(arg.time, 5);
  if (!validTime(time)) throw new Error('bad_time');
  const what = clean(arg.what, 160);
  if (what.length < 2) throw new Error('text_needed');
  const status = ['todo', 'doing', 'done'].includes(arg.status) ? arg.status : 'todo';
  const body = { event: arg.ev, time, what, owner: clean(arg.owner, 60), status };
  if (arg.id) {
    const old = await wixData.get(RUN, String(arg.id), SA).catch(() => null);
    if (!old || old.event !== arg.ev) throw new Error('no_item');
    await wixData.update(RUN, Object.assign({}, old, body), SA);
    return { id: old._id };
  }
  return { id: (await wixData.insert(RUN, body, SA))._id };
});
export const removeRunItem = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await wixData.get(RUN, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_item');
  await wixData.bulkRemove(RUN, [old._id], SA);
  return { ok: true };
});

/* ---------- race day: incident log ---------- */
const KINDS = ['incident', 'medical', 'aid', 'weather', 'note'];
const logOut = (x) => ({ id: x._id, at: x.at, kind: x.kind, place: x.place || '', text: x.text, severity: x.severity || 'low', status: x.status || 'open', by: x.by || '', closedAt: x.closedAt || '', resolution: x.resolution || '' });
export const listLog = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  await getEvent(arg.ev);
  const list = (await rows(LOG, arg.ev)).map(logOut).sort((a, b) => b.at.localeCompare(a.at));
  return { items: arg.status ? list.filter((x) => x.status === arg.status) : list };
});
export const addLog = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'write');
  await getEvent(arg.ev);
  const kind = KINDS.includes(arg.kind) ? arg.kind : '';
  if (!kind) throw new Error('bad_kind');
  const text = clean(arg.text, 400);
  if (text.length < 3) throw new Error('text_needed');
  const severity = ['low', 'medium', 'high'].includes(arg.severity) ? arg.severity : 'low';
  const x = await wixData.insert(LOG, { event: arg.ev, at: nowIso(), kind, place: clean(arg.place, 80), text, severity, status: kind === 'note' ? 'closed' : 'open', by: a.name, closedAt: kind === 'note' ? nowIso() : '', resolution: '' }, SA);
  return { id: x._id };
});
export const closeLog = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const old = await wixData.get(LOG, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_item');
  if (old.status === 'closed') throw new Error('already_closed');
  const resolution = clean(arg.resolution, 300);
  if (resolution.length < 2) throw new Error('resolution_needed');
  await wixData.update(LOG, Object.assign({}, old, { status: 'closed', closedAt: nowIso(), resolution }), SA);
  return { ok: true };
});

/* ---------- pacers ---------- */
function parseFinish(v) {
  const p = String(v === undefined || v === null ? '' : v).trim().split(':').map((x) => x.trim());
  if (p.length < 2 || p.length > 3 || p.some((x) => !/^\d{1,2}$/.test(x))) return 0;
  const [h, m, s] = [int(p[0]), int(p[1]), p.length === 3 ? int(p[2]) : 0];
  if (m > 59 || s > 59) return 0;
  return h * 3600 + m * 60 + s;
}
const hms = (t) => {
  t = Math.round(t);
  return Math.floor(t / 3600) + ':' + String(Math.floor((t % 3600) / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
// Even-pace table for one group.
function paceRow(finish, distKm) {
  const per = finish / distKm;
  const splits = [];
  for (let km = 5; km < distKm; km += 5) splits.push({ km, time: hms(per * km) });
  return { pace: Math.floor(Math.round(per) / 60) + ':' + String(Math.round(per) % 60).padStart(2, '0'), finish: hms(finish), splits };
}
const pacerOut = (x) => ({ id: x._id, name: x.name, phone: x.phone || '', group: x.group || '', status: x.status || 'applied', trial: x.trial || 'waiting', briefing: x.briefing === '1', kit: x.kit === '1', notes: x.notes || '' });

export const listPacers = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const e = eventOut(await getEvent(arg.ev));
  const pacers = (await rows(PACERS, arg.ev)).map(pacerOut).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const groups = e.groups.map((g) => {
    const mine = pacers.filter((p) => p.group === g.label && p.status === 'approved');
    const ready = mine.filter((p) => p.trial === 'passed' && p.briefing && p.kit).length;
    return Object.assign({}, g, paceRow(g.finish, e.distanceKm), { have: mine.length, ready, short: Math.max(0, int(g.need) - mine.length) });
  });
  return { distanceKm: e.distanceKm, groups, pacers };
});

export const savePaceGroups = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const old = await getEvent(arg.ev);
  const list = Array.isArray(arg.groups) ? arg.groups : [];
  if (!list.length || list.length > 12) throw new Error('bad_groups');
  const seen = new Set();
  const groups = list.map((g) => {
    const label = clean(g.label, 12);
    const finish = parseFinish(g.finish);
    const need = int(g.need, -1);
    if (!label || seen.has(label)) throw new Error('bad_groups');
    if (finish < 1200 || finish > 8 * 3600) throw new Error('bad_finish');
    if (need < 0 || need > 20) throw new Error('bad_need');
    seen.add(label);
    return { label, finish, need };
  });
  let j = {};
  try {
    j = old.json ? JSON.parse(old.json) : {};
  } catch (e) {
    j = {};
  }
  const dist = arg.distanceKm !== undefined ? Number(arg.distanceKm) : Number(j.distanceKm) || 21.0975;
  if (!(dist >= 1 && dist <= 100)) throw new Error('bad_distance');
  j.groups = groups.sort((a, b) => a.finish - b.finish);
  j.distanceKm = dist;
  await wixData.update(EVENTS, Object.assign({}, old, { json: JSON.stringify(j) }), SA);
  return { ok: true };
});

export const savePacer = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const e = eventOut(await getEvent(arg.ev));
  const name = clean(arg.name, 80);
  if (name.length < 2) throw new Error('name_needed');
  const phone = arg.phone ? phoneDigits(arg.phone) : '';
  if (phone && !validPhone(phone)) throw new Error('bad_phone');
  const group = clean(arg.group, 12);
  if (group && !e.groups.some((g) => g.label === group)) throw new Error('bad_group');
  const status = ['applied', 'approved', 'reserve', 'declined'].includes(arg.status) ? arg.status : 'applied';
  const trial = ['waiting', 'passed', 'retest'].includes(arg.trial) ? arg.trial : 'waiting';
  if (status === 'approved' && !group) throw new Error('group_needed');
  const body = { event: arg.ev, name, phone, group, status, trial, briefing: arg.briefing ? '1' : '', kit: arg.kit ? '1' : '', notes: clean(arg.notes, 200) };
  const list = await rows(PACERS, arg.ev);
  if (list.some((p) => p._id !== arg.id && phone && p.phone === phone)) throw new Error('already_signed_up');
  if (arg.id) {
    const old = list.find((p) => p._id === arg.id);
    if (!old) throw new Error('no_pacer');
    await wixData.update(PACERS, Object.assign({}, old, body), SA);
    return { id: old._id };
  }
  return { id: (await wixData.insert(PACERS, body, SA))._id };
});

export const removePacer = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await wixData.get(PACERS, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_pacer');
  await wixData.bulkRemove(PACERS, [old._id], SA);
  return { ok: true };
});

/* ---------- safety checklist ---------- */
const checkOut = (x) => ({ id: x._id, section: x.section, item: x.item, done: x.done === '1', doneBy: x.doneBy || '', doneAt: x.doneAt || '' });
export const listChecklist = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  await getEvent(arg.ev);
  const list = (await rows(CHECK, arg.ev)).sort((a, b) => (a.section + (a.order || '') + a.item).localeCompare(b.section + (b.order || '') + b.item));
  return { items: list.map(checkOut) };
});
export const toggleCheck = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'write');
  const old = await wixData.get(CHECK, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_item');
  const done = arg.done === true;
  await wixData.update(CHECK, Object.assign({}, old, done ? { done: '1', doneBy: a.name, doneAt: nowIso() } : { done: '', doneBy: '', doneAt: '' }), SA);
  return { ok: true };
});
export const addCheck = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  await getEvent(arg.ev);
  const section = clean(arg.section, 40);
  const item = clean(arg.item, 200);
  if (section.length < 2 || item.length < 3) throw new Error('text_needed');
  return { id: (await wixData.insert(CHECK, { event: arg.ev, section, item, done: '', doneBy: '', doneAt: '', order: '999' }, SA))._id };
});
export const removeCheck = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await wixData.get(CHECK, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_item');
  await wixData.bulkRemove(CHECK, [old._id], SA);
  return { ok: true };
});



/* ---------- registrations from Wix Events ---------- */
// Reads the ticket holders of one Wix Events event into RDRegs. Safe to repeat: a ticket is one row.
// The checkout form's field names are chosen by whoever built the form, so the director maps which field holds
// the T-shirt size, the bib name and the phone (Registrations tab > Form fields).
const PAID_OK = ['PAID', 'FREE', 'AUTHORIZED', 'UNKNOW_ORDER_STATUS', ''];
const DEAD = ['CANCELED', 'DECLINED', 'VOIDED'];
const dayOf = (d) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : '';
};
function wixErr(e) {
  const m = String((e && e.message) || e);
  return new Error(/permission|forbidden|not installed|unauthor/i.test(m) ? 'wix_events_denied' : 'wix_events_unavailable');
}
export const listWixEvents = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  let r;
  try {
    r = await elevate(wixEventsV2.queryEvents)().limit(100).find();
  } catch (e) {
    throw wixErr(e);
  }
  return {
    events: r.items.map((x) => ({ id: x._id, title: String(x.title || ''), start: dayOf(x.dateAndTimeSettings && x.dateAndTimeSettings.startDate), status: String(x.status || '') })),
  };
});
export const linkWixEvent = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await getEvent(arg.ev);
  const id = clean(arg.wixEventId, 64);
  let j = {};
  try {
    j = old.json ? JSON.parse(old.json) : {};
  } catch (e) {
    j = {};
  }
  j.wixEventId = id;
  await wixData.update(EVENTS, Object.assign({}, old, { json: JSON.stringify(j) }), SA);
  return { ok: true };
});
async function holders(wixEventId, cursor, limit, fields) {
  let q = elevate(guests.queryGuests)({ fields }).eq('eventId', wixEventId).eq('guestType', 'TICKET_HOLDER').limit(limit);
  if (cursor) q = q.skipTo(String(cursor));
  try {
    const r = await q.find();
    return { items: r.items, next: (r.cursors && r.cursors.next) || '' };
  } catch (e) {
    throw wixErr(e);
  }
}
const inputsOf = (g) => ((g.guestDetails && g.guestDetails.formResponse && g.guestDetails.formResponse.inputValues) || []).map((i) => ({ name: String(i.inputName || ''), value: String(i.value || (Array.isArray(i.values) ? i.values.join(', ') : '') || '') }));
const pick = (inputs, name) => (name ? (inputs.find((i) => i.name === name) || { value: '' }).value : '');
// Shows what the checkout form asks and what ticket names exist, so the mapping can be chosen.
export const wixFormFields = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const e = eventOut(await getEvent(arg.ev));
  if (!e.wixEventId) throw new Error('wix_event_not_linked');
  const h = await holders(e.wixEventId, '', 200, ['GUEST_DETAILS']);
  const fields = new Map();
  const tickets = new Map();
  h.items.forEach((g) => {
    inputsOf(g).forEach((i) => {
      const f = fields.get(i.name) || { name: i.name, count: 0, sample: [] };
      if (i.value) {
        f.count++;
        if (f.sample.length < 3 && !f.sample.includes(i.value.slice(0, 40))) f.sample.push(i.value.slice(0, 40));
      }
      fields.set(i.name, f);
    });
    (g.tickets || []).slice(0, 1).forEach((t) => tickets.set(t.name, (tickets.get(t.name) || 0) + 1));
  });
  return { scanned: h.items.length, fields: Array.from(fields.values()), tickets: Array.from(tickets, ([name, count]) => ({ name, count })), map: e.wixMap };
}
);
export const saveWixMap = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await getEvent(arg.ev);
  const m = arg.map || {};
  const map = { size: clean(m.size, 100), bibName: clean(m.bibName, 100), phone: clean(m.phone, 100) };
  let j = {};
  try {
    j = old.json ? JSON.parse(old.json) : {};
  } catch (e) {
    j = {};
  }
  j.wixMap = map;
  await wixData.update(EVENTS, Object.assign({}, old, { json: JSON.stringify(j) }), SA);
  return { ok: true, map };
});
export const importRegs = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const e = eventOut(await getEvent(arg.ev));
  if (!e.wixEventId) throw new Error('wix_event_not_linked');
  const h = await holders(e.wixEventId, arg.cursor, 200, ['GUEST_DETAILS']);
  const skipped = { cancelled: 0, noName: 0 };
  const byId = new Map();
  h.items.forEach((g) => {
    const st = String((g.additionalDetails && g.additionalDetails.orderStatus) || '');
    if (DEAD.includes(st)) {
      skipped.cancelled++;
      return;
    }
    const gd = g.guestDetails || {};
    const inputs = inputsOf(g);
    const name = clean(((gd.firstName || '') + ' ' + (gd.lastName || '')).trim() || pick(inputs, 'name'), 80);
    if (!name) {
      skipped.noName++;
      return;
    }
    const ticket = clean(g.ticketNumber || g.orderNumber || g._id, 60);
    const phone = phoneDigits(pick(inputs, e.wixMap.phone) || gd.phone || '');
    const size = clean(pick(inputs, e.wixMap.size), 12).toUpperCase();
    const id = e.id + '~' + ticket;
    byId.set(id, {
      _id: id,
      event: e.id,
      ticketNumber: ticket,
      orderNumber: clean(g.orderNumber, 60),
      guestId: clean(g._id, 60),
      name,
      email: clean(gd.email, 120).toLowerCase(),
      phone,
      cat: clean(((g.tickets || [])[0] || {}).name, 60),
      size,
      bibName: clean(pick(inputs, e.wixMap.bibName), 40),
      status: PAID_OK.includes(st) ? 'ok' : 'unpaid',
      form: JSON.stringify(inputs.slice(0, 40)).slice(0, 4000),
      at: g.createdDate || g._createdDate ? new Date(g.createdDate || g._createdDate).toISOString() : '',
    });
  });
  const ids = Array.from(byId.keys());
  const old = ids.length ? (await wixData.query(REGS).hasSome('_id', ids).limit(1000).find(SA)).items : [];
  const have = new Set(old.map((o) => o._id));
  const oldAt = new Map(old.map((o) => [o._id, o.at || '']));
  byId.forEach((r, id) => {
    if (!r.at || isNaN(Date.parse(r.at))) r.at = oldAt.get(id) || nowIso();
  });
  const add = ids.filter((i) => !have.has(i)).map((i) => byId.get(i));
  const upd = ids.filter((i) => have.has(i)).map((i) => byId.get(i));
  if (add.length) await wixData.bulkInsert(REGS, add, SA);
  if (upd.length) await wixData.bulkUpdate(REGS, upd, SA);
  return { done: !h.next, next: h.next, added: add.length, updated: upd.length, skipped };
});
const last10 = (p) => phoneDigits(p).slice(-10);
export const listRegs = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const e = eventOut(await getEvent(arg.ev));
  const regs = await rows(REGS, e.id).catch(() => []);
  let expo = null;
  if (e.expoId) {
    const rs = await rows(RUNNERS, e.expoId).catch(() => null);
    if (rs) expo = { phones: new Set(rs.map((r) => last10(r.phone)).filter(Boolean)), emails: new Set(rs.map((r) => lc(r.email)).filter(Boolean)), count: rs.length };
  }
  const cats = new Map();
  const list = regs.map((r) => {
    const inExpo = expo ? (!!last10(r.phone) && expo.phones.has(last10(r.phone))) || (!!r.email && expo.emails.has(lc(r.email))) : null;
    const c = cats.get(r.cat) || { cat: r.cat || '(no ticket name)', total: 0, unpaid: 0, missingInExpo: 0, noSize: 0 };
    c.total++;
    if (r.status === 'unpaid') c.unpaid++;
    if (inExpo === false) c.missingInExpo++;
    if (!r.size) c.noSize++;
    cats.set(r.cat, c);
    return { id: r._id, ticket: r.ticketNumber, name: r.name, email: r.email, phone: r.phone, cat: r.cat, size: r.size, bibName: r.bibName, bib: r.bib || '', unpaid: r.status === 'unpaid', inExpo };
  });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { linked: !!e.wixEventId, wixEventId: e.wixEventId, map: e.wixMap, total: list.length, expoCount: expo ? expo.count : null, cats: Array.from(cats.values()).sort((a, b) => a.cat.localeCompare(b.cat)), rows: list.slice(0, 2000) };
});

/* ---------- qualification checks ---------- */
// A rule is per category and has one or more ways to qualify (alternatives). An alternative is a minimum
// distance, a maximum time, or both: "half marathon under 3 hrs" = { minKm: 21.0975, maxSec: 10800 }.
// A runner qualifies if ONE alternative is met by the race they claim. The system only gives a first opinion
// (meets / below / no claim); the director decides.
const catKey = (c) => lc(c).replace(/[^a-z0-9]/g, '');
const sameCat = (a, b) => {
  const x = catKey(a);
  const y = catKey(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};
function cleanQuals(list) {
  if (!Array.isArray(list) || list.length > 30) throw new Error('bad_quals');
  const seen = new Set();
  return list.map((r) => {
    const cat = clean(r && r.cat, 60);
    if (!cat || seen.has(catKey(cat))) throw new Error('bad_quals');
    seen.add(catKey(cat));
    const alts = (Array.isArray(r.alts) ? r.alts : []).slice(0, 6).map((a) => {
      const minKm = a.minKm === '' || a.minKm === undefined || a.minKm === null ? 0 : Number(a.minKm);
      const maxSec = a.maxTime === '' || a.maxTime === undefined || a.maxTime === null ? 0 : parseFinish(a.maxTime);
      if (!(minKm >= 0 && minKm <= 500) || (a.maxTime && !maxSec) || (!minKm && !maxSec)) throw new Error('bad_quals');
      return { minKm, maxSec };
    });
    return { cat, text: clean(r.text, 160), alts };
  });
}
const ruleFor = (e, cat) => e.quals.find((r) => sameCat(r.cat, cat)) || null;
function verdictOf(rule, claim) {
  if (!rule) return 'norule';
  if (!claim) return 'noclaim';
  if (!rule.alts.length) return 'manual';
  const km = Number(claim.claimKm) || 0;
  const sec = int(claim.claimSec);
  const hit = rule.alts.some((a) => (!a.minKm || km >= a.minKm) && (!a.maxSec || (sec > 0 && sec <= a.maxSec)));
  return hit ? 'meets' : 'below';
}
const qualOut = (e, r, q) => {
  const rule = ruleFor(e, r.cat);
  return {
    runnerId: r._id,
    ref: r.ticketNumber || '',
    name: r.name || '',
    cat: r.cat || '',
    rule: rule ? rule.text || 'Rule set' : '',
    hasRule: !!rule,
    claim: q ? { text: q.claim || '', km: Number(q.claimKm) || 0, time: q.claimSec ? hms(int(q.claimSec)) : '', link: q.link || '' } : null,
    verdict: verdictOf(rule, q),
    status: q ? q.status || 'pending' : 'pending',
    note: q ? q.note || '' : '',
    by: q ? q.by || '' : '',
  };
};
// Qualification runs on the registrations imported from Wix Events, so it works long before bibs exist.
async function qualData(e) {
  const [regs, qs] = await Promise.all([rows(REGS, e.id).catch(() => []), rows(QUALS, e.id).catch(() => [])]);
  return { regs, quals: new Map(qs.map((q) => [q.runnerId, q])) };
}
export const listQuals = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const e = eventOut(await getEvent(arg.ev));
  const d = await qualData(e);
  const list = d.regs.filter((r) => ruleFor(e, r.cat)).map((r) => qualOut(e, r, d.quals.get(r._id)));
  const rank = { noclaim: 0, below: 1, manual: 2, meets: 3 };
  list.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || rank[a.verdict] - rank[b.verdict] || a.name.localeCompare(b.name));
  const n = (f) => list.filter(f).length;
  return {
    rules: e.quals,
    hasRegs: d.regs.length > 0,
    rows: list.slice(0, 2000),
    counts: { total: list.length, pending: n((x) => x.status === 'pending'), approved: n((x) => x.status === 'approved'), waived: n((x) => x.status === 'waived'), rejected: n((x) => x.status === 'rejected'), noclaim: n((x) => x.verdict === 'noclaim' && x.status === 'pending') },
  };
});
export const saveQualRules = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await getEvent(arg.ev);
  const quals = cleanQuals(arg.rules);
  let j = {};
  try {
    j = old.json ? JSON.parse(old.json) : {};
  } catch (e) {
    j = {};
  }
  j.quals = quals;
  await wixData.update(EVENTS, Object.assign({}, old, { json: JSON.stringify(j) }), SA);
  return { ok: true, count: quals.length };
});
async function qualTarget(arg) {
  const e = eventOut(await getEvent(arg.ev));
  const r = await wixData.get(REGS, String(arg.runnerId || ''), SA).catch(() => null);
  if (!r || r.event !== e.id) throw new Error('no_runner');
  const rule = ruleFor(e, r.cat);
  if (!rule) throw new Error('no_rule');
  const q = (await all(() => wixData.query(QUALS).eq('event', e.id).eq('runnerId', r._id).ascending('_id')))[0] || null;
  return { e, r, q };
}
// Record what the runner says they ran (from the registration form, an email or a WhatsApp message).
// Saving a new claim puts the decision back to pending, so an old approval never covers a new claim.
export const saveQualClaim = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'write');
  const { e, r, q } = await qualTarget(arg);
  const km = arg.km === '' || arg.km === undefined ? 0 : Number(arg.km);
  const sec = arg.time ? parseFinish(arg.time) : 0;
  if (!(km >= 0 && km <= 1000) || (arg.time && !sec)) throw new Error('bad_claim');
  const text = clean(arg.text, 160);
  if (!text && !km && !sec) throw new Error('text_needed');
  const link = clean(arg.link, 300);
  if (link && !/^https?:\/\//i.test(link)) throw new Error('bad_link');
  const row = { event: e.id, runnerId: r._id, name: r.name || '', cat: r.cat || '', claim: text, claimKm: String(km), claimSec: String(sec), link, status: 'pending', note: '', by: a.name, at: nowIso() };
  if (q) await wixData.update(QUALS, Object.assign({}, q, row), SA);
  else await wixData.insert(QUALS, row, SA);
  return { ok: true, row: qualOut(e, r, row) };
});
export const decideQual = webMethod(Permissions.Anyone, async (arg) => {
  const status = String((arg && arg.status) || '');
  // Waiving a rule is a director decision. Who is asking is checked before anything else is looked at.
  const a = await auth(arg, status === 'waived' ? 'manage' : 'write');
  if (!['approved', 'rejected', 'waived', 'pending'].includes(status)) throw new Error('bad_status');
  const { e, r, q } = await qualTarget(arg);
  const note = clean(arg.note, 200);
  if ((status === 'rejected' || status === 'waived') && note.length < 3) throw new Error('note_needed');
  if (status === 'approved' && (!q || verdictOf(ruleFor(e, r.cat), q) === 'below') && note.length < 3) throw new Error('note_needed');
  const row = Object.assign({ event: e.id, runnerId: r._id, name: r.name || '', cat: r.cat || '', claim: '', claimKm: '0', claimSec: '0', link: '' }, q || {}, { status, note, by: a.name, at: nowIso() });
  if (q) await wixData.update(QUALS, row, SA);
  else await wixData.insert(QUALS, row, SA);
  return { ok: true, row: qualOut(e, r, row) };
});

/* ---------- command centre ---------- */
const expoCache = new Map();
async function expoCounts(expoId) {
  if (!expoId) return null;
  const hit = expoCache.get(expoId);
  if (hit && Date.now() - hit.at < 20000) return hit.v;
  const list = await rows(RUNNERS, expoId).catch(() => null);
  if (!list) return null;
  const v = { total: list.length, checkedIn: list.filter((r) => r.checkedInAt).length, bibs: list.filter((r) => r.bibAt).length, shirts: list.filter((r) => r.shirtAt).length };
  expoCache.set(expoId, { at: Date.now(), v });
  return v;
}

export const overview = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const [shifts, vols, asg, log, run, pacers, chk, expo, planRows] = await Promise.all([rows(SHIFTS, e.id), rows(VOLS, e.id), rows(ASSIGN, e.id), rows(LOG, e.id), rows(RUN, e.id), rows(PACERS, e.id), rows(CHECK, e.id), expoCounts(e.expoId), rows(PLAN, e.id)]);
  const c = await shiftCounts(e.id);
  const alerts = [];
  const need = shifts.reduce((s, x) => s + int(x.need), 0);
  const taken = shifts.reduce((s, x) => s + (c.get(x._id) || { taken: 0 }).taken, 0);
  const confirmed = shifts.reduce((s, x) => s + (c.get(x._id) || { confirmed: 0 }).confirmed, 0);
  const near = e.daysToGo !== null && e.daysToGo <= 7;
  const waiting = vols.filter((v) => v.status === 'applied').length;
  if (waiting) alerts.push({ level: 'info', text: waiting + ' volunteer application' + (waiting > 1 ? 's' : '') + ' waiting for approval', go: 'volunteers' });
  const unfilled = shifts.filter((s) => int(s.need) > (c.get(s._id) || { taken: 0 }).taken);
  if (unfilled.length) alerts.push({ level: near ? 'warn' : 'info', text: unfilled.length + ' shift' + (unfilled.length > 1 ? 's' : '') + ' not full yet', go: 'volunteers' });
  const hot = log.filter((x) => x.status === 'open' && x.severity === 'high').length;
  if (hot) alerts.push({ level: 'bad', text: hot + ' high-priority incident' + (hot > 1 ? 's' : '') + ' still open', go: 'raceday' });
  const groups = e.groups.map((g) => ({ g, have: pacers.filter((p) => p.group === g.label && p.status === 'approved').length }));
  const short = groups.filter((x) => x.have < int(x.g.need));
  if (short.length) alerts.push({ level: near ? 'warn' : 'info', text: 'Pace groups short of pacers: ' + short.map((x) => x.g.label).join(', '), go: 'pacers' });
  const open = chk.filter((x) => x.done !== '1').length;
  if (open && near) alerts.push({ level: 'warn', text: open + ' safety checklist item' + (open > 1 ? 's' : '') + ' not done, race is within a week', go: 'safety' });
  const logOpen = log.filter((x) => x.status === 'open').length;
  let qualPending = 0;
  if (e.quals.length) {
    const qd = await qualData(e);
    qualPending = qd.regs.filter((r) => ruleFor(e, r.cat) && !['approved', 'waived'].includes((qd.quals.get(r._id) || {}).status)).length;
    if (qualPending) alerts.push({ level: near ? 'warn' : 'info', text: qualPending + ' runner' + (qualPending > 1 ? 's' : '') + ' with qualification not cleared', go: 'quals' });
  }
  const me = await auth(arg);
  const plan = planSummary(planRows, me.role, e);
  alerts.push(...planAlerts(plan, e, me.role));
  alerts.push(...(await expoAlerts(e, it)));
  return {
    event: e,
    expo,
    volunteers: { applied: waiting, approved: vols.filter((v) => v.status === 'approved').length, need, taken, confirmed, onSite: asg.filter((x) => x.checkedInAt && !x.checkedOutAt).length },
    log: { open: logOpen, total: log.length },
    run: { done: run.filter((x) => x.status === 'done').length, total: run.length },
    pacers: { need: groups.reduce((s, x) => s + int(x.g.need), 0), have: groups.reduce((s, x) => s + Math.min(x.have, int(x.g.need)), 0), approved: pacers.filter((p) => p.status === 'approved').length },
    checklist: { done: chk.length - open, total: chk.length },
    quals: { pending: qualPending },
    plan,
    alerts,
  };
});

/* ---------- planning: budget, sponsors, supplies, approvals, ceremonies, tasks, contacts, documents, debrief ---------- */
// One collection (RDPlan) holds every planning item. The "kind" column says what it is. Each kind has its own
// allowed phases and statuses, and its own access rule:
//   money kinds (budget, sponsor)  directors write, leads read, viewers see nothing
//   contact                        directors and leads read and write, viewers see nothing (phone numbers)
//   everything else                directors and leads write, viewers read
const PLAN = 'RDPlan';
const PKINDS = {
  budget: { phases: ['expense', 'income'], statuses: ['planned', 'committed', 'paid', 'cancelled'], done: ['paid', 'cancelled'], money: true },
  sponsor: { phases: ['cash', 'inkind'], statuses: ['lead', 'pitched', 'negotiating', 'committed', 'received', 'declined'], done: ['received', 'declined'], money: true },
  supply: { phases: ['all'], statuses: ['to_order', 'ordered', 'received', 'delivered'], done: ['delivered'] },
  approval: { phases: ['permit', 'raceday'], statuses: ['todo', 'applied', 'approved', 'rejected', 'expired'], done: ['approved'] },
  ceremony: { phases: ['pre', 'during', 'post'], statuses: ['todo', 'ready', 'done', 'skipped'], done: ['done', 'skipped'] },
  task: { phases: ['d90', 'd30', 'd7', 'week', 'day', 'after'], statuses: ['todo', 'doing', 'blocked', 'done'], done: ['done'] },
  contact: { phases: ['all'], statuses: ['active'], done: ['active'], secret: true },
  doc: { phases: ['all'], statuses: ['active'], done: ['active'], needLink: true },
  lesson: { phases: ['worked', 'fix', 'idea'], statuses: ['open', 'actioned'], done: ['actioned'] },
};
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const isSecret = (k) => !!(PKINDS[k].money || PKINDS[k].secret);
function kindOf(v) {
  const k = String(v || '');
  if (!Object.prototype.hasOwnProperty.call(PKINDS, k)) throw new Error('bad_kind');
  return k;
}
// Who may read or write this kind. Money kinds are written by directors only; viewers see no money or phone numbers.
async function planAuth(arg, kind, write) {
  const a = await auth(arg, write ? (PKINDS[kind].money ? 'manage' : 'write') : undefined);
  if (a.role === 'viewer' && isSecret(kind)) throw new Error('not_allowed');
  return a;
}
function money(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[₹,\s]/g, '');
  if (s === '') return '';
  const x = Number(s);
  if (!Number.isFinite(x) || x < 0 || x > 1e10) throw new Error('bad_amount');
  return String(Math.round(x * 100) / 100);
}
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const planDone = (r) => PKINDS[r.kind] && PKINDS[r.kind].done.includes(r.status);
const planOverdue = (r, today) => !!(r.due && r.due < today && !planDone(r) && !(r.kind === 'budget' || r.kind === 'sponsor' ? ['cancelled', 'declined'].includes(r.status) : false));
function planOut(r, today) {
  const out = {
    id: r._id,
    kind: r.kind,
    title: r.title || '',
    cat: r.cat || '',
    phase: r.phase || '',
    status: r.status || '',
    owner: r.owner || '',
    party: r.party || '',
    contact: r.contact || '',
    due: r.due || '',
    time: r.time || '',
    amount: r.amount === '' || r.amount === undefined ? null : num(r.amount),
    amount2: r.amount2 === '' || r.amount2 === undefined ? null : num(r.amount2),
    ref: r.ref || '',
    link: r.link || '',
    notes: r.notes || '',
    by: r.by || '',
    at: r.at || '',
    overdue: planOverdue(r, today),
  };
  if (r.kind === 'approval') {
    const p = permitByKey(r.tpl);
    out.tpl = r.tpl || '';
    out.docsTotal = p ? p.docs.length : 0;
    out.docsDone = p ? doneIdx(r).filter((n) => n < p.docs.length) : [];
    out.lead = r.lead === undefined || r.lead === '' ? null : num(r.lead);
  }
  return out;
}
const planSort = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.order || '999').localeCompare(String(b.order || '999')) || String(a.title).localeCompare(String(b.title));

// Builds the figures shown on the Overview and at the top of each planning tab. Viewers get no money figures.
function planSummary(list, role, e) {
  const today = istToday();
  const of = (k) => list.filter((r) => r.kind === k);
  const sum = (a, f) => a.reduce((s, r) => s + num(r[f]), 0);
  const out = { overdue: 0 };
  const live = (r) => !['cancelled', 'declined'].includes(r.status);
  out.overdue = list.filter((r) => planOverdue(r, today) && !(role === 'viewer' && isSecret(r.kind))).length;
  const tasks = of('task');
  out.tasks = { total: tasks.length, done: tasks.filter((r) => r.status === 'done').length, blocked: tasks.filter((r) => r.status === 'blocked').length, overdue: tasks.filter((r) => planOverdue(r, today)).length };
  const ap = of('approval');
  const permits = ap.filter((r) => r.phase === 'permit');
  const day = ap.filter((r) => r.phase === 'raceday');
  out.approvals = {
    permits: { total: permits.length, approved: permits.filter((r) => r.status === 'approved').length },
    raceday: { total: day.length, approved: day.filter((r) => r.status === 'approved').length },
    problems: ap.filter((r) => r.status === 'rejected' || r.status === 'expired').length,
  };
  out.ceremonies = {};
  for (const p of PKINDS.ceremony.phases) {
    const c = of('ceremony').filter((r) => r.phase === p);
    out.ceremonies[p] = { total: c.length, done: c.filter((r) => planDone(r)).length };
  }
  const sup = of('supply');
  out.supplies = { total: sup.length, delivered: sup.filter((r) => r.status === 'delivered').length, short: sup.filter((r) => r.status !== 'delivered' && r.amount !== '' && num(r.amount2) < num(r.amount)).length };
  out.lessons = { open: of('lesson').filter((r) => r.status === 'open').length };
  if (role !== 'viewer') {
    const exp = of('budget').filter((r) => r.phase === 'expense' && live(r));
    const inc = of('budget').filter((r) => r.phase === 'income' && live(r));
    const cats = {};
    for (const r of exp) {
      const c = r.cat || 'Other';
      cats[c] = cats[c] || { cat: c, planned: 0, actual: 0 };
      cats[c].planned += num(r.amount);
      cats[c].actual += num(r.amount2);
    }
    const expPlanned = sum(exp, 'amount');
    const expActual = sum(exp, 'amount2');
    const incPlanned = sum(inc, 'amount');
    const incActual = sum(inc, 'amount2');
    out.budget = {
      expPlanned, expActual, incPlanned, incActual,
      netPlanned: incPlanned - expPlanned,
      netActual: incActual - expActual,
      committedUnpaid: sum(exp.filter((r) => r.status === 'committed'), 'amount'),
      overBy: Math.max(0, expActual - expPlanned),
      overLines: exp.filter((r) => r.amount !== '' && num(r.amount2) > num(r.amount)).length,
      byCat: Object.keys(cats).sort().map((k) => cats[k]),
    };
    const sp = of('sponsor');
    const cash = sp.filter((r) => r.phase === 'cash');
    const firm = (r) => r.status === 'committed' || r.status === 'received';
    out.sponsors = {
      total: sp.length,
      cashPromised: sum(cash.filter(firm), 'amount'),
      cashReceived: sum(cash, 'amount2'),
      pipeline: sum(cash.filter((r) => !firm(r) && r.status !== 'declined'), 'amount'),
      inKind: sum(sp.filter((r) => r.phase === 'inkind' && firm(r)), 'amount'),
      stages: PKINDS.sponsor.statuses.map((s) => ({ status: s, n: sp.filter((r) => r.status === s).length })),
    };
    out.sponsors.outstanding = Math.max(0, out.sponsors.cashPromised - out.sponsors.cashReceived);
    out.sponsors.coversPct = expPlanned > 0 ? Math.round((out.sponsors.cashPromised * 100) / expPlanned) : null;
  }
  return out;
}
function planAlerts(sum, e, role) {
  const al = [];
  const days = e.daysToGo;
  const near = days !== null && days <= 30;
  if (sum.overdue) al.push({ level: 'warn', text: sum.overdue + ' planning item' + (sum.overdue > 1 ? 's' : '') + ' past the due date', go: 'plan' });
  if (sum.approvals.problems) al.push({ level: 'bad', text: sum.approvals.problems + ' approval' + (sum.approvals.problems > 1 ? 's' : '') + ' rejected or expired', go: 'approvals' });
  const waiting = sum.approvals.permits.total - sum.approvals.permits.approved;
  if (waiting > 0) al.push({ level: near ? 'warn' : 'info', text: waiting + ' permit' + (waiting > 1 ? 's' : '') + ' not approved yet', go: 'approvals' });
  const dayWait = sum.approvals.raceday.total - sum.approvals.raceday.approved;
  if (dayWait > 0 && days !== null && days >= 0 && days <= 1) al.push({ level: 'warn', text: dayWait + ' race-day sign-off' + (dayWait > 1 ? 's' : '') + ' still to give', go: 'approvals' });
  if (sum.supplies.short && days !== null && days >= 0 && days <= 14) al.push({ level: 'warn', text: sum.supplies.short + ' suppl' + (sum.supplies.short > 1 ? 'ies' : 'y') + ' short of the quantity needed', go: 'logistics' });
  if (role !== 'viewer' && sum.budget && sum.budget.overBy > 0) al.push({ level: 'bad', text: 'Spending is ' + Math.round(sum.budget.overBy) + ' over the planned budget', go: 'money' });
  return al;
}

const PLAN_FIELDS = ['title', 'cat', 'phase', 'status', 'owner', 'party', 'contact', 'due', 'time', 'amount', 'amount2', 'ref', 'link', 'notes'];
export const listPlan = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg); // who is asking is checked before anything else is looked at
  const kinds = (Array.isArray(arg.kinds) ? arg.kinds : [arg.kind]).map(kindOf);
  for (const k of kinds) await planAuth(arg, k, false);
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const all = await rows(PLAN, e.id);
  const today = istToday();
  const out = {};
  for (const k of kinds) out[k] = all.filter((r) => r.kind === k).sort(planSort).map((r) => planOut(r, today));
  return { items: out, summary: planSummary(all, a.role, e), canMoney: a.role === 'director' };
});

export const savePlanItem = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg); // who is asking is checked before anything else is looked at
  const kind = kindOf(arg.kind);
  const a = await planAuth(arg, kind, true);
  await getEvent(arg.ev);
  const K = PKINDS[kind];
  const old = arg.id ? await wixData.get(PLAN, String(arg.id), SA).catch(() => null) : null;
  if (arg.id && (!old || old.event !== arg.ev || old.kind !== kind)) throw new Error('no_item');
  const has = (k) => arg[k] !== undefined;
  const pick = (k, fn) => (has(k) || !old ? fn(arg[k]) : old[k] || '');
  const title = pick('title', (v) => clean(v, 120));
  if (title.length < 2) throw new Error('title_needed');
  const phase = pick('phase', (v) => clean(v, 20) || K.phases[0]);
  if (!K.phases.includes(phase)) throw new Error('bad_phase');
  const status = pick('status', (v) => clean(v, 20) || K.statuses[0]);
  if (!K.statuses.includes(status)) throw new Error('bad_status');
  const due = pick('due', (v) => clean(v, 10));
  if (due && !validDate(due)) throw new Error('bad_date');
  const time = pick('time', (v) => clean(v, 5));
  if (time && !validTime(time)) throw new Error('bad_time');
  const link = pick('link', (v) => clean(v, 300));
  if (link && !/^https?:\/\//i.test(link)) throw new Error('bad_link');
  if (K.needLink && !link) throw new Error('link_needed');
  const row = {
    event: arg.ev,
    kind,
    title,
    cat: pick('cat', (v) => clean(v, 40)),
    phase,
    status,
    owner: pick('owner', (v) => clean(v, 60)),
    party: pick('party', (v) => clean(v, 80)),
    contact: pick('contact', (v) => clean(v, 80)),
    due,
    time,
    amount: has('amount') || !old ? money(arg.amount) : old.amount || '',
    amount2: has('amount2') || !old ? money(arg.amount2) : old.amount2 || '',
    ref: pick('ref', (v) => clean(v, 60)),
    link,
    notes: pick('notes', (v) => clean(v, 600)),
    order: old ? old.order || '999' : '999',
    by: a.name,
    at: nowIso(),
  };
  if (kind === 'budget' && !row.cat) row.cat = 'Other';
  const saved = old ? await wixData.update(PLAN, Object.assign({}, old, row), SA) : await wixData.insert(PLAN, row, SA);
  return { item: planOut(saved, istToday()) };
});

// Quick status change. Marking something paid, received or delivered fills the actual with the planned amount if empty.
export const setPlanStatus = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg); // who is asking is checked before anything else is looked at
  const old = await wixData.get(PLAN, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_item');
  const a = await planAuth(arg, kindOf(old.kind), true);
  const K = PKINDS[old.kind];
  const status = String(arg.status || '');
  if (!K.statuses.includes(status)) throw new Error('bad_status');
  const patch = { status, by: a.name, at: nowIso() };
  if (['paid', 'received', 'delivered'].includes(status) && (old.amount2 === '' || old.amount2 === undefined) && old.amount) patch.amount2 = old.amount;
  const saved = await wixData.update(PLAN, Object.assign({}, old, patch), SA);
  return { item: planOut(saved, istToday()) };
});

export const removePlanItem = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await wixData.get(PLAN, String(arg.id || ''), SA).catch(() => null);
  if (!old || old.event !== arg.ev) throw new Error('no_item');
  await wixData.bulkRemove(PLAN, [old._id], SA);
  return { ok: true };
});

/* starter lists: what a race director usually has to track. Loaded for a new race, and on demand for kinds that are empty. */
const tk = (phase, cat, title) => ({ kind: 'task', phase, cat, title });
const BUDGET_CATS = [
  ['Permits and approvals', ['Permit and application fees']],
  ['Venue and site', ['Venue or ground hire', 'Tents, tables and chairs']],
  ['Timing and results', ['Chip timing and mats', 'Bib printing and findmybib']],
  ['Medical and safety', ['Ambulance and doctors', 'Event insurance', 'First-aid supplies']],
  ['Route and marking', ['Cones, barricades and signage']],
  ['Aid stations', ['Water, electrolytes and ice', 'Food and fruit']],
  ['Finisher items', ['Medals', 'Finisher T-shirts', 'Goodie bags']],
  ['Stage, sound and MC', ['Stage, sound and lights', 'Announcer or MC']],
  ['Marketing and media', ['Design and printing', 'Photography and video', 'Ads and promotion']],
  ['Volunteers', ['Volunteer T-shirts and food', 'Certificates']],
  ['Logistics', ['Transport', 'Toilets and generator', 'Waste and cleaning']],
  ['Awards', ['Prize money and trophies']],
  ['Admin', ['Payment gateway and platform fees', 'Contingency (about 10 percent)']],
];
const PLAN_DEFAULTS = {
  task: [
    tk('d90', 'Operations', 'Fix the race date, venue and distances'),
    tk('d90', 'Approvals', 'Start permit applications (police, municipal, forest for trail routes)'),
    tk('d90', 'Finance', 'Draft the budget and get it signed off'),
    tk('d90', 'Sponsors', 'Build the sponsor deck and a target list'),
    tk('d90', 'Registration', 'Open registration with ticket categories, prices and qualification rules'),
    tk('d90', 'Marketing', 'Announce the race (website, Instagram, WhatsApp, clubs)'),
    tk('d90', 'Operations', 'Book timing, bib and results vendors'),
    tk('d90', 'Operations', 'Shortlist medal, T-shirt and goodie-bag vendors'),
    tk('d30', 'Operations', 'Finalise the route, measurement and marking plan'),
    tk('d30', 'Volunteers', 'Open volunteer sign-up and fill the key roles'),
    tk('d30', 'Medical', 'Confirm ambulances, doctors and the nearest hospital'),
    tk('d30', 'Supplies', 'Place orders for medals, T-shirts and bibs'),
    tk('d30', 'Sponsors', 'Confirm each sponsor deliverable (logos, banners, stalls)'),
    tk('d30', 'Marketing', 'Send the runner information mailer (expo, bib collection, parking, cut-offs)'),
    tk('d7', 'Operations', 'Hold the final briefing: volunteers, pacers, medical and police'),
    tk('d7', 'Registration', 'Close entries and publish bib-collection details'),
    tk('d7', 'Supplies', 'Check that every supply has been delivered'),
    tk('d7', 'Operations', 'Check the weather and agree the heat or rain plan'),
    tk('d7', 'Media', 'Brief the photographers, videographers and announcer'),
    tk('week', 'Expo', 'Set up the expo desk and test the bib list'),
    tk('week', 'Operations', 'Print the run of show, maps and control-room phone list'),
    tk('week', 'Safety', 'Walk or drive the full course once'),
    tk('day', 'Operations', 'Final site and course check before the start'),
    tk('day', 'Operations', 'Hold the go or no-go call (see Approvals)'),
    tk('after', 'Finance', 'Settle all vendor and prize payments'),
    tk('after', 'Sponsors', 'Send sponsor thank-you notes and a short report'),
    tk('after', 'Operations', 'Publish results and send finisher certificates'),
    tk('after', 'Media', 'Share photos and the highlight video'),
    tk('after', 'Registration', 'Send the runner feedback survey'),
    tk('after', 'Volunteers', 'Thank volunteers and issue certificates'),
    tk('after', 'Operations', 'Hold the team debrief and record lessons'),
    tk('after', 'Finance', 'Close the books: final budget against actual'),
  ],
  budget: [].concat(
    BUDGET_CATS.flatMap(([cat, items]) => items.map((title) => ({ kind: 'budget', phase: 'expense', cat, title }))),
    ['Registration revenue', 'Sponsorship (cash)', 'Grants and partners', 'Merchandise', 'Other income'].map((title) => ({ kind: 'budget', phase: 'income', cat: 'Income', title }))
  ),
  supply: [
    ['Hydration', 'Drinking water', 'litres'], ['Hydration', 'Electrolyte sachets', 'sachets'], ['Hydration', 'Cups', 'pcs'], ['Hydration', 'Ice', 'kg'],
    ['Nutrition', 'Bananas and oranges', 'pcs'], ['Nutrition', 'Energy bars or biscuits', 'pcs'], ['Nutrition', 'Salt and snacks', 'packs'],
    ['Medical', 'First-aid kits', 'kits'], ['Medical', 'Cold spray and ice packs', 'pcs'], ['Medical', 'Space blankets', 'pcs'], ['Medical', 'Stretchers', 'pcs'],
    ['Tech', 'Walkie-talkies', 'sets'], ['Tech', 'Power banks and chargers', 'pcs'], ['Tech', 'Generator and fuel', 'sets'], ['Tech', 'Microphones and speakers', 'sets'], ['Tech', 'Timing mats and chips', 'sets'],
    ['Signage', 'Start and finish gantry', 'sets'], ['Signage', 'Route arrows and ribbons', 'pcs'], ['Signage', 'Kilometre markers', 'pcs'], ['Signage', 'Cones and barricades', 'pcs'], ['Signage', 'Banners and directional boards', 'pcs'],
    ['Kit', 'Bibs and safety pins', 'sets'], ['Kit', 'Finisher medals', 'pcs'], ['Kit', 'Finisher T-shirts', 'pcs'], ['Kit', 'Goodie bags', 'pcs'], ['Kit', 'Volunteer T-shirts', 'pcs'], ['Kit', 'Pacer flags and bibs', 'sets'],
    ['General', 'Tents, tables and chairs', 'sets'], ['General', 'Dustbins and bags', 'pcs'], ['General', 'Portable toilets', 'pcs'], ['General', 'Rope, cable ties and tape', 'sets'], ['General', 'Trophies', 'pcs'],
  ].map(([cat, title, ref]) => ({ kind: 'supply', cat, title, ref })),
  approval: [], // built from the template in rd-approvals.js (see seedPlan)
  ceremony: [
    ['pre', 'Runner briefing (course, cut-offs, rules)'], ['pre', 'Expo opening and bib collection'], ['pre', 'Volunteer and pacer briefing'], ['pre', 'Guest and sponsor welcome, VIP list ready'],
    ['pre', 'Inauguration or lamp lighting (if planned)'], ['pre', 'Warm-up and pledge'], ['pre', 'Announcer script and MC ready'],
    ['during', 'Flag-off for each category'], ['during', 'Announcements and cheering at aid stations'], ['during', 'Finish line welcome and medal handover'],
    ['during', 'Podium and prize presentation (overall and age groups)'], ['during', 'Sponsor recognition on stage'], ['during', 'Spot prizes or lucky draw'], ['during', 'Photo and video moments (start, finish, podium)'],
    ['post', 'Closing speech and thank-yous'], ['post', 'Volunteer felicitation and certificates'], ['post', 'Sponsor and partner thank-you'], ['post', 'Results published and certificates sent'],
    ['post', 'Photos and highlight video shared'], ['post', 'Runner feedback survey'], ['post', 'Team debrief'], ['post', 'Prize and vendor payments cleared'],
  ].map(([phase, title]) => ({ kind: 'ceremony', phase, title })),
  contact: [
    ['Police', 'Traffic police contact'], ['Police', 'Local police station'], ['Medical', 'Ambulance provider'], ['Medical', 'Nearest hospital'], ['Government', 'Municipal corporation officer'],
    ['Government', 'Forest range officer'], ['Government', 'Fire station'], ['Venue', 'Venue or ground owner'], ['Vendor', 'Timing vendor'], ['Vendor', 'Sound and stage vendor'],
    ['Vendor', 'Water and catering supplier'], ['Vendor', 'Medal and T-shirt vendor'], ['Media', 'Photographer'], ['Media', 'Press and local media'],
  ].map(([cat, title]) => ({ kind: 'contact', cat, title })),
};
async function seedPlan(ev, kinds, evRow) {
  const have = await rows(PLAN, ev);
  const made = {};
  const list = [];
  for (const k of kinds) {
    if (have.some((r) => r.kind === k)) continue;
    if (k === 'approval') {
      // The approvals come from the template, with dates worked out from the race date when there is one.
      const it = evRow || (await getEvent(ev));
      const info = infoOf(it);
      const specs = templateRows(eventOut(it), info, info.scope, null);
      specs.forEach((s) => list.push(approvalRow(ev, s, '')));
      made[k] = specs.length;
      continue;
    }
    (PLAN_DEFAULTS[k] || []).forEach((d, i) => {
      const K = PKINDS[d.kind];
      list.push({ event: ev, kind: d.kind, title: d.title, cat: d.cat || '', phase: d.phase || K.phases[0], status: K.statuses[0], owner: d.owner || '', party: d.party || '', contact: '', due: '', time: '', amount: '', amount2: '', ref: d.ref || '', link: '', notes: '', order: String(i).padStart(3, '0'), by: '', at: '' });
    });
    made[k] = (PLAN_DEFAULTS[k] || []).length;
  }
  if (list.length) await wixData.bulkInsert(PLAN, list, SA);
  return made;
}
export const seedPlanLists = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  await getEvent(arg.ev);
  const kinds = (Array.isArray(arg.kinds) && arg.kinds.length ? arg.kinds : Object.keys(PLAN_DEFAULTS)).map(kindOf).filter((k) => PLAN_DEFAULTS[k]);
  return { added: await seedPlan(arg.ev, kinds) };
});


/* ---------- approvals template: race details, suggested approvals, application letters ---------- */
// The race details that letters and suggested approvals need live in the event's json column under "info".
// They are entered by the race director; nothing about a race is fixed in the code.
const INFO_TEXT = { edition: 20, place: 60, localBody: 80, organiser: 100, regNo: 60, signatory: 60, role: 60, address: 200, route: 400, expoVenue: 120 };
const INFO_ORG = ['place', 'localBody', 'organiser', 'regNo', 'signatory', 'role', 'phone', 'email', 'address'];
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const phoneOk = (s) => /^[0-9+()\-\s]{5,30}$/.test(s);
function rawInfo(it) {
  let j = {};
  try {
    j = it && it.json ? JSON.parse(it.json) : {};
  } catch (e) {
    j = {};
  }
  return j.info && typeof j.info === 'object' ? j.info : {};
}
function infoOf(it) {
  const r = rawInfo(it);
  const o = {};
  for (const k of Object.keys(INFO_TEXT)) o[k] = clean(r[k], INFO_TEXT[k]);
  o.phone = clean(r.phone, 30);
  o.email = clean(r.email, 80);
  o.participants = int(r.participants, 0) > 0 ? String(int(r.participants, 0)) : '';
  o.volunteers = int(r.volunteers, 0) > 0 ? String(int(r.volunteers, 0)) : '';
  o.startTime = validTime(String(r.startTime || '')) ? r.startTime : '';
  o.endTime = validTime(String(r.endTime || '')) ? r.endTime : '';
  o.expoDate = validDate(String(r.expoDate || '')) ? r.expoDate : '';
  o.scope = cleanScope(r.scope);
  return o;
}
// Applies the fields that were sent over the current details; the rest are kept. Bad values are refused.
function mergeInfo(cur, inp) {
  const next = Object.assign({}, cur);
  const has = (k) => inp[k] !== undefined;
  for (const k of Object.keys(INFO_TEXT)) if (has(k)) next[k] = clean(inp[k], INFO_TEXT[k]);
  if (has('phone')) {
    const v = clean(inp.phone, 30);
    if (v && !phoneOk(v)) throw new Error('bad_phone');
    next.phone = v;
  }
  if (has('email')) {
    const v = clean(inp.email, 80);
    if (v && !emailOk(v)) throw new Error('bad_email');
    next.email = v;
  }
  for (const k of ['participants', 'volunteers']) {
    if (!has(k)) continue;
    const raw = String(inp[k] === null ? '' : inp[k]).replace(/[,\s]/g, '');
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 500000) throw new Error('bad_number');
    next[k] = n ? String(n) : '';
  }
  for (const k of ['startTime', 'endTime']) {
    if (!has(k)) continue;
    const v = clean(inp[k], 5);
    if (v && !validTime(v)) throw new Error('bad_time');
    next[k] = v;
  }
  if (has('expoDate')) {
    const v = clean(inp.expoDate, 10);
    if (v && !validDate(v)) throw new Error('bad_date');
    next.expoDate = v;
  }
  if (has('scope')) {
    if (!inp.scope || typeof inp.scope !== 'object') throw new Error('bad_scope');
    next.scope = cleanScope(inp.scope, cur.scope);
  }
  return next;
}
function withInfo(it, info) {
  let j = {};
  try {
    j = it.json ? JSON.parse(it.json) : {};
  } catch (e) {
    j = {};
  }
  j.info = info;
  return JSON.stringify(j);
}
// A new race starts with the organiser details of the race that was edited last, so they are typed once.
async function inheritedInfo() {
  const list = (await all(() => wixData.query(EVENTS).ascending('_id'))).sort((a, b) => new Date(b._updatedDate || 0) - new Date(a._updatedDate || 0));
  for (const it of list) {
    const r = rawInfo(it);
    if (INFO_ORG.some((k) => r[k])) {
      const o = {};
      INFO_ORG.forEach((k) => {
        if (r[k]) o[k] = r[k];
      });
      return o;
    }
  }
  return {};
}
const doneIdx = (r) =>
  String((r && r.docsDone) || '')
    .split(',')
    .filter((x) => x !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
// The line stored for a suggested approval. Hidden columns: tpl (which suggestion), lead or offset (so dates can follow the race), docsDone.
function approvalRow(ev, s, by) {
  return {
    event: ev, kind: 'approval', title: s.title, cat: s.cat, phase: s.phase, status: 'todo', owner: s.owner || '', party: s.party || '', contact: '', due: s.due || '', time: s.time || '',
    amount: '', amount2: '', ref: '', link: '', notes: s.notes || '', order: s.order, by: by || '', at: by ? nowIso() : '', tpl: s.tpl,
    lead: s.lead === '' || s.lead === undefined ? '' : String(s.lead), offset: s.offset === '' || s.offset === undefined ? '' : String(s.offset), docsDone: '',
  };
}
// The lines that earlier versions loaded for every race. One that is still exactly as loaded is only a placeholder.
const LEGACY_LINES = {
  'Police permission for road use and traffic diversion': ['permit', 'Police and traffic', ''],
  'Municipal corporation permission for the route and venue': ['permit', 'Municipal corporation', ''],
  'Forest department permission (trail routes)': ['permit', 'Forest department', ''],
  'Fire safety clearance for the expo, stage and tents': ['permit', 'Fire services', ''],
  'Ambulance and hospital tie-up letter': ['permit', 'Hospital', ''],
  'Event insurance policy': ['permit', 'Insurer', ''],
  'Loudspeaker and sound permission': ['permit', 'Police', ''],
  'Drone permission (if drones are used)': ['permit', 'Police or aviation', ''],
  'Land or beach owner permission': ['permit', 'Owner', ''],
  'Food safety registration for aid-station food': ['permit', 'Food safety', ''],
  'Electricity and generator permission': ['permit', 'Power utility', ''],
  'Banner and hoarding permission': ['permit', 'Municipal corporation', ''],
  'Weather go or no-go': ['raceday', '', 'Race Director'],
  'Course cleared and marked': ['raceday', '', 'Route lead'],
  'Medical team in position': ['raceday', '', 'Medical lead'],
  'Police and traffic in position': ['raceday', '', 'Operations'],
  'Start, timing and finish ready': ['raceday', '', 'Timing lead'],
  'Aid stations stocked and staffed': ['raceday', '', 'Aid-station lead'],
  'Volunteers and pacers briefed': ['raceday', '', 'Volunteer lead'],
  'Final flag-off approval': ['raceday', '', 'Race Director'],
};
function legacyOf(r) {
  return !r.tpl && Object.prototype.hasOwnProperty.call(LEGACY_LINES, r.title) && LEGACY_TITLES[r.title] ? LEGACY_TITLES[r.title] : '';
}
function untouchedLegacy(r) {
  const L = LEGACY_LINES[r.title];
  return !!L && !r.tpl && r.phase === L[0] && (r.party || '') === L[1] && (r.owner || '') === L[2] && (r.status || 'todo') === 'todo' && !r.due && !r.time && !r.contact && !r.ref && !r.link && !r.notes && !r.by;
}
// Lines that came from the template move with the race date and the start time, unless someone changed their date by hand.
async function followRace(ev, before, after) {
  if ((before.date || '') === (after.date || '') && (before.start || '') === (after.start || '')) return 0;
  const list = (await rows(PLAN, ev)).filter((r) => r.kind === 'approval' && r.tpl);
  const changed = [];
  for (const r of list) {
    const f = follow(r, before, after);
    if (f) changed.push(Object.assign({}, r, f));
  }
  if (changed.length) await wixData.bulkUpdate(PLAN, changed, SA);
  return changed.length;
}
function cleanPicks(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad_picks');
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!itemByKey(k)) throw new Error('bad_item');
    const o = raw[k];
    if (!o || typeof o !== 'object') throw new Error('bad_picks');
    const c = {};
    if (o.on !== undefined) c.on = o.on === true || o.on === 'true' || o.on === 'on';
    if (o.party !== undefined) c.party = clean(o.party, 80);
    if (o.owner !== undefined) c.owner = clean(o.owner, 60);
    for (const [f, max, err] of [['lead', 365, 'bad_lead'], ['offset', 600, 'bad_offset']]) {
      if (o[f] === undefined || o[f] === '' || o[f] === null) continue;
      const n = Number(o[f]);
      if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(err);
      c[f] = n;
    }
    if (o.due !== undefined) {
      const d = clean(o.due, 10);
      if (d && !validDate(d)) throw new Error('bad_date');
      c.due = d;
    }
    if (o.time !== undefined) {
      const t = clean(o.time, 5);
      if (t && !validTime(t)) throw new Error('bad_time');
      c.time = t;
    }
    out[k] = c;
  }
  return out;
}

// Race details for letters and the template. Leads can read them; only directors change them.
export const eventInfo = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const it = await getEvent(arg.ev);
  return { event: eventOut(it), info: infoOf(it), scopes: SCOPES.map((s) => ({ key: s.key, label: s.label })) };
});
// Saves the race name, date and venue together with the details (edition, place, organiser, expected runners, times...).
// Template lines whose dates were never edited by hand move with the new date or start time.
export const saveEventInfo = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await getEvent(arg.ev);
  const has = (k) => arg[k] !== undefined;
  const name = has('name') ? clean(arg.name, 80) : old.name || '';
  if (name.length < 2) throw new Error('name_needed');
  const date = has('date') ? clean(arg.date, 10) : old.date || '';
  if (date && !validDate(date)) throw new Error('bad_date');
  const venue = has('venue') ? clean(arg.venue, 120) : old.venue || '';
  const cur = infoOf(old);
  const inp = arg.info === undefined ? {} : arg.info;
  if (!inp || typeof inp !== 'object' || Array.isArray(inp)) throw new Error('bad_info');
  const next = mergeInfo(cur, inp);
  const saved = await wixData.update(EVENTS, Object.assign({}, old, { name, date, venue, json: withInfo(old, next) }), SA);
  const moved = await followRace(old._id, { date: old.date || '', start: cur.startTime }, { date, start: next.startTime });
  return { event: eventOut(saved), info: infoOf(saved), moved };
});

// What the template suggests for this race, and which suggestions are already on the Approvals list.
export const approvalTemplate = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const info = infoOf(it);
  const s = suggest(e, info, info.scope);
  const have = (await rows(PLAN, e.id)).filter((r) => r.kind === 'approval');
  const byTpl = new Map(have.filter((r) => r.tpl).map((r) => [r.tpl, r]));
  const mark = (x) => Object.assign({}, x, { added: byTpl.has(x.key), rowId: byTpl.has(x.key) ? byTpl.get(x.key)._id : '' });
  return {
    event: e,
    info,
    scopes: SCOPES.map((x) => ({ key: x.key, label: x.label })),
    permits: s.permits.map(mark),
    signoffs: s.signoffs.map(mark),
    starter: have.filter((r) => legacyOf(r) && untouchedLegacy(r)).length,
    started: byTpl.size > 0,
  };
});
// Adds the chosen suggestions to the Approvals list. It never overwrites a line that is already there:
// lines from the template are skipped, starter lines nobody touched are replaced, and edited starter lines are linked to the template.
export const applyApprovalTemplate = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const cur = infoOf(it);
  let scope = cur.scope;
  if (arg.scope !== undefined) {
    if (!arg.scope || typeof arg.scope !== 'object' || Array.isArray(arg.scope)) throw new Error('bad_scope');
    scope = cleanScope(arg.scope, cur.scope);
  }
  const picks = cleanPicks(arg.picks);
  const specs = templateRows(e, cur, scope, picks);
  const have = (await rows(PLAN, e.id)).filter((r) => r.kind === 'approval');
  const byTpl = new Map(have.filter((r) => r.tpl).map((r) => [r.tpl, r]));
  const starters = have.filter((r) => legacyOf(r) && untouchedLegacy(r));
  const edited = have.filter((r) => legacyOf(r) && !untouchedLegacy(r));
  const res = { added: 0, replaced: 0, linked: 0, kept: 0, removed: 0 };
  const inserts = [];
  const updates = [];
  const used = new Set();
  for (const s of specs) {
    if (byTpl.has(s.tpl)) {
      res.kept++;
      continue;
    }
    const st = starters.find((r) => legacyOf(r) === s.tpl && !used.has(r._id));
    if (st) {
      used.add(st._id);
      updates.push(Object.assign({}, st, approvalRow(e.id, s, ''), { _id: st._id }));
      res.replaced++;
      continue;
    }
    const ed = edited.find((r) => legacyOf(r) === s.tpl && !used.has(r._id));
    if (ed) {
      used.add(ed._id);
      updates.push(Object.assign({}, ed, { tpl: s.tpl, lead: s.lead === '' ? '' : String(s.lead), offset: s.offset === '' ? '' : String(s.offset), due: ed.due || s.due, time: ed.time || s.time }));
      res.linked++;
      continue;
    }
    inserts.push(approvalRow(e.id, s, a.name));
    res.added++;
  }
  const drop = starters.filter((r) => !used.has(r._id)).map((r) => r._id);
  res.removed = drop.length;
  if (inserts.length) await wixData.bulkInsert(PLAN, inserts, SA);
  if (updates.length) await wixData.bulkUpdate(PLAN, updates, SA);
  if (drop.length) await wixData.bulkRemove(PLAN, drop, SA);
  if (arg.scope !== undefined) await wixData.update(EVENTS, Object.assign({}, it, { json: withInfo(it, Object.assign({}, rawInfo(it), { scope })) }), SA);
  return res;
});
// The application letter for one permit, filled from the race details. Nothing is stored: the director edits the text and sends it.
export const approvalLetter = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const it = await getEvent(arg.ev);
  const row = await wixData.get(PLAN, String(arg.id || ''), SA).catch(() => null);
  if (!row || row.event !== arg.ev || row.kind !== 'approval') throw new Error('no_item');
  if (row.phase !== 'permit') throw new Error('no_letter');
  const day = arg.date === undefined || arg.date === null || arg.date === '' ? istToday() : String(arg.date);
  if (!validDate(day)) throw new Error('bad_date');
  const info = infoOf(it);
  const L = renderLetter({ title: row.title, party: row.party, tpl: row.tpl }, eventOut(it), info, { today: day, scope: info.scope });
  const p = permitByKey(row.tpl);
  const done = doneIdx(row);
  return { id: row._id, title: row.title, subject: L.subject, to: L.to, text: L.text, missing: L.missing, docs: L.docs.map((t, i) => ({ text: t, done: done.includes(i) })), tips: p ? p.tips : '', day };
});
// Ticks or unticks one document on the "what to attach" list of a permit.
export const setApprovalDoc = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'write');
  const row = await wixData.get(PLAN, String(arg.id || ''), SA).catch(() => null);
  if (!row || row.event !== arg.ev || row.kind !== 'approval') throw new Error('no_item');
  const p = permitByKey(row.tpl);
  if (!p) throw new Error('no_docs');
  const i = Number(arg.index);
  if (!Number.isInteger(i) || i < 0 || i >= p.docs.length) throw new Error('bad_index');
  const set = new Set(doneIdx(row));
  if (arg.done) set.add(i);
  else set.delete(i);
  const list = [...set].filter((n) => n < p.docs.length).sort((x, y) => x - y);
  await wixData.update(PLAN, Object.assign({}, row, { docsDone: list.join(',') }), SA);
  return { id: row._id, done: list, total: p.docs.length };
});

/* ---------- categories, fees and the dashboard figures ---------- */
function cleanCats(list) {
  if (!Array.isArray(list) || list.length > 20) throw new Error('bad_cats');
  const seen = new Set();
  return list.map((c) => {
    const name = clean(c && c.name, 40);
    const k = catKey(name);
    if (name.length < 2 || seen.has(k)) throw new Error('bad_cats');
    seen.add(k);
    const n = (v) => (v === '' || v === undefined || v === null ? 0 : Number(v));
    const km = n(c.km), price = n(c.price), cap = n(c.cap);
    if (![km, price, cap].every(Number.isFinite) || km < 0 || km > 1000 || price < 0 || price > 1e7 || cap < 0 || cap > 1e6 || Math.floor(cap) !== cap) throw new Error('bad_cats');
    return { name, km: Math.round(km * 1000) / 1000, price: Math.round(price * 100) / 100, cap };
  });
}
export const saveCats = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await getEvent(arg.ev);
  const cats = cleanCats(arg.cats);
  let j = {};
  try {
    j = old.json ? JSON.parse(old.json) : {};
  } catch (e) {
    j = {};
  }
  j.cats = cats;
  await wixData.update(EVENTS, Object.assign({}, old, { json: JSON.stringify(j) }), SA);
  return { cats };
});
function catIndex(cats, name) {
  const k = catKey(name);
  let i = cats.findIndex((c) => catKey(c.name) === k);
  if (i < 0) i = cats.findIndex((c) => sameCat(c.name, name));
  return i;
}
function dashOut(e, regs, money) {
  const today = istToday();
  const rowsBy = e.cats.map((c) => ({ name: c.name, km: c.km, price: c.price, cap: c.cap, count: 0, paid: 0, unpaid: 0 }));
  const extra = new Map();
  for (const r of regs) {
    const i = catIndex(e.cats, r.cat);
    let row = i >= 0 ? rowsBy[i] : null;
    if (!row) {
      const nm = r.cat || 'No ticket name';
      row = extra.get(nm) || { name: nm, km: 0, price: 0, cap: 0, count: 0, paid: 0, unpaid: 0, unlisted: true };
      extra.set(nm, row);
    }
    row.count++;
    if (r.status === 'ok') row.paid++;
    else row.unpaid++;
  }
  const byCat = rowsBy.concat([...extra.values()]).map((r) => Object.assign(r, money ? { revenue: r.paid * r.price, pending: r.unpaid * r.price } : { price: null }));
  const total = regs.length;
  const capRows = byCat.filter((r) => r.cap > 0);
  const day = (iso) => String(iso || '').slice(0, 10);
  const perDay = new Map();
  regs.forEach((r) => {
    const d = day(r.at);
    if (validDate(d)) perDay.set(d, (perDay.get(d) || 0) + 1);
  });
  const dates = [...perDay.keys()].sort();
  const series = [];
  if (dates.length) {
    const start = dates[0] < istShift(today, -119) ? istShift(today, -119) : dates[0];
    let run = 0;
    dates.forEach((d) => {
      if (d < start) run += perDay.get(d);
    });
    for (let d = start; d <= today; d = istShift(d, 1)) {
      run += perDay.get(d) || 0;
      series.push([d, run]);
    }
  }
  const wk = (from, to) => [...perDay.entries()].filter(([d]) => d >= istShift(today, from) && d <= istShift(today, to)).reduce((s, [, n]) => s + n, 0);
  return {
    total,
    paid: regs.filter((r) => r.status === 'ok').length,
    unpaid: regs.filter((r) => r.status !== 'ok').length,
    capacity: capRows.length ? capRows.reduce((s, r) => s + r.cap, 0) : null,
    revenue: money ? byCat.reduce((s, r) => s + r.revenue, 0) : null,
    pending: money ? byCat.reduce((s, r) => s + r.pending, 0) : null,
    byCat,
    series,
    week: { thisWeek: wk(-6, 0), prevWeek: wk(-13, -7) },
    hasCats: e.cats.length > 0,
  };
}
const istShift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const dashboard = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg);
  const e = eventOut(await getEvent(arg.ev));
  return dashOut(e, await rows(REGS, e.id).catch(() => []), a.role !== 'viewer');
});
// One card per race for the dashboard: when, where, how many registered, how many categories, takings.
export const racesSummary = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg);
  const evs = (await all(() => wixData.query(EVENTS).ascending('_id'))).filter((x) => (x.status || 'open') !== 'archived').map(eventOut);
  const regsOf = await Promise.all(evs.map((e) => rows(REGS, e.id).catch(() => [])));
  const out = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    const d = dashOut(e, regsOf[i], a.role !== 'viewer');
    out.push({ id: e.id, name: e.name, date: e.date, venue: e.venue, status: e.status, daysToGo: e.daysToGo, bannerUrl: e.bannerUrl, total: d.total, capacity: d.capacity, revenue: d.revenue, cats: d.byCat.map((r) => ({ name: r.name, count: r.count, cap: r.cap })) });
  }
  out.sort((x, y) => String(x.date || '9999').localeCompare(String(y.date || '9999')));
  return { races: out };
});

/* ---------- BIB and Expo desk: bib numbers, sending runners to the Expo desk, live desk figures ---------- */
// The Race Director owns the registration list and the bib plan. The Expo desk owns what happens at handover.
// Rules that protect the desk:
//   - a bib number, once given, is never changed here if the runner is already in the Expo list
//   - runners are sent as NEW rows; a row the Expo desk already has is never replaced, only its empty fields are filled
//   - a row whose bib was handed over is left completely alone, and so is its T-shirt size once the shirt is issued
//   - nothing is ever deleted from the Expo list from here
const EXPO_CONFIG = 'ExpoConfig';
const XSIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const expoDocId = (b) => {
  const s = String(b).trim().replace(/[^A-Za-z0-9_\-.~:@+]/g, '-').slice(0, 100);
  return s === '.' || s === '..' || !s ? 'x' + s : s;
};
const normSize = (v) => {
  const s = String(v || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
  const map = { SMALL: 'S', MEDIUM: 'M', LARGE: 'L', XLARGE: 'XL', EXTRALARGE: 'XL', '2XL': 'XXL', XXLARGE: 'XXL', XSMALL: 'XS', EXTRASMALL: 'XS' };
  const t = map[s] || s;
  return XSIZES.includes(t) ? t : '';
};
const nameKey = (n) => lc(n).replace(/[^a-z0-9]/g, '');
const maskName = (n) => {
  const p = String(n || '').trim().split(/\s+/).filter(Boolean);
  return p.length ? p[0] + (p[1] ? ' ' + p[1][0] + '.' : '') : '';
};
async function expoConfigOf(expoId) {
  const it = expoId ? await wixData.get(EXPO_CONFIG, expoId, SA).catch(() => null) : null;
  if (!it) return null;
  let c = {};
  try {
    c = it.json ? JSON.parse(it.json) : {};
  } catch (e) {
    c = {};
  }
  const lot = {};
  XSIZES.forEach((z) => (lot[z] = Math.max(0, parseInt(c.shirtLot && c.shirtLot[z], 10) || 0)));
  return { name: String(it.name || c.name || expoId), bibLot: Math.max(0, parseInt(c.bibLot, 10) || 0), shirtLot: lot };
}
// Every Expo race the software knows: the settings rows the Expo desk keeps in ExpoConfig, plus every findmybib
// "Import..." collection in the CMS (so a race shows up here before anyone has opened the desk for it).
async function expoRaceList() {
  const have = await all(() => wixData.query(EXPO_CONFIG).ascending('_id')).catch(() => []);
  const byId = new Map(have.map((r) => [r._id, String(r.name || r._id)]));
  try {
    const list = elevate(collections.listDataCollections);
    const r = await list({ paging: { limit: 100 } });
    (r.collections || []).forEach((c) => {
      const id = String(c._id || c.id || '');
      if (/^import/i.test(id) && !byId.has(id)) byId.set(id, String(c.displayName || '').trim() || id);
    });
  } catch (e) {
    // best effort: the races already known from the Expo desk are still listed
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
export const expoRaces = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  return { races: await expoRaceList() };
});

function cleanBibRanges(list) {
  if (!Array.isArray(list) || list.length > 20) throw new Error('bad_bibs');
  const out = list.map((r) => {
    const cat = clean(r && r.cat, 40);
    const from = Number(r && r.from);
    const to = Number(r && r.to);
    if (cat.length < 2 || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 99999 || from > to) throw new Error('bad_bibs');
    return { cat, from, to };
  });
  const seen = new Set();
  for (const r of out) {
    if (seen.has(catKey(r.cat))) throw new Error('bad_bibs');
    seen.add(catKey(r.cat));
  }
  const sorted = out.slice().sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].from <= sorted[i - 1].to) throw new Error('bad_bibs');
  return out;
}
function bibRangesOf(it) {
  try {
    const j = it.json ? JSON.parse(it.json) : {};
    return Array.isArray(j.bibs) ? j.bibs : [];
  } catch (e) {
    return [];
  }
}
export const saveBibPlan = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const old = await getEvent(arg.ev);
  const bibs = cleanBibRanges(arg.bibs);
  let j = {};
  try {
    j = old.json ? JSON.parse(old.json) : {};
  } catch (e) {
    j = {};
  }
  j.bibs = bibs;
  await wixData.update(EVENTS, Object.assign({}, old, { json: JSON.stringify(j) }), SA);
  return { bibs };
});

const rangeFor = (ranges, cat) => ranges.find((r) => sameCat(r.cat, cat)) || null;
async function expoRunners(e) {
  return e.expoId ? await rows(RUNNERS, e.expoId).catch(() => []) : [];
}
// Gives the next free number in the category's range to every paid registration that has no bib yet. Never changes a bib.
export const assignBibs = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const ranges = bibRangesOf(it);
  if (!ranges.length) throw new Error('no_bib_plan');
  const regs = await rows(REGS, e.id).catch(() => []);
  const runners = await expoRunners(e);
  const used = new Set(regs.filter((r) => r.bib).map((r) => String(r.bib)));
  runners.forEach((r) => used.add(String(r.bib || '')));
  const todo = regs.filter((r) => r.status === 'ok' && !r.bib).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.ticketNumber).localeCompare(String(b.ticketNumber)));
  const next = new Map();
  const out = { assigned: 0, alreadyHad: regs.filter((r) => r.bib).length, noRange: {}, full: {}, unpaid: regs.filter((r) => r.status !== 'ok' && !r.bib).length };
  const upd = [];
  for (const r of todo) {
    const rg = rangeFor(ranges, r.cat);
    if (!rg) {
      const k = r.cat || '(no ticket name)';
      out.noRange[k] = (out.noRange[k] || 0) + 1;
      continue;
    }
    let n = next.get(rg.cat) || rg.from;
    while (n <= rg.to && used.has(String(n))) n++;
    if (n > rg.to) {
      out.full[rg.cat] = (out.full[rg.cat] || 0) + 1;
      next.set(rg.cat, n);
      continue;
    }
    used.add(String(n));
    next.set(rg.cat, n + 1);
    upd.push(Object.assign({}, r, { bib: String(n) }));
    out.assigned++;
  }
  for (let i = 0; i < upd.length; i += 200) await wixData.bulkUpdate(REGS, upd.slice(i, i + 200), SA);
  return out;
});
// One exception: give a runner a particular number. Refused if taken, or if the runner is already in the Expo list.
export const setBib = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const e = eventOut(await getEvent(arg.ev));
  const r = await wixData.get(REGS, String(arg.id || ''), SA).catch(() => null);
  if (!r || r.event !== e.id) throw new Error('no_registration');
  const bib = clean(arg.bib, 12).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{1,12}$/.test(bib)) throw new Error('bad_bib');
  if (r.bib && String(r.bib) === bib) return { bib };
  if (e.expoId && r.bib) {
    const inExpo = await wixData.get(RUNNERS, e.expoId + '~' + expoDocId(r.bib), SA).catch(() => null);
    if (inExpo) throw new Error('bib_in_expo');
  }
  const regs = await rows(REGS, e.id).catch(() => []);
  if (regs.some((x) => x._id !== r._id && String(x.bib) === bib)) throw new Error('bib_taken');
  if (e.expoId) {
    const clash = await wixData.get(RUNNERS, e.expoId + '~' + expoDocId(bib), SA).catch(() => null);
    if (clash) throw new Error('bib_taken');
  }
  await wixData.update(REGS, Object.assign({}, r, { bib }), SA);
  return { bib };
});

// Sends paid, numbered registrations to the Expo desk as new runners.
export const sendToExpo = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, 'manage');
  const e = eventOut(await getEvent(arg.ev));
  if (!e.expoId) throw new Error('no_expo_link');
  if (!(await expoConfigOf(e.expoId))) throw new Error('expo_race_missing');
  const regs = await rows(REGS, e.id).catch(() => []);
  const runners = await expoRunners(e);
  const byId = new Map(runners.map((r) => [r._id, r]));
  const out = { added: 0, filled: 0, same: 0, locked: 0, conflicts: [], unpaid: 0, noBib: 0 };
  const ins = [];
  const upd = [];
  const seen = new Set();
  for (const r of regs) {
    if (r.status !== 'ok') {
      if (r.bib) out.unpaid++;
      continue;
    }
    if (!r.bib) {
      out.noBib++;
      continue;
    }
    const id = e.expoId + '~' + expoDocId(r.bib);
    if (seen.has(id)) continue;
    seen.add(id);
    const old = byId.get(id);
    if (!old) {
      ins.push({ _id: id, event: e.expoId, bib: String(r.bib), name: clean(r.name, 60), bibName: clean(r.bibName, 40), cat: clean(r.cat, 20), size: normSize(r.size), phone: clean(r.phone, 20), email: clean(r.email, 80), example: '', checkedInAt: '', checkedInDesk: '', bibAt: '', bibDesk: '', shirtSize: '', shirtAt: '', shirtDesk: '' });
      continue;
    }
    if (old.name && nameKey(old.name) !== nameKey(r.name)) {
      out.conflicts.push(String(r.bib));
      continue;
    }
    if (old.bibAt) {
      out.locked++;
      continue;
    }
    const fill = {};
    if (!old.size && normSize(r.size) && !old.shirtAt) fill.size = normSize(r.size);
    if (!old.phone && r.phone) fill.phone = clean(r.phone, 20);
    if (!old.email && r.email) fill.email = clean(r.email, 80);
    if (!old.bibName && r.bibName) fill.bibName = clean(r.bibName, 40);
    if (!old.cat && r.cat) fill.cat = clean(r.cat, 20);
    if (Object.keys(fill).length) {
      upd.push(Object.assign({}, old, fill));
      out.filled++;
    } else out.same++;
  }
  for (let i = 0; i < ins.length; i += 200) await wixData.bulkInsert(RUNNERS, ins.slice(i, i + 200), SA);
  for (let i = 0; i < upd.length; i += 200) await wixData.bulkUpdate(RUNNERS, upd.slice(i, i + 200), SA);
  out.added = ins.length;
  out.conflicts = out.conflicts.slice(0, 20);
  expoCache.delete(e.expoId);
  return out;
});

function expoStats(e, regs, runners, cfg, ranges) {
  const cats = new Map();
  const row = (c) => {
    const k = c || '(no category)';
    if (!cats.has(k)) cats.set(k, { cat: k, total: 0, checkedIn: 0, bibs: 0, shirts: 0 });
    return cats.get(k);
  };
  const desks = new Map();
  const dk = (d) => {
    const k = d || 'unknown';
    if (!desks.has(k)) desks.set(k, { desk: k, checkIns: 0, bibs: 0, shirts: 0, last: '' });
    return desks.get(k);
  };
  const events = [];
  for (const r of runners) {
    const c = row(r.cat);
    c.total++;
    if (r.checkedInAt) {
      c.checkedIn++;
      const d = dk(r.checkedInDesk);
      d.checkIns++;
      if (r.checkedInAt > d.last) d.last = r.checkedInAt;
      events.push({ at: r.checkedInAt, what: 'checked in', who: maskName(r.name), bib: r.bib, desk: r.checkedInDesk || '' });
    }
    if (r.bibAt) {
      c.bibs++;
      const d = dk(r.bibDesk);
      d.bibs++;
      if (r.bibAt > d.last) d.last = r.bibAt;
      events.push({ at: r.bibAt, what: 'bib given', who: maskName(r.name), bib: r.bib, desk: r.bibDesk || '' });
    }
    if (r.shirtAt) {
      c.shirts++;
      const d = dk(r.shirtDesk);
      d.shirts++;
      if (r.shirtAt > d.last) d.last = r.shirtAt;
      events.push({ at: r.shirtAt, what: 'T-shirt ' + (r.shirtSize || '') + ' given', who: maskName(r.name), bib: r.bib, desk: r.shirtDesk || '' });
    }
  }
  const sizes = XSIZES.map((z) => {
    const demand = runners.filter((r) => normSize(r.size) === z).length;
    const given = runners.filter((r) => r.shirtAt && r.shirtSize === z).length;
    const stock = cfg ? cfg.shirtLot[z] : 0;
    return { size: z, demand, given, stock, short: stock > 0 && demand > stock };
  });
  const noSize = runners.filter((r) => !normSize(r.size) && !r.shirtAt).length;
  const paid = regs.filter((r) => r.status === 'ok');
  const have = new Set(runners.map((r) => r._id));
  const sync = {
    paid: paid.length,
    withBib: paid.filter((r) => r.bib).length,
    noBib: paid.filter((r) => !r.bib).length,
    notSent: paid.filter((r) => r.bib && !have.has(e.expoId + '~' + expoDocId(r.bib))).length,
    unpaidWithBib: regs.filter((r) => r.status !== 'ok' && r.bib).length,
  };
  const plan = ranges.map((rg) => ({ cat: rg.cat, from: rg.from, to: rg.to, size: rg.to - rg.from + 1, used: regs.filter((r) => r.bib && sameCat(rg.cat, r.cat)).length }));
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    linked: !!e.expoId && !!cfg,
    expoId: e.expoId,
    expoName: cfg ? cfg.name : '',
    totals: { runners: runners.length, checkedIn: runners.filter((r) => r.checkedInAt).length, bibs: runners.filter((r) => r.bibAt).length, shirts: runners.filter((r) => r.shirtAt).length },
    bibLot: cfg ? cfg.bibLot : 0,
    byCat: Array.from(cats.values()).sort((a, b) => a.cat.localeCompare(b.cat)),
    sizes,
    noSize,
    desks: Array.from(desks.values()).sort((a, b) => a.desk.localeCompare(b.desk)),
    recent: events.slice(0, 10),
    sync,
    plan,
  };
}
// Live figures from the Expo desk for this race. No phone numbers or e-mails; names are shortened ("Anil K.").
export const expoSummary = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const [regs, runners, cfg] = await Promise.all([rows(REGS, e.id).catch(() => []), expoRunners(e), expoConfigOf(e.expoId)]);
  return expoStats(e, regs, runners, cfg, bibRangesOf(it));
});
// The few alerts the Expo side adds to the overview.
async function expoAlerts(e, it) {
  if (!e.expoId || e.daysToGo === null || e.daysToGo > 30 || e.daysToGo < -1) return [];
  const [regs, runners, cfg] = await Promise.all([rows(REGS, e.id).catch(() => []), expoRunners(e), expoConfigOf(e.expoId)]);
  if (!cfg) return [{ level: 'warn', text: 'The linked Expo race "' + e.expoId + '" was not found. Ask a director to check the Expo race in Settings.', go: 'bibs' }];
  const s = expoStats(e, regs, runners, cfg, bibRangesOf(it));
  const al = [];
  const near = e.daysToGo <= 7;
  if (s.sync.noBib) al.push({ level: near ? 'warn' : 'info', text: s.sync.noBib + ' paid runner' + (s.sync.noBib > 1 ? 's' : '') + ' without a bib number', go: 'bibs' });
  if (s.sync.notSent) al.push({ level: near ? 'warn' : 'info', text: s.sync.notSent + ' numbered runner' + (s.sync.notSent > 1 ? 's' : '') + ' not sent to the Expo desk yet', go: 'bibs' });
  const short = s.sizes.filter((z) => z.short);
  if (short.length) al.push({ level: 'warn', text: 'T-shirt stock is short for size ' + short.map((z) => z.size + ' (' + z.demand + ' needed, ' + z.stock + ' in stock)').join(', '), go: 'bibs' });
  if (s.bibLot && s.totals.runners > s.bibLot) al.push({ level: 'warn', text: 'More runners (' + s.totals.runners + ') than printed bibs (' + s.bibLot + ')', go: 'bibs' });
  return al;
}

/* ---------- RaceOS AI: briefing, forecasts, Ask, drafts ---------- */
// Everything here works without an AI key (rule-based figures and template drafts). With the secret ANTHROPIC_API_KEY
// set, the same facts are written up by the model. What is sent to the model is only counts, dates, item titles and
// the director's own typed question: never names, phone numbers or e-mail addresses of runners, volunteers or contacts.
// Money figures are only added for roles that may see money.
const AI_PER_HOUR = 40;
async function aiGate(a) {
  const key = 'ai|' + lc(a.username) + '|' + nowIso().slice(0, 13);
  const row = await wixData.get(RATE, key, SA).catch(() => null);
  const n = row ? int(row.n) : 0;
  if (n >= AI_PER_HOUR) throw new Error('busy_try_later');
  await wixData.save(RATE, { _id: key, n: String(n + 1) }, SA);
}
const longDate = (d) => (validDate(d) ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const rs = (n) => '₹' + Math.round(num(n)).toLocaleString('en-IN');

async function aiSnapshot(a, arg) {
  const e = eventOut(await getEvent(arg.ev));
  const money = a.role !== 'viewer';
  const [ov, regs, planRows] = await Promise.all([overview({ token: arg.token, ev: e.id }), rows(REGS, e.id).catch(() => []), rows(PLAN, e.id)]);
  const d = dashOut(e, regs, money);
  const today = istToday();
  const visible = (r) => r.kind !== 'contact' && !(a.role === 'viewer' && isSecret(r.kind));
  const brief = (r) => ({ kind: r.kind, title: clean(r.title, 80), due: r.due || '', status: r.status });
  const overdue = planRows.filter((r) => visible(r) && planOverdue(r, today)).sort(planSort).slice(0, 8).map(brief);
  const soon = planRows.filter((r) => visible(r) && r.due && r.due >= today && r.due <= istShift(today, 3) && !planDone(r)).sort(planSort).slice(0, 8).map(brief);
  const shifts = await rows(SHIFTS, e.id);
  const c = await shiftCounts(e.id);
  const unfilled = shifts.map((s) => ({ role: clean(s.role, 60), date: s.date, need: int(s.need), taken: (c.get(s._id) || { taken: 0 }).taken })).filter((s) => s.need > s.taken).slice(0, 8);
  return { e, ov, d, overdue, soon, unfilled, money, today };
}

// Simple trend forecasts. Plain arithmetic on the numbers above; they are estimates, not promises.
function aiForecast(s) {
  const { e, d, ov } = s;
  const days = e.daysToGo;
  const out = { daysToGo: days, notes: [] };
  const ser = d.series;
  const reg = { total: d.total, capacity: d.capacity };
  if (days === null || days < 0) {
    reg.state = days === null ? 'no_date' : 'finished';
  } else if (ser.length < 3 || d.total < 5) {
    reg.state = 'too_early';
  } else {
    const back = Math.min(14, ser.length - 1);
    const rate = Math.max(0, (ser[ser.length - 1][1] - ser[ser.length - 1 - back][1]) / back);
    const room = d.capacity === null ? Infinity : Math.max(0, d.capacity - d.total);
    const proj = (f) => Math.round(d.total + Math.min(room, rate * f * days));
    reg.state = 'ok';
    reg.perDay = Math.round(rate * 10) / 10;
    reg.low = proj(0.6);
    reg.expected = proj(1);
    reg.high = proj(1.5);
    reg.basis = back;
    reg.sellOutDate = null;
    if (d.capacity !== null && room > 0 && rate > 0) {
      const when = Math.ceil(room / rate);
      if (when <= days) reg.sellOutDate = istShift(s.today, when);
    }
    reg.unfilled = d.capacity === null ? null : Math.max(0, d.capacity - reg.expected);
    out.notes.push('Registration forecast continues the last ' + back + ' days at the same pace. Sign-ups usually speed up in the final fortnight, so the high figure is not unrealistic.');
  }
  out.registrations = reg;
  const v = ov.volunteers;
  const gap = Math.max(0, v.need - v.taken);
  out.volunteers = { need: v.need, taken: v.taken, gap, waiting: v.applied, couldClose: Math.min(v.applied, gap), remaining: Math.max(0, gap - v.applied), perDayNeeded: days && days > 0 ? Math.round((Math.max(0, gap - v.applied) / days) * 10) / 10 : null };
  if (s.money && ov.plan && ov.plan.budget) {
    const b = ov.plan.budget;
    const paid = d.byCat.reduce((t, r) => t + r.paid, 0);
    const avgFee = paid > 0 ? d.revenue / paid : (d.byCat.filter((r) => r.price > 0).reduce((t, r) => t + r.price, 0) / (d.byCat.filter((r) => r.price > 0).length || 1)) || 0;
    const extra = reg.state === 'ok' ? Math.max(0, reg.expected - d.total) : 0;
    const regRev = d.revenue + extra * avgFee;
    const sponsorCash = ov.plan.sponsors ? ov.plan.sponsors.cashPromised : 0;
    const spend = Math.max(b.expPlanned, b.expActual);
    out.budget = {
      avgFee: Math.round(avgFee),
      registrationRevenueNow: Math.round(d.revenue),
      registrationRevenueExpected: Math.round(regRev),
      sponsorCash,
      expectedSpend: Math.round(spend),
      expectedNet: Math.round(regRev + sponsorCash - spend),
      breakEvenRegistrations: avgFee > 0 ? Math.ceil(Math.max(0, spend - sponsorCash) / avgFee) : null,
    };
    out.notes.push('Budget forecast = registration revenue at the average fee + confirmed sponsor cash − the larger of planned and actual expenses. Budget income lines are not added, to avoid counting registrations twice.');
  }
  return out;
}

function aiFacts(s, fc) {
  const { e, d, ov, money } = s;
  const f = [];
  const reg = fc.registrations;
  f.push('Race: ' + e.name + (e.date ? ', ' + e.date : '') + (e.venue ? ', ' + e.venue : '') + (e.daysToGo !== null ? ' (' + (e.daysToGo > 0 ? e.daysToGo + ' days to go' : e.daysToGo === 0 ? 'race day' : 'finished') + ')' : ''));
  f.push('Registrations: ' + d.total + (d.capacity ? ' of ' + d.capacity + ' capacity' : '') + ', ' + d.week.thisWeek + ' this week, ' + d.week.prevWeek + ' the week before, ' + d.unpaid + ' payment pending.');
  if (d.byCat.length) f.push('By category: ' + d.byCat.map((c) => c.name + ' ' + c.count + (c.cap ? '/' + c.cap : '')).join('; ') + '.');
  if (reg.state === 'ok') f.push('Forecast at the current pace: about ' + reg.expected + ' by race day (range ' + reg.low + ' to ' + reg.high + ')' + (reg.sellOutDate ? '; capacity could be reached around ' + reg.sellOutDate : '') + '.');
  if (money) f.push('Revenue so far ' + rs(d.revenue) + (d.pending ? ', ' + rs(d.pending) + ' awaiting payment' : '') + '.');
  const v = fc.volunteers;
  f.push('Volunteers: ' + v.taken + ' of ' + v.need + ' spots filled, ' + v.waiting + ' applications waiting' + (v.gap ? '; ' + v.remaining + ' spots still unfilled even if all waiting applicants are approved' : '') + '.');
  if (s.unfilled.length) f.push('Shifts not full: ' + s.unfilled.map((x) => x.role + ' ' + x.date + ' (' + x.taken + '/' + x.need + ')').join('; ') + '.');
  f.push('Pacers ' + ov.pacers.have + ' of ' + ov.pacers.need + ' needed. Safety checklist ' + ov.checklist.done + ' of ' + ov.checklist.total + '. Run of show ' + ov.run.done + ' of ' + ov.run.total + '. Open incidents ' + ov.log.open + '.');
  if (ov.plan) {
    f.push('Plan tasks done ' + ov.plan.tasks.done + ' of ' + ov.plan.tasks.total + ', ' + ov.plan.tasks.blocked + ' blocked, ' + ov.plan.overdue + ' items overdue. Permits approved ' + ov.plan.approvals.permits.approved + ' of ' + ov.plan.approvals.permits.total + '.');
    if (money && ov.plan.budget) {
      const b = ov.plan.budget;
      f.push('Budget: expenses planned ' + rs(b.expPlanned) + ', spent ' + rs(b.expActual) + ', committed but unpaid ' + rs(b.committedUnpaid) + '.');
      if (ov.plan.sponsors) f.push('Sponsors: cash promised ' + rs(ov.plan.sponsors.cashPromised) + ', received ' + rs(ov.plan.sponsors.cashReceived) + ', still in pipeline ' + rs(ov.plan.sponsors.pipeline) + '.');
      if (fc.budget) f.push('Projected result: ' + rs(fc.budget.expectedNet) + (fc.budget.breakEvenRegistrations ? '; break-even needs about ' + fc.budget.breakEvenRegistrations + ' registrations' : '') + '.');
    }
  }
  if (s.overdue.length) f.push('Overdue: ' + s.overdue.map((x) => x.title + ' (due ' + x.due + ')').join('; ') + '.');
  if (s.soon.length) f.push('Due in the next 3 days: ' + s.soon.map((x) => x.title + ' (' + x.due + ')').join('; ') + '.');
  if (ov.alerts.length) f.push('Alerts: ' + ov.alerts.map((x) => x.text).join('; ') + '.');
  return f;
}

// Ordered list of what needs the director's attention today, from the figures alone.
function aiPriorities(s, fc) {
  const { e, d, ov, money } = s;
  const out = [];
  const add = (level, text, go) => out.push({ level, text, go });
  for (const x of ov.alerts) if (x.level === 'bad') add('bad', x.text, x.go);
  for (const x of ov.alerts) if (x.level === 'warn') add('warn', x.text, x.go);
  const reg = fc.registrations;
  if (reg.state === 'ok') {
    if (d.capacity && reg.sellOutDate) add('info', 'At this pace the race fills up around ' + longDate(reg.sellOutDate) + '. Decide now whether to open more places.', 'regs');
    else if (reg.unfilled > 0 && e.daysToGo <= 30) add('warn', 'About ' + reg.unfilled + ' places may stay empty at the current pace. A push on social media and club groups could help.', 'regs');
    if (d.week.prevWeek >= 5 && d.week.thisWeek < d.week.prevWeek * 0.6) add('warn', 'Sign-ups slowed: ' + d.week.thisWeek + ' this week against ' + d.week.prevWeek + ' last week.', 'regs');
  }
  if (fc.volunteers.remaining > 0) add(e.daysToGo !== null && e.daysToGo <= 14 ? 'warn' : 'info', 'Volunteers: ' + fc.volunteers.remaining + ' spots will stay open even after approving everyone waiting. Send a call for volunteers.', 'volunteers');
  if (fc.budget && fc.budget.expectedNet < 0) add('warn', 'At the current pace the race ends about ' + rs(-fc.budget.expectedNet) + ' short. Break-even needs about ' + fc.budget.breakEvenRegistrations + ' registrations or more sponsor cash.', 'money');
  if (money && ov.plan && ov.plan.sponsors && ov.plan.sponsors.outstanding > 0) add('info', rs(ov.plan.sponsors.outstanding) + ' of promised sponsor cash is not received yet.', 'money');
  for (const x of s.soon.slice(0, 3)) add('info', 'Due soon: ' + x.title + ' (' + x.due + ')', 'plan');
  for (const x of ov.alerts) if (x.level === 'info') add('info', x.text, x.go);
  const seen = new Set();
  return out.filter((x) => (seen.has(x.text) ? false : seen.add(x.text))).slice(0, 10);
}

function aiBriefText(s, fc) {
  const { e, d } = s;
  const parts = [];
  parts.push(e.name + (e.daysToGo !== null ? (e.daysToGo > 0 ? ' is ' + e.daysToGo + ' day' + (e.daysToGo > 1 ? 's' : '') + ' away.' : e.daysToGo === 0 ? ' is today.' : ' has finished.') : '.'));
  parts.push(d.total + ' registered' + (d.capacity ? ' of ' + d.capacity : '') + (d.week.thisWeek ? ', ' + d.week.thisWeek + ' of them this week' : '') + '.');
  parts.push('Volunteers: ' + fc.volunteers.taken + ' of ' + fc.volunteers.need + ' spots filled' + (fc.volunteers.waiting ? ', ' + fc.volunteers.waiting + ' applications waiting' : '') + '.');
  return parts.join(' ');
}

async function aiBuild(a, arg) {
  const s = await aiSnapshot(a, arg);
  const fc = aiForecast(s);
  return { s, fc, facts: aiFacts(s, fc) };
}

export const aiStatus = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  return { enabled: await aiEnabled() };
});

export const aiForecastNow = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg);
  const s = await aiSnapshot(a, arg);
  return { forecast: aiForecast(s), money: s.money };
});

// The daily briefing. Rule-based by default; with arg.write = true and a key, the model writes it up from the same facts.
export const aiBriefing = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg);
  const { s, fc, facts } = await aiBuild(a, arg);
  const out = { summary: aiBriefText(s, fc), priorities: aiPriorities(s, fc), forecast: fc, money: s.money, ai: false, text: '', enabled: await aiEnabled() };
  if (arg.write) {
    await aiGate(a);
    out.text = await askClaude(
      GROUND_RULES + ' Write a morning briefing for the race director: first one sentence on where the race stands, then at most five short bullet lines on what to do today, most urgent first, each naming a concrete action. Under 160 words.',
      '<data>\n' + facts.join('\n') + '\n</data>\nWrite today\'s briefing.',
      500
    );
    out.ai = true;
  }
  return out;
});

export const aiAsk = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg);
  const q = scrub(arg.q, 400);
  if (q.length < 3) throw new Error('question_needed');
  if (!(await aiEnabled())) throw new Error('no_ai_key');
  const { facts } = await aiBuild(a, arg);
  await aiGate(a);
  const answer = await askClaude(
    GROUND_RULES + ' Answer the director\'s question in under 120 words using only the facts. Offer one suggested next step when it is useful. If the money facts are absent, say the person\'s role does not include money figures.',
    '<data>\n' + facts.join('\n') + '\n</data>\nQuestion: ' + q,
    450
  );
  return { answer, q };
});

const DRAFTS = {
  runner_update: { who: 'runners', label: 'Update to registered runners' },
  pickup_info: { who: 'runners', label: 'Bib and T-shirt pickup details' },
  volunteer_call: { who: 'volunteers', label: 'Call for volunteers' },
  volunteer_thanks: { who: 'volunteers', label: 'Thank you to volunteers' },
  sponsor_pitch: { who: 'sponsor', label: 'Sponsorship pitch' },
  sponsor_thanks: { who: 'sponsor', label: 'Thank you to a sponsor', needSponsor: true },
  sponsor_report: { who: 'sponsor', label: 'Post-race sponsor report', needSponsor: true },
  social_post: { who: 'public', label: 'Social media post' },
};
function aiTemplate(kind, ch, s, fc, sp, notes, me) {
  const { e, d } = s;
  const when = longDate(e.date) || 'the race day';
  const at = e.venue ? ' at ' + e.venue : '';
  const extra = notes ? '\n\n' + notes : '';
  const sign = '\n\nWarm regards,\n' + me + '\nVisakha Trail Running Association';
  const T = {
    runner_update: ['Important details for ' + e.name, 'Hello runner,\n\n' + e.name + ' is on ' + when + at + '. ' + d.total + ' runners have registered so far.' + extra + '\n\nPlease read the race-day instructions, reach early, and carry your bib and a valid ID. See you at the start line!'],
    pickup_info: ['Bib and T-shirt pickup for ' + e.name, 'Hello runner,\n\nYour bib and T-shirt will be handed over at the expo desk before ' + e.name + ' on ' + when + '.' + extra + '\n\nPlease carry a photo ID and your registration confirmation. T-shirt size is final once it is handed over.'],
    volunteer_call: ['Volunteers needed for ' + e.name, 'Hello,\n\nWe still need ' + fc.volunteers.remaining + ' volunteers for ' + e.name + ' on ' + when + at + '. Roles include aid stations, marshalling, expo desk and finish line.' + extra + '\n\nIf you can give a few hours, please sign up using the volunteer link and we will confirm your shift.'],
    volunteer_thanks: ['Thank you from ' + e.name, 'Hello,\n\nThank you for giving your time to ' + e.name + '. The race could not happen without you.' + extra + '\n\nWe hope to see you again at the next one.'],
    sponsor_pitch: ['Partnering with ' + e.name, 'Dear ' + (sp.party || 'Sir or Madam') + ',\n\nThe Visakha Trail Running Association is organising ' + e.name + ' on ' + when + at + ', with about ' + (d.capacity || d.total) + ' runners.' + extra + '\n\nWe would be glad to share sponsorship options, including branding at the start, finish and expo, and mentions across our channels. May we set up a short call?'],
    sponsor_thanks: ['Thank you for supporting ' + e.name, 'Dear ' + (sp.party || 'partner') + ',\n\nThank you for supporting ' + e.name + '. Your help made it possible to bring ' + d.total + ' runners to ' + (e.venue || 'the start line') + '.' + extra + '\n\nWe will share a full report after the race.'],
    sponsor_report: ['Report: ' + e.name, 'Dear ' + (sp.party || 'partner') + ',\n\n' + e.name + ' took place on ' + when + at + ' with ' + d.total + ' registered runners.' + extra + '\n\nThank you again for your support. We would value your feedback and hope to work together again.'],
    social_post: ['', e.name + ' is on ' + when + at + '! ' + d.total + ' runners are in' + (d.capacity && d.capacity - d.total > 0 ? ', ' + (d.capacity - d.total) + ' places left' : '') + '.' + (notes ? ' ' + notes : '') + ' Register now and run with us.'],
  };
  const t = T[kind];
  if (ch === 'whatsapp') return { subject: '', body: (t[1].replace(/\n\n/g, '\n') + '\n- ' + me + ', VTRA').slice(0, 1200) };
  return { subject: t[0], body: t[1] + (kind === 'social_post' ? '' : sign) };
}
export const aiDraftKinds = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  return { kinds: Object.keys(DRAFTS).map((k) => ({ id: k, label: DRAFTS[k].label, who: DRAFTS[k].who, needSponsor: !!DRAFTS[k].needSponsor })) };
});
export const aiDraft = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'write');
  const kind = String(arg.kind || '');
  const def = DRAFTS[kind];
  if (!def) throw new Error('bad_draft');
  const ch = arg.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const notes = scrub(arg.notes, 500);
  let sp = { party: scrub(arg.party, 80) };
  if (def.who === 'sponsor') {
    await planAuth(arg, 'sponsor', false);
    if (arg.sponsor) {
      const r = await wixData.get(PLAN, String(arg.sponsor), SA).catch(() => null);
      if (!r || r.kind !== 'sponsor' || r.event !== String(arg.ev)) throw new Error('no_sponsor');
      sp = { party: clean(r.party || r.title, 80), amount: num(r.amount), phase: r.phase, status: r.status };
    } else if (def.needSponsor) throw new Error('no_sponsor');
  }
  const { s, fc, facts } = await aiBuild(a, arg);
  const base = aiTemplate(kind, ch, s, fc, sp, notes, a.name);
  const wantAi = arg.useAi !== false && (await aiEnabled());
  if (!wantAi) return Object.assign(base, { ai: false, kind, channel: ch });
  await aiGate(a);
  const spLine = def.who === 'sponsor' ? 'Sponsor organisation: ' + (sp.party || 'not named') + (sp.phase ? '; type ' + sp.phase : '') + (a.role !== 'viewer' && sp.amount ? '; support ' + rs(sp.amount) : '') + '.\n' : '';
  const form = ch === 'whatsapp' ? 'a WhatsApp message under 90 words, no subject, at most one emoji' : 'an e-mail: first line "Subject: ...", then a blank line, then the body under 170 words';
  const text = await askClaude(
    GROUND_RULES + ' You write messages for the organisers to send, signed with their name. Do not promise anything that is not in the facts or the director\'s notes. Use a warm, direct tone.',
    '<data>\n' + facts.join('\n') + '\n' + spLine + 'Director notes: ' + (notes || 'none') + '\n</data>\nWrite ' + form + '. Purpose: ' + def.label + '. Sign as ' + a.name + ', Visakha Trail Running Association.',
    700
  );
  let subject = '';
  let body = text;
  if (ch === 'email') {
    const m = text.match(/^\s*subject:\s*(.+)\n+([\s\S]*)$/i);
    if (m) {
      subject = clean(m[1], 140);
      body = m[2].trim();
    } else subject = base.subject;
  }
  return { subject, body, ai: true, kind, channel: ch };
});

/* ---------- Team: who can log in, and what each login can do ---------- */
// The Team screen is the only place logins are made. A password is never sent back: a new or reset login gets a
// generated PIN (desk staff) or password (everyone else), shown once so the director can hand it over.
// Changing a login's role, desks, race or password ends its other sessions at once.
const TEAM_KINDS = ['director', 'lead', 'viewer', 'desk', 'coach'];
const STORE_ROLE = { director: 'admin', lead: 'lead', viewer: 'viewer', desk: 'desk', coach: 'coach' };
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const PRESENCE_FRESH_MS = 3 * 60 * 1000;
const WEAK = ['password', 'passw0rd', '123456', '1234567', '12345678', '123456789', 'qwerty', 'qwerty123', 'abc123', 'abcdef', '111111', '000000', '654321', 'admin', 'admin123', 'welcome', 'letmein', 'iloveyou', 'vtra', 'vtra123', 'visakha'];

// A note of who changed what, for the Team screen. Never holds a password or PIN. Best effort: it never stops the change.
async function audit(a, action, target, detail) {
  try {
    await wixData.insert(AUDIT, { at: nowIso(), by: a.username, action, target: clean(target, 60), detail: clean(detail, 200) }, SA);
  } catch (e) {
    // the note is lost, the change is not
  }
}
const findRace = (races, v) => races.find((r) => r.id.toLowerCase() === lc(v)) || races.find((r) => nameKey(r.name) === nameKey(v));
function teamOut(u, presence, races, me) {
  const kind = staffKind(u);
  const uname = String(unameOf(u));
  const rv = String(u.race || u.Race || u.races || '').split(',')[0].trim();
  const hit = rv ? findRace(races, rv) : null;
  const here = presence.get(lc(uname));
  const fresh = !!(here && here.desk && here.seen && Date.now() - Date.parse(here.seen) < PRESENCE_FRESH_MS);
  const listed = parseDesks(deskValueOf(u));
  return {
    username: uname,
    name: String(u.name || ''),
    role: kind,
    desks: kind === 'desk' ? (listed.length ? listed : DESKS.slice()) : [],
    anyDesk: kind === 'desk' && !listed.length,
    race: hit ? hit.id : rv,
    raceName: hit ? hit.name : rv,
    hasPassword: String(u.password || '') !== '',
    handTyped: needsUpgrade(u.password),
    locked: !!(u.lockUntil && Date.parse(u.lockUntil) > Date.now()),
    atDesk: fresh ? here.desk : '',
    you: lc(uname) === lc(me),
  };
}
const KIND_ORDER = { director: 0, lead: 1, viewer: 2, desk: 3, coach: 4, other: 5 };

export const listTeam = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  const [staff, races, pres, notes] = await Promise.all([staffRows(), expoRaceList(), all(() => wixData.query(PRES).ascending('_id')).catch(() => []), all(() => wixData.query(AUDIT).ascending('_id')).catch(() => [])]);
  const presence = new Map(pres.map((p) => [lc(p.username || p._id), p]));
  const team = staff.map((u) => teamOut(u, presence, races, a.username)).sort((x, y) => KIND_ORDER[x.role] - KIND_ORDER[y.role] || x.username.localeCompare(y.username));
  const recent = notes.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 15).map((n) => ({ at: n.at || '', by: n.by || '', action: n.action || '', target: n.target || '', detail: n.detail || '' }));
  return { team, races, desks: DESKS, roles: TEAM_KINDS, you: a.username, recent };
});

export const saveTeam = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  // Only plain text is accepted for these two: an array or object is refused, not quietly turned into text.
  const username = typeof (arg && arg.username) === 'string' ? lc(arg.username) : '';
  if (!USERNAME_RE.test(username)) throw new Error('bad_username');
  const kind = typeof (arg && arg.role) === 'string' ? arg.role : '';
  if (!TEAM_KINDS.includes(kind)) throw new Error('bad_role');
  const name = typeof (arg && arg.name) === 'string' ? clean(arg.name, 60) : '';
  if (name.length < 2) throw new Error('name_needed');
  const rows = await staffRows();
  const old = rows.find((r) => lc(unameOf(r)) === username);
  const editing = !!arg && arg.edit === true;
  if (editing && !old) throw new Error('no_member');
  if (!editing && old) throw new Error('username_taken');
  const self = !!old && lc(unameOf(old)) === lc(a.username);
  if (self && staffKind(old) !== kind) throw new Error('own_role');
  let desks = '';
  let race = '';
  if (kind === 'desk') {
    // Only the first 11 entries are looked at (there are three desks), so a huge list costs nothing.
    const list = Array.isArray(arg.desks) ? arg.desks : String(arg.desks || '').slice(0, 500).split(',');
    const given = list.slice(0, 11).map((x) => String(x).trim()).filter(Boolean);
    if (!given.length) throw new Error('desk_needed');
    if (given.length > 10 || given.some((x) => !canonDesk(x))) throw new Error('bad_desk');
    const want = parseDesks(given);
    desks = DESKS.filter((d) => want.includes(d)).join(',');
    const races = await expoRaceList();
    const rv = clean(arg.race, 100);
    if (rv) {
      const hit = findRace(races, rv);
      if (!hit) throw new Error('bad_race');
      race = hit.id;
    } else if (races.length > 1) throw new Error('race_needed');
  }
  let secret = '';
  const rawPw = arg && arg.password;
  if (rawPw !== undefined && rawPw !== null && typeof rawPw !== 'string') throw new Error('bad_password');
  let pw = rawPw || '';
  if (pw) {
    if (pw.length < 6 || pw.length > 72) throw new Error('bad_password');
    if (WEAK.includes(lc(pw)) || lc(pw) === username) throw new Error('weak_password');
  } else if (!editing) {
    pw = kind === 'desk' ? genPin() : genPassword();
    secret = pw;
  }
  const keepRole = editing && staffKind(old) === kind && String(old.role || old.Role || '').trim() !== '';
  const fields = {
    username: editing ? String(unameOf(old)) : username,
    password: pw ? hashPassword(pw) : String(old.password || ''),
    role: keepRole ? String(old.role || old.Role) : STORE_ROLE[kind],
    desks,
    race,
    name,
  };
  if (!editing || pw) Object.assign(fields, { failCount: '0', lockUntil: '' });
  const write = (f) => (editing ? wixData.update(STAFF, Object.assign({}, old, f), SA) : wixData.insert(STAFF, Object.assign({ failCount: '0', lockUntil: '' }, f), SA));
  let saved;
  let warn = '';
  try {
    saved = await write(fields);
  } catch (e) {
    // A collection made by the old Expo setup has no 'race' column. Save the rest and say so.
    if (!race) throw e;
    const without = Object.assign({}, fields);
    delete without.race;
    saved = await write(without);
    warn = 'race_column_missing';
  }
  if (editing) {
    const changed = staffKind(old) !== kind || parseDesks(deskValueOf(old)).join() !== desks || String(old.race || '') !== race || !!pw;
    if (changed) await dropAccess(String(unameOf(old)), self ? a.sess.token : '', self);
    // A new password also gives back the tries used up by wrong guesses.
    if (pw) await freeSlots(wixData, RATE, slotKey('att', unameOf(old)), LOGIN_TRIES, LOGIN_WINDOW_MS, SA);
  }
  await audit(a, editing ? 'login changed' : 'login created', username, kind + (kind === 'desk' ? ': ' + desks + (race ? ' · ' + race : '') : '') + (pw && editing ? ' · password changed' : ''));
  const races = kind === 'desk' ? await expoRaceList() : [];
  return { member: teamOut(Object.assign({}, saved, race ? { race } : {}), new Map(), races, a.username), secret, warn };
});

export const resetTeamSecret = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  const username = lc(arg && arg.username);
  const old = (await staffRows()).find((r) => lc(unameOf(r)) === username);
  if (!old) throw new Error('no_member');
  const secret = staffKind(old) === 'desk' ? genPin() : genPassword();
  await wixData.update(STAFF, Object.assign({}, old, { password: hashPassword(secret), failCount: '0', lockUntil: '' }), SA);
  await freeSlots(wixData, RATE, slotKey('att', unameOf(old)), LOGIN_TRIES, LOGIN_WINDOW_MS, SA);
  const self = lc(unameOf(old)) === lc(a.username);
  await dropAccess(String(unameOf(old)), self ? a.sess.token : '', self);
  await audit(a, 'password reset', String(unameOf(old)), staffKind(old));
  return { username: String(unameOf(old)), secret };
});

export const signOutTeam = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  const username = lc(arg && arg.username);
  const old = (await staffRows()).find((r) => lc(unameOf(r)) === username);
  if (!old) throw new Error('no_member');
  const self = lc(unameOf(old)) === lc(a.username);
  const ended = await dropAccess(String(unameOf(old)), self ? a.sess.token : '', self);
  await audit(a, 'signed out', String(unameOf(old)), ended + ' session' + (ended === 1 ? '' : 's'));
  return { ok: true, ended };
});

export const removeTeam = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, 'manage');
  const username = lc(arg && arg.username);
  const old = (await staffRows()).find((r) => lc(unameOf(r)) === username);
  if (!old) throw new Error('no_member');
  if (lc(unameOf(old)) === lc(a.username)) throw new Error('own_login');
  await wixData.bulkRemove(STAFF, [old._id], SA);
  await dropAccess(String(unameOf(old)), '', false);
  await audit(a, 'login removed', String(unameOf(old)), staffKind(old));
  return { ok: true };
});

/* ---------- one-time database setup ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  const def = (id, fields) => ({ _id: id, displayName: id, permissions: LOCKED, fields: fields.map(textField) });
  return [
    def(STAFF, ['username', 'password', 'role', 'desks', 'race', 'name', 'failCount', 'lockUntil']),
    def(SESS, ['token', 'username', 'desk', 'expires']),
    def(PRES, ['username', 'desk', 'seen']),
    def(EXPO_CONFIG, ['name', 'json']),
    def(EXPO_CHECKS, ['event', 'bib', 'name', 'pickupBy', 'friendName', 'friendPhone', 'method', 'selfie', 'at', 'desk']),
    def(AUDIT, ['at', 'by', 'action', 'target', 'detail']),
    def(RUNNERS, ['event', 'bib', 'name', 'bibName', 'cat', 'size', 'phone', 'email', 'example', 'checkedInAt', 'checkedInDesk', 'bibAt', 'bibDesk', 'shirtSize', 'shirtAt', 'shirtDesk']),
    def(EVENTS, ['name', 'date', 'venue', 'expoId', 'status', 'json']),
    def(SHIFTS, ['event', 'role', 'location', 'date', 'start', 'end', 'need', 'notes']),
    def(VOLS, ['event', 'name', 'phone', 'email', 'club', 'status', 'code', 'waiverAt', 'waiverVersion', 'createdAt', 'notes']),
    def(ASSIGN, ['event', 'volunteerId', 'shiftId', 'status', 'checkedInAt', 'checkedOutAt', 'hours', 'seq']),
    def(LOG, ['event', 'at', 'kind', 'place', 'text', 'severity', 'status', 'by', 'closedAt', 'resolution']),
    def(RUN, ['event', 'time', 'what', 'owner', 'status']),
    def(PACERS, ['event', 'name', 'phone', 'group', 'status', 'trial', 'briefing', 'kit', 'notes']),
    def(CHECK, ['event', 'section', 'item', 'done', 'doneBy', 'doneAt', 'order']),
    def(REGS, ['event', 'ticketNumber', 'orderNumber', 'guestId', 'name', 'email', 'phone', 'cat', 'size', 'bibName', 'status', 'form', 'at', 'bib']),
    def(QUALS, ['event', 'runnerId', 'name', 'cat', 'claim', 'claimKm', 'claimSec', 'link', 'status', 'note', 'by', 'at']),
    def(PLAN, ['event', 'kind', 'title', 'cat', 'phase', 'status', 'owner', 'party', 'contact', 'due', 'time', 'amount', 'amount2', 'ref', 'link', 'notes', 'order', 'by', 'at', 'tpl', 'lead', 'offset', 'docsDone']),
    def(RATE, ['n']),
  ];
}
async function makeCollections(onlyMissing) {
  const create = elevate(collections.createDataCollection);
  const notes = [];
  for (const d of collectionDefs()) {
    if (onlyMissing) {
      try {
        await wixData.query(d._id).limit(1).find(SA);
        continue;
      } catch (e) {
        // missing, so create it below
      }
    }
    try {
      await create(d);
      notes.push(d._id + ' created');
    } catch (e) {
      notes.push(d._id + ': ' + ((e && e.message) || 'not created (it may already exist)'));
    }
  }
  return notes;
}
let collectionsChecked = false;
async function ensureCollections() {
  if (collectionsChecked) return;
  await makeCollections(true);
  collectionsChecked = true;
}

// Creates every RaceOS collection (the Expo desk's too; skips ones that exist) and, only if there is no login yet,
// the first admin. Needs SETUP_KEY, and refuses further guesses for an hour after 10 wrong ones.
const SETUP_TRIES_PER_HOUR = 10;
const setupMisses = new Map();
export const ensureSetup = webMethod(Permissions.Anyone, async (arg) => {
  if (SETUP_KEY === 'change-this-key') throw new Error('Edit SETUP_KEY at the top of racedir.web.js first');
  // Ten tries an hour, however fast they are sent (slots, see takeSlot). Before the first setup the collection for the
  // slots does not exist yet, so then this server's own count is used.
  const hour = nowIso().slice(0, 13);
  let slot = '';
  try {
    slot = await takeSlot(wixData, RATE, 'setup', SETUP_TRIES_PER_HOUR, 3600000, SA);
  } catch (e) {
    const n = setupMisses.get(hour) || 0;
    setupMisses.set(hour, n + 1);
    slot = n < SETUP_TRIES_PER_HOUR ? 'memory' : '';
  }
  if (!slot) throw new Error('busy_try_later');
  if (!arg || !same(String(arg.key || ''), SETUP_KEY)) throw new Error('Wrong setup key');
  // Only wrong keys use up the tries: the owner running the setup again is not held back.
  if (slot === 'memory') setupMisses.set(hour, Math.max(0, (setupMisses.get(hour) || 1) - 1));
  else await wixData.bulkRemove(RATE, [slot], SA).catch(() => null);
  const notes = await makeCollections(true);
  collectionsChecked = true;
  let have = [];
  try {
    have = (await wixData.query(STAFF).limit(1).find(SA)).items;
  } catch (e) {
    have = [];
  }
  const username = lc(clean(arg.username, 40));
  const password = String(arg.password || '');
  if (!have.length) {
    if (!USERNAME_RE.test(username) || password.length < 6 || password.length > 72) throw new Error('Username needs 3 to 30 letters, digits, dots, dashes or underscores, and the password 6+ characters');
    if (WEAK.includes(lc(password)) || lc(password) === username) throw new Error('That password is too easy to guess');
    await wixData.insert(STAFF, { username, password: hashPassword(password), role: 'admin', desks: '', race: '', name: '', failCount: '0', lockUntil: '' }, SA);
    notes.push('admin ' + username + ' added');
  } else notes.push('logins already exist, none added');
  return { summary: notes.join(' · ') };
});
