// backend/exposoft.web.js
// Expo Desk backend for Wix (Velo). The Expo desk is part of RaceOS: it has NO login of its own. A person logs in once
// to RaceOS (racedir.web.js) and the same session token works here. Logins are made on RaceOS's Team screen (the
// ExpoStaff collection); the collections are created by RaceOS's one-time setup.
//   director (role admin or director)  every desk, and the admin methods (import, lot, sync)
//   desk                               only the desks and the race written on that login
//   lead, viewer, coach, anything else refused ('not_allowed'): they have a session, but not for the desk.
// Every method needs a session token. `enter` starts the desk for a person who is already logged in.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { kindOf, unameOf, deskValueOf, deskList, tidyError } from './rd-auth.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'exposoft');
    }
  });

const RUNNERS = 'Runners';
const CONFIG = 'ExpoConfig';
const STAFF = 'ExpoStaff';
const SESS = 'ExpoSessions';
const CHECKS = 'ExpoCheckins';
const PRES = 'ExpoPresence';

const SA = { suppressAuth: true };
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const PAGE = 500;

// ---- findmybib lists --------------------------------------------------------
// Every collection whose ID starts with "Import" is a race (Import910 is VHM).
// The race name is the collection's display name in the CMS. If that is missing
// or just repeats the ID, the name comes from RACE_NAMES below, else the ID.
// These are the field names inside each collection. Each entry lists the names to try,
// first match wins (not case sensitive). If "Check data" in the Setup tab says
// category or size was not found, add your real field names to those two lists.
const RACE_NAMES = { Import910: 'VHM' };
const SOURCE_FIELDS = {
  bib: ['bibNo', 'bibNumber', 'bib'],
  bibName: ['bibName', 'nameOnBib', 'printedName'],
  name: ['participantName', 'name', 'fullName'],
  phone: ['phoneNumber', 'phone', 'mobile', 'mobileNumber', 'contactNumber'],
  email: ['email', 'emailId', 'emailAddress'],
  cat: ['category', 'raceCategory', 'distance', 'raceDistance', 'event', 'race'],
  size: ['tshirtSize', 'tShirtSize', 'shirtSize', 'tshirt', 'size'],
};
// -----------------------------------------------------------------------------

function docId(b) {
  const s = String(b).trim().replace(/[^A-Za-z0-9_\-.~:@+]/g, '-').slice(0, 100);
  return s === '.' || s === '..' || !s ? 'x' + s : s;
}

