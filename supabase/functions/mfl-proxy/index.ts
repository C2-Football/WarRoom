// ══════════════════════════════════════════════════════════════════
// mfl-proxy — Supabase Edge Function
// Proxies requests to the MyFantasyLeague API to bypass CORS.
// MFL explicitly blocks cross-origin browser requests, so this
// Edge Function acts as a server-side relay.
//
// POST body: { url: string }
// The url must start with https://api.myfantasyleague.com/ or
// https://www followed by myfantasyleague.com to be accepted.
// ══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map<string, { bucket: number; count: number }>();

function isValidMflUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && (parsed.hostname === "myfantasyleague.com" || parsed.hostname.endsWith(".myfantasyleague.com"));
  } catch {
    return false;
  }
}

function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP")
    || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || req.headers.get("X-Real-IP")
    || "unknown";
}

function checkRateLimit(req: Request): boolean {
  const id = clientIp(req);
  const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const current = rateBuckets.get(id);
  if (!current || current.bucket !== bucket) {
    rateBuckets.set(id, { bucket, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_MAX;
}

serve(async (req: Request) => {
  const responseHeaders = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  if (!checkRateLimit(req)) {
    return new Response(
      JSON.stringify({ error: "Proxy rate limit exceeded. Try again shortly." }),
      { status: 429, headers: { ...responseHeaders, "Content-Type": "application/json", "Retry-After": "60" } }
    );
  }

  try {
    const { url, method, cookie, form, login } = await req.json();

    if (!url || !isValidMflUrl(url)) {
      return new Response(
        JSON.stringify({ error: "Invalid URL — only myfantasyleague.com URLs are allowed" }),
        { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseHeaders: Record<string, string> = {
      "User-Agent": "FantasyWarRoom/1.0",
      "Accept": "application/json",
    };
    if (cookie) baseHeaders["Cookie"] = String(cookie);

    // Login mode: POST credentials as a FORM body (keeps the password out of the
    // URL) and return the MFL_USER_ID auth token + resolved shard host. Nothing
    // is persisted server-side.
    if (login) {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
        body: typeof form === "string" ? form : "",
      });
      const text = await res.text();
      let mflUserId: string | null = null;
      const getSC = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const setCookies = typeof getSC === "function" ? getSC.call(res.headers) : [];
      for (const sc of setCookies) { const m = String(sc).match(/MFL_USER_ID=([^;]+)/); if (m) { mflUserId = m[1]; break; } }
      if (!mflUserId) { const bm = text.match(/MFL_USER_ID="?([^";\s<]+)"?/); if (bm) mflUserId = bm[1]; }
      let host: string | null = null;
      try { host = new URL(res.url).host; } catch { host = null; }
      const failedText = /invalid|incorrect|denied|not\s*log|error/i.test(text) && !mflUserId;
      const message = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      return new Response(
        JSON.stringify({ ok: !!mflUserId && !failedText, mflUserId, host, message }),
        { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    // Writes (e.g. TYPE=lineup import) arrive as method:'POST'; params stay in the
    // query string so a shard 302 still carries them. With a cookie we resolve the
    // redirect MANUALLY and re-send the Cookie to the shard (fetch drops it on a
    // cross-host redirect otherwise).
    let mflRes = await fetch(url, {
      method: method === "POST" ? "POST" : "GET",
      headers: baseHeaders,
      redirect: cookie ? "manual" : "follow",
    });
    if (cookie && mflRes.status >= 300 && mflRes.status < 400) {
      const loc = mflRes.headers.get("location");
      if (loc && isValidMflUrl(loc)) {
        mflRes = await fetch(loc, { method: method === "POST" ? "POST" : "GET", headers: baseHeaders });
      }
    }

    if (!mflRes.ok) {
      const status = mflRes.status;
      let msg = `MFL API error ${status}`;
      if (status === 401 || status === 403) {
        msg = "MFL authorization failed — your login may have expired. Reconnect and try again.";
      } else if (status === 429) {
        msg = "MFL rate limit reached. Wait a moment and try again.";
      }
      return new Response(
        JSON.stringify({ error: msg }),
        { status, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await mflRes.text();
    return new Response(data, {
      status: 200,
      headers: { ...responseHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[mfl-proxy] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Proxy error" }),
      { status: 500, headers: { ...responseHeaders, "Content-Type": "application/json" } }
    );
  }
});
