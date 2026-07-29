-- Cleanup legacy policies left behind by older SQL-editor schema runs.
-- These are superseded by 014_rls_lockdown.sql's canonical policies.

drop policy if exists "Users manage own field_log" on public.field_log;
