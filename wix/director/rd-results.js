// backend/rd-results.js
// The rules behind waves, corrals, results and awards. No database and no Wix in here, so every rule can be tested on its own.
//
// A time is held as whole CENTISECONDS (an integer) and is cut to hundredths, never rounded, as athletics does.
// A date of birth is used only to work out an age. The screens and the files show the age and the age group, never the date.
// Ranking: the same time shares a place, and the next place is skipped (1, 2, 2, 4).

export const MAX_CS = 48 * 3600 * 100; // 48 hours
export const STATUSES = ['fin', 'dnf', 'dns', 'dsq'];
export const MAX_CSV_CHARS = 400000;
export const MAX_ROWS = 5000;
export const MAX_COLS = 20;
export const DEFAULT_SETTINGS = { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: '', dob: '', age: '', seed: '' } };

/* ---------- small helpers ---------- */
// Text typed by a person: control characters (including line and paragraph separators) become a space, the characters that
// flip the direction of text are dropped, and the rest is cut to length. Objects and lists give ''.
export const cleanText = (v, n) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, n || 200);
export const lc = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export const catKey = (c) => lc(c).replace(/[^a-z0-9]/g, '');
export const sOnly = (v) => (typeof v === 'string' ? v : '');
export const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
// A repeat key: 8 to 40 letters, digits, dashes and underscores (the page makes one for every create).
export const isKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(k);
// A stored number (text or number) as a whole number above zero, else 0.
export const P = (v) => {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(x) && x > 0 ? Math.trunc(x) : 0;
};
export function parseJson(s, dflt) {
  try {
    const v = typeof s === 'string' && s ? JSON.parse(s) : s;
    return v === undefined || v === null ? dflt : v;
  } catch (e) {
    return dflt;
  }
}
const pad = (n) => String(n).padStart(2, '0');

/* ---------- bib numbers ---------- */
// The form a bib takes everywhere inside: capital letters, digits and dashes, 1 to 12 of them. Anything else gives ''.
export function bibKey(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) v = String(v);
  if (typeof v !== 'string') return '';
  const s = v.trim().toUpperCase();
  return /^[A-Z0-9-]{1,12}$/.test(s) ? s : '';
}
// Numbers in number order, before bibs with letters.
export function bibCmp(a, b) {
  const x = String(a);
  const y = String(b);
  const nx = /^\d+$/.test(x);
  const ny = /^\d+$/.test(y);
  if (nx && ny) return parseInt(x, 10) - parseInt(y, 10) || (x < y ? -1 : x > y ? 1 : 0);
  if (nx) return -1;
  if (ny) return 1;
  return x < y ? -1 : x > y ? 1 : 0;
}
// A timing file may drop leading zeros ("0123" becomes "123"): try the exact bib, then without leading zeros.
export function findByBib(map, key) {
  if (!key) return null;
  if (map.has(key)) return map.get(key);
  if (/^\d+$/.test(key)) {
    const t = String(parseInt(key, 10));
    if (t !== key && map.has(t)) return map.get(t);
  }
  return null;
}

/* ---------- times ---------- */
const TIME_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/;
// "1:45:30", "1:45:30.5", "45:30" (minutes and seconds) become centiseconds. Text with other shapes, a minute or a second above 59,
// zero, anything beyond 48 hours, numbers and lists all give null.
export function parseTime(v) {
  if (typeof v !== 'string') return null;
  const m = TIME_RE.exec(v.trim());
  if (!m) return null;
  const h = m[1] === undefined ? 0 : parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  if (mi > 59 || s > 59 || h > 47) return null;
  const frac = m[4] === undefined ? 0 : parseInt((m[4] + '00').slice(0, 2), 10);
  const cs = ((h * 60 + mi) * 60 + s) * 100 + frac;
  return cs > 0 && cs <= MAX_CS ? cs : null;
}
// Centiseconds as h:mm:ss, with .cc only when there are hundredths (or always when asked).
export function fmtTime(cs, always) {
  const t = Math.trunc(typeof cs === 'number' ? cs : typeof cs === 'string' && cs.trim() !== '' ? Number(cs) : NaN);
  if (!Number.isFinite(t) || t <= 0) return '';
  const c = t % 100;
  const total = Math.trunc(t / 100);
  const base = Math.trunc(total / 3600) + ':' + pad(Math.trunc(total / 60) % 60) + ':' + pad(total % 60);
  return c === 0 && !always ? base : base + '.' + pad(c);
}
// The distance in a category name: "25 K - Debut Trail" is 25, "Half Marathon" is 21.0975. null when it cannot be told.
export function catKm(name, cats) {
  const n = String(name || '');
  const hit = (Array.isArray(cats) ? cats : []).find((c) => c && catKey(c.name) && catKey(c.name) === catKey(n));
  if (hit && Number(hit.km) > 0) return Number(hit.km);
  const m = /(\d+(?:\.\d+)?)\s*k(?:m|ms)?\b/i.exec(n);
  if (m && Number(m[1]) > 0 && Number(m[1]) <= 500) return Number(m[1]);
  if (/half/i.test(n)) return 21.0975;
  if (/marathon/i.test(n)) return 42.195;
  return null;
}
// A finish faster than 2:30 a km, or slower than 40:00 a km, is probably a typing slip (1:45 meant as 1 hour 45).
export function paceWarn(cs, km) {
  if (!(cs > 0) || !(km > 0)) return '';
  const minPerKm = cs / 100 / 60 / km;
  return minPerKm < 2.5 ? 'fast' : minPerKm > 40 ? 'slow' : '';
}

