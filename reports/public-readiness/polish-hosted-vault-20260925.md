# Hosted Vault smoke — 25 September 2026

**Pass on both production and sandbox**, revision `46c65405542d35233bfb44596e8a80eca7394a33`. Cache-busted release manifests matched independently before and after the journeys. All observed Vault modules and four historical-data files returned HTTP 200 from their respective deployed destinations.

| Check | [Production](https://c2-football.github.io/WarRoom/) | [Sandbox](https://c2-football.github.io/WarRoom-sandbox/) |
|---|---|---|
| Public Hub → Vault setup | Pass | Pass |
| Existing Solo / Position Roulette / Snake, reveal six eras, start draft | Pass | Pass |
| Make one legal historical player pick | Patrick Mahomes | Christian McCaffrey |
| Reload, reopen through Hub, preserve same local league and 1/12 human picks | Pass | Pass |
| Setup and draft at 320×844 and 390×844 | No horizontal overflow | No horizontal overflow |
| Setup / draft-pick action height | 50 px / 44 px | 50 px / 44 px |
| League options → Back to dashboard | Pass | Pass |
| Uncaught page exceptions | 0 | 0 |

These were fresh, separate browser profiles using the actual deployed JavaScript, CSS and historical archive. The only URL query was `release-smoke=46c6540` for identification: **no `dev=true`, injected account/league fixtures, synthetic player archive, or preloaded campaign**. The public UI supplied its normal anonymous Commander identity. Draft clock was explicitly switched off and AI pace set to 0.5s using the existing settings; all other selected modes were retained. Saves were created and changed only through normal UI actions.

Every external mutation was blocked before navigation, including analytics and backend calls. Read requests were allowed only to the Pages host and its configured dependency/font CDNs. This intentionally excludes hosted auth, provider integrations and multiplayer. Production and sandbox share an origin, but their test browser profiles and generated local league IDs were separate.

[Numeric/request evidence](polish-hosted-vault-20260925.json) includes exact served URLs, archive response status, release metadata, layout measurements, blocked request paths and screenshot hashes. Actual captures:

- Production: setup [320](polish-hosted-vault-20260925/live-setup-320.png) / [390](polish-hosted-vault-20260925/live-setup-390.png); reopened draft [320](polish-hosted-vault-20260925/live-reloaded-draft-320.png) / [390](polish-hosted-vault-20260925/live-reloaded-draft-390.png).
- Sandbox: setup [320](polish-hosted-vault-20260925/sandbox-setup-320.png) / [390](polish-hosted-vault-20260925/sandbox-setup-390.png); reopened draft [320](polish-hosted-vault-20260925/sandbox-reloaded-draft-320.png) / [390](polish-hosted-vault-20260925/sandbox-reloaded-draft-390.png).

An initial live assertion found two copies of the drafted player's name in the roster region; the corrected harness used the first exact match and retained the independent 1/12 check. This was a selector ambiguity, not a product failure. Console output contains expected blocked-network/analytics messages and existing CSP/diagnostic warnings; it is not a zero-console-message claim.

No production files were changed. This confirms the bounded public solo journey and local-save recovery on deployed assets, not native/physical-device behavior, authenticated persistence, multiplayer or complete-suite launch readiness.
