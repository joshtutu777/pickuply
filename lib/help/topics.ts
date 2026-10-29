import { damagePolicyCopy } from "@/lib/legal/damage-policy";

export type HelpTopic = {
  id: string;
  title: string;
  questions: { q: string; a: string }[];
};

export const customerTopics: HelpTopic[] = [
  {
    id: "booking",
    title: "Booking and prices",
    questions: [
      {
        q: "How is the price chosen?",
        a: "You can ask for a quote, name a price, or set a budget range. The price is locked before anyone is booked. Pickup, free-item, and store pickup offers start at $35. Junk removal offers start at $50.",
      },
      {
        q: "What do I pay?",
        a: "You pay the driver's offer plus a service fee. The default is 5% of that offer, and the total is shown before you accept. Pickuply's 15% commission comes out of the offer. It is not added again, and it is not taken from the service fee. Stripe's card processing cost is Pickuply's expense.",
      },
    ],
  },
  {
    id: "payments",
    title: "Payments and card holds",
    questions: [
      {
        q: "Do drivers keep tips?",
        a: "Yes. Drivers receive 100% of customer tips. Pickuply does not take a commission or service fee from tips. Your card is held for this booking and saved so you can add an optional tip in one tap. You won't be charged extra without your OK. You can remove a saved card under Profile, Payment methods.",
      },
      {
        q: "When is my card charged?",
        a: "No card is authorized until a driver is confirmed. The card is authorized, not captured. Capture happens after you confirm delivery, or 24 hours after delivery if you do not.",
      },
    ],
  },
  {
    id: "cancel",
    title: "Cancelling and rescheduling",
    questions: [
      {
        q: "Is there a cancel fee?",
        a: "Canceling is free. Before a driver is assigned, nothing is charged. After a driver is assigned, the card hold is released and there is no late-cancel fee.",
      },
      {
        q: "Can I reschedule?",
        a: "You can ask once, for free, before the driver is on the way. The driver has 2 hours to accept or decline. If they decline, the job opens again at the same price.",
      },
    ],
  },
  {
    id: "pickup",
    title: "Pickup day",
    questions: [
      {
        q: "What if the item is wrong?",
        a: "You can reject the item at the pickup check. The job ends and the card hold is released. There is no trip fee.",
      },
    ],
  },
  {
    id: "damage",
    title: "Damage or missing items",
    questions: [
      {
        q: "What is covered?",
        a: damagePolicyCopy,
      },
    ],
  },
  {
    id: "account",
    title: "Account and sign-in",
    questions: [
      {
        q: "How do I sign in?",
        a: "Use your mobile number and the 6-digit code. There is no separate admin sign-in.",
      },
    ],
  },
  {
    id: "junk",
    title: "Junk removal rules",
    questions: [
      {
        q: "What can't you take?",
        a: "Hazardous materials, chemicals, propane tanks, paint and solvents, weapons, drugs, cash, live animals, people, phones and small high-value electronics, and jewelry.",
      },
    ],
  },
];

export const driverTopics: HelpTopic[] = [
  {
    id: "approved",
    title: "Getting approved",
    questions: [
      {
        q: "When can I go Online?",
        a: "Finish the checklist. After Pickuply approves you, you stay Offline until you switch Online yourself.",
      },
    ],
  },
  {
    id: "documents",
    title: "Documents",
    questions: [
      {
        q: "What has to be current?",
        a: "An unexpired license, unexpired insurance, and a signed driver agreement are required to go Online. An upload counts as soon as it is saved.",
      },
    ],
  },
  {
    id: "online",
    title: "Going Online",
    questions: [
      {
        q: "Does approval turn me Online?",
        a: "No. You use the switch on Driver home. If something is missing, the message names that item.",
      },
    ],
  },
  {
    id: "payouts",
    title: "Payouts",
    questions: [
      {
        q: "When do I get paid?",
        a: "After a job is completed, Pickuply sends your earnings to your Stripe account. Bank deposits follow Stripe's payout schedule and may take a few additional business days. Check your payout status in Stripe.",
      },
      {
        q: "Do I need Stripe before I take a job?",
        a: "No. Payout setup does not block going Online or accepting a job. Earnings stay held until payouts are set up.",
      },
      {
        q: "What do I earn from an offer?",
        a: "The amount you enter is the offer. Pickuply keeps 15% of it. You see that commission and your estimated earnings before you confirm. The customer also pays a service fee on top. That fee is not taken from your earnings. A tip after delivery is extra. You keep 100% of it. It is not part of the 48-hour wait for a new driver's base earnings.",
      },
    ],
  },
  {
    id: "steps",
    title: "Job steps",
    questions: [
      {
        q: "What are the steps?",
        a: "The job screen uses Request and Price, Driver Confirmed, Pickup, and Delivered. The street address appears only after you are assigned.",
      },
    ],
  },
];
