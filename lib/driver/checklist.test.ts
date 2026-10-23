import assert from "node:assert/strict";
import test from "node:test";
import { checklistItems, checklistProgress } from "./checklist";

test("signup license and vehicle type count before the other steps", () => {
  const items = checklistItems({
    services: 0,
    vehicleType: "pickup",
    licenseUrl: "driver/license.jpg",
    kitSaved: false,
    insuranceUrl: null,
    agreementSigned: false,
    trainingDone: false,
    notes: { insurance: "The expiry date isn't readable." },
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["services", "vehicle", "license", "equipment", "insurance", "agreement", "training"],
  );
  assert.equal(items.find((item) => item.id === "license")?.mark, "uploaded");
  assert.equal(items.find((item) => item.id === "vehicle")?.mark, "uploaded");
  assert.equal(items.find((item) => item.id === "insurance")?.mark, "needs_changes");
  assert.equal(items.find((item) => item.id === "services")?.mark, "todo");
  assert.equal(checklistProgress(items).done, 2);
  assert.equal(checklistProgress(items).total, 7);
});
