import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { bearerToken, checkRateLimit, clientIp, json, sha256Hex } from './security.ts';

export type GuestGame = 'vault' | 'duat';
export type GameGuest = { userId: string; game: GuestGame; roomId: string; displayName: string; expiresAt: string; guest: true };
const validToken = (value: unknown): value is string => typeof value === 'string' && /^dg1\.[0-9a-f]{64}$/.test(value);
const publicGuest = (guest: GameGuest) => ({ userId: guest.userId, game: guest.game, roomId: guest.roomId, displayName: guest.displayName, expiresAt: guest.expiresAt });

// Hosts can confirm who joined without exposing an email, credential, or the
// internal identity used by ownership constraints.
export async function loadGameMemberLabels(admin: SupabaseClient, game: GuestGame, roomId: string, members: { user_id?: string | null }[]): Promise<Map<string, { displayName: string; guest: boolean }>> {
    const ids = [...new Set(members.map(member => member.user_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Map();
    const [people, guests] = await Promise.all([
        admin.from('app_users').select('id,display_name').in('id', ids),
        admin.from('game_guest_sessions').select('app_user_id').eq('game', game).eq('room_id', roomId),
    ]);
    if (people.error || guests.error) throw new Error('The joined-player names could not be loaded. Please retry.');
    const guestIds = new Set((guests.data || []).map(value => value.app_user_id));
    return new Map((people.data || []).map(person => [person.id, { displayName: String(person.display_name || 'Player').trim().slice(0, 60) || 'Player', guest: guestIds.has(person.id) }]));
}

// Opaque guest credentials are intentionally not app-account JWTs. No other
// endpoint, Supabase Auth, or direct database client can authenticate with one.
export async function getGameGuestSession(admin: SupabaseClient, req: Request, game: GuestGame): Promise<GameGuest | null> {
    const token = bearerToken(req);
    if (!validToken(token)) return null;
    const { data, error } = await admin.from('game_guest_sessions')
        .select('app_user_id,game,room_id,display_name,expires_at,revoked_at')
        .eq('token_hash', await sha256Hex(token)).eq('game', game).maybeSingle();
    if (error || !data || data.revoked_at || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null;
    const { data: seat, error: seatError } = await admin.from(game === 'vault' ? 'time_league_members' : 'duat_campaign_members')
        .select('role,joined_at').eq(game === 'vault' ? 'league_id' : 'room_id', data.room_id).eq('user_id', data.app_user_id).maybeSingle();
    if (seatError || !seat?.joined_at || seat.role !== 'member') return null;
    return { userId: data.app_user_id, game: data.game, roomId: data.room_id, displayName: data.display_name, expiresAt: data.expires_at, guest: true };
}

export function guestCanAccess(guest: GameGuest, body: Record<string, unknown>): boolean {
    if (body.op === 'list') return true;
    const roomId = guest.game === 'vault' ? body.rowId : body.roomId;
    return roomId === guest.roomId && ['load', 'action', ...(guest.game === 'vault' ? ['ready'] : [])].includes(String(body.op));
}

export async function handleGameGuestEntry(admin: SupabaseClient, req: Request, body: Record<string, unknown>, game: GuestGame): Promise<Response | null> {
    if (body.op === 'guest-resume') {
        const guest = await getGameGuestSession(admin, req, game);
        return guest ? json(req, { ok: true, guest: publicGuest(guest) }) : json(req, { ok: false, error: 'This guest pass has expired or is unavailable. Sign in with an account or ask the host for help.' }, 401);
    }
    if (body.op !== 'guest-join') return null;
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!validToken(body.guestToken) || typeof body.code !== 'string' || !/^[0-9a-f]{48}$/.test(body.code) || displayName.length < 1 || displayName.length > 60
        || /[\u0000-\u001f\u007f]/.test(displayName) || Object.keys(body).some(key => !['op', 'code', 'displayName', 'guestToken'].includes(key))) {
        return json(req, { ok: false, error: 'Use a valid invitation and a display name of up to 60 characters.' }, 400);
    }
    const limit = await checkRateLimit(admin, 'game-guest:join:ip', clientIp(req), { limit: 30, windowSeconds: 3600, lockoutSeconds: 3600 });
    if (!limit.allowed) return json(req, { ok: false, error: 'Too many guest join attempts. Try again later.' }, 429);
    const { data, error } = await admin.rpc('claim_game_guest_invite', {
        p_game: game, p_code: body.code, p_display_name: displayName, p_token_hash: await sha256Hex(body.guestToken),
    });
    if (error) return json(req, { ok: false, error: error.code === 'P0001' ? error.message : 'The guest seat could not be saved. Keep this page open and retry.' }, error.code === 'P0001' ? 400 : 503);
    const value = Array.isArray(data) ? data[0] : null;
    if (!value?.app_user_id || value.game !== game || !value.room_id || !value.expires_at) return json(req, { ok: false, error: 'The guest seat could not be confirmed. Keep this page open and retry.' }, 503);
    return json(req, { ok: true, guest: publicGuest({ userId: value.app_user_id, game: value.game, roomId: value.room_id, displayName: value.display_name, expiresAt: value.expires_at, guest: true }) });
}
