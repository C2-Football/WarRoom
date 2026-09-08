# Bringing the Duat into Dynasty HQ

September 8, 2026

The Duat should become a second game alongside the Vault, with solo campaigns
against AI and private campaigns with friends. Keep the Duat's factions, rulers,
favors, alliances and conquest. Use the Vault's work to make those systems easier
to enter, play, save and share.

The relationship is closer than it first appeared: the Vault's historical
football engine was originally ported from the Duat's Time League code. The Vault
has since gained a much stronger game flow and online infrastructure. Bringing
those improvements back into the Duat is a sound direction.

## The proposed experience

**Dynasty HQ → Games → The Duat → Play Solo / Play with Friends**

Choose a faction, uncover its four buried rulers, reveal the active army, and
enter a campaign. Your home screen should show the current ruler, starting five,
next decision, favor balance and frontier. Set your lineup, make any eligible
favor declaration, and play the week. Football results advance the all-play
standings, Heptad alliances and conquest together. The Heavenly Battle crowns
the Lord of the Duat.

Solo uses one human faction and thirteen AI factions. Friends control their own
factions, with AI filling the remaining seats. The first online version should
let everyone take their turn at their own pace; the host resolves play when all
human factions are ready.

## What belongs to each game

| Reuse from Dynasty HQ / the Vault | Keep specific to the Duat |
| --- | --- |
| Existing account and game entry | Factions and ruler armies |
| Play Solo / Play with Friends flow | Four-ruler d20 resurrection |
| Save recovery and reconnect patterns | All-play standings and conquest |
| Private invitations and seat ownership | Heptad alliance tournament |
| Ready checks and protected turns | Heavenly Battle and the Camel |
| Historical scoring and replay primitives, where compatible | Favor costs, timing and effects |
| Shared server validation approach | Campaign history and future seasons |

The Duat should have its own saved campaign and online room records. Putting its
state into a Vault league would force mythology, turn phases and conquest into a
football-specific save format. Small shared account and transport helpers can be
reused without rewriting the whole Vault first.

## What the audit found

The original Duat already contains tested ruler allocation, d20 reveal logic,
Heptad, Heavenly Battle, faction identities and geographic routes. Its separate
Time League mode also has drafts, AI, roster moves and gamecast.

Those pieces do not yet form one playable Original Duat campaign. The existing
season screen accepts a manually entered score and finishing place, and its
sandbox constructs rival totals around that input. Favor declarations are
pending requests rather than executable game effects. Original Duat progress
is stored in the browser, with no shared multiplayer database.

The Vault's online code supplies useful precedents for authenticated seats,
invitations, private information, readiness and conflicting updates. Its current
beta reports still call for fresh multi-account acceptance checks and stronger
operational validation. Duat multiplayer needs its own proof through actual play.

## Work completed in this pass

An isolated Dynasty HQ development branch now contains:

- Standalone ruler generation and reveal logic, including archived/provider armies.
- The original Heptad and Heavenly Battle engines and canonical faction/world catalogs.
- A pure conquest engine that resolves a complete week's losses before awarding claims.
- A transport-independent room contract for solo or friends: seats, ownership,
  readiness, private plans, conflicting updates and safe retries.
- A Duat test suite registered with Dynasty HQ's normal test runner.

The world catalog contains fourteen faction identities, 47 territories and 79
routes. Historic league records are excluded from new campaigns. The nineteen
favor descriptions are preserved as a catalog; their effects are not yet implemented.

Validation passed: **69 rule and room scenarios**, plus **3,040 comparisons** of
ported tournament results against the original engines. Source lint passed.
Review caught and fixed both an inactive-faction homeland issue and a weekly
conquest processing-order issue.

This is local foundation code. A playable Duat screen, score adapter, executable
favors, multiplayer endpoint, persistence and deployment remain to be built.

## The next build sequence

1. **One complete solo campaign.** Connect ruler armies to real player scoring,
   legal lineup decisions, AI factions, enabled favors, all-play, Heptad,
   conquest and Heavenly Battle. Save and resume the same campaign reliably.
2. **The game inside Dynasty HQ.** Add the Duat to Games, build its faction-first
   start screen and campaign home, and reuse suitable Vault roster/replay controls.
   Preserve real geography and clear territory borders.
3. **The same campaign with friends.** Add authenticated rooms, invitation claims,
   server-validated actions, private state and atomic updates. The server runs
   the same Duat rules as solo.
4. **Playable beta verification.** Complete a solo campaign and a real campaign
   across separate accounts, including reloads, reconnects, concurrent moves,
   favor use, territory claims and the championship. Check phone and desktop.

## The decision needed before connecting scoring

**When a ruler resurrects an old roster, which season supplies its points?**

- **The roster's historical season:** an on-demand game that can be played any
  time; this is the closest fit to the Vault's simulation foundation.
- **The current NFL season:** a live, season-long game using old roster ownership
  with current results.
- **A creator-selected mode:** supports both, with separate scoring adapters and
  explicit rules for each campaign.

My proposed starting point is the historical option with the existing
football-driven Duat rules. The historical/live decision remains open; it has
not been silently built into the new rules or room contract.
