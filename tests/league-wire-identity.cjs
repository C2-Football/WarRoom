'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = { console }; root.window = root; vm.createContext(root);
for (const name of ['league-wire-chronicles-data', 'league-wire-chronicles', 'league-wire-identity']) vm.runInContext(fs.readFileSync(`js/shared/${name}.js`, 'utf8'), root);
const api = root.WrWireIdentity, plain = value => JSON.parse(JSON.stringify(value));
const one = { league_id: '1356311207652360192', season: '2026', rosters: [{ roster_id: 7, owner_id: '540392203863576576' }], users: [{ user_id: '540392203863576576', display_name: 'skjjcruz', metadata: { team_name: 'Dirty Mike and the boys' } }] };
assert.deepEqual(plain(api.resolve(one, 7)), { ownerId: '540392203863576576', ownerName: 'Steve Crusinberry', teamName: 'Dirty Mike and the boys', ownerKnown: true });
const psycho = { ...one, league_id: '1312100327931019264' };
assert.equal(api.resolve(psycho, 7).ownerName, 'skjjcruz', 'the same account must not import another league’s documented human-name binding');
assert.equal(api.resolve({ ...one, league_id: '99999', name: 'The One' }, 7).ownerName, 'skjjcruz', 'matching a league name does not select its sourcebook');
const source = { workbook: 'League history.xlsx', sheet: 'Owners', range: 'A1:B2' };
const evidence = [{ season: 2024, sources: [source] }];
const book = { name: 'Identity fixture', leagueIds: ['current', 'past'], facts: [], ownerBindings: [
    { ownerId: 'a', documentedName: 'Alice Adams', evidence },
    { ownerId: 'b', documentedName: 'Blake Brown', evidence },
    { ownerId: 'former', documentedName: 'Former Manager', evidence },
] };
root.WrWireChroniclesData = { fixture: book };
const league = { league_id: 'current', season: '2026', previous_league_id: 'past', rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }, { roster_id: 3, owner_id: 'replacement' }], users: [
    { user_id: 'a', display_name: 'alice_handle', username: 'alice_user', metadata: { team_name: 'The Same Team' } },
    { user_id: 'b', display_name: 'blake_handle', metadata: { team_name: 'The Same Team' } },
    { user_id: 'replacement', display_name: 'NewManager', metadata: { team_name: 'Legacy Team' } },
] };
const old = { league_id: 'past', season: '2025', previous_league_id: null, rosters: [{ roster_id: 1, owner_id: 'b' }, { roster_id: 2, owner_id: 'a' }, { roster_id: 3, owner_id: 'former' }], users: [
    { user_id: 'a', display_name: 'alice_old_handle', metadata: { team_name: 'Alice’s Old Team' } },
    { user_id: 'b', display_name: 'blake_old_handle', metadata: { team_name: 'Blake’s Old Team' } },
    { user_id: 'former', display_name: 'former_handle', metadata: { team_name: 'Legacy Team' } },
] };
const priorSeasons = [{ league: old, weeks: [] }];
assert.equal(api.resolve(league, 1).ownerName, 'Alice Adams');
assert.equal(api.resolve(old, 2).ownerName, 'Alice Adams', 'owner ID, not changing roster slot, carries verified identity');
assert.equal(api.resolve(old, 2).teamName, 'Alice’s Old Team', 'historical resolution retains the season’s original team name');
assert.equal(api.resolve(league, 2).teamName, api.resolve(league, 1).teamName);
assert.notEqual(api.resolve(league, 2).ownerId, api.resolve(league, 1).ownerId, 'two matching team names remain distinct owners');
assert.equal(api.resolve(league, 3, { priorSeasons }).ownerName, 'NewManager', 'a replacement does not inherit the previous slot owner’s name');
assert.deepEqual(plain(api.forOwner(league, 'former', { priorSeasons })), { ownerId: 'former', ownerName: 'Former Manager', teamName: 'Legacy Team', ownerKnown: true });
assert.equal(api.forOwner(league, 'a', { priorSeasons }).teamName, 'The Same Team', 'current-owner labels prefer their current team');
assert.equal(api.forOwner(league, 'former').teamName, null, 'a documented former owner does not gain an invented present-day team');
const overridden = api.resolve(league, 1, { teamName: '  A custom display label  ' });
assert.equal(overridden.teamName, 'A custom display label'); assert.equal(overridden.ownerName, 'Alice Adams', 'a display override cannot redefine owner identity');
book.ownerBindings.push({ ownerId: 'a', documentedName: 'Another Alice', evidence });
assert.equal(api.resolve(league, 1).ownerName, 'alice_handle', 'conflicting documented names fall back to the actual account handle');
book.ownerBindings.pop();
book.ownerBindings.push({ ownerId: 'a', documentedName: 'Alice Adams', evidence });
assert.equal(api.resolve(league, 1).ownerName, 'Alice Adams', 'repeated evidence for one name is not a conflict');
book.ownerBindings.pop();
book.ownerBindings.push({ ownerId: 'replacement', documentedName: 'Unverified Human', evidence: [] });
assert.equal(api.resolve(league, 3).ownerName, 'NewManager', 'a human-name claim without supporting evidence is not promoted');
book.ownerBindings.pop();
book.ownerBindings.push({ ownerId: 'b', documentedName: 'Alice Adams', evidence });
assert.equal(api.resolve(league, 2).ownerName, 'blake_handle', 'one account with conflicting documented names stays separate');
book.ownerBindings.pop();
const accountOnly = { league_id: 'unknown', season: '2026', previous_league_id: 'old-unknown', rosters: [{ roster_id: 1, owner_id: 'u' }], users: [{ user_id: 'u', username: 'user_handle', metadata: { team_name: 'A Human Looking Team Name' } }] };
assert.equal(api.resolve(accountOnly, 1).ownerName, 'user_handle', 'account username is a safe fallback independent of team metadata');
const unknownName = api.resolve({ ...accountOnly, users: [{ user_id: 'u', metadata: { team_name: 'Imagined Owner Name' } }] }, 1);
assert.equal(unknownName.ownerId, 'u'); assert.equal(unknownName.ownerName, null); assert.equal(unknownName.ownerKnown, false); assert.equal(unknownName.teamName, 'Imagined Owner Name');
assert.deepEqual(plain(api.resolve({ ...accountOnly, rosters: [{ roster_id: 1 }] }, 1)), { ownerId: null, ownerName: null, teamName: 'Team 1', ownerKnown: false });
assert.equal(api.resolve({ ...accountOnly, rosters: [{ roster_id: 1, owner_id: 'u' }, { roster_id: 1, owner_id: 'v' }] }, 1).ownerId, null, 'duplicate roster slots do not choose an arbitrary owner');
assert.equal(api.resolve({ ...accountOnly, users: [{ user_id: 'u', display_name: 'First' }, { user_id: 'u', display_name: 'Other' }] }, 1).ownerKnown, false, 'conflicting account rows are not silently collapsed');
const lost = { league_id: 'old-unknown', season: '2025', previous_league_id: null, rosters: [{ roster_id: 1, owner_id: 'gone' }], users: [{ user_id: 'gone', display_name: 'old_account', metadata: { team_name: 'Former Club' } }] };
assert.equal(api.forOwner(accountOnly, 'gone', { priorSeasons: [{ league: lost }] }).ownerName, 'old_account');
assert.equal(api.forOwner(accountOnly, 'gone', { priorSeasons: [{ league: { ...lost, league_id: 'unrelated', name: accountOnly.name } }] }).ownerKnown, false, 'a same-account entry from an unrelated league is not an owner record for this league');
assert.equal(api.forOwner(accountOnly, 'gone', { priorSeasons: [{ league: { ...lost, season: '2027' } }] }).ownerKnown, false, 'future owners cannot leak into an earlier season');
assert.equal(api.forOwner(accountOnly, 'gone', { priorSeasons: [{ league: lost }, { league: { ...lost, users: [{ user_id: 'gone', display_name: 'Conflicting snapshot' }] } }] }).ownerKnown, false, 'ambiguous history snapshots do not choose one name');
assert.equal(api.forOwner({ ...league, previous_league_id: 'not-loaded' }, 'former', { priorSeasons }).teamName, 'Legacy Team', 'a unique sourcebook membership can bridge an unloaded season without guessing by league name');
assert.equal(api.forOwner(league, null, { priorSeasons }).ownerKnown, false);

