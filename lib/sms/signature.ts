import { createHmac, timingSafeEqual } from "node:crypto";

export function twilioSignature(url: string, params: URLSearchParams, token: string): string {
  const pairs = [...params.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  let payload = url;
  for (const [key, value] of pairs) payload += key + value;
  return createHmac("sha1", token).update(payload).digest("base64");
}

export function twilioSignatureValid(url: string, params: URLSearchParams, token: string, received: string): boolean {
  if (!received) return false;
  const expected = twilioSignature(url, params, token);
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
