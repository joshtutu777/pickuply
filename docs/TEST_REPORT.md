# Pickuply Task 3 test report

Date: 2026-10-24. Local only. Nothing in this pass was pushed, deployed, or applied to hosted Supabase, Stripe, Twilio, or Vercel.

## 1. Executive summary

The approved review feature, the 48-hour transfer hold for new drivers, and the self-dealing block are implemented and covered by local database tests. Fee math in `lib/fees.ts` matched the local database `price_breakdown` on 1,000 comparisons. Typecheck, lint of the touched files, the unit suite, and a production build passed.

The broad marketplace walk (50 synthetic scenarios, three browsers, load, axe, and a new Stripe lifecycle) was **not run** in this pass. Those items are Not Run, not Passed. Earlier Stripe test-mode work remains the evidence for capture and refund behavior; it was not repeated here.

## 2. Environment and safety checks

- Database target for the new tests: local Docker database `supabase_db_pickuply`. Passed.
- Migrations `0058` and `0059` were applied only to that local database and recorded in its `schema_migrations`. They are not on the hosted project.
- No edits to `.env.local` or `.env.test.local`.
- No live Stripe key was used. The fee comparison used SQL only. No charge, capture, refund, transfer, or payout was created in this pass.
- Reserved manual numbers 5555550201 through 5555550205 were not used.
- Synthetic rows in the database tests use `@pickuply.test` emails inside a transaction that rolls back. They are not seed data and are not in a migration that would run on a hosted database.

## 3. Commit hashes

Task 1 landing: `c1ff24e5292ee60e294a242d35fa5215ecdc0945` (already pushed before this task).

Task 2 finance: `5a4748114c9234b96110d93f710256a44491942a` (already pushed before this task).

Task 3 implementation: `5a0490b44244612ddafa582752079412802aca41`. The commit that adds this report follows it. Neither was pushed.

## 4. Synthetic identities

Not created as a standing fixture set. The database tests create four review users and three payout users inside a rolled-back transaction. The requested set of 10 customers, 8 drivers, 2 admins, and 50 request scenarios was **Not Run**.

## 5–13. Scenario matrices

Request creation, driver feed waves, offer counts, messaging, admin operations, and the notification event list were inventoried in code and **Not Run** as end-to-end tests in this pass.

What the code already contains, from a static audit:

- Phone OTP through Supabase. No password login.
- Four services: delivery, free_item, construction (store delivery), junk.
- Pricing methods stored: quote (Get offers), fixed, range. Admin quote is not a separate stored method.
- Driver feed sections when waves are off, coverage match, and Georgia page. Waves flag exists.
- Offers: one active offer per driver, five active offers per job, server-side minimums.
- Messages reject phone numbers and emails.
- In-app notifications with a dedupe key. Push and email senders exist and can no-op. SMS stays off unless explicitly enabled.
- Stripe manual capture, ledger, disputes, and recovery are already built. A transfer is not a bank payout.
- Admin finance report from Task 2.
- Audit log on admin actions that already call it, including hiding a review.
- Proof photos are re-encoded through a canvas. This pass also re-encodes driver documents and chat images.

## 14. Notification coverage

**Not Run** as a matrix. `note_review_windows` is called from the notifications cron after the existing reminder scan. `vercel.json` still schedules only `/api/cron/funnel-retention`. The other cron routes exist and require `Authorization: Bearer CRON_SECRET`. They are not configured as hosted jobs.

## 15. Stripe test-mode evidence

**Not Run** in this pass. No new PaymentIntent was created. Prior local Stripe test-mode capture evidence is in the payment commit `681fb6d`, not re-executed here.

## 16. Finance reconciliation

Task 2 unit tests still pass, including missing Stripe fees shown as Unavailable. A fresh browser pass of `/admin/finance` was **Not Run** in this pass. Screenshots from Task 2 remain in `test-results/finance/`.

## 17. Reviews and ratings

**Passed. Real local database integration test.** `supabase/tests/0058_job_reviews.test.sql`: 9 tests.

