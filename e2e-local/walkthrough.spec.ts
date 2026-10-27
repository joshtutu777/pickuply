import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const base = "http://127.0.0.1:3011";
const outDir = path.join(process.cwd(), "test-results", "walkthrough");
const driverPerson = { phone: "5555550199", code: "101199", name: "Walk Driver" };
const customerPerson = { phone: "5555550188", code: "101188", name: "Walk Customer" };
const adminPerson = { phone: "5555550126", code: "101126", name: "Alex Admin" };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type StepRow = {
  n: string;
  title: string;
  expected: string;
  result: "Pass" | "Fail" | "Not built";
  detail: string;
  shots: string[];
};

type AlertRow = {
  event: string;
  who: string;
  inApp: string;
  push: string;
  email: string;
};

const steps: StepRow[] = [];
const ux: string[] = [];
const alerts: AlertRow[] = [];
let failed = false;
let shotIndex = 0;

test("three people walk a pickup from signup through delivery", async ({ browser }, testInfo) => {
  test.setTimeout(1_200_000);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, "emails"), { recursive: true });
  mkdirSync(path.join(outDir, "video"), { recursive: true });
  const started = new Date(Date.now() - 60_000).toISOString();
  resetPhones([driverPerson.phone, customerPerson.phone]);

  const driverContext = await phoneContext(browser);
  const adminContext = await phoneContext(browser);
  const customerContext = await phoneContext(browser);
  const driver = await driverContext.newPage();
  const admin = await adminContext.newPage();
  const customer = await customerContext.newPage();
  let driverId = "";
  let customerId = "";
  let jobId = "";
  let secondJobId = "";

  try {
    await record("01", "Driver opens Drive with us and Quick Apply", "Landing, Drive with us, Areas I cover, terms, and a 3-item checklist.", async () => {
      await driver.goto("/");
      await driver.getByRole("link", { name: "Drive with us" }).first().click();
      await expect(driver.getByRole("heading", { name: "Earn with your truck, van, or SUV" })).toBeVisible();
      await driver.getByRole("link", { name: "Get started" }).click();
      await driver.waitForURL(/\/login/, { timeout: 15_000 }).catch(async () => {
        ux.push("Get started did not open sign-in, so the test opened the driver sign-in page directly.");
      });
      if (!driver.url().includes("onboarding")) {
        await driver.goto("/login?next=/driver/onboarding&intent=driver");
      }
      await signIn(driver, driverPerson);
      if (!driver.url().includes("/driver/onboarding")) await driver.goto("/driver/onboarding");
      await driver.getByLabel("Your name").fill(driverPerson.name);
      await driver.getByLabel("Email address").fill("walk.driver@pickuply.test");
      await driver.getByLabel("Street").fill("10 Test Street");
      await driver.getByLabel("City", { exact: true }).fill("Austell");
      await driver.getByLabel("ZIP", { exact: true }).fill("30106");
      const coverageCity = driver.locator("#coverage-city");
      await expect(coverageCity.locator("option", { hasText: "Austell" })).toBeAttached();
      await coverageCity.selectOption("Austell");
      await driver.locator("#vehicleType").selectOption("pickup");
      await driver.getByRole("radio", { name: "Light load" }).check();
      await driver.locator("#licenseExpires").fill("2027-12-31");
      const photo = { name: "photo.png", mimeType: "image/png", buffer: png };
      await driver.locator("#profilePhoto").setInputFiles(photo);
      await driver.locator("#licensePhoto").setInputFiles(photo);
      await driver.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
      await driver.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
      await driver.getByRole("button", { name: "Submit application" }).click();
      await driver.waitForURL(/\/driver\?saved=applied/);
      driverId = localSql(`select id from auth.users where phone in ('1${driverPerson.phone}', '+1${driverPerson.phone}') limit 1;`).trim();
      expect(driverId).toMatch(/^[0-9a-f-]{36}$/i);
      const checklist = driver.locator("#checklist");
      await checklist.scrollIntoViewIfNeeded();
      await expect(checklist.getByRole("link", { name: /Vehicle/ })).toBeVisible();
      await expect(checklist.getByRole("link", { name: /Insurance/ })).toBeVisible();
      await expect(checklist.getByRole("link", { name: /Training/ })).toBeVisible();
      await driver.getByRole("switch", { name: "You are Offline" }).click();
      await expect(driver.getByText("Finish these steps. You can go Online after Pickuply approves you.")).toBeVisible();
      await expect(driver.getByText("Browse only until Pickuply approves you. You cannot take a job yet.")).toBeVisible();
      const checklistBox = await checklist.boundingBox();
      const feedBox = await driver.locator("#jobs").boundingBox();
      expect(checklistBox && feedBox && checklistBox.y < feedBox.y).toBeTruthy();
    }, [[driver, "driver-checklist"]]);

    await record("02", "Admin approves the driver and the driver goes Online", "Approve anyway if needed. The driver sees the approval alert, then Online.", async () => {
      await signIn(admin, adminPerson);
      const before = await badgeCount(driver, "Alerts");
      await admin.goto(`/admin/drivers/${driverId}`);
      await expect(admin.getByRole("heading", { name: driverPerson.name })).toBeVisible();
      const anyway = admin.getByRole("checkbox", { name: "Approve anyway" });
      await anyway.scrollIntoViewIfNeeded();
      await anyway.check();
      await admin.getByRole("button", { name: "Approve driver" }).click();
      const approvedLine = admin.getByText(/active · role driver/);
      try {
        await expect(approvedLine).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        const extra = await admin.locator("p[role=alert]").allInnerTexts();
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} ${extra.join(" ")}`.slice(0, 500));
      }
      await driver.goto("/driver/notifications");
      const approval = driver.getByRole("link", { name: /You're ready to drive/ });
      if (await approval.isVisible().catch(() => false)) {
        const after = await badgeCount(driver, "Alerts");
        if (after <= before) ux.push("The approval was on the Alerts page, but the bottom-nav badge did not show a higher count before it was opened.");
        await approval.click();
        await expect(driver).toHaveURL(/\/driver/);
      } else {
        ux.push("The approval alert was not listed for this test driver, so the driver opened Driver home directly.");
        await driver.goto("/driver");
      }
      await expect(driver.getByText("Add your insurance card.")).toBeVisible();
      ux.push("A missing insurance card is named on Driver home and does not block the Online switch. Expired insurance does.");
      await driver.getByRole("switch", { name: "You are Offline" }).click();
      await expect(driver.getByRole("switch", { name: "You are Online" })).toBeVisible();
    }, [[admin, "admin-approved"], [driver, "driver-online"]]);

    await record("03", "Customer posts a Name your price pickup and the driver sees it", "A new customer, a photo, a Georgia address, and the job on the driver feed with no admin step.", async () => {
      await customer.goto("/");
      await customer.getByRole("link", { name: "Post a pickup" }).first().click();
      await expect(customer.getByRole("heading", { name: "What do you need?" })).toBeVisible();
      await customer.getByRole("radio", { name: /Pickup & Delivery/ }).check();
      await customer.getByLabel("What needs a ride?").fill("Walkthrough oak dresser");
      await customer.locator("#photos").setInputFiles({ name: "dresser.png", mimeType: "image/png", buffer: png });
      await customer.getByRole("button", { name: "Next", exact: true }).click();
      for (const query of [
        "100 Market Street, Austell, GA 30106",
        "20 Hidden Avenue, Hiram, GA 30141",
        "265 Peachtree St NE, Atlanta, GA 30303",
      ]) {
        await expectGeorgiaSuggestion(customer, query);
      }
      const searched = await pickAddress(customer, "Search pickup address", "1985 Chattahoochee Dr, Duluth, GA 30097");
      expect(searched).toBe(true);
      await customer.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
      await customer.getByLabel("Drop-off city").fill("Hiram");
      await customer.getByLabel("Drop-off ZIP").fill("30141");
      await customer.getByRole("radio", { name: "ASAP" }).check();
      await customer.getByRole("button", { name: "Next", exact: true }).click();
      await customer.getByRole("radio", { name: /Name your price/ }).check();
      await customer.getByRole("textbox", { name: "Your price" }).fill("60");
      await customer.getByRole("button", { name: "Next", exact: true }).click();
      await customer.getByLabel("Your name").fill(customerPerson.name);
      await customer.getByLabel("Phone number").fill(customerPerson.phone);
      await customer.getByRole("checkbox", { name: "I agree to the terms, fees, and prohibited items." }).check();
      await customer.getByRole("button", { name: "Continue" }).click();
      await customer.getByRole("button", { name: "Text me a code" }).click();
      await customer.getByLabel("6-digit code").fill(customerPerson.code);
      await customer.getByRole("button", { name: "Verify and continue" }).click();
      await expect(customer.getByRole("heading", { name: "Request sent" })).toBeVisible();
      await customer.getByRole("link", { name: "View your request" }).click();
      await customer.waitForURL(/\/jobs\/[0-9a-f-]+$/);
      jobId = new URL(customer.url()).pathname.split("/").pop() ?? "";
      const status = localSql(`select status from public.jobs where id = '${jobId}';`).trim();
      expect(status).toBe("open");
      await driver.goto("/driver");
      if (driver.url().includes("/login")) {
        ux.push("The driver session was gone when the new request was checked, so the test signed that driver in again.");
        await signIn(driver, driverPerson);
        await driver.goto("/driver");
      }
      await expect(driver.getByText(/Hiram/).first()).toBeVisible({ timeout: 25_000 });
      customerId = localSql(`select id from auth.users where phone in ('1${customerPerson.phone}', '+1${customerPerson.phone}') limit 1;`).trim();
    }, [[customer, "request-sent"], [driver, "feed"]]);

    await record("04", "Driver offers, customer confirms, and the test card is held", "New driver, vehicle, total, then Stripe 4242 shows the card authorized.", async () => {
      const card = driver.locator(`#job-${jobId}`);
      await card.getByRole("button", { name: "Accept posted price" }).click();
      await expect(card.getByText("Offer submitted successfully.")).toBeVisible();
      await customer.reload();
      await expect(customer.getByText(/New driver/)).toBeVisible();
      await expect(customer.getByText(/Total/)).toBeVisible();
      await expect(customer.getByRole("button", { name: "Choose Walk" })).toBeVisible();
      const choose = customer.getByRole("button", { name: "Choose Walk" });
      await choose.click();
      const chooseStarted = Date.now();
      let retriedChoose = false;
      await expect.poll(async () => {
        const status = localSql(`select status from public.jobs where id = '${jobId}'`).trim();
        if (status === "assigned") return true;
        const problem = new URL(customer.url()).searchParams.get("error");
        if (problem) throw new Error(problem);
        if (!retriedChoose && Date.now() - chooseStarted > 8_000 && (await choose.isVisible().catch(() => false))) {
          retriedChoose = true;
          await choose.click();
        }
        return false;
      }, { timeout: 60_000, intervals: [1_000, 2_000, 2_000] }).toBe(true);
      await customer.reload();
      await expect(customer.getByRole("heading", { name: "Confirm Your Booking" })).toBeVisible({ timeout: 45_000 });
      await expect(customer.getByText("You won't be charged until your item is delivered")).toBeVisible();
      await customer.getByRole("button", { name: "Confirm booking" }).click();
      await customer.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      const sessionId = new URL(customer.url()).pathname.split("/").find((part) => part.startsWith("cs_"));
      if (!sessionId) throw new Error("The Checkout page did not include a session id.");
      await confirmCheckout(sessionId);
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.success_url) {
        const success = new URL(session.success_url);
        await customer.goto(`${success.pathname}${success.search}`);
      }
      await expect.poll(async () => {
        const status = localSql(`select coalesce(payment_status, '') from public.jobs where id = '${jobId}'`).trim();
        if (status === "authorized" || status === "paid" || status === "captured") return true;
        await customer.reload();
        return customer.getByText(/held on your card and charged only after delivery/).isVisible();
      }, { timeout: 90_000 }).toBe(true);
      const payment = localSql(`select payment_status from public.jobs where id = '${jobId}';`).trim();
      expect(payment).toBe("authorized");
      await customer.reload();
      await expect(customer.getByText(/held on your card and charged only after delivery/)).toBeVisible();
      await expect(customer.getByText(/Payment confirmed/i)).toHaveCount(0);
      const noticePeople = localSql(
        `select count(*)::text from (select profile_id from public.notifications where job_id = '${jobId}' and kind = 'payment_confirmed' group by profile_id having count(*) = 1) one;`,
      ).trim();
      expect(noticePeople).toBe("2");
    }, [[customer, "card-authorized"], [driver, "offer-sent"]]);

    await record("05", "Chat, pickup, delivery, and the 4-step tracker", "Messages both ways, a phone number stays hidden, then the trip reaches Got it.", async () => {
      await expect(customer.getByRole("heading", { name: "Messages" })).toBeVisible();
      await expect(customer.getByText("Request & Price").first()).toBeVisible();
      await expect(customer.getByText(/Driver [Cc]onfirmed/).first()).toBeVisible();
      const box = customer.getByRole("textbox", { name: "Message", exact: true });
      await box.fill("Call me at 404-555-1212");
      await expect(customer.getByText("Remove the phone number or email before sending.")).toBeVisible();
      ux.push("A phone number in chat blocks Send and shows a warning. It is not stored with the number hidden.");
      await box.fill("The dresser is on the porch.");
      await customer.getByRole("button", { name: "Send", exact: true }).click();
      await expect(customer.getByText("The dresser is on the porch.")).toBeVisible();
      await driver.goto(`/driver/jobs/${jobId}`);
      await expect(driver.getByText("The dresser is on the porch.")).toBeVisible({ timeout: 20_000 });
      await driver.getByRole("textbox", { name: "Message", exact: true }).fill("I can lift it.");
      await driver.getByRole("button", { name: "Send", exact: true }).click();
      await expect(driver.getByText("I can lift it.")).toBeVisible();
      await customer.reload();
      await expect(customer.getByText("I can lift it.")).toBeVisible();
      await driver.getByRole("button", { name: "Start trip", exact: true }).click();
      await waitForButton(driver, "Arrived at pickup");
      await driver.getByRole("button", { name: "Arrived at pickup" }).click();
      await driver.locator("#proof-file").setInputFiles({ name: "item.png", mimeType: "image/png", buffer: png });
      await driver.getByRole("button", { name: "Save proof" }).click();
      await expect(driver.getByText(/Proof saved/)).toBeVisible();
      await waitForButton(driver, "Item loaded");
      await driver.getByRole("button", { name: "Item loaded" }).click();
      await expect.poll(() => localSql(`select status from public.jobs where id = '${jobId}'`).trim(), { timeout: 30_000 }).toBe("item_check");
      await waitForButton(driver, "Proceed to drop-off");
      await driver.getByRole("button", { name: "Proceed to drop-off" }).click();
      await expect.poll(() => localSql(`select status from public.jobs where id = '${jobId}'`).trim(), { timeout: 30_000 }).toBe("in_transit");
      await waitForButton(driver, "Arrived at drop-off");
      await driver.getByRole("button", { name: "Arrived at drop-off" }).click();
      await waitForButton(driver, "Delivered");
      await driver.locator("#proof-stage").selectOption("dropoff");
      await driver.locator("#proof-file").setInputFiles({ name: "drop.png", mimeType: "image/png", buffer: png });
      await driver.getByRole("button", { name: "Save proof" }).click();
      await expect(driver.getByText(/Proof saved/)).toBeVisible();
      await driver.getByRole("button", { name: "Delivered" }).click();
      await expect.poll(() => localSql(`select status from public.jobs where id = '${jobId}'`).trim(), { timeout: 30_000 }).toBe("delivered");
      await expect.poll(async () => {
        await customer.reload();
        return customer.getByRole("button", { name: "Confirm", exact: true }).isVisible().catch(() => false);
      }, { timeout: 45_000, intervals: [1_000, 2_000, 3_000] }).toBe(true);
      await expect(customer.getByText("Delivered").first()).toBeVisible();
      await customer.getByRole("button", { name: "Confirm", exact: true }).click();
      const confirmed = customer.getByText("You confirmed this delivery.");
      const review = customer.getByRole("heading", { name: "Review" });
      await expect(confirmed.or(review)).toBeVisible({ timeout: 30_000 });
      await expect(customer.getByText("Delivery confirmed — thanks!")).toBeVisible();
      await customer.reload();
      await expect(customer.getByText("Delivery confirmed — thanks!")).toBeVisible();
      await expect(customer.getByText("This conversation is closed. Need help? Visit")).toBeVisible();
      await expect(customer.getByRole("link", { name: "Help", exact: true }).first()).toBeVisible();
      await expect(customer.getByRole("link", { name: "Report a problem" })).toBeVisible();
    }, [[customer, "got-it"], [driver, "delivered"]]);

    await record("06", "Reviews, scheduled earnings, and admin payments", "Both reviews save. Driver earnings show the 48-hour hold. Admin payments show the job amounts.", async () => {
      const moneySnapshot = () => localSql(
        `select status || '|' || payment_status || '|' || coalesce(driver_pay_cents::text, '') || '|' || (select count(*) from public.job_reviews where job_id = '${jobId}') || '|' || (select count(*) from public.ledger_entries where job_id = '${jobId}') from public.jobs where id = '${jobId}';`,
      ).trim();
      const beforeSkip = moneySnapshot();
      await expect(customer.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/account");
      await customer.getByRole("link", { name: "Not now" }).click();
      await expect(customer).toHaveURL(/\/account/);
      if (moneySnapshot() !== beforeSkip) throw new Error("Skipping the customer review changed the job.");
      await customer.goto(`/jobs/${jobId}`);
      await driver.reload();
      await expect(driver.getByText(/Earnings status: Held/)).toBeVisible();
      await expect(driver.getByRole("link", { name: "Earnings and payouts" })).toHaveAttribute("href", "/driver/earnings");
      await expect(driver.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/driver");
      const beforeDriverSkip = moneySnapshot();
      await driver.getByRole("link", { name: "Not now" }).click();
      await expect(driver).toHaveURL(/\/driver$/);
      if (moneySnapshot() !== beforeDriverSkip) throw new Error("Skipping the driver review changed the job.");
      await driver.goto(`/driver/jobs/${jobId}`);
      await customer.getByLabel("Stars").selectOption("5");
      await customer.getByLabel("Comment, optional").fill("Careful with the dresser.");
      await customer.getByRole("button", { name: "Send review" }).click();
      await expect(customer.getByText("You gave 5 stars.")).toBeVisible();
      await expect(customer.getByText("Delivery confirmed — thanks!")).toBeVisible();
      await driver.reload();
      await driver.getByLabel("Stars").selectOption("5");
      await driver.getByRole("button", { name: "Send review" }).click();
      await expect(driver.getByText("You gave 5 stars.")).toBeVisible();
      await driver.goto("/driver/earnings");
      await expect(driver.getByText("Held — finish payout setup to get paid")).toBeVisible();
      await expect(driver.getByText(/Then sends 48 hours after completion/)).toBeVisible();
      const money = localSql(
        `select price_cents || '|' || driver_pay_cents || '|' || platform_fee_cents || '|' || service_fee_cents from public.jobs where id = '${jobId}';`,
      ).trim();
      const [total, pay, platform, service] = money.split("|").map((value) => formatCents(Number(value)));
      await admin.goto(`/admin/finance?includeTest=1&range=month&q=${jobId}`);
      await expect(admin.getByText(total).first()).toBeVisible();
      await expect(admin.getByText(pay).first()).toBeVisible();
      await expect(admin.getByText(platform).first()).toBeVisible();
      await expect(admin.getByText(service).first()).toBeVisible();
    }, [[driver, "earnings"], [admin, "payments"], [customer, "review"]]);

    await record("07", "Ask for details, one announcement, and suspend then reinstate", "A second open request, one person gets the announcement, and a test customer is suspended then restored.", async () => {
      await customer.goto("/support");
      await expect(customer.getByText("Use Help to contact Pickuply.")).toBeVisible();
      await customer.goto("/request");
      await customer.getByRole("radio", { name: /Pickup & Delivery/ }).check();
      await customer.getByLabel("What needs a ride?").fill("Walkthrough side table");
      await customer.locator("#photos").setInputFiles({ name: "table.png", mimeType: "image/png", buffer: png });
      await customer.getByRole("button", { name: "Next", exact: true }).click();
      await customer.getByLabel("Pickup street address").fill("15 Oak Street");
      await customer.getByLabel("Pickup city").fill("Austell");
      await customer.getByLabel("Pickup ZIP").fill("30106");
      await customer.getByLabel("Drop-off street address").fill("40 Pine Street");
      await customer.getByLabel("Drop-off city").fill("Mableton");
      await customer.getByLabel("Drop-off ZIP").fill("30126");
      await customer.getByRole("radio", { name: "ASAP" }).check();
      await customer.getByRole("button", { name: "Next", exact: true }).click();
      await customer.getByRole("radio", { name: /Get a quote/ }).check();
      await customer.getByRole("button", { name: "Next", exact: true }).click();
      const repeatName = customer.getByLabel("Your name");
      if (await repeatName.isVisible().catch(() => false)) {
        if (!(await repeatName.inputValue()).trim()) {
          ux.push("A signed-in customer still had to enter a name on the next request.");
          await repeatName.fill(customerPerson.name);
        }
      }
      await customer.getByRole("checkbox", { name: "I agree to the terms, fees, and prohibited items." }).check();
      await customer.getByRole("button", { name: "Send request" }).click();
      await expect(customer.getByRole("heading", { name: "Request sent" })).toBeVisible();
      await customer.getByRole("link", { name: "View your request" }).click();
      await customer.waitForURL(/\/jobs\/[0-9a-f-]+$/);
      secondJobId = new URL(customer.url()).pathname.split("/").pop() ?? "";
      await admin.goto(`/admin/requests/${secondJobId}`);
      await admin.getByRole("checkbox", { name: "More photos" }).check();
      await admin.getByLabel("Note for the customer").fill("Please add one more photo of the table.");
      await admin.getByRole("button", { name: "Ask for details" }).click();
      const askedAt = Date.now();
      let retriedAsk = false;
      await expect.poll(async () => {
        if (await admin.getByText(/Drivers cannot see this quote until you send a price/).isVisible().catch(() => false)) return true;
        const ask = admin.getByRole("button", { name: "Ask for details" });
        if (!retriedAsk && Date.now() - askedAt > 8_000 && (await ask.isVisible().catch(() => false))) {
          retriedAsk = true;
          await ask.click();
        }
        return false;
      }, { timeout: 60_000, intervals: [1_000, 2_000, 2_000] }).toBe(true);
      await customer.goto("/account/messages");
      await customer.getByRole("link", { name: /Pickuply Support/ }).click();
      await expect(customer.getByText(/another photo|Add details/i).first()).toBeVisible();
      await admin.goto("/admin/communications");
      await admin.getByLabel("Title").fill("Walkthrough note");
      await admin.getByRole("textbox", { name: "Message", exact: true }).fill("This note is only for the people named here.");
      await admin.getByRole("checkbox", { name: "In-app alerts" }).check();
      await admin.getByLabel("Audience").selectOption("selected");
      await admin.getByLabel(/Person ids/).fill(`${customerId} ${driverId}`);
      await admin.getByRole("checkbox", { name: "Send when the scheduler next runs" }).check();
      await admin.getByRole("button", { name: "Save announcement" }).click();
      await expect(admin.getByText(/Saved/)).toBeVisible();
      await cron("/api/cron/notifications");
      await customer.goto("/account/notifications");
      await expect(customer.getByText("Walkthrough note")).toBeVisible();
      await driver.goto("/driver/notifications");
      await expect(driver.getByText("Walkthrough note")).toBeVisible();
      await customer.getByRole("button", { name: "Reply" }).first().click();
      await expect(customer.getByRole("heading", { name: "Pickuply Support" })).toBeVisible();
      await customer.goto("/account/notifications");
      await expect(customer.getByText("Walkthrough note")).toBeVisible();
      await admin.goto(`/admin/customers/${customerId}`);
      await expect(admin.getByRole("heading", { name: /Walk/ })).toBeVisible();
      await expect(admin.getByLabel("Restriction")).toHaveValue("indefinite");
      for (const choice of ["24 hours", "3 days", "7 days", "30 days", "Custom date", "No end date"]) {
        await expect(admin.getByRole("option", { name: choice })).toBeAttached();
      }
      await admin.getByLabel("Restriction").selectOption("custom");
      await expect(admin.getByLabel("Ends (Eastern)")).toBeVisible();
      await admin.getByLabel("Restriction").selectOption("indefinite");
      await admin.getByLabel("Reason").fill("Walkthrough restriction check.");
      await admin.getByRole("button", { name: "Suspend Account" }).click();
      await expect(admin.getByText(/Restricted/)).toBeVisible();
      await admin.getByRole("button", { name: "Reinstate Account" }).click();
      await expect(admin.getByText("Not restricted.")).toBeVisible();
    }, [[admin, "customer-reinstated"], [customer, "announcement"]]);

    await record("08", "Email verification and email alerts", "Profile email, a local verification link, and email on or off by type.", async () => {
      writeFileSync(
        path.join(outDir, "emails", "not-built.txt"),
        "Email collection is not built. Sign-in is still phone and OTP. lib/email.ts can call Resend, and there is no profile email or verification screen.\n",
      );
      throw new Error("Email collection and verification are not built yet.");
    }, [[customer, "email-not-built"]]);

    await record("09", "Support chats, documents, announcements, and help", "Admin and driver can message, the customer cannot start support, and a help case gets a reply.", async () => {
      await customer.goto("/support");
      await expect(customer.getByRole("button", { name: "Send", exact: true })).toBeVisible();
      await expect(customer.getByRole("button", { name: /Start a conversation|New message/ })).toHaveCount(0);
      await admin.goto("/admin/messages");
      await admin.locator("#profileId").selectOption(customerId);
      await admin.getByRole("textbox", { name: "Message", exact: true }).fill("We saw the dresser request.");
      await admin.getByRole("button", { name: "Send", exact: true }).click();
      await admin.waitForURL(/\/admin\/messages\/[0-9a-f-]+$/);
      const supportUrl = admin.url();
      await customer.goto("/support");
      await expect(customer.getByText("We saw the dresser request.")).toBeVisible();
      await customer.getByRole("textbox", { name: "Message", exact: true }).fill("Thanks, the dresser arrived.");
      await customer.getByRole("button", { name: "Send", exact: true }).click();
      await admin.reload();
      await expect(admin.getByText("Thanks, the dresser arrived.")).toBeVisible();
      await admin.getByRole("button", { name: "Mark resolved" }).click();
      await expect(admin.getByText("This conversation is resolved and read-only.")).toBeVisible();
      await customer.goto("/support");
      await expect(customer.getByText("This conversation is closed. Need help? Visit")).toBeVisible();
      await expect(customer.getByRole("link", { name: "Report a problem" })).toBeVisible();
      await expect(customer.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
      await driver.goto("/support");
      await driver.getByRole("textbox", { name: "Message", exact: true }).fill("I need a hand with payout setup.");
      await driver.getByRole("button", { name: "Send", exact: true }).click();
      await expect(driver.getByText("I need a hand with payout setup.")).toBeVisible();
      await admin.goto(`/admin/drivers/${driverId}`);
      await admin.getByRole("checkbox", { name: "insurance" }).check();
      await admin.getByLabel("Note for the driver").fill("Please upload the insurance card.");
      await admin.getByRole("button", { name: "Request documents" }).click();
      await driver.goto("/driver/messages");
      await driver.getByRole("link", { name: /Pickuply Support/ }).click();
      await expect(driver.getByRole("link", { name: "Upload insurance now" })).toBeVisible();
      await driver.getByRole("link", { name: "Upload insurance now" }).click();
      await expect(driver).toHaveURL(/\/driver\/ready\/insurance/);
      await driver.locator("#insurance-photo").setInputFiles({ name: "insurance.png", mimeType: "image/png", buffer: png });
      await driver.locator("#insurance-expires").fill("2027-12-31");
      await driver.getByRole("button", { name: "Save insurance" }).click();
      await expect(driver).toHaveURL(/saved=insurance/);
      await customer.goto("/help");
      await customer.getByLabel("Topic").fill("Delivery question");
      await customer.getByRole("textbox", { name: "Message", exact: true }).fill("Where is the receipt for the dresser?");
      await customer.getByRole("button", { name: "Send request" }).click();
      await customer.waitForURL(/\/help\/requests\/[0-9a-f-]+/);
      await expect(customer.getByRole("heading", { name: /HR-/ })).toBeVisible();
      const caseNumber = (await customer.getByRole("heading", { name: /HR-/ }).textContent()) ?? "";
      await admin.goto("/admin/help");
      await admin.getByRole("link", { name: new RegExp(caseNumber) }).click();
      await admin.getByLabel("Reply").fill("The receipt is on the job page.");
      await admin.getByRole("button", { name: "Send reply" }).click();
      await customer.reload();
      await expect(customer.getByText("The receipt is on the job page.")).toBeVisible();
      await customer.getByLabel("Reply").fill("I see it now.");
      await customer.getByRole("button", { name: "Send reply" }).click();
      await expect(customer.getByText("I see it now.")).toBeVisible();
      void supportUrl;
    }, [[admin, "help-reply"], [customer, "help-case"], [driver, "insurance-upload"]]);

    await record("10", "Alerts for the right person", "In-app alerts are listed. Push goes only to a subscribed device. SMS stays off. Email is not built.", async () => {
      if (!/^[0-9a-f-]{36}$/i.test(driverId) || !/^[0-9a-f-]{36}$/i.test(customerId)) {
        throw new Error("The driver or customer account was not created, so alerts could not be checked.");
      }
      const rows = localSql(`
        select coalesce(n.kind, '') || E'\\t' || coalesce(n.title, '') || E'\\t' ||
          case p.role when 'driver' then 'driver' when 'admin' then 'admin' else 'customer' end || E'\\t' ||
          case when n.push_sent_at is null then 'no' else 'yes' end || E'\\t' ||
          case when n.email_sent_at is null then 'no' else 'yes' end || E'\\t' ||
          case when n.sms_sent_at is null then 'no' else 'yes' end
        from public.notifications n
        join public.profiles p on p.id = n.profile_id
        where n.created_at > '${started}'
          and n.profile_id in ('${driverId}', '${customerId}')
        order by n.created_at;
      `);
      const subscriptions = localSql(`
        select count(*) from public.push_subscriptions
        where profile_id in ('${driverId}', '${customerId}');
      `).trim();
      for (const line of rows.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        const [kind, title, who, push, email, sms] = line.split("\t");
        alerts.push({
          event: `${kind || "alert"}: ${title}`,
          who,
          inApp: "✓",
          push: subscriptions === "0" ? "✓ not subscribed" : push === "yes" ? "✓" : "✗",
          email: "✗ not built",
        });
        if (sms === "yes") ux.push(`SMS was sent for “${title}”. Texting should stay off.`);
        if (email === "yes") ux.push(`Email was marked sent for “${title}” even though email verification is not built.`);
      }
      if (alerts.length === 0) throw new Error("No in-app alerts were stored for the driver or customer.");
      await driver.goto("/driver/notifications");
      await expect(driver.getByRole("heading", { name: "Your alerts" })).toBeVisible();
      await customer.goto("/account/notifications");
      await expect(customer.getByRole("heading", { name: "Your alerts" })).toBeVisible();
    }, [[driver, "alerts"], [customer, "alerts"]]);
  } finally {
    await Promise.all([
      saveVideo(driver, testInfo, "driver"),
      saveVideo(admin, testInfo, "admin"),
      saveVideo(customer, testInfo, "customer"),
    ]);
    await driverContext.close();
    await adminContext.close();
    await customerContext.close();
    writeReport();
  }

  if (failed) {
    throw new Error(`Walkthrough finished with failed steps. Open ${path.join(outDir, "index.html")}`);
  }
});

