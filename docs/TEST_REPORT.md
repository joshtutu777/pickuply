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
3. **Damage and liability.** No coverage, limit, or automatic refund rule was added. Reports and the existing refund tools remain the path.
4. **Rate-limit numbers** for OTP, requests, offers, messages, and help were not invented.

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

# Task 4 — User Suspension, Reinstatement, Account Deletion & Account Security

Date: 2026-10-24. Local only. Nothing in this pass was pushed, deployed, or applied to hosted Supabase, Stripe, Twilio, or Vercel.

## 1. Executive summary

Admins can suspend and reinstate a customer or a driver. A suspension pauses open requests that have no driver and closes offers that have not been accepted. Accepted bookings, payments, and earnings stay as they are. The person can still sign in and sees their own restriction. Delete Account is on Profile. An account with an open job or open money stays pending instead of being erased. A restricted phone is blocked from new marketplace use only when the database setting `pickuply.phone_hmac_secret` is set. That secret is not in the migration and was not written to an env file.

## 2. Existing functionality discovered

Offline is the driver's own online switch. Paused is the existing driver status and the existing admin pause on a request (`paused_at`). Neither was reused as the suspension flag. Suspension is a row in `account_suspensions`. A request paused only because of a suspension is marked `suspension_hold`, so an ordinary admin pause is not cleared on reinstatement. Phone OTP is unchanged. `choose_offer` still says "that offer is no longer available" when the offer is not active.

## 3. New functionality implemented

Suspend, extend, reinstate, and expire. Customer and driver notices. Delete Account with a checkbox and the word DELETE, plus a recent sign-in check. Pending deletion when blockers exist. Anonymization when they do not. Admin queue at `/admin/accounts`. Last-admin and self-suspension checks in the database.

## 4. Database migrations

`supabase/migrations/0060_account_suspension.sql` was applied only to the local Docker database and recorded as version `0060`. It is not on the hosted project.

## 5. Customer suspension behavior

A suspended customer can still sign in. The home notice uses the temporary sentence only when the restriction has an end time. An indefinite restriction does not say "temporarily." New requests and choosing an offer are rejected in the database. History stays available. The browser check signed in with a local test phone and opened `/account/delete`. No real SMS was sent.

## 6. Driver suspension behavior

A suspended driver cannot submit an offer or claim a job. The database test asserts that sentence. Existing assigned jobs are not cancelled. Earnings rows are not placed on hold by this change.

## 7. Offer invalidation

Suspending a driver sets unaccepted offers to `expired` and sets `unavailable_at`. Choosing one returns "that offer is no longer available." Reinstatement does not turn those offers back on.

## 8. Request pause and reinstatement

An open request with no assigned driver gets `paused_at` and `suspension_hold`. An assigned job does not. Reinstatement clears the pause only when the request is still open, unassigned, and not past its quote time. The feed hides a paused request. After the suspension time has passed, eligibility does not keep waiting for the scheduled job.

## 9. Neutral messaging

Other people see "that offer is no longer available" or "This request is no longer available." The restriction reason and the internal note are not in those errors. The reason is on the admin screen only. Customers cannot update `account_suspensions` (database error 42501 in the security test).

## 10. Temporary suspension expiration

`account_is_suspended` is false once `expires_at` is in the past, even before `expire_due_suspensions` runs. That function is idempotent and restores a still-open request. The notifications cron calls it. No new hosted cron was added.

## 11. Active-job handling

The database test keeps an assigned, authorized job assigned after the driver is suspended. No refund, fee, or transfer change was made. Whether a suspended driver should keep moving that job is listed under Needs Josh's decision. The in-progress status buttons were not blocked.

## 12. Customer deletion flow

Profile → Account management → Delete Account. The page explains that deletion is permanent once completed, that some records stay, and that it may wait. A wrong confirmation shows "Check the box and type DELETE to continue." That path was exercised in the browser against the local app and did not delete the account. A customer with no obligations is anonymized. A customer with an assigned authorized job stays pending, and the phone stays.

## 13. Driver deletion flow

The same Delete Account page is on the driver profile menu. The eligibility check includes the driver's assigned jobs and open ledger rows. A driver-only deletion with no history was not given its own database test.

## 14. Dual-role account handling

Suspension and deletion use `profiles.id`, so both roles are the same account. A test that is only a dual-role person was not run.

## 15. Personal-data deletion

