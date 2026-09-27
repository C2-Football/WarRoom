'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = { console }; root.window = root;
vm.createContext(root);
for (const file of ['league-live-scores', 'league-wire-identity', 'league-wire-features', 'league-wire-journal']) vm.runInContext(fs.readFileSync(`js/shared/${file}.js`, 'utf8'), root);
const row = (roster_id, points, matchup_id) => ({ roster_id, points, matchup_id });
const league = { league_id: '26', previous_league_id: '25', season: '2026', settings: { playoff_week_start: 5, league_average_match: 1 },
    rosters: ['alice', 'bob', 'carol', 'dan', 'erin', 'fred'].map((owner_id, i) => ({ roster_id: i + 1, owner_id })),
    users: ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Fred'].map((display_name, i) => ({ user_id: display_name.toLowerCase(), display_name, metadata: { team_name: ['New Hat', 'Bench Press', 'The Points Department', 'Fourth and Long', 'Bye Curious', 'Sunday Best'][i] } })) };
const earlier = { league: { ...league, league_id: '25', previous_league_id: null, season: '2025', rosters: [{ roster_id: 1, owner_id: 'bob' }, { roster_id: 2, owner_id: 'alice' }, ...league.rosters.slice(2)],
    users: league.users.map(user => user.user_id === 'alice' ? { ...user, metadata: { team_name: 'Old Hat' } } : user) }, weeks: [] };
const weeks = [
    { week: 1, rows: [row(1, 101, 1), row(2, 100, 1), row(3, 150, 2), row(4, 80, 2), row(5, 90, 3), row(6, 70, 3)] },
    { week: 2, rows: [row(1, 110, 1), row(2, 108, 1), row(3, 150, 2), row(4, 80, 2), row(5, 70, 3), row(6, 60, 3)] },
    { week: 3, rows: [row(1, 1000, 1), row(2, 900, 1), row(3, 800, 2), row(4, 700, 2), row(5, 600, 3), row(6, 500, 3)] },
];
const build = extra => root.WrWireStories.build({ league, weeks, start: 1, end: 2, nameFor: rid => root.WrWireStories.oldName(league, rid), priorSeasons: [earlier], ...extra });
const edition = build();
assert.equal(edition.features.length, 4);
assert(edition.weeklyFeature && edition.features.some(f => f.id === edition.weeklyFeature.id));
assert(edition.features.every(f => f.feature === true && f.sources.length > 0 && f.week === 2 && f.participants.length > 0));
assert(edition.features.every(f => f.body.split(/\s+/).length < 110), 'features stay short rather than becoming articles by volume');
assert(edition.features.every(f => f.body.split('\n\n').length === 2));
assert(!edition.stories.some(s => s.feature), 'the lighter-side desk does not crowd hard-news coverage');
assert(!root.WrWireStories.frontPage([...edition.stories, ...edition.features]).some(s => s.feature));
assert.equal(build().weeklyFeature.id, edition.weeklyFeature.id, 'weekly selection is stable on reload');
assert.equal(build({ weeks: weeks.slice().reverse() }).weeklyFeature.id, edition.weeklyFeature.id, 'provider row order does not change the chosen feature');

const cardiac = edition.features.find(f => f.featureType === 'cardiac-club');
assert.match(cardiac.text, /^Alice and the Cardiac Club$/);
assert.match(cardiac.body, /2 head-to-head games.*going 2–0/);
assert.match(cardiac.body, /110\.00–108\.00.*2\.00-point margin/);
assert.equal(cardiac.participants[0].ownerName, 'Alice');
assert.equal(cardiac.participants[0].teamName, 'New Hat');
const unlucky = edition.features.find(f => f.featureType === 'wrong-opponent');
assert.match(unlucky.text, /^Bob vs\. the schedule$/);
assert.match(unlucky.body, /108\.00.*better than 3 of the other 5 teams/);
assert.match(unlucky.body, /median game did supply a win/);
assert(!/1,000|1000\.00|Week 3/.test(JSON.stringify(edition.features)), 'later results cannot leak into an earlier feature edition');

const makeover = edition.features.find(f => f.featureType === 'new-threads');
assert.match(makeover.body, /2025, Alice ran “Old Hat”\./);
assert.match(makeover.body, /team is “New Hat/);
assert.match(makeover.body, /4–0 record, including median games/);
assert.equal(makeover.participants[0].rosterId, 1, 'a name change follows the owner even when the roster slot changed');
assert(makeover.sources.some(s => /\/25\/rosters$/.test(s.url)));
const nameGame = edition.features.find(f => f.featureType === 'name-game');
assert(nameGame.related.some(r => /playful opinions.*not an official award, a league vote/.test(r.text)));
assert.equal(new Set(nameGame.participants.map(p => p.teamName)).size, 2);
assert(!nameGame.body.includes('The group chat can take it from here'), 'the name desk publishes a specific opinion, not an unanswered poll prompt');
assert(/“[^”]+”/.test(nameGame.text), 'the actual reviewed name belongs in the headline');
const allCaps = build({ league: { ...league, users: league.users.map((user, i) => ({ ...user, metadata: { team_name: i === 0 ? 'HERE COME THE GRANNIES' : 'Plain Name ' + i } })) } }).features.find(f => f.featureType === 'name-game');
assert.match(allCaps.body, /capitals.*stadium announcement/);
const alphabet = build({ end: 1, league: { ...league, users: league.users.map((user, i) => ({ ...user, metadata: { team_name: i === 0 ? 'Jiggy Jaguar' : i === 1 ? 'Fantasy Team' : 'Plain Name ' + i } })) } }).features.find(f => f.featureType === 'name-game');
assert.match(alphabet.body, /repeated J sound.*Jiggy Jaguar/); assert.match(alphabet.body, /friendly editing desk.*Fantasy Team/);
assert(!/owner is|owner has no|idiot|stupid/i.test(alphabet.body), 'the playful edit concerns the name, not personal judgment');
const linkedOlder = { league: { ...earlier.league, league_id: '24', season: '2024', users: earlier.league.users.map(user => user.user_id === 'alice' ? { ...user, metadata: { team_name: 'Ancient Hat' } } : user) }, weeks: [] };
const namesOverTime = build({ priorSeasons: [{ ...earlier, league: { ...earlier.league, previous_league_id: '24' } }, linkedOlder] }).features.find(f => f.featureType === 'name-archive');
assert(namesOverTime); assert.match(namesOverTime.body, /Old Hat.*2025/); assert.match(namesOverTime.body, /Ancient Hat.*2024/);
assert.match(namesOverTime.related[0].text, /same owner account.*editorial opinion/);
const reboundWeeks = JSON.parse(JSON.stringify(weeks)); reboundWeeks[1].rows[3].points = 170;
const bounce = build({ weeks: reboundWeeks }).features.find(f => f.featureType === 'bounce-back');
assert(bounce); assert.match(bounce.body, /80.00 points and a loss.*170.00 and a head-to-head win/);
assert.equal(bounce.sources.length, 2); assert(!bounce.body.includes('injur'), 'a rebound has no invented player or injury cause');

assert.equal(build({ weeks: weeks.filter(w => w.week !== 1) }).features.length, 0, 'a missing completed week cannot generate fresh features');
assert.equal(build({ weeks: [], end: 0 }).features.length, 0);
assert.equal(build({ end: 5 }).features.length, 0, 'regular-season features do not consume playoff rows');
assert.equal(build({ headToHead: false }).features.length, 0);
assert.equal(build({ league: { ...league, type: 'chopped' } }).features.length, 0);
assert(!build({ end: 1 }).features.some(f => f.featureType === 'cardiac-club'), 'one narrow result does not manufacture a season-long habit');
const unknown = build({ league: { ...league, rosters: league.rosters.map(r => r.roster_id === 1 ? { ...r, owner_id: 'replacement' } : r) } });
assert(!unknown.features.some(f => f.featureType === 'new-threads'), 'a replacement does not inherit a team-name history');
assert(!unknown.features.find(f => f.featureType === 'cardiac-club').participants[0].ownerKnown);
const foreign = build({ priorSeasons: [{ ...earlier, league: { ...earlier.league, league_id: 'unrelated' } }] });
assert(!foreign.features.some(f => f.featureType === 'new-threads'), 'same owner in an unrelated league does not create a name-change story');
const sameNames = build({ league: { ...league, users: league.users.map(u => ({ ...u, metadata: { team_name: 'Same name' } })) } });
assert(!sameNames.features.some(f => f.featureType === 'name-game'), 'the rotation does not invent a distinct second name');
const noNames = build({ league: { ...league, users: league.users.map(u => ({ ...u, metadata: {} })) } });
assert(!noNames.features.some(f => ['name-game', 'new-threads'].includes(f.featureType)), 'account display names are not invented team names');
for (const punctuation of ['?', '!', '.']) {
    const name = 'Is The Price Right' + punctuation;
    const punctuated = build({ league: { ...league, users: league.users.map(u => u.user_id === 'alice' ? { ...u, metadata: { team_name: name } } : u) } }).features.find(f => f.featureType === 'new-threads');
    assert(punctuated.body.includes(`the team is “${name}” The jersey`), 'quoted team names keep their punctuation without an extra period');
}
const original = JSON.stringify({ league, weeks, earlier });
build();
assert.equal(JSON.stringify({ league, weeks, earlier }), original, 'feature generation leaves source data unchanged');
console.log('PASS Wire features: grounded short humor, owner-first metadata, close-game evidence, weekly scoring context, median scope, real name changes, deterministic nomination and chronology/identity boundaries');
