// backend/rd-data.js
// The readers that the print and runner modules share: one race, its registrations, its results, its waves and its settings.
// Reading only: nothing in here writes. (results.web.js keeps its own copies of these readers, kept the same on purpose.)
import wixData from 'wix-data';
import { cleanText, catKey, parseJson, settingsOf, wavesOf, regInfo, board } from './rd-results.js';

export const SA = { suppressAuth: true };
export const C = {
  STAFF: 'ExpoStaff',
  SESS: 'ExpoSessions',
  EVENTS: 'RDEvents',
  REGS: 'RDRegs',
  AUDIT: 'RDAudit',
  RESULTS: 'RDResults',
  ASSIGN: 'RDWaveAssign',
  RSET: 'RDResSet',
  PRINT: 'RDPrint',
};
const MAXROWS = 1000;

// Every row a query finds, a thousand at a time (never more than twenty thousand).
export async function all(q) {
  const out = [];
  for (let skip = 0; skip < 20000; skip += MAXROWS) {
    const r = await q().skip(skip).limit(MAXROWS).find(SA);
    out.push(...r.items);
    if (r.items.length < MAXROWS) break;
  }
  return out;
}
export const rows = (col, ev) => all(() => wixData.query(col).eq('event', ev).ascending('_id'));
export async function getEvent(ev) {
  const id = typeof ev === 'string' ? ev : '';
  const it = id ? await wixData.get(C.EVENTS, id, SA).catch(() => null) : null;
  if (!it) throw new Error('no_event');
  return it;
}
// The race as the papers need it: name, date, venue and the categories it lists (with their distances).
export function raceOf(e) {
  const j = parseJson(e.json, {});
  const cats = j && Array.isArray(j.cats) ? j.cats.filter((c) => c && typeof c === 'object' && typeof c.name === 'string') : [];
  return { id: e._id, name: cleanText(e.name, 80), raceDate: typeof e.date === 'string' ? e.date : '', date: typeof e.date === 'string' ? e.date : '', venue: cleanText(e.venue, 120), cats };
}
// The categories that exist: the ones the race lists and the ones the registrations carry.
export function knownCats(race, regList) {
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
// Just the categories of a race (what a design needs to know), without loading anything else.
export async function catsOf(e) {
  return knownCats(raceOf(e), await rows(C.REGS, e._id));
}
// bib -> what the registration says about the runner
export function regMap(regList, map) {
  const m = new Map();
  regList.forEach((r) => {
    const i = regInfo(r, map);
    if (i.bib && !m.has(i.bib)) m.set(i.bib, i);
  });
  return m;
}
export async function getSettings(evId) {
  const row = await wixData.get(C.RSET, 'set~' + evId, SA).catch(() => null);
  return settingsOf(row && row.json);
}
// The newest saved waves (every save is a new row whose id holds its revision).
export async function getWaves(evId) {
  const list = await all(() => wixData.query(C.RSET).eq('kind', 'waves').eq('ref', evId).ascending('_id'));
  const last = list[list.length - 1];
  return wavesOf(last && last.json);
}
// Everything a paper or the runner page is made from, read once: registrations (as runners), the board, the waves and where each
// runner stands in them.
export async function loadRace(e) {
  const [regList, resRows, st, wv, assigns] = await Promise.all([rows(C.REGS, e._id), rows(C.RESULTS, e._id), getSettings(e._id), getWaves(e._id), rows(C.ASSIGN, e._id)]);
  const race = raceOf(e);
  const infos = regList.map((r) => Object.assign(regInfo(r, st.map), { bibName: cleanText(r.bibName, 40) }));
  const b = board(resRows, regMap(regList, st.map), { settings: st, raceDate: race.raceDate, cats: race.cats });
  const am = new Map(assigns.map((x) => [x.regId, { wave: String(x.wave || ''), corral: String(x.corral || '') }]));
  return { race, st, infos, board: b, waves: wv.waves, assigns: am, cats: knownCats(race, regList) };
}
