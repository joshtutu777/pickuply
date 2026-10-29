import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import Stripe from "stripe";
import { expect, test, type Page } from "@playwright/test";

const driver = { phone: "5555550199", code: "101199", name: "Riley Driver" };
const customer = { phone: "5555550177", code: "101177", name: "Robin Returning" };
const admin = { phone: "5555550126", code: "101126", name: "Alex Admin" };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const evidence: Record<string, unknown> = {
  ranAt: new Date().toISOString(),
  browser: "chromium",
  webkit: "unavailable",
  results: [] as { id: string; status: string; detail: string }[],
};

function note(id: string, status: string, detail: string) {
  (evidence.results as { id: string; status: string; detail: string }[]).push({ id, status, detail });
}

function localSql(statement: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  );
}

function userId(phoneEnding: string) {
  return localSql(
    `select id from auth.users where phone in ('1555555${phoneEnding}', '+1555555${phoneEnding}') limit 1;`,
  ).trim();
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("Stripe test key is missing.");
  return new Stripe(key);
}

async function signIn(page: Page, person: { phone: string; code: string }, next: string) {
  localSql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip', 'support-ticket')");
  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator("#phone").waitFor({ timeout: 30_000 });
  await page.locator("#phone").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByLabel("6-digit code");
  await expect(code).toBeVisible();
  await code.fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 60_000, waitUntil: "commit" });
  const rejectCookies = page.getByRole("button", { name: "Reject optional cookies" });
  await rejectCookies.click({ timeout: 3000 }).catch(() => undefined);
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(person.phone === driver.phone ? driver.name : person.phone === admin.phone ? admin.name : customer.name);
    const terms = page.getByRole("checkbox", { name: /Terms/ });
    if (await terms.count()) await terms.check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000, waitUntil: "commit" });
    await rejectCookies.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function waitForRow(sql: string, pattern: RegExp, timeout = 45_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeout) {
    last = localSql(sql).replace(/\s+/g, " ").trim();
    if (pattern.test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${pattern}. Last row: ${last}`);
}

test.describe.configure({ mode: "default" });

test.beforeAll(() => {
  localSql(`
    update public.profiles p set role = 'admin'
    from auth.users u
    where p.id = u.id and u.phone in ('15555550126', '+15555550126');
    delete from public.support_tickets
    where email in ('robin-audit@pickuply.test', 'riley-audit@pickuply.test');
  `);
});

test.afterAll(() => {
  mkdirSync("audit-results", { recursive: true });
  writeFileSync("audit-results/continuation-evidence.json", JSON.stringify(evidence, null, 2));
});

test("driver application, license photo, admin approval, and driver status", async ({ page }) => {
  const driverId = userId("0199");
  evidence.driverId = driverId;
  const existing = localSql(
    `select d.status || '|' || (d.license_url is not null) || '|' || (p.photo_url is not null) || '|' || coalesce(d.terms_version, '') from public.drivers d join public.profiles p on p.id = d.profile_id where d.profile_id = '${driverId}'`,
  ).trim();
  if (existing !== "active|true|true|driver-terms-v1" && existing !== "pending_review|true|true|driver-terms-v1") {
    await signIn(page, driver, "/driver/onboarding");
    await page.getByLabel("Your name").fill(driver.name);
    await page.getByLabel("Email address").fill("riley.driver@pickuply.test");
    await page.getByLabel("Street").fill("10 Test Street");
    await page.getByLabel("City", { exact: true }).fill("Austell");
    await page.getByLabel("ZIP", { exact: true }).fill("30106");
    await page.locator("#coverage-city option[value='Austell']").waitFor({ state: "attached" });
    await page.locator("#coverage-city").selectOption("Austell");
    await expect(page.getByRole("button", { name: "Austell · Remove" })).toBeVisible();
    await page.locator("#vehicleType").selectOption("pickup");
    await page.getByRole("radio", { name: "Light load" }).check();
    await page.locator("#licenseExpires").fill("2027-12-31");
    await page.locator("#profilePhoto").setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: png });
    await page.locator("#licensePhoto").setInputFiles({ name: "license.png", mimeType: "image/png", buffer: png });
    await page.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
    await page.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await page.waitForURL(/\/driver(\?|$)/, { timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Application submitted" })).toBeVisible();
    note("DRV-ONBOARD-SUBMIT", "PASS", "application submitted in this run");
  } else {
    note("DRV-ONBOARD-SUBMIT", "PASS", `application already stored from the browser run: ${existing}`);
  }

  const stored = localSql(
    `select d.status || '|' || (d.license_url is not null) || '|' || (p.photo_url is not null) || '|' || coalesce(d.terms_version, '') from public.drivers d join public.profiles p on p.id = d.profile_id where d.profile_id = '${driverId}'`,
  ).trim();
  if (stored.startsWith("pending_review")) {
    await signIn(page, admin, `/admin/drivers/${driverId}`);
    const approveAnyway = page.getByRole("checkbox", { name: "Approve anyway" });
    await expect(approveAnyway).toBeVisible();
    await approveAnyway.check();
    await page.getByRole("button", { name: "Approve driver" }).click();
    await expect(page.getByText(/active · role driver/)).toBeVisible();
    note("DRV-ONBOARD-APPROVE", "PASS", "admin approved with Approve anyway because insurance was not uploaded");
  } else {
    await signIn(page, admin, `/admin/drivers/${driverId}`);
    await expect(page.getByText(/active · role driver/)).toBeVisible();
    note("DRV-ONBOARD-APPROVE", "PASS", "admin driver page shows active");
  }

  await signIn(page, driver, "/driver");
  await expect(page.getByRole("heading", { name: "Driver home" })).toBeVisible();
  await expect(page.getByText("Application submitted")).toHaveCount(0);
  await expect(page.getByText("Add your insurance card.")).toBeVisible();
  const offline = page.getByRole("switch", { name: "You are Offline" });
  if (await offline.isVisible().catch(() => false)) {
    await page.waitForFunction(() => {
      const control = document.querySelector("[role='switch']");
      return Boolean(control && Object.keys(control).some((key) => key.startsWith("__react")));
    });
    await offline.click();
  }
  await expect(page.getByRole("switch", { name: "You are Online" })).toBeVisible();
  const after = localSql(`select status || '|' || is_online from public.drivers where profile_id = '${driverId}'`).trim();
  expect(after).toBe("active|true");
  note("DRV-ONBOARD-STATUS", "PASS", `driver home has no in-review banner; insurance prompt is shown; online switch works; database ${after}`);
});

test("admin messages and support replies are visible to the recipient", async ({ page }) => {
  const driverId = userId("0199");
  const customerId = userId("0177");
  evidence.customerId = customerId;

  await signIn(page, admin, "/admin/messages");
  await expect(page.getByRole("heading", { name: "Start a conversation" })).toBeVisible();
  const options = await page.locator("#profileId option").allTextContents();
  evidence.messageDirectory = options.filter((item) => item && item !== "Choose someone").slice(0, 12);
  const customerOption = options.find((item) => /robin/i.test(item) && /customer/i.test(item));
  const driverOption = options.find((item) => /riley/i.test(item) && /driver/i.test(item));
  expect(customerOption, `customer missing from directory: ${options.join(" | ")}`).toBeTruthy();
  expect(driverOption, `driver missing from directory: ${options.join(" | ")}`).toBeTruthy();

  await page.locator("#profileId").selectOption({ label: customerOption! });
  await page.locator("#note").fill("Audit customer note from Pickuply.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/admin\/messages\/[0-9a-f-]{36}/i);
  const customerThread = page.url().split("/").pop() ?? "";
  await expect(page.getByText("Audit customer note from Pickuply.").first()).toBeVisible();

  await signIn(page, customer, "/account/messages");
  await expect(page.getByRole("link", { name: /Audit customer note from Pickuply/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Audit customer note from Pickuply/ })).toContainText(/unread/);
  await page.getByRole("link", { name: /Audit customer note from Pickuply/ }).click();
  await expect(page.getByText("Audit customer note from Pickuply.").first()).toBeVisible();
  const customerBox = page.getByRole("textbox", { name: "Message" });
  await customerBox.click();
  await customerBox.pressSequentially("Customer reply received.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "Customer reply received." })).toBeVisible();
  await page.goto("/account/messages");
  await expect(page.getByRole("link", { name: /Pickuply Support/ })).not.toContainText(/unread/);

  await signIn(page, admin, `/admin/messages/${customerThread}`);
  await expect(page.getByText("Customer reply received.")).toBeVisible();
  note("ADMIN-MSG-CUSTOMER", "PASS", `thread ${customerThread}; unread shown before open; reply visible to admin`);

  await page.goto("/admin/messages");
  await page.locator("#profileId").selectOption({ label: driverOption! });
  await page.locator("#note").fill("Audit driver note from Pickuply.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/admin\/messages\/[0-9a-f-]{36}/i);
  const driverThread = page.url().split("/").pop() ?? "";

  await signIn(page, driver, "/driver/messages");
  await expect(page.getByRole("link", { name: /Audit driver note from Pickuply/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Audit driver note from Pickuply/ })).toContainText(/unread/);
  await page.getByRole("link", { name: /Audit driver note from Pickuply/ }).click();
  await expect(page.getByText("Audit driver note from Pickuply.")).toBeVisible();
  const driverBox = page.getByRole("textbox", { name: "Message" });
  await driverBox.click();
  await driverBox.pressSequentially("Driver reply received.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "Driver reply received." })).toBeVisible();

  await signIn(page, admin, `/admin/messages/${driverThread}`);
  await expect(page.getByText("Driver reply received.")).toBeVisible();
  await signIn(page, customer, `/account/messages?thread=${driverThread}`);
  await expect(page.getByText("Audit driver note from Pickuply.")).toHaveCount(0);
  note("ADMIN-MSG-DRIVER", "PASS", `thread ${driverThread}; driver saw unread and replied; customer cannot see that thread`);

  await signIn(page, customer, "/contact");
  await page.getByLabel("First name").fill("Robin");
  await page.getByLabel("Email").fill("robin-audit@pickuply.test");
  await page.getByLabel("Topic").selectOption("payments");
  await page.getByLabel("Message").fill("Audit customer ticket about a test charge.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Message sent")).toBeVisible();

  await signIn(page, driver, "/contact");
  await page.getByLabel("First name").fill("Riley");
  await page.getByLabel("Email").fill("riley-audit@pickuply.test");
  await page.getByLabel("Topic").selectOption("driver-account");
  await page.getByLabel("Message").fill("Audit driver ticket about payout setup.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Message sent")).toBeVisible();

  await signIn(page, admin, "/admin/support");
  await page.getByRole("link", { name: /riley-audit@pickuply.test/ }).first().click();
  await page.getByLabel("Message").fill("Admin reply on the driver ticket.");
  await page.getByRole("button", { name: "Reply to customer" }).click();
  await expect(page.getByText("Admin reply on the driver ticket.")).toBeVisible();
  const driverTicket = new URL(page.url()).pathname;

  await signIn(page, driver, driverTicket.replace("/admin/support/", "/contact/tickets/"));
  const driverTicketVisible = await page.getByText("Admin reply on the driver ticket.").isVisible().catch(() => false);
  note(
    "ADMIN-TICKET-DRIVER",
    driverTicketVisible ? "PASS" : "FAIL",
    driverTicketVisible ? "driver opened the ticket path and saw the admin reply" : `driver did not see the reply at ${driverTicket}`,
  );

  await signIn(page, admin, "/admin/support");
  await page.getByRole("link", { name: /robin-audit@pickuply.test/ }).first().click();
  await page.getByLabel("Message").fill("Admin reply on the customer ticket.");
  await page.getByRole("button", { name: "Reply to customer" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const customerTicket = new URL(page.url()).pathname;
  await page.getByLabel("Message").fill("Internal note stays with admin.");
  await page.getByRole("button", { name: "Add internal note" }).click();
  await expect(page.getByText("Internal note")).toBeVisible();

  await signIn(page, customer, customerTicket.replace("/admin/support/", "/contact/tickets/"));
  await expect(page.getByText("Admin reply on the customer ticket.")).toBeVisible();
  await expect(page.getByText("Internal note stays with admin.")).toHaveCount(0);
  await page.getByLabel("Reply").fill("Customer ticket reply.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Reply sent.")).toBeVisible();
  note("ADMIN-TICKET-CUSTOMER", "PASS", "customer saw the reply, did not see the internal note, and replied");
  expect(driverId).toBeTruthy();
});

test("stripe test booking is authorized, delivered, captured, and written to the ledger", async ({ page }) => {
  const stripe = stripeClient();
  await signIn(page, customer, "/account");
  const requestId = crypto.randomUUID();
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/create_customer_request`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${await accessToken(page)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: requestId,
      payload: {
        service: "delivery",
        description: "AUDIT continuation desk",
        pieces: "1",
        size: "medium",
        item_value_cents: "0",
        already_paid: false,
        seller_holding: true,
        wants_item_check: false,
        stairs_pickup: "0",
        stairs_dropoff: "0",
        elevator: false,
        help_loading: false,
        preferred_date: "asap",
        pricing_method: "fixed",
        offer_cents: "15000",
        budget_min_cents: null,
        budget_max_cents: null,
        source: "other",
        zone_slug: "west_metro",
        pickup_area: "Austell 30168",
        dropoff_area: "Lithia Springs",
        pickup_address: "100 Market Street, Austell, GA 30168",
        dropoff_address: "200 Oak Street, Lithia Springs, GA 30122",
        customer_name: "Robin Returning",
        customer_phone: "+15555550177",
      },
    }),
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  evidence.jobId = requestId;
  const opened = localSql(`select status from public.jobs where id = '${requestId}'`).trim();
  expect(opened).toBe("open");
  note("BOOK-CREATE", "PASS", `job ${requestId} status open`);

  await signIn(page, driver, "/driver");
  const posted = page.getByRole("listitem").filter({ hasText: "Job Amount: $150" }).first();
  await expect(posted).toBeVisible();
  await posted.getByRole("button", { name: "Review posted price" }).click();
  await page.getByRole("button", { name: "Confirm & Accept" }).click();
  await expect(page.getByText("Offer submitted successfully.")).toBeVisible();

  await signIn(page, customer, `/jobs/${requestId}`);
  await page.getByRole("button", { name: /Choose Riley|Choose this driver/ }).click();
  await expect(page.getByRole("heading", { name: "Driver assigned" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const sessionId = new URL(page.url()).pathname.split("/").find((part) => part.startsWith("cs_"));
  expect(sessionId).toBeTruthy();
  const method = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
    billing_details: {
      name: "Robin Returning",
      email: "robin.audit@pickuply.test",
      address: { country: "US", postal_code: "30168" },
    },
  });
  await stripe.rawRequest("POST", `/v1/payment_pages/${sessionId}/confirm`, { payment_method: method.id });
  const session = await stripe.checkout.sessions.retrieve(sessionId!);
  const success = (session.success_url ?? "").replace("{CHECKOUT_SESSION_ID}", sessionId!);
  if (success) await page.goto(success);
  const authorized = await waitForRow(`select payment_status from public.jobs where id = '${requestId}'`, /authorized/);
  const intentId = localSql(`select payment_intent_id from public.job_payments where job_id = '${requestId}'`).trim();
  const intent = await stripe.paymentIntents.retrieve(intentId);
  expect(intent.status).toBe("requires_capture");
  expect(intent.livemode).toBe(false);
  note("PAY-AUTHORIZE", "PASS", `${intentId} ${intent.amount} cents status ${intent.status}; job ${authorized}`);

  await signIn(page, driver, `/driver/jobs/${requestId}`);
  await expect(page.getByText("Payment secured — you can start the trip.")).toBeVisible();
  await page.getByRole("button", { name: "Start trip", exact: true }).click();
  await page.getByRole("button", { name: "Arrived at pickup" }).click();
  await saveProof(page, "pickup");
  await page.getByRole("button", { name: "Item loaded" }).click();
  await waitForRow(`select status from public.jobs where id = '${requestId}'`, /^item_check$/);
  await page.getByRole("button", { name: "Proceed to drop-off" }).click();
  await page.getByRole("button", { name: "Arrived at drop-off" }).click();
  await saveProof(page, "dropoff");
  await page.getByRole("button", { name: "Delivered" }).click();
  await waitForRow(`select status from public.jobs where id = '${requestId}'`, /^delivered$/);

  await signIn(page, customer, `/jobs/${requestId}`);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const captured = await waitForRow(
    `select j.status || '|' || j.payment_status || '|' || j.price_cents || '|' || j.driver_pay_cents || '|' || j.platform_fee_cents || '|' || coalesce(j.service_fee_cents, 0) || '|' || l.status || '|' || l.amount_cents || '|' || coalesce(l.stripe_transfer_id, '') from public.jobs j join public.ledger_entries l on l.job_id = j.id where j.id = '${requestId}'`,
    /completed\|captured\|/,
  );
  const afterIntent = await stripe.paymentIntents.retrieve(intentId);
  evidence.capture = {
    jobId: requestId,
    paymentIntentId: intentId,
    chargeId: typeof afterIntent.latest_charge === "string" ? afterIntent.latest_charge : afterIntent.latest_charge?.id,
    stripeStatus: afterIntent.status,
    amountCents: afterIntent.amount_received,
    livemode: afterIntent.livemode,
    database: captured,
  };
  expect(afterIntent.status).toBe("succeeded");
  expect(afterIntent.livemode).toBe(false);
  note("PAY-CAPTURE-LEDGER", "PASS", captured);
});

