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
| Pricing | Customer chooses one of **three pricing methods**: Get Offers, Name your price (fixed offer), or Set a budget range. See §7.1. Every price is locked before booking |
| Who responds | **Get Offers:** drivers send a price. The customer chooses an offer. An admin quote is optional and is not required before drivers see the job. **Fixed:** drivers accept that price, which creates an offer, or send a counteroffer. The counteroffer does not change the customer's original price. **Range:** drivers offer inside the range or counter outside it. Outside-range offers are flagged. The customer chooses the offer. Admin can still assign a driver |
| Platform fee | **10% of driver earnings, minimum $10**, shown in the subtotal. Admin-configurable. |
| Driver matching | A request that passes validation is open to eligible drivers immediately. No admin approval is required. Waves stay off unless an admin turns them on. While waves are off, every eligible driver can see every open request, with no wave delay and no invitation limit. While waves are on, `docs/WAVES.md` decides who sees a request. A job can have five active offers at a time. A driver can offer on more than one open job. An admin can still pause a request, send it to a driver, or send an optional quote. Those actions are audited. Nothing is booked or charged until the customer chooses a driver's offer, or accepts an optional admin quote and a driver claims it. The database guarantees one assigned driver. Admin can also assign manually. There is no auto-booking |
| Customer payment | No card is authorized until a driver is confirmed. Confirming an offer, or a driver claiming an accepted quote job, starts a payment deadline (default 30 minutes). The customer pays by card on Stripe Checkout. The card is authorized, not captured. Work cannot start until payment is `authorized`. Capture happens after the customer confirms delivery, or 24 hours after delivery if they do not. If the authorization expires, stop and flag an admin. Do not start a new charge automatically. |
| Driver payouts | Stripe Connect Express. One account per driver. The app stores the account id and status only, never bank details. After a captured payment, the driver's earnings are a ledger line. A transfer to that Connect account is not a deposit in their bank. Earnings stay held until payout setup is finished, unless an admin records a payment outside Stripe. |
| Background checks | **None in v1.** Verification = ID/license, insurance, vehicle photo, personal call with admin. Never claim background checks in UI copy |
| Minimum fee | $35 |
| Damage coverage limit | $250 per job |
| Late cancel fee | $15 after a driver is assigned and before work starts, once that workflow is built. It is one partial capture of the fee on the existing authorization, and the rest of the hold is released. It is not a new charge, and the card is not saved for a later charge. If the payment was already captured, refund the difference. |
| Trip fee | $25 if the customer rejects the item at the pickup item check. That amount is the only capture, and the rest of the authorization is released. |
| Auto-complete | 24 hours after "Delivered" unless the customer reports a problem |
| Item value cap | $1,000 per job during the pilot (admin can override) |

### Not accepted (prohibited items)
Hazardous materials, chemicals, propane tanks, paint/solvents (junk), weapons, drugs, cash, live animals, people, phones/small high-value electronics, jewelry.

---

## 4. Customer experience

Goal: request a quote in **under 2 minutes**, no account required up front.

### 4.1 Landing page
- Headline: "Say yes to the deal. We'll do the rest." The public tagline "You Find It. We Pick It Up." stays in the footer.
- Post a pickup opens `/request`. Drive with us and Apply to drive open `/drive`. Sign in opens `/login`.
- Four service cards, in this order, each opening the matching request: Pickup & Delivery; Free-Item Pickups; Store Pickup & Delivery; Junk Removal & Hauling ("Old furniture, junk, and yard debris. Send a photo and get offers.").
- The section before the services is text only. The hero has no photograph.
- How it works step 2 is "Set your price / Receive offers": name a price, set a budget, or get offers, then the customer chooses.
- A Georgia outline says Serving Georgia. It does not show driver locations.

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
| Pricing method (required) | **Get Offers** (no amount). Copy: "Drivers set the price and you choose who to book. Nothing is charged until you accept an offer." **Name your price** (one amount, min $35). **Set a budget range** (min ≥ $35, max > min). Copy under both: "Drivers can accept your price or send a counteroffer. You choose who to book. Nothing is charged until you accept." |
| Contact | Name, phone (required), email (optional), "How did you hear about us?" (Nextdoor, Facebook, friend, landlord/property manager, other) |

