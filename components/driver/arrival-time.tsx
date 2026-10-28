const hours = Array.from({ length: 12 }, (_, index) => String(index + 1));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

export function ArrivalTimeFields({
  idPrefix,
  hour,
  minute,
  meridiem,
  summary,
  onHour,
  onMinute,
  onMeridiem,
}: {
  idPrefix: string;
  hour: string;
  minute: string;
  meridiem: string;
  summary: string;
  onHour: (value: string) => void;
  onMinute: (value: string) => void;
  onMeridiem: (value: string) => void;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-base font-semibold text-ink">Arrival time</legend>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-base font-semibold text-ink" htmlFor={`${idPrefix}-hour`}>
          Hour
          <select
            id={`${idPrefix}-hour`}
            value={hour}
            onChange={(event) => onHour(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-3"
          >
            <option value="">Hour</option>
            {hours.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-base font-semibold text-ink" htmlFor={`${idPrefix}-minute`}>
          Minute
          <select
            id={`${idPrefix}-minute`}
            value={minute}
            onChange={(event) => onMinute(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-3"
          >
            <option value="">Min</option>
            {minutes.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-base font-semibold text-ink" htmlFor={`${idPrefix}-meridiem`}>
          AM/PM
          <select
            id={`${idPrefix}-meridiem`}
            value={meridiem}
            onChange={(event) => onMeridiem(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-3"
          >
            <option value="">AM/PM</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
      </div>
      {summary ? <p className="text-base text-ink">{summary}</p> : null}
    </fieldset>
  );
}
