export function bookingTextMessage(input: { available: boolean; optedOut: boolean; optedIn: boolean }): string {
  if (input.optedOut) {
    return "You opted out by replying STOP. Check the box and save, then reply START to the Pickuply number. The checkbox alone cannot remove Twilio's block. Sign-in codes stay separate.";
  }
  if (!input.available) {
    return "Booking texts are not turned on yet. You can choose them now. Pickuply will not text you until an admin turns booking texts on.";
  }
  if (input.optedIn) {
    return "Booking texts are on. Pickuply can text you about your requests and jobs. Reply STOP to opt out.";
  }
  return "Booking texts are on. Check the box to receive texts about your requests and jobs. Reply STOP to opt out.";
}
