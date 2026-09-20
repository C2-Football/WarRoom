// Read provider history; never replay a checkout create during deletion. A
// missing local session ID can mean Stripe succeeded but its reply was lost.
export async function retireAccountCheckouts(options: {
  snapshot: any; stripeSecret: string; check: () => Promise<void>;
  beforeMutation: () => void; onExpired: () => void; subscription: (id: string, customer: string) => void;
  fail: (message: string, status?: number) => Error;
}): Promise<number> {
  const {snapshot, stripeSecret, check, beforeMutation, onExpired, subscription, fail} = options;
  const attempts = snapshot.checkout_attempts;
  const customers = new Set<string>();
  const sessions = new Map<string, any>();
  const error = () => fail('Checkout history could not be verified. Your account has not been deleted. Retry or contact billing support.');
  const customerId = (value: any) => typeof value.customer === 'string' ? value.customer : value.customer?.id;
  const addCustomer = (value: any) => {
    if (typeof value !== 'string' || !/^cus_[a-zA-Z0-9_]+$/.test(value)) throw error();
    customers.add(value);
  };
  if (snapshot.target?.stripe_customer_id) addCustomer(snapshot.target.stripe_customer_id);
  for (const attempt of attempts) {
    if (attempt.user_id !== snapshot.target?.id || typeof attempt.attempt_id !== 'string' || !attempt.attempt_id || !Number.isFinite(Date.parse(attempt.created_at))) throw error();
    if (attempt.lease_expires_at && (!Number.isFinite(Date.parse(attempt.lease_expires_at)) || Date.parse(attempt.lease_expires_at) > Date.now())) throw fail('Checkout is still being prepared. Your account has not been deleted. Wait a moment, then retry deletion.', 409);
    addCustomer(attempt.request?.customer);
  }
  if (!customers.size) return 0;
  if (!stripeSecret) throw fail('Checkout cancellation is unavailable. Your account has not been deleted. Try again or contact support.');

  async function request(route: string, method = 'GET'): Promise<any> {
    const response = await fetch('https://api.stripe.com/v1/' + route, {
      method, headers: {Authorization: 'Bearer ' + stripeSecret}, signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw error();
    return data;
  }
  function verifySession(value: any, customer: string): void {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(value?.id) || customerId(value) !== customer || (value.metadata?.user_id && value.metadata.user_id !== snapshot.target?.id)) throw error();
    // An expired link with provider recovery enabled could issue another
    // checkout outside the app. Do not claim deletion has closed that path.
    if (value.after_expiration?.recovery?.enabled) throw fail('An earlier checkout has a recovery link that needs billing support review. Your account has not been deleted.');
  }
  for (const customer of customers) {
    let cursor = '';
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams({customer, limit: '100', ...(cursor ? {starting_after: cursor} : {})});
      const result = await request('checkout/sessions?' + query);
      if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') throw error();
      for (const value of result.data) {
        if (customerId(value) !== customer) throw error();
        if (value.mode !== 'subscription') continue;
        verifySession(value, customer);
        if (sessions.has(value.id)) throw error();
        sessions.set(value.id, value);
      }
      if (!result.has_more) break;
      const next = result.data.at(-1)?.id;
      if (!next || next === cursor || page === 49) throw error();
      cursor = next;
    }
  }
  // Resolve every durable attempt, including an unacknowledged create. No
  // match is uncertain, even if the provider history currently looks empty.
  for (const attempt of attempts) {
    const matches = [...sessions.values()].filter(value => value.metadata?.dhq_checkout_attempt === attempt.attempt_id);
    if (matches.length !== 1 || (attempt.session_id && matches[0].id !== attempt.session_id)) throw fail('An earlier checkout could not be located safely. Your account has not been deleted. Reopen billing to recover it, or contact support.');
    const value = matches[0];
    if (customerId(value) !== attempt.request.customer || value.metadata?.user_id !== attempt.user_id || value.metadata?.product_slug !== attempt.product_slug) throw error();
  }

  let expired = 0;
  for (const previous of sessions.values()) {
    const customer = customerId(previous);
    let value = await request('checkout/sessions/' + encodeURIComponent(previous.id));
    verifySession(value, customer);
    if (value.id !== previous.id || value.mode !== 'subscription') throw error();
    if (value.status === 'open') {
      await check(); beforeMutation();
      // If completion won the race, re-read and cancel its actual subscription.
      // A rejection or lost reply never permits deleting the app blindly.
      try { await request('checkout/sessions/' + encodeURIComponent(value.id) + '/expire', 'POST'); } catch { /* verify actual provider state below */ }
      value = await request('checkout/sessions/' + encodeURIComponent(value.id));
      verifySession(value, customer);
      if (value.id !== previous.id || value.mode !== 'subscription') throw error();
    }
    if (value.status === 'expired') { expired++; onExpired(); continue; }
    if (value.status !== 'complete') throw fail('Checkout cancellation was not confirmed. Your account has not been deleted. Retry deletion.');
    const id = typeof value.subscription === 'string' ? value.subscription : value.subscription?.id;
    if (typeof id !== 'string' || !/^sub_[a-zA-Z0-9_]+$/.test(id)) throw fail('A checkout completed and its subscription is still being confirmed. Your account has not been deleted. Retry shortly.');
    subscription(id, customer);
  }
  return expired;
}
