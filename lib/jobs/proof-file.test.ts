import assert from "node:assert/strict";
import test from "node:test";
import { proofMediaKind } from "./proof-file";

test("a chosen photo counts even when the phone leaves the type blank", () => {
  assert.equal(proofMediaKind({ type: "", name: "image.jpg", size: 10 }), "photo");
  assert.equal(proofMediaKind({ type: "", name: "photo", size: 10 }), "photo");
  assert.equal(proofMediaKind({ type: "image/heic", name: "item.heic", size: 10 }), "photo");
  assert.equal(proofMediaKind({ type: "video/mp4", name: "clip.mp4", size: 10 }), "video");
  assert.equal(proofMediaKind({ type: "application/pdf", name: "note.pdf", size: 10 }), null);
  assert.equal(proofMediaKind({ type: "image/jpeg", name: "empty.jpg", size: 0 }), null);
});
