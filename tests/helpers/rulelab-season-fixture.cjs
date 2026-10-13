'use strict';

// Completed public-provider season, kept separate from the pre-draft format
// fixture. The browser uses the actual Office loaders, scorer and Luck ledger.
// Recorded matchup points are intentionally wrong: a replay must rescore the
// raw starter stat lines on both sides of the comparison.
function createRuleLabSeasonFixture() {
  const user = 'readiness-fixture', ownerId = 'qa-rulelab-owner';
  const users = Array.from({ length: 10 }, (_, i) => ({
    user_id: i ? ownerId + '-' + i : ownerId,
    username: i ? 'qa_rulelab_' + i : user,
    display_name: 'Replay Owner ' + (i + 1), is_owner: i === 0,
    metadata: { team_name: 'Replay Team ' + String(i + 1).padStart(2, '0') },
  }));
  const players = {};
  for (let i = 0; i < 10; i++) for (const position of ['QB', 'WR', 'TE', 'RB']) {
    const id = 'qa-replay-' + i + '-' + position;
    players[id] = { player_id: id, first_name: 'Replay', last_name: position + ' ' + (i + 1),
      full_name: 'Replay ' + position + ' ' + (i + 1), position, fantasy_positions: [position],
      team: 'KC', age: 25, years_exp: 3, status: 'Active', active: true, sport: 'nfl' };
  }
  const makeLeague = (id, index, season = '2026') => ({
    league_id: id, name: index ? 'Replay Full PPR' : 'Replay Half PPR', owner_id: ownerId,
    season, season_type: 'regular', sport: 'nfl', status: season === '2026' ? 'pre_draft' : 'complete',
    total_rosters: 10, previous_league_id: season === '2026' ? id + '-2025' : null,
    draft_id: 'qa-draft-' + id,
    settings: { type: 2, num_teams: 10, leg: 0, playoff_week_start: 15, playoff_teams: 6, taxi_slots: 0 },
    scoring_settings: { pass_yd: 0.04, pass_td: index ? 6 : 4, pass_int: -1, pass_sack: index ? 0 : -0.25,
      rush_yd: 0.1, rush_td: 6, rec: index ? 1 : 0.5, rec_yd: 0.1, rec_td: 6 },
    roster_positions: ['QB', 'WR', 'TE', 'BN'],
  });
  const leagues = [makeLeague('qa-replay-half', 0), makeLeague('qa-replay-full', 1)];
  const history = leagues.map((row, i) => makeLeague(row.league_id + '-2025', i, '2025'));
  const roster = id => users.map((owner, i) => ({
    roster_id: i + 1, owner_id: owner.user_id, league_id: id,
    players: ['QB', 'WR', 'TE', 'RB'].map(position => 'qa-replay-' + i + '-' + position),
    starters: ['QB', 'WR', 'TE'].map(position => 'qa-replay-' + i + '-' + position),
    reserve: [], taxi: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
  }));
  const stats = {};
  for (let week = 1; week <= 18; week++) {
    const lines = stats[week] = {};
    for (let i = 0; i < 10; i++) {
      lines['qa-replay-' + i + '-QB'] = { pass_yd: 180 + i * 10, pass_td: (i + week) % 4 + 1,
        pass_int: (i + week) % 3, pass_sack: i % 4 + 1 };
      lines['qa-replay-' + i + '-WR'] = { rec: (i + week) % 10 + 1, rec_yd: 30 + i * 7, rec_td: i % 2 };
      lines['qa-replay-' + i + '-TE'] = { rec: (i * 2 + week) % 6 + 1, rec_yd: 20 + i * 5, rec_td: (i + 1) % 2 };
      lines['qa-replay-' + i + '-RB'] = { rush_yd: 50 + i * 2, rush_td: week % 2, rec: 2, rec_yd: 15 };
    }
  }
  const matchups = (id, week) => roster(id).map((row, i) => ({ ...row,
    // Rotate pairings each week while retaining exactly two sides per game.
    matchup_id: Math.floor(((i + 2 * (week % 5)) % 10) / 2) + 1,
    points: 999, starters_points: [333, 333, 333],
  }));
  // Independently sum the four offensive terms present in these stat lines.
  // This does not invoke or duplicate the real Rule Lab/Luck algorithms.
  const expectedPoints = (leagueId, proposal = {}) => {
    const league = leagues.find(row => row.league_id === leagueId);
    const scoring = { ...league.scoring_settings, ...proposal };
    const score = (line, position) => Math.round((
      (line.pass_yd || 0) * scoring.pass_yd + (line.pass_td || 0) * scoring.pass_td
      + (line.pass_int || 0) * scoring.pass_int + (line.pass_sack || 0) * scoring.pass_sack
      + (line.rec || 0) * scoring.rec + (line.rec_yd || 0) * scoring.rec_yd
      + (line.rec_td || 0) * scoring.rec_td
      + (position === 'TE' ? (line.rec || 0) * (scoring.bonus_rec_te || 0) : 0)
    ) * 10) / 10;
    const regularWeeks = Object.entries(stats).filter(([week]) => Number(week) < league.settings.playoff_week_start).map(([, rows]) => rows);
    return Object.fromEntries(users.map((_, i) => [String(i + 1), regularWeeks.reduce((sum, week) =>
      sum + ['QB', 'WR', 'TE'].reduce((subtotal, pos) => subtotal + score(week['qa-replay-' + i + '-' + pos], pos), 0), 0)]));
  };
  const reads = [];
  const fixture = url => {
    if (!/^api\.sleeper\.(?:app|com)$/.test(url.hostname)) return undefined;
    const pathname = url.pathname.replace(/^\/v1/, '');
    reads.push(pathname);
    if (pathname === '/state/nfl') return { season: '2026', league_season: '2026', season_type: 'pre', week: 0, display_week: 0 };
    if (pathname === '/players/nfl') return players;
    if (/^\/user\/[^/]+\/leagues\/nfl\//.test(pathname)) return leagues;
    if (/^\/user\/[^/]+$/.test(pathname)) return users[0];
    const raw = pathname.match(/^\/stats\/nfl\/regular\/2025\/(\d+)$/);
    if (raw) return stats[raw[1]] || {};
    if (/^\/(stats|projections)\//.test(pathname)) return {};
    if (pathname.includes('/players/nfl/trending/')) return [];
    const match = pathname.match(/^\/league\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const league = leagues.concat(history).find(row => row.league_id === match[1]);
      if (!league) return null;
      if (!match[2]) return league;
      if (match[2] === 'rosters') return roster(league.league_id);
      if (match[2] === 'users') return users;
      const weekly = match[2].match(/^matchups\/(\d+)$/);
      if (weekly) return league.season === '2025' ? matchups(league.league_id, Number(weekly[1])) : [];
      if (match[2] === 'drafts') return [{ draft_id: league.draft_id, league_id: league.league_id, season: league.season,
        status: 'pre_draft', type: 'snake', settings: { rounds: 4, teams: 10 } }];
      return [];
    }
    if (pathname.startsWith('/draft/')) return pathname.endsWith('/picks') ? [] : { draft_id: pathname.split('/')[2], status: 'pre_draft', season: '2026', type: 'snake', settings: { rounds: 4, teams: 10 } };
    return undefined;
  };
  return { fixture, expectedPoints, reads, leagues, stats, players, roster, matchups };
}
module.exports = { createRuleLabSeasonFixture };
