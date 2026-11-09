// UNIT TESTS (Communications rules): plain text, e-mail addresses and phone numbers, placeholders, the starter templates, a template as
// typed, the settings, the message of one person, who a message goes to, the send log and the CSV file. The library has no database and
// no Wix in it, so every rule is tested on its own.
import * as M from './rd-comms.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: Communications rules');

const HOSTILE = [undefined, null, true, false, 0, -1, 1.5, NaN, Infinity, '', ' ', 'x'.repeat(5000), '\u0000', '\u202e', {}, [], [[]], { toString() { throw new Error('boom'); } }, () => 1];
const noThrow = (fn) => HOSTILE.every((h) => { try { fn(h); return true; } catch (e) { return false; } });
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
const RACE = { name: 'Vizag Half Marathon', date: '2027-02-07', venue: 'Beach Road', link: 'https://www.vtra.run/vhm' };
const CATS = ['10 K', '21 K'];
const NV = M.DEFAULT_NVARS;

/* ---------- M1 plain text ---------- */
{
  eq([M.oneLine('Hello\nWorld\u0000<b>x</b>', 50), M.oneLine('a\u202eb\u2066c', 50), M.oneLine('a\u200bb\u200ec\u2060d\ufeffe', 50), M.oneLine('  spaced  ', 50)], ['Hello World bx/b', 'abc', 'abcde', 'spaced'], 'M1 a line: line breaks and control characters become spaces, no angle brackets, no direction or hidden characters');
  eq([M.oneLine('a\u200db\u200cc', 50), M.oneLine('అనిత', 50)], ['a\u200db\u200cc', 'అనిత'], 'M1 the joiners that emoji and Telugu need are kept');
  eq([M.oneLine('a\ud83db', 50), M.oneLine('a\ude00b', 50), M.oneLine('a😀b', 50)], ['ab', 'ab', 'a😀b'], 'M1 half an emoji is dropped, a whole one stays');
  eq([M.safeCut('ab😀', 3), M.safeCut('ab😀', 4), M.safeCut('abc', 10), M.safeCut(null, 5)], ['ab', 'ab😀', 'abc', ''], 'M1 a cut never splits an emoji in two');
  eq([M.oneLine('x'.repeat(500), 120).length, M.oneLine(null, 5), M.oneLine({}, 5), M.oneLine([], 5), M.oneLine(42, 5)], [120, '', '', '', '42'], 'M1 a line is cut to length; objects and lists give nothing, a number is text');
  eq(M.cleanBody('Line1\r\nLine2\r\n\r\n\r\n\r\nPara  two\twith <b>tags</b>\n\n\n', 4000), 'Line1\nLine2\n\nPara two with btags/b', 'M1 a body: lines kept, runs of blank lines and spaces cut, no angle brackets, nothing trailing');
  eq([M.cleanBody('\n\n  first', 100), M.cleanBody('a\u202eb\u200bc\u0000d', 100), M.cleanBody('a\u2028b\u2029c', 100), M.cleanBody('x'.repeat(5000), 100).length, M.cleanBody(null, 5), M.cleanBody({}, 5)], ['first', 'abc d', 'a b c', 100, '', ''], 'M1 a body: no leading blank lines, direction and hidden characters gone, line separators become spaces, cut to length');
  eq(M.cleanBody('a\ud83d b', 100), 'a b', 'M1 half an emoji is dropped from a body');
}

/* ---------- M2 e-mail addresses ---------- */
{
  const GOOD = [['a@b.co', 'a@b.co'], ['First.Last+tag@Example.COM', 'first.last+tag@example.com'], [' x@y.in ', 'x@y.in'], ['o%brien@mail.example.org', 'o%brien@mail.example.org'], ['a_b-c@sub.domain.co.in', 'a_b-c@sub.domain.co.in'], ['a@b.co\n', 'a@b.co']];
  eq(GOOD.map((g) => M.cleanEmail(g[0])), GOOD.map((g) => g[1]), 'M2 a plain address is kept in lower case');
  const EVIL = ['', 'a', 'a@b', 'a@b.c', '@b.co', 'a@@b.co', 'a b@c.co', 'a@b.co, c@d.co', 'a@b.co;c@d.co', 'Name <a@b.co>', '"a"@b.co', 'a@b..co', '.a@b.co', 'a.@b.co', 'a..b@c.co', 'a@-b.co', 'a@b-.co', 'a@b.co\r\nBcc: x@y.co', "a'b@c.co", 'a@b.c0', 'a@[127.0.0.1]', 'é@b.co', 'a@b.co' + 'x'.repeat(200), 'a@b.co>', '<a@b.co', 'a@b.co\u0000', null, 5, {}, ['a@b.co']];
  eq(EVIL.map((g) => M.cleanEmail(g)), EVIL.map(() => ''), 'M2 a list of addresses, a name with the address, a quote, a bracket, a space, a line break, two dots, a long text or something that is not text is not an address');
}

