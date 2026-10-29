# Pickuply — Product Spec v1.0 (Pilot)

> Working name: **Pickuply** (formerly DeliveryMatch). Tagline: *"You Find It. We Pick It Up."*
> Subheadline: *"Found it. Bought it. Can't pick it up? We'll bring it home."*
> Mission: Help people secure local purchases by arranging trustworthy, affordable transportation before they lose the item, and haul away what they no longer need.
> Status: Pilot MVP. Built as a mobile-friendly Progressive Web App (PWA).
> This file is the source of truth. If code and this spec disagree, ask before changing either.

---

## 1. What Pickuply is

A local marketplace that connects people who need something picked up and moved with nearby verified drivers who have the right vehicle. It covers both bringing something to you and taking something away. It's built especially for Facebook Marketplace, free-item groups, and time-sensitive secondhand purchases. The admin (owner) approves drivers and can monitor requests. A Get a quote request opens immediately so eligible drivers can send offers.

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
| Who responds | **Get a quote:** the request opens immediately. Eligible drivers send competing offers, and the customer chooses one. An admin may still send an optional price; after the customer accepts that price, a driver claims the job. **Fixed:** drivers accept that price, which creates an offer, or send a counteroffer. The counteroffer does not change the customer's original price. **Range:** drivers offer inside the range or counter outside it. Outside-range offers are flagged. The customer chooses the offer. Admin can still assign a driver |
| Platform fee | **15% of the customer-facing offer**, deducted from the driver. No minimum. Admin-configurable. Not added on top of the customer price. |
| Driver matching | A request that passes validation is open to eligible drivers immediately. No admin approval is required. Waves stay off unless an admin turns them on. While waves are off, every eligible driver can see every open request, with no wave delay and no invitation limit. While waves are on, `docs/WAVES.md` decides who sees a request. A job can have five active offers at a time. A driver can offer on more than one open job. An admin can still pause a request, send it to a driver, or send an optional quote. Those actions are audited. Nothing is booked or charged until the customer chooses a driver's offer, or accepts an optional admin quote and a driver claims it. The database guarantees one assigned driver. Admin can also assign manually. There is no auto-booking |
| Customer payment | No card is authorized until a driver is confirmed. Confirming an offer, or a driver claiming an accepted quote job, starts a payment deadline (default 30 minutes). The customer pays by card on Stripe Checkout. The card is authorized, not captured. Work cannot start until payment is `authorized`. Capture happens after the customer confirms delivery, or 24 hours after delivery if they do not. If the authorization expires, stop and flag an admin. Do not start a new charge automatically. |
| Driver payouts | Stripe Connect Express. One account per driver. The app stores the account id and status only, never bank details. After a captured payment, the driver's earnings are a ledger line. A transfer to that Connect account is not a deposit in their bank. Earnings stay held until payout setup is finished, unless an admin records a payment outside Stripe. |
| Background checks | **None in v1.** Verification = ID/license, insurance, vehicle photo, personal call with admin. Never claim background checks in UI copy |
| Minimum fee | $35 |
| Damage review | A report made within 48 hours, with photos, can be reviewed. Those 48 hours are an administrative review window, not a waiver of a right the law does not allow to be waived. Pickuply does not insure the items and does not promise a refund, a repair, or any payment. No dollar amount is offered. The unused `damageCoverageLimitCents` constant is not a published promise. |
| Late cancel fee | Temporarily **$0** (`platform_settings.late_cancel_fee_cents`). A new cancellation releases the card hold and does not capture a fee. When the setting is above zero, it is one partial capture of that setting on the existing authorization. It is not a new charge. If the driver is already on the way, $10 of a $15 fee goes to the driver. Otherwise Pickuply keeps that fee. |
| Trip fee | Temporarily **$0** (`platform_settings.trip_fee_cents`). Rejecting the item cancels the job and releases the hold. When the setting is $25, that amount is the only capture: $20 to the driver and $5 to Pickuply. |
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
| Construction only | Store name, optional Store order / pickup number. The customer and the assigned driver see that number on the job. Open job feeds still omit it. |
| Pricing method (required) | **Get a quote** (no amount). Copy: "Drivers can review this request and send offers. You choose who to book. Nothing is charged until you accept." **Name your price** (one amount, min $35). **Set a budget range** (min ≥ $35, max > min). Copy under both: "Drivers can accept your price or send a counteroffer. You choose who to book. Nothing is charged until you accept." |
| Contact | Name, phone (required), email address (required, labeled "Email address *", helper text "For booking updates and receipts."), "How did you hear about us?" (Nextdoor, Facebook, friend, landlord/property manager, other). A new customer signup also requires that email after the phone code, unless the request form already saved it. Driver signup does not ask for it on that screen. A saved email is stored once on `profiles.email`, lowercased, prefilled on the next request, and can be changed in Profile. A blank Profile save does not erase a saved email, and an existing account is not sent through a new email step. The address is not marked verified. A real customer's new booking is rejected without a valid email. An existing test account can still sign in, and a test booking can be stored without one. |

