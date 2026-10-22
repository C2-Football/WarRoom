(function () {
    'use strict';
    const h = React.createElement;
    const Engine = window.App.TimeLeagueEngine;
    const STAGES = [
        { id: 'claims', title: 'Bids & trades', action: 'process-claims', button: 'Run waivers', tab: 'waivers', open: 'Review bids' },
        { id: 'lineup', title: 'Decisions & lineup', action: 'finalize-rosters', button: 'Lock lineup', tab: 'roster', open: 'Set lineup' },
        { id: 'ready', title: 'Ready for kickoff', action: 'week', button: 'Start game day', tab: 'gameday', open: 'Go to game day' },
        { id: 'postgame', title: 'Week recap', action: 'advance-week', button: 'End week', tab: 'home', open: 'Week recap' },
    ];

    function WeekGates({ league, onlineMeta, saving, authRequired, signInHref = 'login.html?vault=1&reauth=1', saveError, saveConflict, onRetrySave, dataReady, onAction, onNavigate, onReviewLineup, currentTab, teamId, playback, messageAction }) {
        const [showSettings, setShowSettings] = React.useState(false);
        const [reopeningPlanning, setReopeningPlanning] = React.useState(false);
        const [recoveryNotice, setRecoveryNotice] = React.useState('');
        const planningInFlight = React.useRef(false);
        if (!['season', 'complete'].includes(league.phase)) return null;
        const baseStage = STAGES.find(row => row.id === league.weekStage) || STAGES[2];
        const stage = baseStage.id === 'claims' && !league.settings.waiversEnabled
            ? { ...baseStage, title: league.settings.tradesEnabled ? 'Trade planning' : 'Planning window', button: 'Continue to lineup', tab: league.settings.tradesEnabled ? 'trades' : 'roster', open: league.settings.tradesEnabled ? 'Review trades' : 'Review team' }
            : baseStage;
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
        const readiness = Engine.lineupReadiness(league);
        const recovery = Engine.planningRecovery(league);
        const recoveryByTeam = new Map(recovery.teams.map(team => [team.teamId, team]));
        const blockers = !live && !complete && ['lineup', 'ready'].includes(stage.id) ? readiness.blockers : [];
        const ownBlocker = blockers.find(team => team.teamId === own);
        const hasBlockers = blockers.length > 0;
        const leadBlocker = ownBlocker || blockers[0];
        const hasUnfillable = blockers.some(team => recoveryByTeam.has(team.teamId));
        const repairLineup = (reviewTeamId = own) => {
            if (busy) return;
            if (onlineMeta && reviewTeamId !== own) return;
            if (onReviewLineup) onReviewLineup(reviewTeamId);
            else onNavigate('roster');
            if (typeof document === 'undefined') return;
            window.requestAnimationFrame?.(() => {
                const target = (recoveryByTeam.has(reviewTeamId) && document.querySelector('.tl-roster-recovery')) || document.querySelector('.tl-roster-open-slot:not(:disabled)') || document.querySelector('.tl-roster-problems > summary');
                if (!target) return;
                const details = target.closest('details');
                if (details) details.open = true;
                target.scrollIntoView?.({ block: 'center', behavior: 'auto' });
                target.focus?.({ preventScroll: true });
            });
        };
        const reopenLineups = async () => {
            if (busy || !host) return;
            setShowSettings(false);
            const saved = await onAction({ type: 'reopen-lineups' });
            if (saved !== false) repairLineup(!onlineMeta ? leadBlocker?.teamId || own : own);
        };
        const closeReadiness = event => {
            const details = event.currentTarget.closest('details');
            if (!details) return;
            details.open = false;
            details.querySelector('summary')?.focus();
        };
        const selectDisclosure = event => {
            for (const details of event.currentTarget.closest('footer')?.querySelectorAll('details[open]') || []) {
                if (details !== event.currentTarget.parentElement) details.open = false;
            }
        };
        const openPlanning = async () => {
            if (busy || planningInFlight.current || !host || !recovery.available) return;
            planningInFlight.current = true; setReopeningPlanning(true); setRecoveryNotice('');
            try {
                const saved = await onAction({ type: 'reopen-planning' });
                if (saved === false) setRecoveryNotice('Planning was not reopened. Resolve the save or review the current room, then try again.');
            } catch (_error) { setRecoveryNotice('Planning could not be reopened. Review the current room and try again.'); }
            finally { planningInFlight.current = false; setReopeningPlanning(false); }
        };
        const recoveryControl = h('details', { className: 'tl-gate-planning-recovery', onKeyDown: event => {
            if (event.key === 'Escape' && event.currentTarget.open && !reopeningPlanning) { event.preventDefault(); event.stopPropagation(); closeReadiness(event); }
        } },
            h('summary', { className: 'tl-btn', onClick: selectDisclosure }, 'Reopen planning'),
            h('div', { className: 'tl-planning-confirm-panel', role: 'region', 'aria-label': 'Confirm planning recovery' },
                h('strong', null, `Reopen Week ${league.currentWeek} planning?`),
                h('p', null, `Roster changes are needed for ${recovery.teams.map(team => team.name).join(', ')}. Human managers can ${league.settings.waiversEnabled ? 'file new waiver claims' : 'propose compatible trades'}.`),
                h('p', null, 'Existing waiver awards, settled trades, spent FAAB and completed games stay saved. Computer managers will not file another automatic waiver batch; existing trade offers can still receive answers.'),
                h('div', { className: 'tl-planning-confirm-actions' },
                    h('button', { type: 'button', className: 'tl-btn', disabled: reopeningPlanning || busy, onClick: closeReadiness }, 'Keep current stage'),
                    h('button', { type: 'button', className: 'tl-btn primary', disabled: reopeningPlanning || busy, onClick: openPlanning }, reopeningPlanning ? 'Reopening…' : 'Confirm reopen planning')),
                recoveryNotice && h('p', { role: 'status', 'aria-atomic': true }, recoveryNotice)));
        let primary, secondary;
        if (authRequired) {
            primary = h('a', { className: 'tl-btn primary', href: signInHref }, 'Sign in again');
        } else if (saveError) {
            primary = h('button', { type: 'button', className: 'tl-btn primary', disabled: saving, onClick: onRetrySave }, saving ? 'Saving…' : saveConflict ? 'Load latest save' : 'Retry save');
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
                : h('button', { type: 'button', className: 'tl-btn primary', disabled: disabled || (mode === 'majority' ? voted : !host || hasBlockers), 'aria-describedby': hasBlockers ? 'vault-lineup-blockers' : undefined, onClick: advance },
                    saving ? 'Saving…' : mode === 'majority' ? voted ? 'Vote recorded' : stage.id === 'postgame' ? 'Vote to end week' : 'Vote to advance' : host ? stage.button : 'Waiting for commissioner');
            secondary = stage.id === 'postgame' ? (currentTab === 'home' ? go('gameday', 'Box scores') : null)
                : stage.id === 'claims' ? currentTab === 'trades' && league.settings.waiversEnabled ? go('waivers', 'Waiver bids') : currentTab !== 'trades' && league.settings.tradesEnabled ? go('trades', tradeLabel) : null
                    : stage.id === 'lineup' && league.settings.tradesEnabled ? go('trades', tradeLabel) : null;
            if (hasUnfillable && host && recovery.available) secondary = recoveryControl;
            else if (hasBlockers && stage.id === 'ready' && host && !hasUnfillable) secondary = h('button', { type: 'button', className: 'tl-btn', disabled: busy, onClick: reopenLineups }, 'Reopen lineups');
            else if (ownBlocker) secondary = h('button', { type: 'button', className: 'tl-btn', disabled: busy, onClick: () => repairLineup() }, recoveryByTeam.has(own) ? 'Review roster need' : stage.id === 'ready' ? 'Review my lineup' : 'Fix my lineup');
        }
        if (!authRequired && !saveError && !live && !hasBlockers && !incomingOffers && ['home', 'gameday'].includes(currentTab) && messageAction) secondary = messageAction;
        const title = authRequired ? 'Sign-in required' : saveError ? 'Save needs attention' : live ? `Q${playback.quarter || 1} · ${playback.playing ? 'Playing' : 'Paused'}${playback.replay ? ' · Replay' : ''}` : complete ? 'Season complete' : recovery.active ? 'Roster recovery planning' : stage.id === 'postgame' ? `Week ${week} recap` : stage.title;
        const status = !authRequired && !live && !complete && onlineMeta ? mode === 'majority' ? `${votes.length}/${majority} votes` : mode === 'timed' ? `Deadline: ${deadline.toLocaleString()}` : host ? 'Commissioner' : 'Commissioner advances' : '';

        return h('footer', { className: `tl-week-action-row${hasBlockers && !authRequired && !saveError ? ' has-lineup-blockers' : ''}`, 'aria-label': 'Week actions' },
            h('div', { className: 'tl-week-action-inner' },
                !authRequired && !saveError && hasBlockers && h('details', { className: 'tl-gate-readiness', onKeyDown: event => {
                    if (event.key !== 'Escape' || !event.currentTarget.open) return;
                    event.preventDefault(); event.stopPropagation(); closeReadiness(event);
                } },
                    h('summary', { id: 'vault-lineup-blockers', onClick: selectDisclosure },
                        h('strong', null, `${leadBlocker.name}: ${recoveryByTeam.get(leadBlocker.teamId)?.problems[0] || leadBlocker.problems[0]}`),
                        h('span', null, `${blockers.length} manager${blockers.length === 1 ? '' : 's'} · Details`)),
                    h('div', { className: 'tl-gate-readiness-list', role: 'region', 'aria-label': 'Lineups needing attention' },
                        h('div', { className: 'tl-card-title' }, 'Before the league can advance', h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': 'Close lineup readiness', onClick: closeReadiness }, '×')),
                        blockers.map(team => h('div', { key: team.teamId }, h('strong', null, `${team.name}${team.teamId === own ? ' · Your team' : ''}`),
                            h('ul', null, (recoveryByTeam.get(team.teamId)?.problems || team.problems).map(problem => h('li', { key: problem }, problem))),
                            recoveryByTeam.has(team.teamId) && h('p', null, 'Roster changes are needed; moving the current players cannot fill every required slot.'),
                            (!onlineMeta || team.teamId === own) && h('button', { type: 'button', className: 'tl-btn', disabled: busy, onClick: () => repairLineup(team.teamId) }, recoveryByTeam.has(team.teamId) ? `Review ${team.name} roster` : `${stage.id === 'ready' ? 'Review' : 'Fix'} ${team.name} lineup`))),
                        h('p', null, hasUnfillable ? !recovery.available ? recovery.reason : host ? 'Use Reopen planning to review the recovery window. Settled history stays final.' : 'Ask the commissioner to reopen planning for these roster needs.' : stage.id === 'ready' ? host ? 'Reopen lineups so managers can make these changes.' : 'The commissioner must reopen lineups before managers can make changes.' : 'Each manager can repair their own team. A majority vote does not skip lineup validation.'))),
                h('div', { className: 'tl-week-action-status', role: 'status' },
                    h('small', null, `WEEK ${week}${!complete ? ` · ${live ? 3 : STAGES.indexOf(baseStage) + 1} OF 4` : ''}`),
                    h('strong', null, title), status && h('span', null, status)),
                h('div', { className: 'tl-week-action-buttons' }, secondary, primary),
                !authRequired && !live && !complete && h('div', { className: 'tl-week-action-more' },
                    h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': 'Week options', 'aria-expanded': showSettings, 'aria-controls': 'vault-week-options', onClick: () => setShowSettings(value => !value) }, '•••'),
                    showSettings && h('div', { className: 'tl-week-action-menu', id: 'vault-week-options' },
                        h('div', { className: 'tl-card-title' }, 'This week', h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': 'Close week options', onClick: () => setShowSettings(false) }, '×')),
                        h('ol', { className: 'tl-stage-track' }, STAGES.map((row, i) => h('li', { key: row.id, 'aria-current': row.id === stage.id ? 'step' : undefined, className: row.id === stage.id ? 'active' : '' }, h('span', null, i + 1), row.id === 'claims' && !league.settings.waiversEnabled ? league.settings.tradesEnabled ? 'Trade planning' : 'Planning window' : row.title))),
                        host && stage.id === 'ready' && !hasBlockers && h('button', { className: 'tl-btn', disabled: busy, onClick: reopenLineups }, 'Reopen lineups'),
                        host && mode !== 'commissioner' && h('button', { className: 'tl-btn', disabled: disabled || hasBlockers, onClick: () => { setShowSettings(false); if (needsScreen) onNavigate(stage.tab); else onAction({ type: stage.action }); } }, `Commissioner override · ${stage.button}`),
                        onlineMeta && host && h('div', { className: 'tl-stage-settings' },
                            h('label', null, 'Advance stages by', h('select', { className: 'tl-select', value: mode, disabled: busy, onChange: event => onAction({ type: 'gate-settings', advancementMode: event.target.value, gateHours: league.settings.gateHours || 24 }) },
                                h('option', { value: 'commissioner' }, 'Commissioner'), h('option', { value: 'majority' }, 'Majority vote'), h('option', { value: 'timed' }, 'Time limit'))),
                            mode === 'timed' && h('label', null, 'Time per stage', h('select', { className: 'tl-select', value: league.settings.gateHours || 24, disabled: busy, onChange: event => onAction({ type: 'gate-settings', advancementMode: mode, gateHours: Number(event.target.value) }) }, [1, 6, 12, 24, 48, 72].map(hours => h('option', { key: hours, value: hours }, `${hours} hours`))))),
                        mode === 'timed' && h('p', { className: 'tl-hint' }, 'Deadlines are checked while a manager has the room open. Incomplete lineups need attention before advancing.')))));
    }
    window.WrTimeLeagueWeekGates = WeekGates;
})();