/* ---------- M3 phone numbers and WhatsApp links ---------- */
{
  eq(['9876543210', '+91 98765 43210', '09876543210', '0091 9876543210', '919876543210', 'call 98765-43210 now', 9876543210].map((n) => M.waNumber(n)), ['919876543210', '919876543210', '919876543210', '919876543210', '919876543210', '919876543210', '919876543210'], 'M3 an Indian mobile number in any of its writings becomes 91 and ten digits');
  eq(['5876543210', '1234567', '891234567', '12345678901234567', '1234567890123456', '', null, {}, '0000000000', '1111111111', '911111111111', '0001234567890', '+++', 'abc'].map((n) => M.waNumber(n)), ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], 'M3 a number that cannot be a mobile one (a landline, too short, too long, all one digit, no digits) gives nothing');
  eq([M.waNumber('7911123456', '44'), M.waNumber('4155550123', '1'), M.waNumber('1111111111', '1'), M.waNumber('9876543210', 'abc'), M.waNumber('9876543210', '0'), M.waNumber('9876543210', '1234'), M.waNumber('9876543210', 91), M.waNumber('9876543210', undefined)], ['447911123456', '14155550123', '', '919876543210', '919876543210', '919876543210', '919876543210', '919876543210'], 'M3 the country code is the setting (91 when the setting is not a code)');
  eq([M.waNumber('447911123456', '91'), M.waNumber('+1 415 555 0123', '91')], ['447911123456', '14155550123'], 'M3 a number that already carries its country code is left as it is');
  eq([M.okCc('91'), M.okCc('1'), M.okCc('0'), M.okCc('0091'), M.okCc(91), M.okCc(''), M.okCc('9 1')], [true, true, false, false, false, false, false], 'M3 a country code is one to three digits, not starting with 0');
  eq(M.waLink('919876543210', 'Hello & welcome\n100% ok'), 'https://wa.me/919876543210?text=Hello%20%26%20welcome%0A100%25%20ok', 'M3 a chat address holds the number and the message, encoded');
  eq(['0919876543210', '12', '9198765432101234567', '', null, '91987654321a', '+919876543210', '91 9876543210', {}].map((n) => M.waLink(n, 't')), ['', '', '', '', '', '', '', '', ''], 'M3 only digits make a chat address: a plus, a space, a letter, too short, too long or a leading 0 give nothing');
  ok(/^https:\/\/wa\.me\/919876543210\?text=[A-Za-z0-9%_.!~*'()-]*$/.test(M.waLink('919876543210', '<script>alert(1)</script> "quoted" \u202e \u0000 😀 అ \'single\' `tick`')), 'M3 whatever the message holds, the address has nothing in it but letters, digits and % codes');
  eq(M.waLink('919876543210', 'a\ud83d'), 'https://wa.me/919876543210?text=a', 'M3 half an emoji cannot break a chat address');
  eq([M.waLink('919876543210', null), M.waLink('919876543210', {})], ['https://wa.me/919876543210?text=', 'https://wa.me/919876543210?text='], 'M3 a message that is not text is an empty one');
}

/* ---------- M4 a link in a message ---------- */
{
  const GOOD = ['https://vtra.run', 'https://www.vtra.run/vhm?x=1&y=2#top', 'https://example.com:8443/a', ' https://vtra.run/a '];
  eq(GOOD.map((g) => !!M.cleanLink(g)), GOOD.map(() => true), 'M4 a https address is a link');
  const EVIL = ['http://vtra.run', 'javascript:alert(1)', 'https://', 'https://a b.com', 'https://vtra.run/"onerror', 'https://user@evil.com', 'https://evil.com\\@vtra.run', 'https://vtra.run/a\nb', 'https://vtra.run/<script>', 'https://' + 'a'.repeat(250), '//vtra.run', 'data:text/html,x', 'ftp://vtra.run', 'https://vtra.run/a b', "https://vtra.run/a'b", '', null, 5, {}];
  eq(EVIL.map((g) => M.cleanLink(g)), EVIL.map(() => ''), 'M4 another scheme, a user name, a space, a quote, a bracket, a line break, a long text or something that is not text is not a link');
}

/* ---------- M5 placeholders ---------- */
{
  eq(M.usedVars('Hi {Name} {name} {bib} {x_1} {1bad} {a-b} {} {  }'), ['name', 'bib', 'x_1'], 'M5 the placeholders a text uses, once each, in lower case');
  eq([M.needsOf({ subject: '{bib}', body: 'x' }), M.needsOf({ subject: 's', body: '{wave}' }), M.needsOf({ subject: 's', body: '{TIME}' }), M.needsOf({ subject: 's', body: 'see {link}' }), M.needsOf(null)].map((n) => [n.waves, n.results, n.link]), [[false, false, false], [true, false, false], [false, true, false], [false, false, true], [false, false, false]], 'M5 a template that uses waves, results or the race link says so');
  eq([M.unknownVars({ subject: '{nmae}', body: '{name} {bib}' }, 'runner'), M.unknownVars({ subject: 's', body: '{wave} {name}' }, 'volunteer'), M.unknownVars({ subject: 's', body: '{name}' }, 'nonsense')], [['nmae'], ['wave'], ['name']], 'M5 a placeholder the kind does not have is unknown (a typo, or a runner detail in a message to volunteers)');
  eq([M.properName('YOGESH RAO'), M.properName("MARY-ANN O'NEIL"), M.properName('Asha Rao'), M.properName('asha'), M.properName('R. KUMAR'), M.properName('అనిత'), M.properName('MCDONALD'), M.properName('')], ['Yogesh Rao', "Mary-Ann O'Neil", 'Asha Rao', 'asha', 'R. Kumar', 'అనిత', 'Mcdonald', ''], 'M5 a name typed all in capitals is written with a capital for each word, any other name is left as typed');
  eq([M.firstName('YOGESH RAO'), M.firstName('Asha Rao'), M.firstName(''), M.firstName('   '), M.firstName(null), M.firstName('<b>Hack</b> Name')], ['Yogesh', 'Asha', '', '', '', 'bHack/b'], 'M5 the first name is the first word');
  const v = M.varsFor({ name: 'A B', bib: '12', bibName: 'ABBY', cat: '10 K', size: 'M', wave: 'Wave A', start: '05:30', corral: 'B', time: '1:02:03', place: '3rd' }, RACE);
  eq(v, { name: 'A B', firstname: 'A', bib: '12', bibname: 'ABBY', cat: '10 K', size: 'M', wave: 'Wave A', start: '05:30', corral: 'B', time: '1:02:03', place: '3rd', race: 'Vizag Half Marathon', date: '7 February 2027', venue: 'Beach Road', link: 'https://www.vtra.run/vhm' }, 'M5 every placeholder has its value');
  const empty = M.varsFor(null, null);
  ok(Object.keys(empty).sort().join() === Object.keys(v).sort().join() && Object.values(empty).every((x) => x === M.DASH), 'M5 a value that is not known is a dash, for every placeholder');
  eq(M.varsFor({ name: 'x' }, { name: 'R', date: 'soon', venue: 'V', link: 'javascript:alert(1)' }).link + '|' + M.varsFor({ name: 'x' }, { date: 'soon' }).date, M.DASH + '|soon', 'M5 a link that is not https is a dash; a date that is not a date is shown as typed');
  const evil = M.varsFor({ name: '<img src=x onerror=1>\n\n{bib}', bib: '1\n2', cat: 'a\u202eb' }, { name: '<b>R</b>', venue: 'V\nW' });
  ok(Object.values(evil).every((x) => typeof x === 'string' && !/[<>\n\r\u202e]/.test(x)), 'M5 no value can hold a tag, a line break or a direction character');
  ok(M.VARS.runner.every((k) => k in v) && M.VARS.volunteer.every((k) => k in v) && M.VARS.volunteer.every((k) => M.VARS.runner.includes(k)), 'M5 the lists of placeholders match what varsFor gives');
}

