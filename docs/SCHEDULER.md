# Pickuply scheduler

Vercel Hobby allows only one cron run per day. Payment deadlines, offer-related reminders, delivery auto-complete, and driver transfers cannot wait until the next day. Those routes stay in the app and stay protected by `CRON_SECRET`. They are not listed in `vercel.json`.

The only Vercel cron left is the daily funnel cleanup:

| Path | Schedule | Purpose | If it stops |
| --- | --- | --- | --- |
| `/api/cron/funnel-retention` | `0 4 * * *` | Deletes old driver-application funnel rows | Stale funnel counts. Safe to retry. |

These stay off Vercel because Hobby rejects a schedule that runs more than once a day:

| Path | Needed pace | Purpose | If it stops |
| --- | --- | --- | --- |
| `/api/cron/payment-deadlines` | About every 5 minutes | Releases an assigned job when the payment window closes, and flags an authorization that is about to expire | A customer can stay assigned without paying. An expired card hold is not captured, but an admin is not flagged on time. |
| `/api/cron/notifications` | About every 5 minutes | Creates reminder rows and sends waiting alerts | Customers and drivers miss time-sensitive texts, email, and push. |
| `/api/cron/auto-complete` | About every 15 minutes | Captures payment 24 hours after delivery when the customer has not confirmed, when the authorization is still valid | Delivered jobs stay unpaid. Retrying is safe: capture uses an idempotency key. |
| `/api/cron/transfers` | About every 15 minutes | Sends ready Stripe transfers to drivers | Earnings stay held. Retrying is safe: a transfer that already exists is not sent again. |

Each route requires `Authorization: Bearer <CRON_SECRET>`. A missing or wrong secret returns 401. They use the Supabase service role on the server. They do not change the price, the fee math, or who gets paid.

## Hosted schedules

`pg_cron`, `pg_net`, and `supabase_vault` are enabled on the hosted project. The bearer token is a Vercel production secret named `CRON_SECRET`. The same value is in Vault as `pickuply_cron_secret`. The site URL is in Vault as `pickuply_app_url` (`https://pickuplyapp.com`). Neither value is stored in `cron.job` or in a database setting. Each run reads Vault when it fires.

Do not put the secret in a migration file, and do not run `alter database ... set app.cron_secret`.

| Job name | Schedule | Path |
| --- | --- | --- |
| `pickuply-payment-deadlines` | `*/5 * * * *` | `/api/cron/payment-deadlines` |
| `pickuply-notifications` | `*/5 * * * *` | `/api/cron/notifications` |
| `pickuply-auto-complete` | `*/15 * * * *` | `/api/cron/auto-complete` |
| `pickuply-transfers` | `*/15 * * * *` | `/api/cron/transfers` |
| `pickuply-funnel-retention` | `0 4 * * *` | `/api/cron/funnel-retention` |

Vercel still runs the daily funnel cleanup at the same time. A second run only deletes rows that are already old.

The app refuses a Stripe key that does not start with `sk_test_`. The first payment-deadline run succeeded, so the production key passed that check.

To turn a job off: `select cron.unschedule('pickuply-payment-deadlines');` and the same for the other names in the table.

## Last run

Each route records its latest result after the bearer check succeeds. A rejected call is not a run. `/admin/health` shows the job, schedule, last finish time, Succeeded or Failed, and a short error with tokens removed. A test admin does not see those rows. Migration `0077_cron_health.sql` is applied on the hosted project. A real admin sees the rows. The first five runs on 2026-10-26 succeeded.
