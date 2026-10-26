import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";

const realAdmin = { phone: "5555550126", otp: "101126" };
const testAdmin = { phone: "5555550311", otp: process.env.PICKUPLY_TEST_OTP_0311 ?? "" };

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

async function signIn(page: Page, person: { phone: string; otp: string }) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  await page.locator("#phone").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const alert = page.locator("main [role=alert]");
  const code = page.getByLabel("6-digit code");
  await expect(code.or(alert)).toBeVisible();
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname === "/login/name" || !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
}

async function open(browser: Browser, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test("a real admin sees a redacted cron failure and a test admin does not", async ({ browser }) => {
  expect(testAdmin.otp).toMatch(/^\d{6}$/);
  sql(`
    select set_config('request.jwt.claim.role', 'service_role', true);
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set role service_role;
    select public.record_cron_run(
      'transfers',
      now() - interval '1 minute',
      now(),
      false,
      'Bearer secret sk_test_abc whsec_def'
    );
    reset role;
  `);
  const stored = sql(`select error_message from public.cron_job_runs where job_name = 'transfers'`);
  expect(stored).toContain("[redacted]");
  expect(stored).not.toContain("sk_test_");
  expect(stored).not.toContain("whsec_");

  const real = await open(browser, "/login?next=/admin/health");
  await signIn(real, realAdmin);
  await real.goto("/admin/health");
  await expect(real.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(real.getByText("Driver transfers")).toBeVisible();
  await expect(real.getByText("Last result: Failed")).toBeVisible();
  await expect(real.getByRole("alert").filter({ hasText: "[redacted]" })).toBeVisible();
  await expect(real.getByText("sk_test_")).toHaveCount(0);
  await expect(real.getByText("whsec_")).toHaveCount(0);
  await expect(real.getByText("Not run yet").first()).toBeVisible();

  const synthetic = await open(browser, "/login?next=/admin/health");
  await signIn(synthetic, testAdmin);
  await synthetic.goto("/admin/health");
  await expect(synthetic.getByText("Scheduler status is hidden from a test admin.")).toBeVisible();
  await expect(synthetic.getByText("Driver transfers")).toHaveCount(0);
  await expect(synthetic.getByText("[redacted]")).toHaveCount(0);

  sql(`delete from public.cron_job_runs where job_name = 'transfers'`);
});
