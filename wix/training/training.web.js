// backend/training.web.js
// Training module for Wix (Velo): free plans for athletes, and coached plans with a coach, feedback and messages.
//
//   FREE plan    athlete picks a plan template and a start date, gets a day-by-day schedule, ticks workouts off.
//                No coach, no messages. Enforced here on the server.
//   COACHED plan athlete asks for coaching, the director assigns a coach. The coach can change the schedule,
//                give feedback on each workout and exchange messages with the athlete. Price is a text setting
//                ("0" means free for now); no payment is taken here.
//
// Athletes log in with mobile number + a PIN (salted hash, never stored plain). Staff use the same ExpoStaff logins as
// the Expo desk and Director: role  admin or director (everything), coach (only their own athletes).
import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { aiEnabled, askClaude, scrub, GROUND_RULES } from './ai-core.js';

const STAFF = 'ExpoStaff';
const SESS = 'ExpoSessions';
const ATH = 'TrainAthletes';
const ATOK = 'TrainTokens';
const PLANS = 'TrainPlans';
const WORK = 'TrainWorkouts';
const ENR = 'TrainEnroll';
const SESN = 'TrainSessions';
const MSG = 'TrainMsgs';
const RATE = 'RDRate';
const SETTINGS_ID = 'settings';

// Choose your own secret. It is asked on setup so that only you can create the collections.
const SETUP_KEY = 'change-this-key';
const STAFF_HOURS = 12;
const ATHLETE_DAYS = 30;
const SA = { suppressAuth: true };
const MAXROWS = 1000;
const SIGNUPS_PER_HOUR = 100;
const IST_MS = 5.5 * 3600000;

const lc = (v) => String(v || '').trim().toLowerCase();
const unameOf = (u) => (u.username !== undefined && u.username !== null && u.username !== '' ? u.username : u.title);
const clean = (v, n) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n || 200);
const text = (v, n) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n || 1000);
const int = (v, d) => {
  const x = parseInt(v, 10);
  return Number.isFinite(x) ? x : d || 0;
};
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const nowIso = () => new Date().toISOString();
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
const weekStart = (d) => addDays(d, -dow(d));

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
function phoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
const validPhone = (d) => /^[6-9]\d{9}$/.test(d);

/* ---------- salted PIN hash (pure JS SHA-256, the Wix editor has no crypto module) ---------- */
const K256 = [];
const H256 = [];
(function () {
  let n = 2;
  let c = 0;
  while (c < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        prime = false;
        break;
      }
    }
    if (prime) {
      if (c < 8) H256[c] = Math.floor((Math.pow(n, 0.5) % 1) * 4294967296) >>> 0;
      K256[c] = Math.floor((Math.pow(n, 1 / 3) % 1) * 4294967296) >>> 0;
      c++;
    }
    n++;
  }
})();
function utf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function sha256(str) {
  const b = utf8(str);
  const bitLen = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(bitLen / 4294967296);
  const lo = bitLen >>> 0;
  b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const h = H256.slice();
  const w = new Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < b.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = ((b[i + t * 4] << 24) | (b[i + t * 4 + 1] << 16) | (b[i + t * 4 + 2] << 8) | b[i + t * 4 + 3]) >>> 0;
    for (let t = 16; t < 64; t++) {
      const s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + bb) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}
function hashPin(pin, salt) {
  let h = sha256(salt + ':' + pin);
  for (let i = 0; i < 1500; i++) h = sha256(h + salt + pin);
  return h;
}

async function all(q) {
  const out = [];
  for (let skip = 0; skip < 20000; skip += MAXROWS) {
    const r = await q().skip(skip).limit(MAXROWS).find(SA);
    out.push(...r.items);
    if (r.items.length < MAXROWS) break;
  }
  return out;
}

/* ---------- staff logins ---------- */
const roleOf = (u) => {
  const r = lc(u.role || u.Role);
  return r === 'admin' || r === 'director' ? 'director' : r === 'coach' ? 'coach' : 'none';
};
async function staffRows() {
  try {
    return (await wixData.query(STAFF).limit(200).find(SA)).items;
  } catch (e) {
    throw new Error('setup_needed');
  }
}
async function sauth(arg, need) {
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
  if (need === 'manage' && role !== 'director') throw new Error('director_only');
  return { role, name: String(u.name || unameOf(u)), username: String(unameOf(u)) };
}
export const tLogin = webMethod(Permissions.Anyone, async (arg) => {
  const username = lc(arg && arg.username);
  const password = String((arg && arg.password) || '');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === username);
  if (!u || !username || !password) throw new Error('bad_login');
  if (u.lockUntil && Date.parse(u.lockUntil) > Date.now()) throw new Error('locked');
  if (!(String(u.password || '') !== '' && same(u.password, password))) {
    const fails = int(u.failCount) + 1;
    await wixData.update(STAFF, Object.assign({}, u, fails >= 5 ? { failCount: '0', lockUntil: new Date(Date.now() + 10 * 60000).toISOString() } : { failCount: String(fails) }), SA);
    throw new Error(fails >= 5 ? 'locked' : 'bad_login');
  }
  if (u.failCount || u.lockUntil) await wixData.update(STAFF, Object.assign({}, u, { failCount: '0', lockUntil: '' }), SA);
  const role = roleOf(u);
  if (role === 'none') throw new Error('not_allowed');
  await ensureCollections();
  const sess = await wixData.insert(SESS, { token: newToken(), username: unameOf(u), desk: '', expires: new Date(Date.now() + STAFF_HOURS * 3600000).toISOString() }, SA);
  return { token: sess.token, role, name: String(u.name || unameOf(u)) };
});
export const tLogout = webMethod(Permissions.Anyone, async (arg) => {
  const t = String((arg && arg.token) || '');
  if (t.length < 20) return { ok: true };
  const r = await wixData.query(SESS).eq('token', t).limit(5).find(SA);
  if (r.items.length) await wixData.bulkRemove(SESS, r.items.map((x) => x._id), SA);
  return { ok: true };
});
export const tWhoami = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  return { role: a.role, name: a.name };
});

