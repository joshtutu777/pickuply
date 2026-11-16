import assert from "node:assert/strict";
import test from "node:test";
import { photoSourceMaxBytes } from "./constants";
import { prepareStoredPhoto } from "./photos";

test("a phone-sized picture is not refused before it can be resized when conversion is on", async () => {
  const file = new File([new Uint8Array(6 * 1024 * 1024)], "license.jpg", { type: "image/jpeg" });
  await assert.rejects(
    () => prepareStoredPhoto(file, "photo", true),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("too large"), false);
      return true;
    },
  );
});

test("the previous upload path still refuses a photo over 5 MB when conversion is off", async () => {
  const file = new File([new Uint8Array(6 * 1024 * 1024)], "license.jpg", { type: "image/jpeg" });
  await assert.rejects(() => prepareStoredPhoto(file, "photo", false), /Each photo must be 5 MB or smaller/);
});

test("an enormous picture is refused", async () => {
  const file = new File([new Uint8Array(photoSourceMaxBytes + 1)], "huge.jpg", { type: "image/jpeg" });
  await assert.rejects(() => prepareStoredPhoto(file), /That photo is too large/);
});
