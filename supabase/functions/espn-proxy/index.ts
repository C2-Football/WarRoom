// ══════════════════════════════════════════════════════════════════
// espn-proxy — Supabase Edge Function
// Proxies requests to the ESPN Fantasy API with Cookie header.
// Browsers cannot set Cookie headers directly (forbidden header name),
// so this function acts as an intermediary for private league access.
//
// POST body: { url: string, espnS2: string, swid: string }
// ══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 60;

serve(async (req: Request) => {
  const responseHeaders = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  const limit = await checkRateLimit(`espn-proxy:${clientIp(req)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  const limited = rateLimitResponse(limit, responseHeaders);
  if (limited) return limited;

  try {
    const { url, espnS2, swid } = await req.json();

    if (!url || !url.startsWith("https://lm-api-reads.fantasy.espn.com/")) {
      return new Response(
        JSON.stringify({ error: "Invalid URL — only ESPN Fantasy API URLs are allowed" }),
        { status: 400, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (espnS2 && swid) {
      headers["Cookie"] = `espn_s2=${espnS2}; SWID=${swid}`;
    }

    const espnRes = await fetch(url, { headers });

    if (!espnRes.ok) {
      return new Response(
        JSON.stringify({ error: `ESPN API error ${espnRes.status}` }),
        { status: espnRes.status, headers: { ...responseHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await espnRes.json();
    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[espn-proxy] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Proxy error" }),
      { status: 500, headers: { ...responseHeaders, "Content-Type": "application/json" } }
    );
  }
});
