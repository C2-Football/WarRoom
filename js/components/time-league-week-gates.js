(function () {
    'use strict';
    const h = React.createElement;
    const STAGES = [
        { id: 'claims', title: 'Bids & trades', action: 'process-claims', button: 'Run waivers', tab: 'waivers', open: 'Review bids' },
        { id: 'lineup', title: 'Decisions & lineup', action: 'finalize-rosters', button: 'Lock lineup', tab: 'roster', open: 'Set lineup' },
        { id: 'ready', title: 'Ready for kickoff', action: 'week', button: 'Start game day', tab: 'gameday', open: 'Go to game day' },
        { id: 'postgame', title: 'Week recap', action: 'advance-week', button: 'End week', tab: 'home', open: 'Week recap' },
    ];

    function WeekGates({ league, onlineMeta, saving, saveError, onRetrySave, dataReady, onAction, onNavigate, currentTab, teamId, playback, messageAction }) {
        const [showSettings, setShowSettings] = React.useState(false);
        if (!['season', 'complete'].includes(league.phase)) return null;
        const stage = STAGES.find(row => row.id === league.weekStage) || STAGES[2];
        const live = playback && !playback.done;
        const complete = league.phase === 'complete';
        const host = !onlineMeta || onlineMeta.role === 'commissioner';
        const humans = league.teams.filter(team => team.manager === 'human');
        const own = onlineMeta?.seatTeamId || teamId || humans[0]?.teamId;
        const incomingOffers = (league.trades || []).filter(trade => trade.status === 'pending' && trade.toTeamId === own && !(trade.deferredUntilWeek > league.currentWeek)).length;
        const tradeLabel = incomingOffers ? `${incomingOffers} trade offer${incomingOffers === 1 ? '' : 's'}` : stage.id === 'lineup' ? 'Trade decisions' : 'Trades';
        const mode = onlineMeta ? league.settings.advancementMode || 'commissioner' : 'commissioner';
        const votes = (league.gateVotes || []).filter(id => humans.some(team => team.teamId === id));
        const majority = Math.floor(humans.length / 2) + 1;
        const voted = votes.includes(onlineMeta?.seatTeamId);
        const week = live ? playback.week : league.weekStage === 'postgame' ? league.currentWeek - 1 : league.currentWeek;
        const deadline = new Date(Date.parse(league.gateStartedAt || league.createdAt) + (league.settings.gateHours || 24) * 3600000);
        const needsScreen = currentTab && currentTab !== stage.tab;
        const busy = saving || saveError;
        const disabled = busy || !dataReady;
        const go = (tab, label) => h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate(tab), disabled: busy }, label);
        const advance = () => onAction({ type: mode === 'majority' ? 'vote-advance' : stage.action });
        let primary, secondary;
        if (saveError) {
            primary = h('button', { type: 'button', className: 'tl-btn primary', disabled: saving, onClick: onRetrySave }, saving ? 'Saving…' : 'Retry save');
        } else if (live) {
            primary = currentTab !== 'gameday'
                ? go('gameday', playback.replay ? 'Watch replay' : 'Watch game')
                : h('button', { type: 'button', className: 'tl-btn primary', disabled: busy || !playback.nextQuarter, onClick: playback.nextQuarter }, 'Next quarter');
            secondary = currentTab === 'gameday' && h('button', { type: 'button', className: 'tl-btn', disabled: busy || !playback.toggle, onClick: playback.toggle }, playback.playing ? 'Pause' : 'Resume');
        } else if (complete) {
            primary = league.settings.hiddenYears && !league.yearsRevealed
                ? h('button', { type: 'button', className: 'tl-btn primary', disabled, onClick: () => onAction({ type: 'reveal-years' }) }, 'Reveal the years')
                : go(currentTab === 'home' ? 'gameday' : 'home', currentTab === 'home' ? 'Season recap' : 'View champion');
            if (league.settings.hiddenYears && !league.yearsRevealed) secondary = go('roster', 'My players');
        } else {
            primary = needsScreen ? go(stage.tab, stage.open)
                : h('button', { type: 'button', className: 'tl-btn primary', disabled: disabled || (mode === 'majority' ? voted : !host), onClick: advance },
                    saving ? 'Saving…' : mode === 'majority' ? voted ? 'Vote recorded' : stage.id === 'postgame' ? 'Vote to end week' : 'Vote to advance' : host ? stage.button : 'Waiting for commissioner');
            secondary = stage.id === 'postgame' ? (currentTab === 'home' ? go('gameday', 'Box scores') : null)
                : stage.id === 'claims' ? go(currentTab === 'trades' ? 'waivers' : 'trades', currentTab === 'trades' ? 'Waiver bids' : tradeLabel)
                    : stage.id === 'lineup' ? go('trades', tradeLabel) : null;
        }
        if (!saveError && !live && !incomingOffers && ['home', 'gameday'].includes(currentTab) && messageAction) secondary = messageAction;
        const title = saveError ? 'Save needs attention' : live ? `Q${playback.quarter || 1} · ${playback.playing ? 'Playing' : 'Paused'}${playback.replay ? ' · Replay' : ''}` : complete ? 'Season complete' : stage.id === 'postgame' ? `Week ${week} recap` : stage.title;
        const status = !live && !complete && onlineMeta ? mode === 'majority' ? `${votes.length}/${majority} votes` : mode === 'timed' ? `Deadline: ${deadline.toLocaleString()}` : host ? 'Commissioner' : 'Commissioner advances' : '';

        return h('footer', { className: 'tl-week-action-row', 'aria-label': 'Week actions' },
            h('div', { className: 'tl-week-action-inner' },
                h('div', { className: 'tl-week-action-status', role: 'status' },
                    h('small', null, `WEEK ${week}${!complete ? ` · ${live ? 3 : STAGES.indexOf(stage) + 1} OF 4` : ''}`),
                    h('strong', null, title), status && h('span', null, status)),
                h('div', { className: 'tl-week-action-buttons' }, secondary, primary),
                !live && !complete && h('div', { className: 'tl-week-action-more' },
                    h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': 'Week options', 'aria-expanded': showSettings, 'aria-controls': 'vault-week-options', onClick: () => setShowSettings(value => !value) }, '•••'),
                    showSettings && h('div', { className: 'tl-week-action-menu', id: 'vault-week-options' },
                        h('div', { className: 'tl-card-title' }, 'This week', h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': 'Close week options', onClick: () => setShowSettings(false) }, '×')),
                        h('ol', { className: 'tl-stage-track' }, STAGES.map((row, i) => h('li', { key: row.id, 'aria-current': row.id === stage.id ? 'step' : undefined, className: row.id === stage.id ? 'active' : '' }, h('span', null, i + 1), row.title))),
                        host && stage.id === 'ready' && h('button', { className: 'tl-btn', disabled: busy, onClick: () => { setShowSettings(false); onAction({ type: 'reopen-lineups' }); } }, 'Reopen lineups'),
                        host && mode !== 'commissioner' && h('button', { className: 'tl-btn', disabled, onClick: () => { setShowSettings(false); if (needsScreen) onNavigate(stage.tab); else onAction({ type: stage.action }); } }, `Commissioner override · ${stage.button}`),
                        onlineMeta && host && h('div', { className: 'tl-stage-settings' },
                            h('label', null, 'Advance stages by', h('select', { className: 'tl-select', value: mode, disabled: busy, onChange: event => onAction({ type: 'gate-settings', advancementMode: event.target.value, gateHours: league.settings.gateHours || 24 }) },
                                h('option', { value: 'commissioner' }, 'Commissioner'), h('option', { value: 'majority' }, 'Majority vote'), h('option', { value: 'timed' }, 'Time limit'))),
                            mode === 'timed' && h('label', null, 'Time per stage', h('select', { className: 'tl-select', value: league.settings.gateHours || 24, disabled: busy, onChange: event => onAction({ type: 'gate-settings', advancementMode: mode, gateHours: Number(event.target.value) }) }, [1, 6, 12, 24, 48, 72].map(hours => h('option', { key: hours, value: hours }, `${hours} hours`))))),
                        mode === 'timed' && h('p', { className: 'tl-hint' }, 'Deadlines are checked while a manager has the room open. Incomplete lineups need attention before advancing.')))));
    }
    window.WrTimeLeagueWeekGates = WeekGates;
})();
