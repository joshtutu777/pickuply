# Pickuply — Build Plan with Cursor Prompts

Work through these steps **in order**. Paste each prompt into Cursor's Agent chat. Test before moving on, then **commit** (Source Control → message → Commit → Sync).

Before each new step, start a **fresh chat** and begin with: *"Read docs/SPEC.md, docs/PROGRESS.md, and the project rules."*

---

## Phase 0 — Accounts to create first
- [ ] Supabase project `pickuply` → save Project URL, anon key, service role key
- [ ] Stripe (Test mode) → save publishable key, secret key
- [ ] Vercel → sign in with GitHub
- [ ] Twilio → start A2P 10DLC texting registration now (approval takes time)
- [ ] Google Cloud → Maps API key (later, step 14)

---

## Step 1 — Project setup
> Read docs/SPEC.md and the project rules. Set up a new Next.js app in this folder (TypeScript, App Router, Tailwind, ESLint, `src/` not needed). Install `@supabase/supabase-js`, `@supabase/ssr`, `stripe`, `zod`. Create `.env.local.example` listing every environment variable we'll need (Supabase URL/anon/service role, Stripe keys and webhook secret, Twilio, VAPID keys, app URL, cron secret, admin phone) with comments. Make sure `.env.local` is in `.gitignore`. Create `docs/PROGRESS.md` with a log template. Create a simple home page that says "Pickuply — You Find It. We Pick It Up." Don't build features yet. Tell me how to run it.

**Test:** `npm run dev` → open http://localhost:3000. Copy `.env.local.example` to `.env.local` and fill in Supabase + Stripe test keys.

---

## Step 2 — PWA basics
> Make the app an installable PWA: add `app/manifest.ts` (name Pickuply, short name, theme color, icons), placeholder icons (192, 512, apple-touch), and a minimal service worker in `public/sw.js` registered from a client component. No offline caching yet—just installability and a `push` event handler stub. Explain how I test install on iPhone and Android.

**Test:** Chrome DevTools → Application → Manifest shows no errors.

---

