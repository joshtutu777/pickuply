export type CheckoutIntentChoice = {
  id: string;
  status: string;
  amount: number;
  driverId: string | null;
  created: number;
  livemode: boolean;
};

/** Pick one real card hold. A browser return is not an input and cannot choose a payment. */
export function chooseAuthorization(input: {
  priceCents: number;
  driverId: string;
  intents: CheckoutIntentChoice[];
}): { acceptId: string | null; cancelIds: string[] } {
  const matches = input.intents
    .filter(
      (intent) =>
        intent.status === "requires_capture" &&
        intent.livemode === false &&
        intent.amount === input.priceCents &&
        intent.driverId === input.driverId &&
        /^pi_[A-Za-z0-9]+$/.test(intent.id),
    )
    .sort((left, right) => left.created - right.created || left.id.localeCompare(right.id));
  return {
    acceptId: matches[0]?.id ?? null,
    cancelIds: matches.slice(1).map((intent) => intent.id),
  };
}