function normSize(v) {
  const s = String(v || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
  const map = { SMALL: 'S', MEDIUM: 'M', LARGE: 'L', XLARGE: 'XL', EXTRALARGE: 'XL', '2XL': 'XXL', XXLARGE: 'XXL', XSMALL: 'XS', EXTRASMALL: 'XS' };
  const t = map[s] || s;
  return SIZES.includes(t) ? t : '';
}

const lc = (v) => String(v || '').trim().toLowerCase();
// The desks are fixed (rd-auth.js): Desk 1 - BIB, Desk 2 - Tshirt, Desk 3 - Misc. A login's desks are written on the
// Team screen; a login with none written (an old hand-made row) may use any of the three.
// What each desk may DO. Enforced here on the server, so a changed or hacked page cannot get around it.
//   hand over: Desk 1 gives bibs (and checks the runner in), Desk 2 gives T-shirts only, Desk 3 gives neither.
//   undo:      each desk can undo only what it hands over; Desk 3 (Misc) is the corrections desk and can undo all.
//   addRunner: Desk 3 only.
const DESK_CAN = {
  'Desk 1 - BIB': { give: ['check', 'bib'], undo: ['check', 'bib'], addRunner: false },
  'Desk 2 - Tshirt': { give: ['shirt'], undo: ['shirt'], addRunner: false },
  'Desk 3 - Misc': { give: [], undo: ['check', 'bib', 'shirt'], addRunner: true },
};
function needDesk(staff, kind, action) {
  const d = staff.sess && staff.sess.desk;
  const can = d && DESK_CAN[d];
  if (!can) throw new Error('no_desk');
  const ok = kind === 'addRunner' ? can.addRunner : can[kind].includes(action);
  if (!ok) throw new Error('wrong_desk');
}
// Only a director and desk staff may use the desk. Everyone else with a RaceOS session is refused.
const roleOf = (u) => {
  const k = kindOf(u);
  return k === 'director' ? 'admin' : k === 'desk' ? 'desk' : 'none';
};

// Every login, however many there are (read a page at a time, so no login is ever out of sight).
async function staffRows() {
  try {
    const out = [];
    for (let skip = 0; skip < 5000; skip += 1000) {
      const r = await wixData.query(STAFF).ascending('_id').skip(skip).limit(1000).find(SA);
      out.push(...r.items);
      if (r.items.length < 1000) break;
    }
    return out;
  } catch (e) {
    throw new Error('setup_needed');
  }
}

// One login can be at only ONE desk at a time. ExpoPresence holds, per login, the desk it is using and when it was
// last seen. A second desk is refused ('desk_busy') while the first is active (seen in the last 3 minutes),
// until the first one logs out or goes quiet.
const PRESENCE_FRESH_MS = 3 * 60 * 1000;
const presenceChecked = new Map();
const presFresh = (row) => !!(row && row.seen && Date.now() - Date.parse(row.seen) < PRESENCE_FRESH_MS);
async function claimDesk(username, desk, ownDesk) {
  const key = lc(username);
  const row = await wixData.get(PRES, key, SA).catch(() => null);
  if (row && row.desk && row.desk !== desk && row.desk !== ownDesk && presFresh(row)) throw new Error('desk_busy');
  try {
    await wixData.save(PRES, { _id: key, username: key, desk, seen: new Date().toISOString() }, SA);
  } catch (e) {
    // presence is best effort when its collection is not there yet
  }
  presenceChecked.set(key + '|' + desk, Date.now());
}
async function keepPresence(username, desk) {
  const k = lc(username) + '|' + desk;
  if (Date.now() - (presenceChecked.get(k) || 0) < 30000) return;
  await claimDesk(username, desk);
}
// A login can be tied to one race by the admin: put the race name (or its Import id) in the 'race' column of
// ExpoStaff. That login then always works on that race; the race is forced on the server for every call.
const raceCache = { at: 0, list: null };
async function raceList() {
  if (raceCache.list && Date.now() - raceCache.at < 60000) return raceCache.list;
  const found = await findSources();
  const have = await wixData.query(CONFIG).limit(100).find(SA).catch(() => ({ items: [] }));
  const byId = new Map(have.items.map((i) => [i._id, i]));
  const list = found.map((f) => {
    const row = byId.get(f.id);
    let named = false;
    try {
      named = !!(row && row.json && JSON.parse(row.json).named);
    } catch (e) {
      named = false;
    }
    return { id: f.id, name: named && row.name ? String(row.name) : f.name, named };
  });
  raceCache.at = Date.now();
  raceCache.list = list;
  return list;
}
const raceValueOf = (u) => String(u.race || u.Race || u.races || '').split(',')[0].trim();
async function lockOf(u) {
  const v = raceValueOf(u);
  if (!v) return null;
  const list = await raceList();
  const hit = list.find((r) => r.id.toLowerCase() === v.toLowerCase()) || list.find((r) => norm(r.name) === norm(v));
  if (!hit) throw new Error('bad_race');
  return { id: hit.id, name: hit.name };
}

// Checks the RaceOS session token. Throws 'not_logged_in', 'not_allowed' (a role that has no business at the desk),
// 'admin_only' or 'setup_needed'. The race is forced to the one written on a login that has one, whatever the call says,
// and a desk the login is not allowed to use is never honoured.
async function auth(arg, needAdmin) {
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
  const role = roleOf(u);
  if (role === 'none') throw new Error('not_allowed');
  if (needAdmin && role !== 'admin') throw new Error('admin_only');
  const lock = await lockOf(u);
  // With more than one race, a desk login must be tied to one (the Team screen makes sure of it). Checked on every
  // call, not only when the desk starts, so a token cannot be used to skip `enter` and work a race that is not theirs.
  if (!lock && role !== 'admin' && (await raceList()).length > 1) throw new Error('no_race');
  if (lock && arg) arg.ev = lock.id;
  const desks = deskList(deskValueOf(u));
  const desk = sess.desk && desks.includes(sess.desk) ? sess.desk : '';
  if (desk) await keepPresence(unameOf(u), desk);
  return { lock, role, label: desk || String(unameOf(u)).slice(0, 20), username: unameOf(u), sess: Object.assign({}, sess, { desk }), user: u, desks };
}

function toRunner(it) {
  return {
    id: it._id,
    bib: it.bib || it._id,
    name: it.name || '',
    bibName: it.bibName || '',
    cat: it.cat || '',
    size: it.size || '',
    phone: it.phone || '',
    email: it.email || '',
    example: it.example === '1',
    checkedIn: !!it.checkedInAt,
    checkedInAt: it.checkedInAt || null,
    checkedInDesk: it.checkedInDesk || '',
    bibIssued: !!it.bibAt,
    bibAt: it.bibAt || null,
    bibDesk: it.bibDesk || '',
    shirtIssued: !!it.shirtAt,
    shirtSize: it.shirtSize || '',
    shirtAt: it.shirtAt || null,
    shirtDesk: it.shirtDesk || '',
    updated: it._updatedDate ? new Date(it._updatedDate).toISOString() : '',
  };
}

// Returns null when the race does not exist.
async function readConfig(ev) {
  const id = String(ev || '').trim();
  if (!id) return null;
  const it = await wixData.get(CONFIG, id, SA).catch(() => null);
  if (!it) return null;
  let c = {};
  try {
    c = it.json ? JSON.parse(it.json) : {};
  } catch (e) {
    c = {};
  }
  const lot = {};
  SIZES.forEach((s) => {
    lot[s] = Math.max(0, parseInt(c.shirtLot && c.shirtLot[s], 10) || 0);
  });
  return { id, name: String(it.name || c.name || id), named: !!c.named, bibLot: Math.max(0, parseInt(c.bibLot, 10) || 0), shirtLot: lot, source: id, example: false };
}

async function needEvent(arg) {
  const cfg = await readConfig(arg && arg.ev);
  if (!cfg) throw new Error('no_event');
  return cfg;
}

export const health = webMethod(Permissions.Anyone, async () => ({ ok: true }));

/* ---------- starting the desk ---------- */
function me(a) {
  const desks = deskList(deskValueOf(a.user));
  return {
    role: a.role,
    name: String(a.user.name || unameOf(a.user)),
    desks,
    can: DESK_CAN[a.sess.desk || ''] || { give: [], undo: [], addRunner: false },
    desk: a.sess.desk || '',
    deskChosen: !!a.sess.desk,
    race: a.lock ? a.lock.id : '',
    raceName: a.lock ? a.lock.name : '',
  };
}

// The person is already logged in to RaceOS; this starts their work at the desk. A login with one desk is put at that
// desk at once. (A login with no race, while there is more than one race, is refused by auth() with 'no_race'.)
export const enter = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, false);
  let sess = a.sess;
  if (a.desks.length === 1 && !sess.desk) {
    await claimDesk(a.username, a.desks[0]);
    sess = Object.assign({}, sess, { desk: a.desks[0] });
    await wixData.update(SESS, sess, SA);
  }
  return me({ role: a.role, user: a.user, lock: a.lock, sess });
});