- Shows a **typical price range** as guidance (see §7), labeled: "Typical price for jobs like this within 10 miles: $X–$Y. Final price confirmed after review." If required inputs are missing, show "We'll confirm a price after reviewing your request" instead of a number. The estimate never changes the customer's chosen pricing method or amounts.
- The draft is saved in the browser until the phone is verified, then attached to the account. Phone, email, and exact street addresses are never written to browser storage (kept in memory only).
- Submitting = phone verification (text code) → request created with status `open`. Drivers can see it immediately. Nothing is booked.
- Customer agrees to terms (prohibited items, fees, damage policy, photos) at submission.

### 4.3 Quotes, offers, and booking
- A request that passes validation is published (`open`) when it is saved. Admin approval is not a step. An admin can pause it, send it to one driver, or send an optional quote. Each of those is audited.
- **Get a quote:** the request is saved as `open`. Eligible drivers see it immediately and send competing offers. The customer chooses one offer. That choice assigns the driver and sets `payment_status = awaiting_payment`. It does not charge the card. A `quoted` request is an optional admin price and stays off the driver feed until the customer accepts it. Waiting requests are posted as `open`.
- **Optional admin quote:** an admin enters the customer offer. The commission comes out of that offer and the service fee is added on top (status `quoted`). The customer sees the breakdown and accepts before the quote expires. Acceptance publishes the job (`open`). It does not assign a driver. An eligible Online driver then claims that priced job, which assigns that driver and sets `payment_status = awaiting_payment`.
- **Name your price / Budget range:** the job is already `open`. Drivers may accept, offer, or counter (§5.5). A counteroffer does not change the customer's original price. Outside-range offers are flagged. The customer must choose one offer. That choice assigns the driver and sets `payment_status = awaiting_payment`. Nothing is charged at that step.
- **Offer comparison** shows each driver's first name, photo, rating, completed jobs, vehicle, pickup availability, counter reason (if any), the outside-range flag, the offer, the service fee, and the total. It also shows that driver's proposed arrival time. A window offer shows the exact arrival inside the window the driver selected. Pickuply's commission is not added again. A new offer stays new until that offer card is actually on screen. Opening My Requests or receiving an alert does not mark it viewed. Customer taps **Choose** → the pickup time is checked again → driver assigned → that time becomes the locked Scheduled Pickup → all other offers closed. Choosing is never automatic. An expired time is rejected with a clear message. Older requests without a pickup time still choose the same way.
- **Pickup availability:** the customer chooses Available anytime, As soon as possible, or one to three pickup windows. Anytime and as soon as possible do not set a clock time; the driver proposes one. A window has a date, start, and end in Eastern Time, cannot be entirely in the past, has to end at least 60 minutes after it is saved, cannot overlap another window, and stays inside the existing six-day booking window. A driver selects one saved window that has not ended and proposes an exact arrival inside it, including the window's start or end. Accepting it requires the minutes left in Settings, 60 by default. If fewer minutes remain, the customer sees "This time has passed. Choose another offer." If the exact arrival is no longer in the future, the customer sees "That pickup time has passed. Choose another offer." The customer's windows stay on the job. An offer saved as the whole window can still be accepted under that same rule. An Anytime or ASAP arrival must be the minutes ahead in Settings, 30 by default, when the offer is sent. The confirmed time is locked. Changing it later needs a new mutual acceptance flow; until then the screen says to contact Pickuply support. The old free reschedule does not overwrite a confirmed time.
- Admin quotes expire after 24 hours; driver offers expire after **2 hours** (default) unless chosen. Customers can edit or withdraw a request before booking.
- An admin can ask for more details on a published request. The question is a Pickuply Support message and an alert. Both include an Add details button that opens the request edit form. Pause until updated is optional and off by default. When it is off, drivers can still see the request and send offers. Only an admin quote waits for the answer. When it is on, drivers do not see the request and the database rejects a new offer until the customer updates it, and then it is visible again. A customer edit before booking tells every driver who already sent an offer: “Request updated — review your offer.”
- Quote/offer page shows: price breakdown, what's included, cancellation/trip fee policy, item value cap.

