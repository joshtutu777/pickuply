import assert from "node:assert/strict";
import test from "node:test";
import { accountLinkKind, fallbackAccountLinkKind } from "./account-link";

test("a submitted account asks for an update link first", () => {
  assert.equal(accountLinkKind(false), "account_onboarding");
  assert.equal(accountLinkKind(true), "account_update");
});

test("an account that only allows onboarding falls back from update", () => {
  const message =
    'You cannot create `account_update` type Account Links for this account. Valid types for this account are ["account_onboarding"].';
  assert.equal(fallbackAccountLinkKind("account_update", message), "account_onboarding");
  assert.equal(fallbackAccountLinkKind("account_onboarding", message), null);
  assert.equal(fallbackAccountLinkKind("account_update", "something else"), null);
});
