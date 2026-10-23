# Pickuply progress

## Step 1 — Initial project setup (2026-10-21)

### What was already in the workspace

- Git repository on `main` with no commits.
- Remote `origin`: `https://github.com/joshtutu777/pickuply.git`.
- `origin/main` was gone. The remote had no files to pull.
- `docs/SPEC.md`, `docs/BUILD_PLAN.md`, `docs/PROGRESS.md`, and `.cursor/rules/` were not in the folder.

Nothing was deleted. `.git` was left in place. Next.js was scaffolded in a temporary folder because `create-next-app` will not run in a non-empty directory, then the files were moved in.

### What was built

- Next.js 16.4.2 app (App Router, TypeScript strict, Tailwind CSS 4, ESLint).
- Mobile-first homepage: headline, subheadline, supporting line, Get a price, driver link, four service cards, four how-it-works steps, and the trust strip.
- Shared header and footer. Admin is only in the footer. Terms, Privacy, and Contact are placeholder pages so those footer links do not 404.
- Placeholder routes: `/request`, `/login`, `/account`, `/driver`, `/driver/onboarding`, `/admin`, `/jobs/[id]`.
- `lib/constants.ts` with the four services, empty zones, and fee rules that do not invent dollar amounts.
- PWA manifest at `app/manifest.ts` (name Pickuply, theme color `#145a3a`, placeholder icons). No service worker.
- `.env.local.example` with empty values for Supabase, Stripe manual capture, Twilio SMS, and Web Push. No live services and no real keys.
- Playwright smoke test: homepage shows the tagline, and Get a price opens `/request`.

`docs/SPEC.md` was missing, so zones and the fee schedule are unset, and the env var names follow the services named in the Step 1 brief. Drop the spec in and those can be aligned before later steps.

### Files created

- `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/manifest.ts`, `app/icon.png`
- `app/request/page.tsx`, `app/login/page.tsx`, `app/account/page.tsx`
- `app/driver/page.tsx`, `app/driver/onboarding/page.tsx`
- `app/admin/page.tsx`, `app/jobs/[id]/page.tsx`
- `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/contact/page.tsx`
- `components/site-header.tsx`, `components/site-footer.tsx`, `components/placeholder-page.tsx`
- `lib/constants.ts`
- `public/icons/icon-192.png`, `public/icons/icon-512.png`
- `supabase/migrations/.gitkeep`
- `.env.local.example`, `.gitignore`
- `e2e/homepage.spec.ts`, `playwright.config.ts`
- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`
- `README.md`, `AGENTS.md` (AGENTS.md is the Next.js scaffold note)

### How to test

```bash
npm install
npx playwright install chromium
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run dev
```

Open http://localhost:3000.

Checked on 2026-10-21:

- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run build` passed. `/jobs/[id]` is a partial prerender. Manifest is `/manifest.webmanifest`.
- `npm run test:e2e` passed (mobile Chrome): homepage tagline is visible, and Get a price goes to `/request`.
- Dev server: http://localhost:3000 and http://127.0.0.1:3000.
- These routes returned 200: `/`, `/request`, `/login`, `/account`, `/driver`, `/driver/onboarding`, `/admin`, `/jobs/demo-123`, `/terms`, `/privacy`, `/contact`, `/manifest.webmanifest`, both icons.
- `.env.local` matches `.gitignore` rule `.env*`. `.env.local.example` is not ignored.

### Not done

- No Supabase, Stripe, Twilio, or other live connection.
- No service worker.

Step 1 was committed and pushed to `origin/main` after this log was written (`77c7d95`, message “Step 1: project setup, homepage, spec, and Cursor rules”).

## Step 2 — Request form on this device (2026-10-21)

The form at `/request` works without Supabase, Stripe, or Twilio. Nothing is sent to drivers. Saving keeps the request in this browser and opens `/jobs/[id]`.

### What was built

- Six steps: Service, Item, Where, Access and when, Contact and price, Review. Back and Next keep what was typed. A progress bar shows the step.
- Homepage service cards open `/request?service=delivery|free_item|junk|construction`.
- Item photos: up to 8, compressed in the browser to a JPEG no wider or taller than 1600px, stored in IndexedDB, with a thumbnail and remove button.
- Three required pricing methods: Get a quote, Name your price (minimum $35), and Set a budget range (minimum at least $35, maximum higher than the minimum). The estimate does not change those amounts. Step 3a removed “Book the first driver who accepts my price.” The customer chooses a driver before anything is booked.
- Estimate uses only the SPEC §7.2 ranges and the $35 minimum. Unknown distance is treated as within 10 miles. Per-mile, extra-stop, and platform-fee amounts are not added. If a required input is missing, the form says “We'll confirm a price after reviewing your request” instead of a number. On a phone, that line stays in a bar at the bottom once a service is chosen.
- 3+ flights are counted as 3. Junk has no stair adder. Free-item pickups use the light-load range and default the date to ASAP. Construction uses the full-service ranges. “Full truck” is the spec row “Full pickup or trailer.”
- Item value over $1,000 is allowed and flagged. The warning is “Items over $1,000 need approval before booking.”
- Pickup city is matched to the spec zones (`west_metro`, `east_gwinnett`). Any other city is stored with no zone. There is no zone picker.
- After Submit, the screen says “Text verification will be added in a later step.” It does not pretend a text was sent. “Save on this device” writes the request and opens the job page, labeled “Demo: saved on this device only. Not sent yet.”
- The job page timeline is Requested → Quoted → Open for drivers → Driver assigned → Picked up → Delivered, with Requested current. The stored status is only `requested`. Step 3a validation removed the misleading “Confirmed” step.
- Drafts stay in `localStorage` except phone, email, and street addresses. Name, city, ZIP, and access notes are in the draft. Returning visitors can continue or start over. Start over deletes photos. After a save, private fields are in a separate `localStorage` key so this device can show them. That is not database row-level security. Any script on this site can read it.

### Files

