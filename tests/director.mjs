// Scenario tests for the Race Director backend (wix/director/racedir.web.js), run against mock Wix modules.
import * as D from './racedir.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const err = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const count = async (c, f) => (await wd.query(c).limit(1000).find(SA)).items.filter(f || (() => true)).length;

// ---- logins
for (const [u, r] of [['boss', 'admin'], ['dir', 'director'], ['lead1', 'lead'], ['view1', 'viewer'], ['desk1', 'desk'], ['blank', ''], ['coach1', 'coach'], ['odd1', 'volunteer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw-' + u, role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);
const L = async (u) => (await D.login({ username: u, password: 'pw-' + u }));
const boss = await L('boss'), dir = await L('dir'), lead = await L('lead1'), view = await L('view1');
ok(boss.role === 'director' && boss.canManage && boss.canWrite, 'admin works as director');
ok(dir.role === 'director', 'director role');
ok(lead.role === 'lead' && lead.canWrite && !lead.canManage, 'lead: write yes, manage no');
ok(view.role === 'viewer' && !view.canWrite, 'viewer read only');
// Desk staff log in here too (one login for everything) but the session is good for nothing except the Expo desk.
const desk1 = await D.login({ username: 'desk1', password: 'pw-desk1' });
ok(desk1.role === 'desk' && !desk1.canWrite && !desk1.canManage, 'desk login works and is a desk session (no write, no manage)');
ok((await D.whoami({ token: desk1.token })).role === 'desk', 'desk session: whoami works');
ok((await err(D.listEvents({ token: desk1.token }))) === 'not_allowed', 'desk session refused by Director methods');
ok((await err(D.saveEvent({ token: desk1.token, name: 'X Race' }))) === 'not_allowed', 'desk session cannot write');
const blank1 = await D.login({ username: 'blank', password: 'pw-blank' });
ok(blank1.role === 'desk', 'a login with no role is an old hand-made desk login');
ok((await err(D.login({ username: 'coach1', password: 'pw-coach1' }))) === 'not_allowed', 'coach login refused here (coach page only)');
ok((await err(D.login({ username: 'odd1', password: 'pw-odd1' }))) === 'not_allowed', 'a login with an unknown role is refused');
ok((await err(D.login({ username: 'boss', password: 'nope' }))) === 'bad_login', 'wrong password');
ok((await err(D.login({ username: 'ghost', password: 'x' }))) === 'bad_login', 'unknown user');
for (let k = 0; k < 5; k++) await err(D.login({ username: 'view1', password: 'bad' }));
ok((await err(D.login({ username: 'view1', password: 'pw-view1' }))) === 'locked', 'locked after 5 wrong tries');
ok((await err(D.listEvents({}))) === 'not_logged_in', 'no token refused');
ok((await err(D.listEvents({ token: 'x'.repeat(30) }))) === 'not_logged_in', 'fake token refused');
const T = { b: boss.token, d: dir.token, l: lead.token };
// viewer token, made before the lock-out
const sv = await wd.insert('ExpoSessions', { token: 'v'.repeat(40), username: 'view1', desk: '', expires: new Date(Date.now() + 3600000).toISOString() }, SA);
T.v = sv.token;
// expired session
await wd.insert('ExpoSessions', { token: 'e'.repeat(40), username: 'boss', desk: '', expires: new Date(Date.now() - 1000).toISOString() }, SA);
ok((await err(D.whoami({ token: 'e'.repeat(40) }))) === 'not_logged_in', 'expired session refused');
ok((await D.whoami({ token: T.l })).role === 'lead', 'whoami');
await D.logout({ token: dir.token });
ok((await err(D.whoami({ token: dir.token }))) === 'not_logged_in', 'logout ends session');

// ---- events
ok((await err(D.saveEvent({ token: T.l, name: 'X Race' }))) === 'director_only', 'lead cannot create events');
ok((await err(D.saveEvent({ token: T.v, name: 'X Race' }))) === 'director_only', 'viewer cannot create events');
ok((await err(D.saveEvent({ token: T.b, name: 'x' }))) === 'name_needed', 'event needs a name');
ok((await err(D.saveEvent({ token: T.b, name: 'Race', date: '20-10-2026' }))) === 'bad_date', 'bad date refused');
ok((await err(D.saveEvent({ token: T.b, name: 'Race', distanceKm: 500 }))) === 'bad_distance', 'bad distance refused');
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const ev = (await D.saveEvent({ token: T.b, name: 'VHM', date: future, venue: 'RK Beach', expoId: 'Import910' })).event;
const ev2 = (await D.saveEvent({ token: T.b, name: 'Ultribe', date: future })).event;
ok(ev.id && ev.status === 'open' && ev.groups.length === 6 && ev.distanceKm === 21.0975, 'event created with default pace groups');
ok(ev.daysToGo >= 9 && ev.daysToGo <= 11, 'days to go counted (' + ev.daysToGo + ')');
ok((await count('RDChecklist', (x) => x.event === ev.id)) === 14, 'default safety checklist seeded');
ok((await count('RDRunOfShow', (x) => x.event === ev.id)) === 8, 'default run of show seeded');
ok((await D.listEvents({ token: T.v })).events.length === 2, 'viewer can list events');
const upd = (await D.saveEvent({ token: T.b, id: ev.id, name: 'Vizag Half', date: future, distanceKm: 21.1 })).event;
ok(upd.name === 'Vizag Half' && upd.distanceKm === 21.1 && upd.groups.length === 6, 'event update keeps groups');
ok((await err(D.saveEvent({ token: T.b, id: 'nope', name: 'Zed' }))) === 'no_event', 'update of missing event refused');
for (const [bib, o] of [['1', {}], ['2', { checkedInAt: 'x', bibAt: 'x' }], ['3', { checkedInAt: 'x', bibAt: 'x', shirtAt: 'x' }]])
  await wd.insert('Runners', Object.assign({ _id: 'Import910~' + bib, event: 'Import910', bib, checkedInAt: '', bibAt: '', shirtAt: '' }, o), SA);
await wd.insert('Runners', { _id: 'Import999~1', event: 'Import999', bib: '1', checkedInAt: 'x', bibAt: 'x', shirtAt: 'x' }, SA);
const E = ev.id, E2 = ev2.id;

// ---- shifts
const S = (o) => Object.assign({ token: T.l, ev: E, role: 'Aid station', location: 'KM 5', date: future, start: '04:30', end: '08:30', need: 3 }, o);
ok((await err(D.saveShift(S({ token: T.v })))) === 'read_only', 'viewer cannot add shifts');
ok((await err(D.saveShift(S({ role: 'a' })))) === 'role_needed', 'shift role needed');
ok((await err(D.saveShift(S({ date: 'tomorrow' })))) === 'bad_date', 'shift date checked');
ok((await err(D.saveShift(S({ start: '9:00' })))) === 'bad_time', 'shift time format checked');
ok((await err(D.saveShift(S({ start: '08:00', end: '07:00' })))) === 'bad_time', 'shift end after start');
ok((await err(D.saveShift(S({ need: 0 })))) === 'bad_need', 'shift need at least 1');
ok((await err(D.saveShift(S({ ev: 'nope' })))) === 'no_event', 'shift needs a real event');
const sA = (await D.saveShift(S({}))).id;
const sB = (await D.saveShift(S({ role: 'Marshal', location: 'Turn 2', start: '05:00', end: '07:00', need: 1 }))).id;
const sC = (await D.saveShift(S({ role: 'Expo desk', location: 'Expo', date: future, start: '10:00', end: '14:00', need: 2 }))).id;
const sOther = (await D.saveShift(S({ ev: E2, role: 'Other race shift' }))).id;
let sh = (await D.listShifts({ token: T.v, ev: E })).shifts;
ok(sh.length === 3 && sh[0].role === 'Aid station' && sh[0].left === 3, 'shifts listed, sorted, with spots left');

// ---- public view and sign-up
const os = await D.openShifts({ ev: E });
ok(os.shifts.length === 3 && os.event.name === 'Vizag Half' && os.waiver.includes('Vizag Half'), 'public list of shifts');
ok(!JSON.stringify(os.shifts).match(/phone|code|volunteer|name/i) && Object.keys(os.shifts[0]).sort().join() === 'date,end,id,left,location,notes,role,start', 'public list leaks no volunteer data');
ok((await err(D.openShifts({ ev: 'nope' }))) === 'no_event', 'public list: unknown event');
const SU = (o) => Object.assign({ ev: E, name: 'Asha Rao', phone: '98480 12345', email: 'asha@example.com', club: 'VTRA', shifts: [sA], waiver: true }, o);
ok((await err(D.volunteerSignup(SU({ name: ' ' })))) === 'name_needed', 'signup: name');
ok((await err(D.volunteerSignup(SU({ phone: '12345' })))) === 'bad_phone', 'signup: phone');
ok((await err(D.volunteerSignup(SU({ phone: '5848012345' })))) === 'bad_phone', 'signup: phone must start 6-9');
ok((await err(D.volunteerSignup(SU({ email: 'bad@' })))) === 'bad_email', 'signup: email');
ok((await err(D.volunteerSignup(SU({ waiver: false })))) === 'waiver_needed', 'signup: waiver must be agreed');
ok((await err(D.volunteerSignup(SU({ waiver: 'yes' })))) === 'waiver_needed', 'signup: waiver must be exactly true');
ok((await err(D.volunteerSignup(SU({ shifts: [] })))) === 'pick_a_shift', 'signup: pick a shift');
ok((await err(D.volunteerSignup(SU({ shifts: ['nope'] })))) === 'no_shift', 'signup: unknown shift');
ok((await err(D.volunteerSignup(SU({ shifts: [sOther] })))) === 'no_shift', 'signup: shift of another race refused');
ok((await err(D.volunteerSignup(SU({ shifts: [sA, sB] })))) === 'shifts_overlap', 'signup: overlapping shifts refused');
ok((await count('RDVolunteers')) === 0, '  failed sign-ups saved nothing');
const r1 = await D.volunteerSignup(SU({ shifts: [sA, sC] }));
ok(r1.ok && /^[A-Z2-9]{6}$/.test(r1.code) && r1.shifts.length === 2, 'signup works, gives a code');
const v1 = (await wd.query('RDVolunteers').find(SA)).items[0];
ok(v1.phone === '9848012345' && v1.status === 'applied' && v1.waiverAt && v1.waiverVersion === 'v1', 'phone normalised, waiver recorded, status applied');
ok((await err(D.volunteerSignup(SU({ name: 'Other', phone: '+91 98480-12345' })))) === 'already_signed_up', 'same phone cannot sign up twice (+91 form)');
ok((await D.volunteerSignup(SU({ website: 'http://spam', phone: '9000000001' }))).ok === true && (await count('RDVolunteers')) === 1, 'bot field: fake success, nothing saved');
// capacity: shift B has need 1
const bothTry = await Promise.all([D.volunteerSignup(SU({ name: 'P1', phone: '9111111111', shifts: [sB] })).then(() => 'ok', (e) => e.message), D.volunteerSignup(SU({ name: 'P2', phone: '9222222222', shifts: [sB] })).then(() => 'ok', (e) => e.message)]);
ok(bothTry.filter((x) => x === 'ok').length === 1 && bothTry.includes('shift_full'), 'two people, one spot: exactly one gets it (' + bothTry.join(',') + ')');
ok((await count('RDAssignments', (x) => x.shiftId === sB)) === 1, '  only one assignment on the full shift');
ok((await count('RDVolunteers')) === 2, '  loser left no volunteer row behind');
ok((await err(D.volunteerSignup(SU({ name: 'P3', phone: '9333333333', shifts: [sB] })))) === 'shift_full', 'full shift refused');
sh = (await D.openShifts({ ev: E })).shifts;
ok(sh.find((x) => x.id === sB).left === 0 && sh.find((x) => x.id === sA).left === 2, 'spots left update in the public list');
// closed event
await D.saveEvent({ token: T.b, id: E2, name: 'Ultribe', date: future, status: 'closed' });
ok((await err(D.volunteerSignup(SU({ ev: E2, shifts: [sOther], phone: '9444444444' })))) === 'no_event', 'closed event takes no sign-ups');
await D.saveEvent({ token: T.b, id: E2, name: 'Ultribe', date: future, status: 'open' });
// rate limit
const hourKey = E + '|' + new Date().toISOString().slice(0, 13);
await wd.save('RDRate', { _id: hourKey, n: '200' }, SA);
ok((await err(D.volunteerSignup(SU({ name: 'P4', phone: '9555555555', shifts: [sC] })))) === 'busy_try_later', 'hourly sign-up limit');
await wd.save('RDRate', { _id: hourKey, n: '1' }, SA);

// ---- status check by the volunteer
ok((await D.volunteerStatus({ ev: E, code: r1.code.toLowerCase(), phone: '9848012345' })).status === 'applied', 'volunteer can check own status (code + phone)');
ok((await err(D.volunteerStatus({ ev: E, code: r1.code, phone: '9000000000' }))) === 'not_found', 'wrong phone: not found');
ok((await err(D.volunteerStatus({ ev: E, code: 'ZZZZZZ', phone: '9848012345' }))) === 'not_found', 'wrong code: not found');

// ---- staff: approve and decline
let vols = (await D.listVolunteers({ token: T.v, ev: E })).volunteers;
const asha = vols.find((x) => x.name === 'Asha Rao');
ok(asha && asha.shifts.length === 2 && asha.shifts.every((x) => x.status === 'pending'), 'staff see applicant with pending shifts');
ok((await err(D.setVolunteerStatus({ token: T.v, ev: E, id: asha.id, status: 'approved' }))) === 'read_only', 'viewer cannot approve');
ok((await err(D.setVolunteerStatus({ token: T.l, ev: E, id: asha.id, status: 'maybe' }))) === 'bad_status', 'bad status refused');
ok((await err(D.setVolunteerStatus({ token: T.l, ev: E2, id: asha.id, status: 'approved' }))) === 'no_volunteer', 'cannot approve across races');
await D.setVolunteerStatus({ token: T.l, ev: E, id: asha.id, status: 'approved' });
vols = (await D.listVolunteers({ token: T.l, ev: E })).volunteers;
ok(vols.find((x) => x.id === asha.id).status === 'approved' && vols.find((x) => x.id === asha.id).shifts.every((x) => x.status === 'confirmed'), 'approve confirms their shifts');
ok((await D.volunteerStatus({ ev: E, code: r1.code, phone: '9848012345' })).shifts.every((x) => x.status === 'confirmed'), 'volunteer sees confirmed');
// decline frees the spot
const p1 = vols.find((x) => x.name === 'P1') || vols.find((x) => x.name === 'P2');
await D.setVolunteerStatus({ token: T.l, ev: E, id: p1.id, status: 'declined' });
ok((await D.listShifts({ token: T.l, ev: E })).shifts.find((x) => x.id === sB).left === 1, 'declining frees the spot');
ok((await D.volunteerSignup(SU({ name: 'P5', phone: '9666666666', shifts: [sB] }))).ok, 'freed spot can be taken');

// ---- manual add, assign, unassign
ok((await err(D.addVolunteer({ token: T.l, ev: E, name: 'Ravi', phone: '123' }))) === 'bad_phone', 'manual add: phone');
const ravi = await D.addVolunteer({ token: T.l, ev: E, name: 'Ravi K', phone: '9777777777', club: 'Gym' });
ok(ravi.code.length === 6, 'manual add gives code');
ok((await err(D.addVolunteer({ token: T.l, ev: E, name: 'Ravi 2', phone: '9777777777' }))) === 'already_signed_up', 'manual add: duplicate phone');
const A1 = await D.assignShift({ token: T.l, ev: E, volunteerId: ravi.id, shiftId: sA });
ok(A1.id, 'assign shift');
ok((await D.listVolunteers({ token: T.l, ev: E })).volunteers.find((x) => x.id === ravi.id).shifts[0].status === 'confirmed', 'approved volunteer gets confirmed shift');
ok((await err(D.assignShift({ token: T.l, ev: E, volunteerId: ravi.id, shiftId: sA }))) === 'already_assigned', 'assign twice refused');
ok((await err(D.assignShift({ token: T.l, ev: E, volunteerId: ravi.id, shiftId: sB }))) === 'shifts_overlap', 'assign overlapping shift refused');
ok((await err(D.assignShift({ token: T.l, ev: E, volunteerId: ravi.id, shiftId: sOther }))) === 'no_shift', 'assign shift of other race refused');
ok((await err(D.assignShift({ token: T.v, ev: E, volunteerId: ravi.id, shiftId: sC }))) === 'read_only', 'viewer cannot assign');
// fill shift A (need 3): Asha, Ravi = 2 taken; one more fine, next refused
const x3 = await D.addVolunteer({ token: T.l, ev: E, name: 'Third', phone: '9888888888' });
await D.assignShift({ token: T.l, ev: E, volunteerId: x3.id, shiftId: sA });
const x4 = await D.addVolunteer({ token: T.l, ev: E, name: 'Fourth', phone: '9899999999' });
ok((await err(D.assignShift({ token: T.l, ev: E, volunteerId: x4.id, shiftId: sA }))) === 'shift_full', 'assign to full shift refused');
ok((await err(D.saveShift(S({ id: sA, need: 2 })))) === 'need_below_taken', 'cannot cut a shift below those already on it');
await D.unassignShift({ token: T.l, ev: E, assignId: A1.id });
ok((await D.listShifts({ token: T.l, ev: E })).shifts.find((x) => x.id === sA).left === 1, 'unassign frees the spot');
ok((await err(D.unassignShift({ token: T.l, ev: E2, assignId: A1.id }))) === 'no_assignment', 'unassign across races refused');
await D.setVolunteerNote({ token: T.l, ev: E, id: ravi.id, notes: 'Brings own cones' });
ok((await D.listVolunteers({ token: T.l, ev: E })).volunteers.find((x) => x.id === ravi.id).notes === 'Brings own cones', 'volunteer note saved');
await D.assignShift({ token: T.l, ev: E, volunteerId: ravi.id, shiftId: sA });

// ---- check-in and out
ok((await err(D.volunteerCheck({ token: T.l, ev: E, code: 'NOPE00' }))) === 'not_found', 'check-in: unknown code');
const nap = await D.addVolunteer({ token: T.l, ev: E, name: 'Pending Pat', phone: '9100000000' });
await D.setVolunteerStatus({ token: T.l, ev: E, id: nap.id, status: 'applied' });
ok((await err(D.volunteerCheck({ token: T.l, ev: E, volunteerId: nap.id }))) === 'not_approved', 'check-in: only approved volunteers');
ok((await err(D.volunteerCheck({ token: T.v, ev: E, code: r1.code }))) === 'read_only', 'viewer cannot check in');
ok((await err(D.volunteerCheck({ token: T.l, ev: E, code: ravi.code, action: 'out' }))) === 'nothing_to_check', 'check-out before in refused');
const ci = await D.volunteerCheck({ token: T.l, ev: E, code: r1.code.toLowerCase() });
ok(ci.ok && ci.name === 'Asha Rao' && ci.role === 'Aid station', 'check-in by code picks the earliest shift');
ok((await err(D.volunteerCheck({ token: T.l, ev: E, code: r1.code, shiftId: sA }))) === 'already_in', 'second check-in on same shift refused');
// back-date the check-in by 2.5 hours, then check out
const ar = (await wd.query('RDAssignments').find(SA)).items.find((x) => x.shiftId === sA && x.checkedInAt && x.volunteerId === asha.id);
await wd.update('RDAssignments', Object.assign({}, ar, { checkedInAt: new Date(Date.now() - 2.5 * 3600000).toISOString() }), SA);
const co = await D.volunteerCheck({ token: T.l, ev: E, code: r1.code, action: 'out' });
ok(co.hours === 2.5, 'check-out computes hours (' + co.hours + ')');
ok((await err(D.volunteerCheck({ token: T.l, ev: E, code: r1.code, action: 'out', shiftId: sA }))) === 'already_out', 'second check-out refused');
ok((await D.listVolunteers({ token: T.l, ev: E })).volunteers.find((x) => x.id === asha.id).hours === 2.5, 'hours total on the volunteer');
ok((await err(D.setVolunteerStatus({ token: T.l, ev: E, id: asha.id, status: 'declined' }))) === 'already_checked_in', 'cannot decline someone already checked in');
ok((await err(D.unassignShift({ token: T.l, ev: E, assignId: ar._id }))) === 'already_checked_in', 'cannot remove a checked-in shift');
ok((await err(D.removeShift({ token: T.l, ev: E, id: sC }))) === 'director_only', 'lead cannot delete a shift');
ok((await err(D.removeShift({ token: T.b, ev: E, id: sA }))) === 'shift_has_checkins', 'shift with check-ins cannot be deleted');
const before = await count('RDAssignments');
await D.removeShift({ token: T.b, ev: E, id: sC });
ok((await count('RDAssignments')) < before && (await count('RDShifts', (x) => x._id === sC)) === 0, 'deleting a shift removes its assignments');

// ---- run of show
let run = (await D.listRun({ token: T.v, ev: E })).items;
ok(run.length === 8 && run[0].time <= run[1].time, 'run of show sorted by time');
ok((await err(D.saveRunItem({ token: T.l, ev: E, time: '5pm', what: 'Test' }))) === 'bad_time', 'run: time format');
ok((await err(D.saveRunItem({ token: T.l, ev: E, time: '05:00', what: '' }))) === 'text_needed', 'run: text needed');
ok((await err(D.saveRunItem({ token: T.v, ev: E, time: '05:00', what: 'Test' }))) === 'read_only', 'run: viewer cannot edit');
const ri = await D.saveRunItem({ token: T.l, ev: E, time: '03:30', what: 'Truck leaves store', owner: 'Ops' });
await D.saveRunItem({ token: T.l, ev: E, id: ri.id, time: '03:30', what: 'Truck leaves store', owner: 'Ops', status: 'done' });
run = (await D.listRun({ token: T.l, ev: E })).items;
ok(run[0].what === 'Truck leaves store' && run[0].status === 'done', 'run item added first and marked done');
ok((await err(D.removeRunItem({ token: T.l, ev: E, id: ri.id }))) === 'director_only', 'lead cannot delete run item');
await D.removeRunItem({ token: T.b, ev: E, id: ri.id });
ok((await D.listRun({ token: T.l, ev: E })).items.length === 8, 'director deletes run item');

// ---- incident log
ok((await err(D.addLog({ token: T.l, ev: E, kind: 'fire', text: 'abc' }))) === 'bad_kind', 'log: kind');
ok((await err(D.addLog({ token: T.l, ev: E, kind: 'medical', text: 'x' }))) === 'text_needed', 'log: text');
ok((await err(D.addLog({ token: T.v, ev: E, kind: 'medical', text: 'Runner down' }))) === 'read_only', 'log: viewer cannot add');
const lg = await D.addLog({ token: T.l, ev: E, kind: 'medical', place: 'KM 12', text: 'Runner cramping at KM 12', severity: 'high' });
const note = await D.addLog({ token: T.l, ev: E, kind: 'note', text: 'Water arrived late' });
let items = (await D.listLog({ token: T.v, ev: E })).items;
ok(items.length === 2 && items.find((x) => x.id === note.id).status === 'closed' && items.find((x) => x.id === lg.id).status === 'open', 'notes close themselves, incidents start open');
ok((await D.listLog({ token: T.v, ev: E, status: 'open' })).items.length === 1, 'filter open incidents');
ok((await err(D.closeLog({ token: T.l, ev: E, id: lg.id, resolution: '' }))) === 'resolution_needed', 'closing needs a resolution');
const ov0 = await D.overview({ token: T.l, ev: E });
ok(ov0.alerts.some((a) => a.level === 'bad' && /high-priority/.test(a.text)), 'open high-priority incident raises an alert');
await D.closeLog({ token: T.l, ev: E, id: lg.id, resolution: 'Taken to medical post' });
ok((await err(D.closeLog({ token: T.l, ev: E, id: lg.id, resolution: 'again' }))) === 'already_closed', 'cannot close twice');
ok((await D.overview({ token: T.l, ev: E })).log.open === 0, 'overview: no open incidents');

// ---- pacers
const pl = await D.listPacers({ token: T.v, ev: E });
const g2 = pl.groups.find((g) => g.label === '2:00');
ok(pl.distanceKm === 21.1, 'pace distance follows event');
const per = 7200 / 21.1, fm = (t) => { t = Math.round(t); return Math.floor(t / 3600) + ':' + String(Math.floor((t % 3600) / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
ok(g2.pace === Math.floor(Math.round(per) / 60) + ':' + String(Math.round(per) % 60).padStart(2, '0') && g2.finish === '2:00:00', '2:00 group pace per km (' + g2.pace + ')');
ok(g2.splits.length === 4 && g2.splits[0].km === 5 && g2.splits[0].time === fm(per * 5) && g2.splits[3].time === fm(per * 20), 'splits at 5, 10, 15, 20 km');
ok(g2.short === 3, 'no pacers yet: group short by its need');
ok((await err(D.savePaceGroups({ token: T.l, ev: E, groups: [] }))) === 'bad_groups', 'groups: empty refused');
ok((await err(D.savePaceGroups({ token: T.l, ev: E, groups: [{ label: 'A', finish: '1:30', need: 1 }, { label: 'A', finish: '2:00', need: 1 }] }))) === 'bad_groups', 'groups: duplicate label refused');
ok((await err(D.savePaceGroups({ token: T.l, ev: E, groups: [{ label: 'A', finish: '0:10', need: 1 }] }))) === 'bad_finish', 'groups: too fast refused');
ok((await err(D.savePaceGroups({ token: T.l, ev: E, groups: [{ label: 'A', finish: 'abc', need: 1 }] }))) === 'bad_finish', 'groups: not a time refused');
ok((await err(D.savePaceGroups({ token: T.l, ev: E, groups: [{ label: 'A', finish: '1:30', need: 99 }] }))) === 'bad_need', 'groups: need bounds');
ok((await err(D.savePaceGroups({ token: T.v, ev: E, groups: [{ label: 'A', finish: '1:30', need: 1 }] }))) === 'read_only', 'groups: viewer cannot edit');
await D.savePaceGroups({ token: T.l, ev: E, groups: [{ label: '2:00', finish: '2:00:00', need: 2 }, { label: '1:45', finish: '1:45', need: 1 }] });
const pl2 = await D.listPacers({ token: T.l, ev: E });
ok(pl2.groups.map((g) => g.label).join() === '1:45,2:00', 'groups saved and sorted fastest first');
ok((await err(D.savePacer({ token: T.l, ev: E, name: 'Pace A', group: '9:99' }))) === 'bad_group', 'pacer: unknown group');
ok((await err(D.savePacer({ token: T.l, ev: E, name: 'Pace A', status: 'approved' }))) === 'group_needed', 'pacer: approval needs a group');
ok((await err(D.savePacer({ token: T.l, ev: E, name: 'Pace A', phone: '12' }))) === 'bad_phone', 'pacer: phone');
ok((await err(D.savePacer({ token: T.v, ev: E, name: 'Pace A' }))) === 'read_only', 'pacer: viewer cannot add');
const pa = await D.savePacer({ token: T.l, ev: E, name: 'Pace A', phone: '9300000001', group: '2:00', status: 'approved' });
await D.savePacer({ token: T.l, ev: E, name: 'Pace B', phone: '9300000002', group: '2:00', status: 'approved', trial: 'passed', briefing: true, kit: true });
ok((await err(D.savePacer({ token: T.l, ev: E, name: 'Pace C', phone: '9300000002' }))) === 'already_signed_up', 'pacer: duplicate phone');
let pl3 = await D.listPacers({ token: T.l, ev: E });
let g = pl3.groups.find((x) => x.label === '2:00');
ok(g.have === 2 && g.ready === 1 && g.short === 0, 'group coverage: 2 approved, 1 fully ready');
ok(pl3.groups.find((x) => x.label === '1:45').short === 1, 'other group still short');
await D.savePacer({ token: T.l, id: pa.id, ev: E, name: 'Pace A', phone: '9300000001', group: '2:00', status: 'approved', trial: 'passed', briefing: true, kit: true });
ok((await D.listPacers({ token: T.l, ev: E })).groups.find((x) => x.label === '2:00').ready === 2, 'editing a pacer updates readiness');
ok((await err(D.removePacer({ token: T.l, ev: E, id: pa.id }))) === 'director_only', 'lead cannot remove pacer');
await D.removePacer({ token: T.b, ev: E, id: pa.id });
ok((await D.listPacers({ token: T.l, ev: E })).pacers.length === 1, 'director removes pacer');

// ---- safety checklist
let ck = (await D.listChecklist({ token: T.v, ev: E })).items;
ok(ck.length === 14 && ck.every((x) => !x.done), 'checklist: 14 items, none done');
ok((await err(D.toggleCheck({ token: T.v, ev: E, id: ck[0].id, done: true }))) === 'read_only', 'checklist: viewer cannot tick');
await D.toggleCheck({ token: T.l, ev: E, id: ck[0].id, done: true });
ck = (await D.listChecklist({ token: T.l, ev: E })).items;
const tk = ck.find((x) => x.done);
ok(tk && tk.doneBy === 'LEAD1' && tk.doneAt, 'tick records who and when');
await D.toggleCheck({ token: T.l, ev: E, id: tk.id, done: false });
ok(!(await D.listChecklist({ token: T.l, ev: E })).items.some((x) => x.done), 'untick clears it');
ok((await err(D.toggleCheck({ token: T.l, ev: E2, id: ck[0].id, done: true }))) === 'no_item', 'checklist: other race refused');
const nc = await D.addCheck({ token: T.l, ev: E, section: 'Medical', item: 'Spare defibrillator on site' });
ok((await D.listChecklist({ token: T.l, ev: E })).items.length === 15, 'checklist item added');
ok((await err(D.removeCheck({ token: T.l, ev: E, id: nc.id }))) === 'director_only', 'lead cannot remove checklist item');
await D.removeCheck({ token: T.b, ev: E, id: nc.id });
ok((await D.listChecklist({ token: T.l, ev: E })).items.length === 14, 'director removes checklist item');

// ---- command centre
const ov = await D.overview({ token: T.v, ev: E });
ok(ov.expo && ov.expo.total === 3 && ov.expo.checkedIn === 2 && ov.expo.bibs === 2 && ov.expo.shirts === 1, 'overview: expo counts come from this race only');
ok(ov.volunteers.applied >= 1 && ov.volunteers.approved >= 3 && ov.volunteers.need === 4, 'overview: volunteer counts (need ' + ov.volunteers.need + ')');
ok(ov.checklist.total === 14 && ov.checklist.done === 0, 'overview: checklist counts');
ok(ov.run.total === 8 && ov.pacers.need === 3, 'overview: run and pacer counts');
ok(ov.alerts.some((a) => /waiting for approval/.test(a.text)) && ov.alerts.some((a) => /not done, race is within a week/.test(a.text) === false), 'overview: approval alert present; checklist alert only inside a week');
const near = (await D.saveEvent({ token: T.b, name: 'Near Race', date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) })).event;
const ovn = await D.overview({ token: T.v, ev: near.id });
ok(ovn.expo === null && ovn.alerts.some((a) => a.level === 'warn' && /checklist/.test(a.text)), 'overview: race inside a week warns about open checklist');
ok((await err(D.overview({ token: T.v, ev: 'nope' }))) === 'no_event', 'overview: unknown event');

// ---- Wix Events registrations
const G = (n, first, last, cat, o) => Object.assign({ _id: 'g' + n, eventId: 'W1', guestType: 'TICKET_HOLDER', ticketNumber: 'T' + n, orderNumber: 'O' + n, tickets: [{ name: cat, number: 'T' + n, definitionId: 'd1' }],
  guestDetails: { firstName: first, lastName: last, email: first.toLowerCase() + '@x.com', phone: '+91 98480 1200' + n, formResponse: { inputValues: [{ inputName: 'tshirt', value: 'm' }, { inputName: 'bib_name', value: first.toUpperCase() }, { inputName: 'notes', value: 'hi' }] } },
  additionalDetails: { orderStatus: 'PAID' } }, o || {});
global.__EV = { fail: false, events: [{ _id: 'W1', title: 'Ultribe Paderu 26', status: 'SCHEDULED', dateAndTimeSettings: { startDate: new Date('2026-12-05T08:30:00Z') } }],
  guests: [G(1, 'Asha', 'Rao', '25 K - Debut Trail'), G(2, 'Ravi', 'Kumar', '25K'), G(3, 'Kiran', 'P', '110 K - Conquer The Trail'), G(4, 'Meena', 'S', '10 K - Vanajangi Challenge'),
    G(5, 'Cancelled', 'One', '10 K', { additionalDetails: { orderStatus: 'CANCELED' } }), G(6, 'Unpaid', 'Two', '10 K', { additionalDetails: { orderStatus: 'PENDING' } }),
    G(7, '', '', '10 K', { guestDetails: { email: 'n@x.com' } }), G(8, 'Buyer', 'Only', '10 K', { guestType: 'BUYER' }), G(9, 'Other', 'Event', '10 K', { eventId: 'W2' })] };
ok((await err(D.listWixEvents({ token: T.l }))) === 'director_only', 'wix: lead cannot list Wix events');
ok((await D.listWixEvents({ token: T.b })).events[0].start === '2026-12-05', 'wix: events listed with date');
ok((await err(D.importRegs({ token: T.b, ev: E }))) === 'wix_event_not_linked', 'wix: import needs a linked event');
ok((await err(D.linkWixEvent({ token: T.l, ev: E, wixEventId: 'W1' }))) === 'director_only', 'wix: lead cannot link');
await D.linkWixEvent({ token: T.b, ev: E, wixEventId: 'W1' });
ok((await D.listEvents({ token: T.v })).events.find((x) => x.id === E).wixEventId === 'W1', 'wix: link kept on the event');
ok((await D.saveEvent({ token: T.b, id: E, venue: 'RK Beach' })).event.wixEventId === 'W1', 'wix: editing the event keeps the link');
const ff = await D.wixFormFields({ token: T.b, ev: E });
ok(ff.fields.some((f) => f.name === 'tshirt' && f.sample.includes('m')) && ff.tickets.some((t) => t.name === '25 K - Debut Trail'), 'wix: form fields and ticket names shown for mapping');
ok((await D.saveWixMap({ token: T.b, ev: E, map: { size: 'tshirt', bibName: 'bib_name', phone: '' } })).map.size === 'tshirt', 'wix: mapping saved');
global.__EV.fail = true;
ok((await err(D.importRegs({ token: T.b, ev: E }))) === 'wix_events_unavailable', 'wix: Wix failure gives a clear error');
global.__EV.fail = false;
const imp = await D.importRegs({ token: T.b, ev: E });
ok(imp.done && imp.added === 5 && imp.skipped.cancelled === 1 && imp.skipped.noName === 1, 'wix: import adds ticket holders, skips cancelled and nameless');
ok((await D.importRegs({ token: T.b, ev: E })).added === 0, 'wix: importing again adds nothing');
ok((await count('RDRegs', (r) => r.event === E)) === 5, 'wix: one row per ticket, other events and buyers left out');
let lr = await D.listRegs({ token: T.v, ev: E });
const ashaReg = lr.rows.find((r) => r.name === 'Asha Rao');
ok(ashaReg && ashaReg.size === 'M' && ashaReg.bibName === 'ASHA' && ashaReg.phone === '9848012001' && ashaReg.cat === '25 K - Debut Trail', 'wix: size, bib name, phone and ticket name mapped');
ok(lr.cats.find((c) => c.cat === '10 K - Vanajangi Challenge').total === 1 && lr.rows.find((r) => r.name === 'Unpaid Two').unpaid, 'wix: categories counted, pending payment flagged');
ok(lr.expoCount !== null && lr.rows.every((r) => r.inExpo === false), 'wix: runners not yet in findmybib are flagged');
await wd.insert('Runners', { _id: 'Import910~m1', event: 'Import910', bib: 'm1', name: 'Asha R', phone: '9848012001', email: '', cat: '', checkedInAt: '', bibAt: '', shirtAt: '' }, SA);
lr = await D.listRegs({ token: T.v, ev: E });
ok(lr.rows.find((r) => r.name === 'Asha Rao').inExpo === true, 'wix: a registration matches its findmybib runner by phone');
const imp2 = await D.importRegs({ token: T.b, ev: E, cursor: '' });
ok(imp2.updated === 5, 'wix: re-import updates in place');
global.__EV.guests.push(G(10, 'Page', 'Two', '25 K')); global.__EV.guests.push(...Array.from({ length: 210 }, (_, k) => G(100 + k, 'Bulk' + k, 'R', '10 K')));
let cur = '', added = 0, pages = 0;
do { const r = await D.importRegs({ token: T.b, ev: E, cursor: cur }); added += r.added; cur = r.next; pages++; if (r.done) break; } while (pages < 10);
ok(added === 211 && pages >= 2, 'wix: large lists import page by page (' + added + ' in ' + pages + ')');
// remove the bulk rows so later counts stay simple
await wd.bulkRemove('RDRegs', [...(await wd.query('RDRegs').limit(1000).find(SA)).items].filter((r) => /Bulk|Page/.test(r.name)).map((r) => r._id), SA);
global.__EV.guests = global.__EV.guests.filter((g) => !/^g(10$|1\d\d|2\d\d|3\d\d)/.test(g._id));

// ---- qualification checks (run on the imported registrations)
const RULES = [{ cat: '25 K', text: 'Half marathon under 3 hrs', alts: [{ minKm: 21.0975, maxTime: '3:00' }] },
  { cat: '110 K', text: 'Full marathon under 6 hrs, or any 50 km+', alts: [{ minKm: 42.195, maxTime: '6:00' }, { minKm: 50 }] }];
ok((await err(D.saveQualRules({ token: T.l, ev: E, rules: RULES }))) === 'director_only', 'quals: lead cannot set rules');
ok((await err(D.saveQualRules({ token: T.b, ev: E, rules: [{ cat: '25 K', alts: [{}] }] }))) === 'bad_quals', 'quals: empty alternative refused');
ok((await err(D.saveQualRules({ token: T.b, ev: E, rules: [{ cat: '25 K', alts: [{ maxTime: '9:99' }] }] }))) === 'bad_quals', 'quals: bad time refused');
ok((await err(D.saveQualRules({ token: T.b, ev: E, rules: [{ cat: '25 K', alts: [{ minKm: 5 }] }, { cat: '25k', alts: [{ minKm: 5 }] }] }))) === 'bad_quals', 'quals: duplicate category refused');
ok((await D.saveQualRules({ token: T.b, ev: E, rules: RULES })).count === 2, 'quals: rules saved');
ok((await D.listEvents({ token: T.v })).events.find((x) => x.id === E).quals.length === 2, 'quals: rules come back with the event');
ok((await D.saveEvent({ token: T.b, id: E, venue: 'RK Beach' })).event.quals.length === 2, 'quals: editing the event keeps rules');
let ql = await D.listQuals({ token: T.v, ev: E });
ok(ql.rows.length === 3 && ql.counts.pending === 3 && ql.counts.noclaim === 3, 'quals: only registrations in ruled categories listed, all pending with no claim');
ok(!ql.rows.some((r) => r.name === 'Meena S'), 'quals: category without rule not listed');
ok((await err(D.listQuals({ token: T.v, ev: E2 }))) === '' && (await D.listQuals({ token: T.v, ev: E2 })).hasRegs === false, 'quals: race with no registrations is empty, not an error');
const rid = (n) => ql.rows.find((r) => r.name === n).runnerId;
ok((await err(D.saveQualClaim({ token: T.v, ev: E, runnerId: rid('Asha Rao'), text: 'x', km: 21 }))) === 'read_only', 'quals: viewer cannot record a claim');
ok((await err(D.saveQualClaim({ token: T.l, ev: E, runnerId: (await wd.query('RDRegs').eq('name', 'Meena S').find(SA)).items[0]._id, text: 'x', km: 21 }))) === 'no_rule', 'quals: claim for category without rule refused');
ok((await err(D.saveQualClaim({ token: T.l, ev: E, runnerId: 'nope', text: 'x', km: 21 }))) === 'no_runner', 'quals: runner of another race refused');
ok((await err(D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Asha Rao'), km: 21, time: '2:5x' }))) === 'bad_claim', 'quals: bad time refused');
ok((await err(D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Asha Rao'), km: 21, time: '2:50', link: 'javascript:alert(1)' }))) === 'bad_link', 'quals: non-http link refused');
ok((await D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Asha Rao'), text: 'Vizag HM 2025', km: 21.1, time: '2:45:10' })).row.verdict === 'meets', 'quals: half in 2:45 meets 25 K rule');
ok((await D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Ravi Kumar'), text: 'Hyd HM', km: 21.1, time: '3:20' })).row.verdict === 'below', 'quals: half in 3:20 is below');
ok((await D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Kiran P'), text: '50 km trail', km: 50, time: '8:30' })).row.verdict === 'meets', 'quals: second alternative (50 km+) meets');
ok((await D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Kiran P'), text: 'FM', km: 42.2, time: '6:30' })).row.verdict === 'below', 'quals: marathon over 6 hrs is below');
ok((await D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Kiran P'), text: '50 km trail', km: 50, time: '8:30' })).row.verdict === 'meets', 'quals: claim can be replaced');
ok((await count('RDQuals', (q) => q.runnerId === rid('Kiran P'))) === 1, 'quals: one claim row per runner');
ok((await err(D.decideQual({ token: T.l, ev: E, runnerId: rid('Asha Rao'), status: 'banana' }))) === 'bad_status', 'quals: bad status');
ok((await D.decideQual({ token: T.l, ev: E, runnerId: rid('Asha Rao'), status: 'approved' })).row.status === 'approved', 'quals: approve a runner who meets the rule');
ok((await err(D.decideQual({ token: T.l, ev: E, runnerId: rid('Ravi Kumar'), status: 'approved' }))) === 'note_needed', 'quals: approving a runner below the rule needs a reason');
ok((await err(D.decideQual({ token: T.l, ev: E, runnerId: rid('Ravi Kumar'), status: 'rejected' }))) === 'note_needed', 'quals: rejecting needs a reason');
ok((await D.decideQual({ token: T.l, ev: E, runnerId: rid('Ravi Kumar'), status: 'rejected', note: 'Under-distance, move to 10 K' })).row.status === 'rejected', 'quals: reject with reason');
ok((await err(D.decideQual({ token: T.l, ev: E, runnerId: rid('Ravi Kumar'), status: 'waived', note: 'ok by RD' }))) === 'director_only', 'quals: lead cannot waive');
ok((await D.decideQual({ token: T.b, ev: E, runnerId: rid('Ravi Kumar'), status: 'waived', note: 'Known ultra runner' })).row.status === 'waived', 'quals: director can waive with a reason');
ok((await err(D.decideQual({ token: T.v, ev: E, runnerId: rid('Asha Rao'), status: 'rejected', note: 'no' }))) === 'read_only', 'quals: viewer cannot decide');
ql = await D.listQuals({ token: T.v, ev: E });
ok(ql.counts.approved === 1 && ql.counts.waived === 1 && ql.counts.pending === 1, 'quals: counts add up');
ok(ql.rows[0].name === 'Kiran P' && ql.rows[0].status === 'pending', 'quals: pending runners listed first');
await D.saveQualClaim({ token: T.l, ev: E, runnerId: rid('Asha Rao'), text: 'New race', km: 10, time: '0:50' });
ql = await D.listQuals({ token: T.v, ev: E });
const ashaQ = ql.rows.find((r) => r.name === 'Asha Rao');
ok(ashaQ.status === 'pending' && ashaQ.verdict === 'below', 'quals: a new claim resets an old approval');
ok((await D.overview({ token: T.v, ev: E })).alerts.some((a) => /qualification/.test(a.text) && a.go === 'quals'), 'quals: overview alert for uncleared runners');
ok((await D.overview({ token: T.v, ev: E })).quals.pending === 2, 'quals: overview count (not approved or waived)');

// ---- setup
ok((await err(D.ensureSetup({ key: 'wrong' }))) === 'Wrong setup key', 'setup: wrong key refused');
const su = await D.ensureSetup({ key: 'k-test' });
ok(/logins already exist/.test(su.summary), 'setup: does not add an admin when logins exist');

console.log(`Director: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
