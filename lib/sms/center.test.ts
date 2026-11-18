import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComposeChoice,
  audienceFromForm,
  audienceRule,
  dedupePhones,
  formatEstimate,
  inboundKeyword,
  inboundReply,
  mapTwilioStatus,
  messagePreview,
  needsSendConfirm,
  nextDeliveryStatus,
  operationalContentAllowed,
  recipientDecision,
  runSmsDispatch,
  scheduledInstant,
  smsEstimateCents,
  smsPurposeFromForm,
  type DispatchIo,
  type RecipientCheck,
} from "./center";
import { twilioSignature, twilioSignatureValid } from "./signature";

const person = (overrides: Partial<RecipientCheck> = {}): RecipientCheck => ({
  optedOut: false,
  isTest: false,
  laneTest: false,
  promotional: true,
  smsEnabled: true,
  suspended: false,
  role: "driver",
  driverEligible: true,
  online: true,
  ...overrides,
});

test("all drivers replaces the default selected-people field", () => {
  const form = new FormData();
  form.append("audience", "people");
  applyComposeChoice(form, { audience: "drivers", delivery: "now", purpose: "operational" });
  assert.equal(form.get("audience"), "drivers");
  assert.deepEqual(audienceFromForm(form), { audience: { kind: "drivers" } });
});

test("phone numbers are normalized and duplicates are sent once", () => {
  const rows = dedupePhones([
    { phone: "(404) 555-0100", id: "a" },
    { phone: "+14045550100", id: "b" },
    { phone: "not-a-phone", id: "c" },
    { phone: "14045550101", id: "d" },
  ]);
  assert.deepEqual(rows.map((row) => row.phone), ["+14045550100", "+14045550101"]);
});

test("bulk audiences describe when the people are chosen", () => {
  assert.equal(audienceRule({ kind: "online_drivers" }), "Drivers who are Online when the text is sent");
  assert.equal(audienceRule({ kind: "drivers" }), "All eligible drivers");
  assert.equal(needsSendConfirm(1), false);
  assert.equal(needsSendConfirm(2), true);
  assert.equal(smsEstimateCents(2, 42), 70);
  assert.equal(formatEstimate(70), "$0.70");
});

test("optional texts stay within the segment helper and add the stop line", () => {
  const preview = messagePreview("A job is open.", 3);
  assert.ok(!("error" in preview));
  if ("error" in preview) return;
  assert.match(preview.body, /^Pickuply:/);
  assert.match(preview.body, /Reply STOP to opt out/);
  assert.equal(preview.segments, 1);
  assert.equal(preview.cents, 2);
});

test("a job alert is operational and does not need promotional consent", () => {
  const jobAlert = "Hi, 2 new pickup jobs are available on Pickuply. View details and submit your offers: https://pickuplyapp.com/driver/jobs";
  assert.equal(operationalContentAllowed(jobAlert), true);
  assert.equal(operationalContentAllowed("Take 20% off your next pickup with promo code SAVE."), false);
  assert.equal(recipientDecision(person({ promotional: false, smsEnabled: true }), "drivers", "operational"), "send");
  assert.equal(recipientDecision(person({ promotional: false, smsEnabled: false }), "drivers", "operational"), "skip");
  assert.equal(recipientDecision(person({ optedOut: true, smsEnabled: true, promotional: false }), "drivers", "operational"), "skip");
  assert.equal(recipientDecision(person({ promotional: false, smsEnabled: true, role: "customer", driverEligible: false }), "customers", "operational"), "send");
  assert.equal(recipientDecision(person({ promotional: false, smsEnabled: true, online: false }), "online_drivers", "operational"), "skip");
  assert.equal(recipientDecision(person({ promotional: false, smsEnabled: true, online: true }), "online_drivers", "operational"), "send");
  assert.equal(recipientDecision(person({ promotional: false, smsEnabled: true }), "drivers", "promotional"), "skip");
  const form = new FormData();
  assert.equal(smsPurposeFromForm(form), "operational");
  form.set("purpose", "promotional");
  assert.equal(smsPurposeFromForm(form), "promotional");
});

