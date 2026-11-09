// UNIT TESTS (Waiver rules): the text of a waiver, the setup (which question of the form is the waiver), what counts as signed, the
// versions, the records of papers, who stands where, and the papers to print. The library has no database and no Wix in it, so every
// rule is tested on its own. Also the new "waiver" choice of a message audience.
import * as W from './rd-waiver.test.mjs';
import * as M from './rd-comms.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: Waiver rules');

const HOSTILE = [undefined, null, true, false, 0, -1, 1.5, NaN, Infinity, '', ' ', 'x'.repeat(5000), '\u0000', '\u202e', {}, [], [[]], { toString() { throw new Error('boom'); } }, () => 1];
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
const noNative = (fn) => HOSTILE.every((h) => { try { fn(h); return true; } catch (e) { return /^wv_|^bad_/.test(e.message); } });
const RACE = { name: 'Vizag Half Marathon', date: '2027-02-07', venue: 'Beach Road' };
const EV = 'ev1';
const row = (kind, ref, o) => Object.assign({ _id: kind + '~' + ref, event: EV, kind, ref, sub: '', who: '', status: '', why: '', json: '', by: 'boss', at: '2027-01-01T10:00:00.000Z' }, o || {});
const verRow = (n, title, text) => row('ver', String(n), { _id: W.ids.ver(EV, n), json: JSON.stringify({ title: title || 'Waiver ' + n, text: text || 'I agree to run at my own risk, number ' + n }) });
const sigRow = (sub, ref, n, ver, o) => row('sig', ref, Object.assign({ _id: W.ids.sig(EV, sub, ref, n), sub, who: 'paper', json: JSON.stringify({ ver }) }, o || {}));
const voidRow = (sigId, why) => row('vd', sigId, { _id: W.ids.vd(sigId), why: why || 'wrong person' });
const setRow = (o) => row('set', '', { _id: W.ids.set(EV), json: JSON.stringify(o) });
const reg = (id, name, answer, o) => Object.assign({ _id: id, name, cat: '10 K', bib: id.replace(/\D/g, ''), status: 'ok', at: '2027-01-05T08:00:00.000Z', form: JSON.stringify([{ name: 'Gender', value: 'F' }, { name: 'I agree to the waiver', value: answer }]) }, o || {});

/* ---------- W1 the text of a waiver ---------- */
{
  const g = W.cleanWaiver({ title: '  Waiver for {race}  ', text: 'I run {race} on {date} at {venue}.\r\n\r\n\r\nI am {Name}, bib {bib}, {cat}.  ' });
  eq(g, { title: 'Waiver for {race}', text: 'I run {race} on {date} at {venue}.\n\nI am {Name}, bib {bib}, {cat}.' }, 'W1 a waiver is tidied: lines and paragraphs kept, runs of blank lines cut, placeholders kept in any letter case');
  eq(W.cleanWaiver({ title: 'T<b>x</b>', text: 'Hello <script>alert(1)</script> world, I agree to this.' }), { title: 'Tbx/b', text: 'Hello scriptalert(1)/script world, I agree to this.' }, 'W1 angle brackets are removed');
  eq(W.cleanWaiver({ title: 'T', text: 'a\u202eb\u200bc\u0000d and more words to reach the minimum' }).text, 'abc d and more words to reach the minimum', 'W1 direction marks and hidden characters are removed, a control character becomes a space');
  eq(throws(() => W.cleanWaiver({ title: 'T', text: 'too short' })), 'wv_bad_text', 'W1 a text under 20 characters is refused');
  eq(throws(() => W.cleanWaiver({ title: '   ', text: 'x'.repeat(100) })), 'wv_bad_text', 'W1 a waiver needs a title');
  eq(throws(() => W.cleanWaiver({ title: 'T', text: '<>'.repeat(30) })), 'wv_bad_text', 'W1 a text that is only brackets is empty and refused');
  eq([W.cleanWaiver({ title: 'T'.repeat(80), text: 'x'.repeat(8000) }).text.length, W.cleanWaiver({ title: 'T'.repeat(80), text: 'x'.repeat(8000) }).title.length], [8000, 80], 'W1 exactly the limits are allowed');
  eq([throws(() => W.cleanWaiver({ title: 'T', text: 'x'.repeat(8001) })), throws(() => W.cleanWaiver({ title: 'T'.repeat(81), text: 'x'.repeat(100) }))], ['wv_too_long', 'wv_too_long'], 'W1 one character too many is refused, never silently cut');
  eq([throws(() => W.cleanWaiver({ title: 'T', text: 'I give you my {phone} number, I agree to it.' })), throws(() => W.cleanWaiver({ title: 'T {email}', text: 'I agree to the waiver of this race.' })), throws(() => W.cleanWaiver({ title: 'T', text: 'x {__proto__} y {constructor} and more words here' }))], ['wv_placeholder', 'wv_placeholder', 'wv_placeholder'], 'W1 a word in curly brackets that is not listed is refused (a typing slip never reaches a runner)');
  eq(W.cleanWaiver({ title: 'T', text: 'Braces { like this } or {1bad} or {} are only text, and so is {a-b}.' }).text.length > 20, true, 'W1 curly brackets that are not a word are only text');
  ok(['x', 5, null, [], [1], 'string', true].every((v) => throws(() => W.cleanWaiver(v)) === 'wv_bad_text'), 'W1 anything that is not an object is refused');
  ok(HOSTILE.every((h) => { try { W.cleanWaiver({ title: h, text: h }); return false; } catch (e) { return /^wv_/.test(e.message); } }), 'W1 hostile values for the title and the text are refused with a waiver code, never a native error');
  eq(W.cleanWaiver({ title: 'T', text: 'Emoji 😀 stays, a lone half \ud83d goes, and enough words here.' }).text, 'Emoji 😀 stays, a lone half goes, and enough words here.', 'W1 half an emoji is dropped, a whole one stays');
}