async function record(
  n: string,
  title: string,
  expected: string,
  run: () => Promise<void>,
  pages: Array<[Page, string]>,
) {
  const shots: string[] = [];
  try {
    await run();
    if (n === "08") {
      steps.push({ n, title, expected, result: "Not built", detail: "Email collection is not built.", shots });
      return;
    }
    steps.push({ n, title, expected, result: "Pass", detail: "", shots });
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 500);
    if (n === "08") {
      steps.push({
        n,
        title,
        expected,
        result: "Not built",
        detail: "Email collection is not built. Sign-in is phone and OTP. No profile email or verification screen exists, so the email checks were not run.",
        shots,
      });
    } else {
      failed = true;
      steps.push({ n, title, expected, result: "Fail", detail, shots });
    }
  } finally {
    for (const [page, name] of pages) {
      shotIndex += 1;
      const file = `${n}-${String(shotIndex).padStart(2, "0")}-${name}.png`;
      try {
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        shots.push(file);
      } catch {
        // The page may already be closed after a navigation failure.
      }
    }
  }
}

async function phoneContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    recordVideo: { dir: path.join(outDir, "video"), size: { width: 390, height: 844 } },
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);
  return context;
}

async function waitForButton(page: Page, name: string) {
  const button = page.getByRole("button", { name });
  const started = Date.now();
  await expect.poll(async () => {
    if (await button.isVisible().catch(() => false)) return true;
    const loading = await page.getByText("Loading.", { exact: true }).isVisible().catch(() => false);
    if (loading || Date.now() - started > 8_000) await page.reload();
    return false;
  }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);
}

