"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";

const categories = [
  ["damaged", "Damaged"],
  ["missing", "Missing or not delivered"],
  ["late", "Late"],
  ["no_show", "No-show"],
  ["extra_money", "Asked for extra money"],
  ["unsafe", "Unsafe"],
  ["other", "Other"],
] as const;

const outcomes = [
  ["refund", "Refund"],
  ["repair", "Repair"],
  ["apology", "Apology"],
  ["note", "Just letting you know"],
] as const;

export function ReportForm({ jobId, embedded = false }: { jobId: string; embedded?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const filed = await supabase.rpc("file_job_report", {
        target_job: jobId,
        category: String(data.get("category") ?? ""),
        description: String(data.get("description") ?? ""),
        outcome_wanted: String(data.get("outcome") ?? ""),
      });
      if (filed.error || !filed.data) throw new Error("The report could not be saved.");
      const file = data.get("photo");
      if (file instanceof File && file.size > 0) {
        const blob = await compressImage(file);
        const path = `${jobId}/report/${crypto.randomUUID()}.jpg`;
        const uploaded = await supabase.storage.from("job-photos").upload(path, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (uploaded.error) throw new Error("The report was saved, but the photo was not.");
        const row = await supabase.from("job_photos").insert({
          job_id: jobId,
          stage: "report",
          storage_path: path,
          uploaded_by: (await supabase.auth.getUser()).data.user?.id,
          report_id: filed.data,
        });
        if (row.error) throw new Error("The report was saved, but the photo was not.");
      }
      form.reset();
      setMessage("Report saved. Pickuply will review it. Money that already moved is not reversed automatically.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The report could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form id="report" onSubmit={(event) => void submit(event)} className={`${embedded ? "" : "mt-6"} grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line`}>
      <h2 className="text-lg font-semibold text-ink">Report a problem</h2>
      <p className="text-base text-ink">
        Damage must be reported within 48 hours of delivery, with photos. Pickup photos are the before picture. Damage that was already visible at pickup is not covered. Pickuply reviews the report. Nothing is refunded automatically. Customer-packed or disassembled items, loose parts, and normal wear are not covered.
      </p>
      <label className="text-base font-semibold" htmlFor="report-category">
        What happened
        <select id="report-category" name="category" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4">
          {categories.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-base font-semibold" htmlFor="report-description">
        Description
        <textarea id="report-description" name="description" required rows={4} maxLength={2000} className="mt-2 w-full rounded-2xl border border-line px-4 py-3 font-normal" />
      </label>
      <label className="text-base font-semibold" htmlFor="report-outcome">
        What should happen
        <select id="report-outcome" name="outcome" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4">
          {outcomes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-base font-semibold" htmlFor="report-photo">
        Photo
        <input id="report-photo" name="photo" type="file" accept="image/*" className="mt-2 block w-full" />
      </label>
      {message ? <p className="text-base text-ink">{message}</p> : null}
      <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60">
        {pending ? "Sending" : "Send report"}
      </button>
    </form>
  );
}
