-- ══════════════════════════════════════════════════════════════════
-- 006_ai_chat_memory.sql
-- Cross-app AI chat memory — shared between War Room Scout and War Room.
--
-- Context: both apps keep a rolling set of conversation summaries so the
-- AI assistant has continuity between sessions. Previously these lived in
-- localStorage only (`dhq_sessions`), which meant Scout on mobile and
-- War Room on desktop had completely disjoint memories. This table lets
-- both apps push summaries after each chat and load the most recent N
-- on boot so they start with the same context.
--
-- Write path:  js/ai-chat.js addConvMemory() → shared/supabase-client.js
--              window.OD.saveChatMemory() → insert one row.
-- Read path:   loadConvMemory() → window.OD.loadChatMemory(leagueId, 6)
--              → merged into localStorage on first load per session.
--
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- Depends on: 001_ai_rate_limits.sql, 002_add_tier_column.sql
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.ai_chat_memory (
  id             uuid        primary key default gen_random_uuid(),
  username       text        not null references public.users(sleeper_username) on delete cascade,
  league_id      text,
  ts             bigint      not null,       -- client-side Date.now() when the summary was produced
  session_label  text,                       -- optional tag (e.g. 'home', 'trade-chat', 'waiver-chat')
  summary        text        not null,       -- short rolling summary of the conversation
  source         text        default 'scout',-- 'scout' | 'warroom'
  created_at     timestamptz default now()
);

-- Fast lookup: recent summaries for a user (most recent first)
create index if not exists ai_chat_memory_username_ts_idx
  on public.ai_chat_memory(username, ts desc);

-- Also index by (username, league_id) for league-scoped reads
create index if not exists ai_chat_memory_username_league_idx
  on public.ai_chat_memory(username, league_id, ts desc);

-- RLS: users can only read/write their own summaries
alter table public.ai_chat_memory enable row level security;

-- Drop old policies if they exist, then recreate. Supabase's SQL editor
-- handles `create policy if not exists` unevenly across versions, so this
-- is the safest cross-version pattern.
drop policy if exists "Users read own chat memory"   on public.ai_chat_memory;
drop policy if exists "Users insert own chat memory" on public.ai_chat_memory;
drop policy if exists "Users delete own chat memory" on public.ai_chat_memory;

create policy "Users read own chat memory"
  on public.ai_chat_memory for select
  using (username = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Users insert own chat memory"
  on public.ai_chat_memory for insert
  with check (username = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Users delete own chat memory"
  on public.ai_chat_memory for delete
  using (username = current_setting('request.jwt.claims', true)::json->>'sub');

-- Optional: keep the table bounded by retaining only the 200 most recent
-- rows per user. Uncomment if you want automatic pruning.
--
-- create or replace function public.prune_ai_chat_memory()
-- returns trigger language plpgsql as $$
-- begin
--   delete from public.ai_chat_memory
--   where username = new.username
--     and id not in (
--       select id from public.ai_chat_memory
--       where username = new.username
--       order by ts desc
--       limit 200
--     );
--   return null;
-- end;
-- $$;
--
-- drop trigger if exists ai_chat_memory_prune on public.ai_chat_memory;
-- create trigger ai_chat_memory_prune
--   after insert on public.ai_chat_memory
--   for each row execute function public.prune_ai_chat_memory();
