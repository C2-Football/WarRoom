'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
function api() {
    const root = { console }; root.window = root;
    vm.createContext(root);
    vm.runInContext(fs.readFileSync('js/shared/league-wire-identity.js', 'utf8'), root);
    vm.runInContext(fs.readFileSync('js/shared/league-wire-draft-history.js', 'utf8'), root);
    return root.WrWireDraftHistory;
}
function fixture(season = '2026', leagueId = '123456', draftId = '234567') {
    const league = {
        league_id: leagueId, draft_id: draftId, season, sport: 'nfl', status: 'in_season',
        settings: { start_week: 1, playoff_week_start: 5 },
        rosters: [1, 2, 3, 4].map(roster_id => ({ roster_id, owner_id: `owner-${roster_id}` })),
        users: [1, 2, 3, 4].map(n => ({ user_id: `owner-${n}`, display_name: `Owner ${n}`, metadata: { team_name: `Team ${n}` } })),
    };
    const draft = { draft_id: draftId, league_id: leagueId, season, season_type: 'regular', sport: 'nfl', status: 'complete', type: 'snake', settings: { teams: 4, rounds: 10 }, draft_order: { 'owner-1': 1, 'owner-2': 2 } };
    const picks = [
        { draft_id: draftId, player_id: 'early', roster_id: 1, picked_by: 'owner-1', pick_no: 1, round: 1, draft_slot: 1, metadata: { first_name: 'Early', last_name: 'Receiver', position: 'WR' } },
        // The slot belongs to owner 1; the pick was traded to roster 2.
        { draft_id: draftId, player_id: 'late', roster_id: 2, picked_by: 'owner-2', pick_no: 9, round: 3, draft_slot: 1, metadata: { first_name: 'Later', last_name: 'Receiver', position: 'WR' } },
    ];
    const weeks = [1, 2, 3, 4].map(week => ({ week, rows: [
        { roster_id: 1, points: 1, starters: ['early'], players_points: { early: 1, bench: 999 } },
        { roster_id: 2, points: 10, starters: ['late'], players_points: { late: 10 } },
        { roster_id: 3, points: 0, starters: ['0'], players_points: {} },
        { roster_id: 4, points: 0, starters: [], players_points: {} },
    ] }));
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push({ url, options });
        const value = url === `https://api.sleeper.app/v1/league/${leagueId}/drafts` ? [draft] : url === `https://api.sleeper.app/v1/draft/${draftId}/picks` ? picks : null;
        return { ok: value !== null, json: async () => plain(value) };
    };
    return { league, draft, picks, weeks, calls, fetcher };
}
const load = (service, f, options = {}) => service.load({ league: f.league, weeks: f.weeks, throughWeek: 4, fetcher: f.fetcher, now: () => 1000, ...options });
(async () => {
    const service = api(), f = fixture(), result = await load(service, f);
    assert.equal(result.status, 'ready'); assert.equal(result.stories.length, 1);
    const story = result.stories[0];
    assert.equal(story.feature, true); assert.equal(story.documentary, false); assert.equal(story.eventSeason, 2026);
    assert.equal(story.evidence.metric, 'starting-lineup points');
    assert.deepEqual(plain(story.evidence.players.map(player => [player.playerId, player.points, player.starts])), [['late', 40, 4], ['early', 4, 4]]);
    assert.equal(story.participants[0].rosterId, '2'); assert.equal(story.participants[0].ownerName, 'Owner 2', 'receiving roster, never draft slot, owns a traded pick');
    assert(story.text.includes('starting-lineup points')); assert(story.related[0].text.includes('including after a trade'));
    assert(story.body.includes('4 verified fantasy starts')); assert(story.body.includes('4 fantasy starts over the same weeks'));
    assert(story.related[0].text.includes('not total player production')); assert(story.body.includes('Round 3 (No. 9)'));
    assert.equal(story.body.split('\n\n').length, 2, 'technical metric caveats belong in the receipts disclosure');
    assert(!story.body.includes('999'), 'bench production must never enter starter totals');
    assert(result.coverage.every(item => typeof item === 'string'));
    assert.equal(f.calls.length, 2); assert(f.calls.every(call => !call.url.includes('/matchups/')));
    assert(f.calls.every(call => call.options.cache === 'no-store'));
    assert.equal(story.sources.filter(source => source.url.includes('/matchups/')).length, 4, 'loaded matchups are cited without being fetched');

    // Only metadata is cached: refreshed scores and identities build a new story.
    f.weeks[0].rows[1].players_points.late = 30;
    f.league.users[1].display_name = 'Renamed Owner';
    story.participants[0].ownerName = 'Consumer mutation';
    const revised = await load(service, f, { now: () => 2000 });
    assert.equal(f.calls.length, 2); assert.equal(revised.stories[0].evidence.players[0].points, 60);
    assert.equal(revised.stories[0].participants[0].ownerName, 'Renamed Owner');
    await load(service, f, { force: true }); assert.equal(f.calls.length, 4);

    const tooEarly = fixture();
    const earlyResult = await load(api(), tooEarly, { throughWeek: 3 });
    assert.equal(earlyResult.status, 'unavailable'); assert.equal(tooEarly.calls.length, 0, 'no draft requests before minimum current-season evidence');
    const noRegularSeason = fixture(); noRegularSeason.league.settings.playoff_week_start = 1;
    assert.equal((await load(api(), noRegularSeason)).status, 'unavailable');
    assert.equal(noRegularSeason.calls.length, 0, 'a Week 1 playoff start leaves no regular-season window to compare');
    const reversedWindow = fixture(); reversedWindow.league.settings.start_week = 5; reversedWindow.league.settings.playoff_week_start = 4;
    assert.equal((await load(api(), reversedWindow, { throughWeek: 9 })).status, 'unavailable');
    assert.equal(reversedWindow.calls.length, 0, 'a playoff start before the league start cannot invent regular-season weeks');
    const future = fixture(); future.league.settings.playoff_week_start = 10;
    future.weeks.push({ week: 5, rows: [{ roster_id: 1, points: 9999, starters: ['early'], players_points: { early: 9999 } }] });
    const bounded = await load(api(), future);
    assert.equal(bounded.stories[0].evidence.players[1].points, 4, 'an already-loaded later week cannot enter the selected completed cutoff');
    assert.equal(bounded.stories[0].week, 4);
    future.league.status = 'complete'; future.league.season = '2025'; future.draft.season = '2025';
    const oldEdition = await load(api(), future);
    assert.equal(oldEdition.stories[0].week, 4, 'a completed selected season still obeys the requested edition cutoff');
    assert.equal(oldEdition.stories[0].evidence.players[1].points, 4, 'later results cannot leak into an old Week 4 edition');

    const negative = fixture();
    negative.weeks.forEach(week => { week.rows[0].players_points.early = -5; week.rows[1].players_points.late = 0; });
    const zeros = await load(api(), negative);
    assert.deepEqual(plain(zeros.stories[0].evidence.players.map(player => player.points)), [0, -20], 'zero and negative player scores are valid');
    const absent = fixture(); delete absent.weeks[0].rows[1].players_points.late;
    assert.equal((await load(api(), absent)).stories.length, 0, 'one unverified start excludes the player rather than inventing a zero');
    const duplicateStarter = fixture(); duplicateStarter.weeks[0].rows[2].starters = ['late']; duplicateStarter.weeks[0].rows[2].players_points.late = 10;
    assert.equal((await load(api(), duplicateStarter)).stories.length, 0, 'a duplicated starter across teams is ambiguous');
    const threeStarts = fixture(); threeStarts.weeks[0].rows[1].starters = [];
    assert.equal((await load(api(), threeStarts)).stories.length, 0, 'at least four actual observed starts are needed per player');
    const incompleteWeek = fixture(); incompleteWeek.weeks[1].rows.pop();
    assert.equal((await load(api(), incompleteWeek)).status, 'unavailable'); assert.equal(incompleteWeek.calls.length, 0);
    const duplicateWeek = fixture(); duplicateWeek.weeks.push(plain(duplicateWeek.weeks[0]));
    assert.equal((await load(api(), duplicateWeek)).status, 'unavailable');

    const wrongPosition = fixture(); wrongPosition.picks[1].metadata.position = 'TE';
    assert.equal((await load(api(), wrongPosition)).stories.length, 0, 'different positions are never framed as equivalent draft choices');
    const keeper = fixture(); keeper.picks[1].is_keeper = true;
    assert.equal((await load(api(), keeper)).stories.length, 0, 'keeper slots are not market prices');
    const auction = fixture(); auction.draft.type = 'auction';
    assert.equal((await load(api(), auction)).stories.length, 0); assert.equal(auction.calls.length, 1, 'auction pick order cannot stand in for price');
    const changedOwner = fixture(); changedOwner.league.rosters[1].owner_id = 'replacement';
    assert.equal((await load(api(), changedOwner)).stories.length, 0, 'a replacement owner cannot inherit personal credit for an old draft pick');
    const unassigned = fixture(); unassigned.picks[1].picked_by = '';
    const unknownOwner = await load(api(), unassigned);
    assert.equal(unknownOwner.stories[0].participants[0].ownerKnown, false); assert.equal(unknownOwner.stories[0].participants[0].ownerName, null);
    assert(!unknownOwner.stories[0].body.includes('Owner 2'), 'receiving roster alone cannot name its draft-day owner');
    const corrupt = fixture(); corrupt.picks.push(plain(corrupt.picks[0]));
    assert.equal((await load(api(), corrupt)).stories.length, 0, 'duplicate picks cannot produce an arbitrary comparison');
    const wrongDraft = fixture(); wrongDraft.picks[1].draft_id = '999';
    assert.equal((await load(api(), wrongDraft)).stories.length, 0);
    const wrongSeason = fixture(); wrongSeason.draft.season = '2025';
    assert.equal((await load(api(), wrongSeason)).stories.length, 0); assert.equal(wrongSeason.calls.length, 1);

    const current = fixture(), old = fixture('2025', '345678', '456789'), older = fixture('2024', '567890', '678901'), oldest = fixture('2023', '789012', '890123'), unrelated = fixture('2025', '901234', '912345');
    current.league.previous_league_id = old.league.league_id; old.league.previous_league_id = older.league.league_id; older.league.previous_league_id = oldest.league.league_id;
    [old, older, oldest, unrelated].forEach(f => { f.league.status = 'complete'; });
    const fixtures = [current, old, older, oldest, unrelated];
    const combinedFetcher = async (url, options) => {
        const found = fixtures.find(f => url.includes('/league/' + f.league.league_id + '/') || url.includes('/draft/' + f.draft.draft_id + '/'));
        if (!found) throw Error('Unexpected endpoint: ' + url);
        return found.fetcher(url, options);
    };
    const history = fixtures.slice(1).map(f => ({ league: f.league, weeks: f.weeks }));
    const archived = await load(api(), current, { priorSeasons: history, fetcher: combinedFetcher });
    assert.deepEqual(plain(archived.stories.map(story => story.season)), ['2026', '2025', '2024']);
    assert(archived.stories.slice(1).every(story => story.documentary));
    assert.equal(fixtures.reduce((sum, f) => sum + f.calls.length, 0), 6, 'at most current plus two loaded linked seasons, two endpoints each');
    assert.equal(unrelated.calls.length, 0); assert.equal(oldest.calls.length, 0);
    old.weeks.pop();
    const partialHistory = await load(api(), current, { throughWeek: 2, priorSeasons: history, fetcher: combinedFetcher });
    assert.deepEqual(plain(partialHistory.stories.map(story => story.season)), ['2024'], 'historical verdict requires the complete regular season while other eligible seasons survive');
    old.weeks.push(plain(older.weeks[3]));
    const partialFailure = await load(api(), current, { priorSeasons: history, fetcher: async (url, options) => url.includes('/league/345678/') ? { ok: false } : combinedFetcher(url, options) });
    assert.equal(partialFailure.status, 'partial'); assert.equal(partialFailure.stories.length, 2);
    const failed = await load(api(), fixture(), { fetcher: async () => ({ ok: false }) });
    assert.equal(failed.status, 'error'); assert.equal(failed.stories.length, 0);

    const controller = new AbortController(); controller.abort();
    const callCount = f.calls.length;
    await assert.rejects(load(service, f, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(f.calls.length, callCount, 'aborted callers cannot reuse a warm cache');
    const midway = new AbortController(), interrupted = fixture();
    await assert.rejects(load(api(), interrupted, { signal: midway.signal, fetcher: async (...args) => { const response = await interrupted.fetcher(...args); midway.abort(); return response; } }), { name: 'AbortError' });
    assert.equal(interrupted.calls.length, 1, 'cancellation stops before the pick request');
    console.log('league-wire-draft-history: evidence, ownership, cutoff, cache, bounds and cancellation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
