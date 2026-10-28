// SECURITY TESTS: an audit of how the four backends (RaceOS, Expo desk, Coaching, Finance) are built and what they store and
// say. This is not an attack (pentest.mjs and pentest-finance.mjs do that); every method is checked here against a written-down policy.
//   S1  who may call what      the source is read: nothing is decided before the login is checked, and the only methods
//                              that need no login are the expected ones
//   S2  no login, a fake login every method that needs a login refuses 11 kinds of fake, and writes nothing
//   S3  the role table         every method x every kind of login (director, lead, viewer, desk, coach, other, athlete)
//   S4  what is shown to whom  money and phone numbers are hidden from viewers; a lead sees only their own claims; public methods show nothing private
//   S5  sessions and tokens    random, 12 hours, role changes at once, logout ends the session in all four backends
//   S6  secrets                passwords and PINs are never stored or sent back as typed; answers carry no secret; errors say nothing
//   S7  database set-up        every collection is locked to the site admin; the shipped setup key refuses to run
//   S8  the shipped files      no key-like text, no dangerous calls, page-code lists match the backends, Finance never deletes money records
import fs from 'fs';
import * as R from './racedir.test.mjs';
import * as X from './exposoft.test.mjs';
import * as T from './training.test.mjs';
import * as A from './rd-auth.test.mjs';
import * as F from './finance.test.mjs';
import wd from 'wix-data';
import { collections } from 'wix-data.v2';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Security');
const SA = { suppressAuth: true };
const DB = global.__DB;
const D1 = 'Desk 1 - BIB';
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const dbText = () => JSON.stringify(Object.fromEntries(Object.entries(DB).map(([k, m]) => [k, [...m.values()]])));
const rowOf = (u) => [...(DB.ExpoStaff || new Map()).values()].find((r) => String(r.username || '').toLowerCase() === u);

// every write to the database is noted, so "a refused call writes nothing" can be checked
const WRITES = [];
for (const m of ['insert', 'update', 'save', 'bulkInsert', 'bulkUpdate', 'bulkRemove']) {
  const f = wd[m];
  wd[m] = (...a) => {
    WRITES.push(m + ':' + a[0]);
    return f.apply(wd, a);
  };
}

