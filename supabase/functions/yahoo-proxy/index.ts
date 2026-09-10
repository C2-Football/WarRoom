// ══════════════════════════════════════════════════════════════════
// yahoo-proxy — Supabase Edge Function
// Handles Yahoo Fantasy OAuth 2.0 and API proxying.
//
// Setup: add these to Supabase secrets (Dashboard → Settings → Edge Functions):
//   YAHOO_CLIENT_ID     — from your Yahoo Developer app
//   YAHOO_CLIENT_SECRET — from your Yahoo Developer app
//
// Yahoo Developer app redirect URI must be set to:
//   https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy
//
// Actions:
//   POST { action:'auth_url', return_url }
//     → { auth_url } — starts a browser-bound, server-recorded OAuth flow
//   GET  ?code=XXX&state=XXX (Yahoo callback)
//     → exchanges code for tokens, stores session, redirects to app
//   POST { action:'api', endpoint, session_id }
//     → proxies Yahoo Fantasy API request with stored access token
//   POST { action:'refresh', session_id }
//     → refreshes expired access token
// ══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireActiveAppSession, requireSleeperSession, sha256Hex, checkRateLimit } from "../_shared/security.ts";
import { corsHeaders, isAllowedBrowserUrl } from "../_shared/cors.ts";

const YAHOO_BASE      = "https://fantasysports.yahooapis.com/fantasy/v2";
const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const YAHOO_AUTH_URL  = "https://api.login.yahoo.com/oauth2/request_auth";

// This function's public URL — registered as redirect_uri in Yahoo Developer app
const REDIRECT_URI = "https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CLIENT_ID        = Deno.env.get("YAHOO_CLIENT_ID") || "";
const CLIENT_SECRET    = Deno.env.get("YAHOO_CLIENT_SECRET") || "";

async function requesterKey(req: Request): Promise<string | null> {
  const session = await requireActiveAppSession(adminClient(), req);
  if (session) return `app:${session.userId}`;
  const sleeper = await requireSleeperSession(req);
  return sleeper ? `sleeper:${sleeper.username.toLowerCase()}` : null;
}

// Start in a top-level navigation so the browser binding works even when
// third-party cookies are blocked on the app's cross-origin fetch.
function flowCookie(state: string, value: string, maxAge = 600): string {
  return `__Host-dhq-yahoo-${state}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readFlowCookie(req: Request, state: string): string {
  const prefix = `__Host-dhq-yahoo-${state}=`;
  return (req.headers.get('Cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(prefix))?.slice(prefix.length) || '';
}

function oauthError(message: string, status = 400): Response {
  return new Response(message, { status, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  } });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE);
}

async function storeTokens(
  sessionId: string,
  tokens: Record<string, unknown>,
  returnUrl: string,
  ownerKey: string
) {
  const { error } = await adminClient()
    .from("yahoo_tokens")
    .upsert({
      session_id:    sessionId,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    Date.now() + Number(tokens.expires_in || 3600) * 1000,
      token_type:    tokens.token_type || "Bearer",
      return_url:    returnUrl,
      owner_key:     ownerKey,
      updated_at:    new Date().toISOString(),
    });
  if (error) throw new Error("Could not save Yahoo connection.");
}

async function getTokenRecord(sessionId: string, ownerKey: string) {
  const { data, error } = await adminClient()
    .from("yahoo_tokens")
    .select("*")
    .eq("session_id", sessionId)
    .eq("owner_key", ownerKey)
    .single();
  if (error || !data) throw new Error("Yahoo session not found — please reconnect.");
  return data;
}

async function refreshAccessToken(sessionId: string, ownerKey: string): Promise<string> {
  const record = await getTokenRecord(sessionId, ownerKey);
  const basic  = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(record.refresh_token)}`,
  });
  if (!res.ok) throw new Error("Token refresh failed: " + res.status);
  const tokens = await res.json();

  await storeTokens(sessionId, {
    ...tokens,
    refresh_token: tokens.refresh_token || record.refresh_token,
  }, record.return_url || "", ownerKey);

  return tokens.access_token as string;
}

