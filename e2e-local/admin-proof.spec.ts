import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const password = "local-proof-test-password";
const ids = {
  delivery: "c1920000-0000-4000-8000-000000000021",
  junk: "c1920000-0000-4000-8000-000000000022",
  dispute: "c1920000-0000-4000-8000-000000000023",
  empty: "c1920000-0000-4000-8000-000000000024",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("an admin can see delivery proof, and other people cannot", async ({ browser }) => {
  test.setTimeout(180_000);
  const status = localStatus();
  const created: { id: string }[] = [];
  const paths: string[] = [];
  let customer = blankUser();
  let stranger = blankUser();
  let driver = blankUser();
  let other = blankUser();
  let admin = blankUser();
  try {
    customer = await makeUser(status, `proof-customer-${Date.now()}@pickuply.test`);
    stranger = await makeUser(status, `proof-stranger-${Date.now()}@pickuply.test`);
    driver = await makeUser(status, `proof-driver-${Date.now()}@pickuply.test`);
    other = await makeUser(status, `proof-other-${Date.now()}@pickuply.test`);
    admin = await makeUser(status, `proof-admin-${Date.now()}@pickuply.test`);
    created.push(customer, stranger, driver, other, admin);
    localSql(`
      update public.profiles set role = 'customer', full_name = 'Proof Customer', is_test = true where id = '${customer.id}';
      update public.profiles set role = 'customer', full_name = 'Proof Stranger', is_test = true where id = '${stranger.id}';
      update public.profiles set role = 'driver', full_name = 'Proof Driver', is_test = true where id = '${driver.id}';
      update public.profiles set role = 'driver', full_name = 'Proof Other', is_test = true where id = '${other.id}';
      update public.profiles set role = 'admin', full_name = 'Proof Admin', is_test = false where id = '${admin.id}';
      insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
      values (
        '${driver.id}', 'active',
        (select id from public.zones where slug = 'west_metro'),
        'full', array['delivery','junk']::public.job_service[], true,
        '${driver.id}/license.jpg'
      );
      ${jobSql(ids.delivery, customer.id, driver.id, "delivery", "completed", false)}
      ${jobSql(ids.junk, customer.id, driver.id, "junk", "completed", false)}
      ${jobSql(ids.dispute, customer.id, driver.id, "delivery", "disputed", true)}
      ${jobSql(ids.empty, customer.id, driver.id, "delivery", "arrived", false)}
    `);

    const service = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
    const files = [
      [ids.delivery, "request", "c1920000-0000-4000-8000-000000000031"],
      [ids.delivery, "pickup", "c1920000-0000-4000-8000-000000000032"],
      [ids.delivery, "dropoff", "c1920000-0000-4000-8000-000000000033"],
      [ids.junk, "pickup", "c1920000-0000-4000-8000-000000000034"],
      [ids.dispute, "request", "c1920000-0000-4000-8000-000000000035"],
      [ids.dispute, "pickup", "c1920000-0000-4000-8000-000000000036"],
      [ids.dispute, "dropoff", "c1920000-0000-4000-8000-000000000037"],
      [ids.dispute, "dump_receipt", "c1920000-0000-4000-8000-000000000038"],
    ] as const;
    for (const [jobId, stage, photoId] of files) {
      const path = `${jobId}/${stage}/${photoId}.png`;
      paths.push(path);
      const uploaded = await service.storage.from("job-photos").upload(path, png, { contentType: "image/png", upsert: false });
      if (uploaded.error) throw new Error("The proof file could not be stored.");
    }
    const missingPath = `${ids.delivery}/pickup/c1920000-0000-4000-8000-000000000039.png`;
    const rows = files
      .map(([jobId, stage, photoId], index) => {
        const path = `${jobId}/${stage}/${photoId}.png`;
        return `('${jobId}', '${stage}', '${path}', '${driver.id}', now() + (${index} * interval '1 second'))`;
      })
      .join(",\n");
    localSql(`
      begin;
      select set_config('pickuply.record_proof', 'yes', true);
      insert into public.job_photos (job_id, stage, storage_path, uploaded_by, created_at)
      values
        ${rows},
        ('${ids.delivery}', 'pickup', '${missingPath}', '${driver.id}', now() + interval '20 seconds');
      commit;
    `);

    const adminContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const strangerContext = await browser.newContext();
    const driverContext = await browser.newContext();
    const otherContext = await browser.newContext();
    const anonContext = await browser.newContext();
    await applySession(adminContext, status.url, admin.session);
    await applySession(customerContext, status.url, customer.session);
    await applySession(strangerContext, status.url, stranger.session);
    await applySession(driverContext, status.url, driver.session);
    await applySession(otherContext, status.url, other.session);
    const adminPage = await adminContext.newPage();
    const customerPage = await customerContext.newPage();
    const strangerPage = await strangerContext.newPage();
    const driverPage = await driverContext.newPage();
    const otherPage = await otherContext.newPage();
    const anonPage = await anonContext.newPage();

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await openAdmin(adminPage, ids.delivery);
    await expect(adminPage.getByRole("heading", { name: "Delivery proof" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Request photos" })).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Request photo" })).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Pickup proof" }).first()).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Drop-off proof" })).toBeVisible();
    await expect(adminPage.getByText("A photo could not be opened. Refresh the page for a new link.")).toBeVisible();
    await adminPage.evaluate(() => {
      const image = document.querySelector('img[alt="Drop-off proof"]');
      if (image instanceof HTMLImageElement) image.src = "http://127.0.0.1:9/missing.png";
    });
    await expect(adminPage.getByText("This photo could not be loaded. Refresh the page for a new link.")).toBeVisible();
    const src = await adminPage.getByRole("img", { name: "Pickup proof" }).first().getAttribute("src");
    expect(src ?? "").toContain("token=");
    expect(src ?? "").not.toContain("/object/public/");
    await adminPage.getByRole("button", { name: "View Pickup proof" }).click();
    await expect(adminPage.getByRole("dialog", { name: "Pickup proof" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Close" }).click();
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await expect(adminPage.getByRole("heading", { name: "Delivery proof" })).toBeVisible();

    await openAdmin(adminPage, ids.junk);
    await expect(adminPage.getByRole("img", { name: "Removal completion photo" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Drop-off proof" })).toHaveCount(0);
    await expect(adminPage.getByRole("heading", { name: "Disposal receipt" })).toHaveCount(0);

    await openAdmin(adminPage, ids.dispute);
    await expect(adminPage.getByRole("heading", { name: "Resolve the problem report" })).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Request photo" })).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Pickup proof" })).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Drop-off proof" })).toBeVisible();
    await expect(adminPage.getByRole("img", { name: "Disposal receipt" })).toBeVisible();
    await adminPage.getByRole("button", { name: "View Disposal receipt" }).click();
    await expect(adminPage.getByRole("dialog", { name: "Disposal receipt" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Close" }).click();

    await openAdmin(adminPage, ids.empty);
    await expect(adminPage.getByText("No pickup proof yet.")).toBeVisible();
    await expect(adminPage.getByText("No drop-off proof yet.")).toBeVisible();

    await customerPage.goto(`/jobs/${ids.delivery}`);
    await dismissCookies(customerPage);
    await hideDevOverlay(customerPage);
    await customerPage.getByRole("tab", { name: "Details" }).click();
    await expect(customerPage.getByRole("img", { name: "pickup proof" })).toBeVisible();
    await expect(customerPage.getByRole("img", { name: "dropoff proof" })).toBeVisible();
    await expect(customerPage.getByRole("heading", { name: "Delivery proof" })).toHaveCount(0);
    const customerClient = userClient(status, customer.session.access_token);
    const ownPhotos = await customerClient.from("job_photos").select("id").eq("job_id", ids.delivery);
    expect((ownPhotos.data ?? []).length).toBeGreaterThanOrEqual(2);

    await strangerPage.goto(`/jobs/${ids.delivery}`);
    await expect(strangerPage.getByRole("heading", { name: "Request not found" })).toBeVisible();
    await expect(strangerPage.getByRole("img", { name: "pickup proof" })).toHaveCount(0);
    const strangerClient = userClient(status, stranger.session.access_token);
    const strangerPhotos = await strangerClient.from("job_photos").select("id").eq("job_id", ids.delivery);
    expect(strangerPhotos.data ?? []).toHaveLength(0);
    const strangerFile = await strangerClient.storage.from("job-photos").createSignedUrl(paths[1], 60);
    expect(strangerFile.data?.signedUrl ?? "").toBe("");

    await driverPage.goto(`/driver/jobs/${ids.delivery}`);
    await dismissCookies(driverPage);
    await hideDevOverlay(driverPage);
    await driverPage.locator("summary", { hasText: "Photos" }).click();
    await expect(driverPage.getByRole("img", { name: "pickup proof" })).toBeVisible();
    await expect(driverPage.getByRole("img", { name: "dropoff proof" })).toBeVisible();
    await driverPage.goto(`/driver/jobs/${ids.junk}`);
    await driverPage.locator("summary", { hasText: "Photos" }).click();
    await expect(driverPage.getByRole("img", { name: "pickup proof" })).toBeVisible();

    await otherPage.goto(`/driver/jobs/${ids.delivery}`);
    await expect(otherPage.getByText("This page could not be found.")).toBeVisible();
    const otherClient = userClient(status, other.session.access_token);
    const otherPhotos = await otherClient.from("job_photos").select("id").eq("job_id", ids.delivery);
    expect(otherPhotos.data ?? []).toHaveLength(0);

    await anonPage.goto(`/admin/requests/${ids.delivery}`);
    await expect(anonPage).toHaveURL(/\/login/);
    await expect(anonPage.getByRole("img", { name: "Pickup proof" })).toHaveCount(0);
    const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonPhotos = await anon.from("job_photos").select("id").eq("job_id", ids.delivery);
    expect(anonPhotos.data ?? []).toHaveLength(0);
    const anonFile = await anon.storage.from("job-photos").download(paths[1]);
    expect(anonFile.data ?? null).toBeNull();
  } finally {
    const service = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
    if (paths.length > 0) await service.storage.from("job-photos").remove(paths);
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
        delete from public.jobs where id in (${jobList});
        delete from public.drivers where profile_id in (${[driver.id, other.id].filter(Boolean).map((id) => `'${id}'`).join(",") || "null"});
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

function jobSql(id: string, customerId: string, driverId: string, service: "delivery" | "junk", status: string, receipt: boolean) {
  const dropoff = service === "junk" ? "null" : "'Mableton 30126'";
  return `
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
      offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
      assigned_driver_id, payment_status, is_test, require_disposal_receipt
    ) values (
      '${id}', '${customerId}', '${service}', '${status}',
      (select id from public.zones where slug = 'west_metro'),
      'Austell 30168', ${dropoff}, '${service} proof', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed',
      ${service === "junk" ? "5000, 5180, 4250, 750, 180" : "7500, 7755, 6375, 1125, 255"},
      '${driverId}', 'authorized', true, ${receipt}
    );
  `;
}

function blankUser() {
  return { id: "", session: { access_token: "", refresh_token: "", expires_in: 0, token_type: "bearer", user: null as unknown } };
}

async function openAdmin(page: Page, jobId: string) {
  await page.goto(`/admin/requests/${jobId}`);
  await dismissCookies(page);
  await hideDevOverlay(page);
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
