import assert from "node:assert/strict";
import test from "node:test";
import { bookingTextMessage } from "./text-choice";

test("the text choice explains whether booking texts are available", () => {
  assert.match(bookingTextMessage({ available: false, optedOut: false, optedIn: false }), /not turned on yet/);
  assert.match(bookingTextMessage({ available: true, optedOut: false, optedIn: false }), /Check the box/);
  assert.match(bookingTextMessage({ available: true, optedOut: false, optedIn: true }), /Booking texts are on/);
  assert.match(bookingTextMessage({ available: true, optedOut: true, optedIn: false }), /START/);
});
