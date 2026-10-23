/** Guards for the local test-user reset script. No database access. */

export function assertLocalSupabaseUrl(url: string): void {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("Refusing: Supabase URL is not local.");
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error("Refusing: Supabase URL is not local.");
  }
}

/** Returns the 10-digit test number, or throws when it is not allowlisted. */
export function assertAllowlistedPhone(phone: string, allowlist: readonly string[]): string {
  const digits = phone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const allowed = new Set(
    allowlist
      .map((item) => item.replace(/\D/g, ""))
      .map((item) => (item.length === 11 && item.startsWith("1") ? item.slice(1) : item)),
  );
  if (!/^555\d{7}$/.test(ten) || !allowed.has(ten)) {
    throw new Error("Refusing: that phone is not on the local test allowlist.");
  }
  return ten;
}

export function historyBlocksReset(counts: {
  jobs: number;
  messages: number;
  threads: number;
  ledger: number;
  offers: number;
  disputes: number;
}): string | null {
  const total =
    counts.jobs + counts.messages + counts.threads + counts.ledger + counts.offers + counts.disputes;
  if (total > 0) {
    return "Refusing: this test account has marketplace history. Use a fresh unused test number.";
  }
  return null;
}
