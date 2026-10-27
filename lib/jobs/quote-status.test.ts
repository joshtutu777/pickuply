import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { quoteRequestCopy } from "./quote-status";

const quote = {
  pricingMethod: "quote",
  paymentStatus: null as string | null,
  service: "delivery",
};

test("an older quote that is not open says it is not on the driver list yet", () => {
  for (const status of ["requested", "in_review", "quoted"]) {
    assert.equal(
      quoteRequestCopy({ ...quote, status }),
      "This saved request is not open for driver offers yet.",
    );
  }
});

test("an accepted quote uses the existing driver availability wording", () => {
  assert.equal(
    quoteRequestCopy({ ...quote, status: "open" }),
    "Drivers can see this request. Nothing is booked until one is assigned.",
  );
  assert.equal(
    quoteRequestCopy({ ...quote, status: "assigned", paymentStatus: "awaiting_payment" }),
    "Confirm booking — your card is held, not charged, until your item is delivered.",
  );
  assert.equal(
    quoteRequestCopy({ ...quote, status: "assigned", paymentStatus: "authorized" }),
    "The driver is confirmed and can head to the pickup.",
  );
  assert.equal(
    quoteRequestCopy({ ...quote, status: "completed", paymentStatus: "captured" }),
    "This request is finished.",
  );
});

test("name your price and budget range keep their own wording", () => {
  assert.equal(quoteRequestCopy({ ...quote, pricingMethod: "fixed", status: "open" }), null);
  assert.equal(quoteRequestCopy({ ...quote, pricingMethod: "range", status: "quoted" }), null);
});

test("the driver job page does not show the customer quote sentence", () => {
  const driverPage = readFileSync(path.join(process.cwd(), "app/driver/jobs/[id]/page.tsx"), "utf8");
  const customerPage = readFileSync(path.join(process.cwd(), "components/request/job-status.tsx"), "utf8");
  assert.equal(driverPage.includes("Drivers can send offers"), false);
  assert.equal(driverPage.includes("We're preparing your price"), false);
  assert.equal(customerPage.includes("We're preparing your price"), false);
  assert.equal(customerPage.includes("quoteRequestCopy"), true);
  assert.equal(customerPage.includes("Drivers can send offers"), false);
});
