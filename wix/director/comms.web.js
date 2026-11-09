// backend/comms.web.js
// Messages to runners and volunteers, for RaceOS (Velo): templates, who a message goes to, e-mails sent through one Wix triggered e-mail
// with a log of every one, WhatsApp links, and a file of an audience. It uses the same logins as RaceOS (the session token the page
// already holds).
//
//   director (admin or director)  writes templates, prepares and sends a batch, makes WhatsApp links, exports an audience, sends a test
//   lead                          can LOOK: the templates, a preview, how many people a message would reach, how a batch went. Sends nothing.
//   viewer, desk, coach, other    refused
//
// A message is made here, on the server, from one library (rd-comms.js): a name that a runner typed never becomes markup, a phone number
// only becomes digits in a wa.me address, and a cell of a file never starts a formula. The log holds ids and states only: no e-mail
// address, no phone number and no message text. A batch is sent at most once to each person: the log row of a person is created before
// the e-mail goes out (a row id can be made only once), so two people pressing Send together, or a call that is repeated, never send
// twice.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { elevate } from 'wix-auth';
import { collections } from 'wix-data.v2';
import { contacts, triggeredEmails } from 'wix-crm-backend';
import { kindOf, unameOf, tidyError } from './rd-auth.js';
import { cleanText, lc, bibKey, parseJson, isKey } from './rd-results.js';
import { SA, C, all, rows, getEvent, raceOf, knownCats, getWaves, loadRace } from './rd-data.js';
import {
  MAX_RCP, MEM_CHUNK, SEND_CHUNK, LINK_CHUNK, MARK_CHUNK, EXPORT_CHUNK, MAX_TEMPLATES, MAX_NVARS, VARS, STARTERS, EXPORT_COLS, EXPORT_HEAD,
  cleanTemplate, templateOf, okTplId, cleanSettings, settingsOf, cleanRaceLink, cleanLink, cleanEmail, waNumber, waLink, waText, varsFor, buildMessage,
  needsOf, cleanAud, audLabel, pickAudience, reachedBy, pieces, whyOf, resultVars, toCsv, csvLines, cleanCols, oneLine, firstName,
} from './rd-comms.js';
import { bookOf, runnerState, volunteerState } from './rd-waiver.js';

// Every method below goes through this: an unexpected native error is logged and answered with 'server_error' only.
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      throw tidyError(e, 'comms');
    }
  });

const COMMS = 'RDComms';
const VOLS = 'RDVolunteers';
const nowIso = () => new Date().toISOString();
const BUDGET_MS = 9000; // a send call stops starting new people after this long (a web method has 14 seconds)
const CONCURRENT = 5; // e-mails being sent at the same moment within one call
const TESTS_PER_HOUR = 5;

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
async function cauth(arg, need) {
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
const get = (id) => wixData.get(COMMS, id, SA).catch(() => null);
const safeRows = (col, ev) => rows(col, ev).catch(() => []);

/* ---------- arguments ---------- */
const fromOf = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  if (!Number.isInteger(v) || v < 0 || v > 1000000) throw new Error('bad_from');
  return v;
};
const keyOf = (v) => {
  if (!isKey(v)) throw new Error('bad_batch');
  return v;
};
const VIAS = ['email', 'whatsapp'];
const viaOf = (v) => {
  if (typeof v !== 'string' || !VIAS.includes(v)) throw new Error('bad_via');
  return v;
};
const digitsOf = (v) => cleanText(v, 40).replace(/\D/g, '').slice(0, 20);

