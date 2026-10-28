const rejectionCopy: Record<string, string> = {
  "job already taken": "Sorry, another driver just took this job",
  "offers are only allowed on open jobs": "This request is no longer open.",
  "this driver cannot offer on this job": "This request is no longer available to you.",
  "this driver cannot claim this job": "This request is no longer available to you.",
  "This request is no longer available.": "This request is no longer available.",
};

export function takenJobMessage(message: string): string {
  return rejectionCopy[message] ?? message;
}
