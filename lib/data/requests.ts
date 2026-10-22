import { splitJob } from "./split-job";
import type { PrivateJob, PublicJob, RequestDraft } from "../types";

/**
 * TEMPORARY on-device data layer. Supabase will replace these function names later.
 *
 * Limitations:
 * - Nothing is sent to Pickuply, drivers, or a server.
 * - Public jobs and private records are separate localStorage keys, but both are readable
 *   by any script on this origin. This is not Row Level Security.
 * - An unfinished draft never stores phone, email, or exact street addresses.
 *   Reloading the form clears those fields and asks for them again.
 * - After submit, private fields stay in localStorage on this device so the customer
 *   can reopen the demo job page. They are still absent from the public job object.
 * - Clearing site data deletes both.
 */

const jobsKey = "pickuply.jobs";
const privateKey = "pickuply.job-private";

function readJobs(): PublicJob[] {
  const raw = localStorage.getItem(jobsKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as PublicJob[];
  return Array.isArray(parsed) ? parsed : [];
}

function readPrivate(): PrivateJob[] {
  const raw = localStorage.getItem(privateKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as PrivateJob[];
  return Array.isArray(parsed) ? parsed : [];
}

export function createRequest(draft: RequestDraft, photoIds: string[]): PublicJob {
  const id = crypto.randomUUID();
  const { job, privateJob } = splitJob(draft, id, photoIds);
  const jobs = readJobs().filter((item) => item.id !== id);
  const privateJobs = readPrivate().filter((item) => item.job_id !== id);
  localStorage.setItem(jobsKey, JSON.stringify([...jobs, job]));
  localStorage.setItem(privateKey, JSON.stringify([...privateJobs, privateJob]));
  return job;
}

export function getRequest(id: string): PublicJob | null {
  return readJobs().find((job) => job.id === id) ?? null;
}

export function getRequestPrivate(id: string): PrivateJob | null {
  return readPrivate().find((item) => item.job_id === id) ?? null;
}

export function listRequests(): PublicJob[] {
  return readJobs();
}
