import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSubmissionId,
  requestService,
  safeSupabaseCode,
  safeSupabaseMessage,
  submissionId,
  submitErrorText,
  trackSavedRequest,
} from "./request-save";

const services = ["delivery", "free_item", "junk", "construction"] as const;

test("a saved request stays saved when analytics throws", async () => {
  for (const service of services) {
    assert.equal(requestService(service), service);
    let started = false;
    const tracked = await trackSavedRequest(async () => {
      started = true;
      throw new Error(`analytics failed for ${service}`);
    });
    assert.equal(started, true);
    assert.equal(tracked, false);
  }
  assert.equal(await trackSavedRequest(async () => undefined), true);
});

test("a database rejection keeps the stage and code and drops personal text", () => {
  assert.equal(safeSupabaseCode("P0001"), "P0001");
  assert.equal(safeSupabaseCode("23514"), "23514");
  assert.equal(safeSupabaseCode("not a code"), null);
  assert.equal(safeSupabaseMessage("profile not found"), "profile not found");
  assert.equal(safeSupabaseMessage("sign in required"), "sign in required");
  assert.equal(safeSupabaseMessage("customer name is required"), "customer name is required");
  assert.equal(safeSupabaseMessage("email ada@example.com is not valid"), null);
  assert.equal(safeSupabaseMessage("call 404-555-1212"), null);
  assert.equal(safeSupabaseMessage("Bearer eyJabc.def.ghi"), null);

  const shown = submitErrorText({
    code: "rejected",
    message: "We couldn't save this request. Your draft is still here.",
    stage: "database",
    supabaseCode: "P0001",
    safeDetail: "profile not found",
  });
  assert.equal(
    shown,
    "We couldn't save this request. Your draft is still here. Reference: database P0001 profile not found.",
  );
  assert.equal(
    submitErrorText({
      code: "auth",
      message: "Sign in again before saving this request.",
      stage: "auth",
      supabaseCode: null,
      safeDetail: "Auth session missing",
    }),
    "Sign in again before saving this request. Reference: auth Auth session missing.",
  );
  assert.equal(
    submitErrorText({
      code: "rejected",
      message: "We couldn't save this request. Your draft is still here.",
      stage: "profile",
      supabaseCode: "P0001",
      safeDetail: null,
    }),
    "We couldn't save this request. Your draft is still here. Reference: profile P0001.",
  );
});

test("a client exception is labeled client and a photo problem stays plain", () => {
  assert.equal(
    submitErrorText({
      code: "rejected",
      message: "We couldn't save this request. Your draft is still here.",
      stage: "client",
      supabaseCode: null,
      safeDetail: null,
    }),
    "We couldn't save this request. Your draft is still here. Reference: client.",
  );
  assert.equal(
    submitErrorText({
      code: "missing-photo",
      message: "Choose the missing photos again. The request itself is saved.",
      stage: "photos",
      supabaseCode: null,
      safeDetail: null,
    }),
    "Choose the missing photos again. The request itself is saved.",
  );
});

test("one browser tab keeps the same submission id until the save finishes", () => {
  const stored = new Map<string, string>();
  const memory = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", { value: memory, configurable: true });
  const first = submissionId();
  assert.equal(submissionId(), first);
  clearSubmissionId();
  const second = submissionId();
  assert.notEqual(second, first);
  assert.equal(submissionId(), second);
  clearSubmissionId();
});
