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
RESB = 'wix/director/results.web.js'
RESL = 'wix/director/rd-results.js'
PRNB = 'wix/director/print.web.js'
PRNL = 'wix/director/rd-print.js'
RUNB = 'wix/director/runner.web.js'
RUNE = 'wix/director/runner-embed.html'
RUNP = 'wix/director/runner-page-code.js'
CMB = 'wix/director/comms.web.js'
CML = 'wix/director/rd-comms.js'
WVB = 'wix/director/waivers.web.js'
WVL = 'wix/director/rd-waiver.js'

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
    # --- Package 3: waves, results and awards
    ('res-role-check-removed', RESB, "  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');\n", '', ['security.mjs', 'pentest-results.mjs']),
    ('res-director-only-removed', RESB, "  if (need === 'director' && kind !== 'director') throw new Error('director_only');\n", '', ['security.mjs', 'pentest-results.mjs']),
    ('res-expiry-fails-open', RESB, "if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-results.mjs']),
    ('res-void-deletes-the-result', RESB, "  await wixData.update(RESULTS, Object.assign({}, row, { void: 'yes', voidBy: a.username, voidAt: nowIso(), voidReason: reason }), SA);", "  await wixData.bulkRemove(RESULTS, [row._id], SA);", ['results.mjs', 'security.mjs']),
    ('res-void-without-reason', RESB, "  const reason = cleanText(sOnly(arg.reason), 200);\n  if (reason.length < 3) throw new Error('reason_needed');\n  await wixData.update(RESULTS, Object.assign({}, row, { void: 'yes'", "  const reason = cleanText(sOnly(arg.reason), 200);\n  await wixData.update(RESULTS, Object.assign({}, row, { void: 'yes'", ['results.mjs', 'pentest-results.mjs']),
    ('res-correction-forgets-old-values', RESB, "  next.prev = JSON.stringify({ status: row.status, gunCs: row.gunCs, chipCs: row.chipCs, gender: row.gender, age: row.age, cat: row.cat, note: row.note, by: row.by, at: row.at });", "  next.prev = row.prev;", ['results.mjs', 'results-ui.mjs']),
    ('res-correction-writer-from-call', RESB, "  next.by = a.username;\n  next.at = nowIso();\n  await wixData.update(RESULTS, next, SA);", "  next.by = arg.by || a.username;\n  next.at = nowIso();\n  await wixData.update(RESULTS, next, SA);", ['security.mjs', 'pentest-results.mjs']),
    ('res-waves-overwrite-a-parallel-save', RESB, "    await wixData.insert(RSET, { _id: wavesId(e._id, rev), kind: 'waves',", "    await wixData.save(RSET, { _id: wavesId(e._id, rev), kind: 'waves',", ['pentest-results.mjs']),
    ('res-waves-stale-copy-accepted', RESB, "  if (arg.rev !== cur.rev) throw new Error('changed_reload');\n", '', ['results.mjs', 'results-ui.mjs']),
    ('res-assign-without-repeat-guard', RESB, "  return once(a, 'assign', arg.key, async () => {", "  return (async (_a, _k, _kk, make) => make())(a, 'assign', arg.key, async () => {", ['pentest-results.mjs', 'security.mjs']),
    ('res-repeat-key-any-login', RESB, "    if (old.by === a.username && old.ref) return { id: old.ref, again: true };", "    if (old.ref) return { id: old.ref, again: true };", ['pentest-results.mjs']),
    ('res-failed-request-keeps-its-key', RESB, "    await wixData.bulkRemove(RSET, [id], SA).catch(() => null);\n    throw e;", "    throw e;", ['pentest-results.mjs']),
    ('res-unpaid-runner-placed', RESB, "  if (!info.paid) throw new Error('not_paid');\n  const id = 'wa~' + reg._id;", "  const id = 'wa~' + reg._id;", ['results.mjs', 'pentest-results.mjs']),
    ('res-wave-capacity-not-kept', RESB, "  if (w.cap > 0 && (await full())) throw new Error('wave_full');\n  const before = await wixData.get(ASSIGN, id, SA).catch(() => null);\n  await put(ASSIGN, { _id: id, event: e._id, regId: reg._id, wave: w.id, corral, how: 'manual', by: a.username, at: nowIso() });\n  if (w.cap > 0) {\n    const n = (await rows(ASSIGN, e._id)).filter((x) => x.wave === w.id).length;\n    if (n > w.cap) {\n      if (before) await wixData.update(ASSIGN, before, SA);\n      else await wixData.bulkRemove(ASSIGN, [id], SA);\n      throw new Error('wave_full');\n    }\n  }\n", "  const before = await wixData.get(ASSIGN, id, SA).catch(() => null);\n  await put(ASSIGN, { _id: id, event: e._id, regId: reg._id, wave: w.id, corral, how: 'manual', by: a.username, at: nowIso() });\n", ['results.mjs', 'results-ui.mjs']),
    ('res-last-seat-race-not-rechecked', RESB, "  if (w.cap > 0) {\n    const n = (await rows(ASSIGN, e._id)).filter((x) => x.wave === w.id).length;\n    if (n > w.cap) {\n      if (before) await wixData.update(ASSIGN, before, SA);\n      else await wixData.bulkRemove(ASSIGN, [id], SA);\n      throw new Error('wave_full');\n    }\n  }\n", '', ['pentest-results.mjs']),
    ('res-placing-again-moves-hand-placements', RESL, "  const kept = runners.filter((r) => r.wave && wid.has(r.wave) && (r.how === 'manual' || !o.redo));", "  const kept = runners.filter((r) => r.wave && wid.has(r.wave) && !o.redo);", ['unit-results.mjs', 'results.mjs']),
    ('res-rank-setting-ignored', RESL, "  const first = rankBy === 'gun' ? P(r.gunCs) : P(r.chipCs);", "  const first = P(r.chipCs);", ['unit-results.mjs', 'results.mjs']),
    ('res-equal-times-not-shared', RESL, "    if (x.t !== prev) {\n      place = i + 1;\n      prev = x.t;\n    }", "    place = i + 1;\n    prev = x.t;", ['unit-results.mjs']),
    ('res-age-on-birthday-wrong', RESL, "(on.slice(5) < dob.slice(5) ? 1 : 0)", "(on.slice(5) <= dob.slice(5) ? 1 : 0)", ['unit-results.mjs']),
    ('res-age-group-edge', RESL, "  for (const x of bounds) if (age >= x) i++;", "  for (const x of bounds) if (age > x) i++;", ['unit-results.mjs']),
    ('res-overall-winners-listed-twice', RESL, "      const taken = new Set(excl ? overall.map((x) => x.id) : []);", "      const taken = new Set([]);", ['unit-results.mjs', 'results.mjs']),
    ('res-year-end-age-rule-ignored', RESL, "  return rule === 'yearend' ? raceDate.slice(0, 4) + '-12-31' : raceDate;", "  return raceDate;", ['unit-results.mjs', 'results.mjs']),
    ('res-import-unknown-category', RESL, "    if (catTyped && Array.isArray(ctx.known) && ctx.known.length && !ctx.known.some((k) => catKey(k) === catKey(cat))) {", "    if (false) {", ['unit-results.mjs', 'pentest-results.mjs']),
    ('res-import-moves-runner-to-another-category', RESL, "    if (reg && catTyped && reg.cat && catKey(cat) !== catKey(reg.cat)) {", "    if (false) {", ['pentest-results.mjs', 'results-ui.mjs']),
    ('res-import-error-repeats-markup', RESL, "const echo = (v, n) => cleanText(v, n).replace(/[<>&\"`]/g, '');", "const echo = (v, n) => cleanText(v, n);", ['pentest-results.mjs', 'results-ui.mjs']),
    ('res-setup-questions-carry-answers', RESL, "      if (v) x.count++;", "      if (v) { x.count++; x.sample = (x.sample || []).concat([cleanText(v, 40)]).slice(0, 3); }", ['unit-results.mjs', 'pentest-results.mjs', 'security.mjs', 'results-ui.mjs']),
    ('res-collections-readable-by-visitors', RESB, "const LOCKED = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };", "const LOCKED = { read: 'ANYONE', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };", ['security.mjs']),
    ('res-write-without-suppress-auth', RESB, "detail: cleanText(detail, 200) }, SA);", "detail: cleanText(detail, 200) });", ['security.mjs']),
    ('res-page-relay-list-open', FINPAGE, "      if (RES_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);\n", '', ['pentest-results.mjs', 'pagecode.mjs', 'security.mjs']),
    ('res-awards-screen-no-escaping', DIR, "<td>'+esc(x.bib)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.ageGroup||'')+'</td><td>'+esc(x.time)+'</td></tr>'", "<td>'+esc(x.bib)+'</td><td>'+x.name+'</td><td>'+esc(x.ageGroup||'')+'</td><td>'+esc(x.time)+'</td></tr>'", ['results-ui.mjs']),
    ('res-print-unescaped', DIR, "return '<tr>'+r.map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>'}).join('');printHtml(finDocHtml(title,", "return '<tr>'+r.map(function(c){return '<td>'+c+'</td>'}).join('')+'</tr>'}).join('');printHtml(finDocHtml(title,", ['results-ui.mjs']),
    ('res-csv-formulas-run', DIR, 'if(/^[=@\\t\\r]/.test(s)||(/^[+\\-]/.test(s)&&!/^[+\\-][\\d\\s().\\-]*$/.test(s)))s="\'"+s;', '', ['results-ui.mjs']),
    ('res-skip-tick-leaves-save-off', DIR, "{f.imp.skip=t.checked;var sv=document.querySelector('[data-act=res-imp-save]');if(sv)sv.disabled=!resCanSave(f.imp)}", "f.imp.skip=t.checked;", ['results-ui.mjs']),
    ('res-lead-offered-the-edit-buttons', DIR, "+(man()?'<td><button class=\"btn sm\" data-act=\"res-fix\"", "+(true?'<td><button class=\"btn sm\" data-act=\"res-fix\"", ['results-ui.mjs']),
    ('res-lead-offered-the-director-sections', DIR, "function rsubs(){return man()?RSUBS:RSUBS_LEAD}", "function rsubs(){return RSUBS}", ['results-ui.mjs']),
    ('res-import-retry-new-key', DIR, "else{if(!man()||!im.dry)return;if(!im.key)im.key=newKey();", "else{if(!man()||!im.dry)return;im.key=newKey();", ['results-ui.mjs']),
    # --- Package 4: bibs, certificates and the public runner page
    ('prn-role-check-removed', PRNB, "  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');\n", '', ['pentest-print.mjs', 'print.mjs']),
    ('prn-director-only-removed', PRNB, "  if (need === 'director' && kind !== 'director') throw new Error('director_only');\n", '', ['pentest-print.mjs', 'print.mjs']),
    ('prn-expiry-fails-open', PRNB, "if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-print.mjs']),
    ('prn-token-coerced-to-text', PRNB, "  const t = arg && typeof arg.token === 'string' ? arg.token : '';", "  const t = String((arg && arg.token) || '');", ['pentest-print.mjs']),
    ('prn-kind-any', PRNB, "  if (typeof v !== 'string' || !KINDS.includes(v)) throw new Error('bad_kind');", "  if (typeof v !== 'string') throw new Error('bad_kind');", ['pentest-print.mjs']),
    ('prn-save-writer-from-call', PRNB, "json: JSON.stringify(tpl), by: a.username, at: nowIso() });", "json: JSON.stringify(tpl), by: String(arg.by || a.username), at: nowIso() });", ['pentest-print.mjs']),
    ('prn-template-not-cleaned', PRNB, "  const tpl = kind === 'bib' ? cleanBibTpl(arg.tpl, cats) : cleanCertTpl(arg.tpl);\n  await put", "  const tpl = arg.tpl;\n  await put", ['pentest-print.mjs', 'print.mjs']),
    ('prn-flags-not-cleaned', PRNB, "  const pub = cleanFlags(arg.pub);", "  const pub = arg.pub;", ['pentest-print.mjs', 'print.mjs']),
    ('prn-lead-can-change-switches', PRNB, "export const prnSavePublish = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await pauth(arg, 'director');", "export const prnSavePublish = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await pauth(arg, 'view');", ['pentest-print.mjs', 'print.mjs']),
    ('prn-lead-can-save-designs', PRNB, "export const prnSaveTemplate = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await pauth(arg, 'director');", "export const prnSaveTemplate = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await pauth(arg, 'view');", ['pentest-print.mjs', 'print.mjs']),
    ('prn-unpaid-runner-gets-a-bib', PRNB, "    .filter((x) => x.paid && x.bib)\n", "    .filter((x) => x.bib)\n", ['pentest-print.mjs', 'print.mjs']),
    ('prn-unfinished-runner-gets-a-certificate', PRNB, ".filter((x) => x.status === 'fin' && x.place)", ".filter((x) => x.status || x.place)", ['pentest-print.mjs', 'print.mjs']),
    ('prn-printing-not-noted', PRNB, "  if (from === 0) await audit(a, 'bibs printed'", "  if (false) await audit(a, 'bibs printed'", ['pentest-print.mjs', 'print.mjs']),
    ('prn-cursor-unchecked', PRNB, "  if (!Number.isInteger(v) || v < 0 || v > 1000000) throw new Error('bad_from');", "  if (!Number.isFinite(Number(v))) throw new Error('bad_from');", ['pentest-print.mjs']),
    ('prn-category-unchecked', PRNB, "  if (!k) throw new Error('bad_cat');", "  if (!k) return String(v);", ['pentest-print.mjs', 'print.mjs']),
    ('prn-spares-cap-removed', PRNL, " || to - from >= 500) throw new Error('bad_spares');", ") throw new Error('bad_spares');", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-angle-bracket-not-escaped', PRNL, "    .replace(/</g, '&lt;')\n", '', ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-ampersand-not-escaped', PRNL, "  T(v)\n    .replace(/&/g, '&amp;')\n", "  T(v)\n", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-picture-any-host', PRNL, "  return m && IMG_HOSTS.includes(m[1].toLowerCase()) ? s : '';", "  return m ? s : '';", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-picture-plain-http', PRNL, r"const IMG_RE = /^https:\/\/", r"const IMG_RE = /^https?:\/\/", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-colour-any-text', PRNL, r"export const safeColor = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : d);", r"export const safeColor = (v, d) => (typeof v === 'string' && /^[#0-9a-zA-Z(),.:;\/ -]{1,60}$/.test(v.trim()) ? v.trim().toLowerCase() : d);", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-long-picture-address-cut', PRNL, "    const t = cleanText(x, 301);", "    const t = cleanText(x, 300);", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-placeholders-filled-twice', PRNL, r"  return T(text).replace(/\{([A-Za-z][A-Za-z0-9_]{0,19})\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(v, k.toLowerCase()) ? T(v[k.toLowerCase()]) : all));", r"  const one = (x) => x.replace(/\{([A-Za-z][A-Za-z0-9_]{0,19})\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(v, k.toLowerCase()) ? T(v[k.toLowerCase()]) : all));" + "\n  return one(one(T(text)));", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-spare-numbers-duplicate-real-bibs', PRNL, "    if (taken && taken.has(b)) skipped++;", "    if (false) skipped++;", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-certificates-without-results-allowed', PRNL, "  if (out.certs && !out.results) throw new Error('certs_need_results');", '', ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-damaged-switches-read-as-on', PRNL, "    return { startList: false, results: false, certs: false, note: '' };\n  }\n}\nexport const anyOn", "    return { startList: true, results: true, certs: true, note: '' };\n  }\n}\nexport const anyOn", ['pentest-print.mjs', 'unit-print.mjs']),
    ('prn-search-one-letter', PRNL, "  if (k.length < 3) return { items: [], more: false, tooShort: true };", "  if (k.length < 1) return { items: [], more: false, tooShort: true };", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-search-no-cap', PRNL, "  return { items: hits.slice(0, lim).map(", "  return { items: hits.map(", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-unpaid-runner-listed-publicly', PRNL, "    if (!r || !r.paid || !bibKey(r.bib)) return;", "    if (!r || !bibKey(r.bib)) return;", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-result-shown-with-switch-off', PRNL, "    result: f.results && e.res ? Object.assign({}, e.res) : null,", "    result: e.res ? Object.assign({}, e.res) : null,", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-start-shown-with-switch-off', PRNL, "    start: f.startList && e.start ? {", "    start: e.start ? {", ['unit-print.mjs', 'pentest-print.mjs']),
    ('prn-certificate-offered-with-switch-off', PRNL, "    cert: !!(f.results && f.certs && e.res && e.res.status === 'fin' && e.res.place),", "    cert: !!(e.res && e.res.status === 'fin' && e.res.place),", ['unit-print.mjs', 'pentest-print.mjs']),
    ('run-hidden-race-shows', RUNB, "  if (!anyOn(f) || (need && !need(f))) throw new Error('not_published');", "  if (need && !need(f)) throw new Error('not_published');", ['pentest-print.mjs', 'print.mjs']),
    ('run-certificate-without-switches', RUNB, "  const { e } = await openRace(a.ev, (f) => f.results && f.certs);", "  const { e } = await openRace(a.ev);", ['pentest-print.mjs', 'print.mjs']),
    ('run-question-length-unchecked', RUNB, "  if (typeof a.q !== 'string' || a.q.length > 200) throw new Error('bad_query');", "  if (typeof a.q !== 'string') throw new Error('bad_query');", ['pentest-print.mjs', 'print.mjs']),
    ('run-memory-never-expires', RUNB, "  if (hit && now >= hit.at && now - hit.at < TTL) return hit;", "  if (hit) return hit;", ['print.mjs', 'runner-ui.mjs']),
    ('run-search-writes-a-note', RUNB, "  const built = await indexOf(e);\n  const found = searchPublic(", "  await wixData.insert(C.AUDIT, { at: new Date().toISOString(), by: 'public', action: 'looked', target: String(e._id), detail: String(a.q) }, SA).catch(() => null);\n  const built = await indexOf(e);\n  const found = searchPublic(", ['pentest-print.mjs', 'print.mjs']),
    ('run-page-names-not-escaped', RUNE, "function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]})}", "function esc(s){return String(s==null?'':s)}", ['runner-ui.mjs']),
    ('run-certificate-frame-not-sandboxed', RUNE, ' sandbox="" ', ' ', ['runner-ui.mjs']),
    ('run-double-press-asks-twice', RUNE, "if(!f||f.id!=='findForm'||S.busy)return;", "if(!f||f.id!=='findForm')return;", ['runner-ui.mjs']),
    ('run-page-relay-list-open', RUNP, "    if (ALLOWED.indexOf(msg.method) < 0) {", "    if (false) {", ['pagecode.mjs', 'pentest-print.mjs']),
    ('prn-page-relay-list-open', FINPAGE, "      if (PRN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);\n", '', ['pagecode.mjs', 'pentest-print.mjs']),
    ('prn-preview-frame-not-sandboxed', DIR, 'sandbox="" style="display:block;border:0;background:#fff;width:', 'style="display:block;border:0;background:#fff;width:', ['print-ui.mjs']),
    ('prn-lead-offered-the-design-editor', DIR, "function psubs(){return man()?PSUBS:PSUBS_LEAD}", "function psubs(){return PSUBS}", ['print-ui.mjs']),
    ('prn-print-skips-the-save', DIR, "if(man()&&f.dirty[kind]){pread(kind);var sv=await pa('prnSaveTemplate'", "if(false){pread(kind);var sv=await pa('prnSaveTemplate'", ['print-ui.mjs']),
    ('prn-who-heading-unescaped', DIR, "id=\"prnPvWho\" role=\"status\" style=\"margin:6px 0\">'+esc(prnWho(f,kind))+'</p>'", "id=\"prnPvWho\" role=\"status\" style=\"margin:6px 0\">'+prnWho(f,kind)+'</p>'", ['print-ui.mjs']),
    # the audit's own lines for Print and the public runner page
    ('prn-collection-made-for-outsiders', PRNB, "  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "  await ensureCollections();\n  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", ['security.mjs']),
    ('prn-update-without-suppressauth', PRNB, "if (old) return wixData.update(col, row, SA);", "if (old) return wixData.update(col, row);", ['security.mjs']),
    ('run-backend-deletes-a-row', RUNB, "  const row = await wixData.get(C.PRINT, 'tpl~' + e._id + '~cert', SA).catch(() => null);", "  await wixData.bulkRemove(C.PRINT, ['x~' + e._id], SA).catch(() => null);\n  const row = await wixData.get(C.PRINT, 'tpl~' + e._id + '~cert', SA).catch(() => null);", ['security.mjs']),
    # --- Package 5a: Communications (messages to runners and volunteers)
    ('cm-role-check-removed', CMB, "  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');\n", '', ['security.mjs', 'comms.mjs']),
    ('cm-director-only-removed', CMB, "  if (need === 'director' && kind !== 'director') throw new Error('director_only');\n", '', ['security.mjs', 'comms.mjs']),
    ('cm-expiry-fails-open', CMB, "if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-comms.mjs']),
    ('cm-token-coerced-to-text', CMB, "  const t = arg && typeof arg.token === 'string' ? arg.token : '';", "  const t = String((arg && arg.token) || '');", ['pentest-comms.mjs']),
    ('cm-lead-can-send', CMB, "  const t0 = Date.now(); // the nine seconds count from here: signing in and reading the people use some of them\n  const a = await cauth(arg, 'director');", "  const t0 = Date.now(); // the nine seconds count from here: signing in and reading the people use some of them\n  const a = await cauth(arg, 'view');", ['security.mjs', 'comms.mjs']),
    ('cm-lead-can-save-templates', CMB, "export const cmSaveTemplate = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmSaveTemplate = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-lead-can-export', CMB, "export const cmExport = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmExport = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-lead-can-open-links', CMB, "export const cmLinks = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmLinks = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-lead-can-prepare', CMB, "export const cmPrepare = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmPrepare = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-lead-can-send-test-email', CMB, "export const cmTest = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmTest = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-lead-can-mark', CMB, "export const cmMark = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmMark = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-lead-can-change-settings', CMB, "export const cmSaveSettings = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const cmSaveSettings = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'view');", ['security.mjs']),
    ('cm-collection-made-for-outsiders', CMB, "if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "await ensureCollections();\n  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", ['security.mjs']),
    ('cm-update-without-suppressauth', CMB, 'if (old) return wixData.update(col, row, SA);', 'if (old) return wixData.update(col, row);', ['security.mjs']),
    ('cm-backend-deletes-a-row', CMB, 'const get = (id) => wixData.get(COMMS, id, SA).catch(() => null);', 'const get = (id) => wixData.get(COMMS, id, SA).catch(() => null);\nconst zap = (id) => wixData.bulkRemove(COMMS, [id], SA);', ['security.mjs']),
    ('cm-log-row-holds-text', CMB, "status: 'sending', why: '', json: '', by: a.username", "status: 'sending', why: '', json: JSON.stringify({ to: 'x' }), by: a.username", ['security.mjs']),
    ('cm-writer-taken-from-call', CMB, 'json: JSON.stringify(t), by: a.username, at: nowIso() });', 'json: JSON.stringify(t), by: String(arg.by || a.username), at: nowIso() });', ['security.mjs', 'pentest-comms.mjs']),
    ('cm-address-in-the-export-note', CMB, "': ' + members.length + ' rows, columns ' + cols.join(', '));", "': ' + members.length + ' rows, columns ' + cols.join(', ') + ' ' + part.map((p) => p.emailRaw).join(','));", ['security.mjs']),
    ('cm-test-address-kept-in-the-log', CMB, "{ event: e._id, kind: 'tst', ref: '', sub: '', who: '', status: ''", "{ event: e._id, kind: 'tst', ref: '', sub: '', who: to, status: ''", ['security.mjs']),
    ('cm-send-claim-not-unique', CMB, "    const row = { _id: ids.rcp(bat.key, id), event: e._id, kind: 'rcp', ref: bat.key, sub: bat.tpl.id, who: id, status: 'sending', why: '', json: '', by: a.username, at: nowIso() };", "    const row = { event: e._id, kind: 'rcp', ref: bat.key, sub: bat.tpl.id, who: id, status: 'sending', why: '', json: '', by: a.username, at: nowIso() };", ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-send-deadline-ignored', CMB, 'while (at < list.length && Date.now() < deadline && !(fails >= 3 && !worked)) {', 'while (at < list.length && !(fails >= 3 && !worked)) {', ['comms.mjs']),
    ('cm-send-never-stops-on-failures', CMB, 'while (at < list.length && Date.now() < deadline && !(fails >= 3 && !worked)) {', 'while (at < list.length && Date.now() < deadline) {', ['comms.mjs']),
    ('cm-unsubscribed-still-counted-as-sent', CMB, "  if (c.unsubscribed) return { status: 'skipped', why: 'unsubscribed' };\n  await triggeredEmails.emailContact(cfg.emailId, c.id, { variables: msg.variables });", '  await triggeredEmails.emailContact(cfg.emailId, c.id, { variables: msg.variables });', ['comms.mjs']),
    ('cm-send-whatsapp-batch-allowed', CMB, "  if (bat.via !== 'email') throw new Error('wrong_channel');\n  const cfg = await getCfg();\n  if (!cfg.emailId) throw new Error('no_email_id');", "  const cfg = await getCfg();\n  if (!cfg.emailId) throw new Error('no_email_id');", ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-links-for-email-batch-allowed', CMB, "  if (bat.via !== 'whatsapp') throw new Error('wrong_channel');\n  const cfg = await getCfg();\n  const from = fromOf(arg.from);", '  const cfg = await getCfg();\n  const from = fromOf(arg.from);', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-marks-for-email-batch-allowed', CMB, "  if (bat.via !== 'whatsapp') throw new Error('wrong_channel');\n  if (arg.status !== 'sent' && arg.status !== 'skipped') throw new Error('bad_status');", "  if (arg.status !== 'sent' && arg.status !== 'skipped') throw new Error('bad_status');", ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-send-without-wix-email-set-up', CMB, "  if (!cfg.emailId) throw new Error('no_email_id');\n  const from = fromOf(arg.from);", '  const from = fromOf(arg.from);', ['comms.mjs']),
    ('cm-prepare-key-clash-allowed', CMB, "if (old.event !== e._id || o.tpl !== tpl.id || old.sub !== via || JSON.stringify(o.aud) !== JSON.stringify(aud)) throw new Error('key_in_use');", "if (false) throw new Error('key_in_use');", ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-prepare-empty-audience-allowed', CMB, "  if (!reach.length) throw new Error('empty_audience');\n", '', ['comms.mjs']),
    ('cm-prepare-no-size-limit', CMB, "  if (reach.length > MAX_RCP) throw new Error('too_many');\n", '', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-prepare-archived-template-allowed', CMB, "  if (tpl.archived) throw new Error('template_archived');\n", '', ['comms.mjs']),
    ('cm-prepare-wrong-kind-of-template-allowed', CMB, "  if ((aud.who === 'runners') !== (tpl.kind === 'runner')) throw new Error('template_mismatch');\n  const old = await get(ids.bat(e._id, key));", '  const old = await get(ids.bat(e._id, key));', ['comms.mjs']),
    ('cm-prepare-without-race-link', CMB, "  if (needsOf(tpl).link && !(await raceLink(e._id))) throw new Error('no_link');\n", '', ['comms.mjs']),
    ('cm-batch-of-another-race', CMB, "  if (!row || row.event !== e._id || row.ref !== key || !VIAS.includes(row.sub)) throw new Error('no_batch');", "  if (!row || row.ref !== key || !VIAS.includes(row.sub)) throw new Error('no_batch');", ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-registrations-of-another-race', CMB, '  const list = only ? (await byIds(C.REGS, only)).filter((r) => r.event === e._id) : regs || (await rows(C.REGS, e._id));', '  const list = only ? await byIds(C.REGS, only) : regs || (await rows(C.REGS, e._id));', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-volunteers-of-another-race', CMB, '      .filter((v) => v.event === e._id)\n', '', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-mark-person-outside-the-batch', CMB, "  if (want.some((x) => !member.has(x))) throw new Error('not_in_batch');\n", '', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-mark-any-status', CMB, "  if (arg.status !== 'sent' && arg.status !== 'skipped') throw new Error('bad_status');\n  const want", '  const want', ['pentest-comms.mjs', 'comms.mjs']),
    ('cm-mark-list-unchecked', CMB, "  if (!Array.isArray(want) || !want.length || want.length > MARK_CHUNK || want.some((x) => typeof x !== 'string' || !x || x.length > 120)) throw new Error('bad_ids');\n", '', ['pentest-comms.mjs']),
    ('cm-test-email-limit-loosened', CMB, '  if (recent.length > TESTS_PER_HOUR) {', '  if (recent.length > TESTS_PER_HOUR + 100) {', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-test-email-refused-tries-count', CMB, "r._id === mine._id || (r.status !== 'refused' && Date.parse(r.at) > since)", 'r._id === mine._id || Date.parse(r.at) > since', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-contact-name-starts-a-formula', CMB, "    const plain = (s) => s.replace(/^[=+\\-@\\s]+/, '');", '    const plain = (s) => s;', ['comms.mjs', 'pentest-comms.mjs']),
    ('cm-export-not-noted', CMB, "  if (from === 0) await audit(a, 'audience exported'", "  if (false) await audit(a, 'audience exported'", ['security.mjs', 'comms.mjs']),
    ('cm-whatsapp-links-not-noted', CMB, "  if (from === 0) await audit(a, 'WhatsApp links opened'", "  if (false) await audit(a, 'WhatsApp links opened'", ['security.mjs', 'comms.mjs']),
    ('cm-sending-not-noted', CMB, "  if (from === 0) await audit(a, 'e-mail sending started'", "  if (false) await audit(a, 'e-mail sending started'", ['security.mjs', 'comms.mjs']),
    ('cm-batch-not-noted', CMB, "  await audit(a, via === 'email' ? 'e-mail batch prepared'", "  if (false) await audit(a, via === 'email' ? 'e-mail batch prepared'", ['security.mjs', 'comms.mjs']),
    ('cm-angle-brackets-kept-in-names', CML, ".replace(/[<>]/g, '').trim(), n || 200);", '.trim(), n || 200);', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-angle-brackets-kept-in-messages', CML, "    .replace(HIDDEN, '')\n    .replace(/[<>]/g, '');", "    .replace(HIDDEN, '');", ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-csv-formulas-run', CML, '  if (/^[=+\\-@]/.test(s)) s = "\'" + s;\n', '', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-csv-cells-unquoted', CML, '  return \'"\' + s.replace(/"/g, \'""\') + \'"\';', '  return s;', ['unit-comms.mjs']),
    ('cm-csv-quote-not-doubled', CML, '  return \'"\' + s.replace(/"/g, \'""\') + \'"\';', '  return \'"\' + s + \'"\';', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-email-address-unchecked', CML, "  return EMAIL_RE.test(s) ? s : '';\n}", '  return s;\n}', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-link-plain-http', CML, 'const LINK_RE = /^https:\\/\\/', 'const LINK_RE = /^https?:\\/\\/', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-whatsapp-link-any-number', CML, "  if (!/^[1-9]\\d{10,14}$/.test(T(number))) return '';\n  try {", '  try {', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-whatsapp-number-no-length-check', CML, "  if (d.length < 11 || d.length > 15 || d.startsWith('0')) return '';\n", '', ['unit-comms.mjs']),
    ('cm-unknown-placeholder-allowed', CML, "  if (unknownVars(t, t.kind).length) throw new Error('unknown_placeholder');\n", '', ['unit-comms.mjs', 'comms.mjs']),
    ('cm-audience-unknown-choices-allowed', CML, '  for (const k of Object.keys(raw)) if (!AUD_KEYS.includes(k)) throw abad();\n', '', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-unpaid-runners-by-default', CML, "    out.pay = pickOf(raw.pay, PAY, 'paid');", "    out.pay = pickOf(raw.pay, PAY, 'all');", ['unit-comms.mjs', 'comms.mjs']),
    ('cm-already-sent-filter-off', CML, '      return !(aud.notSent && s.has(p.id));', '      return true;', ['unit-comms.mjs', 'comms.mjs']),
    ('cm-failure-reason-keeps-address', CML, "    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[address]')\n", '', ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-ui-chat-link-unchecked', DIR, "function cmWaOk(u){return /^https:\\/\\/wa\\.me\\/[1-9]\\d{10,14}\\?text=[A-Za-z0-9%._~!*'()-]*$/.test(String(u||''))}", 'function cmWaOk(u){return !!u}', ['comms-ui.mjs']),
    ('cm-ui-names-unescaped', DIR, "var rows=(r.sample||[]).map(function(p){return '<tr><td>'+esc(p.name)+'</td>'", "var rows=(r.sample||[]).map(function(p){return '<tr><td>'+p.name+'</td>'", ['comms-ui.mjs']),
    ('cm-ui-lead-offered-sending', DIR, 'function cmSubs(){return man()?CSUBS:CSUBS_LEAD}', 'function cmSubs(){return CSUBS}', ['comms-ui.mjs']),
    ('cm-ui-sending-goes-on-after-race-switch', DIR, '      if(S.cm!==c||c.ev!==S.ev)return; // another race or a new login: the work stops here, and the batch report shows where it got to\n', '', ['comms-ui.mjs']),
    ('cm-ui-double-press-prepares-twice', DIR, '    if(!man()||c.sending||!c.tplId)return;\n    if(!c.key)c.key=newKey();', '    if(!man()||!c.tplId)return;\n    if(!c.key)c.key=newKey();', ['comms-ui.mjs']),
    ('cm-page-relay-list-open', FINPAGE, '      if (COMMS_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);\n', '', ['pagecode.mjs', 'pentest-comms.mjs']),
    # --- Package 5b: Waivers (the text in versions, who has signed, papers signed on the day, the papers to print)
    ('wv-role-check-removed', WVB, "  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');\n", '', ['security.mjs', 'waivers.mjs']),
    ('wv-director-only-removed', WVB, "  if (need === 'director' && kind !== 'director') throw new Error('director_only');\n", '', ['security.mjs', 'waivers.mjs']),
    ('wv-expiry-fails-open', WVB, "if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');", ['pentest-waivers.mjs']),
    ('wv-token-coerced-to-text', WVB, "  const t = arg && typeof arg.token === 'string' ? arg.token : '';", "  const t = String((arg && arg.token) || '');", ['pentest-waivers.mjs']),
    ('wv-lead-can-save-text', WVB, "export const wvSaveText = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const wvSaveText = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'staff');", ['security.mjs']),
    ('wv-lead-can-save-settings', WVB, "export const wvSaveSettings = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const wvSaveSettings = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'staff');", ['security.mjs']),
    ('wv-lead-can-void', WVB, "export const wvVoid = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'director');", "export const wvVoid = webMethod(Permissions.Anyone, async (arg) => {\n  const a = await cauth(arg, 'staff');", ['security.mjs']),
    ('wv-collection-made-for-outsiders', WVB, "if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", "await ensureCollections();\n  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');", ['security.mjs']),
    ('wv-collection-made-for-wrong-kinds', WVB, "  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');", "  await ensureCollections();\n  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');", ['security.mjs']),
    ('wv-update-without-suppressauth', WVB, '  if (old) return wixData.update(col, row, SA);', '  if (old) return wixData.update(col, row);', ['security.mjs']),
    ('wv-record-insert-without-suppressauth', WVB, "row(e, 'sig', p.id, sub, 'paper', note, JSON.stringify({ ver }), a)), SA);", "row(e, 'sig', p.id, sub, 'paper', note, JSON.stringify({ ver }), a)));", ['security.mjs']),
    ('wv-backend-deletes-a-row', WVB, 'const bookFor = async (ev) => bookOf(await rows(WAIV, ev));', 'const bookFor = async (ev) => bookOf(await rows(WAIV, ev));\nconst zap = (id) => wixData.remove(WAIV, id, SA);', ['security.mjs']),
    ('wv-writer-taken-from-call', WVB, "row(e, 'ver', String(n), '', '', '', JSON.stringify(wv), a)), SA);", "row(e, 'ver', String(n), '', '', '', JSON.stringify(wv), Object.assign({}, a, { username: String(arg.by || a.username) }))), SA);", ['security.mjs']),
    ('wv-note-in-the-change-notes', WVB, "who + ' version ' + ver + ': ' + out.recorded + ' recorded' + (note ? ', note given' : ''));", "who + ' version ' + ver + ': ' + out.recorded + ' recorded' + (note ? ', ' + note : ''));", ['security.mjs']),
    ('wv-reason-in-the-change-notes', WVB, "rec.sub + ' record, reason given');", "rec.sub + ' record, ' + reason);", ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-name-in-the-change-notes', WVB, "if (from === 0) await audit(a, 'waiver papers printed', e.name, who + ' ' + mode + ' ' + scope + ': ' + pg.total);", "if (from === 0) await audit(a, 'waiver papers printed', e.name, who + ' ' + mode + ' ' + scope + ': ' + pg.total + ' ' + (pg.items[0] ? pg.items[0].name : ''));", ['security.mjs']),
    ('wv-record-already-check-removed', WVB, "    if (st.state === 'signed' && st.ver >= ver) {\n      out.already++;\n      return;\n    }\n", '', ['waivers.mjs']),
    ('wv-record-any-version', WVB, "    if (!Number.isInteger(arg.ver) || arg.ver < book.settings.minVersion || arg.ver > book.latest) throw bad('wv_bad_version');\n", '', ['waivers.mjs', 'pentest-waivers.mjs']),
    ('wv-record-other-race-allowed', WVB, ".filter((r) => r.event === e._id && (who === 'volunteers' ? r.status !== 'declined' : r.status === 'ok'))", ".filter((r) => (who === 'volunteers' ? r.status !== 'declined' : r.status === 'ok'))", ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-record-unpaid-allowed', WVB, ".filter((r) => r.event === e._id && (who === 'volunteers' ? r.status !== 'declined' : r.status === 'ok'))", ".filter((r) => r.event === e._id && (who === 'volunteers' ? r.status !== 'declined' : true))", ['waivers.mjs']),
    ('wv-record-declined-volunteer-allowed', WVB, ".filter((r) => r.event === e._id && (who === 'volunteers' ? r.status !== 'declined' : r.status === 'ok'))", ".filter((r) => r.event === e._id && (who === 'volunteers' ? true : r.status === 'ok'))", ['waivers.mjs']),
    ('wv-record-no-id-limit', WVB, 'want.length > MAX_IDS || ', '', ['pentest-waivers.mjs']),
    ('wv-record-id-type-unchecked', WVB, "Array.from(want).some((x) => typeof x !== 'string' || !x || x.length > 120)", 'Array.from(want).some((x) => !x || x.length > 120)', ['pentest-waivers.mjs']),
    ('wv-record-row-not-unique', WVB, "Object.assign({ _id: rid }, row(e, 'sig', p.id, sub, 'paper', note, JSON.stringify({ ver }), a))", "Object.assign({}, row(e, 'sig', p.id, sub, 'paper', note, JSON.stringify({ ver }), a))", ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-record-failed-write-counted-as-done', WVB, '      else failed.push(p.id);', '      else out.already++;', ['pentest-waivers.mjs']),
    ('wv-record-failed-write-lost', WVB, '  out.left = out.left.concat(failed);\n', '', ['pentest-waivers.mjs']),
    ('wv-record-budget-ignored', WVB, '    if (Date.now() - t0 > BUDGET_MS) {', '    if (false) {', ['waivers.mjs', 'pentest-waivers.mjs']),
    ('wv-record-no-cap-per-person', WVB, '    const n = nextSig(book, e._id, sub, id);\n    if (!n) {\n      out.full++;\n      return;\n    }\n', '    const n = nextSig(book, e._id, sub, id) || 1;\n', ['pentest-waivers.mjs']),
    ('wv-record-not-noted', WVB, "  if (out.recorded) await audit(a, 'waiver papers recorded'", "  if (false) await audit(a, 'waiver papers recorded'", ['security.mjs']),
    ('wv-save-text-stale-allowed', WVB, "  if (book.latest !== arg.base) throw bad('wv_stale');\n", '', ['waivers.mjs']),
    ('wv-save-text-same-allowed', WVB, "  if (last && last.title === wv.title && last.text === wv.text) throw bad('wv_same');\n", '', ['waivers.mjs']),
    ('wv-save-text-no-cap', WVB, "  const n = nextVer(book, e._id); // 0 when the numbers up to MAX_VERSIONS are all used (by saved texts or by damaged rows)\n  if (!n) throw bad('wv_too_many');\n", '  const n = nextVer(book, e._id) || MAX_VERSIONS + 1;\n', ['waivers.mjs', 'pentest-waivers.mjs']),
    ('wv-save-text-overwrites', WVB, "    await wixData.insert(WAIV, Object.assign({ _id: ids.ver(e._id, n) }, row(e, 'ver', String(n), '', '', '', JSON.stringify(wv), a)), SA);", "    await put(WAIV, Object.assign({ _id: ids.ver(e._id, n) }, row(e, 'ver', String(n), '', '', '', JSON.stringify(wv), a)));", ['pentest-waivers.mjs']),
    ('wv-save-text-base-unchecked', WVB, "  if (!Number.isInteger(arg.base) || arg.base < 0 || arg.base > 9999) throw bad('wv_bad_version');\n", '', ['pentest-waivers.mjs']),
    ('wv-save-text-not-noted', WVB, "  await audit(a, 'waiver text saved'", "  if (false) await audit(a, 'waiver text saved'", ['security.mjs']),
    ('wv-settings-partial-allowed', WVB, "  if (SET_KEYS.some((k) => arg[k] === undefined)) throw bad('wv_bad_settings');\n", '', ['waivers.mjs', 'pentest-waivers.mjs']),
    ('wv-settings-not-noted', WVB, "  await audit(a, 'waiver settings saved'", "  if (false) await audit(a, 'waiver settings saved'", ['security.mjs']),
    ('wv-void-twice-allowed', WVB, "    await wixData.insert(WAIV, Object.assign({ _id: ids.vd(id) }, row(e, 'vd', id, '', '', reason, '', a)), SA);", "    await put(WAIV, Object.assign({ _id: ids.vd(id) }, row(e, 'vd', id, '', '', reason, '', a)));", ['waivers.mjs']),
    ('wv-void-any-kind-of-row', WVB, "if (!rec || rec.kind !== 'sig' || rec.event !== e._id) throw bad('wv_no_item');", "if (!rec || rec.event !== e._id) throw bad('wv_no_item');", ['waivers.mjs', 'pentest-waivers.mjs']),
    ('wv-void-other-race', WVB, "if (!rec || rec.kind !== 'sig' || rec.event !== e._id) throw bad('wv_no_item');", "if (!rec || rec.kind !== 'sig') throw bad('wv_no_item');", ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-void-without-reason', WVB, "  if (!reason) throw bad('wv_bad_reason');\n", '', ['waivers.mjs']),
    ('wv-void-reason-unbounded', WVB, "if (typeof arg.reason !== 'string' || arg.reason.length > MAX_NOTE * 3) throw bad('wv_bad_reason');", "if (typeof arg.reason !== 'string') throw bad('wv_bad_reason');", ['pentest-waivers.mjs']),
    ('wv-void-not-noted', WVB, "  await audit(a, 'waiver record voided'", "  if (false) await audit(a, 'waiver record voided'", ['waivers.mjs', 'security.mjs']),
    ('wv-list-filter-unchecked', WVB, "  const filter = pickOf(arg.filter, FILTERS, 'all', 'wv_bad_filter');", "  const filter = arg.filter || 'all';", ['pentest-waivers.mjs']),
    ('wv-list-page-too-big', WVB, '  const pg = pageOf(listOf(subOf(who), pp.people, book, { filter, cat, q }), from, LIST_PAGE);', '  const pg = pageOf(listOf(subOf(who), pp.people, book, { filter, cat, q }), from, 100000);', ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-records-other-race', WVB, '  if (!r || r.event !== e._id) return null;\n', '  if (!r) return null;\n', ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-records-unpaid-person', WVB, "  if (who === 'volunteers' ? r.status === 'declined' : r.status !== 'ok') return null;\n", '', ['waivers.mjs', 'pentest-waivers.mjs']),
    ('wv-sheet-copies-unbounded', WVB, "  if (!Number.isInteger(v) || v < 1 || v > MAX_COPIES) throw bad('wv_bad_copies');", "  if (!Number.isInteger(v) || v < 1) throw bad('wv_bad_copies');", ['pentest-waivers.mjs']),
    ('wv-sheet-forms-chunk-too-big', WVB, "from, mode === 'forms' ? CHUNK_FORMS : CHUNK_LIST);", 'from, CHUNK_LIST);', ['pentest-waivers.mjs', 'waivers.mjs']),
    ('wv-sheet-copies-on-a-list', WVB, "  if (scope !== 'blank' && arg.copies !== undefined) throw bad('wv_bad_copies');\n", '', ['pentest-waivers.mjs']),
    ('wv-sheet-not-noted', WVB, "  if (from === 0) await audit(a, 'waiver papers printed', e.name, who + ' ' + mode", "  if (false) await audit(a, 'waiver papers printed', e.name, who + ' ' + mode", ['waivers.mjs', 'security.mjs']),
    ('wv-title-not-text-allowed', WVL, " || typeof raw.title !== 'string' || typeof raw.text !== 'string') throw werr('wv_bad_text');", ") throw werr('wv_bad_text');", ['pentest-waivers.mjs']),
    ('wv-unknown-placeholder-allowed', WVL, "  if (holes(title).concat(holes(text)).some((k) => !PLACEHOLDERS.includes(k))) throw werr('wv_placeholder');\n", '', ['unit-waiver.mjs']),
    ('wv-text-too-long-cut-silently', WVL, '  const text = cleanBody(raw.text, MAX_TEXT + 1);', '  const text = cleanBody(raw.text, MAX_TEXT);', ['unit-waiver.mjs']),
    ('wv-title-too-long-cut-silently', WVL, '  const title = oneLine(raw.title, MAX_TITLE + 1);', '  const title = oneLine(raw.title, MAX_TITLE);', ['unit-waiver.mjs']),
    ('wv-settings-unknown-keys-allowed', WVL, '  for (const k of Object.keys(raw)) if (!SET_KEYS.includes(k)) throw bad();\n', '', ['unit-waiver.mjs']),
    ('wv-settings-version-out-of-range', WVL, "const okVer = (v, top) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= Math.max(1, top);", "const okVer = (v, top) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9999;", ['unit-waiver.mjs']),
    ('wv-settings-accept-unbounded', WVL, 'if (!Array.isArray(raw.accept) || raw.accept.length > MAX_ACCEPT) throw bad();', 'if (!Array.isArray(raw.accept)) throw bad();', ['unit-waiver.mjs']),
    ('wv-any-answer-counts-as-signed', WVL, '  return !!a && Array.isArray(list) && list.includes(a);', '  return !!a;', ['unit-waiver.mjs']),
    ('wv-empty-answer-counts-as-signed', WVL, '  return !!a && Array.isArray(list) && list.includes(a);', '  return !a || (Array.isArray(list) && list.includes(a));', ['unit-waiver.mjs']),
    ('wv-older-counts-as-signed', WVL, "  return { state: best.ver >= min ? 'signed' : 'older',", "  return { state: 'signed',", ['unit-waiver.mjs']),
    ('wv-lowest-version-wins', WVL, 'if (!best || c.ver > best.ver || (c.ver === best.ver && T(c.at) > T(best.at))) best = c;', 'if (!best || c.ver < best.ver || (c.ver === best.ver && T(c.at) > T(best.at))) best = c;', ['unit-waiver.mjs']),
    ('wv-voided-record-counts-for-runner', WVL, "  sigsOf(book, 'runner', reg && reg._id)\n    .filter((s) => !s.void)\n", "  sigsOf(book, 'runner', reg && reg._id)\n", ['unit-waiver.mjs']),
    ('wv-voided-record-counts-for-volunteer', WVL, "  sigsOf(book, 'volunteer', vol && vol._id)\n    .filter((s) => !s.void)\n", "  sigsOf(book, 'volunteer', vol && vol._id)\n", ['unit-waiver.mjs']),
    ('wv-record-with-unreadable-version-counts', WVL, ' && /^[1-9]\\d{0,3}$/.test(T(parseJson(r.json, {}).ver)))', ')', ['unit-waiver.mjs', 'pentest-waivers.mjs']),
    ('wv-damaged-row-ids-reused', WVL, '  const taken = new Set(rows.map((r) => T(r._id)));', '  const taken = new Set();', ['unit-waiver.mjs', 'pentest-waivers.mjs']),
    ('wv-next-record-number-reused', WVL, 'for (let n = 1; n <= MAX_PER_PERSON; n++) if (!taken.has(ids.sig(T(ev), T(sub), T(ref), n))) return n;', 'for (let n = 1; n <= MAX_PER_PERSON; n++) return n;', ['unit-waiver.mjs']),
    ('wv-next-record-number-no-cap', WVL, 'for (let n = 1; n <= MAX_PER_PERSON; n++) if (!taken.has(ids.sig(', 'for (let n = 1; n <= MAX_PER_PERSON + 5; n++) if (!taken.has(ids.sig(', ['unit-waiver.mjs']),
    ('wv-next-version-number-reused', WVL, 'for (let n = top + 1; n <= MAX_VERSIONS; n++) if (!taken.has(ids.ver(T(ev), n))) return n;', 'return top + 1;', ['unit-waiver.mjs']),
    ('wv-unreadable-volunteer-version-is-zero', WVL, '  return n >= 1 ? n : 1;', '  return n;', ['unit-waiver.mjs']),
    ('wv-declined-volunteers-asked', WVL, "export const waiverVolunteers = (vols) => (Array.isArray(vols) ? vols : []).filter((v) => v && v.status !== 'declined');", 'export const waiverVolunteers = (vols) => (Array.isArray(vols) ? vols : []).filter((v) => v);', ['unit-waiver.mjs']),
    ('wv-unpaid-runners-asked', WVL, "export const waiverRunners = (regs) => (Array.isArray(regs) ? regs : []).filter((r) => r && r.status === 'ok');", 'export const waiverRunners = (regs) => (Array.isArray(regs) ? regs : []).filter((r) => r);', ['unit-waiver.mjs']),
    ('wv-list-bib-search-off', WVL, ' || (bq && l.bib === bq))', ')', ['unit-waiver.mjs']),
    ('wv-list-category-filter-off', WVL, '    .filter((l) => !opt.cat || catKey(l.cat) === catKey(opt.cat))\n', '', ['unit-waiver.mjs']),
    ('wv-todo-leaves-out-older', WVL, "filter === 'todo' ? line.state !== 'signed'", "filter === 'todo' ? line.state === 'none'", ['unit-waiver.mjs']),
    ('wv-blank-copies-unbounded', WVL, 'const n = Number.isInteger(copies) && copies >= 1 ? Math.min(copies, MAX_COPIES) : 1;', 'const n = Number.isInteger(copies) && copies >= 1 ? copies : 1;', ['unit-waiver.mjs']),
    ('wv-person-line-holds-phone', WVL, 'const base = { id: T(row._id), name: cleanText(row.name, 80), state: s.state, ver: s.ver, how: s.how, at: s.at };', 'const base = { id: T(row._id), name: cleanText(row.name, 80), state: s.state, ver: s.ver, how: s.how, at: s.at, phone: T(row.phone) };', ['security.mjs', 'waivers.mjs']),
    ('wv-form-answers-listed', WVL, '      const x = f.get(n) || { name: n, count: 0 };', '      const x = f.get(n) || { name: n, count: 0, sample: String(v) };', ['security.mjs']),
    ('wv-paper-runner-name-unescaped', WVL, '\'<div class="who">Name: <b>\' + esc(v.name) + \'</b> &nbsp;&middot;&nbsp; Bib:', '\'<div class="who">Name: <b>\' + v.name + \'</b> &nbsp;&middot;&nbsp; Bib:', ['pentest-waivers.mjs']),
    ('wv-paper-volunteer-name-unescaped', WVL, '\'<div class="who">Name: <b>\' + esc(v.name) + \'</b></div>\'', '\'<div class="who">Name: <b>\' + v.name + \'</b></div>\'', ['pentest-waivers.mjs']),
    ('wv-paper-category-unescaped', WVL, "Category: <b>' + esc(v.cat) + '</b>", "Category: <b>' + v.cat + '</b>", ['pentest-waivers.mjs']),
    ('wv-paper-text-unescaped', WVL, ".map((p) => '<p>' + esc(vars ? fill(p, vars) : p).replace(/\\n/g, '<br>') + '</p>')", ".map((p) => '<p>' + (vars ? fill(p, vars) : p).replace(/\\n/g, '<br>') + '</p>')", ['pentest-waivers.mjs']),
    ('wv-paper-title-unescaped', WVL, 'const head = \'<h1>\' + esc(fill(wv.title, v)) + \'</h1><div class="sub">\' + subLine(v) + \'</div>\';', 'const head = \'<h1>\' + fill(wv.title, v) + \'</h1><div class="sub">\' + subLine(v) + \'</div>\';', ['pentest-waivers.mjs']),
    ('wv-paper-race-line-unescaped', WVL, "const subLine = (v) => esc([v.race, v.date, v.venue].filter(Boolean).join(' · '));", "const subLine = (v) => [v.race, v.date, v.venue].filter(Boolean).join(' · ');", ['pentest-waivers.mjs']),
    ('wv-list-name-unescaped', WVL, "'</b></td><td>' + esc(r.name) + '</td><td>' + esc(r.cat) + '</td>", "'</b></td><td>' + r.name + '</td><td>' + esc(r.cat) + '</td>", ['pentest-waivers.mjs']),
    ('wv-volunteer-waiver-filled-in', WVL, 'paras(wv.text, vol ? null : v) + who1', 'paras(wv.text, v) + who1', ['unit-waiver.mjs', 'pentest-waivers.mjs']),
    ('cm-waiver-audience-filter-off', CML, "      if ((aud.waiver === 'signed' || aud.waiver === 'unsigned') && p.waiver !== aud.waiver) return false;\n", '', ['unit-comms.mjs', 'comms.mjs']),
    ('cm-waiver-choice-unchecked', CML, "  const wv = pickOf(raw.waiver, WAIVER, 'any');", "  const wv = raw.waiver === undefined ? 'any' : raw.waiver;", ['unit-comms.mjs', 'pentest-comms.mjs']),
    ('cm-waiver-label-missing', CML, "  if (a.waiver === 'signed') parts.push('waiver signed');\n", '', ['unit-comms.mjs']),
    ('cm-waiver-older-counts-as-signed', CMB, "const waiverOf = (st) => (book ? (st.state === 'signed' ? 'signed' : 'unsigned') : '');", "const waiverOf = (st) => (book ? (st.state === 'none' ? 'unsigned' : 'signed') : '');", ['comms.mjs']),
    ('cm-waiver-runners-not-read', CMB, "      waiver: book ? waiverOf(runnerState(r, book)) : '',", "      waiver: '',", ['comms.mjs']),
    ('cm-waiver-volunteers-not-read', CMB, "waiver: book ? waiverOf(volunteerState(v, book)) : '' }));", "waiver: '' }));", ['comms.mjs']),
    ('wv-page-relay-list-open', FINPAGE, '      if (WV_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);\n', '', ['pagecode.mjs', 'security.mjs']),
    ('cm-ui-waiver-sent-when-not-asked', DIR, "if(a.waiver==='signed'||a.waiver==='unsigned')o.waiver=a.waiver;", 'o.waiver=a.waiver;', ['comms-ui.mjs']),
    ('wv-ui-void-without-second-click', DIR, 'arm(\'wv-void-\'+r.id,\'Mark as a mistake\',\'wv-void\',\'data-id="\'+esc(r.id)+\'"\')', '\'<button class="btn sm bad" data-act="wv-void" data-id="\'+esc(r.id)+\'">Mark as a mistake</button>\'', ['waivers-ui.mjs']),
    ('wv-ui-name-unescaped-in-list', DIR, "'<td>'+esc(l.name)+'</td>'+(isR?'<td>'+esc(l.cat||'-')+'</td>'", "'<td>'+l.name+'</td>'+(isR?'<td>'+esc(l.cat||'-')+'</td>'", ['waivers-ui.mjs']),
    ('wv-ui-tick-label-unescaped', DIR, 'aria-label="Tick \'+esc(l.name)+\'"', 'aria-label="Tick \'+l.name+\'"', ['waivers-ui.mjs']),
    ('wv-ui-note-unescaped-in-records', DIR, "+esc(r.note||'')+'</td><td>'+esc(r.by)", "+(r.note||'')+'</td><td>'+esc(r.by)", ['waivers-ui.mjs']),
    ('wv-ui-void-reason-unescaped', DIR, "+esc(r.void.reason)+'</small>'", "+r.void.reason+'</small>'", ['waivers-ui.mjs']),
    ('wv-ui-text-unescaped-in-the-box', DIR, 'maxlength="\'+ov.limits.text+\'" required>\'+esc(dr.text)+\'</textarea>', 'maxlength="\'+ov.limits.text+\'" required>\'+dr.text+\'</textarea>', ['waivers-ui.mjs']),
    ('wv-ui-version-title-unescaped', DIR, "'<tr><td>'+wnum(v.ver)+'</td><td>'+esc(v.title)+'</td>", "'<tr><td>'+wnum(v.ver)+'</td><td>'+v.title+'</td>", ['waivers-ui.mjs']),
    ('wv-ui-record-sends-no-version', DIR, 'if(w.note)a.note=w.note;if(isR)a.ver=w.ver;', 'if(w.note)a.note=w.note;', ['waivers-ui.mjs']),
    ('wv-ui-record-never-stops-resending', DIR, "if(r.left.length>=part.length&&!r.recorded&&!r.already)throw new Error('timeout');", '', ['waivers-ui.mjs']),
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
