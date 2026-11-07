import { displayFullName, validateNamePart } from "./name";

export type RegistrationFilter = "complete" | "incomplete" | "all";

/** Completed registrations are the default. Unknown values stay on that list. */
export function registrationFilter(value: string | undefined): RegistrationFilter {
  if (value === "incomplete" || value === "all") return value;
  return "complete";
}

/**
 * Registered means both name parts are saved.
 * A single saved name is unfinished. A phone with no name is phone verified only.
 */
export function registrationLabel(input: {
  completedAt?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): "Registered" | "Name not finished" | "Phone verified" {
  const given = validateNamePart(input.firstName ?? "");
  const family = validateNamePart(input.lastName ?? "");
  if (input.completedAt || (given && family)) return "Registered";
  if (displayFullName({ firstName: input.firstName, lastName: input.lastName, fullName: input.fullName })) {
    return "Name not finished";
  }
  return "Phone verified";
}
