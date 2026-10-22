import type { ReactNode } from "react";

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-2 text-sm font-medium text-danger">
      {message}
    </p>
  );
}

export function TextField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  type = "text",
  inputMode,
  autoComplete,
  optional = false,
  min,
  max,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: "text" | "email" | "tel" | "url" | "date";
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
  autoComplete?: string;
  optional?: boolean;
  min?: string;
  max?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <label className="block" htmlFor={name}>
      <span className="text-base font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-sm leading-relaxed text-muted">{hint}</span> : null}
      <input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={controlClass}
      />
      <FieldError id={errorId} message={error} />
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  optional = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
}) {
  const errorId = `${name}-error`;
  return (
    <label className="block" htmlFor={name}>
      <span className="text-base font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-sm leading-relaxed text-muted">{hint}</span> : null}
      <textarea
        id={name}
        name={name}
        value={value}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${controlClass} py-3`}
      />
      <FieldError id={errorId} message={error} />
    </label>
  );
}

export function RadioCards({
  legend,
  name,
  value,
  options,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  value: string;
  options: readonly { id: string; label: string; hint?: string }[];
  onChange: (id: string) => void;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="text-base font-semibold text-ink">{legend}</legend>
      <div className="mt-2 grid gap-2">
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <label
              key={option.id}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 ${
                selected ? "border-brand bg-brand-soft" : "border-line bg-paper-raised"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="size-5 shrink-0 accent-brand"
              />
              <span>
                <span className="block text-base font-semibold text-ink">{option.label}</span>
                {option.hint ? (
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">{option.hint}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

export function YesNo({
  legend,
  name,
  value,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  value: "" | "yes" | "no";
  onChange: (value: "yes" | "no") => void;
  error?: string;
}) {
  return (
    <RadioCards
      legend={legend}
      name={name}
      value={value}
      onChange={(id) => onChange(id as "yes" | "no")}
      error={error}
      options={[
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ]}
    />
  );
}

export function CheckField({
  label,
  name,
  checked,
  onChange,
  error,
}: {
  label: ReactNode;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-line bg-paper-raised px-4 py-3">
        <input
          id={name}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 size-5 shrink-0 accent-brand"
        />
        <span className="text-base leading-relaxed text-ink">{label}</span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