/* ---------- W2 a saved version ---------- */
{
  const v = W.versionOf(verRow(3, 'Title', 'The text of the third version.'));
  eq([v.ver, v.title, v.text, v.by], [3, 'Title', 'The text of the third version.', 'boss'], 'W2 a version is read from its row');
  const bad = [null, undefined, 'x', 5, [], verRow(0), verRow(10000), Object.assign(verRow(1), { ref: '1.5' }), Object.assign(verRow(1), { ref: '-1' }), Object.assign(verRow(1), { ref: 'abc' }), Object.assign(verRow(1), { json: 'not json' }), Object.assign(verRow(1), { json: '[]' }), Object.assign(verRow(1), { json: '{"title":5,"text":6}' }), Object.assign(verRow(1), { json: '{"title":"","text":"x"}' }), Object.assign(verRow(1), { json: '{"title":"x","text":"<>"}' })];
  eq(bad.map((b) => W.versionOf(b)), bad.map(() => null), 'W2 a damaged or foreign row gives no version (a screen is never stopped by one)');
}

/* ---------- W3 the setup ---------- */
{
  eq(W.cleanSettings({}, 0), { question: '', accept: W.DEFAULT_ACCEPT, formVersion: 1, minVersion: 1 }, 'W3 an empty setup is the standard one');
  const s = W.cleanSettings({ question: '  I agree to the waiver  ', accept: ['Yes', ' YES.', 'I Agree!!', 'ok', ''.padEnd(3, 'z')], formVersion: 2, minVersion: 3 }, 3);
  eq([s.question, s.accept, s.formVersion, s.minVersion], ['I agree to the waiver', ['yes', 'i agree', 'ok', 'zzz'], 2, 3], 'W3 answers are written in small letters without a full stop, once each; versions up to the latest');
  ok(['question', 'accept', 'formVersion', 'minVersion'].every((k) => W.SET_KEYS.includes(k)) && W.SET_KEYS.length === 4, 'W3 the setup has four parts');
  eq([throws(() => W.cleanSettings({ evil: 1 }, 1)), throws(() => W.cleanSettings({ __proto__: null, extra: 1 }, 1)), throws(() => W.cleanSettings(JSON.parse('{"__proto__":{"x":1}}'), 1)), throws(() => W.cleanSettings(JSON.parse('{"constructor":{"x":1}}'), 1))], ['wv_bad_settings', 'wv_bad_settings', 'wv_bad_settings', 'wv_bad_settings'], 'W3 any key that is not one of the four is refused, the prototype ones too');
  eq([throws(() => W.cleanSettings(null, 1)), throws(() => W.cleanSettings([], 1)), throws(() => W.cleanSettings('x', 1)), throws(() => W.cleanSettings({ question: 5 }, 1)), throws(() => W.cleanSettings({ question: '<>' }, 1)), throws(() => W.cleanSettings({ accept: 'yes' }, 1)), throws(() => W.cleanSettings({ accept: [] }, 1)), throws(() => W.cleanSettings({ accept: [5] }, 1)), throws(() => W.cleanSettings({ accept: ['  '] }, 1)), throws(() => W.cleanSettings({ accept: ['x'.repeat(61)] }, 1)), throws(() => W.cleanSettings({ accept: new Array(13).fill(0).map((_, i) => 'a' + i) }, 1))], new Array(11).fill('wv_bad_settings'), 'W3 a setup that is not an object, a question that is not text, answers that are not a list of 1 to 12 texts of up to 60 characters are refused');
  eq([throws(() => W.cleanSettings({ formVersion: 2 }, 1)), throws(() => W.cleanSettings({ minVersion: 0 }, 3)), throws(() => W.cleanSettings({ minVersion: 1.5 }, 3)), throws(() => W.cleanSettings({ formVersion: '1' }, 3)), throws(() => W.cleanSettings({ minVersion: 4 }, 3)), throws(() => W.cleanSettings({ formVersion: 2 }, 0))], new Array(6).fill('wv_bad_settings'), 'W3 a version must be a whole number from 1 to the latest saved (1 when none is saved)');
  eq(W.cleanSettings({ question: 'q'.repeat(100) }, 1).question.length, 100, 'W3 a question of 100 characters is allowed');
  eq(W.cleanSettings({ question: 'q'.repeat(150) }, 1).question.length, 100, 'W3 a longer question is cut to 100 (the form questions are cut the same way when listed)');
  ok(HOSTILE.every((h) => { try { W.cleanSettings(h, h); return true; } catch (e) { return e.message === 'wv_bad_settings'; } }), 'W3 hostile values give a setup code, never a native error');
  // as stored
  eq(W.settingsOf(JSON.stringify({ question: 'Q', accept: ['Yes.', 'yes', 'Y'], formVersion: 2, minVersion: 2 })), { question: 'Q', accept: ['yes', 'y'], formVersion: 2, minVersion: 2 }, 'W3 a stored setup is read back the same way');
  const dflt = W.defaultSettings();
  eq(['not json', '[]', 'null', '5', '"x"', '', undefined, null, '{"question":5,"accept":"yes","formVersion":"x","minVersion":0}', '{"accept":[]}', '{"accept":[1,2]}', '{"formVersion":10000}'].map((x) => W.settingsOf(x)), new Array(12).fill(dflt), 'W3 a damaged stored setup is the standard one');
  eq(W.settingsOf('{"accept":' + JSON.stringify(new Array(30).fill(0).map((_, i) => 'a' + i)) + '}').accept.length, 12, 'W3 a stored list of answers is cut to 12');
}

