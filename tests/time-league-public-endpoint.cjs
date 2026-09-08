'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHmac, webcrypto } = require('node:crypto');
const Babel = require('@babel/standalone');
global.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'player-cards', 'engine', 'rivals', 'ai', 'actions', 'public-state']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueAI: AI, TimeLeagueSeason: S, TimeLeaguePublicState: P } = App;
const secret = '3205fdd1-c6a7-42ed-93df-9db417404304';
const stamp = '2026-09-08T00:00:00.000Z';
const cards = App.TimeLeaguePlayerCards.buildPlayerCardIndex(JSON.parse(fs.readFileSync('data/time-league/player-cards.json')));
const data = { cards, logIndex: new Map(), eraFactors: new Map() };
const settings = {
    rosterSlots: { QB: 1, RB: 1, K: 1, DEF: 1, BN: 1 }, maxQuarterbacks: 2,
    scoring: { passTd: 6, reception: 1, rushRecYd: .1, passingYd: .04, turnover: -2, extended: { xpm: 2, sack: 3 } },
    regularSeasonWeeks: 12, playoffTeams: 4, draftPickSeconds: 0, eraRules: { mode: 'position-roulette', decades: ['2000s'] },
    waiversEnabled: true, tradesEnabled: true, waiverMode: 'priority', aiDifficulty: 'veteran',
};
const seats = [{ name: 'Host', manager: 'human' }, { name: 'Friend', manager: 'human' }, E.defaultAiSeat(1), E.defaultAiSeat(2)];
const makeState = () => E.normalizeTimeLeague(E.createTimeLeague({ name: 'Sealed online room', seed: 'legacy-exposed-seed', createdAt: stamp, settings, seats }));
async function loadTs(file) {
    const source = fs.readFileSync(file, 'utf8');
    const compiled = Babel.transform(source, { filename: file, presets: ['typescript'] }).code;
    return import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
}

