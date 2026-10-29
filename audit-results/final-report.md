# Pickuply audit report

Date: October 28, 2026. Branch `feat/overnight-audit`. Not merged and not deployed.

## Executive summary

The local database can take a customer request, match it to a covered online driver, refuse a second driver, walk a delivery and a junk job through proof, confirm delivery, record a capture, pay the driver 85% of a $50 offer, and record a $5 tip with no commission. A customer cannot read another customer's job or a driver's license row, and a customer cannot approve a driver. Production legal pages, the drive page, and login respond.

A headless Chromium session on the local app submitted a driver application with a profile photo and a license photo, an admin approved it, and the driver home showed an active driver who could go Online without an insurance card. The same browser opened Stripe Checkout for an isolated $150 posted-price job and Stripe test mode is holding `pi_3UVh6vD5IFQdbLky1weIezpw` for 15,750 cents. That browser job is `arrived` and `authorized`. The proof photo did not save, so that job was not captured. A separate isolated local job was captured in test mode. Connect created account `acct_1UVglpD5IFdeuy8H`. Payouts are not enabled, no transfer was created, and no payout object was created. A transfer would not be a bank deposit. WebKit was not installed. The local dev server later ran out of memory, so the remaining admin pages and the older Playwright file were not finished.

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
| Driver application onboarding | CONDITIONAL GO | Chromium submitted the application with both photos, admin approved it, and the driver went Online. Insurance is still missing. The driver page says to add the card and does not block Online. |
| Customer booking | CONDITIONAL GO | Chromium reached Stripe Checkout. Test PaymentIntent `pi_3UVh6vD5IFQdbLky1weIezpw` is `requires_capture` for 15,750 cents on job `ad2c7907-ba4c-4704-bb56-56d9ebb2876b`. The driver is `arrived`. Proof did not save, so this job is not captured. |
| Real paid delivery | NO-GO | Stripe is test mode. One isolated local job is captured. The browser job is only authorized. Neither is a live charge. |
| Real bank payout | NO-GO | Connect account `acct_1UVglpD5IFdeuy8H` has payouts disabled and details not submitted. Ledger row for the captured job is `held_until_onboarding`. No `tr_` transfer. No payout object. A transfer is not a bank deposit. |

## How to rerun

```text
npm run test:unit
node scripts/write-audit-report.mjs
```

The database script needs the local Supabase database container `supabase_db_pickuply`. It rolls back its own transaction.

## API-confirmed test payment — October 28, 2026

This booking is an **API-confirmed test payment**. The Checkout page was not opened.

| Item | Result |
| --- | --- |
| Isolated local job | `d98a71a7-58bc-4101-b66c-e34739ca1d11`, test data only |
| Customer / driver | Robin Returning / Riley Driver, both marked test |
| PaymentIntent | `pi_3UVglbD5IFQdbLky1i7abWq4`, manual capture, test mode |
| Test card | `4000000000000077` through Stripe test PaymentMethod `pm_card_bypassPending` |
| Charge | `ch_3UVglbD5IFQdbLky1HPF7JQS` |
| Amount | 5,250 cents authorized, then captured. Stripe fee 182 cents. Funds available 2026-10-29 00:00 UTC |
| Database | `completed` / `captured`. Driver earnings 4,250 cents. Commission 750 cents. Service fee 250 cents |
| Ledger | `held_until_onboarding`, 4,250 cents, no transfer id. Reason: Finish payout setup before a transfer can be sent |
| Recording | `prepare_checkout` then `apply_authorization` returned `accepted`, then `record_capture` and `post_driver_earnings`. Those are the same database functions a Checkout webhook uses after the card is confirmed |
| Checkout in the browser | **NEEDS JOSH.** Pay once with 4242 on your phone |
| Connect account | `acct_1UVglpD5IFdeuy8H`. Payouts are not enabled. Details are not submitted. A fresh onboarding link was created. Terms were not submitted by the test |
| Connect webhook secret | **NEEDS JOSH.** `STRIPE_CONNECT_WEBHOOK_SECRET` is not in the Vercel production environment |
| Platform webhook | Endpoint `we_1UUPtZD5IFQdbLkyQz2rWJv2` is enabled at `https://pickuplyapp.com/api/stripe/webhook`. It listens for payment events. It does not listen for transfer, account, or payout events |
| Stored webhook rows | Stripe events `evt_3UVglbD5IFQdbLky12Nl1xVo` (`payment_intent.amount_capturable_updated`) and `evt_3UVglbD5IFQdbLky1GTqkFxv` (`payment_intent.succeeded`) exist in test mode. The hosted `stripe_events` table has neither row |

