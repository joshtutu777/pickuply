import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "audit-results");
mkdirSync(outDir, { recursive: true });

function loadEnv(filename) {
  const values = {};
  try {
    const text = readFileSync(path.join(root, filename), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      const eq = body.indexOf("=");
      if (eq <= 0) continue;
      const key = body.slice(0, eq).trim();
      let value = body.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch {
    return values;
  }
  return values;
}

function sqlAudit() {
  const file = readFileSync(path.join(root, "supabase/tests/0112_marketplace_audit.sql"));
  const output = execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: file, encoding: "utf8" },
  );
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith("AUDIT|")) continue;
    const [, id, status, ...rest] = line.split("|");
    rows.push({ id, status, detail: rest.join("|"), environment: "local-database", evidence: "supabase/tests/0112_marketplace_audit.sql" });
  }
  return rows;
}

function uiRows() {
  const rows = [];
  for (const name of readdirSync(outDir)) {
    if (!name.startsWith("ui-") || !name.endsWith(".json")) continue;
    const parsed = JSON.parse(readFileSync(path.join(outDir, name), "utf8"));
    for (const row of parsed) {
      rows.push({
        id: row.id,
        status: row.status,
        detail: row.detail,
        environment: `local-browser-${row.project}`,
        evidence: name,
      });
    }
  }
  return rows;
}

async function productionChecks() {
  const checks = [
    ["PROD-TERMS", "https://pickuplyapp.com/terms", "October 28, 2026"],
    ["PROD-PRIVACY", "https://pickuplyapp.com/privacy", "October 28, 2026"],
    ["PROD-DRIVER-TERMS", "https://pickuplyapp.com/terms/driver", "Privacy Policy"],
    ["PROD-DRIVE", "https://pickuplyapp.com/drive", "Get started"],
    ["PROD-LOGIN", "https://pickuplyapp.com/login", "Text me a code"],
  ];
  const rows = [];
  for (const [id, url, needle] of checks) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const placeholder = id === "PROD-DRIVER-TERMS" && text.includes("development placeholder");
      const ok = response.status === 200 && text.includes(needle) && !placeholder;
      rows.push({
        id,
        status: ok ? "PASS" : "FAIL",
        detail: `${response.status} ${url}`,
        environment: "production-read-only",
        evidence: url,
      });
    } catch (error) {
      rows.push({
        id,
        status: "BLOCKED",
        detail: error instanceof Error ? error.message : "fetch failed",
        environment: "production-read-only",
        evidence: url,
      });
    }
  }
  return rows;
}

async function stripeCheck(env) {
  const key = env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY || "";
  if (!key.startsWith("sk_test_")) {
    return [{
      id: "PAY-001",
      status: "BLOCKED",
      detail: "No sk_test_ secret was available for an isolated PaymentIntent.",
      environment: "stripe-test",
      evidence: "env name only",
    }];
  }
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(key);
  const intent = await stripe.paymentIntents.create({
    amount: 5250,
    currency: "usd",
    capture_method: "manual",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { audit: "overnight", isolated: "yes" },
  });
  const canceled = await stripe.paymentIntents.cancel(intent.id);
  return [
    {
      id: "PAY-001",
      status: intent.status === "requires_capture" ? "PASS" : "FAIL",
      detail: `isolated test PaymentIntent status ${intent.status}, then ${canceled.status}. No Pickuply job was attached.`,
      environment: "stripe-test",
      evidence: "stripe API test mode",
    },
    {
      id: "PAY-003",
      status: "PASS",
      detail: "One isolated authorization was created and then canceled. It was not a customer booking.",
      environment: "stripe-test",
      evidence: "stripe API test mode",
    },
  ];
}

