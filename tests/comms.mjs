// BACKEND TESTS (Communications): who may call what, the settings and templates, previews, who a message reaches, preparing a batch,
// sending e-mails (at most once to each person, two screens at once, a call that stops, a call that runs out of time, a call that dies),
// the WhatsApp links and marks, the file of an audience, the test e-mail, and the other race, on one in-memory database with the real
// RaceOS, Results and Communications backends and a stand-in for the Wix contacts and triggered e-mails.
//   K1 who may call what   K2 overview   K3 settings   K4 templates   K5 previews   K6 who a message reaches   K7 preparing a batch
//   K8 sending   K9 how a batch went   K10 a big batch   K11 WhatsApp   K12 the file   K13 the test e-mail   K14 the other race
//   K15 what is kept
import * as R from './racedir.test.mjs';
import * as S from './results.test.mjs';
import * as CM from './comms.test.mjs';
import * as L from './rd-comms.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Communications backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const CRM = global.__CRM;
const rows = (t) => [...(DB[t] || new Map()).values()];
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const CNAMES = Object.keys(CM).filter((n) => /^cm[A-Z]/.test(n));
let kseq = 0;
const K = () => 'cmk' + Date.now().toString(36) + (++kseq).toString(36) + Math.random().toString(36).slice(2, 8);
// the clock: an e-mail that "takes" four seconds moves it on
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const snap = () => JSON.stringify(Object.keys(DB).sort().map((k) => [k, [...DB[k].entries()]]));
// nothing is ever deleted
let removes = 0;
if (typeof wd.bulkRemove === 'function') {
  const f = wd.bulkRemove;
  wd.bulkRemove = (...a) => {
    removes++;
    return f.apply(wd, a);
  };
}
const crmReset = () => {
  CRM.contacts.clear();
  CRM.sent.length = 0;
  CRM.calls.length = 0;
  CRM.fail = {};
  CRM.delay = 0;
  CRM.n = 0;
};
const UNSUB = (first, email) => ({ _id: 'u-' + first, info: { name: { first }, emails: [{ email }], extendedFields: { 'emailSubscriptions.subscriptionStatus': 'UNSUBSCRIBED' } } });
const DOT = ' · ';
const DASH = L.DASH;

/* ---------- the world ---------- */
const HASH = A.hashPassword('Cm-pass-1');
const mkStaff = (username, role) => wd.insert('ExpoStaff', { username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['desk1', 'desk']];
for (const [u, r] of WHO) await mkStaff(u, r);
const TOK = {};
for (const [u] of WHO) {
  TOK[u] = A.newToken();
  await wd.insert('ExpoSessions', { token: TOK[u], username: u, desk: '', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
}
const RD = istDay(60);
const Y = +RD.slice(0, 4);
const mkRace = async (name, cats) => {
  const ev = (await R.saveEvent({ token: TOK.boss, name, date: RD, venue: 'Beach Road <b>' })).event.id;
  await R.saveCats({ token: TOK.boss, ev, cats });
  return ev;
};
const CATS = [{ name: '10 K', km: 10, price: 800, cap: 9000 }, { name: '21 K', km: 21.0975, price: 1200, cap: 9000 }];
const EVA = await mkRace('Comms Run A', CATS);
const EVB = await mkRace('Comms Run B', CATS.slice(0, 1));
const EVE = await mkRace('Comms Run E big', CATS.slice(0, 1));
const EVF = await mkRace('Comms Run F huge', CATS.slice(0, 1));
const EVG = await mkRace('Comms Run G full', CATS.slice(0, 1));
const FORM = (g, d) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: '' }, { name: 'Expected finish', value: '55:00' }]);
const dob = (age) => '01/01/' + (Y - age);
const regId = (ev, key) => 'REG~' + ev.slice(-6) + '~' + key;
const reg = (ev, p) => wd.insert('RDRegs', { _id: regId(ev, p.bib || p.key), event: ev, name: p.name, cat: p.cat, bib: p.bib || '', bibName: p.bibName || '', size: p.size || '', status: p.status || 'ok', phone: p.phone || '', email: p.email || '', form: FORM(p.g || 'F', dob(p.age || 30)), at: new Date().toISOString() }, SA);
const PPL = [
  { bib: '101', name: 'Asha Rao', cat: '10 K', email: 'asha@example.com', phone: '9812300101', size: 'M', bibName: 'ASHA', g: 'F', age: 36 },
  { bib: '102', name: 'BINA RAO', cat: '10 K', email: 'Bina@Example.com', phone: '9812300102', size: 'S', g: 'F', age: 31 },
  { bib: '103', name: 'Chitra Devi', cat: '10 K', email: 'chitra@example.com', phone: '919812300103', size: 'L', g: 'F', age: 26 },
  { bib: '104', name: 'Dev Raman', cat: '10 K', email: '', phone: '9812300104', size: 'XL', g: 'M', age: 46 },
  { bib: '105', name: 'Esha Nair', cat: '10 K', email: 'not-an-email', phone: '', size: 'M', g: 'F', age: 36 },
  { bib: '106', name: '<img src=x onerror=1>Eve', cat: '10 K', email: 'eve@example.com', phone: '9812300106', size: 'M', bibName: '<script>x</script>', g: 'F', age: 29 },
  { bib: '201', name: 'Indu Menon', cat: '21 K', email: 'indu@example.com', phone: '9812300201', size: 'S', g: 'F', age: 41 },
  { bib: '202', name: 'Jai Shah', cat: '21 K', email: 'jai@example.com', phone: '0891234567', size: 'L', g: 'M', age: 51 },
  { bib: '203', name: 'Kiran Das', cat: '21 K', email: 'indu@example.com', phone: '9812300203', size: 'M', g: 'F', age: 29 },
  { bib: '301', name: '=HYPERLINK("http://evil","x")', cat: '21 K', email: 'f@example.com', phone: '9812300301', size: 'M', g: 'M', age: 33 },
  { bib: '302', name: 'Lakshmi Prasad', cat: '21 K', email: 'lakshmi@example.com', phone: '9812300302', size: 'M', g: 'F', age: 38 },
  { key: 'nina', bib: '', name: 'Nina Nobib', cat: '10 K', email: 'nina@example.com', phone: '9812300999', size: 'M', g: 'F', age: 30 },
  { bib: '111', name: 'Unpaid Uma', cat: '10 K', email: 'uma@example.com', phone: '9812300111', size: 'M', status: 'pending', g: 'F', age: 30 },
];
for (const p of PPL) await reg(EVA, p);
await reg(EVB, { bib: '101', name: 'Other Race Olga', cat: '10 K', email: 'olga@example.com', phone: '9812300777', size: 'M' });
const vol = (ev, n, name, phone, email, status) => wd.insert('RDVolunteers', { event: ev, name, phone, email, club: '', status, code: 'C' + n, waiverAt: '', waiverVersion: '', createdAt: new Date().toISOString(), notes: '' }, SA);
await vol(EVA, 1, 'Vol One', '9812300501', 'vol1@example.com', 'approved');
await vol(EVA, 2, 'Vol Two', '9812300502', '', 'applied');
await vol(EVA, 3, 'Vol Three', '9812300503', 'vol3@example.com', 'declined');
await vol(EVA, 4, 'Vol Four', '9812300504', 'vol4@example.com', 'approved');
await vol(EVB, 5, 'Vol Other', '9812300505', 'volb@example.com', 'approved');
const SETTINGS = { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: 'Gender', dob: 'Date of birth', age: 'Age', seed: 'Expected finish' } };
await S.resSaveSettings({ token: TOK.boss, ev: EVA, settings: SETTINGS });
await S.resSaveWaves({ token: TOK.boss, ev: EVA, rev: 0, waves: [{ cat: '10 K', name: 'Wave 1', start: '06:00', corrals: 'A, B', cap: 0 }, { cat: '21 K', name: 'Elite', start: '05:30', corrals: '', cap: 0 }] });
await S.resAssign({ token: TOK.boss, ev: EVA, mode: 'bib', key: K() });
const CSV = ['bib,chip,status', '101,55:10,', '102,56:20,', '103,57:30,', '104,,DNF', '105,,DNS', '106,58:00,', '201,1:50:00,', '202,1:40:00,', '301,1:45:00,', '302,1:59:00,'].join('\n');
{
  const dry = await S.resImport({ token: TOK.boss, ev: EVA, text: CSV, dry: true });
  if (dry.errors.length) throw new Error('the results file has errors: ' + JSON.stringify(dry.errors.slice(0, 3)));
  const r = await S.resImport({ token: TOK.boss, ev: EVA, text: CSV, key: K() });
  ok(r.saved === 10, 'K0 control: ten results are saved for the race (' + r.saved + ')');
}
const BOARD = (await S.resBoard({ token: TOK.boss, ev: EVA })).rows;
const boardOf = (bib) => BOARD.find((x) => x.bib === bib);
const ORD = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const ASG = new Map(rows('RDWaveAssign').map((x) => [x.regId, x]));
const LONG = L.varsFor({}, { date: RD }).date;
const call = (fn, who, o, ev) => CM[fn](Object.assign({ token: who === null ? undefined : TOK[who], ev: ev === undefined ? EVA : ev }, o || {}));
const LEAK = /@example\.com|98123\d{5}|0891234567|\+91|"phone":"\d|"email":"[^"]*@/;
const noLeak = (o, msg) => ok(!LEAK.test(JSON.stringify(o)), msg);
const AUD = { who: 'runners' };
const SET1 = { emailId: 'vtra_mail', nvars: 6, cc: '91', link: 'https://www.vtra.run/vhm' };
const bibOf = (s) => (/bib (\S+?),/.exec(s.variables.p2) || [])[1];
const par = (i, m) => m.variables['p' + i];
const cellsOf = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
const linesOf = (csv) => csv.split('\r\n').filter((l) => l !== '');
const logOf = (batch) => rows('RDComms').filter((x) => x.kind === 'rcp' && x.ref === batch);
const sendAll = async (batch, from, who, ev) => {
  let f = from || 0;
  const t = { sent: 0, failed: 0, skipped: 0, busy: 0, calls: 0, stopped: false, last: null };
  for (let i = 0; i < 400; i++) {
    const r = await call('cmSend', who || 'boss', { batch, from: f }, ev);
    t.calls++;
    t.sent += r.sent;
    t.failed += r.failed;
    t.skipped += r.skipped;
    t.busy += r.busy;
    t.last = r;
    if (r.stopped) {
      t.stopped = true;
      break;
    }
    if (r.next === null) break;
    f = r.next;
  }
  return t;
};
const B1 = K();
const VB = K();
ok(CNAMES.length === 12, 'K0 control: the Communications backend has 12 methods (' + CNAMES.length + ')');
eq([rows('RDRegs').filter((r) => r.event === EVA && r.status === 'ok').length, ASG.size > 5], [12, true], 'K0 control: the race has twelve paid runners and wave places for most of them');
eq([BOARD.filter((x) => x.status === 'fin').length, BOARD.length >= 10], [8, true], 'K0 control: eight runners finished');

/* ---------- K1 who may call what ---------- */
{
  const DIRONLY = ['cmSaveSettings', 'cmSaveTemplate', 'cmPrepare', 'cmSend', 'cmLinks', 'cmMark', 'cmExport', 'cmTest'];
  const LOOK = { cmOverview: [{}, ''], cmPreview: [{ tplId: 'bib' }, ''], cmAudience: [{ aud: AUD }, ''], cmBatch: [{ batch: 'nobatch0001' }, 'no_batch'] };
  const ARGS = { cmSaveSettings: SET1, cmSaveTemplate: { id: 'mine1', name: 'My mail', kind: 'runner', subject: 'Hi {firstname}', body: 'Hello {firstname}.' }, cmPrepare: { key: K(), tplId: 'bib', aud: AUD, via: 'email' }, cmSend: { batch: 'nobatch0001' }, cmLinks: { batch: 'nobatch0001' }, cmMark: { batch: 'nobatch0001', ids: ['x'], status: 'sent' }, cmExport: { aud: AUD }, cmTest: { tplId: 'bib', to: 'me@example.com' } };
  eq(Object.keys(LOOK).concat(DIRONLY).sort(), CNAMES.slice().sort(), 'K1 every method is in one of the two lists');
  for (const n of Object.keys(LOOK)) {
    const [a, want] = LOOK[n];
    const bad = [];
    for (const w of ['boss', 'dir2', 'lead1']) if ((await err(call(n, w, a))) !== want) bad.push(w);
    ok(!bad.length, 'K1 ' + n + ': directors and leads may look (' + bad.join(',') + ')');
    const bad2 = [];
    for (const w of ['view1', 'coach1', 'desk1']) if ((await err(call(n, w, a))) !== 'not_allowed') bad2.push(w);
    ok(!bad2.length, 'K1 ' + n + ': viewers, coaches and desk staff are refused (' + bad2.join(',') + ')');
    await refused(call(n, null, a), 'not_logged_in', 'K1 ' + n + ': no login');
    await refused(CM[n](Object.assign({ token: 'x'.repeat(30), ev: EVA }, a)), 'not_logged_in', 'K1 ' + n + ': a made-up login');
    await refused(CM[n](Object.assign({ token: TOK.boss, ev: 'nope' }, a)), 'no_event', 'K1 ' + n + ': a race that does not exist');
    await refused(CM[n](Object.assign({ token: [TOK.boss], ev: EVA }, a)), 'not_logged_in', 'K1 ' + n + ': a login that is a list');
  }
  for (const n of DIRONLY) {
    const a = ARGS[n];
    await refused(call(n, 'lead1', a), 'director_only', 'K1 ' + n + ': a lead is told "directors only"');
    const bad = [];
    for (const w of ['view1', 'coach1', 'desk1']) if ((await err(call(n, w, a))) !== 'not_allowed') bad.push(w);
    ok(!bad.length, 'K1 ' + n + ': viewers, coaches and desk staff are refused (' + bad.join(',') + ')');
    await refused(call(n, null, a), 'not_logged_in', 'K1 ' + n + ': no login');
    await refused(CM[n](Object.assign({ token: 'x'.repeat(30), ev: EVA }, a)), 'not_logged_in', 'K1 ' + n + ': a made-up login');
    await refused(CM[n](Object.assign({ token: TOK.boss, ev: 'nope' }, a)), 'no_event', 'K1 ' + n + ': a race that does not exist');
  }
  const expired = A.newToken();
  await wd.insert('ExpoSessions', { token: expired, username: 'boss', desk: '', expires: new Date(realNow() + skew - 1000).toISOString() }, SA);
  const damaged = A.newToken();
  await wd.insert('ExpoSessions', { token: damaged, username: 'boss', desk: '', expires: '' }, SA);
  await refused(CM.cmOverview({ token: expired, ev: EVA }), 'not_logged_in', 'K1 an expired login is refused');
  await refused(CM.cmOverview({ token: damaged, ev: EVA }), 'not_logged_in', 'K1 a login whose expiry is blank is refused');
  for (const bad of [undefined, null, {}, 'x', 5, [], { token: {} }, { token: 5 }, { token: true }]) await refused(CM.cmOverview(bad), 'not_logged_in', 'K1 a call without a proper login is refused: ' + JSON.stringify(bad));
  ok(!rows('RDComms').length && !CRM.sent.length && !CRM.calls.length, 'K1 nothing was written, sent or looked up by all those refused calls');
}

/* ---------- K2 overview ---------- */
{
  const o = await call('cmOverview', 'boss');
  eq([o.me, o.race.name, o.race.id, o.cats], [{ role: 'director', name: 'boss' }, 'Comms Run A', EVA, ['10 K', '21 K']], 'K2 the overview says who is asking, which race and its categories');
  eq(o.settings, { emailId: '', nvars: 6, cc: '91', link: '' }, 'K2 nothing is set up yet: no Wix e-mail, six paragraphs, country code 91, no race link');
  eq(o.templates.map((t) => [t.id, t.kind, t.starter, t.saved, t.archived]), L.STARTERS.map((s) => [s.id, s.kind, true, false, false]), 'K2 the five starter templates are there, none saved yet');
  eq([o.counts.runners, o.counts.volunteers], [{ paid: 12, withBib: 11, withEmail: 10, withPhone: 10 }, { total: 4, withEmail: 3, withPhone: 4 }], 'K2 how many runners and volunteers there are and how many can be reached');
  eq([o.batches, o.vars, o.limits, o.cols.map((c) => c.key)], [[], L.VARS, { recipients: 5000, templates: 40, paragraphs: 12 }, L.EXPORT_COLS], 'K2 no batches yet; the placeholders, the limits and the columns of a file');
  eq((await call('cmOverview', 'lead1')).counts, o.counts, 'K2 a lead sees the same');
  noLeak(o, 'K2 the overview holds no e-mail address or phone number');
  const b = await call('cmOverview', 'boss', {}, EVB);
  eq([b.counts.runners.paid, b.counts.volunteers.total, b.cats], [1, 1, ['10 K']], 'K2 another race has its own numbers');
  ok(rows('RDComms').length === 0, 'K2 looking writes nothing');
}

/* ---------- K3 settings ---------- */
{
  await refused(call('cmPrepare', 'boss', { key: K(), tplId: 'bib', aud: AUD, via: 'email' }), 'no_email_id', 'K3 before the Wix e-mail is named nothing can be prepared for e-mail');
  const before = snap();
  const BADS = [{ emailId: 'a b' }, { emailId: 'a"b' }, { emailId: 5 }, { emailId: 'x'.repeat(81) }, { nvars: 0 }, { nvars: 13 }, { nvars: 'x' }, { cc: '0' }, { cc: 91 }, { link: 'http://x.com' }, { link: 'javascript:alert(1)' }, { link: 5 }, { link: 'https://a b' }];
  for (const bad of BADS) await refused(call('cmSaveSettings', 'boss', Object.assign({}, SET1, bad)), 'bad_settings', 'K3 a wrong setting is refused: ' + JSON.stringify(bad).slice(0, 80));
  await refused(call('cmSaveSettings', 'boss', {}), 'bad_settings', 'K3 nothing given is refused');
  await refused(call('cmSaveSettings', 'boss', { emailId: 'a', nvars: 6, cc: '91' }), 'bad_settings', 'K3 a missing race link is refused (all four are needed)');
  ok(snap() === before, 'K3 a refused save writes nothing');
  const s = await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { emailId: ' vtra_mail ' }));
  eq(s.settings, SET1, 'K3 settings are saved (the id is trimmed)');
  eq((await call('cmOverview', 'lead1')).settings, SET1, 'K3 a lead sees them');
  const cfg = rows('RDComms').find((r) => r._id === 'cfg');
  const rc = rows('RDComms').find((r) => r._id === 'rc~' + EVA);
  ok(cfg && cfg.kind === 'cfg' && cfg.event === '' && cfg.by === 'boss' && JSON.parse(cfg.json).emailId === 'vtra_mail' && rc && rc.event === EVA && JSON.parse(rc.json).link === SET1.link, 'K3 the e-mail, paragraphs and country code are one site-wide row; the link is a row of this race');
  await call('cmSaveSettings', 'boss', { emailId: 'vtra_mail', nvars: 6, cc: '91', link: '' }, EVB);
  eq((await call('cmOverview', 'boss', {}, EVB)).settings, { emailId: 'vtra_mail', nvars: 6, cc: '91', link: '' }, 'K3 the e-mail is for the whole site, the link is for one race');
  eq((await call('cmOverview', 'boss')).settings.link, SET1.link, 'K3 saving the link of one race leaves the other race\'s link alone');
  ok(rows('RDAudit').some((a) => a.action === 'message settings saved' && a.by === 'boss' && /e-mail set, 6 paragraphs, race link set/.test(a.detail)), 'K3 the save is in the audit log, without any detail of value');
  const s2 = await call('cmSaveSettings', 'dir2', { emailId: '', nvars: '8', cc: '', link: '' });
  eq(s2.settings, { emailId: '', nvars: 8, cc: '91', link: '' }, 'K3 a second director clears the e-mail and the link; a blank country code is 91; "8" is 8');
  await call('cmSaveSettings', 'boss', SET1);
  eq((await call('cmOverview', 'boss')).settings, SET1, 'K3 and puts them back');
}

