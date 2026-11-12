import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const password = "local-finance-test-password";
const ids = {
  delivery: "c1910000-0000-4000-8000-000000000011",
  junk: "c1910000-0000-4000-8000-000000000012",
  disputeDelivery: "c1910000-0000-4000-8000-000000000013",
  disputeJunk: "c1910000-0000-4000-8000-000000000014",
  autoDelivery: "c1910000-0000-4000-8000-000000000015",
  autoJunk: "c1910000-0000-4000-8000-000000000016",
  early: "c1910000-0000-4000-8000-000000000017",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("delivery and junk captures stay single, blocked, or timed", async ({ browser }) => {
  test.setTimeout(360_000);
  const status = localStatus();
  const stripe = new Stripe(stripeSecret());
  const created: { id: string }[] = [];
  const intents: Stripe.PaymentIntent[] = [];
  let customer = { id: "", session: { access_token: "", refresh_token: "", expires_in: 0, token_type: "bearer", user: null as unknown } };
  let driver = { ...customer };
  let other = { ...customer };
  let admin = { ...customer };
  try {
  customer = await makeUser(status, `fin-customer-${Date.now()}@pickuply.test`);
  created.push(customer);
  driver = await makeUser(status, `fin-driver-${Date.now()}@pickuply.test`);
  other = await makeUser(status, `fin-other-${Date.now()}@pickuply.test`);
  admin = await makeUser(status, `fin-admin-${Date.now()}@pickuply.test`);
  created.push(driver, other, admin);

  const deliveryPay = await authorize(stripe, 7755);
  const junkPay = await authorize(stripe, 5180);
  const disputeDeliveryPay = await authorize(stripe, 7755);
  const disputeJunkPay = await authorize(stripe, 5180);
  const autoDeliveryPay = await authorize(stripe, 7755);
  const autoJunkPay = await authorize(stripe, 5180);
  const earlyPay = await authorize(stripe, 7755);
  intents.push(deliveryPay, junkPay, disputeDeliveryPay, disputeJunkPay, autoDeliveryPay, autoJunkPay, earlyPay);
  const evidence: Record<string, string> = {
    delivery_payment_intent: deliveryPay.id,
    junk_payment_intent: junkPay.id,
    dispute_delivery_payment_intent: disputeDeliveryPay.id,
    dispute_junk_payment_intent: disputeJunkPay.id,
    auto_delivery_payment_intent: autoDeliveryPay.id,
    auto_junk_payment_intent: autoJunkPay.id,
    early_payment_intent: earlyPay.id,
  };
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/financial-validation.json", JSON.stringify(evidence, null, 2));

  localSql(`
    update public.profiles set role = 'customer', full_name = 'Fin Customer', is_test = true where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Fin Driver', is_test = true where id = '${driver.id}';
    update public.profiles set role = 'driver', full_name = 'Fin Other', is_test = true where id = '${other.id}';
    update public.profiles set role = 'admin', full_name = 'Fin Admin', is_test = false where id = '${admin.id}';
    insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
    values (
      '${driver.id}', 'active',
      (select id from public.zones where slug = 'west_metro'),
      'full', array['delivery','junk']::public.job_service[], true,
      '${driver.id}/license.jpg'
    );
  `);
  insertJob({
    id: ids.delivery,
    customerId: customer.id,
    driverId: driver.id,
    service: "delivery",
    status: "arrived",
    price: 7755,
    driverPay: 6375,
    platform: 1125,
    fee: 255,
    offer: 7500,
    dropoff: "Mableton 30126",
    intent: deliveryPay.id,
  });
  insertJob({
    id: ids.junk,
    customerId: customer.id,
    driverId: driver.id,
    service: "junk",
    status: "arrived",
    price: 5180,
    driverPay: 4250,
    platform: 750,
    fee: 180,
    offer: 5000,
    dropoff: null,
    intent: junkPay.id,
  });
  insertJob({
    id: ids.disputeDelivery,
    customerId: customer.id,
    driverId: driver.id,
    service: "delivery",
    status: "delivered",
    price: 7755,
    driverPay: 6375,
    platform: 1125,
    fee: 255,
    offer: 7500,
    dropoff: "Mableton 30126",
    intent: disputeDeliveryPay.id,
    delivered: true,
    dropoffArrived: true,
  });
  insertJob({
    id: ids.disputeJunk,
    customerId: customer.id,
    driverId: driver.id,
    service: "junk",
    status: "delivered",
    price: 5180,
    driverPay: 4250,
    platform: 750,
    fee: 180,
    offer: 5000,
    dropoff: null,
    intent: disputeJunkPay.id,
    delivered: true,
  });
  insertJob({
    id: ids.autoDelivery,
    customerId: customer.id,
    driverId: driver.id,
    service: "delivery",
    status: "delivered",
    price: 7755,
    driverPay: 6375,
    platform: 1125,
    fee: 255,
    offer: 7500,
    dropoff: "Mableton 30126",
    intent: autoDeliveryPay.id,
    delivered: true,
    dropoffArrived: true,
  });
  insertJob({
    id: ids.autoJunk,
    customerId: customer.id,
    driverId: driver.id,
    service: "junk",
    status: "delivered",
    price: 5180,
    driverPay: 4250,
    platform: 750,
    fee: 180,
    offer: 5000,
    dropoff: null,
    intent: autoJunkPay.id,
    delivered: true,
  });
  insertJob({
    id: ids.early,
    customerId: customer.id,
    driverId: driver.id,
    service: "delivery",
    status: "item_check",
    price: 7755,
    driverPay: 6375,
    platform: 1125,
    fee: 255,
    offer: 7500,
    dropoff: "Mableton 30126",
    intent: earlyPay.id,
  });

  const driverContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const adminContext = await browser.newContext();
    await applySession(driverContext, status.url, driver.session);
    await applySession(customerContext, status.url, customer.session);
    await applySession(otherContext, status.url, other.session);
    await applySession(adminContext, status.url, admin.session);
    const driverPage = await driverContext.newPage();
    const customerPage = await customerContext.newPage();
    const otherPage = await otherContext.newPage();
    const adminPage = await adminContext.newPage();

    await driveDelivery(driverPage, ids.delivery);
    await customerPage.goto(`/jobs/${ids.delivery}`);
    await dismissCookies(customerPage);
    await expect(customerPage.getByRole("heading", { name: "Does everything look good?" })).toBeVisible();
    await expect(customerPage.getByRole("img", { name: "Drop-off proof" })).toBeVisible();
    await customerPage.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(customerPage.getByRole("heading", { name: "Delivery complete" })).toBeVisible();
    await expect(customerPage.getByText("Total $77.55").first()).toBeVisible();
    const deliveryRow = await waitRow(
      `select status || '|' || payment_status || '|' || captured_cents || '|' || driver_pay_cents || '|' || platform_fee_cents || '|' || service_fee_cents from public.jobs where id = '${ids.delivery}'`,
      /^completed\|captured\|7755\|6375\|1125\|255$/,
    );
    evidence.deliveryJob = deliveryRow;

    await driveJunk(driverPage, ids.junk);
    await customerPage.goto(`/jobs/${ids.junk}`);
    await expect(customerPage.getByRole("heading", { name: "Does everything look good?" })).toBeVisible();
    await expect(customerPage.getByRole("img", { name: "Completion photo" })).toBeVisible();
    await customerPage.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(customerPage.getByRole("heading", { name: "Removal complete" })).toBeVisible();
    await expect(customerPage.getByText("Total $51.80").first()).toBeVisible();
    evidence.junkJob = await waitRow(
      `select status || '|' || payment_status || '|' || captured_cents || '|' || driver_pay_cents || '|' || platform_fee_cents || '|' || service_fee_cents from public.jobs where id = '${ids.junk}'`,
      /^completed\|captured\|5180\|4250\|750\|180$/,
    );

    const deliveryIntent = await stripe.paymentIntents.retrieve(deliveryPay.id);
    const junkIntent = await stripe.paymentIntents.retrieve(junkPay.id);
    expect(deliveryIntent.status).toBe("succeeded");
    expect(junkIntent.status).toBe("succeeded");
    expect(deliveryIntent.livemode).toBe(false);
    expect(junkIntent.livemode).toBe(false);
    expect(deliveryIntent.amount_received).toBe(7755);
    expect(junkIntent.amount_received).toBe(5180);
    evidence.deliveryPaymentIntent = deliveryIntent.id;
    evidence.junkPaymentIntent = junkIntent.id;
    evidence.deliveryCharge = String(deliveryIntent.latest_charge);
    evidence.junkCharge = String(junkIntent.latest_charge);

    evidence.deliveryLedger = ledgerLine(ids.delivery, 6375);
    evidence.junkLedger = ledgerLine(ids.junk, 4250);
    writeFileSync("test-results/financial-validation.json", JSON.stringify(evidence, null, 2));

    await driverPage.goto("/driver/earnings");
    await expect(driverPage.getByText("Held").first()).toBeVisible();
    await expect(driverPage.getByText("$106.25").first()).toBeVisible();
    await expect(driverPage.getByText("Eligible for transfer")).toBeVisible();
    await expect(driverPage.getByText("Eligible for transfer").locator("xpath=following-sibling::p[1]")).toHaveText("$0");

    await customerPage.goto("/account/jobs");
    await dismissCookies(customerPage);
    await hideDevOverlay(customerPage);
    await customerPage.getByRole("tab", { name: /History/ }).click();
    const history = customerPage.locator("[id='My deliveries-history-panel']");
    await expect(history).toBeVisible();
    await expect(history.getByText("Total $77.55").first()).toBeVisible();
    await expect(history.getByText("Total $51.80").first()).toBeVisible();

    await driverPage.goto(`/driver/jobs/${ids.delivery}`);
    await expect(driverPage.getByRole("heading", { name: "Delivery complete" })).toBeVisible();
    await expect(driverPage.getByText("Earnings for this job $63.75").first()).toBeVisible();
    await expect(driverPage.getByText("Earnings status: Held").first()).toBeVisible();
    await driverPage.locator("summary", { hasText: "Photos" }).click();
    await expect(driverPage.getByRole("img", { name: "dropoff proof" })).toBeVisible();
    await driverPage.goto(`/driver/jobs/${ids.junk}`);
    await expect(driverPage.getByRole("heading", { name: "Removal complete" })).toBeVisible();
    await expect(driverPage.getByText("Earnings for this job $42.50").first()).toBeVisible();

    await customerPage.goto(`/jobs/${ids.delivery}`);
    await customerPage.getByRole("tab", { name: "Details" }).click();
    await expect(customerPage.getByRole("img", { name: "pickup proof" })).toBeVisible();
    await expect(customerPage.getByRole("img", { name: "dropoff proof" })).toBeVisible();

    await otherPage.goto(`/driver/jobs/${ids.delivery}`);
    await expect(otherPage.getByText("This page could not be found.")).toBeVisible();
    const otherClient = userClient(status, other.session.access_token);
    const otherPhotos = await otherClient.from("job_photos").select("id").eq("job_id", ids.delivery);
    expect(otherPhotos.data ?? []).toHaveLength(0);

    const customerClient = userClient(status, customer.session.access_token);
    const customerPhotos = await customerClient.from("job_photos").select("id").eq("job_id", ids.delivery);
    expect((customerPhotos.data ?? []).length).toBeGreaterThanOrEqual(2);
    const driverClient = userClient(status, driver.session.access_token);
    const driverPhotos = await driverClient.from("job_photos").select("id").eq("job_id", ids.junk);
    expect((driverPhotos.data ?? []).length).toBeGreaterThanOrEqual(1);

    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await adminPage.goto(`/admin/requests/${ids.delivery}`);
    await dismissCookies(adminPage);
    await expect(adminPage.getByText("Completed · fixed")).toBeVisible();
    const adminClient = userClient(status, admin.session.access_token);
    const adminPhotos = await adminClient.from("job_photos").select("storage_path, stage").eq("job_id", ids.delivery);
    const adminStages = (adminPhotos.data ?? []).map((photo) => photo.stage).sort();
    expect(adminStages).toEqual(["dropoff", "pickup"]);
    const adminSigned = await adminClient.storage.from("job-photos").createSignedUrl(adminPhotos.data?.[0]?.storage_path ?? "", 60);
    expect(adminSigned.error).toBeNull();
    expect(adminSigned.data?.signedUrl ?? "").toMatch(/^https?:\/\//);
    evidence.adminProofStages = adminStages.join(",");
    evidence.adminRequestPageImages = String(await adminPage.locator("img").count());
    await adminPage.goto("/admin/finance?includeTest=1&tab=payments");
    await expect(adminPage.getByText("$77.55").first()).toBeVisible();
    await expect(adminPage.getByText("$51.80").first()).toBeVisible();

    localSql(`
      insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
      values
        ('c1910000-0000-4000-8000-000000000031', '${ids.disputeDelivery}', '${customer.id}', 'other', 'The item is damaged.', 'note'),
        ('c1910000-0000-4000-8000-000000000032', '${ids.disputeJunk}', '${customer.id}', 'other', 'The junk is still there.', 'note');
      insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
      values
        ('${ids.disputeDelivery}', 'c1910000-0000-4000-8000-000000000031', true, true),
        ('${ids.disputeJunk}', 'c1910000-0000-4000-8000-000000000032', true, true);
    `);
    await customerPage.goto(`/jobs/${ids.disputeDelivery}`);
    await dismissCookies(customerPage);
    await customerPage.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(customerPage.getByText("payment is on hold").first()).toBeVisible();
    await customerPage.goto(`/jobs/${ids.disputeJunk}`);
    await dismissCookies(customerPage);
    await customerPage.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(customerPage.getByText("payment is on hold").first()).toBeVisible();
    expect((await stripe.paymentIntents.retrieve(disputeDeliveryPay.id)).status).toBe("requires_capture");
    expect((await stripe.paymentIntents.retrieve(disputeJunkPay.id)).status).toBe("requires_capture");
    evidence.disputeDelivery = `${disputeDeliveryPay.id}|requires_capture`;
    evidence.disputeJunk = `${disputeJunkPay.id}|requires_capture`;

    expect(contextKind(ids.autoDelivery)).toBe("");
    expect(contextKind(ids.autoJunk)).toBe("");
    expect(contextKind(ids.early)).toBe("");
    localSql(`
      update public.jobs set updated_at = now() - interval '48 hours' where id = '${ids.early}';
      update public.jobs set delivered_at = now() - interval '25 hours' where id in ('${ids.autoDelivery}', '${ids.autoJunk}');
    `);
    expect(contextKind(ids.early)).toBe("");
    expect(contextKind(ids.autoDelivery)).toBe("full");
    expect(contextKind(ids.autoJunk)).toBe("full");
    const ready = localSql("select coalesce(string_agg(job_id::text, ','), '') from public.jobs_ready_for_capture()").trim();
    const readyIds = new Set(ready ? ready.split(",") : []);
    expect(readyIds.has(ids.autoDelivery)).toBe(true);
    expect(readyIds.has(ids.autoJunk)).toBe(true);
    expect(readyIds.has(ids.early)).toBe(false);
    expect(readyIds.has(ids.disputeDelivery)).toBe(false);
    expect(readyIds.has(ids.disputeJunk)).toBe(false);
    expect([...readyIds].every((id) => id === ids.autoDelivery || id === ids.autoJunk)).toBe(true);
    evidence.readyForCapture = [...readyIds].sort().join(",");
    const cron = await fetch(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3001"}/api/cron/auto-complete`, {
      headers: { authorization: `Bearer ${cronSecret()}` },
    });
    expect(cron.status).toBe(200);
    evidence.autoDelivery = await waitRow(
      `select status || '|' || payment_status || '|' || captured_cents from public.jobs where id = '${ids.autoDelivery}'`,
      /^completed\|captured\|7755$/,
    );
    evidence.autoJunk = await waitRow(
      `select status || '|' || payment_status || '|' || captured_cents from public.jobs where id = '${ids.autoJunk}'`,
      /^completed\|captured\|5180$/,
    );
    const autoDeliveryIntent = await stripe.paymentIntents.retrieve(autoDeliveryPay.id);
    const autoJunkIntent = await stripe.paymentIntents.retrieve(autoJunkPay.id);
    expect(autoDeliveryIntent.amount_received).toBe(7755);
    expect(autoJunkIntent.amount_received).toBe(5180);
    expect(autoDeliveryIntent.livemode).toBe(false);
    evidence.autoDeliveryPaymentIntent = autoDeliveryIntent.id;
    evidence.autoJunkPaymentIntent = autoJunkIntent.id;
    evidence.autoDeliveryCharge = String(autoDeliveryIntent.latest_charge);
    evidence.autoJunkCharge = String(autoJunkIntent.latest_charge);
    evidence.autoDeliveryLedger = ledgerLine(ids.autoDelivery, 6375);
    evidence.autoJunkLedger = ledgerLine(ids.autoJunk, 4250);
    expect((await stripe.paymentIntents.retrieve(disputeDeliveryPay.id)).status).toBe("requires_capture");

    const secondConfirm = await customerClient.rpc("confirm_delivery", { target_job: ids.delivery });
    expect(secondConfirm.error?.message ?? "").toMatch(/not delivered yet|already/i);
    const service = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
    const secondRecord = await service.rpc("record_capture", {
      target_job: ids.delivery,
      amount_cents: 7755,
      kind: "full",
      stripe_fee: 255,
    });
    expect(secondRecord.error).toBeNull();
    await stripe.paymentIntents.capture(deliveryPay.id, {}, { idempotencyKey: `capture:${deliveryPay.id}:full` });
    const charges = await stripe.charges.list({ payment_intent: deliveryPay.id, limit: 10 });
    expect(charges.data.filter((charge) => charge.paid)).toHaveLength(1);
    expect(localSql(`select count(*) from public.ledger_entries where job_id = '${ids.delivery}'`).trim()).toBe("1");
    expect(localSql(`select count(*) from public.job_events where job_id = '${ids.delivery}' and type = 'payment_captured'`).trim()).toBe("1");
    expect(localSql(`select count(*) from public.ledger_entries where job_id = '${ids.junk}'`).trim()).toBe("1");
    expect((await stripe.paymentIntents.retrieve(deliveryPay.id)).amount_received).toBe(7755);

    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/financial-validation.json", JSON.stringify(evidence, null, 2));
  } finally {
    for (const intent of intents) {
      const current = await stripe.paymentIntents.retrieve(intent.id);
      if (current.status === "requires_capture") await stripe.paymentIntents.cancel(intent.id);
    }
    const jobList = Object.values(ids).map((id) => `'${id}'`).join(",");
    const people = created.map((person) => `'${person.id}'`).filter((id) => id !== "''").join(",");
    try {
      localSql(`
        alter table public.job_photos disable trigger job_photos_lock;
        delete from public.job_disputes where job_id in (${jobList});
        delete from public.job_reports where job_id in (${jobList});
        delete from public.job_photos where job_id in (${jobList});
        delete from public.job_events where job_id in (${jobList});
        delete from public.notifications where job_id in (${jobList});
        delete from public.ledger_entries where job_id in (${jobList});
        delete from public.jobs where id in (${jobList});
        delete from public.drivers where profile_id = '${driver.id}';
        ${people ? `delete from public.audit_log where actor_id in (${people});` : ""}
      `);
    } finally {
      localSql("alter table public.job_photos enable trigger job_photos_lock;");
    }
    for (const person of created) {
      if (person.id) await deleteUser(status, person.id);
    }
  }
});

function insertJob(input: {
  id: string;
  customerId: string;
  driverId: string;
  service: "delivery" | "junk";
  status: string;
  price: number;
  driverPay: number;
  platform: number;
  fee: number;
  offer: number;
  dropoff: string | null;
  intent: string;
  delivered?: boolean;
  dropoffArrived?: boolean;
}) {
  localSql(`
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
      offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
      assigned_driver_id, payment_status, is_test, delivered_at, dropoff_arrived_at
    ) values (
      '${input.id}', '${input.customerId}', '${input.service}', '${input.status}',
      (select id from public.zones where slug = 'west_metro'),
      'Austell 30168', ${input.dropoff ? `'${input.dropoff}'` : "null"}, '${input.service} validation', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed',
      ${input.offer}, ${input.price}, ${input.driverPay}, ${input.platform}, ${input.fee},
      '${input.driverId}', 'authorized', true,
      ${input.delivered ? "now()" : "null"},
      ${input.dropoffArrived ? "now()" : "null"}
    );
    insert into public.job_payments (job_id, payment_intent_id, stripe_livemode)
    values ('${input.id}', '${input.intent}', false);
  `);
}

async function driveDelivery(page: Page, jobId: string) {
  await page.goto(`/driver/jobs/${jobId}`);
  await dismissCookies(page);
  await hideDevOverlay(page);
  await saveProof(page, "pickup");
  await page.getByRole("button", { name: "Item loaded" }).click();
  await page.getByRole("button", { name: "Proceed to drop-off" }).click();
  await page.getByRole("button", { name: "Arrived at drop-off" }).click();
  await saveProof(page, "dropoff");
  await page.getByRole("button", { name: "Delivered" }).click();
  await expect(page.getByRole("heading", { name: "Awaiting customer confirmation" })).toBeVisible();
}

async function driveJunk(page: Page, jobId: string) {
  await page.goto(`/driver/jobs/${jobId}`);
  await hideDevOverlay(page);
  await saveProof(page, "pickup");
  await page.getByRole("button", { name: "Junk removed" }).click();
  await expect(page.getByRole("heading", { name: "Awaiting customer confirmation" })).toBeVisible();
}

async function saveProof(page: Page, stage: "pickup" | "dropoff") {
  await page.locator("#proof-stage").selectOption(stage);
  await page.locator("#proof-file").setInputFiles({ name: `${stage}.png`, mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Save proof" }).click();
  await expect(page.getByText("Proof saved. It cannot be replaced.")).toBeVisible();
}

async function dismissCookies(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Optional cookies" });
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Reject optional cookies" }).click();
  }
}

async function hideDevOverlay(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal, nextjs-portal *{pointer-events:none !important}";
    document.documentElement.appendChild(style);
  });
}

