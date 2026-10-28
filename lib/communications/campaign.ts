import { promotionalSms, smsSegments, withPickuplyPrefix } from "@/lib/communications/sms";

export type SmsAudienceKind = "individual" | "selected" | "drivers" | "customers" | "both";

export type SmsAudience = {
  kind: SmsAudienceKind;
  ids?: string[];
  zips?: string[];
  cities?: string[];
  states?: string[];
};

const kinds = new Set<SmsAudienceKind>(["individual", "selected", "drivers", "customers", "both"]);

export function campaignFirstName(value: string): string {
  const word = value.trim().split(/\s+/)[0] ?? "";
  return word || "there";
}

/** The text that would be sent, including the Pickuply prefix and the STOP line. */
export function renderCampaignSms(body: string, personName: string, promotional: boolean): string {
  const named = body.replaceAll("{{first_name}}", campaignFirstName(personName));
  return promotional ? promotionalSms(named) : withPickuplyPrefix(named);
}

export function campaignSegments(body: string, personName: string, promotional: boolean): number {
  return smsSegments(renderCampaignSms(body, personName, promotional));
}

/** What an admin should read. A finished recording is not a delivered text. */
export function deliveryStatusLabel(status: string): string {
  if (status === "mocked") return "Simulated";
  if (status === "deferred") return "Waiting";
  if (status === "sent") return "Sent";
  if (status === "failed") return "Failed";
  return "Not sent";
}

/** Ten-digit US key. A leading 1 is removed. Anything else is not a sendable number. */
export function smsPhoneKey(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 ? national : null;
}

export function distinctPhoneKeys(values: string[]): { keys: string[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const keys: string[] = [];
  let duplicatesRemoved = 0;
  for (const value of values) {
    const key = smsPhoneKey(value);
    if (!key) continue;
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return { keys, duplicatesRemoved };
}

function list(value: string, split: RegExp): string[] {
  return value
    .split(split)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseSmsAudience(input: {
  kind: string;
  ids: string;
  zips: string;
  cities: string;
  states: string;
}): SmsAudience {
  if (!kinds.has(input.kind as SmsAudienceKind)) throw new Error("Choose who should receive this text.");
  const kind = input.kind as SmsAudienceKind;
  const ids = list(input.ids, /[\s,]+/);
  const zips = list(input.zips, /[\s,]+/);
  const cities = list(input.cities, /[,\n]+/);
  const states = list(input.states, /[\s,]+/).map((state) => state.toUpperCase());
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("A person id is not valid.");
  if (kind === "individual" && ids.length !== 1) throw new Error("One person needs exactly one id.");
  if (kind === "selected" && ids.length === 0) throw new Error("Choose at least one person.");
  if (ids.length > 50) throw new Error("Choose 50 people or fewer, or use a group.");
  if (zips.some((zip) => !/^[0-9]{5}$/.test(zip))) throw new Error("Use 5-digit ZIP codes.");
  if (zips.length > 30) throw new Error("Use 30 ZIP codes or fewer.");
  if (cities.some((city) => city.length < 2 || city.length > 40)) throw new Error("Check the city names.");
  if (cities.length > 20) throw new Error("Use 20 cities or fewer.");
  if (states.some((state) => !/^[A-Z]{2}$/.test(state))) throw new Error("Use a two-letter state, such as GA.");
  if (states.length > 10) throw new Error("Use 10 states or fewer.");
  const audience: SmsAudience = { kind };
  if (ids.length > 0) audience.ids = ids;
  if (zips.length > 0) audience.zips = zips;
  if (cities.length > 0) audience.cities = cities;
  if (states.length > 0) audience.states = states;
  return audience;
}
