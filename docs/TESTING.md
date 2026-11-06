# Test report

Made by `python3 tests/report.py` (every suite, run once). Re-run it after any change.

| Kind of test | Suites | Checks passed | Failed |
|---|---|---|---|
| 1. Unit tests | 6 | 847 | 0 |
| 2. Penetration tests | 7 | 1146 | 0 |
| 3. Integration tests | 13 | 2271 | 0 |
| 4. Security tests | 1 | 418 | 0 |
| Component tests (older suites) | 18 | 1414 | 0 |
| 5. Regression (older suites against the saved baseline) | 41 | 5051 | 0 |

**Total: 6096 checks passed, 0 failed.**

## 1. Unit tests

One piece on its own: password hashing, PINs, roles, the Team screen rules, the Finance rules (money arithmetic, numbering, text cleaning), and the Results rules (times, ranking, age groups, awards, waves, reading a results file), and the printing rules (text cleaning, picture and colour limits, filling bibs and certificates, spare bibs, what the public page may tell), and the Messages rules (text cleaning, e-mail and chat-link checks, filling templates, CSV safety, who is in an audience).

| Suite | Passed | Failed |
|---|---|---|
| `unit-auth.mjs` | 122 | 0 |
| `unit-team.mjs` | 249 | 0 |
| `unit-finance.mjs` | 117 | 0 |
| `unit-results.mjs` | 119 | 0 |
| `unit-print.mjs` | 120 | 0 |
| `unit-comms.mjs` | 120 | 0 |

## 2. Penetration tests

