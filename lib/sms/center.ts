import { promotionalSms, quietWindow, resolveNyWall, smsSegments } from "@/lib/communications/sms";
import { normalizeUsPhone } from "@/lib/phone";

export const smsConfirmCount = 1;
export const smsMaxRecipients = 1000;
export const smsBodyLimit = 640;

export type SmsPurpose = "promotional" | "operational";
export type AudienceKind = "person" | "selected" | "customers" | "drivers" | "online_drivers" | "phone";
export type SmsDeliveryStatus = "queued" | "accepted" | "sent" | "delivered" | "failed" | "unknown" | "skipped";

export type SmsAudience =
  | { kind: "person"; ids: string[] }
  | { kind: "selected"; ids: string[] }
  | { kind: "customers" }
  | { kind: "drivers" }
  | { kind: "online_drivers" }
  | { kind: "phone"; phone: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function audienceRule(audience: SmsAudience): string {
  if (audience.kind === "person") return "One selected person";
  if (audience.kind === "selected") return `${audience.ids.length} selected people`;
  if (audience.kind === "customers") return "All eligible customers";
  if (audience.kind === "drivers") return "All eligible drivers";
  if (audience.kind === "online_drivers") return "Drivers who are Online when the text is sent";
  return "One entered phone number";
}

export function needsSendConfirm(count: number): boolean {
  return count > smsConfirmCount;
}

/** About 0.83 cents per US segment, rounded to the nearest cent. This is an estimate, not a charge. */
export function smsEstimateCents(segments: number, recipients: number): number {
  if (segments < 1 || recipients < 1) return 0;
  return Math.round((segments * recipients * 83) / 100);
}

export function formatEstimate(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function optionalSmsBody(body: string): string {
  return promotionalSms(body).slice(0, smsBodyLimit);
}

export function inboundKeyword(body: string): "stop" | "start" | "help" | "message" {
  const word = body.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(word)) return "stop";
  if (["START", "UNSTOP", "YES"].includes(word)) return "start";
  if (word === "HELP" || word === "INFO") return "help";
  return "message";
}

export function inboundReply(keyword: ReturnType<typeof inboundKeyword>): string {
  if (keyword === "stop") return "You are unsubscribed from optional Pickuply texts. Sign-in codes are separate.";
  if (keyword === "start") return "You are signed up for optional Pickuply texts again. Reply STOP to opt out. Sign-in codes are separate.";
  if (keyword === "help") return "Pickuply optional texts. Reply STOP to opt out. Email info@pickuplyapp.com for help.";
  return "Pickuply received your message. Reply HELP for help or STOP to opt out.";
}

export function mapTwilioStatus(value: string | null): SmsDeliveryStatus {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "queued" || status === "accepted") return "accepted";
  if (status === "sending" || status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "undelivered" || status === "failed") return "failed";
  return "unknown";
}

/** A later callback must not erase a delivered or failed result. */
export function nextDeliveryStatus(current: SmsDeliveryStatus, incoming: SmsDeliveryStatus): SmsDeliveryStatus {
  if (current === "delivered" || current === "failed" || current === "skipped") return current;
  if (current === "sent" && incoming === "accepted") return current;
  return incoming;
}

export function providerErrorCode(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 8);
  return digits || null;
}

export type RecipientCheck = {
  optedOut: boolean;
  isTest: boolean;
  laneTest: boolean;
  promotional: boolean;
  smsEnabled: boolean;
  suspended: boolean;
  role: string;
  driverEligible: boolean;
  online: boolean;
};

export function recipientDecision(person: RecipientCheck, audience: AudienceKind, purpose: SmsPurpose): "send" | "skip" {
  if (person.isTest !== person.laneTest) return "skip";
  if (person.role === "manual") {
    if (person.optedOut || audience !== "phone" || purpose !== "operational") return "skip";
    return "send";
  }
  if (person.optedOut) return "skip";
  if (person.role !== "customer" && person.role !== "driver") return "skip";
  if (purpose === "promotional") {
    if (!person.promotional || person.suspended) return "skip";
  } else if (purpose === "operational") {
    if (!person.smsEnabled) return "skip";
    if (person.suspended && audience !== "person" && audience !== "selected" && audience !== "phone") return "skip";
  } else return "skip";
  if (audience === "customers" && person.role !== "customer") return "skip";
  if (audience === "drivers" || audience === "online_drivers") {
    if (person.role !== "driver" || !person.driverEligible) return "skip";
    if (audience === "online_drivers" && !person.online) return "skip";
  }
  return "send";
}

export function dedupePhones<T extends { phone: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const phone = normalizeUsPhone(row.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    kept.push({ ...row, phone });
  }
  return kept;
}

/** The visible radios reset to Selected people on submit. The saved choice has to replace that field. */
export function applyComposeChoice(
  form: FormData,
  choice: { audience: string; delivery: string; purpose: string },
): void {
  form.set("audience", choice.audience);
  form.set("delivery", choice.delivery);
  form.set("purpose", choice.purpose);
}

const kinds = new Set<string>(["people", "person", "selected", "customers", "drivers", "online_drivers", "phone"]);

