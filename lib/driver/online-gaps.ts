import { driverTermsVersion } from "@/lib/constants";

export type OnlineGap = {
  label: string;
  href: string | null;
};

export function onlineGaps(input: {
  status: string | null;
  licenseExpires: string | null;
  insuranceUrl: string | null;
  insuranceExpires: string | null;
  vehicleApproved: boolean;
  checklistRequired: boolean;
  agreementSigned: boolean;
  termsVersion: string | null;
  trainingDone: boolean;
  serviceCount: number;
  today: string;
  isTest: boolean;
}): OnlineGap[] {
  const gaps: OnlineGap[] = [];
  if (!input.status || !["active", "approved_new"].includes(input.status)) {
    const waiting = input.status === "pending_review" || input.status === "applied";
    gaps.push({
      label:
        input.status === "paused"
          ? "Driving is paused. You cannot take jobs until Pickuply turns it back on."
          : input.status === "removed"
            ? "This application was closed."
            : waiting
              ? "Your application is in review. You cannot take jobs yet."
              : "Your driver account is not approved for jobs.",
      href: input.status === "removed" ? "/driver/onboarding" : "/driver",
    });
  }
  if (input.checklistRequired && input.termsVersion !== driverTermsVersion) {
    gaps.push({
      label: "Accept the Driver Terms to go Online.",
      href: "/terms/driver",
    });
  }
  return gaps;
}

export function documentReviewNotes(input: {
  licenseUrl: string | null;
  licenseExpires: string | null;
  insuranceUrl: string | null;
  insuranceExpires: string | null;
  today: string;
}): string[] {
  const notes: string[] = [];
  if (!input.licenseUrl) notes.push("Driver license photo is missing.");
  else if (!input.licenseExpires) notes.push("Driver license expiration date is missing.");
  else if (input.licenseExpires < input.today) notes.push("Driver license date has passed.");
  if (!input.insuranceUrl) notes.push("Insurance card is missing.");
  else if (!input.insuranceExpires) notes.push("Insurance expiration date is missing.");
  else if (input.insuranceExpires < input.today) notes.push("Insurance date has passed.");
  return notes;
}
