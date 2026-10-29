import { damagePolicyCopy } from "@/lib/legal/damage-policy";
import { formatCents } from "@/lib/money";

export function serviceFeeLabel(bps: number | null | undefined): string {
  if (bps == null || bps < 0) return "Service fee";
  const whole = bps % 100 === 0;
  const percent = whole ? String(bps / 100) : (bps / 100).toFixed(2);
  return `Service fee (${percent}%)`;
}

export function ServiceFeeNote({
  offerCents,
  feeCents,
  totalCents,
  bps,
}: {
  offerCents: number;
  feeCents: number;
  totalCents: number;
  bps?: number | null;
}) {
  return (
    <div className="grid gap-1">
      <p>Pickup service {formatCents(offerCents)}</p>
      <p>
        {serviceFeeLabel(bps)} {formatCents(feeCents)}
      </p>
      <p className="font-semibold">
        Total {formatCents(totalCents)} · includes {formatCents(feeCents)} service fee
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-muted">About the service fee</summary>
        <p className="text-sm text-muted">
          Supports secure payments and customer support. {damagePolicyCopy}
        </p>
      </details>
    </div>
  );
}
