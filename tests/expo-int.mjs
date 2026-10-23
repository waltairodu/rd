// Tests for the BIB and Expo integration: bib plan, bib assignment, sending to the Expo desk, live figures, alerts.
import * as D from './racedir.test.mjs';
import * as X from './exposoft.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const err = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const day = (o) => new Date(Date.now() + 5.5 * 3600000 + o * 86400000).toISOString().slice(0, 10);
for (const [u, r] of [['boss', 'admin'], ['lead1', 'lead'], ['view1', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);
const L = async (u) => (await D.login({ username: u, password: 'pw' })).token;
const B = await L('boss'), LD = await L('lead1'), V = await L('view1');
const XID = 'VHM5';
await wd.insert('ExpoConfig', { _id: XID, name: 'VHM 5th edition', json: JSON.stringify({ bibLot: 5, shirtLot: { S: 1, M: 10, L: 10 } }) }, SA);
const E = (await D.saveEvent({ token: B, name: 'VHM', date: day(5), venue: 'RK Beach', expoId: XID })).event.id;
const reg = (n, cat, status, size, at) => wd.insert('RDRegs', { _id: E + '~t' + n, event: E, ticketNumber: 't' + n, name: 'Runner ' + n, cat, status, size, at: at || day(-20 + n) + 'T05:00:00.000Z', phone: '98765432' + String(10 + n), email: 'r' + n + '@x.com', bibName: '' }, SA);
await reg(1, '21.1K - Half Marathon', 'ok', 'M'); await reg(2, '21.1K', 'ok', 'S'); await reg(3, '21.1K', 'ok', 'S'); await reg(4, '10K Run', 'ok', 'L');
await reg(5, '10K', 'unpaid', 'L'); await reg(6, '5K', 'ok', 'Large'); await reg(7, '21.1K', 'ok', 'M');

// ---- who can do what
ok((await err(D.saveBibPlan({ token: LD, ev: E, bibs: [] }))) === 'director_only', 'lead cannot save the bib plan');
ok((await err(D.assignBibs({ token: V, ev: E }))) === 'director_only', 'viewer cannot assign bibs');
ok((await err(D.sendToExpo({ token: LD, ev: E }))) === 'director_only', 'lead cannot send to Expo');
ok((await err(D.expoRaces({ token: LD }))) === 'director_only', 'lead cannot list Expo races');
ok((await err(D.assignBibs({ ev: E }))) === 'not_logged_in', 'no login refused');
ok((await D.expoRaces({ token: B })).races.some((r) => r.id === XID && r.name === 'VHM 5th edition'), 'Expo races listed for the picker');

// ---- bib plan validation
for (const [m, b] of [['not a list', 'x'], ['short name', [{ cat: 'x', from: 1, to: 5 }]], ['from after to', [{ cat: '10K', from: 9, to: 2 }]], ['zero', [{ cat: '10K', from: 0, to: 5 }]], ['fraction', [{ cat: '10K', from: 1.5, to: 5 }]], ['too big', [{ cat: '10K', from: 1, to: 100000 }]], ['overlap', [{ cat: '10K', from: 1, to: 50 }, { cat: '5K', from: 50, to: 90 }]], ['same category twice', [{ cat: '10K', from: 1, to: 5 }, { cat: '10 k', from: 6, to: 9 }]], ['text numbers', [{ cat: '10K', from: 'a', to: 'b' }]]])
  ok((await err(D.saveBibPlan({ token: B, ev: E, bibs: b }))) === 'bad_bibs', 'bib plan refused: ' + m);
ok((await err(D.assignBibs({ token: B, ev: E }))) === 'no_bib_plan', 'cannot assign before there is a plan');
await D.saveBibPlan({ token: B, ev: E, bibs: [{ cat: '21.1K', from: 1001, to: 1002 }, { cat: '10K', from: 2001, to: 2999 }] });
ok((await D.listEvents({ token: V })).events.find((x) => x.id === E).bibs.length === 2, 'plan comes back with the race');
ok((await D.saveEvent({ token: B, id: E, venue: 'Beach Road' })).event.bibs.length === 2, 'editing the race keeps the plan');

// ---- assign
const a1 = await D.assignBibs({ token: B, ev: E });
const regs = async () => (await wd.query('RDRegs').eq('event', E).limit(100).find(SA)).items;
const bibOf = async (n) => (await regs()).find((r) => r.ticketNumber === 't' + n).bib;
ok(a1.assigned === 3, 'assigned 3: ' + JSON.stringify(a1));
ok((await bibOf(1)) === '1001' && (await bibOf(2)) === '1002', 'first come first numbered, in the right range; "21.1K - Half Marathon" uses the 21.1K range');
ok(!(await bibOf(3)), 'range full: third 21.1K runner gets nothing');
ok(a1.full['21.1K'] === 2 && a1.noRange['5K'] === 1, 'full and missing-range reported: ' + JSON.stringify([a1.full, a1.noRange]));
ok((await bibOf(4)) === '2001', '10K Run gets 10K range');
ok(!(await bibOf(5)) && a1.unpaid === 1, 'unpaid runner gets no bib');
const a2 = await D.assignBibs({ token: B, ev: E });
ok(a2.assigned === 0 && a2.alreadyHad === 3, 'running it again changes nothing');
ok((await bibOf(1)) === '1001', 'existing bibs never change');
// widen range, assign the rest
await D.saveBibPlan({ token: B, ev: E, bibs: [{ cat: '21.1K', from: 1001, to: 1099 }, { cat: '10K', from: 2001, to: 2999 }, { cat: '5K', from: 3001, to: 3100 }] });
const a3 = await D.assignBibs({ token: B, ev: E });
ok(a3.assigned === 3 && (await bibOf(3)) === '1003' && (await bibOf(7)) === '1004' && (await bibOf(6)) === '3001', 'after widening: the rest are numbered in order');
// numbers already in the Expo list are skipped
await wd.insert('Runners', { _id: XID + '~2002', event: XID, bib: '2002', name: 'Findmybib Person', cat: '10K', size: 'M', phone: '', email: '', example: '', checkedInAt: '', bibAt: '', shirtAt: '', shirtSize: '' }, SA);
await reg(8, '10K', 'ok', 'M'); await reg(9, '10K', 'ok', 'M');
await D.assignBibs({ token: B, ev: E });
ok((await bibOf(8)) === '2003' || (await bibOf(8)) === '2002' === false, 'Expo-held bib 2002 is skipped: ' + (await bibOf(8)));
ok([await bibOf(8), await bibOf(9)].every((b) => b !== '2002'), 'nobody gets a number the Expo list already has');

// ---- manual bib
const r4 = (await regs()).find((r) => r.ticketNumber === 't4');
ok((await err(D.setBib({ token: B, ev: E, id: r4._id, bib: '1001' }))) === 'bib_taken', 'cannot take a number another runner has');
ok((await err(D.setBib({ token: B, ev: E, id: r4._id, bib: '2002' }))) === 'bib_taken', 'cannot take a number the Expo list has');
ok((await err(D.setBib({ token: B, ev: E, id: r4._id, bib: 'a b!' }))) === 'bad_bib', 'bad number refused');
ok((await err(D.setBib({ token: B, ev: E, id: 'nope', bib: '77' }))) === 'no_registration', 'unknown registration');
ok((await D.setBib({ token: B, ev: E, id: r4._id, bib: '2500' })).bib === '2500' && (await bibOf(4)) === '2500', 'manual number set before sending');

// ---- send to Expo
const s1 = await D.sendToExpo({ token: B, ev: E });
const runners = async () => (await wd.query('Runners').eq('event', XID).limit(100).find(SA)).items;
ok(s1.added >= 7 && s1.unpaid === 0 && s1.noBib === 0, 'sent: ' + JSON.stringify(s1));
const rn = (await runners()).find((r) => r.bib === '1001');
ok(rn && rn.name === 'Runner 1' && rn.cat === '21.1K - Half Marathon'.slice(0, 20) && rn.size === 'M' && rn.checkedInAt === '' && rn.bibAt === '' && rn.shirtAt === '', 'new Expo row is clean: no check-in, bib or shirt given');
ok((await runners()).find((r) => r.bib === '3001').size === 'L', '"Large" becomes size L');
ok(!(await runners()).some((r) => r.name === 'Runner 5'), 'unpaid runner not sent');
const s2 = await D.sendToExpo({ token: B, ev: E });
ok(s2.added === 0 && s2.same >= 7, 'sending again adds nothing: ' + JSON.stringify(s2));
ok((await runners()).length === 1 + 8, 'no duplicates in the Expo list: ' + (await runners()).length);
// the Expo desk issues a bib and a shirt; then a registration changes
await X.login === undefined;
const row = (await runners()).find((r) => r.bib === '1001');
await wd.update('Runners', Object.assign({}, row, { bibAt: new Date().toISOString(), bibDesk: 'bib', shirtAt: new Date().toISOString(), shirtSize: 'M', shirtDesk: 'tshirt', checkedInAt: new Date().toISOString(), checkedInDesk: 'checkin' }), SA);
const reg1 = (await regs()).find((r) => r.ticketNumber === 't1');
await wd.update('RDRegs', Object.assign({}, reg1, { size: 'XL', phone: '9999999999', name: 'Runner 1' }), SA);
const s3 = await D.sendToExpo({ token: B, ev: E });
const row2 = (await runners()).find((r) => r.bib === '1001');
ok(s3.locked >= 1 && row2.size === 'M' && row2.phone === row.phone && row2.shirtSize === 'M' && row2.bibAt, 'a handed-over row is not touched, shirt size stays locked');
// a row findmybib created with a different person on the same bib: never overwritten
const bad = (await regs()).find((r) => r.ticketNumber === 't2');
await wd.update('Runners', Object.assign({}, (await runners()).find((r) => r.bib === '1002'), { name: 'Somebody Else' }), SA);
const s4 = await D.sendToExpo({ token: B, ev: E });
ok(s4.conflicts.includes('1002') && (await runners()).find((r) => r.bib === '1002').name === 'Somebody Else', 'same number, different person: reported, not overwritten');
// empty fields are filled, existing values are kept
await wd.update('Runners', Object.assign({}, (await runners()).find((r) => r.bib === '1003'), { size: '', phone: '' }), SA);
const s5 = await D.sendToExpo({ token: B, ev: E });
const r1003 = (await runners()).find((r) => r.bib === '1003');
ok(s5.filled >= 1 && r1003.size === 'S' && r1003.phone.length === 10, 'empty size and phone filled from the registration');
// payment lapses after sending
await wd.update('RDRegs', Object.assign({}, (await regs()).find((r) => r.ticketNumber === 't4'), { status: 'unpaid' }), SA);
const s6 = await D.sendToExpo({ token: B, ev: E });
ok(s6.unpaid === 1 && (await runners()).some((r) => r.bib === '2500'), 'an unpaid runner already at the desk is reported, never deleted');
await wd.update('RDRegs', Object.assign({}, (await regs()).find((r) => r.ticketNumber === 't4'), { status: 'ok' }), SA);
// bib change after sending is refused
ok((await err(D.setBib({ token: B, ev: E, id: r4._id, bib: '2600' }))) === 'bib_in_expo', 'bib cannot change once the runner is in the Expo list');
// link problems
const E2 = (await D.saveEvent({ token: B, name: 'No link', date: day(30) })).event.id;
ok((await err(D.sendToExpo({ token: B, ev: E2 }))) === 'no_expo_link', 'no Expo link');
const E3 = (await D.saveEvent({ token: B, name: 'Bad link', date: day(30), expoId: 'Nope' })).event.id;
ok((await err(D.sendToExpo({ token: B, ev: E3 }))) === 'expo_race_missing', 'Expo race does not exist');

// ---- live figures
const row3 = (await runners()).find((r) => r.bib === '3001');
await wd.update('Runners', Object.assign({}, row3, { bibAt: new Date().toISOString(), bibDesk: 'bib' }), SA);
await reg(10, '5K', 'ok', 'M'); await D.assignBibs({ token: B, ev: E });
const sm = await D.expoSummary({ token: V, ev: E });
ok(sm.linked && sm.expoName === 'VHM 5th edition', 'summary knows the Expo race');
ok(sm.totals.runners === 9 && sm.totals.bibs === 2 && sm.totals.shirts === 1 && sm.totals.checkedIn === 1, 'totals: ' + JSON.stringify(sm.totals));
ok(sm.byCat.length >= 3 && sm.byCat.reduce((t, c) => t + c.total, 0) === 9, 'per-category counts');
const S = sm.sizes.find((z) => z.size === 'S');
ok(S.stock === 1 && S.demand >= 2 && S.short === true && sm.sizes.find((z) => z.size === 'M').short === false, 'T-shirt demand beyond stock is flagged: ' + JSON.stringify(S));
ok(sm.sizes.find((z) => z.size === 'XS').stock === 0 && !sm.sizes.find((z) => z.size === 'XS').short, 'no stock entered is not flagged');
ok(sm.desks.find((d) => d.desk === 'bib').bibs === 2 && sm.desks.find((d) => d.desk === 'tshirt').shirts === 1, 'per-desk counts');
ok(sm.recent.length > 0 && sm.recent[0].who && !/\d{5}|@/.test(JSON.stringify(sm.recent)) && sm.recent.every((x) => x.who.split(' ').length <= 2), 'recent activity shows shortened names only');
ok(!JSON.stringify(sm).includes('9999999999') && !JSON.stringify(sm).includes('@x.com'), 'no phone numbers or e-mails in the summary');
ok(sm.sync.paid === 9 && sm.sync.noBib === 0 && sm.sync.notSent === 1, 'sync status: ' + JSON.stringify(sm.sync));
ok(sm.plan.length === 3 && sm.plan[0].used === 4 && sm.plan[0].size === 99, 'bib plan usage: ' + JSON.stringify(sm.plan[0]));
ok((await D.expoSummary({ token: V, ev: E2 })).linked === false, 'unlinked race: summary says not linked');
ok((await err(D.expoSummary({ ev: E }))) === 'not_logged_in', 'summary needs a login');

// ---- alerts on the overview
const ov = await D.overview({ token: V, ev: E });
const txts = ov.alerts.map((a) => a.text).join(' | ');
ok(/not sent to the Expo desk/.test(txts) && /T-shirt stock is short for size S/.test(txts) && /More runners \(9\) than printed bibs \(5\)/.test(txts), 'overview alerts: ' + txts);
ok(ov.alerts.filter((a) => a.go === 'bibs').length >= 3, 'alerts point to the bibs tab');
await D.sendToExpo({ token: B, ev: E });
const ov2 = await D.overview({ token: V, ev: E });
ok(!/not sent to the Expo desk/.test(ov2.alerts.map((a) => a.text).join('|')), 'alert clears once sent');
const far = (await D.saveEvent({ token: B, name: 'Far off', date: day(120), expoId: XID })).event.id;
ok(!(await D.overview({ token: B, ev: far })).alerts.some((a) => a.go === 'bibs'), 'no Expo alerts months before the race');
const gone = (await D.saveEvent({ token: B, name: 'Gone', date: day(3), expoId: 'Missing' })).event.id;
ok((await D.overview({ token: B, ev: gone })).alerts.some((a) => /was not found/.test(a.text)), 'alert when the linked Expo race is missing');
const lr = await D.listRegs({ token: B, ev: E });
ok(lr.rows.some((r) => r.bib === '1001'), 'registration list shows bibs');

console.log(`Expo integration: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
