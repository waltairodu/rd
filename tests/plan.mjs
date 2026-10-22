// Scenario tests for the planning module (budget, sponsors, supplies, approvals, ceremonies, tasks, contacts, documents, lessons).
import * as D from './racedir.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const err = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const istDay = (offset) => new Date(Date.now() + 5.5 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

for (const [u, r] of [['boss', 'admin'], ['lead1', 'lead'], ['view1', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);
const L = async (u) => (await D.login({ username: u, password: 'pw' })).token;
const B = await L('boss'), LD = await L('lead1'), V = await L('view1');
const ev = (await D.saveEvent({ token: B, name: 'VHM', date: istDay(40), venue: 'RK Beach' })).event;
const ev2 = (await D.saveEvent({ token: B, name: 'Ultribe', date: istDay(60) })).event;
const E = ev.id, E2 = ev2.id;
const list = (t, e, ...kinds) => D.listPlan({ token: t, ev: e, kinds });
const one = async (t, e, k) => (await list(t, e, k)).items[k];

// ---- starter lists are loaded when a race is created
{
  const r = await list(B, E, 'task', 'approval', 'ceremony', 'supply', 'budget', 'contact', 'sponsor', 'doc', 'lesson');
  ok(r.items.task.length === 32, 'starter tasks: ' + r.items.task.length);
  ok(r.items.approval.filter((x) => x.phase === 'permit').length === 12 && r.items.approval.filter((x) => x.phase === 'raceday').length === 8, 'starter approvals: 12 permits and 8 race-day sign-offs');
  ok(r.items.ceremony.length === 22 && ['pre', 'during', 'post'].every((p) => r.items.ceremony.some((x) => x.phase === p)), 'starter ceremonies cover pre, during and post');
  ok(r.items.supply.length >= 30 && r.items.budget.some((x) => x.phase === 'income') && r.items.budget.some((x) => x.phase === 'expense'), 'starter supplies and budget lines (costs and income)');
  ok(r.items.contact.length === 14, 'starter contacts');
  ok(r.items.sponsor.length === 0 && r.items.doc.length === 0 && r.items.lesson.length === 0, 'sponsors, documents and lessons start empty');
  ok(r.items.task.every((x) => x.status === 'todo' && x.overdue === false), 'all start as to-do, none overdue');
  ok(r.items.task.length && (await one(B, E2, 'task')).length === 32, 'each race has its own lists');
}

// ---- who can do what
{
  ok((await err(list(V, E, 'budget'))) === 'not_allowed', 'viewer cannot read the budget');
  ok((await err(list(V, E, 'sponsor'))) === 'not_allowed', 'viewer cannot read sponsors');
  ok((await err(list(V, E, 'contact'))) === 'not_allowed', 'viewer cannot read contacts (phone numbers)');
  ok((await err(list(V, E, 'task', 'budget'))) === 'not_allowed', 'one forbidden kind blocks the request');
  ok((await one(V, E, 'approval')).length === 20, 'viewer can read approvals');
  ok((await one(V, E, 'ceremony')).length === 22 && (await one(V, E, 'supply')).length >= 30, 'viewer can read ceremonies and supplies');
  ok((await err(D.savePlanItem({ token: V, ev: E, kind: 'task', title: 'Hack' }))) === 'read_only', 'viewer cannot write');
  ok((await err(D.savePlanItem({ token: LD, ev: E, kind: 'budget', title: 'Banner', amount: 100 }))) === 'director_only', 'lead cannot write money');
  ok((await err(D.savePlanItem({ token: LD, ev: E, kind: 'sponsor', title: 'Acme' }))) === 'director_only', 'lead cannot write sponsors');
  ok((await one(LD, E, 'budget')).length > 0 && (await one(LD, E, 'contact')).length === 14, 'lead can read money and contacts');
  const t = (await D.savePlanItem({ token: LD, ev: E, kind: 'task', title: 'Order bibs', phase: 'd30', owner: 'Asha' })).item;
  ok(t.id && t.title === 'Order bibs' && t.by === 'LEAD1', 'lead writes a task, editor recorded');
  ok((await err(D.removePlanItem({ token: LD, ev: E, id: t.id }))) === 'director_only', 'lead cannot remove');
  ok((await err(D.removePlanItem({ token: V, ev: E, id: t.id }))) === 'director_only', 'viewer cannot remove');
  ok((await err(D.savePlanItem({ ev: E, kind: 'task', title: 'Anon' }))) === 'not_logged_in', 'no token refused');
  ok((await err(D.listPlan({ ev: E, kinds: ['task'] }))) === 'not_logged_in', 'list needs a login');
  ok((await err(D.setPlanStatus({ token: V, ev: E, id: t.id, status: 'done' }))) === 'read_only', 'viewer cannot change a status');
  ok((await err(D.seedPlanLists({ token: LD, ev: E }))) === 'director_only', 'lead cannot load starter lists');
  ok((await D.removePlanItem({ token: B, ev: E, id: t.id })).ok === true && !(await one(B, E, 'task')).some((x) => x.id === t.id), 'director removes');
}

// ---- validation
{
  const S = (o) => err(D.savePlanItem(Object.assign({ token: B, ev: E, kind: 'task', title: 'Valid task' }, o)));
  ok((await S({ title: 'x' })) === 'title_needed', 'title too short');
  ok((await S({ kind: 'nope' })) === 'bad_kind', 'unknown kind');
  ok((await S({ kind: undefined })) === 'bad_kind', 'missing kind');
  ok((await S({ phase: 'later' })) === 'bad_phase', 'bad phase');
  ok((await S({ status: 'finished' })) === 'bad_status', 'bad status');
  ok((await S({ status: 'paid' })) === 'bad_status', 'a status of another kind is refused');
  ok((await S({ due: '10/12/2026' })) === 'bad_date', 'bad date');
  ok((await S({ due: '2026-02-31' })) === 'bad_date', 'impossible date');
  ok((await S({ kind: 'ceremony', time: '25:00' })) === 'bad_time', 'bad time');
  ok((await S({ kind: 'ceremony', time: '06:30' })) === '', 'good time');
  ok((await S({ kind: 'budget', amount: -5 })) === 'bad_amount', 'negative amount');
  ok((await S({ kind: 'budget', amount: 'abc' })) === 'bad_amount', 'text amount');
  ok((await S({ kind: 'budget', amount: 1e12 })) === 'bad_amount', 'huge amount');
  ok((await S({ kind: 'doc' })) === 'link_needed', 'document needs a link');
  ok((await S({ kind: 'doc', link: 'javascript:alert(1)' })) === 'bad_link', 'script links refused');
  ok((await S({ kind: 'doc', link: 'https://drive.example.com/x' })) === '', 'https link accepted');
  ok((await err(D.savePlanItem({ token: B, ev: 'nope', kind: 'task', title: 'Valid task' }))) === 'no_event', 'missing race');
  ok((await err(D.savePlanItem({ token: B, ev: E, kind: 'task', id: 'ghost', title: 'Valid task' }))) === 'no_item', 'missing item');
  const x = (await D.savePlanItem({ token: B, ev: E, kind: 'task', title: '<script>alert(1)</script> task\u0000' })).item;
  ok(!/\u0000/.test(x.title) && x.title.includes('<script>'), 'control characters stripped, text kept as text');
  // an item cannot be edited through another race or another kind
  ok((await err(D.savePlanItem({ token: B, ev: E2, kind: 'task', id: x.id, title: 'Steal' }))) === 'no_item', 'cannot edit an item through another race');
  ok((await err(D.savePlanItem({ token: B, ev: E, kind: 'ceremony', id: x.id, title: 'Steal' }))) === 'no_item', 'cannot edit an item as another kind');
  ok((await err(D.setPlanStatus({ token: B, ev: E2, id: x.id, status: 'done' }))) === 'no_item', 'cannot change status through another race');
  ok((await err(D.removePlanItem({ token: B, ev: E2, id: x.id }))) === 'no_item', 'cannot remove through another race');
  ok((await err(D.setPlanStatus({ token: B, ev: E, id: x.id, status: 'paid' }))) === 'bad_status', 'status must fit the kind');
  ok((await err(D.setPlanStatus({ token: B, ev: E, id: 'ghost', status: 'done' }))) === 'no_item', 'status on a missing item');
  ok((await err(list(B, E, 'bogus'))) === 'bad_kind', 'listing an unknown kind');
}

// ---- amounts, partial updates, status shortcuts
{
  const b = (await D.savePlanItem({ token: B, ev: E, kind: 'budget', title: 'Medals', cat: 'Finisher items', phase: 'expense', amount: '₹1,500.50', party: 'Trophy House', due: istDay(10) })).item;
  ok(b.amount === 1500.5 && b.amount2 === null && b.status === 'planned' && b.phase === 'expense', 'amount parsed from a rupee string, defaults applied');
  const b2 = (await D.savePlanItem({ token: B, ev: E, kind: 'budget', id: b.id, amount2: 1400 })).item;
  ok(b2.amount === 1500.5 && b2.amount2 === 1400 && b2.party === 'Trophy House' && b2.title === 'Medals', 'partial update keeps the other fields');
  const b3 = (await D.savePlanItem({ token: B, ev: E, kind: 'budget', id: b.id, amount2: '' })).item;
  ok(b3.amount2 === null, 'actual can be cleared');
  const p = (await D.setPlanStatus({ token: B, ev: E, id: b.id, status: 'paid' })).item;
  ok(p.status === 'paid' && p.amount2 === 1500.5, 'marking paid fills actual with planned');
  await D.savePlanItem({ token: B, ev: E, kind: 'budget', id: b.id, amount2: 1400 });
  const p2 = (await D.setPlanStatus({ token: B, ev: E, id: b.id, status: 'paid' })).item;
  ok(p2.amount2 === 1400, 'marking paid keeps an actual that was already entered');
  const nb = (await D.savePlanItem({ token: B, ev: E, kind: 'budget', title: 'Misc' })).item;
  ok(nb.cat === 'Other', 'budget line without category goes to Other');
  const sp = (await D.savePlanItem({ token: B, ev: E, kind: 'sponsor', title: 'Acme Shoes', cat: 'Gold', phase: 'cash', amount: 50000, status: 'committed', party: 'Ravi', contact: '9876543210' })).item;
  const sp2 = (await D.setPlanStatus({ token: B, ev: E, id: sp.id, status: 'received' })).item;
  ok(sp2.status === 'received' && sp2.amount2 === 50000, 'sponsor received fills the received amount');
  const su = (await D.savePlanItem({ token: LD, ev: E, kind: 'supply', title: 'Cones', cat: 'Signage', amount: 100, ref: 'pcs' })).item;
  const su2 = (await D.setPlanStatus({ token: LD, ev: E, id: su.id, status: 'delivered' })).item;
  ok(su2.status === 'delivered' && su2.amount2 === 100, 'supply delivered fills have with needed (lead may do this)');
  const ap = (await one(B, E, 'approval')).find((x) => x.phase === 'raceday');
  ok(ap.by === '', 'race-day sign-off has no signer yet');
  const ap2 = (await D.setPlanStatus({ token: LD, ev: E, id: ap.id, status: 'approved' })).item;
  ok(ap2.status === 'approved' && ap2.by === 'LEAD1' && ap2.at, 'approval records who signed off and when');
  const t = (await D.savePlanItem({ token: B, ev: E, kind: 'task', title: 'Past due task', due: istDay(-2) })).item;
  ok(t.overdue === true, 'past due and not done is overdue');
  ok((await D.setPlanStatus({ token: B, ev: E, id: t.id, status: 'done' })).item.overdue === false, 'done is no longer overdue');
  const td = (await D.savePlanItem({ token: B, ev: E, kind: 'task', title: 'Due today', due: istDay(0) })).item;
  ok(td.overdue === false, 'due today is not overdue');
}

// ---- summary figures on a clean race
{
  const rm = (await wd.query('RDPlan').eq('event', E2).limit(1000).find(SA)).items.map((x) => x._id);
  await wd.bulkRemove('RDPlan', rm, SA);
  const add = (o) => D.savePlanItem(Object.assign({ token: B, ev: E2 }, o));
  await add({ kind: 'budget', title: 'Line A', cat: 'Venue', phase: 'expense', amount: 1000, amount2: 1200 });
  await add({ kind: 'budget', title: 'Line B', cat: 'Venue', phase: 'expense', amount: 500, status: 'committed' });
  await add({ kind: 'budget', title: 'Line C', cat: 'Income', phase: 'income', amount: 2000, amount2: 800 });
  await add({ kind: 'budget', title: 'Line D', cat: 'Other', phase: 'expense', amount: 700, status: 'cancelled' });
  await add({ kind: 'budget', title: 'Line E', cat: 'Medical', phase: 'expense', amount: 100, amount2: 600 });
  await add({ kind: 'sponsor', title: 'S1', phase: 'cash', amount: 50000, amount2: 20000, status: 'committed' });
  await add({ kind: 'sponsor', title: 'S2', phase: 'cash', amount: 30000, status: 'negotiating' });
  await add({ kind: 'sponsor', title: 'S3', phase: 'inkind', amount: 10000, status: 'committed' });
  await add({ kind: 'sponsor', title: 'S4', phase: 'cash', amount: 99999, status: 'declined', due: istDay(-5) });
  await add({ kind: 'supply', title: 'Water', amount: 100, amount2: 40, status: 'ordered' });
  await add({ kind: 'supply', title: 'Cups', amount: 10, amount2: 10, status: 'received' });
  await add({ kind: 'supply', title: 'Tents', amount: 5, amount2: 1, status: 'delivered' });
  await add({ kind: 'task', title: 'T1', due: istDay(-1) });
  await add({ kind: 'task', title: 'T2', due: istDay(-1), status: 'done' });
  await add({ kind: 'task', title: 'T3', status: 'blocked' });
  await add({ kind: 'budget', title: 'Paid long ago', phase: 'expense', amount: 1, due: istDay(-9), status: 'paid' });
  const s = (await list(B, E2, 'task')).summary;
  ok(s.budget.expPlanned === 1601 && s.budget.expActual === 1800 && s.budget.overBy === 199, 'costs: planned, actual, over (cancelled left out): ' + JSON.stringify([s.budget.expPlanned, s.budget.expActual, s.budget.overBy]));
  ok(s.budget.incPlanned === 2000 && s.budget.incActual === 800 && s.budget.netPlanned === 399 && s.budget.netActual === -1000, 'income and net');
  ok(s.budget.committedUnpaid === 500 && s.budget.overLines === 2, 'committed not paid, lines over their plan');
  ok(s.budget.byCat.find((c) => c.cat === 'Venue').planned === 1500 && s.budget.byCat.find((c) => c.cat === 'Venue').actual === 1200 && !s.budget.byCat.some((c) => c.cat === 'Other' && c.planned === 700), 'costs by category');
  ok(s.sponsors.cashPromised === 50000 && s.sponsors.cashReceived === 20000 && s.sponsors.pipeline === 30000 && s.sponsors.inKind === 10000 && s.sponsors.outstanding === 30000, 'sponsor totals: ' + JSON.stringify(s.sponsors));
  ok(s.sponsors.coversPct === Math.round(5000000 / 1601), 'sponsor cash as a share of planned costs');
  ok(s.supplies.total === 3 && s.supplies.delivered === 1 && s.supplies.short === 1, 'supplies short counts only items not yet at the site');
  ok(s.tasks.total === 3 && s.tasks.done === 1 && s.tasks.blocked === 1 && s.tasks.overdue === 1, 'task counts');
  ok(s.overdue === 1, 'overdue ignores done, paid and declined items: ' + s.overdue);
  const sv = (await list(V, E2, 'task')).summary;
  ok(sv.budget === undefined && sv.sponsors === undefined && sv.tasks.total === 3, 'viewer summary has no money');
  const sl = (await list(LD, E2, 'task')).summary;
  ok(sl.budget && sl.sponsors, 'lead summary has money');
  const sv2 = (await list(V, E2, 'task')).canMoney, sb = (await list(B, E2, 'task')).canMoney;
  ok(sv2 === false && sb === true, 'canMoney flag');
}

// ---- overview: figures and alerts
{
  const o = await D.overview({ token: B, ev: E2 });
  ok(o.plan && o.plan.tasks.total === 3 && o.plan.budget.overBy === 199, 'overview carries the plan figures');
  ok(o.alerts.some((a) => /past the due date/.test(a.text) && a.go === 'plan'), 'alert: overdue items');
  ok(o.alerts.some((a) => /over the planned budget/.test(a.text) && a.go === 'money'), 'alert: over budget');
  const ov = await D.overview({ token: V, ev: E2 });
  ok(ov.plan && !ov.plan.budget && !ov.alerts.some((a) => /budget/.test(a.text)), 'viewer overview has no money and no budget alert');
  const o1 = await D.overview({ token: B, ev: E });
  ok(o1.alerts.some((a) => /permit.* not approved yet/.test(a.text) && a.go === 'approvals'), 'alert: permits not approved');
  ok(!o1.alerts.some((a) => /race-day sign-off/.test(a.text)), 'no sign-off alert 40 days out');
  const today = (await D.saveEvent({ token: B, name: 'Race today', date: istDay(0) })).event;
  const ot = await D.overview({ token: B, ev: today.id });
  ok(ot.alerts.some((a) => /race-day sign-off/.test(a.text) && a.go === 'approvals'), 'alert: race-day sign-offs on race day');
  // flag a rejected permit
  const permit = (await one(B, today.id, 'approval')).find((x) => x.phase === 'permit');
  await D.setPlanStatus({ token: B, ev: today.id, id: permit.id, status: 'rejected' });
  const orj = await D.overview({ token: B, ev: today.id });
  ok(orj.alerts.some((a) => a.level === 'bad' && /rejected or expired/.test(a.text)), 'alert: rejected approval is red');
  // supplies short close to the race
  await D.savePlanItem({ token: B, ev: today.id, kind: 'supply', title: 'Gels', amount: 50, amount2: 5, status: 'ordered' });
  ok((await D.overview({ token: B, ev: today.id })).alerts.some((a) => /short of the quantity/.test(a.text) && a.go === 'logistics'), 'alert: supplies short near race day');
  ok(!o1.alerts.some((a) => /short of the quantity/.test(a.text)), 'no supplies alert 40 days out');
}

// ---- starter lists on demand
{
  const r1 = await D.seedPlanLists({ token: B, ev: E });
  ok(Object.keys(r1.added).length === 0, 'nothing added while the lists have items');
  const rm = (await wd.query('RDPlan').eq('event', E).eq('kind', 'contact').limit(1000).find(SA)).items.map((x) => x._id);
  await wd.bulkRemove('RDPlan', rm, SA);
  const r2 = await D.seedPlanLists({ token: B, ev: E, kinds: ['contact', 'task'] });
  ok(r2.added.contact === 14 && r2.added.task === undefined && (await one(B, E, 'contact')).length === 14, 'only the empty list is refilled');
  ok((await err(D.seedPlanLists({ token: B, ev: E, kinds: ['sponsor'] }))) === '' && (await one(B, E, 'sponsor')).length === 1, 'sponsors have no starter list and are left alone');
  ok((await err(D.seedPlanLists({ token: B, ev: E, kinds: ['x'] }))) === 'bad_kind', 'unknown kind refused');
  ok((await err(D.seedPlanLists({ token: B, ev: 'nope' }))) === 'no_event', 'missing race refused');
}

// ---- ordering: due date first, then starter order
{
  const t = await one(B, E, 'task');
  const dated = t.filter((x) => x.due);
  ok(dated.length >= 2 && dated[0].due <= dated[dated.length - 1].due && t.indexOf(dated[0]) < t.findIndex((x) => !x.due), 'dated items come first, in date order');
}

console.log(`Plan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
