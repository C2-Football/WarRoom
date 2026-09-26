# Vault and Duat browser scouting

Follow-up to the browser layout pass in `ba98959`. Changes are local on
`codex/vault-duat-desktop-20260926`; nothing has been published.

## Player decisions

- Vault roster and replacement rows show the current 1–5-star clue, completed
  PPG or a labeled archive estimate, remaining points, and YTD points. A known
  year is plain bold gold text beneath the name. Game-day year labels follow
  the same convention.
- Vault mystery editions now receive the authorized current-week star clue in
  solo play and public online reports. Draft, postgame, stale-report and replay
  gates remain. Reports do not expose the private edition year, future game
  order, or a hidden-year archive ceiling.
- Exact Vault points left mean the unused public historical pool. A shuffled
  season may finish before every archived game is drawn; the card explains this
  and separately gives an estimated return over remaining playable weeks.
  Unresolved or incomplete archives retain explicitly estimated values.
- Known Vault editions open directly to their full historical season table,
  including late NFL weeks. Completed Vault games and year clues are separate
  views. QB/RB/receiver/kicker/defense columns use their actual stat categories.
  Legacy saves preserve their original scoring pool while full-season research
  is labeled separately.
- Duat Historical Replay mystery rows show the weekly archive outlook, current
  base points, remaining base points and previous-week score. Research opens to
  a position-specific season game log. Once public evidence identifies a year,
  it appears as bold gold text alone beneath the name.
- Duat estimates average the remaining public candidate seasons; they are not
  probabilities or cross-player start/bench recommendations. Base points are
  before divine offerings. A generated public NFL Week 18 supplement provides
  research context separately from Duat's unchanged 17-week campaign.

## Verification

- `npm run test:timeleague`: complete chain passed, including hidden-year and
  public-report privacy, endpoint and sealed-state database checks, real-archive
  lifecycle journeys, legacy pools and generated server parity.
- `npm run test:duat`: 406/406 passed, plus supplement reproducibility check.
- Added behavioral regressions for viewer-capped scouting, unavailable data,
  duplicates, zero/negative points, sourceWeek-only online completed reports,
  a publicly inferred legacy year with an inaccessible private assignment,
  and kicker/defense table columns. The final roster-card test passed again
  after the independent review additions.
- All changed application JavaScript and the research generator passed ESLint.
  Preview build compiled all 148 JSX scripts. Design-token contract and diff
  whitespace checks passed. Both Edge runtimes were regenerated locally.
- Vault compiled-preview journey passed at 1440×1000, 1280×800, 1024×768,
  768×1024, 390×844, 320×740 and 667×375: stars, gold year, PPG and remaining
  points, default historical log, completed-only Vault log and replacement
  comparison. No horizontal page overflow or uncaught page errors. Typical
  desktop roster rows measure about 82px.
- Duat browser journey passed 65 checks across 1440, 390, 320 and 667px,
  including all starter controls, keyboard research, saved lineup reload,
  pregame uncertainty, prior results and Week 18 outside campaign scoring.
- Screenshots were visually inspected, including desktop roster/card and
  320/390px mobile layouts. A fresh 320px card opening positions its top below
  the sticky header with its stars and remaining points visible.

## Evidence and limits

Vault screenshots and the matrix journey are in
`output/playwright/browser-optimization/vault-scouting-*` and
`output/playwright/browser-optimization/check-scouting.js`.
Duat evidence is in `output/playwright/duat-lineup-density/`.

Browser checks use disposable local historical fixtures with outbound mutations
blocked. Expected blocked analytics/provider requests and an existing CSP meta
warning are distinct from uncaught page errors. These checks establish local
rendering and fixture interactions, not hosted release, authenticated live
multiplayer, or physical-device behavior. Duat Resurrection retains its existing
reference-PPG behavior.