- Shows a **typical price range** as guidance (see §7), labeled: "Typical price for jobs like this within 10 miles: $X–$Y. Final price confirmed after review." If required inputs are missing, show "We'll confirm a price after reviewing your request" instead of a number. The estimate never changes the customer's chosen pricing method or amounts.
- The draft is saved in the browser until the phone is verified, then attached to the account. Phone, email, and exact street addresses are never written to browser storage (kept in memory only).
- Submitting = phone verification (text code) → request created with status `open`. Drivers can see it immediately. Nothing is booked.
- Customer agrees to terms (prohibited items, fees, damage policy, photos) at submission.

### 4.3 Quotes, offers, and booking
- A request that passes validation is published (`open`) when it is saved. Admin approval is not a step. An admin can pause it, send it to one driver, or send an optional quote. Each of those is audited.
- **Get Offers:** drivers send a price. The customer chooses one offer. That choice assigns the driver and sets `payment_status = awaiting_payment`. It does not charge the card. Claiming does not assign a Get Offers job that has no driver pay.
- **Optional admin quote:** an admin can still set driver pay. The app adds the platform fee and service fee (status `quoted`). The customer sees the breakdown and accepts before the quote expires. Acceptance publishes the job (`open`). It does not assign a driver. An eligible Online driver then claims that priced job, which assigns that driver and sets `payment_status = awaiting_payment`.
- **Name your price / Budget range:** the job is already `open`. Drivers may accept, offer, or counter (§5.5). A counteroffer does not change the customer's original price. Outside-range offers are flagged. The customer must choose one offer. That choice assigns the driver and sets `payment_status = awaiting_payment`. Nothing is charged at that step.
- **Offer comparison** shows each driver's first name, photo, rating, completed jobs, vehicle, pickup availability, counter reason (if any), the outside-range flag, and the **total price including the Pickuply fee**. A new offer stays new until that offer card is actually on screen. Opening My Requests or receiving an alert does not mark it viewed. Customer taps **Choose** → card authorized for the total → driver assigned → all other offers closed. Choosing is never automatic.
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
- When payment is due, the heading is **Confirm Your Booking** and the button is **Confirm Booking & Payment**. The breakdown is the selected driver's offer (driver earnings plus the platform fee), the service fee, additional charges, and the customer total. Trip, late-cancel, and dump charges are not in that total at booking. The card is authorized at confirm. The charge happens after the customer confirms delivery, or 24 hours later. If the authorization expires first, the card is not charged.

