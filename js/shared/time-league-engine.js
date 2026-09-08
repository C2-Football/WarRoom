// ══════════════════════════════════════════════════════════════════
// time-league-engine.js — pure state machine for the Time League game mode.
// Every function returns a new state (inputs are never mutated) and all
// randomness flows from createSeededRandom with seeds derived from
// `state.seed`, so any league can be replayed exactly from its creation
// inputs plus the action log.
//
// Ported from The Duat's app/time-league-engine.ts.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { createDraftOrder, findOpenRosterSlot } = App.TimeLeagueDraftRoom;
    const { eraEligibleCard, filterSeasonsForEra, normalizeEraDraftRules, openDraftEra } = App.TimeLeagueEraRules;
    const {
        createSeededRandom, expandRosterSlots, normalizePlayerPosition, ROSTER_SLOT_IDS, SLOT_ELIGIBILITY,
    } = App.TimeLeagueRoster;
    const {
        buildRoundRobinSchedule, eraFactorFor, gameLogKey, isStarterSlot, scoreStatLine, REFERENCE_EXTENDED_SCORING,
    } = App.TimeLeagueSeason;

    const round2 = (value) => Math.round(value * 100) / 100;
    const fixed1 = (value) => value.toFixed(1);

    // Shared by setup, local saves and the multiplayer runtime. IDs are stable save data.
    const AI_PERSONAS = {
        warlord: { label: 'The Warlord', aggression: 92, patience: 18, riskTolerance: 70, peakWeight: 0.78, needWeight: 0.5, positionBias: {}, tell: 'Pays up for stars. Attacks the wire and pushes for quick deals.', pitch: 'Here is my opening shot.', accept: 'That gives me more firepower. Done.', reject: 'That does not make me stronger. Bring more.' },
        archivist: { label: 'The Archivist', aggression: 28, patience: 88, riskTolerance: 22, peakWeight: 0.2, needWeight: 0.55, positionBias: {}, tell: 'Trusts the full decade. Saves waiver money and demands a trade premium.', pitch: 'I have checked the numbers on this exchange.', accept: 'The value clears my threshold. Agreed.', reject: 'The return does not justify the cost. I will pass.' },
        gambler: { label: 'The Gambler', aggression: 64, patience: 12, riskTolerance: 96, peakWeight: 0.95, needWeight: 0.35, positionBias: {}, tell: 'Chases huge seasons. Takes thin trades and keeps rolling on waivers.', pitch: 'I have a hand worth playing.', accept: 'I like those odds. Deal me in.', reject: 'Those odds are not worth the bet. Try another hand.' },
        steward: { label: 'The Steward', aggression: 45, patience: 78, riskTolerance: 40, peakWeight: 0.4, needWeight: 0.7, positionBias: {}, tell: 'Builds a balanced lineup. Protects depth and spends carefully.', pitch: 'This should fill a need for both of us.', accept: 'That is a sound fit for my roster. Agreed.', reject: 'I would be leaving my roster too thin. Let us try something else.' },
        broker: { label: 'The Broker', aggression: 76, patience: 46, riskTolerance: 54, peakWeight: 0.55, needWeight: 0.45, positionBias: { WR: 1.06 }, tell: 'Keeps the trade desk busy. Collects receivers and negotiates close deals.', pitch: 'Let us make something happen.', accept: 'The price works. We have a deal.', reject: 'We are apart on price. Improve the offer and call me back.' },
        scout: { label: 'The Scout', aggression: 51, patience: 38, riskTolerance: 82, peakWeight: 0.84, needWeight: 0.6, positionBias: { TE: 1.09, WR: 1.04 }, tell: 'Hunts breakout seasons and scarce tight ends. Works the wire early.', pitch: 'There is upside here that I do not think you are using.', accept: 'That is a player I want to bet on. Agreed.', reject: 'I see more upside in the player I already have.' },
        tactician: { label: 'The Tactician', aggression: 58, patience: 66, riskTolerance: 31, peakWeight: 0.32, needWeight: 0.9, positionBias: { QB: 1.08, TE: 1.07 }, tell: 'Fills scarce starting roles first. Trades to fix specific lineup holes.', pitch: 'Our roster needs line up. Here is the move.', accept: 'That solves the lineup problem. Make the move.', reject: 'That leaves a hole in my starting lineup. It is a no.' },
        grinder: { label: 'The Grinder', aggression: 39, patience: 93, riskTolerance: 12, peakWeight: 0.08, needWeight: 0.75, positionBias: { RB: 1.06 }, tell: 'Chooses steady production. Waits for clear upgrades and avoids bidding wars.', pitch: 'Nothing fancy. A useful player each way.', accept: 'Reliable production. That works for me.', reject: 'I would rather keep the dependable points.' },
        showman: { label: 'The Showman', aggression: 98, patience: 8, riskTolerance: 86, peakWeight: 0.9, needWeight: 0.3, positionBias: { QB: 1.08, WR: 1.08 }, tell: 'Wants a headline roster. Bids big for quarterbacks and receivers.', pitch: 'Picture the headlines when we announce this.', accept: 'Now that is a blockbuster. Let us do it.', reject: 'That offer needs a bigger marquee name.' },
        contrarian: { label: 'The Contrarian', aggression: 34, patience: 57, riskTolerance: 63, peakWeight: 0.26, needWeight: 0.48, positionBias: { RB: 1.12, TE: 1.09 }, tell: 'Favors deep production over one famous peak. Buys backs and tight ends.', pitch: 'The obvious move is not always the useful one.', accept: 'I see value where you do not. Accepted.', reject: 'You are charging me for the hype. Pass.' },
        alchemist: { label: 'The Alchemist', aggression: 69, patience: 27, riskTolerance: 91, peakWeight: 0.88, needWeight: 0.65, positionBias: { RB: 1.04, TE: 1.12 }, tell: 'Builds around explosive combinations. Churns the bench for another spark.', pitch: 'These pieces could work better in different lineups.', accept: 'That changes the mix in exactly the right way. Done.', reject: 'That combination does not improve the experiment.' },
        sentinel: { label: 'The Sentinel', aggression: 24, patience: 84, riskTolerance: 18, peakWeight: 0.14, needWeight: 0.85, positionBias: { K: 1.15, DEF: 1.2 }, tell: 'Secures every starting spot, including special teams. Guards budget and depth.', pitch: 'I can strengthen both our weak spots with this.', accept: 'That shores up my lineup. Agreed.', reject: 'I am not giving up that security for this return.' },
    };
    const AI_PERSONA_IDS = Object.keys(AI_PERSONAS);
    const AI_MANAGERS = [
        ['Warlord Kade', 'warlord'], ['The Archivist', 'archivist'],
        ['Riverboat Sol', 'gambler'], ['Steward Vance', 'steward'],
        ['Frankie Deals', 'broker'], ['Scout Ellis', 'scout'],
        ['Coach Hollis', 'tactician'], ['Iron Ledger', 'grinder'],
        ['Blitz Monroe', 'showman'], ['Professor Vale', 'contrarian'],
        ['Maverick Jules', 'alchemist'], ['Steel Sutton', 'sentinel'],
    ];

    /** One catalog for setup, API-created leagues and older unnamed AI seats. */
    function defaultAiSeat(index = 1, occupiedNames = []) {
        const start = Math.max(0, index - 1) % AI_MANAGERS.length;
        const taken = new Set(occupiedNames.map(name => name.trim().toLowerCase()));
        const choices = [...AI_MANAGERS.slice(start), ...AI_MANAGERS.slice(0, start)];
        const [name, aiPersona] = choices.find(([candidate]) => !taken.has(candidate.toLowerCase())) || choices[0];
        return { name, manager: 'ai', aiPersona, helmet: App.TimeLeagueHelmet.defaultHelmet(name) };
    }

    function managerIdentity(value, index) {
        const fallback = defaultAiSeat(index);
        const name = typeof value.name === 'string' ? value.name.trim() : '';
        // Only replace the exact placeholder emitted by the old Add team flow.
        const legacyName = index >= 6 && name === `Rival ${index}`;
        return {
            name: name && !legacyName ? name : fallback.name,
            aiPersona: AI_PERSONA_IDS.includes(value.aiPersona) ? value.aiPersona : fallback.aiPersona,
        };
    }

    const idNumber = (id, prefix) => {
        const value = Number(id.slice(prefix.length));
        return Number.isFinite(value) ? value : 0;
    };

    const nextId = (prefix, ids) => `${prefix}${ids.reduce((max, id) => Math.max(max, idNumber(id, prefix)), 0) + 1}`;

    const appendEvents = (activity) => {
        const events = [...activity];
        let last = events.reduce((max, event) => Math.max(max, idNumber(event.id, "a")), 0);
        return {
            push(week, kind, message, createdAt) {
                last += 1;
                events.push({ id: `a${last}`, week, kind, message, createdAt });
            },
            list: () => events,
        };
    };

    /**
     * The mystery draw. Callers pass the era-filtered season list, so a league
     * can never hand out a season its own rules forbid; an empty list means the
     * card is undraftable rather than silently drawn from the whole career.
     */
    const drawSeasonFrom = (seasons, seedKey) => {
        if (!seasons.length) return null;
        const random = createSeededRandom(seedKey);
        return seasons[Math.floor(random() * seasons.length)].season;
    };

    /** PlayerPosition order; the roulette deals a decade to every one of them. */
    const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

    /** Seasons this card may still be drawn from under the league's era rules. */
    const eraSeasons = (state, card) => filterSeasonsForEra(card.seasons, state.settings.eraRules, card.position);

    /** One line for the founding log; null unless a roulette actually dealt decades. */
    function rouletteLine(rules) {
        if (rules.mode !== "position-roulette") return null;
        const dealt = Object.entries(rules.positionDecades ?? {})
            .filter((entry) => Boolean(entry[1]))
            .map(([position, decade]) => `${position} ${decade}`);
        return dealt.length ? `Era roulette — ${dealt.join(" · ")}` : null;
    }

    /** Waiver adds outlive draft numbering, so scan every record that holds an entry id. */
    const nextEntryNumber = (state) => {
        const scan = (ids) => ids.reduce((max, id) => Math.max(max, idNumber(id, "e")), 0);
        return Math.max(
            scan(state.draftPicks.map((pick) => pick.entryId)),
            scan(state.teams.flatMap((team) => team.roster.map((entry) => entry.entryId))),
            scan(state.finalizedWeeks.flatMap((week) => week.results.flatMap((result) => result.starters.map((starter) => starter.entryId)))),
        ) + 1;
    };

    const STARTER_SLOT_ORDER = ROSTER_SLOT_IDS.filter((slot) => slot !== "BN" && slot !== "IR" && slot !== "TAXI");

    /** Draftable capacity: starters plus bench. IR/TAXI are excluded because the draft cannot fill them. */
    function rosterCapacity(settings) {
        return expandRosterSlots(settings.rosterSlots).length;
    }

    const DRAFT_PICK_SECONDS = [0, 15, 30, 60, 90, 120, 180, 300];
    const DRAFT_AI_SECONDS = [0.5, 1, 2, 4, 8];
    function draftSettings(value = {}, isNew = false) {
        return {
            draftFormat: ['linear', 'auction'].includes(value.draftFormat) ? value.draftFormat : 'snake',
            draftPickSeconds: DRAFT_PICK_SECONDS.includes(value.draftPickSeconds) ? value.draftPickSeconds : (isNew ? 60 : 0),
            draftAiSeconds: DRAFT_AI_SECONDS.includes(value.draftAiSeconds) ? value.draftAiSeconds : 2,
            draftAuctionBudget: Number.isInteger(value.draftAuctionBudget) ? Math.max(50, Math.min(1000, value.draftAuctionBudget)) : 200,
        };
    }
    const validStamp = stamp => typeof stamp === 'string' && Number.isFinite(Date.parse(stamp));
    function normalizeDraftClock(clock, settings) {
        // Existing saves never acquire a ticking deadline simply by being opened.
        if (!clock || !['waiting', 'running', 'paused'].includes(clock.status)) return { status: 'running', startedAt: null, deadlineAt: null, remainingMs: 0 };
        return {
            status: clock.status,
            startedAt: validStamp(clock.startedAt) ? clock.startedAt : null,
            deadlineAt: clock.status === 'running' && settings.draftPickSeconds > 0 && validStamp(clock.deadlineAt) ? clock.deadlineAt : null,
            remainingMs: Number.isFinite(clock.remainingMs) ? Math.max(0, Math.min(300000, clock.remainingMs)) : settings.draftPickSeconds * 1000,
        };
    }
    function restartedClock(state, stamp, durationMs = (state.settings.draftPickSeconds || 0) * 1000) {
        const clock = normalizeDraftClock(state.draftClock, state.settings);
        const running = clock.status === 'running';
        return { status: clock.status, startedAt: validStamp(stamp) ? stamp : clock.startedAt, deadlineAt: running && durationMs > 0 && validStamp(stamp) ? new Date(Date.parse(stamp) + durationMs).toISOString() : null, remainingMs: durationMs };
    }
    function startDraft(state, stamp) {
        if (state.phase !== 'draft' || !validStamp(stamp) || state.draftClock?.status !== 'waiting') return state;
        const next = { ...state, draftClock: { ...state.draftClock, status: 'running' } };
        return { ...next, draftClock: restartedClock(next, stamp) };
    }
    function pauseDraft(state, stamp) {
        if (state.phase !== 'draft' || !validStamp(stamp) || state.draftClock?.status !== 'running') return state;
        const remainingMs = state.draftClock.deadlineAt ? Math.max(0, Date.parse(state.draftClock.deadlineAt) - Date.parse(stamp)) : 0;
        return { ...state, draftClock: { ...state.draftClock, status: 'paused', deadlineAt: null, remainingMs } };
    }
    function resumeDraft(state, stamp) {
        if (state.phase !== 'draft' || !validStamp(stamp) || state.draftClock?.status !== 'paused') return state;
        const next = { ...state, draftClock: { ...state.draftClock, status: 'running' } };
        const remaining = state.settings.draftPickSeconds > 0 ? Math.max(1, state.draftClock.remainingMs) : 0;
        return { ...next, draftClock: restartedClock(next, stamp, remaining) };
    }
    function configureDraft(state, patch, stamp) {
        if (state.phase !== 'draft' || !validStamp(stamp) || !patch) return state;
        if (patch.draftPickSeconds !== undefined && !DRAFT_PICK_SECONDS.includes(patch.draftPickSeconds)) return state;
        if (patch.draftAiSeconds !== undefined && !DRAFT_AI_SECONDS.includes(patch.draftAiSeconds)) return state;
        const settings = { ...state.settings, ...draftSettings({ ...state.settings, draftPickSeconds: patch.draftPickSeconds ?? state.settings.draftPickSeconds, draftAiSeconds: patch.draftAiSeconds ?? state.settings.draftAiSeconds }) };
        const next = { ...state, settings };
        return { ...next, draftClock: patch.draftPickSeconds !== undefined ? restartedClock(next, stamp) : state.draftClock };
    }
    function normalizeAuction(raw, teams, picks) {
        let nomination = null;
        const n = raw?.nomination;
        if (n && typeof n.identity === 'string' && typeof n.name === 'string' && normalizePlayerPosition(n.position)
            && teams.some(t => t.teamId === n.nominatedBy) && teams.some(t => t.teamId === n.highTeamId)
            && Number.isInteger(n.highBid) && n.highBid > 0 && n.highBid <= 1000 && !picks.some(p => p.identity === n.identity)) {
            nomination = { identity: n.identity, name: n.name, position: n.position, nominatedBy: n.nominatedBy, highTeamId: n.highTeamId, highBid: n.highBid };
        }
        return { nomination, nominationIndex: Number.isInteger(raw?.nominationIndex) && raw.nominationIndex >= 0 ? raw.nominationIndex : 0, lastAiAt: validStamp(raw?.lastAiAt) ? raw.lastAiAt : null };
    }
    function auctionMaxBid(state, teamId) {
        const team = state.teams.find(item => item.teamId === teamId);
        if (!team) return 0;
        const spots = rosterCapacity(state.settings) - team.roster.length;
        return spots > 0 ? Math.max(0, (team.draftBudgetRemaining ?? state.settings.draftAuctionBudget ?? 200) - (spots - 1)) : 0;
    }
    function auctionCanBid(state, teamId, card) {
        const team = state.teams.find(item => item.teamId === teamId);
        return Boolean(team && card && auctionMaxBid(state, teamId) > 0 && !draftedIdentities(state).has(card.identity)
            && positionIsStartable(state.settings, card.position) && eraEligibleCard(card, state.settings.eraRules)
            && findOpenRosterSlot(card.position, team.roster.map(entry => entry.slot), state.settings.rosterSlots, state.settings.maxQuarterbacks, team.roster.map(entry => entry.position)));
    }
    const draftOpen = state => state.phase === 'draft' && (!state.draftClock || state.draftClock.status === 'running');
    const beforeDeadline = (state, stamp) => !state.draftClock?.deadlineAt || Date.parse(stamp) < Date.parse(state.draftClock.deadlineAt);
    function nominateAuctionPlayer(state, teamId, card, amount = 1, stamp) {
        if (state.settings.draftFormat !== 'auction' || !draftOpen(state) || !validStamp(stamp) || !beforeDeadline(state, stamp)
            || state.draftAuction?.nomination || currentDraftSeat(state)?.teamId !== teamId || !auctionCanBid(state, teamId, card)
            || !Number.isInteger(amount) || amount < 1 || amount > auctionMaxBid(state, teamId)) return state;
        return { ...state, draftAuction: { ...state.draftAuction, nomination: { identity: card.identity, name: card.name, position: card.position, nominatedBy: teamId, highTeamId: teamId, highBid: amount }, lastAiAt: stamp }, draftClock: restartedClock(state, stamp) };
    }
    function bidAuctionPlayer(state, teamId, amount, stamp, cards) {
        const n = state.draftAuction?.nomination;
        const card = cards?.get(n?.identity);
        // With no card index, roster legality still uses the nominated position;
        // its era eligibility was validated when the nomination was opened.
        const team = state.teams.find(item => item.teamId === teamId);
        const legal = team && n && findOpenRosterSlot(n.position, team.roster.map(e => e.slot), state.settings.rosterSlots, state.settings.maxQuarterbacks, team.roster.map(e => e.position));
        if (state.settings.draftFormat !== 'auction' || !draftOpen(state) || !validStamp(stamp) || !beforeDeadline(state, stamp)
            || !n || n.highTeamId === teamId || !legal || !Number.isInteger(amount) || amount <= n.highBid || amount > auctionMaxBid(state, teamId)
            || (cards && !auctionCanBid(state, teamId, card))) return state;
        return { ...state, draftAuction: { ...state.draftAuction, nomination: { ...n, highTeamId: teamId, highBid: amount } }, draftClock: restartedClock(state, stamp) };
    }
    function auctionCanClose(state, cards, stamp) {
        if (!state.draftAuction?.nomination || !draftOpen(state) || !validStamp(stamp)) return false;
        if (state.draftClock?.deadlineAt) return Date.parse(stamp) >= Date.parse(state.draftClock.deadlineAt);
        const due = Math.max(Date.parse(state.draftClock?.startedAt) || 0, Date.parse(state.draftAuction?.lastAiAt) || 0) + (state.settings.draftAiSeconds || 2) * 1000;
        return Date.parse(stamp) >= due && (!App.TimeLeagueAI || App.TimeLeagueAI.aiAuctionStep(state, cards, stamp) === state);
    }
    function closeAuction(state, cards, stamp) {
        const n = state.draftAuction?.nomination;
        if (state.settings.draftFormat !== 'auction' || !draftOpen(state) || !validStamp(stamp) || !n || !cards.has(n.identity)) return state;
        if (state.draftClock?.deadlineAt && Date.parse(stamp) < Date.parse(state.draftClock.deadlineAt)) return state;
        const winner = state.teams.find(t => t.teamId === n.highTeamId);
        const next = applyDraftPick(state, cards.get(n.identity), { madeBy: winner.manager, createdAt: stamp, auctionAward: true });
        if (next === state) return state;
        return { ...next,
            teams: next.teams.map(team => team.teamId === winner.teamId ? { ...team, draftBudgetRemaining: (winner.draftBudgetRemaining ?? state.settings.draftAuctionBudget ?? 200) - n.highBid } : team),
            draftAuction: { nomination: null, nominationIndex: (state.teams.findIndex(t => t.teamId === n.nominatedBy) + 1) % state.teams.length, lastAiAt: stamp },
        };
    }
    function expireDraftClock(state, cards, stamp) {
        if (!draftOpen(state) || !validStamp(stamp) || !state.draftClock?.deadlineAt || Date.parse(stamp) < Date.parse(state.draftClock.deadlineAt)) return state;
        if (state.settings.draftFormat === 'auction' && state.draftAuction?.nomination) return closeAuction(state, cards, stamp);
        const seat = currentDraftSeat(state), team = state.teams.find(t => t.teamId === seat?.teamId);
        if (!team) return state;
        const legal = card => auctionCanBid({ ...state, teams: state.teams.map(t => t.teamId === team.teamId ? { ...t, draftBudgetRemaining: 1000 } : t) }, team.teamId, card);
        const card = team.queue.map(id => cards.get(id)).find(legal) || App.TimeLeagueAI?.aiDraftChoice(state, cards) || eraEligibleCards(state, cards).find(legal);
        if (!card) return state;
        if (state.settings.draftFormat === 'auction') {
            const open = { ...state, draftClock: restartedClock(state, stamp) };
            return nominateAuctionPlayer(open, team.teamId, card, 1, stamp);
        }
        return applyDraftPick(state, card, { madeBy: team.manager, createdAt: stamp });
    }

    // Cosmetic identity must survive the same round trips as roster state.
    // Missing or malformed cosmetics never invalidate an older league save.
    const TEAM_BACKDROPS = ['midnight', 'stadium', 'gridiron', 'heritage', 'aurora'];
    function teamDesign(value, teamId) {
        const Helmet = App.TimeLeagueHelmet;
        const helmet = Helmet.normalizeHelmet(value.helmet, teamId);
        const safeColor = (color, fallback) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback.toUpperCase();
        return {
            helmet,
            primaryColor: safeColor(value.primaryColor, Helmet.shellColorFor(helmet)),
            secondaryColor: safeColor(value.secondaryColor, helmet.accentColor),
            backdrop: TEAM_BACKDROPS.includes(value.backdrop) ? value.backdrop : 'midnight',
        };
    }

    function createTimeLeague(input) {
        const teams = input.seats.map((seat, index) => {
            const teamId = `t${index + 1}`;
            return {
                teamId,
                name: seat.name,
                manager: seat.manager,
                ...(seat.aiPersona ? { aiPersona: seat.aiPersona } : {}),
                ...(seat.manager === 'ai' ? managerIdentity(seat, index + (input.seats[0]?.manager === 'ai' ? 1 : 0)) : {}),
                // Setup always hands one over (defaultSeats / addSeat both stamp
                // one in), but a manually-built seats array (tests, deep links)
                // still lands on a real, deterministic helmet instead of none.
                ...teamDesign(seat, teamId),
                roster: [],
                queue: [],
                ...(input.settings.waiverMode === "faab" ? { faabRemaining: input.settings.faabBudget } : {}),
            };
        });
        const teamIds = teams.map((team) => team.teamId);
        const draftOrder = createDraftOrder(teamIds, rosterCapacity(input.settings), input.settings.draftFormat === "linear" ? "linear" : "snake")
            .map(({ overall, round, teamId }) => ({ overall, round, teamId }));
        const schedule = buildRoundRobinSchedule(teamIds, input.settings.regularSeasonWeeks)
            .map(({ week, pairs }) => ({ week, pairs }));
        const random = createSeededRandom(`${input.seed}:${input.createdAt}:league-id`);
        const leagueId = `tl-${Array.from({ length: 10 }, () => "0123456789abcdefghjkmnpqrstvwxyz"[Math.floor(random() * 32)]).join("")}`;
        // Roulette rolls once, here, and is frozen into the stored settings: the
        // board, the draws and the waiver wire all read the same assignment forever.
        const settings = {
            ...input.settings,
            ...draftSettings(input.settings, true),
            playoffTeams: input.settings.playoffTeams || 0,
            advancementMode: input.settings.advancementMode || 'commissioner',
            gateHours: input.settings.gateHours || 24,
            eraRules: openDraftEra(input.settings.eraRules || { mode: "position-roulette", decades: [] }, `${input.seed}:era`, POSITIONS.filter(position => positionIsStartable(input.settings, position))),
        };
        const founding = [{
            id: "a1",
            week: 1,
            kind: "league",
            message: `League founded — ${input.name}, ${teams.length} seats, ${input.settings.regularSeasonWeeks} weeks`,
            createdAt: input.createdAt,
        }];
        const roulette = rouletteLine(settings.eraRules);
        if (roulette) founding.push({ id: "a2", week: 1, kind: "league", message: "Position Roulette sealed — reveal each position in the draft room.", createdAt: input.createdAt });
        return {
            version: 1,
            leagueId,
            name: input.name,
            seed: input.seed,
            createdAt: input.createdAt,
            phase: "draft",
            settings,
            teams: teams.map(team => ({ ...team, draftBudgetRemaining: settings.draftAuctionBudget })),
            draftOrder,
            draftClock: { status: "waiting", startedAt: null, deadlineAt: null, remainingMs: settings.draftPickSeconds * 1000 },
            draftAuction: { nomination: null, nominationIndex: 0, lastAiAt: null },
            draftPicks: [],
            seasonsRevealed: false,
            currentWeek: 1,
            weekStage: 'claims',
            gateStartedAt: input.createdAt,
            gateVotes: [],
            schedule,
            finalizedWeeks: [],
            pendingClaims: [],
            trades: [],
            waiverResults: [],
            activity: founding,
            rivalMessages: [],
            rivalRelationships: [],
        };
    }

    function currentDraftSeat(state) {
        if (state.settings.draftFormat === 'auction') {
            const eligible = state.teams.filter(team => team.roster.length < rosterCapacity(state.settings));
            if (!eligible.length) return null;
            const start = (state.draftAuction?.nominationIndex || 0) % state.teams.length;
            const team = state.teams.slice(start).concat(state.teams.slice(0, start)).find(item => eligible.includes(item));
            return { overall: state.draftPicks.length + 1, round: Math.floor(state.draftPicks.length / state.teams.length) + 1, teamId: team.teamId };
        }
        const taken = new Set(state.draftPicks.map((pick) => pick.overall));
        return state.draftOrder.find((seat) => !taken.has(seat.overall)) ?? null;
    }

    function draftedIdentities(state) {
        return new Set(state.draftPicks.map((pick) => pick.identity));
    }

    /**
     * The live draft board: every card the league's era rules can still field,
     * minus the identities already off the board. Best peaks first.
     */
    function eraEligibleCards(state, cards) {
        const taken = draftedIdentities(state);
        return [...cards.values()]
            .filter((card) => !taken.has(card.identity)
                && positionIsStartable(state.settings, card.position)
                && eraEligibleCard(card, state.settings.eraRules))
            .sort((left, right) => right.peak - left.peak || left.identity.localeCompare(right.identity));
    }

    /**
     * A league with no kicker or defense slot has no kickers or defenses in its
     * player pool at all — otherwise they are draftable, look valuable on peak,
     * and then sit on a bench where they can never score.
     */
    function positionIsStartable(settings, position) {
        return STARTER_SLOT_ORDER.some((slot) => (settings.rosterSlots[slot] ?? 0) > 0 && SLOT_ELIGIBILITY[slot].includes(position));
    }

    function applyDraftPick(state, card, opts) {
        let seat = state.phase === "draft" ? currentDraftSeat(state) : null;
        if (state.settings.draftFormat === 'auction') {
            if (!opts.auctionAward || !state.draftAuction?.nomination) return state;
            seat = { ...seat, teamId: state.draftAuction.nomination.highTeamId };
        }
        if (!seat || draftedIdentities(state).has(card.identity)) return state;
        const team = state.teams.find((item) => item.teamId === seat.teamId);
        if (!team) return state;
        const open = findOpenRosterSlot(
            card.position,
            team.roster.map((entry) => entry.slot),
            state.settings.rosterSlots,
            state.settings.maxQuarterbacks,
            team.roster.map((entry) => entry.position),
        );
        const drawnSeason = drawSeasonFrom(eraSeasons(state, card), `${state.seed}:draw:${card.identity}:${seat.overall}`);
        if (!open || drawnSeason === null) return state;
        const entry = {
            entryId: `e${seat.overall}`,
            identity: card.identity,
            name: card.name,
            position: card.position,
            drawnSeason,
            slot: open.slot,
            acquiredVia: "draft",
            acquiredWeek: state.currentWeek,
        };
        const pick = {
            overall: seat.overall,
            round: seat.round,
            teamId: seat.teamId,
            entryId: entry.entryId,
            identity: card.identity,
            name: card.name,
            position: card.position,
            madeBy: opts.madeBy,
            ...(opts.auctionAward ? { auctionPrice: state.draftAuction.nomination.highBid } : {}),
        };
        const pickInRound = state.draftOrder.filter((item) => item.round === seat.round)
            .findIndex((item) => item.overall === seat.overall) + 1;
        const complete = state.draftPicks.length + 1 >= state.draftOrder.length;
        const events = appendEvents(state.activity);
        events.push(state.currentWeek, "draft", opts.auctionAward ? `Auction — ${team.name} wins ${card.name}, ${card.position} for $${state.draftAuction.nomination.highBid}` : `R${seat.round}.${String(pickInRound).padStart(2, "0")} — ${team.name} selects ${card.name}, ${card.position}`, opts.createdAt);
        if (complete) events.push(state.currentWeek, "league", "Draft complete — mystery seasons revealed", opts.createdAt);
        return {
            ...state,
            phase: complete ? "season" : state.phase,
            draftClock: complete ? { ...state.draftClock, status: "paused", deadlineAt: null, remainingMs: 0 } : restartedClock(state, opts.createdAt),
            seasonsRevealed: complete || state.seasonsRevealed,
            teams: state.teams.map((item) => (item.teamId === team.teamId ? { ...item, roster: [...item.roster, entry] } : item)),
            draftPicks: [...state.draftPicks, pick],
            activity: events.list(),
        };
    }

    function setEntrySlot(state, teamId, entryId, slot, targetEntryId) {
        const team = state.teams.find((item) => item.teamId === teamId);
        const entry = team?.roster.find((item) => item.entryId === entryId);
        if (!team || !entry || entry.slot === slot) return state;
        const target = targetEntryId ? team.roster.find(item => item.entryId === targetEntryId && item.slot === slot) : null;
        if (targetEntryId && (!target || !SLOT_ELIGIBILITY[entry.slot]?.includes(target.position))) return state;
        const capacity = state.settings.rosterSlots[slot] ?? 0;
        if (capacity <= 0 || !SLOT_ELIGIBILITY[slot].includes(entry.position)) return state;
        const moves = new Map([[entryId, slot]]);
        const occupants = team.roster.filter((item) => item.slot === slot);
        if (target || occupants.length >= capacity) {
            const partner = target || occupants.find((item) => SLOT_ELIGIBILITY[entry.slot].includes(item.position));
            if (partner) {
                moves.set(partner.entryId, entry.slot);
            } else {
                const benchUsed = team.roster.filter((item) => item.slot === "BN" && item.entryId !== entryId).length;
                if (benchUsed >= (state.settings.rosterSlots.BN ?? 0)) return state;
                moves.set(occupants[0].entryId, "BN");
            }
        }
        return {
            ...state,
            teams: state.teams.map((item) => (item.teamId !== teamId ? item : {
                ...item,
                roster: item.roster.map((member) => (moves.has(member.entryId) ? { ...member, slot: moves.get(member.entryId) } : member)),
            })),
        };
    }

    function autoFillLineup(state, teamId, cards) {
        const team = state.teams.find((item) => item.teamId === teamId);
        if (!team) return state;
        const open = new Map();
        for (const slot of STARTER_SLOT_ORDER) {
            const room = (state.settings.rosterSlots[slot] ?? 0) - team.roster.filter((item) => item.slot === slot).length;
            if (room > 0) open.set(slot, room);
        }
        const seasonPoints = (entry) => cards.get(entry.identity)?.seasons.find((item) => item.season === entry.drawnSeason)?.points ?? 0;
        const bench = team.roster
            .filter((item) => item.slot === "BN")
            .sort((left, right) => seasonPoints(right) - seasonPoints(left) || left.entryId.localeCompare(right.entryId));
        const moves = new Map();
        for (const entry of bench) {
            const slot = STARTER_SLOT_ORDER.find((candidate) => (open.get(candidate) ?? 0) > 0 && SLOT_ELIGIBILITY[candidate].includes(entry.position));
            if (!slot) continue;
            moves.set(entry.entryId, slot);
            open.set(slot, (open.get(slot) ?? 0) - 1);
        }
        if (!moves.size) return state;
        return {
            ...state,
            teams: state.teams.map((item) => (item.teamId !== teamId ? item : {
                ...item,
                roster: item.roster.map((member) => (moves.has(member.entryId) ? { ...member, slot: moves.get(member.entryId) } : member)),
            })),
        };
    }

    function lineupProblems(state, teamId) {
        const team = state.teams.find((item) => item.teamId === teamId);
        if (!team) return ["Unknown team."];
        const problems = [];
        for (const slot of STARTER_SLOT_ORDER) {
            const capacity = state.settings.rosterSlots[slot] ?? 0;
            const occupants = team.roster.filter((item) => item.slot === slot);
            for (const occupant of occupants) {
                if (!SLOT_ELIGIBILITY[slot].includes(occupant.position)) {
                    problems.push(`${occupant.name} (${occupant.position}) is not eligible at ${slot}`);
                }
            }
            if (occupants.length > capacity) problems.push(`${slot} is over capacity (${occupants.length}/${capacity})`);
            else if (occupants.length < capacity) {
                const missing = capacity - occupants.length;
                problems.push(missing > 1 ? `${slot} has ${missing} empty slots` : `${slot} slot is empty`);
            }
        }
        return problems;
    }

    /**
     * Prices one week for every team and files the result. `extendedScoring`
     * covers the kicking / team-defense / IDP surface; defaulting to the
     * reference table is what keeps a drafted K or DEF from scoring a
     * permanent 0.00.
     */
    const playoffCount = state => [8,4,2].find(count => state.settings.playoffTeams >= count && state.teams.length >= count) || 0;
    const seasonEndWeek = state => state.settings.regularSeasonWeeks + (playoffCount(state) ? Math.log2(playoffCount(state)) : 0);
    function playoffPairs(state, week) {
        const count = playoffCount(state);
        const regular = state.settings.regularSeasonWeeks;
        if (!count || week <= regular || week > seasonEndWeek(state)) return [];
        const seeds = computeStandings(state).slice(0, count).map(row => row.teamId);
        if (week === regular + 1) return seeds.slice(0, count / 2).map((seed, index) => [seed, seeds[count - 1 - index]]);
        const previous = state.finalizedWeeks.find(row => row.week === week - 1);
        const winners = (previous?.matchups || []).map(match => match.winner || match.home).sort((a,b) => seeds.indexOf(a)-seeds.indexOf(b));
        return winners.length >= 2 ? winners.slice(0, winners.length / 2).map((seed, index) => [seed, winners[winners.length - 1 - index]]) : [];
    }
    function startPlayoffs(state, count) {
        if (state.phase !== 'complete' || playoffCount(state) || ![2,4,8].includes(count) || count > state.teams.length || state.currentWeek !== state.settings.regularSeasonWeeks + 1 || state.settings.regularSeasonWeeks + Math.log2(count) > 18) return state;
        const { championTeamId: _champion, ...rest } = state;
        return { ...rest, settings: { ...state.settings, playoffTeams: count }, phase: 'season', weekStage: 'postgame' };
    }

    function finalizeCurrentWeek(state, logIndex, eraFactors, createdAt, extendedScoring = REFERENCE_EXTENDED_SCORING) {
        if (state.phase !== "season") return state;
        const week = state.currentWeek;
        const factors = state.settings.eraAdjusted ? eraFactors : null;
        const playoff = week > state.settings.regularSeasonWeeks;
        const pairs = playoff ? playoffPairs(state, week) : (state.schedule.find(item => item.week === week)?.pairs ?? []);
        const results = state.teams.filter(team => !playoff || pairs.some(pair => pair.includes(team.teamId))).map((team) => {
            const starters = team.roster.filter((entry) => isStarterSlot(entry.slot)).map((entry) => {
                const log = logIndex.get(gameLogKey(entry.identity, entry.drawnSeason, week)) ?? null;
                const raw = log ? scoreStatLine(log.stats, state.settings.scoring, extendedScoring) : 0;
                const factor = eraFactorFor(factors, entry.drawnSeason, entry.position);
                return {
                    entryId: entry.entryId,
                    identity: entry.identity,
                    name: entry.name,
                    position: entry.position,
                    drawnSeason: entry.drawnSeason,
                    slot: entry.slot,
                    points: round2(raw * factor),
                    factor,
                    stats: log ? log.stats : null,
                };
            });
            return { teamId: team.teamId, total: round2(starters.reduce((sum, line) => sum + line.points, 0)), starters };
        });
        const totals = new Map(results.map((result) => [result.teamId, result.total]));
        const matchups = pairs.map(([home, away]) => {
            const homePoints = totals.get(home) ?? 0;
            const awayPoints = totals.get(away) ?? 0;
            return { home, away, homePoints, awayPoints, winner: homePoints > awayPoints ? home : awayPoints > homePoints ? away : playoff ? home : null };
        });
        const name = (teamId) => state.teams.find((team) => team.teamId === teamId)?.name ?? teamId;
        const line = (matchup) => {
            if (matchup.winner === null) return `${name(matchup.home)} ${fixed1(matchup.homePoints)} ties ${name(matchup.away)} ${fixed1(matchup.awayPoints)}`;
            const winnerHome = matchup.winner === matchup.home;
            const loser = winnerHome ? matchup.away : matchup.home;
            return `${name(matchup.winner)} ${fixed1(winnerHome ? matchup.homePoints : matchup.awayPoints)} def. ${name(loser)} ${fixed1(winnerHome ? matchup.awayPoints : matchup.homePoints)}`;
        };
        const headlines = [];
        let top = null;
        for (const result of results) {
            for (const starter of result.starters) {
                if (!top || starter.points > top.starter.points) top = { starter, teamId: result.teamId };
            }
        }
        if (top) headlines.push(`Top scorer — ${top.starter.name} (${name(top.teamId)}) ${fixed1(top.starter.points)}`);
        if (matchups.length) {
            const byMargin = [...matchups].sort((left, right) =>
                Math.abs(left.homePoints - left.awayPoints) - Math.abs(right.homePoints - right.awayPoints));
            headlines.push(`Closest — ${line(byMargin[0])}`);
            const blowout = byMargin[byMargin.length - 1];
            if (blowout !== byMargin[0]) headlines.push(`Blowout — ${line(blowout)}`);
        }
        const events = appendEvents(state.activity);
        for (const matchup of matchups) events.push(week, "week", `W${week} final — ${line(matchup)}`, createdAt);
        let next = {
            ...state,
            finalizedWeeks: [...state.finalizedWeeks, { week, results, matchups, headlines }],
            currentWeek: week + 1,
            activity: events.list(),
        };
        if (week + 1 > seasonEndWeek(state)) {
            const champion = playoff ? { teamId: matchups[0]?.winner } : computeStandings(next)[0];
            const finale = appendEvents(next.activity);
            if (champion) finale.push(week, "league", `Season complete — ${name(champion.teamId)} crowned champion`, createdAt);
            next = { ...next, phase: "complete", ...(champion ? { championTeamId: champion.teamId } : {}), activity: finale.list() };
        }
        return next;
    }

    function computeStandings(state) {
        const table = new Map(state.teams.map((team) => [team.teamId, {
            teamId: team.teamId, wins: 0, losses: 0, ties: 0, allPlayWins: 0, allPlayLosses: 0, pointsFor: 0, pointsAgainst: 0,
        }]));
        for (const week of state.finalizedWeeks.filter(row => row.week <= state.settings.regularSeasonWeeks)) {
            for (const result of week.results) {
                const standing = table.get(result.teamId);
                if (!standing) continue;
                standing.pointsFor = round2(standing.pointsFor + result.total);
                for (const other of week.results) {
                    if (other.teamId === result.teamId) continue;
                    if (result.total > other.total) standing.allPlayWins += 1;
                    else if (result.total < other.total) standing.allPlayLosses += 1;
                }
            }
            for (const matchup of week.matchups) {
                const home = table.get(matchup.home);
                const away = table.get(matchup.away);
                if (!home || !away) continue;
                home.pointsAgainst = round2(home.pointsAgainst + matchup.awayPoints);
                away.pointsAgainst = round2(away.pointsAgainst + matchup.homePoints);
                if (matchup.winner === matchup.home) { home.wins += 1; away.losses += 1; }
                else if (matchup.winner === matchup.away) { away.wins += 1; home.losses += 1; }
                else { home.ties += 1; away.ties += 1; }
            }
        }
        return [...table.values()].sort((left, right) => (
            right.wins - left.wins
            || left.losses - right.losses
            || right.pointsFor - left.pointsFor
            || right.allPlayWins - left.allPlayWins
            || left.teamId.localeCompare(right.teamId)
        ));
    }

    function freeAgents(state, cards) {
        const rostered = new Set(state.teams.flatMap((team) => team.roster.map((entry) => entry.identity)));
        return [...cards.values()]
            .filter((card) => !rostered.has(card.identity)
                && positionIsStartable(state.settings, card.position)
                && eraEligibleCard(card, state.settings.eraRules))
            .sort((left, right) => right.peak - left.peak || left.identity.localeCompare(right.identity));
    }

    function submitWaiverClaim(state, claim, createdAt) {
        if (state.phase !== "season" || !state.settings.waiversEnabled || !claim.addIdentity) return state;
        const team = state.teams.find((item) => item.teamId === claim.teamId);
        if (!team) return state;
        if (state.pendingClaims.some((item) => item.teamId === claim.teamId && item.addIdentity === claim.addIdentity)) return state;
        const dropTarget = claim.dropEntryId ? team.roster.find((entry) => entry.entryId === claim.dropEntryId) : undefined;
        if (claim.dropEntryId && !dropTarget) return state;
        if (claim.addPosition === "QB") {
            const quarterbacks = team.roster.filter((entry) => entry.position === "QB" && entry.entryId !== claim.dropEntryId).length;
            if (quarterbacks >= state.settings.maxQuarterbacks) return state;
        }
        const faab = state.settings.waiverMode === "faab";
        let bidAmount = 0;
        if (faab) {
            bidAmount = Math.floor(claim.bidAmount ?? 0);
            if (!Number.isFinite(bidAmount) || bidAmount < 0) return state;
            // Every live claim from this desk reserves its bid against the same
            // budget, so a second claim can't spend money the first already holds.
            const reserved = state.pendingClaims.filter((item) => item.teamId === claim.teamId).reduce((sum, item) => sum + (item.bidAmount ?? 0), 0);
            if (bidAmount + reserved > (team.faabRemaining ?? 0)) return state;
        }
        const record = {
            claimId: nextId("w", state.pendingClaims.map((item) => item.claimId)),
            teamId: claim.teamId,
            addIdentity: claim.addIdentity,
            addName: claim.addName,
            addPosition: claim.addPosition,
            dropEntryId: claim.dropEntryId,
            week: state.currentWeek,
            ...(faab ? { bidAmount } : {}),
        };
        const events = appendEvents(state.activity);
        events.push(state.currentWeek, "waiver", faab
            ? `Waivers — ${team.name} bids $${bidAmount} for ${claim.addName}`
            : `Waivers — ${team.name} files a claim for ${claim.addName}`, createdAt);
        return { ...state, pendingClaims: [...state.pendingClaims, record], activity: events.list() };
    }

    function cancelWaiverClaim(state, claimId) {
        if (!state.pendingClaims.some((item) => item.claimId === claimId)) return state;
        return { ...state, pendingClaims: state.pendingClaims.filter((item) => item.claimId !== claimId) };
    }

    function waiverLandingSlot(state, team, position, dropEntryId) {
        const dropped = team.roster.find(entry => entry.entryId === dropEntryId);
        const remaining = team.roster.filter(entry => entry.entryId !== dropEntryId);
        const open = slot => (slot === 'BN' || isStarterSlot(slot)) &&
            (SLOT_ELIGIBILITY[slot] || []).includes(position) &&
            remaining.filter(entry => entry.slot === slot).length < (state.settings.rosterSlots[slot] || 0);
        if (dropped && open(dropped.slot)) return dropped.slot;
        if (open('BN')) return 'BN';
        return ROSTER_SLOT_IDS.find(open) || null;
    }

    function processWaivers(state, cards, createdAt) {
        if (!state.pendingClaims.length) return state;
        const faab = state.settings.waiverMode === "faab";
        const priority = computeStandings(state).map((standing) => standing.teamId).reverse();
        const rank = new Map(priority.map((teamId, index) => [teamId, index]));
        // FAAB sorts by bid first — highest offer wins a contested player — then
        // falls back to the same worst-record priority as a tiebreak; priority
        // mode ignores bid entirely, exactly as it always has.
        const ordered = [...state.pendingClaims].sort((left, right) => (
            (faab ? (right.bidAmount ?? 0) - (left.bidAmount ?? 0) : 0)
            || (rank.get(left.teamId) ?? priority.length) - (rank.get(right.teamId) ?? priority.length)
            || idNumber(left.claimId, "w") - idNumber(right.claimId, "w")
        ));
        const taken = new Set(state.teams.flatMap((team) => team.roster.map((entry) => entry.identity)));
        const week = state.currentWeek;

        const events = appendEvents(state.activity);
        let teams = state.teams;
        const awards = [];
        let entryNumber = nextEntryNumber(state);
        for (const claim of ordered) {
            const team = teams.find((item) => item.teamId === claim.teamId);
            const card = cards.get(claim.addIdentity);
            // No era-allowed season left for this position means no add: the claim
            // dies here rather than smuggling an out-of-era player onto a roster.
            const drawnSeason = card ? drawSeasonFrom(eraSeasons(state, card), `${state.seed}:waiver:${card.identity}:${claim.week}`) : null;
            if (!team || !card || drawnSeason === null) {
                events.push(week, "waiver", `Waivers W${week} — claim on ${claim.addName} voided`, createdAt);
                continue;
            }
            if (taken.has(claim.addIdentity)) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} misses ${card.name}${faab ? " (outbid)" : ""}`, createdAt);
                continue;
            }
            const dropEntry = claim.dropEntryId ? team.roster.find((entry) => entry.entryId === claim.dropEntryId) ?? null : null;
            if (claim.dropEntryId && !dropEntry) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided`, createdAt);
                continue;
            }
            const afterDrop = dropEntry ? team.roster.filter((entry) => entry.entryId !== dropEntry.entryId) : team.roster;
            const landingSlot = waiverLandingSlot(state, team, card.position, claim.dropEntryId);
            if (!landingSlot) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided`, createdAt);
                continue;
            }
            if (card.position === "QB" && afterDrop.filter((entry) => entry.position === "QB").length >= state.settings.maxQuarterbacks) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided (quarterback limit)`, createdAt);
                continue;
            }
            const bidAmount = faab ? (claim.bidAmount ?? 0) : null;
            if (faab && bidAmount > (team.faabRemaining ?? 0)) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided (insufficient budget)`, createdAt);
                continue;
            }
            const entry = {
                entryId: `e${entryNumber}`,
                identity: card.identity,
                name: card.name,
                position: card.position,
                drawnSeason,
                slot: landingSlot,
                acquiredVia: "waiver",
                acquiredWeek: week,
            };
            entryNumber += 1;
            teams = teams.map((item) => (item.teamId === team.teamId ? {
                ...item,
                roster: [...afterDrop, entry],
                ...(faab ? { faabRemaining: (item.faabRemaining ?? 0) - bidAmount } : {}),
            } : item));
            awards.push({ week, identity: card.identity, name: card.name, winnerTeamId: team.teamId, contenderTeamIds: [...new Set(ordered.filter(item => item.addIdentity === card.identity).map(item => item.teamId))] });
            taken.add(card.identity);
            if (dropEntry) taken.delete(dropEntry.identity);
            events.push(week, "waiver", `Waivers W${week} — ${team.name} lands ${card.name}${faab ? ` ($${bidAmount})` : ""}${dropEntry ? `, drops ${dropEntry.name}` : ""}`, createdAt);
        }
        return { ...state, teams, pendingClaims: [], waiverResults: [...(state.waiverResults || []), ...awards], activity: events.list() };
    }

    function proposeTrade(state, offer, createdAt) {
        if (state.phase !== "season" || !state.settings.tradesEnabled) return state;
        const from = state.teams.find((item) => item.teamId === offer.fromTeamId);
        const to = state.teams.find((item) => item.teamId === offer.toTeamId);
        if (!from || !to || from.teamId === to.teamId) return state;
        const give = [...new Set(offer.giveEntryIds)];
        const receive = [...new Set(offer.receiveEntryIds)];
        if (!give.length || give.length !== offer.giveEntryIds.length || receive.length !== offer.receiveEntryIds.length || give.length !== receive.length) return state;
        const owns = (team, ids) => ids.every((id) => team.roster.some((entry) => entry.entryId === id));
        if (!owns(from, give) || !owns(to, receive)) return state;
        const trade = {
            tradeId: nextId("tr", state.trades.map((item) => item.tradeId)),
            fromTeamId: from.teamId,
            toTeamId: to.teamId,
            giveEntryIds: give,
            receiveEntryIds: receive,
            week: state.currentWeek,
            status: "pending",
            note: offer.note,
            createdAt,
        };
        const events = appendEvents(state.activity);
        events.push(state.currentWeek, "trade", `Trade — ${from.name} offers ${to.name} ${give.length}-for-${receive.length}`, createdAt);
        return { ...state, trades: [...state.trades, trade], activity: events.list() };
    }

    function deferTrade(state, tradeId) {
        const trade = state.trades.find(item => item.tradeId === tradeId);
        if (!trade || trade.status !== 'pending' || trade.deferredUntilWeek > state.currentWeek) return state;
        return { ...state, trades: state.trades.map(item => item.tradeId === tradeId ? { ...item, deferredUntilWeek: state.currentWeek + 1, delayedWeeks: [...new Set([...(item.delayedWeeks || []), state.currentWeek])] } : item) };
    }

    function respondToTrade(state, tradeId, accept, note, createdAt) {
        const trade = state.trades.find((item) => item.tradeId === tradeId);
        if (!trade || trade.status !== "pending" || trade.deferredUntilWeek > state.currentWeek) return state;
        const from = state.teams.find((item) => item.teamId === trade.fromTeamId);
        const to = state.teams.find((item) => item.teamId === trade.toTeamId);
        if (!from || !to) return state;
        const nextNote = note || trade.note;
        const events = appendEvents(state.activity);
        if (!accept) {
            events.push(state.currentWeek, "trade", `Trade — ${to.name} rejects ${from.name} offer`, createdAt);
            return {
                ...state,
                trades: state.trades.map((item) => (item.tradeId === tradeId ? { ...item, status: "rejected", respondedWeek: state.currentWeek, note: nextNote } : item)),
                activity: events.list(),
            };
        }
        const giveEntries = trade.giveEntryIds.map((id) => from.roster.find((entry) => entry.entryId === id)).filter(Boolean);
        const receiveEntries = trade.receiveEntryIds.map((id) => to.roster.find((entry) => entry.entryId === id)).filter(Boolean);
        if (giveEntries.length !== trade.giveEntryIds.length || receiveEntries.length !== trade.receiveEntryIds.length) return state;
        const qbAfter = (roster, out, incoming) =>
            roster.filter((entry) => entry.position === "QB" && !out.some((item) => item.entryId === entry.entryId)).length
            + incoming.filter((entry) => entry.position === "QB").length;
        if (qbAfter(from.roster, giveEntries, receiveEntries) > state.settings.maxQuarterbacks
            || qbAfter(to.roster, receiveEntries, giveEntries) > state.settings.maxQuarterbacks) {
            events.push(state.currentWeek, "trade", `Trade — ${from.name}/${to.name} deal voided (quarterback limit)`, createdAt);
            return {
                ...state,
                trades: state.trades.map((item) => (item.tradeId === tradeId ? { ...item, status: "rejected", respondedWeek: state.currentWeek, note: "Voided — quarterback limit." } : item)),
                activity: events.list(),
            };
        }
        const moved = (entry) => ({ ...entry, slot: "BN", acquiredVia: "trade", acquiredWeek: state.currentWeek });
        const fromRoster = [...from.roster.filter((entry) => !trade.giveEntryIds.includes(entry.entryId)), ...receiveEntries.map(moved)];
        const toRoster = [...to.roster.filter((entry) => !trade.receiveEntryIds.includes(entry.entryId)), ...giveEntries.map(moved)];
        events.push(
            state.currentWeek,
            "trade",
            `Trade — ${from.name} sends ${giveEntries.map((entry) => entry.name).join(", ")} for ${receiveEntries.map((entry) => entry.name).join(", ")}`,
            createdAt,
        );
        return {
            ...state,
            teams: state.teams.map((item) => (
                item.teamId === from.teamId ? { ...item, roster: fromRoster }
                    : item.teamId === to.teamId ? { ...item, roster: toRoster }
                        : item
            )),
            trades: state.trades.map((item) => (item.tradeId === tradeId ? { ...item, status: "accepted", respondedWeek: state.currentWeek, note: nextNote } : item)),
            activity: events.list(),
        };
    }

    // ----- storage normalization ------------------------------------------------

    const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const readString = (value) => (typeof value === "string" ? value : null);
    const readNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const readSlot = (value) => (ROSTER_SLOT_IDS.includes(String(value)) ? String(value) : "BN");

    function readArray(value, item) {
        if (!Array.isArray(value)) return null;
        const result = [];
        for (const raw of value) {
            const parsed = item(raw);
            if (parsed === null) return null;
            result.push(parsed);
        }
        return result;
    }

    const SCORING_KEYS = ["passTd", "reception", "rushRecYd", "passingYd", "turnover"];
    const STAT_KEYS = ["passYd", "passTd", "passInt", "rushYd", "rushTd", "rec", "recYd", "recTd", "fumblesLost", "twoPointConversions"];
    const AI_DIFFICULTIES = ["rookie", "veteran", "allpro"];

    const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.floor(value)));

    const readSettings = (value) => {
        if (!isRecord(value) || !isRecord(value.rosterSlots) || !isRecord(value.scoring)) return null;
        const rosterSlots = {};
        for (const [key, count] of Object.entries(value.rosterSlots)) {
            const parsed = readNumber(count);
            if (!ROSTER_SLOT_IDS.includes(key) || parsed === null) return null;
            // Hostile or fractional counts would desync rosterCapacity from slot checks.
            rosterSlots[key] = clampInt(parsed, 0, 12);
        }
        const scoring = { passTd: 0, reception: 0, rushRecYd: 0, passingYd: 0, turnover: 0 };
        for (const key of SCORING_KEYS) {
            const parsed = readNumber(value.scoring[key]);
            if (parsed === null) return null;
            scoring[key] = parsed;
        }
        for (const [group, keys] of [['stats', STAT_KEYS], ['extended', App.TimeLeagueSeason.EXTENDED_STAT_IDS]]) {
            if (value.scoring[group] === undefined) continue;
            if (!isRecord(value.scoring[group])) return null;
            scoring[group] = {};
            for (const [key, weight] of Object.entries(value.scoring[group])) {
                if (!keys.includes(key) || readNumber(weight) === null) return null;
                scoring[group][key] = weight;
            }
        }
        if (value.scoring.bonuses !== undefined) {
            if (!Array.isArray(value.scoring.bonuses) || value.scoring.bonuses.length > 20 || value.scoring.bonuses.some(b => !isRecord(b) || !['passYd', 'rushYd', 'recYd', 'rec'].includes(b.stat) || readNumber(b.threshold) === null || b.threshold <= 0 || readNumber(b.points) === null)) return null;
            scoring.bonuses = value.scoring.bonuses.map(b => ({ stat: b.stat, threshold: b.threshold, points: b.points }));
        }
        const regularSeasonWeeks = readNumber(value.regularSeasonWeeks);
        const maxQuarterbacks = readNumber(value.maxQuarterbacks);
        if (regularSeasonWeeks === null || maxQuarterbacks === null) return null;
        return {
            rosterSlots,
            scoring,
            ...draftSettings(value, false),
            regularSeasonWeeks: clampInt(regularSeasonWeeks, 1, 18),
            playoffTeams: [2,4,8].includes(value.playoffTeams) && regularSeasonWeeks + Math.log2(value.playoffTeams) <= 18 ? value.playoffTeams : 0,
            advancementMode: ['majority', 'timed'].includes(value.advancementMode) ? value.advancementMode : 'commissioner',
            gateHours: Math.min(168, Math.max(0.0167, readNumber(value.gateHours) ?? 24)),
            maxQuarterbacks: clampInt(maxQuarterbacks, 0, 12),
            // Saves written before era drafting existed carry no rules at all; they
            // load as any-era instead of locking the league out of every player.
            eraRules: normalizeEraDraftRules(value.eraRules),
            eraAdjusted: value.eraAdjusted === true,
            waiversEnabled: value.waiversEnabled === true,
            tradesEnabled: value.tradesEnabled === true,
            // Saves written before FAAB existed carry no waiverMode at all; they
            // load as priority waivers rather than silently granting a budget.
            waiverMode: value.waiverMode === "faab" ? "faab" : "priority",
            faabBudget: clampInt(readNumber(value.faabBudget) ?? 100, 0, 1000),
            // "veteran" is today's only behavior, so saves written before difficulty
            // existed load unchanged rather than silently getting harder or easier.
            aiDifficulty: AI_DIFFICULTIES.includes(value.aiDifficulty) ? value.aiDifficulty : "veteran",
        };
    };

    const readEntry = (value) => {
        if (!isRecord(value)) return null;
        const entryId = readString(value.entryId);
        const identity = readString(value.identity);
        const name = readString(value.name);
        const position = normalizePlayerPosition(value.position);
        const drawnSeason = readNumber(value.drawnSeason);
        const acquiredWeek = readNumber(value.acquiredWeek);
        if (!entryId || !identity || !name || !position || drawnSeason === null || acquiredWeek === null) return null;
        const acquiredVia = value.acquiredVia === "waiver" || value.acquiredVia === "trade" ? value.acquiredVia : "draft";
        return { entryId, identity, name, position, drawnSeason, slot: readSlot(value.slot), acquiredVia, acquiredWeek };
    };

    const readTeam = (value) => {
        if (!isRecord(value)) return null;
        const teamId = readString(value.teamId);
        const name = value.manager === 'ai' ? managerIdentity(value, teamId ? Math.max(0, idNumber(teamId, 't') - 1) : 0).name : readString(value.name);
        const manager = value.manager === "human" || value.manager === "ai" ? value.manager : null;
        const roster = readArray(value.roster, readEntry);
        const queue = readArray(value.queue, readString);
        if (!teamId || !name || !manager || !roster || !queue) return null;
        const aiPersona = AI_PERSONA_IDS.includes(value.aiPersona) ? value.aiPersona : manager === 'ai' ? defaultAiSeat(Math.max(0, idNumber(teamId, 't') - 1)).aiPersona : null;
        const design = teamDesign(value, teamId);
        const hasFaab = "faabRemaining" in value;
        const faabRemaining = hasFaab ? readNumber(value.faabRemaining) : undefined;
        if (hasFaab && faabRemaining === null) return null;
        return { teamId, name, manager, ...(aiPersona ? { aiPersona } : {}), ...design, roster, queue, ...(Number.isInteger(value.draftBudgetRemaining) && value.draftBudgetRemaining >= 0 ? { draftBudgetRemaining: value.draftBudgetRemaining } : {}), ...(faabRemaining !== undefined ? { faabRemaining } : {}) };
    };

    const readSeat = (value) => {
        if (!isRecord(value)) return null;
        const overall = readNumber(value.overall);
        const round = readNumber(value.round);
        const teamId = readString(value.teamId);
        return overall !== null && round !== null && teamId ? { overall, round, teamId } : null;
    };

    const readPick = (value) => {
        if (!isRecord(value)) return null;
        const seat = readSeat(value);
        const entryId = readString(value.entryId);
        const identity = readString(value.identity);
        const name = readString(value.name);
        const position = normalizePlayerPosition(value.position);
        const madeBy = value.madeBy === "human" || value.madeBy === "ai" ? value.madeBy : null;
        if (!seat || !entryId || !identity || !name || !position || !madeBy) return null;
        return { ...seat, entryId, identity, name, position, madeBy, ...(Number.isInteger(value.auctionPrice) && value.auctionPrice > 0 ? { auctionPrice: value.auctionPrice } : {}) };
    };

    const readPair = (value) => {
        if (!Array.isArray(value) || value.length !== 2) return null;
        const home = readString(value[0]);
        const away = readString(value[1]);
        return home && away ? [home, away] : null;
    };

    const readScheduleWeek = (value) => {
        if (!isRecord(value)) return null;
        const week = readNumber(value.week);
        const pairs = readArray(value.pairs, readPair);
        return week !== null && pairs ? { week, pairs } : null;
    };

    /** Comfortably above the whole ScoringStatId surface, so only hostile saves hit it. */
    const EXTRA_KEY_LIMIT = 128;

    /**
     * The stored full-surface bag. Ids this build does not recognise are kept
     * rather than dropped — they price to nothing against any weights map, and
     * a save written by a newer build should not lose detail on a round trip.
     */
    const readExtra = (value) => {
        if (!isRecord(value)) return null;
        const extra = {};
        let kept = 0;
        for (const key of Object.keys(value)) {
            if (kept >= EXTRA_KEY_LIMIT) break;
            const parsed = readNumber(value[key]);
            if (parsed === null || parsed === 0) continue;
            extra[key] = parsed;
            kept += 1;
        }
        return kept > 0 ? extra : null;
    };

    const readStats = (value) => {
        if (!isRecord(value)) return null;
        const stats = { passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, fumblesLost: 0, twoPointConversions: 0 };
        for (const key of STAT_KEYS) {
            const parsed = readNumber(value[key]);
            if (parsed === null) return null;
            stats[key] = parsed;
        }
        const extra = readExtra(value.extra);
        if (extra) stats.extra = extra;
        return stats;
    };

    const readSnapshot = (value) => {
        if (!isRecord(value)) return null;
        const entryId = readString(value.entryId);
        const identity = readString(value.identity);
        const name = readString(value.name);
        const position = normalizePlayerPosition(value.position);
        const drawnSeason = readNumber(value.drawnSeason);
        const points = readNumber(value.points);
        const factor = readNumber(value.factor);
        const stats = value.stats == null ? null : readStats(value.stats);
        if (!entryId || !identity || !name || !position || drawnSeason === null || points === null || factor === null) return null;
        if (value.stats != null && stats === null) return null;
        return { entryId, identity, name, position, drawnSeason, slot: readSlot(value.slot), points, factor, stats };
    };

    const readTeamResult = (value) => {
        if (!isRecord(value)) return null;
        const teamId = readString(value.teamId);
        const total = readNumber(value.total);
        const starters = readArray(value.starters, readSnapshot);
        return teamId && total !== null && starters ? { teamId, total, starters } : null;
    };

    const readMatchup = (value) => {
        if (!isRecord(value)) return null;
        const home = readString(value.home);
        const away = readString(value.away);
        const homePoints = readNumber(value.homePoints);
        const awayPoints = readNumber(value.awayPoints);
        const winner = value.winner == null ? null : readString(value.winner);
        if (!home || !away || homePoints === null || awayPoints === null || (value.winner != null && winner === null)) return null;
        return { home, away, homePoints, awayPoints, winner };
    };

    const readFinalizedWeek = (value) => {
        if (!isRecord(value)) return null;
        const week = readNumber(value.week);
        const results = readArray(value.results, readTeamResult);
        const matchups = readArray(value.matchups, readMatchup);
        const headlines = readArray(value.headlines, readString);
        return week !== null && results && matchups && headlines ? { week, results, matchups, headlines } : null;
    };

    const readClaim = (value) => {
        if (!isRecord(value)) return null;
        const claimId = readString(value.claimId);
        const teamId = readString(value.teamId);
        const addIdentity = readString(value.addIdentity);
        const addName = readString(value.addName);
        const addPosition = normalizePlayerPosition(value.addPosition);
        const week = readNumber(value.week);
        if (!claimId || !teamId || !addIdentity || !addName || !addPosition || week === null) return null;
        const hasBid = "bidAmount" in value;
        const bidAmount = hasBid ? readNumber(value.bidAmount) : undefined;
        if (hasBid && bidAmount === null) return null;
        return { claimId, teamId, addIdentity, addName, addPosition, dropEntryId: readString(value.dropEntryId) ?? "", week, ...(bidAmount !== undefined ? { bidAmount } : {}) };
    };

    const readTrade = (value) => {
        if (!isRecord(value)) return null;
        const tradeId = readString(value.tradeId);
        const fromTeamId = readString(value.fromTeamId);
        const toTeamId = readString(value.toTeamId);
        const giveEntryIds = readArray(value.giveEntryIds, readString);
        const receiveEntryIds = readArray(value.receiveEntryIds, readString);
        const week = readNumber(value.week);
        const status = value.status === "pending" || value.status === "accepted" || value.status === "rejected" || value.status === "withdrawn" ? value.status : null;
        const createdAt = readString(value.createdAt);
        if (!tradeId || !fromTeamId || !toTeamId || !giveEntryIds || !receiveEntryIds || week === null || !status || !createdAt) return null;
        return { tradeId, fromTeamId, toTeamId, giveEntryIds, receiveEntryIds, week, status,
            ...(Number.isInteger(value.respondedWeek) && value.respondedWeek >= week && value.respondedWeek <= 19 ? { respondedWeek: value.respondedWeek } : {}),
            ...(Array.isArray(value.delayedWeeks) ? { delayedWeeks: [...new Set(value.delayedWeeks.filter(item => Number.isInteger(item) && item >= week && item <= 19))] } : {}),
            deferredUntilWeek: clampInt(readNumber(value.deferredUntilWeek) ?? 0, 0, 19), note: readString(value.note) ?? "", createdAt };
    };

    const readActivityEvent = (value) => {
        if (!isRecord(value)) return null;
        const id = readString(value.id);
        const week = readNumber(value.week);
        const kind = value.kind === "draft" || value.kind === "waiver" || value.kind === "trade" || value.kind === "week" || value.kind === "league" ? value.kind : null;
        const message = readString(value.message);
        const createdAt = readString(value.createdAt);
        if (!id || week === null || !kind || !message || !createdAt) return null;
        return { id, week, kind, message, createdAt };
    };

    function normalizeTimeLeague(raw) {
        if (!isRecord(raw) || raw.version !== 1) return null;
        const leagueId = readString(raw.leagueId);
        const name = readString(raw.name);
        const seed = readString(raw.seed);
        const createdAt = readString(raw.createdAt);
        const phase = raw.phase === "draft" || raw.phase === "season" || raw.phase === "complete" ? raw.phase : null;
        const settings = readSettings(raw.settings);
        const teams = readArray(raw.teams, readTeam);
        const draftOrder = readArray(raw.draftOrder, readSeat);
        const draftPicks = readArray(raw.draftPicks, readPick);
        const schedule = readArray(raw.schedule, readScheduleWeek);
        const finalizedWeeks = readArray(raw.finalizedWeeks, readFinalizedWeek);
        const pendingClaims = readArray(raw.pendingClaims, readClaim);
        const trades = readArray(raw.trades, readTrade);
        const activity = readArray(raw.activity, readActivityEvent);
        const currentWeek = readNumber(raw.currentWeek);
        if (!leagueId || !name || !seed || !createdAt || !phase || !settings || !teams || !teams.length
            || !draftOrder || !draftPicks || !schedule || !finalizedWeeks || !pendingClaims || !trades || !activity || currentWeek === null) return null;
        const championTeamId = readString(raw.championTeamId);
        return {
            version: 1,
            leagueId,
            name,
            seed,
            createdAt,
            phase,
            settings,
            teams,
            draftOrder,
            draftPicks,
            draftClock: normalizeDraftClock(raw.draftClock, settings),
            draftAuction: normalizeAuction(raw.draftAuction, teams, draftPicks),
            seasonsRevealed: raw.seasonsRevealed === true,
            currentWeek: clampInt(currentWeek, 1, seasonEndWeek({ settings, teams }) + 1),
            weekStage: ['postgame', 'claims', 'lineup', 'ready'].includes(raw.weekStage) ? raw.weekStage : 'ready',
            gateStartedAt: typeof raw.gateStartedAt === 'string' && Number.isFinite(Date.parse(raw.gateStartedAt)) ? raw.gateStartedAt : createdAt,
            gateVotes: Array.isArray(raw.gateVotes) ? [...new Set(raw.gateVotes.filter(id => teams.some(t => t.teamId === id && t.manager === 'human')))] : [],
            schedule,
            finalizedWeeks,
            pendingClaims,
            waiverResults: Array.isArray(raw.waiverResults) ? raw.waiverResults.filter(item => item && Number.isInteger(item.week) && item.week > 0 && item.week <= 19 && typeof item.identity === 'string' && typeof item.name === 'string' && teams.some(team => team.teamId === item.winnerTeamId) && Array.isArray(item.contenderTeamIds)).map(item => ({ week: item.week, identity: item.identity, name: item.name, winnerTeamId: item.winnerTeamId, contenderTeamIds: [...new Set(item.contenderTeamIds.filter(id => teams.some(team => team.teamId === id)))] })) : [],
            trades,
            activity,
            rivalMessages: App.TimeLeagueRivals?.normalizeMessages(raw.rivalMessages, teams) || [],
            rivalRelationships: App.TimeLeagueRivals?.normalizeRelationships(raw.rivalRelationships, teams) || [],
            ...(championTeamId ? { championTeamId } : {}),
        };
    }

    const api = {
        AI_PERSONAS, AI_PERSONA_IDS, rosterCapacity, defaultAiSeat, createTimeLeague, currentDraftSeat, draftedIdentities, eraEligibleCards,
        DRAFT_PICK_SECONDS, DRAFT_AI_SECONDS, draftSettings, startDraft, pauseDraft, resumeDraft, configureDraft, expireDraftClock,
        auctionMaxBid, auctionCanBid, auctionCanClose, nominateAuctionPlayer, bidAuctionPlayer, closeAuction,
        positionIsStartable, applyDraftPick, setEntrySlot, autoFillLineup, lineupProblems,
        finalizeCurrentWeek, computeStandings, freeAgents, submitWaiverClaim, cancelWaiverClaim,
        playoffCount, seasonEndWeek, playoffPairs, startPlayoffs, processWaivers, waiverLandingSlot, proposeTrade, respondToTrade, deferTrade, normalizeTimeLeague,
    };
    App.TimeLeagueEngine = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
