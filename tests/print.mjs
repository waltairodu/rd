// BACKEND TESTS (Print and the runner page): who may do what, the designs, previews, printing bibs and certificates in pages, the
// switches of the runner page, and what the public page tells anyone, on one in-memory database with the real RaceOS, Results, Print
// and Runner backends.
//   Q1 who may call what   Q2 overview   Q3 designs   Q4 previews   Q5 printing bibs   Q6 printing certificates   Q7 the switches
//   Q8 the public page (finding a runner, certificates, nothing written, caching)   Q9 the other race
import * as R from './racedir.test.mjs';
import * as S from './results.test.mjs';
import * as PR from './print.test.mjs';
import * as PUB from './runner.test.mjs';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Print backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const rows = (t) => [...(DB[t] || new Map()).values()];
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const PNAMES = Object.keys(PR).filter((n) => /^prn[A-Z]/.test(n));
const UNAMES = Object.keys(PUB).filter((n) => /^pub[A-Z]/.test(n));
let kseq = 0;
const K = () => 'prt' + Date.now().toString(36) + (++kseq).toString(36) + Math.random().toString(36).slice(2, 8);
// the clock the 30-second memory of the public page looks at
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const later = () => {
  skew += 31000;
};
const snap = () => JSON.stringify(Object.keys(DB).sort().map((k) => [k, [...DB[k].entries()]]));

