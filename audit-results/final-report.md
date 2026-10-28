# Pickuply audit report

Date: October 28, 2026. Branch `feat/overnight-audit`. Not merged and not deployed.

## Executive summary

The local database can take a customer request, match it to a covered online driver, refuse a second driver, walk a delivery and a junk job through proof, confirm delivery, record a capture, pay the driver 85% of a $50 offer, and record a $5 tip with no commission. A customer cannot read another customer's job or a driver's license row, and a customer cannot approve a driver. Production legal pages, the drive page, and login respond. Stripe test mode can create and cancel a manual authorization that is not tied to a job.

The browser suite only partly ran. The local dev server died after a few pages, so admin screens, driver home, Checkout, and Connect onboarding were not finished in the browser. No production user, job, or payment was modified. No real text was sent.

## Counts

The matrix in `audit-results/test-matrix.csv` has these rows:

| Status | Rows |
| --- | --- |
| PASS | 92 |
| NOT VERIFIED | 94 |
| BLOCKED | 8 |
| NOT IMPLEMENTED | 2 |
| FAIL | 0 |

PASS mixes executed database, unit, production, and Stripe checks with a few catalog rows that restate those results. NOT VERIFIED means that case was not actually run. Do not read 92 as "92 browser journeys."

Unit tests: `npm run test:unit` — 275 passed.

Database audit: `Get-Content supabase/tests/0112_marketplace_audit.sql | docker exec -i supabase_db_pickuply psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A`

Browser audit, when Chromium is installed: `npx playwright test -c playwright.audit.config.ts`

## What passed

- New local request, private address, description, required fields, and a repeat submit that does not create a second job.
- Price on a $50 offer: $7.50 commission, $2.50 service fee, $42.50 driver earnings, $52.50 customer total.
- Pending, offline, and suspended drivers cannot claim. An online covered driver can. A Savannah driver is not in the matched feed for an Austell pickup. A second claim loses.
- Delivery proof gates, junk completion at pickup, customer confirmation, capture record, closed chat, and rejected phone numbers in chat.
- Driver application rejects an expired license and a missing photo, then a complete application is pending. Admin approval writes an audit row. A customer cannot approve.
- Support ticket, customer reply, and admin reply on the same ticket.
- One $5 tip, one ledger row, duplicate confirm ignored, live tip rejected.
- Production `/terms` and `/privacy` show October 28, 2026. Driver terms link the Privacy Policy and are not the old placeholder.
- Invalid local OTP text and an empty pickup description in headless Chromium.
- Bad Stripe webhook signature returned 400 while the local server was up.
- Isolated Stripe test authorization for $52.50 was canceled.

## What failed

No product test failed.

The Playwright file failed where the local Next server hung or closed the port. Those runs are not product failures. Screenshots of the closed connection are under `test-results/` and are not part of the product.

## Still blocked

- New production phone signup and OTP. That would send a real text.
- Google address autocomplete.
- Stripe Checkout and a test card in the browser.
- Stripe Connect onboarding.
- Push delivery. Production does not have the push keys.
- WebKit. Chromium ran. WebKit was not installed.
- Session expiration was not waited out.

## Launch decisions

| Decision | Result | Why |
| --- | --- | --- |
| Driver application onboarding | CONDITIONAL GO | Apply, approve, coverage, and online/offline/suspended gates work in the local database. Production drive and legal pages load. Do not promise a bank payout, and do not treat this as a finished browser pass of license upload. |
| Customer booking | CONDITIONAL GO | A request can be saved and priced. Checkout and a card hold were not completed in the browser. |
| Real paid delivery | NO-GO | Stripe is test mode. The local capture record is not a charge against a customer booking. |
| Real bank payout | NO-GO | Connect onboarding was not completed. A test-mode transfer would not be a bank deposit. |

## How to rerun

```text
npm run test:unit
node scripts/write-audit-report.mjs
```

The database script needs the local Supabase database container `supabase_db_pickuply`. It rolls back its own transaction.
