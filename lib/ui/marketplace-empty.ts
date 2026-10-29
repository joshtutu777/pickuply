export const matchedEmptyTitle = "No pickup requests yet";

export const matchedEmptyMessage =
  "New requests in your areas will show up here automatically. Keep notifications on and stay Online so you don't miss one.";

export const georgiaEmptyTitle = "No open requests across Georgia right now";

export const georgiaEmptyMessage = "We'll alert you when one comes in.";

export const customerEmptyTitle = "No pickups yet";

export const customerEmptyAction = "Request a pickup";

export const adminEmptyTitle = "No requests yet";

export const adminEmptyMessage =
  "New customer requests will appear here as soon as they're posted, and you'll get an alert.";

export function driverEmptyLinks(input: { payoutReady: boolean; notificationsOn: boolean }) {
  return {
    areas: true,
    payout: !input.payoutReady,
    notifications: !input.notificationsOn,
    share: true,
  };
}

/** The branded admin empty state is for a lane with no requests. Filters keep their own sentence. */
export function showAdminRequestEmpty(laneCount: number, visibleCount: number): boolean {
  return laneCount === 0 && visibleCount === 0;
}
