import assert from "node:assert/strict";
import test from "node:test";
import { containsContact } from "./contact";

test("a phone number or email is caught before a message is sent", () => {
  assert.equal(containsContact("I'm outside"), false);
  assert.equal(containsContact("call me at 404-555-0100"), true);
  assert.equal(containsContact("text 4045550100"), true);
  assert.equal(containsContact("write me at pat@example.com"), true);
  assert.equal(containsContact("Call me at 555-0100"), true);
  assert.equal(containsContact("Call me at 555 0100"), true);
  assert.equal(containsContact("2 items"), false);
  assert.equal(containsContact("ZIP 30106"), false);
  assert.equal(containsContact("room 12"), false);
  assert.equal(containsContact("See you at 3"), false);
  assert.equal(containsContact("(404) 555 1234"), true);
  assert.equal(containsContact("404.555.1234"), true);
  assert.equal(containsContact("four zero four five five five one two three four"), true);
  assert.equal(containsContact("pat at gmail dot com"), true);
  assert.equal(containsContact("pat(at)gmail(dot)com"), true);
  assert.equal(containsContact("two items"), false);
  assert.equal(containsContact("4045551234.jpg"), true);
  assert.equal(containsContact("5550100"), false);
  assert.equal(
    containsContact("c1060000-0000-4000-8000-0000000000a1/notes.txt"),
    false,
  );
  assert.equal(
    containsContact("c1060000-0000-4000-8000-0000000000a1/too-big.jpg"),
    false,
  );
  assert.equal(containsContact("Gate code is 4821#"), false);
  assert.equal(containsContact("code 1234"), false);
  assert.equal(containsContact("#5590"), false);
  assert.equal(containsContact("Order # 2849103756"), false);
  assert.equal(containsContact("Home Depot order WC12345678"), false);
  assert.equal(containsContact("pickup number 7731"), false);
  assert.equal(containsContact("confirmation PO 14045550100"), false);
  assert.equal(containsContact("1985 Chattahoochee Dr, Apt 2304, Duluth 30097"), false);
  assert.equal(containsContact("$150"), false);
  assert.equal(containsContact("72 x 36 inches"), false);
  assert.equal(containsContact("at 2:30 PM"), false);
  assert.equal(containsContact("two chairs and one table"), false);
  assert.equal(containsContact("3rd floor"), false);
  assert.equal(containsContact("4045551234"), true);
  assert.equal(containsContact("call me at 404 555"), true);
  assert.equal(containsContact("pat@gmail.com"), true);
  assert.equal(containsContact("Order # 2849103756 call me at 4045551234"), true);
});
