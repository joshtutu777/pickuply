import { execFileSync } from "node:child_process";
import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const password = "local-hotfix-validation-password";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const longStreet = "12345 Extraordinarilylongstreetnamewithoutspaces Northwest Connector";

test("item loaded advances once, and the customer is not asked to confirm yet", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now().toString(16);
  const jobId = "c1910000-0000-4000-8000-000000000011";
  localSql(`
    alter table public.job_photos disable trigger job_photos_lock;
    delete from public.job_photos where job_id = '${jobId}';
    delete from public.job_events where job_id = '${jobId}';
    delete from public.notifications where job_id = '${jobId}';
    delete from public.job_private where job_id = '${jobId}';
    delete from public.jobs where id = '${jobId}';
    alter table public.job_photos enable trigger job_photos_lock;
  `);
  const customer = await makeUser(status, `hotfix-load-customer-${stamp}@pickuply.test`);
  const driver = await makeUser(status, `hotfix-load-driver-${stamp}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Load Customer', is_test = true where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Load Driver', is_test = true where id = '${driver.id}';
    insert into public.drivers (
      profile_id, status, zone_id, service_level, services, is_online,
      license_expires, terms_version, terms_accepted_at, agreement_signed_at
    ) values (
      '${driver.id}', 'active', (select id from public.zones where slug = 'west_metro'),
      'full', array['delivery']::public.job_service[], true,
      current_date + 30, 'driver-terms-v1', now(), now()
    );
    insert into public.vehicles (driver_id, type, make, approved)
    values ('${driver.id}', 'pickup', 'Ford', true);
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
      offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
      assigned_driver_id, payment_status, is_test
    ) values (
      '${jobId}', '${customer.id}',
      'delivery', 'arrived', (select id from public.zones where slug = 'west_metro'),
      'Austell 30106', 'Smyrna 30080', 'hotfix dresser', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed',
      7500, 7755, 6375, 1125, 255,
      '${driver.id}', 'authorized', true
    );
    insert into public.job_private (job_id, pickup_address, dropoff_address, customer_name, customer_phone)
    values (
      '${jobId}',
      '${longStreet}, Austell, GA 30106',
      '99 Hidden Dropoff Avenue, Smyrna, GA 30080',
      'Load Customer',
      '+14045550191'
    );
  `);

  const driverContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const pageErrors: string[] = [];
  await applySession(driverContext, status.url, driver.session);
  await applySession(customerContext, status.url, customer.session);
  const driverPage = await driverContext.newPage();
  const customerPage = await customerContext.newPage();
  driverPage.on("pageerror", (error) => pageErrors.push(error.message));
  let releaseAdvance = () => {};
  const holdAdvance = new Promise<void>((resolve) => {
    releaseAdvance = resolve;
  });
  await driverPage.route("**/driver/jobs/**", async (route) => {
    const action = route.request().headers()["next-action"];
    if (route.request().method() === "POST" && action) await holdAdvance;
    await route.continue();
  });
  try {
    await driverPage.goto(`/driver/jobs/${jobId}`);
    await dismissChrome(driverPage);
    await driverPage.locator("#proof-file").setInputFiles({ name: "pickup.png", mimeType: "image/png", buffer: png });
    await driverPage.getByRole("button", { name: "Save proof" }).click();
    await expect(driverPage.getByText("Proof saved. It cannot be replaced.")).toBeVisible();
    const loaded = driverPage.getByRole("button", { name: "Item loaded" });
    const firstClick = loaded.click();
    await expect(loaded).toBeDisabled();
    releaseAdvance();
    await firstClick;
    await expect(driverPage.getByRole("button", { name: "Proceed to drop-off" })).toBeVisible();
    await expect(driverPage.getByText("Application error")).toHaveCount(0);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    expect(localSql(`select status from public.jobs where id = '${jobId}'`).trim()).toBe("item_check");
    expect(localSql(`select count(*) from public.job_events where job_id = '${jobId}' and type = 'status' and data->>'to' = 'item_check'`).trim()).toBe("1");
    await expect(driverPage.getByText("Item loaded").first()).toBeVisible();

    await customerPage.goto(`/jobs/${jobId}`);
    await dismissChrome(customerPage);
    await expect(customerPage.getByRole("heading", { name: "Does everything look good?" })).toHaveCount(0);
    await expect(customerPage.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
    await driverPage.screenshot({ path: "C:/Users/Josh/AppData/Local/Temp/pickuply-hotfix-evidence/item-loaded-driver.png", fullPage: true });
    await customerPage.screenshot({ path: "C:/Users/Josh/AppData/Local/Temp/pickuply-hotfix-evidence/item-loaded-customer.png", fullPage: true });
    await expect(customerPage.getByText("Your item is loaded.", { exact: true })).toBeVisible();
    test.info().annotations.push({
      type: "item-loaded",
      description: "Proceed to drop-off visible, database item_check, customer confirm absent, no pageerror",
    });
  } finally {
    releaseAdvance();
    await driverContext.close();
    await customerContext.close();
    localSql(`
      alter table public.job_photos disable trigger job_photos_lock;
      delete from public.job_photos where job_id = '${jobId}';
      delete from public.job_events where job_id = '${jobId}';
      delete from public.notifications where job_id = '${jobId}';
      delete from public.job_private where job_id = '${jobId}';
      delete from public.jobs where id = '${jobId}';
      delete from public.vehicles where driver_id = '${driver.id}';
      delete from public.drivers where profile_id = '${driver.id}';
      alter table public.job_photos enable trigger job_photos_lock;
    `);
    await deleteUser(status, customer.id);
    await deleteUser(status, driver.id);
  }
});