### 4.4 Job status page
- Timeline of statuses (see §6) with timestamps.
- Once assigned: driver first name, photo, vehicle, rating, number of jobs.
- **Item loaded:** the pickup photo is saved and the driver continues. The customer does not have to approve it first. After the driver marks the job delivered, or junk removed, the customer confirms or reports an issue.
- Driver's last shared location and status updates.
- In-app **messages** with the assigned driver (phone numbers never shown).
- **Report a problem** (during job and 7 days after).
- **Cancel** (fee rules apply).
- After delivery: **Got it** (captures payment) → review + optional tip. The tip is not shown before the job is completed. No amount is selected until the customer chooses $5, $10, $20, a custom amount from $1 to $200, or no tip. The choice stays open for 7 days after completion, and the database enforces that window. 100% of the tip goes to the driver. Pickuply takes no commission and no service fee on a tip. The tip is a separate PaymentIntent and a separate ledger row. Stripe's fee on the tip is an expense, not revenue. Booking checkout saves the card on a Stripe customer for later off-session tips. The customer sees that disclosure before paying and on the receipt. A tip uses that booking card in one tap. If the card needs authentication, the charge fails, or the job has no saved card, tipping uses a separate Checkout. The customer can view and remove saved cards under Profile, Payment methods. Removing a card stops one-tap tipping for future jobs. One successful tip per job. An admin may refund it. If that tip was already transferred, the transfer stays and a recovery is recorded. A transfer is still not a bank deposit. A new driver's 48-hour earnings wait does not apply to tips. An open dispute holds the tip transfer.
- When payment is due, the heading is **Confirm Your Booking** and the button is **Confirm booking**, with “You won't be charged until your item is delivered” under it. The offer button stays **Choose** plus the driver's first name. The breakdown is the selected driver's offer, the service fee, additional charges, and the customer total. Pickuply's commission is already inside the offer. Trip, late-cancel, and dump charges are not in that total at booking. Checkout charges that stored total. When the stored offer and service fee add up to it, Checkout lists those two amounts on separate lines. If the customer has a saved profile email, Checkout receives that address. A missing email does not block Checkout, and Stripe's returned address is not written back onto the profile. After authorization the job page says the amount is held and charged only after delivery. It does not say “Payment confirmed.” The charge happens after the customer confirms delivery, or 24 hours later. If the authorization expires first, the card is not charged.

