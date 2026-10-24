// Scenario tests for the approvals template: the library, the letters, race details, generating the lines, dates that follow the race.
import * as D from './racedir.test.mjs';
import * as R from './rd-approvals.test.mjs';
import wd from 'wix-data';
const SA = { suppressAuth: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const err = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const istDay = (offset) => new Date(Date.now() + 5.5 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

/* ---------- the library on its own ---------- */
{
  const keys = R.PERMITS.map((p) => p.key).concat(R.SIGNOFFS.map((p) => p.key));
  ok(new Set(keys).size === keys.length, 'library keys are unique');
  ok(R.PERMITS.length === 16 && R.SIGNOFFS.length === 9, 'library has 16 permits and 9 sign-offs: ' + R.PERMITS.length + '/' + R.SIGNOFFS.length);
  ok(R.PERMITS.every((p) => p.title.length > 10 && p.cat && p.who && p.who.role && Number.isInteger(p.lead) && p.lead >= 7 && p.lead <= 120), 'every permit has a title, type, authority and a sensible lead time');
  ok(R.PERMITS.every((p) => p.docs.length >= 4 && p.docs.every((d) => d.length > 10)), 'every permit lists at least four documents to attach');
  ok(R.PERMITS.every((p) => p.tips.length >= 80 && p.tips.length <= 600), 'tips fit the notes field (80 to 600 characters)');
  ok(R.PERMITS.every((p) => p.subject && p.body.length >= 3), 'every permit has a letter subject and at least three paragraphs');
  ok(R.SIGNOFFS.every((p) => p.owner && p.notes.length >= 80 && p.notes.length <= 600 && Number.isInteger(p.offset)), 'every sign-off has an owner, checks and an offset');
  const sc = new Set(R.SCOPES.map((s) => s.key));
  ok(R.PERMITS.concat(R.SIGNOFFS).every((p) => !p.scope || sc.has(p.scope)), 'every item scope is a known question');
  ok(R.SCOPES.every((s) => R.PERMITS.concat(R.SIGNOFFS).some((p) => p.scope === s.key) || s.key === 'roads'), 'every question switches at least one item (roads changes the police letter)');
  ok(Object.values(R.LEGACY_TITLES).every((k) => R.itemByKey(k)), 'legacy titles all point to library items');
  const day = R.SIGNOFFS.filter((s) => s.key !== 'rd-kit');
  ok(day.every((s, i) => i === 0 || s.offset <= day[i - 1].offset), 'sign-offs run in time order');
  ok(R.SIGNOFFS.find((s) => s.key === 'rd-final').offset < 30, 'the final approval is the last, minutes before the flag-off');
  ok(R.PERMITS.find((p) => p.key === 'police').lead > R.PERMITS.find((p) => p.key === 'sound').lead, 'police needs more lead time than a loudspeaker permit');
}

/* ---------- dates, times, numbers ---------- */
{
  ok(R.editionLabel('5') === '5th' && R.editionLabel('1') === '1st' && R.editionLabel('2') === '2nd' && R.editionLabel('3') === '3rd' && R.editionLabel('11') === '11th' && R.editionLabel('12') === '12th' && R.editionLabel('13') === '13th' && R.editionLabel('21') === '21st' && R.editionLabel('22') === '22nd' && R.editionLabel('23') === '23rd' && R.editionLabel('101') === '101', 'edition: digits become ordinals');
  ok(R.editionLabel('Fifth') === 'Fifth' && R.editionLabel('5th') === '5th' && R.editionLabel('2026') === '2026' && R.editionLabel('') === '' && R.editionLabel(undefined) === '' && R.editionLabel(' 7 ') === '7th', 'edition: words, years and blanks are kept as typed');
  ok(R.addDays('2026-10-04', -45) === '2026-08-20' && R.addDays('2026-12-31', 1) === '2027-01-01' && R.addDays('2028-03-01', -1) === '2028-02-29' && R.addDays('2026-03-01', -1) === '2026-02-28', 'addDays crosses months, years and leap days');
  ok(R.addDays('', 1) === '' && R.addDays('2026-02-30', 1) === '' && R.addDays('junk', 1) === '', 'addDays refuses bad dates');
  ok(R.longDate('2026-10-04') === '4 October 2026' && R.weekdayOf('2026-10-04') === 'Sunday' && R.weekdayOf('2026-12-13') === 'Sunday' && R.weekdayOf('2027-01-01') === 'Friday' && R.longDate('x') === '', 'long date and weekday');
  ok(R.clock12('05:30') === '5:30 am' && R.clock12('00:05') === '12:05 am' && R.clock12('12:00') === '12:00 pm' && R.clock12('17:45') === '5:45 pm' && R.clock12('25:00') === '', 'clock in 12-hour form');
  ok(R.minusMinutes('05:30', 120) === '03:30' && R.minusMinutes('05:30', 10) === '05:20' && R.minusMinutes('01:00', 120) === '00:00' && R.minusMinutes('', 5) === '', 'minutes before the start, never before midnight');
  ok(R.indian(999) === '999' && R.indian(3000) === '3,000' && R.indian(15000) === '15,000' && R.indian(100000) === '1,00,000' && R.indian(1234567) === '12,34,567' && R.indian('x') === '', 'Indian digit grouping');
  const sc = R.cleanScope({ trail: true, roads: 'false', music: 'on', bogus: true });
  ok(sc.trail === true && sc.roads === false && sc.music === true && sc.bogus === undefined && sc.expo === true, 'scope answers are cleaned and unknown keys dropped');
}

/* ---------- the letters on their own ---------- */
{
  const ev = { name: 'Vizag Half Marathon', date: '2026-12-13', venue: 'GITAM University', cats: [{ name: '21.1K', km: 21.0975 }, { name: '10K', km: 10 }, { name: '5K', km: 5 }], distanceKm: 21.0975 };
  const full = { edition: '6', place: 'Visakhapatnam', localBody: 'Greater Visakhapatnam Municipal Corporation (GVMC)', organiser: 'Visakha Trail Running Association (VTRA)', regNo: 'Reg. No. 429 of 2021', signatory: 'A. Director', role: 'Race Director', phone: '98480 00000', email: 'race@example.org', address: 'Visakhapatnam, Andhra Pradesh', participants: '3000', volunteers: '300', startTime: '05:30', endTime: '09:30', route: 'GITAM gate to Beach Road and back', expoDate: '2026-12-11', expoVenue: 'GITAM', scope: R.defaultScope() };
  const row = (k, info) => ({ title: R.permitByKey(k).title, tpl: k, party: R.authorityName(R.permitByKey(k), ev, info || full) });
  const L = (k, info, sc) => R.renderLetter(row(k, info), ev, info || full, { today: '2026-10-24', scope: sc || { roads: true } });
  // every permit renders with full details: nothing left in {braces}, nothing missing
  for (const p of R.PERMITS) {
    const r = L(p.key);
    ok(!/[{}]/.test(r.text) && !/undefined|null|NaN/.test(r.text), 'letter ' + p.key + ': no leftover braces or undefined');
    ok(r.missing.length === 0, 'letter ' + p.key + ': nothing missing with full details (' + r.missing.join(', ') + ')');
    ok(r.text.includes('Sub: ') && r.text.includes('Respected Sir/Madam,') && r.text.includes('Yours faithfully,') && r.text.includes('A. Director') && r.text.includes('Date: 24 October 2026'), 'letter ' + p.key + ': has subject, salutation, closing, signatory and date');
    ok(r.text.includes('Enclosures:') && r.docs.length === p.docs.length && r.text.includes('1. ' + p.docs[0]), 'letter ' + p.key + ': enclosures list the documents');
    ok(r.subject.includes('Vizag Half Marathon'), 'letter ' + p.key + ': subject names the race');
  }
  const pol = L('police');
  ok(pol.text.includes('the 6th edition of Vizag Half Marathon') && pol.text.includes('Sunday, 13 December 2026') && pol.text.includes('GITAM University, Visakhapatnam') && pol.text.includes('21.1 km, 10 km and 5 km') && pol.text.includes('About 3,000 runners') && pol.text.includes('about 300 volunteers') && pol.text.includes('5:30 am') && pol.text.includes('9:30 am') && pol.text.includes('GITAM gate to Beach Road and back'), 'police letter: edition, date, venue, distances, numbers, times and route');
  ok(pol.to === 'The Commissioner of Police, Visakhapatnam', 'police letter is addressed to the authority on the line: ' + pol.to);
  ok(pol.text.startsWith('Visakha Trail Running Association (VTRA)\nReg. No. 429 of 2021\nVisakhapatnam, Andhra Pradesh\nPhone: 98480 00000 | Email: race@example.org'), 'letterhead: organiser, registration, address and contact');
  ok(pol.text.includes('As the run uses public roads') && !pol.text.includes('largely away from public roads'), 'police letter: road closure paragraph when roads are used');
  const off = L('police', null, { roads: false });
  ok(off.text.includes('largely away from public roads') && !off.text.includes('As the run uses public roads'), 'police letter: different paragraph for an off-road route');
  // no edition, no details
  const bare = R.renderLetter({ title: 'x', tpl: 'police', party: 'Commissioner of Police' }, { name: 'Trail Run', date: '', venue: '' }, {}, { today: '2026-10-24', scope: {} });
  ok(bare.text.includes('Trail Run') && !bare.text.includes('edition of') && bare.text.includes('[race date]') && bare.text.includes('[venue]') && bare.text.includes('[organiser name]'), 'no details: blanks in brackets and no "edition" wording');
  ok(['organiser name', 'race date', 'venue', 'expected number of runners', 'distances', 'start time', 'finish time', 'phone number', 'signatory name', 'signatory role'].every((m) => bare.missing.includes(m)), 'no details: the missing list names each one: ' + bare.missing.join(', '));
  ok(new Set(bare.missing).size === bare.missing.length, 'missing list has no repeats');
  ok(!bare.text.includes('The Commissioner of Police\nVisakhapatnam'), 'no place: no place line is invented');
  // an edition typed as a word, a year, and the same text with edition 1
  ok(R.renderLetter(row('civic'), { ...ev }, { ...full, edition: 'Fifth' }, { today: '2026-10-24' }).text.includes('the Fifth edition of Vizag Half Marathon'), 'edition typed as a word is used as typed');
  // early start paragraph
  ok(L('sound').text.includes('before 6:00 am') && !L('sound', { ...full, startTime: '07:00' }).text.includes('before 6:00 am') && !L('sound', { ...full, startTime: '' }).text.includes('before 6:00 am'), 'loudspeaker letter: early-start paragraph only for a start before 6 am');
  // addressee follows the line, not the library
  const edited = R.renderLetter({ title: 'Police', tpl: 'police', party: 'Deputy Commissioner of Police (Traffic), Visakhapatnam City' }, ev, full, { today: '2026-10-24' });
  ok(edited.text.includes('To\nThe Deputy Commissioner of Police (Traffic), Visakhapatnam City\n\nSub:'), 'an edited authority is used as the addressee');
  const the = R.renderLetter({ title: 'Police', tpl: 'police', party: 'The Superintendent of Police' }, ev, { ...full, place: '' }, { today: '2026-10-24' });
  ok(the.text.includes('To\nThe Superintendent of Police\n') && !the.text.includes('The The'), 'no double "The"');
  const hosp = R.renderLetter(row('medical'), ev, full, { today: '2026-10-24' });
  ok(hosp.text.includes('To\nThe Medical Superintendent\n[Hospital or ambulance provider]') , 'generic hospital line asks for the hospital name');
  const hosp2 = R.renderLetter({ title: 'Ambulance', tpl: 'medical', party: 'KIMS ICON Hospital' }, ev, full, { today: '2026-10-24' });
  ok(hosp2.text.includes('To\nThe Medical Superintendent\nKIMS ICON Hospital\n'), 'a named hospital is used');
  const gen = R.renderLetter({ title: 'Beach permission (GVMC)', tpl: '', party: 'GVMC Zonal Commissioner' }, ev, full, { today: '2026-10-24' });
  ok(gen.text.includes('The GVMC Zonal Commissioner') && gen.text.includes('Request for permission: Beach permission for the 6th edition of Vizag Half Marathon on Sunday, 13 December 2026') && !gen.text.includes('Enclosures:') && !/[{}]/.test(gen.text), 'a line without a template gets a general letter');
  // organiser details show once only in letterhead and signature
  ok((pol.text.match(/race@example\.org/g) || []).length === 2, 'contact appears in the letterhead and the signature');
  // registration without "Reg." prefix
  ok(R.renderLetter(row('civic'), ev, { ...full, regNo: '429 of 2021' }, { today: '2026-10-24' }).text.split('\n')[1] === 'registration no. 429 of 2021', 'a bare registration number gets a label');
  ok(R.renderLetter(row('civic'), ev, { ...full, volunteers: '' }, { today: '2026-10-24' }).text.includes('supported by our volunteers'), 'no volunteer number: "our volunteers"');
  ok(L('venue').text.includes('The expo and bib collection will be held on 11 December 2026.') && !L('venue', { ...full, expoDate: '' }).text.includes('expo and bib collection will be held'), 'expo date paragraph only when there is an expo date');
  // authority names
  const A = (k, info) => R.authorityName(R.permitByKey(k), ev, info);
  ok(A('police', full) === 'Commissioner of Police, Visakhapatnam' && A('police', {}) === 'Commissioner of Police' && A('civic', full) === 'Commissioner, Greater Visakhapatnam Municipal Corporation (GVMC)' && A('civic', {}) === 'Commissioner, Municipal Corporation or local body' && A('venue', full) === 'Owner or manager, GITAM University', 'authority names use the place, the local body and the venue');
}

/* ---------- through the backend ---------- */
for (const [u, r] of [['boss', 'admin'], ['lead1', 'lead'], ['view1', 'viewer']])
  await wd.insert('ExpoStaff', { username: u, password: 'pw', role: r, desks: '', name: u.toUpperCase(), failCount: '0', lockUntil: '' }, SA);
const L1 = async (u) => (await D.login({ username: u, password: 'pw' })).token;
const B = await L1('boss'), LD = await L1('lead1'), V = await L1('view1');
const list = async (t, e) => (await D.listPlan({ token: t, ev: e, kinds: ['approval'] })).items.approval;
const planRowsOf = async (e) => (await wd.query('RDPlan').eq('event', e).limit(1000).find(SA)).items.filter((r) => r.kind === 'approval');

const RACE = istDay(100);
const e1 = (await D.saveEvent({ token: B, name: 'Vizag Half Marathon', date: RACE, venue: 'GITAM University' })).event;
const E = e1.id;

// ---- a new race gets the template, dated from the race date
{
  const a = await list(B, E);
  const permits = a.filter((x) => x.phase === 'permit'), day = a.filter((x) => x.phase === 'raceday');
  ok(permits.length === 10 && day.length === 8, 'new race: 10 permits and 8 sign-offs: ' + permits.length + '/' + day.length);
  ok(a.every((x) => x.tpl && x.status === 'todo' && x.notes.length > 50 && x.notes.length <= 600), 'every line comes from the template with its checks in the notes');
  const pol = permits.find((x) => x.tpl === 'police');
  ok(pol.due === R.addDays(RACE, -45) && pol.lead === 45 && pol.party === 'Commissioner of Police' && pol.cat === 'Police' && pol.docsTotal === 8 && pol.docsDone.length === 0, 'police line: due is 45 days before the race, authority and checklist');
  ok(permits.every((x) => x.due === R.addDays(RACE, -x.lead)), 'every permit is due its lead time before the race');
  ok(day.every((x) => x.due === RACE && x.time === '' && x.owner), 'sign-offs are on the race day with an owner; no time until a start time is set');
  ok(!a.some((x) => x.tpl === 'forest' || x.tpl === 'drone' || x.tpl === 'music' || x.tpl === 'aims' || x.tpl === 'rd-kit'), 'trail, drone, music and AIMS items are off by default');
  ok(a.every((x) => x.overdue === false), 'a race 100 days out has nothing overdue');
  ok(permits.length && (await D.listPlan({ token: V, ev: E, kinds: ['approval'] })).items.approval.length === 18, 'viewer can read the lines');
}
// ---- a race with no date gets the lines without dates
{
  const e0 = (await D.saveEvent({ token: B, name: 'Undated Run' })).event;
  const a = await list(B, e0.id);
  ok(a.length === 18 && a.every((x) => x.due === ''), 'no race date: lines have no due date');
  await D.saveEvent({ token: B, id: e0.id, date: istDay(60) });
  const b = await list(B, e0.id);
  ok(b.every((x) => x.due !== ''), 'adding the date fills the blank due dates');
}

// ---- race details
{
  ok((await err(D.eventInfo({ token: V, ev: E }))) === 'read_only', 'viewer cannot read the race details (they hold phone numbers)');
  const i0 = await D.eventInfo({ token: LD, ev: E });
  ok(i0.info.organiser === '' && i0.info.edition === '' && i0.info.participants === '' && i0.info.scope.roads === true && i0.info.scope.trail === false && i0.scopes.length === 11, 'details start empty, with the default answers');
  ok((await err(D.saveEventInfo({ token: LD, ev: E, info: { edition: '6' } }))) === 'director_only', 'a lead cannot change the race details');
  ok((await err(D.saveEventInfo({ token: V, ev: E, info: { edition: '6' } }))) === 'director_only', 'a viewer cannot change the race details');
  for (const [info, code] of [[{ phone: 'call me' }, 'bad_phone'], [{ email: 'nope' }, 'bad_email'], [{ startTime: '25:00' }, 'bad_time'], [{ endTime: 'noon' }, 'bad_time'], [{ expoDate: '2026-02-30' }, 'bad_date'], [{ participants: '-5' }, 'bad_number'], [{ participants: '12.5' }, 'bad_number'], [{ volunteers: 'many' }, 'bad_number'], [{ scope: 'all' }, 'bad_scope']])
    ok((await err(D.saveEventInfo({ token: B, ev: E, info }))) === code, 'race details: ' + JSON.stringify(info) + ' is refused as ' + code);
  ok((await err(D.saveEventInfo({ token: B, ev: E, name: 'x' }))) === 'name_needed' && (await err(D.saveEventInfo({ token: B, ev: E, date: '13/12/2026' }))) === 'bad_date' && (await err(D.saveEventInfo({ token: B, ev: E, info: [] }))) === 'bad_info', 'name, date and shape are checked');
  ok((await D.eventInfo({ token: LD, ev: E })).info.phone === '', 'a refused save changes nothing');
  const r = await D.saveEventInfo({ token: B, ev: E, venue: 'GITAM University, Rushikonda', info: { edition: '6', place: 'Visakhapatnam', localBody: 'GVMC', organiser: 'VTRA', regNo: 'Reg. No. 429 of 2021', signatory: 'A. Director', role: 'Race Director', phone: '98480 00000', email: 'race@example.org', address: 'Visakhapatnam', participants: '3,000', volunteers: 300, route: 'Gate to Beach Road and back', expoVenue: 'GITAM' } });
  ok(r.event.edition === '6' && r.event.editionText === '6th' && r.event.venue === 'GITAM University, Rushikonda' && r.event.name === 'Vizag Half Marathon' && r.info.participants === '3000' && r.info.volunteers === '300' && r.info.startTime === '', 'saved: edition, venue and numbers; the rest kept');
  ok((await D.listEvents({ token: V })).events.find((x) => x.id === E).editionText === '6th', 'the edition shows in the race list for everyone');
  ok(!('phone' in (await D.listEvents({ token: V })).events[0]) && !JSON.stringify(await D.listEvents({ token: V })).includes('98480'), 'phone numbers are not in the race list');
  // partial update keeps the rest
  await D.saveEventInfo({ token: B, ev: E, info: { endTime: '09:30' } });
  const i1 = (await D.eventInfo({ token: B, ev: E })).info;
  ok(i1.organiser === 'VTRA' && i1.endTime === '09:30' && i1.edition === '6' && i1.expoDate === '', 'a partial save keeps the other details');
  await D.saveEventInfo({ token: B, ev: E, info: { participants: '', phone: '' } });
  const i2 = (await D.eventInfo({ token: B, ev: E })).info;
  ok(i2.participants === '' && i2.phone === '' && i2.signatory === 'A. Director', 'a detail can be cleared');
  await D.saveEventInfo({ token: B, ev: E, info: { participants: '3000', phone: '98480 00000' } });
}

// ---- dates follow the race
{
  const before = await list(B, E);
  const police = before.find((x) => x.tpl === 'police'), fire = before.find((x) => x.tpl === 'fire'), civic = before.find((x) => x.tpl === 'civic'), venue = before.find((x) => x.tpl === 'venue');
  // hand-edit one date, approve one, mark one applied
  await D.savePlanItem({ token: B, ev: E, kind: 'approval', id: police.id, due: R.addDays(RACE, -90) });
  await D.setPlanStatus({ token: B, ev: E, id: fire.id, status: 'approved' });
  await D.setPlanStatus({ token: B, ev: E, id: civic.id, status: 'applied' });
  await D.savePlanItem({ token: B, ev: E, kind: 'approval', id: venue.id, notes: 'Spoke to the registrar' });
  const NEW = R.addDays(RACE, 14);
  const r = await D.saveEventInfo({ token: B, ev: E, date: NEW, info: { startTime: '05:30' } });
  const after = await list(B, E);
  const g = (k) => after.find((x) => x.tpl === k);
  ok(r.moved > 0, 'saving a new date reports how many lines moved: ' + r.moved);
  ok(g('police').due === R.addDays(RACE, -90), 'a due date edited by hand stays');
  ok(g('fire').due === R.addDays(RACE, -30) && g('fire').status === 'approved', 'an approved line does not move');
  ok(g('civic').due === R.addDays(NEW, -30) && g('civic').status === 'applied', 'an applied line moves with the race');
  ok(g('venue').due === R.addDays(NEW, -45) && g('venue').notes === 'Spoke to the registrar', 'editing the notes does not stop the date following the race');
  ok(g('insurance').due === R.addDays(NEW, -21) && g('sound').due === R.addDays(NEW, -15), 'untouched permits moved by the same 14 days');
  const day = after.filter((x) => x.phase === 'raceday');
  ok(day.every((x) => x.due === NEW), 'race-day sign-offs moved to the new date');
  ok(g('rd-weather').time === '03:30' && g('rd-final').time === '05:20' && g('rd-course').time === '04:00' && g('rd-volunteers').time === '05:00', 'a start time of 05:30 gives sign-off times: weather 03:30, course 04:00, volunteers 05:00, final 05:20');
  // moving the start time moves the times
  const r2 = await D.saveEventInfo({ token: B, ev: E, info: { startTime: '06:00' } });
  const a2 = await list(B, E);
  ok(r2.moved === 8 && a2.find((x) => x.tpl === 'rd-weather').time === '04:00' && a2.find((x) => x.tpl === 'rd-final').time === '05:50', 'a new start time moves the sign-off times');
  // a time edited by hand stays
  const course = a2.find((x) => x.tpl === 'rd-course');
  await D.savePlanItem({ token: B, ev: E, kind: 'approval', id: course.id, time: '04:15' });
  await D.saveEventInfo({ token: B, ev: E, info: { startTime: '05:30' } });
  const a3 = await list(B, E);
  ok(a3.find((x) => x.tpl === 'rd-course').time === '04:15' && a3.find((x) => x.tpl === 'rd-weather').time === '03:30', 'a time edited by hand stays when the start time changes');
  // the Setup form saves the date too
  const r3 = await D.saveEvent({ token: B, id: E, date: RACE });
  const a4 = await list(B, E);
  ok(r3.moved > 0 && a4.find((x) => x.tpl === 'insurance').due === R.addDays(RACE, -21) && a4.find((x) => x.tpl === 'police').due === R.addDays(RACE, -90) && a4.find((x) => x.tpl === 'rd-final').due === RACE, 'the Setup form moves the lines too');
  ok((await D.saveEvent({ token: B, id: E, venue: 'GITAM University, Rushikonda' })).moved === 0, 'a change that is not the date moves nothing');
  // edition from the Setup form keeps the other details
  await D.saveEvent({ token: B, id: E, edition: '7' });
  const ii = (await D.eventInfo({ token: B, ev: E })).info;
  ok(ii.edition === '7' && ii.organiser === 'VTRA' && ii.startTime === '05:30', 'the edition from the Setup form keeps the other details');
  await D.saveEvent({ token: B, id: E, edition: '6' });
  // a line that was not on a date and had a date typed in by hand keeps it when the race moves
  const noDate = (await D.saveEvent({ token: B, name: 'Hand Run', date: istDay(80) })).event;
  const hl = (await list(B, noDate.id)).find((x) => x.tpl === 'banner');
  await D.savePlanItem({ token: B, ev: noDate.id, kind: 'approval', id: hl.id, due: '' });
  await D.saveEvent({ token: B, id: noDate.id, date: istDay(90) });
  ok((await list(B, noDate.id)).find((x) => x.tpl === 'banner').due === '', 'a due date cleared by hand stays blank');
}

// ---- the template panel
{
  ok((await err(D.approvalTemplate({ token: V, ev: E }))) === 'read_only', 'viewer cannot open the template');
  const t = await D.approvalTemplate({ token: LD, ev: E });
  ok(t.permits.length === 16 && t.signoffs.length === 9 && t.scopes.length === 11, 'the template lists 16 permits, 9 sign-offs and 11 questions');
  ok(t.started === true && t.starter === 0 && t.permits.filter((x) => x.added).length === 10 && t.signoffs.filter((x) => x.added).length === 8, 'seeded lines show as added');
  const f = t.permits.find((x) => x.key === 'forest');
  ok(f.on === false && f.added === false && f.lead === 90 && f.due === R.addDays(RACE, -90) && f.party === 'District Forest Officer, Visakhapatnam' && f.docs === 7, 'forest suggestion: off, lead 90, authority from the place');
  ok(t.permits.find((x) => x.key === 'civic').party === 'Commissioner, GVMC' && t.permits.find((x) => x.key === 'venue').party === 'Owner or manager, GITAM University, Rushikonda', 'authorities use the local body and the venue');
  ok(t.signoffs.find((x) => x.key === 'rd-weather').time === '03:30', 'sign-off times use the start time');
  ok((await err(D.applyApprovalTemplate({ token: LD, ev: E }))) === 'director_only' && (await err(D.applyApprovalTemplate({ token: V, ev: E }))) === 'director_only', 'only a director can add lines from the template');
}

// ---- adding lines: trail race with picks
{
  const before = await list(B, E);
  const r = await D.applyApprovalTemplate({ token: B, ev: E, scope: { trail: true, drone: true, roads: true }, picks: { forest: { party: 'Divisional Forest Officer, Paderu', lead: 100, due: R.addDays(RACE, -100) }, village: { on: false }, drone: { due: '' } } });
  ok(r.added === 3 && r.kept === 10 + 8 && r.replaced === 0 && r.removed === 0, 'trail answers add forest, drone and the kit check; village was switched off: ' + JSON.stringify(r));
  const a = await list(B, E);
  const g = (k) => a.find((x) => x.tpl === k);
  ok(a.length === before.length + 3 && g('forest') && g('drone') && g('rd-kit') && !g('village'), 'the chosen lines are added and the switched-off one is not');
  ok(g('forest').party === 'Divisional Forest Officer, Paderu' && g('forest').due === R.addDays(RACE, -100) && g('forest').lead === 100, 'a changed authority, lead time and date are kept');
  ok(g('drone').due === '' && g('drone').lead === 21, 'a cleared date stays blank');
  ok(g('rd-kit').phase === 'raceday' && g('rd-kit').time === '04:50' && g('rd-kit').due === RACE, 'the kit check is a race-day line, 40 minutes before a 05:30 start');
  ok((await D.eventInfo({ token: B, ev: E })).info.scope.trail === true, 'the answers are remembered');
  const again = await D.applyApprovalTemplate({ token: B, ev: E, picks: { village: { on: true } } });
  ok(again.added === 1 && again.kept === 3 + 10 + 8 - 0 && (await list(B, E)).find((x) => x.tpl === 'village').party === 'Sarpanch of each village on the route', 'a second run adds only what is missing');
  const third = await D.applyApprovalTemplate({ token: B, ev: E });
  ok(third.added === 0 && third.replaced === 0 && third.removed === 0 && third.kept === 22, 'a third run changes nothing: ' + JSON.stringify(third));
  for (const [arg, code] of [[{ picks: { nope: {} } }, 'bad_item'], [{ picks: { police: { due: '2026-13-01' } } }, 'bad_date'], [{ picks: { police: { lead: -1 } } }, 'bad_lead'], [{ picks: { police: { lead: 1.5 } } }, 'bad_lead'], [{ picks: { 'rd-weather': { offset: 9999 } } }, 'bad_offset'], [{ picks: { police: { time: '9am' } } }, 'bad_time'], [{ picks: 'all' }, 'bad_picks'], [{ picks: { police: 5 } }, 'bad_picks'], [{ scope: 'trail' }, 'bad_scope']])
    ok((await err(D.applyApprovalTemplate(Object.assign({ token: B, ev: E }, arg)))) === code, 'template: ' + JSON.stringify(arg) + ' is refused as ' + code);
  ok((await list(B, E)).length === 22, 'refused requests add nothing');
  // forest follows the race (lead 100 was stored)
  await D.saveEventInfo({ token: B, ev: E, date: R.addDays(RACE, 7) });
  ok((await list(B, E)).find((x) => x.tpl === 'forest').due === R.addDays(RACE, 7 - 100) && (await list(B, E)).find((x) => x.tpl === 'drone').due === '', 'the stored lead time is used when the race moves; a blank date stays blank');
  await D.saveEventInfo({ token: B, ev: E, date: RACE });
}

// ---- a race made by an earlier version: starter lines are replaced, edited ones are kept and linked
{
  const old = (await D.saveEvent({ token: B, name: 'Old Race', date: istDay(75), venue: 'Old Ground' })).event;
  let rowsOf = await planRowsOf(old.id);
  await wd.bulkRemove('RDPlan', rowsOf.map((r) => r._id), SA);
  const legacy = [['Police permission for road use and traffic diversion', 'Police and traffic'], ['Municipal corporation permission for the route and venue', 'Municipal corporation'], ['Forest department permission (trail routes)', 'Forest department'], ['Fire safety clearance for the expo, stage and tents', 'Fire services'], ['Ambulance and hospital tie-up letter', 'Hospital'], ['Event insurance policy', 'Insurer'], ['Loudspeaker and sound permission', 'Police'], ['Drone permission (if drones are used)', 'Police or aviation'], ['Land or beach owner permission', 'Owner'], ['Food safety registration for aid-station food', 'Food safety'], ['Electricity and generator permission', 'Power utility'], ['Banner and hoarding permission', 'Municipal corporation']];
  const sign = [['Weather go or no-go', 'Race Director'], ['Course cleared and marked', 'Route lead'], ['Medical team in position', 'Medical lead'], ['Police and traffic in position', 'Operations'], ['Start, timing and finish ready', 'Timing lead'], ['Aid stations stocked and staffed', 'Aid-station lead'], ['Volunteers and pacers briefed', 'Volunteer lead'], ['Final flag-off approval', 'Race Director']];
  const base = (o) => Object.assign({ event: old.id, kind: 'approval', cat: '', status: 'todo', owner: '', party: '', contact: '', due: '', time: '', amount: '', amount2: '', ref: '', link: '', notes: '', order: '000', by: '', at: '' }, o);
  await wd.bulkInsert('RDPlan', legacy.map(([title, party]) => base({ title, party, phase: 'permit', cat: 'Permit' })).concat(sign.map(([title, owner]) => base({ title, owner, phase: 'raceday', cat: 'Sign-off' })), [base({ title: 'Our own permit', phase: 'permit', party: 'Somebody' })]), SA);
  // somebody worked on the police line, and signed off the weather call
  const rows0 = await planRowsOf(old.id);
  const pol = rows0.find((r) => r.title.startsWith('Police permission'));
  await D.savePlanItem({ token: B, ev: old.id, kind: 'approval', id: pol._id, ref: 'PS/123/2026', notes: 'Applied at the commissionerate' });
  const wx = rows0.find((r) => r.title === 'Weather go or no-go');
  await D.setPlanStatus({ token: LD, ev: old.id, id: wx._id, status: 'approved' });
  const t = await D.approvalTemplate({ token: B, ev: old.id });
  ok(t.started === false && t.starter === 18, 'panel sees 18 starter lines nobody touched (20 less the 2 that were worked on): ' + t.starter);
  const r = await D.applyApprovalTemplate({ token: B, ev: old.id, picks: { drone: { on: false } } });
  ok(r.replaced === 16 && r.added === 0 + r.added, 'starter lines are replaced by the template: ' + JSON.stringify(r));
  const a = await list(B, old.id);
  const titles = a.map((x) => x.title);
  ok(!titles.includes('Forest department permission (trail routes)') && !titles.includes('Drone permission (if drones are used)') && !titles.includes('Land or beach owner permission'), 'unused starter lines are gone (forest and drone are off; land became the venue line)');
  ok(a.find((x) => x.tpl === 'police').ref === 'PS/123/2026' && a.find((x) => x.tpl === 'police').notes === 'Applied at the commissionerate' && a.find((x) => x.tpl === 'police').title.startsWith('Police permission'), 'the police line that was worked on keeps its text and is linked to the template');
  ok(a.find((x) => x.tpl === 'police').due === R.addDays(istDay(75), -45) && a.find((x) => x.tpl === 'police').lead === 45, 'the linked line gets its due date and lead time');
  ok(a.find((x) => x.tpl === 'rd-weather').status === 'approved' && a.find((x) => x.tpl === 'rd-weather').by === 'LEAD1', 'a signed-off line keeps its status and who signed');
  ok(a.some((x) => x.title === 'Our own permit' && !x.tpl), 'a line you added yourself is never touched');
  ok(a.filter((x) => x.tpl === 'police').length === 1 && a.filter((x) => x.tpl === 'rd-weather').length === 1, 'no duplicates');
  ok(r.linked === 2 && r.removed === 2, 'two edited starter lines linked, the two unused starter lines removed: ' + JSON.stringify(r));
  ok(a.find((x) => x.tpl === 'venue').title === 'Venue, ground or park owner permission' && a.find((x) => x.tpl === 'venue').party === 'Owner or manager, Old Ground', 'the old land line became the venue line');
}

// ---- letters and documents
{
  const a = await list(B, E);
  const pol = a.find((x) => x.tpl === 'police'), wx = a.find((x) => x.tpl === 'rd-weather');
  ok((await err(D.approvalLetter({ token: V, ev: E, id: pol.id }))) === 'read_only', 'viewer cannot get a letter');
  ok((await err(D.approvalLetter({ token: LD, ev: E, id: wx.id }))) === 'no_letter', 'a race-day sign-off has no letter');
  ok((await err(D.approvalLetter({ token: LD, ev: E, id: 'nope' }))) === 'no_item', 'unknown line');
  ok((await err(D.approvalLetter({ token: LD, ev: (await D.saveEvent({ token: B, name: 'Other' })).event.id, id: pol.id }))) === 'no_item', 'a line of another race is refused');
  ok((await err(D.approvalLetter({ token: LD, ev: E, id: pol.id, date: '24/10/2026' }))) === 'bad_date', 'bad letter date');
  const L = await D.approvalLetter({ token: LD, ev: E, id: pol.id, date: '2026-10-24' });
  ok(L.text.includes('the 6th edition of Vizag Half Marathon') && L.text.includes('GITAM University, Rushikonda') && L.text.includes('Date: 24 October 2026') && L.text.includes('A. Director') && L.text.includes('VTRA') , 'letter is filled from the race details');
  ok(L.docs.length === 8 && L.docs.every((d) => d.done === false) && L.subject.startsWith('Request for permission to conduct') && L.tips.length > 50 && L.to === 'The Commissioner of Police, Visakhapatnam', 'letter comes with the documents list, tips and the addressee: ' + L.to);
  ok(L.missing.length === 0, 'nothing is missing once the details are filled in: ' + L.missing.join(', '));
  const today = await D.approvalLetter({ token: LD, ev: E, id: pol.id });
  const t0 = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  ok(today.day === t0 && today.text.includes('Date: ' + R.longDate(t0)), 'the letter is dated today by default');
  // an edited authority shows in the letter
  await D.savePlanItem({ token: B, ev: E, kind: 'approval', id: pol.id, party: 'Deputy Commissioner of Police (Traffic), Visakhapatnam' });
  ok((await D.approvalLetter({ token: LD, ev: E, id: pol.id })).to === 'The Deputy Commissioner of Police (Traffic), Visakhapatnam', 'an edited authority is used in the letter');
  // documents
  ok((await err(D.setApprovalDoc({ token: V, ev: E, id: pol.id, index: 0, done: true }))) === 'read_only', 'viewer cannot tick documents');
  ok((await err(D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: 8, done: true }))) === 'bad_index' && (await err(D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: -1, done: true }))) === 'bad_index' && (await err(D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: 'a', done: true }))) === 'bad_index', 'document index is checked');
  ok((await err(D.setApprovalDoc({ token: LD, ev: E, id: wx.id, index: 0, done: true }))) === 'no_docs', 'a sign-off has no documents');
  const own = (await D.savePlanItem({ token: B, ev: E, kind: 'approval', title: 'My own permit', phase: 'permit' })).item;
  ok((await err(D.setApprovalDoc({ token: LD, ev: E, id: own.id, index: 0, done: true }))) === 'no_docs', 'a line without a template has no documents');
  const by0 = (await list(B, E)).find((x) => x.id === pol.id).by;
  let r = await D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: 2, done: true });
  r = await D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: 0, done: true });
  r = await D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: 2, done: true });
  ok(r.done.join() === '0,2' && r.total === 8, 'ticks are stored once, in order');
  const l2 = (await list(B, E)).find((x) => x.id === pol.id);
  ok(l2.docsDone.join() === '0,2' && l2.docsTotal === 8 && l2.by === by0, 'the list shows the ticks; ticking does not change who signed off');
  ok((await D.approvalLetter({ token: LD, ev: E, id: pol.id })).docs.map((d) => d.done).join() === 'true,false,true,false,false,false,false,false', 'the letter shows which documents are ready');
  r = await D.setApprovalDoc({ token: LD, ev: E, id: pol.id, index: 0, done: false });
  ok(r.done.join() === '2', 'a document can be unticked');
  // editing the line keeps the template link and the ticks
  await D.savePlanItem({ token: B, ev: E, kind: 'approval', id: pol.id, title: 'Police permission (road use and diversion)', notes: 'Meeting on Monday' });
  const l3 = (await list(B, E)).find((x) => x.id === pol.id);
  ok(l3.tpl === 'police' && l3.docsDone.join() === '2' && l3.lead === 45 && l3.title === 'Police permission (road use and diversion)', 'editing a line keeps its link to the template, its ticks and its lead time');
  ok((await D.approvalLetter({ token: LD, ev: E, id: pol.id })).subject.startsWith('Request for permission to conduct'), 'the letter still follows the template after the title is edited');
  // a letter for a line with no template
  const g = await D.approvalLetter({ token: LD, ev: E, id: own.id, date: '2026-10-24' });
  ok(g.text.includes('Request for permission: My own permit') && g.docs.length === 0 && g.missing.includes('authority') && g.to === 'The [authority]', 'a line without a template or an authority gets a general letter with a blank to fill: ' + g.to);
}

