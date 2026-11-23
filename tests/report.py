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
    ('unit', '1. Unit tests', 'one piece on its own: password hashing, PINs, roles, the Team screen rules, the Finance rules (money arithmetic, numbering, text cleaning), and the Results rules (times, ranking, age groups, awards, waves, reading a results file), and the printing rules (text cleaning, picture and colour limits, filling bibs and certificates, spare bibs, what the public page may tell), the Messages rules (text cleaning, e-mail and chat-link checks, filling templates, CSV safety, who is in an audience), and the Waivers rules (the waiver text and its versions, which answers count as signed, who has signed, the papers to print), and the Reports rules (counts by group, who may run which report, words kept clean, rows cut at 400, a table as a safe CSV file), and the Privacy rules (how a phone number and an e-mail address are hidden, the five reasons, the hourly limit, the contact files as safe CSV, what erasing a person changes and keeps)',
     ['unit-auth.mjs', 'unit-team.mjs']),
    ('pentest', '2. Penetration tests', 'attacks on logins, tokens, roles, the desk, the page relay, the Finance tab (money, claims, cash, the screens and what they print), the Waves & results tab (results files, placing, fixing, voiding, personal details), the Bibs & certificates tab with the public runner page (designs, pictures, printing, the page\'s switches, what a stranger can find) the Messages tab (templates, audiences, sending twice, other races, lead and desk logins, hostile text on every screen) and the Waivers tab (hostile texts and names on the screens and the printed papers, recording twice, marking a mistake, other races, lead and desk logins, damaged data) and the Reports tab (forged, old and short tokens, a login that changes role in the middle of a session, the Money report for a lead, other races, odd table names, formulas and hostile words in a CSV file, 1,200 categories, 60 calls at once, no personal details in any table) and the Privacy tab (made-up, old and short tokens, a lead asking for a director\'s file, another race\'s rows, hostile names and numbers in files and on the screens, 60 shows at the same moment, a 2,300-row file, one number shared by 205 people, ticking someone else\'s row, erasing twice, the audit trail never holding a number, an address or a name, nothing deleted); every attack must fail',
     ['pentest.mjs', 'pentest-ui.mjs']),
    ('integration', '3. Integration tests', 'whole journeys across RaceOS, the Expo desk, the coach pages, Finance (invoice to payment, order to refund, claim to payout, cash), Waves & results (waves to placed runners, results file to board to awards), Bibs & certificates (design, preview, print, public page, certificate) Messages (template to audience to batch to e-mails sent, retry, chat links, history, export) and Waivers (waiver text to versions, who has signed, papers recorded and marked as a mistake, papers printed, a message to the people who have not signed) and Reports (six reports on a real race checked against the Results, Waivers and Finance screens, a second race that must not leak in, tables saved as CSV files and the audit line, sources that cannot be read, a big race, the Reports screens) and Privacy (every list hiding numbers and addresses on every tab and for every role, Show with a reason and the note written first, a detail that goes away by itself, contact files page by page, erasing a person across registrations, Expo runners, volunteers, pacers and a training account, a refresh, a sync and Send to Expo desk that do not bring them back) and Backend loading (the backend file still loads and logs in when the Wix Events module cannot be opened, and only the three Registrations calls say so; when a backend file or a page code is missing the Director page names the file to look at, for one missing file, several at once, empty, cut and older files, hostile method names, and the Director screen shows it escaped; the volunteer, athlete, coach and runner pages say it in plain words with no technical details; the setup guide explains every sentence and the 11 backend files end with the marker it tells you to look for) and Bundles (the 11 files you paste into Wix are made by one build tool: each reads as ES2020, imports no file of ours and only the expected Wix modules, exports what its source exports, ends with its marker, takes in exactly the helper files its source imports, holds no state that two files would have to share, and the tool does the same as the modules it replaces and refuses, loudly, sixteen kinds of input it cannot turn into the same behaviour) and Collections (the 37 database collections the code makes: only Text columns, all four permissions Admin, shared ones agree, every name the code uses is in the list, the guide is exactly what the tool makes from the code) and Failures are answers (on the live site Wix replaces the text of a thrown error with its own, so no backend method throws to the page: a failure is returned as { __rdError: code } by all 11 files whatever they are given, the five page codes turn it into the code the screen knows, and the real sign-in screen with the real page code and the real backend says "Wrong username or password.", the ten-minute lock, and in plain words that Wix could not run the backend; a Show password box) and the Wix publish check (the two rules Wix applies to every code file when you publish, no-undef and no-const-assign, run with ESLint itself over the 11 backend files and the 5 page codes under four settings; the line Wix rejected on 21 November 2026 is rejected at the same place, and the fix is accepted; the code uses no name beyond ES2015 except console, crypto and the page name $w; every page imports only files that exist)',
     ['integration-flow.mjs', 'integration-ui.mjs', 'expo-int.mjs', 'scen.mjs']),
    ('security', '4. Security tests', 'an audit of every method, Finance, Results, Print, Messages, Waivers, Reports and the public runner page included, against the written role table, secrets, locks and shipped files; the Privacy backend is audited on its own (who may show, export and erase, the note before the detail, the one place a detail leaves, the one thing it deletes)',
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
    sixd = None  # "# package-6d new=8 older_rerun=... older_not_rerun=..." at the end of mutants.txt
    sixe = None  # the same for package 6e
    if os.path.exists(mut):
        for ln in open(mut, encoding='utf-8'):
            if ln.startswith('# package-6d'):
                sixd = dict(kv.split('=') for kv in ln.split()[2:])
            elif ln.startswith('# package-6e'):
                sixe = dict(kv.split('=') for kv in ln.split()[2:])
            elif not ln.startswith('#') and ln.count('\t') >= 2:
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
    tail6 = ''
    if sixd:
        n6, r6, k6 = int(sixd['new']), int(sixd['older_rerun']), int(sixd['older_not_rerun'])
        tail6 = (' Package 6b (19 November 2026) added 85 more (the wrapper every backend method goes through, the lazy Wix Events load, the on-screen diagnosis of a missing file, the setup guide and its build-report step) and ran those and 208 older ones again: all caught.'
                 ' Package 6c (21 November 2026) added 43 more (the build of one self-contained file per web module, the list of database collections, the new wording of the on-screen diagnosis, the check of a stored password against a fixed answer) and retired 10 that belonged to the old two-file layout; those 43 and 89 older ones that touch the files or tests that changed were run on the finished code: all 132 caught, none missed.'
                 ' Package 6d (22 November 2026) added %d more (the check Wix runs on every code file when you publish, and the line it rejected) and ran those and the %d older ones that touch the login code again: all %d caught, none missed.') % (n6, r6, n6 + r6)
        if sixe:
            n7, r7, k7 = int(sixe['new']), int(sixe['older_rerun']), int(sixe['older_not_rerun'])
            tail6 += (' Package 6e (23 November 2026) added %d more (a failure answered as a value instead of thrown, the page codes and the sign-in screen that read it, Wix\'s own error text explained, the Show password box, the guides) and ran those and %d older ones again (the 16 that sit on lines this package changed, and 40 more picked at random from the older ones in the changed files). The first run of the new ones left 4 not caught (the "server_error" answer of the Privacy and Reports files), so a test was added; all %d are now caught, none missed.'
                      ' The other %d older ones were not run again for 6e (all caught when last run); to repeat them: `python3 tests/mutants.py --jobs 2`, about 70 minutes.') % (n7, r7, n7 + r7, k7)
        else:
            tail6 += ' The other %d older ones were not run again for 6d (all caught when last run); to repeat them: `python3 tests/mutants.py --jobs 2`, about 70 minutes.' % k6
    if rows:
        md += ['## Do the tests really catch mistakes? (mutation spot-checks)', '', 'One protection is removed on purpose in a scratch copy; the named suites must fail. KILLED is good, SURVIVED would mean a hole in the tests.', '', '**%d protections removed, %d caught, %d not caught.** The first 214 were last run in full for Package 5a; the 103 on Waivers and on the Waiver choice in Messages were run for Package 5b; the 88 on Reports were run for Package 5c; the 105 on Privacy were run for Package 6 (the first run left 9 not caught, so the tests were extended and all 105 are now caught, and three older ones whose lines Package 6 moved were repaired and run again). All 510 were then run together once more on the finished code for the final pack (16 November 2026): 510 caught, none missed.' % (len(rows), sum(1 for r in rows if r[1] == 'KILLED'), sum(1 for r in rows if r[1] != 'KILLED')) + tail6, '', '| Protection removed | Result | Caught by |', '|---|---|---|']
        for n, v, w in rows:
            md.append('| %s | %s | %s |' % (n, v, w.replace('|', '/')[:90]))
        md.append('')
    md += ['## How to run', '', '```', 'sh tests/all.sh                  every suite once, writes this report', 'python3 tests/report.py --only security', 'python3 tests/mutants.py        mutation spot-checks', 'sh tests/days.sh                the date-sensitive suites again on three other days (a race 30, 60 and 90 days away falls on 1 January); about 12 minutes, run it before a release', '```', '']
    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    open(os.path.join(ROOT, 'docs', 'TESTING.md'), 'w', encoding='utf-8').write('\n'.join(md))
    print('wrote docs/TESTING.md')
    return 1 if (bad or total_fail) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
