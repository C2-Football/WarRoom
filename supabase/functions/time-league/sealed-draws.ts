// Online mystery editions use a secret that lives in a private DB column, never
// the engine seed (which older clients received). Separate HMAC contexts prevent
// public IDs, revealed eras or earlier seasons from predicting another draw.
const encoder = new TextEncoder();
type Cards = Map<string, any>;
const cache = new Map<string, Record<string, number>>();
const gameDeckCache = new Map<string, Array<number | null>>();

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

// A cryptographic stream protects each game order even after several source
// games have been revealed. Compressing a secret into the solo32-bit PRNG
// would make the remaining order susceptible to exhaustive state searches.
async function gameDecks(state: any, cards: Cards, secret: string, privateDraws: any): Promise<Record<string, Array<number | null>>> {
    if (state.phase === 'draft') return {};
    const selections = new Map<string, any>();
    for (const team of state.teams) for (const entry of team.roster) selections.set(`${entry.identity}:${entry.drawnSeason}`, entry);
    for (const [identity, drawnSeason] of Object.entries(privateDraws.waiver?.seasons || {})) selections.set(`${identity}:${drawnSeason}`, { identity, drawnSeason });
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const entries = [...selections.entries()], result: Record<string, Array<number | null>> = {};
    for (let offset = 0; offset < entries.length; offset += 20) {
        await Promise.all(entries.slice(offset, offset + 20).map(async ([id, entry]) => {
            const season = cards.get(entry.identity)?.seasons.find((row: any) => row.season === entry.drawnSeason);
            const sourceWeeks = [...new Set<number>(season?.sourceWeeks || [])].sort((a, b) => a - b);
            if (!sourceWeeks.length) throw new Error('This player edition is missing its full game archive. Please reload.');
            const size = Math.max(14, app().TimeLeagueEngine.seasonEndWeek(state), sourceWeeks.length, Number(season.scheduledGames) || 0);
            const cacheKey = JSON.stringify([secret, state.leagueId, id, sourceWeeks, size]);
            const cached = gameDeckCache.get(cacheKey);
            if (cached) { result[id] = [...cached]; return; }
            const order: Array<number | null> = [...sourceWeeks, ...Array.from({ length: size - sourceWeeks.length }, () => null)];
            let words: number[] = [], block = 0;
            const word = async () => {
                if (!words.length) {
                    const message = JSON.stringify(['vault-game-order-v1', state.leagueId, entry.identity, entry.drawnSeason, block++]);
                    const bytes = new DataView(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
                    words = Array.from({ length: bytes.byteLength / 2 }, (_, i) => bytes.getUint16(i * 2, false));
                }
                return words.shift()!;
            };
            for (let i = order.length - 1; i > 0; i--) {
                const count = i + 1, limit = Math.floor(0x10000 / count) * count;
                let value = await word();
                while (value >= limit) value = await word();
                const j = value % count;
                [order[i], order[j]] = [order[j], order[i]];
            }
            gameDeckCache.set(cacheKey, order); result[id] = [...order];
        }));
    }
    while (gameDeckCache.size > 5000) gameDeckCache.delete(gameDeckCache.keys().next().value!);
    return result;
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
    let privateGameSeed;
    if (state.settings.gameDeckVersion === 1) {
        const key = await crypto.subtle.importKey('raw', encoder.encode(drawSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(['vault-games-secret-v1', state.leagueId]))));
        privateGameSeed = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return { ...state, privateDraws, ...(privateGameSeed ? { privateGameSeed, privateGameDecks: await gameDecks(state, cards, drawSecret, privateDraws) } : {}) };
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
