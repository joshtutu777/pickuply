export type AudienceKind =
  | "individual"
  | "selected"
  | "customers"
  | "drivers"
  | "all"
  | "online_drivers"
  | "city_drivers"
  | "active_customers";

export type AudiencePurpose = "promotional" | "account_support";

export type AudiencePerson = {
  id: string;
  role: "customer" | "driver" | "admin";
  deleted: boolean;
  suspended: boolean;
  driverStatus: "active" | "approved_new" | "paused" | "removed" | "pending" | null;
  drivingStopped: boolean;
  online: boolean;
  cities: string[];
  activeBookings: number;
};

export type AudienceQuery = {
  kind: AudienceKind;
  ids?: string[];
  city?: string;
  onlineOnly?: boolean;
  purpose: AudiencePurpose;
};

const activeDriver = new Set(["active", "approved_new"]);

export function isEligibleDriver(person: AudiencePerson): boolean {
  return (
    !person.deleted &&
    person.driverStatus != null &&
    activeDriver.has(person.driverStatus) &&
    !person.drivingStopped
  );
}

export function coversCity(person: AudiencePerson, city: string): boolean {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return false;
  return person.cities.some((covered) => covered.trim().toLowerCase() === wanted);
}

export function resolveAudience(people: AudiencePerson[], query: AudienceQuery): {
  ids: string[];
  excludedSuspended: number;
} {
  const ids = new Set<string>();
  let excludedSuspended = 0;
  for (const person of people) {
    if (!matches(person, query)) continue;
    if (person.suspended && query.purpose !== "account_support") {
      excludedSuspended += 1;
      continue;
    }
    ids.add(person.id);
  }
  return { ids: [...ids], excludedSuspended };
}

function matches(person: AudiencePerson, query: AudienceQuery): boolean {
  if (person.deleted || person.role === "admin") return false;
  if (query.kind === "individual" || query.kind === "selected") {
    return (query.ids ?? []).includes(person.id);
  }
  if (query.kind === "customers") return person.role === "customer";
  if (query.kind === "active_customers") return person.activeBookings > 0;
  if (query.kind === "all") return person.role === "customer" || isEligibleDriver(person);
  if (!isEligibleDriver(person)) return false;
  if (query.kind === "drivers") return true;
  if (query.kind === "online_drivers") return person.online;
  if (query.kind === "city_drivers") {
    if (!coversCity(person, query.city ?? "")) return false;
    return query.onlineOnly ? person.online : true;
  }
  return false;
}