/* ---------- settings, the race link and the templates ---------- */
const ids = {
  cfg: 'cfg',
  link: (ev) => 'rc~' + ev,
  tpl: (ev, id) => 'tpl~' + ev + '~' + id,
  bat: (ev, key) => 'bat~' + ev + '~' + key,
  mem: (ev, key, k) => 'mem~' + ev + '~' + key + '~' + k,
  rcp: (key, who) => 'rcp~' + key + '~' + who,
};
async function getCfg() {
  const row = await get(ids.cfg);
  return settingsOf(row && row.json, parseJson);
}
async function raceLink(ev) {
  const row = await get(ids.link(ev));
  const o = parseJson(row && row.json, {});
  return cleanLink(o && o.link);
}
// The starter templates (unless the director saved a version of one) and the templates the director wrote.
async function templatesOf(ev) {
  const saved = await all(() => wixData.query(COMMS).eq('event', ev).eq('kind', 'tpl').ascending('_id'));
  const byId = new Map();
  saved.forEach((r) => {
    const t = templateOf(r.json, parseJson);
    if (t && okTplId(r.ref)) byId.set(r.ref, Object.assign({ id: r.ref, saved: true }, t));
  });
  const out = STARTERS.map((s) => {
    const mine = byId.get(s.id);
    byId.delete(s.id);
    return Object.assign(mine || { id: s.id, name: s.name, kind: s.kind, subject: s.subject, body: s.body, archived: false, saved: false }, { starter: true });
  });
  byId.forEach((t) => out.push(Object.assign(t, { starter: false })));
  return out;
}
async function templateById(ev, id) {
  if (!okTplId(id)) throw new Error('bad_template');
  const row = await get(ids.tpl(ev, id));
  const t = row ? templateOf(row.json, parseJson) : null;
  if (t) return Object.assign({ id }, t);
  const s = STARTERS.find((x) => x.id === id);
  if (!s) throw new Error('no_template');
  return { id, name: s.name, kind: s.kind, subject: s.subject, body: s.body, archived: false };
}
// The template a call names: one that is saved (tplId) or one being typed (tpl), never both.
async function templateOfArg(e, arg) {
  if ((arg.tplId === undefined) === (arg.tpl === undefined)) throw new Error('bad_template');
  if (arg.tplId !== undefined) return templateById(e._id, arg.tplId);
  if (!arg.tpl || typeof arg.tpl !== 'object' || Array.isArray(arg.tpl)) throw new Error('bad_template');
  return Object.assign({ id: '' }, cleanTemplate(Object.assign({ name: 'Preview' }, arg.tpl)));
}

/* ---------- people ---------- */
async function byIds(col, list) {
  const out = [];
  for (const part of pieces(list, 100)) {
    const r = await wixData.query(col).hasSome('_id', part).limit(1000).find(SA);
    out.push(...r.items);
  }
  return out;
}
async function waveLookup(e, only) {
  const wv = await getWaves(e._id);
  const waves = new Map(wv.waves.map((w) => [w.id, w]));
  const as = only ? await byIds(C.ASSIGN, only.map((i) => 'wa~' + i)) : await rows(C.ASSIGN, e._id);
  return { waves, assign: new Map(as.map((x) => [String(x.regId), { wave: String(x.wave || ''), corral: String(x.corral || '') }])) };
}
async function resultLookup(e) {
  const d = await loadRace(e);
  return new Map(d.board.rows.filter((x) => x.bib).map((x) => [x.bib, x]));
}
// The people of a race as a message, a filter or a file needs them: runners (from the registrations) or volunteers. only: a list of ids
// (null for everybody). regs: registrations that are already read. need: { waves, results } says what else to read (it costs queries).
// Contact details stay in here: the ones a person has are 'email' (a plain address or '') and 'phone' (digits).
async function peopleOf(e, who, need, only, regs) {
  // who has signed the waiver: read only when an audience asks for it (it costs a query); a person is 'signed' or 'unsigned'
  const book = need.waiver ? bookOf(await safeRows(C.WAIV, e._id)) : null;
  const waiverOf = (st) => (book ? (st.state === 'signed' ? 'signed' : 'unsigned') : '');
  if (who === 'volunteers') {
    const list = only ? await byIds(VOLS, only) : await safeRows(VOLS, e._id);
    return list
      .filter((v) => v.event === e._id)
      .map((v) => ({ id: String(v._id), name: oneLine(v.name, 80), email: cleanEmail(v.email), emailRaw: cleanText(v.email, 120).toLowerCase(), phone: digitsOf(v.phone), vstatus: cleanText(v.status, 20), waiver: book ? waiverOf(volunteerState(v, book)) : '' }));
  }
  const list = only ? (await byIds(C.REGS, only)).filter((r) => r.event === e._id) : regs || (await rows(C.REGS, e._id));
  const wv = need.waves ? await waveLookup(e, only) : null;
  const rs = need.results ? await resultLookup(e) : null;
  return list.map((r) => {
    const id = String(r._id);
    const bib = bibKey(r.bib);
    const a = wv ? wv.assign.get(id) : null;
    const w = a ? wv.waves.get(a.wave) : null;
    const res = rs && bib ? rs.get(bib) : null;
    const rv = resultVars(res);
    return {
      id,
      name: oneLine(r.name, 80),
      email: cleanEmail(r.email),
      emailRaw: cleanText(r.email, 120).toLowerCase(),
      phone: digitsOf(r.phone),
      bib,
      bibName: oneLine(r.bibName, 40),
      cat: cleanText(r.cat, 60),
      size: cleanText(r.size, 12),
      paid: r.status === 'ok',
      waiver: book ? waiverOf(runnerState(r, book)) : '',
      status: res ? cleanText(res.status, 8) : '',
      wave: w ? w.name : '',
      start: w ? w.start : '',
      corral: w && a ? a.corral : '',
      time: rv.time,
      place: rv.place,
    };
  });
}
// Everybody who has had a template already: a message sent, or one that may have been (unless the audience says to count those again).
async function sentSet(ev, tplId, uncertain) {
  const list = await all(() => wixData.query(COMMS).eq('event', ev).eq('kind', 'rcp').eq('sub', tplId).ascending('_id'));
  return new Set(list.filter((r) => r.status === 'sent' || (r.status === 'sending' && !uncertain)).map((r) => String(r.who)));
}
// An audience as typed, checked against the race: the registrations are read once (for the categories) and handed on.
async function readAud(e, raw, tpls) {
  const wantsRunners = !!raw && typeof raw === 'object' && raw.who === 'runners';
  const regs = wantsRunners ? await rows(C.REGS, e._id) : null;
  const cats = regs ? knownCats(raceOf(e), regs) : [];
  const aud = cleanAud(raw, { cats, tpls: tpls.map((t) => t.id) });
  return { aud, regs, cats };
}
// The people an audience picks, in sending order.
async function pickPeople(e, aud, regs, tpl, extra) {
  const n = tpl ? needsOf(tpl) : { waves: false, results: false };
  const need = {
    waves: n.waves || (aud.who === 'runners' && aud.wave !== 'any') || !!(extra && extra.waves),
    results: n.results || (aud.who === 'runners' && aud.result !== 'any'),
    waiver: aud.waiver === 'signed' || aud.waiver === 'unsigned',
  };
  const people = await peopleOf(e, aud.who, need, null, regs);
  const sent = aud.notSent ? await sentSet(e._id, aud.notSent, aud.uncertain) : new Set();
  return pickAudience(people, aud, sent);
}
const raceFor = async (e) => Object.assign({}, raceOf(e), { link: await raceLink(e._id) });
// What a template uses that this person has no value for, as counts (only those that are not nil).
function missingOf(people, tpl) {
  const n = needsOf(tpl).used;
  const test = { bib: (p) => !p.bib, bibname: (p) => !p.bibName, cat: (p) => !p.cat, size: (p) => !p.size, wave: (p) => !p.wave, start: (p) => !p.start, corral: (p) => !p.corral, time: (p) => !p.time, place: (p) => !p.place };
  const out = {};
  n.forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(test, k)) return;
    const c = people.filter(test[k]).length;
    if (c) out[k] = c;
  });
  return out;
}
const SAMPLE = { name: 'Sample Runner', bib: '123', bibName: 'SAMPLE', cat: '10 K', size: 'M', wave: 'Wave A', start: '05:30', corral: 'A', time: '1:45:30', place: '12th' };

