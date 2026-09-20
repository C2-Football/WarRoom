'use strict';
const assert = require('node:assert/strict');
const load = require('./helpers/security-ts-loader.cjs');
const vm = require('node:vm');
const checkoutHelper = load('supabase/functions/_shared/billing-checkout.ts').context;
const CheckoutRecoveryError = vm.runInContext('CheckoutRecoveryError', checkoutHelper);
let latestCheckout;
const checkoutResult = args => (latestCheckout = { id: 'checkout', customer: args.customer, mode: 'subscription', metadata: args.metadata, status: 'open', url: 'https://checkout.stripe.com/c/pay/fixture' });
const billing = load('supabase/functions/_shared/billing-events.ts').context;
const uid = '11111111-1111-4111-8111-111111111111';
const failure = { data: null, error: { message: 'isolated database outage', code: 'XX000' } };
const audits = [];
function database(respond) {
  const calls = [];
  let checkoutAttempt;
  return { calls, async rpc(name, args) {
    if (name === 'claim_billing_checkout') {
      checkoutAttempt ||= { outcome: 'claimed', attempt_id: crypto.randomUUID(), lease_token: crypto.randomUUID(), request: args.p_request, created_at: new Date().toISOString() };
      return { data: checkoutAttempt };
    }
    if (name === 'checkpoint_billing_checkout') return { data: { ...checkoutAttempt, outcome: 'saved', session_id: args.p_session_id } };
    if (name === 'release_billing_checkout') return { data: null };
    if (name === 'billing_event_processing_enabled') return { data: true, error: null };
    if (name === 'claim_billing_event') return { data: { outcome: 'claimed', lease_token: '11111111-1111-4111-8111-111111111112' }, error: null };
    assert.equal(name, 'apply_billing_event');
    const call = { table: 'subscriptions', operation: 'upsert', data: args.p_state, args }; calls.push(call);
    const result = await respond(call);
    return result.error ? result : { data: { outcome: 'applied' }, error: null };
  }, from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const query = {
      select(fields) { call.select = fields; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      in(key, value) { call.filters.push([key, value]); return query; },
      update(data) { call.operation = 'update'; call.data = data; return query; },
      upsert(data, options) { call.operation = 'upsert'; call.data = data; call.options = options; return query; },
      single() { return query; }, maybeSingle() { return query; },
      then(resolve, reject) { return Promise.resolve(respond(call)).then(resolve, reject); },
    };
    return query;
  } };
}
function handler(slug, globals = {}, values = {}) {
  let fn;
  load('supabase/functions/' + slug + '/index.ts', {
    recoverCheckout: checkoutHelper.recoverCheckout, CheckoutRecoveryError,
    claimBillingEvent: billing.claimBillingEvent, applyBillingEvent: billing.applyBillingEvent,
    billingWriterResponse: billing.billingWriterResponse, billingProcessingEnabled: billing.billingProcessingEnabled,
    handleOptions: () => null, requireActiveAppSession: async () => ({ userId: uid, email: 'billing@example.invalid' }),
    checkRateLimit: async () => ({ allowed: true }), clientIp: () => 'isolated-fixture',
    auditEvent: async (...args) => audits.push(args),
    json: (_req, body, status = 200) => new Response(JSON.stringify(body), { status }),
    console: { ...console, error() {}, warn() {} },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.supabase.co', REVENUECAT_WEBHOOK_AUTH: 'test-secret', STRIPE_PRICE_DHQ_MONTHLY: 'monthly-fixture', STRIPE_PRICE_DHQ_ANNUAL: 'annual-fixture', ...values }[key] || '') }, serve: value => { fn = value; } },
    ...globals,
  });
  return fn;
}
const request = (body = {}, headers = {}) => new Request('https://example.invalid/billing', { method: 'POST', body: JSON.stringify(body), headers });
const subscription = { id: 'sub_fixture', status: 'trialing', metadata: { user_id: uid, product_slug: 'dhq' }, items: { data: [{ price: { id: 'price_fixture', recurring: { interval: 'year' } } }] }, current_period_start: 1, current_period_end: 2, cancel_at_period_end: false };
(async () => {
  for (const type of ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed']) {
    const event = { id: 'stripe-event-fixture', created: 1700000000, type, data: { object: type === 'checkout.session.completed' ? { mode: 'subscription', subscription: subscription.id } : type === 'invoice.payment_failed' ? { subscription: subscription.id } : subscription } };
    class Stripe { webhooks = { constructEventAsync: async () => event }; subscriptions = { retrieve: async () => subscription }; }
    for (const fail of [true, false]) {
      const db = database(call => call.operation ? fail ? failure : { data: { id: 'saved' }, error: null } : { data: { id: 'saved' }, error: null });
      const response = await handler('fw-stripe-webhook', { createClient: () => db, Stripe })(request());
      assert.equal(response.status, fail ? 500 : 200, type + ' must retry failed writes');
      if (!fail && type === 'checkout.session.completed') {
        assert.equal(db.calls[0].data.status, 'trialing'); assert.equal(db.calls[0].data.store, 'stripe'); assert.equal(db.calls[0].data.billing_period, 'annual');
      }
    }
    if (type === 'customer.subscription.updated') {
      assert.equal((await handler('fw-stripe-webhook', { createClient: () => database(() => failure), Stripe })(request())).status, 500);
    }
  }
  console.log('PASS actual Stripe lifecycle handlers reject failed writes/lookups, retry succeeds, existing trial/annual/store contract remains');

  const event = { id: 'rc-event-fixture', original_transaction_id: 'original-fixture', environment: 'PRODUCTION', app_user_id: uid, product_id: 'com.dhqfootball.app.dhq.monthly', store: 'APP_STORE', event_timestamp_ms: 2000, purchased_at_ms: 1000, expiration_at_ms: 3000 };
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE']) {
    for (const fail of [true, false]) {
      const db = database(call => call.table === 'app_users' ? { data: { id: uid }, error: null } : fail ? failure : { data: { id: 'saved' }, error: null });
      const response = await handler('fw-revenuecat-webhook', { createClient: () => db })(request({ event: { ...event, type } }, { Authorization: 'test-secret' }));
      assert.equal(response.status, fail ? 500 : 200, type + ' must retry failed writes');
      if (!fail && type === 'CANCELLATION') assert.equal(db.calls[1].data.status, undefined, 'cancellation must retain access until expiration');
    }
  }
  const rc = handler('fw-revenuecat-webhook', { createClient: () => database(() => failure) });
  assert.equal((await rc(request({ event: { ...event, type: 'RENEWAL' } }, { Authorization: 'test-secret' }))).status, 500, 'outage is not an unknown account');
  assert.equal((await rc(request({ event: { ...event, type: 'RENEWAL' } }, { Authorization: 'wrong' }))).status, 401);
  let transferReads=0;
  const transferHandler=handler('fw-revenuecat-webhook',{createClient:()=>database(()=>{transferReads++;return failure;})});
  const transfer={type:'TRANSFER',id:'transfer-fixture',transferred_from:[uid],transferred_to:['22222222-2222-4222-8222-222222222222']};
  assert.equal((await transferHandler(request({event:transfer},{Authorization:'test-secret'}))).status,503,'unverified transfer must remain retryable instead of acknowledged as unknown subscriber');
  assert.equal(transferReads,0,'transfer identity arrays cannot revoke or move all existing purchases');
  assert.equal((await transferHandler(request({event:transfer},{Authorization:'wrong'}))).status,401);
  console.log('PASS actual RevenueCat lifecycle writes and account queries retry on failure, cancellation preserves access, invalid signature denied');

  for (const slug of ['fw-create-checkout', 'fw-billing-portal']) {
    let externalCalls = 0;
    class Stripe {
      subscriptions = { list: async () => ({ data: [], has_more: false }) };
      customers = { create: async () => { externalCalls++; return { id: 'customer' }; } };
      checkout = { sessions: { retrieve: async () => latestCheckout, list: async () => ({ data: [], has_more: false }), create: async args => { externalCalls++; return checkoutResult(args); } } };
      billingPortal = { sessions: { create: async () => { externalCalls++; return { id: 'portal', url: 'https://example.invalid/portal' }; } } };
    }
    assert.equal((await handler(slug, { createClient: () => database(() => failure), Stripe })(request())).status, 503);
    assert.equal(externalCalls, 0, 'failed account lookup must not create a customer/session');
    for (const origin of ['https://dhqfootball.com', 'https://www.dhqfootball.com', 'https://c2-football.github.io']) {
      const db = database(() => ({ data: { stripe_customer_id: 'customer' }, error: null }));
      const response = await handler(slug, { createClient: () => db, Stripe }, { APP_ALLOWED_ORIGINS: 'https://additional.example.invalid' })(request({ returnUrl: origin + '/settings.html', successUrl: origin + '/checkout-success.html', cancelUrl: origin + '/landing.html' }));
      assert.equal(response.status, 200, slug + ' must preserve established origin ' + origin);
    }
    const before = externalCalls;
    assert.equal((await handler(slug, { createClient: () => database(() => ({})), Stripe })(request({ returnUrl: 'https://attacker.invalid', successUrl: 'https://attacker.invalid' }))).status, 400);
    assert.equal(externalCalls, before, 'invalid redirect must not create session');
  }
  const fallbackCalls=[];
  class FallbackStripe {
    subscriptions = { list: async () => ({ data: [], has_more: false }) };
    checkout={sessions:{retrieve:async()=>latestCheckout,list:async()=>({data:[],has_more:false}),create:async args=>{fallbackCalls.push(args);return checkoutResult(args);}}};
    billingPortal={sessions:{create:async args=>{fallbackCalls.push(args);return{id:'fixture',url:'https://example.invalid/portal'};}}};
  }
  const fallbackDB=()=>database(()=>({data:{stripe_customer_id:'customer'},error:null}));
  assert.equal((await handler('fw-create-checkout',{createClient:fallbackDB,Stripe:FallbackStripe})(request())).status,200);
  assert.equal(fallbackCalls[0].success_url,'https://dhqfootball.com/upgrade.html?payment=success');
  assert.equal(fallbackCalls[0].cancel_url,'https://dhqfootball.com/upgrade.html?payment=cancel');
  assert.equal(fallbackCalls[0].subscription_data.trial_period_days,7);
  assert.equal((await handler('fw-billing-portal',{createClient:fallbackDB,Stripe:FallbackStripe})(request())).status,200);
  assert.equal(fallbackCalls[1].return_url,'https://dhqfootball.com/index.html');
  let checkoutCalls = 0, customerKeys = [];
  class Stripe {
    customers = { create: async (_args, options) => { customerKeys.push(options.idempotencyKey); return { id: 'same-customer' }; } };
    checkout = { sessions: { create: async () => { checkoutCalls++; return { id: 'checkout', url: 'https://example.invalid/checkout' }; } } };
  }
  const db = database(call => call.operation === 'update' ? failure : { data: { stripe_customer_id: null }, error: null });
  for (let i = 0; i < 2; i++) assert.equal((await handler('fw-create-checkout', { createClient: () => db, Stripe })(request())).status, 503);
  assert.equal(checkoutCalls, 0); assert.equal(customerKeys[0], customerKeys[1]);

  let pausedCalls=0;
  const paused=await handler('fw-create-checkout',{createClient:()=>({rpc:async()=>({data:false})}),Stripe:class{constructor(){pausedCalls++;}}})(request());
  assert.equal(paused.status,503); assert.equal(pausedCalls,0); assert.equal(paused.headers.get('X-DHQ-Billing-Writer'),'billing-events-v1');
  for(const slug of ['fw-create-checkout','fw-stripe-webhook','fw-revenuecat-webhook']) {
    const get=await handler(slug,{createClient:()=>database(()=>({})),Stripe:class{}})(new Request('https://example.invalid/billing'));
    assert.equal(get.status,405); assert.equal(get.headers.get('X-DHQ-Billing-Writer'),'billing-events-v1','safe method probe proves serving writer version');
  }
  console.log('PASS billing query errors stay truthful, established returns work, invalid returns denied and unsaved customer cannot proceed to checkout');
})().catch(error => { console.error(error); process.exitCode = 1; });
