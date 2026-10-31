// backend/rd-print.js
// Bibs, certificates, and what the public runner page may show. No database and no Wix in here, so every rule can be tested on its own.
//
// Everything a person typed (template text) or a runner typed (a name on a registration) goes into a page through esc(), so no markup
// can be made by it. A colour is #rrggbb and nothing else, a size is a clamped whole number, and an image is an https address on a
// short list of hosts. A date of birth, a phone number and an e-mail address never come through here: the printed papers and the
// runner page carry the name, bib, category, wave and result, and nothing else.
import { T, cleanText, sOnly, P, catKey, bibKey, bibCmp, findByBib, fmtTime, genderLabel, catKm } from './rd-results.js';

/* ---------- small helpers ---------- */
// Text into a page: the five characters that make markup, and the back-tick, become entities.
export const esc = (v) =>
  T(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
// A colour is six hex digits after a #, else the fallback.
export const safeColor = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : d);
// Black or white, whichever reads on that colour.
export function ink(hex) {
  const c = safeColor(hex, '#000000');
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}
// An image may only be an https address on one of these hosts (the Wix media server and the club's own site). Anything else, a user name
// in the address, a port, a quote, a space, a bracket of markup, gives ''.
export const IMG_HOSTS = ['static.wixstatic.com', 'vtra.run', 'www.vtra.run'];
const IMG_RE = /^https:\/\/([a-z0-9.-]+)(\/[A-Za-z0-9._~\-/%+=@:,;!*()&?#]*)?$/i;
export function safeImg(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > 300) return '';
  const m = IMG_RE.exec(s);
  return m && IMG_HOSTS.includes(m[1].toLowerCase()) ? s : '';
}
// Text that is plainly an address (so it must pass safeImg, or be refused) and not a word.
const URLISH = /^(?:(?:https?|ftp|data|javascript|vbscript|file|blob):|\/\/)/i;
// Several lines of text typed by a person: lines kept, control and direction-changing characters dropped, at most n characters and
// 6 lines.
export function cleanLines(v, n) {
  const s = T(v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
  const lines = s.split('\n').map((x) => x.replace(/[ \t]+/g, ' ').trim());
  const out = [];
  lines.forEach((l) => {
    if (l || (out.length && out[out.length - 1])) out.push(l);
  });
  while (out.length && !out[out.length - 1]) out.pop();
  return out.slice(0, 6).join('\n').slice(0, n || 400);
}
// {name} style placeholders. A name that is not known stays as it was typed (so a typo shows in the preview). One pass: a value that
// itself holds {something} is not filled again.
export function fill(text, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  return T(text).replace(/\{([A-Za-z][A-Za-z0-9_]{0,19})\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(v, k.toLowerCase()) ? T(v[k.toLowerCase()]) : all));
}
// Template text with its placeholders, safe for a page, line breaks kept.
export const html = (text, vars) => esc(fill(text, vars)).replace(/\n/g, '<br>');
export function ordinal(n) {
  const x = typeof n === 'number' ? n : NaN;
  if (!Number.isInteger(x) || x < 1) return '';
  const m = x % 100;
  const suffix = m >= 11 && m <= 13 ? 'th' : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][x % 10];
  return x + suffix;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// 2027-02-07 becomes "7 February 2027"; anything else gives ''.
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(T(iso));
  if (!m) return '';
  const mo = +m[2];
  const d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? d + ' ' + MONTHS[mo - 1] + ' ' + m[1] : '';
}
// The time of the race and its length as pace per kilometre ("5:12 /km"); '' when either is not known.
export function paceText(cs, km) {
  if (!(cs > 0) || !(km > 0)) return '';
  const secs = Math.floor(cs / 100 / km);
  return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') + ' /km';
}
// One page of a list: from the offset, size items. next is the offset of the page after, or null.
export function pageOf(list, from, size) {
  const f = Number.isInteger(from) && from >= 0 ? from : 0;
  const items = list.slice(f, f + size);
  return { items, next: f + size < list.length ? f + size : null, total: list.length };
}
export const PLACEHOLDERS = { bib: ['race', 'date', 'venue', 'cat', 'bib', 'name', 'bibname'], cert: ['name', 'bib', 'cat', 'race', 'date', 'venue', 'time', 'place', 'gender', 'gplace', 'agegroup', 'aplace', 'pace'] };

/* ---------- the design of a bib ---------- */
export const BIB_DEFAULT = { wmm: 190, hmm: 140, page: 'A4', orient: 'portrait', accent: '#1b5e9b', title: '{race}', subtitle: '{date} · {venue}', nameMode: 'either', showCat: true, catColors: {}, sponsors: [], tearoff: false, holes: true, footer: '' };
export const CERT_DEFAULT = {
  orient: 'landscape',
  border: 'double',
  accent: '#1b5e9b',
  bg: '#ffffff',
  logo: '',
  title: 'Certificate of Achievement',
  intro: 'This is to certify that',
  body: 'has successfully completed the {cat} at {race} on {date}, finishing {place} overall in a time of {time}.',
  stats: true,
  sign1Name: '',
  sign1Role: '',
  sign2Name: '',
  sign2Role: '',
  sponsors: [],
  footer: '',
};
const PALETTE = ['#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#2471a3', '#6c3483', '#2c3e50'];
const bad = () => new Error('bad_template');
const num = (v, lo, hi, d) => {
  if (v === undefined) return d;
  const n = typeof v === 'string' && /^\d{1,4}$/.test(v.trim()) ? parseInt(v, 10) : v;
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad();
  return n;
};
const bool = (v, d) => {
  if (v === undefined) return d;
  if (typeof v !== 'boolean') throw bad();
  return v;
};
const oneOf = (v, list, d) => {
  if (v === undefined) return d;
  if (typeof v !== 'string' || !list.includes(v)) throw bad();
  return v;
};
const txt = (v, n, d) => {
  if (v === undefined) return d;
  if (typeof v !== 'string') throw bad();
  return cleanText(v, n);
};
const col = (v, d) => {
  if (v === undefined) return d;
  const c = safeColor(v, '');
  if (!c) throw bad();
  return c;
};
// A logo address typed in a box: empty, or a safe image. A wrong one is refused (so the director learns it), never ignored.
const logo = (v, d) => {
  if (v === undefined) return d;
  if (typeof v !== 'string') throw bad();
  const s = v.trim();
  if (!s) return '';
  const g = safeImg(s);
  if (!g) throw new Error('bad_image');
  return g;
};
// Up to 6 sponsors, one per line: a name (up to 40 letters) or an image address. Something that looks like an address but is not a safe
// image is refused, so it is never printed as text by mistake.
function cleanSponsors(v) {
  if (v === undefined) return [];
  const list = typeof v === 'string' ? v.split(/\n+/) : v;
  if (!Array.isArray(list) || list.length > 12) throw bad();
  const out = [];
  for (const x of list) {
    if (typeof x !== 'string') throw bad();
    const t = cleanText(x, 300);
    if (!t) continue;
    if (URLISH.test(t)) {
      const g = safeImg(t);
      if (!g) throw new Error('bad_image');
      out.push(g);
    } else out.push(cleanText(t, 40));
  }
  if (out.length > 6) throw bad();
  return out;
}
// The bib design as typed, or an error ('bad_template', 'bad_image'). Only known fields are read; nothing else is kept.
// cats: the categories of the race; a colour is kept only for one of them.
export function cleanBibTpl(raw, cats) {
  const r = raw === undefined || raw === null ? {} : raw;
  if (typeof r !== 'object' || Array.isArray(r)) throw bad();
  const D = BIB_DEFAULT;
  const known = Array.isArray(cats) ? cats.filter(Boolean) : [];
  const cc = r.catColors === undefined ? {} : r.catColors;
  if (!cc || typeof cc !== 'object' || Array.isArray(cc)) throw bad();
  const catColors = {};
  const keys = Object.keys(cc);
  if (keys.length > 30) throw bad();
  keys.forEach((k) => {
    const c = safeColor(cc[k], '');
    if (!c) throw bad();
    const name = known.length ? known.find((x) => catKey(x) === catKey(k)) : cleanText(k, 60);
    if (name) catColors[name] = c;
  });
  return {
    wmm: num(r.wmm, 80, 300, D.wmm),
    hmm: num(r.hmm, 60, 210, D.hmm),
    page: oneOf(r.page, ['A4', 'A3'], D.page),
    orient: oneOf(r.orient, ['portrait', 'landscape'], D.orient),
    accent: col(r.accent, D.accent),
    title: txt(r.title, 80, D.title),
    subtitle: txt(r.subtitle, 80, D.subtitle),
    nameMode: oneOf(r.nameMode, ['none', 'name', 'bibname', 'either'], D.nameMode),
    showCat: bool(r.showCat, D.showCat),
    catColors,
    sponsors: cleanSponsors(r.sponsors),
    tearoff: bool(r.tearoff, D.tearoff),
    holes: bool(r.holes, D.holes),
    footer: txt(r.footer, 80, D.footer),
  };
}
export function cleanCertTpl(raw) {
  const r = raw === undefined || raw === null ? {} : raw;
  if (typeof r !== 'object' || Array.isArray(r)) throw bad();
  const D = CERT_DEFAULT;
  const lines = (v, n, d) => {
    if (v === undefined) return d;
    if (typeof v !== 'string') throw bad();
    return cleanLines(v, n);
  };
  return {
    orient: oneOf(r.orient, ['landscape', 'portrait'], D.orient),
    border: oneOf(r.border, ['none', 'simple', 'double'], D.border),
    accent: col(r.accent, D.accent),
    bg: col(r.bg, D.bg),
    logo: logo(r.logo, D.logo),
    title: txt(r.title, 60, D.title),
    intro: txt(r.intro, 100, D.intro),
    body: lines(r.body, 400, D.body),
    stats: bool(r.stats, D.stats),
    sign1Name: txt(r.sign1Name, 40, D.sign1Name),
    sign1Role: txt(r.sign1Role, 40, D.sign1Role),
    sign2Name: txt(r.sign2Name, 40, D.sign2Name),
    sign2Role: txt(r.sign2Role, 40, D.sign2Role),
    sponsors: cleanSponsors(r.sponsors),
    footer: txt(r.footer, 120, D.footer),
  };
}
// A saved design (damaged or missing parts fall back to the default, so a bad row can never stop a screen or a print-out).
export function bibTplOf(stored, cats, parse) {
  const o = typeof parse === 'function' ? parse(stored) : stored;
  try {
    return cleanBibTpl(o, cats);
  } catch (e) {
    return cleanBibTpl({}, cats);
  }
}
export function certTplOf(stored, parse) {
  const o = typeof parse === 'function' ? parse(stored) : stored;
  try {
    return cleanCertTpl(o);
  } catch (e) {
    return cleanCertTpl({});
  }
}
// The colour of a category on the bib: the one chosen, else one from the palette by the category's place in the race's list.
export function catColor(tpl, cat, cats) {
  const k = catKey(cat);
  const own = Object.keys(tpl.catColors || {}).find((x) => catKey(x) === k);
  if (own) return tpl.catColors[own];
  const i = (Array.isArray(cats) ? cats : []).findIndex((c) => catKey(c) === k);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

/* ---------- the page around the papers ---------- */
const BASE_CSS = '*{box-sizing:border-box}html,body{margin:0;padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}';
export function docHead(title, css) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + BASE_CSS + css + '</style></head><body>';
}
export const DOC_FOOT = '</body></html>';
const mm = (n) => Math.round(n * 100) / 100 + 'mm';
const img = (src, h) => '<img src="' + esc(src) + '" alt="" style="height:' + mm(h) + ';max-width:60mm;object-fit:contain">';
// The sponsors as a row: an image where the entry is a safe address, else the name.
const sponsorRow = (list, h) => list.map((s) => (safeImg(s) ? img(safeImg(s), h) : '<span>' + esc(s) + '</span>')).join('');

/* ---------- bibs ---------- */
function bibCss(t) {
  const W = t.wmm;
  const H = t.hmm;
  const band = H * 0.15;
  const foot = H * 0.17;
  const tear = t.tearoff ? H * 0.16 : 0;
  const side = t.holes ? 12 : 6;
  const size = t.page === 'A3' ? (t.orient === 'landscape' ? '420mm 297mm' : '297mm 420mm') : t.orient === 'landscape' ? '297mm 210mm' : '210mm 297mm';
  return (
    '@page{size:' + size + ';margin:8mm}@media screen{body{padding:8mm}}' +
    '.sheet{display:flex;flex-wrap:wrap;gap:4mm;align-content:flex-start}' +
    '.bib{position:relative;display:flex;flex-direction:column;width:' + mm(W) + ';height:' + mm(H) + ';border:0.4mm solid #222;overflow:hidden;break-inside:avoid;page-break-inside:avoid;background:#fff}' +
    '.bib .hd{flex:none;height:' + mm(band) + ';padding:0 ' + mm(side) + ';display:flex;align-items:center;justify-content:space-between;gap:4mm;background:' + t.accent + ';color:' + ink(t.accent) + ';font-weight:700;white-space:nowrap;overflow:hidden}' +
    '.bib .hd .t{font-size:' + mm(band * 0.4) + '}.bib .hd .s{font-size:' + mm(band * 0.28) + ';font-weight:400}' +
    '.bib .mid{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;text-align:center}' +
    '.bib .n{font-family:"Arial Black",Arial,Helvetica,sans-serif;font-weight:900;line-height:1;letter-spacing:-0.02em}' +
    '.bib .nm{margin-top:' + mm(H * 0.01) + ';font-size:' + mm(H * 0.07) + ';font-weight:700;text-transform:uppercase;max-width:90%;white-space:nowrap;overflow:hidden}' +
    '.bib .ft{flex:none;height:' + mm(foot) + ';padding:0 ' + mm(side) + ';display:flex;align-items:center;gap:4mm;border-top:0.3mm solid #bbb}' +
    '.bib .cat{flex:none;padding:0 ' + mm(foot * 0.25) + ';height:' + mm(foot * 0.62) + ';line-height:' + mm(foot * 0.62) + ';font-size:' + mm(foot * 0.34) + ';font-weight:700;border-radius:1mm;white-space:nowrap}' +
    '.bib .sp{flex:1;display:flex;align-items:center;justify-content:center;gap:4mm;overflow:hidden;font-size:' + mm(foot * 0.3) + ';font-weight:700;color:#444;white-space:nowrap}' +
    '.bib .fx{flex:none;font-size:' + mm(foot * 0.26) + ';color:#555;white-space:nowrap}' +
    '.bib .tr{flex:none;height:' + mm(tear) + ';padding:0 ' + mm(side) + ';display:flex;align-items:center;justify-content:space-between;border-top:0.4mm dashed #666;font-size:' + mm(tear * 0.3) + ';white-space:nowrap;overflow:hidden}' +
    '.bib .tr b{font-size:' + mm(tear * 0.62) + ';font-family:"Arial Black",Arial,Helvetica,sans-serif}' +
    '.bib .h{position:absolute;width:5mm;height:5mm;border:0.35mm solid #666;border-radius:50%;background:#fff}.bib .h1{left:4mm;top:4mm}.bib .h2{right:4mm;top:4mm}.bib .h3{left:4mm;bottom:' + mm(4 + tear) + '}.bib .h4{right:4mm;bottom:' + mm(4 + tear) + '}'
  );
}
export function bibVars(item, race) {
  if (!item || typeof item !== 'object') item = {};
  return { race: T(race && race.name), date: longDate(race && race.date), venue: T(race && race.venue), cat: T(item.cat), bib: T(item.bib), name: T(item.name), bibname: T(item.bibName) };
}
const nameOn = (mode, item) => (mode === 'none' ? '' : mode === 'name' ? T(item.name) : mode === 'bibname' ? T(item.bibName) : T(item.bibName) || T(item.name));
// One bib. item: { bib, name, bibName, cat }. A spare has no name and no category.
export function renderBib(t, item0, race, cats) {
  const item = item0 && typeof item0 === 'object' ? item0 : {};
  const v = bibVars(item, race);
  const W = t.wmm;
  const H = t.hmm;
  const band = H * 0.15;
  const foot = H * 0.17;
  const tear = t.tearoff ? H * 0.16 : 0;
  const text = T(item.bib);
  const avail = H - band - foot - tear;
  const size = Math.max(8, Math.min(avail * 0.72, (W - 12) / (Math.max(1, text.length) * 0.64)));
  const nm = nameOn(t.nameMode, item);
  const cat = T(item.cat);
  const color = catColor(t, cat, cats);
  return (
    '<div class="bib"><div class="hd"><span class="t">' + html(t.title, v) + '</span><span class="s">' + html(t.subtitle, v) + '</span></div>' +
    '<div class="mid"><div class="n" style="font-size:' + mm(size) + '">' + esc(text) + '</div>' + (nm ? '<div class="nm">' + esc(nm) + '</div>' : '') + '</div>' +
    '<div class="ft">' + (t.showCat && cat ? '<span class="cat" style="background:' + color + ';color:' + ink(color) + '">' + esc(cat) + '</span>' : '') +
    '<span class="sp">' + sponsorRow(t.sponsors, foot * 0.62) + '</span>' + (t.footer ? '<span class="fx">' + html(t.footer, v) + '</span>' : '') + '</div>' +
    (t.tearoff ? '<div class="tr"><b>' + esc(text) + '</b><span>' + esc(nm || cat) + (nm && cat ? ' · ' + esc(cat) : '') + '</span></div>' : '') +
    (t.holes ? '<i class="h h1"></i><i class="h h2"></i><i class="h h3"></i><i class="h h4"></i>' : '') +
    '</div>'
  );
}
// A set of bibs. Returns { head, body }: the start of the page (with its style), and the bibs. A print-out is head + the bodies + DOC_FOOT.
export function renderBibs(t, items, race, cats) {
  return { head: docHead('Bibs ' + T(race && race.name), bibCss(t)), body: '<div class="sheet">' + (Array.isArray(items) ? items : []).map((i) => renderBib(t, i, race, cats)).join('') + '</div>' };
}
// Spare bibs from..to (numbers only, up to 500, none that a runner already has). Returns { items, skipped }.
export function spareBibs(from, to, taken) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > 99999999 || to - from >= 500) throw new Error('bad_spares');
  const items = [];
  let skipped = 0;
  for (let n = from; n <= to; n++) {
    const b = String(n);
    if (taken && taken.has(b)) skipped++;
    else items.push({ bib: b, name: '', bibName: '', cat: '' });
  }
  return { items, skipped };
}

