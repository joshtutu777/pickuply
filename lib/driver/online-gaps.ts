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
  if (!input.licenseExpires || input.licenseExpires < input.today) {
    gaps.push({
      label: "Add an unexpired driver license before going Online.",
      href: "/driver/onboarding",
    });
  }
  if (input.insuranceExpires && input.insuranceExpires < input.today) {
    gaps.push({
      label: "Your insurance expired. Upload a new card to go Online.",
      href: "/driver/ready/insurance",
    });
  } else if (
    ["active", "approved_new"].includes(input.status ?? "") &&
    !input.isTest &&
    (!input.insuranceUrl || !input.insuranceExpires)
  ) {
    gaps.push({
      label: "Upload your insurance to go Online.",
      href: "/driver/ready/insurance",
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
