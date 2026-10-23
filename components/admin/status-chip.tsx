import { jobStatusLabel, paymentStatusLabel } from "@/lib/admin/ops";

const tones: Record<string, string> = {
  requested: "bg-amber-100 text-amber-950",
  in_review: "bg-amber-100 text-amber-950",
  quoted: "bg-sky-100 text-sky-950",
  open: "bg-brand-soft text-brand-dark",
  assigned: "bg-indigo-100 text-indigo-950",
  en_route: "bg-indigo-100 text-indigo-950",
  arrived: "bg-indigo-100 text-indigo-950",
  item_check: "bg-indigo-100 text-indigo-950",
  in_transit: "bg-indigo-100 text-indigo-950",
  delivered: "bg-emerald-100 text-emerald-950",
  completed: "bg-emerald-100 text-emerald-950",
  cancelled: "bg-stone-200 text-stone-700",
  disputed: "bg-rose-100 text-rose-950",
  awaiting_payment: "bg-rose-100 text-rose-950",
  authorized: "bg-emerald-100 text-emerald-950",
  paid: "bg-emerald-100 text-emerald-950",
  captured: "bg-emerald-100 text-emerald-950",
  failed: "bg-rose-100 text-rose-950",
  refunded: "bg-stone-200 text-stone-700",
  pending_review: "bg-amber-100 text-amber-950",
  new_application: "bg-amber-100 text-amber-950",
  pending_documents: "bg-amber-100 text-amber-950",
  needs_changes: "bg-rose-100 text-rose-950",
  approved_new: "bg-emerald-100 text-emerald-950",
  active: "bg-emerald-100 text-emerald-950",
  paused: "bg-rose-100 text-rose-950",
  applied: "bg-stone-200 text-stone-700",
  removed: "bg-stone-200 text-stone-700",
  badge: "bg-amber-100 text-amber-950",
};

export function StatusChip({ value, kind = "job" }: { value: string | null; kind?: "job" | "payment" | "driver" }) {
  const label =
    kind === "payment" ? paymentStatusLabel(value) : kind === "driver" ? driverLabel(value) : jobStatusLabel(value ?? "");
  const tone = tones[value ?? ""] ?? "bg-paper text-ink ring-1 ring-line";
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export function BadgeChip({ label }: { label: string }) {
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold ${tones.badge}`}>
      {label}
    </span>
  );
}

function driverLabel(status: string | null): string {
  if (status === "new_application" || status === "pending_review") return "New application";
  if (status === "pending_documents") return "Pending documents";
  if (status === "needs_changes") return "Needs changes";
  if (status === "approved_new") return "Active";
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "applied") return "Applied";
  if (status === "removed") return "Removed";
  return "Driver";
}
