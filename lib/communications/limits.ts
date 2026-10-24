/** Admin announcement limits. Ordinary job alerts are not counted here. */
export const announcementLimits = {
  immediatePerHour: 20,
  bulkPerHour: 5,
  allUserPerDay: 2,
  maxRecipients: 1000,
  promotionalSmsPerDay: 1,
  promotionalSmsPerWeek: 3,
  platformSmsPerDay: 500,
  promotionalPushPerDay: 3,
  pendingScheduled: 20,
  horizonDays: 30,
} as const;

export type SendKind = "immediate" | "bulk" | "all_user";

export type PriorSend = {
  at: string;
  kind: SendKind;
  recipients: number;
  channel: "in_app" | "push" | "sms";
  promotional: boolean;
};

export function limitMessage(input: {
  now: string;
  kind: SendKind;
  recipients: number;
  scheduledFor: string;
  pendingScheduled: number;
  prior: PriorSend[];
  smsRecipients?: { recentDay: number; recentWeek: number }[];
  platformSmsDay?: number;
  pushRecent?: number[];
}): string | null {
  const now = Date.parse(input.now);
  const when = Date.parse(input.scheduledFor);
  if (!Number.isFinite(now) || !Number.isFinite(when)) return "Choose a valid time.";
  if (when < now) return "A scheduled announcement cannot go out before its time.";
  if (when > now + announcementLimits.horizonDays * 24 * 60 * 60 * 1000) {
    return "Schedule no more than 30 days ahead.";
  }
  if (input.recipients > announcementLimits.maxRecipients) {
    return "This audience is over 1,000 people. Narrow it before sending. Nobody was left off silently.";
  }
  if (input.pendingScheduled >= announcementLimits.pendingScheduled) {
    return "You already have 20 announcements waiting.";
  }
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = input.prior.filter((send) => Date.parse(send.at) > hourAgo && Date.parse(send.at) <= now);
  if (input.kind === "immediate" && recent.filter((send) => send.kind === "immediate").length >= announcementLimits.immediatePerHour) {
    return "That admin already sent 20 immediate announcements this hour.";
  }
  if (input.kind === "bulk" && recent.filter((send) => send.kind === "bulk" || send.kind === "all_user").length >= announcementLimits.bulkPerHour) {
    return "That admin already sent 5 bulk announcements this hour.";
  }
  const day = input.prior.filter((send) => Date.parse(send.at) > dayAgo && Date.parse(send.at) <= now);
  if (input.kind === "all_user" && day.filter((send) => send.kind === "all_user").length >= announcementLimits.allUserPerDay) {
    return "That admin already sent 2 all-user announcements today.";
  }
  if ((input.smsRecipients ?? []).some((row) => row.recentDay >= announcementLimits.promotionalSmsPerDay)) {
    return "A recipient already has the daily promotional text limit.";
  }
  if ((input.smsRecipients ?? []).some((row) => row.recentWeek >= announcementLimits.promotionalSmsPerWeek)) {
    return "A recipient already has the weekly promotional text limit.";
  }
  if ((input.platformSmsDay ?? 0) + input.recipients > announcementLimits.platformSmsPerDay && input.kind !== "immediate") {
    return "Pickuply already reached the daily text limit.";
  }
  if ((input.pushRecent ?? []).some((count) => count >= announcementLimits.promotionalPushPerDay)) {
    return "A recipient already has the daily promotional alert limit.";
  }
  return null;
}