/* ---------- the world ---------- */
const HASH = A.hashPassword('Prn-pass-1');
const mkStaff = (username, role) => wd.insert('ExpoStaff', { username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['desk1', 'desk']];
for (const [u, r] of WHO) await mkStaff(u, r);
const TOK = {};
for (const [u] of WHO) {
  TOK[u] = A.newToken();
  await wd.insert('ExpoSessions', { token: TOK[u], username: u, desk: '', expires: new Date(Date.now() + 7200000).toISOString() }, SA);
}
const RD = istDay(60);
const Y = +RD.slice(0, 4);
const mkRace = async (name, cats) => {
  const ev = (await R.saveEvent({ token: TOK.boss, name, date: RD, venue: 'Beach Road <b>' })).event.id;
  await R.saveCats({ token: TOK.boss, ev, cats });
  return ev;
};
const EVA = await mkRace('Print Run A', [{ name: '10 K', km: 10, price: 800, cap: 500 }, { name: '21 K', km: 21.0975, price: 1200, cap: 500 }]);
const EVB = await mkRace('Print Run B', [{ name: '10 K', km: 10, price: 800, cap: 500 }]);
const EVC = await mkRace('Print Run C', [{ name: '10 K', km: 10, price: 800, cap: 500 }]);
const EVD = await mkRace('Print Run D empty', [{ name: '10 K', km: 10, price: 800, cap: 500 }]);
const FORM = (g, d, a, e) => JSON.stringify([{ name: 'Gender', value: g }, { name: 'Date of birth', value: d }, { name: 'Age', value: a }, { name: 'Expected finish', value: e }]);
const dob = (age) => '01/01/' + (Y - age);
const idOf = (ev, bib, n) => 'REG~' + ev.slice(-6) + '~' + (bib || 'x' + n);
const reg = (ev, bib, name, cat, g, age, status, bibName, n) =>
  wd.insert('RDRegs', { _id: idOf(ev, bib, n), event: ev, name, cat, bib, bibName: bibName || '', status: status || 'ok', phone: '98123' + String(bib || '0').padStart(5, '0'), email: 'p' + bib + '@example.com', form: FORM(g, dob(age), '', '55:00'), at: new Date().toISOString() }, SA);
const PEOPLE = [
  ['101', 'Asha Rao', '10 K', 'F', 36, 'ASHA'], ['102', 'Bina Rao', '10 K', 'F', 31, ''], ['103', 'Chitra Devi', '10 K', 'F', 26, ''], ['104', 'Dev Raman', '10 K', 'M', 46, 'DEVRAJ'],
  ['105', 'Esha Nair', '10 K', 'F', 36, ''], ['106', '<img src=x onerror=1>Eve', '10 K', 'F', 29, '<script>x</script>'],
  ['201', 'Indu Menon', '21 K', 'F', 41, ''], ['202', 'Jai Shah', '21 K', 'M', 51, ''], ['203', 'Kiran Das', '21 K', 'F', 29, ''],
];
for (const p of PEOPLE) await reg(EVA, p[0], p[1], p[2], p[3], p[4], 'ok', p[5]);
await reg(EVA, '111', 'Unpaid Uma', '10 K', 'F', 30, 'pending');
await reg(EVA, '', 'No Bib Nina', '10 K', 'F', 30, 'ok', '', 1);
await reg(EVB, '101', 'Other Race Olga', '10 K', 'F', 33);
for (let i = 1; i <= 130; i++) await reg(EVC, String(1000 + i), 'Runner ' + i, '10 K', i % 2 ? 'F' : 'M', 30 + (i % 20));
const call = (fn, who, o, ev) => PR[fn](Object.assign({ token: who === null ? undefined : TOK[who], ev: ev === undefined ? EVA : ev }, o || {}));
const SETTINGS = { rankBy: 'chip', ageRule: 'raceday', bands: [18, 30, 40, 50, 60], overallDepth: 3, groupDepth: 3, overallExcl: true, map: { gender: 'Gender', dob: 'Date of birth', age: 'Age', seed: 'Expected finish' } };
await S.resSaveSettings({ token: TOK.boss, ev: EVA, settings: SETTINGS });
await S.resSaveSettings({ token: TOK.boss, ev: EVC, settings: SETTINGS });
const LEAK = new RegExp('p\\d{3,4}@example|98123\\d{5}|@example\\.com|01/01/(19|20)\\d\\d|(19|20)\\d\\d-01-01|1990|"dob"|"phone"|"email"');
const noLeak = (o, msg) => ok(!LEAK.test(JSON.stringify(o)), msg);
const bibsIn = (html) => (html.match(/<div class="n"[^>]*>([^<]*)</g) || []).map((x) => x.replace(/^.*>([^<]*)<$/, '$1'));
const certsIn = (html) => (html.match(/<section class="cert">/g) || []).length;
// waves, so that the start list has something to say
await S.resSaveWaves({ token: TOK.boss, ev: EVA, rev: 0, waves: [{ cat: '10 K', name: 'Wave 1', start: '06:00', corrals: 'A, B', cap: 0 }, { cat: '21 K', name: 'Elite', start: '05:30', corrals: '', cap: 0 }] });
await S.resAssign({ token: TOK.boss, ev: EVA, mode: 'bib', key: K() });

/* ---------- Q1 who may call what ---------- */
{
  ok(PNAMES.length === 6 && UNAMES.length === 3, 'Q1 control: the Print backend has 6 methods and the Runner backend 3 (' + PNAMES.length + ' and ' + UNAMES.length + ')');
  const DIRONLY = ['prnSaveTemplate', 'prnSavePublish'];
  const ARGS = { prnOverview: {}, prnPreview: { kind: 'bib' }, prnBibs: {}, prnCerts: {}, prnSaveTemplate: { kind: 'bib', tpl: {} }, prnSavePublish: { pub: {} } };
  for (const n of PNAMES.filter((x) => !DIRONLY.includes(x))) {
    ok((await err(call(n, 'boss', ARGS[n]))) === '' && (await err(call(n, 'dir2', ARGS[n]))) === '' && (await err(call(n, 'lead1', ARGS[n]))) === '', 'Q1 ' + n + ': directors and leads may look');
    const bad = [];
    for (const w of ['view1', 'coach1', 'desk1']) if ((await err(call(n, w, ARGS[n]))) !== 'not_allowed') bad.push(w);
    ok(!bad.length, 'Q1 ' + n + ': viewers, coaches and desk staff are refused (' + bad.join(',') + ')');
    await refused(call(n, null, ARGS[n]), 'not_logged_in', 'Q1 ' + n + ': no login');
    await refused(PR[n](Object.assign({ token: 'x'.repeat(30), ev: EVA }, ARGS[n])), 'not_logged_in', 'Q1 ' + n + ': a made-up login');
    await refused(PR[n](Object.assign({ token: TOK.boss, ev: 'nope' }, ARGS[n])), 'no_event', 'Q1 ' + n + ': a race that does not exist');
  }
  for (const n of DIRONLY) {
    await refused(call(n, 'lead1', ARGS[n]), 'director_only', 'Q1 ' + n + ': a lead is told "directors only"');
    const bad = [];
    for (const w of ['view1', 'coach1', 'desk1']) if ((await err(call(n, w, ARGS[n]))) !== 'not_allowed') bad.push(w);
    ok(!bad.length, 'Q1 ' + n + ': viewers, coaches and desk staff are refused (' + bad.join(',') + ')');
    await refused(call(n, null, ARGS[n]), 'not_logged_in', 'Q1 ' + n + ': no login');
  }
  const expired = A.newToken();
  await wd.insert('ExpoSessions', { token: expired, username: 'boss', desk: '', expires: new Date(Date.now() - 1000).toISOString() }, SA);
  const damaged = A.newToken();
  await wd.insert('ExpoSessions', { token: damaged, username: 'boss', desk: '', expires: '' }, SA);
  await refused(PR.prnOverview({ token: expired, ev: EVA }), 'not_logged_in', 'Q1 an expired login is refused');
  await refused(PR.prnOverview({ token: damaged, ev: EVA }), 'not_logged_in', 'Q1 a login whose expiry is blank is refused');
}

/* ---------- Q2 overview ---------- */
{
  const o = await call('prnOverview', 'boss');
  eq([o.race.name, o.race.venue, o.cats, o.counts], ['Print Run A', 'Beach Road <b>', ['10 K', '21 K'], { paid: 10, printable: 9, noBib: 1, finishers: 0 }], 'Q2 the race, its categories, and how many are paid, have a bib, have none, and have finished');
  eq([o.bib.wmm, o.bib.nameMode, o.cert.title, o.pub], [190, 'either', 'Certificate of Achievement', { startList: false, results: false, certs: false, note: '' }], 'Q2 before any design: the default designs, every switch off');
  eq([o.vars.bib.length, o.vars.cert.length, o.hosts.includes('static.wixstatic.com')], [7, 13, true], 'Q2 the placeholders and the allowed image hosts are listed');
  noLeak(o, 'Q2 the overview holds no phone number, e-mail address or date of birth');
  const l = await call('prnOverview', 'lead1');
  eq([l.me.role, l.counts.paid], ['lead', 10], 'Q2 a lead sees the same overview');
  eq((await call('prnOverview', 'boss', {}, EVB)).counts, { paid: 1, printable: 1, noBib: 0, finishers: 0 }, 'Q2 another race has its own counts');
  eq((await call('prnOverview', 'boss', {}, EVD)).counts, { paid: 0, printable: 0, noBib: 0, finishers: 0 }, 'Q2 a race with nobody has zero');
}

/* ---------- Q3 designs ---------- */
{
  const TPL = { wmm: 200, hmm: 150, accent: '#c0392b', title: '{race}', nameMode: 'name', catColors: { '10 k': '#00ff00', '99 K': '#ff0000' }, sponsors: 'Acme\nhttps://static.wixstatic.com/media/s.png', tearoff: true, evil: 'x' };
  const saved = await call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: TPL });
  eq([saved.tpl.wmm, saved.tpl.catColors, saved.tpl.sponsors, 'evil' in saved.tpl, saved.tpl.tearoff], [200, { '10 K': '#00ff00' }, ['Acme', 'https://static.wixstatic.com/media/s.png'], false, true], 'Q3 a design is saved as the library reads it: colours for the race\'s own categories only, unknown fields dropped');
  const row = rows('RDPrint').find((x) => x._id === 'tpl~' + EVA + '~bib');
  ok(row && row.kind === 'bib' && row.event === EVA && row.by === 'boss' && JSON.parse(row.json).wmm === 200, 'Q3 the design is one row of this race, with who saved it');
  eq((await call('prnOverview', 'lead1')).bib.wmm, 200, 'Q3 a lead sees the saved design');
  eq((await call('prnOverview', 'boss', {}, EVB)).bib.wmm, 190, 'Q3 another race still has the default design');
  const c = await call('prnSaveTemplate', 'dir2', { kind: 'cert', tpl: { title: 'Well run', sign1Name: 'Yogi', sign1Role: 'Race Director', logo: 'https://static.wixstatic.com/media/l.png', body: 'Ran {cat}\nWell done' } });
  eq([c.tpl.title, c.tpl.sign1Name, c.tpl.body], ['Well run', 'Yogi', 'Ran {cat}\nWell done'], 'Q3 a second director saves the certificate design');
  ok(rows('RDAudit').some((a) => a.action === 'bib design saved' && a.by === 'boss') && rows('RDAudit').some((a) => a.action === 'certificate design saved' && a.by === 'dir2'), 'Q3 both saves are in the audit log with who made them');
  await refused(call('prnSaveTemplate', 'boss', { kind: 'poster', tpl: {} }), 'bad_kind', 'Q3 an unknown kind of design is refused');
  await refused(call('prnSaveTemplate', 'boss', { tpl: {} }), 'bad_kind', 'Q3 no kind is refused');
  for (const bad of [null, 'x', 5, [], undefined]) await refused(call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: bad }), 'bad_template', 'Q3 a design that is not an object is refused: ' + JSON.stringify(bad));
  await refused(call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: { wmm: 5 } }), 'bad_template', 'Q3 a bib that is too small is refused');
  await refused(call('prnSaveTemplate', 'boss', { kind: 'cert', tpl: { accent: 'red' } }), 'bad_template', 'Q3 a colour that is not #rrggbb is refused');
  await refused(call('prnSaveTemplate', 'boss', { kind: 'cert', tpl: { logo: 'https://evil.example/x.png' } }), 'bad_image', 'Q3 a logo on another site is refused');
  await refused(call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: { sponsors: ['javascript:alert(1)'] } }), 'bad_image', 'Q3 a sponsor that is a script address is refused');
  eq(JSON.parse(rows('RDPrint').find((x) => x._id === 'tpl~' + EVA + '~cert').json).title, 'Well run', 'Q3 a refused save leaves the saved design as it was');
  // a damaged row is read as the default and never breaks a page
  await wd.insert('RDPrint', { _id: 'tpl~' + EVB + '~bib', event: EVB, kind: 'bib', json: '{"wmm":"<script>","title":5}', by: 'x', at: 'x' }, SA);
  const dmg = await call('prnPreview', 'boss', { kind: 'bib' }, EVB);
  ok(dmg.body.includes('class="bib"') && !dmg.body.includes('<script') && dmg.head.includes('width:190mm'), 'Q3 a damaged saved design is read as the default design');
  await wd.update('RDPrint', { _id: 'tpl~' + EVB + '~bib', event: EVB, kind: 'bib', json: '{"wmm":200,"holes":"<img>"}', by: 'x', at: 'x' }, SA);
  eq((await call('prnOverview', 'boss', {}, EVB)).bib.holes, true, 'Q3 a saved design with one wrong value is read as the default as a whole');
  await call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: { nameMode: 'name', tearoff: false } }, EVA);
}

