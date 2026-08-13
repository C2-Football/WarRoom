// ══════════════════════════════════════════════════════════════════
// js/shared/time-league-remote-client.js — window.App.TimeLeagueRemote
//
// Thin Supabase I/O layer for online (multi-device) Time League / "The
// Vault" leagues. Every browser still computes its own next state locally
// via the exact same pure engine (js/shared/time-league-engine.js) it
// already uses for local leagues — this module's only job is persisting
// that computed state to a shared `time_leagues` row, subscribing to other
// members' writes in real time, and handling the invite-claim flow. It
// never re-derives or validates game state itself.
//
// Lives in js/shared/ (this repo's own tracked source), NOT reconai-shared/
// — that directory is entirely synced in from the separate dhq-shared repo
// by scripts/sync-reconai-shared.cjs and gets overwritten on every
// `npm run dev`, so anything Time-League-specific belongs here instead.
//
// Reuses the already-configured, already-authenticated Supabase client from
// reconai-shared/supabase-client.js (window.App.OD.getClient()) — never a
// second ad hoc client instance. That module's Authorization header only
// covers REST/PostgREST calls, not the Realtime websocket, so this module
// separately hands the same JWT to realtime.setAuth() itself rather than
// depending on a change to the synced (and easily-overwritten) shared file.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.App = window.App || {};

    const LEAGUES_TABLE = 'time_leagues';
    const MEMBERS_TABLE = 'time_league_members';

    let realtimeAuthedFor = null;
    function getDb() {
        if (!(window.App.OD && window.App.OD.getClient)) return null;
        const db = window.App.OD.getClient();
        if (!db) return null;
        const token = window.App.OD.getSessionToken ? window.App.OD.getSessionToken() : null;
        if (token && token !== realtimeAuthedFor) {
            db.realtime.setAuth(token);
            realtimeAuthedFor = token;
        }
        return db;
    }
    const getUid = () => (window.App.OD && window.App.OD.getCurrentUserId ? window.App.OD.getCurrentUserId() : null);

    /**
     * Inserts the league row, then the founder's own commissioner seat, then
     * one pending (unclaimed) member row per additional human seat — three
     * sequential inserts, each legal per the migration's own RLS policies in
     * that exact order (a league must exist before its founder can claim a
     * seat in it; the founder must hold a commissioner seat before opening
     * invite placeholders for the rest).
     *
     * `seats` is the same array already passed to Engine.createTimeLeague —
     * team ids are assigned "t1", "t2", ... in that same order, so the first
     * human seat is always the founder's own (matching the existing local
     * convention where seat 1 is the hotseat human by default).
     */
    async function createOnlineLeague({ state, seats }) {
        const db = getDb();
        if (!db) return { ok: false, error: 'not_configured' };
        const founderId = getUid();
        if (!founderId) return { ok: false, error: 'not_signed_in' };

        const humanSeatTeamIds = seats
            .map((seat, index) => (seat.manager === 'human' ? `t${index + 1}` : null))
            .filter(Boolean);
        if (!humanSeatTeamIds.length) return { ok: false, error: 'no_human_seat' };
        const [founderSeatTeamId, ...pendingSeatTeamIds] = humanSeatTeamIds;

        const { data: leagueRow, error: leagueError } = await db.from(LEAGUES_TABLE)
            .insert({ created_by: founderId, state })
            .select('id, state, version')
            .single();
        if (leagueError) return { ok: false, error: leagueError.message };

        const { error: selfError } = await db.from(MEMBERS_TABLE).insert({
            league_id: leagueRow.id, seat_team_id: founderSeatTeamId, role: 'commissioner',
            user_id: founderId, joined_at: new Date().toISOString(),
        });
        if (selfError) return { ok: false, error: selfError.message };

        let members = [];
        if (pendingSeatTeamIds.length) {
            const { data, error } = await db.from(MEMBERS_TABLE)
                .insert(pendingSeatTeamIds.map((seatTeamId) => ({ league_id: leagueRow.id, seat_team_id: seatTeamId, role: 'member' })))
                .select('id, seat_team_id, invite_code');
            if (error) return { ok: false, error: error.message };
            members = data || [];
        }

        return { ok: true, rowId: leagueRow.id, version: leagueRow.version, founderSeatTeamId, members };
    }

    async function loadOnlineLeague(rowId) {
        const db = getDb();
        if (!db) return null;
        const { data, error } = await db.from(LEAGUES_TABLE).select('id, state, version').eq('id', rowId).maybeSingle();
        if (error || !data) return null;
        return data;
    }

    /**
     * Optimistic-concurrency write: matches only if `version` still equals
     * `expectedVersion` — PostgREST folds both .eq() filters into one atomic
     * UPDATE ... WHERE clause, so two racing writers can never both "win."
     * A 0-row result means someone else wrote first; the caller should
     * refetch and replay its action against the fresh state rather than
     * retrying blindly (every engine mutation is already a pure
     * (state, action) -> newState reducer, so replay is safe).
     */
    async function writeOnlineLeague(rowId, nextState, expectedVersion) {
        const db = getDb();
        if (!db) return { ok: false, conflict: false, error: 'not_configured' };
        const { data, error } = await db.from(LEAGUES_TABLE)
            .update({ state: nextState })
            .eq('id', rowId)
            .eq('version', expectedVersion)
            .select('id, version');
        if (error) return { ok: false, conflict: false, error: error.message };
        if (!data || data.length === 0) return { ok: false, conflict: true };
        return { ok: true, version: data[0].version };
    }

    /** Returns an unsubscribe function. RLS scopes which rows a subscriber can ever receive. */
    function subscribeToLeague(rowId, onChange) {
        const db = getDb();
        if (!db) return () => {};
        const channel = db.channel(`time_league:${rowId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: LEAGUES_TABLE, filter: `id=eq.${rowId}` }, (payload) => {
                if (payload && payload.new) onChange(payload.new);
            })
            .subscribe();
        return () => { db.removeChannel(channel); };
    }

    async function listMyOnlineLeagues() {
        const db = getDb();
        const uid = getUid();
        if (!db || !uid) return [];
        const { data, error } = await db.from(MEMBERS_TABLE)
            .select(`seat_team_id, role, ${LEAGUES_TABLE}(id, league_id, name, phase, current_week, team_count)`)
            .eq('user_id', uid);
        if (error || !data) return [];
        return data
            .map((row) => {
                const league = row[LEAGUES_TABLE];
                if (!league) return null;
                return {
                    rowId: league.id, leagueId: league.league_id, name: league.name, phase: league.phase,
                    currentWeek: league.current_week, teamCount: league.team_count,
                    seatTeamId: row.seat_team_id, role: row.role,
                };
            })
            .filter(Boolean);
    }

    /** "You're about to join <league> as <seat>" — safe to call before signing in. */
    async function previewInvite(inviteCode) {
        const db = getDb();
        if (!db) return { ok: false, error: 'not_configured' };
        const { data, error } = await db.rpc('time_league_invite_preview', { p_invite_code: inviteCode });
        if (error) return { ok: false, error: error.message };
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { ok: false, error: 'not_found' };
        return { ok: true, rowId: row.league_row_id, leagueId: row.league_id, name: row.league_name, phase: row.phase, seatTeamId: row.seat_team_id };
    }

    async function claimInvite(inviteCode) {
        const db = getDb();
        if (!db) return { ok: false, error: 'not_configured' };
        const { data, error } = await db.rpc('claim_time_league_seat', { p_invite_code: inviteCode });
        if (error) return { ok: false, error: error.message };
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { ok: false, error: 'not_found' };
        return { ok: true, rowId: row.league_row_id, leagueId: row.league_id, seatTeamId: row.seat_team_id };
    }

    window.App.TimeLeagueRemote = {
        createOnlineLeague, loadOnlineLeague, writeOnlineLeague, subscribeToLeague,
        listMyOnlineLeagues, previewInvite, claimInvite,
    };
})();
