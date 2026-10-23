import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_DENIED_MESSAGE,
  accessStateFromProfile,
  continueDestination,
  decideAccess,
  roleHome,
  safeIntent,
  safeNextParam,
  type AccessDecision,
  type AccessState,
  type Role,
} from "./access";

const anonymous: AccessState = { status: "anonymous" };
const missing: AccessState = { status: "missing-profile" };

function needs(role: Role): AccessState {
  return { status: "needs-name", role };
}

function ready(role: Role): AccessState {
  return { status: "ready", role, fullName: "Ada Lovelace" };
}

function decision(pathname: string, state: AccessState, search = ""): AccessDecision {
  return decideAccess({ pathname, search, state });
}

function redirectTo(pathname: string, state: AccessState, search = ""): string {
  const result = decision(pathname, state, search);
  assert.equal(result.type, "redirect");
  if (result.type !== "redirect") throw new Error("expected a redirect");
  return result.location;
}

function assertAllowed(pathname: string, state: AccessState, search = "") {
  assert.deepEqual(decision(pathname, state, search), { type: "allow" });
}

test("role homes", () => {
  assert.equal(roleHome("customer"), "/account");
  assert.equal(roleHome("driver"), "/driver");
  assert.equal(roleHome("admin"), "/admin");
  assert.equal(ACCESS_DENIED_MESSAGE, "You don't have access to that page.");
});

test("blank names need the name step", () => {
  assert.deepEqual(accessStateFromProfile({ signedIn: true, role: "customer", fullName: "  " }), {
    status: "needs-name",
    role: "customer",
  });
  assert.equal(
    accessStateFromProfile({ signedIn: true, role: "owner", fullName: "Ada" }).status,
    "missing-profile",
  );
});

test("signed-out visitors are sent to login from protected pages only", () => {
  assert.equal(new URL(redirectTo("/account", anonymous), "http://local").searchParams.get("next"), "/account");
  assert.equal(
    new URL(redirectTo("/driver/onboarding", anonymous), "http://local").searchParams.get("next"),
    "/driver/onboarding",
  );
  assert.equal(new URL(redirectTo("/admin/jobs", anonymous), "http://local").searchParams.get("next"), "/admin/jobs");
  assert.equal(
    new URL(redirectTo("/login/name", anonymous, "?next=/driver"), "http://local").searchParams.get("next"),
    "/driver",
  );
  assertAllowed("/administrator", anonymous);
  assertAllowed("/login", anonymous);
  assertAllowed("/", anonymous);
  assertAllowed("/request", anonymous);
});

test("a missing profile fails closed on protected pages and stays on login", () => {
  assert.equal(redirectTo("/account", missing), "/login?error=profile");
  assert.equal(redirectTo("/admin", missing), "/login?error=profile");
  assert.equal(redirectTo("/login/name", missing), "/login?error=profile");
  assertAllowed("/login", missing);
  assertAllowed("/", missing);
  assertAllowed("/request", missing);
});

test("a blank name stops at the name step before any protected page", () => {
  const next = new URL(redirectTo("/account", needs("customer")), "http://local");
  assert.equal(next.pathname, "/login/name");
  assert.equal(next.searchParams.get("next"), "/account");
  assertAllowed("/login/name", needs("driver"));
  assertAllowed("/login/name/extra", needs("admin"));
  assertAllowed("/", needs("customer"));
  assertAllowed("/request", needs("customer"));
  const fromLogin = new URL(redirectTo("/login", needs("customer"), "?next=/driver/onboarding"), "http://local");
  assert.equal(fromLogin.pathname, "/login/name");
  assert.equal(fromLogin.searchParams.get("next"), "/driver/onboarding");
});

