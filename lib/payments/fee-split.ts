/** Launch penalties are off. These stay at zero so a caller cannot rebuild the old $15 or $25 charge. */
export const lateCancelCents = 0;
export const tripFeeCents = 0;

export function lateCancelSplit(enRouteOrLater: boolean): { totalCents: number; driverCents: number; platformCents: number } {
  void enRouteOrLater;
  return { totalCents: 0, driverCents: 0, platformCents: 0 };
}

export function tripFeeSplit(): { totalCents: number; driverCents: number; platformCents: number } {
  return { totalCents: 0, driverCents: 0, platformCents: 0 };
}
