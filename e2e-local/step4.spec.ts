import { execFileSync } from "node:child_process";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const people = {
  customer: { phone: "5555550123", code: "101123", name: "Casey Customer" },
  driver: { phone: "5555550124", code: "101124", name: "Pat Driver" },
  driver2: { phone: "5555550125", code: "101125", name: "Bea Driver" },
  admin: { phone: "5555550126", code: "101126", name: "Alex Admin" },
};

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("local marketplace assignment does not charge or reveal the address", async ({ browser }) => {
  test.setTimeout(900_000);
  resetLocalPeople();
  const stripeUrls: string[] = [];
  const customer = await signedIn(browser, people.customer, stripeUrls);
  const driver = await signedIn(browser, people.driver, stripeUrls);
  const driver2 = await signedIn(browser, people.driver2, stripeUrls);
  const admin = await signedIn(browser, people.admin, stripeUrls);

  await onboard(driver.page, people.driver.name);
  await onboard(driver2.page, people.driver2.name);
  promoteAdmin();

  async function approveDriver(name: RegExp) {
    await admin.page.goto("/admin/drivers");
    await admin.page.getByRole("link", { name }).click();
    await expect(admin.page.getByRole("button", { name: "Approve driver" })).toBeVisible();
    const approveAnyway = admin.page.locator("input[name=approveAnyway]");
    if (await approveAnyway.count()) await approveAnyway.check();
    await admin.page.getByRole("button", { name: "Approve driver" }).click();
    await admin.page.waitForURL(/saved=1/);
  }
  await approveDriver(/Pat Driver/);
  await approveDriver(/Bea Driver/);
  finishChecklist(people.driver.phone);
  finishChecklist(people.driver2.phone);

  const fixedId = await createRequest(customer.context, {
    description: "TEST fixed desk",
    pricing_method: "fixed",
    offer_cents: "15000",
    pickup_area: "Austell 30168",
    dropoff_area: "Lithia Springs",
    pickup_address: "100 Market Street, Austell, GA 30168",
    dropoff_address: "200 Oak Street, Lithia Springs, GA 30122",
  });
  const quoteId = await createRequest(customer.context, {
    description: "TEST quote desk",
    pricing_method: "quote",
    offer_cents: null,
    pickup_area: "Lithia Springs 30122",
    dropoff_area: "Austell",
    pickup_address: "300 Pine Street, Lithia Springs, GA 30122",
    dropoff_address: "400 Elm Street, Austell, GA 30168",
  });

  await publish(admin.page, fixedId, "fixed");
  await goOnline(driver.page);
  await goOnline(driver2.page);

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Austell 30168").first()).toBeVisible();
  await driver.page.goto("/driver");
  const fixedCard = driver.page.locator("li").filter({ hasText: "Austell 30168" }).first();
  await fixedCard.getByRole("button", { name: "Review posted price" }).click();
  await fixedCard.getByRole("button", { name: "Confirm & Accept" }).click();
  await expect(fixedCard.getByText("Offer submitted successfully.")).toBeVisible();

  const fixedSchedule = scheduleSnapshot(fixedId);
  await customer.page.goto(`/jobs/${fixedId}`);
  await dismissCookies(customer.page);
  await expect(customer.page.getByText("Service fee $7.50")).toBeVisible();
  await expect(customer.page.getByText("Total $157.50")).toBeVisible();
  await customer.page.getByRole("button", { name: /Choose (Pat|this driver)/ }).click();
  await expectAssigned(customer.page);
  expect(scheduleSnapshot(fixedId)).toBe(fixedSchedule);
  expect(assignmentRow(fixedId)).toMatchObject({
    status: "assigned",
    payment: "awaiting_payment",
    chosen: 1,
    payments: 0,
    events: 1,
    arrival: "none",
  });

  const customId = await createRequest(customer.context, {
    description: "TEST custom desk",
    pricing_method: "fixed",
    offer_cents: "15000",
    pickup_area: "Austell custom",
    dropoff_area: "Austell",
    pickup_address: "110 Custom Street, Austell, GA 30168",
    dropoff_address: "210 Custom Street, Austell, GA 30168",
  });
  await publish(admin.page, customId, "fixed");
  await offerWithoutArrival(driver.page, "Austell custom", "custom");
  const customSchedule = scheduleSnapshot(customId);
  await customer.page.goto(`/jobs/${customId}`);
  await dismissCookies(customer.page);
  await expect(customer.page.getByText("Service fee $4")).toBeVisible();
  await expect(customer.page.getByText("Total $84")).toBeVisible();
  await customer.page.getByRole("button", { name: /Choose (Pat|this driver)/ }).click();
  await expectAssigned(customer.page);
  expect(scheduleSnapshot(customId)).toBe(customSchedule);
  expect(assignmentRow(customId).chosen).toBe(1);
  expect(assignmentRow(customId).payments).toBe(0);

  for (const timing of ["asap", "anytime", "windows", "specific"] as const) {
    const timedId = await createRequest(customer.context, {
      description: `TEST ${timing} desk`,
      pricing_method: "fixed",
      offer_cents: "5000",
      pickup_area: `Austell ${timing}`,
      dropoff_area: "Austell",
      pickup_address: `120 ${timing} Street, Austell, GA 30168`,
      dropoff_address: `220 ${timing} Street, Austell, GA 30168`,
    });
    await publish(admin.page, timedId, "fixed");
    setTiming(timedId, timing);
    const before = scheduleSnapshot(timedId);
    await offerWithoutArrival(driver.page, `Austell ${timing}`, "posted");
    await customer.page.goto(`/jobs/${timedId}`);
    await dismissCookies(customer.page);
    await expect(customer.page.getByText("Service fee $2.50")).toBeVisible();
    await expect(customer.page.getByText("Total $52.50")).toBeVisible();
    await customer.page.getByRole("button", { name: /Choose (Pat|this driver)/ }).click();
    await expectAssigned(customer.page);
    expect(scheduleSnapshot(timedId)).toBe(before);
    expect(assignmentRow(timedId)).toMatchObject({ chosen: 1, payments: 0, events: 1, arrival: "none" });
  }

  await driver.page.goto(`/driver/jobs/${fixedId}`);
  await expect(driver.page.getByText("100 Market Street, Austell, GA 30168")).toBeVisible();
  await expect(driver.page.getByText("Payment: awaiting payment")).toBeVisible();

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Austell 30168")).toHaveCount(0);
  await driver2.page.goto(`/driver/jobs/${fixedId}`);
  await expect(driver2.page.getByText("100 Market Street")).toHaveCount(0);

  await publish(admin.page, quoteId, "quote");
  await customer.page.goto(`/jobs/${quoteId}`);
  await customer.page.getByRole("button", { name: "Accept quote" }).click();
  await expect(customer.page.getByRole("heading", { name: "Open for drivers" })).toBeVisible();

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Lithia Springs 30122")).toBeVisible();
  await driver.page.goto("/driver");
  const quoteCard = driver.page.locator("li").filter({ hasText: "Lithia Springs 30122" });
  await quoteCard.getByRole("button", { name: "Claim this job" }).click();
  await expect(driver.page.locator(`a[href="/driver/jobs/${quoteId}"]`)).toContainText("assigned");

  await driver2.page.goto("/driver");
  await expect(driver2.page.getByText("Lithia Springs 30122")).toHaveCount(0);
  await driver2.page.goto(`/driver/jobs/${quoteId}`);
  await expect(driver2.page.getByText("300 Pine Street")).toHaveCount(0);

  const fixedPayment = jobPayment(fixedId);
  const quotePayment = jobPayment(quoteId);
  expect(fixedPayment).toMatchObject({
    status: "assigned",
    payment_status: "awaiting_payment",
    due: true,
    stripe: false,
    assignees: 1,
  });
  expect(quotePayment).toMatchObject({
    status: "assigned",
    payment_status: "awaiting_payment",
    due: true,
    stripe: false,
    assignees: 1,
  });

  const blocked = await patchJob(driver.context, fixedId, { status: "en_route" });
  expect(blocked).not.toContain("en_route");
  expect(jobPayment(fixedId).status).toBe("assigned");
  expect(stripeUrls).toEqual([]);

  await customer.page.goto(`/jobs/${fixedId}`);
  const progress = customer.page.getByRole("region", { name: "Job progress" });
  await expect(progress.getByLabel("Step 2 of 4: Driver Confirmed")).toBeVisible();
  await expect(progress.getByText("Confirm booking — your card is held, not charged, until your item is delivered.")).toBeVisible();
  await progress.getByText("See full history").click();
  await expect(progress.getByRole("listitem").filter({ hasText: "Request received" })).toBeVisible();

  const messages = customer.page.getByRole("region", { name: "Messages" });
  const message = messages.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("call me at 404-555-0100");
  await expect(messages.getByText("For your safety, contact details can't be shared in chat")).toBeVisible();
  await expect(messages.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await message.fill("Please use the side door");
  await messages.getByRole("button", { name: "Send", exact: true }).click();
  await expect(messages.getByText("Please use the side door")).toBeVisible();

  const driverMessages = driver.page.getByRole("region", { name: "Messages" });
  await driver.page.goto(`/driver/jobs/${fixedId}`);
  await expect(driverMessages.getByText("Please use the side door")).toBeVisible();
  await driverMessages.getByRole("button", { name: "I'm outside" }).click();
  await driverMessages.getByRole("button", { name: "Send" }).click();
  await expect(driverMessages.locator("li").filter({ hasText: "I'm outside" })).toBeVisible();

  await customer.page.reload();
  await expect(customer.page.getByRole("region", { name: "Messages" }).locator("li").filter({ hasText: "I'm outside" })).toBeVisible();
  await customer.page.locator("#report-category").selectOption("damaged");
  await customer.page.locator("#report-description").fill("The desk corner is cracked.");
  await customer.page.locator("#report-outcome").selectOption("repair");
  await customer.page.getByRole("button", { name: "Send report" }).click();
  await expect(customer.page.getByText("Report saved.")).toBeVisible();
  await customer.page.reload();
  await expect(customer.page.getByRole("heading", { name: "Disputed" })).toBeVisible();
  expect(jobPayment(fixedId).status).toBe("disputed");

  await customer.context.close();
  await driver.context.close();
  await driver2.context.close();
  await admin.context.close();
});

async function signedIn(
  browser: Browser,
  person: { phone: string; code: string; name: string },
  stripeUrls: string[],
) {
  const context = await browser.newContext();
  context.on("request", (request) => {
    if (request.url().toLowerCase().includes("stripe")) stripeUrls.push(new URL(request.url()).host);
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  if (page.url().includes("/login/name")) {
    const nameParts = person.name.trim().split(/\s+/);
    await page.getByLabel("First name").fill(nameParts[0] ?? "");
    await page.getByLabel("Last name").fill(nameParts.slice(1).join(" "));
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }
  return { context, page };
}

async function onboard(page: Page, name: string) {
  await page.goto("/driver/onboarding");
  const cookies = page.getByRole("button", { name: "Reject optional cookies" });
  if (await cookies.isVisible()) await cookies.click();
  const nameParts = name.trim().split(/\s+/);
  await page.getByLabel("First name").fill(nameParts[0] ?? "");
  await page.getByLabel("Last name").fill(nameParts.slice(1).join(" "));
  const email = page.getByLabel("Email address");
  if ((await email.inputValue()) === "") {
    await email.fill(`${(nameParts[0] ?? "driver").toLowerCase()}.${(nameParts[1] ?? "driver").toLowerCase()}@pickuply.test`);
  }
  await page.getByLabel("Street").fill("10 Test Street");
  await page.getByRole("textbox", { name: "City" }).fill("Austell");
  await page.getByRole("textbox", { name: "ZIP", exact: true }).fill("30106");
  await page.locator("#vehicleType").selectOption("pickup");
  await page.getByRole("radio", { name: "Light load" }).check();
  await page.locator("#licenseExpires").fill("2027-12-31");
  const photo = { name: "photo.png", mimeType: "image/png", buffer: png };
  await page.locator("#profilePhoto").setInputFiles(photo);
  await page.locator("#licensePhoto").setInputFiles(photo);
  await page.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
  await page.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/driver\?saved=applied/);
}

function finishChecklist(phone: string) {
  localSql(`
    update public.drivers as drivers
    set insurance_url = drivers.profile_id::text || '/insurance.jpg',
        insurance_expires = '2027-12-31',
        agreement_signed_at = now(),
        agreement_signature = 'signed',
        agreement_version = '2026-10',
        training_completed_at = now(),
        services = '{delivery}',
        kit_saved_at = now()
    from auth.users
    where drivers.profile_id = auth.users.id
      and auth.users.phone in ('1${phone}', '+1${phone}');
    update public.vehicles
    set make = 'Ford', model = 'F150', year = 2018, plate = 'TEST123',
        cargo_length_in = 72, photo_url = driver_id::text || '/vehicle.jpg', approved = true
    where driver_id in (select id from auth.users where phone in ('1${phone}', '+1${phone}'));
  `);
}

function promoteAdmin() {
  localSql(
    "update public.profiles p set role = 'admin' from auth.users u where p.id = u.id and u.phone in ('15555550126', '+15555550126');",
  );
}

async function createRequest(
  context: BrowserContext,
  details: {
    description: string;
    pricing_method: "fixed" | "quote";
    offer_cents: string | null;
    pickup_area: string;
    dropoff_area: string;
    pickup_address: string;
    dropoff_address: string;
  },
) {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/create_customer_request`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${await accessToken(context)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: requestId,
      payload: {
        service: "delivery",
        description: details.description,
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
        pricing_method: details.pricing_method,
        offer_cents: details.offer_cents,
        budget_min_cents: null,
        budget_max_cents: null,
        source: "other",
        zone_slug: "west_metro",
        pickup_area: details.pickup_area,
        dropoff_area: details.dropoff_area,
        pickup_address: details.pickup_address,
        dropoff_address: details.dropoff_address,
        customer_name: "Casey Customer",
        customer_phone: "+15555550123",
      },
    }),
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return requestId;
}

async function patchJob(context: BrowserContext, jobId: string, body: Record<string, string>) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}`,
    {
      method: "PATCH",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${await accessToken(context)}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );
  return response.text();
}

async function accessToken(context: BrowserContext) {
  const cookies = await context.cookies();
  const raw = cookies
    .filter((cookie) => cookie.name.includes("auth-token"))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((cookie) => cookie.value)
    .join("");
  if (!raw) throw new Error("The local session cookie is missing.");
  const decoded = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
    : decodeURIComponent(raw);
  const session = JSON.parse(decoded.startsWith("base64-")
    ? Buffer.from(decoded.slice("base64-".length), "base64url").toString("utf8")
    : decoded) as { access_token?: string };
  if (!session.access_token) throw new Error("The local session has no access token.");
  return session.access_token;
}

async function publish(page: Page, jobId: string, kind: "fixed" | "quote") {
  if (kind === "fixed") {
    const status = localSql(`select status from public.jobs where id = '${jobId}'`).trim();
    expect(status).toBe("open");
    return;
  }
  await page.goto(`/admin/requests/${jobId}`);
  await page.locator("#serviceLevel").selectOption("light");
  await page.locator("#requiredVehicle").selectOption("pickup");
  await page.locator("#driverPay").fill("60");
  await page.locator("#preferredDate").fill("2026-10-30");
  await page.locator("#timeWindow").selectOption("morning");
  await page.getByRole("button", { name: "Send quote" }).click();
  await page.waitForURL(/saved=1|error=/);
  await expect(page).not.toHaveURL(/error=/);
}

async function dismissCookies(page: Page) {
  const cookies = page.getByRole("button", { name: "Reject optional cookies" });
  if (await cookies.isVisible().catch(() => false)) await cookies.click();
}

async function expectAssigned(page: Page) {
  await dismissCookies(page);
  await expect(page.getByRole("heading", { name: "Driver assigned" })).toBeVisible();
  await expect(page.getByText("Pat is your driver.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm booking" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Choose / })).toHaveCount(0);
}

async function offerWithoutArrival(page: Page, area: string, mode: "posted" | "custom") {
  await page.goto("/driver");
  const card = page.locator("li").filter({ hasText: area }).first();
  await expect(card).toBeVisible();
  if (mode === "custom") {
    await card.getByLabel("Offer Amount ($)").fill("80");
    await card.getByRole("button", { name: "Review offer" }).click();
  } else {
    await card.getByRole("button", { name: "Review posted price" }).click();
  }
  await card.getByRole("button", { name: mode === "custom" ? "Confirm & Submit Offer" : "Confirm & Accept" }).click();
  await expect(card.getByText("Offer submitted successfully.")).toBeVisible();
}

function setTiming(jobId: string, kind: "asap" | "anytime" | "windows" | "specific") {
  if (kind === "asap" || kind === "anytime") {
    localSql(`
      begin;
      select set_config('pickuply.schedule_write', 'yes', true);
      update public.jobs
      set pickup_availability = '${kind}', pickup_timezone = 'America/New_York'
      where id = '${jobId}';
      commit;
    `);
    return;
  }
  if (kind === "windows") {
    localSql(`
      begin;
      select set_config('pickuply.schedule_write', 'yes', true);
      update public.jobs
      set pickup_availability = 'windows', pickup_timezone = 'America/New_York'
      where id = '${jobId}';
      insert into public.job_pickup_windows (job_id, starts_at, ends_at, position)
      values ('${jobId}', now() + interval '2 days', now() + interval '2 days 3 hours', 1);
      commit;
    `);
    return;
  }
  localSql(`
    begin;
    select set_config('pickuply.schedule_write', 'yes', true);
    update public.jobs
    set scheduled_pickup_start = now() + interval '3 days',
        scheduled_pickup_end = now() + interval '3 days 2 hours'
    where id = '${jobId}';
    commit;
  `);
}

function scheduleSnapshot(jobId: string) {
  return localSql(`
    select coalesce(j.pickup_availability, '') || '|' ||
      coalesce(j.scheduled_pickup_start::text, '') || '|' ||
      coalesce(j.scheduled_pickup_end::text, '') || '|' ||
      (select count(*)::text from public.job_pickup_windows w where w.job_id = j.id)
    from public.jobs j where j.id = '${jobId}'
  `).trim();
}

function assignmentRow(jobId: string) {
  const line = localSql(`
    select j.status || '|' || coalesce(j.payment_status, '') || '|' ||
      (select count(*) from public.job_offers o where o.job_id = j.id and o.status = 'chosen') || '|' ||
      (select count(*) from public.job_payments p where p.job_id = j.id) || '|' ||
      (select count(*) from public.job_events e where e.job_id = j.id and e.type = 'offer_chosen') || '|' ||
      case when exists (
        select 1 from public.job_offers o
        where o.job_id = j.id and o.status = 'chosen'
          and o.proposed_pickup_start is null and o.proposed_pickup_end is null
      ) then 'none' else 'set' end
    from public.jobs j where j.id = '${jobId}'
  `).trim();
  const [status, payment, chosen, payments, events, arrival] = line.split("|");
  return {
    status,
    payment,
    chosen: Number(chosen),
    payments: Number(payments),
    events: Number(events),
    arrival,
  };
}

async function goOnline(page: Page) {
  await page.goto("/driver");
  await page.getByRole("switch", { name: "You are Offline" }).click();
  await expect(page.getByRole("switch", { name: "You are Online" })).toBeVisible();
}

function jobPayment(jobId: string) {
  const output = localSql(
    `select j.status || '|' || coalesce(j.payment_status, '') || '|' || (j.payment_due_at is not null)::text || '|' || (p.payment_intent_id is not null)::text || '|' || (j.assigned_driver_id is not null)::text from public.jobs j left join public.job_payments p on p.job_id = j.id where j.id = '${jobId}'`,
  );
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.includes("|"));
  if (!line) throw new Error("Could not read the local job payment row.");
  const [status, paymentStatus, due, stripe, assignees] = line.split("|").map((item) => item.trim());
  return {
    status,
    payment_status: paymentStatus,
    due: due === "true",
    stripe: stripe === "true",
    assignees: assignees === "true" ? 1 : 0,
  };
}

