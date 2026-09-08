// Authored conversations never enter the shared league snapshot. The service
// RPC checks membership again under the game lock before committing a send.
export function withoutPrivateMessages(state: any): any {
    const shared = { ...state };
    // Per-action cryptographic edition maps are transient and never persisted.
    delete shared.privateDraws;
    delete shared.rivalMessages;
    return shared;
}

export async function loadPrivateMessages(admin: any, userId: string, rowId: string, sendId?: string, replyToId?: string): Promise<any[]> {
    const { data, error } = await admin.rpc('load_time_league_messages', {
        p_user_id: userId, p_league_id: rowId, p_limit: 1000, ...(sendId ? { p_send_id: `chat:${sendId}` } : {}),
        ...(replyToId && /^(chat|reply):[A-Za-z0-9_-]{8,80}$/.test(replyToId) ? { p_reply_id: replyToId } : {}),
    });
    if (error) throw new Error(error.message || 'Messages could not be loaded.');
    return Array.isArray(data) ? data : [];
}

export async function sendPrivateMessage(admin: any, userId: string, row: any, member: any, members: any[], action: any, rivals: any, expectedVersion: number, stamp = new Date().toISOString()): Promise<any> {
    if (!member?.joined_at || member.user_id !== userId) throw new Error('You need a joined seat to send messages.');
    if (action.teamId !== undefined && action.teamId !== member.seat_team_id) throw new Error('You can only speak for your own team.');
    const recipient = row.state.teams.find((team: any) => team.teamId === action.toTeamId);
    if (!recipient || recipient.teamId === member.seat_team_id) throw new Error('Choose another manager in your league.');
    if (recipient.manager === 'human' && !members.some(seat => seat.seat_team_id === recipient.teamId && seat.user_id && seat.joined_at)) throw new Error('That manager has not joined the league yet.');
    if (typeof action.messageId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(action.messageId)) throw new Error('This message needs a valid send identifier.');
    if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 500) throw new Error('Write a message between 1 and 500 characters.');
    if (action.tone !== undefined && !rivals.TONES.includes(action.tone)) throw new Error('Choose a valid message tone.');
    if (action.replyToId !== undefined && (typeof action.replyToId !== 'string' || !action.replyToId || action.replyToId.length > 160)) throw new Error('Choose a message from this conversation.');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('Reload this league before sending.');
    const input = { teamId: member.seat_team_id, toTeamId: recipient.teamId, text: action.text.trim(), tone: action.tone || 'neutral', messageId: action.messageId,
        ...(action.replyToId ? { replyToId: action.replyToId } : {}) };
    const history = await loadPrivateMessages(admin, userId, row.id, input.messageId, input.replyToId);
    const next = rivals.sendMessage({ ...withoutPrivateMessages(row.state), rivalMessages: history }, input, stamp);
    const message = next.rivalMessages.find((item: any) => item.id === `chat:${input.messageId}`);
    const reply = next.rivalMessages.find((item: any) => item.id === `reply:${input.messageId}`);
    const relationship = recipient.manager === 'ai'
        ? next.rivalRelationships?.find((item: any) => item.ownerTeamId === recipient.teamId && item.otherTeamId === member.seat_team_id) || null
        : null;
    const { data, error } = await admin.rpc('send_time_league_message', {
        p_user_id: userId, p_league_id: row.id, p_expected_version: expectedVersion,
        p_messages: [message, ...(recipient.manager === 'ai' && reply ? [reply] : [])], p_relationship: relationship,
    });
    if (error) throw new Error(error.message || 'Your message could not be sent.');
    return data;
}