test("customer and driver receipts keep long text inside the screen", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now().toString(16);
  const jobId = "c1910000-0000-4000-8000-000000000012";
  const customer = await makeUser(status, `hotfix-receipt-customer-${stamp}@pickuply.test`);
  const driver = await makeUser(status, `hotfix-receipt-driver-${stamp}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Receipt Customer', is_test = true where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Receipt Driver', is_test = true where id = '${driver.id}';
    insert into public.drivers (
      profile_id, status, zone_id, service_level, services, is_online,
      license_expires, terms_version, terms_accepted_at, agreement_signed_at
    ) values (
      '${driver.id}', 'active', (select id from public.zones where slug = 'west_metro'),
      'full', array['delivery']::public.job_service[], true,
      current_date + 30, 'driver-terms-v1', now(), now()
    );
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
      offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
      assigned_driver_id, payment_status, is_test
    ) values (
      '${jobId}', '${customer.id}',
      'delivery', 'completed', (select id from public.zones where slug = 'west_metro'),
      'Austell 30106', 'Smyrna 30080', 'receipt dresser', 1, 'medium',
      0, 0, false, false, 'asap', 'fixed',
      7500, 7755, 6375, 1125, 255,
      '${driver.id}', 'captured', true
    );
    insert into public.job_private (job_id, pickup_address, dropoff_address, customer_name, customer_phone, customer_email)
    values (
      '${jobId}',
      '${longStreet}, Austell, GA 30106',
      '99 Hidden Dropoff Avenue With An Unbroken Long Name, Smyrna, GA 30080',
      'Receipt Customer',
      '+14045550192',
      'receipt-customer-${stamp}@pickuply.test'
    );
  `);
  const customerContext = await browser.newContext();
  const driverContext = await browser.newContext();
  await applySession(customerContext, status.url, customer.session);
  await applySession(driverContext, status.url, driver.session);
  const customerPage = await customerContext.newPage();
  const driverPage = await driverContext.newPage();
  try {
    const widths = [320, 375, 390, 430];
    for (const width of widths) {
      await customerPage.setViewportSize({ width, height: 800 });
      await customerPage.goto(`/jobs/${jobId}`);
      await dismissChrome(customerPage);
      await expect(customerPage.getByRole("heading", { name: "Receipt" })).toBeVisible();
      await expect(customerPage.getByText("$77.55").first()).toBeVisible();
      await expect(customerPage.getByText(jobId).first()).toBeVisible();
      await customerPage.getByRole("tab", { name: "Details" }).click();
      await expect(customerPage.getByText(longStreet)).toBeVisible();
      const customerOverflow = await overflow(customerPage);
      expect(customerOverflow, `customer ${width}`).toBeLessThanOrEqual(1);
      if (width === 320) {
        await customerPage.screenshot({ path: "C:/Users/Josh/AppData/Local/Temp/pickuply-hotfix-evidence/receipt-customer-320.png", fullPage: true });
      }

      await driverPage.setViewportSize({ width, height: 800 });
      await driverPage.goto(`/driver/jobs/${jobId}`);
      await dismissChrome(driverPage);
      await expect(driverPage.getByText("$63.75").first()).toBeVisible();
      await expect(driverPage.getByText(longStreet)).toBeVisible();
      const driverOverflow = await overflow(driverPage);
      expect(driverOverflow, `driver ${width}`).toBeLessThanOrEqual(1);
      if (width === 320) {
        await driverPage.screenshot({ path: "C:/Users/Josh/AppData/Local/Temp/pickuply-hotfix-evidence/receipt-driver-320.png", fullPage: true });
      }
    }
    test.info().annotations.push({
      type: "receipt",
      description: "No sideways scroll at 320, 375, 390, and 430. Amounts $77.55 and $63.75 stayed visible.",
    });
  } finally {
    await customerContext.close();
    await driverContext.close();
    localSql(`
      delete from public.job_events where job_id = '${jobId}';
      delete from public.notifications where job_id = '${jobId}';
      delete from public.job_private where job_id = '${jobId}';
      delete from public.jobs where id = '${jobId}';
      delete from public.drivers where profile_id = '${driver.id}';
    `);
    await deleteUser(status, customer.id);
    await deleteUser(status, driver.id);
  }
});