### 4.6 Public pages and text consent
- `/privacy` and `/terms` are the published October 28, 2026 Privacy Policy and Terms of Service. The booking section matches the current offer and payment flow. Driver screens that mention those policies link to them. A later legal review is optional and is not required before launch.
- `/signup` opens phone sign-up. `/driver/apply` opens the driver application sign-up. Optional text consent is a separate unchecked box. The sign-in code does not depend on that box.
- Vercel Hobby cannot run the payment, notification, auto-complete, or transfer jobs more than once a day. Those routes stay in the app. `docs/SCHEDULER.md` is the activation step for Supabase `pg_cron`. Paid bookings are not ready until that scheduler, or Vercel Pro, is actually running.
- `NEXT_PUBLIC_BETA_MODE` is on unless it is set to `false`. That flag is separate from Stripe test mode. The header shows a Beta badge on the public site, customer pages, driver pages, and admin, with the sentence "Pickuply is currently in beta. We're improving the experience with feedback from our early customers and drivers."
- Signed-in customers and drivers open **Send Feedback** from the desktop menu and from Profile. The phone bar does not gain another icon. `/feedback` requires a type, a subject, and details. Screenshots are not accepted. The saved row stores the signed-in user, role, time, route, app version, and a short device string. It does not store a card, a password, a token, an address, or a GPS point.
- Admins review submissions at `/admin/feedback`. Internal notes are on a separate table. Customers and drivers cannot read them or anyone else's feedback. Statuses are New, Under Review, Planned, Resolved, and Closed. A submission does not send a text or an email.
- Admin Payments at `/admin/finance` totals authorized, captured, released, refunded, and disputed amounts from stored rows. A missing amount is shown as unavailable. A Stripe transfer is not labeled as a bank payout.
- After a job is completed, the customer and the assigned driver can each leave one 1–5 star review with an optional comment. Each review stays hidden until both are in, or until 14 days after completion. An admin can hide a review. The stars and words are not rewritten. Offer cards show the driver's completed trips and the average of published customer reviews.
- A driver with fewer than five completed jobs waits 48 hours after completion before a Stripe transfer can become ready. A driver with five or more completed jobs is transferred as soon as the job is completed and nothing else is holding it. The transfer uses the job's card charge and does not wait for that charge to become available. Open reports and disputes still hold the transfer. Payouts are ready only when Stripe reports payouts enabled and the transfers capability is active. Missing payout setup still holds the transfer. A person cannot see or take their own request as a driver.
- An admin can suspend a customer or driver for a period or with no end date. The person can still sign in and sees their own restriction, with Contact support opening the existing help request. Open requests with no driver are paused. Unaccepted offers are closed and are not restored. Suspension does not hold or forfeit earnings. A payout still waits for a report, an open dispute, an authorized payout hold, the new-driver 48-hour rule, or missing payout setup.
- A suspended driver who has already picked up the item, meaning the job is `in_transit`, can finish that delivery and send the job-specific updates that delivery needs. No new offers or bookings are allowed. Admins are notified. An assigned job that has not started is flagged for an admin to give to another driver. It is not cancelled, refunded, captured, or charged a new fee. Until an admin reassigns it, the booking price, status, driver, and payment cannot be changed. The message is "This booking requires assistance from Pickuply support."
- Delete Account starts a 14-day grace period. The person can cancel during those 14 days after a recent phone sign-in. The existing notification path tells them about the request and the cancellation. After 14 days, deletion runs only when every blocker is clear. A blocker keeps the request pending and does not restart the 14 days. The cleanup can run more than once and still deletes the account once. An admin cannot finish that 14-day request early. An admin can delete the account immediately from the person's admin page when no blocker is open. That removes the phone from sign-in so the same number can register as a new account. The old profile is kept as "Deleted account."
- Deletion stays pending while the same account, as a customer or a driver, has an active job, a payment hold, a capture waiting, an open payment, a pending refund, a pending or held driver payout, an open dispute, or a recovery balance. Nothing is cancelled, forgiven, or forfeited to make deletion finish.
- Financial, transaction, ledger, and audit records stay for seven years in de-identified form. They are not deleted by the cleanup. Photos and documents are deleted 90 days after the account is deleted, except when the job has a dispute or another legal hold. Restricted-phone records are the HMAC only. They last until the temporary suspension ends, or three years for an indefinite restriction. An expired temporary suspension does not become a registration ban. A missing phone-protection secret blocks new registration and blocks deletion of a restricted account. It does not block people who already have accounts.
- A person with a driver record can choose Stop Driving under Profile, Account management. That is separate from Delete Account. The customer account, the phone sign-in, customer requests, and customer payment history stay. New driver offers and assignments stop, and unaccepted offers are closed. Driver-only personal details are removed when no active job, payout, dispute, or recovery is open. Those details stay until that is resolved. The sign-in user is not deleted.
- A deleted phone can register again as a new account. The old profile, roles, reviews, and privileges are not restored. A number that is still in the restricted-phone records is refused, with a neutral support message. The last active admin cannot be suspended, deleted, or demoted. Another active admin has to exist first, and the database enforces that.
- The phone-protection secret is not stored in a migration. Local development uses Supabase Vault. Hosted setup is in `docs/DEPLOYMENT.md`. If the secret is missing, sign-up and deletion still work, the restricted-phone check is skipped, the event is audited, and `/admin` shows a red banner. The deletion and photo cleanup run from the existing notifications job. Photos tied to a dispute stay until 365 days after the dispute is resolved, then follow the 90-day deletion rule. A phone with no marketplace activity for 12 months asks "Is this your account?" after the code, using only a first-initial and the last pickup city and month. "No, start a new account" freezes the old account for admin review. Hosted scheduling was not turned on.
- Synthetic accounts have `profiles.is_test`. A job created by a test customer is a test job. Test and real accounts cannot be booked together. A test driver does not see a real job, and a real driver does not see a test job. The same split applies to offers, job alerts, feed refresh signals, and messages. A test admin cannot read or change real account data and cannot change Pickuply settings. A real admin sees normal totals without test rows. Include test data on an admin view is off until that admin turns it on. Bulk announcements to real people leave test accounts out. A test admin's announcement reaches only test accounts. Test accounts do not get SMS, email, or push. Their Stripe rows cannot be live-mode. A test job can be transferred only in Stripe test mode. A live-mode payment is not transferred. `/admin/test-data` previews the counts, then retires test profiles and jobs after the admin types DELETE TEST DATA. It removes alerts, push subscriptions, and funnel events. It keeps payments, ledger lines, messages, and the audit log.
- Admin Communications at `/admin/communications` sends announcements. Each announcement alert has Reply, which opens that person's private Pickuply Support conversation and creates it if they do not have one yet. Customers still cannot start support from `/support` on their own. Private conversations stay in the existing Messages inbox. Channels are in-app alerts, push for devices that allowed alerts, and text. Texting stays off. Push is recorded when the provider would accept it, which is not the same as the phone showing it. Audiences include online drivers, drivers whose Areas I Cover include a city, and customers with an active accepted job. Suspended people are left out of promotional sends. Account support can name them. A scheduled send checks eligibility again at send time. Eastern Time is stored in UTC. Texts, once texting is on, wait for 8:00 AM to 9:00 PM America/New_York, start with "Pickuply:", and promotional texts include "Reply STOP to opt out." Promotional text consent is a separate unchecked box on Alerts. Limits: 20 immediate sends an hour, 5 bulk sends an hour, 10 bulk sends a day, 2 all-user sends a day, 3 announcements a day per person (account notices are not counted), 1,000 people, 20 waiting announcements, and 30 days ahead. Audiences also include drivers who are missing a license, insurance, training, or agreement, and customers who have never had an accepted booking.
- Pickuply can be installed from the home screen. The public header and the home-page menu include an install button. It is hidden when the app is already running on the home screen. Android and desktop use the browser install prompt after a click. iPhone Safari says “Add Pickuply to Home Screen” and opens a three-step panel: Share, Add to Home Screen, then Add. Other iPhone browsers are told to open Safari. Facebook, Instagram, Messenger, TikTok, and other embedded browsers show open-in-browser instructions and a copy-link fallback. If the browser cannot install, the button explains what to do instead of failing. The driver install card and the customer banner stay as they are. The manifest starts at `/app?source=pwa`, which sends a signed-in person to the customer, driver, or admin home. Alerts are requested only from the Turn on alerts button. The installed app does not cache job or payment pages. Offline shows a fallback and does not take a booking. A new version shows "New version available — Refresh" and does not reload by itself during payment.
- A local Stripe test-mode walk authorized a card and captured it once, both when the customer confirmed delivery and when the 24-hour job ran after the customer did not. An authorization that was already past `capture_before` was not captured and did not start a new charge. Driver earnings stayed held until payout setup. That walk is not a bank payout. Paid bookings stay not launch-ready until the scheduler in `docs/SCHEDULER.md` is actually running, and the normal app process still needs a server-only service role key before Checkout can record a payment.

