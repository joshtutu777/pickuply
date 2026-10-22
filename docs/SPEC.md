# Pickuply — Product Spec v1.0 (Pilot)

> Working name: **Pickuply** (formerly DeliveryMatch). Tagline: *"You Find It. We Pick It Up."*
> Subheadline: *"Found it. Bought it. Can't pick it up? We'll bring it home."*
> Mission: Help people secure local purchases by arranging trustworthy, affordable transportation before they lose the item, and haul away what they no longer need.
> Status: Pilot MVP. Built as a mobile-friendly Progressive Web App (PWA).
> This file is the source of truth. If code and this spec disagree, ask before changing either.

---

## 1. What Pickuply is

A local marketplace that connects people who need something picked up and moved with nearby verified drivers who have the right vehicle. It covers both bringing something to you and taking something away. It's built especially for Facebook Marketplace, free-item groups, and time-sensitive secondhand purchases. The admin (owner) reviews every request before drivers see it, approves prices, and controls drivers.

**Customer promise:** Vetted drivers. Locked prices. You pay only when it arrives.

### Services (v1)
| Service | Examples |
|---|---|
| **Item delivery** | Facebook Marketplace finds, store pickups, single items, multi-piece sets |
| **Junk removal & hauling** | Old furniture, trash, move-out and eviction cleanouts, yard debris |
| **Free-item pickups** | Large items from free groups (first come, first served — speed matters) |
| **Construction store deliveries** | Home Depot, Lowe's, lumber yards, building materials |

### Pilot zones (v1)
| Zone | Areas |
|---|---|
| `west_metro` | Austell, Lithia Springs, Smyrna, Mableton, Hiram, SW Atlanta |
| `east_gwinnett` | Lawrenceville, Snellville, Loganville, Buford, Duluth, Norcross |

Zones must be data (a table), not hard-coded, so new zones can be added later.

---

## 2. Users and roles

| Role | What they do |
|---|---|
| **Customer** | Requests a job (as a guest), verifies phone, accepts a locked quote, authorizes payment, tracks the job, approves the item check, confirms delivery, reviews, reports problems |
| **Driver** | Onboards, gets approved, sets availability, goes Online/Offline, sees eligible jobs in their zone, accepts jobs, completes job steps with photos, sees earnings |
| **Admin** | Reviews requests, sets prices and driver pay, approves/pauses drivers, assigns/reassigns jobs, handles reports and disputes, issues refunds, marks payouts paid, sees metrics |

A user has exactly one role. Admin role is set manually in the database (never self-assigned).

---

## 3. Key decisions (locked for v1)

| Topic | Decision |
|---|---|
| App type | Mobile-first web app, installable PWA, push notifications |
| Sign-in | Phone number + 6-digit text code (passwordless) for everyone. Email optional |
| Pricing | Customer chooses one of **three pricing methods**: Get a quote, Name your price (fixed offer), or Set a budget range. See §7.1. Every price is locked before booking |
| Who responds | **Get a quote:** admin sends the quote (v1). **Fixed offer:** eligible drivers accept the price or send a counteroffer. **Budget range:** eligible drivers offer a price within the range or counter above it. Admin can quote, counter, or assign on any job |
| Platform fee | **Shown on top** of the driver's price (default 20%, minimum $10, admin-configurable). Customer always sees the total before accepting. *(Default — owner to confirm)* |
| Driver matching | Admin reviews each request, then publishes it to eligible drivers. Booking happens when the customer accepts a quote/offer, or instantly when a driver accepts a fixed price and the customer opted in to auto-booking. The database guarantees one assigned driver. Admin can also assign manually |
| Customer payment | Stripe. Card **authorized (held)** when quote is accepted; **captured after delivery is confirmed** |
| Driver payouts | Manual: Zelle or Cash App within **24 hours** of completion. Admin marks "Paid" in the app. (Stripe Connect is v2) |
| Background checks | **None in v1.** Verification = ID/license, insurance, vehicle photo, personal call with admin. Never claim background checks in UI copy |
| Minimum fee | $35 |
| Damage coverage limit | $250 per job |
| Late cancel fee | $15 (after a driver is assigned) — goes to the driver |
| Trip fee | $25 if the customer rejects the item at the pickup item check |
| Auto-complete | 24 hours after "Delivered" unless the customer reports a problem |
| Item value cap | $1,000 per job during the pilot (admin can override) |

