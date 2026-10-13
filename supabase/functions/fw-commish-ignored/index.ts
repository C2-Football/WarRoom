// Private account-owned ignored tasks. All mutations use a service-only atomic
// compare-and-swap routine; local client caches never establish authority.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleOptions, json, requireActiveAppSession } from '../_shared/security.ts';

const URL_VALUE = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && new TextEncoder().encode(value).length >= 1
  && new TextEncoder().encode(value).length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const fields = new Set(['taskId', 'state', 'expectedRevision', 'operationId', 'snapshot']);
const snapshotFields = new Set(['id', 'headline', 'detail', 'kind', 'hub', 'domain', 'leagueIds', 'leagueNames']);

function reply(req: Request, body: unknown, status = 200): Response {
  const response = json(req, body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
function validSnapshot(value: unknown, taskId: string): boolean {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.id !== taskId || Object.keys(row).some(key => !snapshotFields.has(key))) return false;
  for (const [key, limit] of [['id', 512], ['headline', 500], ['detail', 2000], ['kind', 100], ['hub', 60], ['domain', 60]] as const) {
    if (row[key] != null && (typeof row[key] !== 'string' || (row[key] as string).length > limit)) return false;
  }
  for (const key of ['leagueIds', 'leagueNames']) {
    const values = row[key];
    if (values != null && (!Array.isArray(values) || values.length > 50 || values.some(value => typeof value !== 'string' || value.length > 200))) return false;
  }
  return new TextEncoder().encode(JSON.stringify(value)).length <= 8192;
}

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (!['GET', 'POST'].includes(req.method)) return reply(req, { ok: false, error: 'Method not allowed.' }, 405);
  try {
    const admin = createClient(URL_VALUE, SERVICE_KEY, { auth: { persistSession: false } });
    const session = await requireActiveAppSession(admin, req);
    if (!session) return reply(req, { ok: false, code: 'invalid_session', error: 'Sign in again to sync ignored tasks.' }, 401);
    // The owner repo retains an older convenience rate helper. Use the already
    // deployed atomic primitive without changing any existing auth endpoint.
    const rateResult = await admin.rpc('consume_auth_rate_limit', {
      p_scope: 'commish_ignored_' + req.method.toLowerCase(), p_identifier: session.userId,
      p_limit: req.method === 'GET' ? 120 : 60, p_window_seconds: 60, p_lockout_seconds: 0,
    });
    const rate = rateResult.data;
    if (rateResult.error || !rate || typeof rate.allowed !== 'boolean' || !Number.isFinite(rate.count)) {
      return reply(req, { ok: false, error: 'Ignored task choices could not be confirmed. Try again.' }, 503);
    }
    if (!rate.allowed) {
      const response = reply(req, { ok: false, error: 'Too many requests. Try again shortly.' }, 429);
      response.headers.set('Retry-After', String(rate.retryAfterSeconds || 60));
      return response;
    }
    let result;
    if (req.method === 'GET') {
      const url = new URL(req.url), cursor = url.searchParams.get('cursor'), rawLimit = url.searchParams.get('limit');
      const limit = rawLimit == null ? 200 : Number(rawLimit);
      if ((cursor != null && !validId(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
        return reply(req, { ok: false, code: 'invalid_request', error: 'Invalid page request.' }, 400);
      }
      result = await admin.rpc('read_commish_ignored_tasks', {
        p_user_id: session.userId, p_session_version: session.sessionVersion, p_cursor: cursor, p_limit: limit,
      });
    } else {
      if (Number(req.headers.get('content-length') || 0) > 12000) return reply(req, { ok: false, error: 'Task change is too large.' }, 413);
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > 12000) return reply(req, { ok: false, error: 'Task change is too large.' }, 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { return reply(req, { ok: false, code: 'invalid_request', error: 'Invalid task change.' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.has(key))
        || !validId(body.taskId) || typeof body.state !== 'string' || !['ignored', 'restored'].includes(body.state)
        || typeof body.operationId !== 'string' || !UUID.test(body.operationId)
        || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || Number(body.expectedRevision) > 2000000000
        || !validSnapshot(body.snapshot, body.taskId)) {
        return reply(req, { ok: false, code: 'invalid_request', error: 'Invalid task change.' }, 400);
      }
      result = await admin.rpc('change_commish_ignored_task', {
        p_user_id: session.userId, p_session_version: session.sessionVersion,
        p_task_id: body.taskId, p_state: body.state, p_expected_revision: body.expectedRevision,
        p_operation_id: body.operationId, p_snapshot: body.snapshot ?? null,
      });
    }
    if (result.error || !result.data || typeof result.data.ok !== 'boolean') {
      return reply(req, { ok: false, error: 'Ignored task choices could not be confirmed. Try again.' }, 503);
    }
    const status = result.data.ok ? 200 : result.data.code === 'invalid_session' ? 401
      : ['revision_conflict', 'operation_conflict'].includes(result.data.code) ? 409 : result.data.code === 'invalid_request' ? 400 : 503;
    return reply(req, result.data, status);
  } catch {
    return reply(req, { ok: false, error: 'Ignored task choices could not be confirmed. Try again.' }, 503);
  }
});
