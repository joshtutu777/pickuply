import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignSegments,
  deliveryStatusLabel,
  distinctPhoneKeys,
  parseSmsAudience,
  renderCampaignSms,
  smsPhoneKey,
} from "./campaign";

test("a campaign text uses the first name, the prefix, and the STOP line", () => {
  const text = renderCampaignSms("Hi {{first_name}}, Saturday hours are open.", "Pat Driver", true);
  assert.equal(text, "Pickuply: Hi Pat, Saturday hours are open. Reply STOP to opt out.");
  assert.equal(campaignSegments("Hi {{first_name}}.", "Pat", true), 1);
  assert.equal(renderCampaignSms("Your account needs a look.", "", false), "Pickuply: Your account needs a look.");
});

test("a missing name still reads as a sentence", () => {
  assert.match(renderCampaignSms("Hi {{first_name}}.", "   ", true), /Hi there\./);
});

test("phone keys ignore a leading 1 and drop duplicates", () => {
  assert.equal(smsPhoneKey("+1 (404) 555-0100"), "4045550100");
  assert.equal(smsPhoneKey("4045550100"), "4045550100");
  assert.equal(smsPhoneKey("30106"), null);
  const distinct = distinctPhoneKeys(["+14045550100", "404-555-0100", "4045550199"]);
  assert.deepEqual(distinct.keys, ["4045550100", "4045550199"]);
  assert.equal(distinct.duplicatesRemoved, 1);
});

test("ZIP, city, and state filters can be combined", () => {
  const audience = parseSmsAudience({
    kind: "both",
    ids: "",
    zips: "30071, 30096",
    cities: "Norcross\nDuluth",
    states: "ga",
  });
  assert.deepEqual(audience, {
    kind: "both",
    zips: ["30071", "30096"],
    cities: ["Norcross", "Duluth"],
    states: ["GA"],
  });
  assert.throws(() => parseSmsAudience({ kind: "individual", ids: "", zips: "", cities: "", states: "" }), /exactly one/);
  assert.throws(() => parseSmsAudience({ kind: "customers", ids: "", zips: "3007", cities: "", states: "" }), /5-digit/);
  assert.throws(() => parseSmsAudience({ kind: "selected", ids: "", zips: "", cities: "", states: "" }), /at least one/);
  assert.throws(() => parseSmsAudience({ kind: "drivers", ids: "", zips: "", cities: "", states: "Georgia" }), /two-letter/);
});

test("a recorded text is never labeled delivered", () => {
  assert.equal(deliveryStatusLabel("skipped"), "Not sent");
  assert.equal(deliveryStatusLabel("mocked"), "Simulated");
  assert.equal(deliveryStatusLabel("deferred"), "Waiting");
  assert.equal(deliveryStatusLabel("sent"), "Sent");
  assert.equal(deliveryStatusLabel("failed"), "Failed");
  assert.equal(deliveryStatusLabel("delivered"), "Not sent");
});
