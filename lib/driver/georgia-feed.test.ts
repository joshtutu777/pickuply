import assert from "node:assert/strict";
import test from "node:test";
import { georgiaSectionNote, rpcCount } from "./georgia-feed";

test("a count reads a number, a numeric string, or a wrapped result", () => {
  assert.equal(rpcCount(4), 4);
  assert.equal(rpcCount("3"), 3);
  assert.equal(rpcCount([{ driver_georgia_count: 2 }]), 2);
  assert.equal(rpcCount(null), 0);
});

test("matched jobs explain a Georgia count of zero", () => {
  assert.match(
    georgiaSectionNote({ loaded: true, matched: 4, shown: 0, filteredTotal: 0, unfilteredTotal: 0 }) ?? "",
    /Matched for You/,
  );
});

test("filters and an empty state stay distinct", () => {
  assert.match(
    georgiaSectionNote({ loaded: true, matched: 1, shown: 0, filteredTotal: 0, unfilteredTotal: 6 }) ?? "",
    /filters/,
  );
  assert.match(
    georgiaSectionNote({ loaded: true, matched: 0, shown: 0, filteredTotal: 0, unfilteredTotal: 0 }) ?? "",
    /No open requests/,
  );
});

test("a visible list does not also show the empty note", () => {
  assert.equal(
    georgiaSectionNote({ loaded: true, matched: 1, shown: 2, filteredTotal: 2, unfilteredTotal: 2 }),
    null,
  );
});