Riley has one completed test job. After payout setup, the new-driver rule keeps this earnings row waiting 48 hours. That wait was not removed.

## Follow-up on October 28

`acct_1UVglpD5IFdeuy8H` is not onboarded. Stripe still reports `payouts_enabled` false, `charges_enabled` false, `details_submitted` false, and `disabled_reason` `requirements.past_due`. The past-due items are business category, product description, support phone, website, business type, bank account, date of birth, email, first name, last name, statement descriptor, and Stripe's own terms. No transfer and no payout were created. A transfer is not a bank deposit, and this account cannot receive one yet.

The payout-setup error "Valid types for this account are account_onboarding" is a code bug for an account that already submitted details. The fix retries with the type Stripe names. It is in pull request 37 and is not deployed, so the live site still shows the error.

Webhook events `evt_3UVglbD5IFQdbLky12Nl1xVo` and `evt_3UVglbD5IFQdbLky1GTqkFxv` still have `pending_webhooks` 1. Stripe's API does not return the attempt status code or response body. A bad signature from this app is HTTP 400 with body `{"ok":false}`. A signed test event using the provided test webhook secret got HTTP 200 and body `{"ok":true,"ignored":true}` from `https://pickuplyapp.com/api/stripe/webhook`, so the app's `STRIPE_WEBHOOK_SECRET` matches that secret. Stripe's own deliveries are still pending, so the secret on the Stripe endpoint may not be the one the app has. That endpoint secret cannot be read back.

## Review matrix — October 28, late

Transfers and payouts stay not verified. No eligible test account has payouts enabled.

