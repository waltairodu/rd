// backend/runner.web.js
// The public runner page (/runner), for RaceOS (Velo). Anyone may call these three methods, with no login, so they are built to give
// away as little as possible and to change nothing:
//
//   * They only READ. Nothing here inserts, updates or removes a row, and no collection is made here.
//   * A race is visible only after a director has turned a switch on for it (Waves & results > Bibs & certificates > Publish). With
//     every switch off, a race does not exist as far as this page can tell: "not_published" is the answer for it and for a race that
//     is not there.
//   * What comes back is the bib, name, category, wave and start time, the result (time, places, age group) and a certificate. Never a
//     date of birth, an age, a phone number, an e-mail address, a T-shirt size, a payment status, a note or an answer from the form.
//   * A search names a bib, or three letters of a name, and gets at most ten runners.
//   * The certificate is a finished page of text and styles with no script in it; every typed word is escaped.
//
// The switches are read on every call (so turning one off takes effect at once). The heavy work of ranking the race is kept for 30
// seconds per race, so a rush of runners looking at their results costs the database a few reads a minute, not one for each runner.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { tidyError } from './rd-auth.js';
import { cleanText, parseJson, bibKey, findByBib } from './rd-results.js';
import { SA, C, all, loadRace } from './rd-data.js';
import { publicIndex, searchPublic, flagsOf, anyOn, certTplOf, certVars, renderCerts, DOC_FOOT, MAX_FOUND } from './rd-print.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'runner');
    }
  });

const flagsFor = async (evId) => {
  const row = await wixData.get(C.PRINT, 'pub~' + evId, SA).catch(() => null);
  return flagsOf(row && row.json, parseJson);
};
// The race and its switches, or 'not_published'. The same answer whether the race is not there or is simply not shown.
async function openRace(ev, need) {
  const id = typeof ev === 'string' && ev.length <= 80 ? ev : '';
  if (!id) throw new Error('not_published');
  const f = await flagsFor(id);
  if (!anyOn(f) || (need && !need(f))) throw new Error('not_published');
  const e = await wixData.get(C.EVENTS, id, SA).catch(() => null);
  if (!e) throw new Error('not_published');
  return { e, f };
}

/* ---------- the made index of a race, kept for 30 seconds ---------- */
const TTL = 30000;
const KEEP = 6;
const CACHE = new Map();
async function indexOf(e) {
  const now = Date.now();
  const hit = CACHE.get(e._id);
  if (hit && now >= hit.at && now - hit.at < TTL) return hit;
  const d = await loadRace(e);
  const built = { at: now, race: d.race, idx: publicIndex(d.infos, d.assigns, d.waves, d.board.rows) };
  CACHE.set(e._id, built);
  while (CACHE.size > KEEP) CACHE.delete(CACHE.keys().next().value);
  return built;
}
const raceOut = (race) => ({ id: race.id, name: race.name, date: race.date, venue: race.venue });

// The races that show anything, newest first (twenty at most).
export const pubRaces = webMethod(Permissions.Anyone, async () => {
  let list = [];
  try {
    list = await all(() => wixData.query(C.PRINT).eq('kind', 'pub').ascending('_id'));
  } catch (e) {
    return { races: [] };
  }
  const out = [];
  for (const r of list.slice(0, 200)) {
    if (!anyOn(flagsOf(r.json, parseJson))) continue;
    const e = await wixData.get(C.EVENTS, String(r.event || ''), SA).catch(() => null);
    if (e) out.push({ id: e._id, name: cleanText(e.name, 80), date: typeof e.date === 'string' ? e.date : '' });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name < b.name ? -1 : 1));
  return { races: out.slice(0, 20) };
});

export const pubFind = webMethod(Permissions.Anyone, async (arg) => {
  const a = arg && typeof arg === 'object' ? arg : {};
  if (typeof a.q !== 'string' || a.q.length > 200) throw new Error('bad_query');
  const { e, f } = await openRace(a.ev);
  const built = await indexOf(e);
  const found = searchPublic(built.idx, a.q, f, MAX_FOUND);
  return { race: raceOut(built.race), flags: { startList: f.startList, results: f.results, certs: f.certs }, note: f.note, items: found.items, more: found.more, tooShort: found.tooShort };
});

export const pubCert = webMethod(Permissions.Anyone, async (arg) => {
  const a = arg && typeof arg === 'object' ? arg : {};
  const bib = bibKey(a.bib);
  const { e } = await openRace(a.ev, (f) => f.results && f.certs);
  if (!bib) throw new Error('no_certificate');
  const built = await indexOf(e);
  const hit = findByBib(built.idx.byBib, bib);
  if (!hit || !hit.row || hit.row.status !== 'fin' || !hit.row.place) throw new Error('no_certificate');
  const row = await wixData.get(C.PRINT, 'tpl~' + e._id + '~cert', SA).catch(() => null);
  const tpl = certTplOf(row && row.json, parseJson);
  const race = { name: built.race.name, date: built.race.date, venue: built.race.venue };
  const r = renderCerts(tpl, [certVars(hit.row, race, built.race.cats)], race);
  return { name: hit.name, bib: hit.bib, html: r.head + r.body + DOC_FOOT };
});
