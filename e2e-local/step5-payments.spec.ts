import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const people = {
  customer: { phone: "5555550123", code: "101123", name: "Casey Customer" },
  driver: { phone: "5555550124", code: "101124", name: "Pat Driver" },
  driver2: { phone: "5555550125", code: "101125", name: "Bea Driver" },
  admin: { phone: "5555550126", code: "101126", name: "Alex Admin" },
};

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const secret = process.env.STRIPE_SECRET_KEY ?? "";
if (!secret.startsWith("sk_test_")) throw new Error("Stripe Playwright needs a test key.");
const stripe = new Stripe(secret);

test.beforeAll(() => {
  localSql("update public.platform_settings set payout_delay_seconds = 3 where id = 1;");
});

test.afterAll(() => {
  localSql("update public.platform_settings set payout_delay_seconds = null where id = 1;");
});

test("captured job records the Stripe fee and holds the transfer until payout setup is finished", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4242424242424242");
  await driveToDelivery(customer.page, driver.page, jobId);
  await customer.page.getByRole("button", { name: "Got it" }).click();
  await expect(customer.page.getByRole("heading", { name: "Completed" })).toBeVisible({ timeout: 60_000 });
  await expect(customer.page.getByRole("heading", { name: "Receipt" })).toBeVisible();

  const captured = await waitForRow(
    `select payment_status || '|' || captured_cents || '|' || (stripe_fee_cents is not null)::text from public.jobs j join public.job_payments p on p.job_id = j.id where j.id = '${jobId}'`,
    /captured\|\d+\|true/,
  );
  expect(captured.startsWith("captured|")).toBe(true);

  const ledger = localSql(
    `select status || '|' || amount_cents || '|' || (select count(*) from public.ledger_entries where job_id = '${jobId}') from public.ledger_entries where job_id = '${jobId}'`,
  ).trim();
  expect(ledger.endsWith("|1")).toBe(true);

  localSql(`
    update public.ledger_entries set available_on = now() - interval '1 minute' where job_id = '${jobId}';
    update public.jobs set updated_at = now() - interval '1 minute' where id = '${jobId}';
  `);
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const transferBody = await cron("/api/cron/transfers");
  expect(transferBody).toContain('"ok":true');
  const held = localSql(
    `select status || '|' || coalesce(hold_reason, '') || '|' || coalesce(stripe_transfer_id, '') from public.ledger_entries where job_id = '${jobId}'`,
  ).trim();
  expect(held.startsWith("held_until_onboarding|")).toBe(true);
  expect(held.endsWith("|")).toBe(true);

  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("a declined card can be retried before the deadline", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4000000000000002", false);
  await expect(customer.page.getByText("The card was declined. You can try again.")).toBeVisible({ timeout: 60_000 });
  const failed = await waitForRow(
    `select payment_status from public.jobs where id = '${jobId}'`,
    /failed/,
  );
  expect(failed).toBe("failed");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("the payment deadline cron reopens an unpaid job", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await assignedJob(browser);
  localSql(`update public.jobs set payment_due_at = now() - interval '1 minute' where id = '${jobId}';`);
  const body = await cron("/api/cron/payment-deadlines");
  expect(body).toContain('"ok":true');
  const status = localSql(`select status from public.jobs where id = '${jobId}'`).trim();
  expect(status).toBe("open");
  await cron("/api/cron/auto-complete");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("a card approved after the job reopens is released", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await assignedJob(browser);
  await customer.page.getByRole("button", { name: "Pay to confirm" }).click();
  await customer.page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const sessionId = localSql(`select checkout_session_id from public.job_payments where job_id = '${jobId}'`).trim();
  localSql(`update public.jobs set payment_due_at = now() - interval '1 minute' where id = '${jobId}';`);
  localSql(`select public.release_overdue_job('${jobId}'::uuid);`);
  await confirmSession(sessionId, "4242424242424242");
  const outcome = await waitForRow(
    `select outcome from public.payment_attempts where job_id = '${jobId}' and outcome = 'released_late'`,
    /released_late/,
  );
  expect(outcome.split("\n").filter(Boolean).every((row) => row === "released_late")).toBe(true);
  const payment = localSql(`select payment_status from public.jobs where id = '${jobId}'`).trim();
  expect(payment).not.toBe("authorized");
  expect(sessionId.startsWith("cs_")).toBe(true);
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("rejecting the item captures only the trip fee", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4242424242424242");
  await driver.page.goto(`/driver/jobs/${jobId}`);
  await driver.page.getByRole("button", { name: "Start trip to pickup" }).click();
  await driver.page.getByRole("button", { name: "I've arrived" }).click();
  await saveProof(driver.page, "pickup");
  await driver.page.getByRole("button", { name: "Send for item check" }).click();
  await waitForRow(`select status from public.jobs where id = '${jobId}'`, /^item_check$/);
  await customer.page.goto(`/jobs/${jobId}`);
  await customer.page.locator("#reject-reason").fill("The item is the wrong size.");
  await customer.page.getByRole("button", { name: "Reject item" }).click();
  await expect(customer.page.getByRole("heading", { name: "Cancelled" })).toBeVisible({ timeout: 60_000 });
  const row = await waitForRow(
    `select j.payment_status || '|' || j.captured_cents || '|' || coalesce(l.amount_cents, 0) || '|' || (select count(*) from public.ledger_entries where job_id = '${jobId}') from public.jobs j left join public.ledger_entries l on l.job_id = j.id where j.id = '${jobId}'`,
    /captured\|2500\|2500\|1/,
  );
  expect(row).toBe("captured|2500|2500|1");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("a disputed job is not captured or transferred", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4242424242424242");
  await driveToDelivery(customer.page, driver.page, jobId);
  await customer.page.locator("#report-category").selectOption("damaged");
  await customer.page.locator("#report-description").fill("The desk corner is cracked.");
  await customer.page.locator("#report-outcome").selectOption("repair");
  await customer.page.getByRole("button", { name: "Send report" }).click();
  await expect(customer.page.getByText("Report saved.")).toBeVisible();
  await customer.page.getByRole("button", { name: "Got it" }).click();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const payment = localSql(`select payment_status from public.jobs where id = '${jobId}'`).trim();
  expect(payment).not.toBe("captured");
  const transfers = localSql(`select count(*) from public.ledger_entries where job_id = '${jobId}' and stripe_transfer_id is not null`).trim();
  expect(transfers).toBe("0");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("a refund before capture releases the card hold", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4242424242424242");
  const dollars = (Number(localSql(`select price_cents from public.jobs where id = '${jobId}'`).trim()) / 100).toFixed(2);
  await admin.page.goto(`/admin/requests/${jobId}`);
  await admin.page.locator("#refund-amount").fill(dollars);
  await admin.page.locator("#refund-reason").fill("Release the hold before capture");
  await admin.page.getByRole("button", { name: "Refund" }).click();
  await admin.page.waitForURL(/saved=1/);
  const payment = localSql(`select payment_status from public.jobs where id = '${jobId}'`).trim();
  expect(payment).toBe("canceled");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("earnings stay held until payout setup, and an outside payment is labeled", async ({ browser }) => {
  const session = await assignedJob(browser, "driver2");
  await session.customer.page.getByRole("button", { name: "Pay to confirm" }).click();
  await payOnStripe(session.customer.page, "4242424242424242");
  await driveToDelivery(session.customer.page, session.driver.page, session.jobId);
  await session.customer.page.getByRole("button", { name: "Got it" }).click();
  const held = await waitForRow(
    `select status || '|' || coalesce(hold_reason, '') from public.ledger_entries where job_id = '${session.jobId}'`,
    /held_until_onboarding\|/,
  );
  expect(held).toContain("Finish payout setup");
  await session.driver.page.goto("/driver/earnings");
  await expect(session.driver.page.getByText("Finish payout setup before a transfer can be sent")).toBeVisible();
  await session.admin.page.goto("/admin/payouts");
  const card = session.admin.page.locator("li").filter({ hasText: "held until onboarding" }).first();
  await card.getByLabel("Method").fill("cash");
  await card.getByLabel("Reference").fill("hand-1");
  await card.getByLabel("Reason").fill("Paid in person for this test");
  await card.getByRole("button", { name: "Record external payment" }).click();
  await expect(session.admin.page.getByText("Paid outside Stripe").first()).toBeVisible();
  await session.customer.context.close();
  await session.driver.context.close();
  await session.admin.context.close();
});

test("a refund before transfer reduces the ledger", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4242424242424242");
  await driveToDelivery(customer.page, driver.page, jobId);
  await customer.page.getByRole("button", { name: "Got it" }).click();
  await waitForRow(`select payment_status from public.jobs where id = '${jobId}'`, /captured/);
  const before = Number(localSql(`select amount_cents from public.ledger_entries where job_id = '${jobId}'`).trim());
  await admin.page.goto(`/admin/requests/${jobId}`);
  await admin.page.locator("#refund-amount").fill("10");
  await admin.page.locator("#refund-reason").fill("Partial refund before transfer");
  await admin.page.getByRole("button", { name: "Refund" }).click();
  await admin.page.waitForURL(/saved=1/);
  const after = Number(localSql(`select amount_cents from public.ledger_entries where job_id = '${jobId}'`).trim());
  expect(after).toBe(before - 1000);
  const recovery = localSql(`select count(*) from public.recovery_obligations where job_id = '${jobId}'`).trim();
  expect(recovery).toBe("0");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("a refund after transfer records a recovery and does not deduct it", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4242424242424242");
  await driveToDelivery(customer.page, driver.page, jobId);
  await customer.page.getByRole("button", { name: "Got it" }).click();
  await waitForRow(`select payment_status from public.jobs where id = '${jobId}'`, /captured/);
  localSql(`
    update public.ledger_entries
    set status = 'transferred', transfer_status = 'created', stripe_transfer_id = 'tr_teststep5refund', available_on = now()
    where job_id = '${jobId}';
  `);
  const before = Number(localSql(`select amount_cents from public.ledger_entries where job_id = '${jobId}'`).trim());
  await admin.page.goto(`/admin/requests/${jobId}`);
  await admin.page.locator("#refund-amount").fill("10");
  await admin.page.locator("#refund-reason").fill("Refund after the transfer");
  await admin.page.getByRole("button", { name: "Refund" }).click();
  await admin.page.waitForURL(/saved=1/);
  const after = localSql(
    `select amount_cents || '|' || status from public.ledger_entries where job_id = '${jobId}'`,
  ).trim();
  expect(after).toBe(`${before}|recovery_due`);
  const recovery = localSql(
    `select status || '|' || amount_cents from public.recovery_obligations where job_id = '${jobId}'`,
  ).trim();
  expect(recovery).toBe("recovery_due|1000");
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("a test chargeback holds the ledger", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await paidJob(browser, "4000000000000259");
  await driveToDelivery(customer.page, driver.page, jobId);
  await customer.page.getByRole("button", { name: "Got it" }).click();
  const held = await waitForRow(
    `select l.status from public.ledger_entries l join public.card_disputes d on d.job_id = l.job_id where l.job_id = '${jobId}'`,
    /held|recovery_due/,
    90_000,
  );
  expect(held).toMatch(/held|recovery_due/);
  await admin.page.goto("/admin/payments");
  await expect(admin.page.getByRole("heading", { name: "Card disputes" })).toBeVisible();
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

test("an expired Checkout session can be started again", async ({ browser }) => {
  const { customer, driver, admin, jobId } = await assignedJob(browser);
  await customer.page.getByRole("button", { name: "Pay to confirm" }).click();
  await customer.page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const first = localSql(`select checkout_session_id from public.job_payments where job_id = '${jobId}'`).trim();
  await stripe.checkout.sessions.expire(first);
  await customer.page.goto(`/jobs/${jobId}`);
  await customer.page.getByRole("button", { name: "Pay to confirm" }).click();
  await customer.page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const second = localSql(`select checkout_session_id from public.job_payments where job_id = '${jobId}'`).trim();
  expect(second.startsWith("cs_")).toBe(true);
  expect(second).not.toBe(first);
  await customer.context.close();
  await driver.context.close();
  await admin.context.close();
});

async function paidJob(browser: Browser, card: string, expectAuthorized = true) {
  const session = await assignedJob(browser);
  await session.customer.page.getByRole("button", { name: "Pay to confirm" }).click();
  await payOnStripe(session.customer.page, card);
  if (expectAuthorized) {
    await waitForRow(`select payment_status from public.jobs where id = '${session.jobId}'`, /authorized/);
    await session.driver.page.goto(`/driver/jobs/${session.jobId}`);
    await expect(session.driver.page.getByText("Payment confirmed: you can start")).toBeVisible();
  }
  return session;
}

async function assignedJob(browser: Browser, who: "driver" | "driver2" = "driver") {
  resetLocalPeople();
  const customer = await signedIn(browser, people.customer);
  const driverPerson = people[who];
  const driver = await signedIn(browser, driverPerson);
  const admin = await signedIn(browser, people.admin);
  await onboard(driver.page, driverPerson.name);
  promoteAdmin();
  await admin.page.goto("/admin/drivers");
  await admin.page.getByRole("link", { name: new RegExp(driverPerson.name) }).click();
  const approveAnyway = admin.page.getByRole("checkbox", { name: "Approve anyway" });
  if (await approveAnyway.isVisible()) await approveAnyway.check();
  await admin.page.getByRole("button", { name: "Approve driver" }).click();
  await admin.page.waitForURL(/saved=1/);
  if (who === "driver") await connectDriver(driver.page);
  const jobId = await createRequest(customer.context);
  await publish(admin.page, jobId);
  await goOnline(driver.page);
  await driver.page.goto("/driver");
  await driver.page.getByRole("button", { name: "Accept posted price" }).click();
  await customer.page.goto(`/jobs/${jobId}`);
  await customer.page.getByRole("button", { name: "Choose this driver" }).click();
  await expect(customer.page.getByRole("heading", { name: "Driver assigned" })).toBeVisible();
  await expect(customer.page.getByRole("button", { name: "Pay to confirm" })).toBeVisible();
  return { customer, driver, admin, jobId };
}

async function connectDriver(page: Page) {
  await page.goto("/driver/earnings");
  await page.getByRole("button", { name: "Set up payouts" }).click();
  await page.waitForURL((url) => url.hostname.endsWith("stripe.com"), { timeout: 60_000 });
  const accountId = localSql(
    "select stripe_account_id from public.driver_connect_accounts where driver_id in (select id from auth.users where phone in ('15555550124', '+15555550124'))",
  ).trim();
  expect(accountId.startsWith("acct_")).toBe(true);
  await expect(page.getByRole("button", { name: "Use test phone number" })).toBeVisible();
  await page.goto("/driver/earnings");
  await expect(page.getByRole("heading", { name: "Finish payout setup" })).toBeVisible();
}

async function driveToDelivery(customer: Page, driver: Page, jobId: string) {
  await driver.goto(`/driver/jobs/${jobId}`);
  await expect(driver.getByRole("button", { name: "Start trip to pickup" })).toBeVisible();
  await driver.getByRole("button", { name: "Start trip to pickup" }).click();
  await expect(driver.getByRole("button", { name: "I've arrived" })).toBeVisible();
  await driver.getByRole("button", { name: "I've arrived" }).click();
  await saveProof(driver, "pickup");
  await driver.getByRole("button", { name: "Send for item check" }).click();
  await waitForRow(`select status from public.jobs where id = '${jobId}'`, /^item_check$/);
  await customer.goto(`/jobs/${jobId}`);
  await customer.getByRole("button", { name: "Approve item" }).click();
  await waitForRow(`select status from public.jobs where id = '${jobId}'`, /^in_transit$/);
  await driver.goto(`/driver/jobs/${jobId}`);
  await saveProof(driver, "dropoff");
  await driver.getByRole("button", { name: "Mark delivered" }).click();
  await waitForRow(`select status from public.jobs where id = '${jobId}'`, /^delivered$/);
  await customer.goto(`/jobs/${jobId}`);
  await expect(customer.getByRole("button", { name: "Got it" })).toBeVisible();
}

async function saveProof(page: Page, stage: "pickup" | "dropoff") {
  await page.locator("#proof-stage").selectOption(stage);
  await page.locator("#proof-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Save proof" }).click();
  await expect(page.getByText("Proof saved. It cannot be replaced.")).toBeVisible();
}

async function payOnStripe(page: Page, card: string) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const sessionId = new URL(page.url()).pathname.split("/").find((part) => part.startsWith("cs_"));
  if (!sessionId) throw new Error("The Checkout page did not include a session id.");
  await confirmSession(sessionId, card);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.success_url) await page.goto(session.success_url);
}

async function confirmSession(sessionId: string, card: string) {
  const method = await stripe.paymentMethods.create({
    type: "card",
    card: { token: testToken(card) },
    billing_details: {
      name: "Casey Customer",
      email: "casey.customer@example.com",
      phone: "2015550123",
      address: { country: "US", postal_code: "30168" },
    },
  });
  try {
    await stripe.rawRequest("POST", `/v1/payment_pages/${sessionId}/confirm`, { payment_method: method.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/declined|card_error/i.test(message)) throw error;
  }
}

function testToken(card: string): string {
  if (card.startsWith("4000000000000002")) return "tok_chargeDeclined";
  if (card.startsWith("4000000000000259")) return "tok_createDispute";
  return "tok_visa";
}

async function cron(pathname: string) {
  const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return body;
}

async function waitForRow(sql: string, pattern: RegExp, timeout = 45_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeout) {
    last = localSql(sql).trim();
    if (pattern.test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out. Last row: ${last}`);
}

async function signedIn(browser: Browser, person: { phone: string; code: string; name: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(person.name);
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }
  return { context, page };
}

async function onboard(page: Page, name: string) {
  await page.goto("/driver/onboarding");
  await page.locator("#fullName").fill(name);
  await page.getByLabel("Street").fill("10 Test Street");
  await page.getByLabel("City").fill("Austell");
  await page.getByLabel("ZIP").fill("30106");
  await page.locator("#vehicleType").selectOption("pickup");
  await page.getByRole("radio", { name: "Light load" }).check();
  await page.locator("#licenseExpires").fill("2027-12-31");
  const photo = { name: "photo.png", mimeType: "image/png", buffer: png };
  await page.locator("#profilePhoto").setInputFiles(photo);
  await page.locator("#licensePhoto").setInputFiles(photo);
  await page.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
  await page.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/driver\?saved=applied/);
}

function promoteAdmin() {
  localSql(
    "update public.profiles p set role = 'admin' from auth.users u where p.id = u.id and u.phone in ('15555550126', '+15555550126');",
  );
}

async function createRequest(context: BrowserContext) {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/create_customer_request`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${await accessToken(context)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: requestId,
      payload: {
        service: "delivery",
        description: "TEST stripe desk",
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
        customer_name: "Casey Customer",
        customer_phone: "+15555550123",
      },
    }),
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return requestId;
}

async function accessToken(context: BrowserContext) {
  const cookies = await context.cookies();
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

async function publish(_page: Page, jobId: string) {
  const status = localSql(`select status from public.jobs where id = '${jobId}'`).trim();
  expect(status).toBe("open");
}

async function goOnline(page: Page) {
  await page.goto("/driver");
  await page.getByRole("switch", { name: "You are Offline" }).click();
  await expect(page.getByRole("switch", { name: "You are Online" })).toBeVisible();
}

function resetLocalPeople() {
  const phones = "('15555550123', '+15555550123', '15555550124', '+15555550124', '15555550125', '+15555550125', '15555550126', '+15555550126')";
  localSql(`
    alter table public.job_photos disable trigger job_photos_lock;
    delete from public.job_events
    where actor_id in (select id from auth.users where phone in ${phones})
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in ${phones})
          or assigned_driver_id in (select id from auth.users where phone in ${phones})
      );
    update public.jobs set accepted_offer_id = null
    where customer_id in (select id from auth.users where phone in ${phones})
      or assigned_driver_id in (select id from auth.users where phone in ${phones});
    delete from public.job_offers
    where driver_id in (select id from auth.users where phone in ${phones});
    delete from public.driver_bank_payouts
    where driver_id in (select id from auth.users where phone in ${phones});
    delete from public.jobs
    where customer_id in (select id from auth.users where phone in ${phones})
      or assigned_driver_id in (select id from auth.users where phone in ${phones});
    delete from public.audit_log
    where actor_id in (select id from auth.users where phone in ${phones})
      or target_id in (select id from auth.users where phone in ${phones});
    delete from public.profiles
    where id in (select id from auth.users where phone in ${phones});
    delete from public.drivers
    where not exists (select 1 from public.profiles where profiles.id = drivers.profile_id);
    delete from public.notifications
    where not exists (select 1 from public.profiles where profiles.id = notifications.profile_id);
    delete from auth.users where phone in ${phones};
    alter table public.job_photos enable trigger job_photos_lock;
  `);
}

function localSql(sql: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  );
}
