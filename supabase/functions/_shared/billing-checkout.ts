// One open checkout per account/product, with a durable request and provider
// idempotency key. Never return an unrecorded or unverified session URL.
export class CheckoutRecoveryError extends Error {
  constructor(message: string, public status=503, public code='checkout_pending') { super(message); }
}

const terminalSubscription = (status: string) => ['canceled','incomplete_expired'].includes(status);
function normalizedProduct(value: string): string {
  return ({'war-room':'war_room',warroom:'war_room','dynasty-hq':'dynast_hq',dynasty_hq:'dynast_hq',scout:'dynast_hq',pro:'bundle'} as Record<string,string>)[value]||value;
}
function productFromPrices(items: any[],request: any): string {
  const products=new Set(items.map(item=>request.price_products?.[item.price?.id]).filter(Boolean));
  if(!items.length || items.some(item=>!request.price_products?.[item.price?.id]) || products.size!==1) throw new CheckoutRecoveryError('Earlier billing history needs support review before another payment can be started.');
  return String([...products][0]);
}
const sameRequest = (a: any,b: any) => ['customer','price','billing','success_url','cancel_url'].every(key=>a[key]===b[key]);
function sessionCustomer(session: any): string { return typeof session.customer==='string'?session.customer:session.customer?.id; }

async function listAll(load: (args: any)=>Promise<any>, args: any): Promise<any[]> {
  const rows: any[]=[]; let cursor: string|undefined;
  for(let page=0;page<50;page++) {
    const result=await load({...args,limit:100,...(cursor?{starting_after:cursor}:{})});
    if(!Array.isArray(result?.data) || typeof result.has_more!=='boolean') throw new CheckoutRecoveryError('Billing history could not be verified. Please try again.');
    rows.push(...result.data);
    if(!result.has_more) return rows;
    const next=result.data.at(-1)?.id;
    if(!next || next===cursor) break;
    cursor=next;
  }
  throw new CheckoutRecoveryError('Billing history needs additional verification. Please try again later.');
}

