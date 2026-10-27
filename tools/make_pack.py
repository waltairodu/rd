#!/usr/bin/env python3
"""Builds the folder and the zip you upload to Wix: dist/vtra-wix/ and dist/vtra-wix-files.zip.

  1-backend/   every backend file, named exactly as it must be in Wix (the .web.js files, and the plain files)
  2-pages/     per page: the embed to paste into the HTML element, and the page code
  SETUP.md     the steps
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

BACKEND = [
    'wix/director/racedir.web.js', 'wix/expo/exposoft.web.js', 'wix/training/training.web.js',
    'wix/director/rd-auth.js', 'wix/director/ai-core.js', 'wix/director/rd-approvals.js',
]
# more backend files added by later packages are listed in tools/pack_extra.txt as "backend path" or "page folder embed pagecode"
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
        if p[0] == 'backend':
            BACKEND.append(p[1])
        elif p[0] == 'page':
            PAGES[p[1]] = (p[2], p[3])

dist = os.path.join(ROOT, 'dist')
out = os.path.join(dist, name)
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, '1-backend'))
for f in BACKEND:
    shutil.copy(os.path.join(ROOT, f), os.path.join(out, '1-backend', os.path.basename(f)))
for page, (embed, code) in PAGES.items():
    d = os.path.join(out, '2-pages', page)
    os.makedirs(d)
    shutil.copy(os.path.join(ROOT, embed), os.path.join(d, os.path.basename(embed)))
    shutil.copy(os.path.join(ROOT, code), os.path.join(d, 'page-code.js'))
shutil.copy(os.path.join(ROOT, 'docs', 'SETUP.md'), os.path.join(out, 'SETUP.md'))
if os.path.exists(os.path.join(ROOT, 'docs', 'TESTING.md')):
    shutil.copy(os.path.join(ROOT, 'docs', 'TESTING.md'), os.path.join(out, 'TESTING.md'))

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
