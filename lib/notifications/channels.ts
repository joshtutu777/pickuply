export type ChannelDecision = "send" | "skip" | "wait";

/** Test accounts keep the in-app alert. They do not get SMS, email, or push. */
export function externalDeliveryAllowed(isTest: boolean): boolean {
  return isTest !== true;
}

export function channelPlan(input: {
  platformSms: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  hasSubscription: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasPushKey: boolean;
  hasEmailKey: boolean;
  hasSmsKey: boolean;
  hasConsent: boolean;
  pushSent: boolean;
  emailSent: boolean;
  smsSent: boolean;
}): { push: ChannelDecision; email: ChannelDecision; sms: ChannelDecision } {
  return {
    push: input.pushSent
      ? "skip"
      : input.pushEnabled && input.hasSubscription
        ? input.hasPushKey
          ? "send"
          : "wait"
        : "skip",
    email: input.emailSent
      ? "skip"
      : input.emailEnabled && input.hasEmail
        ? input.hasEmailKey
          ? "send"
          : "wait"
        : "skip",
    sms: input.smsSent
      ? "skip"
      : input.platformSms && input.smsEnabled && input.hasConsent && input.hasPhone
        ? input.hasSmsKey
          ? "send"
          : "wait"
        : "skip",
  };
}