/* ---------- Q4 previews ---------- */
{
  const p = await call('prnPreview', 'boss', { kind: 'bib' });
  eq([p.sample.bib, p.sample.name, p.sample.fake, bibsIn(p.body)], ['101', 'Asha Rao', false, ['101']], 'Q4 the bib preview uses the first runner with a bib');
  ok(p.head.startsWith('<!DOCTYPE html>') && p.body.includes('Asha Rao') && !p.body.includes('ASHA'), 'Q4 and the saved design (the name, not the bib name)');
  const d = await call('prnPreview', 'lead1', { kind: 'bib', tpl: { nameMode: 'bibname', accent: '#112233' } });
  ok(d.body.includes('ASHA') && d.head.includes('#112233') && !d.body.includes('Asha Rao'), 'Q4 a draft that is not saved yet is previewed (a lead may do this)');
  eq((await call('prnOverview', 'boss')).bib.nameMode, 'name', 'Q4 and the preview saved nothing');
  const one = await call('prnPreview', 'boss', { kind: 'bib', bib: '104' });
  eq([one.sample.bib, bibsIn(one.body)], ['104', ['104']], 'Q4 a bib can be chosen for the preview');
  eq((await call('prnPreview', 'boss', { kind: 'bib', bib: '0104' })).sample.bib, '104', 'Q4 a bib typed with a leading zero finds the bib');
  for (const b of ['111', '999', 'ZZZ']) await refused(call('prnPreview', 'boss', { kind: 'bib', bib: b }), 'no_item', 'Q4 a bib that is unpaid or not there cannot be previewed: ' + b);
  await refused(call('prnPreview', 'boss', { kind: 'bib', bib: '<b>' }), 'bad_bib', 'Q4 a bib that is not a bib is refused');
  await refused(call('prnPreview', 'boss', { kind: 'bib', tpl: { wmm: 1 } }), 'bad_template', 'Q4 a draft with a wrong value is refused');
  await refused(call('prnPreview', 'boss', { kind: 'bib', tpl: 'x' }), 'bad_template', 'Q4 a draft that is not an object is refused');
  await refused(call('prnPreview', 'boss', { kind: 'cert', tpl: { logo: 'https://evil.example/x.png' } }), 'bad_image', 'Q4 a draft logo on another site is refused');
  await refused(call('prnPreview', 'boss', { kind: 'nope' }), 'bad_kind', 'Q4 an unknown kind is refused');
  const fake = await call('prnPreview', 'boss', { kind: 'bib' }, EVD);
  eq([fake.sample.fake, fake.sample.name, bibsIn(fake.body)], [true, 'Sample Runner', ['123']], 'Q4 a race with nobody is previewed with a made-up runner');
  const cf = await call('prnPreview', 'boss', { kind: 'cert' });
  ok(cf.sample.fake === true && cf.body.includes('Sample Runner') && cf.body.includes('Well run'), 'Q4 before any result, the certificate preview uses a made-up finisher and the saved design');
  noLeak([p, d, one, fake, cf], 'Q4 no preview holds a phone number, e-mail address or date of birth');
}

