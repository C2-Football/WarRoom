# Independent account-isolation review — 2026-09-18

Reviewer: product-inventory / connection-recovery agent. Reviewed security agent's uncommitted diff in `warroom-readiness-security`, based on `5d28f39`; no security source files edited by reviewer. This is a scoped code/VM review, not suite launch approval.

## Material findings

| Finding | Review result |
|---|---|
| Account A private Commissioner/Empire data exposed to B | The new signed-principal namespacing closes the reproduced global-key leak. Tests exercise the real planning modules, account changes, return/reload, mutable Sleeper names, legacy identities and unknown-owner records. Unknown-owner data is preserved without silently assigning it to another identity. |
| Stale cross-tab writes / mounted private content | Synchronous identity checks reject writes before the queued storage event; first mismatch blocks the store, unmounts the React tree, clears volatile secrets and reloads once. Same-account token refresh does not trigger a false account change. Independently reran these VM tests successfully. |
| Backup quota error followed by destructive context clear | Initial helper swallowed backup failure. Updated transaction verifies archive before changing active data, writes capacity-sensitive values first and rolls back partial failure. Independent run of quota/partial-write regression passes. Sign-out still clears auth when backup fails, while preserving profile pointers for recovery. |
| Known-owner A → B → A continuity | Reviewer reproduced initial missing restoration even though A's archive existed. Author added known-owner archive restoration with explicit login updates taking precedence; normal return-account regression passes. |
| Full-quota logout → quota resolved → A signs in again | Reviewer reproduced profile becoming `null`: preserved known A pointers were re-archived as unassigned because there was no current auth token. **Corrected and independently reverified**: archive now honors the retained trusted owner marker; the exact reproduction restores `{"private":"account-a"}`. |
| Ignored local write failure (INV-03) | **Unresolved high, separate implementation batch.** `AccountStorage.set(false)` is truthful, but Empire and several Commissioner engine/form callers ignore it and still return success-shaped data or clear drafts. This privacy patch does not establish successful save/recovery under storage failure. Author and root explicitly informed. |

Minor defensive issue, **corrected and independently reverified**: malformed old `mfl_creds_*` / `espn_creds_*` JSON previously evaded secret-field scrubbing. Parse/scrub failure now removes the matching credential container; the exact reproduction reports `malformedLegacyCredentialRemains:false` after logout.

## Evidence and integration conditions

- Independently executed `node tests/account-storage.cjs` and `node tests/account-session.cjs` again after all review corrections; both pass. `git diff --check` passes.
- Independently reproduced initial missing return-account restoration and full-quota logout return edge using the author's isolated browser harness and exact helper code.
- Source calls the actual Supabase client's `auth.signOut({scope:'local'})`, manually clears that project's local OAuth persistence, handles SDK rejection and bounds wait before redirect. Tests use an SDK spy, so this is **method invocation and local cleanup evidence**, not authenticated provider sign-out or remote revocation proof.
- Root's login change must load the helper and use `prepareSignIn(nextSession, updates)` before publishing a new account session. The function now owns the full local-storage transaction; a second independent write sequence would invalidate rollback guarantees.
- Core logout delegates to AccountSession; the current index loads account storage before private modules. Verify assembled HTML, shared source pin, compiled browser boot, two real browser tabs, and fresh/returning login on the integrated candidate.

The reviewed account-isolation/session-cleanup scope has no unresolved material finding from this review, subject to the required login integration and integrated browser verification. No independent approval for the whole suite is implied. In particular, INV-03 and deployed/real-account/browser integration evidence remain required.
