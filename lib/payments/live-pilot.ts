const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the exact value true turns the pilot switch on. */
export function livePilotEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * One customer id or one job id.
 * Empty, wildcard, and lists of several ids are rejected.
 */
export function onePilotId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "*" || lower === "all" || lower === "any") return null;
  if (/[\s,*]/.test(trimmed)) return null;
  if (!uuidPattern.test(trimmed)) return null;
  return lower;
}

export type PilotCheckoutAction = "create" | "resume" | "block";

export type PilotBookingFacts = {
  pilotEnabled: string | undefined;
  allowCustomerId: string | undefined;
  allowJobId: string | undefined;
  authenticatedCustomerId: string | null;
  jobId: string;
  jobCustomerId: string | null;
  jobIsTest: boolean;
  customerIsTest: boolean;
  driverIsTest: boolean;
  driverStatus: string | null;
  drivingStopped: boolean;
  livePayoutsEnabled: boolean;
  liveTransfersActive: boolean;
  liveDetailsSubmitted: boolean;
  jobStatus: string | null;
  paymentStatus: string | null;
  paymentDueAt: string | null;
  priceCents: number | null;
  priceAddsUp: boolean;
  paymentOnHold: boolean;
  hasSuccessfulPayment: boolean;
  hasActiveCheckout: boolean;
  now: number;
};

const approvedDriver = new Set(["active", "approved_new"]);
const payableStatus = new Set(["awaiting_payment", "failed"]);
const successfulPayment = new Set(["authorized", "paid", "captured"]);

/** Whether this signed-in customer may start or resume the one approved live booking. */
export function pilotCheckoutAction(facts: PilotBookingFacts): PilotCheckoutAction {
  if (!livePilotEnabled(facts.pilotEnabled)) return "block";
  const allowedCustomer = onePilotId(facts.allowCustomerId);
  const allowedJob = onePilotId(facts.allowJobId);
  if (!allowedCustomer || !allowedJob) return "block";
  const customer = facts.authenticatedCustomerId?.toLowerCase() ?? "";
  const jobOwner = facts.jobCustomerId?.toLowerCase() ?? "";
  const jobId = facts.jobId.trim().toLowerCase();
  if (!customer || customer !== allowedCustomer || jobOwner !== customer) return "block";
  if (jobId !== allowedJob) return "block";
  if (facts.jobIsTest || facts.customerIsTest || facts.driverIsTest) return "block";
  if (!facts.driverStatus || !approvedDriver.has(facts.driverStatus) || facts.drivingStopped) return "block";
  if (!facts.livePayoutsEnabled || !facts.liveTransfersActive || !facts.liveDetailsSubmitted) return "block";
  if (facts.jobStatus !== "assigned" || !facts.paymentStatus || !payableStatus.has(facts.paymentStatus)) return "block";
  if (facts.priceCents == null || facts.priceCents <= 0 || !facts.priceAddsUp || facts.paymentOnHold) return "block";
  const dueAt = facts.paymentDueAt ? Date.parse(facts.paymentDueAt) : Number.NaN;
  if (!Number.isFinite(dueAt) || dueAt <= facts.now) return "block";
  if (facts.hasSuccessfulPayment || (facts.paymentStatus != null && successfulPayment.has(facts.paymentStatus))) {
    return "block";
  }
  if (facts.hasActiveCheckout) return "resume";
  return "create";
}

/** The pilot never opens a tip or a second booking. */
export function pilotAllowsTip(): boolean {
  return false;
}

/** Health can say the switch is on without showing the customer or the job. */
export function livePilotLabel(env: {
  LIVE_PILOT_ENABLED?: string;
  LIVE_PILOT_CUSTOMER_ID?: string;
  LIVE_PILOT_JOB_ID?: string;
}): "off" | "one booking" {
  if (!livePilotEnabled(env.LIVE_PILOT_ENABLED)) return "off";
  if (!onePilotId(env.LIVE_PILOT_CUSTOMER_ID) || !onePilotId(env.LIVE_PILOT_JOB_ID)) return "off";
  return "one booking";
}
