import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("optional marketing texts start unchecked for customers and drivers", () => {
  const login = source("../../app/login/login-form.tsx");
  const driver = source("../../components/driver/onboarding-form.tsx");
  const consent = source("../../components/sms-consent.tsx");

  assert.match(login, /const \[smsOptIn, setSmsOptIn\] = useState\(false\)/);
  assert.match(driver, /const \[smsOptIn, setSmsOptIn\] = useState\(false\)/);
  assert.match(login, /if \(smsOptIn\)/);
  assert.match(driver, /if \(smsOptIn\)/);
  assert.equal(login.includes("useState(true)"), false);
  assert.equal(driver.includes("useState(true)"), false);
  assert.match(consent, /The sign-in code is separate/);
  assert.match(consent, /Optional text messages/);
  assert.match(consent, /Consent is not required to register/);
  assert.match(consent, /Consent is not required to apply/);
});
