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
console.log('PASS Wire identity: league-scoped documented owners, account fallbacks, separate team names, replacements, former managers, source evidence and ambiguous-history guards');
