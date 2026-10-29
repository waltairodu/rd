// backend/results.web.js
// Waves and corrals, results and age-group awards for RaceOS (Velo). It uses the same logins as RaceOS (the session token the
// page already holds).
//
//   director (admin or director)  everything in here
//   lead                          can LOOK (start list, results board, awards). Changes nothing.
//   viewer, desk, coach, other    refused
//
// A date of birth is read only to work out an age: no answer from here holds it. Phone numbers and e-mail addresses never come
// through here at all. A result is corrected or voided with a reason, and the old values are kept. A request can be sent twice
// (double click, bad network): each create carries a key, and the same key does nothing twice.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { kindOf, unameOf, tidyError } from './rd-auth.js';
import { STATUSES, cleanText, lc, catKey, sOnly, isKey, P, parseJson, parseTime, fmtTime, normStatus, normGender, normDob, declaredAge, canonCat, cleanSettings, settingsOf, cleanWaves, wavesOf, autoAssign, startList, readResults, regInfo, formFields, bandList, board, computeAwards } from './rd-results.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'results');
    }
  });

const STAFF = 'ExpoStaff';
const SESS = 'ExpoSessions';
const EVENTS = 'RDEvents';
const REGS = 'RDRegs';
const AUDIT = 'RDAudit';
const RESULTS = 'RDResults';
const ASSIGN = 'RDWaveAssign';
const RSET = 'RDResSet';
const SA = { suppressAuth: true };
const MAXROWS = 1000;
const CHUNK = 200;
const nowIso = () => new Date().toISOString();

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
const chunks = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};

