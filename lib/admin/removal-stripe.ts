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

const sessionId = /^cs_[A-Za-z0-9_]+$/;
const intentId = /^pi_[A-Za-z0-9_]+$/;
const chargeId = /^ch_[A-Za-z0-9_]+$/;

/** A PaymentIntent id returned by a Checkout session. Underscores are part of real Stripe ids. */
export function isRemovalIntentId(value: string): boolean {
  return intentId.test(value);
}

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

export type RemovalLivemode = boolean | "unknown" | "mixed";

type PaymentModeRow = {
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  charge_id: string | null;
  stripe_livemode: boolean | null;
};

/** The saved payment row decides the mode. A missing or conflicting flag is not guessed from the id. */
export function removalLivemode(payments: PaymentModeRow[]): RemovalLivemode {
  const relevant = payments.filter(
    (payment) => payment.checkout_session_id || payment.payment_intent_id || payment.charge_id,
  );
  if (relevant.length === 0 || relevant.some((payment) => payment.stripe_livemode == null)) return "unknown";
  const modes = new Set(relevant.map((payment) => payment.stripe_livemode));
  if (modes.size !== 1) return "mixed";
  return relevant[0].stripe_livemode === true;
}

export type RemovalStripeKeyName = "STRIPE_LIVE_SECRET_KEY" | "STRIPE_TEST_SECRET_KEY" | "STRIPE_SECRET_KEY";

export type RemovalStripeSecret =
  | { ok: true; name: RemovalStripeKeyName; secret: string }
  | { ok: false; code: "mode_unknown" | "mode_mismatch" | "key_missing"; name: RemovalStripeKeyName | null };

function idMode(value: string): boolean | null {
  if (/^(?:cs|pi|ch)_live_/.test(value)) return true;
  if (/^(?:cs|pi|ch)_test_/.test(value)) return false;
  return null;
}

/**
 * Pick the secret for a stored payment's saved mode.
 * A live row uses only STRIPE_LIVE_SECRET_KEY. A failed or missing key is not replaced
 * with another account. An id prefix can disagree with the saved mode, but it cannot supply one.
 */
export function removalStripeSecret(
  livemode: RemovalLivemode,
  ids: RemovalStripeIds,
  env: Record<string, string | undefined>,
): RemovalStripeSecret {
  if (livemode !== true && livemode !== false) {
    return { ok: false, code: "mode_unknown", name: null };
  }
  const prefixed = [...ids.sessions, ...ids.intents, ...ids.charges].map(idMode).filter((mode): mode is boolean => mode != null);
  if (prefixed.some((mode) => mode !== livemode)) {
    return { ok: false, code: "mode_mismatch", name: livemode ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY" };
  }
  if (livemode) {
    const live = env.STRIPE_LIVE_SECRET_KEY ?? "";
    if (!live.startsWith("sk_live_")) return { ok: false, code: "key_missing", name: "STRIPE_LIVE_SECRET_KEY" };
    return { ok: true, name: "STRIPE_LIVE_SECRET_KEY", secret: live };
  }
  const dedicated = env.STRIPE_TEST_SECRET_KEY;
  if (dedicated) {
    if (!dedicated.startsWith("sk_test_")) return { ok: false, code: "key_missing", name: "STRIPE_TEST_SECRET_KEY" };
    return { ok: true, name: "STRIPE_TEST_SECRET_KEY", secret: dedicated };
  }
  const current = env.STRIPE_SECRET_KEY ?? "";
  if (!current.startsWith("sk_test_")) return { ok: false, code: "key_missing", name: "STRIPE_TEST_SECRET_KEY" };
  return { ok: true, name: "STRIPE_SECRET_KEY", secret: current };
}

export function logMarketplaceRemoval(entry: {
  stage: "removal_stripe_key" | "removal_stripe_retrieve" | "removal_rpc";
  code: string;
  stripeError: string | null;
  key: RemovalStripeKeyName | null;
}) {
  console.info(JSON.stringify({
    source: "marketplace_removal",
    stage: entry.stage,
    code: entry.code,
    stripeError: entry.stripeError,
    key: entry.key,
  }));
}

export function removalStripeErrorCategory(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const record = error as { code?: unknown; type?: unknown };
  if (typeof record.code === "string" && /^[a-z0-9_]+$/i.test(record.code)) return record.code;
  if (typeof record.type === "string" && /^[A-Za-z0-9_]+$/.test(record.type)) return record.type;
  return "unknown";
}