An eligible deletion sets the name to "Deleted account", clears phone, email, and photo, sets `deleted_at`, removes push rows, and deletes auth sessions and refresh tokens. The profile id stays so job rows still point at someone. Auth users are not deleted, because that would cascade into jobs. Storage file bytes are not removed.

## 16. Financial record retention

Ledger rows, payments, and disputes are not deleted. A deletion with an authorized payment or an active job stays pending.

## 17. Restricted re-registration

If the account is suspended at deletion and the HMAC secret is set, the phone is stored only as an HMAC. A later request or offer from that number is rejected with "This phone number cannot be used for Pickuply right now. Contact support if you think this is a mistake." A normal deletion stores nothing, so the number can register again with no old profile.

## 18. Phone HMAC protection

The secret is `current_setting('pickuply.phone_hmac_secret', true)`. It is not in the migration, the table, or an env file. The deletion test set it inside the rolled-back transaction. If the setting is missing, `phone_is_restricted` stays false. Before this is real on a hosted database, set that configuration on the database only, outside git. Do not put the secret in `.env.local`.

## 19. Admin-account safeguards

An admin cannot suspend themselves. One of two admins can be suspended. A suspended admin cannot suspend or delete the last active admin. An admin deletion request through Profile stays pending in the function and is not erased automatically. That self-service admin path was not given its own browser test. Buttons are not the enforcement.

## 20. Notification results

Suspension and reinstatement insert an in-app notification for the person. Active jobs notify admins that the booking was not cancelled. SMS stays off. No push was sent. The cron call was not executed against a live scheduler.

## 21. RLS and authorization results

`account_suspensions` has no customer write grant. The security test got SQLSTATE 42501. `suspend_account` and `complete_account_deletion` reject a non-admin. Passed in pgTAP. Direct HTTP calls from a second browser were not run.

## 22. Audit log results

Suspension, extension, reinstatement, expiration, deletion request, and deletion completion write `audit_log`. The security test checks that an extension writes `extend_suspension`. Log text does not include an OTP or the HMAC secret.

## 23. Test scenarios executed

Database, all passing, transactions rolled back:

- Customer cannot suspend. Admin cannot self-suspend. Last active admin cannot be suspended or deleted. One of two admins can be suspended.
- Driver suspension expires the open offer and leaves the assigned job assigned.
- Customer suspension pauses the open request. Reinstatement restores that request and leaves the offer expired.
- Choosing the closed offer returns the existing unavailable sentence. A driver offer on the paused request returns "This request is no longer available."
- Expired time lifts the restriction before the expire function, and running that function twice restores the request.
- Clean deletion anonymizes and does not block the phone. Busy deletion stays pending and keeps one request row. An old sign-in cannot delete. A suspended deletion stores an HMAC that is not the phone number.
- A customer cannot update the suspension table or complete someone else's deletion. An extension is audited.

Browser, local app at `http://127.0.0.1:3001`, one Chromium tab:

- Signed-out `/account/delete` goes to login and returns there after the local test code.
- The page shows the permanence, records, and delay copy, the checkbox, and the DELETE field.
- Submitting without the checkbox shows the confirmation warning and does not delete.
- Profile shows Account management and Delete Account.
- `/admin/accounts` shows the empty deletion list.
- A driver detail page shows Suspend Account, the reason, the internal note, active jobs, and history.

## 24. Passed / Failed / Blocked / Not Run

| Result | Count | What |
|---|---:|---|
| Passed | 12 | Suspension database tests |
| Passed | 22 | Deletion database tests |
| Passed | 7 | Security database tests |
| Passed | 5 | Existing payout-hold regression |
| Passed | 120 | Unit suite, including 6 restriction-copy cases |
| Passed | 1 | Typecheck |
| Passed | 1 | Lint of the files this pass changed |
| Passed | 1 | Production build |
| Passed | 1 | Local browser pass of delete confirmation, profile link, accounts page, and the suspend form |
| Failed | 0 | |
| Blocked | 1 | Phone HMAC does nothing until `pickuply.phone_hmac_secret` is set on the database. The test set it only inside a rolled-back transaction. |
| Not Run | Playwright customer, driver, and admin projects; Firefox; WebKit; axe; load; saved screenshots; concurrent HTTP races; refund, dispute, payout-hold, and dual-role fixtures; a new offer after reinstatement; admin self-deletion in the browser | |

