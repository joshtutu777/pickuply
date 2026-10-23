export const checklistOrder = [
  "services",
  "vehicle",
  "license",
  "equipment",
  "insurance",
  "agreement",
  "training",
] as const;

export type ChecklistId = (typeof checklistOrder)[number];
export type ChecklistMark = "todo" | "uploaded" | "done" | "needs_changes";

export type ChecklistItem = {
  id: ChecklistId;
  label: string;
  href: string;
  mark: ChecklistMark;
  note: string | null;
};

const labels: Record<ChecklistId, string> = {
  services: "Services",
  vehicle: "Vehicle",
  license: "License",
  equipment: "Equipment",
  insurance: "Insurance",
  agreement: "Agreement",
  training: "Training",
};

export function checklistItems(input: {
  services: number;
  coverageSaved: boolean;
  vehicleType: string | null;
  licenseUrl: string | null;
  kitSaved: boolean;
  insuranceUrl: string | null;
  agreementSigned: boolean;
  trainingDone: boolean;
  notes: Partial<Record<ChecklistId, string | null>>;
}): ChecklistItem[] {
  const uploaded: Record<ChecklistId, boolean> = {
    services: input.services > 0 && input.coverageSaved,
    vehicle: Boolean(input.vehicleType),
    license: Boolean(input.licenseUrl),
    equipment: input.kitSaved,
    insurance: Boolean(input.insuranceUrl),
    agreement: input.agreementSigned,
    training: input.trainingDone,
  };
  const doneWord: Record<ChecklistId, "uploaded" | "done"> = {
    services: "done",
    vehicle: "uploaded",
    license: "uploaded",
    equipment: "done",
    insurance: "uploaded",
    agreement: "done",
    training: "done",
  };
  return checklistOrder.map((id) => {
    const note = input.notes[id]?.trim() || null;
    const mark: ChecklistMark = note ? "needs_changes" : uploaded[id] ? doneWord[id] : "todo";
    return {
      id,
      label: labels[id],
      href: `/driver/ready/${id}`,
      mark,
      note,
    };
  });
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  const done = items.filter((item) => item.mark === "uploaded" || item.mark === "done").length;
  return { done, total: items.length };
}
