# The 37 database collections of RaceOS

This file is made by `node tools/collections.mjs --doc` from the backend source, so it cannot disagree with the code. Do not edit it by hand.

Every collection has only plain **Text** columns, and all four permissions (read, insert, update, remove) are set to **Admin**: only the backend files can read or write a collection, and no page can. On vtra.run all 37 were checked on 20 November 2026: each exists with those four permissions.

| # | Collection | What it holds | Made by | Columns |
|---|---|---|---|---|
| 1 | `RDComms` | message templates and the log of messages sent (Messages) | comms.web.js | 10 |
| 2 | `RDInvoices` | invoices (Finance) | finance.web.js | 24 |
| 3 | `RDOrders` | purchase orders: estimate, advance and actual (Finance) | finance.web.js | 15 |
| 4 | `RDClaims` | reimbursement claims (Finance) | finance.web.js | 18 |
| 5 | `RDLedger` | income and expenses, one line each (Finance) | finance.web.js | 20 |
| 6 | `RDFinSet` | Finance settings (invoice details, numbering) | finance.web.js | 5 |
| 7 | `RDPrint` | bib and certificate designs and the /runner page switches | print.web.js | 5 |
| 8 | `ExpoStaff` | logins: usernames, roles and password hashes (the Team screen) | racedir.web.js, training.web.js | 8 |
| 9 | `ExpoSessions` | who is signed in right now | racedir.web.js, training.web.js | 4 |
| 10 | `ExpoPresence` | which Expo desk each person is at | racedir.web.js | 3 |
| 11 | `ExpoConfig` | Expo desk settings per race | racedir.web.js | 2 |
| 12 | `ExpoCheckins` | bib and T-shirt hand-outs at the Expo desk | racedir.web.js | 10 |
| 13 | `RDAudit` | the audit trail (who did what, and when) | racedir.web.js | 5 |
| 14 | `Runners` | runners at the Expo desk | racedir.web.js | 16 |
| 15 | `RDEvents` | your races | racedir.web.js | 6 |
| 16 | `RDShifts` | volunteer shifts | racedir.web.js | 8 |
| 17 | `RDVolunteers` | volunteers | racedir.web.js | 11 |
| 18 | `RDAssignments` | who works which shift, check-in and hours | racedir.web.js | 8 |
| 19 | `RDLog` | race-day incident log | racedir.web.js | 10 |
| 20 | `RDRunOfShow` | race-day run of show | racedir.web.js | 5 |
| 21 | `RDPacers` | pacers of a race | racedir.web.js | 9 |
| 22 | `RDChecklist` | safety checklist | racedir.web.js | 7 |
| 23 | `RDRegs` | registrations imported from Wix Events | racedir.web.js | 14 |
| 24 | `RDQuals` | qualification claims | racedir.web.js | 12 |
| 25 | `RDPlan` | every planning item of a race: tasks, budget lines, contacts, approvals | racedir.web.js | 23 |
| 26 | `RDRate` | counters that slow down guessing (logins, set-up) | racedir.web.js, training.web.js | 1 |
| 27 | `RDResults` | race results | results.web.js | 19 |
| 28 | `RDWaveAssign` | the wave and corral of each runner | results.web.js | 7 |
| 29 | `RDResSet` | Waves & results settings and the waves | results.web.js | 5 |
| 30 | `TrainAthletes` | athlete accounts (mobile number and PIN) | training.web.js | 10 |
| 31 | `TrainTokens` | athlete sign-ins | training.web.js | 3 |
| 32 | `TrainPlans` | training plans | training.web.js | 7 |
| 33 | `TrainWorkouts` | the workouts of each plan | training.web.js | 8 |
| 34 | `TrainEnroll` | which athlete follows which plan, with which coach | training.web.js | 12 |
| 35 | `TrainSessions` | planned and logged training sessions | training.web.js | 18 |
| 36 | `TrainMsgs` | messages between coach and athlete | training.web.js | 6 |
| 37 | `RDWaivers` | waiver text versions, who has signed and papers recorded on the day (Waivers) | waivers.web.js | 10 |

## The columns

