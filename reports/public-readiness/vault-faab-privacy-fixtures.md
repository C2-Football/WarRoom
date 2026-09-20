# Vault sealed FAAB decisions — 2026-09-20

Status: **local endpoint/privacy regression passed; hosted two-account FAAB browser journey not run**. Test-only extension of `tests/time-league-public-endpoint.cjs`; product behavior, API and rules are unchanged.

The existing actual-TypeScript-handler harness already covered authentication and membership denial, sealed entropy, independent public IDs, per-manager archive reveals, readiness, draft choices, current-week edition selection, future-allocation isolation and historical scoring. This extension closes a missing explicit regression for competing human waiver bids and the subsequent public responses.

Two fixture principals submit different FAAB bids against the same version. One succeeds; the other receives a conflict, loads the updated room without seeing the opponent's claim, and retries successfully. Each manager's complete endpoint response contains exactly their own claim and amount. Opponent claim IDs, pending amounts, private seed and draw maps are absent. Current-week activity text conceals claim targets/amounts and public budgets do not deduct reserved bids. Forged team ownership, cancellation of the other manager's claim, and member-triggered commissioner settlement are rejected without modifying state.

Settlement awards the target to the higher legal bid, deducts that winner's budget once, preserves the loser's budget, rejects stale settlement replay, and gives both managers matching public results after reopening. The full original draft/scoring test continues to pass.

Evidence: [vault-faab-endpoint.log](evidence/vault-faab-endpoint.log). This executes the production endpoint and engines with stubbed authenticated identities and versioned private storage, so its controlled asynchronous conflict proves handler behavior, not independently hosted PostgreSQL contention.

Also reran the existing actual PostgreSQL/PGlite sealed-state migration and permissions regression: [vault-sealed-state-db.log](evidence/vault-sealed-state-db.log). Anonymous users, outsiders, members and commissioners cannot bypass the endpoint projection through private table/JSON/join/RPC reads. Migration retries preserve stored game/career records. This is isolated local SQL evidence.

The established documented contract is that **pending** waiver bids remain private (`reports/vault-multiplayer-readiness-2026-09-07.md`). Current public activity deliberately exposes older completed-week bid history after the week advances. This batch preserves that history and does not claim permanent secrecy of settled bids or winning expenditure. Live auction high bids are public under the existing auction rules.

Next hosted step, after root authorizes a distinct fresh controlled run: two real UI accounts submit competing FAAB bids, inspect both sanitized endpoint responses before settlement, exercise reconnect/conflict retry, resolve once, and verify the same award/budget state after both reload. Use a newly identified isolated test room; do not recreate the owner-deleted original rooms or claim their recovery was tested after cleanup.
