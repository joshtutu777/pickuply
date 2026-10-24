import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const driver = { phone: "5555550199", code: "101199", name: "Riley Driver" };
const customer = { phone: "5555550177", code: "101177", name: "Robin Returning" };
const admin = { phone: "5555550126", code: "101126", name: "Alex Admin" };
const detailJob = "a1000000-0000-4000-8000-000000000001";
const claimJob = "a1000000-0000-4000-8000-000000000010";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  localSql(`
    alter table public.job_photos disable trigger job_photos_lock;
    delete from public.job_events where job_id in ('${detailJob}', '${claimJob}');
    delete from public.job_photos where job_id in ('${detailJob}', '${claimJob}');
    delete from public.messages
    where thread_id in (select id from public.message_threads where job_id in ('${detailJob}', '${claimJob}'));
    delete from public.message_reads
    where thread_id in (select id from public.message_threads where job_id in ('${detailJob}', '${claimJob}'));
    delete from public.message_threads where job_id in ('${detailJob}', '${claimJob}');
    delete from public.job_private where job_id in ('${detailJob}', '${claimJob}');
    delete from public.jobs where id in ('${detailJob}', '${claimJob}');
    alter table public.job_photos enable trigger job_photos_lock;
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
      pricing_method, service_level, required_vehicle
    )
    select
      '${detailJob}', u.id, 'delivery', 'requested', z.id, 'Austell, 30106', 'Smyrna, 30080',
      'Details round trip dresser', 1, 'medium', 0, 0, 0, false, false, 'asap', 'quote', 'light', 'pickup'
    from auth.users u
    cross join public.zones z
    where u.phone in ('15555550177', '+15555550177')
      and z.slug = 'west_metro';
    update public.profiles
    set role = 'customer'
    where id in (select id from auth.users where phone in ('15555550199', '+15555550199'));
    delete from public.vehicles
    where driver_id in (select id from auth.users where phone in ('15555550199', '+15555550199'));
    delete from public.drivers
    where profile_id in (select id from auth.users where phone in ('15555550199', '+15555550199'));
  `);
});

test("admin ask for details returns to the review queue after the customer answers", async ({ page }) => {
  await signIn(page, admin, `/admin/requests/${detailJob}`);
  await expect(page.getByText("Details round trip dresser")).toBeVisible();
  await page.getByRole("checkbox", { name: "Stairs" }).check();
  await page.getByLabel("Note for the customer").fill("How many stairs are at the pickup?");
  await page.getByRole("button", { name: "Ask for details" }).click();
  await expect(page.getByText("Waiting on the customer. Drivers can still see this request.")).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, customer, `/jobs/${detailJob}`);
  await expect(page.getByRole("heading", { name: "Pickuply needs a few details" })).toBeVisible();
  await expect(
    page.locator("p.rounded-2xl").filter({ hasText: "How many stairs are at the pickup?" }),
  ).toBeVisible();
  await page.locator("#stairs-pickup").selectOption("0");
  await page.locator("#stairs-dropoff").selectOption("0");
  await page.getByLabel("Your answer").fill("No stairs at either stop.");
  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByRole("heading", { name: "Pickuply needs a few details" })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, admin, `/admin/requests/${detailJob}`);
  await expect(page.getByText("Waiting on the customer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send quote" })).toBeVisible();
});

