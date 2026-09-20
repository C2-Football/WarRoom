// Durable public-proxy limits use the same atomic, service-only database
// primitive as authentication. A storage failure cannot reset the allowance
// by moving the request to another Edge instance.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { checkRateLimit as consumeRateLimit } from './security.ts';
export { clientIp } from './security.ts';

let client: SupabaseClient | null = null;
function admin(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return null;
  return client ||= createClient(url, service, { auth: { persistSession: false } });
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfter: number;
}

export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const db = admin();
  if (!db) return { allowed: false, count: 0, limit, retryAfter: 60 };
  const result = await consumeRateLimit(db, 'provider-proxy', key, { limit, windowSeconds });
  return { allowed: result.allowed, count: result.count, limit, retryAfter: result.retryAfterSeconds || 0 };
}

export function rateLimitResponse(result: RateLimitResult, headers: HeadersInit): Response | null {
  if (result.allowed) return null;
  return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }), {
    status: 429,
    headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': String(result.retryAfter || 60) },
  });
}
