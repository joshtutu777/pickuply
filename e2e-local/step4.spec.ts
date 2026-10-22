import { execFileSync } from "node:child_process";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

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

test("local marketplace assignment does not charge or reveal the address", async ({ browser }) => {
  resetLocalPeople();
  const stripeUrls: string[] = [];
  const customer = await signedIn(browser, people.customer, stripeUrls);
  const driver = await signedIn(browser, people.driver, stripeUrls);
  const driver2 = await signedIn(browser, people.driver2, stripeUrls);
  const admin = await signedIn(browser, people.admin, stripeUrls);

  await onboard(driver.page, people.driver.name);
  await onboard(driver2.page, people.driver2.name);
  promoteAdmin();

  await admin.page.goto("/admin/drivers");
  await admin.page.getByRole("link", { name: /Pat Driver/ }).click();
  await admin.page.getByRole("button", { name: "Approve as active" }).click();
  await admin.page.waitForURL(/saved=1/);
  await admin.page.goto("/admin/drivers");
  await admin.page.getByRole("link", { name: /Bea Driver/ }).click();
  await admin.page.getByRole("button", { name: "Approve as active" }).click();
  await admin.page.waitForURL(/saved=1/);

  const fixedId = await createRequest(customer.context, {
    description: "TEST fixed desk",
    pricing_method: "fixed",
    offer_cents: "15000",
    pickup_area: "Austell 30168",
    dropoff_area: "Lithia Springs",
    pickup_address: "100 Market Street, Austell, GA 30168",
    dropoff_address: "200 Oak Street, Lithia Springs, GA 30122",
  });
  const quoteId = await createRequest(customer.context, {
    description: "TEST quote desk",
    pricing_method: "quote",
    offer_cents: null,
    pickup_area: "Lithia Springs 30122",
    dropoff_area: "Austell",
    pickup_address: "300 Pine Street, Lithia Springs, GA 30122",
    dropoff_address: "400 Elm Street, Austell, GA 30168",
  });

  await publish(admin.page, fixedId, "fixed");
  await goOnline(driver.page);
  await goOnline(driver2.page);

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Austell 30168")).toBeVisible();
  await driver.page.goto("/driver");
  const fixedCard = driver.page.locator("li").filter({ hasText: "Austell 30168" });
  await fixedCard.getByRole("button", { name: "Accept posted price" }).click();
  await expect(fixedCard.getByText("Offer sent. The customer chooses.")).toBeVisible();

  await customer.page.goto(`/jobs/${fixedId}`);
  await customer.page.getByRole("button", { name: "Choose this driver" }).click();
  await expect(customer.page.getByRole("heading", { name: "Driver assigned" })).toBeVisible();

  await driver.page.goto(`/driver/jobs/${fixedId}`);
  await expect(driver.page.getByText("100 Market Street, Austell, GA 30168")).toBeVisible();
  await expect(driver.page.getByText("Payment: awaiting payment")).toBeVisible();

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Austell 30168")).toHaveCount(0);
  await driver2.page.goto(`/driver/jobs/${fixedId}`);
  await expect(driver2.page.getByText("100 Market Street")).toHaveCount(0);

  await publish(admin.page, quoteId, "quote");
  await customer.page.goto(`/jobs/${quoteId}`);
  await customer.page.getByRole("button", { name: "Accept quote" }).click();
  await expect(customer.page.getByRole("heading", { name: "Open for drivers" })).toBeVisible();

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Lithia Springs 30122")).toBeVisible();
  await driver.page.goto("/driver");
  const quoteCard = driver.page.locator("li").filter({ hasText: "Lithia Springs 30122" });
  await quoteCard.getByRole("button", { name: "Claim this job" }).click();
  await expect(driver.page.locator(`a[href="/driver/jobs/${quoteId}"]`)).toContainText("assigned");

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Lithia Springs 30122")).toHaveCount(0);
  await driver2.page.goto(`/driver/jobs/${quoteId}`);
  await expect(driver2.page.getByText("300 Pine Street")).toHaveCount(0);

  const fixedPayment = jobPayment(fixedId);
  const quotePayment = jobPayment(quoteId);
  expect(fixedPayment).toMatchObject({
    status: "assigned",
    payment_status: "awaiting_payment",
    due: true,
    stripe: false,
    assignees: 1,
  });
  expect(quotePayment).toMatchObject({
    status: "assigned",
    payment_status: "awaiting_payment",
    due: true,
    stripe: false,
    assignees: 1,
  });

  const blocked = await patchJob(driver.context, fixedId, { status: "en_route" });
  expect(blocked).not.toContain("en_route");
  expect(jobPayment(fixedId).status).toBe("assigned");
  expect(stripeUrls).toEqual([]);

  await customer.page.goto(`/jobs/${fixedId}`);
  const progress = customer.page.getByRole("region", { name: "Job progress" });
  await expect(progress.getByRole("listitem").filter({ hasText: "Request received" })).toBeVisible();
  await expect(progress.locator("[aria-current=step]")).toContainText("Awaiting payment");

  const messages = customer.page.getByRole("region", { name: "Messages" });
  const message = messages.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("call me at 404-555-0100");
  await expect(messages.getByText("Remove the phone number or email before sending.")).toBeVisible();
  await expect(messages.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await message.fill("Please use the side door");
  await messages.getByRole("button", { name: "Send", exact: true }).click();
  await expect(messages.getByText("Please use the side door")).toBeVisible();

  const driverMessages = driver.page.getByRole("region", { name: "Messages" });
  await driver.page.goto(`/driver/jobs/${fixedId}`);
  await expect(driverMessages.getByText("Please use the side door")).toBeVisible();
  await driverMessages.getByRole("button", { name: "I'm outside" }).click();
  await driverMessages.getByRole("button", { name: "Send" }).click();
  await expect(driverMessages.locator("li").filter({ hasText: "I'm outside" })).toBeVisible();

  await customer.page.reload();
  await expect(customer.page.getByRole("region", { name: "Messages" }).locator("li").filter({ hasText: "I'm outside" })).toBeVisible();
  await customer.page.locator("#report-category").selectOption("damaged");
  await customer.page.locator("#report-description").fill("The desk corner is cracked.");
  await customer.page.locator("#report-outcome").selectOption("repair");
  await customer.page.getByRole("button", { name: "Send report" }).click();
  await expect(customer.page.getByText("Report saved.")).toBeVisible();
  await customer.page.reload();
  await expect(customer.page.getByRole("heading", { name: "Disputed" })).toBeVisible();
  expect(jobPayment(fixedId).status).toBe("disputed");

  await customer.context.close();
  await driver.context.close();
  await driver2.context.close();
  await admin.context.close();
});

async function signedIn(
  browser: Browser,
  person: { phone: string; code: string; name: string },
  stripeUrls: string[],
) {
  const context = await browser.newContext();
  context.on("request", (request) => {
    if (request.url().toLowerCase().includes("stripe")) stripeUrls.push(new URL(request.url()).host);
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  if (page.url().includes("/login/name")) {
    await page.getByLabel("Full name").fill(person.name);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }
  return { context, page };
}

async function onboard(page: Page, name: string) {
  await page.goto("/driver/onboarding");
  await page.locator("#fullName").fill(name);
  await page.getByLabel("Home city").fill("Austell");
  await page.locator("#zone").selectOption({ label: "West Metro" });
  await page.getByLabel("Make").fill("Ford");
  await page.getByLabel("Model").fill("F150");
  await page.getByLabel("Year").fill("2018");
  await page.getByLabel("Plate").fill("TEST123");
  await page.getByLabel("Cargo length (inches)").fill("72");
  await page.getByLabel("License expiration").fill("2027-12-31");
  await page.getByLabel("Insurance expiration").fill("2027-12-31");
  await page.locator("#payoutHandle").fill("$test-driver");
  const files = page.locator("input[type=file]");
  const photo = { name: "photo.png", mimeType: "image/png", buffer: png };
  await files.nth(0).setInputFiles(photo);
  await files.nth(1).setInputFiles(photo);
  await files.nth(2).setInputFiles(photo);
  await files.nth(3).setInputFiles(photo);
  for (const label of [
    "I am an independent contractor, not an employee of Pickuply.",
    "I will follow the locked price, photograph pickup and drop-off, and refuse prohibited items.",
    "The documents and vehicle details I submit are accurate.",
    "Pay me at the Zelle or Cash App handle above. I will not take payment from the customer.",
  ]) {
    await page.getByRole("checkbox", { name: label }).check();
  }
  await page.locator("#signature").fill(name);
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/submitted=1/);
}

function promoteAdmin() {
  localSql(
    "update public.profiles p set role = 'admin' from auth.users u where p.id = u.id and u.phone in ('15555550126', '+15555550126');",
  );
}

async function createRequest(
  context: BrowserContext,
  details: {
    description: string;
    pricing_method: "fixed" | "quote";
    offer_cents: string | null;
    pickup_area: string;
    dropoff_area: string;
    pickup_address: string;
    dropoff_address: string;
  },
) {
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
        description: details.description,
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
        pricing_method: details.pricing_method,
        offer_cents: details.offer_cents,
        budget_min_cents: null,
        budget_max_cents: null,
        source: "other",
        zone_slug: "west_metro",
        pickup_area: details.pickup_area,
        dropoff_area: details.dropoff_area,
        pickup_address: details.pickup_address,
        dropoff_address: details.dropoff_address,
        customer_name: "Casey Customer",
        customer_phone: "+15555550123",
      },
    }),
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return requestId;
}