export const whoami = webMethod(Permissions.Anyone, async (arg) => {
  return me(await auth(arg, false));
});

export const chooseDesk = webMethod(Permissions.Anyone, async (arg) => {
  const a = await auth(arg, false);
  const want = String((arg && arg.desk) || '').trim();
  if (!a.desks.includes(want)) throw new Error('bad_desk');
  await claimDesk(a.username, want, a.sess.desk || '');
  await wixData.update(SESS, Object.assign({}, a.sess, { desk: want }), SA);
  return me({ role: a.role, user: a.user, lock: a.lock, sess: Object.assign({}, a.sess, { desk: want }) });
});

/* ---------- reading ---------- */
export const loadPage = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, false);
  const cfg = await needEvent(arg);
  const skip = Math.max(0, parseInt(arg && arg.skip, 10) || 0);
  const r = await wixData.query(RUNNERS).eq('event', cfg.id).ascending('_id').skip(skip).limit(PAGE).find(SA);
  const out = { runners: r.items.map(toRunner), done: r.items.length < PAGE };
  if (skip === 0) out.config = cfg;
  return out;
});

export const loadSince = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, false);
  const cfg = await needEvent(arg);
  let q = wixData.query(RUNNERS).eq('event', cfg.id).ascending('_updatedDate').limit(PAGE);
  const since = arg && arg.since ? new Date(arg.since) : null;
  if (since && !isNaN(since.getTime())) q = q.ge('_updatedDate', new Date(since.getTime() - 1500));
  const r = await q.find(SA);
  return { runners: r.items.map(toRunner), more: r.items.length === PAGE, config: cfg };
});

