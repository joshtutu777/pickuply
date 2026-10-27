import { FreshRequestLink } from "@/components/request/fresh-request-link";
import { services } from "@/lib/constants";

const marks = ["P", "F", "J", "C"];

export function ServiceTiles() {
  return (
    <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
      {services.map((service, index) => (
        <li key={service.id} className="w-28 shrink-0">
          <FreshRequestLink
            service={service.id}
            className="flex min-h-28 flex-col items-start justify-between rounded-3xl bg-paper-raised p-3 ring-1 ring-line"
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-brand-soft font-semibold text-brand">
              {marks[index]}
            </span>
            <span className="text-sm font-semibold leading-tight text-ink">{service.name}</span>
          </FreshRequestLink>
        </li>
      ))}
    </ul>
  );
}
