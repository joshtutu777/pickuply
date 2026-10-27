/** The message shown before a proof step can move forward. Video proof is already stored. */
export function missingProofWarning(input: {
  service: string;
  status: string;
  nextStatus: string;
  hasPickup: boolean;
  hasDropoff: boolean;
  needsReceipt: boolean;
  hasReceipt: boolean;
}): string | null {
  const junkFinish =
    input.service === "junk" &&
    input.nextStatus === "delivered" &&
    (input.status === "arrived" || input.status === "item_check");

  if ((input.nextStatus === "item_check" || junkFinish) && !input.hasPickup) {
    return junkFinish
      ? "Please upload a completion photo or video before marking this job as Junk removed."
      : "Please upload a pickup photo or video before marking the item as loaded.";
  }
  if (junkFinish && input.needsReceipt && !input.hasReceipt) {
    return "Please upload the disposal receipt before marking this job as Junk removed.";
  }
  if (input.nextStatus === "delivered" && !junkFinish && !input.hasDropoff) {
    return "Please upload a delivery photo or video before marking this job as Delivered.";
  }
  if (input.nextStatus === "delivered" && !junkFinish && input.needsReceipt && !input.hasReceipt) {
    return "Please upload the disposal receipt before marking this job as Delivered.";
  }
  return null;
}