/* ---------- who is asking ---------- */
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
// Every Results method starts here. need: 'director' (directors only) or 'view' (directors and leads).
async function rauth(arg, need) {
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
  const kind = kindOf(u);
  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');
  if (need === 'director' && kind !== 'director') throw new Error('director_only');
  await ensureCollections();
  return { role: kind, name: String(u.name || unameOf(u)), username: String(unameOf(u)) };
}
async function audit(a, action, target, detail) {
  try {
    await wixData.insert(AUDIT, { at: nowIso(), by: a.username, action, target: cleanText(target, 60), detail: cleanText(detail, 200) }, SA);
  } catch (e) {
    // the note is lost, the change is not
  }
}
async function getEvent(ev) {
  const id = typeof ev === 'string' ? ev : '';
  const it = id ? await wixData.get(EVENTS, id, SA).catch(() => null) : null;
  if (!it) throw new Error('no_event');
  return it;
}
// A row of this race, or an error that says nothing about rows of other races.
async function getOf(col, id, e) {
  const row = typeof id === 'string' && id ? await wixData.get(col, id, SA).catch(() => null) : null;
  if (!row || row.event !== e._id) throw new Error('no_item');
  return row;
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

/* ---------- safe to send twice ---------- */
let lastClean = 0;
async function once(a, kind, key, make) {
  if (key === undefined || key === null || key === '') return make();
  if (!isKey(key)) throw new Error('bad_key');
  const id = 'k~' + kind + '~' + key;
  try {
    await wixData.insert(RSET, { _id: id, kind: 'key', by: a.username, at: nowIso(), ref: '', json: '' }, SA);
  } catch (e) {
    const old = await wixData.get(RSET, id, SA).catch(() => null);
    if (!old) throw e;
    if (old.by === a.username && old.ref) return { id: old.ref, again: true };
    throw new Error('busy_try_again');
  }
  let out;
  try {
    out = await make();
  } catch (e) {
    await wixData.bulkRemove(RSET, [id], SA).catch(() => null);
    throw e;
  }
  await wixData.update(RSET, { _id: id, kind: 'key', by: a.username, at: nowIso(), ref: out.id, json: '' }, SA).catch(() => null);
  if (Date.now() - lastClean > 3600000) {
    lastClean = Date.now();
    try {
      const old = await wixData.query(RSET).lt('at', new Date(Date.now() - 3 * 86400000).toISOString()).limit(200).find(SA);
      const gone = old.items.filter((x) => String(x._id).startsWith('k~') && x.at).map((x) => x._id);
      if (gone.length) await wixData.bulkRemove(RSET, gone, SA);
    } catch (e) {
      // clean-up is best effort
    }
  }
  return out;
}

/* ---------- reading ---------- */
function raceOf(e) {
  const j = parseJson(e.json, {});
  const cats = j && Array.isArray(j.cats) ? j.cats.filter((c) => c && typeof c === 'object' && typeof c.name === 'string') : [];
  return { id: e._id, name: cleanText(e.name, 80), raceDate: typeof e.date === 'string' ? e.date : '', cats };
}
// The categories that exist: the ones the race lists and the ones the registrations carry.
function knownCats(race, regList) {
  const out = [];
  const seen = new Set();
  const add = (n) => {
    const t = cleanText(n, 60);
    const k = catKey(t);
    if (t && k && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  race.cats.forEach((c) => add(c.name));
  regList.forEach((r) => add(r.cat));
  return out;
}
// bib -> what the registration says about the runner (name, category, gender, date of birth, age, expected time)
function regMap(regList, map) {
  const m = new Map();
  regList.forEach((r) => {
    const i = regInfo(r, map);
    if (i.bib && !m.has(i.bib)) m.set(i.bib, i);
  });
  return m;
}
async function getSettings(evId) {
  const row = await wixData.get(RSET, 'set~' + evId, SA).catch(() => null);
  return settingsOf(row && row.json);
}
async function getWaves(evId) {
  const row = await wixData.get(RSET, 'waves~' + evId, SA).catch(() => null);
  return wavesOf(row && row.json);
}
// The paid runners with the wave and corral each one has now.
function runnersOf(regList, st, assigns) {
  const am = new Map(assigns.map((x) => [x.regId, x]));
  return regList
    .map((r) => regInfo(r, st.map))
    .filter((x) => x.paid)
    .map((x) => {
      const as = am.get(x.id);
      return { id: x.id, bib: x.bib, name: x.name, cat: x.cat, seedCs: x.seedCs, wave: as ? String(as.wave || '') : '', corral: as ? String(as.corral || '') : '', how: as ? String(as.how || '') : '' };
    });
}
const waveOut = (w, count) => ({ id: w.id, cat: w.cat, name: w.name, start: w.start, corrals: w.corrals.slice(), cap: w.cap, count });
function rowOut(x) {
  return {
    id: x.id, bib: x.bib, name: x.name, cat: x.cat, gender: x.gender, age: x.age, ageGroup: x.ageGroup, status: x.status,
    time: fmtTime(x.t), chip: fmtTime(x.chipCs), gun: fmtTime(x.gunCs), place: x.place, gplace: x.gplace, aplace: x.aplace, flags: x.flags.slice(), note: x.note,
    voidReason: x.voidReason || '', voidBy: x.voidBy || '', voidAt: x.voidAt || '',
  };
}
async function boardOf(e) {
  const [regList, resRows, st] = await Promise.all([rows(REGS, e._id), rows(RESULTS, e._id), getSettings(e._id)]);
  const race = raceOf(e);
  const b = board(resRows, regMap(regList, st.map), { settings: st, raceDate: race.raceDate, cats: race.cats });
  return { b, st, race, known: knownCats(race, regList) };
}
const countPer = (assigns, ids) => {
  const m = new Map();
  assigns.forEach((x) => {
    if (ids.has(x.wave)) m.set(x.wave, (m.get(x.wave) || 0) + 1);
  });
  return m;
};

export const resOverview = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const [regList, resRows, st, wv, assigns] = await Promise.all([rows(REGS, e._id), rows(RESULTS, e._id), getSettings(e._id), getWaves(e._id), rows(ASSIGN, e._id)]);
  const race = raceOf(e);
  const regs = regMap(regList, st.map);
  const b = board(resRows, regs, { settings: st, raceDate: race.raceDate, cats: race.cats });
  const ids = new Set(wv.waves.map((w) => w.id));
  const per = countPer(assigns, ids);
  const runners = runnersOf(regList, st, assigns);
  const placed = runners.filter((r) => ids.has(r.wave)).length;
  return {
    me: { role: a.role, name: a.name },
    race: { id: race.id, name: race.name, date: race.raceDate },
    settings: st,
    bands: bandList(st.bands),
    cats: knownCats(race, regList),
    waves: wv.waves.map((w) => waveOut(w, per.get(w.id) || 0)),
    rev: wv.rev,
    counts: { regs: regList.length, paid: runners.length, withBib: regs.size, placed, unplaced: runners.length - placed },
    results: b.summary,
  };
});

/* ---------- setup ---------- */
export const resFormFields = webMethod(Permissions.Anyone, async (arg) => {
  await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const regList = await rows(REGS, e._id);
  return { fields: formFields(regList), count: regList.length };
});

export const resSaveSettings = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  let st;
  try {
    st = cleanSettings(arg.settings);
  } catch (err) {
    throw new Error('bad_settings');
  }
  await put(RSET, { _id: 'set~' + e._id, kind: 'settings', by: a.username, at: nowIso(), ref: '', json: JSON.stringify(st) });
  await audit(a, 'results settings saved', e.name, 'rank by ' + st.rankBy + ', age on ' + st.ageRule);
  return { settings: st };
});