/* ---------- results, so that certificates have finishers ---------- */
const CSV = ['bib,chip,status,name,category,gender,age', '101,55:10,,,,,', '102,56:20,,,,,', '103,57:30,,,,,', '104,50:00,,,,,', '105,,DNF,,,,', '106,58:00,,,,,', '201,1:50:00,,,,,', '202,1:40:00,,,,,', '203,,DNS,,,,', '777,59:30,,Walk In Wally,10 K,M,45'].join('\n');
const imp = async (ev, text) => {
  const dry = await S.resImport({ token: TOK.boss, ev, text, dry: true });
  if (dry.errors.length) throw new Error('the results file has errors: ' + JSON.stringify(dry.errors.slice(0, 3)));
  return S.resImport({ token: TOK.boss, ev, text, key: K() });
};
{
  const r = await imp(EVA, CSV);
  ok(r.saved === 10, 'Q0 control: ten results are saved for the race (' + r.saved + ')');
  const big = ['bib,chip'].concat(Array.from({ length: 60 }, (x, i) => String(1001 + i) + ',' + Math.floor((2400 + i * 13) / 60) + ':' + String((2400 + i * 13) % 60).padStart(2, '0'))).join('\n');
  const r2 = await imp(EVC, big);
  ok(r2.saved === 60, 'Q0 control: sixty results are saved for the big race (' + r2.saved + ')');
}

