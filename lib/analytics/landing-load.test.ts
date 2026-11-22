import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldLoadTagManager } from "@/lib/analytics/tracking";
import {
  assignCampaignLabel,
  landingCampaignCap,
  landingLoadFromLocation,
  landingLoadNone,
  landingLoadOverflow,
  landingLoadPath,
} from "@/lib/analytics/landing-load";

const root = readFileSync(new URL("../../components/analytics/analytics-root.tsx", import.meta.url), "utf8");
const recorder = readFileSync(new URL("./landing-load-client.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/0145_landing_load_counts.sql", import.meta.url), "utf8");

const adUrl = "https://pickuplyapp.com/?utm_source=facebook&utm_campaign=spring_pickup&campaign_id=123&fbclid=CLICK123";

test("a landing load is the same when cookies are allowed, rejected, or unanswered", () => {
  const expected = {
    path: "/",
    source: "facebook",
    campaign: "spring_pickup",
  };
  for (const consent of ["granted", "denied", null] as const) {
    assert.deepEqual(landingLoadFromLocation(adUrl, ""), expected);
    assert.equal(
      shouldLoadTagManager({ consent, isTest: false, loaded: false }),
      consent === "granted",
    );
  }
});

test("a landing load keeps the path, source category, and campaign label only", () => {
  const record = landingLoadFromLocation(adUrl, "https://evil.example/secret");
  assert.deepEqual(Object.keys(record ?? {}).sort(), ["campaign", "path", "source"]);
  assert.equal(JSON.stringify(record).includes("CLICK123"), false);
  assert.equal(JSON.stringify(record).includes("evil.example"), false);
  assert.equal(JSON.stringify(record).includes("fbclid"), false);
});

test("a job address and a free-text campaign are not stored", () => {
  assert.equal(landingLoadPath("/jobs/11111111-1111-4111-8111-111111111111"), null);
  assert.equal(landingLoadPath("/admin/analytics/leads"), null);
  const record = landingLoadFromLocation(
    "https://pickuplyapp.com/request?utm_campaign=name@email.test&utm_source=google",
    "",
  );
  assert.equal(record?.path, "/request");
  assert.equal(record?.campaign, landingLoadNone);
});

test("a new campaign label joins the overflow bucket after the daily cap", () => {
  const existing = Array.from({ length: landingCampaignCap }, (_, index) => `camp_${index}`);
  assert.equal(assignCampaignLabel(existing, "camp_0"), "camp_0");
  assert.equal(assignCampaignLabel(existing, "brand_new"), landingLoadOverflow);
  assert.equal(assignCampaignLabel(existing, landingLoadOverflow), landingLoadOverflow);
});

test("the page records a landing load without reading the cookie choice", () => {
  const start = root.indexOf("Landing load counts");
  const end = root.indexOf("recordLeadStage", start);
  const block = root.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(block, /recordLandingLoad/);
  assert.equal(block.includes("consent"), false);
  assert.match(recorder, /page_path: record\.path/);
  assert.match(recorder, /source_name: record\.source/);
  assert.match(recorder, /campaign_name: record\.campaign/);
  assert.equal(recorder.includes("fbclid"), false);
  assert.equal(recorder.includes("browser_session"), false);
});

test("the migration stores counts without a visitor identifier", () => {
  assert.match(migration, /primary key \(counted_on, landing_path, source_category, campaign_label\)/);
  assert.match(migration, /using \(public\.is_admin\(\)\)/);
  assert.match(migration, /minute_count > 600/);
  assert.match(migration, /distinct_labels >= 100/);
  assert.match(migration, /revoke all on public\.landing_load_counts from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.record_landing_load\(text, text, text\) to anon, authenticated/);
  const table = migration.slice(
    migration.indexOf("create table public.landing_load_counts"),
    migration.indexOf("create table public.landing_load_minutes"),
  );
  for (const forbidden of ["fbclid", "session_id", "ip_address", "email", "phone"]) {
    assert.equal(table.toLowerCase().includes(forbidden), false, forbidden);
  }
});
