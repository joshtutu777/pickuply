# Stripe live readiness

Local review on 2026-10-28. No production deploy, hosted migration, live charge, refund, transfer, payout, SMS, or production setting was changed for this review.

## Financial safety — 2026-10-28 afternoon

### Duplicate transfers

`0101_transfer_claims.sql` stores one claim per ledger row. The Stripe idempotency key stays the ledger id. Only the first caller, or a later caller that has checked Stripe and is still inside 23 hours, may create a transfer. A second caller gets `lookup` and does not create one. A lost response is marked ambiguous and is not sent again until a Stripe search says the transfer is absent. After 23 hours an unresolved attempt is reported by `payment_reconciliation_issues()` and is not sent again. The same Stripe transfer id cannot be stored on two ledger rows. Customers cannot call the functions. Local and hosted ledgers had no existing transfer ids, so the unique index does not collide with current rows. The migration is local only.

### Pull requests 17 and 18

`0099` adds a read-only function and does not change existing rows. `0100` adds `stripe_refunds` and replaces the refund function. Existing refund history is kept. A repeated Stripe refund id does not add the amount again. A partial refund adds only that amount. A refund after a transfer leaves the ledger amount and adds a recovery row. It does not reverse the Stripe transfer. Customers cannot call `record_stripe_refund`. The webhook now passes `external_refund_id`, which is the database argument name. Reconciliation stays read-only and returns no rows to a customer or driver.

Rollback for `0099` alone is `drop function public.payment_reconciliation_issues();`. After `0101`, restore the `0099` function body before dropping `stripe_transfer_claims`, because the later function reads that table. Rollback for `0100` is to restore the previous `apply_refund` and drop `record_stripe_refund` and `stripe_refunds` only when that table is empty. Rollback for `0101` drops `begin_transfer_send`, `record_claimed_transfer`, `note_transfer_unknown`, `stripe_transfer_claims`, and the unique transfer index, then restores the `0099` function. None of these migrations are on the hosted database.

### Connect onboarding

A new test Express account was not onboarded. Stripe reported `payouts_enabled` false, `charges_enabled` false, and `details_submitted` false. That is Stripe's account, not a local flag. The onboarding link host is `connect.stripe.com`. The app previously requested card payments and did not request the transfers capability. New and refreshed accounts now request transfers when the driver has an email.

Stripe's published test values were saved: address token `address_full_match`, id number `000000000`, date of birth `1902-01-01`, phone token `0000000000`, and test bank routing `110000000` with account `000123456789`. The only fields still due were `tos_acceptance.date` and `tos_acceptance.ip`. Stripe rejected a platform terms acceptance because this Express account collects requirements itself. The hosted test form offers "Use test phone number". A headless browser reached that page. hCaptcha blocked the click. The form was not completed, and no payout was reported.

### Webhooks

Stripe delivers `transfer.created`, `transfer.updated`, and `transfer.reversed` on the platform account. It delivers `account.updated`, `payout.paid`, and `payout.failed` on connected accounts. The platform route now records transfer events. The Connect route still records account, transfer, and payout events. No webhook destination was created or changed. No Vercel setting was changed.

Test-mode setup, when you approve it:

1. Stripe Dashboard, test mode. Developers, Webhooks. Add an endpoint for your account: `https://pickuplyapp.com/api/stripe/webhook`. Add `transfer.created`, `transfer.updated`, and `transfer.reversed` to the existing test endpoint. Do not open live mode.
2. Add a second endpoint: `https://pickuplyapp.com/api/stripe/connect`. Listen to events on Connected accounts. Events: `account.updated`, `payout.paid`, `payout.failed`.
3. Put the Connect signing secret in Vercel as `STRIPE_CONNECT_WEBHOOK_SECRET`. Leave the existing platform webhook secret in place.

### Card-fee proposal

Not activated. Checkout still adds card processing. The estimate below uses the configured 2.9% plus 30 cents on the offer, rounded the same way as the fee code. It is not a Stripe balance-transaction fee. Driver earnings stay 85% of the offer. Commission stays 15%.