// ---- organiser details are typed once
{
  const n = (await D.saveEvent({ token: B, name: 'Next Race', date: istDay(200), edition: '2' })).event;
  const i = (await D.eventInfo({ token: B, ev: n.id })).info;
  ok(i.organiser === 'VTRA' && i.signatory === 'A. Director' && i.phone === '98480 00000' && i.place === 'Visakhapatnam' && i.regNo === 'Reg. No. 429 of 2021', 'a new race starts with the organiser details of the last one');
  ok(i.edition === '2' && i.participants === '' && i.startTime === '' && i.route === '' && i.scope.trail === false, 'race-specific details do not carry over');
  const a = await list(B, n.id);
  ok(a.find((x) => x.tpl === 'police').party === 'Commissioner of Police, Visakhapatnam' && a.find((x) => x.tpl === 'civic').party === 'Commissioner, GVMC', 'the new race\'s lines already name the authorities of the place');
}

// ---- the summary figures still count the lines
{
  const s = (await D.listPlan({ token: B, ev: E, kinds: ['approval'] })).summary.approvals;
  const a = await list(B, E);
  ok(s.permits.total === a.filter((x) => x.phase === 'permit').length && s.raceday.total === a.filter((x) => x.phase === 'raceday').length, 'summary counts permits and sign-offs');
}

console.log('Approvals: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
