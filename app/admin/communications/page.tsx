import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cancelAnnouncement, createAnnouncement, updateAnnouncement } from "@/app/admin/communications/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Communications · Pickuply Admin" } };

const field = "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4";

export default function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Communications searchParams={searchParams} />
    </Suspense>
  );
}

async function Communications({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("/admin/communications");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";
  const supabase = await createClient();
  const { data } = await supabase
    .from("admin_announcements")
    .select("id, title, body, status, scheduled_for, estimated_count, eligible_count, excluded_suspended, channels")
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = data ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Communications</h1>
      <p className="mt-3 text-base text-ink">
        Announcements are one-way. A private conversation stays in Messages and is not copied here.
      </p>
      <p className="mt-3">
        <Link href="/admin/messages" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Conversations
        </Link>
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {error}
        </p>
      ) : null}
      {query.saved ? <p className="mt-4 text-base font-semibold text-ink">Saved. Sending still waits for the scheduled time.</p> : null}
      <form action={createAnnouncement} className="mt-8 grid gap-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="font-display text-2xl font-semibold text-ink">New announcement</h2>
        <label className="font-semibold text-ink">
          Title
          <input name="title" required maxLength={120} className={field} />
        </label>
        <label className="font-semibold text-ink">
          Message
          <textarea name="body" required maxLength={400} className={`${field} min-h-28 py-3`} />
        </label>
        <label className="font-semibold text-ink">
          Opens this page
          <input name="href" defaultValue="/account/notifications" required className={field} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="font-semibold text-ink">Channels</legend>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="in_app" /> In-app alerts</label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="push" /> Push, only for devices that allowed alerts</label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="sms" /> Text. Texting is still off.</label>
        </fieldset>
        <label className="font-semibold text-ink">
          Audience
          <select name="audience" className={field} defaultValue="customers">
            <option value="individual">One person</option>
            <option value="selected">Selected people</option>
            <option value="customers">Customers</option>
            <option value="drivers">Eligible drivers</option>
            <option value="online_drivers">Online drivers</option>
            <option value="city_drivers">Drivers covering a city</option>
            <option value="active_customers">Customers with an active job</option>
            <option value="all">Customers and eligible drivers</option>
          </select>
        </label>
        <label className="font-semibold text-ink">
          City for Areas I Cover
          <input name="city" className={field} />
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" name="onlineOnly" /> Only drivers who are Online
        </label>
        <label className="font-semibold text-ink">
          Person ids, for one person or a selected group
          <textarea name="ids" className={`${field} min-h-20 py-3`} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="font-semibold text-ink">Purpose</legend>
          <label className="flex min-h-12 items-center gap-3"><input type="radio" name="purpose" value="promotional" defaultChecked /> Promotional. Suspended people are left out.</label>
          <label className="flex min-h-12 items-center gap-3"><input type="radio" name="purpose" value="account_support" /> Account support for the named people</label>
        </fieldset>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" name="sendNow" /> Send when the scheduler next runs
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="font-semibold text-ink">
            Eastern date
            <input name="date" type="date" className={field} />
          </label>
          <label className="font-semibold text-ink">
            Eastern time
            <input name="time" type="time" className={field} />
          </label>
        </div>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          Save announcement
        </button>
      </form>
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">Scheduled and sent</h2>
        {rows.length === 0 ? <p className="mt-3 text-base text-muted">No announcements yet.</p> : null}
        <ul className="mt-3 grid gap-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="font-semibold text-ink">{row.title}</p>
              <p className="mt-1 text-base text-muted">
                {row.status} · estimated {row.estimated_count}
                {row.eligible_count == null ? "" : ` · sent to ${row.eligible_count}`}
                {row.excluded_suspended ? ` · ${row.excluded_suspended} suspended left out` : ""}
              </p>
              {row.status === "scheduled" ? (
                <div className="mt-3 grid gap-3">
                  <form action={updateAnnouncement} className="grid gap-2">
                    <input type="hidden" name="id" value={row.id} />
                    <input name="title" defaultValue={row.title} className={field} />
                    <textarea name="body" required className={`${field} min-h-20 py-3`} />
                    <input name="date" type="date" required className={field} />
                    <input name="time" type="time" required className={field} />
                    <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">Save changes</button>
                  </form>
                  <form action={cancelAnnouncement}>
                    <input type="hidden" name="id" value={row.id} />
                    <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-danger">Cancel</button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
