#!/usr/bin/env node
/* Builds the backend files you paste into Wix.
 *
 * The source tree keeps shared code in helper files (rd-auth.js, rd-results.js, ...). Every web module imports some of them,
 * so a site needs all of those files too, each with the exact name. This tool puts the helper code a web module needs
 * inside that web module. The result is one file per web module (11 in all) and no file imports another file of ours.
 *
 * usage:
 *   node tools/inline_backend.mjs --out DIR     build every web module (each *.web.js under wix/) into DIR
 *   node tools/inline_backend.mjs --entry FILE  print one built file on stdout
 *   node tools/inline_backend.mjs --list        print each web module with the helper files it takes in
 *
 * What it does, and what it refuses to do:
 *   - a relative import  import { a, b as c } from './rd-auth.js'  becomes  const { a, b: c } = <the helper's exports>;
 *     and the helper's own code is put above it as a function that returns its exports, in dependency order.
 *   - imports of Wix modules (wix-data, wix-auth, ...) stay imports at the top of the file; those a helper needs are added.
 *   - the helper's `export const x`, `export function f` and `export { a }` lose the word export; nothing else changes.
 *   - the `const SETUP_KEY = '...'` line moves to the top of the file, so "the line at the top" is true.
 *   - it stops with an error on anything it cannot turn into the same behaviour: `export let`, `export default`, a re-export,
 *     a default or side-effect import of one of our files, an import cycle, two different imports with one local name,
 *     a helper that uses a global with the same name as a top-level name of the web module, syntax newer than ES2020,
 *     a missing `// END <file>` line at the end of a source file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadAcorn() {
  const tries = [path.join(ROOT, 'tests', 'package.json'), '/opt/node-tools/'];
  for (const base of tries) {
    try {
      return createRequire(base)('acorn');
    } catch (e) {
      /* try the next place */
    }
  }
  throw new Error('acorn is not installed: run "npm i" in the tests folder');
}
const acorn = loadAcorn();

const fail = (msg) => {
  throw new Error(msg);
};
const HELPER_DIRS = ['wix/director'];

const parse = (code, label) => {
  try {
    return acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' });
  } catch (e) {
    return fail(label + ': ' + e.message + ' (the pack must stay within ES2020)');
  }
};

// ---------------------------------------------------------------- finding files
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
export const entries = (root = ROOT) =>
  walk(path.join(root, 'wix'))
    .filter((f) => f.endsWith('.web.js'))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

const resolveHelper = (root, fromFile, spec) => {
  const name = path.basename(spec);
  const cands = [path.resolve(path.dirname(fromFile), spec), ...HELPER_DIRS.map((d) => path.join(root, d, name))];
  for (const c of cands) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return fail(path.basename(fromFile) + " imports '" + spec + "' but no such file is in " + HELPER_DIRS.join(', '));
};

// ---------------------------------------------------------------- reading one source file
const bindingNames = (pat, out = []) => {
  if (!pat) return out;
  if (pat.type === 'Identifier') out.push(pat.name);
  else if (pat.type === 'ObjectPattern') pat.properties.forEach((p) => bindingNames(p.type === 'RestElement' ? p.argument : p.value, out));
  else if (pat.type === 'ArrayPattern') pat.elements.forEach((e) => bindingNames(e, out));
  else if (pat.type === 'AssignmentPattern') bindingNames(pat.left, out);
  else if (pat.type === 'RestElement') bindingNames(pat.argument, out);
  return out;
};

// every identifier that is used in the file and is not a property name, a label or declared somewhere in the file
function freeNames(ast) {
  const used = new Set();
  const declared = new Set();
  const visit = (n, parent, key) => {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'Identifier': {
        const isProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) || (parent.type === 'MethodDefinition' && key === 'key' && !parent.computed) || (parent.type === 'PropertyDefinition' && key === 'key') || ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label'));
        if (!isProp) used.add(n.name);
        return;
      }
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        declared.add(n.local.name);
        return;
      case 'ExportSpecifier':
        visit(n.local, n, 'local');
        return;
      case 'VariableDeclarator':
        bindingNames(n.id).forEach((x) => declared.add(x));
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (n.id) declared.add(n.id.name);
        n.params.forEach((p) => bindingNames(p).forEach((x) => declared.add(x)));
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (n.id) declared.add(n.id.name);
        break;
      case 'CatchClause':
        if (n.param) bindingNames(n.param).forEach((x) => declared.add(x));
        break;
      default:
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, n, k));
      else if (v && typeof v.type === 'string') visit(v, n, k);
    }
  };
  visit(ast, null, null);
  return [...used].filter((x) => !declared.has(x));
}