export async function recoverCheckout(admin: any,stripe: any,userId: string,productSlug: string,request: any): Promise<any> {
  const base={p_user_id:userId,p_product_slug:productSlug};
  const claimed=await admin.rpc('claim_billing_checkout',{...base,p_request:request});
  if(claimed.error || claimed.data?.outcome!=='claimed') throw new CheckoutRecoveryError('Checkout is being prepared or is temporarily unavailable. Please try again shortly.');
  let attempt=claimed.data;
  const lease=attempt.lease_token;
  async function checkpoint(sessionId: string,next?: any) {
    const saved=await admin.rpc('checkpoint_billing_checkout',{...base,p_lease_token:lease,p_session_id:sessionId,p_next_request:next||null});
    if(saved.error || saved.data?.outcome!=='saved') throw new CheckoutRecoveryError('Checkout could not be saved. Please retry to recover the same checkout.');
    attempt=saved.data;
  }
  try {
    for(let pass=0;pass<3;pass++) {
      const stored=attempt.request;
      if(stored.customer!==request.customer) throw new CheckoutRecoveryError('The billing account changed. Please reopen billing settings.');
      let session;
      if(attempt.session_id) session=await stripe.checkout.sessions.retrieve(attempt.session_id);
      else {
        // The provider retains idempotency keys for at least 24 hours. After
        // that, find the exact attempt in provider history before any create.
        if(Date.now()-Date.parse(attempt.created_at)>23*60*60*1000) {
          const prior=await listAll(args=>stripe.checkout.sessions.list(args),{customer:stored.customer,created:{gte:Math.floor(Date.parse(attempt.created_at)/1000)-60}});
          const matches=prior.filter(s=>s.metadata?.dhq_checkout_attempt===attempt.attempt_id);
          if(matches.length>1) throw new CheckoutRecoveryError('Checkout history needs review before another payment can be started.');
          session=matches[0];
          if(!session) throw new CheckoutRecoveryError('The earlier checkout could not be located safely. Please contact support before starting another payment.');
        } else {
          // Before this durable-attempt scheme, the same customer could have
          // several still-open links. Close only links whose product can be
          // established from current provider metadata or configured prices.
          const open=await listAll(args=>stripe.checkout.sessions.list(args),{customer:stored.customer,status:'open'});
          for(const previous of open) {
            if(previous.mode!=='subscription' || previous.metadata?.dhq_checkout_attempt===attempt.attempt_id) continue;
            if(sessionCustomer(previous)!==stored.customer) throw new CheckoutRecoveryError('Checkout customer history could not be verified.');
            let product=normalizedProduct(previous.metadata?.product_slug||'');
            if(!product) {
              const items=await listAll(args=>stripe.checkout.sessions.listLineItems(previous.id,args),{});
              product=productFromPrices(items,request);
            }
            if(product!==productSlug) continue;
            const expired=await stripe.checkout.sessions.expire(previous.id);
            if(expired?.status!=='expired') throw new CheckoutRecoveryError('The earlier checkout is still being updated. Please retry.');
          }
          const existing=await listAll(args=>stripe.subscriptions.list(args),{customer:stored.customer,status:'all'});
          for(const subscription of existing) {
            if(terminalSubscription(subscription.status)) continue;
            const product=normalizedProduct(subscription.metadata?.product_slug||'')||productFromPrices(subscription.items?.data||[],request);
            if(product===productSlug) throw new CheckoutRecoveryError('A subscription for this product already exists. Use Manage billing to update it.',409,'subscription_exists');
          }
          session=await stripe.checkout.sessions.create({
            customer:stored.customer,mode:'subscription',line_items:[{price:stored.price,quantity:1}],
            success_url:stored.success_url,cancel_url:stored.cancel_url,
            metadata:{dhq_checkout_attempt:attempt.attempt_id,user_id:userId,product_slug:productSlug},
            subscription_data:{...(productSlug==='dhq'?{trial_period_days:7}:{}),metadata:{user_id:userId,product_slug:productSlug,billing_period:stored.billing}},
            allow_promotion_codes:true,
          },{idempotencyKey:'dhq-checkout-v1:'+attempt.attempt_id});
        }
        if(!session?.id) throw new CheckoutRecoveryError('Stripe did not return a checkout session. Please retry.');
        await checkpoint(session.id);
        // Idempotent create replays the original response, including an old
        // 'open' status. Retrieve current state before returning that link.
        session=await stripe.checkout.sessions.retrieve(session.id);
      }
      if(sessionCustomer(session)!==stored.customer || session.metadata?.dhq_checkout_attempt!==attempt.attempt_id || session.mode!=='subscription') throw new CheckoutRecoveryError('Checkout ownership could not be verified. Please reopen billing settings.');
      if(session.status==='open') {
        if(sameRequest(stored,request)) {
          if(typeof session.url!=='string' || !session.url.startsWith('https://checkout.stripe.com/')) throw new CheckoutRecoveryError('The checkout link is unavailable. Please retry.');
          return session;
        }
        // A plan or return destination changed. Retire the existing open link
        // before issuing its replacement; a completion race must fail/retry.
        const expired=await stripe.checkout.sessions.expire(session.id);
        if(expired?.status!=='expired') throw new CheckoutRecoveryError('The earlier checkout is still being updated. Please retry.');
      } else if(session.status==='complete') {
        const id=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
        if(!id) throw new CheckoutRecoveryError('Checkout completed and subscription confirmation is pending. Recheck your access shortly.',409,'checkout_complete');
        const subscription=await stripe.subscriptions.retrieve(id);
        if(!terminalSubscription(subscription?.status)) throw new CheckoutRecoveryError('Checkout already completed. Recheck your access or use Manage billing.',409,'checkout_complete');
      } else if(session.status!=='expired') throw new CheckoutRecoveryError('Checkout status is unavailable. Please retry.');
      await checkpoint(session.id,request);
    }
    throw new CheckoutRecoveryError('Checkout changed while it was being prepared. Please retry.');
  } finally {
    // A failed unlock only keeps the short lease until its deadline; it must
    // never erase the durable attempt or hide the original recovery result.
    try { await admin.rpc('release_billing_checkout',{...base,p_lease_token:lease}); } catch { /* lease expires */ }
  }
}
