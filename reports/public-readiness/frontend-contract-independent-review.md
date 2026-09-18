# Landing and redraft rail independent review — 2026-09-18

## Live redraft rail

Initial independent review of `0c1f35e` found a material specificity regression: a 600px `.is-live-redraft` room retained three rail columns because the older two-class selector outranked the new one-class container selector. The native/browser owner corrected this in `7ac8e30` by matching redraft specificity within the responsive container rule.

Independently inspected the correction and reran the committed `verifyLiveRedraftRail` helper against the native worktree preview on port 3500. All three checks passed: real React fixture at 842px and 600px room widths had one column with Manual Pick, View teams, and Exit contained; the separate 320px phone renderer supported Teams/Board selection, a reachable Draft action, and the current-action button opening the board. External writes were guarded by the fixture helper. No unresolved material finding for this CSS delta. Evidence is responsive browser only.

## Accepted landing contract

Reviewed root's pending replacement of `tests/landing-content-contract.js` and retirement of its obsolete editor-schema quarantine. The accepted landing page is authored directly in static HTML; restoring the disconnected editor's four-plan schema would contradict the current design. The replacement protects actual arrival behavior: signup and signin destinations, existing upgrade route, project-relative local destinations, illustrative-data disclosure, development-tier labeling, and an accessible billing group. No landing UI, pricing, or business policy changes are included.

`node tests/landing-content-contract.js` passed independently. Existing real signup browser coverage complements these static assertions; the test does not claim a source assertion alone proves signup runtime behavior. Suggested a small follow-up assertion on signup target origin as well as path/query; no current production issue was found. Removing the stale quarantine is consistent with the user's current direction to examine obsolete assertions and replace them with meaningful coverage while preserving accepted design. No unresolved material finding.