- A stranger cannot review.
- The customer can review a completed job.
- The same person cannot review twice.
- The driver cannot read the customer review before both are in.
- The driver can review the customer.
- Both reviews make the customer review visible.
- A customer cannot hide a review.
- An admin can hide a review.
- Hiding does not change the stars or the text.

Offer cards read completed-trip counts and published customer-review averages from the database, not from the unused `drivers.rating_avg` column. The screen was not opened in a browser in this pass.

## 18. Payout protection

**Passed. Real local database integration test.** `supabase/tests/0059_payout_hold_self_deal.test.sql`, first two cases.

- With payouts enabled and the card funds already available, a driver who has fewer than five completed jobs stays `pending` with the reason "Earnings stay held for 48 hours after a new driver finishes a job."
- After `jobs.updated_at` is 49 hours earlier, the same row becomes `ready`.

Not covered in this pass: the fifth completed job switching back to the short delay, an open dispute during the 48 hours, a duplicate transfer, or a real Stripe transfer. The refresh function still checks disputes and payout setup before the 48-hour wait, and transfer idempotency is unchanged. Those paths were **Not Run** this pass.

Established drivers (five or more completed jobs) still use `payout_delay_seconds` when set, otherwise `payout_delay_hours`. Customer authorization and capture timing were not changed.

## 19. Real-world pickup failures

**Not Run.** No new proof-photo or GPS rule was added.

## 20. Fraud and abuse

Self-dealing is covered below. Offer minimums, five-offer cap, and message contact blocking already exist and were **Not Run** again. No new punishment rules were added.

## 21. Photo privacy

Request photos and proof photos were already redrawn to JPEG, which drops EXIF. Driver profile, license, insurance, and vehicle photos, and chat images, now go through the same re-encode before upload. PDFs are left as files.

**Not Run** against a real GPS-tagged file. A client that uploads straight to Storage, skipping the app, can still store the original bytes. That bypass is a remaining limitation, not a hosted change.

## 22. Fee parity

**Passed. Real local database integration test plus unit test.**

500 amounts from $35.00 upward, each run as forward and as accept (1,000 comparisons). `lib/fees.ts` matched `public.price_breakdown` on every amount both sides accepted. 23 accept amounts were rejected by both sides (the total cannot pay the driver). Mismatches: 0.

This did not change the fee formula. It did not read Stripe balance transactions.

## 23. Self-dealing prevention

**Passed. Real local database integration test.** Same file as the payout test.

- The person's own open request is absent from the matched feed and the Georgia page.
- `submit_offer` raises "this driver cannot offer on this job."
- `driver_is_eligible_for_job` returns false for that request.

Direct API calls beyond these functions were **Not Run**.

## 24. DST and time

**Passed. Unit test.** `midnightInNewYork` now resolves America/New_York midnight on the date itself, instead of using the offset at noon. Checked:

- 2026-10-24 midnight is 04:00 UTC.
- 2026-03-08 midnight is 05:00 UTC, and 2026-03-09 is 04:00 UTC.
- 2026-11-01 midnight is 04:00 UTC, and 2026-11-02 is 05:00 UTC.

The 48-hour hold uses `interval '48 hours'` (elapsed time), not a calendar date. The 24-hour auto-complete path was **Not Run** again.

## 25. Feed distribution

Self-request exclusion is tested. Waves on and off, sorting, and pagination were **Not Run**.

## 26. Uploads

Code change only. Invalid, oversized, and interrupted uploads were **Not Run**.

## 27. Accessibility

**Not Run.** No axe run in this pass.

## 28. PWA

A manifest and service worker already exist. Installation, update, and cache refresh were **Not Run**. No new PWA was added.

## 29. Performance

**Not Run.** No local load test.

## 30. Scheduler reliability

Static audit. Routes exist for payment deadlines, auto-complete, transfers, notifications, and funnel retention. Only funnel retention is in `vercel.json`. Hosted cron was not configured. Double-run behavior of transfers still uses the ledger idempotency key; it was **Not Run** this pass. Review-window notices run only when the notifications cron runs.

## 31. Privacy and RLS

The new review policies were tested for stranger, participant, and admin. Cross-customer job access, photo URLs, and account deletion were **Not Run**.

## 32. Admin audit logs

