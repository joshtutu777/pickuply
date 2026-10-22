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
- Three required pricing methods: Get a quote, Name your price (minimum $35, optional “Book the first driver who accepts my price”), Set a budget range (minimum at least $35, maximum higher than the minimum). The estimate does not change those amounts.
- Estimate uses only the SPEC §7.2 ranges and the $35 minimum. Unknown distance is treated as within 10 miles. Per-mile, extra-stop, and platform-fee amounts are not added. If a required input is missing, the form says “We'll confirm a price after reviewing your request” instead of a number. On a phone, that line stays in a bar at the bottom once a service is chosen.
- 3+ flights are counted as 3. Junk has no stair adder. Free-item pickups use the light-load range and default the date to ASAP. Construction uses the full-service ranges. “Full truck” is the spec row “Full pickup or trailer.”
- Item value over $1,000 is allowed and flagged. The warning is “Items over $1,000 need approval before booking.”
- Pickup city is matched to the spec zones (`west_metro`, `east_gwinnett`). Any other city is stored with no zone. There is no zone picker.
- After Submit, the screen says “Text verification will be added in a later step.” It does not pretend a text was sent. “Save on this device” writes the request and opens the job page, labeled “Demo: saved on this device only. Not sent yet.”
- The job page timeline is Requested → Quoted → Confirmed → Driver assigned → Picked up → Delivered, with Requested current. The stored status is only `requested`.
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
- SPEC §6 has no “Confirmed” status. The demo timeline uses the approved Step 2 labels. Stored status stays `requested`.
- Access notes, including gate codes, are saved in the browser draft. Phone, email, and street addresses are not.
- Email is stored only on the local private record. SPEC §14 does not put email on `job_private`; it belongs on the profile later.
- `docs/BUILD_PLAN.md` Step 6 is the live form with a text code and `POST /api/jobs`. This step is the offline form.
- Cursor rules are in `docs/.cursor/rules/`, not `.cursor/rules/`, so Cursor may not apply them automatically.
- The project rules mention Next.js 15. This app is Next.js 16.4.2.
- Landing-page price ranges from SPEC §4.1 are not on the homepage yet.
- Purchase questions are delivery only, matching SPEC §4.2.
- Size is one choice (small, medium, large, extra large). There is no separate weight field.
