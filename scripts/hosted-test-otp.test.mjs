import assert from "node:assert/strict";
import test from "node:test";
import { deployedTestPhones } from "./deployed-test-target.mjs";
import { mergeOtpMap, parseOtpMap, rosterCodes } from "./hosted-test-otp.mjs";

const existing = [
  "15555550123=101010",
  "15555550124=202020",
  "15555550125=303030",
  "15555550126=404040",
  "15555550177=505050",
  "15555550188=606060",
  "15555550199=707070",
  "15555550201=808080",
].join(",");

test("a merge keeps every existing code and adds the roster", () => {
  const env = Object.fromEntries(
    deployedTestPhones.map((phone, index) => [`PICKUPLY_TEST_OTP_${phone.slice(-4)}`, `1${String(index).padStart(5, "0")}`]),
  );
  const additions = rosterCodes(env, deployedTestPhones, parseOtpMap(existing).entries);
  const merged = mergeOtpMap(existing, additions);
  const map = parseOtpMap(merged).entries;
  assert.equal(map.size, 21);
  assert.equal(map.get("15555550123"), "101010");
  assert.equal(map.get("15555550201"), "808080");
  assert.equal(map.get("15555550301"), "100000");
  assert.equal(map.get("15555550313"), "100012");
  assert.equal(merged.includes("101010"), true);
});

test("an existing roster code is not replaced", () => {
  const text = `${existing},15555550301=424242`;
  const env = { PICKUPLY_TEST_OTP_0301: "999999" };
  const additions = rosterCodes(env, ["5555550301"], parseOtpMap(text).entries);
  const merged = mergeOtpMap(text, additions);
  assert.equal(parseOtpMap(merged).entries.get("15555550301"), "424242");
});

test("a missing new code is refused and an existing number can be absent from the environment", () => {
  assert.throws(() => rosterCodes({}, ["5555550301"], new Map()), /missing/);
  const existingMap = parseOtpMap("15555550301=424242").entries;
  assert.equal(rosterCodes({}, ["5555550301"], existingMap).size, 0);
});

test("a bad code is refused without being returned", () => {
  assert.throws(() => rosterCodes({ PICKUPLY_TEST_OTP_0301: "12" }, ["5555550301"], new Map()), /not valid/);
  assert.throws(() => mergeOtpMap("15555550123=101010,1555550123=202020", new Map()), /more than one length/);
});
