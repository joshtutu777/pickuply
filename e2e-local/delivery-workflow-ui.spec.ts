import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const password = "local-workflow-test-password";
const deliveryId = "c1900000-0000-4000-8000-000000000011";
const junkId = "c1900000-0000-4000-8000-000000000012";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a driver continues after item loaded, and junk removal stops at the pickup", async ({ browser }) => {
  const status = localStatus();
  const customer = await makeUser(status, `flow-customer-${Date.now()}@pickuply.test`);
  const driver = await makeUser(status, `flow-driver-${Date.now()}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Flow Customer', is_test = true where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Flow Driver', is_test = true where id = '${driver.id}';
    insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
    values (
      '${driver.id}', 'active',
      (select id from public.zones where slug = 'west_metro'),
      'full', array['delivery','junk']::public.job_service[], true,
      '${driver.id}/license.jpg'
    );
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
      offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
      assigned_driver_id, payment_status, is_test
    ) values (
      '${deliveryId}', '${customer.id}',
      'delivery', 'arrived', (select id from public.zones where slug = 'west_metro'),
      'Austell 30168', 'Mableton 30126', 'dresser', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed',
      7500, 7755, 6375, 1125, 255,
      '${driver.id}', 'authorized', true
    );
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
      offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
      assigned_driver_id, payment_status, is_test
    ) values (
      '${junkId}', '${customer.id}',
      'junk', 'arrived', (select id from public.zones where slug = 'west_metro'),
      'Austell 30168', 'old couch', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed',
      5000, 5150, 4250, 750, 150,
      '${driver.id}', 'authorized', true
    );
  `);

  const driverContext = await browser.newContext();
  const customerContext = await browser.newContext();
  await applySession(driverContext, status.url, driver.session);
  await applySession(customerContext, status.url, customer.session);
  const driverPage = await driverContext.newPage();
  const customerPage = await customerContext.newPage();
  try {
    await driverPage.goto(`/driver/jobs/${deliveryId}`);
    await hideDevOverlay(driverPage);
    await driverPage.locator("#proof-stage").selectOption("pickup");
    await driverPage.locator("#proof-file").setInputFiles({ name: "pickup.png", mimeType: "image/png", buffer: png });
    await driverPage.getByRole("button", { name: "Save proof" }).click();
    await expect(driverPage.getByText("Proof saved. It cannot be replaced.")).toBeVisible();
    await driverPage.getByRole("button", { name: "Item loaded" }).click();
    await expect(driverPage.getByRole("button", { name: "Proceed to drop-off" })).toBeVisible();
    await expect(driverPage.getByRole("button", { name: "Waiting for customer pickup review." })).toHaveCount(0);

    await customerPage.goto(`/jobs/${deliveryId}`);
    await expect(customerPage.getByRole("heading", { name: "Does everything look good?" })).toHaveCount(0);
    await expect(customerPage.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);

    await driverPage.getByRole("button", { name: "Proceed to drop-off" }).click();
    await expect.poll(() => localSql(`select status from public.jobs where id = '${deliveryId}'`).trim()).toBe("in_transit");

    await driverPage.goto(`/driver/jobs/${junkId}`);
    await expect(driverPage.getByRole("button", { name: "Junk removed" })).toBeVisible();
    await expect(driverPage.getByRole("button", { name: "Proceed to drop-off" })).toHaveCount(0);
    await expect(driverPage.getByRole("button", { name: "Arrived at drop-off" })).toHaveCount(0);
    await driverPage.locator("#proof-stage").selectOption("pickup");
    await driverPage.locator("#proof-file").setInputFiles({ name: "removed.png", mimeType: "image/png", buffer: png });
    await driverPage.getByRole("button", { name: "Save proof" }).click();
    await expect(driverPage.getByText("Proof saved. It cannot be replaced.")).toBeVisible();
    await driverPage.getByRole("button", { name: "Junk removed" }).click();
    await expect(driverPage.getByRole("heading", { name: "Awaiting customer confirmation" })).toBeVisible();
    await expect.poll(() => localSql(`select status || '|' || (dropoff_arrived_at is null)::text from public.jobs where id = '${junkId}'`).trim()).toBe("delivered|true");

    await customerPage.goto(`/jobs/${junkId}`);
    await expect(customerPage.getByRole("heading", { name: "Does everything look good?" })).toBeVisible();
    await expect(customerPage.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
    await expect(customerPage.getByRole("button", { name: "Report an Issue" })).toBeVisible();
  } finally {
    await driverContext.close();
    await customerContext.close();
    localSql(`
      alter table public.job_photos disable trigger job_photos_lock;
      delete from public.job_photos where job_id in ('${deliveryId}', '${junkId}');
      delete from public.job_events where job_id in ('${deliveryId}', '${junkId}');
      delete from public.notifications where job_id in ('${deliveryId}', '${junkId}');
      delete from public.jobs where id in ('${deliveryId}', '${junkId}');
      delete from public.drivers where profile_id = '${driver.id}';
      alter table public.job_photos enable trigger job_photos_lock;
    `);
    await deleteUser(status, customer.id);
    await deleteUser(status, driver.id);
  }
});

async function hideDevOverlay(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal, nextjs-portal *{pointer-events:none !important}";
    document.documentElement.appendChild(style);
  });
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
