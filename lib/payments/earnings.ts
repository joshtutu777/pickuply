/** Driver earnings are the quoted or offered pay, or the trip fee. Disposal is not added. */
export function driverEarningCents(input: {
  completed: boolean;
  driverPayCents: number | null;
  tripFeeCents: number | null;
  dumpFeeCents: number | null;
}): number | null {
  const amount = input.completed ? input.driverPayCents : input.tripFeeCents;
  if (amount == null || amount <= 0) return null;
  return amount;
}
