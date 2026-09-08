# The Vault beta access and architecture review

September 8, 2026. Scope: onboarding, accounts, saved progress, online league integrity, release boundaries, and operations. Gameplay and visual grades are covered by the accompanying full-season review.

## Recommendation

Start with **5–10 invited, trusted testers** after the integrated release is verified. Keep the static app, shared game engine, and server-authoritative multiplayer actions. They are a reasonable foundation for this size of beta; a framework or backend rewrite would add risk without solving the immediate issues.

Solo can be distributed without an account. Friends leagues should use the new Vault email sign-in route and commissioner or majority-vote advancement. Do not market public, ranked, or prize-bearing multiplayer yet: the online draft snapshot exposes information that the interface treats as sealed.

## Entry points and tester setup

The intended release entry is [The Vault](https://c2-football.github.io/WarRoom/index.html?vault=1). Its scoped account page is [Vault sign-in](https://c2-football.github.io/WarRoom/login.html?vault=1). These are the routes to share **after release verification**; this browser pass verified the current local changes, not their live deployment.

1. Send the direct Vault link to the initial group. Ask them to use a regular browser tab and keep the same browser/device for solo games.
2. For solo, choose **Play Solo** and start a Position Roulette league. No account, Sleeper connection, or Dynasty HQ subscription is required. Solo progress is stored on that browser; clearing site data, private browsing, or switching devices can lose access to it.
3. For friends, choose **Play with Friends → Sign in**. Create an email/password account or sign in to an existing one. Each person needs a separate account. Use this scoped page rather than the general Dynasty HQ sign-in page.
4. The host creates the league with the desired human seats and AI teams. Under **Invite / Friends & invites**, share a different seat link with each friend. Wait until all human seats are joined, then open the draft room.
5. For the first sessions, use commissioner advancement or majority vote. Timed advancement currently requires a manager to have the room open; it is not an unattended server scheduler.
6. Ask every tester to complete a draft, claim a player, adjust a lineup, answer a trade/message, finish a game, advance a week, close/reopen the browser, and continue the season. The host should separately complete a two-account reconnect and simultaneous-action test before expanding the cohort.
7. Use **Report a bug** on setup, league options, or mobile More. Include the device/browser, what happened, what was expected, and reproduction steps. The form supplies the Vault screen/week context. Do not put passwords or private invite links into the report.

The sandbox is a frontend preview, **not an isolated test service**. Main and sandbox currently share the Supabase project and the `c2-football.github.io` browser origin. Their browser storage can overlap. Do not treat a sandbox league or account as disposable production-free data.

## Actual browser verification

Used a fresh Playwright browser session at `http://vaultbeta.localhost:3014`, serving the current source. This loopback hostname does not match the app's exact localhost development-login checks. The runtime showed no signed-in account, no username, sandbox false, and no existing solo league keys. Checked desktop and 390 × 844 mobile views.

| Scenario | Observed result |
| --- | --- |
| Open `index.html?vault=1` as a guest | Direct Vault setup; Play Solo selected; account-free/device-save copy and Start Solo Draft visible. |
| Select Play with Friends | Sign-in callout links to `login.html?vault=1`. |
| Vault sign-in | Email/password, sign-in/create-account tabs, password recovery, Vault return link; no Google/Apple or Sleeper-username option. |
| Vault create-account tab on mobile | Optional display name, email and password fields fit the viewport; no clipped form controls. |
| Back from scoped login | Returns to `index.html?vault=1` and Vault setup. |
| Vault Back button | Removes only the Vault query parameter and returns to the Dynasty HQ hub. |
| Normal `login.html` | Retains Google, Apple, email-or-Sleeper sign-in, general account creation, and the Dynasty HQ return link. |
| Report a bug | Opens existing feedback form with `The Vault · League setup` and reproduction prompts; cancel works. No report submitted. |

Screenshots: `output/playwright/vault-direct-entry.png`, `vault-email-entry.png`, `vault-signup-mobile.png`, `vault-global-login.png`, and `vault-report-bug-mobile.png`.

No account was created, no authentication form was submitted, no invitation was claimed, no league was created, and no message/report was sent in this pass. It proves guest entry, presentation, and navigation; it does **not** prove a fresh live email signup, password recovery, or cross-device online play. An unrelated MFL proxy request was rejected by CORS on this custom local hostname, and the existing meta CSP warning remained. Neither prevented the checked Vault flows; the preview cannot establish production-origin CORS behavior.

The new `tests/time-league-beta-entry.cjs` additionally executes scoped/global login behavior with mocked responses, pending-invite retention, safe report context, replay visibility, mobile Community labeling, and the playoff option cap. Existing login-contract, invitation, recovery, identity, community, integration-render, owner-workspace, and setup tests passed during this review. These automated checks supplement, rather than replace, live account verification.

## Production security must-fix checklist

| Priority / release boundary | Finding and minimum next step | Evidence |
| --- | --- | --- |
| **P0 before competitive/public multiplayer** | The load endpoint returns the full engine seed and roster `drawnSeason` values during a sealed draft. A technical player can inspect the hidden season and derive future draws. Create an explicit public snapshot model, retain private randomness on the server, and test every draft/load/reconnect path. Do not patch this with a fake year or null field that breaks normalization. | `supabase/functions/time-league/index.ts:57`; `js/shared/time-league-engine.js:343,422–429,981–985,1163–1183`. |
| **P1 before widening account access** | Complete live email signup/sign-in/recovery with two owned test accounts. Keep Vault email-only until OAuth identities are exchanged into the app account/session contract. The general OAuth route currently does not establish the app-user ID that Vault requires. | `login.html:327–493`; `reconai-shared/supabase-client.js` account helpers; `supabase/functions/_shared/security.ts:96–107`; `js/shared/time-league-remote-client.js:5–10`. |
| **P1 before treating previews as disposable** | Separate test backend and browser-storage namespaces from production, or explicitly operate a single shared environment. Current repository separation does not isolate accounts, leagues, or browser saves. | `reconai-shared/supabase-client.js:13`; `.github/workflows/deploy-functions.yml`; Vault local storage keys. |
| **P1 before public discovery** | Exercise room creation limits, abuse controls, and load budgets with the intended signup volume. Invitations protect league seats; they are not a platform-wide beta allowlist. If access must be invite-only, enforce that on the server. | Email signup and `supabase/functions/time-league/index.ts` create/join paths. |
| **P1 operational release gate** | Verify the deployed revision and assets, migration/Edge compatibility, one fresh signup, and a real two-account room on the exact shared URL. Rehearse rollback and database restore; assign someone to review bug reports. | Current workflow changes add Vault tests, pinned shared sources, unique Pages artifacts, and `release.json`; local changes alone do not prove deployment or restore readiness. |

Useful integrity foundations are already present: server-computed actions rather than client state replacement, authenticated membership checks, version-based conflict rejection, seat-claim controls, private queues/bids/messages, and opt-in public profiles. Preserve these contracts while closing the sealed-draft gap.

## Small follow-ups after the invited cohort

- **Save portability:** provide a supported solo backup/export or cloud-save path before users accumulate seasons they expect to keep permanently. Current writes protect the last valid browser save when storage fails, but do not protect against clearing browser data.
- **Room efficiency:** replace constant full-state polling with visibility-aware refresh and version/delta checks when measured traffic justifies it. Current online rooms refresh about every three seconds and include message history; no scale claim has been validated.
- **Unattended deadlines:** move scheduled advancement into a server job before promising rooms will advance while everyone is offline. Keep commissioner/vote controls as recovery paths.
- **Leaderboard meaning:** retain opt-in visibility and server-derived records. Different scoring and league formats mean a global points table is not yet a standardized competitive ranking.

## Architecture grades

| Parameter | Grade | Reason |
| --- | --- | --- |
| Guest onboarding | B+ | Direct, account-free Vault entry now works in a fresh browser. Real email authentication remains a separate release check. |
| State integrity | B+ | Server authority, membership checks, conflict handling, and recovery are established. |
| Private communication/seat access | B+ | Scoped reads and controlled invitations; broader abuse/load testing remains. |
| Competitive draft integrity | D | Sealed information is exposed in the online payload. This is the clearest public-launch blocker. |
| Save portability | C | Browser-local solo saves with no supported backup/restore between devices. |
| Scale and unattended play | C+ | Suitable architecture for a small measured cohort; polling and browser-driven deadlines limit broader claims. |
| Release operations | B−, provisional | Targeted test gates and revision manifests improve the path; exact release and restore proof must still be recorded. |

**Decision:** invited, trusted beta with explicit boundaries; public competitive launch after the sealed-state and operational gates are closed.
