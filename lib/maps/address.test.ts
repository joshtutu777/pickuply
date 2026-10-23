import assert from "node:assert/strict";
import test from "node:test";
import { addressFromComponents, manualAddressError } from "./address";

test("a Duluth house number stays a street, not a city guess", () => {
  const parsed = addressFromComponents(
    [
      { types: ["street_number"], longText: "1985" },
      { types: ["route"], longText: "Chattahoochee Drive" },
      { types: ["locality"], longText: "Duluth" },
      { types: ["administrative_area_level_1"], shortText: "GA", longText: "Georgia" },
      { types: ["postal_code"], longText: "30097" },
    ],
    { latitude: 34.0, longitude: -84.1 },
  );
  assert.equal(parsed?.line1, "1985 Chattahoochee Drive");
  assert.equal(parsed?.city, "Duluth");
  assert.equal(parsed?.zip, "30097");
  assert.equal(parsed?.lat, 34);
});

test("a non-Georgia result is dropped", () => {
  const parsed = addressFromComponents([
    { types: ["administrative_area_level_1"], shortText: "AL" },
    { types: ["postal_code"], longText: "30097" },
  ]);
  assert.equal(parsed, null);
});

test("manual entry needs a street, city, and ZIP, and does not require a map match", () => {
  assert.equal(manualAddressError({ line1: "", city: "Duluth", zip: "30097" }), "Enter the street address.");
  assert.equal(manualAddressError({ line1: "1985 Chattahoochee Dr", city: "Duluth", zip: "30097" }), null);
});
