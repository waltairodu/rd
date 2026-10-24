# VTRA Race Director: files and setup steps (Wix)

## A. The files and where each one goes

**Backend files** (code sidebar > Backend > add a .web.js file, paste the contents)

| File | Backend file name in Wix | Needs your SETUP_KEY? |
|---|---|---|
| 1-backend/exposoft.web.js | exposoft.web.js | yes |
| 1-backend/racedir.web.js | racedir.web.js | yes |
| 1-backend/training.web.js | training.web.js | yes |
| 1-backend/ai-core.js | **ai-core.js** (a plain backend file, not .web.js; racedir.web.js and training.web.js import it) | no |
| 1-backend/rd-approvals.js | **rd-approvals.js** (a plain backend file, not .web.js; racedir.web.js imports it. It holds the approvals library and the letter writer) | no |

**Pages** (each page: add an HTML element, paste the embed, set the element ID, paste the page code)

| Page URL | Embed to paste into the HTML element | Element ID | Page code to paste |
|---|---|---|---|
| /rd | 2-pages/rd/rd-embed.html | dirFrame | 2-pages/rd/page-code.js |
| /volunteer | 2-pages/volunteer/volunteer-embed.html | volFrame | 2-pages/volunteer/page-code.js |
| /train | 2-pages/train/athlete-embed.html | trainFrame | 2-pages/train/page-code.js |
| /coach | 2-pages/coach/coach-embed.html | coachFrame | 2-pages/coach/page-code.js |

Optional: the stand-alone Expo desk page (also still works). Embed 2-pages/expo-standalone/exposoft-embed.html, element ID expoFrame, page code 2-pages/expo-standalone/page-code.js.

## B. Steps

1. **Prepare the site.** Wix Dev Mode on. Wix Events installed (it already is, for your tickets).
2. **Backend.** Add the three `.web.js` files, then the two plain files `ai-core.js` and `rd-approvals.js` (exact names). In each `.web.js` file, change `const SETUP_KEY = 'change-this-key'` to your own secret.
3. **Pages.** Create /rd, /volunteer, /train, /coach. On each: Add Elements > Embed Code > Embed HTML > Code, paste the embed file; make the element full width and about 1200 px tall; set its ID (Properties panel); paste the page code in the page's code panel.
   - If Wix refuses the large /rd embed, use `director-embed.html` (from the repo, wix/director) on /rd instead and keep the stand-alone Expo page. Nothing else changes.
4. **Publish** the site.
5. **First login at /rd.** Use your existing Expo admin login. If you have none, open "First-time setup (owner only)" on the login screen and enter the setup key plus a new admin username and password. Check the new collections exist in the **live** CMS data.
6. **Staff logins.** Add rows to the ExpoStaff collection. Role column: `director`, `lead`, `viewer` (Director), `coach` (Coach desk), or leave role empty with a desk and race for Expo desk staff.
7. **CMS column.** Add a text column `bibName` to the Runners collection.
8. **Create the race** (/rd > Setup): name, date, venue, distance. Expo race ID only if you use the Expo desk.
9. **Registrations** (/rd > Registrations): Load my Wix events, pick the event, Link. Open Form fields, choose the T-shirt size, bib name and phone fields, Save. Press Import / refresh.
10. **Qualification** (/rd > Qualification): one rule per line, for example `110 K | Marathon under 6 hrs, or any 50 km+ | 42.195@6:00; 50@`.
11. **Volunteers** (/rd > Volunteers): add shifts (roles are suggested), then Copy link and share it.
12. **Training** (/coach): log in as admin. The first login creates the collections and three starter 8-week plans. Check Settings. Then open /train on a phone and sign up as a test athlete.
13. **Expo desk** (/rd > Expo desk, or the stand-alone page): Setup tab > Check data, and send the Columns line to Claude.
14. **Test** with a test race, a test volunteer and a test athlete before announcing. Send any error text with the page name.

## Planning tabs
After publishing, log in once at /rd: the RDPlan collection is created by itself. Create a new race to get the starter lists, or open an existing race and press "Load the starter list" in each empty section (Plan, Money, Approvals, Ceremonies, Logistics). No new page or element is needed.


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
