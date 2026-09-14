# Dynasty HQ module consolidation proposal

Date: September 13, 2026. Status: approved proposal, implemented locally. This document records the original audit and recommendations; see [implementation and verification](module-consolidation-implementation-2026-09-13.md) for the resulting changes and boundaries.

The strongest opportunity is to organize Dynasty HQ around the decisions users make, then let its existing intelligence travel between those decisions. Reducing navigation is useful, but the larger improvement is continuity: recognizing a roster problem, comparing solutions, planning a move, and reviewing its outcome without rebuilding the context in each module.

## Evidence and limits

Reviewed the current source across league tools, player cards, Draft, Empire, Commissioner, and the signed-in hub. Opened the local app with Bigloco's leagues and inspected the hub, the in-season dynasty navigation, and the populated Home screen for The Psycho League: Year VI. Its menu contains 14 destinations, including Settings and Legend. Empire's source defines 12 peer navigation entries.

This is an information architecture review, not a production deployment check or a usage study. Local development unlocks features; account-specific production visibility may differ. Recommendations about frequency and preferred labels are hypotheses to test with representative tasks.

Prior product direction established three experience buckets: individual leagues, multi-league management, and Games. The current hub still implements that separation. Keep it, with a more direct route back to ongoing work.

## Recommended league navigation

Use this stable order. Within each workspace, keep clearly labeled sibling views rather than combining all content into a long page.

| Order | Destination | Job and contents |
|---|---|---|
| 1 | Home | What needs attention: priority decisions, next deadline, this week's matchup, compact team and league summaries, optional custom dashboard. |
| 2 | My Team | Manage the team: Roster, Game Day, Team Plan, and Decision Review. Preserve GM's Office identity as the plan/review area if desired. |
| 3 | Market | Improve the team: Waivers, Trades, and saved targets. Preserve distinct bid/add/drop and trade-building workflows. |
| 4 | Draft | Prepare, arrange the board, practice, follow the live draft, and review results. |
| 5 | League | Understand the competition: standings, all matchups, calendar, Cup, managers, rules, and history/trophies. |
| 6 | Research | Explore evidence: player/pick tables, Stats/Value/Scouting lenses, comparisons, and custom reports. |

Settings and Help remain consistently accessible outside the primary module list. Legend becomes searchable contextual help, with the full reference available. Account controls stay prominent in the app header.

This takes the maximum league menu from 12 content destinations plus two utilities to six workspaces plus utilities. The features remain accessible through related views and contextual shortcuts.

Home and League have explicit boundaries: Home tells me what matters and opens the relevant task; League is the detailed competition record. Do not move the entirety of League Central onto Home and also retain the same full content under League. The existing redraft/Chopped Command Center merger is evidence that the shell can be consolidated, not a requirement to copy its layout verbatim into every format.

## Where each current module goes

| Current module | Proposed treatment |
|---|---|
| Home | Keep the landing role. Reduce repeated rankings/health cards and prioritize actionable changes. Keep customization as an option. |
| My Roster | My Team → Roster. Preserve IR, taxi, cutdown, ownership, valuation, and data views. |
| Game Day | My Team → Game Day, with a direct in-season shortcut. Preserve working lineup, opponent view, season outlook, and the distinction between a plan and a platform-submitted lineup. |
| Compare | Research → Compare, also available directly from player cards, roster rows, trade packages, and opponent summaries. Preserve both team and player comparisons. |
| League Central | Becomes the main League view. Home retains only compact summaries linking here. |
| Stats | Research → Stats. Preserve weekly/season data, ownership filtering, metrics, game logs, and CSV export. |
| Trade Center | Market → Trades. Keep the trade finder/builder, Managers, and trade history as recognizable views. |
| Free Agency | Market → Waivers. Keep its full player explorer and replace competing recommendation stacks with one ranked plan. |
| Draft | Keep its own workspace; absorb draft-specific analysis and review from Analytics/GM Patterns. |
| Analytics | Redistribute by purpose: roster diagnosis to My Team; market outcomes to Market; draft outcomes to Draft; player/pick tables and custom reports to Research. Retire the generic top-level Analytics destination once its contents have clear homes. |
| GM's Office | My Team → Team Plan / Decision Review. Keep one strategy editor and one cross-category decision history. Contextual Alex access remains throughout the app. |
| Trophy Room | League → History, preserving its branded presentation, personal trophies, all-time records, Cup history, and chronicles. Move Calendar out. |
| Settings / Legend | Persistent utilities and contextual help. |

