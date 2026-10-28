export const tipChoices = [500, 1000, 2000] as const;
export const tipMinimumCents = 100;
export const tipMaximumCents = 20_000;
export const tipWindowDays = 7;

export function tipAmountError(cents: number | null): string | null {
  if (cents == null) return null;
  if (!Number.isInteger(cents) || cents < tipMinimumCents || cents > tipMaximumCents) {
    return "Enter a tip from $1 to $200.";
  }
  return null;
}

export function tipWindowOpen(completedAt: string | null, now: number): boolean {
  if (!completedAt) return false;
  const finished = new Date(completedAt).getTime();
  if (Number.isNaN(finished)) return false;
  return now <= finished + tipWindowDays * 24 * 60 * 60 * 1000;
}

/** A tip is not part of the booking. The driver keeps all of it. */
export function tipSplit(tipCents: number): {
  driverCents: number;
  commissionCents: number;
  serviceFeeCents: number;
  customerCents: number;
} {
  return {
    driverCents: tipCents,
    commissionCents: 0,
    serviceFeeCents: 0,
    customerCents: tipCents,
  };
}

export function tipNotice(amountCents: number, customerFirstName: string): string {
  const dollars = amountCents % 100 === 0
    ? `$${amountCents / 100}`
    : `$${(amountCents / 100).toFixed(2)}`;
  const name = customerFirstName.trim().split(/\s+/)[0] || "Your customer";
  return `You got a ${dollars} tip from ${name}!`;
}

export function tipReceiptLines(bookingTotalCents: number, tipCents: number): string[] {
  return [
    `Booking ${format(bookingTotalCents)}`,
    `Tip ${format(tipCents)}`,
    `Additional tip ${format(tipCents)}`,
    "100% of the tip goes to the driver.",
  ];
}

function format(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
