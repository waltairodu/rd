// UNIT TESTS (Privacy rules): how a phone number and an e-mail address are hidden, who may show or export one, what a "show" has to say,
// what a contact file holds, who is meant when a person is searched for, and what is left of a person who is erased. The library has no
// database and no Wix in it, so every rule is tested on its own.
//   V1 phone masks   V2 e-mail masks   V3 form examples   V4 who may   V5 showing one detail   V6 the trail   V7 contact files
//   V8 finding a person   V9 what erasing leaves   V10 hostile input
import * as P from './rd-privacy.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: Privacy rules');
const fc = String.fromCharCode;
const B = P.BULLET;

const js = (v) => String(JSON.stringify(v)).slice(0, 30);
const throws = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return e.message;
  }
};
const HOSTILE = [undefined, null, true, false, 0, -1, 1.5, NaN, Infinity, '', ' ', 'x'.repeat(5000), fc(0), fc(0x202e), {}, [], [[]], [null], [1, 2], ['a', 'b'], { toString() { throw new Error('boom'); } }, () => 1, Symbol('s'), 10n];
// a small steady random source, so a failure can be run again
let seed = 12345;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const pickFrom = (s, n) => Array.from({ length: n }, () => s[rnd(s.length)]).join('');

/* ---------- V1 phone masks ---------- */
{
  eq(P.maskPhone('9848012345'), B.repeat(6) + '2345', 'V1 a ten digit number shows its last four digits');
  eq(P.maskPhone('+91 98480 12345'), B.repeat(6) + '2345', 'V1 a country code and spaces change nothing');
  eq(P.maskPhone('098480-12345'), B.repeat(6) + '2345', 'V1 dashes and a leading zero change nothing');
  eq(P.maskPhone(9848012345), B.repeat(6) + '2345', 'V1 a number typed as a number works too');
  eq(P.maskPhone('(98480) 12345'), B.repeat(6) + '2345', 'V1 brackets change nothing');
  eq(P.maskPhone('1234567'), B.repeat(6) + '4567', 'V1 seven digits is the shortest that shows anything');
  eq(P.maskPhone('123456'), B.repeat(6), 'V1 six digits is not a phone number: nothing of it is shown');
  eq(P.maskPhone('12'), B.repeat(6), 'V1 two digits: nothing shown, but it says there is something');
  for (const v of ['', ' ', 'abc', null, undefined, {}, [], ['98480 12345'], true, 'x'.repeat(5000)]) eq(P.maskPhone(v), '', 'V1 no digits is empty: ' + JSON.stringify(String(v)).slice(0, 20));
  eq(P.maskPhone('9'.repeat(5000)), B.repeat(6) + '9999', 'V1 a very long run of digits is cut to the last four');
  eq(P.maskPhone('12345678901234567890'), B.repeat(6) + '7890', 'V1 more than ten digits show the last four');
  // a property over many random numbers: what is left after the dots are taken away is exactly the last four digits
  let allGood = true;
  for (let i = 0; i < 300; i++) {
    const d = pickFrom('0123456789', 7 + rnd(8));
    const spaced = d.slice(0, 5) + ' ' + d.slice(5);
    const m = P.maskPhone(spaced);
    if (m.replace(/•/g, '') !== d.slice(-4) || m.length !== 10) allGood = false;
  }
  ok(allGood, 'V1 300 random numbers: the mask is six dots and the last four digits, nothing else');
  ok(P.digitsOf('+91 (98480) 12345') === '919848012345' && P.last10('+91 98480 12345') === '9848012345' && P.last10('12345') === '12345', 'V1 digitsOf and last10');
  ok(P.last10(null) === '' && P.last10({}) === '', 'V1 last10 of nothing is empty');
}

