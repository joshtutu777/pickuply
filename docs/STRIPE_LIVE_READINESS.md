# Stripe live readiness

Local review on 2026-10-28. No production deploy, hosted migration, live charge, refund, transfer, payout, SMS, or production setting was changed for this review.

## A. Executive summary

**NO-GO.** Pickuply cannot safely accept its first real customer payment.

The application still refuses every Stripe secret that does not start with `sk_test_`. The production publishable key is a live key. The Connect webhook secret is not set on the production project. A card-processing amount is added for every card before Pickuply knows whether the card is credit, debit, or prepaid. Those three facts block live payments even though the local ledger, capture, and transfer rules have tests.

## B. Readiness matrix

| Component | Result | Evidence |
| --- | --- | --- |
| Customer offer and locked arrival | PASS | Pull request 16 is the production deployment `dpl_AHi5W2dYL6DyZYkP7VyXZ4soPRHJ`, commit `ee20ff2`. A test-account smoke stored one exact arrival at 2:30 PM. |
| Payment authorization code | PASS | Checkout uses the stored job total. `lib/stripe.ts` refuses a non-test secret. |
| Capture | PASS | `record_capture` returns without writing again when the job is already captured. Database suite includes `0025_payments.test.sql`. |
| Webhook signature and duplicates | PASS | The raw body is verified. `claim_stripe_event` inserts the event id once. A handler error deletes that row so Stripe can retry. |
| Connect onboarding code | NOT VERIFIED end to end | Express account creation and `account.updated` handling exist. No Connect test account was onboarded in this run. |
| Transfers | PASS for the local rule, NOT VERIFIED against Stripe | A transfer is searched by ledger id before another one is created. No Stripe transfer was sent. |
| Bank payouts | NOT VERIFIED | `payout.paid` and `payout.failed` are handled only on the Connect webhook. That secret is absent in production. |
| Refunds and disputes | PASS for app-started refunds | An app refund stores `refund_id` in Stripe metadata. A refund created in the Stripe Dashboard has no local ledger update. |
| Ledger reconciliation | PASS | `payment_reconciliation_issues()` is admin-only and read-only. `0099_payment_reconciliation.test.sql` passed. |
| Card-fee compliance | BLOCKER | The processing amount is added for every card. See section G. |
| Production Stripe configuration | BLOCKER | See section H. |
| Live secret enabled in code | BLOCKER | `getStripe()` throws unless the secret starts with `sk_test_`. |

## C. Payment architecture

1. The customer accepts one offer, or a driver claims an accepted quote. The database sets `payment_status = awaiting_payment`. The accepted offer, commission, card-processing amount, and arrival are stored on the job. The browser does not send the price.
2. Checkout creates a Stripe Checkout Session for that stored total, with manual capture. The platform account is the merchant. The driver is not charged.
3. `checkout.session.completed` and `payment_intent.amount_capturable_updated` call `apply_authorization`. A late or duplicate authorization is canceled.
4. The driver completes the job. The customer confirms, or the stored completion timeout passes. `captureReadyPayment` captures the PaymentIntent once, using an idempotency key of the intent id and the capture kind.
5. `record_capture` sets the job captured and writes a job event. `post_driver_earnings` adds one ledger row for the stored driver earnings. The card-processing amount is not paid to the driver. Commission stays with the platform. A transfer is not a bank deposit.
6. `ready_transfers` lists ledger rows that are ready, have a charge id, have payouts enabled, and are not on a payout hold. `sendReadyTransfers` sends a Stripe transfer with `source_transaction` set to that charge and `metadata.ledger_id` set to the ledger row.
7. The Connect webhook records `account.updated`, transfer status, and bank payout status. Held earnings stay on the ledger until payout setup is finished.

## D. Verified test results

