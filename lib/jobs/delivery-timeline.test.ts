import assert from "node:assert/strict";
import test from "node:test";
import { deliveryStageIndex, deliveryStages } from "./delivery-timeline";

test("the customer timeline follows the saved delivery steps", () => {
  assert.equal(deliveryStageIndex("open", false), -1);
  assert.equal(deliveryStageIndex("assigned", false), 0);
  assert.equal(deliveryStageIndex("item_check", false), 3);
  assert.equal(deliveryStageIndex("in_transit", false), 4);
  assert.equal(deliveryStageIndex("in_transit", true), 5);
  assert.equal(deliveryStageIndex("delivered", true), 6);
  assert.equal(deliveryStageIndex("completed", true), 7);
  const delivered = deliveryStages("delivered", true);
  assert.equal(delivered[6].state, "current");
  assert.equal(delivered[6].label, "Delivered");
  assert.equal(delivered[7].state, "upcoming");
  assert.equal(delivered[0].state, "done");
});