/* ---------- K4 templates ---------- */
{
  const T1 = { id: 'mine1', name: 'My mail', kind: 'runner', subject: 'Hi {firstname}', body: 'Hello {firstname}.\n\nBib {bib}.' };
  const r = await call('cmSaveTemplate', 'boss', T1);
  eq([r.tpl.id, r.tpl.saved, r.tpl.starter, r.tpl.archived, r.tpl.subject], ['mine1', true, false, false, 'Hi {firstname}'], 'K4 a new template is saved');
  const row = rows('RDComms').find((x) => x._id === 'tpl~' + EVA + '~mine1');
  ok(row && row.kind === 'tpl' && row.event === EVA && row.ref === 'mine1' && row.by === 'boss', 'K4 it is one row of this race, with who saved it');
  const o = await call('cmOverview', 'lead1');
  eq(o.templates.map((t) => t.id), ['bib', 'kit', 'raceweek', 'thanks', 'volunteer', 'mine1'], 'K4 the starters first, then the director\'s own');
  const st = await call('cmSaveTemplate', 'dir2', { id: 'bib', name: 'Your bib (VTRA)', kind: 'runner', subject: 'Bib {bib} for {race}', body: 'Hi {firstname}, your bib is {bib}.\n\nSee you at {venue}.' });
  eq([st.tpl.starter, st.tpl.saved], [true, true], 'K4 a starter can be edited: the saved version replaces it');
  const o2 = await call('cmOverview', 'boss');
  const b = o2.templates.find((t) => t.id === 'bib');
  eq([b.name, b.saved, b.starter, o2.templates.length], ['Your bib (VTRA)', true, true, 6], 'K4 the list shows the saved version of the starter, once');
  const ar = await call('cmSaveTemplate', 'boss', Object.assign({}, T1, { archived: true }));
  eq(ar.tpl.archived, true, 'K4 a template can be archived');
  ok(rows('RDAudit').some((a) => a.action === 'message template archived' && a.detail === 'My mail') && rows('RDAudit').some((a) => a.action === 'message template saved' && a.detail === 'My mail'), 'K4 saves and archives are in the audit log with the template\'s name');
  await call('cmSaveTemplate', 'boss', T1);
  const before = snap();
  const BAD = [[{}, 'bad_template'], [Object.assign({}, T1, { id: undefined }), 'bad_template'], [Object.assign({}, T1, { id: 'a' }), 'bad_template'], [Object.assign({}, T1, { id: 'a~b' }), 'bad_template'], [Object.assign({}, T1, { id: ['mine1'] }), 'bad_template'], [Object.assign({}, T1, { kind: 'admin' }), 'bad_template'], [Object.assign({}, T1, { name: ' ' }), 'bad_template'], [Object.assign({}, T1, { subject: 5 }), 'bad_template'], [Object.assign({}, T1, { body: '' }), 'bad_template'], [Object.assign({}, T1, { archived: 'yes' }), 'bad_template'], [Object.assign({}, T1, { body: 'x'.repeat(20000) }), 'bad_template'], [Object.assign({}, T1, { subject: 'Hello {nmae}' }), 'unknown_placeholder'], [Object.assign({}, T1, { kind: 'volunteer' }), 'unknown_placeholder']];
  for (const [bad, code] of BAD) await refused(call('cmSaveTemplate', 'boss', bad), code, 'K4 a wrong template is refused (' + code + '): ' + JSON.stringify(bad).slice(0, 70));
  ok(snap() === before, 'K4 a refused save writes nothing');
  const m = await call('cmSaveTemplate', 'boss', { id: 'markup1', name: '<b>Bold</b>', kind: 'volunteer', subject: 'Hi <i>{name}</i>', body: 'Dear {name} <script>alert(1)</script>' });
  eq([m.tpl.name, m.tpl.subject, m.tpl.body], ['bBold/b', 'Hi i{name}/i', 'Dear {name} scriptalert(1)/script'], 'K4 markup typed in a template is cleaned out when it is saved');
  await wd.insert('RDComms', { _id: 'tpl~' + EVA + '~broken1', event: EVA, kind: 'tpl', ref: 'broken1', sub: 'runner', who: '', status: '', why: '', json: '{"name":5,"subject":"<x>"}', by: 'x', at: 'x' }, SA);
  await wd.insert('RDComms', { _id: 'tpl~' + EVA + '~kit', event: EVA, kind: 'tpl', ref: 'kit', sub: 'runner', who: '', status: '', why: '', json: 'not json', by: 'x', at: 'x' }, SA);
  const o3 = await call('cmOverview', 'boss');
  ok(!o3.templates.some((t) => t.id === 'broken1') && o3.templates.find((t) => t.id === 'kit').saved === false, 'K4 a damaged saved row is not a template: it is left out, and a starter with a damaged row is the starter');
  eq((await call('cmOverview', 'boss', {}, EVB)).templates.map((t) => t.id), L.STARTERS.map((s) => s.id), 'K4 another race has only the starters');
  // the limit of forty (in a race of its own)
  for (let i = 0; i < 40; i++) await call('cmSaveTemplate', 'boss', { id: 'bulk' + String(i).padStart(2, '0'), name: 'Bulk ' + i, kind: 'runner', subject: 's', body: 'b' }, EVG);
  await refused(call('cmSaveTemplate', 'boss', { id: 'bulk40', name: 'Bulk', kind: 'runner', subject: 's', body: 'b' }, EVG), 'too_many_templates', 'K4 a race can have forty templates of its own, and no more');
  eq((await call('cmSaveTemplate', 'boss', { id: 'bulk00', name: 'Bulk renamed', kind: 'runner', subject: 's', body: 'b' }, EVG)).tpl.name, 'Bulk renamed', 'K4 a template that is there can still be changed when the race is full');
  eq((await call('cmSaveTemplate', 'boss', { id: 'kit', name: 'Kit', kind: 'runner', subject: 's', body: 'b' }, EVG)).tpl.id, 'kit', 'K4 a starter can still be edited when the race is full');
  eq((await call('cmSaveTemplate', 'boss', { id: 'bulk40', name: 'Bulk', kind: 'runner', subject: 's', body: 'b' })).tpl.id, 'bulk40', 'K4 the limit is for each race');
}

