import assert from "node:assert/strict";
import test from "node:test";
import { checklistItems, checklistProgress } from "./checklist";

test("signup license and vehicle type count before the other steps", () => {
  const items = checklistItems({
    services: 0,
    coverageSaved: true,
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

test("services stay to do until coverage is saved, and the checklist stays seven items", () => {
  const missing = checklistItems({
    services: 2,
    coverageSaved: false,
    vehicleType: null,
    licenseUrl: null,
    kitSaved: false,
    insuranceUrl: null,
    agreementSigned: false,
    trainingDone: false,
    notes: {},
  });
  assert.equal(missing.find((item) => item.id === "services")?.mark, "todo");
  const ready = checklistItems({
    services: 2,
    coverageSaved: true,
    vehicleType: null,
    licenseUrl: null,
    kitSaved: false,
    insuranceUrl: null,
    agreementSigned: false,
    trainingDone: false,
    notes: {},
  });
  assert.equal(ready.find((item) => item.id === "services")?.mark, "done");
  assert.equal(checklistProgress(ready).total, 7);
});
