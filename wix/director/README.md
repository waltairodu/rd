# Race Director for Wix: Phase 1

Command centre, volunteers (public sign-up, approval, shifts, check-in and hours), race-day run of show and incident log, pacers (pace plan and roster) and a safety checklist. It runs inside your Wix site, next to the Expo desk, and uses the same logins.

## What people see

| Who | Where | What they do |
| --- | --- | --- |
| Public | `/volunteer?ev=RACE_ID` | Pick shifts, give name and mobile, agree to the volunteer terms, get a six-letter code. Can check their status later with code plus mobile. |
| Director (role `admin` or `director`) | `/director` | Everything: races, shifts, approvals, race day, pacers, safety, deletes. |
| Lead (role `lead`) | `/director` | Volunteers, race day, pacers, safety. No creating races, no deleting. |
| Viewer (role `viewer`) | `/director` | Look only. For sponsors and partners. |

Logins are the rows you already keep in the CMS collection **ExpoStaff** (username, password, role). A login with role `desk` works only on the Expo desk.

## Files

| File | Where it goes |
| --- | --- |
| `racedir.web.js` | Code panel, Backend, a web module named `racedir.web.js` |
| `director-embed.html` | HTML embed on the **Director** page, element ID `dirFrame` |
| `director-page-code.js` | That page's code panel |
| `volunteer-embed.html` | HTML embed on the **Volunteer** page, element ID `volFrame` |
| `volunteer-page-code.js` | That page's code panel |

Your Expo files and the findmybib files are not changed.

## Setup (about 20 minutes)

1. Velo is already on if the Expo desk works.
2. **Backend.** Add `racedir.web.js` and paste the file. **Change `SETUP_KEY` near the top to a secret of your own before saving.**
3. **Director page.** New page named Director, permissions **Anyone**. Add an HTML embed (code mode), paste `director-embed.html`, set its ID to `dirFrame`, full width and about 100vh tall. Paste `director-page-code.js` into the page code.
4. **Volunteer page.** New page named Volunteer (URL `/volunteer`), permissions **Anyone**. Embed ID `volFrame`, paste `volunteer-embed.html`, paste `volunteer-page-code.js`. This page needs the Wix `wix-location` import that the page code already has.
5. **Publish.** It works on the published site only.
6. Open `/director`. Under **First-time setup (owner only)** enter the setup key and, only if you have no logins yet, a new admin name and password. It creates the Director collections (locked to Admin). It never changes existing logins.
7. Log in, open **Setup**, create the race. Fill **Expo race ID** with the Import collection of that race (for example `Import910`) so the Overview shows live check-in, bib and T-shirt counts from the Expo desk.
8. Open **Volunteers**, add shifts, then copy the sign-up link. If your volunteer page is not at `https://www.vtra.run/volunteer`, edit the address in the box once; it is remembered in that browser.
9. Add lead and viewer logins in ExpoStaff (role column).

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

From the repository root: `tests/all.sh`. It runs the Expo checks and the Director checks (152 backend scenarios and 55 screen checks), including cases such as two people taking the last spot, a lead trying to delete, a viewer trying to change something, and a volunteer name containing HTML.

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

## Expo desk inside /rd (new)
The /rd page now holds the Expo desk too, behind the same login.
- Paste **`rd-embed.html`** (not `director-embed.html`) into the /rd page. It is the Director page with the Expo desk built in (about 145 KB). Use **`director-page-code.js`** as before: it now also needs the `exposoft.web.js` backend file, because the Expo desk's calls are routed to it.
- **Director or admin logins** see an **Expo desk** tab next to Setup. The desk signs in by itself with the same login (admins still pick a desk). Leads and viewers do not get the tab.
- **Desk logins** (the existing Expo staff, locked to a desk and race) type their login at /rd and go straight to the Expo desk; they never see the Director. Everything the Expo desk enforces (locked T-shirt size, role per desk, selfie, one login per desk) is unchanged, because it is the same Expo code and backend.
- Logging out of /rd also ends the Expo session.
- `director-embed.html` is the source. After changing it or `wix/expo/exposoft-embed.html`, run `python3 tools/build_rd.py` to rebuild `rd-embed.html` (the tests do this too).
- The stand-alone Expo page keeps working, so you can keep it as a fallback, or if Wix refuses a page that large, keep using `director-embed.html` on /rd and the stand-alone Expo page.

## Planning: tasks, money, approvals, ceremonies, logistics (new)
Five tabs hold everything a race director tracks, all in one collection, **RDPlan** (created automatically at the first login after you publish; if you prefer to make it by hand, give it these text columns: event, kind, title, cat, phase, status, owner, party, contact, due, time, amount, amount2, ref, link, notes, order, by, at, and make it Admin-only).

| Tab | What it holds |
|---|---|
| Plan | Tasks from 90 days out to the debrief; lessons (what worked, what to fix, ideas) |
| Money | Budget (costs and income, planned and actual, by category) and sponsors (lead to received, what you owe them) |
| Approvals | Permits (police, municipal, forest, fire, insurance...) and race-day sign-offs, with who signed and when |
| Ceremonies | Programme before, during and after the race |
| Logistics | Supplies (needed and have, short quantities), contacts and vendors, document links |

A new race starts with a starter list for tasks, budget, supplies, approvals, ceremonies and contacts. On older races, press **Load the starter list** in an empty section.
Who can do what: directors read and write everything and delete; leads read money and write everything except money; viewers read everything except money and contacts (phone numbers). Overview shows overdue items, permits not approved, race-day sign-offs due, short supplies and overspend. Each list downloads as CSV.


## AI and Expo integration (new)
- `ai-core.js` talks to the Anthropic API; the key lives in Wix Secrets Manager as `ANTHROPIC_API_KEY`. Everything has a rule-based fallback.
- Director methods: `aiStatus`, `aiBriefing` (rule-based, or `write:true` for AI), `aiForecastNow`, `aiAsk`, `aiDraftKinds`, `aiDraft`. Training methods: `coachInsight`, `myInsight`.
- Expo methods: `expoRaces`, `saveBibPlan`, `assignBibs`, `setBib`, `sendToExpo`, `expoSummary`. Rules are described in docs/SETUP.md.
- Tests: `ai.mjs`, `expo-int.mjs`, `bibs-ai-ui.mjs`, `training-ai.mjs`.
