// Service-only durable event boundary. Acknowledgment is allowed only after
// the receipt, provider state and public entitlement commit together.
export async function claimBillingEvent(admin: any, provider: string, sourceId: string, eventId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('claim_billing_event', {
    p_provider: provider, p_source_id: sourceId, p_event_id: eventId,
  });
  if (error) throw error;
  if (data?.outcome === 'duplicate') return null;
  if (data?.outcome !== 'claimed' || !data.lease_token) throw new Error('Billing event is busy or unavailable; retry delivery.');
  return data.lease_token;
}

export async function applyBillingEvent(admin: any, args: {
  provider: string; sourceId: string; eventId: string; leaseToken: string;
  eventAt: string; userId: string; productSlug: string; state: Record<string, unknown>;
}): Promise<void> {
  const { data, error } = await admin.rpc('apply_billing_event', {
    p_provider: args.provider, p_source_id: args.sourceId, p_event_id: args.eventId,
    p_lease_token: args.leaseToken, p_event_at: args.eventAt, p_user_id: args.userId,
    p_product_slug: args.productSlug, p_state: args.state,
  });
  if (error) throw error;
  if (!['applied', 'duplicate', 'stale', 'legacy_preserved'].includes(data?.outcome)) {
    throw new Error('Billing event was not committed; retry delivery.');
  }
  if (data.outcome === 'legacy_preserved') {
    console.warn('[billing] Legacy purchase retained: incoming event does not identify its recorded period', {
      provider: args.provider, eventId: args.eventId, sourceId: args.sourceId,
    });
  }
}

// Readable even on unauthenticated method/error responses so the release
// operator can verify which writer is actually serving before starting drain.
export function billingWriterResponse(response: Response): Response {
  response.headers.set('X-DHQ-Billing-Writer', 'billing-events-v1');
  return response;
}

export async function billingProcessingEnabled(admin: any): Promise<boolean> {
  const { data, error } = await admin.rpc('billing_event_processing_enabled');
  if (error) throw error;
  return data === true;
}
