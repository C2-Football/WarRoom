# Duat live runtime failure and correction

Status: candidate verified locally; **live correction unverified**. Baseline public
backend returns HTTP 546 during a real shared Historical Replay draft. This is a
high-severity primary-journey blocker until the original room can continue live.

## Reproduction and isolation

Two uniquely named disposable app accounts were created through existing APIs.
Both profiles matched their identities and had empty Vault/Duat collections
before any game mutation. Only their run-ID-named campaign was created or changed.
Credentials and invitation codes remain in untracked mode-0600 local files.

The deployed Duat handler passed anonymous denial, nonmember denial before invite
claim, member/host restrictions, cross-faction rejection, private invitations and
allocations, competing readiness (one winner, one conflict), and idempotent replay.
During the ensuing draft, both an action and a repeated load failed; the captured
load returned HTTP 546: “Function failed due to not having enough compute
resources (please check logs).” The room ID and sanitized request observations are
in `evidence/live-duat.json`; the room is retained for post-release recovery QA.

The first probe incorrectly prohibited the public draft turn-order queue. Source
review established that its faction/round/origin-year entries are intended public
schedule data. The corrected probe permits only those fields and checks hidden
assignment maps, seeds, opponent initial picks, sealed armies and private rituals.
That probe correction is separate from the actual hosted resource failure.

## Root cause and implementation

Hidden-year games need the complete 24-year archive. The previous Edge runtime
parsed every CSV during an isolate's first load and rebuilt all 127,055 index keys
on every later action/read. Candidate filtering repeatedly recomputed identical
roster requirements for thousands of cards and every opposing army.

- The build now uses the canonical parser to pack normalized numeric rows and
  shared player identities. Unexpected metadata/stat fields fail the build rather
  than being discarded. The runtime expands one season at a time and caches
  completed indexes; aggregate cache variants are bounded.
- Candidate feasibility is calculated once per position. Player search, order,
  roster limits, peer roster capacity and selected candidates retain their rules.
- Mystery pool copies preserve independent candidate-year arrays without JSON
  serialization per card. No scoring, private assignment or gameplay rule changed.

## Verification and recovery

- `tests/duat-runtime-data.js`: all 127,055 normalized records exactly match the
  original archive parser, selected years stay isolated, repeated requests reuse
  their index, invalid/duplicate years fail.
- `evidence/duat-candidate-parity.log`: 279 exact before/after comparisons over 46
  human turns in Original Duat, Classic and Superflex; authoritative states and
  public projections matched the immediately previous source.
- `npm run test:duat`: 392 passed, zero failed/skipped, including PGlite and actual
  Edge-handler multiplayer, hidden-year, completion and dynasty progression tests.
- Local Node profiling reduced full-archive load RSS from 297 MiB to 190 MiB in
  these runs and repeated index work from 51–75 ms CPU to approximately zero.
  Environment scheduling affects timings. Node RSS is **not** hosted Edge memory
  evidence; peak game operation memory and hosted execution still require checks.

No database schema or saved-game shape changes. Rollback is the previous code
revision; original campaign data remains compatible. Backend release must build
the generated runtime from the new builder. Resume the existing isolated room
after deployment, complete its season and subsequent dynasty cycle, then repeat
browser reload/reconnect checks. Do not count local performance as a live pass.
