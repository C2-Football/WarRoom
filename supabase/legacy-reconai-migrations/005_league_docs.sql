-- ══════════════════════════════════════════════════════════════════
-- 005_league_docs.sql
-- Stores league-specific document chunks for AI context injection.
-- Commissioner uploads bylaws, awards spreadsheets, custom rules —
-- these get chunked and fed into AI prompts for league-specific answers.
--
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.league_docs (
  id          uuid        primary key default gen_random_uuid(),
  username    text        not null references public.users(sleeper_username) on delete cascade,
  league_id   text        not null,
  doc_name    text        not null,
  doc_type    text        not null default 'text', -- 'text', 'pdf', 'csv'
  chunk_idx   int         not null default 0,
  chunk_text  text        not null,
  category    text        default 'general', -- 'bylaws', 'awards', 'calendar', 'scoring', 'general'
  created_at  timestamptz default now()
);

create index if not exists league_docs_league_idx
  on public.league_docs(league_id, category);

-- RLS: users can only manage their own docs.
alter table public.league_docs enable row level security;

drop policy if exists "Users manage own league_docs" on public.league_docs;
create policy "Users manage own league_docs"
  on public.league_docs for all
  using (username = current_setting('request.jwt.claims', true)::json->>'sub')
  with check (username = current_setting('request.jwt.claims', true)::json->>'sub');
