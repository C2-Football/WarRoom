// A replayable celebration built only from the league's saved results.
(function () {
    'use strict';
    const h = React.createElement;
    function championshipStory(league) {
        if (league.phase !== 'complete' || !league.championTeamId) return null;
        const champion = league.teams.find(team => team.teamId === league.championTeamId);
        if (!champion) return null;
        const weeks = [...(league.finalizedWeeks || [])].sort((a, b) => a.week - b.week);
        const postseason = weeks.filter(week => week.week > league.settings.regularSeasonWeeks);
        const finalWeek = postseason[postseason.length - 1];
        const final = finalWeek?.matchups.find(match => match.winner === champion.teamId);
        const runnerId = final && (final.home === champion.teamId ? final.away : final.home);
        const runner = league.teams.find(team => team.teamId === runnerId) || null;
        const path = postseason.flatMap(week => week.matchups.filter(match => match.home === champion.teamId || match.away === champion.teamId).map(match => ({ ...match, week: week.week })));
        const appearances = weeks.flatMap(week => week.matchups.filter(match => match.home === champion.teamId || match.away === champion.teamId));
        const record = { wins: 0, losses: 0, ties: 0 };
        appearances.forEach(match => { record[match.winner === null ? 'ties' : match.winner === champion.teamId ? 'wins' : 'losses']++; });
        const finalResult = finalWeek?.results.find(result => result.teamId === champion.teamId);
        const mvp = final ? [...(finalResult?.starters || [])].filter(player => Number.isFinite(player.points)).sort((a,b) => b.points - a.points)[0] || null : null;
        const points = weeks.reduce((sum, week) => sum + (week.results.find(result => result.teamId === champion.teamId)?.total || 0), 0);
        return { champion, runner, path, final, mvp, record, points };
    }
    function WrTimeLeagueCeremony({ league, onNavigate }) {
        const [dismissed, setDismissed] = React.useState(false);
        const story = championshipStory(league);
        if (!story) return null;
        const { champion, runner, path, final, mvp, record, points } = story;
        const name = id => league.teams.find(team => team.teamId === id)?.name || id;
        return h('section', { className: 'tl-ceremony' + (dismissed ? ' is-dismissed' : ''), 'aria-label': 'Championship ceremony' },
            h('div', { className: 'tl-ceremony-heading' }, h('span', { className: 'tl-eyebrow' }, 'THE VAULT · CHAMPIONSHIP NIGHT'),
                h('button', { type: 'button', className: 'tl-btn', 'aria-expanded': !dismissed, onClick: () => setDismissed(!dismissed) }, dismissed ? 'REPLAY CEREMONY' : 'MINIMIZE CEREMONY')),
            dismissed ? h('h2', null, `🏆 ${champion.name} · Champion`) : h(React.Fragment, null,
                h('div', { className: 'tl-ceremony-stage' },
                    h('div', { className: 'tl-ceremony-laurels', 'aria-hidden': true }, '✦  🏆  ✦'),
                    window.TimeLeagueHelmetIcon && h(window.TimeLeagueHelmetIcon, { helmet: champion.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(champion.name), size: 96 }),
                    h('p', { className: 'tl-eyebrow' }, league.name), h('h2', null, champion.name),
                    h('p', { className: 'tl-ceremony-crown' }, 'CROWNED VAULT CHAMPION'),
                    h('p', null, final && runner ? `${champion.name} takes the title over ${runner.name}, ${Math.max(final.homePoints, final.awayPoints).toFixed(1)}–${Math.min(final.homePoints, final.awayPoints).toFixed(1)}.${final.homePoints === final.awayPoints ? ' The higher seed wins the tiebreaker.' : ''}` : 'The season is complete. The standings have their champion.')),
                h('div', { className: 'tl-ceremony-honors' },
                    h('div', null, h('small', null, 'TITLE RUN RECORD'), h('strong', null, `${record.wins}–${record.losses}${record.ties ? '–' + record.ties : ''}`), h('span', null, 'Regular season + playoffs')),
                    h('div', null, h('small', null, 'POINTS SCORED'), h('strong', null, points.toFixed(1)), h('span', null, 'Across all saved games')),
                    runner && h('div', null, h('small', null, 'RUNNER-UP'), h('strong', null, runner.name), h('span', null, 'Championship finalist')),
                    mvp && h('div', null, h('small', null, 'TITLE GAME LINEUP MVP'), h('strong', null, mvp.name), h('span', null, `${mvp.drawnSeason} · ${mvp.points.toFixed(1)} points`))),
                path.length > 0 && h('div', { className: 'tl-ceremony-path' }, h('h3', null, 'The road to the trophy'), path.map((match, index) => h('div', { key: match.week },
                    h('small', null, index === path.length - 1 ? 'CHAMPIONSHIP' : `PLAYOFF ROUND ${index + 1}`), h('strong', null, `${name(match.home)} ${match.homePoints.toFixed(1)} — ${match.awayPoints.toFixed(1)} ${name(match.away)}`), h('span', null, `Week ${match.week}`)))),
                onNavigate && h('div', { className: 'tl-ceremony-actions' }, h('button', { type: 'button', className: 'tl-btn primary', onClick: () => onNavigate('gameday') }, 'RELIVE THE GAMES →'), h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('achievements') }, 'TROPHY CASE'))));
    }
    window.App.TimeLeagueChampionshipStory = championshipStory;
    window.WrTimeLeagueCeremony = WrTimeLeagueCeremony;
})();