/* ---------- looking ---------- */
export const cmOverview = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const [cfg, link, tpls, bats, regs, vols] = await Promise.all([
    getCfg(),
    raceLink(e._id),
    templatesOf(e._id),
    all(() => wixData.query(COMMS).eq('event', e._id).eq('kind', 'bat').ascending('_id')),
    rows(C.REGS, e._id),
    safeRows(VOLS, e._id),
  ]);
  const paid = regs.filter((r) => r.status === 'ok');
  const cats = knownCats(raceOf(e), regs);
  const tplIds = tpls.map((t) => t.id);
  // who a batch was for, as the screen needs it to prepare a retry; null when the stored choices no longer fit the race
  const audOf = (o) => {
    try {
      return cleanAud(o && o.aud, { cats, tpls: tplIds });
    } catch (x) {
      return null;
    }
  };
  const batches = bats
    .filter((b) => VIAS.includes(b.sub))
    .map((b) => ({ b, o: parseJson(b.json, {}) }))
    .sort((x, y) => String(y.b.at).localeCompare(String(x.b.at)))
    .slice(0, 20)
    .map(({ b, o }) => ({ key: String(b.ref), via: String(b.sub), tpl: cleanText(o.tpl, 40), tplName: oneLine(o.tplName, 60), label: oneLine(o.label, 200), total: Number.isInteger(o.total) && o.total >= 0 && o.total <= MAX_RCP ? o.total : 0, noContact: Number.isInteger(o.noContact) && o.noContact >= 0 && o.noContact <= MAX_RCP ? o.noContact : 0, at: String(b.at || ''), by: cleanText(b.by, 60), aud: audOf(o) }));
  return {
    me: { role: a.role, name: a.name },
    race: { id: e._id, name: oneLine(e.name, 80), date: typeof e.date === 'string' ? e.date : '', venue: oneLine(e.venue, 120) },
    cats,
    settings: Object.assign({}, cfg, { link }),
    templates: tpls,
    batches,
    counts: {
      runners: { paid: paid.length, withBib: paid.filter((r) => bibKey(r.bib)).length, withEmail: paid.filter((r) => cleanEmail(r.email)).length, withPhone: paid.filter((r) => waNumber(r.phone, cfg.cc)).length },
      volunteers: { total: vols.length, withEmail: vols.filter((v) => cleanEmail(v.email)).length, withPhone: vols.filter((v) => waNumber(v.phone, cfg.cc)).length },
    },
    vars: VARS,
    cols: EXPORT_COLS.map((c) => ({ key: c, head: EXPORT_HEAD[c] })),
    limits: { recipients: MAX_RCP, templates: MAX_TEMPLATES, paragraphs: MAX_NVARS },
  };
});

