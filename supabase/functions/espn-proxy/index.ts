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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map<string, { bucket: number; count: number }>();

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
