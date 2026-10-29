# Test report

Made by `python3 tests/report.py` (every suite, run once). Re-run it after any change.

| Kind of test | Suites | Checks passed | Failed |
|---|---|---|---|
| 1. Unit tests | 3 | 488 | 0 |
| 2. Penetration tests | 4 | 703 | 0 |
| 3. Integration tests | 6 | 711 | 0 |
| 4. Security tests | 1 | 204 | 0 |
| Component tests (older suites) | 18 | 1320 | 0 |
| 5. Regression (older suites against the saved baseline) | 32 | 3426 | 0 |

**Total: 3426 checks passed, 0 failed.**

## 1. Unit tests

One piece on its own: password hashing, PINs, roles, the Team screen rules, and the Finance rules (money arithmetic, numbering, text cleaning).

| Suite | Passed | Failed |
|---|---|---|
| `unit-auth.mjs` | 122 | 0 |
| `unit-team.mjs` | 249 | 0 |
| `unit-finance.mjs` | 117 | 0 |

## 2. Penetration tests

Attacks on logins, tokens, roles, the desk, the page relay and the Finance tab (money, claims, cash, the screens and what they print); every attack must fail.

| Suite | Passed | Failed |
|---|---|---|
| `pentest.mjs` | 422 | 0 |
| `pentest-ui.mjs` | 131 | 0 |
| `pentest-finance.mjs` | 118 | 0 |
| `pentest-finance-ui.mjs` | 32 | 0 |

## 3. Integration tests

Whole journeys across RaceOS, the Expo desk, the coach pages and Finance (invoice to payment, order to refund, claim to payout, cash).

| Suite | Passed | Failed |
|---|---|---|
| `integration-flow.mjs` | 100 | 0 |
| `integration-ui.mjs` | 47 | 0 |
| `expo-int.mjs` | 65 | 0 |
| `scen.mjs` | 97 | 0 |
| `finance.mjs` | 222 | 0 |
| `finance-ui.mjs` | 180 | 0 |

## 4. Security tests

An audit of every method, Finance included, against the written role table, secrets, locks and shipped files.

| Suite | Passed | Failed |
|---|---|---|
| `security.mjs` | 204 | 0 |

## Component tests (older suites)

Each backend method and each screen, one by one; these also form the regression set.

| Suite | Passed | Failed |
|---|---|---|
| `director.mjs` | 209 | 0 |
| `plan.mjs` | 98 | 0 |
| `dash.mjs` | 38 | 0 |
| `ai.mjs` | 77 | 0 |
| `approvals.mjs` | 228 | 0 |
| `training.mjs` | 130 | 0 |
| `director-ui.mjs` | 73 | 0 |
| `plan-ui.mjs` | 51 | 0 |
| `dash-ui.mjs` | 15 | 0 |
| `coaching-ui.mjs` | 15 | 0 |
| `bibs-ai-ui.mjs` | 27 | 0 |
| `training-ui.mjs` | 37 | 0 |
| `training-ai.mjs` | 32 | 0 |
| `approvals-ui.mjs` | 60 | 0 |
| `preview-ui.mjs` | 48 | 0 |
| `pagecode.mjs` | 79 | 0 |
| `ui.mjs` | 45 | 0 |
| `rd-ui.mjs` | 58 | 0 |

## 5. Regression

Every suite that existed before a change must still pass at least as many checks as the saved baseline (`tests/baseline.txt`). A suite that passes fewer, or fails one, is flagged above.

| Suite | Baseline | Now |
|---|---|---|
| `ai.mjs` | 77 | 77 |
| `approvals-ui.mjs` | 60 | 60 |
| `approvals.mjs` | 228 | 228 |
| `bibs-ai-ui.mjs` | 27 | 27 |
| `coaching-ui.mjs` | 15 | 15 |
| `dash-ui.mjs` | 15 | 15 |
| `dash.mjs` | 38 | 38 |
| `director-ui.mjs` | 73 | 73 |
| `director.mjs` | 209 | 209 |
| `expo-int.mjs` | 65 | 65 |
| `finance-ui.mjs` | 180 | 180 |
| `finance.mjs` | 222 | 222 |
| `integration-flow.mjs` | 100 | 100 |
| `integration-ui.mjs` | 47 | 47 |
| `pagecode.mjs` | 79 | 79 |
| `pentest-finance-ui.mjs` | 32 | 32 |
| `pentest-finance.mjs` | 118 | 118 |
| `pentest-ui.mjs` | 131 | 131 |
| `pentest.mjs` | 422 | 422 |
| `plan-ui.mjs` | 51 | 51 |
| `plan.mjs` | 98 | 98 |
| `preview-ui.mjs` | 48 | 48 |
| `rd-ui.mjs` | 58 | 58 |
| `scen.mjs` | 97 | 97 |
| `security.mjs` | 204 | 204 |
| `training-ai.mjs` | 32 | 32 |
| `training-ui.mjs` | 37 | 37 |
| `training.mjs` | 130 | 130 |
| `ui.mjs` | 45 | 45 |
| `unit-auth.mjs` | 122 | 122 |
| `unit-finance.mjs` | 117 | 117 |
| `unit-team.mjs` | 249 | 249 |