/* ---------- plan builder (used for the starter plans) ---------- */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PEAK_LONG = { 5: 8, 10: 14, 21.1: 18, 42.2: 30 };
const roundKm = (x) => Math.round(x * 2) / 2;
// 4 runs a week (Tue easy, Thu quality, Sat short easy, Sun long), Mon / Wed / Fri rest or cross-train.
// Long run grows every week except a lighter 4th week and a taper in the last week; the last Sunday is the race.
function buildWorkouts(goalKm, weeks) {
  const peak = PEAK_LONG[goalKm] || 10;
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const last = w === weeks;
    const stepBack = weeks >= 6 && w === Math.floor(weeks / 2);
    const grow = (w - 1) / Math.max(1, weeks - 2);
    let long = roundKm(peak * (0.5 + 0.5 * Math.min(1, grow)));
    if (stepBack) long = roundKm(long * 0.75);
    if (last) long = roundKm(peak * 0.4);
    const easy = roundKm(Math.max(3, long * 0.45));
    const short = roundKm(Math.max(3, long * 0.35));
    const minutes = (km) => Math.round(km * 6.5);
    const add = (day, type, title, km, notes) => out.push({ week: w, day, type, title, km, minutes: km ? minutes(km) : type === 'cross' ? 30 : 0, notes: notes || '' });
    add(1, 'rest', 'Rest day', 0, 'Full rest, or a gentle walk.');
    add(2, 'easy', 'Easy run', easy, 'Conversation pace. You should be able to speak in full sentences.');
    add(3, 'cross', 'Cross-training or strength', 0, '30 min cycling, swimming, or strength work for legs and core.');
    if (last) add(4, 'easy', 'Shake-out run', roundKm(Math.max(3, goalKm * 0.2)), 'Very easy, with 4 short relaxed pickups.');
    else if (w % 2 === 1) add(4, 'interval', 'Intervals', roundKm(Math.max(4, easy * 0.9)), 'Warm up 10 min, then 5 x 3 min fast with 2 min jog between, cool down 10 min.');
    else add(4, 'tempo', 'Tempo run', roundKm(Math.max(4, easy * 0.9)), 'Warm up 10 min, 15 to 20 min at comfortably hard pace, cool down 10 min.');
    add(5, 'rest', 'Rest day', 0, 'Rest. Eat well, sleep well.');
    if (last) add(6, 'rest', 'Rest and prepare', 0, 'Lay out kit, check bib and shoes.');
    else add(6, 'easy', 'Easy short run', short, 'Relaxed. Finish feeling fresh.');
    if (last) out.push({ week: w, day: 7, type: 'race', title: 'Race day', km: goalKm, minutes: 0, notes: 'Start easy, finish strong. Enjoy it.' });
    else add(7, 'long', 'Long run', long, 'Slow and steady. Practise drinking and fuelling.');
  }
  return out;
}
const STARTER = [
  { name: '5K Starter, 8 weeks', goal: '5K', km: 5, level: 'Beginner', blurb: 'For people who can run or walk-run about 20 minutes and want to run a 5K.' },
  { name: '10K Builder, 8 weeks', goal: '10K', km: 10, level: 'Beginner to intermediate', blurb: 'For runners who can run 5 km and want to run a 10K.' },
  { name: 'Half Marathon Ready, 8 weeks', goal: 'Half marathon', km: 21.1, level: 'Intermediate', blurb: 'For runners who already run 10 km and want a strong half marathon.' },
];