test("opted-out, test, and promotional consent are enforced before a send", () => {
  assert.equal(recipientDecision(person({ optedOut: true }), "drivers", "promotional"), "skip");
  assert.equal(recipientDecision(person({ isTest: true }), "drivers", "promotional"), "skip");
  assert.equal(recipientDecision(person({ promotional: false }), "drivers", "promotional"), "skip");
  assert.equal(recipientDecision(person({ smsEnabled: true, promotional: false }), "person", "operational"), "send");
  assert.equal(recipientDecision(person({ suspended: true }), "drivers", "promotional"), "skip");
  assert.equal(recipientDecision(person({ suspended: true, role: "customer" }), "customers", "operational"), "skip");
  assert.equal(recipientDecision(person({ suspended: true, role: "customer" }), "person", "operational"), "send");
  assert.equal(recipientDecision(person({ online: false }), "online_drivers", "promotional"), "skip");
  assert.equal(recipientDecision(person({ online: false }), "drivers", "promotional"), "send");
  assert.equal(recipientDecision(person({ role: "customer", driverEligible: false }), "customers", "promotional"), "send");
});

test("online drivers are not treated as a saved list", () => {
  const form = new FormData();
  form.set("audience", "online_drivers");
  const parsed = audienceFromForm(form);
  assert.ok("audience" in parsed);
  if (!("audience" in parsed)) return;
  assert.equal(parsed.audience.kind, "online_drivers");
});

test("one selected person is a valid audience and several people stay unique", () => {
  const one = new FormData();
  one.set("audience", "people");
  one.append("ids", "11111111-1111-4111-8111-111111111111");
  const parsed = audienceFromForm(one);
  assert.deepEqual(parsed, { audience: { kind: "person", ids: ["11111111-1111-4111-8111-111111111111"] } });

  const many = new FormData();
  many.set("audience", "selected");
  many.append("ids", "11111111-1111-4111-8111-111111111111");
  many.append("ids", "22222222-2222-4222-8222-222222222222");
  many.append("ids", "11111111-1111-4111-8111-111111111111");
  const selected = audienceFromForm(many);
  assert.ok("audience" in selected && selected.audience.kind === "selected" && selected.audience.ids.length === 2);

  const empty = new FormData();
  empty.set("audience", "person");
  assert.deepEqual(audienceFromForm(empty), { error: "Choose at least one person." });
});

test("a manual number must be a US number", () => {
  const form = new FormData();
  form.set("audience", "phone");
  form.set("phone", "123");
  assert.deepEqual(audienceFromForm(form), { error: "Enter a valid US phone number." });
  form.set("phone", "(404) 555-0199");
  assert.deepEqual(audienceFromForm(form), { audience: { kind: "phone", phone: "+14045550199" } });
});

test("an entered number with no account can be operational and still honors STOP", () => {
  const manual = person({ role: "manual", promotional: false, smsEnabled: false, driverEligible: false, online: false });
  assert.equal(recipientDecision(manual, "phone", "operational"), "send");
  assert.equal(recipientDecision(manual, "phone", "promotional"), "skip");
  assert.equal(recipientDecision({ ...manual, optedOut: true }, "phone", "operational"), "skip");
  assert.equal(recipientDecision(manual, "drivers", "operational"), "skip");
});

test("operational send now stays immediate outside quiet hours", () => {
  const morning = new FormData();
  morning.set("purpose", "operational");
  morning.set("delivery", "now");
  const early = scheduledInstant(morning, new Date("2026-11-14T12:30:00.000Z"));
  assert.deepEqual(early, { at: new Date("2026-11-14T12:30:00.000Z"), deferred: false });

  const night = new FormData();
  night.set("purpose", "operational");
  night.set("delivery", "now");
  const late = scheduledInstant(night, new Date("2026-11-15T04:00:00.000Z"));
  assert.deepEqual(late, { at: new Date("2026-11-15T04:00:00.000Z"), deferred: false });

  const later = new FormData();
  later.set("purpose", "operational");
  later.set("delivery", "later");
  later.set("date", "2026-11-14");
  later.set("time", "07:30");
  const scheduled = scheduledInstant(later, new Date("2026-11-14T11:00:00.000Z"));
  assert.deepEqual(scheduled, { at: new Date("2026-11-14T12:30:00.000Z"), deferred: false });
});

