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
  trainingDone: boolean;
  serviceCount: number;
  today: string;
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
  if (!input.insuranceUrl || !input.insuranceExpires || input.insuranceExpires < input.today) {
    gaps.push({
      label: "Add unexpired insurance before going Online.",
      href: "/driver/ready/insurance",
    });
  }
  if (!input.vehicleApproved) {
    gaps.push({
      label: "An approved vehicle is required before going Online.",
      href: "/driver/ready/vehicle",
    });
  }
  if (input.checklistRequired && !input.agreementSigned) {
    gaps.push({
      label: "Sign the driver agreement before going Online.",
      href: "/driver/ready/agreement",
    });
  }
  if (input.checklistRequired && !input.trainingDone) {
    gaps.push({
      label: "Finish the short training before going Online.",
      href: "/driver/ready/training",
    });
  }
  if (input.checklistRequired && input.serviceCount < 1) {
    gaps.push({
      label: "Choose the services you offer before going Online.",
      href: "/driver/ready/services",
    });
  }
  return gaps;
}