// The message as one person would get it (the first person of the audience, or a made-up one), from a saved template or one being typed.
export const cmPreview = webMethod(Permissions.Anyone, async (arg) => {
  await cauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const tpls = await templatesOf(e._id);
  const tpl = await templateOfArg(e, arg);
  const cfg = await getCfg();
  const race = await raceFor(e);
  let who = null;
  if (arg.aud !== undefined) {
    const { aud, regs } = await readAud(e, arg.aud, tpls);
    if ((aud.who === 'runners') !== (tpl.kind === 'runner')) throw new Error('template_mismatch');
    who = (await pickPeople(e, aud, regs, tpl))[0] || null;
  }
  const person = who || Object.assign({}, SAMPLE, { name: tpl.kind === 'runner' ? SAMPLE.name : 'Sample Volunteer' });
  const vars = varsFor(person, race);
  const msg = buildMessage(tpl, vars, cfg.nvars);
  const chat = waText(buildMessage(tpl, vars, MAX_NVARS));
  const n = needsOf(tpl);
  return { subject: msg.subject, paras: msg.paras, joined: msg.joined, cut: msg.cut, nvars: cfg.nvars, whatsapp: chat.text, whatsappCut: chat.cut, noLink: n.link && !race.link, sample: { name: who ? who.name : person.name, bib: who ? who.bib || '' : '', fake: !who } };
});

// How many people an audience reaches and how: counts and a few names, never an address or a number.
export const cmAudience = webMethod(Permissions.Anyone, async (arg) => {
  await cauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const tpls = await templatesOf(e._id);
  const tpl = arg.tplId === undefined && arg.tpl === undefined ? null : await templateOfArg(e, arg);
  const cfg = await getCfg();
  const { aud, regs } = await readAud(e, arg.aud, tpls);
  if (tpl && (aud.who === 'runners') !== (tpl.kind === 'runner')) throw new Error('template_mismatch');
  const members = await pickPeople(e, aud, regs, tpl);
  const out = {
    label: audLabel(aud, (tpls.find((t) => t.id === aud.notSent) || {}).name),
    total: members.length,
    withEmail: members.filter((p) => reachedBy(p, 'email')).length,
    withPhone: members.filter((p) => reachedBy(p, 'whatsapp', cfg.cc)).length,
    sample: members.slice(0, 8).map((p) => ({ name: p.name, bib: p.bib || '', cat: p.cat || '', email: reachedBy(p, 'email'), phone: reachedBy(p, 'whatsapp', cfg.cc) })),
    missing: tpl ? missingOf(members, tpl) : {},
  };
  if (tpl && tpl.id && !aud.notSent) {
    const sent = await sentSet(e._id, tpl.id, aud.uncertain);
    out.sentBefore = members.filter((p) => sent.has(p.id)).length;
  }
  return out;
});

/* ---------- changing: settings and templates (directors) ---------- */
export const cmSaveSettings = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  if (['emailId', 'nvars', 'cc', 'link'].some((k) => arg[k] === undefined)) throw new Error('bad_settings');
  const s = cleanSettings({ emailId: arg.emailId, nvars: arg.nvars, cc: arg.cc });
  const link = cleanRaceLink(arg.link);
  await put(COMMS, { _id: ids.cfg, event: '', kind: 'cfg', ref: '', sub: '', who: '', status: '', why: '', json: JSON.stringify(s), by: a.username, at: nowIso() });
  await put(COMMS, { _id: ids.link(e._id), event: e._id, kind: 'rc', ref: '', sub: '', who: '', status: '', why: '', json: JSON.stringify({ link }), by: a.username, at: nowIso() });
  await audit(a, 'message settings saved', e.name, 'e-mail ' + (s.emailId ? 'set' : 'not set') + ', ' + s.nvars + ' paragraphs, race link ' + (link ? 'set' : 'not set'));
  return { settings: Object.assign({}, s, { link }) };
});

