import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const port = 3012;
const base = `http://127.0.0.1:${port}`;
const password = "local-schedule-audit-password";
const results = [];

function note(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function localStatus() {
  const text = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", shell: true });
  const values = new Map();
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

function localSql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  ).trim();
}

function georgiaParts(offsetMinutes) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetMinutes * 60 * 1000));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, time: `${hour}:${pick("minute")}` };
}

function georgiaDate(offset) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const date = new Date(Date.UTC(Number(pick("year")), Number(pick("month")) - 1, Number(pick("day"))));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function makeUser(status, email) {
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "Could not create the local user.");
  const client = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(signed.error?.message ?? "Could not sign in the local user.");
  return { id: created.data.user.id, session: signed.data.session, admin };
}

async function applySession(context, apiUrl, session) {
  const key = `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const chunks = [];
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
  await context.addCookies(chunks.map((chunk) => ({ name: chunk.name, value: chunk.value, url: base })));
}

async function dismissCookies(page) {
  const reject = page.getByRole("button", { name: /Reject optional cookies/i });
  if (await reject.count()) await reject.click();
}

async function createRequest(page, { description, mode, service = "junk", pricing = "fixed", dollars = "65", phone = "5555550199", windows = 0 }) {
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.removeItem("pickuply.request-draft");
    sessionStorage.removeItem("pickuply.submission-id");
  });
  await page.goto(`${base}/request?service=${service}`);
  await dismissCookies(page);
  await page.getByRole("radio", { name: service === "delivery" ? /Pickup & Delivery/ : /Junk Removal/ }).check();
  await page.getByLabel("What needs a ride?").fill(description);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "Where and when?" }).waitFor();
  await page.getByLabel("Pickup street address").fill("100 Audit Lane");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30168");
  await page.getByRole("button", { name: "Use this address anyway" }).click();
  if (service === "delivery") {
    await page.getByLabel("Drop-off street address").fill("200 Audit Lane");
    await page.getByLabel("Drop-off city").fill("Austell");
    await page.getByLabel("Drop-off ZIP").fill("30168");
  }
  if (mode === "asap") await page.getByRole("radio", { name: /As soon as possible/ }).check();
  const windowCount = mode === "windows" ? windows || 3 : 0;
  if (windowCount > 0) {
    await page.getByRole("radio", { name: /Choose pickup times/ }).check();
    const slots = [
      { date: georgiaDate(1), start: "09:00", end: "11:00" },
      { date: georgiaDate(1), start: "13:00", end: "15:00" },
      { date: georgiaDate(2), start: "10:00", end: "12:00" },
    ];
    for (let index = 0; index < windowCount; index += 1) {
      if (index > 0) await page.getByRole("button", { name: "Add another window" }).click();
      const slot = slots[index];
      await page.locator(`input[name='pickupDate${index}']`).fill(slot.date);
      await page.locator(`input[name='pickupStart${index}']`).fill(slot.start);
      await page.locator(`input[name='pickupEnd${index}']`).fill(slot.end);
    }
  }
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "Your price" }).waitFor();
  if (pricing === "quote") {
    await page.getByRole("radio", { name: /Get a quote/ }).check();
  } else {
    await page.getByRole("radio", { name: /Name your price/ }).check();
    await page.getByRole("textbox", { name: /Your price/ }).fill(dollars);
  }
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "Check and send" }).waitFor();
  const summary = await page.locator("body").innerText();
  await page.getByRole("checkbox", { name: /I agree to the terms/ }).check();
  if (await page.getByLabel("Phone number").count()) {
    await page.getByLabel("Your name").fill("Casey Customer");
    await page.getByLabel("Phone number").fill(phone);
  }
  const rpcErrors = [];
  page.on("request", (request) => {
    if (!request.url().includes("/rpc/create_customer_request")) return;
    try {
      const body = request.postDataJSON();
      const payload = body?.payload ?? body;
      const windows = payload?.pickup_windows;
      rpcErrors.push(`sent ${payload?.pickup_availability} windows ${Array.isArray(windows) ? windows.length : "none"}`);
    } catch {
      rpcErrors.push("sent unreadable");
    }
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/rpc/create_customer_request")) return;
    if (response.ok()) return;
    const text = await response.text().catch(() => "");
    rpcErrors.push(text.slice(0, 240));
  });
  await page.getByRole("button", { name: "Send request" }).click();
  try {
    await page.getByRole("heading", { name: "Request sent" }).waitFor({ timeout: 30_000 });
  } catch (error) {
    const alert = await page.locator("[role='alert']").allInnerTexts().catch(() => []);
    const when = summary.split("\n").filter((line) => /Window|Available anytime|As soon as possible|pickup/i.test(line)).slice(0, 6).join(" / ");
    throw new Error(`${when || "no summary"} | ${alert.join(" | ") || "no alert"} | ${rpcErrors.join(" | ") || "no rpc"}`);
  }
  const href = await page.getByRole("link", { name: "View your request" }).getAttribute("href");
  const id = href?.match(/\/jobs\/([0-9a-f-]{36})/)?.[1] ?? "";
  if (!id) throw new Error("The request was sent, but the job link was missing.");
  return { id, summary };
}

async function sendQuote(page, jobId, { date, time, windowIndex, dollars }) {
  await page.goto(`${base}/driver`);
  const card = page.locator(`#job-${jobId}`).first();
  await card.waitFor({ timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  if (date) {
    await card.locator("input[type='date']").fill(date);
    await card.locator("input[type='time']").fill(time);
  }
  if (windowIndex != null) {
    await card.getByRole("radio").nth(windowIndex).check();
  }
  await card.getByLabel(/Offer Amount/).fill(dollars);
  const rpcNotes = [];
  const onResponse = async (response) => {
    if (!response.url().includes("/rpc/submit_offer") && !response.url().includes("/rpc/claim_job")) return;
    const text = await response.text().catch(() => "");
    rpcNotes.push(`${response.status()} ${text.slice(0, 240)}`);
  };
  page.on("response", onResponse);
  try {
    await card.getByRole("button", { name: "Submit Offer" }).click();
    await card.getByText("Confirm this offer").waitFor();
    await card.getByRole("button", { name: "Confirm offer" }).click();
    await card.getByText(/Offer submitted successfully/).waitFor({ timeout: 20_000 });
  } catch (error) {
    const cardText = await card.innerText().catch(() => "");
    throw new Error(`${error instanceof Error ? error.message.split("\n")[0] : "offer failed"} | ${rpcNotes.join(" | ") || "no rpc"} | ${cardText.slice(0, 500)}`);
  } finally {
    page.off("response", onResponse);
  }
}

async function claimPricedQuote(page, jobId, { date, time }) {
  await page.goto(`${base}/driver`);
  const card = page.locator(`#job-${jobId}`).first();
  await card.waitFor({ timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await card.locator("input[type='date']").fill(date);
  await card.locator("input[type='time']").fill(time);
  await card.getByRole("button", { name: "Claim this job" }).click();
  await card.getByText(/You are assigned/).waitFor({ timeout: 20_000 });
}

async function userRpc(api, token, name, args) {
  const response = await fetch(`${api.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: api.anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { ok: response.ok, text: text.slice(0, 240) };
}

function freePort() {
  try {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -and $_ -ne 0) { taskkill /PID $_ /T /F | Out-Null } }`],
      { stdio: "ignore" },
    );
  } catch {
    // The port is already free.
  }
}

function startServer(status) {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    shell: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: status.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anon,
    },
    stdio: "ignore",
  });
  return child;
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(base);
      if (response.ok || response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The local preview server did not start.");
}

