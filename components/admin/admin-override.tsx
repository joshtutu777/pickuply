import { overrideJobStatus } from "@/app/admin/requests/actions";

const statuses = [
  ["open", "Open"],
  ["assigned", "Assigned"],
  ["en_route", "On the way"],
  ["arrived", "Arrived"],
  ["item_check", "Item loaded"],
  ["in_transit", "In transit"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
  ["disputed", "Disputed"],
] as const;

export function AdminOverride({ jobId }: { jobId: string }) {
  return (
    <form action={overrideJobStatus} className="mt-6 grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Override status</h2>
      <input type="hidden" name="jobId" value={jobId} />
      <label className="text-base font-semibold text-ink" htmlFor="next-status">
        New status
        <select
          id="next-status"
          name="nextStatus"
          className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
          defaultValue="cancelled"
        >
          {statuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-base font-semibold text-ink" htmlFor="override-reason">
        Reason
        <textarea
          id="override-reason"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper px-4 py-3"
        />
      </label>
      <button
        type="submit"
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
      >
        Save status
      </button>
    </form>
  );
}
