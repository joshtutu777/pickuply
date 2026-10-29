import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  adminEmptyMessage,
  adminEmptyTitle,
  customerEmptyAction,
  customerEmptyTitle,
  driverEmptyLinks,
  georgiaEmptyMessage,
  georgiaEmptyTitle,
  matchedEmptyMessage,
  matchedEmptyTitle,
  showAdminRequestEmpty,
} from "./marketplace-empty";

test("driver empty copy and links stay tied to real setup", () => {
  assert.equal(matchedEmptyTitle, "No pickup requests yet");
  assert.match(matchedEmptyMessage, /Keep notifications on and stay Online/);
  assert.equal(georgiaEmptyTitle, "No open requests across Georgia right now");
  assert.equal(georgiaEmptyMessage, "We'll alert you when one comes in.");
  assert.deepEqual(driverEmptyLinks({ payoutReady: true, notificationsOn: true }), {
    areas: true,
    payout: false,
    notifications: false,
    share: true,
  });
  assert.equal(driverEmptyLinks({ payoutReady: false, notificationsOn: false }).payout, true);
  assert.equal(driverEmptyLinks({ payoutReady: false, notificationsOn: false }).notifications, true);
});

test("customer and admin empty copy matches the current product", () => {
  assert.equal(customerEmptyTitle, "No pickups yet");
  assert.equal(customerEmptyAction, "Request a pickup");
  assert.equal(adminEmptyTitle, "No requests yet");
  assert.match(adminEmptyMessage, /you'll get an alert/);
  assert.equal(showAdminRequestEmpty(0, 0), true);
  assert.equal(showAdminRequestEmpty(4, 0), false);
});

test("the driver feed refreshes from the lane signal and removes the channel", () => {
  const source = readFileSync("components/driver/driver-home.tsx", "utf8");
  const empty = readFileSync("components/driver/feed-empty.tsx", "utf8");
  assert.match(source, /job_feed_signals/);
  assert.match(source, /is_test=eq\./);
  assert.match(source, /removeChannel/);
  assert.match(empty, /matchedEmptyTitle/);
  assert.match(empty, /georgiaEmptyTitle/);
  assert.match(empty, /\/driver\/earnings/);
  assert.match(empty, /\/driver\/notifications/);
  const migration = readFileSync("supabase/migrations/0121_same_lane_alerts.sql", "utf8");
  assert.match(migration, /profiles\.is_test = new\.is_test/);
  assert.match(migration, /profiles\.is_test = job_test/);
  assert.doesNotMatch(migration, /delete from public\./i);
});
