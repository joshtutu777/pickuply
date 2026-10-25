import type { LegalSection } from "@/components/legal-document";

export const privacyEffective = "October 22, 2026";

export const privacySections: LegalSection[] = [
  {
    id: "scope",
    heading: "Scope and operator",
    paragraphs: [
      'This Privacy Policy describes how Pickuply ("Pickuply," "we," "us") collects, uses, discloses, and protects personal information when customers, drivers, and visitors use our pickup, delivery, and hauling marketplace.',
      "The operator is Pickuply, 1985 Chattahoochee Dr, Duluth, GA 30097. Contact: info@pickuplyapp.com.",
    ],
  },
  {
    id: "collected",
    heading: "Information we collect",
    paragraphs: [
      "Account information: name, mobile number, email address when one is provided, login verification records, account role, and preferences.",
      "Booking information: pickup and drop-off addresses, general service areas, item descriptions, photographs, pickup windows, access instructions, driver offers, assignments, status updates, and in-app messages.",
      "Driver information: city and service area, vehicle information, equipment, license and insurance information, uploaded documents, agreement acknowledgments, payout setup status, and onboarding or approval status. Pickuply does not run background checks in this version.",
      "Payment information: transaction amounts, fees, payment status, and payment-provider references. Stripe processes the card. Pickuply does not store the full card number.",
      "Technical information: the details our host and database record to operate the account, including security logs needed to sign in and protect the service.",
    ],
  },
  {
    id: "use",
    heading: "How we use information",
    paragraphs: [
      "We use information to authenticate accounts, show requests to eligible drivers, let customers compare offers, calculate and display prices, authorize and later capture payment, provide support, investigate disputes, prevent fraud, protect safety, comply with law, and operate the service.",
      "We use contact details for service-related communications. Optional text messages are sent only where a person has given the separate consent described below.",
    ],
  },
  {
    id: "sms",
    heading: "SMS messaging and consent",
    paragraphs: [
      "When you request a phone verification code, Pickuply may send a one-time passcode to the mobile number you provide. That code is required to sign in. It is separate from optional notifications.",
      "Customers and drivers who separately check the optional text-message box may receive texts about their requests, offers, bookings, deliveries, driver applications, and, for drivers who consent, available jobs. Available-job texts are optional and are not required to apply or to take a job. Message frequency varies. Message and data rates may apply.",
      "The checkbox is off until you turn it on. Consent is not required to create an account or apply to drive. We do not send optional or marketing texts without that separate consent.",
      "Reply STOP to opt out of optional SMS messages and HELP for assistance. You may also contact info@pickuplyapp.com. Opting out of the sign-in code may affect phone login. Contact support for available options. We keep the consent time, the disclosure version, the registration source, and any opt-out time.",
      "We do not sell or share mobile numbers or SMS opt-in consent with third parties for their own marketing. Messaging providers and carriers receive what they need to deliver the message.",
    ],
  },
  {
    id: "sharing",
    heading: "When information is shared",
    paragraphs: [
      "Before a driver is assigned, other drivers see the city and ZIP, the kind of job, and the offer details needed to decide. They do not see the customer's name, phone number, email, exact address, or access notes.",
      "After a driver is assigned, that driver receives the addresses and access notes needed to do the job. Customers and drivers still do not see each other's phone numbers. They message inside Pickuply.",
      "We use hosting, database, authentication, messaging, payment, and mapping providers to operate Pickuply. Those providers process information for that purpose.",
      "We may disclose information when required by law or when it is reasonably necessary to address fraud, a security incident, a dispute, or a safety threat.",
      "Information may be transferred in a merger, financing, reorganization, or sale, subject to applicable law.",
    ],
  },
  {
    id: "photos",
    heading: "Photos, location, and sensitive documents",
    paragraphs: [
      "Request photographs can be shown to an eligible driver who is deciding whether to offer. Avoid faces, identification, license plates, and address labels in item photos. Pickup, drop-off, and proof photos stay limited to the people on that job and to an admin.",
      "Driver license, insurance, and other onboarding documents are stored privately for the driver and for admin review.",
      "We use addresses to arrange the booking and may show a straight-line distance. Pickuply does not track a live GPS location.",
    ],
  },
  {
    id: "retention",
    heading: "Data retention and security",
    paragraphs: [
      "We keep information as reasonably necessary to operate accounts, complete bookings, keep records, resolve disputes, and meet legal obligations. How long a record is kept depends on the type of record.",
      "We use access controls, including database rules that limit who can read a row. No online service can guarantee absolute security.",
    ],
  },
  {
    id: "rights",
    heading: "Your choices and rights",
    paragraphs: [
      "You may request access, correction, or deletion of your personal information by contacting info@pickuplyapp.com. Some information may need to be kept for legal, security, or transaction reasons. Depending on your state, additional privacy rights may apply.",
      "You can leave the optional text-message box unchecked, or reply STOP after you have opted in.",
    ],
  },
  {
    id: "children",
    heading: "Children",
    paragraphs: [
      "Pickuply is not intended for children under 18. We do not knowingly solicit accounts from children.",
    ],
  },
  {
    id: "changes",
    heading: "Changes and contact",
    paragraphs: [
      "We may update this policy and will post the revised effective date when changes are made.",
      "Questions or requests: info@pickuplyapp.com. Business operator: Pickuply, 1985 Chattahoochee Dr, Duluth, GA 30097.",
    ],
  },
];
