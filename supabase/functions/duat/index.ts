import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleOptions, json, requireActiveAppSession } from '../_shared/security.ts';
import { App, loadData, availableSeasons } from './runtime.js';

const ACTION_FIELDS: Record<string, string[]> = {
    'set-ready': ['ready'], 'reveal-rulers': [], 'set-lineup': ['playerIds'],
    'declare-favor': ['favorId', 'playerId', 'sourceWeek'], 'clear-favor': [],
    'claim': ['territoryId'], 'advance-week': [],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reject(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function checkId(value: any, label: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) reject('Invalid ' + label + '.');
    return value;
}
function canonicalAction(value: any, factionId: string): any {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(ACTION_FIELDS, value.type)) reject('Choose a supported Duat action.');
    const allowed = ['type', 'factionId', ...ACTION_FIELDS[value.type]];
    if (Object.keys(value).some(key => !allowed.includes(key))) reject('Unexpected campaign action field.');
    if (value.factionId !== undefined && value.factionId !== factionId) reject('You can only control your own faction.', 403);
    const action = { ...value, factionId };
    if (action.type === 'set-ready' && typeof action.ready !== 'boolean') reject('Choose ready or unready.');
    if (action.type === 'set-lineup' && (!Array.isArray(action.playerIds) || action.playerIds.length !== 5 || action.playerIds.some((id: any) => typeof id !== 'string' || id.length > 240))) reject('Choose five valid players.');
    return action;
}
function sameIntent(left: any, right: any): boolean {
    const sort = (value: any): any => Array.isArray(value) ? value.map(sort)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
    return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}
async function authorizedRoom(admin: any, roomId: string, userId: string): Promise<any> {
    checkId(roomId, 'campaign ID');
    const { data: member, error: memberError } = await admin.from('duat_campaign_members').select('faction_id,role,ready,joined_at').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (memberError) throw memberError;
    if (!member?.joined_at) reject('You do not have a faction in this campaign.', 403);
    const { data: row, error } = await admin.from('duat_campaigns').select('id,state,revision').eq('id', roomId).single();
    if (error) throw error;
    const { data: members, error: seatsError } = await admin.from('duat_campaign_members').select('faction_id,role,user_id,joined_at,ready,invite_code').eq('room_id', roomId);
    if (seatsError) throw seatsError;
    return { row, members, member };
}
function projectRoom({ row, members, member }: any): any {
    const allReady = members.every((seat: any) => seat.user_id && seat.joined_at && seat.ready);
    return {
        id: row.id, revision: row.revision,
        campaign: App.DuatCampaign.projectCampaign(row.state, member.faction_id),
        seats: row.state.factions.map((faction: any) => {
            const seat = members.find((item: any) => item.faction_id === faction.id);
            return { factionId: faction.id, controller: seat ? 'human' : 'ai', role: seat?.role || 'ai',
                joined: seat ? Boolean(seat.user_id && seat.joined_at) : true, ready: seat ? seat.ready : true,
                ...(member.role === 'host' && seat && !seat.user_id && row.state.phase === 'preseason' ? { inviteCode: seat.invite_code } : {}) };
        }),
        self: { factionId: member.faction_id, role: member.role, ready: member.ready }, ready: member.ready,
        canAdvance: member.role === 'host' && allReady && ['preseason', 'season'].includes(row.state.phase),
    };
}