/* ---------- hand-over ---------- */
// Who is collecting (self or a friend) and the selfie that proves it.
function cleanPickup(p) {
  if (!p || p.method !== 'selfie') throw new Error('verify_needed');
  const selfie = String(p.selfie || '');
  if (selfie.length < 500 || selfie.length > 250000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(selfie)) throw new Error('selfie_needed');
  const by = p.by === 'friend' ? 'friend' : 'self';
  const friendName = String(p.friendName || '').trim().slice(0, 60);
  const friendPhone = String(p.friendPhone || '').replace(/\D/g, '').slice(-10);
  if (by === 'friend' && friendName.length < 2) throw new Error('friend_needed');
  return { pickupBy: by, friendName: by === 'friend' ? friendName : '', friendPhone: by === 'friend' ? friendPhone : '', method: 'selfie', selfie };
}

export const getPickup = webMethod(Permissions.Anyone, async (arg) => {
  const staff = await auth(arg, false);
  const id = String((arg && arg.id) || '');
  if (staff.lock && !id.startsWith(staff.lock.id + '~')) throw new Error('not_found');
  const shape = (row) =>
    row ? { by: row.pickupBy || 'self', friendName: row.friendName || '', friendPhone: row.friendPhone || '', method: row.method || '', selfie: row.selfie || '', at: row.at || '', desk: row.desk || '' } : null;
  const check = await wixData.get(CHECKS, id, SA).catch(() => null);
  const shirt = await wixData.get(CHECKS, id + '#shirt', SA).catch(() => null);
  return { pickup: shape(check), shirtPickup: shape(shirt) };
});

// What the runner's row shows as done, per item.
const itemDone = (row, item) => !!(item === 'check' ? row.checkedInAt : item === 'bib' ? row.bibAt : row.shirtAt);
const CLASH_LABEL = { check: 'check-in', bib: 'bib', shirt: 'T-shirt' };
const CLAIM_STALE_MS = 60000;
// A hand-over is claimed before it is written. A claim is a record whose id is the runner plus the item, and an id can
// be inserted only once, so when two desks hand over the same thing in the same instant exactly one of them gets it.
// The claim stays as the record of the hand-over (removed again by "undo"); one that is left behind by a call that
// failed half way is taken over after a minute if the runner still does not show the item as done.
async function claimItem(it, item, desk, now) {
  const id = it._id + '#claim-' + item;
  const doc = { _id: id, event: it.event, bib: it.bib, method: 'claim', at: now, desk };
  try {
    await wixData.insert(CHECKS, doc, SA);
    return true;
  } catch (e) {
    const old = await wixData.get(CHECKS, id, SA).catch(() => null);
    if (!old) throw e;
    if (Date.now() - Date.parse(old.at) > CLAIM_STALE_MS) {
      const fresh = await wixData.get(RUNNERS, it._id, SA).catch(() => null);
      if (fresh && !itemDone(fresh, item)) {
        await wixData.save(CHECKS, doc, SA);
        return true;
      }
    }
    return false;
  }
}
const releaseClaims = (it, items) => (items.length ? wixData.bulkRemove(CHECKS, items.map((i) => it._id + '#claim-' + i), SA).catch(() => null) : null);

