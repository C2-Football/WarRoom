import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleOptions, json, requireActiveAppSession } from '../_shared/security.ts';
import { App, loadData } from './runtime.js';

Deno.serve(async (req: Request) => {
    const options = handleOptions(req);
    if (options) return options;
    if (req.method !== 'POST') return json(req, { ok: false, error: 'POST required' }, 405);
    try {
        const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const session = await requireActiveAppSession(admin, req);
        if (!session) return json(req, { ok: false, error: 'Sign in to play with friends.' }, 401);
        const body = await req.json();
        const fail = (message: string, status = 400) => json(req, { ok: false, error: message }, status);
        if (body.op === 'create') {
            const input = body.input;
            if (!input || !Array.isArray(input.seats) || input.seats.length < 2 || input.seats.length > 12 || input.seats[0]?.manager !== 'human') return fail('Choose 2–12 teams with your own human seat first.');
            if (input.seats.some((s: any) => !['human', 'ai'].includes(s.manager) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60)) return fail('Every team needs a name of up to 60 characters.');
            if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) return fail('Choose a league name of up to 80 characters.');
            // Normalize and bound settings BEFORE creating schedules or draft orders.
            const settings = input.settings;
            if (!settings || !settings.rosterSlots || Object.values(settings.rosterSlots).some((v: any) => !Number.isInteger(v) || v < 0 || v > 12) || !Number.isInteger(settings.regularSeasonWeeks) || settings.regularSeasonWeeks < 1 || settings.regularSeasonWeeks > 18) return fail('Invalid league rules.');
            const capacity = App.TimeLeagueEngine.rosterCapacity(settings);
            if (capacity < 1 || capacity > 30) return fail('Choose between 1 and 30 roster spots.');
            const state = App.TimeLeagueEngine.normalizeTimeLeague(App.TimeLeagueEngine.createTimeLeague({ ...input, seed: crypto.randomUUID(), createdAt: new Date().toISOString() }));
            if (!state) return fail('Invalid league rules.');
            const { data: id, error } = await admin.rpc('create_time_league', { p_user_id: session.userId, p_state: state });
            if (error) throw error;
            return json(req, { ok: true, rowId: id });
        }
        if (body.op === 'claim') {
            const { data: id, error } = await admin.rpc('claim_time_league_invite', { p_user_id: session.userId, p_code: String(body.code || '') });
            if (error) return fail(error.message);
            return json(req, { ok: true, rowId: id });
        }
        if (body.op === 'list') {
            const { data, error } = await admin.from('time_league_members').select('seat_team_id, role, time_leagues(id, league_id, name, phase, current_week, team_count)').eq('user_id', session.userId);
            if (error) throw error;
            return json(req, { ok: true, leagues: data });
        }
        const { data: member, error: memberError } = await admin.from('time_league_members').select('*').eq('league_id', body.rowId).eq('user_id', session.userId).maybeSingle();
        if (memberError || !member) return fail('You do not have a seat in this league.', 403);
        const { data: row, error } = await admin.from('time_leagues').select('*').eq('id', body.rowId).single();
        if (error) throw error;
        const { data: members, error: seatsError } = await admin.from('time_league_members').select('*').eq('league_id', row.id).order('seat_team_id');
        if (seatsError) throw seatsError;
        if (body.op === 'load') return json(req, { ok: true, row: { id: row.id, state: { ...row.state, teams: row.state.teams.map((t: any) => t.teamId === member.seat_team_id ? t : { ...t, queue: [] }), pendingClaims: row.state.pendingClaims.filter((c: any) => c.teamId === member.seat_team_id), activity: row.state.activity.map((a: any) => a.kind === 'waiver' && a.week === row.current_week ? { ...a, message: 'A manager submitted a waiver claim.' } : a) }, version: row.version, draft_started: row.draft_started, seatTeamId: member.seat_team_id, role: member.role, members: members!.map(m => ({ id: m.id, seat_team_id: m.seat_team_id, role: m.role, joined: Boolean(m.user_id), ready_week: m.ready_week, ...(member.role === 'commissioner' && !m.user_id ? { invite_code: m.invite_code } : {}) })) } });
        if (body.op === 'ready') {
            const { error } = await admin.rpc('set_time_league_ready', { p_user_id: session.userId, p_league_id: row.id, p_ready: body.ready === true });
            if (error) throw error;
            return json(req, { ok: true });
        }
        if (body.op !== 'action') return fail('Unknown request.');
        if (row.version !== body.version) return json(req, { ok: false, conflict: true }, 409);
        const action = body.action;
        if (!action || typeof action.type !== 'string') return fail('Choose a game action.');
        let next = row.state;
        let started = row.draft_started;
        if (action.type === 'start') {
            if (member.role !== 'commissioner' || started) return fail('Only the commissioner can start the draft.');
            if (members!.some(m => !m.user_id)) return fail('Wait for every friend to claim their seat.');
            started = true;
        } else {
            if (!started && action.type !== 'team' && action.type !== 'queue') return fail('Wait for the commissioner to start the draft.');
            if (action.type === 'week' && members!.some(m => m.ready_week !== row.current_week)) return fail('Wait for every manager to mark their lineup ready.');
            if (member.ready_week === row.current_week && ['lineup', 'auto-lineup', 'respond-trade', 'ping-ai'].includes(action.type)) return fail('Unmark Ready before changing your lineup.');
            if (action.type === 'respond-trade' && action.accept === true) {
                const trade = row.state.trades.find((t: any) => t.tradeId === action.tradeId);
                if (trade && members!.some(m => [trade.fromTeamId, trade.toTeamId].includes(m.seat_team_id) && m.ready_week === row.current_week)) return fail('Both managers must unmark Ready before accepting a trade.');
            }
            next = App.TimeLeagueActions.applyOnlineAction(row.state, action, member, await loadData(action.type === 'week' ? row.current_week : 0), new Date().toISOString());
        }
        const { data: saved, error: saveError } = await admin.from('time_leagues').update({ state: next, version: row.version + 1, draft_started: started }).eq('id', row.id).eq('version', row.version).select('id, state, version, draft_started').maybeSingle();
        if (saveError) throw saveError;
        if (!saved) return json(req, { ok: false, conflict: true }, 409);
        return json(req, { ok: true, version: saved.version });
    } catch (error) {
        return json(req, { ok: false, error: error instanceof Error ? error.message : 'The league could not be saved. Try again.' }, 400);
    }
});
