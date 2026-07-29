-- ══════════════════════════════════════════════════════════════════
-- AI usage accounting repair
-- Adds an atomic token accumulator so Edge Functions do not overwrite
-- the daily ai_rate_limits.tokens_used value.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION add_ai_tokens_used(p_username text, p_tokens integer)
RETURNS integer AS $$
DECLARE
  v_total integer;
BEGIN
  INSERT INTO ai_rate_limits (username, date, request_count, tokens_used)
  VALUES (p_username, CURRENT_DATE, 0, GREATEST(COALESCE(p_tokens, 0), 0))
  ON CONFLICT (username, date)
  DO UPDATE SET
    tokens_used = ai_rate_limits.tokens_used + GREATEST(COALESCE(p_tokens, 0), 0),
    updated_at = now()
  RETURNING tokens_used INTO v_total;

  RETURN COALESCE(v_total, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