### Not accepted (prohibited items)
Hazardous materials, chemicals, propane tanks, paint/solvents (junk), weapons, drugs, cash, live animals, people, phones/small high-value electronics, jewelry.

---

## 4. Customer experience

Goal: request a quote in **under 2 minutes**, no account required up front.

### 4.1 Landing page
- Headline: "You Find It. We Pick It Up." Subheadline: "Found it. Bought it. Can't pick it up? We'll bring it home."
- Four service cards: Pickup & Delivery · Free-Item Pickups · Junk Removal & Hauling ("Old furniture, junk, and yard debris. Send a photo and we'll get you a price.") · Construction Store Deliveries. Each links to `/request?service=...`
- "Have a truck? Drive with Pickuply" link to driver onboarding
- Trust strip: Verified drivers · Price locked before pickup · Card charged only after delivery
- How it works (4 steps), price ranges, testimonials (later)

### 4.2 Request form (guest)
| Section | Fields |
|---|---|
| Service | delivery / junk / free_item / construction |
| Item | Photos (up to 8) and/or listing link, description, number of pieces, approx. size/weight |
| Purchase | Already paid? Seller holding it? Want a video item check before pickup? (delivery only) |
| Where | Pickup address, drop-off address (junk: drop-off not needed) |
| Access | Stairs at pickup/drop-off (number of flights), elevator, can someone help load? |
| When | ASAP / today / choose date + time window |
| Junk only | Load size (single item, ¼, ½, full), materials, includes mattress/tires/appliances? |
| Item value | Approximate value. Over $1,000 is allowed but flagged `needs_value_approval` with the warning "Items over $1,000 need approval before booking." |
| Construction only | Store name, optional order/pickup number |
| Pricing method (required) | **Get a quote** (no amount) · **Name your price** (fixed amount, min $35, optional "Book the first driver who accepts my price" = `auto_book_on_accept`) · **Set a budget range** (min ≥ $35, max > min). Copy: "Drivers can accept your price or send a counteroffer. You choose. Nothing is charged until you accept." |
| Contact | Name, phone (required), email (optional), "How did you hear about us?" (Nextdoor, Facebook, friend, landlord/property manager, other) |

- Shows a **typical price range** as guidance (see §7), labeled: "Typical price for jobs like this within 10 miles: $X–$Y. Distance and details may change the final price." If required inputs are missing, show "We'll confirm a price after reviewing your request" instead of a number. The estimate never changes the customer's chosen pricing method or amounts.
- The draft is saved in the browser until the phone is verified, then attached to the account. Phone, email, and exact street addresses are never written to browser storage (kept in memory only).
- Submitting = phone verification (text code) → request created with status `requested`.
- Customer agrees to terms (prohibited items, fees, damage policy, photos) at submission.

### 4.3 Quotes, offers, and booking
- Admin reviews every new request first (prohibited items, safety, zone, completeness, item value) → **approves and publishes** it, or asks the customer for changes.
- **Get a quote:** admin sends a locked price + pickup window → customer gets a text with a link → **Accept** → card authorized → job published to eligible drivers at the admin-set driver pay; first eligible Online driver to accept is assigned.
- **Name your price / Budget range:** the job is published to eligible drivers, who can accept, offer, or counter (§5.5). Customer sees offers on the job page.
- **Offer comparison** shows each driver's first name, photo, rating, completed jobs, vehicle, pickup availability, counter reason (if any), and the **total price including the Pickuply fee**. Customer taps **Choose** → card authorized for the total → driver assigned → all other offers closed.
- **Auto-book:** if `auto_book_on_accept` is on and a driver accepts the exact fixed price, the card on file is authorized immediately and the job is booked. If authorization fails, the job is not booked and the customer is asked to update payment.
- Admin quotes expire after 24 hours; driver offers expire after **2 hours** (default) unless chosen. Customers can edit or withdraw a request before booking.
- Quote/offer page shows: price breakdown, what's included, cancellation/trip fee policy, item value cap.