/* ---------- plans and settings ---------- */
const planOut = (p) => ({ id: p._id, name: p.name, goal: p.goal || '', weeks: int(p.weeks), level: p.level || '', blurb: p.blurb || '', status: p.status || 'live', days: int(p.days) });
const TYPES = ['easy', 'long', 'tempo', 'interval', 'rest', 'cross', 'strength', 'race', 'other'];
const workOut = (x) => ({ id: x._id, week: int(x.week), day: int(x.day), type: x.type, title: x.title, km: num(x.km), minutes: int(x.minutes), notes: x.notes || '' });
async function readSettings() {
  const r = await wixData.get(PLANS, SETTINGS_ID, SA).catch(() => null);
  let j = {};
  try {
    j = r && r.blurb ? JSON.parse(r.blurb) : {};
  } catch (e) {
    j = {};
  }
  return { freeWeeks: int(j.freeWeeks, 8) || 8, coachedPrice: clean(j.coachedPrice === undefined ? '0' : j.coachedPrice, 40), coachedBlurb: clean(j.coachedBlurb, 300) };
}
const priceText = (s) => (/^0*(\.0+)?$/.test(s.coachedPrice) || s.coachedPrice === '' ? 'Free for now' : s.coachedPrice);
export const getTrainSettings = webMethod(Permissions.Anyone, async () => {
  const s = await readSettings();
  return Object.assign({}, s, { coachedPriceText: priceText(s) });
});
export const saveTrainSettings = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  const weeks = int(arg.freeWeeks, 8);
  if (weeks < 1 || weeks > 52) throw new Error('bad_weeks');
  const j = { freeWeeks: weeks, coachedPrice: clean(arg.coachedPrice, 40) || '0', coachedBlurb: clean(arg.coachedBlurb, 300) };
  await wixData.save(PLANS, { _id: SETTINGS_ID, name: 'settings', goal: '', weeks: '0', level: '', blurb: JSON.stringify(j), status: 'hidden', days: '0' }, SA);
  return Object.assign({}, await readSettings(), { coachedPriceText: priceText(j) });
});
const livePlans = async () => (await all(() => wixData.query(PLANS).ascending('_id'))).filter((p) => p._id !== SETTINGS_ID);
// Public: the plans an athlete can start for free.
export const openPlans = webMethod(Permissions.Anyone, async () => {
  const list = (await livePlans().catch(() => [])).filter((p) => (p.status || 'live') === 'live');
  const s = await readSettings().catch(() => ({ freeWeeks: 8, coachedPrice: '0', coachedBlurb: '' }));
  return { plans: list.map(planOut), settings: Object.assign({}, s, { coachedPriceText: priceText(s) }) };
});
export const listPlans = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg);
  return { plans: (await livePlans()).map(planOut) };
});
export const getPlan = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg);
  const p = await wixData.get(PLANS, String(arg.id || ''), SA).catch(() => null);
  if (!p || p._id === SETTINGS_ID) throw new Error('no_plan');
  const w = (await all(() => wixData.query(WORK).eq('plan', p._id).ascending('_id'))).map(workOut).sort((a, b) => a.week - b.week || a.day - b.day);
  return { plan: planOut(p), workouts: w };
});
function cleanWorkouts(list, weeks) {
  if (!Array.isArray(list) || !list.length || list.length > 400) throw new Error('bad_workouts');
  const seen = new Set();
  return list.map((x) => {
    const week = int(x.week);
    const day = int(x.day);
    const type = String(x.type || '');
    const km = num(x.km);
    const minutes = int(x.minutes);
    const title = clean(x.title, 80);
    if (week < 1 || week > weeks || day < 1 || day > 7 || !TYPES.includes(type) || !title || km < 0 || km > 300 || minutes < 0 || minutes > 1500) throw new Error('bad_workouts');
    const key = week + '-' + day;
    if (seen.has(key)) throw new Error('bad_workouts');
    seen.add(key);
    return { week, day, type, title, km, minutes, notes: text(x.notes, 400) };
  });
}
export const savePlan = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  const name = clean(arg.name, 80);
  const weeks = int(arg.weeks);
  if (name.length < 3) throw new Error('name_needed');
  if (weeks < 1 || weeks > 52) throw new Error('bad_weeks');
  const status = arg.status === 'draft' ? 'draft' : 'live';
  const old = arg.id ? await wixData.get(PLANS, String(arg.id), SA).catch(() => null) : null;
  if (arg.id && (!old || old._id === SETTINGS_ID)) throw new Error('no_plan');
  const work = arg.workouts === undefined && old ? null : cleanWorkouts(arg.workouts, weeks);
  const row = { name, goal: clean(arg.goal, 30), weeks: String(weeks), level: clean(arg.level, 40), blurb: text(arg.blurb, 300), status, days: '7' };
  const saved = old ? await wixData.update(PLANS, Object.assign({}, old, row), SA) : await wixData.insert(PLANS, row, SA);
  if (work) {
    const prev = await all(() => wixData.query(WORK).eq('plan', saved._id).ascending('_id'));
    if (prev.length) await wixData.bulkRemove(WORK, prev.map((x) => x._id), SA);
    await wixData.bulkInsert(WORK, work.map((x) => Object.assign({ plan: saved._id }, x, { km: String(x.km), minutes: String(x.minutes), week: String(x.week), day: String(x.day) })), SA);
  }
  return { plan: planOut(saved) };
});
export const removePlan = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  const p = await wixData.get(PLANS, String(arg.id || ''), SA).catch(() => null);
  if (!p || p._id === SETTINGS_ID) throw new Error('no_plan');
  const used = await wixData.query(ENR).eq('plan', p._id).limit(1).find(SA);
  if (used.items.length) throw new Error('plan_in_use');
  const prev = await all(() => wixData.query(WORK).eq('plan', p._id).ascending('_id'));
  if (prev.length) await wixData.bulkRemove(WORK, prev.map((x) => x._id), SA);
  await wixData.bulkRemove(PLANS, [p._id], SA);
  return { ok: true };
});

/* ---------- athletes ---------- */
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
async function rateGate() {
  const key = 'train|' + nowIso().slice(0, 13);
  const row = await wixData.get(RATE, key, SA).catch(() => null);
  const n = row ? int(row.n) : 0;
  if (n >= SIGNUPS_PER_HOUR) throw new Error('busy_try_later');
  await wixData.save(RATE, { _id: key, n: String(n + 1) }, SA);
}
async function newAthleteToken(a) {
  try {
    const old = await wixData.query(ATOK).lt('expires', nowIso()).limit(100).find(SA);
    if (old.items.length) await wixData.bulkRemove(ATOK, old.items.map((x) => x._id), SA);
  } catch (e) {
    // clean-up is best effort
  }
  const t = await wixData.insert(ATOK, { token: newToken(), athlete: a._id, expires: new Date(Date.now() + ATHLETE_DAYS * 86400000).toISOString() }, SA);
  return t.token;
}
async function aauth(arg) {
  const t = String((arg && arg.token) || '');
  if (t.length < 20) throw new Error('not_logged_in');
  let row;
  try {
    row = (await wixData.query(ATOK).eq('token', t).limit(1).find(SA)).items[0];
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!row || Date.parse(row.expires) < Date.now()) throw new Error('not_logged_in');
  const a = await wixData.get(ATH, row.athlete, SA).catch(() => null);
  if (!a) throw new Error('not_logged_in');
  return a;
}
const athOut = (a) => ({ id: a._id, name: a.name, phone: a.phone, level: a.level || '', goal: a.goal || '', goalDate: a.goalDate || '' });
export const athleteSignup = webMethod(Permissions.Anyone, async (arg) => {
  await ensureCollections();
  if (arg && arg.website) return { ok: true }; // hidden field: only bots fill it
  const name = clean(arg && arg.name, 80);
  const phone = phoneDigits(arg && arg.phone);
  const pin = String((arg && arg.pin) || '');
  if (name.length < 2) throw new Error('name_needed');
  if (!validPhone(phone)) throw new Error('bad_phone');
  if (!/^\d{6}$/.test(pin)) throw new Error('bad_pin');
  const level = LEVELS.includes(arg.level) ? arg.level : 'Beginner';
  const goalDate = arg.goalDate && validDate(String(arg.goalDate)) ? String(arg.goalDate) : '';
  await rateGate();
  const dup = await wixData.query(ATH).eq('phone', phone).limit(1).find(SA);
  if (dup.items.length) throw new Error('already_signed_up');
  const salt = newToken().slice(0, 16);
  const a = await wixData.insert(ATH, { name, phone, salt, pinHash: hashPin(pin, salt), level, goal: clean(arg.goal, 60), goalDate, failCount: '0', lockUntil: '', createdAt: nowIso() }, SA);
  // two sign-ups of one number at the same moment: the earlier row wins
  const mine = (await all(() => wixData.query(ATH).eq('phone', phone).ascending('_id'))).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)) || String(x._id).localeCompare(String(y._id)));
  if (mine[0]._id !== a._id) {
    await wixData.bulkRemove(ATH, [a._id], SA);
    throw new Error('already_signed_up');
  }
  return { token: await newAthleteToken(a), athlete: athOut(a) };
});
export const athleteLogin = webMethod(Permissions.Anyone, async (arg) => {
  const phone = phoneDigits(arg && arg.phone);
  const pin = String((arg && arg.pin) || '');
  let a;
  try {
    a = (await wixData.query(ATH).eq('phone', phone).limit(1).find(SA)).items[0];
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!a || !pin) throw new Error('bad_login');
  if (a.lockUntil && Date.parse(a.lockUntil) > Date.now()) throw new Error('locked');
  if (!same(hashPin(pin, a.salt), a.pinHash)) {
    const fails = int(a.failCount) + 1;
    await wixData.update(ATH, Object.assign({}, a, fails >= 5 ? { failCount: '0', lockUntil: new Date(Date.now() + 10 * 60000).toISOString() } : { failCount: String(fails) }), SA);
    throw new Error(fails >= 5 ? 'locked' : 'bad_login');
  }
  if (a.failCount !== '0' || a.lockUntil) await wixData.update(ATH, Object.assign({}, a, { failCount: '0', lockUntil: '' }), SA);
  return { token: await newAthleteToken(a), athlete: athOut(a) };
});
export const athleteLogout = webMethod(Permissions.Anyone, async (arg) => {
  const t = String((arg && arg.token) || '');
  if (t.length < 20) return { ok: true };
  const r = await wixData.query(ATOK).eq('token', t).limit(5).find(SA);
  if (r.items.length) await wixData.bulkRemove(ATOK, r.items.map((x) => x._id), SA);
  return { ok: true };
});
export const changePin = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  if (!same(hashPin(String(arg.oldPin || ''), a.salt), a.pinHash)) throw new Error('bad_login');
  if (!/^\d{6}$/.test(String(arg.newPin || ''))) throw new Error('bad_pin');
  const salt = newToken().slice(0, 16);
  await wixData.update(ATH, Object.assign({}, a, { salt, pinHash: hashPin(String(arg.newPin), salt) }), SA);
  return { ok: true };
});

