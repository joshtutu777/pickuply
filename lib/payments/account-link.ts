export type AccountLinkKind = "account_onboarding" | "account_update";

export function accountLinkKind(detailsSubmitted: boolean): AccountLinkKind {
  return detailsSubmitted ? "account_update" : "account_onboarding";
}

/** Stripe names the only link type this account will accept. Use that type. */
export function fallbackAccountLinkKind(requested: AccountLinkKind, message: string): AccountLinkKind | null {
  const match = message.match(/Valid types for this account are \[(.*?)\]/);
  if (!match?.[1]) return null;
  const allowed = match[1]
    .split(",")
    .map((part) => part.trim().replaceAll('"', "").replaceAll("'", ""));
  const other = allowed.find((type): type is AccountLinkKind => type === "account_onboarding" || type === "account_update");
  if (!other || other === requested) return null;
  return other;
}
