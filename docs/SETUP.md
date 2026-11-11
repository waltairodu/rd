# VTRA RaceOS: files and setup steps (Wix)

RaceOS is one site: **one login for everything**. The Expo desk (bibs, T-shirts, check-in) is part of it, not a separate page and not a separate login. You make every login on the **Team** screen; nobody edits the ExpoStaff collection by hand any more.

## A. The files and where each one goes

**Backend files** (code sidebar > Backend). The first ten are web modules (`.web.js`); the other ten are plain files: create them with **+ > Add a .js file** and give them exactly these names.

| File in this pack | Name in Wix | Notes |
|---|---|---|
| 1-backend/racedir.web.js | racedir.web.js | RaceOS. **Change SETUP_KEY near the top to a secret of your own.** Until you do, setup refuses to run for anyone |
| 1-backend/exposoft.web.js | exposoft.web.js | The Expo desk's server side. Has no key and no login of its own |
| 1-backend/training.web.js | training.web.js | Coach and athlete pages. Has its own SETUP_KEY, used only by its optional manual setup (the collections are also made by the first coach login) |
| 1-backend/finance.web.js | finance.web.js | Finance: invoices, orders, claims, cash, ledger. Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/results.web.js | results.web.js | Waves and corrals, results, awards. Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/print.web.js | print.web.js | **New.** Bibs, certificates and the runner page's switches (staff only). Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/runner.web.js | runner.web.js | **New.** The public /runner page's server side: three read-only methods that anyone may call, and that show a race only after a director has turned a switch on for it. Add it **before** you paste the page code of /runner |
| 1-backend/comms.web.js | comms.web.js | **New.** Messages to runners and volunteers: templates, who a message goes to, e-mails through one Wix triggered e-mail with a log, WhatsApp chat links, a file of people (staff only). Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/waivers.web.js | waivers.web.js | **New.** Waivers: the waiver text in versions, which question of the registration form is the waiver, who has signed, papers signed on the day, the papers to print (staff only). Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/reports.web.js | reports.web.js | **New.** Reports: six reports of counts and totals for a race and a CSV file of any table (staff only; Money is for directors). Add it **before** you paste the new /rd page code, because that code imports it |
| 1-backend/rd-auth.js | **rd-auth.js** | Passwords, PINs, roles. Every `.web.js` file imports it |
| 1-backend/ai-core.js | **ai-core.js** | Optional AI helper (works without a key) |
| 1-backend/rd-approvals.js | **rd-approvals.js** | Approvals library and the letter writer |
| 1-backend/rd-finance.js | **rd-finance.js** | Finance rules and money arithmetic. `finance.web.js` imports it |
| 1-backend/rd-results.js | **rd-results.js** | Results rules: times, age groups, waves, awards. `results.web.js` imports it |
| 1-backend/rd-print.js | **rd-print.js** | **New.** Bib and certificate designs and the rules for what the public page may show. `print.web.js` and `runner.web.js` import it |
| 1-backend/rd-data.js | **rd-data.js** | **New.** Reads a race, its registrations, results and waves for the papers and the runner page (reading only). `print.web.js` and `runner.web.js` import it |
| 1-backend/rd-comms.js | **rd-comms.js** | **New.** Messages rules: filling a template, cleaning names and links, who is in an audience, chat links, CSV safety. `comms.web.js` imports it |
| 1-backend/rd-waiver.js | **rd-waiver.js** | **New.** Waiver rules: the text and its versions, who counts as signed, the papers to print. `waivers.web.js` imports it, and so does `comms.web.js` (for the Waiver choice of an audience) |
| 1-backend/rd-report.js | **rd-report.js** | **New.** Report rules: the tables of each report, cleaning the words in them, rows cut at 400, a table as a safe CSV file. `reports.web.js` imports it |

