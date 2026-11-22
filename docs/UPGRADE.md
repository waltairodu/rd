# Package 6d (the Wix build error): what to change on a site that runs Package 6c

Date: 2026-11-22. Use this when Wix's build report (build.log) lists `no-undef: 'globalThis' is not defined` for the backend files, or when /rd says "Something went wrong (Error: Unable to handle the request ...)". **Only the 11 backend files change.** The page codes, the HTML embeds and the database stay as they are: do not touch them.

**What was wrong.** When you click **Publish**, Wix checks every code file with two ESLint rules (`no-undef` and `no-const-assign`). It did not know the name `globalThis`, which the login code inside every backend file used to reach the platform's secure random generator, so it reported one error in each of the 11 files. A file with an error can end up left out of the build, and then every call to it fails: the login said "Unable to handle the request". The tests had not seen it, because they run in Node, where `globalThis` exists. The login code now says `crypto` and carries the comment that tells Wix's check the name is provided; nothing else in the code changed. The tests now run the same two rules with ESLint itself over the 11 files and the 5 page codes (`tests/wixcheck.mjs`), and the line Wix rejected is rejected there too.

1. **Paste the 11 backend files again, each one whole.** In the Backend list click the file, press Ctrl+A, press Delete, paste the new file, and check that the last line reads `// END` and the file's own name. The names do not change.
2. **Save, then Publish.** If a pop-up says errors were found in the code, choose **View build.log**. The 11 files must no longer be in it (check 6 in SETUP.md).
3. **Clear the other errors in the report.** Lines such as `Cannot find module 'backend/expo.web'` (page `EXPO`) or `Cannot find module 'backend/bibLookup.web'` (page `DCB VHM Frame`) are about older pages of your own whose backend files are gone. On such a page delete the import line and the code that uses it, or delete the page, or restore the file if you still use it (SETUP.md, check 6). Publish again: the report should list nothing.
4. **Sign in** at `https://www.vtra.run/rd` (the published address, not Preview) as `master`.

---

# Package 6c (one self-contained file per web module): what to change on a site that runs Package 6b or older

Date: 2026-11-20. Installing for the first time? Ignore this page and follow SETUP.md ("Quick start: run it and log in").
Use this when /rd says "The backend file is out of date" or "No answer from the server" even after you pasted the backend files, or when the volunteer page says "Something went wrong". **The 11 backend files and the five pages are replaced, and the 11 old helper files are deleted.** No data is touched. The database is already made on vtra.run (37 collections, locked to the site admin): see SETUP.md, section D.

**What changed**
- **11 backend files instead of 22.** Before, each web module imported plain helper files (`rd-auth.js`, `ai-core.js`, `rd-privacy.js` and eight more). If one helper was missing, misnamed or half pasted, every module that imported it did not load, and every method in it looked missing. Now each web module is one file that holds everything it needs and imports only Wix's own modules. There are no helper names to get wrong, no order to paste in, and half as many files.
- The files in `1-backend/` are made by a build step from the same source that the tests run against (`tools/inline_backend.mjs`). The tests check each built file: it parses, imports nothing of ours, exports the same methods as its source, and ends with its `// END` line.
- /rd's red sentence is simpler: it names the web module that does not answer and says to paste it again (`racedir.web.js has none of its 73 methods: paste racedir.web.js again, then save and publish`). When none of the ten answers it says so in one line.
- The **database** is made and checked: 37 collections exist on your site, all locked to the site admin (nobody can read or write them from a page). The `ExpoStaff` collection, which holds the logins, was set to world-readable and still held the old plain-text passwords; that is closed. `3-database/COLLECTIONS.md` lists every collection.
- A `master` login (role admin) exists, so you can sign in without the First-time setup form. Change its password on the Team screen at once.

What this pack cannot prove: it was tested here against a copy of the Wix modules, not on your live site. Three things are unproven on the live site: that Wix accepts files of this size (the largest is `racedir.web.js`, about 320 KB), that the one dynamic `import('wix-events.v2')` line in `racedir.web.js` is accepted (SETUP.md, check 6, has a two-line replacement if it is not), and that Wix's build makes a callable method of every `webMethod` export. If /rd still shows the red sentence after the steps below, the sentence in brackets (and SETUP.md, "If a page shows an error") says what to check first.

