import { spawn } from "node:child_process";

const a = "c1640000-0000-4000-8000-000000000001";
const b = "c1640000-0000-4000-8000-000000000002";

function psql(sql, { async = false } = {}) {
  const args = ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql];
  if (!async) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.on("close", (code) => {
        if (code !== 0) reject(new Error("sql failed"));
        else resolve(out.trim());
      });
    });
  }
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.on("close", (code) => resolve(code === 0));
  });
}

function userSql(id, email) {
  return `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${email}', 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, now(), now(), '${id}', '', '${id}-email', '${id}-recovery'
    )
  `;
}

const existing = await psql(`
  select coalesce(string_agg(id::text, ','), '')
  from public.profiles
  where role = 'admin' and deleted_at is null and not public.account_is_suspended(id)
`);
const ids = existing.split(",").map((id) => id.trim()).filter(Boolean);

try {
  await psql(userSql(a, "race-a@pickuply.test"));
  await psql(userSql(b, "race-b@pickuply.test"));
  await psql(`update public.profiles set role = 'admin' where id in ('${a}', '${b}')`);
  if (ids.length > 0) {
    await psql(`update public.profiles set role = 'customer' where id in (${ids.map((id) => `'${id}'`).join(",")})`);
  }
  const [first, second] = await Promise.all([
    psql(`update public.profiles set role = 'customer' where id = '${a}'`, { async: true }),
    psql(`update public.profiles set role = 'customer' where id = '${b}'`, { async: true }),
  ]);
  const remaining = await psql(`
    select count(*)
    from public.profiles
    where id in ('${a}', '${b}') and role = 'admin' and deleted_at is null
  `);
  const rejected = Number(!first) + Number(!second);
  if (remaining === "1" && rejected === 1) {
    console.log("concurrent last-admin check rejected one of the two demotions");
  } else {
    console.log(`concurrent last-admin check did not hold: remaining=${remaining} rejected=${rejected}`);
    process.exitCode = 1;
  }
} finally {
  if (ids.length > 0) {
    await psql(`update public.profiles set role = 'admin' where id in (${ids.map((id) => `'${id}'`).join(",")})`).catch(() => {});
  }
  await psql(`update public.profiles set role = 'customer' where id in ('${a}', '${b}')`).catch(() => {});
  await psql(`delete from auth.users where id in ('${a}', '${b}')`).catch(() => {});
  const restored = await psql(`
    select count(*)
    from public.profiles
    where id in (${ids.length ? ids.map((id) => `'${id}'`).join(",") : "null"})
      and role = 'admin' and deleted_at is null
  `).catch(() => "unknown");
  console.log(`restored active admins: ${ids.length === 0 ? "none were changed" : `${restored} of ${ids.length}`}`);
}
