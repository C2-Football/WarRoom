'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { console, setTimeout, clearTimeout, AbortController, fetch: () => { throw Error('Unexpected network'); } };
context.window = context;
vm.createContext(context);
for (const path of ['js/shared/league-live-scores.js', 'js/shared/league-live-table.js', 'js/shared/league-wire-journal.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), context);
const Journal = context.WrWireStories;
const row = (roster_id, points, matchup_id = 1, extra = {}) => ({ roster_id, points, matchup_id, ...extra });
const league = (season, extra = {}) => ({ league_id: 'L' + season, season: String(season), settings: { playoff_week_start: 5, playoff_teams: 1 }, scoring_settings: { rec: 1 }, roster_positions: ['QB','RB','BN'], rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], ...extra });
const build = (weeks, extra = {}) => Journal.build({ weeks, start: 1, end: 4, league: league(2026), nameFor: rid => ['Alpha','Bravo'][rid - 1], playerName: id => id, ...extra });
const earlier = { league: league(2025, { settings: { playoff_week_start: 2 }, users: [{ user_id: 'a', metadata: { team_name: 'Old Alpha' } }, { user_id: 'b', display_name: 'Old Bravo' }] }), weeks: [{ week: 1, rows: [row(1, 250), row(2, 240)] }] };
const w = (week, a, b) => ({ week, rows: [row(1, a), row(2, b)] });
const comeback = build([w(1, 80, 100), w(2, 80, 110), w(3, 80, 120), w(4, 150, 140)], { priorSeasons: [earlier], archiveComplete: true });
assert(comeback.stories.some(s => s.category === 'Back in business'));
assert(comeback.stories.some(s => s.category === 'Streak snapped'));
assert(comeback.stories.some(s => s.category === 'Revenge game'));
assert.equal(comeback.archive.high, 250);
assert.equal(comeback.archive.records[0].name, 'Old Alpha', 'past records retain past names');
assert(comeback.stories.some(s => s.kind === 'recap' && s.related.some(r => r.label === 'What it means' && /1–3/.test(r.text))));
assert(!comeback.stories.some(s => /clinched|eliminated|comeback from/.test(s.body)), 'no unsupported clinches or in-game comebacks');
const weekOne = build([], { end: 0, priorSeasons: [earlier], board: { week: 1, rows: [row(1, 20), row(2, 0)] } });
assert.equal(weekOne.previews.length, 1, 'opening-week schedule coverage remains available');
assert.equal(weekOne.previews[0].category, 'Matchup preview', 'one old meeting alone does not manufacture an opening-week rivalry');
assert.equal(weekOne.rivals.length, 0);
const replaced = build([], { end: 0, league: league(2026, { rosters: [{ roster_id: 1, owner_id: 'new-owner' }, { roster_id: 2, owner_id: 'b' }] }), priorSeasons: [earlier], board: { week: 1, rows: [row(1, 0), row(2, 0)] } });
assert.equal(replaced.previews.length, 1, 'a replacement owner still gets an opening-week matchup preview');
assert.equal(replaced.rivals.length, 0, 'replacement owner does not inherit rivalry');
assert(!replaced.previews[0].related.some(r => r.label === 'Regular-season history'));
const changedRules = { ...earlier, league: { ...earlier.league, scoring_settings: { rec: 2 } } };
const changed = build([w(1, 100, 90)], { end: 1, priorSeasons: [changedRules], archiveComplete: true });
assert.equal(changed.archive.historicalHigh, 250, 'original-scoring record preserves all historical eras');
assert.equal(changed.archive.high, 100, 'incompatible scoring excluded from all-time comparison');
assert.equal(changed.archive.rulesChanged, true);
assert.equal(changed.archive.seasons.join(','), '2026', 'record coverage lists comparable years');
const newMark = build([w(1, 251, 200)], { end: 1, priorSeasons: [earlier], archiveComplete: true });
assert(newMark.stories.some(s => s.category === 'History made'));
const firstSeason = build([w(1, 100, 90), w(2, 120, 80)], { end: 2 });
assert(!firstSeason.stories.some(s => s.category === 'History made'), 'season records are not duplicated as historical milestones without history');
const division = build([w(1, 80, 100), w(2, 150, 90)], { end: 2, league: league(2026, { settings: { playoff_teams: 1, divisions: 2, playoff_week_start: 5 } }) });
const powerShift = division.stories.find(s => s.category === 'Power shift');
assert(powerShift && /The Wire’s standings/.test(powerShift.body));
assert(!/official|completed-results/.test(powerShift.body));
assert(powerShift.related.some(r => /official seeds may differ/.test(r.text)), 'ranking scope remains available for custom seeding');
assert(!division.stories.some(s => s.category === 'Playoff race' || s.related?.some(r => r.label === 'Playoff race')), 'division seeding is not inferred from overall rank');
const fourLeague = league(2026, { settings: { playoff_week_start: 4, playoff_teams: 2, league_average_match: 1 }, rosters: [1,2,3,4].map(i => ({ roster_id: i, owner_id: String(i) })) });
const median = build([{ week: 1, rows: [row(1, 120),row(2,110),row(3,90,2),row(4,80,2)] }], { end: 1, league: fourLeague, nameFor: id => String(id) });
assert.equal(median.table.find(t => t.rid === 1).wins, 2);
assert.equal(median.table.find(t => t.rid === 2).wins, 1);
assert.equal(median.table.find(t => t.rid === 2).losses, 1);
const sharedMargin = build([{ week: 1, rows: [row(1,120),row(2,100),row(3,90,2),row(4,70,2)] }], { end: 1, league: fourLeague, nameFor: id => String(id) });
assert.equal(sharedMargin.archive.margins.length, 2, 'all tied winning-margin holders remain in the book');
const missing = build([w(1,100,80), w(3,1000,800)]);
assert.equal(missing.completedThrough, 1);
assert.equal(missing.high, 100);
assert.equal(build([{ week: 1, rows: [row(1,100), row(1,90)] }]).stories.length, 0);
assert.equal(build([{ week: 1, rows: [row(1,100)] }]).stories.length, 0);
const totalMilestone = build([w(1,300,290),w(2,300,290),w(3,300,290),w(4,300,290)]);
assert(totalMilestone.stories.some(s => s.category === 'Milestone' && s.metric === '1,000'));
const pastNineWins = { ...earlier, league: { ...earlier.league, settings: { playoff_week_start: 10 } }, weeks: Array.from({ length: 9 }, (_, i) => w(i+1,120,100)) };
assert(build([w(1,130,100)], { end: 1, priorSeasons: [pastNineWins], archiveComplete: true }).stories.some(s => s.category === 'Career milestone' && s.metric === '10'));
assert(!build([w(1,130,100)], { end: 1, priorSeasons: [pastNineWins], archiveComplete: false }).stories.some(s => s.category === 'Career milestone'));

(async () => {
    const priorInfo = { ...earlier.league, previous_league_id: null };
    const rootInfo = { ...league(2026), previous_league_id: priorInfo.league_id };
    const responses = {
        L2026: rootInfo, L2025: priorInfo,
        'L2025/rosters': priorInfo.rosters, 'L2025/users': priorInfo.users,
        'L2025/matchups/1': earlier.weeks[0].rows,
    };
    let calls = 0;
    const fetcher = async url => { calls++; const key = url.split('/league/')[1]; return { ok: key in responses, json: async () => responses[key] }; };
    const progress = [];
    const archive = await Journal.loadArchive({ league: rootInfo, fetcher, force: true, onProgress: r => progress.push(r.seasons.length) });
    assert.equal(archive.complete, true);
    assert.equal(archive.seasons.length, 1);
    assert(progress.includes(1));
    const previousCalls = calls;
    await Journal.loadArchive({ league: rootInfo, fetcher });
    assert.equal(calls, previousCalls, 'warm archive reuses cached seasons');
    responses.L2025.previous_league_id = 'missing';
    const partial = await Journal.loadArchive({ league: rootInfo, fetcher, force: true });
    assert.equal(partial.complete, false);
    assert.equal(partial.seasons.length, 1, 'partial archive keeps verified seasons');
    responses.L2025.previous_league_id = 'L2026';
    assert.equal((await Journal.loadArchive({ league: rootInfo, fetcher, force: true })).complete, false, 'cycles cannot become all-time coverage');
    responses.L2025.previous_league_id = null;
    responses['L2025/matchups/1'] = [row(1,100),row(2,null)];
    assert.equal((await Journal.loadArchive({ league: rootInfo, fetcher, force: true })).complete, false, 'missing totals cannot establish records');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(Journal.loadArchive({ league: rootInfo, fetcher, force: true, signal: abort.signal }), /interrupted/);
    console.log('PASS Wire journal: owner continuity, revenge, streak resets, median results, playoff boundaries, milestones, rule changes, history caching, partial data and cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });

const candidates = [
    { id: 'archive', documentary: true, weight: 999, text: 'An old title' },
    { id: 'lead', kind: 'story', category: 'Power shift', rosterIds: [1], weight: 82, text: 'Grannies go first' },
    { id: 'repeat', kind: 'story', category: 'Scoring crown', rosterIds: [1], weight: 45, text: 'Grannies lead scoring' },
    { id: 'rivalry', kind: 'story', category: 'Rivalry watch', rosterIds: [2, 3], weight: 70, preview: true, text: 'A rivalry' },
    { id: 'duplicate', kind: 'story', category: 'Other preview', rosterIds: [3, 2], weight: 60, preview: true, text: 'Same matchup again' },
];
assert.equal(Journal.frontPage(candidates).map(s => s.id).join(','), 'lead,rivalry');
assert.equal(Journal.weeklyLookback(candidates, 'L2026:2').id, 'archive');
assert.equal(Journal.weeklyLookback(candidates.slice().reverse(), 'L2026:2').id, 'archive');
const newcomerLeague = league(2026, { rosters: [{ roster_id: 1, owner_id: 'new' }, { roster_id: 2, owner_id: 'b' }] });
const arrivals = build([w(1, 100, 90), w(2, 100, 90)], { end: 2, league: newcomerLeague, priorSeasons: [earlier], archiveComplete: true });
assert(arrivals.stories.some(s => s.category === 'New faces' && /2–0/.test(s.body)));
assert(!build([w(1, 100, 90)], { end: 1, league: newcomerLeague, priorSeasons: [earlier], archiveComplete: false }).stories.some(s => s.category === 'New faces'));
assert(!build([w(1, 100, 90)], { end: 1, priorSeasons: [earlier], archiveComplete: true, nameFor: () => 'Rebranded team' }).stories.some(s => s.category === 'New faces'), 'name changes are not new managers');
console.log('PASS editorial selection: current-only headlines, distinct subjects, stable weekly lookback and verified newcomers');

// A current matchup earns coverage on its own merits, without an old series.
const names = rid => ['Alpha', 'Bravo', 'Charlie', 'Delta'][rid - 1];
const weeklyRows = [
    { week: 1, rows: [row(1, 120), row(2, 90), row(3, 110, 2), row(4, 80, 2)] },
    { week: 2, rows: [row(1, 125), row(2, 100), row(3, 115, 2), row(4, 85, 2)] },
];
const nextBoard = { week: 3, rows: [row(1, 999), row(3, 999), row(2, 999, 2), row(4, 999, 2)] };
const currentLeague = { ...fourLeague, settings: { playoff_week_start: 5, playoff_teams: 2 } };
const previewOptions = { end: 2, league: currentLeague, nameFor: names, board: nextBoard };
const freshMatchups = build(weeklyRows, previewOptions);
assert.equal(freshMatchups.rivals.length, 0, 'first meetings are not automatically called historical rivalries');
assert.equal(freshMatchups.previews.length, 2, 'verified records produce previews without an archive');
const unbeatenPreview = freshMatchups.previews.find(s => s.rosterIds.includes(1));
assert.match(unbeatenPreview.text, /Unbeaten starts meet/);
assert.equal(unbeatenPreview.category, 'Matchup preview');
assert.equal(unbeatenPreview.formThrough, 2);
assert.match(unbeatenPreview.body, /2–0 for Alpha and 2–0 for Charlie/);
assert.match(unbeatenPreview.body, /122\.50 for Alpha and 112\.50 for Charlie/);
assert(!/999|projected|upcoming|will win/.test(unbeatenPreview.body), 'this week’s possibly live points never become completed form or a prediction');
assert.equal(unbeatenPreview.body.split('\n\n').length, 2, 'brief current stakes and scoring paragraphs');
assert.equal(build(weeklyRows.slice(0, 1), previewOptions).previews.length, 0, 'missing completed weeks cannot create a current-form preview');
assert.equal(build(weeklyRows, { ...previewOptions, board: { ...nextBoard, week: 4 } }).previews.length, 0, 'stale form is not presented as this week’s form');
assert.equal(build(weeklyRows, { ...previewOptions, headToHead: false }).previews.length, 0, 'no invented H2H coverage for non-H2H formats');
assert.equal(build(weeklyRows, { ...previewOptions, board: { ...nextBoard, week: 5 } }).previews.length, 0, 'regular-season context does not invent playoff previews');
const medianPreview = build(weeklyRows, { ...previewOptions, league: { ...currentLeague, settings: { ...currentLeague.settings, league_average_match: 1 } } }).previews[0];
assert.match(medianPreview.body, /4–0 for Alpha and 4–0 for Charlie, including median results/);
assert.match(medianPreview.body, /122\.50 for Alpha/, 'median games do not double the scoring-average denominator');
const lateStart = build(weeklyRows.map(w => ({ ...w, week: w.week + 2 })), { ...previewOptions, start: 3, end: 4, league: { ...currentLeague, settings: { start_week: 3, playoff_week_start: 8 } }, board: { ...nextBoard, week: 5 } });
assert.match(lateStart.previews[0].body, /Across 2 completed weeks, the scoring averages are 122\.50 for Alpha/, 'scoring averages honor the league start week');
const latestRecap = freshMatchups.stories.find(s => s.kind === 'recap' && s.week === 2 && s.rosterIds.includes(1));
assert.match(latestRecap.body, /125\.00–100\.00/);
assert.match(latestRecap.body.split('\n\n')[1], /Alpha at 2–0 and Bravo at 0–2/, 'visible recap copy explains the resulting records');
assert.match(median.stories.find(s => s.kind === 'recap').body, /including median results/, 'visible records preserve their scoring scope');
const rivalryWithForm = build(weeklyRows, { ...previewOptions, board: { week: 3, rows: weeklyRows[0].rows }, rivalries: [{ owners: ['1', '2'], name: 'The Derby' }] }).previews.find(s => s.followedRivalry);
assert(rivalryWithForm && rivalryWithForm.text.startsWith('The Derby:'));
assert.match(rivalryWithForm.body.split('\n\n')[0], /Through Week 2, the records are 2–0 for Alpha and 0–2 for Bravo/);
assert.match(rivalryWithForm.body.split('\n\n')[1], /recorded series/);
assert.equal(rivalryWithForm.weight, 84, 'current context preserves the priority of a rivalry the user follows');
console.log('PASS matchup reporting: current stakes, visible result significance, median-aware averages, incomplete/stale cutoffs, new pairings and selected rivalries');

vm.runInContext(fs.readFileSync('js/shared/league-wire-identity.js', 'utf8'), context);
const namedLeague = league(2026, { users: [{ user_id: 'a', display_name: 'Alice', metadata: { team_name: 'Current Alpha' } }, { user_id: 'b', display_name: 'Bob', metadata: { team_name: 'Current Bravo' } }] });
const namedPast = { ...earlier, league: { ...earlier.league, users: [{ user_id: 'a', display_name: 'Alice', metadata: { team_name: 'Old Alpha' } }, { user_id: 'b', display_name: 'Bob', metadata: { team_name: 'Old Bravo' } }] } };
const ownersEdition = build([w(1, 100, 90)], { league: namedLeague, end: 1, priorSeasons: [namedPast], nameFor: rid => rid === 1 ? 'Current Alpha' : 'Current Bravo', rivalries: [{ owners: ['a', 'b'] }], board: { week: 2, rows: [row(1, 0), row(2, 0)] } });
const namedRecap = ownersEdition.stories.find(s => s.kind === 'recap');
assert.match(namedRecap.text, /Current Alpha/);
assert.equal(namedRecap.participants[0].ownerName, 'Alice');
assert.equal(namedRecap.participants[0].teamName, 'Current Alpha');
assert.equal(ownersEdition.rivals[0].a, 'Alice');
assert.equal(ownersEdition.rivals[0].teamA, 'Current Alpha');
assert.match(ownersEdition.previews[0].body, /recorded series has produced 2 wins for Alice and 0 for Bob/);
assert.equal(ownersEdition.archive.records[0].name, 'Alice');
assert.equal(ownersEdition.archive.records[0].teamName, 'Old Alpha');
assert.equal(ownersEdition.archive.records[0].ownerId, 'a');
const namedMilestone = build([w(1, 130, 100)], { league: namedLeague, end: 1, priorSeasons: [{ ...pastNineWins, league: namedPast.league, weeks: pastNineWins.weeks }], archiveComplete: true });
// Use the historical season's nine-week boundary for the career counter.
const career = build([w(1, 130, 100)], { league: namedLeague, end: 1, priorSeasons: [{ ...pastNineWins, league: { ...namedPast.league, settings: { playoff_week_start: 10 } } }], archiveComplete: true });
assert.match(career.stories.find(s => s.category === 'Career milestone').text, /^Alice: win No\. 10$/);
assert(!namedMilestone.stories.some(s => s.category === 'Career milestone'), 'a season boundary still limits owner career totals');
console.log('PASS owner-first journalism: current team headlines, person/team metadata, owner-based series, career milestones and original-season team names');

// A rivalry needs evidence beyond merely having shared a schedule.
const schedule = { week: 3, rows: [row(1, 0), row(2, 0)] };
const ordinary = build([w(1, 100, 90), w(2, 90, 100)], { end: 2, board: schedule });
assert.equal(ordinary.rivals.length, 0, 'a two-game split alone is an ordinary rematch');
assert.equal(ordinary.previews[0].category, 'Matchup preview');
assert(ordinary.previews[0].related.some(r => r.label === 'Regular-season history' && /1 win for Alpha and 1 for Bravo/.test(r.text)), 'ordinary previews keep verified history in supporting detail');
assert(!/rivalry|next chapter|Fresh stakes/.test(ordinary.previews[0].text));
const historyOf = scores => ({ league: league(2025, { settings: { playoff_week_start: scores.length + 1 } }), weeks: scores.map((pair, i) => w(i + 1, ...pair)) });
const splitHistory = historyOf([[120,90],[80,110],[130,100],[90,115]]);
const competitive = build([], { end: 0, priorSeasons: [splitHistory], board: { ...schedule, week: 1 } });
assert.equal(competitive.rivals.length, 1, 'a sustained competitive series earns discovery');
assert.match(competitive.previews[0].text, /break the deadlock/);
const closeHistory = historyOf([[102,100],[100,101],[120,100]]);
const close = build([], { end: 0, priorSeasons: [closeHistory], board: { ...schedule, week: 1 } });
assert.equal(close.rivals.length, 1, 'repeated close meetings with wins on both sides earn discovery');
assert.match(close.previews[0].text, /2 meetings decided by five or fewer/);
const oneSided = build([], { end: 0, priorSeasons: [historyOf([[120,90],[110,80],[130,90],[140,100],[130,90]])], board: { ...schedule, week: 1 } });
assert.equal(oneSided.rivals.length, 0, 'a schedule repeatedly dominated by one owner does not establish a rivalry by itself');
const selectedWithoutHistory = build([], { end: 0, board: { ...schedule, week: 1 }, rivalries: [{ owners: ['a', 'b'], name: 'Family feud' }] });
assert.equal(selectedWithoutHistory.rivals.length, 1);
assert.equal(selectedWithoutHistory.previews[0].text, 'Family feud: Alpha vs. Bravo');
assert.match(selectedWithoutHistory.previews[0].body, /No completed regular-season meetings/);
const medianMisfortuneWeeks = weeklyRows.map((week, i) => ({ ...week, rows: week.rows.map(r => r.roster_id === 2 ? { ...r, points: 115 + i * 5 } : r) }));
const mediansDoNotInventWins = build(medianMisfortuneWeeks, { ...previewOptions, league: fourLeague, board: { week: 3, rows: [row(2, 999), row(4, 999), row(1, 999, 2), row(3, 999, 2)] } }).previews.find(s => s.rosterIds.includes(2));
assert.match(mediansDoNotInventWins.text, /first head-to-head win/);
assert.match(mediansDoNotInventWins.body, /2–2 for Bravo and 0–4 for Delta, including median results/);
const unbeatenOpponent = build(weeklyRows, { ...previewOptions, board: { week: 3, rows: [row(1, 0), row(4, 0), row(2, 0, 2), row(3, 0, 2)] } }).previews.find(s => s.rosterIds.includes(1));
assert.match(unbeatenOpponent.text, /An unbeaten test: Delta vs. Alpha/);
const noThinLookback = Journal.weeklyLookback([{ id: 'thin', documentary: true, lookbackEligible: false }, { id: 'substantive', documentary: true }], '2026:2');
assert.equal(noThinLookback.id, 'substantive', 'bare archive entries remain outside the featured lookback rotation');
console.log('PASS editorial gates: meaningful rivalry discovery, selected rivalries, current matchup stakes and substantive lookbacks');

const plainHistory = build([], { end: 0, priorSeasons: [namedPast] });
const retrospective = plainHistory.stories.find(s => s.category === 'Season review');
assert(retrospective && retrospective.documentary && retrospective.eventSeason === 2025);
assert.match(retrospective.text, /Alice’s 1–0 regular season in 2025/);
assert.match(retrospective.body, /250.00 in Week 1/);
assert.match(retrospective.body, /beat Bob 250.00–240.00/);
assert(!/champion|playoff seed/.test(retrospective.body), 'regular-season leadership does not award a championship');
assert.equal(retrospective.sources.length, 1);
assert.equal(retrospective.sources[0].url, 'https://api.sleeper.app/v1/league/L2025/matchups/1');
assert.equal(retrospective.participants[0].ownerName, 'Alice');
assert.equal(retrospective.participants[0].teamName, 'Old Alpha');
assert(!build([], { end: 0, priorSeasons: [{ ...namedPast, league: { ...namedPast.league, settings: { playoff_week_start: 3 } } }] }).stories.some(s => s.category === 'Season review'), 'one missing week withholds a season retrospective');
assert(!build([], { end: 0, priorSeasons: [{ ...namedPast, league: { ...namedPast.league, season: '2027' } }] }).stories.some(s => s.documentary), 'future seasons cannot generate history');
const medianHistory = { league: { ...fourLeague, league_id: 'L2025', season: '2025', settings: { ...fourLeague.settings, playoff_week_start: 3 } }, weeks: medianMisfortuneWeeks };
const medianRetrospective = build([], { end: 0, priorSeasons: [medianHistory] }).stories.find(s => s.category === 'Season review');
assert.match(medianRetrospective.body, /4–0, including median results/);
assert.match(medianRetrospective.related[0].text, /All 2 regular-season weeks/);
assert(Journal.frontPage(plainHistory.stories).length === 0, 'generic retrospectives never enter current headlines');
console.log('PASS generic league history: complete-season reviews, owner-first identity, original scores, median records, missing weeks and future cutoffs');

const firstSeasonOpening = build([], { end: 0, board: { week: 1, rows: [row(1, 0), row(2, 0)] } });
assert.equal(firstSeasonOpening.previews.length, 1);
assert.equal(firstSeasonOpening.previews[0].category, 'Matchup preview');
assert.match(firstSeasonOpening.previews[0].text, /Opening week: Alpha vs. Bravo/);
assert(firstSeasonOpening.previews[0].related.some(r => /Awaiting the first completed/.test(r.text)));
assert(!/0–0|average|rivalry/.test(firstSeasonOpening.previews[0].body), 'opening coverage does not invent current form or rivalry');

// Copy must preserve ties, exact thresholds and the identity behind historical scores.
const accountNames = rid => rid === 1 ? 'mwitkowski' : 'Dirty Mike and the Boys';
const tiedVoice = build([w(1, 100, 100)], { end: 1, nameFor: accountNames }).stories.find(s => s.kind === 'recap');
assert.match(tiedVoice.text, /tied at 100.00/);
assert(!/won|beat|winning/.test(tiedVoice.body), 'level scores never acquire a winning lede');
const exactMilestone = build([w(1, 250, 200), w(2, 250, 200), w(3, 250, 200), w(4, 250, 200)], { nameFor: accountNames }).stories.find(s => s.category === 'Milestone');
assert.match(exactMilestone.text, /reached 1,000/);
assert.match(exactMilestone.body, /season total to 1000.00/);
assert(!/past|passing|over the line/.test(exactMilestone.body + exactMilestone.text), 'an exact milestone is reached, not passed');
const oldReversed = historyOf([[90, 100], [90, 100]]);
const reversedVoice = build([], { end: 0, priorSeasons: [oldReversed], board: { week: 1, rows: [row(1, 0), row(2, 0)] }, rivalries: [{ owners: ['a', 'b'] }], nameFor: accountNames }).previews[0];
assert.match(reversedVoice.body, /Dirty Mike and the Boys won the last meeting 100.00–90.00 in 2025, Week 2/);
console.log('PASS newsroom facts: tied results, exact milestones and dated winner-first history');
