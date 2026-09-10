// Compact, read-only league results for Command Center. All polling goes
// through shared subscriptions so adding a second tile never doubles fetches.
(function () {
    'use strict';
    function LeagueProgressWidget({ kind, size = 'md', compact = false, currentLeague, myRoster, playersData, getOwnerName, navigateWidget, setActiveTab }) {
        const helper = window.App.DashboardLeagueData;
        const liveService = window.App.LeagueLiveScores;
        const week = liveService.currentWeek(currentLeague);
        const scoresEnabled = kind === 'league-stats' || kind === 'weekly-matchups';
        const live = liveService.useScores({ league: currentLeague, week, enabled: scoresEnabled });
        const cupData = helper.useCup({ league: currentLeague, enabled: kind === 'league-cup' });
        const small = size === 'sm';
        const large = ['lg', 'tall', 'xxl', 'xl'].includes(size);
        const theme = window.WrTheme?.get?.() || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const isNumber = value => value != null && Number.isFinite(Number(value));
        const record = row => `${isNumber(row.wins) ? row.wins : '—'}–${isNumber(row.losses) ? row.losses : '—'}${row.ties == null ? '–—' : row.ties ? `–${row.ties}` : ''}`;
        const points = value => isNumber(value) ? Number(value).toFixed(2) : '—';
        const go = () => {
            const target = kind === 'league-stats' ? 'stats' : kind;
            if (navigateWidget) navigateWidget(target);
            else setActiveTab?.(target === 'stats' ? 'stats' : 'central');
        };
        const titles = { 'league-stats': 'League stats', 'league-cup': 'League Cup', 'league-standings': 'Standings', 'weekly-matchups': 'Weekly matchups' };
        const actions = { 'league-stats': 'Explore stats', 'league-cup': 'Explore Cups', 'league-standings': 'View standings', 'weekly-matchups': 'All matchups' };
        let headline = '—', caption = '', secondary = '', rows = [], eyebrow = '', badge = '', status = '', updatedAt = null;
        let loading = false, error = false, stale = false, ready = false;
        if (kind === 'league-standings') {
            const standings = helper.standings({ league: currentLeague, myRoster, getOwnerName });
            const mine = standings.mine;
            ready = standings.hasResults;
            eyebrow = currentLeague?.season ? `${currentLeague.season} season` : 'League results';
            const preseasonRecord = !ready && mine && [mine.wins, mine.losses, mine.ties].every(value => value === 0);
            headline = ready && mine?.rank != null ? `#${mine.rank}` : preseasonRecord ? '0–0' : '—';
            caption = ready ? mine ? 'Your league standing' : 'Choose your team to follow its standing' : preseasonRecord ? 'Season record · No games final' : 'Awaiting league results';
            secondary = mine && ready ? `${record(mine)} record · ${points(mine.pf)} PF` : `${standings.rows.length} teams in the league`;
            rows = ready ? standings.rows.slice(0, 4).map(row => ({ key: row.id, label: row.name, sub: `${record(row)} · ${points(row.pf)} PF`, value: row.rank != null ? `#${row.rank}` : '—', mine: row.isMine })) : [];
            badge = 'W · L · T';
            status = 'From the latest league roster sync';
        } else if (kind === 'league-stats') {
            const stats = helper.stats({ live, playersData, myRoster, getOwnerName });
            const top = stats.leaders?.[0];
            const mine = Array.isArray(stats.mine) ? stats.mine[0] : stats.mine;
            ready = !!top;
            loading = ['idle', 'loading'].includes(stats.status) && !ready;
            stale = stats.status === 'stale'; error = !!stats.error || stats.status === 'error'; updatedAt = stats.updatedAt;
            eyebrow = `Week ${week} · Actual points`;
            headline = top ? points(top.points) : '—';
            caption = top ? top.name : loading ? 'Loading league leaders…' : live.supported === false ? 'Connect a Sleeper league' : error ? 'Weekly stats unavailable' : 'Awaiting reported player scores';
            secondary = top ? `${top.position || 'Player'}${top.team ? ` · ${top.team}` : ''} · League scoring leader` : 'League-rostered players';
            if (large && mine && top && mine.pid !== top.pid) secondary = `Your leader: ${mine.name} · ${points(mine.points)}`;
            rows = (stats.leaders || []).slice(0, 3).map(row => ({ key: row.pid, label: row.name, sub: `${row.position || 'Player'}${row.team ? ` · ${row.team}` : ''}${row.ownerNames?.length ? ` · ${row.ownerNames.join(', ')}` : ''}`, value: points(row.points), mine: row.isMine }));
            badge = 'PTS';
        } else if (kind === 'weekly-matchups') {
            const matchups = helper.matchups({ live, myRoster, getOwnerName });
            const matchup = matchups.mine || matchups.closeGames?.[0] || matchups.groups?.[0];
            ready = !!matchup;
            loading = ['idle', 'loading'].includes(matchups.status) && !ready;
            stale = matchups.status === 'stale'; error = !!matchups.error || matchups.status === 'error'; updatedAt = matchups.updatedAt;
            eyebrow = `Week ${week} · Actual points`;
            const mine = matchup?.teams.find(team => team.isMine), opponent = matchup?.teams.find(team => !team.isMine);
            const chopped = !!window.App?.Chopped?.isChopped?.(currentLeague);
            if (chopped) {
                const teams = (matchups.groups || []).flatMap(group => group.teams).sort((a, b) => (isNumber(b.points) ? Number(b.points) : -Infinity) - (isNumber(a.points) ? Number(a.points) : -Infinity));
                const myTeam = teams.find(team => team.isMine);
                headline = points(myTeam?.points ?? teams[0]?.points);
                caption = myTeam ? 'Your weekly score' : teams[0]?.name || (loading ? 'Loading scores…' : error ? 'Weekly scores unavailable' : 'Awaiting weekly scores');
                secondary = 'Survivor league · Weekly scoring race';
                rows = teams.slice(0, 4).map(team => ({ key: team.id, label: team.name, sub: 'Reported score', value: points(team.points), mine: team.isMine }));
            } else {
                headline = matchup ? matchup.teams.slice(0, 2).map(team => points(team.points)).join(' : ') : '—';
                caption = matchup ? mine ? opponent ? `Your matchup vs ${opponent.name}` : 'Your score · No opponent reported' : matchup.teams.map(team => team.name).join(' vs ') : loading ? 'Loading league scores…' : live.supported === false ? 'Connect a Sleeper league' : error ? 'Matchup scores unavailable' : 'Matchups not reported yet';
                secondary = matchup ? `${matchups.groups.length} league matchup${matchups.groups.length === 1 ? '' : 's'} · Scores may change` : 'Follow every team as scores arrive';
                rows = (matchups.groups || []).slice().sort((a, b) => Number(b.teams.some(t => t.isMine)) - Number(a.teams.some(t => t.isMine))).slice(0, 4).map(group => ({ key: group.id, label: group.teams.map(team => team.name).join(' vs '), sub: group.teams.length < 2 ? 'No opponent reported' : 'Actual points', value: group.teams.map(team => points(team.points)).join(' : '), mine: group.teams.some(team => team.isMine) }));
            }
            badge = 'SCORES';
        } else if (kind === 'league-cup') {
            const cup = helper.cup({ state: cupData.state, myRoster, engine: window.WoeppelCup, currentWeek: week, getOwnerName });
            ready = !!cup;
            loading = ['idle', 'loading'].includes(cupData.status) && !ready;
            stale = cupData.status === 'stale'; error = !!cupData.error || cupData.status === 'error'; updatedAt = cupData.updatedAt;
            eyebrow = ({ 'points': 'Total points', 'round-robin': 'Round robin', 'all-play': 'All-play', 'median': 'League median', 'knockout': 'Knockout', 'survivor': 'Survivor', 'legacy': 'Group stage + knockout' }[cup?.format] || 'Your league tournament');
            headline = cup ? ({ draft: 'Setup', paused: 'Paused', complete: 'Champion', active: 'In play', blocked: 'Needs review' }[cup.status] || 'Cup') : loading ? '…' : error || cupData.status === 'unsupported' ? 'Explore' : 'Start a Cup';
            caption = cup ? cup.name : loading ? 'Checking your league’s Cup…' : error ? 'Cup connection unavailable' : cupData.status === 'unsupported' ? 'Shared Cup connection unavailable' : 'Explore tournament formats';
            secondary = cup ? (typeof cup.myProgress === 'string' ? cup.myProgress : cup.detail || '') : error ? 'Open Cups to check the connection' : 'A separate competition for your league';
            if (cup?.status === 'complete' && cup.champion) secondary = typeof cup.champion === 'string' ? cup.champion : cup.champion.name || secondary;
            if (cup) {
                if (cup.detail && cup.detail !== secondary) rows.push({ key: 'detail', label: cup.detail, sub: '', value: '' });
                if (cup.nextWeek != null) rows.push({ key: 'next', label: 'Next Cup week', sub: '', value: `W${cup.nextWeek}` });
                if (cup.week != null && cup.nextWeek == null && cup.status !== 'complete') rows.push({ key: 'week', label: 'Cup week', sub: '', value: `W${cup.week}` });
            }
            badge = cup?.status === 'complete' ? 'FINISHED' : 'CUP';
        }
        if (scoresEnabled && !status) status = loading ? 'Checking Sleeper scores' : error || stale ? ready ? 'Last available scores · Refresh delayed' : 'Could not retrieve scores' : 'Sleeper · Updates every 30 sec';
        if (kind === 'league-cup') status = loading ? 'Checking shared Cup' : error || stale ? ready ? 'Last available Cup · Refresh delayed' : 'Could not retrieve Cup' : 'Shared league Cup';
        const date = updatedAt ? new Date(updatedAt) : null;
        const stamp = date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
        if (small) return <button type="button" className={`league-progress-widget lpw-sm lpw-clickable${compact ? ' lpw-compact' : ''}${error || stale ? ' lpw-stale' : ''}`} style={{ ...cardStyle, '--lpw-accent': theme.colors?.accent || 'var(--gold,#d4af37)' }} onClick={go} aria-label={`${actions[kind]}: ${caption}`}>
            <span className="lpw-header"><span>{titles[kind] || 'League progress'}</span>{!compact && <span className="lpw-badge">{badge}</span>}</span>
            <span className={`lpw-headline${kind === 'weekly-matchups' ? ' lpw-scoreline' : ''}${kind === 'league-cup' ? ' lpw-word' : ''}`}>{headline}</span>
            <span className="lpw-caption" title={caption}>{caption}</span>
            <span className="lpw-footer"><span className="lpw-freshness" title={status}>{scoresEnabled ? `Wk ${week} · ` : ''}{error || stale ? `Delayed${stamp ? ' · ' + stamp : ''}` : stamp ? `Checked ${stamp}` : kind === 'league-standings' ? secondary : eyebrow}</span><span className="lpw-open" aria-hidden="true">→</span></span>
        </button>;
        return <div className={`league-progress-widget lpw-${small ? 'sm' : large ? 'lg' : 'md'}${error || stale ? ' lpw-stale' : ''}`} style={{ ...cardStyle, '--lpw-accent': theme.colors?.accent || 'var(--gold,#d4af37)' }}>
            <div className="lpw-header"><span>{titles[kind] || 'League progress'}</span><span className="lpw-badge">{badge}</span></div>
            {!small && <div className="lpw-eyebrow">{eyebrow}</div>}
            <div className={`lpw-headline${kind === 'weekly-matchups' ? ' lpw-scoreline' : ''}${kind === 'league-cup' ? ' lpw-word' : ''}`}>{headline}</div>
            <div className="lpw-caption" title={caption}>{caption}</div>
            {!small && <div className="lpw-secondary" title={secondary}>{secondary}</div>}
            {large && rows.length > 0 && <div className="lpw-rows">{rows.map(row => <div key={row.key} className={`lpw-row${row.mine ? ' lpw-mine' : ''}`}><div><strong title={row.label}>{row.label}{row.mine && <span className="lpw-you">YOU</span>}</strong>{row.sub && <small title={row.sub}>{row.sub}</small>}</div><b>{row.value}</b></div>)}</div>}
            <div className="lpw-footer"><span className="lpw-freshness" title={`${status}${stamp ? ` · Checked ${stamp}` : ''}`}>{small ? (error || stale ? `Delayed${stamp ? ' · ' + stamp : ''}` : stamp ? `Checked ${stamp}` : '') : `${error || stale ? `Delayed${stamp ? ' · ' + stamp : ''}` : stamp ? `Checked ${stamp}` : status}`}</span><button type="button" aria-label={actions[kind]} onClick={go}>{small ? 'Open' : actions[kind]} <span aria-hidden="true">→</span></button></div>
        </div>;
    }
    window.LeagueProgressWidget = LeagueProgressWidget;
})();