test("promotional texts still wait for 8:00 AM to 9:00 PM Eastern", () => {
  const closed = new FormData();
  closed.set("purpose", "promotional");
  closed.set("delivery", "now");
  const early = scheduledInstant(closed, new Date("2026-11-13T12:00:00.000Z"));
  assert.ok("error" in early && early.error.includes("Texts are closed") && early.error.includes("Schedule for Later"));
  closed.set("acceptQuiet", "yes");
  const accepted = scheduledInstant(closed, new Date("2026-11-13T12:00:00.000Z"));
  assert.ok(!("error" in accepted) && accepted.deferred && accepted.at.toISOString() === "2026-11-13T13:00:00.000Z");

  const open = new FormData();
  open.set("purpose", "promotional");
  open.set("delivery", "now");
  const immediate = scheduledInstant(open, new Date("2026-11-13T15:00:00.000Z"));
  assert.ok(!("error" in immediate) && !immediate.deferred);

  const later = new FormData();
  later.set("purpose", "promotional");
  later.set("delivery", "later");
  later.set("date", "2026-11-13");
  later.set("time", "15:00");
  const scheduled = scheduledInstant(later, new Date("2026-11-13T12:00:00.000Z"));
  assert.ok(!("error" in scheduled) && !scheduled.deferred && scheduled.at.toISOString() === "2026-11-13T20:00:00.000Z");
  later.set("time", "07:30");
  const tooEarly = scheduledInstant(later, new Date("2026-11-13T12:00:00.000Z"));
  assert.deepEqual(tooEarly, { error: "Choose a time between 8:00 AM and 9:00 PM Eastern." });
});

test("inbound keywords and delivery status stay idempotent", () => {
  assert.equal(inboundKeyword(" stop "), "stop");
  assert.equal(inboundKeyword("START"), "start");
  assert.equal(inboundKeyword("HELP"), "help");
  assert.match(inboundReply("stop"), /unsubscribed/i);
  assert.equal(mapTwilioStatus("delivered"), "delivered");
  assert.equal(mapTwilioStatus("undelivered"), "failed");
  assert.equal(nextDeliveryStatus("delivered", "sent"), "delivered");
  assert.equal(nextDeliveryStatus("accepted", "delivered"), "delivered");
});

test("webhook signatures reject a changed body", () => {
  const url = "https://pickuplyapp.com/api/twilio/sms";
  const params = new URLSearchParams({ Body: "STOP", From: "+14045550100" });
  const signature = twilioSignature(url, params, "test-token");
  assert.equal(twilioSignatureValid(url, params, "test-token", signature), true);
  params.set("Body", "START");
  assert.equal(twilioSignatureValid(url, params, "test-token", signature), false);
  assert.equal(twilioSignatureValid(url, params, "test-token", ""), false);
});

test("two schedulers cannot send the same campaign twice", async () => {
  const campaign = {
    id: "campaign-1",
    purpose: "promotional" as const,
    audience: { kind: "drivers" as const },
    body: "Pickuply: Two jobs are open. Reply STOP to opt out.",
    laneTest: false,
  };
  let available: typeof campaign | null = campaign;
  const sent: string[] = [];
  const reserved = new Set<string>();
  const io: DispatchIo = {
    async claim() {
      const next = available;
      available = null;
      return next;
    },
    async defer() {
      throw new Error("not deferred");
    },
    async recipients() {
      return [
        { ...person(), phone: "+14045550100", profileId: "p1" },
        { ...person(), phone: "+1 404 555 0100", profileId: "p1" },
        { ...person({ optedOut: true }), phone: "+14045550102", profileId: "p2" },
      ];
    },
    async reserve(_campaign, phone) {
      if (reserved.has(phone)) return null;
      reserved.add(phone);
      return phone;
    },
    async mark() {},
    async finish() {},
    async send(phone) {
      sent.push(phone);
      return { ok: true, sid: "SM1" };
    },
  };
  const [first, second] = await Promise.all([
    runSmsDispatch(io, new Date("2026-11-13T15:00:00.000Z")),
    runSmsDispatch(io, new Date("2026-11-13T15:00:00.000Z")),
  ]);
  assert.deepEqual(sent, ["+14045550100"]);
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
});