/* ---------- waves and corrals ---------- */
export const resSaveWaves = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const cur = await getWaves(e._id);
  if (!Number.isInteger(arg.rev) || arg.rev < 0) throw new Error('bad_waves');
  if (arg.rev !== cur.rev) throw new Error('changed_reload');
  const regList = await rows(REGS, e._id);
  let clean;
  try {
    clean = cleanWaves(arg.waves, { cats: knownCats(raceOf(e), regList), ids: cur.waves.map((w) => w.id), next: cur.next });
  } catch (err) {
    throw new Error('bad_waves');
  }
  const rev = cur.rev + 1;
  await put(RSET, { _id: 'waves~' + e._id, kind: 'waves', by: a.username, at: nowIso(), ref: '', json: JSON.stringify({ waves: clean.waves, next: clean.next, rev }) });
  // runners who were in a wave that is gone, in another category now, or in a corral that is gone
  const assigns = await rows(ASSIGN, e._id);
  const byId = new Map(clean.waves.map((w) => [w.id, w]));
  const catOf = new Map(regList.map((r) => [r._id, catKey(r.cat)]));
  const drop = [];
  const fix = [];
  assigns.forEach((x) => {
    const w = byId.get(x.wave);
    if (!w || catOf.get(x.regId) !== catKey(w.cat)) drop.push(x._id);
    else if (x.corral && !w.corrals.includes(x.corral)) fix.push(Object.assign({}, x, { corral: '' }));
  });
  for (const c of chunks(drop)) await wixData.bulkRemove(ASSIGN, c, SA);
  for (const c of chunks(fix)) await wixData.bulkUpdate(ASSIGN, c, SA);
  await audit(a, 'waves saved', e.name, clean.waves.length + ' waves, ' + drop.length + ' runners moved out');
  return { rev, moved: drop.length + fix.length };
});

export const resAssign = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const mode = sOnly(arg.mode);
  if (mode !== 'seed' && mode !== 'bib') throw new Error('bad_mode');
  const redo = arg.redo === true;
  const only = typeof arg.cat === 'string' ? cleanText(arg.cat, 60) : '';
  return once(a, 'assign', arg.key, async () => {
    const [regList, st, wv, assigns] = await Promise.all([rows(REGS, e._id), getSettings(e._id), getWaves(e._id), rows(ASSIGN, e._id)]);
    const known = knownCats(raceOf(e), regList);
    if (only && !known.some((k) => catKey(k) === catKey(only))) throw new Error('bad_cat');
    const runners = runnersOf(regList, st, assigns);
    const have = new Map(assigns.map((x) => [x.regId, x]));
    const at = nowIso();
    const ins = [];
    const upd = [];
    const del = [];
    const per = [];
    let placedN = 0;
    let unplacedN = 0;
    for (const cat of known) {
      if (only && catKey(cat) !== catKey(only)) continue;
      const mine = runners.filter((r) => catKey(r.cat) === catKey(cat));
      if (!mine.length) continue;
      const ws = wv.waves.filter((w) => catKey(w.cat) === catKey(cat));
      if (!ws.length) {
        per.push({ cat, placed: 0, unplaced: mine.filter((r) => !r.wave).length, noWaves: true });
        continue;
      }
      const r = autoAssign(mine, ws, { mode, redo });
      Object.keys(r.placed).forEach((id) => {
        const p = r.placed[id];
        const old = have.get(id);
        const row = { _id: 'wa~' + id, event: e._id, regId: id, wave: p.wave, corral: p.corral, how: 'auto', by: a.username, at };
        if (!old) ins.push(row);
        else if (old.how !== 'manual' && (old.wave !== p.wave || old.corral !== p.corral)) upd.push(row);
      });
      r.unplaced.forEach((id) => {
        const old = have.get(id);
        if (old && old.how !== 'manual') del.push(old._id);
      });
      placedN += Object.keys(r.placed).length;
      unplacedN += r.unplaced.length;
      per.push({ cat, placed: Object.keys(r.placed).length, unplaced: r.unplaced.length, noWaves: false });
    }
    try {
      for (const c of chunks(ins)) await wixData.bulkInsert(ASSIGN, c, SA);
      for (const c of chunks(upd)) await wixData.bulkUpdate(ASSIGN, c, SA);
      for (const c of chunks(del)) await wixData.bulkRemove(ASSIGN, c, SA);
    } catch (err) {
      throw new Error('busy_try_again');
    }
    await audit(a, 'runners placed in waves', e.name, mode + (redo ? ', redone' : '') + ': ' + placedN + ' placed, ' + unplacedN + ' without room');
    return { id: 'as~' + at, placed: placedN, unplaced: unplacedN, cats: per };
  });
});

