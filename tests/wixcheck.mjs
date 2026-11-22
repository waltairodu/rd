// WIX PUBLISH CHECK: the check Wix runs on every code file when you click Publish, run here on the files before they are shipped.
// Wix says it applies the ESLint rules no-undef (a name that is used and never declared) and no-const-assign. A file with an error
// can be left out of the build, and then every method in it looks missing. On 21 November 2026 Wix rejected `globalThis.crypto` in all
// eleven backend files (build.log: "no-undef: 'globalThis' is not defined") and the login said "Unable to handle the request".
// The tests ran in Node, where globalThis exists, so nothing here saw it. This suite runs the same two rules with ESLint itself.
//   X1  the files        the 11 backend files and the 5 page codes have no error, under four settings of the check (Wix does not publish them)
//   X2  the check works  the line Wix rejected is rejected here at the place its log gave; the fix is accepted; the rule that matters is live
//   X3  the names        the code uses no name outside ES2015 except console (and crypto, which its own comment declares; $w in page code)
//   X4  the page imports every  backend/...  import in a page code names one of the 11 files (Wix's other build error: Cannot find module)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { suite } from './lib.mjs';
import { buildAll } from '../tools/inline_backend.mjs';

const { ok, eq, done } = suite('Wix publish check');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(root, 'tests', 'package.json'));
const { Linter } = require('eslint');
const linter = new Linter();

// Wix does not say which environment its check uses, so the files must pass under all of these. 'strict' is the narrowest one:
// JavaScript's own names up to ES2015 and console, nothing else (no browser or Node names).
const VARIANTS = {
  'es6 + browser': { env: { es6: true, browser: true } },
  'es6 + node': { env: { es6: true, node: true } },
  'es2017 + browser + node': { env: { es2017: true, browser: true, node: true } },
  strict: { env: { es6: true }, globals: { console: 'readonly' } },
};
const RULES = { 'no-undef': 'error', 'no-const-assign': 'error' };
const lint = (text, variant, extraGlobals) => {
  const v = VARIANTS[variant];
  return linter.verify(text, {
    parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
    rules: RULES,
    env: v.env,
    globals: { ...(v.globals || {}), ...(extraGlobals || {}) },
  }, { filename: 'x.js' });
};
const show = (msgs) => msgs.slice(0, 3).map((m) => (m.ruleId || 'parse') + ' ' + m.message + ' (' + m.line + ':' + m.column + ')').join('; ') + (msgs.length > 3 ? '; ...' : '');

const backend = buildAll().map((b) => ({ name: b.name, text: b.text }));
const PAGES = [
  'wix/director/director-page-code.js', 'wix/director/volunteer-page-code.js', 'wix/director/runner-page-code.js',
  'wix/training/athlete-page-code.js', 'wix/training/coach-page-code.js',
].map((p) => ({ name: p, text: fs.readFileSync(path.join(root, p), 'utf8') }));
const VELO = { $w: 'readonly' }; // the page names Wix itself provides in page code

// ---- X1
eq(backend.length, 11, 'X1 there are 11 backend files');
eq(PAGES.length, 5, 'X1 there are 5 page codes');
for (const variant of Object.keys(VARIANTS)) {
  for (const f of backend) {
    const msgs = lint(f.text, variant);
    eq(msgs.map((m) => (m.ruleId || 'parse') + ' ' + m.message + ' (' + m.line + ':' + m.column + ')'), [], 'X1 ' + f.name + ' has no error under "' + variant + '"');
  }
  for (const f of PAGES) {
    const msgs = lint(f.text, variant, VELO);
    eq(msgs.map((m) => (m.ruleId || 'parse') + ' ' + m.message + ' (' + m.line + ':' + m.column + ')'), [], 'X1 ' + f.name + ' has no error under "' + variant + '"');
  }
}
// the source files of the helpers too: a helper that is only used by some module still ends up inside it
for (const f of fs.readdirSync(path.join(root, 'wix', 'director')).filter((x) => /^(rd-|ai-core)[a-z-]*\.js$/.test(x))) {
  const text = fs.readFileSync(path.join(root, 'wix', 'director', f), 'utf8');
  for (const variant of ['es6 + browser', 'strict']) {
    eq(show(lint(text, variant).filter((m) => m.ruleId === 'no-const-assign' || (m.ruleId === 'no-undef' && !/'(?:crypto|console)'/.test(m.message)))), '', 'X1 the helper ' + f + ' has no error of its own under "' + variant + '"');
  }
}