test("a provider failure is recorded and an unknown answer is not retried here", async () => {
  const marks: string[] = [];
  const io: DispatchIo = {
    async claim() {
      if (marks.length > 0) return null;
      return {
        id: "campaign-2",
        purpose: "operational" as const,
        audience: { kind: "person" as const, ids: ["p1"] },
        body: "Pickuply: Your pickup changed. Reply STOP to opt out.",
        laneTest: false,
      };
    },
    async defer() {},
    async recipients() {
      return [{ ...person({ role: "customer" }), phone: "+14045550100", profileId: "p1" }];
    },
    async reserve() {
      return "message-1";
    },
    async mark(_id, status) {
      marks.push(status);
    },
    async finish() {},
    async send() {
      return { ok: false, sid: null };
    },
  };
  const once = await runSmsDispatch(io, new Date("2026-11-13T15:00:00.000Z"));
  assert.equal(once.sent, 0);
  assert.deepEqual(marks, ["failed"]);
});

test("a Twilio outage is marked unknown and is not sent again", async () => {
  const marks: string[] = [];
  let claims = 0;
  const io: DispatchIo = {
    async claim() {
      claims += 1;
      if (claims > 1) return null;
      return {
        id: "campaign-4",
        purpose: "operational",
        audience: { kind: "person", ids: ["p1"] },
        body: "Pickuply: Your driver is on the way. Reply STOP to opt out.",
        laneTest: false,
      };
    },
    async defer() {},
    async recipients() {
      return [{ ...person({ role: "customer" }), phone: "+14045550100", profileId: "p1" }];
    },
    async reserve() {
      return "message-2";
    },
    async mark(_id, status) {
      marks.push(status);
    },
    async finish() {},
    async send() {
      throw new Error("twilio timeout");
    },
  };
  const result = await runSmsDispatch(io, new Date("2026-11-13T15:00:00.000Z"));
  assert.equal(result.sent, 0);
  assert.deepEqual(marks, ["unknown"]);
  const again = await runSmsDispatch(io, new Date("2026-11-13T15:00:00.000Z"));
  assert.equal(again.sent, 0);
  assert.deepEqual(marks, ["unknown"]);
});

test("an operational campaign sends outside quiet hours and is not turned into a later send", async () => {
  let sent = 0;
  let deferred = false;
  const io: DispatchIo = {
    async claim() {
      if (sent > 0 || deferred) return null;
      return {
        id: "campaign-ops",
        purpose: "operational",
        audience: { kind: "person", ids: ["p1"] },
        body: "Pickuply: Your driver is on the way. Reply STOP to opt out.",
        laneTest: false,
      };
    },
    async defer() {
      deferred = true;
    },
    async recipients() {
      return [{ ...person({ role: "customer" }), phone: "+14045550100", profileId: "p1" }];
    },
    async reserve() {
      return "message-ops";
    },
    async mark() {},
    async finish() {},
    async send() {
      sent += 1;
      return { ok: true, sid: "SM_ops" };
    },
  };
  const morning = await runSmsDispatch(io, new Date("2026-11-14T12:30:00.000Z"));
  assert.equal(morning.sent, 1);
  assert.equal(deferred, false);
  sent = 0;
  const night = await runSmsDispatch(io, new Date("2026-11-15T04:00:00.000Z"));
  assert.equal(night.sent, 1);
  assert.equal(deferred, false);
});

test("outside 8 AM to 9 PM a promotional campaign waits instead of sending", async () => {
  let deferred = "";
  let claimed = false;
  const io: DispatchIo = {
    async claim() {
      if (claimed) return null;
      claimed = true;
      return {
        id: "campaign-3",
        purpose: "promotional",
        audience: { kind: "drivers" },
        body: "Pickuply: Hello. Reply STOP to opt out.",
        laneTest: false,
      };
    },
    async defer(_id, sendAt) {
      deferred = sendAt.toISOString();
    },
    async recipients() {
      throw new Error("recipients should wait");
    },
    async reserve() {
      return null;
    },
    async mark() {},
    async finish() {},
    async send() {
      throw new Error("send should wait");
    },
  };
  const result = await runSmsDispatch(io, new Date("2026-11-13T12:00:00.000Z"));
  assert.equal(result.sent, 0);
  assert.ok(deferred);
});
