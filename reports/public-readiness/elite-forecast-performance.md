# Forecast ranking interaction stall

Severity: high interaction reliability defect on warm mobile arrival. Reproduction: visit the eleven league tabs in one browser context, close the desktop page, open Home at390px in the same context, then click `League status and actions`. The15-second browser click timed out after locating and scrolling the control. DOM inspection showed a valid mounted header and sheet implementation.

CDP sampling of the original failure recorded23,029ms total profile time and approximately11,776ms self CPU inside `isElitePlayer`, plus position normalization. Parent stacks show three independent forecast captures, each ranking the entire player universe again for every player's three dynasty scenarios. This was synchronous background bookkeeping blocking interaction.

Canonical `dhq-shared` change: `7bd35313fc78e25a2d1ac24035989673a93f28e6` (not pushed by this agent). Ordinary elite reads filter by position before evaluating the format-aware value map. An explicit immutable snapshot ranks each position once per capture, preserving stable tie ordering, missing-value behavior, and7000 threshold. `projectPlayerValue` accepts the already-recorded boolean in scenario metadata. There is no long-lived cache; each new capture reads current format values and metadata.

WarRoom's matching `player-value.js` twin is byte-identical to that canonical revision. Forecast capture creates one snapshot, records its classification, and passes that same classification through the three scenarios. Scenario model identity and values remain unchanged; runtime fingerprints detect the revised implementation.

Verification:
- Canonical test:7,280 old/new comparisons for live reads and7,280 for snapshot reads, including normalized positions, stable ties, NaN/numeric strings/missing scores, threshold, live score/position mutation, changed format proxy values, and immutable snapshot semantics. Explicit true/false metadata matches live projections for past and future deltas without additional ranking.
-17 forecast-ledger checks pass, including dynasty and keeper bulk captures that compare every output with the existing live calculation and require one snapshot/zero per-player live rankings.
-11 evaluation integrity and7 forecast archive checks pass. Archive test is SQL-contract/fixture evidence, not a database runtime claim.
- Same-input browser microbenchmark on40 players/2,436-player universe:33.7ms original vs23.5ms positional-only calculation, all outputs identical. This small local optimization alone did NOT remove the stall; the bulk snapshot is necessary.
- After the complete fix, the same warm-browser sequence opened the phone sheet:4,304ms hydration +4,163ms action,8,467ms total; sampled elite self CPU fell to289ms. See `elite-browser-profile-after.log`. A second warmed run also passed while other browser suites were running:5,668ms hydration +5,253ms action,10,921ms total,379ms elite self CPU. The three forecast captures took134/133/125ms synchronously; their asynchronous recording completed in4,095/3,406/3,165ms. See `elite-browser-profile-confirmation.log`. These are local Chrome observations, not hardware-independent guarantees.

The canonical commit must be released/pinned with this WarRoom counterpart, shared loader cachebusters, and the byte-identical player-value twin. Parent owns canonical push/pin and final integrated release validation. No deployment performed by this agent.
