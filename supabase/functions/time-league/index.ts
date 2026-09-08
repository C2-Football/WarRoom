import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleOptions, json, requireActiveAppSession } from '../_shared/security.ts';
import { App, loadData } from './runtime.js';
import { handleCommunity } from './community.ts';
import { loadPrivateMessages, sendPrivateMessage, withoutPrivateMessages } from './messages.ts';
import { prepareSealedDraws, applySealedOnlineAction } from './sealed-draws.ts';

Deno.serve(async (req: Request) => {
    const options = handleOptions(req);
    if (options) return options;
    if (req.method !== 'POST') return json(req, { ok: false, error: 'POST required' }, 405);
    try {
        const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const session = await requireActiveAppSession(admin, req);
        if (!session) return json(req, { ok: false, error: 'Sign in to play with friends.' }, 401);
        const body = await req.json();
        const community = await handleCommunity(admin, session.userId, body, App.TimeLeagueHelmet.normalizeHelmet);
        if (community) return json(req, community);
        const fail = (message: string, status = 400) => json(req, { ok: false, error: message }, status);
        if (body.op === 'create') {
            const input = body.input;
            if (!input || !Array.isArray(input.seats) || input.seats.length < 2 || input.seats.length > 12 || input.seats[0]?.manager !== 'human') return fail('Choose 2–12 teams with your own human seat first.');
            if (input.seats.some((s: any) => !['human', 'ai'].includes(s.manager) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60)) return fail('Every team needs a name of up to 60 characters.');
            if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) return fail('Choose a league name of up to 80 characters.');
            // Normalize and bound settings BEFORE creating schedules or draft orders.
            const settings = input.settings;
            if (!settings || !settings.rosterSlots || Object.values(settings.rosterSlots).some((v: any) => !Number.isInteger(v) || v < 0 || v > 12) || !Number.isInteger(settings.regularSeasonWeeks) || settings.regularSeasonWeeks < 1 || settings.regularSeasonWeeks > 18) return fail('Invalid league rules.');
            if (settings.draftFormat !== undefined && !['snake', 'linear', 'auction'].includes(settings.draftFormat)) return fail('Choose snake, linear, or auction.');
            if (settings.draftPickSeconds !== undefined && !App.TimeLeagueEngine.DRAFT_PICK_SECONDS.includes(settings.draftPickSeconds)) return fail('Choose a supported draft clock.');
            if (settings.draftAiSeconds !== undefined && !App.TimeLeagueEngine.DRAFT_AI_SECONDS.includes(settings.draftAiSeconds)) return fail('Choose a supported AI pace.');
            if (settings.draftAuctionBudget !== undefined && (!Number.isInteger(settings.draftAuctionBudget) || settings.draftAuctionBudget < 50 || settings.draftAuctionBudget > 1000)) return fail('Auction budgets must be between 50 and 1,000.');
            const capacity = App.TimeLeagueEngine.rosterCapacity(settings);
            if (capacity < 1 || capacity > 30) return fail('Choose between 1 and 30 roster spots.');
            const state = App.TimeLeagueEngine.normalizeTimeLeague({
                ...App.TimeLeagueEngine.createTimeLeague({ ...input,
                    settings: { ...settings, eraRules: { mode: settings.eraRules?.mode, decades: settings.eraRules?.decades || [] } },
                    seed: crypto.randomUUID(), createdAt: new Date().toISOString() }),
                // Never encode outputs of the private engine RNG into public IDs.
                leagueId: `tl-${crypto.randomUUID()}`, draftEraReveals: {},
            });
            if (!state) return fail('Invalid league rules.');
            const { data: id, error } = await admin.rpc('create_time_league', { p_user_id: session.userId, p_state: withoutPrivateMessages(state) });
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
        if (memberError || !member || !member.joined_at) return fail('You do not have a seat in this league.', 403);
        const { data: row, error } = await admin.from('time_leagues').select('*').eq('id', body.rowId).single();
        if (error) throw error;
        const { data: members, error: seatsError } = await admin.from('time_league_members').select('*').eq('league_id', row.id).order('seat_team_id');
        if (seatsError) throw seatsError;
        if (body.op === 'load') {
            const rivalMessages = await loadPrivateMessages(admin, session.userId, row.id);
            const needsCards = (row.state.phase !== 'draft' && row.state.seasonsRevealed) || row.state.settings.draftFormat === 'auction';
            const data = needsCards ? await loadData(0) : { cards: new Map() };
            const prepared = row.state.phase !== 'draft' && row.state.seasonsRevealed ? await prepareSealedDraws(row.state, data.cards, row.sealed_draw_secret) : row.state;
            return json(req, { ok: true, row: { id: row.id, state: App.TimeLeaguePublicState.projectPublicState(prepared, member.seat_team_id, rivalMessages, data.cards), version: row.version, draft_started: row.draft_started, seatTeamId: member.seat_team_id, role: member.role, members: members!.map(m => ({ id: m.id, seat_team_id: m.seat_team_id, role: m.role, joined: Boolean(m.user_id), ready_week: m.ready_week, ...(member.role === 'commissioner' && !m.user_id ? { invite_code: m.invite_code } : {}) })) } });
        }
        if (body.op === 'ready') {
            if (body.ready === true && row.state.phase === 'draft' && !App.TimeLeaguePublicState.allErasRevealed(row.state, member.seat_team_id)) return fail('Reveal every position archive before entering the draft.');
            const { error } = await admin.rpc('set_time_league_ready', { p_user_id: session.userId, p_league_id: row.id, p_ready: body.ready === true });
            if (error) throw error;
            return json(req, { ok: true });
        }
        if (body.op !== 'action') return fail('Unknown request.');
        const action = body.action;
        if (!action || typeof action.type !== 'string') return fail('Choose a game action.');
        if (action.type === 'rival-message') {
            const result = await sendPrivateMessage(admin, session.userId, row, member, members!, action, App.TimeLeagueRivals, body.version);
            return json(req, result, result?.conflict ? 409 : 200);
        }
        if (row.version !== body.version) return json(req, { ok: false, conflict: true }, 409);
        if (['draft-clock-start', 'draft-clock-resume'].includes(action.type) && members!.some(m => m.user_id &&
            (m.ready_week !== row.current_week || !App.TimeLeaguePublicState.allErasRevealed(row.state, m.seat_team_id)))) return fail('Wait for every manager to finish the reveal.');
        let next = row.state;
        let started = row.draft_started;
        if (action.type === 'start') {
            if (member.role !== 'commissioner' || started) return fail('Only the commissioner can start the draft.');
            if (members!.some(m => !m.user_id)) return fail('Wait for every friend to claim their seat.');
            started = true;
        } else if (action.type === 'reveal-era') {
            if (!started) return fail('Wait for the commissioner to open the draft room.');
            if (action.teamId !== undefined && action.teamId !== member.seat_team_id) return fail('You can only reveal your own position archives.');
            next = App.TimeLeaguePublicState.revealPositions(row.state, member.seat_team_id, action.position);
        } else {
            if (!started && action.type !== 'team' && action.type !== 'queue') return fail('Wait for the commissioner to start the draft.');
            if (row.state.phase === 'draft' && ['draft', 'auction-nominate', 'auction-bid'].includes(action.type) && !App.TimeLeaguePublicState.allErasRevealed(row.state, member.seat_team_id)) return fail('Reveal every position archive before making a draft choice.');
            next = await applySealedOnlineAction(row.state, action, member, await loadData((action.type === 'week' || (['vote-advance', 'timed-advance'].includes(action.type) && row.state.weekStage === 'ready')) ? row.current_week : 0), new Date().toISOString(), row.sealed_draw_secret);
        }
        const { data: saved, error: saveError } = await admin.from('time_leagues').update({ state: withoutPrivateMessages(next), version: row.version + 1, draft_started: started }).eq('id', row.id).eq('version', row.version).select('id, state, version, draft_started').maybeSingle();
        if (saveError) throw saveError;
        if (!saved) return json(req, { ok: false, conflict: true }, 409);
        return json(req, { ok: true, version: saved.version });
    } catch (error) {
        return json(req, { ok: false, error: error instanceof Error ? error.message : 'The league could not be saved. Try again.' }, 400);
    }
});