export const resPlace = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const reg = await getOf(REGS, arg.regId, e);
  const info = regInfo(reg, {});
  if (!info.paid) throw new Error('not_paid');
  const id = 'wa~' + reg._id;
  const waveId = typeof arg.wave === 'string' ? arg.wave.trim() : null;
  if (waveId === null) throw new Error('bad_wave');
  if (waveId === '') {
    await wixData.bulkRemove(ASSIGN, [id], SA);
    await audit(a, 'runner taken out of a wave', info.bib || info.name, '');
    return { ok: true, wave: '', corral: '' };
  }
  const wv = await getWaves(e._id);
  const w = wv.waves.find((x) => x.id === waveId);
  if (!w) throw new Error('bad_wave');
  if (catKey(info.cat) !== catKey(w.cat)) throw new Error('wrong_category');
  if (arg.corral !== undefined && typeof arg.corral !== 'string') throw new Error('bad_corral');
  const typed = cleanText(arg.corral, 12);
  const corral = typed ? w.corrals.find((c) => lc(c) === lc(typed)) : '';
  if (typed && !corral) throw new Error('bad_corral');
  const full = async () => (await rows(ASSIGN, e._id)).filter((x) => x.wave === w.id && x.regId !== reg._id).length >= w.cap;
  if (w.cap > 0 && (await full())) throw new Error('wave_full');
  const before = await wixData.get(ASSIGN, id, SA).catch(() => null);
  await put(ASSIGN, { _id: id, event: e._id, regId: reg._id, wave: w.id, corral, how: 'manual', by: a.username, at: nowIso() });
  if (w.cap > 0) {
    const n = (await rows(ASSIGN, e._id)).filter((x) => x.wave === w.id).length;
    if (n > w.cap) {
      if (before) await wixData.update(ASSIGN, before, SA);
      else await wixData.bulkRemove(ASSIGN, [id], SA);
      throw new Error('wave_full');
    }
  }
  await audit(a, 'runner placed in a wave', info.bib || info.name, w.cat + ' ' + w.name + (corral ? ' ' + corral : ''));
  return { ok: true, wave: w.id, corral };
});

export const resStartList = webMethod(Permissions.Anyone, async (arg) => {
  await rauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const [regList, st, wv, assigns] = await Promise.all([rows(REGS, e._id), getSettings(e._id), getWaves(e._id), rows(ASSIGN, e._id)]);
  const ids = new Set(wv.waves.map((w) => w.id));
  const runners = runnersOf(regList, st, assigns).map((r) => ({ id: r.id, bib: r.bib, name: r.name, cat: r.cat, wave: ids.has(r.wave) ? r.wave : '', corral: r.corral }));
  const sl = startList(runners, wv.waves);
  const pick = (r) => ({ id: r.id, bib: r.bib, name: r.name, cat: r.cat, corral: r.corral || '' });
  return {
    sections: sl.sections.map((s) => ({ id: s.id, cat: s.cat, name: s.name, start: s.start, cap: s.cap, count: s.count, corrals: s.corrals.map((c) => ({ corral: c.corral, runners: c.runners.map(pick) })) })),
    unassigned: sl.unassigned.map(pick),
    counts: { paid: runners.length, placed: runners.length - sl.unassigned.length, unplaced: sl.unassigned.length },
  };
});