/* ---------- Q5 printing bibs ---------- */
{
  const a = await call('prnBibs', 'boss');
  eq([a.count, a.next, a.total, a.from, a.skippedSpares], [9, null, 9, 0, 0], 'Q5 the paid runners with a bib are printed (not the unpaid, not the one with no bib)');
  eq(bibsIn(a.body), ['101', '102', '103', '104', '106', '201', '202', '203', '105'].sort((x, y) => parseInt(x, 10) - parseInt(y, 10)), 'Q5 in bib order');
  ok(a.head.startsWith('<!DOCTYPE html>') && !a.body.includes('Unpaid Uma') && !a.body.includes('No Bib Nina') && a.body.includes('Dev Raman'), 'Q5 each bib carries the name (the saved design says "name")');
  ok(!a.body.includes('<img src=x') && !a.body.includes('<script') && a.body.includes('&lt;img src=x onerror=1&gt;Eve'), 'Q5 a name that holds markup is printed as text');
  noLeak(a, 'Q5 a printed bib holds no phone number, e-mail address or date of birth');
  eq(bibsIn((await call('prnBibs', 'lead1')).body).length, 9, 'Q5 a lead may print');
  eq(bibsIn((await call('prnBibs', 'boss', { cat: '21 k' })).body), ['201', '202', '203'], 'Q5 one category only (any spelling of its name)');
  await refused(call('prnBibs', 'boss', { cat: '5 K' }), 'bad_cat', 'Q5 a category the race does not have is refused');
  await refused(call('prnBibs', 'boss', { cat: 5 }), 'bad_cat', 'Q5 a category that is not text is refused');
  for (const f of [-1, 1.5, '1', {}, 2000000]) await refused(call('prnBibs', 'boss', { from: f }), 'bad_from', 'Q5 a start that is not a whole number from 0 is refused: ' + JSON.stringify(f));
  const o = await call('prnBibs', 'boss', { only: '104' });
  eq([o.count, o.total, o.next, bibsIn(o.body)], [1, 1, null, ['104']], 'Q5 one bib');
  eq(bibsIn((await call('prnBibs', 'boss', { only: '0104' })).body), ['104'], 'Q5 one bib, typed with a leading zero');
  for (const b of ['111', '999']) await refused(call('prnBibs', 'boss', { only: b }), 'no_item', 'Q5 one bib that is unpaid or not there: ' + b);
  await refused(call('prnBibs', 'boss', { only: '<x>' }), 'bad_bib', 'Q5 one bib that is not a bib is refused');
  const sp = await call('prnBibs', 'boss', { spares: { from: 106, to: 110 } });
  eq([sp.total, sp.skippedSpares, bibsIn(sp.body).slice(-4)], [13, 1, ['107', '108', '109', '110']], 'Q5 spare bibs are added after the runners, leaving out a number a runner has (106)');
  ok(!sp.body.includes('Spare') && bibsIn(sp.body).length === 13, 'Q5 spares carry no name');
  for (const bad of [{ from: 0, to: 5 }, { from: 5, to: 1 }, { from: 1, to: 600 }, { from: '1', to: '5' }, 'x', [], { from: 1 }]) await refused(call('prnBibs', 'boss', { spares: bad }), 'bad_spares', 'Q5 spares that are wrong are refused: ' + JSON.stringify(bad));
  eq((await call('prnBibs', 'boss', { only: '104', spares: { from: 1, to: 5 } })).total, 1, 'Q5 spares are ignored when one bib is asked for');
  // pages
  const p1 = await call('prnBibs', 'boss', {}, EVC);
  const p2 = await call('prnBibs', 'boss', { from: p1.next }, EVC);
  const p3 = await call('prnBibs', 'boss', { from: p2.next }, EVC);
  eq([p1.count, p1.next, p1.total, p2.count, p2.next, p3.count, p3.next], [60, 60, 130, 60, 120, 10, null], 'Q5 130 bibs come in pages of 60: 60, 60, 10');
  const every = bibsIn(p1.body).concat(bibsIn(p2.body), bibsIn(p3.body));
  eq([every.length, new Set(every).size, every[0], every[129]], [130, 130, '1001', '1130'], 'Q5 every bib once, in order, across the pages');
  eq(p1.head, p3.head, 'Q5 every page carries the same start of the document');
  ok(rows('RDAudit').filter((x) => x.action === 'bibs printed' && x.target === 'Print Run C').length === 1, 'Q5 a print of three pages is one line in the audit log, written with the first page');
  // the saved design applies
  await call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: { nameMode: 'none', tearoff: true, sponsors: ['Acme'] } });
  const nd = await call('prnBibs', 'boss', { only: '101' });
  ok(!nd.body.includes('Asha Rao') && nd.body.includes('class="tr"') && nd.body.includes('<span>Acme</span>'), 'Q5 printing follows the saved design (no name, a tear-off strip, a sponsor)');
  await call('prnSaveTemplate', 'boss', { kind: 'bib', tpl: { nameMode: 'either' } });
  ok((await call('prnBibs', 'boss', { only: '101' })).body.includes('ASHA'), 'Q5 with "either" the bib name is printed when there is one');
  eq(bibsIn((await call('prnBibs', 'boss', {}, EVB)).body), ['101'], 'Q5 the other race prints only its own runners');
  eq((await call('prnBibs', 'boss', {}, EVD)).total, 0, 'Q5 a race with nobody prints nothing');
}

