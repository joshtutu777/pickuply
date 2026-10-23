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
        a: "You can ask for a quote, name a price, or set a budget range. The price is locked before anyone is booked. The lowest trip is $35.",
      },
      {
        q: "What is the platform fee?",
        a: "The platform fee is 10% of the driver's earnings, with a $10 minimum. It is shown in the subtotal.",
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
        a: "After a driver is assigned and before work starts, a late cancel is a $15 partial capture of the existing authorization. The rest of the hold is released. It is not a new charge.",
      },
      {
        q: "Can I reschedule?",
        a: "TODO: the spec does not yet say how a customer reschedules after a driver is assigned.",
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
        a: "Damage coverage is limited to $250 per job. Report the problem in the app.",
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
