import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const file = path.resolve(process.argv[2] ?? ".env.test.local");
const command = process.argv.slice(3);
if (command.length === 0) {
  console.error("Usage: node scripts/stripe-test-runtime.mjs [env-file] <command> [args]");
  process.exit(1);
}

const env = { ...process.env };
const text = readFileSync(file, "utf8");
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const name = line.slice(0, line.indexOf("=")).trim();
  let value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[name] = value;
}

const secret = env.STRIPE_SECRET_KEY ?? "";
const publishable = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
if (!secret.startsWith("sk_test_") || !publishable.startsWith("pk_test_")) {
  console.error("The test runtime refused to start because the Stripe keys are not both test keys.");
  process.exit(1);
}
if ((env.STRIPE_WEBHOOK_SECRET ?? "").startsWith("whsec_") === false) {
  console.error("The test runtime needs a webhook signing secret.");
  process.exit(1);
}

const child = spawn(command[0], command.slice(1), {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 1));
