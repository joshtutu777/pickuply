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
        a: "You pay the driver's offer plus a separate card processing fee. Pickuply's 15% commission comes out of that offer. It is not added again, and Pickuply does not pay the processing fee for you. There is no extra Pickuply service fee.",
      },
    ],
  },
  {
    id: "payments",
    title: "Payments and card holds",
    questions: [
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
        a: "Before a driver is assigned, canceling is free and any card hold is released. After a driver is assigned, a late cancel is one $15 charge from the existing hold. If the driver is already on the way, $10 goes to the driver and $5 stays with Pickuply. If the driver has not started, Pickuply keeps the $15. If the card was not authorized yet, there is no fee.",
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
        a: "You can reject the item at the pickup check. The trip fee is $25, and that is the only capture. The rest of the authorization is released.",
      },
    ],
  },
  {
    id: "damage",
    title: "Damage or missing items",
    questions: [
      {
        q: "What is covered?",
        a: "Report damage within 48 hours of delivery and include photos. Pickup photos are the before picture. Damage already visible at pickup is not covered. Pickuply reviews the report. There is no automatic refund. Customer-packed or disassembled items, loose parts, and normal wear are not covered.",
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
        q: "Do I need Stripe before I take a job?",
        a: "No. Payout setup does not block going Online or accepting a job. Earnings stay held until payouts are set up.",
      },
      {
        q: "What do I earn from an offer?",
        a: "The amount you enter is the price the customer sees. Pickuply keeps 15% of that offer. You see that fee and your estimated earnings before you confirm. The customer also pays a separate card processing fee.",
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
