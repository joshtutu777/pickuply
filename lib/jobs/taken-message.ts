export function takenJobMessage(message: string): string {
  if (message === "job already taken") {
    return "Sorry, another driver just took this job";
  }
  return message;
}
