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

## Activate Supabase pg_cron after deploy

Do this on the hosted database only when you are ready. Do not put the secret in a migration file.

1. In the Supabase SQL editor, enable `pg_cron` and `pg_net` if the project plan includes them. If either extension is unavailable, stop and use Vercel Pro instead, and put the four schedules back in `vercel.json`.
2. Confirm the deployed site URL and set the database settings for that session:

```sql
alter database postgres set app.pickuply_url = 'https://pickuplyapp.com';
alter database postgres set app.cron_secret = '<CRON_SECRET from Vercel>';
```

3. Schedule the four jobs. `net.http_get` must send the bearer token. Run this once:

```sql
select cron.schedule(
  'pickuply-payment-deadlines',
  '*/5 * * * *',
  $$select net.http_get(
      url := current_setting('app.pickuply_url') || '/api/cron/payment-deadlines',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    )$$
);

select cron.schedule(
  'pickuply-notifications',
  '*/5 * * * *',
  $$select net.http_get(
      url := current_setting('app.pickuply_url') || '/api/cron/notifications',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    )$$
);

select cron.schedule(
  'pickuply-auto-complete',
  '*/15 * * * *',
  $$select net.http_get(
      url := current_setting('app.pickuply_url') || '/api/cron/auto-complete',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    )$$
);

select cron.schedule(
  'pickuply-transfers',
  '*/15 * * * *',
  $$select net.http_get(
      url := current_setting('app.pickuply_url') || '/api/cron/transfers',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    )$$
);
```

4. Verify with `select jobname, schedule from cron.job;` and one manual call of each URL with the bearer token. Expect `{"ok":true}`.

To turn a job off: `select cron.unschedule('pickuply-payment-deadlines');` and the same for the other three names.

Until those four jobs are scheduled on Supabase, or the project is moved to Vercel Pro and the schedules are restored, payment deadlines, auto-complete, and transfers do not run. The app is not ready for paid bookings until one of those is active.

`pg_cron` was not enabled on the hosted database from this work. Local Docker was not changed to call the live site.

## Last run

Each route records its latest result after the bearer check succeeds. A rejected call is not a run. `/admin/health` shows the job, schedule, last finish time, Succeeded or Failed, and a short error with tokens removed. A test admin does not see those rows. The record is migration `0077_cron_health.sql`. It is local until the owner approves it. Deploying the recording code before that migration does not change the job result: a missing table is ignored. The health page then says scheduler status is not available yet.