export const cmSaveTemplate = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  if (!okTplId(arg.id)) throw new Error('bad_template');
  const t = cleanTemplate({ name: arg.name, kind: arg.kind, subject: arg.subject, body: arg.body, archived: arg.archived === undefined ? false : arg.archived });
  const rowId = ids.tpl(e._id, arg.id);
  const starter = STARTERS.some((s) => s.id === arg.id);
  if (!starter && !(await get(rowId))) {
    const have = await all(() => wixData.query(COMMS).eq('event', e._id).eq('kind', 'tpl').ascending('_id'));
    if (have.length >= MAX_TEMPLATES) throw new Error('too_many_templates');
  }
  await put(COMMS, { _id: rowId, event: e._id, kind: 'tpl', ref: arg.id, sub: t.kind, who: '', status: '', why: '', json: JSON.stringify(t), by: a.username, at: nowIso() });
  await audit(a, t.archived ? 'message template archived' : 'message template saved', e.name, t.name);
  return { tpl: Object.assign({ id: arg.id, saved: true, starter }, t) };
});

/* ---------- a batch: who, what, how ---------- */
// Freezes who a message goes to: the people are found now and their ids are kept (a few rows of up to 500 ids each); nothing else about
// them is kept. Calling it again with the same key and the same choices gives the batch that is there.
export const cmPrepare = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const key = keyOf(arg.key);
  const via = viaOf(arg.via);
  const tpls = await templatesOf(e._id);
  const tpl = await templateById(e._id, arg.tplId);
  if (tpl.archived) throw new Error('template_archived');
  const { aud, regs } = await readAud(e, arg.aud, tpls);
  if ((aud.who === 'runners') !== (tpl.kind === 'runner')) throw new Error('template_mismatch');
  const old = await get(ids.bat(e._id, key));
  if (old) {
    const o = parseJson(old.json, {});
    if (old.event !== e._id || o.tpl !== tpl.id || old.sub !== via || JSON.stringify(o.aud) !== JSON.stringify(aud)) throw new Error('key_in_use');
    return { batch: key, total: o.total, noContact: o.noContact, via, label: o.label, again: true };
  }
  const cfg = await getCfg();
  if (via === 'email' && !cfg.emailId) throw new Error('no_email_id');
  if (needsOf(tpl).link && !(await raceLink(e._id))) throw new Error('no_link');
  const members = await pickPeople(e, aud, regs, tpl);
  const reach = members.filter((p) => reachedBy(p, via, cfg.cc));
  if (!reach.length) throw new Error('empty_audience');
  if (reach.length > MAX_RCP) throw new Error('too_many');
  const label = audLabel(aud, (tpls.find((t) => t.id === aud.notSent) || {}).name);
  const at = nowIso();
  const parts = pieces(
    reach.map((p) => p.id),
    MEM_CHUNK
  );
  for (let k = 0; k < parts.length; k++) {
    await put(COMMS, { _id: ids.mem(e._id, key, k), event: e._id, kind: 'mem', ref: key, sub: '', who: '', status: '', why: '', json: JSON.stringify({ ids: parts[k] }), by: a.username, at });
  }
  const info = { tpl: tpl.id, tplName: tpl.name, kind: tpl.kind, subject: tpl.subject, body: tpl.body, aud, label, total: reach.length, noContact: members.length - reach.length };
  await put(COMMS, { _id: ids.bat(e._id, key), event: e._id, kind: 'bat', ref: key, sub: via, who: aud.who, status: '', why: '', json: JSON.stringify(info), by: a.username, at });
  await audit(a, via === 'email' ? 'e-mail batch prepared' : 'WhatsApp batch prepared', e.name, label + ': ' + reach.length + ' people, "' + tpl.name + '"');
  return { batch: key, total: reach.length, noContact: members.length - reach.length, via, label };
});
async function batchOf(e, key0) {
  const key = keyOf(key0);
  const row = await get(ids.bat(e._id, key));
  if (!row || row.event !== e._id || row.ref !== key || !VIAS.includes(row.sub)) throw new Error('no_batch');
  const o = parseJson(row.json, {});
  // Only who the batch is for matters from here on: the people are the frozen ids, the words are the stored template.
  const who = o && o.aud && o.aud.who === 'volunteers' ? 'volunteers' : 'runners';
  const tpl = { id: cleanText(o.tpl, 40), name: oneLine(o.tplName, 60), kind: o.kind === 'volunteer' ? 'volunteer' : 'runner', subject: cleanText(o.subject, 400), body: typeof o.body === 'string' ? o.body.slice(0, 20000) : '' };
  const total = Number.isInteger(o.total) && o.total >= 0 && o.total <= MAX_RCP ? o.total : 0;
  return { key, via: row.sub, who, tpl, label: oneLine(o.label, 200), total, noContact: Number.isInteger(o.noContact) && o.noContact >= 0 && o.noContact <= MAX_RCP ? o.noContact : 0, at: String(row.at || ''), by: cleanText(row.by, 60) };
}
// The ids of a batch from one place to another, in the order they were frozen in.
async function memberSlice(e, bat, from, count) {
  if (from >= bat.total) return [];
  const first = Math.floor(from / MEM_CHUNK);
  const last = Math.floor((Math.min(from + count, bat.total) - 1) / MEM_CHUNK);
  let list = [];
  for (let k = first; k <= last; k++) {
    const row = await get(ids.mem(e._id, bat.key, k));
    const o = row && row.event === e._id ? parseJson(row.json, {}) : {};
    const part = o && Array.isArray(o.ids) ? o.ids.filter((x) => typeof x === 'string') : [];
    if (part.length !== Math.min(MEM_CHUNK, bat.total - k * MEM_CHUNK)) throw new Error('batch_damaged');
    list = list.concat(part);
  }
  const at = from - first * MEM_CHUNK;
  return list.slice(at, at + count);
}
async function allMembers(e, bat) {
  return memberSlice(e, bat, 0, MEM_CHUNK * Math.ceil(bat.total / MEM_CHUNK) || 0);
}
// The e-mail (a Wix contact for the address, then the triggered e-mail with the message in its variables).
async function contactFor(email, name) {
  const find = async () => (await contacts.queryContacts().eq('info.emails.email', email).limit(2).find(SA)).items[0];
  let c = await find();
  if (!c) {
    // a name that starts like a formula would start one in a file Wix exports: the contact gets the name without those characters
    const plain = (s) => s.replace(/^[=+\-@\s]+/, '');
    const first = plain(firstName(name)) || 'Runner';
    const last = plain(oneLine(name, 80).split(/\s+/).slice(1).join(' '));
    try {
      c = await contacts.createContact({ name: last ? { first, last } : { first }, emails: [{ email }] }, { allowDuplicates: false, suppressAuth: true });
    } catch (x) {
      c = await find();
      if (!c) throw x;
    }
  }
  const sub = c.info && c.info.extendedFields ? c.info.extendedFields['emailSubscriptions.subscriptionStatus'] : '';
  return { id: String(c._id), unsubscribed: sub === 'UNSUBSCRIBED' };
}
async function deliver(p, bat, cfg, race) {
  const msg = buildMessage(bat.tpl, varsFor(p, race), cfg.nvars);
  const c = await contactFor(p.email, p.name);
  if (c.unsubscribed) return { status: 'skipped', why: 'unsubscribed' };
  await triggeredEmails.emailContact(cfg.emailId, c.id, { variables: msg.variables });
  return { status: 'sent', why: '' };
}