test("one new alert shows once and plays one chime for the intended driver", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now().toString(16);
  const title = `Hotfix alert ${stamp}`;
  const driver = await makeUser(status, `hotfix-alert-driver-${stamp}@pickuply.test`);
  const other = await makeUser(status, `hotfix-alert-other-${stamp}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'driver', full_name = 'Alert Driver', is_test = true where id = '${driver.id}';
    update public.profiles set role = 'driver', full_name = 'Other Driver', is_test = true where id = '${other.id}';
    insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
    values
      ('${driver.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true),
      ('${other.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true);
  `);
  const context = await browser.newContext();
  await context.addInitScript(chimeSpy);
  await applySession(context, status.url, driver.session);
  const page = await context.newPage();
  const quiet = await browser.newContext();
  await quiet.addInitScript(() => {
    localStorage.setItem("pickuply-alert-prefs", JSON.stringify({ sound: false, newJobs: true, messages: true, delivery: true }));
  });
  await quiet.addInitScript(chimeSpy);
  await applySession(quiet, status.url, driver.session);
  const otherContext = await browser.newContext();
  await applySession(otherContext, status.url, other.session);
  try {
    const firstFetch = page.waitForResponse((response) => response.url().includes("/notifications") && response.request().method() === "GET");
    await page.goto("/driver");
    await firstFetch;
    await dismissChrome(page);
    await page.locator("body").click({ position: { x: 8, y: 8 } });
    const noteId = localSql(`
      insert into public.notifications (profile_id, kind, title, body, href, dedupe_key)
      values ('${driver.id}', 'new_job', '${title}', 'A new request is open.', '/driver', 'hotfix-alert-${stamp}')
      returning id;
    `).trim();
    await expect(page.getByRole("status").getByText(title)).toBeVisible({ timeout: 35_000 });
    await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("pickuply-chime-starts") ?? "0"))).toBe(2);
    await page.screenshot({ path: "C:/Users/Josh/AppData/Local/Temp/pickuply-hotfix-evidence/alert-toast.png" });

    await page.reload();
    await dismissChrome(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => Number(sessionStorage.getItem("pickuply-chime-starts") ?? "0"))).toBe(2);
    await expect(page.getByRole("status").getByText(title)).toHaveCount(0);

    const second = await context.newPage();
    await second.goto("/driver");
    await dismissChrome(second);
    await second.waitForTimeout(1500);
    expect(await second.evaluate(() => Number(sessionStorage.getItem("pickuply-chime-starts") ?? "0"))).toBe(0);

    const quietPage = await quiet.newPage();
    const quietFetch = quietPage.waitForResponse((response) => response.url().includes("/notifications") && response.request().method() === "GET");
    await quietPage.goto("/driver");
    await quietFetch;
    await dismissChrome(quietPage);
    localSql(`
      insert into public.notifications (profile_id, kind, title, body, href, dedupe_key)
      values ('${driver.id}', 'new_job', '${title} quiet', 'Sound is off.', '/driver', 'hotfix-alert-quiet-${stamp}');
    `);
    await expect(quietPage.getByRole("status").getByText(`${title} quiet`)).toBeVisible({ timeout: 35_000 });
    expect(await quietPage.evaluate(() => Number(sessionStorage.getItem("pickuply-chime-starts") ?? "0"))).toBe(0);

    const otherPage = await otherContext.newPage();
    await otherPage.goto("/driver");
    await dismissChrome(otherPage);
    await otherPage.waitForTimeout(1500);
    await expect(otherPage.getByText(title)).toHaveCount(0);
    test.info().annotations.push({
      type: "alert",
      description: `Toast once, chime count 1, refresh and second tab stayed quiet, sound-off showed the banner only, other driver saw nothing. Notification ${noteId}.`,
    });
  } finally {
    await context.close();
    await quiet.close();
    await otherContext.close();
    localSql(`
      delete from public.notifications where profile_id in ('${driver.id}', '${other.id}');
      delete from public.drivers where profile_id in ('${driver.id}', '${other.id}');
    `);
    await deleteUser(status, driver.id);
    await deleteUser(status, other.id);
  }
});

