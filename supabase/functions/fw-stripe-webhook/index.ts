/**
 * fw-stripe-webhook — Handle Stripe subscription lifecycle events
 *
 * POST /functions/v1/fw-stripe-webhook
 * (No Authorization header — Stripe signs the request with STRIPE_WEBHOOK_SECRET)
 *
 * Handles:
 *   - checkout.session.completed     → activate pro subscription
 *   - customer.subscription.updated  → sync tier / status changes
 *   - customer.subscription.deleted  → downgrade to free
 *   - invoice.payment_failed         → mark past_due
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET   (from Stripe Dashboard → Webhooks → Signing secret)
 *
 * Setup in Stripe Dashboard:
 *   Webhooks → Add endpoint → https://<project>.supabase.co/functions/v1/fw-stripe-webhook
 *   Events to listen for:
 *     checkout.session.completed
 *     customer.subscription.updated
 *     customer.subscription.deleted
 *     invoice.payment_failed
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import { claimBillingEvent, applyBillingEvent, billingWriterResponse } from '../_shared/billing-events.ts';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any, timeout: 15000, maxNetworkRetries: 1 });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => billingWriterResponse(await handleBillingRequest(req)));

async function handleBillingRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), req.headers.get('stripe-signature') ?? '', STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Webhook Error: Invalid signature', { status: 400 });
  }
  try {
    const object = event.data.object as any;
    let sourceId: string | null = null;
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription') sourceId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') sourceId = object.id;
    if (event.type === 'invoice.payment_failed' && object.subscription) sourceId = typeof object.subscription === 'string' ? object.subscription : object.subscription.id;
    if (sourceId) {
      if (!event.id) throw new Error('Missing Stripe event identity');
      const leaseToken = await claimBillingEvent(admin, 'stripe', sourceId, event.id);
      if (leaseToken) {
        // Snapshot event timestamps cannot order changes (distinct events can
        // share a second). Serialize and read Stripe's current object instead.
        const subscription = await stripe.subscriptions.retrieve(sourceId);
        const identity = await subscriptionIdentity(subscription);
        const status = mapStripeStatus(subscription.status);
        await applyBillingEvent(admin, {
          provider: 'stripe', sourceId, eventId: event.id, leaseToken,
          eventAt: new Date().toISOString(), userId: identity.userId, productSlug: identity.productSlug,
          state: {
            tier: (status === 'active' || status === 'trialing') ? 'pro' : 'free', status,
            store: 'stripe', billing_period: billingPeriodFor(subscription),
            stripe_subscription_id: subscription.id, stripe_price_id: subscription.items.data[0]?.price.id || null,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            rc_app_user_id: null, rc_product_id: null, rc_last_event_at: null, expires_at: null,
          },
        });
      }
    }
  } catch (err) {
    console.error(`Error handling event ${event.type}:`, err);
    return new Response('Handler error', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
}

async function subscriptionIdentity(subscription: Stripe.Subscription): Promise<{ userId: string; productSlug: string }> {
  if (subscription.metadata.user_id) return {
    userId: subscription.metadata.user_id,
    productSlug: normalizeProductSlug(subscription.metadata.product_slug ?? 'war_room'),
  };
  // Existing subscriptions may predate metadata. Query failure must not be
  // acknowledged as an unknown account, and another store's aggregate cannot
  // hide a known Stripe purchase once its independent source is recorded.
  const { data: source, error: sourceError } = await admin.from('billing_subscription_sources')
    .select('user_id, product_slug').eq('provider', 'stripe').eq('source_id', subscription.id).maybeSingle();
  if (sourceError) throw sourceError;
  if (source) return { userId: source.user_id, productSlug: source.product_slug };
  const { data: legacy, error: legacyError } = await admin.from('subscriptions')
    .select('user_id, product_slug').eq('stripe_subscription_id', subscription.id).maybeSingle();
  if (legacyError) throw legacyError;
  if (!legacy) throw new Error('Stripe subscription identity is unavailable; retry after reconciliation.');
  return { userId: legacy.user_id, productSlug: legacy.product_slug };
}

// ── Utility ───────────────────────────────────────────────────

// The subscribed price's recurrence is authoritative for monthly vs annual
// (metadata is a fallback for prices without a recurring interval).
function billingPeriodFor(subscription: Stripe.Subscription): 'monthly' | 'annual' | null {
  const interval = subscription.items.data[0]?.price?.recurring?.interval;
  if (interval === 'year') return 'annual';
  if (interval === 'month') return 'monthly';
  const fromMetadata = String(subscription.metadata?.billing_period || '').toLowerCase();
  return fromMetadata === 'annual' || fromMetadata === 'monthly' ? fromMetadata : null;
}

function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active':   return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'incomplete':
      return 'incomplete';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      console.warn('[stripe-webhook] Unknown subscription status:', stripeStatus);
      return 'incomplete';
  }
}

function normalizeProductSlug(value: unknown): string {
  const raw = String(value || 'war_room').trim().toLowerCase();
  const aliases: Record<string, string> = {
    'war-room': 'war_room',
    warroom: 'war_room',
    'dynasty-hq': 'dynast_hq',
    dynasty_hq: 'dynast_hq',
    scout: 'dynast_hq',
    'recon-ai': 'dynast_hq',
    recon_ai: 'dynast_hq',
    pro: 'bundle',
  };
  return aliases[raw] || raw;
}
