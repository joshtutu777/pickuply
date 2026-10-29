# Stripe live checklist

This is a manual checklist for a later, explicitly approved switch from Stripe test mode to live mode. Do not follow it during the invitation-only audit. Nothing in this file turns live payments on.

`PAYMENTS_MODE=live` is the only switch that reads the live keys. Anything else, including an unset value, stays in test mode. A live object is not expired, refunded, or canceled just because the switch does not match it. That case alerts an admin and leaves the Stripe object unchanged.

## Before any live charge

- [ ] Owner approval for this checklist, in writing, for one named test customer and one named pilot driver.
- [ ] A fresh database backup in `C:\Users\Josh\PickuplyBackups\`.
- [ ] Pull request #46 is merged and deployed, or the owner accepts the older rule: after three failed transfer lookups the sender may still create a transfer if the first attempt is under 23 hours old.
- [ ] Migration `0118` is already applied. Apply migration `0119` before setting `PAYMENTS_MODE=live`. It stores test and live Connect accounts separately and records a live tip only while the database payment mode is live.

## 1. Stripe account activation

- [ ] In the Stripe Dashboard, live mode, the Pickuply account `acct_1PzisiDPx366znbS` already has charges and transfers active. The test account `acct_1UTOfaD5IFQdbLky` stays the test platform.
- [ ] Confirm payouts to Pickuply's own bank are enabled before any live charge. A transfer to a driver is not a deposit into that bank.
- [ ] Stay in test mode until step 8 is deployed.

## 2. Live Connect

- [ ] Turn on Connect for live mode in the same Stripe account.
- [ ] A pilot driver finishes payout setup in live mode, on a new live connected account. Do not reuse the test account `acct_1UVgsND5IFSb3cY3`.
- [ ] Confirm that live account shows `payouts_enabled` and the transfers capability active before any live job is assigned to that driver.
- [ ] The app requests the transfers capability when a connected account is created or refreshed. Do not accept Stripe's terms of service through the API.

## 3. Live platform webhook

The live platform endpoint already exists. Keep it. Do not create a second one, and do not change it because it is pinned to API version `2024-06-20`.

- Endpoint: `we_1UVKIdDPx366znbS7ecaOvjX`
- URL: `https://pickuplyapp.com/api/stripe/webhook`
- Listen to events on the platform account.
- API version: `2024-06-20`. The handlers read fields that version still includes.
- Events:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.amount_capturable_updated`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `payment_intent.succeeded`
  - `charge.captured`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`
  - `refund.created`
  - `refund.updated`
  - `charge.refunded`
  - `transfer.created`
  - `transfer.updated`
  - `transfer.reversed`

## 4. Live Connect webhook

The live Connect endpoint already exists. Keep it.

- Endpoint: `we_1UViRODPx366znbS5n9Hqcv3`
- URL: `https://pickuplyapp.com/api/stripe/connect`
- Listen to events on connected accounts.
- API version: `2024-06-20`.
- Events:
  - `account.updated`
  - `payout.paid`
  - `payout.failed`

Transfer events stay on the platform endpoint. Stripe delivers those on the platform account. The Connect route also accepts transfer events if they arrive, but the test destination does not subscribe to them.

## 5. Signing secrets

The two live endpoints already have signing secrets. Confirm the saved Vercel values match those endpoints without pasting a secret into git or chat.

1. In the Stripe Dashboard, switch to live mode.
2. Open Developers, then Webhooks.
3. Open `https://pickuplyapp.com/api/stripe/webhook`. Reveal its signing secret. In Vercel, project `pickuply`, Production, open `STRIPE_LIVE_WEBHOOK_SECRET` and confirm it is the same value. Close both pages.
4. Open `https://pickuplyapp.com/api/stripe/connect`. Confirm `STRIPE_LIVE_CONNECT_WEBHOOK_SECRET` the same way.
5. Confirm `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` are the test secrets, and that they are different from the live names.
6. Do not send a signed test event to pickuplyapp.com until `PAYMENTS_MODE=live`. While the switch is unset, the app checks the test secret, so a live signature cannot succeed.

The test secrets must stay in place.

| Variable | What it is | Where |
| --- | --- | --- |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the endpoint the site is using for `/api/stripe/webhook` | Vercel project `pickuply`, Production, server-only |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for `/api/stripe/connect` | Same project, Production, server-only |
| `STRIPE_TEST_WEBHOOK_SECRET` | Saved test platform secret, not read by the app | Keep for rollback. Server-only |
| `STRIPE_TEST_CONNECT_WEBHOOK_SECRET` | Saved test Connect secret, not read by the app | Keep for rollback. Server-only |
| `STRIPE_LIVE_WEBHOOK_SECRET` | Live platform signing secret | Read only when `PAYMENTS_MODE=live`. Server-only |
| `STRIPE_LIVE_CONNECT_WEBHOOK_SECRET` | Live Connect signing secret | Read only when `PAYMENTS_MODE=live`. Server-only |

The verifier rejects a secret that does not start with `whsec_`. Never paste a secret into git, chat, or a client component.

## 6. Live API keys in Vercel

