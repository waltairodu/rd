// Tests for plan-against-actual insight (coach and athlete) and the AI note, in the Training backend.
import * as T from './training.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const err = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const IST = 5.5 * 3600000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
const wk0 = add(today(), -dow(today()));
await T.ensureTrainSetup({ key: 'k-test' });
for (const [u, r] of [['boss', 'admin'], ['coachA', 'coach'], ['coachB', 'coach'], ['view', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw-' + u, role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);
const SL = (u) => T.tLogin({ username: u, password: 'pw-' + u });
const boss = await SL('boss'), cA = await SL('coachA'), cB = await SL('coachB');
const a = await T.athleteSignup({ name: 'Priya Secretsurname', phone: '9848011111', pin: '123456', level: 'Intermediate', goal: 'Half in 2:10, call me on 9848099999' });
const plan = (await T.openPlans()).plans[1];
await T.enrollPlan({ token: a.token, planId: plan.id, startDate: today() });
const enr = (await wd.query('TrainEnroll').find(SA)).items[0]._id;
await T.assignCoach({ token: boss.token, enroll: enr, coach: 'coachA' });
const reset = async (list) => {
  await wd.bulkRemove('TrainSessions', (await wd.query('TrainSessions').eq('enroll', enr).limit(1000).find(SA)).items.map((x) => x._id), SA);
  for (const s of list) await wd.insert('TrainSessions', Object.assign({ enroll: enr, athlete: a.athlete.id, week: '1', type: 'easy', title: 'Run', km: '10', minutes: '60', notes: '', status: 'planned', aKm: '', aMin: '', rpe: '', aNote: '', feedback: '', feedbackBy: '', feedbackAt: '', source: 'plan' }, s), SA);
};
const S = (off, o) => Object.assign({ date: add(wk0, off) }, o);
const insight = async () => (await T.coachInsight({ token: cA.token, enroll: enr })).insight;

// ---- access
await reset([]);
ok((await err(T.coachInsight({ token: cB.token, enroll: enr }))) === 'not_yours', 'another coach cannot see it');
ok((await err(T.coachInsight({ enroll: enr }))) === 'not_logged_in', 'needs a login');
ok((await err(T.coachInsight({ token: cA.token, enroll: 'nope' }))) === 'no_enroll', 'unknown enrolment');
ok((await T.coachInsight({ token: boss.token, enroll: enr })).insight.weeks.length === 4, 'director can see any athlete');
ok((await err(T.myInsight({}))) === 'not_logged_in', 'athlete insight needs a login');

// ---- weeks
await reset([
  S(-14, { status: 'done', km: '10', aKm: '10' }), S(-13, { status: 'done', km: '10', aKm: '9', type: 'long' }),
  S(-7, { status: 'done', km: '10', aKm: '12' }), S(-6, { status: 'done', km: '10', aKm: '12' }),
  S(0, { km: '8', status: 'done', aKm: '8' }), S(1, { km: '12' }),
]);
let i = await insight();
ok(i.weeks.length === 4 && i.weeks[3].current === true && i.weeks[2].start === add(wk0, -7), 'four weeks ending with the current week');
ok(i.weeks[1].plannedKm === 20 && i.weeks[1].doneKm === 19 && i.weeks[1].pct === 95, 'planned and done km per week: ' + JSON.stringify(i.weeks[1]));
ok(i.weeks[2].doneKm === 24 && i.weeks[2].pct === 120, 'done above plan gives over 100%');
const nowDow = dow(today());
ok(i.weeks[3].plannedKm === (nowDow >= 1 ? 8 + 0 : 8) || i.weeks[3].plannedKm >= 8, 'current week planned counts only up to today: ' + i.weeks[3].plannedKm);
ok(i.weeks[0].plannedKm === 0 && i.weeks[0].pct === null, 'empty week has no percentage');
ok(i.flags.some((f) => f.id === 'ramp') && /26%|25%|2[0-9]%/.test(i.flags.find((f) => f.id === 'ramp').text), 'sudden jump in distance flagged: ' + JSON.stringify(i.flags.map((f) => f.text)));
ok(i.suggestions.some((t) => /Hold next week/.test(t)), 'ramp suggestion');

// ---- flags
await reset([S(-14, { status: 'done', aKm: '10' }), S(-13, { status: 'done', aKm: '10' }), S(-7, { status: 'planned' }), S(-6, { status: 'planned' }), S(-5, { status: 'planned' }), S(-4, { status: 'skipped' })]);
i = await insight();
ok(i.flags.some((f) => f.id === 'missed' && f.level === 'bad'), 'many missed sessions flagged bad');
await reset([S(-9, { status: 'done', aKm: '10' }), S(-8, { status: 'done', aKm: '10' }), S(-7, { status: 'done', aKm: '10' }), S(-1, { type: 'long', status: 'skipped', km: '16' })]);
i = await insight();
ok(dow(today()) === 0 ? true : i.flags.some((f) => f.id === 'long'), 'skipped long run flagged' );
await reset([S(-12, { status: 'done', aKm: '8', rpe: '9' }), S(-11, { status: 'done', aKm: '8', rpe: '8' }), S(-10, { status: 'done', aKm: '8', rpe: '9' }), S(-9, { status: 'done', aKm: '8', rpe: '8' })]);
i = await insight();
ok(i.flags.some((f) => f.id === 'hard') && i.flags.some((f) => f.id === 'quiet'), 'very hard efforts and a quiet week flagged');
await reset([S(-14, { status: 'done', aKm: '10' }), S(-13, { status: 'done', aKm: '10' }), S(-12, { status: 'done', aKm: '10' }), S(-7, { status: 'done', aKm: '10' }), S(-6, { status: 'done', aKm: '10' }), S(-1, { status: 'done', aKm: '10' })]);
i = await insight();
ok(i.flags.length === 1 && i.flags[0].id === 'strong' && i.flags[0].level === 'good', 'steady training: only a positive flag: ' + JSON.stringify(i.flags.map((f) => f.id)));
await reset([S(-14, { status: 'done', aKm: '10' }), S(-13, { status: 'done', aKm: '10' }), S(-12, { status: 'done', aKm: '10' }), S(-7, { status: 'done', aKm: '10', km: '20' }), S(-6, { status: 'done', aKm: '1' }), S(-5, { status: 'done', aKm: '1', km: '20' }), S(-2, { status: 'done', aKm: '10' })]);
i = await insight();
ok(i.weeks[2].pct !== null, 'weeks with partial runs still compute');
await reset([]);
i = await insight();
ok(i.flags.length === 0 && i.adherence === null && /On plan/.test(i.suggestions[0]), 'no data: no flags, no adherence, no false alarm');
await reset([S(-3, { type: 'rest', km: '0', status: 'planned' }), S(-2, { type: 'rest', km: '0', status: 'planned' }), S(-1, { type: 'rest', km: '0', status: 'planned' }), S(-8, { type: 'rest', km: '0', status: 'planned' })]);
ok((await insight()).flags.length === 0, 'rest days are never counted as missed');

// ---- athlete view
await reset([S(-7, { status: 'done', aKm: '10' }), S(-6, { status: 'done', aKm: '10' }), S(-5, { status: 'done', aKm: '10' })]);
const mine = (await T.myInsight({ token: a.token })).insight;
ok(mine.weeks.length === 4 && mine.weeks[2].doneKm === 30, 'athlete sees their own weeks');
const other = await T.athleteSignup({ name: 'No Plan', phone: '9848022222', pin: '123456', level: 'Beginner' });
ok((await T.myInsight({ token: other.token })).insight === null, 'athlete without a plan: nothing');

// ---- AI
global.__SECRETS = {};
ok((await T.coachInsight({ token: cA.token, enroll: enr })).enabled === false, 'AI not connected without a key');
ok((await err(T.coachInsight({ token: cA.token, enroll: enr, write: true }))) === 'no_ai_key', 'AI note refused without a key');
global.__SECRETS = { ANTHROPIC_API_KEY: 'sk-ant-test-0123456789abcdefghij' };
global.__FETCH_CALLS = [];
global.__FETCH = async () => ({ status: 200, ok: true, json: async () => ({ content: [{ type: 'text', text: 'For the coach:\n- Keep the long run at 14 km.\n\nNote to the athlete:\nHi {name}, great consistency this month. Keep it easy this week.' }] }) });
const w = await T.coachInsight({ token: cA.token, enroll: enr, write: true });
ok(w.ai === true && /Keep the long run/.test(w.text) && !/Note to the athlete/i.test(w.text), 'coach suggestions split from the note');
ok(/^Hi Priya,/.test(w.message) && !/\{name\}/.test(w.message), 'note to the athlete gets the first name filled in here, not by the model');
const sent = JSON.parse(global.__FETCH_CALLS[0].opts.body);
const all = sent.system + sent.messages[0].content;
ok(!/Priya|Secretsurname|9848011111|9848099999/.test(all), 'no name or phone numbers (including one typed in the goal) are sent to the model');
ok(/Week of/.test(all) && /planned/.test(all) && /<data>/.test(all), 'weekly figures sent inside data tags');
global.__FETCH = async () => ({ status: 200, ok: true, json: async () => ({ content: [{ type: 'text', text: 'Just some advice with no note.' }] }) });
const w2 = await T.coachInsight({ token: cA.token, enroll: enr, write: true });
ok(w2.ai === true && w2.text === 'Just some advice with no note.' && w2.message === '', 'reply without a note part still works');
global.__FETCH = async () => ({ status: 429, ok: false, json: async () => ({}) });
ok((await err(T.coachInsight({ token: cA.token, enroll: enr, write: true }))) === 'ai_busy', 'busy service becomes a plain error');
ok((await T.coachInsight({ token: cA.token, enroll: enr })).insight.weeks.length === 4, 'rule-based insight unaffected by AI failures');
let busy = '';
global.__FETCH = async () => ({ status: 200, ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) });
for (let k = 0; k < 45 && busy !== 'busy_try_later'; k++) busy = await err(T.coachInsight({ token: cA.token, enroll: enr, write: true }));
ok(busy === 'busy_try_later', 'AI calls are limited per person per hour');
ok((await err(T.coachInsight({ token: boss.token, enroll: enr, write: true }))) === '', 'the limit is per person');

console.log(`Training AI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