| Check | Result | Evidence |
| --- | --- | --- |
| Driver Terms v2 revised | Ready for review | Pull request 37, commit `00c6442`. Not merged, not deployed, migration `0112` not applied. Georgia counsel still has to review injury, insurance limits, and the 48-hour sentence. |
| Public $250 promise | Removed from the draft | The public sentence no longer offers a dollar amount or a goodwill payment. |
| Stripe-generated webhook | BLOCKED | Events `evt_3UVglbD5IFQdbLky12Nl1xVo`, `evt_3UVglbD5IFQdbLky1GTqkFxv`, `evt_3UVhKKD5IFQdbLky0fnwysp9`, and `evt_3UVhKKD5IFQdbLky0Ojedv05` each still have `pending_webhooks` 1. None of those ids is in hosted `stripe_events`. Stripe's attempt API returns 404. A locally signed ping was accepted earlier, so the app secret matches the provided test secret, but Stripe's own signature has not produced a stored row. |
| $52.50 test hold | Canceled in Stripe | PaymentIntent `pi_3UVhKKD5IFQdbLky0Rzjx6FZ` is `canceled`, 5,250 cents, `livemode` false. Hosted job `086c4d7b-57ef-411a-84e4-81bae0ede760` is `cancelled` and `is_test`. A `payment_attempts` row says `canceled`. Payment status is still `awaiting_payment` because the authorization was never stored. The webhook did not write that row. |
| Connect webhook | BLOCKED | The only test endpoint is `we_1UUPtZD5IFQdbLkyQz2rWJv2` at `/api/stripe/webhook`. It does not subscribe to `transfer.created`, `transfer.updated`, `transfer.reversed`, `account.updated`, `payout.paid`, or `payout.failed`. There is no Connect endpoint. `STRIPE_CONNECT_WEBHOOK_SECRET` is not on Vercel. The app route is `/api/stripe/connect`. A secret and a redeploy are required before those events can be verified. No live Stripe setting was changed. |
| Payout-link fallback | PASS for unfinished accounts | Existing `acct_1UVglpD5IFdeuy8H` and new `acct_1UVhTxD5IFgxqSkr` both have `details_submitted` false. `account_onboarding` returned a link. `account_update` was rejected and the fallback returned an onboarding link. An account that has already submitted details and accepts `account_update` was not available. |
| Transfer | NOT VERIFIED | No `tr_` id. `payouts_enabled` is false on `acct_1UVglpD5IFdeuy8H`. |
| Payout | NOT VERIFIED | No payout object. A test payout would not be a bank deposit. |
| Driver onboarding in the browser | PASS, earlier this evening | License photo, admin approval, and driver home were recorded in the browser continuation below. Not repeated in this pass because that driver is already active. |
| Admin to customer message | PASS | Thread `6d863c93-37cf-4583-a540-f00ce6d65ce1`. The customer saw an unread support note, replied "Customer reply received.", and that row is stored for customer `1adff874-cf13-4f4f-aebb-4ea71bae60de`. Admin then saw the reply. After opening, the inbox said Read. |
| Admin to driver message | PASS | Thread `ed7e2776-6406-417a-a6b1-4a1d634ef0e8`. The driver saw the unread note and the stored reply is "Driver reply received." The customer account did not see that thread. |
| Support tickets | PASS | Local ticket `PLY-72739156` (`1f8d4c8d-608e-482a-ad56-7a6f0d718779`) was filed by the driver. Admin reply "Admin reply on the driver ticket." is stored as kind `admin`. An internal note is stored as kind `internal`. Signed in as the driver, `/contact/tickets/1f8d4c8d-608e-482a-ad56-7a6f0d718779` shows the Pickuply reply and does not show the internal note. |
| WebKit | Unavailable | Chromium only. |

## Launch decision — October 28, follow-up

These labels are for the current test build. They are not approval to turn on live payments, merge, or deploy.

| Lane | Decision | Why |
| --- | --- | --- |
| Driver applications | CONDITIONAL GO | Chromium submitted a license photo, an admin approved it, and the driver home showed an active driver who could go Online. There are no background checks in v1, and the page does not claim them. A missing insurance upload does not block Online after approval. An expired uploaded policy does. Driver Terms v2, including the new insurance duties, is not published. Existing drivers are still on v1 until migration `0112` ships with the app. |
| Paid bookings | NO-GO | A local API-confirmed test capture exists, and one browser Checkout hold is `requires_capture`. On pickuplyapp.com the Stripe TEST webhook deliveries stay pending, so a hosted payment is not recorded on the job. Checkout on a phone with card 4242 is still untested. |
| Full deliveries | NO-GO | The browser job reached `arrived` and the proof photo did not save, so that job was not captured. The separate captured job was an API test, not a full browser delivery. Hosted payment state would also stay behind until a Stripe-signed event is stored. |
| Driver payouts | NO-GO | `acct_1UVglpD5IFdeuy8H` has `payouts_enabled` false. No transfer id and no payout id. The Connect webhook and `STRIPE_CONNECT_WEBHOOK_SECRET` are missing. A transfer would not be a bank deposit. |

## Why the $52.50 hold did not reconcile

