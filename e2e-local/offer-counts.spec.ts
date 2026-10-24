import { expect, test, type Page } from "@playwright/test";

const customer = { phone: "5555550177", otp: "101177" };

async function signIn(page: Page) {
  await page.goto("/login?next=/account/jobs");
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  await page.locator("#phone").fill(customer.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const alert = page.locator("main [role=alert]");
  const code = page.getByLabel("6-digit code");
  await expect(code.or(alert)).toBeVisible();
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  await code.fill(customer.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/account"), { timeout: 30_000 });
}

test("my requests shows offer counts and the requests badge", async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Your requests" })).toBeVisible();
  await expect(page.getByText(/Offers Received|Waiting for driver offers/).first()).toBeVisible();
  const requests = page.getByRole("navigation", { name: "Customer" }).getByRole("link", { name: /Requests/ });
  await expect(requests).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("requests.png"), fullPage: false });
});