/* ---------- W4 what counts as an answer ---------- */
{
  const L = W.DEFAULT_ACCEPT;
  eq(['Yes', ' yes ', 'YES.', 'true', 'TRUE', 'I agree', 'i  agree!', 'Agreed', 'I accept.', 'accepted'].map((a) => W.accepted(a, L)), new Array(10).fill(true), 'W4 an answer is compared in a plain way: small letters, one space between words, no full stop at the end');
  eq(['', ' ', 'no', 'false', 'yes please', 'not yes', 'y', '0', 'yes, no', null, undefined, 5, {}, []].map((a) => W.accepted(a, L)), new Array(14).fill(false), 'W4 anything else, an empty answer and something that is not text is not signed');
  eq([W.accepted('yes', null), W.accepted('yes', 'yes'), W.accepted('yes', []), W.accepted('', [''])], [false, false, false, false], 'W4 without a list of answers nobody has signed, and an empty answer never does');
  eq([W.normAnswer('  Hello   World!!. '), W.normAnswer(null), W.normAnswer(5)], ['hello world', '', '5'], 'W4 the plain way of writing an answer');
}

/* ---------- W5 the questions of a form ---------- */
{
  const regs = [reg('r1', 'A', 'Yes'), reg('r2', 'B', ''), reg('r3', 'C', 'no'), { _id: 'r4', form: 'garbage' }, { _id: 'r5', form: JSON.stringify([{ name: 'Phone <b>', value: '9812300101' }, { name: 'I agree to the waiver', value: 'yes' }]) }];
  const q = W.questionsOf(regs);
  eq(q.map((x) => [x.name, x.count]), [['Gender', 3], ['I agree to the waiver', 3], ['Phone b', 1]], 'W5 the questions with how many answered; an empty answer is not counted');
  ok(!JSON.stringify(q).includes('9812300101') && !JSON.stringify(q).includes('"Yes"'), 'W5 the list holds names and counts only');
  eq([W.answerOf(regs[0].form, 'I agree to the waiver'), W.answerOf(regs[1].form, 'I agree to the waiver'), W.answerOf(regs[4].form, 'Phone b'), W.answerOf(regs[0].form, 'Nothing'), W.answerOf(regs[0].form, ''), W.answerOf('garbage', 'Gender'), W.answerOf(null, 'Gender')], ['Yes', '', '9812300101', '', '', '', ''], 'W5 the answer to a question is found with the name written the way the list writes it');
  eq(W.questionsOf([{ form: JSON.stringify([{ name: 'Q'.repeat(150), value: 'x' }]) }])[0].name.length, 100, 'W5 a long question is listed cut to 100, as the setup keeps it');
  eq(W.questionsOf(new Array(3500).fill(0).map((_, i) => ({ _id: 'x' + i, form: JSON.stringify([{ name: 'Q' + (i < 3000 ? 'a' : 'b'), value: '1' }]) }))).map((x) => [x.name, x.count]), [['Qa', 3000]], 'W5 only the first 3000 registrations are read');
  ok(noNative((h) => W.questionsOf(h)) && noNative((h) => W.answerOf(h, h)), 'W5 hostile values never give a native error');
  eq(W.questionsOf(new Array(80).fill(0).map((_, i) => ({ form: JSON.stringify([{ name: 'Question number ' + i, value: 'x' }]) }))).length, 60, 'W5 at most 60 questions are listed');
}

/* ---------- W6 version numbers ---------- */
{
  eq(['v1', 'V12', 2, '3', 'v 4', '', 'x', 'v0', 'v99999', null, undefined, {}, 'v-1', ' v7 '].map((v) => W.verNum(v)), [1, 12, 2, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 7], 'W6 "v2" and 2 are the number 2; anything that is not a version of up to four digits counts as 1');
}

