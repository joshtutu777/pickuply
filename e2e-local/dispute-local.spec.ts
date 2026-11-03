import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const jobId = "d1200000-0000-4000-8000-000000000001";
const robin = { phone: "5555550177", otp: "101177" };

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

async function signIn(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  const phoneInput = page.locator("#phone");
  await phoneInput.fill(robin.phone);
  await expect(phoneInput).toHaveValue(robin.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const alert = page.locator("main [role=alert]");
  const code = page.getByLabel("6-digit code");
  await expect(code.or(alert)).toBeVisible();
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  await code.fill(robin.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

test("a customer report marks the local job disputed and holds payout", async ({ page }) => {
  const customerId = sql(
    "select id from public.profiles where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '5555550177'",
  );
  const driverId = sql(
    "select id from public.profiles where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '5555550124'",
  );
  if (!customerId || !driverId) throw new Error("local customer or driver profile is missing");
  sql(`
    delete from public.job_disputes where job_id = '${jobId}';
    delete from public.job_reports where job_id = '${jobId}';
    delete from public.job_events where job_id = '${jobId}';
    delete from public.job_private where job_id = '${jobId}';
    delete from public.jobs where id = '${jobId}';
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, is_test
    ) values (
      '${jobId}', '${customerId}', 'delivery', 'open',
      (select id from public.zones where slug = 'west_metro'),
      'Austell 30106', 'Smyrna 30080', 'Local dispute fixture', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed', true
    );
    set session_replication_role = replica;
    update public.jobs
    set status = 'delivered',
        assigned_driver_id = '${driverId}',
        payment_status = 'authorized',
        updated_at = now()
    where id = '${jobId}';
    insert into public.job_events (job_id, actor_id, type, data)
    values ('${jobId}', '${customerId}', 'status', jsonb_build_object('to', 'delivered'));
    set session_replication_role = origin;
  `);

  await page.goto(`/login?next=${encodeURIComponent(`/help?job=${jobId}`)}`);
  await signIn(page);
  await page.goto(`/help?job=${jobId}`);
  await page.locator("#report-category").selectOption("damaged");
  await page.locator("#report-description").fill("The desk corner is cracked.");
  await page.locator("#report-outcome").selectOption("repair");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report saved. Pickuply will review it.")).toBeVisible();

  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByRole("heading", { name: "Disputed" })).toBeVisible();
  expect(sql(`select status from public.jobs where id = '${jobId}'`)).toBe("disputed");
  expect(
    sql(
      `select capture_hold::text || '|' || payout_hold::text from public.job_disputes where job_id = '${jobId}'`,
    ),
  ).toBe("true|true");
});