| Offer | Current customer total | Proposed customer total | Driver earnings | Commission | Estimated Stripe fee | Estimated net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| $35.00 | $36.35 | $35.00 | $29.75 | $5.25 | $1.32 | $3.93 |
| $50.00 | $51.80 | $50.00 | $42.50 | $7.50 | $1.75 | $5.75 |
| $75.00 | $77.55 | $75.00 | $63.75 | $11.25 | $2.48 | $8.77 |
| $100.00 | $103.30 | $100.00 | $85.00 | $15.00 | $3.20 | $11.80 |
| $200.00 | $206.28 | $200.00 | $170.00 | $30.00 | $6.10 | $23.90 |

### Checks run

Database suite: PASS, 52 files, 826 tests. Unit tests: PASS, 242. TypeScript: PASS. ESLint on the changed payment files: PASS. The full-repo lint still reports existing errors in blog, settings, and driver screens. Those files were not part of this change. Production build: PASS. Stripe test authorization, capture, and partial refund from the earlier run remain PASS. A new transfer and a bank payout were not sent, because no test account reached `payouts_enabled`. Webhook delivery was not replayed to the site, because no destination was added.

### Recommendation

**CONDITIONAL GO** to merge the financial-safety changes after review. They do not enable live payments. Apply `0099`, `0100`, and `0101` on the hosted database only after that review. **NO-GO** for live payments.

## Remediation — 2026-10-28 morning

### 1. Pull request 17

**Safe to merge on its own. It does not enable live payments.**

`0099_payment_reconciliation.sql` only creates a read-only function. It does not change tables, policies that the current app uses, or existing rows. The deployed app does not call it. Rollback is `drop function public.payment_reconciliation_issues();`. Customers and drivers get no rows. Admins and the service role can read mismatches.

The transfer change keeps the ledger id as the Stripe idempotency key. Before creating a transfer it looks through the 500 most recent transfers to that connected account and reuses one with the same ledger id. If Stripe already returned a transfer id and the database write fails, the row is not marked failed, so the next run can record that same id. A transfer older than those 500, after the idempotency key expires, could still be sent twice. That window is small for a new platform. Financial math is unchanged.

### 2. Dashboard refunds

`charge.refunded` used to return without writing. A refund that did not carry the app's refund id never changed `refunded_cents` or the ledger.

`0100_stripe_refunds.sql` records each Stripe refund id once. A repeated event does not add the amount again. A failed or pending refund does not move money. A partial refund adds only that amount. Before a transfer, driver earnings go down by the refund amount, not below zero. After a transfer, earnings stay put and a recovery row is added for an admin. The function does not reverse the Stripe transfer. A refund larger than the remaining capture is rejected, the webhook returns an error, and the event claim is released so Stripe can retry. `job_events` and `audit_log` keep the history.

### 3. Connect webhook

The platform route `/api/stripe/webhook` does not handle connected-account events. A separate destination is required:

- URL: `https://pickuplyapp.com/api/stripe/connect`
- Listen to events on connected accounts
- Events: `account.updated`, `transfer.created`, `transfer.updated`, `transfer.reversed`, `payout.paid`, `payout.failed`
- Put that endpoint's signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET` on the production Vercel project

`STRIPE_CONNECT_WEBHOOK_SECRET` is mandatory for that route. The verifier rejects a secret that does not start with `whsec_`. It is absent in production. No destination was created or changed.

The route updates Express onboarding from `account.updated`, transfer status from the transfer events, and bank payout status from `payout.paid` and `payout.failed`. A transfer is not a bank payout.

### 4. Test and live mode

The `sk_test_` check is intentional launch protection. `getStripe()` now also refuses a live publishable key, a live secret, or a missing test publishable key. Checkout expires a session if Stripe reports `livemode`. There is no switch that turns live mode on. A later release would need both keys in live mode and a new explicit setting approved by the owner. That setting does not exist.

Local test runs use the existing test secret in `.env.local`. Live keys were not copied.

### 5. Card-processing fee

Calculated in `lib/fees.ts` as the smallest cent total that covers 2.9% plus 30 cents on top of the offer. Shown on the offer comparison and as its own Checkout line in `app/jobs/pay/actions.ts`. The amount is fixed before the customer enters a card, so Checkout cannot skip debit or prepaid cards. A refund records the amount Stripe refunded. It does not calculate a separate processing-fee refund. Driver earnings are the offer minus commission. The processing amount is not part of driver earnings.