/* ---------- W7 what is on record ---------- */
{
  const rows = [verRow(2, 'Second'), verRow(1, 'First'), Object.assign(verRow(3), { json: 'broken' }), setRow({ question: 'Q', accept: ['y'], formVersion: 1, minVersion: 2 }), sigRow('runner', 'r1', 1, 2), sigRow('runner', 'r1', 2, 1, { at: '2027-01-02T10:00:00.000Z' }), sigRow('volunteer', 'v1', 1, 1), voidRow(W.ids.sig(EV, 'runner', 'r1', 2)),
    sigRow('runner', 'r9', 1, 'x'), sigRow('alien', 'r9', 1, 1), Object.assign(sigRow('runner', 'r8', 1, 1), { who: 'telepathy' }), Object.assign(sigRow('runner', '', 1, 1), { ref: '' }), null, 'str', 5, [], { kind: 'sig' }];
  const b = W.bookOf(rows);
  eq([b.versions.map((v) => v.ver), b.latest, b.settings.question, b.settings.minVersion], [[1, 2], 2, 'Q', 2], 'W7 versions are in order, a damaged one is left out, the latest and the setup are read');
  eq(b.sigs.map((s) => [s.sub, s.ref, s.ver, !!s.void, s.how]), [['runner', 'r1', 2, false, 'paper'], ['runner', 'r8', 1, false, 'paper'], ['volunteer', 'v1', 1, false, 'paper'], ['runner', 'r1', 1, true, 'paper']], 'W7 records are in the order they were made (by time, then by id)');
  eq(b.sigs.length, 4, 'W7 records with no number, a person of no known kind, no person or a version that is not a number are left out');
  eq(b.sigs.find((s) => s.ref === 'r1' && s.ver === 1).void, { by: 'boss', at: '2027-01-01T10:00:00.000Z', reason: 'wrong person' }, 'W7 a record that was voided says by whom and why');
  eq(b.sigs.find((s) => s.ref === 'r8').how, 'paper', 'W7 a way that is not a known one reads as paper');
  eq(W.sigsOf(b, 'runner', 'r1').length, 2, 'W7 the records of one person, voided ones included');
  eq([W.sigsOf(b, 'volunteer', 'r1').length, W.sigsOf(b, 'runner', 'nobody').length, W.sigsOf(b, 'runner', null).length], [0, 0, 0], 'W7 a person with no record has none, and a runner and a volunteer with the same id are not mixed up');
  const e0 = W.bookOf([]);
  eq([e0.versions, e0.latest, e0.settings, e0.sigs.length], [[], 0, W.defaultSettings(), 0], 'W7 nothing on record is an empty book');
  ok(noNative((h) => W.bookOf(h)), 'W7 hostile values never give a native error');
}

/* ---------- W8 where a runner stands ---------- */
{
  const book = (rows) => W.bookOf([setRow({ question: 'I agree to the waiver', accept: ['yes'], formVersion: 1, minVersion: 1 })].concat(rows || []));
  const r = reg('r1', 'Asha', 'Yes');
  eq(W.runnerState(r, book([verRow(1)])), { state: 'signed', ver: 1, how: 'form', at: '2027-01-05T08:00:00.000Z' }, 'W8 an accepted answer on the form is a signature (of the version the form shows, from the day of the registration)');
  eq(W.runnerState(reg('r2', 'B', 'no'), book()).state, 'none', 'W8 any other answer is not');
  eq(W.runnerState(reg('r2', 'B', ''), book()).state, 'none', 'W8 no answer is not');
  eq(W.runnerState(r, W.bookOf([verRow(1)])).state, 'none', 'W8 without a question set, the form says nothing');
  eq(W.runnerState(reg('r2', 'B', 'no'), book([sigRow('runner', 'r2', 1, 1)])), { state: 'signed', ver: 1, how: 'paper', at: '2027-01-01T10:00:00.000Z' }, 'W8 a paper recorded for the registration is a signature');
  const two = book([verRow(1), verRow(2), sigRow('runner', 'r1', 1, 2, { at: '2027-01-09T10:00:00.000Z' })]);
  eq(W.runnerState(r, two), { state: 'signed', ver: 2, how: 'paper', at: '2027-01-09T10:00:00.000Z' }, 'W8 the best way wins: the highest version');
  const same = book([sigRow('runner', 'r1', 1, 1, { at: '2027-01-09T10:00:00.000Z' })]);
  eq(W.runnerState(r, same).how, 'paper', 'W8 the same version twice: the later one is shown');
  const voided = book([sigRow('runner', 'r2', 1, 1), voidRow(W.ids.sig(EV, 'runner', 'r2', 1))]);
  eq(W.runnerState(reg('r2', 'B', 'no'), voided).state, 'none', 'W8 a voided record does not count');
  const mn = W.bookOf([setRow({ question: 'I agree to the waiver', accept: ['yes'], formVersion: 1, minVersion: 2 }), verRow(1), verRow(2)]);
  eq(W.runnerState(r, mn), { state: 'older', ver: 1, how: 'form', at: '2027-01-05T08:00:00.000Z' }, 'W8 a signature of a version below the lowest that counts is "older"');
  const mn2 = W.bookOf([setRow({ question: 'I agree to the waiver', accept: ['yes'], formVersion: 1, minVersion: 2 }), verRow(1), verRow(2), sigRow('runner', 'r1', 1, 2)]);
  eq(W.runnerState(r, mn2).state, 'signed', 'W8 and a paper for the new version makes it signed');
  eq([W.runnerState(null, book()).state, W.runnerState({}, book()).state, W.runnerState('x', book()).state, W.runnerState({ form: 5 }, book()).state], ['none', 'none', 'none', 'none'], 'W8 a damaged registration is not signed');
  ok(noNative((h) => W.runnerState(h, W.bookOf([h]))), 'W8 hostile values never give a native error');
  eq(W.runnerState(reg('r5', 'E', 'yes', { at: '' }), book()).at, '', 'W8 a registration without a date has no date of signing');
}

