# Independent Duat polish review — 25 September 2026

Reviewer: Vault lane (no Duat production edits).

Result: no material finding in the reviewed polish diff.

Reviewed `duat-polish.css`, `js/tabs/duat.js`, `js/components/duat-season-home.js`, and `js/components/duat-weekly-flow.js`. The patch preserves historical/live-data boundaries, scoring, save/recovery operations, campaign rules, and existing actions. Compact disclosures retain the actual explanations; removing the repeated weekly introduction does not remove a rule or action. Campaign-phase focus runs at campaign/phase transitions, not on every draft selection.

Independent actual Chrome checks against the local preview, with Supabase and external mutation requests blocked:

- At 320 × 740, keyboard Enter opened and closed the mode disclosure. Selecting Resurrection exposed the unavailable-feed/locked-weekly-play warning; closing it retained “preview only” in the summary.
- Campaign-name typing and keyboard-opened faction search worked; filtering Rome showed exactly one faction without horizontal overflow.
- Loaded the author's engine-generated local fixture through the real storage module, reopened it in the actual app and entered the first-week lineup. This is fixture-backed local browser evidence, not a remotely authenticated campaign.
- Enter opened/closed weekly help and retained the estimate qualification. At 320 × 740 and 667 × 375 the primary action stayed at least 44 px tall, did not overlap the bottom navigation, and the document did not overflow horizontally.
- More exposed the backup action, Escape dismissed it, and the stored campaign remained byte-for-byte unchanged through help, viewport and menu navigation.

Earlier review screenshots: [keyboard at 320](polish-20260925/duat/duat-review-keyboard-320.png), [lineup at 320](polish-20260925/duat/duat-review-lineup-320.png), [earlier landscape geometry](polish-20260925/duat/duat-review-lineup-667.png). The final correction and interaction proof are recorded below.

This review covers the polish diff and sampled interactions. It is not a complete public-readiness, native-device or hosted multiplayer certification.

## Bounded integration follow-up: regression assertions and retired-app help

Independently reviewed the final diffs in `tests/regression.js` and `js/league-detail.js` at root's request. No material finding.

- `ROSTER_COLUMNS` is unchanged from release `cab4e64`; the conditionally titled Legend/ROS help also predates this polish batch. Production behavior was not altered to satisfy the tests. The only uncommitted production changes in League Detail remove two false claims that tags sync with the discontinued Scout app.
- The replacement assertions evaluate the real source objects for both format branches. They retain the three existing Dynasty help-category requirements and add checks for actual seasonal points units and the distinction from the value rating. This meaningfully replaces obsolete literal-source fragments; it does not remove coverage or weaken the intended contract.
- Independent runs: `node tests/regression.js` — 54/54 pass; `node tests/roster-mobile.cjs` — pass, including rendered redraft ROS labels, sorting by displayed points, neutral styling, valid zero and unavailable evidence.

## Final release review: short-landscape correction

The author's later browser matrix found checkbox interception that the earlier rectangle-only review did not establish. Reviewed the final short-landscape CSS and independently reloaded the frozen source at 667 × 375. The scoped correction compacts the header and horizontal dock while preserving touch-target sizes, safe-area offsets, measured action spacing and scroll margins. It does not alter lineup logic.

Independently toggled **all 8 roster checkboxes** through normal browser `check`/`uncheck` actions, with no forced clicks or DOM mutation. Removing each starter disabled the primary action; restoring the prior legal lineup enabled it. All rows were reachable without fixed-header/dock interception. Final measurements: header 56 px, dock 56 px, primary action 50 px, action/dock overlap 0 px, no horizontal overflow. Screenshot: [duat-final-landscape-checkboxes-667.png](polish-20260925/duat/duat-final-landscape-checkboxes-667.png).

An initial review assertion used the valid-lineup button label after making the lineup incomplete; the app correctly changes that label to “Save and confirm lineup.” The rerun targets the same primary action by its stable container and retains the disabled/enabled assertions. No product workaround or weakened interaction was used.

Final result: **no material finding remains in the short-landscape correction**. This final interaction evidence supersedes the earlier geometry-only claim for checkbox usability. The author's final four-viewport evidence was also inspected; this remains local browser/fixture evidence, not physical-device or hosted multiplayer proof.