/* ---------- M6 the starter templates ---------- */
{
  eq(M.STARTERS.map((s) => s.id), ['bib', 'kit', 'raceweek', 'thanks', 'volunteer'], 'M6 five starter templates');
  ok(M.STARTERS.every((s) => M.okTplId(s.id)) && new Set(M.STARTERS.map((s) => s.id)).size === M.STARTERS.length, 'M6 their ids are valid and different');
  ok(M.STARTERS.every((s) => { const c = M.cleanTemplate(s); return c.name === s.name && c.kind === s.kind && c.subject === s.subject && c.body === s.body && c.archived === false; }), 'M6 each is a valid template and cleaning does not change it');
  ok(M.STARTERS.every((s) => M.unknownVars(s, s.kind).length === 0), 'M6 each uses only placeholders that its kind has');
  ok(M.STARTERS.every((s) => !/[<>]/.test(s.subject + s.body)), 'M6 no markup in any');
  eq(M.STARTERS.filter((s) => M.needsOf(s).link).map((s) => s.id), ['kit', 'raceweek', 'thanks', 'volunteer'], 'M6 only the bib message can be sent before the race has a link');
  ok(M.STARTERS.every((s) => { const m = M.buildMessage(s, M.varsFor({ name: 'ASHA RAO', bib: '7', cat: '10 K', size: 'M', wave: 'A', start: '05:30', corral: '1', time: '1:00:00', place: '1st' }, RACE), NV); return m.subject && m.paras.length >= 2 && !/\{[a-z]+\}/i.test(m.subject + m.paras.join('')); }), 'M6 each makes a complete message, with no placeholder left in it');
}

/* ---------- M7 a template as typed ---------- */
{
  const T1 = { name: 'My mail', kind: 'runner', subject: 'Hello {firstname}', body: 'Your bib is {bib}.\n\nBye' };
  eq(M.cleanTemplate(T1), { name: 'My mail', kind: 'runner', subject: 'Hello {firstname}', body: 'Your bib is {bib}.\n\nBye', archived: false }, 'M7 a template is a name, a kind, a subject and a body');
  eq(M.cleanTemplate(Object.assign({}, T1, { archived: true, extra: 'x', __proto__: { x: 1 } })).archived, true, 'M7 a template can be archived; keys it does not know are ignored');
  eq(M.cleanTemplate({ name: '<b>N</b>\n', kind: 'volunteer', subject: 'S\nT', body: 'B <i>b</i> {name}' }), { name: 'bN/b', kind: 'volunteer', subject: 'S T', body: 'B ib/i {name}', archived: false }, 'M7 markup and line breaks typed in a template are cleaned');
  const BAD = [null, undefined, 'x', 5, [], [T1], {}, Object.assign({}, T1, { name: 5 }), Object.assign({}, T1, { subject: null }), Object.assign({}, T1, { body: {} }), Object.assign({}, T1, { kind: 'admin' }), Object.assign({}, T1, { kind: undefined }), Object.assign({}, T1, { archived: 'yes' }), Object.assign({}, T1, { name: '   ' }), Object.assign({}, T1, { subject: ' \u0000 ' }), Object.assign({}, T1, { body: '\n\n' }), Object.assign({}, T1, { subject: 'x'.repeat(2000) }), Object.assign({}, T1, { body: 'x'.repeat(20000) })];
  eq(BAD.map((b) => throws(() => M.cleanTemplate(b))), BAD.map(() => 'bad_template'), 'M7 a template that is not an object, has a wrong type, an unknown kind, no name, subject or body, or is far too long is refused');
  eq([throws(() => M.cleanTemplate(Object.assign({}, T1, { subject: 'Hi {nmae}' }))), throws(() => M.cleanTemplate(Object.assign({}, T1, { kind: 'volunteer' }))), throws(() => M.cleanTemplate(Object.assign({}, T1, { body: '{Bib} {wave} {link}' })))], ['unknown_placeholder', 'unknown_placeholder', ''], 'M7 a placeholder that the kind does not have is refused (a typo would go to everyone); any case of a known one is fine');
  eq([M.cleanTemplate(Object.assign({}, T1, { subject: 'x'.repeat(300) })).subject.length, M.cleanTemplate(Object.assign({}, T1, { body: 'y'.repeat(5000) })).body.length, M.cleanTemplate(Object.assign({}, T1, { name: 'n'.repeat(200) })).name.length], [M.MAX_SUBJECT, M.MAX_BODY, 60], 'M7 a subject, a body and a name are cut to their length');
  eq([M.okTplId('bib'), M.okTplId('t1_x-9'), M.okTplId('a'), M.okTplId('-a'), M.okTplId('a~b'), M.okTplId('a b'), M.okTplId('x'.repeat(41)), M.okTplId(''), M.okTplId(null), M.okTplId(5)], [true, true, false, false, false, false, false, false, false, false], 'M7 a template id is two to forty letters, digits, dashes and underscores');
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  eq([M.templateOf(JSON.stringify(T1), parse).name, M.templateOf('not json', parse), M.templateOf('{"name":5}', parse), M.templateOf(null, parse), M.templateOf('{"name":"a","kind":"runner","subject":"{zz}","body":"b"}', parse)], ['My mail', null, null, null, null], 'M7 a damaged or hand-written stored row is not a template');
}

