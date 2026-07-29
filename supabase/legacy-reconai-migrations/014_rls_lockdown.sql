-- RLS lockdown contract for shared ReconAI / War Room Supabase tables.
--
-- Client-writable, user-owned tables:
--   users, calendar_events, earnings, fa_targets, messages, ai_analysis,
--   owner_dna, draft_boards, field_log, ai_chat_memory, gm_strategy,
--   league_docs, player_tags, analytics_events
--
-- Server-only tables:
--   ai_rate_limits, yahoo_tokens
--
-- Service-role Edge Functions bypass RLS for server-owned writes. Browser
-- clients must carry an explicit Sleeper username claim matching the row owner.

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

-- ── Legacy owner dashboard tables ─────────────────────────────
do $$
begin
  if to_regclass('public.users') is not null then
    alter table public.users enable row level security;
    drop policy if exists users_all on public.users;
    drop policy if exists users_own on public.users;
    execute 'create policy users_own on public.users for all to public using (sleeper_username = public.current_dhq_username()) with check (sleeper_username = public.current_dhq_username())';
  end if;

  if to_regclass('public.calendar_events') is not null then
    alter table public.calendar_events enable row level security;
    drop policy if exists calendar_all on public.calendar_events;
    drop policy if exists calendar_own on public.calendar_events;
    execute 'create policy calendar_own on public.calendar_events for all to public using (username = public.current_dhq_username()) with check (username = public.current_dhq_username())';
  end if;

  if to_regclass('public.earnings') is not null then
    alter table public.earnings enable row level security;
    drop policy if exists earnings_all on public.earnings;
    drop policy if exists earnings_own on public.earnings;
    execute 'create policy earnings_own on public.earnings for all to public using (username = public.current_dhq_username()) with check (username = public.current_dhq_username())';
  end if;

  if to_regclass('public.fa_targets') is not null then
    alter table public.fa_targets enable row level security;
    drop policy if exists fa_targets_all on public.fa_targets;
    drop policy if exists fa_targets_own on public.fa_targets;
    execute 'create policy fa_targets_own on public.fa_targets for all to public using (username = public.current_dhq_username()) with check (username = public.current_dhq_username())';
  end if;

  if to_regclass('public.ai_analysis') is not null then
    alter table public.ai_analysis enable row level security;
    drop policy if exists ai_analysis_all on public.ai_analysis;
    drop policy if exists ai_analysis_own on public.ai_analysis;
    execute 'create policy ai_analysis_own on public.ai_analysis for all to public using (username = public.current_dhq_username()) with check (username = public.current_dhq_username())';
  end if;

  if to_regclass('public.owner_dna') is not null then
    alter table public.owner_dna enable row level security;
    drop policy if exists owner_dna_all on public.owner_dna;
    drop policy if exists owner_dna_own on public.owner_dna;
    execute 'create policy owner_dna_own on public.owner_dna for all to public using (username = public.current_dhq_username()) with check (username = public.current_dhq_username())';
  end if;

  if to_regclass('public.draft_boards') is not null then
    alter table public.draft_boards enable row level security;
    drop policy if exists draft_boards_all on public.draft_boards;
    drop policy if exists draft_boards_own on public.draft_boards;
    execute 'create policy draft_boards_own on public.draft_boards for all to public using (sleeper_username = public.current_dhq_username()) with check (sleeper_username = public.current_dhq_username())';
  end if;

  if to_regclass('public.mock_draft_prospects') is not null then
    alter table public.mock_draft_prospects enable row level security;
    drop policy if exists prospects_read on public.mock_draft_prospects;
    execute 'create policy prospects_read on public.mock_draft_prospects for select to public using (public.current_dhq_username() is not null)';
  end if;
end $$;