/* ---------- enrolments and sessions ---------- */
const enrOut = (e) => ({ id: e._id, athleteId: e.athlete, plan: e.plan, planName: e.planName, start: e.start, kind: e.kind, coach: e.coachName || '', coachStatus: e.coachStatus || '', reqNote: e.reqNote || '', status: e.status });
const sesOut = (s) => ({ id: s._id, date: s.date, week: int(s.week), type: s.type, title: s.title, km: num(s.km), minutes: int(s.minutes), notes: s.notes || '', status: s.status || 'planned', aKm: s.aKm === '' || s.aKm === undefined ? null : num(s.aKm), aMin: s.aMin === '' || s.aMin === undefined ? null : int(s.aMin), rpe: s.rpe ? int(s.rpe) : null, aNote: s.aNote || '', feedback: s.feedback || '', feedbackBy: s.feedbackBy || '', feedbackAt: s.feedbackAt || '', source: s.source || 'plan' });
const activeEnr = async (athleteId) => (await all(() => wixData.query(ENR).eq('athlete', athleteId).ascending('_id'))).filter((e) => e.status === 'active').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
const sessionsOf = async (enrId) => (await all(() => wixData.query(SESN).eq('enroll', enrId).ascending('_id'))).sort((a, b) => a.date.localeCompare(b.date) || a._id.localeCompare(b._id));
const counted = (s) => !['rest'].includes(s.type);
// Adherence looks at workouts whose date has passed.
function stats(sessions, today) {
  const due = sessions.filter((s) => counted(s) && s.date < today);
  const done = due.filter((s) => s.status === 'done').length;
  const ws = weekStart(today);
  const wk = sessions.filter((s) => s.date >= ws && s.date < addDays(ws, 7));
  const last = sessions.filter((s) => s.status === 'done').map((s) => s.date).sort().pop() || '';
  return {
    due: due.length,
    done,
    skipped: due.filter((s) => s.status === 'skipped').length,
    missed: due.filter((s) => s.status === 'planned').length,
    adherence: due.length ? Math.round((done / due.length) * 100) : null,
    weekPlannedKm: Math.round(wk.filter(counted).reduce((t, s) => t + num(s.km), 0) * 10) / 10,
    weekDoneKm: Math.round(wk.filter((s) => s.status === 'done').reduce((t, s) => t + (s.aKm === '' || s.aKm === undefined ? num(s.km) : num(s.aKm)), 0) * 10) / 10,
    lastDone: last,
  };
}
const unreadFor = (msgs, who) => msgs.filter((m) => m.from !== who && m.read !== '1').length;
export const enrollPlan = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const plan = await wixData.get(PLANS, String(arg.planId || ''), SA).catch(() => null);
  if (!plan || plan._id === SETTINGS_ID || (plan.status || 'live') !== 'live') throw new Error('no_plan');
  const start = String(arg.startDate || '');
  const today = todayIst();
  if (!validDate(start) || start < addDays(today, -7) || start > addDays(today, 365)) throw new Error('bad_start');
  const cur = await activeEnr(a._id);
  if (cur) throw new Error('already_enrolled');
  const work = (await all(() => wixData.query(WORK).eq('plan', plan._id).ascending('_id'))).map(workOut);
  if (!work.length) throw new Error('plan_empty');
  const enr = await wixData.insert(ENR, { athlete: a._id, plan: plan._id, planName: plan.name, start, kind: 'free', coach: '', coachName: '', coachStatus: '', reqNote: '', status: 'active', createdAt: nowIso() }, SA);
  await wixData.bulkInsert(SESN, work.map((w) => ({ enroll: enr._id, athlete: a._id, date: addDays(start, (w.week - 1) * 7 + (w.day - 1)), week: String(w.week), type: w.type, title: w.title, km: String(w.km), minutes: String(w.minutes), notes: w.notes, status: 'planned', aKm: '', aMin: '', rpe: '', aNote: '', feedback: '', feedbackBy: '', feedbackAt: '', source: 'plan' })), SA);
  return { enrollment: enrOut(enr) };
});
export const endPlan = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur) throw new Error('no_enroll');
  await wixData.update(ENR, Object.assign({}, cur, { status: 'ended', endedAt: nowIso() }), SA);
  return { ok: true };
});
export const myHome = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const today = todayIst();
  const cur = await activeEnr(a._id);
  const s = await readSettings();
  const base = { athlete: athOut(a), today, settings: Object.assign({}, s, { coachedPriceText: priceText(s) }) };
  if (!cur) return Object.assign(base, { enrollment: null });
  const sessions = await sessionsOf(cur._id);
  const msgs = cur.coachStatus === 'active' ? await all(() => wixData.query(MSG).eq('enroll', cur._id).ascending('_id')) : [];
  const ws = weekStart(today);
  return Object.assign(base, {
    enrollment: enrOut(cur),
    todays: sessions.filter((x) => x.date === today).map(sesOut),
    next: sessions.filter((x) => x.date > today && counted(x) && x.status === 'planned').slice(0, 1).map(sesOut)[0] || null,
    week: sessions.filter((x) => x.date >= ws && x.date < addDays(ws, 7)).map(sesOut),
    stats: stats(sessions, today),
    unread: unreadFor(msgs, 'athlete'),
    daysLeft: sessions.length ? Math.max(0, Math.round((Date.parse(sessions[sessions.length - 1].date) - Date.parse(today)) / 86400000)) : 0,
  });
});
export const mySessions = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur) return { sessions: [] };
  return { sessions: (await sessionsOf(cur._id)).map(sesOut), coached: cur.coachStatus === 'active' };
});
const RPE = (v) => (v === '' || v === undefined || v === null ? '' : String(Math.min(10, Math.max(1, int(v)))));
export const logSession = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const s = await wixData.get(SESN, String(arg.id || ''), SA).catch(() => null);
  if (!s || s.athlete !== a._id) throw new Error('no_session');
  const status = String(arg.status || '');
  if (!['done', 'skipped', 'planned'].includes(status)) throw new Error('bad_status');
  if (status === 'done' && s.date > todayIst()) throw new Error('future_session');
  const aKm = arg.aKm === '' || arg.aKm === undefined || arg.aKm === null ? '' : num(arg.aKm);
  const aMin = arg.aMin === '' || arg.aMin === undefined || arg.aMin === null ? '' : int(arg.aMin);
  if ((aKm !== '' && (aKm < 0 || aKm > 300)) || (aMin !== '' && (aMin < 0 || aMin > 1500))) throw new Error('bad_numbers');
  const next = Object.assign({}, s, status === 'planned' ? { status, aKm: '', aMin: '', rpe: '', aNote: '' } : { status, aKm: aKm === '' ? '' : String(aKm), aMin: aMin === '' ? '' : String(aMin), rpe: RPE(arg.rpe), aNote: text(arg.note, 500) });
  return { session: sesOut(await wixData.update(SESN, next, SA)) };
});
// An athlete may add their own extra run to the schedule.
export const addMySession = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur) throw new Error('no_enroll');
  const date = String(arg.date || '');
  const type = String(arg.type || 'easy');
  const km = num(arg.km);
  const minutes = int(arg.minutes);
  if (!validDate(date) || date < addDays(todayIst(), -30) || date > addDays(todayIst(), 365) || !TYPES.includes(type) || km < 0 || km > 300 || minutes < 0 || minutes > 1500) throw new Error('bad_session');
  const title = clean(arg.title, 80) || 'My run';
  const row = { enroll: cur._id, athlete: a._id, date, week: '0', type, title, km: String(km), minutes: String(minutes), notes: '', status: 'planned', aKm: '', aMin: '', rpe: '', aNote: '', feedback: '', feedbackBy: '', feedbackAt: '', source: 'self' };
  return { session: sesOut(await wixData.insert(SESN, row, SA)) };
});
export const requestCoaching = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur) throw new Error('no_enroll');
  if (cur.coachStatus === 'active') throw new Error('already_coached');
  await wixData.update(ENR, Object.assign({}, cur, { coachStatus: 'requested', reqNote: text(arg.note, 300) }), SA);
  return { ok: true };
});
export const cancelCoachingRequest = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur || cur.coachStatus !== 'requested') throw new Error('no_request');
  await wixData.update(ENR, Object.assign({}, cur, { coachStatus: '', reqNote: '' }), SA);
  return { ok: true };
});

