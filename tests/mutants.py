#!/usr/bin/env python3
"""Mutation spot-checks: break one defence on purpose and make sure the test suites notice.

A "mutant" is one small change that removes or weakens a protection (a check, an escape, a lock).
Each mutant lists the suites that must catch it. For every mutant this script
  1. copies the whole project to a scratch folder (the real files are never touched),
  2. applies the change there,
  3. runs those suites with tests/run.sh,
  4. reports KILLED when a suite fails (good: the tests noticed) or SURVIVED (bad: a hole in the tests).

usage:  python3 tests/mutants.py                 run every mutant (4 at a time)
        python3 tests/mutants.py NAME ...        run only the named ones
        python3 tests/mutants.py --list          list them
        python3 tests/mutants.py --jobs 2 ...    how many at the same time
        python3 tests/mutants.py --write FILE    also write the results table to FILE (used by the test report)
Exit status is 1 when any mutant survives.
"""
import concurrent.futures
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DIR = 'wix/director/director-embed.html'
EXPO = 'wix/expo/exposoft-embed.html'
RD = 'wix/director/racedir.web.js'
XB = 'wix/expo/exposoft.web.js'
AUTH = 'wix/director/rd-auth.js'
TR = 'wix/training/training.web.js'
FIN = 'wix/director/finance.web.js'
FINLIB = 'wix/director/rd-finance.js'
FINPAGE = 'wix/director/director-page-code.js'