### 4.6 Public pages and text consent
- `/privacy` and `/terms` are the published October 22, 2026 Privacy Policy and Terms of Service. The booking section matches the current offer and payment flow. A later legal review is optional and is not required before launch.
- `/signup` opens phone sign-up. `/driver/apply` opens the driver application sign-up. Optional text consent is a separate unchecked box. The sign-in code does not depend on that box.
- Vercel Hobby cannot run the payment, notification, auto-complete, or transfer jobs more than once a day. Those routes stay in the app. `docs/SCHEDULER.md` is the activation step for Supabase `pg_cron`. Paid bookings are not ready until that scheduler, or Vercel Pro, is actually running.
- `NEXT_PUBLIC_BETA_MODE` is on unless it is set to `false`. That flag is separate from Stripe test mode. The header shows a Beta badge on the public site, customer pages, driver pages, and admin, with the sentence "Pickuply is currently in beta. We're improving the experience with feedback from our early customers and drivers."
- Signed-in customers and drivers open **Send Feedback** from the desktop menu and from Profile. The phone bar does not gain another icon. `/feedback` requires a type, a subject, and details. Screenshots are not accepted. The saved row stores the signed-in user, role, time, route, app version, and a short device string. It does not store a card, a password, a token, an address, or a GPS point.
- Admins review submissions at `/admin/feedback`. Internal notes are on a separate table. Customers and drivers cannot read them or anyone else's feedback. Statuses are New, Under Review, Planned, Resolved, and Closed. A submission does not send a text or an email.
- Admin Payments at `/admin/finance` totals authorized, captured, released, refunded, and disputed amounts from stored rows. A missing amount is shown as unavailable. A Stripe transfer is not labeled as a bank payout.
- After a job is completed, the customer and the assigned driver can each leave one 1–5 star review with an optional comment. Each review stays hidden until both are in, or until 14 days after completion. An admin can hide a review. The stars and words are not rewritten. Offer cards show the driver's completed trips and the average of published customer reviews.
- A driver with fewer than five completed jobs waits 48 hours after completion before a Stripe transfer can become ready. A driver with five or more completed jobs keeps the existing payout delay. Open disputes and missing payout setup still hold the transfer. A person cannot see or take their own request as a driver.
- An admin can suspend a customer or driver for a period or with no end date. The person can still sign in and sees their own restriction, with Contact support opening the existing help request. Open requests with no driver are paused. Unaccepted offers are closed and are not restored. Suspension does not hold or forfeit earnings. A payout still waits for a report, an open dispute, an authorized payout hold, the new-driver 48-hour rule, or the other existing payout rules.
- A suspended driver who has already picked up the item, meaning the job is `in_transit`, can finish that delivery and send the job-specific updates that delivery needs. No new offers or bookings are allowed. Admins are notified. An assigned job that has not started is flagged for an admin to give to another driver. It is not cancelled, refunded, captured, or charged a new fee. Until an admin reassigns it, the booking price, status, driver, and payment cannot be changed. The message is "This booking requires assistance from Pickuply support."
- Delete Account starts a 14-day grace period. The person can cancel during those 14 days after a recent phone sign-in. The existing notification path tells them about the request and the cancellation. After 14 days, deletion runs only when every blocker is clear. A blocker keeps the request pending and does not restart the 14 days. The cleanup can run more than once and still deletes the account once. An admin cannot finish it early.
- Deletion stays pending while the same account, as a customer or a driver, has an active job, a payment hold, a capture waiting, an open payment, a pending refund, a pending or held driver payout, an open dispute, or a recovery balance. Nothing is cancelled, forgiven, or forfeited to make deletion finish.
- Financial, transaction, ledger, and audit records stay for seven years in de-identified form. They are not deleted by the cleanup. Photos and documents are deleted 90 days after the account is deleted, except when the job has a dispute or another legal hold. Restricted-phone records are the HMAC only. They last until the temporary suspension ends, or three years for an indefinite restriction. An expired temporary suspension does not become a registration ban. A missing phone-protection secret blocks new registration and blocks deletion of a restricted account. It does not block people who already have accounts.
- A person with a driver record can choose Stop Driving under Profile, Account management. That is separate from Delete Account. The customer account, the phone sign-in, customer requests, and customer payment history stay. New driver offers and assignments stop, and unaccepted offers are closed. Driver-only personal details are removed when no active job, payout, dispute, or recovery is open. Those details stay until that is resolved. The sign-in user is not deleted.
- A deleted phone can register again as a new account. The old profile, roles, reviews, and privileges are not restored. A number that is still in the restricted-phone records is refused, with a neutral support message. The last active admin cannot be suspended, deleted, or demoted. Another active admin has to exist first, and the database enforces that.
- The phone-protection secret is not stored in a migration. Local development uses Supabase Vault. Hosted setup is in `docs/DEPLOYMENT.md`. The deletion and photo cleanup run from the existing notifications job. Hosted scheduling was not turned on.
- Admin Communications at `/admin/communications` sends one-way announcements. Private conversations stay in the existing Messages inbox. Channels are in-app alerts, push for devices that allowed alerts, and text. Texting stays off. Push is recorded when the provider would accept it, which is not the same as the phone showing it. Audiences include online drivers, drivers whose Areas I Cover include a city, and customers with an active accepted job. Suspended people are left out of promotional sends. Account support can name them. A scheduled send checks eligibility again at send time. Eastern Time is stored in UTC. Texts, once texting is on, wait for 8:00 AM to 9:00 PM America/New_York, start with "Pickuply:", and promotional texts include "Reply STOP to opt out." Promotional text consent is a separate unchecked box on Alerts. Limits: 20 immediate sends an hour, 5 bulk sends an hour, 2 all-user sends a day, 1,000 people, 20 waiting announcements, and 30 days ahead.
- Pickuply can be installed from the home screen. The manifest starts at `/app?source=pwa`, which sends a signed-in person to the customer, driver, or admin home. In-app browsers are told to open Safari or Chrome. Drivers see an install card. Customers see a smaller one after a first request. Alerts are requested only from the Turn on alerts button. The installed app does not cache job or payment pages. Offline shows a fallback and does not take a booking.
- A local Stripe test-mode walk authorized a card and captured it once, both when the customer confirmed delivery and when the 24-hour job ran after the customer did not. An authorization that was already past `capture_before` was not captured and did not start a new charge. Driver earnings stayed held until payout setup. That walk is not a bank payout. Paid bookings stay not launch-ready until the scheduler in `docs/SCHEDULER.md` is actually running, and the normal app process still needs a server-only service role key before Checkout can record a payment.

