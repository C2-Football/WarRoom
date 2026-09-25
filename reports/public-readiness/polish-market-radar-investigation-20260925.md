# Market radar browser readiness investigation — 25 September 2026

Original integrated gate: `polish-browser-gate.log`, live-click-paths.js: 40/41 cases passed. The market-radar case timed out waiting for `window.App.LI_LOADED === true` inside `newQaPage`, before finding or clicking its widget.

Unchanged focused reproduction:

`WARROOM_CLICK_QA_FILTER='market radar navigates' node tests/live-click-paths.js`

Result: **1 passed, 0 failed; exit 0**. Exact original readiness wait, widget click and Trade Center hash assertion were retained. Log: `polish-market-radar-rerun-20260925.log`. No rebuild, dependency replacement, production edits, assertion changes or provider-data fixtures were used.

Classification: an intermittent pre-click readiness timeout. The original gate output did not capture which dependency failed to load, so a CDN or provider failure is a possibility, not an established cause. The focused pass proves the unchanged navigation case succeeds on the current candidate; it does not erase the original timeout.

Source inspection: `newQaPage` waits for the league-intelligence flag, then the dashboard widget. The loader depends on current league state and public provider data before setting the flag or restoring its cache. All live-click cases share one context with read-only public-response caching. The current `js/app.js` polish diff changes hub copy only; it does not modify the engine loader. No changes to the canonical/vendored engine were made.

The single full unchanged rerun reports **41 passed, 0 failed, 0 findings**, recorded in `polish-live-click-full-rerun-20260925.log`. No readiness timeout recurred. Final browser/server cleanup completed; the process exited 0 and its PID was confirmed absent. No silent retry loop was used.