- `lib/constants.ts`, `lib/types.ts`, `lib/money.ts`, `lib/phone.ts`, `lib/dates.ts`, `lib/pricing.ts`, `lib/estimate.ts`, `lib/draft.ts`, `lib/photos.ts`, `lib/photo-store.ts`
- `lib/validation/request.ts`, `lib/data/requests.ts`, `lib/data/split-job.ts`
- `lib/pricing.test.ts`, `lib/validation/request.test.ts`, `lib/data/split-job.test.ts`
- `components/request/fields.tsx`, `request-wizard.tsx`, `request-form.tsx`, `job-demo.tsx`, `job-view.tsx`
- `app/request/page.tsx`, `app/jobs/[id]/page.tsx`, `app/page.tsx`, `app/globals.css`
- `e2e/request.spec.ts`, `e2e/homepage.spec.ts`, `playwright.config.ts`

### How to test

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npx playwright install webkit
npm run test:e2e
npm run dev
```

Open http://localhost:3000/request. On a phone-width window, pick Junk Removal, fill the steps, and save. The job page should say it was saved on this device only.

Checked on 2026-10-21:

- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed (22 tests).
- `npm run build` passed. `/request` and `/jobs/[id]` are partial prerenders.
- Playwright: homepage on Pixel 5 passed. The iPhone 13 request tests passed, including the pricing-method test re-run after a label fix. WebKit had to be installed first. Run the iPhone project with one worker if several WebKit browsers run out of memory.
- In the browser: junk deep link, no drop-off, quarter-truck estimate $90–$130, review (street, phone, $15 late-cancel wording), verification placeholder, then the job page. The public `pickuply.jobs` record did not contain the street, phone, email, or gate note.

### Known limitations

- No live Supabase, Stripe, or Twilio. Phone verification is a placeholder. The request is not sent to drivers and no card is charged.
- The cancellation fee, trip fee, and damage-limit wording need business and legal review before production.
- The demo timeline no longer shows “Confirmed.” Stored status stays `requested`, and the page says the request has not been quoted, booked, or assigned.
- Access notes, including gate codes, are saved in the browser draft. Phone, email, and street addresses are not.
- Email is stored on the local private record. Step 3a also adds `customer_email` to `job_private` in the database migration. That migration has not been applied to the hosted project.
- `docs/BUILD_PLAN.md` Step 6 is the live form with a text code and `POST /api/jobs`. This step is the offline form.
- Cursor rules are in `docs/.cursor/rules/`, not `.cursor/rules/`, so Cursor may not apply them automatically.
- The project rules mention Next.js 15. This app is Next.js 16.4.2.
- Landing-page price ranges from SPEC §4.1 are not on the homepage yet.
- Purchase questions are delivery only, matching SPEC §4.2.
- Size is one choice (small, medium, large, extra large). There is no separate weight field.

## Step 3a — Supabase client, schema, and row-level security (2026-10-21)

The app can reach Supabase with the public URL and anon key. The database rules are written in a migration and covered by pgTAP tests. That migration has not been applied to the hosted project. Nothing was committed or pushed.

### What was built

- Browser and server Supabase clients, using the anon key only. There is no service-role client.
- `proxy.ts` refreshes the session. If Supabase is missing or does not answer within 4 seconds, the page still loads so the on-device form keeps working.
- `GET /api/health` returns only `{ ok: true }` or `{ ok: false }`. It is dynamic, so production build does not call Supabase.
- Migration `supabase/migrations/0001_core.sql`: profiles, zones (`west_metro`, `east_gwinnett`), drivers, vehicles, jobs, job_private (including `customer_email`), job_photos, job_offers, job_events, audit_log, `customer_driver_blocks`, and `job_driver_invitations`.
- Money is integer cents. There is no auto-book column. The customer’s pricing choice cannot be changed after insert, including by an admin.
- Quote price columns (`price_cents`, `driver_pay_cents`, `platform_fee_cents`, `dump_fee_cents`, `quote_expires_at`) can be set only by an admin profile, or by the local migration role when no user is signed in. The service role is not an admin.
- `accept_admin_quote(job_id)` moves the customer’s own quoted quote-job to `open` and does not set `assigned_driver_id`. An admin cannot publish that job with a normal update.
- `driver_job_feed()` takes no driver id. It checks the signed-in driver, role, status, zone, service, level, approved vehicle, customer blocks, and open status. `approved_new` drivers see a job only when `job_driver_invitations` has a row. An invitation is not an assignment.
- The feed returns structured card fields only. It does not return descriptions, notes, addresses, names, phone, email, access notes, listing URLs, or photos. If a pickup has coordinates, the job stays hidden unless the driver’s last location is inside their max miles.
- Private photo bucket `job-photos`. Browsing drivers have no read policy. The customer and the assigned driver can read that job’s photos.
- The form no longer offers “Book the first driver who accepts my price.” Fixed and range jobs say the customer chooses who to book. Get a quote uses the approved review sentence.

### How to apply, test, and roll back

Docker and the Supabase CLI are not installed on this machine, so this was not applied anywhere.

When those are installed, from this repo:

```bash
supabase init
supabase start
supabase test db
```

`supabase init` is only needed because `supabase/config.toml` is not in the repo yet. Keep the existing `supabase/migrations` folder. `supabase start` and `supabase test db` use a local database. Do not run `supabase link` or `supabase db push`.

Nothing is applied on the hosted project, so there is nothing to roll back there. If a local database is created later, `supabase db reset` deletes that local database only. Do not point it at the hosted project. If this migration is ever applied to the hosted project, roll it back with a new migration that drops these policies, functions, and tables. Do not delete hosted data by hand.

### Checked on 2026-10-21

- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed (22 tests).
- `npm run build` passed. `/api/health` is dynamic. The proxy is registered.
- Playwright, one worker: homepage on Pixel 5 passed. All 9 iPhone 13 request tests passed after the quote sentence was left on the pricing choice instead of repeated under it. WebKit and Chromium had to be installed into this sandbox cache first.
- `GET /api/health` returned `{ "ok": true }`. That only checks the public auth health endpoint. It does not migrate or write data.
- `supabase/tests/0001_rls.test.sql` was not run. The Supabase CLI, Docker, and a local Postgres install are missing. The tests were not pointed at the hosted project.

### Known limitations and decisions

- `SUPABASE_SERVICE_ROLE_KEY` is not in `.env.local`. The admin client stays deferred.
- The Supabase SQL editor runs as the database owner. That owner can set quote prices when no user id is present. The API service role cannot.
- Customer price columns stay fixed even for an admin. Changing one later needs a new migration.
- `choose_offer` and driver assignment are not functions yet. Marking an offer `chosen` is rejected. Inserting an offer does not assign the job. An admin can still move an open job to `assigned` in a separate update.
- Job descriptions can contain an address. Browsing drivers do not receive the description or photos. The assigned driver can read the job row, which includes the description, along with the private address.
- `profiles` is not publicly readable. A later offer screen needs a small driver card, not the whole profile.
- A job with pickup coordinates is hidden when the driver has no last location. Zone match is not enough in that case.
- The demo job page no longer shows “Confirmed.” The highlighted step is the local `requested` save.
- The $15 / $25 / $250 wording still needs business and legal review.
- Cursor rules remain in `docs/.cursor/rules/`, so Cursor may not apply them automatically.
- `npm install` reported 5 high severity vulnerabilities. They were not changed.

## Step 3b — Phone sign-in, profiles, and protected pages (2026-10-21)

Phone sign-in uses the browser anon client only. There is still no service-role client. Migrations `0001` and `0002` were not edited. The request form, pricing copy, and demo job page were not changed. Nothing was committed, pushed, or applied. The admin promotion SQL was not run.

### What was built

- Safe return paths accept one internal path that starts with a single `/`. After decoding, `//`, `\`, `:`, hosts, whitespace, control characters, `@`, and double-encoding are rejected.
- Access decisions are pure. Customers land on `/account`, drivers on `/driver`, admins on `/admin`. Protected routes are `/account`, `/driver`, `/admin`, and `/login/name` (exact or a trailing subpath; `/administrator` is not `/admin`). Signed-out visitors go to `/login?next=`. A signed-in user with a blank name stays on `/login/name` until the name is saved. `/admin` is admins only. Anyone else is sent to their role home with `?error=forbidden`. `/driver` and `/driver/onboarding` stay open to any signed-in user who has a name. A missing profile fails closed.
- The session helper reads `getUser()`, then `profiles.role` and `full_name` for that id. Role never comes from user metadata. Missing env returns null so the public form still loads.
- The proxy skips static files, `sw.js`, the web manifest, and `icons/`. After the session refresh it applies the access decision and copies Supabase cookie options onto redirects. It does not log.
- `/login` texts a code with `signInWithOtp` (`channel: 'sms'`) and checks it with `verifyOtp` (`type: 'sms'`). Every number gets the same copy. After a successful send the page says exactly `Enter the 6-digit code for (•••) •••-1234`. Provider errors are mapped and never echoed. Resend waits 30 seconds. A good code does a full navigation to `/auth/continue`.
- `/login/name` requires a full name (1–80 characters: letters, spaces, apostrophes, periods, hyphens). The server action updates only `full_name` on the signed-in user's own profile row.
- The header shows Log in when signed out. When signed in it shows the first name (omitted when blank) and Sign out. Sign out clears the browser session and the server cookies, then lands on `/`. Get a price and Drive with us stay. Drive with us still points at `/driver/onboarding`.
- `/account` still says the customer dashboard is not built, and shows “You don't have access to that page.” when `error=forbidden`. `/admin` stays a placeholder for admins. Drivers see the existing driver-home placeholder. Other signed-in roles see a Become a driver message and a link to `/driver/onboarding`.
- `supabase/manual/promote-admin.sql` is a manual script, not a migration. The placeholder `+1XXXXXXXXXX` fails closed. It matches `auth.users.phone` by digits inside a transaction, updates that one profile to `admin`, and raises unless both the user match and the profile update are exactly one row.

