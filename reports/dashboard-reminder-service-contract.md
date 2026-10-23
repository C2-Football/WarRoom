# Dashboard reminder delivery contract

The first browser version saves daily/weekly reminder **drafts**, scoped to an account and league in localStorage. Email and push stay **Delivery not connected** unless a fresh authenticated service response confirms channel readiness. Saving a draft does not schedule a send. These are timed reminders to review a dashboard view, not score/injury condition alerts. The Home view must be saved before the enable button becomes available. A dashboard itself is still local to that browser; a reminder link opens league Home and must not promise a synced dashboard on another device.

No notification endpoint, scheduler, provider configuration, or push registration is deployed by this change. The existing Resend password-reset transport is evidence of a reusable provider pattern, not an email reminder service. `supabase/functions/README.md` assigns account operations to `skjjcruz/github.com-skjjcruz-owner-dashboard-dev`. Implement and release the following through that owner lane and its reviewed migration/cutover; do not include it in WarRoom's C2 edge deploy.

## Client contract

Endpoint: configured Supabase URL plus `/functions/v1/fw-dashboard-reminders`. Follow the existing `fw-commish-ignored` authentication convention: app JWT in `Authorization: Bearer`, public `apikey`, JSON, `Cache-Control: no-store`, allowed app origins. Derive account identity and session version server-side with `requireActiveAppSession`; never trust a caller's owner ID. Reject inconsistent subject/user IDs. Authorize access to the league. Session email alone is not verification: password signup/signin currently does not require `email_verified`.

`GET ?leagueId=<id>[&deviceKey=<sha256 subscription endpoint>]` returns a complete list (maximum 24) for the authenticated account and league:

```json
{
  "version": 1,
  "accountId": "app-user-id",
  "leagueId": "league-id",
  "channels": {
    "email": { "available": false, "recipientVerified": false },
    "push": { "available": false, "subscriptionReady": false, "deviceKey": null }
  },
  "reminders": []
}
```

Email `available` is true only after the delivery worker/provider is configured and healthy, and `recipientVerified` only for the account's current authoritative verified email and permitted reminder opt-in. Do not accept a recipient from the browser. Never use the password-reset endpoint for reminders.

Push is ready only for the authenticated account's registered, enabled subscription matching `deviceKey`. The client reads an already-granted browser subscription and hashes its endpoint; it does not request permission, subscribe, or put an endpoint in localStorage. Returning a device key without a matching current browser subscription cannot enable push. A future explicit “Connect push” flow must request permission directly from a user button, securely register endpoint/keys with this account, and provide removal/revocation. Do not offer push readiness before that registration/delivery path exists. Native push requires its own supported registration route.

An enabled record has the draft fields below plus `state: "enabled"`, a positive integer `revision`, and a server-computed ISO `nextRunAt`. Paused records use `state: "paused"` and `nextRunAt: null`. The GET list must include remote records even when the device has no local draft; the panel merges them so they remain visible and pausable.

Only an explicit enable/update/pause action posts. Enabling requires a fresh readiness check and a view saved in Home:

```json
{
  "action": "enable",
  "operationId": "unique-operation-id",
  "expectedRevision": 0,
  "reminder": {
    "id": "rem_unique-id",
    "viewId": "alex_view-id",
    "title": "Check my roster",
    "channel": "email",
    "schedule": {
      "frequency": "weekly",
      "day": 2,
      "time": "09:00",
      "timeZone": "America/Chicago"
    }
  }
}
```

Push adds the existing `deviceKey`. Daily schedules use `day: null`; weekly uses Sunday=0 through Saturday=6. `pause` uses the same record ID and expected revision, and must remain permitted when delivery is unhealthy or the original dashboard view has been removed. A successful POST returns `{version, accountId, leagueId, reminder}` with exact normalized requested fields, advanced revision, confirmed state, and next run. Pause does not alter a schedule based on an untrusted stale draft. Return 409 on revision conflicts; retrying the same operation ID must recover its original response. The client consumes a readiness result once, rechecks after mutations, and never marks a timeout/error as active. Do not expose a send-now/test-send action through this contract.

## Minimal owner backend

- Durable account-owned reminders, unique by `(user_id, league_id, id)`, with the validated schedule, channel, state, revision, next run, relevant verified recipient/subscription reference, and timestamps. Server-only writes; enforce session revocation, ownership, rate limits, bounded strings, maximum records, timezone validity, and compare-and-swap in one transaction. Server-generated app links only; escape titles in HTML. Never store an AI-generated executable query or markup.
- Idempotent operation receipts and a delivery ledger keyed by reminder and scheduled occurrence. A worker claims due jobs atomically with a lease, rechecks account/channel/opt-in status, sends through Resend or Web Push, records outcome, and advances the schedule. Provider retries need deterministic idempotency and backoff; failed push subscriptions are disabled. The worker must run independently of an open browser and expose health that drives capabilities.
- Calculate recurrence on the server in the specified IANA timezone, preserving local wall-clock time through daylight saving. On a skipped local time use the first valid instant afterward that day; on repeated local time send once at the earliest occurrence. Return the computed next run so the UI never infers delivery from a browser timer. Define retry limits, retention, account deletion cleanup, and pause/unsubscribe behavior before activation.
- A separate verified email/opt-in and push registration route if absent. Changing an email/subscription or deleting an account disables or re-verifies affected reminders. Worker transactions must not continue a revoked account's schedule. Condition alerts require a separate server data refresh/evaluation design; they are not included here.

## Validation boundary

`node tests/dashboard-reminders.cjs` covers local account/league isolation, schedule validation, storage failures and stale writes, auth switching, channel readiness and tamper gating, unsaved views, response validation, unknown mutation outcomes, existing push binding, and remote-only pause. Its service is mocked. Browser layout checks are separate. No real email, push, scheduler, authenticated hosted endpoint, or production delivery is proven by these tests.
