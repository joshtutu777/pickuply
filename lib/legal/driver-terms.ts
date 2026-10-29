import type { LegalSection } from "@/components/legal-document";
import { driverTermsVersion } from "@/lib/constants";
import { damagePolicyCopy } from "@/lib/legal/damage-policy";

/**
 * Prepared for review. Not published.
 * Georgia counsel still needs to review: independent-contractor status, injury and
 * death disclaimers, which insurance lines apply, the minimum limits, disposal
 * liability, and whether the 48-hour review window is only administrative.
 * This draft does not invent a policy limit or a required line of coverage.
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
      "You must keep, at your own expense, the insurance that applies to your vehicle and to the paid work you accept. That includes the coverage Georgia law requires. Where that law, your insurer, or a written Pickuply requirement says the work needs commercial, for-hire, or other business-use coverage, a personal auto policy is not a substitute. You have to confirm with your own insurer that the policy covers paid delivery, hauling, or junk removal.",
      "You must give Pickuply proof of insurance when you apply, when Pickuply asks, and before the proof already on file expires. If a policy is canceled, non-renewed, or lapses, you must tell Pickuply before you go Online again and before you accept another job. Do not go Online and do not accept a job while the required coverage is missing.",
      "If you do not keep the required coverage, or you do not provide proof when asked, Pickuply may refuse to let you go Online, refuse new jobs, or suspend your access. That is a platform rule. It is not a statement of the insurance types or dollar limits Georgia law requires. Pickuply does not sell you a policy, does not promise that an uploaded document is enough, and does not pay your deductible. An upload is not a statement that you are insured, licensed, or qualified.",
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
