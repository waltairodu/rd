EXPO DESK for Wix  (page: vtra.run/exposoft)
==========================================

FILES AND WHERE THEY GO
  exposoft.web.js         Backend  -> Dev Mode > Backend & Public > Backend > new file "exposoft.web.js" (overwrite the old one)
  exposoft-page-code.js   Page code -> the code tab at the bottom of the /exposoft page (NOT a separate file)
  exposoft-embed.html     HTML embed on the /exposoft page, ID  expoFrame, code mode, paste the whole file. Make it tall (about 1400 px).

DESK RULES (enforced on the server, the screen only mirrors them)
  Desk 1 - BIB     gives bibs and does the check-in (selfie). Cannot give T-shirts. Can undo bib / check-in.
  Desk 2 - Tshirt  gives T-shirts only (selfie, registered size only). Cannot give bibs or check in. Can undo T-shirts.
  Desk 3 - Misc    gives nothing. Looks up runners, adds a walk-in runner, and is the corrections desk (can undo all three).
  Admin            has no exception: an admin at Desk 1 still cannot give a T-shirt. Admin can still set stock, sync and import from any desk.
  One login = one desk at a time. Use a different login for each desk.
  A request that mixes allowed and not-allowed items is refused as a whole; nothing is saved.
  Error shown for a wrong-desk action: "This desk cannot do that."

CMS COLLECTION  ExpoStaff  (columns: username, password, role, desks, race, name, failCount, lockUntil)
  bib1     (password)  desk   Desk 1   VHM
  shirt1   (password)  desk   Desk 2   VHM
  misc1    (password)  desk   Desk 3   VHM
  yogi     (password)  admin  (blank)  (blank)   <- admin may pick any race and desk at login
  role  = admin or desk.
  desks = Desk 1 / Desk 2 / Desk 3 (or BIB / Tshirt / Misc). ONE desk per login.
  race  = the race name (as shown in the app) or its collection id (Import910). ONE race per login.
  After login a desk person goes straight to the work screen: no race or desk picker is shown, and the
  race is forced on the server, so that login can never see or change another race.
  If a desk login has no race and more than one race exists, login is refused ("No race is assigned").
  Add the 'race' column to ExpoStaff once (text). Add rows in BOTH Sandbox and Live data if you add them by hand.

RACE NAMES (instead of Import910 / Import909)
  Easiest: log in as admin > Stock tab > "Race name shown to everyone" > type e.g. Vizag Half Marathon > Save lot.
  That name is used in every dropdown, header and in the 'race' column match. Clear the box and save to go back
  to the CMS name. A new Import... collection appears in the app by itself; give it a name the same way, once.
  (Other ways: give the collection a display name in the CMS, or add it to RACE_NAMES at the top of exposoft.web.js.
   A name typed in the app wins over both.)

FIRST TIME
  1. Edit SETUP_KEY at the top of exposoft.web.js (any secret text you choose).
  2. Publish. Open vtra.run/exposoft, use "First-time setup" once (creates the collections and your first admin).
  3. Log in as admin > Stock tab: type the BIB lot and the T-shirt lot per size. Nothing else is typed.
  4. Setup tab > Sync from findmybib. Press "Check data" first and send me the "Columns" line if category or size shows as not found.

REHEARSAL BEFORE RACE DAY  (do all of these on the live page with a test runner)
  - Desk 1 login: check-in + bib works with selfie; no T-shirt option is offered.
  - Desk 2 login: T-shirt works with selfie; no bib / check-in option is offered; the size cannot be changed.
  - Desk 3 login: nothing can be handed over; Add runner is visible only here.
  - Log in with the Desk 1 login on a second phone for Desk 2: it is refused (one login, one desk).
  - Undo from each desk and watch the stock count go back.

TESTED (simulated Wix, not the live site)
  93 backend scenario checks (desk rules, race lock, race rename; the old name 'VHM' kept as fallback)
  (desk part: 72)  desk scenario checks (every desk x check-in, bib, T-shirt, undo, add runner, admin tools, tampered requests, selfie, size lock, stock lot)
  45 screen checks (what each desk sees and can click). Tests were also run with the desk check removed, to prove they fail without it.
