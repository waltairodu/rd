// backend/print.web.js
// Bibs, certificates and the runner page's switches, for RaceOS (Velo). It uses the same logins as RaceOS (the session token the page
// already holds).
//
//   director (admin or director)  designs the bib and the certificate, prints, and turns the runner page's switches on and off
//   lead                          can LOOK and PRINT (preview, print bibs, print certificates). Changes nothing.
//   viewer, desk, coach, other    refused
//
// Papers are made here, on the server, from one library (rd-print.js): the screens only show the page they are given and print it.
// A date of birth, a phone number and an e-mail address are never in any answer. A design is checked again every time it is used, so a
// damaged or hand-written row can never put markup, a script or a strange address on a paper.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { kindOf, unameOf, tidyError } from './rd-auth.js';
import { cleanText, lc, catKey, parseJson, bibKey, bibCmp, findByBib } from './rd-results.js';
import { SA, C, getEvent, loadRace, catsOf } from './rd-data.js';
import { cleanBibTpl, cleanCertTpl, bibTplOf, certTplOf, renderBibs, renderCerts, spareBibs, certVars, flagsOf, cleanFlags, pageOf, CHUNK_BIBS, CHUNK_CERTS, PLACEHOLDERS, IMG_HOSTS } from './rd-print.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'print');
    }
  });

const nowIso = () => new Date().toISOString();

/* ---------- who is asking ---------- */
async function staffRows() {
  try {
    const out = [];
    for (let skip = 0; skip < 5000; skip += 1000) {
      const r = await wixData.query(C.STAFF).ascending('_id').skip(skip).limit(1000).find(SA);
      out.push(...r.items);
      if (r.items.length < 1000) break;
    }
    return out;
  } catch (e) {
    throw new Error('setup_needed');
  }
}
// Every method starts here. need: 'director' (directors only) or 'view' (directors and leads).
async function pauth(arg, need) {
  // A token is text. A list or an object that would turn into a token when printed is not one.
  const t = arg && typeof arg.token === 'string' ? arg.token : '';
  if (t.length < 20) throw new Error('not_logged_in');
  let sess;
  try {
    sess = (await wixData.query(C.SESS).eq('token', t).limit(1).find(SA)).items[0];
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
    await wixData.insert(C.AUDIT, { at: nowIso(), by: a.username, action, target: cleanText(target, 60), detail: cleanText(detail, 200) }, SA);
  } catch (e) {
    // the note is lost, the change is not
  }
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

/* ---------- saved designs and switches ---------- */
const rowId = (ev, kind) => (kind === 'pub' ? 'pub~' + ev : 'tpl~' + ev + '~' + kind);
const getRow = (ev, kind) => wixData.get(C.PRINT, rowId(ev, kind), SA).catch(() => null);
const KINDS = ['bib', 'cert'];
const kindOfArg = (v) => {
  if (typeof v !== 'string' || !KINDS.includes(v)) throw new Error('bad_kind');
  return v;
};
const tplFor = (kind, row, cats) => (kind === 'bib' ? bibTplOf(row && row.json, cats, parseJson) : certTplOf(row && row.json, parseJson));
// A cursor: a whole number from 0, else 'bad_from'.
const fromOf = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  if (!Number.isInteger(v) || v < 0 || v > 1000000) throw new Error('bad_from');
  return v;
};
// A category that the race has (any spelling of it), or '' for all. Anything else is refused.
const catOf = (v, cats) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw new Error('bad_cat');
  const k = cats.find((c) => catKey(c) === catKey(v));
  if (!k) throw new Error('bad_cat');
  return k;
};
const bibOf = (v) => {
  if (v === undefined || v === null || v === '') return '';
  const b = bibKey(v);
  if (!b) throw new Error('bad_bib');
  return b;
};
// The paid runners who have a bib, in bib order: what a bib is printed for.
const printable = (infos) =>
  infos
    .filter((x) => x.paid && x.bib)
    .map((x) => ({ bib: x.bib, name: x.name, bibName: x.bibName, cat: x.cat }))
    .sort((a, b) => bibCmp(a.bib, b.bib));
