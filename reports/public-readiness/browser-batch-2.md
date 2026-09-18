# Responsive and live click-path verification — in progress

Branch `codex/readiness-native-20260918`, after `0c1f35e`. No deployment performed.

The initial suites had obsolete labels and scene assumptions. The generic suite also lacked a connected username for its viewport matrix and could pass on the arrival shell before the actual league view loaded. The revised matrix waits for league intelligence, follows the real league deep links, inspects rendered content, adds 320 px, and traverses tabs within each loaded viewport. This is a layout/navigation smoke matrix, not proof of every primary journey.

## Source-established replacement assertions

- Hub → `.hub-experience-card.empire-hero` / Open Empire; then Assets → Players & picks → portfolio detail → the actual Back control.
- On phones, the small dashboard KPI strip was explicitly removed in `js/tabs/dashboard.js`. The test instead expands the existing Market Radar disclosure and clicks its Trades button at 320 and 390 px. Closed details are not misreported as blank visible cards.
- My Team's expanded roster dossier now exposes Signals, an Age Curve, and the user's roster-call control. The former Dynasty Read/Decision Stack headings do not exist in the current render source.
- Waivers opens Plan this waiver → the planning-only acquisition composer → Player details & notebook. The claim is not submitted to a provider.
- Draft's completed-season branch does not expose old pre-draft recommendation cards. Big Board's actual scouting dossier opens and collapses; separate dashboard draft-capital coverage still opens the shared player card.
- Trades uses the current partner select, Managers, and persistent Build a trade action with YOU SEND/YOU GET sides.
- Compare uses the shared accessible Team to compare against listbox, scoped to its own options rather than unrelated Season select options.
- Custom report journeys use the canonical `research-reports` route; legacy Alex sub-tab clicks are scoped to the Office's own navigation so the workspace-level Patterns link cannot take the test out of the legacy view.

## Responsive distinctions

Narrow roster/Alex buttons are inside intentional `overflow-x:auto` strips. The matrix now changes the strip's scroll offset and requires the target to fit within its scrollport and the viewport before accepting it; hidden overflow and oversized controls still fail.

The current + Build button is 32 px tall with a 44×44 pseudo-element target. The old probe eight pixels above the visual box falls outside the intended 44 px target. The revised probe validates at least 44 px of target size and tests near the top of that target after opening Browse players and scrolling the button into view.

A fresh-context 390 px header tap opens the league sheet. Earlier long-context runs hit a 15-second interaction timeout although post-failure diagnostics show the correct header DOM and viewport still present. The final full 126-check run passed this interaction, but the intermittent warm-load delay remains under profiling; one successful run is not treated as proof that the earlier timing problem is gone.

## Isolation and run behavior

Both suites use the external-write guard from batch 1. Layout/click matrices opt into an in-memory per-run snapshot of successful public Sleeper GET responses; this compensates for Playwright routing disabling HTTP caching. Errors are not cached and retry on a later request. Network/recovery tests do not use this option. These reads and local UI actions do not prove backend writes or real account permissions.

Missing browser/dependency/local-server access fails nonzero. Filtered development runs label their scope. Live-click failures print their case immediately and close their pages even when assertions fail. Failure findings are kept distinct from passed-case counts.

## Current evidence

- `node tests/browser-readonly.cjs`: passes write isolation, preflight, sanitized diagnostics, and successful-read snapshot/error-retry behavior.
- `browser-hydrated-final.log`: 126 attempted checks, failed phone-header interaction and obsolete halo probe; not a pass.
- `live-click-filtered.log`: original targeted baseline, 2 passed / 11 failed; source-stale expectations documented above.
- `browser-current-final.log`: **PASS, all 126 checks**, including rendered league views, phone/tablet shell and safe-area probes, 44 px touch target, and Empire filter/detail/back.
- `live-click-final.log`: active full rerun; no final click-path readiness claim yet.

Next: diagnose the header's exact post-failure state, inspect every terminal browser finding, repair genuine defects, rerun focused cases, then provide the integrated candidate and final evidence to the parent release task.