export const issue = webMethod(Permissions.Anyone, async (arg) => {
  const staff = await auth(arg, false);
  const it = await wixData.get(RUNNERS, String((arg && arg.id) || ''), SA);
  if (!it || (staff.lock && it.event !== staff.lock.id)) throw new Error('not_found');
  const desk = staff.label;
  // Desk rules first: every action asked for must belong to this desk, otherwise nothing at all is done.
  const asked = [];
  if (arg.check) asked.push('check');
  if (arg.bib) asked.push('bib');
  if (arg.shirtSize) asked.push('shirt');
  if (!asked.length) throw new Error('nothing_to_do');
  asked.forEach((a) => needDesk(staff, 'give', a));
  const now = new Date().toISOString();
  const done = [];
  const clash = [];
  const next = Object.assign({}, it);
  // Check-in and the T-shirt both need proof of who collects: Self or Friend, plus a selfie (OTP is not set up yet).
  const needPk = (arg.check && !it.checkedInAt) || (arg.shirtSize && !it.shirtAt);
  const pk = needPk ? cleanPickup(arg.pickup) : null;

  // What is still to be handed over (and what already was).
  const todo = [];
  if (arg.check) {
    if (it.checkedInAt) clash.push(CLASH_LABEL.check);
    else todo.push('check');
  }
  if (arg.bib) {
    if (it.bibAt) clash.push(CLASH_LABEL.bib);
    else todo.push('bib');
  }
  if (arg.shirtSize) {
    // The size is always the registered one (from findmybib / the CMS). Nobody can pick or change it here.
    const size = String(it.size || '');
    if (!SIZES.includes(size)) throw new Error('no_registered_size');
    if (String(arg.shirtSize) !== size) throw new Error('size_locked');
    if (it.shirtAt) clash.push(CLASH_LABEL.shirt);
    else {
      const cfg = (await readConfig(it.event)) || { shirtLot: {} };
      const lot = cfg.shirtLot[size] || 0;
      if (lot > 0) {
        const given = await wixData.query(RUNNERS).eq('event', it.event).eq('shirtSize', size).count(SA);
        if (given >= lot) throw new Error('out_of_stock');
      }
      todo.push('shirt');
    }
  }

  // Claim each item. If another desk got there first, that item is a clash, not a second hand-over.
  const taken = [];
  try {
    for (const item of todo) {
      if (await claimItem(it, item, desk, now)) taken.push(item);
      else clash.push(CLASH_LABEL[item]);
    }
    for (const item of taken) {
      if (item === 'check') {
        next.checkedInAt = now;
        next.checkedInDesk = desk;
      } else if (item === 'bib') {
        next.bibAt = now;
        next.bibDesk = desk;
      } else {
        next.shirtSize = String(it.size);
        next.shirtAt = now;
        next.shirtDesk = desk;
      }
      done.push(item);
    }
    if (pk && done.includes('check')) {
      await wixData.save(CHECKS, Object.assign({ _id: it._id, event: it.event, bib: it.bib, name: it.name, at: now, desk }, pk), SA);
    }
    if (pk && done.includes('shirt')) {
      await wixData.save(CHECKS, Object.assign({ _id: it._id + '#shirt', event: it.event, bib: it.bib, name: it.name, at: now, desk }, pk), SA);
    }
    const saved = done.length ? await wixData.update(RUNNERS, next, SA) : it;
    return { done, clash, runner: toRunner(saved) };
  } catch (e) {
    // Nothing was handed over: let go of what was claimed so the next try is not blocked.
    await releaseClaims(it, taken);
    throw e;
  }
});