// The finishers, by category (in the race's order), then by place.
const finishers = (rowsOfBoard, cats) => {
  const order = new Map(cats.map((c, i) => [catKey(c), i]));
  return rowsOfBoard
    .filter((x) => x.status === 'fin' && x.place)
    .slice()
    .sort((a, b) => (order.has(catKey(a.cat)) ? order.get(catKey(a.cat)) : 999) - (order.has(catKey(b.cat)) ? order.get(catKey(b.cat)) : 999) || a.place - b.place || bibCmp(a.bib, b.bib));
};
const SAMPLE_BIB = { bib: '123', name: 'Sample Runner', bibName: 'SAMPLE', cat: '' };
const SAMPLE_ROW = { name: 'Sample Runner', bib: '123', cat: '', t: 345000, place: 3, gplace: 1, aplace: 1, gender: 'F', ageGroup: '30-39', status: 'fin' };

export const prnOverview = webMethod(Permissions.Anyone, async (arg) => {
  const a = await pauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const [d, bibRow, certRow, pubRow] = await Promise.all([loadRace(e), getRow(e._id, 'bib'), getRow(e._id, 'cert'), getRow(e._id, 'pub')]);
  const paid = d.infos.filter((x) => x.paid);
  const have = paid.filter((x) => x.bib).length;
  return {
    me: { role: a.role, name: a.name },
    race: { id: d.race.id, name: d.race.name, date: d.race.date, venue: d.race.venue },
    cats: d.cats,
    bib: tplFor('bib', bibRow, d.cats),
    cert: tplFor('cert', certRow, d.cats),
    pub: flagsOf(pubRow && pubRow.json, parseJson),
    counts: { paid: paid.length, printable: have, noBib: paid.length - have, finishers: finishers(d.board.rows, d.cats).length },
    vars: PLACEHOLDERS,
    hosts: IMG_HOSTS.slice(),
  };
});

export const prnSaveTemplate = webMethod(Permissions.Anyone, async (arg) => {
  const a = await pauth(arg, 'director');
  const kind = kindOfArg(arg.kind);
  const e = await getEvent(arg.ev);
  if (!arg.tpl || typeof arg.tpl !== 'object' || Array.isArray(arg.tpl)) throw new Error('bad_template');
  const cats = kind === 'bib' ? await catsOf(e) : [];
  const tpl = kind === 'bib' ? cleanBibTpl(arg.tpl, cats) : cleanCertTpl(arg.tpl);
  await put(C.PRINT, { _id: rowId(e._id, kind), event: e._id, kind, json: JSON.stringify(tpl), by: a.username, at: nowIso() });
  await audit(a, kind === 'bib' ? 'bib design saved' : 'certificate design saved', e.name, '');
  return { tpl };
});

// A paper made from a design that has not been saved yet (or the saved one), for the screen's preview.
export const prnPreview = webMethod(Permissions.Anyone, async (arg) => {
  await pauth(arg, 'view');
  const kind = kindOfArg(arg.kind);
  const e = await getEvent(arg.ev);
  const [d, saved] = await Promise.all([loadRace(e), getRow(e._id, kind)]);
  let tpl;
  if (arg.tpl === undefined) tpl = tplFor(kind, saved, d.cats);
  else {
    if (!arg.tpl || typeof arg.tpl !== 'object' || Array.isArray(arg.tpl)) throw new Error('bad_template');
    tpl = kind === 'bib' ? cleanBibTpl(arg.tpl, d.cats) : cleanCertTpl(arg.tpl);
  }
  const want = bibOf(arg.bib);
  const race = { name: d.race.name, date: d.race.date, venue: d.race.venue };
  if (kind === 'bib') {
    const list = printable(d.infos);
    const map = new Map(list.map((x) => [x.bib, x]));
    let pick = null;
    if (want) {
      pick = findByBib(map, want);
      if (!pick) throw new Error('no_item');
    } else pick = list[0] || null;
    const item = pick || Object.assign({}, SAMPLE_BIB, { cat: d.cats[0] || '10 K' });
    const r = renderBibs(tpl, [item], race, d.cats);
    return { head: r.head, body: r.body, sample: { bib: item.bib, name: item.name, fake: !pick } };
  }
  const fin = finishers(d.board.rows, d.cats);
  let row = null;
  if (want) {
    row = findByBib(new Map(fin.map((x) => [x.bib, x])), want);
    if (!row) throw new Error('no_item');
  } else row = fin[0] || null;
  const use = row || Object.assign({}, SAMPLE_ROW, { cat: d.cats[0] || '10 K' });
  const r = renderCerts(tpl, [certVars(use, race, d.race.cats)], race);
  return { head: r.head, body: r.body, sample: { bib: use.bib, name: use.name, fake: !row } };
});

