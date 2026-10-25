export const lateCancelCents = 1500;
export const tripFeeCents = 2500;

export function lateCancelSplit(enRouteOrLater: boolean): { totalCents: number; driverCents: number; platformCents: number } {
  const driverCents = enRouteOrLater ? 1000 : 0;
  return { totalCents: lateCancelCents, driverCents, platformCents: lateCancelCents - driverCents };
}

export function tripFeeSplit(): { totalCents: number; driverCents: number; platformCents: number } {
  return { totalCents: tripFeeCents, driverCents: 2000, platformCents: 500 };
}
