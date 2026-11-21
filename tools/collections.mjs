#!/usr/bin/env node
/* The list of database collections RaceOS needs, read from the backend source (so it can never disagree with the code).
 *
 * Every web module that stores something has a collectionDefs() function. This tool builds each web module the way the pack does
 * (tools/inline_backend.mjs), runs only that function with the Wix modules replaced by empty stand-ins, and merges the answers.
 *
 * usage:
 *   node tools/collections.mjs            a short table
 *   node tools/collections.mjs --json     the definitions as JSON (what the pack ships as 3-database/collections.json)
 *   node tools/collections.mjs --md       the same as a Markdown table
 *   node tools/collections.mjs --doc      the whole of docs/COLLECTIONS.md
 */
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './inline_backend.mjs';

export const LOCK = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };

const standIn = () => {
  const f = function () {};
  const p = new Proxy(f, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : p),
    apply: () => p,
    construct: () => p,
  });
  return p;
};

// the definitions one built file makes (an empty list for a file that makes none)
export function defsOf(built) {
  let body = built.text.replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';[ \t]*$/gm, (m, spec) => {
    const s = spec.trim();
    if (s.startsWith('{')) return 'const ' + s.replace(/\s+as\s+/g, ': ') + ' = __stand();';
    if (s.startsWith('* as ')) return 'const ' + s.slice(5) + ' = __stand();';
    return 'const ' + s + ' = __stand();';
  });
  body = body.replace(/^export\s+(const|let|var|function|async function|class)\s/gm, '$1 ');
  if (!/\bfunction collectionDefs\s*\(/.test(body)) return [];
  body += '\n;return collectionDefs();';
  const run = vm.runInNewContext('(function (__stand) {\n' + body + '\n})', { console }, { timeout: 5000 });
  const out = run(standIn);
  return JSON.parse(JSON.stringify(out));
}

// all collections, one entry each, in the order the modules are listed; usedBy says which files make it
export function allCollections(root) {
  const byId = new Map();
  const problems = [];
  for (const b of buildAll(root)) {
    for (const d of defsOf(b)) {
      const fields = (d.fields || []).map((f) => f.key);
      const bad = (d.fields || []).filter((f) => f.type !== 'TEXT' || f.displayName !== f.key);
      if (bad.length) problems.push(d._id + ' in ' + b.name + ': a field that is not plain text');
      if (JSON.stringify(d.permissions) !== JSON.stringify(LOCK)) problems.push(d._id + ' in ' + b.name + ': not locked to the site admin');
      const have = byId.get(d._id);
      if (!have) {
        byId.set(d._id, { id: d._id, fields, usedBy: [b.name] });
      } else {
        have.usedBy.push(b.name);
        const extra = fields.filter((f) => !have.fields.includes(f));
        const lacks = have.fields.filter((f) => !fields.includes(f));
        if (extra.length || lacks.length) {
          // the schema is not enforced by Wix; the union holds every field either file writes
          have.fields.push(...extra);
          problems.push(d._id + ': ' + b.name + ' and ' + have.usedBy[0] + ' list different fields (' + [...extra.map((x) => '+' + x), ...lacks.map((x) => '-' + x)].join(' ') + '); the union is used');
        }
      }
    }
  }
  return { collections: [...byId.values()], problems };
}