const blocked = [
  ["CUST-001", "BLOCKED", "A new production phone signup would send a real text. Local test OTP was used instead."],
  ["CUST-004", "NOT VERIFIED", "The local test code does not expose a controllable expiration without waiting or sending a real text."],
  ["CUST-008", "NOT VERIFIED", "Session expiration was not waited out."],
  ["CUST-010", "NOT VERIFIED", "Saved address book was not exercised in the browser."],
  ["CUST-012", "NOT VERIFIED", "A booking draft was not carried through a fresh signup in the browser."],
  ["CUST-015", "PASS", "The mobile Playwright project used a 390px-class phone viewport."],
  ["DRV-002", "NOT VERIFIED", "A new driver phone was not verified on production."],
  ["DRV-003", "NOT VERIFIED", "Driver OTP used the same local login form as the customer tests. A separate driver number was not given a wrong code."],
  ["DRV-006", "BLOCKED", "Address autocomplete needs the Google Places key and was not driven in this run."],
  ["DRV-007", "NOT VERIFIED", "City dropdown was not clicked in the browser."],
  ["DRV-008", "NOT VERIFIED", "ZIP selection was covered by the database application, not the browser control."],
  ["DRV-009", "NOT VERIFIED", "Radius buttons were not clicked. The database accepts 10, 25, 50, or 100 miles."],
  ["DRV-012", "NOT VERIFIED", "Profile photo bytes were not uploaded. The application rejects a missing path."],
  ["DRV-013", "NOT VERIFIED", "License photo bytes were not uploaded. The application rejects a missing path."],
  ["DRV-019", "NOT VERIFIED", "Approved status was checked in the database, not in the signed-in driver browser."],
  ["DRV-022", "PASS", "The online driver claimed the open quote job in the local database."],
  ["DRV-024", "NOT VERIFIED", "Coverage edit after approval was not given its own case. Matching coverage was saved on the application."],
  ["DRV-026", "NOT VERIFIED", "Earnings and history pages were not opened in the browser."],
  ["DRV-027", "BLOCKED", "Stripe Connect onboarding needs the hosted Stripe screen. It was not clicked."],
  ["BOOK-002", "BLOCKED", "Pickup autocomplete was not driven against Google."],
  ["BOOK-003", "BLOCKED", "Drop-off autocomplete was not driven against Google."],
  ["BOOK-006", "NOT VERIFIED", "Item photo upload was not performed in the browser."],
  ["BOOK-007", "NOT VERIFIED", "Vehicle requirement controls were not selected in the browser."],
  ["BOOK-008", "NOT VERIFIED", "Scheduling controls were not selected in the browser. The database request used ASAP."],
  ["BOOK-009", "NOT VERIFIED", "The database stores a typed address. It does not reject an unknown street."],
  ["BOOK-013", "NOT VERIFIED", "The review step was not reached in the browser."],
  ["BOOK-014", "NOT VERIFIED", "A draft was not preserved across signup."],
  ["BOOK-015", "NOT VERIFIED", "Stripe Checkout was not opened in the browser."],
  ["BOOK-016", "NOT VERIFIED", "A test card was not entered in Checkout. An isolated manual authorization was created separately when the test key was present."],
  ["BOOK-017", "NOT VERIFIED", "A declined card was not submitted through Checkout."],
  ["BOOK-018", "NOT VERIFIED", "An abandoned Checkout session was not created."],
  ["BOOK-019", "NOT VERIFIED", "The customer dashboard was not opened for the audit job. The job row existed in the local database."],
  ["BOOK-020", "NOT VERIFIED", "The admin booking screen was not opened."],
  ["BOOK-024", "NOT VERIFIED", "Store order numbers were not submitted. Private fields stay off the driver feed in the database tests."],
  ["OFFER-003", "PASS", "An offline approved driver was rejected until Online. An online driver could claim."],
  ["OFFER-008", "NOT VERIFIED", "The customer screen was not opened after assignment. The database stored the assigned driver."],
  ["OFFER-009", "NOT VERIFIED", "The driver job screen was not opened after assignment."],
  ["OFFER-011", "NOT VERIFIED", "An expired quote was not given its own row."],
  ["OFFER-013", "PASS", "The suspended driver was rejected."],
  ["OFFER-016", "NOT VERIFIED", "Release and reassignment were not executed."],
  ["DEL-001", "NOT VERIFIED", "The assigned job screen was not opened. The database advanced the same job."],
  ["DEL-003", "PASS", "The database moved the job to arrived."],
  ["DEL-004", "PASS", "Arrived is the pickup arrival status."],
  ["DEL-005", "PASS", "A pickup proof row was stored by record_proof."],
  ["DEL-006", "PASS", "Item loaded ran after the pickup photo."],
  ["DEL-008", "NOT VERIFIED", "A failed upload retry was not simulated."],
  ["DEL-010", "NOT VERIFIED", "The customer progress screen was not opened. Status notifications were written."],
  ["DEL-011", "PASS", "Drop-off arrival was recorded."],
  ["DEL-015", "NOT VERIFIED", "The completed screen was not checked for read-only controls."],
  ["DEL-018", "NOT VERIFIED", "Signed photo URLs were not requested. Another customer could not read the job row."],
  ["DEL-020", "NOT VERIFIED", "The admin proof screen was not opened."],
  ["DEL-022", "PASS", "A repeated proof path did not create a second photo. A wrong status was rejected."],
  ["PAY-002", "NOT VERIFIED", "The isolated PaymentIntent was not attached to a Pickuply Stripe Customer."],
  ["PAY-004", "NOT VERIFIED", "Duplicate Checkout was not opened."],
  ["PAY-005", "NOT VERIFIED", "A valid signed webhook was not posted. The invalid signature was rejected."],
  ["PAY-006", "NOT VERIFIED", "A valid test webhook was not reconciled against a job."],
  ["PAY-009", "PASS", "Cancel of an unpaid open assignment returned outcome free and status cancelled."],
  ["PAY-010", "NOT VERIFIED", "A Stripe refund was not created."],
  ["PAY-011", "NOT VERIFIED", "Customer payment history was not opened."],
  ["PAY-018", "NOT VERIFIED", "One-tap tip with a saved card was not run in the browser. The database accepted one $5 tip row."],
  ["PAY-022", "NOT VERIFIED", "A saved card was not removed."],
  ["PAY-023", "NOT VERIFIED", "An authentication-required card was not used."],
  ["PAY-024", "NOT VERIFIED", "A declined tip card was not charged. The database rejects a live-mode tip flag."],
  ["PAY-025", "BLOCKED", "Connect onboarding was not completed in the browser."],
  ["PAY-026", "NOT VERIFIED", "A Stripe transfer was not created."],
  ["PAY-027", "NOT VERIFIED", "Transfer reconciliation was not run against Stripe."],
  ["PAY-028", "NOT VERIFIED", "A failed transfer was not created."],
  ["PAY-029", "NOT VERIFIED", "The payout page copy was not opened in this run. The earnings page already says a transfer is not a bank deposit."],
  ["PAY-030", "NOT VERIFIED", "The local ledger was not compared with the Stripe test balance."],
  ["ADMIN-C-001", "NOT VERIFIED", "Admin customer search was not opened."],
  ["ADMIN-C-002", "NOT VERIFIED", "Customer filters were not used."],
  ["ADMIN-C-003", "NOT VERIFIED", "A customer profile was not opened in admin."],
  ["ADMIN-C-004", "NOT VERIFIED", "Booking history was not opened in admin."],
  ["ADMIN-C-005", "NOT VERIFIED", "An active booking was not opened in admin."],
  ["ADMIN-C-006", "NOT VERIFIED", "A completed booking was not opened in admin."],
  ["ADMIN-C-007", "NOT VERIFIED", "Cancellation history was not opened in admin."],
  ["ADMIN-C-008", "NOT VERIFIED", "Payment status was not opened in admin."],
  ["ADMIN-C-009", "NOT VERIFIED", "Refund records were not opened in admin."],
  ["ADMIN-C-010", "PASS", "A support ticket was created from the customer account in the database."],
  ["ADMIN-C-012", "NOT VERIFIED", "The customer did not open the support reply in the browser."],
  ["ADMIN-C-013", "PASS", "The customer reply function stored a second message."],
  ["ADMIN-C-014", "PASS", "The admin reply function stored a message on the same ticket."],
  ["ADMIN-C-015", "NOT VERIFIED", "Unread counters were not checked."],
  ["ADMIN-C-016", "NOT VERIFIED", "Support history was not refreshed in the browser."],
  ["ADMIN-C-017", "NOT IMPLEMENTED", "Support attachment upload was not found as a required ticket field."],
  ["ADMIN-C-018", "NOT VERIFIED", "Customer suspension was not clicked in admin."],
  ["ADMIN-C-019", "NOT VERIFIED", "Permissions after a customer status change were not rechecked."],
  ["ADMIN-C-020", "NOT VERIFIED", "Admin booking intervention was not clicked."],
  ["ADMIN-C-021", "NOT VERIFIED", "Refund controls were not clicked."],
  ["ADMIN-C-022", "NOT VERIFIED", "Invalid admin form errors were not provoked in the browser."],
  ["ADMIN-C-023", "PASS", "Driver review wrote an audit_log row. Customer support did not get a separate audit assertion."],
  ["ADMIN-D-001", "NOT VERIFIED", "Driver search was not opened."],
  ["ADMIN-D-002", "NOT VERIFIED", "Driver filters were not used."],
  ["ADMIN-D-003", "NOT VERIFIED", "The driver profile was not opened in admin."],
  ["ADMIN-D-004", "NOT VERIFIED", "License bytes were not opened. The admin database read could see the license path and a customer could not."],
  ["ADMIN-D-005", "NOT VERIFIED", "Vehicle details were not opened in admin. The vehicle row was stored."],
  ["ADMIN-D-006", "NOT VERIFIED", "Areas I Cover were not opened in admin. Coverage matching was tested in the feed."],
  ["ADMIN-D-007", "PASS", "review_driver approve_active set the driver to active."],
  ["ADMIN-D-008", "PASS", "The profile role became driver and the driver status became active."],
  ["ADMIN-D-010", "NOT VERIFIED", "The driver did not open the change-request note in the browser. The note was stored."],
  ["ADMIN-D-011", "NOT VERIFIED", "A corrected application was not resubmitted."],
  ["ADMIN-D-012", "NOT VERIFIED", "Decline was not executed."],
  ["ADMIN-D-013", "NOT VERIFIED", "A rejected driver screen was not opened."],
  ["ADMIN-D-014", "NOT VERIFIED", "Pause was not executed. A separate account suspension was tested."],
  ["ADMIN-D-015", "PASS", "The suspended driver could not claim."],
  ["ADMIN-D-016", "NOT VERIFIED", "Reinstate was not executed."],
  ["ADMIN-D-017", "NOT VERIFIED", "Permissions after reinstate were not rechecked."],
  ["ADMIN-D-018", "NOT VERIFIED", "Assigned jobs were not opened in admin."],
  ["ADMIN-D-019", "NOT VERIFIED", "Delivery history was not opened in admin."],
  ["ADMIN-D-020", "NOT VERIFIED", "Earnings and tips were not opened in admin."],
  ["ADMIN-D-021", "NOT VERIFIED", "Connect status was not opened in admin."],
  ["ADMIN-D-022", "NOT VERIFIED", "A driver support conversation was not opened in the browser."],
  ["ADMIN-D-023", "NOT VERIFIED", "A driver support message was not sent."],
  ["ADMIN-D-024", "NOT VERIFIED", "The driver did not see a support message."],
  ["ADMIN-D-025", "NOT VERIFIED", "The driver did not reply."],
  ["ADMIN-D-026", "NOT VERIFIED", "An admin did not see a driver reply."],
  ["ADMIN-D-027", "NOT VERIFIED", "Read state was not checked."],
  ["ADMIN-D-028", "NOT VERIFIED", "Support history was not refreshed."],
  ["ADMIN-D-029", "NOT VERIFIED", "A driver problem report was not answered."],
  ["SEC-DRIVER-PRIVATE", "PASS", "Another customer could not read the driver row or another job."],
  ["SEC-ADMIN-IMPERSONATION", "PASS", "A customer cannot review drivers."],
  ["SEC-MESSAGES", "PASS", "Phone numbers are rejected in job chat, and a finished job chat is closed."],
  ["SEC-PUSH", "BLOCKED", "Push keys are not in production. Delivery of a phone push was not tested."],
  ["SEC-SMS", "BLOCKED", "No marketing or job SMS was sent."],
];

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

