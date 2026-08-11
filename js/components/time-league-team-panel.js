// ══════════════════════════════════════════════════════════════════
// js/components/time-league-team-panel.js — window.WrTimeLeagueTeamPanel
// Team switcher + roster/lineup, waivers, and trades sections. Ported from
// The Duat's app/TimeLeagueTeamCenter.tsx.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo, useState } = React;
    const h = React.createElement;

    const Roster = window.App.TimeLeagueRoster;
    const AI = window.App.TimeLeagueAI;
    const Engine = window.App.TimeLeagueEngine;
    const Season = window.App.TimeLeagueSeason;

    const STARTER_SLOTS = Roster.ROSTER_SLOT_IDS.filter((slot) => Season.isStarterSlot(slot));
    const RESERVE_SLOTS = ['IR', 'TAXI'];
    const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
    const PERSONA_PILL = { warlord: 'bad', archivist: 'info', gambler: 'warn', steward: 'good' };
    const WIRE_ROW_CAP = 60;

    const fmt1 = (value) => value.toFixed(1);
    const nowIso = () => new Date().toISOString();
    const cardSeasonPoints = (cards, entry) => cards.get(entry.identity)?.seasons.find((s) => s.season === entry.drawnSeason)?.points ?? 0;

    function GmProfile({ team, title }) {
        const persona = team.aiPersona ? AI.AI_PERSONAS[team.aiPersona] : undefined;
        if (!persona) return null;
        const meters = [['Aggression', persona.aggression], ['Patience', persona.patience], ['Risk tol', persona.riskTolerance]];
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, `🧠 ${title}`), h('small', null, `${team.name} — ${persona.label.toUpperCase()}`)),
            meters.map(([label, value]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 6 } },
                h('span', { className: 'tl-label', style: { width: 62, flex: 'none' } }, label),
                h('span', { style: { flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 100, overflow: 'hidden' } },
                    h('span', { style: { display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: 'var(--gold)' } })),
                h('span', { className: 'tabular', style: { width: 24, textAlign: 'right', color: 'var(--text-muted)' } }, value))),
            h('p', { className: 'tl-hint' }, persona.tell));
    }

    function RosterSection({ league, cards, team, apply }) {
        const revealed = league.seasonsRevealed;
        const capacity = Engine.rosterCapacity(league.settings);
        const problems = Engine.lineupProblems(league, team.teamId);
        const moveTargets = (entry) => Roster.ROSTER_SLOT_IDS.filter((slot) => slot !== entry.slot && (league.settings.rosterSlots[slot] ?? 0) > 0 && Roster.SLOT_ELIGIBILITY[slot].includes(entry.position));
        const entryRow = (entry) => h('div', { key: entry.entryId, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
            h('span', { className: 'tl-pill', style: { flex: 'none', minWidth: 44, textAlign: 'center' } }, entry.slot),
            h('span', { style: { flex: 1, minWidth: 0 } },
                h('strong', { style: { display: 'block', fontSize: 12.5 } }, entry.name),
                h('small', { style: { color: 'var(--text-muted)', fontSize: 10.5 } }, `${entry.position} · via ${entry.acquiredVia} W${entry.acquiredWeek}`)),
            revealed
                ? h('span', { className: 'tabular', style: { fontSize: 12.5, color: 'var(--gold)', flex: 'none', textAlign: 'right' } }, fmt1(cardSeasonPoints(cards, entry)), h('small', { style: { display: 'block', color: 'var(--text-muted)', fontSize: 9.5 } }, `${entry.drawnSeason} SZN`))
                : h('span', { className: 'tl-pill warn', style: { flex: 'none' } }, 'SEALED'),
            h('select', {
                className: 'tl-select', style: { width: 90, flex: 'none' }, 'aria-label': `Move ${entry.name}`, value: '',
                onChange: (e) => { const slot = e.target.value; if (slot) apply(Engine.setEntrySlot(league, team.teamId, entry.entryId, slot)); },
            }, h('option', { value: '' }, 'MOVE'), moveTargets(entry).map((slot) => h('option', { key: slot, value: slot }, slot))));

        const starterRows = [];
        for (const slot of STARTER_SLOTS) {
            const count = league.settings.rosterSlots[slot] ?? 0;
            if (count <= 0) continue;
            const occupants = team.roster.filter((e) => e.slot === slot);
            occupants.forEach((entry) => starterRows.push(entryRow(entry)));
            for (let i = occupants.length; i < count; i += 1) {
                starterRows.push(h('div', { key: `${slot}-open-${i}`, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontSize: 12 } },
                    h('span', { className: 'tl-pill', style: { minWidth: 44, textAlign: 'center' } }, slot), h('span', null, 'Open slot — start someone')));
            }
        }
        const bench = team.roster.filter((e) => e.slot === 'BN').sort((l, r) => (revealed ? cardSeasonPoints(cards, r) - cardSeasonPoints(cards, l) || l.entryId.localeCompare(r.entryId) : l.entryId.localeCompare(r.entryId)));
        const reserves = RESERVE_SLOTS.filter((slot) => (league.settings.rosterSlots[slot] ?? 0) > 0);

        return h('div', { className: 'tl-grid-2' },
            h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Roster & lineup'), h('small', null, `${team.name} · ${team.roster.length}/${capacity} rostered`)),
                h('button', { className: 'tl-btn primary', onClick: () => apply(Engine.autoFillLineup(league, team.teamId, cards)), style: { marginBottom: 12 } }, '⚡ AUTO-SET LINEUP'),
                h('span', { className: 'tl-label' }, 'Starters'), starterRows,
                h('span', { className: 'tl-label', style: { display: 'block', marginTop: 10 } }, 'Bench'),
                bench.length ? bench.map(entryRow) : h('p', { className: 'tl-empty' }, 'Bench is empty.'),
                reserves.map((slot) => {
                    const occupants = team.roster.filter((e) => e.slot === slot);
                    return h('div', { key: slot, style: { marginTop: 10 } },
                        h('span', { className: 'tl-label' }, slot === 'IR' ? 'Injured reserve' : 'Taxi squad'),
                        occupants.length ? occupants.map(entryRow) : h('p', { className: 'tl-empty' }, `No entries stashed at ${slot}.`));
                })),
            h('div', null,
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Lineup check'), h('small', null, league.phase === 'season' ? `SCORING W${league.currentWeek}` : league.phase.toUpperCase())),
                    league.phase === 'draft' && h('div', { className: 'tl-feedrow' }, h('time', null, 'DRAFT'), h('p', null, 'Draft in progress — the roster fills as picks land.')),
                    problems.length
                        ? problems.map((p, i) => h('div', { key: i, className: 'tl-feedrow caution' }, h('time', null, 'FIX'), h('p', null, p)))
                        : h('div', { className: 'tl-feedrow' }, h('time', null, 'OK'), h('p', null, 'Every starter slot is filled and legal.')),
                    league.settings.eraAdjusted && h('div', { className: 'tl-feedrow' }, h('time', null, 'ERA'), h('p', null, 'Era-adjusted scoring is on — weekly points are normalized across seasons by position-era factors.'))),
                team.manager === 'ai' && h(GmProfile, { team, title: 'GM profile' })));
    }

    function WaiversSection({ league, cards, team, standings, apply }) {
        const [query, setQuery] = useState('');
        const [pos, setPos] = useState('ALL');
        const [targetIdentity, setTargetIdentity] = useState('');
        const [dropEntryId, setDropEntryId] = useState('');
        const pool = useMemo(() => Engine.freeAgents(league, cards), [league, cards]);

        if (!league.settings.waiversEnabled) {
            return h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Free agent wire'), h('small', null, 'OFFLINE')),
                h('span', { className: 'tl-pill bad' }, 'DISABLED'),
                h('p', { style: { marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' } }, "Waivers are switched off in this league's settings. The wire stays dark all season."));
        }
        const wireOpen = league.phase === 'season';
        const positions = POSITION_ORDER.filter((p) => pool.some((c) => c.position === p));
        const filtered = pool.filter((c) => (pos === 'ALL' || c.position === pos) && (!query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())));
        const shown = filtered.slice(0, WIRE_ROW_CAP);
        const target = targetIdentity ? cards.get(targetIdentity) : undefined;
        const alreadyClaimed = Boolean(target) && league.pendingClaims.some((c) => c.teamId === team.teamId && c.addIdentity === targetIdentity);
        const benchCap = league.settings.rosterSlots.BN ?? 0;
        const benchCount = team.roster.filter((e) => e.slot === 'BN').length;
        const mustDrop = benchCount >= benchCap;
        const dropEntry = team.roster.find((e) => e.entryId === dropEntryId);
        const dropBlocks = mustDrop && (!dropEntry || dropEntry.slot !== 'BN');
        const canFile = wireOpen && Boolean(target) && !alreadyClaimed && !dropBlocks;
        const dropOptions = [...team.roster].sort((l, r) => (l.slot === 'BN' ? 0 : 1) - (r.slot === 'BN' ? 0 : 1) || l.name.localeCompare(r.name));
        const mine = league.pendingClaims.filter((c) => c.teamId === team.teamId);
        const others = league.pendingClaims.length - mine.length;
        const priority = standings.map((s) => s.teamId).reverse();
        const myPriority = priority.indexOf(team.teamId) + 1;
        const fileClaim = () => {
            if (!target) return;
            apply(Engine.submitWaiverClaim(league, { teamId: team.teamId, addIdentity: target.identity, addName: target.name, addPosition: target.position, dropEntryId: dropEntry ? dropEntry.entryId : '' }, nowIso()));
            setTargetIdentity(''); setDropEntryId('');
        };

        return h('div', { className: 'tl-grid-2' },
            h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Free agent wire'), h('small', null, wireOpen ? `W${league.currentWeek} OPEN` : league.phase === 'draft' ? 'OPENS AFTER THE DRAFT' : 'SEASON COMPLETE')),
                h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
                    h('input', { className: 'tl-input', placeholder: 'Search the pool', value: query, onChange: (e) => setQuery(e.target.value) }),
                    h('select', { className: 'tl-select', style: { width: 130 }, 'aria-label': 'Filter position', value: pos, onChange: (e) => setPos(e.target.value) },
                        h('option', { value: 'ALL' }, 'ALL POS'), positions.map((p) => h('option', { key: p, value: p }, p)))),
                h('div', { style: { maxHeight: 360, overflowY: 'auto' } }, h('table', { className: 'tl-tbl' },
                    h('thead', null, h('tr', null, h('th', null, 'Player'), h('th', null, 'Pos'), h('th', { className: 'num' }, 'Span'), h('th', { className: 'num' }, 'Peak'), h('th', { className: 'num' }, 'Best szn'), h('th', null))),
                    h('tbody', null, shown.map((card) => {
                        const best = card.seasons.find((s) => s.points === card.peak);
                        const selected = card.identity === targetIdentity;
                        return h('tr', { key: card.identity, className: selected ? 'selected' : undefined },
                            h('td', null, card.name), h('td', null, h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position)),
                            h('td', { className: 'num' }, card.seasons.length ? `${card.seasons[0].season}–${card.seasons[card.seasons.length - 1].season}` : '—'),
                            h('td', { className: 'num tabular' }, fmt1(card.peak)), h('td', { className: 'num' }, best ? best.season : '—'),
                            h('td', { className: 'num' }, h('button', { className: 'tl-btn icon', disabled: !wireOpen, onClick: () => setTargetIdentity(selected ? '' : card.identity) }, selected ? 'PICKED' : 'CLAIM')));
                    })),
                    !shown.length && h('tr', null, h('td', { colSpan: 6, className: 'tl-empty' }, 'Nothing on the wire matches that filter.')))),
                filtered.length > shown.length && h('p', { className: 'tl-hint', style: { marginTop: 8 } }, `Showing ${WIRE_ROW_CAP} of ${filtered.length} — refine the search`)),
            h('div', null,
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 } },
                    h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Priority'), h('strong', { style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, myPriority ? `#${myPriority}` : '—')),
                    h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Pool'), h('strong', { style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, filtered.length)),
                    h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Claims'), h('strong', { style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, mine.length))),
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'File a claim'), h('small', null, 'processes at the next game day')),
                    !wireOpen && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'HOLD'), h('p', null, league.phase === 'draft' ? 'The wire opens when the draft completes.' : 'Season complete — no more claims.')),
                    benchCap <= 0 && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'WARN'), h('p', null, 'No bench configured — waiver adds have nowhere to land, so every claim will void.')),
                    target ? h(React.Fragment, null,
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' } },
                            h('span', { className: `tl-pos-badge tl-pos-${target.position}` }, target.position),
                            h('span', { style: { flex: 1 } }, h('strong', { style: { display: 'block', fontSize: 12.5 } }, target.name), h('small', { style: { color: 'var(--text-muted)' } }, 'ADD TARGET')),
                            h('span', { className: 'tabular', style: { color: 'var(--gold)' } }, fmt1(target.peak)),
                            h('button', { className: 'tl-btn icon', 'aria-label': 'Clear claim target', onClick: () => setTargetIdentity('') }, '✕')),
                        h('select', { className: 'tl-select', 'aria-label': 'Drop entry', value: dropEntryId, onChange: (e) => setDropEntryId(e.target.value) },
                            h('option', { value: '' }, mustDrop ? 'SELECT A DROP — BENCH IS FULL' : 'NO DROP (BENCH HAS ROOM)'),
                            dropOptions.map((entry) => h('option', { key: entry.entryId, value: entry.entryId }, `DROP ${entry.name} (${entry.slot})`))),
                        alreadyClaimed && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'DUPE'), h('p', null, 'You already have a live claim on this player.')),
                        mustDrop && dropEntry && dropEntry.slot !== 'BN' && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'WARN'), h('p', null, 'Dropping a starter leaves the bench full — the claim will void. Pick a bench drop.')),
                        h('button', { className: 'tl-btn primary', disabled: !canFile, onClick: fileClaim, style: { marginTop: 8 } }, '⚖ FILE CLAIM'))
                        : h('p', { className: 'tl-empty' }, 'Pick a target from the wire to build a claim.'),
                    h('p', { className: 'tl-hint', style: { marginTop: 8 } }, 'Processing order: reverse standings — worst record first.')),
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Pending claims'), h('small', null, others > 0 ? `+${others} filed by rival desks` : 'league quiet')),
                    mine.length ? h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null, h('th', null, 'Add'), h('th', null, 'Drop'), h('th', { className: 'num' }, 'Wk'), h('th', null))),
                        h('tbody', null, mine.map((claim) => {
                            const drop = team.roster.find((e) => e.entryId === claim.dropEntryId);
                            return h('tr', { key: claim.claimId },
                                h('td', null, `${claim.addName} (${claim.addPosition})`), h('td', null, claim.dropEntryId ? drop?.name ?? claim.dropEntryId : '—'),
                                h('td', { className: 'num' }, claim.week),
                                h('td', { className: 'num' }, h('button', { className: 'tl-btn icon', onClick: () => apply(Engine.cancelWaiverClaim(league, claim.claimId)) }, '✕ CANCEL')));
                        })))
                        : h('p', { className: 'tl-empty' }, 'No claims on file from your desk.')),
                team.manager === 'ai' && h(GmProfile, { team, title: 'GM profile' })));
    }

    function TradesSection({ league, cards, team, apply }) {
        const others = league.teams.filter((t) => t.teamId !== team.teamId);
        const [counterpartyId, setCounterpartyId] = useState(others.length ? others[0].teamId : '');
        const [giveIds, setGiveIds] = useState([]);
        const [receiveIds, setReceiveIds] = useState([]);
        const [note, setNote] = useState('');
        const entryById = useMemo(() => {
            const map = new Map();
            for (const item of league.teams) for (const entry of item.roster) map.set(entry.entryId, entry);
            return map;
        }, [league.teams]);

        if (!league.settings.tradesEnabled) {
            return h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Trade center'), h('small', null, 'OFFLINE')),
                h('span', { className: 'tl-pill bad' }, 'DISABLED'),
                h('p', { style: { marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' } }, "Trades are switched off in this league's settings. The desk never opens."));
        }
        const revealed = league.seasonsRevealed;
        const deskOpen = league.phase === 'season';
        const counterparty = league.teams.find((t) => t.teamId === counterpartyId);
        const valueOf = (entry) => AI.entryValueFromCard(cards.get(entry.identity), revealed ? entry.drawnSeason : undefined);
        const give = giveIds.filter((id) => team.roster.some((e) => e.entryId === id));
        const receive = counterparty ? receiveIds.filter((id) => counterparty.roster.some((e) => e.entryId === id)) : [];
        const giveValue = give.reduce((sum, id) => sum + (entryById.has(id) ? valueOf(entryById.get(id)) : 0), 0);
        const receiveValue = receive.reduce((sum, id) => sum + (entryById.has(id) ? valueOf(entryById.get(id)) : 0), 0);
        const delta = receiveValue - giveValue;
        const balanced = give.length > 0 && give.length === receive.length;
        const toggle = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
        const sortByValue = (roster) => [...roster].sort((l, r) => valueOf(r) - valueOf(l) || l.entryId.localeCompare(r.entryId));
        const pickRow = (entry, checked, onToggle) => h('label', { key: entry.entryId, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderRadius: 6, background: checked ? 'rgba(212,175,55,0.08)' : 'transparent', cursor: deskOpen ? 'pointer' : 'default' } },
            h('input', { type: 'checkbox', checked, onChange: onToggle, disabled: !deskOpen }),
            h('span', { className: 'tl-pill', style: { flex: 'none', minWidth: 38, textAlign: 'center' } }, entry.slot),
            h('span', { style: { flex: 1, minWidth: 0 } }, h('strong', { style: { display: 'block', fontSize: 12 } }, entry.name), h('small', { style: { color: 'var(--text-muted)', fontSize: 10 } }, `${entry.position} · ${revealed ? `${entry.drawnSeason} SZN` : 'SEALED'}`)),
            h('span', { className: 'tabular', style: { fontSize: 11.5, color: 'var(--gold)' } }, fmt1(valueOf(entry))));
        const teamById = (id) => league.teams.find((t) => t.teamId === id);
        const names = (ids) => ids.map((id) => entryById.get(id)?.name ?? id).join(', ') || '—';
        const pending = league.trades.filter((t) => t.status === 'pending' && (t.fromTeamId === team.teamId || t.toTeamId === team.teamId));
        const settled = league.trades.filter((t) => t.status !== 'pending').slice().reverse();
        const send = () => {
            if (!counterparty) return;
            const next = Engine.proposeTrade(league, { fromTeamId: team.teamId, toTeamId: counterparty.teamId, giveEntryIds: give, receiveEntryIds: receive, note }, nowIso());
            if (next === league) return;
            apply(next); setGiveIds([]); setReceiveIds([]); setNote('');
        };

        return h('div', null,
            h('div', { className: 'tl-grid-2' },
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Compose offer'), h('small', null, deskOpen ? `W${league.currentWeek} DESK OPEN` : league.phase === 'draft' ? 'OPENS AFTER THE DRAFT' : 'DESK CLOSED')),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
                        h('span', { className: 'tl-label' }, 'Counterparty'),
                        h('select', { className: 'tl-select', 'aria-label': 'Counterparty team', value: counterpartyId, onChange: (e) => { setCounterpartyId(e.target.value); setReceiveIds([]); } },
                            others.map((item) => h('option', { key: item.teamId, value: item.teamId }, `${item.name} — ${item.manager === 'human' ? 'HUMAN' : (item.aiPersona ? AI.AI_PERSONAS[item.aiPersona].label : 'AI').toUpperCase()}`)))),
                    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 } },
                        h('div', null, h('span', { className: 'tl-label', style: { display: 'block', marginBottom: 6 } }, `You send — ${team.name}`),
                            sortByValue(team.roster).map((entry) => pickRow(entry, give.includes(entry.entryId), () => setGiveIds(toggle(giveIds, entry.entryId)))),
                            !team.roster.length && h('p', { className: 'tl-empty' }, 'No entries to offer.')),
                        h('div', null, h('span', { className: 'tl-label', style: { display: 'block', marginBottom: 6 } }, `You receive — ${counterparty?.name ?? '—'}`),
                            counterparty && sortByValue(counterparty.roster).map((entry) => pickRow(entry, receive.includes(entry.entryId), () => setReceiveIds(toggle(receiveIds, entry.entryId)))),
                            counterparty && !counterparty.roster.length && h('p', { className: 'tl-empty' }, 'Their roster is empty.'))),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 } },
                        h('span', { className: `tl-pill ${balanced ? 'good' : 'warn'}` }, `${give.length} FOR ${receive.length}`),
                        h('span', { style: { fontSize: 11.5, color: 'var(--text-secondary)' } }, 'YOU SEND ', h('b', { className: 'tabular', style: { color: 'var(--white)' } }, fmt1(giveValue))),
                        h('span', { style: { fontSize: 11.5, color: 'var(--text-secondary)' } }, 'YOU GET ', h('b', { className: 'tabular', style: { color: 'var(--white)' } }, fmt1(receiveValue))),
                        h('span', { className: `tl-pill ${delta >= 0 ? 'good' : 'bad'}` }, `${delta >= 0 ? '+' : ''}${fmt1(delta)} SWING`)),
                    !balanced && (give.length > 0 || receive.length > 0) && h('p', { className: 'tl-hint', style: { marginBottom: 10 } }, 'Equal-count swaps only — roster sizes are fixed.'),
                    h('div', { style: { display: 'flex', gap: 8 } },
                        h('input', { className: 'tl-input', placeholder: 'Attach a note — sell the deal', value: note, onChange: (e) => setNote(e.target.value) }),
                        h('button', { className: 'tl-btn primary', disabled: !deskOpen || !balanced || !counterparty, onClick: send }, '⇄ SEND OFFER'))),
                h('div', null,
                    counterparty && counterparty.manager === 'ai'
                        ? h(GmProfile, { team: counterparty, title: 'Opposing GM' })
                        : h('div', { className: 'tl-card' }, h('div', { className: 'tl-card-title' }, h('span', null, 'Opposing desk'), h('small', null, 'HUMAN')), h('p', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, 'No tells on a human desk. Negotiate in the open — attach a note.')),
                    team.manager === 'ai' && h(GmProfile, { team, title: 'Your GM' }))),
            h('div', { className: 'tl-grid-2 even', style: { marginTop: 16 } },
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Inbox'), h('small', null, pending.length ? `${pending.length} PENDING` : 'DESK CLEAR')),
                    pending.map((trade) => {
                        const from = teamById(trade.fromTeamId); const to = teamById(trade.toTeamId);
                        const incoming = trade.toTeamId === team.teamId;
                        const toAi = to?.manager === 'ai';
                        return h('div', { key: trade.tradeId, style: { padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                                h('span', { className: `tl-pill ${incoming ? 'gold' : 'info'}` }, incoming ? 'INCOMING' : 'OUTGOING'),
                                h('span', { className: 'tl-label' }, `W${trade.week} · ${from?.name ?? trade.fromTeamId} → ${to?.name ?? trade.toTeamId}`)),
                            h('p', { style: { fontSize: 12, margin: '2px 0', color: 'var(--text-secondary)' } }, h('b', { style: { color: 'var(--white)' } }, from?.name ?? trade.fromTeamId), ` sends ${names(trade.giveEntryIds)}`),
                            h('p', { style: { fontSize: 12, margin: '2px 0 6px', color: 'var(--text-secondary)' } }, h('b', { style: { color: 'var(--white)' } }, to?.name ?? trade.toTeamId), ` sends ${names(trade.receiveEntryIds)}`),
                            trade.note && h('p', { style: { fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-faint, rgba(189,184,173,0.6))', margin: '0 0 6px' } }, `"${trade.note}"`),
                            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                                incoming && !toAi && h(React.Fragment, null,
                                    h('button', { className: 'tl-btn', onClick: () => apply(Engine.respondToTrade(league, trade.tradeId, true, '', nowIso())) }, '✓ ACCEPT'),
                                    h('button', { className: 'tl-btn', onClick: () => apply(Engine.respondToTrade(league, trade.tradeId, false, '', nowIso())) }, '✕ REJECT')),
                                toAi && h(React.Fragment, null,
                                    h('span', { className: 'tl-pill info' }, 'THE GM IS CONSIDERING'),
                                    h('button', { className: 'tl-btn', onClick: () => apply(AI.aiRespondToTrades(league, cards, nowIso())) }, '📡 PING THE GM')),
                                !incoming && !toAi && h('span', { className: 'tl-pill info' }, 'AWAITING RESPONSE')));
                    }),
                    !pending.length && h('p', { className: 'tl-empty' }, 'No pending offers on the desk.')),
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Trade history'), h('small', null, 'league-wide')),
                    settled.map((trade) => {
                        const from = teamById(trade.fromTeamId); const to = teamById(trade.toTeamId);
                        const accepted = trade.status === 'accepted';
                        return h('div', { key: trade.tradeId, className: `tl-feedrow${accepted ? '' : ' caution'}` },
                            h('time', null, `W${trade.week}`),
                            h('div', null, h('p', { style: { margin: 0 } },
                                h('span', { className: `tl-pill ${accepted ? 'good' : trade.status === 'rejected' ? 'bad' : 'warn'}` }, trade.status.toUpperCase()),
                                ` ${from?.name ?? trade.fromTeamId} sent ${names(trade.giveEntryIds)} for ${names(trade.receiveEntryIds)} from ${to?.name ?? trade.toTeamId}`),
                                trade.note && h('p', { style: { fontSize: 11, fontStyle: 'italic', color: 'var(--text-faint, rgba(189,184,173,0.6))', margin: '4px 0 0' } }, `"${trade.note}"`)));
                    }),
                    !settled.length && h('div', { className: 'tl-feedrow' }, h('time', null, 'NONE'), h('p', null, 'No trades settled yet this season.')))));
    }

    function WrTimeLeagueTeamPanel({ league, cards, section, activeTeamId, onSelectTeam, onUpdate }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const recordByTeam = useMemo(() => new Map(standings.map((s) => [s.teamId, s])), [standings]);
        const team = league.teams.find((t) => t.teamId === activeTeamId);
        const apply = (next) => { if (next !== league) onUpdate(next); };
        return h('div', null,
            h('nav', { style: { display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }, 'aria-label': 'Teams' },
                league.teams.map((item) => {
                    const record = recordByTeam.get(item.teamId);
                    const persona = item.aiPersona ? AI.AI_PERSONAS[item.aiPersona] : undefined;
                    return h('button', {
                        key: item.teamId, onClick: () => onSelectTeam(item.teamId),
                        className: 'tl-card', style: {
                            flex: 'none', textAlign: 'left', cursor: 'pointer', padding: '8px 12px',
                            borderColor: item.teamId === activeTeamId ? 'var(--gold)' : undefined,
                        },
                    }, h('strong', { style: { display: 'block', fontSize: 12.5 } }, item.name),
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 } },
                            item.manager === 'human' ? h('span', { className: 'tl-pill' }, 'HUMAN') : h('span', { className: `tl-pill ${PERSONA_PILL[item.aiPersona ?? 'steward']}` }, (persona?.label ?? 'AI').toUpperCase()),
                            record && h('small', { className: 'tabular', style: { color: 'var(--text-muted)' } }, `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`)));
                })),
            !team
                ? h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty' }, 'Unknown team — pick a desk above.'))
                : section === 'roster' ? h(RosterSection, { key: activeTeamId, league, cards, team, apply })
                    : section === 'waivers' ? h(WaiversSection, { key: activeTeamId, league, cards, team, standings, apply })
                        : h(TradesSection, { key: activeTeamId, league, cards, team, apply }));
    }

    window.WrTimeLeagueTeamPanel = WrTimeLeagueTeamPanel;
})();
