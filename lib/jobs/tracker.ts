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
    { id: "payment", label: paymentDone ? "Payment confirmed" : "Awaiting payment", at: null },
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

export function nextDriverAction(input: {
  status: string;
  paymentStatus: string | null;
  service: string;
}): { label: string; nextStatus: string | null; waiting: string | null } {
  const paymentReady = paid.has(input.paymentStatus ?? "");
  if (input.status === "assigned" && !paymentReady) {
    return { label: "I'm on the way", nextStatus: null, waiting: "Waiting for payment" };
  }
  if (input.status === "assigned") {
    return { label: "I'm on the way", nextStatus: "en_route", waiting: null };
  }
  if (input.status === "en_route") {
    return { label: "I've arrived", nextStatus: "arrived", waiting: null };
  }
  if (input.status === "arrived") {
    return { label: "Start the item check", nextStatus: "item_check", waiting: null };
  }
  if (input.status === "item_check") {
    return { label: "Item picked up", nextStatus: null, waiting: "Waiting for the customer to approve the item" };
  }
  if (input.status === "in_transit") {
    return {
      label: input.service === "junk" ? "Mark hauled away" : "Mark delivered",
      nextStatus: "delivered",
      waiting: null,
    };
  }
  if (input.status === "delivered") {
    return { label: "Completed", nextStatus: null, waiting: "Waiting for the customer to confirm" };
  }
  return { label: "Update", nextStatus: null, waiting: null };
}
