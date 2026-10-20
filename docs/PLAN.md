# Decisions and build order

## Decided

1. Wix first. The Director runs entirely on Wix in Phase 1; a separate director app comes in Phase 2 if Wix limits get in the way.
2. Keep today's registration and import runners; own payments wait until Phase 3.
3. Many races from day one (VHM, Ultribe, Time Trials).
4. Four roles: director, lead, desk/station volunteer, read-only viewer.
5. Email plus WhatsApp for messages, via a business provider (approval takes days, start early).
6. Keep the door open for other organisers: separate data per organiser, branding later.
7. Four zones: Race, Community, Coach, More features.
8. Training: free plan for X weeks, one way; coached plan two way with tracking and feedback.
9. Pacers in Community, volunteers in Race.
10. Coach platform is a separate product with its own login and pricing.

## Build order

- **Phase 1, web, 15 days:** Expo desk (built), volunteers, command centre, race-day control, pacers, safety checklist. QR check-in moves to Phase 1b (camera permission inside the Wix frame needs live testing).
- **Phase 1b, weeks 3 to 8:** race-day academy, smart coupons and ambassador codes, email and WhatsApp reminders, registration admin and findmybib sync, clubs, free starter plans.
- **Phase 2, Android:** installable web app first, then a store app; budget and sponsors; ambassadors; coach console.
- **Phase 3:** own registration portal and payments, live tracking, fundraising and merchandise, photos and certificates, marketing funnel, multi-organiser support.

## Inputs needed from the Race Director

Race date; the VHM bib and size column names from findmybib; the registration tool in use today; WhatsApp provider; free-plan length, coached-plan price, coach count; volunteer role names; own setup key.

## Decisions (20 Oct 2026)
- Setup key: set by the account owner in racedir.web.js; the code refuses to run with the default key.
- Race date and all event details: entered by whoever creates the race in the Director Setup tab.
- Coached plan: free for now; price to be an input the race director can set (Training module, not built yet).
- Volunteer roles: Role field suggests common roles from well-run races (aid station, marshal, start/finish, packet pickup, medal, medical, sweeper, parking, etc.); any role can still be typed.
- Still open: findmybib bib/size column names, registration tool, WhatsApp provider, free plan length X.
- Qualification checks: yes. Built as the Qualification tab (director sets rules, team records claims, person decides). Runner self-submission page is next.

- Training: free plan runs 8 weeks (decided 20 Oct). Registration confirmed as Wix Events. findmybib export columns per Yogi: name, bib name, email id, phone number, Tshirt size (no category or separate bib-number column named; 'bib name' still unclear).
- findmybib: Bib Number and Bib Name are two columns; bib name is kept as 'bibName' and shown on the bib card at the Bib desk. Runners collection needs a new text column bibName.
- Wix Events import built (Registrations tab). Qualification now runs on registrations instead of the Expo runner list.
- Navigation: / (home), /rd (login, then Director; Setup tab = races setup), /volunteer, /train, /coach. Free plan 8 weeks, coached free for now with director-set price text.
- Training module built (athlete page, coach desk, backend, 165 tests).
