# Package 2 (Finance): what to change on a site that already runs Package 1

Date: 2026-10-29. Installing for the first time? Ignore this page and follow SETUP.md.
Nothing else changes: the /volunteer, /train and /coach pages stay as they are, and no existing data is touched.

## 1. Add two backend files (do this first)
Code sidebar > Backend:
- `finance.web.js`: **+ > Add a web module**, name it exactly `finance.web.js`, paste the contents of `1-backend/finance.web.js`.
- `rd-finance.js`: **+ > Add a .js file**, name it exactly `rd-finance.js`, paste the contents of `1-backend/rd-finance.js`.

Do this before step 2: the new /rd page code imports `finance.web.js`, and Wix will not save it until that file exists.

## 2. Replace the /rd page
- **Embed:** click the HTML element on /rd (ID `dirFrame`), choose **Enter Code**, select everything, paste `2-pages/rd/rd-embed.html`.
- **Page code:** open the /rd page's code panel, select everything, paste `2-pages/rd/page-code.js`.

## 3. One line in three backend files (sessions with a damaged expiry were never signed out; now they are refused)
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

## 4. Publish and check
1. Publish the site.
2. At /rd log in as a director. A **Finance** tab sits after **Money**. Open **Details** and fill in your organisation's details.
3. Log in as a lead. Finance shows only **Claims**.
4. In the **live** CMS data you should now see `RDInvoices`, `RDOrders`, `RDClaims`, `RDLedger` and `RDFinSet` (made on first use, locked to the site admin).
5. Try a test invoice, a test claim and a test cash withdrawal on a test race, then void them on the Ledger.

What each Finance tab does, and its limits (it is not a GST tax invoice), are in SETUP.md under "Finance".
