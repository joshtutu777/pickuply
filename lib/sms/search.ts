/** Name and phone matching for the admin recipient search. The database uses the same rules. */
export function matchesRecipientQuery(query: string, person: { name: string; phone: string | null; role?: string }): boolean {
  const needle = query.trim().replace(/[%_\\]/g, "");
  if (needle.length < 2) return false;
  const digits = needle.replace(/\D/g, "");
  const phoneDigits = (person.phone ?? "").replace(/\D/g, "");
  if (digits.length >= 3 && phoneDigits.includes(digits)) return true;
  if (person.role && person.role.toLowerCase() === needle.toLowerCase()) return true;
  const parts = needle.toLowerCase().split(/\s+/).filter(Boolean);
  const name = person.name.toLowerCase();
  return parts.length > 0 && parts.every((part) => name.includes(part));
}
