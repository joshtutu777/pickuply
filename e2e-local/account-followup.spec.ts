import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";

const password = "local-followup-test-password";

test("customer page, suspension form, deletion copy, and stop driving", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now();
  const adminUser = await makeUser(status, `follow-admin-${stamp}@pickuply.test`);
  const customerUser = await makeUser(status, `follow-customer-${stamp}@pickuply.test`);
  const driverUser = await makeUser(status, `follow-driver-${stamp}@pickuply.test`);
  localSql(
    `update public.profiles set role = 'admin', full_name = 'Follow Admin' where id = '${adminUser.id}';
     update public.profiles set full_name = 'Follow Customer', phone = '5555550166' where id = '${customerUser.id}';
     update public.profiles set role = 'driver', full_name = 'Follow Driver', phone = '5555550167' where id = '${driverUser.id}';
     insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
     values ('${driverUser.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], false)
     on conflict (profile_id) do nothing;`,
  );

  const admin = await browser.newContext();
  const customer = await browser.newContext();
  const driver = await browser.newContext();
  try {
    await applySession(admin, status.url, adminUser.session);
    await applySession(customer, status.url, customerUser.session);
    await applySession(driver, status.url, driverUser.session);

    const adminPage = await admin.newPage();
    await adminPage.goto(`/admin/customers/${customerUser.id}`);
    await expect(adminPage.getByRole("heading", { name: "Follow Customer" })).toBeVisible();
    await expect(adminPage.getByText("5555550166")).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Suspend Account" })).toBeVisible();

    const customerPage = await customer.newPage();
    await customerPage.goto("/account/delete");
    await expect(customerPage.getByRole("heading", { name: "Delete Account" })).toBeVisible();
    await expect(customerPage.getByText("14 days").first()).toBeVisible();

    const driverPage = await driver.newPage();
    await driverPage.goto("/account/stop-driving");
    await expect(driverPage.getByRole("heading", { name: "Stop Driving" })).toBeVisible();
    await expect(driverPage.getByRole("button", { name: "Stop Driving" })).toBeVisible();
  } finally {
    await admin.close();
    await customer.close();
    await driver.close();
  }
});

function localSql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: sql, encoding: "utf8" },
  );
}

function localStatus(): { url: string; anon: string; service: string } {
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
  if (!url || !anon || !service) throw new Error("Local Supabase status did not include the API URL and keys.");
  return { url, anon, service };
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

async function applySession(
  context: BrowserContext,
  apiUrl: string,
  session: { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; token_type: string; user: unknown },
) {
  const key = `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  await context.addCookies([{ name: key, value: encoded, url: "http://127.0.0.1:3001" }]);
}
