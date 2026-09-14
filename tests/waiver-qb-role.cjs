'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/free-agency.js', 'utf8');
const scores = { mahomes: 5000, stafford: 3000, mendoza: 10000, starter: 6000, unknown: 9000 };
const window = { App: { LI: { playerScores: scores }, PlayerValue: { getValue: pid => scores[pid] || 0 } }, WR: {}, S: {} };
const c = vm.createContext({ window, localStorage: { getItem: () => null }, console });
vm.runInContext(source.slice(0, source.indexOf('    // ── UDFA craze')), c);
const players = {
  mahomes: { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', depth_chart_order: 1 },
  stafford: { full_name: 'Matthew Stafford', position: 'QB', team: 'LA', depth_chart_order: 1 },
  mendoza: { full_name: 'Fernando Mendoza', position: 'QB', team: 'LV', depth_chart_order: 3, depth_chart_position: 'QB', age: 23 },
  starter: { full_name: 'Available Starter', position: 'QB', team: 'OTHER', depth_chart_order: 1 },
  unknown: { full_name: 'Unknown Role', position: 'QB', team: 'OTHER' },
};
const roster = { players: ['mahomes','stafford'], settings: {} };
const league = { league_id: '1356311207652360192', settings: { type: 0, max_keepers: 1, waiver_budget: 100 }, roster_positions: ['QB','BN','BN'], rosters: [roster] };
const build = type => c.buildFreeAgencyActionBoard({ currentLeague: { ...league, settings: { ...league.settings, type } }, leagueSkin: { type: type === 2 ? 'dynasty' : 'redraft' }, myRoster: roster, playersData: players });
let board = build(0);
assert(board.availablePlayers.some(p => p.pid === 'mendoza'), 'backup remains searchable');
assert(!board.priorityAdds.some(p => p.pid === 'mendoza'), 'inflated score cannot turn a backup into a redraft upgrade');
assert(!board.actionBoardPlayers.some(p => p.pid === 'unknown'), 'unknown role requires verification');
assert(board.priorityAdds.some(p => p.pid === 'starter'), 'a measured starting-QB upgrade remains possible');
assert(build(2).priorityAdds.some(p => p.pid === 'mendoza'), 'dynasty stash eligibility is preserved');
players.mendoza.depth_chart_order = 1;
assert(build(0).priorityAdds.some(p => p.pid === 'mendoza'), 'promotion changes eligibility without a name blacklist');
players.mendoza.depth_chart_order = 2;
const missingRoster = c.buildFreeAgencyActionBoard({ currentLeague: {...league, rosters: []}, leagueSkin: {type:'redraft'}, myRoster: {players:[],settings:{}}, playersData: players });
assert(!missingRoster.priorityAdds.some(p => p.pid === 'mendoza'), 'a backup does not cover an empty QB starting slot');
assert.equal(c.matchWaiverRecommendations([{name:'Fernando Mendoza',reason:'Add him'}, {name:'Available Starter',reason:'Upgrade'}, {name:'Available Starter',reason:'Duplicate'}], [{name:'Available Starter'}]).length, 1);
console.log('PASS backup/unknown QB exclusion, available-pool retention, promotion, dynasty stashes, empty slots, and AI candidate validation');
