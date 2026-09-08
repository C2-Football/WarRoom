(function () {
    'use strict';
    const h = React.createElement;
    const fmt = value => value == null ? '—' : value.toFixed(1);
    function WrTimeLeagueStatsPanel({ league, cards, logIndex, eraFactors, throughWeek, onNavigate }) {
        const Stats = window.App.TimeLeaguePlayerStats;
        const [search, setSearch] = React.useState('');
        const [position, setPosition] = React.useState('ALL');
        const [team, setTeam] = React.useState('ALL');
        const [period, setPeriod] = React.useState('ytd');
        const [sort, setSort] = React.useState('points');
        const [ascending, setAscending] = React.useState(false);
        const [limit, setLimit] = React.useState(50);
        const weeks = Stats.completedWeeks(league, throughWeek);
        const effectivePeriod = period === 'ytd' || weeks.includes(Number(period)) ? period : 'ytd';
        const rows = React.useMemo(() => Stats.players(league, cards, logIndex, eraFactors, throughWeek, effectivePeriod), [league, cards, logIndex, eraFactors, throughWeek, effectivePeriod]);
        const filtered = Stats.filterAndSort(rows, { search, position, team, sort, ascending });
        const change = setter => event => { setter(event.target.value); setLimit(50); };
        const sortBy = key => { setAscending(sort === key ? !ascending : ['name', 'position', 'teamName'].includes(key)); setSort(key); };
        const columns = [['name', 'Player'], ['points', 'FPTS'], ['games', 'GP'], ['average', 'PPG'], ['teamName', 'Team'], ['position', 'Pos'], ['seasonPoints', 'SZN']];
        const statFields = position === 'K' ? [['fgm', 'FG'], ['xpm', 'XP']] : position === 'DEF' ? [['sack', 'Sacks'], ['int', 'INT']]
            : position === 'QB' ? [['passYd', 'Pass yd'], ['passTd', 'Pass TD'], ['passInt', 'INT'], ['rushYd', 'Rush yd']]
                : [['rushYd', 'Rush yd'], ['rushTd', 'Rush TD'], ['rec', 'Rec'], ['recYd', 'Rec yd'], ['recTd', 'Rec TD']];
        return h('section', { className: 'tl-card tl-player-stats', 'aria-label': 'Player statistics' },
            h('div', { className: 'tl-stats-heading' }, h('div', null, h('span', { className: 'tl-label' }, 'THE LEAGUE LEADERS'), h('h2', null, 'Player stats')),
                h('label', null, 'Period', h('select', { className: 'tl-select', value: effectivePeriod, onChange: change(setPeriod), 'aria-label': 'Stats period' }, h('option', { value: 'ytd' }, 'Year to date'), weeks.map(week => h('option', { key: week, value: week }, `Week ${week}`))))),
            h('div', { className: 'tl-stats-controls' },
                h('input', { className: 'tl-input', type: 'search', placeholder: 'Search players…', value: search, onChange: change(setSearch), 'aria-label': 'Search player stats' }),
                h('select', { className: 'tl-select', value: team, onChange: change(setTeam), 'aria-label': 'Filter stats by team' }, h('option', { value: 'ALL' }, 'All teams'), h('option', { value: 'fa' }, 'Free agents'), league.teams.map(item => h('option', { key: item.teamId, value: item.teamId }, item.name)))),
            h('div', { className: 'tl-stats-positions', 'aria-label': 'Filter stats by position' }, ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', ...(league.settings.rosterSlots.FLEX ? ['FLEX'] : []), ...(league.settings.rosterSlots.SUPER_FLEX ? ['SUPER_FLEX'] : [])].map(value => h('button', { key: value, type: 'button', className: `tl-btn${position === value ? ' primary' : ''}`, 'aria-pressed': position === value, onClick: () => { setPosition(value); setLimit(50); } }, value === 'DEF' ? 'D/ST' : value === 'SUPER_FLEX' ? 'Super flex' : value === 'ALL' ? 'All' : value))),
            h('p', { className: 'tl-hint' }, `${effectivePeriod === 'ytd' ? `Through ${weeks.length ? `Week ${weeks.at(-1)}` : 'preseason'}` : `Week ${effectivePeriod}`} · FPTS uses your league scoring, including bench production. SZN is the historical season reference. Free-agent editions match this week’s waiver wire.`),
            !logIndex || (league.settings.eraAdjusted && !eraFactors?.size) ? h('p', { role: 'status', className: 'tl-hint' }, 'Some historical data is still loading. Unavailable totals show —.') : null,
            h('div', { className: 'tl-stats-scroll', tabIndex: 0, 'aria-label': 'Player statistics table. Scroll for additional columns.' }, h('table', { className: 'tl-stats-table' },
                h('thead', null, h('tr', null, columns.map(([key, label]) => h('th', { key, scope: 'col', 'aria-sort': sort === key ? ascending ? 'ascending' : 'descending' : 'none' }, h('button', { type: 'button', onClick: () => sortBy(key) }, label, sort === key ? ascending ? ' ↑' : ' ↓' : ''))))),
                h('tbody', null, filtered.slice(0, limit).map((row, index) => h('tr', { key: `${row.teamId}:${row.identity}:${row.drawnSeason}` },
                    h('td', null, h('div', { className: 'tl-stats-player' }, h('small', null, index + 1), h('span', null, h('strong', null, row.name), h('small', null, `${row.position === 'DEF' ? 'D/ST' : row.position} · ${row.drawnSeason}`),
                        h('span', { className: 'tl-stats-details' }, statFields.filter(([key]) => row.stats[key] != null).map(([key, label]) => h('span', { key }, `${label} ${row.stats[key]}`)))))),
                    h('td', { className: 'tl-stats-points tabular' }, fmt(row.points)), h('td', null, row.games ?? '—'), h('td', { className: 'tabular' }, fmt(row.average)), h('td', null, row.teamName), h('td', null, row.position === 'DEF' ? 'D/ST' : row.position), h('td', { className: 'tabular' }, fmt(row.seasonPoints))))))),
            !filtered.length ? h('p', { className: 'tl-empty' }, league.seasonsRevealed ? 'No players match these filters.' : 'Player stats open after the draft reveal.') : null,
            h('div', { className: 'tl-stats-footer' }, h('small', null, `${Math.min(limit, filtered.length)} of ${filtered.length} players`), filtered.length > limit ? h('button', { className: 'tl-btn', onClick: () => setLimit(value => value + 50) }, 'Show more') : null,
                onNavigate ? h('button', { className: 'tl-btn', onClick: () => onNavigate('waivers') }, 'Open free agents →') : null));
    }
    window.WrTimeLeagueStatsPanel = WrTimeLeagueStatsPanel;
})();
