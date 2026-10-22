export type ChannelDecision = "send" | "skip" | "wait";

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
      : input.platformSms && input.smsEnabled && input.hasPhone
        ? input.hasSmsKey
          ? "send"
          : "wait"
        : "skip",
  };
}
