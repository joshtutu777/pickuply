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

## Mobile home refresh (2026-10-22)

Local UI only. No schema, pricing, payment, or eligibility changes. Customers get a home dashboard, an all-requests list, and a messages list that opens only threads that already exist. Drivers get the same card language, and earnings are split from the ledger into completed, pending transfer, and transferred. A card authorization is not counted. The phone bar is hidden on the request form, login, quick apply, and the readiness checklist. On a phone it sits in the page flow, with the raised New button inside that band, so the first screen and the last form scroll clear of it.

## Communications and the installable app (2026-10-24)

`/admin/communications` sends one-way announcements through in-app alerts, push, and text. Texting stays off. Push is not marked as shown on a phone. Private conversations stay in Messages. The manifest can be installed, and `/app` sends a signed-in person to the right home. Local migration `0062_admin_announcements.sql` is not on the hosted database. Phone installation was not run on a device.

## Customer records and phone recovery (2026-10-24)

`/admin/customers` lists people and `/admin/customers/[id]` shows the profile, phone, jobs, payments, reviews, help, messages, suspension history, deletion status, and audit history. A missing phone-protection secret no longer blocks sign-up or deletion. It is skipped, audited, and shown as a red banner on `/admin`. A quiet phone of 12 months asks "Is this your account?" after the code. Dispute photos stay 365 days after the dispute is resolved. Keep two admins. `scripts/promote-admin.sql` is the last-resort recovery script and is not a migration. Local migration `0063_account_followups.sql` is not on the hosted database.

## Account policy rules (2026-10-24)

The nine approved account rules are now in the spec. A suspended driver can finish a job that is already in transit. An assigned job that has not started is flagged for an admin and is not cancelled or refunded. Suspension does not hold earnings by itself. Delete Account waits 14 days and can be cancelled during that time. Stop Driving is separate from Delete Account. Contact support on a restriction notice opens the existing help form. The last active admin cannot be removed. Local phone protection uses Vault, not a committed secret. Migration `0061_account_policy.sql` is local only. Customer records are now at `/admin/customers`. Suspension also stays on the request page and the accounts list.

## Account suspension and deletion (2026-10-24)

Admins suspend and reinstate customers and drivers from the driver page, the request page, and `/admin/accounts`. Suspension is its own record. It is not Offline and it is not the driver Paused status. Open requests with no accepted offer are paused. Unaccepted offers are closed. Accepted jobs and payment rows stay. A person can still sign in and sees a restriction notice. Delete Account is at the bottom of Profile. Eligible accounts are anonymized. Accounts with an open job or open money stay pending. Restricted-phone blocking needs the database setting `pickuply.phone_hmac_secret`, which is not stored in the migration. Local migration `0060_account_suspension.sql` is not on the hosted database. The pass is in `docs/TEST_REPORT.md`.

## Reviews, new-driver hold, and self-dealing (2026-10-24)

Completed jobs can be reviewed by the customer and the assigned driver. Reviews stay hidden until both are in or 14 days pass. Drivers with fewer than five completed jobs wait 48 hours before a transfer can become ready. A person cannot browse or offer on their own request. Driver document and chat photos are re-encoded to JPEG before upload so GPS data is not stored. Finance date windows use America/New_York midnight, including the 2026 daylight-saving change. Local migrations `0058_job_reviews.sql` and `0059_payout_hold_and_self_deal.sql` are not on the hosted database. The full pass is in `docs/TEST_REPORT.md`.

## Admin payments report (2026-10-24)

`/admin/finance` is the Payments item in the admin menu. It reads jobs, payments, the ledger, disputes, and reports. It does not change capture, refund, or transfer rules. Stripe fees stay unavailable when the balance transaction was not stored. Late-cancel fees are not tracked. A bank payout is not stored on the job, so that column says Not tracked. Admin quotes are not stored separately from Get offers. Saved filters are in local migration `0057_admin_finance_views.sql`, which is not on the hosted database. The older Payments and Payouts pages remain, and payout actions stay on Payouts.

## Landing page (2026-10-24)

The public home page follows `design-reference/pickuply-landing-updated/index.html`. That folder is gitignored. The four service drawings are copied to `public/images/landing/`. No photographs were in the reference folder, so the cards use those drawings plus the original icons. Post a pickup opens `/request`. Drive with us and Apply to drive open `/drive`. Sign in opens `/login`. The app header and footer, including the Admin link, are not shown on the home page. Step 2 says customers can name a price, set a budget, or get offers, and then choose. A Georgia outline says Serving Georgia and has no driver locations.

## Payment lifecycle check (2026-10-24)

Local only. Not pushed, and not applied to the hosted database. No payment rule, fee, capture, refund, or transfer rule was changed.

