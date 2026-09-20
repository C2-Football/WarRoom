'use strict';
// Actual checkout and deletion migrations, disposable local SQL only. Point
// READINESS_CHECKOUT_SOURCE at the reviewed checkout worktree before integration.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const billingRoot=process.env.READINESS_CHECKOUT_SOURCE||path.resolve(__dirname,'..');
(async()=>{
 const db=new PGlite();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;");
  for(const name of ['20260317000000_app_users_and_subscriptions.sql','20260710000000_dhq_pro_billing.sql','20260724000000_gift_grants.sql','20260920010000_billing_event_recovery.sql','20260920050000_billing_checkout_recovery.sql'])await db.exec(fs.readFileSync(path.join(billingRoot,'supabase/migrations',name),'utf8'));
  await db.exec('alter table app_users add column if not exists session_version integer not null default 1;create table app_user_roles(user_id uuid references app_users(id) on delete cascade,role text);');
  for(const name of ['20260920040000_account_deletion_recovery.sql','20260920060000_account_deletion_checkouts.sql','20260920060000_account_deletion_checkouts.sql'])await db.exec(fs.readFileSync(path.join('supabase/migrations',name),'utf8'));
  const [admin,user,other]=await q("insert into app_users(email,password_hash) values('checkout-delete-admin@example.invalid','fixture'),('checkout-delete-owner@example.invalid','fixture'),('checkout-delete-unrelated@example.invalid','fixture') returning id,email");
  await q("insert into app_user_roles values($1,'admin')",[admin.id]);
  await q("update app_users set stripe_customer_id='cus_checkout_owner' where id=$1",[user.id]);
  const manifest=Object.fromEntries(['fw-stripe-webhook','fw-revenuecat-webhook','fw-create-checkout','_shared/billing-events.ts','_shared/billing-checkout.ts'].map(key=>[key,'a'.repeat(64)]));
  await q('select stage_billing_event_cutover($1::jsonb)',[manifest]);
  await db.exec("update billing_event_control set activate_after=clock_timestamp()-interval '1 second';select activate_billing_event_processing();");
  const request={customer:'cus_checkout_owner',price:'price_fixture',billing:'monthly',success_url:'https://example.invalid/success',cancel_url:'https://example.invalid/cancel'};
  const read=async()=>(await q('select inspect_account_deletion($1,1,$2,false) value',[admin.id,user.email]))[0].value;
  const finish=async snapshot=>(await q('select finalize_account_deletion($1,1,$2,false,$3::jsonb) value',[admin.id,user.email,snapshot]))[0].value;
  const claim=async()=>(await q("select claim_billing_checkout($1,'dhq',$2::jsonb) value",[user.id,request]))[0].value;
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(read(),/permission denied/);await assert.rejects(q('select * from billing_checkout_attempts'),/permission denied/);await db.exec('reset role');}
  let snapshot=await read();assert.equal(snapshot.target.stripe_customer_id,request.customer);assert.deepEqual(snapshot.checkout_attempts,[]);
  const leased=await claim();assert.equal(leased.outcome,'claimed');await assert.rejects(finish(snapshot),/state changed/);
  snapshot=await read();assert.equal(snapshot.checkout_attempts[0].attempt_id,leased.attempt_id);assert.equal(snapshot.checkout_attempts[0].session_id,null);assert.equal(snapshot.checkout_attempts[0].request.price,request.price);
  await assert.rejects(finish(snapshot),/Checkout is still running/);
  console.log('PASS actual checkout/deletion SQL: private inventory, full unknown-attempt snapshot, competing claim and active lease prevent deletion');
  await q("select checkpoint_billing_checkout($1,'dhq',$2,'cs_known',null)",[user.id,leased.lease_token]);await assert.rejects(finish(snapshot),/state changed/);
  snapshot=await read();await q("select release_billing_checkout($1,'dhq',$2)",[user.id,leased.lease_token]);await assert.rejects(finish(snapshot),/state changed/);
  snapshot=await read();const again=await claim();
  await q("select checkpoint_billing_checkout($1,'dhq',$2,'cs_known',$3::jsonb)",[user.id,again.lease_token,{...request,billing:'annual'}]);await assert.rejects(finish(snapshot),/state changed/);
  await q("select checkpoint_billing_checkout($1,'dhq',$2,'cs_new',null)",[user.id,again.lease_token]);await q("select release_billing_checkout($1,'dhq',$2)",[user.id,again.lease_token]);
  console.log('PASS actual checkout checkpoint, unlock and rotated attempt invalidate the previous deletion snapshot');
  snapshot=await read();await q("update app_users set stripe_customer_id='cus_rebound' where id=$1",[user.id]);await assert.rejects(finish(snapshot),/state changed/);
  await q("update app_users set stripe_customer_id='cus_checkout_owner' where id=$1",[user.id]);
  await q("insert into billing_checkout_attempts(user_id,product_slug,request) values($1,'dhq','{}')",[other.id]);
  snapshot=await read();assert.equal((await finish(snapshot)).deletedAppUser,true);
  assert.equal((await q('select count(*)::int n from billing_checkout_attempts where user_id=$1',[user.id]))[0].n,0);
  assert.equal((await q('select count(*)::int n from billing_checkout_attempts where user_id=$1',[other.id]))[0].n,1);
  await assert.rejects(claim(),/Billing account unavailable/);
  console.log('PASS actual customer binding change blocks deletion; confirmed exact cascade removes only target attempts, later checkout cannot recreate deleted account');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
