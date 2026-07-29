# Legacy ReconAI migrations (historical — already applied, never re-run)

These 21 SQL files were inherited from `C2-Football/ReconAI`, which was archived
(read-only) on 2026-07-08. They are the migrations that originally created a
number of tables War Room reads and writes in production today:

`gm_strategy`, `field_log`, `ai_chat_memory`, `player_tags`, `league_docs`,
`analytics_events`, `yahoo_tokens`, plus the early AI rate-limit and tier columns.

Both apps have always shared one Supabase project (`sxshiqyxhhifvtfqawbq`), so
every one of these is **already applied there**. They are kept here purely so the
schema history is recoverable from a repo we still control.

## Why this directory and not `supabase/migrations/`

`supabase/migrations/` uses timestamp-prefixed names and is read by the
allowlists in `.github/workflows/deploy-functions.yml` — one that *applies*
pending migrations through the Management API, one that *verifies* they are
recorded. Putting already-applied, differently-numbered files in there invites a
re-run. This sibling directory is inert: nothing reads it, and nothing should.

**Do not add new migrations here.** New schema changes go in
`supabase/migrations/` with a timestamp prefix, and get added to the workflow's
apply + verify allowlists.
