// backend/racedir.web.js
// Race Director backend for Wix (Velo), Phase 1: command centre, volunteers (public sign-up, approval,
// shifts, check-in and hours), race-day run of show and incident log, pacers, safety checklist.
//
// Logins are the same ExpoStaff rows the Expo desk uses. Role column:
//   admin or director  everything, including events and settings
//   lead               volunteers, race day, pacers and safety (read and write), no events or deletes
//   viewer             read only (sponsor or partner); sees no budget, sponsor or contact details
//   anything else (desk, empty) is refused here.
// Every method except login, ensureSetup, openShifts, volunteerSignup and volunteerStatus needs a session token.
import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { wixEventsV2, guests } from 'wix-events.v2';

const STAFF = 'ExpoStaff';
const SESS = 'ExpoSessions';
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

function newToken() {
  let t = '';
  for (let k = 0; k < 6; k++) t += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return t + Date.now().toString(16);
}
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
const roleOf = (u) => {
  const r = lc(u.role || u.Role);
  return r === 'admin' || r === 'director' ? 'director' : r === 'lead' ? 'lead' : r === 'viewer' ? 'viewer' : 'none';
};
const CAN = { director: { write: true, manage: true }, lead: { write: true, manage: false }, viewer: { write: false, manage: false } };

async function staffRows() {
  try {
    return (await wixData.query(STAFF).limit(200).find(SA)).items;
  } catch (e) {
    throw new Error('setup_needed');
  }
}

async function auth(arg, need) {
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
  const can = CAN[role];
  if (need === 'write' && !can.write) throw new Error('read_only');
  if (need === 'manage' && !can.manage) throw new Error('director_only');
  return { role, can, user: u, name: String(u.name || unameOf(u)), username: String(unameOf(u)), sess };
}
const meOf = (a) => ({ role: a.role, name: a.name, canWrite: a.can.write, canManage: a.can.manage });

export const health = webMethod(Permissions.Anyone, async () => ({ ok: true }));

export const login = webMethod(Permissions.Anyone, async (arg) => {
  const username = lc(arg && arg.username);
  const password = String((arg && arg.password) || '');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === username);
  if (!u || !username || !password) throw new Error('bad_login');
  if (u.lockUntil && Date.parse(u.lockUntil) > Date.now()) throw new Error('locked');
  const good = String(u.password || '') !== '' && same(u.password, password);
  if (!good) {
    const fails = int(u.failCount) + 1;
    await wixData.update(STAFF, Object.assign({}, u, fails >= 5 ? { failCount: '0', lockUntil: new Date(Date.now() + 10 * 60000).toISOString() } : { failCount: String(fails) }), SA);
    throw new Error(fails >= 5 ? 'locked' : 'bad_login');
  }
  if (u.failCount || u.lockUntil) await wixData.update(STAFF, Object.assign({}, u, { failCount: '0', lockUntil: '' }), SA);
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
  if (r.items.length) await wixData.bulkRemove(SESS, r.items.map((x) => x._id), SA);
  return { ok: true };
});

export const whoami = webMethod(Permissions.Anyone, async (arg) => meOf(await auth(arg)));

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