## Highest-value feature transfers

### 1. Let roster needs lead to a complete acquisition plan

Example: My Team identifies weak TE coverage → Improve TE → compare a waiver upgrade, an attainable trade, and a draft option when a relevant draft remains → select an option → arrive with player, position, week, roster need, and applicable budget/drop context preserved.

The Gap Plan already identifies free-agent candidates and trade partners. Game Day's Bye Watch already identifies future holes. The improvement is a contextual handoff, followed by an explanation of how each option changes the team. A link that merely opens Free Agency still leaves the user doing the assembly.

### 2. Make player cards aware of ownership and availability

The shared card currently distinguishes only players on my roster from everyone else. Its primary button offers Find Trade to a player who may actually be a free agent.

Use the selected league's current state: free agent → plan waiver/add-drop; rival-owned player → explore trade when permitted; draft-eligible player → board/queue in the appropriate draft context; own player → relevant lineup, hold, shop, or cut planning. Always preserve the originating task and format restrictions.

### 3. Carry scouting opinions through the season

Draft board notes and target/avoid/sleeper/must tags are stored separately from the shared card's trade/cut/watch/untouchable tags. Establish one player notebook with explicit personal and league-specific scope. A prospect watched before the draft should retain that note when undrafted, on waivers, or on a rival's roster.

Do not collapse all tags into one meaning or copy draft rankings into every view. Board order and draft-specific intent remain attached to the draft; shared observations and watch status travel with the player. Resolve conflicting tags explicitly.

### 4. Put historical evidence beside the next decision

Analytics' historical position prices can inform a waiver bid. GM Patterns' partner history can sit beside a prospective trade partner. Draft hit rates and positional tendencies can inform draft preparation. Deep reports remain available through an evidence link instead of being copied in full into multiple modules.

GM strategy already affects roster recommendations and Analytics. Build on that integration: show the active plan and its relevant rule beside an explanation, with one contextual edit path.

### 5. Make calendar information easy to find

Calendar currently sits beside My Trophies and All-Time in Trophy Room, and the Home calendar widget routes there. Move upcoming events to League → Calendar, put the next relevant deadline on Home, and show the applicable deadline inside Draft or Market.

Share an agenda model across league and commissioner views, with clear event sources and visibility. Current custom calendar entries and commissioner tasks include browser-local state; displaying them in a new screen does not publish them to league members. Personal reminders, private commissioner tasks, and published league dates need separate visibility rules.

### 6. Bring portfolio context into league decisions

Empire can show player exposure in a player card or proposed acquisition: an illustrative message is “Owned in 4 of 7 leagues; this acquisition would make 5.” This supplements the selected league's scoring, roster fit, and available assets. Never substitute a portfolio average for league-specific value.

Empire Trade Desk already reuses the league Trade Center and can seed owner/player context. Extend that existing pattern to other actions rather than creating a second trade implementation.

### 7. Track one recommendation from summary through outcome

Use a consistent action record with source, scope, reasoning, next step, status, and review date. Home and Empire show summaries of those records; detail views retain the same item and context.

Empire currently builds Priority Queue and Empire Moves separately, while “View all moves” from the queue opens the other list. Unify the identity and filtering before changing the presentation. Adapt Commissioner's useful acknowledgement, follow-up, and filtering interactions while keeping commissioner obligations separate from personal team decisions.

## Home and information placement

The inspected dynasty Home repeats the team's ranking/rebuilding assessment in the briefing, a recommendation, Power Rankings, and the elite/window card. It also displays the chosen Compete plan beside a Rebuilding assessment. Both concepts can be valid, but the distinction should be explicit: “Your plan” versus “Current assessment,” followed by what would close that gap.

Recommended reading order:

1. Needs attention: a small prioritized set of changes with a specific next step.
2. This week: matchup, lineup issue, and next relevant deadline.
3. Your team: one consolidated health/window summary.
4. Around the league: compact standings, Cup, and activity links.

Default to the facts needed for the current decision. Home summarizes; workspaces contain the full tools; a shared player/manager detail view supplies deeper evidence. Keep the League Wire available, but avoid having its content compete with identical large widgets by default.

