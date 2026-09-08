import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleOptions, json, requireActiveAppSession } from '../_shared/security.ts';
import { App, loadData, availableSeasons } from './runtime.js';

const ACTION_FIELDS: Record<string, string[]> = {
    'set-ready': ['ready'], 'start-draft': [], 'draft-pick': ['playerId'], 'reveal-next': [],
    'reveal-rulers': [], 'set-lineup': ['playerIds'],
    'declare-favor': ['favorId', 'playerId', 'sourceWeek'], 'clear-favor': ['playerId'],
    'claim': ['territoryId'], 'attack': ['territoryId'], 'fortify': ['territoryId'], 'advance-week': [],
    'name-ruler': ['armyId', 'name'], 'name-alliance': ['name'],
    'ritual': ['ritualId', 'playerId', 'replacementId', 'armyId', 'position', 'wager', 'confirmed'],
    'propose-pinnacle': ['week'], 'approve-pinnacle': [], 'decline-pinnacle': [], 'next-season': ['season'],
};
const SOURCEBOOK_ACTIONS = ['name-ruler', 'name-alliance', 'ritual', 'propose-pinnacle', 'approve-pinnacle', 'decline-pinnacle', 'next-season'];
const HOST_ACTIONS = ['start-draft', 'reveal-next', 'reveal-rulers', 'advance-week', 'next-season'];
const READY_LOCKED_ACTIONS = ['set-lineup', 'declare-favor', 'clear-favor', 'name-ruler', 'name-alliance', 'ritual', 'propose-pinnacle', 'approve-pinnacle', 'decline-pinnacle'];
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
    if (action.type === 'set-lineup' && (!Array.isArray(action.playerIds) || action.playerIds.length < 1 || action.playerIds.length > 8 || action.playerIds.some((id: any) => typeof id !== 'string' || id.length > 240))) reject('Choose valid starting players.');
    for (const key of ['playerId', 'replacementId', 'armyId', 'territoryId', 'favorId', 'ritualId']) {
        if (action[key] !== undefined && (typeof action[key] !== 'string' || action[key].length > 240)) reject('Choose a valid ' + key + '.');
    }
    if (action.name !== undefined && (typeof action.name !== 'string' || !action.name.trim() || action.name.length > 80)) reject('Choose a name of up to 80 characters.');
    if (action.confirmed !== undefined && typeof action.confirmed !== 'boolean') reject('Choose whether to confirm this ritual.');
    if (action.position !== undefined && !['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX'].includes(action.position)) reject('Choose a supported position.');
    if (action.wager !== undefined && ![10, 25, 50, 75, 100].includes(action.wager)) reject('Choose a supported Ebisu wager.');
    for (const key of ['sourceWeek', 'week']) if (action[key] !== undefined && (!Number.isInteger(action[key]) || action[key] < 1 || action[key] > 17)) reject('Choose a valid campaign week.');
    if (action.season !== undefined && (!Number.isInteger(action.season) || !availableSeasons.includes(action.season))) reject('Choose a complete historical year.');
    return action;
}
function sourcebook(state: any): boolean { return state.version === 4 && state.expansionVersion === 1; }
function dataYears(state: any, allYears = false): number[] {
    if (!sourcebook(state)) return state.seasons;
    return allYears ? availableSeasons : App.DuatCampaign.requiredYears(state);
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
async function projectRoom({ row, members, member }: any): Promise<any> {
    const allReady = members.every((seat: any) => seat.user_id && seat.joined_at && seat.ready);
    const needsDraftPool = row.state.phase === 'draft' && row.state.draft?.status === 'active'
        && App.DuatCampaign.draftTurn(row.state)?.factionId === member.faction_id;
    const needsRitualPool = sourcebook(row.state) && ['season', 'complete'].includes(row.state.phase);
    const hasPendingRecruit = row.state.factions.some((faction: any) => faction.rituals?.pendingMahdi);
    const hasPendingClaims = sourcebook(row.state) && App.DuatCampaign.unresolvedClaims(row.state).length > 0;
    return {
        id: row.id, revision: row.revision,
        campaign: App.DuatCampaign.projectCampaign(row.state, member.faction_id,
            needsDraftPool || needsRitualPool ? await loadData(dataYears(row.state, row.state.phase === 'complete')) : undefined),
        seats: row.state.factions.map((faction: any) => {
            const seat = members.find((item: any) => item.faction_id === faction.id);
            return { factionId: faction.id, controller: seat ? 'human' : 'ai', role: seat?.role || 'ai',
                joined: seat ? Boolean(seat.user_id && seat.joined_at) : true, ready: seat ? seat.ready : true,
                ...(member.role === 'host' && seat && !seat.user_id && (row.state.phase === 'preseason' || (row.state.phase === 'draft' && row.state.draft?.status === 'waiting')) ? { inviteCode: seat.invite_code } : {}) };
        }),
        self: { factionId: member.faction_id, role: member.role, ready: member.ready }, ready: member.ready,
        canAdvance: member.role === 'host' && allReady && !hasPendingRecruit && !hasPendingClaims && (['preseason', 'reveal', 'season'].includes(row.state.phase) || (sourcebook(row.state) && row.state.phase === 'complete') || (row.state.phase === 'draft' && row.state.draft?.status === 'waiting')),
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
            if (Object.keys(input).some(key => !['version', 'name', 'seasons', 'hostFactionId', 'humanFactionIds', 'factionIds', 'settings', 'scoring', 'expansionSettings'].includes(key))) reject('Unexpected campaign setup field.');
            if (input.version !== undefined && ![1, 2, 3, 4].includes(input.version)) reject('Choose a supported campaign version.');
            const version = input.version === undefined ? 1 : input.version;
            const settings = version >= 3 ? App.DuatCampaign.normalizeSettings(input.settings) : App.DuatCampaign.normalizeSettings();
            if (version < 3 && (input.settings !== undefined || input.scoring !== undefined)) reject('Custom rules require the current campaign format.');
            if (version !== 4 && input.expansionSettings !== undefined) reject('Sourcebook rules require a dynasty campaign.');
            const scoring = version >= 3 ? App.DuatCampaign.normalizeScoring(input.scoring) : App.DuatCampaign.SCORING;
            const expansionSettings = version === 4 ? App.DuatCampaign.expansionOptions(input.expansionSettings) : undefined;
            if (!Array.isArray(input.seasons) || input.seasons.length !== settings.mummyCount || new Set(input.seasons).size !== settings.mummyCount || input.seasons.some((year: any) => !Number.isInteger(year) || !availableSeasons.includes(year))) reject('Choose one complete historical season per mummy roster.');
            const factions = (version >= 2 ? App.DuatWorld.FACTIONS : App.DuatRules.FACTIONS).map((faction: any) => faction.id);
            if (!factions.includes(input.hostFactionId)) reject('Choose your faction.');
            const invited = input.humanFactionIds || [];
            if (!Array.isArray(invited) || invited.length > settings.leagueSize || new Set(invited).size !== invited.length || invited.some((id: any) => !factions.includes(id))) reject('Choose unique human factions.');
            const selected = input.factionIds || [...new Set([input.hostFactionId, ...invited, ...factions])].slice(0, settings.leagueSize);
            if (!Array.isArray(selected) || selected.length !== settings.leagueSize || new Set(selected).size !== settings.leagueSize || selected.some((id: any) => !factions.includes(id))
                || !selected.includes(input.hostFactionId) || invited.some((id: any) => !selected.includes(id))) reject('Choose the configured number of active factions including every human seat.');
            const humanFactionIds = [...new Set([input.hostFactionId, ...invited])];
            const campaign = App.DuatCampaign.createCampaign({ version, settings, scoring, expansionSettings, id: crypto.randomUUID(), name: input.name.trim(),
                seed: crypto.randomUUID(), createdAt: new Date().toISOString(), seasons: input.seasons,
                hostFactionId: input.hostFactionId, humanFactionIds, factionIds: selected }, await loadData(input.seasons));
            const { data: roomId, error } = await admin.rpc('create_duat_campaign', { p_user_id: session.userId, p_state: campaign });
            if (error) throw error;
            return json(req, { ok: true, room: await projectRoom(await authorizedRoom(admin, roomId, session.userId)) });
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
        if (body.op === 'load') return json(req, { ok: true, room: await projectRoom(loaded) });
        const { row, member, members } = loaded;
        const action = canonicalAction(body.action, member.faction_id);
        if (typeof body.actionId !== 'string' || !body.actionId.trim() || body.actionId.length > 120) reject('Supply an action ID.');
        const { data: receipt, error: receiptError } = await admin.from('duat_campaign_actions').select('request').eq('room_id', row.id).eq('user_id', session.userId).eq('action_id', body.actionId).maybeSingle();
        if (receiptError) throw receiptError;
        if (receipt) {
            if (!sameIntent(receipt.request, action)) reject('This action ID was already used for another intent.');
            return json(req, { ok: true, deduplicated: true, room: await projectRoom(await authorizedRoom(admin, row.id, session.userId)) });
        }
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== row.revision) return json(req, { ok: false, conflict: true, revision: row.revision, error: 'The campaign changed. Reload before retrying.' }, 409);
        if (!sourcebook(row.state) && SOURCEBOOK_ACTIONS.includes(action.type)) reject('This action requires a sourcebook dynasty.');
        if (row.state.phase === 'complete' && (!sourcebook(row.state) || !['set-ready', 'next-season', 'ritual', 'claim', 'attack'].includes(action.type))) reject('This campaign is complete.');
        if (HOST_ACTIONS.includes(action.type)) {
            if (member.role !== 'host') reject('Only the host can advance the campaign.', 403);
            if (members.some((seat: any) => !seat.user_id || !seat.joined_at || !seat.ready)) reject('Every human faction must join and be ready.');
            if (row.state.factions.some((faction: any) => faction.rituals?.pendingMahdi)) reject('Every waiting Mahdi recruit must be accepted or declined before advancing.');
            if (sourcebook(row.state) && ['advance-week', 'next-season'].includes(action.type) && App.DuatCampaign.unresolvedClaims(row.state).length) reject('Choose the earned human territory claims before advancing.');
        }
        if (action.type === 'set-ready' && row.state.phase === 'draft' && row.state.draft?.status !== 'waiting') reject('Readiness is not used during draft turns.');
        if (action.type === 'set-ready' && row.state.phase === 'reveal' && row.state.archaeology?.revealedFactionIds?.length > 0) reject('The expedition has begun. Readiness returns in Week 1.');
        if (action.type === 'set-ready' && action.ready && row.state.factions.find((faction: any) => faction.id === member.faction_id)?.rituals?.pendingMahdi) reject('Accept or decline your waiting Mahdi recruit before becoming ready.');
        if (action.type === 'set-ready' && action.ready && sourcebook(row.state) && App.DuatCampaign.unresolvedClaims(row.state).includes(member.faction_id)) reject('Choose your earned territory claims before becoming ready.');
        if (member.ready && READY_LOCKED_ACTIONS.includes(action.type)) reject('Mark yourself unready before changing your lineup, offerings or dynasty decisions.');
        const next = action.type === 'set-ready' ? null : App.DuatCampaign.applyAction(row.state,
            { ...action, createdAt: new Date().toISOString() }, await loadData(dataYears(row.state, row.state.phase === 'complete' || action.type === 'next-season')));
        const { data: saved, error: saveError } = await admin.rpc('commit_duat_campaign_action', {
            p_user_id: session.userId, p_room_id: row.id, p_expected_revision: body.expectedRevision,
            p_action_id: body.actionId, p_action: action, p_next_state: next,
        });
        if (saveError) throw saveError;
        if (!saved?.ok) return json(req, { ok: false, conflict: true, revision: saved?.revision, error: 'Someone else acted first. Reload the campaign.' }, 409);
        return json(req, { ok: true, deduplicated: saved.deduplicated === true,
            room: await projectRoom(await authorizedRoom(admin, row.id, session.userId)) });
    } catch (error: any) {
        return json(req, { ok: false, error: error?.message || 'The campaign could not be saved.' }, error?.status || 400);
    }
}
Deno.serve(handleDuatRequest);