The Stripe Playwright suite ran against the local database with Stripe test cards. `stripe listen` forwarded test webhooks to the local app. The listener secret stayed in a temp file. `.env.local` and `.env.test.local` were not edited. The service role used by that test server is the local Supabase key injected by `playwright.stripe.config.ts`. The normal dev server still has an empty `SUPABASE_SERVICE_ROLE_KEY`, so Checkout there still stops with "Service role is not configured."

Fourteen tests passed. Eleven passed in one run. The 24-hour and expired-authorization tests failed in that run because `jobs_guard` sets `updated_at` to now on every update, so a plain backdate did not stick. The rerun sets the role to replica for that one update, and both passed. The refund-before-transfer test missed "I've arrived" once and passed on the rerun. That was a timing miss, not a second charge.

Verified in Stripe test mode: a fixed-price request opened, the assigned test driver accepted the posted price, the customer chose that driver, Checkout authorized `tok_visa` without capturing, the driver moved the job through pickup and delivery, "Got it" captured once and stored the Stripe fee, and the transfer cron left one ledger row `held_until_onboarding` with no transfer id. The same capture happened from `/api/cron/auto-complete` after a delivered job was 25 hours old, and a second cron call did not capture again. An authorization with `capture_before` in the past stayed `authorized` on the same PaymentIntent, created no ledger row, and notified admin. A declined card stayed failed. A late authorization after the payment window was released. Rejecting the item captured only the $25 trip fee. A problem report blocked capture. An admin refund before capture canceled the hold. A refund before transfer reduced the ledger. A refund after a recorded transfer created a recovery and did not deduct the ledger. A test dispute held the ledger. An expired Checkout session could be started again.

Not verified: a Stripe transfer to a finished Connect account, a bank payout, an insufficient-funds card as its own case, a forced failed capture other than the expired hold, a duplicate live webhook, a driver or customer cancel before pickup, and one driver opening another driver's job. Database test `0025_payments.test.sql` still covers the ledger, dispute hold, and refund rules. It is not a card charge. Express payout setup still stops at Stripe's hosted test form, so a transfer id was not created. A transfer would not be a bank deposit anyway.

Paid bookings are not launch-ready. The four frequent cron routes are not scheduled. Stripe still refuses any key that is not `sk_test_`.

## Ask for details on a published request (2026-10-24)

A published request stays `open` when an admin asks for details. Drivers can still send offers unless the admin pauses it. Only an admin quote waits for the answer. A paused request is hidden, and a new offer is rejected by the database. The question goes to Pickuply Support and to the customer's alerts, with an Add details button that opens `/jobs/{id}/edit`. Pause until updated is optional. A customer update publishes a paused request again and tells drivers who already offered to review the offer. Local migration `0066_published_details.sql` is not on the hosted database.

## Beta feedback (2026-10-23)

The header shows a Beta badge while `NEXT_PUBLIC_BETA_MODE` is not `false`. Customers and drivers send feedback at `/feedback` from the desktop menu and from Profile. The phone bar is unchanged. The form stores type, subject, details, the signed-in user, role, route, version, and a short device string. Screenshots are deferred because there is no private attachment path yet. Local migration `0056_beta_feedback.sql` is applied here and is not on the hosted database. Admin notes are a separate table. Only an admin can list every report, change status, or read notes. Duplicate reports in a 10-minute window are rejected, and a person can send at most eight in an hour. `/admin/feedback` shows the counts and filters. No text or email is sent.

## Launch readiness pass (2026-10-23)

`/privacy` and `/terms` follow the Word documents in `docs/legal/`. The Word files stay untracked. The terms section on offers and payment was aligned with the current code: an offer is not a booking, the customer chooses the driver, the card is authorized at confirm, and capture is after delivery or 24 hours later. Arbitration, liability caps, and a published cancellation fee were not added.

## Published legal pages (2026-10-23)

The public Privacy Policy and Terms no longer say that lawyer approval is required or that the pages are drafts. The effective date stays October 22, 2026. The operator name is Pickuply and the contact is info@pickuplyapp.com, matching the source documents. Insurance, cancellation, damage, and dispute wording was not given new dollar amounts, arbitration, or a liability cap. A later legal review can still be done, and it is not a launch requirement. `/terms/driver` remains a placeholder.

`/signup` redirects to phone sign-up. `/driver/apply` redirects to the driver application. The optional SMS checkbox is separate, unchecked, and worded for customers and drivers. Consent version `2026-10-23` turns on that person's optional texts. STOP is recorded by `POST /api/twilio/sms` and turns them off. Local migration `0055` is applied here and is not on the hosted database.

