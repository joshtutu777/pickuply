import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Locator } from "@playwright/test";

const widths = [320, 375, 390, 430];
const password = "local-cookie-test-password";

test("the cookie choice stays off menus and tabs", async ({ browser, page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("pickuply-analytics-consent"));
    await page.reload();
    const dialog = page.getByRole("dialog", { name: "Optional cookies" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => getComputedStyle(element).position)).not.toBe("fixed");
    const blog = page.getByRole("link", { name: "Blog" }).first();
    await expect(blog).toBeVisible();
    expect(await overlaps(dialog, blog)).toBe(false);
    for (const name of ["Allow optional cookies", "Reject optional cookies"]) {
      const button = dialog.getByRole("button", { name });
      await button.scrollIntoViewIfNeeded();
      const buttonBox = await button.boundingBox();
      const dialogBox = await dialog.boundingBox();
      expect(buttonBox && dialogBox && buttonBox.y >= dialogBox.y - 1 && buttonBox.y + buttonBox.height <= dialogBox.y + dialogBox.height + 2).toBe(true);
    }
  }

  await page.getByRole("button", { name: "Reject optional cookies" }).click();
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toHaveCount(0);
  await page.getByRole("link", { name: "Blog" }).first().click();
  await expect(page).toHaveURL(/\/blog$/);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.getByRole("button", { name: "Allow optional cookies" }).click();
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.getByRole("button", { name: "Reject optional cookies" }).click();
  await page.getByRole("link", { name: "Contact" }).first().click();
  await expect(page).toHaveURL(/\/contact$/);

  const status = localStatus();
  const email = `cookie-customer-${Date.now()}@pickuply.test`;
  const user = await makeUser(status, email);
  localSql(`update public.profiles set role = 'customer', full_name = 'Cookie Customer', is_test = true where id = '${user.id}';`);
  const context = await browser.newContext({ viewport: { width: 390, height: 720 } });
  await applySession(context, status.url, user.session);
  const account = await context.newPage();
  await account.goto("/account");
  await account.evaluate(() => localStorage.removeItem("pickuply-analytics-consent"));
  await account.reload();
  const accountDialog = account.getByRole("dialog", { name: "Optional cookies" });
  await expect(accountDialog).toBeVisible();
  const home = account.getByRole("navigation", { name: "Customer" }).getByRole("link", { name: "Home" });
  await expect(home).toBeVisible();
  expect(await overlaps(accountDialog, home)).toBe(false);
  await hideDevOverlay(account);
  await home.click({ timeout: 15_000 });
  await expect(account).toHaveURL(/\/account$/);
  await account.getByRole("button", { name: "Reject optional cookies" }).click();
  await account.getByRole("navigation", { name: "Customer" }).getByRole("link", { name: "Requests" }).click();
  await expect(account).toHaveURL(/\/account\/jobs$/);
  await context.close();

  const driverUser = await makeUser(status, `cookie-driver-${Date.now()}@pickuply.test`);
  const adminUser = await makeUser(status, `cookie-admin-${Date.now()}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'driver', full_name = 'Cookie Driver', is_test = true where id = '${driverUser.id}';
    update public.profiles set role = 'admin', full_name = 'Cookie Admin', is_test = true where id = '${adminUser.id}';
  `);
  const driverContext = await browser.newContext({ viewport: { width: 390, height: 720 } });
  await applySession(driverContext, status.url, driverUser.session);
  const driver = await driverContext.newPage();
  await driver.goto("/driver");
  await driver.evaluate(() => localStorage.removeItem("pickuply-analytics-consent"));
  await driver.reload();
  const driverDialog = driver.getByRole("dialog", { name: "Optional cookies" });
  await expect(driverDialog).toBeVisible();
  const driverHome = driver.getByRole("navigation", { name: "Driver" }).getByRole("link", { name: "Home" });
  await expect(driverHome).toBeVisible();
  expect(await overlaps(driverDialog, driverHome)).toBe(false);
  await hideDevOverlay(driver);
  await driver.getByRole("button", { name: "Reject optional cookies" }).click();
  await driver.getByRole("navigation", { name: "Driver" }).getByRole("link", { name: "Jobs" }).click();
  await expect(driver).toHaveURL(/\/driver\/jobs$/);
  await driverContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 390, height: 720 } });
  await applySession(adminContext, status.url, adminUser.session);
  const admin = await adminContext.newPage();
  await admin.goto("/admin");
  await admin.evaluate(() => localStorage.removeItem("pickuply-analytics-consent"));
  await admin.reload();
  const adminDialog = admin.getByRole("dialog", { name: "Optional cookies" });
  await expect(adminDialog).toBeVisible();
  const alerts = admin.getByRole("link", { name: "Alerts" });
  await expect(alerts).toBeVisible();
  expect(await overlaps(adminDialog, alerts)).toBe(false);
  const menu = admin.locator("summary");
  await expect(menu).toBeVisible();
  expect(await overlaps(adminDialog, menu)).toBe(false);
  await hideDevOverlay(admin);
  await menu.click();
  await admin.getByRole("link", { name: "Requests" }).first().click();
  await expect(admin).toHaveURL(/\/admin\/requests/);
  await admin.getByRole("button", { name: "Reject optional cookies" }).click();
  await adminContext.close();

  await deleteUser(status, user.id);
  await deleteUser(status, driverUser.id);
  await deleteUser(status, adminUser.id);
});

async function hideDevOverlay(page: { evaluate: (fn: () => void) => Promise<void> }) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal, nextjs-portal *{pointer-events:none !important}";
    document.documentElement.appendChild(style);
  });
}

async function overlaps(first: Locator, second: Locator) {
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  if (!a || !b) return true;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
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
  await context.addCookies(chunks.map((chunk) => ({ name: chunk.name, value: chunk.value, url: "http://127.0.0.1:3001" })));
}