/* ---------- W9 where a volunteer stands ---------- */
{
  const book = W.bookOf([]);
  eq(W.volunteerState({ _id: 'v1', waiverAt: '2027-01-03T09:00:00.000Z', waiverVersion: 'v1' }, book), { state: 'signed', ver: 1, how: 'online', at: '2027-01-03T09:00:00.000Z' }, 'W9 the sign-up page records the waiver');
  eq(W.volunteerState({ _id: 'v2', waiverAt: '', waiverVersion: '' }, book).state, 'none', 'W9 a volunteer added by staff has not signed');
  eq(W.volunteerState({ _id: 'v2', waiverAt: '2027-01-03T09:00:00.000Z', waiverVersion: 'garbage' }, book).ver, 1, 'W9 a version that cannot be read counts as 1');
  const p = W.bookOf([sigRow('volunteer', 'v2', 1, 1)]);
  eq(W.volunteerState({ _id: 'v2', waiverAt: '' }, p), { state: 'signed', ver: 1, how: 'paper', at: '2027-01-01T10:00:00.000Z' }, 'W9 a paper recorded for a volunteer counts');
  const vd = W.bookOf([sigRow('volunteer', 'v2', 1, 1), voidRow(W.ids.sig(EV, 'volunteer', 'v2', 1))]);
  eq(W.volunteerState({ _id: 'v2', waiverAt: '' }, vd).state, 'none', 'W9 a voided paper does not');
  eq(W.volunteerState({ _id: 'x', waiverAt: '2027-01-03T09:00:00.000Z' }, W.bookOf([sigRow('runner', 'x', 1, 1)])).how, 'online', 'W9 a runner record with the same id is not a volunteer record');
  eq(W.VOLUNTEER_VERSION, 1, 'W9 the volunteer waiver is version 1');
  ok(noNative((h) => W.volunteerState(h, W.bookOf([h]))), 'W9 hostile values never give a native error');
}

/* ---------- W10 who is asked ---------- */
{
  const regs = [reg('r1', 'A', 'yes'), reg('r2', 'B', 'yes', { status: 'pending' }), reg('r3', 'C', 'yes', { status: 'unpaid' }), null, 'x'];
  eq(W.waiverRunners(regs).map((r) => r._id), ['r1'], 'W10 a waiver is asked of runners who have paid');
  eq(W.waiverVolunteers([{ _id: 'a', status: 'applied' }, { _id: 'b', status: 'approved' }, { _id: 'c', status: 'declined' }, { _id: 'd', status: 'reserve' }, null]).map((v) => v._id), ['a', 'b', 'd'], 'W10 and of volunteers who have not been declined');
  eq(W.waiverRunners(null), [], 'W10 nothing gives nobody');
}

/* ---------- W11 the list of people ---------- */
{
  const book = W.bookOf([setRow({ question: 'I agree to the waiver', accept: ['yes'], formVersion: 1, minVersion: 2 }), verRow(1), verRow(2), sigRow('runner', 'r3', 1, 2)]);
  const regs = [reg('r10', 'Dev Raman', 'yes', { cat: '21 K', bib: '104' }), reg('r2', 'Bina Rao', 'no', { bib: '102' }), reg('r3', 'Chitra Devi', 'no', { bib: '103' }), reg('r1', 'Asha Rao', 'yes', { bib: '101' }), reg('r4', 'Nina Nobib', 'no', { bib: '' }), reg('r5', 'Zed', 'no', { bib: '' })];
  const names = (o) => W.listOf('runner', regs, book, o).map((l) => l.name);
  eq(names({}), ['Asha Rao', 'Bina Rao', 'Chitra Devi', 'Dev Raman', 'Nina Nobib', 'Zed'], 'W11 the list is in bib order, those without a bib after them by name');
  eq([names({ filter: 'signed' }), names({ filter: 'older' }), names({ filter: 'none' }), names({ filter: 'todo' })], [['Chitra Devi'], ['Asha Rao', 'Dev Raman'], ['Bina Rao', 'Nina Nobib', 'Zed'], ['Asha Rao', 'Bina Rao', 'Dev Raman', 'Nina Nobib', 'Zed']], 'W11 signed; only an older version; not signed at all; and "still to sign" is both of the last two');
  eq([names({ cat: '21 K' }), names({ q: 'rao' }), names({ q: '103' }), names({ q: 'ZED' }), names({ q: 'nobody' }), names({ cat: '21k' })], [['Dev Raman'], ['Asha Rao', 'Bina Rao'], ['Chitra Devi'], ['Zed'], [], ['Dev Raman']], 'W11 by category (however it is written), by part of a name, by bib');
  const l = W.personLine('runner', regs[0], book);
  eq(Object.keys(l).sort(), ['at', 'bib', 'cat', 'how', 'id', 'name', 'state', 'ver'], 'W11 a line holds a name, a bib, a category and where the person stands, nothing else of the registration');
  eq(Object.keys(W.personLine('volunteer', { _id: 'v1', name: 'Vol', status: 'approved', phone: '9812300501', email: 'v@example.com' }, book)).sort(), ['at', 'bib', 'cat', 'how', 'id', 'name', 'state', 'ver', 'vstatus'], 'W11 a volunteer line has the status of the sign-up and no contact details');
  ok(!/9812300501|example\.com/.test(JSON.stringify(W.personLine('volunteer', { _id: 'v1', name: 'Vol', status: 'approved', phone: '9812300501', email: 'v@example.com' }, book))), 'W11 and no phone number or address');
  const c = W.countsOf('runner', regs, book, ['10 K', '21 K', 'Empty']);
  eq([c.total, c.signed, c.older, c.none, c.by], [6, 1, 2, 3, { paper: 1 }], 'W11 counts: signed, older, not signed; the ways are counted for those who signed');
  eq(c.cats.map((x) => [x.cat, x.total, x.signed, x.older, x.none]), [['10 K', 5, 1, 1, 3], ['21 K', 1, 0, 1, 0], ['Empty', 0, 0, 0, 0]], 'W11 and per category');
  eq(Object.keys(W.countsOf('volunteer', [], book)).includes('cats'), false, 'W11 volunteers have no categories');
  eq(W.listOf('runner', null, book, null), [], 'W11 nothing is an empty list');
  ok(noNative((h) => W.listOf('runner', [h], W.bookOf([h]), h)) && noNative((h) => W.countsOf('runner', [h], W.bookOf([]), [h])), 'W11 hostile values never give a native error');
  eq(W.matchesFilter({ state: 'older' }, 'todo') && !W.matchesFilter({ state: 'signed' }, 'todo') && W.matchesFilter({ state: 'signed' }, 'all') && !W.matchesFilter({ state: 'older' }, 'none'), true, 'W11 the filters');
}