/* ---------- M8 the settings ---------- */
{
  eq([M.cleanSettings({}), M.cleanSettings({ emailId: ' my_email-1 ', nvars: '8', cc: '44' }), M.cleanSettings({ nvars: 12, cc: '' })], [{ emailId: '', nvars: 6, cc: '91' }, { emailId: 'my_email-1', nvars: 8, cc: '44' }, { emailId: '', nvars: 12, cc: '91' }], 'M8 settings: the Wix e-mail id, how many paragraphs it has and the country code');
  const BAD = [null, undefined, 'x', 5, [], { emailId: 'a b' }, { emailId: 'a"b' }, { emailId: 'a<b>' }, { emailId: 'x'.repeat(81) }, { emailId: 5 }, { emailId: null }, { emailId: ['a'] }, { nvars: 0 }, { nvars: 13 }, { nvars: 1.5 }, { nvars: 'x' }, { nvars: null }, { nvars: '123' }, { cc: '0' }, { cc: 'abc' }, { cc: '1234' }, { cc: 91 }, { cc: null }];
  eq(BAD.map((b) => throws(() => M.cleanSettings(b))), BAD.map(() => 'bad_settings'), 'M8 an id with a space or a quote, a number of paragraphs outside 1 to 12, a country code that is not 1 to 3 digits or anything that is not an object is refused');
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  eq([M.settingsOf('{"emailId":"x1","nvars":4,"cc":"1"}', parse), M.settingsOf('nonsense', parse), M.settingsOf('{"nvars":99}', parse), M.settingsOf(null, parse)], [{ emailId: 'x1', nvars: 4, cc: '1' }, M.SETTINGS_DEFAULT, M.SETTINGS_DEFAULT, M.SETTINGS_DEFAULT], 'M8 a damaged stored row gives the defaults');
  eq([M.cleanRaceLink(undefined), M.cleanRaceLink(null), M.cleanRaceLink(''), M.cleanRaceLink('https://vtra.run/vhm')], ['', '', '', 'https://vtra.run/vhm'], 'M8 the race link is empty or a https address');
  eq(['http://x.com', 'javascript:1', 'https://a b', 5, {}].map((l) => throws(() => M.cleanRaceLink(l))), ['bad_settings', 'bad_settings', 'bad_settings', 'bad_settings', 'bad_settings'], 'M8 any other race link is refused');
}

