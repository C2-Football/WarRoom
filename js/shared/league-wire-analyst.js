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
                headline = catchPoints >= tenYards ? 'The checkdown has a signing bonus' : 'There is a little extra in every catch';
                verdict = catchPoints >= tenYards ? 'Receptions carry real weight here. A short catch can earn as much from the catch itself as a useful chunk of rushing yardage; volume belongs in the roster-building conversation.' : 'This is a vote for receiving volume without making the catch worth a full ten-yard run on its own. Reliable targets get a nudge, not a blank check.';
            } else if (catchPoints === 0) {
                headline = 'The base reception rule gives no applause';
                verdict = 'Judge a reception by what comes with it. Under the base reception rule, a pile of short catches earns no automatic cushion; yards and the other scoring categories have to do the work.';
            } else {
                headline = 'Every catch comes with a cover charge';
                verdict = 'A negative reception rate is a very particular taste. If the league wants to tax catches, the rule does it; if the goal was simply to avoid PPR, zero would make that point more cleanly.';
            }
            add('receptions', 'scoring', headline, `${verdict}\n\nThe receipt: a hypothetical catch contributes ${fmt(catchPoints)} points under the reception rule. Ten rushing yards contribute ${fmt(tenYards)} under the rushing-yard rule. Any receiving yards, touchdowns or bonuses are separate.`, [], [componentScope]);
        }
        if (explicit(scoring, 'pass_td') && explicit(scoring, 'pass_int') && scoring.pass_td > 0) {
            const td = scoring.pass_td, interception = scoring.pass_int, mild = interception < 0 && td / -interception >= 3;
            const headline = interception > 0 ? 'The base interception rule pays a bonus' : interception === 0 ? 'The base interception rule sends no bill' : -interception >= td ? 'This quarterback scoring keeps the receipt' : mild ? 'The quarterback can survive a bad decision' : 'Touchdowns have to pay for the mistakes';
            const take = interception > 0 ? 'Rewarding an interception is a bold house rule. Keep it if that is the joke everyone signed up for; otherwise, this is the first scoring switch we would revisit.'
                : interception === 0 ? 'The base passing-interception rule leaves its bill unpaid. We would want a league choosing zero here to be comfortable with that leniency; other turnover categories can still impose a charge.'
                    : -interception >= td ? 'The interception penalty means business. Touchdown upside still counts, but one mistake can undo at least one passing touchdown’s credit under these two rules.'
                        : mild ? 'This is a forgiving touchdown-to-turnover trade. One passing touchdown covers at least three interceptions under these two rules, leaving room for a productive, messy afternoon.'
                            : `This is a reasonable argument for making mistakes matter. One interception takes back ${fmt(-interception / td * 100)}% of a passing touchdown’s credit under these two rules. The touchdown rate alone does not tell the quarterback story.`;
            add('quarterback-risk', 'scoring', headline, `${take}\n\nIn a hypothetical line with one passing touchdown and one interception, those two categories contribute ${fmt(td)} and ${fmt(interception)} points: ${fmt(td + interception)} combined. Passing yards and every other category sit outside this example.`, [], [componentScope]);
        }
        if (explicit(scoring, 'fgm_yds') && scoring.fgm_yds > 0 && league.roster_positions?.includes('K')) {
            const rate = scoring.fgm_yds;
            add('kicking-distance', 'scoring', 'Every yard of a made kick gets paid', `We like a distance rule that rewards the yards between the round numbers. This part of the scoring pays for each yard of a made field goal, so the gain is gradual rather than waiting for the next distance band.\n\nA hypothetical 35-yard make contributes ${fmt(35 * rate)} points from the made-field-goal yardage rule; a 55-yard make contributes ${fmt(55 * rate)}. Those extra 20 yards add ${fmt(20 * rate)} from this rule alone. Other made-kick, distance-band and bonus rules may also contribute.`, [], [componentScope]);
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
            add('superflex', 'format', 'A spare quarterback has another route into the lineup', `Superflex changes what a spare quarterback means. It is another route into the lineup, so quarterback depth deserves a seat at the roster-building meeting.\n\nThere ${qb === 1 ? 'is' : 'are'} ${qb} dedicated QB ${qb === 1 ? 'slot' : 'slots'} and ${superflex} superflex ${superflex === 1 ? 'slot' : 'slots'} per team. Across ${teams} teams, that permits up to ${teams * (qb + superflex)} quarterback starts in a week. The superflex spots can also hold RBs, WRs or TEs; those extra QB starts are a choice.`, [], [{ label: 'Lineup capacity', text: 'This counts configured slots, not available NFL starters, projected points or a requirement to use a quarterback in superflex.' }]);
        }
        if (validSlots && starters.length && (count('BN') >= starters.length || count('BN') <= starters.length / 2)) {
            const bench = count('BN'), deep = bench >= starters.length;
            const extras = ['reserve_slots', 'taxi_slots'].filter(key => explicit(settings, key) && Number.isInteger(settings[key]) && settings[key] >= 0).map(key => `${settings[key]} ${key === 'reserve_slots' ? 'reserve' : 'taxi'} slots`).join(' and ');
            add('bench', 'format', deep ? 'This bench is built for the long game' : 'This bench makes every seat a decision', `${deep ? 'A bench this deep rewards patience. There is room to hold developing players, but the temptation is to keep every project forever. Give the last roster spots a job, not a lifetime appointment.' : 'A small bench makes flexibility valuable. Every extra specialist competes with another kind of cover; a bench spot should solve a plausible problem, not just display a recognizable name.'}\n\nThe lineup calls for ${starters.length} starters and provides ${bench} bench ${bench === 1 ? 'slot' : 'slots'} per team${extras ? `, plus ${extras}` : ''}. That is roster capacity, not a count of healthy or startable players.`, [], [{ label: 'The roster blueprint', text: 'Starter and bench counts come from this season’s configured roster positions. Reserve and taxi capacity is mentioned only when explicitly supplied, and is not treated as ordinary bench space.' }]);
        }
        if (!validSlots) coverage.push('Lineup and roster-depth opinions wait for a complete, recognized roster-position setup.');

        const verified = completed(league, weeks, throughWeek, edition);
        if (explicit(settings, 'league_average_match') && settings.league_average_match === 1) {
            let rescues = 0;
            verified.forEach(entry => {
                const scores = entry.rows.map(statPoints).sort((a, b) => a - b), middle = scores.length / 2, median = (scores[Math.floor(middle)] + scores[Math.ceil(middle) - 1]) / 2;
                entry.pairs.forEach(pair => pair.forEach((row, index) => { if (statPoints(row) < statPoints(pair[1 - index]) && statPoints(row) > median) rescues++; }));
            });
            add('median', 'format', 'The median game is a useful second opinion', `Keep the personal grudge match and give the scoreboard a vote, too. A median game softens the punishment for drawing the one opponent who had an even better Sunday.\n\nThis league awards a separate result against the league median alongside the head-to-head game.${verified.length ? ` Through Week ${throughWeek}, ${rescues} head-to-head ${rescues === 1 ? 'loss came' : 'losses came'} with a score above the median${rescues ? '—and therefore a median win' : ''}.` : ' That creates two result opportunities per regular-season week.'} The two records tell different parts of the story.`, [], [{ label: 'Median scope', text: 'Median is the middle score, or the average of the middle two scores. A score strictly above it earns the win counted here; a tied score does not. The opinion does not alter league standings or seeding.' }], [...source(league, '', `${season} median setting`), ...verified.map(entry => source(league, `matchups/${entry.week}`, `${season} Week ${entry.week} results`)[0])]);
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
                add('roster-cover', 'rosters', entry.short ? `${subject(entry.rid)} has a hole in the roster blueprint` : `${subject(entry.rid)}’s ${entry.position} depth stops at the starting line`, `${entry.short ? 'Positional coverage belongs ahead of the next luxury stash. This roster does not currently list enough eligible players outside reserve and taxi to cover its dedicated slots at this position.' : 'This is a thin layer of cover. The roster has enough eligible players to fill those dedicated slots, but no extra player at the position outside reserve and taxi. A little insurance belongs on the shopping list.'}\n\n${person(entry.rid).teamName} lists ${entry.inventory} ${label} among ${entry.active} players outside reserve and taxi, against ${entry.required} required ${entry.position} ${entry.required === 1 ? 'slot' : 'slots'}. That is an inventory check; it says nothing about health, byes or who should start.`, [entry.rid], [{ label: 'Roster timing and eligibility', text: 'This is the currently loaded roster, not the roster at the end of an earlier week. Players on reserve or taxi are excluded. Every included player has a recognized recorded position. Counts describe eligibility, not player quality or availability.' }], [...source(league, 'rosters', `${season} current roster snapshot`), ...source(league, '', `${season} lineup rules`)]);
            } else if (concentrations.length) {
                concentrations.sort((a, b) => b.rank - a.rank || b.inventory - a.inventory || id(a.rid).localeCompare(id(b.rid)) || a.position.localeCompare(b.position));
                const entry = concentrations[0];
                add('roster-concentration', 'rosters', `${subject(entry.rid)} has built a ${entry.position} department`, `Depth is useful; depth with a purpose is better. We like having options, but this is enough of a positional investment to ask what each extra player is doing for the roster. Insurance, development and a possible trade are three different jobs.\n\n${person(entry.rid).teamName} carries ${entry.inventory} ${entry.position}s among ${entry.active} players outside reserve and taxi. The lineup has at most ${entry.capacity} ${entry.position}-eligible ${entry.capacity === 1 ? 'spot' : 'spots'}, including any compatible flex slots. There are more candidates than chairs; keep the ones with a reason to stay.`, [entry.rid], [{ label: 'What the count establishes', text: 'This uses the current roster snapshot and configured slot eligibility. Compatible flex spots are an upper bound, not a requirement to use this position. Recorded multi-position players can count at more than one position. This does not prove player quality, health, a feasible full lineup, trade demand or an available replacement.' }], [...source(league, 'rosters', `${season} current roster snapshot`), ...source(league, '', `${season} lineup rules`)]);
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
                add(strong ? 'understated-form' : 'flattering-record', 'form', strong ? `Do not write off ${subject(team.rid)} just yet` : `${subject(team.rid)}’s record deserves a second reading`, `${strong ? 'The record is underselling the scoring so far. This team has often posted a score that would beat most of the league, even when the actual opponent had other ideas.' : 'Enjoy the wins, but keep asking for more points. The head-to-head record is stronger than the weekly scores look against the whole league; the next opponent need not be as accommodating.'}\n\nThrough Week ${throughWeek}, ${person(team.rid).teamName} is ${record} head-to-head. In ${team.comparisons} same-week comparisons with other teams, its score finished ahead ${team.ahead} times${team.equal ? ` and level ${team.equal} ${team.equal === 1 ? 'time' : 'times'}` : ''}. That is a ${fmt(team.all * 100)}% all-play rate${team.equal ? ', counting a tie as half' : ''}.`, [team.rid], [{ label: 'A second view of form', text: `All ${verified.length} completed regular-season weeks in this edition are included. All-play compares each actual weekly score with every other team that week; it is not a played record, simulation, strength-of-roster grade or forecast. Head-to-head records here exclude median games. Historical seasons and scoring systems are not pooled.` }], verified.map(entry => source(league, `matchups/${entry.week}`, `${season} Week ${entry.week} results`)[0]));
            }
        } else coverage.push('Result-based opinions need at least three complete regular-season weeks from a head-to-head league of six or more teams.');
        const ordered = stories.slice(0, 8), key = `${league.league_id || league.id}:${season}:${throughWeek}`;
        coverage.unshift(`Opinions use the ${season} league rules${verified.length ? ` and verified results through Week ${throughWeek}` : ''}. Historical scoring eras are kept separate.`);
        return { stories: ordered, weeklyOpinion: ordered.length ? ordered[hash(key) % ordered.length] : null, coverage };
    }
    root.WrWireAnalyst = { build, sourceKey };
})(typeof window !== 'undefined' ? window : globalThis);
