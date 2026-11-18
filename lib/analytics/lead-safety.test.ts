import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync(new URL("../../components/request/request-wizard.tsx", import.meta.url), "utf8");
const collect = readFileSync(new URL("./lead-collect.ts", import.meta.url), "utf8");
const pay = readFileSync(new URL("../../components/request/pay-panel.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/0144_lead_analytics.sql", import.meta.url), "utf8");

test("a saved request is confirmed before lead attribution runs", () => {
  const confirmed = wizard.indexOf("setSentId(job.id)");
  const tracked = wizard.indexOf("void trackSavedRequest");
  const recorded = wizard.indexOf('recordLeadStage("request_submitted"');
  assert.ok(confirmed > 0 && tracked > confirmed && recorded > tracked);
});

test("a rejected cookie choice returns before any lead write", () => {
  const gate = collect.indexOf("if (!leadWriteAllowed(consent)) return");
  const write = collect.indexOf("record_lead_activity");
  assert.ok(gate > 0 && gate < write);
  assert.match(collect, /consent === "denied"/);
  assert.match(collect, /clearLeadTouch\(\)/);
});

test("checkout does not collect lead events", () => {
  assert.equal(pay.includes("lead-collect"), false);
  assert.equal(pay.includes("recordLeadStage"), false);
});

test("the migration stores a visit only after consent is granted", () => {
  const guard = migration.indexOf("allowed_consent is distinct from 'granted'");
  const limited = migration.indexOf("lead_rate_allow(browser_session)");
  const inserted = migration.indexOf("insert into public.lead_visits");
  assert.ok(guard > 0 && limited > guard && inserted > limited);
  assert.match(migration, /char_length\(stage_name\) > 40/);
  assert.match(migration, /minute_events > 400/);
  assert.match(migration, /revoke all on function public\.lead_rate_allow\(uuid\) from public, anon, authenticated/);
  assert.match(migration, /using \(public\.is_admin\(\)\)/);
  assert.match(migration, /visit\.consent is distinct from 'granted'/);
});