### 4.5 Customer account
- Job history with receipts and photos, saved addresses, repeat a job.
- My Requests shows **Offers Received** for active offers and **New Offers** for active offers the customer has not viewed. An open request with none says **Waiting for driver offers**. A request with new offers is highlighted, and the Requests menu shows how many new offers are waiting. Withdrawn, expired, declined, and chosen offers are not in those counts. The viewed time is stored per offer and follows the customer to another device.

---

## 5. Driver experience

### 5.1 Onboarding
1. **Sign in** with phone + code
2. **Profile:** full name, email address (required), profile photo (shown to customers), Georgia home address, and Areas I Cover. The email is saved on the shared `profiles.email` and can be changed in Profile. A blank Profile save does not erase it. The address is not marked verified. Quick Apply does not ask for a separate service area. The home ZIP selects the stored zone. The driver checks “I agree to the Pickuply Driver Terms” (`driver-terms-v2`). The box is never pre-checked. A driver who already accepted `driver-terms-v1` must accept `driver-terms-v2` before going Online.
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
- **Online/Offline switch** at the top of Driver Home (`role="switch"`). The knob moves only after the server confirms. A failed check is named under the switch, with a link to the checklist. A driver who has not accepted the current Driver Terms version (`driver-terms-v2`), including someone who accepted `driver-terms-v1`, sees “Review and accept the updated Driver Terms” at the top of Driver home. Online stays blocked until they accept. Acceptance stores that version and the time. Pickuply never checks the box or accepts the terms for them. A newly approved driver who is still Offline sees “You're ready to drive! Switch Online whenever you're ready to start accepting jobs.” until they go Online once or dismiss it. A missing insurance upload shows “Upload your insurance to go Online.” and blocks the switch for a real driver. A test driver can still go Online without that upload. An expired policy blocks the switch and names the date. After that, Offline says they will not get new job alerts.
- Going **Online** checks: status is `active` (legacy `approved_new` rows still pass), an unexpired driver license, accepted Driver Terms, and, for a real driver, a current insurance upload. Approve anyway still approves the application. Online stays blocked with “Upload your insurance to go Online.” until that document is current. A test driver is unchanged and can go Online without the upload. An insurance policy that was uploaded and then expires does block Online, including a test driver, and the message includes the date. Approval never turns the driver Online. The driver sees “You're ready to drive! Switch Online whenever you're ready to start accepting jobs.” If a document is missing, the admin sees the missing item, checks Approve anyway, and the audit log stores the admin, the time, and the missing list. Stripe payout setup does not block Online or accepting a job.
- **Offline:** stops new job alerts; accepted jobs stay active.
- Drivers may **browse** eligible jobs while Offline but can only **accept** while Online.
- Weekly schedule (time blocks) + optional "unavailable until" date.
- Alert preferences: push, text, or both.

### 5.4 Job feed
Pickuply serves Georgia ZIP codes for pickup and drop-off. A ZIP that is not in the Georgia centroid table is rejected. The zones table stays for driver home areas.

Areas I cover is one saved preference. Quick Apply asks for it right after the home address. The default is within 25 miles of the driver's home. A driver can add Georgia cities, Georgia ZIP codes, and a radius of 10, 25, 50, or 100 miles measured from home or from one Georgia ZIP. At least one of those is required. The same preference is edited from Profile → Areas I cover, from the job feed, and inside the Services checklist step. Saving on those screens happens immediately. Coverage is edited from Profile and the job feed. It is not a checklist item. The checklist is three items: Vehicle, Insurance, and Training. License and Driver Terms are collected at Quick Apply. Services and equipment are edited from Profile. Stripe payout setup is the separate “Set up payouts to get paid” card, and it does not block Online. An approved driver gets one in-app alert, “Add your payout details,” until payout setup is finished. Profile includes Update payout details, which opens the same Stripe setup. That alert is not a text.

