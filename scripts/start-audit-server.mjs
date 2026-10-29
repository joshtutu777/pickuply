import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();

function readEnv(filename) {
  const values = {};
  try {
    const text = readFileSync(path.join(root, filename), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      const eq = body.indexOf("=");
      if (eq <= 0) continue;
      const key = body.slice(0, eq).trim();
      let value = body.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch {
    return values;
  }
  return values;
}

const testEnv = readEnv(".env.test.local");
const localEnv = readEnv(".env.local");
const secret = (testEnv.STRIPE_SECRET_KEY || localEnv.STRIPE_SECRET_KEY || "");
if (!secret.startsWith("sk_test_")) {
  console.error("audit server needs an sk_test_ key");
  process.exit(1);
}

const port = process.env.AUDIT_PORT || "3011";
const cronSecret = process.env.CRON_SECRET || `audit-${Date.now()}`;
let webhookSecret = "";
let nextChild = null;

const listen = spawn(
  "stripe.cmd listen --forward-to http://127.0.0.1:" + port + "/api/stripe/webhook --events checkout.session.completed,payment_intent.amount_capturable_updated,payment_intent.succeeded,charge.captured",
  { stdio: ["ignore", "pipe", "pipe"], shell: true },
);
listen.on("error", (error) => {
  console.error(`stripe listen could not start: ${error.code ?? "error"}`);
});

function note(chunk) {
  const text = chunk.toString();
  const safe = text.replace(/whsec_[A-Za-z0-9]+/g, "whsec_redacted").replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_redacted");
  if (safe.trim()) console.log(safe.trim());
  const match = text.match(/whsec_[A-Za-z0-9]+/);
  if (match && !webhookSecret) {
    webhookSecret = match[0];
    startNext();
  }
}

listen.stdout.on("data", note);
listen.stderr.on("data", note);
listen.on("exit", (code) => {
  if (!nextChild) {
    console.error(`stripe listen exited ${code}; starting the app without a live webhook`);
    startNext();
  }
});

function startNext() {
  if (nextChild) return;
  writeFileSync(
    path.join(os.tmpdir(), "pickuply-audit-runtime.json"),
    JSON.stringify({ port, cronSecret, webhookReady: webhookSecret.startsWith("whsec_") }),
  );
  const env = {
    ...process.env,
    NODE_ENV: "development",
    NODE_OPTIONS: "--max-old-space-size=2048",
    NEXT_PUBLIC_SUPABASE_URL: testEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: testEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: testEnv.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: secret,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: testEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || localEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
    CRON_SECRET: cronSecret,
  };
  nextChild = spawn("npm", ["run", "dev", "--", "--webpack", "--hostname", "127.0.0.1", "--port", port], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: true,
  });
  console.log(`audit server starting on ${port} cron_set=${Boolean(cronSecret)} webhook_set=${webhookSecret.startsWith("whsec_")}`);
}

setTimeout(() => {
  if (!nextChild) {
    console.error("stripe listen did not provide a webhook secret; starting the app for page sync and capture");
    startNext();
  }
}, 12000);

function shutdown() {
  if (nextChild) nextChild.kill();
  listen.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