| Check | Result |
| --- | --- |
| Database suite | PASS. Files=50, Tests=808, including `0099_payment_reconciliation.test.sql`. |
| Unit tests | PASS. 239 passed, 0 failed. Includes fee math, checkout line items, ledger refund rules, webhook event lists, and transfer matching. |
| Lint | PASS. ESLint on the changed payment and admin files reported no problems. |
| TypeScript and production build | PASS. `next build` finished TypeScript and completed after the back-link label and transfer lookup were corrected. |
| Stripe TEST-mode PaymentIntent, capture, and transfer | NOT VERIFIED in this run. No PaymentIntent was created. |
| Headless live checkout | NOT VERIFIED. Production was not used for a payment. |
| Driver-offer headless audit from the merged branch | PASS earlier the same night: 58 checks, then a production smoke of typing, review, and one submit. |

## E. Defects

### Live publishable key with a test-only server

- Severity: blocker.
- The production publishable key classifies as `pk_live_`. The server throws unless the secret is `sk_test_`.
- Impact: a live checkout cannot start safely. A test secret with a live publishable key is also a mismatch.
- Fix: not applied. Production settings were not changed.
- The decrypted secret and platform webhook secret came back empty from the Vercel API, so their mode is NOT VERIFIED. They are marked sensitive.

### Connect events have no production destination

- Severity: blocker for payouts.
- `STRIPE_CONNECT_WEBHOOK_SECRET` is not in the production project.
- Impact: `account.updated`, transfer status, and `payout.paid` / `payout.failed` are not recorded from Stripe.
- Required destination, when the owner approves a test or live setup: `https://pickuplyapp.com/api/stripe/connect`.
- Events: `account.updated`, `transfer.created`, `transfer.updated`, `transfer.reversed`, `payout.paid`, `payout.failed`.
- Connect events must be enabled for connected accounts. The platform endpoint `https://pickuplyapp.com/api/stripe/webhook` does not handle those events.
- Fix: not applied. No webhook destination was created.

### A second transfer after a lost ledger write

- Severity: high if a transfer succeeds and the database write fails, then the idempotency key expires.
- Root cause: the next payout run would call Stripe again.
- Fix on this branch: list that connected account's recent transfers and reuse one whose metadata ledger id matches. The same ledger id remains the idempotency key. If the transfer id exists and the database write fails, the row is not marked failed, so the next run can record the same id. The lookup checks up to 500 recent transfers for that account.
- Test: `lib/payments/transfer-match.test.ts`.

### Dashboard refunds

- Severity: medium.
- `charge.refunded` is accepted and ignored. `refund.created` updates the ledger only when Stripe metadata contains the app refund id.
- Impact: a refund made in the Dashboard does not change Pickuply balances.
- Fix: not applied. Changing balances from an unmatched refund needs its own reviewed function.

### Card processing on every card

- Severity: blocker for live payments.
- See section G. No pricing change was made.

## F. Stripe Connect

Onboarding, transfers, and bank payouts are **not** verified end to end.

The code can create an Express account, save it against the driver, and open an onboarding link. Transfers require `payouts_enabled`. Earnings stay on the ledger with a hold reason until setup is finished. A bank payout is a separate `driver_bank_payouts` row. No test driver completed Stripe onboarding in this run, and no transfer was created.

## G. Card-fee compliance

Pickuply does not add a second platform or service fee. The customer pays the accepted offer plus a card-processing amount. The default is 2.9% plus 30 cents, labeled "Card processing fee", and it is shown before the customer pays. Commission is 15% of the offer and comes out of the driver earnings. The processing amount is added for every card. Checkout is card-only. The code does not know debit versus credit before the amount is sent to Stripe.

Visa's U.S. merchant surcharge Q&A says a U.S. merchant who surcharges must limit it to credit cards, must not surcharge debit or prepaid, must cap it at the merchant discount rate or 3% (whichever is lower), must disclose it, and must notify the acquirer. Source: [Visa U.S. Merchant Surcharge Q&A](https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf). Visa's public rules page says U.S. credit-card surcharging has to follow that Q&A. Calling the amount a processing fee does not answer whether the networks treat it as a surcharge.

This implementation cannot reliably skip debit and prepaid cards. That is a live-payment blocker. It is an engineering conclusion, not a legal opinion.

Options for a later decision, not implemented:

