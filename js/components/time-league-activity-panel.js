// ══════════════════════════════════════════════════════════════════
// js/components/time-league-activity-panel.js — window.WrTimeLeagueActivityPanel
// Ported from the ActivityPanel portion of The Duat's app/TimeLeagueView.tsx,
// with a team avatar per entry added (Sleeper-style feed).
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;

    function WrTimeLeagueActivityPanel({ league }) {
        const events = useMemo(() => [...league.activity].reverse().slice(0, 250), [league.activity]);
        const rowTone = (kind) => (kind === 'trade' ? ' caution' : kind === 'league' ? ' urgent' : '');
        // Team names show up mid-message ("Waivers — X files a claim…"), not at the
        // start, so find whichever team is mentioned earliest rather than a prefix match.
        const teamFor = (message) => {
            let best = null; let bestIndex = Infinity;
            for (const team of league.teams) {
                const index = message.indexOf(team.name);
                if (index !== -1 && index < bestIndex) { best = team; bestIndex = index; }
            }
            return best;
        };
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'League Wire'), h('small', null, `${league.activity.length} entries · newest first`)),
            events.length === 0
                ? h('p', { className: 'tl-empty' }, 'Nothing on the wire yet.')
                : events.map((event) => {
                    const team = teamFor(event.message);
                    return h('div', { key: event.id, className: `tl-feedrow${rowTone(event.kind)}`, style: { alignItems: 'center' } },
                        team
                            ? h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 22 })
                            : h('time', null, `W${String(event.week).padStart(2, '0')}`),
                        h('p', { style: { flex: 1 } }, event.message),
                        h('time', { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' } }, event.kind.toUpperCase()));
                }));
    }

    window.WrTimeLeagueActivityPanel = WrTimeLeagueActivityPanel;
})();
