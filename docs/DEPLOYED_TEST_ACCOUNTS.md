# Deployed test accounts

These are synthetic 555 numbers. The owner has approved, in principle, using production project `uyhithfdmphilleusiom` for temporary pre-launch testing. No hosted write has been made. The provision script still refuses that project until a later approval. Local rows are marked `is_test` and stay out of real feeds, announcements, and payouts.

No one-time codes are stored in this file or in git. Production authentication was not changed.

## Intended environment

| Item | Value |
| --- | --- |
| Public site checked | https://pickuplyapp.com |
| Supabase project behind that site | `uyhithfdmphilleusiom` |
| Phone sign-in on that project | Enabled. SMS provider is Twilio. `phone_autoconfirm` is false. |
| Local fixture database | `http://127.0.0.1:54321` only |
| Stripe | Stay on test keys (`sk_test_`). The app refuses a live secret. |
| Payouts | The fixture never sets `payouts_enabled`. No transfer id is stored. |
| Texts, push, and email | Preferences for these 13 accounts are off. The fixture deletes their notification rows. Leave `platform_settings.sms_enabled` off on the test project. |

`pickuplyapp.com` and `.env.local` use the same Supabase project. Local Playwright uses `127.0.0.1` from `.env.test.local`. Accounts that exist only in Docker are invisible to the deployed site.

## Why the old test numbers cannot sign in on the deployed site

Local codes live in `supabase/config.toml` under `[auth.sms.test_otp]`. That list applies only to `supabase start` on this machine. Hosted Auth does not read it.

The live project sends codes through Twilio. The numbers `5555550123` through `5555550199`, and `5555550201` through `5555550205`, are not real mobile numbers, so Twilio cannot deliver a code. A code that works locally is rejected by the hosted project unless that exact number is saved in **that** project's test-phone list. Those reserved `0201`–`0205` numbers stay unused by this roster.

Do not add a shared code, a production bypass, or these test numbers to the production project.

## Roster

Every account below is **provisioned on local Supabase** and **pending on the hosted test project**. None of them can sign in on https://pickuplyapp.com today.

Sign-in, once the hosted test project exists: open the Preview URL, choose Sign up / Sign in, enter the 10-digit number, and enter the 6-digit code that was saved for that number in the test project's Phone settings. The app sends `+1` plus those digits. Each number needs its own code. Invent the codes in the dashboard. Do not paste them into git, `.env.local`, or this file.

| Number | Name | Role | Scenario | Local | Hosted |
| --- | --- | --- | --- | --- | --- |
| 555-555-0301 | Casey Customer | Customer | No bookings yet. Account home should say there is nothing to track. | Provisioned | Pending |
| 555-555-0302 | Quinn Customer | Customer | One open Get Offers delivery in Austell. No driver and no card. | Provisioned | Pending |
| 555-555-0303 | Riley Customer | Customer | Driver Taylor is assigned. Payment is waiting. No Stripe PaymentIntent, so nothing can be captured. | Provisioned | Pending |
| 555-555-0304 | Avery Customer | Customer | Completed bookshelf move, 5-star review, captured total stored locally with no Stripe id. | Provisioned | Pending |
| 555-555-0305 | Jordan Customer | Customer | Disputed chair. Problem report holds capture and payout. No Stripe id. | Provisioned | Pending |
| 555-555-0306 | Pat Driver | Driver | Application is `applied`, offline, no insurance, cannot take jobs. | Provisioned | Pending |
| 555-555-0307 | Sam Driver | Driver | `pending_review`, offline. | Provisioned | Pending |
| 555-555-0308 | Taylor Driver | Driver | `active` and online. Earnings for Avery's job are held until payout setup. No Connect account. | Provisioned | Pending |
| 555-555-0309 | Morgan Driver | Driver | `active` and online. Payout setup has started and payouts are disabled (`acct_testpickuply0309`). Assigned the disputed job. | Provisioned | Pending |
| 555-555-0310 | Reese Driver | Driver | `paused` and offline. | Provisioned | Pending |
| 555-555-0311 | Sky Admin | Admin | Opens `/admin`. No driver row. | Provisioned | Pending |
| 555-555-0312 | Rowan Admin | Admin | Second admin so the last-admin rule can be tested. | Provisioned | Pending |
| 555-555-0313 | Jamie Both | Driver and customer | Role is `driver`, so Driver home is the default. Customer mode opens `/account`. Also has an open junk request. Offline, so the public feed does not treat them as online. | Provisioned | Pending |

Private addresses on the fixture jobs are `1 Synthetic Lane` and `2 Synthetic Lane`. They are not real customer addresses.

## Verification already done

Checked on 2026-10-24 against local Docker only:

- The safety check refuses `uyhithfdmphilleusiom.supabase.co` and any other hosted host.
- All 13 profiles exist with the roles and driver statuses in the table above.
- Five fixture jobs exist: open, assigned and awaiting payment, completed and captured, disputed and authorized, and the dual-role open junk request.
- None of those jobs has a Stripe PaymentIntent id.
- Taylor's ledger row is `held_until_onboarding` for 5000 cents and has no transfer id.
- Morgan's Connect row has `payouts_enabled = false`.
- The dispute row holds both capture and payout.
- Notification rows for this roster were removed after the triggers ran. Push, email, SMS, and promotional text are off on these profiles.

Not done, because it would touch production or send a text:

- Signing in on https://pickuplyapp.com.
- Opening `/admin`, `/driver`, or `/account` on the deployed site with these users.
- Creating a second Supabase project, a Vercel Preview, or dashboard test OTPs.

Role homes in the app, once a session exists: customers land on `/account`, drivers on `/driver`, admins on `/admin`. Jamie can use the customer/driver switch. That routing was not clicked through on the deployed site.

## Hosted actions still waiting for approval

Using `uyhithfdmphilleusiom` is approved in principle. None of the steps below have been done, and each one still needs its own OK. Do not run them from this document alone.

1. Compare the hosted schema with migrations `0001` through `0071`, back it up, and apply only the migrations you approve. The hosted database has not been changed for this roster.
2. After that schema is in place, add the 13 numbers in the Supabase dashboard as test phone numbers. Format each as `+1` plus the 10 digits, each with its own code. Supabase accepts that code and does not send an SMS for that number. Do not turn on a general login bypass. Leave Twilio in place for real phone sign-in.
3. Keep Stripe on test keys. Leave optional SMS off. Test accounts must not send email, SMS, or push.
4. Change the provision script to allow only `uyhithfdmphilleusiom`, and only with the extra confirmation flags, after that change is approved. Then run it. Today the script still refuses that host.
5. Sign in only after the accounts and codes exist. Check `/account`, `/driver`, and `/admin`, and Jamie's customer switch.

## Local commands

Prepare or refresh the local roster:

```
node scripts/provision-deployed-test-accounts.mjs
```

Remove only these 13 local users and their fixture rows:

```
node scripts/provision-deployed-test-accounts.mjs --cleanup
```

The script reads the local API URL from `npx supabase status`. It does not print keys. It does not call Twilio.

## Cleanup

Locally, `--cleanup` removes only these 13 users and their fixture rows.

On a database that has migration `0071`, a real admin uses `/admin/test-data`. That page previews counts, requires the confirmation phrase, and retires test jobs and profiles. It does not delete payments, ledger rows, messages, job history, or the audit log. It does not touch accounts whose `is_test` flag is false. Production does not have this roster until provisioning is approved.
