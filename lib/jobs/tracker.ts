export type TrackEvent = {
  type: string;
  createdAt: string;
  toStatus: string | null;
};

export type TrackStep = {
  id: string;
  label: string;
  state: "done" | "current" | "upcoming";
  at: string | null;
};

export type JobTracker = {
  steps: TrackStep[];
  banner: string | null;
  lastUpdate: string | null;
};

export type CustomerProgress = {
  milestones: TrackStep[];
  stepNumber: number;
  stepName: string;
  next: string;
  action: string | null;
};

const milestoneOrder = ["request", "driver", "pickup", "delivered"] as const;

const milestoneLabels: Record<(typeof milestoneOrder)[number], string> = {
  request: "Request & Price",
  driver: "Driver Confirmed",
  pickup: "Pickup",
  delivered: "Delivered",
};

const workRank: Record<string, number> = {
  requested: 0,
  in_review: 0,
  quoted: 1,
  open: 2,
  assigned: 3,
  en_route: 4,
  arrived: 5,
  item_check: 6,
  in_transit: 7,
  delivered: 8,
  completed: 9,
};

const paid = new Set(["authorized", "paid", "captured"]);

function earliest(events: TrackEvent[], match: (event: TrackEvent) => boolean): string | null {
  const times = events.filter(match).map((event) => event.createdAt).sort();
  return times[0] ?? null;
}

function latest(events: TrackEvent[]): string | null {
  const times = events.map((event) => event.createdAt).sort();
  return times.at(-1) ?? null;
}

export function buildJobTracker(input: {
  service: string;
  status: string;
  pricingMethod: string;
  paymentStatus: string | null;
  createdAt: string;
  dumpFeeCents: number | null;
  hasDumpReceipt: boolean;
  events: TrackEvent[];
}): JobTracker {
  const junk = input.service === "junk";
  const quote = input.pricingMethod === "quote";
  const rank = workRank[input.status] ?? -1;
  const stopped = input.status === "cancelled" || input.status === "disputed";
  const priceAt = earliest(
    input.events,
    (event) =>
      event.type === "quote_accepted" ||
      event.type === "offer_chosen" ||
      (event.type === "status" && event.toStatus === "open"),
  );
  const driverAt = earliest(
    input.events,
    (event) =>
      event.type === "claimed" ||
      event.type === "offer_chosen" ||
      (event.type === "status" && event.toStatus === "assigned"),
  );
  const statusAt = (toStatus: string) =>
    earliest(input.events, (event) => event.type === "status" && event.toStatus === toStatus);
  const receiptRequired = junk && (input.dumpFeeCents ?? 0) > 0;

  const paymentDone = paid.has(input.paymentStatus ?? "");
  const currentId = stopped
    ? ""
    : rank <= 0
      ? "received"
      : rank === 1
        ? "price"
        : rank === 2
          ? quote
            ? "driver"
            : "price"
          : rank === 3 && !paymentDone
            ? "payment"
            : rank === 3
              ? "en_route"
              : rank === 4
                ? "en_route"
                : rank === 5
                  ? "arrived"
                  : rank === 6
                    ? "item_check"
                    : rank === 7
                      ? "picked_up"
                      : rank === 8 && receiptRequired && !input.hasDumpReceipt
                        ? "receipt"
                        : rank === 8
                          ? "completed"
                          : "";

  const planned: Array<Omit<TrackStep, "state">> = [
    {
      id: "received",
      label: "Request received",
      at: earliest(input.events, (event) => event.type === "status" && event.toStatus === "requested") ?? input.createdAt,
    },
    { id: "price", label: "Price confirmed", at: priceAt },
    { id: "driver", label: "Driver confirmed", at: driverAt },
    { id: "payment", label: paymentDone ? "Booking confirmed" : "Awaiting payment", at: null },
    { id: "en_route", label: "Driver heading to pickup", at: statusAt("en_route") },
    { id: "arrived", label: "Driver arrived", at: statusAt("arrived") },
    { id: "item_check", label: "Item checked", at: statusAt("item_check") },
    {
      id: "picked_up",
      label: junk ? "Load picked up" : "Item picked up",
      at: statusAt("in_transit"),
    },
    {
      id: "delivered",
      label: junk ? "Hauled away" : "Delivered",
      at: statusAt("delivered"),
    },
  ];
  if (receiptRequired) {
    planned.push({
      id: "receipt",
      label: "Disposal receipt uploaded",
      at: input.hasDumpReceipt ? statusAt("delivered") : null,
    });
  }
  planned.push({ id: "completed", label: "Completed", at: statusAt("completed") });

  const currentIndex = planned.findIndex((step) => step.id === currentId);
  const steps: TrackStep[] = planned.map((step, index) => {
    if (input.status === "completed") return { ...step, state: "done" };
    if (stopped) return { ...step, state: step.at ? "done" : "upcoming" };
    if (index === currentIndex) return { ...step, state: "current" };
    if (currentIndex >= 0 && index < currentIndex) return { ...step, state: "done" };
    return { ...step, state: "upcoming" };
  });

  const special = [...input.events].reverse().find((event) =>
    event.type === "rescheduled" || event.type === "reassigned",
  );
  const banner =
    input.status === "cancelled"
      ? "Cancelled"
      : input.status === "disputed"
        ? "Disputed"
        : special?.type === "rescheduled"
          ? "Rescheduled"
          : special?.type === "reassigned"
            ? "Reassigned"
            : null;

  return {
    steps,
    banner,
    lastUpdate: latest(input.events) ?? input.createdAt,
  };
}

