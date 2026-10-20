# Site map (Wix site www.vtra.run)

| Page | Who | What |
|---|---|---|
| `www.vtra.run` | public | Home. Link to Races, Volunteer, Train. |
| `www.vtra.run/rd` | staff | **Race Director.** Shows the login first. After login: Overview, Volunteers, Race day, Pacers, Safety, Registrations, Qualification, and (director only) **Setup = races setup**. Embed `director-embed.html`, element `dirFrame`. |
| `www.vtra.run/volunteer?ev=RACE_ID` | public | Volunteer sign-up. The link is copied from the Volunteers tab. Embed `volunteer-embed.html`, element `volFrame`. |
| `www.vtra.run/train` | public | Athlete page: sign up or log in, pick a free plan, log runs, ask for a coach. Element `trainFrame`. |
| `www.vtra.run/coach` | staff | Coach desk: athletes, plans, settings. Element `coachFrame`. |
| Expo desk page | staff | Existing Expo desk (bibs and T-shirts). |

Flow at `/rd`: Login -> Overview. First time with no race: lands on Setup to create the race (name, date, venue, Expo race link, distance), then links the Wix event in Registrations and sets qualification rules.