### Files

- `lib/auth/safe-return-path.ts`, `lib/auth/access.ts`, `lib/auth/session.ts`, `lib/auth/actions.ts`, `lib/auth/name.ts`, `lib/auth/otp-errors.ts`, `lib/auth/query.ts`
- `lib/phone.test.ts`, `lib/auth/safe-return-path.test.ts`, `lib/auth/access.test.ts`, `lib/auth/otp-errors.test.ts`, `lib/auth/name.test.ts`
- `lib/phone.ts`, `lib/supabase/proxy.ts`, `proxy.ts`
- `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/name/page.tsx`, `app/login/name/name-form.tsx`, `app/auth/continue/route.ts`
- `app/account/page.tsx`, `app/admin/page.tsx`, `app/driver/page.tsx`, `app/driver/onboarding/page.tsx`, `app/layout.tsx`
- `components/site-header.tsx`, `components/header-session.tsx`, `components/sign-out-button.tsx`, `components/forbidden-alert.tsx`, `components/loading-main.tsx`, `components/placeholder-page.tsx`
- `e2e/auth.spec.ts`, `playwright.config.ts`, `package.json`, `.gitignore`, `.env.local.example`
- `supabase/manual/promote-admin.sql`

### Manual Supabase status

- Hosted public schema from `0001` is already applied. `0002` storage is already applied (private `job-photos` bucket and six policies). Those were not reapplied.
- Still needed: after the admin phone has signed in once, the user runs `supabase/manual/promote-admin.sql` themselves in the SQL editor. This step did not run it and did not connect to the hosted database.
- Local Docker and pgTAP (68 assertions) still have not run. Do not point them at the hosted project.
- Twilio is not the test SMS path. Dashboard test numbers belong only in `.env.local` or `.env.test`.
- Cursor rules now live at `.cursor/rules/` (`project.mdc` and `database.mdc`). Cursor only loads that path. Those files were not edited.

### Checked on 2026-10-21

- `git check-ignore -v .env.local .env.test` matches `.gitignore` rule `.env*`. The gitignore comment names `.env.test`. `.env.local.example` is not ignored. The example file has empty `TEST_PHONE`, `TEST_OTP`, `TEST_ADMIN_PHONE`, and `TEST_ADMIN_OTP` placeholders only.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed (38 tests). That keeps the pricing, request validation, and split-job tests and adds phone normalize, mask, return URLs, OTP error mapping, name validation, and access decisions.
- `npm run build` passed. `/auth/continue` and `/api/health` are dynamic. The proxy is registered.
- `npm run test:e2e` passed with 14 tests and skipped 8 (one worker, about 59s). Homepage, all 9 iPhone request tests, and the unsigned auth checks passed: login form, invalid phone, signed-out redirects, and PWA files (`/sw.js` may 404; the manifest is 200 and is not sent to login).
- Skipped because `TEST_PHONE` and `TEST_OTP` are unset: wrong code, resend cooldown, sign-in and sign-out, session reload, return through login, external `next`, and the direct profile role update. Skipped because `TEST_ADMIN_PHONE` and `TEST_ADMIN_OTP` are unset: admin browser login. `.env.test` is not present. No test values were printed.
- Browser check while signed out: `/login` shows the phone form. An invalid number shows “Enter a valid US phone number.” and does not claim a text was sent. `/account` redirects to `/login?next=%2Faccount`. `/manifest.webmanifest` loads. No real OTP was typed.