/* ---------- K5 previews ---------- */
{
  const p = await call('cmPreview', 'boss', { tplId: 'kit' });
  eq([p.sample, p.noLink, p.nvars], [{ name: 'Sample Runner', bib: '', fake: true }, false, 6], 'K5 with no audience the preview uses a made-up runner');
  ok(p.subject === 'Your race kit for Comms Run A' && p.paras[0] === 'Hello Sample,' && p.paras[1].includes('bib 123, T-shirt size M') && p.paras[2] === 'Collection details: https://www.vtra.run/vhm', 'K5 the message is filled in from the race and the runner');
  eq(p.whatsapp, '*' + p.subject + '*\n\n' + p.paras.join('\n\n'), 'K5 the same message for a chat: the subject in bold, then the text');
  const a = await call('cmPreview', 'boss', { tplId: 'bib', aud: AUD });
  eq([a.sample, a.subject], [{ name: 'Asha Rao', bib: '101', fake: false }, 'Bib 101 for Comms Run A'], 'K5 with an audience the preview is the first person in it (bib order)');
  eq(a.paras, ['Hi Asha, your bib is 101.', 'See you at Beach Road b.'], 'K5 their name, their bib, the race; angle brackets are gone');
  const w = await call('cmPreview', 'lead1', { tpl: { kind: 'runner', subject: 'Wave {wave} at {start}', body: 'Corral {corral}. Time {time}, place {place}.' }, aud: { who: 'runners', cat: '21 K' } });
  const first = boardOf('201');
  eq([w.sample.bib, w.subject, w.paras[0]], ['201', 'Wave Elite at 05:30', 'Corral ' + DASH + '. Time ' + first.time + ', place ' + ORD(first.place) + '.'], 'K5 a lead may preview a message being typed; waves, results and a blank corral are read');
  const v = await call('cmPreview', 'boss', { tplId: 'volunteer', aud: { who: 'volunteers', vstatus: 'approved' } });
  eq([v.sample, v.subject], [{ name: 'Vol Four', bib: '', fake: false }, 'Thank you for volunteering at Comms Run A'], 'K5 a message to volunteers is made for the first volunteer (by name)');
  const none = await call('cmPreview', 'boss', { tplId: 'volunteer', aud: { who: 'volunteers', vstatus: 'reserve' } });
  eq([none.sample.fake, none.sample.name, none.paras[0]], [true, 'Sample Volunteer', 'Hello Sample,'], 'K5 an audience with nobody in it falls back to a made-up person');
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { link: '' }));
  eq((await call('cmPreview', 'boss', { tplId: 'kit' })).noLink, true, 'K5 a template that uses the race link says so when the race has none');
  await call('cmSaveSettings', 'boss', SET1);
  await refused(call('cmPreview', 'boss', { tplId: 'volunteer', aud: AUD }), 'template_mismatch', 'K5 a volunteer message cannot be previewed for runners');
  await refused(call('cmPreview', 'boss', { tplId: 'bib', aud: { who: 'volunteers' } }), 'template_mismatch', 'K5 nor a runner message for volunteers');
  await refused(call('cmPreview', 'boss', {}), 'bad_template', 'K5 no template is refused');
  await refused(call('cmPreview', 'boss', { tplId: 'bib', tpl: { kind: 'runner', subject: 's', body: 'b' } }), 'bad_template', 'K5 a saved template and a typed one together are refused');
  await refused(call('cmPreview', 'boss', { tplId: 'nosuch' }), 'no_template', 'K5 a template that is not there is refused');
  for (const bad of [5, ['bib'], {}, 'a~b', 'a']) await refused(call('cmPreview', 'boss', { tplId: bad }), 'bad_template', 'K5 a template id that is not an id is refused: ' + JSON.stringify(bad));
  for (const bad of ['x', 5, [], null]) await refused(call('cmPreview', 'boss', { tpl: bad }), 'bad_template', 'K5 a typed template that is not an object is refused: ' + JSON.stringify(bad));
  await refused(call('cmPreview', 'boss', { tpl: { kind: 'runner', subject: 'Hi {nmae}', body: 'b' } }), 'unknown_placeholder', 'K5 a typed template with a placeholder that does not exist is refused');
  await refused(call('cmPreview', 'boss', { tplId: 'bib', aud: { who: 'runners', pay: 'maybe' } }), 'bad_audience', 'K5 an audience that is wrong is refused');
  const rw = await call('cmPreview', 'boss', { tplId: 'raceweek', aud: { who: 'runners', cat: '10 K' } });
  const corral = (ASG.get(regId(EVA, '101')) || {}).corral;
  eq([rw.sample.bib, rw.paras[2]], ['101', 'Your bib: 101 (10 K)\nWave: Wave 1\nStart time: 06:00\nCorral: ' + (corral || DASH)], 'K5 the race-week message holds the runner\'s own wave, start time and corral');
  noLeak([p, a, w, v, none, rw], 'K5 no preview holds an e-mail address or phone number');
  const big = await call('cmPreview', 'boss', { tpl: { kind: 'runner', subject: 'S', body: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n\n') } });
  eq([big.paras.length, big.joined, big.paras[5]], [6, 2, 'f\n\ng\n\nh'], 'K5 a message with more paragraphs than the e-mail has places for says how many were joined');
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { nvars: 3 }));
  eq((await call('cmPreview', 'boss', { tpl: { kind: 'runner', subject: 'S', body: 'a\n\nb\n\nc\n\nd' } })).paras, ['a', 'b', 'c\n\nd'], 'K5 the number of paragraphs follows the setting');
  await call('cmSaveSettings', 'boss', SET1);
  const longBody = await call('cmPreview', 'boss', { tpl: { kind: 'runner', subject: 'S', body: 'x'.repeat(1500) } });
  eq([longBody.cut, longBody.paras[0].length <= 1200], [true, true], 'K5 a paragraph that is too long for the e-mail is cut and the preview says so');
  ok(rows('RDComms').filter((r) => ['rcp', 'bat', 'mem', 'tst'].includes(r.kind)).length === 0, 'K5 previewing writes no batch, no log and no test');
}

/* ---------- K6 who a message reaches ---------- */
{
  const aud = (o, tpl) => call('cmAudience', 'boss', Object.assign({ aud: Object.assign({}, AUD, o) }, tpl || {}));
  const a = await aud({});
  eq([a.label, a.total, a.withEmail, a.withPhone, a.sample.length], ['Runners' + DOT + 'paid', 12, 10, 10, 8], 'K6 paid runners: twelve, ten with an e-mail address, ten with a number WhatsApp can open');
  eq(a.sample[0], { name: 'Asha Rao', bib: '101', cat: '10 K', email: true, phone: true }, 'K6 a few names, with only whether they can be reached');
  eq(a.sample.map((x) => x.bib), ['101', '102', '103', '104', '105', '106', '201', '202'], 'K6 in bib order');
  eq(Object.keys(a.sample[3]).sort(), ['bib', 'cat', 'email', 'name', 'phone'], 'K6 a sample holds five things and no address or number');
  eq([a.sample[3].email, a.sample[4].email, a.sample[4].phone, a.sample[7].phone], [false, false, false, false], 'K6 an empty address, a wrong one, no number and a landline are "not reachable"');
  eq(a.sample[5].name, 'img src=x onerror=1Eve', 'K6 a name comes back as one clean line: the angle brackets are taken out, so it can never be markup, and the screen shows it as text besides');
  noLeak(a, 'K6 no answer holds an e-mail address or phone number');
  const n = async (o) => (await aud(o)).total;
  eq([await n({ pay: 'unpaid' }), await n({ pay: 'all' }), await n({ cat: '10k' }), await n({ cat: '21 K' }), await n({ bib: 'has' }), await n({ bib: 'none' })], [1, 13, 7, 5, 11, 1], 'K6 paid or not, a category (any spelling), with a bib or without one');
  eq([await n({ result: 'fin' }), await n({ result: 'dnf' }), await n({ result: 'dns' }), await n({ result: 'dsq' }), await n({ result: 'none' })], [8, 1, 1, 0, 2], 'K6 by result: eight finished, one DNF, one DNS, none disqualified, two with no result');
  const paidIds = rows('RDRegs').filter((r) => r.event === EVA && r.status === 'ok').map((r) => r._id);
  const inWave = paidIds.filter((i) => ASG.has(i)).length;
  eq([await n({ wave: 'has' }), await n({ wave: 'none' })], [inWave, 12 - inWave], 'K6 in a wave, or not');
  eq(await n({ cat: '21 K', bib: 'has', result: 'fin' }), 4, 'K6 several choices together');
  eq([(await aud({ cat: '10k', bib: 'none' })).label, (await aud({ pay: 'all', result: 'none', wave: 'has' })).label, (await aud({ pay: 'unpaid' })).label], ['Runners' + DOT + 'paid' + DOT + '10 K' + DOT + 'without a bib', 'Runners' + DOT + 'paid and unpaid' + DOT + 'no result yet' + DOT + 'in a wave', 'Runners' + DOT + 'not paid'], 'K6 the audience in words');
  const vv = (o) => call('cmAudience', 'boss', { aud: Object.assign({ who: 'volunteers' }, o) });
  eq([(await vv({})).total, (await vv({ vstatus: 'approved' })).total, (await vv({ vstatus: 'applied' })).total, (await vv({ vstatus: 'declined' })).total, (await vv({ vstatus: 'reserve' })).total, (await vv({})).withEmail, (await vv({})).withPhone], [4, 2, 1, 1, 0, 3, 4], 'K6 volunteers: all, by status, and how many can be reached');
  eq((await vv({ vstatus: 'approved' })).label, 'Volunteers' + DOT + 'approved', 'K6 and in words');
  // what a template needs that some people do not have
  const rwTpl = L.STARTERS.find((s) => s.id === 'raceweek');
  const paidRegs = rows('RDRegs').filter((r) => r.event === EVA && r.status === 'ok');
  const lack = { bib: (r) => !r.bib, cat: (r) => !r.cat, wave: (r) => !ASG.has(r._id), start: (r) => !ASG.has(r._id), corral: (r) => !(ASG.get(r._id) && ASG.get(r._id).corral) };
  const want = {};
  for (const k of L.needsOf(rwTpl).used) if (lack[k]) {
    const c = paidRegs.filter(lack[k]).length;
    if (c) want[k] = c;
  }
  const rw = await aud({}, { tplId: 'raceweek' });
  eq(rw.missing, want, 'K6 for a template that uses waves the answer says how many have no bib, wave, start time or corral');
  eq(want, { bib: 1, corral: 5 }, 'K6 control: one runner has no bib (Nina) and the five of the 21 K, whose wave has no corrals, have no corral; everybody is in a wave');
  eq((await aud({}, { tplId: 'bib' })).missing, { bib: 1 }, 'K6 a template that only uses the bib misses one: the runner with no bib');
  eq((await aud({}, { tplId: 'thanks' })).missing, { time: 4, place: 4 }, 'K6 for a results template the four paid runners with no finish (a DNF, a DNS, one with no result, one with no bib) are counted');
  eq((await aud({}, { tpl: { kind: 'runner', subject: 'Hi {name}', body: 'x' } })).missing, {}, 'K6 a template typed now is checked the same way');
  eq((await aud({})).missing, {}, 'K6 with no template there is nothing to miss');
  await refused(aud({}, { tplId: 'volunteer' }), 'template_mismatch', 'K6 a template for volunteers cannot go with runners');
  const BADA = [{ who: 'x' }, { who: 'runners', pay: 'maybe' }, { who: 'runners', cat: 'ZZ' }, { who: 'runners', cat: 5 }, { who: 'runners', bib: 'yes' }, { who: 'runners', result: 'win' }, { who: 'runners', vstatus: 'approved' }, { who: 'volunteers', pay: 'paid' }, { who: 'volunteers', vstatus: 'x' }, { who: 'runners', notSent: 'other' }, { who: 'runners', foo: 1 }, {}, null, 'runners', 5, []];
  for (const bad of BADA) await refused(call('cmAudience', 'boss', { aud: bad }), 'bad_audience', 'K6 a wrong audience is refused: ' + JSON.stringify(bad));
  await refused(call('cmAudience', 'boss', {}), 'bad_audience', 'K6 no audience is refused');
  eq((await call('cmAudience', 'lead1', { aud: AUD })).total, 12, 'K6 a lead may look');
  eq((await call('cmAudience', 'boss', { aud: AUD }, EVB)).total, 1, 'K6 another race has its own people');
  await refused(call('cmAudience', 'boss', { aud: { who: 'runners', cat: '21 K' } }, EVB), 'bad_audience', 'K6 a category the other race does not have is refused there');
  ok(rows('RDComms').filter((r) => ['rcp', 'bat', 'mem', 'tst'].includes(r.kind)).length === 0, 'K6 asking writes nothing');
}