test("quick apply cannot go online until the checklist is finished, then can claim", async ({ page }) => {
  await signIn(page, driver, "/driver/onboarding");
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#fullName") ?? {}).some((key) => key.startsWith("__react")),
  );
  await page.getByLabel("Your name").fill(driver.name);
  await expect(page.getByLabel("Your name")).toHaveValue(driver.name);
  await page.getByLabel("Street").fill("10 Test Street");
  await page.getByLabel("City").fill("Austell");
  await page.getByLabel("ZIP").fill("30106");
  await page.locator("#vehicleType").selectOption("pickup");
  await page.getByRole("radio", { name: "Light load" }).check();
  await page.locator("#licenseExpires").fill("2027-12-31");
  await page.locator("#profilePhoto").setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: png });
  await page.locator("#licensePhoto").setInputFiles({ name: "license.png", mimeType: "image/png", buffer: png });
  await page.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
  await page.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/driver\?saved=applied/);
  await expect(page.getByText("Application submitted")).toBeVisible();

  const driverId = localSql(
    `select id from auth.users where phone in ('15555550199', '+15555550199') limit 1;`,
  ).trim();
  await page.context().clearCookies();
  await signIn(page, admin, `/admin/drivers/${driverId}`);
  const approveAnyway = page.getByRole("checkbox", { name: "Approve anyway" });
  if (await approveAnyway.isVisible()) await approveAnyway.check();
  await page.getByRole("button", { name: "Approve driver" }).click();
  await expect(page.getByText(/active · role driver/)).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, driver, "/driver");
  await expect(page.getByRole("heading", { name: "Driver home" })).toBeVisible();
  await expect(page.getByText("Add unexpired insurance before going Online.")).toBeVisible();

  await page.goto("/driver/ready/insurance");
  await page.locator("#insurance-photo").setInputFiles({ name: "insurance.png", mimeType: "image/png", buffer: png });
  await page.locator("#insurance-expires").fill("2027-12-31");
  await expect(page.getByRole("button", { name: "Save insurance" })).toBeEnabled();
  await page.getByRole("button", { name: "Save insurance" }).click();
  await expect(page).toHaveURL(/\/driver\?saved=insurance/);

  await page.goto("/driver/ready/vehicle");
  await page.locator("#make").fill("Ford");
  await page.locator("#model").fill("Ranger");
  await page.locator("#year").fill("2020");
  await page.locator("#plate").fill("QA1234");
  await page.locator("#cargo").fill("72");
  await page.locator("#vehicle-photo").setInputFiles({ name: "truck.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("button", { name: "Save vehicle" })).toBeEnabled();
  await page.getByRole("button", { name: "Save vehicle" }).click();
  await expect(page).toHaveURL(/\/driver\?saved=vehicle/);

  await page.goto("/driver/ready/equipment");
  await page.getByRole("checkbox", { name: "blankets" }).check();
  await page.getByRole("button", { name: "Save equipment" }).click();
  await expect(page).toHaveURL(/\/driver\?saved=equipment/);

  await page.goto("/driver/ready/services");
  await page.getByRole("checkbox", { name: "Pickup and delivery" }).check();
  await page.getByRole("button", { name: "Save services" }).click();
  await expect(page).toHaveURL(/\/driver\?saved=services/);

  await page.goto("/driver/ready/agreement");
  await page.locator("#signature").fill(driver.name);
  await page.getByRole("button", { name: "Sign agreement" }).click();
  await expect(page).toHaveURL(/\/driver\?saved=agreement/);

  await page.goto("/driver/ready/training");
  await page.getByRole("button", { name: "I finished the training" }).click();
  await expect(page).toHaveURL(/\/driver\?saved=training/);
  await expect(page.getByText("An approved vehicle is required before going Online.")).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, admin, `/admin/drivers/${driverId}`);
  await page.getByRole("button", { name: "Approve vehicle" }).click();
  await expect(page.getByText("· approved")).toBeVisible();

  localSql(`
    begin;
    select set_config('pickuply.quote_accepted', 'yes', true);
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
      pricing_method, service_level, required_vehicle
    )
    select
      '${claimJob}', u.id, 'delivery', 'open', z.id, 'Marietta, 30064', 'Smyrna, 30080',
      'Quick apply desk', 1, 'medium', 0, 0, 0, false, false, 'asap', 'quote', 'light', 'pickup'
    from auth.users u
    cross join public.zones z
    where u.phone in ('15555550177', '+15555550177')
      and z.slug = 'west_metro';
    select set_config('pickuply.offer_chosen', 'yes', true);
    update public.jobs
    set
      driver_pay_cents = (fees.breakdown->>'driver_earnings_cents')::integer,
      platform_fee_cents = (fees.breakdown->>'platform_fee_cents')::integer,
      service_fee_cents = (fees.breakdown->>'service_fee_cents')::integer,
      price_cents = (fees.breakdown->>'customer_total_cents')::integer
    from (select public.price_breakdown('forward', 6000) as breakdown) fees
    where id = '${claimJob}';
    commit;
  `);

  await page.context().clearCookies();
  await signIn(page, driver, "/driver");
  await expect(page.getByText("An approved vehicle is required before going Online.")).toHaveCount(0);
  await page.getByRole("switch", { name: "You are Offline" }).click();
  await expect(page.getByRole("switch", { name: "You are Online" })).toBeVisible();
  const card = page.locator("li").filter({ hasText: "Marietta, 30064" });
  await card.getByRole("button", { name: "Claim this job" }).click();
  await expect(page.locator(`a[href="/driver/jobs/${claimJob}"]`)).toBeVisible();
});

async function signIn(page: Page, person: { phone: string; code: string; name: string }, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const phone = page.getByLabel("Mobile number");
  await page.waitForFunction(() => {
    const field = document.querySelector("#phone");
    return Boolean(field && Object.keys(field).some((key) => key.startsWith("__react")));
  });
  await phone.fill(person.phone);
  await expect(phone).toHaveValue(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByLabel("6-digit code");
  const problem = page.getByRole("main").getByRole("alert");
  await expect(code.or(problem)).toBeVisible();
  if (!(await code.isVisible())) throw new Error(await problem.innerText());
  await code.fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(person.name);
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.waitForURL((url) => url.pathname !== "/login" && !url.pathname.startsWith("/auth") && !url.pathname.includes("/login/name"), {
    timeout: 20_000,
  });
}

function localSql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  );
}
