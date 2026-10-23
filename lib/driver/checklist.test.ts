import assert from "node:assert/strict";
import test from "node:test";
import { checklistItems, checklistProgress } from "./checklist";

test("the readiness checklist is vehicle, insurance, and training", () => {
  const items = checklistItems({
    vehicleType: "pickup",
    insuranceUrl: null,
    trainingDone: false,
    notes: { insurance: "The expiry date isn't readable." },
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["vehicle", "insurance", "training"],
  );
  assert.equal(items.find((item) => item.id === "vehicle")?.mark, "uploaded");
  assert.equal(items.find((item) => item.id === "insurance")?.mark, "needs_changes");
  assert.equal(items.find((item) => item.id === "training")?.mark, "todo");
  assert.equal(checklistProgress(items).done, 1);
  assert.equal(checklistProgress(items).total, 3);
});
