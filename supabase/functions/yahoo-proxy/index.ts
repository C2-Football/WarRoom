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
//     → { auth_url } — builds Yahoo OAuth URL (client_id stays server-side)
//   GET  ?code=XXX&state=XXX (Yahoo callback)
//     → exchanges code for tokens, stores session, redirects to app
//   POST { action:'api', endpoint, session_id }
//     → proxies Yahoo Fantasy API request with stored access token
//   POST { action:'refresh', session_id }
//     → refreshes expired access token
// ══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5";
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
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  for (const envName of ["JWT_SECRET", "SUPABASE_JWT_SECRET"]) {
    const secret = Deno.env.get(envName);
    if (!secret) continue;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
      const metadata = (payload as Record<string, any>).app_metadata || {};
      const appUserId = metadata.user_id || payload.sub;
      if (appUserId && /^[0-9a-f-]{36}$/i.test(String(appUserId))) return `app:${appUserId}`;
      const sleeperUsername = metadata.sleeper_username || (payload as Record<string, any>).sleeper_username;
      if (sleeperUsername) return `sleeper:${String(sleeperUsername).toLowerCase()}`;
    } catch {}
  }
  return null;
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
  if (error) console.error("[yahoo-proxy] storeTokens error:", error.message);
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
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return new Response(
        `<html><body><p>Yahoo auth error: ${oauthError}. Close this tab and try again.</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    if (!code) {
      return new Response("Missing code parameter.", { status: 400 });
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(
        `<html><body><p>Yahoo credentials not configured. Add YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET to Supabase secrets.</p></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }

    try {
      // Decode return URL from state (encoded as base64 JSON by startAuth)
      let returnUrl = "";
      let ownerKey = "";
      try {
        const stateObj = JSON.parse(atob(state || ""));
        returnUrl = stateObj.return || "";
        ownerKey = stateObj.ownerKey || "";
      } catch (_) {
        returnUrl = state || "";
      }
      if (!ownerKey) {
        return new Response(
          `<html><body><p>Yahoo auth failed: missing owner binding.</p></body></html>`,
          { status: 400, headers: { "Content-Type": "text/html" } }
        );
      }
      if (returnUrl && !isAllowedBrowserUrl(returnUrl)) {
        return new Response(
          `<html><body><p>Yahoo auth failed: return URL is not allowed.</p></body></html>`,
          { status: 400, headers: { "Content-Type": "text/html" } }
        );
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

      // Redirect back to app with session ID
      const appUrl = returnUrl
        ? `${returnUrl}?yahoo_session=${sessionId}`
        : `/?yahoo_session=${sessionId}`;

      return Response.redirect(appUrl, 302);
    } catch (err) {
      console.error("[yahoo-proxy] Callback error:", err);
      return new Response(
        `<html><body><p>Yahoo auth failed: ${(err as Error).message}</p></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
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
      const returnUrl = body.return_url || "";
      if (returnUrl && !isAllowedBrowserUrl(returnUrl)) {
        return new Response(
          JSON.stringify({ error: "return_url is not allowed" }),
          { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
        );
      }
      const state = btoa(JSON.stringify({
        return: returnUrl,
        ownerKey,
        nonce:  crypto.randomUUID().slice(0, 8),
      }));
      const authUrl = [
        YAHOO_AUTH_URL,
        `?client_id=${encodeURIComponent(CLIENT_ID)}`,
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        `&response_type=code`,
        `&scope=${encodeURIComponent("fspt-r")}`,
        `&state=${encodeURIComponent(state)}`,
      ].join("");
      return new Response(
        JSON.stringify({ auth_url: authUrl }),
        { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
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
