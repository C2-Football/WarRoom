// ══════════════════════════════════════════════════════════════════
// js/components/time-league-draft-panel.js — window.WrTimeLeagueDraftPanel
// The draft room: big board, scout file, queue, and the post-draft reveal.
// Ported from The Duat's app/TimeLeagueDraftCenter.tsx.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo, useState, useEffect, useRef } = React;
    const h = React.createElement;

    const DraftRoom = window.App.TimeLeagueDraftRoom;
    const EraRules = window.App.TimeLeagueEraRules;
    const AI = window.App.TimeLeagueAI;
    const Engine = window.App.TimeLeagueEngine;
    const Roster = window.App.TimeLeagueRoster;

    const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const DECADE_BY_ID = new Map(EraRules.ERA_DECADES.map((d) => [d.id, d]));
    const positionRank = (position) => { const i = POSITION_ORDER.indexOf(position); return i === -1 ? POSITION_ORDER.length : i; };

    const QB_COLUMNS = [{ key: 'passYd', label: 'Pa Yd' }, { key: 'passTd', label: 'Pa TD' }, { key: 'passInt', label: 'Int' }, { key: 'rushYd', label: 'Ru Yd' }, { key: 'rushTd', label: 'Ru TD' }];
    const RB_COLUMNS = [{ key: 'rushYd', label: 'Ru Yd' }, { key: 'rushTd', label: 'Ru TD' }, { key: 'rec', label: 'Rec' }, { key: 'recYd', label: 'Re Yd' }, { key: 'recTd', label: 'Re TD' }];
    const RECEIVER_COLUMNS = [{ key: 'rec', label: 'Rec' }, { key: 'recYd', label: 'Re Yd' }, { key: 'recTd', label: 'Re TD' }, { key: 'rushYd', label: 'Ru Yd' }, { key: 'rushTd', label: 'Ru TD' }];
    const statColumnsFor = (position) => (position === 'QB' ? QB_COLUMNS : position === 'RB' ? RB_COLUMNS : position === 'K' || position === 'DEF' ? [] : RECEIVER_COLUMNS);

    const spanOf = (seasons) => {
        const first = seasons[0]; const last = seasons[seasons.length - 1];
        if (!first || !last) return '—';
        return first.season === last.season ? String(first.season) : `${first.season}-${last.season}`;
    };
    const seasonSpan = (card) => spanOf(card.seasons);
    const availableYears = (seasons) => [...new Set(seasons.map((season) => season.season))].sort((a, b) => a - b).join(', ') || 'None';
    const peakOf = (seasons) => seasons.reduce((max, s) => Math.max(max, s.points), 0);
    const careerGames = (card) => card.seasons.reduce((sum, s) => sum + s.games, 0);
    const pickLabel = (order, overall, round) => {
        const inRound = order.filter((seat) => seat.round === round).findIndex((seat) => seat.overall === overall) + 1;
        return `R${round}.${String(inRound).padStart(2, '0')}`;
    };
    const gradeFor = (total, median) => {
        if (median <= 0) return 'C';
        const ratio = total / median;
        return ratio >= 1.15 ? 'A' : ratio >= 1.05 ? 'B' : ratio >= 0.95 ? 'C' : ratio >= 0.85 ? 'D' : 'F';
    };
    const GRADE_PILL = { A: 'good', B: 'good', C: 'info', D: 'warn', F: 'bad' };

    // ── Position Roulette reveal ────────────────────────────────────────
    // The decades are actually rolled once, at league founding, by
    // createTimeLeague -> openDraftEra (time-league-engine.js / time-league-era-rules.js);
    // by the time this panel first mounts, league.settings.eraRules.positionDecades
    // already holds the frozen result. This section only decides how that
    // already-computed result gets *revealed* to the human — one position at
    // a time, on demand, rather than an auto-staggered deal-them-all cascade
    // the moment the draft room mounts. Turning a position over also opens
    // that position's three leading draftable players for the decade it landed on —
    // a bare decade label doesn't tell you whether you got a stacked pool or
    // an empty one.
    //
    // Revealed state lives in localStorage rather than on the league object:
    // normalizeTimeLeague (time-league-engine.js) is a strict field whitelist
    // run on every load-from-storage, so an extra field bolted onto the
    // league via onUpdate would be silently dropped on the next reload and
    // every position would show pending again. localStorage sidesteps that
    // without touching the league schema.
    const ERA_REVEAL_STORAGE_PREFIX = 'wr-tl-era-reveal:';
    const ERA_REVEAL_ROLL_MS = 650; // how long a single position's die spins before it lands
    // Stored as the list of position codes the human has actually turned
    // over — a single boolean can't distinguish "QB revealed, RB still
    // pending" from "nothing revealed yet". The legacy '1' value (from the
    // old all-at-once ceremony, before per-position reveal existed) means
    // "this league's ceremony already played in full" — resolved against
    // whatever positions the league currently has assigned, so upgrading
    // this file doesn't re-hide decades a commissioner already saw.
    function loadRevealedPositions(leagueId, allPositions) {
        try {
            const raw = window.localStorage.getItem(ERA_REVEAL_STORAGE_PREFIX + leagueId);
            if (raw === '1') return new Set(allPositions);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (err) { return new Set(); }
    }
    function saveRevealedPositions(leagueId, positions) {
        try { window.localStorage.setItem(ERA_REVEAL_STORAGE_PREFIX + leagueId, JSON.stringify([...positions])); } catch (err) { /* private mode / quota — worst case a reveal replays once more */ }
    }
    /** Mirrors War Room's real opponent-intel needs analysis (js/draft/opponent-intel.js,
     * via assessTeamLocal in js/trade-calc.js) — roster composition vs. starter-slot demand,
     * except grounded in this league's own settings rather than a hardcoded external ideal
     * roster shape, since Time League roster configs vary league to league. */
    function positionDemand(settings, position) {
        return Roster.ROSTER_SLOT_IDS.reduce((demand, slot) => {
            if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') return demand;
            const count = settings.rosterSlots[slot] ?? 0;
            return demand + (count > 0 && Roster.SLOT_ELIGIBILITY[slot].includes(position) ? count : 0);
        }, 0);
    }
    function teamNeeds(team, settings) {
        const needs = [];
        for (const position of POSITION_ORDER) {
            const demand = positionDemand(settings, position);
            if (demand <= 0) continue;
            const owned = team.roster.filter((e) => e.position === position).length;
            if (owned >= demand) continue;
            needs.push({ position, status: owned === 0 ? 'deficit' : 'thin', gap: demand - owned });
        }
        return needs.sort((a, b) => (a.status !== b.status ? (a.status === 'deficit' ? -1 : 1) : b.gap - a.gap));
    }

    function OpponentIntel({ league, humanTeam, onClockTeamId }) {
        const others = league.teams.filter((t) => t.teamId !== humanTeam?.teamId);
        if (!others.length) return null;
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Opponent intel'), h('small', null, `${others.length} desks`)),
            others.map((team) => {
                const persona = team.aiPersona ? AI.AI_PERSONAS[team.aiPersona] : null;
                const needs = teamNeeds(team, league.settings).slice(0, 3);
                const onClock = team.teamId === onClockTeamId;
                return h('div', { key: team.teamId, style: { padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 } },
                        h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 20, title: team.name }),
                        h('strong', { style: { fontSize: 12.5 } }, team.name),
                        persona && h('span', { className: 'tl-pill info' }, persona.label.toUpperCase()),
                        onClock && h('span', { className: 'tl-pill gold' }, 'ON THE CLOCK')),
                    h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: persona ? 4 : 0 } },
                        needs.length
                            ? needs.map((n) => h('span', { key: n.position, className: `tl-pill ${n.status === 'deficit' ? 'bad' : 'warn'}` }, `${n.position}${n.status === 'deficit' ? '!' : ''}`))
                            : h('span', { className: 'tl-pill good' }, 'ROSTER SET')),
                    persona && h('p', { style: { fontSize: 11, fontStyle: 'italic', color: 'var(--text-faint, rgba(189,184,173,0.6))', margin: 0 } }, `"${persona.tell}"`));
            }));
    }

    function WrTimeLeagueDraftPanel({ league, cards, onUpdate, onlineMeta, onRevealReadyChange, draftControls, onDraftAction }) {
        const [query, setQuery] = useState('');
        const [positionFilter, setPositionFilter] = useState('ALL');
        const [selectedIdentity, setSelectedIdentity] = useState(null);
        const [showBoardGrid, setShowBoardGrid] = useState(true);
        const [pinnedRosterId, setPinnedRosterId] = useState(null);
        const [note, setNote] = useState('');
        const [boardLimit, setBoardLimit] = useState(24);
        const scoutRef = useRef(null);
        const [scoutOpen, setScoutOpen] = useState(false);
        const scoutDialogRef = useRef(null);
        const scoutTriggerRef = useRef(null);
        useEffect(() => setBoardLimit(24), [query, positionFilter]);

        const seat = useMemo(() => Engine.currentDraftSeat(league), [league]);
        const drafted = useMemo(() => Engine.draftedIdentities(league), [league]);
        const onClockTeam = seat ? league.teams.find((t) => t.teamId === seat.teamId) ?? null : null;
        const humanTeam = league.teams.find((t) => onlineMeta ? t.teamId === onlineMeta.seatTeamId : t.manager === 'human') ?? null;
        const isAuction = league.settings.draftFormat === 'auction';
        const clockReady = !league.draftClock || league.draftClock.status === 'running';
        const canSim = !onlineMeta || onlineMeta.role === 'commissioner';
        const persona = onClockTeam?.aiPersona ? AI.AI_PERSONAS[onClockTeam.aiPersona] : null;

        const eraRules = useMemo(() => EraRules.normalizeEraDraftRules(league.settings.eraRules), [league.settings.eraRules]);
        const eraRestricted = eraRules.mode !== 'any-era' && (eraRules.decades.length > 0 || Boolean(eraRules.positionDecades));

        const available = useMemo(() => Engine.eraEligibleCards(league, cards).map((card, index) => ({
            card, rank: index + 1, draw: spanOf(EraRules.filterSeasonsForEra(card.seasons, eraRules, card.position)),
        })), [cards, eraRules, league]);
        const positions = useMemo(() => {
            const present = new Set(available.map(({ card }) => card.position));
            return POSITION_ORDER.filter((p) => present.has(p));
        }, [available]);
        const eraAssignments = useMemo(() => {
            if (eraRules.mode !== 'position-roulette') return [];
            const poolSize = new Map();
            for (const { card } of available) poolSize.set(card.position, (poolSize.get(card.position) ?? 0) + 1);
            return Object.entries(eraRules.positionDecades ?? {})
                .flatMap(([position, decade]) => (decade && POSITION_ORDER.includes(position) && positionDemand(league.settings, position) > 0 ? [{ position, decade }] : []))
                .sort((l, r) => positionRank(l.position) - positionRank(r.position) || l.position.localeCompare(r.position))
                .map((row) => ({ ...row, detail: DECADE_BY_ID.get(row.decade) ?? null, pool: poolSize.get(row.position) ?? 0 }));
        }, [available, eraRules, league.settings]);

        // Rank the reveal leaders by seasons inside their assigned decade.
        // A career peak outside that decade must not move a player up this list.
        const topThreeByPosition = useMemo(() => {
            const map = {};
            for (const entry of available) {
                const pos = entry.card.position;
                const bucket = map[pos] || (map[pos] = []);
                bucket.push(entry);
            }
            for (const position of Object.keys(map)) map[position] = map[position].sort((left, right) =>
                peakOf(EraRules.filterSeasonsForEra(right.card.seasons, eraRules, position)) - peakOf(EraRules.filterSeasonsForEra(left.card.seasons, eraRules, position)) || left.card.identity.localeCompare(right.card.identity)).slice(0, 3);
            return map;
        }, [available, eraRules]);

        const allEraPositions = useMemo(() => eraAssignments.map((row) => row.position), [eraAssignments]);
        const [revealedPositions, setRevealedPositions] = useState(() => loadRevealedPositions(league.leagueId, allEraPositions));
        const [rollingPosition, setRollingPosition] = useState(null); // the one position currently mid-spin, or null
        // Positions turned over THIS mount get the flip/land animation; ones
        // already revealed in a prior session render as plain flat cards
        // (same distinction the old ceremony drew between "playing" and
        // "already played").
        const freshlyRevealedRef = useRef(new Set());
        const rollTimerRef = useRef(null);
        useEffect(() => () => { if (rollTimerRef.current) clearTimeout(rollTimerRef.current); }, []);

        function revealPosition(position) {
            if (rollingPosition || revealedPositions.has(position)) return;
            setRollingPosition(position);
            rollTimerRef.current = setTimeout(() => {
                freshlyRevealedRef.current.add(position);
                setRevealedPositions((prev) => {
                    const next = new Set(prev);
                    next.add(position);
                    saveRevealedPositions(league.leagueId, next);
                    return next;
                });
                setRollingPosition(null);
                rollTimerRef.current = null;
            }, ERA_REVEAL_ROLL_MS);
        }
        function revealAllPositions() {
            if (rollingPosition) return;
            allEraPositions.forEach((p) => freshlyRevealedRef.current.add(p));
            const next = new Set([...revealedPositions, ...allEraPositions]);
            saveRevealedPositions(league.leagueId, next);
            setRevealedPositions(next);
        }
        const anyPending = eraRules.mode === 'position-roulette' && allEraPositions.some((position) => !revealedPositions.has(position));
        const revealReady = league.seasonsRevealed || !anyPending;
        useEffect(() => { onRevealReadyChange?.(revealReady); }, [onRevealReadyChange, revealReady]);
        const canScoutCard = (card) => Boolean(card && (eraRules.mode !== 'position-roulette' || revealedPositions.has(card.position)));
        function openScout(card, event) {
            if (!canScoutCard(card)) return;
            scoutTriggerRef.current = event?.currentTarget || null;
            setSelectedIdentity(card.identity);
            setScoutOpen(true);
        }
        function closeScout() {
            setScoutOpen(false);
            scoutTriggerRef.current?.focus?.();
        }
        useEffect(() => {
            if (!scoutOpen || !window.document) return undefined;
            const dialog = scoutDialogRef.current;
            const previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            dialog?.querySelector('button')?.focus();
            const handleKey = (event) => {
                if (event.key === 'Escape') { event.preventDefault(); closeScout(); return; }
                if (event.key !== 'Tab') return;
                const controls = [...(dialog?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex="0"]') || [])];
                const first = controls[0]; const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            };
            document.addEventListener('keydown', handleKey);
            return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); };
        }, [scoutOpen, selectedIdentity]);

        const filtered = useMemo(() => {
            const term = query.trim().toLowerCase();
            if (!revealReady) return [];
            return available.filter(({ card }) => (positionFilter === 'ALL' || card.position === positionFilter) && (!term || card.name.toLowerCase().includes(term)));
        }, [available, positionFilter, query, revealReady]);
        const visible = filtered.slice(0, boardLimit);

        const requestedCard = selectedIdentity && !drafted.has(selectedIdentity) ? cards.get(selectedIdentity) : null;
        const selectedCard = (canScoutCard(requestedCard) ? requestedCard : null) ?? visible[0]?.card ?? null;
        const queueCards = useMemo(() => (humanTeam && revealReady
            ? humanTeam.queue.map((id) => cards.get(id)).filter((c) => c && !drafted.has(c.identity))
            : []), [cards, drafted, humanTeam, revealReady]);

        const gridPicks = useMemo(() => {
            if (!isAuction) return league.draftPicks;
            const acquired = new Map();
            return [...league.draftPicks].sort((left, right) => left.overall - right.overall).map((pick) => {
                const row = (acquired.get(pick.teamId) || 0) + 1;
                acquired.set(pick.teamId, row);
                return { ...pick, round: row };
            });
        }, [isAuction, league.draftPicks]);
        const gridOrder = useMemo(() => {
            if (!isAuction) return league.draftOrder;
            const rowCount = Math.max(1, ...league.draftOrder.map((slot) => slot.round), ...gridPicks.map((pick) => pick.round));
            return Array.from({ length: rowCount }, (_, index) => league.teams.map((team) => {
                const pick = gridPicks.find((entry) => entry.round === index + 1 && entry.teamId === team.teamId);
                return { round: index + 1, teamId: team.teamId, overall: pick?.overall ?? null };
            })).flat();
        }, [isAuction, league.draftOrder, league.teams, gridPicks]);
        const draftPickLabel = (pick) => isAuction ? `Award #${pick.overall}` : pickLabel(league.draftOrder, pick.overall, pick.round);
        const pickByOverall = useMemo(() => new Map(league.draftPicks.map((p) => [p.overall, p])), [league.draftPicks]);
        const boardRounds = useMemo(() => {
            const rounds = new Map();
            for (const orderSeat of gridOrder) rounds.set(orderSeat.round, [...(rounds.get(orderSeat.round) ?? []), orderSeat]);
            return [...rounds.entries()];
        }, [gridOrder]);
        const teamName = (teamId) => league.teams.find((t) => t.teamId === teamId)?.name ?? teamId;

        const reveal = useMemo(() => {
            if (!league.seasonsRevealed) return null;
            const entryById = new Map(league.teams.flatMap((t) => t.roster.map((e) => [e.entryId, e])));
            const teams = league.teams.map((team) => {
                const picks = league.draftPicks.filter((p) => p.teamId === team.teamId).sort((l, r) => l.overall - r.overall).map((pick) => {
                    const drawnSeason = entryById.get(pick.entryId)?.drawnSeason;
                    return { ...pick, drawnSeason, points: AI.entryValueFromCard(cards.get(pick.identity), drawnSeason) };
                });
                return { team, picks, total: Math.round(picks.reduce((sum, p) => sum + p.points, 0) * 10) / 10 };
            });
            const totals = teams.map((t) => t.total).sort((l, r) => l - r);
            const median = totals.length === 0 ? 0 : totals.length % 2 ? totals[(totals.length - 1) / 2] : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2;
            const best = [...teams].sort((l, r) => r.total - l.total)[0] ?? null;
            return { teams, median, best };
        }, [cards, league]);

        function draftBlockReason(card) {
            if (!revealReady) return 'Open every position archive before the draft begins';
            if (!seat || !onClockTeam) return 'Draft complete';
            if (!clockReady) return league.draftClock.status === 'paused' ? 'Draft paused' : 'Start the draft to make picks';
            if (isAuction && league.draftAuction?.nomination) return 'Bidding is open — finish the current player first';
            if (onlineMeta && seat.teamId !== onlineMeta.seatTeamId) return `Waiting for ${onClockTeam.name} to pick`;
            if (drafted.has(card.identity)) return 'Already drafted';
            if (!card.seasons.length) return 'No playable seasons on file';
            if (!EraRules.eraEligibleCard(card, eraRules)) return "No season on file clears the league's era rule";
            if (card.position === 'QB' && onClockTeam.roster.filter((e) => e.position === 'QB').length >= league.settings.maxQuarterbacks) {
                return `QB cap reached (max ${league.settings.maxQuarterbacks})`;
            }
            const open = DraftRoom.findOpenRosterSlot(card.position, onClockTeam.roster.map((e) => e.slot), league.settings.rosterSlots, league.settings.maxQuarterbacks, onClockTeam.roster.map((e) => e.position));
            return open ? null : `No open roster slot fits ${card.position}`;
        }

        const stripDraftedFromQueues = (state) => {
            const taken = Engine.draftedIdentities(state);
            if (!state.teams.some((t) => t.queue.some((id) => taken.has(id)))) return state;
            return { ...state, teams: state.teams.map((t) => (t.queue.some((id) => taken.has(id)) ? { ...t, queue: t.queue.filter((id) => !taken.has(id)) } : t)) };
        };

        async function draftCard(card, madeBy) {
            if (draftBlockReason(card)) return;
            if (isAuction) {
                if (!onDraftAction) return;
                const saved = await onDraftAction({ type: 'auction-nominate', identity: card.identity, amount: 1, teamId: seat.teamId });
                if (saved !== false) { setScoutOpen(false); setNote(`${card.name} nominated for bidding.`); }
                return;
            }
            if (onDraftAction) {
                const saved = await onDraftAction({ type: 'draft', identity: card.identity });
                if (saved !== false) { setNote(`${card.name} — locked in!`); setSelectedIdentity(null); setScoutOpen(false); }
                return;
            }
            const next = Engine.applyDraftPick(league, card, { madeBy, createdAt: new Date().toISOString() });
            if (next === league) { setNote(`${card.name} could not be drafted — ${draftBlockReason(card) ?? 'the engine rejected the pick'}.`); return; }
            setNote('');
            const saved = await onUpdate(stripDraftedFromQueues(next), { type: 'draft', identity: card.identity });
            if (saved !== false) { setNote(`${card.name} — locked in!`); setSelectedIdentity(null); setScoutOpen(false); }
        }

        function simAiPick() {
            if (!revealReady || !clockReady || isAuction || !canSim || !seat || onClockTeam?.manager !== 'ai') return;
            if (onDraftAction) { onDraftAction({ type: 'ai-pick' }); return; }
            const choice = AI.aiDraftChoice(league, cards);
            if (!choice) { setNote('AI found no eligible player for this seat.'); return; }
            const next = Engine.applyDraftPick(league, choice, { madeBy: 'ai', createdAt: new Date().toISOString() });
            if (next === league) { setNote('The AI pick was rejected by the engine.'); return; }
            setNote('');
            onUpdate(stripDraftedFromQueues(next), { type: 'ai-pick' });
        }

        function simToMyPick() {
            if (!revealReady || !clockReady || isAuction || !canSim) return;
            if (onDraftAction) { onDraftAction({ type: 'ai-run' }); return; }
            let state = league;
            const createdAt = new Date().toISOString();
            for (let iteration = 0; iteration <= state.draftOrder.length; iteration += 1) {
                const active = Engine.currentDraftSeat(state);
                const team = active ? state.teams.find((t) => t.teamId === active.teamId) : null;
                if (!active || !team || team.manager !== 'ai') break;
                const choice = AI.aiDraftChoice(state, cards);
                if (!choice) break;
                const next = Engine.applyDraftPick(state, choice, { madeBy: 'ai', createdAt });
                if (next === state) break;
                state = next;
            }
            if (state === league) { setNote('Nothing to simulate.'); return; }
            setNote('');
            onUpdate(stripDraftedFromQueues(state), { type: 'ai-run' });
        }

        function toggleQueueFor(identity) {
            if (!humanTeam || !revealReady) return;
            onUpdate({ ...league, teams: league.teams.map((t) => (t.teamId === humanTeam.teamId ? { ...t, queue: DraftRoom.toggleDraftQueue(t.queue, identity) } : t)) }, { type: 'queue', teamId: humanTeam.teamId, identity });
        }

        function autoFromQueue() {
            const card = queueCards.find((c) => draftBlockReason(c) === null);
            if (!card) { setNote('No queued player fits the on-clock roster.'); return; }
            draftCard(card, 'human');
        }

        const humanOnClock = onClockTeam?.manager === 'human';
        const myTurn = humanOnClock && (!onlineMeta || seat?.teamId === onlineMeta.seatTeamId);
        const scoutBlock = selectedCard ? (onClockTeam && !humanOnClock ? `${onClockTeam.name} is on the clock — sim picks to advance.` : draftBlockReason(selectedCard)) : null;
        const canDraftSelected = Boolean(selectedCard && myTurn && !draftBlockReason(selectedCard));
        const selectedQueued = Boolean(selectedCard && humanTeam?.queue.includes(selectedCard.identity));
        const scoutSeasons = selectedCard ? EraRules.filterSeasonsForEra(selectedCard.seasons, eraRules, selectedCard.position) : [];
        const scoutHidden = selectedCard ? selectedCard.seasons.length - scoutSeasons.length : 0;

        const scoutFile = h('div', { className: 'tl-card tl-scout-file', ref: scoutRef },
                        h('div', { className: 'tl-card-title' }, h('span', null, 'Scout file'), h('small', null, selectedCard ? (scoutHidden > 0 ? `${scoutSeasons.length} of ${selectedCard.seasons.length} seasons draftable` : `${scoutSeasons.length} seasons on record`) : 'no selection')),
                        selectedCard ? h(React.Fragment, null,
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
                                h('strong', { style: { fontSize: 15 } }, selectedCard.name),
                                h('span', { className: 'tl-pos-badge tl-pos-' + selectedCard.position }, selectedCard.position),
                                selectedCard.bio?.hofYear && h('span', { className: 'tl-pill gold' }, `HOF ${selectedCard.bio.hofYear}`),
                                h('span', { className: 'tl-label' }, `${spanOf(scoutSeasons)} · draw peak ${peakOf(scoutSeasons).toFixed(1)}`),
                                scoutHidden > 0 && scoutSeasons.length > 0 && h('span', { className: 'tl-pill warn' }, `Draw ${spanOf(scoutSeasons)} · ${peakOf(scoutSeasons).toFixed(1)}`)),
                            selectedCard.bio ? h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10, fontSize: 12 } },
                                selectedCard.bio.college && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'College'), h('strong', null, selectedCard.bio.college)),
                                (selectedCard.bio.height || selectedCard.bio.weight) && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Size'), h('strong', null, [selectedCard.bio.height, selectedCard.bio.weight].filter(Boolean).join(' · '))),
                                (selectedCard.bio.draftTeam || selectedCard.bio.draftYear) && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'NFL draft'), h('strong', null, [selectedCard.bio.draftYear, selectedCard.bio.draftTeam].filter(Boolean).join(' · '))),
                                selectedCard.bio.birthDate && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Born'), h('strong', null, selectedCard.bio.birthDate)))
                                : h('p', { className: 'tl-empty' }, 'Biography is not available for this player yet.'),
                            h('p', { style: { fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 } }, scoutSeasons.length === 0 ? "No season on this file clears the league's era rule — nothing here can be drawn." : 'One of these seasons comes out of the vault — the draw is sealed until the draft ends.'),
                            scoutSeasons.length > 0 && h('p', { className: 'tl-era-years' }, `Available years: ${availableYears(scoutSeasons)}`),
                            scoutSeasons.length > 0 && h('div', { className: 'tl-scout-seasons', style: { overflowX: 'auto', marginBottom: 10 } }, h('table', { className: 'tl-tbl' },
                                h('thead', null, h('tr', null, h('th', null, 'Year'), h('th', { className: 'num' }, 'G'), statColumnsFor(selectedCard.position).map((c) => h('th', { className: 'num', key: c.key }, c.label)), h('th', { className: 'num' }, 'Pts'))),
                                h('tbody', null, scoutSeasons.map((season) => h('tr', { key: season.season },
                                    h('td', null, season.season), h('td', { className: 'num' }, season.games),
                                    statColumnsFor(selectedCard.position).map((c) => h('td', { className: 'num', key: c.key }, season[c.key])),
                                    h('td', { className: 'num' }, season.points.toFixed(1))))))),
                            scoutHidden > 0 && h('p', { className: 'tl-hint', style: { marginBottom: 10 } }, `${scoutHidden} season${scoutHidden === 1 ? '' : 's'} hidden — outside the league's era rule for ${selectedCard.position}, so they cannot be drawn.`),
                            h('div', { style: { display: 'flex', gap: 8 } },
                                h('button', { className: 'tl-btn primary', disabled: !canDraftSelected, onClick: () => draftCard(selectedCard, 'human') }, `${isAuction ? 'NOMINATE' : 'DRAFT'} ${selectedCard.name.toUpperCase()}`),
                                h('button', { className: 'tl-btn', disabled: !humanTeam || !revealReady, 'aria-pressed': selectedQueued, onClick: () => toggleQueueFor(selectedCard.identity) }, selectedQueued ? 'Unqueue' : 'Queue')),
                            scoutBlock && h('p', { style: { fontSize: 11.5, color: 'var(--warn)', marginTop: 8 } }, scoutBlock))
                            : h('p', { className: 'tl-empty' }, 'Select a player on the big board to open the scout file.'));
        const scoutDialog = scoutOpen && selectedCard ? h('div', { className: 'tl-scout-overlay', onClick: (event) => { if (event.target === event.currentTarget) closeScout(); } },
            h('section', { className: 'tl-scout-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': `${selectedCard.name} career scout`, ref: scoutDialogRef },
                h('div', { className: 'tl-scout-dialog-header' }, h('strong', null, 'Career in this draw'), h('button', { type: 'button', className: 'tl-btn', onClick: closeScout }, '← Back to draft')), scoutFile)) : null;

        const eraBanner = eraRules.mode === 'position-roulette' ? h('div', { className: 'tl-card tl-era-show' },
            h('div', { className: 'tl-card-title' },
                h('span', null, 'Your era draw'),
                anyPending
                    ? h('button', { className: 'tl-btn icon', onClick: revealAllPositions, disabled: Boolean(rollingPosition) }, 'Reveal all')
                    : h('small', null, 'dealt at founding · frozen for the life of the league')),
            eraAssignments.length === 0
                ? h('p', { className: 'tl-empty' }, 'The wheel has not been spun — decades are dealt the moment the league is founded.')
                : h(React.Fragment, null,
                    h('div', { className: 'tl-era-show-title' }, h('span', { className: 'tl-label' }, 'THE VAULT OPENS'), h('h2', null, `${eraAssignments.length} positions. Decades of possibility.`), h('p', null, 'Open each position to discover your draft class.')),
                    h('p', { className: 'tl-hint', style: { marginBottom: 10 } }, 'Every position group draws from one decade, and one decade only — turn one over to see who was actually available at it. This is the hand the league was dealt; there is no re-roll.'),
                    h('div', { className: 'tl-era-stage' },
                        eraAssignments.map((row, eraIndex) => {
                            const landed = revealedPositions.has(row.position);
                            const rolling = rollingPosition === row.position;
                            const fresh = freshlyRevealedRef.current.has(row.position);
                            const topThree = topThreeByPosition[row.position] || [];
                            const yearList = availableYears(available.filter(({ card }) => card.position === row.position).flatMap(({ card }) => EraRules.filterSeasonsForEra(card.seasons, eraRules, card.position)));
                            const cls = rolling || !landed
                                ? `tl-card tl-era-card ${rolling ? 'landed' : 'pending'}`.trim()
                                : fresh ? 'tl-card tl-era-card landed' : 'tl-card tl-era-card revealed';
                            return h('div', { key: row.position, className: cls, style: { padding: '10px 12px', animationDelay: `${eraIndex * 65}ms` } },
                                h('span', { className: 'tl-pill gold' }, row.position),
                                rolling
                                    ? h(React.Fragment, null,
                                        h('span', { className: 'tl-era-die', 'aria-hidden': 'true' }, '70 / 80 / 90 / 00 / 10'),
                                        h('span', { className: 'tl-era-rolling-label' }, 'Opening the archive…'))
                                    : landed
                                        ? h(React.Fragment, null,
                                            h('strong', { className: 'tl-era-decade' }, row.detail?.label ?? row.decade),
                                            h('span', { className: 'tl-era-years' }, `Available years: ${yearList}`),
                                            h('span', { className: `tl-pill ${row.pool === 0 ? 'bad' : 'good'}`, style: { display: 'inline-block', marginTop: 6, marginBottom: 8 } }, row.pool === 0 ? 'None left' : `${row.pool} draftable`),
                                            topThree.length > 0 && h('div', { className: 'tl-era-shortlist', 'aria-label': `${row.position} top three` },
                                                h('span', { className: 'tl-label' }, 'Top three · Tap to scout'),
                                                topThree.map(({ card }, index) => h('button', {
                                                    key: card.identity, type: 'button', className: 'tl-era-headliner',
                                                    'aria-label': `Scout ${card.name} in the ${row.detail?.label ?? row.decade}`,
                                                    onClick: (event) => openScout(card, event),
                                                }, h('span', { className: 'tl-era-headliner-rank' }, index + 1),
                                                h('span', null, h('strong', null, card.name), h('small', null, availableYears(EraRules.filterSeasonsForEra(card.seasons, eraRules, card.position)))),
                                                h('span', { 'aria-hidden': 'true' }, '↗')))))
                                        : h('button', {
                                            className: 'tl-btn', style: { display: 'block', width: '100%', marginTop: 8 },
                                            onClick: () => revealPosition(row.position), disabled: Boolean(rollingPosition),
                                        }, h('span', { className: 'tl-era-lock', 'aria-hidden': 'true' }, '✦'), 'Open ', row.position, ' archive'));
                        }))))
            : eraRestricted ? h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Era of play'), h('small', null, `${eraRules.decades.length} decade${eraRules.decades.length === 1 ? '' : 's'} in play · ${available.length} draftable`)),
                h('div', { className: 'tl-chip-row' }, eraRules.decades.map((id) => h('span', { key: id, className: 'tl-pill info' }, DECADE_BY_ID.get(id)?.label ?? id))))
            : null;

        const drawnByOverall = new Map((reveal?.teams || []).flatMap((row) => row.picks.map((pick) => [pick.overall, pick])));
        const draftCell = (pick) => {
            const drawn = drawnByOverall.get(pick.overall);
            return h('div', { className: `tl-draft-pick tl-draft-pick-${pick.pos || pick.position}` },
                h('small', null, `#${pick.overall} · ${pick.pos || pick.position}${Number.isFinite(pick.auctionPrice) ? ` · $${pick.auctionPrice}` : ''}`),
                h('strong', null, pick.name),
                drawn && h('span', null, `${drawn.drawnSeason ?? '—'} · ${drawn.points.toFixed(1)} pts`));
        };
        const dhqState = {
            picks: gridPicks.map((pick) => ({ ...pick, pos: pick.position, teamIdx: league.teams.findIndex((team) => team.teamId === pick.teamId), isUser: pick.teamId === humanTeam?.teamId })),
            pickOrder: gridOrder.map((slot) => ({ ...slot, teamIdx: league.teams.findIndex((team) => team.teamId === slot.teamId), rosterId: slot.teamId, ownerName: teamName(slot.teamId) })),
            userSlot: league.teams.findIndex((team) => team.teamId === humanTeam?.teamId) + 1,
            userRosterId: humanTeam?.teamId, leagueSize: league.teams.length, rounds: boardRounds.length,
            currentIdx: league.draftPicks.length, phase: 'vault', mode: 'ghost', pinnedRosterId,
            personas: Object.fromEntries(league.teams.map((team) => [team.teamId, { teamName: team.name }]))
        };
        const sharedGrid = window.DraftCC?.DraftGridPanel ? h(window.DraftCC.DraftGridPanel, {
            state: dhqState, currentSlot: seat && !isAuction ? dhqState.pickOrder.find((slot) => slot.overall === seat.overall) : null,
            isUserTurn: myTurn, dispatch: (action) => { if (action.type === 'PIN_TEAM') setPinnedRosterId(action.rosterId); }, renderPick: draftCell
        }) : null;
        const draftLog = h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, isAuction ? 'Auction results · each row is one team acquisition' : 'Draft log'),
                h('button', { className: 'tl-btn icon', onClick: () => setShowBoardGrid((c) => !c) }, showBoardGrid ? 'Pick list' : 'Board grid')),
            league.draftPicks.length === 0 ? h('p', { className: 'tl-empty' }, 'No picks yet — the log fills as the room drafts.')
                : showBoardGrid
                    ? sharedGrid || h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null, h('th', null, isAuction ? 'Add' : 'Rd'), league.teams.map((team) => h('th', { key: team.teamId }, team.name)))),
                        h('tbody', null, boardRounds.map(([round, seats]) => h('tr', { key: round },
                            h('td', { className: 'num' }, round),
                            league.teams.map((team) => {
                                const cell = seats.find((slot) => slot.teamId === team.teamId);
                                if (!cell) return h('td', { key: team.teamId }, '—');
                                const pick = pickByOverall.get(cell.overall);
                                return h('td', { key: team.teamId }, h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, teamName(cell.teamId)), pick ? draftCell(pick) : h('span', null, '—')));
                            }))))))
                    : h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null, h('th', null, 'Pick'), h('th', null, 'Team'), h('th', null, 'Player'), h('th', null, 'Pos'), h('th', null, 'By'))),
                        h('tbody', null, [...league.draftPicks].reverse().map((pick) => h('tr', { key: pick.overall },
                            h('td', null, draftPickLabel(pick)), h('td', null, teamName(pick.teamId)),
                            h('td', null, pick.name), h('td', null, h('span', { className: `tl-pos-badge tl-pos-${pick.position}` }, pick.position)),
                            h('td', null, pick.madeBy === 'ai' ? 'AI' : 'HU')))))));

        if (league.seasonsRevealed && reveal) {
            return h('div', null,
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Draft night report card'), h('small', null, `${league.draftPicks.length} picks · mystery seasons unsealed`)),
                    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 } },
                        h('span', { className: 'tl-pill gold' }, 'Draft complete'),
                        h('p', { style: { fontSize: 12.5, color: 'var(--text-secondary)', margin: 0 } }, `Every drawn season is on the record below — the war room moves to week ${league.currentWeek} lineups next.`)),
                    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 } },
                        h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'League median haul'), h('strong', { style: { fontSize: 20, fontFamily: 'var(--font-title)' } }, reveal.median.toFixed(1))),
                        h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, `Best haul — ${reveal.best ? reveal.best.team.name : '—'}`), h('strong', { style: { fontSize: 20, fontFamily: 'var(--font-title)' } }, reveal.best ? reveal.best.total.toFixed(1) : '0.0')),
                        h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Rounds drafted'), h('strong', { style: { fontSize: 20, fontFamily: 'var(--font-title)' } }, boardRounds.length)))),
                draftLog,
                h('p', { className: 'tl-hint' }, 'Grades compare each team’s drawn-season points with the league median. They describe the draw, not a prediction of wins.'),
                h('div', { className: 'tl-draft-grade-grid' },
                    reveal.teams.map(({ team, picks, total }) => {
                        const grade = gradeFor(total, reveal.median);
                        const best = [...picks].sort((l, r) => r.points - l.points).slice(0, 2);
                        return h('details', { key: team.teamId, className: 'tl-card tl-draft-grade' },
                            h('summary', { className: 'tl-card-title' }, h('span', null, team.name), h('span', { className: `tl-pill tl-draft-letter ${GRADE_PILL[grade]}` }, grade), h('small', null, `${total.toFixed(1)} pts · View class`)),
                            h('p', { style: { fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 } }, `${grade} — ${best.length ? `left with ${best.map((p) => `${p.drawnSeason ?? '?'} ${p.name}`).join(' and ')}` : 'left with an empty vault'}`),
                            h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'tl-tbl' },
                                h('thead', null, h('tr', null, h('th', null, 'Pick'), h('th', null, 'Player'), h('th', null, 'Pos'), h('th', { className: 'num' }, 'Season'), h('th', { className: 'num' }, 'Pts'))),
                                h('tbody', null, picks.map((pick) => h('tr', { key: pick.overall },
                                    h('td', null, draftPickLabel(pick)), h('td', null, pick.name),
                                    h('td', null, h('span', { className: `tl-pos-badge tl-pos-${pick.position}` }, pick.position)),
                                    h('td', { className: 'num tl-pill gold', style: { display: 'table-cell' } }, pick.drawnSeason ?? '—'),
                                    h('td', { className: 'num' }, pick.points.toFixed(1))))))));
                    })));
        }

        if (!revealReady) return h('div', { className: 'tl-draft-sealed' },
            eraBanner,
            h('div', { className: 'tl-card tl-draft-sealed-note', role: 'status' },
                h('strong', null, 'Open your archives to begin'),
                h('p', null, `${allEraPositions.filter((position) => revealedPositions.has(position)).length} of ${allEraPositions.length} positions revealed. Your player board and draft clock open after the final reveal.`)),
            scoutDialog);

        return h('div', null,
            eraBanner,
            draftControls,
            scoutDialog,
            h('div', { className: `tl-card tl-on-clock${myTurn ? ' your-turn' : ''}` },
                h('div', { className: 'tl-draft-progress', 'aria-label': `Draft ${Math.round(league.draftPicks.length / league.draftOrder.length * 100)} percent complete` }, h('span', { style: { width: `${league.draftPicks.length / league.draftOrder.length * 100}%` } })),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 } },
                    seat ? h('div', { className: 'tl-clock-ring' }) : null,
                    onClockTeam && h(window.TimeLeagueHelmetIcon, { helmet: onClockTeam.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(onClockTeam.name), size: 34, title: onClockTeam.name }),
                    h('div', { style: { flex: 1 } },
                        h('div', { style: { fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: 15 } }, seat && onClockTeam ? `On the clock — ${onClockTeam.name}` : 'Draft complete'),
                        h('small', { style: { color: 'var(--text-muted)' } }, seat ? `Pick ${seat.overall}/${league.draftOrder.length} · ${pickLabel(league.draftOrder, seat.overall, seat.round)}` : `${league.draftPicks.length} picks recorded`))),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                    onClockTeam && (humanOnClock ? h('span', { className: 'tl-pill gold' }, myTurn ? '✦ YOU’RE UP' : 'ON THE CLOCK') : h('span', { className: 'tl-pill info' }, `AI · ${persona ? persona.label : 'GM'}`)),
                    !humanOnClock && persona && h('p', { style: { fontStyle: 'italic', fontSize: 12, color: 'var(--text-faint, rgba(189,184,173,0.6))', margin: 0 } }, `"${persona.tell}"`),
                    humanOnClock && h('p', { style: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 } }, myTurn ? (isAuction ? 'Your nomination — choose a player to open bidding.' : 'Your pick — draft from the big board or scout file.') : `Waiting for ${onClockTeam.name} to pick.`),
                    onClockTeam && !humanOnClock && canSim && !isAuction && h('div', { style: { display: 'flex', gap: 8, marginLeft: 'auto' } },
                        h('button', { className: 'tl-btn', disabled: !clockReady, onClick: simAiPick }, '▶ Sim pick'),
                        h('button', { className: 'tl-btn', disabled: !clockReady, onClick: simToMyPick }, '⏭ Sim to my pick'))),
                note && h('p', { className: 'tl-pick-feedback', role: 'status', style: { fontSize: 12, color: 'var(--warn)', marginTop: 8 } }, note)),

            selectedCard && h('div', { className: 'tl-draft-dock' },
                h('button', { className: 'tl-dock-player', onClick: (event) => openScout(selectedCard, event), 'aria-label': `Scout ${selectedCard.name}` },
                    h('span', { className: `tl-pos-badge tl-pos-${selectedCard.position}` }, selectedCard.position), h('span', null, h('small', null, myTurn ? 'YOUR NEXT LEGEND?' : 'SCOUT WHILE YOU WAIT'), h('b', null, selectedCard.name))),
                h('button', { className: 'tl-btn primary', 'aria-label': `${isAuction ? 'Nominate' : 'Draft'} ${selectedCard.name}`, disabled: !canDraftSelected, onClick: () => draftCard(selectedCard, 'human') }, isAuction ? 'Nominate' : 'Draft', h('span', { 'aria-hidden': 'true' }, '↗'))),
            h('div', { className: 'tl-grid-2 tl-draft-grid' },
                h('div', null,
                    h('div', { className: 'tl-card tl-player-board' },
                        h('div', { className: 'tl-card-title' }, h('span', null, 'Find your next legend'), h('small', null, `${visible.length} of ${filtered.length} ${query.trim() || positionFilter !== 'ALL' ? 'matching' : eraRestricted ? 'era-eligible' : 'available'}`)),
                        h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
                            h('input', { className: 'tl-input', value: query, onChange: (e) => setQuery(e.target.value), placeholder: 'Search player', 'aria-label': 'Search players' }),
                            h('select', { className: 'tl-select', style: { width: 130 }, value: positionFilter, onChange: (e) => setPositionFilter(e.target.value), 'aria-label': 'Filter position' },
                                h('option', { value: 'ALL' }, 'ALL POS'), positions.map((p) => h('option', { key: p, value: p }, p)))),
                        h('div', { className: 'tl-mobile-player-list' }, visible.map(({ card, rank, draw }) => h('div', { key: card.identity, className: `tl-mobile-player${selectedCard?.identity === card.identity ? ' selected' : ''}`, 'data-position': card.position },
                            h('button', { className: 'tl-mobile-player-pick', 'aria-pressed': selectedCard?.identity === card.identity, 'aria-label': `Scout ${card.name}`, onClick: (event) => openScout(card, event) },
                                h('span', { className: 'tl-player-number' }, h('small', null, String(rank).padStart(2, '0')), h('b', null, card.position)),
                                h('span', { className: 'tl-player-name' }, h('b', null, card.name), h('small', null, `${eraRestricted ? draw : seasonSpan(card)} · Mystery season`)),
                                h('span', { className: 'tl-player-peak' }, h('b', null, Math.round(card.peak)), h('small', null, 'PEAK'))),
                            h('button', { className: 'tl-player-star', 'aria-label': `${humanTeam?.queue.includes(card.identity) ? 'Unqueue' : 'Queue'} ${card.name}`, 'aria-pressed': Boolean(humanTeam?.queue.includes(card.identity)), disabled: !humanTeam, onClick: () => toggleQueueFor(card.identity) }, humanTeam?.queue.includes(card.identity) ? '★' : '☆')))),
                        visible.length === 0
                            ? h('p', { className: 'tl-empty' }, cards.size === 0 ? 'No player cards loaded.' : eraRestricted && available.length === 0 ? "No player on file clears this league's era rule — the pool is empty." : 'No available players match the filters.')
                            : h('div', { className: 'tl-desktop-player-board', style: { maxHeight: 520, overflowY: 'auto' } }, h('table', { className: 'tl-tbl' },
                                h('thead', null, h('tr', null, h('th', { className: 'num' }, 'Rk'), h('th', null, 'Player'), h('th', null, 'Pos'), h('th', null, eraRestricted ? 'Draw' : 'Seasons'), h('th', { className: 'num' }, 'Peak'), h('th', { className: 'num' }, 'G'), h('th', null, 'Q'))),
                                h('tbody', null, visible.map(({ card, rank, draw }) => {
                                    const queued = Boolean(humanTeam?.queue.includes(card.identity));
                                    return h('tr', { key: card.identity, className: `clickable${selectedCard?.identity === card.identity ? ' selected' : ''}`, onClick: (event) => openScout(card, event) },
                                        h('td', { className: 'num tabular' }, rank), h('td', null, h('button', { className: 'tl-scout-player-name', type: 'button', onClick: (event) => { event.stopPropagation(); openScout(card, event); } }, card.name)),
                                        h('td', null, h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position)),
                                        h('td', null, eraRestricted ? draw : seasonSpan(card)),
                                        h('td', { className: 'num tabular' }, card.peak.toFixed(1)), h('td', { className: 'num tabular' }, careerGames(card)),
                                        h('td', null, h('button', {
                                            className: `tl-btn icon${queued ? ' primary' : ''}`, 'aria-pressed': queued, disabled: !humanTeam,
                                            onClick: (e) => { e.stopPropagation(); toggleQueueFor(card.identity); },
                                        }, '★')));
                                }))))),
                    filtered.length > visible.length && h('button', { className: 'tl-btn tl-show-more', onClick: () => setBoardLimit(value => value + 24) }, `Show more legends · ${filtered.length - visible.length} more`),
                    draftLog),
                h('div', null,
                    h(OpponentIntel, { league, humanTeam, onClockTeamId: seat?.teamId }),
                    scoutFile,
                    h('div', { className: 'tl-card' },
                        h('div', { className: 'tl-card-title' }, h('span', null, 'My queue'), h('small', null, humanTeam ? `${humanTeam.name} · ${queueCards.length} queued` : 'no human seat')),
                        queueCards.length === 0 ? h('p', { className: 'tl-empty' }, 'Queue empty — star players on the big board.')
                            : h('div', { className: 'tl-queue-strip' }, queueCards.map((card, i) => h('div', { key: card.identity, className: 'tl-queue-chip', onClick: (event) => openScout(card, event) },
                                h('span', { className: 'tl-qnum' }, i + 1),
                                h('span', null, card.name),
                                h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position),
                                h('button', { className: 'tl-btn icon', style: { padding: '2px 5px' }, 'aria-label': `Remove ${card.name} from queue`, onClick: (e) => { e.stopPropagation(); toggleQueueFor(card.identity); } }, '✕')))),
                        h('button', { className: 'tl-btn', disabled: !myTurn || !clockReady || (isAuction && Boolean(league.draftAuction?.nomination)) || queueCards.length === 0, onClick: autoFromQueue, style: { marginTop: 8 } }, isAuction ? 'Nominate from queue' : 'Auto from queue')))));
    }

    window.WrTimeLeagueDraftPanel = WrTimeLeagueDraftPanel;
})();
