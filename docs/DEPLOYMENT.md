# Deployment checklist

Local evidence does not include a `.vercel` project link. The names `pickuply-ku8y` and `pickuply` cannot be confirmed from this repository. The GitHub repo named in the request is `joshtutu777/pickuply`. The working branch is `cursor/admin-ops-dashboard`. Nothing in this pass was pushed or deployed.

## Environment variables

Set these on the server. Do not put the values in git. `NEXT_PUBLIC_*` values are visible in the browser. Everything else must stay server-only.

| Name | Where |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public site URL, no trailing slash |
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

## Scheduler

See `docs/SCHEDULER.md`. Paid bookings are not ready until pg_cron is activated or the project is on Vercel Pro.

## Legal

`/privacy` and `/terms` need a lawyer's approval before they are treated as final.
