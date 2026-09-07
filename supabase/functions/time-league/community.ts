import { normalizeProfileInput, projectProfile, projectDirectoryRow, directoryInput, publicId } from './community-model.mjs';

// Invoked only after requireActiveAppSession has verified the JWT and current
// session version. Every mutation is pinned to that session's userId.
export async function handleCommunity(admin: any, userId: string, body: any, normalizeHelmet: any): Promise<any | null> {
    const check = (result: any) => { if (result.error) throw new Error(result.error.message || 'The community request could not be completed.'); return result.data; };
    if (body.op === 'profile-get') {
        const row = check(await admin.from('time_league_profiles').select('profile_id,identity,public_profile,looking_for_league').eq('user_id', userId).maybeSingle());
        return { ok: true, profile: projectProfile(row) };
    }
    if (body.op === 'profile-save') {
        const profile = normalizeProfileInput(body.profile, normalizeHelmet);
        const row = check(await admin.from('time_league_profiles').upsert({ ...profile, user_id: userId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select('profile_id,identity,public_profile,looking_for_league').single());
        return { ok: true, profile: projectProfile(row) };
    }
    if (body.op === 'community-list') {
        const { limit, page, q, leaderboard, lookingOnly } = directoryInput(body);
        let query = admin.from('time_league_public_directory').select('*');
        if (q) {
            const term = q.replace(/_/g, '\\_');
            query = query.or(`identity->>displayName.ilike.%${term}%,identity->>teamName.ilike.%${term}%`);
        }
        if (lookingOnly) query = query.eq('looking_for_league', true);
        if (leaderboard) query = query.gt('games', 0).order('championships', { ascending: false }).order('wins', { ascending: false }).order('losses', { ascending: true });
        else query = query.order('identity->>displayName');
        const rows = check(await query.order('profile_id').range(page * limit, page * limit + limit)) || [];
        return { ok: true, profiles: rows.slice(0, limit).map(projectDirectoryRow), page, hasMore: rows.length > limit };
    }
    if (body.op === 'community-invite') {
        const rowId = publicId(body.rowId, 'league');
        const profileId = publicId(body.profileId, 'manager');
        if (typeof body.seatTeamId !== 'string' || !/^t\d{1,2}$/.test(body.seatTeamId)) throw new Error('Choose an open human seat.');
        const inviteId = check(await admin.rpc('send_time_league_community_invite', { p_user_id: userId, p_league_id: rowId, p_seat_team_id: body.seatTeamId, p_profile_id: profileId }));
        return { ok: true, inviteId };
    }
    if (body.op === 'community-respond') {
        const inviteId = publicId(body.inviteId, 'invitation');
        if (typeof body.accept !== 'boolean') throw new Error('Accept or decline this invitation.');
        const rowId = check(await admin.rpc('respond_time_league_community_invite', { p_user_id: userId, p_invite_id: inviteId, p_accept: body.accept }));
        return { ok: true, ...(rowId ? { rowId } : {}) };
    }
    if (body.op === 'community-invites') {
        const rows = check(await admin.from('time_league_community_invites').select('id,league_id,seat_team_id,sender_id,recipient_id,status,created_at,time_leagues(name,phase,draft_started)').or(`sender_id.eq.${userId},recipient_id.eq.${userId}`).order('created_at', { ascending: false }).limit(100)) || [];
        const ids = [...new Set(rows.flatMap((r: any) => [r.sender_id, r.recipient_id]))];
        const leagueIds = [...new Set(rows.map((r: any) => r.league_id))];
        const seats = leagueIds.length ? check(await admin.from('time_league_members').select('league_id,seat_team_id,user_id').in('league_id', leagueIds).limit(1200)) || [] : [];
        const people = ids.length ? check(await admin.from('time_league_profiles').select('user_id,profile_id,identity,public_profile,looking_for_league').in('user_id', ids)) || [] : [];
        const byId = new Map(people.map((r: any) => [r.user_id, projectProfile(r)]));
        const base = (r: any) => ({ inviteId: r.id, leagueName: r.time_leagues?.name || 'Vault league', teamName: `Team ${r.seat_team_id.replace(/^t/, '')}`, status: r.status, createdAt: r.created_at, available: !r.time_leagues?.draft_started && r.time_leagues?.phase === 'draft' && seats.some((s: any) => s.league_id === r.league_id && s.seat_team_id === r.seat_team_id && !s.user_id) && !seats.some((s: any) => s.league_id === r.league_id && s.user_id === r.recipient_id) });
        return { ok: true,
            incoming: rows.filter((r: any) => r.recipient_id === userId).map((r: any) => ({ ...base(r), from: byId.get(r.sender_id) || null })),
            outgoing: rows.filter((r: any) => r.sender_id === userId).map((r: any) => ({ ...base(r), to: byId.get(r.recipient_id) || null })),
        };
    }
    return null;
}