const uploaded = 'https://sleepercdn.com/uploads/alice-team_2026.jpg', accountAvatar = 'alice_avatar-26';
const logoLeague = { ...league, name: 'The One', avatar: 'league_avatar', users: league.users.map(user => ({ ...user, avatar: user.user_id === 'a' ? accountAvatar : `${user.user_id}_avatar`, metadata: { ...user.metadata, ...(user.user_id === 'a' ? { avatar: uploaded } : {}) } })) };
const thumb = value => `https://sleepercdn.com/avatars/thumbs/${value}`;
assert.deepEqual(plain(api.logoSources(logoLeague, 1)), [uploaded, thumb(accountAvatar)], 'a team upload precedes the owner account image so the UI can fall back in order');
assert.deepEqual(plain(api.logoSources(logoLeague)), [thumb('league_avatar')]);
assert.deepEqual(plain(api.logoSources({ ...logoLeague, avatar: uploaded })), [uploaded], 'league logos also support a trusted upload URL');
assert.deepEqual(plain(api.logoSources({ ...logoLeague, users: logoLeague.users.map(user => user.user_id === 'a' ? { ...user, metadata: { ...user.metadata, avatar: thumb(accountAvatar) } } : user) }, 1)), [thumb(accountAvatar)], 'identical custom and account sources are tried once');
assert.deepEqual(plain(api.logoSources({ ...logoLeague, rosters: [...logoLeague.rosters, { roster_id: 1, owner_id: 'b' }] }, 1)), [], 'an ambiguous roster cannot select someone’s logo');
assert.deepEqual(plain(api.logoSources({ ...logoLeague, users: [...logoLeague.users, logoLeague.users[0]] }, 1)), [], 'duplicate owner account rows are not silently chosen');
assert.deepEqual(plain(api.logoSources({ ...logoLeague, rosters: [{ roster_id: 1 }] }, 1)), []);
assert.deepEqual(plain(api.logoSources(logoLeague, 999)), []);
assert.deepEqual(plain(api.logoSources(logoLeague, null)), [], 'explicit invalid roster IDs do not accidentally request a league image');
for (const unsafe of [
    'https://example.com/team.png', 'https://sleepercdn.com.example.com/uploads/team.png', 'http://sleepercdn.com/uploads/team.png',
    '//sleepercdn.com/uploads/team.png', 'data:image/png;base64,AA', 'javascript:alert(1)', 'https://owner:secret@sleepercdn.com/uploads/team.png',
    'https://sleepercdn.com:443/uploads/team.png', 'https://sleepercdn.com/content/nfl/team.png', 'https://sleepercdn.com/uploads/../avatars/team.png',
    'https://sleepercdn.com/uploads/%2e%2e/avatar.png', 'https://sleepercdn.com/uploads/a%2fb.png', 'https://sleepercdn.com/uploads/a\\b.png',
    'https://sleepercdn.com/uploads/a.png?redirect=https://example.com', 'https://sleepercdn.com/uploads/a.png#fragment',
    'https://sleepercdn.com/uploads/.hidden', 'https://sleepercdn.com/uploads//team.png', 'https://sleepercdn.com/uploads/team.png\n/extra',
]) {
    const changed = { ...logoLeague, users: logoLeague.users.map(user => user.user_id === 'a' ? { ...user, metadata: { ...user.metadata, avatar: unsafe } } : user) };
    assert.deepEqual(plain(api.logoSources(changed, 1)), [thumb(accountAvatar)], `untrusted custom URL falls back to the account: ${unsafe}`);
    assert.deepEqual(plain(api.logoSources({ ...logoLeague, avatar: unsafe })), [], `untrusted league URL is never returned: ${unsafe}`);
}
for (const unsafeHash of ['../another', 'avatar.png', 'a/b', 'a?b', 'a#b', 'a%b', 'a:b', 'a'.repeat(129), 'https://sleepercdn.com/avatars/a']) {
    const changed = { ...logoLeague, users: logoLeague.users.map(user => user.user_id === 'a' ? { ...user, avatar: unsafeHash, metadata: {} } : user) };
    assert.deepEqual(plain(api.logoSources(changed, 1)), [], 'account avatar values must be identifiers, not URLs or paths');
}
const currentStory = { season: '2026', rosterIds: [1, 2], participants: [{ ownerId: 'a', rosterId: 1, season: '2026' }, { ownerId: 'b', rosterId: 2, season: '2026' }] };
const marks = plain(api.storyMarks(logoLeague, currentStory));
assert.deepEqual(marks[0], { key: 'owner:a', label: 'Alice Adams', initials: 'AA', sources: [uploaded, thumb(accountAvatar)] });
assert.equal(marks.length, 2); assert.equal(marks[1].label, 'Blake Brown');
assert.equal(api.storyMarks(logoLeague, { ...currentStory, participants: [...currentStory.participants, { ownerId: 'replacement', rosterId: 3, season: '2026' }] }).length, 2, 'story marks stay bounded to two');
assert.equal(api.storyMarks(logoLeague, { season: '2026', participants: [currentStory.participants[0], currentStory.participants[0]], rosterIds: [1, 1] }).length, 1, 'duplicate participants and roster IDs do not duplicate a mark');
const moved = plain(api.storyMarks(logoLeague, { season: '2026', rosterIds: [2], participants: [{ ownerId: 'a', rosterId: 2, season: '2026' }] }));
assert.deepEqual(moved, [marks[0]], 'the owner account wins when a supplied roster slot points at someone else');
const departed = plain(api.storyMarks(logoLeague, { season: '2026', rosterIds: [3], participants: [{ ownerId: 'former', ownerName: 'Former Manager', rosterId: 3, season: '2026' }] }));
assert.deepEqual(departed, [{ key: 'owner:former', label: 'Former Manager', initials: 'FM', sources: [] }], 'a departed owner keeps initials and never inherits the replacement’s image');
const ambiguousOwner = plain(api.storyMarks({ ...logoLeague, rosters: [...logoLeague.rosters, { roster_id: 4, owner_id: 'a' }] }, { season: '2026', participants: [{ ownerId: 'a', ownerName: 'Alice Adams', rosterId: 1, season: '2026' }], rosterIds: [1] }));
assert.deepEqual(ambiguousOwner[0].sources, [], 'an account on multiple roster slots is not arbitrarily mapped');
const noImages = { ...logoLeague, users: logoLeague.users.map(user => ({ ...user, avatar: null, metadata: { team_name: user.metadata.team_name } })) };
assert.deepEqual(plain(api.storyMarks(noImages, currentStory))[0], { ...marks[0], sources: [] }, 'known identity supplies usable initials when every image is absent');
assert.deepEqual(plain(api.storyMarks(logoLeague, { documentary: true, season: '2026', eventSeason: 2024, ...{ rosterIds: [1], participants: currentStory.participants } })), [{ key: 'archive:2024', label: '2024 archive', initials: '2024', sources: [] }], 'documentary stories show the event year, never current team branding');
assert.deepEqual(plain(api.storyMarks(logoLeague, { ...currentStory, season: '2025' })), [{ key: 'archive:2025', label: '2025 archive', initials: '2025', sources: [] }]);
assert.deepEqual(plain(api.storyMarks(logoLeague, { ...currentStory, participants: currentStory.participants.map(person => ({ ...person, season: '2025' })) })), [], 'mismatched participant seasons cannot fall back through bare roster IDs');
const unnamed = plain(api.storyMarks(logoLeague, { season: '2026', participants: [{ rosterId: 1, teamName: 'Source Team' }] }));
assert.deepEqual(unnamed[0].sources, [uploaded, thumb(accountAvatar)], 'unknown owners can use a roster slot when the source season explicitly matches');
assert.equal(unnamed[0].label, 'Source Team', 'an explicit source name is preserved rather than inferred');
const unscoped = plain(api.storyMarks(logoLeague, { participants: [{ rosterId: 1, teamName: 'Unscoped Team' }], rosterIds: [1] }));
assert.deepEqual(unscoped[0].sources, [], 'an unknown participant without a source season cannot borrow current identity');
const leagueMark = [{ key: 'league:current', label: 'The One', initials: 'TO', sources: [thumb('league_avatar')] }];
assert.deepEqual(plain(api.storyMarks(logoLeague, { season: '2026' })), leagueMark);
assert.deepEqual(plain(api.storyMarks(logoLeague, null)), leagueMark);
assert.deepEqual(plain(api.storyMarks({ ...logoLeague, avatar: null }, {})), [{ ...leagueMark[0], sources: [] }], 'league initials remain usable without a league logo');
assert.equal(api.storyMarks({ ...logoLeague, name: 'Équipe Montréal' }, {})[0].initials, 'ÉM');
const before = JSON.stringify({ logoLeague, currentStory }); api.logoSources(logoLeague, 1); api.storyMarks(logoLeague, currentStory);
assert.equal(JSON.stringify({ logoLeague, currentStory }), before, 'logo resolution does not mutate the story or league');
console.log('PASS Wire identity: documented owners, historical boundaries, trusted logo sources, ordered fallbacks, reused-slot safeguards and scoped story marks');
