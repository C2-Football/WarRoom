'use strict';

// Synthetic provider responses for a stable pre-draft format contract. Real
// leagues change phase and rosters over time; they cannot prove this state.
function createLeagueSkinFixture({ redraftId, dynastyId, user }) {
  const ownerId = 'qa-format-owner';
  const league = (id, type) => ({
    league_id: id, name: type ? 'QA Dynasty With IDP' : 'QA Empty Redraft',
    season: '2026', season_type: 'regular', sport: 'nfl', status: 'pre_draft',
    total_rosters: 6, previous_league_id: null, draft_id: 'qa-draft-' + id,
    settings: { type, num_teams: 6, leg: 0, playoff_week_start: 15, taxi_slots: type ? 3 : 0 },
    scoring_settings: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, ...(type ? { idp_tkl: 1 } : {}) },
    roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', ...(type ? ['DL', 'LB', 'DB'] : [])],
  });
  const leagues = [league(redraftId, 0), league(dynastyId, 2)];
  const users = Array.from({ length: 6 }, (_, index) => ({
    user_id: index ? 'qa-format-owner-' + index : ownerId,
    username: index ? 'qa_owner_' + index : user, display_name: 'QA Owner ' + (index + 1),
    metadata: { team_name: 'QA Team ' + (index + 1) },
  }));
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  const players = Object.fromEntries(Array.from({ length: 90 }, (_, index) => {
    const id = 'qa-player-' + index, position = positions[index % positions.length];
    return [id, { player_id: id, first_name: 'QA', last_name: 'Player ' + index,
      full_name: 'QA Player ' + index, position, fantasy_positions: [position],
      team: 'KC', age: 25, years_exp: 3, status: 'Active', active: true, sport: 'nfl' }];
  }));
  const roster = id => users.map((owner, index) => ({
    roster_id: index + 1, owner_id: owner.user_id, league_id: id,
    players: id === redraftId ? [] : Object.keys(players).slice(index * 9, index * 9 + 9),
    starters: id === redraftId ? [] : Object.keys(players).slice(index * 9, index * 9 + 9),
    reserve: [], taxi: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
  }));
  return url => {
    if (!/^api\.sleeper\.(?:app|com)$/.test(url.hostname)) return undefined;
    const pathname = url.pathname.replace(/^\/v1/, '');
    if (pathname === '/state/nfl') return { season: '2026', league_season: '2026', season_type: 'pre', week: 0, display_week: 0 };
    if (pathname === '/players/nfl') return players;
    if (/^\/user\/[^/]+\/leagues\/nfl\//.test(pathname)) return leagues;
    if (/^\/user\/[^/]+$/.test(pathname)) return users[0];
    if (/^\/(stats|projections)\//.test(pathname)) return {};
    if (pathname.includes('/players/nfl/trending/')) return [];
    const match = pathname.match(/^\/league\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const current = leagues.find(item => item.league_id === match[1]);
      if (!current) return null;
      if (!match[2]) return current;
      if (match[2] === 'rosters') return roster(current.league_id);
      if (match[2] === 'users') return users;
      if (match[2] === 'drafts') return [{ draft_id: current.draft_id, league_id: current.league_id, season: '2026', status: 'pre_draft', type: 'snake', settings: { rounds: 3, teams: 6 } }];
      return [];
    }
    if (pathname.startsWith('/draft/')) return pathname.endsWith('/picks') ? [] : { draft_id: pathname.split('/')[2], status: 'pre_draft', season: '2026', type: 'snake', settings: { rounds: 3, teams: 6 } };
    return undefined;
  };
}
module.exports = { createLeagueSkinFixture };
