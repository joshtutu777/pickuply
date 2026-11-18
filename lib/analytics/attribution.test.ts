import assert from "node:assert/strict";
import test from "node:test";
import { campaignFields, classifySource, emptyTouch, leadWriteAllowed, touchFromLocation } from "./attribution";

test("campaign parameters are kept only after consent", () => {
  const touch = touchFromLocation(
    new URL("https://pickuplyapp.com/?utm_source=facebook&utm_campaign=fall&campaign_id=123&fbclid=AbC_12"),
    "https://facebook.com/ads",
  );
  assert.equal(touch.utmSource, "facebook");
  assert.equal(touch.metaCampaignId, "123");
  assert.equal(touch.fbclid, "AbC_12");
  const denied = campaignFields(touch, "denied");
  assert.equal(denied.utmSource, null);
  assert.equal(denied.metaCampaignId, null);
  assert.equal(denied.fbclid, null);
  assert.equal(denied.referrerHost, "facebook.com");
});

test("a click id does not become a campaign", () => {
  const touch = touchFromLocation(new URL("https://pickuplyapp.com/?fbclid=IwAR123"), "");
  assert.equal(touch.utmCampaign, null);
  assert.equal(touch.metaCampaignId, null);
  assert.equal(classifySource({ utmSource: null, referrerHost: null }), "direct");
});

test("email-like campaign text is dropped", () => {
  const touch = touchFromLocation(new URL("https://pickuplyapp.com/?utm_campaign=ada@example.com"), "");
  assert.equal(touch.utmCampaign, null);
});

test("only an allowed cookie choice can be stored", () => {
  assert.equal(leadWriteAllowed("granted"), true);
  assert.equal(leadWriteAllowed("denied"), false);
  assert.equal(leadWriteAllowed("unknown"), false);
});

test("sources stay in the known groups", () => {
  assert.equal(classifySource({ utmSource: "instagram", referrerHost: null }), "instagram");
  assert.equal(classifySource({ utmSource: null, referrerHost: "l.facebook.com" }), "facebook");
  assert.equal(classifySource({ utmSource: null, referrerHost: "news.example" }), "referral");
  assert.equal(classifySource({ utmSource: "newsletter", referrerHost: null }), "other");
  assert.equal(classifySource(emptyTouch()), "direct");
});