// Sends the next people of a batch (up to 25, for as long as nine seconds allow) and says where to go on from. Safe to call again and
// again, and from two screens: a person whose log row is there is never sent to a second time.
export const cmSend = webMethod(Permissions.Anyone, async (arg) => {
  const t0 = Date.now(); // the nine seconds count from here: signing in and reading the people use some of them
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const bat = await batchOf(e, arg.batch);
  if (bat.via !== 'email') throw new Error('wrong_channel');
  const cfg = await getCfg();
  if (!cfg.emailId) throw new Error('no_email_id');
  const from = fromOf(arg.from);
  const out = { from, next: null, total: bat.total, sent: 0, failed: 0, skipped: 0, busy: 0, stopped: false };
  if (from >= bat.total) return out;
  const list = await memberSlice(e, bat, from, SEND_CHUNK);
  const n = needsOf(bat.tpl);
  const people = new Map((await peopleOf(e, bat.who, { waves: n.waves, results: n.results }, list)).map((p) => [p.id, p]));
  const race = await raceFor(e);
  if (from === 0) await audit(a, 'e-mail sending started', e.name, bat.label + ': ' + bat.total + ' people, "' + bat.tpl.name + '"');
  const deadline = t0 + BUDGET_MS;
  let at = 0;
  let fails = 0;
  let worked = false;
  const one = async (id) => {
    const row = { _id: ids.rcp(bat.key, id), event: e._id, kind: 'rcp', ref: bat.key, sub: bat.tpl.id, who: id, status: 'sending', why: '', json: '', by: a.username, at: nowIso() };
    let mine;
    try {
      mine = await wixData.insert(COMMS, row, SA);
    } catch (x) {
      out.busy++;
      return;
    }
    const p = people.get(id);
    let r;
    if (!p) r = { status: 'skipped', why: 'person_removed' };
    else if (!p.email) r = { status: 'skipped', why: 'no_email' };
    else {
      try {
        r = await deliver(p, bat, cfg, race);
      } catch (x) {
        r = { status: 'failed', why: whyOf(x) };
      }
    }
    if (r.status === 'sent') {
      out.sent++;
      worked = true;
    } else if (r.status === 'failed') {
      out.failed++;
      fails++;
    } else out.skipped++;
    try {
      await wixData.update(COMMS, Object.assign({}, mine, { status: r.status, why: r.why, at: nowIso() }), SA);
    } catch (x) {
      // the row stays 'sending': the batch report shows it as unsure, and it is never sent again by this batch
    }
  };
  const worker = async () => {
    while (at < list.length && Date.now() < deadline && !(fails >= 3 && !worked)) {
      const id = list[at++];
      await one(id);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT }, worker));
  out.stopped = fails >= 3 && !worked;
  out.next = from + at < bat.total ? from + at : null;
  if (out.next === null) await audit(a, 'e-mail sending finished', e.name, bat.label + ': ' + bat.tpl.name);
  return out;
});

