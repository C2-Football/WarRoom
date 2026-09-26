# Vault and Duat browser optimization

Base: `d256d3f` (current origin/main when work started). Work is isolated on
`codex/vault-duat-desktop-20260926`. No deployment has been performed.

## Changes

- Vault desktop roster rows now place player identity, PPG/archive estimate,
  season evidence, points and move controls across one row. Typical row height
  drops from about 146px to 88px; all seven starters fit at 1440 × 1000.
- Vault setup explicitly allocates draft controls to the answer column, with
  balanced season-finish and player-year settings. Headers, navigation and Home
  content use less vertical space. The dossier adapts to narrow desktop widths.
- Vault desktop navigation now exposes its label and current page to assistive
  technology. Short-window menus scroll; tablet weekly actions sit at the bottom
  without reserving space for a hidden phone dock. Scroll padding keeps keyboard
  focus clear of the fixed action bar.
- Duat desktop Home pairs next move with the calendar and standings with the
  alliance panel. Campaign headings are compact, and changing views retains the
  top navigation in view.
- Duat desktop lineups use a bounded working column, aligned estimate/last-week
  numbers, and a sticky confirmation/help rail. Phone-specific composition and
  actions remain in place.
- Changed CSS/component asset query versions are updated in `index.html`.

## Verification

- Production-shaped preview build: 148 JSX scripts compiled successfully.
- Final full Duat suite: **403/403 passed**.
- Focused Vault roster/Home, owner workspace, setup, hidden-year UI, player
  signals, draft controls and integration-render checks passed.
- Changed JavaScript passed ESLint; design-token checks and `git diff --check`
  passed.
- Browser matrix: Vault Home, roster and game day; Duat Home and lineup at
  1440 × 1000, 1280 × 800, 1024 × 768, 768 × 1024, 390 × 844, 320 × 740,
  and 667 × 375. All 35 captures completed without horizontal page overflow
  or uncaught page errors. Lineup selection was toggled and restored.
- Additional browser checks covered Vault dossier, friends/auction setup,
  Duat hidden-year research and action-rail scrolling, and phone action/dock
  clearance. An independent review checked 1024px layouts and keyboard access.
- At 1024 × 500, 24 sequential Tab steps kept every focused roster control
  clear of the action bar after the scroll-padding correction.

Evidence is under `output/playwright/browser-optimization/` and
`output/playwright/vault-desktop-after-*.png`. `check-layout.js` contains the
matrix journey. Test data is disposable browser-local historical fixtures;
outbound mutations were blocked. Console warnings from blocked analytics and
the existing CSP meta directive are separate from uncaught page errors.

This verifies local browser layouts and interactions. It does not establish a
hosted release, authenticated multiplayer, or physical-device behavior.