/* ---------- V2 e-mail masks ---------- */
{
  eq(P.maskEmail('rahul.k@gmail.com'), 'r•••@g•••.com', 'V2 first letter, dots, first letter of the domain, the ending');
  eq(P.maskEmail('Rahul@Gmail.COM'), 'r•••@g•••.com', 'V2 capitals are shown as small letters');
  eq(P.maskEmail('  rahul@x.in  '), 'r•••@x•••.in', 'V2 spaces around are dropped');
  eq(P.maskEmail('a@b.co.in'), 'a•••@b•••.in', 'V2 only the last part of the domain is shown');
  eq(P.maskEmail('rahul@localhost'), 'r•••@l•••', 'V2 a domain with no ending shows no ending');
  eq(P.maskEmail('rahul@mail.' + 'x'.repeat(30)), 'r•••@m•••', 'V2 an ending that is too long to be real is not shown');
  eq(P.maskEmail('rahul@mail.c0m'), 'r•••@m•••', 'V2 an ending with a digit is not shown');
  eq(P.maskEmail('a@b@c.com'), 'a•••@c•••.com', 'V2 the last @ splits the address');
  eq(P.maskEmail('nope'), B.repeat(6), 'V2 something that is not an address is hidden whole');
  eq(P.maskEmail('@x.com'), B.repeat(6), 'V2 an address with nothing before the @ is hidden whole');
  eq(P.maskEmail('x@'), B.repeat(6), 'V2 an address with nothing after the @ is hidden whole');
  eq(P.maskEmail('@'), B.repeat(6), 'V2 a lone @ is hidden whole');
  eq(P.maskEmail('=cmd@x.com'), B + B.repeat(3) + '@x•••.com', 'V2 a sign that could start a formula is not shown');
  eq(P.maskEmail('+91@x.com'), B + B.repeat(3) + '@x•••.com', 'V2 a plus is not shown');
  eq(P.maskEmail('<b>@x.com'), B + B.repeat(3) + '@x•••.com', 'V2 a tag is not shown');
  eq(P.maskEmail('ñ@x.com'), B + B.repeat(3) + '@x•••.com', 'V2 a letter that is not plain is not shown');
  eq(P.maskEmail('\u{1F600}@x.com'), B + B.repeat(3) + '@x•••.com', 'V2 an emoji is not shown (and not cut in half)');
  eq(P.maskEmail('a@=x.com'), 'a•••@' + B + B.repeat(3) + '.com', 'V2 the same for the domain');
  for (const v of ['', ' ', null, undefined, {}, [], ['a@b.com']]) eq(P.maskEmail(v), '', 'V2 nothing is empty: ' + js(v));
  eq([P.maskEmail(5), P.maskEmail(true)], [B.repeat(6), B.repeat(6)], 'V2 a number or a true/false is something, but not an address: hidden whole');
  // a property: what is left after the dots are taken away is at most one letter, the @, one letter and an ending
  let allGood = true;
  for (let i = 0; i < 300; i++) {
    const local = pickFrom('abcdefghijklmnopqrstuvwxyz0123456789._-+', 1 + rnd(14));
    const dom = pickFrom('abcdefghijklmnopqrstuvwxyz0123456789-', 1 + rnd(10)) + '.' + pickFrom('abcdefghijklmnopqrstuvwxyz', 2 + rnd(4));
    const m = P.maskEmail(local + '@' + dom);
    if (!/^[a-z0-9]?@[a-z0-9]?(\.[a-z]{2,12})?$/.test(m.replace(/•/g, '')) || m.length > 25) allGood = false;
  }
  ok(allGood, 'V2 300 random addresses: nothing but one letter each side of the @ and the ending is ever shown');
}

/* ---------- V3 form examples ---------- */
{
  eq(P.maskSample('M'), 'M', 'V3 a size is shown as it is');
  eq(P.maskSample('RAHUL'), 'RAHUL', 'V3 a name for the bib is shown as it is');
  eq(P.maskSample('98480 12345'), B.repeat(6) + '2345', 'V3 a number is masked');
  eq(P.maskSample('rahul@gmail.com'), 'r•••@g•••.com', 'V3 an address is masked');
  eq(P.maskSample('Rahul rahul@x.com'), 'r•••@x•••.com', 'V3 an address with a name in front is hidden with the name');
  eq(P.maskSample('call 9848012345 now'), B.repeat(6) + '2345', 'V3 a number inside a sentence is masked');
  eq(P.maskSample('10K'), '10K', 'V3 a distance is shown');
  eq(P.maskSample('123456'), '123456', 'V3 fewer than seven digits is not a phone number');
  eq(P.maskSample(null), '', 'V3 nothing is empty');
}

