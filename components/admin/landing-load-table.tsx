import { landingLoadSourceLabel } from "@/lib/admin/landing-loads";
import type { LandingLoadRow } from "@/lib/admin/landing-loads";

function campaignText(label: string): string {
  if (label === "none") return "No campaign label";
  if (label === "other") return "Other labels";
  return label;
}

export function LandingLoadTable({
  rows,
  status,
}: {
  rows: LandingLoadRow[];
  status: "ready" | "missing" | "unavailable";
}) {
  return (
    <section className="mt-8 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Landing page loads</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        These are page loads, including visitors who did not allow optional cookies. They are not unique people
        and they are not the consented visit sessions below. A refresh counts again. No click id is stored.
      </p>
      {status === "missing" ? (
        <p className="mt-4 text-base text-ink" role="status">Landing-page load counts are not installed in the database yet.</p>
      ) : null}
      {status === "unavailable" ? (
        <p className="mt-4 text-base text-danger" role="alert">Landing-page loads could not be loaded.</p>
      ) : null}
      {status === "ready" ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-2 font-semibold">Date</th>
                <th className="py-2 font-semibold">Path</th>
                <th className="py-2 font-semibold">Source</th>
                <th className="py-2 font-semibold">Campaign label</th>
                <th className="py-2 font-semibold">Loads</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="py-4 text-muted" colSpan={5}>No landing-page loads in this range.</td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={`${row.countedOn}-${row.path}-${row.source}-${row.campaign}`} className="border-t border-line">
                  <th className="py-3 font-semibold" scope="row">{row.countedOn}</th>
                  <td>{row.path}</td>
                  <td>{landingLoadSourceLabel(row.source)}</td>
                  <td>{campaignText(row.campaign)}</td>
                  <td>{row.loads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
