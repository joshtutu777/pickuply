import assert from "node:assert/strict";
import test from "node:test";
import { buildReceiptText } from "./receipt";

test("a receipt lists the job, the driver, the fees, and the payment", () => {
  const text = buildReceiptText({
    jobId: "job-1",
    service: "junk",
    when: "2026-10-22",
    driverFirstName: "Sam",
    driverSubtotalCents: 5000,
    serviceFeeCents: 175,
    totalCents: 5175,
    tripFeeCents: null,
    capturedCents: 5175,
    refundedCents: 0,
    paymentStatus: "captured",
  });
  assert.match(text, /Job job-1/);
  assert.match(text, /Driver Sam/);
  assert.match(text, /Offer \$50\.00/);
  assert.match(text, /Card processing fee \$1\.75/);
  assert.match(text, /Total \$51\.75/);
  assert.match(text, /Refunds \$0\.00/);
  assert.doesNotMatch(text, /Trip fee/);
});

test("a rejected pickup receipt includes the trip fee", () => {
  const text = buildReceiptText({
    jobId: "job-2",
    service: "delivery",
    when: "2026-10-22",
    driverFirstName: "Sam",
    driverSubtotalCents: 4000,
    serviceFeeCents: 146,
    totalCents: 4146,
    tripFeeCents: 2500,
    capturedCents: 2500,
    refundedCents: 0,
    paymentStatus: "captured",
  });
  assert.match(text, /Trip fee \$25\.00/);
});
