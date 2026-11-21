// BUNDLE TESTS: the 11 backend files the pack ships. Each is one web module with the helper code it needs put inside it
// (tools/inline_backend.mjs), so a site has no helper file to get wrong.
//   B1  the files      exactly the 11 names, none too large
//   B2  each file      reads as ES2020; no import of one of our files is left; the Wix modules it imports are the expected ones;
//                      the last line is "// END <name>", once; SETUP_KEY is one line near the top in the two files that have one;
//                      the exports are the exports of the source file; every export is a webMethod
//   B3  the helpers    each file takes in exactly the helper files its source imports (read again here, on its own)
//   B4  shared state   no helper keeps state that two web modules would have to share (a copy per file would then behave differently)
//   B5  same twice     building twice gives the same text, and the command line writes the same files
//   B6  the tool       it does the same as the modules it replaces (renames, namespace imports, order, SETUP_KEY) and refuses, loudly,
//                      what it cannot turn into the same behaviour (16 kinds of input)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { suite } from './lib.mjs';
import { build, buildAll, entries } from '../tools/inline_backend.mjs';

const { ok, eq, done } = suite('Bundle');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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
const parse = (t) => acorn.parse(t, { ecmaVersion: 2020, sourceType: 'module' });
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const WEB = ['comms.web.js', 'exposoft.web.js', 'finance.web.js', 'print.web.js', 'privacy.web.js', 'racedir.web.js', 'reports.web.js', 'results.web.js', 'runner.web.js', 'training.web.js', 'waivers.web.js'];
const BASIC = ['wix-web-module:Permissions+webMethod', 'wix-data:wixData'];
const MORE4 = BASIC.concat(['wix-auth:elevate', 'wix-data.v2:collections']);
const IMPORTS = {
  'comms.web.js': MORE4.concat(['wix-crm-backend:contacts+triggeredEmails']),
  'exposoft.web.js': MORE4,
  'finance.web.js': MORE4,
  'print.web.js': MORE4,
  'privacy.web.js': BASIC,
  'racedir.web.js': MORE4.concat(['wix-fetch:fetch', 'wix-secrets-backend:getSecret']),
  'reports.web.js': BASIC,
  'results.web.js': MORE4,
  'runner.web.js': BASIC,
  'training.web.js': MORE4.concat(['wix-fetch:fetch', 'wix-secrets-backend:getSecret']),
  'waivers.web.js': MORE4,
};
const MAX_FILE = 420 * 1024;

const files = entries();
const built = buildAll();

// ---- B1
eq(files.map((f) => path.basename(f)), WEB, 'B1 the source tree has exactly the 11 web modules');
eq(built.map((b) => b.name), WEB, 'B1 the build makes exactly the 11 files, in this order');
for (const b of built) ok(b.size > 10 * 1024 && b.size <= MAX_FILE, 'B1 ' + b.name + ' is ' + Math.round(b.size / 1024) + ' KB (more than 10 and at most 420)');
ok(built.reduce((n, b) => n + b.size, 0) < 2 * 1024 * 1024, 'B1 the 11 files together are under 2 MB');

// the exports of a source file, read on its own here
const exportsOf = (ast) =>
  ast.body.flatMap((n) => (n.type === 'ExportNamedDeclaration' ? (n.declaration ? (n.declaration.declarations ? n.declaration.declarations.map((d) => d.id.name) : [n.declaration.id.name]) : n.specifiers.map((s) => s.exported.name)) : []));

