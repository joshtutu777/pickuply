# Financial release candidate

This is the approval plan for the combined financial work. It was not executed. Nothing here was merged to main, deployed, or applied to the hosted database.

The branch `feat/financial-integration` starts at current `main` (`ee20ff2`, pull request 16) and then brings in:

1. Pull request 17, reconciliation, migration `0099`
2. Pull request 18, refund recording, migration `0100`
3. Pull request 19, transfer claims, migration `0101`
4. Pull request 20, 5% service fee, migration `0098`
5. Pull request 21, post-delivery tips, migration `0102` at `a888a5b`

The original branches are unchanged.

## Migration order

Apply on a database that already has `0001` through `0097`:

1. `0098_service_fee.sql`
2. `0099_payment_reconciliation.sql`
3. `0100_stripe_refunds.sql`
4. `0101_transfer_claims.sql`
5. `0102_driver_tips.sql`
6. `0103_tip_refund_before_payment.sql`
7. `0104_tip_fee_backfill.sql`
8. `0105_deferred_tip_refunds.sql`

`0098` adds the service-fee rate and snapshots. It does not rewrite stored prices, earnings, commission, service-fee cents, or refunds. `0099` adds a read-only reconciliation function. `0100` records a Stripe refund once and does not reverse a transfer. `0101` stores one transfer claim per ledger row. `0102` adds a separate tip ledger row. A booking refund after `0102` updates only the base row. A tip refund uses the tip row. `0103` keeps a refund that is recorded before the payment event and credits only the remainder. `0104` lets a repeated confirmation fill in a missing Stripe fee without adding a second ledger row. `0105` stores a signed tip refund that arrives before its local row, then applies that refund once when the row is inserted. It does not change prices, earnings, or refunds that are already recorded.

## Hosted backup and gates

Before any hosted apply:

1. Take a hosted database backup and record its id.
2. Confirm hosted `schema_migrations` ends at `0097`.
3. Confirm a clean local database applies `0098` through `0105` and the full database suite passes.
4. Confirm no job row changes price, driver pay, commission, or service-fee cents during the apply.
5. Apply the eight files in the order above. Do not edit an already applied file.
6. Deploy the same commit only after that apply succeeds.
7. Smoke with test accounts. Do not use a live card.

## Rollback that keeps financial records

Do not delete ledger rows, refund rows, tip rows, or transfer claims to undo a release.

- If the app deploy fails before a hosted migration, roll back to the previous production deployment and leave the database alone.
- If `0098` was applied and must be undone before any new booking stores the new fee, restore the previous `price_breakdown`, `begin_refund`, and settings functions from `0097`, then drop only the new columns if they are still null on every job and offer. Do not drop them after a booking has stored a fee.
- If `0099` was applied, drop `payment_reconciliation_issues()` only before `0101`. After `0101`, restore the `0099` function body before dropping `stripe_transfer_claims`.
- If `0100` was applied, restore the previous `apply_refund` and drop `record_stripe_refund` and `stripe_refunds` only when `stripe_refunds` is empty.
- If `0101` was applied, stop transfers first. Drop the claim functions only when no claim is `sending` or `ambiguous`. Keep the table if any Stripe transfer id is stored.
- If `0102` was applied, stop tip charges first. Keep `job_tips` and tip ledger rows if any tip has `paid_at` set. A rollback that deletes a paid tip would destroy financial history.
- If `0103` or `0104` was applied, restore `confirm_tip_payment` from `0102`. Do not delete tip or ledger rows.
- If `0105` was applied, drop the deferred-refund trigger only when `deferred_tip_refunds` has no unapplied row. Keep applied refund rows and ledger rows.

## Local test runtime

`.env.local` keeps one live secret and one live publishable key. The test secret and test publishable key are stored beside them as `STRIPE_TEST_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY`, so the live lines do not hide them. `.env.test.local` is gitignored and is the only file a test process should load. `scripts/stripe-test-runtime.mjs` refuses to start unless both Stripe keys are test keys. It does not change Vercel or the hosted webhook.

## Stripe test setup, still not done

1. Stripe Dashboard, test mode only. Add `transfer.created`, `transfer.updated`, and `transfer.reversed` to the platform test webhook for `https://pickuplyapp.com/api/stripe/webhook`.
2. Add a Connect webhook for `https://pickuplyapp.com/api/stripe/connect` with `account.updated`, `payout.paid`, and `payout.failed`.
3. Put the test secret, test publishable key, platform webhook secret, and Connect webhook secret in the local or preview environment. Do not replace the live values.
4. A driver Connect account still has to finish Stripe's own test onboarding. hCaptcha blocks a headless completion. The app requests the transfers capability when the driver has an email.
5. Live payments stay off until a full test authorization, capture, transfer, tip, and refund have succeeded, the keys match, both webhooks verify, and the owner explicitly allows a live secret.

## Accounting that this candidate keeps

- New bookings add a 5% service fee, rounded half up, on top of the offer. The rate is snapshotted.
- Pickuply commission stays 15% of the offer. Driver base earnings stay 85%.
- A tip is 100% to the driver. It has no commission and no service fee. Stripe's fee on the tip is an expense.
- Older bookings keep the cents already stored.
