"use client";

import { useState } from "react";
import { previewSmsAudience, saveSmsCampaign, scheduleSmsCampaign, type SmsPreview } from "@/app/admin/communications/sms/actions";
import { campaignSegments, renderCampaignSms } from "@/lib/communications/campaign";

const field = "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4";

export function SmsCampaignForm() {
  const [body, setBody] = useState("Hi {{first_name}}, ");
  const [purpose, setPurpose] = useState("promotional");
  const [preview, setPreview] = useState<SmsPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [pending, setPending] = useState(false);
  const promotional = purpose !== "account_support";
  const sample = renderCampaignSms(body, "Alex", promotional);
  const segments = body.trim() ? campaignSegments(body, "Alex", promotional) : 0;

  async function onPreview(formData: FormData) {
    setPending(true);
    setPreviewError("");
    const result = await previewSmsAudience(formData);
    setPending(false);
    if (result.error) {
      setPreview(null);
      setPreviewError(result.error);
      return;
    }
    setPreview(result.preview ?? null);
  }

  return (
    <form className="mt-8 grid gap-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="font-display text-2xl font-semibold text-ink">New text campaign</h2>
      <p className="text-base text-ink">
        Texting is still off. Saving or sending records who would receive it and does not text anyone.
        Job alerts and sign-in codes stay on their own path.
      </p>
      <label className="font-semibold text-ink">
        Campaign name
        <input name="name" required maxLength={80} className={field} />
      </label>
      <label className="font-semibold text-ink">
        Message
        <textarea
          name="body"
          required
          maxLength={320}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className={`${field} min-h-28 py-3`}
        />
      </label>
      <p className="text-sm text-muted">Use {"{{first_name}}"} for the first name. A blank name becomes the word there.</p>
      <div className="rounded-2xl bg-paper p-4 ring-1 ring-line">
        <p className="font-semibold text-ink">Preview for Alex</p>
        <p className="mt-2 text-base text-ink">{sample}</p>
        <p className="mt-2 text-sm text-muted">
          {segments === 1 ? "1 text segment." : `${segments} text segments.`} A longer name can add a segment.
          Pickuply has no carrier price configured, so this page does not estimate a dollar cost.
        </p>
      </div>
      <label className="font-semibold text-ink">
        Who
        <select name="audience" className={field} defaultValue="customers">
          <option value="individual">One person</option>
          <option value="selected">Selected people</option>
          <option value="drivers">All eligible drivers</option>
          <option value="customers">All customers</option>
          <option value="both">Customers and eligible drivers</option>
        </select>
      </label>
      <label className="font-semibold text-ink">
        Person ids, for one person or a selected group
        <textarea name="ids" className={`${field} min-h-20 py-3`} />
      </label>
      <label className="font-semibold text-ink">
        ZIP codes
        <textarea name="zips" placeholder="30071, 30096" className={`${field} min-h-20 py-3`} />
      </label>
      <label className="font-semibold text-ink">
        Cities
        <textarea name="cities" placeholder="Norcross, Duluth" className={`${field} min-h-20 py-3`} />
      </label>
      <label className="font-semibold text-ink">
        States
        <input name="states" placeholder="GA" className={field} />
      </label>
      <p className="text-sm text-muted">
        A person must match every filter you fill in. Several ZIP codes, cities, or states match any one of them.
        Drivers use their home, saved place, and Areas I Cover. Customers use a saved place.
      </p>
      <fieldset className="grid gap-2">
        <legend className="font-semibold text-ink">Consent</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="purpose" value="promotional" checked={purpose === "promotional"} onChange={() => setPurpose("promotional")} />
          Marketing. Only people who opted in, and not people who texted STOP.
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="purpose" value="account_support" checked={purpose === "account_support"} onChange={() => setPurpose("account_support")} />
          Account support. Still requires the marketing checkbox. STOP still blocks it.
        </label>
      </fieldset>
      <button
        type="button"
        disabled={pending}
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          void onPreview(new FormData(form));
        }}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-6 font-semibold text-ink ring-1 ring-line"
      >
        {pending ? "Counting…" : "Count recipients"}
      </button>
      {previewError ? <p role="alert" className="text-base text-danger">{previewError}</p> : null}
      {preview ? (
        <div className="rounded-2xl bg-paper p-4 ring-1 ring-line" aria-live="polite">
          <p className="font-semibold text-ink">{preview.phones} phone {preview.phones === 1 ? "number" : "numbers"}</p>
          <p className="mt-1 text-base text-muted">
            {preview.duplicatesRemoved} duplicate {preview.duplicatesRemoved === 1 ? "number" : "numbers"} removed.
            {" "}{preview.ineligible} ineligible.
          </p>
          <ul className="mt-2 text-sm text-muted">
            <li>{preview.unverified} unverified</li>
            <li>{preview.optedOut} opted out</li>
            <li>{preview.noMarketingConsent} without marketing consent</li>
            <li>{preview.noPhone} without a phone</li>
            <li>{preview.suspended} suspended</li>
          </ul>
        </div>
      ) : null}
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
      <div className="flex flex-wrap gap-3">
        <button type="submit" formAction={saveSmsCampaign} className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-6 font-semibold text-ink ring-1 ring-line">
          Save draft
        </button>
        <button type="submit" formAction={scheduleSmsCampaign} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          Schedule
        </button>
      </div>
    </form>
  );
}