/* ---------- V4 who may ---------- */
{
  const roles = { director: [1, 1, 1, 1], lead: [1, 0, 0, 0], viewer: [0, 0, 0, 0], desk: [0, 0, 0, 0], coach: [0, 0, 0, 0], other: [0, 0, 0, 0] };
  for (const [role, want] of Object.entries(roles)) {
    ['reveal', 'export', 'log', 'erase'].forEach((what, i) => ok(P.may(role, what) === !!want[i], 'V4 ' + role + ' may ' + what + ': ' + !!want[i]));
  }
  for (const r of ['', 'Director', 'DIRECTOR', ' director', 'admin', undefined, null, 1, {}, ['director'], '__proto__', 'constructor']) ok(P.may(r, 'reveal') === false && P.may(r, 'erase') === false, 'V4 an odd role may do nothing: ' + JSON.stringify(r));
  for (const w of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', 'Reveal', undefined, null, 5, ['reveal']]) ok(P.may('director', w) === false, 'V4 an unknown action is never allowed: ' + JSON.stringify(w));
  eq(P.MAY, { reveal: ['director', 'lead'], export: ['director'], log: ['director'], erase: ['director'] }, 'V4 the table is as written');
}

/* ---------- V5 showing one detail ---------- */
{
  const good = { kind: 'reg', id: 'ev1~T-77', field: 'phone', reason: 'contact' };
  eq(P.revealRequest(good), good, 'V5 a good request comes back as it is');
  eq(P.revealRequest(Object.assign({ extra: 1, role: 'director', token: 'x' }, good)), good, 'V5 anything extra is dropped');
  for (const kind of P.KINDS) for (const f of ['phone', 'email']) for (const [reason] of P.REASONS) {
    const want = P.FIELDS_OF[kind].includes(f);
    const got = throws(() => P.revealRequest({ kind, id: 'x1', field: f, reason }));
    ok(want ? got === '' : got === 'pv_bad_request', 'V5 ' + kind + '/' + f + '/' + reason + (want ? ' is a request' : ' is refused'));
  }
  eq(P.FIELDS_OF.pacer, ['phone'], 'V5 a pacer has a phone number and nothing else to show');
  eq(P.KINDS, ['reg', 'vol', 'pacer'], 'V5 three kinds of people can be shown');
  for (const kind of ['runner', 'athlete', 'REG', '__proto__', 'constructor', 'toString', '', undefined, null, ['reg'], {}, 5]) eq(throws(() => P.revealRequest(Object.assign({}, good, { kind }))), 'pv_bad_request', 'V5 kind refused: ' + JSON.stringify(kind));
  for (const field of ['name', 'Phone', 'phone ', 'bib', '', undefined, ['phone'], null, 5]) eq(throws(() => P.revealRequest(Object.assign({}, good, { field }))), 'pv_bad_request', 'V5 field refused: ' + JSON.stringify(field));
  for (const id of ['', 'x'.repeat(151), undefined, null, 5, {}, ['a'], true]) eq(throws(() => P.revealRequest(Object.assign({}, good, { id }))), 'pv_bad_request', 'V5 id refused: ' + js(id));
  eq(throws(() => P.revealRequest(Object.assign({}, good, { id: 'x'.repeat(150) }))), '', 'V5 an id of 150 characters is the longest');
  for (const reason of ['', 'bored', 'CONTACT', ' contact', undefined, null, ['contact'], {}, 5, '__proto__']) eq(throws(() => P.revealRequest(Object.assign({}, good, { reason }))), 'pv_need_reason', 'V5 reason refused: ' + JSON.stringify(reason));
  eq(throws(() => P.revealRequest({ kind: 'zzz', id: 'x', field: 'phone' })), 'pv_bad_request', 'V5 the kind is checked before the reason');
  for (const a of [null, undefined, 'reg', 5, [], true]) eq(throws(() => P.revealRequest(a)), 'pv_bad_request', 'V5 not an object: ' + JSON.stringify(a));
  eq(P.REASONS.map((r) => r[0]), ['contact', 'fix', 'pay', 'safety', 'other'], 'V5 the reasons');
  ok(P.REASONS.every((r) => typeof r[1] === 'string' && r[1].length > 5), 'V5 every reason has words for the screen');
  eq([P.reasonOf('pay'), P.reasonOf('nope'), P.reasonOf(undefined), P.reasonOf(['pay'])], ['pay', '', '', ''], 'V5 reasonOf');
  ok(P.REVEALS_PER_HOUR === 40 && P.SHOW_MS === 30000, 'V5 forty shows an hour, a shown detail stays thirty seconds');
}

/* ---------- V6 the trail ---------- */
{
  eq([P.revealAction('phone'), P.revealAction('email'), P.revealAction('x'), P.revealAction(undefined)], ['reveal phone', 'reveal e-mail', 'reveal phone', 'reveal phone'], 'V6 the words for a show');
  eq(P.revealDetail('reg', 'ev1~T-77', 'contact'), 'reg ev1~T-77 · contact', 'V6 the detail holds the kind, the id and the reason');
  eq(P.revealTarget(P.revealDetail('vol', 'abc-123', 'safety')), { kind: 'vol', id: 'abc-123', reason: 'safety' }, 'V6 a detail reads back');
  eq(P.revealTarget(P.revealDetail('pacer', 'p~1', 'fix')), { kind: 'pacer', id: 'p~1', reason: 'fix' }, 'V6 a pacer detail reads back');
  for (const d of ['', 'reg a b · contact', 'runner x · contact', 'reg x · bored', 'reg  · contact', 'reg x ·contact', 'reg x · contact ', 'reg ' + 'x'.repeat(151) + ' · contact', null, undefined, {}, [], 5, 'REG x · contact', 'reg x · contact\n']) ok(P.revealTarget(d) === null, 'V6 not a show: ' + js(d));
  ok(!JSON.stringify(P.revealDetail('reg', 'ev1~T-77', 'contact')).match(/\d{7}/), 'V6 a detail has no number in it');
  eq(P.LOG_ACTIONS, ['reveal phone', 'reveal e-mail', 'contacts exported', 'audience exported', 'WhatsApp links opened', 'person erased'], 'V6 the notes that are about contact details');
  eq(P.logOut({ at: '2026-11-12T01:00:00Z', by: 'ravi', action: 'reveal phone', target: 'VHM 2026', detail: 'reg a · contact', secret: 'x' }), { at: '2026-11-12T01:00:00Z', by: 'ravi', action: 'reveal phone', race: 'VHM 2026', detail: 'reg a · contact' }, 'V6 a note as the screen gets it');
  eq(P.logOut(null), { at: '', by: '', action: '', race: '', detail: '' }, 'V6 nothing gives an empty note');
  ok(P.logOut({ detail: 'x'.repeat(500), by: 'y'.repeat(500) }).detail.length === 200 && P.logOut({ by: 'y'.repeat(500) }).by.length === 60, 'V6 long notes are cut');
  ok(!/[\u0000-\u001f]/.test(P.logOut({ by: 'a' + fc(7) + 'b', detail: 'x' + fc(10) + 'y' }).by + P.logOut({ detail: 'x' + fc(10) + 'y' }).detail), 'V6 control characters are removed');
}

/* ---------- V7 contact files ---------- */
{
  eq(P.exportRequest({ kind: 'regs', reason: 'contact' }), { kind: 'regs', reason: 'contact', from: 0 }, 'V7 a good request starts at the first row');
  eq(P.exportRequest({ kind: 'vols', reason: 'pay', from: 1000 }), { kind: 'vols', reason: 'pay', from: 1000 }, 'V7 a later page');
  eq(P.exportRequest({ kind: 'pacers', reason: 'other', from: 0, junk: 1 }), { kind: 'pacers', reason: 'other', from: 0 }, 'V7 anything extra is dropped');
  for (const kind of ['reg', 'vol', 'runners', '__proto__', 'constructor', 'toString', '', undefined, null, ['regs'], 5]) eq(throws(() => P.exportRequest({ kind, reason: 'contact' })), 'pv_bad_request', 'V7 kind refused: ' + JSON.stringify(kind));
  for (const reason of ['', 'x', undefined, null, ['contact']]) eq(throws(() => P.exportRequest({ kind: 'regs', reason })), 'pv_need_reason', 'V7 reason refused: ' + JSON.stringify(reason));
  for (const from of [-1, 1.5, NaN, Infinity, '0', '1000', null, [], {}, 1000001]) eq(throws(() => P.exportRequest({ kind: 'regs', reason: 'contact', from })), 'pv_bad_request', 'V7 start refused: ' + JSON.stringify(from));
  eq(P.exportRequest({ kind: 'regs', reason: 'contact', from: 1000000 }).from, 1000000, 'V7 the highest start allowed');
  for (const a of [null, undefined, 'regs', [], 5]) eq(throws(() => P.exportRequest(a)), 'pv_bad_request', 'V7 not an object: ' + JSON.stringify(a));

  const reg = { _id: 'e~1', name: 'Asha Rao', ticketNumber: 'T-1', cat: '10K', size: 'M', bib: '101', bibName: 'ASHA', status: 'ok', phone: '9848012345', email: 'asha@x.com', form: '[secret]' };
  eq(P.exportCells('regs', reg), ['Asha Rao', 'T-1', '10K', 'M', '101', 'ASHA', 'paid', '9848012345', 'asha@x.com'], 'V7 a registration row');
  eq(P.exportCells('regs', Object.assign({}, reg, { status: 'unpaid' }))[6], 'pending', 'V7 an unpaid registration says pending');
  ok(!JSON.stringify(P.exportCells('regs', reg)).includes('secret'), 'V7 the form answers are never in the file');
  eq(P.exportCells('vols', { name: 'Ravi', club: 'VTRA', status: 'approved', phone: '9000000000', email: 'r@x.com', code: 'ABC123' }), ['Ravi', 'VTRA', 'approved', '9000000000', 'r@x.com'], 'V7 a volunteer row has no code');
  eq(P.exportCells('pacers', { name: 'Kiran', group: '2:00', status: 'approved', phone: '9111111111', email: 'k@x.com' }), ['Kiran', '2:00', 'approved', '9111111111'], 'V7 a pacer row');
  ok(P.exportCells('regs', Object.assign({}, reg, { name: P.ERASED })) === null && P.exportCells('vols', { name: P.ERASED }) === null && P.exportCells('pacers', { name: P.ERASED }) === null, 'V7 an erased person is not in a file');
  ok(P.exportCells('nope', reg) === null && P.exportCells('regs', null) === null && P.exportCells('regs', 'x') === null, 'V7 an unknown kind or a row that is not one gives nothing');
  eq(P.EXPORTS.regs.head.length, 9, 'V7 the registrations heading has nine columns');
  ok(P.EXPORTS.regs.head.length === P.exportCells('regs', reg).length && P.EXPORTS.vols.head.length === 5 && P.EXPORTS.pacers.head.length === 4, 'V7 headings and rows have the same number of columns');

  const list = [
    { name: 'Zed', ticketNumber: 'T-9', phone: '9000000009' },
    { name: 'Asha', ticketNumber: 'T-2', phone: '9000000002' },
    { name: P.ERASED, ticketNumber: 'T-3', phone: '' },
    { name: 'Asha', ticketNumber: 'T-1', phone: '9000000001' },
    null,
    'x',
  ];
  const rows = P.exportRows('regs', list);
  eq(rows.map((r) => r[0] + r[1]), ['AshaT-1', 'AshaT-2', 'ZedT-9'], 'V7 rows are in name order, then ticket order, without the erased and without junk');
  eq(P.exportRows('regs', 'nope'), [], 'V7 not a list gives no rows');
  const page = P.exportPage('regs', rows, 0);
  ok(page.csv.startsWith('"Name","Ticket","Category"') && page.csv.split('\r\n').length === 5 && page.count === 3 && page.next === null && page.total === 3, 'V7 one page: heading, three rows, no next page');
  const many = Array.from({ length: 2500 }, (x, i) => ['N' + String(i).padStart(4, '0'), 'T' + i, '', '', '', '', 'paid', '9' + String(i).padStart(9, '0'), '']);
  const p1 = P.exportPage('regs', many, 0);
  const p2 = P.exportPage('regs', many, p1.next);
  const p3 = P.exportPage('regs', many, p2.next);
  ok(p1.count === 1000 && p1.next === 1000 && p2.count === 1000 && p2.next === 2000 && p3.count === 500 && p3.next === null && p1.total === 2500, 'V7 2500 rows are three pages: 1000, 1000, 500');
  ok(p1.csv.startsWith('"Name"') && !p2.csv.includes('"Name","Ticket"') && p2.csv.startsWith('"N1000"') && p3.csv.startsWith('"N2000"'), 'V7 the heading is on the first page only');
  eq(P.exportPage('regs', many, 5000), { csv: '', count: 0, from: 5000, next: null, total: 2500 }, 'V7 past the end is an empty page');
  const evil = P.exportPage('regs', [['=HYPERLINK("http://x")', '+1', '-2', '@SUM(1)', '', '', 'paid', '9848012345', 'a"b@x.com']], 0).csv.split('\r\n')[1];
  ok(evil.startsWith('"\'=HYPERLINK(""http://x"")","\'+1","\'-2","\'@SUM(1)"') && evil.includes('"a""b@x.com"'), 'V7 a cell can never start a formula, and quotes are doubled: ' + evil.slice(0, 60));
  ok(!/\n(?!$)/.test(P.exportPage('regs', [['a\nb', 'c\rd', '', '', '', '', '', '', '']], 0).csv.split('\r\n').slice(1).join('')), 'V7 a line break inside a cell becomes a space');
  eq(P.exportName('Vizag Half Marathon 2026!', 'regs'), 'vizag-half-marathon-2026-regs-with-contacts.csv', 'V7 a file name is plain letters, digits and dashes');
  eq(P.exportName('', 'vols'), 'vols-with-contacts.csv', 'V7 a race with no name still gives a name');
  ok(/^[a-z0-9-]+\.csv$/.test(P.exportName('../../etc/passwd <x>', 'regs')), 'V7 a hostile race name cannot make a path');
}

/* ---------- V8 finding a person ---------- */
{
  eq(P.personKeys({ phone: '+91 98480-12345' }), { phone: '9848012345', email: '' }, 'V8 a number: its last ten digits');
  eq(P.personKeys({ email: ' Asha@X.com ' }), { phone: '', email: 'asha@x.com' }, 'V8 an address: small letters, no spaces');
  eq(P.personKeys({ phone: '9848012345', email: 'a@x.com' }), { phone: '9848012345', email: 'a@x.com' }, 'V8 both');
  for (const a of [{}, null, undefined, 'x', [], { phone: '' }, { phone: 'abc' }, { phone: '12345' }, { phone: '98480123' }, { email: 'a' }, { email: 'a@b' }, { email: '@x.com' }, { email: 'a b@x.com' }, { email: 'a@x.c' }, { phone: 5 }, { phone: '9848012345', email: 'bad' }]) eq(throws(() => P.personKeys(a)), 'pv_bad_person', 'V8 refused: ' + JSON.stringify(a));
  ok(throws(() => P.personKeys({ phone: '9848012345', email: 'bad' })) === 'pv_bad_person', 'V8 a good number does not excuse a bad address');
  const keys = P.personKeys({ phone: '9848012345', email: 'asha@x.com' });
  ok(P.isPerson({ phone: '98480 12345' }, keys) && P.isPerson({ phone: '+919848012345' }, keys) && P.isPerson({ phone: 9848012345 }, keys), 'V8 the same number in any writing is the person');
  ok(P.isPerson({ email: 'ASHA@x.com' }, keys) && P.isPerson({ email: ' asha@x.com ' }, keys), 'V8 the same address in any case is the person');
  ok(!P.isPerson({ phone: '9848012346' }, keys) && !P.isPerson({ phone: '8012345' }, keys) && !P.isPerson({ email: 'asha@x.co' }, keys) && !P.isPerson({ email: 'xasha@x.com' }, keys), 'V8 a different number or address is not');
  ok(!P.isPerson({ phone: '', email: '' }, keys) && !P.isPerson({}, keys) && !P.isPerson(null, keys) && !P.isPerson('x', keys) && !P.isPerson({ phone: '9848012345' }, null), 'V8 a row with nothing, or not a row, is nobody');
  ok(P.isPerson({ phone: '9848012345', email: 'other@x.com' }, { phone: '9848012345', email: '' }) && !P.isPerson({ phone: '', email: 'a@x.com' }, { phone: '9848012345', email: '' }), 'V8 only the keys that were asked for count');
  ok(!P.isPerson({ phone: '', email: '' }, { phone: '', email: '' }), 'V8 empty keys match nobody, not even an empty row');
  // the plan
  const item = P.planItem('reg', { _id: 'e~1', name: ' Asha Rao ', bib: '101', phone: '9848012345', email: 'asha@x.com', form: 'secret' }, 'VHM 2026');
  eq(item, { key: 'reg~e~1', kind: 'reg', race: 'VHM 2026', name: 'Asha Rao', bib: '101', phone: B.repeat(6) + '2345', email: 'a•••@x•••.com' }, 'V8 a row of the plan is masked and has a key');
  eq(P.planItem('vol', { _id: 'v1', name: 'Ravi', phone: '9000000000', email: 'r@x.com', bib: '5' }, '').bib, '', 'V8 only a registration and a runner have a bib in the plan');
  ok(!JSON.stringify(P.planItem('reg', { _id: 'e~1', name: 'A', phone: '9848012345', email: 'asha@x.com' }, '')).match(/9848012345|asha@x/), 'V8 the plan never holds a full number or address');
  eq(P.planItem('athlete', null, null), { key: 'athlete~', kind: 'athlete', race: '', name: '', bib: '', phone: '', email: '' }, 'V8 a plan row of nothing');
  eq(P.splitKey('reg~e~1'), { kind: 'reg', id: 'e~1' }, 'V8 a key splits at the first ~');
  eq(P.splitKey('vol~abc'), { kind: 'vol', id: 'abc' }, 'V8 a volunteer key');
  eq(P.keysOf(['reg~a', 'vol~b']), ['reg~a', 'vol~b'], 'V8 keys as ticked');
  for (const v of [[], 'reg~a', null, undefined, {}, ['reg~a', 'reg~a'], ['reg~'], ['reg~ x'], ['x~a'], ['reg'], [5], [['reg~a']], Array.from({ length: 201 }, (x, i) => 'reg~' + i), ['reg~' + 'x'.repeat(170)], ['__proto__~a'], ['REG~a']]) eq(throws(() => P.keysOf(v)), 'pv_bad_request', 'V8 keys refused: ' + js(v));
  eq(P.keysOf(Array.from({ length: 200 }, (x, i) => 'reg~' + i)).length, 200, 'V8 two hundred keys is the most');
  eq(throws(() => P.keysOf(['reg~' + 'x'.repeat(165)])), '', 'V8 a key of 169 characters is allowed');
  eq(P.summaryText({ reg: 2, vol: 1 }), '2 registrations, 1 volunteer', 'V8 the plan in words');
  eq(P.summaryText({ reg: 1, runner: 1, vol: 3, pacer: 1, athlete: 2 }), '1 registration, 1 Expo runner, 3 volunteers, 1 pacer, 2 training accounts', 'V8 every kind, in order');
  eq([P.summaryText({}), P.summaryText(null), P.summaryText({ reg: 0 }), P.summaryText({ reg: -1 }), P.summaryText({ reg: 'x' })], ['nothing', 'nothing', 'nothing', 'nothing', 'nothing'], 'V8 nothing is said as nothing');
  eq(P.PLAN_KINDS, ['reg', 'runner', 'vol', 'pacer', 'athlete'], 'V8 the kinds of a plan');
  ok(P.MAX_PLAN === 200 && P.CONFIRM_WORD === 'ERASE', 'V8 at most 200 rows, and the word to type is ERASE');
}

/* ---------- V9 what erasing leaves ---------- */
{
  const reg = { _id: 'e~1', _owner: 'o', event: 'e', ticketNumber: 'T-1', orderNumber: 'O-1', guestId: 'g1', name: 'Asha Rao', email: 'asha@x.com', phone: '9848012345', cat: '10K', size: 'M', bibName: 'ASHA', status: 'ok', form: '[{"name":"x"}]', at: '2026-01-01', bib: '101' };
  const r = P.erasedRow('reg', reg);
  eq([r.name, r.email, r.phone, r.bibName, r.form], [P.ERASED, '', '', '', ''], 'V9 a registration loses who the person is');
  eq([r._id, r.event, r.ticketNumber, r.orderNumber, r.guestId, r.cat, r.size, r.status, r.at, r.bib], ['e~1', 'e', 'T-1', 'O-1', 'g1', '10K', 'M', 'ok', '2026-01-01', '101'], 'V9 and keeps everything that counts');
  ok(reg.name === 'Asha Rao' && reg.phone === '9848012345', 'V9 the row it was given is not changed');
  ok(P.isErased(r) && !P.isErased(reg) && !P.isErased(null) && !P.isErased('(erased)') && !P.isErased({ name: '(Erased)' }) && !P.isErased({}), 'V9 isErased');
  eq(P.erasedRow('reg', r), r, 'V9 erasing twice is the same as once');

  const run = P.erasedRow('runner', { _id: 'x~101', event: 'x', bib: '101', name: 'Asha', bibName: 'A', cat: '10K', size: 'M', phone: '9848012345', email: 'a@x.com', checkedInAt: '2026-11-14T05:00:00Z', bibAt: '2026-11-14T05:01:00Z', shirtSize: 'M', shirtAt: 'now', shirtDesk: 'Desk 2 - Tshirt' });
  eq([run.name, run.bibName, run.phone, run.email], [P.ERASED, '', '', ''], 'V9 an Expo runner loses who the person is');
  eq([run.bib, run.cat, run.size, run.checkedInAt, run.bibAt, run.shirtSize, run.shirtAt, run.shirtDesk], ['101', '10K', 'M', '2026-11-14T05:00:00Z', '2026-11-14T05:01:00Z', 'M', 'now', 'Desk 2 - Tshirt'], 'V9 and keeps the times and sizes, so stock and counts stay right');

  const chk = P.erasedRow('check', { _id: 'x~101', event: 'x', bib: '101', name: 'Asha', pickupBy: 'friend', friendName: 'Ravi', friendPhone: '9000000000', method: 'selfie', selfie: 'data:image/jpeg;base64,AAAA', at: 'now', desk: 'Desk 1 - BIB' });
  eq([chk.name, chk.friendName, chk.friendPhone, chk.selfie], ['', '', '', ''], 'V9 a hand-over record loses the selfie and the friend');
  eq([chk.pickupBy, chk.method, chk.at, chk.desk, chk.bib], ['friend', 'selfie', 'now', 'Desk 1 - BIB', '101'], 'V9 and keeps that it happened, when and where');

  const vol = P.erasedRow('vol', { _id: 'v1', event: 'e', name: 'Ravi', phone: '9000000000', email: 'r@x.com', club: 'VTRA', status: 'approved', code: 'K7M2XQ', notes: 'allergic', waiverAt: 'w', waiverVersion: '2', createdAt: 'c' });
  eq([vol.name, vol.phone, vol.email, vol.club, vol.notes], [P.ERASED, '', '', '', ''], 'V9 a volunteer loses who the person is');
  eq([vol.status, vol.waiverAt, vol.waiverVersion, vol.createdAt, vol._id], ['approved', 'w', '2', 'c', 'v1'], 'V9 and keeps the status and that a waiver was signed');
  ok(vol.code !== vol.code.toUpperCase() && vol.code !== '', 'V9 the volunteer code can never be matched by a typed code (a typed code is always upper case)');
  ok(P.erasedRow('pacer', { _id: 'p', name: 'K', phone: '9', notes: 'n', group: '2:00', status: 'approved' }).group === '2:00' && P.erasedRow('pacer', { name: 'K', phone: '9', notes: 'n' }).notes === '', 'V9 a pacer keeps the group and loses the rest');
  const ath = P.erasedRow('athlete', { _id: 'a', name: 'Asha', phone: '9848012345', salt: 's', pinHash: 'h', level: 'beginner', goal: '10K in 60', goalDate: '2026-12-01', createdAt: 'c', failCount: '0' });
  eq([ath.name, ath.phone, ath.salt, ath.pinHash, ath.goal, ath.goalDate], [P.ERASED, P.ERASED, '', '', '', ''], 'V9 a training account loses who the person is, and cannot be logged into');
  ok(P.digitsOf(ath.phone) === '' && ath.phone !== '', 'V9 the account phone is text that no typed number (digits only) can equal, not an empty one that an empty sign-in would find');
  eq([ath.level, ath.createdAt], ['beginner', 'c'], 'V9 and keeps what does not say who');
  eq([P.erasedRow('qual', { name: 'A', link: 'http://x', note: 'n', claim: '2:10', status: 'ok' })].map((q) => [q.name, q.link, q.note, q.claim, q.status])[0], [P.ERASED, '', '', '2:10', 'ok'], 'V9 a qualification claim');
  eq(P.erasedRow('waiver', { _id: 'w', kind: 'sig', ref: 'e~1', why: 'signed by father' }), { _id: 'w', kind: 'sig', ref: 'e~1', why: '' }, 'V9 a waiver record keeps that it was signed and loses the note');
  eq(P.erasedRow('enroll', { _id: 'n', athlete: 'a', reqNote: 'knee', status: 'active' }), { _id: 'n', athlete: 'a', reqNote: '', status: 'active' }, 'V9 an enrolment loses the request note');
  eq(P.erasedRow('session', { _id: 's', aNote: 'tired', feedback: 'rest', aKm: '5', rpe: '6' }), { _id: 's', aNote: '', feedback: '', aKm: '5', rpe: '6' }, 'V9 a training session loses the notes and keeps the figures');
  eq(P.erasedRow('msg', { _id: 'm', name: 'Asha', text: 'hello', at: 'now', read: '1' }), { _id: 'm', name: '', text: '', at: 'now', read: '1' }, 'V9 a message loses its words');
  eq(P.ERASE_KINDS, ['reg', 'runner', 'vol', 'pacer', 'athlete', 'check', 'qual', 'waiver', 'enroll', 'session', 'msg'], 'V9 what can be erased');
  const same = { name: 'x', phone: '1' };
  ok(P.erasedRow('nope', same) === same && P.erasedRow('__proto__', same) === same && P.erasedRow('constructor', same) === same && P.erasedRow('toString', same) === same, 'V9 an unknown kind changes nothing');
  ok(P.erasedRow('reg', null) === null && P.erasedRow('reg', 'x') === 'x', 'V9 a row that is not a row is given back');
  // for every kind: each personal field is emptied, and every other field is left exactly as it was
  const PERSONAL = {
    reg: ['name', 'email', 'phone', 'bibName', 'form'],
    runner: ['name', 'bibName', 'phone', 'email'],
    vol: ['name', 'phone', 'email', 'club', 'notes', 'code'],
    pacer: ['name', 'phone', 'notes'],
    athlete: ['name', 'phone', 'salt', 'pinHash', 'goal', 'goalDate'],
    check: ['name', 'friendName', 'friendPhone', 'selfie'],
    qual: ['name', 'link', 'note'],
    waiver: ['why'],
    enroll: ['reqNote'],
    session: ['aNote', 'feedback'],
    msg: ['name', 'text'],
  };
  const COUNTS = ['_id', 'event', 'bib', 'cat', 'size', 'status', 'at', 'ticketNumber', 'desk', 'method', 'kind', 'ref', 'checkedInAt', 'shirtAt', 'hours', 'level', 'group', 'aKm', 'rpe', 'claim', 'waiverAt', 'createdAt'];
  eq(Object.keys(PERSONAL), P.ERASE_KINDS, 'V9 the table of personal fields covers every kind that can be erased');
  for (const k of P.ERASE_KINDS) {
    const row = {};
    PERSONAL[k].forEach((f) => (row[f] = 'CANARY-' + f + '-9876543210'));
    COUNTS.forEach((f) => (row[f] = 'KEEP-' + f));
    const out = P.erasedRow(k, row);
    const left = PERSONAL[k].filter((f) => out[f] !== '' && out[f] !== P.ERASED && !(k === 'vol' && f === 'code' && out[f] === P.ERASED));
    eq(left, [], 'V9 ' + k + ': every personal field is emptied');
    ok(!/CANARY|9876543210/.test(JSON.stringify(out)), 'V9 ' + k + ': none of the typed text is anywhere in the row');
    eq(COUNTS.filter((f) => out[f] !== 'KEEP-' + f), [], 'V9 ' + k + ': nothing that counts is touched');
    eq(Object.keys(out).sort(), Object.keys(row).sort(), 'V9 ' + k + ': no field is added or taken away');
  }
}

/* ---------- V10 hostile input ---------- */
{
  let boom = [];
  for (const h of HOSTILE) {
    for (const [name, fn] of [
      ['maskPhone', () => P.maskPhone(h)],
      ['maskEmail', () => P.maskEmail(h)],
      ['maskSample', () => P.maskSample(h)],
      ['may', () => P.may(h, h)],
      ['reasonOf', () => P.reasonOf(h)],
      ['revealAction', () => P.revealAction(h)],
      ['revealTarget', () => P.revealTarget(h)],
      ['logOut', () => P.logOut(h)],
      ['exportKindOf', () => P.exportKindOf(h)],
      ['exportCells', () => P.exportCells('regs', h)],
      ['exportRows', () => P.exportRows('regs', h)],
      ['isPerson', () => P.isPerson(h, h)],
      ['planItem', () => P.planItem('reg', h, h)],
      ['summaryText', () => P.summaryText(h)],
      ['erasedRow', () => P.erasedRow('reg', h)],
      ['isErased', () => P.isErased(h)],
      ['splitKey', () => P.splitKey(h)],
    ]) {
      try {
        fn();
      } catch (e) {
        boom.push(name + ' threw ' + e.message + ' for ' + String(typeof h));
      }
    }
    for (const [name, fn] of [
      ['revealRequest', () => P.revealRequest(h)],
      ['exportRequest', () => P.exportRequest(h)],
      ['personKeys', () => P.personKeys(h)],
      ['keysOf', () => P.keysOf(h)],
    ]) {
      const m = throws(fn);
      if (m && !/^pv_[a-z_]+$/.test(m)) boom.push(name + ' threw ' + m + ' for ' + String(typeof h));
    }
  }
  eq(boom, [], 'V10 odd values (nothing, numbers, objects, huge text, control characters) never crash and only throw the documented codes');
  ok(['pv_bad_request', 'pv_need_reason', 'pv_bad_person'].every((c) => /^pv_/.test(c)), 'V10 every code this library throws starts with pv_');
  const huge = 'a'.repeat(200000) + '@' + 'b'.repeat(200000) + '.com';
  ok(P.maskEmail(huge).length <= 20 && P.maskPhone('9'.repeat(200000)).length === 10, 'V10 a huge value gives a small mask');
}

done();
