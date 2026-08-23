# Dynasty HQ / War Room — working notes

## Visual identity: ROUNDED (owner ruling, 2026-08-22)

Dynasty HQ's identity is **soft-cornered**, not sharp. This is a deliberate shift
away from the older "Bloomberg/sharp-terminal, 0–2px corners" direction — if you
are working from a design skill or doc that says *"corners are sharp (0–2px)"* or
*"no rounded cards, no pill buttons — sharp corners are the identity"*, **that
guidance is superseded for this project.** Do not re-sharpen the UI.

The reference for the look is `mockups/command-center-redraft.html`.

### Roundness is ONE knob

Four tokens in `index.html` `:root` — every surface goes through them:

| Token | Value | Use |
|---|---|---|
| `--card-radius-xs` | 5px | chips, badges, tiny controls |
| `--card-radius-sm` | 8px | wells, sub-cards, inputs, buttons |
| `--card-radius` | 10px | panels / cards |
| `--card-radius-lg` | 14px | hero cards |

To make the whole app rounder or sharper, **edit those four values** — nothing else.
`scripts/radius-codemod.cjs` migrated ~1,007 hardcoded literals onto them so this
actually works; before that, the app hardcoded radius in ~1,100 places and read the
tokens in only ~66, so changing a token did almost nothing.

### Rules for new code

- **Never** write a hardcoded `borderRadius: '6px'` / `border-radius: 6px` in the
  4–14px range. Use the token: `borderRadius: 'var(--card-radius-sm, 8px)'`.
- `tests/design-tokens-contract.js` fails the build if you do (wired into
  `npm test`). It names the file, the value, and the fix command.
- Deliberate carve-outs the contract allows, and you should keep:
  - **1–3px** micro-details (form-guide squares, hairline tags) — these read wrong
    at 5px+ and are intentionally sharp.
  - **≥15px / 99px / 999px / 50%** — pills, circles, avatars. Not a card corner.
  - **Multi-value shorthands** (`'8px 8px 0 0'`) — corner-specific by intent.

### Fixing drift

```bash
node scripts/radius-codemod.cjs --dry     # report
node scripts/radius-codemod.cjs           # migrate js/ + index.html
```

Shared-engine surfaces (player card, tier gates, tutorial) live in the **canonical
`../dhq-shared`**, not in `reconai-shared/` (that's the gitignored vendor mirror).
Fix them at the source, then sync:

```bash
node scripts/radius-codemod.cjs --dir ../dhq-shared
npm run sync:shared
```

The `var()` fallbacks mean those shared files still render correctly standalone.

## Related conventions

- Any edit to a `js/*.js` file needs its `?v=` cache-buster bumped in `index.html`
  for local dev; the production Pages build content-hashes `?v=` automatically.
- `scripts/typescale-codemod.cjs` is the same pattern for font sizes — that's the
  precedent `radius-codemod.cjs` follows (`--dry`, manifest, grow-only guard rails).
