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

/** The proof a status button must store before the job can move. */
export function proofStageForStep(input: {
  service: string;
  status: string;
  nextStatus: string;
  hasPickup: boolean;
  hasDropoff: boolean;
  needsReceipt: boolean;
  hasReceipt: boolean;
}): "pickup" | "dropoff" | "dump_receipt" | null {
  const warning = missingProofWarning(input);
  if (!warning) return null;
  if (warning.includes("disposal receipt")) return "dump_receipt";
  if (warning.includes("delivery photo")) return "dropoff";
  return "pickup";
}

/** What is still missing after the status button stores one proof. */
export function proofAfterSave(
  input: {
    service: string;
    status: string;
    nextStatus: string;
    hasPickup: boolean;
    hasDropoff: boolean;
    needsReceipt: boolean;
    hasReceipt: boolean;
  },
  stage: "pickup" | "dropoff" | "dump_receipt",
): string | null {
  return missingProofWarning({
    ...input,
    hasPickup: input.hasPickup || stage === "pickup",
    hasDropoff: input.hasDropoff || stage === "dropoff",
    hasReceipt: input.hasReceipt || stage === "dump_receipt",
  });
}

/** One tap either warns, saves, or advances. A tap already in flight is ignored. */
export function proofTapAction(input: {
  busy: boolean;
  needsProof: boolean;
  hasFile: boolean;
}): "ignore" | "warn" | "save" | "advance" {
  if (input.busy) return "ignore";
  if (!input.needsProof) return "advance";
  if (!input.hasFile) return "warn";
  return "save";
}
