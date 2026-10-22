import assert from "node:assert/strict";
import test from "node:test";
import { fees } from "./constants";
import { applyMinimumPrice, estimateRange, type EstimateInput } from "./pricing";

function input(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    service: null,
    size: null,
    pieces: null,
    stairsPickup: null,
    stairsDropoff: null,
    helpLoading: null,
    junkLoadSize: null,
    ...overrides,
  };
}

test("delivery light load is $35–$60", () => {
  assert.deepEqual(
    estimateRange(
      input({
        service: "delivery",
        size: "medium",
        pieces: 1,
        stairsPickup: 0,
        stairsDropoff: 0,
        helpLoading: true,
      }),
    ),
    { minCents: 3_500, maxCents: 6_000 },
  );
});

test("delivery without help uses full service for one item", () => {
  assert.deepEqual(
    estimateRange(
      input({
        service: "delivery",
        size: "small",
        pieces: 1,
        stairsPickup: 0,
        stairsDropoff: 0,
        helpLoading: false,
      }),
    ),
    { minCents: 9_000, maxCents: 12_000 },
  );
});

test("delivery of one large item is full service", () => {
  assert.deepEqual(
    estimateRange(
      input({
        service: "delivery",
        size: "large",
        pieces: 1,
        stairsPickup: 0,
        stairsDropoff: 0,
        helpLoading: true,
      }),
    ),
    { minCents: 9_000, maxCents: 12_000 },
  );
});

test("delivery of multiple pieces is the multi-piece range", () => {
  assert.deepEqual(
    estimateRange(
      input({
        service: "delivery",
        size: "medium",
        pieces: 3,
        stairsPickup: 0,
        stairsDropoff: 0,
        helpLoading: true,
      }),
    ),
    { minCents: 14_000, maxCents: 20_000 },
  );
});

test("each full-service flight adds $15–$25", () => {
  assert.deepEqual(
    estimateRange(
      input({
        service: "delivery",
        size: "large",
        pieces: 1,
        stairsPickup: 2,
        stairsDropoff: 0,
        helpLoading: true,
      }),
    ),
    { minCents: 12_000, maxCents: 17_000 },
  );
});

test("delivery without size or stairs has no number", () => {
  assert.equal(
    estimateRange(input({ service: "delivery", size: "large", pieces: 1 })),
    null,
  );
});

test("free-item pickups use the light-load range", () => {
  assert.deepEqual(estimateRange(input({ service: "free_item" })), {
    minCents: 3_500,
    maxCents: 6_000,
  });
});

test("junk ranges follow load size", () => {
  assert.deepEqual(
    estimateRange(input({ service: "junk", junkLoadSize: "single" })),
    { minCents: 5_000, maxCents: 7_500 },
  );
  assert.deepEqual(
    estimateRange(input({ service: "junk", junkLoadSize: "quarter" })),
    { minCents: 9_000, maxCents: 13_000 },
  );
  assert.deepEqual(
    estimateRange(input({ service: "junk", junkLoadSize: "half" })),
    { minCents: 15_000, maxCents: 22_000 },
  );
  assert.deepEqual(
    estimateRange(input({ service: "junk", junkLoadSize: "full" })),
    { minCents: 25_000, maxCents: 35_000 },
  );
});

test("junk without a load size has no number", () => {
  assert.equal(estimateRange(input({ service: "junk" })), null);
});

test("construction uses full service and stairs", () => {
  assert.deepEqual(
    estimateRange(
      input({
        service: "construction",
        pieces: 1,
        stairsPickup: 0,
        stairsDropoff: 0,
      }),
    ),
    { minCents: 9_000, maxCents: 12_000 },
  );
  assert.deepEqual(
    estimateRange(
      input({
        service: "construction",
        pieces: 2,
        stairsPickup: 1,
        stairsDropoff: 0,
      }),
    ),
    { minCents: 15_500, maxCents: 22_500 },
  );
});

test("construction without pieces has no number", () => {
  assert.equal(estimateRange(input({ service: "construction" })), null);
});

test("the $35 minimum raises a lower range", () => {
  assert.deepEqual(applyMinimumPrice({ minCents: 1_000, maxCents: 2_000 }), {
    minCents: fees.minimumCents,
    maxCents: fees.minimumCents,
  });
});

test("every spec estimate stays at or above the $35 minimum", () => {
  const ranges = [
    estimateRange(input({ service: "free_item" })),
    estimateRange(input({ service: "junk", junkLoadSize: "single" })),
    estimateRange(
      input({
        service: "delivery",
        size: "small",
        pieces: 1,
        stairsPickup: 0,
        stairsDropoff: 0,
        helpLoading: true,
      }),
    ),
  ];
  for (const range of ranges) {
    assert.ok(range);
    assert.ok(range.minCents >= fees.minimumCents);
    assert.ok(range.maxCents >= range.minCents);
  }
});
