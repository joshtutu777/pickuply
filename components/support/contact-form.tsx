"use client";

import { useFormStatus } from "react-dom";
import { supportTopics } from "@/lib/support/ticket";

export function ContactForm({
  action,
  defaults,
  jobs,
  error,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaults: { firstName: string; lastName: string; email: string };
  jobs: { id: string; label: string }[];
  error?: string | null;
}) {
  return (
    <form action={action} className="grid gap-4 rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
      <h2 className="font-display text-3xl font-semibold tracking-tight">Send us a message</h2>
      {error ? (
        <p role="alert" className="rounded-2xl bg-paper p-3 text-base text-danger">
          {error}
        </p>
      ) : null}
      <label className="grid gap-2 text-base font-semibold">
        First name
        <input name="firstName" required defaultValue={defaults.firstName} autoComplete="given-name" className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Last name <span className="font-normal text-muted">(optional)</span>
        <input name="lastName" defaultValue={defaults.lastName} autoComplete="family-name" className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Email
        <input name="email" type="email" required defaultValue={defaults.email} autoComplete="email" className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Topic
        <select name="topic" required defaultValue="" className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal">
          <option value="" disabled>
            Choose a topic
          </option>
          {supportTopics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Message
        <textarea name="message" required rows={5} className="rounded-2xl border border-line bg-paper px-4 py-3 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Job reference <span className="font-normal text-muted">(optional)</span>
        <input name="jobReference" className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      {jobs.length > 0 ? (
        <label className="grid gap-2 text-base font-semibold">
          Your job
          <select name="jobId" defaultValue="" className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal">
            <option value="">None</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        Company
        <input name="company" tabIndex={-1} autoComplete="off" />
      </label>
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const status = useFormStatus();
  return (
    <button disabled={status.pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60">
      {status.pending ? "Sending…" : "Send message"}
    </button>
  );
}