PaymentIntent `pi_3UVhKKD5IFQdbLky0Rzjx6FZ` reached `requires_capture` in Stripe TEST for hosted test job `086c4d7b-57ef-411a-84e4-81bae0ede760`. Event `evt_3UVhKKD5IFQdbLky0fnwysp9` (`payment_intent.amount_capturable_updated`) stayed at `pending_webhooks` 1 and was never inserted into `stripe_events`, so `apply_authorization` never ran. The job stayed `assigned` and `awaiting_payment`. The PaymentIntent was then canceled. Cancel event `evt_3UVhKKD5IFQdbLky0Ojedv05` also stayed pending.

`note_authorization_canceled` always inserts `payment_attempts.outcome = canceled`. It sets `payment_status` to `canceled` only when the job is already `authorized` and the stored PaymentIntent matches. This job was still `awaiting_payment`, so the function left that status and did not release the assignment. A later successful cancel webhook would do the same. The job was then marked `cancelled` under the replica role so it would not stay assigned or text admins. It remains `is_test`, `cancelled`, and `awaiting_payment`.

A safe reconciler, not built and not deployed, would run on the server in test mode only until live payments are approved. It would retrieve the PaymentIntent and then call the same database functions the webhook uses:

- Stripe `requires_capture` and the job still `assigned` / `awaiting_payment`: call `apply_authorization`.
- Stripe `canceled` and the job was never authorized: record the attempt and release the assignment the way an unpaid timeout does. Do not mark it `canceled` as if a hold had been stored, and do not notify admins for an `is_test` job.
- Stripe `canceled` and the job is already `authorized`: call `note_authorization_canceled`.

The job should be idempotent on the PaymentIntent id, claim the Stripe event id when one exists, and never create or capture a charge.

## Legal document gaps (not software)

Nothing in this section was published. The drafts are for a lawyer to review.

### 1. The page a driver accepts is not a driver agreement

Current wording on `/terms/driver`:

> Version driver-terms-v1. A driver accepts these terms by checking the box on the application. Pickuply does not check that box.

> The Terms of Service and Privacy Policy also apply.

The application checkbox stores version `driver-terms-v1`. The page does not state insurance, accidents, cargo, damage, or how a claim is made.

Risk: a driver can honestly say they never agreed to a driver agreement. The Terms of Service talk about duties that this page does not repeat.

Draft for review:

> Driver Terms, version driver-terms-v1. By checking the box, you agree to the Pickuply Terms of Service and Privacy Policy, and to these Driver Terms. You are an independent provider. You are responsible for your vehicle, your license, and the insurance your work requires. Pickuply does not insure you, your vehicle, or the items you move. You must report an accident, injury, or damage to info@pickuplyapp.com and to your insurer. Pickuply does not check this box for you.

### 2. The Terms require coverage the accepted page never states

Current wording in the Terms of Service, "Driver requirements and separate Driver Terms":

> Drivers must maintain, at their own expense, all insurance legally required for the vehicles and services they perform, including applicable commercial auto, for-hire, cargo, general liability, or other coverage where required by law or by Pickuply's separately disclosed Driver requirements.

> Personal auto insurance may exclude delivery or for-hire activity; Drivers are responsible for confirming coverage directly with their insurer before accepting jobs.

> Drivers must promptly disclose insurance lapses and may not accept jobs without required coverage.

> Separate Driver Terms may impose additional lawful obligations and should be reviewed and accepted before drivers perform paid services.

Risk: the duties sit in the Terms of Service, while the box the driver checks points at a page that does not contain them. A personal auto policy may not cover paid delivery. If a crash happens, the driver and the customer may both say Pickuply approved the driver without a coverage agreement.

Draft for review:

> Before accepting a paid job, you must have the insurance Georgia law requires for the vehicle and for paid hauling, delivery, or junk removal. A personal auto policy often excludes that work. Pickuply does not sell you a policy, does not promise that a policy you upload is enough, and does not pay your deductible. If you do not have the required coverage, do not go Online and do not accept a job.

### 3. The product spec still has a $250 damage figure the Terms do not promise

Current wording in the Terms of Service, "Safety, damage and disputes":