### 4.5 Customer account
- Job history with receipts and photos, saved addresses, repeat a job.
- My Requests shows **Offers Received** for active offers and **New Offers** for active offers the customer has not viewed. An open request with none says **Waiting for driver offers**. A request with new offers is highlighted, and the Requests menu shows how many new offers are waiting. Withdrawn, expired, declined, and chosen offers are not in those counts. The viewed time is stored per offer and follows the customer to another device.

---

## 5. Driver experience

### 5.1 Onboarding
1. **Sign in** with phone + code
2. **Profile:** full name, profile photo (shown to customers), Georgia home address, and Areas I Cover. Quick Apply does not ask for a separate service area. The home ZIP selects the stored zone. The driver checks “I agree to the Pickuply Driver Terms” (`driver-terms-v1`). The box is never pre-checked.
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
| `approved_new` | Legacy invite-only stage. New approvals use `active` and stay Offline until the driver switches Online. The enum and invitation checks remain for old rows. |
| `active` | Sees and accepts live jobs |
| `paused` | Expired documents, strikes, low rating, or admin action |
| `removed` | Permanently removed |

### 5.3 Availability
- Get Ready to Drive steps show “← Get Ready to Drive” at the top and in a bottom bar. Saving a step returns to the checklist and shows Saved.
- **Online/Offline switch** at the top of Driver Home (`role="switch"`). The knob moves only after the server confirms. A failed check is named under the switch, with a link to the checklist. A driver who has not accepted the current Driver Terms version, including someone who signed up before `driver-terms-v1`, sees “Review and accept the updated Driver Terms” at the top of Driver home. Online stays blocked until they accept. Acceptance stores that version and the time. Pickuply never checks the box or accepts the terms for them. A newly approved driver who is still Offline sees “You're ready to drive! Switch Online whenever you're ready to start accepting jobs.” until they go Online once or dismiss it. A missing insurance upload shows “Add your insurance card.” and does not block the switch. An expired policy blocks the switch and names the date. After that, Offline says they will not get new job alerts.
- Going **Online** checks: status is `active` (legacy `approved_new` rows still pass), an unexpired driver license, and accepted Driver Terms. A missing insurance upload does not block Online after an admin approves the driver. An insurance policy that was uploaded and then expires does block Online, and the message includes the date. Approval never turns the driver Online. The driver sees “You're ready to drive! Switch Online whenever you're ready to start accepting jobs.” If a document is missing, the admin sees the missing item, checks Approve anyway, and the audit log stores the admin, the time, and the missing list. Stripe payout setup does not block Online or accepting a job.
- **Offline:** stops new job alerts; accepted jobs stay active.
- Drivers may **browse** eligible jobs while Offline but can only **accept** while Online.
- Weekly schedule (time blocks) + optional "unavailable until" date.
- Alert preferences: push, text, or both.

### 5.4 Job feed
Pickuply serves Georgia ZIP codes for pickup and drop-off. A ZIP that is not in the Georgia centroid table is rejected. The zones table stays for driver home areas.

