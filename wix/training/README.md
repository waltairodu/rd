# Training module (Wix / Velo)

Free plans for athletes, and coached plans with a coach, feedback and two-way messages.

| | Free plan | Coached plan |
|---|---|---|
| Who | any athlete who signs up | athlete who asked for a coach and was assigned one |
| Schedule | from a plan template, fixed | the coach can add, change and remove workouts |
| Log runs, see progress | yes | yes |
| Feedback on each workout | no | yes |
| Messages | no (server refuses) | yes, athlete and coach |
| Price | free | text set by the director (0 = free for now). No payment is taken here |

## Files
- `training.web.js` goes in Backend. **Set your own `SETUP_KEY` at the top first.**
- `athlete-embed.html` + `athlete-page-code.js`: public page `/train`, HTML element ID `trainFrame`.
- `coach-embed.html` + `coach-page-code.js`: staff page `/coach`, HTML element ID `coachFrame`.

## Setup
1. Add the backend file, set `SETUP_KEY`.
2. Make the two pages and paste each embed into an HTML element with the ID above, then paste the matching page code.
3. Open `/coach`, log in as an admin or director, and the collections and three starter 8-week plans (5K, 10K, half marathon) are created on that first login. Nothing is shown to athletes until then.
4. Staff logins are the RaceOS logins, made on the RaceOS Team screen (role Director sees everything; role Coach sees only the athletes assigned to them). The backend also needs `rd-auth.js` (a plain file) next to it.

## How it works
- Athletes sign up with name, mobile number and a 6-digit PIN. The PIN is stored only as a salted hash. 5 wrong tries lock the account for 10 minutes. Sign-ups are limited to 100 an hour and have a hidden bot field.
- An athlete picks a plan and a start date. Every workout gets a date. Rest days do not count in the "done so far" percentage.
- "Done" can be ticked only on or after the workout's day.
- Athlete asks for a coach, the director assigns one from the Athletes tab. The director can stop coaching at any time (back to a free plan; messages stop).
- Director edits plans in the Plans tab: one workout per line `week, day, type, name, km, minutes, notes`.

## Limits (honest)
- Never run on a live Wix site yet; only tested against a simulator of the Wix modules.
- No reminders, push notifications or WhatsApp yet. No Strava or Garmin import yet. No payment.
- Lists load all athletes and sessions at once. Fine for hundreds of athletes; tell me before it grows into thousands.
- The three starter plans are generic. Please have a coach review them before you promote them.
- Forgot PIN: no self-service reset yet; the director can delete the athlete row in the CMS so they sign up again.
