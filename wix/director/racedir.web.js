// backend/racedir.web.js
// Race Director backend for Wix (Velo), Phase 1: command centre, volunteers (public sign-up, approval,
// shifts, check-in and hours), race-day run of show and incident log, pacers, safety checklist.
//
// Logins are the same ExpoStaff rows the Expo desk uses. Role column:
//   admin or director  everything, including events and settings
//   lead               volunteers, race day, pacers and safety (read and write), no events or deletes
//   viewer             read only (sponsor or partner)
//   anything else (desk, empty) is refused here.
// Every method except login, ensureSetup, openShifts, volunteerSignup and volunteerStatus needs a session token.
import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';

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
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'));
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
    bib: r.bib || '',
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
async function qualData(e) {
  if (!e.expoId) return { runners: [], quals: new Map() };
  const [runners, qs] = await Promise.all([rows(RUNNERS, e.expoId).catch(() => []), rows(QUALS, e.id).catch(() => [])]);
  return { runners, quals: new Map(qs.map((q) => [q.runnerId, q])) };
}
export const listQuals = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg);
  const e = eventOut(await getEvent(arg.ev));
  const d = await qualData(e);
  const list = d.runners.filter((r) => ruleFor(e, r.cat)).map((r) => qualOut(e, r, d.quals.get(r._id)));
  const rank = { noclaim: 0, below: 1, manual: 2, meets: 3 };
  list.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || rank[a.verdict] - rank[b.verdict] || a.name.localeCompare(b.name));
  const n = (f) => list.filter(f).length;
  return {
    rules: e.quals,
    hasExpo: !!e.expoId,
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
  const r = e.expoId ? await wixData.get(RUNNERS, String(arg.runnerId || ''), SA).catch(() => null) : null;
  if (!r || r.event !== e.expoId) throw new Error('no_runner');
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
  const [shifts, vols, asg, log, run, pacers, chk, expo] = await Promise.all([rows(SHIFTS, e.id), rows(VOLS, e.id), rows(ASSIGN, e.id), rows(LOG, e.id), rows(RUN, e.id), rows(PACERS, e.id), rows(CHECK, e.id), expoCounts(e.expoId)]);
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
  if (e.quals.length && e.expoId) {
    const qd = await qualData(e);
    qualPending = qd.runners.filter((r) => ruleFor(e, r.cat) && !['approved', 'waived'].includes((qd.quals.get(r._id) || {}).status)).length;
    if (qualPending) alerts.push({ level: near ? 'warn' : 'info', text: qualPending + ' runner' + (qualPending > 1 ? 's' : '') + ' with qualification not cleared', go: 'quals' });
  }
  return {
    event: e,
    expo,
    volunteers: { applied: waiting, approved: vols.filter((v) => v.status === 'approved').length, need, taken, confirmed, onSite: asg.filter((x) => x.checkedInAt && !x.checkedOutAt).length },
    log: { open: logOpen, total: log.length },
    run: { done: run.filter((x) => x.status === 'done').length, total: run.length },
    pacers: { need: groups.reduce((s, x) => s + int(x.g.need), 0), have: groups.reduce((s, x) => s + Math.min(x.have, int(x.g.need)), 0), approved: pacers.filter((p) => p.status === 'approved').length },
    checklist: { done: chk.length - open, total: chk.length },
    quals: { pending: qualPending },
    alerts,
  };
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
    def(QUALS, ['event', 'runnerId', 'name', 'cat', 'claim', 'claimKm', 'claimSec', 'link', 'status', 'note', 'by', 'at']),
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
