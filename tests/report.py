#!/usr/bin/env python3
"""Runs every test suite once, groups the results by kind of test, compares each older suite with the regression
baseline (tests/baseline.txt) and writes docs/TESTING.md.

usage:  python3 tests/report.py              run all suites, print the table, write docs/TESTING.md
        python3 tests/report.py --only unit  run one group (unit, component, integration, ui, pentest, security)
        python3 tests/report.py --mutants    also run the mutation spot-checks (slow) and put them in the report
Exit status is 1 when a check fails or an older suite now passes fewer checks than the baseline.
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# kind of test -> (title, what it shows, suites)
GROUPS = [
    ('unit', '1. Unit tests', 'one piece on its own: password hashing, PINs, roles, the Team screen rules, and the Finance rules (money arithmetic, numbering, text cleaning)',
     ['unit-auth.mjs', 'unit-team.mjs']),
    ('pentest', '2. Penetration tests', 'attacks on logins, tokens, roles, the desk, the page relay and the Finance tab (money, claims, cash, the screens and what they print); every attack must fail',
     ['pentest.mjs', 'pentest-ui.mjs']),
    ('integration', '3. Integration tests', 'whole journeys across RaceOS, the Expo desk, the coach pages and Finance (invoice to payment, order to refund, claim to payout, cash)',
     ['integration-flow.mjs', 'integration-ui.mjs', 'expo-int.mjs', 'scen.mjs']),
    ('security', '4. Security tests', 'an audit of every method, Finance included, against the written role table, secrets, locks and shipped files',
     ['security.mjs']),
    ('component', 'Component tests (older suites)', 'each backend method and each screen, one by one; these also form the regression set',
     ['director.mjs', 'plan.mjs', 'dash.mjs', 'ai.mjs', 'approvals.mjs', 'training.mjs', 'director-ui.mjs', 'plan-ui.mjs', 'dash-ui.mjs',
      'coaching-ui.mjs', 'bibs-ai-ui.mjs', 'training-ui.mjs', 'training-ai.mjs', 'approvals-ui.mjs', 'preview-ui.mjs', 'pagecode.mjs', 'ui.mjs', 'rd-ui.mjs']),
]
EXTRA = []  # suites added by later packages are listed in tests/suites.txt: "group suite.mjs"
p = os.path.join(HERE, 'suites.txt')
if os.path.exists(p):
    for ln in open(p, encoding='utf-8'):
        ln = ln.strip()
        if ln and not ln.startswith('#'):
            g, s = ln.split()
            EXTRA.append((g, s))
for g, s in EXTRA:
    for grp in GROUPS:
        if grp[0] == g and s not in grp[3]:
            grp[3].append(s)


def baseline():
    out = {}
    p = os.path.join(HERE, 'baseline.txt')
    if os.path.exists(p):
        for ln in open(p, encoding='utf-8'):
            ln = ln.strip()
            if ln and not ln.startswith('#'):
                a, b = ln.split()
                out[a] = int(b)
    return out


def run(suite):
    t = time.time()
    try:
        r = subprocess.run(['sh', 'run.sh', suite], cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=900)
        text, code = r.stdout, r.returncode
    except subprocess.TimeoutExpired as e:
        text, code = (e.stdout or '') + '\nTIMEOUT', 124
    m = None
    for ln in reversed(text.splitlines()):
        m = re.search(r'(\d+) passed, (\d+) failed', ln)
        if m:
            break
    passed, failed = (int(m.group(1)), int(m.group(2))) if m else (0, 1 if code else 0)
    if code and not failed:
        failed = 1
    fails = [ln.strip() for ln in text.splitlines() if ln.strip().startswith('FAIL')][:5]
    return passed, failed, time.time() - t, fails


def main(argv):
    only = argv[argv.index('--only') + 1] if '--only' in argv else None
    doc_only = '--doc-only' in argv  # rebuild docs/TESTING.md from the last run without running anything
    base = baseline()
    lines = []
    bad = 0
    total_pass = total_fail = 0
    results = {}
    started = time.time()
    last = os.path.join(HERE, 'last-run.json')
    if doc_only:
        results = {k: tuple(v) for k, v in json.load(open(last, encoding='utf-8')).items()}
        total_pass = sum(v[1] for v in results.values())
        total_fail = sum(v[2] for v in results.values())
    for key, title, what, suites in GROUPS:
        if only and key != only:
            continue
        if doc_only:
            break
        for s in suites:
            if not os.path.exists(os.path.join(HERE, s)):
                continue
            pa, fa, secs, fails = run(s)
            results[s] = (key, pa, fa, secs)
            total_pass += pa
            total_fail += fa
            low = s in base and pa < base[s]
            flag = 'FAIL' if fa else ('FEWER THAN BASELINE (%d)' % base[s] if low else 'ok')
            if fa or low:
                bad += 1
            print('%-12s %-24s %5d passed %3d failed  %5.1fs  %s' % (key, s, pa, fa, secs, flag))
            for f in fails:
                print('    ' + f)
            sys.stdout.flush()
    print('\nTOTAL %d passed, %d failed in %.0fs (%d suites)' % (total_pass, total_fail, time.time() - started, len(results)))
    if not only and not doc_only:
        json.dump(results, open(last, 'w', encoding='utf-8'))

    mut = os.path.join(HERE, 'mutants.txt')
    if '--mutants' in argv:
        subprocess.run([sys.executable, os.path.join(HERE, 'mutants.py'), '--jobs', '4', '--write', mut], cwd=ROOT)
    rows = []
    if os.path.exists(mut):
        for ln in open(mut, encoding='utf-8'):
            if not ln.startswith('#') and ln.count('\t') >= 2:
                rows.append(ln.rstrip('\n').split('\t', 2))

    if only:
        return 1 if bad else 0
    md = ['# Test report', '', 'Made by `python3 tests/report.py` (every suite, run once). Re-run it after any change.', '']
    md += ['| Kind of test | Suites | Checks passed | Failed |', '|---|---|---|---|']
    for key, title, what, suites in GROUPS:
        have = [s for s in suites if s in results]
        if not have:
            continue
        md.append('| %s | %d | %d | %d |' % (title, len(have), sum(results[s][1] for s in have), sum(results[s][2] for s in have)))
    reg = [s for s in results if s in base]
    md.append('| 5. Regression (older suites against the saved baseline) | %d | %d | %d |' % (len(reg), sum(results[s][1] for s in reg), sum(1 for s in reg if results[s][1] < base[s]) + sum(results[s][2] for s in reg)))
    md += ['', '**Total: %d checks passed, %d failed.**' % (total_pass, total_fail), '']
    for key, title, what, suites in GROUPS:
        have = [s for s in suites if s in results]
        if not have:
            continue
        md += ['## ' + title, '', what[0].upper() + what[1:] + '.', '', '| Suite | Passed | Failed |', '|---|---|---|']
        for s in have:
            md.append('| `%s` | %d | %d |' % (s, results[s][1], results[s][2]))
        md.append('')
    md += ['## 5. Regression', '', 'Every suite that existed before a change must still pass at least as many checks as the saved baseline (`tests/baseline.txt`). A suite that passes fewer, or fails one, is flagged above.', '', '| Suite | Baseline | Now |', '|---|---|---|']
    for s in sorted(reg):
        md.append('| `%s` | %d | %d |' % (s, base[s], results[s][1]))
    md.append('')
    if rows:
        md += ['## Do the tests really catch mistakes? (mutation spot-checks)', '', 'One protection is removed on purpose in a scratch copy; the named suites must fail. KILLED is good, SURVIVED would mean a hole in the tests.', '', '| Protection removed | Result | Caught by |', '|---|---|---|']
        for n, v, w in rows:
            md.append('| %s | %s | %s |' % (n, v, w.replace('|', '/')[:90]))
        md.append('')
    md += ['## How to run', '', '```', 'sh tests/all.sh                  every suite once, writes this report', 'python3 tests/report.py --only security', 'python3 tests/mutants.py        mutation spot-checks', '```', '']
    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    open(os.path.join(ROOT, 'docs', 'TESTING.md'), 'w', encoding='utf-8').write('\n'.join(md))
    print('wrote docs/TESTING.md')
    return 1 if (bad or total_fail) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