/* ---------- certificates ---------- */
function certCss(t) {
  const L = t.orient === 'landscape';
  const w = L ? 297 : 210;
  const h = L ? 210 : 297;
  const pad = L ? 'padding:20mm 26mm' : 'padding:24mm 20mm';
  return (
    '@page{size:' + w + 'mm ' + h + 'mm;margin:0}@media screen{body{background:#ddd;padding:6mm}.cert{margin:0 auto 6mm}}' +
    '.cert{position:relative;width:' + w + 'mm;height:' + h + 'mm;' + pad + ';text-align:center;font-family:Georgia,"Times New Roman",serif;color:#222;background:' + t.bg + ';overflow:hidden;break-inside:avoid}' +
    '.cert + .cert{break-before:page;page-break-before:always}' +
    '.cert .fr{position:absolute;left:8mm;top:8mm;right:8mm;bottom:8mm;border:1.4mm solid ' + t.accent + '}.cert .fr2{position:absolute;left:12mm;top:12mm;right:12mm;bottom:12mm;border:0.4mm solid ' + t.accent + '}' +
    '.cert .in{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:' + (L ? '4mm' : '6mm') + '}' +
    '.cert img.lg{height:22mm;max-width:70mm;object-fit:contain}' +
    '.cert h1{margin:0;font-size:' + (L ? '30pt' : '28pt') + ';letter-spacing:0.08em;text-transform:uppercase;color:' + t.accent + ';font-weight:700}' +
    '.cert .it{margin:0;font-style:italic;font-size:14pt;color:#444}' +
    '.cert .nm{margin:0;padding:0 8mm 2mm;border-bottom:0.5mm solid ' + t.accent + ';font-weight:700;max-width:100%}' +
    '.cert .bd{margin:0;max-width:' + (L ? '200mm' : '150mm') + ';font-size:15pt;line-height:1.5}' +
    '.cert .st{display:flex;flex-wrap:wrap;justify-content:center;gap:5mm;margin-top:2mm}.cert .st div{min-width:30mm;padding:2mm 4mm;border:0.4mm solid ' + t.accent + ';border-radius:1.5mm}' +
    '.cert .st small{display:block;font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:0.06em}.cert .st b{display:block;font-size:16pt}' +
    '.cert .sp{display:flex;align-items:center;justify-content:center;gap:8mm;font-size:10pt;color:#555;font-weight:700}' +
    '.cert .sg{display:flex;justify-content:center;gap:30mm;margin-top:' + (L ? '8mm' : '14mm') + ';width:100%}.cert .sg div{min-width:50mm;padding-top:2mm;border-top:0.4mm solid #333;font-size:11pt}.cert .sg small{display:block;font-size:9pt;color:#555}' +
    '.cert .fx{margin:0;font-size:9pt;color:#555}'
  );
}
// What a certificate can say about a runner. row: a row of the board. race: { name, date, venue }. cats: the race's categories with their length.
export function certVars(row0, race, cats) {
  const row = row0 && typeof row0 === 'object' ? row0 : {};
  const km = catKm(row.cat, cats);
  return {
    name: T(row.name),
    bib: T(row.bib),
    cat: T(row.cat),
    race: T(race && race.name),
    date: longDate(race && race.date),
    venue: T(race && race.venue),
    time: fmtTime(P(row.t)),
    place: ordinal(row.place),
    gender: row.gender ? genderLabel(row.gender) : '',
    gplace: ordinal(row.gplace),
    agegroup: T(row.ageGroup),
    aplace: ordinal(row.aplace),
    pace: paceText(P(row.t), km),
  };
}
export function renderCert(t, v0) {
  const v = v0 && typeof v0 === 'object' ? v0 : {};
  const L = t.orient === 'landscape';
  const name = T(v.name);
  const nameSize = name.length <= 24 ? (L ? 36 : 32) : name.length <= 36 ? (L ? 28 : 26) : L ? 22 : 20;
  const stats = [];
  if (t.stats) {
    if (v.time) stats.push(['Time', v.time]);
    if (v.place) stats.push(['Overall', v.place]);
    if (v.gplace && v.gender) stats.push([v.gender, v.gplace]);
    if (v.aplace && v.agegroup) stats.push([(v.gender ? v.gender + ' ' : '') + v.agegroup, v.aplace]);
    if (v.pace) stats.push(['Pace', v.pace]);
  }
  const sig = (n, r) => (n || r ? '<div>' + esc(n) + (r ? '<small>' + esc(r) + '</small>' : '') + '</div>' : '');
  const sigs = sig(t.sign1Name, t.sign1Role) + sig(t.sign2Name, t.sign2Role);
  return (
    '<section class="cert">' + (t.border !== 'none' ? '<div class="fr"></div>' : '') + (t.border === 'double' ? '<div class="fr2"></div>' : '') +
    '<div class="in">' + (safeImg(t.logo) ? '<img class="lg" src="' + esc(safeImg(t.logo)) + '" alt="">' : '') +
    '<h1>' + html(t.title, v) + '</h1>' + (t.intro ? '<p class="it">' + html(t.intro, v) + '</p>' : '') +
    '<p class="nm" style="font-size:' + nameSize + 'pt">' + esc(name) + '</p>' + (t.body ? '<p class="bd">' + html(t.body, v) + '</p>' : '') +
    (stats.length ? '<div class="st">' + stats.map((s) => '<div><small>' + esc(s[0]) + '</small><b>' + esc(s[1]) + '</b></div>').join('') + '</div>' : '') +
    (t.sponsors.length ? '<div class="sp">' + sponsorRow(t.sponsors, 10) + '</div>' : '') +
    (sigs ? '<div class="sg">' + sigs + '</div>' : '') + (t.footer ? '<p class="fx">' + html(t.footer, v) + '</p>' : '') +
    '</div></section>'
  );
}
export function renderCerts(t, varsList, race) {
  return { head: docHead('Certificates ' + T(race && race.name), certCss(t)), body: (Array.isArray(varsList) ? varsList : []).map((v) => renderCert(t, v)).join('') };
}

