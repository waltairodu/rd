#!/usr/bin/env python3
"""Builds the folder and the zip you upload to Wix: dist/vtra-wix/ and dist/vtra-wix-files.zip.

  1-backend/   the 11 backend files, named exactly as they must be in Wix. Each is one web module with the helper code it needs
               inside it (tools/inline_backend.mjs), so there is no other backend file to add
  2-pages/     per page: the embed to paste into the HTML element, and the page code
  3-database/  COLLECTIONS.md (the 37 collections, in plain words) and collections.json (the same, for a program)
  SETUP.md     the steps for a first install, and how to run and log in
  UPGRADE.md   what to replace if an earlier package is already installed
  TESTING.md   the last test report

usage: python3 tools/make_pack.py [--name vtra-wix]
Rebuilds wix/director/rd-embed.html first (tools/build_rd.py), so the page you ship is always the current one.
"""
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[sys.argv.index('--name') + 1] if '--name' in sys.argv else 'vtra-wix'
subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_rd.py')], check=True, stdout=subprocess.DEVNULL)

WEB_MODULES = [
    'comms.web.js', 'exposoft.web.js', 'finance.web.js', 'print.web.js', 'privacy.web.js', 'racedir.web.js',
    'reports.web.js', 'results.web.js', 'runner.web.js', 'training.web.js', 'waivers.web.js',
]
# pages added by later packages are listed in tools/pack_extra.txt as "page folder embed pagecode"
PAGES = {
    'rd': ('wix/director/rd-embed.html', 'wix/director/director-page-code.js'),
    'volunteer': ('wix/director/volunteer-embed.html', 'wix/director/volunteer-page-code.js'),
    'train': ('wix/training/athlete-embed.html', 'wix/training/athlete-page-code.js'),
    'coach': ('wix/training/coach-embed.html', 'wix/training/coach-page-code.js'),
}
extra = os.path.join(ROOT, 'tools', 'pack_extra.txt')
if os.path.exists(extra):
    for ln in open(extra, encoding='utf-8'):
        p = ln.split('#')[0].split()
        if not p:
            continue
        if p[0] == 'page':
            PAGES[p[1]] = (p[2], p[3])

dist = os.path.join(ROOT, 'dist')
out = os.path.join(dist, name)
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, '1-backend'))
# the backend: one self-contained file per web module, made from the source files by the build tool
subprocess.run(['node', os.path.join(ROOT, 'tools', 'inline_backend.mjs'), '--out', os.path.join(out, '1-backend')], check=True, stdout=subprocess.DEVNULL)
built = sorted(os.listdir(os.path.join(out, '1-backend')))
if built != sorted(WEB_MODULES):
    sys.exit('the build made %s, wanted %s' % (built, sorted(WEB_MODULES)))
for f in built:
    t = open(os.path.join(out, '1-backend', f), encoding='utf-8').read()
    if not t.endswith('\n// END ' + f + '\n') or " from './" in t or ' from "./' in t:
        sys.exit(f + ': the built file is not whole (END line or a relative import)')
# the database: the list of collections, made from the same source
os.makedirs(os.path.join(out, '3-database'))
shutil.copy(os.path.join(ROOT, 'docs', 'COLLECTIONS.md'), os.path.join(out, '3-database', 'COLLECTIONS.md'))
with open(os.path.join(out, '3-database', 'collections.json'), 'w', encoding='utf-8') as fh:
    fh.write(subprocess.run(['node', os.path.join(ROOT, 'tools', 'collections.mjs'), '--json'], check=True, stdout=subprocess.PIPE, text=True).stdout)
for page, (embed, code) in PAGES.items():
    d = os.path.join(out, '2-pages', page)
    os.makedirs(d)
    shutil.copy(os.path.join(ROOT, embed), os.path.join(d, os.path.basename(embed)))
    shutil.copy(os.path.join(ROOT, code), os.path.join(d, 'page-code.js'))
shutil.copy(os.path.join(ROOT, 'docs', 'SETUP.md'), os.path.join(out, 'SETUP.md'))
if os.path.exists(os.path.join(ROOT, 'docs', 'TESTING.md')):
    shutil.copy(os.path.join(ROOT, 'docs', 'TESTING.md'), os.path.join(out, 'TESTING.md'))
# docs/UPGRADE.md says which files to add or replace on a site that already runs the previous package
if os.path.exists(os.path.join(ROOT, 'docs', 'UPGRADE.md')):
    shutil.copy(os.path.join(ROOT, 'docs', 'UPGRADE.md'), os.path.join(out, 'UPGRADE.md'))

z = os.path.join(dist, name + '-files.zip')
if os.path.exists(z):
    os.remove(z)
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for base, _, files in os.walk(out):
        for f in sorted(files):
            full = os.path.join(base, f)
            zf.write(full, os.path.join(name, os.path.relpath(full, out)))
print('built', os.path.relpath(out, ROOT), 'and', os.path.relpath(z, ROOT), '(%d KB)' % (os.path.getsize(z) // 1024))
for base, _, files in sorted(os.walk(out)):
    for f in sorted(files):
        print('  ', os.path.relpath(os.path.join(base, f), out))
