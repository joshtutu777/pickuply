const order = [
  "assigned",
  "en_route",
  "arrived",
  "item_check",
  "in_transit",
  "at_dropoff",
  "delivered",
  "completed",
] as const;

export const deliveryStageLabels = [
  "Driver assigned",
  "Driver on the way",
  "Arrived at pickup",
  "Item loaded",
  "On the way to drop-off",
  "Arrived at drop-off",
  "Delivered",
  "Delivery complete",
] as const;

/** Index of the current stage. -1 means the trip has not been booked. */
export function deliveryStageIndex(status: string, dropoffArrived: boolean): number {
  if (status === "completed") return 7;
  if (status === "delivered") return 6;
  if (status === "in_transit" && dropoffArrived) return 5;
  if (status === "in_transit") return 4;
  if (status === "item_check") return 3;
  if (status === "arrived") return 2;
  if (status === "en_route") return 1;
  if (status === "assigned") return 0;
  return -1;
}

const junkStageLabels = [
  "Driver assigned",
  "Driver on the way",
  "Arrived at removal location",
  "Junk removed",
  "Removal complete",
] as const;

function junkStageIndex(status: string): number {
  if (status === "completed") return 4;
  if (status === "delivered") return 3;
  if (status === "arrived" || status === "item_check" || status === "in_transit") return 2;
  if (status === "en_route") return 1;
  if (status === "assigned") return 0;
  return -1;
}

export function deliveryStages(
  status: string,
  dropoffArrived: boolean,
  service = "delivery",
): { label: string; state: "done" | "current" | "upcoming" }[] {
  if (service === "junk") {
    const current = junkStageIndex(status);
    return junkStageLabels.map((label, index) => ({
      label,
      state: current < 0 ? "upcoming" : index < current ? "done" : index === current ? "current" : "upcoming",
    }));
  }
  const current = deliveryStageIndex(status, dropoffArrived);
  return deliveryStageLabels.map((label, index) => ({
    label,
    state: current < 0 ? "upcoming" : index < current ? "done" : index === current ? "current" : "upcoming",
  }));
}

export const deliveryStageOrder = order;
