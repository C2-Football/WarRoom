-- ══════════════════════════════════════════════════════════════════
-- AI Rate Limits — tracks per-user daily AI call usage
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_rate_limits (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username      text NOT NULL,
  date          date NOT NULL DEFAULT CURRENT_DATE,
  request_count integer NOT NULL DEFAULT 0,
  tokens_used   integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(username, date)
);

ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own limits"
  ON ai_rate_limits FOR SELECT
  USING (username = current_setting('request.jwt.claims', true)::json->>'sleeper_username');

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_date ON ai_rate_limits(username, date);

-- Atomic increment-and-check function called by the Edge Function
CREATE OR REPLACE FUNCTION increment_rate_limit(p_username text, p_limit integer)
RETURNS json AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO ai_rate_limits (username, date, request_count)
  VALUES (p_username, CURRENT_DATE, 1)
  ON CONFLICT (username, date)
  DO UPDATE SET request_count = ai_rate_limits.request_count + 1,
                updated_at = now()
  RETURNING request_count INTO v_count;

  IF p_limit > 0 AND v_count > p_limit THEN
    RETURN json_build_object('allowed', false, 'count', v_count, 'limit', p_limit);
  END IF;

  RETURN json_build_object('allowed', true, 'count', v_count, 'limit', p_limit);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup: delete rows older than 30 days (run via pg_cron or scheduled function)
-- SELECT cron.schedule('cleanup-rate-limits', '0 3 * * *', $$DELETE FROM ai_rate_limits WHERE date < CURRENT_DATE - 30$$);