export const revert = webMethod(Permissions.Anyone, async (arg) => {
  const staff = await auth(arg, false);
  const it = await wixData.get(RUNNERS, String((arg && arg.id) || ''), SA);
  if (!it || (staff.lock && it.event !== staff.lock.id)) throw new Error('not_found');
  const items = (Array.isArray(arg.items) ? arg.items : []).filter((x) => ['check', 'bib', 'shirt'].includes(x));
  if (!items.length) throw new Error('nothing_to_do');
  items.forEach((a) => needDesk(staff, 'undo', a));
  const next = Object.assign({}, it);
  if (items.includes('check')) {
    next.checkedInAt = '';
    next.checkedInDesk = '';
    await wixData.bulkRemove(CHECKS, [it._id], SA).catch(() => null);
  }
  if (items.includes('bib')) {
    next.bibAt = '';
    next.bibDesk = '';
  }
  if (items.includes('shirt')) {
    next.shirtAt = '';
    next.shirtDesk = '';
    next.shirtSize = '';
    await wixData.bulkRemove(CHECKS, [it._id + '#shirt'], SA).catch(() => null);
  }
  const saved = await wixData.update(RUNNERS, next, SA);
  // The hand-over is undone, so its claims go too (and the item can be handed over again at once).
  await releaseClaims(it, items);
  return { runner: toRunner(saved) };
});

/* ---------- runners ---------- */
function blankRunner(c, example, ev) {
  return {
    _id: ev + '~' + c.id,
    event: ev,
    bib: c.bib,
    name: c.name,
    bibName: c.bibName || '',
    cat: c.cat,
    size: SIZES.includes(c.size) ? c.size : '',
    phone: c.phone,
    email: c.email || '',
    example: example ? '1' : '',
    checkedInAt: '',
    checkedInDesk: '',
    bibAt: '',
    bibDesk: '',
    shirtSize: '',
    shirtAt: '',
    shirtDesk: '',
  };
}

function cleanRows(rows) {
  const clean = [];
  const seen = new Set();
  rows.forEach((r) => {
    const bib = String(r.bib || '').trim().slice(0, 12);
    const name = String(r.name || '').trim().slice(0, 60);
    if (!bib || !name) return;
    const id = docId(bib);
    if (seen.has(id)) return;
    seen.add(id);
    clean.push({
      id,
      bib,
      name,
      bibName: String(r.bibName || '').trim().slice(0, 40),
      cat: String(r.cat || '').trim().slice(0, 20),
      size: String(r.size || ''),
      phone: String(r.phone || '').trim().slice(0, 20),
      email: String(r.email || '').trim().toLowerCase().slice(0, 80),
    });
  });
  return clean;
}

// Adds new runners. Details of existing runners are changed only when updateExisting is true, which only
// the findmybib sync uses (the source collection is the truth). What has been handed over is never touched.
async function upsert(clean, example, ev, updateExisting) {
  if (!clean.length) return { added: 0, updated: 0, skipped: 0 };
  const ids = clean.map((c) => ev + '~' + c.id);
  const existing = await wixData.query(RUNNERS).hasSome('_id', ids).limit(1000).find(SA);
  const byId = new Map(existing.items.map((i) => [i._id, i]));
  const toInsert = [];
  const toUpdate = [];
  let skipped = 0;
  clean.forEach((c) => {
    const old = byId.get(ev + '~' + c.id);
    if (old) {
      if (!updateExisting) {
        skipped++;
        return;
      }
      toUpdate.push(
        Object.assign({}, old, {
          bib: c.bib,
          name: c.name,
          bibName: c.bibName || old.bibName || '',
          cat: c.cat || old.cat,
          size: SIZES.includes(c.size) ? c.size : old.size,
          phone: c.phone || old.phone,
          email: c.email || old.email || '',
        })
      );
    } else {
      toInsert.push(blankRunner(c, example, ev));
    }
  });
  if (toInsert.length) await wixData.bulkInsert(RUNNERS, toInsert, SA);
  if (toUpdate.length) await wixData.bulkUpdate(RUNNERS, toUpdate, SA);
  return { added: toInsert.length, updated: toUpdate.length, skipped };
}