/* ---------- the world: one login of every kind, a session for each, an athlete ---------- */
global.__COLS.add('Import910');
await wd.insert('ExpoConfig', { _id: 'Import910', name: 'VHM', json: JSON.stringify({ bibLot: 200, shirtLot: { S: 5, M: 50, L: 50 } }) }, SA);
const HASH = A.hashPassword('Sec-pass-1');
const mkStaff = (username, role, extra) => wd.insert('ExpoStaff', Object.assign({ username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, extra || {}), SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['desk1', 'desk'], ['sponsor1', 'sponsor']];
for (const [u, r] of WHO) await mkStaff(u, r, u === 'desk1' ? { desks: D1, race: 'Import910' } : {});
const session = async (username, ms) => {
  const token = A.newToken();
  await wd.insert('ExpoSessions', { token, username, desk: '', expires: new Date(Date.now() + (ms === undefined ? 3600000 : ms)).toISOString() }, SA);
  return token;
};
const TOK = {};
for (const [u] of WHO) TOK[u] = await session(u);
TOK.expired = await session('boss', -60000);
TOK.orphan = await session('no-such-login');
const ATH_PIN = '482957';
TOK.ath = (await T.athleteSignup({ name: 'Sec Athlete', phone: '9812345670', pin: ATH_PIN })).token;
await wd.insert('RDPlan', { _id: 'probe-item', event: 'nope', kind: 'task', title: 'Probe', phase: 'd7', status: 'todo' }, SA);
// Finance makes its own five collections the first time a director or lead uses it and then never checks again, so what it
// creates is captured here, before any check below uses Finance. (Only the Finance collections are treated as missing.)
const FIN_COLS = ['RDInvoices', 'RDOrders', 'RDClaims', 'RDLedger', 'RDFinSet'];
const finDefs = [];
{
  const made = new Set();
  const realQuery = wd.query;
  const realCreate = collections.createDataCollection;
  wd.query = (c) => {
    const q = realQuery.call(wd, c);
    if (FIN_COLS.includes(c) && !made.has(c)) q.find = async () => { throw new Error('WDE0025: collection does not exist'); };
    return q;
  };
  collections.createDataCollection = async (d) => {
    finDefs.push(d);
    made.add(d._id);
    return d;
  };
  try {
    await F.finSettings({ token: TOK.boss });
  } finally {
    wd.query = realQuery;
    collections.createDataCollection = realCreate;
  }
}

/* =====================================================================================================
   S1. Who may call what: read from the source
   ===================================================================================================== */
const BACKENDS = [
  { id: 'RaceOS', mod: R, file: 'wix/director/racedir.web.js', auth: /await (auth|session)\(arg/, count: 77, pub: ['health', 'login', 'logout', 'openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus', 'ensureSetup'] },
  { id: 'Expo', mod: X, file: 'wix/expo/exposoft.web.js', auth: /await auth\(arg/, count: 16, pub: ['health'] },
  { id: 'Training', mod: T, file: 'wix/training/training.web.js', auth: /await (sauth|aauth)\(arg/, count: 38, pub: ['tLogin', 'tLogout', 'getTrainSettings', 'openPlans', 'athleteSignup', 'athleteLogin', 'athleteLogout', 'ensureTrainSetup', 'trainHealth'] },
  { id: 'Finance', mod: F, file: 'wix/director/finance.web.js', auth: /await fauth\(arg/, count: 23, pub: [] },
];
const BEFORE_LOGIN_CHECK = /wixData|wixEventsV2|guests\.|askClaude|elevate|collections\.|\bthrow\b|\bawait\b|\bif\b|\bfor\b/;
for (const B of BACKENDS) {
  const text = src(B.file);
  const hits = [...text.matchAll(/^export const (\w+) = webMethod\(Permissions\.(\w+),/gm)];
  B.methods = hits.map((m, i) => ({ name: m[1], perm: m[2], body: text.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : text.length) }));
  B.names = B.methods.map((m) => m.name);
  eq(B.methods.length, B.count, 'S1 ' + B.id + ' has ' + B.count + ' web methods (a new one must be added to the role table below)');
  ok(B.methods.every((m) => m.perm === 'Anyone' && typeof B.mod[m.name] === 'function'), 'S1 ' + B.id + ': every method is exported and uses Permissions.Anyone (the check is the session token inside)');
  const open = B.methods.filter((m) => !B.auth.test(m.body)).map((m) => m.name).sort();
  eq(open, B.pub.slice().sort(), 'S1 ' + B.id + ': the methods that need no login are exactly the expected ones');
  const late = B.methods
    .filter((m) => B.auth.test(m.body))
    .filter((m) => BEFORE_LOGIN_CHECK.test(m.body.slice(0, m.body.search(B.auth))))
    .map((m) => m.name);
  ok(!late.length, 'S1 ' + B.id + ': the login is the first thing every other method checks: nothing is read, written, thrown or decided before it' + (late.length ? ' [' + late.join(', ') + ']' : ''));
}
const RD_NAMES = BACKENDS[0].names;

/* ---------- S2. no login, or a fake one ---------- */
const GATE = ['not_logged_in', 'not_allowed', 'read_only', 'director_only', 'admin_only'];
const SEEN = new Set(); // every error text seen on the way, checked for leaks at the end
const FAKE = [undefined, null, {}, { token: '' }, { token: 'short' }, { token: 'f'.repeat(64) }, { token: 12345678901234567890123 }, { token: { $ne: 'x' } }, { token: ['f'.repeat(64)] }, { token: TOK.expired }, { token: TOK.orphan }];
const copy = (f) => (f && typeof f === 'object' ? JSON.parse(JSON.stringify(f)) : f);
for (const B of BACKENDS) {
  const need = B.methods.filter((m) => !B.pub.includes(m.name)).map((m) => m.name);
  const bad = [];
  const writes0 = WRITES.length;
  for (const name of need)
    for (const f of FAKE) {
      const got = await err(B.mod[name](copy(f)));
      SEEN.add(got);
      if (got !== 'not_logged_in') bad.push(name + ' ' + JSON.stringify(f) + ' -> ' + (got || 'no error'));
    }
  ok(!bad.length, 'S2 ' + B.id + ': ' + need.length + ' methods x ' + FAKE.length + ' kinds of no or fake login are all answered "not_logged_in"' + (bad.length ? ' [' + bad.slice(0, 6).join('; ') + ']' : ''));
  ok(WRITES.length === writes0, 'S2 ' + B.id + ': and not one of those calls wrote anything (' + (WRITES.length - writes0) + ' writes)');
}

/* =====================================================================================================
   S3. The role table: every method x every kind of login
   ===================================================================================================== */
// read: any login that works in RaceOS; write: director and lead; manage: director only. (spec, written by hand)
const RD_LEVEL = {};
const lv = (level, names) => names.forEach((n) => (RD_LEVEL[n] = level));
lv('session', ['whoami']);
lv('read', ['listEvents', 'listShifts', 'listVolunteers', 'listRun', 'listLog', 'listPacers', 'listChecklist', 'listRegs', 'listQuals', 'overview', 'listPlan', 'dashboard', 'racesSummary', 'expoSummary', 'aiStatus', 'aiForecastNow', 'aiBriefing', 'aiAsk', 'aiDraftKinds']);
lv('write', ['saveShift', 'setVolunteerStatus', 'setVolunteerNote', 'addVolunteer', 'assignShift', 'unassignShift', 'volunteerCheck', 'saveRunItem', 'addLog', 'closeLog', 'savePaceGroups', 'savePacer', 'toggleCheck', 'addCheck', 'saveQualClaim', 'decideQual', 'eventInfo', 'approvalTemplate', 'approvalLetter', 'setApprovalDoc', 'aiDraft', 'savePlanItem', 'setPlanStatus']);
lv('manage', ['saveEvent', 'removeShift', 'removeRunItem', 'removePacer', 'removeCheck', 'listWixEvents', 'linkWixEvent', 'wixFormFields', 'saveWixMap', 'importRegs', 'saveQualRules', 'removePlanItem', 'seedPlanLists', 'saveEventInfo', 'applyApprovalTemplate', 'saveCats', 'expoRaces', 'saveBibPlan', 'assignBibs', 'setBib', 'sendToExpo', 'listTeam', 'saveTeam', 'resetTeamSecret', 'signOutTeam', 'removeTeam']);
const EX_LEVEL = {};
for (const n of ['enter', 'whoami', 'chooseDesk', 'loadPage', 'loadSince', 'getPickup', 'issue', 'revert', 'addRunner', 'listEvents']) EX_LEVEL[n] = 'desk';
for (const n of ['importRunners', 'removeSample', 'previewFindMyBib', 'syncFromFindMyBib', 'saveConfig']) EX_LEVEL[n] = 'admin';
const TR_LEVEL = {};
for (const n of ['tWhoami', 'listPlans', 'getPlan', 'listAthletes', 'athleteDetail', 'coachSaveSession', 'coachRemoveSession', 'coachFeedback', 'coachMessage', 'coachInsight']) TR_LEVEL[n] = 'staff';
for (const n of ['saveTrainSettings', 'savePlan', 'removePlan', 'listCoaches', 'assignCoach', 'stopCoaching', 'declineCoaching']) TR_LEVEL[n] = 'manage';
for (const n of ['changePin', 'enrollPlan', 'endPlan', 'myHome', 'mySessions', 'logSession', 'addMySession', 'requestCoaching', 'cancelCoachingRequest', 'myMessages', 'sendMyMessage', 'myInsight']) TR_LEVEL[n] = 'athlete';
// Finance: a lead can raise and follow their own reimbursement claims ('claims'); every other method is the directors' ('manage').
const FIN_LEVEL = {};
for (const n of ['finListClaims', 'finSaveClaim', 'finCancelClaim']) FIN_LEVEL[n] = 'claims';
for (const n of ['finOverview', 'finSettings', 'finSaveSettings', 'finListInvoices', 'finRaiseInvoice', 'finCancelInvoice', 'finPayInvoice', 'finListOrders', 'finSaveOrder', 'finAddBill', 'finPayOrder', 'finRefundOrder', 'finCancelOrder', 'finDecideClaim', 'finPayClaim', 'finCash', 'finAddCash', 'finLedger', 'finAddEntry', 'finVoid']) FIN_LEVEL[n] = 'manage';

const TABLES = [
  { B: BACKENDS[0], level: RD_LEVEL, publics: BACKENDS[0].pub },
  { B: BACKENDS[1], level: EX_LEVEL, publics: BACKENDS[1].pub },
  { B: BACKENDS[2], level: TR_LEVEL, publics: BACKENDS[2].pub },
  { B: BACKENDS[3], level: FIN_LEVEL, publics: BACKENDS[3].pub },
];
for (const { B, level, publics } of TABLES) {
  const unplaced = B.names.filter((n) => !level[n] && !publics.includes(n));
  const stray = Object.keys(level).filter((n) => !B.names.includes(n));
  ok(!unplaced.length && !stray.length, 'S3 ' + B.id + ': the role table lists every method once and nothing that does not exist' + (unplaced.length ? ' [missing: ' + unplaced.join(', ') + ']' : '') + (stray.length ? ' [unknown: ' + stray.join(', ') + ']' : ''));
}

// what each kind of login must get from a method of a given level (null = past the door; any other answer is fine)
const RD_WANT = {
  boss: () => null,
  dir2: () => null,
  lead1: (l) => (l === 'manage' ? 'director_only' : null),
  view1: (l) => (l === 'write' ? 'read_only' : l === 'manage' ? 'director_only' : null),
  desk1: (l) => (l === 'session' ? null : 'not_allowed'),
  coach1: () => 'not_allowed',
  sponsor1: () => 'not_allowed',
  ath: () => 'not_logged_in',
};
const EX_WANT = {
  boss: () => null,
  dir2: () => null,
  lead1: () => 'not_allowed',
  view1: () => 'not_allowed',
  desk1: (l) => (l === 'admin' ? 'admin_only' : null),
  coach1: () => 'not_allowed',
  sponsor1: () => 'not_allowed',
  ath: () => 'not_logged_in',
};
const TR_WANT = {
  boss: (l) => (l === 'athlete' ? 'not_logged_in' : null),
  dir2: (l) => (l === 'athlete' ? 'not_logged_in' : null),
  lead1: (l) => (l === 'athlete' ? 'not_logged_in' : 'not_allowed'),
  view1: (l) => (l === 'athlete' ? 'not_logged_in' : 'not_allowed'),
  desk1: (l) => (l === 'athlete' ? 'not_logged_in' : 'not_allowed'),
  coach1: (l) => (l === 'athlete' ? 'not_logged_in' : l === 'manage' ? 'director_only' : null),
  sponsor1: (l) => (l === 'athlete' ? 'not_logged_in' : 'not_allowed'),
  ath: (l) => (l === 'athlete' ? null : 'not_logged_in'),
};
const FIN_WANT = {
  boss: () => null,
  dir2: () => null,
  lead1: (l) => (l === 'manage' ? 'director_only' : null),
  view1: () => 'not_allowed',
  desk1: () => 'not_allowed',
  coach1: () => 'not_allowed',
  sponsor1: () => 'not_allowed',
  ath: () => 'not_logged_in',
};
// a call that gets past the door must fail quickly and harmlessly on a race that does not exist
const probe =(token) => ({ token, ev: 'nope', event: 'nope', id: 'probe-item', kind: 'task', status: 'zzz', username: 'nope-user', athlete: 'nope', coach: 'nope' });
const runMatrix = async (label, B, level, want) => {
  for (const who of Object.keys(want)) {
    await wd.save('RDPlan', { _id: 'probe-item', event: 'nope', kind: 'task', title: 'Probe', phase: 'd7', status: 'todo' }, SA); // the director's pass removes it
    const bad = [];
    for (const [name, l] of Object.entries(level)) {
      const w = want[who](l);
      const w0 = WRITES.length;
      const got = await err(B.mod[name](probe(TOK[who])));
      SEEN.add(got);
      if (w ? got !== w || WRITES.length !== w0 : GATE.includes(got)) bad.push(name + ' -> ' + (got || 'no error') + (w ? ' (wanted ' + w + ')' : ' (should have got past the door)'));
    }
    ok(!bad.length, 'S3 ' + label + ': ' + who + ' on all ' + Object.keys(level).length + ' methods' + (bad.length ? ' [' + bad.slice(0, 5).join('; ') + ']' : ''));
  }
};
await runMatrix('RaceOS', BACKENDS[0], RD_LEVEL, RD_WANT);
await runMatrix('Expo', BACKENDS[1], EX_LEVEL, EX_WANT);
await runMatrix('Training', BACKENDS[2], TR_LEVEL, TR_WANT);
await runMatrix('Finance', BACKENDS[3], FIN_LEVEL, FIN_WANT);
// "waived" needs the director: a lead may approve or reject a claim but not waive the rule
await refused(R.decideQual(Object.assign(probe(TOK.lead1), { status: 'waived' })), 'director_only', 'S3 a lead cannot waive a qualification rule');
await refused(R.decideQual(Object.assign(probe(TOK.view1), { status: 'waived' })), 'director_only', 'S3 a viewer cannot waive one either');
ok(!GATE.includes(await err(R.decideQual(Object.assign(probe(TOK.boss), { status: 'waived' })))), 'S3 the director can (the call gets past the door)');
// the plan screens: each kind of item has its own rule (money: directors write, leads read; contacts: viewers see nothing)
for (const kind of ['budget', 'sponsor']) {
  await refused(R.savePlanItem(Object.assign(probe(TOK.lead1), { kind })), 'director_only', 'S3 a lead cannot write "' + kind + '" items');
  await refused(R.savePlanItem(Object.assign(probe(TOK.view1), { kind })), 'director_only', 'S3 a viewer cannot write "' + kind + '" items');
}
await refused(R.savePlanItem(Object.assign(probe(TOK.view1), { kind: 'contact' })), 'read_only', 'S3 a viewer cannot write contacts');
ok(!GATE.includes(await err(R.savePlanItem(Object.assign(probe(TOK.lead1), { kind: 'contact' })))), 'S3 a lead can write contacts (the call gets past the door)');
for (const kind of ['budget', 'sponsor', 'contact']) await refused(R.listPlan({ token: TOK.view1, ev: 'nope', kind }), 'not_allowed', 'S3 a viewer cannot even read "' + kind + '" items');
await refused(R.listPlan({ token: TOK.view1, ev: 'nope', kinds: ['task', 'budget'] }), 'not_allowed', 'S3 one hidden kind in a list refuses the whole call');
ok(!GATE.includes(await err(R.listPlan({ token: TOK.lead1, ev: 'nope', kinds: ['task', 'budget', 'sponsor', 'contact'] }))), 'S3 a lead can read all of them');

/* =====================================================================================================
   S4. What is shown to whom
   ===================================================================================================== */
const EV = (await R.saveEvent({ token: TOK.boss, name: 'Security Run', date: day(10), venue: 'Beach Road', expoId: 'Import910' })).event.id;
const SH = (await R.saveShift({ token: TOK.boss, ev: EV, role: 'Marshal', location: 'KM 2', date: day(10), start: '05:00', end: '08:00', need: 6 })).id;
const SECRETS = { budget: '777001', sponsorAmount: '888002', sponsor: 'SecretSponsorCo', phone: '9876500011' };
await R.savePlanItem({ token: TOK.boss, ev: EV, kind: 'budget', title: 'Medals', phase: 'expense', amount: SECRETS.budget });
await R.savePlanItem({ token: TOK.boss, ev: EV, kind: 'sponsor', title: 'Title sponsor', phase: 'cash', party: SECRETS.sponsor, amount: SECRETS.sponsorAmount });
await R.savePlanItem({ token: TOK.boss, ev: EV, kind: 'contact', title: 'Dr Rao (doctor)', contact: SECRETS.phone });
await R.savePlanItem({ token: TOK.boss, ev: EV, kind: 'task', title: 'Order bibs', phase: 'd30' });
const plain = async (p) => JSON.stringify(await p);
const hasSecret = (s) => Object.values(SECRETS).filter((v) => s.includes(v));
const vp = await plain(R.listPlan({ token: TOK.view1, ev: EV, kinds: ['task', 'supply', 'approval'] }));
ok(vp.includes('Order bibs') && !hasSecret(vp).length, 'S4 a viewer reads the ordinary plan items and none of the money or phone numbers' + (hasSecret(vp).length ? ' [saw ' + hasSecret(vp) + ']' : ''));
const vo = await plain(R.overview({ token: TOK.view1, ev: EV }));
ok(!hasSecret(vo).length, 'S4 the viewer\'s overview carries no money or phone numbers' + (hasSecret(vo).length ? ' [saw ' + hasSecret(vo) + ']' : ''));
const lp = await plain(R.listPlan({ token: TOK.lead1, ev: EV, kinds: ['budget', 'sponsor', 'contact'] }));
ok(lp.includes(SECRETS.budget) && lp.includes(SECRETS.phone), 'S4 control: the lead does see them (so the viewer check above is a real difference)');
// public methods: the sign-up screens show nothing about other people
const v1 = await R.volunteerSignup({ ev: EV, name: 'Vol One', phone: '9848011111', email: 'one@leak.test', club: 'VTRA', shifts: [SH], waiver: true });
const v2 = await R.volunteerSignup({ ev: EV, name: 'Vol Two', phone: '9848022222', email: 'two@leak.test', club: 'VTRA', shifts: [SH], waiver: true });
const pub = (await plain(R.openEvents())) + (await plain(R.openShifts({ ev: EV }))) + (await plain(R.volunteerStatus({ ev: EV, code: v1.code, phone: '9848011111' }))) + JSON.stringify(v1);
const others = ['9848022222', 'two@leak.test', 'Vol Two', v2.code, '9848011111', 'one@leak.test'].filter((x) => pub.includes(x));
ok(!others.length, 'S4 the public methods show no volunteer phone number, e-mail or code (a volunteer sees only their own name and shifts)' + (others.length ? ' [saw ' + others + ']' : ''));
const w0 = WRITES.length;
const e1 = await err(R.volunteerStatus({ ev: EV, code: v1.code, phone: '9848022222' }));
const e2 = await err(R.volunteerStatus({ ev: EV, code: 'ZZZZZZ', phone: '9848011111' }));
const e3 = await err(R.volunteerStatus({ ev: EV, code: 'ZZZZZZ', phone: '9000000000' }));
ok(e1 === 'not_found' && e1 === e2 && e2 === e3, 'S4 a wrong code and a wrong phone number get the same answer (' + e1 + ', ' + e2 + ', ' + e3 + '): no hint about which is right');
ok(WRITES.length === w0, 'S4 and looking up a volunteer writes nothing');
eq(await R.health(), { ok: true }, 'S4 RaceOS health says only ok');
eq(await X.health(), { ok: true }, 'S4 Expo health says only ok');
eq(await T.trainHealth(), { ok: true }, 'S4 Training health says only ok');
// Finance: a lead may raise and follow their own reimbursement claims; every other rupee in the books is the directors' to see.
const FS = { party: 'SecretInvoiceCo', invoiceAmt: '4242424.5', vendor: 'SecretVendorCo', payee: 'SecretOtherPayee', payTo: 'secret.upi@okbank', otherAmt: '7777.77', bank: 'SECRETBANK-ACC-99887766', holder: 'SecretHolder' };
const fin = (fn, tok, o) => F[fn](Object.assign({ token: tok, ev: EV }, o));
const FIN = {};
FIN.org = await fin('finSaveSettings', TOK.boss, { bank: FS.bank });
FIN.inv = await fin('finRaiseInvoice', TOK.boss, { party: FS.party, lines: [{ desc: 'Title sponsorship', qty: 1, rate: FS.invoiceAmt }], key: 'sec-inv-0001' });
FIN.ord = await fin('finSaveOrder', TOK.boss, { vendor: FS.vendor, title: 'Finisher medals', estimate: '98765.43', key: 'sec-ord-0001' });
await fin('finAddCash', TOK.boss, { type: 'withdrawal', amount: '5000', holder: FS.holder, key: 'sec-cash-0001' });
await fin('finPayOrder', TOK.boss, { id: FIN.ord.id, amount: '1000', mode: 'cash', holder: FS.holder, phase: 'advance', key: 'sec-opay-0001' });
FIN.own = await fin('finSaveClaim', TOK.lead1, { lines: [{ date: day(-2), desc: 'Auto fare to the venue', cat: 'Travel', amount: '350' }], key: 'sec-clm-lead1' });
FIN.other = await fin('finSaveClaim', TOK.boss, { payee: FS.payee, payTo: FS.payTo, lines: [{ date: day(-2), desc: 'Printing of bibs', cat: 'Printing', amount: FS.otherAmt }], key: 'sec-clm-boss1' });
ok(FIN.inv.id && FIN.ord.id && FIN.own.id && FIN.other.id, 'S4 control: the books hold an invoice, an order, cash movements and two claims, one of them the lead\'s own');
{
  const lc = await F.finListClaims({ token: TOK.lead1, ev: EV });
  eq(lc.claims.map((c) => c.id), [FIN.own.id], 'S4 a lead\'s claim list holds their own claim and not the director\'s');
  eq([lc.role, lc.claims[0].mine], ['lead', true], 'S4 and it says the asker is a lead, and that the claim is theirs');
  const text = JSON.stringify(lc);
  const seenBy = Object.values(FS).filter((v) => text.includes(v));
  ok(!seenBy.length, 'S4 the lead\'s answer carries no invoice, order, vendor, bank, other person\'s claim or cash detail' + (seenBy.length ? ' [saw ' + seenBy + ']' : ''));
  const dc = await F.finListClaims({ token: TOK.boss, ev: EV });
  eq(dc.claims.map((c) => c.id).sort(), [FIN.own.id, FIN.other.id].sort(), 'S4 control: the director sees both claims (so the lead\'s short list is a real difference)');
  await refused(F.finSaveClaim({ token: TOK.lead1, ev: EV, id: FIN.other.id, lines: [{ date: day(-2), desc: 'Changed by someone else', amount: '1' }] }), 'no_item', 'S4 a lead cannot change another person\'s claim');
  await refused(F.finCancelClaim({ token: TOK.lead1, ev: EV, id: FIN.other.id }), 'no_item', 'S4 or cancel it');
  await refused(F.finCancelClaim({ token: TOK.lead1, ev: EV, id: 'clm~no-such~0001' }), 'no_item', 'S4 and a claim that does not exist gets the very same answer (no hint which claims exist)');
  const dir = await fin('finListClaims', TOK.boss, {});
  ok(dir.claims.find((c) => c.id === FIN.other.id).lines[0].amount === 7777.77 && dir.claims.every((c) => c.status === 'submitted'), 'S4 the other claim is untouched by those attempts');
}

/* =====================================================================================================
   S5. Sessions and tokens
   ===================================================================================================== */
{
  const toks = [];
  for (let k = 0; k < 25; k++) toks.push((await R.login({ username: 'view1', password: 'Sec-pass-1' })).token);
  ok(new Set(toks).size === 25 && toks.every((t) => /^[0-9a-f]{64}$/.test(t)), 'S5 25 logins give 25 different 64-digit hex tokens');
  ok(toks.every((t) => !t.includes('view1') && !t.includes('Sec-pass')), 'S5 a token contains nothing of the name or password');
  const row = [...DB.ExpoSessions.values()].find((s) => s.token === toks[0]);
  const hrs = (Date.parse(row.expires) - Date.now()) / 3600000;
  ok(hrs > 11.9 && hrs <= 12.01, 'S5 a session lasts 12 hours (' + hrs.toFixed(2) + ')');
  const many = Array.from({ length: 500 }, () => A.newToken());
  const count = {};
  let digits = 0;
  for (const t of many) for (const c of t) (count[c] = (count[c] || 0) + 1), digits++;
  const chi = Object.values(count).reduce((s, n) => s + Math.pow(n - digits / 16, 2) / (digits / 16), 0);
  ok(Object.keys(count).length === 16 && chi < 60, 'S5 token digits are evenly spread (chi-square ' + chi.toFixed(1) + ' over 16 digits, limit 60)');
  ok(new Set(many).size === 500 && many.every((t, i) => i === 0 || t.slice(0, 8) !== many[i - 1].slice(0, 8)), 'S5 500 tokens: all different, none starts like the one before');
  // a PIN never starts with 0 (it survives being retyped into a spreadsheet); every other digit is evenly spread
  const pins = Array.from({ length: 1500 }, () => A.genPin());
  const pc = {};
  for (const p of pins) for (const c of p) pc[c] = (pc[c] || 0) + 1;
  const want = (d) => (d === '0' ? pins.length * 0.5 : pins.length * (1 / 9 + 0.5));
  const pchi = '0123456789'.split('').reduce((sum, d) => sum + Math.pow((pc[d] || 0) - want(d), 2) / want(d), 0);
  ok(pins.every((p) => /^[1-9]\d{5}$/.test(p)) && pchi < 40, 'S5 generated PINs are 6 digits, never start with 0, and are evenly spread (chi-square ' + pchi.toFixed(1) + ', limit 40)');
}
{
  // a login's role is read on every call, never kept in the session
  const tok = await session('lead1');
  const call = (t) => err(R.saveShift(probe(t)));
  const fcall = (t) => err(F.finListClaims({ token: t, ev: EV }));
  ok(!GATE.includes(await call(tok)), 'S5 a lead can write (control)');
  ok(!GATE.includes(await fcall(tok)), 'S5 a lead can use their reimbursement claims in Finance (control)');
  const row = rowOf('lead1');
  const set = (role) => wd.update('ExpoStaff', Object.assign({}, rowOf('lead1'), { role }), SA);
  await set('viewer');
  eq(await call(tok), 'read_only', 'S5 made a viewer: the same token can no longer write');
  eq(await fcall(tok), 'not_allowed', 'S5  and Finance closes at once too');
  await set('desk');
  eq(await call(tok), 'not_allowed', 'S5 made desk staff: the same token is refused by RaceOS');
  eq(await fcall(tok), 'not_allowed', 'S5  and by Finance');
  eq((await R.whoami({ token: tok })).role, 'desk', 'S5  (and whoami still answers, as it does for desk staff)');
  await set('coach');
  eq(await call(tok), 'not_allowed', 'S5 made a coach: refused');
  eq(await fcall(tok), 'not_allowed', 'S5  and by Finance');
  await refused(R.whoami({ token: tok }), 'not_allowed', 'S5  and whoami refuses too');
  await set('director');
  ok(!GATE.includes(await err(F.finLedger({ token: tok, ev: EV }))), 'S5 promoted to director: the same token opens the whole of Finance at once');
  await set('lead');
  ok(!GATE.includes(await call(tok)), 'S5 made a lead again: writes again');
  eq(await err(F.finLedger({ token: tok, ev: EV })), 'director_only', 'S5  and the director-only part of Finance closes again at once');
  await wd.bulkRemove('ExpoStaff', [row._id], SA);
  await refused(R.whoami({ token: tok }), 'not_logged_in', 'S5 login removed: the token stops working at once');
  await refused(F.finListClaims({ token: tok, ev: EV }), 'not_logged_in', 'S5  in Finance too');
  await wd.insert('ExpoStaff', Object.assign({}, row, { _id: undefined }), SA);
}
{
  // the token decides who is asking, nothing else in the call
  const w = await R.whoami({ token: TOK.view1, username: 'boss', user: 'boss', role: 'admin', canManage: true, as: 'boss', sess: { username: 'boss' } });
  ok(w.role === 'viewer' && !w.canManage, 'S5 a viewer\'s token with "username: boss", "role: admin" and "canManage" in the call is still a viewer');
  const xw = await X.whoami({ token: TOK.desk1, username: 'boss', role: 'admin', race: 'other' });
  ok(xw.role === 'desk' && xw.race === 'Import910', 'S5 a desk token with a different role and race in the call is still that desk, on its own race');
  // Finance: a lead's token with "boss", "director" and "by" in the call is still a lead, and still sees only their own claims
  const fl = await F.finListClaims({ token: TOK.lead1, ev: EV, username: 'boss', user: 'boss', role: 'director', by: 'boss', as: 'boss', me: { username: 'boss', role: 'director' } });
  ok(fl.role === 'lead' && fl.claims.length === 1 && fl.claims[0].mine === true, 'S5 a lead\'s token with "username: boss" and "role: director" in the Finance call is still a lead, with only their own claim');
  await refused(F.finLedger({ token: TOK.lead1, ev: EV, username: 'boss', role: 'director', by: 'boss' }), 'director_only', 'S5  and still cannot read the ledger');
  const mine = await F.finSaveClaim({ token: TOK.lead1, ev: EV, by: 'boss', byName: 'The Director', username: 'boss', status: 'approved', approved: '99999', decidedBy: 'boss', selfApproved: false, lines: [{ date: day(-2), desc: 'Tea for volunteers', amount: '120' }], key: 'sec-clm-mass-1' });
  const made = (await F.finListClaims({ token: TOK.boss, ev: EV })).claims.find((c) => c.id === mine.id);
  ok(made && made.by === 'lead1' && made.status === 'submitted' && made.approved === 0 && !made.decidedBy, 'S5 a claim raised with "by", "status: approved" and "approved: 99999" in the call is still the lead\'s own, submitted and not approved');
}
{
  const t = (await R.login({ username: 'view1', password: 'Sec-pass-1' })).token;
  ok((await R.whoami({ token: t })).role === 'viewer', 'S5 a new session works');
  await R.logout({ token: t });
  await refused(R.whoami({ token: t }), 'not_logged_in', 'S5 after logout RaceOS refuses the token');
  await refused(X.whoami({ token: t }), 'not_logged_in', 'S5  and the Expo desk');
  await refused(T.tWhoami({ token: t }), 'not_logged_in', 'S5  and the coach pages (one session for all three)');
  const w1 = WRITES.length;
  for (const junk of [undefined, null, '', 'x', 'f'.repeat(64), {}, []]) await R.logout(junk === undefined ? undefined : { token: junk });
  ok(WRITES.length === w1, 'S5 logging out with nothing or a fake token writes nothing');
}
{
  const t = (await R.login({ username: 'dir2', password: 'Sec-pass-1' })).token;
  ok(!GATE.includes(await err(F.finOverview({ token: t, ev: EV }))), 'S5 a director\'s new session opens Finance');
  await R.logout({ token: t });
  await refused(F.finOverview({ token: t, ev: EV }), 'not_logged_in', 'S5 after logout Finance refuses the token too (one session for all four backends)');
  const expired = await session('dir2', 1000);
  await wd.update('ExpoSessions', Object.assign({}, [...DB.ExpoSessions.values()].find((s) => s.token === expired), { expires: new Date(Date.now() - 1000).toISOString() }), SA);
  await refused(F.finOverview({ token: expired, ev: EV }), 'not_logged_in', 'S5 a session that has run out is refused by Finance');
}

/* =====================================================================================================
   S6. Secrets: stored hashed, never sent back, never in an error
   ===================================================================================================== */
await mkStaff('legacy1', 'viewer', { password: 'legacy-plain-1' });
ok(rowOf('legacy1').password === 'legacy-plain-1', 'S6 control: a hand-typed login starts as plain text');
await R.login({ username: 'legacy1', password: 'legacy-plain-1' });
ok(/^h1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(rowOf('legacy1').password), 'S6 its first login replaces the plain text with a hash');
ok(!dbText().includes('legacy-plain-1'), 'S6 and the old password is nowhere in the database any more');
ok([...DB.ExpoStaff.values()].every((r) => A.isHashed(r.password)), 'S6 every login in the database is a hash (' + DB.ExpoStaff.size + ' logins)');
const made = await R.saveTeam({ token: TOK.boss, username: 'new.lead', name: 'New Lead', role: 'lead' });
const made2 = await R.saveTeam({ token: TOK.boss, username: 'new.desk', name: 'New Desk', role: 'desk', desks: [D1], race: 'Import910' });
const typed = await R.saveTeam({ token: TOK.boss, username: 'typed.lead', name: 'Typed Lead', role: 'lead', password: 'Typed-Pass-77' });
ok(/^.{10}$/.test(made.secret) && /^\d{6}$/.test(made2.secret), 'S6 a new login gets a 10-character password (staff) or a 6-digit PIN (desk), shown once');
const reset = await R.resetTeamSecret({ token: TOK.boss, username: 'new.lead' });
ok(reset.secret !== made.secret && !!reset.secret, 'S6 a reset gives a different one');
await refused(R.login({ username: 'new.lead', password: made.secret }), 'bad_login', 'S6 the old password stops working');
ok((await R.login({ username: 'new.lead', password: reset.secret })).role === 'lead', 'S6 the new one works');
const all = dbText();
ok([made.secret, reset.secret, 'Typed-Pass-77'].every((s) => !all.includes(s)), 'S6 neither generated passwords nor a typed one are anywhere in the database as typed');
ok(['new.lead', 'new.desk', 'typed.lead'].every((u) => A.isHashed(rowOf(u).password)), 'S6 the three new logins are stored as hashes');
ok(!JSON.stringify([...DB.RDAudit.values()]).match(new RegExp([made.secret, made2.secret, reset.secret, 'Typed-Pass-77'].map((s) => s.replace(/[^\w]/g, '.')).join('|'))), 'S6 the Team change notes (audit) never hold a password or PIN');
{
  const notes = JSON.stringify([...DB.RDAudit.values()]);
  ok(notes.includes('invoice raised') && notes.includes('claim raised'), 'S6 control: the Finance changes made above are in the change notes');
  ok(![FS.bank, FS.payTo, 'secret.upi'].some((s) => notes.includes(s)) && !/token|password/i.test(JSON.stringify([...DB.RDFinSet.values()])), 'S6 the Finance change notes hold no bank, UPI or payee detail, and the safe-to-repeat records hold no token or password');
}
// the PIN of an athlete
ok(!all.includes('"' + ATH_PIN + '"'), 'S6 an athlete\'s PIN is not in the database as typed');
const athRow = [...DB.TrainAthletes.values()][0];
ok(/^[0-9a-f]{64}$/.test(athRow.pinHash) && !!athRow.salt, 'S6 it is stored as a salted hash');
// answers: scan everything the screens can ask for
const FORBIDDEN_KEYS = /^(password|passwd|pinHash|salt|failCount|lockUntil|token|secret)$/i;
function leaks(v, at, out) {
  at = at || '$';
  out = out || [];
  if (Array.isArray(v)) v.forEach((x, i) => leaks(x, at + '[' + i + ']', out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) (FORBIDDEN_KEYS.test(k) && out.push(at + '.' + k), leaks(v[k], at + '.' + k, out));
  else if (typeof v === 'string' && (/h1\$[0-9a-f]{16}\$[0-9a-f]{64}/.test(v) || /^[0-9a-f]{64}$/.test(v))) out.push(at + ' looks like a hash or token');
  return out;
}
const asBoss = { token: TOK.boss, ev: EV };
const ath1 = [...DB.TrainAthletes.values()][0]._id;
const READS = [
  () => R.listEvents({ token: TOK.boss }), () => R.listShifts(asBoss), () => R.listVolunteers(asBoss), () => R.listRun(asBoss), () => R.listLog(asBoss), () => R.listPacers(asBoss), () => R.listChecklist(asBoss), () => R.listRegs(asBoss), () => R.listQuals(asBoss),
  () => R.overview(asBoss), () => R.listPlan({ token: TOK.boss, ev: EV, kinds: ['budget', 'sponsor', 'supply', 'approval', 'ceremony', 'task', 'contact', 'doc', 'lesson'] }), () => R.dashboard(asBoss), () => R.racesSummary({ token: TOK.boss }), () => R.expoSummary(asBoss),
  () => R.listTeam({ token: TOK.boss }), () => R.whoami({ token: TOK.boss }), () => R.eventInfo(asBoss), () => R.aiStatus({ token: TOK.boss }), () => R.openEvents(), () => R.openShifts({ ev: EV }),
  () => X.whoami({ token: TOK.desk1 }), () => X.loadPage({ token: TOK.desk1 }), () => X.listEvents({ token: TOK.boss }), () => X.whoami({ token: TOK.boss }),
  () => T.listAthletes({ token: TOK.boss }), () => T.athleteDetail({ token: TOK.boss, id: ath1 }), () => T.listCoaches({ token: TOK.boss }), () => T.listPlans({ token: TOK.boss }), () => T.getTrainSettings(), () => T.openPlans(), () => T.myHome({ token: TOK.ath }), () => T.mySessions({ token: TOK.ath }), () => T.tWhoami({ token: TOK.boss }),
  () => F.finOverview(asBoss), () => F.finSettings(asBoss), () => F.finListInvoices(asBoss), () => F.finListOrders(asBoss), () => F.finListClaims(asBoss), () => F.finCash(asBoss), () => F.finLedger(asBoss), () => F.finListClaims({ token: TOK.lead1, ev: EV }),
];
{
  const bad = [];
  let answered = 0;
  for (const read of READS) {
    let r;
    try {
      r = await read();
      answered++;
    } catch (e) {
      SEEN.add(e.message);
      continue;
    }
    const l = leaks(r);
    if (l.length) bad.push(read.toString().slice(6, 40) + ' ' + l.join(','));
  }
  ok(answered >= 36, 'S6 control: ' + answered + ' of ' + READS.length + ' screens\' calls were answered with real data');
  ok(!bad.length, 'S6 no answer holds a password, PIN hash, salt, failure count, lock time or token' + (bad.length ? ' [' + bad.join('; ') + ']' : ''));
}
const edited = await R.saveTeam({ token: TOK.boss, username: 'new.lead', name: 'New Lead', role: 'lead', edit: true });
ok(edited.secret === '' && !leaks(edited).filter((x) => !/\.secret$/.test(x)).length, 'S6 changing a login (without a new password) shows no secret at all');
// the answers that show a secret once must do it only there
const onceOnly = leaks(made).concat(leaks(reset)).filter((x) => !/\.secret$/.test(x));
ok(!onceOnly.length, 'S6 a new or reset login shows its secret in one field and nothing else secret' + (onceOnly.length ? ' [' + onceOnly + ']' : ''));
// errors: a short code or a plain sentence, never a stack trace, a file name, a key or a password
const LEAK = /TypeError|ReferenceError|RangeError|SyntaxError|Cannot read|Cannot set|is not a function|is not iterable|Unexpected|\bat \w+.*\.(js|mjs)|node_modules|\/home\/|\/tmp\/|racedir|exposoft|training\.web|k-test|h1\$/;
const seen = [...SEEN].filter(Boolean);
ok(seen.length > 15, 'S6 control: ' + seen.length + ' different error texts were collected on the way');
ok(seen.every((m) => !LEAK.test(m) && ![made.secret, reset.secret, 'Sec-pass-1', 'Typed-Pass-77', ATH_PIN, ...Object.values(TOK)].some((s) => m.includes(s))), 'S6 not one error text holds a stack trace, a file name, the setup key, a hash, a password or a token');
ok(seen.every((m) => /^[a-z][a-z0-9_]{1,40}$/.test(m)), 'S6 every error is a short code (' + seen.filter((m) => !/^[a-z][a-z0-9_]{1,40}$/.test(m)).join(' | ') + ')');

/* =====================================================================================================
   S7. Database set-up and the setup key
   ===================================================================================================== */
async function capture(run) {
  const defs = [];
  const made = new Set();
  const realQuery = wd.query;
  const realCreate = collections.createDataCollection;
  wd.query = (c) => {
    const q = realQuery.call(wd, c);
    if (!made.has(c)) q.find = async () => { throw new Error('WDE0025: collection does not exist'); };
    return q;
  };
  collections.createDataCollection = async (d) => {
    defs.push(d);
    made.add(d._id);
    return d;
  };
  try {
    await run();
  } finally {
    wd.query = realQuery;
    collections.createDataCollection = realCreate;
  }
  return defs;
}
const consts = (text) => [...text.matchAll(/^const ([A-Z][A-Z0-9_]*) = '([A-Z][A-Za-z0-9]+)';/gm)].map((m) => m[2]);
const rdText = src('wix/director/racedir.web.js');
const trText = src('wix/training/training.web.js');
const rdDefs = await capture(() => R.ensureSetup({ key: 'k-test', username: 'someone', password: 'Setup-pass-12' }));
const trDefs = await capture(() => T.ensureTrainSetup({ key: 'k-test' }));
const expected = (t) => (t.match(/^\s+def\(\w+,/gm) || []).length;
ok(rdDefs.length === expected(rdText) && rdDefs.length >= 19, 'S7 RaceOS setup creates all ' + expected(rdText) + ' collections (made ' + rdDefs.length + ')');
ok(trDefs.length === expected(trText) && trDefs.length >= 7, 'S7 Training setup creates all ' + expected(trText) + ' of its collections (made ' + trDefs.length + ')');
const locked = (d) => d.permissions && ['read', 'insert', 'update', 'remove'].every((k) => d.permissions[k] === 'ADMIN');
ok(rdDefs.every(locked), 'S7 every RaceOS collection can be read, added to, changed and emptied only by the site admin (never by a visitor, who could otherwise read logins and sessions)');
ok(trDefs.every(locked), 'S7 every Training collection likewise (athlete PIN hashes, tokens, messages)');
const finText = src('wix/director/finance.web.js');
ok(finDefs.length === expected(finText) && finDefs.length === 5 && finDefs.every(locked), 'S7 Finance makes its ' + finDefs.length + ' collections on first use, each readable, changeable and emptied only by the site admin (invoices, orders, claims, the ledger and the details printed on invoices are never open to a visitor)');
eq(finDefs.map((d) => d._id).sort(), FIN_COLS.slice().sort(), 'S7 and they are exactly invoices, orders, claims, the ledger and the Finance settings');
ok(finDefs.every((d) => d.fields.length >= 5 && d.fields.every((f) => f.type === 'TEXT')), 'S7 each has its fields (stored as text, so a number can never be turned into a float by the database)');
const rdIds = new Set(rdDefs.map((d) => d._id));
const trIds = new Set(trDefs.map((d) => d._id));
const missing = (names, have) => names.filter((n) => !have.has(n));
ok(!missing(consts(rdText), rdIds).length, 'S7 every collection RaceOS uses is created by its setup' + (missing(consts(rdText), rdIds).length ? ' [' + missing(consts(rdText), rdIds) + ']' : ''));
ok(!missing(consts(src('wix/expo/exposoft.web.js')), rdIds).length, 'S7 every collection the Expo desk uses is created by the RaceOS setup (it has none of its own)' + (missing(consts(src('wix/expo/exposoft.web.js')), rdIds).length ? ' [' + missing(consts(src('wix/expo/exposoft.web.js')), rdIds) + ']' : ''));
ok(!missing(consts(trText), new Set([...trIds, ...rdIds])).length, 'S7 every collection Training uses is created by its own or the RaceOS setup' + (missing(consts(trText), new Set([...trIds, ...rdIds])).length ? ' [' + missing(consts(trText), new Set([...trIds, ...rdIds])) + ']' : ''));
ok(!missing(consts(finText), new Set([...finDefs.map((d) => d._id), ...rdIds])).length, 'S7 every collection Finance uses is created by its own set-up or the RaceOS one' + (missing(consts(finText), new Set([...finDefs.map((d) => d._id), ...rdIds])).length ? ' [' + missing(consts(finText), new Set([...finDefs.map((d) => d._id), ...rdIds])) + ']' : ''));
ok(['ExpoStaff', 'ExpoSessions', 'RDRate', 'RDAudit'].every((c) => rdIds.has(c)) && ['TrainAthletes'].every((c) => trIds.has(c)), 'S7 the collections that hold logins, sessions, tries and audit notes are among them');
// the key
for (const [name, text] of [['racedir.web.js', rdText], ['training.web.js', trText]]) {
  ok(/^const SETUP_KEY = 'change-this-key';/m.test(text), 'S7 ' + name + ' ships with the placeholder key, so no real key is in the repository');
  const lines = text.split('\n').filter((l) => /SETUP_KEY/.test(l) && !/^\s*\/\//.test(l));
  ok(lines.every((l) => /^const SETUP_KEY = 'change-this-key'/.test(l) || /SETUP_KEY === 'change-this-key'\) throw/.test(l) || /same\(String\(arg\.key \|\| ''\), SETUP_KEY\)/.test(l)), 'S7 ' + name + ': the key is only compared with the constant-time check, plus the placeholder guard');
}
async function shipped(file, out) {
  const s = src(file).replace("'./ai-core.js'", "'./ai-core.test.mjs'").replace("'./rd-approvals.js'", "'./rd-approvals.test.mjs'").replace("'./rd-auth.js'", "'./rd-auth.test.mjs'");
  fs.writeFileSync(new URL('./' + out, import.meta.url), s);
  return import('./' + out);
}
{
  const SR = await shipped('wix/director/racedir.web.js', 'racedir.shipped.test.mjs');
  const ST = await shipped('wix/training/training.web.js', 'training.shipped.test.mjs');
  const before = DB.ExpoStaff.size;
  const w = WRITES.length;
  for (const arg of [{ key: 'change-this-key', username: 'evil', password: 'Evil-pass-12' }, { key: '', username: 'evil', password: 'Evil-pass-12' }, {}, undefined, { key: ['change-this-key'] }]) {
    const m = await err(SR.ensureSetup(arg));
    ok(/^Edit SETUP_KEY/.test(m), 'S7 RaceOS setup with the placeholder key left in the file refuses everyone, even with that key: "' + m.slice(0, 40) + '"');
    const t = await err(ST.ensureTrainSetup(arg));
    ok(/^Edit SETUP_KEY/.test(t), 'S7 and so does Training: "' + t.slice(0, 40) + '"');
  }
  ok(WRITES.length === w && DB.ExpoStaff.size === before && !rowOf('evil'), 'S7 and none of those calls wrote anything or made a login');
}

/* =====================================================================================================
   S8. The shipped files
   ===================================================================================================== */
const walk = (rel, out) => {
  out = out || [];
  for (const e of fs.readdirSync(new URL('../' + rel, import.meta.url), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('mut-')) continue;
    if (e.isDirectory()) walk(rel + '/' + e.name, out);
    else if (/\.(js|mjs|html|md|json|txt|py|sh|css)$/.test(e.name)) out.push(rel + '/' + e.name);
  }
  return out;
};
const SHIPPED = ['wix', 'docs', 'tools'].flatMap((d) => (fs.existsSync(new URL('../' + d, import.meta.url)) ? walk(d) : [])).concat(fs.readdirSync(new URL('..', import.meta.url)).filter((f) => /\.(md|txt|json|sh)$/.test(f)));
ok(SHIPPED.length > 20, 'S8 control: ' + SHIPPED.length + ' shipped files scanned');
const SHAPES = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9]{32,}/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\b(api[_-]?key|secret|token|password)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{24,}['"]/i];
const found = [];
for (const f of SHIPPED) {
  const text = src(f);
  for (const re of SHAPES) if (re.test(text)) found.push(f + ' ' + re);
}
ok(!found.length, 'S8 no private key, access token or API key is written in any shipped file' + (found.length ? ' [' + found + ']' : ''));
const WIXJS = SHIPPED.filter((f) => /^wix\/.*\.js$/.test(f));
const DANGER = /\beval\s*\(|new Function\s*\(|(^|[^.\w])Function\s*\(|child_process|\brequire\s*\(/;
ok(WIXJS.every((f) => !DANGER.test(src(f))), 'S8 no backend or page code calls eval, new Function, require or child_process' + WIXJS.filter((f) => DANGER.test(src(f))));
const EMBEDS = SHIPPED.filter((f) => /^wix\/.*\.html$/.test(f) && !/rd-embed\.html$/.test(f));
const DANGER_HTML = /\beval\s*\(|new Function\s*\(|document\.write\s*\(|insertAdjacentHTML|\.outerHTML\s*=|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/;
ok(EMBEDS.length >= 5 && EMBEDS.every((f) => !DANGER_HTML.test(src(f))), 'S8 none of the ' + EMBEDS.length + ' screens uses eval, new Function, document.write, insertAdjacentHTML or a timer given as text' + EMBEDS.filter((f) => DANGER_HTML.test(src(f))));
const logged = WIXJS.flatMap((f) => src(f).split('\n').filter((l) => /console\.(log|info|warn|error|debug)\(/.test(l) && /\b(password|passwd|token|pin|secret|setup[_ ]?key|authorization)\b/i.test(l)).map((l) => f + ': ' + l.trim().slice(0, 80)));
ok(!logged.length, 'S8 no log line prints a password, PIN, token or key' + (logged.length ? ' [' + logged + ']' : ''));
ok(!/Math\.random/.test(src('wix/director/rd-auth.js').replace(/\/\/[^\n]*/g, '').replace(/return Math\.floor\(Math\.random\(\) \* 0x100000000\) >>> 0;/, '')), 'S8 tokens, PINs and passwords use the platform\'s secure random numbers; Math.random is only the last-resort fallback');
// the page code in front of each screen offers exactly what that screen needs
const listOf = (file, name) => {
  const m = src(file).match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
};
const DP = 'wix/director/director-page-code.js';
const ALLOWED = listOf(DP, 'ALLOWED');
const EXPO_ALLOWED = listOf(DP, 'EXPO_ALLOWED');
const TRAIN_ALLOWED = listOf(DP, 'TRAIN_ALLOWED');
const FIN_ALLOWED = listOf(DP, 'FIN_ALLOWED');
ok(ALLOWED && EXPO_ALLOWED && TRAIN_ALLOWED && FIN_ALLOWED, 'S8 the director page has its four lists (RaceOS, Expo desk, Coaching, Finance)');
ok(ALLOWED.every((n) => RD_NAMES.includes(n)) && EXPO_ALLOWED.every((n) => BACKENDS[1].names.includes(n)) && TRAIN_ALLOWED.every((n) => BACKENDS[2].names.includes(n)) && FIN_ALLOWED.every((n) => BACKENDS[3].names.includes(n)), 'S8 every name on those lists exists in its backend (else the screen would say "backend old")');
ok(!['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'].some((n) => ALLOWED.includes(n)), 'S8 the director page does not carry the public volunteer methods');
ok(RD_NAMES.filter((n) => !ALLOWED.includes(n) && !['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'].includes(n)).length === 0, 'S8 and every other RaceOS method is reachable from it (none forgotten)' + RD_NAMES.filter((n) => !ALLOWED.includes(n) && !['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'].includes(n)));
ok(!EXPO_ALLOWED.some((n) => ['login', 'logout', 'ensureSetup', 'tLogin'].includes(n)), 'S8 the Expo desk list has no login, logout or setup (it has no login of its own)');
ok(TRAIN_ALLOWED.every((n) => TR_LEVEL[n] === 'staff' || TR_LEVEL[n] === 'manage'), 'S8 the Coaching list from the director page holds only coach and director methods, no athlete method');
eq(listOf('wix/director/volunteer-page-code.js', 'ALLOWED'), ['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'], 'S8 the public volunteer page offers exactly the four public methods');
const ATH_OK = ['openPlans', 'athleteSignup', 'athleteLogin', 'athleteLogout'];
const athList = listOf('wix/training/athlete-page-code.js', 'ALLOWED');
ok(athList.every((n) => ATH_OK.includes(n) || TR_LEVEL[n] === 'athlete') && athList.every((n) => BACKENDS[2].names.includes(n)), 'S8 the athlete page offers only athlete methods');
const coachList = listOf('wix/training/coach-page-code.js', 'ALLOWED');
ok(coachList.every((n) => BACKENDS[2].names.includes(n) && TR_LEVEL[n] !== 'athlete' && !['athleteSignup', 'athleteLogin', 'athleteLogout', 'ensureTrainSetup'].includes(n)), 'S8 the coach page offers no athlete method and no setup');
ok(![...athList, ...coachList, ...(listOf('wix/director/volunteer-page-code.js', 'ALLOWED') || [])].includes('ensureTrainSetup') && !listOf('wix/director/volunteer-page-code.js', 'ALLOWED').includes('ensureSetup'), 'S8 setup is reachable only from the director page (RaceOS) and by calling the backend directly with the key');
// Finance: offered by the director page only, every method reachable, and written so that money records are never deleted
eq(FIN_ALLOWED.slice().sort(), BACKENDS[3].names.slice().sort(), 'S8 the director page offers exactly the 23 Finance methods (none forgotten, none extra)');
ok(![...athList, ...coachList, ...(listOf('wix/director/volunteer-page-code.js', 'ALLOWED') || [])].some((n) => /^fin[A-Z]/.test(n)) && ![...ALLOWED, ...EXPO_ALLOWED, ...TRAIN_ALLOWED].some((n) => BACKENDS[3].names.includes(n)), 'S8 no other page (volunteer, athlete, coach) and no other list carries a Finance method');
{
  const pc = src(DP);
  ok(/import \* as fin from 'backend\/finance\.web';/.test(pc) && /msg\.mod === 'fin'/.test(pc) && /FIN_ALLOWED\.indexOf\(msg\.method\) < 0\) return refuse\(msg\)/.test(pc), 'S8 the page code imports Finance and refuses a Finance call that is not on its list');
  ok(/const webMethod = \(permission, fn\) =>\s*wixWebMethod\(permission, async \(arg\) => \{\s*try \{\s*return await fn\(arg\);\s*\} catch \(e\) \{\s*throw tidyError\(e, 'finance'\);/.test(finText), 'S8 every Finance method answers through the wrapper that turns an unexpected error into "server_error"');
  const lines = finText.split('\n');
  const callsOf = (re) => lines.map((l, i) => [l, i + 1]).filter(([l]) => re.test(l));
  const noSA = callsOf(/wixData\.(insert|update|save|get|bulkRemove|bulkInsert|bulkUpdate)\(/).filter(([l]) => !/SA\)/.test(l)).map(([l, i]) => i + ': ' + l.trim().slice(0, 60));
  ok(!noSA.length, 'S8 every Finance read and write of a locked collection passes suppressAuth (the collections are admin-only, so without it the live site would refuse)' + (noSA.length ? ' [' + noSA + ']' : ''));
  const stmts = finText.split(/;\s*\n/);
  const queries = stmts.filter((x) => /wixData\.query\(/.test(x));
  const noSAq = queries.filter((x) => !/\.find\(SA\)/.test(x) && !/all\(\(\) => wixData\.query\(/.test(x)).map((x) => x.trim().slice(0, 60));
  ok(queries.length >= 8 && !noSAq.length, 'S8 and so does every query (' + queries.length + ' of them end in find(SA), or are handed to the helper that does)' + (noSAq.length ? ' [' + noSAq + ']' : ''));
  eq((finText.match(/bulkRemove\(LED/g) || []).length, 1, 'S8 only one place in Finance removes a ledger row: taking back a cash payment that would overspend the cash held');
  ok(/async function verifyCash[\s\S]*?bulkRemove\(LED, \[newId\], SA\)[\s\S]*?not_enough_cash/.test(finText), 'S8 and that one is the cash check that has just been added by the same call');
  ok(!/bulkRemove\((INVS|ORDS|CLMS)\b|\.remove\(|bulkRemove\(\s*['"]/.test(finText), 'S8 nothing removes an invoice, an order or a claim (they are cancelled, never deleted)');
  ok(!/arg\.(username|user|role|by|byName|me|as)\b/.test(finText), 'S8 no Finance method reads who is asking from the call (the session token is the only identity)');
  ok(!/(parseFloat|parseInt|Number)\(\s*arg\./.test(finText) && /toPaise\(arg\.amount/.test(finText), 'S8 money from the call always passes through the one exact conversion (toPaise), never a loose Number() or parseFloat()');
  const mutating = [...finText.matchAll(/^export const (fin(?:Raise|Pay|Add|Save|Void|Refund|Decide|Cancel)\w*) = webMethod/gm)].map((m) => m[1]);
  const creates = ['finRaiseInvoice', 'finSaveOrder', 'finSaveClaim', 'finPayInvoice', 'finAddBill', 'finPayOrder', 'finRefundOrder', 'finPayClaim', 'finAddCash', 'finAddEntry'];
  const bodyOf = (n) => (BACKENDS[3].methods.find((m) => m.name === n) || { body: '' }).body;
  const noOnce = creates.filter((n) => !/await once\(a, '\w+', arg\.key/.test(bodyOf(n)));
  ok(!noOnce.length && mutating.length >= 15, 'S8 every Finance call that creates or pays something can be sent twice safely (it goes through the repeat guard)' + (noOnce.length ? ' [' + noOnce + ']' : ''));
}
// source collections of the race lists are only ever read
{
  const w = WRITES.length;
  await X.previewFindMyBib({ token: TOK.boss, ev: 'Import910' }).catch(() => null);
  await X.syncFromFindMyBib({ token: TOK.boss, ev: 'Import910' }).catch(() => null);
  await X.importRunners({ token: TOK.boss, ev: 'Import910', rows: [{ bib: '9001', name: 'Sec Runner', cat: '10K', size: 'M' }] }).catch(() => null);
  await X.removeSample({ token: TOK.boss, ev: 'Import910' }).catch(() => null);
  const touched = WRITES.slice(w).filter((x) => /:Import\d+$/.test(x));
  ok(!touched.length && !WRITES.some((x) => /:Import\d+$/.test(x)), 'S8 nothing in this whole suite, including a sync and an import, wrote to a findmybib "Import…" collection' + (touched.length ? ' [' + touched + ']' : ''));
}

done();