Leave the test secret in `STRIPE_SECRET_KEY` and the test publishable key in `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. The live pair uses its own names, and the app reads those names only when `PAYMENTS_MODE=live`.

| Variable | What it holds | Visibility |
| --- | --- | --- |
| `PAYMENTS_MODE` | `test` unless the owner sets `live` | Server-only |
| `STRIPE_LIVE_SECRET_KEY` | `sk_live_...` | Server-only. Read only in live mode |
| `NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY` | `pk_live_...` | Public when the site is built with live mode. Read only in live mode |

Do not put the live secret in `NEXT_PUBLIC_*`. Do not put a live key in `STRIPE_SECRET_KEY`. Do not put a test key in `STRIPE_LIVE_SECRET_KEY`. A mixed pair is refused.

## 7. Code restriction on live keys

`getStripe()` reads the test pair while `PAYMENTS_MODE` is missing or `test`. It reads the live pair only when `PAYMENTS_MODE=live`. A live key in the test names throws "Live payments are not enabled." A test key while the switch is live throws "Live payments are not configured." A test key paired with a live key throws "Live and test Stripe keys cannot be mixed."

## 8. Enabling live mode

- [ ] This pull request is merged and deployed, and migration `0119` is applied.
- [ ] Confirm `STRIPE_SECRET_KEY` is still `sk_test_` and `STRIPE_LIVE_SECRET_KEY` is `sk_live_`.
- [ ] Confirm the live webhook secrets with the steps in section 5.
- [ ] Open `/admin/health` and confirm the environment and the database both say TEST and that they match.
- [ ] Set `PAYMENTS_MODE=live` in Vercel Production.
- [ ] Redeploy production.
- [ ] Open `/admin/health`. It shows the environment and the database separately. Checkout, accepting a job, and transfers do not change the database. Press "Set the database to LIVE". Confirm both say LIVE and that they match before any live charge.
- [ ] A real driver sets up payouts after the switch. The setup creates a new live Connect account. A stored test account is not reused.
- [ ] A real driver without live payouts and transfers active cannot accept a paid job. A test driver still can. Test mode does not add this check.

## 9. Test data

Do not delete synthetic rows as part of go-live.

Keep:

- The fixed-code synthetic accounts (the `5555550201`–`5555550205` and `5555550301`–`5555550313` roster) and their `is_test` flag.
- Test jobs, including #D26F9F and the earlier completed test job.
- Test ledger rows, the test transfer that was reversed, and test payout `po_1UVrlwD5IFSb3cY3964tLUfd`.

`ready_transfers(false)` sends test-mode rows, including `is_test` jobs. `ready_transfers(true)` sends only rows whose stored charge is live. A test job's payment is not live, so live mode does not send it.

Ask before archiving or removing any of those rows.

## 10. One-dollar live charge

Do this only after a separate approval that names the customer and the card.

- [ ] Book the smallest real job the product allows, or a one-dollar PaymentIntent if the owner approves that amount instead.
- [ ] Use a real card the owner controls.
- [ ] Confirm the PaymentIntent is `livemode: true`, the webhook stores the authorization, and the ledger row matches the charge.
- [ ] Refund that charge from the admin path. Confirm `refunded_cents`, one `stripe_refunds` row, and that a second webhook does not refund twice.
- [ ] Stop. Do not transfer that dollar unless step 11 is approved.

## 11. Live transfer and payout

Separate approval. Do not do this in the same step as the one-dollar charge.

- [ ] The connected account is the live account from step 2, not the test account.
- [ ] Send one transfer with the ledger id as the idempotency key and as `transfer_group`.
- [ ] Run the sender again and confirm Stripe still has one transfer for that ledger id.
- [ ] Record the transfer id, the available balance, and a payout id and status.
- [ ] A payout status of `pending` is not the same as money in the bank. Wait for `paid` or report the failure.

## 12. Webhooks and the ledger

- [ ] Stripe shows the live events delivered with HTTP 200.
- [ ] `payment_reconciliation_issues()` returns no new row for this charge.
- [ ] An open problem report on a different job still blocks capture. Do not open one on the live test job unless the owner wants that case.

## 13. Duplicate transfers

The ledger id is the Stripe idempotency key. A second create with that key returns the original transfer for about 24 hours. The sender also lists by `transfer_group` and, for older transfers, by the ledger id on transfers to that driver after the job completed.

A failed lookup never creates a transfer. After three failed lookups the ledger stays unresolved and needs reconciliation.

## 14. Refunds and disputes

A stored refund id is applied once. A refund after a transfer does not reverse the transfer by itself. A card dispute moves the job to disputed and blocks capture and a new payout record. It does not pull back money that already moved. Those cases wait for an admin.

## 15. Alerts

Admin alerts for a failed lookup, a missing payout setup, and a transfer that needs reconciliation are in-app. Their text and push timestamps are set when the row is written so they do not also text the admin. Watch `/admin/finance` and `/admin/finance/reconciliation` during the live test.

## 16. Emergency stop

- [ ] In Vercel, set `PAYMENTS_MODE=test`. Leave the test keys in `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Leave the live keys in their own names.
- [ ] Redeploy production. New charges and webhooks use the test keys as soon as the new deployment is serving.
- [ ] Open `/admin/health` and press "Set the database to TEST". Confirm both say TEST and that they match. Until that button is pressed, new payments stay paused. Checkout does not change the database for you.
- [ ] A live charge stays marked live. Test mode does not capture, refund, or transfer it. The catch-up leaves it unchanged and it can be reconciled again after the switch returns to live.
- [ ] In Stripe, pause live charges if a charge could still be created outside the app.
- [ ] Leave the live webhook endpoints disabled, not deleted, until the owner decides.
- [ ] Do not refund or reverse anything that already succeeded unless the owner asks for that charge by id.

## 17. Rollback

- [ ] Redeploy the last production deployment that was still on test keys.
- [ ] Confirm `getStripe()` is accepting only `sk_test_` again.
- [ ] Send one test-mode webhook from the Stripe test endpoint and confirm HTTP 200.
- [ ] Do not restore the database over live rows that were created after the backup. A database restore is a separate decision and needs its own approval.
