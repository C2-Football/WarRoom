(function () {
    'use strict';
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const Engine = window.App.TimeLeagueEngine;
    const SECONDS = [0, 15, 30, 60, 90, 120, 180, 300];
    const PACES = [[0.5, 'Fastest'], [1, 'Fast'], [2, 'Standard'], [4, 'Relaxed'], [8, 'Take your time']];
    const canControl = onlineMeta => !onlineMeta || onlineMeta.role === 'commissioner';
    const clockLabel = seconds => seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '0:00';

    function WrTimeLeagueDraftClock({ league, onlineMeta = null, saving = false, remainingSeconds = null, onAction }) {
        const [now, setNow] = useState(() => Date.now());
        const clock = league.draftClock || { status: 'waiting' };
        const duration = league.settings.draftPickSeconds ?? 60;
        const pace = league.settings.draftAiSeconds ?? 2;
        const isAuction = league.settings.draftFormat === 'auction';
        const editable = canControl(onlineMeta);
        const enabled = league.phase === 'draft' && !saving;
        const members = onlineMeta?.members || [];
        const waitingFor = members.filter(member => !member.joined || member.ready_week !== league.currentWeek).length;
        const roomReady = !onlineMeta || Boolean(onlineMeta.draftStarted && members.length && waitingFor === 0);
        useEffect(() => {
            if (remainingSeconds !== null || clock.status !== 'running' || !clock.deadlineAt || !duration) return undefined;
            setNow(Date.now());
            const timer = window.setInterval(() => setNow(Date.now()), 250);
            return () => window.clearInterval(timer);
        }, [clock.status, clock.deadlineAt, duration, remainingSeconds]);
        const deadline = Date.parse(clock.deadlineAt);
        const millis = clock.status === 'running' && Number.isFinite(deadline)
            ? deadline - now : clock.remainingMs ?? duration * 1000;
        const seconds = Math.max(0, Math.ceil(remainingSeconds !== null ? remainingSeconds : millis / 1000));
        const status = clock.status === 'paused' ? 'Paused' : clock.status === 'waiting' ? 'Ready when you are' : duration ? seconds ? 'On the clock' : 'Time expired' : 'Untimed draft';
        return h('section', { className: `tl-draft-clock${duration && seconds <= 10 && clock.status === 'running' ? ' is-urgent' : ''}${clock.status === 'paused' ? ' is-paused' : ''}`, 'aria-label': 'Draft clock' },
            h('div', { className: 'tl-draft-clock-face' },
                h('span', { className: 'tl-label' }, isAuction ? league.draftAuction?.nomination ? 'BID CLOCK' : 'NOMINATION CLOCK' : 'PICK CLOCK'),
                h('strong', { className: 'tabular', role: 'timer', 'aria-live': 'off', 'aria-label': duration ? `${seconds} seconds remaining` : 'Clock off' }, duration ? clockLabel(seconds) : 'OFF'),
                h('span', { className: 'tl-draft-clock-status', role: 'status' }, status)),
            h('div', { className: 'tl-draft-clock-tools' },
                editable && h('div', { className: 'tl-draft-clock-actions' },
                    clock.status === 'waiting'
                        ? h('button', { type: 'button', className: 'tl-btn primary', disabled: !enabled || !roomReady, onClick: () => onAction({ type: 'draft-clock-start' }) }, 'Start draft clock')
                        : h('button', { type: 'button', className: 'tl-btn', disabled: !enabled, onClick: () => onAction({ type: clock.status === 'paused' ? 'draft-clock-resume' : 'draft-clock-pause' }) }, clock.status === 'paused' ? 'Resume draft' : 'Pause draft')),
                h('div', { className: 'tl-draft-clock-settings' },
                    editable
                        ? h('label', null, h('span', null, isAuction ? 'Clock per bid' : 'Clock per pick'),
                            h('select', { className: 'tl-select', 'aria-label': 'Change draft clock duration', value: duration, disabled: !enabled, onChange: event => onAction({ type: 'draft-clock-settings', draftPickSeconds: Number(event.target.value) }) },
                                SECONDS.map(value => h('option', { key: value, value }, value ? `${value} seconds` : 'Off'))))
                        : h('p', { className: 'tl-hint' }, duration ? `${duration}s per ${isAuction ? 'bid' : 'pick'} · commissioner controls the clock` : 'No pick timer · commissioner controls the draft'),
                    !onlineMeta && h('label', null, h('span', null, 'AI pace'),
                        h('select', { className: 'tl-select', 'aria-label': 'Change AI draft pace', value: pace, disabled: !enabled, onChange: event => onAction({ type: 'draft-clock-settings', draftAiSeconds: Number(event.target.value) }) },
                            PACES.map(([value, label]) => h('option', { key: value, value }, `${label} · ${value}s`))))),
                h('p', { className: 'tl-hint' }, clock.status === 'waiting' && !roomReady
                    ? !onlineMeta?.draftStarted ? 'Waiting for the commissioner to open the draft.'
                        : waitingFor ? `Waiting for ${waitingFor} ${waitingFor === 1 ? 'manager' : 'managers'} to finish the reveal.` : 'Waiting for managers to finish the reveal.'
                    : clock.status === 'paused' ? 'The room is paused. Resume when everyone is ready.'
                    : isAuction ? 'Each new bid restarts the countdown.' : 'Your queue leads the auto-pick when time expires.')));
    }

    function WrTimeLeagueAuctionPanel({ league, cards, currentTeamId, onlineMeta = null, saving = false, onAction }) {
        const [query, setQuery] = useState('');
        const [target, setTarget] = useState('');
        const [amount, setAmount] = useState(1);
        const [now, setNow] = useState(() => Date.now());
        const [localViewer, setLocalViewer] = useState(() => ({ leagueId: league.leagueId, teamId: currentTeamId }));
        const humanTeams = league.teams.filter(team => team.manager === 'human');
        const nomination = league.draftAuction?.nomination || null;
        const nominationKey = nomination ? `${nomination.identity}:${nomination.highBid}` : '';
        useEffect(() => { setAmount(nomination ? nomination.highBid + 1 : 1); }, [nominationKey]);
        const localTeamId = localViewer.leagueId === league.leagueId && humanTeams.some(team => team.teamId === localViewer.teamId) ? localViewer.teamId : currentTeamId;
        const ownerId = onlineMeta ? onlineMeta.seatTeamId : localTeamId || humanTeams[0]?.teamId;
        const viewer = league.teams.find(team => team.teamId === ownerId && team.manager === 'human');
        const nominatorSeat = Engine.currentDraftSeat(league);
        const nominator = league.teams.find(team => team.teamId === nominatorSeat?.teamId);
        const highTeam = league.teams.find(team => team.teamId === nomination?.highTeamId);
        const card = nomination && cards?.get(nomination.identity);
        const maximum = viewer ? Engine.auctionMaxBid(league, viewer.teamId) : 0;
        const minimum = nomination ? nomination.highBid + 1 : 1;
        const clock = league.draftClock || { status: 'waiting' };
        const paused = clock.status === 'paused';
        const untimed = !league.settings.draftPickSeconds;
        const aiDue = Math.max(Date.parse(clock.startedAt) || 0, Date.parse(league.draftAuction?.lastAiAt) || 0) + (league.settings.draftAiSeconds || 2) * 1000;
        const aiDelayElapsed = now >= aiDue;
        // The engine previews every AI roster to decide whether bidding is done.
        // Cache that valuation until the lot changes or its waiting period ends.
        const canClose = useMemo(() => Boolean(nomination && untimed && aiDelayElapsed && Engine.auctionCanClose?.(league, cards, new Date(now).toISOString())), [league, cards, aiDelayElapsed]);
        useEffect(() => {
            if (!nomination || !untimed || clock.status !== 'running' || aiDelayElapsed) return undefined;
            setNow(Date.now());
            const timer = window.setInterval(() => setNow(Date.now()), 250);
            return () => window.clearInterval(timer);
        }, [nominationKey, untimed, clock.status, aiDelayElapsed]);
        const enabled = league.phase === 'draft' && !saving && clock.status === 'running';
        const isNominating = !nomination && viewer && nominator?.teamId === viewer.teamId;
        const canBid = Boolean(nomination && viewer && card && nomination.highTeamId !== viewer.teamId && maximum >= minimum && Engine.auctionCanBid(league, viewer.teamId, card));
        const eligible = useMemo(() => {
            if (!isNominating || !cards) return [];
            const term = query.trim().toLowerCase();
            return Engine.eraEligibleCards(league, cards).filter(item => Engine.auctionCanBid(league, viewer.teamId, item) && (!term || item.name.toLowerCase().includes(term))).slice(0, 30);
        }, [isNominating, league, cards, query, viewer?.teamId]);
        const selected = eligible.find(item => item.identity === target);
        const validBid = Number.isInteger(amount) && amount >= minimum && amount <= maximum;
        if (league.settings.draftFormat !== 'auction') return null;
        return h('section', { className: 'tl-auction-room', 'aria-label': 'Auction floor' },
            h('div', { className: 'tl-auction-stage' },
                h('div', { className: 'tl-auction-heading' }, h('span', { className: 'tl-label' }, 'THE AUCTION FLOOR'),
                    h('span', { className: 'tl-pill' }, paused ? 'DRAFT PAUSED' : nomination ? 'BIDDING OPEN' : 'NEXT NOMINATION')),
                !onlineMeta && humanTeams.length > 1 && h('label', { className: 'tl-field' }, h('span', { className: 'tl-label' }, 'You are bidding as'),
                    h('select', { className: 'tl-select', 'aria-label': 'Local auction manager', value: ownerId, disabled: saving, onChange: event => {
                        if (!humanTeams.some(team => team.teamId === event.target.value)) return;
                        setLocalViewer({ leagueId: league.leagueId, teamId: event.target.value }); setTarget(''); setQuery(''); setAmount(minimum);
                    } }, humanTeams.map(team => h('option', { key: team.teamId, value: team.teamId }, team.name)))),
                nomination
                    ? h('div', { className: 'tl-auction-lot' },
                        h('div', null, h('span', { className: 'tl-pill' }, nomination.position), h('h2', null, nomination.name),
                            h('p', { className: 'tl-hint' }, 'Mystery season · revealed after the draft')),
                        h('div', { className: 'tl-auction-high-bid' }, h('span', null, 'HIGH BID'), h('strong', { className: 'tabular' }, `$${nomination.highBid}`), h('span', null, highTeam?.name || 'No bidder')))
                    : h('div', { className: 'tl-auction-next' }, h('h2', null, isNominating ? 'Bring a legend to the floor.' : `${nominator?.name || 'The next manager'} nominates next.`), h('p', { className: 'tl-hint' }, 'A nomination opens the bidding to every eligible team.')),
                isNominating && h('form', { className: 'tl-auction-nominate', onSubmit: event => { event.preventDefault(); if (enabled && selected && validBid) onAction({ type: 'auction-nominate', teamId: viewer.teamId, identity: selected.identity, amount }); } },
                    h('label', null, h('span', null, 'Find a player to nominate'), h('input', { className: 'tl-input', type: 'search', placeholder: 'Search available legends', value: query, onChange: event => { setQuery(event.target.value); setTarget(''); } })),
                    h('select', { className: 'tl-select', 'aria-label': 'Choose nomination', value: target, onChange: event => setTarget(event.target.value), disabled: !enabled },
                        h('option', { value: '' }, eligible.length ? 'Choose a player' : 'No eligible players'), eligible.map(item => h('option', { key: item.identity, value: item.identity }, `${item.name} · ${item.position}`))),
                    h('div', { className: 'tl-auction-bid-input' },
                        h('label', null, h('span', null, 'Opening bid'), h('input', { className: 'tl-input', 'aria-label': 'Opening bid', type: 'number', min: 1, max: maximum, step: 1, value: amount, onChange: event => setAmount(event.target.value === '' ? '' : Number(event.target.value)) })),
                        h('button', { type: 'submit', className: 'tl-btn primary', disabled: !enabled || !selected || !validBid }, 'Nominate')),
                    h('p', { className: 'tl-hint' }, 'Or nominate directly from the draft board. Search narrows these options.')),
                nomination && h('div', { className: 'tl-auction-response' },
                    viewer && h('div', { className: 'tl-auction-buying-power' }, h('span', null, 'YOUR MAX BID'), h('strong', { className: 'tabular' }, `$${maximum}`), h('small', null, 'Reserves $1 per remaining roster spot.')),
                    canBid && h('form', { className: 'tl-auction-bid-input', onSubmit: event => { event.preventDefault(); if (enabled && validBid) onAction({ type: 'auction-bid', teamId: viewer.teamId, amount }); } },
                        h('label', null, h('span', null, `Bid $${minimum} or more`), h('input', { className: 'tl-input', 'aria-label': 'Your auction bid', type: 'number', min: minimum, max: maximum, step: 1, value: amount, onChange: event => setAmount(event.target.value === '' ? '' : Number(event.target.value)) })),
                        h('button', { type: 'submit', className: 'tl-btn primary', disabled: !enabled || !validBid }, 'Place bid')),
                    !canBid && h('p', { className: 'tl-hint', role: 'status' }, viewer?.teamId === nomination.highTeamId ? 'You hold the high bid.' : viewer ? 'This player does not fit your remaining roster or budget.' : 'Watch the bidding from your claimed team seat.')),
                nomination && untimed && canControl(onlineMeta) && h('div', null,
                    h('button', { type: 'button', className: 'tl-btn tl-auction-award', disabled: !enabled || !canClose, onClick: () => { if (canClose) onAction({ type: 'auction-close' }); } }, 'Finish bidding & award player'),
                    !canClose && clock.status === 'running' && h('p', { className: 'tl-hint', role: 'status' }, 'AI managers are considering their bids.')),
                paused && h('p', { className: 'tl-hint', role: 'status' }, 'Resume the draft to continue bidding.')),
            h('details', { className: 'tl-auction-budgets', open: true }, h('summary', null, 'Team budgets'),
                h('div', { className: 'tl-auction-budget-list' }, league.teams.map(team => {
                    const remaining = team.draftBudgetRemaining ?? league.settings.draftAuctionBudget ?? 200;
                    const slots = Math.max(0, Engine.rosterCapacity(league.settings) - team.roster.length);
                    return h('div', { key: team.teamId, className: `tl-auction-budget-row${team.teamId === ownerId ? ' is-you' : ''}` },
                        h('div', null, h('strong', null, team.name, team.teamId === ownerId ? ' · YOU' : ''), h('small', null, `${slots} ${slots === 1 ? 'spot' : 'spots'} open`)),
                        h('span', { className: 'tabular' }, `$${remaining}`));
                }))));
    }

    window.WrTimeLeagueDraftClock = WrTimeLeagueDraftClock;
    window.WrTimeLeagueAuctionPanel = WrTimeLeagueAuctionPanel;
})();