### 4.4 Job status page
- Timeline of statuses (see §6) with timestamps.
- Once assigned: driver first name, photo, vehicle, rating, number of jobs.
- **Item check:** pickup photos/video appear → customer taps Approve or Reject.
- Driver's last shared location and status updates.
- In-app **messages** with the assigned driver (phone numbers never shown).
- **Report a problem** (during job and 7 days after).
- **Cancel** (fee rules apply).
- After delivery: **Got it** (captures payment) → review + optional tip.

### 4.5 Customer account
- Job history with receipts and photos, saved addresses, repeat a job.

---

## 5. Driver experience

### 5.1 Onboarding
1. **Sign in** with phone + code
2. **Profile:** full name, profile photo (shown to customers), home city, zone, max distance (10/15/25 miles)
3. **Vehicle(s):** type (car, SUV, pickup, van, box truck, trailer), make/model/year, plate, bed/cargo length, photo. Can add more than one
4. **Capabilities:** service level `light` (no heavy lifting, no stairs) or `full` (heavy items, stairs); helper name + phone (optional); equipment (blankets, straps, dolly, ramp)
5. **Services offered:** delivery / junk / free_item / construction
6. **Documents:** driver's license photo + expiration; insurance proof + expiration (may upload later, but **required before going Online**); payout method (Zelle or Cash App handle); W-9 (collected before $600 earned)
7. **Driver agreement** (checkboxes + typed signature):
   - Independent contractor, not an employee
   - Never charge customers more than the locked price; never take payment directly
   - Photos at pickup and drop-off on every job; dump receipt for junk jobs
   - No prohibited items; licensed disposal only (no roadside dumping)
   - Cancel at least 2 hours ahead; a no-show may mean removal
   - Respect customer privacy (no contact after the job)
8. **Pending review** → admin approves, requests changes, or declines
9. **Quick training** (in-app, ~5 minutes): job steps, what to photograph, item check, wrapping/strapping, what to do if item doesn't match or seller no-shows
10. **First 1–2 jobs** are assigned by admin ("New driver" badge). After 2 clean jobs → full live feed

### 5.2 Driver statuses
| Status | Meaning |
|---|---|
| `applied` | Profile started |
| `pending_review` | Documents submitted |
| `approved_new` | Can take admin-assigned jobs only |
| `active` | Sees and accepts live jobs |
| `paused` | Expired documents, strikes, low rating, or admin action |
| `removed` | Permanently removed |

### 5.3 Availability
- **Online/Offline toggle** at the top of Driver Home, status visible everywhere in the driver app (also on the Jobs tab).
- Going **Online** checks: status is `active` (or `approved_new` for assigned jobs), license and insurance not expired, at least one approved vehicle. If a check fails, show what's missing.
- **Offline:** stops new job alerts; accepted jobs stay active.
- Drivers may **browse** eligible jobs while Offline but can only **accept** while Online.
- Weekly schedule (time blocks) + optional "unavailable until" date.
- Alert preferences: push, text, or both.

### 5.4 Job feed (eligibility)
A driver sees a published job only if ALL are true:
- Job zone = driver zone, and pickup is within the driver's max distance (when coordinates exist)
- Driver offers that service
- Job service level ≤ driver level (`full` jobs → only `full` drivers)
- Driver has an approved vehicle that meets the job's `required_vehicle`
- Driver is not paused/removed and not blocked by that customer

Job cards show: service, item photos, **approximate** pickup/drop-off area (city or ZIP only), distance, stairs, time window, **driver pay**. Exact addresses and customer contact are hidden until assigned.

