// Scenario tests for categories and fees, and the dashboard figures (registrations, capacity, takings, trend, race cards).
import * as D from './racedir.test.mjs';
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
const E = (await D.saveEvent({ token: B, name: 'VHM', date: day(30), venue: 'RK Beach' })).event.id;
const E2 = (await D.saveEvent({ token: B, name: 'Ultribe', date: day(60), venue: 'Paderu' })).event.id;
const arch = (await D.saveEvent({ token: B, name: 'Old race', date: day(-300) })).event.id;
await D.saveEvent({ token: B, id: arch, status: 'archived' });

// ---- categories: who may save, what is refused
const CATS = [{ name: '21.1K', km: 21.1, price: 1500, cap: 100 }, { name: '10K', km: 10, price: 800, cap: 50 }, { name: '5K', km: 5, price: 500, cap: 0 }];
ok((await err(D.saveCats({ token: LD, ev: E, cats: CATS }))) === 'director_only', 'lead cannot save categories');
ok((await err(D.saveCats({ token: V, ev: E, cats: CATS }))) === 'director_only', 'viewer cannot save categories');
ok((await err(D.saveCats({ ev: E, cats: CATS }))) === 'not_logged_in', 'no login refused');
for (const [m, c] of [['not a list', 'x'], ['too short a name', [{ name: 'x' }]], ['same name twice', [{ name: '10K' }, { name: '10 k' }]], ['negative price', [{ name: '10K', price: -1 }]],
  ['text price', [{ name: '10K', price: 'abc' }]], ['fractional limit', [{ name: '10K', cap: 2.5 }]], ['huge distance', [{ name: '10K', km: 5000 }]], ['21 categories', Array.from({ length: 21 }, (_, i) => ({ name: 'Cat ' + i }))]])
  ok((await err(D.saveCats({ token: B, ev: E, cats: c }))) === 'bad_cats', 'refused: ' + m);
ok((await err(D.saveCats({ token: B, ev: 'nope', cats: CATS }))) === 'no_event', 'missing race');
const sv = await D.saveCats({ token: B, ev: E, cats: CATS.concat([{ name: '<b>Kids</b>' }]) });
ok(sv.cats.length === 4 && sv.cats[3].price === 0 && sv.cats[3].cap === 0 && sv.cats[3].km === 0, 'blank numbers become zero');
await D.saveCats({ token: B, ev: E, cats: CATS });
const ev = (await D.listEvents({ token: V })).events.find((x) => x.id === E);
ok(ev.cats.length === 3 && ev.cats[0].price === 1500, 'categories come back with the race');
ok((await D.saveEvent({ token: B, id: E, venue: 'Beach Road' })).event.cats.length === 3, 'editing the race keeps its categories');

// ---- registrations to count
const R = (n, cat, status, at) => wd.insert('RDRegs', { _id: E + '~t' + n, event: E, ticketNumber: 't' + n, name: 'Runner ' + n, cat, status, at, size: '', phone: '', email: '' }, SA);
await R(1, '21.1K', 'ok', day(-10) + 'T05:00:00.000Z'); await R(2, '21.1K', 'ok', day(-10) + 'T07:00:00.000Z'); await R(3, '21.1K - Half Marathon', 'ok', day(-3) + 'T05:00:00.000Z');
await R(4, '21.1K', 'unpaid', day(-1) + 'T05:00:00.000Z'); await R(5, '10K Run', 'ok', day(0) + 'T01:00:00.000Z'); await R(6, '10K', 'ok', day(-8) + 'T05:00:00.000Z');
await R(7, 'Kids Fun Run', 'ok', day(-2) + 'T05:00:00.000Z'); await R(8, '', 'ok', day(-2) + 'T05:00:00.000Z');
await wd.insert('RDRegs', { _id: E2 + '~x', event: E2, ticketNumber: 'x', name: 'Other race', cat: '110K', status: 'ok', at: day(-1) + 'T05:00:00.000Z' }, SA);

const d = await D.dashboard({ token: B, ev: E });
const c = (n) => d.byCat.find((x) => x.name === n);
ok(d.total === 8 && d.paid === 7 && d.unpaid === 1, 'totals: ' + JSON.stringify([d.total, d.paid, d.unpaid]));
ok(c('21.1K').count === 4 && c('21.1K').paid === 3 && c('21.1K').unpaid === 1, 'a longer ticket name ("21.1K - Half Marathon") counts under 21.1K');
ok(c('10K').count === 2 && c('5K').count === 0, '"10K Run" counts under 10K; empty category listed');
ok(c('Kids Fun Run') && c('Kids Fun Run').unlisted && c('Kids Fun Run').count === 1 && c('No ticket name').count === 1, 'tickets with no matching category are listed on their own');
ok(d.capacity === 150, 'capacity adds the categories that have a limit (5K has none)');
ok(c('21.1K').revenue === 4500 && c('10K').revenue === 1600 && d.revenue === 6100, 'takings count paid tickets at the category fee: ' + d.revenue);
ok(d.pending === 1500 && c('21.1K').pending === 1500, 'unpaid tickets shown as pending, not takings');
ok(d.hasCats === true, 'knows categories are set');
ok(d.series.length >= 11 && d.series[0][0] === day(-10) && d.series[0][1] === 2 && d.series[d.series.length - 1][0] === day(0) && d.series[d.series.length - 1][1] === 8, 'trend: cumulative per day from the first registration to today');
ok(d.series.every((p, i) => i === 0 || p[1] >= d.series[i - 1][1]), 'trend never goes down');
ok(d.series.length === new Set(d.series.map((p) => p[0])).size, 'one point per day');
ok(d.week.thisWeek === 5 && d.week.prevWeek === 3, 'this week and last week: ' + JSON.stringify(d.week));

// ---- who sees money
const dv = await D.dashboard({ token: V, ev: E });
ok(dv.total === 8 && dv.revenue === null && dv.pending === null && dv.byCat.every((x) => x.price === null && x.revenue === undefined), 'viewer sees counts but no fees or takings');
const dl = await D.dashboard({ token: LD, ev: E });
ok(dl.revenue === 6100, 'lead sees takings');
ok((await err(D.dashboard({ ev: E }))) === 'not_logged_in', 'dashboard needs a login');
const d2 = await D.dashboard({ token: B, ev: E2 });
ok(d2.total === 1 && d2.capacity === null && d2.hasCats === false && d2.byCat.length === 1 && d2.byCat[0].unlisted, 'a race with no categories still counts, capacity unknown');
await wd.insert('RDRegs', { _id: E2 + '~y', event: E2, ticketNumber: 'y', name: 'Old', cat: '', status: 'ok', at: 'garbage' }, SA);
ok((await D.dashboard({ token: B, ev: E2 })).series.length >= 1, 'a bad date does not break the trend');
const none = await D.dashboard({ token: B, ev: arch });
ok(none.total === 0 && none.series.length === 0 && none.revenue === 0, 'a race with no registrations: zeros, no trend');

// ---- race cards
const rs = (await D.racesSummary({ token: B })).races;
ok(rs.length === 2 && !rs.some((x) => x.id === arch), 'race cards skip archived races');
ok(rs[0].id === E && rs[0].total === 8 && rs[0].capacity === 150 && rs[0].revenue === 6100 && rs[0].cats.length === 5, 'card: registrations, capacity, takings, categories');
ok(rs[0].date <= rs[1].date, 'cards in date order');
ok((await D.racesSummary({ token: V })).races.every((x) => x.revenue === null), 'viewer cards carry no takings');
ok((await err(D.racesSummary({}))) === 'not_logged_in', 'cards need a login');

console.log(`Dash: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