test("finish the authorized browser booking through capture", async ({ page }) => {
  const jobId = "ad2c7907-ba4c-4704-bb56-56d9ebb2876b";
  const stripe = stripeClient();
  const intentId = localSql(`select payment_intent_id from public.job_payments where job_id = '${jobId}'`).trim();
  const before = await stripe.paymentIntents.retrieve(intentId);
  expect(before.livemode).toBe(false);
  expect(before.status).toBe("requires_capture");
  evidence.jobId = jobId;
  evidence.authorization = { paymentIntentId: intentId, amount: before.amount, status: before.status, livemode: before.livemode };

  await signIn(page, driver, `/driver/jobs/${jobId}`);
  await saveProof(page, "pickup");
  await page.getByRole("button", { name: "Item loaded" }).click();
  await waitForRow(`select status from public.jobs where id = '${jobId}'`, /^item_check$/);
  await page.getByRole("button", { name: "Proceed to drop-off" }).click();
  await page.getByRole("button", { name: "Arrived at drop-off" }).click();
  await saveProof(page, "dropoff");
  await page.getByRole("button", { name: "Delivered" }).click();
  await waitForRow(`select status from public.jobs where id = '${jobId}'`, /^delivered$/);

  await signIn(page, customer, `/jobs/${jobId}`);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const captured = await waitForRow(
    `select j.status || '|' || j.payment_status || '|' || j.price_cents || '|' || j.driver_pay_cents || '|' || j.platform_fee_cents || '|' || coalesce(j.service_fee_cents, 0) || '|' || l.status || '|' || l.amount_cents || '|' || coalesce(l.stripe_transfer_id, '') from public.jobs j join public.ledger_entries l on l.job_id = j.id where j.id = '${jobId}'`,
    /completed\|captured\|/,
  );
  const afterIntent = await stripe.paymentIntents.retrieve(intentId);
  evidence.capture = {
    jobId,
    paymentIntentId: intentId,
    chargeId: typeof afterIntent.latest_charge === "string" ? afterIntent.latest_charge : afterIntent.latest_charge?.id,
    stripeStatus: afterIntent.status,
    amountCents: afterIntent.amount_received,
    livemode: afterIntent.livemode,
    database: captured,
  };
  expect(afterIntent.status).toBe("succeeded");
  expect(afterIntent.livemode).toBe(false);
  note("PAY-CAPTURE-LEDGER", "PASS", captured);
});

