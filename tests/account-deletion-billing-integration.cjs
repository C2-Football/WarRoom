'use strict';
// Run after integrating billing71d8971, or point READINESS_BILLING_SOURCE at its
// frozen worktree. All SQL runs in disposable local PGlite, never hosted data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const billingRoot=process.env.READINESS_BILLING_SOURCE||path.resolve(__dirname,'..');
(async()=>{
 const db=new PGlite();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;");
  for(const name of ['20260317000000_app_users_and_subscriptions.sql','20260710000000_dhq_pro_billing.sql','20260724000000_gift_grants.sql','20260920010000_billing_event_recovery.sql'])await db.exec(fs.readFileSync(path.join(billingRoot,'supabase/migrations',name),'utf8'));
  await db.exec('alter table app_users add column if not exists session_version integer not null default 1;create table app_user_roles(user_id uuid references app_users(id) on delete cascade,role text);');
  await db.exec(fs.readFileSync('supabase/migrations/20260920040000_account_deletion_recovery.sql','utf8'));
  const [admin,user]=(await q("insert into app_users(email,password_hash) values('delete-admin@example.invalid','fixture'),('delete-owner@example.invalid','fixture') returning id,email"));
  await q("insert into app_user_roles values($1,'admin')",[admin.id]);
  const manifest=Object.fromEntries(['fw-stripe-webhook','fw-revenuecat-webhook','fw-create-checkout','_shared/billing-events.ts'].map(key=>[key,'a'.repeat(64)]));
  await q('select stage_billing_event_cutover($1::jsonb)',[manifest]);
  // Disposable fixture time advancement only. Production must wait its actual
  // cutover timestamp and verify the deployed writer manifest.
  await db.exec("update billing_event_control set activate_after=clock_timestamp()-interval '1 second';select activate_billing_event_processing();");
  let seq=0;
  const apply=async(provider,source,state)=>{
   const event='fixture-deletion-billing-'+(++seq);
   const lease=(await q('select claim_billing_event($1,$2,$3) value',[provider,source,event]))[0].value;
   return(await q('select apply_billing_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',[provider,source,event,lease.lease_token,'2026-09-20T00:00:00Z',user.id,'dhq',state]))[0].value;
  };
  const rc={tier:'pro',status:'active',store:'app_store',rc_app_user_id:user.id,rc_product_id:'fixture.annual',current_period_start:'2026-09-01T00:00:00Z',current_period_end:'2027-09-01T00:00:00Z'};
  const stripe={tier:'pro',status:'active',store:'stripe',stripe_subscription_id:'sub_hidden_integrated',current_period_start:'2026-09-01T00:00:00Z',current_period_end:'2026-10-01T00:00:00Z'};
  await apply('revenuecat','rc_fixture',rc);await apply('stripe','sub_hidden_integrated',stripe);
  assert.equal((await q('select store from subscriptions where user_id=$1',[user.id]))[0].store,'app_store');
  const inspect=async()=>(await q('select inspect_account_deletion($1,1,$2,false) value',[admin.id,user.email]))[0].value;
  const finalize=async snapshot=>(await q('select finalize_account_deletion($1,1,$2,false,$3::jsonb) value',[admin.id,user.email,snapshot]))[0].value;
  const before=await inspect();assert.equal(before.sources.length,2);assert(before.sources.some(s=>s.source_id==='sub_hidden_integrated'));
  await apply('stripe','sub_hidden_integrated',{...stripe,tier:'free',status:'canceled'});
  await assert.rejects(finalize(before),/state changed/);assert.equal((await q('select id from app_users where id=$1',[user.id])).length,1);
  const current=await inspect();assert.equal((await finalize(current)).deletedAppUser,true);
  for(const table of ['subscriptions','billing_subscription_sources','billing_event_receipts'])assert.equal((await q('select count(*)::int n from '+table+' where user_id=$1',[user.id]))[0].n,0);
  await assert.rejects(apply('stripe','sub_hidden_integrated',stripe),/Billing account not found/);
  assert.equal((await q('select id from app_users where id=$1',[admin.id])).length,1);
  console.log('PASS actual frozen billing+deletion SQL: RC-selected aggregate retains hidden Stripe inventory, webhook change forces retry, exact final deletion removes linked sources/receipts, later billing cannot recreate account');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