## Step 3 — Supabase clients and auth helpers
> Create `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server components/route handlers using cookies), `lib/supabase/admin.ts` (service role, server-only, with `import 'server-only'`), and `middleware.ts` that refreshes the session. Add `lib/auth.ts` with `getUser()`, `getProfile()`, and `requireRole(role)` helpers.

---

## Step 4 — Database schema (core)
> Using SPEC.md §14, write `supabase/migrations/0001_core.sql` for: profiles, zones (seed west_metro and east_gwinnett), drivers, vehicles, availability_blocks, jobs, job_private, job_photos, job_events, messages, audit_log. Include enums/check constraints, indexes, a trigger that creates a `profiles` row (role `customer`) when an auth user is created, RLS enabled on every table, and SELECT policies following SPEC §12 (customers see their own jobs; drivers see only eligible open jobs' non-private columns and their assigned jobs; job_private only for owner, assigned driver, admin). Add helper functions `is_admin()`, `is_driver()`, `is_assigned_driver(job_id)`. Explain each policy, and give me test queries.

**Test:** Run the SQL in Supabase SQL Editor. Then make yourself admin:
`update profiles set role = 'admin' where phone = '+1XXXXXXXXXX';` (after Step 5).

---

## Step 5 — Phone sign-in
> Build `/login`: enter phone (US format, normalize to +1), receive a 6-digit code via Supabase phone OTP, verify, then redirect by role (customer → /account, driver → /driver, admin → /admin). Add sign-out. Handle errors clearly.

**Setup:** Supabase → Authentication → Providers → Phone → enable with Twilio credentials. For testing before Twilio is approved, add **test phone numbers with fixed codes** in Supabase Auth settings.

---

## Step 6 — Customer request form (guest → verified)
> Build the landing page per SPEC §4.1 and the request form at `/request` per SPEC §4.2. Mobile-first, multi-step (Service → Item → Where → Access & When → Contact). Show a live estimate range from `lib/pricing.ts` (SPEC §7). Save the draft in localStorage. Photos upload to a private `job-photos` bucket. At the end, verify phone with OTP, then call a server route `POST /api/jobs` that validates with zod, creates the `jobs` row (status `requested`) and `job_private` row, saves photos, writes a job event, and returns the job id. Redirect to `/jobs/[id]`.

The form, draft, and estimate shipped earlier. Step 3c (2026-10-22) saves the request with `create_customer_request` in `supabase/migrations/0006_create_customer_request.sql` instead of `POST /api/jobs`. The customer signs in on the request page, then the browser calls that function with the signed-in session. Photos use `attach_request_photo`. `/account` lists the customer's jobs and `/admin` has a read-only list. `0006` is applied on the local database and, as of 2026-10-22, on the hosted project through the Management API. See `docs/PROGRESS.md`.

---

## Step 7 — Admin: requests inbox and quoting
> Build `/admin` (admin-only layout with nav) and `/admin/requests`: list `requested` jobs with photos (signed URLs), details, and approximate + exact addresses. A quote form sets service_level, required_vehicle, price, driver pay, dump fee (junk), pickup window, and quote expiry (default 24h). `POST /api/admin/jobs/[id]/quote` validates (price ≥ $35), sets status `quoted`, logs event + audit log. Show the customer a quote on `/jobs/[id]`.

---

## Step 8 — Customer accepts quote: Stripe card hold
> On `/jobs/[id]`, when status is `quoted`, show the price breakdown, policies (fees, damage limit, item cap), and an **Accept & add card** button. `POST /api/jobs/[id]/checkout` creates a Stripe Checkout Session with `payment_intent_data.capture_method = 'manual'` for the quoted amount. Add `/api/stripe/webhook` (verify signature): on `checkout.session.completed`, save the payment intent id, set job `confirmed` then `open`, log events. Explain how to test with the Stripe CLI and test card 4242 4242 4242 4242.

---

## Step 9 — Driver onboarding and admin approval
> Build `/driver/onboarding` per SPEC §5.1 (multi-step: profile, vehicle(s), capabilities, services, documents, agreement). Documents go to a private `driver-docs` bucket. On submit, driver status `pending_review` and profile role `driver`. Build `/admin/drivers` (list by status) and `/admin/drivers/[id]` (view docs with signed URLs, approve → `approved_new`, request changes, decline, pause, remove, mark vehicle approved). Log audit entries. Add the in-app training page `/driver/training`.

---

## Step 10 — Driver home, Online toggle, live job feed, accept
> Build `/driver` home: Online/Offline toggle at top (SPEC §5.3 checks; show what's missing if it fails), weekly availability editor, and the job feed of eligible `open` jobs (SPEC §5.4) showing only approximate info and driver pay. Use Supabase Realtime to show new jobs instantly. Write `supabase/migrations/0002_claim_job.sql` with an atomic `claim_job(job_id)` function (SPEC §5.5) and `POST /api/jobs/[id]/claim` that calls it. `approved_new` drivers see only jobs admin assigned to them. Add admin manual assign/reassign on `/admin/jobs`.

**Test:** Two browsers, two driver accounts, tap Accept at the same time → only one wins.

---

## Step 10b — Driver offers and counteroffers
> Read SPEC §4.3, §5.5, §7.1, §14. Offers apply to fixed and range jobs only. Drivers (Online, eligible, not blocked by that customer) can Accept a fixed price, Offer within a range, or Counter outside it with a required reason, entering their own earnings; the app adds the platform fee and shows the customer total. A counteroffer does not change the customer's original price. Enforce limits (one active offer per driver per job, max 2× customer price, 2-hour expiry). Customer job page lists offers (driver first name, photo, rating, jobs, vehicle, availability, reason, outside-range flag, total) with Choose → Stripe authorization for the total → assigned → other offers declined. The customer must choose the offer. There is no auto-booking. Admin can see and cancel offers. Tests: two customers/drivers racing, expiry, limits, and a quote job rejecting driver offers.

---

## Step 11 — Active job steps and photos
> Build `/driver/jobs/[id]`: shows exact addresses and customer first name only for the assigned driver, with "Open in Maps" links. Steps per SPEC §5.6 with buttons and photo uploads (compress images in the browser before upload). `POST /api/jobs/[id]/status` enforces valid transitions and who can make them. Customer `/jobs/[id]` shows the timeline, driver info, pickup photos with **Approve / Reject** for item check. Reject → capture $25 trip fee, cancel job, log. Junk jobs require a dump-receipt photo before `delivered`.

---

## Step 12 — Completion, capture, payouts
> When status is `delivered`, the customer sees **Got it** → `POST /api/jobs/[id]/confirm` captures the PaymentIntent (idempotency key), sets `completed`, creates a `payouts` row (due in 24h). Add a Vercel cron route `/api/cron/auto-complete` (protected by CRON_SECRET) that completes jobs delivered 24h+ ago with no open report. Add `/admin/payouts` with countdown, overdue in red, mark paid (method + reference). Add cancellation rules from SPEC §6 (cancel before/after assignment, partial capture $15). Add admin refund (full/partial) via Stripe, audit-logged.

---

## Step 13 — Messages
> Add in-app messages per job between customer and assigned driver (and admin), with Supabase Realtime. Phone numbers never shown. Messaging closes 24h after completion.

---

## Step 14 — Notifications (SMS + push)
> Add `lib/sms.ts` (Twilio) and `lib/push.ts` (web-push with VAPID). Add push subscription (`/api/push/subscribe`, `push_subscriptions` table) and an iPhone "Add to Home Screen" guide. Implement `lib/notify.ts` and wire up every notification in SPEC §11. New open jobs → push to eligible Online drivers, SMS fallback. Admin alert if no driver accepts within 20 minutes (cron).

---

## Step 15 — Reviews
> Add reviews per SPEC §8 for completed jobs (customer → driver, driver → customer), unique per job+direction. Optional tip via a separate Stripe Checkout payment added to the driver's payout. Update driver rating averages; flag below 4.5 after 10 jobs; auto-pause below 4.0. Show driver rating and job count on assignment.

---

## Step 16 — Reports, disputes, strikes
> Add `supabase/migrations/0003_reports.sql` (reports, strikes) and the flows in SPEC §9: customer and driver report forms with evidence photos and case numbers; severity rules (critical → auto-pause driver, hold payout, text admin); driver can respond; `/admin/reports` queue and resolution workflow; strikes with 90-day expiry and auto-pause at 3+.

---

## Step 17 — Admin metrics and job tracker
> Build `/admin/metrics` per SPEC §10.7 and §15: weekly and per-zone jobs, revenue, driver payouts, dump fees, refunds, margin, driver pay per hour, request-to-quote time, repeat customers, against pilot targets. Add CSV export of jobs.

---

## Step 18 — Customer account and polish
> Build `/account`: job history with receipts and photos, saved addresses, repeat a job. Add terms of service and privacy policy pages (placeholder text marked for lawyer review). Review all screens for loading/empty/error states and mobile layout.

---

## Step 19 — Deploy
> Help me deploy to Vercel: connect the GitHub repo, set environment variables, set up the Stripe webhook endpoint for production, add the cron jobs in `vercel.json`, and connect a custom domain. Give me a go-live checklist (switch Stripe to live mode only after a full test run).

---

## Go-live test checklist
- [ ] Customer: request → quote → accept with test card → track → approve item → confirm → review
- [ ] Two drivers accept the same job at once → only one wins
- [ ] Driver in another zone or wrong vehicle does NOT see the job
- [ ] Unassigned driver cannot see exact address (check the network tab too)
- [ ] Customer cancels before / after assignment → correct fee
- [ ] Item rejected → $25 trip fee
- [ ] Auto-complete after 24h works
- [ ] Critical report → driver paused, payout held, admin texted
- [ ] Refund works and is logged
- [ ] Payout marked paid; driver notified
- [ ] Push notification arrives on Android and on iPhone (installed app)