Reserved numbers 5555550201 through 5555550205 were not used.

## 25. Bugs fixed

Extending a suspension failed because the note column and the function argument shared a name. The update now uses the argument. Deleting refresh tokens failed because that user id is text, not uuid. The delete casts it.

## 26. Remaining defects

Storage object bytes for photos and documents are not deleted with the account. The profile row remains so jobs keep a foreign key. There is no screen that lets a person cancel a pending deletion request. In-progress job buttons still work for a suspended driver, on purpose, until the delivery question below is decided.

## 27. Needs Josh's decision

These were resolved by the approved account rules and are no longer open: suspended drivers finishing an in-transit delivery, flagging an assigned job that has not started, payouts during suspension, deletion blockers, the 14-day cancellation window, Stop Driving for someone who is also a customer, the help-request appeal, HMAC retention, expired temporary restrictions, and removing the last admin.

Phone reuse after 12 quiet months, recovery when every admin sign-in is lost, and the 365-day dispute photo rule are now decided. See `docs/DEPLOYMENT.md` and migration `0063_account_followups.sql`.

## 28. Screenshots and artifact paths

No screenshot files were saved. The browser check was a live local session, not a saved image.

## 29. Local Git commit hashes

Implementation: `48f7e3043b71eb17a34494b9119dc9c54490f8c9`. The commit that adds this Task 4 section follows it. Neither was pushed.

## 30. Confirmation that no hosted changes occurred

No git push. No deploy. No hosted database, Stripe, Twilio, Vercel, or DNS change. No live charge. No real SMS, email, or push. `.env.local` and `.env.test.local` were not edited.

## 31. Policy follow-up

Local only. The two earlier Task 4 commits were not rewritten. Migration `0061_account_policy.sql` applies the nine approved rules. There is no `/admin/customers/[id]` page. The instruction for that page was cut off, so customer suspension stays on the request page and the driver page. Task 3 sections 2–12 and 16–29 were not run again.

The phone-protection secret is in local Supabase Vault under the name `phone_hmac_secret`. A copy stays in the ignored `.local/phone-hmac-secret` file. The value is not in git. `ALTER DATABASE` cannot set `pickuply.phone_hmac_secret` on this local database. The function reads that setting when it is present, and Vault only when the setting is unset. An empty setting does not fall through to Vault. A missing secret blocks a new registration and leaves a restricted deletion pending. It does not block an existing account.

## 32. Policy tests executed

Database, rolled back:

- An assigned job is flagged. A job already in transit is not. The suspended driver cannot start the assigned job. The in-transit job reaches the delivery-photo check. A direct price change on the flagged job is rejected. Reassignment keeps the authorized payment.
- Suspension alone leaves earned pay ready. An open dispute then holds that pay.
- A customer who also drives can stop driving, keep the phone, close the unaccepted offer, and clear the license. A driver-only account with open pay stays signed in and does not lose the phone.
- Deletion stays pending for 14 days, can be cancelled during those days, and cannot be cancelled after. A clear account is deleted once. A second run does not complete it again. A remaining blocker does not move the saved end time.
- With the secret cleared inside the test, a restricted deletion keeps the phone and a new registration is refused.
- The last remaining admin cannot be demoted.

A separate local script demoted two temporary admins at the same time. One change was rejected. The original admin was restored. The temporary users were removed.

Browser, local app at `http://127.0.0.1:3001`, one Chromium tab, no saved screenshots:

- Delete Account shows the 14-day explanation and the confirmation form. The form was not submitted.
- Profile for an account that is not a driver shows Account management and Delete Account, and does not show Stop Driving.
- Stop Driving explains that the customer account stays, and this account says it is not set up to drive.
- `/help?appeal=1` fills the topic with Account restriction. The request was not sent.

## 33. Policy pass results

| Result | Count | What |
|---|---:|---|
| Passed | 34 | Policy database tests |
| Passed | 23 | Deletion database tests, including the 14-day grace |
| Passed | 12 | Suspension database tests |
| Passed | 7 | Security database tests |
| Passed | 5 | Existing payout-hold regression |
| Passed | 1 | Concurrent last-admin script, original admin restored |
| Passed | 121 | Unit suite, including the grace-window case |
| Passed | 1 | Typecheck |
| Passed | 1 | Lint of the files this pass changed |
| Failed | 0 | |
| Blocked | 0 | The local Vault secret is set. Hosted Vault was not configured. |
| Not Run | Production build; Playwright; Firefox; WebKit; axe; load; a driver account in the browser; a suspended Contact support click; HTTP calls besides the database functions; Task 3 sections 2–12 and 16–29 | |

