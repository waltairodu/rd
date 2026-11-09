# Site map (Wix site www.vtra.run)

| Page | Who | What |
|---|---|---|
| `www.vtra.run` | public | Home. Link to Races, Volunteer, Train. |
| `www.vtra.run/rd` | staff | **Race Director.** Shows the login first. After login: Overview, Volunteers, Messages (People group: templates, who gets what, e-mails and WhatsApp chats; a lead only looks), Waivers (People group: waiver text in versions, who has signed, papers to record and print; a lead can record and print), Race day (with Waves & results and Bibs & certificates), Pacers, Safety, Registrations, Qualification, Finance (director; a lead sees their own claims), and (director only) **Setup = races setup**. Includes the **Expo desk** tab (director/admin) and sends desk logins straight to the Expo desk. Embed `rd-embed.html`, element `dirFrame`. |
| `www.vtra.run/volunteer?ev=RACE_ID` | public | Volunteer sign-up. The link is copied from the Volunteers tab. Embed `volunteer-embed.html`, element `volFrame`. |
| `www.vtra.run/runner?ev=RACE_ID` | public | **Find my bib, start, result and certificate.** A runner types a bib or name; it shows only what a director has switched on in /rd > Bibs & certificates > Runner page. The link is copied from that section. Embed `runner-embed.html`, element `runFrame`, page code `runner-page-code.js`. |
| `www.vtra.run/train` | public | Athlete page: sign up or log in, pick a free plan, log runs, ask for a coach. Element `trainFrame`. |
| `www.vtra.run/coach` | staff | Coach desk: athletes, plans, settings. Element `coachFrame`. |
| Expo desk page (optional) | staff | The stand-alone Expo desk. Still works; now also available inside /rd. |

Flow at `/rd`: Login -> Overview. First time with no race: lands on Setup to create the race (name, date, venue, Expo race link, distance), then links the Wix event in Registrations and sets qualification rules.
