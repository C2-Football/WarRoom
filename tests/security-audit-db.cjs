'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./helpers/security-ts-loader.cjs');
(async () => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table app_users(id uuid primary key, updated_at timestamptz);
      create table users(sleeper_username text unique, password_hash text, display_name text, is_gifted boolean);
      grant all on users to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260502020000_security_baseline.sql', 'utf8'));
    const migration = fs.readFileSync('supabase/migrations/20260909000000_security_audit_fixes.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Idempotent deployment retries.
    const [admin, user] = (await q('insert into app_users(id) select gen_random_uuid() from generate_series(1,2) returning id')).map(r => r.id);
    await q("insert into app_user_roles(user_id,role) values($1,'admin')", [admin]);
    const provision = (actor, username, hash = 'synthetic-bcrypt') => q('select provision_gift_password($1,$2,$3,$4) as saved', [actor, username, hash, 'Synthetic owner']);
    await assert.rejects(() => provision(user, 'target'), /Administrator required/);
    assert.equal((await provision(admin, 'target'))[0].saved, true);
    assert.equal((await provision(admin, 'target', 'replacement'))[0].saved, false);
    assert.equal((await q("select password_hash from users where sleeper_username='target'"))[0].password_hash, 'synthetic-bcrypt');
    await q("insert into users(sleeper_username) values('existing-empty')");
    assert.equal((await provision(admin, 'existing-empty'))[0].saved, true);
    const raced = await Promise.all(Array.from({ length: 20 }, (_, i) => provision(admin, 'race-target', 'password-' + i)));
    assert.equal(raced.filter(r => r[0].saved).length, 1);
    console.log('PASS SQL administrator enforcement, existing-user provisioning and exactly one first-password assignment');

    const rate = load('supabase/functions/_shared/security.ts', {}, ['checkRateLimit']).context.checkRateLimit;
    const rpc = async (_name, args) => ({ data: (await q('select consume_auth_rate_limit($1,$2,$3,$4,$5) as result', [args.p_scope, args.p_identifier, args.p_limit, args.p_window_seconds, args.p_lockout_seconds]))[0].result });
    const consume = (id, options = { limit: 8, windowSeconds: 900, lockoutSeconds: 900 }) => rate({ rpc }, 'test', id, options);
    for (let i = 0; i < 7; i++) assert.equal((await consume('near-limit')).allowed, true);
    const requests = await Promise.all(Array.from({ length: 20 }, () => consume('near-limit')));
    assert.equal(requests.filter(r => r.allowed).length, 1);
    assert.equal((await consume('near-limit')).allowed, false);
    assert.equal((await consume('another-user')).allowed, true);
    await q("update auth_rate_limits set window_start=now()-interval '2 hours', locked_until=now()-interval '1 hour' where identifier='near-limit'");
    assert.equal((await consume('near-limit')).count, 1);
    assert.equal((await consume('no-lockout', { limit: 1, windowSeconds: 60 })).allowed, true);
    assert.equal((await consume('no-lockout', { limit: 1, windowSeconds: 60 })).allowed, false);
    await q("update auth_rate_limits set window_start=now()-interval '2 minutes' where identifier='no-lockout'");
    assert.equal((await consume('no-lockout', { limit: 1, windowSeconds: 60 })).allowed, true);
    console.log('PASS actual SQL limit accounting, window reset, lockout and caller isolation (PGlite serializes queries)');

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => provision(admin, 'forged-principal'), /permission denied/);
      await assert.rejects(() => q("select consume_auth_rate_limit('test','forged',8,900,0)"), /permission denied/);
      await assert.rejects(() => q('select * from yahoo_oauth_states'), /permission denied/);
      await assert.rejects(() => q("insert into yahoo_oauth_states(state_hash,owner_key,return_url,expires_at) values('forged','victim','http://localhost',now())"), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await provision(admin, 'trusted-server'))[0].saved, true);
    assert.equal((await consume('service')).allowed, true);
    await q("insert into yahoo_oauth_states(state_hash,owner_key,return_url,expires_at) values('synthetic','app:owner','https://example.invalid',now())");
    assert.equal((await q('select * from yahoo_oauth_states')).length, 1);
    await db.exec('reset role');
    // RLS stays closed if a future migration accidentally grants SELECT.
    await db.exec('grant select on yahoo_oauth_states to authenticated; set role authenticated');
    assert.equal((await q('select * from yahoo_oauth_states')).length, 0);
    await db.exec('reset role');
    console.log('PASS browser roles cannot forge RPC actors, alter rate limits or access OAuth state; trusted server retains access');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