const topNames = (ast) => {
  const out = new Set();
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') n.specifiers.forEach((s) => out.add(s.local.name));
    else if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => bindingNames(d.id).forEach((x) => out.add(x)));
    else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') out.add(n.id.name);
    else if (n.type === 'ExportNamedDeclaration' && n.declaration) {
      const d = n.declaration;
      if (d.type === 'VariableDeclaration') d.declarations.forEach((x) => bindingNames(x.id).forEach((y) => out.add(y)));
      else if (d.id) out.add(d.id.name);
    }
  }
  return out;
};

function readSource(abs) {
  const base = path.basename(abs);
  const text = fs.readFileSync(abs, 'utf8');
  const end = '\n// END ' + base + '\n';
  if (!text.endsWith(end)) fail(base + ': the last line must be "// END ' + base + '"');
  if (text.split('\n').filter((l) => /^\/\/ END /.test(l)).length !== 1) fail(base + ': more than one "// END" line');
  const ast = parse(text, base);
  const imports = [];
  const exportsOut = []; // { exported, local }
  const edits = []; // { start, end, text } on this file's text
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      imports.push(n);
    } else if (n.type === 'ExportDefaultDeclaration' || n.type === 'ExportAllDeclaration') {
      fail(base + ': "export default" and "export *" are not supported by the build');
    } else if (n.type === 'ExportNamedDeclaration') {
      if (n.source) fail(base + ': a re-export (export ... from) is not supported by the build');
      if (n.declaration) {
        const d = n.declaration;
        if (d.type === 'VariableDeclaration') {
          if (d.kind !== 'const') fail(base + ': "export ' + d.kind + '" is not supported (a later change would not reach the files that import it)');
          for (const x of d.declarations) {
            if (x.id.type !== 'Identifier') fail(base + ': an exported destructuring is not supported by the build');
            exportsOut.push({ exported: x.id.name, local: x.id.name });
          }
        } else if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') {
          exportsOut.push({ exported: d.id.name, local: d.id.name });
        } else fail(base + ': an export of this kind is not supported by the build');
        edits.push({ start: n.start, end: d.start, text: '' });
      } else {
        for (const s of n.specifiers) exportsOut.push({ exported: s.exported.name, local: s.local.name });
        let e = n.end;
        if (text[e] === '\n') e++;
        edits.push({ start: n.start, end: e, text: '' });
      }
    }
  }
  return { abs, base, text, ast, imports, exports: exportsOut, edits };
}

const applyEdits = (text, edits) => {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
};

const ident = (base) => '__h_' + base.replace(/\.js$/, '').replace(/[^A-Za-z0-9]/g, '_');

const wrapList = (head, items, tail) => {
  const one = head + items.join(', ') + tail;
  if (one.length <= 110) return one;
  const lines = [];
  let cur = '  ';
  for (const it of items) {
    if ((cur + it + ', ').length > 110) {
      lines.push(cur.replace(/\s+$/, ''));
      cur = '  ';
    }
    cur += it + ', ';
  }
  lines.push(cur.replace(/\s+$/, ''));
  return head.replace(/\s+$/, '') + '\n' + lines.join('\n') + '\n' + tail.replace(/^\s+/, '');
};

