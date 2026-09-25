# The Vault — interface polish, 25 September 2026

Status: locally implemented and verified; awaiting integrated review/release. No hosted mutations or deployment performed in this lane.

## Changes

- An archival football palette: warm paper, deep green ink, brass controls and subtle field markings. The interactive sample cards, team helmets, position colors and mystery-season identity remain.
- One consistent control hierarchy through setup, draft and season Home. Phone setup fits the primary action in a 390 × 844 viewport; rules and identity remain available in native disclosures. Support moved into the existing profile/community area so the phone header keeps a single Back control.
- Concise setup and Home copy replaces repeated marketing labels, duplicate “original” badges and the repeated Draft status. All scoring limitations, save-location information, historical-data qualifications and permissions remain.
- Corrected an observed rule/copy mismatch in player research: Hidden Years now promises the final season recap; Classic promises the draft-end reveal. A render regression covers both configurations.

## Verification

- `npm run test:timeleague`: exit 0. Full output: [polish-vault-tests-20260925.log](polish-vault-tests-20260925.log). Includes hidden-state/privacy, real archive, complete saved/reloaded season and server-pool checks. This is local automated evidence, not hosted multiplayer proof.
- Following the last copy correction: beta entry/auth, draft controls, setup/retry, roster/Home and hidden-years UI tests pass. ESLint for all four edited JavaScript files and whitespace validation pass.
- Actual Chrome UI on the isolated local preview, with Supabase and external mutation requests blocked: fresh setup, era disclosure, no-timer/faster draft configuration, reveal all six assigned eras, enter draft, choose 12 legal roster picks through the actual player board, finish the 72-pick league draft, arrive at Week 1 with a legal lineup. Reload preserved the drafted player at pick 9 and later reopened the completed draft directly into Week 1.
- Lobby and actual completed-draft Home inspected at 320 × 740, 390 × 844, 844 × 390 and 1440 × 1000; document-width checks passed at each. Native phone disclosure opened/closed with Enter, year-visibility selection remained reachable, and all three sample cards revealed on click.
- Screenshots: [before phone](polish-20260925/vault/before-lobby-390.png), [after phone](polish-20260925/vault/after-lobby-390.png), [before desktop](polish-20260925/vault/before-lobby-1440.png), [after desktop](polish-20260925/vault/after-lobby-1440.png), [draft](polish-20260925/vault/after-draft-390.png), [Home phone](polish-20260925/vault/after-home-390.png), [Home desktop](polish-20260925/vault/after-home-1440.png). Other viewport evidence is in the same directory.

## Limits and preserved behavior

This pass changes presentation and one rule explanation. It does not alter the engine, draft legality, scoring, persistence APIs, entitlement checks or private-state boundaries. It does not establish native installation, physical-device, hosted multiplayer or public-launch readiness. The local dev banner and deliberately blocked backend errors appear in local screenshots; they are not production UI. An initial automation waited for a player already drafted by a rival and another tried to pick a third QB; these stopped normally. The completed journey used the visible position filter and legal player choices without bypassing any guard.

Changed source: `time-league-play.css`, `time-league-mobile.css`, `js/tabs/time-league.js`, `js/components/time-league-{setup,home,draft}-panel.js`, and `tests/time-league-hidden-years-ui.js`.