### 5.5 Accepting, offering, and countering (no double booking)
- **Admin-priced jobs** (Get a quote): **Accept** calls a single database function that atomically assigns the job only if it is still `open` and the driver is eligible and Online. Anyone else gets "Job already taken."
- **Fixed-price jobs:** driver taps **Accept $X** (books instantly if auto-book is on; otherwise sends an offer at that price) or **Counter** with a new amount and a **required reason** (e.g. "3 flights of stairs not mentioned", "needs two people").
- **Budget-range jobs:** driver taps **Offer** with an amount inside the range, or **Counter** above the max with a required reason.
- Drivers enter **their own earnings**; the customer sees that amount plus the platform fee. Drivers always see exactly what they'll earn.
- Limits: one active offer per driver per job (they can withdraw and resubmit once); counters can't exceed 2× the customer's fixed price or range max; offers expire after 2 hours.
- Only **Online**, eligible drivers can accept or offer. Final assignment uses the same atomic database function, so only one driver can be assigned.
- After booking, any price change requires a request in the app and the other party's approval. Drivers can never charge unilaterally.
- Driver and customer both get assignment confirmation.

### 5.6 Active job steps
1. **On the way** (shares location while app is open)
2. **Arrived**
3. **Item check:** pickup photos (all sides, existing damage) → customer Approve/Reject (delivery jobs). Optional pickup confirmation code from the seller
4. **Loaded / In transit**
5. **Delivered:** drop-off photos; junk jobs also upload a **dump receipt**
6. Waiting for customer confirmation → **Completed**

If the customer rejects the item: job ends, $25 trip fee captured, driver paid the trip fee share.

### 5.7 Earnings
Completed jobs, pending payouts, paid payouts, totals by week.

---

## 6. Job lifecycle

| # | Status | Set by | Notes |
|---|---|---|---|
| 1 | `requested` | Customer | Request submitted, phone verified |
| 2 | `in_review` | Admin | Admin checking the request (optional) |
| 3 | `quoted` | Admin | Get-a-quote jobs: price, driver pay, service level, required vehicle, pickup window set |
| 4 | `open` | Admin/System | Published to eligible drivers. For quote jobs: after the customer accepted and the card was authorized. For fixed/range jobs: after admin approval, collecting offers |
| 5 | `assigned` | Customer/Driver/Admin | Customer chose an offer (card authorized), driver accepted an admin-priced job, auto-book succeeded, or admin assigned |
| 6 | `en_route` | Driver | On the way to pickup |
| 7 | `arrived` | Driver | At pickup |
| 8 | `item_check` | Driver | Photos uploaded, waiting for customer approval |
| 9 | `in_transit` | Driver/Customer | Item approved and loaded |
| 10 | `delivered` | Driver | Drop-off photos uploaded |
| 11 | `completed` | Customer/System | Customer confirmed or 24h auto-complete; payment captured |
| — | `cancelled` | Any | With cancellation reason and fee outcome |
| — | `disputed` | System | A high/critical report is open; payout held |

Every status change writes a **job event** (who, what, when, extra data). Every admin action writes an **audit log** entry.

### Cancellation rules
| Situation | Outcome |
|---|---|
| Customer cancels before assignment | Free; authorization released |
| Customer cancels after assignment | $15 captured; goes to driver |
| Customer rejects item at pickup | $25 trip fee captured; driver share paid |
| Driver cancels | Job goes back to `open`; counts against reliability (strike if within 2h of pickup) |
| Driver no-show | Admin alerted, job reassigned, customer gets a credit; 2 strikes |

### Payment authorization note
Card authorizations expire after ~7 days. For jobs scheduled more than 5 days out, authorize closer to the date (store the card, authorize 48h before). v1 may simply limit booking to within 5 days.

---

## 7. Pricing

