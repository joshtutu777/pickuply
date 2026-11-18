import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoField } from "./photos/photo-field";
import { PendingButton } from "./pending-button";
import { UploadPicker } from "./upload-picker";

const pay = readFileSync(new URL("./request/pay-panel.tsx", import.meta.url), "utf8");
const wizard = readFileSync(new URL("./request/request-wizard.tsx", import.meta.url), "utf8");

test("the upload card shows the camera graphic and keeps the chosen file types", () => {
  const html = renderToStaticMarkup(
    <UploadPicker id="photos" accept="image/*,.heic" multiple label="Add item photos, up to 8" kinds="Camera or photo library" />,
  );
  assert.match(html, /border-dashed/);
  assert.match(html, /Add item photos, up to 8/);
  assert.match(html, /Camera or photo library/);
  assert.match(html, /accept="image\/\*,\.heic"/);
  assert.match(html, /<circle /);
});

test("the photo field keeps camera and library choices", () => {
  const html = renderToStaticMarkup(
    <PhotoField id="license" label="Driver license photo" onPhotos={() => undefined} />,
  );
  assert.match(html, /Take photo/);
  assert.match(html, /Photo library/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /border-dashed/);
});

test("an idle action button shows its label and a busy spinner slot", () => {
  const html = renderToStaticMarkup(
    <PendingButton idle="Looks good" pendingLabel="Saving" className="save" />,
  );
  assert.match(html, /Looks good/);
  assert.match(html, /type="submit"/);
  assert.equal(html.includes("Saving"), false);
});

test("checkout stays on its current button", () => {
  assert.equal(pay.includes("pending-button"), false);
  assert.equal(pay.includes("UploadPicker"), false);
});

test("the request form still hands the selected files to the existing photo handler", () => {
  const card = wizard.indexOf("<UploadPicker");
  const handler = wizard.indexOf("onChange={(files) => void onPhotos(files)}");
  const remove = wizard.indexOf("onRemove(preview.id)");
  assert.ok(card > 0 && handler > card && remove > handler);
});
