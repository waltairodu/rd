# Test report

Made by `python3 tests/report.py` (every suite, run once). Re-run it after any change.

| Kind of test | Suites | Checks passed | Failed |
|---|---|---|---|
| 1. Unit tests | 2 | 371 | 0 |
| 2. Penetration tests | 2 | 553 | 0 |
| 3. Integration tests | 4 | 309 | 0 |
| 4. Security tests | 1 | 149 | 0 |
| Component tests (older suites) | 18 | 1306 | 0 |
| 5. Regression (older suites against the saved baseline) | 27 | 2688 | 0 |

**Total: 2688 checks passed, 0 failed.**

## 1. Unit tests

One piece on its own: password hashing, PINs, roles, the Team screen rules.

| Suite | Passed | Failed |
|---|---|---|
| `unit-auth.mjs` | 122 | 0 |
| `unit-team.mjs` | 249 | 0 |

## 2. Penetration tests

Attacks on logins, tokens, roles, the desk and the page relay; every attack must fail.

| Suite | Passed | Failed |
|---|---|---|
| `pentest.mjs` | 422 | 0 |
| `pentest-ui.mjs` | 131 | 0 |

## 3. Integration tests

Whole journeys across RaceOS, the Expo desk and the coach pages.

| Suite | Passed | Failed |
|---|---|---|
| `integration-flow.mjs` | 100 | 0 |
| `integration-ui.mjs` | 47 | 0 |
| `expo-int.mjs` | 65 | 0 |
| `scen.mjs` | 97 | 0 |

## 4. Security tests

An audit of every method against the written role table, secrets, locks and shipped files.

| Suite | Passed | Failed |
|---|---|---|
| `security.mjs` | 149 | 0 |

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
| `pagecode.mjs` | 65 | 0 |
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
| `integration-flow.mjs` | 100 | 100 |
| `integration-ui.mjs` | 47 | 47 |
| `pagecode.mjs` | 65 | 65 |
| `pentest-ui.mjs` | 131 | 131 |
| `pentest.mjs` | 422 | 422 |
| `plan-ui.mjs` | 51 | 51 |
| `plan.mjs` | 98 | 98 |
| `preview-ui.mjs` | 48 | 48 |
| `rd-ui.mjs` | 58 | 58 |
| `scen.mjs` | 97 | 97 |
| `security.mjs` | 149 | 149 |
| `training-ai.mjs` | 32 | 32 |
| `training-ui.mjs` | 37 | 37 |
| `training.mjs` | 130 | 130 |
| `ui.mjs` | 45 | 45 |
| `unit-auth.mjs` | 122 | 122 |
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

## How to run

```
sh tests/all.sh                  every suite once, writes this report
python3 tests/report.py --only security
python3 tests/mutants.py        mutation spot-checks
```
