import type { LegalSection } from "@/components/legal-document";
import { driverTermsVersion } from "@/lib/constants";
import { damagePolicyCopy } from "@/lib/legal/damage-policy";

export const driverTermsEffective = "October 28, 2026";

export const driverTermsSections: LegalSection[] = [
  {
    id: "acceptance",
    heading: "What you accept",
    paragraphs: [
      `Driver Terms, version ${driverTermsVersion}. By checking the box, you agree to the Pickuply Terms of Service and Privacy Policy, and to these Driver Terms. You are an independent provider. You are responsible for your vehicle, your license, and the insurance your work requires. Pickuply does not insure you, your vehicle, or the items you move. You must report an accident, injury, or damage to info@pickuplyapp.com and to your insurer. Pickuply does not check this box for you.`,
      "If you already accepted an earlier version, you must accept this version before you go Online again.",
    ],
  },
  {
    id: "insurance",
    heading: "Insurance you must have",
    paragraphs: [
      "Before accepting a paid job, you must have the insurance Georgia law requires for the vehicle and for paid hauling, delivery, or junk removal. A personal auto policy often excludes that work. Pickuply does not sell you a policy, does not promise that a policy you upload is enough, and does not pay your deductible. If you do not have the required coverage, do not go Online and do not accept a job.",
      "Drivers remain responsible for the insurance required by law and by the Terms of Service and Driver Terms they accept in the app. Pickuply's review of an uploaded document is not a statement that the driver is insured or qualified.",
    ],
  },
  {
    id: "damage",
    heading: "Damage, loss, and goodwill",
    paragraphs: [
      damagePolicyCopy,
      "Report loss or damage to info@pickuplyapp.com within 48 hours after delivery, and include photos. Pickup photos are the record of condition at pickup. Pickuply may close a report it receives after 48 hours. Sending the report does not by itself create a payment.",
      "Pickuply does not insure items and does not promise reimbursement. Any goodwill payment is discretionary, is not insurance, and will not exceed $250 for that job.",
    ],
  },
  {
    id: "accidents",
    heading: "Accidents and claims",
    paragraphs: [
      "If there is an accident, injury, or damage, contact 911 when someone is hurt, then contact your insurer and info@pickuplyapp.com. Pickuply can share the job record. Pickuply does not defend the claim, does not pay the deductible, and does not become the insurer because the job was booked here. Nothing in these terms waives a right that Georgia law does not allow to be waived.",
    ],
  },
];
