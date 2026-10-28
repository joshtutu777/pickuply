import type { LegalSection } from "@/components/legal-document";

export const termsEffective = "October 28, 2026";

export const termsSections: LegalSection[] = [
  {
    id: "agreement",
    heading: "Agreement and eligibility",
    paragraphs: [
      "These Terms govern your use of Pickuply, a marketplace connecting customers requesting pickup, delivery, hauling, or similar services with independent service providers (“Drivers”). By creating an account or using Pickuply, you agree to these Terms and the Privacy Policy. You must be at least 18 years old and legally able to enter into a contract.",
      "Operator: Pickuply, 1985 Chattahoochee Dr, Duluth, GA 30097. Contact: info@pickuplyapp.com.",
    ],
  },
  {
    id: "marketplace",
    heading: "Marketplace role",
    paragraphs: [
      "Pickuply operates a technology marketplace connecting Customers with independent third-party Drivers for pickup, delivery, hauling, and related services. Unless expressly agreed in writing, Pickuply is not the carrier, mover, seller, buyer, owner, custodian, or insurer of any item, and does not itself perform transportation services. Drivers independently control the lawful means and methods of performing accepted services, subject to platform safety standards and applicable law. Pickuply does not guarantee that a request will be accepted or completed, that a particular Driver will be available, or that any goods will arrive undamaged. Nothing in these Terms excludes responsibility that applicable law does not permit Pickuply to disclaim.",
    ],
  },
  {
    id: "information",
    heading: "Customer requests and accurate information",
    paragraphs: [
      "Customers must provide accurate pickup and drop-off addresses, item descriptions, dimensions and weight when known, photos when requested, access instructions, stairs, special handling needs, and scheduling details. Customers must have the legal right to move or dispose of the items. Material changes may require a revised price and the customer’s approval before additional charges.",
    ],
  },
  {
    id: "assignment",
    heading: "Requests, pricing and driver assignment",
    paragraphs: [
      "Customers submit requests through the booking flow. Eligible Drivers may view and accept requests according to Pickuply’s matching, service-area, approval, and availability rules. A job is assigned only when the platform confirms the assignment. Pickuply may support additional offer or quote workflows where explicitly shown in the product; no such workflow is guaranteed by these Terms. A Driver’s acceptance and any displayed arrival estimate do not guarantee a particular arrival or completion time.",
    ],
  },
  {
    id: "pricing",
    heading: "Pricing, platform commission and service fee",
    paragraphs: [
      "The customer sees the applicable delivery price, a separately disclosed service fee, and any additional charges before confirming payment. Under the current configured model, the customer service fee is 5% of the delivery base, and Pickuply retains a 15% commission from the delivery base; the Driver’s base earnings are 85% of the delivery base. These percentages are current operating settings and may change prospectively with appropriate disclosure. Applicable taxes, approved disposal fees, and other charges, if any, must be disclosed before they are collected. Stripe processing costs are separate from the stated service-fee percentage.",
    ],
  },
  {
    id: "payment",
    heading: "Payment authorization, capture and tips",
    paragraphs: [
      "When live payment functionality is enabled, customers provide an eligible payment method through the checkout process. Pickuply may authorize or place a temporary hold for the displayed amount when a booking is submitted, before a Driver is assigned. Authorization is not necessarily a completed charge; capture, cancellation, release of holds, and refunds follow the checkout disclosures and applicable policies. Where disclosed and authorized, the booking card may be saved for an optional post-delivery tip. A tip is voluntary and charged separately only after the customer confirms the amount. Drivers are allocated 100% of tips, with no Pickuply commission or additional service fee on tips. Payment processing is provided by third-party payment providers, including Stripe, and is subject to their terms and applicable law. Pickuply may delay or withhold transfer of funds where necessary for fraud review, disputes, chargebacks, refunds, verification, or legal compliance, subject to applicable law and payment-provider rules. No specific payout arrival date is guaranteed unless expressly stated at checkout or in applicable Driver Terms.",
    ],
  },
  {
    id: "cancellations",
    heading: "Cancellations, changes and refunds",
    paragraphs: [
      "Cancellation and refund eligibility may depend on assignment, whether travel or service has started, payment status, and nonrecoverable third-party costs. Any applicable cancellation charge or refund rule must be disclosed before a paid booking. Pickuply does not currently impose a $15 late-cancellation fee or a $25 trip fee. Do not assume a charge applies unless expressly shown and authorized in the applicable transaction. Contact info@pickuplyapp.com for assistance.",
    ],
  },
  {
    id: "drivers",
    heading: "Driver requirements and separate Driver Terms",
    paragraphs: [
      "Drivers are independent service providers responsible for their own vehicles, licenses, registrations, permits, equipment, helpers, loading and unloading methods, driving conduct, compliance with traffic and transportation laws, and safe performance of services. Drivers must maintain, at their own expense, all insurance legally required for the vehicles and services they perform, including applicable commercial auto, for-hire, cargo, general liability, or other coverage where required by law or by Pickuply's separately disclosed Driver requirements. Personal auto insurance may exclude delivery or for-hire activity; Drivers are responsible for confirming coverage directly with their insurer before accepting jobs. Pickuply does not provide, procure, verify the adequacy of, guarantee, or substitute for a Driver's insurance unless Pickuply expressly states otherwise in a separate written policy. Driver approval or document review is not a certification of coverage. Drivers must promptly disclose insurance lapses and may not accept jobs without required coverage. Drivers are responsible for accidents, citations, injuries, property damage, loss, and third-party claims arising from their acts or omissions in performing services, to the extent imposed by applicable law. Pickuply may request evidence of insurance, suspend access, or require additional coverage. Separate Driver Terms may impose additional lawful obligations and should be reviewed and accepted before drivers perform paid services.",
      "Drivers must ensure their insurance covers the actual commercial or for-hire activities they perform; a personal auto policy may not cover deliveries or hauling for compensation. Pickuply does not purchase insurance on a Driver’s behalf unless expressly identified in a separate written coverage disclosure. Verification or collection of insurance documents does not make Pickuply an insurer or guarantee policy adequacy.",
    ],
  },
  {
    id: "prohibited",
    heading: "Prohibited and restricted items",
    paragraphs: [
      "Users may not request or transport illegal or stolen goods, explosives, hazardous materials, regulated weapons, controlled substances, or other items prohibited by law or Pickuply policy. Specialty, oversized, high-value, or potentially dangerous items may be declined or require additional review. Customers must disclose handling risks before booking.",
    ],
  },
  {
    id: "safety",
    heading: "Safety, damage and disputes",
    paragraphs: [
      "Customers must ensure safe, lawful access; disclose stairs, weight, dimensions, fragile or hazardous conditions, and special handling requirements; secure permission from the owner or premises controller; and appropriately package items unless a Driver expressly agrees to packaging services. Drivers must use reasonable care, appropriate equipment and safe loading, securing, transport, unloading and disposal methods. The Driver performing the service—not Pickuply—is ordinarily responsible for operational decisions and any resulting vehicle accident, injury, cargo loss, damage to goods, damage to homes, driveways or other property, or third-party harm attributable to that Driver's conduct, subject to applicable law. Pickuply does not promise insurance coverage or reimbursement for these events. Customers and Drivers should document item condition and promptly report incidents to info@pickuplyapp.com; Pickuply may facilitate communications or review platform records without accepting liability or becoming the insurer, claims adjuster, or guarantor of the underlying service. Users should preserve photos, receipts, communications and any police or insurer reports. Reporting an incident to Pickuply does not replace notifying the responsible Driver, insurer, law enforcement or other appropriate party.",
    ],
  },
  {
    id: "third-parties",
    heading: "Buyer, seller and third-party marketplace transactions",
    paragraphs: [
      "Where a pickup involves a sale, purchase, exchange, donation, or transfer of property between a buyer and seller (including transactions arranged on Facebook Marketplace or another third-party service), Pickuply is not a party to that underlying transaction. Pickuply does not verify title, ownership, authenticity, quality, fitness, description, price, legality, payment, or the right to sell or transfer the goods. The buyer and seller are solely responsible for their transaction, payment arrangements, accurate pickup instructions, item condition, access authorization, and resolving disputes about nonpayment, misrepresentation, defects, missing items, returns or ownership. A Driver's acceptance of a pickup does not mean Pickuply guarantees the seller will release the item or that the buyer will accept it. To the maximum extent permitted by law, Pickuply is not liable for losses arising from buyer-seller disputes, failed exchanges, seller or buyer conduct, or damage occurring during transportation by an independent Driver, except where applicable law imposes responsibility on Pickuply for its own conduct. Users should confirm item condition and ownership before pickup and should not ask Drivers to resolve purchase disputes.",
    ],
  },
  {
    id: "insurance",
    heading: "Independent Driver responsibility and insurance claims",
    paragraphs: [
      "A Driver is responsible for maintaining required insurance and for reporting accidents or claims to the appropriate insurer and authorities. Pickuply is not an insurance company and does not undertake to pay, defend, settle, or reimburse a Driver's or Customer's losses merely because a booking was arranged through the platform. Any insurance shown on a Driver profile or reviewed during onboarding is not a promise that a particular claim will be covered. Drivers remain responsible for deductibles, exclusions, coverage limits, claims reporting, and legally required compensation. Customers should consider obtaining appropriate coverage for valuable items. Pickuply may cooperate with lawful investigations and provide available transaction records as permitted by law, without assuming the Driver's obligations.",
    ],
  },
  {
    id: "accounts",
    heading: "Accounts, messaging, privacy and SMS",
    paragraphs: [
      "Keep account credentials and verification codes secure. Pickuply may send essential authentication and booking communications. Optional job or marketing text messages are subject to applicable consent requirements. Message frequency varies; message and data rates may apply. Reply STOP to opt out of applicable SMS and HELP for assistance. Driver-customer job messaging may become read-only immediately upon job completion or cancellation. Support communications may remain available separately. See the Privacy Policy for data and messaging practices.",
    ],
  },
  {
    id: "suspension",
    heading: "Suspension and termination",
    paragraphs: [
      "Pickuply may restrict or suspend accounts for fraud, safety concerns, legal violations, misrepresentations, payment abuse, or misuse of the service, subject to applicable law. Users may contact info@pickuplyapp.com for account assistance or closure. Suspension does not itself resolve earned amounts, refunds, or pending disputes; those matters must be handled under the applicable financial and legal rules.",
    ],
  },
  {
    id: "disclaimers",
    heading: "Disclaimers and legal terms",
    paragraphs: [
      "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, PICKUPLY PROVIDES ITS MARKETPLACE ON AN “AS IS” AND “AS AVAILABLE” BASIS AND DISCLAIMS WARRANTIES NOT EXPRESSLY PROVIDED IN THESE TERMS. PICKUPLY DOES NOT WARRANT OR GUARANTEE THE CONDUCT, FITNESS, LICENSING, INSURANCE, SAFETY, PERFORMANCE OR RESULTS OF INDEPENDENT DRIVERS; THE CONDITION, OWNERSHIP, LEGALITY OR DELIVERY OF GOODS; OR THE HONESTY OR PERFORMANCE OF BUYERS AND SELLERS. TO THE MAXIMUM EXTENT PERMITTED BY LAW, PICKUPLY IS NOT RESPONSIBLE FOR LOSSES ARISING FROM AN INDEPENDENT DRIVER'S TRANSPORTATION OPERATIONS, VEHICLE ACCIDENTS, TRAFFIC VIOLATIONS, PERSONAL INJURIES, DEATH, CARGO LOSS OR THEFT, PROPERTY DAMAGE, LOADING OR UNLOADING, OR DISPUTES BETWEEN CUSTOMERS, DRIVERS, BUYERS, SELLERS AND OTHER THIRD PARTIES, EXCEPT TO THE EXTENT CAUSED BY PICKUPLY'S OWN ACTS OR OMISSIONS FOR WHICH LIABILITY CANNOT LAWFULLY BE DISCLAIMED. NOTHING HERE EXCLUDES LIABILITY FOR FRAUD, WILLFUL MISCONDUCT, GROSS NEGLIGENCE, OR ANY OTHER LIABILITY THAT CANNOT BE EXCLUDED UNDER APPLICABLE LAW. No provision requires a user to waive nonwaivable consumer, insurance, personal-injury or other statutory rights.",
    ],
  },
  {
    id: "changes",
    heading: "Changes and contact",
    paragraphs: [
      "Pickuply may revise these Terms prospectively and display the revised effective date. Material changes should be communicated as legally required. Questions: info@pickuplyapp.com. Operator: Pickuply, 1985 Chattahoochee Dr, Duluth, GA 30097.",
    ],
  },
];