/* ---------- W12 the papers ---------- */
{
  const wv = { title: 'Waiver for {race}', text: 'I, {name}, bib {bib}, {cat}, run {race} on {date} at {venue}.\n\nSecond paragraph <i>here</i> & "more".', ver: 3 };
  const evil = { name: '<img src=x onerror="window.__pwn=1">Eve', bib: '7', cat: '10 K', phone: '9812300101', email: 'e@example.com', dob: '01/01/1990', waiver: 'x' };
  const one = W.renderForm(wv, RACE, evil, 'runners');
  ok(!/<img/.test(one) && /&lt;img src=x onerror=&quot;window\.__pwn=1&quot;&gt;Eve/.test(one), 'W12 a name that is markup stays text on the paper');
  ok(!/9812300101|example\.com|01\/01\/1990/.test(one), 'W12 a paper carries no phone number, address or date of birth even if the person has them');
  ok(/Waiver for Vizag Half Marathon/.test(one) && /bib 7, 10 K, run Vizag Half Marathon on /.test(one) && /Beach Road/.test(one), 'W12 the words in curly brackets are filled in');
  ok(/&lt;i&gt;here&lt;\/i&gt; &amp; &quot;more&quot;/.test(one) && !/<i>/.test(one), 'W12 the text of the waiver is escaped as well');
  ok(/Waiver version 3/.test(one) && /class="sign"/.test(one) && /Signature/.test(one) && /Date/.test(one), 'W12 a paper says the version and has a line to sign');
  eq((one.match(/<p>/g) || []).length, 2, 'W12 paragraphs are paragraphs');
  const blank = W.renderForm(wv, RACE, null, 'runners');
  ok(/Name: <b>_{10,}<\/b>/.test(blank) && /Bib: <b>_{10,}<\/b>/.test(blank), 'W12 a blank paper has lines to write on');
  const vol = W.renderForm(wv, RACE, { name: 'Vol One', bib: '', cat: '' }, 'volunteers');
  ok(/Name: <b>Vol One<\/b>/.test(vol) && !/Bib:/.test(vol), 'W12 a volunteer paper has a name only');
  eq((W.renderForms(wv, RACE, [evil, evil, evil], 'runners').match(/class="wf"/g) || []).length, 3, 'W12 a page for each person');
  eq([W.renderBlanks(wv, RACE, 'runners', 3), W.renderBlanks(wv, RACE, 'runners', 0), W.renderBlanks(wv, RACE, 'runners', 99), W.renderBlanks(wv, RACE, 'runners', 1.5), W.renderBlanks(wv, RACE, 'runners')].map((x) => (x.match(/class="wf"/g) || []).length), [3, 1, 50, 1, 1], 'W12 copies of a blank paper: at least 1, at most 50');
  const list1 = W.renderList(wv, RACE, [{ name: 'A <b>', bib: '1', cat: '10 K' }, { name: 'B', bib: '2', cat: '21 K' }], 'runners', true);
  const list2 = W.renderList(wv, RACE, [{ name: 'C', bib: '3', cat: '10 K' }], 'runners', false);
  ok(/By signing next to my name/.test(list1) && /Second paragraph/.test(list1) && !/By signing next to my name/.test(list2) && !/Second paragraph/.test(list2), 'W12 only the first piece of a sign-in list carries the waiver');
  ok(/A &lt;b&gt;/.test(list1) && !/<b>A/.test(list1) && /<th>Bib<\/th>/.test(list1) && /<th>Signature<\/th>/.test(list1), 'W12 a list has the names as text and a column to sign');
  const vlist = W.renderList({ title: 'V', text: 'Volunteer text here that is long enough.', ver: 1 }, RACE, [{ name: 'Vol One' }], 'volunteers', true);
  ok(!/<th>Bib<\/th>/.test(vlist) && /<th>Name<\/th>/.test(vlist), 'W12 a volunteer list has no bib column');
  const head = W.sheetHead('A <b> title');
  ok(/^<!DOCTYPE html>/.test(head) && /<title>A &lt;b&gt; title<\/title>/.test(head) && /@page/.test(head), 'W12 the page around the papers escapes its title and sets the paper size');
  const vars = W.waiverVars({ name: 'N', date: '2027-02-07', venue: 'V' }, { name: 'P', bib: '12', cat: 'C' });
  eq([vars.name, vars.bib, vars.cat, vars.race, vars.venue], ['P', '12', 'C', 'N', 'V'], 'W12 the words are filled from the race and the person');
  eq([W.waiverVars(null, null).name.length > 5, W.waiverVars({}, { name: 'P' }).bib], [true, '-'], 'W12 a missing race or person does not break it');
  ok(noNative((h) => W.renderForm(wv, h, h, h)) && noNative((h) => W.renderList(wv, h, [h], h, true)), 'W12 hostile values never give a native error');
}

