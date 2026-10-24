// Decides whether a Supabase URL may receive synthetic deployed-test accounts.
// Production is refused. Any other hosted project is refused until a person approves it.

export const productionSupabaseHost = "uyhithfdmphilleusiom.supabase.co";

export const deployedTestPhones = [
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
];

export function assertSafeTestTarget(url) {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    throw new Error("Refusing: Supabase URL is missing or invalid.");
  }
  if (host === productionSupabaseHost) {
    throw new Error("Refusing: that URL is the production Supabase project used by pickuplyapp.com.");
  }
  if (host !== "127.0.0.1:54321" && host !== "localhost:54321") {
    throw new Error("Refusing: synthetic accounts can be prepared on local Supabase only. Hosted changes need a separate approval.");
  }
  return host;
}
