"use client";

import { useEffect } from "react";
import { trackTipPurchase } from "@/components/analytics/analytics-root";
import { claimEvent, consentStorageKey, storedConsent, tipPurchaseEvent } from "@/lib/analytics/tracking";

const seenKey = "pickuply-analytics-seen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    const seen = new Set<string>();
    if (Array.isArray(ids)) {
      for (const id of ids) if (typeof id === "string") seen.add(id);
    }
    return seen;
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-200)));
}

/** A paid tip is one purchase. The booking card hold does not come through here. */
export function TipPurchase({
  tipId,
  amountCents,
  isTest,
}: {
  tipId: string;
  amountCents: number;
  isTest: boolean;
}) {
  useEffect(() => {
    if (storedConsent(localStorage.getItem(consentStorageKey)) !== "granted") return;
    const purchase = tipPurchaseEvent({ tipId, amountCents, paid: true, isTest });
    if (!purchase) return;
    const seen = readSeen();
    if (!claimEvent(seen, `purchase:${purchase.transaction_id}`)) return;
    writeSeen(seen);
    trackTipPurchase(purchase.transaction_id, purchase.value);
  }, [tipId, amountCents, isTest]);
  return null;
}