// How a batch went: counts by state, and the people it did not reach (name and bib only).
export const cmBatch = webMethod(Permissions.Anyone, async (arg) => {
  await cauth(arg, 'view');
  const e = await getEvent(arg.ev);
  const bat = await batchOf(e, arg.batch);
  const log = await all(() => wixData.query(COMMS).eq('event', e._id).eq('kind', 'rcp').eq('ref', bat.key).ascending('_id'));
  const counts = { sent: 0, failed: 0, skipped: 0, sending: 0 };
  log.forEach((r) => {
    if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status]++;
  });
  const done = new Set(log.map((r) => String(r.who)));
  const members = await allMembers(e, bat);
  const resume = members.findIndex((id) => !done.has(id));
  const bad = log.filter((r) => r.status !== 'sent');
  const shown = bad.slice(0, 50);
  const folks = new Map((await peopleOf(e, bat.who, { waves: false, results: false }, shown.map((r) => String(r.who)))).map((p) => [p.id, p]));
  return {
    key: bat.key,
    via: bat.via,
    tpl: bat.tpl.id,
    tplName: bat.tpl.name,
    label: bat.label,
    total: bat.total,
    noContact: bat.noContact,
    at: bat.at,
    by: bat.by,
    counts: Object.assign(counts, { waiting: Math.max(0, bat.total - log.length) }),
    resume: resume < 0 ? null : resume,
    problems: shown.map((r) => ({ name: (folks.get(String(r.who)) || {}).name || '', bib: (folks.get(String(r.who)) || {}).bib || '', status: String(r.status), why: cleanText(r.why, 80) })),
    moreProblems: Math.max(0, bad.length - shown.length),
  };
});

/* ---------- WhatsApp, a file, a test ---------- */
// A page of chats for a WhatsApp batch: the name and a ready link for each person. The links hold phone numbers, so each time a batch's
// first page is asked for it is written in the audit trail (without any number).
export const cmLinks = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const bat = await batchOf(e, arg.batch);
  if (bat.via !== 'whatsapp') throw new Error('wrong_channel');
  const cfg = await getCfg();
  const from = fromOf(arg.from);
  const list = await memberSlice(e, bat, from, LINK_CHUNK);
  const n = needsOf(bat.tpl);
  const people = new Map((await peopleOf(e, bat.who, { waves: n.waves, results: n.results }, list)).map((p) => [p.id, p]));
  const done = new Set((await byIds(COMMS, list.map((id) => ids.rcp(bat.key, id)))).map((r) => String(r.who)));
  const race = await raceFor(e);
  if (from === 0) await audit(a, 'WhatsApp links opened', e.name, bat.label + ': ' + bat.total + ' people, "' + bat.tpl.name + '"');
  const items = list.map((id) => {
    const p = people.get(id);
    if (!p) return { id, name: '', bib: '', link: '', done: done.has(id) };
    const vars = varsFor(p, race);
    const text = waText(buildMessage(bat.tpl, vars, MAX_NVARS)).text;
    return { id, name: p.name, bib: p.bib || '', link: waLink(waNumber(p.phone, cfg.cc), text), done: done.has(id) };
  });
  return { from, next: from + list.length < bat.total ? from + list.length : null, total: bat.total, items };
});

