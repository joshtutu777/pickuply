export function applicationStatusCopy(status: string | null): { title: string; body: string } | null {
  if (status === "pending_review" || status === "applied") {
    return {
      title: "Application submitted",
      body: "We'll review it and contact you. Finish the Get Ready to Drive checklist while you wait.",
    };
  }
  if (status === "paused") {
    return {
      title: "Driving is paused",
      body: "You cannot take jobs until Pickuply turns driving back on.",
    };
  }
  if (status === "removed") {
    return {
      title: "Application closed",
      body: "This application was closed. You can submit it again if something changed.",
    };
  }
  return null;
}
