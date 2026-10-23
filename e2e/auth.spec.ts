import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { normalizeUsPhone } from "../lib/phone";
import { supabaseProjectUrl } from "../lib/supabase/project-url";

  // Hosted phone sign-in allows one code every 5 seconds. Leave extra room so
  // the next test does not get "Too many attempts" when the previous send is still recent.
  let lastCodeRequest = 0;

  async function waitForCodeWindow() {
    const elapsed = Date.now() - lastCodeRequest;
    if (lastCodeRequest !== 0 && elapsed < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 15_000 - elapsed));
    }
    lastCodeRequest = Date.now();
  }

test("login page shows the phone form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  await expect(page.getByRole("button", { name: "Text me a code" })).toBeVisible();
  await expect(page.getByText(/Enter the 6-digit code for/)).toHaveCount(0);
});

test("an invalid phone does not claim a text was sent", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill("123");
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.locator("#phone-error")).toHaveText("Enter a valid US phone number.");
  await expect(page.getByText(/Enter the 6-digit code for/)).toHaveCount(0);
});

test("signed-out protected pages go to login", async ({ page }) => {
  for (const path of ["/account", "/driver", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(path);
  }
});

test("pwa files are not redirected to login", async ({ request }) => {
  const worker = await request.get("/sw.js");
  expect(worker.url()).not.toContain("/login");
  expect([200, 404]).toContain(worker.status());

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.url()).not.toContain("/login");
  expect(manifest.status()).toBe(200);

  const icon = await request.get("/icons/icon-192.png");
  expect(icon.url()).not.toContain("/login");
  expect(icon.status()).toBe(200);
});

test.describe("phone sign-in", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("wrong code stays on login", async ({ page }) => {
    const phone = requiredCustomerPhone();
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone);
    await waitForCodeWindow();
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByText(/Enter the 6-digit code for \(•••\) •••-\d{4}\./)).toBeVisible();
    const otp = process.env.TEST_OTP ?? "";
    await page.getByLabel("6-digit code").fill(otp === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.locator("#code-error")).toContainText("wrong or expired");
    await expect(page).toHaveURL(/\/login/);
  });

  test("resend stays disabled after a code is sent", async ({ page }) => {
    const phone = requiredCustomerPhone();
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone);
    await waitForCodeWindow();
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByRole("button", { name: "Resend code" })).toBeDisabled();
  });

  test("sign-in and sign-out", async ({ page }) => {
    const { phone, otp } = customerLogin();
    await signIn(page, phone, otp);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("link", { name: "Sign up / Sign in" })).toBeVisible();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?/);
  });

  test("session survives a reload", async ({ page }) => {
    const { phone, otp } = customerLogin();
    await signIn(page, phone, otp);
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("account, driver, and admin return through login", async ({ page }) => {
    const { phone, otp } = customerLogin();

    await page.goto("/account");
    await signInOnPage(page, phone, otp);
    await expect(page).toHaveURL(/\/account$/);

    await page.context().clearCookies();
    await page.goto("/driver");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/driver");
    await signInOnPage(page, phone, otp);
    await expect(page).toHaveURL(/\/driver$/);
    await expect(page.getByRole("heading", { name: "Become a driver" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start driver signup" })).toHaveAttribute(
      "href",
      "/driver/onboarding",
    );
    await expect(page.getByText("You don't have access to that page.")).toHaveCount(0);

    await page.context().clearCookies();
    await page.goto("/admin");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/admin");
    await signInOnPage(page, phone, otp);
    await expect(page).toHaveURL(/\/account\?error=forbidden/);
    await expect(page.getByText("You don't have access to that page.")).toBeVisible();
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("an external next is dropped", async ({ page }) => {
    const { phone, otp } = customerLogin();
    await page.goto("/login?next=https://evil.example");
    await signInOnPage(page, phone, otp);
    await expect(page).not.toHaveURL(/evil\.example/);
    expect(new URL(page.url()).hostname).toBe("127.0.0.1");
    await expect(page).toHaveURL(/\/account/);
  });

  test("a direct profile role update to admin fails", async () => {
    const { phone, otp } = customerLogin();
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const url = rawUrl ? supabaseProjectUrl(rawUrl) : "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    test.skip(
      url.length === 0 || anonKey.length === 0,
      "Skipped sign-in tests: the public Supabase URL and anon key are missing.",
    );
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      await waitForCodeWindow();
      const sent = await supabase.auth.signInWithOtp({ phone, options: { channel: "sms" } });
      if (sent.error) throw new Error("Sign-in failed before the role check.");
      const verified = await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" });
      if (verified.error) throw new Error("Sign-in failed before the role check.");
      const user = await supabase.auth.getUser();
      const userId = user.data.user?.id ?? "";
      if (user.error || userId.length === 0) throw new Error("Sign-in failed before the role check.");
      const updated = await supabase.from("profiles").update({ role: "admin" }).eq("id", userId);
      if (!updated.error) throw new Error("The profile role update should have been rejected.");
      const read = await supabase.from("profiles").select("role").eq("id", userId).single();
      expect(read.data?.role).toBe("customer");
    } finally {
      await supabase.auth.signOut();
    }
  });
});

test("admin browser login", async ({ page }) => {
  test.setTimeout(120_000);
  const phone = normalizeUsPhone(process.env.TEST_ADMIN_PHONE ?? "");
  const otp = process.env.TEST_ADMIN_OTP ?? "";
  test.skip(
    !phone || otp.length === 0,
    "Skipped admin browser login: set TEST_ADMIN_PHONE and TEST_ADMIN_OTP in .env.local.",
  );
  await page.goto("/admin");
  await signInOnPage(page, phone as string, otp);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByText("You don't have access to that page.")).toHaveCount(0);
});

function customerLogin(): { phone: string; otp: string } {
  const phone = requiredCustomerPhone();
  const otp = process.env.TEST_OTP ?? "";
  test.skip(
    otp.length === 0,
    "Skipped sign-in tests: set TEST_PHONE and TEST_OTP in .env.local (gitignored). .env.test is also gitignored.",
  );
  return { phone, otp };
}

function requiredCustomerPhone(): string {
  const phone = normalizeUsPhone(process.env.TEST_PHONE ?? "");
  test.skip(
    !phone || (process.env.TEST_OTP ?? "").length === 0,
    "Skipped sign-in tests: set TEST_PHONE and TEST_OTP in .env.local (gitignored). .env.test is also gitignored.",
  );
  return phone as string;
}

async function signIn(page: Page, phone: string, otp: string) {
  await page.goto("/login");
  await signInOnPage(page, phone, otp);
}

async function signInOnPage(page: Page, phone: string, otp: string) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  const phoneInput = page.locator("#phone");
  await phoneInput.fill(phone);
  await expect(phoneInput).toHaveValue(phone);
  await waitForCodeWindow();
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByText(/Enter the 6-digit code for \(•••\) •••-\d{4}\./)).toBeVisible();
  await page.getByLabel("6-digit code").fill(otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/login/name" ||
      (url.pathname !== "/auth/continue" && !url.pathname.startsWith("/login")),
    { timeout: 20_000 },
  );
  if (new URL(page.url()).pathname === "/login/name") {
    await page.getByLabel("First name").fill("Test Customer");
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => url.pathname !== "/login/name" && !url.pathname.startsWith("/auth"));
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
