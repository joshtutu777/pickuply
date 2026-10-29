import type { LegalSection } from "@/components/legal-document";
import { driverTermsVersion } from "@/lib/constants";
import { damagePolicyCopy } from "@/lib/legal/damage-policy";

/**
 * Prepared for review. Not published.
 * Georgia counsel still needs to review: independent-contractor status, injury and
 * death disclaimers, required insurance types and limits, disposal liability, and
 * whether the 48-hour review window is only administrative.
 */
export const driverTermsEffective = "October 28, 2026";

export const driverTermsSections: LegalSection[] = [
  {
    id: "acceptance",
    heading: "What you accept",
    paragraphs: [
      `Driver Terms, version ${driverTermsVersion}. By checking the box, you agree to the Pickuply Terms of Service, the Privacy Policy, and these Driver Terms. Pickuply does not check this box for you.`,
      "If you already accepted an earlier version, you must accept this version before you go Online again.",
    ],
  },
  {
    id: "responsibility",
    heading: "Your responsibility for the job",
    paragraphs: [
      "You are an independent provider. You choose the lawful means and methods of a job you accept. You are responsible for your vehicle, your driving, your helpers, and the way the job is performed.",
      "That responsibility includes a vehicle accident, a traffic violation, bodily injury, death, loss or theft of the items being moved, and damage to homes, driveways, or other property, when the harm comes from your driving, loading, unloading, transportation, disposal, or other work on the job. It includes cargo while it is in your care.",
      "You are responsible for lawful disposal of junk you remove, including the disposal site and a site fee, unless the job in the app states a different arrangement. Do not leave material on the customer's property or on a roadside.",
      "This section does not decide a dispute by itself. A court, an insurer, or applicable law may place responsibility on another person, including Pickuply, where the law requires it.",
    ],
  },
  {
    id: "insurance",
    heading: "Insurance you must have",
    paragraphs: [
      "Before you go Online or accept a paid job, you must carry the insurance Georgia law requires for your vehicle and for paid hauling, delivery, or junk removal. Where that law, or a requirement Pickuply states separately, calls for commercial auto, for-hire, cargo, or liability coverage, you must have that coverage. A personal auto policy often excludes paid delivery and hauling. You have to confirm your coverage with your own insurer.",
      "Pickuply does not sell you a policy, does not promise that a document you upload is enough, and does not pay your deductible. Uploading a document is not a statement that you are insured, licensed, or qualified. If you do not have the required coverage, do not go Online and do not accept a job.",
    ],
  },
  {
    id: "damage",
    heading: "Damage reports",
    paragraphs: [damagePolicyCopy],
  },
  {
    id: "accidents",
    heading: "Accidents and claims",
    paragraphs: [
      "If someone is hurt, contact 911 first. Then contact your insurer and info@pickuplyapp.com. Pickuply can share the job record with the people involved in the report.",
      "A job booked on Pickuply does not, by itself, make Pickuply your insurer, the carrier, or the mover. Pickuply does not agree, merely because the job was booked here, to defend a claim against you or to pay your deductible.",
    ],
  },
  {
    id: "limits",
    heading: "What these terms do not waive",
    paragraphs: [
      "Nothing in these Driver Terms makes Pickuply immune from responsibility for its own acts or omissions. Nothing here waives liability for fraud, willful misconduct, or gross negligence, or any other liability that applicable law does not allow to be waived or limited.",
      "If a court finds that part of these terms cannot be enforced, that part is limited to the extent the law requires. The rest remains in effect.",
    ],
  },
];
