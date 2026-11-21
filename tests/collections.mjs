// DATABASE TESTS: the list of database collections the pack tells you about is the list the code needs, and every one is locked.
//   C1  the list         exactly the 37 collections the live site was checked against; none appears twice
//   C2  the definitions  every column is plain Text; the key is the name; names are plain letters; all four permissions are Admin
//   C3  shared ones      ExpoStaff, ExpoSessions and RDRate are made by two files: both say the same
//   C4  nothing is left  every collection name the backend files use is in the list (so every one is made somewhere)
//   C5  the guide        docs/COLLECTIONS.md is exactly what the tool makes from the code; SETUP.md and the pack count the same number
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { suite } from './lib.mjs';
import { allCollections, defsOf, docText, LOCK, MORE } from '../tools/collections.mjs';
import { buildAll } from '../tools/inline_backend.mjs';

const { ok, eq, done } = suite('Collections');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// the 37 collections checked on the live site on 20 November 2026
const EXPECT = [
  'ExpoCheckins', 'ExpoConfig', 'ExpoPresence', 'ExpoSessions', 'ExpoStaff', 'RDAssignments', 'RDAudit', 'RDChecklist', 'RDClaims', 'RDComms', 'RDEvents', 'RDFinSet',
  'RDInvoices', 'RDLedger', 'RDLog', 'RDOrders', 'RDPacers', 'RDPlan', 'RDPrint', 'RDQuals', 'RDRate', 'RDRegs', 'RDResSet', 'RDResults', 'RDRunOfShow', 'RDShifts',
  'RDVolunteers', 'RDWaiver' + 's', 'RDWaveAssign', 'Runners', 'TrainAthletes', 'TrainEnroll', 'TrainMsgs', 'TrainPlans', 'TrainSessions', 'TrainTokens', 'TrainWorkouts',
].sort();

const built = buildAll();
const { collections, problems } = allCollections();
const ids = collections.map((c) => c.id);

// ---- C1
eq(EXPECT.length, 37, 'C1 the expected list holds 37 names');
eq([...ids].sort(), EXPECT, 'C1 the code makes exactly the 37 collections the site was checked against');
eq(new Set(ids).size, ids.length, 'C1 no collection is listed twice');
for (const id of EXPECT) ok(typeof MORE[id] === 'string' && MORE[id].length > 8, 'C1 ' + id + ' has a plain-words description in the guide');
eq(Object.keys(MORE).sort(), EXPECT, 'C1 the descriptions cover exactly these collections');

// ---- C2: the definitions as each file makes them
const byFile = new Map();
for (const b of built) byFile.set(b.name, defsOf(b));
const total = [...byFile.values()].reduce((n, d) => n + d.length, 0);
ok(total >= 37, 'C2 the files make ' + total + ' definitions (shared ones are made by two files)');
eq(byFile.get('exposoft.web.js'), [], 'C2 exposoft.web.js makes none (the Expo desk uses the ones RaceOS makes)');
for (const [file, defs] of byFile) {
  for (const d of defs) {
    const where = d._id + ' in ' + file;
    ok(/^[A-Za-z][A-Za-z0-9]*$/.test(d._id), 'C2 ' + where + ': the name is plain letters and digits');
    eq(d.permissions, LOCK, 'C2 ' + where + ': read, insert, update and remove are all Admin');
    ok(Array.isArray(d.fields) && d.fields.length > 0, 'C2 ' + where + ': it has columns');
    const keys = (d.fields || []).map((f) => f.key);
    eq(new Set(keys).size, keys.length, 'C2 ' + where + ': no column appears twice');
    ok((d.fields || []).every((f) => f.type === 'TEXT' && f.displayName === f.key && /^[A-Za-z][A-Za-z0-9]*$/.test(f.key)), 'C2 ' + where + ': every column is plain Text, named by its key');
    ok(!keys.some((k) => ['_id', '_owner', '_createdDate', '_updatedDate'].includes(k)), 'C2 ' + where + ': no column takes a name Wix keeps for itself');
  }
}

