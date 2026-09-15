# The Wire across leagues and persistent season storage

The signed-in hub has a single all-league Wire entry. Each league's newspaper also offers **All my leagues**. The combined newspaper streams each connected Sleeper league's latest stories into one edition, with explicit league/season labels, league filtering, Recaps, Records and History sections. Each league gets a turn in headline ordering. Current editions load before the older-history queue, with at most two leagues in each loading stage. A failing league leaves the other editions usable.

Current news is an explicitly labeled snapshot with a manual refresh. The combined view does not create one live polling subscription per league. Reopening within a minute reuses the account-scoped edition snapshot after checking the NFL calendar; a new week or different account cannot inherit that snapshot. Returning to an individual league retains its existing score polling. Unsupported providers are labeled, not queried through Sleeper.

## Saved older seasons

- IndexedDB database `wr-wire-archive`, store `seasons`, schema version 1. Only complete, validated historical seasons are written; current-season results are not persisted in this store.
- Keys are historical Sleeper league IDs, which identify a single season. The loader checks league ID, season ordering, linked predecessor, owners, roster completeness and every regular-season week before trusting a stored season.
- The cache retains only the owner/name/avatar information and starting-player scoring needed by The Wire, discarding unrelated roster/bench detail. A maximum of 100 season entries bounds device storage. Oldest writes are evicted first; an evicted season is safely fetched again.
- Saved seasons have no short expiry. The current lineage is checked when the in-memory archive is cold, and old seasons are then read from storage. A league renewal can reuse the same archived season IDs.
- Storage denial, quota errors and schema corruption fall back to normal loading. Browser storage may be cleared or evicted, so this is a device/browser cache rather than a permanent cloud archive or backup.
- **Refresh edition** and **Refresh current news** refresh current-season evidence without forcing older seasons to download. **Sources & coverage → Recheck older seasons** explicitly bypasses saved history when historical corrections are needed. Retrying a partial archive reuses completed cached seasons and fetches the gaps.
- Verified seasons are saved progressively, so canceling a long first load doesn't discard seasons already completed. Closing the combined dialog cancels remaining requests and prevents late state updates.

The existing raw-era/current-rules scoring separation, owner-ID rivalry keys, documentary provenance and edition cutoffs remain in effect. Saved data never combines leagues or turns playoff/Cup results into regular-season wins.

## Verification

`npm run test:live-scores` includes the persistent-cache and portfolio tests. Tests cover a new runtime reading a saved season with only a current-lineage request, explicit forced refresh, corrupt/wrong-league cache recovery, storage denial, cancellation, progressive current news, cross-league filtering, fair headline ordering, account-scoped warm reuse and isolated failures. The core suite and compiled browser build also pass.

Browser verification used the user's three connected leagues. After a full page reload, the combined edition reported one cached Shootout season, six cached The One seasons and five cached Psycho seasons, with all three leagues ready. Individual and all-league views share the same completed-season store.