// ---- X2: the check can fail, and fails where Wix's log said
const BAD = "function rnd32() {\n  try {\n    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;\n    return c;\n  } catch (e) {\n    return null;\n  }\n}\n";
for (const variant of Object.keys(VARIANTS)) {
  const msgs = lint(BAD, variant);
  eq(msgs.map((m) => m.ruleId + ' ' + m.message + ' (' + m.line + ':' + m.column + ')'), ["no-undef 'globalThis' is not defined. (3:51)"], 'X2 the line Wix rejected is rejected under "' + variant + '", at column 51 as in its log');
}
const FIXED = "function rnd32() {\n  try {\n    /* global crypto */\n    const c = typeof crypto !== 'undefined' ? crypto : null;\n    return c;\n  } catch (e) {\n    return null;\n  }\n}\n";
for (const variant of Object.keys(VARIANTS)) eq(lint(FIXED, variant).length, 0, 'X2 the fixed form is accepted under "' + variant + '"');
const NO_COMMENT = FIXED.replace('    /* global crypto */\n', '');
eq(lint(NO_COMMENT, 'es6 + browser').length + lint(NO_COMMENT, 'es6 + node').length, 0, 'X2 without its comment the fixed form is still accepted wherever the check knows the browser or Node names');
eq(lint(NO_COMMENT, 'strict').map((m) => m.message), ["'crypto' is not defined."], 'X2 without its comment the fixed form is rejected under "strict": the comment is what keeps it safe there');
eq(lint('const a = 1;\na = 2;\n', 'strict').map((m) => m.ruleId), ['no-const-assign'], 'X2 a const that is changed is caught');
eq(lint('let a = 1;\na = 2;\nconsole.log(a);\n', 'strict').length, 0, 'X2 a let that is changed is not');
eq(lint('console.log(neverDeclared);\n', 'strict').map((m) => m.message), ["'neverDeclared' is not defined."], 'X2 a name that is never declared is caught');
eq(lint('console.log(typeof neverDeclared);\n', 'strict').length, 0, 'X2 a name inside typeof is not (that is why the check passes on typeof crypto)');
eq(lint('const t = [1, 2].map((x) => x ?? 0).length;\nlet o = { a: { b: 1 } };\nconsole.log(o?.a?.b, t);\n', 'strict').length, 0, 'X2 the syntax of ES2020 (?? and ?.) is read without a parse error');
eq(lint("console.log(BigInt(1), WeakRef);\n", 'es6 + browser').map((m) => m.message).sort(), ["'BigInt' is not defined.", "'WeakRef' is not defined."], 'X2 names newer than ES2015 are not known to the check, so they are caught too');

// ---- X3: the names the code uses without declaring them
const undeclared = (text, variant, extra) => [...new Set(lint(text, variant, extra).filter((m) => m.ruleId === 'no-undef').map((m) => m.message.replace(/^'(.*)' is not defined\.$/, '$1')))].sort();
const bare = (text, extra) => {
  // no environment at all but ES2015's own names: what is left is what the platform has to provide
  const msgs = linter.verify(text, { parserOptions: { ecmaVersion: 2020, sourceType: 'module' }, rules: { 'no-undef': 'error' }, env: { es6: true }, globals: extra || {} }, { filename: 'x.js' });
  return [...new Set(msgs.filter((m) => m.ruleId === 'no-undef').map((m) => m.message.replace(/^'(.*)' is not defined\.$/, '$1')))].sort();
};
for (const f of backend) eq(bare(f.text), ['console'], 'X3 ' + f.name + ' uses no name outside ES2015 except console (crypto is declared by its comment)');
for (const f of PAGES) {
  const beyond = bare(f.text);
  ok(beyond.includes('$w') && beyond.every((n) => n === 'console' || n === '$w'), 'X3 ' + f.name + ' uses no name outside ES2015 except console and $w (it uses: ' + beyond.join(', ') + ')');
}
for (const f of backend) {
  const noComment = f.text.replace(/\/\* global crypto \*\//g, '');
  eq(bare(noComment), ['console', 'crypto'], 'X3 ' + f.name + ': crypto is the only other name, and only the comment declares it');
  ok(!/\bglobalThis\b/.test(f.text.replace(/\/\/[^\n]*/g, '')), 'X3 ' + f.name + ' does not use globalThis (comments aside)');
}
ok(backend.every((f) => (f.text.match(/\/\* global crypto \*\//g) || []).length === 1), 'X3 every backend file holds the comment that declares crypto, once');
ok(backend.every((f) => !/^\s*(const|let|var|function|class)\s+crypto\b/m.test(f.text)), 'X3 no file declares its own crypto (it would hide the platform one and the secure generator would silently not be used)');

// ---- X4: a page code imports only files that exist
const names = new Set(backend.map((f) => f.name));
for (const f of PAGES) {
  const imports = [...f.text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  ok(imports.some((i) => /^backend\//.test(i)), 'X4 ' + f.name + ' imports at least one backend module');
  for (const i of imports) {
    const m = /^backend\/([A-Za-z0-9_-]+)\.web$/.exec(i);
    if (/^wix-[a-z-]+$/.test(i)) ok(true, 'X4 ' + f.name + ' imports ' + i + ', a module Wix itself provides');
    else ok(!!m && names.has(m[1] + '.web.js'), 'X4 ' + f.name + ' imports ' + i + ', which is one of the 11 backend files');
  }
}
const used = new Set();
for (const f of PAGES) for (const m of f.text.matchAll(/from\s+['"]backend\/([A-Za-z0-9_-]+)\.web['"]/g)) used.add(m[1] + '.web.js');
eq([...names].filter((n) => !used.has(n)).sort(), [], 'X4 every one of the 11 backend files is used by some page');

done();
