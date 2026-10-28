import assert from "node:assert/strict";
import test from "node:test";
import { compareNewest, mergeFeedCards } from "./feed-order";

test("newer requests sort ahead of older ones and ties use the id", () => {
  const jobs = [
    { id: "b", created_at: "2026-10-27T12:00:00.000Z" },
    { id: "c", created_at: "2026-10-27T15:00:00.000Z" },
    { id: "a", created_at: "2026-10-27T15:00:00.000Z" },
  ];
  const ordered = [...jobs].sort(compareNewest).map((job) => job.id);
  assert.deepEqual(ordered, ["a", "c", "b"]);
});

test("a feed refresh keeps the schedule and photos the driver is already using", () => {
  type Card = {
    id: string;
    created_at: string;
    photos: string[];
    schedule?: { availability: string };
  };
  const current: Card[] = [
    { id: "job-1", created_at: "2026-10-27T12:00:00.000Z", photos: ["kept"], schedule: { availability: "anytime" } },
  ];
  const incoming: Card[] = [
    { id: "job-1", created_at: "2026-10-27T12:00:00.000Z", photos: [], schedule: undefined },
    { id: "job-2", created_at: "2026-10-27T13:00:00.000Z", photos: [], schedule: undefined },
  ];
  const merged = mergeFeedCards(current, incoming);
  assert.deepEqual(merged[0]?.photos, ["kept"]);
  assert.deepEqual(merged[0]?.schedule, { availability: "anytime" });
  assert.equal(merged[1]?.schedule, undefined);
});