test("a new quote is offered by two drivers and the customer chooses one", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now().toString(16);
  const deliveryId = "c1910000-0000-4000-8000-000000000021";
  const junkId = "c1910000-0000-4000-8000-000000000022";
  const fixedId = "c1910000-0000-4000-8000-000000000023";
  const oldId = "c1910000-0000-4000-8000-000000000024";
  localSql(`
    update public.jobs set accepted_offer_id = null where id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
    delete from public.job_offers where job_id in ('${deliveryId}','${junkId}','${fixedId}');
    delete from public.job_events where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
    delete from public.notifications where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
    delete from public.job_private where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
    delete from public.jobs where id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
  `);
  const customer = await makeUser(status, `hotfix-quote-customer-${stamp}@pickuply.test`);
  const ada = await makeUser(status, `hotfix-quote-ada-${stamp}@pickuply.test`);
  const bea = await makeUser(status, `hotfix-quote-bea-${stamp}@pickuply.test`);
  const outsider = await makeUser(status, `hotfix-quote-outsider-${stamp}@pickuply.test`);
  const anonVisible = localSql(`
    select has_function_privilege(
      'anon',
      'public.quote_visible_to_drivers(public.pricing_method, integer, timestamptz)',
      'execute'
    );
  `).trim();
  expect(anonVisible).toBe("f");
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Quote Customer', is_test = true, phone = '+14045550193' where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Ada Quote', is_test = true where id = '${ada.id}';
    update public.profiles set role = 'driver', full_name = 'Bea Quote', is_test = true where id = '${bea.id}';
    update public.profiles set role = 'driver', full_name = 'Real Outsider', is_test = false where id = '${outsider.id}';
    insert into public.drivers (
      profile_id, status, zone_id, service_level, services, is_online,
      license_expires, terms_version, terms_accepted_at, agreement_signed_at
    ) values
      ('${ada.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery','junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now()),
      ('${bea.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery','junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now()),
      ('${outsider.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery','junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now());
    insert into public.vehicles (driver_id, type, make, approved)
    values ('${ada.id}', 'pickup', 'Ford', true), ('${bea.id}', 'pickup', 'Ford', true), ('${outsider.id}', 'pickup', 'Ford', true);
    insert into public.driver_feed_filters (profile_id, cities, zips)
    values ('${ada.id}', array['Austell'], array['30106']), ('${bea.id}', array['Austell'], array['30106']);
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
      item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, is_test
    ) values (
      '${oldId}', '${customer.id}', 'junk', 'requested', (select id from public.zones where slug = 'west_metro'),
      'Atlanta 30326', 'older quote', 1, 'medium', 0, 0, false, false, 'asap', 'quote', true
    );
  `);
  await postRequest(status, customer.session, deliveryId, "delivery");
  await postRequest(status, customer.session, junkId, "junk");
  await postRequest(status, customer.session, fixedId, "fixed");

  expect(localSql(`select status from public.jobs where id = '${deliveryId}'`).trim()).toBe("open");
  expect(localSql(`select status from public.jobs where id = '${junkId}'`).trim()).toBe("open");
  expect(localSql(`select status || '|' || offer_cents::text from public.jobs where id = '${fixedId}'`).trim()).toBe("open|6000");
  expect(localSql(`select status from public.jobs where id = '${oldId}'`).trim()).toBe("requested");
  expect(localSql(`select count(*) from public.ledger_entries where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}')`).trim()).toBe("0");
  expect(localSql(`select coalesce(payment_status, 'none') from public.jobs where id = '${deliveryId}'`).trim()).toBe("none");

  const adaContext = await browser.newContext();
  const beaContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  await applySession(adaContext, status.url, ada.session);
  await applySession(beaContext, status.url, bea.session);
  await applySession(customerContext, status.url, customer.session);
  await applySession(outsiderContext, status.url, outsider.session);
  const adaPage = await adaContext.newPage();
  const beaPage = await beaContext.newPage();
  const customerPage = await customerContext.newPage();
  const outsiderPage = await outsiderContext.newPage();
  try {
    const adaFeed = await feedIds(status, ada.session);
    expect(adaFeed).toContain(deliveryId);
    expect(adaFeed).toContain(junkId);
    expect(adaFeed).toContain(fixedId);
    const outsiderFeed = await feedIds(status, outsider.session);
    expect(outsiderFeed).not.toContain(deliveryId);
    expect(outsiderFeed).not.toContain(junkId);
    expect(outsiderFeed).not.toContain(fixedId);
    expect(outsiderFeed).not.toContain(oldId);

    await adaPage.goto("/driver");
    await dismissChrome(adaPage);
    const adaCard = quoteCard(adaPage, "delivery");
    await expect(adaCard).toBeVisible();
    await adaCard.getByLabel("Your quote ($)").fill("40");
    await adaCard.getByRole("button", { name: "Send quote" }).click();
    await adaCard.getByRole("button", { name: "Send quote" }).last().click();
    await expect(adaCard.getByText("Quote sent")).toBeVisible();

    await beaPage.goto("/driver");
    await dismissChrome(beaPage);
    const beaCard = quoteCard(beaPage, "delivery");
    await expect(beaCard).toBeVisible();
    await beaCard.getByLabel("Your quote ($)").fill("55");
    await beaCard.getByRole("button", { name: "Send quote" }).click();
    await beaCard.getByRole("button", { name: "Send quote" }).last().click();
    await expect(beaCard.getByText("Quote sent")).toBeVisible();

    const junkCard = quoteCard(adaPage, "junk");
    await expect(junkCard).toBeVisible();
    await junkCard.getByLabel("Your quote ($)").fill("50");
    await junkCard.getByRole("button", { name: "Send quote" }).click();
    await junkCard.getByRole("button", { name: "Send quote" }).last().click();
    await expect(junkCard.getByText("Quote sent")).toBeVisible();
    const beaJunk = quoteCard(beaPage, "junk");
    await expect(beaJunk).toBeVisible();
    await beaJunk.getByLabel("Your quote ($)").fill("60");
    await beaJunk.getByRole("button", { name: "Send quote" }).click();
    await beaJunk.getByRole("button", { name: "Send quote" }).last().click();
    await expect(beaJunk.getByText("Quote sent")).toBeVisible();
    expect(localSql(`select status from public.jobs where id = '${junkId}'`).trim()).toBe("open");
    expect(localSql(`select count(*) from public.job_offers where job_id = '${junkId}' and status = 'active'`).trim()).toBe("2");
    const fixedCard = quoteCard(adaPage, "fixed");
    await expect(fixedCard.getByRole("button", { name: "Accept posted price" })).toBeVisible();
    await fixedCard.getByRole("button", { name: "Accept posted price" }).click();
    await expect(fixedCard.getByText("Offer submitted successfully")).toBeVisible();
    expect(localSql(`select status || '|' || coalesce(assigned_driver_id::text, 'none') from public.jobs where id = '${fixedId}'`).trim()).toBe(`open|none`);

    await outsiderPage.goto("/driver");
    await dismissChrome(outsiderPage);
    await expect(outsiderPage.getByRole("heading", { name: "Driver home" })).toBeVisible();
    await expect(outsiderPage.getByText("Loading jobs…")).toHaveCount(0);
    await expect(outsiderPage.getByText("Hotfix dresser")).toHaveCount(0);
    await expect(outsiderPage.getByText("Hotfix sofa")).toHaveCount(0);

    await customerPage.goto(`/jobs/${deliveryId}`);
    await dismissChrome(customerPage);
    await expect(customerPage.getByRole("button", { name: "Choose Ada" })).toBeVisible();
    await expect(customerPage.getByRole("button", { name: "Choose Bea" })).toBeVisible();
    await customerPage.getByRole("button", { name: "Choose Ada" }).click();
    await expect.poll(() => localSql(`select status || '|' || assigned_driver_id::text from public.jobs where id = '${deliveryId}'`).trim()).toBe(`assigned|${ada.id}`);
    expect(localSql(`select count(*) from public.job_offers where job_id = '${deliveryId}' and status = 'chosen'`).trim()).toBe("1");
    expect(localSql(`select status from public.jobs where id = '${oldId}'`).trim()).toBe("requested");
    test.info().annotations.push({
      type: "quote",
      description: "Delivery and junk quotes were visible to eligible test drivers. Two offers, one chosen. Fixed price stayed open until a choice. The older requested quote stayed requested. Anon cannot run quote visibility. No ledger rows.",
    });
  } finally {
    await adaContext.close();
    await beaContext.close();
    await customerContext.close();
    await outsiderContext.close();
    localSql(`
      update public.jobs set accepted_offer_id = null where id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
      delete from public.job_offers where job_id in ('${deliveryId}','${junkId}','${fixedId}');
      delete from public.job_events where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
      delete from public.notifications where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}') or profile_id in ('${customer.id}','${ada.id}','${bea.id}','${outsider.id}');
      delete from public.job_private where job_id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
      delete from public.jobs where id in ('${deliveryId}','${junkId}','${fixedId}','${oldId}');
      delete from public.driver_feed_filters where profile_id in ('${ada.id}','${bea.id}');
      delete from public.vehicles where driver_id in ('${ada.id}','${bea.id}','${outsider.id}');
      delete from public.drivers where profile_id in ('${ada.id}','${bea.id}','${outsider.id}');
    `);
    await deleteUser(status, customer.id);
    await deleteUser(status, ada.id);
    await deleteUser(status, bea.id);
    await deleteUser(status, outsider.id);
  }
});

