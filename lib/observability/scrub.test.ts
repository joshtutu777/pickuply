import assert from "node:assert/strict";
import test from "node:test";
import { issueCountLabel, issuesHref, parseHits, sentrySlug } from "./issues";
import { browserName, maskId, pageUrl, scrubSentryEvent, scrubText, type ReportEvent } from "./scrub";

const customer = "123e4567-e89b-41d3-a456-426614174000";

test("emails, phones, secrets, and user ids are removed from error text", () => {
  const text = scrubText(
    `Mail ada@example.com or call (404) 555-1212 about ${customer}. Bearer secret sk_test_abc whsec_def +14045551212`,
  );
  assert.equal(text.includes("ada@example.com"), false);
  assert.equal(text.includes("555-1212"), false);
  assert.equal(text.includes("4045551212"), false);
  assert.equal(text.includes(customer), false);
  assert.equal(text.includes("sk_test_"), false);
  assert.equal(text.includes("whsec_"), false);
  assert.equal(text.includes("Bearer secret"), false);
  assert.match(text, /••••4000/);
});

test("a reported error keeps the page path and browser, and drops personal fields", () => {
  const event = scrubSentryEvent({
    message: "Failed for ada@example.com",
    user: { id: customer, email: "ada@example.com", username: "Ada", ip_address: "203.0.113.8" },
    request: {
      url: "https://pickuplyapp.com/jobs/1?email=ada@example.com",
      cookies: { session: "secret" },
      headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" },
      data: { phone: "404-555-1212" },
      query_string: "email=ada@example.com",
    },
    extra: { customer_name: "Ada", note: `Call 404-555-1212` },
    breadcrumbs: [{ message: "Opened ada@example.com", data: { address: "1 Main" } }],
  } as ReportEvent);
  assert.equal(event.request?.url, "https://pickuplyapp.com/jobs/1");
  assert.equal(event.request?.cookies, undefined);
  assert.equal(event.request?.headers, undefined);
  assert.equal(event.request?.data, undefined);
  assert.equal(event.user?.id, maskId(customer));
  assert.equal(event.user?.email, undefined);
  assert.equal(event.tags?.browser, "Chrome");
  assert.equal(JSON.stringify(event).includes("ada@example.com"), false);
  assert.equal(JSON.stringify(event).includes("555-1212"), false);
  assert.equal(JSON.stringify(event).includes("203.0.113.8"), false);
});

test("browser names and page paths stay short", () => {
  assert.equal(browserName("Mozilla/5.0 Version/17.0 Mobile Safari/605.1.15"), "Safari");
  assert.equal(browserName("Mozilla/5.0 Firefox/120.0"), "Firefox");
  assert.equal(pageUrl("/account?phone=404-555-1212"), "/account");
});

test("the admin error link and count stay plain", () => {
  assert.equal(sentrySlug("pickuply"), "pickuply");
  assert.equal(sentrySlug("not a slug"), "");
  assert.equal(issuesHref("pickuply"), "https://sentry.io/organizations/pickuply/issues/?query=is%3Aunresolved");
  assert.equal(parseHits("3"), 3);
  assert.equal(parseHits("nope"), null);
  assert.equal(issueCountLabel(1), "1 unresolved error");
  assert.equal(issueCountLabel(0), "0 unresolved errors");
});
