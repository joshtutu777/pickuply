export type RemovalStripeIds = {
  sessions: string[];
  intents: string[];
  charges: string[];
};

export type RemovalStripeObject = {
  kind: "session" | "intent" | "charge";
  status: string | null;
  paymentStatus?: string | null;
  amountReceived?: number | null;
  amountCapturable?: number | null;
  paid?: boolean | null;
  refunded?: boolean | null;
  amountRefunded?: number | null;
  disputed?: boolean | null;
};

export type RemovalStripeVerdict = "inactive" | "active" | "unverified";

const sessionId = /^cs_[A-Za-z0-9]+$/;
const intentId = /^pi_[A-Za-z0-9]+$/;
const chargeId = /^ch_[A-Za-z0-9]+$/;

function addId(value: string | null, pattern: RegExp, bucket: Set<string>): boolean {
  if (!value) return true;
  if (!pattern.test(value)) return false;
  bucket.add(value);
  return true;
}

/** Collect stored Stripe ids. A malformed id is unverifiable, so the caller must stop. */
export function removalStripeIds(input: {
  jobIntent: string | null;
  payments: { checkout_session_id: string | null; payment_intent_id: string | null; charge_id: string | null }[];
  attempts: { checkout_session_id: string | null; payment_intent_id: string | null }[];
}): { ok: true; ids: RemovalStripeIds } | { ok: false } {
  const sessions = new Set<string>();
  const intents = new Set<string>();
  const charges = new Set<string>();
  if (!addId(input.jobIntent, intentId, intents)) return { ok: false };
  for (const payment of input.payments) {
    if (!addId(payment.checkout_session_id, sessionId, sessions)) return { ok: false };
    if (!addId(payment.payment_intent_id, intentId, intents)) return { ok: false };
    if (!addId(payment.charge_id, chargeId, charges)) return { ok: false };
  }
  for (const attempt of input.attempts) {
    if (!addId(attempt.checkout_session_id, sessionId, sessions)) return { ok: false };
    if (!addId(attempt.payment_intent_id, intentId, intents)) return { ok: false };
  }
  return {
    ok: true,
    ids: {
      sessions: [...sessions],
      intents: [...intents],
      charges: [...charges],
    },
  };
}

export function removalStripeIdCount(ids: RemovalStripeIds): number {
  return ids.sessions.length + ids.intents.length + ids.charges.length;
}

function oneRemovalObject(object: RemovalStripeObject): RemovalStripeVerdict {
  if (object.kind === "session") {
    if (object.status === "open" || object.status === "complete") return "active";
    if (object.status !== "expired") return "unverified";
    if (object.paymentStatus === "paid") return "active";
    if (object.paymentStatus === "unpaid" || object.paymentStatus === "no_payment_required") return "inactive";
    return "unverified";
  }

  if (object.kind === "intent") {
    if (!object.status) return "unverified";
    if (object.status === "canceled") {
      if (object.amountReceived == null || object.amountCapturable == null) return "unverified";
      if (object.amountReceived === 0 && object.amountCapturable === 0) return "inactive";
      return "active";
    }
    // requires_payment_method is not conclusive. Stripe reports an expired authorization as canceled.
    return "active";
  }

  if (!object.status || object.paid == null || object.disputed == null || object.refunded == null) return "unverified";
  if (object.disputed || object.refunded || object.paid || (object.amountRefunded ?? 0) > 0) return "active";
  if (object.status === "failed") return "inactive";
  return "active";
}

/** Every stored Stripe object must be conclusively inactive. A gap or an active object blocks removal. */
export function removalStripeVerdict(objects: RemovalStripeObject[]): RemovalStripeVerdict {
  let active = false;
  for (const object of objects) {
    const verdict = oneRemovalObject(object);
    if (verdict === "unverified") return "unverified";
    if (verdict === "active") active = true;
  }
  return active ? "active" : "inactive";
}

/** Stripe must have been read before a request with stored ids can be cancelled. */
export function canFinishRemoval(ids: RemovalStripeIds, verdict: RemovalStripeVerdict | null): boolean {
  if (removalStripeIdCount(ids) === 0) return verdict == null;
  return verdict === "inactive";
}
