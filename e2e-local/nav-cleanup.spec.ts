import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const widths = [
  { width: 320, height: 720 },
  { width: 375, height: 720 },
  { width: 390, height: 720 },
  { width: 430, height: 720 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
];
const password = "local-nav-test-password";

test("blog and contact stay public, and help stays in the apps", async ({ browser, page }) => {
  const status = localStatus();
  const slug = localSql(
    "select slug from public.blog_posts where status = 'published' order by published_at desc nulls last limit 1",
  ).trim();

  for (const size of widths) {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("pickuply-analytics-consent"));
    await page.reload();
    const dialog = page.getByRole("dialog", { name: "Optional cookies" });
    if (await dialog.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Reject optional cookies" }).click();
    }
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link", { name: "Blog", exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "Contact", exact: true })).toBeVisible();
    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "Blog", exact: true })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Contact", exact: true })).toBeVisible();
    await expect(page.locator("a[href^='mailto:']")).toHaveCount(0);
  }

  await page.goto("/blog");
  await expect(page.getByRole("heading", { name: "Blog" })).toBeVisible();
  if (slug) {
    await page.goto(`/blog/${slug}`);
    await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`));
  }
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();

  const customer = await makeUser(status, `nav-customer-${Date.now()}@pickuply.test`);
  const driver = await makeUser(status, `nav-driver-${Date.now()}@pickuply.test`);
  const admin = await makeUser(status, `nav-admin-${Date.now()}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Nav Customer', is_test = true where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Nav Driver', is_test = true where id = '${driver.id}';
    update public.profiles set role = 'admin', full_name = 'Nav Admin', is_test = true where id = '${admin.id}';
  `);

  try {
    const customerContext = await browser.newContext();
    await applySession(customerContext, status.url, customer.session);
    const customerPage = await customerContext.newPage();
    await customerPage.setViewportSize({ width: 390, height: 720 });
    await customerPage.goto("/account");
    await hideDevOverlay(customerPage);
    await expect(customerPage.getByRole("navigation", { name: "Customer" }).getByRole("link", { name: "Requests" })).toBeVisible();
    await expect(customerPage.getByRole("link", { name: "Help", exact: true }).first()).toBeVisible();
    await expect(customerPage.getByRole("link", { name: "Blog", exact: true })).toHaveCount(0);
    await expect(customerPage.getByRole("link", { name: "Contact", exact: true })).toHaveCount(0);
    await customerPage.goto("/blog");
    await expect(customerPage.getByRole("heading", { name: "Blog" })).toBeVisible();
    await customerPage.goto("/contact");
    await expect(customerPage.getByRole("button", { name: "Send message" })).toBeVisible();
    await customerPage.goto("/support");
    await expect(customerPage.getByRole("heading", { name: "Pickuply Support" })).toBeVisible();
    await customerPage.setViewportSize({ width: 1280, height: 900 });
    await customerPage.goto("/account");
    await expect(customerPage.getByRole("navigation", { name: "Customer" }).getByRole("link", { name: "Help", exact: true })).toBeVisible();
    await expect(customerPage.getByRole("link", { name: "Blog", exact: true })).toHaveCount(0);
    await customerContext.close();

    const driverContext = await browser.newContext();
    await applySession(driverContext, status.url, driver.session);
    const driverPage = await driverContext.newPage();
    await driverPage.setViewportSize({ width: 390, height: 720 });
    await driverPage.goto("/driver");
    await hideDevOverlay(driverPage);
    await expect(driverPage.getByRole("navigation", { name: "Driver" }).getByRole("link", { name: "Jobs" })).toBeVisible();
    await expect(driverPage.getByRole("link", { name: "Help", exact: true }).first()).toBeVisible();
    await expect(driverPage.getByRole("link", { name: "Blog", exact: true })).toHaveCount(0);
    await expect(driverPage.getByRole("link", { name: "Contact", exact: true })).toHaveCount(0);
    await driverPage.getByRole("link", { name: "Help", exact: true }).first().click();
    await expect(driverPage).toHaveURL(/\/help/);
    await driverPage.goto("/support");
    await expect(driverPage.getByRole("heading", { name: "Pickuply Support" })).toBeVisible();
    await driverContext.close();

    const adminContext = await browser.newContext();
    await applySession(adminContext, status.url, admin.session);
    const adminPage = await adminContext.newPage();
    await adminPage.setViewportSize({ width: 390, height: 720 });
    await adminPage.goto("/admin");
    await hideDevOverlay(adminPage);
    await adminPage.locator("summary").click();
    await expect(adminPage.getByRole("link", { name: "Blog", exact: true }).first()).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Support Inbox" }).first()).toBeVisible();
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await adminPage.goto("/admin/blog");
    await expect(adminPage.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Blog", exact: true })).toBeVisible();
    await adminPage.goto("/admin/support");
    await expect(adminPage.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Support Inbox" })).toBeVisible();
    await adminContext.close();
  } finally {
    await deleteUser(status, customer.id);
    await deleteUser(status, driver.id);
    await deleteUser(status, admin.id);
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