### 7.1 Pricing methods
| Method | Customer enters | Stored as | Who responds |
|---|---|---|---|
| Get a quote | Nothing | `pricing_method = 'quote'` | Admin (v1) |
| Name your price | One amount, min $35; optional auto-book | `'fixed'`, `offer_cents`, `auto_book_on_accept` | Drivers accept or counter |
| Set a budget range | Min (≥ $35) and max (> min) | `'range'`, `budget_min_cents`, `budget_max_cents` | Drivers offer within range or counter above |

**Customer total = driver price + platform fee** (default 20%, min $10; admin-configurable). For admin quotes, admin sets the customer price and driver pay directly. The total is always shown before the customer accepts.

### 7.2 Typical price ranges (pilot defaults, used for estimates and admin quotes; admin can override every price)

### Delivery (within 10 miles)
| Level | Includes | Price |
|---|---|---|
| Light Load | 1 driver, small/medium items, no stairs, someone helps load | $35–60 |
| Full Service — single large item | 2 people, all lifting | $90–120 |
| Full Service — multi-piece | 2 people, sets, stairs OK | $140–200 |
| Extra stop | Each nearby pickup | +$15–25 |
| Extra distance | Each mile past 10 | +$1.50–2 |
| Stairs | Each flight (Full Service) | +$15–25 |

### Junk removal (includes dump fee)
| Load | Price |
|---|---|
| Single item | $50–75 |
| ¼ truck | $90–130 |
| ½ truck | $150–220 |
| Full pickup or trailer | $250–350 |
| Cleanout | Quote from photos |

Free-item pickups: priced like Light Load, ASAP by default. Construction deliveries: priced like Full Service.

**Driver pay:** for admin-quoted jobs, set per job by admin (default 75–80% of price; junk removal: dump fee reimbursed first). For fixed/range jobs, driver pay = the driver's chosen offer amount; the platform fee is added on top. Tips go 100% to the driver.

---

## 8. Reviews

Only for **completed** jobs, only by the two parties on that job, once each.

**Customer → driver:** 1–5 stars, tags (On time, Careful with items, Friendly, Good communication, Clean vehicle), comment, optional tip, "Would you use Pickuply again?", referral source (first job).

**Driver → customer:** 1–5 stars, tags (Item as described, Ready on time, Easy access, Seller helpful), private note to admin.

Show drivers' average rating, completed jobs, review count. Never show private reports publicly. Driver below 4.5 after 10 jobs → admin review flag; below 4.0 → auto-pause pending review. Reviews must not penalize customers for reporting legitimate problems.

---

## 9. Reports, disputes, and strikes

### Customer reports a driver/job problem
Available from the active job, job history (7 days after completion), or driver profile on their booking.

| Category | Severity |
|---|---|
| Late or no-show | medium |
| Rude or unprofessional | medium |
| Item damaged | high |
| Asked for extra money or direct payment | high |
| Item missing or not delivered | critical |
| Unsafe behavior (driving, harassment, threats) | critical |
| Other | medium (admin can change) |

Fields: category, description, evidence photos, "involves an immediate safety concern" checkbox, desired outcome (refund, repair, apology, just letting you know). Report auto-captures job ID, both user IDs, timestamps, agreed price, and job event history. Each report gets a case number (e.g. `PU-1042`) and status (`open`, `under_review`, `awaiting_response`, `resolved`).

**What happens:**
- **critical:** immediate text to admin, driver auto-paused, job payout held, job → `disputed`
- **high:** text to admin, payout held
- **medium:** added to admin queue

Drivers can view reports about them and **respond** before admin decides.

### Driver reports a customer/seller
Item not as described, undisclosed stairs/heavy lifting, unsafe location, harassment, customer unavailable, prohibited materials, pressure to do work outside scope. Driver can request cancellation, review, or an **approved price adjustment** (customer must approve in app; drivers can never charge unilaterally). Repeat problem customers can be blocked.

