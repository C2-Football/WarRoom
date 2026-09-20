const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'https://jcc100218.github.io',
  'https://c2-football.github.io',
  'https://skjjcruz.github.io',
  'https://warroom.skjjcruz.com',
  // Live marketing/app domain (dhqfootball.com cutover).
  'https://dhqfootball.com',
  'https://www.dhqfootball.com',
  // Capacitor native app origins. iOS serves the bundled web app from the
  // 'capacitor' scheme; Android uses the 'https' scheme (see
  // capacitor.config.json androidScheme). Without these the WebView's fetch to
  // this function is blocked by CORS and every AI call fails to load.
  'capacitor://localhost',
  'https://localhost',
];

export function allowedOrigins(): string[] {
  const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function isAllowedBrowserUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return allowedOrigins().includes(parsed.origin);
  } catch {
    return false;
  }
}
