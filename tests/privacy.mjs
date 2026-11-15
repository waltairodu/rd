// BACKEND TESTS (Privacy): who may call what, that every list of RaceOS and the Expo desk carries a mask and never a full phone number or
// e-mail address, showing one detail (reason, audit trail first, forty an hour, a burst at one moment), a file with all the contact details,
// the trail, and erasing a person (a shared family number, every race, hand-over selfies, a training account, a refresh from Wix Events and
// from findmybib that must not bring the person back), on one in-memory database with the real RaceOS, Expo, Training and Privacy backends.
//   W1 who may call what   W2 lists carry masks   W3 showing one detail   W4 contact files   W5 the trail   W6 the erase plan
//   W7 erasing   W8 a refresh does not bring a person back   W9 places that cannot be read   W10 same moment   W11 odd input   W12 what is kept
import * as R from './racedir.test.mjs';
import * as PV from './privacy.test.mjs';
import * as X from './exposoft.test.mjs';
import * as TR from './training.test.mjs';
import * as A from './rd-auth.test.mjs';
import * as P from './rd-privacy.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, err, refused, done } = suite('Privacy backend');
const SA = { suppressAuth: true };
const DB = global.__DB;
const rows = (t) => [...(DB[t] || new Map()).values()];
const istDay = (o) => new Date(Date.now() + 5.5 * 3600000 + (o || 0) * 86400000).toISOString().slice(0, 10);
const NAMES = Object.keys(PV).sort();
const B = P.BULLET;
const MASK = (last4) => B.repeat(6) + last4;
const anHourLater = () => {
  const t = DB.RDRate;
  if (t) for (const k of [...t.keys()]) if (k.startsWith('rev~')) t.delete(k);
};

// what the module does to the database, counted
let removes = 0;
const removed = [];
const realBulkRemove = wd.bulkRemove;
for (const fn of ['bulkRemove', 'remove']) {
  if (typeof wd[fn] === 'function') {
    const f = wd[fn];
    wd[fn] = (c, ...a) => {
      removes++;
      removed.push(c);
      return f.call(wd, c, ...a);
    };
  }
}
const rm = (c, ids) => realBulkRemove.call(wd, c, ids, SA);
// the sign-in/limit helper (takeSlot) tidies its own old slots; that is not something this module removes
const removedHere = () => removed.filter((c) => c !== 'RDRate');
let auditUpdates = 0;
const realUpdate = wd.update;
wd.update = (c, ...a) => {
  if (c === 'RDAudit') auditUpdates++;
  return realUpdate.call(wd, c, ...a);
};
// a collection that cannot be read, and an audit trail that cannot be written
const realQuery = wd.query;
const DOWN = new Set();
wd.query = (name, ...rest) => {
  if (DOWN.has(name)) throw new Error('down ' + name + ' secret-detail');
  return realQuery.call(wd, name, ...rest);
};
const realInsert = wd.insert;
let AUDIT_DOWN = false;
let RATE_DOWN = false;
wd.insert = (c, ...a) => {
  if (AUDIT_DOWN && c === 'RDAudit') throw new Error('audit down secret-detail');
  if (RATE_DOWN && c === 'RDRate') throw new Error('rate down secret-detail');
  return realInsert.call(wd, c, ...a);
};