const status = localStatus();
if (existsSync(".env.local")) {
  const current = readFileSync(".env.local", "utf8");
  if (!current.includes("127.0.0.1")) throw new Error("Refusing to replace an env file that is not the local database.");
}
writeFileSync(".env.local", `NEXT_PUBLIC_SUPABASE_URL=${status.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${status.anon}\n`);
if (process.env.SCHEDULE_SKIP_BUILD !== "1") {
  execFileSync("npx", ["next", "build"], { shell: true, stdio: "inherit" });
}
freePort();
const server = startServer(status);
const ids = { customer: "", driverA: "", driverB: "", jobs: [] };
const phoneBase = 1000 + (Date.now() % 7000);
const customerPhone = `+1555555${phoneBase}`;
const phoneA = `+1555555${phoneBase + 1}`;
const phoneB = `+1555555${phoneBase + 2}`;
try {
  await waitForServer();
  const customer = await makeUser(status, `schedule-customer-${Date.now()}@pickuply.test`);
  const driverA = await makeUser(status, `schedule-driver-a-${Date.now()}@pickuply.test`);
  const driverB = await makeUser(status, `schedule-driver-b-${Date.now()}@pickuply.test`);
  ids.customer = customer.id;
  ids.driverA = driverA.id;
  ids.driverB = driverB.id;
  const seed = (id, name, phone) => `
    update public.profiles set role = 'driver', full_name = '${name}', is_test = true, phone = '${phone}' where id = '${id}';
    insert into public.drivers (
      profile_id, status, zone_id, service_level, services, is_online,
      license_expires, terms_version, terms_accepted_at, agreement_signed_at, first_online_at, checklist_required
    ) values (
      '${id}', 'active', (select id from public.zones where slug = 'west_metro'),
      'full', array['delivery','junk']::public.job_service[], true,
      current_date + 30, 'driver-terms-v1', now(), now(), now(), false
    );
    insert into public.vehicles (driver_id, type, make, approved) values ('${id}', 'pickup', 'Ford', true);
    insert into public.driver_feed_filters (profile_id, cities, zips, services)
    values ('${id}', array['Austell'], array['30168'], array['junk','delivery']::public.job_service[]);
  `;
  localSql(`
    update public.profiles set role = 'customer', full_name = 'Casey Customer', is_test = true, phone = '${customerPhone}' where id = '${customer.id}';
    ${seed(driverA.id, "Ada Driver", phoneA)}
    ${seed(driverB.id, "Bea Driver", phoneB)}
  `);

  const browser = await chromium.launch({ headless: true });
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const driverAContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const driverBContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await applySession(customerContext, status.url, customer.session);
  await applySession(driverAContext, status.url, driverA.session);
  await applySession(driverBContext, status.url, driverB.session);
  const customerPage = await customerContext.newPage();
  const pageA = await driverAContext.newPage();
  const pageB = await driverBContext.newPage();
  const tomorrow = georgiaDate(1);

  for (const width of [320, 375, 390, 430]) {
    const widthPage = await browser.newPage({ viewport: { width, height: 900 } });
    await widthPage.goto(`${base}/request?service=junk`, { waitUntil: "domcontentloaded" });
    await dismissCookies(widthPage);
    const heading = widthPage.getByRole("heading", { name: "What do you need?" });
    if (!(await heading.isVisible().catch(() => false))) {
      await widthPage.reload({ waitUntil: "networkidle" });
      await dismissCookies(widthPage);
    }
    try {
      await heading.waitFor({ timeout: 20_000 });
    } catch (error) {
      const text = await widthPage.locator("body").innerText().catch(() => "");
      throw new Error(`${widthPage.url()} | ${text.slice(0, 400)}`);
    }
    await widthPage.getByRole("radio", { name: /Junk Removal/ }).check();
    await widthPage.getByLabel("What needs a ride?").fill("Width check sofa");
    await widthPage.getByRole("button", { name: "Next" }).click();
    await widthPage.getByRole("heading", { name: "Where and when?" }).waitFor();
    await widthPage.getByRole("radio", { name: /Choose pickup times/ }).check();
    const overflow = await widthPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const firstEnd = await widthPage.locator("input[name='pickupEnd0']").inputValue();
    const firstDate = await widthPage.locator("input[name='pickupDate0']").inputValue();
    note(`mobile ${width}`, overflow <= 1 && firstDate !== "" && firstEnd !== "", `overflow ${overflow}`);
    await widthPage.close();
  }

  const formPhone = customerPhone.slice(2);
  const shortStart = georgiaParts(-30);
  const shortEnd = georgiaParts(30);
  if (shortStart.date === shortEnd.date) {
    await customerPage.goto(`${base}/request?service=junk`);
    await dismissCookies(customerPage);
    await customerPage.evaluate(() => {
      localStorage.removeItem("pickuply.request-draft");
      sessionStorage.removeItem("pickuply.submission-id");
    });
    await customerPage.goto(`${base}/request?service=junk`);
    await customerPage.getByRole("radio", { name: /Junk Removal/ }).check();
    await customerPage.getByLabel("What needs a ride?").fill("Too soon sofa");
    await customerPage.getByRole("button", { name: "Next" }).click();
    await customerPage.getByRole("heading", { name: "Where and when?" }).waitFor();
    await customerPage.getByLabel("Pickup street address").fill("100 Audit Lane");
    await customerPage.getByLabel("Pickup city").fill("Austell");
    await customerPage.getByLabel("Pickup ZIP").fill("30168");
    await customerPage.getByRole("button", { name: "Use this address anyway" }).click();
    await customerPage.getByRole("radio", { name: /Choose pickup times/ }).check();
    await customerPage.locator("input[name='pickupDate0']").fill(shortEnd.date);
    await customerPage.locator("input[name='pickupStart0']").fill(shortStart.time);
    await customerPage.locator("input[name='pickupEnd0']").fill(shortEnd.time);
    await customerPage.getByRole("button", { name: "Next" }).click();
    const leadTime = customerPage.getByText("The pickup window has to end at least 60 minutes from now.");
    try {
      await leadTime.waitFor({ timeout: 10_000 });
      note("short window is rejected in the form", true);
    } catch (error) {
      const endValue = await customerPage.locator("input[name='pickupEnd0']").inputValue();
      const visible = await customerPage.locator("body").innerText();
      throw new Error(`end ${endValue} | ${visible.slice(0, 500)}`);
    }
  } else {
    console.log("SKIP short window browser — the 30-minute sample crosses midnight");
  }
  const anytime = await createRequest(customerPage, { description: "Schedule audit sofa anytime", mode: "anytime", phone: formPhone });
  ids.jobs.push(anytime.id);
  note("customer anytime request", anytime.summary.includes("will not arrive unannounced"), anytime.id);
  const asap = await createRequest(customerPage, { description: "Schedule audit sofa asap", mode: "asap", phone: formPhone });
  ids.jobs.push(asap.id);
  note("customer ASAP request", asap.summary.includes("does not promise an immediate pickup"), asap.id);
  const oneWindow = await createRequest(customerPage, { description: "Schedule audit one window", mode: "windows", windows: 1, phone: formPhone });
  ids.jobs.push(oneWindow.id);
  note("customer one window", oneWindow.summary.includes("Window 1:") && !oneWindow.summary.includes("Window 2:"), oneWindow.id);
  const twoWindows = await createRequest(customerPage, { description: "Schedule audit two windows", mode: "windows", windows: 2, phone: formPhone });
  ids.jobs.push(twoWindows.id);
  note("customer two windows", twoWindows.summary.includes("Window 1:") && twoWindows.summary.includes("Window 2:") && !twoWindows.summary.includes("Window 3:"), twoWindows.id);
  const windows = await createRequest(customerPage, { description: "Schedule audit sofa windows", mode: "windows", windows: 3, phone: formPhone });
  ids.jobs.push(windows.id);
  note(
    "customer three windows",
    windows.summary.includes("Window 1:") && windows.summary.includes("Window 3:"),
    windows.id,
  );
  const delivery = await createRequest(customerPage, {
    description: "Schedule audit delivery",
    mode: "anytime",
    service: "delivery",
    dollars: "40",
    phone: formPhone,
  });
  ids.jobs.push(delivery.id);
  note("customer delivery request", delivery.summary.includes("will not arrive unannounced"), delivery.id);
  const quote = await createRequest(customerPage, {
    description: "Schedule audit priced quote",
    mode: "anytime",
    pricing: "quote",
    phone: formPhone,
  });
  ids.jobs.push(quote.id);
  note("customer quote request", quote.summary.includes("Get a quote"), quote.id);

  await sendQuote(pageA, anytime.id, { date: tomorrow, time: "14:00", dollars: "70" });
  note("driver A anytime offer", true);
  await sendQuote(pageB, anytime.id, { date: tomorrow, time: "10:00", dollars: "55" });
  note("driver B anytime offer", true);
  await sendQuote(pageA, asap.id, { date: tomorrow, time: "09:00", dollars: "70" });
  note("driver A ASAP offer", true);

  await customerPage.goto(`${base}/jobs/${anytime.id}`);
  await customerPage.getByRole("button", { name: "Choose Ada" }).waitFor();
  await customerPage.getByRole("button", { name: "Choose Bea" }).waitFor();
  const anytimeText = await customerPage.locator("body").innerText();
  const seesBoth =
    anytimeText.includes("$70") &&
    anytimeText.includes("$55") &&
    anytimeText.includes("2:00 PM") &&
    anytimeText.includes("10:00 AM");
  note("customer compares anytime price and time", seesBoth, seesBoth ? "" : anytimeText.slice(0, 400));
  await customerPage.goto(`${base}/jobs/${asap.id}`);
  await customerPage.getByText(/Ada — \$70 —/).waitFor();
  const asapText = await customerPage.locator("body").innerText();
  note("customer sees ASAP proposed time before acceptance", /Ada — \$70 —/.test(asapText) && /9:00 AM/.test(asapText));

  await customerPage.goto(`${base}/jobs/${anytime.id}`);
  await customerPage.getByRole("button", { name: "Choose Ada" }).click();
  await customerPage.waitForURL(new RegExp(`/jobs/${anytime.id}$`));
  const confirmedCustomer = await customerPage.getByLabel("Scheduled Pickup").innerText();
  note("customer sees confirmed schedule", /scheduled pickup/i.test(confirmedCustomer) && confirmedCustomer.includes("2:00 PM") && /contact Pickuply support/i.test(confirmedCustomer));

  await pageA.goto(`${base}/driver/jobs/${anytime.id}`);
  const confirmedDriver = await pageA.getByLabel("Scheduled Pickup").innerText();
  note("assigned driver sees the same schedule", confirmedDriver.includes("2:00 PM") && confirmedDriver.includes(confirmedCustomer.match(/Tomorrow|Wed|Thu|Fri|Sat|Sun|Mon|Tue|Today/)?.[0] ?? "2:00 PM"));
  const assigned = localSql(`select (assigned_driver_id = '${driverA.id}')::text || '|' || payment_status || '|' || (scheduled_pickup_start is not null)::text || '|' || (select count(*) from public.job_offers where job_id = '${anytime.id}') from public.jobs where id = '${anytime.id}'`);
  note("assignment payment and one pair of offers", assigned === "true|awaiting_payment|true|2", assigned);
  await pageB.goto(`${base}/driver/jobs/${anytime.id}`);
  const bodyB = await pageB.locator("body").innerText();
  note(
    "unselected driver does not see the street address",
    !bodyB.includes("100 Audit Lane") && !bodyB.includes("Casey Customer"),
    bodyB.includes("100 Audit Lane") ? "street visible" : "street hidden",
  );

  await sendQuote(pageA, oneWindow.id, { windowIndex: 0, dollars: "60" });
  note("driver selects the only customer window", true);
  await sendQuote(pageB, twoWindows.id, { windowIndex: 1, dollars: "62" });
  note("driver selects the second customer window", true);
  await sendQuote(pageA, windows.id, { windowIndex: 0, dollars: "60" });
  note("driver selects a customer window", true);
  localSql(`
    update public.job_pickup_windows
    set starts_at = now(), ends_at = now() + interval '30 minutes'
    where job_id = '${windows.id}' and position = 1;
    update public.job_offers o
    set proposed_pickup_start = w.starts_at, proposed_pickup_end = w.ends_at
    from public.job_pickup_windows w
    where o.job_id = '${windows.id}' and o.pickup_window_id = w.id and w.position = 1;
  `);
  await customerPage.goto(`${base}/jobs/${windows.id}`);
  await customerPage.getByRole("button", { name: "Choose Ada" }).click();
  await customerPage.waitForURL(/error=/);
  const expiredText = decodeURIComponent(customerPage.url());
  note("expired window cannot be accepted", expiredText.includes("This time has passed. Choose another offer."), expiredText);
  localSql(`
    update public.job_pickup_windows
    set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute'
    where job_id = '${windows.id}' and position = 1;
  `);
  await pageA.goto(`${base}/driver`);
  const windowCard = pageA.locator(`#job-${windows.id}`).first();
  await windowCard.getByText("Choose one pickup window").waitFor();
  const windowCardText = await windowCard.innerText();
  note(
    "expired window is not offered to the driver",
    !windowCardText.includes("9:00") && windowCardText.includes("Choose one pickup window"),
    windowCardText.includes("9:00") ? windowCardText.slice(0, 300) : "",
  );

  const lockedChange = await userRpc(status, customer.session.access_token, "request_reschedule", {
    target_job: anytime.id,
    next_date: tomorrow,
    next_window: "evening",
  });
  note("locked schedule rejects a change", lockedChange.ok === false && /locked/i.test(lockedChange.text), lockedChange.text);
  const still = localSql(`select to_char(scheduled_pickup_start at time zone 'America/New_York', 'HH24:MI') from public.jobs where id = '${anytime.id}'`);
  note("confirmed time was not overwritten", still === "14:00", still);

  localSql(`
    update public.job_offers
    set proposed_pickup_start = now() - interval '5 minutes', proposed_pickup_end = null
    where job_id = '${asap.id}';
  `);
  await customerPage.goto(`${base}/jobs/${asap.id}`);
  await customerPage.getByRole("button", { name: "Choose Ada" }).click();
  await customerPage.waitForURL(/error=/);
  note("expired proposal cannot be accepted", decodeURIComponent(customerPage.url()).includes("pickup time has passed"));

  await sendQuote(pageA, delivery.id, { date: tomorrow, time: "11:00", dollars: "45" });
  await sendQuote(pageB, delivery.id, { date: tomorrow, time: "15:00", dollars: "50" });
  const offerRows = localSql(
    `select id::text from public.job_offers where job_id = '${delivery.id}' and status = 'active' order by created_at`,
  ).split(/\s+/).filter(Boolean);
  const [firstChoice, secondChoice] = await Promise.all(
    offerRows.map((offerId) => userRpc(status, customer.session.access_token, "choose_offer", { target_offer: offerId })),
  );
  const wins = [firstChoice, secondChoice].filter((item) => item.ok).length;
  const race = localSql(`
    select (assigned_driver_id is not null)::text
      || '|' || (select count(*)::text from public.jobs assigned where assigned.id = '${delivery.id}' and assigned.assigned_driver_id is not null)
      || '|' || (j.scheduled_pickup_start = o.proposed_pickup_start)::text
    from public.jobs j
    join public.job_offers o on o.id = j.accepted_offer_id
    where j.id = '${delivery.id}'
  `);
  note("simultaneous accepts assign one driver and keep that offer time", wins === 1 && race.endsWith("|1|true"), `${wins} ${race}`);

  localSql(`
    update public.jobs
    set price_cents = 7240,
        driver_pay_cents = 6000,
        platform_fee_cents = 1000,
        service_fee_cents = 240,
        quote_expires_at = now() + interval '2 hours'
    where id = '${quote.id}';
  `);
  await claimPricedQuote(pageB, quote.id, { date: tomorrow, time: "16:00" });
  note("driver claims a priced quote with a pickup time", true);
  const claimed = localSql(`
    select (assigned_driver_id = '${driverB.id}')::text
      || '|' || payment_status
      || '|' || to_char(scheduled_pickup_start at time zone 'America/New_York', 'HH24:MI')
    from public.jobs where id = '${quote.id}'
  `);
  note("priced quote assignment keeps payment due and the claimed time", claimed === "true|awaiting_payment|16:00", claimed);
  await customerPage.goto(`${base}/jobs/${quote.id}`);
  const quoteCustomer = await customerPage.getByLabel("Scheduled Pickup").innerText();
  await pageB.goto(`${base}/driver/jobs/${quote.id}`);
  const quoteDriver = await pageB.getByLabel("Scheduled Pickup").innerText();
  note("customer and claiming driver see the same quote schedule", quoteCustomer.includes("4:00 PM") && quoteDriver.includes("4:00 PM"));

  await browser.close();
} catch (error) {
  note("authenticated workflow", false, error instanceof Error ? error.message : "unknown error");
} finally {
  if (ids.jobs.length || ids.customer) {
    const jobList = ids.jobs.map((id) => `'${id}'`).join(", ");
    const people = [ids.customer, ids.driverA, ids.driverB].filter(Boolean).map((id) => `'${id}'`).join(", ");
    if (jobList) {
      localSql(`
        update public.jobs set accepted_offer_id = null where id in (${jobList});
        delete from public.notifications where job_id in (${jobList});
        delete from public.job_events where job_id in (${jobList});
        delete from public.job_offers where job_id in (${jobList});
        delete from public.job_pickup_windows where job_id in (${jobList});
        delete from public.job_private where job_id in (${jobList});
        delete from public.jobs where id in (${jobList});
      `);
    }
    if (people) {
      localSql(`
        delete from public.audit_log where actor_id in (${people});
        delete from public.vehicles where driver_id in (${people});
        delete from public.drivers where profile_id in (${people});
      `);
      const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
      for (const id of [ids.customer, ids.driverA, ids.driverB].filter(Boolean)) {
        await admin.auth.admin.deleteUser(id);
      }
    }
  }
  try {
    execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    server.kill();
  }
  rmSync(".env.local", { force: true });
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }));
process.exit(failed.length === 0 ? 0 : 1);
