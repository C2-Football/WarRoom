(function () {
    'use strict';
    const h = React.createElement;
    function CareerView({ index = [], league, onlineMeta, onOpenLocal, onOpenOnline }) {
        const [remoteRecords, setRemoteRecords] = React.useState({ userId: null, records: [] });
        const [loading, setLoading] = React.useState(false);
        const [error, setError] = React.useState('');
        const [refresh, setRefresh] = React.useState(0);
        const Career = window.App.TimeLeagueCareer;
        const Store = window.App.TimeLeagueCareerStore;
        const userId = window.App.OD?.getCurrentUserId?.();
        React.useEffect(() => {
            let cancelled = false;
            setRemoteRecords({ userId, records: [] }); setError('');
            if (!userId || !window.App.TimeLeagueRemote) { setLoading(false); return undefined; }
            setLoading(true);
            (async () => {
                try {
                    const remote = window.App.TimeLeagueRemote;
                    const owned = await remote.listMyOnlineLeagues();
                    const results = []; let cursor = 0, failed = 0;
                    await Promise.all(Array.from({ length: Math.min(4, owned.length) }, async () => {
                        while (cursor < owned.length) {
                            const item = owned[cursor++];
                            try {
                                const row = await remote.loadOnlineLeague(item.rowId);
                                const record = Career.recordFor({ league: row.state, mode: 'multiplayer', seatTeamId: row.seatTeamId, rowId: row.id });
                                if (record) results.push(record);
                            } catch { failed++; }
                        }
                    }));
                    if (cancelled || window.App.OD?.getCurrentUserId?.() !== userId) return;
                    for (const record of results) Store.save(record, `account:${userId}`);
                    setRemoteRecords({ userId, records: results });
                    if (failed) setError(`${failed} shared league${failed === 1 ? '' : 's'} could not refresh. Previously saved records are included where available.`);
                } catch (err) { if (!cancelled) setError(err.message || 'Shared league history could not load.'); }
                finally { if (!cancelled) setLoading(false); }
            })();
            return () => { cancelled = true; };
        }, [userId, refresh]);
        const records = [
            ...Store.read('solo:device'),
            ...(userId ? Store.read(`account:${userId}`) : []),
            ...index.flatMap(item => {
                const saved = window.TimeLeagueUtils.readLeague(item.leagueId);
                const record = saved && Career.recordFor({ league: saved, mode: 'solo', seatTeamId: saved.teams.find(team => team.manager === 'human')?.teamId });
                return record ? [record] : [];
            }),
            ...(remoteRecords.userId === userId ? remoteRecords.records : []),
        ];
        if (league && (!onlineMeta || (userId && onlineMeta.userId === userId))) {
            const record = Career.recordFor({ league, mode: onlineMeta ? 'multiplayer' : 'solo', seatTeamId: onlineMeta ? onlineMeta.seatTeamId : league.teams.find(team => team.manager === 'human')?.teamId, rowId: onlineMeta?.rowId });
            if (record) records.push(record);
        }
        return h('div', null,
            h('div', { className: 'tl-card-title' }, h('span', null, 'YOUR VAULT CAREER'), h('button', { className: 'tl-btn', disabled: loading, onClick: () => setRefresh(value => value + 1) }, 'Refresh history')),
            h('p', { className: 'tl-hint' }, 'Solo records belong to saves on this device. Shared records follow your signed-in account. Archived local history stays here after a save is removed.'),
            !userId && h('p', { className: 'tl-hint' }, 'Sign in to include your multiplayer leagues.'),
            h(window.WrTimeLeagueCareerPanel, { records, loading, error, onOpen: record => {
                if (record.archived) return;
                if (record.mode === 'multiplayer' && record.rowId) onOpenOnline(record.rowId);
                else onOpenLocal(record.leagueId);
            } }));
    }
    window.WrTimeLeagueCareerView = CareerView;
})();
