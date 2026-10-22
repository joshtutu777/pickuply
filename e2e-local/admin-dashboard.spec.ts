import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";

const area = "Dashport 39901";
const password = "local-dashboard-test-password";

test("admin dashboard counts, filters, and blocks everyone else", async ({ browser }) => {
  const status = localStatus();
  const adminEmail = `dash-admin-${Date.now()}@pickuply.test`;
  const customerEmail = `dash-customer-${Date.now()}@pickuply.test`;
  const adminUser = await makeUser(status, adminEmail);
  const customerUser = await makeUser(status, customerEmail);
  localSql(
    `update public.profiles set role = 'admin', full_name = 'Alex Admin' where id = '${adminUser.id}';
     update public.profiles set full_name = 'Casey Customer' where id = '${customerUser.id}';`,
  );

  const admin = await browser.newContext();
  const customer = await browser.newContext();
  const stranger = await browser.newContext();
  try {
    await applySession(admin, status.url, adminUser.session);
    await applySession(customer, status.url, customerUser.session);
    const jobId = await createRequest(status, customerUser.session.access_token);

    const adminPage = await admin.newPage();
    await adminPage.goto("/admin");
    await expect(adminPage.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Needs your action" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "At a glance" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Drivers" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Payments" })).toHaveCount(0);
    await adminPage.getByText("Menu", { exact: false }).click();
    await expect(adminPage.locator("details").getByText("Coming in Step 5")).toBeVisible();

    const needsBox = await adminPage.getByRole("heading", { name: "Needs your action" }).boundingBox();
    const cardsBox = await adminPage.getByRole("heading", { name: "At a glance" }).boundingBox();
    expect(needsBox && cardsBox && needsBox.y < cardsBox.y).toBe(true);

    const reviewCount = await adminPage.getByRole("link", { name: /Review (request|driver)/ }).count();
    await expect(adminPage).toHaveTitle(reviewCount > 0 ? `(${reviewCount}) Pickuply Admin` : "Pickuply Admin");

    const card = adminPage.getByRole("link", { name: /New requests awaiting review/ });
    const shown = Number((await card.locator("span").first().innerText()).trim());
    const stored = Number(localSql("select count(*) from public.jobs where status in ('requested', 'in_review');").trim());
    expect(shown).toBe(stored);
    expect(shown).toBeGreaterThan(0);

    await card.click();
    await expect(adminPage).toHaveURL(/\/admin\/requests\?status=new/);
    await expect(adminPage.getByRole("heading", { name: "Requests & Quotes" })).toBeVisible();
    await expect(adminPage.locator("ul").getByText(area).first()).toBeVisible();

    await adminPage.goto("/admin");
    await adminPage.locator("li").filter({ hasText: area }).getByRole("link", { name: "Review request" }).click();
    await expect(adminPage).toHaveURL(new RegExp(`/admin/requests/${jobId}`));

    const customerPage = await customer.newPage();
    await customerPage.goto("/admin");
    await expect(customerPage).toHaveURL(/\/account\?error=forbidden/);

    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/admin");
    await expect(strangerPage).toHaveURL(/\/login/);
    expect(new URL(strangerPage.url()).searchParams.get("next")).toBe("/admin");
  } finally {
    await admin.close();
    await customer.close();
    await stranger.close();
    localSql(
      `delete from public.job_events where job_id in (select id from public.jobs where customer_id in ('${customerUser.id}', '${adminUser.id}'));
       delete from public.jobs where customer_id in ('${customerUser.id}', '${adminUser.id}');
       delete from auth.users where id in ('${customerUser.id}', '${adminUser.id}');`,
    );
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
  const admin = createClient(status.url, status.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "Could not create the local user.");
  const client = createClient(status.url, status.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
  const chunks: { name: string; value: string }[] = [];
  const expanded = encodeURIComponent(encoded);
  if (expanded.length <= 3180) {
    chunks.push({ name: key, value: encoded });
  } else {
    let rest = expanded;
    let index = 0;
    while (rest.length > 0) {
      const head = rest.slice(0, 3180);
      chunks.push({ name: `${key}.${index}`, value: decodeURIComponent(head) });
      rest = rest.slice(head.length);
      index += 1;
    }
  }
  await context.addCookies(
    chunks.map((chunk) => ({
      name: chunk.name,
      value: chunk.value,
      url: "http://127.0.0.1:3001",
    })),
  );
}

async function createRequest(status: { url: string; anon: string }, accessToken: string) {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${status.url}/rest/v1/rpc/create_customer_request`, {
    method: "POST",
    headers: {
      apikey: status.anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: requestId,
      payload: {
        service: "delivery",
        description: "TEST dashboard desk",
        pieces: "1",
        size: "medium",
        item_value_cents: "0",
        already_paid: false,
        seller_holding: true,
        wants_item_check: false,
        stairs_pickup: "0",
        stairs_dropoff: "0",
        elevator: false,
        help_loading: false,
        preferred_date: "asap",
        pricing_method: "quote",
        offer_cents: null,
        budget_min_cents: null,
        budget_max_cents: null,
        source: "other",
        zone_slug: "west_metro",
        pickup_area: area,
        dropoff_area: "Lithia Springs 30122",
        pickup_address: "100 Market Street",
        dropoff_address: "300 Pine Street",
        customer_name: "Casey Customer",
        customer_phone: "+15555550131",
      },
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return requestId;
}
