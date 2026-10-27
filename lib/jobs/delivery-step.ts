/** Maps a database refusal to the message the driver should see. */
export function advanceErrorCode(message: string): "photo" | "pickup" | "dropoff" | "receipt" | "payment" | "step" {
  const text = message.toLowerCase();
  if (text.includes("disposal receipt")) return "receipt";
  if (text.includes("delivery photo")) return "dropoff";
  if (text.includes("pickup photo")) return "pickup";
  if (text.includes("photo") || text.includes("receipt")) return "photo";
  if (text.includes("payment must be authorized")) return "payment";
  return "step";
}
