# Current controlled Vault evidence

**PASS within the boundaries below; full Vault launch acceptance remains open.** This run uses the current September20 controlled accounts, not the owner-deleted September18 accounts. Shared Supabase is production; both account lists were verified empty before creating the one disposable room. No preexisting owner/customer league was mutated.

Run `readiness-20260920-f868bdff-2615-4cad-ad86-78ec10ecf7de`; owned room `f4ce90ff-69af-47e7-9bd1-88df53e7ac14`. The private credential file remains ignored and mode0600. It is not part of these reports.

## Hosted API and game progression

[Result record](evidence/live-vault-sep20.json), [execution log](evidence/live-vault-sep20.log): 305 requests, completed2026-09-20T17:43:41Z. Two human seats, one QB slot, manual snake draft, 2000s position roulette, FAAB100, 13 regular weeks and a two-team final. The actual historical archive produced positive results and a champion across14 finalized weeks.

- Anonymous access401; unjoined member403; second controlled account claims its invitation. Only the commissioner starts the draft and advances/settles; a member cannot modify the other team.
- The shared sealed draft completes. Public projections omit authoritative seeds/private draws; unrevealed seasons, invitations, other teams' queues and other pending claims remain private.
- Same-version competing team edits and competing claims have one winner and one409. Retry uses a fresh member-specific projection.
- Two managers bid17 and29 for the same player. Each sees only their own pending bid. Activity is generic; budgets remain100 before settlement. Neither can cancel the other's claim; the member cannot settle.
- The29 bid wins, its team pays once and has71 remaining; the losing team retains100. A stale settlement replay is409 without another charge/version change. The losing bid remains absent from public results.
- Both accounts reopen the same saved final results. Final room version96, championt1, results SHA-256 `0da68507b77d3449810bbdaffc7635af234845b0698b2c0eb8cdfe57b7860d61`.

**Progression limit:** weekly kickoff used the supported commissioner `week` action with `force:true`, after per-team auto-lineup and roster finalization. This is API progression evidence, not a normal browser season or ordinary non-forced kickoff proof. The complete rendered setup/draft/weekly actions and other advancement modes remain separate required checks. Concurrent HTTP/version tests are not independent database-connection contention proof.

## Actual released phone browser

[Browser results](evidence/live-vault-browser-sep20.json), [log](evidence/live-vault-browser-sep20.log): actual served C2 canonical and sandbox944c2e9 frontends, real password forms and hosted room reads at390×844, in separate commissioner/member browser contexts. Each opens the saved room, reloads, reopens, displays the championship ceremony and preserves the correct role/seat and identical final-results hash/version96. The page has no horizontal overflow; the replay button is at least44px and hit-test reachable after scrolling. [Member screen](evidence/live-vault-WarRoom-member-390.png).

Only exact controlled sign-in and Vault list/profile-get/owned-room-load were allowed. Unrelated analytics/background writes were blocked; no browser room action was allowed. This does not prove all unrelated background integrations.

Two harness failures were retained: the first matched a hidden desktop “Season complete” paragraph, though the phone ceremony was visible; the second tested a scrolled button still beneath the fixed dock. The final harness targets the visible championship region and scrolls the button to the center before hit-testing. No application assertion or product code was weakened. [Original locator](evidence/live-vault-browser-original-locator-sep20.json), [initial scrolling](evidence/live-vault-browser-initial-scroll-sep20.json).

No physical-device/native/install/store claim. No room or account deletion was performed. Do not rerun this completed mutation plan blindly; future tests must explicitly use this completed save read-only or create a separately isolated room.