async function patchJob(context: BrowserContext, jobId: string, body: Record<string, string>) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}`,
    {
      method: "PATCH",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${await accessToken(context)}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );
  return response.text();
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
  const session = JSON.parse(decoded.startsWith("base64-")
    ? Buffer.from(decoded.slice("base64-".length), "base64url").toString("utf8")
    : decoded) as { access_token?: string };
  if (!session.access_token) throw new Error("The local session has no access token.");
  return session.access_token;
}

async function publish(page: Page, jobId: string, kind: "fixed" | "quote") {
  await page.goto(`/admin/requests/${jobId}`);
  await page.locator("#zoneId").selectOption({ label: "West Metro" });
  await page.locator("#serviceLevel").selectOption("light");
  await page.locator("#requiredVehicle").selectOption("pickup");
  if (kind === "quote") {
    await page.locator("#driverPay").fill("60");
    await page.locator("#preferredDate").fill("2026-10-30");
    await page.locator("#timeWindow").selectOption("morning");
    await page.getByRole("button", { name: "Send quote" }).click();
  } else {
    await page.getByRole("button", { name: "Approve and publish" }).click();
  }
  await page.waitForURL(/saved=1|error=/);
  await expect(page).not.toHaveURL(/error=/);
}

async function goOnline(page: Page) {
  await page.goto("/driver");
  await page.getByRole("button", { name: "You are Offline" }).click();
  await expect(page.getByRole("button", { name: "You are Online" })).toBeVisible();
}

function jobPayment(jobId: string) {
  const output = localSql(
    `select j.status || '|' || coalesce(j.payment_status, '') || '|' || (j.payment_due_at is not null)::text || '|' || (p.payment_intent_id is not null)::text || '|' || (j.assigned_driver_id is not null)::text from public.jobs j left join public.job_payments p on p.job_id = j.id where j.id = '${jobId}'`,
  );
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.includes("|"));
  if (!line) throw new Error("Could not read the local job payment row.");
  const [status, paymentStatus, due, stripe, assignees] = line.split("|").map((item) => item.trim());
  return {
    status,
    payment_status: paymentStatus,
    due: due === "true",
    stripe: stripe === "true",
    assignees: assignees === "true" ? 1 : 0,
  };
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
    delete from public.job_photos
    where job_id in (
      select id from public.jobs
      where customer_id in (select id from auth.users where phone in ${phones})
        or assigned_driver_id in (select id from auth.users where phone in ${phones})
    );
    delete from public.jobs
    where customer_id in (select id from auth.users where phone in ${phones})
      or assigned_driver_id in (select id from auth.users where phone in ${phones});
    delete from public.audit_log
    where actor_id in (select id from auth.users where phone in ${phones})
      or target_id in (select id from auth.users where phone in ${phones});
    delete from public.profiles
    where id in (select id from auth.users where phone in ${phones});
    delete from auth.users where phone in ${phones};
    alter table public.job_photos enable trigger job_photos_lock;
  `);
}

function localSql(sql: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A"],
    { encoding: "utf8", input: sql },
  );
}
