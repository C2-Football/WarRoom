# Empire: consumed draft rights and progress recovery

Branch: `codex/readiness-empire-seasonal-20260918`, based on integrated `d5cf58d`. This is an isolated frontend batch, not deployment evidence.

## Confirmed issue and change

The actual baseline portfolio model generated four 2026 picks even for a completed/in-season redraft, and twelve picks over 2026–28 for a dynasty league whose 2026 draft was complete. A verified empty transfer feed proves no ownership changes; it does not prove the draft rights remain unused. The model ignored draft progress entirely.

Empire now hydrates same-season primary draft metadata separately from transfers. Completed drafts contribute no current-year rights. A draft in progress subtracts picks by original draft slot/roster, including consumed acquired picks; it does not mistake the receiving roster for the original owner. Current-year round count comes from that draft's settings. Verified future keeper/dynasty rights remain within the existing horizon. Seasonal formats retain their one-year limit and unpriced values.

The source-slot distinction is grounded in the [official Sleeper draft/pick API documentation](https://docs.sleeper.com/): `draft_slot` identifies a board column, `slot_to_roster_id` maps that column, and a pick's `roster_id` identifies its recipient. No provider credentials or external writes were added.

Unavailable, malformed, ambiguous, unmappable, or timed-out progress does not create current-year holdings. Current-year rights are explicitly unknown while verified future rights remain visible. The prior verified progress is retained as saved data on a failed refresh; complete/live/synced/capital-strength claims require current progress. An account change prevents follow-up reads and publishing into the new identity. Active auction allocation is left unverified because round-based rights are not supported by that metadata; a completed auction still correctly consumes its current-year draft.

## Verification

- `test:empire` passed: values 21, decisions 6, scenarios 7, plus 20 pick coverage/format/progress tests. Seven new tests execute the real loader and model: completed draft with league still pre-draft; own/acquired consumed source slots; draft-order fallback; actual round count; invalid/ambiguous metadata and picks; duplicate/conflicting rows; timeout; initial failure; saved progress; retry; season isolation; account change; and non-Sleeper connections.
- Existing fixtures whose intended assertion is an upcoming four-round board now explicitly include that verified draft evidence. The 97 core assertions and account callback checks passed without reducing assertions. Full `test:workspaces` passed. ESLint, diff check, and canonical `build:preview` passed (147 scripts; shared pin unchanged).
- `node tests/empire-draft-inventory-browser-qa.cjs` passed against the matching port-3503 preview. Actual 390px Chrome interaction exercised initial 503 → eight verified future picks and unknown current year → successful retry with sixteen pre-draft rights → draft progress and completed redraft leave eleven → failed refresh preserves eleven with saved-data notice/no Synced → completed-draft retry leaves eight future dynasty picks and no 2026 row. No document overflow at 320×720, 390×844 or 844×390. [Saved progress screenshot](empire-draft-progress-stale-390.png) visually inspected.
- Browser provider responses were synthetic, all Supabase requests were locally unavailable, and external mutations were blocked. This is local behavior evidence, not a live-user or real draft proof. Run with `node scripts/serve-static.cjs --port=3503` or `READINESS_PREVIEW_ORIGIN` pointing at the matching preview.

## Unfinished adjacent correctness

Empire still feeds universal dynasty DHQ into seasonal player totals/ranks/age-window advice; the baseline real model fixture produced “Post-window value needs pruning” for a redraft roster. Its separate league-scored seasonal board is not yet wired into this main model. That is the next bounded implementation task; do not declare Empire format readiness from this pick correction.

Canonical `dhq-shared/team-assess.js` (`buildPicksByOwner` and the `picksAssessment` block) also constructs current-year-plus-two pick holdings without this progress/format context. Empire's health calculation uses scoring and roster coverage, so this does not undo the inventory correction, but shared owner/trade displays may still expose the separate stale-pick assumption. Fix through the canonical shared repository and pin, never by editing the generated vendored copy. Root was notified.

Root independent review, integrated release checks, and deployment verification remain required. [Sleeper commercial API authorization](sleeper-commercial-prerequisite.md) is separately recorded as an external launch prerequisite; no agreement was inferred or purchased.
