// Scenario tests for the Training backend (wix/training/training.web.js), run against mock Wix modules.
import crypto from 'crypto';
import * as T from './training.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const err = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const count = async (c, f) => (await wd.query(c).limit(1000).find(SA)).items.filter(f || (() => true)).length;
const IST = 5.5 * 3600000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ---- the hash itself
for (const s of ['', 'abc', '123456', 'salt:123456', 'नमस्ते', 'x'.repeat(200), '😀 run'])
  ok(T.__sha256(s) === crypto.createHash('sha256').update(s).digest('hex'), 'sha256 matches node for ' + JSON.stringify(s.slice(0, 12)));

// ---- setup and starter plans
ok((await err(T.ensureTrainSetup({ key: 'wrong' }))) === 'Wrong setup key', 'setup: wrong key refused');
const su = await T.ensureTrainSetup({ key: 'k-test' });
ok(/Starter plans added: 3/.test(su.summary), 'setup: three starter plans');
ok(/Starter plans added: 0/.test((await T.ensureTrainSetup({ key: 'k-test' })).summary), 'setup: repeat adds nothing');
const op = await T.openPlans();
ok(op.plans.length === 3 && op.plans.every((p) => p.weeks === 8), 'plans: three 8-week plans open to everyone');
ok(op.settings.freeWeeks === 8 && op.settings.coachedPriceText === 'Free for now', 'settings: 8 weeks, coached free for now');
ok((await wd.query('TrainPlans').find(SA)).items.every((p) => p._id !== 'settings'), 'settings row not created until saved');

// ---- every starter plan is sound
for (const p of op.plans) {
  const rows = (await wd.query('TrainWorkouts').eq('plan', p.id).limit(1000).find(SA)).items;
  ok(rows.length === 56, p.name + ': 8 weeks x 7 days');
  const wk = (w) => rows.filter((r) => r.week === String(w));
  ok([1, 2, 3, 4, 5, 6, 7, 8].every((w) => new Set(wk(w).map((r) => r.day)).size === 7), p.name + ': every week has all 7 days once');
  ok(rows.filter((r) => r.type === 'race').length === 1 && rows.find((r) => r.type === 'race').week === '8' && rows.find((r) => r.type === 'race').day === '7', p.name + ': race on the last day');
  const longs = [1, 2, 3, 4, 5, 6, 7].map((w) => Number(wk(w).find((r) => r.type === 'long').km));
  ok(longs[3] < longs[2] && longs[6] > longs[0] && longs.every((k) => k > 0), p.name + ': long run builds with a lighter week 4 (' + longs.join(',') + ')');
  ok(Number(wk(8).find((r) => r.day === '4').km) <= Number(wk(7).find((r) => r.type === 'long').km), p.name + ': last week is lighter');
}

