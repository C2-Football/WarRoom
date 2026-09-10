'use strict';
// Independent numerical regression cases for the full Stats workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = { setTimeout, clearTimeout };
const context = { window: root };
vm.createContext(context);
for (const file of ['js/shared/stat-catalog.js', 'js/shared/league-stats.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const E = root.App.LeagueStats;
const league = { scoring_settings: { pass_yd: 0.04, rec: 1, rec_yd: 0.1 }, rosters: [{ roster_id: 2, owner_id: 'u', players: ['qb', 'missing'] }], users: [{ user_id: 'u', display_name: 'Owner' }] };
const rows = E.buildRows({ league, playersData: { qb: { position: 'QB' }, missing: { position: 'RB' }, defender: { position: 'EDGE' } }, statsByPid: {
    qb: { gp: 2, pass_yd: 300, pass_att: 30, pass_cmp: 18, cmp_pct: 140, pass_ypa: 19, rush_yd: 0, rush_att: 0, bad_field: 'bad', infinite: Infinity },
    receiver: { gp: 2, rec: 5, rec_tgt: 10, rec_yd: 55, rec_ypr: 26, rush_rz_att: 0, rec_rz_tgt: 0 },
    defender: { gp: 2, idp_tkl_solo: 0, idp_tkl_ast: 0, idp_sack: 0.5 },
    TEAM_BUF: { pass_yd: 9999 },
    BUF: { gp: 2, sack: 4 },
} });
const qb = rows.find(r => r.pid === 'qb'), receiver = rows.find(r => r.pid === 'receiver');
assert.equal(E.value(qb, 'catalog:cmpPct'), 0.6, 'derive weighted season completion rate, ignoring summed provider rates');
assert.equal(E.value(qb, 'catalog:ypa', { perGame: true }), 10, 'YPA must not be divided by GP');
assert.equal(E.value(qb, 'catalog:ypc', { perGame: true }), null, 'zero attempts have no efficiency rate');
assert.equal(E.value(qb, 'raw:pass_yd', { perGame: true }), 150);
assert.equal(E.value(qb, 'gp', { perGame: true }), 2, 'GP remains a denominator, not GP/GP');
assert.equal(E.value(receiver, 'catalog:ypr', { perGame: true }), 11);
assert.equal(E.value(receiver, 'catalog:catchRate', { perGame: true }), 0.5);
assert.equal(E.value(receiver, 'catalog:rzTouches'), 0, 'known zero remains zero');
assert.equal(E.value(rows.find(r => r.pid === 'defender'), 'catalog:tackles'), 0);
assert.equal(E.value({ raw: { rec: 1 }, gp: 0 }, 'raw:rec', { perGame: true }), null);
assert.equal(E.value({ raw: { rec: 1 } }, 'raw:rec', { perGame: true }), null);
assert.equal(qb.raw.bad_field, undefined);
assert.equal(qb.raw.infinite, undefined);
assert.equal(rows.some(r => r.pid === 'TEAM_BUF'), false);
assert.equal(rows.find(r => r.pid === 'BUF').position, 'DEF');
assert.equal(rows.find(r => r.pid === 'defender').position, 'DL');
assert.equal(rows.find(r => r.pid === 'missing').fantasyPoints, null, 'missing raw stats are not zero fantasy points');
assert.equal(rows.find(r => r.pid === 'missing').rostered, true);
assert.equal(E.score({ rec: 3, rec_yd: 50, rush_td: 1, pts_ppr: 30, pts_half_ppr: 28 }, { rec: 0 }, 'WR'), 0, 'respect explicit zero and do not inject default rules or aggregate point fields');
assert.equal(E.score({ rec: 4, bonus_rec_te: 4 }, { rec: 1, bonus_rec_te: 0.5 }, 'TE'), 6, 'explicit reception bonus must not be added again via fallback');
assert.equal(E.score({ rec: 4 }, { rec: 1, bonus_rec_te: 0.5 }, 'TE'), 6);
assert.equal(E.score({ rec: 4 }, { rec: 1, bonus_rec_te: 0.5 }, 'WR'), 4);
assert.equal(E.score({ idp_sack: 0, sack: 2 }, { idp_sack: 1 }, 'LB'), 0, 'zero primary IDP alias wins');
assert.equal(E.score({ sack: 0.5 }, { idp_sack: 2 }, 'LB'), 1);
assert.equal(E.score({ pass_yd: 4500 }, { pass_yd: 0.04, bonus_pass_yd_300: 3 }, 'QB'), 180, 'never synthesize game threshold bonuses from season totals');
assert.equal(E.score({ pass_yd: 4500, bonus_pass_yd_300: 4 }, { pass_yd: 0.04, bonus_pass_yd_300: 3 }, 'QB'), 192);
assert.equal(E.score({ fum_lost: 2 }, { fum_lost: -2 }, 'RB'), -4);
assert.equal(E.score({ gp: 1 }, {}, 'QB'), null);
assert.equal(E.score({ sack: 1 }, { sack: 1, idp_sack: 4 }, 'LB'), 4, 'IDP athlete uses only individual sack rule');
assert.equal(E.score({ idp_sack: 1 }, { sack: 1, idp_sack: 4 }, 'LB'), 4, 'prefixed IDP data cannot also activate team rule');
assert.equal(E.score({ sack: 1 }, { sack: 1, idp_sack: 4 }, 'DEF'), 1, 'team defense never activates IDP rule');
assert.equal(E.score({ int: 1 }, { int: 2, idp_int: 5 }, 'DB'), 5, 'interception rule is scoped to athlete');
assert.equal(E.score({ fum_rec: 1 }, { fum_rec: 2, idp_fum_rec: 5 }, 'DEF'), 2, 'fumble recovery rule is scoped to team');
assert.equal(E.score({ rec: 1, st_tkl_solo: 1 }, { rec: 1, st_tkl_solo: 2, idp_tkl_solo: 3 }, 'WR'), 3, 'offensive special teams counts retain their distinct rule');
assert.equal(E.score({ fum_rec_td: 1 }, { fum_rec_td: 6 }, 'WR'), 6, 'offensive fumble recovery touchdowns remain offensive scoring');
console.log('PASS independent Stats review: ratios, denominators, reported zeros, scoring aliases/bonuses, scope and sanitation');
