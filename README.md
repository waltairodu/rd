# VTRA Race Director

Software for running a VTRA race end to end, built on Wix (Velo). Started with the expo desk, now growing into the full Race Director suite.

## Status

| Module | State | Where |
| --- | --- | --- |
| Expo desk (bibs, T-shirts, selfie proof, stock, desks, findmybib sync) | Built, tested in a simulator | `wix/expo` |
| Director Phase 1: command centre, volunteers, race day log, pacers, safety | Built, tested in a simulator | `wix/director` |
| Finance: invoices, reimbursement claims, cash, orders (estimate, advance, actual), income and expenses | Built, tested in a simulator | `wix/director/finance.web.js` |
| Waves & results: waves and corrals, start list, results file, board, awards | Built, tested in a simulator | `wix/director/results.web.js` |
| Bibs, certificates and the public /runner page | Built, tested in a simulator | `wix/director/print.web.js`, `wix/director/runner.web.js` |
| Messages: templates, audiences, e-mails through one Wix triggered e-mail, WhatsApp chat links, history | Built, tested in a simulator | `wix/director/comms.web.js` |
| Waivers: the waiver text in versions, who has signed, papers recorded on the day, papers to print, "waiver not signed" as a Messages audience | Built, tested in a simulator | `wix/director/waivers.web.js` |
| Registration admin, budget, clubs, ambassadors, academy, coach platform, Android | Designed as mockups, not built | `docs/mockups`, `docs/PLAN.md` |

None of these packages has run on a live Wix site yet. Rehearse on the published site before race day.

## Layout

- `wix/expo`: Expo desk (backend module, HTML embed, page code, README).
- `wix/director`: Director (backend module, two HTML embeds, two page codes, README).
- `tests`: a small simulator of the Wix modules and the test suites. Run `tests/all.sh`.
- `docs/PLAN.md`: decisions and build order. `docs/mockups`: the clickable design screens.

## Run the tests

    cd tests && npm install jsdom@24 && ./all.sh

## Secrets

`SETUP_KEY` in `exposoft.web.js` and `racedir.web.js` ships as `change-this-key`. Change it in Wix to your own secret. Never commit your real key.

## Site map
See docs/SITEMAP.md. Race Director is at /rd, volunteers at /volunteer, athletes at /train, coaches at /coach.

## Training
See wix/training/README.md.