/* ---------- K7 preparing a batch ---------- */
{
  const pre = (o) => call('cmPrepare', 'boss', Object.assign({ key: B1, tplId: 'bib', aud: AUD, via: 'email' }, o || {}));
  const before = snap();
  const BAD = [[{ key: 'short' }, 'bad_batch'], [{ key: 5 }, 'bad_batch'], [{ key: 'has space1' }, 'bad_batch'], [{ key: 'a'.repeat(41) }, 'bad_batch'], [{ via: 'sms' }, 'bad_via'], [{ via: undefined }, 'bad_via'], [{ tplId: 'nosuch' }, 'no_template'], [{ tplId: 5 }, 'bad_template'], [{ aud: { who: 'runners', pay: 'x' } }, 'bad_audience'], [{ aud: undefined }, 'bad_audience'], [{ tplId: 'volunteer' }, 'template_mismatch'], [{ aud: { who: 'runners', pay: 'unpaid', cat: '21 K' } }, 'empty_audience'], [{ aud: { who: 'runners', result: 'dsq' } }, 'empty_audience'], [{ aud: { who: 'volunteers', vstatus: 'reserve' }, tplId: 'volunteer' }, 'empty_audience']];
  for (const [o, code] of BAD) await refused(pre(o), code, 'K7 a wrong request is refused (' + code + '): ' + JSON.stringify(o).slice(0, 80));
  ok(snap() === before, 'K7 a refused request writes nothing');
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { link: '' }));
  await refused(pre({ tplId: 'kit' }), 'no_link', 'K7 a template that uses the race link cannot be sent while the race has no link');
  await call('cmSaveSettings', 'boss', SET1);
  await call('cmSaveTemplate', 'boss', { id: 'old1', name: 'Old', kind: 'runner', subject: 's', body: 'b', archived: true });
  await refused(pre({ tplId: 'old1' }), 'template_archived', 'K7 an archived template cannot be sent');
  const r = await pre();
  eq([r.batch, r.total, r.noContact, r.via, r.label, r.again], [B1, 10, 2, 'email', 'Runners' + DOT + 'paid', undefined], 'K7 a batch: ten paid runners with a plain e-mail address; two have none and are left out');
  const bat = rows('RDComms').find((x) => x._id === 'bat~' + EVA + '~' + B1);
  const info = JSON.parse(bat.json);
  ok(bat.kind === 'bat' && bat.event === EVA && bat.ref === B1 && bat.sub === 'email' && bat.by === 'boss' && info.tpl === 'bib' && info.total === 10 && info.subject === 'Bib {bib} for {race}' && info.aud.who === 'runners', 'K7 the batch is one row: what it says (the template as it was), who it is for and how many');
  const mem = rows('RDComms').filter((x) => x.kind === 'mem' && x.ref === B1);
  eq(mem.map((m) => m._id), ['mem~' + EVA + '~' + B1 + '~0'], 'K7 the people are kept as a list of ids, in one row for up to 500');
  eq(JSON.parse(mem[0].json).ids, ['101', '102', '103', '106', '201', '202', '203', '301', '302', 'nina'].map((k) => regId(EVA, k)), 'K7 in bib order, the one with no bib last; the runners with no usable address are not in it');
  ok(!/@|98123|Asha|Rao/.test(mem[0].json + bat.json), 'K7 the rows hold no name, address or number');
  const again = await pre();
  eq([again.again, again.total, again.noContact], [true, 10, 2], 'K7 asking again with the same key and choices gives the batch that is there');
  const s1 = snap();
  await pre();
  ok(snap() === s1, 'K7 and writes nothing');
  await refused(pre({ tplId: 'kit' }), 'key_in_use', 'K7 the same key with another template is refused');
  await refused(pre({ aud: { who: 'runners', cat: '10 K' } }), 'key_in_use', 'K7 the same key with another audience is refused');
  await refused(pre({ via: 'whatsapp' }), 'key_in_use', 'K7 the same key with another channel is refused');
  ok(rows('RDAudit').some((a) => a.action === 'e-mail batch prepared' && a.by === 'boss' && a.detail === 'Runners' + DOT + 'paid: 10 people, "Your bib (VTRA)"') && rows('RDAudit').filter((a) => a.action === 'e-mail batch prepared').length === 1, 'K7 preparing is in the audit log once, with the audience, the number and the template (no name, no address)');
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { emailId: '' }));
  await refused(pre({ key: K() }), 'no_email_id', 'K7 without a Wix e-mail named nothing is prepared');
  eq((await call('cmPrepare', 'boss', { key: K(), tplId: 'bib', aud: AUD, via: 'whatsapp' })).total, 10, 'K7 for WhatsApp no Wix e-mail is needed, and the people are those with a number it can open (ten; the other two have none)');
  await call('cmSaveSettings', 'boss', SET1);
  await refused(call('cmPrepare', 'dir2', { key: K(), tplId: 'volunteer', aud: { who: 'volunteers', vstatus: 'applied' }, via: 'email' }), 'empty_audience', 'K7 the one volunteer who is waiting has no address: nobody to e-mail');
  const vb = await call('cmPrepare', 'dir2', { key: VB, tplId: 'volunteer', aud: { who: 'volunteers', vstatus: 'applied' }, via: 'whatsapp' });
  eq([vb.total, vb.noContact], [1, 0], 'K7 but by WhatsApp there is one');
}

