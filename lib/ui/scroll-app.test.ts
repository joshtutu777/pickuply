import assert from "node:assert/strict";
import test from "node:test";
import { scrollIntent } from "./scroll-app";

test("transaction screens start at the top unless the reader is going back", () => {
  assert.equal(scrollIntent({ hash: "", popped: false }), "top");
  assert.equal(scrollIntent({ hash: "messages", popped: false }), "hash");
  assert.equal(scrollIntent({ hash: "messages", popped: true }), "restore");
});
