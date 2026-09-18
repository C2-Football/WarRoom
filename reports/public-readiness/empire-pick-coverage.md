# Empire pick ownership coverage — 2026-09-18

Status: bounded provider-failure fix verified locally; awaiting integration and release. Branch `codex/readiness-picks-20260918`, baseline `ce42e406799be3497a6be1ecd4b74ea9c6d7815c`. No backend mutations or deployment performed. Canonical shared dependency remains `5de7baa36225c43e8cacb00a2763e4c65508f296`.

## Failure and resolution

High-severity correctness defect adjacent to INV-04: `populateEmpireWindowState` converted a failed Sleeper `/traded_picks` response into `[]`. The Empire model interpreted that array as verified ownership, assumed all original picks were retained, and advertised complete pick capital and strong premium capital. With a four-round, three-year fixture this invented 12 owned picks after a provider failure.

`fetchEmpireTradedPicks` now distinguishes a verified empty transfer history from unavailable ownership. It validates provider responses, normalizes ownership using the established shared helper, deduplicates identical rows, rejects conflicting owners, and times out slow requests. A season-and-league-keyed snapshot retains prior verified transfers as explicitly stale if refresh fails. Unsupported providers do not query Sleeper with another provider's league ID.

The model excludes unknown pick ownership from totals, reports loaded/fresh/stale coverage, and suppresses full-portfolio pick-strength claims while coverage is incomplete. The workspace has a readable retry notice on every view; summary, league detail, assets, and quality labels distinguish unknown ownership and saved picks. Live and Synced indicators require both roster and pick coverage. No shared valuation rules or provider implementation were copied or altered.

## Evidence

- New `tests/empire-pick-coverage.cjs`: 7 passed, 0 skipped. Actual extracted production helper/model/hydration checks cover HTTP/network/malformed failures, genuine empty success, normalization, last-good retention, retry, changed-season isolation, duplicate/conflicting rows, partial portfolio denominator, timeout, unsupported providers, and replacement league objects during roster refresh.
- `npm run test:empire`: 21 value checks, 4 decision checks, 7 scenario checks, and all 7 new pick checks passed.
- Related validation during the batch: core 97 checks, Sleeper portfolio 10 checks, workspace suite, ESLint, and build passed. Workspace's first attempt lacked the worktree's ignored shared bundle; after the established shared sync it passed without source/test changes. No assertions weakened.
- Real Chromium interaction through Playwright CLI at `http://127.0.0.1:3499/dist-preview/?dev=true`, synthetic `pick-fixture` account and `pick-alpha` league. Supabase requests intercepted with 503 before navigation; no remote account/league mutations. These are fixture/local evidence, not authenticated live provider or native evidence.
- Initial `/traded_picks` 503: capital displayed unavailable, 0/1 verified, no original-pick invention or premium-capital strength recommendation.
- Retry with one known original first-round pick transferred away: capital became 11, 1/1 verified, warning cleared.
- Refresh with 503: capital stayed 11, notice said 0/1 current and 1 using saved ownership, known totals were labeled incomplete. Fresh-build replay confirmed zero Live, Synced, or premium-capital-strength labels.
- Retry with valid `[]`: capital became 12, warning cleared, provider-verified state restored. This checks the meaningful distinction between no transfers and no response.
- Responsive browser checks at 320×640, 390×844, and 844×390: document width equaled viewport width; notice text was 16px; retry button height was 44px and reachable. [390px screenshot](empire-picks-stale-390.png) was visually inspected. No physical-device claim.

## Integration and remaining checks

Parent reviewed the implementation during this batch. Preserve the independent account-session guards from `ec61010` when resolving the overlapping `populateEmpireWindowState` change. Its callback regression harness must wire the new helper and snapshot reference into the extracted function. Preserve the separate decision persistence failure banner when integrating the new pick-coverage banner.

This does not declare Empire or the suite launch-ready. Root still owns integrated security/persistence and broader journey checks. Equivalent provider-error fallbacks in shared single-league connectors/loaders remain separate investigation targets; this batch is the Empire portfolio path. After integration, rerun the integrated Empire/account-callback suites and browser retry path, then verify served release assets and post-deployment behavior on both destinations.
