import { quietWindow, promotionalSms } from "@/lib/communications/sms";
import { pushPayload, pushTargets } from "@/lib/communications/push";

export type DeliveryPlan = {
  inApp: "sent" | "skipped";
  push: "provider_accepted" | "skipped" | "failed";
  sms: "skipped" | "deferred" | "mocked";
  pushDevices: number;
  displayed: false;
  smsBody: string | null;
  smsAt: string | null;
};

/** Plans one recipient. Push is recorded as accepted by the provider, never as shown on a screen. */
export function planDelivery(input: {
  channels: { inApp: boolean; push: boolean; sms: boolean };
  title: string;
  body: string;
  href: string;
  id: string;
  permissionGranted: boolean;
  subscriptions: { expired: boolean }[];
  promotional: boolean;
  promotionalConsent: boolean;
  smsOptedOut: boolean;
  smsEnabled: boolean;
  now: Date;
}): DeliveryPlan {
  const payload = pushPayload({ title: input.title, body: input.body, href: input.href, id: input.id });
  const devices = pushTargets(input.subscriptions, input.permissionGranted);
  const push = !input.channels.push || !payload
    ? "skipped"
    : devices === 0
      ? "skipped"
      : "provider_accepted";
  let sms: DeliveryPlan["sms"] = "skipped";
  let smsBody: string | null = null;
  let smsAt: string | null = null;
  if (input.channels.sms && payload && input.smsEnabled && !input.smsOptedOut && (!input.promotional || input.promotionalConsent)) {
    const window = quietWindow(input.now);
    smsBody = input.promotional ? promotionalSms(payload.body) : `Pickuply: ${payload.body}`;
    if (window.allowed) sms = "mocked";
    else {
      sms = "deferred";
      smsAt = window.sendAt.toISOString();
    }
  }
  return {
    inApp: input.channels.inApp && payload ? "sent" : "skipped",
    push,
    sms,
    pushDevices: push === "provider_accepted" ? devices : 0,
    displayed: false,
    smsBody,
    smsAt,
  };
}
