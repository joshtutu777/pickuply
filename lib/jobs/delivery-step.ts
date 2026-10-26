/** Maps a database refusal to the message the driver should see. */
export function advanceErrorCode(message: string): "photo" | "payment" | "step" {
  const text = message.toLowerCase();
  if (text.includes("photo") || text.includes("receipt")) return "photo";
  if (text.includes("payment must be authorized")) return "payment";
  return "step";
}
