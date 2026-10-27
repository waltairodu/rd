// backend/rd-auth.js
// Logins shared by the RaceOS backends (racedir.web.js, exposoft.web.js, training.web.js): password hashing,
// session tokens, generated PINs, which role a staff row has, and the three Expo desks.
// Plain module: no Wix imports, so it can be tested on its own.
//
// Passwords are never kept as typed. A stored password looks like  h1$<salt>$<hash>  where hash is a salted,
// repeated SHA-256 (the Wix backend has no crypto module, so SHA-256 is written out here in plain JavaScript).
// A row whose password column holds anything else is a legacy plain-text password typed straight into the CMS:
// it still works, and is replaced by a hash the first time that person logs in.

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
    // A surrogate pair is one character; a lone surrogate is encoded as itself (never merged with the next character).
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha256(str) {
  const b = utf8(String(str));
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

const ROUNDS = 1500;
export const MAX_PASSWORD = 200;
const PREFIX = 'h1$';

function stretch(pw, salt) {
  let h = sha256(salt + ':' + pw);
  for (let i = 0; i < ROUNDS; i++) h = sha256(h + salt + pw);
  return h;
}

// Same time whatever the position of the first difference.
export function same(a, b) {
  const x = String(a);
  const y = String(b);
  let d = x.length ^ y.length;
  for (let k = 0; k < Math.max(x.length, y.length); k++) d |= (x.charCodeAt(k) || 0) ^ (y.charCodeAt(k) || 0);
  return d === 0;
}

// 32 random bits. Uses the platform's secure generator when there is one; otherwise Math.random, which is why
// every secret below (token, salt) is passed through SHA-256 together with the clock and a counter before it is used.
function rnd32() {
  try {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && typeof c.getRandomValues === 'function') {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] >>> 0;
    }
  } catch (e) {
    // fall through to Math.random
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
let counter = 0;
function randomHex(bytes) {
  let t = '';
  while (t.length < bytes * 2) t += sha256(rnd32() + ':' + rnd32() + ':' + Date.now() + ':' + ++counter + ':' + rnd32());
  return t.slice(0, bytes * 2);
}
// An unguessable session token (64 hex characters).
export const newToken = () => randomHex(32);
// A uniform whole number below n (rejection sampling, so no modulo bias).
function below(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  let x = rnd32();
  while (x >= limit) x = rnd32();
  return x % n;
}

export const isHashed = (stored) => /^h1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(String(stored || ''));

export function hashPassword(pw) {
  const salt = randomHex(8);
  return PREFIX + salt + '$' + stretch(String(pw), salt);
}

// true when the typed password matches the stored one (a hash, or a legacy plain-text value).
export function checkPassword(stored, typed) {
  const s = String(stored === undefined || stored === null ? '' : stored);
  const p = String(typed === undefined || typed === null ? '' : typed);
  if (s === '' || p === '') return false;
  // Nobody types a password this long. Without a cap, a megabyte "password" would make the server hash it 1,500 times.
  if (p.length > MAX_PASSWORD) return false;
  if (isHashed(s)) {
    const parts = s.split('$');
    return same(parts[2], stretch(p, parts[1]));
  }
  return same(s, p);
}

// A stored password that should be replaced by a hash after a successful login.
export const needsUpgrade = (stored) => String(stored || '') !== '' && !isHashed(stored);

// A short numeric PIN for a new desk login. No leading zero, so it survives being retyped into a spreadsheet.
export function genPin(len) {
  const n = Math.max(4, Math.min(10, len || 6));
  let p = String(1 + below(9));
  while (p.length < n) p += String(below(10));
  return p;
}

// A longer password for director, lead, viewer and coach logins. No look-alike characters (0 O 1 l I).
const PW_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function genPassword(len) {
  const n = Math.max(8, Math.min(32, len || 10));
  let p = '';
  for (let k = 0; k < n; k++) p += PW_ALPHABET[below(PW_ALPHABET.length)];
  return p;
}

/* ---------- who a staff row is ---------- */
// The role column of an ExpoStaff row, as one of:
//   director  admin or director: everything
//   lead      volunteers, race day, pacers, safety and plans (no money, no Team)
//   viewer    look only (sponsors and partners)
//   coach     the coach page only
//   desk      Expo desk staff. A row with no role at all is a desk login too: these were made by hand in the CMS
//             before roles existed, and they have always been allowed to work an Expo desk, nothing else.
//   other     any other word: no access anywhere
export function kindOf(u) {
  const r = String((u && (u.role || u.Role)) || '').trim().toLowerCase();
  if (r === 'admin' || r === 'director') return 'director';
  if (r === 'lead') return 'lead';
  if (r === 'viewer') return 'viewer';
  if (r === 'coach') return 'coach';
  if (r === '' || r === 'desk') return 'desk';
  return 'other';
}
export const unameOf = (u) => (u.username !== undefined && u.username !== null && u.username !== '' ? u.username : u.title);

/* ---------- the three Expo desks ---------- */
export const DESKS = ['Desk 1 - BIB', 'Desk 2 - Tshirt', 'Desk 3 - Misc'];
const deskKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// '1', 'Desk 2', 'tshirt' or the full name all become the full name; anything else becomes ''.
export function canonDesk(x) {
  const k = deskKey(x);
  if (!k) return '';
  const exact = DESKS.find((d) => deskKey(d) === k);
  if (exact) return exact;
  const num = k.match(/\d+/);
  if (num) return DESKS.find((d) => deskKey(d).match(/\d+/)[0] === num[0]) || '';
  return DESKS.find((d) => k.indexOf(deskKey(d.split(' - ')[1])) >= 0) || '';
}
// The desks written in a staff row ('Desk 1 - BIB,Desk 2 - Tshirt', or a loose '1, 2'), full names, no repeats. May be empty.
export function parseDesks(v) {
  const list = Array.isArray(v) ? v : String(v === undefined || v === null ? '' : v).split(',');
  const out = [];
  list.forEach((x) => {
    const c = canonDesk(x);
    if (c && !out.includes(c)) out.push(c);
  });
  return out;
}
// The desks a login may use: the ones written in its row, or all three when the row names none.
export function deskList(v) {
  const out = parseDesks(v);
  return out.length ? out : DESKS.slice();
}
// The desks column of a row (a hand-made collection may call it 'desk').
export const deskValueOf = (u) => (u.desks !== undefined && u.desks !== null && u.desks !== '' ? u.desks : u.desk);

/* ---------- errors ---------- */
// A native error (TypeError, RangeError and so on) means a bug, or an odd input that got past the checks. It is written to
// the log for the owner and the browser is told only 'server_error', so no internal detail ever reaches it.
// An error this code threw itself (a plain word such as 'not_logged_in', or a sentence) passes through untouched.
export function tidyError(e, where) {
  const n = e && e.name;
  if (n === 'TypeError' || n === 'RangeError' || n === 'ReferenceError' || n === 'SyntaxError' || n === 'EvalError' || n === 'URIError') {
    try {
      console.error((where || 'RaceOS') + ': ' + (e && e.stack ? e.stack : e));
    } catch (x) {
      // logging is best effort
    }
    return new Error('server_error');
  }
  return e;
}

/* ---------- a limited number of tries at the same moment ---------- */
// A counter that is read, added to and written back cannot stop a burst: requests that arrive together all read the same
// number. So the tries of a window (say ten minutes) are 'slots': records with fixed ids that can each be inserted only
// once. When many requests arrive at the same instant only `max` of them get a slot; the others are refused without
// their password being looked at. A new window has new ids, so nothing needs to expire. `db` is wix-data.
export const windowOf = (ms, now) => Math.floor((now === undefined ? Date.now() : now) / ms);
export const slotId = (prefix, win, k) => prefix + '~' + win + '~' + k;
// Returns the id of the slot taken, or '' when all `max` slots of this window are taken. Any other database error is thrown.
export async function takeSlot(db, col, prefix, max, ms, opts, now) {
  const t = now === undefined ? Date.now() : now;
  const w = windowOf(ms, t);
  for (let k = 0; k < max; k++) {
    const id = slotId(prefix, w, k);
    try {
      await db.insert(col, { _id: id, n: String(t) }, opts);
      if (k === 0) await db.bulkRemove(col, [slotId(prefix, w - 1, 0), slotId(prefix, w - 2, 0)].concat(Array.from({ length: max - 1 }, (x, j) => slotId(prefix, w - 1, j + 1))), opts).catch(() => null);
      return id;
    } catch (e) {
      const taken = await db.get(col, id, opts).catch(() => null);
      if (!taken) throw e;
    }
  }
  return '';
}
// Gives the slots of this window and the one before back (after a good login).
export function freeSlots(db, col, prefix, max, ms, opts, now) {
  const w = windowOf(ms, now);
  const ids = [];
  for (const x of [w, w - 1]) for (let k = 0; k < max; k++) ids.push(slotId(prefix, x, k));
  return db.bulkRemove(col, ids, opts).catch(() => null);
}
// A short fixed-length name for an account in a slot prefix (whatever odd characters its username has).
export const slotKey = (kind, name) => kind + '~' + sha256(String(name || '').trim().toLowerCase()).slice(0, 24);
