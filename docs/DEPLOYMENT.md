# Deployment checklist

Local evidence does not include a `.vercel` project link. The names `pickuply-ku8y` and `pickuply` cannot be confirmed from this repository. The GitHub repo named in the request is `joshtutu777/pickuply`. The working branch is `cursor/admin-ops-dashboard`. Nothing in this pass was pushed or deployed.

## Environment variables

Set these on the server. Do not put the values in git. `NEXT_PUBLIC_*` values are visible in the browser. Everything else must stay server-only.

| Name | Where |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public site URL, no trailing slash |
| `NEXT_PUBLIC_BETA_MODE` | Public. Set to `false` to hide the beta badge and Send Feedback. Any other value, including blank, stays on. Not the Stripe mode. |
| `NEXT_PUBLIC_APP_VERSION` | Public label stored with feedback. Defaults to `beta`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Required for checkout session recording, Stripe webhooks, captures, refunds, transfers, cron, and the STOP webhook. Checkout shows "Service role is not configured" when this is empty. |
| `STRIPE_SECRET_KEY` | Server only. Must be `sk_test_` until live mode is an explicit later decision. Live keys are refused. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser. Use the test publishable key with the test secret. |
| `STRIPE_WEBHOOK_SECRET` | Server only. Stripe webhook signing secret. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Server only. |
| `STRIPE_CONNECT_CLIENT_ID` | Server only, if Connect onboarding needs it. |
| `CRON_SECRET` | Server only. Bearer token for `/api/cron/*`. |
| `TWILIO_ACCOUNT_SID` | Server only. |
| `TWILIO_AUTH_TOKEN` | Server only. Also verifies inbound STOP and HELP. |
| `TWILIO_FROM_NUMBER` | Server only. |
| `GOOGLE_PLACES_API_KEY` | Server only. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser map. Restrict it in Google Cloud to the Maps JavaScript API and to `pickuplyapp.com` and `www.pickuplyapp.com`. |
| `OPENROUTESERVICE_API_KEY` | Server only. Optional driving miles. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Browser push. |
| `VAPID_PRIVATE_KEY` | Server only. |
| `VAPID_SUBJECT` | Server only. |
| `RESEND_API_KEY` | Server only, if email alerts are on. |
| `RESEND_FROM` | Server only, if email alerts are on. |

## Stripe

`lib/stripe.ts` throws unless `STRIPE_SECRET_KEY` starts with `sk_test_`. Do not switch to a live key for the first online test. Authorization is still manual capture. Capture, refunds, and transfers were not changed.

## Google Maps

This repo cannot see the Google Cloud console. Before launch, confirm the browser key allows `pickuplyapp.com` and `www.pickuplyapp.com`, and that Maps JavaScript and Places are enabled for the keys that need them. Keep `GOOGLE_PLACES_API_KEY` off the client.

## Phone protection secret

Restricted-phone records store an HMAC, not the phone number. The database function `phone_hmac_secret()` reads them in this order:

1. The PostgreSQL setting `pickuply.phone_hmac_secret`, when that setting is present. An empty value means the secret is missing. It does not fall through to Vault.
2. A Supabase Vault secret named `phone_hmac_secret`, only when the PostgreSQL setting is unset.

Creating a Vault secret does not set `pickuply.phone_hmac_secret`. The two stores are not interchangeable. This app's database code reads the setting first and Vault second. Do not expect a Vault row to populate the setting by itself.

Generate a 32-byte value and keep it out of git, logs, and screenshots:

`openssl rand -hex 32`

On hosted Supabase, store it with the SQL editor as a privileged user:

`select vault.create_secret('<generated value>', 'phone_hmac_secret', 'phone hmac');`

Leave `pickuply.phone_hmac_secret` unset in production so the function uses that Vault row. Confirm with `select public.phone_hmac_secret() is not null;` and do not select the value.

Local development uses the same Vault name in the local database. The value also stays in the ignored `.local/phone-hmac-secret` file. `scripts/set-local-phone-hmac.mjs` creates the Vault row from that file when the name is missing. It does not print the value. `.env.local` and `.env.test.local` are not used for this secret.

To rotate, set `pickuply.phone_hmac_secret_previous` to the old value, store the new value as the current secret, and leave the previous setting in place until every old HMAC has expired. New rows use the current secret. Old rows still match while the previous value is set. The phone numbers are not kept, so an old HMAC cannot be rebuilt without the previous secret.

If the secret is missing, new marketplace registration stops and deletion of a suspended or removed account stays pending. People who already have accounts are not blocked from signing in. An expired temporary restriction is deleted by the retention cleanup and does not become a permanent ban.

The notifications cron calls `process_due_deletions()` and `cleanup_account_retention()` after the existing suspension cleanup. Those functions are service-role only. This pass does not add a hosted cron job or change `vercel.json`. Production still needs the scheduler in `docs/SCHEDULER.md` before those cleanups run on a host.

## Announcements and the installed app

The notifications cron also calls `execute_due_announcements()`. That does not send a text or a push during this local pass. Push for an announcement is stored as accepted by the provider and `push_displayed` stays false. Real push still needs the VAPID keys. Real texting still needs Twilio, `sms_enabled`, and a checked hosted inbound STOP webhook. Do not turn those on from this pass. Quiet hours are 8:00 AM to 9:00 PM America/New_York. A text outside that window is deferred to the next 8:00 AM. Promotional text consent is stored on `notification_preferences.promotional_sms` and starts off.

The web app manifest uses `/app?source=pwa`. HTTPS is required for install and push on a phone. This local pass does not prove Android Chrome or iPhone Safari installation. Checkout already returns to `/jobs/{id}?paid=return` on this site. Connect onboarding returns to `/driver/earnings?connect=return`. If iPhone opens those in Safari, the person signs in again and the page is the job or earnings page.

## Scheduler

See `docs/SCHEDULER.md`. Paid bookings are not ready until pg_cron is activated or the project is on Vercel Pro.

## Legal

`/privacy` and `/terms` are the published policies. Effective date: October 22, 2026. Operator: Pickuply. Contact: info@pickuplyapp.com. A later legal review is optional and is not required before launch. `/terms/driver` is still a development placeholder and is not those policies.
