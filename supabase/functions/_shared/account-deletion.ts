// Account deletion spans independent systems. Preserve the app account until
// every required external operation is confirmed; never claim cross-service
// atomicity. A failed or uncertain response remains safely retryable.
export class AccountDeletionError extends Error {
  status: number;
  details: Record<string, unknown>;
  constructor(message: string, status = 503, details: Record<string, unknown> = {}) {
    super(message); this.status = status; this.details = details;
  }
}
const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
const terminalStripe = (status: unknown) => status === 'canceled' || status === 'incomplete_expired';

async function authInventory(admin: any, email: string): Promise<string[]> {
  const found = new Set<string>();
  // Collect every page before deleting anything: deleting during pagination
  // would shift records and skip identities. Bounded exhaustion fails closed.
  for (let page = 1; page <= 100; page++) {
    const {data, error} = await admin.auth.admin.listUsers({page, perPage: 1000});
    if (error || !Array.isArray(data?.users)) throw new AccountDeletionError('Sign-in records could not be checked. Your account has not been deleted. Try again.');
    for (const user of data.users) {
      if (normalize(user.email) === email) {
        if (typeof user.id !== 'string' || !user.id) throw new AccountDeletionError('Sign-in identity could not be verified. Try again.');
        found.add(user.id);
      }
    }
    if (data.users.length < 1000 && !data.nextPage) return [...found];
    if (Number.isInteger(data.lastPage) && page >= data.lastPage && !data.nextPage) return [...found];
  }
  throw new AccountDeletionError('The sign-in inventory could not be completed. Your account has not been deleted. Contact support.');
}

async function authUser(admin: any, id: string): Promise<any | null> {
  const {data, error} = await admin.auth.admin.getUserById(id);
  if (error && (error.code === 'user_not_found' || error.status === 404)) return null;
  if (error || !data?.user) throw new AccountDeletionError('A sign-in record could not be verified. Your account has not been deleted. Try again.');
  return data.user;
}

