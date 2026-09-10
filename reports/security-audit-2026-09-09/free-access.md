# Free access and optional personal AI keys

Implemented locally on September 9, 2026. No live subscription, API-key configuration, database, or deployment was changed.

- Every product feature is available without a subscription. Product capability helpers are not administrator roles; server authorization remains in place.
- Billing is outside this task per the owner’s clarification. Checkout, signup subscription provisioning, signin/profile billing metadata, and pricing pages retain their existing behavior. Feature and AI access are independent of billing status.
- Shared AI uses only `GOOGLE_AI_KEY` (environment or existing server Vault secret) and Gemini 2.5 Flash. Owner OpenAI/Anthropic secrets and old paid routing overrides are never read. A provider failure stops the request without fallback.
- Shared Gemini defaults: 30 attempts per user per rolling 24-hour window; 5 per project per rolling minute; 100 per project per rolling 24-hour window. Overrides: `AI_SHARED_USER_DAILY_LIMIT`, `AI_SHARED_RPM`, `AI_SHARED_DAILY_LIMIT`. Provider quotas may be lower. All callers retain the 10 requests/user/minute service limit. Failed requests count toward capacity. Cached shared answers bypass shared quotas; personal requests bypass shared quotas and shared caches.
- Personal Gemini/OpenAI/Anthropic credentials are scoped to the signed-in identity in sessionStorage. Old unscoped credentials are discarded. Keys are sent in request headers only to the app's AI function, held for that request, and never saved to the account, AI response cache, prompt, or application logs. Provider errors are sanitized. Sign-out/account change clears them.
- Google and OpenAI search sources are returned with answers. The app renders source links and isolates Google's Search Suggestions HTML in a sandboxed frame without scripts or access to app storage.
- Normal onboarding skips plan selection; account controls expose `ai-settings.html` alongside existing billing controls. The deployment artifact includes the new settings page.

## Release

Deploy the security migration and backend changes before the frontend, using the existing deployment workflow. The shared-rate limiter requires `20260909000000_security_audit_fixes.sql`.

Keep the owner Gemini key server-side. Billing operations are managed separately by the owner’s partner and are not part of this change.

## Verification

After the billing-scope correction, five affected suites (core, login-auth, AI, billing, security) pass. The earlier broader run also passed bug-capture, analytics, and timeleague. New executable AI tests cover default Gemini-only routing, all three personal providers, no paid fallback, malformed credentials, shared limits, cache isolation, authentication, and session-key isolation. The production build and changed Edge Functions pass compilation. Browser checks use synthetic credentials and mocked provider responses; they do not prove the live owner's key or provider quotas.

Official integration references: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini generateContent grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search), [OpenAI Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search).
