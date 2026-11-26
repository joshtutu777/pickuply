/** Asks the server to send any booking texts that are waiting. Safe to call with the browser closed afterward. */
export function flushTexts(): void {
  void fetch("/api/notifications/flush", { method: "POST" }).catch(() => undefined);
}