### Not verified

- A real text, a correct code, the name step, sign-out, a surviving reload, the forbidden-admin sentence, the Become a driver pitch, and the role-update rejection were not exercised in a browser. Those tests skip until the dashboard test numbers are in `.env.local` or `.env.test`.
- The admin SQL was not executed.

## Local Docker and pgTAP (2026-10-22)

WSL 2 is running. Docker Desktop created the `docker-desktop` distro, version 2, kernel `6.18.40.1-microsoft-standard-WSL2`. There is no separate Ubuntu distro. Docker Desktop 4.96.2 is installed and the Linux engine answers. Supabase CLI 2.121.0 is installed at `%LOCALAPPDATA%\Programs\supabase` and is on the user PATH. Nothing was committed, pushed, linked, or applied to the hosted project.

### Migration filenames

CLI 2.121.0 accepts `<digits>_<name>.sql`. It applied `0001_core.sql` as version `0001` / name `core`, and `0002_storage.sql` as version `0002` / name `storage`. The tracked empty `supabase/migrations/.gitkeep` is skipped with a warning. The SQL files were not renamed. Hosted migration history was not repaired.

`supabase init` added untracked `supabase/config.toml` and `supabase/.gitignore`. `project_id` is `pickuply`. Those files are not committed.

### Local apply

`supabase start` uses only Docker on this machine. The first apply of `0001_core.sql` failed at `alter table storage.objects enable row level security` with `must be owner of table objects`. On this image, `storage.objects` is already under row level security and is owned by `supabase_storage_admin`. The migration role `postgres` is not a superuser and is not that owner. `0002_storage.sql` already avoids that `ALTER` because hosted Supabase rejects it too.

To apply the existing files on the disposable database only, `postgres` was given superuser for the apply and that privilege was removed afterward. `postgres` is not a superuser now. The image still gives `postgres` bypass-row-security, which it had before this step. Local history is version `0001` and `0002`. A later `supabase db reset` repeats the ownership failure unless that temporary privilege is used again.

### pgTAP

`supabase test db --local` ran `supabase/tests/0001_rls.test.sql` against `127.0.0.1` only. The on-disk `driver_job_feed()` stops on `column reference "id" is ambiguous` because `returns table (id uuid, ...)` creates a variable named `id`. So the suite can finish only 14 assertions, and assertion 12 fails before that error.

On the disposable database only, that one `where` was qualified as `profiles.id`. The file was not edited. With that local copy, 35 assertions ran: 33 passed, and these two failed:

- Assertion 12 expects SQLSTATE `42501` when anon reads `job_private`. Anon has table privileges from the image defaults, row level security returns no rows, and no exception is thrown.
- Assertion 26 expects the duplicate-block insert to report `23505` with the sentence `a customer cannot block the same driver twice`. Postgres reports `23505` with `duplicate key value violates unique constraint "customer_driver_blocks_pkey"`.

The script then stops at the fixture `update public.drivers set status = 'removed'`. `reset role` does not clear the JWT set earlier in the transaction, so `is_migration_session()` is false and `guard_drivers()` raises `only an admin can change driver approval fields`. Assertions 36 through 68 did not run.

### Auth tests

Playwright auth, one worker, Chromium: 4 passed and 8 skipped. The four unsigned checks passed. The sign-in tests and admin login still skip. `.env.local` has `TEST_PHONE` and `TEST_ADMIN_PHONE` set to the placeholder `+1XXXXXXXXXX`, and both OTP values are words with no digits. No code was submitted. `.env.test` is not present. The Playwright config reads `.env.local`.

## One-time correction to 0001 (2026-10-22)

`supabase/migrations/0001_core.sql` was edited after the hosted project had already been given the public schema. Both of these statements were removed:

- `alter table storage.objects enable row level security`
- `alter table storage.buckets enable row level security`

The platform already enables row level security on those tables. The migration role does not own them, so the statements fail with `must be owner of table`. Creating policies and inserting the `job-photos` bucket do not need ownership. No other Storage statement in `0001_core.sql` or `0002_storage.sql` depends on owning those tables. The hosted schema was not changed to match this file edit. Do not run the edited `0001_core.sql` on the hosted project.

The section above describes the first local apply, which used a temporary superuser, and a partial pgTAP run. That temporary privilege was removed. The reset below does not use it.

## Clean local reset and full pgTAP (2026-10-22)

`supabase db reset --local --yes --no-seed` recreated the disposable database and applied `0001` through `0005`. `postgres` is not a superuser (`rolsuper` is false). The image still gives that role bypass-row-security. `supabase/seed.sql` does not exist, so the reset skipped seeding. `.gitkeep` is still skipped with a warning.

`supabase test db --local supabase/tests/0001_rls.test.sql` then ran the full file: `Files=1, Tests=68, Result: PASS`. No assertion failed. Two harmless warnings say no privileges were granted for `grant_pg_net_access` and `grant_pg_cron_access`.

## Hosted apply of 0003–0005 (2026-10-22)

Applied to the hosted database, in order, through the Supabase Management API. `0001_core.sql` and `0002_storage.sql` were not run again. This did not create `supabase_migrations.schema_migrations`.

- `driver_job_feed()` uses `profiles.id = uid`. Calling it returns rows and does not raise the ambiguous-column error.
- Anon has no privileges on `profiles`, `drivers`, `vehicles`, `jobs`, `job_private`, `job_photos`, `job_offers`, `job_events`, `audit_log`, `customer_driver_blocks`, or `job_driver_invitations`. `zones` is still readable.
- `is_migration_session()` requires no user id, an empty JWT role, and empty JWT claims.
- The storage revoke was run and did nothing. Anon still has `DELETE`, `INSERT`, `SELECT`, and `UPDATE` on `storage.objects` and `storage.buckets`. It was not forced. Row level security still hides the private photos.