# name, file, old text (must occur exactly once), new text, suites that must fail
MUTANTS = [
    ('shell-believes-desk-answers', DIR, "  if(m&&m.kind==='result'&&fromXf)return; /* answers come from the Wix page, never from the desk frame inside this page */\n", '', ['pentest-ui.mjs']),
    ('desk-believes-any-answer', EXPO, "  if(e.source!==window.parent)return; /* only the RaceOS page that holds this desk may answer it */\n", '', ['pentest-ui.mjs']),
    ('desk-shows-any-selfie', EXPO, "function imgSrc(s){s=String(s||'');return /^data:image\\/(jpeg|png|webp);base64,[A-Za-z0-9+\\/=]+$/.test(s)?s:''}", "function imgSrc(s){return String(s||'')}", ['pentest-ui.mjs']),
    ('banner-any-address', DIR, "function okUrl(u){u=String(u==null?'':u);return /^https?:\\/\\/[^\\s'\"()<>\\\\]+$/i.test(u)?u:''}", "function okUrl(u){return String(u==null?'':u)}", ['pentest-ui.mjs']),
    ('proof-link-any-scheme', DIR, "function httpUrl(u){u=String(u==null?'':u);return /^https?:\\/\\//i.test(u)?u:''}", "function httpUrl(u){return String(u==null?'':u)}", ['pentest-ui.mjs']),
    ('banner-saved-without-check', RD, "if (banner && !/^https:\\/\\/[^\\s'\"()<>\\\\]+$/i.test(banner)) throw new Error('bad_link');", "if (banner && !/^https:\\/\\//i.test(banner)) throw new Error('bad_link');", ['pentest-ui.mjs']),
    ('odd-race-data-not-tidied', RD, "    quals: qualsOut(j.quals),\n", "    quals: Array.isArray(j.quals) ? j.quals : [],\n", ['pentest-ui.mjs']),
    ('no-escaping', DIR, "function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]})}", "function esc(s){return String(s==null?'':s)}", ['pentest-ui.mjs']),
    ('frame-can-set-token', DIR, "arg:Object.assign({},m.arg,{token:S.token}),mod:'expo'}", "arg:Object.assign({token:S.token},m.arg),mod:'expo'}", ['pentest-ui.mjs']),
    ('frame-can-pick-module', DIR, "arg:Object.assign({},m.arg,{token:S.token}),mod:'expo'}", "arg:Object.assign({},m.arg,{token:S.token}),mod:m.mod||'expo'}", ['pentest-ui.mjs']),
    ('anyone-can-call-through-shell', DIR, "if(m&&m.kind==='call'){if(!fromXf)return;", "if(m&&m.kind==='call'){", ['pentest-ui.mjs']),
    ('open-team-from-anyone', DIR, "if(m&&m.kind==='open-team'){if(fromXf&&man())doTab('team');return}", "if(m&&m.kind==='open-team'){if(man())doTab('team');return}", ['pentest-ui.mjs']),
    ('csv-formulas-run', DIR, "if(/^[=@\\t\\r]/.test(s)||(/^[+\\-]/.test(s)&&!/^[+\\-][\\d\\s().\\-]*$/.test(s)))s=\"'\"+s;", '', ['pentest-ui.mjs']),
    ('csv-formulas-run-desk', EXPO, "  if(/^[=@\\t\\r]/.test(s)||(/^[+\\-]/.test(s)&&!/^[+\\-][\\d\\s().\\-]*$/.test(s)))s=\"'\"+s;\n", '', ['pentest-ui.mjs']),
    ('pin-stays-after-tab-change', DIR, "async function doTab(t){S.tab=t;S.teamSecret=null;", "async function doTab(t){S.tab=t;", ['pentest-ui.mjs']),
    ('pin-stays-after-logout', DIR, "S.team=null;S.tf=null;S.teamSecret=null;S.loginErr=why?msg(why):'';render()}", "S.team=null;S.tf=null;S.loginErr=why?msg(why):'';render()}", ['pentest-ui.mjs']),
    ('login-gate-removed', RD, "  if (!slot) throw new Error('locked');\n  const good = checkPassword(u.password, password);", "  const good = checkPassword(u.password, password);", ['pentest.mjs']),
    ('coach-login-gate-removed', TR, "  if (!slot) throw new Error('locked');\n  if (!checkPassword(u.password, password)) {", "  if (!checkPassword(u.password, password)) {", ['pentest.mjs']),
    ('athlete-login-gate-removed', TR, "  if (!slot) throw new Error('locked');\n  if (!same(hashPin(pin, a.salt), a.pinHash)) {", "  if (!same(hashPin(pin, a.salt), a.pinHash)) {", ['pentest.mjs']),
    ('change-pin-gate-removed', TR, "  if (!slot) throw new Error('locked');\n  if (!same(hashPin(String(arg.oldPin || ''), a.salt), a.pinHash)) throw new Error('bad_login');", "  if (!same(hashPin(String(arg.oldPin || ''), a.salt), a.pinHash)) throw new Error('bad_login');", ['pentest.mjs']),
    ('setup-key-gate-removed', RD, "  if (!slot) throw new Error('busy_try_later');\n  if (!arg || !same(String(arg.key || ''), SETUP_KEY)) throw new Error('Wrong setup key');\n  // Only wrong keys", "  if (!arg || !same(String(arg.key || ''), SETUP_KEY)) throw new Error('Wrong setup key');\n  // Only wrong keys", ['pentest.mjs']),
    ('reset-keeps-login-slots', RD, "  await freeSlots(wixData, RATE, slotKey('att', unameOf(old)), LOGIN_TRIES, LOGIN_WINDOW_MS, SA);\n  const self = lc(unameOf(old)) === lc(a.username);", "  const self = lc(unameOf(old)) === lc(a.username);", ['unit-team.mjs']),
    ('new-password-keeps-login-slots', RD, "    if (pw) await freeSlots(wixData, RATE, slotKey('att', unameOf(old)), LOGIN_TRIES, LOGIN_WINDOW_MS, SA);\n", "", ['unit-team.mjs']),
    ('good-login-keeps-slots', RD, "  await freeSlots(wixData, RATE, gate, LOGIN_TRIES, LOGIN_WINDOW_MS, SA);\n  // A good login clears the failures", "  // A good login clears the failures", ['unit-auth.mjs', 'integration-flow.mjs', 'pentest.mjs']),
    ('plan-status-before-login-check', RD, "export const setPlanStatus = webMethod(Permissions.Anyone, async (arg) => {\n  await auth(arg); // who is asking is checked before anything else is looked at\n", "export const setPlanStatus = webMethod(Permissions.Anyone, async (arg) => {\n", ['security.mjs']),
    ('decide-qual-before-login-check', RD, "  const a = await auth(arg, status === 'waived' ? 'manage' : 'write');\n  if (!['approved'", "  if (!['approved', 'rejected', 'waived', 'pending'].includes(status)) throw new Error('bad_status');\n  const a = await auth(arg, status === 'waived' ? 'manage' : 'write');\n  if (!['approved'", ['security.mjs']),
    ('collections-readable-by-visitors', RD, "const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };", "const LOCKED = { read: 'ANYONE', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };", ['security.mjs']),
    ('viewer-sees-money', RD, "  if (a.role === 'viewer' && isSecret(kind)) throw new Error('not_allowed');\n", "", ['security.mjs']),
    ('setup-open-with-placeholder-key', RD, "  if (SETUP_KEY === 'change-this-key') throw new Error('Edit SETUP_KEY at the top of racedir.web.js first');\n", "", ['security.mjs']),
    ('manage-check-removed', RD, "  if (need === 'manage' && !a.can.manage) throw new Error('director_only');\n", "", ['security.mjs']),
    ('desk-allowed-in-raceos', RD, "  const a = await session(arg);\n  if (a.role === 'desk') throw new Error('not_allowed');\n", "  const a = await session(arg);\n", ['security.mjs']),
    ('expo-lets-everyone-in', XB, "return k === 'director' ? 'admin' : k === 'desk' ? 'desk' : 'none';", "return k === 'director' ? 'admin' : 'desk';", ['security.mjs']),
    ('double-handover', XB, "if (await claimItem(it, item, desk, now)) taken.push(item);", "taken.push(item);", ['pentest.mjs']),
    # --- Package 2: Finance (and the session-expiry fix in all four backends)
    ('fin-overpay-allowed', FIN, "        if (st.settled + amount + tds > inv.total) throw new Error('too_much');\n", '', ['finance.mjs', 'pentest-finance.mjs']),
    ('fin-lead-sees-all-claims', FIN, "const mine = clm.map(normClaim).filter((c) => a.role === 'director' || c.by === a.username);", 'const mine = clm.map(normClaim);', ['security.mjs', 'pentest-finance.mjs']),
    ('fin-lead-edits-others-claims', FIN, "    if (a.role !== 'director' && old.by !== a.username) throw new Error('no_item');\n", '', ['pentest-finance.mjs']),
    ('fin-cash-check-removed', FIN, '  if (h && h.inHand < 0) {\n    await wixData.bulkRemove(LED, [newId], SA);', '  if (false) {\n    await wixData.bulkRemove(LED, [newId], SA);', ['finance.mjs', 'pentest-finance.mjs']),
    ('fin-void-deletes-the-row', FIN, "  await wixData.update(LED, Object.assign({}, row, { void: 'yes', voidBy: a.username, voidAt: nowIso(), voidReason: reason }), SA);\n", '  await wixData.bulkRemove(LED, [row._id], SA);\n', ['finance.mjs']),
    ('fin-other-race-ids-work', FIN, "  if (!row || row.event !== e._id) throw new Error('no_item');", "  if (!row) throw new Error('no_item');", ['pentest-finance.mjs']),
    ('fin-session-expiry-fails-open', FIN, "  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "  if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-finance.mjs']),
    ('raceos-session-expiry-fails-open', RD, "  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "  if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-finance.mjs']),
    ('expo-session-expiry-fails-open', XB, "  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "  if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-finance.mjs']),
    ('coach-session-expiry-fails-open', TR, "  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "  if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-finance.mjs']),
    ('athlete-session-expiry-fails-open', TR, "  if (!row || !(Date.parse(row.expires) > Date.now())) throw new Error('not_logged_in');", "  if (!row || Date.parse(row.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-finance.mjs']),
    ('fin-role-check-removed', FIN, "  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');\n", '', ['security.mjs', 'pentest-finance.mjs']),
    ('fin-director-only-removed', FIN, "  if (need === 'director' && kind !== 'director') throw new Error('director_only');\n", '', ['security.mjs', 'pentest-finance.mjs']),
    ('fin-repeat-key-any-login', FIN, '    if (old.by === a.username && old.ref) return { id: old.ref, again: true };', '    if (old.ref) return { id: old.ref, again: true };', ['pentest-finance.mjs']),
    ('fin-repeat-key-not-checked', FIN, "  if (!isKey(key)) throw new Error('bad_key');\n", '', ['pentest-finance.mjs']),
    ('fin-text-not-cleaned', FINLIB, ".replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]/g, ' ')", '', ['unit-finance.mjs', 'pentest-finance.mjs']),
    ('fin-zero-money-allowed', FINLIB, '  if (p > MAX_PAISE || (p === 0 && !zeroOk)) return null;', '  if (p > MAX_PAISE) return null;', ['unit-finance.mjs', 'pentest-finance.mjs']),
    ('fin-choice-from-any-type', FIN, "const sOnly = (v) => (typeof v === 'string' ? v : '');", "const sOnly = (v) => String(v || '');", ['pentest-finance.mjs']),
    ('fin-claim-owner-from-call', FIN, "status: 'submitted', by: a.username, byName: a.name", "status: 'submitted', by: arg.by || a.username, byName: a.name", ['pentest-finance.mjs', 'security.mjs']),
    ('fin-collections-readable-by-visitors', FIN, "const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };", "const LOCKED = { read: 'ANYONE', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };", ['security.mjs']),
    ('fin-write-without-suppress-auth', FIN, 'detail: cleanText(detail, 200) }, SA);', 'detail: cleanText(detail, 200) });', ['security.mjs']),
    ('fin-page-relay-list-open', FINPAGE, '      if (FIN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);\n', '', ['pentest-finance.mjs', 'pagecode.mjs']),
    ('fin-void-cash-recheck-removed', FIN, "    if (h2 && h2.inHand < 0) {\n      await wixData.update(LED, row, SA);\n      throw new Error('cash_already_spent');\n    }\n", '', ['finance.mjs']),
    ('fin-refund-over-paid', FIN, "        if (amount > st.paid) throw new Error('too_much');\n", '', ['pentest-finance.mjs']),
    ('fin-pay-unapproved-claim', FIN, "  if (clm.status !== 'approved') throw new Error('claim_not_approved');\n", '', ['pentest-finance.mjs', 'finance.mjs']),
    ('fin-cancel-paid-invoice', FIN, "  if (led.some((r) => !r.void && r.type === 'income')) throw new Error('has_payments');\n", '', ['pentest-finance.mjs']),
    ('fin-screens-no-escaping', DIR, 'function esc(s){return String(s==null?\'\':s).replace(/[&<>"\']/g,function(c){return {\'&\':\'&amp;\',\'<\':\'&lt;\',\'>\':\'&gt;\',\'"\':\'&quot;\',"\'":\'&#39;\'}[c]})}', "function esc(s){return String(s==null?'':s)}", ['pentest-finance-ui.mjs']),
    ('fin-csv-formulas-run', DIR, 'if(/^[=@\\t\\r]/.test(s)||(/^[+\\-]/.test(s)&&!/^[+\\-][\\d\\s().\\-]*$/.test(s)))s="\'"+s;', '', ['pentest-finance-ui.mjs']),
    ('fin-print-unescaped', DIR, "function finBr(t){return esc(t).replace(/\\n/g,'<br>')}", "function finBr(t){return String(t==null?'':t).replace(/\\n/g,'<br>')}", ['pentest-finance-ui.mjs']),
    # --- Package 3
    ('import-refresh-wipes-bibs', RD, 'const upd = ids.filter((i) => have.has(i)).map((i) => Object.assign({}, oldBy.get(i), byId.get(i)));', 'const upd = ids.filter((i) => have.has(i)).map((i) => byId.get(i));', ['director.mjs']),
]


def run_one(m, work):
    name, rel, old, new, suites = m
    dest = os.path.join(work, name)
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(ROOT, dest, ignore=shutil.ignore_patterns('.git', 'mut-*'), symlinks=True)
    path = os.path.join(dest, rel)
    text = open(path, encoding='utf-8').read()
    if text.count(old) != 1:
        return name, 'BROKEN', 'the text to change occurs %d times in %s' % (text.count(old), rel), suites
    open(path, 'w', encoding='utf-8').write(text.replace(old, new))
    for s in suites:
        try:
            r = subprocess.run(['sh', 'run.sh', s], cwd=os.path.join(dest, 'tests'), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            return name, 'KILLED', s + ' (it hung, which also counts as noticed)', suites
        if r.returncode != 0:
            fails = [ln.strip() for ln in r.stdout.splitlines() if ln.strip().startswith('FAIL')]
            return name, 'KILLED', s + (': ' + fails[0][5:100] if fails else ''), suites
    return name, 'SURVIVED', 'no suite noticed', suites


def main(argv):
    if '--list' in argv:
        for m in MUTANTS:
            print(m[0].ljust(32), m[1], '->', ', '.join(m[4]))
        return 0
    jobs = 4
    out = None
    names = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--jobs':
            jobs = int(argv[i + 1]); i += 2; continue
        if a == '--write':
            out = argv[i + 1]; i += 2; continue
        names.append(a); i += 1
    chosen = [m for m in MUTANTS if not names or m[0] in names]
    unknown = [w for w in names if w not in [m[0] for m in MUTANTS]]
    if unknown:
        print('unknown mutant(s):', ', '.join(unknown))
        return 2
    work = tempfile.mkdtemp(prefix='mut-')
    results = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as ex:
            futs = {ex.submit(run_one, m, work): m for m in chosen}
            for f in concurrent.futures.as_completed(futs):
                name, verdict, why, suites = f.result()
                results.append((name, verdict, why))
                print('%-32s %-9s %s' % (name, verdict, why))
                sys.stdout.flush()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    results.sort(key=lambda r: [m[0] for m in MUTANTS].index(r[0]))
    bad = [r for r in results if r[1] != 'KILLED']
    summary = '%d mutants, %d killed, %d survived' % (len(results), len(results) - len(bad), len(bad))
    print('\n' + summary)
    if out:
        with open(out, 'w', encoding='utf-8') as fh:
            for r in results:
                fh.write('%s\t%s\t%s\n' % r)
            fh.write('# ' + summary + '\n')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
