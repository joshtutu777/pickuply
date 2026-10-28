export type ReceiptInput = {
  jobId: string;
  service: string;
  when: string;
  driverFirstName: string | null;
  driverSubtotalCents: number | null;
  serviceFeeCents: number | null;
  totalCents: number | null;
  tripFeeCents: number | null;
  capturedCents: number | null;
  refundedCents: number;
  paymentStatus: string | null;
};

function money(cents: number | null): string {
  if (cents == null) return "not set";
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildReceiptText(input: ReceiptInput): string {
  const lines = [
    `Pickuply receipt`,
    `Job ${input.jobId}`,
    `Date ${input.when}`,
    `Service ${input.service}`,
    `Driver ${input.driverFirstName ?? "Assigned driver"}`,
    `Offer ${money(input.driverSubtotalCents)}`,
    `Service fee ${money(input.serviceFeeCents)}`,
    `Total ${money(input.totalCents)} · includes ${money(input.serviceFeeCents)} service fee`,
  ];
  if (input.tripFeeCents != null && input.tripFeeCents > 0) {
    lines.push(`Trip fee ${money(input.tripFeeCents)}`);
  }
  lines.push(`Refunds ${money(input.refundedCents)}`);
  lines.push(`Payment ${input.paymentStatus ?? "not started"}`);
  return lines.join("\n");
}