/* ---------- W13 the standard wording ---------- */
{
  ok(W.STARTER_TEXT.length >= 20 && W.STARTER_TEXT.length <= 8000 && W.STARTER_TITLE.length <= 80, 'W13 the standard wording fits the limits');
  eq(throws(() => W.cleanWaiver({ title: W.STARTER_TITLE, text: W.STARTER_TEXT })), '', 'W13 and passes its own rules');
  const words = (W.STARTER_TEXT.match(/\{([a-z]+)\}/g) || []).map((x) => x.slice(1, -1));
  ok(words.length > 0 && words.every((x) => W.PLACEHOLDERS.includes(x)), 'W13 it uses only listed words');
  ok(!/[<>]/.test(W.STARTER_TEXT), 'W13 it holds no markup');
  eq(W.volunteerWaiverText('Vizag <b>Run</b>'), 'I volunteer at Vizag bRun/b of my own choice. I will follow instructions from the organisers, I am fit to do my role, and I understand that the organisers (VTRA) are not liable for personal injury or loss to the extent the law allows.', 'W13 the volunteer waiver says the race name as text');
  eq(W.PLACEHOLDERS, ['race', 'date', 'venue', 'name', 'bib', 'cat'], 'W13 the six words a waiver may use');
}

/* ---------- W14 record ids ---------- */
{
  eq([W.ids.ver('e', 7), W.ids.set('e'), W.ids.sig('e', 'runner', 'r1', 3), W.ids.vd('sig~x')], ['ver~e~000007', 'set~e', 'sig~e~runner~r1~03', 'vd~sig~x'], 'W14 a row id holds what it is, the race, the person and the number');
  eq(W.ids.sig('e', 'runner', 'r1', 1) === W.ids.sig('e', 'runner', 'r1', 1) && W.ids.sig('e', 'runner', 'r1', 1) !== W.ids.sig('e', 'runner', 'r1', 2) && W.ids.sig('e', 'runner', 'r1', 1) !== W.ids.sig('e', 'volunteer', 'r1', 1), true, 'W14 one person and number make one id (a row id can be made only once), and a runner and a volunteer never share one');
  eq([W.MAX_PER_PERSON, W.MAX_IDS, W.MAX_VERSIONS, W.LIST_PAGE, W.CHUNK_FORMS, W.CHUNK_LIST, W.MAX_COPIES], [9, 100, 60, 100, 30, 120, 50], 'W14 the limits');
  ok(W.WHO.join() === 'runners,volunteers' && W.MODES.join() === 'forms,list' && W.SCOPES.join() === 'todo,all,one,blank' && W.FILTERS.join() === 'todo,none,older,signed,all', 'W14 the choices');
}

/* ---------- W15 the waiver choice of a message audience ---------- */
{
  const ctx = { cats: ['10 K'], tpls: ['bib'] };
  eq(M.cleanAud({ who: 'runners' }, ctx), M.cleanAud({ who: 'runners', waiver: 'any' }, ctx), 'W15 "any" is the standard and is not kept, so an audience without a choice reads as before');
  eq(M.cleanAud({ who: 'runners' }, ctx).waiver, undefined, 'W15 an audience with no choice has no waiver part');
  eq([M.cleanAud({ who: 'runners', waiver: 'unsigned' }, ctx).waiver, M.cleanAud({ who: 'volunteers', waiver: 'signed' }, ctx).waiver], ['unsigned', 'signed'], 'W15 runners and volunteers can be picked by whether they have signed');
  eq(['maybe', 5, null, [], {}, 'SIGNED', ' signed', true].map((w) => { try { M.cleanAud({ who: 'runners', waiver: w }, ctx); return 'ok'; } catch (e) { return e.message; } }), new Array(8).fill('bad_audience'), 'W15 any other choice is refused');
  eq([M.audLabel({ who: 'runners', pay: 'paid', waiver: 'unsigned' }), M.audLabel({ who: 'volunteers', vstatus: 'approved', waiver: 'signed' }), M.audLabel({ who: 'runners', pay: 'paid' })], ['Runners · paid · waiver not signed', 'Volunteers · approved · waiver signed', 'Runners · paid'], 'W15 the audience in words says it');
  const ppl = [{ id: 'a', name: 'A', bib: '1', paid: true, waiver: 'signed' }, { id: 'b', name: 'B', bib: '2', paid: true, waiver: 'unsigned' }, { id: 'c', name: 'C', bib: '3', paid: true, waiver: '' }, { id: 'd', name: 'D', bib: '4', paid: true }];
  const pick = (w) => M.pickAudience(ppl, Object.assign({ who: 'runners', pay: 'paid', bib: 'any', result: 'any', wave: 'any', cat: '' }, w ? { waiver: w } : {}), new Set()).map((p) => p.id);
  eq([pick(), pick('signed'), pick('unsigned'), pick('any')], [['a', 'b', 'c', 'd'], ['a'], ['b'], ['a', 'b', 'c', 'd']], 'W15 the audience keeps the people who signed, or who did not; a person whose waiver is not known is in neither list');
  const vol = M.pickAudience([{ id: 'v1', name: 'V1', vstatus: 'approved', waiver: 'unsigned' }, { id: 'v2', name: 'V2', vstatus: 'approved', waiver: 'signed' }], { who: 'volunteers', vstatus: 'any', waiver: 'unsigned' }, new Set()).map((p) => p.id);
  eq(vol, ['v1'], 'W15 the same for volunteers');
}

