import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { customerRequestEntry, emptyOfferMessage, notificationWindowUrl } from "./customer-request";

const jobId = "c9775caf-2d8b-470c-9e62-5bb8ff3b4fff";

test("a signed-out customer is sent to log in for a real request link", () => {
  assert.equal(customerRequestEntry(jobId, false), "sign-in");
  assert.equal(customerRequestEntry(jobId, true), "show");
  assert.equal(customerRequestEntry("not-a-job", false), "invalid");
  assert.equal(customerRequestEntry("not-a-job", true), "invalid");
});

test("an open request with no selectable offers explains the two-hour window", () => {
  assert.match(emptyOfferMessage("open"), /2 hours/);
  assert.match(emptyOfferMessage("open"), /still here/);
  assert.match(emptyOfferMessage("quoted"), /2 hours/);
  assert.equal(emptyOfferMessage("assigned").includes("2 hours"), false);
});

test("a notification opens on this site with a full address", () => {
  assert.equal(
    notificationWindowUrl(`/jobs/${jobId}`, "https://pickuplyapp.com"),
    `https://pickuplyapp.com/jobs/${jobId}`,
  );
  assert.equal(
    notificationWindowUrl("https://evil.example/jobs", "https://pickuplyapp.com"),
    "https://pickuplyapp.com/account/notifications",
  );
  const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /new URL\(href, self\.location\.origin\)/);
});