Areas I cover is one saved preference. Quick Apply asks for it right after the home address. The default is within 25 miles of the driver's home. A driver can add Georgia cities, Georgia ZIP codes, and a radius of 10, 25, 50, or 100 miles measured from home or from one Georgia ZIP. At least one of those is required. The same preference is edited from Profile → Areas I cover, from the job feed, and inside the Services checklist step. Saving on those screens happens immediately. Coverage is edited from Profile and the job feed. It is not a checklist item. The checklist is three items: Vehicle, Insurance, and Training. License and Driver Terms are collected at Quick Apply. Services and equipment are edited from Profile. Stripe payout setup is the separate “Set up payouts to get paid” card, and it does not block Online.

The feed has two sections. Matched for You lists open jobs whose pickup matches any saved city, ZIP, or radius. Those choices are combined with OR. That section is grouped into Today, Tomorrow, Later this week, and Later, and it shows a count. If nothing matches, it says “No jobs in your areas right now — see all Georgia requests below.” All Georgia Requests lists the other eligible open jobs in Georgia and does not repeat a matched job. It sorts by nearest pickup unless the driver chooses newest, highest pay, soonest, or farthest. Service, distance, pickup date, and vehicle fit filter that section on the server before each page of 20. The header reads “Showing jobs in: Austell, Smyrna +25 mi · Edit”. While waves are off, a new open request appears in the matching section for every eligible driver. While waves are on, a job appears in either section only after that driver’s wave releases it.

New-job alerts go only to drivers whose saved coverage matches the pickup: Online drivers, and Offline drivers with Job alerts while Offline on. Drivers outside those areas still see the request under All Georgia Requests while waves are off. They do not get that push. Accepting still requires an active driver, Online, and a matching vehicle. Exact addresses stay hidden until assignment.

Distance for an unassigned driver is the straight-line miles between ZIP centroids, rounded to the nearest mile, and shown as “~X mi”. The driver's point is the home ZIP centroid, or the zone center when no home ZIP is saved (West Metro uses Austell 30106, East Gwinnett uses Lawrenceville 30043). A radius measured from another ZIP uses that ZIP's centroid instead. The pickup point is always the pickup ZIP centroid, never an exact pickup coordinate, so the number cannot be used to find the street. Exact coordinates are used only after the driver is assigned. The feed does not return coordinates, street addresses, or the driver's home address.

Quick Apply asks for a Georgia home address, not only a ZIP. Search uses Google Places when `GOOGLE_PLACES_API_KEY` is set. If the search misses a house, the driver types the street, city, and ZIP and chooses “Use this address anyway.” A ZIP in the Georgia table is accepted, marked not verified, and stored with no invented coordinates. The search runs on the server. The street, apartment, and notes stay on a private home record that only that driver and an admin can read. The ZIP from that address is what coverage and unassigned distances use. Choosing “Use this address anyway” saves the street and marks it not verified for admin. Browser maps use the Google Maps JavaScript API. A driver who is not assigned sees ZIP-centroid circles, not the house. The assigned driver, the customer, and an admin see the exact pins. Places latitude and longitude may be cached for 30 days under Google's current Places terms. Place IDs may be kept and refreshed. Pickuply does not delete coordinates on an active job. Coverage miles stay on Pickuply's Georgia ZIP table. OpenRouteService is not a Google API and is not given new Places coordinates from the map.

Customer saved addresses live on the customer profile. A driver sees a street only after assignment, through the private job record. The job stores the trip length rounded to the nearest half mile: driving miles when a routing key is set, otherwise a labeled straight line. The driver feed can switch between a list and a map of roughly one-mile circles around pickup ZIP centers. Assigned jobs show pins and a route to the customer, the assigned driver, and admin. There is no live driver location. If a coordinate cannot be saved, the distance shows “—”.

Admin driver list and driver review show the same summary, for example “Austell, Smyrna +25 mi”. On an open job, admin sees the active drivers whose coverage includes that pickup and can assign one. The driver list can be filtered the same way.

Every driver except a removed driver can open the feed. A customer block still hides that customer's jobs. A blocked profile sees nothing. Drivers who are not active yet see the feed their coverage allows and cannot accept. The database says “Finish setup to accept jobs.” A vehicle that does not match stays on the card with its actions off, and the database rejects the accept. Active drivers can accept, offer, and counter. Legacy `approved_new` rows still need an invitation before they can accept. Drivers may browse while Offline. Accepting or offering requires Online.