export function audienceFromForm(form: FormData): { audience: SmsAudience } | { error: string } {
  const kind = String(form.get("audience") ?? "");
  if (!kinds.has(kind as AudienceKind)) return { error: "Choose who receives this text." };
  const ids = form
    .getAll("ids")
    .map((value) => String(value).trim())
    .filter((value) => uuidPattern.test(value));
  if (kind === "person" || kind === "selected" || kind === "people") {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { error: "Choose at least one person." };
    if (unique.length === 1) return { audience: { kind: "person", ids: unique } };
    return { audience: { kind: "selected", ids: unique } };
  }
  if (kind === "phone") {
    const phone = normalizeUsPhone(String(form.get("phone") ?? ""));
    if (!phone) return { error: "Enter a valid US phone number." };
    return { audience: { kind: "phone", phone } };
  }
  return { audience: { kind: kind as "customers" | "drivers" | "online_drivers" } };
}

export function easternLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function scheduledInstant(form: FormData, now: Date): { at: Date; deferred: boolean } | { error: string } {
  const later = form.get("delivery") === "later" || (form.get("delivery") == null && form.get("sendNow") !== "yes" && form.get("date"));
  const promotional = smsPurposeFromForm(form) === "promotional";
  if (!later) {
    if (!promotional) return { at: now, deferred: false };
    const window = quietWindow(now);
    if (window.allowed) return { at: now, deferred: false };
    if (form.get("acceptQuiet") === "yes") return { at: window.sendAt, deferred: true };
    return { error: `Texts are closed. Send Now would wait until ${easternLabel(window.sendAt)}. Confirm that time, or choose Schedule for Later.` };
  }
  const date = String(form.get("date") ?? "");
  const time = String(form.get("time") ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return { error: "Choose an Eastern date and time." };
  const resolved = resolveNyWall(Number(match[1]), Number(match[2]), Number(match[3]), Number(clock[1]), Number(clock[2]));
  if ("error" in resolved) {
    return { error: resolved.error === "ambiguous" ? "That Eastern Time happens twice. Pick 8:00 AM or later." : "That Eastern Time does not exist." };
  }
  if (resolved.utc.getTime() < now.getTime() - 60_000) return { error: "Choose a future time." };
  if (promotional) {
    const window = quietWindow(resolved.utc);
    if (!window.allowed) return { error: "Choose a time between 8:00 AM and 9:00 PM Eastern." };
  }
  return { at: resolved.utc, deferred: false };
}

/** Marketing language stays on the promotional path so it cannot skip promotional consent. */
export function operationalContentAllowed(body: string): boolean {
  return !/discount|coupon|promo code|percent off|%\s*off|limited[- ]time offer|\bmarketing\b/i.test(body);
}

export function smsPurposeFromForm(form: FormData): SmsPurpose {
  return form.get("purpose") === "promotional" ? "promotional" : "operational";
}

export function messagePreview(body: string, recipients: number): { body: string; segments: number; cents: number } | { error: string } {
  const text = body.trim();
  if (text.length < 2) return { error: "Write the message first." };
  const finalBody = optionalSmsBody(text);
  if (finalBody.length > smsBodyLimit) return { error: "That message is too long." };
  const segments = smsSegments(finalBody);
  return { body: finalBody, segments, cents: smsEstimateCents(segments, recipients) };
}

export type DispatchCampaign = {
  id: string;
  purpose: SmsPurpose;
  audience: SmsAudience;
  body: string;
  laneTest: boolean;
};

export type DispatchRecipient = RecipientCheck & { phone: string; profileId: string | null };

export type DispatchIo = {
  claim(): Promise<DispatchCampaign | null>;
  defer(id: string, sendAt: Date): Promise<void>;
  recipients(campaign: DispatchCampaign): Promise<DispatchRecipient[]>;
  reserve(campaign: DispatchCampaign, phone: string, profileId: string | null): Promise<string | null>;
  mark(id: string, status: SmsDeliveryStatus, sid: string | null, failure: string | null): Promise<void>;
  finish(id: string, counts: { sent: number; failed: number; skipped: number }): Promise<void>;
  send(phone: string, body: string): Promise<{ ok: boolean; sid: string | null }>;
};

/** Claims each due campaign once. A second claim returns nothing, so the text is not sent twice. */
export async function runSmsDispatch(io: DispatchIo, now: Date): Promise<{ campaigns: number; sent: number }> {
  let campaigns = 0;
  let sent = 0;
  for (let index = 0; index < 5; index += 1) {
    const campaign = await io.claim();
    if (!campaign) break;
    campaigns += 1;
    if (campaign.purpose === "promotional") {
      const window = quietWindow(now);
      if (!window.allowed) {
        await io.defer(campaign.id, window.sendAt);
        continue;
      }
    }
    const rows = dedupePhones(await io.recipients(campaign));
    let failed = 0;
    let skipped = 0;
    let delivered = 0;
    for (const person of rows) {
      if (recipientDecision(person, campaign.audience.kind, campaign.purpose) !== "send") {
        skipped += 1;
        continue;
      }
      const reserved = await io.reserve(campaign, person.phone, person.profileId);
      if (!reserved) continue;
      try {
        const result = await io.send(person.phone, campaign.body);
        if (result.ok) {
          delivered += 1;
          sent += 1;
          await io.mark(reserved, "accepted", result.sid, null);
        } else {
          failed += 1;
          await io.mark(reserved, "failed", null, "provider declined");
        }
      } catch {
        failed += 1;
        await io.mark(reserved, "unknown", null, "provider did not answer");
      }
    }
    await io.finish(campaign.id, { sent: delivered, failed, skipped });
  }
  return { campaigns, sent };
}