The feed has two sections. Matched for You lists open jobs whose pickup matches any saved city, ZIP, or radius. Those choices are combined with OR. Both sections list the newest request first, with the job id breaking a tie, and each section shows a count. If nothing matches, it says “No jobs in your areas right now — see all Georgia requests below.” All Georgia Requests lists every eligible open job in Georgia, including a job that is also in Matched for You. A driver can instead sort that section by nearest pickup, highest pay, soonest, or farthest. Service, distance, and vehicle filters do not change the chosen sort. Service, distance, pickup date, and vehicle fit filter that section on the server before each page of 20. The header reads “Showing jobs in: Austell, Smyrna +25 mi · Edit”. While waves are off, a new open request appears in the matching section for every eligible driver. While waves are on, a job appears in either section only after that driver’s wave releases it.

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
- **Get a quote:** an eligible driver sees the open request and sends an offer. The customer chooses one offer. That step does not charge the card. A quote that already has an accepted price is claimed instead of offered again.
- **Optional admin-priced jobs:** **Claim** calls a single database function that locks the job and, if it is no longer `open` or it has no driver pay, does not assign it. If another driver already took it, the app shows "Sorry, another driver just took this job." Eligibility (active, Online, matching vehicle) is checked only while the job is still open.
- **Fixed-price jobs:** the driver can accept the posted price, or submit a different offer amount. Accepting does not book the job and does not change the customer's original price. The customer chooses the offer.
- **Budget-range jobs:** the driver submits an offer amount. An amount outside the range is stored as a counter with `outside_range`. The customer chooses the offer.
- The driver form asks for the customer-facing offer. As the amount changes, it shows the offer, the Pickuply commission, and estimated earnings. The driver confirms that breakdown before it is sent. The server calculates the split. A client cannot submit its own earnings figure.
- Limits: one active offer per driver per job (they can withdraw and resubmit once); five active offers per job; no maximum multiple of the customer's price; offers expire after 2 hours. Minimum offer amounts are editable in Settings and start at $35 for pickup and delivery, $50 for junk removal, $35 for store delivery, and $35 for free-item pickups.
- Only **Online**, eligible drivers can accept or offer. Final assignment uses the same atomic database function, so only one driver can be assigned.
- After booking, any price change requires a request in the app and the other party's approval. Drivers can never charge unilaterally.
- Driver and customer both get assignment confirmation.

### 5.6 Active job steps

A regular pickup and delivery:

1. **Start trip**
2. **Arrived at pickup**
3. Pickup photo required
4. **Item loaded.** The driver does not wait for the customer
5. **Proceed to drop-off**
6. **Arrived at drop-off**
7. Drop-off photo required
8. **Delivered**
9. The customer sees “Does everything look good?” and chooses **Confirm** or **Report an Issue**
10. Confirm runs the existing capture. A dispute blocks capture. The 24-hour auto-complete clock starts when the job is marked delivered

Junk removal does not use a customer drop-off:

1. **Start trip**
2. **Arrived at the removal location**
3. Completion photo of the area after the junk is removed
4. **Junk removed**
5. The same customer confirmation, capture, and dispute rules. The 24-hour clock starts when the junk is marked removed

A junk job that already requires a disposal receipt still needs that receipt before Junk removed. It does not need a drop-off address, a drop-off arrival, or a second drop-off photo.

If the customer rejects the item at pickup, the job ends. While the trip fee setting is $0, the card hold is released and the driver is not paid a trip fee. When that setting is above zero, only that fee is captured. That reject does not stop the driver from continuing unless the customer sends it.

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
| 4 | `open` | Customer/System | Published to eligible drivers. For quote jobs: after the customer accepts the admin price, with no charge. For fixed and range jobs: as soon as the customer submits, collecting offers |
| 5 | `assigned` | Customer/Driver/Admin | Customer chose an offer, a driver claimed an open quote job, or admin assigned. Payment status becomes `awaiting_payment`. Quote acceptance only publishes the job (`open`) |
| 6 | `en_route` | Driver | On the way to pickup. Blocked unless payment is `authorized` or `paid` |
| 7 | `arrived` | Driver | At pickup |
| 8 | `item_check` | Driver | Pickup photo saved and the item is loaded. The customer does not approve this step. The driver continues to the drop-off. New junk jobs skip this status |
| 9 | `in_transit` | Driver | On the way to the drop-off. The driver records arrival there. A 15-minute no-show timer can start at that arrival. It does not cancel or charge by itself. New junk jobs do not use this status |
| 10 | `delivered` | Driver | Regular delivery: drop-off arrival and drop-off photo. Junk removal: completion photo, and a disposal receipt when that job already requires one. Customer confirmation starts here, and so does the 24-hour auto-complete clock |
| 11 | `completed` | Customer/System | Customer confirmed or 24h auto-complete; payment captured |
| — | `cancelled` | Any | With cancellation reason and fee outcome |
| — | `disputed` | System | A high/critical report is open; payout held |

Every status change writes a **job event** (who, what, when, extra data). Every admin action writes an **audit log** entry.

### Cancellation rules
| Situation | Outcome |
|---|---|
| Customer cancels before assignment | Free; authorization released |
| Customer cancels after assignment | No fee while the late-cancel setting is $0. The hold is released. |
| Customer rejects item at pickup | No fee while the trip-fee setting is $0. The hold is released. |
| Driver cancels | Job goes back to `open`; counts against reliability (strike if within 2h of pickup) |
| Driver no-show | Admin alerted, job reassigned, customer gets a credit; 2 strikes |