**Pages** (each page: add an HTML element, paste the embed, set the element ID, paste the page code in the page's code panel)

| Page URL | Embed to paste into the HTML element | Element ID | Page code to paste |
|---|---|---|---|
| /rd | 2-pages/rd/rd-embed.html | dirFrame | 2-pages/rd/page-code.js |
| /volunteer | 2-pages/volunteer/volunteer-embed.html | volFrame | 2-pages/volunteer/page-code.js |
| /train | 2-pages/train/athlete-embed.html | trainFrame | 2-pages/train/page-code.js |
| /coach | 2-pages/coach/coach-embed.html | coachFrame | 2-pages/coach/page-code.js |
| /runner | 2-pages/runner/runner-embed.html | runFrame | 2-pages/runner/page-code.js |

**There is no separate Expo page any more.** If you made a /exposoft page for the old software, you can delete it (or leave it; it will no longer be used). The Expo desk is the **BIB & Expo** tab at /rd, and desk staff land on it straight after logging in.

## B. First-time steps

1. **Prepare the site.** Wix Dev Mode on. Wix Events installed (it already is, for your tickets).
2. **Backend.** Add the eighteen files above. In `racedir.web.js` change `const SETUP_KEY = 'change-this-key'` to your own secret. Do the same in `training.web.js` if you ever want to run its manual setup (it refuses to run while the key is the placeholder).
3. **Pages.** Create /rd, /volunteer, /train, /coach and /runner (permissions **Anyone**: the logins are checked by the backend). On each: Add Elements > Embed Code > Embed HTML > Code, paste the embed file; make the element full width and about 1200 px tall; set its ID (Properties panel); paste the page code. Wix has no size limit on HTML embeds, so the large /rd page is fine.
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
- Messages: on a test race whose only runner is you (your own e-mail and phone in the registration), send yourself a test from **Settings**, then prepare **Your bib** for "Payment: Paid, Bib: Has a bib" and send it: one e-mail arrives. Press **Send e-mails** again: nothing more is sent, because you were already handled. Open **History** and check the count. Prepare a **WhatsApp** batch, open the chat, send it from WhatsApp and press **Mark as sent**. Log in as a lead: the tab shows no addresses and no send button.
- Waivers: on a test race, open **People > Waivers > Waiver text**, press **Use the standard wording** and save it (version 1). In **Setup**, pick the waiver question of your registration form and save. In **Who has signed**, tick yourself and press **Record 1 paper as signed** (then **Sure?**): you move to "Signed". Press it again after ticking nothing new: nothing changes. Open **Records**, mark the record as a mistake with a reason (directors only) and watch yourself go back to "Not signed at all". Open **Print papers**, print one page for yourself and a blank page, and check that the paper holds a name, a bib and a category and no phone number or e-mail address. Save a second wording, set **Lowest version that counts as signed** to 2, and see everybody listed as signed an older version. In **Messages** pick **Waiver: Has not signed the current waiver** and see the same people. Log in as a lead: the text and the setup are read-only, and printing and recording work.
- Reports: open **Reports** and pick **Registrations** on a race you know: the counts by category, gender, age group, T-shirt size and day agree with the Registrations tab, and no name, bib, phone number, e-mail address or date of birth is on the screen. Press **Save as CSV** on a table, open the file in Excel or Numbers, and check `RDAudit` for the new "report saved as CSV" line. Pick **Money** and compare it with Finance, and **Race day** and compare it with the Waves & results board. Log in as a lead: five reports, no Money. Log in as a viewer: no tab.

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


## Waves & results (/rd > Waves & results)
A **Waves & results** tab sits under **Race day**, between **BIB & Expo** and **Race day**. It uses the same login. The only set-up is two backend files, `results.web.js` and `rd-results.js`: add them **before** you paste the new /rd page code (the page code imports `results.web.js`, so Wix will not save it until that file exists). The three collections it keeps (RDResults, RDWaveAssign, RDResSet) are made by themselves the first time a director or lead opens the tab, locked to the site admin. Look for them in the **live** CMS data. Nobody edits them by hand.

**Who can do what** (the server decides, the screen only mirrors it): a **director** does everything. A **lead** can look at **Results**, **Awards** and **Start list** and changes nothing. Viewers, desk staff and coaches do not see the tab and are refused if they ask. Pick the race at the top as everywhere else: waves, results and settings belong to one race and never mix.

**In what order to use it**
1. **Setup tab:** say which question on your registration form holds gender, date of birth (or age) and the expected finish time. Check the age groups and places.
2. **Waves tab:** add the waves for each category (start time, corrals, capacity), save, then **Place runners**.
3. **Start list tab:** print the start list for the corrals; move anyone by hand.
4. **After the race, Import tab:** paste the timing company's file, **Check the file**, then **Save results**.
5. **Results and Awards tabs:** look, fix or void a result, print.

| Tab | What it does |
|---|---|
| Results | The board for the race, filtered by category: place, bib, name, category, gender, age group (and age), time, gender place, age-group place and notes. Finished runners are ranked within their category; DNF, DNS and disqualified are listed after them. Flags show what needs a look: not registered, no gender, no age, no chip time, a time that looks too fast or too slow for the distance (a typing slip such as 1:45 for 1:45:00). CSV and Print. Directors have **Fix** and **Void** on every row; voided results are listed apart, with who, when and why, and **Restore** brings one back. |
| Import | Paste the timing file, or choose it. **Check the file** first: it shows how many lines were read, how many match a registration, how many are finished, DNF, DNS or disqualified, how many are new, the columns it used and ignored, a sample, and every line with a problem (line number and what is wrong). Nothing is saved until **Save results**. |
| Awards | The prize list: the top places overall and the top places in each age group, for each gender in each category. Runners who cannot be given an award because their gender or age is missing are listed under the table, so you can fix them on Results. CSV and Print. |
| Waves | The waves for each category and the **Place the runners** form. |
| Start list | Every paid runner under the category's wave and corral, in start-time order, then those not placed. A director can change the wave or corral of a runner from here. CSV and Print. |
| Setup | How runners are ranked and aged, the age groups, the number of places, and which registration question holds what. |

**Waves and corrals.** A wave is a start time for one category (for example "21 K, Wave 1, 06:00"). Corrals are the holding areas in it (A, B, C; the fastest go in A). Capacity 0 means no limit. A wave needs a category of this race, a name (up to 30 letters), a start time in 24-hour form (06:30), up to 8 corral names (each up to 12 letters) and a capacity from 0 to 5000; up to 40 waves. A name cannot repeat inside one category. If you remove a wave, or change its category, the runners in it are taken out of it (the screen tells you how many); if you remove a corral, those runners stay in the wave without a corral.

**Placing runners.** Only runners who have **paid** are placed (a registration that the Registrations tab does not show as unpaid). A runner goes only into a wave of their own category. Waves fill in start-time order, each up to its capacity; within a category the order is **fastest expected time first** (the expected time from the form question you chose on Setup; runners with none go last) or **bib order**. Inside a wave the runners are spread over the corrals in order, the fastest in the first corral. A runner you move by hand (Start list) **never moves again** and keeps their seat when you press **Place again**. A runner without room is shown as not placed: add a wave or raise a capacity and place again.

**Importing results.** The first line names the columns. Commas, semicolons or tabs all work; up to 5000 lines, 20 columns and 400,000 characters at a time (send a bigger file in parts).

| Column | Names it understands | Needed? |
|---|---|---|
| Bib | bib, bib no, bib number, race bib, race number | Always |
| Time | time, finish time, official, result, finish | One of time, chip or gun, for a finisher |
| Chip time | chip, chip time, net, net time | |
| Gun time | gun, gun time, gross, clock | |
| Status | status, state: finished, DNF, DNS, DQ or DSQ (also retired, withdrawn, no show, disqualified) | Blank means finished when there is a time |
| Name, category | name, runner, participant, full name; category, cat, race, distance, event | Only for a bib that is **not** registered |
| Gender, date of birth, age | gender or sex (M, F, other); dob, date of birth, birthday (25/12/1990 or 1990-12-25); age | Optional. A value in the file wins over the registration |

Times are `h:mm:ss` (1:45:30), or `mm:ss` for under an hour (45:30), with hundredths if the timers give them (1:45:30.57). Hundredths are cut, never rounded; minutes and seconds go to 59 at most; the longest time is 48 hours. A time such as 1:45 is one minute 45 seconds: type 1:45:00 for an hour and 45 minutes. The ranking uses the chip time or the gun time, as chosen on Setup; if the chosen one is missing the other is used and the row is flagged. A runner who is registered must be in the registered category: a file that says another is refused for that line ("Correct the file, or the registration"). A category typed in the file has to be one of the race's categories (25K is read as "25 K - Debut Trail" when that is the only match). The same bib twice: the first line is used and the second is reported. **Skip lines with problems** saves the good lines and leaves the others out (the screen counts them); without it, a file with any problem is not saved at all. A result already saved is **kept** unless you tick **Replace results already saved**; a replaced result keeps its earlier values in its history.

**Ranking and awards.** The same time shares a place and the next place is skipped (1, 2, 2, 4). Places are given within each category: overall, then within each gender, then within each age group. The default age groups are Under 18, 18-29, 30-39, 40-49, 50-59 and 60+ (change the starting ages on Setup). Age is counted on the day of the race, or on 31 December of the race year, as chosen. An overall winner is not listed again in their age group unless you untick that on Setup. A tie for the last award place takes everyone tied. A runner with no gender, or no age, is left out of the awards for that part and listed so you can fix it (**Fix**: gender, age or date of birth).

**Fixing and voiding.** **Fix** changes status, times, gender, age, date of birth, category or a note, and needs a **reason**. **Void** takes a result out of the ranking, with a reason; it stays on the list, apart, and can be restored. Nothing is deleted, the earlier values are kept, and each change is logged with who made it.

**Safe to repeat.** Placing runners and saving results carry a one-time key, so a double tap or a bad network never saves twice. If two directors do the same thing at the same moment, one may see "busy, try again": press again. Saving waves checks that nobody else changed them meanwhile; if someone did, you are asked to open the tab again and redo your change.

**Privacy.** A date of birth is read only to work out an age. It is **never** shown on screen, in a CSV, in a print-out or in an answer from the server, and the Fix form's date-of-birth box is always empty (type a new one to replace it). Phone numbers and e-mail addresses never come through Results at all. The Setup screen lists only the names of the form's questions, never the answers.

**Limits to know**
- Results come by file or by hand. There is no live link to the timing company's system.
- Settings are saved as typed; if two directors save Setup at the same moment, the last save wins. Waves are protected (see above).
- A date of birth that a director types or that a file carries is stored with that result (never shown). The date of birth in a registration stays in the registration.
- If two directors save results at the very same moment, look at the Results tab afterwards and check that each bib shows what you expect. The repeat key protects one login that taps twice; it cannot tell which of two different people should win.
- The /rd page accepts replies to its calls from any frame on the same page (see the note under Finance). Keep it free of third-party embedded content.

## Bibs & certificates (/rd > Bibs & certificates) and the public /runner page
A **Bibs & certificates** tab sits in the **Race day** group of the menu, right after **Waves & results**. It uses the same login. The set-up is four backend files, `print.web.js`, `runner.web.js`, `rd-print.js` and `rd-data.js` (add them **before** you paste the new /rd page code: that code imports `print.web.js`, so Wix will not save it until the file exists), and one new page, **/runner**. One locked collection, **RDPrint**, is made the first time a director or lead opens the tab (if you prefer to make it by hand, give it the text columns `event`, `kind`, `json`, `by` and `at`, and set all four permissions to Admin).

**Who can do what** (the server decides, the screen only mirrors it): a **director** designs, prints, and decides what the public page shows. A **lead** can preview and print and changes nothing. Viewers, desk staff, coaches and sponsors do not see the tab and are refused if they ask. Designs and switches belong to one race: pick the race at the top as everywhere else and nothing leaks to another race.

**The three sections**

| Section | What it does |
|---|---|
| Bibs | The design of the bib, a preview at the real size of the paper, and printing. |
| Certificates | The design of the finisher's certificate, a preview, and printing. |
| Runner page | The switches for the public page, a note for the top of it, and the link to share. Directors only. |

**Designing a bib.** Width 80 to 300 mm and height 60 to 210 mm, page A4 or A3 (portrait or landscape), an accent colour for the top band, a title and a subtitle, which name to print (none, the name, the bib name, or the bib name if there is one and the name if not), whether to print the category and a colour for each category, up to six sponsors (a name, or the address of a picture), a tear-off strip with the number repeated, punch holes, and a footer line. In the title, subtitle and footer, `{race}`, `{date}`, `{venue}`, `{cat}`, `{bib}`, `{name}` and `{bibname}` are replaced for each runner. The preview shows a real runner (type a bib to look at another) or, if nobody has a bib yet, a made-up one, and says which.

**Printing bibs.** A bib is printed for every runner who has **paid** and has a **bib number**, in bib order: all of them, one category, or one bib. **Spare bibs**: type the first and last number (up to 500 at a time); numbers that real runners already have are skipped, never printed twice. The bibs come from the server a page of 60 at a time and join into one print window, so a race of thousands prints in one go, with a counter. If you changed the design on screen, it is saved first, so what prints is what the preview showed. Each print of all, a category or one bib is written to the change list (who, which race, how many).

**Designing a certificate.** Landscape or portrait, a border (none, simple, double), accent and background colours, a logo (a picture address), a title, an introduction, and a body text. In the body, title and footer you can use `{name}`, `{bib}`, `{cat}`, `{race}`, `{date}`, `{venue}`, `{time}`, `{place}`, `{gender}`, `{gplace}`, `{agegroup}`, `{aplace}` and `{pace}`. The boxes under the body (time, overall place, place among men or women, place in the age group, pace) can be switched off. Up to two signatures (a name and a role each), up to six sponsors, and a footer line. A certificate is printed only for a runner who **finished with a place**: not a DNF, a DNS, a disqualified or a voided result. Certificates come in the order of the categories, then by place, 25 at a time, and join into one print window like the bibs. A certificate takes everything from Waves & results, so a correction there shows on the next certificate you print.

**Pictures** (a logo or a sponsor) must be an https address on the Wix media server (`static.wixstatic.com`) or on the club's own site (`vtra.run` or `www.vtra.run`). Anything else is refused with a message when you save, and is never printed. Colours are six hex digits such as `#1b5e9b`.

**Printing is the browser's print window.** Choose "Save as PDF" there to keep the file, or a printer. The paper size and the margins are set by the design, so tick "Background graphics" if your browser does not already (the colours of the bands and categories are backgrounds).

**The public runner page (/runner).** Anyone with the link can look themselves up by **bib number** or by **three letters of their name** and sees at most ten runners. Nothing is shown until a director turns a switch on for that race, on **Runner page**:
- **Start list**: bib, name, category, wave, start time and corral.
- **Results**: finish time, place in the category, place among men or women, and place in the age group (a DNF or a DNS is shown only as that).
- **Certificates** (needs Results): a finisher can open their own certificate and print it, or save it as a PDF.
- **A note** of up to 200 letters for the top of the page.

The link to share is `https://www.vtra.run/runner?ev=RACE_ID`; the Runner page section shows it with **Copy** and **Open** buttons. Without `?ev=` the page lists the races that show something (and opens straight on it when only one does). A race with every switch off does not exist as far as the page can tell: a link to it, to a deleted race or to a race that was never there all say the same thing, "That race is not showing anything on this page". A switch you turn off stops showing **at once**. A correction you make on Waves & results can take up to **30 seconds** to show on the page (the page keeps one made copy of the race for 30 seconds, so a rush of runners costs a few database reads, not one each).

**What the public page never shows:** a date of birth, an age, a phone number, an e-mail address, a T-shirt size, anything about payment, a correction note, a void reason, or a runner who has not paid. It cannot be used to list the race: one or two letters find nobody, a bib prefix finds nobody, wildcards mean nothing, and a name that matches many people shows ten with a line saying so. It changes nothing in your data: the three methods behind it only read.

**Safe to repeat.** Saving the same design or the same switches twice is harmless. Printing writes only the note in the change list. If two directors save a design at the same moment, one whole design wins; the page never keeps a mixture.

**In what order to use it**
1. **Bibs:** set the size, colours and sponsors, check the preview with a real bib, then **Print all bibs** (or one category). Print a **spare** set for the expo desk.
2. **Certificates:** write the wording and the signatures, check the preview with a finisher's bib.
3. **Runner page (before race day):** turn **Start list** on, so runners can find their wave and corral. Share the link.
4. **After the race:** import and check the results on **Waves & results**, then turn **Results** (and **Certificates**) on. Send the link again.

**Limits to know**
- Certificates and bibs use fonts every computer has (Arial, Georgia). There is no photo of the runner on them.
- Printing goes through the browser's print window; there is no direct printer control. A certificate is not attached to an e-mail: send the runner page link with **Messages** (the **Thank you and results** message has a `{link}`) and each finisher opens and prints their own.
- The public page needs Results to be imported on Waves & results first; a runner whose bib is not in the timing file shows no result.
- Search matches the name as registered (letters and digits only, no spaces or punctuation), so "d'souza" is found by "dsouza" and by "souza".
- The /rd page accepts replies to its calls from any frame on the same page (see the note under Finance). Keep it free of third-party embedded content.

## Messages (/rd > People > Messages)
A **Messages** tab sits in the **People** group of the menu, right after **Volunteers**. It uses the same login. The set-up is two backend files, `comms.web.js` and `rd-comms.js` (add them **before** you paste the new /rd page code: that code imports `comms.web.js`, so Wix will not save it until the file exists), and one **triggered e-mail** that you make once in Wix (the steps are just below). One locked collection, **RDComms**, is made the first time a director or lead opens the tab (if you prefer to make it by hand, give it the text columns `event`, `kind`, `ref`, `sub`, `who`, `status`, `why`, `json`, `by` and `at`, and set all four permissions to Admin).

**What it does.** You write a message once, choose who it goes to (runners or volunteers, narrowed by category, payment, bib, wave, result, waiver or volunteer status), press **Prepare** to fix the list of people, and then **send e-mails** (Wix sends them, one person at a time, with a log) or **open WhatsApp chats** with the text ready. Nothing goes out by itself: a director presses each button. RaceOS does not send WhatsApp or SMS on its own and has no AI drafting; you write the words, or edit one of the five ready-made messages.

**Who can do what** (the server decides, the screen only mirrors it): a **director** writes messages, prepares and sends, opens the WhatsApp chats, downloads a file of people and sends a test. A **lead** can only look: the messages, a preview, how many people a message would reach, and how a batch went. A lead never sees an e-mail address or a phone number, and sends nothing. Viewers, desk staff, coaches and sponsors do not see the tab and are refused if they ask. Everything belongs to one race: pick the race at the top as everywhere else and nothing leaks to another race.

### Make the Wix e-mail (once, in Wix)
Wix sends the e-mails; RaceOS does not design them. You design the look once (logo, colours, footer) and RaceOS fills the words in for each person. Every message you send uses this one e-mail.
1. In Wix open **Developer Tools > Triggered Emails** (it is also in the code sidebar under **Developer Tools**) and click **+ New Campaign**.
2. Design the e-mail. Add one text box for each paragraph, one under the other (six boxes is the default; see "How many paragraphs" below).
3. Click into the first text box, click **+ Add Variable**, name it exactly `p1` (small letters) and press **Add**. Do the same for the next boxes: `p2`, `p3`, `p4`, `p5`, `p6`. Leave the **Fallback value** blank, or type a single space.
4. Add one more variable named exactly `subject` and put it in the **subject line** of the e-mail. (Wix lets you put a variable in the subject line but not a fallback value. If your editor offers no way to put a variable in the subject line, keep a fixed subject line and put `subject` as a heading at the top of the e-mail instead.)
5. Click **Preview & Test** if you like, then **Save & Continue**. The first time, Wix asks for the **sender's name** and a **reply-to e-mail**. Use an address on your own domain if you have one: e-mails with a Gmail or Yahoo reply-to address tend to land in spam.
6. On the next window change the **Email ID** to something short you will recognise, for example `vtra_message` (letters, digits, dashes and underscores only), and press **Save**. Then **publish** the e-mail: a draft is never sent.
7. In RaceOS open **People > Messages > Settings**. Type the same ID in **Wix e-mail ID**, check **Paragraph places in the Wix e-mail** (6 unless you made a different number of `p` variables), check **Country code for phone numbers** (91 for India) and press **Save**. The pill next to the button changes from "E-mail is not set up yet" to "E-mail is set up".
8. Still in Settings, under **Check it**, choose a message, type your own address in **Send a test** and press **Send the test**. It arrives within a minute with made-up details and `[TEST]` in front of the subject. Check the look on a phone.

Wix counts every e-mail against the site's monthly Email Marketing balance (triggered e-mails keep sending even after the balance is used up). A runner who is not yet a contact in Wix is added as a contact (name and e-mail only) so that Wix can send to them. Anybody who has asked Wix not to get e-mails is left out and shown as "left out".

**How many paragraphs.** A message is cut at every blank line into paragraphs, and the e-mail has a place for each: `p1`, `p2`, and so on. If a message has more paragraphs than the e-mail has places, the extra ones are joined into the last place (the preview says so). A place a message does not use is sent as an empty space. The Settings box **Paragraph places in the Wix e-mail** says how many `p` variables your Wix e-mail has (1 to 12); keep the two numbers the same. A paragraph is cut at 1,200 letters and a message at 4,000; the preview says when something would be cut. Look at the test e-mail to see how a line break inside a paragraph looks in your design: if Wix shows it as a space, put a blank line between the two lines instead.

### The four screens
| Screen | What it does |
|---|---|
| Send | Choose the message and who it goes to, see how many people that is and who they are (names, bibs, a tick for an address and for a number, never the address itself), then prepare and send. A lead sees this as **Who gets it**, with the counting only. |
| History | Every batch prepared for this race: when, which message, who, how, how many people. **Open** shows how it went and who was not reached. |
| Templates | The messages: edit, preview (**Show how it looks**), write a **New message**, archive. |
| Settings | **E-mail and chat settings** (the Wix e-mail ID, paragraph places and country code for the whole site; the link of this race) and **Check it**, the test e-mail. Directors only. |

**Messages.** Five are ready: **Your bib**, **Race kit collection**, **Race week information**, **Thank you and results** (runners) and **Volunteer reminder** (volunteers). Edit and save one, or write your own with **New message**: a name, who it is for, a subject (up to 120 letters) and the text (up to 4,000). Put a placeholder in curly brackets where a person's own detail goes:
- Runners: `{name}`, `{firstname}`, `{bib}`, `{bibname}`, `{cat}`, `{size}`, `{wave}`, `{start}`, `{corral}`, `{time}`, `{place}`, `{race}`, `{date}`, `{venue}`, `{link}`
- Volunteers: `{name}`, `{firstname}`, `{race}`, `{date}`, `{venue}`, `{link}`

A placeholder the message does not know is refused when you save, so a typing slip never reaches a runner. A detail that is not known (no bib yet, no wave, no result) shows as a dash. `{wave}`, `{start}` and `{corral}` come from **Waves & results** (Waves), `{time}` and `{place}` from the imported results, `{bibname}` and `{size}` from the registration. `{link}` is the **Link of this race (where {link} goes)** that you type in Settings for this race (for example the page with the collection details, or the runner page `https://www.vtra.run/runner?ev=RACE_ID`); it must start with `https://`, and a message that uses `{link}` warns you until one is set. Nothing is deleted: **Archive** hides a message from the Send list and keeps it for the History. Each race holds up to 40 messages of its own.

**Who gets it.** For runners: **Payment** (Paid, which is the default; Not paid yet; Paid and not paid), **Category**, **Bib** (With or without a bib, Has a bib, No bib yet), **Result** (Any result, Finished, Did not finish, Did not start, Disqualified, No result yet), **Wave** (In a wave or not, In a wave, Not in a wave yet) and **Waiver** (Signed or not, Has signed the waiver, Has not signed the current waiver). For volunteers: **Status** (Any status, Applied, Approved, Reserve, Declined) and the same **Waiver** choice. "Has not signed the current waiver" includes people who signed only an older text, so a message asking them to sign the new one reaches them; what counts is set on the **Waivers** tab. A runner of a race that has no waiver question and no recorded paper has not signed; a volunteer who accepted the waiver on the sign-up page has. **Leave out people who already got** (a message) skips everybody who was already sent that message, so you can send to the latecomers only; the box **Also include people whose earlier message may not have arrived** brings back the ones who show as "not sure". The screen counts the people, how many have an e-mail address and how many have a phone number, and lists the first few.

**Prepare, then send.** **Prepare to send to N people** fixes the list: the people are found at that moment and kept (up to 5,000 in a batch); nothing is sent yet. A person with no e-mail address (or no usable phone number, for WhatsApp) is counted as "left out". Then:
- **E-mail.** Press **Send e-mails to N people**, then **Sure? Send now** (a second press, so a slip of the finger cannot send). The page sends in small groups and shows how far it has got; keep the page open. **Stop** pauses after the current group; **Resume** carries on with the people not yet handled. If several e-mails in a row fail, it stops by itself: send a test from Settings to see why (usually the Wix e-mail ID is wrong or the e-mail is not published).
- **WhatsApp.** **Show the chats** lists the people with an **Open chat** button each: it opens WhatsApp with the message ready. You press Send in WhatsApp yourself, come back and press **Mark as sent** (or **Mark everybody on this page as sent**). A ten-digit number gets the country code from Settings; a number that cannot be a mobile number shows "No number". Opening the chats is written to the audit trail (who and how many, never the numbers).
- **A file of these people** (**Download the file**). The CSV of the people chosen on the Send screen, with the columns you tick (name, bib, category, T-shirt size, e-mail, phone, wave, start, corral), for a mail merge or a print list. It can hold addresses and numbers, so keep it safe: each download is written to the audit trail. A cell that would start a formula in a spreadsheet is made harmless.

**Safe to repeat.** A batch is sent **at most once to each person**: the log row of a person is made before the e-mail goes out, so two directors pressing Send together, a second tab, a lost connection or a repeated press never send twice; they only count the person as already handled. If the connection breaks at the very moment an e-mail is going out, that person shows as **not sure** and is never sent again by itself: look in Wix, and if it did not go, press **Prepare a retry** (it opens Send with "Leave out people who already got this message" chosen for you) and tick **Also include people whose earlier message may not have arrived**. A person who failed can be retried the same way, without the tick. A double press on Prepare makes one batch, not two. A batch keeps its people **and its words** as they were when you pressed Prepare, so editing a message afterwards changes nothing in a batch that is already prepared (prepare a new one to use the new words); details such as the wave, the result and the race link are read at the moment each e-mail is made.

**Privacy.** The log (RDComms) holds ids and states only: no e-mail address, no phone number, no message text, no name. The History and the failure list show a name and a bib, never an address or a number. Only the WhatsApp chats and the CSV carry contact details; both are for directors only and both are written to the audit trail without the details. A name a runner typed never becomes markup: it is shown as plain text on every screen and in every e-mail. The test e-mail uses made-up details and goes to an address you type (5 an hour for a race); the address is not kept.

**In what order to use it**
1. Make the Wix e-mail and send yourself a test (once).
2. For each race, in **Settings**, type the **Link of this race** if your messages use `{link}`.
3. **Your bib** after bibs are assigned (Registrations or **Bibs and sync**): Runners, Payment: Paid, Bib: Has a bib.
4. **Race week information** after the waves are placed on **Waves & results**: Runners, Payment: Paid, Wave: In a wave.
5. **Thank you and results** after the results are imported: Runners, Result: Finished. Later, for the latecomers only, choose the same message under **Leave out people who already got**.

**Limits to know**
- E-mail goes through one Wix triggered e-mail (one look for every message). There is no open or click report in RaceOS: Wix shows its own statistics under Triggered Emails.
- A batch holds up to 5,000 people. The page must stay open while e-mails go out; if it closes, press **Resume**.
- WhatsApp is one chat per person that you send yourself; there is no automatic WhatsApp or SMS.
- Reports come with the next package.
- The /rd page accepts replies to its calls from any frame on the same page (see the note under Finance). Keep it free of third-party embedded content.

## Waivers (/rd > People > Waivers)
A **Waivers** tab sits in the **People** group of the menu, right after **Messages**. It uses the same login. The set-up is two backend files, `waivers.web.js` and `rd-waiver.js` (add them **before** you paste the new /rd page code: that code imports `waivers.web.js`, so Wix will not save it until the file exists). One locked collection, **RDWaivers**, is made the first time a director or lead opens the tab (if you prefer to make it by hand, give it the text columns `event`, `kind`, `ref`, `sub`, `who`, `status`, `why`, `json`, `by` and `at`, and set all four permissions to Admin).

**What it does.** For each race you write the **waiver text** once (every save is a new version, and an older version is never changed, so what a runner agreed to can always be shown), say which **question of the registration form is the waiver** and which answers count as signed, see **who has signed** (from the form, from the volunteer sign-up page or from a paper), **record papers signed on the day** and **print** the papers: a page for each person with their name, bib and category, one sign-in list with the waiver on top, or blank pages. A record is never deleted: one made by mistake is **marked as a mistake** with a reason, and both stay.

**Who can do what** (the server decides, the screen only mirrors it): a **director** does everything: writes the text, sets the question, records papers, marks a record as a mistake and prints. A **lead** can look, print and record a paper that was signed (a lead often runs the desk), but cannot change the text, the setup or a record. Viewers, desk staff, coaches and sponsors do not see the tab and are refused if they ask. Everything belongs to one race: pick the race at the top as everywhere else.

### The four screens
| Screen | What it does |
|---|---|
| Who has signed | Counts (signed, signed an older version only, not signed; for each category; how they signed), then the people: a name, a bib, a category and where each one stands. **Show** Still to sign, Not signed at all, Signed an older version only, Signed or Everyone; pick a category; **Name or bib** finds a person. Tick people (or **Tick everyone on this page who has not signed**), pick the version they signed, add a short note if you like (for example "paper at the security desk") and press **Record N papers as signed**, then **Sure?**. **Records** shows every record of a person; **Print paper** prints that person's own paper. |
| Waiver text | The saved versions, the latest one in full, and (directors) the form for the next version. **Use the standard wording** puts a ready text in the form; **Back to the latest saved** puts back the latest. |
| Print papers | Runners or volunteers; a page for each person, or one sign-in list; still to sign, everyone, or blank pages (up to 50 copies); one category if you like. Printing goes through the browser's print window. |
| Setup (directors) | Which question of the registration form is the waiver, which answers mean signed (one on each line), **The form shows this version** and **Lowest version that counts as signed**. |

**Writing the text.** A title (up to 80 letters) and a text (20 to 8,000 letters). Put a word in curly brackets where a detail goes: `{race}`, `{date}`, `{venue}` and, on a person's own paper, `{name}`, `{bib}` and `{cat}`. A word in curly brackets that is not one of these is refused when you save, so a typing slip never reaches a runner's paper. Angle brackets and hidden characters are removed. A blank line starts a new paragraph. **Save as version N** saves the next version. If somebody else saved while you were typing, nothing is saved and the screen asks you to reload first, and saving the same words again is refused; what you typed stays in the form. A race holds up to 60 versions. The **volunteer waiver** is fixed: it is the wording of the volunteer sign-up page and has no versions here.

**How "signed" is decided.** Three places count and the best of them wins (the highest version, then the latest):
- **The registration form.** Say which question is the waiver (pick it from the questions of this race's registrations) and which answers mean signed (one on each line; "yes", "i agree" and a few more are suggested). An answer is compared in a plain way: capital letters, extra spaces and a full stop at the end do not matter. **The form shows this version** says which version of the text that question showed (usually 1). The answers themselves are never shown on any screen.
- **The volunteer sign-up page.** A volunteer who accepted the waiver when signing up has signed the volunteer waiver.
- **A paper recorded here.** On the day, tick the people who signed a paper and record it. A runner's paper is recorded against a saved version that still counts (the latest by default); a volunteer's against the volunteer waiver. Only paid runners and volunteers who are not declined are asked. Recording somebody who has already signed that version changes nothing, so pressing the button again after a lost connection is safe. One person can have up to 9 records (the ones marked as a mistake count too); more are counted as "have too many records".

**A new text.** When you save a new version, nobody's record changes. Raise **Lowest version that counts as signed** when everybody must sign the new text: runners who signed an older one are then listed as **signed an older version only** and are in "still to sign" until a paper is recorded for the new version. Leave it where it is when the change is only a typing correction.

**Waiver in Messages.** The **Who gets it** box of Messages has a **Waiver** choice (see Messages). It is read when you press **Prepare**, and the batch keeps its list after that.

**Privacy.** The collection holds ids, versions and the short note staff typed: no phone number, no e-mail address, no date of birth and no name. A list, a record and a printed paper show a name, a bib and a category and nothing else of a registration. Everything a runner typed (a name) is shown as plain text on every screen and printed as plain text. The audit trail notes who saved a text or the setup, recorded papers, marked a record as a mistake and printed, with counts only (never a name or a note). Do not type phone numbers or other private details in a note.

**Limits to know**
- A paper is printed through the browser's print window (no direct printer control). A signed paper is not scanned or attached to anything: staff record that it was signed.
- Nothing is deleted. A record made by mistake stays, marked, with who marked it and why.
- RaceOS does not ask a runner to sign online: the registration form (Wix Events) collects the online agreement and the volunteer sign-up page collects its own.
- Recording takes up to 100 people in one go; the page sends more groups by itself and finishes what the server could not do in time. Keep the page open until it says it is done.
- The /rd page accepts replies to its calls from any frame on the same page (see the note under Finance). Keep it free of third-party embedded content.


## Reports (/rd > Reports)
A **Reports** tab sits in a group of its own, after the **Race day** group. It uses the same login. The set-up is two backend files, `reports.web.js` and `rd-report.js` (add them **before** you paste the new /rd page code: that code imports `reports.web.js`, so Wix will not save it until the file exists). No collection is made: Reports only reads what the other tabs keep.

**What it does.** For the race picked at the top, a report is a few tables of counts and totals. Pick one of six reports; any table can be saved as a **CSV file** (**Save as CSV**) that opens in Excel, Numbers or Google Sheets. A report never shows a name, a bib, a phone number, an e-mail address or a date of birth: those are read to put a person in a group (an age is worked out for the age group and thrown away) and are never copied into a table. Looking at a report changes nothing. The one thing written is a line in the audit trail (`RDAudit`) each time a table is saved as a CSV file: who, which report and table, and how many rows.

**Who can do what** (the server decides, the screen only mirrors it): a **director** runs all six reports. A **lead** runs five: not **Money**. Viewers, desk staff, coaches and sponsors do not see the tab and are refused if they ask.

### The six reports
| Report | Tables |
|---|---|
| Registrations | Summary (registered, paid, not paid or cancelled); By category; By gender; By age group; By T-shirt size; By day of registration. Each table shows how many registered, how many paid and how many have not paid. |
| Race day | Results by category (finished, DNF, DNS, DSQ and the finish rate); Finishing times by category (fastest, median, slowest); Finishers by gender. |
| Volunteers | Volunteers by status (applied, approved, declined, other, and how many accepted the waiver online); Shifts by role (places needed, taken, confirmed, still needed, checked in, hours recorded). |
| Waivers | Runners by category (signed, signed an older version only, not signed); How people signed (registration form, paper on the day, volunteer sign-up page); Volunteers. |
| Messages | Messages sent, failed and skipped (batches prepared, e-mails sent, WhatsApp chats marked sent, failed, skipped, still sending); By template. |
| Money (directors) | Income and expenses; Invoices; Orders (estimate, advance and actual); Reimbursement claims; Budget, estimate and actual by category; Cash. Totals only: nobody is named. |

**Good to know.**
- **Where the numbers come from.** Registrations are counted from the registrations kept for the race (paid means the registration is marked paid). Gender and age groups come from the registration questions you chose in **Waves & results > Setup**: until you choose them, everybody is "Not recorded" and "Age not known". The Race day numbers are the ones on the Waves & results board, the Waivers numbers those on the Waivers tab, and the Money numbers those on Finance, in rupees.
- **A part that cannot be read is named.** If a report needs something that has no data yet or could not be read, the screen says "Not read: ..." and counts it as zero, so a zero is never taken for a real count. If the registrations themselves cannot be read, no report is shown ("Something went wrong") rather than an empty one.
- **Words in a table** are the ones that group people (a category, a T-shirt size, a role, a template). They are cleaned, shown as text and cut at 60 letters. A word that looks like a phone number or an e-mail address is shown as "Other", and so is a T-shirt size that is not a size (too long, no letter, or a long run of digits). Past 400 rows a table is cut; its "Total" row stays and still counts every row, and a note says so.
- **A CSV file is safe to open in a spreadsheet.** Every word is in quotes, and one that starts with = + - or @ gets a ' in front, so a spreadsheet never takes it for a formula. Numbers are written as numbers (rupees with two decimals, a percentage with one). The file starts with a byte-order mark so Excel reads it as UTF-8, and its name is the race, the report and the table in letters, digits and dashes.
- **Days** in "By day of registration" are Indian days.
- **One race at a time.** A report counts the race picked at the top and nothing of any other race.

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
