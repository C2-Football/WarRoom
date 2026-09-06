// ══════════════════════════════════════════════════════════════════
// js/components/time-league-setup-panel.js — window.WrTimeLeagueSetupPanel
// Player-first lobby and league builder for The Vault. The first choice is
// now the way somebody wants to play (solo or with friends); commissioner
// details remain available without blocking the fast path into a draft.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useState, useMemo } = React;
    const h = React.createElement;

    const EraRules = window.App.TimeLeagueEraRules;
    const Engine = window.App.TimeLeagueEngine;
    const AI = window.App.TimeLeagueAI;

    const ROSTER_PRESET_OPTIONS = [
        { id: 'compact', label: 'Compact', detail: 'QB1 · RB1 · WR1 · FLEX1 · BN2', slots: { QB: 1, RB: 1, WR: 1, FLEX: 1, BN: 2 } },
        { id: 'standard', label: 'Standard', detail: 'QB1 · RB2 · WR2 · TE1 · FLEX1 · BN3', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 3 } },
        { id: 'deep', label: 'Deep', detail: 'QB1 · RB2 · WR3 · TE1 · FLEX2 · BN5', slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, BN: 5 } },
        { id: 'full', label: 'Full squad', detail: 'QB1 · RB2 · WR2 · TE1 · FLEX1 · K1 · DEF1 · BN3', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 3 } },
    ];
    const SCORING_PRESET_OPTIONS = [
        { id: 'half', label: 'Half-PPR', detail: '4 pass TD · 0.5/rec · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
        { id: 'ppr', label: 'Full PPR', detail: '4 pass TD · 1.0/rec · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 1, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
        { id: 'standard', label: 'Standard', detail: '4 pass TD · no PPR · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 0, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
    ];
    const ERA_MODE_OPTIONS = [
        { id: 'any-era', icon: '∞', label: 'All-Era Classic', eyebrow: 'THE FULL VAULT', blurb: 'Every season since 1970 can be drawn.', tone: 'classic' },
        { id: 'selected-decades', icon: '◫', label: 'Decade Draft', eyebrow: 'YOUR FOOTBALL ERA', blurb: 'Choose which decades make the player pool.', tone: 'decades' },
        { id: 'position-roulette', icon: '✦', label: 'Position Roulette', eyebrow: 'CHAOS MODE', blurb: 'Every position is dealt a surprise decade.', tone: 'roulette' },
    ];

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

    function VaultHero() {
        const [revealed, setRevealed] = useState(false);
        const years = ['1970', '1985', '1999', '2012', '2025'];
        return h('section', { className: 'tl-lobby-hero' },
            h('div', { className: 'tl-lobby-copy' },
                h('div', { className: 'tl-hero-kicker' }, h('span', null, '✦'), ' FANTASY FOOTBALL · UNLOCKED'),
                h('h1', null, 'Draft legends.', h('br'), h('em', null, 'Rewrite Sundays.')),
                h('p', null, 'Build a fantasy roster from any NFL season since 1970, then play a full season against rival GMs—solo or live with friends.'),
                h('div', { className: 'tl-hero-proof' },
                    h('span', null, h('b', null, '50+'), ' seasons'),
                    h('span', null, h('b', null, '14'), ' gameweeks'),
                    h('span', null, h('b', null, '1'), ' champion'))),
            h('div', { className: `tl-lobby-visual${revealed ? ' revealed' : ''}` },
                h('div', { className: 'tl-stadium-glow' }),
                h('div', { className: 'tl-visual-score' },
                    h('span', { className: 'live' }, 'TRY THE VAULT · SAMPLE REVEAL'),
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
        return h('button', { type: 'button', 'aria-pressed': selected, className: `tl-play-mode${selected ? ' selected' : ''}`, onClick },
            h('span', { className: 'tl-play-icon' }, friends ? '◆' : '⚡'),
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
            option.id === 'position-roulette' && h('span', { className: 'tl-mode-badge' }, 'MOST FUN'));
    }

    function InviteScreen({ founded, onOpenOnline }) {
        const linkFor = (code) => `${window.location.origin}${window.location.pathname}?tl_invite=${code}`;
        return h('section', { className: 'tl-builder tl-invite-screen' },
            h('div', { className: 'tl-invite-lockup' }, h('span', null, '✓'), h('div', null,
                h('span', { className: 'tl-eyebrow' }, 'LEAGUE CREATED'),
                h('h2', null, 'Bring in your rivals'))),
            h('p', null, 'Each seat has its own invite link. Send one to every friend, then enter the draft room whenever you are ready.'),
            founded.members.length === 0
                ? h('div', { className: 'tl-empty-state' }, 'No open friend seats—this league is ready to play across your own devices.')
                : h('div', { className: 'tl-invite-list' }, founded.members.map((member, index) => h('div', { key: member.id, className: 'tl-invite-row' },
                    h('span', { className: 'tl-invite-number' }, String(index + 1).padStart(2, '0')),
                    h('div', null, h('b', null, `MANAGER ${index + 2}`), h('small', null, `SEAT ${member.seat_team_id.toUpperCase()}`)),
                    h('input', { className: 'tl-input', readOnly: true, value: linkFor(member.invite_code), onFocus: (event) => event.target.select() }),
                    h('button', { type: 'button', className: 'tl-btn', onClick: () => navigator.clipboard && navigator.clipboard.writeText(linkFor(member.invite_code)) }, 'COPY LINK')))),
            h('button', { type: 'button', className: 'tl-btn primary tl-launch-btn', onClick: () => onOpenOnline(founded.rowId) }, 'ENTER THE DRAFT ROOM →'));
    }

    function LeagueBuilder({ onCreate, onCreateOnline, onOpenOnline, onlineIndexState }) {
        const [playMode, setPlayMode] = useState('solo');
        const [founded, setFounded] = useState(null);
        const [creating, setCreating] = useState(false);
        const [createError, setCreateError] = useState(null);
        const [name, setName] = useState('');
        const [seats, setSeats] = useState(() => defaultSeatsFor('solo'));
        const [rosterPreset, setRosterPreset] = useState('standard');
        const [scoringPreset, setScoringPreset] = useState('half');
        const [eraAdjusted, setEraAdjusted] = useState(false);
        const [eraMode, setEraMode] = useState('position-roulette');
        const [eraDecades, setEraDecades] = useState([]);
        const [waiversEnabled, setWaiversEnabled] = useState(true);
        const [waiverMode, setWaiverMode] = useState('priority');
        const [faabBudget, setFaabBudget] = useState(100);
        const [tradesEnabled, setTradesEnabled] = useState(true);
        const [aiDifficulty, setAiDifficulty] = useState('veteran');

        const origin = playMode === 'friends' ? 'online' : 'local';
        const rosterOption = ROSTER_PRESET_OPTIONS.find((option) => option.id === rosterPreset) ?? ROSTER_PRESET_OPTIONS[1];
        const scoringOption = SCORING_PRESET_OPTIONS.find((option) => option.id === scoringPreset) ?? SCORING_PRESET_OPTIONS[0];
        const eraRules = useMemo(() => ({
            mode: eraMode,
            decades: eraMode === 'any-era' ? [] : EraRules.ERA_DECADES.filter((decade) => eraDecades.includes(decade.id)).map((decade) => decade.id),
        }), [eraMode, eraDecades]);
        const settings = useMemo(() => ({
            rosterSlots: rosterOption.slots,
            scoring: scoringOption.scoring,
            regularSeasonWeeks: window.TimeLeagueUtils.REGULAR_SEASON_WEEKS,
            maxQuarterbacks: window.TimeLeagueUtils.MAX_QUARTERBACKS,
            eraAdjusted, eraRules, waiversEnabled, waiverMode, faabBudget, tradesEnabled, aiDifficulty,
        }), [rosterOption, scoringOption, eraAdjusted, eraRules, waiversEnabled, waiverMode, faabBudget, tradesEnabled, aiDifficulty]);
        const capacity = Engine.rosterCapacity(settings);
        const humanSeats = seats.filter((seat) => seat.manager === 'human').length;
        const signedIn = onlineIndexState !== 'signed-out' && Boolean(window.App.OD && window.App.OD.getCurrentUserId && window.App.OD.getCurrentUserId());

        const choosePlayMode = (nextMode) => {
            if (nextMode === playMode) return;
            setPlayMode(nextMode);
            setCreateError(null);
            setSeats((previous) => defaultSeatsFor(nextMode).map((seat, index) => index === 0 ? { ...seat, name: previous[0].name, helmet: previous[0].helmet } : seat));
        };
        const updateSeat = (target, patch) => setSeats((previous) => previous.map((seat, index) => (index === target ? { ...seat, ...patch } : seat)));
        const addSeat = () => setSeats((previous) => {
            if (previous.length >= 12) return previous;
            const seatName = playMode === 'friends' ? `Friend ${previous.length}` : `Rival ${previous.length}`;
            return [...previous, {
                name: seatName,
                manager: playMode === 'friends' ? 'human' : 'ai',
                aiPersona: window.TimeLeagueUtils.PERSONA_IDS[previous.length % 4],
                helmet: window.App.TimeLeagueHelmet.defaultHelmet(seatName),
            }];
        });
        const removeSeat = (target) => setSeats((previous) => (previous.length <= 2 ? previous : previous.filter((seat, index) => index !== target)));
        const toggleDecade = (id) => setEraDecades((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

        const startLeague = async () => {
            const built = seats.map((seat, index) => ({
                name: seat.name.trim() || (index === 0 ? 'My Team' : `Manager ${index + 1}`),
                manager: seat.manager,
                ...(seat.manager === 'ai' ? { aiPersona: seat.aiPersona } : {}),
                helmet: seat.helmet,
            }));
            const leagueName = name.trim() || (playMode === 'friends' ? 'Sunday Time Machine' : 'My Vault Season');
            if (origin === 'local') {
                onCreate({ name: leagueName, seats: built, settings });
                return;
            }
            setCreating(true);
            setCreateError(null);
            const result = await onCreateOnline({ name: leagueName, seats: built, settings });
            setCreating(false);
            if (!result.ok) {
                setCreateError(result.error || 'Could not create the league.');
                return;
            }
            setFounded({ rowId: result.rowId, members: result.members });
        };

        if (founded) return h(InviteScreen, { founded, onOpenOnline });

        const selectedEra = ERA_MODE_OPTIONS.find((option) => option.id === eraMode) ?? ERA_MODE_OPTIONS[2];
        const opponentSeats = seats.slice(1);
        return h('section', { className: 'tl-builder' },
            h('div', { className: 'tl-builder-head' },
                h('div', null, h('span', { className: 'tl-eyebrow' }, 'NEW LEAGUE'), h('h2', null, 'Start your season')),
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
                    h('a', { className: 'tl-btn', href: 'login.html' }, 'SIGN IN'))),

            h('div', { className: 'tl-builder-section', id: 'vault-setup-1' },
                h('div', { className: 'tl-question' }, h('span', null, '2'), h('div', null, h('h3', null, 'Pick the time-travel twist'), h('p', null, 'You draft the player. The Vault reveals the season.'))),
                h('div', { className: 'tl-era-mode-grid' }, ERA_MODE_OPTIONS.map((option) => h(EraModeCard, {
                    key: option.id, option, selected: eraMode === option.id, onClick: () => setEraMode(option.id),
                }))),
                eraMode !== 'any-era' && h('div', { className: 'tl-decade-picker' },
                    h('div', null, h('b', null, eraMode === 'position-roulette' ? 'Roulette pool' : 'Draftable decades'), h('small', null, eraDecades.length ? `${eraDecades.length} selected` : 'All decades included')),
                    h('div', { className: 'tl-decade-row' }, EraRules.ERA_DECADES.map((decade) => h('button', {
                        key: decade.id, type: 'button', className: eraDecades.includes(decade.id) ? 'selected' : '', onClick: () => toggleDecade(decade.id),
                    }, decade.label))))),

            h('div', { className: 'tl-builder-section', id: 'vault-setup-2' },
                h('div', { className: 'tl-question' }, h('span', null, '3'), h('div', null, h('h3', null, 'Name your team. Build your helmet.'), h('p', null, 'Choose a retro identity, then take the ready-to-play defaults or tune every rule below.'))),
                h('div', { className: 'tl-identity-grid' },
                    h('label', null, h('span', { className: 'tl-label' }, 'League name'), h('input', { className: 'tl-input', value: name, placeholder: playMode === 'friends' ? 'Sunday Time Machine' : 'My Vault Season', onChange: (event) => setName(event.target.value) })),
                    h('label', null, h('span', { className: 'tl-label' }, 'Your team & helmet'), h('span', { className: 'tl-team-input' },
                        h(window.TimeLeagueHelmetPicker, { helmet: seats[0].helmet, name: seats[0].name, letter: window.App.TimeLeagueHelmet.monogramFor(seats[0].name), onChange: (helmet) => updateSeat(0, { helmet }) }),
                        h('input', { className: 'tl-input', value: seats[0].name, placeholder: 'Name your team', onChange: (event) => updateSeat(0, { name: event.target.value }) })))),
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
                            h('input', { className: 'tl-input', value: seat.name, placeholder: `Manager ${index + 1}`, onChange: (event) => updateSeat(index, { name: event.target.value }) }),
                            h('select', { className: 'tl-select', value: seat.manager, onChange: (event) => updateSeat(index, { manager: event.target.value === 'ai' ? 'ai' : 'human' }) },
                                h('option', { value: 'human' }, 'HUMAN'), h('option', { value: 'ai' }, 'AI')),
                            seat.manager === 'ai'
                                ? h('select', { className: 'tl-select', value: seat.aiPersona, onChange: (event) => updateSeat(index, { aiPersona: window.TimeLeagueUtils.PERSONA_IDS.includes(event.target.value) ? event.target.value : 'steward' }) },
                                    window.TimeLeagueUtils.PERSONA_IDS.map((id) => h('option', { key: id, value: id }, AI.AI_PERSONAS[id].label)))
                                : h('span', { className: 'tl-pill info' }, index === 0 ? 'COMMISSIONER' : 'INVITE'),
                            h('button', { type: 'button', className: 'tl-btn icon', disabled: seats.length <= 2, 'aria-label': `Remove team ${index + 1}`, onClick: () => removeSeat(index) }, '✕')))),
                    seats.some((seat) => seat.manager === 'ai') && h('div', { className: 'tl-field' },
                        h('span', { className: 'tl-label' }, 'AI difficulty'),
                        h('div', { className: 'tl-chip-row' }, Object.keys(AI.AI_DIFFICULTY_LABELS).map((id) => {
                            const tier = AI.AI_DIFFICULTY_LABELS[id];
                            return h('button', { key: id, type: 'button', className: `tl-opt-chip${aiDifficulty === id ? ' selected' : ''}`, onClick: () => setAiDifficulty(id) },
                                h('strong', null, tier.label), h('span', { className: 'tl-opt-detail' }, tier.blurb));
                        })),
                        h('div', { className: 'tl-persona-grid' }, window.TimeLeagueUtils.PERSONA_IDS.map((id) => {
                            const persona = AI.AI_PERSONAS[id];
                            return h('div', { key: id, className: 'tl-persona-card' },
                                h('div', null, h('strong', null, persona.label), h('span', { className: 'tl-pill' }, id.toUpperCase())),
                                h(PersonaMeterRow, { label: 'AGGR', value: persona.aggression }),
                                h(PersonaMeterRow, { label: 'PATIENCE', value: persona.patience }),
                                h(PersonaMeterRow, { label: 'RISK', value: persona.riskTolerance }),
                                h('p', null, persona.tell));
                        }))),
                    h('div', { className: 'tl-rules-grid' },
                        h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'Roster size'),
                            h('select', { className: 'tl-select', value: rosterPreset, onChange: (event) => setRosterPreset(event.target.value) }, ROSTER_PRESET_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label))),
                            h('small', null, rosterOption.detail)),
                        h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'Scoring'),
                            h('select', { className: 'tl-select', value: scoringPreset, onChange: (event) => setScoringPreset(event.target.value) }, SCORING_PRESET_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label))),
                            h('small', null, scoringOption.detail))),
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

            createError && h('div', { className: 'tl-feedrow caution tl-create-error' }, h('time', null, 'ERROR'), h('p', null, createError)),
            h('div', { className: 'tl-launch-bar' },
                h('div', null,
                    h('span', { className: `tl-era-icon ${selectedEra.tone}` }, selectedEra.icon),
                    h('p', null, h('b', null, `${selectedEra.label} · ${seats.length} teams`), h('span', null, `${seats.length * capacity} draft picks · ${window.TimeLeagueUtils.REGULAR_SEASON_WEEKS}-week season`))),
                h('button', { type: 'button', className: 'tl-btn primary tl-launch-btn', onClick: startLeague, disabled: creating || (origin === 'online' && !signedIn) },
                    creating ? 'CREATING LEAGUE…' : playMode === 'friends' ? 'CREATE & INVITE →' : 'START SOLO DRAFT →')));
    }

    function WrTimeLeagueSetupPanel({ index, onOpen, onDelete, onCreate, onlineIndex, onlineIndexState, onOpenOnline, onCreateOnline }) {
        return h('div', { className: 'tl-vault-lobby' },
            h(VaultHero, null),
            h(LeagueShelf, { index, onlineIndex, onOpen, onDelete, onOpenOnline }),
            h(LeagueBuilder, { onCreate, onCreateOnline, onOpenOnline, onlineIndexState }));
    }

    window.WrTimeLeagueSetupPanel = WrTimeLeagueSetupPanel;
})();