A read-only comparison after that apply matched the local schema on functions, policies, grants, triggers, row level security, and the `job-photos` bucket (368 fingerprint lines, no differences). The only remaining differences are local platform objects: `storage.iceberg_namespaces`, `storage.iceberg_tables`, and the `enforce_versioning_status_transition` trigger on `storage.buckets`.

## Migration log

`0001` and `0002` were pasted in the SQL editor, so the hosted project has no `supabase_migrations.schema_migrations` table. `0003`, `0004`, `0005`, and `0006` were applied on 2026-10-22 through the Management API and are not recorded in that table either.

| File | Date | Local | Hosted | How it was applied | Deviations |
| --- | --- | --- | --- | --- | --- |
| `supabase/migrations/0001_core.sql` | Hosted before 2026-10-22. Local 2026-10-22. | Applied by `supabase db reset --local`. Version `0001`, name `core`. | Applied earlier in the SQL editor. Not reapplied on 2026-10-22. | Hosted: SQL editor. Local: CLI reset, no superuser. | After the hosted apply, both storage `ENABLE ROW LEVEL SECURITY` statements were removed from the file. See the one-time correction above. The file no longer matches the SQL originally pasted. |
| `supabase/migrations/0002_storage.sql` | Hosted before 2026-10-22. Local 2026-10-22. | Applied by the same reset. Version `0002`, name `storage`. | Applied earlier in the SQL editor. Not reapplied on 2026-10-22. | Hosted: SQL editor. Local: CLI reset. | None. Policies are created only when missing. |
| `supabase/migrations/0003_fix_driver_job_feed.sql` | 2026-10-22 | Applied by the same reset. Version `0003`, name `fix_driver_job_feed`. | Applied. | Local: CLI reset. Hosted: Management API. | None. The only change from the original function is `profiles.id = uid`. |
| `supabase/migrations/0004_revoke_anon_sensitive_grants.sql` | 2026-10-22 | Applied by the same reset. Version `0004`, name `revoke_anon_sensitive_grants`. | Applied. | Local: CLI reset. Hosted: Management API. | Public-table revokes took effect on both. The storage revokes do nothing on either database because `supabase_storage_admin` granted those privileges. |
| `supabase/migrations/0005_migration_session_requires_empty_jwt.sql` | 2026-10-22 | Applied by the same reset. Version `0005`, name `migration_session_requires_empty_jwt`. | Applied. | Local: CLI reset. Hosted: Management API. | Replaces `is_migration_session()` with a stricter check: empty JWT role and empty JWT claims, as well as no user id. |
| `supabase/migrations/0006_create_customer_request.sql` | 2026-10-22 | Applied by `supabase db reset --local --no-seed`. Version `0006`, name `create_customer_request`. | Applied. | Local: CLI reset. Hosted: Management API. Earlier migrations were not run again. | `create_customer_request` runs as the caller and sets `customer_id` to `auth.uid()`. A matching retry does not update the job. `request_id_visibility` is security definer and returns only `absent`, `own`, or `other`. `attach_request_photo` returns the existing row for the same path. Hosted still has no `supabase_migrations.schema_migrations` row for this file. |
| `supabase/migrations/0007_driver_onboarding.sql` | 2026-10-22 | Applied earlier by `supabase migration up --local`. | Applied. | Hosted: Management API. `0001` through `0006` were not run again. | None. Hosted still has no `schema_migrations` row. |
| `supabase/migrations/0008_admin_publish.sql` | 2026-10-22 | Applied earlier by the same local migration. | Applied. | Hosted: Management API, after `0007`. | The settings row uses the defaults: platform 1000 bps with a 1000 cent minimum, service 290 bps plus 30 cents, payment deadline 30 minutes. |
| `supabase/migrations/0009_driver_feed_photos.sql` | 2026-10-22 | Applied earlier by the same local migration. | Applied. | Hosted: Management API, after `0008`. | The request-photo policies in this file call `driver_is_eligible_for_job` directly. `0011` replaces them before the app relies on them. |
| `supabase/migrations/0010_claims_offers.sql` | 2026-10-22 | Applied earlier by the same local migration. | Applied. | Hosted: Management API, after `0009`. | None. |
| `supabase/migrations/0011_request_photo_access.sql` | 2026-10-22 | Applied earlier by the same local migration. | Applied. | Hosted: Management API, after `0010`. | Replaces the `0009` request-photo policies with `request_photo_visible`. |
| `supabase/migrations/0012_quote_expiry.sql` | 2026-10-22 | Applied earlier by the same local migration. | Applied. | Hosted: Management API, after `0011`. | A quote with no expiry can still be accepted. A past expiry is rejected. |
| `supabase/migrations/0013_assignment_documents.sql` | 2026-10-22 | Applied earlier by `supabase migration up --local`. | Applied. | Hosted: Management API, after `0012`. | Assignment, vehicle approval, and document expiry after approval go through the audited paths. |
| `supabase/migrations/0014_sms_consent.sql` | 2026-10-22 | Applied by `supabase migration up --local`. | Not applied. | Local only. Waiting for approval before the hosted project. | Optional SMS consent is a separate unchecked checkbox. A phone number is not consent. |
| `supabase/migrations/0015_job_tracker.sql` | 2026-10-22 | Applied by `supabase migration up --local`. | Not applied. | Local only. Waiting for approval before the hosted project. | Customers see only the assigned driver's first name, profile photo, and vehicle. Notifications move to 0016. |
| `supabase/migrations/0016_notifications.sql` | 2026-10-22 | Applied by `supabase migration up --local`. | Not applied. | Local only. Waiting for approval before the hosted project. | Texting stays off until an admin enables it. |
| `supabase/migrations/0017_messages.sql` | 2026-10-22 | Applied by `supabase migration up --local`. | Not applied. | Local only. Waiting for approval before the hosted project. | Messages cannot contain a phone number or email. |
| `supabase/migrations/0018_proof_reports.sql` | 2026-10-22 | Applied by `supabase migration up --local`. | Not applied. | Local only. Waiting for approval before the hosted project. | A report holds capture and payout. It does not refund a card. |
| `supabase/migrations/0019_notification_dedupe.sql` | 2026-10-22 | Applied by `supabase migration up --local`. | Not applied. | Local only. Waiting for approval before the hosted project. | Fixes an alert insert that blocked saving a new job. |

