EXPO DESK: part of RaceOS (the "BIB & Expo" tab at /rd)
=====================================================

There is ONE login for everything. The Expo desk has no login, no setup key and no page of its own.
Directors make every login on the RaceOS Team screen (/rd > Team > Add a login): name, username, role, desk(s), race.
A PIN (desk staff) or password (everyone else) is generated and shown once. Nobody edits the ExpoStaff collection by hand.
Desk staff open /rd, type their login, and land on their desk. They never see the Director screens.

FILES (see docs/SETUP.md for the full steps)
  exposoft.web.js    Backend web module named exposoft.web.js. It checks the RaceOS session on every call.
  rd-auth.js         Backend plain file named rd-auth.js (shared with racedir.web.js and training.web.js).
  exposoft-embed.html  NOT pasted anywhere: it is built into rd-embed.html (tools/build_rd.py does that).
  The page is /rd, with rd-embed.html and director-page-code.js. The old stand-alone /exposoft page and its page code are gone.

WHO CAN DO WHAT (server side; the screen only mirrors it)
  director / admin  every desk, plus stock, import and sync. No exceptions for the desk rules below.
  desk              only the desk(s) and the one race written on that login. The race is forced on the server.
  lead, viewer, coach, any other role   refused ("not_allowed"): they can log in to RaceOS but have no business at the desk.

DESK RULES
  Desk 1 - BIB     gives bibs and does the check-in (selfie). Cannot give T-shirts. Can undo bib / check-in.
  Desk 2 - Tshirt  gives T-shirts only (selfie, the registered size only, locked at hand-over). Cannot give bibs or check in. Can undo T-shirts.
  Desk 3 - Misc    gives nothing. Looks up runners, adds a walk-in runner, and is the corrections desk (can undo all three).
  One login = one desk at a time. Use a different login for each desk.
  A request that mixes allowed and not-allowed items is refused as a whole; nothing is saved.
  Two desks cannot hand the same item to the same runner: one wins, the other is told it was already given.
  A desk login without a race is refused when more than one race exists ("no_race").

RACE NAMES (instead of Import910 / Import909)
  Log in as director > BIB & Expo > Stock tab > "Race name shown to everyone" > type e.g. Vizag Half Marathon > Save lot.
  A new Import... collection appears by itself; give it a name the same way, once.
  Nobody can overwrite the findmybib/CMS lists: the desk only reads the Import... collections.

FIRST TIME
  1. Follow docs/SETUP.md steps 1 to 6 (files, pages, publish, first-time setup, Team).
  2. BIB & Expo > Stock: type the BIB lot and the T-shirt lot per size.
  3. Setup tab > Sync from findmybib. Press "Check data" first and send me the "Columns" line if category or size shows as not found.
  4. If the collections came from the old Expo setup, add text columns: Runners.bibName; ExpoStaff.desks, race, name, failCount, lockUntil.

REHEARSAL BEFORE RACE DAY (live site, test runner)
  - Desk 1 login: check-in + bib works with selfie; no T-shirt option is offered.
  - Desk 2 login: T-shirt works with selfie; no bib / check-in option is offered; the size cannot be changed.
  - Desk 3 login: nothing can be handed over; Add runner is visible only here.
  - Log in with the Desk 1 login on a second phone for Desk 2: it is refused (one login, one desk).
  - Undo from each desk and watch the stock count go back.
  - Team screen: Sign out a desk login and watch that phone return to the login screen.

TESTED (simulated Wix, not the live site): see docs/TESTING.md. Unit, penetration, integration, security and regression
suites cover the desk rules, hand-over races, forged messages between the page and the desk, guessing logins, and every
method against the role table.