`/drive` reads the session inside Suspense so the production build can prerender the public page. The help-route type errors cleared once Next regenerated `.next/types` with `/help` included. No type check was disabled.

Vercel Hobby cannot run the five-minute and fifteen-minute crons. Those four routes were removed from `vercel.json` and are documented for `pg_cron` in `docs/SCHEDULER.md`. They are not scheduled on the hosted database. Paid bookings are not ready until that scheduler or Vercel Pro is running. Checkout still fails in this dev process when `SUPABASE_SERVICE_ROLE_KEY` is empty. That variable was not added to a secret file from here. Stripe still refuses any key that is not `sk_test_`.

## Booking confirmation (2026-10-23)

The assigned-job payment panel is headed Confirm Your Booking. The button says Confirm Booking & Payment. It lists the selected driver's offer, the service fee, additional charges (none at booking), and the customer total. The note says the card is authorized at confirm, charged after delivery is confirmed or 24 hours later, and is not charged if the authorization expires first. Checkout, capture, refunds, and payouts are unchanged.

## Customer offer counts (2026-10-23)

My Requests shows how many active offers a request has and how many of those the customer has not viewed. An open request with none says "Waiting for driver offers." Cards with new offers are highlighted, and the Requests menu shows that number on desktop and on the phone bar. An offer is marked viewed only when its card is on screen in the offer list. The time is stored in `offer_views`, so another device sees the same state. Withdrawn, expired, declined, and chosen offers stay in history and are left out of the counts. Local migration `0054` is applied. It is not on the hosted database.

## Driver offer form (2026-10-23)

The driver offer form has one field, Offer Amount ($), and one Submit Offer button. It does not show a customer total or a fee breakdown. The server still stores the customer total from the existing fee schedule. Submitting an offer does not assign the driver. Settings can change the minimum offer: $35 for pickup and delivery, $50 for junk removal, $35 for store delivery, and $35 for free-item pickups. There is no twice-the-price maximum, and a counter no longer needs a written reason. A job can have five active offers. A driver can offer on more than one job. When both stair counts are zero, the card says "No stairs reported." Local migration `0053` is applied. It is not on the hosted database.

## Desktop navigation (2026-10-23)

At 768px and wider, a signed-in customer or driver sees Home, Requests or Jobs, Messages, Alerts, and Profile in the header. The phone bar stays under that width and uses the same destinations. Admin keeps a side menu from 768px up: Dashboard, Requests, Drivers, Messages, Alerts, and Settings. The logo still opens the current mode home and does not switch modes. The service worker does not cache pages.

## Driver feed sections (2026-10-23)

The open driver feed was one list that polled every 25 seconds. An unassigned driver cannot read `jobs` under row-level security, so a subscription on that table would not wake the feed. A new signal row carries only a time. The signed-in driver refetches Matched for You and All Georgia Requests, and a late response cannot replace a newer one. The screen also refreshes on focus, reconnect, a manual button, a pull down, and a 20-second fallback while the tab is visible. Local migration `0052` is applied. It is not on the hosted database.

## Waves stay off (2026-10-23)

Settings has Waves enabled, and it starts off. While it is off, an open request is not held for a wave or an invitation. A job can have five active offers. A driver can offer on more than one job. Online drivers whose Areas I cover match get a new-job alert, and Offline drivers with Job alerts while Offline on get one too. Turning waves on follows `docs/WAVES.md`. Visibility uses the time the request opened.

## Requests publish on submit (2026-10-23)

A valid customer request is `open` as soon as it is saved. Get Offers, fixed price, and budget range no longer wait for an admin to approve them. Drivers send an offer on a Get Offers job, and the customer chooses it. Claim still assigns only an optional admin quote that already has driver pay. The admin request screen no longer asks for a zone or an approval. Pause, invite a driver, and an optional admin quote stay, and each one is audited. Local requests that were still `requested` were published and written to `audit_log`. Request photos can still be attached while that request is open.

## Navigation homes (2026-10-23)

A person with a driver record lands on /driver after login unless they used Switch to customer. Drive with us and Quick Apply send an existing applicant to the driver home. The logo goes to that same home. Signed-out visitors still open the public landing page.

## Google Maps (2026-10-23)

Browser maps use the Maps JavaScript API. MapLibre and MapTiler are removed after tiles rendered on desktop and an iPhone-sized screen. Unassigned drivers still see one-mile circles around pickup ZIP centroids. Exact pins stay on the customer job, the assigned driver job, and the admin request. The request form previews verified pickup and drop-off pins and moves the pin when the address changes. A typed address stays unverified and does not invent a pin. Places latitude and longitude are limited to a 30-day cache by Google's current terms. Place IDs can be stored. Active jobs keep their coordinates so the map can still open. The Routes API is not enabled. OpenRouteService is unchanged and is not called from the new map. A job page can still draw a straight line between its own pins.

