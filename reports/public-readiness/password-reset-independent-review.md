# Independent review — atomic password reset

Reviewed security commit `3744f22` on 2026-09-18, without editing its implementation or touching hosted data.

No material unresolved finding in the SQL/handler change. I inspected the new migration, both request/confirm handlers, active-session and audit helpers, workflow migration ordering and regression tests, and independently reran `node tests/password-reset-atomic.cjs` successfully.

The account row locks before the selected token, so simultaneous sibling links serialize without acquiring their token locks in opposite order. Token usability and wall-clock expiry are rechecked after the account lock. Password rotation, session-version increment and all outstanding token consumption share one transaction; the injected failed token update rolled back the complete prior account row and preserved link recovery. The RPC grants deny browser roles and permit only service role. Hash validation, existing PBKDF2 compatibility, another account's state, old-session rejection and unsupported input/method behavior are meaningfully tested. The request handler persists a token before delivery and does not audit failed storage/delivery as success. Existing audit helper exceptions do not turn a committed reset into a failure response.

Migration-first deployment is additive and replayable, preserving existing links. The new handler fails closed if the RPC is unavailable. The documented recovery plan appropriately avoids restoring the vulnerable old mutation path or reversing legitimately changed passwords/session counters.

Remaining evidence boundary: PGlite serializes SQL. Passing concurrent handler submissions are not independent-connection lock contention proof. Hosted disposable-account reset, real delivery, old password/session rejection, one winner across separate connections, repeated-link rejection and production debug-token configuration still need verification before a live readiness claim. See the implementing agent's `security-batch-2.md` for the detailed rehearsal and release path.
