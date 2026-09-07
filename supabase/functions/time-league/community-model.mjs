// Shared request validation and response projections. Never return database rows
// directly: user_id, invitation secrets and session data are intentionally absent.
export const PROFILE_BACKDROPS = ['midnight', 'stadium', 'gridiron', 'heritage', 'aurora'];
const HEX = /^#[0-9a-f]{6}$/i;
export function normalizeProfileInput(value, normalizeHelmet) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose your manager identity.');
    const name = (raw, label) => {
        if (typeof raw !== 'string') throw new Error(`Choose a ${label}.`);
        const text = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
        if (!text || text.length > 40) throw new Error(`Your ${label} needs 1–40 characters.`);
        return text;
    };
    if (!HEX.test(value.primaryColor) || !HEX.test(value.secondaryColor)) throw new Error('Choose valid team colors.');
    if (!PROFILE_BACKDROPS.includes(value.backdrop)) throw new Error('Choose a profile backdrop.');
    if (typeof value.publicProfile !== 'boolean' || typeof value.lookingForLeague !== 'boolean') throw new Error('Choose your profile visibility.');
    if (value.lookingForLeague && !value.publicProfile) throw new Error('Make your profile public to receive league invitations.');
    return {
        identity: {
            displayName: name(value.displayName, 'manager name'), teamName: name(value.teamName, 'team name'),
            primaryColor: value.primaryColor, secondaryColor: value.secondaryColor, backdrop: value.backdrop,
            helmet: normalizeHelmet(value.helmet, 'profile'),
        },
        public_profile: value.publicProfile,
        looking_for_league: value.lookingForLeague,
    };
}
export function projectProfile(row) {
    if (!row) return null;
    const id = row.identity || {};
    return { profileId: row.profile_id, displayName: id.displayName, teamName: id.teamName,
        primaryColor: id.primaryColor, secondaryColor: id.secondaryColor, backdrop: id.backdrop, helmet: id.helmet,
        publicProfile: row.public_profile === true, lookingForLeague: row.looking_for_league === true };
}
export function projectDirectoryRow(row) {
    return { ...projectProfile({ ...row, public_profile: true }), stats: {
        wins: Number(row.wins || 0), losses: Number(row.losses || 0), ties: Number(row.ties || 0),
        games: Number(row.games || 0), pointsFor: Number(row.points_for || 0), bestGame: Number(row.best_game || 0),
        championships: Number(row.championships || 0), leaguesCompleted: Number(row.leagues_completed || 0),
    } };
}
export function directoryInput(body) {
    const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(50, body.limit)) : 20;
    const page = Number.isInteger(body.page) ? Math.max(0, Math.min(200, body.page)) : 0;
    const q = String(body.q || '').slice(0, 60).replace(/[^\p{L}\p{N} _-]/gu, '').trim();
    return { limit, page, q, leaderboard: body.view === 'leaderboard', lookingOnly: body.lookingOnly === true };
}
export function publicId(value, label) {
    if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new Error(`Choose a valid ${label}.`);
    return value;
}