function resetLocalPeople() {
  const phones = "('15555550123', '+15555550123', '15555550124', '+15555550124', '15555550125', '+15555550125', '15555550126', '+15555550126')";
  localSql(`
    alter table public.job_photos disable trigger job_photos_lock;
    delete from public.job_events
    where actor_id in (select id from auth.users where phone in ${phones})
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in ${phones})
          or assigned_driver_id in (select id from auth.users where phone in ${phones})
      );
    update public.jobs set accepted_offer_id = null
    where customer_id in (select id from auth.users where phone in ${phones})
      or assigned_driver_id in (select id from auth.users where phone in ${phones});
    delete from public.job_offers
    where driver_id in (select id from auth.users where phone in ${phones});
    delete from public.driver_bank_payouts
    where driver_id in (select id from auth.users where phone in ${phones});
    delete from public.job_photos
    where job_id in (
      select id from public.jobs
      where customer_id in (select id from auth.users where phone in ${phones})
        or assigned_driver_id in (select id from auth.users where phone in ${phones})
    );
    delete from public.jobs
    where customer_id in (select id from auth.users where phone in ${phones})
      or assigned_driver_id in (select id from auth.users where phone in ${phones});
    delete from public.messages
    where sender_id in (select id from auth.users where phone in ${phones});
    delete from public.message_reads
    where profile_id in (select id from auth.users where phone in ${phones});
    delete from public.message_threads
    where requester_id in (select id from auth.users where phone in ${phones})
      or driver_id in (select id from auth.users where phone in ${phones});
    delete from public.audit_log
    where actor_id in (select id from auth.users where phone in ${phones})
      or target_id in (select id from auth.users where phone in ${phones});
    update public.support_tickets
    set assigned_admin_id = null
    where assigned_admin_id in (select id from auth.users where phone in ${phones});
    delete from public.support_ticket_messages
    where author_id in (select id from auth.users where phone in ${phones})
      or ticket_id in (
        select id from public.support_tickets
        where profile_id in (select id from auth.users where phone in ${phones})
      );
    delete from public.support_tickets
    where profile_id in (select id from auth.users where phone in ${phones});
    delete from public.profiles
    where id in (select id from auth.users where phone in ${phones});
    delete from auth.users where phone in ${phones};
    alter table public.job_photos enable trigger job_photos_lock;
  `);
}

function localSql(sql: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A"],
    { encoding: "utf8", input: sql },
  );
}
