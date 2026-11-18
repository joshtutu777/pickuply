"use client";

import { useActionState, useState, useTransition } from "react";
import { composeSms, searchSmsPeople, type ComposeState, type SmsPerson } from "@/app/admin/sms/actions";
import { applyComposeChoice, easternLabel, formatEstimate, optionalSmsBody, smsEstimateCents } from "@/lib/sms/center";
import { quietWindow, resolveNyWall, smsSegments } from "@/lib/communications/sms";
import { normalizeUsPhone, formatUsPhone } from "@/lib/phone";

const field = "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4";

function roleLabel(role: string): string {
  if (role === "driver") return "Driver";
  if (role === "customer") return "Customer";
  return "Person";
}

function scheduleLabel(date: string, time: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return null;
  const resolved = resolveNyWall(Number(match[1]), Number(match[2]), Number(match[3]), Number(clock[1]), Number(clock[2]));
  if ("error" in resolved) return null;
  return easternLabel(resolved.utc);
}

export function SmsComposeForm({ initialPeople }: { initialPeople: SmsPerson[] }) {
  const [state, action, pending] = useActionState<ComposeState, FormData>(composeSms, null);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("people");
  const [purpose, setPurpose] = useState("operational");
  const [delivery, setDelivery] = useState<"now" | "later">("now");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SmsPerson[]>([]);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<SmsPerson[]>(initialPeople);
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [searching, startSearch] = useTransition();
  const segments = body.trim().length > 1 ? smsSegments(optionalSmsBody(body)) : 0;
  const normalized = normalizeUsPhone(phone);
  const quiet = quietWindow(new Date());
  const waiting = purpose === "promotional" && delivery === "now" && !quiet.allowed;
  const knownCount = audience === "phone" ? (normalized ? 1 : 0) : audience === "people" ? selected.length : null;
  const planned = scheduleLabel(date, time);

  function toggle(person: SmsPerson) {
    setSelected((current) =>
      current.some((item) => item.id === person.id) ? current.filter((item) => item.id !== person.id) : [...current, person],
    );
  }

  function runSearch() {
    if (query.trim().length < 2) {
      setResults([]);
      setSearchError("Enter at least two characters.");
      return;
    }
    startSearch(async () => {
      const found = await searchSmsPeople(query);
      setResults(found.people);
      setSearchError(found.error ?? (found.people.length === 0 ? "No matching people." : ""));
    });
  }

  return (
    <form
      action={(formData) => {
        applyComposeChoice(formData, { audience, delivery, purpose });
        return action(formData);
      }}
      onReset={(event) => event.preventDefault()}
      className="mt-6 grid gap-5 rounded-3xl bg-paper-raised p-4 ring-1 ring-line"
    >
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="delivery" value={delivery} />
      <input type="hidden" name="purpose" value={purpose} />
      <fieldset className="grid gap-2">
        <legend className="font-semibold text-ink">Purpose</legend>
        {[
          ["operational", "Operational"],
          ["promotional", "Promotional"],
        ].map(([value, label]) => (
          <label key={value} className="flex min-h-12 items-center gap-3">
            <input
              type="radio"
              name="purposeChoice"
              value={value}
              checked={purpose === value}
              onChange={() => setPurpose(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="font-semibold text-ink">Who receives it</legend>
        {[
          ["people", "Selected people"],
          ["phone", "Enter phone number"],
          ["drivers", "All eligible drivers"],
          ["customers", "All eligible customers"],
          ["online_drivers", "Currently online eligible drivers"],
        ].map(([value, label]) => (
          <label key={value} className="flex min-h-12 items-center gap-3">
            <input
              type="radio"
              name="audienceChoice"
              value={value}
              checked={audience === value}
              onChange={() => setAudience(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {audience === "people" ? (
        <div className="grid gap-3">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="recipient-query">Search by name or phone</label>
            <input
              id="recipient-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Name or phone"
              autoComplete="off"
              className="min-h-12 flex-1 rounded-2xl border border-line bg-paper px-4"
            />
            <button type="button" onClick={runSearch} disabled={searching} className="inline-flex min-h-12 items-center rounded-full bg-brand px-4 font-semibold text-white">
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError ? <p className="text-base text-muted">{searchError}</p> : null}
          {results.length > 0 ? (
            <ul className="grid gap-2">
              {results.map((person) => (
                <li key={person.id}>
                  <label className="flex min-h-12 items-start gap-3 rounded-2xl bg-paper px-3 py-2 ring-1 ring-line">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.some((item) => item.id === person.id)}
                      onChange={() => toggle(person)}
                    />
                    <span>
                      <span className="block font-semibold text-ink">{person.name}</span>
                      <span className="mt-1 block text-sm text-muted">{roleLabel(person.role)} · {person.phone} · {person.note}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="font-semibold text-ink">{selected.length} selected</p>
          {selected.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {selected.map((person) => (
                <li key={person.id}>
                  <button type="button" onClick={() => toggle(person)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-paper px-3 text-sm font-semibold text-ink ring-1 ring-line">
                    {person.name} · {roleLabel(person.role)}
                    <span className="text-muted">Remove</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {selected.map((person) => (
            <input key={person.id} type="hidden" name="ids" value={person.id} />
          ))}
          {selected.length > 1 ? (
            <label className="flex min-h-12 items-center gap-3 font-semibold text-ink">
              <input type="checkbox" name="confirm" value="yes" required /> I confirm this text goes to {selected.length} people.
            </label>
          ) : null}
        </div>
      ) : null}

      {audience === "phone" ? (
        <div className="grid gap-2">
          <label className="font-semibold text-ink" htmlFor="manual-phone">
            US phone number
            <input
              id="manual-phone"
              name="phone"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={field}
            />
          </label>
          <p className="text-base text-ink">{normalized ? `Sends to ${formatUsPhone(normalized)}` : "Enter a 10-digit US number."}</p>
        </div>
      ) : null}

      {audience === "drivers" || audience === "customers" || audience === "online_drivers" ? (
        <p className="text-base text-ink">
          {audience === "online_drivers"
            ? "Online is checked when the text is sent. You do not pick drivers one by one."
            : "Everyone eligible is included. You do not pick people one by one."}
        </p>
      ) : null}

      <label className="font-semibold text-ink" htmlFor="sms-body">
        Message
        <textarea
          id="sms-body"
          name="body"
          required
          maxLength={500}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className={`${field} min-h-28 py-3`}
        />
      </label>
      <p className="text-sm text-muted">{segments === 0 ? "Character count starts as you type." : `${optionalSmsBody(body).length} characters · ${segments} SMS segment${segments === 1 ? "" : "s"}`}</p>

      <fieldset className="grid gap-2">
        <legend className="font-semibold text-ink">When to send</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="deliveryChoice" value="now" checked={delivery === "now"} onChange={() => setDelivery("now")} /> Send Now
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="deliveryChoice" value="later" checked={delivery === "later"} onChange={() => setDelivery("later")} /> Schedule for Later
        </label>
      </fieldset>

      {delivery === "now" && waiting ? (
        <div className="rounded-2xl bg-paper p-4 ring-1 ring-line">
          <p className="text-base text-ink">Texts are closed. Send Now waits until {easternLabel(quiet.sendAt)}.</p>
          <label className="mt-3 flex min-h-12 items-center gap-3 font-semibold text-ink">
            <input type="checkbox" name="acceptQuiet" value="yes" required /> Send at that time
          </label>
        </div>
      ) : null}

      {delivery === "later" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="font-semibold text-ink">
            Date
            <input name="date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={field} />
          </label>
          <label className="font-semibold text-ink">
            Time, Eastern
            <input name="time" type="time" required value={time} onChange={(event) => setTime(event.target.value)} className={field} />
          </label>
          <p className="text-base text-ink sm:col-span-2">{planned ? `Scheduled for ${planned}.` : purpose === "promotional" ? "Choose a date and an Eastern time between 8:00 AM and 9:00 PM." : "Choose a date and an Eastern time."}</p>
        </div>
      ) : null}

      <div className="rounded-2xl bg-paper p-4 ring-1 ring-line">
        <p className="font-semibold text-ink">
          {knownCount == null ? "Eligible people are counted when you send." : `${knownCount} ${knownCount === 1 ? "recipient" : "recipients"}`}
        </p>
        <p className="mt-1 text-base text-ink">
          {knownCount != null && segments > 0 ? `About ${formatEstimate(smsEstimateCents(segments, knownCount))}` : "The estimate appears with the recipient count."}
        </p>
        {audience === "online_drivers" ? <p className="mt-2 text-sm text-muted">Online drivers are resolved at send time.</p> : null}
      </div>

      {state?.error ? <p role="alert" className="text-base text-danger">{state.error}</p> : null}
      {state && state.count != null ? (
        <div className="rounded-2xl bg-paper p-4 ring-1 ring-line">
          <p className="font-semibold text-ink">{state.count} {state.count === 1 ? "person would receive it" : "people would receive it"}</p>
          <p className="mt-1 text-base text-ink">{state.segments} segment{state.segments === 1 ? "" : "s"} each · about {formatEstimate(state.cents ?? 0)}</p>
          {state.names && state.names.length > 0 ? <p className="mt-2 text-sm text-muted">{state.names.join(", ")}{state.count > state.names.length ? "…" : ""}</p> : null}
          {state.needsConfirm && audience !== "people" ? (
            <label className="mt-3 flex min-h-12 items-center gap-3 font-semibold text-ink">
              <input type="checkbox" name="confirm" value="yes" /> I confirm this text goes to {state.count} people.
            </label>
          ) : null}
        </div>
      ) : null}

      <button type="submit" name="intent" value="send" disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
        {pending ? "Saving…" : delivery === "later" || waiting ? "Schedule Message" : "Send Message"}
      </button>
    </form>
  );
}