// Bibs, one page of up to 60 at a time. The client joins head + every body + foot into one print-out.
export const prnBibs = webMethod(Permissions.Anyone, async (arg) => {
  const a = await pauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const [d, saved] = await Promise.all([loadRace(e), getRow(e._id, 'bib')]);
  const cat = catOf(arg.cat, d.cats);
  const from = fromOf(arg.from);
  const only = bibOf(arg.only);
  const tpl = tplFor('bib', saved, d.cats);
  const race = { name: d.race.name, date: d.race.date, venue: d.race.venue };
  let list = printable(d.infos);
  let skipped = 0;
  if (only) {
    const hit = findByBib(new Map(list.map((x) => [x.bib, x])), only);
    if (!hit) throw new Error('no_item');
    list = [hit];
  } else {
    if (cat) list = list.filter((x) => catKey(x.cat) === catKey(cat));
    if (arg.spares !== undefined && arg.spares !== null) {
      const s = arg.spares;
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('bad_spares');
      const sp = spareBibs(s.from, s.to, new Set(printable(d.infos).map((x) => x.bib)));
      list = list.concat(sp.items);
      skipped = sp.skipped;
    }
  }
  const pg = pageOf(list, from, CHUNK_BIBS);
  const r = renderBibs(tpl, pg.items, race, d.cats);
  if (from === 0) await audit(a, 'bibs printed', e.name, (only ? 'bib ' + only : cat || 'all') + ': ' + pg.total);
  return { head: r.head, body: r.body, count: pg.items.length, from, next: pg.next, total: pg.total, skippedSpares: skipped };
});

// Certificates for the finishers, one page of up to 25 at a time.
export const prnCerts = webMethod(Permissions.Anyone, async (arg) => {
  const a = await pauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const [d, saved] = await Promise.all([loadRace(e), getRow(e._id, 'cert')]);
  const cat = catOf(arg.cat, d.cats);
  const from = fromOf(arg.from);
  const only = bibOf(arg.only);
  const tpl = tplFor('cert', saved, d.cats);
  const race = { name: d.race.name, date: d.race.date, venue: d.race.venue };
  let list = finishers(d.board.rows, d.cats);
  if (only) {
    const hit = findByBib(new Map(list.map((x) => [x.bib, x])), only);
    if (!hit) throw new Error('no_item');
    list = [hit];
  } else if (cat) list = list.filter((x) => catKey(x.cat) === catKey(cat));
  const pg = pageOf(list, from, CHUNK_CERTS);
  const r = renderCerts(tpl, pg.items.map((x) => certVars(x, race, d.race.cats)), race);
  if (from === 0) await audit(a, 'certificates printed', e.name, (only ? 'bib ' + only : cat || 'all') + ': ' + pg.total);
  return { head: r.head, body: r.body, count: pg.items.length, from, next: pg.next, total: pg.total };
});

export const prnSavePublish = webMethod(Permissions.Anyone, async (arg) => {
  const a = await pauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const pub = cleanFlags(arg.pub);
  await put(C.PRINT, { _id: rowId(e._id, 'pub'), event: e._id, kind: 'pub', json: JSON.stringify(pub), by: a.username, at: nowIso() });
  await audit(a, 'runner page changed', e.name, 'start list ' + (pub.startList ? 'on' : 'off') + ', results ' + (pub.results ? 'on' : 'off') + ', certificates ' + (pub.certs ? 'on' : 'off'));
  return { pub };
});

/* ---------- collections ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  return [{ _id: C.PRINT, displayName: C.PRINT, permissions: LOCKED, fields: ['event', 'kind', 'json', 'by', 'at'].map(textField) }];
}
let checked = false;
// Creates the collection the first time a director or lead opens the tab (only when it is missing).
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
