import { submitTip } from "@/app/jobs/tip-actions";
import { formatCents } from "@/lib/money";
import { tipOneTapQuestion } from "@/lib/payments/saved-card";
import { loadBookingCard } from "@/lib/payments/tip-charge";
import { tipChoices, tipReceiptLines, tipWindowOpen } from "@/lib/payments/tips";
import { createClient } from "@/lib/supabase/server";

export function TipPanel({
  jobId,
  driverFirstName,
  presetCents,
  savedBrand,
  savedLast4,
}: {
  jobId: string;
  driverFirstName: string;
  presetCents?: number | null;
  savedBrand?: string | null;
  savedLast4?: string | null;
}) {
  const name = driverFirstName || "your driver";
  const confirming = presetCents != null;
  const oneTap = confirming
    ? tipOneTapQuestion({
        amountCents: presetCents,
        driverFirstName: name,
        brand: savedBrand ?? null,
        last4: savedLast4 ?? null,
      })
    : null;
  return (
    <section className="mx-auto mt-6 w-full max-w-xl px-4">
      <h2 className="text-lg font-semibold text-ink">Add a tip for {name}?</h2>
      <p className="mt-1 text-base text-muted">100% goes to your driver.</p>
      <form action={submitTip} className="mt-3 grid gap-3">
        <input type="hidden" name="jobId" value={jobId} />
        {confirming ? <input type="hidden" name="confirmed" value="yes" /> : null}
        {confirming ? <input type="hidden" name="choice" value={String(presetCents)} /> : null}
        {confirming ? (
          <p className="font-semibold text-ink">
            {oneTap ?? `Charge ${formatCents(presetCents)} now. Checkout opens to enter a card.`}
          </p>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="font-semibold text-ink">Tip</legend>
            {tipChoices.map((cents) => (
              <label key={cents} className="flex min-h-12 items-center gap-3">
                <input type="radio" name="choice" value={cents} />
                {formatCents(cents)}
              </label>
            ))}
            <label className="flex min-h-12 items-center gap-3">
              <input type="radio" name="choice" value="custom" />
              Custom
              <input name="custom" inputMode="decimal" placeholder="1.00 to 200.00" className="min-h-12 rounded-2xl border border-line px-3" />
            </label>
            <label className="flex min-h-12 items-center gap-3">
              <input type="radio" name="choice" value="none" />
              No tip
            </label>
          </fieldset>
        )}
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          {confirming ? (oneTap ? "Add tip" : `Pay ${formatCents(presetCents)} tip`) : "Continue"}
        </button>
      </form>
    </section>
  );
}

export async function TipGate({
  jobId,
  status,
  completedAt,
  driverFirstName,
  bookingTotalCents,
  preset,
}: {
  jobId: string;
  status: string;
  completedAt: string | null;
  driverFirstName: string;
  bookingTotalCents: number | null;
  preset: string | undefined;
}) {
  // The request time decides whether the screen offers a tip. The database still rejects a late tip.
  // eslint-disable-next-line react-hooks/purity
  if (status !== "completed" || !tipWindowOpen(completedAt, Date.now())) return null;
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  const [{ data: tips }, card] = await Promise.all([
    supabase.from("job_tips").select("status, amount_cents, paid_at").eq("job_id", jobId),
    user.data.user ? loadBookingCard(jobId, user.data.user.id) : Promise.resolve(null),
  ]);
  const paid = (tips ?? []).find((tip) => tip.paid_at);
  if (paid) {
    return (
      <section className="mx-auto mt-6 w-full max-w-xl px-4">
        <h2 className="text-lg font-semibold text-ink">Tip receipt</h2>
        {tipReceiptLines(bookingTotalCents ?? 0, paid.amount_cents).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
    );
  }
  const amount = preset && /^\d+$/.test(preset) ? Number(preset) : null;
  return (
    <TipPanel
      jobId={jobId}
      driverFirstName={driverFirstName}
      presetCents={amount}
      savedBrand={card?.brand ?? null}
      savedLast4={card?.last4 ?? null}
    />
  );
}