(async () => {
    const sealed = await loadTs('supabase/functions/time-league/sealed-draws.ts');
    const messages = await loadTs('supabase/functions/time-league/messages.ts');
    const state = makeState();
    const before = JSON.stringify(state);
    const prepared = await sealed.prepareSealedDraws(state, cards, secret);
    assert.equal(JSON.stringify(state), before, 'Preparing private draws never mutates the saved row');
    assert.equal(prepared.privateDraws.draft.overall, 1);
    assert(!prepared.privateDraws.waiver, 'No future waiver contexts are prepared during the draft');
    const choice = E.eraEligibleCards(state, cards)[0];
    const eligible = App.TimeLeagueEraRules.filterSeasonsForEra(choice.seasons, state.settings.eraRules, choice.position);
    const digest = createHmac('sha256', secret).update(JSON.stringify(['vault-edition-v1', 'draft', state.leagueId, 1, choice.identity, 0])).digest();
    assert.equal(prepared.privateDraws.draft.seasons[choice.identity], eligible[digest.readUInt32BE(0) % eligible.length].season, 'The prepared edition matches the domain-separated HMAC test vector');
    const changedLegacySeed = await sealed.prepareSealedDraws({ ...state, seed: 'a-publicly-known-different-seed' }, cards, secret);
    assert.deepEqual(changedLegacySeed.privateDraws, prepared.privateDraws, 'Legacy engine seeds cannot predict or alter online editions');
    const otherSecret = await sealed.prepareSealedDraws(state, cards, 'ba58c3d2-dd37-4d2d-a92b-4b5e9cce73bb');
    assert.notDeepEqual(otherSecret.privateDraws, prepared.privateDraws, 'The private database secret controls the edition allocation');
    await assert.rejects(() => sealed.prepareSealedDraws(state, cards, ''), /service update/);
    assert(!Object.hasOwn(messages.withoutPrivateMessages(prepared), 'privateDraws'), 'Transient allocation maps are never persisted');

    let row = { id: 'db-room', state, version: 1, current_week: 1, draft_started: false, sealed_draw_secret: secret };
    let members = state.teams.filter(team => team.manager === 'human').map((team, index) => ({ id: `member-${index}`, league_id: row.id,
        user_id: `u${index + 1}`, seat_team_id: team.teamId, role: index ? 'member' : 'commissioner', joined_at: stamp, ready_week: 0, invite_code: `seat-secret-${index}` }));
    let userId = 'u1', loggedIn = true, lastCreate;
    let privateMessages = [
        { id: 'chat:visible_0001', fromTeamId: 't1', toTeamId: 't2', text: 'Our message', tone: 'friendly', week: 1, createdAt: stamp },
        { id: 'chat:hidden_00001', fromTeamId: 't2', toTeamId: 't3', text: 'Do not disclose', tone: 'friendly', week: 1, createdAt: stamp },
    ];
    const admin = {
        from(table) {
            const filters = {}, query = { updateValue: null,
                select() { return query; }, eq(key, value) { filters[key] = value; return query; }, update(value) { query.updateValue = value; return query; },
                async single() { return { data: structuredClone(row), error: null }; },
                async order() { return { data: structuredClone(members), error: null }; },
                async maybeSingle() {
                    if (table === 'time_league_members') return { data: structuredClone(members.find(member => member.user_id === filters.user_id && member.league_id === filters.league_id) || null), error: null };
                    if (query.updateValue) {
                        if (row.version !== filters.version) return { data: null, error: null };
                        row = { ...row, ...structuredClone(query.updateValue) }; row.current_week = row.state.currentWeek;
                    }
                    return { data: structuredClone(row), error: null };
                },
            };
            return query;
        },
        async rpc(name, args) {
            if (name === 'create_time_league') { lastCreate = structuredClone(args.p_state); return { data: 'created-room', error: null }; }
            if (name === 'set_time_league_ready') {
                members = members.map(member => member.user_id === args.p_user_id ? { ...member, ready_week: args.p_ready ? row.current_week : 0 } : member);
                row.version++; return { data: null, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        },
    };
    let handler;
    const source = fs.readFileSync('supabase/functions/time-league/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
    const compiled = Babel.transform(source, { filename: 'index.ts', presets: ['typescript'] }).code;
    vm.runInNewContext(compiled, {
        Deno: { env: { get: () => 'test-only' }, serve: fn => { handler = fn; } }, crypto: webcrypto, App,
        createClient: () => admin, handleOptions: () => null, json: (_req, body, status = 200) => ({ body: JSON.parse(JSON.stringify(body)), status }),
        requireActiveAppSession: async () => loggedIn ? { userId } : null, handleCommunity: async () => null,
        loadData: async () => data, loadPrivateMessages: async () => privateMessages,
        sendPrivateMessage: async () => ({ ok: true }), withoutPrivateMessages: messages.withoutPrivateMessages,
        prepareSealedDraws: sealed.prepareSealedDraws, applySealedOnlineAction: sealed.applySealedOnlineAction,
    });
    const request = body => handler({ method: 'POST', json: async () => ({ rowId: row.id, ...body }) });
    const act = (action, options = {}) => request({ op: 'action', version: row.version, action, ...options });
    const success = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.ok, true, JSON.stringify(result.body)); return result.body; };
    loggedIn = false; assert.equal((await request({ op: 'load' })).status, 401); loggedIn = true;
    userId = 'outsider'; assert.equal((await request({ op: 'load' })).status, 403); userId = 'u1';
    success(await request({ op: 'create', input: { name: 'Forged era', settings: { ...settings, eraRules: { mode: 'position-roulette', decades: ['2000s'], positionDecades: { QB: '1970s', RB: '1970s', K: '1970s', DEF: '1970s' } } }, seats, seed: 'attacker-seed', leagueId: 'attacker-id' } }));
    assert.match(lastCreate.leagueId, /^tl-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    assert.notEqual(lastCreate.leagueId, `tl-${lastCreate.seed}`, 'Public ID uses independent entropy');
    assert.notEqual(lastCreate.seed, 'attacker-seed');
    assert(Object.values(lastCreate.settings.eraRules.positionDecades).every(decade => decade === '2000s'), 'Caller-provided roulette assignments are ignored');
    assert.deepEqual(lastCreate.draftEraReveals, {});

    row.state.teams[0].queue = [choice.identity]; row.state.teams[1].queue = ['private-other-queue'];
    let loaded = success(await request({ op: 'load' })).row;
    assert.equal(loaded.state.publicSnapshotVersion, 1);
    assert(!JSON.stringify(loaded).includes(secret) && !JSON.stringify(loaded).includes(state.seed), 'Neither private entropy source crosses the endpoint');
    assert(!Object.hasOwn(loaded, 'sealed_draw_secret'));
    assert(!Object.hasOwn(loaded.state.settings.eraRules, 'positionDecades'));
    assert.deepEqual(loaded.state.teams[0].queue, [choice.identity]); assert.deepEqual(loaded.state.teams[1].queue, []);
    assert.equal(loaded.state.rivalMessages.length, 1);
    assert.equal((await act({ type: 'reveal-era', position: 'QB' })).status, 400, 'An unopened room cannot be revealed');
    userId = 'u2'; assert.equal((await act({ type: 'start' })).status, 400); userId = 'u1';
    success(await act({ type: 'start' }));
    const versionBeforeReveal = row.version;
    assert.equal((await act({ type: 'reveal-era', position: 'QB' }, { version: row.version - 1 })).status, 409);
    assert.equal(row.version, versionBeforeReveal);
    assert.equal((await act({ type: 'reveal-era', teamId: 't2', position: 'QB' })).status, 400);
    success(await act({ type: 'reveal-era', position: 'QB' }));
    loaded = success(await request({ op: 'load' })).row;
    assert.deepEqual(loaded.state.draftVisibility.revealedPositions, ['QB']);
    assert.deepEqual(loaded.state.settings.eraRules.positionDecades, { QB: '2000s' });
    userId = 'u2'; loaded = success(await request({ op: 'load' })).row;
    assert.deepEqual(loaded.state.draftVisibility.revealedPositions, []); userId = 'u1';
    assert.equal((await request({ op: 'ready', ready: true })).status, 400);
    success(await act({ type: 'reveal-era', position: 'all' })); success(await request({ op: 'ready', ready: true }));
    members[1].ready_week = 1;
    assert.equal((await act({ type: 'draft-clock-start' })).status, 400, 'An old ready bit does not bypass the other manager’s server reveal');
    userId = 'u2'; success(await act({ type: 'reveal-era', position: 'all' })); success(await request({ op: 'ready', ready: true }));
    userId = 'u1'; success(await act({ type: 'draft-clock-start' }));

    let iterations = 0;
    while (row.state.phase === 'draft' && iterations++ < 30) {
        const seat = E.currentDraftSeat(row.state), team = row.state.teams.find(item => item.teamId === seat.teamId);
        if (team.manager === 'ai') { userId = 'u1'; success(await act({ type: 'ai-run' })); }
        else {
            userId = seat.teamId === 't1' ? 'u1' : 'u2';
            const card = AI.aiDraftChoice(row.state, cards);
            const exact = await sealed.prepareSealedDraws(row.state, cards, secret);
            success(await act({ type: 'draft', identity: card.identity, drawnSeason: 1901, seed: 'forged' }));
            const awarded = row.state.teams.flatMap(item => item.roster).find(entry => entry.identity === card.identity);
            assert.equal(awarded.drawnSeason, exact.privateDraws.draft.seasons[card.identity]);
        }
        assert(!row.state.privateDraws, 'No action persists a transient edition map');
        assert(P.allErasRevealed(row.state, 't1') && P.allErasRevealed(row.state, 't2'), 'Server reveals survive normalized actions');
        const response = success(await request({ op: 'load' })).row.state;
        assert(!Object.hasOwn(response, 'seed'));
        if (row.state.phase === 'draft') assert(response.teams.every(item => item.roster.every(entry => !Object.hasOwn(entry, 'drawnSeason'))));
    }
    assert.equal(row.state.phase, 'season'); assert.equal(row.state.draftPicks.length, 20);
    userId = 'u1';
    const publicSeason = E.normalizePublicTimeLeague(success(await request({ op: 'load' })).row.state);
    assert(publicSeason && publicSeason.teams.every(team => team.roster.every(entry => Number.isInteger(entry.drawnSeason))));
    const target = E.freeAgents(row.state, cards).at(-1);
    const nowPrepared = await sealed.prepareSealedDraws(row.state, cards, secret);
    assert.deepEqual(Object.keys(nowPrepared.privateDraws), ['waiver']);
    const intendedSeason = nowPrepared.privateDraws.waiver.seasons[target.identity];
    assert.equal(E.waiverSeason(publicSeason, target), intendedSeason);
    assert.equal(E.waiverSeason(publicSeason, target, publicSeason.currentWeek + 1), null, 'No future-week edition lookup');
    const drop = row.state.teams[0].roster.find(entry => entry.slot === 'BN');
    // Pick a same-position candidate to keep the intended drop legal.
    const compatible = E.freeAgents(row.state, cards).filter(card => card.position === drop.position).at(-1);
    const preview = E.waiverPreview(publicSeason, compatible, new Map(), new Map());
    success(await act({ type: 'claim', teamId: 't1', identity: compatible.identity, dropEntryId: drop.entryId }));
    success(await act({ type: 'process-claims' }));
    const landed = row.state.teams[0].roster.find(entry => entry.identity === compatible.identity);
    assert(landed, 'The uncontested compatible waiver claim succeeds'); assert.equal(landed.drawnSeason, preview.drawnSeason, 'Displayed edition equals the awarded edition');

    data.logIndex = S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync('data/time-league/nflverse-game-logs.csv', 'utf8')).logs);
    let finalState = row.state;
    for (const team of finalState.teams) finalState = E.autoFillLineup(finalState, team.teamId, cards);
    finalState = E.finalizeCurrentWeek(finalState, data.logIndex, new Map(), stamp);
    assert.equal(finalState.finalizedWeeks.length, 1);
    const finalPublic = P.projectPublicState(await sealed.prepareSealedDraws(finalState, cards, secret), 't1', [], cards);
    assert.deepEqual(finalPublic.finalizedWeeks, finalState.finalizedWeeks, 'Custom scoring and actual kicker/defense/stat snapshots pass through unchanged after reveal');
    assert.deepEqual(E.normalizePublicTimeLeague(finalPublic).finalizedWeeks, finalState.finalizedWeeks);
    assert.deepEqual(finalPublic.settings.scoring.extended, { xpm: 2, sack: 3 });
    assert(finalPublic.finalizedWeeks[0].results.flatMap(result => result.starters).some(entry => entry.position === 'K' && entry.stats?.extra));
    assert(finalPublic.finalizedWeeks[0].results.flatMap(result => result.starters).some(entry => entry.position === 'DEF' && entry.stats?.extra));
    let auction = E.normalizeTimeLeague(E.createTimeLeague({ name: 'Auction signals', seed: 'auction', createdAt: stamp,
        settings: { ...settings, draftFormat: 'auction', draftAuctionBudget: 200 }, seats }));
    auction = E.startDraft(auction, stamp);
    assert.equal(P.projectPublicState(auction, 't1', [], cards, stamp).draftAutomation.auctionPending, false, 'A human nomination turn does not request an AI step');
    const auctionCard = E.eraEligibleCards(auction, cards)[0];
    const max = E.auctionMaxBid(auction, 't1');
    auction = E.nominateAuctionPlayer(auction, 't1', auctionCard, max, stamp);
    assert(auction.draftAuction.nomination, 'Maximum legal nomination fixture is live');
    const savedAuction = JSON.stringify(auction);
    assert.equal(P.projectPublicState(auction, 't1', [], cards, stamp).draftAutomation.auctionPending, false, 'All-pass auctions do not advertise repeated AI actions');
    assert.equal(JSON.stringify(auction), savedAuction, 'Deriving automation never changes the canonical auction');
    console.log('PASS: sealed endpoint authentication, reveals, readiness, stale writes, independent IDs, HMAC drafts, current-week waivers, and postdraft custom scoring');
})().catch(error => { console.error(error); process.exitCode = 1; });
