# Local testing

The app for these walks is http://127.0.0.1:3001. Start it with `node scripts/dev-local.mjs`. Do not use `npm run dev:local` in PowerShell when script execution is blocked.

## Fresh phone numbers

Five numbers are reserved for a person to try signup from scratch. Their codes are only in gitignored `.env.test.local` (`PICKUPLY_TEST_OTP_0201` through `PICKUPLY_TEST_OTP_0205`). They are not in this file.

| Number | Use |
| --- | --- |
| 555-555-0201 | New customer |
| 555-555-0202 | New driver |
| 555-555-0203 | Spare |
| 555-555-0204 | Spare |
| 555-555-0205 | Spare |

Local Supabase reads those codes from the gitignored `.env` file through `env(...)` in `supabase/config.toml`. After you change a code, restart local Supabase with `npx supabase stop` and `npx supabase start`. Do not run `supabase db reset`. That restart keeps the existing database.

Playwright should keep using the older test numbers. Do not sign in 0201–0205 from an automated test.

## Reset a number

```
node scripts/reset-test-user.mjs 5555550201
```

The script runs only when `.env.test.local` points Supabase at localhost or 127.0.0.1 and the phone is on `TEST_RESET_ALLOWLIST` in that file. It refuses the number when that account has a job, message, offer, ledger row, or dispute. Nothing about foreign keys or row security is weakened. If it refuses, pick another fresh number.

## New driver

1. Open http://127.0.0.1:3001.
2. Choose Drive with us, then Get started.
3. Enter one unused number from the table and the code from `.env.test.local`.
4. Enter a first name and agree to the Terms and Privacy Policy.
5. Finish Quick Apply.
6. In a private window, sign in as the admin test account and approve the application.
7. Back in the driver window, open Driver home. The Online switch is the first thing on the page. Fix any missing checklist item, then go Online.
8. An open job in the feed can be claimed from there.

## New customer

1. Open http://127.0.0.1:3001.
2. Choose Sign up / Sign in.
3. Enter a different unused number and its code.
4. Enter a first name and agree to the Terms and Privacy Policy.
5. The account says No pickups yet. Choose Request a pickup.

## Fresh signup on pickuplyapp.com

These three numbers have no account yet. Sign up on https://pickuplyapp.com and enter the code that was saved for that number. No text is sent. The profile is created when the code is confirmed, with no name, and `is_test` is set because the number is a 555-555 test number. Do not put the codes in git.

| Number | Use |
| --- | --- |
| 555-555-0401 | New customer |
| 555-555-0402 | New driver |
| 555-555-0403 | Spare |

## Hosted

Until Twilio is approved, add test numbers in the Supabase dashboard under Authentication, Phone, Test phone numbers. Do not copy local codes into the hosted project from this repo.

The 13-account roster for a deployed test site is in `docs/DEPLOYED_TEST_ACCOUNTS.md`. Do not add those numbers to the production Supabase project.
