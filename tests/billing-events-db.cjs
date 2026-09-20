'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/security-ts-loader.cjs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const sourceState = (extra = {}) => ({ tier: 'pro', status: 'active', store: 'stripe', billing_period: 'monthly', stripe_subscription_id: 'sub_A', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z', cancel_at_period_end: false, ...extra });
let event = 0;
const claim = async (provider, source, id) => (await q('select public.claim_billing_event($1,$2,$3) r', [provider, source, id]))[0].r;
async function apply(user, provider, source, state, opts = {}) {
  const id = opts.id || 'fixture-event-' + (++event);
  const lease = opts.lease || await claim(provider, source, id);
  if (lease.outcome === 'duplicate') return lease;
  return (await q('select public.apply_billing_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb) r', [provider, source, id, lease.lease_token, new Date(opts.at || '2026-09-20T00:00:00Z').toISOString(), user, opts.product || 'dhq', JSON.stringify(state)]))[0].r;
}
(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;");
  for (const name of ['20260317000000_app_users_and_subscriptions.sql', '20260710000000_dhq_pro_billing.sql', '20260724000000_gift_grants.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + name, 'utf8'));
  const [a, b, c] = (await q("insert into app_users(email,password_hash) values('a@example.invalid','x'),('b@example.invalid','x'),('c@example.invalid','x') returning id")).map(row => row.id);
  await q("insert into subscriptions(user_id,product_slug,tier,status,store,billing_period,stripe_subscription_id,current_period_start,current_period_end) values($1,'dhq','pro','active','stripe','monthly','sub_A','2026-09-01','2026-10-01')", [a]);
  await q("insert into subscriptions(user_id,product_slug,tier,status,store,expires_at) values($1,'dhq_gift','pro','active','promotional','2027-01-01')", [a]);
  const before = await q('select user_id,product_slug,tier,status,store,expires_at from subscriptions order by product_slug');
  const migration = fs.readFileSync('supabase/migrations/20260920010000_billing_event_recovery.sql', 'utf8');
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual(await q('select user_id,product_slug,tier,status,store,expires_at from subscriptions order by product_slug'), before, 'migration/replay must preserve existing paid and gift records');
  const manifest=Object.fromEntries(['fw-stripe-webhook','fw-revenuecat-webhook','fw-create-checkout','_shared/billing-events.ts'].map(key=>[key,'a'.repeat(64)]));
  assert.equal((await claim('stripe','pre-activation','pre-activation')).outcome,'paused');
  assert.equal((await q('select count(*)::int n from billing_subscription_sources'))[0].n,0,'staged code cannot track sources while legacy writers may still run');
  await assert.rejects(q('select activate_billing_event_processing()'),/drain window/);
  await assert.rejects(q("select stage_billing_event_cutover('{}'::jsonb)"),/manifest/);
  const staged=(await q('select stage_billing_event_cutover($1::jsonb) until',[JSON.stringify(manifest)]))[0].until;
  assert(new Date(staged).getTime()>Date.now()+400000,'verified source manifest starts at least the old worker maximum duration');
  await assert.rejects(q('select activate_billing_event_processing()'),/drain window/);
  // Test clock advancement only: production must actually wait for the returned timestamp.
  await q("update billing_event_control set activate_after=clock_timestamp()-interval '1 second'");
  assert.equal((await q('select activate_billing_event_processing() enabled'))[0].enabled,true);
  await db.exec(migration); assert.equal((await q('select billing_event_processing_enabled() enabled'))[0].enabled,true,'migration replay must not interrupt active processing');
  console.log('PASS staged rollout starts paused, requires verified writer manifest and full drain, activates once and survives migration replay');
  const row = async user => (await q("select * from subscriptions where user_id=$1 and product_slug='dhq'", [user]))[0];
  const rc = { tier: 'pro', status: 'trialing', store: 'app_store', billing_period: 'annual', rc_app_user_id: a, rc_product_id: 'com.dhqfootball.app.dhq.annual', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2027-09-01T00:00:00Z' };
  assert.equal((await apply(a, 'revenuecat', 'rc_A', rc)).outcome, 'applied');
  assert.equal((await row(a)).store, 'stripe', 'second active store cannot overwrite selected active metadata');
  assert.equal((await q('select count(*)::int n from billing_subscription_sources where user_id=$1', [a]))[0].n, 2);
  await apply(a, 'stripe', 'sub_A', sourceState({ status: 'canceled', tier: 'free' }));
  assert.equal((await row(a)).status, 'trialing'); assert.equal((await row(a)).store, 'app_store');
  assert.equal((await row(a)).stripe_subscription_id, null, 'derived store does not retain a different provider ID');
  await apply(a, 'revenuecat', 'rc_A', { cancel_at_period_end: true }, { at: '2026-09-21' });
  assert.equal((await row(a)).status, 'trialing'); assert.equal((await row(a)).cancel_at_period_end, true);
  const oldPeriod = { ...rc, status: 'canceled', tier: 'free', current_period_start: '2025-09-01', current_period_end: '2026-09-01' };
  assert.equal((await apply(a, 'revenuecat', 'rc_A', oldPeriod, { at: '2026-09-22' })).outcome, 'stale', 'later generation time cannot expire an older period');
  assert.equal((await row(a)).status, 'trialing');
  await apply(a, 'revenuecat', 'rc_A', { ...rc, status: 'canceled', tier: 'free' }, { at: '2027-09-01' });
  assert.equal((await row(a)).tier, 'free');
  assert.equal((await apply(a, 'revenuecat', 'rc_A', rc, { at: '2026-09-20' })).outcome, 'stale');
  assert.equal((await row(a)).tier, 'free');
  assert.equal((await q("select tier from subscriptions where user_id=$1 and product_slug='dhq_gift'", [a]))[0].tier, 'pro', 'billing cancellation cannot touch gifts');
  console.log('PASS actual SQL migration/replay preserves accounts/gifts, provider purchases remain independent, cancellation differs from expiration and old-period events cannot revoke renewals');

  const fixedId = 'duplicate-event';
  await apply(b, 'stripe', 'sub_B', sourceState({ stripe_subscription_id: 'sub_B' }), { id: fixedId });
  const oldLease = await claim('stripe', 'sub_B', 'slow-event');
  assert.equal((await claim('stripe', 'sub_B', 'competing-event')).outcome, 'busy');
  await q("update billing_event_leases set expires_at=clock_timestamp()-interval '1 second' where provider='stripe' and source_id='sub_B'");
  const nextLease = await claim('stripe', 'sub_B', 'new-event');
  await assert.rejects(apply(b, 'stripe', 'sub_B', sourceState({ status: 'canceled', tier: 'free' }), { id: 'slow-event', lease: oldLease }), /lease expired/);
  await apply(b, 'stripe', 'sub_B', sourceState({ stripe_subscription_id: 'sub_B', status: 'trialing' }), { id: 'new-event', lease: nextLease });
  assert.equal((await row(b)).status, 'trialing');
  assert.equal((await claim('stripe', 'sub_B', fixedId)).outcome, 'duplicate');
  assert.equal((await q('select count(*)::int n from billing_event_receipts where event_id=$1', [fixedId]))[0].n, 1);
  const foreign = await claim('stripe', 'sub_B', 'foreign-event');
  await assert.rejects(apply(c, 'stripe', 'sub_B', sourceState({ stripe_subscription_id: 'sub_B' }), { id: 'foreign-event', lease: foreign }), /another account/);
  console.log('PASS event-ID deduplication, serialized observation leases, expired worker denial and purchase/account binding');

  const beforeFailure = await q('select state from billing_subscription_sources where provider=$1 and source_id=$2', ['stripe', 'sub_B']);
  await db.exec("create function reject_billing_write() returns trigger language plpgsql as $$ begin raise exception 'isolated aggregate write failure'; end $$; create trigger fail_billing before update on subscriptions for each row execute function reject_billing_write();");
  await q("update billing_event_leases set expires_at=clock_timestamp()-interval '1 second' where provider='stripe' and source_id='sub_B'");
  const failureLease = await claim('stripe', 'sub_B', 'retry-event');
  await assert.rejects(apply(b, 'stripe', 'sub_B', sourceState({ stripe_subscription_id: 'sub_B', status: 'canceled', tier: 'free' }), { id: 'retry-event', lease: failureLease }), /aggregate write failure/);
  assert.deepEqual(await q('select state from billing_subscription_sources where provider=$1 and source_id=$2', ['stripe', 'sub_B']), beforeFailure);
  assert.equal((await q("select count(*)::int n from billing_event_receipts where event_id='retry-event'"))[0].n, 0);
  await db.exec('drop trigger fail_billing on subscriptions;');
  await apply(b, 'stripe', 'sub_B', sourceState({ stripe_subscription_id: 'sub_B', status: 'canceled', tier: 'free' }), { id: 'retry-event', lease: failureLease });
  assert.equal((await row(b)).tier, 'free');
  console.log('PASS injected aggregate failure rolls back source and receipt; same event safely retries');

  await q("insert into subscriptions(user_id,product_slug,tier,status,store,rc_app_user_id,rc_product_id,rc_last_event_at,current_period_start,current_period_end) values($1,'dhq','pro','active','app_store',$2,'monthly','2026-09-10','2026-09-01','2026-10-01')", [c, c]);
  const legacyEnd = { tier: 'free', status: 'canceled', store: 'app_store', rc_app_user_id: c, rc_product_id: 'monthly', current_period_start: '2026-08-01', current_period_end: '2026-09-01' };
  assert.equal((await apply(c, 'revenuecat', 'old-original', legacyEnd, { at: '2026-09-20' })).outcome, 'legacy_preserved');
  assert.equal((await row(c)).tier, 'pro', 'unknown legacy period cannot be revoked by another transaction');
  await apply(c, 'revenuecat', 'current-original', { ...legacyEnd, current_period_start: '2026-09-01', current_period_end: '2026-10-01' }, { at: '2026-10-01' });
  assert.equal((await row(c)).tier, 'free', 'matching known store/product/period can complete its lifecycle');
  assert.equal((await q('select count(*)::int n from billing_subscription_sources where user_id=$1 and legacy and superseded_by is null', [c]))[0].n, 0);
  const [e] = (await q("insert into app_users(email,password_hash) values('e@example.invalid','x') returning id")).map(record=>record.id);
  await q("insert into subscriptions(user_id,product_slug,tier,status,store,rc_app_user_id,rc_product_id,rc_last_event_at,current_period_start,current_period_end) values($1,'dhq','pro','active','app_store',$2,'monthly','2026-09-10','2026-09-01','2026-10-01')", [e,e]);
  await apply(e,'revenuecat','previously-ambiguous',{...legacyEnd,rc_app_user_id:e},{at:'2026-09-20'});
  await apply(e,'revenuecat','previously-ambiguous',{...legacyEnd,rc_app_user_id:e,tier:'pro',status:'active',current_period_start:'2026-10-01',current_period_end:'2026-11-01'},{at:'2026-10-01'});
  await apply(e,'revenuecat','previously-ambiguous',{...legacyEnd,rc_app_user_id:e,current_period_start:'2026-10-01',current_period_end:'2026-11-01'},{at:'2026-11-01'});
  assert.equal((await row(e)).tier,'free','an earlier ambiguous source cannot prevent later verified legacy reconciliation');
  assert.equal((await q('select count(*)::int n from billing_subscription_sources where user_id=$1 and legacy and superseded_by is not null',[e]))[0].n,1,'reconciled legacy snapshot is retained as evidence');
  const [f] = (await q("insert into app_users(email,password_hash) values('f@example.invalid','x') returning id")).map(record=>record.id);
  const unknownCancel={store:'app_store',rc_product_id:'monthly',rc_app_user_id:f,cancel_at_period_end:true,current_period_start:'2020-01-01',current_period_end:'2020-02-01'};
  await apply(f,'revenuecat','negative-only',unknownCancel);
  assert.equal((await row(f)).tier,'free'); assert.equal((await row(f)).status,'incomplete','unknown old cancellation never invents access');
  await apply(f,'revenuecat','negative-only',{...unknownCancel,status:'active',tier:'pro',cancel_at_period_end:false},{at:'2020-01-01'});
  assert.equal((await row(f)).tier,'free','replayed expired purchase cannot fill unknown current entitlement');
  await apply(f,'revenuecat','cancel-before-purchase',{...unknownCancel,current_period_start:'2026-09-01',current_period_end:'2027-09-01'},{at:'2026-09-20'});
  await apply(f,'revenuecat','cancel-before-purchase',{...unknownCancel,current_period_start:'2026-09-01',current_period_end:'2027-09-01',status:'active',tier:'pro',cancel_at_period_end:false},{at:'2026-09-01'});
  assert.equal((await row(f)).tier,'pro'); assert.equal((await row(f)).cancel_at_period_end,true,'out-of-order current purchase fills pending access but retains later cancellation');
  assert.equal((await apply(f,'revenuecat','cancel-before-purchase',{...unknownCancel,current_period_start:'2026-09-01',current_period_end:'2027-09-01',status:'active',tier:'pro',cancel_at_period_end:false},{at:'2026-09-10'})).outcome,'stale');
  assert.equal((await row(f)).cancel_at_period_end,true,'middle-time positive cannot overwrite later cancellation watermark');
  assert.equal(new Date((await q("select event_at from billing_subscription_sources where source_id='cancel-before-purchase'"))[0].event_at).toISOString(),'2026-09-20T00:00:00.000Z');

  console.log('PASS legacy RevenueCat bootstrap retains ambiguous purchase with explicit outcome and accepts matching period expiration');

  // Actual production handlers + shared event helper + actual SQL, with only
  // Stripe/RevenueCat transport and account lookups controlled locally.
  const billingHelper = load('supabase/functions/_shared/billing-events.ts', { console: { ...console, warn() {} } }).context;
  const admin = {
    async rpc(name, args) {
      try {
        if (name === 'claim_billing_event') return { data: await claim(args.p_provider, args.p_source_id, args.p_event_id) };
        assert.equal(name, 'apply_billing_event');
        const result = (await q('select public.apply_billing_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb) r', [args.p_provider,args.p_source_id,args.p_event_id,args.p_lease_token,args.p_event_at,args.p_user_id,args.p_product_slug,JSON.stringify(args.p_state)]))[0].r;
        return { data: result };
      } catch (error) { return { error }; }
    },
    from(table) {
      const filters=[];
      return { select() { return this; }, eq(k,v) { filters.push([k,v]);return this; }, async maybeSingle() {
        assert.equal(table, 'app_users'); assert.equal(filters[0][0], 'id');
        return { data: (await q('select id from app_users where id=$1',[filters[0][1]]))[0] };
      } };
    },
  };
  const [d] = (await q("insert into app_users(email,password_hash) values('d@example.invalid','x') returning id")).map(record=>record.id);
  let currentStatus='active', delayed=null, entered=null, reads=0;
  const subscription={ id:'sub_D',metadata:{user_id:d,product_slug:'dhq'},items:{data:[{price:{id:'fixture-price',recurring:{interval:'month'}}}]},current_period_start:1790000000,current_period_end:1792592000,cancel_at_period_end:false };
  class Stripe {
    webhooks={ constructEventAsync:async body=>JSON.parse(body) };
    subscriptions={ retrieve:async()=>{ reads++; if(entered) entered(); if(delayed) await delayed; return {...subscription,status:currentStatus}; } };
  }
  const common={ createClient:()=>admin,claimBillingEvent:billingHelper.claimBillingEvent,applyBillingEvent:billingHelper.applyBillingEvent,billingWriterResponse:billingHelper.billingWriterResponse,console:{...console,error(){},warn(){}} };
  const stripeHandler=load('supabase/functions/fw-stripe-webhook/index.ts',{...common,Stripe}).handler;
  const stripeRequest=(id,type='customer.subscription.updated')=>new Request('https://example.invalid/stripe',{method:'POST',body:JSON.stringify({id,type,created:1790000000,data:{object:{...subscription,status:'canceled'}}})});
  let release;
  delayed=new Promise(resolve=>{release=resolve;}); const reached=new Promise(resolve=>{entered=resolve;});
  const pending=stripeHandler(stripeRequest('same-second-first')); await reached;
  assert.equal((await stripeHandler(stripeRequest('same-second-second'))).status,500,'second worker retries while first current-object observation owns lease');
  release(); assert.equal((await pending).status,200); delayed=null;entered=null;
  currentStatus='trialing'; assert.equal((await stripeHandler(stripeRequest('same-second-second'))).status,200);
  assert.equal((await row(d)).status,'trialing','different same-second event uses current Stripe state');
  currentStatus='active'; assert.equal((await stripeHandler(stripeRequest('late-delete','customer.subscription.deleted'))).status,200);
  assert.equal((await row(d)).status,'active','late deleted snapshot cannot override currently active provider object');
  const priorReads=reads; assert.equal((await stripeHandler(stripeRequest('same-second-first'))).status,200); assert.equal(reads,priorReads,'duplicate receipt does not reapply earlier event');
  console.log('PASS actual Stripe handler/helper/SQL: same-second distinct events, delayed concurrent observation, retry, late snapshot and duplicate handling');

  let rcHandler;
  load('supabase/functions/fw-revenuecat-webhook/index.ts',{...common,Deno:{env:{get:key=>key==='REVENUECAT_WEBHOOK_AUTH'?'fixture-auth':'fixture'},serve:fn=>{rcHandler=fn;}}});
  const rcEvent={id:'rc-integrated-renewal',type:'RENEWAL',app_user_id:d,original_transaction_id:'original_D',environment:'PRODUCTION',store:'APP_STORE',product_id:'com.dhqfootball.app.dhq.annual',period_type:'TRIAL',event_timestamp_ms:1790000000000,purchased_at_ms:1789000000000,expiration_at_ms:1820536000000};
  const rcRequest=event=>new Request('https://example.invalid/rc',{method:'POST',headers:{Authorization:'fixture-auth'},body:JSON.stringify({event})});
  assert.equal((await rcHandler(rcRequest(rcEvent))).status,200);
  currentStatus='canceled'; assert.equal((await stripeHandler(stripeRequest('stripe-current-expiration'))).status,200);
  assert.equal((await row(d)).status,'trialing'); assert.equal((await row(d)).store,'app_store');
  assert.equal((await rcHandler(rcRequest({...rcEvent,id:'old-period-late-expiry',type:'EXPIRATION',event_timestamp_ms:1791000000000,purchased_at_ms:1757464000000,expiration_at_ms:1789000000000}))).status,200);
  assert.equal((await row(d)).status,'trialing');
  assert.equal((await rcHandler(rcRequest(rcEvent))).status,200);
  assert.equal((await q("select count(*)::int n from billing_event_receipts where event_id='rc-integrated-renewal'"))[0].n,1);
  console.log('PASS actual RevenueCat handler/helper/SQL: renewal survives another store cancellation and late prior-period expiration; retries deduplicate');

  const pausedLease=await claim('stripe','paused-worker','paused-worker');
  const savedReceipts=(await q('select count(*)::int n from billing_event_receipts'))[0].n;
  await q('select pause_billing_event_processing()');
  await assert.rejects(apply(d,'stripe','paused-worker',sourceState({stripe_subscription_id:'paused-worker'}),{id:'paused-worker',lease:pausedLease}),/paused/);
  assert.equal((await q('select count(*)::int n from billing_event_receipts'))[0].n,savedReceipts);
  await assert.rejects(q('select activate_billing_event_processing()'),/drain window/);
  await q('select stage_billing_event_cutover($1::jsonb)',[JSON.stringify(manifest)]);
  await q("update billing_event_control set activate_after=clock_timestamp()-interval '1 second'");
  await q('select activate_billing_event_processing()');
  console.log('PASS emergency pause preserves receipts/sources, rejects in-flight application, and requires restaging/drain before recovery');
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(q("select public.claim_billing_event('stripe','forbidden','forbidden')"), /permission denied/);
    await assert.rejects(q('select * from billing_subscription_sources'), /permission denied/);
    await assert.rejects(q('select activate_billing_event_processing()'), /permission denied/);
    await assert.rejects(q('select pause_billing_event_processing()'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await claim('stripe', 'service', 'service')).outcome, 'claimed');
  await db.exec('reset role');
  console.log('PASS browser roles cannot read private billing state or invoke billing RPCs; service role is allowed');
  console.log('PGlite executes actual PostgreSQL; it serializes connections. Lease race and rollback cases are real SQL but not independent hosted-connection evidence.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
