/**
 * fw-revenuecat-webhook — Handle RevenueCat subscription lifecycle events
 *
 * POST /functions/v1/fw-revenuecat-webhook
 * (No Supabase JWT — RevenueCat sends the Authorization header value you
 *  configure in its dashboard; we require it to match REVENUECAT_WEBHOOK_AUTH.)
 *
 * This is the App Store (and any future Play Store) side of billing: the iOS
 * app purchases through RevenueCat, RevenueCat validates receipts with Apple,
 * and this webhook mirrors the entitlement into public.subscriptions — the
 * same table the Stripe webhook writes — so server-side plan checks stay
 * uniform regardless of where the user paid.
 *
 * REQUIREMENT (app side): the app must identify the RevenueCat SDK with the
 * Supabase user id — Purchases.logIn(<app_users.id uuid>) — so events arrive
 * keyed to a user we can find. Events for anonymous RC ids are acknowledged
 * and skipped (retrying cannot fix them).
 *
 * Handled events:
 *   INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, PRODUCT_CHANGE,
 *   SUBSCRIPTION_EXTENDED                  → activate/refresh pro
 *   CANCELLATION                           → auto-renew off (access continues
 *                                            until period end)
 *   EXPIRATION                             → downgrade to free
 *   BILLING_ISSUE                          → mark past_due
 *   TEST                                   → 200 ok (dashboard test button)
 *   TRANSFER                               → retry until current purchase
 *                                            ownership can be reconciled
 *   Everything else                        → acknowledged, no-op
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   REVENUECAT_WEBHOOK_AUTH   (any long random string; set the SAME value as
 *                              the Authorization header in RevenueCat →
 *                              Integrations → Webhooks)
 *
 * Setup in RevenueCat Dashboard:
 *   Project → Integrations → Webhooks → Add webhook
 *     URL: https://<project>.supabase.co/functions/v1/fw-revenuecat-webhook
 *     Authorization header: <the REVENUECAT_WEBHOOK_AUTH value>
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { claimBillingEvent, applyBillingEvent, billingWriterResponse } from '../_shared/billing-events.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_AUTH         = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') || '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Live App Store product line (mirrors RevenueCat offering `default`,
// entitlement `dhq`).
const PRODUCT_SLUG = 'dhq';

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function authorized(req: Request): boolean {
  if (!WEBHOOK_AUTH) return false; // unset secret = webhook disabled, never open
  const header = req.headers.get('Authorization') || '';
  return timingSafeEqual(header, WEBHOOK_AUTH)
    || timingSafeEqual(header, `Bearer ${WEBHOOK_AUTH}`);
}

function billingPeriodFor(productId: string): 'monthly' | 'annual' | null {
  const id = String(productId || '').toLowerCase();
  if (id.includes('annual') || id.includes('yearly')) return 'annual';
  if (id.includes('monthly')) return 'monthly';
  return null;
}

function storeFor(rcStore: string): string | null {
  switch (String(rcStore || '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
    case 'AMAZON':
      return 'play_store';
    case 'STRIPE':
      return 'stripe';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return null;
  }
}

// RC events carry the SDK app user id plus any aliases; the app logs the SDK
// in with the Supabase user uuid, so the first alias that looks like a uuid
// and exists in app_users is our subscriber. Anonymous ids ($RCAnonymousID:…)
// never match.
async function resolveUserId(event: Record<string, any>): Promise<string | null> {
  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    ...(Array.isArray(event.aliases) ? event.aliases : []),
  ].map((v) => String(v || '')).filter((v) => UUID_RE.test(v));

  for (const candidate of [...new Set(candidates)]) {
    const { data, error } = await admin
      .from('app_users')
      .select('id')
      .eq('id', candidate)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data.id;
  }
  return null;
}

function isoFromMs(ms: unknown): string | null {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

Deno.serve(async (req) => billingWriterResponse(await handleBillingRequest(req)));

async function handleBillingRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!authorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let event: Record<string, any>;
  try {
    const body = await req.json();
    event = body?.event;
    if (!event || typeof event !== 'object') throw new Error('missing event');
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const type = String(event.type || '').toUpperCase();
  const ack = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ received: true, ...extra }), {
      headers: { 'Content-Type': 'application/json' },
    });

  if (type === 'TEST') return ack({ test: true });

  // TRANSFER does not carry app_user_id or original_transaction_id. Treating
  // it as an unknown subscriber acknowledged and permanently lost restores.
  // Its from/to arrays also cannot prove which of several store purchases
  // moved. Current provider ownership must be read before changing a source.
  // Keep known access and the delivery retryable until that read integration
  // is configured; never silently move all of an account's subscriptions.
  if (type === 'TRANSFER') {
    if (!event.id || !Array.isArray(event.transferred_from) || !Array.isArray(event.transferred_to)
        || !event.transferred_from.length || !event.transferred_to.length) return new Response('Invalid transfer event', { status: 400 });
    console.error('[rc-webhook] Transfer reconciliation pending: provider ownership access required', { eventId: String(event.id) });
    return new Response('Transfer ownership verification is temporarily unavailable. Retry delivery.', { status: 503 });
  }

  try {
    const userId = await resolveUserId(event);
    if (!userId) {
      // Retrying cannot fix an unidentified user — acknowledge, but leave a
      // loud trail: this usually means the app skipped Purchases.logIn().
      console.error('[rc-webhook] No matching app user for event', {
        type,
        appUserId: event.app_user_id,
        aliases: event.aliases,
      });
      return ack({ ignored: 'no_matching_user' });
    }

    const supported = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE'];
    if (!supported.includes(type)) return ack({ ignored: type.toLowerCase() });
    const eventId = String(event.id || '');
    const transactionId = String(event.original_transaction_id || '');
    const eventAt = isoFromMs(event.event_timestamp_ms);
    if (!eventId || !transactionId || !eventAt) throw new Error('Missing RevenueCat event or purchase identity');
    const sourceId = JSON.stringify([String(event.environment || 'unknown'), String(event.store || 'unknown').toUpperCase(), transactionId]);
    const leaseToken = await claimBillingEvent(admin, 'revenuecat', sourceId, eventId);
    if (!leaseToken) return ack({ duplicate: true });
    const productId = String(event.new_product_id || event.product_id || '');
    const billingPeriod = billingPeriodFor(productId);
    const store = storeFor(event.store);
    const periodStart = isoFromMs(event.purchased_at_ms);
    const periodEnd = isoFromMs(event.expiration_at_ms);
    if (!productId || !periodStart || (event.expiration_at_ms != null && !periodEnd)) throw new Error('Missing RevenueCat purchase period');
    const state: Record<string, unknown> = {
      rc_app_user_id: String(event.app_user_id || ''), rc_product_id: productId,
      rc_last_event_at: eventAt, current_period_start: periodStart, current_period_end: periodEnd,
      ...(store ? { store } : {}), ...(billingPeriod ? { billing_period: billingPeriod } : {}),
    };
    if (['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED'].includes(type)) {
      Object.assign(state, { tier: 'pro', status: String(event.period_type || '').toUpperCase() === 'TRIAL' ? 'trialing' : 'active', cancel_at_period_end: false });
    } else if (type === 'CANCELLATION') {
      state.cancel_at_period_end = true; // Keep existing access until EXPIRATION.
    } else if (type === 'EXPIRATION') {
      Object.assign(state, { tier: 'free', status: 'canceled', cancel_at_period_end: false });
    } else if (type === 'BILLING_ISSUE') {
      state.status = 'past_due';
    }
    await applyBillingEvent(admin, {
      provider: 'revenuecat', sourceId, eventId, leaseToken, eventAt,
      userId, productSlug: PRODUCT_SLUG, state,
    });

    return ack({ type: type.toLowerCase() });
  } catch (err) {
    // Non-2xx makes RevenueCat retry with backoff — correct for transient
    // DB errors.
    console.error(`[rc-webhook] Error handling ${type}:`, err);
    return new Response('Handler error', { status: 500 });
  }
}