/** Four milestones. Payment authorization stays inside Driver Confirmed until the trip starts. */
export function customerProgress(input: {
  status: string;
  paymentStatus: string | null;
  service: string;
  pricingMethod: string;
  events?: TrackEvent[];
}): CustomerProgress {
  const place = milestoneIndex(progressStatus(input.status, input.events ?? []));
  const milestones: TrackStep[] = milestoneOrder.map((id, index) => ({
    id,
    label: milestoneLabels[id],
    state: index < place ? "done" : index === place ? "current" : "upcoming",
    at: null,
  }));
  const stepNumber = place >= milestoneOrder.length ? milestoneOrder.length : place + 1;
  const stepName = milestoneLabels[milestoneOrder[Math.min(place, milestoneOrder.length - 1)]];
  return { milestones, stepNumber, stepName, next: nextForCustomer(input), action: customerAction(input) };
}

function progressStatus(status: string, events: TrackEvent[]): string {
  if (status !== "cancelled" && status !== "disputed") return status;
  let best = "requested";
  let bestRank = 0;
  for (const event of events) {
    if (event.type !== "status" || !event.toStatus) continue;
    const rank = workRank[event.toStatus];
    if (rank != null && rank >= bestRank) {
      best = event.toStatus;
      bestRank = rank;
    }
  }
  return best;
}

function milestoneIndex(status: string): number {
  if (status === "completed") return milestoneOrder.length;
  const rank = workRank[status] ?? 0;
  if (rank >= 8) return 3;
  if (rank >= 4) return 2;
  if (status === "assigned") return 1;
  return 0;
}

function customerAction(input: {
  status: string;
  paymentStatus: string | null;
  pricingMethod: string;
}): string | null {
  if (input.status === "quoted") return "Accept quote";
  if (input.status === "open" && input.pricingMethod !== "quote") return "Choose driver";
  if (input.status === "assigned" && !paid.has(input.paymentStatus ?? "")) return "Add card";
  if (input.status === "item_check") return "Approve item";
  if (input.status === "delivered") return "Got it";
  return null;
}

function nextForCustomer(input: {
  status: string;
  paymentStatus: string | null;
  service: string;
  pricingMethod: string;
}): string {
  if (input.status === "cancelled") return "This request was cancelled.";
  if (input.status === "disputed") return "This request is paused while the problem is reviewed.";
  if (input.status === "completed") return "This request is finished.";
  if (input.status === "delivered") return "Confirm delivery to finish this request.";
  if (input.status === "in_transit") {
    return input.service === "junk"
      ? "The load is on the way to disposal."
      : "The item is on the way to the drop-off.";
  }
  if (input.status === "item_check") return "Review the pickup photos before the driver leaves.";
  if (input.status === "arrived") return "The driver is at the pickup.";
  if (input.status === "en_route") return "The driver is heading to the pickup.";
  if (input.status === "assigned" && !paid.has(input.paymentStatus ?? "")) {
    return "Pay to confirm this driver. Work starts after the card is authorized.";
  }
  if (input.status === "assigned") return "The driver is confirmed and can head to the pickup.";
  if (input.status === "open" && input.pricingMethod === "quote") {
    return "Drivers can see this request. Nothing is booked until one is assigned.";
  }
  if (input.status === "open") return "Choose an offer. Nothing is booked until you do.";
  if (input.status === "quoted") return "Review the price. Drivers see this only after you accept.";
  if (input.status === "in_review") return "We're reviewing the request before a price is sent.";
  return "We'll confirm the price next. Drivers cannot see this yet.";
}

export function customerStatusDetail(input: {
  status: string;
  paymentStatus: string | null;
  service: string;
  pricingMethod: string;
}): string {
  return nextForCustomer(input);
}

export function nextDriverAction(input: {
  status: string;
  paymentStatus: string | null;
  service: string;
}): { label: string; nextStatus: string | null; waiting: string | null } {
  const paymentReady = paid.has(input.paymentStatus ?? "");
  if (input.status === "assigned" && !paymentReady) {
    return {
      label: "Waiting for customer to add card",
      nextStatus: null,
      waiting: "Waiting for customer to add card",
    };
  }
  if (input.status === "assigned") {
    return { label: "Start trip to pickup", nextStatus: "en_route", waiting: null };
  }
  if (input.status === "en_route") {
    return { label: "I've arrived at pickup", nextStatus: "arrived", waiting: null };
  }
  if (input.status === "arrived") {
    return { label: "Send for item check", nextStatus: "item_check", waiting: null };
  }
  if (input.status === "item_check") {
    return {
      label: "Waiting for customer to approve",
      nextStatus: null,
      waiting: "Waiting for customer to approve",
    };
  }
  if (input.status === "in_transit") {
    return {
      label: input.service === "junk" ? "Mark delivered" : "Mark delivered",
      nextStatus: "delivered",
      waiting: null,
    };
  }
  if (input.status === "delivered") {
    return {
      label: "Waiting for customer to confirm",
      nextStatus: null,
      waiting: "Waiting for customer to confirm. If they don't, this finishes 24 hours after delivery.",
    };
  }
  return { label: "Update", nextStatus: null, waiting: null };
}
