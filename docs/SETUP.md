# VTRA RaceOS: files and setup steps (Wix)

RaceOS is one site: **one login for everything**. The Expo desk (bibs, T-shirts, check-in) is part of it, not a separate page and not a separate login. You make every login on the **Team** screen; nobody edits the ExpoStaff collection by hand any more.

## A. The files and where each one goes

**Backend files** (code sidebar > Backend). The first four are web modules (`.web.js`); the other four are plain files: create them with **+ > Add a .js file** and give them exactly these names.

| File in this pack | Name in Wix | Notes |
|---|---|---|
| 1-backend/racedir.web.js | racedir.web.js | RaceOS. **Change SETUP_KEY near the top to a secret of your own.** Until you do, setup refuses to run for anyone |
| 1-backend/exposoft.web.js | exposoft.web.js | The Expo desk's server side. Has no key and no login of its own |
| 1-backend/training.web.js | training.web.js | Coach and athlete pages. Has its own SETUP_KEY, used only by its optional manual setup (the collections are also made by the first coach login) |
| 1-backend/finance.web.js | finance.web.js | **New.** Finance: invoices, orders, claims, cash, ledger. Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/rd-auth.js | **rd-auth.js** | New. Passwords, PINs, roles. All three `.web.js` files import it |
| 1-backend/ai-core.js | **ai-core.js** | Optional AI helper (works without a key) |
| 1-backend/rd-approvals.js | **rd-approvals.js** | Approvals library and the letter writer |
| 1-backend/rd-finance.js | **rd-finance.js** | **New.** Finance rules and money arithmetic. `finance.web.js` imports it |

