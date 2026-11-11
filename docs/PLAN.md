# Decisions and build order

## Decided

1. Wix first. The Director runs entirely on Wix in Phase 1; a separate director app comes in Phase 2 if Wix limits get in the way.
2. Keep today's registration and import runners; own payments wait until Phase 3.
3. Many races from day one (VHM, Ultribe, Time Trials).
4. Four roles: director, lead, desk/station volunteer, read-only viewer.
5. Email plus WhatsApp for messages, via a business provider (approval takes days, start early).
6. Keep the door open for other organisers: separate data per organiser, branding later.
7. Four zones: Race, Community, Coach, More features.
8. Training: free plan for X weeks, one way; coached plan two way with tracking and feedback.
9. Pacers in Community, volunteers in Race.
10. Coach platform is a separate product with its own login and pricing.

## Build order

- **Phase 1, web, 15 days:** Expo desk (built), volunteers, command centre, race-day control, pacers, safety checklist. QR check-in moves to Phase 1b (camera permission inside the Wix frame needs live testing).
- **Phase 1b, weeks 3 to 8:** race-day academy, smart coupons and ambassador codes, email and WhatsApp reminders, registration admin and findmybib sync, clubs, free starter plans.
- **Phase 2, Android:** installable web app first, then a store app; budget and sponsors; ambassadors; coach console.
- **Phase 3:** own registration portal and payments, live tracking, fundraising and merchandise, photos and certificates, marketing funnel, multi-organiser support.

## Inputs needed from the Race Director

Race date; the VHM bib and size column names from findmybib; the registration tool in use today; WhatsApp provider; free-plan length, coached-plan price, coach count; volunteer role names; own setup key.

## Decisions (20 Oct 2026)
- Setup key: set by the account owner in racedir.web.js; the code refuses to run with the default key.
- Race date and all event details: entered by whoever creates the race in the Director Setup tab.
- Coached plan: free for now; price to be an input the race director can set (Training module, not built yet).
- Volunteer roles: Role field suggests common roles from well-run races (aid station, marshal, start/finish, packet pickup, medal, medical, sweeper, parking, etc.); any role can still be typed.
- Still open: findmybib bib/size column names, registration tool, WhatsApp provider, free plan length X.
- Qualification checks: yes. Built as the Qualification tab (director sets rules, team records claims, person decides). Runner self-submission page is next.

- Training: free plan runs 8 weeks (decided 20 Oct). Registration confirmed as Wix Events. findmybib export columns per Yogi: name, bib name, email id, phone number, Tshirt size (no category or separate bib-number column named; 'bib name' still unclear).
- findmybib: Bib Number and Bib Name are two columns; bib name is kept as 'bibName' and shown on the bib card at the Bib desk. Runners collection needs a new text column bibName.
- Wix Events import built (Registrations tab). Qualification now runs on registrations instead of the Expo runner list.
- Navigation: / (home), /rd (login, then Director; Setup tab = races setup), /volunteer, /train, /coach. Free plan 8 weeks, coached free for now with director-set price text.
- Training module built (athlete page, coach desk, backend, 165 tests).
- Expo desk incorporated into /rd (Expo desk tab for director/admin, desk logins routed straight to it, one page and one login). Built by tools/build_rd.py into rd-embed.html.
- Finance built (Package 2): invoices to sponsors and partners, reimbursement claims for core staff, cash withdrawals held by a named person, orders with estimate, advance and actual, and the race's income and expenses (Finance tab). Directors do everything; a lead can raise and see only their own claims. Nothing is edited or deleted: a mistake is voided. Not a GST tax invoice yet (no tax split, HSN/SAC).
- Standing rule (26 Oct): every change is tested five ways and reported by kind: unit, penetration, integration, security, regression (tests/report.py writes docs/TESTING.md).
- Out of scope for now: Strava, Polar and Garmin syncing, new AI features, BIB scanning on phones, QR check-in, direct WhatsApp or SMS sending, payments, PIN reset by email, an online store link.
- Waves & results built (Package 3, 31 Oct): waves and corrals per category, runners placed in them (fastest expected time first, or bib order; a hand placement never moves), a start list, results imported from the timing file (pasted or typed in the box), corrected or voided with a reason, the board with overall, gender and age-group places, and age-group awards. Directors change, a lead looks. A date of birth is only used to work out an age and is never shown. No live timing link: results come by file or by hand. The Registrations Import / refresh no longer wipes the bib numbers.
- Bibs, certificates and the public runner page built (Package 4, 2 Nov): a Bibs & certificates tab where a director designs the bib (size, paper, colours per category, sponsors, tear-off) and the certificate (text with placeholders, logo, two signatures), previews them, and prints one, a category or all (a lead can preview and print). The public /runner page lets a runner find their start, result and certificate by bib or name, but only what a director has switched on (start list, results, certificates), and never an age, date of birth, phone number or e-mail address. Pictures must come from the site's own media or vtra.run. No scanning or QR: it is search and print.
- Messages built (Package 5a, 6 Nov): a Messages tab in People where a director writes messages (five ready-made ones, placeholders for name, bib, wave, result and so on), chooses who gets one (runners by payment, category, bib, result and wave; volunteers by status; or leaving out those who already got it), prepares a fixed list and sends it as e-mails through one Wix triggered e-mail, or opens WhatsApp chats with the text ready. A batch is sent at most once to each person, with a log of ids and states only (no addresses, numbers or text), a retry for failures, a history, a test e-mail to the director and a file of people (directors only, audited). A lead can look but sees no contact details and sends nothing. No AI drafting, and no automatic WhatsApp or SMS (the director presses Send in WhatsApp).
- Waivers built (Package 5b, 9 Nov): a Waivers tab in People where a director writes the waiver text once per race (every save is a new version and an older version never changes), says which question of the registration form is the waiver and which answers mean signed, sees who has signed (form, volunteer sign-up page or a paper recorded on the day), records papers, marks a record made by mistake (with a reason; nothing is deleted) and prints a page for each person, one sign-in list or blank pages. "Signed" means the highest version a person has agreed to is at least the lowest version the director says counts. A lead can look, print and record a paper, not change the text, the setup or a record. Messages gets a Waiver choice (signed, or not signed the current waiver). RaceOS does not ask a runner to sign online: the registration form and the volunteer page do that.
- Reports built (Package 5c, 11 Nov): a Reports tab in its own group where a director runs six reports for a race (registrations, race day, volunteers, waivers, messages and money) and a lead runs five (not money). Each report is a few tables of counts and totals; nobody is named and no bib, phone number, e-mail address or date of birth is shown. Any table can be saved as a CSV file that a spreadsheet cannot take for a formula, and each save is a line in the audit trail. A part that cannot be read is named on the screen and counted as zero.
- Next, in order: GPX, TCX and FIT file import (planned against actual, training load); masked personal details, a log of who looked at them, export controls and erasure.
