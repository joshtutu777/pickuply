-- Last resort only. Run this in the Supabase SQL editor as the database owner.
-- Do not commit a real phone number in this file.
-- Replace the example with the confirmed phone of an existing Pickuply profile.
-- Keep at least two active admins so this file is rarely needed.

update public.profiles
set role = 'admin'
where phone in ('+15555550199', '5555550199')
  and deleted_at is null
  and not public.account_is_suspended(id);