export const addRunner = webMethod(Permissions.Anyone, async (arg) => {
  needDesk(await auth(arg, false), 'addRunner');
  const cfg = await needEvent(arg);
  const clean = cleanRows([arg || {}])[0];
  if (!clean) throw new Error('Bib and name are required');
  if (await wixData.get(RUNNERS, cfg.id + '~' + clean.id, SA)) throw new Error('duplicate');
  const saved = await wixData.insert(RUNNERS, blankRunner(clean, false, cfg.id), SA);
  return { runner: toRunner(saved) };
});

export const importRunners = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, true);
  const cfg = await needEvent(arg);
  const rows = (Array.isArray(arg && arg.rows) ? arg.rows : []).slice(0, 200);
  return upsert(cleanRows(rows), !!(arg && arg.example), cfg.id);
});

export const removeSample = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, true);
  const cfg = await needEvent(arg);
  let removed = 0;
  for (let i = 0; i < 20; i++) {
    const r = await wixData.query(RUNNERS).eq('event', cfg.id).eq('example', '1').limit(1000).find(SA);
    if (!r.items.length) break;
    await wixData.bulkRemove(RUNNERS, r.items.map((x) => x._id), SA);
    removed += r.items.length;
  }
  return { removed };
});

/* ---------- findmybib list ---------- */
function mapSource(item) {
  const lk = {};
  Object.keys(item).forEach((k) => {
    lk[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = k;
  });
  const out = {};
  const used = {};
  Object.keys(SOURCE_FIELDS).forEach((f) => {
    out[f] = '';
    used[f] = null;
    for (const key of SOURCE_FIELDS[f]) {
      const real = lk[key.toLowerCase().replace(/[^a-z0-9]/g, '')];
      if (real === undefined) continue;
      const v = item[real];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        out[f] = v;
        used[f] = real;
        break;
      }
    }
  });
  return { out, used };
}

function sourceRow(item) {
  const { out, used } = mapSource(item);
  return {
    used,
    row: {
      bib: String(out.bib).trim(),
      name: String(out.name).trim(),
      bibName: String(out.bibName).trim(),
      cat: String(out.cat).trim(),
      size: normSize(out.size),
      phone: String(out.phone).replace(/\D/g, '').slice(-10),
      email: String(out.email).trim().toLowerCase(),
    },
  };
}

export const previewFindMyBib = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, true);
  const SOURCE = (await needEvent(arg)).source;
  let total;
  try {
    total = await wixData.query(SOURCE).count(SA);
  } catch (e) {
    throw new Error('Cannot find the ' + SOURCE + ' collection');
  }
  const r = await wixData.query(SOURCE).ascending('_id').limit(1000).find(SA);
  const fields = {};
  const cols = new Set();
  const sample = [];
  let withBib = 0;
  r.items.forEach((it) => {
    Object.keys(it).forEach((k) => {
      if (k.charAt(0) !== '_') cols.add(k);
    });
    const { used, row } = sourceRow(it);
    Object.keys(used).forEach((f) => {
      if (used[f] && !fields[f]) fields[f] = used[f];
    });
    if (row.bib && row.name) {
      withBib++;
      if (sample.length < 3) sample.push({ bib: row.bib, name: row.name, cat: row.cat, size: row.size });
    }
  });
  return { total, scanned: r.items.length, withBib, fields, columns: Array.from(cols), sample };
});

