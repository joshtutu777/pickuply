import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const path = ".local/phone-hmac-secret";
if (!existsSync(".local")) mkdirSync(".local");
if (!existsSync(path)) {
  writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
}
const secret = readFileSync(path, "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(secret)) {
  console.error("local phone secret file is not a 64-character hex value");
  process.exit(1);
}
const quoted = `'${secret.replaceAll("'", "''")}'`;
const sql = `
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'phone_hmac_secret') then
    perform vault.create_secret(${quoted}, 'phone_hmac_secret', 'local phone hmac');
  end if;
end $$;
select (public.phone_hmac_secret() is not null) as configured;
`;
const set = spawnSync(
  "docker",
  ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8" },
);
if (set.status !== 0) {
  console.error("could not set the local database secret");
  process.exit(set.status ?? 1);
}
const check = spawnSync(
  "docker",
  ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", "select public.phone_hmac_secret() is not null and length(public.phone_hmac_secret()) = 64;"],
  { encoding: "utf8" },
);
const present = (check.stdout ?? "").trim() === "t";
console.log(present ? "local phone secret is configured" : "local phone secret is not visible to a new session");
process.exit(present ? 0 : 1);
