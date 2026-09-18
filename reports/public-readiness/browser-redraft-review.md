# Live redraft layout review follow-up

Independent review of `0c1f35e` reproduced three redraft columns at a 600px container: the earlier `.is-live-redraft .mock-draftcast-rail` selector outranked the generic responsive selector. The 1320px container rule now matches that specificity.

Verified with the actual synthetic Sleeper redraft fixture and production React render:
- 900px tablet viewport, 842px room: one rail column; Manual Pick, View teams, Exit inside the rail.
- Same renderer constrained to a 600px room: one column and all three controls exposed.
- 320px phone uses its existing separate live-room renderer. Teams and Board selectors work, Draft is reachable, and the current-action button opens the Big Board.

The new regression runs as three additional `draft-browser-qa.js` checks. No provider writes are allowed by the fixture harness. This verifies responsive browser behavior, not native or physical-device behavior.
