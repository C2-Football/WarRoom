'use strict';
// Execute the actual catalog fingerprint query against disposable PostgreSQL.
// Prove body/RLS/column changes cannot hide behind an unchanged migration row.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const crypto=require('node:crypto');
const result=spawnSync('python3',['-c',"import runpy;print(runpy.run_path('scripts/c2-edge-release.py')['SCHEMA_QUERY'])"],{encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
const query=result.stdout;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role authenticated;create table app_users(id uuid primary key,email text,session_version int default 1);create table duat_campaigns(id uuid primary key,state jsonb);create table time_leagues(id uuid primary key,state jsonb);create function public.controlled_guard() returns boolean language sql as $$select true$$;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);insert into supabase_migrations.schema_migrations values('20260918020000');`);
  const snapshot=async()=>(await db.query(query)).rows[0].schema;
  const baseline=await snapshot();assert(baseline.relations.some(r=>r.name==='app_users'));assert(baseline.relations.some(r=>r.name==='time_leagues'));assert(baseline.routines.some(r=>r.signature.includes('controlled_guard')));
  await db.exec('alter table duat_campaigns enable row level security;create policy controlled_private on duat_campaigns to authenticated using(false);');
  const privateState=await snapshot();assert.notEqual(hash(privateState),hash(baseline));
  await db.exec('alter policy controlled_private on duat_campaigns using(true);');assert.notEqual(hash(await snapshot()),hash(privateState));
  console.log('PASS actual fixed catalog query detects game RLS/policy weakening without reading user records');
  let before=await snapshot();await db.exec('alter table app_users add column revoked boolean not null default false;');assert.notEqual(hash(await snapshot()),hash(before));
  before=await snapshot();await db.exec('create or replace function public.controlled_guard() returns boolean language sql as $$select false$$;');assert.notEqual(hash(await snapshot()),hash(before));
  assert.equal((await db.query('select version from supabase_migrations.schema_migrations')).rows[0].version,'20260918020000');
  console.log('PASS account shape and routine body changes invalidate compatibility even with the same recorded migration');
  before=await snapshot();await db.exec('grant select on time_leagues to authenticated;');assert.notEqual(hash(await snapshot()),hash(before));
  before=await snapshot();await db.exec('grant select(state) on duat_campaigns to authenticated;');assert.notEqual(hash(await snapshot()),hash(before));
  before=await snapshot();await db.exec('create index controlled_campaign_state on duat_campaigns((state::text));');assert.notEqual(hash(await snapshot()),hash(before));
  console.log('PASS unexpected table/column grants and indexes change the fingerprint; no migration or provider operation was executed');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