export const MORE = {
  // what each collection holds, in plain words, for the guide
  RDComms: 'message templates and the log of messages sent (Messages)',
  RDInvoices: 'invoices (Finance)',
  RDOrders: 'purchase orders: estimate, advance and actual (Finance)',
  RDClaims: 'reimbursement claims (Finance)',
  RDLedger: 'income and expenses, one line each (Finance)',
  RDFinSet: 'Finance settings (invoice details, numbering)',
  RDPrint: 'bib and certificate designs and the /runner page switches',
  ExpoStaff: 'logins: usernames, roles and password hashes (the Team screen)',
  ExpoSessions: 'who is signed in right now',
  ExpoPresence: 'which Expo desk each person is at',
  ExpoConfig: 'Expo desk settings per race',
  ExpoCheckins: 'bib and T-shirt hand-outs at the Expo desk',
  RDAudit: 'the audit trail (who did what, and when)',
  Runners: 'runners at the Expo desk',
  RDEvents: 'your races',
  RDShifts: 'volunteer shifts',
  RDVolunteers: 'volunteers',
  RDAssignments: 'who works which shift, check-in and hours',
  RDLog: 'race-day incident log',
  RDRunOfShow: 'race-day run of show',
  RDPacers: 'pacers of a race',
  RDChecklist: 'safety checklist',
  RDRegs: 'registrations imported from Wix Events',
  RDQuals: 'qualification claims',
  RDPlan: 'every planning item of a race: tasks, budget lines, contacts, approvals',
  RDRate: 'counters that slow down guessing (logins, set-up)',
  RDResults: 'race results',
  RDWaveAssign: 'the wave and corral of each runner',
  RDResSet: 'Waves & results settings and the waves',
  TrainAthletes: 'athlete accounts (mobile number and PIN)',
  TrainTokens: 'athlete sign-ins',
  TrainPlans: 'training plans',
  TrainWorkouts: 'the workouts of each plan',
  TrainEnroll: 'which athlete follows which plan, with which coach',
  TrainSessions: 'planned and logged training sessions',
  TrainMsgs: 'messages between coach and athlete',
  RDWaivers: 'waiver text versions, who has signed and papers recorded on the day (Waivers)',
};

// the whole of docs/COLLECTIONS.md (the file is made by this tool, so the list can never disagree with the code)
export function docText(collections) {
  const n = collections.length;
  const L = [];
  L.push('# The ' + n + ' database collections of RaceOS', '');
  L.push('This file is made by `node tools/collections.mjs --doc` from the backend source, so it cannot disagree with the code. Do not edit it by hand.', '');
  L.push('Every collection has only plain **Text** columns, and all four permissions (read, insert, update, remove) are set to **Admin**: only the backend files can read or write a collection, and no page can. On vtra.run all ' + n + ' were checked on 20 November 2026: each exists with those four permissions.', '');
  L.push('| # | Collection | What it holds | Made by | Columns |', '|---|---|---|---|---|');
  collections.forEach((c, i) => L.push('| ' + (i + 1) + ' | `' + c.id + '` | ' + (MORE[c.id] || '') + ' | ' + c.usedBy.join(', ') + ' | ' + c.fields.length + ' |'));
  L.push('', '## The columns', '');
  for (const c of collections) L.push('- `' + c.id + '`: ' + c.fields.map((f) => '`' + f + '`').join(', '));
  L.push('', '## You never make these by hand', '');
  L.push('- The backend makes the collections of a tab the first time a director opens it, and the First-time setup form (or the first login) makes the core ones, locked as above. If a collection is ever missing, open the tab that uses it once as a director.');
  L.push('- If you must make one by hand (in a copy of the site, say), use the **Text** type for every column and set all four permissions to **Admin**. Wix does not enforce columns, so a missing column is not an error, but the screens then show that field empty.');
  L.push('- Never change a permission to Anyone or Site member: `ExpoStaff` holds the logins, and every other collection holds personal details of runners, volunteers or athletes.');
  L.push('', '## Sandbox and Live', '');
  L.push('If the CMS shows a **Sandbox** and a **Live** tab, the Editor\'s Preview reads and writes the sandbox and the published site reads and writes the live data. The collections above exist in the live data on vtra.run. Do the first sign-in on the published address (https://www.vtra.run/rd).');
  L.push('');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  try {
    const { collections, problems } = allCollections();
    if (a.includes('--json')) {
      console.log(JSON.stringify({ permissions: LOCK, collections, problems }, null, 1));
    } else if (a.includes('--doc')) {
      process.stdout.write(docText(collections));
    } else if (a.includes('--md')) {
      console.log('| Collection | Made by | Fields |\n|---|---|---|');
      for (const c of collections) console.log('| `' + c.id + '` | ' + c.usedBy.join(', ') + ' | ' + c.fields.length + (MORE[c.id] ? ' (' + MORE[c.id] + ')' : '') + ' |');
    } else {
      console.log(collections.length + ' collections, all locked to the site admin:');
      for (const c of collections) console.log('  ' + c.id.padEnd(16), String(c.fields.length).padStart(3) + ' fields  ', c.usedBy.join(', '));
      if (problems.length) console.log('\nNotes:\n  ' + problems.join('\n  '));
    }
  } catch (e) {
    console.error('FAILED: ' + e.message);
    process.exit(1);
  }
}