async function yahooFetch(endpoint: string, accessToken: string) {
  return fetch(YAHOO_BASE + endpoint, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
}

serve(async (req: Request) => {
  const responseHeaders = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  // ── GET: Yahoo OAuth callback ─────────────────────────────────────
  if (req.method === "GET") {
    const url   = new URL(req.url);
    const start = url.searchParams.get('start');
    const code = url.searchParams.get('code');
    const state = start || url.searchParams.get('state') || '';
    if (!/^[a-f0-9]{64}$/.test(state)) return oauthError('Invalid Yahoo connection. Start again from the app.');
    if (!CLIENT_ID || !CLIENT_SECRET) return oauthError('Yahoo connection is not configured.', 503);
    const db = adminClient();
    try {
      const stateHash = await sha256Hex(state);
      if (start) {
        const binding = crypto.randomUUID() + crypto.randomUUID();
        const { data: pending, error } = await db.from('yahoo_oauth_states')
          .update({ browser_hash: await sha256Hex(binding) })
          .eq('state_hash', stateHash).is('browser_hash', null)
          .gt('expires_at', new Date().toISOString()).select('state_hash').maybeSingle();
        if (error || !pending) return oauthError('This Yahoo connection has expired or already started.');
        const consent = new URL(YAHOO_AUTH_URL);
        consent.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
          response_type: 'code', scope: 'fspt-r', state }).toString();
        return new Response(null, { status: 302, headers: {
          Location: consent.toString(), 'Set-Cookie': flowCookie(state, binding),
          'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        } });
      }
      const binding = readFlowCookie(req, state);
      if (!binding) return oauthError('Return to the browser that started this Yahoo connection.');
      // DELETE ... RETURNING consumes exactly one matching browser-bound state,
      // including when callbacks race. Neither identity nor return URL comes
      // from the callback parameters.
      const { data: pending, error } = await db.from('yahoo_oauth_states').delete()
        .eq('state_hash', stateHash).eq('browser_hash', await sha256Hex(binding))
        .gt('expires_at', new Date().toISOString())
        .select('owner_key, return_url, session_version').maybeSingle();
      if (error || !pending) return oauthError('This Yahoo connection has expired or already completed.');
      if (url.searchParams.has('error') || !code) return oauthError('Yahoo connection was not approved. Start again from the app.');
      const ownerKey = pending.owner_key;
      const returnUrl = pending.return_url;
      if (!isAllowedBrowserUrl(returnUrl)) return oauthError('Yahoo return URL is not allowed.');
      if (ownerKey.startsWith('app:')) {
        const { data: user, error } = await db.from('app_users').select('session_version')
          .eq('id', ownerKey.slice(4)).maybeSingle();
        if (error || !user || user.session_version !== pending.session_version) return oauthError('Sign in again before connecting Yahoo.', 401);
      }

      // Exchange authorization code for tokens
      const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const tokenRes = await fetch(YAHOO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basic}`,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: [
          "grant_type=authorization_code",
          `code=${encodeURIComponent(code)}`,
          `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        ].join("&"),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new Error(`Token exchange failed (${tokenRes.status}): ${errText.slice(0, 300)}`);
      }

      const tokens = await tokenRes.json();
      const sessionId = crypto.randomUUID();
      await storeTokens(sessionId, tokens, returnUrl, ownerKey);

      const appUrl = new URL(returnUrl);
      appUrl.searchParams.set('yahoo_session', sessionId);
      return new Response(null, { status: 302, headers: {
        Location: appUrl.toString(), 'Set-Cookie': flowCookie(state, '', 0),
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      } });
    } catch (err) {
      console.error('[yahoo-proxy] Callback failed');
      return oauthError('Yahoo connection failed. Start again from the app.', 500);
    }
  }

  // ── POST: app actions ─────────────────────────────────────────────
  if (req.method === "POST") {
    let body: Record<string, string>;
    try {
      body = await req.json();
    } catch (_) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const action = body.action;

    // ── auth_url: build Yahoo OAuth consent URL ──
    if (action === "auth_url") {
      const ownerKey = await requesterKey(req);
      if (!ownerKey) {
        return new Response(
          JSON.stringify({ error: "Valid session token required.", auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!CLIENT_ID) {
        return new Response(
          JSON.stringify({ error: "YAHOO_CLIENT_ID not configured in Supabase secrets" }),
          { status: 503, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const returnUrl = body.return_url || "https://warroom.skjjcruz.com/index.html";
      if (returnUrl && !isAllowedBrowserUrl(returnUrl)) {
        return new Response(
          JSON.stringify({ error: "return_url is not allowed" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const db = adminClient();
      const limit = await checkRateLimit(db, 'yahoo-oauth:start', ownerKey, { limit: 10, windowSeconds: 600 });
      if (!limit.allowed) return oauthError('Too many connection attempts. Try again later.', 429);
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const appSession = ownerKey.startsWith('app:') ? await requireActiveAppSession(db, req) : null;
      if (ownerKey.startsWith('app:') && !appSession) return oauthError('Sign in again.', 401);
      // Bound storage growth for abandoned flows.
      await db.from('yahoo_oauth_states').delete().lt('expires_at', new Date().toISOString());
      const { error } = await db.from('yahoo_oauth_states').insert({
        state_hash: await sha256Hex(state), owner_key: ownerKey, return_url: returnUrl,
        session_version: appSession?.sessionVersion || null,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
      if (error) return oauthError('Could not start Yahoo connection.', 503);
      return new Response(JSON.stringify({ auth_url: `${REDIRECT_URI}?start=${state}` }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // ── api: proxy Yahoo Fantasy API request ──
    if (action === "api") {
      const ownerKey = await requesterKey(req);
      if (!ownerKey) {
        return new Response(
          JSON.stringify({ error: "Valid session token required.", auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const { endpoint, session_id } = body;
      if (!endpoint || !session_id) {
        return new Response(
          JSON.stringify({ error: "Missing endpoint or session_id" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      // Security: only allow relative paths to Yahoo Fantasy API
      if (!endpoint.startsWith("/")) {
        return new Response(
          JSON.stringify({ error: "endpoint must be a relative path starting with /" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }

      let record;
      try { record = await getTokenRecord(session_id, ownerKey); }
      catch (e) {
        return new Response(
          JSON.stringify({ error: (e as Error).message, auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }

      let accessToken: string = record.access_token;

      // Refresh proactively if within 60s of expiry
      if (Date.now() > record.expires_at - 60_000) {
        try { accessToken = await refreshAccessToken(session_id, ownerKey); }
        catch (e) { console.warn("[yahoo-proxy] Proactive refresh failed:", e); }
      }

      let yahooRes = await yahooFetch(endpoint, accessToken);

      // Retry once with fresh token on 401
      if (yahooRes.status === 401) {
        try {
          accessToken = await refreshAccessToken(session_id, ownerKey);
          yahooRes = await yahooFetch(endpoint, accessToken);
        } catch (_) {
          return new Response(
            JSON.stringify({ error: "Yahoo auth expired — please reconnect.", auth_required: true }),
            { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      if (!yahooRes.ok) {
        const errText = await yahooRes.text();
        return new Response(
          JSON.stringify({ error: `Yahoo API ${yahooRes.status}: ${errText.slice(0, 300)}` }),
          { status: yahooRes.status, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await yahooRes.json();
      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── refresh: refresh access token on demand ──
    if (action === "refresh") {
      const ownerKey = await requesterKey(req);
      if (!ownerKey) {
        return new Response(
          JSON.stringify({ error: "Valid session token required.", auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const { session_id } = body;
      if (!session_id) {
        return new Response(
          JSON.stringify({ error: "Missing session_id" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        await refreshAccessToken(session_id, ownerKey);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: (err as Error).message, auth_required: true }),
          { status: 401, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response("Method not allowed", { status: 405 });
});