-- ── Messages need operation-specific ownership ────────────────
do $$
begin
  if to_regclass('public.messages') is not null then
    alter table public.messages enable row level security;
    drop policy if exists messages_all on public.messages;
    drop policy if exists messages_select on public.messages;
    drop policy if exists messages_insert on public.messages;
    drop policy if exists messages_update on public.messages;
    drop policy if exists messages_delete on public.messages;

    execute 'create policy messages_select on public.messages for select to public using (public.current_dhq_username() in (from_username, to_username))';
    execute 'create policy messages_insert on public.messages for insert to public with check (from_username = public.current_dhq_username())';
    execute 'create policy messages_update on public.messages for update to public using (to_username = public.current_dhq_username()) with check (to_username = public.current_dhq_username())';
  end if;
end $$;

-- ── Shared cross-app tables ───────────────────────────────────
alter table if exists public.field_log enable row level security;
drop policy if exists field_log_select_own on public.field_log;
drop policy if exists field_log_insert_own on public.field_log;
drop policy if exists field_log_update_own on public.field_log;
drop policy if exists field_log_delete_own on public.field_log;
drop policy if exists "Users manage own field_log" on public.field_log;
drop policy if exists field_log_own on public.field_log;
create policy field_log_own
  on public.field_log for all to public
  using (username = public.current_dhq_username())
  with check (username = public.current_dhq_username());

alter table if exists public.ai_chat_memory enable row level security;
drop policy if exists "Users read own chat memory" on public.ai_chat_memory;
drop policy if exists "Users insert own chat memory" on public.ai_chat_memory;
drop policy if exists "Users delete own chat memory" on public.ai_chat_memory;
drop policy if exists ai_chat_memory_own on public.ai_chat_memory;
create policy ai_chat_memory_own
  on public.ai_chat_memory for all to public
  using (username = public.current_dhq_username())
  with check (username = public.current_dhq_username());

alter table if exists public.gm_strategy enable row level security;
drop policy if exists "Users read own strategy" on public.gm_strategy;
drop policy if exists "Users insert own strategy" on public.gm_strategy;
drop policy if exists "Users update own strategy" on public.gm_strategy;
drop policy if exists gm_strategy_own on public.gm_strategy;
create policy gm_strategy_own
  on public.gm_strategy for all to public
  using (username = public.current_dhq_username())
  with check (username = public.current_dhq_username());

alter table if exists public.league_docs enable row level security;
drop policy if exists "Users manage own league_docs" on public.league_docs;
drop policy if exists league_docs_own on public.league_docs;
create policy league_docs_own
  on public.league_docs for all to public
  using (username = public.current_dhq_username())
  with check (username = public.current_dhq_username());

alter table if exists public.player_tags enable row level security;
drop policy if exists player_tags_own on public.player_tags;
create policy player_tags_own
  on public.player_tags for all to public
  using (username = public.current_dhq_username())
  with check (username = public.current_dhq_username());

-- Product analytics is browser-writable but not browser-readable. Internal
-- analysis should use service-role dashboards/functions.
alter table if exists public.analytics_events enable row level security;
drop policy if exists analytics_events_insert_own on public.analytics_events;
drop policy if exists analytics_events_select_own on public.analytics_events;
drop policy if exists analytics_events_update_own on public.analytics_events;
drop policy if exists analytics_events_delete_own on public.analytics_events;
create policy analytics_events_insert_own
  on public.analytics_events for insert to public
  with check (
    username is null
    or username = public.current_dhq_username()
    or user_id::text = auth.jwt() -> 'app_metadata' ->> 'user_id'
    or user_id::text = auth.jwt() ->> 'sub'
  );

-- ── Server-only tables ────────────────────────────────────────
alter table if exists public.ai_rate_limits enable row level security;
drop policy if exists "Users read own limits" on public.ai_rate_limits;
drop policy if exists ai_rate_limits_read_own on public.ai_rate_limits;
create policy ai_rate_limits_read_own
  on public.ai_rate_limits for select to public
  using (username = public.current_dhq_username());

alter table if exists public.yahoo_tokens enable row level security;
drop policy if exists yahoo_tokens_deny_all on public.yahoo_tokens;
create policy yahoo_tokens_deny_all
  on public.yahoo_tokens for all to public
  using (false)
  with check (false);