/* ---------- K8 sending ---------- */
{
  crmReset();
  // two contacts exist already: Bina (written in capitals in the registration) and Chitra, who has unsubscribed
  CRM.contacts.set('pre1', { _id: 'pre1', info: { name: { first: 'Bina' }, emails: [{ email: 'Bina@Example.com' }], extendedFields: { 'emailSubscriptions.subscriptionStatus': 'SUBSCRIBED' } } });
  CRM.contacts.set('pre2', UNSUB('Chitra', 'chitra@example.com'));
  for (const bad of ['x', -1, 1.5, '5']) await refused(call('cmSend', 'boss', { batch: B1, from: bad }), 'bad_from', 'K8 a position that is not a whole number of at least 0 is refused: ' + JSON.stringify(bad));
  await refused(call('cmSend', 'boss', { batch: 'nosuchbatch1' }), 'no_batch', 'K8 a batch that is not there is refused');
  await refused(call('cmSend', 'boss', { batch: 'short' }), 'bad_batch', 'K8 a key that is not a key is refused');
  await refused(call('cmSend', 'boss', { batch: B1 + 'x' }), 'no_batch', 'K8 a key that is almost right is refused');
  ok(!CRM.sent.length && !CRM.calls.length && !logOf(B1).length, 'K8 control: so far nothing was sent, no contact was looked at and nothing is logged');
  const t = await sendAll(B1);
  eq([t.sent, t.skipped, t.failed, t.busy, t.last.next, t.last.total, t.calls], [9, 1, 0, 0, null, 10, 1], 'K8 ten people go out in one call: nine e-mails sent, one left out because that person has unsubscribed');
  eq(CRM.sent.length, 9, 'K8 Wix was asked for nine e-mails');
  ok(CRM.sent.every((s) => s.emailId === 'vtra_mail' && Object.keys(s.variables).join() === 'subject,p1,p2,p3,p4,p5,p6' && Object.values(s.variables).every((v) => typeof v === 'string')), 'K8 each is the one Wix e-mail with a subject and six paragraphs, all text');
  const bySubject = (bib) => CRM.sent.find((s) => s.variables.subject === 'Bib ' + bib + ' for Comms Run A');
  const asha = bySubject('101');
  eq([asha.variables.subject, par(1, asha), par(2, asha), par(3, asha), par(4, asha)], ['Bib 101 for Comms Run A', 'Hi Asha, your bib is 101.', 'See you at Beach Road b.', L.NBSP, L.NBSP], 'K8 a message is made for the person: their name and bib, the race, the venue; places that are not used are blank');
  eq(par(1, bySubject('102')), 'Hi Bina, your bib is 102.', 'K8 a name typed in capitals is written as a name');
  ok(!bySubject('103'), 'K8 the one who unsubscribed is not sent to');
  ok(CRM.sent.every((s) => !/[<>]/.test(JSON.stringify(s.variables))), 'K8 no tag, not even from a name that is one, reaches an e-mail');
  eq(par(1, bySubject('106')), 'Hi img, your bib is 106.', 'K8 a runner who typed a tag as a name is greeted with the word that is left');
  const creates = CRM.calls.filter((c) => c.fn === 'create');
  const names = creates.map((c) => c.opts.info.name);
  ok(names.some((x) => x.first === 'Asha' && x.last === 'Rao') && names.some((x) => x.first === 'Indu') && creates.every((c) => c.opts.suppressAuth === true && c.opts.allowDuplicates === false), 'K8 a contact is made for an address Wix does not know (with the name; never allowing a copy; with the right to do so)');
  ok(names.every((x) => !/^[=+\-@]/.test(x.first) && !/^[=+\-@]/.test(x.last || '')), 'K8 a contact is never given a name that starts like a formula');
  ok(CRM.calls.filter((c) => c.fn === 'query').every((c) => c.opts.suppressAuth === true), 'K8 every look at the contacts is made with the right to');
  eq(CRM.contacts.size, 9, 'K8 two contacts were there already and seven were made: nine in all (two runners share an address)');
  ok(creates.length >= 7 && creates.length <= 8, 'K8 seven contacts were made (an eighth try, at the same moment, for the shared address, found the contact that was just made: ' + creates.length + ' tries)');
  const indu = CRM.sent.filter((s) => s.variables.subject === 'Bib 201 for Comms Run A' || s.variables.subject === 'Bib 203 for Comms Run A');
  ok(indu.length === 2 && indu[0].contactId === indu[1].contactId, 'K8 two runners who share an address both get their e-mail, to the same contact');
  const log = logOf(B1);
  eq([log.length, log.filter((x) => x.status === 'sent').length, log.filter((x) => x.status === 'skipped').length, log.find((x) => x.status === 'skipped').why], [10, 9, 1, 'unsubscribed'], 'K8 the log has a row for each of the ten');
  ok(log.every((x) => x._id === 'rcp~' + B1 + '~' + x.who && x.event === EVA && x.sub === 'bib' && x.by === 'boss' && x.json === '') && !/@|98123|Asha|Rao|Hi |bib is/.test(JSON.stringify(log)), 'K8 a log row is the batch, the person\'s id, the template, the state and who pressed Send: no name, address, number or message');
  ok(rows('RDAudit').some((a) => a.action === 'e-mail sending started') && rows('RDAudit').some((a) => a.action === 'e-mail sending finished'), 'K8 the start and the end of a send are in the audit log');
  noLeak(rows('RDAudit'), 'K8 and the audit log holds no address or number');
  // again: nobody is sent to twice
  const t2 = await sendAll(B1);
  eq([t2.sent, t2.busy, t2.skipped, t2.failed, CRM.sent.length], [0, 10, 0, 0, 9], 'K8 pressing Send again sends nothing: all ten are busy or done');
  eq((await sendAll(B1, 5)).sent, 0, 'K8 nor from the middle');
  eq((await call('cmSend', 'boss', { batch: B1, from: 10 })).next, null, 'K8 a position past the end does nothing');
  eq((await call('cmSend', 'boss', { batch: B1, from: 1000000 })).sent, 0, 'K8 nor a position far past it');
  eq((await call('cmSend', 'boss', { batch: B1, from: null })).busy, 10, 'K8 no position means the start');
  await refused(call('cmSend', 'boss', { batch: B1, from: 1000001 }), 'bad_from', 'K8 a position that is too big is refused');
  // someone registers after the batch was made: not in it, and a "not yet sent" audience finds them
  await reg(EVA, { bib: '999', name: 'Late Larry', cat: '10 K', email: 'larry@example.com', phone: '9812300998', size: 'M' });
  eq((await call('cmSend', 'boss', { batch: B1 })).sent, 0, 'K8 a runner who registers after a batch is made is not in it');
  const rest = await call('cmAudience', 'boss', { aud: { who: 'runners', notSent: 'bib' }, tplId: 'bib' });
  eq([rest.total, rest.label], [4, 'Runners' + DOT + 'paid' + DOT + 'not yet sent "Your bib (VTRA)"'], 'K8 "not yet sent" leaves out the nine who have had it: Chitra (who unsubscribed), the two with no address and the one who registered late are left');
  eq(rest.sentBefore, undefined, 'K8 control: "how many have had it" is only given when the audience does not already leave them out');
  DB.RDRegs.delete(regId(EVA, '999'));
  const sb = await call('cmAudience', 'boss', { aud: AUD, tplId: 'bib' });
  eq(sb.sentBefore, 9, 'K8 the audience says how many have had the template already');
  noLeak([rest, sb], 'K8 neither holds an address or number');
}
{
  // two screens at once: each person once
  crmReset();
  CRM.contacts.set('pre2', UNSUB('Chitra', 'chitra@example.com'));
  const B2 = K();
  const p = await call('cmPrepare', 'boss', { key: B2, tplId: 'kit', aud: AUD, via: 'email' });
  eq(p.total, 10, 'K8 a second batch, with the kit message');
  CRM.delay = 2;
  const [x, y, z] = await Promise.all([call('cmSend', 'boss', { batch: B2 }), call('cmSend', 'dir2', { batch: B2 }), call('cmSend', 'boss', { batch: B2 })]);
  CRM.delay = 0;
  eq([x.sent + y.sent + z.sent, x.busy + y.busy + z.busy, x.skipped + y.skipped + z.skipped], [9, 20, 1], 'K8 three presses at the same moment: nine e-mails go out, one person is left out, and each of the others was busy for two of the three');
  const bibs = CRM.sent.map(bibOf);
  eq([CRM.sent.length, new Set(bibs).size, logOf(B2).length], [9, 9, 10], 'K8 each of the nine got exactly one e-mail, and each has one log row');
  ok(logOf(B2).every((l) => ['boss', 'dir2'].includes(l.by)), 'K8 the log says which director\'s press sent each one');
}
{
  // a person whose address has gone, one who was removed
  crmReset();
  const B3 = K();
  await call('cmPrepare', 'boss', { key: B3, tplId: 'bib', aud: { who: 'runners', cat: '21 K' }, via: 'email' });
  const r = rows('RDRegs').find((x) => x._id === regId(EVA, '201'));
  const r2 = rows('RDRegs').find((x) => x._id === regId(EVA, '202'));
  await wd.update('RDRegs', Object.assign({}, r, { email: '' }), SA);
  DB.RDRegs.delete(regId(EVA, '202'));
  const t = await sendAll(B3);
  eq([t.sent, t.skipped], [3, 2], 'K8 a person whose address has gone, and one who was removed, are left out; the other three are sent to');
  eq(logOf(B3).filter((l) => l.status === 'skipped').map((l) => l.why).sort(), ['no_email', 'person_removed'], 'K8 the log says why');
  await wd.update('RDRegs', r, SA);
  await wd.insert('RDRegs', r2, SA);
}
{
  // Wix refuses one e-mail: it is logged as failed, with a reason that holds no address; the rest go out
  crmReset();
  const B4 = K();
  const p = await call('cmPrepare', 'boss', { key: B4, tplId: 'thanks', aud: { who: 'runners', result: 'fin' }, via: 'email' });
  eq(p.total, 8, 'K8 a thank-you batch for the eight who finished');
  CRM.contacts.set('pre2', UNSUB('Chitra', 'chitra@example.com'));
  CRM.fail.email = (id, cid) => {
    if (CRM.contacts.get(cid).info.emails[0].email === 'jai@example.com') throw new Error('Wix said no for jai@example.com, code 12345678 "quoted"');
  };
  const t = await sendAll(B4);
  eq([t.sent, t.failed, t.skipped, t.stopped], [6, 1, 1, false], 'K8 six e-mails go out; one fails and is logged; one person has unsubscribed');
  const fl = logOf(B4).find((l) => l.status === 'failed');
  eq([fl.who, fl.why], [regId(EVA, '202'), 'Wix said no for [address], code # quoted'], 'K8 the failure is logged against the person with a reason that has no address, long number or quote in it');
  const asha = CRM.sent.find((s) => s.variables.subject === 'Thank you for running Comms Run A' && par(3, s).includes('Your time: ' + boardOf('101').time + '\n'));
  ok(asha && par(3, asha) === 'Your time: ' + boardOf('101').time + '\nPlace in 10 K: ' + ORD(boardOf('101').place) && par(4, asha) === 'Full results: ' + SET1.link && par(1, asha) === 'Hello Asha,', 'K8 a results message holds the runner\'s own time and place, and the race link');
  crmReset();
  CRM.contacts.set('pre2', UNSUB('Chitra', 'chitra@example.com'));
  // a new batch of "not yet sent" reaches the failed one and the one who had unsubscribed, and nobody else
  const B5 = K();
  const q = await call('cmPrepare', 'boss', { key: B5, tplId: 'thanks', aud: { who: 'runners', result: 'fin', notSent: 'thanks' }, via: 'email' });
  eq(q.total, 2, 'K8 a new batch of "not yet sent" is the failed one and the one who unsubscribed');
  const t2 = await sendAll(B5);
  eq([t2.sent, t2.skipped, CRM.sent.length, par(1, CRM.sent[0])], [1, 1, 1, 'Hello Jai,'], 'K8 the one that failed is sent now, and nobody who had it is sent a second time');
  const after = await call('cmAudience', 'boss', { aud: { who: 'runners', result: 'fin', notSent: 'thanks' }, tplId: 'thanks' });
  eq(after.total, 1, 'K8 and only the one who unsubscribed is left');
}
{
  // Wix refuses everything (the e-mail is named wrongly): the call stops after a few and says so
  crmReset();
  const B6 = K();
  await call('cmPrepare', 'boss', { key: B6, tplId: 'kit', aud: AUD, via: 'email' });
  CRM.fail.email = () => {
    throw new Error('Triggered email not found');
  };
  const r = await call('cmSend', 'boss', { batch: B6 });
  ok(r.stopped === true && r.failed >= 3 && r.failed <= 8 && r.sent === 0 && r.next !== null && r.next === logOf(B6).length && r.next === r.failed, 'K8 when nothing is accepted the call stops after the first few (' + r.failed + ' failed of 10), says so and says where to go on from');
  CRM.fail = {};
  const bt = await call('cmBatch', 'boss', { batch: B6 });
  eq([bt.counts.failed, bt.resume], [r.failed, r.failed], 'K8 the batch report says where it stopped');
  const t = await sendAll(B6, bt.resume);
  eq([t.sent, t.stopped], [bt.total - r.failed, false], 'K8 once Wix is right again the rest goes out from there');
  const bt2 = await call('cmBatch', 'boss', { batch: B6 });
  eq([bt2.counts.sent, bt2.counts.failed, bt2.counts.waiting, bt2.resume], [bt.total - r.failed, r.failed, 0, null], 'K8 the ones that failed stay failed in this batch (a new "not yet sent" batch reaches them)');
}
{
  // a call that runs out of time stops starting people and says where to go on
  crmReset();
  const B7 = K();
  await call('cmPrepare', 'boss', { key: B7, tplId: 'kit', aud: AUD, via: 'email' });
  CRM.fail.email = () => {
    skew += 4000;
  };
  const r = await call('cmSend', 'boss', { batch: B7 });
  ok(r.next !== null && r.next === logOf(B7).length && r.sent >= 5 && r.sent < 10 && !r.stopped, 'K8 a call that runs out of time stops starting new people (' + r.sent + ' of 10 sent) and says where to go on from');
  CRM.fail = {};
  const t = await sendAll(B7, r.next);
  const log = logOf(B7);
  eq([r.sent + t.sent, log.length, log.filter((l) => l.status === 'sent').length, new Set(CRM.sent.map(bibOf)).size], [10, 10, 10, 10], 'K8 and the rest goes out from there: ten people, ten e-mails, each once');
}
{
  // the row is there before the e-mail goes out; a call that dies after the e-mail leaves the person as "unsure", never sent again
  crmReset();
  const BC = K();
  await call('cmPrepare', 'boss', { key: BC, tplId: 'thanks', aud: { who: 'runners', cat: '21 K', result: 'fin' }, via: 'email' });
  const seen = [];
  CRM.fail.email = () => {
    seen.push(logOf(BC).filter((l) => l.status === 'sending').length);
  };
  const upd = wd.update;
  let boom = 0;
  wd.update = (col, row, o) => (col === 'RDComms' && row && row.kind === 'rcp' && row.status === 'sent' && !boom++ ? Promise.reject(new Error('db down')) : upd.call(wd, col, row, o));
  const r = await call('cmSend', 'boss', { batch: BC });
  wd.update = upd;
  CRM.fail = {};
  eq([r.sent, CRM.sent.length, seen.length, seen.every((n) => n >= 1)], [4, 4, 4, true], 'K8 every e-mail goes out only after its log row is there (the row says "sending" at that moment)');
  const bt = await call('cmBatch', 'boss', { batch: BC });
  eq([bt.counts.sending, bt.counts.sent, bt.problems.map((x) => x.status)], [1, 3, ['sending']], 'K8 a call that dies after an e-mail leaves one row "sending": the report shows that person as unsure');
  const again = await sendAll(BC);
  eq([again.sent, again.busy, CRM.sent.length], [0, 4, 4], 'K8 pressing Send again sends nobody a second time, not even the unsure one');
}
{
  // a contact that someone else makes between the look and the create
  crmReset();
  const B8 = K();
  await call('cmPrepare', 'boss', { key: B8, tplId: 'bib', aud: { who: 'runners', cat: '21 K' }, via: 'email' });
  let made = 0;
  CRM.fail.create = (info) => {
    if (info.emails[0].email === 'f@example.com' && !made) {
      made++;
      CRM.contacts.set('race1', { _id: 'race1', info: { name: { first: 'F' }, emails: [{ email: 'f@example.com' }], extendedFields: { 'emailSubscriptions.subscriptionStatus': 'NOT_SET' } } });
      throw new Error('duplicate_contact');
    }
  };
  const t = await sendAll(B8);
  eq([t.sent, t.failed, made], [5, 0, 1], 'K8 when a contact for an address is made by someone else between the look and the create, the one that is there is used');
  ok(CRM.sent.find((s) => s.contactId === 'race1').variables.subject.startsWith('Bib 301'), 'K8 and it is that runner\'s e-mail that goes to it');
}
{
  // no e-mail named: nothing is claimed; a WhatsApp batch is not sent by e-mail; a lead cannot send; paragraphs follow the setting
  crmReset();
  const B9 = K();
  await call('cmPrepare', 'boss', { key: B9, tplId: 'bib', aud: { who: 'runners', cat: '21 K' }, via: 'email' });
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { emailId: '' }));
  await refused(call('cmSend', 'boss', { batch: B9 }), 'no_email_id', 'K8 with no Wix e-mail named a send is refused');
  ok(!logOf(B9).length && !CRM.calls.length, 'K8 and nobody is claimed and Wix is not asked anything');
  await call('cmSaveSettings', 'boss', SET1);
  const W = K();
  await call('cmPrepare', 'boss', { key: W, tplId: 'bib', aud: { who: 'runners', cat: '21 K' }, via: 'whatsapp' });
  await refused(call('cmSend', 'boss', { batch: W }), 'wrong_channel', 'K8 a WhatsApp batch cannot be sent as e-mail');
  await refused(call('cmSend', 'lead1', { batch: B9 }), 'director_only', 'K8 a lead cannot send');
  eq((await call('cmSend', 'boss', { batch: B9 })).sent, 5, 'K8 control: the same batch goes out for a director (all five have an address)');
  crmReset();
  const B10 = K();
  await call('cmPrepare', 'boss', { key: B10, tplId: 'raceweek', aud: { who: 'runners', cat: '21 K' }, via: 'email' });
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { nvars: 3 }));
  await call('cmSend', 'boss', { batch: B10 });
  ok(CRM.sent.length === 5 && CRM.sent.every((s) => Object.keys(s.variables).join() === 'subject,p1,p2,p3'), 'K8 the number of paragraphs is the setting at the moment of sending');
  const e201 = CRM.sent.find((s) => par(1, s) === 'Hello Indu,');
  eq([e201.variables.subject, par(2, e201), par(3, e201)], ['Comms Run A: your start details', 'Comms Run A is on ' + LONG + ' at Beach Road b.', 'Your bib: 201 (21 K)\nWave: Elite\nStart time: 05:30\nCorral: ' + DASH + '\n\nFull race information: ' + SET1.link], 'K8 the race-week message: the race, the date, the venue and the runner\'s own wave and start time; paragraphs beyond the setting are joined into the last one');
  await call('cmSaveSettings', 'boss', SET1);
}