**Pages** (each page: add an HTML element, paste the embed, set the element ID, paste the page code in the page's code panel)

| Page URL | Embed to paste into the HTML element | Element ID | Page code to paste |
|---|---|---|---|
| /rd | 2-pages/rd/rd-embed.html | dirFrame | 2-pages/rd/page-code.js |
| /volunteer | 2-pages/volunteer/volunteer-embed.html | volFrame | 2-pages/volunteer/page-code.js |
| /train | 2-pages/train/athlete-embed.html | trainFrame | 2-pages/train/page-code.js |
| /coach | 2-pages/coach/coach-embed.html | coachFrame | 2-pages/coach/page-code.js |

**There is no separate Expo page any more.** If you made a /exposoft page for the old software, you can delete it (or leave it; it will no longer be used). The Expo desk is the **BIB & Expo** tab at /rd, and desk staff land on it straight after logging in.

## B. First-time steps

1. **Prepare the site.** Wix Dev Mode on. Wix Events installed (it already is, for your tickets).
2. **Backend.** Add the eight files above. In `racedir.web.js` change `const SETUP_KEY = 'change-this-key'` to your own secret. Do the same in `training.web.js` if you ever want to run its manual setup (it refuses to run while the key is the placeholder).
3. **Pages.** Create /rd, /volunteer, /train, /coach (permissions **Anyone**: the logins are checked by the backend). On each: Add Elements > Embed Code > Embed HTML > Code, paste the embed file; make the element full width and about 1200 px tall; set its ID (Properties panel); paste the page code. Wix has no size limit on HTML embeds, so the large /rd page is fine.
4. **Publish** the site. Everything works on the published site only.
5. **First login at /rd.** Open "First-time setup (owner only)" on the login screen and enter the setup key plus a new admin username and password. This creates every collection (the Expo desk's too) locked to the site admin, and the first admin login. It does nothing to logins that already exist. Check that the new collections appear in the **live** CMS data.
   - *You used the old Expo desk?* Its logins keep working: staff type the same username and password at /rd. A password that was typed by hand into the CMS is replaced by a hash the first time that person logs in.
   - *Collections that already exist* (made by the old Expo setup) are not changed. Add these text columns by hand if they are missing: `Runners`: `bibName`; `ExpoStaff`: `desks`, `race`, `name`, `failCount`, `lockUntil`.
6. **Make the team's logins: /rd > Team > Add a login.** Type a name and a username, choose the role, and for desk staff choose the desk or desks and the race. RaceOS makes a PIN (desk staff) or a password (everyone else) and shows it **once**: hand it over there and then. It cannot be looked up later; use **New PIN** / **New password** if it is lost. The roles:
   - **Director**: everything, including Team, races and money.
   - **Lead**: volunteers, race day, pacers, safety and plans. No Team, no deleting, no money changes. The one exception: under **Finance > Claims** a lead can raise a reimbursement claim and see, change or withdraw their own claims (nothing else in Finance).
   - **Viewer**: look only (sponsors, partners). Sees no money and no phone numbers.
   - **Coach**: the coach page only.
   - **Desk**: works the Expo desk and nothing else. Give each desk its own login (Desk 1 - BIB, Desk 2 - Tshirt, Desk 3 - Misc), tied to one race. Staff log in at /rd and land on their desk.
   Changing a login's role, desk, race or password signs that person out at once. **Sign out** and **Remove** are on the same screen.
7. **Expo desk set-up** (/rd > BIB & Expo, as director): type the bib lot and the T-shirt lot per size (the Stock tab), then Setup tab > **Sync from findmybib**. Press **Check data** first and send me the Columns line if category or size shows as not found.
8. **Create the race** (/rd > Settings): name, date, venue, distance. Fill the Expo race only if you use the Expo desk for it.
9. **Registrations** (/rd > Registrations): Load my Wix events, pick the event, Link. Open Form fields, choose the T-shirt size, bib name and phone fields, Save. Press Import / refresh.
10. **Qualification** (/rd > Qualification): one rule per line, for example `110 K | Marathon under 6 hrs, or any 50 km+ | 42.195@6:00; 50@`.
11. **Volunteers** (/rd > Volunteers): add shifts (roles are suggested), then Copy link and share it.
12. **Coaching** (/coach): log in with a director or coach login (made on the Team screen). The first login creates the Training collections and three starter 8-week plans. Check Settings. Then open /train on a phone and sign up as a test athlete.
13. **Test** with a test race, a test volunteer, a test athlete and one login of each desk before announcing. Send any error text with the page name.

## Expo desk rules (enforced on the server; the screen only mirrors them)

| Desk | Gives | Can undo | Other |
|---|---|---|---|
| Desk 1 - BIB | bibs and the check-in (selfie required) | bib and check-in | no T-shirts |
| Desk 2 - Tshirt | T-shirts only (selfie; the size on the registration, locked at hand-over) | T-shirts | no bibs, no check-in |
| Desk 3 - Misc | nothing | everything (the corrections desk) | looks up runners, adds a walk-in runner |

- A director has no exception: a director at Desk 1 still cannot give a T-shirt. Directors set stock, sync and import from any desk.
- One login works one desk at a time (a second phone on the same login is refused while the first is active). Use a different login per desk.
- A desk login is tied to one race, forced on the server: that login can never see or change another race.
- A request that mixes allowed and not-allowed items is refused as a whole, and two desks cannot hand the same item to the same runner: exactly one wins.
- Nobody can overwrite the findmybib lists or the CMS data: the Expo desk only reads the `Import...` collections.

## Rehearsal before race day (live site, test runner)
- Desk 1 login: check-in and bib work with a selfie; no T-shirt option is offered.
- Desk 2 login: a T-shirt works with a selfie; no bib option is offered; the size cannot be changed.
- Desk 3 login: nothing can be handed over; Add runner is visible only here.
- Use the Desk 1 login on a second phone for Desk 2: it is refused.
- Undo from each desk and watch the stock go back.
- On the Team screen: make a new desk login, log in with it in a private window, then **Sign out** it and watch the private window return to the login.

## Planning tabs
After publishing, log in once at /rd: the RDPlan collection is created by itself. Create a new race to get the starter lists, or open an existing race and press "Load the starter list" in each empty section (Plan, Money, Approvals, Ceremonies, Logistics). No new page or element is needed.


## Finance (/rd > Finance)
A **Finance** tab sits after **Money**. It uses the same login. The only set-up is two backend files, `finance.web.js` and `rd-finance.js`: add them **before** you paste the new /rd page code (the page code imports `finance.web.js`, so Wix will not save the page code until that file exists). The five collections it keeps (RDInvoices, RDOrders, RDClaims, RDLedger, RDFinSet) are made by themselves the first time a director or lead opens it, locked to the site admin. Look for them in the **live** CMS data. Nobody edits them by hand.

**Who can do what** (the server decides, the screen only mirrors it): a **director** does everything. A **lead** sees only the **Claims** tab: they raise a reimbursement claim and see, change or withdraw their own claims while it is still waiting for a decision. Viewers, desk staff and coaches are refused. A director can approve their own claim; the log marks it "own claim".

| Tab | What it does |
|---|---|
| Summary | The race's income and expenses on one page: ticket takings, invoiced, received (and tax withheld at source), other income; paid, owed, committed and claims waiting; net so far and projected; by category, budget against estimate against actual; cash in hand. CSV download. |
| Invoices | Raise an invoice to a sponsor, partner or anyone (lines, due date, notes). Invoices, claims and orders are numbered like `INV/2026-27/0001`, by financial year (April to March), and a number is never reused. Record part or full payments with date, mode, reference and any TDS the payer withheld. Overdue invoices show in red. Print, or download for Word. |
| Orders | A purchase from a vendor with three figures: the **estimate** (what you expect), the **advance** (what you have paid so far) and the **actual** (what the vendor really billed). The screen shows estimate against actual, the balance still to pay, and a refund due when you paid more than the final bill. You cannot pay more than the bill (or more than the estimate until a bill is added). A refund from the vendor is recorded against the order. |
| Claims | Money that core staff or others spent for the race and want back: lines with date, category, amount and bill reference. The director approves all or part (a reason is needed to reject), then pays it, in one go or in parts. Print the claim, or download for Word. |
| Cash | Cash taken from the bank is held by a named person. Cash they pay out or take in changes what they hold, and they can put cash back. The screen shows what each person should have in hand. **Record the withdrawal first**: a cash payment larger than what that person holds is refused. |
| Ledger | Every rupee in and out, in order, with who recorded it. **Nothing is edited or deleted.** A mistake is **voided** with a reason (the row stays, struck through) and then entered again correctly. Other income or expenses (a prize cheque, a bank charge) are added here. CSV download. |
| Details | Printed on every invoice: organisation name, address, PAN, GSTIN, bank account, UPI id, terms, who signs and the invoice prefix. Name, terms and prefix start filled in; add the rest before the first invoice. |

**Safe to repeat.** Every action that creates something carries a one-time key, so a double tap or a bad network never makes two invoices, claims or payments. If two people act on the same item at the same moment, one may see "busy, try again": press again.

**Rules the server enforces:** amounts are whole paise (no negatives, no exponents, no text, just under 100 crore at most); a payment never exceeds what is owed; an invoice that has been paid cannot be cancelled; a claim must be approved before it is paid; cash in hand cannot go below zero, even when two payments or two voids happen together; an id from another race is refused; every create, void and payment is logged with who did it.

**Limits to know**
- An invoice cannot be edited once raised. Cancel it (only while no payment is recorded on it) and raise a new one.
- **It is not a GST tax invoice.** There is no CGST/SGST/IGST split, HSN/SAC code or place of supply; it prints the GSTIN you enter under Details. If VTRA must charge GST, have your accountant check the layout before you send one.
- Ticket takings come from the registrations imported from Wix Events, at the category prices in Settings (the dashboard's rule). Coupons, discounts and refunds made inside Wix are not seen.
- A sponsor's "Received" on Plan > Money is not updated by Finance. Use the Finance Summary for what has really come in.
- The cash checks are optimistic, not locked. Two cash payments or voids by the same person at the very same instant may both be turned back ("busy, try again" or "not enough cash"): press again. They never overspend.
- Logins last 12 hours. A session whose expiry is blank or damaged is now refused everywhere (RaceOS, Finance, the Expo desk, coach and athlete pages); earlier versions let it live on.
- The /rd page, and the volunteer, athlete and coach pages, accept replies to their calls from any frame on the same page. Keep these pages free of third-party embedded content (chat widgets, ad banners). The Expo desk frame already checks who is talking to it.


## Approvals template (/rd > Approvals)
Open **Approvals**, then **Approvals template > Open** (directors only). It opens by itself on a race that has no template lines yet.
1. **Race details.** Edition (type 6 and it reads "6th edition" everywhere), race name, date and venue. Then the organiser details, once: city, local body (for example GVMC), organiser, registration number, who signs the letters and their role, phone, e-mail, address. Also expected runners and volunteers, flag-off and finish times, the route in a line and the expo date. A new race copies these from the race you edited last. Saving moves the dates of every line you did not set by hand.
2. **What does this race involve?** Eleven yes/no questions: roads closed or diverted, forest or village land, expo and tents, loudspeakers, music, food, power, banners, drone, highway or defence land, AIMS certification. The answers switch the matching approvals on or off.
3. **The list.** Each suggested approval shows its authority, "days before the race" and the date it must be applied by. All three can be edited. A date follows the race date until you type one yourself. Race-day sign-offs (weather go or no-go, course, medical, police, timing, aid stations, volunteers, kit check, final flag-off) are set in minutes before the flag-off and follow the start time.
4. **Add selected approvals.** Adds them to the Approvals list. Nothing you already wrote is overwritten. Starter lines from earlier versions that nobody touched are replaced by the template ones, and untouched unused ones are removed.

Every permit has a **Letter** button: a formal application letter filled from the race details, the documents to attach (tick each as you collect it, the list shows "3/8 ready") and tips on where and how to apply. Whatever is missing shows as a [bracketed blank], with a list above the letter of what to fill in. Edit the text, then **Copy**, **Download for Word** or **Print**. Leads can open letters and tick documents; viewers see neither the letters nor the template.
The authorities, documents and lead times are a sound starting point, not legal advice. Offices differ by city and state, so check each one's current rules and forms before you apply.


## AI features (optional, work without a key)
Without a key, Ask RaceOS shows a rule-based daily briefing, forecasts (registrations, volunteers, budget) and template drafts. The coach and athlete screens show planned against actual with flags. With a key, the same facts are written up by Claude: the briefing, Ask RaceOS, drafts for runners, volunteers and sponsors, and coach suggestions with a draft note to the athlete.

1. Backend: make sure `ai-core.js` exists next to `racedir.web.js` and `training.web.js` (file name exactly `ai-core.js`).
2. Wix dashboard > Developer Tools > Secrets Manager > add a secret named `ANTHROPIC_API_KEY` with your key. Optional: `ANTHROPIC_MODEL` to choose a model (default `claude-sonnet-5-5`).
3. Publish. Open /rd > Ask RaceOS: it should say "AI connected".

What is sent to the model: counts, dates, item titles and what you typed. Never names, phone numbers or e-mail addresses (typed text is also scrubbed). Viewers' questions get no money figures. Each person is limited to 40 AI requests an hour.

## Bibs and Expo desk (Race > Bibs and sync)
1. Settings: pick the Expo race for the race (a dropdown of the Expo races).
2. Bibs and sync: enter bib ranges per category (`21.1K | 1001 | 1999`), press **Assign bib numbers**, then **Send to Expo desk**.
3. The Expo desk gets new runners only. A bib already handed over, a T-shirt size already issued and everything the desk recorded are never changed, and nobody is removed from the desk list.
4. The tab shows live desk figures: checked in, bibs, shirts, per category, T-shirt needed against stock, per-desk activity and the latest handovers (names shortened, no phones). Alerts appear on the dashboard for runners without a bib, runners not sent, short T-shirt sizes and more runners than printed bibs.