/* ---------- messages (coached only) ---------- */
const msgOut = (m) => ({ id: m._id, from: m.from, name: m.name, text: m.text, at: m.at });
const thread = async (enrId) => (await all(() => wixData.query(MSG).eq('enroll', enrId).ascending('_id'))).sort((a, b) => a.at.localeCompare(b.at) || a._id.localeCompare(b._id));
async function markRead(list, reader) {
  const mine = list.filter((m) => m.from !== reader && m.read !== '1');
  if (mine.length) await wixData.bulkUpdate(MSG, mine.map((m) => Object.assign({}, m, { read: '1' })), SA);
}
export const myMessages = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur || cur.coachStatus !== 'active') throw new Error('no_coach');
  const list = await thread(cur._id);
  await markRead(list, 'athlete');
  return { messages: list.map(msgOut), coach: cur.coachName };
});
export const sendMyMessage = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur || cur.coachStatus !== 'active') throw new Error('no_coach');
  const t = text(arg.text, 1000);
  if (!t) throw new Error('text_needed');
  const m = await wixData.insert(MSG, { enroll: cur._id, from: 'athlete', name: a.name, text: t, at: nowIso(), read: '' }, SA);
  return { message: msgOut(m) };
});

/* ---------- coach and director ---------- */
async function staffEnroll(a, id) {
  const e = await wixData.get(ENR, String(id || ''), SA).catch(() => null);
  if (!e) throw new Error('no_enroll');
  if (a.role === 'coach' && lc(e.coach) !== lc(a.username)) throw new Error('not_yours');
  return e;
}
const coachedActive = (e) => e.coachStatus === 'active' && e.status === 'active';
export const listCoaches = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  return { coaches: (await staffRows()).filter((u) => roleOf(u) !== 'none').map((u) => ({ username: String(unameOf(u)), name: String(u.name || unameOf(u)), role: roleOf(u) })) };
});
export const listAthletes = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const today = todayIst();
  let enrs = (await all(() => wixData.query(ENR).ascending('_id'))).filter((e) => e.status === 'active');
  if (a.role === 'coach') enrs = enrs.filter((e) => coachedActive(e) && lc(e.coach) === lc(a.username));
  const ids = new Set(enrs.map((e) => e._id));
  const [sess, msgs, aths] = await Promise.all([all(() => wixData.query(SESN).ascending('_id')), all(() => wixData.query(MSG).ascending('_id')), all(() => wixData.query(ATH).ascending('_id'))]);
  const byEnr = new Map();
  sess.forEach((s) => {
    if (ids.has(s.enroll)) (byEnr.get(s.enroll) || byEnr.set(s.enroll, []).get(s.enroll)).push(s);
  });
  const am = new Map(aths.map((x) => [x._id, x]));
  const rows = enrs.map((e) => {
    const ath = am.get(e.athlete) || {};
    const ms = msgs.filter((m) => m.enroll === e._id);
    return Object.assign(enrOut(e), { name: ath.name || '', phone: ath.phone || '', level: ath.level || '', goal: ath.goal || '', stats: stats(byEnr.get(e._id) || [], today), unread: unreadFor(ms, 'coach') });
  });
  rows.sort((x, y) => (y.coachStatus === 'requested') - (x.coachStatus === 'requested') || y.unread - x.unread || x.name.localeCompare(y.name));
  return { athletes: rows, totals: { athletes: aths.length, active: enrs.length, requests: rows.filter((r) => r.coachStatus === 'requested').length } };
});
export const athleteDetail = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const e = await staffEnroll(a, arg.enroll);
  const ath = await wixData.get(ATH, e.athlete, SA).catch(() => null);
  const sessions = await sessionsOf(e._id);
  const msgs = e.coachStatus === 'active' ? await thread(e._id) : [];
  if (e.coachStatus === 'active') await markRead(msgs, 'coach');
  return { enrollment: enrOut(e), athlete: ath ? athOut(ath) : null, sessions: sessions.map(sesOut), messages: msgs.map(msgOut), stats: stats(sessions, todayIst()), canCoach: coachedActive(e) };
});
export const assignCoach = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  const e = await wixData.get(ENR, String(arg.enroll || ''), SA).catch(() => null);
  if (!e || e.status !== 'active') throw new Error('no_enroll');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === lc(arg.coach) && roleOf(r) !== 'none');
  if (!u) throw new Error('no_coach_user');
  await wixData.update(ENR, Object.assign({}, e, { kind: 'coached', coach: String(unameOf(u)), coachName: String(u.name || unameOf(u)), coachStatus: 'active' }), SA);
  return { ok: true };
});
// Back to a free plan: the coach and the messages stop (old messages are kept but no longer shown).
export const stopCoaching = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  const e = await wixData.get(ENR, String(arg.enroll || ''), SA).catch(() => null);
  if (!e) throw new Error('no_enroll');
  await wixData.update(ENR, Object.assign({}, e, { kind: 'free', coach: '', coachName: '', coachStatus: '', reqNote: '' }), SA);
  return { ok: true };
});
export const declineCoaching = webMethod(Permissions.Anyone, async (arg) => {
  await sauth(arg, 'manage');
  const e = await wixData.get(ENR, String(arg.enroll || ''), SA).catch(() => null);
  if (!e || e.coachStatus !== 'requested') throw new Error('no_request');
  await wixData.update(ENR, Object.assign({}, e, { coachStatus: '', reqNote: '' }), SA);
  return { ok: true };
});
// The coach changes the schedule of a coached athlete. Free plans are fixed.
export const coachSaveSession = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const e = await staffEnroll(a, arg.enroll);
  if (!coachedActive(e)) throw new Error('not_coached');
  const date = String(arg.date || '');
  const type = String(arg.type || '');
  const km = num(arg.km);
  const minutes = int(arg.minutes);
  const title = clean(arg.title, 80);
  if (!validDate(date) || !TYPES.includes(type) || !title || km < 0 || km > 300 || minutes < 0 || minutes > 1500) throw new Error('bad_session');
  const old = arg.id ? await wixData.get(SESN, String(arg.id), SA).catch(() => null) : null;
  if (arg.id && (!old || old.enroll !== e._id)) throw new Error('no_session');
  if (old && old.status === 'done') throw new Error('already_done');
  const row = { date, type, title, km: String(km), minutes: String(minutes), notes: text(arg.notes, 400) };
  if (old) return { session: sesOut(await wixData.update(SESN, Object.assign({}, old, row, { source: old.source === 'self' ? 'self' : 'coach' }), SA)) };
  const ins = await wixData.insert(SESN, Object.assign({ enroll: e._id, athlete: e.athlete, week: '0', status: 'planned', aKm: '', aMin: '', rpe: '', aNote: '', feedback: '', feedbackBy: '', feedbackAt: '', source: 'coach' }, row), SA);
  return { session: sesOut(ins) };
});
export const coachRemoveSession = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const e = await staffEnroll(a, arg.enroll);
  if (!coachedActive(e)) throw new Error('not_coached');
  const s = await wixData.get(SESN, String(arg.id || ''), SA).catch(() => null);
  if (!s || s.enroll !== e._id) throw new Error('no_session');
  if (s.status === 'done') throw new Error('already_done');
  await wixData.bulkRemove(SESN, [s._id], SA);
  return { ok: true };
});
export const coachFeedback = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const e = await staffEnroll(a, arg.enroll);
  if (!coachedActive(e)) throw new Error('not_coached');
  const s = await wixData.get(SESN, String(arg.id || ''), SA).catch(() => null);
  if (!s || s.enroll !== e._id) throw new Error('no_session');
  const t = text(arg.text, 600);
  return { session: sesOut(await wixData.update(SESN, Object.assign({}, s, { feedback: t, feedbackBy: t ? a.name : '', feedbackAt: t ? nowIso() : '' }), SA)) };
});
export const coachMessage = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const e = await staffEnroll(a, arg.enroll);
  if (!coachedActive(e)) throw new Error('not_coached');
  const t = text(arg.text, 1000);
  if (!t) throw new Error('text_needed');
  const m = await wixData.insert(MSG, { enroll: e._id, from: 'coach', name: a.name, text: t, at: nowIso(), read: '' }, SA);
  return { message: msgOut(m) };
});

