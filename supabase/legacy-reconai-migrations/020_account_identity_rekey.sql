-- ══════════════════════════════════════════════════════════════════
-- 020_account_identity_rekey.sql
-- Re-key client-writable tables on the ACCOUNT (app_users.id), in
-- parallel with the legacy Sleeper-username model.
--
-- WHY
--   The original RLS contract authorized every client write by the
--   Sleeper username claim (app_metadata.sleeper_username, surfaced via
--   public.current_dhq_username()). The new email/password accounts
--   (Dynasty HQ) mint JWTs whose only identity claim is
--   app_metadata.user_id = public.app_users(id) — they carry no Sleeper
--   username, and self-serve email signup cannot PROVE ownership of a
--   Sleeper account, so we must NOT let an account claim a username as
--   its identity (impersonation hole). Instead the account becomes the
--   security principal and the Sleeper username becomes non-security
--   metadata.
--
-- MODEL (parallel / minimal blast radius)
--   • Legacy policies are left UNTOUCHED so existing password-backed
--     Sleeper sessions keep working unchanged.
--   • Each single-owner table gains a nullable `user_id` column and a
--     SECOND permissive policy `<table>_account_own` that authorizes by
--     user_id = current_app_user_id().
--   • Token type self-selects the policy: account tokens make
--     current_dhq_username() NULL (legacy policy never grants); legacy
--     tokens make current_app_user_id() NULL (account policy never
--     grants). Permissive policies OR together.
--   • The account WRITE check additionally requires the legacy owner
--     column IS NULL, so an account cannot stamp a victim's username on
--     a row it owns (closes the read-spoof vector).
--
-- NOT CHANGED
--   • public.users  — account profile lives in app_users; accounts never
--     write a users row (loading a Sleeper league is read-only API).
--   • public.messages — DM routing stays username-based; account-to-
--     account DM is deferred.
--   • public.analytics_events — already accepts app_metadata.user_id in
--     its insert policy (see 014_rls_lockdown.sql); client just sends it.
--
-- LEGACY ROWS
--   Existing rows keep username and user_id = NULL; they remain readable/
--   writable only by legacy Sleeper sessions. There is no reliable
--   username→app_user mapping to backfill (the platform_usernames bridge
--   is unused), so no data is migrated. A user with both a Sleeper login
--   and an email account will not see the two datasets merged.
--
-- DEPLOY: apply via Supabase Dashboard → SQL editor (the CLI is
--   read-only on project sxshiqyxhhifvtfqawbq). Safe to re-run.
-- ══════════════════════════════════════════════════════════════════

-- ── Identity helper for account tokens ────────────────────────────
-- Reads app_metadata.user_id only. fw-signup/fw-signin also set sub to
-- the same UUID, but legacy Sleeper tokens set sub = username (a non-UUID),
-- so we deliberately do NOT fall back to sub — a bad cast returns NULL.
create or replace function public.current_app_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(auth.jwt() -> 'app_metadata' ->> 'user_id', '');
  if raw is null then
    return null;
  end if;
  begin
    return raw::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- ── Policy installer: add the parallel account policy ─────────────
create or replace function public._add_account_owner_policy(p_table text, p_owner_col text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_account_own', p_table);
  execute format(
    'create policy %I on public.%I for all to public '
    || 'using (user_id is not null and user_id = public.current_app_user_id()) '
    || 'with check (user_id = public.current_app_user_id() and %I is null)',
    p_table || '_account_own', p_table, p_owner_col
  );
  -- Account tokens use the `authenticated` Postgres role; make sure it has
  -- table privileges (RLS still restricts rows). anon kept for legacy.
  execute format('grant select, insert, update, delete on public.%I to authenticated, anon', p_table);
end;
$$;

-- ── gm_strategy: username was the PRIMARY KEY → needs a surrogate ──
do $$
declare
  pk_name text;
  id_is_pk boolean;
begin
  if to_regclass('public.gm_strategy') is null then
    return;
  end if;

  alter table public.gm_strategy add column if not exists id uuid default gen_random_uuid();
  update public.gm_strategy set id = gen_random_uuid() where id is null;
  alter table public.gm_strategy alter column id set not null;

  -- Is the current primary key already on `id`?
  select exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.gm_strategy'::regclass
      and c.contype = 'p'
      and a.attname = 'id'
  ) into id_is_pk;

  if not id_is_pk then
    select conname into pk_name
    from pg_constraint
    where conrelid = 'public.gm_strategy'::regclass and contype = 'p';
    if pk_name is not null then
      execute format('alter table public.gm_strategy drop constraint %I', pk_name);
    end if;
    alter table public.gm_strategy add constraint gm_strategy_pkey_id primary key (id);
  end if;

  alter table public.gm_strategy alter column username drop not null;
end;
$$;

-- One row per principal (username side; the user_id unique index is created
-- after the loop below adds the user_id column). Full unique indexes double
-- as ON CONFLICT arbiters (nulls are distinct, so the unused key on
-- legacy/account rows never collides).
create unique index if not exists gm_strategy_username_uidx on public.gm_strategy (username);

-- ── Add user_id + relax owner NOT NULL on every single-owner table ─
-- (gm_strategy handled above for username nullability; user_id added here)
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('gm_strategy',     'username'),
      ('field_log',       'username'),
      ('ai_chat_memory',  'username'),
      ('league_docs',     'username'),
      ('player_tags',     'username'),
      ('owner_dna',       'username'),
      ('fa_targets',      'username'),
      ('calendar_events', 'username'),
      ('earnings',        'username'),
      ('ai_analysis',     'username'),
      ('draft_boards',    'sleeper_username')
    ) as t(tbl, owner_col)
  loop
    if to_regclass('public.' || rec.tbl) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists user_id uuid references public.app_users(id) on delete cascade',
      rec.tbl
    );
    execute format(
      'create index if not exists %I on public.%I (user_id)',
      rec.tbl || '_user_id_idx', rec.tbl
    );
    -- Relax legacy owner column so account rows can leave it NULL.
    execute format('alter table public.%I alter column %I drop not null', rec.tbl, rec.owner_col);

    perform public._add_account_owner_policy(rec.tbl, rec.owner_col);
  end loop;
end;
$$;

-- ── Account ON CONFLICT arbiters (user_id column now exists) ──────
-- gm_strategy: one row per account. Per-league tables: client upserts
-- account rows on (user_id, league_id); legacy keeps its existing
-- unique(username, league_id). Full indexes (nulls distinct).
create unique index if not exists gm_strategy_user_id_uidx     on public.gm_strategy (user_id);
create unique index if not exists owner_dna_user_league_uidx   on public.owner_dna   (user_id, league_id);
create unique index if not exists fa_targets_user_league_uidx  on public.fa_targets  (user_id, league_id);
create unique index if not exists player_tags_user_league_uidx on public.player_tags (user_id, league_id);

-- ── Cleanup installer (policies are inlined, function no longer needed) ──
drop function if exists public._add_account_owner_policy(text, text);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION (run as a sanity check, not part of migration)
--   -- account token should see exactly its own rows:
--   select * from public.gm_strategy;             -- via account JWT
--   -- legacy token unaffected:
--   select count(*) from public.gm_strategy where username is not null;
-- ══════════════════════════════════════════════════════════════════