## Current Driver Terms (2026-10-23)

Online now requires `driver-terms-v1`, not an older agreement timestamp. Driver home shows a review-and-accept card. The Online error links to Review. Accepting stores the version and the time and does not happen automatically.

## Messages inbox (2026-10-23)

An admin document request was posted on the support thread, but Messages only listed job chats and the alert opened Driver home. The inbox now includes Pickuply Support. The alert opens that conversation. Admin, driver, and customer lists use a bold title and an unread dot. Seen appears on the sender's last message after the other person opens the thread. Admin Messages shows unread counts, driver and customer chats, and open help cases. Upload now opens the matching document page. A saved document notifies admin. Chat files stay private.

## Approve anyway (2026-10-23)

An admin who approves a driver with a missing license, insurance file, or vehicle sees the missing item, an insurance warning, and must check Approve anyway. The audit row stores the admin, the time, the missing list, and the confirmation. Approval still leaves the driver Offline. A missing insurance upload does not block Online. An insurance date that is already past does. Paid work without verified coverage can conflict with the driver's own policy and with commercial auto or cargo insurance. This override does not make that coverage optional under those rules.

## Three-item checklist (2026-10-23)

Get Ready to Drive is Vehicle, Insurance, and Training. License and Driver Terms stay on Quick Apply. Services and equipment are on the driver profile. A car or SUV starts with Pickup & Delivery and Store Delivery. Other vehicles also start with Junk Removal. The driver can change those services.

## Address search (2026-10-23)

The Duluth house was dropped because MapTiler ZIP context ids do not start with `postal`, and “Use this address anyway” did not keep a typed street. Search now uses Google Places when `GOOGLE_PLACES_API_KEY` is set. A typed Georgia street, city, and ZIP can be saved without a match. Unverified addresses store no coordinates. ZIP 30097 is in the Georgia table.

## Driver signup terms (2026-10-23)

Quick Apply no longer asks for a service area. The home ZIP picks the nearest zone. The driver must check the Driver Terms box. The accepted version is `driver-terms-v1`, stored with the time. The box starts unchecked. Signup icons sit beside the text labels.

## Maps and addresses (2026-10-23)

Quick Apply now asks for a Georgia home address. The street stays on a private record. The ZIP is what coverage and unassigned distances use. Trip length is stored to the nearest half mile, as driving miles when a routing key is set and as a labeled straight line otherwise. The feed can show one-mile circles around pickup ZIP centers. An address that was not matched is flagged for admin. Missing coordinates show “—”.

## West Metro fallback (2026-10-23)

Drivers with no home ZIP are measured from Austell 30106 in West Metro, and from Lawrenceville 30043 in East Gwinnett. Five local drivers had no home ZIP. Each got an audit row for that fallback. Their saved 25-mile coverage was left in place.

## Areas I cover (2026-10-23)

Drivers save one coverage preference: Georgia cities, ZIP codes, and a radius, combined with OR. The feed uses it unless Show all Georgia jobs is on. Alerts ignore that switch and follow coverage only. Unassigned distances are ZIP-centroid miles, rounded to the nearest mile. Existing local drivers were backfilled to 25 miles from home, or from the zone center when they had no home ZIP.

## Claim race (2026-10-23)

A second claim said the driver could not claim because eligibility ran before the job was checked. The driver was still eligible; the job was already assigned. `claim_job` now locks the job and reports it taken before eligibility. The driver home shows “Sorry, another driver just took this job.” The database test uses two eligible drivers: one wins, the other gets “job already taken.”

## Georgia feed (2026-10-23)

Pickup and drop-off ZIP codes must be in the Georgia centroid table. Drivers see every open job, including outside their zone, and can filter the feed. Accepting requires an active driver, Online, and a matching vehicle. A job that has been open for 20 minutes with no driver is marked for admin.

## Back navigation (2026-10-23)

Every Get Ready to Drive step has “← Get Ready to Drive” at the top and in a bar at the bottom. Saving a step returns to the checklist and shows Saved. Customer, driver, admin, and help detail pages have a back link to their parent.

## Online switch (2026-10-23)

The Driver home control is a switch. It stays Offline or Online until the server confirms the change. A failed check is written under the switch and links to the checklist. A newly approved driver sees the approval prompt until the first time they go Online, or until they dismiss it. After that, Offline says they will not get new job alerts.

## Help requests (2026-10-23)

