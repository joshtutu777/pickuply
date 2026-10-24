import assert from "node:assert/strict";
import test from "node:test";
import { headerInstallPlan, inAppBrowser, installCopy, showInstallPrompt, startDestination } from "./install";

test("in-app browsers get open-in-browser instructions", () => {
  assert.equal(inAppBrowser("Mozilla/5.0 Instagram 123"), true);
  assert.equal(inAppBrowser("FBAN"), true);
  assert.match(installCopy({ userAgent: "TikTok", installed: false, ios: true }) ?? "", /Open in browser/);
});

test("an installed app hides the install prompt", () => {
  assert.equal(installCopy({ userAgent: "Safari", installed: true, ios: true }), null);
  assert.equal(showInstallPrompt({ installed: true, dismissedAt: null, now: "2026-10-24T00:00:00.000Z", audience: "driver", hasRequest: false }), false);
});

test("drivers see the prompt and customers wait for a request and 14 days", () => {
  assert.equal(showInstallPrompt({ installed: false, dismissedAt: null, now: "2026-10-24T00:00:00.000Z", audience: "customer", hasRequest: false }), false);
  assert.equal(showInstallPrompt({ installed: false, dismissedAt: null, now: "2026-10-24T00:00:00.000Z", audience: "customer", hasRequest: true }), true);
  assert.equal(
    showInstallPrompt({
      installed: false,
      dismissedAt: "2026-10-20T00:00:00.000Z",
      now: "2026-10-24T00:00:00.000Z",
      audience: "driver",
      hasRequest: false,
    }),
    false,
  );
  assert.equal(
    showInstallPrompt({
      installed: false,
      dismissedAt: "2026-10-01T00:00:00.000Z",
      now: "2026-10-24T00:00:00.000Z",
      audience: "driver",
      hasRequest: false,
    }),
    true,
  );
});

test("the header install button follows the browser", () => {
  assert.equal(headerInstallPlan({ installed: true, userAgent: "Chrome", canPrompt: true }), "hidden");
  assert.equal(headerInstallPlan({ installed: false, userAgent: "Chrome", canPrompt: true }), "native");
  assert.equal(headerInstallPlan({ installed: false, userAgent: "iPhone", canPrompt: false }), "ios");
  assert.equal(headerInstallPlan({ installed: false, userAgent: "Instagram", canPrompt: false }), "in-app");
  assert.equal(headerInstallPlan({ installed: false, userAgent: "Firefox", canPrompt: false }), "guidance");
});

test("the installed start route follows the signed-in mode", () => {
  assert.equal(startDestination({ signedIn: false, role: null }), "/");
  assert.equal(startDestination({ signedIn: true, role: "customer" }), "/account");
  assert.equal(startDestination({ signedIn: true, role: "driver" }), "/driver");
  assert.equal(startDestination({ signedIn: true, role: "admin" }), "/admin");
});
