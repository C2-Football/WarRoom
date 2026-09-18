# Independent review — Duat runtime correction

Reviewed root commit `98345b6` on 2026-09-18 without changing its source or any hosted state. No material unresolved finding in this bounded performance correction.

Inspected the archive builder/decoder, candidate feasibility optimization, mystery pool copy, actual caller paths and source consumers. Re-ran `node --test tests/duat-runtime-data.js`: all 127,055 normalized source records match the packed runtime exactly, selected seasons remain isolated, and repeated requests reuse indexes.

Additional independent runtime probe loaded five distinct single-year selections to force aggregate-cache eviction, then reloaded the full reversed season list. All records still matched the original full index. Empty, NaN and string-valued season selections failed validation. Mutating a returned mystery player's name and candidate-year array did not mutate the cached subsequent result.

`Legacy.shortages` counts only player positions. Computing peer shortages once and candidate legality once per position preserves the original feasibility math, including roster capacity, Duat quarterback maximum, remaining positional supply, FLEX/SUPER_FLEX capacity and banished-player filtering. Final position/decade/name filters preserve provider pool order. Mystery pool rows currently contain scalars plus the candidate-year array, so the replacement copy is sufficiently independent. Root's 279 exact pre/post comparisons across 46 human turns and all three roster styles provide broader behavior evidence beyond this source review.

The generated runtime validates unique supported numeric seasons before decoding. Normalized field-shape/finite-value checks fail unexpected archive format changes; exact-record parity additionally protects identity/metadata preservation. Season cache is bounded by the 24 supported years; aggregate variants are capped at four, and shared records avoid four complete record copies. Current scoring paths read records and copy or normalize stats into campaign snapshots; I found no application mutation of cached log maps or log stats.

Evidence limits remain: local Node memory/timing is not hosted Edge resource proof, and the same full archive still has a finite memory footprint. The original isolated room must resume after deployment, then complete its authorized live draft/season/progression and reload/reconnect checks before the HTTP 546 blocker is declared resolved live. No data rules, saved-game schema or private-state contract changed in this commit.