1. Remove the customer-facing processing amount and pay Stripe's fee from the commission.
2. Keep a credit-card surcharge only after the card funding type is known, with the network cap, disclosure, and acquirer notice. Debit and prepaid would pay the offer only.
3. Ask Stripe and counsel whether the current label and checkout setup is a surcharge before any live charge.

Georgia was not in Visa's February 15, 2024 list of jurisdictions that prohibit surcharging. That list can change. A lawyer needs to confirm Georgia and federal rules. Visa says it does not give legal advice.

## H. Production configuration

Checked with the Vercel API. Values were not printed.

| Name | Production project `pickuply` |
| --- | --- |
| `STRIPE_SECRET_KEY` | Present, sensitive. Decrypt returned empty, so test versus live is NOT VERIFIED. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Present. Classified as `pk_live_`. |
| `STRIPE_WEBHOOK_SECRET` | Present, sensitive. Decrypt returned empty, so the endpoint is NOT VERIFIED. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Absent. |
| `NEXT_PUBLIC_SUPABASE_URL` | Present on production and preview. Classified as a Supabase URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Present. Not a Stripe key and not a JWT. |

The active production deployment is `dpl_AHi5W2dYL6DyZYkP7VyXZ4soPRHJ` on `ee20ff2`. Hosted migrations end at `0097`. `0099` was applied only to the local database. `pickuply-ku8y` was not changed.

No secret is written into this report. The publishable key is public by design. Its mode is the finding.

## I. Git and pull requests

- Production main includes driver-offer UX: merge `ee20ff2`, pull request 16. There is no migration `0098`. Newest-first uses the existing Georgia page parameter and a page sort of the matched list.
- `supabase/tests/0013_security.test.sql` on main already checks the current `claim_job(uuid, text, text, uuid)` signature and still requires `assert_driver_can_take_job`.
- This review is branch `feat/stripe-readiness`, commit `a855d42b33b2fbc98bb5db14e94d47f545327853`, pull request https://github.com/joshtutu777/pickuply/pull/17. It is based on `ee20ff2` and is not merged.
- Migration `0099_payment_reconciliation.sql` is local until the owner applies it. It only adds a read-only admin function.
- `release/mobile-ux` was not changed.

## J. Release sequence

Do not start this sequence until the blockers in section K are accepted.

1. Back up the hosted database.
2. Apply only `0099` if this pull request is approved. It does not change existing rows.
3. Deploy the application only after the owner merges it. The code still refuses a live secret.
4. Smoke a test-account offer. Do not run a live card.
5. Separately, with explicit approval, set a matching test secret, test publishable key, platform webhook secret, and Connect webhook secret. Redeploy the same commit. Run one Stripe test-mode authorization, capture, and transfer.
6. Only after that test lifecycle and a fee decision, change the server so a live secret is allowed, swap in the live keys, and create the live webhook destinations.
7. Rollback is the previous production deployment `dpl_H6KpG6C4c7vSUSwuyBLHrQjcde4j` if this app deploy fails. Leave `0099` in place if it was applied. It does not change money.

## K. Outstanding blockers

1. Production publishable key is live while the server accepts only a test secret. Owner action: choose test or live and make the keys match. Do not mix them.
2. Connect webhook secret and destination are missing. Owner action: create the destination and set the secret. No destination was created here.
3. Card-processing amount applies to every card. Owner, Stripe, and counsel need to choose one of the options in section G before a live charge.
4. Platform secret and webhook secret could not be classified. Owner action: confirm both in the Vercel dashboard without pasting them into chat.
5. No Stripe test-mode authorization, capture, and transfer was executed in this run.
6. A Dashboard refund does not update the ledger.

## L. Final recommendation

1. Pickuply cannot safely accept its first real customer payment.
2. It cannot safely capture that payment, because live mode is not configured and the publishable key does not match the server guard.
3. It cannot safely pay the driver. Connect payout events are not configured, and no transfer was verified against Stripe.
4. Before live transactions: matching keys, both webhook destinations, a fee decision, a full Stripe test-mode authorization-capture-transfer, and an explicit code change that allows a live secret.
5. The safest next release is this read-only reconciliation and transfer-recovery branch, after review. It does not turn on live payments. Driver-offer UX is already in production and should stay there.
