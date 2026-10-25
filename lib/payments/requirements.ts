const labels: Record<string, string> = {
  "individual.verification.document": "A photo ID",
  "individual.verification.additional_document": "Another identity document",
  "individual.id_number": "Identity details in Stripe",
  "individual.ssn_last_4": "Identity details in Stripe",
  external_account: "A bank account",
  "tos_acceptance.date": "Stripe's terms",
  "tos_acceptance.ip": "Stripe's terms",
  business_profile_url: "A website or profile",
  "business_profile.url": "A website or profile",
};

/** Plain labels for Stripe's currently_due keys. Unknown keys stay generic. */
export function requirementLabels(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    const label = labels[key] ?? "More details in Stripe";
    if (seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

export function payoutSetupLabel(account: {
  payouts_enabled: boolean;
  details_submitted: boolean;
} | null): string {
  if (!account) return "Set up payouts";
  if (account.payouts_enabled) return "Payouts are ready";
  if (account.details_submitted) return "Finish payout setup";
  return "Finish payout setup";
}
