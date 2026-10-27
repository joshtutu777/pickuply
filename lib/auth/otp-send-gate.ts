export type OtpSendGate = {
  inFlight: boolean;
  coolingUntil: number;
};

export function claimOtpSend(gate: OtpSendGate, now: number): boolean {
  if (gate.inFlight || now < gate.coolingUntil) return false;
  gate.inFlight = true;
  return true;
}

export function finishOtpSend(
  gate: OtpSendGate,
  result: "sent" | "failed",
  now: number,
  cooldownMs: number,
): void {
  gate.inFlight = false;
  if (result === "sent") gate.coolingUntil = now + cooldownMs;
}
