export function offerCountCopy(active: number, unseen: number, status: string): {
  waiting: boolean;
  received: string | null;
  unseen: string | null;
} {
  if (status === "open" && active <= 0) {
    return { waiting: true, received: null, unseen: null };
  }
  if (active <= 0) return { waiting: false, received: null, unseen: null };
  const fresh = Math.max(0, unseen);
  return {
    waiting: false,
    received: `${active} ${active === 1 ? "Offer" : "Offers"} Received`,
    unseen: `${fresh} ${fresh === 1 ? "New Offer" : "New Offers"}`,
  };
}
