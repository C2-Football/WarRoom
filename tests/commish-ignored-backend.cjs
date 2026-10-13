'use strict';
// Actual production handler, signed JWT validation, and SQL in isolated PGlite.
// No hosted writes or credentials. PGlite serializes connections; independent
// hosted contention and cross-device browser checks remain separate evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./helpers/security-ts-loader.cjs');
const migration = 'supabase/migrations/20261012030000_commish_ignored_tasks.sql';
const endpoint = 'supabase/functions/fw-commish-ignored/index.ts';
let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }

(async () => {
  const { SignJWT, jwtVerify } = await import(pathToFileURL(require.resolve('jose')).href);
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  let outage = false, blocked = false, revokeAtWrite = false, malformedRate = false;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table app_users(id uuid primary key default gen_random_uuid(), email text, session_version integer not null default 1);');
    await db.exec(fs.readFileSync(migration, 'utf8'));
    await db.exec(fs.readFileSync(migration, 'utf8'));
    const [a, b] = (await q("insert into app_users(email) values('a@example.invalid'),('b@example.invalid') returning id")).map(row => row.id);
    const admin = {
      from(table) {
        assert.equal(table, 'app_users'); let id;
        return { select() { return this; }, eq(key, value) { assert.equal(key, 'id'); id = value; return this; },
          async maybeSingle() { return { data: (await q('select email,session_version from app_users where id=$1', [id]))[0] || null }; } };
      },
      async rpc(name, p) {
        if (outage) return { data: null, error: { message: 'Isolated failure: must not leak this detail' } };
        if (name === 'consume_auth_rate_limit') {
          assert([a, b].includes(p.p_identifier));
          assert(['commish_ignored_get', 'commish_ignored_post'].includes(p.p_scope));
          assert.equal(p.p_limit, p.p_scope.endsWith('_get') ? 120 : 60);
          assert.equal(p.p_window_seconds, 60); assert.equal(p.p_lockout_seconds, 0);
          return { data: malformedRate ? { allowed: true } : { allowed: !blocked, count: 1, retryAfterSeconds: 60 }, error: null };
        }
        if (revokeAtWrite && name === 'change_commish_ignored_task') {
          revokeAtWrite = false; await q('update app_users set session_version=session_version+1 where id=$1', [p.p_user_id]);
        }
        try {
          const result = name === 'read_commish_ignored_tasks'
            ? await q('select read_commish_ignored_tasks($1,$2,$3,$4) as result', [p.p_user_id, p.p_session_version, p.p_cursor, p.p_limit])
            : await q('select change_commish_ignored_task($1,$2,$3,$4,$5,$6,$7) as result', [p.p_user_id, p.p_session_version, p.p_task_id, p.p_state, p.p_expected_revision, p.p_operation_id, p.p_snapshot]);
          return { data: result[0].result, error: null };
        } catch (error) { return { data: null, error }; }
      },
    };
    const securityFile = process.env.COMMISH_OWNER_SECURITY
      ? path.relative(path.resolve(__dirname, '..'), path.resolve(process.env.COMMISH_OWNER_SECURITY))
      : 'supabase/functions/_shared/security.ts';
    const security = load(securityFile, { jwtVerify }, ['bearerToken', 'verifyJwtPayload', 'requireActiveAppSession']).context;
    const { handler } = load(endpoint, {
      createClient: () => admin,
      requireActiveAppSession: security.requireActiveAppSession,
      handleOptions: req => req.method === 'OPTIONS' ? new Response('ok') : null,
      json: (_req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    });
    const token = (id, version = 1, extra = {}) => new SignJWT({ app_metadata: { user_id: id, session_version: version }, ...extra })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(id).setIssuedAt().setExpirationTime(extra.exp ?? '1h')
      .sign(new TextEncoder().encode('synthetic-test-value'));
    const ta = await token(a), tb = await token(b);
    const call = async (jwt, body, query = '') => {
      const response = await handler(new Request('https://fixture.invalid/functions/v1/fw-commish-ignored' + query, {
        method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + jwt },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const change = (taskId, state, expectedRevision = 0, extra = {}) => ({ taskId, state, expectedRevision, operationId: randomUUID(), ...extra });
    const snapshot = id => ({ id, headline: 'Set a draft date', detail: 'No draft date is configured.', kind: 'draft_unscheduled', hub: 'ops', domain: 'operations', leagueIds: ['L1'], leagueNames: ['Test league'] });

    await test('private records require a valid signed active account; identity cannot be supplied by the client', async () => {
      assert.equal((await call('', undefined)).status, 401);
      assert.equal((await call(ta.slice(0, -8) + 'tampered', undefined)).status, 401);
      assert.equal((await call(await token(a, 1, { exp: 1 }), undefined)).status, 401);
      assert.equal((await call(ta, change('task-a', 'ignored', 0, { accountId: b }))).status, 400);
      const result = await call(ta, change('task-a', 'ignored', 0, { snapshot: snapshot('task-a') }));
      assert.equal(result.status, 200); assert.equal(result.body.accountId, a); assert.equal(result.body.record.revision, 1);
      assert.equal(result.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual((await call(tb)).body.records, []);
      assert.equal((await call(ta)).body.records[0].taskId, 'task-a');
      assert.equal((await q('select user_id from commish_ignored_tasks'))[0].user_id, a);
    });
    await test('lost-response retries are idempotent, and operation IDs cannot be reused for different payloads', async () => {
      const operation = change('retry-task', 'ignored', 0, { snapshot: snapshot('retry-task') });
      const first = await call(ta, operation), second = await call(ta, operation);
      assert.equal(first.body.duplicate, false); assert.equal(second.body.duplicate, true);
      assert.deepEqual(first.body.record, second.body.record); assert.equal(second.body.appliedRevision, 1);
      for (const patch of [{ taskId: 'different-task', snapshot: snapshot('different-task') }, { state: 'restored' }, { expectedRevision: 1 }, { snapshot: { ...snapshot('retry-task'), headline: 'Changed' } }]) {
        const result = await call(ta, { ...operation, ...patch });
        assert.equal(result.status, 409); assert.equal(result.body.code, 'operation_conflict');
      }
      assert.equal(Number((await q('select count(*) as n from commish_ignored_operations where task_id=$1', ['retry-task']))[0].n), 1);
    });
    await test('Restore tombstones defeat stale device writes and delayed successful ignore retries', async () => {
      const ignore = change('restore-task', 'ignored', 0, { snapshot: snapshot('restore-task') });
      await call(ta, ignore);
      const restored = await call(ta, change('restore-task', 'restored', 1));
      assert.equal(restored.body.record.state, 'restored'); assert.equal(restored.body.record.revision, 2);
      assert.deepEqual(restored.body.record.snapshot, snapshot('restore-task'));
      for (const stale of [change('restore-task', 'ignored', 0), change('restore-task', 'ignored', 1)]) {
        const result = await call(ta, stale); assert.equal(result.status, 409); assert.equal(result.body.code, 'revision_conflict');
        assert.equal(result.body.record.state, 'restored'); assert.equal(result.body.record.revision, 2);
      }
      const retry = await call(ta, ignore);
      assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, true); assert.equal(retry.body.appliedRevision, 1);
      assert.equal(retry.body.record.state, 'restored'); assert.equal(retry.body.record.revision, 2);
      assert((await call(ta)).body.records.some(record => record.taskId === 'restore-task' && record.state === 'restored'));
      const fresh = await call(ta, change('restore-task', 'ignored', 2));
      assert.equal(fresh.body.record.state, 'ignored'); assert.equal(fresh.body.record.revision, 3);
    });
    await test('restoring an absent choice creates a tombstone and same task IDs remain isolated per account', async () => {
      assert.equal((await call(ta, change('never-upload-local', 'restored'))).body.record.revision, 1);
      assert.equal((await call(ta, change('never-upload-local', 'ignored'))).status, 409);
      const firstB = await call(tb, change('task-a', 'restored'));
      assert.equal(firstB.body.record.revision, 1); assert.equal(firstB.body.accountId, b);
      assert.equal((await call(ta)).body.records.find(row => row.taskId === 'task-a').state, 'ignored');
    });
    await test('pagination includes all current choices and tombstones without exposing other accounts', async () => {
      const expected = (await call(ta)).body.records.map(record => record.taskId);
      let cursor, found = [], pages = 0;
      do {
        const page = await call(ta, undefined, '?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        assert.equal(page.status, 200); assert(page.body.records.length <= 2); assert.equal(page.body.accountId, a);
        found.push(...page.body.records.map(record => record.taskId)); cursor = page.body.nextCursor; pages++;
      } while (cursor);
      assert(pages > 1); assert.deepEqual(found, expected); assert.equal(new Set(found).size, expected.length);
    });
    await test('revocation between Edge authentication and SQL write still rejects the stale session', async () => {
      revokeAtWrite = true;
      assert.equal((await call(ta, change('revoked-race', 'ignored'))).status, 401);
      assert.equal((await q('select * from commish_ignored_tasks where task_id=$1', ['revoked-race'])).length, 0);
      assert.equal((await call(ta)).status, 401);
      assert.equal((await call(await token(a, 2))).status, 200);
      await q('update app_users set session_version=1 where id=$1', [a]);
    });
    await test('competing stale operations have one winner; failures roll back both record and receipt', async () => {
      const contenders = await Promise.all([call(ta, change('contended-task', 'ignored')), call(ta, change('contended-task', 'restored'))]);
      assert.deepEqual(contenders.map(result => result.status).sort(), [200, 409]);
      await db.exec("create function isolated_receipt_failure() returns trigger language plpgsql as $$begin raise exception 'isolated failure';end;$$; create trigger isolated_receipt_failure before insert on commish_ignored_operations for each row execute function isolated_receipt_failure();");
      const operation = change('rollback-task', 'ignored');
      assert.equal((await call(ta, operation)).status, 503);
      assert.equal((await q('select * from commish_ignored_tasks where task_id=$1', ['rollback-task'])).length, 0);
      await db.exec('drop trigger isolated_receipt_failure on commish_ignored_operations; drop function isolated_receipt_failure();');
      assert.equal((await call(ta, operation)).body.record.revision, 1);
    });
    await test('malformed requests, oversized metadata, method/rate guards and storage outages never confirm a save', async () => {
      for (const body of [null, [], {}, change('', 'ignored'), change('bad', ['ignored']), change('bad', 'ignored', -1), change('bad', 'ignored', 0, { operationId: 'not-uuid' }), change('bad', 'ignored', 0, { snapshot: snapshot('different') }), change('bad', 'ignored', 0, { snapshot: { id: 'bad', headline: 'x'.repeat(501) } })]) {
        assert.equal((await call(ta, body)).status, 400);
      }
      for (const query of ['?limit=0', '?limit=201', '?limit=1.5', '?cursor=']) assert.equal((await call(ta, undefined, query)).status, 400);
      assert.equal((await call(ta, { large: 'x'.repeat(12001) })).status, 413);
      assert.equal((await handler(new Request('https://fixture.invalid', { method: 'DELETE' }))).status, 405);
      blocked = true; assert.equal((await call(ta, change('rate-task', 'ignored'))).status, 429); blocked = false;
      malformedRate = true; assert.equal((await call(ta, change('rate-task', 'ignored'))).status, 503); malformedRate = false;
      outage = true; const result = await call(ta, change('outage-task', 'ignored')); outage = false;
      assert.equal(result.status, 503); assert(!JSON.stringify(result.body).includes('Isolated failure'));
      assert.equal((await q("select * from commish_ignored_tasks where task_id in ('bad','rate-task','outage-task')")).length, 0);
    });
    await test('raw records, receipts and RPCs deny anon/authenticated; service RPCs work and account deletion cascades', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec('set role ' + role);
        for (const table of ['commish_ignored_tasks', 'commish_ignored_operations']) await assert.rejects(() => q('select * from ' + table), /permission denied/);
        await assert.rejects(() => q('select read_commish_ignored_tasks($1,1)', [a]), /permission denied/);
        await assert.rejects(() => q('select change_commish_ignored_task($1,1,$2,$3,0,$4,null)', [a, 'forged', 'ignored', randomUUID()]), /permission denied/);
        await db.exec('reset role');
      }
      const rls = await q("select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('commish_ignored_tasks','commish_ignored_operations')");
      assert(rls.every(row => row.relrowsecurity && row.relforcerowsecurity));
      await db.exec('set role service_role');
      assert.equal((await q('select read_commish_ignored_tasks($1,1) as result', [a]))[0].result.ok, true);
      await assert.rejects(() => q('select * from commish_ignored_tasks'), /permission denied/);
      await db.exec('reset role');
      await q('delete from app_users where id=$1', [a]);
      assert.equal((await q('select * from commish_ignored_tasks where user_id=$1', [a])).length, 0);
      assert.equal((await q('select * from commish_ignored_operations where user_id=$1', [a])).length, 0);
      assert.equal((await call(tb)).body.records.length, 1);
    });
    console.log(passed + ' isolated authenticated handler/SQL groups passed');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