test("a named person leaves login and is limited to their role", () => {
  assert.equal(redirectTo("/login", ready("customer")), "/auth/continue");
  const namedNext = new URL(redirectTo("/login", ready("customer"), "?next=/driver"), "http://local");
  assert.equal(namedNext.pathname, "/auth/continue");
  assert.equal(namedNext.searchParams.get("next"), "/driver");
  assert.equal(redirectTo("/login/name", ready("driver")), "/auth/continue");
  assert.equal(redirectTo("/login", ready("customer"), "?next=https://evil.example"), "/auth/continue");
  const driverIntent = new URL(
    redirectTo("/login", ready("customer"), "?next=/driver/onboarding&intent=driver"),
    "http://local",
  );
  assert.equal(driverIntent.pathname, "/auth/continue");
  assert.equal(driverIntent.searchParams.get("next"), "/driver/onboarding");
  assert.equal(driverIntent.searchParams.get("intent"), "driver");
  assert.equal(
    new URL(redirectTo("/login", ready("customer"), "?intent=not-real"), "http://local").searchParams.get("intent"),
    null,
  );

  assert.equal(redirectTo("/admin", ready("customer")), "/account?error=forbidden");
  assert.equal(redirectTo("/admin/jobs", ready("driver")), "/driver?error=forbidden");
  assertAllowed("/admin", ready("admin"));
  assertAllowed("/admin/jobs", ready("admin"));

  assertAllowed("/driver", ready("customer"));
  assertAllowed("/driver", ready("admin"));
  assertAllowed("/driver", ready("driver"));
  assertAllowed("/driver/onboarding", ready("customer"));
  assertAllowed("/driver/ready/insurance", ready("customer"));
  assertAllowed("/driver/ready/agreement", ready("customer"));
  assertAllowed("/driver/training", ready("customer"));
  assertAllowed("/driver/onboarding/docs", ready("admin"));
  assert.equal(redirectTo("/driver/earnings", ready("customer")), "/account?error=forbidden");
  assert.equal(redirectTo("/driver/profile", ready("customer")), "/account?error=forbidden");
  assert.equal(redirectTo("/driver/notifications", ready("customer")), "/account?error=forbidden");
  assert.equal(redirectTo("/driver/jobs", ready("customer")), "/account?error=forbidden");
  assert.equal(redirectTo("/driver/onboarding-extra", ready("customer")), "/account?error=forbidden");
  assertAllowed("/driver/jobs", ready("driver"));

  assertAllowed("/account", ready("customer"));
  assertAllowed("/account", ready("driver"));
  assertAllowed("/account", ready("admin"));
  assertAllowed("/administrator", ready("customer"));
  assertAllowed("/", ready("customer"));
  assertAllowed("/request", ready("admin"));
});

test("continue drops external and forbidden destinations", () => {
  assert.equal(continueDestination("customer", "https://evil.example"), "/account");
  assert.equal(continueDestination("customer", "/admin"), "/account?error=forbidden");
  assert.equal(continueDestination("driver", "/admin/users"), "/driver?error=forbidden");
  assert.equal(continueDestination("customer", "/driver"), "/driver");
  assert.equal(continueDestination("admin", "/driver/onboarding"), "/driver/onboarding");
  assert.equal(continueDestination("customer", "/login"), "/account");
  assert.equal(continueDestination("customer", "/auth/continue"), "/account");
  assert.equal(continueDestination("admin", null), "/admin");
  assert.equal(continueDestination("customer", "/driver/onboarding", "driver"), "/driver/onboarding");
  assert.equal(continueDestination("customer", null, "driver"), "/driver/onboarding");
  assert.equal(continueDestination("driver", "/driver/onboarding", "driver"), "/driver");
  assert.equal(continueDestination("driver", "/account", "driver"), "/driver");
  assert.equal(continueDestination("customer", "/account", "driver"), "/account");
  assert.equal(continueDestination("admin", "/driver/onboarding", "driver"), "/driver/onboarding");
  assert.equal(continueDestination("customer", "https://evil.example", "not-a-driver"), "/account");
  assert.equal(safeIntent("driver"), "driver");
  assert.equal(safeIntent("admin"), null);
  assert.equal(safeIntent("driver/../admin"), null);
  assert.equal(safeNextParam("//evil.example"), null);
  assert.equal(safeNextParam("/account?error=forbidden"), "/account?error=forbidden");
});