## Do the tests really catch mistakes? (mutation spot-checks)

One protection is removed on purpose in a scratch copy; the named suites must fail. KILLED is good, SURVIVED would mean a hole in the tests.

| Protection removed | Result | Caught by |
|---|---|---|
| shell-believes-desk-answers | KILLED | pentest-ui.mjs: U3 an answer forged by the desk frame is not believed by the RaceOS page |
| desk-believes-any-answer | KILLED | pentest-ui.mjs: U3 an answer forged by another window, by nobody, by the Wix page or by th |
| desk-shows-any-selfie | KILLED | pentest-ui.mjs: U2 proof of who collected (friend name, phone, desk) with the payload make |
| banner-any-address | KILLED | pentest-ui.mjs: U1 no screen turned the payload into a live element, handler, script addre |
| proof-link-any-scheme | KILLED | pentest-ui.mjs: U1 no screen turned the payload into a live element, handler, script addre |
| banner-saved-without-check | KILLED | pentest-ui.mjs: U1 the server refuses the banner address "https://example.com/a.jpg');posi |
| odd-race-data-not-tidied | KILLED | pentest-ui.mjs |
| no-escaping | KILLED | pentest-ui.mjs: U1 no screen turned the payload into a live element, handler, script addre |
| frame-can-set-token | KILLED | pentest-ui.mjs: U3 the page puts its own session token on every call, whatever token the f |
| frame-can-pick-module | KILLED | pentest-ui.mjs: U3 whatever the desk frame asks for goes to the server as an Expo call onl |
| anyone-can-call-through-shell | KILLED | pentest-ui.mjs: U3 a "call" message from the page itself, nowhere or a stranger window mak |
| open-team-from-anyone | KILLED | pentest-ui.mjs: U3 "open-team" from the Wix page, nowhere or a stranger window does nothin |
| csv-formulas-run | KILLED | pentest-ui.mjs: U6 RaceOS: "=1+1" becomes text ("=1+1") |
| csv-formulas-run-desk | KILLED | pentest-ui.mjs: U6 Expo desk: "=1+1" becomes text ("=1+1") |
| pin-stays-after-tab-change | KILLED | pentest-ui.mjs: U5 coming back does not show it again |
| pin-stays-after-logout | KILLED | pentest-ui.mjs: U5 the next login on the same screen is not shown the PIN card of the last |
| login-gate-removed | KILLED | pentest.mjs: A4 60 guesses at one account at the same instant: at most 5 are even looked a |
| coach-login-gate-removed | KILLED | pentest.mjs: A4 60 guesses split between the RaceOS and the coach login: at most 5 are loo |
| athlete-login-gate-removed | KILLED | pentest.mjs: A4 60 PIN guesses at one athlete at the same instant: at most 5 are looked at |
| change-pin-gate-removed | KILLED | pentest.mjs: A4 40 guesses at the old PIN of changePin at the same instant: at most 5 are  |
| setup-key-gate-removed | KILLED | pentest.mjs: H2 40 setup-key guesses at the same instant: at most 10 are looked at (39) |
| reset-keeps-login-slots | KILLED | unit-team.mjs |
| new-password-keeps-login-slots | KILLED | unit-team.mjs |
| good-login-keeps-slots | KILLED | pentest.mjs |
| plan-status-before-login-check | KILLED | security.mjs: S1 RaceOS: the methods that need no login are exactly the expected ones   [g |
| decide-qual-before-login-check | KILLED | security.mjs: S1 RaceOS: the login is the first thing every other method checks: nothing i |
| collections-readable-by-visitors | KILLED | security.mjs: S7 every RaceOS collection can be read, added to, changed and emptied only b |
| viewer-sees-money | KILLED | security.mjs: S3 a viewer cannot even read "budget" items   [wanted not_allowed, got no_ev |
| setup-open-with-placeholder-key | KILLED | security.mjs: S7 RaceOS setup with the placeholder key left in the file refuses everyone,  |
| manage-check-removed | KILLED | security.mjs: S3 RaceOS: lead1 on all 69 methods [saveEvent -> no_event (wanted director_o |
| desk-allowed-in-raceos | KILLED | security.mjs: S3 RaceOS: desk1 on all 69 methods [listEvents -> no error (wanted not_allow |
| expo-lets-everyone-in | KILLED | security.mjs: S3 Expo: lead1 on all 15 methods [enter -> no error (wanted not_allowed); wh |
| double-handover | KILLED | pentest.mjs |
| fin-overpay-allowed | KILLED | finance.mjs: F2 paying more than the balance is refused   [wanted too_much, got no error] |
| fin-lead-sees-all-claims | KILLED | security.mjs: S4 a lead's claim list holds their own claim and not the director's   [got [ |
| fin-lead-edits-others-claims | KILLED | pentest-finance.mjs: FB3 lead two cannot change lead one's claim   [wanted no_item, got no |
| fin-cash-check-removed | KILLED | finance.mjs: F5 spending more cash than the holder has is refused   [wanted not_enough_cas |
| fin-void-deletes-the-row | KILLED | finance.mjs |
| fin-other-race-ids-work | KILLED | pentest-finance.mjs: FB4 an invoice, order, claim or ledger row of the OTHER race, named o |
| fin-session-expiry-fails-open | KILLED | pentest-finance.mjs: FA3 a session with a blank or damaged expiry (10 kinds) is refused by |
| raceos-session-expiry-fails-open | KILLED | pentest-finance.mjs: FA3 a session with a blank or damaged expiry (10 kinds) is refused by |
| expo-session-expiry-fails-open | KILLED | pentest-finance.mjs: FA3 a session with a blank or damaged expiry (10 kinds) is refused by |
| coach-session-expiry-fails-open | KILLED | pentest-finance.mjs: FA3 a session with a blank or damaged expiry (10 kinds) is refused by |
| athlete-session-expiry-fails-open | KILLED | pentest-finance.mjs: FA3 a session with a blank or damaged expiry (10 kinds) is refused by |
| fin-role-check-removed | KILLED | security.mjs: S3 Finance: view1 on all 23 methods [finListClaims -> no_event (wanted not_a |
| fin-director-only-removed | KILLED | security.mjs: S3 Finance: lead1 on all 23 methods [finOverview -> no_event (wanted directo |
| fin-repeat-key-any-login | KILLED | pentest-finance.mjs: FE4 another director using my key gets nothing of mine and makes noth |
| fin-repeat-key-not-checked | KILLED | pentest-finance.mjs: FE3 repeat keys that are too short, too long, hold spaces, "~", "/",  |
| fin-text-not-cleaned | KILLED | unit-finance.mjs: cleanText strips control characters, ignores objects, cuts to length   [ |
| fin-zero-money-allowed | KILLED | unit-finance.mjs: toPaise refuses all 33 odd or hostile amounts (text, commas, symbols, ne |
| fin-choice-from-any-type | KILLED | pentest-finance.mjs: FC3 an order payment given the phase ["advance"] (to pass as a refund |
| fin-claim-owner-from-call | KILLED | pentest-finance.mjs: FC1 a claim raised with its id, race, number, status, approval, owner |
| fin-collections-readable-by-visitors | KILLED | security.mjs: S7 Finance makes its 5 collections on first use, each readable, changeable a |
| fin-write-without-suppress-auth | KILLED | security.mjs: S8 every Finance read and write of a locked collection passes suppressAuth ( |
| fin-page-relay-list-open | KILLED | pentest-finance.mjs: FH1 on the Finance side of the relay, a method that is not one of the |
| fin-void-cash-recheck-removed | KILLED | finance.mjs: F5 two withdrawals of the same person voided at the same moment never leave t |
| fin-refund-over-paid | KILLED | pentest-finance.mjs: FD4 a refund one paisa more than has been paid to that vendor (10010) |
| fin-pay-unapproved-claim | KILLED | pentest-finance.mjs: FB7 a claim that is not approved cannot be paid   [wanted claim_not_a |
| fin-cancel-paid-invoice | KILLED | pentest-finance.mjs: FB7 an invoice that has been paid cannot be cancelled to make the mon |
| fin-screens-no-escaping | KILLED | pentest-finance-ui.mjs: UF1 the seven Finance sections (Summary, Invoices, Orders, Claims, |
| fin-csv-formulas-run | KILLED | pentest-finance-ui.mjs: UF3 not one cell of the exported ledger starts with "=", "+", "-", |
| fin-print-unescaped | KILLED | pentest-finance-ui.mjs: UF2 not one printed page or Word file holds the attack text as mar |

## How to run

```
sh tests/all.sh                  every suite once, writes this report
python3 tests/report.py --only security
python3 tests/mutants.py        mutation spot-checks
```