/* ---------- the world ---------- */
const HASH = A.hashPassword('Pv-pass-1');
const mkStaff = (username, role, extra) => wd.insert('ExpoStaff', Object.assign({ username, password: HASH, role, name: username, failCount: '0', lockUntil: '', desks: '', race: '' }, extra || {}), SA);
const WHO = [['boss', 'admin'], ['dir2', 'director'], ['lead1', 'lead'], ['lead2', 'lead'], ['view1', 'viewer'], ['coach1', 'coach'], ['intern1', 'intern']];
for (const [u, r] of WHO) await mkStaff(u, r);
await mkStaff('desk1', 'desk', { desks: 'Desk 1 - BIB', race: 'Import910' });
await mkStaff('desk3', 'desk', { desks: 'Desk 3 - Misc', race: 'Import910' });
const TOK = {};
for (const u of [...WHO.map((w) => w[0]), 'desk1', 'desk3']) {
  TOK[u] = A.newToken();
  await wd.insert('ExpoSessions', { token: TOK[u], username: u, desk: u === 'desk1' ? 'Desk 1 - BIB' : u === 'desk3' ? 'Desk 3 - Misc' : '', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
}
TOK.ghost = A.newToken();
await wd.insert('ExpoSessions', { token: TOK.ghost, username: 'nobody', desk: '', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
TOK.old = A.newToken();
await wd.insert('ExpoSessions', { token: TOK.old, username: 'boss', desk: '', expires: new Date(Date.now() - 1000).toISOString() }, SA);
TOK.fresh = A.newToken(); // a director whose staff row is removed after the login
await mkStaff('gone1', 'admin');
await wd.insert('ExpoSessions', { token: TOK.fresh, username: 'gone1', desk: '', expires: new Date(Date.now() + 36000000).toISOString() }, SA);
for (const r of rows('ExpoStaff')) if (r.username === 'gone1') await rm('ExpoStaff', [r._id]);
const call = (m, who, a) => PV[m](Object.assign({ token: TOK[who] }, a));

const RD = istDay(60);
const mkRace = async (name, venue, expoId) => (await R.saveEvent({ token: TOK.boss, name, date: RD, venue, expoId: expoId || '' })).event.id;
await wd.insert('ExpoConfig', { _id: 'Import910', name: 'Privacy Run A', json: JSON.stringify({ bibLot: 5, shirtLot: { S: 5, M: 5, L: 5 } }) }, SA);
const EVA = await mkRace('Privacy Run A', 'Beach Road', 'Import910');
const EVB = await mkRace('Privacy Run B', 'Pier');
const EVP = await mkRace('Privacy Run P big', 'Park');

const reg = (ev, ticket, p) => wd.insert('RDRegs', Object.assign({ _id: ev + '~' + ticket, event: ev, ticketNumber: ticket, orderNumber: 'O' + ticket, guestId: 'g' + ticket, bibName: '', size: 'M', status: 'ok', form: '', at: '2026-11-01T10:00:00.000Z', bib: '' }, p), SA);
const ASHA = '9848012345';
await reg(EVA, 'T101', { name: 'Asha Rao', phone: ASHA, email: 'asha.rao@example.com', cat: '10 K', bib: '101', bibName: 'ASHA', form: JSON.stringify([{ name: 'Phone', value: ASHA }, { name: 'Emergency contact', value: '9000099999' }]) });
await reg(EVA, 'T102', { name: 'Bina Rao', phone: '+91 98480 12345', email: 'bina.rao@example.com', cat: '10 K', bib: '102', bibName: 'BINA' }); // the same number: a family
await reg(EVA, 'T103', { name: 'Chitra Devi', phone: '9812300103', email: 'chitra@example.com', cat: '21 K', bib: '103', size: 'L' });
await reg(EVA, 'T104', { name: 'Dev Raman', phone: '', email: '', cat: '21 K', bib: '104' });
await reg(EVA, 'T105', { name: '<img src=x onerror=1>Eve', phone: '9812300107', email: 'eve@example.com', cat: '10 K', bib: '105' });
await reg(EVB, 'T201', { name: 'Asha Rao', phone: '+91 98480 12345', email: 'asha.work@example.org', cat: '10 K', bib: '201' }); // the same person in another race, other address
await reg(EVB, 'T202', { name: 'Olga Other', phone: '9812300777', email: 'olga@example.com', cat: '10 K', bib: '202' });
const vol = (ev, id, p) => wd.insert('RDVolunteers', Object.assign({ _id: id, event: ev, club: '', status: 'approved', code: 'C' + id.toUpperCase(), notes: '', waiverAt: '', waiverVersion: '', createdAt: '2026-11-02T00:00:00.000Z' }, p), SA);
await vol(EVA, 'v1', { name: 'Asha Volunteer', phone: ASHA, email: 'asha.rao@example.com', club: 'VTRA Vizag', notes: 'knee problem', waiverAt: '2026-11-03' });
await vol(EVA, 'v2', { name: 'Sita Sharma', phone: '9000000002', email: 'sita@example.com' });
const pacer = (ev, id, p) => wd.insert('RDPacers', Object.assign({ _id: id, event: ev, group: '2:00', status: 'approved', notes: '' }, p), SA);
await pacer(EVA, 'p1', { name: 'Kiran Pacer', phone: '9111111111' });
await pacer(EVA, 'p2', { name: 'Asha Pacer', phone: '+91 98480-12345', notes: 'asha note' });
// the Expo desk: the runner copies of race A and the hand-over records
const runner = (bib, p) => wd.insert('Runners', Object.assign({ _id: 'Import910~' + bib, event: 'Import910', bib, bibName: '', cat: '10K', size: 'M', phone: '', email: '', example: '', checkedInAt: '', bibAt: '', shirtAt: '', shirtSize: '' }, p), SA);
await runner('101', { name: 'Asha Rao', bibName: 'ASHA', bibAt: '2026-11-14T05:00:00.000Z', checkedInAt: '2026-11-14T05:00:00.000Z' }); // no contact on the copy: found by the bib and the name
await runner('102', { name: 'Bina Rao', phone: ASHA, email: '' });
await runner('103', { name: 'Chitra Devi', phone: '9812300103', email: 'chitra@example.com' });
const check = (id, p) => wd.insert('ExpoCheckins', Object.assign({ _id: id, event: 'Import910', bib: id.split('~')[1].split('#')[0], name: '', pickupBy: 'self', friendName: '', friendPhone: '', method: 'selfie', selfie: '', at: '2026-11-14T05:00:00.000Z', desk: 'Desk 1 - BIB' }, p), SA);
await check('Import910~101', { name: 'Asha Rao', pickupBy: 'friend', friendName: 'Friend Fred', friendPhone: '9777788888', selfie: 'data:image/jpeg;base64,CANARYSELFIE101' });
await check('Import910~101#shirt', { name: 'Asha Rao', desk: 'Desk 2 - Tshirt', selfie: 'data:image/jpeg;base64,CANARYSELFIE102' });
await check('Import910~102', { name: 'Bina Rao', selfie: 'data:image/jpeg;base64,BINASELFIE' });
await wd.insert('RDQuals', { _id: 'q1', event: EVA, runnerId: EVA + '~T101', name: 'Asha Rao', cat: '10 K', claim: '2:10', claimKm: '42.2', claimSec: '7800', link: 'http://strava.example/asha', status: 'ok', note: 'asha qualified', by: 'boss', at: '2026-11-02T00:00:00.000Z' }, SA);
await wd.insert('RDQuals', { _id: 'q2', event: EVA, runnerId: EVA + '~T103', name: 'Chitra Devi', cat: '21 K', claim: '1:40', claimKm: '21.1', claimSec: '6000', link: 'http://strava.example/chitra', status: 'ok', note: 'chitra note', by: 'boss', at: '2026-11-02T00:00:00.000Z' }, SA);
const wv = (id, ref, why) => wd.insert('RDWaivers', { _id: id, event: EVA, kind: 'sig', ref, sub: '', who: 'paper', status: '', why, json: '{"ver":1}', by: 'boss', at: '2026-11-03T00:00:00.000Z' }, SA);
await wv('w1', EVA + '~T101', 'signed by asha father');
await wv('w2', EVA + '~T103', 'chitra paper');
await wv('w3', 'v1', 'asha volunteer paper');
// a training account (made the way the athlete makes it)
const ath = await TR.athleteSignup({ name: 'Asha Rao', phone: '+91 98480 12345', pin: '123456', level: 'Beginner', goal: '10K in 60' });
const ATHID = (await wd.query('TrainAthletes').eq('phone', ASHA).limit(1).find(SA)).items[0]._id;
await wd.insert('TrainEnroll', { _id: 'enr1', athlete: ATHID, plan: 'p', planName: '8 weeks', start: '2026-11-01', kind: 'coached', coach: '', coachName: 'Coach C', coachStatus: 'active', reqNote: 'my knee hurts', status: 'active', createdAt: '2026-11-01', endedAt: '' }, SA);
await wd.insert('TrainSessions', { _id: 's1', enroll: 'enr1', athlete: ATHID, date: '2026-11-02', week: '1', type: 'easy', title: 'Easy run', km: '5', minutes: '30', notes: 'plan note', status: 'done', aKm: '5', aMin: '31', rpe: '4', aNote: 'felt tired today', feedback: 'rest well asha', feedbackBy: 'Coach C', feedbackAt: '2026-11-03', source: '' }, SA);
await wd.insert('TrainMsgs', { _id: 'm1', enroll: 'enr1', from: 'athlete', name: 'Asha Rao', text: 'hello coach, call me on 9848012345', at: '2026-11-03', read: '' }, SA);
await wd.insert('TrainAthletes', { _id: 'ath-other', name: 'Other Athlete', phone: '9000012345', salt: 's', pinHash: 'h', level: 'Beginner', goal: '', goalDate: '', failCount: '0', lockUntil: '', createdAt: '2026-11-01' }, SA);

// every full phone number and address that must never leave in a list
const RAW = [ASHA, '98480 12345', '+91 98480', '9812300103', '9812300107', '9812300777', '9000000002', '9111111111', '9777788888', 'asha.rao@example.com', 'bina.rao@example.com', 'chitra@example.com', 'eve@example.com', 'sita@example.com', 'asha.work@example.org', 'olga@example.com'];
const leaks = (v) => RAW.filter((x) => JSON.stringify(v).includes(x));
const ID = { asha: EVA + '~T101', bina: EVA + '~T102', chitra: EVA + '~T103', dev: EVA + '~T104', ashaB: EVB + '~T201' };

/* ---------- W1 who may call what ---------- */
{
  const args = {
    pvList: { ev: EVA },
    pvReveal: { ev: EVA, kind: 'reg', id: ID.asha, field: 'phone', reason: 'contact' },
    pvExport: { ev: EVA, kind: 'regs', reason: 'contact' },
    pvErasePlan: { phone: '9000012345' },
    pvErase: { phone: '9000012345', keys: ['athlete~ath-other'], confirm: 'NO' },
  };
  eq(NAMES, ['pvErase', 'pvErasePlan', 'pvExport', 'pvList', 'pvReveal'], 'W1 the module has exactly five methods');
  const want = {
    boss: [1, 1, 1, 1, 1], dir2: [1, 1, 1, 1, 1], lead1: ['director_only', 1, 'director_only', 'director_only', 'director_only'],
  };
  const order = ['pvList', 'pvReveal', 'pvExport', 'pvErasePlan', 'pvErase'];
  for (const who of ['boss', 'dir2', 'lead1']) {
    for (let i = 0; i < order.length; i++) {
      const m = order[i];
      const got = await err(call(m, who, args[m]));
      const w = want[who][i];
      // an allowed call may still stop on its own later checks (the erase here has the wrong word on purpose), but never on who is asking
      const okWho = w === 1 ? !['not_logged_in', 'not_allowed', 'director_only'].includes(got) : got === w;
      ok(okWho, 'W1 ' + who + ' calls ' + m + (w === 1 ? ' (allowed)' : ' -> ' + w) + (okWho ? '' : '   [got ' + got + ']'));
    }
  }
  DB.RDAudit && DB.RDAudit.clear();
  for (const who of ['view1', 'coach1', 'desk1', 'intern1']) for (const m of order) await refused(call(m, who, args[m]), 'not_allowed', 'W1 ' + who + ' calls ' + m + ' -> not_allowed');
  for (const m of order) {
    await refused(PV[m](args[m]), 'not_logged_in', 'W1 ' + m + ' with no token');
    for (const [label, t] of [['a short token', 'x'.repeat(19)], ['an expired session', TOK.old], ['a person who is no longer staff', TOK.fresh], ['a session of nobody', TOK.ghost], ['an unknown token', 'z'.repeat(40)], ['a list as the token', [TOK.boss]], ['an object as the token', { toString: () => TOK.boss }], ['a number', 12345678901234567890], ['null', null]]) {
      await refused(PV[m](Object.assign({}, args[m], { token: t })), 'not_logged_in', 'W1 ' + m + ' with ' + label);
    }
  }
  ok(NAMES.every((m) => typeof PV[m] === 'function'), 'W1 all are functions');
  eq(rows('RDAudit').length, 0, 'W1 refused calls wrote nothing in the audit trail');
}

/* ---------- W2 lists carry masks ---------- */
{
  for (const who of ['boss', 'lead1', 'view1']) {
    const lr = await R.listRegs({ token: TOK[who], ev: EVA });
    eq(leaks(lr), [], 'W2 ' + who + ': the registrations list holds no full phone number or address');
    const a = lr.rows.find((r) => r.name === 'Asha Rao');
    eq([a.phone, a.email], [MASK('2345'), 'a•••@e•••.com'], 'W2 ' + who + ': Asha shows a masked number and address');
    eq(lr.rows.find((r) => r.name === 'Bina Rao').phone, MASK('2345'), 'W2 ' + who + ': a number typed with a country code and spaces is masked the same way');
    const d = lr.rows.find((r) => r.name === 'Dev Raman');
    eq([d.phone, d.email], ['', ''], 'W2 ' + who + ': nothing stays nothing (the screen shows no Show button)');
    eq(lr.rows.find((r) => r.id === EVA + '~T105').email, 'e•••@e•••.com', 'W2 ' + who + ': a hostile name does not change the mask of the address');
    const vl = await R.listVolunteers({ token: TOK[who], ev: EVA });
    eq(leaks(vl), [], 'W2 ' + who + ': the volunteers list holds no full phone number or address');
    eq(vl.volunteers.find((v) => v.id === 'v1').phone, MASK('2345'), 'W2 ' + who + ': a volunteer shows a masked number');
    const pl = await R.listPacers({ token: TOK[who], ev: EVA });
    eq(leaks(pl), [], 'W2 ' + who + ': the pacers list holds no full phone number');
    eq(pl.pacers.find((v) => v.id === 'p2').phone, MASK('2345'), 'W2 ' + who + ': a pacer shows a masked number');
  }
  const lrA = await R.listRegs({ token: TOK.boss, ev: EVA });
  ok(lrA.rows.length === 5 && lrA.rows.every((r) => (r.phone === '' || /^•{6}\d{0,4}$/.test(r.phone)) && (r.email === '' || /^[a-z0-9•]•••@[a-z0-9•]•••(\.[a-z]{2,12})?$/.test(r.email))), 'W2 every phone in the list is six dots and at most four digits, every address a letter, dots, @, a letter, dots and an ending');
  // the Expo desk: the runner list, the changes since, a runner just added
  for (const who of ['boss', 'desk1']) {
    const pg = await X.loadPage({ token: TOK[who], ev: 'Import910' });
    eq(leaks(pg), [], 'W2 Expo ' + who + ': the runner list holds no full phone number or address');
    const c = pg.runners.find((r) => r.bib === '103');
    eq([c.phone, c.email], [MASK('0103'), 'c•••@e•••.com'], 'W2 Expo ' + who + ': a runner shows the last four digits and a masked address');
    eq(pg.runners.find((r) => r.bib === '101').phone, '', 'W2 Expo ' + who + ': a runner with no number shows none');
    const sn = await X.loadSince({ token: TOK[who], ev: 'Import910', since: '2000-01-01T00:00:00.000Z' });
    eq(leaks(sn), [], 'W2 Expo ' + who + ': the changes since hold no full phone number or address');
  }
  const add = await X.addRunner({ token: TOK.desk3, ev: 'Import910', bib: '150', name: 'Added Person', phone: '9444455555', email: 'added@example.com', cat: '10K', size: 'M' });
  eq([add.runner.phone, add.runner.email], [MASK('5555'), 'a•••@e•••.com'], 'W2 Expo: a runner added at the desk comes back masked');
  eq(rows('Runners').find((r) => r._id === 'Import910~150').phone, '9444455555', 'W2 Expo: and is stored in full (the mask is only for what leaves)');
  await rm('Runners', ['Import910~150']);
  // the details of the registration form shown while fields are mapped
  global.__EV = {
    fail: false,
    events: [{ _id: 'WPV', title: 'Privacy Run A', status: 'SCHEDULED', dateAndTimeSettings: { startDate: new Date('2026-12-05T08:30:00Z') } }],
    guests: [1, 2].map((n) => ({
      _id: 'pg' + n, eventId: 'WPV', guestType: 'TICKET_HOLDER', ticketNumber: 'PT' + n, orderNumber: 'PO' + n, tickets: [{ name: '10 K', number: 'PT' + n, definitionId: 'd1' }],
      guestDetails: { firstName: 'Form' + n, lastName: 'Person', email: 'form' + n + '@example.com', phone: '+91 9876500' + n + '00', formResponse: { inputValues: [{ inputName: 'tshirt', value: 'm' }, { inputName: 'contact_phone', value: '98765001' + n + '0' }, { inputName: 'contact_mail', value: 'private' + n + '@example.com' }, { inputName: 'bib_name', value: 'FORM' + n }] } },
      additionalDetails: { orderStatus: 'PAID' },
    })),
  };
  await R.linkWixEvent({ token: TOK.boss, ev: EVP, wixEventId: 'WPV' });
  const ff = await R.wixFormFields({ token: TOK.boss, ev: EVP });
  const f = (n) => ff.fields.find((x) => x.name === n);
  ok(f('tshirt') && f('tshirt').sample.includes('m') && f('bib_name').sample.includes('FORM1'), 'W2 form examples that are not contact details are shown as they are');
  eq(f('contact_phone').sample.every((s) => /^•{6}\d{4}$/.test(s)) && f('contact_phone').sample.length === 2, true, 'W2 form examples that are numbers are masked');
  eq(f('contact_mail').sample.every((s) => /^p•••@e•••\.com$/.test(s)), true, 'W2 form examples that are addresses are masked');
  eq(JSON.stringify(ff).match(/private\d@example|98765001\d0/g), null, 'W2 no full number or address in the form fields');
}

/* ---------- W3 showing one detail ---------- */
{
  DB.RDAudit && DB.RDAudit.clear();
  anHourLater();
  const rq = (o) => Object.assign({ ev: EVA, kind: 'reg', id: ID.asha, field: 'phone', reason: 'contact' }, o);
  const r1 = await call('pvReveal', 'boss', rq());
  eq([r1.value, r1.field, r1.kind, r1.id, r1.ms], [ASHA, 'phone', 'reg', ID.asha, 30000], 'W3 a director sees a registrant\'s phone number');
  eq((await call('pvReveal', 'lead1', rq({ field: 'email' }))).value, 'asha.rao@example.com', 'W3 a lead sees an address');
  eq((await call('pvReveal', 'dir2', rq({ id: ID.bina }))).value, '+91 98480 12345', 'W3 the number is given as it is stored');
  eq((await call('pvReveal', 'boss', rq({ kind: 'vol', id: 'v1' }))).value, ASHA, 'W3 a volunteer\'s number');
  eq((await call('pvReveal', 'boss', rq({ kind: 'vol', id: 'v2', field: 'email' }))).value, 'sita@example.com', 'W3 a volunteer\'s address');
  eq((await call('pvReveal', 'boss', rq({ kind: 'pacer', id: 'p1' }))).value, '9111111111', 'W3 a pacer\'s number');
  for (const [reason] of P.REASONS) ok((await call('pvReveal', 'boss', rq({ reason }))).value === ASHA, 'W3 reason ' + reason + ' is accepted');
  // the audit trail: written for every show, with the reason, and never with the number or the address
  const trail = rows('RDAudit').filter((r) => /^reveal /.test(r.action));
  ok(trail.length === 6 + P.REASONS.length, 'W3 one note for every show: ' + trail.length);
  const t1 = trail[0];
  eq([t1.action, t1.by, t1.target, t1.detail], ['reveal phone', 'boss', 'Privacy Run A', 'reg ' + ID.asha + ' · contact'], 'W3 the note says who, what, which race and why');
  eq(trail.filter((r) => r.action === 'reveal e-mail').length, 2, 'W3 an address is noted as an address');
  ok(trail.every((r) => typeof r.at === 'string' && r.at.length >= 20), 'W3 every note has a time');
  eq(RAW.filter((x) => JSON.stringify(rows('RDAudit')).includes(x)), [], 'W3 no number or address is anywhere in the audit trail');
  const before = rows('RDAudit').length;
  // what is refused, and writes nothing
  await refused(call('pvReveal', 'boss', rq({ reason: undefined })), 'pv_need_reason', 'W3 no reason, no show');
  await refused(call('pvReveal', 'boss', rq({ reason: 'bored' })), 'pv_need_reason', 'W3 a reason that is not on the list, no show');
  await refused(call('pvReveal', 'boss', rq({ kind: 'runner' })), 'pv_bad_request', 'W3 an Expo runner cannot be shown here');
  await refused(call('pvReveal', 'boss', rq({ kind: 'pacer', field: 'email' })), 'pv_bad_request', 'W3 a pacer has no address to show');
  await refused(call('pvReveal', 'boss', rq({ field: 'name' })), 'pv_bad_request', 'W3 only a phone number or an address');
  await refused(call('pvReveal', 'boss', rq({ id: 'nope' })), 'pv_not_found', 'W3 a row that is not there');
  await refused(call('pvReveal', 'boss', rq({ id: ID.ashaB })), 'pv_not_found', 'W3 a row of another race (the race on the screen decides)');
  await refused(call('pvReveal', 'boss', rq({ ev: EVB })), 'pv_not_found', 'W3 the same id with the other race');
  await refused(call('pvReveal', 'boss', rq({ ev: 'nope' })), 'no_event', 'W3 a race that is not there');
  await refused(call('pvReveal', 'boss', rq({ id: ID.dev })), 'pv_not_found', 'W3 a person with no number has nothing to show');
  await refused(call('pvReveal', 'boss', rq({ id: ID.dev, field: 'email' })), 'pv_not_found', 'W3 or no address');
  await refused(call('pvReveal', 'boss', rq({ kind: 'vol', id: ID.asha })), 'pv_not_found', 'W3 a registration id used as a volunteer id');
  eq(rows('RDAudit').length, before, 'W3 nothing refused was written as a show');
  // no record, no value
  AUDIT_DOWN = true;
  const got = await err(call('pvReveal', 'boss', rq()));
  AUDIT_DOWN = false;
  eq(got, 'pv_audit_failed', 'W3 when the note cannot be written nothing is shown');
  eq(rows('RDAudit').length, before, 'W3 and no note is left');
  // forty an hour for each login
  anHourLater();
  DB.RDAudit.clear();
  let okCount = 0;
  let last = '';
  for (let i = 0; i < 45; i++) {
    const m = await err(call('pvReveal', 'lead1', rq()));
    if (!m) okCount++;
    else last = m;
  }
  eq([okCount, last], [40, 'pv_too_many'], 'W3 forty shows an hour, then "too many"');
  eq(rows('RDAudit').filter((r) => r.by === 'lead1' && /^reveal /.test(r.action)).length, 40, 'W3 and exactly forty notes');
  ok((await call('pvReveal', 'boss', rq())).value === ASHA, 'W3 another login is not held back by this one');
  anHourLater();
  ok((await call('pvReveal', 'lead1', rq())).value === ASHA, 'W3 an hour later the lead can show again');
  // a burst: sixty at the same moment still gets forty
  anHourLater();
  const burst = await Promise.all(Array.from({ length: 60 }, () => err(call('pvReveal', 'lead2', rq({ kind: 'vol', id: 'v2' })))));
  eq([burst.filter((m) => !m).length, burst.filter((m) => m === 'pv_too_many').length], [40, 20], 'W3 sixty at once: forty shown, twenty refused');
  eq(rows('RDAudit').filter((r) => r.by === 'lead2' && /^reveal /.test(r.action)).length, 40, 'W3 and forty notes');
  anHourLater();
  // a destructive look: the erased are not shown
  await wd.update('RDVolunteers', Object.assign({}, rows('RDVolunteers').find((v) => v._id === 'v2'), { name: P.ERASED }), SA);
  await refused(call('pvReveal', 'boss', rq({ kind: 'vol', id: 'v2' })), 'pv_not_found', 'W3 an erased row shows nothing');
  await wd.update('RDVolunteers', Object.assign({}, rows('RDVolunteers').find((v) => v._id === 'v2'), { name: 'Sita Sharma' }), SA);
  DB.RDAudit.clear();
}

/* ---------- W4 contact files ---------- */
{
  const x = (who, o) => call('pvExport', who, Object.assign({ ev: EVA, kind: 'regs', reason: 'contact' }, o));
  const p = await x('boss');
  eq([p.count, p.total, p.next, p.from], [5, 5, null, 0], 'W4 a race with five registrations is one page');
  ok(p.csv.startsWith('"Name","Ticket","Category","T-shirt size","Bib","Bib name","Payment","Phone","E-mail"\r\n'), 'W4 the heading is first');
  ok(p.csv.includes('"Asha Rao","T101","10 K","M","101","ASHA","paid","9848012345","asha.rao@example.com"'), 'W4 a row has the full number and address');
  ok(p.csv.includes('"\'+91 98480 12345","bina.rao@example.com"') && !p.csv.includes('asha.work') && !p.csv.includes('Olga'), 'W4 a number that starts with + is written so a spreadsheet reads it as text (a leading apostrophe), and the other race is not in the file');
  ok(!p.csv.includes(P.BULLET) && !p.csv.includes('9000099999') && !p.csv.includes('Emergency'), 'W4 a file holds no mask and none of the form answers');
  ok(p.csv.indexOf('Asha Rao') < p.csv.indexOf('Bina Rao') && p.csv.indexOf('Bina Rao') < p.csv.indexOf('Chitra Devi'), 'W4 rows are in name order');
  ok(p.csv.includes('"\'<img src=x onerror=1>Eve"') === false && p.csv.includes('<img src=x onerror=1>Eve'), 'W4 a hostile name is only text in the file');
  eq(p.name, 'privacy-run-a-regs-with-contacts.csv', 'W4 the file name');
  eq((await x('boss', { kind: 'vols' })).csv.split('\r\n').length, 4, 'W4 volunteers: heading and two rows');
  const vols = (await x('boss', { kind: 'vols' })).csv;
  ok(vols.includes('"Asha Volunteer","VTRA Vizag","approved","9848012345","asha.rao@example.com"') && !vols.includes('CV1') && !vols.includes('knee'), 'W4 volunteers: contact in full, no code, no notes');
  const pc = (await x('boss', { kind: 'pacers' })).csv;
  ok(pc.includes('"Kiran Pacer","2:00","approved","9111111111"') && !pc.includes('example.com'), 'W4 pacers: contact in full');
  await refused(x('lead1'), 'director_only', 'W4 a lead cannot get a contact file');
  await refused(x('view1'), 'not_allowed', 'W4 a viewer cannot');
  await refused(x('desk1'), 'not_allowed', 'W4 a desk cannot');
  await refused(x('boss', { reason: undefined }), 'pv_need_reason', 'W4 a reason is needed');
  await refused(x('boss', { kind: 'runners' }), 'pv_bad_request', 'W4 only registrations, volunteers or pacers');
  await refused(x('boss', { from: -5 }), 'pv_bad_request', 'W4 a start below zero');
  await refused(x('boss', { ev: 'nope' }), 'no_event', 'W4 a race that is not there');
  const aud = rows('RDAudit').filter((r) => r.action === 'contacts exported');
  ok(aud.length === 4 && aud[0].by === 'boss' && aud[0].target === 'Privacy Run A' && aud[0].detail === 'Registrations: rows 1-5 of 5 · contact', 'W4 each file is noted: ' + (aud[0] && aud[0].detail));
  eq(RAW.filter((s) => JSON.stringify(rows('RDAudit')).includes(s)), [], 'W4 the notes hold no number or address');
  const emptyRace = await call('pvExport', 'boss', { ev: EVB, kind: 'pacers', reason: 'fix' });
  eq([emptyRace.count, emptyRace.total, emptyRace.csv.split('\r\n').length], [0, 0, 2], 'W4 a race with nobody gives a heading only');
  ok(rows('RDAudit').some((r) => r.detail === 'Pacers: rows none of 0 · fix'), 'W4 and says so in the note');
  // a big race: three pages, one note each, nothing lost
  const MANY = 2300;
  for (let i = 0; i < MANY; i++) await wd.insert('RDRegs', { _id: EVP + '~B' + i, event: EVP, ticketNumber: 'B' + i, name: 'Big ' + String(i).padStart(4, '0'), phone: '9' + String(100000000 + i), email: 'big' + i + '@example.com', cat: '10 K', bib: String(3000 + i), size: 'M', status: i % 10 === 0 ? 'unpaid' : 'ok', form: '', bibName: '' }, SA);
  const pages = [];
  for (let from = 0, n = 0; from !== null && n < 5; n++) {
    const pg = await call('pvExport', 'boss', { ev: EVP, kind: 'regs', reason: 'pay', from });
    pages.push(pg);
    from = pg.next;
  }
  eq(pages.map((q) => q.count), [1000, 1000, 300], 'W4 2300 rows are three pages');
  const lines = pages.map((q) => q.csv.split('\r\n').filter(Boolean)).flat();
  eq(lines.length, MANY + 1, 'W4 every row once, and one heading');
  ok(lines[1].startsWith('"Big 0000"') && lines[MANY].startsWith('"Big 2299"') && lines[1].includes('"pending"') && lines[2].includes('"paid"'), 'W4 order and payment words');
  eq(rows('RDAudit').filter((r) => /^Registrations: rows/.test(r.detail) && /· pay$/.test(r.detail)).map((r) => r.detail), ['Registrations: rows 1-1000 of 2300 · pay', 'Registrations: rows 1001-2000 of 2300 · pay', 'Registrations: rows 2001-2300 of 2300 · pay'], 'W4 every page is noted with its rows');
  const past = await call('pvExport', 'boss', { ev: EVP, kind: 'regs', reason: 'pay', from: 5000 });
  eq([past.count, past.csv, past.next], [0, '', null], 'W4 past the end is an empty page');
  // formula-safe cells
  await reg(EVA, 'T900', { name: '=HYPERLINK("http://evil")', phone: '+9848012399', email: '@x.com', cat: '-1', bib: '900' });
  const ev = (await x('boss')).csv;
  ok(ev.includes('"\'=HYPERLINK(""http://evil"")"') && ev.includes('"\'+9848012399"') && ev.includes('"\'@x.com"'), 'W4 a cell can never start a formula');
  await rm('RDRegs', [EVA + '~T900']);
  // no record, no file
  const b4 = rows('RDAudit').length;
  AUDIT_DOWN = true;
  const g2 = await err(x('boss'));
  AUDIT_DOWN = false;
  eq([g2, rows('RDAudit').length], ['pv_audit_failed', b4], 'W4 when the note cannot be written there is no file');
}

/* ---------- W5 the trail ---------- */
{
  // reset to a known trail
  DB.RDAudit.clear();
  const rq = (o) => Object.assign({ ev: EVA, kind: 'reg', id: ID.asha, field: 'phone', reason: 'contact' }, o);
  await call('pvReveal', 'lead1', rq());
  await call('pvReveal', 'boss', rq({ id: ID.chitra, field: 'email', reason: 'pay' }));
  await call('pvReveal', 'boss', rq({ kind: 'vol', id: 'v1', reason: 'safety' }));
  await call('pvReveal', 'boss', rq({ kind: 'pacer', id: 'p1', reason: 'fix' }));
  await wd.insert('RDAudit', { at: '2026-11-12T00:00:00.000Z', by: 'boss', action: 'audience exported', target: 'Privacy Run A', detail: 'everyone: 5 rows' }, SA);
  await wd.insert('RDAudit', { at: '2026-11-12T00:00:01.000Z', by: 'boss', action: 'WhatsApp links opened', target: 'Privacy Run A', detail: '5 links' }, SA);
  await wd.insert('RDAudit', { at: '2026-11-12T00:00:02.000Z', by: 'boss', action: 'login created', target: 'someone', detail: 'new login' }, SA);
  await wd.insert('RDAudit', { at: '2026-11-12T00:00:03.000Z', by: 'boss', action: 'report saved as CSV', target: 'x', detail: 'y' }, SA);
  const l = await call('pvList', 'boss', { ev: EVA });
  eq([l.me.role, l.race.name, l.perHour], ['director', 'Privacy Run A', 40], 'W5 who and which race');
  eq(l.reasons.map((r) => r.id), ['contact', 'fix', 'pay', 'safety', 'other'], 'W5 the reasons for the screen');
  eq(l.files, [{ kind: 'regs', title: 'Registrations', rows: 5 }, { kind: 'vols', title: 'Volunteers', rows: 2 }, { kind: 'pacers', title: 'Pacers', rows: 2 }], 'W5 what each file would hold');
  ok(l.log.length === 6, 'W5 six notes about contact details; the login and the report notes are not among them: ' + l.log.map((r) => r.action).join(','));
  ok(!l.log.some((r) => r.action === 'login created' || r.action === 'report saved as CSV'), 'W5 other notes are not listed');
  const ats = l.log.map((r) => r.at);
  ok(ats.every((v, i) => i === 0 || ats[i - 1] >= v), 'W5 newest first');
  const rv = l.log.filter((r) => /^reveal /.test(r.action));
  eq(rv.map((r) => [r.by, r.kind, r.reason, r.who]).sort((a, b) => String(a[3]).localeCompare(String(b[3]))), [['boss', 'vol', 'safety', 'Asha Volunteer'], ['lead1', 'reg', 'contact', 'Asha Rao'], ['boss', 'reg', 'pay', 'Chitra Devi'], ['boss', 'pacer', 'fix', 'Kiran Pacer']].sort((a, b) => String(a[3]).localeCompare(String(b[3]))), 'W5 a show is listed with who looked, which kind, why and the name the row has now');
  ok(l.log.filter((r) => !/^reveal /.test(r.action)).every((r) => r.who === '' && r.kind === ''), 'W5 other notes name no one');
  eq(leaks(l), [], 'W5 the trail holds no number or address');
  // names come from the row now: an erased person shows as erased
  await wd.update('RDRegs', Object.assign({}, rows('RDRegs').find((r) => r._id === ID.chitra), { name: P.ERASED }), SA);
  eq((await call('pvList', 'boss', { ev: EVA })).log.find((r) => r.kind === 'reg' && r.reason === 'pay').who, P.ERASED, 'W5 a person erased since shows as erased');
  await wd.update('RDRegs', Object.assign({}, rows('RDRegs').find((r) => r._id === ID.chitra), { name: 'Chitra Devi' }), SA);
  // a row that has gone shows no name
  await rm('RDPacers', ['p1']);
  eq((await call('pvList', 'boss', { ev: EVA })).log.find((r) => r.kind === 'pacer').who, '', 'W5 a row that is gone shows no name');
  await pacer(EVA, 'p1', { name: 'Kiran Pacer', phone: '9111111111' });
  await refused(call('pvList', 'lead1', { ev: EVA }), 'director_only', 'W5 a lead cannot see the trail');
  await refused(call('pvList', 'view1', { ev: EVA }), 'not_allowed', 'W5 a viewer cannot');
  await refused(call('pvList', 'boss', { ev: 'nope' }), 'no_event', 'W5 a race that is not there');
  // only the newest hundred
  for (let i = 0; i < 130; i++) await wd.insert('RDAudit', { at: '2026-12-' + String((i % 28) + 1).padStart(2, '0') + 'T00:00:' + String(i % 60).padStart(2, '0') + '.000Z', by: 'boss', action: 'contacts exported', target: 'x', detail: 'Registrations: rows 1-1 of 1 · fix' + i }, SA);
  const big = await call('pvList', 'boss', { ev: EVA });
  eq(big.log.length, 100, 'W5 at most a hundred notes');
  ok(big.log.every((r) => r.action === 'contacts exported'), 'W5 and they are the newest ones');
  DB.RDAudit.clear();
}

/* ---------- W6 the erase plan ---------- */
{
  const plan = (who, o) => call('pvErasePlan', who, o);
  const p = await plan('boss', { phone: '+91 98480 12345' });
  const keys = p.items.map((i) => i.key).sort();
  eq(keys, ['athlete~' + ATHID, 'pacer~p2', 'reg~' + ID.ashaB, 'reg~' + ID.asha, 'reg~' + ID.bina, 'runner~Import910~101', 'runner~Import910~102', 'vol~v1'].sort(), 'W6 a number finds registrations of both races, the Expo copies, the volunteer, the pacer and the training account');
  eq([p.total, p.capped, p.unread], [8, false, []], 'W6 eight rows, not capped, nothing unread');
  const by = (k) => p.items.find((i) => i.key === k);
  eq(by('reg~' + ID.asha), { key: 'reg~' + ID.asha, kind: 'reg', race: 'Privacy Run A', name: 'Asha Rao', bib: '101', phone: MASK('2345'), email: 'a•••@e•••.com' }, 'W6 a row of the plan is masked, with race, name and bib');
  eq(by('runner~Import910~101').name, 'Asha Rao', 'W6 the Expo copy with no number is found by the same bib and name');
  eq(by('runner~Import910~101').race, 'Privacy Run A', 'W6 and shown with the name of the race');
  ok(!p.items.some((i) => i.key === 'runner~Import910~103'), 'W6 another runner with another number is not in it');
  eq(leaks(p), [], 'W6 the plan holds no number or address');
  const em = await plan('boss', { email: 'ASHA.RAO@example.com' });
  eq(em.items.map((i) => i.key).sort(), ['reg~' + ID.asha, 'runner~Import910~101', 'vol~v1'].sort(), 'W6 an address finds its rows in any case (and the Expo copy by bib and name)');
  eq((await plan('boss', { phone: ASHA, email: 'asha.work@example.org' })).items.length, 8, 'W6 a number and an address together find the union (a row that matches both is listed once)');
  eq((await plan('boss', { phone: '9000012345' })).items.map((i) => i.key), ['athlete~ath-other'], 'W6 another person');
  eq((await plan('boss', { phone: '9999999999' })).items, [], 'W6 nobody');
  await refused(plan('boss', {}), 'pv_bad_person', 'W6 a number or an address is needed');
  await refused(plan('boss', { phone: '12345' }), 'pv_bad_person', 'W6 a short number would find too many');
  await refused(plan('boss', { email: 'x' }), 'pv_bad_person', 'W6 half an address too');
  await refused(plan('lead1', { phone: ASHA }), 'director_only', 'W6 a lead cannot');
  eq((await plan('dir2', { phone: ASHA })).total, 8, 'W6 any director can');
  eq(rows('RDAudit').length, 0, 'W6 a plan writes nothing');
  eq(await err(call('pvErasePlan', 'boss', { phone: ASHA })), '', 'W6 (again, no change)');
  // too many rows for one erase
  for (let i = 0; i < 205; i++) await wd.insert('RDPacers', { _id: 'pm' + i, event: EVB, name: 'Many ' + i, phone: '9555500000', group: '', status: 'applied', notes: '' }, SA);
  const cap = await plan('boss', { phone: '9555500000' });
  eq([cap.items.length, cap.total, cap.capped], [200, 205, true], 'W6 a plan shows at most 200 rows and says it is cut');
  await refused(call('pvErase', 'boss', { phone: '9555500000', keys: cap.items.map((i) => i.key), confirm: 'ERASE' }), 'pv_too_big', 'W6 and refuses to erase so many in one go');
  await rm('RDPacers', Array.from({ length: 205 }, (x, i) => 'pm' + i));
}

/* ---------- W7 erasing ---------- */
const snapBefore = {
  regsA: (await R.listRegs({ token: TOK.boss, ev: EVA })).rows.length,
  ev: await R.overview({ token: TOK.boss, ev: EVA }),
};
{
  const er = (who, o) => call('pvErase', who, o);
  const base = { phone: ASHA };
  const mine = ['athlete~' + ATHID, 'pacer~p2', 'reg~' + ID.ashaB, 'reg~' + ID.asha, 'runner~Import910~101', 'vol~v1'];
  await refused(er('boss', Object.assign({ keys: mine }, base)), 'pv_need_confirm', 'W7 the word ERASE has to be typed');
  await refused(er('boss', Object.assign({ keys: mine, confirm: 'erase' }, base)), 'pv_need_confirm', 'W7 in capitals');
  await refused(er('boss', Object.assign({ keys: mine, confirm: ' ERASE' }, base)), 'pv_need_confirm', 'W7 and nothing else');
  await refused(er('boss', Object.assign({ keys: mine, confirm: true }, base)), 'pv_need_confirm', 'W7 true is not the word');
  await refused(er('boss', { phone: ASHA, keys: [], confirm: 'ERASE' }), 'pv_bad_request', 'W7 something must be ticked');
  await refused(er('boss', { phone: ASHA, confirm: 'ERASE' }), 'pv_bad_request', 'W7 no list of keys');
  await refused(er('boss', { phone: ASHA, keys: 'reg~x', confirm: 'ERASE' }), 'pv_bad_request', 'W7 keys must be a list');
  await refused(er('boss', { phone: ASHA, keys: ['reg~' + ID.chitra], confirm: 'ERASE' }), 'pv_stale', 'W7 a key of someone else is not in the plan');
  await refused(er('boss', { phone: ASHA, keys: ['reg~' + ID.asha, 'reg~' + ID.chitra], confirm: 'ERASE' }), 'pv_stale', 'W7 one wrong key stops the whole erase');
  await refused(er('boss', { phone: ASHA, keys: ['vol~' + ID.asha], confirm: 'ERASE' }), 'pv_stale', 'W7 a key of the wrong kind');
  await refused(er('boss', { phone: ASHA, keys: ['reg~nope'], confirm: 'ERASE' }), 'pv_stale', 'W7 a key that is not there');
  await refused(er('boss', { confirm: 'ERASE', keys: mine }), 'pv_bad_person', 'W7 who is being erased must be said');
  await refused(er('lead1', Object.assign({ keys: mine, confirm: 'ERASE' }, base)), 'director_only', 'W7 a lead cannot');
  await refused(er('view1', Object.assign({ keys: mine, confirm: 'ERASE' }, base)), 'not_allowed', 'W7 a viewer cannot');
  eq(rows('RDAudit').length, 0, 'W7 nothing refused was noted as an erase');
  eq(rows('RDRegs').find((r) => r._id === ID.asha).name, 'Asha Rao', 'W7 and nothing was changed');
  // no record, no erase
  AUDIT_DOWN = true;
  const gA = await err(er('boss', Object.assign({ keys: mine, confirm: 'ERASE' }, base)));
  AUDIT_DOWN = false;
  eq([gA, rows('RDRegs').find((r) => r._id === ID.asha).name], ['pv_audit_failed', 'Asha Rao'], 'W7 when the note cannot be written nothing is erased');

  // the family: Asha ticks her own rows and not Bina's (the same number)
  const res = await er('boss', Object.assign({ keys: mine, confirm: 'ERASE' }, base));
  eq(res.erased, { athlete: 1, pacer: 1, reg: 2, runner: 1, vol: 1 }, 'W7 six rows erased: ' + JSON.stringify(res.erased));
  eq(res.summary, '2 registrations, 1 Expo runner, 1 volunteer, 1 pacer, 1 training account', 'W7 said in words');
  eq(res.unread, [], 'W7 nothing unread');
  const aud = rows('RDAudit').filter((r) => r.action === 'person erased');
  eq(aud.length, 1, 'W7 one note');
  eq([aud[0].by, aud[0].target, aud[0].detail], ['boss', 'RaceOS', '2 registrations, 1 Expo runner, 1 volunteer, 1 pacer, 1 training account'], 'W7 who, and how many of each (no name, no number)');
  // what is gone, and what stays
  const g = (t, id) => rows(t).find((r) => r._id === id);
  const a = g('RDRegs', ID.asha);
  eq([a.name, a.phone, a.email, a.bibName, a.form], [P.ERASED, '', '', '', ''], 'W7 the registration loses who the person is');
  eq([a.bib, a.cat, a.size, a.status, a.ticketNumber, a.orderNumber, a.guestId, a.event, a.at], ['101', '10 K', 'M', 'ok', 'T101', 'OT101', 'gT101', EVA, '2026-11-01T10:00:00.000Z'], 'W7 and keeps the ticket, bib, category, size and status');
  eq([g('RDRegs', ID.ashaB).name, g('RDRegs', ID.ashaB).phone, g('RDRegs', ID.ashaB).email], [P.ERASED, '', ''], 'W7 the other race too');
  eq([g('RDRegs', ID.bina).name, g('RDRegs', ID.bina).phone, g('RDRegs', ID.bina).email], ['Bina Rao', '+91 98480 12345', 'bina.rao@example.com'], 'W7 the family member who was not ticked is untouched');
  eq([g('Runners', 'Import910~101').name, g('Runners', 'Import910~101').bibName, g('Runners', 'Import910~101').bib, g('Runners', 'Import910~101').bibAt], [P.ERASED, '', '101', '2026-11-14T05:00:00.000Z'], 'W7 the Expo runner loses the name and keeps the bib and the time it was given');
  eq([g('Runners', 'Import910~102').name, g('Runners', 'Import910~102').phone], ['Bina Rao', ASHA], 'W7 the Expo runner of the family member is untouched');
  const c1 = g('ExpoCheckins', 'Import910~101');
  eq([c1.name, c1.friendName, c1.friendPhone, c1.selfie, c1.pickupBy, c1.method, c1.at, c1.desk], ['', '', '', '', 'friend', 'selfie', '2026-11-14T05:00:00.000Z', 'Desk 1 - BIB'], 'W7 the hand-over record loses the selfie and the friend and keeps that it happened');
  eq([g('ExpoCheckins', 'Import910~101#shirt').selfie, g('ExpoCheckins', 'Import910~101#shirt').name, g('ExpoCheckins', 'Import910~101#shirt').desk], ['', '', 'Desk 2 - Tshirt'], 'W7 the T-shirt hand-over too');
  eq(g('ExpoCheckins', 'Import910~102').selfie, 'data:image/jpeg;base64,BINASELFIE', 'W7 the family member\'s selfie stays');
  eq([g('RDQuals', 'q1').name, g('RDQuals', 'q1').link, g('RDQuals', 'q1').note, g('RDQuals', 'q1').claim, g('RDQuals', 'q1').status], [P.ERASED, '', '', '2:10', 'ok'], 'W7 the qualification claim loses name, link and note');
  eq([g('RDQuals', 'q2').name, g('RDQuals', 'q2').link], ['Chitra Devi', 'http://strava.example/chitra'], 'W7 another person\'s claim stays');
  eq([g('RDWaivers', 'w1').why, g('RDWaivers', 'w1').kind, g('RDWaivers', 'w1').ref], ['', 'sig', ID.asha], 'W7 the waiver record keeps that it was signed, not the note');
  eq(g('RDWaivers', 'w3').why, '', 'W7 the volunteer waiver note too');
  eq(g('RDWaivers', 'w2').why, 'chitra paper', 'W7 another person\'s waiver note stays');
  const v1 = g('RDVolunteers', 'v1');
  eq([v1.name, v1.phone, v1.email, v1.club, v1.notes], [P.ERASED, '', '', '', ''], 'W7 the volunteer loses who the person is');
  eq([v1.status, v1.waiverAt, v1.event], ['approved', '2026-11-03', EVA], 'W7 and keeps the status and that the waiver was signed');
  ok(v1.code === P.ERASED && v1.code !== v1.code.toUpperCase(), 'W7 and the code can never be matched by a typed one');
  eq([g('RDPacers', 'p2').name, g('RDPacers', 'p2').phone, g('RDPacers', 'p2').notes, g('RDPacers', 'p2').group], [P.ERASED, '', '', '2:00'], 'W7 the pacer');
  const at = g('TrainAthletes', ATHID);
  eq([at.name, at.phone, at.salt, at.pinHash, at.goal, at.level], [P.ERASED, P.ERASED, '', '', '', 'Beginner'], 'W7 the training account loses who the person is');
  eq([g('TrainEnroll', 'enr1').reqNote, g('TrainEnroll', 'enr1').status, g('TrainEnroll', 'enr1').planName], ['', 'active', '8 weeks'], 'W7 the request note');
  eq([g('TrainSessions', 's1').aNote, g('TrainSessions', 's1').feedback, g('TrainSessions', 's1').aKm, g('TrainSessions', 's1').rpe], ['', '', '5', '4'], 'W7 the session notes go, the figures stay');
  eq([g('TrainMsgs', 'm1').name, g('TrainMsgs', 'm1').text, g('TrainMsgs', 'm1').at], ['', '', '2026-11-03'], 'W7 the messages lose their words');
  eq(rows('TrainTokens').filter((t) => t.athlete === ATHID).length, 0, 'W7 the athlete is signed out everywhere');
  eq(g('TrainAthletes', 'ath-other').name, 'Other Athlete', 'W7 another athlete is untouched');
  await refused(TR.athleteLogin({ phone: ASHA, pin: '123456' }), 'bad_login', 'W7 the athlete can no longer sign in');
  await refused(TR.athleteLogin({ phone: '', pin: '123456' }), 'bad_login', 'W7 and an empty number finds no account');
  // nothing of the person is left anywhere (the family member's rows are expected to remain)
  const whole = JSON.stringify(Object.keys(DB).filter((k) => !['ExpoSessions', 'ExpoStaff'].includes(k)).map((k) => [k, rows(k).filter((r) => !/Bina|BINA|Bina/.test(JSON.stringify(r)))]));
  eq(['Asha', 'ASHA', 'asha.rao@example.com', 'asha.work@example.org', 'CANARYSELFIE', 'Friend Fred', '9777788888', 'knee', 'my knee hurts', 'felt tired', 'rest well', 'call me on', 'father', 'qualified', 'strava.example/asha', 'asha note', 'asha volunteer paper', 'VTRA Vizag'].filter((s) => whole.includes(s) && !(s === 'ASHA' && false)), [], 'W7 no word, number, address, selfie or note of the person is left anywhere (except the family member\'s own rows)');
  // counts and money are as before
  eq((await R.listRegs({ token: TOK.boss, ev: EVA })).rows.length, snapBefore.regsA, 'W7 the race still has the same number of registrations');
  const ov = await R.overview({ token: TOK.boss, ev: EVA });
  eq(ov, snapBefore.ev, 'W7 and the same overview figures');
  const lr = await R.listRegs({ token: TOK.boss, ev: EVA });
  const ea = lr.rows.find((r) => r.id === ID.asha);
  eq([ea.name, ea.phone, ea.email, ea.bib, ea.cat], [P.ERASED, '', '', '101', '10 K'], 'W7 the list shows the erased row as erased, with its bib');
  // a second erase finds nothing
  await refused(er('boss', Object.assign({ keys: mine, confirm: 'ERASE' }, base)), 'pv_stale', 'W7 erasing again is refused: the rows are already erased');
  eq((await call('pvErasePlan', 'boss', { phone: ASHA })).items.map((i) => i.key).sort(), ['reg~' + ID.bina, 'runner~Import910~102'].sort(), 'W7 the plan now holds only the family member');
  // the show and the file for an erased row
  await refused(call('pvReveal', 'boss', { ev: EVA, kind: 'reg', id: ID.asha, field: 'phone', reason: 'contact' }), 'pv_not_found', 'W7 an erased row shows nothing');
  const file = (await call('pvExport', 'boss', { ev: EVA, kind: 'regs', reason: 'contact' })).csv;
  ok(!file.includes('(erased)') && !file.includes('T101') && file.includes('Bina Rao'), 'W7 and is not in a file');
  const vf = (await call('pvExport', 'boss', { ev: EVA, kind: 'vols', reason: 'contact' })).csv;
  ok(!vf.includes('Asha') && vf.includes('Sita'), 'W7 nor the volunteer');
  eq(RAW.filter((s) => JSON.stringify(rows('RDAudit')).includes(s)), [], 'W7 the audit trail holds no number or address');
  eq(removedHere(), ['TrainTokens'], 'W7 only the athlete\'s sign-ins were removed (one call), no row of anything else');
}

/* ---------- W8 a refresh does not bring a person back ---------- */
{
  // Wix Events: the same ticket holder is still there, and a refresh must leave the erased row alone
  global.__EV = {
    fail: false,
    events: [{ _id: 'W9', title: 'Privacy Run A', status: 'SCHEDULED', dateAndTimeSettings: { startDate: new Date('2026-12-05T08:30:00Z') } }],
    guests: [
      { _id: 'g1', eventId: 'W9', guestType: 'TICKET_HOLDER', ticketNumber: 'T101', orderNumber: 'OT101', tickets: [{ name: '10 K', number: 'T101', definitionId: 'd1' }], guestDetails: { firstName: 'Asha', lastName: 'Rao', email: 'asha.rao@example.com', phone: '+91 98480 12345', formResponse: { inputValues: [{ inputName: 'tshirt', value: 'm' }] } }, additionalDetails: { orderStatus: 'PAID' } },
      { _id: 'g2', eventId: 'W9', guestType: 'TICKET_HOLDER', ticketNumber: 'T106', orderNumber: 'OT106', tickets: [{ name: '10 K', number: 'T106', definitionId: 'd1' }], guestDetails: { firstName: 'New', lastName: 'Person', email: 'new@example.com', phone: '+91 98480 99999', formResponse: { inputValues: [{ inputName: 'tshirt', value: 'l' }] } }, additionalDetails: { orderStatus: 'PAID' } },
    ],
  };
  await R.linkWixEvent({ token: TOK.boss, ev: EVA, wixEventId: 'W9' });
  const imp = await R.importRegs({ token: TOK.boss, ev: EVA });
  eq([imp.done, imp.added, imp.skipped.erased], [true, 1, 1], 'W8 a refresh from Wix Events adds the new person and skips the erased one: ' + JSON.stringify(imp));
  const a = rows('RDRegs').find((r) => r._id === ID.asha);
  eq([a.name, a.phone, a.email, a.form], [P.ERASED, '', '', ''], 'W8 the erased registration stays erased');
  eq(rows('RDRegs').find((r) => r._id === EVA + '~T106').name, 'New Person', 'W8 the new one came in');
  const again = await R.importRegs({ token: TOK.boss, ev: EVA });
  eq([again.added, again.skipped.erased], [0, 1], 'W8 and again: still skipped');
  await rm('RDRegs', [EVA + '~T106']);
  // the findmybib source still has the person: a sync must not refill the erased Expo runner
  await wd.insert('Import910', { _id: 'f1', bibNo: '101', participantName: 'Asha Rao', phoneNumber: ASHA, email: 'asha.rao@example.com', category: '10K', tshirtSize: 'M' }, SA);
  await wd.insert('Import910', { _id: 'f2', bibNo: '110', participantName: 'Fresh Face', phoneNumber: '9333344444', email: 'fresh@example.com', category: '10K', tshirtSize: 'L' }, SA);
  const sync = await X.syncFromFindMyBib({ token: TOK.boss, ev: 'Import910' });
  eq([sync.added, sync.updated], [1, 0], 'W8 a sync from findmybib adds the new runner and does not touch the erased one: ' + JSON.stringify(sync));
  const r101 = rows('Runners').find((r) => r._id === 'Import910~101');
  eq([r101.name, r101.phone, r101.email, r101.bibName], [P.ERASED, '', '', ''], 'W8 the erased Expo runner stays erased');
  eq(rows('Runners').find((r) => r._id === 'Import910~110').phone, '9333344444', 'W8 the new runner came in');
  // a send to the Expo desk skips the erased registration
  const sent = await R.sendToExpo({ token: TOK.boss, ev: EVA });
  ok(!rows('Runners').some((r) => r.name === P.ERASED && r._id !== 'Import910~101'), 'W8 sending registrations to the Expo desk does not create a runner called (erased): ' + JSON.stringify(sent));
  eq(rows('Runners').find((r) => r._id === 'Import910~101').name, P.ERASED, 'W8 and does not refill the erased one');
  // an erased registration that has no Expo runner yet is not sent either: no runner called (erased) is made at the desk
  await reg(EVA, 'T310', { name: 'Ila Gone', phone: '9444455555', email: 'ila@example.com', cat: '10 K', bib: '310' });
  const planIla = await call('pvErasePlan', 'boss', { phone: '9444455555' });
  eq(planIla.items.map((i) => i.kind), ['reg'], 'W8 control: the registration is the only row of that person (no Expo runner yet)');
  await call('pvErase', 'boss', { phone: '9444455555', keys: planIla.items.map((i) => i.key), confirm: 'ERASE' });
  const ila = rows('RDRegs').find((r) => r._id === EVA + '~T310');
  eq([ila.name, ila.status, ila.bib], [P.ERASED, 'ok', '310'], 'W8 control: it is erased, still paid and still has its bib');
  ok(!rows('Runners').some((r) => r._id === 'Import910~310'), 'W8 control: and there is no runner for that bib');
  const sent2 = await R.sendToExpo({ token: TOK.boss, ev: EVA });
  ok(!rows('Runners').some((r) => r._id === 'Import910~310') && !rows('Runners').some((r) => r.name === P.ERASED && r._id !== 'Import910~101'), 'W8 sending again does not make a runner out of the erased registration: ' + JSON.stringify(sent2));
  await rm('RDRegs', [EVA + '~T310']);
  await rm('Runners', ['Import910~110']);
  await rm('Import910', ['f1', 'f2']);
}

/* ---------- W9 places that cannot be read ---------- */
{
  // register someone fresh to erase
  await reg(EVA, 'T300', { name: 'Gita Gone', phone: '9222233333', email: 'gita@example.com', cat: '10 K', bib: '300' });
  await vol(EVA, 'v3', { name: 'Gita Vol', phone: '9222233333', email: 'gita@example.com' });
  await wd.insert('Runners', { _id: 'Import910~300', event: 'Import910', bib: '300', name: 'Gita Gone', bibName: '', cat: '10K', size: 'M', phone: '9222233333', email: '', example: '', checkedInAt: '', bibAt: '', shirtAt: '', shirtSize: '' }, SA);
  await check('Import910~300', { name: 'Gita Gone', selfie: 'data:image/jpeg;base64,GITASELFIE' });
  const planOf = () => call('pvErasePlan', 'boss', { phone: '9222233333' });
  const e1 = console.error;
  console.error = () => {};
  DOWN.add('RDRegs');
  await refused(planOf(), 'server_error', 'W9 registrations that cannot be read stop the plan, with no detail');
  await refused(call('pvErase', 'boss', { phone: '9222233333', keys: ['reg~' + EVA + '~T300'], confirm: 'ERASE' }), 'server_error', 'W9 and the erase');
  DOWN.delete('RDRegs');
  for (const [col, label] of [['RDVolunteers', 'Volunteers'], ['RDPacers', 'Pacers'], ['Runners', 'Expo runners'], ['TrainAthletes', 'Training accounts']]) {
    DOWN.add(col);
    const p = await planOf();
    eq(p.unread, [label], 'W9 ' + col + ' down: the plan says "' + label + '" could not be read');
    ok(p.items.some((i) => i.kind === 'reg'), 'W9 ' + col + ' down: the rest is still found');
    DOWN.delete(col);
  }
  DOWN.add('RDEvents');
  await refused(planOf(), 'server_error', 'W9 races that cannot be read stop the plan');
  DOWN.delete('RDEvents');
  // the hand-over records cannot be read: the runner is erased, and the screen is told
  DOWN.add('ExpoCheckins');
  const keysG = (await planOf()).items.map((i) => i.key);
  eq(keysG.sort(), ['reg~' + EVA + '~T300', 'runner~Import910~300', 'vol~v3'].sort(), 'W9 the plan before the erase');
  const res = await call('pvErase', 'boss', { phone: '9222233333', keys: keysG, confirm: 'ERASE' });
  DOWN.delete('ExpoCheckins');
  eq(res.unread, ['Hand-over records'], 'W9 the erase says the hand-over records could not be read');
  eq(rows('Runners').find((r) => r._id === 'Import910~300').name, P.ERASED, 'W9 the rest was erased');
  ok(rows('ExpoCheckins').find((r) => r._id === 'Import910~300').selfie.includes('GITASELFIE'), 'W9 and the selfie is still there (that is what "unread" means: do it again later)');
  eq(await err(call('pvList', 'boss', { ev: EVA })), '', 'W9 (the trail works again)');
  // errors never carry detail
  AUDIT_DOWN = true;
  const msgs = [];
  for (const [m, a] of [['pvReveal', { ev: EVA, kind: 'reg', id: ID.bina, field: 'phone', reason: 'contact' }], ['pvExport', { ev: EVA, kind: 'regs', reason: 'contact' }]]) msgs.push(await err(call(m, 'boss', a)));
  AUDIT_DOWN = false;
  eq(msgs, ['pv_audit_failed', 'pv_audit_failed'], 'W9 a failing audit trail gives one known code');
  DOWN.add('ExpoSessions');
  await refused(call('pvList', 'boss', { ev: EVA }), 'setup_needed', 'W9 logins that cannot be read: setup_needed');
  DOWN.delete('ExpoSessions');
  DOWN.add('ExpoStaff');
  await refused(call('pvList', 'boss', { ev: EVA }), 'setup_needed', 'W9 staff that cannot be read: setup_needed');
  DOWN.delete('ExpoStaff');
  DOWN.add('RDAudit');
  await refused(call('pvList', 'boss', { ev: EVA }), 'server_error', 'W9 a trail that cannot be read: server_error, with no detail');
  DOWN.delete('RDAudit');
  console.error = e1;
  RATE_DOWN = true;
  await refused(call('pvReveal', 'boss', { ev: EVA, kind: 'reg', id: ID.bina, field: 'phone', reason: 'contact' }), 'setup_needed', 'W9 a limit that cannot be checked: nothing is shown');
  RATE_DOWN = false;
  const seen = [];
  const e0 = console.error;
  console.error = (m) => seen.push(String(m));
  DOWN.add('RDAudit');
  const text = await err(call('pvList', 'boss', { ev: EVA }));
  DOWN.delete('RDAudit');
  console.error = e0;
  ok(text === 'server_error' && !/secret-detail|down /.test(text), 'W9 the browser gets only "server_error"');
  ok(seen.some((m) => /secret-detail/.test(m)), 'W9 and the detail goes to the log');
}

/* ---------- W10 same moment ---------- */
{
  await reg(EVA, 'T400', { name: 'Hari Hurry', phone: '9666677777', email: 'hari@example.com', cat: '10 K', bib: '400' });
  const keys = ['reg~' + EVA + '~T400'];
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => err(call('pvErase', 'boss', { phone: '9666677777', keys, confirm: 'ERASE' }))));
  ok(rs.some((m) => m === ''), 'W10 five erases at one moment: at least one went through (' + rs.join(',') + ')');
  ok(rs.every((m) => m === '' || m === 'pv_stale'), 'W10 and the others were stale, nothing else');
  const row = rows('RDRegs').find((r) => r._id === EVA + '~T400');
  eq([row.name, row.phone, row.email, row.bib], [P.ERASED, '', '', '400'], 'W10 the end state is the same');
  const sh = await Promise.all(Array.from({ length: 12 }, (x, i) => call('pvReveal', i % 2 ? 'dir2' : 'boss', { ev: EVA, kind: 'reg', id: ID.bina, field: 'email', reason: 'fix' }).then((r) => r.value)));
  eq(new Set(sh).size, 1, 'W10 twelve shows at once all give the same address');
}

/* ---------- W11 odd input ---------- */
{
  const ODD = [undefined, null, 0, -1, 1.5, NaN, true, false, '', ' ', 'x'.repeat(3000), [], [[]], {}, { a: 1 }, ['reg~x'], () => 1];
  const allowed = new Set(['pv_bad_request', 'pv_need_reason', 'pv_not_found', 'pv_bad_person', 'pv_need_confirm', 'pv_stale', 'no_event', 'director_only', 'not_logged_in', 'not_allowed', 'server_error', 'setup_needed', '']);
  const base = {
    pvList: { ev: EVA },
    pvReveal: { ev: EVA, kind: 'reg', id: ID.bina, field: 'phone', reason: 'contact' },
    pvExport: { ev: EVA, kind: 'regs', reason: 'contact', from: 0 },
    pvErasePlan: { phone: '9000012345', email: '' },
    pvErase: { phone: '9000012345', keys: ['athlete~ath-other'], confirm: 'NO' },
  };
  const bad = [];
  let calls = 0;
  for (const m of Object.keys(base)) {
    for (const k of Object.keys(base[m]).concat(['junk'])) {
      for (const v of ODD) {
        calls++;
        const arg = Object.assign({ token: TOK.boss }, base[m], { [k]: v });
        const got = await err(PV[m](arg));
        if (!allowed.has(got)) bad.push(m + '.' + k + '=' + String(typeof v) + ' -> ' + got);
      }
    }
    for (const arg of [undefined, null, 'x', 5, [], [TOK.boss], true]) {
      const got = await err(PV[m](arg));
      if (got !== 'not_logged_in') bad.push(m + ' with a non-object -> ' + got);
    }
  }
  eq(bad, [], 'W11 ' + calls + ' calls with odd values in every field give only the known codes');
  eq(rows('RDRegs').find((r) => r._id === ID.bina).name, 'Bina Rao', 'W11 and nothing was erased by any of them');
  // inherited names are not methods, kinds or fields
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    await refused(call('pvReveal', 'boss', { ev: EVA, kind: k, id: ID.bina, field: 'phone', reason: 'contact' }), 'pv_bad_request', 'W11 kind ' + k);
    await refused(call('pvReveal', 'boss', { ev: EVA, kind: 'reg', id: ID.bina, field: k, reason: 'contact' }), 'pv_bad_request', 'W11 field ' + k);
    await refused(call('pvExport', 'boss', { ev: EVA, kind: k, reason: 'contact' }), 'pv_bad_request', 'W11 file kind ' + k);
    await refused(call('pvReveal', 'boss', { ev: EVA, kind: 'reg', id: k, field: 'phone', reason: 'contact' }), 'pv_not_found', 'W11 id ' + k);
  }
  await refused(call('pvReveal', 'boss', { ev: EVA, kind: 'reg', id: ID.bina, field: 'phone', reason: '__proto__' }), 'pv_need_reason', 'W11 reason __proto__');
  // the token is read as text only: a list that prints as a good token does not work
  await refused(PV.pvList({ token: { toString: () => TOK.boss, length: 40 }, ev: EVA }), 'not_logged_in', 'W11 an object that prints as a token');
  eq(await err(PV.pvList({ token: TOK.boss, ev: EVA, role: 'director', may: true, admin: true })), '', 'W11 anything extra is ignored, and does not make anyone a director');
  await refused(PV.pvList({ token: TOK.view1, ev: EVA, role: 'director', kind: 'director', username: 'boss' }), 'not_allowed', 'W11 a viewer cannot claim to be a director');
}

/* ---------- W12 what is kept ---------- */
{
  eq(auditUpdates, 0, 'W12 no note in the audit trail was ever changed');
  eq(removedHere(), ['TrainTokens'], 'W12 in the whole run the module removed nothing but one athlete\'s sign-ins');
  ok(rows('RDRegs').filter((r) => r.name === P.ERASED).every((r) => r.bib && r.event && r.ticketNumber), 'W12 every erased registration kept its bib, race and ticket');
  ok(rows('RDRegs').length >= 7 + 2300, 'W12 no registration row was deleted');
  eq(rows('RDVolunteers').length, 3, 'W12 no volunteer row was deleted');
  ok(rows('Runners').length >= 3 && ['Import910~101', 'Import910~102', 'Import910~103'].every((id) => rows('Runners').some((r) => r._id === id)), 'W12 no Expo runner row was deleted');
}

/* ---------- W13 editing a pacer from the masked list ---------- */
{
  const sp = (a) => R.savePacer(Object.assign({ token: TOK.boss, ev: EVA, group: '2:00', status: 'approved' }, a));
  const raw = (id) => rows('RDPacers').find((r) => r._id === id);
  const made = await sp({ name: 'Mani Pacer', phone: '9222233333' });
  eq(raw(made.id).phone, '9222233333', 'W13 a new pacer is saved with the number typed');
  const lst = await R.listPacers({ token: TOK.boss, ev: EVA });
  const shown = lst.pacers.find((p) => p.id === made.id);
  eq(shown.phone, MASK('3333'), 'W13 the list shows the hidden number, so the edit screen cannot be filled from it');
  await sp({ id: made.id, name: 'Mani Pacer', phone: '', notes: 'edited' });
  eq(raw(made.id).phone, '9222233333', 'W13 an edit saved with the phone box empty keeps the number');
  eq(raw(made.id).notes, 'edited', 'W13 and the other changes are saved');
  await sp({ id: made.id, name: 'Mani Pacer', phone: shown.phone, notes: 'edited again' });
  eq(raw(made.id).phone, '9222233333', 'W13 the hidden number sent back by an older screen does not overwrite the number');
  eq(raw(made.id).notes, 'edited again', 'W13 and that edit is saved too');
  await sp({ id: made.id, name: 'Mani Pacer', notes: 'no phone field' });
  eq(raw(made.id).phone, '9222233333', 'W13 an edit with no phone field at all keeps the number');
  for (const v of [B, B + B + B, '   ', '+91 ' + MASK('3333'), '9222233333' + B]) {
    await sp({ id: made.id, name: 'Mani Pacer', phone: v });
    eq(raw(made.id).phone, '9222233333', 'W13 a phone box holding "' + v.trim() + '" keeps the number');
  }
  await sp({ id: made.id, name: 'Mani Pacer', phone: '92222 44444' });
  eq(raw(made.id).phone, '9222244444', 'W13 a number typed in the box replaces the number');
  await refused(sp({ id: made.id, name: 'Mani Pacer', phone: '123' }), 'bad_phone', 'W13 a number that is too short is refused');
  eq(raw(made.id).phone, '9222244444', 'W13 and nothing changed');
  await refused(sp({ id: made.id, name: 'Mani Pacer', phone: '9111111111' }), 'already_signed_up', 'W13 another pacer\'s number is refused');
  eq(raw(made.id).phone, '9222244444', 'W13 and nothing changed again');
  // a new pacer
  await refused(sp({ name: 'Mask Pacer', phone: MASK('3333') }), 'bad_phone', 'W13 a new pacer whose number is the dots is refused');
  eq(rows('RDPacers').filter((p) => p.name === 'Mask Pacer').length, 0, 'W13 and nothing was added');
  const nophone = await sp({ name: 'No Phone Pacer', phone: '' });
  eq(raw(nophone.id).phone, '', 'W13 a new pacer may still be saved without a number');
  // an erased pacer is not brought back
  const gone = rows('RDPacers').find((r) => r.name === P.ERASED);
  ok(!!gone, 'W13 there is an erased pacer in the run (setup check)');
  if (gone) {
    await refused(sp({ id: gone._id, name: 'Back Again', phone: '9848012345' }), 'no_pacer', 'W13 an erased pacer cannot be edited back to life');
    eq([raw(gone._id).name, raw(gone._id).phone], [P.ERASED, ''], 'W13 and the row is as it was');
  }
  // who may save
  await refused(R.savePacer({ token: TOK.view1, ev: EVA, id: made.id, name: 'Mani Pacer', phone: '9000099999', group: '2:00', status: 'approved' }), 'read_only', 'W13 a viewer cannot change a pacer');
  await refused(R.savePacer({ token: TOK.desk1, ev: EVA, id: made.id, name: 'Mani Pacer', phone: '9000099999', group: '2:00', status: 'approved' }), 'not_allowed', 'W13 a desk login cannot change a pacer');
  eq(raw(made.id).phone, '9222244444', 'W13 and the number is the one the director typed');
  // the audit trail has no number or address from any of these
  ok(!JSON.stringify(rows('RDAudit')).includes('9222233333') && !JSON.stringify(rows('RDAudit')).includes('9222244444'), 'W13 no number reached the audit trail');
}

done();