- `RDComms`: `event`, `kind`, `ref`, `sub`, `who`, `status`, `why`, `json`, `by`, `at`
- `RDInvoices`: `event`, `fy`, `seq`, `number`, `kind`, `party`, `partyAddr`, `partyGstin`, `partyEmail`, `date`, `due`, `lines`, `subtotal`, `tax`, `total`, `status`, `notes`, `org`, `sponsorId`, `by`, `at`, `cancelReason`, `cancelledBy`, `cancelledAt`
- `RDOrders`: `event`, `fy`, `seq`, `number`, `vendor`, `vendorContact`, `title`, `cat`, `estimate`, `date`, `status`, `notes`, `by`, `at`, `cancelReason`
- `RDClaims`: `event`, `fy`, `seq`, `number`, `payee`, `payTo`, `lines`, `total`, `approved`, `status`, `notes`, `by`, `byName`, `at`, `decidedBy`, `decidedAt`, `decisionNote`, `selfApproved`
- `RDLedger`: `event`, `type`, `amount`, `tds`, `cat`, `party`, `mode`, `date`, `ref`, `note`, `phase`, `source`, `sourceId`, `holder`, `by`, `at`, `void`, `voidBy`, `voidAt`, `voidReason`
- `RDFinSet`: `kind`, `by`, `at`, `ref`, `json`
- `RDPrint`: `event`, `kind`, `json`, `by`, `at`
- `ExpoStaff`: `username`, `password`, `role`, `desks`, `race`, `name`, `failCount`, `lockUntil`
- `ExpoSessions`: `token`, `username`, `desk`, `expires`
- `ExpoPresence`: `username`, `desk`, `seen`
- `ExpoConfig`: `name`, `json`
- `ExpoCheckins`: `event`, `bib`, `name`, `pickupBy`, `friendName`, `friendPhone`, `method`, `selfie`, `at`, `desk`
- `RDAudit`: `at`, `by`, `action`, `target`, `detail`
- `Runners`: `event`, `bib`, `name`, `bibName`, `cat`, `size`, `phone`, `email`, `example`, `checkedInAt`, `checkedInDesk`, `bibAt`, `bibDesk`, `shirtSize`, `shirtAt`, `shirtDesk`
- `RDEvents`: `name`, `date`, `venue`, `expoId`, `status`, `json`
- `RDShifts`: `event`, `role`, `location`, `date`, `start`, `end`, `need`, `notes`
- `RDVolunteers`: `event`, `name`, `phone`, `email`, `club`, `status`, `code`, `waiverAt`, `waiverVersion`, `createdAt`, `notes`
- `RDAssignments`: `event`, `volunteerId`, `shiftId`, `status`, `checkedInAt`, `checkedOutAt`, `hours`, `seq`
- `RDLog`: `event`, `at`, `kind`, `place`, `text`, `severity`, `status`, `by`, `closedAt`, `resolution`
- `RDRunOfShow`: `event`, `time`, `what`, `owner`, `status`
- `RDPacers`: `event`, `name`, `phone`, `group`, `status`, `trial`, `briefing`, `kit`, `notes`
- `RDChecklist`: `event`, `section`, `item`, `done`, `doneBy`, `doneAt`, `order`
- `RDRegs`: `event`, `ticketNumber`, `orderNumber`, `guestId`, `name`, `email`, `phone`, `cat`, `size`, `bibName`, `status`, `form`, `at`, `bib`
- `RDQuals`: `event`, `runnerId`, `name`, `cat`, `claim`, `claimKm`, `claimSec`, `link`, `status`, `note`, `by`, `at`
- `RDPlan`: `event`, `kind`, `title`, `cat`, `phase`, `status`, `owner`, `party`, `contact`, `due`, `time`, `amount`, `amount2`, `ref`, `link`, `notes`, `order`, `by`, `at`, `tpl`, `lead`, `offset`, `docsDone`
- `RDRate`: `n`
- `RDResults`: `event`, `bib`, `name`, `cat`, `gender`, `dob`, `age`, `status`, `gunCs`, `chipCs`, `note`, `regId`, `by`, `at`, `void`, `voidBy`, `voidAt`, `voidReason`, `prev`
- `RDWaveAssign`: `event`, `regId`, `wave`, `corral`, `how`, `by`, `at`
- `RDResSet`: `kind`, `by`, `at`, `ref`, `json`
- `TrainAthletes`: `name`, `phone`, `salt`, `pinHash`, `level`, `goal`, `goalDate`, `failCount`, `lockUntil`, `createdAt`
- `TrainTokens`: `token`, `athlete`, `expires`
- `TrainPlans`: `name`, `goal`, `weeks`, `level`, `blurb`, `status`, `days`
- `TrainWorkouts`: `plan`, `week`, `day`, `type`, `title`, `km`, `minutes`, `notes`
- `TrainEnroll`: `athlete`, `plan`, `planName`, `start`, `kind`, `coach`, `coachName`, `coachStatus`, `reqNote`, `status`, `createdAt`, `endedAt`
- `TrainSessions`: `enroll`, `athlete`, `date`, `week`, `type`, `title`, `km`, `minutes`, `notes`, `status`, `aKm`, `aMin`, `rpe`, `aNote`, `feedback`, `feedbackBy`, `feedbackAt`, `source`
- `TrainMsgs`: `enroll`, `from`, `name`, `text`, `at`, `read`
- `RDWaivers`: `event`, `kind`, `ref`, `sub`, `who`, `status`, `why`, `json`, `by`, `at`

## You never make these by hand

- The backend makes the collections of a tab the first time a director opens it, and the First-time setup form (or the first login) makes the core ones, locked as above. If a collection is ever missing, open the tab that uses it once as a director.
- If you must make one by hand (in a copy of the site, say), use the **Text** type for every column and set all four permissions to **Admin**. Wix does not enforce columns, so a missing column is not an error, but the screens then show that field empty.
- Never change a permission to Anyone or Site member: `ExpoStaff` holds the logins, and every other collection holds personal details of runners, volunteers or athletes.

## Sandbox and Live

If the CMS shows a **Sandbox** and a **Live** tab, the Editor's Preview reads and writes the sandbox and the published site reads and writes the live data. The collections above exist in the live data on vtra.run. Do the first sign-in on the published address (https://www.vtra.run/rd).
