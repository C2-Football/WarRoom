-- ══════════════════════════════════════════════════════════════════
-- 003_rename_tier_reconai_to_scout.sql
-- Renames the 'reconai' tier value → 'scout' across the users table.
--
-- Context: The $4.99/mo tier was stored as 'reconai' and is being
-- rebranded to 'scout' to match the War Room Scout product name.
--
-- Safe to run multiple times (idempotent via WHERE tier = 'reconai').
-- Preserves all other columns: subscription dates, payment info, etc.
-- No RLS policies on the users table reference tier values directly,
-- so no policy changes are needed.
-- ══════════════════════════════════════════════════════════════════

-- Rename all 'reconai' tier users to 'scout'
UPDATE users
SET   tier = 'scout'
WHERE tier = 'reconai';
