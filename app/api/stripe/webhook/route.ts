import { NextResponse } from "next/server";
import { handlePlatformPaymentEvent, isPlatformPaymentEvent } from "@/lib/payments/platform-events";
import { paymentsMode, webhookSecretName } from "@/lib/payments/payments-mode";
import { scheduleBookingTexts } from "@/lib/notifications/schedule-flush";
import { claimStripeEvent, readStripeEvent, releaseStripeEvent } from "@/lib/payments/webhook";

export async function POST(request: Request) {
  const event = await readStripeEvent(
    request,
    webhookSecretName("payments", paymentsMode(process.env.PAYMENTS_MODE)),
  );
  if (event instanceof NextResponse) return event;
  if (!isPlatformPaymentEvent(event.type)) return NextResponse.json({ ok: true, ignored: true });

  const claimed = await claimStripeEvent(event);
  if (claimed instanceof NextResponse) return claimed;
  if (claimed.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await handlePlatformPaymentEvent(event);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "webhook failed");
    await releaseStripeEvent(event.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  scheduleBookingTexts();
  return NextResponse.json({ ok: true });
}
