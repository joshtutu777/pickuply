# Deployed test accounts

These are synthetic 555 numbers for a **separate test Supabase project** and a Vercel Preview that points at that project. They are not production logins.

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

## Hosted actions still required

Do these only after you approve a **new** Supabase project. Do not run them on `uyhithfdmphilleusiom`.

1. Create a Supabase project that is not the production project. Apply the local migrations there only when you explicitly approve that.
2. In that project, open Authentication, Providers, Phone. Turn phone sign-in on. Under test phone numbers, add each of the 13 numbers as `+1` and the 10 digits, each with its own 6-digit code. Supabase will accept that code and will not send an SMS for those numbers. Leave Twilio off on this test project unless you also want real phones.
3. Create a Vercel Preview. Set `NEXT_PUBLIC_SUPABASE_URL` and the anon key to the new project. Set `SUPABASE_SERVICE_ROLE_KEY` on the server only. Keep `STRIPE_SECRET_KEY` as an `sk_test_` key. Do not copy production Twilio, live Stripe, or the production service role into the Preview.
4. Confirm `platform_settings.sms_enabled` is false. Do not add push subscriptions for these users.
5. Run `node scripts/provision-deployed-test-accounts.mjs` only after the script is changed to allow that new host. Today the script refuses every hosted URL, including production.
6. Sign in on the Preview as Casey, Taylor, Sky, and Jamie. Confirm `/account`, `/driver`, and `/admin`, and Jamie's customer switch. Do not use https://pickuplyapp.com for this.

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

## Cleanup on a future test project

After you approve hosted provisioning, delete the same 13 phones from that project's Authentication user list and delete their fixture jobs (`c1300000-0000-4000-8000-000000000302` through `000313`, plus report `0003a5`). Do not run that delete on production. Production does not have this roster.