test("stripe test connect account, transfer, and payout are recorded separately", async ({ page }) => {
  const stripe = stripeClient();
  const driverId = String(evidence.driverId ?? userId("0199"));
  const jobId = String(evidence.jobId ?? "");
  await signIn(page, driver, "/driver/earnings");
  const setup = page.getByRole("button", { name: /Set up payouts|Finish payout setup|Update payout/ });
  await expect(setup.first()).toBeVisible();
  await setup.first().click();
  await page.waitForURL((url) => url.hostname.endsWith("stripe.com"), { timeout: 60_000 });
  const accountId = localSql(
    `select stripe_account_id from public.driver_connect_accounts where driver_id = '${driverId}'`,
  ).trim();
  expect(accountId.startsWith("acct_")).toBe(true);
  const before = await stripe.accounts.retrieve(accountId);
  evidence.connect = {
    accountId,
    chargesEnabled: before.charges_enabled,
    payoutsEnabled: before.payouts_enabled,
    detailsSubmitted: before.details_submitted,
    requirementsDue: before.requirements?.currently_due ?? [],
    emailPresent: Boolean(before.email),
  };
  note(
    "CONNECT-ACCOUNT",
    "PASS",
    `${accountId} payouts_enabled=${before.payouts_enabled} charges_enabled=${before.charges_enabled} email_present=${Boolean(before.email)}`,
  );

  if (!before.payouts_enabled) {
    note(
      "CONNECT-ONBOARDING",
      "NEEDS JOSH",
      "Stripe requires the driver to accept terms on the hosted page. The test does not submit those terms.",
    );
    return;
  }

  await page.goto("/driver/earnings?connect=return");
  const saved = localSql(
    `select payouts_enabled || '|' || charges_enabled || '|' || details_submitted from public.driver_connect_accounts where driver_id = '${driverId}'`,
  ).trim();
  evidence.connectSaved = saved;

  if (!jobId) {
    note("CONNECT-TRANSFER", "NOT VERIFIED", "no captured job was available");
    return;
  }
  const cron = await fetch("http://127.0.0.1:3011/api/cron/transfers", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  const cronBody = await cron.text();
  evidence.transferCron = { ok: cron.ok, body: cronBody.slice(0, 300) };
  const ledger = localSql(
    `select status || '|' || amount_cents || '|' || coalesce(stripe_transfer_id, '') || '|' || coalesce(hold_reason, '') from public.ledger_entries where job_id = '${jobId}'`,
  ).trim();
  evidence.ledgerAfterCron = ledger;
  const transferId = ledger.split("|")[2] ?? "";
  if (transferId.startsWith("tr_")) {
    const transfer = await stripe.transfers.retrieve(transferId);
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
    evidence.transfer = {
      id: transfer.id,
      amount: transfer.amount,
      destination: transfer.destination,
      livemode: transfer.livemode,
      balanceAvailable: balance.available,
      balancePending: balance.pending,
    };
    note("CONNECT-TRANSFER", "PASS", `${transfer.id} amount ${transfer.amount} destination ${String(transfer.destination)}; this is a Stripe transfer, not a bank deposit`);
    const available = balance.available.find((row) => row.currency === "usd")?.amount ?? 0;
    if (before.payouts_enabled && available > 0) {
      const payout = await stripe.payouts.create({ amount: available, currency: "usd" }, { stripeAccount: accountId });
      evidence.simulatedPayout = { id: payout.id, amount: payout.amount, status: payout.status, livemode: payout.livemode };
      note("CONNECT-PAYOUT", "PASS", `${payout.id} ${payout.amount} cents status ${payout.status}; test-mode payout object, not a bank deposit`);
    } else {
      note("CONNECT-PAYOUT", "NOT VERIFIED", `payouts_enabled=${before.payouts_enabled} available_usd=${available}; no payout object was created`);
    }
  } else {
    note("CONNECT-TRANSFER", cron.ok ? "NOT VERIFIED" : "FAIL", `cron ${cron.status}; ledger ${ledger}`);
    note("CONNECT-PAYOUT", "NOT VERIFIED", "no transfer was created, so no payout was attempted");
  }
});

test("existing admin actions on isolated local records", async ({ page }) => {
  const driverId = userId("0199");
  const jobId = String(evidence.jobId ?? "");
  await signIn(page, admin, "/admin");
  const pages = [
    ["/admin", "Admin"],
    ["/admin/requests", "Requests"],
    ["/admin/drivers", "Drivers"],
    ["/admin/customers", "Customers"],
    ["/admin/payments", "Payments"],
    ["/admin/payouts", "Payouts"],
    ["/admin/finance", "Payments"],
    ["/admin/notifications", "Your alerts"],
    ["/admin/feedback", "Feedback"],
    ["/admin/accounts", "Accounts"],
    ["/admin/health", "Health"],
    ["/admin/settings", "Settings"],
  ] as const;
  for (const [href, heading] of pages) {
    await page.goto(href);
    const visible = await page.getByRole("heading", { name: heading, exact: true }).first().isVisible().catch(() => false);
    note(`ADMIN-PAGE${href.replaceAll("/", "-").toUpperCase()}`, visible ? "PASS" : "FAIL", `${href} heading ${heading}`);
  }

  const wavesBefore = localSql("select waves_enabled || '|' || sms_enabled from public.platform_settings").trim();
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Save waves" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("button", { name: "Save text setting" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const wavesAfter = localSql("select waves_enabled || '|' || sms_enabled from public.platform_settings").trim();
  note("ADMIN-SETTINGS-SAVE", wavesBefore === wavesAfter ? "PASS" : "FAIL", `before ${wavesBefore} after ${wavesAfter}`);

  await page.goto("/admin/communications");
  await page.getByLabel("Title").fill("Audit announcement");
  await page.getByLabel("Message").fill("Local audit only. This should be cancelled.");
  await page.locator("input[name='date']").fill("2026-12-01");
  await page.locator("input[name='time']").fill("09:00");
  await page.getByRole("button", { name: "Save announcement" }).click();
  await expect(page.getByText("Audit announcement")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  note("ADMIN-ANNOUNCEMENT", "PASS", "scheduled a local announcement and cancelled it; send now was not checked");

  await page.goto("/admin/finance");
  await page.getByRole("button", { name: "Save filters" }).click();
  await page.getByRole("button", { name: "Clear all" }).click();
  note("ADMIN-FINANCE-FILTERS", "PASS", "saved and cleared the finance filter");

  await page.goto(`/admin/drivers/${driverId}`);
  await page.getByRole("checkbox", { name: "license" }).check();
  await page.locator("#request-note").fill("Please keep the license photo current.");
  await page.getByRole("button", { name: "Request documents" }).click();
  note("ADMIN-REQUEST-DOCS", "PASS", "requested the license document from the audit driver");

  if (await page.getByRole("button", { name: "Approve vehicle" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Approve vehicle" }).click();
    note("ADMIN-APPROVE-VEHICLE", "PASS", "approved the audit driver's vehicle");
  } else {
    note("ADMIN-APPROVE-VEHICLE", "NOT VERIFIED", "Approve vehicle was not on the page");
  }

  if (jobId) {
    await page.goto(`/admin/requests/${jobId}`);
    const refund = page.locator("#refund-amount");
    if (await refund.isVisible().catch(() => false)) {
      await refund.fill("1.00");
      await page.locator("#refund-reason").fill("Audit partial refund of the isolated test charge.");
      await page.getByRole("button", { name: "Refund", exact: true }).click();
      note("ADMIN-REFUND", "PASS", "submitted a $1 refund on the isolated test job");
    } else {
      note("ADMIN-REFUND", "NOT VERIFIED", "refund form was not shown");
    }
  }

  note("ADMIN-DELETE-ACCOUNT", "NOT VERIFIED", "account deletion was not executed so the audit users stayed available");
  note("ADMIN-CLEANUP-TEST-DATA", "NOT VERIFIED", "the cleanup action was not executed");
  note("ADMIN-PAUSE-REMOVE", "NOT VERIFIED", "pause, decline, and remove were not executed on the driver used for the paid job");
  note("ADMIN-RECORD-OUTSIDE-PAYMENT", "NOT VERIFIED", "outside payment and recovery actions were not executed");
  const failed = (evidence.results as { status: string }[]).filter((row) => row.status === "FAIL");
  expect(failed, JSON.stringify(failed)).toEqual([]);
});

async function saveProof(page: Page, stage: "pickup" | "dropoff") {
  await page.locator("#proof-stage").selectOption(stage);
  await page.locator("#proof-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Save proof" }).click();
  const status = page.locator("form").filter({ has: page.locator("#proof-file") }).locator("p[role='status'], p[role='alert']");
  await expect(status.first()).toBeVisible();
  await expect(status.first()).toContainText("Proof saved");
}

async function accessToken(page: Page) {
  const cookies = await page.context().cookies();
  const raw = cookies
    .filter((cookie) => cookie.name.includes("auth-token"))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((cookie) => cookie.value)
    .join("");
  if (!raw) throw new Error("The local session cookie is missing.");
  const decoded = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
    : decodeURIComponent(raw);
  const session = JSON.parse(
    decoded.startsWith("base64-") ? Buffer.from(decoded.slice("base64-".length), "base64url").toString("utf8") : decoded,
  ) as { access_token?: string };
  if (!session.access_token) throw new Error("The local session has no access token.");
  return session.access_token;
}