/* ---------- K9 how a batch went ---------- */
{
  const b = await call('cmBatch', 'boss', { batch: B1 });
  eq([b.key, b.via, b.tpl, b.tplName, b.label, b.total, b.noContact, b.by], [B1, 'email', 'bib', 'Your bib (VTRA)', 'Runners' + DOT + 'paid', 10, 2, 'boss'], 'K9 a batch report says what the batch was');
  eq([b.counts, b.resume, b.moreProblems], [{ sent: 9, failed: 0, skipped: 1, sending: 0, waiting: 0 }, null, 0], 'K9 and how it went: nine sent, one left out, nothing waiting');
  eq(b.problems, [{ name: 'Chitra Devi', bib: '103', status: 'skipped', why: 'unsubscribed' }], 'K9 the people it did not reach, with name, bib and why (nothing else)');
  noLeak(b, 'K9 the report holds no address or number');
  eq((await call('cmBatch', 'lead1', { batch: B1 })).counts, b.counts, 'K9 a lead may look');
  // an unsure one: a row left as "sending"
  const row = rows('RDComms').find((x) => x._id === 'rcp~' + B1 + '~' + regId(EVA, '101'));
  await wd.update('RDComms', Object.assign({}, row, { status: 'sending' }), SA);
  const u = await call('cmBatch', 'boss', { batch: B1 });
  eq([u.counts.sending, u.counts.sent, u.problems.map((p) => p.status).sort()], [1, 8, ['sending', 'skipped']], 'K9 a person whose row was left "sending" (the call died) is shown as unsure');
  const sentTo = await call('cmAudience', 'boss', { aud: { who: 'runners', notSent: 'bib' }, tplId: 'bib' });
  const sentTo2 = await call('cmAudience', 'boss', { aud: { who: 'runners', notSent: 'bib', uncertain: true }, tplId: 'bib' });
  eq(sentTo2.total - sentTo.total, 1, 'K9 an unsure person counts as sent unless the audience says to count the unsure again');
  const before = CRM.sent.length;
  const e1 = await sendAll(B1);
  eq([e1.sent, CRM.sent.length - before], [0, 0], 'K9 an unsure person is never sent to again by the same batch');
  await wd.update('RDComms', row, SA);
  await refused(call('cmBatch', 'boss', { batch: B1 }, EVB), 'no_batch', 'K9 another race cannot see the batch');
  await refused(call('cmBatch', 'boss', { batch: 'nosuchbatch1' }), 'no_batch', 'K9 a batch that is not there is refused');
  await refused(call('cmBatch', 'boss', { batch: 5 }), 'bad_batch', 'K9 a key that is not a key is refused');
  await wd.insert('RDComms', { _id: 'bat~' + EVA + '~damaged0001', event: EVA, kind: 'bat', ref: 'damaged0001', sub: 'carrier-pigeon', who: '', status: '', why: '', json: '{"total":"x"}', by: 'x', at: 'x' }, SA);
  await refused(call('cmBatch', 'boss', { batch: 'damaged0001' }), 'no_batch', 'K9 a batch row with a channel that does not exist is refused');
  await wd.insert('RDComms', { _id: 'bat~' + EVA + '~damaged0002', event: EVA, kind: 'bat', ref: 'damaged0002', sub: 'email', who: '', status: '', why: '', json: '{"total":3,"tpl":"bib","aud":{"who":"runners"},"subject":"s","body":"b"}', by: 'x', at: 'x' }, SA);
  await refused(call('cmSend', 'boss', { batch: 'damaged0002' }), 'batch_damaged', 'K9 a batch whose list of people is missing is refused and sends nothing');
  ok(!logOf('damaged0002').length, 'K9 control: nothing was claimed');
  const o = await call('cmOverview', 'boss');
  ok(o.batches.length >= 8 && o.batches.length <= 20 && o.batches.every((x, i, l) => !i || l[i - 1].at >= x.at) && o.batches.every((x) => x.key && ['email', 'whatsapp'].includes(x.via) && typeof x.total === 'number'), 'K9 the overview lists the latest batches, newest first, and none with a channel that does not exist');
  ok(!o.batches.some((x) => x.key === 'damaged0001') && o.batches.some((x) => x.key === B1 && x.total === 10 && x.noContact === 2 && x.tplName === 'Your bib (VTRA)' && x.by === 'boss'), 'K9 a batch row that is damaged is left out of the list, and a real one shows its numbers');
  const bo = o.batches.find((x) => x.key === B1);
  eq(bo.aud, { who: 'runners', pay: 'paid', cat: '', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'K9 the overview gives each batch the choices it was prepared with, cleaned, so a screen can prepare a retry');
  await wd.insert('RDComms', { _id: 'bat~' + EVA + '~damaged0003', event: EVA, kind: 'bat', ref: 'damaged0003', sub: 'email', who: '', status: '', why: '', json: '{"total":3,"tpl":"bib","aud":{"who":"runners","cat":"No Such Category"},"subject":"s","body":"b"}', by: 'x', at: 'y' }, SA);
  const o9 = await call('cmOverview', 'boss');
  const dm = o9.batches.find((x) => x.key === 'damaged0003');
  ok(!!dm && dm.aud === null && o9.batches.find((x) => x.key === B1).aud !== null, 'K9 a batch whose choices no longer fit the race is still listed, with no choices, so no retry is offered for it');
  noLeak(o9, 'K9 the overview holds no address or number');
}

/* ---------- K10 a big batch ---------- */
{
  crmReset();
  for (let i = 0; i < 1203; i++) await reg(EVE, { bib: String(1001 + i), name: 'Runner ' + i, cat: '10 K', email: 'r' + i + '@example.com', phone: '98123' + String(i).padStart(5, '0'), size: 'M' });
  const BE = K();
  const p = await call('cmPrepare', 'boss', { key: BE, tplId: 'bib', aud: AUD, via: 'email' }, EVE);
  eq([p.total, p.noContact], [1203, 0], 'K10 a race with 1203 runners');
  eq(rows('RDComms').filter((x) => x.kind === 'mem' && x.ref === BE).map((m) => JSON.parse(m.json).ids.length), [500, 500, 203], 'K10 their ids are kept in three rows (500, 500, 203)');
  // a call that begins just before a row ends
  const mid = await call('cmSend', 'boss', { batch: BE, from: 490 }, EVE);
  eq([mid.sent, mid.next], [25, 515], 'K10 a call sends 25 people and says where to go on from');
  eq(CRM.sent.map((s) => s.variables.subject.replace(/\D+/g, '')).sort().join(), Array.from({ length: 25 }, (x, i) => String(1491 + i)).sort().join(), 'K10 from position 490 the 25 are the people from both sides of the row end (bibs 1491 to 1515)');
  // a stop at the start, then the rest
  CRM.fail.email = () => {
    throw new Error('Triggered email not found');
  };
  const f1 = await call('cmSend', 'boss', { batch: BE, from: 0 }, EVE);
  ok(f1.stopped === true && f1.failed >= 3 && f1.failed <= 8 && f1.next === f1.failed, 'K10 a stopped call (' + f1.failed + ' failed) on the big batch says where to go on from');
  CRM.fail = {};
  const bt = await call('cmBatch', 'boss', { batch: BE }, EVE);
  eq([bt.resume, bt.counts.failed, bt.counts.sent, bt.counts.waiting], [f1.failed, f1.failed, 25, 1203 - 25 - f1.failed], 'K10 the report: where to go on from (the first person without a row), how many failed and sent, how many wait');
  const t = await sendAll(BE, bt.resume, 'boss', EVE);
  eq([t.sent, t.busy, t.failed, t.stopped], [1203 - 25 - f1.failed, 25, 0, false], 'K10 the rest goes out in calls of 25; the 25 that had gone out already are busy, not sent again');
  eq([CRM.sent.length, new Set(CRM.sent.map((s) => s.variables.subject)).size], [1203 - f1.failed, 1203 - f1.failed], 'K10 every e-mail is different: nobody had two');
  const bt2 = await call('cmBatch', 'boss', { batch: BE }, EVE);
  eq([bt2.counts, bt2.resume, bt2.moreProblems, bt2.problems.length], [{ sent: 1203 - f1.failed, failed: f1.failed, skipped: 0, sending: 0, waiting: 0 }, null, 0, f1.failed], 'K10 at the end: everybody has a row, the few that failed are listed');
  // too many for one batch
  for (let i = 0; i < 5001; i++) await reg(EVF, { bib: String(1 + i), name: 'Runner ' + i, cat: '10 K', email: 's' + i + '@example.com', phone: '98123' + String(i).padStart(5, '0'), size: 'M' });
  const af = await call('cmAudience', 'boss', { aud: AUD }, EVF);
  eq([af.total, af.withEmail, af.sample.length], [5001, 5001, 8], 'K10 an audience can be counted at any size');
  await refused(call('cmPrepare', 'boss', { key: K(), tplId: 'bib', aud: AUD, via: 'email' }, EVF), 'too_many', 'K10 a batch of more than 5000 is refused');
  ok(rows('RDComms').filter((r) => r.event === EVF).length === 0, 'K10 and nothing is written for it');
}

/* ---------- K11 WhatsApp ---------- */
{
  const W1 = K();
  const p = await call('cmPrepare', 'boss', { key: W1, tplId: 'bib', aud: { who: 'runners', cat: '21 K' }, via: 'whatsapp' });
  eq([p.total, p.noContact, p.via], [4, 1, 'whatsapp'], 'K11 a WhatsApp batch: four of the five in the category have a number WhatsApp can open (one has a landline)');
  const l = await call('cmLinks', 'boss', { batch: W1 });
  eq([l.from, l.next, l.total, l.items.length], [0, null, 4, 4], 'K11 one page holds all four');
  eq(l.items.map((i) => i.bib), ['201', '203', '301', '302'], 'K11 in bib order');
  eq(Object.keys(l.items[0]), ['id', 'name', 'bib', 'link', 'done'], 'K11 each is an id, a name, a bib, a link and whether it is done');
  const text201 = '*Bib 201 for Comms Run A*\n\nHi Indu, your bib is 201.\n\nSee you at Beach Road b.';
  eq(l.items[0].link, 'https://wa.me/919812300201?text=' + encodeURIComponent(text201), 'K11 the link opens a chat with that number (country code added) and the message made for that person');
  ok(l.items.every((i) => /^https:\/\/wa\.me\/[1-9]\d{10,14}\?text=[A-Za-z0-9\-_.!~*'()%]*$/.test(i.link) && i.done === false), 'K11 every link is an https wa.me address with the message encoded in it, and none is done yet');
  eq(l.items[2].name, '=HYPERLINK("http://evil","x")', 'K11 a name is text as typed (the screen shows it as text)');
  ok(l.items.every((i) => !/[<>]/.test(decodeURIComponent(i.link))), 'K11 no tag is in any message');
  ok(rows('RDAudit').filter((a) => a.action === 'WhatsApp links opened').length === 1 && !LEAK.test(JSON.stringify(rows('RDAudit'))), 'K11 opening the links is in the audit log once, with no number in it');
  await call('cmLinks', 'boss', { batch: W1 });
  ok(rows('RDAudit').filter((a) => a.action === 'WhatsApp links opened').length === 2, 'K11 each time the first page is opened it is written again');
  await refused(call('cmLinks', 'boss', { batch: B1 }), 'wrong_channel', 'K11 an e-mail batch has no links');
  await refused(call('cmLinks', 'boss', { batch: W1, from: -1 }), 'bad_from', 'K11 a position below 0 is refused');
  await refused(call('cmLinks', 'boss', { batch: 'nosuchbatch1' }), 'no_batch', 'K11 a batch that is not there is refused');
  eq((await call('cmLinks', 'boss', { batch: W1, from: 4 })).items, [], 'K11 a position past the end gives nothing');
  // marking
  const ids = (...k) => k.map((x) => regId(EVA, x));
  eq(await call('cmMark', 'boss', { batch: W1, ids: ids('201', '203'), status: 'sent' }), { marked: 2, already: 0 }, 'K11 two people are marked as messaged');
  eq(await call('cmMark', 'boss', { batch: W1, ids: ids('201', '203'), status: 'sent' }), { marked: 0, already: 2 }, 'K11 marking them again changes nothing');
  eq(await call('cmMark', 'boss', { batch: W1, ids: ids('201', '301'), status: 'skipped' }), { marked: 1, already: 1 }, 'K11 a person who is marked stays as marked (201 stays "sent"); another is marked as left out');
  eq(await call('cmMark', 'boss', { batch: W1, ids: ids('302', '302'), status: 'sent' }).then((x) => x.marked), 1, 'K11 a person named twice is marked once');
  const row = rows('RDComms').find((x) => x._id === 'rcp~' + W1 + '~' + regId(EVA, '201'));
  ok(row && row.status === 'sent' && row.why === 'whatsapp' && row.sub === 'bib' && row.by === 'boss' && row.json === '', 'K11 a mark is one log row: the batch, the person, the state, "whatsapp" and who pressed');
  eq((await call('cmLinks', 'boss', { batch: W1 })).items.map((i) => i.done), [true, true, true, true], 'K11 the links show who is done');
  const bw = await call('cmBatch', 'boss', { batch: W1 });
  eq([bw.counts, bw.resume, bw.problems], [{ sent: 3, failed: 0, skipped: 1, sending: 0, waiting: 0 }, null, [{ name: '=HYPERLINK("http://evil","x")', bib: '301', status: 'skipped', why: 'whatsapp' }]], 'K11 the batch report counts the marks like any send');
  const [m1, m2] = await Promise.all([call('cmMark', 'boss', { batch: VB, ids: [rows('RDVolunteers').find((v) => v.name === 'Vol Two')._id], status: 'sent' }), call('cmMark', 'dir2', { batch: VB, ids: [rows('RDVolunteers').find((v) => v.name === 'Vol Two')._id], status: 'sent' })]);
  eq([m1.marked + m2.marked, m1.already + m2.already], [1, 1], 'K11 two directors marking the same person at the same moment: one mark, the other is told "already"');
  eq((await call('cmAudience', 'boss', { aud: { who: 'volunteers', notSent: 'volunteer' }, tplId: 'volunteer' })).total, 3, 'K11 a WhatsApp mark counts as sent: a "not yet sent" audience leaves that volunteer out');
  // bad input
  await refused(call('cmMark', 'boss', { batch: W1, ids: ids('101'), status: 'sent' }), 'not_in_batch', 'K11 a person who is not in the batch cannot be marked');
  await refused(call('cmMark', 'boss', { batch: W1, ids: ['nosuch'], status: 'sent' }), 'not_in_batch', 'K11 nor an id that is nobody\'s');
  await refused(call('cmMark', 'boss', { batch: W1, ids: [regId(EVB, '101')], status: 'sent' }), 'not_in_batch', 'K11 nor a runner of another race');
  for (const bad of ['failed', 'sending', '', undefined, 5, ['sent']]) await refused(call('cmMark', 'boss', { batch: W1, ids: ids('201'), status: bad }), 'bad_status', 'K11 a state other than sent or skipped is refused: ' + JSON.stringify(bad));
  for (const bad of [[], 'x', undefined, null, {}, [5], [''], ['x'.repeat(121)], Array.from({ length: 51 }, (x, i) => 'id' + i)]) await refused(call('cmMark', 'boss', { batch: W1, ids: bad, status: 'sent' }), 'bad_ids', 'K11 a list of people that is not one is refused: ' + String(JSON.stringify(bad)).slice(0, 40));
  await refused(call('cmMark', 'boss', { batch: B1, ids: ids('101'), status: 'sent' }), 'wrong_channel', 'K11 an e-mail batch cannot be marked');
  // pages of a big batch
  const WE = K();
  const pe = await call('cmPrepare', 'boss', { key: WE, tplId: 'bib', aud: AUD, via: 'whatsapp' }, EVE);
  eq(pe.total, 1203, 'K11 a WhatsApp batch of 1203');
  const a0 = await call('cmLinks', 'boss', { batch: WE }, EVE);
  eq([a0.items.length, a0.next, a0.total, a0.items[0].bib], [25, 25, 1203, '1001'], 'K11 a page is 25 people');
  const a1 = await call('cmLinks', 'boss', { batch: WE, from: 490 }, EVE);
  eq([a1.items.map((i) => i.bib).join(), a1.next], [Array.from({ length: 25 }, (x, i) => String(1491 + i)).join(), 515], 'K11 a page across the end of a stored row has the right people');
  const a2 = await call('cmLinks', 'boss', { batch: WE, from: 1200 }, EVE);
  eq([a2.items.length, a2.next], [3, null], 'K11 the last page has three people and no next');
  ok(rows('RDAudit').filter((a) => a.action === 'WhatsApp links opened' && /1203 people/.test(a.detail)).length === 1, 'K11 only the first page is written to the audit log');
  const seen = new Set();
  let f = 0;
  for (let i = 0; i < 60 && f !== null; i++) {
    const pg = await call('cmLinks', 'boss', { batch: WE, from: f }, EVE);
    pg.items.forEach((x) => seen.add(x.id));
    f = pg.next;
  }
  eq([seen.size, f], [1203, null], 'K11 going through all the pages reaches every person once');
}

/* ---------- K12 the file of an audience ---------- */
{
  const ex = await call('cmExport', 'boss', { aud: AUD });
  eq([ex.count, ex.from, ex.next, ex.total], [12, 0, null, 12], 'K12 the file of all paid runners has twelve rows');
  const ls = linesOf(ex.csv);
  eq([ls.length, cellsOf(ls[0])], [13, ['Name', 'Bib', 'Category', 'E-mail']], 'K12 a heading and twelve rows; the default columns are name, bib, category and e-mail');
  eq(cellsOf(ls[1]), ['Asha Rao', '101', '10 K', 'asha@example.com'], 'K12 a row is the details of one runner, in bib order');
  eq(cellsOf(ls[2]), ['BINA RAO', '102', '10 K', 'bina@example.com'], 'K12 an address is written in lower case');
  eq(cellsOf(ls[6]), ['img src=x onerror=1Eve', '106', '10 K', 'eve@example.com'], 'K12 a name in a file is one clean line, without angle brackets (a file is not a web page)');
  eq(cellsOf(ls[10]), ["'=HYPERLINK(\"http://evil\",\"x\")", '301', '21 K', 'f@example.com'], 'K12 a name that would start a formula in a spreadsheet gets a quote in front');
  ok(ls.slice(1).every((x) => cellsOf(x).every((c) => !/^[=+\-@]/.test(c))), 'K12 no cell of the file starts a formula');
  ok(ls.every((x) => /^("([^"]|"")*",)*"([^"]|"")*"$/.test(x)), 'K12 every cell is quoted');
  eq(cellsOf(ls[12]), ['Nina Nobib', '', '10 K', 'nina@example.com'], 'K12 the runner with no bib comes last, with an empty bib');
  const all = await call('cmExport', 'boss', { aud: { who: 'runners', cat: '21 K' }, cols: L.EXPORT_COLS });
  const al = linesOf(all.csv);
  eq(cellsOf(al[0]), L.EXPORT_COLS.map((c) => L.EXPORT_HEAD[c]), 'K12 all the columns have headings');
  eq(cellsOf(al[1]), ['Indu Menon', '201', '21 K', 'S', 'indu@example.com', '9812300201', 'Elite', '05:30', ''], 'K12 a row with every column: size, number as digits, wave, start time and corral');
  eq(cellsOf(al[2])[5], '0891234567', 'K12 a phone number is exported as it is (digits)');
  const v = await call('cmExport', 'boss', { aud: { who: 'volunteers', vstatus: 'approved' }, cols: ['name', 'email', 'phone'] });
  eq(linesOf(v.csv).map(cellsOf), [['Name', 'E-mail', 'Phone'], ['Vol Four', 'vol4@example.com', '9812300504'], ['Vol One', 'vol1@example.com', '9812300501']], 'K12 volunteers have their own file');
  eq(linesOf((await call('cmExport', 'boss', { aud: { who: 'runners', cat: '21 K' }, cols: ['email'] })).csv).map(cellsOf).slice(0, 3), [['E-mail'], ['indu@example.com'], ['jai@example.com']], 'K12 one column is enough');
  for (const bad of [[], 'name', ['name', 'name'], ['password'], [5], ['name', 'bib', 'cat', 'size', 'email', 'phone', 'wave', 'start', 'corral', 'name'], null, {}]) await refused(call('cmExport', 'boss', { aud: AUD, cols: bad }), 'bad_columns', 'K12 columns that are not a list of known columns, each once, are refused: ' + String(JSON.stringify(bad)).slice(0, 40));
  await refused(call('cmExport', 'boss', { aud: AUD, from: -1 }), 'bad_from', 'K12 a position below 0 is refused');
  await refused(call('cmExport', 'boss', { aud: { who: 'runners', pay: 'x' } }), 'bad_audience', 'K12 a wrong audience is refused');
  await refused(call('cmExport', 'boss', {}), 'bad_audience', 'K12 no audience is refused');
  eq(await call('cmExport', 'boss', { aud: AUD, from: 12 }).then((x) => [x.csv, x.count, x.next]), ['', 0, null], 'K12 a position past the end gives an empty page');
  const au = rows('RDAudit').filter((a) => a.action === 'audience exported');
  ok(au.length === 4 && au.every((a) => !LEAK.test(a.detail) && /rows, columns /.test(a.detail)), 'K12 each file is in the audit log once (on its first page), with the audience, the number of rows and the columns, and no detail of anybody');
  eq(au[0].detail, 'Runners' + DOT + 'paid: 12 rows, columns name, bib, cat, email', 'K12 for example');
  // pages of a big file
  const e0 = await call('cmExport', 'boss', { aud: AUD, cols: ['name', 'bib'] }, EVE);
  const e1 = await call('cmExport', 'boss', { aud: AUD, cols: ['name', 'bib'], from: e0.next }, EVE);
  eq([e0.count, e0.next, e0.total, linesOf(e0.csv).length, e1.count, e1.next, linesOf(e1.csv).length, cellsOf(linesOf(e1.csv)[0])], [1000, 1000, 1203, 1001, 203, null, 203, ['Runner 1000', '2001']], 'K12 a file of 1203 rows comes in two pages (1000 and 203); only the first has the heading');
  ok(rows('RDAudit').filter((a) => a.action === 'audience exported' && /1203 rows/.test(a.detail)).length === 1, 'K12 and only the first page is in the audit log');
}

/* ---------- K13 the test e-mail ---------- */
{
  crmReset();
  const T = (o, ev) => call('cmTest', 'boss', o, ev === undefined ? EVB : ev);
  const t1 = await T({ tplId: 'bib', to: 'me@example.com' });
  eq(t1, { sent: true, why: '' }, 'K13 a test e-mail goes to the address that is typed');
  eq([CRM.sent.length, CRM.sent[0].variables.subject, par(1, CRM.sent[0]), par(2, CRM.sent[0])], [1, '[TEST] Your bib for Comms Run B: 123', 'Hello Sample,', 'Your bib number for Comms Run B is 123.'], 'K13 it is made from a made-up runner and says it is a test');
  eq(CRM.calls.filter((c) => c.fn === 'create').map((c) => c.opts.info.name), [{ first: 'Test' }], 'K13 a contact is made for the address, called "Test"');
  for (const bad of ['', 'x', 'a@b', ['me@example.com'], 'me@example.com, you@example.com', 5, 'Me <me@example.com>', undefined, null]) await refused(T({ tplId: 'bib', to: bad }), 'bad_email', 'K13 an address that is not one plain address is refused: ' + JSON.stringify(bad));
  await refused(T({ to: 'me@example.com' }), 'bad_template', 'K13 no template is refused');
  await refused(T({ tplId: 'bib', tpl: { kind: 'runner', subject: 's', body: 'b' }, to: 'me@example.com' }), 'bad_template', 'K13 a saved template and a typed one together are refused');
  await refused(T({ tplId: 'nosuch', to: 'me@example.com' }), 'no_template', 'K13 a template that is not there is refused');
  CRM.contacts.set('un1', UNSUB('Una', 'unsub@example.com'));
  eq(await T({ tplId: 'bib', to: 'unsub@example.com' }), { sent: false, why: 'unsubscribed' }, 'K13 an address that has unsubscribed is told so, not sent to');
  CRM.fail.email = () => {
    throw new Error('Triggered email not found for you@example.com');
  };
  eq(await T({ tpl: { kind: 'volunteer', subject: 'Hi {name}', body: 'Thanks {name}.' }, to: 'you@example.com' }), { sent: false, why: 'Triggered email not found for [address]' }, 'K13 when Wix refuses, the answer says why (without the address) instead of failing');
  CRM.fail = {};
  const sentBefore = CRM.sent.length;
  eq(await T({ tplId: 'volunteer', to: 'me@example.com' }).then((x) => x.sent), true, 'K13 a volunteer template is tested with a made-up volunteer');
  eq([CRM.sent.length - sentBefore, CRM.sent[CRM.sent.length - 1].variables.subject], [1, '[TEST] Thank you for volunteering at Comms Run B'], 'K13 and says it is a test');
  eq(await T({ tplId: 'kit', to: 'me@example.com' }).then((x) => x.sent), true, 'K13 the fifth test of the hour goes out');
  await refused(T({ tplId: 'bib', to: 'me@example.com' }), 'too_many_tests', 'K13 the sixth test within an hour is refused');
  const sent6 = CRM.sent.length;
  ok(CRM.sent.length === sent6 && rows('RDComms').filter((r) => r.kind === 'tst' && r.event === EVB && r.status !== 'refused').length === 5 && rows('RDComms').filter((r) => r.kind === 'tst' && r.event === EVB && r.status === 'refused').length === 1, 'K13 and nothing is sent for it; the refused try is marked and does not count against the hour');
  skew += 3601000;
  eq(await T({ tplId: 'bib', to: 'me@example.com' }).then((x) => x.sent), true, 'K13 an hour later tests can be sent again');
  eq(await call('cmTest', 'boss', { tplId: 'bib', to: 'me@example.com' }, EVA).then((x) => x.sent), true, 'K13 the limit is counted for each race');
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { emailId: '' }));
  await refused(T({ tplId: 'bib', to: 'me@example.com' }), 'no_email_id', 'K13 with no Wix e-mail named a test is refused');
  await call('cmSaveSettings', 'boss', SET1);
  const tst = rows('RDComms').filter((r) => r.kind === 'tst');
  ok(tst.every((r) => r.who === '' && r.ref === '' && r.json === '' && r.by) && !tst.some((r) => /@/.test(JSON.stringify(r))), 'K13 a test leaves one row with who sent it and when, no address and no person');
  ok(rows('RDAudit').some((a) => a.action === 'test e-mail' && a.detail === 'sent') && rows('RDAudit').some((a) => a.action === 'test e-mail' && a.detail === 'not sent: unsubscribed') && rows('RDAudit').some((a) => a.action === 'test e-mail' && a.detail === 'not sent: Triggered email not found for [address]') && !LEAK.test(JSON.stringify(rows('RDAudit'))), 'K13 every test is in the audit log, with what Wix answered and no address');
  ok(!rows('RDComms').some((r) => r.kind === 'rcp' && r.ref === ''), 'K13 a test is not a batch: nobody is counted as having had a message');
}

/* ---------- K14 the other race ---------- */
{
  crmReset();
  await call('cmSaveSettings', 'boss', Object.assign({}, SET1, { link: 'https://www.vtra.run/other' }), EVB);
  for (const [fn, a] of [['cmBatch', { batch: B1 }], ['cmSend', { batch: B1 }], ['cmLinks', { batch: VB }], ['cmMark', { batch: VB, ids: ['x'], status: 'sent' }]]) await refused(call(fn, 'boss', a, EVB), 'no_batch', 'K14 ' + fn + ': a batch of one race cannot be used from another');
  ok(!CRM.sent.length && !CRM.calls.length, 'K14 and nothing is sent');
  await refused(call('cmPreview', 'boss', { tplId: 'mine1' }, EVB), 'no_template', 'K14 a template of one race is not there in another');
  eq((await call('cmAudience', 'boss', { aud: AUD }, EVB)).sample.map((x) => x.name), ['Other Race Olga'], 'K14 the people of one race are not in another\'s audience');
  eq(linesOf((await call('cmExport', 'boss', { aud: AUD }, EVB)).csv).map(cellsOf), [['Name', 'Bib', 'Category', 'E-mail'], ['Other Race Olga', '101', '10 K', 'olga@example.com']], 'K14 nor in its file');
  // a batch row that says it belongs to another race
  const KB = K();
  await call('cmPrepare', 'boss', { key: KB, tplId: 'bib', aud: AUD, via: 'email' }, EVB);
  const brow = rows('RDComms').find((x) => x._id === 'bat~' + EVB + '~' + KB);
  await wd.update('RDComms', Object.assign({}, brow, { event: EVA }), SA);
  await refused(call('cmSend', 'boss', { batch: KB }, EVB), 'no_batch', 'K14 a batch row that names another race is refused');
  await wd.update('RDComms', brow, SA);
  // a stored list of people that holds somebody of another race
  const mrow = rows('RDComms').find((x) => x._id === 'mem~' + EVB + '~' + KB + '~0');
  await wd.update('RDComms', Object.assign({}, mrow, { json: JSON.stringify({ ids: [regId(EVA, '101')] }) }), SA);
  const r = await call('cmSend', 'boss', { batch: KB }, EVB);
  eq([r.sent, r.skipped, CRM.sent.length, logOf(KB).map((x) => x.why)], [0, 1, 0, ['person_removed']], 'K14 a person of another race in a stored list is skipped: nothing is sent to them');
  const rb = await call('cmBatch', 'boss', { batch: KB }, EVB);
  eq(rb.problems, [{ name: '', bib: '', status: 'skipped', why: 'person_removed' }], 'K14 and the report names nobody');
  // the same for volunteers and WhatsApp
  const KV = K();
  await call('cmPrepare', 'boss', { key: KV, tplId: 'volunteer', aud: { who: 'volunteers' }, via: 'whatsapp' }, EVB);
  const vrow = rows('RDComms').find((x) => x._id === 'mem~' + EVB + '~' + KV + '~0');
  await wd.update('RDComms', Object.assign({}, vrow, { json: JSON.stringify({ ids: [String(rows('RDVolunteers').find((x) => x.name === 'Vol One')._id)] }) }), SA);
  const lv = await call('cmLinks', 'boss', { batch: KV }, EVB);
  eq(lv.items.map((x) => [x.name, x.bib, x.link]), [['', '', '']], 'K14 a volunteer of another race in a stored list has no name and no link');
  eq(await call('cmMark', 'boss', { batch: KV, ids: [lv.items[0].id], status: 'skipped' }, EVB), { marked: 1, already: 0 }, 'K14 and can be marked as left out');
  eq((await call('cmOverview', 'boss', {}, EVB)).batches.length, 2, 'K14 the other race lists only its own two batches');
}

/* ---------- K15 what is kept ---------- */
{
  eq(removes, 0, 'K15 nothing was ever deleted by any of it');
  const mine = rows('RDComms');
  const KEEP = ['_id', 'event', 'kind', 'ref', 'sub', 'who', 'status', 'why', 'json', 'by', 'at'];
  ok(mine.every((r) => Object.keys(r).every((k) => KEEP.includes(k) || /^_/.test(k))), 'K15 every row of the Communications collection has only the ten fields');
  const calm = mine.filter((r) => r.kind !== 'tpl');
  ok(!/@|\b98123\d{5}\b|\b0891234567\b|Asha|Chitra|Indu Menon|Jai Shah|Kiran|Lakshmi|Late Larry|Vol One|Vol Four|Vol Two|Olga|Runner \d/.test(JSON.stringify(calm)), 'K15 no row except the templates holds an e-mail address, a phone number or a name (' + calm.length + ' rows)');
  const kinds = {};
  mine.forEach((r) => {
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  });
  ok(kinds.cfg === 1 && kinds.rc === 2 && kinds.tpl >= 6 && kinds.bat >= 12 && kinds.mem >= 12 && kinds.rcp >= 1250 && kinds.rcp <= 1320 && kinds.tst === 8, 'K15 the kinds of rows: one site setting, a link for each race, templates, batches, stored lists, one log row per person and the tests, a refused try included (' + JSON.stringify(kinds) + ')');
  ok(mine.filter((r) => r.kind === 'rcp').every((r) => r._id === 'rcp~' + r.ref + '~' + r.who && ['sent', 'skipped', 'failed', 'sending'].includes(r.status) && r.json === ''), 'K15 every log row is made once for a batch and a person, in one of the four states, with nothing in it');
  ok(mine.filter((r) => r.kind === 'rcp').every((r) => !/@|\d{6,}|[<>"]/.test(r.why)), 'K15 no reason in the log holds an address, a long number or markup');
  noLeak(rows('RDAudit'), 'K15 the audit log holds no address or number');
  ok(!/Asha Rao|Chitra Devi|Indu Menon|Jai Shah|Kiran Das|Late Larry|Vol One/.test(JSON.stringify(rows('RDAudit'))), 'K15 and no name of a runner or a volunteer');
  const KNOWN = new Set([EVA, EVB, EVE, EVF, EVG, '']);
  ok(mine.every((r) => KNOWN.has(r.event)), 'K15 every row belongs to a race of this test or to the whole site');
  ok(rows('RDAudit').filter((a) => /message|e-mail|WhatsApp|audience|test e-mail/.test(a.action)).every((a) => a.by && a.at && a.target), 'K15 every entry in the audit log says who, when and for which race');
}
done();
