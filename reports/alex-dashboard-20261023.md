# Build with Alex — flexible dashboard builder

Implemented in `/Users/jacobc/Projects/warroom-alex-dashboard-20261023`, branch `feat/alex-dashboard-20261023`, based on `origin/main` at `17f6892b7c83afcea233e4b4239e5401dbe1fb8d`. The first layout editor is commit `d9cbf28`; this revision expands it to create new data views.

## Behavior

- Replaces the widget picker with **Build with Alex** on customizable Home dashboards. Existing redraft and Chopped curated layouts retain their rules.
- Alex can choose data, filters, grouping, aggregates, columns, ordering and a visual from a conversation. New views are not predefined widget recipes. Initial data sources are the owner's roster, all league rosters, league records, and the loaded activity sample.
- New views render as tables, bar charts, cards, or a single aggregate/value. Visual options edit title, chart type, axes, accent color, and spacing directly, without another model request. Follow-up conversation targets the selected view.
- The app resolves values from real loaded data; generated responses contain only a validated query/presentation specification. Unknown fields, formulas, executable code and unsupported sources are rejected. Missing data remains unavailable, projected ages do not masquerade as reported ages, and incomplete aggregates/activity disclose their coverage.
- Shows the actual dashboard in a separate preview. Home changes only on Save. Draft Undo, discard, persistent **Undo last save**, and compatibility with existing saved layouts remain available.
- Layout/history are scoped to account and league on this browser. Rich history is trimmed within the readable storage budget; oversized single layouts fail before writing. This is not cross-device dashboard sync.
- Phone Home keeps sections in order and expanded. The builder uses Edit/Preview tabs, 44px targets, 16px inputs, safe-area spacing, and keyboard-aware height. Wide tables scroll within their card and remain keyboard accessible.
- Uses the existing authenticated `OD.callAI` / `recon-chat` route with the semantic data catalog. Provider credentials remain in the existing adapter. Failed, canceled or late account replies do not change the saved dashboard.
- Preview rendering cannot publish Intel/waiver recommendations, change global rankings preferences, or submit fantasy transactions.

## Reminders and the delivery boundary

Users can save daily/weekly reminder drafts with a time, IANA time zone, view, and email/push choice. Drafts save separately from the dashboard. An explicit enable action schedules delivery only after the authenticated service confirms readiness. These are scheduled reminders to review a view, not score/injury condition alerts.

The owner backend now implements account-owned storage, email verification and opt-in, a scheduled delivery worker, retries and receipts, Web Push registration, and unsubscribe/pause handling. The browser provides explicit email setup and push connection, safe account/device binding, and logout cleanup. A static unsubscribe page works on the production host and sends no request until confirmation. The notification worker is included in release asset hashes.

The service remains in its owner deployment lane, separate from C2 game functions. Its implementation and authentication contract are documented in [dashboard-reminder-service-contract.md](dashboard-reminder-service-contract.md). Current local test evidence is in [reminder-validation.md](dashboard-builder/reminder-validation.md); hosted revision, scheduler and actual delivery evidence are recorded separately during release. Mocked/local test success alone does not prove real delivery.

Season fantasy-point fields also remain unavailable on this Home integration until the caller supplies a verified matching-season stats snapshot. Team record/points-for data and roster metadata are available independently; the builder never substitutes projections or the time-travel selector's unverified statistics.

## Initial builder verification

This section records the earlier builder-only checks; current reminder validation is linked above.

Passed locally:

- `npm run test:dashboard-builder`: 54 groups across builder state/storage, data queries, rendering, reminder contract, and preview side-effect isolation.
- `npm run test:core`: 97 tests.
- `npm run test:dashboard-league`: existing layout, league data, widget, missing/zero/stale score, and Cup behavior.
- `npm run test:design-tokens`: four contracts.
- Focused ESLint: zero errors. `league-detail.js` retains its pre-existing unused `avatarKey` warning.
- `git diff --check`.
- Production build: 165 JSX scripts / 311 total modules; new scripts are included and existing release packaging covers root CSS files.
- Real-app Chromium acceptance at 320×700, 390×844, 667×375, 1365×900, and reduced 390×360 phone height. All four journeys passed with zero browser runtime errors.

Browser checks cover conversational changes, new grouped data views, visual edits without extra AI calls, selected-view targeting, nested table scrolling, save/reload, draft/persistent undo, discard, quota failure/retry, invalid/503 replies, late cancellation, account/league boundaries, focus trapping/restoration, touch reachability, and no page overflow. Reminder checks include persistent timezone/channel drafts, inactive status, and no outgoing delivery mutation.

Evidence lives under `output/playwright/dashboard-builder/`: `results.json`, conversation/preview images, custom-view images, visual-options images, and reminder images. Provider data and AI responses are controlled fixtures; external writes are blocked. This is local browser emulation, not live-model quality, authenticated hosted service, physical-device, Safari, or production deployment proof. WebKit was unavailable in this environment.

To run locally, sync the shared dependency pinned in `.github/workflows/deploy.yml` before starting the app. The browser acceptance runner supplies its own isolated local server and fixtures.