// ---------------------------------------------------------------- building one web module
export function build(entryAbs, root = ROOT) {
  const cache = new Map();
  const load = (abs) => {
    if (!cache.has(abs)) cache.set(abs, readSource(abs));
    return cache.get(abs);
  };
  const entry = load(entryAbs);
  const order = []; // helpers, dependencies first
  const state = new Map();
  const visit = (src, chain) => {
    for (const imp of src.imports) {
      const spec = imp.source.value;
      if (!/^\.\.?\//.test(spec)) continue;
      const dep = load(resolveHelper(root, src.abs, spec));
      if (state.get(dep.abs) === 'done') continue;
      if (state.get(dep.abs) === 'doing') fail('import cycle: ' + [...chain, src.base, dep.base].join(' -> '));
      state.set(dep.abs, 'doing');
      visit(dep, [...chain, src.base]);
      state.set(dep.abs, 'done');
      order.push(dep);
    }
  };
  state.set(entry.abs, 'doing');
  visit(entry, []);

  // imports of Wix modules: what the entry has, then what each helper adds
  const have = new Map(); // key "source|kind|imported" -> local
  const localTaken = new Map(); // local name -> key
  const entryTop = topNames(entry.ast);
  const addExternal = (imp, who, isEntry) => {
    const added = [];
    for (const s of imp.specifiers) {
      const kind = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? 'ns' : 'named';
      const key = imp.source.value + '|' + kind + '|' + (kind === 'named' ? s.imported.name : '');
      const local = s.local.name;
      if (localTaken.has(local) && localTaken.get(local) !== key) fail(who + ": the name '" + local + "' is imported twice for different things (" + localTaken.get(local) + ' and ' + key + ')');
      if (have.has(key)) {
        if (have.get(key) !== local) fail(who + ': ' + key + " is imported as '" + have.get(key) + "' and as '" + local + "'");
        continue;
      }
      if (!isEntry && entryTop.has(local)) fail(who + ": its import '" + local + "' has the same name as a top-level name of " + entry.base);
      have.set(key, local);
      localTaken.set(local, key);
      added.push({ kind, imported: kind === 'named' ? s.imported.name : '', local });
    }
    return added;
  };
  for (const imp of entry.imports) if (!/^\.\.?\//.test(imp.source.value)) addExternal(imp, entry.base, true);

  const hoisted = []; // lines to add after the entry's imports
  const hoistedBySource = new Map();
  for (const h of order) {
    for (const imp of h.imports) {
      if (/^\.\.?\//.test(imp.source.value)) continue;
      const add = addExternal(imp, h.base, false);
      if (!add.length) continue;
      if (!hoistedBySource.has(imp.source.value)) hoistedBySource.set(imp.source.value, []);
      hoistedBySource.get(imp.source.value).push(...add);
    }
  }
  for (const [source, specs] of hoistedBySource) {
    const def = specs.find((s) => s.kind === 'default');
    const ns = specs.find((s) => s.kind === 'ns');
    const named = specs.filter((s) => s.kind === 'named').map((s) => (s.imported === s.local ? s.local : s.imported + ' as ' + s.local));
    if (ns && (def || named.length)) fail('an import mixing * with other names from ' + source + ' is not supported');
    const parts = [];
    if (def) parts.push(def.local);
    if (ns) parts.push('* as ' + ns.local);
    if (named.length) parts.push('{ ' + named.join(', ') + ' }');
    hoisted.push('import ' + parts.join(', ') + " from '" + source + "';");
  }

  // a helper must not use, as a global, a name that the web module declares at the top level (it would find that one instead)
  for (const h of order) {
    const clash = freeNames(h.ast).filter((x) => entryTop.has(x));
    if (clash.length) fail(h.base + ' uses ' + clash.join(', ') + ' as a global, and ' + entry.base + ' declares the same name at its top level');
  }
  const mine = [...entryTop].filter((x) => x.startsWith('__h_'));
  if (mine.length) fail(entry.base + ' uses a name that starts with __h_, which the build keeps for itself: ' + mine.join(', '));

  // the text of each helper, as a function that returns what the file exports
  const destructure = (src, imp) => {
    const dep = load(resolveHelper(root, src.abs, imp.source.value));
    const names = new Set(dep.exports.map((x) => x.exported));
    const props = [];
    for (const s of imp.specifiers) {
      if (s.type === 'ImportDefaultSpecifier') fail(src.base + ": a default import of '" + imp.source.value + "' is not supported by the build");
      if (s.type === 'ImportNamespaceSpecifier') return 'const ' + s.local.name + ' = ' + ident(dep.base) + ';';
      if (!names.has(s.imported.name)) fail(src.base + ": '" + s.imported.name + "' is imported from " + dep.base + ', which does not export it');
      props.push(s.imported.name === s.local.name ? s.local.name : s.imported.name + ': ' + s.local.name);
    }
    if (!props.length) fail(src.base + ': an import of ' + dep.base + ' that names nothing is not supported by the build');
    return wrapList('const { ', props, ' } = ' + ident(dep.base) + ';');
  };
  const rewrite = (src, isEntry) => {
    const edits = isEntry ? [] : [...src.edits]; // a helper loses the word export; the web module keeps its exports
    const keepExternal = isEntry;
    const later = [];
    for (const imp of src.imports) {
      let e = imp.end;
      if (src.text[e] === '\n') e++;
      if (/^\.\.?\//.test(imp.source.value)) {
        if (keepExternal) {
          edits.push({ start: imp.start, end: e, text: '' });
          later.push(destructure(src, imp));
        } else {
          edits.push({ start: imp.start, end: e, text: destructure(src, imp) + '\n' });
        }
      } else if (!keepExternal) {
        edits.push({ start: imp.start, end: e, text: '' });
      }
    }
    return { edits, later };
  };

  const blocks = [];
  for (const h of order) {
    const { edits } = rewrite(h, false);
    let body = applyEdits(h.text, edits);
    body = body.slice(0, body.length - ('\n// END ' + h.base + '\n').length) + '\n';
    const names = h.exports.map((x) => (x.exported === x.local ? x.exported : x.exported + ': ' + x.local));
    blocks.push(
      '// ' + '-'.repeat(100) + '\n' +
        '// Built in: ' + h.base + ' (this code used to be the separate file ' + h.base + '; nothing to paste for it any more)\n' +
        '// ' + '-'.repeat(100) + '\n' +
        'const ' + ident(h.base) + ' = (() => {\n' +
        body +
        wrapList('return { ', names, ' };') + '\n' +
        '})();\n'
    );
  }

  // the web module itself
  const { edits, later } = rewrite(entry, true);
  const lastImport = entry.imports.length ? entry.imports[entry.imports.length - 1] : null;
  const insertAt = lastImport ? lastImport.end + (entry.text[lastImport.end] === '\n' ? 1 : 0) : 0;
  const key = entry.ast.body.find((n) => n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.name === 'SETUP_KEY');
  let keyText = '';
  if (key) {
    if (key.declarations[0].init.type !== 'Literal') fail(entry.base + ': SETUP_KEY must be a plain text value');
    let from = entry.text.lastIndexOf('\n', key.start - 1) + 1; // the start of the key's line
    while (from > 0) {
      // the comment lines right above it travel with it
      const prev = entry.text.lastIndexOf('\n', from - 2) + 1;
      if (/^\s*\/\//.test(entry.text.slice(prev, from - 1))) from = prev;
      else break;
    }
    const to = key.end + (entry.text[key.end] === '\n' ? 1 : 0);
    keyText = entry.text.slice(from, to);
    edits.push({ start: from, end: to, text: '' });
  }
  edits.push({ start: insertAt, end: insertAt, text: (hoisted.length ? hoisted.join('\n') + '\n' : '') + (order.length ? '\n' + blocks.join('\n') + '\n' : '') + (later.length ? later.join('\n') + '\n' : '') });
  const body = applyEdits(entry.text, edits);

  const rule = '// ' + '='.repeat(100) + '\n';
  const banner =
    rule +
    '// RaceOS backend file ' + entry.base + '. Paste this whole file as it is into the Backend section of your Wix site.\n' +
    '// It has everything it needs inside it' + (order.length ? ' (the code of ' + order.map((h) => h.base).join(', ') + ')' : '') + ': there is no other file of ours to add for it.\n' +
    (key ? '// The one line to change is the SETUP_KEY line just below (see SETUP.md).\n' : '') +
    '// Built from the source files by tools/inline_backend.mjs. The last line of the file is "// END ' + entry.base + '"; if yours does not end like that, the paste was cut short.\n' +
    rule + '\n';
  const text = banner + (keyText ? keyText + '\n' : '') + body;

  // checks on the result
  const label = entry.base + ' (built)';
  const out = parse(text, label);
  const rel = out.body.filter((n) => n.type === 'ImportDeclaration' && /^\.\.?\//.test(n.source.value));
  if (rel.length) fail(label + ': a relative import is left: ' + rel.map((n) => n.source.value));
  const exp = (ast) => ast.body.flatMap((n) => (n.type === 'ExportNamedDeclaration' ? (n.declaration ? (n.declaration.declarations ? n.declaration.declarations.map((d) => d.id.name) : [n.declaration.id.name]) : n.specifiers.map((s) => s.exported.name)) : []));
  const before = exp(entry.ast).join(',');
  const after = exp(out).join(',');
  if (before !== after) fail(label + ': the exported names changed (' + before + ' -> ' + after + ')');
  if (!text.endsWith('\n// END ' + entry.base + '\n')) fail(label + ': lost its last line');
  if (text.split('\n').filter((l) => /^\/\/ END /.test(l)).length !== 1) fail(label + ': more than one END line');
  const keys = text.split('\n').filter((l) => /^const SETUP_KEY = /.test(l)).length;
  if (keys !== (key ? 1 : 0)) fail(label + ': the SETUP_KEY line count is ' + keys);
  return { name: entry.base, text, helpers: order.map((h) => h.base), exports: exp(out), size: Buffer.byteLength(text) };
}

export function buildAll(root = ROOT) {
  return entries(root).map((f) => build(f, root));
}

// ---------------------------------------------------------------- command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  try {
    if (a.includes('--entry')) {
      process.stdout.write(build(path.resolve(arg('--entry'))).text);
    } else if (a.includes('--list')) {
      for (const b of buildAll()) console.log(b.name.padEnd(18), String(Math.round(b.size / 1024)).padStart(4) + ' KB', b.exports.length + ' methods;', 'takes in:', b.helpers.join(' ') || '-');
    } else if (arg('--out')) {
      const out = path.resolve(arg('--out'));
      fs.mkdirSync(out, { recursive: true });
      for (const b of buildAll()) fs.writeFileSync(path.join(out, b.name), b.text);
      console.error('built ' + entries().length + ' files into ' + out);
    } else {
      console.error('usage: node tools/inline_backend.mjs --out DIR | --entry FILE | --list');
      process.exit(2);
    }
  } catch (e) {
    console.error('BUILD FAILED: ' + e.message);
    process.exit(1);
  }
}
