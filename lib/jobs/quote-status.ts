import { customerStatusDetail } from "@/lib/jobs/tracker";

const preparing = new Set(["requested", "in_review", "quoted"]);

/** Customer copy for a Get a quote request. Other pricing methods return null. */
export function quoteRequestCopy(input: {
  pricingMethod: string;
  status: string;
  paymentStatus: string | null;
  service: string;
}): string | null {
  if (input.pricingMethod !== "quote") return null;
  if (input.status === "cancelled" || input.status === "disputed") {
    return customerStatusDetail(input);
  }
  if (preparing.has(input.status)) {
    return "We're preparing your price. Drivers can't see this request until you accept it.";
  }
  return customerStatusDetail(input);
}