// ---- staff
for (const [u, r] of [['boss', 'admin'], ['dir', 'director'], ['coachA', 'coach'], ['coachB', 'coach'], ['desk1', 'desk'], ['view', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw-' + u, role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);
const SL = (u) => T.tLogin({ username: u, password: 'pw-' + u });
const boss = await SL('boss'), cA = await SL('coachA'), cB = await SL('coachB');
ok(boss.role === 'director' && cA.role === 'coach', 'staff: director and coach roles');
ok((await err(SL('desk1'))) === 'not_allowed' && (await err(SL('view'))) === 'not_allowed', 'staff: desk and viewer roles refused');
ok((await err(T.tLogin({ username: 'boss', password: 'x' }))) === 'bad_login', 'staff: wrong password');
ok((await err(T.listAthletes({}))) === 'not_logged_in' && (await err(T.listAthletes({ token: 'z'.repeat(30) }))) === 'not_logged_in', 'staff: calls need a session');
ok((await err(T.saveTrainSettings({ token: cA.token, freeWeeks: 8 }))) === 'director_only', 'settings: coach cannot change settings');
const st = await T.saveTrainSettings({ token: boss.token, freeWeeks: 10, coachedPrice: '1500 per month', coachedBlurb: 'Weekly plan check' });
ok(st.freeWeeks === 10 && st.coachedPriceText === '1500 per month', 'settings: price and weeks saved');
ok((await err(T.saveTrainSettings({ token: boss.token, freeWeeks: 0 }))) === 'bad_weeks', 'settings: bad weeks refused');
await T.saveTrainSettings({ token: boss.token, freeWeeks: 8, coachedPrice: '0' });
ok((await T.openPlans()).settings.coachedPriceText === 'Free for now', 'settings: back to free');

// ---- athlete sign-up and login
const mk = (n, o) => Object.assign({ name: 'Athlete ' + n, phone: '98480100' + String(n).padStart(2, '0'), pin: '123456', level: 'Beginner' }, o || {});
ok((await err(T.athleteSignup(mk(1, { name: 'A' })))) === 'name_needed', 'signup: name needed');
ok((await err(T.athleteSignup(mk(1, { phone: '12345' })))) === 'bad_phone', 'signup: bad phone');
ok((await err(T.athleteSignup(mk(1, { pin: '12345' })))) === 'bad_pin' && (await err(T.athleteSignup(mk(1, { pin: 'abcdef' })))) === 'bad_pin', 'signup: PIN must be 6 digits');
ok((await T.athleteSignup(mk(1, { website: 'http://spam' }))).ok === true && (await count('TrainAthletes')) === 0, 'signup: honeypot stores nothing');
const a1 = await T.athleteSignup(mk(1));
ok(a1.token.length > 40 && a1.athlete.name === 'Athlete 1', 'signup: works and logs in');
const row = (await wd.query('TrainAthletes').find(SA)).items[0];
ok(!JSON.stringify(row).includes('123456') && row.pinHash.length === 64 && row.salt, 'signup: PIN stored only as a salted hash');
ok((await err(T.athleteSignup(mk(1, { name: 'Other' })))) === 'already_signed_up', 'signup: same number refused');
ok((await err(T.athleteSignup(mk(1, { phone: '+91 98480 10001' })))) === 'already_signed_up', 'signup: same number in another format refused');
const race = await Promise.all([T.athleteSignup(mk(2)), T.athleteSignup(mk(2, { name: 'Twin' }))].map((p) => p.then(() => 'ok', (e) => e.message)));
ok(race.filter((x) => x === 'ok').length === 1 && (await count('TrainAthletes', (a) => a.phone === '9848010002')) === 1, 'signup: two at the same moment, exactly one wins');
const a2 = await T.athleteLogin({ phone: '9848010002', pin: '123456' });
const a3 = await T.athleteSignup(mk(3));
ok((await err(T.athleteLogin({ phone: '9848010001', pin: '000000' }))) === 'bad_login', 'login: wrong PIN');
ok((await err(T.athleteLogin({ phone: '9000000000', pin: '123456' }))) === 'bad_login', 'login: unknown number');
ok((await T.athleteLogin({ phone: '098480 10001', pin: '123456' })).athlete.name === 'Athlete 1', 'login: number in another format');
for (let k = 0; k < 5; k++) await err(T.athleteLogin({ phone: '9848010003', pin: '999999' }));
ok((await err(T.athleteLogin({ phone: '9848010003', pin: '123456' }))) === 'locked', 'login: locked after 5 wrong tries');
ok((await err(T.myHome({}))) === 'not_logged_in' && (await err(T.myHome({ token: 'q'.repeat(40) }))) === 'not_logged_in', 'athlete calls need a session');
await wd.insert('TrainTokens', { token: 'e'.repeat(40), athlete: row._id, expires: new Date(Date.now() - 1000).toISOString() }, SA);
ok((await err(T.myHome({ token: 'e'.repeat(40) }))) === 'not_logged_in', 'expired athlete session refused');
ok((await err(T.changePin({ token: a1.token, oldPin: '000000', newPin: '654321' }))) === 'bad_login', 'PIN change: old PIN must match');
ok((await err(T.changePin({ token: a1.token, oldPin: '123456', newPin: '12' }))) === 'bad_pin', 'PIN change: new PIN 6 digits');
await T.changePin({ token: a1.token, oldPin: '123456', newPin: '654321' });
ok((await err(T.athleteLogin({ phone: '9848010001', pin: '123456' }))) === 'bad_login' && (await T.athleteLogin({ phone: '9848010001', pin: '654321' })).token, 'PIN change: new PIN works, old does not');
await T.athleteLogout({ token: a1.token });
ok((await err(T.myHome({ token: a1.token }))) === 'not_logged_in', 'logout ends session');
const A1 = (await T.athleteLogin({ phone: '9848010001', pin: '654321' })).token;
const A2 = a2.token;

// ---- free plan: enrol
const plan = op.plans[1];
ok((await T.myHome({ token: A1 })).enrollment === null, 'home: no plan yet');
ok((await err(T.enrollPlan({ token: A1, planId: plan.id, startDate: '2020-01-01' }))) === 'bad_start', 'enrol: start date too old');
ok((await err(T.enrollPlan({ token: A1, planId: plan.id, startDate: 'tomorrow' }))) === 'bad_start', 'enrol: bad date text');
ok((await err(T.enrollPlan({ token: A1, planId: 'nope', startDate: today() }))) === 'no_plan', 'enrol: unknown plan');
const start = add(today(), -3);
const en1 = await T.enrollPlan({ token: A1, planId: plan.id, startDate: start });
ok(en1.enrollment.kind === 'free' && en1.enrollment.coach === '' && (await count('TrainSessions', (s) => s.enroll === en1.enrollment.id)) === 56, 'enrol: free plan, 56 sessions');
ok((await err(T.enrollPlan({ token: A1, planId: plan.id, startDate: today() }))) === 'already_enrolled', 'enrol: one active plan at a time');
const ses = (await T.mySessions({ token: A1 })).sessions;
ok(ses[0].date === start && ses[55].date === add(start, 55) && ses.every((s, i) => s.date === add(start, i)), 'enrol: one workout per day from the start date');
ok(ses[55].type === 'race', 'enrol: last day is race day');
const A2enr = await T.enrollPlan({ token: A2, planId: op.plans[0].id, startDate: today() });
ok((await T.mySessions({ token: A2 })).sessions.length === 56 && (await T.mySessions({ token: A1 })).sessions.length === 56, 'enrol: athletes do not see each other');
await wd.update('TrainPlans', Object.assign({}, (await wd.get('TrainPlans', op.plans[2].id)), { status: 'draft' }), SA);
ok((await err(T.enrollPlan({ token: a3.token, planId: op.plans[2].id, startDate: today() }))) === 'no_plan' && (await T.openPlans()).plans.length === 2, 'enrol: draft plan hidden and not enrollable');

// ---- free plan: logging
let h = await T.myHome({ token: A1 });
ok(h.today === today() && h.todays.length === 1 && h.week.length === (() => { const dow = (new Date(today() + 'T00:00:00Z').getUTCDay() + 6) % 7; const mon = add(today(), -dow); return ses.filter((x) => x.date >= mon && x.date <= add(mon, 6)).length; })() && h.stats.due === ses.filter((x) => x.date < today() && x.type !== 'rest').length && h.stats.due > 0, 'home: today, this week, and past workouts due (rest days do not count)');
const run = ses.find((s) => s.type !== 'rest' && s.date <= today());
const rest0 = ses.find((s) => s.type === 'rest' && s.date < today());
ok((await T.logSession({ token: A1, id: run.id, status: 'done', aKm: 5.2, aMin: 34, rpe: 15, note: 'felt good' })).session.rpe === 10, 'log: done saved, effort limited to 1 to 10');
ok((await err(T.logSession({ token: A2, id: run.id, status: 'done' }))) === 'no_session', 'log: cannot touch another athlete\'s workout');
ok((await err(T.logSession({ token: A1, id: run.id, status: 'banana' }))) === 'bad_status', 'log: bad status');
ok((await err(T.logSession({ token: A1, id: run.id, status: 'done', aKm: 900 }))) === 'bad_numbers', 'log: absurd distance refused');
const fut = ses.find((s) => s.date > today() && s.type !== 'rest');
ok((await err(T.logSession({ token: A1, id: fut.id, status: 'done' }))) === 'future_session', 'log: cannot tick off a future workout');
ok((await T.logSession({ token: A1, id: fut.id, status: 'skipped', note: 'travel' })).session.status === 'skipped', 'log: can mark a future workout skipped');
h = await T.myHome({ token: A1 });
ok(h.stats.done === 1 && h.stats.adherence === Math.round((1 / h.stats.due) * 100), 'stats: adherence from past workouts');
ok((await T.logSession({ token: A1, id: run.id, status: 'planned' })).session.aKm === null, 'log: undo clears the actuals');
await T.logSession({ token: A1, id: run.id, status: 'done', aKm: 5.2, aMin: 34 });
ok((await T.addMySession({ token: A1, date: today(), type: 'easy', km: 4, minutes: 28, title: 'Extra jog' })).session.source === 'self', 'own run: added');
ok((await err(T.addMySession({ token: A1, date: '2020-01-01', type: 'easy' }))) === 'bad_session' && (await err(T.addMySession({ token: A1, date: today(), type: 'zoom' }))) === 'bad_session', 'own run: bad date or type refused');

// ---- free plan has no coach features
ok((await err(T.myMessages({ token: A1 }))) === 'no_coach' && (await err(T.sendMyMessage({ token: A1, text: 'hi' }))) === 'no_coach', 'free: no messages, enforced by the server');
const e1 = en1.enrollment.id;
ok((await err(T.coachSaveSession({ token: boss.token, enroll: e1, date: today(), type: 'easy', title: 'x' }))) === 'not_coached', 'free: even the director cannot change the schedule');
ok((await err(T.coachFeedback({ token: boss.token, enroll: e1, id: run.id, text: 'nice' }))) === 'not_coached' && (await err(T.coachMessage({ token: boss.token, enroll: e1, text: 'hi' }))) === 'not_coached', 'free: no feedback or messages from staff');
ok((await T.listAthletes({ token: cA.token })).athletes.length === 0, 'coach sees no one before assignment');
const dl = await T.listAthletes({ token: boss.token });
ok(dl.athletes.length === 2 && dl.totals.athletes === 3 && dl.athletes.every((a) => a.kind === 'free'), 'director sees all active athletes');
ok((await err(T.athleteDetail({ token: cA.token, enroll: e1 }))) === 'not_yours', 'coach cannot open an athlete who is not theirs');

// ---- coaching request and assignment
ok((await err(T.requestCoaching({ token: a3.token }))) === 'no_enroll', 'request: needs a plan first');
await T.requestCoaching({ token: A1, note: 'Want help for my first 10K' });
ok((await T.listAthletes({ token: boss.token })).athletes[0].coachStatus === 'requested' && (await T.listAthletes({ token: boss.token })).totals.requests === 1, 'request: shows first for the director');
ok((await err(T.myMessages({ token: A1 }))) === 'no_coach', 'request: still no messages until a coach is assigned');
await T.cancelCoachingRequest({ token: A1 });
ok((await T.listAthletes({ token: boss.token })).totals.requests === 0, 'request: athlete can withdraw');
await T.requestCoaching({ token: A1, note: 'again' });
ok((await err(T.assignCoach({ token: cA.token, enroll: e1, coach: 'coachA' }))) === 'director_only', 'assign: coach cannot assign');
ok((await err(T.assignCoach({ token: boss.token, enroll: e1, coach: 'desk1' }))) === 'no_coach_user' && (await err(T.assignCoach({ token: boss.token, enroll: e1, coach: 'ghost' }))) === 'no_coach_user', 'assign: only coach or director logins');
ok((await T.listCoaches({ token: boss.token })).coaches.some((c) => c.username === 'coachA'), 'assign: coach list');
await T.assignCoach({ token: boss.token, enroll: e1, coach: 'coachA' });
h = await T.myHome({ token: A1 });
ok(h.enrollment.kind === 'coached' && h.enrollment.coach === 'COACHA' && h.enrollment.coachStatus === 'active', 'assign: athlete sees the coach');
ok((await T.listAthletes({ token: cA.token })).athletes.length === 1 && (await T.listAthletes({ token: cB.token })).athletes.length === 0, 'assign: only that coach sees the athlete');
ok((await err(T.athleteDetail({ token: cB.token, enroll: e1 }))) === 'not_yours' && (await err(T.coachMessage({ token: cB.token, enroll: e1, text: 'hi' }))) === 'not_yours', 'assign: other coach is refused');

// ---- coached: messages, feedback, schedule
await T.sendMyMessage({ token: A1, text: 'Knee felt tight today' });
ok((await T.listAthletes({ token: cA.token })).athletes[0].unread === 1, 'messages: coach sees one unread');
const d1 = await T.athleteDetail({ token: cA.token, enroll: e1 });
ok(d1.messages.length === 1 && d1.canCoach && d1.athlete.name === 'Athlete 1', 'messages: coach reads the thread');
ok((await T.listAthletes({ token: cA.token })).athletes[0].unread === 0, 'messages: opening the thread marks it read');
await T.coachMessage({ token: cA.token, enroll: e1, text: 'Rest tomorrow, ice it.' });
ok((await T.myHome({ token: A1 })).unread === 1, 'messages: athlete sees one unread');
const mm = await T.myMessages({ token: A1 });
ok(mm.messages.length === 2 && mm.messages[1].from === 'coach' && (await T.myHome({ token: A1 })).unread === 0, 'messages: two-way thread, read after opening');
ok((await err(T.sendMyMessage({ token: A1, text: '   ' }))) === 'text_needed' && (await err(T.coachMessage({ token: cA.token, enroll: e1, text: '' }))) === 'text_needed', 'messages: empty refused');
ok((await err(T.myMessages({ token: A2 }))) === 'no_coach', 'messages: other athletes cannot read it');
const fb = await T.coachFeedback({ token: cA.token, enroll: e1, id: run.id, text: 'Good pacing. Keep cadence up.' });
ok(fb.session.feedback.startsWith('Good pacing') && fb.session.feedbackBy === 'COACHA', 'feedback: saved with the coach name');
ok((await T.mySessions({ token: A1 })).sessions.find((s) => s.id === run.id).feedback.startsWith('Good pacing'), 'feedback: athlete sees it on the workout');
ok((await err(T.coachFeedback({ token: cA.token, enroll: e1, id: 'nope', text: 'x' }))) === 'no_session', 'feedback: unknown workout');
const ns = await T.coachSaveSession({ token: cA.token, enroll: e1, date: add(today(), 2), type: 'tempo', title: 'Tempo 6 km', km: 6, minutes: 40, notes: 'steady' });
ok(ns.session.source === 'coach' && (await T.mySessions({ token: A1 })).sessions.some((s) => s.id === ns.session.id), 'schedule: coach adds a workout, athlete sees it');
ok((await T.coachSaveSession({ token: cA.token, enroll: e1, id: ns.session.id, date: add(today(), 3), type: 'easy', title: 'Easy 5 km', km: 5, minutes: 35 })).session.title === 'Easy 5 km', 'schedule: coach edits it');
ok((await err(T.coachSaveSession({ token: cA.token, enroll: e1, id: run.id, date: today(), type: 'easy', title: 'x' }))) === 'already_done', 'schedule: a finished workout cannot be rewritten');
ok((await err(T.coachSaveSession({ token: cA.token, enroll: e1, date: 'x', type: 'easy', title: 'x' }))) === 'bad_session' && (await err(T.coachSaveSession({ token: cA.token, enroll: e1, date: today(), type: 'weird', title: 'x' }))) === 'bad_session', 'schedule: bad input refused');
ok((await err(T.coachSaveSession({ token: cA.token, enroll: e1, id: A2enr.enrollment.id, date: today(), type: 'easy', title: 'x' }))) === 'no_session', 'schedule: cannot edit a workout of another athlete through this one');
ok((await err(T.coachRemoveSession({ token: cA.token, enroll: e1, id: run.id }))) === 'already_done', 'schedule: finished workout cannot be removed');
await T.coachRemoveSession({ token: cA.token, enroll: e1, id: ns.session.id });
ok(!(await T.mySessions({ token: A1 })).sessions.some((s) => s.id === ns.session.id), 'schedule: coach removes a planned workout');
ok((await err(T.coachSaveSession({ token: cA.token, enroll: A2enr.enrollment.id, date: today(), type: 'easy', title: 'x' }))) === 'not_yours', 'schedule: coach cannot change another athlete\'s plan');
ok((await err(T.endPlan({ token: a3.token }))) === 'no_enroll', 'end: needs a plan');

// ---- stop coaching and decline
await T.stopCoaching({ token: boss.token, enroll: e1 });
ok((await err(T.sendMyMessage({ token: A1, text: 'hello?' }))) === 'no_coach' && (await err(T.coachMessage({ token: cA.token, enroll: e1, text: 'x' }))) === 'not_yours', 'stop: messages and coach access end');
ok((await T.myHome({ token: A1 })).enrollment.kind === 'free', 'stop: back to a free plan');
await T.requestCoaching({ token: A2, note: 'please' });
await T.declineCoaching({ token: boss.token, enroll: A2enr.enrollment.id });
ok((await T.listAthletes({ token: boss.token })).totals.requests === 0, 'decline: request cleared');
ok((await err(T.declineCoaching({ token: boss.token, enroll: A2enr.enrollment.id }))) === 'no_request', 'decline: nothing to decline');

// ---- plan editing
const wl = (await T.getPlan({ token: cA.token, id: plan.id })).workouts;
ok(wl.length === 56 && wl[0].week === 1 && wl[55].type === 'race', 'plan: coach can read a plan');
const tiny = [{ week: 1, day: 1, type: 'easy', title: 'Easy', km: 3, minutes: 20 }, { week: 1, day: 3, type: 'rest', title: 'Rest', km: 0, minutes: 0 }];
ok((await err(T.savePlan({ token: cA.token, name: 'Mine', weeks: 1, workouts: tiny }))) === 'director_only', 'plan: coach cannot create plans');
ok((await err(T.savePlan({ token: boss.token, name: 'x', weeks: 1, workouts: tiny }))) === 'name_needed', 'plan: name needed');
ok((await err(T.savePlan({ token: boss.token, name: 'Tiny plan', weeks: 1, workouts: [{ week: 2, day: 1, type: 'easy', title: 'x' }] }))) === 'bad_workouts', 'plan: workout outside the weeks refused');
ok((await err(T.savePlan({ token: boss.token, name: 'Tiny plan', weeks: 1, workouts: [tiny[0], tiny[0]] }))) === 'bad_workouts', 'plan: two workouts on one day refused');
ok((await err(T.savePlan({ token: boss.token, name: 'Tiny plan', weeks: 1, workouts: [{ week: 1, day: 1, type: 'weird', title: 'x' }] }))) === 'bad_workouts', 'plan: unknown type refused');
const np = (await T.savePlan({ token: boss.token, name: 'Tiny plan', weeks: 1, goal: '5K', workouts: tiny })).plan;
ok(np.weeks === 1 && (await T.getPlan({ token: cA.token, id: np.id })).workouts.length === 2, 'plan: director creates a plan');
await T.savePlan({ token: boss.token, id: np.id, name: 'Tiny plan v2', weeks: 1, workouts: [tiny[0]] });
ok((await T.getPlan({ token: cA.token, id: np.id })).workouts.length === 1 && (await count('TrainWorkouts', (w) => w.plan === np.id)) === 1, 'plan: edit replaces the workouts');
await T.savePlan({ token: boss.token, id: np.id, name: 'Tiny plan v3', weeks: 1 });
ok((await T.getPlan({ token: cA.token, id: np.id })).workouts.length === 1, 'plan: saving without workouts keeps them');
const a4 = await T.athleteSignup(mk(4));
const en4 = await T.enrollPlan({ token: a4.token, planId: np.id, startDate: today() });
ok(en4.enrollment.planName === 'Tiny plan v3' && (await err(T.removePlan({ token: boss.token, id: np.id }))) === 'plan_in_use', 'plan: cannot delete a plan in use');
const sp = (await T.savePlan({ token: boss.token, name: 'Unused', weeks: 1, workouts: tiny })).plan;
ok((await err(T.removePlan({ token: cA.token, id: sp.id }))) === 'director_only', 'plan: coach cannot delete');
await T.removePlan({ token: boss.token, id: sp.id });
ok((await count('TrainWorkouts', (w) => w.plan === sp.id)) === 0 && (await err(T.getPlan({ token: boss.token, id: sp.id }))) === 'no_plan', 'plan: delete removes workouts too');
await T.endPlan({ token: a4.token });
ok((await T.myHome({ token: a4.token })).enrollment === null, 'end: athlete can finish a plan and pick another');
ok((await T.enrollPlan({ token: a4.token, planId: plan.id, startDate: today() })).enrollment.planName === plan.name, 'end: can enrol again after ending');

// ---- rate limit
for (let k = 0; k < 200; k++) await wd.save('RDRate', { _id: 'train|' + new Date().toISOString().slice(0, 13), n: '100' }, SA);
ok((await err(T.athleteSignup(mk(9)))) === 'busy_try_later', 'signup: hourly limit');

console.log(`Training: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