function eventOut(it) {
  let j = {};
  try {
    j = it.json ? JSON.parse(it.json) : {};
  } catch (e) {
    j = {};
  }
  const t = it.date ? Date.parse(it.date + 'T00:00:00+05:30') : NaN;
  return {
    id: it._id,
    name: it.name || '',
    date: it.date || '',
    venue: it.venue || '',
    expoId: it.expoId || '',
    status: it.status || 'open',
    distanceKm: Number(j.distanceKm) || 21.0975,
    groups: Array.isArray(j.groups) ? j.groups : DEFAULT_GROUPS,
    quals: Array.isArray(j.quals) ? j.quals : [],
    wixEventId: j.wixEventId || '',
    wixMap: j.wixMap && typeof j.wixMap === 'object' ? j.wixMap : {},
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
  const base = {
    name,
    date,
    venue: has('venue') || !old ? clean(arg.venue, 120) : old.venue || '',
    expoId: has('expoId') || !old ? clean(arg.expoId, 100) : old.expoId || '',
    status,
  };
  if (old) {
    let j = {};
    try {
      j = old.json ? JSON.parse(old.json) : {};
    } catch (e) {
      j = {};
    }
    if (has('distanceKm')) j.distanceKm = dist;
    const saved = await wixData.update(EVENTS, Object.assign({}, old, base, { json: JSON.stringify(j) }), SA);
    return { event: eventOut(saved), by: a.username };
  }
  const saved = await wixData.insert(EVENTS, Object.assign(base, { json: JSON.stringify({ distanceKm: has('distanceKm') ? dist : 21.0975, groups: DEFAULT_GROUPS }) }), SA);
  await wixData.bulkInsert(CHECK, DEFAULT_CHECKLIST.map(([section, item], k) => ({ event: saved._id, section, item, done: '', doneBy: '', doneAt: '', order: String(k).padStart(3, '0') })), SA);
  await wixData.bulkInsert(RUN, DEFAULT_RUN.map(([time, what, owner]) => ({ event: saved._id, time, what, owner, status: 'todo' })), SA);
  await seedPlan(saved._id, Object.keys(PLAN_DEFAULTS));
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
      at: nowIso(),
    });
  });
  const ids = Array.from(byId.keys());
  const old = ids.length ? (await wixData.query(REGS).hasSome('_id', ids).limit(1000).find(SA)).items : [];
  const have = new Set(old.map((o) => o._id));
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
    return { id: r._id, ticket: r.ticketNumber, name: r.name, email: r.email, phone: r.phone, cat: r.cat, size: r.size, bibName: r.bibName, unpaid: r.status === 'unpaid', inExpo };
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
  const status = String(arg.status || '');
  if (!['approved', 'rejected', 'waived', 'pending'].includes(status)) throw new Error('bad_status');
  // Waiving a rule is a director decision.
  const a = await auth(arg, status === 'waived' ? 'manage' : 'write');
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
  return {
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
  const kinds = (Array.isArray(arg.kinds) ? arg.kinds : [arg.kind]).map(kindOf);
  for (const k of kinds) await planAuth(arg, k, false);
  const it = await getEvent(arg.ev);
  const e = eventOut(it);
  const a = await auth(arg);
  const all = await rows(PLAN, e.id);
  const today = istToday();
  const out = {};
  for (const k of kinds) out[k] = all.filter((r) => r.kind === k).sort(planSort).map((r) => planOut(r, today));
  return { items: out, summary: planSummary(all, a.role, e), canMoney: a.role === 'director' };
});