/* ---------- gender, date of birth, age ---------- */
const G_M = ['m', 'male', 'man', 'men', 'boy', 'gent', 'gents', 'mr'];
const G_F = ['f', 'female', 'woman', 'women', 'girl', 'lady', 'ladies', 'ms', 'mrs', 'miss'];
const G_X = ['x', 'o', 'other', 'others', 'nonbinary', 'non-binary', 'non binary', 'nb', 'third gender', 'transgender', 'trans'];
// "Male", "m", "WOMEN" become M or F; other / non-binary becomes X; anything else (including "prefer not to say") gives ''.
export function normGender(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase().replace(/\./g, '');
  if (G_M.includes(s)) return 'M';
  if (G_F.includes(s)) return 'F';
  if (G_X.includes(s)) return 'X';
  return '';
}
export const genderLabel = (g) => (g === 'M' ? 'Men' : g === 'F' ? 'Women' : g === 'X' ? 'Other' : 'Not recorded');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIdx = (s) => {
  const i = MONTHS.indexOf(String(s).slice(0, 3).toLowerCase());
  return i < 0 ? 0 : i + 1;
};
const okDate = (y, m, d) => {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + '-' + pad(m) + '-' + pad(d) : '';
};
// 1989-05-12, 12/05/1989, 12-5-1989, 12.05.1989, 12 May 1989 and May 12, 1989 become 1989-05-12. A day-first date is assumed
// (India): 05/06/1990 is 5 June. 12/25/1990 can only be 25 December, so that is read as month first. Anything else gives ''.
export function normDob(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  let x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) return okDate(+x[1], +x[2], +x[3]);
  if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return okDate(+x[3], +x[2], +x[1]) || okDate(+x[3], +x[1], +x[2]);
  if ((x = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,-]+(\d{4})$/.exec(s))) return okDate(+x[3], monthIdx(x[2]), +x[1]);
  if ((x = /^([A-Za-z]{3,9})[ -]+(\d{1,2}),?[ -]+(\d{4})$/.exec(s))) return okDate(+x[3], monthIdx(x[1]), +x[2]);
  return '';
}
// Completed years on a date (both ISO dates). null when either is not a date or the age is not between 0 and 120.
export function ageOn(dob, on) {
  if (typeof dob !== 'string' || typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const a = (parseInt(on.slice(0, 4), 10) - parseInt(dob.slice(0, 4), 10)) - (on.slice(5) < dob.slice(5) ? 1 : 0);
  return a >= 0 && a <= 120 ? a : null;
}
// The date an age is worked out on: the race day, or 31 December of the race year.
export function ageDate(raceDate, rule) {
  if (typeof raceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return '';
  return rule === 'yearend' ? raceDate.slice(0, 4) + '-12-31' : raceDate;
}
// An age somebody wrote down: a whole number from 3 to 110. Anything else gives null.
export function declaredAge(v) {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 3 && n <= 110 ? n : null;
}
// The age of a runner: from the date of birth on the age date, else the age that was written down.
export function ageOf(info, raceDate, rule) {
  const on = ageDate(raceDate, rule);
  if (info && info.dob && on) {
    const a = ageOn(info.dob, on);
    if (a !== null) return a;
  }
  const d = info ? declaredAge(info.age === undefined ? '' : info.age) : null;
  return d;
}
// Age band boundaries: whole numbers from 5 to 99, each above the one before, at most 12. Anything else gives null.
export function cleanBands(v) {
  const list = typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean) : v;
  if (!Array.isArray(list) || list.length > 12) return null;
  const out = [];
  for (const x of list) {
    const n = typeof x === 'number' ? x : typeof x === 'string' && /^\d{1,2}$/.test(x.trim()) ? parseInt(x, 10) : NaN;
    if (!Number.isInteger(n) || n < 5 || n > 99 || (out.length && n <= out[out.length - 1])) return null;
    out.push(n);
  }
  return out;
}
// [18, 30, 40] gives "Under 18", "18-29", "30-39", "40+". No boundaries give one band, "All ages".
export function bandList(bounds) {
  const b = Array.isArray(bounds) ? bounds : [];
  if (!b.length) return ['All ages'];
  const out = ['Under ' + b[0]];
  for (let i = 0; i < b.length; i++) out.push(i === b.length - 1 ? b[i] + '+' : b[i] + '-' + (b[i + 1] - 1));
  return out;
}
export function bandOf(age, bounds) {
  const list = bandList(bounds);
  if (list.length === 1) return list[0];
  let i = 0;
  for (const x of bounds) if (age >= x) i++;
  return list[i];
}

/* ---------- settings ---------- */
const FIELD_NAME = (v) => cleanText(sOnly(v), 80);
// Settings as the director typed them, or an error. Only the known fields are read; nothing else is kept.
export function cleanSettings(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!r) throw new Error('bad_settings');
  const D = DEFAULT_SETTINGS;
  const rankBy = r.rankBy === undefined ? D.rankBy : r.rankBy;
  const ageRule = r.ageRule === undefined ? D.ageRule : r.ageRule;
  if (rankBy !== 'chip' && rankBy !== 'gun') throw new Error('bad_settings');
  if (ageRule !== 'raceday' && ageRule !== 'yearend') throw new Error('bad_settings');
  const bands = r.bands === undefined ? D.bands.slice() : cleanBands(r.bands);
  if (!bands) throw new Error('bad_settings');
  const depth = (v, d) => {
    if (v === undefined) return d;
    const n = typeof v === 'string' && /^\d{1,2}$/.test(v.trim()) ? parseInt(v, 10) : v;
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('bad_settings');
    return n;
  };
  const excl = r.overallExcl === undefined ? D.overallExcl : r.overallExcl;
  if (typeof excl !== 'boolean') throw new Error('bad_settings');
  const m = r.map === undefined ? D.map : r.map;
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('bad_settings');
  return { rankBy, ageRule, bands, overallDepth: depth(r.overallDepth, D.overallDepth), groupDepth: depth(r.groupDepth, D.groupDepth), overallExcl: excl, map: { gender: FIELD_NAME(m.gender), dob: FIELD_NAME(m.dob), age: FIELD_NAME(m.age), seed: FIELD_NAME(m.seed) } };
}
// Settings as stored (damaged or missing parts fall back to the defaults, so a bad row can never stop the screens).
export function settingsOf(stored) {
  const o = parseJson(stored, {});
  try {
    return cleanSettings(o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  } catch (e) {
    return cleanSettings({});
  }
}

/* ---------- what a registration tells us about a runner ---------- */
// The checkout form (a list of {name, value}) holds the answers; the director says which question is the gender, the date of
// birth, the age and the expected finish time.
export function formAnswers(form) {
  const list = parseJson(form, []);
  const out = new Map();
  (Array.isArray(list) ? list : []).slice(0, 60).forEach((i) => {
    if (i && typeof i === 'object' && typeof i.name === 'string' && !out.has(i.name)) out.set(i.name, typeof i.value === 'string' ? i.value : '');
  });
  return out;
}
export function regInfo(reg, map) {
  const a = formAnswers(reg && reg.form);
  const m = map || {};
  const pick = (k) => (m[k] ? a.get(m[k]) || '' : '');
  const seed = parseTime(pick('seed').trim());
  return {
    id: String((reg && reg._id) || ''),
    bib: bibKey(reg && reg.bib),
    name: cleanText(reg && reg.name, 80),
    cat: cleanText(reg && reg.cat, 60),
    gender: normGender(pick('gender')),
    dob: normDob(pick('dob')),
    age: declaredAge(pick('age').trim()),
    seedCs: seed || 0,
    paid: !!reg && reg.status === 'ok',
  };
}
// Every question the form asks, with how many answered and a few sample answers (so the director can pick the right one).
export function formFields(regs) {
  const f = new Map();
  (Array.isArray(regs) ? regs : []).slice(0, 3000).forEach((r) => {
    formAnswers(r.form).forEach((v, k) => {
      const x = f.get(k) || { name: cleanText(k, 80), count: 0, sample: [] };
      if (v) {
        x.count++;
        const t = cleanText(v, 40);
        if (x.sample.length < 3 && !x.sample.includes(t)) x.sample.push(t);
      }
      f.set(k, x);
    });
  });
  return Array.from(f.values()).slice(0, 60);
}

/* ---------- ranking ---------- */
// The time a runner is ranked on: the chip time or the gun time as chosen, else the other one. 0 when there is none.
export function timeOf(r, rankBy) {
  const first = rankBy === 'gun' ? P(r.gunCs) : P(r.chipCs);
  return first || (rankBy === 'gun' ? P(r.chipCs) : P(r.gunCs));
}
// Places for a list of {id, t}: the fastest is 1, the same time shares a place and the next place is skipped (1, 2, 2, 4).
export function placeAll(list) {
  const s = list.slice().sort((a, b) => a.t - b.t);
  const out = new Map();
  let prev = -1;
  let place = 0;
  s.forEach((x, i) => {
    if (x.t !== prev) {
      place = i + 1;
      prev = x.t;
    }
    out.set(x.id, place);
  });
  return out;
}
const byCatName = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
const ORDER = { fin: 0, dnf: 1, dsq: 2, dns: 3 };

// Joins stored result rows with the registrations and gives each its places.
// results: stored rows. regs: Map of bibKey to regInfo. ctx: { settings, raceDate, cats }.
export function board(results, regs, ctx) {
  const st = ctx.settings;
  const rows = [];
  const voided = [];
  for (const r of results) {
    const key = bibKey(r.bib);
    const reg = findByBib(regs, key);
    // a row whose status is damaged is shown as DNF (never ranked) until somebody corrects it
    const status = STATUSES.includes(r.status) ? r.status : 'dnf';
    const gender = normGender(sOnly(r.gender)) || (reg ? reg.gender : '');
    const own = ageOf({ dob: normDob(sOnly(r.dob)), age: r.age }, ctx.raceDate, st.ageRule);
    const age = own !== null ? own : reg ? ageOf(reg, ctx.raceDate, st.ageRule) : null;
    const t = status === 'fin' ? timeOf(r, st.rankBy) : 0;
    const cat = cleanText(r.cat, 60) || (reg ? reg.cat : '');
    const km = catKm(cat, ctx.cats);
    const flags = [];
    if (!reg) flags.push('unmatched');
    if (status === 'fin' && !gender) flags.push('nogender');
    if (status === 'fin' && age === null) flags.push('noage');
    if (status === 'fin') {
      const w = paceWarn(t, km);
      if (w) flags.push(w);
      if (!(st.rankBy === 'gun' ? P(r.gunCs) : P(r.chipCs))) flags.push(st.rankBy === 'gun' ? 'nogun' : 'nochip');
    }
    const row = {
      id: cleanText(r._id, 120),
      bib: key || cleanText(r.bib, 12),
      name: reg ? reg.name : cleanText(r.name, 80),
      cat,
      gender,
      age,
      ageGroup: age === null ? '' : bandOf(age, st.bands),
      status,
      gunCs: P(r.gunCs),
      chipCs: P(r.chipCs),
      t,
      place: null,
      gplace: null,
      aplace: null,
      flags,
      note: cleanText(r.note, 200),
      regId: reg ? reg.id : '',
    };
    if (r.void === 'yes') {
      voided.push(Object.assign(row, { voidReason: cleanText(r.voidReason, 200), voidBy: cleanText(r.voidBy, 60), voidAt: cleanText(r.voidAt, 40) }));
      continue;
    }
    rows.push(row);
  }
  // places, per category
  const byCat = new Map();
  rows.forEach((x) => {
    const k = catKey(x.cat) || 'other';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(x);
  });
  byCat.forEach((list) => {
    const fin = list.filter((x) => x.status === 'fin' && x.t > 0);
    const all = placeAll(fin.map((x) => ({ id: x.id, t: x.t })));
    fin.forEach((x) => {
      x.place = all.get(x.id);
    });
    const groups = new Map();
    fin.forEach((x) => {
      if (!x.gender) return;
      const g = x.gender;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(x);
    });
    groups.forEach((gl) => {
      const gp = placeAll(gl.map((x) => ({ id: x.id, t: x.t })));
      gl.forEach((x) => {
        x.gplace = gp.get(x.id);
      });
      const bands = new Map();
      gl.forEach((x) => {
        if (!x.ageGroup) return;
        if (!bands.has(x.ageGroup)) bands.set(x.ageGroup, []);
        bands.get(x.ageGroup).push(x);
      });
      bands.forEach((bl) => {
        const ap = placeAll(bl.map((x) => ({ id: x.id, t: x.t })));
        bl.forEach((x) => {
          x.aplace = ap.get(x.id);
        });
      });
    });
  });
  rows.sort((a, b) => byCatName(a.cat, b.cat) || (ORDER[a.status] - ORDER[b.status]) || ((a.place || 1e9) - (b.place || 1e9)) || bibCmp(a.bib, b.bib));
  const sum = { total: rows.length, fin: 0, dnf: 0, dns: 0, dsq: 0, unmatched: 0, noGender: 0, noAge: 0, fast: 0, slow: 0, voided: voided.length, cats: [] };
  const cs = new Map();
  rows.forEach((x) => {
    sum[x.status]++;
    if (x.flags.includes('unmatched')) sum.unmatched++;
    if (x.flags.includes('nogender')) sum.noGender++;
    if (x.flags.includes('noage')) sum.noAge++;
    if (x.flags.includes('fast')) sum.fast++;
    if (x.flags.includes('slow')) sum.slow++;
    const k = catKey(x.cat) || 'other';
    if (!cs.has(k)) cs.set(k, { cat: x.cat || '(no category)', fin: 0, dnf: 0, dns: 0, dsq: 0 });
    cs.get(k)[x.status]++;
  });
  sum.cats = Array.from(cs.values()).sort((a, b) => byCatName(a.cat, b.cat));
  return { rows, voided, summary: sum };
}

/* ---------- awards ---------- */
// rows: board rows. Overall awards per category and gender, then age-group awards per category, gender and band. A runner who
// takes an overall place is left out of the age-group list when settings.overallExcl is true. A tie at the last place takes
// everyone who is tied. Runners with no gender are listed as missing (no award can be given), and runners with no age are
// left out of the age-group lists and listed too.
export function computeAwards(boardRows, st) {
  const od = Math.min(10, Math.max(1, st.overallDepth || 3));
  const gd = Math.min(10, Math.max(1, st.groupDepth || 3));
  const excl = st.overallExcl !== false;
  const fin = boardRows.filter((x) => x.status === 'fin' && x.t > 0);
  const byCat = new Map();
  fin.forEach((x) => {
    const k = catKey(x.cat) || 'other';
    if (!byCat.has(k)) byCat.set(k, { cat: x.cat || '(no category)', list: [] });
    byCat.get(k).list.push(x);
  });
  const pick = (x, place) => ({ place, id: x.id, bib: x.bib, name: x.name, age: x.age, ageGroup: x.ageGroup, time: fmtTime(x.t), t: x.t });
  const cats = Array.from(byCat.values()).sort((a, b) => byCatName(a.cat, b.cat)).map((c) => {
    const missing = [];
    const groups = [];
    for (const g of ['M', 'F', 'X']) {
      const gl = c.list.filter((x) => x.gender === g);
      if (!gl.length) continue;
      const gp = placeAll(gl.map((x) => ({ id: x.id, t: x.t })));
      const sorted = gl.slice().sort((a, b) => a.t - b.t || bibCmp(a.bib, b.bib));
      const overall = sorted.filter((x) => gp.get(x.id) <= od).map((x) => pick(x, gp.get(x.id)));
      const taken = new Set(excl ? overall.map((x) => x.id) : []);
      const bandNames = bandList(st.bands);
      const ageGroups = [];
      for (const b of bandNames) {
        const bl = sorted.filter((x) => x.ageGroup === b && !taken.has(x.id));
        if (!bl.length) continue;
        const bp = placeAll(bl.map((x) => ({ id: x.id, t: x.t })));
        ageGroups.push({ band: b, finishers: sorted.filter((x) => x.ageGroup === b).length, list: bl.filter((x) => bp.get(x.id) <= gd).map((x) => pick(x, bp.get(x.id))) });
      }
      groups.push({ gender: g, label: genderLabel(g), finishers: gl.length, overall, ageGroups });
    }
    c.list.forEach((x) => {
      if (!x.gender) missing.push({ id: x.id, bib: x.bib, name: x.name, why: 'gender' });
      else if (!x.ageGroup) missing.push({ id: x.id, bib: x.bib, name: x.name, why: 'age' });
    });
    missing.sort((a, b) => bibCmp(a.bib, b.bib));
    return { cat: c.cat, finishers: c.list.length, groups, missing };
  });
  return { cats, overallDepth: od, groupDepth: gd, overallExcl: excl };
}

/* ---------- waves and corrals ---------- */
const TIME_HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validHM = (v) => typeof v === 'string' && TIME_HM.test(v);
const WAVE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,29}$/;
const CORRAL_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,11}$/;
const WID = /^w\d{1,4}$/;
export const MAX_WAVES = 40;
export const MAX_CORRALS = 8;
export const MAX_CAP = 5000;
// The waves as typed: a list of {id?, cat, name, start, corrals (list or "A, B"), cap}. cats (optional) is the list of
// categories that exist; when it is not empty a wave must belong to one of them. next is the number the next new id takes.
// Returns { waves, next } sorted by start time then name, or throws 'bad_waves'.
export function cleanWaves(list, ctx) {
  const c = ctx || {};
  if (!Array.isArray(list) || list.length > MAX_WAVES) throw new Error('bad_waves');
  const known = Array.isArray(c.cats) ? c.cats.filter(Boolean) : [];
  const have = new Set(Array.isArray(c.ids) ? c.ids : []);
  let next = Number.isInteger(c.next) && c.next >= 1 ? c.next : 1;
  const seen = new Set();
  const names = new Set();
  const out = list.map((w) => {
    if (!w || typeof w !== 'object' || Array.isArray(w)) throw new Error('bad_waves');
    let cat = cleanText(sOnly(w.cat), 60);
    if (!cat) throw new Error('bad_waves');
    if (known.length) {
      const k = known.find((x) => catKey(x) === catKey(cat));
      if (!k) throw new Error('bad_waves');
      cat = k;
    }
    const name = cleanText(sOnly(w.name), 30);
    if (!WAVE_NAME.test(name)) throw new Error('bad_waves');
    const nk = catKey(cat) + '|' + lc(name);
    if (names.has(nk)) throw new Error('bad_waves');
    names.add(nk);
    const start = sOnly(w.start).trim();
    if (!validHM(start)) throw new Error('bad_waves');
    const rc = Array.isArray(w.corrals) ? w.corrals : typeof w.corrals === 'string' ? w.corrals.split(/[,;]+/) : w.corrals === undefined ? [] : null;
    if (!rc || rc.length > MAX_CORRALS + 4) throw new Error('bad_waves');
    const corrals = [];
    for (const x of rc) {
      if (typeof x !== 'string' && typeof x !== 'number') throw new Error('bad_waves');
      const t = cleanText(String(x), 12);
      if (!t) continue;
      if (!CORRAL_NAME.test(t) || corrals.some((y) => lc(y) === lc(t))) throw new Error('bad_waves');
      corrals.push(t);
    }
    if (corrals.length > MAX_CORRALS) throw new Error('bad_waves');
    const cap = w.cap === undefined || w.cap === '' || w.cap === null ? 0 : typeof w.cap === 'string' && /^\d{1,4}$/.test(w.cap.trim()) ? parseInt(w.cap, 10) : w.cap;
    if (!Number.isInteger(cap) || cap < 0 || cap > MAX_CAP) throw new Error('bad_waves');
    let id = typeof w.id === 'string' ? w.id : '';
    if (id && (!WID.test(id) || !have.has(id) || seen.has(id))) throw new Error('bad_waves');
    if (!id) {
      while (have.has('w' + next) || seen.has('w' + next)) next++;
      id = 'w' + next;
      next++;
    }
    seen.add(id);
    return { id, cat, name, start, corrals, cap };
  });
  out.sort((a, b) => byCatName(a.cat, b.cat) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return { waves: out, next };
}
export function wavesOf(stored) {
  const o = parseJson(stored, {});
  const list = o && Array.isArray(o.waves) ? o.waves : [];
  try {
    return { waves: cleanWaves(list, { ids: list.map((w) => (w && typeof w.id === 'string' ? w.id : '')), next: P(o && o.next) || 1 }).waves, next: P(o && o.next) || 1, rev: P(o && o.rev) };
  } catch (e) {
    return { waves: [], next: 1, rev: P(o && o.rev) };
  }
}

// Fills the waves of one category with its runners.
//   runners: [{ id, bib, seedCs, wave, corral, how }]   (how: 'auto' or 'manual'; '' when not placed)
//   waves: this category's waves [{ id, corrals, cap }] in the order they fill (start time order)
//   mode: 'seed' (fastest expected time first, no time last) or 'bib' (bib order); redo: place the automatic ones again
// Manual placements never move and use up room. Returns { placed: { id: { wave, corral } }, unplaced: [id] }.
export function autoAssign(runners, waves, opts) {
  const o = opts || {};
  const ws = waves.slice();
  const wid = new Set(ws.map((w) => w.id));
  const kept = runners.filter((r) => r.wave && wid.has(r.wave) && (r.how === 'manual' || !o.redo));
  const keptIds = new Set(kept.map((r) => r.id));
  const todo = runners.filter((r) => !keptIds.has(r.id));
  todo.sort((a, b) => {
    if (o.mode !== 'bib') {
      const sa = a.seedCs > 0 ? a.seedCs : Infinity;
      const sb = b.seedCs > 0 ? b.seedCs : Infinity;
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
    return bibCmp(a.bib || '~', b.bib || '~') || String(a.id).localeCompare(String(b.id));
  });
  const room = new Map(ws.map((w) => [w.id, w.cap > 0 ? w.cap : Infinity]));
  kept.forEach((r) => room.set(r.wave, room.get(r.wave) - 1));
  const into = new Map(ws.map((w) => [w.id, []]));
  const unplaced = [];
  todo.forEach((r) => {
    const w = ws.find((x) => room.get(x.id) > 0);
    if (!w) {
      unplaced.push(r.id);
      return;
    }
    room.set(w.id, room.get(w.id) - 1);
    into.get(w.id).push(r.id);
  });
  const placed = {};
  ws.forEach((w) => {
    const ids = into.get(w.id);
    const cs = w.corrals && w.corrals.length ? w.corrals : [''];
    const per = Math.max(1, Math.ceil(ids.length / cs.length));
    ids.forEach((id, i) => {
      placed[id] = { wave: w.id, corral: cs[Math.min(cs.length - 1, Math.floor(i / per))] };
    });
  });
  return { placed, unplaced };
}
// Where each runner stands: the start list. runners: [{ id, bib, name, cat, wave, corral }]. Returns one section per wave in
// start order, with a list per corral, each in bib order; runners with no wave come last.
export function startList(runners, waves) {
  const order = waves.slice().sort((a, b) => a.start.localeCompare(b.start) || byCatName(a.cat, b.cat) || a.name.localeCompare(b.name));
  const sections = order.map((w) => {
    const mine = runners.filter((r) => r.wave === w.id);
    const corrals = (w.corrals.length ? w.corrals : ['']).map((c) => ({ corral: c, runners: mine.filter((r) => (r.corral || '') === c).sort((a, b) => bibCmp(a.bib || '~', b.bib || '~')) }));
    const known = new Set(corrals.map((c) => c.corral));
    const stray = mine.filter((r) => !known.has(r.corral || ''));
    if (stray.length) corrals.push({ corral: '(no corral)', runners: stray.sort((a, b) => bibCmp(a.bib || '~', b.bib || '~')) });
    return { id: w.id, cat: w.cat, name: w.name, start: w.start, cap: w.cap, count: mine.length, corrals };
  });
  const ids = new Set(waves.map((w) => w.id));
  const none = runners.filter((r) => !r.wave || !ids.has(r.wave)).sort((a, b) => bibCmp(a.bib || '~', b.bib || '~'));
  return { sections, unassigned: none };
}

/* ---------- reading a results file ---------- */
function pickDelim(s) {
  let line = '';
  let q = false;
  for (let i = 0; i < s.length && i < 4000; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    if (!q && (c === '\n' || c === '\r')) {
      if (line.trim()) break;
      line = '';
      continue;
    }
    line += q ? '' : c;
  }
  const n = (ch) => line.split(ch).length - 1;
  const t = n('\t');
  const c = n(',');
  const sc = n(';');
  return t > c && t >= sc ? '\t' : sc > c ? ';' : ',';
}
// Text with quotes, commas or tabs between the columns, as a list of rows (with the line each row began on).
export function parseCsv(text) {
  let s = typeof text === 'string' ? text : '';
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const d = pickDelim(s);
  const rows = [];
  const lines = [];
  let row = [];
  let cell = '';
  let q = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && cell === '') q = true;
    else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      lines.push(start);
      row = [];
      line++;
      start = line;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
    lines.push(start);
  }
  return { rows, lines, open: q };
}
const HEADERS = {
  bib: ['bib', 'bibno', 'bibnumber', 'racebib', 'racenumber', 'racebibnumber'],
  name: ['name', 'runner', 'runnername', 'participant', 'fullname'],
  time: ['time', 'finishtime', 'official', 'officialtime', 'result', 'finish'],
  chip: ['chip', 'chiptime', 'net', 'nettime'],
  gun: ['gun', 'guntime', 'gross', 'grosstime', 'clock', 'clocktime'],
  status: ['status', 'state', 'resultstatus'],
  cat: ['cat', 'category', 'race', 'distance', 'event'],
  gender: ['gender', 'sex'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'birthday'],
  age: ['age'],
};
const hkey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const STATUS_WORDS = { fin: ['fin', 'finished', 'finisher', 'ok', 'official'], dnf: ['dnf', 'did not finish', 'retired', 'ret', 'rtd', 'withdrawn'], dns: ['dns', 'did not start', 'absent', 'no show', 'noshow'], dsq: ['dsq', 'dq', 'disqualified'] };
// "DNF", "retired", "finished" become dnf, dnf, fin. Blank gives '' (the time decides). null for anything else.
export function normStatus(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/\./g, '');
  if (!s) return '';
  for (const k of Object.keys(STATUS_WORDS)) if (STATUS_WORDS[k].includes(s)) return k;
  return null;
}
// A category as typed in a file, matched to the real one when it plainly is that one ("25K" is "25 K - Debut Trail").
export function canonCat(typed, known) {
  const t = cleanText(typed, 60);
  if (!t) return '';
  const list = Array.isArray(known) ? known.filter(Boolean) : [];
  const exact = list.find((k) => catKey(k) === catKey(t));
  if (exact) return exact;
  const pre = list.filter((k) => catKey(t).length >= 2 && (catKey(k).startsWith(catKey(t)) || catKey(t).startsWith(catKey(k))));
  return pre.length === 1 ? pre[0] : t;
}
// Reads a results file. The first line must name the columns (bib, and time or chip or gun or status; name, category, gender,
// dob and age are optional). regs: Map of bibKey to regInfo, known: the categories that exist, rankBy: 'chip' or 'gun'.
// Returns { items, errors: [{ line, text }], ignored, columns } and never throws on bad content.
export function readResults(text, ctx) {
  const out = { items: [], errors: [], ignored: [], columns: [] };
  const err = (line, t) => out.errors.push({ line, text: t });
  const s = typeof text === 'string' ? text : '';
  if (s.length > MAX_CSV_CHARS) {
    err(0, 'The file is too big. Paste at most ' + Math.round(MAX_CSV_CHARS / 1000) + ' thousand characters at a time.');
    return out;
  }
  const { rows, lines, open } = parseCsv(s);
  if (open) {
    err(0, 'A quotation mark is not closed. Check the file.');
    return out;
  }
  const filled = rows.map((r, i) => ({ r, line: lines[i] })).filter((x) => x.r.some((c) => String(c).trim() !== ''));
  if (!filled.length) {
    err(0, 'Nothing to read. Paste the results with the column names on the first line, for example: bib,time');
    return out;
  }
  if (filled.length - 1 > MAX_ROWS) {
    err(0, 'Too many lines (more than ' + MAX_ROWS + '). Send the file in parts.');
    return out;
  }
  const head = filled[0].r.map(hkey);
  if (head.length > MAX_COLS) {
    err(filled[0].line, 'Too many columns (more than ' + MAX_COLS + ').');
    return out;
  }
  const col = {};
  head.forEach((h, i) => {
    let used = false;
    for (const k of Object.keys(HEADERS)) {
      if (HEADERS[k].includes(h) && col[k] === undefined) {
        col[k] = i;
        used = true;
        break;
      }
    }
    if (!used && h) out.ignored.push(cleanText(filled[0].r[i], 40));
  });
  out.columns = Object.keys(col);
  if (col.bib === undefined) {
    err(filled[0].line, 'The first line must name the columns, and one of them must be "bib". For example: bib,time');
    return out;
  }
  if (col.time === undefined && col.chip === undefined && col.gun === undefined && col.status === undefined) {
    err(filled[0].line, 'There is no time column. Name one "time", "chip" or "gun" (or "status" for DNF and DNS).');
    return out;
  }
  const seen = new Map();
  const cell = (r, k) => (col[k] === undefined ? '' : String(r[col[k]] === undefined ? '' : r[col[k]]).trim());
  filled.slice(1).forEach(({ r, line }) => {
    const rawBib = cell(r, 'bib');
    const bib = bibKey(rawBib);
    if (!bib) {
      err(line, rawBib ? 'Bib "' + cleanText(rawBib, 20) + '" is not a bib number (letters, digits and dashes, up to 12).' : 'There is no bib number on this line.');
      return;
    }
    const reg = findByBib(ctx.regs, bib);
    const key = reg && reg.bib ? reg.bib : bib;
    if (seen.has(key)) {
      err(line, 'Bib ' + key + ' is on line ' + seen.get(key) + ' already. Only the first is used.');
      return;
    }
    const status0 = normStatus(cell(r, 'status'));
    if (status0 === null) {
      err(line, 'Bib ' + bib + ': status "' + cleanText(cell(r, 'status'), 20) + '" is not one of finished, DNF, DNS, DSQ.');
      return;
    }
    const times = {};
    for (const k of ['time', 'chip', 'gun']) {
      const v = cell(r, k);
      if (!v) continue;
      const p = parseTime(v);
      if (p === null) {
        if (status0 && status0 !== 'fin') continue;
        err(line, 'Bib ' + bib + ': "' + cleanText(v, 20) + '" is not a time. Use h:mm:ss (for example 2:45:30) or mm:ss.');
        return;
      }
      times[k] = p;
    }
    if (times.time !== undefined) {
      const slot = ctx.rankBy === 'gun' ? 'gun' : 'chip';
      if (times[slot] === undefined) times[slot] = times.time;
    }
    let status = status0;
    if (!status) status = times.chip !== undefined || times.gun !== undefined ? 'fin' : '';
    if (!status) {
      err(line, 'Bib ' + bib + ': give a time or a status (DNF, DNS, DSQ).');
      return;
    }
    if (status === 'fin' && times.chip === undefined && times.gun === undefined) {
      err(line, 'Bib ' + bib + ': a finisher needs a time.');
      return;
    }
    const name = cleanText(cell(r, 'name'), 80);
    const catTyped = cell(r, 'cat');
    const cat = canonCat(catTyped, ctx.known) || (reg ? reg.cat : '');
    if (!reg && (!name || !cat)) {
      err(line, 'Bib ' + bib + ' is not a registered bib. Add the name and category columns for this line, or correct the bib.');
      return;
    }
    const genderTyped = cell(r, 'gender');
    const dobTyped = cell(r, 'dob');
    const ageTyped = cell(r, 'age');
    if (genderTyped && !normGender(genderTyped)) {
      err(line, 'Bib ' + bib + ': gender "' + cleanText(genderTyped, 20) + '" is not M, F or other.');
      return;
    }
    if (dobTyped && !normDob(dobTyped)) {
      err(line, 'Bib ' + bib + ': the date of birth is not a date (use 25/12/1990 or 1990-12-25).');
      return;
    }
    if (ageTyped && declaredAge(ageTyped) === null) {
      err(line, 'Bib ' + bib + ': age "' + cleanText(ageTyped, 10) + '" is not a number from 3 to 110.');
      return;
    }
    seen.set(key, line);
    out.items.push({
      line,
      bib: key,
      name: reg ? reg.name : name,
      cat,
      gender: normGender(genderTyped),
      dob: normDob(dobTyped),
      age: ageTyped ? String(declaredAge(ageTyped)) : '',
      gunCs: status === 'fin' && times.gun !== undefined ? times.gun : 0,
      chipCs: status === 'fin' && times.chip !== undefined ? times.chip : 0,
      status,
      regId: reg ? reg.id : '',
      matched: !!reg,
    });
  });
  return out;
}