export const syncFromFindMyBib = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, true);
  const cfg = await needEvent(arg);
  const SOURCE = cfg.source;
  const skip = Math.max(0, parseInt(arg && arg.skip, 10) || 0);
  const r = await wixData.query(SOURCE).ascending('_id').skip(skip).limit(200).find(SA);
  const rows = [];
  let skipped = 0;
  r.items.forEach((it) => {
    const { row } = sourceRow(it);
    if (!row.bib || !row.name) skipped++;
    else rows.push(row);
  });
  const res = await upsert(cleanRows(rows), false, cfg.id, true);
  return { done: r.items.length < 200, next: skip + r.items.length, added: res.added, updated: res.updated, skipped };
});

/* ---------- races and lot ---------- */
async function writeConfig(id, name, c) {
  await wixData.save(CONFIG, { _id: id, name, json: JSON.stringify({ bibLot: c.bibLot, shirtLot: c.shirtLot, named: !!c.named }) }, SA);
  raceCache.list = null;
}

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function findSources() {
  const out = [];
  try {
    const list = elevate(collections.listDataCollections);
    const r = await list({ paging: { limit: 100 } });
    (r.collections || []).forEach((c) => {
      const id = String(c._id || c.id || '');
      if (/^import/i.test(id)) {
        const dn = String(c.displayName || '').trim();
        out.push({ id, name: dn && norm(dn) !== norm(id) ? dn : RACE_NAMES[id] || id });
      }
    });
  } catch (e) {
    // Could not list collections: fall back to the known ones below.
  }
  Object.keys(RACE_NAMES).forEach((id) => {
    if (!out.some((o) => o.id === id)) out.push({ id, name: RACE_NAMES[id] });
  });
  return out;
}

// Every Import... collection is a race. Its settings row (lot) is created on first sight.
export const listEvents = webMethod(Permissions.Anyone, async (arg) => {
  const staff = await auth(arg, false);
  const found = await findSources();
  const have = await wixData.query(CONFIG).limit(100).find(SA);
  const byId = new Map(have.items.map((i) => [i._id, i]));
  const lot = {};
  SIZES.forEach((z) => (lot[z] = 0));
  const races = [];
  for (const f of found) {
    const row = byId.get(f.id);
    let name = f.name;
    if (!row) await writeConfig(f.id, f.name, { bibLot: 0, shirtLot: lot });
    else {
      const cfg = await readConfig(f.id);
      // A name the admin typed in the app wins; otherwise the CMS display name / RACE_NAMES.
      if (cfg.named) name = cfg.name;
      else if (row.name !== f.name) await writeConfig(f.id, f.name, cfg);
    }
    races.push({ id: f.id, name });
  }
  raceCache.list = null;
  const out = staff.lock ? races.filter((r) => r.id === staff.lock.id) : races;
  return out.sort((a, b) => a.name.localeCompare(b.name));
});

export const saveConfig = webMethod(Permissions.Anyone, async (arg) => {
  await auth(arg, true);
  const cfg = await needEvent(arg);
  const lot = {};
  SIZES.forEach((z) => {
    lot[z] = Math.max(0, parseInt(arg && arg.shirtLot && arg.shirtLot[z], 10) || 0);
  });
  const bibLot = Math.max(0, parseInt(arg && arg.bibLot, 10) || 0);
  let name = cfg.name;
  let named = !!cfg.named;
  if (arg && typeof arg.name === 'string') {
    const t = arg.name.trim().replace(/\s+/g, ' ');
    if (!t) {
      // empty = go back to the CMS name
      const f = (await findSources()).find((x) => x.id === cfg.id);
      name = f ? f.name : cfg.id;
      named = false;
    } else if (t.length < 2 || t.length > 40) throw new Error('bad_name');
    else {
      name = t;
      named = true;
    }
  }
  await writeConfig(cfg.id, name, { bibLot, shirtLot: lot, named });
  return readConfig(cfg.id);
});
