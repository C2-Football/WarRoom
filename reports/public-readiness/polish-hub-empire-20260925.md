# Dynasty HQ and Empire polish — 25 September 2026

Baseline: `07d779dc4a173046dc1e0ab2caea4c672b8dc76b`. Scope is the existing hub and portfolio interface; no feature expansion, engine changes or Scout application work.

## Changes

- The hub leads with the returning user's league, readable league rows and restrained management cards. Removed repeated labels, decorative section numbering and promotional filler. Search, league routing, commissioner eligibility and account controls remain intact.
- The two game cards now express their identities: paper/ink/gold for The Vault and existing Duat artwork with teal and gold. Phone cards keep readable titles and a clear entry action.
- Empire uses a calmer neutral surface, sentence-case system typography, roomier controls and readable priority rows. Phone users see the next actions before secondary portfolio detail; all six metrics remain available in a native, keyboard-operable Portfolio snapshot disclosure.
- Shortened deterministic brief text without attributing it to AI. Empty states describe the available data rather than claiming the entire portfolio is clean. Missing-data/retry, format, hypothetical-scenario and prediction distinctions remain intact.
- Removed two stale cross-application promotional promises from the league legend. Scoring behavior is unchanged.

## Meaningful regressions and verification

- `npm run test:empire` passed; existing seasonal browser checks also passed format, missing-data, retry, scenario, Assets/Rankings and league handoff coverage.
- Hub unit fixture initially failed all four checks because it omitted current component inputs. Reproduced on baseline source; added those current inputs and retained all four behavior assertions. Final: 4/4 passed. Original failure is preserved in `polish-hub-baseline-failure.log`.
- The broad suite exposed two pre-existing regression checks tied to literal source text superseded by the already-released seasonal roster behavior. Replaced them with evaluation of the actual column and legend definitions in both dynasty and seasonal contexts. The tests now require ROS point labels/units and preserve all three dynasty explanatory categories. Final: 54/54; actual rendered roster-mobile checks also passed. Independent Vault review confirmed the repair strengthened coverage without changing production calculations.
- Actual local browser interactions at 320px, 390px, short landscape and 1440px: search, open Empire, Assets/Overview, expand snapshot and inspect all six metrics, return to Hub; no horizontal overflow. Data was isolated synthetic provider data, with external writes blocked. Independent Commissioner review repeated these journeys and keyboard use with zero page exceptions.
- Full integrated automation: 43/43 suites passed, zero failures or quarantines. Full lint: zero errors, 35 existing warnings. Browser and deployment gates are recorded separately in the master checkpoint.

## Evidence

- [Independent review](polish-hub-empire-independent-review-20260925.md)
- [Empire tests](polish-empire-tests.log), [seasonal browser checks](polish-empire-seasonal-browser.log), [hub checks](polish-hub-tests.log), [repaired regression checks](polish-regression-repaired.log)
- [Durable before/after visual evidence](polish-20260925/README.md), including Hub phone/desktop captures with loaded artwork and the final independent Empire captures. Additional four-size working captures remain in `output/playwright/hub-polish/` and `output/playwright/commish-polish/`.

This is responsive-browser and fixture evidence. It does not establish hosted account permissions, native installation, physical-device performance or complete suite launch readiness.
