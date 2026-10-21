# VTRA Race Director: files and setup steps (Wix)

## A. The files and where each one goes

**Backend files** (code sidebar > Backend > add a .web.js file, paste the contents)

| File | Backend file name in Wix | Needs your SETUP_KEY? |
|---|---|---|
| 1-backend/exposoft.web.js | exposoft.web.js | yes |
| 1-backend/racedir.web.js | racedir.web.js | yes |
| 1-backend/training.web.js | training.web.js | yes |

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
2. **Backend.** Add the three backend files. In each, change `const SETUP_KEY = 'change-this-key'` to your own secret.
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
