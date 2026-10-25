export const feedbackTypes = [
  { id: "bug", label: "Report a Bug" },
  { id: "feature", label: "Suggest a Feature" },
  { id: "confusing", label: "Something Confusing" },
  { id: "general", label: "General Feedback" },
] as const;

export const feedbackStatuses = [
  { id: "new", label: "New" },
  { id: "under_review", label: "Under Review" },
  { id: "planned", label: "Planned" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
] as const;

export type FeedbackType = (typeof feedbackTypes)[number]["id"];
export type FeedbackStatus = (typeof feedbackStatuses)[number]["id"];

const pagePattern = /^\/[A-Za-z0-9/_-]{0,179}$/;

export function feedbackTypeLabel(id: string): string {
  return feedbackTypes.find((item) => item.id === id)?.label ?? "Feedback";
}

export function feedbackStatusLabel(id: string): string {
  return feedbackStatuses.find((item) => item.id === id)?.label ?? "Updated";
}

export function safePagePath(value: string | null | undefined): string {
  if (!value) return "/feedback";
  const path = value.split("?")[0]?.split("#")[0]?.trim() ?? "";
  if (!pagePattern.test(path) || path.startsWith("//") || path.includes("..")) return "/feedback";
  return path;
}

export function safeDeviceInfo(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return cleaned || null;
}

export function validateFeedback(input: { type: string; subject: string; details: string }): string | null {
  if (!feedbackTypes.some((item) => item.id === input.type)) return "Choose a feedback type.";
  const subject = input.subject.trim();
  if (subject.length < 3 || subject.length > 120) return "Subject must be 3 to 120 characters.";
  const details = input.details.trim();
  if (details.length < 10 || details.length > 4000) return "Details must be 10 to 4000 characters.";
  return null;
}

export type FeedbackFilters = {
  status: string;
  type: string;
  role: string;
  from: string;
  to: string;
  q: string;
  page: number;
};

export function feedbackFilters(params: Record<string, string | string[] | undefined>): FeedbackFilters {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const status = one("status");
  const type = one("type");
  const role = one("role");
  const from = one("from");
  const to = one("to");
  const page = Number(one("page"));
  return {
    status: feedbackStatuses.some((item) => item.id === status) ? status : "",
    type: feedbackTypes.some((item) => item.id === type) ? type : "",
    role: role === "customer" || role === "driver" || role === "admin" ? role : "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : "",
    q: one("q").replace(/[%_]/g, "").slice(0, 80),
    page: Number.isInteger(page) && page > 0 && page < 1000 ? page : 1,
  };
}