> Pickuply does not promise insurance coverage or reimbursement for these events.

Current wording in "Independent Driver responsibility and insurance claims":

> Pickuply is not an insurance company and does not undertake to pay, defend, settle, or reimburse a Driver's or Customer's losses merely because a booking was arranged through the platform.

The product spec still says the damage coverage limit is $250 per job, and that an admin may resolve a report as "damage covered (up to $250)." The public Help page does not state $250. It says Pickuply reviews a report and there is no automatic refund.

Risk: staff following the spec could pay up to $250 that the published Terms say Pickuply does not promise. A customer who hears "$250 coverage" could believe Pickuply is insuring the load.

Draft for review, if the $250 review cap is kept:

> Pickuply does not insure items and does not promise reimbursement. If you report damage within 48 hours of delivery and include photos, Pickuply may review the report. Any goodwill payment is discretionary, is not insurance, and will not exceed $250 for that job. Damage already visible in the pickup photos, customer-packed items, loose parts, and normal wear are outside that review.

Draft for review, if no dollar amount should be offered:

> Pickuply does not insure items and does not promise a refund or a damage payment. Report damage to info@pickuplyapp.com with photos. Pickuply may look at the report and the job record. That review is not a claim adjustment and is not an agreement to pay.

### 4. The 48-hour damage report is in Help, not in the Terms

Current Help wording:

> Report damage within 48 hours of delivery and include photos. Pickup photos are the before picture. Damage already visible at pickup is not covered. Pickuply reviews the report. There is no automatic refund.

Current Terms wording:

> Customers and Drivers should document item condition and promptly report incidents to info@pickuplyapp.com.

Risk: Help tells people they have 48 hours. The contract only says "promptly." Someone can miss 48 hours and still say they reported promptly, or can report on time and still have no right to a payment.

Draft for review:

> Report loss or damage to info@pickuplyapp.com within 48 hours after delivery, and include photos. Pickup photos are the record of condition at pickup. Pickuply may close a report it receives after 48 hours. Sending the report does not by itself create a payment.

### 5. The disclaimer is broad, and the driver page adds no claims steps

Current wording in "Disclaimers and legal terms":

> PICKUPLY IS NOT RESPONSIBLE FOR LOSSES ARISING FROM AN INDEPENDENT DRIVER'S TRANSPORTATION OPERATIONS, VEHICLE ACCIDENTS, TRAFFIC VIOLATIONS, PERSONAL INJURIES, DEATH, CARGO LOSS OR THEFT, PROPERTY DAMAGE, LOADING OR UNLOADING, OR DISPUTES BETWEEN CUSTOMERS, DRIVERS, BUYERS, SELLERS AND OTHER THIRD PARTIES, EXCEPT TO THE EXTENT CAUSED BY PICKUPLY'S OWN ACTS OR OMISSIONS FOR WHICH LIABILITY CANNOT LAWFULLY BE DISCLAIMED.

> NOTHING HERE EXCLUDES LIABILITY FOR FRAUD, WILLFUL MISCONDUCT, GROSS NEGLIGENCE, OR ANY OTHER LIABILITY THAT CANNOT BE EXCLUDED UNDER APPLICABLE LAW.

The driver page has no deductible, no cargo limit, and no accident-reporting steps.

Risk: a Georgia lawyer needs to say whether this disclaimer reaches too far for injury or death. The sentence that saves non-waivable liability is present. The missing piece is a plain claims path: who to call, how fast, and that Pickuply is not the insurer.

Draft for review:

> If there is an accident, injury, or damage, contact 911 when someone is hurt, then contact your insurer and info@pickuplyapp.com. Pickuply can share the job record. Pickuply does not defend the claim, does not pay the deductible, and does not become the insurer because the job was booked here. Nothing in these terms waives a right that Georgia law does not allow to be waived.

### 6. Privacy refers to a Driver Agreement that is not on the driver page