### Admin resolution
Review evidence, contact both parties, record notes, then resolve with: no action · warning · refund (full/partial) · damage covered (up to $250) · strike(s) · driver paused · driver removed · customer blocked. Both parties are notified. Serious allegations can trigger temporary restriction without treating them as proven.

### Strikes
| Event | Strikes |
|---|---|
| Late 30+ min without notice | 1 |
| Rude/unprofessional (confirmed) | 1 |
| Cancel within 2h of pickup | 1 |
| Damage due to carelessness (confirmed) | 2 |
| No-show | 2 |
| Asking for extra or direct payment (confirmed) | removal |
| Theft or unsafe behavior (confirmed) | removal |

3+ active strikes within 90 days → auto-pause pending review. Strikes expire after 90 days.

---

## 10. Admin dashboard

1. **Requests inbox:** new requests with photos → set service level, required vehicle, price, driver pay, pickup window → send quote
2. **Jobs board:** all jobs by status and zone; assign/reassign; cancel; view photos, messages, event history
3. **Drivers:** applicants (approve / request changes / decline with document review), roster, status, zone, level, rating, strikes, document expirations
4. **Reports & disputes:** queue by severity and age; resolution workflow
5. **Payouts:** completed jobs awaiting payout with 24h countdown; overdue flagged red; mark paid (method + reference)
6. **Refunds:** full/partial refund through Stripe (logged)
7. **Metrics:** jobs, gross revenue, driver payouts, dump fees, refunds, platform margin, average margin %, driver pay per hour, request-to-quote time, repeat/referred customers — by week and zone, compared to pilot targets
8. **Customers:** list, job history, block/unblock

All admin actions are permission-checked on the server and audit-logged.

---

## 11. Notifications

| Event | Customer | Driver | Admin |
|---|---|---|---|
| Request submitted | ✔ confirmation | | ✔ new request |
| Quote sent | ✔ text with link | | |
| Job published | | ✔ eligible Online drivers (push + text fallback) | |
| Job assigned | ✔ driver info | ✔ confirmation | ✔ |
| No driver after 20 min | | | ✔ alert |
| Status changes | ✔ | | |
| Item check ready | ✔ approve/reject | | |
| Delivered | ✔ confirm receipt | | |
| New message | ✔ | ✔ | |
| Report filed | | ✔ (if about them) | ✔ (text for high/critical) |
| Payout marked paid | | ✔ | |
| Document expiring in 30 days | | ✔ | ✔ |

Push uses Web Push (VAPID). On iPhone, push works only after "Add to Home Screen" — show a one-time install guide. SMS is the fallback.

---

## 12. Privacy and safety rules (must hold everywhere)

- Drivers browsing jobs see **only approximate areas** (city/ZIP), distance, and requirements.
- Exact addresses, phone numbers, and names are visible only to: the customer, the **assigned** driver (from assignment until 24h after completion), and admin.
- Phone numbers are never shown between customer and driver; they talk through in-app messages.
- Photos are stored privately; served via short-lived signed URLs only to job participants and admin.
- Drivers never handle item payments or cash. For purchases, the buyer pays the seller directly after approving the item check.
- Driver safety: daylight/public pickups preferred, "leave if unsafe" with no penalty, SOS/report button on active job.

---

