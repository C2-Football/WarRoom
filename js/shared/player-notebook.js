// Private player research and contextual handoffs shared by roster, waivers and draft.
(function () {
    'use strict';
    const WR = window.WR = window.WR || {};
    const lidOf = league => String(league?.league_id || league?.id || window.S?.currentLeagueId || '');
    function accountKey() {
        const platform = window.S?.platform || 'sleeper';
        const authenticated = (window.App?.OD || window.OD)?.getCurrentUserId?.();
        // MFL/ESPN roster owner IDs are league-local franchises, not account IDs.
        const owner = authenticated ? 'account:' + authenticated : platform === 'sleeper' && window.S?.user?.user_id ? 'sleeper:' + window.S.user.user_id : null;
        return owner ? [platform, owner].map(encodeURIComponent).join('_') : null;
    }
    const key = () => accountKey() ? 'wr_player_notebook_v1_' + accountKey() : null;
    const empty = () => ({ version: 1, personal: {}, leagues: {} });
    const storage = () => window.App?.WrStorage;
    function read() {
        const raw = key() ? storage()?.get?.(key(), null) : null;
        return raw?.version === 1 && raw.personal && raw.leagues ? raw : empty();
    }
    function write(data, detail) {
        if (!key() || !storage()?.set) return false;
        storage().set(key(), data);
        // WrStorage catches quota errors; verify persistence before saying Saved.
        if (JSON.stringify(storage().get(key(), null)) !== JSON.stringify(data)) return false;
        window.dispatchEvent(new CustomEvent('wr:player-notebook-changed', { detail }));
        return true;
    }
    function bucket(data, scope, leagueId, create) {
        if (scope === 'personal') return data.personal;
        if (!leagueId) return {};
        if (create && !data.leagues[leagueId]) data.leagues[leagueId] = {};
        return data.leagues[leagueId] || {};
    }
    function get(pid, { scope = 'league', leagueId = lidOf() } = {}) {
        return bucket(read(), scope, String(leagueId), false)[String(pid)] || {};
    }
    function update(pid, patch, { scope = 'league', leagueId = lidOf() } = {}) {
        if (pid == null || (scope !== 'personal' && !leagueId)) return false;
        const data = read();
        const items = bucket(data, scope, String(leagueId), true);
        const prev = items[String(pid)] || {};
        items[String(pid)] = {
            ...prev,
            ...(typeof patch.note === 'string' ? { note: patch.note.slice(0, 12000) } : {}),
            ...(typeof patch.watch === 'boolean' ? { watch: patch.watch } : {}),
            updatedAt: Date.now(),
        };
        return write(data, { pid: String(pid), leagueId: String(leagueId), scope });
    }
    function isWatched(pid, leagueId = lidOf()) {
        return !!(get(pid, { scope: 'personal' }).watch || get(pid, { leagueId }).watch);
    }
    function list(leagueId = lidOf()) {
        const data = read();
        const local = data.leagues[String(leagueId)] || {};
        return [...new Set([...Object.keys(data.personal), ...Object.keys(local)])]
            .map(pid => ({ pid, personal: data.personal[pid] || {}, league: local[pid] || {} }))
            .filter(row => row.personal.watch || row.league.watch || row.personal.note || row.league.note);
    }
    // Retain original draft tags and source notes; never replace a user's notebook edit.
    // Legacy stores are left untouched, including board order and draft-only tags.
    function migrateDraft(leagueId, source, board) {
        if (!leagueId || !source || !board) return false;
        const owner = accountKey();
        if (!owner) return false;
        const claimKey = 'wr_notebook_import_owner_' + encodeURIComponent(window.S?.platform || 'sleeper') + '_' + encodeURIComponent(source);
        const priorOwner = storage()?.get?.(claimKey, null);
        if (priorOwner && priorOwner !== owner) return false;
        const data = read();
        const items = bucket(data, 'league', String(leagueId), true);
        let changed = false;
        const ids = new Set([...Object.keys(board.notes || {}), ...Object.keys(board.tags || {}), ...Object.keys(items).filter(pid => items[pid].draftSources?.[source])]);
        ids.forEach(pid => {
            const note = typeof board.notes?.[pid] === 'string' ? board.notes[pid] : '';
            const tag = typeof board.tags?.[pid] === 'string' ? board.tags[pid] : '';
            const prev = items[pid] || {};
            if (!note && !tag && !prev.draftSources?.[source]) return;
            const imported = { note, tag };
            if (JSON.stringify(prev.draftSources?.[source]) === JSON.stringify(imported)) return;
            items[pid] = {
                ...prev,
                ...(prev.note === undefined && note ? { note } : {}),
                ...(prev.watch === undefined && ['target', 'sleeper', 'must'].includes(tag) ? { watch: true } : {}),
                draftSources: { ...(prev.draftSources || {}), [source]: imported },
            };
            changed = true;
        });
        if (!changed) return false;
        if (!priorOwner) storage()?.set?.(claimKey, owner);
        return write(data, { leagueId: String(leagueId), source: 'draft-import' });
    }
    function migrateLeague(leagueId = lidOf()) {
        if (!leagueId || !accountKey()) return;
        const prefix = 'wr_bigboard_' + leagueId;
        try {
            const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
            keys.filter(k => k === prefix || k?.startsWith(prefix + '_')).forEach(k => {
                migrateDraft(leagueId, k, storage()?.get?.(k, null));
            });
            const tags = storage()?.get?.('player_tags_' + leagueId, {}) || {};
            const liveTags = String(window.S?.currentLeagueId) === String(leagueId) ? window._playerTags || {} : {};
            const claimKey = 'wr_notebook_tag_import_owner_' + encodeURIComponent(window.S?.platform || 'sleeper') + '_' + encodeURIComponent(leagueId);
            const priorOwner = storage()?.get?.(claimKey, null);
            if (priorOwner && priorOwner !== accountKey()) return;
            const watches = Object.entries({ ...tags, ...liveTags }).filter(([, tag]) => tag === 'watch');
            if (watches.length && !priorOwner) storage()?.set?.(claimKey, accountKey());
            watches.forEach(([pid, tag]) => {
                if (tag === 'watch' && get(pid, { leagueId }).watch === undefined) update(pid, { watch: true }, { leagueId });
            });
        } catch (_) { /* Old or unavailable browser storage cannot block research. */ }
    }
    function resolveAction({ pid, league = {}, rosters, myRosterId, context, features = {} } = {}) {
        const source = typeof context === 'string' ? context : context?.source || '';
        const allRosters = rosters || league.rosters;
        const owns = roster => ['players', 'taxi', 'reserve'].some(k => (roster?.[k] || []).some(id => String(id) === String(pid)));
        const owners = (allRosters || []).filter(owns);
        const mine = owners.some(roster => String(roster.roster_id) === String(myRosterId));
        const owner = (mine ? owners.find(roster => String(roster.roster_id) === String(myRosterId)) : owners[0]);
        const trades = features.showTrades !== false && Number(league.settings?.type) !== 3 && Number(league.settings?.disable_trades || 0) !== 1;
        if (source.includes('draft') || String(pid).startsWith('csv_')) return { kind: 'draft', label: 'View on draft board', owner, mine: !!mine };
        const ownershipComplete = Array.isArray(allRosters) && allRosters.length > 0 && allRosters.every(r => Array.isArray(r.players));
        if (!mine && ownershipComplete && owners.length < Math.max(1, Number(league.settings?.player_copies) || 1)) return { kind: 'waiver', label: 'Plan waiver', mine: false };
        if (owner && trades) return { kind: 'trade', label: mine ? 'Explore trades' : 'Find trade', owner, mine: !!mine };
        if (owner && mine) return { kind: 'waiver', label: 'Find an upgrade', dropPid: String(pid), owner, mine: true };
        if (owner) return { kind: 'watch', label: 'Watch player', owner, mine: false };
        // A missing ownership snapshot is not proof that a player is available.
        if (!ownershipComplete) return { kind: 'watch', label: 'Watch player', mine: false };
        return { kind: 'waiver', label: 'Plan waiver', mine: false };
    }
    function normalizeContext(context = {}) {
        return {
            leagueId: String(context.leagueId || lidOf()),
            pid: context.pid == null ? null : String(context.pid),
            position: String(context.position || ''),
            week: Number(context.week) > 0 ? Number(context.week) : null,
            dropPid: context.dropPid == null ? null : String(context.dropPid),
            reason: String(context.reason || ''), source: String(context.source || 'player-card'),
            ts: Date.now(),
        };
    }
    function navigate(tab) {
        if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab(tab);
        else if (typeof window.setActiveTab === 'function') window.setActiveTab(tab);
    }
    WR.openAcquisition = function (context) {
        const next = normalizeContext(context);
        WR.acquisitionContext = next;
        navigate('fa');
        window.dispatchEvent(new CustomEvent('wr:acquisition-context', { detail: next }));
        return next;
    };
    WR.openDraftPlayer = function (context) {
        const next = normalizeContext(context);
        WR.draftPlayerContext = next;
        navigate('draft');
        window.dispatchEvent(new CustomEvent('wr:draft-player-context', { detail: next }));
        return next;
    };
    function contextFor(context, leagueId) {
        return context && String(context.leagueId) === String(leagueId) ? context : null;
    }

    function NotebookEditor({ pid, leagueId = lidOf(), leagueName = 'This league', compact = false }) {
        const viewer = accountKey();
        const [scope, setScope] = React.useState(leagueId ? 'league' : 'personal');
        const [revision, refresh] = React.useState(0);
        const [error, setError] = React.useState(false);
        const [note, setNote] = React.useState(() => get(pid, { scope, leagueId }).note || '');
        React.useEffect(() => {
            const changed = () => refresh(n => n + 1);
            window.addEventListener('wr:player-notebook-changed', changed);
            window.addEventListener('storage', changed);
            migrateLeague(leagueId);
            refresh(n => n + 1);
            return () => { window.removeEventListener('wr:player-notebook-changed', changed); window.removeEventListener('storage', changed); };
        }, [pid, leagueId, viewer]);
        React.useEffect(() => { setNote(get(pid, { scope, leagueId }).note || ''); setError(false); }, [pid, leagueId, scope, revision, viewer]);
        const entry = get(pid, { scope, leagueId });
        const other = get(pid, { scope: scope === 'personal' ? 'league' : 'personal', leagueId });
        const save = patch => { const ok = viewer === accountKey() && update(pid, patch, { scope, leagueId }); setError(!ok); if (ok) refresh(n => n + 1); };
        const h = React.createElement;
        const button = { minHeight: 36, padding: '5px 9px', border: '1px solid var(--acc-line1, rgba(212,175,55,.25))', borderRadius: 6, background: 'transparent', color: 'var(--silver)', cursor: 'pointer', font: 'inherit', fontSize: '.75rem' };
        return h('details', { className: 'wr-player-notebook', open: compact ? undefined : true, 'data-revision': revision, onClick: e => e.stopPropagation(), style: { padding: '10px 12px', border: '1px solid var(--acc-line1, rgba(212,175,55,.22))', borderRadius: 8, minWidth: 0 } },
            h('summary', { style: { cursor: 'pointer', color: 'var(--gold)', fontSize: '.8rem', fontWeight: 700 } }, 'My notebook', isWatched(pid, leagueId) ? ' · Watching' : '', entry.note || other.note ? ' · Notes' : ''),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' } },
                h('button', { type: 'button', style: { ...button, color: scope === 'personal' ? 'var(--gold)' : 'var(--silver)', background: scope === 'personal' ? 'var(--acc-fill2, rgba(212,175,55,.1))' : 'transparent' }, 'aria-pressed': scope === 'personal', onClick: () => setScope('personal') }, 'Personal · all my leagues'),
                leagueId && h('button', { type: 'button', style: { ...button, color: scope === 'league' ? 'var(--gold)' : 'var(--silver)', background: scope === 'league' ? 'var(--acc-fill2, rgba(212,175,55,.1))' : 'transparent' }, 'aria-pressed': scope === 'league', onClick: () => setScope('league') }, leagueName + ' · private'),
                h('button', { type: 'button', style: { ...button, color: entry.watch ? 'var(--gold)' : 'var(--silver)' }, 'aria-pressed': !!entry.watch, onClick: () => save({ watch: !entry.watch }) }, entry.watch ? 'Watching ✓' : 'Watch player')),
            h('textarea', { value: note, onChange: e => { setNote(e.target.value); save({ note: e.target.value }); }, 'aria-label': scope === 'personal' ? 'Personal player note' : 'Private league player note', placeholder: scope === 'personal' ? 'Your player opinion across leagues…' : 'Your plan for this player in this league…', style: { width: '100%', boxSizing: 'border-box', minHeight: 70, resize: 'vertical', padding: 8, background: 'var(--ov-2, rgba(255,255,255,.03))', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,.1))', borderRadius: 6, font: 'inherit', fontSize: 'max(16px, .8rem)' } }),
            other.note && h('p', { style: { margin: '6px 0', fontSize: '.75rem', whiteSpace: 'pre-wrap', color: 'var(--silver)' } }, (scope === 'league' ? 'Personal note: ' : 'League note: ') + other.note),
            Object.entries(entry.draftSources || {}).some(([, row]) => row.tag) && h('p', { style: { margin: '6px 0', fontSize: '.72rem', color: 'var(--silver)' } }, 'Draft tags: ' + [...new Set(Object.values(entry.draftSources).map(row => row.tag).filter(Boolean))].join(' · ') + ' (board-specific)'),
            h('small', { role: error ? 'alert' : undefined, style: { color: error ? 'var(--bad)' : 'var(--text-muted)', display: 'block', marginTop: 4 } }, error ? 'Could not save on this device. Keep a copy of your note.' : 'Private to you. Saved on this device.'));
    }
    WR.PlayerNotebook = { get, update, list, isWatched, migrateDraft, migrateLeague, resolveAction, contextFor, normalizeContext, NotebookEditor };
})();