## 1. Replace the 11 backend files
Code sidebar > Backend. For each file in `1-backend/`: open the file with the same name, press Ctrl+A, paste the new contents. A file that does not exist yet: **+ > Add a web module**, named exactly as in `1-backend/` (it must end in `.web.js`). There is no order to follow.
- `racedir.web.js` and `training.web.js` each hold a line `const SETUP_KEY = '...'` near the top. Copy yours before you paste, and put it back in place of `'change-this-key'` (training's is only for its optional manual setup).
- After each paste press Ctrl+End: the last line must read `// END` and the file's own name. If it does not, select everything, delete, and paste again.
- No import line at the top of a web module may be underlined in red.

## 2. Delete the 11 old helper files
**Only after step 1.** In the Backend list, right-click and delete each of these: `rd-auth.js`, `ai-core.js`, `rd-approvals.js`, `rd-finance.js`, `rd-results.js`, `rd-print.js`, `rd-data.js`, `rd-comms.js`, `rd-waiver.js`, `rd-report.js` and `rd-privacy.js`. The new files do not use them, and an old one that is only half pasted can stop Wix's build.

## 3. Replace the five pages
For each page: the HTML element (**Enter Code**: select everything, paste the embed) and the page code (code panel of that page: select everything, paste `page-code.js`).
- /rd (element `dirFrame`): `2-pages/rd/rd-embed.html` and `2-pages/rd/page-code.js`
- /volunteer (element `volFrame`): `2-pages/volunteer/volunteer-embed.html` and `2-pages/volunteer/page-code.js`
- /train (element `trainFrame`): `2-pages/train/athlete-embed.html` and `2-pages/train/page-code.js`
- /coach (element `coachFrame`): `2-pages/coach/coach-embed.html` and `2-pages/coach/page-code.js`
- /runner (element `runFrame`): `2-pages/runner/runner-embed.html` (its page code is unchanged)

**Do not make the volunteer page by duplicating /rd.** A copy carries the Director page code, and the volunteer screen then cannot work. If your volunteer page is a copy of /rd, add a new page instead, with the volunteer embed in an HTML element whose ID is `volFrame`.

## 4. Save, publish, and test at the real address
1. Click **Save**, then **Publish**. If a pop-up says errors were found in the code, choose **View build.log**, not "Proceed with publishing": a file with an error can end up left out and then looks empty. The report names the file (SETUP.md, "If a page shows an error", check 6). You can open it after any publish: Developer Tools > Latest build > `build.log`.
2. Open https://www.vtra.run/rd (not an address that ends in `?rc=test-site`, which is the preview) and sign in as `master` (or as a director). The Dashboard opens. Change the `master` password on the Team screen.
3. **Registrations**: Load my Wix events lists your Wix events. If Wix Events cannot be reached this screen alone says "Wix Events did not answer"; everything else keeps working.
4. Open the volunteer page at its real address: the races are listed.
5. A screen that still says "The backend file is out of date" or "This page's code is out of date" has a sentence in brackets: it names the file or the method. SETUP.md, "If a page shows an error", says what each one means.
6. **Give the seven older logins new passwords** (`admin`, `director`, `lead1`, `coach1`, `desk1`, `user1`, `user2`): Team > the person > New password. Their old passwords are still stored as plain text until each person signs in once.

# Package 6b (backend files that do not load): what changed, for the record

The steps of Package 6b are replaced by Package 6c above. 6b added the end line on every backend file, the "If a page shows an error" section and the build-report check, and made the Wix Events import lazy. 6c keeps all of that.

# Package 6 (Privacy): what to change on a site that already runs Package 5c

Date: 2026-11-15. Installing for the first time? Ignore this page and follow SETUP.md.
Two new backend files, two existing backend files replaced, and the /rd embed and page code replaced. No collection is made and no existing data is touched: a phone number or an e-mail address is hidden on its way to the screen, and the rows keep the full number. The only change Privacy ever makes to your data is when a director erases a person on the new **Privacy** tab (and then only the rows the director ticked); everything else it writes is a line in the audit trail.

**Before race day: your Wix plan.** Wix limits the number of database items a site may hold and refuses new rows at the limit (Business: 20,000). A race of 1,000 runners uses about 12,500. Read SETUP.md section C and check CMS > More Actions > Data storage first. This package changes nothing about it.

**Which package does your site run?** If /rd has a **Reports** tab, it runs Package 5c: follow the steps just below. If it has no such tab, it runs an older package: do the older steps at the bottom of this page first (Package 5c, then 5b, then 5a, then 4, then 3, then 2), then these. The /rd embed, page code and the two replaced backend files are changed only once, with the files from this pack.

## 1. Add two backend files (do this first)
Code sidebar > Backend:
- `rd-privacy.js`: **+ > Add a .js file**, name it exactly `rd-privacy.js`, paste the contents of `1-backend/rd-privacy.js`.
- `privacy.web.js`: **+ > Add a web module**, name it exactly `privacy.web.js`, paste the contents of `1-backend/privacy.web.js`.

Do this before steps 2 and 3: `racedir.web.js`, `exposoft.web.js` and the new /rd page code import these files, and Wix will not save them until the files exist. Both new files use files you already have (`rd-auth.js`, `rd-results.js`, `rd-data.js`).

## 2. Replace two backend files
Open each in the Backend list, select everything and paste the version from this pack (`1-backend/...`):
- `exposoft.web.js` (the Expo desk now gets the runner's phone number and e-mail address hidden; a person who was erased is not refilled). It holds no key of your own, so nothing to type again.
- `racedir.web.js`. **It holds your own `SETUP_KEY`**: before you paste, copy your line `const SETUP_KEY = '...'` from the old file, and after pasting put it back in place of `const SETUP_KEY = 'change-this-key'`. (The key is used only by the first-time setup screen; if you lose it, type a new one.)

What changed in them, for anyone who wants to check (nothing else is different from Package 5c):
- `racedir.web.js`: one new import line (`rd-privacy.js`); the registration list, the volunteer list and the pacer list send the hidden number or address instead of the full one; a pacer saved with an empty phone box (or one that still holds the dots) keeps the number it has, and an erased pacer is never edited back to life; the example answers on the form-fields screen hide a number or an address; Import / refresh skips a registration that was erased; **Send to Expo desk** skips it too.
- `exposoft.web.js`: one new import line; a runner's phone number and e-mail address go to the desk hidden; a findmybib sync does not refill a runner that was erased.

## 3. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`. The Expo desk is part of this embed: it is replaced with it.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 4. Publish and check
1. Publish the site.
2. At /rd log in as a director. **Registrations**: the phone and e-mail columns now show dots (for example `••••••2345` and `a•••@g•••.com`) and a **Show** button. **Volunteers** and **Pacers** hide their phone numbers the same way.
3. Press **Show** on one phone number. A box asks **Why do you need it** with five reasons. Pick one and press Show: the number appears for 30 seconds with a **Hide** button, then the dots come back (they also come back when you leave the tab, change the race or log out). In the **live** CMS open `RDAudit`: a new line "reveal phone" with your login, the race and the row and reason. There is no number and no name in it.
4. **Volunteers**: the WhatsApp link of a volunteer appears only while that volunteer's number is shown. **Pacers**: press **Edit** on a pacer and **Save** without touching the phone box: the number is unchanged.
5. **Admin > Privacy** (directors only; a lead has no such tab but can press Show). Three cards: **Files with contact details**, **Erase a person**, **Who looked**. Pick a reason and press **Registrations**: a CSV file with the full phone numbers and e-mail addresses is saved and opens in Excel with the right columns. `RDAudit` has a line "contacts exported". **Who looked** lists the newest notes, with the person's name taken from the registration, never from the note.
6. Try **Erase a person** on a **test** registration only: type its 10-digit number, press Find, tick the row, type `ERASE`, press Erase. The registration now reads "(erased)", keeps its bib, ticket, category and size, and has no phone, e-mail or form answers. Press **Import / refresh**: the person is skipped, not brought back.
7. Log in as a **lead**: Show works, there is no Privacy tab. Log in as a **viewer**, **coach**, **sponsor** and a **desk** login: no Show button anywhere. At the Expo desk the runner's phone number and e-mail address are dots; the search box finds a runner by name, bib number or the **last four digits** of the phone number.
8. If a screen says "This page's code is out of date" or "The backend file is out of date", step 1, 2 or 3 was missed or not published: repeat it.

What is hidden, who may show it, the limits, the files and what erasing does are in SETUP.md under "Privacy".

---

# Package 5c (Reports): what to change on a site that already runs Package 5b

Date: 2026-11-11. Installing for the first time? Ignore this page and follow SETUP.md.
Two new backend files and the /rd embed and page code replaced. No existing backend file changes, no collection is made and no existing data is touched: Reports only reads what the other tabs already keep. The one thing it ever writes is a line in the audit trail each time a table is saved as a CSV file.

**Which package does your site run?** If /rd has a **Waivers** tab, it runs Package 5b: follow the steps just below. If it has no such tab, it runs Package 5a or older: do the older steps at the bottom of this page first (Package 5b, then 5a, then 4, then 3, then 2), then these. The /rd embed and page code are replaced only once, with the files from this pack.

## 1. Add two backend files (do this first)
Code sidebar > Backend:
- `reports.web.js`: **+ > Add a web module**, name it exactly `reports.web.js`, paste the contents of `1-backend/reports.web.js`.
- `rd-report.js`: **+ > Add a .js file**, name it exactly `rd-report.js`, paste the contents of `1-backend/rd-report.js`.

Do this before step 2: the new /rd page code imports `reports.web.js`, and Wix will not save it until that file exists. Every other backend file (`racedir.web.js`, `finance.web.js`, `results.web.js`, `comms.web.js`, `waivers.web.js` and the rest) stays exactly as it is.

## 2. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 3. Publish and check
1. Publish the site.
2. At /rd log in as a director. A **Reports** tab sits in a group of its own, after the **Race day** group and before **Admin**. Open it: six buttons across the top (Registrations, Race day, Volunteers, Waivers, Messages, Money) and a card that says "Pick a report".
3. Pick **Registrations** on a race you know. The counts by category, gender, age group, T-shirt size and day should match what the Registrations tab shows. Look for a name, a bib, a phone number, an e-mail address or a date of birth anywhere on the screen: there is none.
4. Press **Save as CSV** on one table. A file such as `vizag-half-marathon-reg-cats.csv` is saved and opens in Excel or Numbers with the right columns. In the **live** CMS data open `RDAudit`: a new line "report saved as CSV" with your login, the race, and the report, table and row count.
5. Pick **Money** and compare "Total income" and "Net so far" with the Finance tab. Pick **Race day** and compare the finishers with the Waves & results board.
6. Log in as a lead: five reports, no Money button. A viewer, desk, coach or sponsor login does not see the tab.
7. If a report says "Not read: ..." under its title, the part it names has no data yet (or could not be read) and is counted as zero.

What each report holds, the privacy rules and the limits are in SETUP.md under "Reports".

---

# Package 5b (Waivers): what to change on a site that already runs Package 5a

Date: 2026-11-09. Installing for the first time? Ignore this page and follow SETUP.md.
Two new backend files, three existing backend files replaced with the versions in this pack (a few lines changed in each, for the new **Waiver** choice of Messages), and the /rd embed and page code replaced. No existing data is touched. One new locked collection, `RDWaivers`, is made the first time a director or lead opens the new tab.

**Which package does your site run?** If /rd has a **Messages** tab, it runs Package 5a: follow the steps just below. If it has no such tab, it runs Package 4 or older: do the older steps at the bottom of this page first (Package 5a, then 4, then 3, then 2), then these. The /rd embed and page code are replaced only once, with the files from this pack.

## 1. Add two backend files (do this first)
Code sidebar > Backend:
- `waivers.web.js`: **+ > Add a web module**, name it exactly `waivers.web.js`, paste the contents of `1-backend/waivers.web.js`.
- `rd-waiver.js`: **+ > Add a .js file**, name it exactly `rd-waiver.js`, paste the contents of `1-backend/rd-waiver.js`.

Do this before steps 2 and 3: the new `comms.web.js` and the new /rd page code import these files, and Wix will not save them until the files exist.

## 2. Replace three backend files
Open each of these in the Backend list, select everything and paste the version from this pack (`1-backend/...`). Do `rd-data.js` and `rd-comms.js` first, then `comms.web.js`:
- `rd-data.js` (one new line: the name of the waivers collection),
- `rd-comms.js` (the Waiver choice of "Who gets it"),
- `comms.web.js` (reads who has signed, only when a message asks for it).

All other backend files (`racedir.web.js`, `finance.web.js`, `results.web.js`, `print.web.js`, `runner.web.js`, `rd-print.js` and the rest) stay exactly as they are. Your message templates, settings and history are not touched.

## 3. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 4. Publish and check
1. Publish the site.
2. At /rd log in as a director. A **Waivers** tab sits in the **People** group of the menu, right after **Messages**. Open it: its four screens are **Who has signed**, **Waiver text**, **Print papers** and **Setup**.
3. In **Waiver text** press **Use the standard wording**, check the text and press **Save as version 1**. In **Setup** pick the question of your registration form that is the waiver, type which answers mean signed (one on each line), then save. In **Who has signed** the registered runners now show who agreed on the form.
4. Rehearse on a test race: tick yourself and press **Record 1 paper as signed**, then **Sure?**. You move to "Signed". Press it once more: nothing changes. Open **Records** for yourself, mark the record as a mistake with a reason and you go back to "Not signed at all".
5. In **Print papers** print one page for yourself and one blank page. The paper holds a name, a bib and a category, and no phone number or e-mail address.
6. In **Messages** > **Who gets it** the new **Waiver** choice (Signed or not, Has signed the waiver, Has not signed the current waiver) is there. Pick "Has not signed the current waiver" and the count is the people still listed in "still to sign".
7. In the **live** CMS data you should now see `RDWaivers` (made on first use, locked to the site admin).
8. Log in as a lead: the tab shows **Who has signed**, **Waiver text** (read-only) and **Print papers**; a lead can record a paper and print, and cannot save a text, change the setup or mark a record as a mistake. A viewer, desk, coach or sponsor login does not see the tab.

What each screen does, how "signed" is decided, the privacy rules and the limits are in SETUP.md under "Waivers".

---

# Package 5a (Messages): what to change on a site that already runs Package 4

Date: 2026-11-06. Installing for the first time? Ignore this page and follow SETUP.md.
Nothing existing is edited by hand this time: two new backend files, one triggered e-mail made in Wix, and the /rd embed and page code are replaced with the files from this pack. No existing data is touched and no existing backend file changes.

**Which package does your site run?** If /rd has a **Bibs & certificates** tab, it runs Package 4: follow the steps just below. If it has no such tab, it runs Package 3 or older: do the older steps at the bottom of this page first (Package 4, then 3, then 2), then these. The /rd embed and page code are replaced only once, with the files from this pack.

## 1. Add two backend files (do this first)
Code sidebar > Backend:
- `comms.web.js`: **+ > Add a web module**, name it exactly `comms.web.js`, paste the contents of `1-backend/comms.web.js`.
- `rd-comms.js`: **+ > Add a .js file**, name it exactly `rd-comms.js`, paste the contents of `1-backend/rd-comms.js`.

Do this before step 3: the new /rd page code imports `comms.web.js`, and Wix will not save it until that file exists. `rd-print.js`, `rd-results.js`, `rd-data.js`, `rd-auth.js` and the other existing files stay exactly as they are.

## 2. Make the Wix e-mail (once)
RaceOS sends every message through one Wix **triggered e-mail**. In Wix: **Developer Tools > Triggered Emails > + New Campaign**. Design the look, add a text box for each paragraph and put a variable named `p1`, `p2` ... `p6` in them (**+ Add Variable**, small letters, blank fallback), put a variable named `subject` in the subject line, save the sender details, change the **Email ID** to something short such as `vtra_message`, and **publish** it (a draft is never sent). The full steps, with what to do if your editor will not take a variable in the subject line, are in SETUP.md under "Messages > Make the Wix e-mail". Keep the e-mail ID for step 4.

## 3. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 4. Publish and check
1. Publish the site.
2. At /rd log in as a director. A **Messages** tab sits in the **People** group of the menu, right after **Volunteers**. Open it: **Send** shows the five ready-made messages, and **Settings** says "E-mail is not set up yet".
3. Open **Settings**, type the e-mail ID from step 2 in **Wix e-mail ID**, check **Paragraph places in the Wix e-mail** (6 unless you made a different number of `p` variables), check **Country code for phone numbers** (91 for India) and press **Save**. The pill changes from "E-mail is not set up yet" to "E-mail is set up".
4. Still in Settings, under **Check it**, use **Send a test** with your own address. It arrives with made-up details and `[TEST]` in the subject. Look at it on a phone.
5. In the **live** CMS data you should now see `RDComms` (made on first use, locked to the site admin).
6. Log in as a lead: the tab shows **Who gets it**, **History** and **Templates**, with no addresses, no phone numbers, no Settings and no send button. A viewer, desk, coach or sponsor login does not see the tab.
7. Rehearse on a test race whose only runner is you: prepare **Your bib** for "Payment: Paid, Bib: Has a bib", press **Send e-mails to 1 person**, then **Sure? Send now**: one e-mail arrives. Press **Send e-mails** again: nothing more is sent. Open **History** to see the count.

What each screen does, the placeholders, the limits and the privacy rules are in SETUP.md under "Messages".

---

# Package 4 (Bibs, certificates and the public runner page): what to change on a site that already runs Package 3

Date: 2026-11-02. Installing for the first time? Ignore this page and follow SETUP.md.
Nothing existing is edited by hand this time: four new backend files, one new page, and the /rd embed and page code are replaced with the files from this pack. No existing data is touched and no existing backend file changes.

**Which package does your site run?** If /rd has a **Waves & results** tab, it runs Package 3: follow the steps just below. If it has no such tab, it runs Package 2 or 1: do the older steps at the bottom of this page first (Package 3, then Package 2), then these. The /rd embed and page code are replaced only once, with the files from this pack.

## 1. Add four backend files (do this first)
Code sidebar > Backend:
- `print.web.js`: **+ > Add a web module**, name it exactly `print.web.js`, paste the contents of `1-backend/print.web.js`.
- `runner.web.js`: **+ > Add a web module**, name it exactly `runner.web.js`, paste the contents of `1-backend/runner.web.js`.
- `rd-print.js`: **+ > Add a .js file**, name it exactly `rd-print.js`, paste the contents of `1-backend/rd-print.js`.
- `rd-data.js`: **+ > Add a .js file**, name it exactly `rd-data.js`, paste the contents of `1-backend/rd-data.js`.

Do this before step 2: the new /rd page code imports `print.web.js`, and Wix will not save it until that file exists. `rd-results.js` and the other existing files stay exactly as they are.

## 2. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 3. Make the /runner page (new)
1. Add a page named **runner** (its URL becomes `/runner`) and set its permissions to **Anyone**: the page is public, and the server decides what it may show.
2. Add Elements > Embed Code > Embed HTML > Code, paste `2-pages/runner/runner-embed.html`; make the element full width and about 700 px tall (the page grows to fit by itself).
3. Set the element's ID to `runFrame` (Properties panel).
4. Open the page's code panel and paste `2-pages/runner/page-code.js`.

## 4. Publish and check
1. Publish the site.
2. At /rd log in as a director. A **Bibs & certificates** tab sits in the **Race day** group of the menu, right after **Waves & results**. Open it: you see the designs with a preview, and **Runner page** says "The page is off".
3. Log in as a lead: the tab shows **Bibs** and **Certificates** only (preview and print, no changes). A viewer, desk, coach or sponsor login does not see the tab.
4. In the **live** CMS data you should now see `RDPrint` (made on first use, locked to the site admin).
5. Open `/runner?ev=RACE_ID` before you turn anything on: it says "That race is not showing anything on this page". Then on **Runner page** turn on **Start list**, press Save, and reload /runner: a search for a bib you know shows that runner's wave and start time.
6. Rehearse on a test race: change the bib colour and the title, look at the preview, press **Print all bibs** (choose "Save as PDF" in the print window), and do the same for one finisher's certificate.
7. Look at the page as a runner would on a phone: type a bib, type three letters of a name, type two letters (it asks for three).

What each section does, the limits and the privacy rules are in SETUP.md under "Bibs & certificates".

---

# Package 3 (Waves & results): what to change on a site that already runs Package 2

Date: 2026-10-31. Installing for the first time? Ignore this page and follow SETUP.md.
Nothing else changes: the /volunteer, /train and /coach pages stay as they are, and no existing data is touched.

**Which package does your site run?** If /rd has a **Finance** tab, it runs Package 2: follow the four steps just below. If it has no Finance tab, it runs Package 1: do the Package 2 steps at the bottom of this page first, then these. The /rd embed and page code are replaced only once, with the files from this pack.

## 1. Add two backend files (do this first)
Code sidebar > Backend:
- `results.web.js`: **+ > Add a web module**, name it exactly `results.web.js`, paste the contents of `1-backend/results.web.js`.
- `rd-results.js`: **+ > Add a .js file**, name it exactly `rd-results.js`, paste the contents of `1-backend/rd-results.js`.

Do this before step 2: the new /rd page code imports `results.web.js`, and Wix will not save it until that file exists.

## 2. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 3. One change in `racedir.web.js` (Import / refresh no longer wipes the bib numbers)
Until now, pressing **Import / refresh** on the Registrations tab after the bibs had been assigned replaced each registration with a fresh copy from Wix Events, and the bib numbers went with it. This fixes it: the refresh now keeps everything the team added.

Do not paste the whole file over the old one: `racedir.web.js` holds your own `SETUP_KEY`. Use Find (Ctrl+F), then change that one line.

Find (it occurs once):
`const upd = ids.filter((i) => have.has(i)).map((i) => byId.get(i));`

Replace that line with these two lines:
```
const oldBy = new Map(old.map((o) => [o._id, o]));
const upd = ids.filter((i) => have.has(i)).map((i) => Object.assign({}, oldBy.get(i), byId.get(i)));
```
If you prefer, paste the whole new file instead and type your `SETUP_KEY` again.

**If you pressed Import / refresh after assigning bibs**, the bibs are gone from the registrations (the Expo desk keeps what it already received). On **Bibs and sync**, press **Assign bib numbers** again, then **Send to Expo desk** (it sends new runners only), and compare with what you have handed out. Until this step is done, do not press Import / refresh once bibs are assigned.

## 4. Publish and check
1. Publish the site.
2. At /rd log in as a director. A **Waves & results** tab sits under **Race day**. Open it: Results says "No results yet" and nothing else has changed.
3. Log in as a lead: the tab shows only **Results**, **Awards** and **Start list**. A viewer, desk or coach login does not see it.
4. In the **live** CMS data you should now see `RDResults`, `RDWaveAssign` and `RDResSet` (made on first use, locked to the site admin).
5. Rehearse on a test race: on **Setup** choose the form questions for gender, date of birth and expected finish; on **Waves** add a wave and press **Place runners**; on **Import** paste three lines such as `bib,time` then `101,1:45:30`, press **Check the file**, then **Save results**; look at **Results** and **Awards**; **Fix** one result, **Void** it, **Restore** it.
6. On **Registrations**, press **Import / refresh** on a race whose bibs are assigned: the bibs must still be there afterwards.

What each tab does, the file format for results and the limits are in SETUP.md under "Waves & results".

---

# Package 2 (Finance): only if your site is still on Package 1

Date: 2026-10-29.

## A. Add two backend files (do this first)
Code sidebar > Backend:
- `finance.web.js`: **+ > Add a web module**, name it exactly `finance.web.js`, paste the contents of `1-backend/finance.web.js`.
- `rd-finance.js`: **+ > Add a .js file**, name it exactly `rd-finance.js`, paste the contents of `1-backend/rd-finance.js`.

Do this before replacing the /rd page: the page code imports `finance.web.js`, and Wix will not save it until that file exists.

## B. One line in three backend files (sessions with a damaged expiry were never signed out; now they are refused)
Do not paste the whole files over the old ones: `racedir.web.js` and `training.web.js` hold your own `SETUP_KEY`. In each file use Find (Ctrl+F), then change that one line.

Find:
`if (!sess || Date.parse(sess.expires) < Date.now()) throw new Error('not_logged_in');`
Change to:
`if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');`

It occurs once in `racedir.web.js`, once in `exposoft.web.js` and once in `training.web.js`.
`training.web.js` has a second line, for the athlete login:

Find:
`if (!row || Date.parse(row.expires) < Date.now()) throw new Error('not_logged_in');`
Change to:
`if (!row || !(Date.parse(row.expires) > Date.now())) throw new Error('not_logged_in');`

If you prefer, paste the whole new file instead and type your `SETUP_KEY` again.

## C. Check
At /rd, as a director, a **Finance** tab sits after **Money**; as a lead, Finance shows only **Claims**. In the **live** CMS data you should see `RDInvoices`, `RDOrders`, `RDClaims`, `RDLedger` and `RDFinSet`. What each Finance tab does, and its limits (it is not a GST tax invoice), are in SETUP.md under "Finance".
