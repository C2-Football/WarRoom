# First integrated candidate: c288d84

Canonical shared source: `7bd35313fc78e25a2d1ac24035989673a93f28e6`.
No frontend/backend deployment. This is a failed candidate gate, preserved as
reproduction evidence; it is not the release sign-off.

`npm test` attempted all 43 suites in 84.1 seconds: **40 pass, 3 fail, 0 quarantined**.
The separate browser runner follows even after broad-test failure; its result is
recorded in `evidence/candidate-c288d84/browser.log` when terminal.

The three failures were reproduced independently without changing app source:
- Sleeper connection harness omitted `window.App`, newly required by the actual
  account-session guard. Added the real namespace to the isolated browser context;
  all 9 provider/quota/race/duplicate-submit checks pass with unchanged assertions.
- Portfolio harness injected settled market data into hardcoded hook slot 10.
  Adding journal hooks moved that slot and suppressed the fixture arbitrage board.
  Harness now addresses actual declared state through Babel instrumentation, keeping
  the Chopped/disabled-trading assertions and all prior behavior checks intact.
- Vault entry harness lacked AbortController, cancelable request timers and the
  actual AccountStorage dependency. The full real login script failed before its
  fixture request. It now loads the real helper and browser primitives; scoped
  signup/sign-in/invite return, OAuth guard and game-feedback/mobile checks pass.

Focused logs are `sleeper-connect-integrated.log`, `workspaces-integrated.log`, and
`vault-entry-integrated.log` under evidence. No production behavior was changed to
make these fixtures pass. The next candidate must rerun the broader gate.

Independent release review also reproduced a **high-severity delayed OAuth restore
race** after successful explicit email sign-in. This is an actual product defect,
not a harness failure. Assigned to the browser/security reviewers for correction
and independent verification before release. See checkpoint for current work.
