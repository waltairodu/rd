# Race Director for Wix: Phase 1

Command centre, volunteers (public sign-up, approval, shifts, check-in and hours), race-day run of show and incident log, pacers (pace plan and roster) and a safety checklist. It runs inside your Wix site, next to the Expo desk, and uses the same logins.

## What people see

| Who | Where | What they do |
| --- | --- | --- |
| Public | `/volunteer?ev=RACE_ID` | Pick shifts, give name and mobile, agree to the volunteer terms, get a six-letter code. Can check their status later with code plus mobile. |
| Director (role `admin` or `director`) | `/director` | Everything: races, shifts, approvals, race day, pacers, safety, deletes. |
| Lead (role `lead`) | `/director` | Volunteers, race day, pacers, safety. No creating races, no deleting. |
| Viewer (role `viewer`) | `/director` | Look only. For sponsors and partners. |

There is **one login for everything**, made on the **Team** screen (they are rows of the CMS collection ExpoStaff behind it; nobody edits those by hand). A login with role `desk` works only on the Expo desk and lands there after logging in. Passwords are stored hashed; a new login gets a generated PIN (desk) or password (others), shown once.

## Files

| File | Where it goes |
| --- | --- |
| `racedir.web.js` | Code panel, Backend, a web module named `racedir.web.js` |
| `rd-auth.js` | Code panel, Backend, a plain file named `rd-auth.js` (not .web.js). Passwords, PINs and roles; all three backends import it |
| `rd-approvals.js` | Code panel, Backend, a plain file named `rd-approvals.js` (not .web.js). Approvals library and letter writer; `racedir.web.js` imports it |
| `ai-core.js` | Code panel, Backend, a plain file named `ai-core.js`; `racedir.web.js` imports it |
| `director-embed.html` | HTML embed on the **Director** page, element ID `dirFrame` |
| `director-page-code.js` | That page's code panel |
| `volunteer-embed.html` | HTML embed on the **Volunteer** page, element ID `volFrame` |
| `volunteer-page-code.js` | That page's code panel |