// ---- B2
for (const b of built) {
  let ast = null;
  try {
    ast = parse(b.text);
  } catch (e) {
    ok(false, 'B2 ' + b.name + ' reads as ES2020 [' + e.message + ']');
    continue;
  }
  ok(true, 'B2 ' + b.name + ' reads as ES2020');
  const imps = ast.body.filter((n) => n.type === 'ImportDeclaration');
  eq(imps.filter((n) => /^\.{0,2}\//.test(n.source.value)).map((n) => n.source.value), [], 'B2 ' + b.name + ' imports no file of ours');
  eq(imps.map((n) => n.source.value + ':' + n.specifiers.map((s) => s.local.name).join('+')), IMPORTS[b.name], 'B2 ' + b.name + ' imports only these Wix modules');
  ok(imps.every((n) => /^wix-[a-z0-9.-]+$/.test(n.source.value)), 'B2 ' + b.name + ': every import is a Wix module');
  ok(b.text.endsWith('\n// END ' + b.name + '\n') && (b.text.match(/^\/\/ END /gm) || []).length === 1, 'B2 ' + b.name + ' ends with "// END ' + b.name + '", once');
  const lines = b.text.split('\n');
  const keyAt = lines.map((l, i) => (/^const SETUP_KEY = /.test(l) ? i : -1)).filter((i) => i >= 0);
  if (b.name === 'racedir.web.js' || b.name === 'training.web.js') {
    eq(lines.filter((l) => /^const SETUP_KEY = /.test(l)), ["const SETUP_KEY = 'change-this-key';"], 'B2 ' + b.name + ' has one SETUP_KEY line, with the placeholder');
    ok(keyAt[0] < 14, 'B2 ' + b.name + ': the SETUP_KEY line is near the top (line ' + (keyAt[0] + 1) + ')');
  } else {
    eq(keyAt, [], 'B2 ' + b.name + ' has no SETUP_KEY');
  }
  // the source file, read again here
  const srcPath = files[WEB.indexOf(b.name)];
  const srcText = fs.readFileSync(srcPath, 'utf8');
  eq(exportsOf(ast), exportsOf(parse(srcText)), 'B2 ' + b.name + ' exports exactly what its source file exports');
  const notWeb = ast.body.filter((n) => n.type === 'ExportNamedDeclaration' && !(n.declaration && n.declaration.declarations && n.declaration.declarations.every((d) => d.init && d.init.type === 'CallExpression' && d.init.callee.name === 'webMethod')));
  eq(notWeb.length, 0, 'B2 ' + b.name + ': every export is a webMethod');
  ok(/^\/\/ RaceOS backend file /m.test(lines.slice(0, 4).join('\n')) && /Paste this whole file as it is/.test(lines.slice(0, 4).join('\n')), 'B2 ' + b.name + ' says at the top what to do with it');
  ok(!/\bimport\s+[^;]*from\s+['"]\.{1,2}\//.test(b.text), 'B2 ' + b.name + ' has no "from ./..." anywhere (not even in a string)');
  ok(!/\brequire\(/.test(b.text), 'B2 ' + b.name + ' does not use require');
}
// the one dynamic import that stays, where the guide says it is
const rd = built.find((b) => b.name === 'racedir.web.js').text;
eq((rd.match(/^const eventsApi = \(\) => import\('wix-events\.v2'\);$/gm) || []).length, 1, 'B2 racedir.web.js keeps the one line "const eventsApi = () => import(\'wix-events.v2\');" that the guide tells you to replace if Wix refuses it');
for (const b of built) if (b.name !== 'racedir.web.js') ok(!/wix-events/.test(b.text), 'B2 ' + b.name + ' never mentions wix-events');

// ---- B3: the helpers a file takes in, read again from the sources
const helperDir = path.join(root, 'wix', 'director');
const closure = (abs, seen = new Set()) => {
  for (const m of fs.readFileSync(abs, 'utf8').matchAll(/from '\.\/([\w.-]+\.js)'/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      closure(path.join(helperDir, m[1]), seen);
    }
  }
  return seen;
};
const OLD11 = ['ai-core.js', 'rd-approvals.js', 'rd-auth.js', 'rd-comms.js', 'rd-data.js', 'rd-finance.js', 'rd-print.js', 'rd-report.js', 'rd-results.js', 'rd-waiver.js', 'rd-privacy.js'].sort();
const everyHelper = new Set();
for (const b of built) {
  const want = [...closure(files[WEB.indexOf(b.name)])].sort();
  eq([...b.helpers].sort(), want, 'B3 ' + b.name + ' takes in exactly the helper files its source imports (' + want.length + ')');
  want.forEach((h) => everyHelper.add(h));
  for (const h of b.helpers) ok(b.text.includes('// Built in: ' + h + ' '), 'B3 ' + b.name + ' says where the code of ' + h + ' went');
  // a helper's code is there once, before the code that uses it
  for (const h of b.helpers) eq((b.text.match(new RegExp('^const __h_' + h.replace(/\.js$/, '').replace(/[^A-Za-z0-9]/g, '_') + ' = \\(\\(\\) => \\{$', 'gm')) || []).length, 1, 'B3 ' + b.name + ' holds the code of ' + h + ' once');
}
eq([...everyHelper].sort(), OLD11, 'B3 together the files take in all 11 helper files, and nothing else');
eq(fs.readdirSync(helperDir).filter((f) => !f.endsWith('.web.js') && f.endsWith('.js') && !/page-code|embed/.test(f)).sort().filter((f) => !/-page-code\.js$/.test(f)), OLD11, 'B3 the source tree has exactly those 11 helper files (a new one must be listed in the guide too)');

// ---- B4: state that lives in a helper file
const STATE_OK = { 'rd-auth.js': ['counter'], 'ai-core.js': ['cached'], 'rd-results.js': ['ZERO_IDX'] }; // a counter, a cached secret and a cache: each is fine once per file
const stateOf = (ast) => {
  const out = [];
  for (const n of ast.body) {
    if (n.type !== 'VariableDeclaration') continue;
    for (const d of n.declarations) {
      const isNew = d.init && d.init.type === 'NewExpression' && /^(Map|Set|WeakMap|WeakSet|Array)$/.test(d.init.callee.name || '');
      if ((n.kind !== 'const' || isNew) && d.id.type === 'Identifier') out.push(d.id.name);
    }
  }
  return out;
};
for (const h of OLD11) eq(stateOf(parse(fs.readFileSync(path.join(helperDir, h), 'utf8'))), STATE_OK[h] || [], 'B4 ' + h + ' keeps no state beyond ' + JSON.stringify(STATE_OK[h] || []) + ' (a copy of it per web module must behave the same)');

// ---- B5
const again = buildAll();
eq(again.map((b) => b.text === built[again.indexOf(b)].text), WEB.map(() => true), 'B5 building twice gives the same text, file by file');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-out-'));
execFileSync('node', [path.join(root, 'tools', 'inline_backend.mjs'), '--out', tmpRoot], { stdio: 'pipe' });
eq(fs.readdirSync(tmpRoot).sort(), WEB, 'B5 "--out" writes the 11 files');
for (const b of built) ok(fs.readFileSync(path.join(tmpRoot, b.name), 'utf8') === b.text, 'B5 the written ' + b.name + ' is the built one');
const one = execFileSync('node', [path.join(root, 'tools', 'inline_backend.mjs'), '--entry', path.join(root, 'wix', 'director', 'finance.web.js')], { encoding: 'utf8' });
ok(one === built.find((b) => b.name === 'finance.web.js').text, 'B5 "--entry" prints the same file');
const listing = execFileSync('node', [path.join(root, 'tools', 'inline_backend.mjs'), '--list'], { encoding: 'utf8' }).trim().split('\n');
eq(listing.length, 11, 'B5 "--list" has one line per file');
fs.rmSync(tmpRoot, { recursive: true, force: true });

// ---- B6: the tool on small made-up files
const END = (n, body) => body.replace(/\s+$/, '') + '\n// END ' + n + '\n';
const mk = (spec) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-fx-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'wix', 'director'), { recursive: true });
  for (const [name, body] of Object.entries(spec)) fs.writeFileSync(path.join(dir, 'wix', 'director', name), name === 'raw.txt' ? body : END(name, body));
  return dir;
};
const entryOf = (dir) => path.join(dir, 'wix', 'director', 'a.web.js');
const refuses = (spec, re, label) => {
  const dir = mk(spec);
  let msg = '';
  try {
    build(entryOf(dir), dir);
  } catch (e) {
    msg = e.message;
  }
  ok(re.test(msg), 'B6 the tool refuses ' + label + (re.test(msg) ? '' : '   [message: ' + (msg || 'it built it') + ']'));
  fs.rmSync(dir, { recursive: true, force: true });
};

{ // the same behaviour: renames, a helper that imports a helper, an export list, a namespace import, a key
  const spec = {
    'h-base.js': "export const BASE = 10;\nexport function inc(x) { return x + BASE; }",
    'h-top.js': "import { inc, BASE as B } from './h-base.js';\nexport const twice = (x) => inc(inc(x));\nexport { B as base };",
    'h-ns.js': "export const k = 'K';\nexport function who() { return 'ns:' + k; }",
    'a.web.js': "import { twice, base } from './h-top.js';\nimport * as ns from './h-ns.js';\nimport { inc as plusBase } from './h-base.js';\n// the key\nconst SETUP_KEY = 'change-this-key';\nexport const f = (x) => twice(x) + base + plusBase(0) + ns.who();\nexport async function g() { return SETUP_KEY + ns.k; }\nexport const h = () => [typeof twice, typeof ns, typeof plusBase].join();",
  };
  const dir = mk(spec);
  const b = build(entryOf(dir), dir);
  const outFile = path.join(dir, 'built.mjs');
  fs.writeFileSync(outFile, b.text);
  const A = await import(pathToFileURL(entryOf(dir)).href);
  const B = await import(pathToFileURL(outFile).href);
  eq(b.exports, ['f', 'g', 'h'], 'B6 a made-up web module keeps its exports');
  eq([B.f(1), await B.g(), B.h()], [A.f(1), await A.g(), A.h()], 'B6 it gives the same answers as the module it was built from (renames, a helper of a helper, an export list, a namespace import)');
  eq(B.f(1), '41ns:K', 'B6 and the answer is the right one');
  eq(b.helpers, ['h-base.js', 'h-top.js', 'h-ns.js'], 'B6 the helpers come in dependency order: the one that is imported by another first');
  const lines = b.text.split('\n');
  const keyAt = lines.findIndex((l) => /^const SETUP_KEY/.test(l));
  ok(keyAt > 0 && keyAt < lines.findIndex((l) => /^const __h_h_base/.test(l)) && lines[keyAt - 1] === '// the key', 'B6 SETUP_KEY and the comment above it move to the top, before any helper code');
  eq(b.text.split('\n').filter((l) => /^\/\/ END /.test(l)), ['// END a.web.js'], 'B6 the helper END lines are gone and the web module keeps its own');
  fs.rmSync(dir, { recursive: true, force: true });
}
{ // Wix imports a helper needs are added once, at the top, and not repeated
  const dir = mk({
    'h1.js': "import wixData from 'wix-data';\nimport { elevate } from 'wix-auth';\nexport const a = () => typeof wixData + typeof elevate;",
    'h2.js': "import wixData from 'wix-data';\nimport { fetch } from 'wix-fetch';\nexport const b = () => typeof wixData + typeof fetch;",
    'a.web.js': "import { webMethod, Permissions } from 'wix-web-module';\nimport { a } from './h1.js';\nimport { b } from './h2.js';\nexport const f = webMethod(Permissions.Anyone, async () => a() + b());",
  });
  const b = build(entryOf(dir), dir);
  const ast = parse(b.text);
  const imps = ast.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value);
  eq(imps, ['wix-web-module', 'wix-data', 'wix-auth', 'wix-fetch'], 'B6 the Wix imports a helper needs are added once, after the web module\'s own');
  eq(imps.filter((x) => x === 'wix-data').length, 1, 'B6 an import two helpers both need is made once');
  fs.rmSync(dir, { recursive: true, force: true });
}

const H = "export const f = () => 1;";
refuses({ 'h.js': 'export let x = 1;', 'a.web.js': "import { x } from './h.js';\nexport const g = () => x;" }, /"export let" is not supported/, '"export let" (a later change would not reach the importing file)');
refuses({ 'h.js': 'export default 5;', 'a.web.js': "import { x } from './h.js';\nexport const g = () => x;" }, /"export default" and "export \*" are not supported/, '"export default"');
refuses({ 'h.js': H, 'h2.js': "export * from './h.js';", 'a.web.js': "import { f } from './h2.js';\nexport const g = () => f();" }, /not supported by the build/, '"export * from"');
refuses({ 'h.js': H, 'h2.js': "export { f } from './h.js';", 'a.web.js': "import { f } from './h2.js';\nexport const g = () => f();" }, /re-export/, 'a re-export');
refuses({ 'h.js': H, 'a.web.js': "import h from './h.js';\nexport const g = () => h;" }, /default import/, 'a default import of one of our files');
refuses({ 'h.js': H, 'a.web.js': "import './h.js';\nexport const g = () => 1;" }, /names nothing/, 'a side-effect import of one of our files');
refuses({ 'h.js': H, 'a.web.js': "import { nope } from './h.js';\nexport const g = () => nope;" }, /does not export it/, 'a name that the helper does not export');
refuses({ 'a.web.js': "import { f } from './missing.js';\nexport const g = () => f();" }, /no such file/, 'an import of a file that is not there');
refuses({ 'h1.js': "import { b } from './h2.js';\nexport const a = () => b;", 'h2.js': "import { a } from './h1.js';\nexport const b = () => a;", 'a.web.js': "import { a } from './h1.js';\nexport const g = () => a();" }, /import cycle/, 'an import cycle');
refuses({ 'h.js': "import { a as x } from 'wix-data';\nexport const p = () => x;", 'a.web.js': "import { b as x } from 'wix-fetch';\nimport { p } from './h.js';\nexport const g = () => p() + x;" }, /imported twice for different things/, 'one name imported for two different things');
refuses({ 'h.js': 'export const f = () => shared;', 'a.web.js': "import { f } from './h.js';\nconst shared = 1;\nexport const g = () => f() + shared;" }, /as a global, and a\.web\.js declares the same name/, 'a helper that would find the web module\'s own name instead of a global');
refuses({ 'h.js': 'export const f = (a) => { a ||= 1; return a; };', 'a.web.js': "import { f } from './h.js';\nexport const g = () => f();" }, /ES2020/, 'syntax newer than ES2020 (Wix may not read it)');
refuses({ 'h.js': H, 'a.web.js': "import { f } from './h.js';\nconst __h_h = 1;\nexport const g = () => f() + __h_h;" }, /__h_/, 'a name the tool keeps for itself');
refuses({ 'h.js': H, 'a.web.js': "import { f } from './h.js';\nconst SETUP_KEY = 'a' + 'b';\nexport const g = () => f() + SETUP_KEY;" }, /SETUP_KEY must be a plain text value/, 'a SETUP_KEY that is not plain text');
refuses({ 'h.js': H, 'a.web.js': "import { f } from './h.js';\nexport const { a, b } = { a: 1, b: 2 };\nexport const g = () => f();" }, /exported destructuring/, 'an exported destructuring');
{ // a source file whose last line is not the END line
  const dir = mk({ 'h.js': H, 'a.web.js': "import { f } from './h.js';\nexport const g = () => f();" });
  fs.writeFileSync(path.join(dir, 'wix', 'director', 'a.web.js'), "import { f } from './h.js';\nexport const g = () => f();\n");
  let msg = '';
  try {
    build(entryOf(dir), dir);
  } catch (e) {
    msg = e.message;
  }
  ok(/the last line must be "\/\/ END a\.web\.js"/.test(msg), 'B6 the tool refuses a source file that does not end with its END line (' + msg.slice(0, 60) + ')');
  fs.rmSync(dir, { recursive: true, force: true });
}

done();
