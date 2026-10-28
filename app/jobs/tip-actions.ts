"use server";

import { connection } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOrigin } from "@/lib/payments/connect";
import { chargeSavedTip, loadBookingCard, tipIdempotencyKey } from "@/lib/payments/tip-charge";
import { tipAmountError } from "@/lib/payments/tips";
import { checkoutExcludedPaymentMethods } from "@/lib/payments/checkout-lines";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

function tipError(message: string | undefined): string {
  const text = message ?? "";
  const known = [
    "a tip must be from $1 to $200",
    "only the customer can tip",
    "a tip is available after the job is completed",
    "the tip window has closed",
    "this job already has a tip",
    "a tip is already in progress",
    "you cannot tip yourself",
  ];
  return known.find((item) => text.includes(item)) ?? "The tip could not be started.";
}

async function openTip(jobId: string, amountCents: number) {
  const supabase = await createClient();
  const started = await supabase.rpc("begin_tip", { target_job: jobId, amount_cents: amountCents });
  if (started.error || !started.data) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(tipError(started.error?.message))}`);
  }
  return started.data as { tip_id: string; amount_cents: number; status: string };
}

export async function submitTip(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const custom = Math.round(Number(formData.get("custom") || 0) * 100);
  const amount = choice === "custom" ? custom : choice === "none" || choice === "" ? null : Number(choice);
  if (amount == null) redirect(`/jobs/${jobId}`);
  const invalid = tipAmountError(amount);
  if (invalid) redirect(`/jobs/${jobId}?error=${encodeURIComponent(invalid)}`);
  const confirmed = String(formData.get("confirmed") ?? "");
  if (confirmed !== "yes") redirect(`/jobs/${jobId}?tip=${amount}`);

  const tip = await openTip(jobId, amount);
  const supabase = await createClient();
  const tipRow = await supabase.from("job_tips").select("driver_id").eq("id", tip.tip_id).maybeSingle();
  const user = await supabase.auth.getUser();
  const card = user.data.user ? await loadBookingCard(jobId, user.data.user.id) : null;
  if (card) {
    try {
      const result = await chargeSavedTip({
        tipId: tip.tip_id,
        amountCents: tip.amount_cents,
        customerId: card.customerId,
        paymentMethodId: card.paymentMethodId,
        jobId,
        driverId: tipRow.data?.driver_id ?? "",
      });
      if (result === "paid") redirect(`/jobs/${jobId}?tip=paid`);
    } catch (error) {
      if (error && typeof error === "object" && "digest" in error) throw error;
      const message = error instanceof Error &&
        (error.message.includes("Live payments are not enabled.") ||
          error.message === "The tip was charged and could not be recorded." ||
          error.message === "The tip could not be charged.")
        ? error.message
        : "The tip could not be charged.";
      redirect(`/jobs/${jobId}?error=${encodeURIComponent(message)}`);
    }
  }

  const origin = requestOrigin(await headers());
  const job = await supabase.from("jobs").select("assigned_driver_id").eq("id", jobId).maybeSingle();
  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "payment",
        excluded_payment_method_types: [...checkoutExcludedPaymentMethods],
        wallet_options: { link: { display: "never" } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: tip.amount_cents,
              product_data: { name: "Tip", description: "100% goes to your driver." },
            },
          },
        ],
        payment_intent_data: {
          metadata: { tip_id: tip.tip_id, job_id: jobId, driver_id: job.data?.assigned_driver_id ?? "" },
        },
        metadata: { tip_id: tip.tip_id, job_id: jobId },
        success_url: `${origin}/jobs/${jobId}?tip=return`,
        cancel_url: `${origin}/jobs/${jobId}?tip=cancel`,
      },
      { idempotencyKey: `tip-checkout:${tipIdempotencyKey(jobId, tip.tip_id)}` },
    );
    if (session.livemode) {
      await getStripe().checkout.sessions.expire(session.id);
      throw new Error("Live payments are not enabled.");
    }
    if (!session.url) throw new Error("missing url");
    redirect(session.url);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/jobs/${jobId}?error=${encodeURIComponent("The tip checkout could not be started.")}`);
  }
}

export async function removeSavedCard(formData: FormData) {
  await connection();
  const paymentMethod = String(formData.get("paymentMethod") ?? "");
  const supabase = await createClient();
  const removed = await supabase.rpc("detach_payment_method", { payment_method: paymentMethod });
  if (!removed.error && paymentMethod.startsWith("pm_")) {
    try {
      await getStripe().paymentMethods.detach(paymentMethod);
    } catch {
      // The card is already hidden in Pickuply. Stripe can be detached later.
    }
  }
  redirect("/account/payments");
}
