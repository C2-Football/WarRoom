// Online mystery editions use a secret that lives in a private DB column, never
// the engine seed (which older clients received). Separate HMAC contexts prevent
// public IDs, revealed eras or earlier seasons from predicting another draw.
const encoder = new TextEncoder();
type Cards = Map<string, any>;
const cache = new Map<string, Record<string, number>>();

function app(): any { return (globalThis as any).App; }

async function editionMap(state: any, cards: Cards, secret: string, kind: 'draft' | 'waiver', context: number): Promise<Record<string, number>> {
    // Cache only the current context, with a small process-local bound. The
    // secret and maps never enter saved engine state or a transport response.
    const candidates = (kind === 'draft' ? app().TimeLeagueEngine.eraEligibleCards(state, cards) : app().TimeLeagueEngine.freeAgents(state, cards)) as any[];
    const eligible = candidates.map(card => ({ identity: card.identity,
        seasons: app().TimeLeagueEraRules.filterSeasonsForEra(card.seasons, state.settings.eraRules, card.position).map((row: any) => row.season) }));
    const cacheKey = JSON.stringify([secret, state.leagueId, kind, context, eligible]);
    const found = cache.get(cacheKey);
    if (found) return { ...found };
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const pairs = await Promise.all(eligible.filter(card => card.seasons.length > 0).map(async card => {
        const count = card.seasons.length;
        const limit = Math.floor(0x100000000 / count) * count;
        // Rejection sampling avoids modulo bias. A rejection is exceedingly
        // unlikely with these short season lists; every retry is separated too.
        for (let attempt = 0; attempt < 8; attempt++) {
            const message = JSON.stringify(['vault-edition-v1', kind, state.leagueId, context, card.identity, attempt]);
            const digest = new DataView(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
            for (let offset = 0; offset < digest.byteLength; offset += 4) {
                const value = digest.getUint32(offset, false);
                if (value < limit) return [card.identity, card.seasons[value % count]] as [string, number];
            }
        }
        throw new Error('The sealed draw could not be prepared. Try again.');
    }));
    const seasons = Object.fromEntries(pairs);
    cache.set(cacheKey, seasons);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return { ...seasons };
}

export async function prepareSealedDraws(state: any, cards: Cards, drawSecret: string): Promise<any> {
    if (typeof drawSecret !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(drawSecret)) {
        throw new Error('This league needs the sealed-draft service update. Please try again shortly.');
    }
    const privateDraws: any = {};
    if (state.phase === 'draft') {
        const seat = app().TimeLeagueEngine.currentDraftSeat(state);
        if (seat) privateDraws.draft = { overall: seat.overall, seasons: await editionMap(state, cards, drawSecret, 'draft', seat.overall) };
    } else {
        privateDraws.waiver = { week: state.currentWeek, seasons: await editionMap(state, cards, drawSecret, 'waiver', state.currentWeek) };
    }
    return { ...state, privateDraws };
}

// Each iteration needs its own overall context. Reusing one prepared map for
// "run AI until my turn" would either repeat a draw or fall back to the old RNG.
export async function applySealedOnlineAction(state: any, action: any, member: any, data: any, stamp: string, drawSecret: string): Promise<any> {
    if (action.type !== 'ai-run') return app().TimeLeagueActions.applyOnlineAction(await prepareSealedDraws(state, data.cards, drawSecret), action, member, data, stamp);
    if (member.role !== 'commissioner') throw new Error('Only the commissioner can advance the league.');
    let next = state;
    for (let index = 0; index < state.draftOrder.length; index++) {
        const seat = app().TimeLeagueEngine.currentDraftSeat(next);
        if (next.phase !== 'draft' || !seat || next.teams.find((team: any) => team.teamId === seat.teamId)?.manager !== 'ai') break;
        const previous = next;
        next = app().TimeLeagueActions.applyOnlineAction(await prepareSealedDraws(next, data.cards, drawSecret), { ...action, type: 'ai-pick' }, member, data, stamp);
        if (next.draftPicks.length === previous.draftPicks.length) break;
    }
    if (next === state) throw new Error('Wait for the human manager to pick.');
    return next;
}
