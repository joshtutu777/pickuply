export const checklistOrder = ["vehicle", "insurance", "training"] as const;

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
  vehicle: "Vehicle",
  insurance: "Insurance",
  training: "Training",
};

export function checklistItems(input: {
  vehicleType: string | null;
  insuranceUrl: string | null;
  trainingDone: boolean;
  notes: Partial<Record<ChecklistId, string | null>>;
}): ChecklistItem[] {
  const uploaded: Record<ChecklistId, boolean> = {
    vehicle: Boolean(input.vehicleType),
    insurance: Boolean(input.insuranceUrl),
    training: input.trainingDone,
  };
  const doneWord: Record<ChecklistId, "uploaded" | "done"> = {
    vehicle: "uploaded",
    insurance: "uploaded",
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
