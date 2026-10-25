// Adds the 13 roster numbers to the hosted test-OTP map.
// Existing entries stay as they are. This does nothing unless the exact project flag is present.
// Codes are read from the environment and are never printed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { deployedTestPhones } from "./deployed-test-target.mjs";
import { hostedTestProjectRef } from "./hosted-test-guard.mjs";
import { mergeOtpMap, parseOtpMap, rosterCodes } from "./hosted-test-otp.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readEnvFile() {
  const values = {};
  const text = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trim().startsWith("#")) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return values;
}

async function main() {
  const flag = process.argv.find((arg) => arg.startsWith("--approve-hosted-otp="));
  const ref = flag ? flag.slice("--approve-hosted-otp=".length) : "";
  if (ref !== hostedTestProjectRef) {
    fail("Refusing: hosted test OTP stays unchanged without --approve-hosted-otp=uyhithfdmphilleusiom.");
  }

  const env = readEnvFile();
  const token = env.SUPABASE_ACCESS_TOKEN ?? "";
  if (!token) fail("The Supabase access token is missing.");

  const current = await fetch(`https://api.supabase.com/v1/projects/${hostedTestProjectRef}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!current.ok) fail("Could not read the current test OTP map.");
  const body = await current.json();
  const existing = String(body.sms_test_otp ?? "");
  const before = parseOtpMap(existing).entries.size;
  let merged;
  try {
    merged = mergeOtpMap(existing, rosterCodes(env, deployedTestPhones, parseOtpMap(existing).entries));
  } catch (error) {
    fail(error instanceof Error ? error.message : "Refusing.");
  }
  const after = parseOtpMap(merged).entries.size;
  if (after < before) fail("Refusing: the new map is smaller than the current map.");

  const updated = await fetch(`https://api.supabase.com/v1/projects/${hostedTestProjectRef}/config/auth`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sms_test_otp: merged,
      sms_test_otp_valid_until: body.sms_test_otp_valid_until || "2027-06-30T23:59:59Z",
    }),
  });
  if (!updated.ok) fail("Could not save the test OTP map.");
  console.log(`Test OTP map updated. Existing entries kept: ${before}. Total entries: ${after}.`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("apply-hosted-test-otp.mjs")) {
  main();
}