## Step 3c — save real requests (2026-10-22)

A signed-in customer can save a request from `/request`. If they are signed out, the last step texts a code on that same page and keeps the draft in memory. The save calls `create_customer_request` as that customer. It writes `jobs` (status `requested`), `job_private`, and one `job_events` row from the existing status trigger. Quote, named price, and budget range are all stored. No price, driver pay, platform fee, dump fee, quote expiry, or driver is set. Quote jobs are not published. Fixed and range jobs stay `requested`. Nothing is booked.

Photos go to the private `job-photos` bucket at `{job_id}/request/{photo_id}.jpg`. A retry skips a path that already has a `job_photos` row. The browser keeps one submission id in `sessionStorage` (`pickuply.submission-id`). Phone, email, and street addresses stay out of `localStorage`. The draft is cleared only after the job and every photo succeed. A missing photo can be chosen again without starting a second job.

`/jobs/[id]` reads the signed-in owner or an admin. Anyone else sees "This request isn't available." Photos use signed URLs that last about five minutes. `/account` lists that customer's jobs, newest first. `/admin` lists date, service, pricing method, area, and status, with no street address and no quoting.

Request-creation tests ran on the disposable local database only: `supabase/tests/0001_rls.test.sql` (68) and `supabase/tests/0006_customer_request.test.sql` (51). `Files=2, Tests=119, Result: PASS`.

## Hosted apply of 0006 and smoke test (2026-10-22)

`0006_create_customer_request.sql` was applied to the hosted database through the Management API. `0001` through `0005` were not run again. The three functions are present. `authenticated` can execute them. `anon` and `service_role` cannot. `create_customer_request` and `attach_request_photo` run as the caller. `request_id_visibility` is security definer.

The read-only fingerprint is 374 lines on both sides. Before ignoring carriage returns, older function bodies differed because the local copies still contain Windows line endings. After removing those characters, there were no differences. The comparison still leaves out the local-only platform objects `storage.iceberg_namespaces`, `storage.iceberg_tables`, and the `enforce_versioning_status_transition` trigger.

One hosted smoke request was submitted in the app as the reserved test customer. Description: `TEST delivery smoke request`. Job id: `adfe0035-822a-4600-a753-dcd3f292d8d6`. It is a delivery quote, status `requested`, with no price and no assigned driver. Two photos are in the private `job-photos` bucket and on the job page as signed URLs. The same customer sees it on `/jobs/[id]` and `/account`. The admin sees Pickup & Delivery, quote, Austell, 30106, and Requested on `/admin`, without the street, and can open the description. A second customer, `smoke-other@pickuply.test`, sees "This request isn't available." An active driver session, created only for the check and then deleted, got zero rows from `driver_job_feed()` for this job.


`supabase/config.toml` and `supabase/.gitignore` stay in the workspace. `config.toml` has no embedded secrets or privileged credentials. Secret-like settings use `env(...)` or are comments.

## Auth tests against hosted phone sign-in (2026-10-22)

Phone sign-in was turned off on the hosted project, and no SMS provider credentials were stored. It is now enabled. Sign-in for the Playwright numbers uses Supabase test codes, so those numbers do not send a text. The test-code list expires at 2026-11-21 16:00 UTC. The codes stay in `.env.local` only.

`TEST_PHONE` and `TEST_ADMIN_PHONE` were the same number, and both codes were 4 digits. The project sends 6-digit codes. The customer tests now use the reserved number `+15555550100`. The admin number already in `.env.local` was signed in once and promoted to `admin` with the name `Test Admin`. There were no auth users before that.

The public Supabase URL in `.env.local` included `/rest/v1`. Auth calls then missed `/auth/v1`. The app now strips that suffix, and the saved URL is the project origin.

## Step 4a — driver onboarding (2026-10-22)

Signed-in people can apply at `/driver/onboarding`. The save stays on their account: role remains `customer` and driver status becomes `pending_review`. Documents go in the private `driver-docs` bucket. `/driver/training` is a short static page. `/admin/drivers` lists applications. Approve, request changes, decline, pause, and remove run through `review_driver`, which checks `is_admin()` and writes `audit_log`. Approval is what sets role `driver`. This migration is local only.

## Step 4b — admin review and fees (2026-10-22)

`/admin/requests/[id]` shows the request, photos, and contact details. An admin sets the zone, service level, and vehicle, then publishes a fixed or range job or sends a quote. High-value and specialty items need a confirmation checkbox. Quote acceptance rejects an expired quote and does not charge a card. `/admin/settings` stores the platform percent, platform minimum, service-fee percent, service-fee fixed cents, and payment deadline. `lib/fees.ts` and `price_breakdown` use the same integer half-up math. A ready-to-copy message replaces SMS. Local migration only. The workflow is not launch-ready until Step 5 payments.

## Step 4c — driver feed (2026-10-22)

Approved drivers use `/driver` to go Online or Offline and to browse `driver_job_feed`. Online requires an approved status, unexpired license and insurance, and an approved vehicle. Browsing works while Offline. `approved_new` drivers only see invited jobs. Request-stage photos are readable only when `driver_is_eligible_for_job` is true. An admin can invite a driver from the open request. Local migration only.

## Step 4d — claims, offers, and payment status (2026-10-22)

A driver claims an open quote job, or a customer chooses one fixed or range offer. Either step assigns one driver and sets `payment_status` to `awaiting_payment` with `payment_due_at`. Nothing is charged. The original posted price or range stays. Stored cents are driver earnings, platform fee, service fee, and customer total, and they add up to the total. Work cannot move to `en_route` until payment is `authorized` or `paid`. The assigned driver can open the street address. Everyone else cannot.

**This workflow is not launch-ready until Step 5 payments.** Step 5 still has to collect the card, release an unpaid assignment when `payment_due_at` passes, and capture after delivery. Service-fee wording and card-surcharge rules need a review before launch.

Local pgTAP: `0001` 68, `0006` 51, `0010_step4` 32. Files=3, Tests=151, Result: PASS. The old pickup-photo assertion now checks pickup photos only, because eligible drivers can read request-stage photos. Migrations `0007` through `0012` are local only. They were not applied to the hosted project.