Hiding a review writes `audit_log` with the admin id, action `hide_job_review`, review id, job id, and star count. It does not store the review text. A denied hide throws and does not write a success row. The audit insert itself was not asserted in the test. **Partial.**

## 33. Landing legal links

Static audit of `components/landing/landing-page.tsx`: Terms links to `/terms`, Privacy links to `/privacy`. The public footer has no Admin link. A fresh browser check was **Not Run** this pass. Earlier landing screenshots are in `test-results/landing/`.

## 34. Production readiness

| Item | Status |
|---|---|
| Phone OTP | NOT VERIFIED this pass |
| Service role on the normal app process | NOT READY. Checkout still needs the server-only key. |
| Stripe test/live split | READY in code (`sk_test_` required). Live mode not enabled. |
| Webhook signature check | NOT VERIFIED this pass |
| Hosted schedulers | NOT READY. Only one cron is listed, and hosted cron was not turned on. |
| Authorization expiry before a far-ahead pickup | NEEDS JOSH'S DECISION. Not measured this pass. |
| Transfer failure monitoring | NOT VERIFIED this pass |
| Finance reconciliation | NOT READY for launch. Stripe reads are capped and fees can be Unavailable. |
| Migrations 0058 and 0059 | NOT READY for hosted. Local only. |
| RLS on new review table | READY in the local test |
| Google Maps key restrictions | NOT VERIFIED |
| Twilio | NOT READY by choice. SMS stays off. |
| Backups and rollback docs | NOT VERIFIED |
| Legal links | READY in the landing source |
| This pass as proof of production | NOT READY |

## 35. Bugs found and fixed

- Finance date windows used the New York offset at noon, so the start of a daylight-saving day could be an hour off. `midnightInNewYork` now finds local midnight. Unit test covers March 8 and November 1, 2026.

## 36. Remaining defects

- Admin hide is available on the completed job page, not as its own queue.
- A direct Storage upload can skip the JPEG re-encode.
- The 48-hour rule is applied when the transfer job refreshes the ledger. The earnings page explains the hold. It does not move money by itself.
- Most of sections 2–12 and 16–29 were not executed.

## 37. Needs Josh's decision

1. **Bookings 8, 9, and 10 days ahead.** This pass did not create those PaymentIntents. The app stores Stripe's `capture_before`. If that deadline is before pickup, the choices are: authorize closer to pickup, limit how far ahead a job can be booked, or reauthorize with the customer's consent. No booking-window change was made.
2. **Late-cancel fee.** The spec and help text describe a $15 partial capture. The finance report still shows that portion as Not tracked. Confirm whether that fee should be built before treating it as live.
3. **Account deletion during an active job.** No deletion policy was added.
4. **Damage and liability.** No coverage, limit, or automatic refund rule was added. Reports and the existing refund tools remain the path.
5. **Rate-limit numbers** for OTP, requests, offers, messages, and help were not invented.
6. **How long financial records are kept** after an account deletion request. Nothing is deleted by this pass.

## 38. Screenshot paths

No new screenshots in this pass. Earlier ones:

- `test-results/landing/`
- `test-results/finance/`

## 39. Test artifact paths

- `supabase/tests/0058_job_reviews.test.sql`
- `supabase/tests/0059_payout_hold_self_deal.test.sql`
- `lib/admin/finance.test.ts` (daylight-saving midnight)
- `lib/fees.test.ts` and the one-off database comparison (script removed after the run)

## 40. Totals for tests actually executed

| Result | Count | What |
|---|---:|---|
| Passed | 9 | Review database tests |
| Passed | 5 | Payout hold and self-dealing database tests |
| Passed | 114 | Unit suite, including the daylight-saving midnight cases |
| Passed | 1000 comparisons | Fee parity, 0 mismatches, 23 rejected by both sides |
| Passed | 1 | Typecheck |
| Passed | 1 | Lint of the files this pass changed |
| Passed | 1 | Production build |
| Failed | 0 | |
| Blocked | 0 | |
| Not Run | The rest of the requested browser, Stripe, load, axe, and scenario matrix | |

## 41. Local-only confirmation

No git push. No deploy. No hosted database, Stripe, Twilio, Vercel, or DNS change. No live charge.