### Payment authorization note
Pickups can be scheduled at most 6 days ahead during the pilot. The request form and the database both reject a later date. A later option, not built yet, is to save the card and authorize it 2 days before pickup.

The late-cancel fee and the trip fee are both $0 until those settings are raised. A new cancellation or rejection does not capture either fee, and older rows that already stored a fee are left as they are. A late cancel after assignment is one capture of `late_cancel_fee_cents` when that setting is above zero. At $15, if the driver is on the way or further along, $10 goes to the driver and $5 stays with Pickuply. Otherwise Pickuply keeps that fee. There is no fee when the card was not authorized, when the customer cancels before a driver is assigned, or while the setting is $0. At a $25 trip fee, $20 goes to the driver and $5 stays with Pickuply. While the trip fee setting is $0, nothing is captured. A customer can ask to reschedule once, free, before the driver is on the way. The driver has 2 hours to accept or decline. A decline opens the job again at the same price. A customer no-show fee waits for an admin after the driver has arrived, waited 15 minutes, and added a photo. A driver who is not on the way 30 minutes after the window starts does not cause a customer charge. Damage reports are due within 48 hours of delivery. Pickup photos are the before evidence. Damage already visible at pickup is not covered. An admin reviews it. There is no automatic refund. Verified damage can be refunded up to $250 for that job, and driver-fault amounts can be recovered from future earnings. Customer-packed or disassembled items, loose parts, and normal wear are not covered.

Rate limits: 5 sign-in codes per number per hour, 10 per network per hour, 10 new requests per customer per day, 30 offers per driver per hour, 60 messages per person per hour and 10 per minute, and 5 help requests per day.

---

## 7. Pricing

### 7.1 Pricing methods
| Method | Customer enters | Stored as | Who responds |
|---|---|---|---|
| Get a quote | Nothing | `pricing_method = 'quote'` and no customer amount | Opens immediately. Eligible drivers send offers and the customer chooses one. An optional admin price stays hidden until the customer accepts it, then a driver claims it |
| Name your price | One amount, min $35, or $50 for junk removal | `'fixed'`, `offer_cents` | Drivers accept or counter. The original `offer_cents` stays. The customer chooses the offer |
| Set a budget range | Min (≥ $35, or ≥ $50 for junk removal) and max (> min) | `'range'`, `budget_min_cents`, `budget_max_cents` | Drivers offer within the range or counter outside it (`outside_range`). The original range stays. The customer chooses the offer |

The driver or admin enters the customer-facing offer. Commission and the service fee are stored in integer cents. The commission rate and the service-fee rate used for that offer are stored on the offer and copied to the job, so a later settings change does not rewrite it. Older jobs keep the cents already saved.

- **Driver earnings** = round half up(offer × 85%). Default commission is 15% of the offer, deducted from that offer.
- **Pickuply commission** = offer − driver earnings. It is not added to the customer price. There is no second platform fee and no separate Pickuply service fee.
- **Service fee** is paid by the customer on top of the offer. Default 5% (500 basis points), rounded half up. It does not depend on the card type or on Stripe's processing rate. The label is "Service fee". Stripe's actual processing fee is an expense recorded from the balance transaction when Stripe provides it. A missing balance transaction stays blank until it arrives. A full refund when the driver or Pickuply is at fault includes the service fee. A partial refund keeps it unless an admin includes it. A late-cancel fee or a trip fee, when one of those settings is above zero, does not include a service fee. Both settings are currently $0. Naming this a service fee does not by itself decide card-network or consumer-disclosure compliance.
- **Fixed Accept, counter, range, and quote** all use that offer. A posted price is the offer, and processing is added on top. The admin enters the customer offer, not driver take-home pay.

Rounding is half up on integer cents: `(numerator + denominator / 2) / denominator`. A $50 offer keeps $7.50 and pays the driver $42.50. A $100 offer keeps $15 and pays the driver $85. A $200 offer keeps $30 and pays the driver $170. A $50.01 offer pays the driver $42.51 and keeps $7.50. A $60 offer pays the driver $51 and totals $63.00 after the 5% service fee. A $100 offer totals $105.00.

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

**Driver pay:** the entered amount is the customer-facing offer. Driver earnings are that offer minus the stored commission. For junk jobs, those earnings must cover disposal. `dump_fee_cents` is an informational estimate for the admin. The disposal receipt is proof of disposal, not a reason to pay the driver anything beyond those earnings. The service fee is added on top of the offer and shown before the customer pays. Tips go 100% to the driver.

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
Review evidence, contact both parties, record notes, then resolve with: no action · warning · refund (full/partial) · strike(s) · driver paused · driver removed · customer blocked. There is no published damage payment and no dollar cap. A refund is a separate payment decision, not insurance. Both parties are notified. Serious allegations can trigger temporary restriction without treating them as proven. A person who wants Pickuply to review damage reports it within 48 hours and includes photos. Those 48 hours are an administrative review window, not a waiver of a right the law does not allow to be waived. Damage already visible at pickup, customer-packed items, loose parts, and normal wear are outside that review.

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