async function signIn(page: Page, person: { phone: string; code: string; name: string }) {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.waitForFunction(
    () => {
      const field = document.querySelector("#phone");
      return Boolean(field && Object.keys(field).some((key) => key.startsWith("__react")));
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.getByLabel("Mobile number").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login") || url.pathname.startsWith("/login/name"), {
    timeout: 30_000,
  });
  if (!page.url().includes("/login/name")) return;
  const firstName = person.name.split(" ")[0] ?? person.name;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await page.getByText("An unexpected response was received from the server.").isVisible().catch(() => false)) {
      await page.reload();
    }
    await page.getByLabel("First name").fill(firstName);
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    try {
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.reload();
    }
  }
}

async function expectGeorgiaSuggestion(page: Page, query: string) {
  const field = page.getByLabel("Search pickup address");
  await field.fill("");
  await field.fill(query);
  await expect(page.locator("ul").getByRole("button").filter({ hasText: /GA/i }).first()).toBeVisible({ timeout: 15_000 });
}

async function pickAddress(page: Page, label: string, query: string): Promise<boolean> {
  await page.getByLabel(label).fill(query);
  const suggestion = page.locator("ul").getByRole("button").filter({ hasText: /Austell|GA/i }).first();
  try {
    await suggestion.waitFor({ state: "visible", timeout: 15_000 });
    await suggestion.click();
    await expect(page.getByLabel("Pickup street address")).toHaveValue(/\d/, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function badgeCount(page: Page, label: string): Promise<number> {
  const link = page.getByRole("link", { name: new RegExp(label) }).first();
  const text = (await link.textContent()) ?? "";
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

async function confirmCheckout(sessionId: string) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  const method = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
    billing_details: {
      name: "Walk Customer",
      email: "walk.customer@example.com",
      phone: "2015550123",
      address: { country: "US", postal_code: "30106" },
    },
  });
  try {
    await stripe.rawRequest("POST", `/v1/payment_pages/${sessionId}/confirm`, { payment_method: method.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/declined|card_error/i.test(message)) throw error;
  }
}

async function cron(pathname: string) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
}

async function saveVideo(page: Page, _testInfo: TestInfo, name: string) {
  const video = page.video();
  if (!video) return;
  await page.close().catch(() => undefined);
  await video.saveAs(path.join(outDir, `video-${name}.webm`)).catch(() => undefined);
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function writeReport() {
  const cards = steps
    .map((step) => {
      const images = step.shots
        .map((file) => `<figure><img src="${escapeHtml(file)}" alt=""><figcaption>${escapeHtml(file)}</figcaption></figure>`)
        .join("");
      return `<article class="${step.result === "Pass" ? "pass" : step.result === "Fail" ? "fail" : "skip"}">
        <h2>${escapeHtml(step.n)}. ${escapeHtml(step.title)} <span>${escapeHtml(step.result)}</span></h2>
        <p><strong>Expected.</strong> ${escapeHtml(step.expected)}</p>
        ${step.detail ? `<p>${escapeHtml(step.detail)}</p>` : ""}
        <div class="shots">${images}</div>
      </article>`;
    })
    .join("");
  const alertRows = alerts
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.event)}</td><td>${escapeHtml(row.who)}</td><td>${escapeHtml(row.inApp)}</td><td>${escapeHtml(row.push)}</td><td>${escapeHtml(row.email)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pickuply walkthrough</title>
<style>
  body { margin: 0; font: 16px/1.45 Georgia, serif; background: #f6f3ec; color: #14211b; }
  main { max-width: 920px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 2rem; }
  article { background: white; border-radius: 16px; padding: 16px; margin: 16px 0; }
  article span { float: right; font-weight: 700; }
  .pass span { color: #17573e; } .fail span { color: #8d1d18; } .skip span { color: #6b5a2e; }
  .shots { display: grid; gap: 12px; }
  img { width: min(100%, 390px); border: 1px solid #cfc7b8; border-radius: 12px; }
  figcaption { font-size: 0.85rem; }
  table { width: 100%; border-collapse: collapse; background: white; }
  th, td { border-bottom: 1px solid #cfc7b8; text-align: left; padding: 8px; vertical-align: top; }
  ul { padding-left: 1.2rem; }
</style>
<main>
  <h1>Pickuply walkthrough</h1>
  <p>Chromium, iPhone-sized viewport, local Stripe test mode. Synthetic automation accounts. Email collection is not built.</p>
  <h2>Steps</h2>
  ${cards || "<p>No steps were recorded.</p>"}
  <h2>UX notes</h2>
  ${ux.length ? `<ul>${ux.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : "<p>None recorded.</p>"}
  <h2>Alerts</h2>
  <p>SMS stayed off. Email is not built, so that column is “not built.” Push is a pass when nobody subscribed and nothing was sent.</p>
  <table>
    <thead><tr><th>Event</th><th>Who should get it</th><th>In-app</th><th>Push</th><th>Email</th></tr></thead>
    <tbody>${alertRows || "<tr><td colspan='5'>No alerts recorded.</td></tr>"}</tbody>
  </table>
</main>
</html>`;
  writeFileSync(path.join(outDir, "index.html"), html);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function resetPhones(phones: string[]) {
  const listed = phones.flatMap((phone) => [`'1${phone}'`, `'+1${phone}'`]).join(", ");
  localSql(`
    alter table public.job_photos disable trigger job_photos_lock;
    delete from public.job_events
    where actor_id in (select id from auth.users where phone in (${listed}))
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in (${listed}))
          or assigned_driver_id in (select id from auth.users where phone in (${listed}))
      );
    update public.jobs set accepted_offer_id = null
    where customer_id in (select id from auth.users where phone in (${listed}))
      or assigned_driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.job_offers
    where driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.job_photos
    where job_id in (select id from public.jobs where customer_id in (select id from auth.users where phone in (${listed})));
    delete from public.job_reviews
    where reviewer_id in (select id from auth.users where phone in (${listed}))
      or reviewee_id in (select id from auth.users where phone in (${listed}))
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in (${listed}))
          or assigned_driver_id in (select id from auth.users where phone in (${listed}))
      );
    delete from public.ledger_entries
    where driver_id in (select id from auth.users where phone in (${listed}))
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in (${listed}))
          or assigned_driver_id in (select id from auth.users where phone in (${listed}))
      );
    delete from public.help_messages
    where request_id in (
      select id from public.help_requests
      where profile_id in (select id from auth.users where phone in (${listed}))
        or job_id in (
          select id from public.jobs
          where customer_id in (select id from auth.users where phone in (${listed}))
            or assigned_driver_id in (select id from auth.users where phone in (${listed}))
        )
    );
    delete from public.help_requests
    where profile_id in (select id from auth.users where phone in (${listed}))
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in (${listed}))
          or assigned_driver_id in (select id from auth.users where phone in (${listed}))
      );
    delete from public.jobs
    where customer_id in (select id from auth.users where phone in (${listed}))
      or assigned_driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.vehicles where driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.drivers where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.sms_consents where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.notifications where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.message_reads
    where profile_id in (select id from auth.users where phone in (${listed}))
      or thread_id in (
        select id from public.message_threads
        where requester_id in (select id from auth.users where phone in (${listed}))
          or driver_id in (select id from auth.users where phone in (${listed}))
      );
    delete from public.message_attachments
    where created_by in (select id from auth.users where phone in (${listed}))
      or thread_id in (
        select id from public.message_threads
        where requester_id in (select id from auth.users where phone in (${listed}))
          or driver_id in (select id from auth.users where phone in (${listed}))
      );
    delete from public.messages
    where sender_id in (select id from auth.users where phone in (${listed}))
      or thread_id in (
        select id from public.message_threads
        where requester_id in (select id from auth.users where phone in (${listed}))
          or driver_id in (select id from auth.users where phone in (${listed}))
      );
    delete from public.message_threads
    where requester_id in (select id from auth.users where phone in (${listed}))
      or driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.notification_preferences where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.push_subscriptions where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.customer_places where customer_id in (select id from auth.users where phone in (${listed}));
    delete from public.offer_views where customer_id in (select id from auth.users where phone in (${listed}));
    delete from public.account_suspensions
    where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.admin_announcement_deliveries where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.audit_log
    where actor_id in (select id from auth.users where phone in (${listed}))
      or target_id in (select id from auth.users where phone in (${listed}));
    delete from public.profiles where id in (select id from auth.users where phone in (${listed}));
    delete from public.rate_limit_events;
    delete from auth.users where phone in (${listed});
    alter table public.job_photos enable trigger job_photos_lock;
  `);
}

function localSql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  );
}