`exposoft.web.js` (the Expo desk's server side) is also needed in the Backend: the page sends the desk's calls to it. See docs/SETUP.md for the whole pack.

## Setup (about 20 minutes)

1. Velo is already on if the Expo desk works.
2. **Backend.** Add `racedir.web.js` and paste the file. **Change `SETUP_KEY` near the top to a secret of your own before saving.**
3. **Director page.** New page named Director, permissions **Anyone**. Add an HTML embed (code mode), paste `director-embed.html`, set its ID to `dirFrame`, full width and about 100vh tall. Paste `director-page-code.js` into the page code.
4. **Volunteer page.** New page named Volunteer (URL `/volunteer`), permissions **Anyone**. Embed ID `volFrame`, paste `volunteer-embed.html`, paste `volunteer-page-code.js`. This page needs the Wix `wix-location` import that the page code already has.
5. **Publish.** It works on the published site only.
6. Open `/director`. Under **First-time setup (owner only)** enter the setup key and, only if you have no logins yet, a new admin name and password. It creates the Director collections (locked to Admin). It never changes existing logins.
7. Log in, open **Setup**, create the race. Fill **Expo race ID** with the Import collection of that race (for example `Import910`) so the Overview shows live check-in, bib and T-shirt counts from the Expo desk.
8. Open **Volunteers**, add shifts, then copy the sign-up link. If your volunteer page is not at `https://www.vtra.run/volunteer`, edit the address in the box once; it is remembered in that browser.
9. Add everyone's login on the **Team** screen (Add a login). Nothing is typed into the CMS.

## Race-day use

- **Volunteers tab:** approve people, assign shifts, and on the day type a volunteer's code and press **Check in** (and **Check out** when they leave). Hours are worked out. WhatsApp links open a prepared message.
- **Race day tab:** tick the run of show as it happens; log incidents (type, seriousness, place) and close each with how it was resolved. High-priority open incidents show on the Overview.
- **Pacers tab:** change the groups and finish times, add pacers, record trial, briefing and kit. The table shows pace per km and checkpoints.
- **Safety tab:** tick the checklist; it records who and when.

## Rules the server enforces (not just the screen)

- Shifts have a hard limit. If two people take the last spot together, exactly one gets it.
- A volunteer is registered once per mobile number per race. Phone numbers are checked as Indian mobiles.
- Only approved volunteers can check in; a check-in cannot be repeated; people already checked in cannot be declined or removed.
- Two shifts that overlap in time cannot be given to one person.
- Leads and viewers cannot delete or create races; viewers cannot change anything.
- The public page can only call four methods (race list, shift list, sign-up, status check). It gets no names or phone numbers.
- A hidden field catches simple bots, and sign-ups are limited per hour per race.

## Known limits (Phase 1)

- No WhatsApp or SMS sending yet; the Volunteers tab gives a WhatsApp link per person to send by hand.
- Check-in is by typed code. Camera QR scanning comes later because it needs camera permission inside the Wix frame, which has to be tested on the live site.
- Not yet run on a live Wix site. It is tested against a simulator of Wix (see below). Rehearse on the published site before race day.
- Phone numbers are stored as plain text in locked collections. Check data-protection obligations before keeping them long term.

## Tests

From the repository root: `sh tests/all.sh`. It runs every suite once and writes `docs/TESTING.md`: unit, penetration, integration, security and regression results by kind, plus the mutation spot-checks (`python3 tests/mutants.py`). Cases include two people taking the last spot, two desks handing over the same bib, a lead trying to delete, a viewer trying to change something, a stolen or forged token, 60 password guesses sent at the same instant, a volunteer name containing HTML, and a race moved to a new date.

Some suites build dates from today (a race 30, 60 or 90 days away). `sh tests/days.sh` (about four minutes) runs them again on the three days when such a race falls on 1 January, which once made a privacy check mistake a race date for a date of birth. Run it before a release.

## Qualification checks (new)
- Tab **Qualification**. The director sets rules per category in one text box, one line each:
  `110 K | Marathon under 6 hrs, or any 50 km+ | 42.195@6:00; 50@`
  A runner qualifies if they meet any one way (distance, time, or both).
- Runs on the registrations imported from Wix Events (see below), so rules can be cleared long before bibs exist. Category names are matched loosely ("25 K - Debut Trail" matches a rule called "25 K").
- Lead or director records what the runner claims (race, distance, time, proof link). The screen gives a first opinion: Meets, Below, or No claim. Then a person approves, rejects or (director only) waives, each with a reason when it is not a clean pass. A new claim resets an earlier decision.
- The Overview lists how many runners are not yet cleared.
- Not yet: runners submitting their own proof on a public page. For now the team records it.

## Registrations from Wix Events (new)
- Tab **Registrations**. Director: Load my Wix events, pick the race's event, Link. Then Import / refresh (safe to repeat; one row per ticket; cancelled orders are skipped, payment-pending ones are flagged).
- The category is the **ticket name** (10 K, 25 K, ...). Name, email and phone come from the ticket holder.
- T-shirt size, bib name and phone often have field names chosen by whoever built the checkout form. Press **Form fields**, pick which field is which, Save, then Import again.
- Shows counts per ticket, who has no size, and (when the race is linked to its Expo race) who is registered but not yet in the findmybib/Expo list, matched by phone or email. CSV download.
- Needs the Wix Events app on the site. Never run on a live site yet: the first Import is the real test. Send me any error text.

## Expo desk inside RaceOS (the BIB & Expo tab)
The /rd page holds the Expo desk behind the same login. There is no separate Expo page or login.
- Paste **`rd-embed.html`** (not `director-embed.html`) into the /rd page: it is the RaceOS page with the Expo desk built in. Use **`director-page-code.js`**, which needs the `racedir.web.js`, `exposoft.web.js` and `training.web.js` backend modules.
- **Directors** see the **BIB & Expo** tab. The desk signs in by itself with the same login (a director still picks a desk).
- **Desk logins** (made on the Team screen, locked to a desk and a race) type their login at /rd and land on their desk; they never see RaceOS. Leads, viewers and coaches get no desk (`not_allowed`).
- Desk rules (locked T-shirt size, role per desk, selfie, one login per desk, one winner when two desks hand over the same item) are enforced in `exposoft.web.js`.
- Logging out of /rd ends the session everywhere. The desk frame never holds a login token: the page adds it, and only that frame can ask it to call the backend.
- `director-embed.html` is the source. After changing it or `wix/expo/exposoft-embed.html`, run `python3 tools/build_rd.py` to rebuild `rd-embed.html` (the tests and `tools/make_pack.py` do this too).

## Team: logins and roles
**Team** (Admin group, directors only). One row per login with role, desk(s), race, whether someone is at a desk now, and whether it is locked.
- **Add a login**: name, username (3 to 30 letters, digits, dots, dashes), role, and for desk staff the desk(s) and race. A PIN (6 digits, desk) or password (10 characters, others) is generated and shown once. A password you type yourself must be 6 to 72 characters and not a common one.
- **New PIN / New password**, **Sign out**, **Remove**, and change a login's role, desk or race. Any change to role, desk, race or password ends that person's other sessions at once. You cannot remove or demote yourself.
- Five wrong tries lock a login for ten minutes, at RaceOS and at the coach login together; even a burst of guesses sent at the same moment gets only five looks. A new password or PIN clears the lock.
- A short log of who changed what is shown at the bottom (never a password).
- Methods: `listTeam`, `saveTeam`, `resetTeamSecret`, `signOutTeam`, `removeTeam` (all director only).

## Planning: tasks, money, approvals, ceremonies, logistics (new)
Five tabs hold everything a race director tracks, all in one collection, **RDPlan** (created automatically at the first login after you publish; if you prefer to make it by hand, give it these text columns: event, kind, title, cat, phase, status, owner, party, contact, due, time, amount, amount2, ref, link, notes, order, by, at, tpl, lead, offset, docsDone, and make it Admin-only; the last four are optional hidden columns used by the approvals template).

| Tab | What it holds |
|---|---|
| Plan | Tasks from 90 days out to the debrief; lessons (what worked, what to fix, ideas) |
| Money | Budget (costs and income, planned and actual, by category) and sponsors (lead to received, what you owe them) |
| Approvals | Permits (police, municipal, forest, fire, insurance...) and race-day sign-offs, with who signed and when |
| Ceremonies | Programme before, during and after the race |
| Logistics | Supplies (needed and have, short quantities), contacts and vendors, document links |

A new race starts with a starter list for tasks, budget, supplies, approvals, ceremonies and contacts. On older races, press **Load the starter list** in an empty section.
Who can do what: directors read and write everything and delete; leads read money and write everything except money; viewers read everything except money and contacts (phone numbers). Overview shows overdue items, permits not approved, race-day sign-offs due, short supplies and overspend. Each list downloads as CSV.


## Finance (new)
Tab **Finance** (directors; a lead sees only Claims). Backend `finance.web.js` (23 methods) with `rd-finance.js` (money arithmetic and rules, no Wix imports) and five locked collections made on first use: RDInvoices, RDOrders, RDClaims, RDLedger, RDFinSet. What each tab does and the limits are in docs/SETUP.md.
- Money is held in whole paise inside; the methods take and return rupees. The ledger is append-only: a mistake is voided with a reason, never edited. Numbers (`INV/2026-27/0001`) come from rows whose `_id` carries the number, so two people cannot get the same one.
- Director only: `finOverview`, `finSettings`, `finSaveSettings`, `finListInvoices`, `finRaiseInvoice`, `finCancelInvoice`, `finPayInvoice`, `finListOrders`, `finSaveOrder`, `finAddBill`, `finPayOrder`, `finRefundOrder`, `finCancelOrder`, `finDecideClaim`, `finPayClaim`, `finCash`, `finAddCash`, `finLedger`, `finAddEntry`, `finVoid`. Director or a lead's own: `finListClaims`, `finSaveClaim`, `finCancelClaim`.
- Every create takes a one-time `key`: the same key from the same login answers `{again:true}`; from another login `busy_try_again`.
- The page code relays only these 23 (`FIN_ALLOWED`, `mod:'fin'`). Anything else is refused; `page_code_old` when the page code is older than the embed, `backend_old` when the backend is older.
- Tests: `unit-finance.mjs`, `finance.mjs`, `finance-ui.mjs`, `pentest-finance.mjs`, `pentest-finance-ui.mjs`, the Finance part of `security.mjs`, and 29 break-it checks in `mutants.py`.

## Waves and results (new)
Tab **Waves & results** under Race day (directors change, a lead looks). Backend `results.web.js` (12 methods) with `rd-results.js` (times, ranking, age groups, awards, waves and the results-file reader; no Wix imports) and three locked collections made on first use: RDResults, RDWaveAssign, RDResSet. What each tab does, the file format and the limits are in docs/SETUP.md.
- Look (director or lead): `resOverview`, `resStartList`, `resBoard`, `resAwards`. Director only: `resFormFields`, `resSaveSettings`, `resSaveWaves`, `resAssign`, `resPlace`, `resImport` (the dry run too), `resSaveRow`, `resVoid`. Every method starts with `rauth(arg, need)`: a session token of at least 20 characters, a live session (expiry that cannot be read means refused), a staff row, and a role of director or lead (`director_only` for a lead on a change).
- The page code relays only these 12 (`RES_ALLOWED`, `mod:'res'`). Anything else is refused; `page_code_old` when the page code is older than the embed, `backend_old` when the backend is older.
- Times are whole centiseconds, cut to hundredths and never rounded; places share on a tie (1, 2, 2, 4). A date of birth is used only to work out an age: no answer, CSV or print-out carries it, and `resFormFields` returns question names and counts only. Phone numbers and e-mail addresses never come through here.
- Ids: results `rs~<EV>~<bib>`, placements `wa~<registration id>`, waves `waves~<EV>~<rev>`, settings `set~<EV>`, repeat keys `k~<kind>~<key>`. Waves are saved with compare-and-swap (each save inserts the next revision, a stale revision answers `changed_reload`); a manual placement never moves on "Place again"; `resPlace` re-checks the capacity after it writes, so the last seat never goes to two runners.
- Create actions (`resAssign`, `resImport`) take a one-time `key`: the same key from the same login answers `{again:true}`; from another login `busy_try_again`; a failed attempt frees its key.
- A result is corrected (`resSaveRow`) or voided (`resVoid`) with a reason; the earlier values are kept in `prev`, the void is a mark and the row stays, and each change is written to the audit log. Nothing is deleted.
- Tests: `unit-results.mjs` (119), `results.mjs` (173), `results-ui.mjs` (169), `pentest-results.mjs` (105), the Results part of `security.mjs`, and 37 break-it checks in `mutants.py` (36 on Results, 1 on the Import / refresh bib fix).

## Bibs, certificates and the runner page (new)
Tab **Bibs & certificates** (directors change a design and the public page, a lead previews and prints) and the public page **/runner**. Backends `print.web.js` (6 methods, staff) and `runner.web.js` (3 methods, public, read-only), with `rd-print.js` (cleaning a design, filling the papers, spare bibs, the public index; no Wix imports) and `rd-data.js` (the readers they share; reads only). One locked collection, RDPrint, made on first use by a signed-in director or lead. What each section does, the placeholders and the limits are in docs/SETUP.md.
- Staff: `prnOverview`, `prnPreview`, `prnBibs`, `prnCerts` (director or lead); `prnSaveTemplate`, `prnSavePublish` (director only). Every method starts with `pauth(arg, need)`: a session token that is text of at least 20 characters, a live session (an expiry that cannot be read means refused), a staff row and a role of director or lead (`director_only` for a lead on a change). The collection is made only after that check, so a stranger cannot cause it.
- Public: `pubRaces`, `pubFind`, `pubCert`. No login and nothing is written. A race shows only after a director switches the start list or the results on; otherwise every call answers `not_published`, the same whether the race is hidden, deleted or never existed. A runner is found by bib (zeros forgiven) or by at least three letters of the name (ten at most). An answer holds bib, name, category, start, result and whether a certificate exists, never an age, date of birth, phone number, e-mail address, T-shirt size, payment status or note. The list of runners is kept for 30 seconds; the switches are read on every call, so switching off is immediate.
- The page code relays only the six Print methods from /rd (`PRN_ALLOWED`, `mod:'prn'`); the page code of /runner relays only the three public ones (`ALLOWED`). Anything else is refused; `page_code_old` when the page code is older than the embed, `backend_old` when the backend is older.
- Designs are saved per race: `tpl~<EV>~bib`, `tpl~<EV>~cert`, and the public page's switches `pub~<EV>`. A bib has size, paper (A4/A3), direction, colours (one per category if wanted), title, name shown, sponsors, tear-off strip, holes and footer; a certificate has direction, border, colours, logo, title, text with placeholders, a stats line, two signatures, sponsors and footer. A design is cleaned again every time it is used: text is escaped, a picture must be an https address on static.wixstatic.com, vtra.run or www.vtra.run (300 characters at most; a longer one is refused, never cut), a colour is `#rrggbb`, and a placeholder is filled once (a value that holds `{name}` is not filled again).
- A bib is printed only for a paid runner who has a bib; a certificate only for a finisher with a place, and only when results are shown. Spare bibs (500 at most) skip numbers a runner already has. Printing goes by pages (60 bibs or 25 certificates at a time), is written to the audit log when it starts, and the screen saves a changed design before printing it. Nothing is deleted: a design is replaced by the next one.
- Tests: `unit-print.mjs` (120), `print.mjs` (219), `print-ui.mjs` (178), `runner-ui.mjs` (99), `pentest-print.mjs` (135), the print and runner parts of `pagecode.mjs` (146 in all) and `security.mjs` (338 in all), and 49 break-it checks in `mutants.py`.

## Messages: templates, audiences and e-mails (new)
Tab **Messages** in the **People** group (directors write and send, a lead looks). Backend `comms.web.js` (12 methods, staff only) with `rd-comms.js` (cleaning text, filling templates, audiences, chat links, CSV safety; no Wix imports besides the shared libraries). One locked collection, RDComms, made on first use by a signed-in director or lead. What each screen does, how to make the Wix e-mail, the placeholders and the limits are in docs/SETUP.md under "Messages".
- Methods: `cmOverview`, `cmPreview`, `cmAudience`, `cmBatch` (director or lead); `cmSaveSettings`, `cmSaveTemplate`, `cmPrepare`, `cmSend`, `cmLinks`, `cmMark`, `cmExport`, `cmTest` (director only, `director_only` for a lead). Every method starts with `cauth(arg, need)`: a session token that is text of at least 20 characters, a live session (an expiry that cannot be read means refused), a staff row and a role of director or lead. The collection is made only after that check, so a stranger cannot cause it. The page code relays exactly these twelve (`COMMS_ALLOWED`, `mod:'comms'`); anything else is refused, `page_code_old` when the page code is older than the embed, `backend_old` when the backend is older.
- E-mail goes through ONE Wix triggered e-mail (`triggeredEmails.emailContact`) whose variables are `subject` and `p1` ... `pN` (1 to 12 places, 6 by default); a paragraph a message does not use is sent as a non-breaking space. The contact is found by address (`queryContacts`) or created with the name and address only; a contact who unsubscribed is skipped and counted, never sent to.
- **At most once.** `cmPrepare` freezes a batch (the ids of the people, the template's words, the audience; up to 5,000 people). `cmSend` handles up to 25 people per call, five at a time, within nine seconds, and starts each person by inserting that person's log row `rcp~<batch>~<person>`: a row id can be made once, so a second screen, a repeated call or a double press can never send a second e-mail (it answers `busy`). A crash between the row and the e-mail leaves the row 'sending': the report shows it as unsure and nothing sends it again by itself. After three failures with no success it stops. A retry is a new batch for the same audience with "leave out people who already got this message" (and, if the director ticks it, the unsure ones).
- **What is kept.** The log (`bat~`, `mem~`, `rcp~`, `tpl~`, `cfg`, `rc~`, `tst` rows) holds ids, states, template text and settings: never an e-mail address, a phone number, a person's name or a message made for one person. A failure reason is cut to 80 characters with addresses and long numbers removed. Only `cmLinks` (WhatsApp links with a number) and `cmExport` (a CSV) answer with contact details; both are director-only, and the audit trail records them (who, how many) without the details. A test e-mail (`cmTest`) uses made-up details, is limited to 5 an hour for a race, and its address is not kept.
- **Text.** Angle brackets, control and direction characters are removed from every template and name; an unknown `{placeholder}` is refused when a template is saved; links must be `https`; a chat link must match `https://wa.me/<digits>?text=<escaped>` (checked again in the screen); a CSV cell is always quoted and one that starts `= + - @` gets a `'` in front. Nothing is deleted: a template is archived.
- Tests: `unit-comms.mjs` (120), `comms.mjs` (477), `comms-ui.mjs` (245), `pentest-comms.mjs` (203), the Messages parts of `pagecode.mjs` (171 in all) and `security.mjs` (418 in all), and 66 break-it checks in `mutants.py`.

## Approvals template (new)
Approvals tab > **Approvals template** (directors). One screen sets the race details (edition, name, date, venue, organiser, signatory, times, route, expo date), asks eleven yes/no questions about what the race involves, and lists the approvals that follow, each with its authority, days before the race and due date, all editable. **Add selected approvals** writes them to the list.
- **Library** (`rd-approvals.js`, no Wix imports): 16 permits (police, municipal, venue, fire, medical, insurance, sound, music licences, drone, food safety, power, banners, forest, village consent, highway or defence land, AIMS certificate) and 9 race-day sign-offs. Ten permits and eight sign-offs are on by default. Each permit has its authority, lead time in days, documents to attach, tips, and a letter.
- **Dates follow the race.** A line keeps its lead (days) or offset (minutes before the flag-off). Changing the race date or start time moves every line whose date was never typed by hand (`follow`). Saving the race from Setup does the same.
- **Letters.** `renderLetter` is a pure function: tokens such as `{event}`, `{when}`, `{venue}`, `{distances}`, `{participants}`, `{start}`, `{end}`, `{route}`, `{expoDate}`, `{organiser}`; a required token with no value becomes a `[bracketed blank]` and is listed in `missing`; paragraphs can depend on the answers (roads, early start before 06:00). Dates read "7 February 2027", times are 12-hour, numbers use Indian grouping, and the edition reads "6th".
- **Organiser details** (place, local body, organiser, registration number, signatory, role, phone, e-mail, address) are stored once per race inside the event's `json` column and copied from the most recently updated race that has any. Contact details are returned only to write roles.
- **Older races.** Starter lines made by earlier versions are replaced when nobody edited them, linked to the template when they were edited, and removed when untouched and not wanted. Nothing the team wrote is overwritten.
- **Methods:** `eventInfo` (write), `saveEventInfo` (manage), `approvalTemplate` (write), `applyApprovalTemplate` (manage), `approvalLetter` (write, permits only), `setApprovalDoc` (write). Viewers get `read_only`; leads get `director_only` on manage methods.
- **Tests:** `approvals.mjs` (228 checks: library, letters for all 16 permits, seeding, validation, permissions, date following, legacy conversion) and `approvals-ui.mjs` (60 checks: the screen, letters, documents, copy, Word file, print, old backend).


## AI and Expo integration (new)
- `ai-core.js` talks to the Anthropic API; the key lives in Wix Secrets Manager as `ANTHROPIC_API_KEY`. Everything has a rule-based fallback.
- Director methods: `aiStatus`, `aiBriefing` (rule-based, or `write:true` for AI), `aiForecastNow`, `aiAsk`, `aiDraftKinds`, `aiDraft`. Training methods: `coachInsight`, `myInsight`.
- Expo methods: `expoRaces`, `saveBibPlan`, `assignBibs`, `setBib`, `sendToExpo`, `expoSummary`. Rules are described in docs/SETUP.md.
- Tests: `ai.mjs`, `expo-int.mjs`, `bibs-ai-ui.mjs`, `training-ai.mjs`.