Reserved numbers 5555550201 through 5555550205 were not used.

## 34. Policy bugs fixed

Reassignment failed because the job guard also requires the admin-assign setting. Saving deletion blockers failed because the function name was read as a table. Both are fixed. `ALTER DATABASE` is not how this local database accepts the phone secret, so local setup uses Vault.

## 35. Still open

A photo tied to any dispute is kept. The recommended recent-dispute cutoff, 365 days after `resolved_at`, is not implemented. Reassigned phone numbers and recovery from a lost admin sign-in are still open. Hosted scheduling was not turned on. Storage files outside the job-photos match can remain. The earlier Task 3 matrix was not re-run.

## 36. Policy commit

Implementation: `3d26fe8c723e94e20ab4f35b43150e6a4342c235`. The commit that adds this policy section follows it. Neither was pushed. The earlier Task 4 commits `48f7e3043b71eb17a34494b9119dc9c54490f8c9` and `d816af90d6a2c7e802f13e634b92bac064024b83` were not rewritten.

## 37. Policy confirmation

No git push. No deploy. No hosted database, Stripe, Twilio, Vercel, or DNS change. No live charge. No real SMS, email, or push. `.env.local` and `.env.test.local` were not edited. The phone secret was not printed.

## 38. Communications and the installable app

Local only. Announcements are a new path. Private conversations still use `/admin/messages`. The Conversations link on Communications opens that inbox. No second message table was added.

Push for an announcement is stored as `provider_accepted` and `push_displayed` stays false. No push provider was called. Texting stays off. A promotional text is prepared with the Pickuply prefix and STOP line, and a send outside 8:00 AM to 9:00 PM Eastern is deferred. Inbound STOP was not checked against a hosted Twilio webhook.

The manifest name is Pickuply, display is standalone, and the start URL is `/app?source=pwa`. Icons at 192, 512, maskable 512, and the 180 Apple icon returned HTTP 200 on the local app. `/sw.js` and `/offline` did too. A signed-in admin opening `/app?source=pwa` landed on the admin home. Communications showed the three channels, the audience list, Eastern date and time, and an empty announcement list. Nothing was sent.

Android Chrome, iPhone Safari, Lighthouse, and a production build were not run. Checkout still returns to the job page on this site, and Connect still returns to driver earnings. Those returns were not opened from an installed phone.

## 39. Communications and install results

| Result | Count | What |
|---|---:|---|
| Passed | 143 | Unit suite, including 18 announcement tests and 4 install tests |
| Passed | 11 | Announcement database tests |
| Passed | 1 | Typecheck |
| Passed | 1 | Lint of the files this pass changed |
| Failed | 0 | |
| Not run | A physical Android or iPhone install, Lighthouse, production build, a real push, a real text, and two database sessions racing the rate limit. The database locks one admin's announcements for the length of the save. |

## 40. Communications commit

Implementation: `f8b9693f29222cfb381d7e060bcca13506bc7895`. The commit that adds this section follows it. Neither was pushed.

## 41. Account follow-ups

A missing phone-protection secret no longer blocks sign-up or deletion. The restricted-phone check is skipped, `audit_log` gets `phone_protection_missing`, and `/admin` shows "Phone protection secret is not configured" plus a health line. `/admin/customers` and `/admin/customers/[id]` are the customer record. Requests, finance, and messages link to them. A phone with no activity for 12 months asks "Is this your account?" after the code. "No, start a new account" freezes the old account for review. Dispute photos stay 365 days after the dispute is resolved. `scripts/promote-admin.sql` is documented and does not run by itself.

| Result | Count | What |
|---|---:|---|
| Passed | 35 | Account policy database tests, including a missing secret |
| Passed | 3 | Chromium, Firefox, and WebKit: customer record, Suspend Account, Delete Account copy, Stop Driving form |
| Passed | 1 | Production build |
| Failed | 0 | |
| Not run | A real OTP reclaim on a 12-month-old phone, and a hosted SQL editor recovery |

Implementation: `3d22c1c604902d22731ab3aee8399f0403d80952`. This report commit follows it. Neither was pushed.