/* ---------- one-time setup ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
/* ---------- plan against actual: weekly load, flags, coaching suggestions ---------- */
// Same ideas the big training sites use: weekly planned against done volume, adherence, sudden jumps in load,
// missed key sessions, hard-effort streaks. Everything is plain arithmetic; the AI (if the key is set) only words
// the suggestions and drafts a note for the athlete. It never sees the athlete's name, phone or free-text notes.
const doneKm = (s) => (s.aKm === '' || s.aKm === undefined || s.aKm === null ? num(s.km) : num(s.aKm));
function insightOf(sessions, today, ath) {
  const counted2 = sessions.filter(counted);
  const ws = weekStart(today);
  const weeks = [];
  for (let k = 3; k >= 0; k--) {
    const start = addDays(ws, -7 * k);
    const end = addDays(start, 7);
    const inWeek = counted2.filter((s) => s.date >= start && s.date < end);
    const upto = k === 0 ? inWeek.filter((s) => s.date <= today) : inWeek;
    const planned = upto.reduce((t, s) => t + num(s.km), 0);
    const done = inWeek.filter((s) => s.status === 'done').reduce((t, s) => t + doneKm(s), 0);
    weeks.push({ start, plannedKm: Math.round(planned * 10) / 10, doneKm: Math.round(done * 10) / 10, pct: planned > 0 ? Math.round((done / planned) * 100) : null, current: k === 0 });
  }
  const due = counted2.filter((s) => s.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const recent = due.slice(-8);
  const missed = recent.filter((s) => s.status === 'planned').length;
  const flags = [];
  const add = (id, level, text) => flags.push({ id, level, text });
  const full = weeks.filter((w) => !w.current);
  const last = full[full.length - 1];
  const prev = full[full.length - 2];
  if (last && prev && prev.doneKm >= 5 && last.doneKm > prev.doneKm * 1.15) add('ramp', 'warn', 'Weekly distance jumped ' + Math.round(((last.doneKm - prev.doneKm) / prev.doneKm) * 100) + '% (' + prev.doneKm + ' to ' + last.doneKm + ' km). Sudden jumps raise injury risk; keep rises under about 10 to 15%.');
  if (recent.length >= 4 && missed >= 3) add('missed', 'bad', missed + ' of the last ' + recent.length + ' planned sessions were not logged or done.');
  const lastLong = [...due].reverse().find((s) => s.type === 'long');
  if (lastLong && lastLong.status !== 'done' && lastLong.date >= addDays(today, -10)) add('long', 'warn', 'The last long run (' + lastLong.date + ') was ' + (lastLong.status === 'skipped' ? 'skipped' : 'not logged') + '. It is the key session of the week.');
  const rated = due.filter((s) => s.status === 'done' && s.rpe).slice(-4);
  if (rated.length >= 3 && rated.reduce((t, s) => t + int(s.rpe), 0) / rated.length >= 8) add('hard', 'warn', 'Recent sessions felt very hard (average effort ' + (Math.round((rated.reduce((t, s) => t + int(s.rpe), 0) / rated.length) * 10) / 10) + ' out of 10). Consider an easier week.');
  const lastDone = sessions.filter((s) => s.status === 'done').map((s) => s.date).sort().pop() || '';
  if (due.length >= 3 && (!lastDone || lastDone < addDays(today, -7))) add('quiet', 'bad', 'Nothing logged in the last 7 days.');
  if (last && last.pct !== null && last.pct < 60 && !flags.some((f) => f.id === 'missed' || f.id === 'quiet')) add('under', 'warn', 'Last week only ' + last.pct + '% of the planned distance was done.');
  if (full.length >= 2 && full.slice(-2).every((w) => w.pct !== null && w.pct >= 90) && !flags.length) add('strong', 'good', 'Two weeks in a row at 90% or more of the plan. Well done.');
  const suggest = [];
  if (flags.some((f) => f.id === 'ramp')) suggest.push('Hold next week at the same distance, or cut the long run by about 20%.');
  if (flags.some((f) => f.id === 'missed' || f.id === 'quiet')) suggest.push('Check in with the athlete: illness, work, travel or motivation? Offer a lighter restart week instead of catching up on missed sessions.');
  if (flags.some((f) => f.id === 'long')) suggest.push('Move the long run to a day that works, rather than dropping it.');
  if (flags.some((f) => f.id === 'hard')) suggest.push('Swap one quality session for an easy run and check sleep and recovery.');
  if (flags.some((f) => f.id === 'under')) suggest.push('Ask what got in the way, and trim the plan to a volume the athlete can keep.');
  if (flags.some((f) => f.id === 'strong')) suggest.push('Consistent training. You can add a little: extra strides or a few more minutes on the long run.');
  if (!suggest.length) suggest.push('On plan. Keep the routine and send a short word of encouragement.');
  const dueAll = counted2.filter((s) => s.date < today);
  const doneAll = dueAll.filter((s) => s.status === 'done').length;
  return { weeks, flags, suggestions: suggest, adherence: dueAll.length ? Math.round((doneAll / dueAll.length) * 100) : null, level: ath && ath.level ? ath.level : '', goal: ath && ath.goal ? ath.goal : '' };
}
async function aiGateT(who) {
  const key = 'ai|' + lc(who) + '|' + nowIso().slice(0, 13);
  const row = await wixData.get(RATE, key, SA).catch(() => null);
  const n = row ? int(row.n) : 0;
  if (n >= 40) throw new Error('busy_try_later');
  await wixData.save(RATE, { _id: key, n: String(n + 1) }, SA);
}
// For the athlete themselves: their own weeks and flags, no AI.
export const myInsight = webMethod(Permissions.Anyone, async (arg) => {
  const a = await aauth(arg);
  const cur = await activeEnr(a._id);
  if (!cur) return { insight: null };
  return { insight: insightOf(await sessionsOf(cur._id), todayIst(), a) };
});
// For the coach (own athletes) and directors (anyone). arg.write = true adds AI wording and a draft note to the athlete.
export const coachInsight = webMethod(Permissions.Anyone, async (arg) => {
  const a = await sauth(arg);
  const e = await staffEnroll(a, arg.enroll);
  const ath = await wixData.get(ATH, e.athlete, SA).catch(() => null);
  const ins = insightOf(await sessionsOf(e._id), todayIst(), ath);
  const out = { insight: ins, enabled: await aiEnabled(), ai: false, text: '', message: '' };
  if (arg.write) {
    await aiGateT(a.username);
    const table = ins.weeks.map((w) => 'Week of ' + w.start + ': planned ' + w.plannedKm + ' km, done ' + w.doneKm + ' km' + (w.pct === null ? '' : ' (' + w.pct + '%)') + (w.current ? ' [week in progress]' : '')).join('\n');
    const facts = table + '\nOverall adherence: ' + (ins.adherence === null ? 'not enough data' : ins.adherence + '%') + '\nLevel: ' + (ins.level || 'unknown') + '\nGoal: ' + (scrub(ins.goal, 120) || 'not set') + '\nFlags: ' + (ins.flags.map((f) => f.text).join(' | ') || 'none');
    const raw = await askClaude(
      GROUND_RULES + ' You assist a running coach. Reply in exactly two parts. Part 1 begins "For the coach:" and gives at most three short suggestions for next week, based only on the facts. Part 2 begins "Note to the athlete:" and is a warm, specific message of at most 70 words that starts with "Hi {name}," and makes no medical claims.',
      '<data>\n' + facts + '\n</data>\nWrite the two parts.',
      600
    );
    const m = raw.match(/note to the athlete:\s*([\s\S]*)$/i);
    out.text = raw.replace(/note to the athlete:[\s\S]*$/i, '').replace(/^\s*for the coach:\s*/i, '').trim();
    const first = String((ath && ath.name) || '').trim().split(/\s+/)[0] || 'there';
    out.message = m ? m[1].trim().replace(/\{name\}/g, first) : '';
    out.ai = true;
  }
  return out;
});

const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  const def = (id, fields) => ({ _id: id, displayName: id, permissions: LOCKED, fields: fields.map(textField) });
  return [
    def(STAFF, ['username', 'password', 'role', 'desks', 'race', 'name', 'failCount', 'lockUntil']),
    def(SESS, ['token', 'username', 'desk', 'expires']),
    def(ATH, ['name', 'phone', 'salt', 'pinHash', 'level', 'goal', 'goalDate', 'failCount', 'lockUntil', 'createdAt']),
    def(ATOK, ['token', 'athlete', 'expires']),
    def(PLANS, ['name', 'goal', 'weeks', 'level', 'blurb', 'status', 'days']),
    def(WORK, ['plan', 'week', 'day', 'type', 'title', 'km', 'minutes', 'notes']),
    def(ENR, ['athlete', 'plan', 'planName', 'start', 'kind', 'coach', 'coachName', 'coachStatus', 'reqNote', 'status', 'createdAt', 'endedAt']),
    def(SESN, ['enroll', 'athlete', 'date', 'week', 'type', 'title', 'km', 'minutes', 'notes', 'status', 'aKm', 'aMin', 'rpe', 'aNote', 'feedback', 'feedbackBy', 'feedbackAt', 'source']),
    def(MSG, ['enroll', 'from', 'name', 'text', 'at', 'read']),
    def(RATE, ['n']),
  ];
}
async function makeCollections() {
  const create = elevate(collections.createDataCollection);
  const notes = [];
  for (const d of collectionDefs()) {
    try {
      await wixData.query(d._id).limit(1).find(SA);
      continue;
    } catch (e) {
      // missing, so create it below
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
async function seedPlans() {
  const have = await wixData.query(PLANS).limit(5).find(SA);
  if (have.items.length) return 0;
  let n = 0;
  for (const p of STARTER) {
    const row = await wixData.insert(PLANS, { name: p.name, goal: p.goal, weeks: '8', level: p.level, blurb: p.blurb, status: 'live', days: '7' }, SA);
    const w = buildWorkouts(p.km, 8);
    await wixData.bulkInsert(WORK, w.map((x) => ({ plan: row._id, week: String(x.week), day: String(x.day), type: x.type, title: x.title, km: String(x.km), minutes: String(x.minutes), notes: x.notes })), SA);
    n++;
  }
  return n;
}
let checked = false;
async function ensureCollections() {
  if (checked) return;
  await makeCollections();
  try {
    await seedPlans();
  } catch (e) {
    // seeding is best effort; the director can add plans by hand
  }
  checked = true;
}
// Creates the Training collections and the three starter plans. Needs SETUP_KEY.
export const ensureTrainSetup = webMethod(Permissions.Anyone, async (arg) => {
  if (SETUP_KEY === 'change-this-key') throw new Error('Edit SETUP_KEY at the top of training.web.js first');
  if (!arg || !same(String(arg.key || ''), SETUP_KEY)) throw new Error('Wrong setup key');
  checked = false;
  const notes = await makeCollections();
  let seeded = 0;
  try {
    seeded = await seedPlans();
  } catch (e) {
    notes.push('starter plans: ' + ((e && e.message) || 'not added'));
  }
  checked = true;
  return { summary: (notes.length ? notes.join('; ') : 'All collections already exist') + '. Starter plans added: ' + seeded };
});
export const trainHealth = webMethod(Permissions.Anyone, async () => ({ ok: true }));