One cent on the written $35 example: half-up rounding of 2.9% of 3500 cents is 102, not 101. The posted $35 stays $35. Driver earnings are $23.68, the platform fee is $10.00, and the service fee is $1.32. The $150, $60, and $120 examples match the written figures.

## Step 4 verification (2026-10-22)

Local Playwright ran against local Supabase through gitignored `.env.test.local`. `.env.local` was not changed. Placeholder 555 numbers were used for the local OTP check and then removed from `supabase/config.toml`.

The browser walk covered driver application, admin approval, a published fixed-price job, an offer, customer selection, and a quote that the customer accepted and one driver claimed. The assigned driver saw the street. The other online driver did not see the job or the street. Both assigned jobs were `awaiting_payment` with `payment_due_at` set and no Stripe id. A direct driver update to `en_route` did not change the row.

Migration `0013_assignment_documents.sql` closes the gaps found in review: document expiry after approval, vehicle approval, and assignment now go through audited admin functions. Concurrent claims and concurrent offer choices each left one assigned driver. pgTAP is now 192 assertions (the original 151 plus 41).

## Hosted apply of 0007–0013 (2026-10-22)

`0007` through `0013` were applied to the hosted database through the Management API, one file at a time, in order. `0001` through `0006` were not run again. None of the seven calls failed.

## SMS consent for Twilio review (2026-10-22)

`/login` and driver onboarding show the SMS disclosure, links to `/privacy` and `/terms`, and an unchecked optional checkbox. Entering a phone number does not opt anyone in. A checked box calls `record_sms_consent` after sign-in or after the application is saved, and the row stores the profile, time, disclosure version `2026-10-22`, and source `login` or `driver_onboarding`. Existing phone OTP is unchanged, and no SMS is sent from this step.

`supabase/migrations/0014_sms_consent.sql` is written and applied locally only. It has not been applied to the hosted project.

`platform_settings` id 1 is present with platform 1000 bps, platform minimum 1000 cents, service 290 bps, service fixed 30 cents, and a 30 minute payment deadline.

The read-only fingerprint matched on columns (166), constraints (56), indexes (27), functions (43), function grants (78), table grants (226), policies (41), triggers (22), row level security (15), enums (61), and the `job-photos` and `driver-docs` buckets. Digests were identical. The comparison still leaves out the local-only platform objects `storage.iceberg_namespaces`, `storage.iceberg_tables`, and the `enforce_versioning_status_transition` trigger.

## Admin operations dashboard (2026-10-22)

`/admin` is now the operations dashboard. Summary cards, the needs-action list, driver counts, and the latest 25 job and audit events come from the signed-in admin's Supabase session. Existing request review, quotes, publishing, invitations, assignment, driver review, and settings stay on their current pages. `/admin/requests` is the searchable list. Jobs & Assignments opens that list on open and in-progress jobs. Payments is labeled "Coming in Step 5" and is not a link. Customers is omitted. No new migration. This is local only and has not been applied or deployed to the hosted project.

## Step 6a — job tracker (2026-10-22)

The request page, each active account card, and the assigned driver's job page share one progress list: request received, price confirmed, driver confirmed, payment confirmed, heading to pickup, arrived, item checked, picked up, delivered, and completed. Junk jobs say "Load picked up" and "Hauled away", and add "Disposal receipt uploaded" when a dump fee is stored. Cancelled and disputed jobs say so. A rescheduled or reassigned event would show that label, but those workflows are not built. Once a driver is assigned, the customer sees that driver's first name, profile photo, and vehicle through `assigned_driver_card`. The driver moves the job with `advance_job`. Item pickup still waits for the customer, and payment still cannot be collected until Step 5.

`0015_job_tracker.sql` is local only. Notifications, messages, and proof are planned as `0016`, `0017`, and `0018` because this tracker function had to come first. `0014` remains local only.

## Step 6b — notifications (2026-10-22)

Each person gets an in-app alert list with an unread count in the header. A database trigger writes the alert when a request, quote, offer, assignment, payment, or job step changes. Online drivers in the job's zone are told about a new open job. Admins are told about new requests, driver applications, no offers after 20 minutes, and a missed payment deadline. The 20-minute and payment checks run from `/api/cron/notifications` every five minutes and require `CRON_SECRET`. Push uses a service worker and VAPID keys. Email uses Resend when `RESEND_API_KEY` and `RESEND_FROM` are set. Texting has a Twilio path, but `sms_enabled` defaults to off and an admin has to turn it on. The copy-ready admin text on a request is unchanged. No-show alerts are not part of this step.

`0016_notifications.sql` is local only.

## Step 6c — messages (2026-10-22)

A job conversation opens when a driver is assigned and closes 24 hours after the job is completed. The customer, the assigned driver, and an admin can read and post. The screen checks for a phone number or email and will not send one. Drivers get four quick replies. Contact support on a job, the account page, and the driver job page opens one support thread and shows the support phone and email from settings when those are saved. The admin dashboard lists open threads with unread counts. New messages create an in-app alert that does not include the message text.

`0017_messages.sql` is local only. Proof and reports are planned as `0018`.

## Step 6d — proof and disputes (2026-10-22)

Drivers add pickup, drop-off, and receipt proof from the job page. Photos are redrawn in the browser before upload, which drops the original location data. A video has to be 30 seconds or less and is re-recorded in the browser for the same reason. Proof cannot be deleted or replaced. Approximate location stays off unless an admin turns it on, the driver checks the box, and the stored point is rounded to two decimals. Only an admin can read that point.

A problem report during the job, or within 7 days after completion, marks the job disputed and holds capture and payout creation. It does not change a payment that is already captured, and it does not create a Stripe refund. An admin records the outcome, amount, reason, and whether the holds come off. A driver pause is one of those outcomes. Strikes are not built. Cancellation fees, rescheduling, no-shows, and reassignment are still waiting until after Step 5 payments.

`0018_proof_reports.sql` is local only. `0014` through `0019` are not on the hosted project. `0019` only renames the way an alert is inserted after an argument name blocked a new job from being saved. Local pgTAP `0018_proof_reports.test.sql` passed 12 tests: proof counts differ by service, a report leaves a completed capture alone, and a dispute blocks a new capture, a new payout, and deleting a photo. A customer cannot read the rounded proof location.

