import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const password = "local-marketplace-test-password";
const dropoff = "Mableton 30126";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const secret = process.env.STRIPE_SECRET_KEY ?? "";
if (!secret.startsWith("sk_test_")) throw new Error("Stripe tests need a test secret.");
const stripe = new Stripe(secret);

test("three drivers compete and the chosen $75 offer is captured in Stripe test mode", async ({ browser }) => {
  test.setTimeout(900_000);
  const status = localStatus();
  const stamp = Date.now();
  const people = {
    customer: await makeUser(status, `mkt-customer-${stamp}@pickuply.test`),
    ada: await makeUser(status, `mkt-ada-${stamp}@pickuply.test`),
    bea: await makeUser(status, `mkt-bea-${stamp}@pickuply.test`),
    cam: await makeUser(status, `mkt-cam-${stamp}@pickuply.test`),
    admin: await makeUser(status, `mkt-admin-${stamp}@pickuply.test`),
  };
  localSql(`
    update public.profiles set is_test = true, full_name = 'Casey Customer', role = 'customer' where id = '${people.customer.id}';
    update public.profiles set is_test = true, full_name = 'Ada Driver', role = 'customer' where id = '${people.ada.id}';
    update public.profiles set is_test = true, full_name = 'Bea Driver', role = 'customer' where id = '${people.bea.id}';
    update public.profiles set is_test = true, full_name = 'Cam Driver', role = 'customer' where id = '${people.cam.id}';
    update public.profiles set is_test = false, full_name = 'Alex Admin', role = 'admin' where id = '${people.admin.id}';
  `);

  const customer = await openSession(browser, status.url, people.customer.session);
  const ada = await openSession(browser, status.url, people.ada.session);
  const bea = await openSession(browser, status.url, people.bea.session);
  const cam = await openSession(browser, status.url, people.cam.session);
  const admin = await openSession(browser, status.url, people.admin.session);
  for (const session of [customer, ada, bea, cam, admin]) session.page.setDefaultTimeout(45_000);

  try {
    await onboard(ada.page, "Ada Driver");
    await onboard(bea.page, "Bea Driver");
    await onboard(cam.page, "Cam Driver");
    for (const driver of [people.ada, people.bea, people.cam]) {
      await approve(admin.page, driver.id);
      finishChecklist(driver.id);
    }

    const jobId = await createRequest(status, people.customer.session.access_token);
    expect(localSql(`select status || '|' || coalesce(is_test::text, 'null') from public.jobs where id = '${jobId}'`).trim()).toBe("open|true");

    await offer(ada.page, "60");
    await offer(bea.page, "75");
    await offer(cam.page, "90");

    const offers = localSql(`
      select p.full_name || '|' || o.driver_amount_cents || '|' || o.platform_fee_cents || '|' || o.service_fee_cents || '|' || o.customer_total_cents || '|' || o.status
      from public.job_offers o join public.profiles p on p.id = o.driver_id
      where o.job_id = '${jobId}' order by o.customer_total_cents
    `).trim().split("\n");
    expect(offers).toEqual([
      "Ada Driver|5100|900|210|6210|active",
      "Bea Driver|6375|1125|255|7755|active",
      "Cam Driver|7650|1350|300|9300|active",
    ]);

    await customer.page.goto(`/jobs/${jobId}`);
    await dismissCookies(customer.page);
    await expect(customer.page.getByText("Ada —")).toBeVisible();
    await expect(customer.page.getByText("Total $62.10")).toBeVisible();
    await expect(customer.page.getByText("Bea —")).toBeVisible();
    await expect(customer.page.getByText("Total $77.55")).toBeVisible();
    await expect(customer.page.getByText("Cam —")).toBeVisible();
    await expect(customer.page.getByText("Total $93")).toBeVisible();
    await customer.page.getByRole("button", { name: "Choose Bea" }).click();
    await expect(customer.page.getByRole("heading", { name: "Driver assigned" })).toBeVisible();

    const assigned = localSql(`
      select j.status || '|' || j.payment_status || '|' || j.price_cents || '|' || j.driver_pay_cents || '|' || j.platform_fee_cents || '|' || j.service_fee_cents || '|' || j.assigned_driver_id
      from public.jobs j where j.id = '${jobId}'
    `).trim();
    expect(assigned).toBe(`assigned|awaiting_payment|7755|6375|1125|255|${people.bea.id}`);
    const closed = localSql(`select status from public.job_offers where job_id = '${jobId}' and driver_id <> '${people.bea.id}' order by status`).trim().split("\n");
    expect(closed.every((status) => status === "declined")).toBe(true);

    const late = await fetch(`${status.url}/rest/v1/rpc/choose_offer`, {
      method: "POST",
      headers: {
        apikey: status.anon,
        Authorization: `Bearer ${people.customer.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_offer: localSql(`select id from public.job_offers where job_id = '${jobId}' and driver_id = '${people.ada.id}'`).trim() }),
    });
    expect(late.ok).toBe(false);
    expect(localSql(`select count(*) from public.job_payments where job_id = '${jobId}'`).trim()).toBe("0");

    await ada.page.goto(`/driver/jobs/${jobId}`);
    await expect(ada.page.getByText("100 Market Street")).toHaveCount(0);
    await customer.page.getByRole("button", { name: "Confirm booking" }).click();
    await pay(customer.page, "4242424242424242");
    const authorized = await waitFor(`select payment_status || '|' || price_cents from public.jobs where id = '${jobId}'`, /^authorized\|7755$/);
    expect(authorized).toBe("authorized|7755");
    expect(localSql(`select stripe_livemode::text from public.job_payments where job_id = '${jobId}'`).trim()).toBe("false");
    expect(localSql(`select captured_cents is null from public.jobs where id = '${jobId}'`).trim()).toBe("t");
    const intentId = localSql(`select payment_intent_id from public.job_payments where job_id = '${jobId}'`).trim();
    const authorizedIntent = await stripe.paymentIntents.retrieve(intentId);
    expect(authorizedIntent.amount).toBe(7755);
    expect(authorizedIntent.amount_received).toBe(0);
    expect(authorizedIntent.capture_method).toBe("manual");
    expect(authorizedIntent.status).toBe("requires_capture");
    expect(authorizedIntent.livemode).toBe(false);

    await drive(bea.page, customer.page, jobId);
    await customer.page.getByRole("button", { name: "Confirm delivery" }).click();
    await expect(customer.page.getByRole("heading", { name: "Delivery complete" })).toBeVisible({ timeout: 60_000 });
    const finalRow = await waitFor(
      `select status || '|' || payment_status || '|' || coalesce(captured_cents::text, '') || '|' || driver_pay_cents from public.jobs where id = '${jobId}'`,
      /^completed\|captured\|7755\|6375$/,
    );
    expect(finalRow).toBe("completed|captured|7755|6375");
    const capturedIntent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge.balance_transaction"] });
    expect(capturedIntent.status).toBe("succeeded");
    expect(capturedIntent.amount_received).toBe(7755);
    const charge = capturedIntent.latest_charge;
    const balance = charge && typeof charge === "object" ? charge.balance_transaction : null;
    const stripeFee = balance && typeof balance === "object" ? balance.fee : null;
    expect(typeof stripeFee).toBe("number");
    console.log(`stripe-processing-fee-cents=${stripeFee}`);
    const ledger = localSql(`
      select status || '|' || amount_cents::text || '|' || coalesce(hold_reason, '') || '|' || (stripe_transfer_id is not null)::text
      from public.ledger_entries where job_id = '${jobId}'
    `).trim();
    console.log(`ledger=${ledger}`);
    const ledgerLines = ledger.split(/\n/).filter(Boolean);
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0]?.split("|")[1]).toBe("6375");
    await bea.page.goto(`/driver/jobs/${jobId}`);
    await expect(bea.page.getByRole("heading", { name: "Delivery complete" })).toBeVisible();
    await admin.page.goto(`/admin/requests/${jobId}`);
    await expect(admin.page.getByText("Completed")).toBeVisible();
  } finally {
    await customer.context.close();
    await ada.context.close();
    await bea.context.close();
    await cam.context.close();
    await admin.context.close();
    for (const person of Object.values(people)) await deleteUser(status, person.id);
  }
});

async function dismissCookies(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal, nextjs-portal *{pointer-events:none !important}";
    document.documentElement.appendChild(style);
  }).catch(() => undefined);
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

async function onboard(page: Page, name: string) {
  await page.goto("/driver/onboarding");
  await dismissCookies(page);
  const nameParts = name.trim().split(/\s+/);
  await page.getByLabel("First name").fill(nameParts[0] ?? "");
  await page.getByLabel("Last name").fill(nameParts.slice(1).join(" "));
  const email = page.getByLabel("Email address");
  if ((await email.inputValue()) === "") await email.fill(`${name.toLowerCase().replace(/\s+/g, ".")}@pickuply.test`);
  await page.getByLabel("Street").fill("10 Test Street");
  await page.getByLabel("City", { exact: true }).fill("Austell");
  await page.getByLabel("ZIP", { exact: true }).fill("30106");
  await page.locator("#coverage-city").selectOption("Austell");
  await page.locator("#vehicleType").selectOption("pickup");
  await page.getByRole("radio", { name: "Light load" }).check();
  await page.locator("#licenseExpires").fill("2027-12-31");
  const photo = { name: "photo.png", mimeType: "image/png", buffer: png };
  await page.locator("#profilePhoto").setInputFiles(photo);
  await page.locator("#licensePhoto").setInputFiles(photo);
  await page.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
  await page.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/driver\?saved=applied|\/account\?error=forbidden/, { timeout: 60_000 });
}

async function approve(page: Page, driverId: string) {
  await page.goto(`/admin/drivers/${driverId}`);
  await dismissCookies(page);
  const anyway = page.locator("input[name='approveAnyway']");
  if (await anyway.count()) await anyway.check();
  await page.getByRole("button", { name: "Approve driver" }).click();
  await page.waitForURL(/tracked=approved|saved=1/);
}

function finishChecklist(driverId: string) {
  localSql(`
    update public.drivers
    set insurance_url = profile_id::text || '/insurance.jpg',
        insurance_expires = '2027-12-31',
        agreement_signed_at = now(),
        agreement_signature = 'signed',
        agreement_version = '2026-10',
        training_completed_at = now(),
        services = '{delivery}',
        kit_saved_at = now(),
        is_online = true
    where profile_id = '${driverId}';
    update public.vehicles
    set make = 'Ford', model = 'F150', year = 2018, plate = 'TEST123',
        cargo_length_in = 72, photo_url = driver_id::text || '/vehicle.jpg', approved = true
    where driver_id = '${driverId}';
  `);
}

async function offer(page: Page, dollars: string) {
  await page.goto("/driver");
  await dismissCookies(page);
  const terms = page.getByRole("button", { name: "Review and accept the updated Driver Terms" });
  if (await terms.isVisible().catch(() => false)) {
    await terms.click();
    await page.waitForURL(/saved=terms/);
  }
  const offline = page.getByRole("switch", { name: "You are Offline" });
  if (await offline.isVisible().catch(() => false)) await offline.click();
  const card = page.locator("li").filter({ hasText: dropoff }).first();
  await expect(card).toBeVisible();
  await card.getByLabel(/Offer Amount/).fill(dollars);
  await card.getByRole("button", { name: "Submit Offer" }).click();
  await card.getByRole("button", { name: "Confirm offer" }).click();
  await expect(card.getByText(/Offer submitted successfully/)).toBeVisible();
}

async function createRequest(status: { url: string; anon: string }, accessToken: string) {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${status.url}/rest/v1/rpc/create_customer_request`, {
    method: "POST",
    headers: {
      apikey: status.anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: requestId,
      payload: {
        service: "delivery",
        description: "TEST three driver sofa",
        pieces: "1",
        size: "medium",
        item_value_cents: "0",
        already_paid: false,
        seller_holding: true,
        wants_item_check: false,
        stairs_pickup: "0",
        stairs_dropoff: "0",
        elevator: false,
        help_loading: true,
        preferred_date: "asap",
        pricing_method: "range",
        offer_cents: null,
        budget_min_cents: "3500",
        budget_max_cents: "20000",
        source: "facebook",
        zone_slug: "west_metro",
        pickup_area: "Austell 30168",
        dropoff_area: dropoff,
        pickup_address: "100 Market Street, Austell, GA 30168",
        dropoff_address: "200 Oak Street, Mableton, GA 30126",
        customer_name: "Casey Customer",
        customer_phone: "+15555550123",
      },
    }),
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return requestId;
}

async function pay(page: Page, number: string) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.locator("#cardNumber").fill(number);
  await page.locator("#cardExpiry").fill("1234");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Casey Customer");
  await page.locator("#billingPostalCode").fill("30168");
  await page.locator("button[type='submit']").click();
  await page.waitForURL(/\/jobs\//, { timeout: 90_000 });
}

async function drive(driver: Page, customer: Page, jobId: string) {
  await driver.goto(`/driver/jobs/${jobId}`);
  await dismissCookies(driver);
  await driver.getByRole("button", { name: "Start trip", exact: true }).click();
  await driver.getByRole("button", { name: "Arrived at pickup" }).click();
  await saveProof(driver, "pickup");
  await driver.getByRole("button", { name: "Item loaded" }).click();
  await waitFor(`select status from public.jobs where id = '${jobId}'`, /^item_check$/);
  await driver.getByRole("button", { name: "Proceed to drop-off" }).click();
  await waitFor(`select status from public.jobs where id = '${jobId}'`, /^in_transit$/);
  await driver.goto(`/driver/jobs/${jobId}`);
  await driver.getByRole("button", { name: "Arrived at drop-off" }).click();
  await saveProof(driver, "dropoff");
  await driver.getByRole("button", { name: "Delivered" }).click();
  await waitFor(`select status from public.jobs where id = '${jobId}'`, /^delivered$/);
  await customer.goto(`/jobs/${jobId}`);
  await expect(customer.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expect(customer.getByRole("heading", { name: "Does everything look good?" })).toBeVisible();
}

async function saveProof(page: Page, stage: "pickup" | "dropoff") {
  await page.locator("#proof-stage").selectOption(stage);
  await page.locator("#proof-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Save proof" }).click();
  await expect(page.getByText("Proof saved. It cannot be replaced.")).toBeVisible();
}

async function waitFor(sql: string, pattern: RegExp) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 45_000) {
    last = localSql(sql).trim();
    if (pattern.test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${pattern}. Last row: ${last}`);
}

async function openSession(
  browser: Browser,
  apiUrl: string,
  session: { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; token_type: string; user: unknown },
) {
  const context = await browser.newContext();
  const key = `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const chunks: { name: string; value: string }[] = [];
  const expanded = encodeURIComponent(encoded);
  if (expanded.length <= 3180) chunks.push({ name: key, value: encoded });
  else {
    let rest = expanded;
    let index = 0;
    while (rest.length > 0) {
      const head = rest.slice(0, 3180);
      chunks.push({ name: `${key}.${index}`, value: decodeURIComponent(head) });
      rest = rest.slice(head.length);
      index += 1;
    }
  }
  await context.addCookies(chunks.map((chunk) => ({ name: chunk.name, value: chunk.value, url: "http://localhost:3000" })));
  const page = await context.newPage();
  return { context, page };
}

async function makeUser(status: { url: string; anon: string; service: string }, email: string) {
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "Could not create the local user.");
  const client = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(signed.error?.message ?? "Could not sign in the local user.");
  return { id: created.data.user.id, session: signed.data.session };
}

async function deleteUser(status: { url: string; service: string }, id: string) {
  try {
    localSql(`
      alter table public.job_photos disable trigger job_photos_lock;
      update public.jobs set accepted_offer_id = null where customer_id = '${id}' or assigned_driver_id = '${id}';
      delete from public.job_events where actor_id = '${id}' or job_id in (select id from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}');
      delete from public.job_offers where driver_id = '${id}' or job_id in (select id from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}');
      delete from public.ledger_entries where job_id in (select id from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}');
      delete from public.job_payments where job_id in (select id from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}');
      delete from public.job_photos where job_id in (select id from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}');
      delete from public.job_private where job_id in (select id from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}');
      delete from public.notifications where profile_id = '${id}';
      delete from public.audit_log where actor_id = '${id}' or target_id = '${id}';
      delete from public.vehicles where driver_id = '${id}';
      delete from public.jobs where customer_id = '${id}' or assigned_driver_id = '${id}';
      delete from public.drivers where profile_id = '${id}';
      delete from public.profiles where id = '${id}';
      alter table public.job_photos enable trigger job_photos_lock;
    `);
    const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
    await admin.auth.admin.deleteUser(id);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

function localStatus() {
  const text = execFileSync("npx supabase status -o env", { encoding: "utf8", shell: true });
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values.set(line.slice(0, eq), line.slice(eq + 1).replace(/^"|"$/g, ""));
  }
  const url = values.get("API_URL") ?? "";
  const anon = values.get("ANON_KEY") ?? "";
  const service = values.get("SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) throw new Error("Local Supabase is not ready.");
  return { url, anon, service };
}

function localSql(sql: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  );
}