Current wording in the Privacy Policy:

> Drivers remain responsible for obtaining and maintaining insurance required by applicable law, their vehicle use, and the applicable Driver Agreement.

> Pickuply's collection or review of documents is not a guarantee of driver qualifications, driving history, insurance coverage, or fitness to perform services.

Risk: "Driver Agreement" sounds like a document the driver signed. The live driver page is a version line plus two links. A dispute could turn on which sentences the driver actually accepted.

Draft for review:

> Drivers remain responsible for the insurance required by law and by the Terms of Service and Driver Terms they accept in the app. Pickuply's review of an uploaded document is not a statement that the driver is insured or qualified.

## Browser continuation — October 28, 2026 evening

Chromium only. WebKit is not installed, so it is unavailable, not a product failure. The local Next server used webpack because Turbopack ran out of memory. The server later hit the 2 GB heap limit while compiling admin pages and closed the port. Those closed-port results are not product failures.

| Check | Result | Evidence |
| --- | --- | --- |
| Driver application in the browser | PASS | Riley submitted profile and license photos, coverage Austell, license expiration 2027-12-31. Database: `pending_review`, license present, photo present, terms `driver-terms-v1`. |
| Admin approval | PASS | Admin used Approve anyway because insurance was not uploaded. Driver page shows active. Database status `active`. |
| Driver-facing status | PASS | Driver home has no in-review banner. It shows "Add your insurance card." The Online switch worked. Database `active` and `is_online` true. The checklist still lists insurance and training as to do, and its copy still says approval is pending. That copy is stale. It did not block Online. |
| Browser Checkout authorization | PASS, not captured | Job `ad2c7907-ba4c-4704-bb56-56d9ebb2876b`, posted $150, status `arrived`, payment `authorized`. PaymentIntent `pi_3UVh6vD5IFQdbLky1weIezpw`, 15,750 cents, `requires_capture`, `livemode` false, `amount_received` 0. |
| Browser delivery and capture | NOT VERIFIED | The proof control did not keep the selected photo, so Save proof produced no status message and no `job_photos` row. Capture was not run for this job. |
| Separate captured test job | PASS for test capture only | Job `d98a71a7-58bc-4101-b66c-e34739ca1d11`. PaymentIntent `pi_3UVglbD5IFQdbLky1i7abWq4` succeeded, 5,250 cents, manual capture, test mode. Charge `ch_3UVglbD5IFQdbLky1HPF7JQS`. Ledger `held_until_onboarding`, 4,250 cents, no transfer id. |
| Connect account | PASS for account creation only | Browser opened Stripe from driver earnings. Account `acct_1UVglpD5IFdeuy8H`. `payouts_enabled` false. `charges_enabled` false. `details_submitted` false. Stripe still requires business profile, representative, bank account, and terms acceptance. |
| Transfer | NOT VERIFIED | No `tr_` id. The captured ledger row says finish payout setup before a transfer can be sent. |
| Payout | NOT VERIFIED | No payout object was created. A test-mode payout would not be a bank deposit. |
| Admin-to-customer message | PASS, later the same evening | Thread `6d863c93-37cf-4583-a540-f00ce6d65ce1`. Unread, customer reply stored, admin saw the reply. |
| Admin-to-driver message | PASS, later the same evening | Thread `ed7e2776-6406-417a-a6b1-4a1d634ef0e8`. Driver reply stored. Customer could not see it. |
| Admin support tickets | NOT VERIFIED | Contact forms sent. The admin reply form was not finished before the test limit. |
| Admin pages | PARTIAL | Dashboard, Drivers, Customers, and Payments loaded. Requests did not show the expected heading before the server died. Payouts, Finance, Alerts, Feedback, Accounts, Health, and Settings were not reached. Refund, pause, delete account, outside payment, and test-data cleanup were not executed. |
| Older Playwright file | NOT VERIFIED | Not rerun to completion after the server recovered. |

