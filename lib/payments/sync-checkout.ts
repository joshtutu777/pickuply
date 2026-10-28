import "server-only";

import type Stripe from "stripe";
import { chooseAuthorization, type CheckoutIntentChoice } from "@/lib/payments/checkout-choice";
import { acceptOrRelease } from "@/lib/payments/platform-events";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const jobKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CheckoutSync = {
  state: "authorized" | "waiting" | "ignored";
  resumeUrl: string | null;
};

type OwnedJob = {
  customer_id: string;
  status: string;
  payment_status: string | null;
  price_cents: number | null;
  assigned_driver_id: string | null;
};

function sessionSavesCard(session: Stripe.Checkout.Session): boolean {
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string") return false;
  return intent.setup_future_usage === "off_session";
}

function intentId(value: string | Stripe.PaymentIntent | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function asIntent(value: string | Stripe.PaymentIntent | null, created: number): CheckoutIntentChoice | null {
  if (!value || typeof value === "string") return null;
  return {
    id: value.id,
    status: value.status,
    amount: value.amount,
    driverId: value.metadata?.driver_id ?? null,
    created: value.created || created,
    livemode: value.livemode,
  };
}

export async function syncCustomerCheckout(jobId: string): Promise<CheckoutSync> {
  if (!jobKey.test(jobId)) return { state: "ignored", resumeUrl: null };
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { state: "ignored", resumeUrl: null };
  const owned = await supabase
    .from("jobs")
    .select("customer_id, status, payment_status, price_cents, assigned_driver_id")
    .eq("id", jobId)
    .maybeSingle();
  const job = owned.data as OwnedJob | null;
  if (!job || job.customer_id !== user.data.user.id) return { state: "ignored", resumeUrl: null };
  if (job.payment_status === "authorized" || job.payment_status === "paid" || job.payment_status === "captured") {
    return { state: "authorized", resumeUrl: null };
  }
  if (job.status !== "assigned" || job.price_cents == null || !job.assigned_driver_id) {
    return { state: "ignored", resumeUrl: null };
  }
  if (job.payment_status !== "awaiting_payment" && job.payment_status !== "failed") {
    return { state: "ignored", resumeUrl: null };
  }

  const service = createServiceClient();
  const [attempts, payment] = await Promise.all([
    service
      .from("payment_attempts")
      .select("checkout_session_id")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(10),
    service.from("job_payments").select("checkout_session_id").eq("job_id", jobId).maybeSingle(),
  ]);
  if (attempts.error || payment.error) throw new Error("The card checkout could not be checked.");

  const sessionIds = [
    ...new Set(
      [payment.data?.checkout_session_id, ...(attempts.data ?? []).map((row) => row.checkout_session_id)].filter(
        (id): id is string => typeof id === "string" && id.startsWith("cs_"),
      ),
    ),
  ];
  const stripe = getStripe();
  const intents = new Map<string, CheckoutIntentChoice>();
  const openSessions: Stripe.Checkout.Session[] = [];
  let retrieveFailed = false;
  for (const sessionId of sessionIds) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
      if (session.metadata?.job_id !== jobId) continue;
      if (session.status === "open") openSessions.push(session);
      const expanded = asIntent(session.payment_intent, session.created);
      if (expanded) intents.set(expanded.id, expanded);
      const storedId = intentId(session.payment_intent);
      if (storedId && !expanded) {
        const loaded = await stripe.paymentIntents.retrieve(storedId);
        const choice = asIntent(loaded, loaded.created);
        if (choice) intents.set(choice.id, choice);
      }
    } catch {
      retrieveFailed = true;
    }
  }

  if (intents.size === 0) {
    try {
      const searched = await stripe.paymentIntents.search({
        query: `metadata['job_id']:'${jobId}'`,
        limit: 10,
      });
      for (const found of searched.data) {
        if (found.metadata?.job_id !== jobId) continue;
        const choice = asIntent(found, found.created);
        if (choice) intents.set(choice.id, choice);
      }
    } catch {
      retrieveFailed = true;
    }
  }

  const choice = chooseAuthorization({
    priceCents: job.price_cents,
    driverId: job.assigned_driver_id,
    intents: [...intents.values()],
  });
  if (!choice.acceptId && retrieveFailed) throw new Error("The card checkout could not be checked.");

  if (choice.acceptId) {
    const accept = intents.get(choice.acceptId);
    if (!accept) throw new Error("The card checkout could not be checked.");
    const loaded = await stripe.paymentIntents.retrieve(accept.id);
    await acceptOrRelease(loaded);
    for (const cancelId of choice.cancelIds) {
      const extra = await stripe.paymentIntents.retrieve(cancelId);
      await acceptOrRelease(extra);
    }
    for (const session of openSessions) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    }
    return { state: "authorized", resumeUrl: null };
  }

  const newestFailed = [...intents.values()].sort((left, right) => right.created - left.created)[0];
  if (
    openSessions.length === 0 &&
    newestFailed &&
    (newestFailed.status === "requires_payment_method" || newestFailed.status === "canceled")
  ) {
    await service.rpc("mark_checkout_failed", { target_job: jobId, payment_intent: newestFailed.id });
  }

  const reusable = openSessions
    .filter(
      (session) =>
        session.status === "open" &&
        typeof session.url === "string" &&
        session.amount_total === job.price_cents &&
        session.metadata?.driver_id === job.assigned_driver_id &&
        sessionSavesCard(session),
    )
    .sort((left, right) => right.created - left.created)[0];
  for (const session of openSessions) {
    if (session.id !== reusable?.id) await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
  }
  return { state: "waiting", resumeUrl: reusable?.url ?? null };
}
