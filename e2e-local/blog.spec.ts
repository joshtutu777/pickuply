import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const admin = { phone: "5555550126", otp: "101126" };
const customer = { phone: "5555550177", otp: "101177" };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sql(statement: string) {
  execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
}

function cleanup() {
  sql("delete from public.blog_posts where slug like 'page-seed-%' or slug like 'local-e2e-%' or 'local-e2e-sofa-guide' = any(previous_slugs)");
}

async function signIn(page: Page, person: { phone: string; otp: string }, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  await page.locator("#phone").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByLabel("6-digit code");
  await expect(code).toBeVisible();
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
}

test("published articles are public and drafts stay private", async ({ page, request }) => {
  sql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip')");
  cleanup();
  try {
    await page.goto("/blog");
    await expect(page.getByRole("heading", { name: "Blog" })).toBeVisible();
    await expect(page.getByText("No articles are published yet.")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Blog" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "From the Pickuply Blog" })).toHaveCount(0);

    sql(`
      insert into public.blog_posts (title, slug, category, status, excerpt)
      select 'Page seed ' || n, 'page-seed-' || n, 'furniture-delivery', 'published', 'A seeded furniture guide'
      from generate_series(1, 7) as n;
    `);
    await page.goto("/blog?q=Page%20seed%207");
    await expect(page.getByRole("heading", { name: "Page seed 7" })).toBeVisible();
    await page.goto("/blog?category=furniture-delivery&page=2");
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await page.goto("/blog?category=for-drivers&q=seeded");
    await expect(page.getByText("No articles match that search.")).toBeVisible();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 740 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(overflow).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    sql("delete from public.blog_posts where slug like 'page-seed-%'");

    await signIn(page, customer, "/admin/blog");
    await expect(page).toHaveURL(/\/account/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/account"), { timeout: 20_000 });

    await signIn(page, admin, "/admin/blog/new");
    await expect(page.getByRole("link", { name: "Blog" }).first()).toBeVisible();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Local e2e sofa guide");
    await page.getByLabel("Summary").fill("How a sofa gets from the listing to the room.");
    await page.getByLabel("Author display name").fill("Pickuply");
    await page.getByLabel("SEO title").fill("Sofa pickup guide");
    await page.getByLabel("SEO description").fill("A short guide to sofa pickup.");
    await page.locator("#block-0").fill("<script>alert(1)</script>");
    await page.locator("#cover").setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("The cover image was not accepted.")).toBeVisible();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Local e2e sofa guide");
    await page.getByLabel("Summary").fill("How a sofa gets from the listing to the room.");
    await page.getByLabel("Author display name").fill("Pickuply");
    await page.getByLabel("SEO title").fill("Sofa pickup guide");
    await page.getByLabel("SEO description").fill("A short guide to sofa pickup.");
    await page.locator("#block-0").fill("<script>alert(1)</script>");
    await page.locator("#cover").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
    await page.getByLabel("Cover image description").fill("Green sofa");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const draftUrl = page.url();
    const editor = page.locator("form").filter({ hasText: "Add image" }).last();
    await editor.getByRole("textbox", { name: "Image description", exact: true }).fill("Side of the sofa");
    await editor.locator('input[type="file"]').last().setInputFiles({ name: "side.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Image added. Save the article to keep it.")).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.goto("/blog/local-e2e-sofa-guide");
    await expect(page.getByText(/could not be found|not found/i)).toBeVisible();
    expect((await request.get("/blog/local-e2e-sofa-guide/cover")).status()).toBe(404);
    const hiddenSitemap = await page.request.get("/sitemap.xml");
    expect(await hiddenSitemap.text()).not.toContain("local-e2e-sofa-guide");
    await page.goto(draftUrl);
    await page.getByRole("link", { name: "Preview" }).click();
    await expect(page.getByText("Admin preview.")).toBeVisible();
    const article = page.getByRole("article");
    await expect(article.getByText("<script>alert(1)</script>")).toBeVisible();
    const injected = await article.evaluate((node) => node.querySelector("script, iframe") !== null || node.innerHTML.includes("<script"));
    expect(injected).toBe(false);

    await page.goBack();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await page.goto("/blog");
    await expect(page.getByRole("heading", { name: "Local e2e sofa guide" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "From the Pickuply Blog" })).toBeVisible();
    await page.getByRole("link", { name: "View all articles" }).click();
    await expect(page).toHaveURL(/\/blog$/);
    await page.goto("/blog/local-e2e-sofa-guide");
    const inlineSrc = await page.locator('img[alt="Side of the sofa"]').getAttribute("src");
    expect(inlineSrc).toBeTruthy();
    const inline = await request.get(inlineSrc ?? "");
    expect(inline.ok()).toBe(true);
    expect(inline.headers()["cache-control"]).toContain("no-store");
    await expect(page).toHaveTitle(/Sofa pickup guide/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "A short guide to sofa pickup.");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/blog\/local-e2e-sofa-guide$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/blog\/local-e2e-sofa-guide\/cover$/);
    const structured = await page.locator('script[type="application/ld+json"]').textContent();
    expect(structured).toContain("Local e2e sofa guide");
    expect(structured).not.toContain("<script>");
    const listed = await request.get("/sitemap.xml");
    expect(await listed.text()).toContain("/blog/local-e2e-sofa-guide");
    const cover = await request.get("/blog/local-e2e-sofa-guide/cover");
    expect(cover.ok()).toBe(true);
    expect(cover.headers()["content-type"]).toContain("image/png");
    expect(cover.headers()["cache-control"]).toContain("no-store");

    await page.goto(draftUrl);
    const publishedEditor = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) }).last();
    await publishedEditor.getByRole("textbox", { name: "Title", exact: true }).fill("Local e2e renamed sofa");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && response.ok()),
      publishedEditor.getByRole("button", { name: "Save" }).click(),
    ]);
    await expect(page.getByLabel("Slug").last()).toHaveValue("local-e2e-sofa-guide");
    await page.getByLabel("Slug").last().fill("local-e2e-moved-sofa");
    await expect(page.getByText("Changing this address.")).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && response.ok()),
      page.locator("form").filter({ hasText: "Changing this address" }).getByRole("button", { name: "Save" }).click(),
    ]);
    await page.reload();
    await expect(page.getByLabel("Slug").last()).toHaveValue("local-e2e-moved-sofa");
    await page.goto("/blog/local-e2e-sofa-guide");
    await expect(page).toHaveURL(/\/blog\/local-e2e-moved-sofa$/);
    const moved = await request.get("/sitemap.xml");
    expect(await moved.text()).toContain("/blog/local-e2e-moved-sofa");
    expect(await moved.text()).not.toContain("/blog/local-e2e-sofa-guide");

    await page.goto(draftUrl);
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await page.goto("/blog/local-e2e-moved-sofa");
    await expect(page.getByText(/could not be found|not found/i)).toBeVisible();
    expect((await request.get("/blog/local-e2e-moved-sofa/cover")).status()).toBe(404);
    if (inlineSrc) expect((await request.get(inlineSrc)).status()).toBe(404);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "From the Pickuply Blog" })).toHaveCount(0);
    const removed = await page.request.get("/sitemap.xml");
    expect(await removed.text()).not.toContain("local-e2e-sofa-guide");
    expect(await removed.text()).not.toContain("local-e2e-moved-sofa");

    await page.goto(draftUrl);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Article deleted.")).toBeVisible();
  } finally {
    cleanup();
  }
});