/* ---------- W16 a damaged row keeps its id, and a fixed text is not filled ---------- */
{
  const b = W.bookOf([sigRow('runner', 'r1', 1, 'x'), sigRow('runner', 'r1', 2, 1), Object.assign(sigRow('runner', 'r1', 3, 1), { json: 'broken' }), sigRow('runner', 'r2', 1, 1), voidRow(W.ids.sig(EV, 'runner', 'r2', 1)), sigRow('volunteer', 'r1', 1, 1)]);
  eq([W.nextSig(b, EV, 'runner', 'r1'), W.nextSig(b, EV, 'runner', 'r2'), W.nextSig(b, EV, 'runner', 'new'), W.nextSig(b, EV, 'volunteer', 'r1'), W.nextSig(b, EV, 'volunteer', 'r2')], [4, 2, 1, 2, 1], 'W16 the next number is the first whose row id is not used: a damaged row, a voided one and a record of the other kind of person are each counted rightly');
  eq(b.sigs.filter((s) => s.sub === 'runner' && s.ref === 'r1').length, 1, 'W16 and the damaged rows are still left out of what is shown');
  const nine = W.bookOf(new Array(9).fill(0).map((x, i) => sigRow('runner', 'full', i + 1, 1)));
  eq([W.nextSig(nine, EV, 'runner', 'full'), W.nextSig(W.bookOf([sigRow('runner', 'gap', 9, 1)]), EV, 'runner', 'gap')], [0, 1], 'W16 nine records use all the numbers; a gap is filled first');
  eq([W.nextSig(null, EV, 'runner', 'x'), W.nextSig({}, EV, 'runner', 'x'), W.nextSig({ taken: [] }, EV, 'runner', 'x'), W.nextSig(W.bookOf([]), EV, 'runner', 'x')], [1, 1, 1, 1], 'W16 no book, or a book without the list, starts at 1');
  ok(noNative((h) => W.nextSig(h, h, h, h)) && noNative((h) => W.nextVer(h, h)), 'W16 hostile values never give a native error');
  const dv = W.bookOf([verRow(1), Object.assign(verRow(2), { json: '{broken' }), Object.assign(verRow(3), { ref: '0' })]);
  eq([dv.latest, W.nextVer(dv, EV), W.nextVer(W.bookOf([]), EV), W.nextVer(W.bookOf([verRow(1), verRow(2)]), EV), W.nextVer(null, EV), W.nextVer({}, EV)], [1, 4, 1, 3, 1, 1], 'W16 the next text takes the first number after the latest that can be read whose id is free: a damaged row in the way is jumped over');
  eq([W.nextVer(W.bookOf(new Array(60).fill(0).map((x, i) => verRow(i + 1))), EV), W.nextVer(W.bookOf(new Array(59).fill(0).map((x, i) => verRow(i + 1)).concat([Object.assign(verRow(60), { json: 'x' })])), EV)], [0, 0], 'W16 and when the numbers up to 60 are used, there is none');
  // the volunteer waiver is fixed text: a {word} that is part of the race's name is not one of ours and stays as typed
  const NAME = 'Run {bib} {venue} {name}';
  const wvv = { title: 'Volunteer waiver', text: W.volunteerWaiverText(NAME), ver: 1 };
  const race = { name: NAME, date: '2027-02-07', venue: 'Beach' };
  const vp = W.renderForm(wvv, race, { name: 'Vol {race}' }, 'volunteers');
  ok(/I volunteer at Run \{bib\} \{venue\} \{name\} of my own choice/.test(vp) && /Name: <b>Vol \{race\}<\/b>/.test(vp), 'W16 a volunteer paper says the race name and the volunteer name as typed');
  const vl = W.renderList(wvv, race, [{ name: 'Vol {race}' }], 'volunteers', true);
  ok(/I volunteer at Run \{bib\} \{venue\} \{name\} of my own choice/.test(vl), 'W16 and so does a volunteer sign-in list');
  const rp = W.renderForm({ title: 'T', text: 'In {race}, by {name}.', ver: 1 }, race, { name: 'Pat {bib}', bib: '7', cat: 'C' }, 'runners');
  ok(/In Run \{bib\} \{venue\} \{name\}, by Pat \{bib\}\./.test(rp), 'W16 a runner paper fills the words once: a word that came from a name is not filled again');
}

done();
