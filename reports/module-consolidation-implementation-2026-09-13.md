# Dynasty HQ consolidation — implementation and verification

September 13, 2026. Implemented locally after approval of the [module consolidation proposal](module-consolidation-proposal-2026-09-13.md). No commit or deployment performed.

## Navigation and placement

League navigation now uses six stable workspaces, with Settings and Help as utilities. Desktop and phone use the same workspace definitions.

| Workspace | Views |
|---|---|
| Home | Prioritized briefing, compact league summaries, upcoming dates, team health, direct Game Day shortcut when available |
| My Team | Roster, Game Day, Team outlook, GM plan, Decision review, dynasty Patterns |
| Market | Waivers, Trades where supported, Saved targets, Market review |
| Draft | Draft room with its existing preparation/live/history flows, Draft analysis |
| League | Standings & matchups, Calendar, History & trophies |
| Research | Stats, Players & picks, Compare, Custom reports |

Analytics reports render directly within their owning workspace. GM plan and the current roster assessment are explicitly labeled. The old GM Office destination still preserves its saved internal view. Existing module bookmarks resolve into the new groups without being overwritten while league capabilities load. Unsupported trade and GM actions retain format restrictions, including Chopped. Auction behavior remains covered by the draft regression suites.

Home presents the briefing first and reduces repeated roster/market cards in its starter layout. Chopped Home leads with compact personal survival odds and a link to the full risk table in League. Only the exact untouched prior starter is upgraded; customized and intentionally empty dashboards are preserved. Home holds summaries while League holds the detailed competition record. Calendar has moved out of Trophy Room. Help has a searchable reference, including the new workspace locations and notebook behavior.

Empire now has Overview, Actions, Leagues, and Assets. Specialized views remain accessible as sibling views. Its overview Priority Queue and full queue use the same recommendation records, and tracking sends those records into the existing decision journal. Trade entry points and restored Trade Desk state enforce league restrictions.

Commissioner now has Overview, Season & Schedule, Rules, People & Dues, and Reports. Bylaws and Dues reuse existing authorized controls in separate views. The signed-in hub puts leagues first, adds a last-league Resume action, and preserves the multi-league and Games areas with the Vault and Duat identities. Resume is stored separately from the active route, scoped to the account; its object storage preserves long league IDs as strings without numeric precision loss.

## Information that follows the decision

- Roster diagnosis, Gap Plan, and Game Day coverage actions carry applicable league, position, player, week, reason, and possible-drop context into waiver planning. Player selection and the planning panel retain that context.
- Shared player cards offer actions based on ownership, available roster data, league capability, and draft context. A free agent offers Plan waiver. Player cards also show ownership across synced leagues and state coverage rather than treating unloaded leagues as zero holdings.
- One player notebook supplies personal research and private league notes/watch status to player cards, Draft, and Saved targets. Storage is account/provider scoped. Legacy draft notes and intent tags migrate without changing board order or overwriting newer notebook edits.
- Waivers uses one ranked action plan; supporting add/drop, fresh-drop, coverage, and rival lists are expandable. A selected target exposes roster/drop context and bid evidence. Value-based bid ranges and competitive bid estimates have distinct labels, including an explanation when they disagree.
- Market and Draft link to their historical analysis. Decision review includes history and insights, while Research retains the full exploration tools.
- League Calendar and Commissioner use the same season anchor and week-to-date helper. Unscheduled draft dates remain TBD; approximate dates are labeled. Calendar widgets react when the season anchor finishes loading. Their shared capability check suppresses trade deadlines and Home trade recommendations in Chopped and trading-disabled leagues.

## Verification

All 19 selected regression suites passed: core, login/auth, click paths, intelligence surfaces, draft context, live draft, draft recap, draft strategy, analytics, live scores, dashboard/league, free agency, Stats, Cup, Chopped, first-class modes, new workspace integration, Empire, and Commissioner.

New behavioral coverage includes route compatibility and capability fallback; exact starter-layout migration; notebook account isolation and legacy migration; real player-card actions; Saved targets to waiver effect ordering; all grouped Empire/Commissioner views; queue-to-journal continuity; blocked Trade Desk rendering; contextual roster actions; and equivalent league/commissioner dates with private-reminder separation.

The preview build compiled 141 application scripts. Lint found zero errors in changed application files, with existing unused-variable warnings remaining. Whitespace checks passed.

Browser checks used the local development preview and Bigloco's connected league data. Verified desktop and 390-pixel phone navigation, populated Team outlook and GM plan, a fresh Game Day bookmark, Game Day's Week 13 TE need opening the filtered Market with its week/reason, free-agent Plan waiver and portfolio exposure, Saved targets, the dedicated Stats workspace, Calendar, Draft navigation, Empire queue continuity, and grouped Commissioner navigation. Calendar displayed the same November 10 estimated trade deadline as Commissioner after the shared derivation fix.

The final browser pass verified Resume and Last opened after returning to the hub; Chopped's compact survival summary opening the full League table; absence of Chopped trade recommendations/deadlines; old Chopped trade links falling back to Waivers; and the separate Commissioner Dues view. Browser error logs were empty across the reviewed flows. The affected login, navigation, workspace, and Empire suites also passed again after the Resume fix.

## Boundaries

The notebook and personal reminders are browser-local; private commissioner work remains private. This change does not add cloud notebook sync or publish commissioner drafts, reminders, dues, or reports to league members. Those require explicit shared-storage/publication work as described in the proposal.

Waiver and lineup views are planning tools; league-platform submissions retain their existing boundaries. Browser verification exercised navigation and planning, without submitting roster transactions, publishing reports, or editing league payments. It does not constitute a production deployment check or a multi-account synchronization test.

Pre-existing Stats mobile changes in the shared checkout were preserved and are not part of this implementation.
