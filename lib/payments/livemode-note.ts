export type LivemodeNote = "record" | "retry" | "reject";

/**
 * A payment mode is written once.
 * The same value is an idempotent retry. The opposite value is refused.
 * A missing mode can be recorded.
 */
export function livemodeNoteDecision(saved: boolean | null, next: boolean): LivemodeNote {
  if (typeof next !== "boolean") return "reject";
  if (saved == null) return "record";
  if (saved === next) return "retry";
  return "reject";
}