/* ---------- Q6 printing certificates ---------- */
{
  const a = await call('prnCerts', 'boss');
  eq([a.count, a.next, a.total], [8, null, 8], 'Q6 one certificate for each finisher (not DNF, not DNS)');
  ok(certsIn(a.body) === 8 && a.body.includes('Well run') && a.body.includes('Ran 10 K') && a.body.includes('Walk In Wally') && !a.body.includes('Esha Nair') && !a.body.includes('Kiran Das'), 'Q6 on the saved design, with a walk-in who finished, and nobody who did not');
  const order = (a.body.match(/<p class="nm"[^>]*>([^<]*)</g) || []).map((x) => x.replace(/^.*>([^<]*)<$/, '$1'));
  eq(order, ['Dev Raman', 'Asha Rao', 'Bina Rao', 'Chitra Devi', '&lt;img src=x onerror=1&gt;Eve', 'Walk In Wally', 'Jai Shah', 'Indu Menon'], 'Q6 by category, then by place (10 K first, then 21 K)');
  ok(a.body.includes('0:50:00') && a.body.includes('1st') && a.body.includes('2nd'), 'Q6 each certificate holds the time and the place');
  ok(!a.body.includes('<img src=x') && !a.body.includes('<script'), 'Q6 a name with markup is printed as text');
  noLeak(a, 'Q6 a certificate holds no phone number, e-mail address or date of birth');
  eq(certsIn((await call('prnCerts', 'lead1')).body), 8, 'Q6 a lead may print');
  eq(certsIn((await call('prnCerts', 'boss', { cat: '21 K' })).body), 2, 'Q6 one category only');
  const o = await call('prnCerts', 'boss', { only: '202' });
  ok(o.total === 1 && o.body.includes('Jai Shah') && o.body.includes('1:40:00'), 'Q6 one certificate');
  for (const b of ['105', '203', '111', '999']) await refused(call('prnCerts', 'boss', { only: b }), 'no_item', 'Q6 a runner who did not finish has no certificate: ' + b);
  await refused(call('prnCerts', 'boss', { cat: '5 K' }), 'bad_cat', 'Q6 a category the race does not have is refused');
  await refused(call('prnCerts', 'boss', { from: -3 }), 'bad_from', 'Q6 a start that is not a whole number from 0 is refused');
  await refused(call('prnCerts', 'boss', { only: '<x>' }), 'bad_bib', 'Q6 one bib that is not a bib is refused');
  const p1 = await call('prnCerts', 'boss', {}, EVC);
  const p2 = await call('prnCerts', 'boss', { from: p1.next }, EVC);
  const p3 = await call('prnCerts', 'boss', { from: p2.next }, EVC);
  eq([p1.count, p1.next, p1.total, p2.count, p2.next, p3.count, p3.next], [25, 25, 60, 25, 50, 10, null], 'Q6 60 certificates come in pages of 25: 25, 25, 10');
  ok(rows('RDAudit').filter((x) => x.action === 'certificates printed' && x.target === 'Print Run C').length === 1, 'Q6 a print of three pages is one line in the audit log');
  // a voided result has no certificate
  const row = rows('RDResults').find((x) => x.event === EVA && x.bib === '103');
  await S.resVoid({ token: TOK.boss, ev: EVA, id: row._id, reason: 'wrong bib' });
  await refused(call('prnCerts', 'boss', { only: '103' }), 'no_item', 'Q6 a result that is voided has no certificate');
  eq((await call('prnCerts', 'boss')).total, 7, 'Q6 and it is left out of the print-out');
  await S.resVoid({ token: TOK.boss, ev: EVA, id: row._id, undo: true });
  eq((await call('prnCerts', 'boss')).total, 8, 'Q6 restored, it is back');
  const pv = await call('prnPreview', 'boss', { kind: 'cert' });
  eq([pv.sample.bib, pv.sample.name, pv.sample.fake], ['104', 'Dev Raman', false], 'Q6 the certificate preview uses the winner of the first category');
  eq((await call('prnPreview', 'boss', { kind: 'cert', bib: '202' })).sample.name, 'Jai Shah', 'Q6 or the finisher you choose');
  await refused(call('prnPreview', 'boss', { kind: 'cert', bib: '105' }), 'no_item', 'Q6 a non-finisher cannot be previewed');
  eq((await call('prnOverview', 'boss')).counts.finishers, 8, 'Q6 the overview counts the finishers');
  eq((await call('prnCerts', 'boss', {}, EVB)).total, 0, 'Q6 the other race has no finishers');
}

/* ---------- Q7 the switches ---------- */
{
  const before = rows('RDPrint').filter((x) => x.kind === 'pub').length;
  const s = await call('prnSavePublish', 'boss', { pub: { startList: true, results: false, certs: false, note: ' Start list only ' } });
  eq(s.pub, { startList: true, results: false, certs: false, note: 'Start list only' }, 'Q7 the switches are saved');
  eq((await call('prnOverview', 'lead1')).pub.startList, true, 'Q7 a lead sees them');
  eq(rows('RDPrint').filter((x) => x.kind === 'pub').length, before + 1, 'Q7 one row for the race');
  ok(rows('RDAudit').some((a) => a.action === 'runner page changed' && a.by === 'boss' && /start list on, results off, certificates off/.test(a.detail)), 'Q7 the change is in the audit log');
  for (const bad of [null, 'x', 5, [], undefined, { startList: 'yes' }, { results: 1 }, { certs: null }, { note: 5 }]) await refused(call('prnSavePublish', 'boss', { pub: bad }), 'bad_flags', 'Q7 switches that are wrong are refused: ' + JSON.stringify(bad));
  await refused(call('prnSavePublish', 'boss', { pub: { certs: true, results: false } }), 'certs_need_results', 'Q7 certificates cannot be switched on without results');
  eq((await call('prnOverview', 'boss')).pub.note, 'Start list only', 'Q7 a refused save changes nothing');
  eq((await call('prnOverview', 'boss', {}, EVB)).pub.startList, false, 'Q7 another race is not affected');
  eq(Object.keys((await call('prnSavePublish', 'boss', { pub: { startList: true, results: false, certs: false, junk: 1 } })).pub).sort(), ['certs', 'note', 'results', 'startList'], 'Q7 unknown fields are dropped');
  await call('prnSavePublish', 'boss', { pub: { startList: false, results: false, certs: false } });
}