Cards show the service, the vehicle the job needs, one or two people, stairs, trip miles, and the rounded miles from the driver's home ZIP centroid.

An open job with no driver for 20 minutes is marked “No driver yet” for admin.

Job cards show structured fields only: service, size, pieces, approximate pickup/drop-off area (city or ZIP), distance, stairs, elevator, help loading, time window, pricing method, the customer's fixed price or budget range, and driver pay on admin-quoted jobs. An eligible driver may also see request-stage item photos through a database policy and a short-lived signed URL. Cards do not show pickup, drop-off, report, or private document images, descriptions, notes, or customer contact. Exact addresses and contact are hidden until the driver is actually assigned. This request-photo exception is intentional and is enforced in the database, not by hiding fields in the page.

### 5.5 Accepting, offering, and countering (no double booking)
- **Get Offers:** the driver enters an offer amount and taps Submit Offer. That does not book the job. The customer chooses the offer.
- **Optional admin-priced jobs:** **Claim** calls a single database function that locks the job and, if it is no longer `open` or it has no driver pay, does not assign it. If another driver already took it, the app shows "Sorry, another driver just took this job." Eligibility (active, Online, matching vehicle) is checked only while the job is still open.
- **Fixed-price jobs:** the driver can accept the posted price, or submit a different offer amount. Accepting does not book the job and does not change the customer's original price. The customer chooses the offer.
- **Budget-range jobs:** the driver submits an offer amount. An amount outside the range is stored as a counter with `outside_range`. The customer chooses the offer.
- The driver form asks for the offer amount only. It does not show a customer total or a fee breakdown. The server still adds the platform fee and the service fee and stores the customer total. A Fixed Accept keeps the posted total.
- Limits: one active offer per driver per job (they can withdraw and resubmit once); five active offers per job; no maximum multiple of the customer's price; offers expire after 2 hours. Minimum offer amounts are editable in Settings and start at $35 for pickup and delivery, $50 for junk removal, $35 for store delivery, and $35 for free-item pickups.
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