// This endpoint receives intent only. Authentication, hidden random allocation,
// campaign outcomes and the final compare-and-swap all remain server-owned.
export async function handleDuatRequest(req: Request): Promise<Response> {
    const options = handleOptions(req);
    if (options) return options;
    if (req.method !== 'POST') return json(req, { ok: false, error: 'POST required' }, 405);
    try {
        const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const session = await requireActiveAppSession(admin, req);
        if (!session) return json(req, { ok: false, error: 'Sign in to play The Duat with friends.' }, 401);
        const text = await req.text();
        if (text.length > 16384) reject('Campaign request is too large.', 413);
        const body = JSON.parse(text);
        if (body.op === 'create') {
            const input = body.input;
            if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) reject('Choose a campaign name of up to 80 characters.');
            if (!Array.isArray(input.seasons) || input.seasons.length !== 4 || new Set(input.seasons).size !== 4 || input.seasons.some((year: any) => !Number.isInteger(year) || !availableSeasons.includes(year))) reject('Choose four seasons with complete historical coverage.');
            const factions = App.DuatRules.FACTIONS.map((faction: any) => faction.id);
            if (!factions.includes(input.hostFactionId)) reject('Choose your faction.');
            const invited = input.humanFactionIds || [];
            if (!Array.isArray(invited) || invited.length > 14 || new Set(invited).size !== invited.length || invited.some((id: any) => !factions.includes(id))) reject('Choose unique human factions.');
            const humanFactionIds = [...new Set([input.hostFactionId, ...invited])];
            const campaign = App.DuatCampaign.createCampaign({ id: crypto.randomUUID(), name: input.name.trim(),
                seed: crypto.randomUUID(), createdAt: new Date().toISOString(), seasons: input.seasons,
                hostFactionId: input.hostFactionId, humanFactionIds }, await loadData(input.seasons));
            const { data: roomId, error } = await admin.rpc('create_duat_campaign', { p_user_id: session.userId, p_state: campaign });
            if (error) throw error;
            return json(req, { ok: true, room: projectRoom(await authorizedRoom(admin, roomId, session.userId)) });
        }
        if (body.op === 'claim') {
            if (typeof body.code !== 'string' || !/^[0-9a-f]{48}$/i.test(body.code)) reject('This invitation is invalid.');
            const { data: roomId, error } = await admin.rpc('claim_duat_campaign_invite', { p_user_id: session.userId, p_code: body.code });
            if (error) throw error;
            return json(req, { ok: true, roomId });
        }
        if (body.op === 'list') {
            const { data, error } = await admin.from('duat_campaign_members').select('room_id,faction_id,role,duat_campaigns(id,state,revision,updated_at)').eq('user_id', session.userId).not('joined_at', 'is', null);
            if (error) throw error;
            // Never return the raw joined campaign row: it contains future armies.
            const rooms = (data || []).flatMap((item: any) => {
                const row = item.duat_campaigns;
                return row ? [{ id: row.id, name: row.state.name, phase: row.state.phase, week: row.state.week,
                    revision: row.revision, factionId: item.faction_id, role: item.role, updatedAt: row.updated_at }] : [];
            });
            return json(req, { ok: true, rooms });
        }
        if (!['load', 'action'].includes(body.op)) reject('Unknown campaign request.');
        const loaded = await authorizedRoom(admin, body.roomId, session.userId);
        if (body.op === 'load') return json(req, { ok: true, room: projectRoom(loaded) });
        const { row, member, members } = loaded;
        const action = canonicalAction(body.action, member.faction_id);
        if (typeof body.actionId !== 'string' || !body.actionId.trim() || body.actionId.length > 120) reject('Supply an action ID.');
        const { data: receipt, error: receiptError } = await admin.from('duat_campaign_actions').select('request').eq('room_id', row.id).eq('user_id', session.userId).eq('action_id', body.actionId).maybeSingle();
        if (receiptError) throw receiptError;
        if (receipt) {
            if (!sameIntent(receipt.request, action)) reject('This action ID was already used for another intent.');
            return json(req, { ok: true, deduplicated: true, room: projectRoom(await authorizedRoom(admin, row.id, session.userId)) });
        }
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== row.revision) return json(req, { ok: false, conflict: true, revision: row.revision, error: 'The campaign changed. Reload before retrying.' }, 409);
        if (row.state.phase === 'complete') reject('This campaign is complete.');
        if (['reveal-rulers', 'advance-week'].includes(action.type)) {
            if (member.role !== 'host') reject('Only the host can advance the campaign.', 403);
            if (members.some((seat: any) => !seat.user_id || !seat.joined_at || !seat.ready)) reject('Every human faction must join and be ready.');
        }
        if (member.ready && ['set-lineup', 'declare-favor', 'clear-favor'].includes(action.type)) reject('Mark yourself unready before changing your lineup or favor.');
        const next = action.type === 'set-ready' ? null : App.DuatCampaign.applyAction(row.state,
            { ...action, createdAt: new Date().toISOString() }, await loadData(row.state.seasons));
        const { data: saved, error: saveError } = await admin.rpc('commit_duat_campaign_action', {
            p_user_id: session.userId, p_room_id: row.id, p_expected_revision: body.expectedRevision,
            p_action_id: body.actionId, p_action: action, p_next_state: next,
        });
        if (saveError) throw saveError;
        if (!saved?.ok) return json(req, { ok: false, conflict: true, revision: saved?.revision, error: 'Someone else acted first. Reload the campaign.' }, 409);
        return json(req, { ok: true, deduplicated: saved.deduplicated === true,
            room: projectRoom(await authorizedRoom(admin, row.id, session.userId)) });
    } catch (error: any) {
        return json(req, { ok: false, error: error?.message || 'The campaign could not be saved.' }, error?.status || 400);
    }
}
Deno.serve(handleDuatRequest);
