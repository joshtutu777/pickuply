import assert from "node:assert/strict";
import test from "node:test";
import { areaLabel, messagePreviewText, previewSnippet, routeLabel, unreadLabel } from "./preview";

test("a preview uses the city and hides a street address", () => {
  assert.equal(areaLabel("Norcross, GA 30071"), "Norcross");
  assert.equal(areaLabel("Duluth 30096"), "Duluth");
  assert.equal(routeLabel("Norcross 30071", "Duluth 30096"), "Norcross → Duluth");
  assert.equal(previewSnippet("  I'm about   10 minutes away.  "), "I'm about 10 minutes away.");
  assert.equal(unreadLabel(2), "2 unread");
  const text = messagePreviewText({
    name: "Michael",
    role: "Driver",
    jobLabel: "Sofa pickup",
    pickup: "Norcross 30071",
    dropoff: "Duluth 30096",
    snippet: "I'm about 10 minutes away.",
    unread: 2,
    at: "2026-10-28T18:42:00.000Z",
  });
  assert.match(text, /Michael — Driver/);
  assert.match(text, /Sofa pickup · Norcross → Duluth/);
  assert.match(text, /I'm about 10 minutes away/);
  assert.match(text, /2 unread/);
  assert.equal(areaLabel("12 Secret Street, Duluth"), "");
  assert.equal(text.includes("Secret"), false);
});