/* ---------- Q8 the public page ---------- */
{
  const before = snap();
  eq(await PUB.pubRaces(), { races: [] }, 'Q8 with every switch off no race is listed');
  for (const arg of [{ ev: EVA, q: 'asha' }, { ev: EVB, q: 'olga' }, { ev: 'nope', q: 'asha' }, { ev: '', q: 'asha' }, { q: 'asha' }, { ev: 5, q: 'asha' }, { ev: 'x'.repeat(500), q: 'asha' }]) await refused(PUB.pubFind(arg), 'not_published', 'Q8 a race with its switches off (or one that is not there) is "not_published": ' + JSON.stringify(arg).slice(0, 50));
  await refused(PUB.pubCert({ ev: EVA, bib: '101' }), 'not_published', 'Q8 and has no certificates');
  ok(snap() === before, 'Q8 asking changed nothing in the database');

  await call('prnSavePublish', 'boss', { pub: { startList: true, results: false, certs: false, note: 'Start list is final' } });
  later();
  const lr = await PUB.pubRaces();
  eq(lr.races.map((r) => [r.id, r.name]), [[EVA, 'Print Run A']], 'Q8 a race with a switch on is listed (and only that one)');
  const f = await PUB.pubFind({ ev: EVA, q: 'asha' });
  eq([f.race.name, f.note, f.flags, f.items.length, f.more, f.tooShort], ['Print Run A', 'Start list is final', { startList: true, results: false, certs: false }, 1, false, false], 'Q8 with the start list on a runner is found by name');
  const it = f.items[0];
  eq([it.bib, it.name, it.cat, it.start.wave, it.start.start, ['A', 'B'].includes(it.start.corral), it.result, it.cert], ['101', 'Asha Rao', '10 K', 'Wave 1', '06:00', true, null, false], 'Q8 with the start list on: bib, category, wave, start time and corral; no result, no certificate');
  eq(Object.keys(it).sort(), ['bib', 'cat', 'cert', 'name', 'result', 'start'], 'Q8 nothing else is told about a runner');
  eq((await PUB.pubFind({ ev: EVA, q: '104' })).items.map((x) => x.name), ['Dev Raman'], 'Q8 found by bib');
  eq((await PUB.pubFind({ ev: EVA, q: '0104' })).items.map((x) => x.bib), ['104'], 'Q8 found by bib with a zero in front');
  eq((await PUB.pubFind({ ev: EVA, q: 'rao' })).items.map((x) => x.bib), ['101', '102'], 'Q8 found by a part of a name, in any case');
  for (const q of ['unpaid', 'nina', '111', 'wally', 'olga', 'zzzz']) eq((await PUB.pubFind({ ev: EVA, q })).items.length, 0, 'Q8 not found: ' + q + ' (unpaid, no bib, walk-in not listed yet, another race, nobody)');
  eq([(await PUB.pubFind({ ev: EVA, q: 'ab' })).tooShort, (await PUB.pubFind({ ev: EVA, q: '  ' })).tooShort], [true, true], 'Q8 fewer than three letters is not a search');
  await refused(PUB.pubFind({ ev: EVA }), 'bad_query', 'Q8 no question is refused');
  await refused(PUB.pubFind({ ev: EVA, q: 5 }), 'bad_query', 'Q8 a question that is not text is refused');
  await refused(PUB.pubFind({ ev: EVA, q: 'a'.repeat(201) }), 'bad_query', 'Q8 a very long question is refused');
  await refused(PUB.pubFind(null), 'bad_query', 'Q8 no arguments at all is refused');
  const evil = await PUB.pubFind({ ev: EVA, q: 'eve' });
  eq(evil.items[0].name, '<img src=x onerror=1>Eve', 'Q8 a name is given as typed (the page escapes it)');
  await refused(PUB.pubCert({ ev: EVA, bib: '101' }), 'not_published', 'Q8 certificates stay off while their switch is off');
  const all = [f, evil, await PUB.pubFind({ ev: EVA, q: 'raman' }), await PUB.pubRaces()];
  noLeak(all, 'Q8 no answer holds a phone number, e-mail address, date of birth or age');

  // results on
  await call('prnSavePublish', 'boss', { pub: { startList: true, results: true, certs: false, note: '' } });
  const r1 = (await PUB.pubFind({ ev: EVA, q: 'asha' })).items[0];
  eq([r1.result.status, r1.result.time, r1.result.place, r1.result.gender, r1.result.ageGroup, r1.result.gplace, r1.result.aplace, r1.cert], ['fin', '0:55:10', 2, 'Women', '30-39', 1, 1, false], 'Q8 with results on: time, place, gender, age group and places in them');
  eq(Object.keys(r1.result).sort(), ['ageGroup', 'aplace', 'gender', 'gplace', 'place', 'status', 'time'], 'Q8 the result holds those and nothing else (no age, no note, no chip and gun)');
  eq([(await PUB.pubFind({ ev: EVA, q: 'esha' })).items[0].result, (await PUB.pubFind({ ev: EVA, q: 'kiran' })).items[0].result], [{ status: 'dnf' }, { status: 'dns' }], 'Q8 a DNF or DNS shows only the status');
  eq((await PUB.pubFind({ ev: EVA, q: 'wally' })).items.map((x) => [x.bib, x.start, x.result.place]), [['777', null, 6]], 'Q8 a walk-in who finished is found, with a result and no start');
  await refused(PUB.pubCert({ ev: EVA, bib: '101' }), 'not_published', 'Q8 certificates are still off');
  // certificates on
  await call('prnSavePublish', 'boss', { pub: { startList: true, results: true, certs: true, note: '' } });
  const c1 = await PUB.pubCert({ ev: EVA, bib: '101' });
  ok(c1.name === 'Asha Rao' && c1.bib === '101' && c1.html.startsWith('<!DOCTYPE html>') && c1.html.endsWith('</html>') && c1.html.includes('Well run') && c1.html.includes('Ran 10 K') && c1.html.includes('0:55:10') && c1.html.includes('2nd') && (c1.html.match(/<section class="cert">/g) || []).length === 1, 'Q8 a certificate: a whole page with the saved design, the name, the time and the place');
  ok(!/<script|javascript:|onerror=|<iframe|<link|<object/i.test(c1.html) && !/src="https?:\/\/(?!static\.wixstatic\.com|vtra\.run|www\.vtra\.run)/.test(c1.html), 'Q8 a certificate has no script, no frame and no image from anywhere else');
  noLeak(c1, 'Q8 a certificate holds no phone number, e-mail address or date of birth');
  ok((await PUB.pubFind({ ev: EVA, q: 'asha' })).items[0].cert === true && (await PUB.pubFind({ ev: EVA, q: 'esha' })).items[0].cert === false, 'Q8 the page is told who has a certificate: a finisher yes, a DNF no');
  for (const b of ['105', '203', '111', '999', '', '<x>', 5, null, undefined]) await refused(PUB.pubCert({ ev: EVA, bib: b }), 'no_certificate', 'Q8 no certificate for: ' + JSON.stringify(b));
  await refused(PUB.pubCert({ ev: EVB, bib: '101' }), 'not_published', 'Q8 a certificate of a race that is not shown');
  await refused(PUB.pubCert(null), 'not_published', 'Q8 no arguments at all');
  const ev = await PUB.pubCert({ ev: EVA, bib: '106' });
  ok(ev.html.includes('&lt;img src=x onerror=1&gt;Eve') && !ev.html.includes('<img src=x'), 'Q8 a certificate of a runner whose name holds markup shows it as text');
  // the heavy work is kept for 30 seconds, the switches are not
  const rowRes = rows('RDResults').find((x) => x.event === EVA && x.bib === '102');
  await S.resSaveRow({ token: TOK.boss, ev: EVA, id: rowRes._id, fields: { chip: '45:00' }, reason: 'timing fix' });
  eq((await PUB.pubFind({ ev: EVA, q: 'bina' })).items[0].result.time, '0:56:20', 'Q8 a correction made a moment ago is not shown yet (the page keeps the ranking for 30 seconds)');
  later();
  const fresh = (await PUB.pubFind({ ev: EVA, q: 'bina' })).items[0].result;
  eq([fresh.time, fresh.place], ['0:45:00', 1], 'Q8 half a minute later it is, with the new place');
  await call('prnSavePublish', 'boss', { pub: { startList: false, results: false, certs: false, note: '' } });
  await refused(PUB.pubFind({ ev: EVA, q: 'bina' }), 'not_published', 'Q8 turning the switches off takes effect at once, even while the ranking is kept');
  await refused(PUB.pubCert({ ev: EVA, bib: '101' }), 'not_published', 'Q8 and for certificates');
  eq(await PUB.pubRaces(), { races: [] }, 'Q8 and the race is no longer listed');
  // nothing was written by any public call
  await call('prnSavePublish', 'boss', { pub: { startList: true, results: true, certs: true, note: '' } });
  later();
  const mid = snap();
  for (const q of ['asha', '104', 'rao', 'zz', '']) await PUB.pubFind({ ev: EVA, q }).catch(() => null);
  await PUB.pubCert({ ev: EVA, bib: '104' });
  await PUB.pubCert({ ev: EVA, bib: '105' }).catch(() => null);
  await PUB.pubRaces();
  ok(snap() === mid, 'Q8 any number of questions and certificates change nothing in the database');
}

/* ---------- Q9 the other race ---------- */
{
  await call('prnSavePublish', 'boss', { pub: { startList: true, results: false, certs: false, note: 'B only' } }, EVB);
  later();
  const b = await PUB.pubFind({ ev: EVB, q: 'olga' });
  eq([b.race.name, b.note, b.items.map((x) => x.bib)], ['Print Run B', 'B only', ['101']], 'Q9 each race has its own switches and its own runners');
  eq((await PUB.pubFind({ ev: EVB, q: 'asha' })).items.length, 0, 'Q9 a runner of another race is not found');
  eq((await PUB.pubFind({ ev: EVA, q: 'olga' })).items.length, 0, 'Q9 and the other way round');
  eq((await PUB.pubRaces()).races.map((r) => r.id).sort(), [EVA, EVB].sort(), 'Q9 both races are listed when both are shown');
  await refused(PUB.pubCert({ ev: EVB, bib: '101' }), 'not_published', 'Q9 certificates of B are off even though A shows them');
  const ca = await call('prnCerts', 'boss', {}, EVB);
  eq(ca.total, 0, 'Q9 B has no finishers to print');
}

done();
