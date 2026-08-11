// ══════════════════════════════════════════════════════════════════
// js/components/time-league-activity-panel.js — window.WrTimeLeagueActivityPanel
// Ported from the ActivityPanel portion of The Duat's app/TimeLeagueView.tsx.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;

    function WrTimeLeagueActivityPanel({ league }) {
        const events = useMemo(() => [...league.activity].reverse().slice(0, 250), [league.activity]);
        const rowTone = (kind) => (kind === 'trade' ? ' caution' : kind === 'league' ? ' urgent' : '');
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'League Wire'), h('small', null, `${league.activity.length} entries · newest first`)),
            events.length === 0
                ? h('p', { className: 'tl-empty' }, 'Nothing on the wire yet.')
                : events.map((event) => h('div', { key: event.id, className: `tl-feedrow${rowTone(event.kind)}` },
                    h('time', null, `W${String(event.week).padStart(2, '0')} · ${event.kind.toUpperCase()}`),
                    h('p', null, event.message))));
    }

    window.WrTimeLeagueActivityPanel = WrTimeLeagueActivityPanel;
})();