/* ---------- the runner page: what may be shown, and to whom ---------- */
export const CHUNK_BIBS = 60;
export const CHUNK_CERTS = 25;
export const MAX_FOUND = 10;
// The three switches the director controls. All three are off until the director turns them on. Certificates show the result, so they
// need the results switch too. A damaged row is read as everything off.
export function cleanFlags(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!r) throw new Error('bad_flags');
  const f = (k) => {
    if (r[k] === undefined) return false;
    if (typeof r[k] !== 'boolean') throw new Error('bad_flags');
    return r[k];
  };
  const out = { startList: f('startList'), results: f('results'), certs: f('certs'), note: '' };
  if (r.note !== undefined) {
    if (typeof r.note !== 'string') throw new Error('bad_flags');
    out.note = cleanText(r.note, 200);
  }
  if (out.certs && !out.results) throw new Error('certs_need_results');
  return out;
}
export function flagsOf(stored, parse) {
  const o = typeof parse === 'function' ? parse(stored) : stored;
  try {
    return cleanFlags(o);
  } catch (e) {
    return { startList: false, results: false, certs: false, note: '' };
  }
}
export const anyOn = (f) => !!(f && (f.startList || f.results));
const nameKey = (s) => T(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// Everything the public page can draw from, made once from the paid runners and the results: Map of bib to an entry, and the names
// to search. regs: [{ id, bib, name, cat, paid }]. assigns: Map of registration id to { wave, corral }. waves: [{ id, name, start }].
// rows: rows of the board (void results are never in it).
export function publicIndex(regs, assigns, waves, rows) {
  const byBib = new Map();
  const wv = new Map((Array.isArray(waves) ? waves : []).filter((w) => w && typeof w === 'object').map((w) => [w.id, w]));
  const entry = (bib) => {
    if (!byBib.has(bib)) byBib.set(bib, { bib, name: '', cat: '', listed: false, start: null, res: null, row: null });
    return byBib.get(bib);
  };
  (Array.isArray(regs) ? regs : []).forEach((r) => {
    if (!r || !r.paid || !bibKey(r.bib)) return;
    const e = entry(bibKey(r.bib));
    if (e.listed) return;
    e.listed = true;
    e.name = T(r.name);
    e.cat = T(r.cat);
    const a = assigns && typeof assigns.get === 'function' ? assigns.get(r.id) : null;
    const w = a && wv.get(a.wave);
    if (w) e.start = { wave: T(w.name), start: T(w.start), corral: T(a.corral) };
  });
  (Array.isArray(rows) ? rows : []).forEach((x) => {
    const bib = bibKey(x && x.bib);
    if (!bib) return;
    // a result for "105" belongs to the runner registered as "0105"
    const e = findByBib(byBib, bib) || entry(bib);
    e.row = x;
    e.name = T(x.name) || e.name;
    e.cat = T(x.cat) || e.cat;
    e.res = x.status === 'fin' ? { status: 'fin', time: fmtTime(P(x.t)), place: x.place || null, gender: x.gender ? genderLabel(x.gender) : '', ageGroup: T(x.ageGroup), gplace: x.gplace || null, aplace: x.aplace || null } : { status: T(x.status) };
  });
  const names = Array.from(byBib.values()).map((e) => ({ key: nameKey(e.name), bib: e.bib }));
  return { byBib, names };
}
const visible = (e, f) => !!e && ((f.startList && e.listed) || (f.results && e.res));
// What the public page is told about one runner, given the switches. Nothing here is a date of birth, an age, a phone number or an e-mail address.
export function publicView(e, f) {
  return {
    bib: e.bib,
    name: e.name,
    cat: e.cat,
    start: f.startList && e.start ? { wave: e.start.wave, start: e.start.start, corral: e.start.corral } : null,
    result: f.results && e.res ? Object.assign({}, e.res) : null,
    cert: !!(f.results && f.certs && e.res && e.res.status === 'fin' && e.res.place),
  };
}
// A search: a bib number first (an exact one, leading zeros forgiven), else a part of a name (three letters at least).
// Returns { items (at most limit), more, tooShort }.
export function searchPublic(idx, q, f, limit) {
  const text = cleanText(sOnly(q), 60);
  const lim = Number.isInteger(limit) && limit > 0 ? limit : MAX_FOUND;
  const b = bibKey(text);
  if (b) {
    const e = findByBib(idx.byBib, b);
    if (visible(e, f)) return { items: [publicView(e, f)], more: false, tooShort: false };
  }
  const k = nameKey(text);
  if (k.length < 3) return { items: [], more: false, tooShort: true };
  const hits = idx.names.filter((n) => n.key.includes(k) && visible(idx.byBib.get(n.bib), f));
  hits.sort((a, c) => (a.key.startsWith(k) ? 0 : 1) - (c.key.startsWith(k) ? 0 : 1) || (a.key < c.key ? -1 : a.key > c.key ? 1 : bibCmp(a.bib, c.bib)));
  return { items: hits.slice(0, lim).map((n) => publicView(idx.byBib.get(n.bib), f)), more: hits.length > lim, tooShort: false };
}