/* ---------- results ---------- */
export const resImport = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  if (typeof arg.text !== 'string') throw new Error('bad_text');
  const [regList, st, have] = await Promise.all([rows(REGS, e._id), getSettings(e._id), rows(RESULTS, e._id)]);
  const read = readResults(arg.text, { regs: regMap(regList, st.map), known: knownCats(raceOf(e), regList), rankBy: st.rankBy });
  const existing = new Map(have.map((r) => [r._id, r]));
  const idOf = (bib) => 'rs~' + e._id + '~' + bib;
  const items = read.items;
  const count = (s) => items.filter((i) => i.status === s).length;
  const summary = { items: items.length, matched: items.filter((i) => i.matched).length, unmatched: items.filter((i) => !i.matched).length, fin: count('fin'), dnf: count('dnf'), dns: count('dns'), dsq: count('dsq'), isNew: items.filter((i) => !existing.has(idOf(i.bib))).length, exists: items.filter((i) => existing.has(idOf(i.bib)) && existing.get(idOf(i.bib)).void !== 'yes').length, errors: read.errors.length };
  if (arg.dry === true) {
    return {
      dry: true,
      summary,
      errors: read.errors.slice(0, 50),
      moreErrors: Math.max(0, read.errors.length - 50),
      columns: read.columns,
      ignored: read.ignored.slice(0, 10),
      sample: items.slice(0, 8).map((i) => ({ line: i.line, bib: i.bib, name: i.name, cat: i.cat, status: i.status, time: fmtTime(i.chipCs || i.gunCs), matched: i.matched })),
    };
  }
  if (!items.length) throw new Error('nothing_to_save');
  if (read.errors.length && arg.skipErrors !== true) throw new Error('has_errors');
  return once(a, 'import', arg.key, async () => {
    const at = nowIso();
    const ins = [];
    const upd = [];
    let kept = 0;
    items.forEach((it) => {
      const id = idOf(it.bib);
      const old = existing.get(id);
      if (old && old.void !== 'yes' && arg.replace !== true) {
        kept++;
        return;
      }
      const prev = old ? JSON.stringify({ status: old.status, gunCs: old.gunCs, chipCs: old.chipCs, void: old.void, by: old.by, at: old.at }) : '';
      const row = { _id: id, event: e._id, bib: it.bib, name: it.name, cat: it.cat, gender: it.gender, dob: it.dob, age: it.age, status: it.status, gunCs: String(it.gunCs), chipCs: String(it.chipCs), note: '', regId: it.regId, by: a.username, at, void: 'no', voidBy: '', voidAt: '', voidReason: '', prev };
      (old ? upd : ins).push(row);
    });
    try {
      for (const c of chunks(ins)) await wixData.bulkInsert(RESULTS, c, SA);
      for (const c of chunks(upd)) await wixData.bulkUpdate(RESULTS, c, SA);
    } catch (err) {
      throw new Error('busy_try_again');
    }
    await audit(a, 'results imported', e.name, ins.length + ' new, ' + upd.length + ' replaced, ' + kept + ' kept, ' + read.errors.length + ' lines skipped');
    return { id: 'im~' + at, saved: ins.length, replaced: upd.length, kept, skipped: read.errors.length };
  });
});

export const resBoard = webMethod(Permissions.Anyone, async (arg) => {
  await rauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const { b, st, known } = await boardOf(e);
  return { rows: b.rows.map(rowOut), voided: b.voided.map(rowOut), summary: b.summary, bands: bandList(st.bands), rankBy: st.rankBy, cats: known };
});

