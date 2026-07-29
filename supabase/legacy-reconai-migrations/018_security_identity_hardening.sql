-- Security identity hardening.
--
-- Passwordless Sleeper username checks are no longer considered identity
-- proof. RLS for legacy username-owned tables should only trust explicit
-- Sleeper username claims minted by password-backed legacy/gifted sessions,
-- not a generic JWT subject.

create or replace function public.current_dhq_username()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
    auth.jwt() ->> 'sleeper_username'
  );
$$;

alter table if exists public.yahoo_tokens
  add column if not exists owner_key text;

create index if not exists yahoo_tokens_owner_key_idx
  on public.yahoo_tokens(owner_key);