Customers use `/help` instead of starting a chat with admin. A request gets a case number (HR-####), a status of Open, Waiting on you, or Resolved, and an optional private photo. The person sees their own requests. An admin sees the queue at `/admin/help`, replies, changes the status, and can open the related job. Replies and status changes are audit-logged. Drivers also get driver topics and still have Pickuply Support.

## Driver review and messages (2026-10-23)

Local only. Approve driver marks the vehicle eligible, leaves the driver Offline, and sends an in-app notice. Request documents flags checklist items and posts the note in Pickuply Support. Customers cannot start that thread. Job chat closes when the job is completed or cancelled. The original chat text stays available to admin; everyone else sees phone numbers and emails replaced.

## Driver readiness (2026-10-23)

Local only. Quick Apply already stored the license photo and vehicle type, but the checklist ignored both and Online still demanded a separately approved vehicle. The checklist now reads those same rows. License is its own line. Payout setup is a card, not a step. A removed driver contacts support. Only an admin can reopen that application. Existing local `approved_new` drivers were moved to `active` and left Offline, with an audit row.

## Pending driver mode (2026-10-23)

Local only. The profile mode button already calls the server action directly in 19d773f. A pending applicant who switches to driving stays on driver home and sees the application status plus the Get Ready to Drive checklist. Checklist steps under `/driver/ready` stay open to that applicant. Paused and removed drivers see that status in plain language. Earnings, alerts, and payout setup stay limited to the driver role, so a pending or removed applicant does not get them.

## Profile, mode, and four-step job actions (2026-10-22)

Local only. Profile keeps Sign out and adds the masked phone, mode switch, Help, Terms, and Privacy. The Online switch is the first control on driver home and follows the server result. A cookie remembers customer or driver mode and does not change the role. New signups enter a first name. Fresh local phones 555-555-0201 through 0205 stay unused by tests. Their codes are gitignored. The customer and driver job screens share four milestones, and Driver Confirmed stays current until the trip starts.

## Customer tracking (2026-10-22)

Local UI only. The customer job page shows four milestones: Request & Price, Driver Confirmed, Pickup, and Delivered. Driver Confirmed stays incomplete until the job is assigned and the card is authorized. The old ten-step list is under View activity history. Driver screens still use the detailed tracker.

## Test account isolation (2026-10-24)

Local only. Profiles and jobs carry `is_test`. Test and real accounts cannot book each other. Feeds, offers, alerts, feed signals, messages, and announcements stay in one lane. A test admin cannot read or change real rows. Admin totals hide test rows unless Include test data is on. `/admin/test-data` previews counts and retires test rows after a confirmation phrase. Payments, ledger lines, messages, and the audit log stay. Test earnings are excluded from transfers, and a test job cannot store a live Stripe payment. A fresh local database applied `0001` through `0071` and the full database suite passed, 32 files and 553 tests. `0060` creates the phone-restriction function before the function that calls it, and `0071` does not grant drivers a direct call to the eligibility function. Refund and card-dispute lists on `/admin/payments` follow the same test-data filter as the rest of admin. Include test data is a normal link, so the filter change loads as its own page. The suite was run again after that change and passed, 32 files and 553 tests.

## Hosted migrations (2026-10-24)

Project `uyhithfdmphilleusiom`. Versions `0001` through `0013` were recorded as already applied and were not run again. Versions `0014` through `0071` were applied from this working tree, one file at a time. The history table has 71 versions and no gaps. Every public table has row level security. The original three accounts, one job, one private row, two photos, two zones, and one settings row are still there. `0049` published that job from `requested` to `open` and wrote one audit row, `publish_waiting_request`. There is a second job event. `pg_cron` and `pg_net` are still off. The phone protection secret is not in Vault yet. The site was not deployed.

## Deployed test roster (2026-10-24)

Local only. Thirteen synthetic 555 numbers, 0301 through 0313, exist on local Supabase with roles, jobs, one held ledger row, and one dispute. The provision script marks them `is_test`. No Stripe ids and no payouts are enabled. The production project behind pickuplyapp.com was not changed. Sign-in codes are not in git. Using that project for these accounts is approved in principle and still needs a separate OK before any hosted write. See `docs/DEPLOYED_TEST_ACCOUNTS.md`.

## Walkthrough UX (2026-10-24)

Local only. Address search works before sign-in. An authorization sends one notice to the customer and one to the driver. The pay button says Confirm booking. Before approval, phones show Get Ready above a read-only job feed. After Got it, “Delivery confirmed — thanks!” stays above the review. Closed chat links to Help and Report a problem. Earnings say held until payout setup, then the 48-hour send time, and Scheduled once payouts are ready. Announcement Reply opens Pickuply Support. Suspension defaults to no end date, with 24 hours, 3 days, 7 days, 30 days, and a custom Eastern date. iPhone Safari gets an Add to Home Screen panel.

## Untested after Step 5

- A transfer that Stripe actually creates, and the driver's bank payout after that. This sandbox cannot finish Express terms without a person passing the captcha.
- Receipt email. Resend is not configured.
- The 24-hour auto-complete path on a delivered job. The cron was called and returned ok.
- A customer cancel click. The release-before-capture refund was tested.
- Hosted deploy. Do not apply `0014` through `0027` or deploy until that is approved.

## Live test site (2026-10-24)

`https://pickuplyapp.com` is the testing site. Production on the Vercel project `pickuply` was already Ready and serving that domain. The address, phone, and coverage fixes were already committed and pushed as `2765d42`. No secret values were copied into Vercel from this pass.

Checked on the live site: street search returns house numbers and fills street, city, and ZIP on desktop and a phone-sized screen. The signed-in test customer sees a formatted phone. Signed-out profile and admin pages redirect away. The Areas I cover dropdown on driver application loads 629 Georgia cities and can select more than one, on desktop and a phone-sized screen. The application was not submitted. Messages opens and shows no conversations for that account. Google Places stays server-only. The browser map still uses the text fallback because Vercel has `GOOGLE_MAPS_API_KEY` and the app reads `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Stripe, Twilio, Resend, push, driving miles, and the cron secret are not on Vercel. Stripe keys in `.env.local` are test keys. The local webhook secret must not be reused for the hosted endpoint.

## Offer commission (2026-10-24)

Local only. A driver offer is the customer price. Pickuply keeps 15% of that offer and the driver receives the other 85%, rounded half up. The customer pays the offer plus card processing. Pickuply does not absorb that processing fee, and there is no extra service fee. Offer floors stay $35, and $50 for junk removal. The rate is stored on the offer and copied to the job. Older rows keep the cents already saved. Migration `0073` is applied on the local database only. The hosted database was not changed, and the site was not deployed.

## Pricing clarification (2026-10-25)

Local only. Pickuply's commission stays 15% of the customer-facing offer and is deducted from that offer. The driver receives the other 85%, rounded half up. The customer pays the offer plus the card processing fee. Pickuply does not absorb that fee, and there is no extra platform or service fee. Offer floors stay $35, and $50 for junk removal. Drivers see the commission and estimated earnings before they confirm an offer. Checkout lists the stored offer and the stored card processing fee on separate lines when those amounts add up to the stored total. A stored total that does not match is charged as one line, so older jobs are not repriced. Migration `0073` already had this split. Its header now states that stored cents are left alone. The posted-price floor was in that file but missing from the local database, so `0074` installs the same guard here. It does not rewrite stored cents. The hosted database was not changed, and the site was not deployed. Card-network rules for charging this fee, including on debit and prepaid cards, still need a review before live payments. `npm run typecheck` passed. `npm run test:unit` passed, 156 tests. `supabase test db` passed, 34 files and 589 tests.

## Profile email (2026-10-25)

Local only. Customers can enter an optional email on a new quote, and drivers can enter one on the application. The same `profiles.email` value is prefilled and can be changed in customer or driver profile settings. A blank value does not erase a saved address. The address is not marked verified, phone sign-in is unchanged, and outbound email stays off. Checkout passes a saved email to Stripe and still starts when there is none. Migration `0075` is local only. Hosted accounts were not provisioned, and the site was not deployed. `npm run typecheck` passed. `npm run test:unit` passed, 158 tests. `supabase test db` passed, 35 files and 597 tests. The hosted booking walk was not run.

## Release blockers (2026-10-25)

Local only. The junk seed budget is $50, and a junk budget of $40 is rejected by the database test. The quote-to-booking test passed: an admin sends a $60 offer in West Metro, the customer accepts, one eligible driver claims it, and the other driver is told the job was taken. The assigned driver sees the street and awaiting payment. The other driver does not see the street. The admin review form now asks for a zone, which sending a quote already required.

The hosted dump from 2026-10-25 was restored into the disposable local database `pickuply_backup_check` and was not applied back to the hosted project. That copy has migrations 0001 through 0072, pricing settings 1000 / 1000 / 290 / 30, 9 profiles, 4 jobs, no payment or ledger rows, and 76 public policies. It has no storage file bytes and no grants. A separate hosted provision script and OTP merge script stay refused unless the exact project flag is passed. Neither was run. The current local provision script still refuses the hosted project.

`npm run typecheck` passed. `npm run test:unit` passed, 167 tests. `supabase test db` passed, 35 files and 598 tests. Hosted migrations were not applied, hosted accounts were not created, OTP settings were not changed, and the site was not deployed.

The hosted provision script marks only an empty new customer profile. A roster phone that already has a name, another role, or any job stops the script before the fixture changes it. The backup limits and the database rollback are written in `docs/DEPLOYMENT.md`.

## Pricing and email release (2026-10-25)

Production is the GitHub merge `0024ea7` on `main`, which contains release commit `3fd8d6f`. Vercel deployment `dpl_Cikgg3dwNid5J98NLDysrQZBBPL6` is Ready and serves pickuplyapp.com. The previous production deployment `dpl_DhujmB6sEyHz5pXMvuN2wg9A67se` (`2765d42`, dirty CLI upload) is still available for an application rollback. The 2026-10-25 hosted dump remains outside the repo and was not restored onto the hosted database.

Hosted project `uyhithfdmphilleusiom` now has versions `0073`, `0074`, and `0075` recorded after `0072`. Settings are 1500 / 0 / 290 / 30. A $50 offer breaks down to $42.50 driver earnings, $7.50 commission, $1.80 card processing, and $51.80 customer total. The four existing jobs are unchanged: price 7755, driver pay 6500, platform fee 1000, service fee 255, and no stored commission rate. Stripe webhook `we_1UUPtZD5IFQdbLkyQz2rWJv2` is enabled, test mode, and pointed at `https://pickuplyapp.com/api/stripe/webhook`. An unsigned post to that route returns 400. The temporary pricing hold was removed after those checks. A new quote and a driver offer were not created on the live site: the existing hosted phones are not the 555 test roster, and sending a code would text a real phone. The hosted test roster and OTP merge were not run.

## UAT fixes (2026-10-25)

Local only. Migration `0076` is applied on the local database and is not applied to hosted project `uyhithfdmphilleusiom`. The site was not deployed.

A synthetic admin can no longer read a real `job_private` row, a real job photo row, or the photo file in storage. The older storage read policy had still allowed the file. A real admin still can. Customers and the assigned driver keep their own access. A Get a quote request is saved as `requested` and stays off the driver feed until an admin sends a price and the customer accepts it. Name your price and budget range still open immediately. Driver completion shows held, pending, or available earnings and does not call held money an immediate payout. Both review screens have a Not now link that leaves the page without submitting a review. Stripe rejected a static card list and also rejected combining allowed and excluded methods. Checkout now excludes every non-card method and hides Link as a wallet. A separated 7-digit phone is rejected in chat. Synthetic fixture commission labels follow the stored cents. Real job cents are not rewritten.

Pre-deployment checks on 2026-10-25: `npm run typecheck` passed. `npm run test:unit` passed, 169 tests. `supabase test db` passed, 36 files and 630 tests. The headless request wizard passed, 9 tests. The driver feed refresh test passed, 1 test. The local walkthrough passed, 1 test, with steps 01 through 07 and 09 through 10 passing. Email verification is still not built. A Stripe test Checkout page showed only Card, charged $62.10, and created a manual-capture authorization that was then canceled. `scripts/sql/0076-rollback.sql` was applied inside a transaction and then rolled back, so the local database stayed on 0076. Running that rollback restores the private-data hole, so a Vercel rollback alone is not a safe recovery. Hosted project `uyhithfdmphilleusiom` still does not have 0076. The site was not deployed.

## License date (2026-10-24)

A license or uploaded insurance date stays valid through the end of that calendar day in Georgia (`America/New_York`). `set_driver_online`, license upload, insurance upload, and quick apply compare that date with `georgia_today()` instead of UTC `current_date`. Approval, Driver Terms, suspension, and test-data isolation are unchanged. A genuinely expired license still blocks Online and names the date. Missing insurance still does not block Online. The full database suite passed, 33 files and 570 tests. Hosted project `uyhithfdmphilleusiom` now has version `0072`. No driver rows were changed, and the site was not redeployed.

## Release (2026-10-25)

Merged to main: `7b6b3ad` (quote stays hidden until the customer accepts, and the card is held until delivery), `b017119` (Quick Apply requires an email), and `aacce33` (admin health records each scheduled job). Live production deployment `dpl_5VVLWVJb9ujfQtgfptMm3N5U6KPV` on https://pickuplyapp.com. Hosted migrations `0077` and `0078` are applied.

Manual profiles ending 0201, 0202, 0203, 0204, and 0205 are `is_test`, with an audit row for each profile and for the three jobs those customers owned. Job `cb4549a4-88fb-4866-85a5-0adcce9796cb` was released and is open with no driver and no payment. Job `594edd98-bc38-46fe-bebe-99c0c9d2b95c` was released, then that job and `da26863c-05d3-490e-af44-dc7985a97978` were retired. Audit history and the synthetic accounts were kept.

`pg_cron`, `pg_net`, and Vault are on. `CRON_SECRET` was missing in Vercel, so a production secret was created and the same value was stored in Vault as `pickuply_cron_secret`. The public site URL is `pickuply_app_url`. The schedule commands read Vault when they run and do not contain the secret. Stripe test mode held: the payment-deadline run calls Stripe only after the key passes the `sk_test_` check, and that run succeeded. The first health rows, all succeeded, finished at 2026-10-26 02:21 UTC: funnel cleanup 02:21:10, driver transfers 02:21:11, notifications 02:21:25, delivery capture 02:21:30, and payment deadlines 02:21:31. Two overdue test assignments were released. No real assignment was overdue, and there was nothing ready to capture or transfer.

Fresh signup numbers 555-555-0401, 0402, and 0403 have no profile yet. Migration `0079` marks a new 555-555 profile as `is_test` when the code is confirmed. The person still enters a name. Existing profiles are unchanged.

A test driver application notifies test admins only. It no longer fails with “test accounts cannot change real account data” when a real admin also exists. Migration `0080` is applied on the hosted project. The local database test passed, 1 file and 3 tests.

Delivery keeps the existing statuses. Start trip, Arrived at pickup, Item loaded, Arrived at drop-off, and Delivered are the driver buttons, one at a time. A missing delivery photo now says to add the photo. It no longer says the step is unavailable. The pickup review lasts 10 minutes. The notifications schedule still closes expired reviews, up to 5 minutes late. After the deadline, the driver's next step also closes an eligible review on the server. A reported problem still blocks that step. Migration `0083` records a deadline for an existing pickup review from the pickup event, skips disputes, rejections, and decisions already made, and flags an unclear record. It does not change a job's status. A junk job needs a disposal receipt when it has a dump fee or the receipt flag. A junk job that is not a disposal does not. Migrations `0082` and `0083` are local only.

Driver Jobs is a direct list of available, assigned, active, awaiting-payment, completed, and closed jobs. The phone scroll panel resets when a new screen opens. The active role badge sits in the header. Report a problem lives under Help, and stays on the pickup review and delivery confirmation. Contact preferences moved to Profile. Driver amounts show the job amount and estimated earnings. Confirm booking sits under the job summary. The $250 damage-refund sentence was removed from the app screens. The product spec still states a $250 damage limit, and the Terms do not set a payout. Those legal sentences need a review before they change. A Get a quote request stays hidden from drivers until the customer accepts the admin price. After acceptance the job is open and a driver claims it. Migration `0081` is applied on the hosted project and makes an unaccepted quote visible. Migration `0084` is local only and puts that request back off the driver feed. A real admin Payments page leaves synthetic captures out until Include test data is on. The full local database suite passed: 41 files, 689 tests.

On a delivered job, Drop-off Review sits under the customer status. It shows the drop-off photo, Confirm Delivery, and Report a Problem. Confirm Delivery still uses the existing capture. A problem report still pauses capture. The 10-minute pickup review is unchanged. The driver sees gray “Awaiting customer confirmation,” then green “Delivery complete.”

Customer account navigation lists Offers immediately before Help on the phone header, the desktop customer menu, and Profile. Offers opens the existing requests list. Customer and driver job screens keep the status and the one next action at the top. Job details, route history, photos, and messages start collapsed. Addresses and map links stay open for the driver. Payment, proof, dispute, and delivery steps are unchanged. This is local only and is not deployed.

Customer My Deliveries uses Requests, Active, and History. Each saved status, including disputed and retired jobs, is in one list. A job page uses Progress, Offers, and Details, with the current review or payment action above those tabs. Driver Jobs keeps Available, My Jobs, Active, Awaiting Payment, Completed, and Closed, with a count on each. Proof thumbnails open a larger preview. Dates display in the Georgia time zone. Pickup and drop-off contact fields, item-size classes, and two-person rules were not added.

The public blog is at /blog and /blog/[slug]. Only published articles are listed, searched, or included in the sitemap. Drafts stay private, including their images in the private blog-images bucket. Admins create, preview, publish, unpublish, and delete articles at /admin/blog. The homepage shows the three newest published articles and hides that section when there are none. Migration 0085 is local only and has not been applied to the hosted database. A later local migration, 0086, keeps the old address of a published article working after an admin changes it, and published images are not stored in a shared cache.

The public support form is at /contact. Signed-in visitors can read replies to their own requests. Logged-out replies are emailed only when email delivery succeeds. Admins manage requests at /admin/support, including internal notes. Migration 0087 is local only. The existing job problem report and signed-in support chat stay in place. No articles were invented.