### 5.8 Help
Customers do not start a chat with admin. They use `/help`. Answers come from the written rules in this spec. A request gets a case number (HR-####), a status of Open, Waiting on you, or Resolved, and an optional private photo. The customer sees only their own requests. An admin sees every request, replies, changes the status, and can open the related job. An active job links to Report a problem. Drivers have their own topics and keep the driver support thread.

---

## 6. Job lifecycle

| # | Status | Set by | Notes |
|---|---|---|---|
| 1 | `requested` | Customer | Request submitted, phone verified |
| 2 | `in_review` | Admin | Admin checking the request (optional) |
| 3 | `quoted` | Admin | Get-a-quote jobs: price, driver pay, service level, required vehicle, pickup window set |
| 4 | `open` | Admin/System | Published to eligible drivers. For quote jobs: after the customer accepts, with no charge. For fixed/range jobs: after admin approval, collecting offers |
| 5 | `assigned` | Customer/Driver/Admin | Customer chose an offer, a driver claimed an open quote job, or admin assigned. Payment status becomes `awaiting_payment`. Quote acceptance only publishes the job (`open`) |
| 6 | `en_route` | Driver | On the way to pickup. Blocked unless payment is `authorized` or `paid` |
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
| Get Offers | Nothing | `pricing_method = 'quote'` and no customer amount | Drivers send offers as soon as the request is open. The customer chooses one. An admin quote is optional |
| Name your price | One amount, min $35 | `'fixed'`, `offer_cents` | Drivers accept or counter. The original `offer_cents` stays. The customer chooses the offer |
| Set a budget range | Min (≥ $35) and max (> min) | `'range'`, `budget_min_cents`, `budget_max_cents` | Drivers offer within the range or counter outside it (`outside_range`). The original range stays. The customer chooses the offer |

Two fees, both stored in integer cents and configurable in `platform_settings`:

- **Platform fee** = max(round(10% × driver earnings), $10).
- **Subtotal** = driver earnings + platform fee.
- **Service fee** covers card processing. Default 2.9% + 30¢. The customer total is the smallest cent amount whose separately rounded 2.9% plus 30¢ covers the subtotal. Service fee = customer total − subtotal. The label is "Service fee". Wording and card-surcharge rules need a review before launch.
- **Fixed Accept** keeps the customer's posted total. The service fee is round(2.9% × that total) + 30¢, then the subtotal is split into driver earnings and the platform fee. Rounding pennies stay in driver earnings. Reject the price if driver earnings would be zero or less.
- **Fixed Counter and range offer/counter:** the driver enters earnings and the app computes the customer total.
- **Quote:** the admin sets driver pay. The platform fee and service fee are calculated on top. The customer sees the full breakdown before accepting.

Rounding is half up on integer cents: `(numerator + denominator / 2) / denominator`. Example: a $60 earnings offer totals $72.40. A $120 earnings offer totals $136.25. A posted $150 Accept stays $150 and splits to $132.14 earnings, $13.21 platform fee, and $4.65 service fee. A posted $35 Accept stays $35. 2.9% of 3500 cents is 101.5, which half-up rounds to 102, so the service fee is $1.32 and driver earnings are $23.68 (the $10 platform minimum applies).

The total is always shown before the customer accepts. There is no auto-booking.

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

**Driver pay:** for admin-quoted jobs, the admin enters driver earnings and the fees are calculated on top. For junk jobs, those earnings must cover disposal. `dump_fee_cents` is an informational estimate for the admin. The disposal receipt is proof of disposal, not a reason to pay the driver anything beyond those earnings. For fixed/range jobs, the driver enters earnings on a counter or offer, and the customer total is calculated forward. A Fixed Accept keeps the posted customer total. Tips go 100% to the driver.

Store `driver_earnings` (as `driver_pay_cents` / `driver_amount_cents`), `platform_fee_cents`, `service_fee_cents`, and the customer total separately. The original posted price or range stays unchanged.

---

## 8. Reviews

Only for **completed** jobs, only by the two parties on that job, once each.

**Customer → driver:** 1–5 stars, tags (On time, Careful with items, Friendly, Good communication, Clean vehicle), comment, optional tip, "Would you use Pickuply again?", referral source (first job).

**Driver → customer:** 1–5 stars, tags (Item as described, Ready on time, Easy access, Seller helpful), private note to admin.

Show drivers' average rating, completed jobs, review count. Never show private reports publicly. Driver below 4.5 after 10 jobs → admin review flag; below 4.0 → auto-pause pending review. Reviews must not penalize customers for reporting legitimate problems.

---

## 9. Reports, disputes, and strikes

Built locally on 2026-10-22, with these differences from the workflow below: a report holds capture and payout creation and marks the job disputed, but it does not reverse money that already moved and it does not call Stripe. Refunds wait for Step 5. Critical reports alert an admin immediately. A driver is paused only when an admin chooses that outcome. Strikes are not built yet.

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

A new message appears in the recipient's Messages inbox and as a bell alert. The alert opens that conversation. Opening the conversation marks it read. Seen shows on the sender's last message after the other person opens it. Customers reply to an admin message or use Help. They cannot start an admin chat. A resolved support thread stays read-only. Document requests include Upload now for the matching profile field, and a successful upload notifies admin. Photos and PDFs in an admin conversation stay in a private bucket.

Built locally on 2026-10-22. Alerts are stored in the app, push is ready when VAPID keys are set, and email is ready when Resend is set. Texting is wired and stays off until an admin turns it on after Twilio approval. The one-time iPhone Home Screen note is on the alerts page. Job messages open at assignment and close 24 hours after completion. Proof photos are private, locked after upload, and any optional location is rounded and visible only to an admin.

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

- Drivers discover open jobs only through `driver_matched_feed`, `driver_georgia_page`, and `driver_job_feed`. Those functions return structured fields (service, size, pieces, city/ZIP, distance, stairs, schedule, and the relevant price). They do not return free-text descriptions, notes, listing links, order numbers, photos, exact addresses, names, phone numbers, email, or access notes. Those free-text fields and photos can contain private details even when the customer did not mean to include them.
- Exact addresses, phone numbers, email, and names are visible only to: the customer, the **assigned** driver (from assignment until 24h after completion), and admin.
- Request, pickup, drop-off, and report photos stay private to the customer, the assigned driver, and admin. Eligible drivers who are only browsing do not receive them.
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
- `jobs` — id, customer_id, service, status, zone_id, pickup_area (city/ZIP), dropoff_area (city/ZIP), distance_miles, description, pieces, size (`small`/`medium`/`large`/`xl`), item_value_cents, needs_value_approval, listing_url, already_paid, seller_holding, wants_item_check, stairs_pickup, stairs_dropoff, elevator, help_loading, junk_load_size, junk_materials, junk_special_items, store_name, store_order_number, preferred_date, time_window, notes, **pricing_method** (`quote`/`fixed`/`range`), **offer_cents**, **budget_min_cents**, **budget_max_cents**, service_level, required_vehicle, price_cents (admin quote or chosen total), driver_pay_cents, platform_fee_cents, dump_fee_cents, quote_expires_at, assigned_driver_id (set only when a driver is actually assigned), accepted_offer_id, stripe_payment_intent_id, payment_status, captured_cents, source, created_at. Status changes are recorded in `job_events`. The customer's pricing columns are immutable after insert. Only an admin can set or change `price_cents`, `driver_pay_cents`, `platform_fee_cents`, `dump_fee_cents`, and `quote_expires_at`
- `job_offers` — id, job_id, driver_id, kind (`accept`/`offer`/`counter`), driver_amount_cents, platform_fee_cents, customer_total_cents, reason, outside_range, available_at, status (`active`/`withdrawn`/`expired`/`chosen`/`declined`), expires_at, created_at. Allowed only when the job's `pricing_method` is `fixed` or `range`. Inserting an offer does not assign the driver or change the customer's price
- `job_private` — job_id, pickup_address, dropoff_address, pickup_lat/lng, dropoff_lat/lng, customer_name, customer_phone, customer_email, access_notes (RLS: customer, assigned driver, admin only)
- `customer_driver_blocks` — customer_id, driver_id, created_at. One row per pair. The customer manages only their own blocks. A blocked driver cannot discover or offer on that customer's jobs
- `job_driver_invitations` — job_id, driver_id, invited_by, created_at. This is how an admin lets an `approved_new` driver see one open job. It is not an assignment and does not set `assigned_driver_id`
- `driver_matched_feed()`, `driver_georgia_page()`, and `driver_job_feed()` — the discovery path for drivers. Each is `SECURITY DEFINER`, executable by signed-in users, and takes no driver id argument. The section feeds check the signed-in driver, status, blocks, wave release, and `open` status inside the function. All Georgia Requests also applies the service, distance, date, and vehicle filters before the page. They return no free-text customer fields and no photo paths
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
- `accept_admin_quote(job_id)` — the customer publishes their own `quoted` quote-job to `open`. It does not assign a driver.
- `choose_offer(offer_id)` — customer explicitly chooses an active offer on an `open` fixed or range job: atomic; assigns the driver, marks other offers `declined`, writes an event. There is no auto-book path.

Admin quote and price changes run as the signed-in admin. The database check is `is_admin()`. The service role never sets or changes `price_cents`, `driver_pay_cents`, `platform_fee_cents`, `dump_fee_cents`, or `quote_expires_at`. The service role is only for webhooks, cron, and other system tasks. It must still be able to update payment and job status where this spec requires a system step: card authorization, capture after delivery or the 24-hour auto-complete, the $15 late-cancel capture, and the $25 trip-fee capture.

---

## 15. Pilot success criteria (30 days)

- 25+ paid jobs · $3,000+ revenue · 20%+ average margin · drivers average $25+/hour
- 30%+ customers repeat or refer · zero unresolved damage/theft/no-show incidents
- 2+ landlords or property managers book more than once

---

## 16. Later (v2+, do not build in v1)

Stripe Connect automatic payouts, business accounts for landlords (multiple properties, invoicing), seller "delivery available" links, favorite drivers, referral credits, background checks, ID verification, masked phone calls, native iOS/Android apps with background GPS, cargo insurance per job.