Maintain stable navigation between seasons. Change Home priorities and offer direct Game Day/live Draft shortcuts rather than moving all menu entries around. Allow pinning frequent views if needed. Mobile should expose a small fixed set of primary destinations and a clear route to the rest; test discoverability before adopting a More menu.

## Empire consolidation

| Proposed area | Existing content it organizes |
|---|---|
| Overview | Command Bridge, priority summary, portfolio health. |
| Actions | Empire Moves, trade opportunities/Trade Desk, tracking, journal, and contextual owner intelligence. |
| Leagues | League stack, War Table, Threat Board, Season Outlook, and optional Provinces Map view. |
| Assets | Allocation, Asset Floor, Empire Index, Scout Board, Asset Workspace, player/pick details, and exposure. |

Several current entries are alternative visualizations of the same league or asset set. They should remain useful selectable views without each needing its own peer navigation position. Keep portfolio-wide scope visible, and carry the chosen league when opening an action.

## Commissioner and the hub

Commissioner can group its existing desks into Overview; Season & Schedule; Rules; People & Dues; Reports. Connect Season Setup to Schedule Builder, and connect Rule Lab to bylaws, amendments, ratification, and settings drift. Preserve operational ownership instead of mixing administrative controls into the owner's team workspace.

League-facing outputs can be valuable under League: published rules/amendments, official dates, and weekly recaps. Drafting/editing those materials, marking payments, recruitment notes, and private tasks stay in Commissioner. Shared publication/storage is a real prerequisite for showing these to other members.

At the hub, preserve the established three experience buckets and distinct Vault/Duat branding. Add a compact Resume entry and prioritize the user's leagues for returning league managers. The current management/Games block precedes the league list; Games need not push frequently opened teams farther down. Avoid forcing the same default landing destination on game-focused users.

## Suggested sequence

1. **Immediate placement and continuity improvements:** move Calendar, fix player-card destination logic, reduce duplicated Home summaries, clarify plan versus assessment, carry context in existing handoffs, and make Empire's View all actions consistent.
2. **Prototype navigation grouping:** use current screens under the proposed six league workspaces and four Empire areas. Preserve old direct links and saved views. Test finding Game Day, a waiver replacement, a player comparison, a deadline, and a past draft result before retiring existing navigation.
3. **Consolidate shared information:** player notebook, shared research views, one roster diagnosis, shared recommendation identity, and scoped agendas. Migrate existing notes/tags rather than leaving two stores active indefinitely.
4. **Redistribute deeper analysis:** place each Analytics/GM report with its relevant decision, retain a Research home for exploration, and retire duplicate presentations only after equivalent capabilities are reachable.

Success means users can find and complete a decision with less searching and less repeated context entry, while keeping useful data and controls. Menu count alone is not the success criterion.

## Source anchors

- [League navigation and existing merged-home behavior](/Users/jacobc/Projects/warroom/js/league-detail.js:242)
- [Current hub ordering](/Users/jacobc/Projects/warroom/js/app.js:1245)
- [Analytics sections](/Users/jacobc/Projects/warroom/js/tabs/analytics.js:209)
- [GM's Office views](/Users/jacobc/Projects/warroom/js/tabs/alex-insights.js:1988)
- [Stats exploration and export](/Users/jacobc/Projects/warroom/js/tabs/stats.js:117)
- [Game Day Bye Watch](/Users/jacobc/Projects/warroom/js/tabs/lineup.js:888)
- [Gap Plan acquisition routes](/Users/jacobc/Projects/warroom/js/widgets/gap-plan.js:191)
- [Player-card ownership check](/Users/jacobc/Projects/warroom/js/components/player-card.js:446) and [actions](/Users/jacobc/Projects/warroom/js/components/player-card.js:888)
- [Draft notebook storage](/Users/jacobc/Projects/warroom/js/draft-room.js:1024)
- [Calendar inside Trophy Room](/Users/jacobc/Projects/warroom/js/tabs/trophy-room.js:1374)
- [Empire navigation](/Users/jacobc/Projects/warroom/js/tabs/global-view.js:3030), [separate recommendation builders](/Users/jacobc/Projects/warroom/js/tabs/global-view.js:1885), and [Trade Center reuse](/Users/jacobc/Projects/warroom/js/tabs/global-view.js:2843)
- [Commissioner desk inventory](/Users/jacobc/Projects/warroom/js/tabs/commissioner-office.js:854)
