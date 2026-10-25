/** Public beta flag. Missing or any value other than "false" keeps the testing release in beta. */
export function betaMode(): boolean {
  return process.env.NEXT_PUBLIC_BETA_MODE !== "false";
}

export const betaMessage =
  "Pickuply is currently in beta. We're improving the experience with feedback from our early customers and drivers.";

/** Shown with feedback. Not a secret and not the Stripe mode. */
export function appVersion(): string {
  const value = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "beta";
  return value.slice(0, 40);
}
