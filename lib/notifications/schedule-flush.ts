import "server-only";

import { after } from "next/server";
import { flushTransactionalSms } from "@/lib/notifications/transactional-send";

/** Sends waiting booking texts after the response. A failure here does not change the booking or payment. */
export function scheduleBookingTexts(): void {
  try {
    after(() => flushTransactionalSms());
  } catch {
    // The five-minute text job sends anything still waiting.
  }
}
