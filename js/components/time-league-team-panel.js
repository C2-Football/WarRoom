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
    const UI = window.App.TimeLeagueUI;

    const STARTER_SLOTS = Roster.ROSTER_SLOT_IDS.filter((slot) => Season.isStarterSlot(slot));
    const RESERVE_SLOTS = ['IR'];
    const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const PERSONA_PILL = { warlord: 'bad', archivist: 'info', gambler: 'warn', steward: 'good' };
    const WIRE_ROW_CAP = 60;

    const fmt1 = (value) => value.toFixed(1);
    const nowIso = () => new Date().toISOString();
    const cardSeasonPoints = (cards, entry) => cards.get(entry.identity)?.seasons.find((s) => s.season === entry.drawnSeason)?.points ?? 0;

    /** Mirrors War Room's real trade-engine.js fairnessGrade thresholds (reconai-shared/trade-engine.js:171-181). */
    function fairnessGrade(giveValue, receiveValue) {
        if (giveValue <= 0 && receiveValue <= 0) return { grade: '—', label: 'Build an offer', tone: '' };
        if (giveValue <= 0) return { grade: 'A+', label: 'Steal', tone: 'good' };
        const ratio = receiveValue / giveValue;
        if (ratio >= 1.30) return { grade: 'A+', label: 'Steal', tone: 'good' };
        if (ratio >= 1.15) return { grade: 'A', label: 'Clear Win', tone: 'good' };
        if (ratio >= 1.05) return { grade: 'B+', label: 'Slight Win', tone: 'gold' };
        if (ratio >= 0.95) return { grade: 'B', label: 'Fair', tone: 'gold' };
        if (ratio >= 0.85) return { grade: 'C', label: 'Slight Loss', tone: 'warn' };
        if (ratio >= 0.75) return { grade: 'D', label: 'Overpay', tone: 'warn' };
        return { grade: 'F', label: 'Bad Trade', tone: 'bad' };
    }

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

    /** Slot | Player | Pts | Move — mirrors the column rhythm of War Room's real
     * Game Day Central lineup table (js/tabs/lineup.js), minus the projection/
     * matchup/form columns that don't apply to fixed historical stat lines. */
    const LINEUP_GRID = '56px minmax(0,1fr) 78px 92px';

    function RosterSection({ league, cards, team, apply, logIndex, eraFactors }) {
        const [selectedId,setSelectedId]=useState(null);
        const [draggedId, setDraggedId] = useState(null);
        const [moveNotice, setMoveNotice] = useState('');
        const dossierRef=React.useRef(null);
        React.useEffect(()=>{if(selectedId)dossierRef.current?.focus();},[selectedId]);
        const revealed = league.seasonsRevealed;
        const editable = league.phase === 'season' && ['claims', 'lineup'].includes(league.weekStage);
        const outlooks = useMemo(() => new Map(team.roster.map(entry => [entry.entryId,
            revealed ? Season.rosterOutlook(entry, league.currentWeek, Engine.seasonEndWeek(league), logIndex, league.settings.scoring, league.settings.eraAdjusted ? eraFactors : null) : null
        ])), [team.roster, revealed, league.currentWeek, league.settings, logIndex, eraFactors]);
        const capacity = Engine.rosterCapacity(league.settings);
        const problems = Engine.lineupProblems(league, team.teamId);
        const moveTargets = (entry) => Roster.ROSTER_SLOT_IDS.filter((slot) => slot !== entry.slot && (league.settings.rosterSlots[slot] ?? 0) > 0 && Roster.SLOT_ELIGIBILITY[slot].includes(entry.position));
        const moveEntry = async (entryId, slot, targetEntryId) => {
            if (!editable) { setMoveNotice('Lineups open during the waiver and roster gates.'); return; }
            const next = Engine.setEntrySlot(league, team.teamId, entryId, slot, targetEntryId);
            if (next === league) { setMoveNotice('That player cannot move into this slot. Choose a compatible position.'); return; }
            try {
                const saved = await apply(next, { type: 'lineup', teamId: team.teamId, entryId, slot, targetEntryId });
                setMoveNotice(saved === false ? 'Move was not saved. Review the current lineup and try again.' : 'Lineup updated.');
            } catch { setMoveNotice('Move could not be saved. Please try again.'); }
        };
        const dropProps = (slot, targetEntryId) => ({
            onDragOver: (event) => { if (editable && draggedId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } },
            onDrop: (event) => { event.preventDefault(); const id = draggedId; setDraggedId(null); if (id) moveEntry(id, slot, targetEntryId); },
        });
        const entryRow = (entry, slotLabel) => {
            const outlook = outlooks.get(entry.entryId);
            const rating = revealed && Season.weeklyStarOutlook ? Season.weeklyStarOutlook(entry, league.currentWeek, Engine.seasonEndWeek(league), logIndex, league.settings.scoring, league.settings.eraAdjusted ? eraFactors : null) : null;
            const eraColor = revealed ? UI.eraColorOf(entry.drawnSeason) : null;
            return h('div', { key: entry.entryId, className: 'tl-lineup-row' + (draggedId === entry.entryId ? ' is-dragging' : ''), draggable: editable, onDragStart: (event) => { setDraggedId(entry.entryId); event.dataTransfer.setData('text/plain', entry.entryId); event.dataTransfer.effectAllowed = 'move'; }, onDragEnd: () => setDraggedId(null), ...dropProps(entry.slot, entry.entryId), style: { gridTemplateColumns: LINEUP_GRID } },
                h('span', { className: 'tl-lineup-slot' }, slotLabel),
                h('button', { type:'button', className: 'tl-lineup-player tl-roster-player-link', onClick:()=>setSelectedId(entry.entryId), 'aria-label':`Explore ${entry.name}'s history`, 'aria-pressed':selectedId===entry.entryId },
                    h('span', { className: 'name' }, entry.name),
                    h('span', { className: `tl-pos-badge tl-pos-${entry.position}`, style: { marginLeft: 6 } }, entry.position),
                    revealed
                        ? h('span', { className: 'meta' }, `${entry.drawnSeason} · ${outlook ? `${outlook.remaining} games left` : UI.decadeLabelOf(entry.drawnSeason)}`)
                        : h('span', { className: 'tl-pill warn', style: { marginLeft: 6 } }, 'SEALED'),
                    rating && h('span', { className: 'tl-week-stars', title: rating.stars !== null ? `Week ${league.currentWeek}: ${rating.stars} of 5 stars. Highest remaining rating: ${rating.maxRemainingStars}.` : 'No archived game this week: zero points.', 'aria-label': rating.stars !== null ? `${rating.stars} of 5 stars this week` : 'No archived game this week' }, rating.stars !== null ? '★'.repeat(rating.stars) + '☆'.repeat(5-rating.stars) : '— No game log'), rating && rating.maxRemainingStars !== null && h('small', { className: 'tl-stars-ceiling' }, `Remaining ceiling: ${rating.maxRemainingStars}★`)),
                h('span', { className: 'tl-lineup-pts tabular', style: eraColor ? { color: eraColor } : undefined },
                    revealed ? fmt1(cardSeasonPoints(cards, entry)) : '—', h('small', null, 'SZN PTS')),
                h('select', {
                    className: 'tl-select', style: { fontSize: 10.5, padding: '5px 4px' }, 'aria-label': `Move ${entry.name}`, value: '', disabled: !editable,
                    onChange: (e) => { const slot = e.target.value; if (slot) moveEntry(entry.entryId, slot); },
                }, h('option', { value: '' }, 'MOVE'), moveTargets(entry).map((slot) => h('option', { key: slot, value: slot }, slot))));
        };
        const openRow = (slotLabel, key) => h('div', { key, className: 'tl-lineup-row open-slot', ...dropProps(slotLabel), style: { gridTemplateColumns: LINEUP_GRID } },
            h('span', { className: 'tl-lineup-slot' }, slotLabel), h('span', null, 'Open slot — start someone'), h('span', null), h('span', null));

        const starterRows = [];
        for (const slot of STARTER_SLOTS) {
            const count = league.settings.rosterSlots[slot] ?? 0;
            if (count <= 0) continue;
            const occupants = team.roster.filter((e) => e.slot === slot);
            occupants.forEach((entry) => starterRows.push(entryRow(entry, slot)));
            for (let i = occupants.length; i < count; i += 1) starterRows.push(openRow(slot, `${slot}-open-${i}`));
        }
        const bench = team.roster.filter((e) => e.slot === 'BN').sort((l, r) => (revealed ? cardSeasonPoints(cards, r) - cardSeasonPoints(cards, l) || l.entryId.localeCompare(r.entryId) : l.entryId.localeCompare(r.entryId)));
        const reserves = RESERVE_SLOTS.filter((slot) => (league.settings.rosterSlots[slot] ?? 0) > 0);

        const optimal = league.phase !== 'draft' && problems.length === 0;
        const headline = league.phase === 'draft' ? 'DRAFT IN PROGRESS' : optimal ? 'LINEUP IS VALID' : `${problems.length} ISSUE${problems.length === 1 ? '' : 'S'} TO FIX`;

        const selected=team.roster.find(e=>e.entryId===selectedId);
        const selectedRating = selected && revealed && Season.weeklyStarOutlook ? Season.weeklyStarOutlook(selected, league.currentWeek, Engine.seasonEndWeek(league), logIndex, league.settings.scoring, league.settings.eraAdjusted ? eraFactors : null) : null;
        const card=selected?cards.get(selected.identity):null;
        const history=selected&&revealed?window.App.TimeLeaguePlayerCards.beforeSeason(card,selected.drawnSeason):null;
        const stat=(label,value)=>h('div',{className:'tl-archive-stat',key:label},h('small',null,label),h('strong',null,value));
        const dossier=h('aside',{className:'tl-roster-dossier',ref:dossierRef,tabIndex:-1,'aria-label':'Historical player dossier'},
            selected?h(React.Fragment,null,
                h('div',{className:'tl-dossier-kicker'},'THE VAULT · PLAYER ARCHIVE'),
                h('div',{className:'tl-dossier-title'},h('span',{className:`tl-pos-badge tl-pos-${selected.position}`},selected.position),h('h2',null,selected.name),h('button',{type:'button',className:'tl-btn',onClick:()=>setSelectedId(null),'aria-label':'Close player history'},'Close')),
                h('p',{className:'tl-hint'},revealed?`Your edition: ${selected.drawnSeason} · Looking back before this season`:'Your edition is sealed. Season-specific history unlocks at the reveal.'),
                h('div',{className:'tl-archive-bio'},[['College',card?.bio?.college],['Born',card?.bio?.birthDate],['Size',[card?.bio?.height,card?.bio?.weight].filter(Boolean).join(' · ')],['NFL draft',[card?.bio?.draftYear,card?.bio?.draftTeam].filter(Boolean).join(' · ')]].filter(([,value])=>value).map(([label,value])=>stat(label,value))),
                !card?.bio&&h('p',{className:'tl-hint'},'Biography is not available in the historical archive for this player.'),
                revealed && outlooks.get(selected.entryId) && h('section', { className: 'tl-season-outlook' },
                    h('h3', null, 'The road ahead'),
                    h('div', { className: 'tl-archive-stats' },
                        stat('Games left', outlooks.get(selected.entryId).remaining),
                        stat('Recent form', outlooks.get(selected.entryId).signal),
                        stat('Remaining pace estimate', outlooks.get(selected.entryId).estimatedRemaining === null ? 'Needs a completed game' : `${fmt1(outlooks.get(selected.entryId).estimatedRemaining)} pts`)),
                    h('p', { className: 'tl-hint' }, 'Estimate = completed-game average × remaining logged games. Assumes you start every game; future scores stay hidden. Form compares the last three games with earlier games.'),
                    h('div', { className: 'tl-outlook-weeks' }, outlooks.get(selected.entryId).schedule.map(row => h('div', { key: row.week, className: `tl-outlook-week${row.week === league.currentWeek ? ' current' : ''}${!row.available ? ' missing' : ''}` },
                        h('small', null, `W${row.week}`), h('strong', null, row.played ? fmt1(row.points) : row.available ? `${selectedRating?.schedule.find(item => item.week === row.week)?.stars ?? '—'}★` : '—')))),
                    h('p', { className: 'tl-hint' }, 'A dash means no archived game log: zero points under Vault scoring. It may be a bye, missed game, or archive gap. Only weeks inside this league’s season are shown.')),
                history&&h(React.Fragment,null,
                    h('div',{className:'tl-archive-stats'},stat('Earlier seasons in archive',history.seasons.length),stat('Previous season',history.latest?`${history.latest.season} · ${history.latest.points.toFixed(1)} pts`:'Not available'),stat('Best earlier season',history.best?`${history.best.season} · ${history.best.points.toFixed(1)} pts`:'Not available')),
                    h('div',{className:'tl-archive-read'},h('h3',null,'The story coming in'),h('p',null,!history.latest?`No seasons before ${selected.drawnSeason} are in this archive. That does not establish that this was a rookie year.`:`In ${history.latest.season}, ${selected.name} recorded ${history.latest.games} games and ${history.latest.points.toFixed(1)} fantasy points.`),history.change!==null&&h('p',null,`Points per game ${history.change>=0?'rose':'fell'} by ${Math.abs(history.change).toFixed(1)} between the last two available seasons (${history.seasons[history.seasons.length-2].season}–${history.latest.season}).`)),
                    history.seasons.length>0&&h('div',{className:'tl-archive-history'},h('h3',null,'Before your edition'),h('p',{className:'tl-hint'},'Only seasons earlier than your drawn year. Points use the bundled archive scoring, not a weekly projection.'),h('div',{className:'tl-archive-scroll'},h('table',null,h('thead',null,h('tr',null,['Year','GP','Pass YD','Pass TD','Rush YD','Rush TD','REC','Rec YD','Rec TD','PTS'].map(x=>h('th',{key:x},x)))),h('tbody',null,history.seasons.slice().reverse().map(row=>h('tr',{key:row.season},['season','games','passYd','passTd','rushYd','rushTd','rec','recYd','recTd','points'].map(k=>h('td',{key:k},k==='points'?row[k].toFixed(1):row[k])))))))))
            ):h('div',{className:'tl-archive-empty'},h('span',{className:'tl-dossier-kicker'},'YOUR COLLECTION, THROUGH TIME'),h('h2',null,'Every name has a backstory.'),h('p',null,'Select a player to open their biography, earlier seasons, and the form they carried into your drawn year.'),h('div',{className:'tl-archive-stats'},stat('Players',team.roster.length),stat('Positions',new Set(team.roster.map(e=>e.position)).size),stat('Editions',revealed?new Set(team.roster.map(e=>e.drawnSeason)).size:'Sealed'))),
            team.manager==='ai'&&h(GmProfile,{team,title:'GM profile'}));
        return h('div', { className: 'tl-roster-layout'+(selected?' has-selection':'') },
            h('div', null,
                h('div', { className: 'tl-lineup-hero' },
                    h('div', { className: 'lh-kicker' }, `WK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)} · ROSTER CENTRAL`),
                    h('div', { className: `lh-headline ${league.phase === 'draft' ? '' : optimal ? 'good' : 'warn'}` }, headline),
                    h('div', { className: 'lh-sub' }, `${team.name} · ${team.roster.length}/${capacity} rostered${league.settings.eraAdjusted ? ' · era-adjusted scoring' : ''}`),
                    !optimal && problems.length > 0 && h('div', { style: { marginBottom: 12 } },
                        problems.map((p, i) => h('div', { key: i, className: 'tl-feedrow caution' }, h('time', null, 'FIX'), h('p', null, p)))),
                    h('p', { className: 'tl-hint' }, 'Drag a player onto a compatible slot or player to swap; the Move menu works with touch and keyboard. Stars are historical game-strength clues, not forecasts. They compare this week with that player’s own season: best three games earn 5, worst three earn 1. No-game weeks are excluded.'),
                    h('p', { className: 'tl-hint' }, 'A dash means no archived game log: a bye, missed game, or archive gap. That week scores zero.'),
                    h('p', { className: 'tl-hint', role: 'status' }, moveNotice),
                    h('div', { className: 'lh-actions' }, h('button', { className: 'tl-btn primary', disabled: !editable, onClick: () => apply(Engine.autoFillLineup(league, team.teamId, cards), { type: 'auto-lineup', teamId: team.teamId }) }, '⚡ AUTO-SET LINEUP'))),

                h('div', { className: 'tl-lineup-table' },
                    h('div', { className: 'tl-lineup-table-title' }, 'Starting Lineup'),
                    h('div', { className: 'tl-lineup-head', style: { gridTemplateColumns: LINEUP_GRID } },
                        h('span', null, 'Slot'), h('span', null, 'Player'), h('span', { style: { textAlign: 'right' } }, 'Pts'), h('span', null)),
                    starterRows),
                h('div', { className: 'tl-lineup-table' },
                    h('div', { className: 'tl-lineup-table-title', ...dropProps('BN') }, 'Bench · drop here'),
                    bench.length
                        ? bench.map((entry) => entryRow(entry, 'BN'))
                        : h('p', { className: 'tl-empty', style: { padding: '10px 14px' } }, 'Bench is empty.')),
                reserves.map((slot) => {
                    const occupants = team.roster.filter((e) => e.slot === slot);
                    return h('div', { key: slot, className: 'tl-lineup-table' },
                        h('div', { className: 'tl-lineup-table-title' }, slot === 'IR' ? 'Injured Reserve' : 'Taxi Squad'),
                        occupants.length ? occupants.map((entry) => entryRow(entry, slot)) : h('p', { className: 'tl-empty', style: { padding: '10px 14px' } }, `No entries stashed at ${slot}.`));
                })),
            dossier);
    }

    function WaiversSection({ league, cards, team, standings, apply }) {
        const [query, setQuery] = useState('');
        const [pos, setPos] = useState('ALL');
        const [visibleCount, setVisibleCount] = useState(WIRE_ROW_CAP);
        const [targetIdentity, setTargetIdentity] = useState('');
        const [dropEntryId, setDropEntryId] = useState('');
        const [bidAmount, setBidAmount] = useState(0);
        const [filing, setFiling] = useState(false);
        const [claimMessage, setClaimMessage] = useState('');
        const pool = useMemo(() => Engine.freeAgents(league, cards), [league, cards]);
        const faab = league.settings.waiverMode === 'faab';
        const clearTarget = (identity) => { setTargetIdentity(identity); setBidAmount(0); };

        if (!league.settings.waiversEnabled) {
            return h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Free agent wire'), h('small', null, 'OFFLINE')),
                h('span', { className: 'tl-pill bad' }, 'DISABLED'),
                h('p', { style: { marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' } }, "Waivers are switched off in this league's settings. The wire stays dark all season."));
        }
        const wireOpen = league.phase === 'season' && league.weekStage === 'claims';
        const positions = POSITION_ORDER.filter((p) => pool.some((c) => c.position === p));
        const filtered = pool.filter((c) => (pos === 'ALL' || c.position === pos) && (!query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())));
        const shown = filtered.slice(0, visibleCount);
        const target = targetIdentity ? cards.get(targetIdentity) : undefined;
        const alreadyClaimed = Boolean(target) && league.pendingClaims.some((c) => c.teamId === team.teamId && c.addIdentity === targetIdentity);
        const benchCap = league.settings.rosterSlots.BN ?? 0;
        const mustDrop = Boolean(target) && !Engine.waiverLandingSlot(league, team, target.position, '');
        const dropEntry = team.roster.find((e) => e.entryId === dropEntryId);
        const landingSlot = target ? Engine.waiverLandingSlot(league, team, target.position, dropEntryId) : null;
        const dropBlocks = Boolean(target) && !landingSlot;
        const dropOptions = [...team.roster].sort((l, r) => (l.slot === 'BN' ? 0 : 1) - (r.slot === 'BN' ? 0 : 1) || l.name.localeCompare(r.name));
        const mine = league.pendingClaims.filter((c) => c.teamId === team.teamId);
        const others = league.pendingClaims.length - mine.length;
        const priority = standings.map((s) => s.teamId).reverse();
        const myPriority = priority.indexOf(team.teamId) + 1;
        const budgetRemaining = team.faabRemaining ?? 0;
        const budgetReserved = mine.reduce((sum, c) => sum + (c.bidAmount ?? 0), 0);
        const budgetAvailable = Math.max(0, budgetRemaining - budgetReserved);
        const bidInvalid = faab && (!Number.isFinite(bidAmount) || bidAmount < 0 || bidAmount > budgetAvailable);
        const canFile = !filing && wireOpen && Boolean(target) && !alreadyClaimed && !dropBlocks && !bidInvalid;
        const fileClaim = async () => {
            if (!canFile) return;
            setFiling(true); setClaimMessage('');
            try {
                const saved = await apply(Engine.submitWaiverClaim(league, {
                    teamId: team.teamId, addIdentity: target.identity, addName: target.name, addPosition: target.position,
                    dropEntryId: dropEntry ? dropEntry.entryId : '', ...(faab ? { bidAmount } : {}),
                }, nowIso()), { type: 'claim', teamId: team.teamId, identity: target.identity, dropEntryId: dropEntry?.entryId || '', bidAmount });
                if (saved) {
                    setTargetIdentity(''); setDropEntryId(''); setBidAmount(0);
                    setClaimMessage('Claim filed. It will process with the next waiver batch.');
                } else setClaimMessage('Claim was not saved. Review your selection and try again.');
            } catch (_error) { setClaimMessage('Claim could not be saved. Please try again.'); }
            finally { setFiling(false); }
        };

        return h('div', { className: 'tl-waiver-desk' },
            h('header', { className: 'tl-waiver-heading' },
                h('div', null, h('span', { className: 'tl-label' }, 'FREE AGENCY'), h('h2', null, 'Find your next difference-maker')),
                h('span', { className: 'tl-pill' }, wireOpen ? `W${league.currentWeek} · CLAIMS OPEN` : league.phase === 'draft' ? 'OPENS AFTER DRAFT' : league.phase === 'season' ? `W${league.currentWeek} · CLAIMS CLOSED` : 'SEASON COMPLETE')),
            h('div', { className: 'tl-waiver-layout' },
            h('section', { className: 'tl-card tl-waiver-market' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Market explorer'), h('small', null, `${filtered.length} available players`)),
                h('div', { className: 'tl-waiver-search' },
                    h('input', { className: 'tl-input', placeholder: 'Search player name…', 'aria-label': 'Search free agents', value: query, onChange: e => { setQuery(e.target.value); setVisibleCount(WIRE_ROW_CAP); } }),
                    h('span', { className: 'tl-label' }, 'SORT · CAREER BEST ↓')),
                h('nav', { className: 'tl-waiver-filters', 'aria-label': 'Free agent positions' },
                    ['ALL', ...positions].map(position => h('button', { key: position, className: `tl-btn${pos === position ? ' primary' : ''}`, 'aria-pressed': pos === position, onClick: () => { setPos(position); setVisibleCount(WIRE_ROW_CAP); } }, position))),
                h('p', { className: 'tl-waiver-reference' }, 'Career best is a reference. Your season is drawn from eligible seasons when a claim succeeds.'),
                shown.length === 0 ? h('p', { className: 'tl-empty' }, 'No players match these filters.') :
                    h('div', { className: 'tl-waiver-table-scroll' }, h('table', { className: 'tl-waiver-table' },
                        h('thead', null, h('tr', null, ['#', 'PLAYER', 'POS', 'ARCHIVE', 'CAREER BEST', ''].map((label, index) => h('th', { key: index, scope: 'col' }, label)))),
                        h('tbody', null, shown.map((card, index) => {
                            const best = card.seasons.find(season => season.points === card.peak);
                            const selected = card.identity === targetIdentity;
                            return h('tr', { key: card.identity, className: selected ? 'is-selected' : '' },
                                h('td', { className: 'tl-waiver-rank' }, index + 1),
                                h('td', null, h('strong', null, card.name)),
                                h('td', null, h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position)),
                                h('td', { className: 'tl-waiver-years' }, card.seasons.length ? `${card.seasons[0].season}–${card.seasons[card.seasons.length - 1].season}` : '—'),
                                h('td', { className: 'tl-waiver-score tabular' }, fmt1(card.peak), h('small', null, best?.season || '—')),
                                h('td', null, h('button', { className: `tl-btn${selected ? ' primary' : ''}`, disabled: !wireOpen || filing, 'aria-label': `${selected ? 'Clear' : 'Claim'} ${card.name}`, 'aria-pressed': selected, onClick: () => clearTarget(selected ? '' : card.identity) }, selected ? 'Selected' : '+ Claim')));
                        })))),
                h('div', { className: 'tl-waiver-market-foot' }, h('span', null, `${shown.length} of ${filtered.length} shown`),
                    filtered.length > shown.length && h('button', { className: 'tl-btn', onClick: () => setVisibleCount(count => count + WIRE_ROW_CAP) }, 'Show more'))),
            h('aside', { className: 'tl-waiver-command' },
                h('div', { style: { display: 'grid', gridTemplateColumns: faab ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 10, marginBottom: 14 } },
                    h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Priority'), h('strong', { style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, myPriority ? `#${myPriority}` : '—')),
                    h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Pool'), h('strong', { style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, filtered.length)),
                    h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Claims'), h('strong', { style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, mine.length)),
                    faab && h('div', { className: 'tl-card', style: { padding: '10px 12px' } }, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Budget'), h('strong', { className: 'tabular', style: { fontSize: 18, fontFamily: 'var(--font-title)' } }, `$${budgetAvailable}`))),
                h('div', { className: 'tl-card tl-waiver-claim' },
                    claimMessage ? h('p', { role: 'status' }, claimMessage) : null,
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Claim builder'), h('small', null, 'processes when the waiver batch runs')),
                    h('p',{className:'tl-hint'},'Career-best points are a reference, not your awarded season. An eligible season is drawn when the claim succeeds.'),
                    !wireOpen && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'HOLD'), h('p', null, league.phase === 'draft' ? 'The wire opens after the first game day.' : league.phase === 'complete' ? 'Season complete — no more claims.' : 'Advance from the postgame recap to open waiver planning.')),
                    benchCap <= 0 && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'WARN'), h('p', null, 'No bench configured — choose a drop that opens an eligible starting slot.')),
                    target ? h(React.Fragment, null,
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' } },
                            h('span', { className: `tl-pos-badge tl-pos-${target.position}` }, target.position),
                            h('span', { style: { flex: 1 } }, h('strong', { style: { display: 'block', fontSize: 12.5 } }, target.name), h('small', { style: { color: 'var(--text-muted)' } }, 'ADD TARGET')),
                            h('span', { className: 'tabular', style: { color: 'var(--gold)' } }, fmt1(target.peak)),
                            h('button', { className: 'tl-btn icon', 'aria-label': 'Clear claim target', onClick: () => clearTarget('') }, '✕')),
                        h('select', { className: 'tl-select', 'aria-label': 'Drop entry', value: dropEntryId, onChange: (e) => setDropEntryId(e.target.value) },
                            h('option', { value: '' }, mustDrop ? 'SELECT A DROP — ROSTER IS FULL' : 'NO DROP (ELIGIBLE SLOT OPEN)'),
                            dropOptions.map((entry) => h('option', { key: entry.entryId, value: entry.entryId }, `DROP ${entry.name} (${entry.slot})`))),
                        faab && h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
                            h('span', { className: 'tl-label' }, 'Bid'),
                            h('span', { style: { color: 'var(--text-muted)' } }, '$'),
                            h('input', {
                                className: 'tl-input', type: 'number', min: 0, max: budgetAvailable, style: { width: 90 }, value: bidAmount,
                                onChange: (e) => setBidAmount(Math.max(0, Math.round(Number(e.target.value)) || 0)),
                            }),
                            h('span', { className: 'tabular', style: { color: 'var(--text-muted)', fontSize: 11 } }, `of $${budgetAvailable} available`)),
                        target && landingSlot && h('p',{className:'tl-hint'},`If awarded: ${target.name} enters ${landingSlot}${dropEntry ? ', replacing '+dropEntry.name : ''}.`),
                        alreadyClaimed && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'DUPE'), h('p', null, 'You already have a live claim on this player.')),
                        dropBlocks && dropEntry && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'WARN'), h('p', null, 'This drop does not open an eligible slot for the target. Choose a compatible player or a bench drop.')),
                        faab && bidAmount > budgetAvailable && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'WARN'), h('p', null, 'Bid exceeds your remaining FAAB budget.')),
                        h('button', { className: 'tl-btn primary', disabled: !canFile, onClick: fileClaim, style: { marginTop: 8 } }, filing ? 'FILING…' : '⚖ FILE CLAIM'))
                        : h('p', { className: 'tl-empty' }, 'Pick a target from the wire to build a claim.'),
                    h('p', { className: 'tl-hint', style: { marginTop: 8 } }, faab ? 'Blind bid — highest offer wins; ties break by worst record.' : 'Processing order: reverse standings — worst record first.')),
                h('div', { className: 'tl-card' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Pending claims'), h('small', null, others > 0 ? `+${others} filed by rival desks` : 'league quiet')),
                    mine.length ? h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null, h('th', null, 'Add'), h('th', null, 'Drop'), faab && h('th', { className: 'num' }, 'Bid'), h('th', { className: 'num' }, 'Wk'), h('th', null))),
                        h('tbody', null, mine.map((claim) => {
                            const drop = team.roster.find((e) => e.entryId === claim.dropEntryId);
                            return h('tr', { key: claim.claimId },
                                h('td', null, `${claim.addName} (${claim.addPosition})`), h('td', null, claim.dropEntryId ? drop?.name ?? claim.dropEntryId : '—'),
                                faab && h('td', { className: 'num tabular' }, `$${claim.bidAmount ?? 0}`),
                                h('td', { className: 'num' }, claim.week),
                                h('td', { className: 'num' }, h('button', { className: 'tl-btn icon', onClick: () => apply(Engine.cancelWaiverClaim(league, claim.claimId), { type: 'cancel-claim', claimId: claim.claimId }) }, '✕ CANCEL')));
                        })))
                        : h('p', { className: 'tl-empty' }, 'No claims on file from your desk.')),
                team.manager === 'ai' && h(GmProfile, { team, title: 'GM profile' }))));
    }

    function TradesSection({ league, cards, team, apply }) {
        const others = league.teams.filter((t) => t.teamId !== team.teamId);
        const [counterpartyId, setCounterpartyId] = useState(others.length ? others[0].teamId : '');
        const [giveIds, setGiveIds] = useState([]);
        const [receiveIds, setReceiveIds] = useState([]);
        const [note, setNote] = useState('');
        const [deskView, setDeskView] = useState('builder');
        const [search, setSearch] = useState('');
        const [position, setPosition] = useState('ALL');
        const [sending, setSending] = useState(false);
        const [message, setMessage] = useState('');
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
        const deskOpen = league.phase === 'season' && league.weekStage === 'claims';
        const responseOpen = league.phase === 'season' && league.weekStage === 'lineup';
        const counterparty = league.teams.find((t) => t.teamId === counterpartyId);
        const valueOf = (entry) => AI.entryValueFromCard(cards.get(entry.identity), revealed ? entry.drawnSeason : undefined);
        const give = giveIds.filter((id) => team.roster.some((e) => e.entryId === id));
        const receive = counterparty ? receiveIds.filter((id) => counterparty.roster.some((e) => e.entryId === id)) : [];
        const giveValue = give.reduce((sum, id) => sum + (entryById.has(id) ? valueOf(entryById.get(id)) : 0), 0);
        const receiveValue = receive.reduce((sum, id) => sum + (entryById.has(id) ? valueOf(entryById.get(id)) : 0), 0);
        const balanced = give.length > 0 && give.length === receive.length;
        const grade = fairnessGrade(giveValue, receiveValue);
        const toggle = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
        const sortByValue = (roster) => [...roster].sort((l, r) => valueOf(r) - valueOf(l) || l.entryId.localeCompare(r.entryId));
        const visibleRoster = roster => sortByValue(roster).filter(entry =>
            (position === 'ALL' || entry.position === position) && entry.name.toLowerCase().includes(search.trim().toLowerCase()));
        const pickRow = (entry, checked, onToggle) => h('label', { key: entry.entryId, className: `tl-trade-player${checked ? ' is-selected' : ''}` },
            h('input', { type: 'checkbox', checked, onChange: onToggle, disabled: !deskOpen || sending, 'aria-label': `Select ${entry.name}` }),
            h('span', { className: `tl-pos ${entry.position}` }, entry.position),
            h('span', { className: 'tl-trade-player-name' }, h('strong', null, entry.name),
                h('small', null, `${revealed ? entry.drawnSeason + ' season' : 'Sealed season'} · ${entry.slot}`)),
            h('span', { className: 'tabular' }, fmt1(valueOf(entry))));
        const teamById = (id) => league.teams.find((t) => t.teamId === id);
        const names = (ids) => ids.map((id) => entryById.get(id)?.name ?? id).join(', ') || '—';
        const pending = league.trades.filter((t) => t.status === 'pending' && (t.fromTeamId === team.teamId || t.toTeamId === team.teamId));
        const settled = league.trades.filter((t) => t.status !== 'pending').slice().reverse();
        const send = async () => {
            if (!counterparty || !balanced || sending || !deskOpen) return;
            const next = Engine.proposeTrade(league, { fromTeamId: team.teamId, toTeamId: counterparty.teamId, giveEntryIds: give, receiveEntryIds: receive, note }, nowIso());
            if (next === league) { setMessage('This offer cannot be submitted. Check the selected players.'); return; }
            setSending(true); setMessage('');
            try {
                const saved = await apply(next, { type: 'trade', teamId: team.teamId, toTeamId: counterparty.teamId, giveEntryIds: give, receiveEntryIds: receive, note });
                if (saved) { setGiveIds([]); setReceiveIds([]); setNote(''); setMessage('Offer sent. Follow the response in your inbox.'); setDeskView('inbox'); }
                else setMessage('Offer was not saved. Your selections are still here to try again.');
            } catch (_error) { setMessage('Offer could not be saved. Please try again.'); }
            finally { setSending(false); }
        };
        const side = (label, owner, ids, total, onToggle) => h('section', { className: 'tl-trade-side' },
            h('div', { className: 'tl-trade-side-head' }, h('div', null, h('small', null, label), h('h3', null, owner?.name || 'Choose a partner')),
                h('div', { className: 'tl-trade-total' }, h('strong', { className: 'tabular' }, fmt1(total)), h('small', null, revealed ? 'SEASON PTS' : 'REFERENCE PTS'))),
            h('div', { className: 'tl-trade-package' }, ids.length ? ids.map(id => h('button', { key: id, className: 'tl-trade-chip', disabled: sending, onClick: () => onToggle(id), 'aria-label': `Remove ${entryById.get(id)?.name}` }, entryById.get(id)?.name, ' ×')) : h('span', null, 'Select players below to build this side.')),
            h('div', { className: 'tl-trade-list-label' }, h('span', null, `ROSTER · ${owner?.roster.length || 0} PLAYERS`), h('span', null, revealed ? 'SEASON PTS' : 'REFERENCE PTS')),
            h('div', { className: 'tl-trade-player-list' }, owner && visibleRoster(owner.roster).map(entry => pickRow(entry, ids.includes(entry.entryId), () => onToggle(entry.entryId))),
                (!owner || !visibleRoster(owner.roster).length) && h('p', { className: 'tl-empty' }, 'No players match these filters.')));

        return h('div', { className: 'tl-trade-desk' },
            h('div', { className: 'tl-trade-toolbar' },
                h('div', null, h('span', { className: 'tl-label' }, 'TRADE CENTER'), h('strong', null, 'Build your next move')),
                h('nav', { className: 'tl-trade-tabs', 'aria-label': 'Trade center views' },
                    [['builder', 'Trade builder'], ['inbox', `Inbox · ${pending.length}`], ['history', 'Trade log']].map(([id, label]) => h('button', { key: id, className: `tl-btn${deskView === id ? ' primary' : ''}`, 'aria-pressed': deskView === id, onClick: () => setDeskView(id) }, label)))),
            message && h('p', { className: 'tl-trade-notice', role: 'status' }, message),
            deskView === 'builder' && h('div', { className: 'tl-card tl-trade-builder' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Trade builder'), h('small', null, deskOpen ? `W${league.currentWeek} · DESK OPEN` : 'DESK CLOSED')),
                h('div', { className: 'tl-trade-controls' },
                    h('label', null, h('span', { className: 'tl-label' }, 'PARTNER'),
                        h('select', { className: 'tl-select', value: counterpartyId, disabled: sending, onChange: e => { setCounterpartyId(e.target.value); setReceiveIds([]); } },
                            others.map(item => h('option', { key: item.teamId, value: item.teamId }, item.name)))),
                    h('input', { className: 'tl-input', placeholder: 'Search either roster…', 'aria-label': 'Search trade players', value: search, onChange: e => setSearch(e.target.value) }),
                    h('select', { className: 'tl-select', 'aria-label': 'Filter trade position', value: position, onChange: e => setPosition(e.target.value) },
                        ['ALL', ...POSITION_ORDER.filter(pos => [...team.roster, ...(counterparty?.roster || [])].some(entry => entry.position === pos))].map(pos => h('option', { key: pos, value: pos }, pos === 'ALL' ? 'All positions' : pos)))),
                h('div', { className: 'tl-trade-sides' },
                    side('YOU SEND', team, give, giveValue, id => setGiveIds(toggle(giveIds, id))),
                    side('YOU RECEIVE', counterparty, receive, receiveValue, id => setReceiveIds(toggle(receiveIds, id)))),
                h('div', { className: 'tl-trade-verdict' },
                    h('strong', null, balanced ? grade.label : 'Build both sides'),
                    h('span', null, `${give.length} for ${receive.length} · ${balanced ? `${receiveValue - giveValue >= 0 ? '+' : ''}${fmt1(receiveValue - giveValue)} points to your side` : 'Equal-count swaps keep roster sizes fixed.'}`),
                    h('small', null, 'Archived season points are a comparison, not a forecast or acceptance guarantee.')),
                h('div', { className: 'tl-trade-submit' },
                    h('input', { className: 'tl-input', 'aria-label': 'Trade offer note', placeholder: 'Add a note to your offer…', value: note, disabled: sending, onChange: e => setNote(e.target.value) }),
                    h('button', { className: 'tl-btn', disabled: sending || (!give.length && !receive.length), onClick: () => { setGiveIds([]); setReceiveIds([]); } }, 'Clear'),
                    h('button', { className: 'tl-btn primary', disabled: sending || !deskOpen || !balanced || !counterparty, onClick: send }, sending ? 'Sending…' : 'Send offer')),
                h('details', { className: 'tl-trade-gm' }, h('summary', null, `Know your partner · ${counterparty?.name || 'Opposing GM'}`),
                    counterparty?.manager === 'ai' ? h(GmProfile, { team: counterparty, title: 'Owner DNA' }) : h('p', null, 'Human manager — attach a note and negotiate directly.'))),
            h('div', { className: 'tl-trade-records', hidden: deskView === 'builder' },
                h('div', { className: 'tl-card', hidden: deskView !== 'inbox' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Inbox'), h('small', null, pending.length ? `${pending.length} PENDING` : 'DESK CLEAR')),
                    pending.map((trade) => {
                        const from = teamById(trade.fromTeamId); const to = teamById(trade.toTeamId);
                        const incoming = trade.toTeamId === team.teamId;
                        const toAi = to?.manager === 'ai';
                        const canRespond = responseOpen && !(trade.deferredUntilWeek > league.currentWeek);
                        return h('div', { key: trade.tradeId, style: { padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                                h('span', { className: `tl-pill ${incoming ? 'gold' : 'info'}` }, incoming ? 'INCOMING' : 'OUTGOING'),
                                h('span', { className: 'tl-label' }, `W${trade.week} · ${from?.name ?? trade.fromTeamId} → ${to?.name ?? trade.toTeamId}`)),
                            h('p', { style: { fontSize: 12, margin: '2px 0', color: 'var(--text-secondary)' } }, h('b', { style: { color: 'var(--white)' } }, from?.name ?? trade.fromTeamId), ` sends ${names(trade.giveEntryIds)}`),
                            h('p', { style: { fontSize: 12, margin: '2px 0 6px', color: 'var(--text-secondary)' } }, h('b', { style: { color: 'var(--white)' } }, to?.name ?? trade.toTeamId), ` sends ${names(trade.receiveEntryIds)}`),
                            trade.deferredUntilWeek > league.currentWeek && h('p', { className: 'tl-hint' }, `Delayed until Week ${trade.deferredUntilWeek}`),
                            trade.note && h('p', { style: { fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-faint, rgba(189,184,173,0.6))', margin: '0 0 6px' } }, `"${trade.note}"`),
                            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                                incoming && !toAi && h(React.Fragment, null,
                                    h('button', { className: 'tl-btn', disabled: !canRespond, onClick: () => apply(Engine.respondToTrade(league, trade.tradeId, true, '', nowIso()), { type: 'respond-trade', tradeId: trade.tradeId, accept: true }) }, '✓ ACCEPT'),
                                    h('button', { className: 'tl-btn', disabled: !canRespond, onClick: () => apply(Engine.respondToTrade(league, trade.tradeId, false, '', nowIso()), { type: 'respond-trade', tradeId: trade.tradeId, accept: false }) }, '✕ REJECT'),
                                    h('button', { className: 'tl-btn', disabled: !canRespond, onClick: () => apply(Engine.deferTrade(league, trade.tradeId), { type: 'respond-trade', tradeId: trade.tradeId, decision: 'delay' }) }, 'DELAY TO NEXT WEEK')),
                                toAi && h(React.Fragment, null,
                                    h('span', { className: 'tl-pill info' }, 'THE GM IS CONSIDERING'),
                                    h('button', { className: 'tl-btn', disabled: !canRespond, onClick: () => apply(AI.aiRespondToTrades(league, cards, nowIso()), { type: 'ping-ai' }) }, '📡 PING THE GM')),
                                !incoming && !toAi && h('span', { className: 'tl-pill info' }, 'AWAITING RESPONSE')));
                    }),
                    !pending.length && h('p', { className: 'tl-empty' }, 'No pending offers on the desk.')),
                h('div', { className: 'tl-card', hidden: deskView !== 'history' },
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

    const BADGE_TIERS = ['season', 'performance', 'roster', 'desk'];

    /** Mirrors War Room's real achievements.js chip grid (js/tabs/trophy-room.js
     * renderAchievementsCard) — tier-tinted, earned/unearned styling handled by
     * .tl-badge-chip.earned in CSS, grouped by tier with a progress bar for what's
     * still open. See js/shared/time-league-achievements.js for the catalog. */
    function AchievementsSection({ league, team }) {
        const Achievements = window.App.TimeLeagueAchievements;
        const stats = useMemo(() => Achievements.computeStats(league, team.teamId), [league, team.teamId]);
        const { earned, unearned } = useMemo(() => Achievements.evaluate(stats), [stats]);
        const all = [...earned, ...unearned];
        const badgeChip = (badge) => {
            const isEarned = badge.progress >= 1;
            return h('div', { key: badge.id, className: `tl-badge-chip${isEarned ? ' earned' : ''}`, style: { '--tier-color': Achievements.tierColor(badge.tier) } },
                h('span', { className: 'tl-badge-icon' }, badge.icon),
                h('div', { className: 'tl-badge-body' },
                    h('div', { className: 'tl-badge-label' }, badge.label, isEarned && h('span', { className: 'tl-pill gold' }, 'EARNED')),
                    h('div', { className: 'tl-badge-desc' }, badge.description),
                    !isEarned && h('div', { className: 'tl-badge-progress' }, h('div', { className: 'tl-badge-progress-fill', style: { width: `${Math.round(badge.progress * 100)}%` } })),
                    !isEarned && h('div', { className: 'tl-badge-desc' }, `${Math.round(badge.value * 10) / 10} / ${badge.target}`)));
        };
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Trophy Case'), h('small', null, `${earned.length}/${all.length} earned — ${team.name}`)),
            BADGE_TIERS.map((tierId) => {
                const tierBadges = all.filter((b) => b.tier === tierId).sort((a, b) => b.progress - a.progress);
                if (!tierBadges.length) return null;
                return h(React.Fragment, { key: tierId },
                    h('div', { className: 'tl-badge-tier-label' }, Achievements.tierLabel(tierId)),
                    h('div', { className: 'tl-badge-grid' }, tierBadges.map(badgeChip)));
            }));
    }

    function WrTimeLeagueTeamPanel({ league, cards, section, activeTeamId, onSelectTeam, onUpdate, onlineMeta, logIndex, eraFactors }) {
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const recordByTeam = useMemo(() => new Map(standings.map((s) => [s.teamId, s])), [standings]);
        const team = league.teams.find((t) => t.teamId === activeTeamId);
        const apply = (next, action) => { if (next !== league && (!onlineMeta || activeTeamId === onlineMeta.seatTeamId)) return onUpdate(next, action); };
        return h('div', null,
            h('nav', { style: { display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }, 'aria-label': 'Teams' },
                league.teams.map((item) => {
                    const record = recordByTeam.get(item.teamId);
                    const persona = item.aiPersona ? AI.AI_PERSONAS[item.aiPersona] : undefined;
                    return h('button', {
                        key: item.teamId, disabled: Boolean(onlineMeta && item.teamId !== onlineMeta.seatTeamId), onClick: () => onSelectTeam(item.teamId),
                        className: 'tl-card', style: {
                            flex: 'none', textAlign: 'left', cursor: 'pointer', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                            borderColor: item.teamId === activeTeamId ? 'var(--gold)' : undefined,
                        },
                    }, h(window.TimeLeagueHelmetIcon, { helmet: item.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(item.name), size: 24 }),
                        h('div', null, h('strong', { style: { display: 'block', fontSize: 12.5 } }, item.name),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 } },
                                item.manager === 'human' ? h('span', { className: 'tl-pill' }, 'HUMAN') : h('span', { className: `tl-pill ${PERSONA_PILL[item.aiPersona ?? 'steward']}` }, (persona?.label ?? 'AI').toUpperCase()),
                                record && h('small', { className: 'tabular', style: { color: 'var(--text-muted)' } }, `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`))));
                })),
            !team
                ? h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty' }, 'Unknown team — pick a desk above.'))
                : section === 'roster' ? h(RosterSection, { key: activeTeamId, league, cards, team, apply, logIndex, eraFactors })
                    : section === 'waivers' ? h(WaiversSection, { key: activeTeamId, league, cards, team, standings, apply })
                        : section === 'trades' ? h(TradesSection, { key: activeTeamId, league, cards, team, apply })
                            : h(AchievementsSection, { key: activeTeamId, league, team }));
    }

    window.WrTimeLeagueTeamPanel = WrTimeLeagueTeamPanel;
})();
