import { customerStatusDetail } from "@/lib/jobs/tracker";

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
  if (input.status === "requested" || input.status === "in_review") {
    return "Drivers can see this request and send a quote. You choose who to book. Nothing is charged until you confirm.";
  }
  if (input.status === "quoted") {
    return "A Pickuply price is ready, and drivers can still send their own quote. You choose who to book.";
  }
  return customerStatusDetail(input);
}
