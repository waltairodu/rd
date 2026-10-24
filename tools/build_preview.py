#!/usr/bin/env python3
"""Builds docs/approvals-preview.html: a stand-alone page that runs the approvals library (wix/director/rd-approvals.js),
so the template, the dates and the letters can be tried without Wix. Run again after changing rd-approvals.js."""
import os, re
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
lib = open(os.path.join(root, 'wix/director/rd-approvals.js'), encoding='utf-8').read()
lib = re.sub(r'^export (const|function|let) ', r'\1 ', lib, flags=re.M)
assert not re.search(r'^export\b', lib, flags=re.M), 'unexpected export form'
assert '</script' not in lib.lower()
names = 'isDate,isTime,addDays,longDate,weekdayOf,minusMinutes,clock12,ordinalOf,editionLabel,indian,SCOPES,defaultScope,cleanScope,PERMITS,SIGNOFFS,permitByKey,signoffByKey,authorityName,suggest,planRows,follow,paragraphs,renderLetter'
tpl = open(os.path.join(root, 'tools/approvals-preview.tpl.html'), encoding='utf-8').read()
assert tpl.count('/*__LIB__*/') == 1
out = tpl.replace('/*__LIB__*/', lib + '\nreturn { ' + names.replace(',', ', ') + ' };')
dest = os.path.join(root, 'docs/approvals-preview.html')
open(dest, 'w', encoding='utf-8').write(out)
print('docs/approvals-preview.html', len(out), 'bytes')