// People of a WhatsApp batch marked as messaged (or as left out): one log row each, made once.
export const cmMark = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const bat = await batchOf(e, arg.batch);
  if (bat.via !== 'whatsapp') throw new Error('wrong_channel');
  if (arg.status !== 'sent' && arg.status !== 'skipped') throw new Error('bad_status');
  const want = arg.ids;
  if (!Array.isArray(want) || !want.length || want.length > MARK_CHUNK || want.some((x) => typeof x !== 'string' || !x || x.length > 120)) throw new Error('bad_ids');
  const member = new Set(await allMembers(e, bat));
  if (want.some((x) => !member.has(x))) throw new Error('not_in_batch');
  const out = { marked: 0, already: 0 };
  for (const id of Array.from(new Set(want))) {
    try {
      await wixData.insert(COMMS, { _id: ids.rcp(bat.key, id), event: e._id, kind: 'rcp', ref: bat.key, sub: bat.tpl.id, who: id, status: arg.status, why: 'whatsapp', json: '', by: a.username, at: nowIso() }, SA);
      out.marked++;
    } catch (x) {
      out.already++;
    }
  }
  return out;
});

// The audience as a CSV file, a page of up to 1000 rows at a time (the heading only on the first). It holds contact details, so it is for
// directors and each time the first page is asked for it is written in the audit trail (the columns, never the details).
export const cmExport = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const tpls = await templatesOf(e._id);
  const cols = cleanCols(arg.cols);
  const from = fromOf(arg.from);
  const { aud, regs } = await readAud(e, arg.aud, tpls);
  const members = await pickPeople(e, aud, regs, null, { waves: cols.some((c) => ['wave', 'start', 'corral'].includes(c)) });
  const part = members.slice(from, from + EXPORT_CHUNK);
  const cell = (p, c) => (c === 'email' ? p.emailRaw : c === 'phone' ? p.phone : p[c] || '');
  const body = part.map((p) => cols.map((c) => cell(p, c)));
  if (from === 0) await audit(a, 'audience exported', e.name, audLabel(aud, (tpls.find((t) => t.id === aud.notSent) || {}).name) + ': ' + members.length + ' rows, columns ' + cols.join(', '));
  return { csv: from === 0 ? toCsv(cols.map((c) => EXPORT_HEAD[c]), body) : csvLines(body), count: part.length, from, next: from + part.length < members.length ? from + part.length : null, total: members.length };
});

// One e-mail to an address the director types, to see how the real thing looks and to check the Wix e-mail is set up. At most five an
// hour; it says what Wix answered (the reason is safe to show) instead of failing.
export const cmTest = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg, 'director');
  const e = await getEvent(arg.ev);
  const to = cleanEmail(arg.to);
  if (!to) throw new Error('bad_email');
  const tpl = await templateOfArg(e, arg);
  const cfg = await getCfg();
  if (!cfg.emailId) throw new Error('no_email_id');
  const race = await raceFor(e);
  // The limit is kept by claiming first and counting after, so tests started at the same moment cannot all slip under it: a test goes
  // out only when it is among the five of the last hour. A try that is refused is marked so, and does not count against the hour.
  const since = Date.now() - 3600000;
  const mine = await wixData.insert(COMMS, { event: e._id, kind: 'tst', ref: '', sub: '', who: '', status: '', why: '', json: '', by: a.username, at: nowIso() }, SA);
  const tries = await all(() => wixData.query(COMMS).eq('event', e._id).eq('kind', 'tst').ascending('_id'));
  const recent = tries.filter((r) => r._id === mine._id || (r.status !== 'refused' && Date.parse(r.at) > since));
  if (recent.length > TESTS_PER_HOUR) {
    await wixData.update(COMMS, Object.assign({}, mine, { status: 'refused' }), SA).catch(() => null);
    throw new Error('too_many_tests');
  }
  const person = Object.assign({}, SAMPLE, { name: tpl.kind === 'runner' ? SAMPLE.name : 'Sample Volunteer' });
  const msg = buildMessage(Object.assign({}, tpl, { subject: '[TEST] ' + tpl.subject }), varsFor(person, race), cfg.nvars);
  let result;
  try {
    const c = await contactFor(to, 'Test');
    if (c.unsubscribed) result = { sent: false, why: 'unsubscribed' };
    else {
      await triggeredEmails.emailContact(cfg.emailId, c.id, { variables: msg.variables });
      result = { sent: true, why: '' };
    }
  } catch (x) {
    result = { sent: false, why: whyOf(x) };
  }
  await audit(a, 'test e-mail', e.name, result.sent ? 'sent' : 'not sent: ' + result.why);
  return result;
});

/* ---------- collections ---------- */
const textField = (key) => ({ key, displayName: key, type: 'TEXT' });
const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };
function collectionDefs() {
  return [{ _id: COMMS, displayName: COMMS, permissions: LOCKED, fields: ['event', 'kind', 'ref', 'sub', 'who', 'status', 'why', 'json', 'by', 'at'].map(textField) }];
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