/* ---------- M9 the message of one person ---------- */
{
  const vars = M.varsFor({ name: 'ASHA RAO', bib: '12', cat: '10 K', size: 'M' }, RACE);
  const T1 = { subject: 'Bib {bib} for {race}', body: 'Hello {firstname},\n\nYour bib is {bib}.\n\nBye' };
  const m = M.buildMessage(T1, vars, NV);
  eq([m.subject, m.paras, m.joined, m.cut], ['Bib 12 for Vizag Half Marathon', ['Hello Asha,', 'Your bib is 12.', 'Bye'], 0, false], 'M9 a message: the subject and a paragraph for each blank-line-separated block, filled in for this person');
  eq(Object.keys(m.variables), ['subject', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'], 'M9 what Wix is given: a subject and as many paragraphs as the e-mail has places for');
  eq([m.variables.p1, m.variables.p3, m.variables.p4, m.variables.p6], ['Hello Asha,', 'Bye', M.NBSP, M.NBSP], 'M9 a place that is not used holds a blank, so Wix never shows its fallback text there');
  ok(Object.values(m.variables).every((x) => typeof x === 'string'), 'M9 every value handed to Wix is text');
  const many = { subject: 's', body: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n\n') };
  const j = M.buildMessage(many, vars, 3);
  eq([j.paras.length, j.paras[2], j.joined, Object.keys(j.variables).length], [3, 'three\n\nfour\n\nfive\n\nsix\n\nseven\n\neight', 5, 4], 'M9 more paragraphs than the e-mail has places for are joined into the last place; nothing is lost');
  eq([Object.keys(M.buildMessage(T1, vars, 0).variables).length, Object.keys(M.buildMessage(T1, vars, 13).variables).length, Object.keys(M.buildMessage(T1, vars, 'x').variables).length, Object.keys(M.buildMessage(T1, vars, 1.5).variables).length, Object.keys(M.buildMessage(T1, vars, 12).variables).length, Object.keys(M.buildMessage(T1, vars, 1).variables).length], [7, 7, 7, 7, 13, 2], 'M9 a number of paragraphs outside 1 to 12 is the default of 6');
  const inj = M.buildMessage({ subject: 'Hi {name}', body: 'Hello {firstname}\n\nBib {bib}' }, M.varsFor({ name: '{bib}\n\n<script>alert(1)</script>', bib: '99' }, RACE), NV);
  ok(inj.paras[0].includes('{bib}') && !inj.paras[0].includes('99') && inj.paras.length === 2 && !/[<>]/.test(inj.subject + inj.paras.join('')), 'M9 a runner who types {bib} or markup as a name changes nothing: a value is never filled in again and nothing makes a tag or a paragraph');
  const bigPara = M.buildMessage({ subject: 's', body: 'y'.repeat(3000) }, vars, NV);
  eq([bigPara.paras[0].length, bigPara.cut], [M.MAX_PARA, true], 'M9 a paragraph is cut to its length, and the message says so');
  eq([M.buildMessage({ subject: 'A\nB\u202e', body: 'x' }, vars, NV).subject, M.buildMessage({ subject: 'x'.repeat(500), body: 'x' }, vars, NV).subject.length, M.buildMessage({ subject: 'S', body: '' }, vars, NV).variables.p1, M.buildMessage(null, vars, NV).subject], ['A B', M.MAX_SUBJECT + 60, M.NBSP, ''], 'M9 a subject is one line and not longer than a subject should be; an empty body is an empty message');
  const wa = M.waText({ subject: 'Hi *there*', paras: ['a', 'b'] });
  eq([wa.text, wa.cut, M.waText({ subject: '', paras: ['only'] }).text, M.waText({}).text, M.waText(null).text], ['*Hi there*\n\na\n\nb', false, 'only', '', ''], 'M9 a chat message: the subject in bold, then the paragraphs');
  const long = M.waText({ subject: 'S', paras: ['word '.repeat(400)] });
  ok(long.cut && long.text.length <= M.MAX_WA && long.text.endsWith('…') && !/\s…$/.test(long.text), 'M9 a chat message is cut to its length at a word, with an ellipsis');
  ok(!/[\ud800-\udbff]$/.test(M.waText({ subject: '', paras: ['a'.repeat(M.MAX_WA - 2) + '😀😀'] }).text.replace(/…$/, '')), 'M9 a chat message is never cut in the middle of an emoji');
}

/* ---------- M10 who a message goes to ---------- */
{
  const ctx = { cats: CATS, tpls: ['bib', 'kit'] };
  eq(M.cleanAud({ who: 'runners' }, ctx), { who: 'runners', pay: 'paid', cat: '', bib: 'any', result: 'any', wave: 'any', notSent: '', uncertain: false }, 'M10 runners: paid ones, whatever else, unless the audience says more');
  eq(M.cleanAud({ who: 'volunteers' }, ctx), { who: 'volunteers', vstatus: 'any', notSent: '', uncertain: false }, 'M10 volunteers: all of them unless the audience says more');
  eq(M.cleanAud({ who: 'runners', pay: 'all', cat: '10k', bib: 'has', result: 'fin', wave: 'none', notSent: 'bib', uncertain: true }, ctx), { who: 'runners', pay: 'all', cat: '10 K', bib: 'has', result: 'fin', wave: 'none', notSent: 'bib', uncertain: true }, 'M10 every choice is checked; a category in any spelling becomes the race\'s own');
  eq(M.cleanAud({ who: 'volunteers', vstatus: 'approved', notSent: 'kit' }, ctx).vstatus, 'approved', 'M10 volunteers can be picked by status');
  const proto = JSON.parse('{"who":"runners","__proto__":{"pay":"all"}}');
  const BAD = [null, undefined, 'x', 5, [], {}, { who: 'x' }, { who: 'all' }, { who: 'runners', foo: 1 }, proto, { who: 'runners', pay: 'maybe' }, { who: 'runners', pay: null }, { who: 'runners', cat: 'ZZ' }, { who: 'runners', cat: 5 }, { who: 'runners', cat: ['10 K'] }, { who: 'runners', bib: 'yes' }, { who: 'runners', result: 'win' }, { who: 'runners', wave: 1 }, { who: 'runners', vstatus: 'approved' }, { who: 'volunteers', pay: 'paid' }, { who: 'volunteers', cat: '' }, { who: 'volunteers', bib: 'any' }, { who: 'volunteers', result: 'any' }, { who: 'volunteers', wave: 'any' }, { who: 'volunteers', vstatus: 'x' }, { who: 'runners', notSent: 'other' }, { who: 'runners', notSent: 'a b' }, { who: 'runners', notSent: 5 }, { who: 'runners', uncertain: 'true' }, { who: 'runners', uncertain: 1 }];
  eq(BAD.map((b) => throws(() => M.cleanAud(b, ctx))), BAD.map(() => 'bad_audience'), 'M10 an audience that is not an object, has a key or a choice it does not know, mixes runner and volunteer choices, names a category or template that is not there, or has a wrong type is refused');
  eq(throws(() => M.cleanAud({ who: 'runners', cat: '10 K' }, { cats: [], tpls: [] })) + '|' + throws(() => M.cleanAud({ who: 'runners', cat: '10 K' })) + '|' + M.cleanAud({ who: 'runners' }, null).who, 'bad_audience|bad_audience|runners', 'M10 with no categories known no category can be chosen');
  // who has signed the waiver: one more choice, kept only when it says something (an audience that does not ask reads as it always did)
  eq([M.cleanAud({ who: 'runners', waiver: 'signed' }, ctx), M.cleanAud({ who: 'volunteers', waiver: 'unsigned' }, ctx)], [{ who: 'runners', pay: 'paid', cat: '', bib: 'any', result: 'any', wave: 'any', waiver: 'signed', notSent: '', uncertain: false }, { who: 'volunteers', vstatus: 'any', waiver: 'unsigned', notSent: '', uncertain: false }], 'M10 the waiver can be asked of runners and of volunteers: signed, or not signed');
  eq([M.cleanAud({ who: 'runners', waiver: 'any' }, ctx), M.cleanAud({ who: 'volunteers', waiver: 'any' }, ctx), M.cleanAud({ who: 'runners', waiver: undefined }, ctx)], [M.cleanAud({ who: 'runners' }, ctx), M.cleanAud({ who: 'volunteers' }, ctx), M.cleanAud({ who: 'runners' }, ctx)], 'M10 "any" or nothing about the waiver leaves the audience exactly as it was (no waiver key at all)');
  const BADW = [null, '', 'yes', 'no', 'SIGNED', 'Signed', ' signed', 'signed ', 'not signed', 'unsigned1', 'older', 'none', 'todo', 5, 0, true, false, ['signed'], {}, { v: 'signed' }, () => 'signed', Symbol('x')];
  eq(BADW.map((w) => throws(() => M.cleanAud({ who: 'runners', waiver: w }, ctx)) + '/' + throws(() => M.cleanAud({ who: 'volunteers', waiver: w }, ctx))), BADW.map(() => 'bad_audience/bad_audience'), 'M10 a waiver choice that is not exactly "any", "signed" or "unsigned" is refused, for runners and for volunteers (a null, a blank, another case, a number, a list, an object, a function)');
  eq([throws(() => M.cleanAud({ who: 'runners', Waiver: 'signed' }, ctx)), throws(() => M.cleanAud({ who: 'runners', waivers: 'signed' }, ctx)), throws(() => M.cleanAud({ who: 'runners', waiverVersion: 1 }, ctx))], ['bad_audience', 'bad_audience', 'bad_audience'], 'M10 and a key that only looks like it is refused');
  const P = [
    { id: 'r1', name: 'Asha', bib: '2', cat: '10 K', paid: true, status: 'fin', wave: 'w1', email: 'a@x.co', phone: '9876543210' },
    { id: 'r2', name: 'Ben', bib: '10', cat: '21 K', paid: true, status: 'dnf', wave: '', email: '', phone: '' },
    { id: 'r3', name: 'Cara', bib: '', cat: '10 K', paid: true, status: '', wave: '', email: 'c@x.co', phone: '123' },
    { id: 'r4', name: 'Dev', bib: 'A5', cat: '10 K', paid: false, status: '', wave: 'w2', email: 'd@x.co', phone: '9123456789' },
    { id: 'r5', name: 'Eli', bib: '1', cat: '21 K', paid: true, status: 'dns', wave: 'w1', email: 'e@x.co', phone: '9123456780' },
    { id: 'r6', name: 'Fay', bib: '', cat: '21 K', paid: false, status: '', wave: '', email: '', phone: '' },
  ];
  const ids = (aud, sent) => M.pickAudience(P, M.cleanAud(aud, ctx), sent).map((p) => p.id).join();
  eq([ids({ who: 'runners' }), ids({ who: 'runners', pay: 'unpaid' }), ids({ who: 'runners', pay: 'all' })], ['r5,r1,r2,r3', 'r4,r6', 'r5,r1,r2,r4,r3,r6'], 'M10 paid, not paid and all, in bib order (numbers first, then other bibs, then those with no bib by name)');
  eq([ids({ who: 'runners', cat: '10 K' }), ids({ who: 'runners', cat: '21k', pay: 'all' }), ids({ who: 'runners', bib: 'has' }), ids({ who: 'runners', bib: 'none', pay: 'all' })], ['r1,r3', 'r5,r2,r6', 'r5,r1,r2', 'r3,r6'], 'M10 by category, with a bib, without a bib');
  eq([ids({ who: 'runners', result: 'fin' }), ids({ who: 'runners', result: 'dnf' }), ids({ who: 'runners', result: 'dns' }), ids({ who: 'runners', result: 'none' }), ids({ who: 'runners', result: 'none', pay: 'all' }), ids({ who: 'runners', result: 'dsq' })], ['r1', 'r2', 'r5', 'r3', 'r4,r3,r6', ''], 'M10 by result, or with no result yet');
  eq([ids({ who: 'runners', wave: 'has' }), ids({ who: 'runners', wave: 'none' }), ids({ who: 'runners', wave: 'has', pay: 'all' })], ['r5,r1', 'r2,r3', 'r5,r1,r4'], 'M10 in a wave, or not');
  eq([ids({ who: 'runners', cat: '10 K', bib: 'has', wave: 'has', result: 'fin' }), ids({ who: 'runners', cat: '21 K', bib: 'none' })], ['r1', ''], 'M10 every choice must hold at once');
  eq([ids({ who: 'runners', notSent: 'bib' }, new Set(['r1', 'r5'])), ids({ who: 'runners' }, new Set(['r1', 'r5'])), ids({ who: 'runners', notSent: 'bib' }, null), ids({ who: 'runners', notSent: 'bib' }, ['r1'])], ['r2,r3', 'r5,r1,r2,r3', 'r5,r1,r2,r3', 'r5,r1,r2,r3'], 'M10 "not yet sent" leaves out those who have had the template; the list of them only counts when the audience asks for it');
  // who has signed the waiver: a person whose waiver is not known is in neither list; it works with every other choice
  const PW = [
    { id: 'w1', name: 'Asha', bib: '1', cat: '10 K', paid: true, waiver: 'signed', status: 'fin', wave: 'w1' },
    { id: 'w2', name: 'Ben', bib: '2', cat: '10 K', paid: true, waiver: 'unsigned', status: '', wave: '' },
    { id: 'w3', name: 'Cara', bib: '3', cat: '21 K', paid: true, waiver: '', status: '', wave: '' },
    { id: 'w4', name: 'Dev', bib: '4', cat: '21 K', paid: true, status: '', wave: '' },
    { id: 'w5', name: 'Eli', bib: '5', cat: '21 K', paid: false, waiver: 'signed', status: '', wave: '' },
    { id: 'w6', name: 'Fay', bib: '6', cat: '10 K', paid: true, waiver: 'SIGNED', status: '', wave: '' },
    { id: 'w7', name: 'Gus', bib: '7', cat: '10 K', paid: true, waiver: 'unsigned', status: '', wave: '' },
  ];
  const wids = (aud, sent) => M.pickAudience(PW, M.cleanAud(aud, ctx), sent).map((p) => p.id).join();
  eq([wids({ who: 'runners' }), wids({ who: 'runners', waiver: 'any' }), wids({ who: 'runners', waiver: 'signed' }), wids({ who: 'runners', waiver: 'unsigned' }), wids({ who: 'runners', waiver: 'signed', pay: 'all' }), wids({ who: 'runners', waiver: 'unsigned', pay: 'all' })], ['w1,w2,w3,w4,w6,w7', 'w1,w2,w3,w4,w6,w7', 'w1', 'w2,w7', 'w1,w5', 'w2,w7'], 'M10 by waiver: signed, or not signed; a person whose waiver is not known (none, or not written exactly) is in neither list');
  eq([wids({ who: 'runners', waiver: 'unsigned', cat: '10 K' }), wids({ who: 'runners', waiver: 'signed', cat: '21 K', pay: 'all' }), wids({ who: 'runners', waiver: 'unsigned', result: 'none' }), wids({ who: 'runners', waiver: 'signed', result: 'fin', wave: 'has', bib: 'has', cat: '10 K' }), wids({ who: 'runners', waiver: 'unsigned', notSent: 'bib' }, new Set(['w2'])), wids({ who: 'runners', waiver: 'unsigned', notSent: 'bib' }, new Set(['w1']))], ['w2,w7', 'w5', 'w2,w7', 'w1', 'w7', 'w2,w7'], 'M10 and it holds together with the other choices (category, result, wave, bib, "not yet sent")');
  const VW = [{ id: 'v1', name: 'Zed', vstatus: 'approved', waiver: 'signed' }, { id: 'v2', name: 'Amy', vstatus: 'applied', waiver: 'unsigned' }, { id: 'v3', name: 'Bob', vstatus: 'declined', waiver: 'unsigned' }, { id: 'v4', name: 'Cat', vstatus: 'approved', waiver: 'unsigned' }, { id: 'v5', name: 'Dan', vstatus: 'approved' }];
  const vw = (aud) => M.pickAudience(VW, M.cleanAud(aud, ctx)).map((p) => p.id).join();
  eq([vw({ who: 'volunteers', waiver: 'signed' }), vw({ who: 'volunteers', waiver: 'unsigned' }), vw({ who: 'volunteers', waiver: 'unsigned', vstatus: 'approved' }), vw({ who: 'volunteers', waiver: 'signed', vstatus: 'applied' }), vw({ who: 'volunteers' })], ['v1', 'v2,v3,v4', 'v4', '', 'v2,v3,v4,v5,v1'], 'M10 volunteers by waiver, alone or with a status');
  const beforeW = JSON.stringify(PW);
  const full = M.cleanAud({ who: 'runners', pay: 'all' }, ctx);
  const pw = (w) => M.pickAudience(PW, Object.assign({}, full, { waiver: w }), null).length;
  ok(JSON.stringify(PW) === beforeW && [pw('signed'), pw('unsigned'), pw('any'), pw(undefined), pw('maybe')].join() === '2,2,7,7,7', 'M10 picking by waiver changes nobody; \"any\" (or a choice cleanAud would never let through) filters nothing: everybody is picked');
  const before = JSON.stringify(P);
  M.pickAudience(P, M.cleanAud({ who: 'runners', pay: 'all' }, ctx), new Set());
  ok(JSON.stringify(P) === before, 'M10 picking an audience changes nobody');
  const V = [{ id: 'v1', name: 'Zed', vstatus: 'approved' }, { id: 'v2', name: 'Amy', vstatus: 'applied' }, { id: 'v3', name: 'Bob', vstatus: 'declined' }, { id: 'v4', name: 'Cat', vstatus: 'approved' }];
  const vids = (aud, sent) => M.pickAudience(V, M.cleanAud(aud, ctx), sent).map((p) => p.id).join();
  eq([vids({ who: 'volunteers' }), vids({ who: 'volunteers', vstatus: 'approved' }), vids({ who: 'volunteers', vstatus: 'reserve' }), vids({ who: 'volunteers', vstatus: 'approved', notSent: 'kit' }, new Set(['v4']))], ['v2,v3,v4,v1', 'v4,v1', '', 'v1'], 'M10 volunteers, by status, by name');
  eq([M.pickAudience(null, { who: 'runners', pay: 'all' }, null), M.pickAudience(undefined, { who: 'runners', pay: 'all' }), M.pickAudience('x', { who: 'runners', pay: 'all' })], [[], [], []], 'M10 nobody gives nobody');
  eq([M.reachedBy(P[0], 'email'), M.reachedBy(P[1], 'email'), M.reachedBy(P[0], 'whatsapp'), M.reachedBy(P[2], 'whatsapp'), M.reachedBy(P[1], 'whatsapp'), M.reachedBy(P[0], 'whatsapp', '1'), M.reachedBy({}, 'email'), M.reachedBy({ phone: '5876543210' }, 'whatsapp')], [true, false, true, false, false, true, false, false], 'M10 a person is reached by e-mail when they have a plain address, by WhatsApp when their number can be opened');
  eq([M.pieces([1, 2, 3, 4, 5], 2), M.pieces([], 3), M.pieces([1], 5)], [[[1, 2], [3, 4], [5]], [], [[1]]], 'M10 a list is cut into pieces');
  eq([M.audLabel(M.cleanAud({ who: 'runners' }, ctx)), M.audLabel(M.cleanAud({ who: 'runners', pay: 'all', cat: '21 K', bib: 'has', result: 'none', wave: 'none', notSent: 'bib' }, ctx), 'Your bib'), M.audLabel(M.cleanAud({ who: 'volunteers', vstatus: 'approved' }, ctx)), M.audLabel(null)], ['Runners · paid', 'Runners · paid and unpaid · 21 K · with a bib · no result yet · not in a wave · not yet sent "Your bib"', 'Volunteers · approved', ''], 'M10 an audience in words');
  eq([M.audLabel(M.cleanAud({ who: 'runners', waiver: 'signed' }, ctx)), M.audLabel(M.cleanAud({ who: 'runners', waiver: 'unsigned', cat: '21 K', notSent: 'bib' }, ctx), 'Your bib'), M.audLabel(M.cleanAud({ who: 'volunteers', vstatus: 'approved', waiver: 'unsigned' }, ctx)), M.audLabel(M.cleanAud({ who: 'volunteers', waiver: 'signed' }, ctx)), M.audLabel({ who: 'runners', waiver: 'maybe' })], ['Runners · paid · waiver signed', 'Runners · paid · 21 K · waiver not signed · not yet sent "Your bib"', 'Volunteers · approved · waiver not signed', 'Volunteers · waiver signed', 'Runners · paid'], 'M10 the waiver choice in words; a choice that is not one of the two says nothing');
  ok(M.byPerson({ bib: '2', name: 'b', id: '1' }, { bib: '10', name: 'a', id: '2' }) < 0 && M.byPerson({ bib: '10', name: 'a', id: '2' }, { bib: 'A1', name: 'a', id: '3' }) < 0 && M.byPerson({ bib: 'A1', name: 'z', id: '3' }, { bib: '', name: 'a', id: '4' }) < 0 && M.byPerson({ bib: '', name: 'a', id: '5' }, { bib: '', name: 'a', id: '6' }) < 0, 'M10 bib numbers in number order, then other bibs, then those with no bib by name');
}

/* ---------- M11 the send log ---------- */
{
  eq([M.whyOf(new Error('Request to a@b.co failed with 12345678 code')), M.whyOf('contact "x" <not found>'), M.whyOf({ message: 5 }), M.whyOf(null), M.whyOf(new Error('x'.repeat(500))).length, M.whyOf(new Error("it's `bad`"))], ['Request to [address] failed with # code', 'contact x not found', '', '', 80, 'its bad'], 'M11 a reason for the log has no address, long number, quote or tag in it, and is short');
  eq([M.resultVars({ status: 'fin', t: 540000, place: 3 }), M.resultVars({ status: 'dnf', t: 540000, place: 3 }), M.resultVars({ status: 'fin', t: 0, place: 0 }), M.resultVars(null)], [{ time: '1:30:00', place: '3rd' }, { time: '', place: '' }, { time: '', place: '' }, { time: '', place: '' }], 'M11 a time and place are only for a finisher');
  eq(M.STATUSES, ['sending', 'sent', 'failed', 'skipped'], 'M11 the states a message can be in');
}

/* ---------- M12 a CSV file ---------- */
{
  const INJ = ['=1+1', '+91 98765', '-5', '@SUM(A1)', '\t=1', '  =cmd|calc', '\r=1', '=HYPERLINK("http://evil","x")', '\u202e=1', '=\u0000'];
  ok(INJ.map((v) => M.csvCell(v)).every((c) => /^"'?[^=+\-@\s]/.test(c) || c === '"\'"' || /^"'[=+\-@]/.test(c) || /^"'/.test(c)) && M.csvCell('=1+1') === '"\'=1+1"' && M.csvCell('\t=1') === '"\'=1"' && M.csvCell('  =cmd|calc') === '"\'=cmd|calc"', 'M12 a cell that would start a formula (= + - @, even after spaces, a tab or a return) gets a quote in front');
  eq([M.csvCell('Asha "Ace" Rao'), M.csvCell('a,b'), M.csvCell('line\nbreak\r\nhere'), M.csvCell(null), M.csvCell(42), M.csvCell({}), M.csvCell('\u202e\u0000x'), M.csvCell('plain')], ['"Asha ""Ace"" Rao"', '"a,b"', '"line break  here"', '""', '"42"', '""', '"x"', '"plain"'], 'M12 every cell is quoted, a quote is doubled, line breaks become spaces, non-text is empty');
  eq(M.toCsv(['Name', 'Bib'], [['Asha', '12'], ['=x', '']]), '"Name","Bib"\r\n"Asha","12"\r\n"\'=x",""\r\n', 'M12 a file: a heading row and a line for each person, every line ended with a return and a line feed');
  eq(M.toCsv(['a'], []), '"a"\r\n', 'M12 a file with no rows is just the heading');
  eq([M.cleanCols(undefined), M.cleanCols(['email', 'name']), M.cleanCols(M.EXPORT_COLS).length], [['name', 'bib', 'cat', 'email'], ['email', 'name'], 9], 'M12 the columns of an export: the usual ones, or a list of known ones');
  eq([null, [], 'name', ['nope'], ['name', 'name'], [5], ['name', null], M.EXPORT_COLS.concat(['name']), { 0: 'name' }, ['__proto__'], ['constructor'], ['toString']].map((c) => throws(() => M.cleanCols(c))), [null, [], 'name', ['nope'], ['name', 'name'], [5], ['name', null], 'x', 'y', 'z', 'a', 'b'].map(() => 'bad_columns'), 'M12 a list with a column that is not known, twice, or no column is refused');
  ok(M.EXPORT_COLS.every((c) => typeof M.EXPORT_HEAD[c] === 'string') && Object.keys(M.EXPORT_HEAD).length === M.EXPORT_COLS.length, 'M12 every column has a heading');
}

/* ---------- M13 nothing throws ---------- */
{
  const fns = { oneLine: (h) => M.oneLine(h, 10), cleanBody: (h) => M.cleanBody(h, 10), safeCut: (h) => M.safeCut(h, 3), cleanEmail: M.cleanEmail, okCc: M.okCc, waNumber: (h) => M.waNumber(h, h), waLink: (h) => M.waLink(h, h), cleanLink: M.cleanLink, usedVars: M.usedVars, needsOf: M.needsOf, unknownVars: (h) => M.unknownVars(h, h), properName: M.properName, firstName: M.firstName, varsFor: (h) => M.varsFor(h, h), buildMessage: (h) => M.buildMessage(h, h, h), waText: M.waText, pickAudience: (h) => M.pickAudience(h, h, h), reachedBy: (h) => M.reachedBy(h, h, h), pieces: (h) => M.pieces([], h), audLabel: (h) => M.audLabel(h, h), whyOf: M.whyOf, resultVars: M.resultVars, csvCell: M.csvCell, toCsv: (h) => M.toCsv([h], [[h]]), okTplId: M.okTplId, byPerson: (h) => M.byPerson(h, h) };
  Object.keys(fns).forEach((k) => ok(noThrow(fns[k]), 'M13 ' + k + ' never throws, whatever it is given'));
  ok(['cleanTemplate', 'cleanSettings', 'cleanAud', 'cleanCols', 'cleanRaceLink'].every((k) => HOSTILE.every((h) => { try { M[k](h, h); return true; } catch (e) { return typeof e.message === 'string' && /^(bad_[a-z]+|unknown_placeholder)$/.test(e.message); } })), 'M13 every cleaner refuses with its own error and nothing else, whatever it is given');
}

done();
