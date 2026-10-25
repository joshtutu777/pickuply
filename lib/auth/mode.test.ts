import assert from "node:assert/strict";
import test from "node:test";
import { preferredHome } from "./mode";

test("mode is navigation only and does not invent a driver home", () => {
  assert.equal(
    preferredHome({ role: "customer", mode: "driver", hasDriver: false, next: null, intent: null }),
    "/account",
  );
  assert.equal(
    preferredHome({ role: "customer", mode: "driver", hasDriver: true, next: null, intent: null }),
    "/driver",
  );
  assert.equal(
    preferredHome({ role: "driver", mode: "customer", hasDriver: true, next: null, intent: null }),
    "/account",
  );
  assert.equal(
    preferredHome({ role: "driver", mode: null, hasDriver: true, next: null, intent: null }),
    "/driver",
  );
  assert.equal(
    preferredHome({ role: "customer", mode: null, hasDriver: true, next: null, intent: null }),
    "/driver",
  );
  assert.equal(
    preferredHome({
      role: "customer",
      mode: "customer",
      hasDriver: true,
      next: null,
      intent: null,
    }),
    "/account",
  );
  assert.equal(
    preferredHome({
      role: "customer",
      mode: null,
      hasDriver: true,
      next: "/driver/onboarding",
      intent: "driver",
    }),
    "/driver",
  );
  assert.equal(
    preferredHome({ role: "admin", mode: "customer", hasDriver: false, next: null, intent: null }),
    "/admin",
  );
  assert.equal(
    preferredHome({
      role: "customer",
      mode: "customer",
      hasDriver: false,
      next: "/driver/onboarding",
      intent: "driver",
    }),
    "/driver/onboarding",
  );
});
