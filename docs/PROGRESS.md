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
- No commit and no push.
