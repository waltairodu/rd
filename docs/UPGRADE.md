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
