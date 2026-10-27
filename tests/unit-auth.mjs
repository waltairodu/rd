// UNIT TESTS: wix/director/rd-auth.js on its own (no database, no Wix): SHA-256, password hashing and checking,
// session tokens, generated PINs and passwords, which role a staff row has, and the three Expo desks.
import crypto from 'node:crypto';
import * as A from './rd-auth.test.mjs';
import wd from 'wix-data';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: login module');

/* ---------- SHA-256 against Node's own implementation ---------- */
const nodeSha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const vectors = ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'a'.repeat(1000), 'ప్రశాంత్', 'రన్నర్ 🏃‍♂️ 5K', 'tab\tnewline\nnull\u0000end', 'é'.repeat(40)];
let shaOk = 0;
for (const v of vectors) if (A.sha256(v) === nodeSha(v)) shaOk++;
ok(shaOk === vectors.length, 'sha256 matches Node crypto on ' + vectors.length + ' fixed vectors (empty, ASCII, long, Telugu, emoji, control characters)');
let edge = 0;
let edgeTotal = 0;
for (let n = 0; n <= 200; n++) {
  edgeTotal++;
  if (A.sha256('x'.repeat(n)) === nodeSha('x'.repeat(n))) edge++;
}
ok(edge === edgeTotal, 'sha256 matches Node crypto for every length 0 to 200 (covers the 55/56/63/64/65 byte padding edges): ' + edge + '/' + edgeTotal);
let rnd = 0;
for (let n = 0; n < 150; n++) {
  const s = crypto.randomBytes(1 + (n % 90)).toString('base64');
  if (A.sha256(s) === nodeSha(s)) rnd++;
}
ok(rnd === 150, 'sha256 matches Node crypto on 150 random strings');
ok(A.sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256("abc") is the published test vector');
ok(A.sha256('\ud800A') !== A.sha256('⑁'), 'a lone surrogate followed by a letter does not collide with another character');
ok(typeof A.sha256(12345) === 'string' && A.sha256(12345) === nodeSha('12345'), 'sha256 of a number hashes its text');

/* ---------- hashing and checking ---------- */
const h = A.hashPassword('Tr@il-Runner7');
ok(/^h1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(h), 'hash looks like h1$<16 hex salt>$<64 hex>: ' + h.slice(0, 12) + '…');
ok(!h.includes('Tr@il-Runner7'), 'the hash does not contain the password');
ok(A.isHashed(h), 'isHashed recognises a hash');
ok(A.checkPassword(h, 'Tr@il-Runner7'), 'right password passes');
ok(!A.checkPassword(h, 'Tr@il-Runner8'), 'wrong password fails');
ok(!A.checkPassword(h, 'tr@il-runner7'), 'passwords are case sensitive');
ok(!A.checkPassword(h, ' Tr@il-Runner7'), 'a leading space is part of the password');
ok(!A.checkPassword(h, 'Tr@il-Runner7 '), 'a trailing space is part of the password');
ok(!A.checkPassword(h, ''), 'empty typed password fails');
ok(!A.checkPassword(h, null) && !A.checkPassword(h, undefined), 'null and undefined typed passwords fail');
ok(!A.checkPassword('', 'x') && !A.checkPassword(null, 'x') && !A.checkPassword(undefined, 'x'), 'an empty stored password never matches anything');
ok(!A.checkPassword('', '') && !A.checkPassword(null, null), 'empty against empty does not match either');
const h2 = A.hashPassword('Tr@il-Runner7');
ok(h !== h2, 'the same password hashes differently each time (random salt)');
ok(A.checkPassword(h2, 'Tr@il-Runner7'), 'both hashes still accept the password');
const salts = new Set();
for (let k = 0; k < 200; k++) salts.add(A.hashPassword('x').split('$')[1]);
ok(salts.size === 200, '200 hashes use 200 different salts');
const parts = h.split('$');
const flipped = parts[0] + '$' + parts[1] + '$' + (parts[2][0] === '0' ? '1' : '0') + parts[2].slice(1);
ok(!A.checkPassword(flipped, 'Tr@il-Runner7'), 'a hash with one changed character accepts nothing');
const saltFlip = parts[0] + '$' + (parts[1][0] === '0' ? '1' : '0') + parts[1].slice(1) + '$' + parts[2];
ok(!A.checkPassword(saltFlip, 'Tr@il-Runner7'), 'a hash with a changed salt accepts nothing');
ok(!A.checkPassword(h, h), 'typing the stored hash itself is not a password');
ok(!A.checkPassword(parts[2], 'Tr@il-Runner7'), 'a bare 64-digit hash (no h1$ prefix) is treated as plain text, so the real password fails');
ok(A.checkPassword(parts[2], parts[2]), '  (and as plain text it only matches itself)');
const uni = 'పరుగు-2026-🏃';
ok(A.checkPassword(A.hashPassword(uni), uni), 'a Telugu and emoji password round-trips');
ok(!A.checkPassword(A.hashPassword(uni), 'పరుగు-2026'), '  and a shortened version fails');
const long200 = 'p'.repeat(200);
ok(A.checkPassword(A.hashPassword(long200), long200), 'a 200-character password is accepted (the limit)');
ok(!A.checkPassword(A.hashPassword(long200), long200 + 'p'), 'a 201-character password is refused outright');
const big = 'x'.repeat(2000000);
const t0 = Date.now();
ok(!A.checkPassword(h, big), 'a two-million-character "password" is refused');
ok(Date.now() - t0 < 100, '  at once, without hashing it (took ' + (Date.now() - t0) + ' ms)');
ok(A.checkPassword(A.hashPassword('12345678'), '12345678'), 'digits-only password works');
ok(A.checkPassword(A.hashPassword(12345678), '12345678'), 'a number given to hashPassword is treated as its text');
ok(A.MAX_PASSWORD === 200, 'MAX_PASSWORD is 200');

/* ---------- plain-text values typed into the CMS by hand ---------- */
ok(A.checkPassword('desk-pass-1', 'desk-pass-1'), 'a legacy plain-text password still works');
ok(!A.checkPassword('desk-pass-1', 'desk-pass-2'), '  and a wrong one does not');
ok(!A.checkPassword('desk-pass-1', 'DESK-PASS-1'), '  and it is case sensitive');
ok(A.needsUpgrade('desk-pass-1'), 'a plain-text password is marked for upgrade');
ok(!A.needsUpgrade(h), 'a hash is not');
ok(!A.needsUpgrade('') && !A.needsUpgrade(null) && !A.needsUpgrade(undefined), 'an empty password is not "upgraded" into a hash');
ok(A.checkPassword('h1$short', 'h1$short'), 'something that merely starts with h1$ but is not a hash is plain text');
ok(!A.isHashed('h1$0123456789ABCDEF$' + '0'.repeat(64)), 'upper-case hex is not a valid hash');
ok(!A.isHashed('h1$0123456789abcdef$' + '0'.repeat(63)), 'a short hash is not valid');
ok(!A.isHashed('h1$0123456789abcdef$' + '0'.repeat(65)), 'a long hash is not valid');
ok(!A.isHashed('h2$0123456789abcdef$' + '0'.repeat(64)), 'another version prefix is not valid');
ok(!A.isHashed('h1$0123456789abcde$' + '0'.repeat(64)), 'a short salt is not valid');
ok(!A.isHashed('x' + h) && !A.isHashed(h + 'x') && !A.isHashed(h + '\n'), 'extra characters around a hash make it not a hash (anchored)');
ok(!A.isHashed(null) && !A.isHashed(undefined) && !A.isHashed(''), 'isHashed copes with null, undefined and empty');
ok(A.isHashed('h1$0123456789abcdef$' + '0'.repeat(64)), 'the dummy hash used for unknown usernames is itself a valid hash shape');

/* ---------- same() ---------- */
ok(A.same('abc', 'abc'), 'same: equal strings');
ok(!A.same('abc', 'abd'), 'same: last character differs');
ok(!A.same('abc', 'xbc'), 'same: first character differs');
ok(!A.same('abc', 'abcd') && !A.same('abcd', 'abc'), 'same: different lengths');
ok(!A.same('', 'a') && A.same('', ''), 'same: empty strings');
ok(A.same(123, '123'), 'same: numbers are compared as text');
ok(!A.same('a\u0000', 'a'), 'same: a trailing NUL is a difference');

/* ---------- tokens ---------- */
const toks = new Set();
for (let k = 0; k < 3000; k++) toks.add(A.newToken());
ok(toks.size === 3000, '3000 tokens are all different');
ok([...toks].every((t) => /^[0-9a-f]{64}$/.test(t)), 'every token is 64 hex characters (256 bits)');
const firstChars = {};
[...toks].forEach((t) => (firstChars[t[0]] = (firstChars[t[0]] || 0) + 1));
ok(Object.keys(firstChars).length === 16 && Object.values(firstChars).every((n) => n > 3000 / 16 / 2 && n < (3000 / 16) * 2), 'token characters are spread evenly (no hex digit under half or over double its share)');
const tokA = A.newToken();
const tokB = A.newToken();
let shared = 0;
for (let k = 0; k < 64; k++) if (tokA[k] === tokB[k]) shared++;
ok(shared < 20, 'two tokens in a row are unrelated (' + shared + ' of 64 characters equal; chance level is 4)');

/* ---------- PINs ---------- */
const pins = [];
for (let k = 0; k < 4000; k++) pins.push(A.genPin());
ok(pins.every((p) => /^[1-9][0-9]{5}$/.test(p)), 'every default PIN is 6 digits and never starts with 0');
const digitCount = new Array(10).fill(0);
pins.forEach((p) => [...p.slice(1)].forEach((d) => digitCount[+d]++));
const perDigit = (pins.length * 5) / 10;
ok(digitCount.every((n) => n > perDigit * 0.9 && n < perDigit * 1.1), 'PIN digits after the first are evenly spread (each digit within 10% of its share)');
const lead = new Array(10).fill(0);
pins.forEach((p) => lead[+p[0]]++);
ok(lead[0] === 0 && lead.slice(1).every((n) => n > (pins.length / 9) * 0.8 && n < (pins.length / 9) * 1.2), 'the first PIN digit is 1 to 9, evenly');
ok(new Set(pins).size > 3900, 'almost all of 4000 PINs are different (' + new Set(pins).size + ')');
ok(A.genPin(4).length === 4 && A.genPin(10).length === 10, 'PIN lengths 4 and 10 are honoured');
ok(A.genPin(2).length === 4 && A.genPin(99).length === 10, 'PIN length is held between 4 and 10');
ok(A.genPin(0).length === 6 && A.genPin(undefined).length === 6 && A.genPin(NaN).length === 6, 'a missing PIN length gives 6');
ok(A.genPin(8).length === 8 && /^\d+$/.test(A.genPin(8)), 'an 8-digit PIN is all digits');

/* ---------- generated passwords ---------- */
const pws = [];
for (let k = 0; k < 2000; k++) pws.push(A.genPassword());
ok(pws.every((p) => p.length === 10), 'default password is 10 characters');
ok(pws.every((p) => !/[0OIl1o]/.test(p)), 'no look-alike characters (0 O o I l 1) in 2000 passwords');
ok(pws.every((p) => /^[A-Za-z2-9]+$/.test(p)), 'only letters and the digits 2 to 9');
ok(pws.some((p) => /[A-Z]/.test(p)) && pws.some((p) => /[a-z]/.test(p)) && pws.some((p) => /[2-9]/.test(p)), 'upper, lower and digits all occur');
ok(new Set(pws).size === 2000, '2000 passwords are all different');
ok(A.genPassword(8).length === 8 && A.genPassword(32).length === 32, 'password lengths 8 and 32 are honoured');
ok(A.genPassword(3).length === 8 && A.genPassword(500).length === 32, 'password length is held between 8 and 32');
const ch = {};
pws.forEach((p) => [...p].forEach((c) => (ch[c] = (ch[c] || 0) + 1)));
const chv = Object.values(ch);
ok(chv.length === 54 && Math.max(...chv) < Math.min(...chv) * 1.35, 'all 54 password characters are used about equally (max/min ' + (Math.max(...chv) / Math.min(...chv)).toFixed(2) + ')');

/* ---------- which role a staff row has ---------- */
const kindCases = [
  ['admin', 'director'], ['director', 'director'], ['ADMIN', 'director'], ['Director', 'director'], ['  admin  ', 'director'],
  ['lead', 'lead'], ['Lead', 'lead'], ['viewer', 'viewer'], ['VIEWER', 'viewer'], ['coach', 'coach'], ['Coach ', 'coach'],
  ['desk', 'desk'], ['Desk', 'desk'], ['', 'desk'], ['   ', 'desk'],
  ['volunteer', 'other'], ['root', 'other'], ['superuser', 'other'], ['administrator', 'other'], ['admin;', 'other'], ['ad min', 'other'], ['desk2', 'other'], ['directors', 'other'], ['admin\u0000', 'other'],
];
let kindOk = 0;
for (const [r, want] of kindCases) if (A.kindOf({ role: r }) === want) kindOk++;
ok(kindOk === kindCases.length, 'kindOf: ' + kindCases.length + ' role spellings sort into the right kind (' + kindOk + ' right)');
ok(A.kindOf({ Role: 'admin' }) === 'director', 'kindOf reads a capital-R Role column too');
ok(A.kindOf({}) === 'desk' && A.kindOf({ role: null }) === 'desk' && A.kindOf({ role: undefined }) === 'desk', 'a row with no role is a desk login (old hand-made rows)');
ok(A.kindOf(null) === 'desk' && A.kindOf(undefined) === 'desk', 'kindOf(null) does not crash');
ok(A.kindOf({ role: 0 }) === 'desk' && A.kindOf({ role: false }) === 'desk', 'a falsy role counts as no role');
ok(A.kindOf({ role: 1 }) === 'other' && A.kindOf({ role: true }) === 'other', 'a truthy non-word role is refused everywhere');
ok(A.kindOf({ role: ['admin'] }) === 'director', 'an array role is read as its text (one entry); the Team screen never writes one');
ok(A.kindOf({ role: { toString: () => 'admin' } }) === 'director' || A.kindOf({ role: { toString: () => 'admin' } }) === 'other', 'an object role does not crash');
ok(A.unameOf({ username: 'asha', title: 'old' }) === 'asha', 'unameOf prefers the username column');
ok(A.unameOf({ title: 'asha' }) === 'asha' && A.unameOf({ username: '', title: 'asha' }) === 'asha', 'unameOf falls back to the Title column');

/* ---------- desks ---------- */
eq(A.DESKS, ['Desk 1 - BIB', 'Desk 2 - Tshirt', 'Desk 3 - Misc'], 'the three desks');
const canon = [
  ['1', 'Desk 1 - BIB'], ['2', 'Desk 2 - Tshirt'], ['3', 'Desk 3 - Misc'], ['Desk 1', 'Desk 1 - BIB'], ['desk1', 'Desk 1 - BIB'], ['DESK 2', 'Desk 2 - Tshirt'],
  ['Desk 1 - BIB', 'Desk 1 - BIB'], ['Desk 2 - Tshirt', 'Desk 2 - Tshirt'], ['Desk 3 - Misc', 'Desk 3 - Misc'], ['desk 3 misc', 'Desk 3 - Misc'],
  ['bib', 'Desk 1 - BIB'], ['BIB', 'Desk 1 - BIB'], ['tshirt', 'Desk 2 - Tshirt'], ['T-shirt', 'Desk 2 - Tshirt'], ['t shirt', 'Desk 2 - Tshirt'], ['misc', 'Desk 3 - Misc'],
  ['4', ''], ['0', ''], ['Desk 4', ''], ['desk', ''], ['', ''], ['   ', ''], ['xyz', ''], ['finish line', ''],
];
let canonOk = 0;
for (const [i, want] of canon) if (A.canonDesk(i) === want) canonOk++;
ok(canonOk === canon.length, 'canonDesk: ' + canon.length + ' spellings (' + canonOk + ' right)');
ok(A.canonDesk(null) === '' && A.canonDesk(undefined) === '' && A.canonDesk({}) === '', 'canonDesk copes with null, undefined and objects');
ok(A.canonDesk(1) === 'Desk 1 - BIB' && A.canonDesk(2) === 'Desk 2 - Tshirt', 'canonDesk reads a number');
eq(A.parseDesks('Desk 1 - BIB,Desk 2 - Tshirt'), ['Desk 1 - BIB', 'Desk 2 - Tshirt'], 'parseDesks: comma list of full names');
eq(A.parseDesks('1, 2'), ['Desk 1 - BIB', 'Desk 2 - Tshirt'], 'parseDesks: loose "1, 2"');
eq(A.parseDesks('3,1'), ['Desk 3 - Misc', 'Desk 1 - BIB'], 'parseDesks keeps the written order');
eq(A.parseDesks('1,1,Desk 1,bib'), ['Desk 1 - BIB'], 'parseDesks drops repeats');
eq(A.parseDesks('1, nonsense, 2'), ['Desk 1 - BIB', 'Desk 2 - Tshirt'], 'parseDesks skips what it cannot read');
eq(A.parseDesks(['2', 'Desk 3']), ['Desk 2 - Tshirt', 'Desk 3 - Misc'], 'parseDesks: an array');
eq(A.parseDesks(''), [], 'parseDesks: empty text');
eq(A.parseDesks(null), [], 'parseDesks: null');
eq(A.parseDesks(undefined), [], 'parseDesks: undefined');
eq(A.parseDesks('nonsense'), [], 'parseDesks: nothing readable');
eq(A.deskList(''), A.DESKS, 'deskList: none written means all three');
eq(A.deskList('nonsense'), A.DESKS, 'deskList: nothing readable means all three');
eq(A.deskList('2'), ['Desk 2 - Tshirt'], 'deskList: one written desk is the only one');
eq(A.deskList(null), A.DESKS, 'deskList: null means all three');
const dl = A.deskList('');
dl.push('hack');
ok(A.DESKS.length === 3 && A.deskList('').length === 3, 'deskList hands out a copy, so changing it does not change the real list');
ok(A.deskValueOf({ desks: '1,2', desk: '3' }) === '1,2', 'deskValueOf prefers the desks column');
ok(A.deskValueOf({ desk: '3' }) === '3' && A.deskValueOf({ desks: '', desk: '3' }) === '3', 'deskValueOf falls back to a column called desk');
ok(A.deskValueOf({}) === undefined, 'deskValueOf of nothing is undefined');

/* ---------- limited tries at the same moment (takeSlot / freeSlots) ---------- */
{
  const SA = { suppressAuth: true };
  const COL = 'SlotsUnit';
  const MIN = 60000;
  const t0 = 1000 * MIN + 1234; // a fixed moment, inside a ten-minute window
  const rows = () => [...global.__DB[COL].values()];
  // 50 requests at the same instant: exactly five get a slot, each its own
  const burst = await Promise.all(Array.from({ length: 50 }, () => A.takeSlot(wd, COL, 'acct', 5, 10 * MIN, SA, t0)));
  const got = burst.filter((x) => x);
  ok(got.length === 5 && new Set(got).size === 5, 'takeSlot: 50 requests at the same instant, five slots: exactly 5 are let through, each with its own slot (' + got.length + ')');
  ok(burst.filter((x) => x === '').length === 45, 'takeSlot: the other 45 are told "no slot" (empty answer), not an error');
  ok(rows().length === 5, 'takeSlot: five records exist, no more');
  // sequential too
  ok((await A.takeSlot(wd, COL, 'acct', 5, 10 * MIN, SA, t0 + 5000)) === '', 'takeSlot: a sixth try in the same window is refused');
  // another account has its own slots
  ok((await A.takeSlot(wd, COL, 'other', 5, 10 * MIN, SA, t0)) !== '', 'takeSlot: another account is not affected');
  // the next window is fresh, and the old window\'s first slots are cleaned up
  const t1 = t0 + 10 * MIN;
  ok((await A.takeSlot(wd, COL, 'acct', 5, 10 * MIN, SA, t1)) !== '', 'takeSlot: ten minutes later the account has slots again');
  const next = await A.takeSlot(wd, COL, 'acct', 5, 10 * MIN, SA, t1 + 1000);
  ok(next !== '' && rows().every((r) => r._id !== A.slotId('acct', A.windowOf(10 * MIN, t0), 0)), 'takeSlot: the first slot of the window before is cleaned up');
  // freeing
  const t2 = t1 + 20 * MIN;
  for (let k = 0; k < 5; k++) await A.takeSlot(wd, COL, 'free', 5, 10 * MIN, SA, t2);
  ok((await A.takeSlot(wd, COL, 'free', 5, 10 * MIN, SA, t2)) === '', 'freeSlots: (setup) all five are used');
  await A.freeSlots(wd, COL, 'free', 5, 10 * MIN, SA, t2);
  ok((await A.takeSlot(wd, COL, 'free', 5, 10 * MIN, SA, t2)) !== '', 'freeSlots: after a good login the slots are given back');
  // a database error that is not "already taken" is not hidden
  let thrown = '';
  try {
    await A.takeSlot({ insert: async () => { throw new Error('db_down'); }, get: async () => null, bulkRemove: async () => null }, COL, 'x', 5, 10 * MIN, SA, t0);
  } catch (e) { thrown = e.message; }
  ok(thrown === 'db_down', 'takeSlot: a database failure is thrown (so the login can refuse), not mistaken for "no slot"');
  // names for slots
  const k1 = A.slotKey('att', 'Boss');
  ok(k1 === A.slotKey('att', ' boss ') && k1 !== A.slotKey('att', 'boss2') && k1 !== A.slotKey('ath', 'boss') && /^att~[0-9a-f]{24}$/.test(k1), 'slotKey: one fixed-length name per account, whatever its letter case or spaces');
  ok(A.slotKey('att', 'x'.repeat(5000)).length === k1.length && /^att~[0-9a-f]{24}$/.test(A.slotKey('att', '<img src=x onerror=1>"\'')), 'slotKey: a very long or odd username gives the same short name shape');
  ok(A.windowOf(10 * MIN, 0) === 0 && A.windowOf(10 * MIN, 10 * MIN - 1) === 0 && A.windowOf(10 * MIN, 10 * MIN) === 1, 'windowOf: ten-minute windows start on the dot');
}

done();