// ---- C3
eq(problems, [], 'C3 where two files make the same collection they list the same columns (' + (problems.join('; ') || 'no differences') + ')');
for (const id of ['ExpoStaff', 'ExpoSessions', 'RDRate']) {
  const c = collections.find((x) => x.id === id);
  eq([...(c ? c.usedBy : [])].sort(), ['racedir.web.js', 'training.web.js'], 'C3 ' + id + ' is made by racedir.web.js and training.web.js');
}
const staff = collections.find((c) => c.id === 'ExpoStaff');
for (const col of ['username', 'password', 'role', 'desks', 'name', 'failCount', 'lockUntil', 'race']) ok(staff && staff.fields.includes(col), 'C3 ExpoStaff has the column ' + col + ' (the logins need it)');

// ---- C4: every collection name that a backend file uses is in the list
const acorn = (() => {
  for (const base of [path.join(root, 'tests', 'package.json'), '/opt/node-tools/']) {
    try {
      return createRequire(base)('acorn');
    } catch (e) {
      /* next */
    }
  }
  throw new Error('acorn is not installed');
})();
const NAME = /^(RD[A-Z][A-Za-z]+|Expo[A-Z][A-Za-z]+|Train[A-Z][A-Za-z]+|Runners)$/;
const walk = (n, f) => {
  if (!n || typeof n.type !== 'string') return;
  f(n);
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, f));
    else if (v && typeof v.type === 'string') walk(v, f);
  }
};
for (const b of built) {
  const used = new Set();
  walk(acorn.parse(b.text, { ecmaVersion: 2020, sourceType: 'module' }), (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string' && NAME.test(n.value)) used.add(n.value);
  });
  const stray = [...used].filter((x) => !EXPECT.includes(x));
  eq(stray, [], 'C4 ' + b.name + ' names no collection that is not in the list');
  const made = new Set((byFile.get(b.name) || []).map((d) => d._id));
  // a file that makes collections only makes collections it uses
  eq([...made].filter((x) => !used.has(x)), [], 'C4 ' + b.name + ' makes only collections it uses');
}
const allUsed = new Set();
for (const b of built) {
  walk(acorn.parse(b.text, { ecmaVersion: 2020, sourceType: 'module' }), (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string' && EXPECT.includes(n.value)) allUsed.add(n.value);
  });
}
eq(EXPECT.filter((x) => !allUsed.has(x)), [], 'C4 every collection in the list is used by some backend file');

// ---- C5
eq(read('docs/COLLECTIONS.md'), docText(collections), 'C5 docs/COLLECTIONS.md is exactly what "node tools/collections.mjs --doc" makes from the code');
ok(/37 database collections/.test(read('docs/COLLECTIONS.md')) && /## D\. The database collections \(37\)/.test(read('docs/SETUP.md')), 'C5 the guide counts 37 collections');
ok(/3-database\/COLLECTIONS\.md/.test(read('docs/SETUP.md')) && /3-database\/collections\.json/.test(read('docs/SETUP.md')), 'C5 the guide says where the list is in the pack');
const pack = read('tools/make_pack.py');
ok(/3-database/.test(pack) && /COLLECTIONS\.md/.test(pack) && /collections\.json/.test(pack), 'C5 the pack builder puts the list in 3-database/');
const guideText = read('docs/SETUP.md') + read('docs/UPGRADE.md') + read('docs/COLLECTIONS.md') + read('README.md');
ok(!/\b(password|passcode|PIN)\b[^\n]{0,30}?(is|are|:|=)\s*`?[A-Za-z0-9]{12,}`?(\s|\.|,|$)/i.test(guideText), 'C5 no guide writes out a password (the master password is given once, in the chat, and not kept in any file)');

done();