Recommendation: stop adding this amount to the customer total and pay Stripe's fee from the existing 15% commission. Customer totals fall by the processing amount. Driver earnings stay the same. Pickuply's margin falls by the actual Stripe fee, which can exceed the old processing amount on some cards. This needs your approval before any price change. It is not implemented.

A credit-only surcharge is not supportable with the current Checkout session, because the amount is set before the card funding type is known. A renamed "service fee" still needs Stripe and legal review before it is charged on debit or prepaid cards. Visa's U.S. surcharge Q&A prohibits debit and prepaid surcharges.

### 6. Stripe TEST-mode lifecycle

Using the local test secret only:

- PASS. A test card authorization reached `requires_capture`.
- PASS. Capture succeeded for 5000 cents.
- PASS. A second capture was refused with `payment_intent_unexpected_state`.
- PASS. A 1500-cent refund replayed with the same idempotency key returned the same refund.
- The test-mode webhook endpoint `https://pickuplyapp.com/api/stripe/webhook` is enabled and `livemode` is false. Its events are the platform payment events, including `charge.refunded`. It does not include `account.updated`, transfer events, or payout events.
- NOT VERIFIED. Express onboarding and a driver transfer. A test account was created with the app's Accounts v2 settings. `payouts_enabled` stayed false and `details_submitted` stayed false. No transfer was sent. The legacy custom-account call was rejected because this platform uses managed risk.

The in-app customer accept, job completion, and ledger path was not replayed in the browser in this run. The database tests cover the refund ledger rules. The Stripe calls above were real test-mode API calls, not mocks.

### 7. Remaining live blockers

- Production publishable key is live, and live mode stays closed in code.
- Connect webhook destination and `STRIPE_CONNECT_WEBHOOK_SECRET` are missing.
- The card-processing amount is still added for every card.
- The platform secret and platform webhook secret still could not be classified from the API.
- Migration `0100` is local only.
- A full in-app Connect onboarding and transfer was not completed in this run unless the test section says otherwise.

### 8. Pull requests

- https://github.com/joshtutu777/pickuply/pull/17 — transfer lookup and read-only reconciliation. Do not merge until you approve it.
- https://github.com/joshtutu777/pickuply/pull/18 — Dashboard refunds and the test-key gate. Commit `c0fa6654e6c1f266be41f93eaf6b4e914c6c61d2`. It is based on pull request 17 and is not merged.

### 9. Manual actions

1. Review pull request 17. It is safe to merge without enabling live payments. Do not merge it from here.
2. In Stripe test mode, create a Connect webhook endpoint for `https://pickuplyapp.com/api/stripe/connect` with the events listed above, for connected accounts. Do not create a live endpoint yet.
3. Put that test signing secret in Vercel as `STRIPE_CONNECT_WEBHOOK_SECRET`. This session did not change Vercel.
4. Confirm the production `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the Vercel dashboard. Do not paste them into chat. They must both be test values while the publishable key is switched back to test, or checkout will keep failing closed.
5. Decide the card-fee option before any live charge. The recommended option is to absorb processing in the commission.
6. Apply `0099` and `0100` on the hosted database only after you approve those migrations.

### 10. Recommendation

**NO-GO** for live payments. **CONDITIONAL GO** to merge pull request 17 by itself.

## A. Executive summary

**NO-GO** for the first real customer payment. Pull request 17 can merge without turning live payments on.

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
| Database suite | PASS. Files=51, Tests=816, including reconciliation and Dashboard refund tests. |
| Unit tests | PASS. 241 passed, 0 failed. Includes the test/live key gate and Dashboard refund routing. |
| Lint | PASS. ESLint on the changed payment files reported no problems. |
| TypeScript and production build | PASS. `next build` completed on this branch. |
| Stripe TEST-mode authorization, capture, and partial refund | PASS against the test API. A second capture was refused. The refund replay returned the same refund. |
| Stripe TEST-mode Connect onboarding and transfer | NOT VERIFIED. The test account stayed not onboarded, and no transfer was sent. |
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

## M. Combined candidate

Section J above is the earlier reconciliation-only sequence. The combined service-fee, refund, transfer, and tip candidate is `docs/FINANCIAL_RELEASE.md`. Do not apply `0099` by itself as that release. The customer charge on the combined branch is the 5% service fee, not the older card-processing total.
