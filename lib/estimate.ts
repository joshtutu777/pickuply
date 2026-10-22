import { estimateMissingMessage } from "./constants";
import { formatDollarRange } from "./money";
import { estimateRange, type EstimateInput, type EstimateRange } from "./pricing";
import type { RequestDraft } from "./types";

export function estimateInputFromDraft(draft: RequestDraft): EstimateInput {
  const pieces = /^\d+$/.test(draft.pieces.trim()) ? Number(draft.pieces) : null;
  return {
    service: draft.service || null,
    size: draft.size || null,
    pieces,
    stairsPickup: draft.stairsPickup === "" ? null : Number(draft.stairsPickup),
    stairsDropoff:
      draft.service === "junk" || draft.stairsDropoff === ""
        ? draft.service === "junk"
          ? 0
          : null
        : Number(draft.stairsDropoff),
    helpLoading: draft.helpLoading === "" ? null : draft.helpLoading === "yes",
    junkLoadSize: draft.junkLoadSize || null,
  };
}

export function estimateForDraft(draft: RequestDraft): EstimateRange | null {
  return estimateRange(estimateInputFromDraft(draft));
}

export function estimateMessage(range: EstimateRange | null): string {
  if (!range) return estimateMissingMessage;
  return `Typical price for jobs like this within 10 miles: ${formatDollarRange(range.minCents, range.maxCents)}. Final price confirmed after review.`;
}
