// An opinion desk with receipts: judgments are separate from measured facts.
(function (root) {
    'use strict';
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const explicit = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key) && finite(object[key]);
    const id = value => String(value);
    const fmt = value => Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    const hash = value => { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; };
    const source = (league, suffix, label) => [{ label, url: `https://api.sleeper.app/v1/league/${encodeURIComponent(league.league_id || league.id)}${suffix ? '/' + suffix : ''}` }];
    const slots = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], DL: ['DL', 'DE', 'DT'], LB: ['LB'], DB: ['DB', 'CB', 'S'], IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'] };
    const inactiveSlots = new Set(['BN', 'IR', 'TAXI']);
    const statPoints = row => finite(row?.custom_points) ? row.custom_points : finite(row?.points) ? row.points : null;
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    function sourceKey(league, players = {}) {
        if (!league) return '';
        const rosters = (league.rosters || []).map(roster => ({ roster_id: roster.roster_id, owner_id: roster.owner_id,
            players: Array.isArray(roster.players) ? roster.players.map(id).sort() : null, reserve: Array.isArray(roster.reserve) ? roster.reserve.map(id).sort() : roster.reserve, taxi: Array.isArray(roster.taxi) ? roster.taxi.map(id).sort() : roster.taxi,
        })).sort((a, b) => id(a.roster_id).localeCompare(id(b.roster_id)));
        const owned = [...new Set(rosters.flatMap(roster => roster.players || []))].sort();
        const users = (league.users || []).map(user => ({ user_id: user.user_id, display_name: user.display_name, username: user.username, team_name: user.metadata?.team_name })).sort((a, b) => id(a.user_id).localeCompare(id(b.user_id)));
        return JSON.stringify(stable({ league_id: league.league_id || league.id, season: league.season, platform: league.platform, type: league.type, skin: league.leagueSkin?.type,
            sport: league.sport, total_rosters: league.total_rosters, scoring: league.scoring_settings, settings: league.settings, positions: Array.isArray(league.roster_positions) ? league.roster_positions.slice().sort() : null, rosters, users,
            playerPositions: owned.map(pid => ({ pid, position: players[pid]?.position, fantasy_positions: Array.isArray(players[pid]?.fantasy_positions) ? players[pid].fantasy_positions.slice().sort() : null })),
        }));
    }

    function completed(league, weeks, throughWeek, edition) {
        const start = Math.max(1, Number(league.settings?.start_week) || 1);
        const last = Math.min(18, (Number(league.settings?.playoff_week_start) || 19) - 1);
        if (throughWeek < start || throughWeek > last || edition?.completedThrough !== throughWeek) return [];
        const ids = (league.rosters || []).map(roster => id(roster.roster_id));
        if (ids.length < 4 || new Set(ids).size !== ids.length) return [];
        const verified = [];
        for (let week = start; week <= throughWeek; week++) {
            const matches = weeks.filter(entry => Number(entry?.week) === week), rows = matches[0]?.rows;
            if (matches.length !== 1 || !Array.isArray(rows) || rows.length !== ids.length || new Set(rows.map(row => id(row?.roster_id))).size !== ids.length
                || rows.some(row => !ids.includes(id(row?.roster_id)) || statPoints(row) === null || row.matchup_id == null)) return [];
            const groups = new Map();
            rows.forEach(row => { const key = id(row.matchup_id); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
            if ([...groups.values()].some(pair => pair.length !== 2)) return [];
            verified.push({ week, rows, pairs: [...groups.values()] });
        }
        return verified;
    }

    function build({ league, weeks = [], edition, throughWeek = 0, players = {}, nameFor, priorSeasons = [], rosterScope } = {}) {
        const coverage = [], stories = [];
        const empty = note => ({ stories: [], weeklyOpinion: null, coverage: [note] });
        if (!league || !(league.league_id || league.id) || !/^\d{4}$/.test(id(league.season))) return empty('A season-specific league is needed before the analyst can weigh in.');
        if (root.App?.Chopped?.isChopped?.(league) || league.type === 'chopped' || league.leagueSkin?.type === 'chopped'
            || league.sport && league.sport !== 'nfl' || league.platform && league.platform !== 'sleeper') return empty('The analyst does not yet cover this league format.');
        if (!Number.isInteger(throughWeek) || throughWeek < 0 || throughWeek > 18) return empty('Choose an edition with a verified week boundary.');
        const season = id(league.season), settings = league.settings || {}, scoring = league.scoring_settings || {}, people = new Map();
        const person = rid => {
            if (!people.has(id(rid))) {
                const identity = root.WrWireIdentity?.resolve(league, rid, { priorSeasons, teamName: nameFor?.(rid) });
                people.set(id(rid), { ...(identity || { ownerId: null, ownerName: null, ownerKnown: false, teamName: nameFor?.(rid) || `Team ${rid}` }), rosterId: rid, season });
            }
            return people.get(id(rid));
        };
        const subject = rid => person(rid).ownerName || person(rid).teamName;
        const add = (type, desk, text, body, rosterIds = [], related = [], sources = source(league, '', `${season} league rules`)) => {
            stories.push({ id: `analyst:${league.league_id || league.id}:${season}:${throughWeek}:${type}:${rosterIds.join(':')}`, kind: 'story', feature: true, analyst: true, opinion: true,
                category: 'The Analyst · opinion', featureType: `analyst-${type}`, desk, label: `${season}${throughWeek ? ' · WK ' + throughWeek : ''} · OPINION`, week: throughWeek, season,
                text, body, rosterIds, participants: rosterIds.map(person), weight: 32, sources, related: [{ label: 'The analyst’s remit', text: 'An editorial judgment of these recorded rules or results, not a league vote, player projection, or instruction to change a lineup.' }, ...related] });
        };
        const componentScope = { label: 'How the example works', text: `Illustrative contributions use only the explicitly named ${season} scoring rules. Other stats, positional premiums and bonuses can change a player’s total. This is not a complete fantasy score or a comparison across scoring eras.` };

        // These named, linear multipliers are supported by Sleeper's existing
        // calculator. Do not use that calculator's missing-setting defaults or
        // treat unmodelled bonus rules as zero in a hypothetical total.
        if (explicit(scoring, 'rec') && explicit(scoring, 'rush_yd') && scoring.rush_yd > 0) {
            const catchPoints = scoring.rec, tenYards = scoring.rush_yd * 10;
            let headline, verdict;
            if (catchPoints > 0) {
                headline = catchPoints >= tenYards ? 'A short catch can go a long way here' : 'A little extra for a busy receiver';
                verdict = catchPoints >= tenYards ? 'A reception does not have to go far to matter in this league. The catch alone earns at least as much as ten rushing yards under these rules. That is a strong reason to care about who keeps getting the ball.' : 'This reception rule gives pass catchers a useful boost, but one catch is still worth less than ten rushing yards. Target volume deserves attention without becoming the whole argument for a player.';
            } else if (catchPoints === 0) {
                headline = 'No points from the base reception rule';
                verdict = 'A busy receiving line can be less impressive than it looks here. The base reception rule pays nothing for the catch itself, so the yards, touchdowns and other scoring categories have to justify the excitement.';
            } else {
                headline = 'Losing points for a catch? Check that rule.';
                verdict = 'The reception rate is negative. That may be an intentional wrinkle, but it is worth a conversation: there is a difference between declining to reward a catch and taking points away for one. Zero would accomplish the first.';
            }
            add('receptions', 'scoring', headline, `${verdict}\n\nA catch is worth ${fmt(catchPoints)} points before receiving yards, touchdowns or bonuses; ten rushing yards are worth ${fmt(tenYards)}. That is the comparison between these two rules, not a player’s complete score.`, [], [componentScope]);
        }
        if (explicit(scoring, 'pass_td') && explicit(scoring, 'pass_int') && scoring.pass_td > 0) {
            const td = scoring.pass_td, interception = scoring.pass_int, mild = interception < 0 && td / -interception >= 3;
            const headline = interception > 0 ? 'The base interception rule rewards a pick' : interception === 0 ? 'No penalty in the base interception rule' : -interception >= td ? 'One pick can wipe out a passing touchdown' : mild ? 'There is room for a few quarterback mistakes' : -interception / td === 0.5 ? 'A pick gives back half a passing touchdown' : 'Turnovers keep the touchdown scoring in check';
            const take = interception > 0 ? `A quarterback earns ${fmt(interception)} points from the base interception rule for throwing a pick. If everyone agreed to that, enjoy the chaos. Otherwise, this is a setting worth reviewing before the next game.`
                : interception === 0 ? 'Throwing an interception costs nothing under the base interception rule. That is a forgiving choice, and the league should make it deliberately. Other turnover categories can still carry penalties.'
                    : -interception >= td ? `A pick costs ${fmt(-interception)} points; a passing touchdown earns ${fmt(td)}. One mistake wipes out at least one touchdown’s credit under these rules. Turnover risk deserves more attention than the touchdown total alone suggests.`
                        : mild ? `A passing touchdown earns ${fmt(td)} points, while an interception costs ${fmt(-interception)}. That is forgiving: one touchdown covers at least three picks under these rules. A quarterback can have an untidy afternoon and still offer plenty of scoring upside.`
                            : `A passing touchdown earns ${fmt(td)} points. A pick gives ${-interception / td === 0.5 ? 'half of it' : fmt(-interception / td * 100) + '% of it'} back. That is a meaningful penalty, even in a game with plenty of touchdowns.`;
            add('quarterback-risk', 'scoring', headline, `${take}\n\nOne ${fmt(td)}-point passing touchdown and one interception would leave ${fmt(td + interception)} points from those two rules. Passing yards and the other scoring categories are separate.`, [], [componentScope]);
        }
        if (explicit(scoring, 'fgm_yds') && scoring.fgm_yds > 0 && league.roster_positions?.includes('K')) {
            const rate = scoring.fgm_yds;
            add('kicking-distance', 'scoring', 'Kickers get credit for the extra distance', `A 35-yard field goal earns ${fmt(35 * rate)} points from the yardage rule; a 55-yarder earns ${fmt(55 * rate)}. Those extra 20 yards are worth ${fmt(20 * rate)} points before any other kicking rules.\n\nThat is a sensible way to reward distance: each yard adds something, including the ones between the usual scoring bands. Other made-kick, distance-band and bonus rules may also contribute, so these are not the complete kick totals.`, [], [componentScope]);
        }
        if (!stories.some(story => story.desk === 'scoring')) coverage.push('Scoring opinions need explicit, supported scoring rates; missing values are not treated as zero.');

        const positions = league.roster_positions;
        const validSlots = Array.isArray(positions) && positions.length > 0 && positions.every(position => slots[position] || inactiveSlots.has(position));
        const starters = validSlots ? positions.filter(position => !inactiveSlots.has(position)) : [];
        const count = position => validSlots ? positions.filter(value => value === position).length : 0;
        const teamIds = (league.rosters || []).map(roster => id(roster.roster_id));
        const teams = teamIds.length > 0 && new Set(teamIds).size === teamIds.length ? teamIds.length : explicit(league, 'total_rosters') && Number.isInteger(league.total_rosters) && league.total_rosters > 0 ? league.total_rosters : 0;
        if (validSlots && starters.length && teams && count('SUPER_FLEX')) {
            const qb = count('QB'), superflex = count('SUPER_FLEX');
            add('superflex', 'format', 'Quarterback depth matters more in superflex', `Each team has ${qb} dedicated QB ${qb === 1 ? 'slot' : 'slots'} and ${superflex} superflex ${superflex === 1 ? 'slot' : 'slots'}. Across ${teams} teams, that allows up to ${teams * (qb + superflex)} quarterback starts in a week. A spare quarterback could have a weekly role instead of waiting for a bye.\n\nThat makes quarterback depth worth protecting. It does not mean filling every superflex spot with one: RBs, WRs and TEs are eligible too, and the better option depends on the players. Those extra QB starts are a choice.`, [], [{ label: 'Lineup capacity', text: 'This counts configured slots, not available NFL starters, projected points or a requirement to use a quarterback in superflex.' }]);
        }
        if (validSlots && starters.length && (count('BN') >= starters.length || count('BN') <= starters.length / 2)) {
            const bench = count('BN'), deep = bench >= starters.length;
            const extras = ['reserve_slots', 'taxi_slots'].filter(key => explicit(settings, key) && Number.isInteger(settings[key]) && settings[key] >= 0).map(key => `${settings[key]} ${key === 'reserve_slots' ? 'reserve' : 'taxi'} slots`).join(' and ');
            add('bench', 'format', deep ? 'A deep bench leaves room to be patient' : bench === 0 ? 'No bench means every roster spot matters' : 'There is not much room for a wasted bench spot', `This league starts ${starters.length} players and allows ${bench} bench ${bench === 1 ? 'slot' : 'slots'} per team${extras ? `, plus ${extras}` : ''}. ${deep ? 'That is enough room to wait on a developing player without using the entire bench to do it.' : bench === 0 ? 'There is no ordinary bench space to hold an extra option.' : 'With that little room, holding an extra player at one position means less cover somewhere else.'}\n\n${deep ? 'The harder call is knowing when to stop waiting. A deep bench can support a long-term bet, but it should not make every stalled prospect impossible to cut.' : 'Versatility is valuable in this format. The last roster spot is worth revisiting when the roster’s needs change, even if the player occupying it has the more familiar name.'} These are roster limits, not a count of healthy players.`, [], [{ label: 'The roster blueprint', text: 'Starter and bench counts come from this season’s configured roster positions. Reserve and taxi capacity is mentioned only when explicitly supplied, and is not treated as ordinary bench space.' }]);
        }
        if (!validSlots) coverage.push('Lineup and roster-depth opinions wait for a complete, recognized roster-position setup.');

        const verified = completed(league, weeks, throughWeek, edition);
        if (explicit(settings, 'league_average_match') && settings.league_average_match === 1) {
            let rescues = 0;
            verified.forEach(entry => {
                const scores = entry.rows.map(statPoints).sort((a, b) => a - b), middle = scores.length / 2, median = (scores[Math.floor(middle)] + scores[Math.ceil(middle) - 1]) / 2;
                entry.pairs.forEach(pair => pair.forEach((row, index) => { if (statPoints(row) < statPoints(pair[1 - index]) && statPoints(row) > median) rescues++; }));
            });
            add('median', 'format', 'The case for keeping the median game', `${verified.length ? `Through Week ${throughWeek}, ${rescues} head-to-head ${rescues === 1 ? 'loss came' : 'losses came'} with a score above the league median.${rescues ? ' The median game turned each of those weeks into a split: a head-to-head loss and a median win.' : ' No losing team has needed that consolation yet.'}` : 'This league plays two games each regular-season week: one against an opponent, one against the league median.'}\n\nThat is a good compromise. The matchup still matters, but a productive week can earn something even when the opponent scores more. It takes some of the sting out of a bad draw without removing the head-to-head result.`, [], [{ label: 'Median scope', text: 'Median is the middle score, or the average of the middle two scores. A score strictly above it earns the win counted here; a tied score does not. The opinion does not alter league standings or seeding.' }], [...source(league, '', `${season} median setting`), ...verified.map(entry => source(league, `matchups/${entry.week}`, `${season} Week ${entry.week} results`)[0])]);
        }

        if (rosterScope === 'current' && validSlots && starters.length) {
            const candidates = [], concentrations = [], incomplete = [];
            for (const roster of league.rosters || []) {
                if (!Array.isArray(roster.players) || !roster.players.length || !Array.isArray(roster.reserve) && roster.reserve != null || !Array.isArray(roster.taxi) && roster.taxi != null) { incomplete.push(roster.roster_id); continue; }
                const excluded = new Set([...(roster.reserve || []), ...(roster.taxi || [])].map(id));
                const active = [...new Set(roster.players.map(id))].filter(pid => !excluded.has(pid));
                const positionSets = active.map(pid => Array.isArray(players[pid]?.fantasy_positions) && players[pid].fantasy_positions.length ? players[pid].fantasy_positions : players[pid]?.position ? [players[pid].position] : []);
                if (positionSets.some(list => !list.length || list.some(position => !Object.values(slots).flat().includes(position)))) { incomplete.push(roster.roster_id); continue; }
                for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
                    const required = count(position), inventory = positionSets.filter(list => list.includes(position)).length;
                    if (required > inventory) candidates.push({ rid: roster.roster_id, position, required, inventory, active: active.length, rank: 100 + required - inventory, short: true });
                    else if (required >= 2 && inventory === required) candidates.push({ rid: roster.roster_id, position, required, inventory, active: active.length, rank: 30 + required });
                    const capacity = starters.filter(slot => slots[slot].includes(position)).length;
                    if (capacity > 0 && ['QB', 'RB', 'WR', 'TE'].includes(position) && inventory >= 3 && inventory >= capacity * 1.5 && active.length >= starters.length + 2) concentrations.push({ rid: roster.roster_id, position, inventory, capacity, active: active.length, rank: inventory / capacity });
                }
            }
            candidates.sort((a, b) => b.rank - a.rank || id(a.rid).localeCompare(id(b.rid)) || a.position.localeCompare(b.position));
            if (candidates.length) {
                const entry = candidates[0], label = entry.position === 'DEF' ? `team defense${entry.inventory === 1 ? '' : 's'}` : `${entry.position}${entry.inventory === 1 ? '' : 's'}`;
                add('roster-cover', 'rosters', entry.short ? `${subject(entry.rid)} is short at ${entry.position}` : `${subject(entry.rid)} has little room to spare at ${entry.position}`, `${subject(entry.rid)} has ${entry.inventory} ${label} among ${entry.active} players outside reserve and taxi, with ${entry.required} required ${entry.position} ${entry.required === 1 ? 'slot' : 'slots'} to fill. ${entry.short ? 'There are not enough eligible players listed there to fill those spots.' : 'That fills the dedicated spots, but leaves no extra player at the position.'}\n\n${entry.short ? 'Addressing that shortage looks more useful than adding another speculative stash elsewhere.' : 'Another option at the position would give this roster some breathing room.'} The count alone cannot tell us who is healthy, who has a bye or who should start; it does show where the roster is thin.`, [entry.rid], [{ label: 'Roster timing and eligibility', text: 'This is the currently loaded roster, not the roster at the end of an earlier week. Players on reserve or taxi are excluded. Every included player has a recognized recorded position. Counts describe eligibility, not player quality or availability.' }], [...source(league, 'rosters', `${season} current roster snapshot`), ...source(league, '', `${season} lineup rules`)]);
            } else if (concentrations.length) {
                concentrations.sort((a, b) => b.rank - a.rank || b.inventory - a.inventory || id(a.rid).localeCompare(id(b.rid)) || a.position.localeCompare(b.position));
                const entry = concentrations[0], flexible = entry.capacity > count(entry.position);
                add('roster-concentration', 'rosters', `${entry.inventory} ${entry.position}s, ${flexible ? 'up to ' : ''}${entry.capacity} ${entry.capacity === 1 ? 'spot' : 'spots'} for ${subject(entry.rid)}`, `${subject(entry.rid)} carries ${entry.inventory} ${entry.position}s among ${entry.active} players outside reserve and taxi. There ${entry.capacity === 1 ? 'is' : 'are'} ${flexible ? 'at most ' : ''}${entry.capacity} ${entry.position}-eligible ${entry.capacity === 1 ? 'spot' : 'spots'} in the lineup${flexible ? ', including compatible flex slots' : ''}.\n\nA backup or a developing player can justify the extra depth. Keeping this many is harder to defend if another position needs help. That is a roster question worth asking, even though the count cannot tell us which player, if any, should go.`, [entry.rid], [{ label: 'What the count establishes', text: 'This uses the current roster snapshot and configured slot eligibility. Compatible flex spots are an upper bound, not a requirement to use this position. Recorded multi-position players can count at more than one position. This does not prove player quality, health, a feasible full lineup, trade demand or an available replacement.' }], [...source(league, 'rosters', `${season} current roster snapshot`), ...source(league, '', `${season} lineup rules`)]);
            }
            if (incomplete.length) coverage.push(`Roster inventory opinions skipped ${incomplete.length} ${incomplete.length === 1 ? 'team with' : 'teams with'} incomplete player or position data.`);
        } else coverage.push('Roster inventory opinions are limited to the current edition with current player-position data.');

        if (verified.length >= 3 && teams >= 6) {
            const results = new Map((league.rosters || []).map(roster => [id(roster.roster_id), { rid: roster.roster_id, wins: 0, losses: 0, ties: 0, ahead: 0, equal: 0, comparisons: 0 }]));
            verified.forEach(entry => {
                entry.pairs.forEach(pair => pair.forEach((row, index) => { const team = results.get(id(row.roster_id)), difference = statPoints(row) - statPoints(pair[1 - index]); team[difference > 0 ? 'wins' : difference < 0 ? 'losses' : 'ties']++; }));
                entry.rows.forEach(row => { const team = results.get(id(row.roster_id)); entry.rows.filter(other => id(other.roster_id) !== id(row.roster_id)).forEach(other => { team.comparisons++; if (statPoints(row) > statPoints(other)) team.ahead++; else if (statPoints(row) === statPoints(other)) team.equal++; }); });
            });
            const comparisons = [...results.values()].map(team => ({ ...team, head: (team.wins + team.ties / 2) / verified.length, all: (team.ahead + team.equal / 2) / team.comparisons }));
            const unlucky = comparisons.filter(team => team.head <= 0.5 && team.all >= 0.65 && team.all - team.head >= 0.2).sort((a, b) => (b.all - b.head) - (a.all - a.head) || id(a.rid).localeCompare(id(b.rid)))[0];
            const fortunate = comparisons.filter(team => team.head >= 2 / 3 && team.all <= 0.45 && team.head - team.all >= 0.2).sort((a, b) => (b.head - b.all) - (a.head - a.all) || id(a.rid).localeCompare(id(b.rid)))[0];
            for (const [team, strong] of [[unlucky, true], [fortunate, false]]) {
                if (!team) continue;
                const record = `${team.wins}–${team.losses}${team.ties ? '–' + team.ties : ''}`;
                add(strong ? 'understated-form' : 'flattering-record', 'form', strong ? `${subject(team.rid)} has played better than the record` : `${subject(team.rid)}’s wins are hiding a scoring concern`, `${person(team.rid).teamName} is ${record} head-to-head through Week ${throughWeek}. Compare its scores with every other team in the same weeks, though, and it finished ahead ${team.ahead} times in ${team.comparisons} comparisons${team.equal ? `, with ${team.equal} ${team.equal === 1 ? 'tie' : 'ties'}` : ''}. That works out to a ${fmt(team.all * 100)}% all-play rate${team.equal ? ', counting a tie as half' : ''}.\n\n${strong ? 'The scoring gives more reason for optimism than the record does. This team has regularly done enough to beat most of the league. That cannot recover the losses, but it is a reason to be patient.' : 'The wins count, and nobody should apologize for them. Still, the scoring has been less convincing than the record. More points would make this start look a lot more sustainable.'}`, [team.rid], [{ label: 'A second view of form', text: `All ${verified.length} completed regular-season weeks in this edition are included. All-play compares each actual weekly score with every other team that week; it is not a played record, simulation, strength-of-roster grade or forecast. Head-to-head records here exclude median games. Historical seasons and scoring systems are not pooled.` }], verified.map(entry => source(league, `matchups/${entry.week}`, `${season} Week ${entry.week} results`)[0]));
            }
        } else coverage.push('Result-based opinions need at least three complete regular-season weeks from a head-to-head league of six or more teams.');
        const ordered = stories.slice(0, 8), key = `${league.league_id || league.id}:${season}:${throughWeek}`;
        coverage.unshift(`Opinions use the ${season} league rules${verified.length ? ` and verified results through Week ${throughWeek}` : ''}. Historical scoring eras are kept separate.`);
        return { stories: ordered, weeklyOpinion: ordered.length ? ordered[hash(key) % ordered.length] : null, coverage };
    }
    root.WrWireAnalyst = { build, sourceKey };
})(typeof window !== 'undefined' ? window : globalThis);