test("a signed-in customer can send two quotes, and a guest starts from a blank form", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now().toString(16);
  const customer = await makeUser(status, `hotfix-new-customer-${stamp}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'customer', full_name = 'New Customer', is_test = true, phone = '+14045550194' where id = '${customer.id}';
  `);
  const context = await browser.newContext();
  await applySession(context, status.url, customer.session);
  const page = await context.newPage();
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  try {
    await page.goto("/request?new=first-hotfix");
    await dismissChrome(page);
    await submitQuote(page, "First hotfix dresser");
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    await expect(page.getByText("Request sent. Drivers can now review your request and send offers.")).toBeVisible();
    await expect(page.getByText("We're preparing your price")).toHaveCount(0);
    const firstHref = await page.getByRole("link", { name: "View your request" }).getAttribute("href");
    await page.getByRole("link", { name: "Start another request" }).click();
    await expect(page).toHaveURL(/\/request\?new=/);
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Request sent" })).toHaveCount(0);
    await submitQuote(page, "Second hotfix dresser");
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    const secondHref = await page.getByRole("link", { name: "View your request" }).getAttribute("href");
    expect(secondHref).not.toBe(firstHref);
    const ids = localSql(`
      select count(*) from public.jobs
      where customer_id = '${customer.id}' and pricing_method = 'quote' and status = 'open';
    `).trim();
    expect(ids).toBe("2");

    await guestPage.goto("/request");
    await dismissChrome(guestPage);
    await expect(guestPage.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    await guestPage.getByRole("link", { name: "Get a price" }).click();
    await expect(guestPage).toHaveURL(/\/request\?new=/);
    const firstNew = new URL(guestPage.url()).searchParams.get("new");
    await expect(guestPage.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    await guestPage.getByRole("link", { name: "Get a price" }).click();
    await expect.poll(() => new URL(guestPage.url()).searchParams.get("new")).not.toBe(firstNew);
    await expect(guestPage.getByRole("heading", { name: "Request sent" })).toHaveCount(0);
    test.info().annotations.push({
      type: "new-request",
      description: `Signed-in customer created two open quotes ${firstHref} and ${secondHref}. Guest Get a Price opened two different blank forms.`,
    });
  } finally {
    await context.close();
    await guest.close();
    localSql(`
      delete from public.notifications where profile_id = '${customer.id}';
      delete from public.job_events where job_id in (select id from public.jobs where customer_id = '${customer.id}');
      delete from public.job_private where job_id in (select id from public.jobs where customer_id = '${customer.id}');
      delete from public.jobs where customer_id = '${customer.id}';
    `);
    await deleteUser(status, customer.id);
  }
});

test("signed-in navigation times stay measurable without a cache change", async ({ browser }) => {
  const status = localStatus();
  const stamp = Date.now().toString(16);
  const customer = await makeUser(status, `hotfix-time-customer-${stamp}@pickuply.test`);
  const driver = await makeUser(status, `hotfix-time-driver-${stamp}@pickuply.test`);
  const admin = await makeUser(status, `hotfix-time-admin-${stamp}@pickuply.test`);
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Time Customer', is_test = true where id = '${customer.id}';
    update public.profiles set role = 'driver', full_name = 'Time Driver', is_test = true where id = '${driver.id}';
    update public.profiles set role = 'admin', full_name = 'Time Admin', is_test = true where id = '${admin.id}';
    insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
    values ('${driver.id}', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true);
  `);
  const lines: string[] = [];
  try {
    lines.push(await timed(browser, status, customer.session, "/account"));
    lines.push(await timed(browser, status, customer.session, "/account/jobs"));
    lines.push(await timed(browser, status, driver.session, "/driver"));
    lines.push(await timed(browser, status, driver.session, "/driver/jobs"));
    lines.push(await timed(browser, status, admin.session, "/admin"));
    lines.push(await timed(browser, status, admin.session, "/admin/requests"));
    test.info().annotations.push({ type: "performance", description: lines.join(" | ") });
    console.log(lines.join("\n"));
  } finally {
    localSql(`delete from public.drivers where profile_id = '${driver.id}';`);
    await deleteUser(status, customer.id);
    await deleteUser(status, driver.id);
    await deleteUser(status, admin.id);
  }
});

async function timed(
  browser: import("@playwright/test").Browser,
  status: { url: string },
  session: Session,
  path: string,
) {
  const context = await browser.newContext();
  await applySession(context, status.url, session);
  const page = await context.newPage();
  try {
    await page.goto(path);
    await dismissChrome(page);
    const timing = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return {
        ttfb: Math.round(entry.responseStart),
        dcl: Math.round(entry.domContentLoadedEventEnd),
        load: Math.round(entry.loadEventEnd),
      };
    });
    return `${path} ttfb=${timing.ttfb}ms dcl=${timing.dcl}ms load=${timing.load}ms`;
  } finally {
    await context.close();
  }
}

async function submitQuote(page: Page, description: string) {
  await page.getByRole("radio", { name: /Pickup & Delivery/ }).check();
  await page.getByLabel("What needs a ride?").fill(description);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30106");
  await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
  await page.getByLabel("Drop-off city").fill("Smyrna");
  await page.getByLabel("Drop-off ZIP").fill("30080");
  await page.getByRole("radio", { name: "ASAP" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("radio", { name: /Get a quote/ }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const name = page.getByLabel("Your name");
  if (await name.isVisible().catch(() => false)) {
    await name.fill("New Customer");
    await page.getByLabel("Phone number").fill("4045550194");
  }
  await page.getByRole("checkbox", { name: /I agree to the terms/ }).check();
  await page.getByRole("button", { name: "Send request" }).click();
}

async function postRequest(
  status: { url: string; anon: string },
  session: Session,
  id: string,
  kind: "delivery" | "junk" | "fixed",
) {
  const client = createClient(status.url, status.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  const payload =
    kind === "junk"
      ? {
          service: "junk",
          description: "Hotfix sofa",
          pieces: 1,
          size: "medium",
          item_value_cents: 0,
          stairs_pickup: 0,
          elevator: false,
          help_loading: true,
          preferred_date: "asap",
          pricing_method: "quote",
          offer_cents: null,
          budget_min_cents: null,
          budget_max_cents: null,
          dropoff_area: null,
          dropoff_address: null,
          stairs_dropoff: null,
          already_paid: null,
          seller_holding: null,
          wants_item_check: null,
          zone_slug: "west_metro",
          pickup_area: "Austell, 30106",
          pickup_address: "3 Synthetic Lane",
          customer_name: "Quote Customer",
          customer_phone: "+14045550193",
          junk_load_size: "quarter",
          junk_materials: "Wood furniture",
          junk_special_items: { mattress: false, tires: false, appliances: false },
        }
      : {
          service: "delivery",
          description: kind === "fixed" ? "Hotfix named price" : "Hotfix dresser",
          pieces: 1,
          size: "medium",
          item_value_cents: 8000,
          stairs_pickup: 0,
          stairs_dropoff: 0,
          elevator: false,
          help_loading: true,
          preferred_date: "asap",
          pricing_method: kind === "fixed" ? "fixed" : "quote",
          offer_cents: kind === "fixed" ? 6000 : null,
          budget_min_cents: null,
          budget_max_cents: null,
          zone_slug: "west_metro",
          pickup_area: "Austell, 30106",
          pickup_address: "1 Synthetic Lane",
          dropoff_area: "Smyrna, 30080",
          dropoff_address: "2 Synthetic Lane",
          customer_name: "Quote Customer",
          customer_phone: "+14045550193",
          already_paid: true,
          seller_holding: false,
          wants_item_check: true,
        };
  const result = await client.rpc("create_customer_request", { request_id: id, payload });
  if (result.error) throw new Error(result.error.message);
}

function quoteCard(page: Page, kind: "delivery" | "junk" | "fixed") {
  const list = page.getByRole("region", { name: "Matched for You" }).getByRole("listitem");
  if (kind === "junk") return list.filter({ hasText: "junk" }).filter({ hasText: "Your quote ($)" });
  if (kind === "fixed") return list.filter({ hasText: "Job Amount: $60" }).filter({ hasText: "2 people" }).filter({ hasText: "to Smyrna" });
  return list.filter({ hasText: "delivery" }).filter({ hasText: "Your quote ($)" }).filter({ hasText: "to Smyrna" });
}

async function feedIds(status: { url: string; anon: string }, session: Session) {
  const client = createClient(status.url, status.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  const result = await client.rpc("driver_job_feed");
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? []) as { id: string }[]).map((row) => row.id);
}

function chimeSpy() {
  const original = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (this: OscillatorNode, ...args: [number?]) {
    const next = Number(sessionStorage.getItem("pickuply-chime-starts") ?? "0") + 1;
    sessionStorage.setItem("pickuply-chime-starts", String(next));
    return original.apply(this, args);
  };
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function dismissChrome(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal, nextjs-portal *{pointer-events:none !important}";
    document.documentElement.appendChild(style);
  }).catch(() => undefined);
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click({ force: true, timeout: 5000 });
  const version = page.getByText("New version available");
  if (await version.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Refresh" }).click({ timeout: 5000 });
  }
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

async function applySession(context: BrowserContext, apiUrl: string, session: Session) {
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
