(function () {
    'use strict';
    const h = React.createElement;
    const STAGES = [
        { id: 'claims', title: 'Bids & trade requests', detail: 'Submit waiver bids and propose trades. All managers use the same pool before claims run.', action: 'process-claims', button: 'Run waiver claims', tab: 'waivers' },
        { id: 'lineup', title: 'Decisions & lineup', detail: 'Review waiver results. Accept, delay or reject trades, then set your final lineup.', action: 'finalize-rosters', button: 'Finalize rosters', tab: 'roster' },
        { id: 'ready', title: 'Game day', detail: 'Rosters are locked. Watch this week unfold.', action: 'week', button: 'Start game day', tab: 'gameday' },
        { id: 'postgame', title: 'Final & advance', detail: 'Review the final scores and weekly recap before opening the next bidding window.', action: 'advance-week', button: 'Advance week', tab: 'home' },
    ];
    function WeekGates({ league, onlineMeta, saving, dataReady, onAction, onNavigate, compact = false, currentTab }) {
        const [showSettings, setShowSettings] = React.useState(false);
        if (league.phase !== 'season') return null;
        const stage = STAGES.find(row => row.id === league.weekStage) || STAGES[2];
        const host = !onlineMeta || onlineMeta.role === 'commissioner';
        const humans = league.teams.filter(team => team.manager === 'human');
        const mode = onlineMeta ? league.settings.advancementMode || 'commissioner' : 'commissioner';
        const votes = (league.gateVotes || []).filter(id => humans.some(team => team.teamId === id));
        const majority = Math.floor(humans.length / 2) + 1;
        const week = league.weekStage === 'postgame' ? league.currentWeek - 1 : league.currentWeek;
        const deadline = new Date(Date.parse(league.gateStartedAt || league.createdAt) + (league.settings.gateHours || 24) * 3600000);
        const content = h('section', { className: 'tl-stage-gates tl-card', 'aria-label': 'Weekly stages' },
            h('div', { className: 'tl-card-title' }, h('span', null, `WEEK ${week} · ${stage.title}`), h('small', null, `${STAGES.indexOf(stage) + 1} OF 4`)),
            h('ol', { className: 'tl-stage-track' }, STAGES.map((row, i) => h('li', { key: row.id, 'aria-current': row.id === stage.id ? 'step' : undefined, className: row.id === stage.id ? 'active' : '' }, h('span', null, i + 1), row.title))),
            h('p', null, stage.detail),
            onlineMeta && mode === 'majority' && h('p', { className: 'tl-hint', role: 'status' }, `${votes.length} of ${majority} votes needed to advance · ${humans.length} human managers`),
            onlineMeta && mode === 'timed' && h('p', { className: 'tl-hint' }, `Deadline: ${deadline.toLocaleString()} · Checked while a manager has the room open; overdue stages resume when someone returns. Incomplete lineups need attention before advancing.`),
            h('div', { className: 'tl-stage-actions' },
                currentTab !== stage.tab && h('button', { className: 'tl-btn', onClick: () => onNavigate(stage.tab) }, stage.tab === 'home' ? 'Read weekly recap' : stage.tab === 'gameday' ? 'Open game day' : stage.tab === 'roster' ? 'Review roster' : 'Open waiver bids'),
                mode === 'majority' && h('button', { className: 'tl-btn primary', disabled: saving || !dataReady || votes.includes(onlineMeta?.seatTeamId), onClick: () => onAction({ type: 'vote-advance' }) }, votes.includes(onlineMeta?.seatTeamId) ? 'Vote recorded' : 'Vote to advance'),
                host && h('button', { className: 'tl-btn primary', disabled: saving || !dataReady, onClick: () => onAction({ type: stage.action }) }, onlineMeta && mode !== 'commissioner' ? `Commissioner override · ${stage.button}` : stage.button),
                host && stage.id === 'ready' && h('button', { className: 'tl-btn', disabled: saving, onClick: () => onAction({ type: 'reopen-lineups' }) }, 'Reopen lineups'),
                onlineMeta && host && h('button', { className: 'tl-btn', onClick: () => setShowSettings(value => !value) }, 'Advancement settings')),
            showSettings && h('div', { className: 'tl-stage-settings' },
                h('label', null, 'Advance stages by', h('select', { className: 'tl-select', value: mode, disabled: saving, onChange: event => onAction({ type: 'gate-settings', advancementMode: event.target.value, gateHours: league.settings.gateHours || 24 }) },
                    h('option', { value: 'commissioner' }, 'Commissioner'), h('option', { value: 'majority' }, 'Majority vote'), h('option', { value: 'timed' }, 'Time limit'))),
                mode === 'timed' && h('label', null, 'Time per stage', h('select', { className: 'tl-select', value: league.settings.gateHours || 24, disabled: saving, onChange: event => onAction({ type: 'gate-settings', advancementMode: mode, gateHours: Number(event.target.value) }) }, [1, 6, 12, 24, 48, 72].map(hours => h('option', { key: hours, value: hours }, `${hours} hours`))))));
        return compact ? h('details', { className: 'tl-stage-compact' },
            h('summary', null, h('span', null, `Week ${week} · ${stage.title}`), h('small', null, 'Manage week')), content) : content;
    }
    window.WrTimeLeagueWeekGates = WeekGates;
})();