export const savePlanItem = webMethod(Permissions.Anyone, async (arg) => {
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
  approval: [].concat(
    [
      ['Police permission for road use and traffic diversion', 'Police and traffic'],
      ['Municipal corporation permission for the route and venue', 'Municipal corporation'],
      ['Forest department permission (trail routes)', 'Forest department'],
      ['Fire safety clearance for the expo, stage and tents', 'Fire services'],
      ['Ambulance and hospital tie-up letter', 'Hospital'],
      ['Event insurance policy', 'Insurer'],
      ['Loudspeaker and sound permission', 'Police'],
      ['Drone permission (if drones are used)', 'Police or aviation'],
      ['Land or beach owner permission', 'Owner'],
      ['Food safety registration for aid-station food', 'Food safety'],
      ['Electricity and generator permission', 'Power utility'],
      ['Banner and hoarding permission', 'Municipal corporation'],
    ].map(([title, party]) => ({ kind: 'approval', phase: 'permit', cat: 'Permit', title, party })),
    [
      ['Weather go or no-go', 'Race Director'], ['Course cleared and marked', 'Route lead'], ['Medical team in position', 'Medical lead'],
      ['Police and traffic in position', 'Operations'], ['Start, timing and finish ready', 'Timing lead'], ['Aid stations stocked and staffed', 'Aid-station lead'],
      ['Volunteers and pacers briefed', 'Volunteer lead'], ['Final flag-off approval', 'Race Director'],
    ].map(([title, owner]) => ({ kind: 'approval', phase: 'raceday', cat: 'Sign-off', title, owner }))
  ),
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
async function seedPlan(ev, kinds) {
  const have = await rows(PLAN, ev);
  const made = {};
  const list = [];
  for (const k of kinds) {
    if (have.some((r) => r.kind === k)) continue;
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

/* ---------- one-time database setup ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  const def = (id, fields) => ({ _id: id, displayName: id, permissions: LOCKED, fields: fields.map(textField) });
  return [
    def(STAFF, ['username', 'password', 'role', 'desks', 'race', 'name', 'failCount', 'lockUntil']),
    def(SESS, ['token', 'username', 'desk', 'expires']),
    def(RUNNERS, ['event', 'bib', 'name', 'bibName', 'cat', 'size', 'phone', 'email', 'example', 'checkedInAt', 'checkedInDesk', 'bibAt', 'bibDesk', 'shirtSize', 'shirtAt', 'shirtDesk']),
    def(EVENTS, ['name', 'date', 'venue', 'expoId', 'status', 'json']),
    def(SHIFTS, ['event', 'role', 'location', 'date', 'start', 'end', 'need', 'notes']),
    def(VOLS, ['event', 'name', 'phone', 'email', 'club', 'status', 'code', 'waiverAt', 'waiverVersion', 'createdAt', 'notes']),
    def(ASSIGN, ['event', 'volunteerId', 'shiftId', 'status', 'checkedInAt', 'checkedOutAt', 'hours', 'seq']),
    def(LOG, ['event', 'at', 'kind', 'place', 'text', 'severity', 'status', 'by', 'closedAt', 'resolution']),
    def(RUN, ['event', 'time', 'what', 'owner', 'status']),
    def(PACERS, ['event', 'name', 'phone', 'group', 'status', 'trial', 'briefing', 'kit', 'notes']),
    def(CHECK, ['event', 'section', 'item', 'done', 'doneBy', 'doneAt', 'order']),
    def(REGS, ['event', 'ticketNumber', 'orderNumber', 'guestId', 'name', 'email', 'phone', 'cat', 'size', 'bibName', 'status', 'form', 'at']),
    def(QUALS, ['event', 'runnerId', 'name', 'cat', 'claim', 'claimKm', 'claimSec', 'link', 'status', 'note', 'by', 'at']),
    def(PLAN, ['event', 'kind', 'title', 'cat', 'phase', 'status', 'owner', 'party', 'contact', 'due', 'time', 'amount', 'amount2', 'ref', 'link', 'notes', 'order', 'by', 'at']),
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

// Creates the Director collections (skips ones that exist, including the Expo ones) and, only if there is no
// login yet, the first admin. Needs SETUP_KEY.
export const ensureSetup = webMethod(Permissions.Anyone, async (arg) => {
  if (SETUP_KEY === 'change-this-key') throw new Error('Edit SETUP_KEY at the top of racedir.web.js first');
  if (!arg || !same(String(arg.key || ''), SETUP_KEY)) throw new Error('Wrong setup key');
  const notes = await makeCollections(true);
  collectionsChecked = true;
  let have = [];
  try {
    have = (await wixData.query(STAFF).limit(1).find(SA)).items;
  } catch (e) {
    have = [];
  }
  const username = clean(arg.username, 40);
  const password = String(arg.password || '');
  if (!have.length) {
    if (username.length < 3 || password.length < 6) throw new Error('Username needs 3+ characters and password 6+');
    await wixData.insert(STAFF, { username, password, role: 'admin', desks: '', race: '', name: '', failCount: '0', lockUntil: '' }, SA);
    notes.push('admin ' + username + ' added');
  } else notes.push('logins already exist, none added');
  return { summary: notes.join(' · ') };
});
