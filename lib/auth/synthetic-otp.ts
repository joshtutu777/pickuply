/**
 * Numbers that Supabase accepts with a fixed code and does not text.
 * A real phone is never in this list, and this list does not contain a code.
 */
const syntheticOtpPhones = new Set<string>([
  "5555550123",
  "5555550124",
  "5555550125",
  "5555550126",
  "5555550177",
  "5555550188",
  "5555550199",
  "5555550201",
  "5555550202",
  "5555550203",
  "5555550204",
  "5555550205",
  "5555550301",
  "5555550302",
  "5555550303",
  "5555550304",
  "5555550305",
  "5555550306",
  "5555550307",
  "5555550308",
  "5555550309",
  "5555550310",
  "5555550311",
  "5555550312",
  "5555550313",
]);

export function isSyntheticOtpPhone(normalizedPhone: string): boolean {
  const digits = normalizedPhone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return syntheticOtpPhones.has(ten);
}
