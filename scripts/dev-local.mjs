import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Next leaves environment variables that are already set alone, so values
// loaded here win over .env.local. That keeps this server on local Supabase.
const env = { ...process.env };
const file = path.join(process.cwd(), ".env.test.local");
let text;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error("Missing .env.test.local. Local Supabase settings are required.");
  process.exit(1);
}

let loaded = 0;
for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const eq = body.indexOf("=");
  if (eq <= 0) continue;
  const key = body.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
  let value = body.slice(eq + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
  loaded += 1;
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error(".env.test.local needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

console.log(`Starting local app at http://127.0.0.1:3001 (${loaded} settings from .env.test.local).`);

const child = spawn(
  process.execPath,
  [
    path.join("node_modules", "next", "dist", "bin", "next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  { stdio: "inherit", env, cwd: process.cwd() },
);

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