## 13. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS |
| Database, auth, storage, realtime | Supabase (Postgres + Row Level Security, phone OTP auth, Storage, Realtime) |
| Payments | Stripe (PaymentIntents with manual capture, Checkout or Payment Element, webhooks) |
| SMS | Twilio (also configured as Supabase's phone OTP provider) |
| Push | Web Push with VAPID keys (`web-push` library) + service worker |
| Maps | Google Maps Platform (Places autocomplete, Distance Matrix) — v1 can start with plain address fields |
| Hosting | Vercel (including cron jobs) |
| Email (optional) | Resend |
| Error tracking | Sentry |

---

## 14. Data model (starting point)

- `profiles` — id (auth user), role (`customer`/`driver`/`admin`), full_name, phone, email, photo_url, blocked, created_at
- `zones` — id, slug, name, active
- `drivers` — profile_id, status, zone_id, home_city, max_distance_miles, service_level, services[], equipment[], helper_name, helper_phone, license_url, license_expires, insurance_url, insurance_expires, payout_method, payout_handle, w9_received, agreement_signed_at, is_online, last_location, new_driver_jobs_completed, rating_avg, rating_count, alert_prefs
- `vehicles` — id, driver_id, type, make, model, year, plate, cargo_length_in, photo_url, approved
- `availability_blocks` — driver_id, weekday, start_time, end_time
- `jobs` — id, customer_id, service, status, zone_id, pickup_area (city/ZIP), dropoff_area (city/ZIP), distance_miles, description, pieces, size (`small`/`medium`/`large`/`xl`), item_value_cents, needs_value_approval, listing_url, already_paid, seller_holding, wants_item_check, stairs_pickup, stairs_dropoff, elevator, help_loading, junk_load_size, junk_materials, junk_special_items, store_name, store_order_number, preferred_date, time_window, notes, **pricing_method** (`quote`/`fixed`/`range`), **offer_cents**, **budget_min_cents**, **budget_max_cents**, **auto_book_on_accept**, service_level, required_vehicle, price_cents (customer total), driver_pay_cents, platform_fee_cents, dump_fee_cents, quote_expires_at, assigned_driver_id, accepted_offer_id, stripe_payment_intent_id, payment_status, captured_cents, source, created_at, timestamps per status
- `job_offers` — id, job_id, driver_id, kind (`accept`/`offer`/`counter`), driver_amount_cents, platform_fee_cents, customer_total_cents, reason, available_at, status (`active`/`withdrawn`/`expired`/`chosen`/`declined`), expires_at, created_at
- `job_private` — job_id, pickup_address, dropoff_address, pickup_lat/lng, dropoff_lat/lng, customer_name, customer_phone, access_notes (RLS: customer, assigned driver, admin only)
- `job_photos` — id, job_id, stage (`request`, `pickup`, `dropoff`, `dump_receipt`, `report`), storage_path, uploaded_by, created_at
- `job_events` — id, job_id, actor_id, type, data (jsonb), created_at
- `messages` — id, job_id, sender_id, body, created_at, read_at
- `reviews` — id, job_id, rater_id, ratee_id, direction, stars, tags[], comment, private_note, would_use_again, created_at (unique job_id + direction)
- `reports` — id, case_number, job_id, reporter_id, subject_id, reporter_role, category, severity, safety_concern, description, desired_outcome, status, driver_response, resolution, resolution_notes, resolved_by, created_at, resolved_at
- `strikes` — id, driver_id, report_id, points, reason, created_at, expires_at
- `payouts` — id, job_id, driver_id, amount_cents, tip_cents, due_at, status (`pending`, `held`, `paid`), method, reference, paid_at
- `push_subscriptions` — id, profile_id, endpoint, keys (jsonb)
- `audit_log` — id, actor_id, action, target_type, target_id, data, created_at

Critical database functions:
- `claim_job(job_id)` — admin-priced jobs: atomic, checks eligibility and Online status, assigns, writes event, returns success or reason.
- `choose_offer(offer_id)` — customer chooses an offer (or auto-book): atomic, only if the job is still `open` and the offer `active`; assigns the driver, marks other offers `declined`, writes event.

---

## 15. Pilot success criteria (30 days)

- 25+ paid jobs · $3,000+ revenue · 20%+ average margin · drivers average $25+/hour
- 30%+ customers repeat or refer · zero unresolved damage/theft/no-show incidents
- 2+ landlords or property managers book more than once

---

## 16. Later (v2+, do not build in v1)

Drivers responding to "Get a quote" requests with their own quotes, Stripe Connect automatic payouts, business accounts for landlords (multiple properties, invoicing), seller "delivery available" links, favorite drivers, referral credits, background checks, ID verification, masked phone calls, native iOS/Android apps with background GPS, cargo insurance per job.