Attacks on logins, tokens, roles, the desk, the page relay, the Finance tab (money, claims, cash, the screens and what they print), the Waves & results tab (results files, placing, fixing, voiding, personal details), the Bibs & certificates tab with the public runner page (designs, pictures, printing, the page's switches, what a stranger can find) and the Messages tab (templates, audiences, sending twice, other races, lead and desk logins, hostile text on every screen); every attack must fail.

| Suite | Passed | Failed |
|---|---|---|
| `pentest.mjs` | 422 | 0 |
| `pentest-ui.mjs` | 131 | 0 |
| `pentest-finance.mjs` | 118 | 0 |
| `pentest-finance-ui.mjs` | 32 | 0 |
| `pentest-results.mjs` | 105 | 0 |
| `pentest-print.mjs` | 135 | 0 |
| `pentest-comms.mjs` | 203 | 0 |

## 3. Integration tests

Whole journeys across RaceOS, the Expo desk, the coach pages, Finance (invoice to payment, order to refund, claim to payout, cash), Waves & results (waves to placed runners, results file to board to awards), Bibs & certificates (design, preview, print, public page, certificate) and Messages (template to audience to batch to e-mails sent, retry, chat links, history, export).

| Suite | Passed | Failed |
|---|---|---|
| `integration-flow.mjs` | 100 | 0 |
| `integration-ui.mjs` | 47 | 0 |
| `expo-int.mjs` | 65 | 0 |
| `scen.mjs` | 97 | 0 |
| `finance.mjs` | 222 | 0 |
| `finance-ui.mjs` | 180 | 0 |
| `results.mjs` | 173 | 0 |
| `results-ui.mjs` | 169 | 0 |
| `print.mjs` | 219 | 0 |
| `print-ui.mjs` | 178 | 0 |
| `runner-ui.mjs` | 99 | 0 |
| `comms.mjs` | 477 | 0 |
| `comms-ui.mjs` | 245 | 0 |

## 4. Security tests

An audit of every method, Finance, Results, Print, Messages and the public runner page included, against the written role table, secrets, locks and shipped files.

| Suite | Passed | Failed |
|---|---|---|
| `security.mjs` | 418 | 0 |

## Component tests (older suites)

Each backend method and each screen, one by one; these also form the regression set.

| Suite | Passed | Failed |
|---|---|---|
| `director.mjs` | 211 | 0 |
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
| `pagecode.mjs` | 171 | 0 |
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
| `director.mjs` | 209 | 211 |
| `expo-int.mjs` | 65 | 65 |
| `finance-ui.mjs` | 180 | 180 |
| `finance.mjs` | 222 | 222 |
| `integration-flow.mjs` | 100 | 100 |
| `integration-ui.mjs` | 47 | 47 |
| `pagecode.mjs` | 146 | 171 |
| `pentest-finance-ui.mjs` | 32 | 32 |
| `pentest-finance.mjs` | 118 | 118 |
| `pentest-print.mjs` | 135 | 135 |
| `pentest-results.mjs` | 105 | 105 |
| `pentest-ui.mjs` | 131 | 131 |
| `pentest.mjs` | 422 | 422 |
| `plan-ui.mjs` | 51 | 51 |
| `plan.mjs` | 98 | 98 |
| `preview-ui.mjs` | 48 | 48 |
| `print-ui.mjs` | 178 | 178 |
| `print.mjs` | 219 | 219 |
| `rd-ui.mjs` | 58 | 58 |
| `results-ui.mjs` | 169 | 169 |
| `results.mjs` | 173 | 173 |
| `runner-ui.mjs` | 99 | 99 |
| `scen.mjs` | 97 | 97 |
| `security.mjs` | 338 | 418 |
| `training-ai.mjs` | 32 | 32 |
| `training-ui.mjs` | 37 | 37 |
| `training.mjs` | 130 | 130 |
| `ui.mjs` | 45 | 45 |
| `unit-auth.mjs` | 122 | 122 |
| `unit-finance.mjs` | 117 | 117 |
| `unit-print.mjs` | 120 | 120 |
| `unit-results.mjs` | 119 | 119 |
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
| import-refresh-wipes-bibs | KILLED | director.mjs: wix: a refresh keeps the bib number the team gave (Wix replaces whole rows) |
| res-role-check-removed | KILLED | security.mjs: S3 Results: view1 on all 12 methods [resOverview -> no_event (wanted not_all |
| res-director-only-removed | KILLED | security.mjs: S3 Results: lead1 on all 12 methods [resFormFields -> no_event (wanted direc |
| res-expiry-fails-open | KILLED | pentest-results.mjs: RA3 a session with a blank or damaged expiry (10 kinds) is refused by |
| res-void-deletes-the-result | KILLED | results.mjs: R9 voiding twice is refused   [wanted voided, got no_item] |
| res-void-without-reason | KILLED | results.mjs: R9 voiding needs a reason   [wanted reason_needed, got no error] |
| res-correction-forgets-old-values | KILLED | results-ui.mjs |
| res-correction-writer-from-call | KILLED | security.mjs: S5 a correction sent with "by: boss" and an old date in the call is written  |
| res-waves-overwrite-a-parallel-save | KILLED | pentest-results.mjs: RH2 two directors saving the waves from the same copy at the same mom |
| res-waves-stale-copy-accepted | KILLED | results.mjs: R3 a second person saving from an old copy is told to reload   [wanted change |
| res-assign-without-repeat-guard | KILLED | pentest-results.mjs: RF1 repeat keys that are too short, too long or hold spaces, "~", "/" |
| res-repeat-key-any-login | KILLED | pentest-results.mjs: RF3 the same key from another login gets nothing of mine and makes no |
| res-failed-request-keeps-its-key | KILLED | pentest-results.mjs: RF5 and the key is freed, so a retry is not blocked |
| res-unpaid-runner-placed | KILLED | results.mjs: R4 a runner who has not paid cannot be placed   [wanted not_paid, got no erro |
| res-wave-capacity-not-kept | KILLED | results.mjs: R4 a full wave refuses one more   [wanted wave_full, got no error] |
| res-last-seat-race-not-rechecked | KILLED | pentest-results.mjs: RH4 two runners placed by hand into the one free seat at the same mom |
| res-placing-again-moves-hand-placements | KILLED | unit-results.mjs: U8 with redo, the automatic placements are made again and the manual one |
| res-rank-setting-ignored | KILLED | unit-results.mjs: U6 a runner is ranked on the chip or gun time as chosen, else on the oth |
| res-equal-times-not-shared | KILLED | unit-results.mjs: U6 the same time shares a place and the next place is skipped (1, 2, 2,  |
| res-age-on-birthday-wrong | KILLED | unit-results.mjs: U3 age counts completed years: the day before the birthday is still the  |
| res-age-group-edge | KILLED | unit-results.mjs: U3 a runner is in the band their age falls in, boundaries included   [go |
| res-overall-winners-listed-twice | KILLED | unit-results.mjs: U7 a runner who took an overall place is not in the age-group list again |
| res-year-end-age-rule-ignored | KILLED | unit-results.mjs: U3 the age date is the race day or 31 December of the race year   [got [ |
| res-import-unknown-category | KILLED | pentest-results.mjs: RG1 a file full of markup, formulas, control characters and 400-lette |
| res-import-moves-runner-to-another-category | KILLED | pentest-results.mjs: RD2 a file that puts a registered 10 K runner in the 21 K is refused, |
| res-import-error-repeats-markup | KILLED | pentest-results.mjs: RG1 a file full of markup, formulas, control characters and 400-lette |
| res-setup-questions-carry-answers | KILLED | unit-results.mjs: U5 and nothing a runner answered is copied into that list (a question ma |
| res-collections-readable-by-visitors | KILLED | security.mjs: S7 Results makes its 3 collections on first use, each readable, changeable a |
| res-write-without-suppress-auth | KILLED | security.mjs: S8 every Results read and write of a locked collection passes suppressAuth ( |
| res-page-relay-list-open | KILLED | pentest-results.mjs: RI1 on the Results side of the relay, a method that is not one of the |
| res-awards-screen-no-escaping | KILLED | results-ui.mjs: U8 the name typed as an HTML picture is shown as text in the awards |
| res-print-unescaped | KILLED | results-ui.mjs: U9 the print-out is titled with the race, and markup in a name is escaped |
| res-csv-formulas-run | KILLED | results-ui.mjs: U9 a name that looks like a formula (= or @) is written with a leading quo |
| res-skip-tick-leaves-save-off | KILLED | results-ui.mjs: U6 ticking "skip lines with problems" turns it on |
| res-lead-offered-the-edit-buttons | KILLED | results-ui.mjs: U10 a lead sees all 15 results and has no Fix or Void |
| res-lead-offered-the-director-sections | KILLED | results-ui.mjs: U1 a lead gets three sections: Results, Awards, Start list   [got ["Result |
| res-import-retry-new-key | KILLED | results-ui.mjs: U6 three quick clicks sent one request, and it carried the same key as the |
| prn-role-check-removed | KILLED | pentest-print.mjs: PA6 made desk staff: the same token is refused at once   [wanted not_al |
| prn-director-only-removed | KILLED | pentest-print.mjs: PB1 lead1 on the 2 director-only methods (save a design, change the swi |
| prn-expiry-fails-open | KILLED | pentest-print.mjs: PA5 a session with a blank or damaged expiry (10 kinds) is refused [prn |
| prn-token-coerced-to-text | KILLED | pentest-print.mjs: PA1 19 altered, cut, doubled, guessed, borrowed (an athlete's) or oddly |
| prn-kind-any | KILLED | pentest-print.mjs: PD5 20 kinds that are not "bib" or "cert" (including "pub", the runner  |
| prn-save-writer-from-call | KILLED | pentest-print.mjs: PD2 the row is the one for this race and this kind, "by" is the person  |
| prn-template-not-cleaned | KILLED | pentest-print.mjs: PD1 a design with extra and borrowed fields is saved with only the know |
| prn-flags-not-cleaned | KILLED | pentest-print.mjs: PD7 switches sent with extra and borrowed fields keep only startList, r |
| prn-lead-can-change-switches | KILLED | pentest-print.mjs: PB1 lead1 on the 2 director-only methods (save a design, change the swi |
| prn-lead-can-save-designs | KILLED | pentest-print.mjs: PB1 lead1 on the 2 director-only methods (save a design, change the swi |
| prn-unpaid-runner-gets-a-bib | KILLED | pentest-print.mjs: PC3 a bib or a certificate of the other race, of a runner who did not f |
| prn-unfinished-runner-gets-a-certificate | KILLED | pentest-print.mjs: PC3 a bib or a certificate of the other race, of a runner who did not f |
| prn-printing-not-noted | KILLED | print.mjs: Q2 the overview holds no phone number, e-mail address or date of birth |
| prn-cursor-unchecked | KILLED | pentest-print.mjs: PE6 a cursor that is negative, fractional, text, NaN, infinite, huge, a |
| prn-category-unchecked | KILLED | pentest-print.mjs: PE7 a category the race does not have, or that is not text, is "bad_cat |
| prn-spares-cap-removed | KILLED | unit-print.mjs: P6 spare bibs: from 1, to not below from, at most 500, whole numbers   [go |
| prn-angle-bracket-not-escaped | KILLED | unit-print.mjs: P1 the five markup characters and the back-tick become entities; non-text  |
| prn-ampersand-not-escaped | KILLED | unit-print.mjs: P1 the five markup characters and the back-tick become entities; non-text  |
| prn-picture-any-host | KILLED | unit-print.mjs: P1 every other address (http, another host, a look-alike host, a user name |
| prn-picture-plain-http | KILLED | unit-print.mjs: P1 every other address (http, another host, a look-alike host, a user name |
| prn-colour-any-text | KILLED | unit-print.mjs: P1 a colour is #rrggbb and nothing else   [got ["#aabbcc","#aabbcc","#abc" |
| prn-long-picture-address-cut | KILLED | unit-print.mjs: P4 a picture address of more than 300 letters is refused, not cut short in |
| prn-placeholders-filled-twice | KILLED | unit-print.mjs: P2 a value that holds {b} is not filled again   [got "SECOND", wanted "{b} |
| prn-spare-numbers-duplicate-real-bibs | KILLED | unit-print.mjs: P6 spare bibs: numbers with no name, leaving out those a runner already ha |
| prn-certificates-without-results-allowed | KILLED | unit-print.mjs: P8 certificates cannot be shown unless results are shown   [got "", wanted |
| prn-damaged-switches-read-as-on | KILLED | pentest-print.mjs: PC1 a design and switches saved on race A are not on race B (it still h |
| prn-search-one-letter | KILLED | unit-print.mjs: P9 fewer than three letters is not a search   [got [false,4,true,true,fals |
| prn-search-no-cap | KILLED | unit-print.mjs: P9 at most ten runners are listed for a name, and the page is told there a |
| prn-unpaid-runner-listed-publicly | KILLED | unit-print.mjs: P9 the index holds each paid runner with a bib, and each result (a result  |
| prn-result-shown-with-switch-off | KILLED | unit-print.mjs: P9 with results off, no result and no certificate is told   [got ["Wave 1" |
| prn-start-shown-with-switch-off | KILLED | unit-print.mjs: P9 with the start list off, the start is not told   [got [{"wave":"Wave 1" |
| prn-certificate-offered-with-switch-off | KILLED | unit-print.mjs: P9 with results off, no result and no certificate is told   [got ["Wave 1" |
| run-hidden-race-shows | KILLED | pentest-print.mjs: PG4 20 kinds of race that is not showing (every switch off, deleted, no |
| run-certificate-without-switches | KILLED | pentest-print.mjs: PG7 start list only: the runner is found with a start and no result, an |
| run-question-length-unchecked | KILLED | pentest-print.mjs: PG3 a question that is not text, or is longer than 200 letters, is "bad |
| run-memory-never-expires | KILLED | print.mjs: Q2 the overview holds no phone number, e-mail address or date of birth |
| run-search-writes-a-note | KILLED | pentest-print.mjs: PG5b the first probes (102 questions and requests) wrote nothing at all |
| run-page-names-not-escaped | KILLED | runner-ui.mjs: V3 and shown exactly as typed, as text |
| run-certificate-frame-not-sandboxed | KILLED | runner-ui.mjs: V5 it is drawn in a frame that is allowed to do nothing |
| run-double-press-asks-twice | KILLED | runner-ui.mjs: V9 pressing "Find me" twice at once asks the server once   [got 2, wanted 1 |
| run-page-relay-list-open | KILLED | pagecode.mjs: Runner page code: "prnBibs" is refused, never run |
| prn-page-relay-list-open | KILLED | pagecode.mjs: Print branch: "login" is refused (only the six print methods go through) |
| prn-preview-frame-not-sandboxed | KILLED | print-ui.mjs: U2 the preview is in a frame that is allowed to do nothing (sandbox with no  |
| prn-lead-offered-the-design-editor | KILLED | print-ui.mjs: U1 a lead gets two sections, no "Runner page"   [got ["Bibs","Certificates", |
| prn-print-skips-the-save | KILLED | print-ui.mjs: U5 printing saves the design on screen first, then asks for the bibs   [got  |
| prn-who-heading-unescaped | KILLED | print-ui.mjs: U3 and when the card is drawn again from the preview that is still held, the |
| prn-collection-made-for-outsiders | KILLED | security.mjs: S7 not one visitor, fake login, athlete or staff login of the wrong kind (13 |
| prn-update-without-suppressauth | KILLED | security.mjs: S8 every Print read and write of a locked collection passes suppressAuth (th |
| run-backend-deletes-a-row | KILLED | security.mjs: S4 and looking at the public page writes nothing (1 writes) |
| cm-role-check-removed | KILLED | security.mjs: S3 Messages: view1 on all 12 methods [cmOverview -> no_event (wanted not_all |
| cm-director-only-removed | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmSaveSettings -> no_event (wanted dir |
| cm-expiry-fails-open | KILLED | pentest-comms.mjs: MA cmAudience: 28 kinds of wrong or damaged login are all refused as "n |
| cm-token-coerced-to-text | KILLED | pentest-comms.mjs: MA cmAudience: 28 kinds of wrong or damaged login are all refused as "n |
| cm-lead-can-send | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmSend -> no_event (wanted director_on |
| cm-lead-can-save-templates | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmSaveTemplate -> no_event (wanted dir |
| cm-lead-can-export | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmExport -> no_event (wanted director_ |
| cm-lead-can-open-links | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmLinks -> no_event (wanted director_o |
| cm-lead-can-prepare | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmPrepare -> no_event (wanted director |
| cm-lead-can-send-test-email | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmTest -> no_event (wanted director_on |
| cm-lead-can-mark | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmMark -> no_event (wanted director_on |
| cm-lead-can-change-settings | KILLED | security.mjs: S3 Messages: lead1 on all 12 methods [cmSaveSettings -> no_event (wanted dir |
| cm-collection-made-for-outsiders | KILLED | security.mjs: S7 not one visitor, fake login, athlete or staff login of the wrong kind (13 |
| cm-update-without-suppressauth | KILLED | security.mjs: S8 every Messages read and write of its locked collection passes suppressAut |
| cm-backend-deletes-a-row | KILLED | security.mjs: S8 nothing in Messages removes a row: a template is archived, a batch is a n |
| cm-log-row-holds-text | KILLED | security.mjs: S8 the log row of a person (written in the two places that send or mark) and |
| cm-writer-taken-from-call | KILLED | security.mjs: S5 a template saved with "by: boss" and an old date in the call is written,  |
| cm-address-in-the-export-note | KILLED | security.mjs: S6 the Results change notes hold no phone number, e-mail address or date of  |
| cm-test-address-kept-in-the-log | KILLED | security.mjs: S6 the Messages change notes and everything kept in its collection (template |
| cm-send-claim-not-unique | KILLED | comms.mjs: K8 a log row is the batch, the person's id, the template, the state and who pre |
| cm-send-deadline-ignored | KILLED | comms.mjs: K8 a call that runs out of time stops starting new people (10 of 10 sent) and s |
| cm-send-never-stops-on-failures | KILLED | comms.mjs: K8 when nothing is accepted the call stops after the first few (10 failed of 10 |
| cm-unsubscribed-still-counted-as-sent | KILLED | comms.mjs: K8 ten people go out in one call: nine e-mails sent, one left out because that  |
| cm-send-whatsapp-batch-allowed | KILLED | comms.mjs: K8 a WhatsApp batch cannot be sent as e-mail   [wanted wrong_channel, got no er |
| cm-links-for-email-batch-allowed | KILLED | comms.mjs: K11 an e-mail batch has no links   [wanted wrong_channel, got no error] |
| cm-marks-for-email-batch-allowed | KILLED | comms.mjs: K11 an e-mail batch cannot be marked   [wanted wrong_channel, got no error] |
| cm-send-without-wix-email-set-up | KILLED | comms.mjs: K8 with no Wix e-mail named a send is refused   [wanted no_email_id, got no err |
| cm-prepare-key-clash-allowed | KILLED | comms.mjs: K7 the same key with another template is refused   [wanted key_in_use, got no e |
| cm-prepare-empty-audience-allowed | KILLED | comms.mjs: K7 a wrong request is refused (empty_audience): {"aud":{"who":"runners","pay":" |
| cm-prepare-no-size-limit | KILLED | comms.mjs: K10 a batch of more than 5000 is refused   [wanted too_many, got no error] |
| cm-prepare-archived-template-allowed | KILLED | comms.mjs: K7 an archived template cannot be sent   [wanted template_archived, got no erro |
| cm-prepare-wrong-kind-of-template-allowed | KILLED | comms.mjs: K7 a wrong request is refused (template_mismatch): {"tplId":"volunteer"}   [wan |
| cm-prepare-without-race-link | KILLED | comms.mjs: K7 a template that uses the race link cannot be sent while the race has no link |
| cm-batch-of-another-race | KILLED | comms.mjs: K14 a batch row that names another race is refused   [wanted no_batch, got no e |
| cm-registrations-of-another-race | KILLED | comms.mjs: K14 a person of another race in a stored list is skipped: nothing is sent to th |
| cm-volunteers-of-another-race | KILLED | comms.mjs: K14 a volunteer of another race in a stored list has no name and no link   [got |
| cm-mark-person-outside-the-batch | KILLED | comms.mjs: K11 a person who is not in the batch cannot be marked   [wanted not_in_batch, g |
| cm-mark-any-status | KILLED | pentest-comms.mjs: ME and the values that were accepted were legal ones, for fields that t |
| cm-mark-list-unchecked | KILLED | pentest-comms.mjs: ME and the values that were accepted were legal ones, for fields that t |
| cm-test-email-limit-loosened | KILLED | comms.mjs: K13 the sixth test within an hour is refused   [wanted too_many_tests, got no e |
| cm-test-email-refused-tries-count | KILLED | pentest-comms.mjs: MH with five old tests and six refused ones in the books, a new test go |
| cm-contact-name-starts-a-formula | KILLED | comms.mjs: K8 a contact is never given a name that starts like a formula |
| cm-export-not-noted | KILLED | security.mjs: S6 control: the Messages changes made above (settings, a template, batches p |
| cm-whatsapp-links-not-noted | KILLED | security.mjs: S6 control: the Messages changes made above (settings, a template, batches p |
| cm-sending-not-noted | KILLED | security.mjs: S6 control: the Messages changes made above (settings, a template, batches p |
| cm-batch-not-noted | KILLED | security.mjs: S5 a batch prepared with "by: boss" and an old date in the call is written,  |
| cm-angle-brackets-kept-in-names | KILLED | unit-comms.mjs: M1 a line: line breaks and control characters become spaces, no angle brac |
| cm-angle-brackets-kept-in-messages | KILLED | unit-comms.mjs: M1 a body: lines kept, runs of blank lines and spaces cut, no angle bracke |
| cm-csv-formulas-run | KILLED | unit-comms.mjs: M12 a cell that would start a formula (= + - @, even after spaces, a tab o |
| cm-csv-cells-unquoted | KILLED | unit-comms.mjs: M12 a cell that would start a formula (= + - @, even after spaces, a tab o |
| cm-csv-quote-not-doubled | KILLED | unit-comms.mjs: M12 every cell is quoted, a quote is doubled, line breaks become spaces, n |
| cm-email-address-unchecked | KILLED | unit-comms.mjs: M2 a list of addresses, a name with the address, a quote, a bracket, a spa |
| cm-link-plain-http | KILLED | unit-comms.mjs: M4 another scheme, a user name, a space, a quote, a bracket, a line break, |
| cm-whatsapp-link-any-number | KILLED | unit-comms.mjs: M3 only digits make a chat address: a plus, a space, a letter, too short,  |
| cm-whatsapp-number-no-length-check | KILLED | unit-comms.mjs: M3 a number that cannot be a mobile one (a landline, too short, too long,  |
| cm-unknown-placeholder-allowed | KILLED | unit-comms.mjs: M7 a placeholder that the kind does not have is refused (a typo would go t |
| cm-audience-unknown-choices-allowed | KILLED | unit-comms.mjs: M10 an audience that is not an object, has a key or a choice it does not k |
| cm-unpaid-runners-by-default | KILLED | unit-comms.mjs: M10 runners: paid ones, whatever else, unless the audience says more   [go |
| cm-already-sent-filter-off | KILLED | unit-comms.mjs: M10 "not yet sent" leaves out those who have had the template; the list of |
| cm-failure-reason-keeps-address | KILLED | unit-comms.mjs: M11 a reason for the log has no address, long number, quote or tag in it,  |
| cm-ui-chat-link-unchecked | KILLED | comms-ui.mjs: U13 four links that are not WhatsApp links are not made into links   [got 25 |
| cm-ui-names-unescaped | KILLED | comms-ui.mjs: U20 the first screen, with markup in every name, label, subject and message  |
| cm-ui-lead-offered-sending | KILLED | comms-ui.mjs: U1 a lead gets three sections, no "Settings"   [got ["Send","History","Templ |
| cm-ui-sending-goes-on-after-race-switch | KILLED | comms-ui.mjs: U10 changing the race while on another tab stops the sending too: at most th |
| cm-ui-double-press-prepares-twice | KILLED | comms-ui.mjs: U9 and pressing it anyway asks the server for nothing   [got 6, wanted 5] |
| cm-page-relay-list-open | KILLED | pagecode.mjs: Messages branch: "login" is refused (only the twelve Messages methods go thr |

## How to run

```
sh tests/all.sh                  every suite once, writes this report
python3 tests/report.py --only security
python3 tests/mutants.py        mutation spot-checks
```
