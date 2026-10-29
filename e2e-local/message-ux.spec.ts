import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";

const sofaJob = "e1060000-0000-4000-8000-000000000010";
const tableJob = "e1060000-0000-4000-8000-000000000011";
const sofaThread = "e1060000-0000-4000-8000-0000000000a1";
const tableThread = "e1060000-0000-4000-8000-0000000000a2";
const street = "10 Secret Street";

const robin = { phone: "5555550177", otp: "101177" };
const pat = { phone: "5555550124", otp: "101124" };
const bea = { phone: "5555550125", otp: "101125" };

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

function sqlScript(script: string) {
  execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    { input: script },
  );
}

async function signIn(page: Page, person: { phone: string; otp: string }) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  const phoneInput = page.locator("#phone");
  await phoneInput.fill(person.phone);
  await expect(phoneInput).toHaveValue(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const alert = page.locator("main [role=alert]");
  const code = page.getByLabel("6-digit code");
  await expect(code.or(alert)).toBeVisible();
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL(
    (url) => url.pathname === "/login/name" || !url.pathname.startsWith("/login"),
    { timeout: 30_000 },
  );
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill("Local Tester");
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth"));
  }
}

async function dismissCookies(page: Page) {
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

async function open(browser: Browser, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  return page;
}

async function ensureLocalUser(person: { phone: string; otp: string; name: string; role: "customer" | "driver" }) {
  const existing = sql(
    `select count(*) from public.profiles where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '${person.phone}'`,
  );
  if (existing === "0") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (!url.includes("127.0.0.1") || !apiKey) throw new Error("local Supabase URL is missing");
    const headers = { apikey: apiKey, "Content-Type": "application/json" };
    const phone = `+1${person.phone}`;
    let verified = await fetch(`${url}/auth/v1/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, token: person.otp, type: "sms" }),
    });
    if (!verified.ok) {
      const sent = await fetch(`${url}/auth/v1/otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone }),
      });
      if (!sent.ok) throw new Error(`local code request failed (${sent.status})`);
      verified = await fetch(`${url}/auth/v1/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, token: person.otp, type: "sms" }),
      });
      if (!verified.ok) throw new Error(`local code check failed (${verified.status})`);
    }
  }
  sql(
    `update public.profiles set role = '${person.role}', full_name = '${person.name}' where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '${person.phone}'`,
  );
}

test.beforeAll(async () => {
  await ensureLocalUser({ ...robin, name: "Robin Returning", role: "customer" });
  await ensureLocalUser({ ...pat, name: "Pat Driver", role: "driver" });
  await ensureLocalUser({ ...bea, name: "Bea Driver", role: "driver" });
  const robinId = sql(
    "select id from public.profiles where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '5555550177'",
  );
  const patId = sql(
    "select id from public.profiles where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '5555550124'",
  );
  if (!robinId || !patId) throw new Error("local customer or driver profile is missing");
  sqlScript(`
begin;
delete from public.messages where thread_id in ('${sofaThread}', '${tableThread}');
delete from public.message_reads where thread_id in ('${sofaThread}', '${tableThread}');
delete from public.message_threads where id in ('${sofaThread}', '${tableThread}');
delete from public.job_private where job_id in ('${sofaJob}', '${tableJob}');
delete from public.jobs where id in ('${sofaJob}', '${tableJob}');
insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values
  ('${sofaJob}', '${robinId}', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Sofa pickup', 1, 'medium', 0, 0, false, false, 'asap', 'fixed'),
  ('${tableJob}', '${robinId}', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Table pickup', 1, 'medium', 0, 0, false, false, 'asap', 'fixed');
set session_replication_role = replica;
update public.jobs
set status = 'assigned', assigned_driver_id = '${patId}', payment_status = 'authorized'
where id in ('${sofaJob}', '${tableJob}');
set session_replication_role = origin;
insert into public.job_private (job_id, pickup_address, customer_name, customer_phone, customer_email)
values
  ('${sofaJob}', '${street}, Norcross, GA 30071', 'Robin Returning', '15555550177', 'robin@example.com'),
  ('${tableJob}', '${street}, Norcross, GA 30071', 'Robin Returning', '15555550177', 'robin@example.com');
insert into public.message_threads (id, job_id, requester_id, driver_id, kind) values
  ('${sofaThread}', '${sofaJob}', '${robinId}', '${patId}', 'job'),
  ('${tableThread}', '${tableJob}', '${robinId}', '${patId}', 'job');
insert into public.messages (thread_id, sender_id, body) values
  ('${sofaThread}', '${patId}', 'I am about 10 minutes away.'),
  ('${tableThread}', '${robinId}', 'The table is by the door.');
commit;
`);
});

test("customer and driver see the job conversation near the top", async ({ page, browser }, testInfo) => {
  await page.goto(`/login?next=${encodeURIComponent(`/jobs/${sofaJob}`)}`);
  await signIn(page, robin);
  await dismissCookies(page);
  await page.goto(`/jobs/${sofaJob}`);
  await dismissCookies(page);
  const launch = page.locator("#message-launch");
  await expect(launch).toBeVisible();
  await expect(launch).toContainText("Message Driver");
  await expect(launch).toContainText("Pat — Driver");
  await expect(launch).toContainText("I am about 10 minutes away.");
  await expect(launch).not.toContainText(street);
  const status = page.getByRole("heading", { name: "Driver assigned" });
  const statusBox = await status.boundingBox();
  const launchBox = await launch.boundingBox();
  expect(statusBox && launchBox && launchBox.y > statusBox.y).toBeTruthy();

  await launch.click();
  await expect(page.locator("#messages")).toBeVisible();
  await page.locator("#messages").scrollIntoViewIfNeeded();
  await expect(page.locator("a.fixed", { hasText: "Message Driver" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

  await page.goto("/account/messages");
  await dismissCookies(page);
  await expect(page.getByRole("link", { name: /Pat — Driver/ }).first()).toBeVisible();
  await expect(page.getByText("Pickup · Sofa pickup").first()).toBeVisible();
  await expect(page.getByText("Pickup · Table pickup").first()).toBeVisible();
  await expect(page.getByText(/Norcross → Duluth/).first()).toBeVisible();
  await expect(page.getByText(street)).toHaveCount(0);
  await page.getByText("Pickup · Sofa pickup").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("customer-inbox.png"), fullPage: false });
  await page.getByRole("link", { name: /Sofa pickup/ }).first().click();
  await expect(page.getByText("Pat — Driver").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open job" })).toBeVisible();
  await expect(page.getByText("Driver assigned").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("customer-thread.png"), fullPage: false });

  const driver = await open(browser, `/driver/jobs/${sofaJob}`);
  await signIn(driver, pat);
  await dismissCookies(driver);
  await driver.goto(`/driver/jobs/${sofaJob}`);
  await dismissCookies(driver);
  const driverLaunch = driver.locator("#message-launch");
  await expect(driverLaunch).toContainText("Message Customer");
  await expect(driverLaunch).toContainText("Robin — Customer");
  await expect(driverLaunch).not.toContainText(street);
  await driver.goto("/driver/messages");
  await dismissCookies(driver);
  await expect(driver.getByText("Robin — Customer").first()).toBeVisible();
  await expect(driver.getByText(street)).toHaveCount(0);
  await driver.getByText("Robin — Customer").first().scrollIntoViewIfNeeded();
  await driver.screenshot({ path: testInfo.outputPath("driver-inbox.png"), fullPage: false });

  const other = await open(browser, `/driver/jobs/${sofaJob}`);
  await signIn(other, bea);
  await other.goto(`/driver/jobs/${sofaJob}`);
  await expect(other.locator("#message-launch")).toHaveCount(0);
  await expect(other.getByText("Message Customer")).toHaveCount(0);

  await page.goto(`/jobs/${sofaJob}`);
  await dismissCookies(page);
  await expect(page.locator("#message-launch")).toBeVisible();
  await page.locator("#message-launch").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("customer-job.png"), fullPage: false });
  await driver.goto(`/driver/jobs/${sofaJob}`);
  await dismissCookies(driver);
  await expect(driver.locator("#message-launch")).toBeVisible();
  await driver.locator("#message-launch").scrollIntoViewIfNeeded();
  await driver.screenshot({ path: testInfo.outputPath("driver-job.png"), fullPage: false });
});