function contextKind(jobId: string) {
  return localSql(`select coalesce(public.capture_context('${jobId}')->>'kind', '')`).trim();
}

function ledgerLine(jobId: string, amount: number) {
  const line = localSql(
    `select status || '|' || amount_cents || '|' || coalesce(stripe_transfer_id, 'none') || '|' || hold_reason from public.ledger_entries where job_id = '${jobId}'`,
  ).trim();
  expect(line).toBe(`held_until_onboarding|${amount}|none|Finish payout setup before a transfer can be sent`);
  return line;
}

async function waitRow(sql: string, pattern: RegExp) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 45_000) {
    last = localSql(sql).trim();
    if (pattern.test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${pattern}. Last row: ${last}`);
}

async function authorize(stripe: Stripe, amount: number) {
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    capture_method: "manual",
    payment_method: "pm_card_visa",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    confirm: true,
  });
  if (intent.status !== "requires_capture" || intent.livemode) {
    throw new Error("Stripe did not leave a test authorization waiting for capture.");
  }
  return intent;
}

function envValue(name: string): string {
  const text = readFileSync(".env.test.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0 || body.slice(0, eq).trim() !== name) continue;
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

function stripeSecret() {
  const value = envValue("STRIPE_SECRET_KEY");
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    throw new Error("Payment tests must use the local Supabase URL.");
  }
  if (!value.startsWith("sk_test_")) throw new Error("Stripe test mode is not configured.");
  return value;
}

function cronSecret() {
  const value = process.env.CRON_SECRET || envValue("CRON_SECRET");
  if (!value) throw new Error("Local cron secret is not configured.");
  return value;
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
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  await admin.auth.admin.deleteUser(id);
}

function userClient(status: { url: string; anon: string }, accessToken: string): SupabaseClient {
  return createClient(status.url, status.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function applySession(
  context: BrowserContext,
  apiUrl: string,
  session: { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; token_type: string; user: unknown },
) {
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
  const port = process.env.PLAYWRIGHT_PORT ?? "3001";
  await context.addCookies(chunks.map((chunk) => ({ name: chunk.name, value: chunk.value, url: `http://127.0.0.1:${port}` })));
}
