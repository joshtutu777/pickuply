import type { LegalSection } from "@/components/legal-document";

export const termsEffective = "October 22, 2026";

export const termsSections: LegalSection[] = [
  {
    id: "agreement",
    heading: "Agreement and eligibility",
    paragraphs: [
      "These Terms govern use of Pickuply, a marketplace connecting customers who need pickup, delivery, or hauling with independent drivers. By creating an account or using the service, you agree to these Terms and the Privacy Policy. You must be at least 18 and able to enter a contract.",
      "Operator: Pickuply, 1985 Chattahoochee Dr, Duluth, GA 30097. Contact: info@pickuplyapp.com.",
    ],
  },
  {
    id: "marketplace",
    heading: "Marketplace role",
    paragraphs: [
      "Pickuply facilitates requests, offers, booking, and messages. Drivers are independent service providers, not employees of Pickuply, unless a written agreement says otherwise. Pickuply does not guarantee that a driver will offer, that a customer will book, or that a job will be completed. Pickuply does not provide an insurance guarantee.",
    ],
  },
  {
    id: "requests",
    heading: "Customer requests",
    paragraphs: [
      "Customers must give accurate pickup and delivery information, item descriptions, photographs when they add them, access conditions, stairs, and timing. Customers must have the right to arrange movement or disposal of the items. A material change can require a new price.",
    ],
  },
  {
    id: "offers",
    heading: "Driver offers and booking confirmation",
    paragraphs: [
      "A customer creates a request. Eligible drivers can submit offers. A job can have up to five active offers. Minimum offer amounts are set by Pickuply and can be changed in settings. Submitting an offer does not assign the job and does not book it.",
      "The customer must choose a driver. Choosing that offer assigns only that driver and declines the other active offers. The customer then sees the full price and confirms the booking.",
      "An admin can still send a quote on a quote request. The customer must accept that quote before drivers see it. A driver claim on an accepted quote assigns that driver and starts the payment window. A posted fixed price can still be accepted as posted. Those paths are separate from an ordinary offer, which is never an automatic booking.",
    ],
  },
  {
    id: "pricing",
    heading: "Pricing",
    paragraphs: [
      "Before the customer confirms, Pickuply shows the selected driver's offer, the service fee, any additional charges that apply at booking, and the total. The offer is the price for the pickup. Pickuply's commission is 15% of that offer unless the booking already stored a different rate. That commission is deducted from the offer, and the driver receives the rest. At 15%, the driver receives 85%. The commission is not added again. Pickup, free-item, and store pickup offers start at $35. Junk removal offers start at $50.",
      "The customer also pays a service fee on top of the offer. The default is 5% of the offer, rounded half up to the nearest cent. The rate and the amount are stored when the customer accepts, and a later settings change does not change that booking. The service fee supports secure payments, customer support, and Pickuply's damage policy. It is not insurance and it is not Stripe's processing fee. Stripe's processing cost is Pickuply's expense. A full refund when the driver or Pickuply is at fault includes the service fee. A partial refund keeps the service fee unless an admin chooses to refund it. The late-cancel fee and the trip fee are turned off. Canceling or rejecting an item does not add either charge. A booking that already recorded one of those fees keeps that record. A refund cannot be more than the amount collected.",
      "When a driver accepts a posted price, that posted amount is the offer. The service fee is added on top and shown before the customer confirms. Disposal and other later charges are not added to the authorized total unless they are shown and agreed.",
    ],
  },
  {
    id: "payments",
    heading: "Payments",
    paragraphs: [
      "No card is authorized before a driver is assigned. After assignment, the customer has the time shown on the request to confirm. That window starts at 30 minutes unless Pickuply changes the setting. Work does not start until the card is authorized.",
      "Confirming the booking authorizes the card. Pickuply captures the payment after the customer confirms delivery, or 24 hours after delivery if the customer does not confirm. If the card authorization expires first, Pickuply does not start a new charge.",
      "A Stripe transfer to a driver is not a deposit in the driver's bank. Driver earnings stay held until payout setup is finished, unless an admin records a payment outside Stripe. Refunds are not automatic.",
      "After a job is completed, the customer may add an optional tip for 7 days. No tip is selected unless the customer chooses one. The driver receives 100% of the tip. Pickuply does not take a commission or a service fee from a tip. Stripe's processing cost on a tip is Pickuply's expense. Your card is held for this booking and saved so you can add an optional tip in one tap. You won't be charged extra without your OK. A saved card is charged only for a tip amount the customer confirms. Removing a saved card in Profile stops one-tap tipping for future jobs. An admin can refund a tip. A customer cannot add a second tip after the first one succeeds.",
    ],
  },
  {
    id: "cancellations",
    heading: "Cancellations and refunds",
    paragraphs: [
      "Whether money comes back depends on whether a driver is assigned, whether work has started, and whether a charge has already been captured. Canceling releases a card hold that has not been captured. These Terms do not add a late-cancel fee or a trip fee.",
      "Contact info@pickuplyapp.com for help with a cancellation or a refund question.",
    ],
  },
  {
    id: "drivers",
    heading: "Driver requirements",
    paragraphs: [
      "Drivers must give truthful onboarding details and keep a valid license, insurance, and a suitable vehicle. Approval can be pending, limited, paused, or removed. Pickuply does not claim a background check.",
      "Drivers must not share a customer's address, access notes, or contact information except to perform a job they are assigned. Drivers cannot start work before payment is authorized.",
    ],
  },
  {
    id: "prohibited",
    heading: "Prohibited items",
    paragraphs: [
      "Do not request or move illegal goods, stolen property, hazardous materials, explosives, regulated weapons, controlled substances, or anything else Pickuply or the law prohibits. Specialty, high-value, oversized, or hazardous items may be declined. Disclose risks and special handling before booking.",
    ],
  },
  {
    id: "safety",
    heading: "Safety, damage, and disputes",
    paragraphs: [
      "Customers must provide safe, lawful access and disclose material risks. Drivers must use appropriate care and follow transportation and disposal rules.",
      "Report loss, damage, or misconduct to info@pickuplyapp.com. A problem report can hold capture of a payment that has not moved yet. It does not reverse money that has already moved. Pickuply may review a damage report and refund up to $250 for that job. Damage already visible at pickup is not covered. This is not insurance and it is not an automatic payment.",
    ],
  },
  {
    id: "accounts",
    heading: "Accounts and communications",
    paragraphs: [
      "Keep verification codes private. Pickuply sends the sign-in code by text. Optional texts are sent only with the separate consent on the sign-up or driver application screen. Message frequency varies. Message and data rates may apply. Reply STOP to opt out of optional texts and HELP for assistance.",
      "See the Privacy Policy for how information and SMS consent are handled.",
    ],
  },
  {
    id: "suspension",
    heading: "Suspension and termination",
    paragraphs: [
      "Pickuply may restrict or suspend an account for fraud, a safety concern, a legal violation, a misrepresentation, or misuse, subject to applicable law. You can contact info@pickuplyapp.com about closing an account.",
    ],
  },
  {
    id: "disclaimers",
    heading: "Disclaimers and legal terms",
    paragraphs: [
      "The service is provided as available, to the extent the law allows. These Terms do not include arbitration, a class-action waiver, a liability cap, or a governing-law clause.",
    ],
  },
  {
    id: "changes",
    heading: "Changes and contact",
    paragraphs: [
      "Pickuply may update these Terms and will change the effective date when it does.",
      "Contact: info@pickuplyapp.com. Operator: Pickuply, 1985 Chattahoochee Dr, Duluth, GA 30097.",
    ],
  },
];
