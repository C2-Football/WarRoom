// ══════════════════════════════════════════════════════════════════
// js/components/time-league-setup-panel.js — window.WrTimeLeagueSetupPanel
// The League Ledger (existing leagues, this device only) + the Found a
// League wizard. Ported from the LobbyScreen portion of The Duat's
// app/TimeLeagueView.tsx.
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
        { id: 'idp', label: 'IDP', detail: 'QB1 · RB2 · WR2 · TE1 · FLEX1 · K1 · DEF1 · DL1 · LB1 · DB1 · BN4', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, DL: 1, LB: 1, DB: 1, BN: 4 } },
    ];
    const SCORING_PRESET_OPTIONS = [
        { id: 'half', label: 'Half-PPR', detail: '4 pass TD · 0.5/rec · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
        { id: 'ppr', label: 'Full PPR', detail: '4 pass TD · 1.0/rec · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 1, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
        { id: 'standard', label: 'Standard', detail: '4 pass TD · no PPR · 0.1/rush-rec yd · 0.04/pass yd · -2 TO', scoring: { passTd: 4, reception: 0, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 } },
    ];
    const ERA_MODE_OPTIONS = [
        { id: 'any-era', label: 'Any Era', blurb: 'Every season since the 1970 merger is on the board.' },
        { id: 'selected-decades', label: 'Selected Decades', blurb: 'Lock the draftable pool to the decades you pick — league-wide.' },
        { id: 'position-roulette', label: 'Position Roulette', blurb: 'Each position group is dealt a random decade the moment the league is founded.' },
    ];

    function PersonaMeterRow({ label, value }) {
        const clamped = Math.max(0, Math.min(100, value));
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 } },
            h('span', { className: 'tl-label', style: { width: 62, flex: 'none' } }, label),
            h('span', { style: { flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 100, overflow: 'hidden' } },
                h('span', { style: { display: 'block', height: '100%', width: `${clamped}%`, background: 'var(--gold)' } })),
            h('span', { className: 'tabular', style: { width: 24, textAlign: 'right', color: 'var(--text-muted)' } }, clamped));
    }

    function LeagueLedger({ index, onOpen, onDelete }) {
        const [pendingDelete, setPendingDelete] = useState(null);
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'League Ledger'), h('small', null, 'this device only · nothing syncs')),
            index.length === 0
                ? h('p', { className: 'tl-empty' }, 'No Time Leagues on this device yet. Found one on the right.')
                : h('table', { className: 'tl-tbl' },
                    h('thead', null, h('tr', null, h('th', null, 'League'), h('th', null, 'Phase'), h('th', { className: 'num' }, 'WK'), h('th', { className: 'num' }, 'Seats'), h('th', null, 'Command'))),
                    h('tbody', null, index.map((entry) => h('tr', { key: entry.leagueId },
                        h('td', null, entry.name),
                        h('td', null, h('span', { className: `tl-pill ${entry.phase === 'draft' ? 'warn' : entry.phase === 'season' ? 'info' : 'gold'}` }, entry.phase.toUpperCase())),
                        h('td', { className: 'num tabular' }, Math.min(entry.currentWeek, window.TimeLeagueUtils.REGULAR_SEASON_WEEKS)),
                        h('td', { className: 'num tabular' }, entry.teamCount),
                        h('td', null, pendingDelete === entry.leagueId
                            ? h(React.Fragment, null,
                                h('button', { type: 'button', className: 'tl-btn danger', onClick: () => { onDelete(entry.leagueId); setPendingDelete(null); } }, 'CONFIRM DELETE'),
                                h('button', { type: 'button', className: 'tl-btn', onClick: () => setPendingDelete(null) }, 'KEEP'))
                            : h(React.Fragment, null,
                                h('button', { type: 'button', className: 'tl-btn', onClick: () => onOpen(entry.leagueId) }, 'OPEN'),
                                h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': `Delete ${entry.name}`, onClick: () => setPendingDelete(entry.leagueId) }, '✕'))))))));
    }

    function FoundLeague({ onCreate }) {
        const [name, setName] = useState('');
        const [seats, setSeats] = useState(window.TimeLeagueUtils.defaultSeats);
        const [rosterPreset, setRosterPreset] = useState('standard');
        const [scoringPreset, setScoringPreset] = useState('half');
        const [eraAdjusted, setEraAdjusted] = useState(false);
        const [eraMode, setEraMode] = useState('any-era');
        const [eraDecades, setEraDecades] = useState([]);
        const [waiversEnabled, setWaiversEnabled] = useState(true);
        const [tradesEnabled, setTradesEnabled] = useState(true);

        const rosterOption = ROSTER_PRESET_OPTIONS.find((o) => o.id === rosterPreset) ?? ROSTER_PRESET_OPTIONS[1];
        const scoringOption = SCORING_PRESET_OPTIONS.find((o) => o.id === scoringPreset) ?? SCORING_PRESET_OPTIONS[0];
        const eraRules = useMemo(() => ({
            mode: eraMode,
            decades: eraMode === 'any-era' ? [] : EraRules.ERA_DECADES.filter((d) => eraDecades.includes(d.id)).map((d) => d.id),
        }), [eraMode, eraDecades]);
        const settings = useMemo(() => ({
            rosterSlots: rosterOption.slots, scoring: scoringOption.scoring,
            regularSeasonWeeks: window.TimeLeagueUtils.REGULAR_SEASON_WEEKS, maxQuarterbacks: window.TimeLeagueUtils.MAX_QUARTERBACKS,
            eraAdjusted, eraRules, waiversEnabled, tradesEnabled,
        }), [rosterOption, scoringOption, eraAdjusted, eraRules, waiversEnabled, tradesEnabled]);
        const capacity = Engine.rosterCapacity(settings);
        const humanSeats = seats.filter((s) => s.manager === 'human').length;
        const toggleDecade = (id) => setEraDecades((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
        const eraHint = eraMode === 'position-roulette'
            ? (eraRules.decades.length ? 'The roulette deals only from these decades — every one is spent before any repeats.' : 'Leave the pool empty and the roulette deals from all six decades.')
            : (eraRules.decades.length ? 'Only seasons inside these decades can be drawn at the draft.' : 'Nothing picked yet — the league would draft from every era.');

        const updateSeat = (target, patch) => setSeats((prev) => prev.map((s, i) => (i === target ? { ...s, ...patch } : s)));
        const addSeat = () => setSeats((prev) => (prev.length >= 12 ? prev : [...prev, { name: `Seat ${prev.length + 1}`, manager: 'ai', aiPersona: window.TimeLeagueUtils.PERSONA_IDS[prev.length % 4] }]));
        const removeSeat = (target) => setSeats((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== target)));

        const found = () => {
            const built = seats.map((seat, i) => (seat.manager === 'ai'
                ? { name: seat.name.trim() || `Seat ${i + 1}`, manager: 'ai', aiPersona: seat.aiPersona }
                : { name: seat.name.trim() || `Seat ${i + 1}`, manager: 'human' }));
            onCreate({ name: name.trim() || 'Time League', seats: built, settings });
        };

        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' },
                h('span', null, 'Found a League'),
                h('small', null, `${seats.length} seats · ${capacity} roster spots · ${seats.length * capacity} picks · ${window.TimeLeagueUtils.REGULAR_SEASON_WEEKS} weeks`)),

            h('div', { className: 'tl-field' },
                h('span', { className: 'tl-label' }, 'League Name'),
                h('input', { className: 'tl-input', value: name, placeholder: 'The All-Era Invitational', onChange: (e) => setName(e.target.value) })),

            h('div', { className: 'tl-field' },
                h('span', { className: 'tl-label' }, 'Era of Play'),
                h('div', { className: 'tl-chip-row' }, ERA_MODE_OPTIONS.map((option) => h('button', {
                    key: option.id, type: 'button', className: `tl-opt-chip${eraMode === option.id ? ' selected' : ''}`, style: { flex: '1 1 160px' },
                    onClick: () => setEraMode(option.id),
                }, h('strong', { style: { display: 'block' } }, option.label), h('span', { className: 'tl-opt-detail' }, option.blurb)))),
                eraMode !== 'any-era' && h('div', { style: { marginTop: 10 } },
                    h('span', { className: 'tl-label' }, eraMode === 'position-roulette' ? 'Roulette Pool' : 'Draftable Decades'),
                    h('div', { className: 'tl-chip-row', style: { marginTop: 6 } }, EraRules.ERA_DECADES.map((decade) => h('button', {
                        key: decade.id, type: 'button', className: `tl-opt-chip${eraDecades.includes(decade.id) ? ' selected' : ''}`,
                        onClick: () => toggleDecade(decade.id),
                    }, h('strong', null, decade.label), ' ', h('span', { className: 'tl-opt-detail', style: { display: 'inline' } }, `${decade.from}–${decade.to}`)))),
                    h('p', { className: 'tl-hint', style: { marginTop: 6 } }, eraHint)),
                h(window.TimeLeagueEraChipRail, { label: 'Live Rule', chips: EraRules.eraRuleChips(eraRules) })),

            h('div', { className: 'tl-field' },
                h('span', { className: 'tl-label' }, `Seats (${seats.length}/12) · ${humanSeats} hotseat human${humanSeats === 1 ? '' : 's'}`),
                seats.map((seat, i) => h('div', { key: i, className: 'tl-seat-row' },
                    h('span', { className: 'tl-label' }, `S${i + 1}`),
                    h('input', { className: 'tl-input', value: seat.name, placeholder: `Seat ${i + 1}`, onChange: (e) => updateSeat(i, { name: e.target.value }) }),
                    h('select', { className: 'tl-select', value: seat.manager, onChange: (e) => updateSeat(i, { manager: e.target.value === 'ai' ? 'ai' : 'human' }) },
                        h('option', { value: 'human' }, 'HUMAN'), h('option', { value: 'ai' }, 'AI')),
                    seat.manager === 'ai'
                        ? h('select', { className: 'tl-select', value: seat.aiPersona, onChange: (e) => updateSeat(i, { aiPersona: window.TimeLeagueUtils.PERSONA_IDS.includes(e.target.value) ? e.target.value : 'steward' }) },
                            window.TimeLeagueUtils.PERSONA_IDS.map((id) => h('option', { key: id, value: id }, AI.AI_PERSONAS[id].label)))
                        : h('span', { className: 'tl-pill' }, 'HOTSEAT'),
                    h('button', { type: 'button', className: 'tl-btn icon', disabled: seats.length <= 2, 'aria-label': `Remove seat ${i + 1}`, onClick: () => removeSeat(i) }, '✕'))),
                h('button', { type: 'button', className: 'tl-btn', disabled: seats.length >= 12, onClick: addSeat, style: { marginTop: 8 } }, '+ ADD SEAT')),

            h('div', { className: 'tl-field' },
                h('span', { className: 'tl-label' }, 'GM Profiles'),
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 } },
                    window.TimeLeagueUtils.PERSONA_IDS.map((id) => {
                        const persona = AI.AI_PERSONAS[id];
                        return h('div', { key: id, className: 'tl-card', style: { padding: '10px 12px' } },
                            h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } }, h('strong', { style: { fontSize: 12.5 } }, persona.label), h('span', { className: 'tl-pill info' }, id.toUpperCase())),
                            h(PersonaMeterRow, { label: 'AGGR', value: persona.aggression }),
                            h(PersonaMeterRow, { label: 'PATIENCE', value: persona.patience }),
                            h(PersonaMeterRow, { label: 'RISK', value: persona.riskTolerance }),
                            h('p', { className: 'tl-hint', style: { marginTop: 6 } }, persona.tell));
                    }))),

            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 } },
                h('div', { className: 'tl-field', style: { marginBottom: 0 } },
                    h('span', { className: 'tl-label' }, 'Roster Preset'),
                    h('select', { className: 'tl-select', value: rosterPreset, onChange: (e) => setRosterPreset(e.target.value) }, ROSTER_PRESET_OPTIONS.map((o) => h('option', { key: o.id, value: o.id }, o.label))),
                    h('p', { className: 'tl-hint' }, rosterOption.detail)),
                h('div', { className: 'tl-field', style: { marginBottom: 0 } },
                    h('span', { className: 'tl-label' }, 'Scoring Preset'),
                    h('select', { className: 'tl-select', value: scoringPreset, onChange: (e) => setScoringPreset(e.target.value) }, SCORING_PRESET_OPTIONS.map((o) => h('option', { key: o.id, value: o.id }, o.label))),
                    h('p', { className: 'tl-hint' }, scoringOption.detail))),

            h('label', { className: 'tl-toggle' }, h('input', { type: 'checkbox', checked: eraAdjusted, onChange: (e) => setEraAdjusted(e.target.checked) }),
                h('span', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Era-Adjusted Scoring'), h('span', { className: 'tl-hint' }, 'Default OFF — raw stat lines are the league decision. Opt in to normalize 1970 numbers against modern inflation.'))),
            h('label', { className: 'tl-toggle' }, h('input', { type: 'checkbox', checked: waiversEnabled, onChange: (e) => setWaiversEnabled(e.target.checked) }),
                h('span', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Waivers'), h('span', { className: 'tl-hint' }, 'Claims process worst-record-first after every game day.'))),
            h('label', { className: 'tl-toggle' }, h('input', { type: 'checkbox', checked: tradesEnabled, onChange: (e) => setTradesEnabled(e.target.checked) }),
                h('span', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Trades'), h('span', { className: 'tl-hint' }, 'Equal-count swaps; AI GMs propose and answer in character.'))),

            h('button', { type: 'button', className: 'tl-btn primary', onClick: found, style: { marginTop: 4, padding: '10px 18px' } }, 'FOUND LEAGUE'));
    }

    function WrTimeLeagueSetupPanel({ index, onOpen, onDelete, onCreate }) {
        return h('div', { className: 'tl-grid-2' },
            h(LeagueLedger, { index, onOpen, onDelete }),
            h(FoundLeague, { onCreate }));
    }

    window.WrTimeLeagueSetupPanel = WrTimeLeagueSetupPanel;
})();