export async function performAccountDeletion(options: {
  admin: any; actorId: string; actorVersion: number; email: string; self: boolean;
  force: boolean; stripeSecret: string; revalidate: () => Promise<boolean>;
}): Promise<Record<string, unknown>> {
  const {admin, actorId, actorVersion, self, force, stripeSecret, revalidate} = options;
  const email = normalize(options.email);
  const params = {p_actor_id: actorId, p_actor_version: actorVersion, p_email: email, p_self: self};
  let confirmedStripe = 0, removedAuth = 0, billingMayHaveChanged = false;
  const snapshot = async () => {
    if (!await revalidate()) throw new AccountDeletionError('Your session changed. Sign in again before retrying deletion.', 401);
    const {data, error} = await admin.rpc('inspect_account_deletion', params);
    if (error) throw new AccountDeletionError(error.code === '42501' ? 'Account authorization changed. Sign in again or contact support.' : 'Account and billing records could not be checked. Your account has not been deleted. Try again.', error.code === '42501' ? 403 : 503);
    if (!data || data.actor?.id !== actorId || data.actor?.session_version !== actorVersion || data.email !== email || data.self !== self || !Array.isArray(data.subscriptions) || !Array.isArray(data.sources)) throw new AccountDeletionError('Account details could not be verified. Your account has not been deleted. Try again.');
    return data;
  };
  try {
    const initial = await snapshot();
    const records = [...initial.subscriptions, ...initial.sources.map((source: any) => ({...source.state, sourceProvider: source.provider, sourceId: source.source_id}))];
    const stripeIds = new Set<string>();
    const managedStores = new Set<string>();
    let paid = false;
    for (const record of records) {
      const stripeId = record.sourceProvider === 'stripe' ? record.sourceId : record.stripe_subscription_id;
      if (stripeId) {
        if (typeof stripeId !== 'string' || !/^sub_[a-zA-Z0-9_]+$/.test(stripeId)) throw new AccountDeletionError('A billing record needs support review before deletion. Your account has not been deleted.');
        stripeIds.add(stripeId);
      }
      const active = ['active','trialing','past_due','unpaid','incomplete'].includes(record.status);
      const storeManaged = ['app_store','play_store'].includes(record.store);
      if (active && (stripeId || (record.tier === 'pro' && storeManaged))) paid = true;
      // Owner-granted promotional access has no external subscription to
      // cancel; it must never be described as an Apple/Google charge.
      if (active && storeManaged && record.sourceProvider !== 'stripe') managedStores.add(String(record.store));
    }
    const managedSubscriptions = [...managedStores].sort();
    if (!self && paid && !force) throw new AccountDeletionError('paying_customer', 409, {
      message: 'This account has a paid subscription. Confirm again to cancel Stripe subscriptions and delete the account. Apple and Google subscriptions must be managed with the store; account deletion does not cancel them.',
      managedSubscriptions,
    });
    if (stripeIds.size && !stripeSecret) throw new AccountDeletionError('Stripe cancellation is unavailable. Your account has not been deleted. Try again or contact support.');
    const identities = await authInventory(admin, email);
    if (!initial.target && !identities.length) throw new AccountDeletionError('No account found with that email.', 404);
    const check = async () => {
      const current = await snapshot();
      if (JSON.stringify(current) !== JSON.stringify(initial)) throw new AccountDeletionError('Account or billing state changed. Your account has not been deleted. Retry deletion to use the current records.', 409);
    };
    const stripeRead = async (id: string) => {
      const response = await fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(id), {headers: {Authorization: 'Bearer ' + stripeSecret}, signal: AbortSignal.timeout(12000)});
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.id !== id || typeof data?.status !== 'string') throw new AccountDeletionError('Stripe cancellation could not be verified. Your account has not been deleted. Try again.');
      return data;
    };
    for (const id of stripeIds) {
      const before = await stripeRead(id);
      if (!terminalStripe(before.status)) {
        await check();
        billingMayHaveChanged = true;
        const response = await fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(id), {method: 'DELETE', headers: {Authorization: 'Bearer ' + stripeSecret}, signal: AbortSignal.timeout(12000)});
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.id !== id || !terminalStripe(result.status)) throw new AccountDeletionError('Stripe cancellation was not confirmed. Your account has not been deleted. Try again.');
      }
      confirmedStripe++;
    }
    for (const id of identities) {
      const before = await authUser(admin, id);
      if (!before) continue;
      if (before.id !== id || normalize(before.email) !== email) throw new AccountDeletionError('A sign-in identity changed. Your account has not been deleted. Retry deletion.', 409);
      await check();
      const {error} = await admin.auth.admin.deleteUser(id);
      if (error) throw new AccountDeletionError('A sign-in record could not be removed. Your account has not been deleted. Try again.');
      if (await authUser(admin, id)) throw new AccountDeletionError('Sign-in removal was not confirmed. Your account has not been deleted. Try again.');
      removedAuth++;
    }
    // A new OAuth identity can be created outside the app database. Refuse a
    // detected reappearance; never delete a newly observed identity implicitly.
    if ((await authInventory(admin, email)).length) throw new AccountDeletionError('A sign-in was created while deletion was running. Your account has not been deleted. Retry deletion.', 409);
    await check();
    const {data: completed, error} = await admin.rpc('finalize_account_deletion', {...params,p_snapshot: initial});
    if (error) throw new AccountDeletionError(error.code === '40001' ? 'Account or billing state changed. Retry deletion.' : 'Account deletion was not confirmed. Try again.', error.code === '40001' ? 409 : 503);
    if (typeof completed?.deletedAppUser !== 'boolean') throw new AccountDeletionError('Account deletion was not confirmed. Sign in again to check its status.');
    return {ok: true, deletedAppUser: completed.deletedAppUser, deletedAuthUsers: removedAuth, canceledStripeSubscriptions: confirmedStripe, managedSubscriptions};
  } catch (error) {
    const failure = error instanceof AccountDeletionError ? error : new AccountDeletionError('Deletion was interrupted. Your account may still be present. Try again.');
    if (billingMayHaveChanged || confirmedStripe || removedAuth) failure.message += ' Some billing cancellations or sign-in removals may already have completed; retrying will check their current status.';
    failure.details = {...failure.details, canceledStripeSubscriptions: confirmedStripe, deletedAuthUsers: removedAuth, billingMayHaveChanged};
    throw failure;
  }
}
