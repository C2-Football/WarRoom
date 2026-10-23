# Build with Alex — first version

Implemented on `feat/alex-dashboard-20261023`, based on `origin/main` at `17f6892b7c83afcea233e4b4239e5401dbe1fb8d`.

## Behavior

- Replaces the widget picker with a visible **Build with Alex** entry on customizable Home dashboards. Existing redraft and Chopped curated layouts retain their rules.
- Supports conversational addition, removal, ordering, size/detail changes, and supported primary metrics using the registered dashboard components.
- Shows the actual dashboard components in a separate preview. The saved Home does not change until Save.
- Provides draft Undo, discard confirmation, and persistent **Undo last save** on Home.
- Stores the exact layout and bounded history per account and league on this browser/device. Removed sections stay removed after reload; existing layouts remain the starting point. No cross-device sync is claimed.
- Keeps custom Home sections in the requested order and expanded on phones. The editor uses Edit/Preview tabs, 44px controls, a 16px input, safe-area spacing, and keyboard-aware height.
- Uses the existing authenticated `OD.callAI` / `recon-chat` route. Validates the complete response against a bounded component schema. It does not execute generated code, generate fantasy statistics, or submit fantasy transactions.
- Preserves the draft on errors; supports retry/cancel; rejects late account replies, stale-tab saves, invalid components, sizes, metrics, and identifiers.
- Preview rendering cannot publish Intel/waiver recommendations, change global rankings preferences, or navigate away.

## Verification

Passed:

- `npm run test:dashboard-builder`: 15 engine behavior groups and four read-only preview groups.
- `npm run test:dashboard-league`: layout, league data, widgets, missing/zero/stale scores, and Cup behavior.
- `npm run test:core`: 97 tests.
- AI routing and format-context tests; first-class mode and intelligence-surface contracts; design-token contracts.
- Waiver evidence and nine Analyst Mock tests.
- `npm run test:dashboard-builder-browser`: the real app in Chromium at 320×700, 390×844, 667×375, and 1365×900, plus reduced 390×360 height. All four journeys passed with zero browser runtime errors.
- Browser checks cover preview order, follow-up conversation, save/reload, both Undo paths, discard, quota failure/retry, invalid/503 AI replies, canceled late replies, league isolation, touch target reachability, no horizontal overflow, keyboard focus trap, and focus return.
- Production compilation, focused lint (no errors; pre-existing unused-variable warnings remain), and `git diff --check`.

Browser evidence is under `output/playwright/dashboard-builder/`, including `results.json`, phone conversation/preview images, desktop images, and short-landscape images. Provider data and AI responses were controlled fixtures; external writes were blocked. This is local browser evidence, not live AI output quality, authenticated production, physical-device, or deployment verification. WebKit could not launch because its installed browser executable was missing; Safari is unverified.

## Scope and follow-up

No backend migration or deployment was performed. This version composes existing supported sections; custom tables, arbitrary filters, named dashboards, and account sync are outside the first version. A real signed-in AI request and Safari/physical-device check remain appropriate before release.

To run locally with the release's canonical shared dependency, sync from the dependency revision pinned in `.github/workflows/deploy.yml`, then use the existing `npm start` workflow. The browser acceptance runner supplies its own isolated local server and fixtures.
