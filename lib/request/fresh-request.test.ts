import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { freshRequestHref } from "./fresh-request";

test("each new request link has its own id", () => {
  const first = freshRequestHref();
  const second = freshRequestHref("junk");
  assert.match(first, /^\/request\?new=/);
  assert.match(second, /service=junk/);
  assert.notEqual(first, freshRequestHref());
});

test("the request screen starts over and does not keep the old quote sentence", () => {
  const wizard = readFileSync(
    path.join(process.cwd(), "components/request/request-wizard.tsx"),
    "utf8",
  );
  const button = readFileSync(
    path.join(process.cwd(), "components/driver/advance-button.tsx"),
    "utf8",
  );
  assert.equal(wizard.includes("freshKey"), true);
  assert.equal(wizard.includes("Request sent. Drivers can now review your request and send offers."), true);
  assert.equal(wizard.includes("We're preparing your price"), false);
  assert.equal(wizard.includes("Start another request"), true);
  assert.equal(button.includes("startTransition"), false);
  assert.equal(button.includes("action={advanceJob}"), true);
});
