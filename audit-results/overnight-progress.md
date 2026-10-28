# Overnight audit progress

Updated: October 28, 2026, about 5:55 PM Eastern.

Branch: `feat/overnight-audit` from `origin/main` (`bf25f63`). Not merged. Not deployed.

## Done

- Local database audit in `supabase/tests/0112_marketplace_audit.sql`. It creates isolated customers, drivers, and an admin, exercises requests, claims, delivery, tips, support, and permissions, then rolls back. No audit rows were left behind.
- Unit suite: 275 passed, 0 failed.
- Production read-only checks of `/terms`, `/privacy`, `/terms/driver`, `/drive`, and `/login`. No production accounts or jobs were changed.
- One isolated Stripe test PaymentIntent for $52.50 with manual capture. It reached `requires_capture` and was canceled. It was not attached to a Pickuply job.
- Headless Chromium was installed. Two browser tests passed fully: a bad phone and a wrong local code are rejected, and a pickup request cannot skip the item description. A local test-OTP sign-in reached the customer account. The local Next dev server then stopped accepting connections, so the rest of the browser file did not finish. That is a test-machine failure, not a product defect.
- An earlier browser run, while the server was still up, got HTTP 400 from `POST /api/stripe/webhook` with a bad signature.

## Not done

- No production OTP, no real SMS, no Checkout in the browser, no Stripe Connect onboarding, no WebKit run, no hosted migration, no deploy.