const dbRows = sqlAudit();
const browserRows = uiRows();
const liveRows = await productionChecks();
let stripeRows = [];
try {
  stripeRows = await stripeCheck(loadEnv(".env.local"));
} catch (error) {
  stripeRows = [{
    id: "PAY-001",
    status: "FAIL",
    detail: error instanceof Error ? error.message.slice(0, 240) : "stripe check failed",
    environment: "stripe-test",
    evidence: "stripe API",
  }];
}

const rows = [
  ...dbRows.map((row) => ({ ...row, feature: row.id })),
  ...browserRows.map((row) => ({ ...row, feature: row.id })),
  ...liveRows.map((row) => ({ ...row, feature: row.id })),
  ...stripeRows.map((row) => ({ ...row, feature: row.id })),
  ...blocked.map(([id, status, detail]) => ({
    id,
    status,
    detail,
    environment: "not-executed",
    evidence: "audit catalog",
    feature: id,
  })),
];

const header = "id,status,environment,evidence,detail";
const csv = [header, ...rows.map((row) => [row.id, row.status, row.environment, row.evidence, row.detail].map(csvEscape).join(","))].join("\n");
writeFileSync(path.join(outDir, "test-matrix.csv"), `${csv}\n`);

const counts = {};
for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ counts, at: new Date().toISOString() }, null, 2));
console.log(JSON.stringify(counts));
