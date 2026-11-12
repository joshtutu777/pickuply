import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { livemodeNoteDecision } from "./livemode-note";

test("a missing mode can be recorded once", () => {
  assert.equal(livemodeNoteDecision(null, false), "record");
  assert.equal(livemodeNoteDecision(null, true), "record");
});

test("writing the saved mode again is a retry", () => {
  assert.equal(livemodeNoteDecision(false, false), "retry");
  assert.equal(livemodeNoteDecision(true, true), "retry");
});

test("a test payment cannot become live, and a live payment cannot become test", () => {
  assert.equal(livemodeNoteDecision(false, true), "reject");
  assert.equal(livemodeNoteDecision(true, false), "reject");
});

test("checkout and authorization note a mode only through the guard", () => {
  const checkout = readFileSync(new URL("../../app/jobs/pay/actions.ts", import.meta.url), "utf8");
  const events = readFileSync(new URL("./platform-events.ts", import.meta.url), "utf8");
  const writer = readFileSync(new URL("./note-recorded-livemode.ts", import.meta.url), "utf8");
  assert.equal(checkout.includes("note_stripe_livemode"), false);
  assert.equal(events.includes("note_stripe_livemode"), false);
  assert.match(checkout, /recordLivemodeIfUnset/);
  assert.match(events, /livemodeNoteDecision/);
  assert.match(events, /recordLivemodeIfUnset/);
  assert.match(writer, /livemodeNoteDecision/);
  assert.ok(writer.indexOf("livemodeNoteDecision") < writer.indexOf("note_stripe_livemode"));
});