const str = (v, code) => {
  if (typeof v !== 'string') throw new Error(code);
  return v.trim();
};
export const resSaveRow = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(RESULTS, arg.id, e);
  if (row.void === 'yes') throw new Error('voided');
  const reason = cleanText(sOnly(arg.reason), 200);
  if (reason.length < 3) throw new Error('reason_needed');
  const f = arg.fields && typeof arg.fields === 'object' && !Array.isArray(arg.fields) ? arg.fields : null;
  if (!f) throw new Error('bad_field');
  const next = Object.assign({}, row);
  const changed = [];
  const set = (k, v) => {
    if (String(next[k] === undefined ? '' : next[k]) !== v) changed.push(k);
    next[k] = v;
  };
  if (f.status !== undefined) {
    const s = normStatus(str(f.status, 'bad_status'));
    if (!s) throw new Error('bad_status');
    set('status', s);
  }
  for (const k of ['chip', 'gun']) {
    if (f[k] === undefined) continue;
    const v = str(f[k], 'bad_time');
    const p = v === '' ? 0 : parseTime(v);
    if (p === null) throw new Error('bad_time');
    set(k + 'Cs', String(p));
  }
  if (f.gender !== undefined) {
    const v = str(f.gender, 'bad_gender');
    const g = v === '' ? '' : normGender(v);
    if (v !== '' && !g) throw new Error('bad_gender');
    set('gender', g);
  }
  if (f.age !== undefined) {
    const v = typeof f.age === 'number' ? String(f.age) : str(f.age, 'bad_age');
    const n = v === '' ? '' : declaredAge(v);
    if (v !== '' && n === null) throw new Error('bad_age');
    set('age', n === '' ? '' : String(n));
  }
  if (f.dob !== undefined) {
    const v = str(f.dob, 'bad_dob');
    const d = v === '' ? '' : normDob(v);
    if (v !== '' && !d) throw new Error('bad_dob');
    set('dob', d);
  }
  if (f.cat !== undefined) {
    const known = knownCats(raceOf(e), await rows(REGS, e._id));
    const typed = cleanText(str(f.cat, 'bad_cat'), 60);
    const hit = known.find((k) => catKey(k) === catKey(canonCat(typed, known)));
    if (!typed || !hit) throw new Error('bad_cat');
    set('cat', hit);
  }
  if (f.note !== undefined) set('note', cleanText(str(f.note, 'bad_field'), 200));
  if (!STATUSES.includes(next.status)) throw new Error('bad_status');
  if (next.status === 'fin' && !(P(next.chipCs) || P(next.gunCs))) throw new Error('time_needed');
  if (!changed.length) return { ok: true, same: true };
  next.prev = JSON.stringify({ status: row.status, gunCs: row.gunCs, chipCs: row.chipCs, gender: row.gender, age: row.age, cat: row.cat, note: row.note, by: row.by, at: row.at });
  next.by = a.username;
  next.at = nowIso();
  await wixData.update(RESULTS, next, SA);
  await audit(a, 'result corrected', 'bib ' + row.bib, changed.join(', ') + ': ' + reason);
  return { ok: true, changed };
});

export const resVoid = webMethod(Permissions.Anyone, async (arg) => {
  const a = await rauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const row = await getOf(RESULTS, arg.id, e);
  if (arg.undo === true) {
    if (row.void !== 'yes') throw new Error('not_voided');
    await wixData.update(RESULTS, Object.assign({}, row, { void: 'no', voidBy: '', voidAt: '', voidReason: '' }), SA);
    await audit(a, 'result restored', 'bib ' + row.bib, '');
    return { ok: true };
  }
  if (row.void === 'yes') throw new Error('voided');
  const reason = cleanText(sOnly(arg.reason), 200);
  if (reason.length < 3) throw new Error('reason_needed');
  await wixData.update(RESULTS, Object.assign({}, row, { void: 'yes', voidBy: a.username, voidAt: nowIso(), voidReason: reason }), SA);
  await audit(a, 'result voided', 'bib ' + row.bib, reason);
  return { ok: true };
});

/* ---------- awards ---------- */
export const resAwards = webMethod(Permissions.Anyone, async (arg) => {
  await rauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const { b, st } = await boardOf(e);
  const aw = computeAwards(b.rows, st);
  return { awards: aw, bands: bandList(st.bands), summary: b.summary };
});

/* ---------- collections ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  const def = (id, fields) => ({ _id: id, displayName: id, permissions: LOCKED, fields: fields.map(textField) });
  return [
    def(RESULTS, ['event', 'bib', 'name', 'cat', 'gender', 'dob', 'age', 'status', 'gunCs', 'chipCs', 'note', 'regId', 'by', 'at', 'void', 'voidBy', 'voidAt', 'voidReason', 'prev']),
    def(ASSIGN, ['event', 'regId', 'wave', 'corral', 'how', 'by', 'at']),
    def(RSET, ['kind', 'by', 'at', 'ref', 'json']),
  ];
}
let checked = false;
// Creates the Results collections the first time a director or lead uses Results (only collections that are missing).
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
