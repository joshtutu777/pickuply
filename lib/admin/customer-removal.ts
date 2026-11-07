export const customerRemovalCodes = [
  "removed",
  "already_removed",
  "not_customer",
  "has_dispute",
  "has_active_job",
  "has_payment",
  "has_jobs",
] as const;

export type CustomerRemovalCode = (typeof customerRemovalCodes)[number];

export function customerRemovalMessage(code: string): string {
  switch (code) {
    case "removed":
      return "This customer account was deleted. The phone number can register again. Requests and payments were not changed.";
    case "already_removed":
      return "This customer account is already deleted.";
    case "not_customer":
      return "Only a customer account can be deleted here. Driver and admin accounts stay as they are.";
    case "has_dispute":
      return "This customer has an unresolved dispute. The account was not deleted, and the job records stay.";
    case "has_active_job":
      return "This customer has an active request. The account was not deleted. Suspension is still available.";
    case "has_payment":
      return "This customer has payment history. The account was not deleted, and those records stay.";
    case "has_jobs":
      return "This customer has request history. The account was not deleted, and those records stay.";
    default:
      return "The account could not be deleted.";
  }
}

export function isCustomerRemovalCode(value: string): value is CustomerRemovalCode {
  return (customerRemovalCodes as readonly string[]).includes(value);
}
