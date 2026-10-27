export const supportTopics = [
  { id: "pickup-delivery", label: "Pickup or delivery" },
  { id: "driver-account", label: "Driver account" },
  { id: "payments", label: "Payments or refunds" },
  { id: "booking", label: "Booking or offers" },
  { id: "technical", label: "Technical issue" },
  { id: "other", label: "Other" },
] as const;

export type SupportTopic = (typeof supportTopics)[number]["id"];

const topicIds = new Set<string>(supportTopics.map((topic) => topic.id));

export function supportTopicLabel(id: string): string {
  return supportTopics.find((topic) => topic.id === id)?.label ?? "Other";
}

export function supportStatusLabel(status: string): string {
  if (status === "awaiting_customer") return "Awaiting customer";
  if (status === "resolved") return "Resolved";
  if (status === "closed") return "Closed";
  return "Open";
}

export function parseSupportRequest(input: {
  firstName: string;
  lastName: string;
  email: string;
  topic: string;
  message: string;
  jobReference: string;
  honeypot: string;
}): { ok: true; value: { firstName: string; lastName: string; email: string; topic: SupportTopic; message: string; jobReference: string } } | { ok: false; error: string } {
  if (input.honeypot.trim()) return { ok: false, error: "Message was not sent." };
  const firstName = input.firstName.replace(/\u0000/g, "").trim();
  const lastName = input.lastName.replace(/\u0000/g, "").trim();
  const email = input.email.replace(/\u0000/g, "").trim().toLowerCase();
  const message = input.message.replace(/\u0000/g, "").trim();
  const jobReference = input.jobReference.replace(/\u0000/g, "").trim();
  if (firstName.length < 1 || firstName.length > 80) return { ok: false, error: "Enter a first name." };
  if (lastName.length > 80) return { ok: false, error: "Shorten the last name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) return { ok: false, error: "Enter a valid email." };
  if (!topicIds.has(input.topic)) return { ok: false, error: "Choose a topic." };
  if (message.length < 1 || message.length > 4000) return { ok: false, error: "Write a message under 4000 characters." };
  if (jobReference.length > 80) return { ok: false, error: "Shorten the job reference." };
  return {
    ok: true,
    value: { firstName, lastName, email, topic: input.topic as SupportTopic, message, jobReference },
  };
}
