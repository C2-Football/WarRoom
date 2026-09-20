'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration='supabase/migrations/20260920040000_account_deletion_recovery.sql';
(async()=>{
 const db=new PGlite();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table app_users(id uuid primary key default gen_random_uuid(),email text unique not null,session_version integer not null default 1);
   create table app_user_roles(user_id uuid references app_users(id) on delete cascade,role text);
   create table subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid references app_users(id) on delete cascade,product_slug text,status text,store text,stripe_subscription_id text);
   create table billing_subscription_sources(provider text,source_id text,user_id uuid references app_users(id) on delete cascade,product_slug text,state jsonb,primary key(provider,source_id));
   create table controlled_saves(user_id uuid references app_users(id) on delete cascade,state text);`);
  await db.exec(fs.readFileSync(migration,'utf8'));await db.exec(fs.readFileSync(migration,'utf8'));
  const create=async email=>(await q('insert into app_users(email) values($1) returning *',[email]))[0];
  const admin=await create('admin@example.invalid'),target=await create('target@example.invalid'),other=await create('other@example.invalid');
  await q("insert into app_user_roles values($1,'admin')",[admin.id]);
  await q("insert into controlled_saves values($1,'retained target'),($2,'unrelated save')",[target.id,other.id]);
  const read=async(actor,who,self=false)=>(await q('select inspect_account_deletion($1,$2,$3,$4) as value',[actor.id,actor.session_version,who.email,self]))[0].value;
  const finish=async(actor,who,snapshot,self=false)=>(await q('select finalize_account_deletion($1,$2,$3,$4,$5) as value',[actor.id,actor.session_version,who.email,self,snapshot]))[0].value;
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(read(target,target,true),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');await assert.rejects(read(other,target),/Administrator authorization required/);await assert.rejects(read(admin,admin),/self-service deletion/);await assert.rejects(read(target,other,true),/identity changed/);
  let snapshot=await read(admin,target);await db.exec('reset role');
  await q('update app_users set session_version=2 where id=$1',[target.id]);
  await assert.rejects(finish(admin,target,snapshot),/state changed/);await q('update app_users set session_version=1 where id=$1',[target.id]);
  console.log('PASS actual deletion SQL service-only grants, self/admin authorization and target version guard');
  snapshot=await read(target,target,true);await q('update app_users set session_version=2 where id=$1',[target.id]);
  await assert.rejects(finish(target,target,snapshot,true),/authorization changed/);await q('update app_users set session_version=1 where id=$1',[target.id]);
  snapshot=await read(admin,target);await q("insert into app_user_roles values($1,'owner')",[target.id]);await assert.rejects(finish(admin,target,snapshot),/Administrator accounts/);await q('delete from app_user_roles where user_id=$1',[target.id]);
  snapshot=await read(admin,target);await q('delete from app_user_roles where user_id=$1',[admin.id]);await assert.rejects(finish(admin,target,snapshot),/Administrator authorization required/);await q("insert into app_user_roles values($1,'admin')",[admin.id]);
  console.log('PASS actual SQL refuses stale self session, newly protected target and revoked administrator');
  await q("insert into subscriptions(user_id,product_slug,status,store) values($1,'dhq','active','app_store')",[target.id]);
  snapshot=await read(admin,target);await q("insert into billing_subscription_sources values('stripe','sub_hidden',$1,'dhq','{\"status\":\"active\"}')",[target.id]);
  await assert.rejects(finish(admin,target,snapshot),/state changed/);snapshot=await read(admin,target);assert.equal(snapshot.sources[0].source_id,'sub_hidden');
  await q("update billing_subscription_sources set state='{\"status\":\"canceled\"}' where source_id='sub_hidden'");await assert.rejects(finish(admin,target,snapshot),/state changed/);
  console.log('PASS actual SQL inventories hidden provider sources and refuses billing changes before cascade');
  snapshot=await read(admin,target);await q('delete from app_users where id=$1',[target.id]);const replacement=await create(target.email);await q("insert into controlled_saves values($1,'new account save')",[replacement.id]);
  await assert.rejects(finish(admin,target,snapshot),/state changed/);assert.equal((await q('select state from controlled_saves where user_id=$1',[replacement.id]))[0].state,'new account save');
  const absent={email:'orphan@example.invalid'};snapshot=await read(admin,absent);const appeared=await create(absent.email);await assert.rejects(finish(admin,absent,snapshot),/state changed/);assert.equal((await q('select id from app_users where id=$1',[appeared.id])).length,1);
  console.log('PASS actual SQL never erases a replaced or newly created account under the same email');
  snapshot=await read(admin,replacement);const result=await finish(admin,replacement,snapshot);assert.equal(result.deletedAppUser,true);assert.equal((await q('select * from controlled_saves where user_id=$1',[replacement.id])).length,0);assert.equal((await q('select state from controlled_saves where user_id=$1',[other.id]))[0].state,'unrelated save');
  console.log('PASS actual SQL final deletion cascades only the exact unchanged target and preserves unrelated account saves; independent-connection contention not exercised');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
