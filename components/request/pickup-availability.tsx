"use client";

import { addCalendarDays, addClockMinutes, defaultPickupWindow, extraPickupWindow, georgiaDateISO, type PickupWindowDraft } from "@/lib/time/pickup-schedule";
import type { RequestDraft } from "@/lib/types";
import { FieldError } from "./fields";

const choices = [
  {
    id: "anytime",
    label: "Available anytime",
    hint: "I'm flexible. The driver can propose a pickup time.",
  },
  {
    id: "asap",
    label: "As soon as possible",
    hint: "I need the earliest available driver.",
  },
  {
    id: "windows",
    label: "Choose pickup times",
    hint: "I'll provide one or more available pickup windows.",
  },
] as const;

const presets = [
  { label: "2 hours", minutes: 120 },
  { label: "3 hours", minutes: 180 },
  { label: "4 hours", minutes: 240 },
] as const;

export function PickupAvailability({
  draft,
  error,
  onChange,
}: {
  draft: RequestDraft;
  error?: string;
  onChange: (availability: RequestDraft["pickupAvailability"], windows: PickupWindowDraft[]) => void;
}) {
  const today = georgiaDateISO();
  const latest = addCalendarDays(today, 6);
  const windows = draft.pickupWindows ?? [];

  function setWindow(index: number, patch: Partial<PickupWindowDraft>) {
    onChange(
      "windows",
      windows.map((window, item) => (item === index ? { ...window, ...patch } : window)),
    );
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="text-base font-semibold text-ink">When is your item available for pickup?</legend>
      {choices.map((choice) => {
        const selected = draft.pickupAvailability === choice.id;
        return (
          <label
            key={choice.id}
            className={`grid min-h-12 gap-1 rounded-2xl px-4 py-3 ring-1 ${selected ? "bg-brand-soft ring-brand" : "bg-paper ring-line"}`}
          >
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="pickupAvailability"
                value={choice.id}
                checked={selected}
                onChange={() =>
                  onChange(
                    choice.id,
                    choice.id === "windows" && windows.length === 0
                      ? [defaultPickupWindow()]
                      : choice.id === "windows"
                        ? windows
                        : [],
                  )
                }
                className="mt-1 size-5"
              />
              <span>
                <span className="block font-semibold text-ink">{choice.label}</span>
                <span className="block text-base text-muted">{choice.hint}</span>
              </span>
            </span>
          </label>
        );
      })}
      {draft.pickupAvailability === "anytime" ? (
        <p className="text-base text-ink">The driver proposes the pickup time. Available anytime does not mean the driver can arrive unannounced.</p>
      ) : null}
      {draft.pickupAvailability === "asap" ? (
        <p className="text-base text-ink">The driver proposes their earliest realistic arrival. This does not promise an immediate pickup.</p>
      ) : null}
      {draft.pickupAvailability === "windows" ? (
        <div className="grid gap-4">
          {windows.map((window, index) => (
            <div key={index} className="grid gap-3 rounded-2xl bg-paper p-3 ring-1 ring-line">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-ink">Window {index + 1}</p>
                {windows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onChange("windows", windows.filter((_, item) => item !== index))}
                    className="inline-flex min-h-12 items-center font-semibold text-brand"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <label className="text-base font-semibold text-ink">
                Pickup date
                <input
                  type="date"
                  name={`pickupDate${index}`}
                  min={today}
                  max={latest}
                  value={window.date}
                  onChange={(event) => setWindow(index, { date: event.target.value })}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-base font-semibold text-ink">
                  Start time
                  <input
                    type="time"
                    name={`pickupStart${index}`}
                    value={window.start}
                    onChange={(event) => setWindow(index, { start: event.target.value })}
                    className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4"
                  />
                </label>
                <label className="text-base font-semibold text-ink">
                  End time
                  <input
                    type="time"
                    name={`pickupEnd${index}`}
                    value={window.end}
                    onChange={(event) => setWindow(index, { end: event.target.value })}
                    className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.minutes}
                    type="button"
                    onClick={() => {
                      const end = addClockMinutes(window.start, preset.minutes);
                      if (!end) return;
                      setWindow(index, { end });
                    }}
                    className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {windows.length < 3 ? (
            <button
              type="button"
              onClick={() => onChange("windows", [...windows, extraPickupWindow(windows)])}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-4 font-semibold text-brand ring-1 ring-line"
            >
              Add another window
            </button>
          ) : (
            <p className="text-base text-muted">Three windows is the maximum.</p>
          )}
          <p className="text-base text-muted">Times use the pickup location's time zone, Eastern Time. Each window has to end at least 60 minutes from now.</p>
        </div>
      ) : null}
      <FieldError id="pickup-availability-error" message={error} />
    </fieldset>
  );
}
