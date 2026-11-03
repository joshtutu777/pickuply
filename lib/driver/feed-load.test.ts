import assert from "node:assert/strict";
import test from "node:test";
import { createFeedLoadController, feedLoadError } from "./feed-load";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a refresh during an active load keeps that response and runs once afterward", async () => {
  const feed = createFeedLoadController();
  const applied: string[] = [];
  const first = deferred<string>();
  const second = deferred<string>();
  let followRuns = 0;
  feed.bind(() => {
    followRuns += 1;
    void feed.run({
      work: () => second.promise,
      apply: (value) => applied.push(value),
      fail: (message) => applied.push(message),
    });
  });

  const running = feed.run({
    work: () => first.promise,
    apply: (value) => applied.push(value),
    fail: (message) => applied.push(message),
  });
  void feed.run({
    work: () => Promise.resolve("ignored"),
    apply: (value) => applied.push(value),
    fail: (message) => applied.push(message),
  });
  first.resolve("first");
  await running;
  assert.deepEqual(applied, ["first"]);
  assert.equal(followRuns, 1);

  second.resolve("second");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, ["first", "second"]);
});

test("a failed load releases the lock and the next load recovers", async () => {
  const feed = createFeedLoadController();
  const applied: string[] = [];
  const errors: string[] = [];

  await feed.run<string>({
    work: () => Promise.reject(new Error(feedLoadError)),
    apply: (value) => applied.push(value),
    fail: (message) => errors.push(message),
  });
  assert.deepEqual(errors, [feedLoadError]);
  assert.equal(applied.length, 0);

  await feed.run<string>({
    work: () => Promise.resolve("jobs"),
    apply: (value) => applied.push(value),
    fail: (message) => errors.push(message),
  });
  assert.deepEqual(applied, ["jobs"]);
  assert.deepEqual(errors, [feedLoadError]);
});

test("retiring the load ignores its response and does not run a queued refresh", async () => {
  const feed = createFeedLoadController();
  const applied: string[] = [];
  const first = deferred<string>();
  let followRuns = 0;
  feed.bind(() => {
    followRuns += 1;
  });

  const running = feed.run({
    work: () => first.promise,
    apply: (value) => applied.push(value),
    fail: () => applied.push("error"),
  });
  feed.queue();
  feed.retire();
  first.resolve("stale");
  await running;
  assert.equal(applied.length, 0);
  assert.equal(followRuns, 0);

  await feed.run<string>({
    work: () => Promise.resolve("fresh"),
    apply: (value) => applied.push(value),
    fail: () => applied.push("error"),
  });
  assert.deepEqual(applied, ["fresh"]);
});

test("a photo update after the driver changes is ignored", async () => {
  const feed = createFeedLoadController();
  let token = 0;
  const first = deferred<string>();
  const running = feed.run({
    work: () => first.promise,
    apply: (_value, current) => {
      token = current;
    },
    fail: () => {},
  });
  first.resolve("jobs");
  await running;
  assert.equal(feed.isCurrent(token), true);
  feed.retire();
  assert.equal(feed.isCurrent(token), false);
});
