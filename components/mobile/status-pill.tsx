import { statusLabel } from "@/components/request/job-status";

const tone: Record<string, string> = {
  requested: "bg-paper text-ink ring-line",
  in_review: "bg-paper text-ink ring-line",
  quoted: "bg-brand-soft text-brand ring-brand/20",
  open: "bg-brand-soft text-brand ring-brand/20",
  assigned: "bg-brand text-white ring-brand",
  en_route: "bg-brand text-white ring-brand",
  arrived: "bg-brand text-white ring-brand",
  item_check: "bg-brand text-white ring-brand",
  in_transit: "bg-brand text-white ring-brand",
  delivered: "bg-brand-dark text-white ring-brand-dark",
  completed: "bg-brand-dark text-white ring-brand-dark",
  cancelled: "bg-paper text-muted ring-line",
  disputed: "bg-paper text-danger ring-danger/30",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold ring-1 ${tone[status] ?? "bg-paper text-ink ring-line"}`}
    >
      {statusLabel(status)}
    </span>
  );
}