Job chat closes when the job is completed or cancelled. Phone numbers and email addresses are rejected, including spaced, dotted, spelled-out, and “at”/“dot” forms. Gate codes, store order numbers, addresses, prices, sizes, and times are allowed. An admin may include contact details only in a support thread. A new message appears in the recipient's Messages inbox and as a bell alert. The alert opens that conversation. Opening the conversation marks it read. Seen shows on the sender's last message after the other person opens it. Customers reply to an admin message or use Help. They cannot start an admin chat. A resolved support thread stays read-only. Document requests include Upload now for the matching profile field, and a successful upload notifies admin. Photos and PDFs in an admin conversation stay in a private bucket.

Built locally on 2026-10-22. Alerts are stored in the app, push is ready when VAPID keys are set, and email is ready when Resend is set. Texting is wired and stays off until an admin turns it on after Twilio approval. The one-time iPhone Home Screen note is on the alerts page. Job messages open at assignment and close 24 hours after completion. Proof photos are private, locked after upload, and any optional location is rounded and visible only to an admin.

| Event | Customer | Driver | Admin |
|---|---|---|---|
| Request submitted | ✔ confirmation | | ✔ new request |
| Quote sent | ✔ text with link | | |
| Job published | | ✔ eligible Online drivers (push + text fallback) | |
| Job assigned | ✔ driver info | ✔ confirmation | ✔ |
| No driver after 20 min | | | ✔ alert |
| Status changes | ✔ | | |
| Item loaded | ✔ item is loaded; the driver continues | | |
| Delivered or junk removed | ✔ confirm or report an issue | | |
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
- `jobs` — id, customer_id, service, status, zone_id, pickup_area (city/ZIP), dropoff_area (city/ZIP), distance_miles, description, pieces, size (`small`/`medium`/`large`/`xl`), item_value_cents, needs_value_approval, listing_url, already_paid, seller_holding, wants_item_check, stairs_pickup, stairs_dropoff, elevator, help_loading, junk_load_size, junk_materials, junk_special_items, store_name, store_order_number, preferred_date, time_window, notes, **pricing_method** (`quote`/`fixed`/`range`), **offer_cents**, **budget_min_cents**, **budget_max_cents**, service_level, required_vehicle, price_cents (customer total: the offer plus the service fee), driver_pay_cents (driver earnings after the stored commission), platform_fee_cents (commission deducted from the offer), service_fee_cents (service fee added on top), service_fee_bps (the rate stored for that job; null on older rows), commission_bps (the rate stored for that job; null on older rows), dump_fee_cents, quote_expires_at, assigned_driver_id (set only when a driver is actually assigned), accepted_offer_id, stripe_payment_intent_id, payment_status, captured_cents, source, created_at. Status changes are recorded in `job_events`. The customer's pricing columns are immutable after insert. Only an admin can set or change `price_cents`, `driver_pay_cents`, `platform_fee_cents`, `service_fee_cents`, `commission_bps`, `dump_fee_cents`, and `quote_expires_at`. Older rows keep the cents already saved.
- `job_offers` — id, job_id, driver_id, kind (`accept`/`offer`/`counter`), driver_amount_cents (driver earnings), platform_fee_cents (commission), service_fee_cents (service fee), customer_total_cents (offer plus the service fee), service_fee_bps, commission_bps, reason, outside_range, available_at, status (`active`/`withdrawn`/`expired`/`chosen`/`declined`), expires_at, created_at. Allowed on open quote, fixed, and range jobs. Inserting an offer does not assign the driver or change the customer's posted price. Older offers keep the cents already saved.
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

Admin quote and price changes run as the signed-in admin. The database check is `is_admin()`. The service role never sets or changes `price_cents`, `driver_pay_cents`, `platform_fee_cents`, `dump_fee_cents`, or `quote_expires_at`. The service role is only for webhooks, cron, and other system tasks. It must still be able to update payment and job status where this spec requires a system step: card authorization, capture after delivery or the 24-hour auto-complete, the late-cancel capture, and the trip-fee capture when those settings are above zero.

---

## 15. Pilot success criteria (30 days)

- 25+ paid jobs · $3,000+ revenue · 20%+ average margin · drivers average $25+/hour
- 30%+ customers repeat or refer · zero unresolved damage/theft/no-show incidents
- 2+ landlords or property managers book more than once

---

## 16. Later (v2+, do not build in v1)

Stripe Connect automatic payouts, business accounts for landlords (multiple properties, invoicing), seller "delivery available" links, favorite drivers, referral credits, background checks, ID verification, masked phone calls, native iOS/Android apps with background GPS, cargo insurance per job.