## Local verification before Step 5 (2026-10-22)

The local database was reset and migrations `0001` through `0019` were applied in order. The full pgTAP suite passed: 6 files, 210 tests. That is the earlier 192 assertions plus SMS consent (6) and proof/reports (12). Lint, typecheck, 63 unit tests, and the production build passed.

Local Playwright passed 23 tests. One hosted admin sign-in test was skipped because those credentials stay in `.env.local`. The local walk signed in with the placeholder numbers, chose a driver, confirmed the tracker through payment, blocked a phone number in chat, exchanged a message, and filed a problem report that left the job disputed. The admin dashboard suite passed against the same local database.

A claimed job now shows up in the driver's assigned list without a manual reload. The job page waits for a request-time render before formatting dates, so prerender no longer stops on the current time. "Last update" and whether a conversation is closed are read in the browser.

## Untested edge cases

- Hosted pages still use the hosted database, so the new tracker, alerts, messages, proof, and reports were not clicked through in the hosted browser. The same walk passed on the local database.
- Push delivery needs VAPID keys, and email delivery needs Resend. Those sends were not exercised.
- Texting stays off. The Twilio call was not made.
- The iPhone Home Screen hint is shown only on an iPhone browser, which was not opened here.
- A video re-record depends on the browser supporting capture of a playing video.
- Two reports on one job keep the holds on, and a resolution that releases only one hold leaves the other.
- Step 5 calls the capture hold before it captures a card. A refund outcome on a dispute starts the Stripe refund before the holds come off. The signed-in Stripe test walk, including a real transfer, has not been run.

## Step 5 — payments (2026-10-22)

Local only. Not pushed, and not applied to the hosted database. Migrations `0020` through `0024` are applied on the local database.

Drivers start Stripe Express payout setup from the driver home and the earnings page. The app stores the Connect account id and status fields only. Saving that row uses the service role because a driver must not be able to mark payouts as enabled. That is the only new use of the service role outside webhooks and cron.

After a driver is assigned, the customer sees the driver, the subtotal, the service fee, the total, and a countdown, then pays with Checkout. The card is authorized, not captured. If fewer than 30 minutes remain, Checkout uses Stripe's 30-minute minimum, and an authorization that arrives after the job was reopened or reassigned is released. The payment-deadline cron reopens an unpaid job. Quote jobs stay at the same driver pay. A chosen offer expires.

The customer approves or rejects the pickup photo. Rejection records the trip fee and captures only that amount. "Got it", or 24 hours after delivery, captures the full authorization if it is still inside `capture_before`. A cancel before work starts is free before payment and releases the whole hold after authorization. The $15 late-cancel fee is not built. When it is, it will be one partial capture on this same authorization.

Driver earnings are one ledger line. A junk disposal estimate is not added. Transfers wait for the payout delay, a finished Connect account, no dispute hold, and `available_on`. The transfer idempotency key is the ledger id. A transfer is not a bank payout. Admins can record an outside payment, refund, reverse a transfer, or deduct a named future earning. None of those happen by themselves.

Manual cron checks, with `CRON_SECRET` from the environment: `/api/cron/payment-deadlines` every five minutes, `/api/cron/auto-complete` and `/api/cron/transfers` every fifteen minutes.

Not run in the first pass: the Stripe test-card walk. That walk is recorded below.

## Step 5 verification (2026-10-22)

Local only. Not pushed, and not applied to the hosted database. Migrations `0025`, `0026`, and `0027` are applied on the local database after `0001` through `0024`.

`0025` adds a seconds payout delay for tests, card-dispute rows, dispute outcomes, and the ledger and refund alerts. `0026` fixes refund recording: the refund id argument had the same name as the column, so Postgres rejected the update. `0027` fixes the same kind of bug on authorization: the charge id was not saved, the webhook returned 500, and the job stayed unpaid.

This Stripe test account uses Accounts v2 with Managed Risk. Stripe collects the losses, so a new payout account is an Express dashboard merchant with card payments requested. The customer's card is still charged on the platform account. The connected account is only there to receive a transfer. A recipient account for separate charges and transfers was rejected until the platform accepts loss liability in the Dashboard. Express terms cannot be accepted through the API, and the hosted form is behind a captcha, so payouts stayed off in the automated walk. The transfer cron ran and left the ledger `held_until_onboarding` with no transfer id.

Checkout's hosted pay button was covered by a verification modal. The test opens the real Checkout page, then confirms that same session with Stripe's test card token: `tok_visa` for 4242, `tok_chargeDeclined` for the declined card, and `tok_createDispute` for the chargeback card.

`stripe listen` on this machine needs `--all-snapshot`. The Connect webhook secret was not in `.env.local`. The test server used the listener secret for both webhook endpoints. Receipt email was not sent because Resend is not configured. The receipt on the job page was shown.

Full local pgTAP: 8 files, 230 tests, pass. Lint, typecheck, 77 unit tests, and the production build passed. Playwright against the local database passed 12 payment tests, including the three crons called with `CRON_SECRET`.

## Shorter request and driver application (2026-10-22)

Local only. Not pushed, and not applied to the hosted database. Migrations `0028` through `0031` are on the local database.

A customer request is four screens. Size, pieces, item value, purchase questions, junk materials, and store info are optional. Junk load size is shown and optional; without it the estimate says the price is confirmed after review. The estimate sentence ends with "Final price confirmed after review." A signed-in customer skips name, phone, and the code. The draft still omits phone, email, and street addresses.

An admin can ask for a checklist of missing details. Quote and publish stay blocked until the customer answers and the request returns to review.

A driver can submit a short application. Approval does not allow Online, a claim, an offer, or an invited job until insurance, an approved vehicle, services, the agreement, and training are done. Payout setup stays optional for claiming. `/admin/funnel` counts those steps. Raw events are deleted after 90 days and do not store names, phones, emails, or addresses.

## Untested after Step 5

- A transfer that Stripe actually creates, and the driver's bank payout after that. This sandbox cannot finish Express terms without a person passing the captcha.
- Receipt email. Resend is not configured.
- The 24-hour auto-complete path on a delivered job. The cron was called and returned ok.
- A customer cancel click. The release-before-capture refund was tested.
- Hosted deploy. Do not apply `0014` through `0027` or deploy until that is approved.
