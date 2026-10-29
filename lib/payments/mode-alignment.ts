import { paymentsMode, type PaymentsMode } from "@/lib/payments/payments-mode";

export type StoredPaymentsMode = "test" | "live";

export function storedPaymentsMode(value: string | null | undefined): StoredPaymentsMode | null {
  if (value === "test" || value === "live") return value;
  return null;
}

/** The environment switch and the database row agree. */
export function paymentsModesMatch(environment: PaymentsMode, database: string | null | undefined): boolean {
  return storedPaymentsMode(database) === environment;
}

export function modeAlignmentLabel(environment: PaymentsMode, database: string | null | undefined): {
  environment: PaymentsMode;
  database: StoredPaymentsMode | "missing";
  matches: boolean;
} {
  const stored = storedPaymentsMode(database);
  return {
    environment: paymentsMode(environment),
    database: stored ?? "missing",
    matches: stored === environment,
  };
}
