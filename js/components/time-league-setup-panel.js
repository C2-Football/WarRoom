// ══════════════════════════════════════════════════════════════════
// js/components/time-league-setup-panel.js — window.WrTimeLeagueSetupPanel
// Player-first lobby and league builder for The Vault. The first choice is
// now the way somebody wants to play (solo or with friends); commissioner
// details remain available without blocking the fast path into a draft.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useState, useMemo, useEffect, useRef } = React;
    const h = React.createElement;

    const EraRules = window.App.TimeLeagueEraRules;
    const Engine = window.App.TimeLeagueEngine;
    const AI = window.App.TimeLeagueAI;

    const ROSTER_PRESET_OPTIONS = [
        { id: 'compact', label: 'Compact', detail: 'QB1 · RB1 · WR1 · FLEX1 · BN2', slots: { QB: 1, RB: 1, WR: 1, FLEX: 1, BN: 2 } },
        { id: 'standard', label: 'Standard', detail: 'QB1 · RB2 · WR2 · TE1 · FLEX1 · K1 · DEF1 · BN3', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 3 } },
        { id: 'deep', label: 'Deep', detail: 'QB1 · RB2 · WR3 · TE1 · FLEX2 · BN5', slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, BN: 5 } },
        { id: 'full', label: 'Full squad', detail: 'QB1 · RB2 · WR2 · TE1 · FLEX1 · K1 · DEF1 · BN3', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 3 } },
    ];
    const SCORING_PRESET_OPTIONS = [
        { id: 'half', label: 'Half-PPR', detail: '4 pass TD · 0.5/rec · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
        { id: 'ppr', label: 'Full PPR', detail: '4 pass TD · 1.0/rec · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 1, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
        { id: 'standard', label: 'Standard', detail: '4 pass TD · no PPR · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 0, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
    ];
    const ERA_MODE_OPTIONS = [
        { id: 'position-roulette', icon: '✦', label: 'Position Roulette', eyebrow: 'THE VAULT ORIGINAL', blurb: 'Every position is dealt a surprise decade.', tone: 'roulette' },
        { id: 'any-era', icon: '∞', label: 'All-Era Classic', eyebrow: 'THE FULL VAULT', blurb: 'Every season since 1970 can be drawn.', tone: 'classic' },
        { id: 'selected-decades', icon: '◫', label: 'Decade Draft', eyebrow: 'YOUR FOOTBALL ERA', blurb: 'Choose which decades make the player pool.', tone: 'decades' },
    ];

    const DRAFT_FORMATS = [
        { id: 'snake', label: 'Snake', detail: 'The order reverses each round.' },
        { id: 'linear', label: 'Linear', detail: 'The same order every round.' },
        { id: 'auction', label: 'Auction', detail: 'Nominate a legend. Everyone can bid.' },
    ];
    const DRAFT_SECONDS = [0, 15, 30, 60, 90, 120, 180, 300];
    const AI_PACES = [[0.5, 'Fastest'], [1, 'Fast'], [2, 'Standard'], [4, 'Relaxed'], [8, 'Take your time']];

    const defaultSeatsFor = (playMode) => window.TimeLeagueUtils.defaultSeats().map((seat, index) => ({
        ...seat,
        name: playMode === 'friends' && index > 0 ? `Friend ${index}` : seat.name,
        manager: playMode === 'friends' || index === 0 ? 'human' : 'ai',
    }));

    function PersonaMeterRow({ label, value }) {
        const clamped = Math.max(0, Math.min(100, value));
        return h('div', { className: 'tl-persona-meter' },
            h('span', { className: 'tl-label' }, label),
            h('span', { className: 'track' }, h('span', { style: { width: `${clamped}%` } })),
            h('span', { className: 'tabular' }, clamped));
    }

    function PersonalityGuide() {
        const personas = Object.entries(AI.AI_PERSONAS);
        const [selected, setSelected] = useState(personas[0][0]);
        const persona = AI.AI_PERSONAS[selected] || personas[0][1];
        return h('details', { className: 'tl-personality-guide' },
            h('summary', null, 'Meet the personalities', h('span', null, `${personas.length} styles`)),
            h('div', { className: 'tl-personality-guide-body' },
                h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'Explore a personality'),
                    h('select', { className: 'tl-select', value: selected, onChange: event => setSelected(event.target.value) },
                        personas.map(([id, item]) => h('option', { key: id, value: id }, item.label)))),
                h('p', null, persona.tell),
                h('div', { className: 'tl-personality-guide-meters' },
                    h(PersonaMeterRow, { label: 'AGGRESSION', value: persona.aggression }),
                    h(PersonaMeterRow, { label: 'PATIENCE', value: persona.patience }),
                    h(PersonaMeterRow, { label: 'RISK', value: persona.riskTolerance }))));
    }

    function VaultHero() {
        const [revealed, setRevealed] = useState(false);
        const years = ['1970', '1985', '1999', '2012', '2025'];
        return h('section', { className: 'tl-lobby-hero' },
            h('div', { className: 'tl-lobby-copy' },
                h('div', { className: 'tl-hero-kicker' }, h('span', null, '✦'), ' FANTASY FOOTBALL · UNLOCKED'),
                h('h1', null, 'Legends play here.', h('br'), h('em', null, 'Bring your rivals.')),
                h('p', null, 'Draft all-time greats. Unwrap their mystery seasons. Take on your friends—or the house.'),
                h('a', { className: 'tl-btn primary tl-hero-cta', href: '#vault-setup-0', onClick: event => { event.preventDefault(); document.getElementById('vault-setup-0')?.scrollIntoView({ behavior: 'auto', block: 'start' }); } }, 'Let’s play', h('span', { 'aria-hidden': 'true' }, '↗')),
                h('div', { className: 'tl-hero-proof' },
                    h('span', null, h('b', null, '50+'), ' seasons'),
                    h('span', null, h('b', null, '14'), ' gameweeks'),
                    h('span', null, h('b', null, '1'), ' champion'))),
            h('div', { className: `tl-lobby-visual${revealed ? ' revealed' : ''}` },
                h('div', { className: 'tl-stadium-glow' }),
                h('div', { className: 'tl-visual-score' },
                    h('span', { className: 'live' }, 'TAP A CARD. OPEN THE VAULT.'),
                    h('div', null, h('b', null, revealed ? 'SEASONS UNLOCKED' : 'DRAFT THE PLAYER'), h('strong', null, revealed ? '3 / 3' : '?'))),
                h('div', { className: 'tl-card-fan' },
                    [['QB', '1984', 'Dan Marino'], ['RB', '2006', 'LaDainian Tomlinson'], ['WR', '1995', 'Jerry Rice']].map(([position, year, player], index) => h('button', {
                        key: position, type: 'button', className: `tl-mystery-card card-${index + 1}`,
                        'aria-label': `${revealed ? 'Seal' : 'Reveal'} sample seasons`, 'aria-pressed': revealed,
                        onClick: () => setRevealed(!revealed),
                    }, h('span', null, position), h('b', null, revealed ? year : '????'), h('small', null, revealed ? 'SEASON REVEALED' : 'TAP TO REVEAL'),
                    h('strong', { className: 'tl-demo-player' }, player)))),
                h('div', { className: 'tl-era-track' }, years.map((year) => h('span', { key: year }, year)))));
    }

    function LeagueCard({ entry, online, onOpen, onDelete }) {
        const [confirming, setConfirming] = useState(false);
        const phase = entry.phase || 'draft';
        const tone = phase === 'draft' ? 'warn' : phase === 'season' ? 'info' : 'gold';
        return h('article', { className: 'tl-season-card' },
            h('div', { className: `tl-season-mark ${online ? 'friends' : 'solo'}` }, online ? '◆' : 'V'),
            h('div', { className: 'tl-season-copy' },
                h('div', { className: 'tl-season-name' }, entry.name),
                h('div', { className: 'tl-season-meta' },
                    h('span', { className: `tl-pill ${tone}` }, phase.toUpperCase()),
                    h('span', null, online ? 'FRIENDS LEAGUE' : 'SOLO SEASON'),
                    phase !== 'draft' && h('span', null, `WEEK ${Math.min(entry.currentWeek ?? 1, window.TimeLeagueUtils.REGULAR_SEASON_WEEKS)}`),
                    h('span', null, `${entry.teamCount ?? 0} TEAMS`))),
            confirming
                ? h('div', { className: 'tl-season-actions' },
                    h('button', { type: 'button', className: 'tl-btn danger', onClick: () => onDelete(entry.leagueId) }, 'DELETE'),
                    h('button', { type: 'button', className: 'tl-btn', onClick: () => setConfirming(false) }, 'KEEP'))
                : h('div', { className: 'tl-season-actions' },
                    h('button', { type: 'button', className: 'tl-btn primary', onClick: onOpen }, phase === 'draft' ? 'ENTER DRAFT →' : 'CONTINUE →'),
                    !online && h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': `Delete ${entry.name}`, onClick: () => setConfirming(true) }, '•••')));
    }

    function LeagueShelf({ index, onlineIndex, onOpen, onDelete, onOpenOnline }) {
        if (!index.length && !onlineIndex.length) return null;
        return h('section', { className: 'tl-season-shelf' },
            h('div', { className: 'tl-section-heading' },
                h('div', null, h('span', { className: 'tl-eyebrow' }, 'BACK IN THE HUDDLE'), h('h2', null, 'Continue playing')),
                h('small', null, `${index.length + onlineIndex.length} active ${index.length + onlineIndex.length === 1 ? 'league' : 'leagues'}`)),
            h('div', { className: 'tl-season-list' },
                index.map((entry) => h(LeagueCard, { key: entry.leagueId, entry, onOpen: () => onOpen(entry.leagueId), onDelete })),
                onlineIndex.map((entry) => h(LeagueCard, { key: entry.rowId, entry, online: true, onOpen: () => onOpenOnline(entry.rowId) }))));
    }

    function PlayModeCard({ id, selected, onClick }) {
        const friends = id === 'friends';
        return h('button', { type: 'button', 'aria-pressed': selected, className: `tl-play-mode ${id}${selected ? ' selected' : ''}`, onClick },
            h('span', { className: 'tl-play-icon' }, friends ? '✌' : '⚡'),
            h('span', { className: 'tl-play-copy' },
                h('span', { className: 'tl-play-topline' }, h('strong', null, friends ? 'Play with Friends' : 'Play Solo'), !friends && h('em', null, 'FASTEST')),
                h('span', null, friends ? 'Create a private, live league and invite your crew.' : 'Draft now against distinct AI GMs. No account needed.'),
                h('small', null, friends ? '2–12 managers · synced live' : 'You + AI rivals · saves on this device')),
            h('span', { className: 'tl-radio-dot' }));
    }

    function EraModeCard({ option, selected, onClick }) {
        return h('button', { type: 'button', 'aria-pressed': selected, className: `tl-era-mode ${option.tone}${selected ? ' selected' : ''}`, onClick },
            h('span', { className: 'tl-era-icon' }, option.icon),
            h('span', { className: 'tl-era-copy' },
                h('small', null, option.eyebrow),
                h('strong', null, option.label),
                h('span', null, option.blurb)),
            option.id === 'position-roulette' && h('span', { className: 'tl-mode-badge' }, 'THE ORIGINAL'));
    }

    function LeagueBuilder({ onCreate, onCreateOnline, onOpenOnline, onlineIndexState }) {
        const [playMode, setPlayMode] = useState('solo');
        const [creating, setCreating] = useState(false);
        const [createError, setCreateError] = useState(null);
        const createInFlight = useRef(false);
        const [name, setName] = useState('');
        const [seats, setSeats] = useState(() => defaultSeatsFor('solo'));
        const identityTouched = useRef(false);
        const [identityStatus, setIdentityStatus] = useState('');
        const identityUser = window.App.OD?.getCurrentUserId?.() || null;
        useEffect(() => {
            let cancelled = false;
            const Profile = window.App.TimeLeagueProfile;
            if (!Profile) return undefined;
            // Cloud defaults may arrive after editing starts. Never replace an edited team.
            Profile.get().then(result => {
                if (cancelled || !result.ok || identityTouched.current || !Profile.hasSaved()) return;
                const identity = Profile.teamDefaults();
                if (identity) setSeats(previous => previous.map((seat, index) => index ? seat : { ...seat, ...identity }));
            }).catch(() => { if (!cancelled) setIdentityStatus('Your saved design is unavailable. You can still create your team here.'); });
            return () => { cancelled = true; };
        }, [identityUser]);
        const useSavedIdentity = async () => {
            const Profile = window.App.TimeLeagueProfile;
            const userAtStart = window.App.OD?.getCurrentUserId?.() || null;
            setIdentityStatus('Loading your saved design…');
            let result;
            try { result = await Profile.get(); }
            catch { result = { ok: false, error: 'Could not load your saved design. Try again.' }; }
            if ((window.App.OD?.getCurrentUserId?.() || null) !== userAtStart) return;
            const identity = result.ok && Profile.teamDefaults();
            if (!identity) { setIdentityStatus(result.error || 'Save your team design in My profile first.'); return; }
            identityTouched.current = true;
            setSeats(previous => previous.map((seat, index) => index ? seat : { ...seat, ...identity }));
            setIdentityStatus('Your saved team design is ready.');
        };
        const [rosterPreset, setRosterPreset] = useState('standard');
        const [scoringPreset, setScoringPreset] = useState('half');
        const [eraAdjusted, setEraAdjusted] = useState(false);
        const [eraMode, setEraMode] = useState('position-roulette');
        const [eraDecades, setEraDecades] = useState([]);
        const [playoffTeams, setPlayoffTeams] = useState(4);
        const [advancementMode, setAdvancementMode] = useState('commissioner');
        const [gateHours, setGateHours] = useState(24);
        const [waiversEnabled, setWaiversEnabled] = useState(true);
        const [waiverMode, setWaiverMode] = useState('priority');
        const [faabBudget, setFaabBudget] = useState(100);
        const [tradesEnabled, setTradesEnabled] = useState(true);
        const [aiDifficulty, setAiDifficulty] = useState('veteran');
        const [draftFormat, setDraftFormat] = useState('snake');
        const [draftPickSeconds, setDraftPickSeconds] = useState(60);
        const [draftAiSeconds, setDraftAiSeconds] = useState(2);
        const [draftAuctionBudget, setDraftAuctionBudget] = useState(200);

        const [customSlots, setCustomSlots] = useState(null);
        const [customStats, setCustomStats] = useState({});
        const [bonuses, setBonuses] = useState([['passYd',300],['passYd',400],['rushYd',100],['rushYd',200],['recYd',100],['recYd',200]].map(([stat, threshold]) => ({ stat, threshold, points: 0 })));
        const [customExtended, setCustomExtended] = useState(null);
        const [qbLimit, setQbLimit] = useState(window.TimeLeagueUtils.MAX_QUARTERBACKS);
        const origin = playMode === 'friends' ? 'online' : 'local';
        const rosterOption = ROSTER_PRESET_OPTIONS.find((option) => option.id === rosterPreset) ?? ROSTER_PRESET_OPTIONS[1];
        const scoringOption = SCORING_PRESET_OPTIONS.find((option) => option.id === scoringPreset) ?? SCORING_PRESET_OPTIONS[0];
        const eraRules = useMemo(() => ({
            mode: eraMode,
            decades: eraMode === 'any-era' ? [] : EraRules.ERA_DECADES.filter((decade) => eraDecades.includes(decade.id)).map((decade) => decade.id),
        }), [eraMode, eraDecades]);
        const settings = useMemo(() => ({
            draftFormat, draftPickSeconds, draftAiSeconds, draftAuctionBudget,
            rosterSlots: customSlots || rosterOption.slots,
            scoring: { ...scoringOption.scoring, stats: customStats, bonuses, ...(customExtended ? { extended: customExtended } : {}) },
            regularSeasonWeeks: 14 - Math.log2((seats.length >= playoffTeams ? playoffTeams : 2) || 1),
            advancementMode: playMode === 'friends' ? advancementMode : 'commissioner', gateHours,
            playoffTeams: seats.length >= playoffTeams ? playoffTeams : 2,
            maxQuarterbacks: Math.max(qbLimit, (customSlots || rosterOption.slots).QB || 0),
            eraAdjusted, eraRules, waiversEnabled, waiverMode, faabBudget, tradesEnabled, aiDifficulty,
        }), [draftFormat, draftPickSeconds, draftAiSeconds, draftAuctionBudget, playMode, bonuses, advancementMode, gateHours, customSlots, customStats, customExtended, qbLimit, playoffTeams, seats.length, rosterOption, scoringOption, eraAdjusted, eraRules, waiversEnabled, waiverMode, faabBudget, tradesEnabled, aiDifficulty]);
        const capacity = Engine.rosterCapacity(settings);
        const humanSeats = seats.filter((seat) => seat.manager === 'human').length;
        const signedIn = onlineIndexState !== 'signed-out' && Boolean(window.App.OD && window.App.OD.getCurrentUserId && window.App.OD.getCurrentUserId());

        const choosePlayMode = (nextMode) => {
            if (nextMode === playMode) return;
            setPlayMode(nextMode);
            setCreateError(null);
            setSeats((previous) => defaultSeatsFor(nextMode).map((seat, index) => index === 0 ? { ...seat, ...previous[0], manager: 'human' } : seat));
        };
        const updateSeat = (target, patch) => {
            if (target === 0) identityTouched.current = true;
            setSeats((previous) => previous.map((seat, index) => {
                if (index !== target) return seat;
                const aiSeat = patch.manager === 'ai' && seat.manager !== 'ai'
                    ? Engine.defaultAiSeat(index, previous.filter((_, i) => i !== index).map(item => item.name)) : null;
                return { ...seat, ...(aiSeat ? { aiPersona: aiSeat.aiPersona, ...(/^Friend \d+$/.test(seat.name) ? { name: aiSeat.name, helmet: aiSeat.helmet } : {}) } : {}), ...patch };
            }));
        };
        const addSeat = () => setSeats((previous) => {
            if (previous.length >= 12) return previous;
            const aiSeat = Engine.defaultAiSeat(previous.length, previous.map(seat => seat.name));
            const seatName = playMode === 'friends' ? `Friend ${previous.length}` : aiSeat.name;
            return [...previous, {
                name: seatName,
                manager: playMode === 'friends' ? 'human' : 'ai',
                aiPersona: aiSeat.aiPersona,
                helmet: window.App.TimeLeagueHelmet.defaultHelmet(seatName),
            }];
        });
        const removeSeat = (target) => setSeats((previous) => (previous.length <= 2 ? previous : previous.filter((seat, index) => index !== target)));
        const toggleDecade = (id) => setEraDecades((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

        const startLeague = async () => {
            if (createInFlight.current) return;
            createInFlight.current = true;
            setCreating(true);
            setCreateError(null);
            try {
                const built = seats.map((seat, index) => ({
                    name: seat.name.trim() || (seat.manager === 'ai' ? Engine.defaultAiSeat(index).name : index === 0 ? 'My Team' : `Manager ${index + 1}`),
                    manager: seat.manager,
                    ...(seat.manager === 'ai' ? { aiPersona: seat.aiPersona } : {}),
                    helmet: seat.helmet,
                    primaryColor: seat.primaryColor, secondaryColor: seat.secondaryColor, backdrop: seat.backdrop,
                }));
                const leagueName = name.trim() || (playMode === 'friends' ? 'Sunday Time Machine' : 'My Vault Season');
                if (origin === 'local') {
                    await onCreate({ name: leagueName, seats: built, settings });
                    return;
                }
                const result = await onCreateOnline({ name: leagueName, seats: built, settings });
                if (!result?.ok) {
                    const message = result?.error;
                    setCreateError(message && !/^[a-z_]+$/.test(message) ? message : 'Could not create your friends league. Check your connection and try again.');
                    return;
                }
                onOpenOnline(result.rowId);
            } catch (error) {
                setCreateError(error?.message || 'Could not create your league. Your settings are still here; try again.');
            } finally {
                createInFlight.current = false;
                setCreating(false);
            }
        };


        const selectedEra = ERA_MODE_OPTIONS.find((option) => option.id === eraMode) ?? ERA_MODE_OPTIONS[0];
        const opponentSeats = seats.slice(1);
        return h('section', { className: 'tl-builder', 'aria-busy': creating },
            h('div', { className: 'tl-builder-head' },
                h('div', null, h('span', { className: 'tl-eyebrow' }, 'YOUR NEXT GREAT RIVALRY'), h('h2', null, 'Make it your game')),
                h('div', { className: 'tl-flow-steps', 'aria-label': 'League setup progress' },
                    ['HOW', 'TWIST', 'TEAM'].map((label, index) => h('a', { key: label, href: `#vault-setup-${index}`, className: 'active' }, h('b', null, index + 1), label)))),

            h('div', { className: 'tl-builder-section', id: 'vault-setup-0' },
                h('div', { className: 'tl-question' }, h('span', null, '1'), h('div', null, h('h3', null, 'How do you want to play?'), h('p', null, 'Both modes use the same draft, waivers, trades, and live gamecast.'))),
                h('div', { className: 'tl-play-grid' },
                    h(PlayModeCard, { id: 'solo', selected: playMode === 'solo', onClick: () => choosePlayMode('solo') }),
                    h(PlayModeCard, { id: 'friends', selected: playMode === 'friends', onClick: () => choosePlayMode('friends') })),
                playMode === 'friends' && !signedIn && h('div', { className: 'tl-signin-callout' },
                    h('span', null, '◆'),
                    h('p', null, h('b', null, 'Sign in to host a friends league.'), ' Your league and every move will sync live across devices.'),
                    h('a', { className: 'tl-btn', href: 'login.html?vault=1' }, 'SIGN IN'))),

            h('div', { className: 'tl-builder-section', id: 'vault-setup-1' },
                h('div', { className: 'tl-question' }, h('span', null, '2'), h('div', null, h('h3', null, 'Pick the time-travel twist'), h('p', null, 'You draft the player. The Vault reveals the season.'))),
                h('div', { className: 'tl-era-mode-grid' }, ERA_MODE_OPTIONS.map((option) => h(EraModeCard, {
                    key: option.id, option, selected: eraMode === option.id, onClick: () => setEraMode(option.id),
                }))),
                eraMode !== 'any-era' && h('div', { className: 'tl-decade-picker' },
                    h('div', null, h('b', null, eraMode === 'position-roulette' ? 'Roulette pool' : 'Draftable decades'), h('small', null, eraDecades.length ? `${eraDecades.length} selected` : 'All decades included')),
                    h('div', { className: 'tl-decade-row' }, EraRules.ERA_DECADES.map((decade) => h('button', {
                        key: decade.id, type: 'button', className: eraDecades.includes(decade.id) ? 'selected' : '', onClick: () => toggleDecade(decade.id),
                    }, decade.label)))),
                h('section', { className: 'tl-draft-setup-rules', 'aria-label': 'Draft rules' },
                    h('div', null, h('h4', null, 'How will you draft?'), h('p', { className: 'tl-hint' }, 'Keep the same mystery seasons with any draft format.')),
                    h('div', { className: 'tl-draft-format-options' }, DRAFT_FORMATS.map(option => h('button', {
                        key: option.id, type: 'button', className: `tl-draft-format${draftFormat === option.id ? ' selected' : ''}`,
                        'aria-pressed': draftFormat === option.id, onClick: () => setDraftFormat(option.id),
                    }, h('strong', null, option.label), h('span', null, option.detail)))),
                    h('div', { className: 'tl-draft-setup-fields' },
                        h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, draftFormat === 'auction' ? 'Nomination & bid clock' : 'Pick clock'),
                            h('select', { className: 'tl-select', 'aria-label': 'Draft clock duration', value: draftPickSeconds, onChange: event => setDraftPickSeconds(Number(event.target.value)) },
                                DRAFT_SECONDS.map(seconds => h('option', { key: seconds, value: seconds }, seconds ? `${seconds} seconds` : 'Off · no timer')))),
                        playMode === 'solo' && h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'AI draft pace'),
                            h('select', { className: 'tl-select', 'aria-label': 'AI draft pace', value: draftAiSeconds, onChange: event => setDraftAiSeconds(Number(event.target.value)) },
                                AI_PACES.map(([seconds, label]) => h('option', { key: seconds, value: seconds }, `${label} · ${seconds}s`)))),
                        draftFormat === 'auction' && h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'Auction budget per team'),
                            h('input', { className: 'tl-input', 'aria-label': 'Auction budget per team', type: 'number', min: 50, max: 1000, step: 1, value: draftAuctionBudget,
                                onChange: event => setDraftAuctionBudget(Math.max(50, Math.min(1000, Math.round(Number(event.target.value) || 200)))) }))),
                    h('p', { className: 'tl-hint' }, draftFormat === 'auction'
                        ? `Each team starts with $${draftAuctionBudget}. Keep $1 for every unfilled roster spot. Bids restart the clock.`
                        : draftPickSeconds ? 'When time runs out, the next legal pick comes from your queue or the available board.' : 'Make each pick when you are ready.',
                    playMode === 'solo' ? ' You can pause the countdown and change the AI pace in the draft room.' : 'The commissioner can pause or change the draft clock for the room.')),
                h('label', { className: 'tl-playoff-setting' }, h('span', { className: 'tl-label' }, 'SEASON FINISH'),
                    h('select', { className: 'tl-select', value: settings.playoffTeams, onChange: event => setPlayoffTeams(Number(event.target.value)) },
                        h('option', { value: 0 }, 'Standings champion'), h('option', { value: 2 }, 'Top 2 · Championship final'), h('option', { value: 4, disabled: seats.length < 4 }, 'Top 4 · 12 games + playoffs'), h('option', { value: 8, disabled: seats.length < 8 }, 'Top 8 · 11 games + playoffs')),
                    h('p', { className: 'tl-hint' }, `${settings.regularSeasonWeeks} regular-season games · 14 weeks total. Higher seed wins a playoff tie. Missing game logs score zero.`)),
                playMode === 'friends' && h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'WEEKLY ADVANCEMENT'), h('select', { className: 'tl-select', value: advancementMode, onChange: event => setAdvancementMode(event.target.value) }, h('option', { value: 'commissioner' }, 'Commissioner advances'), h('option', { value: 'majority' }, 'Majority vote'), h('option', { value: 'timed' }, 'Timed gates')), advancementMode === 'timed' && h('input', { className: 'tl-input', type: 'number', min: 1, max: 168, value: gateHours, onChange: event => setGateHours(Math.max(1, Math.min(168, Number(event.target.value) || 24))), 'aria-label': 'Hours per gate' }), h('p', { className: 'tl-hint' }, 'Four stops each week: claims, final roster decisions, game day, and final results. The commissioner can override any gate.', advancementMode === 'timed' && ' Deadlines are checked while a manager has the room open and resume on return.'))),

            h('div', { className: 'tl-builder-section', id: 'vault-setup-2' },
                h('div', { className: 'tl-question' }, h('span', null, '3'), h('div', null, h('h3', null, 'Name your team. Build your helmet.'), h('p', null, 'Choose a retro identity, then take the ready-to-play defaults or tune every rule below.'))),
                h('div', { className: 'tl-identity-grid' },
                    h('label', null, h('span', { className: 'tl-label' }, 'League name'), h('input', { className: 'tl-input', value: name, maxLength: 80, placeholder: playMode === 'friends' ? 'Sunday Time Machine' : 'My Vault Season', onChange: (event) => setName(event.target.value) })),
                    h('label', null, h('span', { className: 'tl-label' }, 'Your team & helmet'), h('span', { className: 'tl-team-input' },
                        h(window.TimeLeagueHelmetPicker, { helmet: seats[0].helmet, name: seats[0].name, letter: window.App.TimeLeagueHelmet.monogramFor(seats[0].name), onChange: (helmet) => updateSeat(0, { helmet }) }),
                        h('input', { className: 'tl-input', value: seats[0].name, maxLength: 60, placeholder: 'Name your team', onChange: (event) => updateSeat(0, { name: event.target.value }) })))),
                window.App.TimeLeagueProfile && h('div', { className: 'tl-identity-actions' }, h('button', { type: 'button', className: 'tl-btn', onClick: useSavedIdentity }, 'Use saved team design'), identityStatus && h('span', { role: 'status', className: 'tl-hint' }, identityStatus)),
                h('div', { className: 'tl-rival-preview' },
                    h('div', null, h('span', { className: 'tl-label' }, playMode === 'friends' ? 'Your league' : 'Your AI rivals'), h('b', null, `${seats.length} teams · ${capacity} roster spots each`)),
                    h('div', { className: 'tl-rival-stack' }, opponentSeats.slice(0, 7).map((seat, index) => h('span', { key: `${seat.name}:${index}`, title: seat.name },
                        h(window.TimeLeagueHelmetIcon, { helmet: seat.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(seat.name), size: 31 }))),
                    h('div', { className: 'tl-team-count' },
                        h('button', { type: 'button', disabled: seats.length <= 2, 'aria-label': 'Remove last team', onClick: () => removeSeat(seats.length - 1) }, '−'),
                        h('strong', { className: 'tabular' }, seats.length),
                        h('button', { type: 'button', disabled: seats.length >= 12, 'aria-label': 'Add team', onClick: addSeat }, '+'))))),

            h('details', { className: 'tl-advanced' },
                h('summary', null, h('span', null, '⚙ Customize league rules'), h('small', null, 'Managers, scoring, rosters, waivers and trades')),
                h('div', { className: 'tl-advanced-body' },
                    h('div', { className: 'tl-field' },
                        h('span', { className: 'tl-label' }, `Managers · ${humanSeats} human · ${seats.length - humanSeats} AI`),
                        seats.map((seat, index) => h('div', { key: index, className: 'tl-seat-row' },
                            h('span', { className: 'tl-label' }, index === 0 ? 'YOU' : `T${index + 1}`),
                            h(window.TimeLeagueHelmetPicker, { helmet: seat.helmet, name: seat.name, letter: window.App.TimeLeagueHelmet.monogramFor(seat.name), onChange: (helmet) => updateSeat(index, { helmet }) }),
                            h('input', { className: 'tl-input', 'aria-label': `Team ${index + 1} name`, value: seat.name, maxLength: 60, placeholder: `Manager ${index + 1}`, onChange: (event) => updateSeat(index, { name: event.target.value }) }),
                            h('select', { className: 'tl-select tl-seat-manager', 'aria-label': `Team ${index + 1} manager type`, disabled: index === 0, value: seat.manager, onChange: (event) => updateSeat(index, { manager: event.target.value === 'ai' ? 'ai' : 'human' }) },
                                h('option', { value: 'human' }, 'HUMAN'), h('option', { value: 'ai' }, 'AI')),
                            seat.manager === 'ai'
                                ? h('select', { className: 'tl-select tl-seat-personality', 'aria-label': `Team ${index + 1} personality`, value: seat.aiPersona, onChange: (event) => updateSeat(index, { aiPersona: window.TimeLeagueUtils.PERSONA_IDS.includes(event.target.value) ? event.target.value : 'steward' }) },
                                    window.TimeLeagueUtils.PERSONA_IDS.map((id) => h('option', { key: id, value: id }, AI.AI_PERSONAS[id].label)))
                                : h('span', { className: 'tl-pill info' }, index === 0 ? 'COMMISSIONER' : 'INVITE'),
                            h('button', { type: 'button', className: 'tl-btn icon', disabled: seats.length <= 2 || index === 0, 'aria-label': `Remove team ${index + 1}`, onClick: () => removeSeat(index) }, '✕')))),
                    seats.some((seat) => seat.manager === 'ai') && h('div', { className: 'tl-field' },
                        h('span', { className: 'tl-label' }, 'AI difficulty'),
                        h('div', { className: 'tl-chip-row' }, Object.keys(AI.AI_DIFFICULTY_LABELS).map((id) => {
                            const tier = AI.AI_DIFFICULTY_LABELS[id];
                            return h('button', { key: id, type: 'button', className: `tl-opt-chip${aiDifficulty === id ? ' selected' : ''}`, onClick: () => setAiDifficulty(id) },
                                h('strong', null, tier.label), h('span', { className: 'tl-opt-detail' }, tier.blurb));
                        })),
                        h(PersonalityGuide)),
                    h('div', { className: 'tl-rules-grid' },
                        h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'Roster size'),
                            h('select', { className: 'tl-select', value: rosterPreset, onChange: (event) => { setRosterPreset(event.target.value); setCustomSlots(null); } }, ROSTER_PRESET_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label))),
                            h('small', null, rosterOption.detail)),
                        h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'Scoring'),
                            h('select', { className: 'tl-select', value: scoringPreset, onChange: (event) => { setScoringPreset(event.target.value); setCustomStats({}); setCustomExtended(null); } }, SCORING_PRESET_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label))),
                            h('small', null, scoringOption.detail))),
                    h('details', { className: 'tl-custom-rules' }, h('summary', null, `Customize roster · ${capacity} slots`),
                        h('div', { className: 'tl-custom-grid' }, window.App.TimeLeagueRoster.ROSTER_SLOT_IDS.filter(slot => !['DL', 'LB', 'DB', 'IDP_FLEX', 'IR', 'TAXI', 'REC_FLEX'].includes(slot)).map(slot => h('label', { key: slot }, h('span', null, slot),
                            h('input', { className: 'tl-input', type: 'number', min: 0, max: 12, step: 1, value: settings.rosterSlots[slot] || 0, onChange: event => setCustomSlots({ ...settings.rosterSlots, [slot]: Math.max(0, Math.min(12, Math.floor(Number(event.target.value) || 0))) }) })))),
                        h('label', null, 'Maximum quarterbacks on a roster', h('input', { className: 'tl-input', type: 'number', min: Math.max(0, settings.rosterSlots.QB || 0), max: 12, value: settings.maxQuarterbacks, onChange: event => setQbLimit(Math.max(0, Math.min(12, Number(event.target.value) || 0))) })),
                        h('p', { className: 'tl-hint' }, 'Set any slot to zero to leave it out. Kicker and team defense eras start in 2000.')),
                    h('details', { className: 'tl-custom-rules' }, h('summary', null, 'Customize scoring · points per stat'),
                        h('div', { className: 'tl-custom-grid' }, [
                            ['passYd','Passing yard',scoringOption.scoring.passingYd], ['passTd','Passing TD',scoringOption.scoring.passTd], ['passInt','Interception thrown',scoringOption.scoring.turnover],
                            ['rushYd','Rushing yard',scoringOption.scoring.rushRecYd], ['rushTd','Rushing TD',6], ['rec','Reception',scoringOption.scoring.reception],
                            ['recYd','Receiving yard',scoringOption.scoring.rushRecYd], ['recTd','Receiving TD',6], ['fumblesLost','Fumble lost',scoringOption.scoring.turnover], ['twoPointConversions','Two-point conversion',2]
                        ].map(([key,label,fallback]) => h('label', { key }, h('span', null, label), h('input', { className: 'tl-input', type: 'number', step: 'any', value: customStats[key] ?? fallback, onChange: event => { const value = Number(event.target.value); if (Number.isFinite(value)) setCustomStats({ ...customStats, [key]: value }); } })))),
                        h('details', null, h('summary', null, 'Kicking & team defense'),
                            h('p', { className: 'tl-hint' }, 'Team defense scores sacks, takeaways, touchdowns and safeties. Points-allowed tiers are not available. Only stats present in historical game logs can score. Total field goals and distance bands overlap: use one method to avoid double-counting.'),
                            h('p', { className: 'tl-hint' }, 'Yardage bonuses stack when multiple thresholds are reached.'), h('div', { className: 'tl-custom-grid' }, bonuses.map((bonus, index) => h('label', { key: index }, h('span', null, `${bonus.threshold} ${bonus.stat === 'passYd' ? 'passing' : bonus.stat === 'rushYd' ? 'rushing' : 'receiving'} yards bonus`), h('input', { className: 'tl-input', type: 'number', step: 'any', value: bonus.points, onChange: event => { const points = Number(event.target.value); if (Number.isFinite(points)) setBonuses(bonuses.map((b,i) => i === index ? { ...b, points } : b)); } })))), h('div', { className: 'tl-custom-grid' }, window.App.TimeLeagueSeason.EXTENDED_STAT_IDS.filter(key => !key.startsWith('idp_')).map(key => h('label', { key }, h('span', null, ({ fgm: 'Field goal made (total)', fgmiss: 'Field goal missed (total)', xpm: 'Extra point made', xpmiss: 'Extra point missed', sack: 'Defense sack', int: 'Defense interception', ff: 'Defense forced fumble', fr: 'Defense fumble recovery', def_td: 'Defense touchdown', def_st_td: 'Special teams touchdown', safe: 'Defense safety' }[key] || key.replace('fgmiss_', 'Field goal missed ').replace('fgm_', 'Field goal made ').replace('idp_', 'IDP ').replace('tkl_solo','solo tackle').replace('tkl_ast','assisted tackle').replace('tkl_loss','tackle for loss').replace('pass_def','pass defended').replace(/_/g, ' ').replace('50p','50+ yards'))), h('input', { className: 'tl-input', type: 'number', step: 'any', value: (customExtended || window.App.TimeLeagueSeason.REFERENCE_EXTENDED_SCORING)[key] ?? 0, onChange: event => { const value = Number(event.target.value); if (Number.isFinite(value)) setCustomExtended({ ...(customExtended || window.App.TimeLeagueSeason.REFERENCE_EXTENDED_SCORING), [key]: value }); } }))))),
                        h('p', { className: 'tl-hint' }, 'Positive values award points; negative values deduct points. Preset selection resets custom scoring. Custom rules apply to game results; archive card totals remain reference values.')),
                    h('div', { className: 'tl-toggle-grid' },
                        h('label', { className: 'tl-toggle' }, h('input', { type: 'checkbox', checked: eraAdjusted, onChange: (event) => setEraAdjusted(event.target.checked) }),
                            h('span', null, h('b', null, 'Era-adjusted scoring'), h('small', null, 'Normalize production across decades.'))),
                        h('label', { className: 'tl-toggle' }, h('input', { type: 'checkbox', checked: waiversEnabled, onChange: (event) => setWaiversEnabled(event.target.checked) }),
                            h('span', null, h('b', null, 'Waivers'), h('small', null, waiverMode === 'faab' ? `$${faabBudget} blind-bid budget.` : 'Worst record claims first.'))),
                        h('label', { className: 'tl-toggle' }, h('input', { type: 'checkbox', checked: tradesEnabled, onChange: (event) => setTradesEnabled(event.target.checked) }),
                            h('span', null, h('b', null, 'Trades'), h('small', null, 'Negotiate with human and AI rivals.')))),
                    waiversEnabled && h('div', { className: 'tl-waiver-options' },
                        h('button', { type: 'button', className: waiverMode === 'priority' ? 'selected' : '', onClick: () => setWaiverMode('priority') }, 'PRIORITY'),
                        h('button', { type: 'button', className: waiverMode === 'faab' ? 'selected' : '', onClick: () => setWaiverMode('faab') }, 'FAAB'),
                        waiverMode === 'faab' && h('label', null, 'BUDGET $', h('input', { className: 'tl-input', type: 'number', min: 0, max: 1000, value: faabBudget, onChange: (event) => setFaabBudget(Math.max(0, Math.min(1000, Math.round(Number(event.target.value)) || 0))) }))))),

            createError && h('div', { role: 'alert', className: 'tl-feedrow caution tl-create-error' }, h('time', null, 'TRY AGAIN'), h('p', null, createError)),
            h('div', { className: 'tl-launch-bar' },
                h('div', null,
                    h('span', { className: `tl-era-icon ${selectedEra.tone}` }, selectedEra.icon),
                    h('p', null, h('b', null, `${selectedEra.label} · ${seats.length} teams`), h('span', null, `${DRAFT_FORMATS.find(format => format.id === draftFormat).label} · ${seats.length * capacity} players drafted · 14 gameweeks`))),
                h('button', { type: 'button', className: 'tl-btn primary tl-launch-btn', onClick: startLeague, disabled: creating || capacity === 0 || !Object.entries(settings.rosterSlots).some(([slot,count]) => !['BN','IR','TAXI'].includes(slot) && count > 0) || (origin === 'online' && !signedIn) },
                    creating ? 'CREATING LEAGUE…' : playMode === 'friends' ? 'CREATE & INVITE →' : 'START SOLO DRAFT →')));
    }

    function WrTimeLeagueSetupPanel({ index, onOpen, onDelete, onCreate, onlineIndex, onlineIndexState, onOpenOnline, onCreateOnline }) {
        return h('div', { className: 'tl-vault-lobby' },
            h(VaultHero, null),
            h(LeagueShelf, { index, onlineIndex, onOpen, onDelete, onOpenOnline }),
            h(LeagueBuilder, { key: window.App.OD?.getCurrentUserId?.() || 'guest', onCreate, onCreateOnline, onOpenOnline, onlineIndexState }));
    }

    window.WrTimeLeagueSetupPanel = WrTimeLeagueSetupPanel;
})();
