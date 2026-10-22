import { NextResponse } from "next/server";
import { receiveStripeEvent } from "@/lib/payments/webhook";

export async function POST(request: Request) {
  const received = await receiveStripeEvent(request, "STRIPE_WEBHOOK_SECRET");
  if (received instanceof NextResponse) return received;
  return NextResponse.json({ ok: true });
}
