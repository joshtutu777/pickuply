export const lateCancelCents = 0;
export const tripFeeCents = 0;

export function lateCancelSplit(
  enRouteOrLater: boolean,
  totalCents = lateCancelCents,
): { totalCents: number; driverCents: number; platformCents: number } {
  const total = Math.max(0, totalCents);
  const driverCents = total > 0 && enRouteOrLater ? Math.min(1000, total) : 0;
  return { totalCents: total, driverCents, platformCents: total - driverCents };
}

export function tripFeeSplit(totalCents = tripFeeCents): { totalCents: number; driverCents: number; platformCents: number } {
  const total = Math.max(0, totalCents);
  const driverCents = total > 0 ? Math.min(2000, total) : 0;
  return { totalCents: total, driverCents, platformCents: total - driverCents };
}
