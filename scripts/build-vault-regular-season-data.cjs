#!/usr/bin/env node
'use strict';
/**
 * Rebuild the full REG archive without changing the legacy 14-week archive.
 * Uses locally cached nflverse releases and the already-downloaded historical
 * corpus; does not fetch data or write to the source directories.
 *
 * node scripts/build-vault-regular-season-data.cjs --nflverse-cache DIR \
 *   --profiles FILE --historical-games FILE.json[.zip]
 *
 * The historical corpus lacks fumbles and two-point conversions. Its complete
 * team schedules, rather than a player's appearance count, separate postseason
 * games. Same-name identities select one source career, with exclusions recorded
 * in the manifest. NFL GP is never inferred from a box-score row count.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
global.App = {};
for (const module of ['roster', 'draft-room', 'season']) require(path.join(root, 'js/shared/time-league-' + module + '.js'));
const { TimeLeagueRoster: Roster, TimeLeagueDraftRoom: Draft, TimeLeagueSeason: Season } = global.App;
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const cache = option('--nflverse-cache'), profilesPath = option('--profiles'), gamesPath = option('--historical-games');
if (!cache || !profilesPath || !gamesPath) throw new Error('Provide --nflverse-cache, --profiles, and --historical-games.');
const out = path.resolve(option('--output') || path.join(root, 'data/time-league'));
const from = Number(option('--from') || 1999), to = Number(option('--to') || 2025);
const sourceRoot = path.join(root, 'data/time-league');
const reference = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };
const core = ['passYd', 'passTd', 'passInt', 'rushYd', 'rushTd', 'rec', 'recYd', 'recTd', 'fumblesLost', 'twoPointConversions'];
const headers = ['pass_yds', 'pass_tds', 'interceptions', 'rush_yds', 'rush_tds', 'receptions', 'rec_yds', 'rec_tds', 'fumbles_lost', 'two_pt'];
const extraColumns = [
    ['fgm', 'fgm'], ['fgmiss', 'fgmiss'], ['xpm', 'xpm'], ['xpmiss', 'xpmiss'],
    ...['0_19', '20_29', '30_39', '40_49', '50p'].flatMap(band => [[`fgm_${band}`, `fgm_${band}`], [`fgmiss_${band}`, `fgmiss_${band}`]]),
    ['def_sack', 'sack'], ['def_int', 'int'], ['def_ff', 'ff'], ['def_fr', 'fr'], ['def_td', 'def_td'], ['def_st_td', 'def_st_td'], ['def_safe', 'safe'],
];
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = value => Math.round(value * 100) / 100;
const teamName = value => value === 'JAC' ? 'JAX' : String(value || '').trim().toUpperCase();
const expectedGames = year => year === 1982 ? 9 : year === 1987 ? 15 : year < 1978 ? 14 : year < 2021 ? 16 : 17;
const identityOf = (name, position) => Draft.canonicalPlayerIdentity({ name: name.replace(/[*+]/g, '').trim(), position });
const points = row => Season.scoreStatLine({ ...row.stats, extra: row.extra }, reference, Season.REFERENCE_EXTENDED_SCORING);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const csvCell = value => /[",\r\n]/.test(String(value ?? '')) ? '"' + String(value).replaceAll('"', '""') + '"' : String(value ?? '');
function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
        else if (c === '"') quoted = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
        else cell += c;
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows;
}
async function streamObjects(file, each) {
    const child = file.endsWith('.zip') ? spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] }) : null;
    const stream = child ? child.stdout : fs.createReadStream(file);
    const exit = child ? new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))); }) : Promise.resolve();
    stream.setEncoding('utf8');
    let carry = '', count = 0;
    const digest = crypto.createHash('sha256');
    // Every source record is flat. The scanner still respects quoted strings
    // and escapes, so a literal brace inside a value cannot split a record.
    let start = -1, quoted = false, escaped = false, depth = 0;
    for await (const chunk of stream) {
        digest.update(chunk);
        const offset = carry.length; carry += chunk;
        let consumed = 0;
        for (let i = offset; i < carry.length; i++) {
            const c = carry[i];
            if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
            if (c === '"') quoted = true;
            else if (c === '{') { if (!depth) start = i; depth++; }
            else if (c === '}' && --depth === 0) { each(JSON.parse(carry.slice(start, i + 1))); count++; consumed = i + 1; start = -1; }
        }
        if (consumed) { carry = carry.slice(consumed); if (start >= 0) start -= consumed; }
    }
    await exit;
    if (depth || quoted) throw new Error('Incomplete historical JSON.');
    return { count, sha256: digest.digest('hex') };
}
const legacyPath = fs.existsSync(path.join(sourceRoot, 'legacy-player-cards.json')) ? path.join(sourceRoot, 'legacy-player-cards.json') : path.join(sourceRoot, 'player-cards.json');
const legacyBytes = fs.readFileSync(legacyPath);
const legacy = JSON.parse(legacyBytes);
const supported = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const originals = new Map(legacy.players.filter(card => supported.has(card.position)).map(card => [card.identity, card]));
const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
const profileIndex = new Map(profiles.flatMap(profile => {
    const position = Roster.normalizePlayerPosition(profile.position);
    if (!supported.has(position) || !profile.name) return [];
    const identity = identityOf(profile.name, position);
    return originals.has(identity) ? [[String(profile.player_id), { ...profile, position, identity }]] : [];
}));
const allProfileNames = new Map(profiles.filter(profile => profile.name).map(profile => [String(profile.player_id), profile.name]));
const historicalTeamLookup = new Map();
const matchupKey = (name, season, teams) => [identityOf(name, 'QB'), season, ...teams.map(signatureTeam).sort()].join('|');
const signatures = new Map();
// The two archives use different abbreviations for the same franchises. This
// normalization is only for cross-source identity matching, not saved metadata.
const signatureTeam = value => ({ RAI: 'OAK', RAM: 'STL', SDG: 'SD', KAN: 'KC', TAM: 'TB',
    GNB: 'GB', NWE: 'NE', SFO: 'SF', NOR: 'NO', JAC: 'JAX', LAR: 'STL', LA: 'STL',
    LAC: 'SD', LVR: 'OAK', LV: 'OAK' }[value] || value);
const signature = row => [row.identity, row.season, signatureTeam(row.team), signatureTeam(row.opponent), ...core.slice(0, 8).map(key => row.stats[key]), row.extra?.fgm || 0, row.extra?.xpm || 0].join('|');
const teamDates = new Map(), historical = [], modern = [], sourceInputs = [];
let correctedOpponentRows = 0;
let correctedTeamRows = 0;
const incompleteTeamSeasons = new Map(), unresolvedTeamRows = [], uncertainPlayerSeasons = new Map();
const collisionLinks = new Map();
const profileAppearances = new Map();
function addSignature(row, profileId) {
    if (!core.slice(0, 8).some(key => row.stats[key]) && !row.extra?.fgm && !row.extra?.xpm) return;
    const key = signature(row), ids = signatures.get(key) || new Set(); ids.add(profileId); signatures.set(key, ids);
}
function historicalStats(game) {
    return { passYd: num(game.passing_yards), passTd: num(game.passing_touchdowns), passInt: num(game.passing_interceptions),
        rushYd: num(game.rushing_yards), rushTd: num(game.rushing_touchdowns), rec: num(game.receiving_receptions),
        recYd: num(game.receiving_yards), recTd: num(game.receiving_touchdowns), fumblesLost: 0, twoPointConversions: 0 };
}
async function main() {
    const { count: rawCount, sha256: historicalJsonSha256 } = await streamObjects(gamesPath, game => {
        const season = num(game.year), date = game.date, team = teamName(game.team), opponent = teamName(game.opponent);
        if (season < 1970 || season > 2017 || !date || !team || !opponent) return;
        const calendarKey = `${season}:${team}`, calendar = teamDates.get(calendarKey) || new Map();
        calendar.set(date, opponent); teamDates.set(calendarKey, calendar);
        if ((season === 2001 || season === 2002) && [team, opponent].some(value => signatureTeam(value) === 'JAX')) {
            const name = allProfileNames.get(String(game.player_id));
            if (name) {
                const key = matchupKey(name, season, [team, opponent]), candidates = historicalTeamLookup.get(key) || new Set();
                candidates.add(signatureTeam(team)); historicalTeamLookup.set(key, candidates);
            }
        }
        const profile = profileIndex.get(String(game.player_id));
        if (!profile) return;
        const row = { identity: profile.identity, name: originals.get(profile.identity).name, position: profile.position,
            sourcePlayerId: `pfr:${profile.player_id}`, season, date, team, opponent, stats: historicalStats(game),
            extra: profile.position === 'K' ? { fgm: num(game.field_goal_makes), xpm: num(game.point_after_makes) } : undefined };
        if (season >= 1999) {
            addSignature(row, String(profile.player_id));
            const appearances = profileAppearances.get(String(profile.player_id)) || new Set();
            appearances.add(`${season}:${signatureTeam(team)}`); profileAppearances.set(String(profile.player_id), appearances);
        }
        else if (['QB', 'RB', 'WR', 'TE'].includes(profile.position)) historical.push(row);
    });
    console.log(`Historical source: ${rawCount.toLocaleString()} records, ${historical.length.toLocaleString()} candidate skill-position lines.`);
    const regularDates = new Map(), calendarShortages = [];
    for (const [key, calendar] of teamDates) {
        const year = Number(key.split(':')[0]), expected = expectedGames(year);
        const dates = [...calendar.keys()].sort().slice(0, expected);
        if (year < 1999 && dates.length < expected) calendarShortages.push({ teamSeason: key, recorded: dates.length, expected });
        regularDates.set(key, dates);
    }
    if (calendarShortages.length) throw new Error('Historical team schedules are incomplete: ' + JSON.stringify(calendarShortages));
    const keptHistorical = historical.filter(row => regularDates.get(`${row.season}:${row.team}`)?.includes(row.date));
    for (const row of keptHistorical) {
        row.week = regularDates.get(`${row.season}:${row.team}`).indexOf(row.date) + 1;
        row.scheduledGames = expectedGames(row.season);
        row.sourceGameId = `${row.season}_${row.date}_${[row.team, row.opponent].sort().join('_')}`;
        row.historicalWeek = row.week;
        row.source = 'pfr-legacy-corpus'; row.coverage = 'regular-season-missing-stats'; row.sourceWeekKind = 'player-game-ordinal';
    }
    for (let season = from; season <= to; season++) {
        const filename = `stats_player_week_${season}.csv`, bytes = fs.readFileSync(path.join(cache, filename));
        sourceInputs.push({ file: filename, sha256: hash(bytes) });
        const csv = parseCsv(bytes.toString('utf8')), columns = csv.shift(), at = Object.fromEntries(columns.map((name, index) => [name, index]));
        for (const key of ['season_type', 'week', 'player_id', 'player_display_name', 'position', 'team', 'opponent_team', 'game_id']) if (!(key in at)) throw new Error(`${filename}: missing ${key}`);
        const defense = new Map(), schedules = new Map();
        const seasonRows = [];
        for (const values of csv) {
            const value = key => values[at[key]] ?? '', n = key => num(value(key));
            if (value('season_type') !== 'REG') continue;
            let team = teamName(value('team'));
            const week = n('week'), sourceGameId = value('game_id');
            if (!team || !week || !sourceGameId) continue;
            // Some cached opponent_team values incorrectly contain the player's
            // own franchise after a relocation. The source game ID contains the
            // actual home/away team pair and survives those abbreviation errors.
            const gameTeams = sourceGameId.split('_').slice(2).map(teamName);
            const name = value('player_display_name') || value('player_name');
            let teamUnverified = false;
            if ((season === 2001 || season === 2002) && gameTeams.includes('JAX')) {
                const candidates = historicalTeamLookup.get(matchupKey(name, season, gameTeams));
                if (candidates?.size === 1) {
                    const historicalTeam = [...candidates][0], corrected = gameTeams.find(candidate => signatureTeam(candidate) === historicalTeam);
                    if (corrected && signatureTeam(team) !== historicalTeam) { team = corrected; correctedTeamRows++; }
                } else {
                    teamUnverified = true;
                    unresolvedTeamRows.push({ season, sourceGameId, name, sourcePlayerId: value('player_id') });
                    const identity = name ? identityOf(name, value('position')) : '';
                    if (originals.has(identity)) uncertainPlayerSeasons.set(`${identity}:${season}`, { identity, season, team, reason: 'Source player/team attribution could not be verified in a known affected JAX game.' });
                }
            }
            const ownSide = gameTeams.findIndex(candidate => signatureTeam(candidate) === signatureTeam(team));
            if (gameTeams.length !== 2 || ownSide < 0) throw new Error(`${filename}: inconsistent game/team ${sourceGameId}/${team}`);
            const opponent = gameTeams[1 - ownSide];
            if (signatureTeam(opponent) !== signatureTeam(teamName(value('opponent_team')))) correctedOpponentRows++;
            const schedule = schedules.get(team) || new Set(); schedule.add(sourceGameId); schedules.set(team, schedule);
            const positionLabel = value('position');
            const position = Roster.normalizePlayerPosition(positionLabel) || positionLabel;
            const identity = name ? identityOf(name, position) : '';
            const rawPosition = Roster.normalizePlayerPosition(position);
            const defensive = ['DL', 'LB', 'DB'].includes(rawPosition) || positionLabel === 'SAF';
            const unit = defense.get(`${team}:${week}`) || { identity: identityOf(`${team} Defense`, 'DEF'), name: `${team} Defense`, position: 'DEF',
                sourcePlayerId: `nflverse:team:${team}`, season, week, team, opponent, sourceGameId, stats: Season.emptyStatLine(), extra: {} };
            const defenseStats = { sack: n('def_sacks'), int: n('def_interceptions'), ff: n('def_fumbles_forced'), fr: n('fumble_recovery_opp'),
                def_td: n('def_tds') + (defensive ? n('fumble_recovery_tds') : 0), def_st_td: n('special_teams_tds'), safe: n('def_safeties') };
            if (teamUnverified && Object.values(defenseStats).some(number => number !== 0)) {
                for (const candidate of gameTeams) {
                    const identity = identityOf(`${candidate} Defense`, 'DEF');
                    uncertainPlayerSeasons.set(`${identity}:${season}`, { identity, season, team: candidate, reason: 'A defensive contribution has unresolved team attribution in a known affected JAX game.' });
                }
            }
            for (const [key, number] of Object.entries(defenseStats)) unit.extra[key] = round((unit.extra[key] || 0) + number);
            defense.set(`${team}:${week}`, unit);
            if (!originals.has(identity) || !supported.has(position) || position === 'DEF') continue;
            const row = { identity, name: originals.get(identity).name, position, sourcePlayerId: `nflverse:${value('player_id')}`, season, week, team, opponent, sourceGameId,
                stats: { passYd: n('passing_yards'), passTd: n('passing_tds'), passInt: n('passing_interceptions'), rushYd: n('rushing_yards'),
                    rushTd: n('rushing_tds'), rec: n('receptions'), recYd: n('receiving_yards'), recTd: n('receiving_tds'),
                    fumblesLost: 'fumbles_lost_total' in at ? n('fumbles_lost_total') : n('sack_fumbles_lost') + n('rushing_fumbles_lost') + n('receiving_fumbles_lost'),
                    twoPointConversions: n('passing_2pt_conversions') + n('rushing_2pt_conversions') + n('receiving_2pt_conversions') } };
            if (position === 'K') {
                row.stats = Season.emptyStatLine();
                row.extra = { fgm: n('fg_made'), fgmiss: Math.max(0, n('fg_att') - n('fg_made')), xpm: n('pat_made'), xpmiss: Math.max(0, n('pat_att') - n('pat_made')) };
                for (const band of ['0_19', '20_29', '30_39', '40_49']) { row.extra[`fgm_${band}`] = n(`fg_made_${band}`); row.extra[`fgmiss_${band}`] = n(`fg_missed_${band}`); }
                row.extra.fgm_50p = n('fg_made_50_59') + n('fg_made_60_'); row.extra.fgmiss_50p = n('fg_missed_50_59') + n('fg_missed_60_');
            }
            const matches = signatures.get(signature(row));
            if (matches?.size === 1) {
                const profileId = [...matches][0], votes = collisionLinks.get(row.sourcePlayerId) || new Map();
                votes.set(profileId, (votes.get(profileId) || 0) + 1); collisionLinks.set(row.sourcePlayerId, votes);
            }
            seasonRows.push(row);
        }
        for (const [team, schedule] of schedules) {
            if (season < 2021 && schedule.size !== 16) incompleteTeamSeasons.set(`${season}:${team}`, `Source records cover ${schedule.size} of 16 regular-season team games.`);
        }
        for (const row of [...seasonRows, ...defense.values()].filter(row => originals.has(row.identity))) {
            row.scheduledGames = schedules.get(row.team).size;
            row.source = 'nflverse'; row.coverage = 'recorded-regular-season'; row.sourceWeekKind = 'nfl-week'; modern.push(row);
        }
        console.log(`${season}: ${seasonRows.length.toLocaleString()} player logs, ${defense.size} team defenses.`);
    }
    const linkedProfile = new Map([...collisionLinks].flatMap(([id, votes]) => {
        const candidates = [...votes].sort((a, b) => b[1] - a[1]);
        return candidates[0][1] >= 2 && (!candidates[1] || candidates[0][1] > candidates[1][1] * 2) ? [[id, candidates[0][0]]] : [];
    }));
    // A final season can contain only one nonzero game, or only zero-stat
    // appearances. Link those only when both archives have exactly one career
    // with this name/position and their recorded season/team actually overlaps.
    // Never join unrelated namesakes simply because their years do not overlap.
    const modernCareers = new Map(), profilesByIdentity = new Map(), sparseCareerLinks = [];
    for (const row of modern) {
        const ids = modernCareers.get(row.identity) || new Set(); ids.add(row.sourcePlayerId); modernCareers.set(row.identity, ids);
    }
    for (const [id, profile] of profileIndex) {
        const ids = profilesByIdentity.get(profile.identity) || []; ids.push(id); profilesByIdentity.set(profile.identity, ids);
    }
    for (const row of modern) {
        if (linkedProfile.has(row.sourcePlayerId) || modernCareers.get(row.identity).size !== 1) continue;
        const ids = profilesByIdentity.get(row.identity);
        if (ids?.length !== 1 || !profileAppearances.get(ids[0])?.has(`${row.season}:${signatureTeam(row.team)}`)) continue;
        linkedProfile.set(row.sourcePlayerId, ids[0]);
        sparseCareerLinks.push({ identity: row.identity, sourcePlayerId: row.sourcePlayerId, profileId: `pfr:${ids[0]}`, matchedSeason: row.season, matchedTeam: row.team });
    }
    const groupOf = row => row.sourcePlayerId.startsWith('pfr:') ? row.sourcePlayerId : linkedProfile.has(row.sourcePlayerId) ? `pfr:${linkedProfile.get(row.sourcePlayerId)}` : row.sourcePlayerId;
    const candidateTotals = new Map();
    for (const row of [...keptHistorical, ...modern]) {
        const groups = candidateTotals.get(row.identity) || new Map(), group = groupOf(row);
        groups.set(group, (groups.get(group) || 0) + points(row)); candidateTotals.set(row.identity, groups);
    }
    const selected = new Map(), collisions = [];
    for (const [identity, groups] of candidateTotals) {
        const ranked = [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        selected.set(identity, ranked[0][0]);
        if (ranked.length > 1) collisions.push({ identity, selectedSourceCareer: ranked[0][0], excludedSourceCareers: ranked.slice(1).map(([sourcePlayerId, total]) => ({ sourcePlayerId, referencePoints: round(total) })) });
    }
    const selectedRows = [...keptHistorical, ...modern].filter(row => groupOf(row) === selected.get(row.identity));
    const excludedSeasons = new Map(uncertainPlayerSeasons);
    for (const row of selectedRows) {
        const reason = incompleteTeamSeasons.get(`${row.season}:${row.team}`);
        if (reason) excludedSeasons.set(`${row.identity}:${row.season}`, { identity: row.identity, season: row.season, team: row.team, reason });
    }
    const rawRows = selectedRows.filter(row => !excludedSeasons.has(`${row.identity}:${row.season}`));
    // Duplicate source lines do not add phantom games or double the box score.
    const byGame = new Map(), quarantined = new Map();
    for (const row of rawRows) {
        const key = `${row.identity}:${row.season}:${row.sourceGameId}`;
        if (byGame.has(key)) {
            const previous = byGame.get(key);
            if (previous.team !== row.team || JSON.stringify(previous.stats) !== JSON.stringify(row.stats) || JSON.stringify(previous.extra) !== JSON.stringify(row.extra)) {
                const conflicts = quarantined.get(row.identity) || [];
                conflicts.push({ season: row.season, sourceGameId: row.sourceGameId, sourcePlayerId: row.sourcePlayerId, teams: [previous.team, row.team] });
                quarantined.set(row.identity, conflicts);
            }
        } else byGame.set(key, row);
    }
    const rows = [...byGame.values()].filter(row => !quarantined.has(row.identity));
    const historicalOrdinals = new Map();
    for (const row of rows.filter(row => row.source === 'pfr-legacy-corpus').sort((a, b) => a.date.localeCompare(b.date))) {
        const key = `${row.identity}:${row.season}`, ordinal = (historicalOrdinals.get(key) || 0) + 1;
        row.week = ordinal; historicalOrdinals.set(key, ordinal);
    }
    rows.sort((a, b) => a.season - b.season || a.week - b.week || a.name.localeCompare(b.name));
    const byWeek = new Set();
    for (const row of rows) {
        const key = `${row.identity}:${row.season}:${row.week}`;
        if (byWeek.has(key)) throw new Error(`Two distinct source games share a week key: ${key}`);
        byWeek.add(key);
    }
    const csvHeader = ['player', 'position', 'season', 'week', ...headers, ...extraColumns.map(([header]) => header),
        'source_game_id', 'team', 'opponent', 'game_date', 'scheduled_games', 'historical_week'];
    const csv = [csvHeader.join(','), ...rows.map(row => [row.name, row.position, row.season, row.week, ...core.map(key => row.stats[key] || ''),
        ...extraColumns.map(([, id]) => row.extra?.[id] || ''), row.sourceGameId, row.team, row.opponent, row.date || '',
        row.scheduledGames, row.historicalWeek || row.week].map(csvCell).join(','))].join('\n') + '\n';
    const cards = new Map(), cells = new Map(), pooled = new Map();
    for (const row of rows) {
        const player = cards.get(row.identity) || { identity: row.identity, name: row.name, position: row.position, seasons: new Map() };
        const season = player.seasons.get(row.season) || { season: row.season, games: 0, ...Object.fromEntries(core.map(key => [key, 0])), points: 0,
            recordedGames: 0, scheduledGames: row.scheduledGames, sourceWeeks: [], source: row.source, coverage: row.coverage, sourceWeekKind: row.sourceWeekKind,
            sourcePlayerId: row.sourcePlayerId, teams: [] };
        season.games++; season.recordedGames++; season.sourceWeeks.push(row.week);
        season.scheduledGames = Math.max(season.scheduledGames, row.scheduledGames, season.recordedGames);
        if (!season.teams.includes(row.team)) season.teams.push(row.team);
        for (const key of core) season[key] = round(season[key] + row.stats[key]);
        const score = points(row); season.points = round(season.points + score);
        if (row.extra) { season.extra ||= {}; for (const [key, value] of Object.entries(row.extra)) if (value) season.extra[key] = round((season.extra[key] || 0) + value); }
        player.seasons.set(row.season, season); cards.set(row.identity, player);
        for (const [map, key] of [[cells, `${row.season}:${row.position}`], [pooled, row.position]]) {
            const cell = map.get(key) || { total: 0, games: 0 }; cell.total += score; cell.games++; map.set(key, cell);
        }
    }
    const bioKeys = { college: 'college', height: 'height', weight: 'weight', birthDate: 'birth_date', draftTeam: 'draft_team', draftYear: 'draft_year', hofYear: 'hof_induction_year' };
    const excluded = new Set(collisions.map(row => row.identity));
    const players = [...cards.values()].map(player => {
        const sourceCareer = selected.get(player.identity), profileId = sourceCareer.startsWith('pfr:') ? sourceCareer.slice(4) : linkedProfile.get(sourceCareer);
        const profile = profileIndex.get(profileId), original = originals.get(player.identity);
        const bio = profile ? Object.fromEntries(Object.entries(bioKeys).filter(([, key]) => profile[key] != null && String(profile[key]).trim()).map(([key, source]) => [key, String(profile[source])]))
            : excluded.has(player.identity) ? undefined : original.bio;
        const seasons = [...player.seasons.values()].sort((a, b) => a.season - b.season);
        return { identity: player.identity, name: player.name, position: player.position, seasons, peak: Math.max(...seasons.map(season => season.points)), ...(bio && Object.keys(bio).length ? { bio } : {}) };
    }).sort((a, b) => b.peak - a.peak || a.identity.localeCompare(b.identity));
    const factors = Object.fromEntries([...cells].sort().map(([key, cell]) => {
        const pool = pooled.get(key.split(':')[1]);
        return [key, cell.games < 20 || cell.total <= 0 ? 1 : Math.min(1.6, Math.max(0.6, (pool.total / pool.games) / (cell.total / cell.games)))];
    }));
    const counts = Object.fromEntries([...supported].map(position => [position, { players: players.filter(player => player.position === position).length, rows: rows.filter(row => row.position === position).length }]));
    const manifest = { version: 1, dataset: 'full-regular-season', generatedBy: 'scripts/build-vault-regular-season-data.cjs', seasons: { from: 1970, to },
        players: players.length, playerSeasons: players.reduce((sum, player) => sum + player.seasons.length, 0), logRows: rows.length, positions: counts,
        historical: { source: 'Existing zynicide/nfl-football-player-stats corpus', profiles: path.basename(profilesPath), games: path.basename(gamesPath), records: rawCount,
            profilesSha256: hash(fs.readFileSync(profilesPath)), gamesJsonSha256: historicalJsonSha256,
            teamSeasons: [...regularDates.keys()].filter(key => Number(key.split(':')[0]) < 1999).length, playoffRowsExcluded: historical.length - keptHistorical.length,
            regularSeasonMethod: 'First scheduled team dates for the actual season length; never the first N player appearances.',
            coverage: 'REG dates validated against complete team schedules in the corpus; fumbles and two-point conversions unavailable; source week is player-game ordinal with team-game ordinal retained separately.' },
        modern: { source: 'https://github.com/nflverse/nflverse-data/releases/tag/stats_player', license: 'CC-BY-4.0', files: sourceInputs,
            correctedOpponentRows, opponentMethod: 'Other team in source game_id; avoids renamed-franchise errors in cached opponent_team.',
            correctedTeamRows, teamCorrectionMethod: '2001/2002 JAX game attribution corroborated by unique historical player/team/game matchup; unresolved affected team-seasons excluded.',
            coverage: 'All available REG box-score rows for included source careers. Games means recorded games, not an independent NFL participation count.' },
        limitations: ['The archive retains the existing draftable identity pool; it is not every NFL player.',
            'Historical skill-position fumbles and two-point conversions were absent from the original corpus.',
            'K and DEF coverage begins in 1999. DEF omits points/yards allowed and blocked kicks, which this source cannot attribute.',
            'No-game slots mean no recorded scoring line. They are not a claim of a bye or an official DNP.',
            'Known incomplete team-seasons and unresolved source attribution are excluded from the new draw pool; exact exclusions appear below.',
            'Same-name identities use one dominant source career across seasons; excluded namesakes are listed below.'],
        identityResolution: collisions,
        sparseCareerLinks,
        incompleteTeamSeasons: [...incompleteTeamSeasons].map(([teamSeason, reason]) => ({ teamSeason, reason })),
        excludedPlayerSeasons: [...excludedSeasons.values()],
        unresolvedTeamRows,
        quarantinedCareers: [...quarantined].map(([identity, conflicts]) => ({ identity, reason: 'Conflicting source records assign one player to both teams or incompatible box scores in the same game.', conflicts })),
        missingLegacyIdentities: [...originals.keys()].filter(identity => !cards.has(identity)),
        legacy: { playerCardsSha256: hash(legacyBytes), logsSha256: hash(fs.readFileSync(path.join(sourceRoot, 'nflverse-game-logs.csv'))), eraFactorsSha256: hash(fs.readFileSync(path.join(sourceRoot, 'era-factors.json'))) },
        outputs: { gameLogsSha256: hash(csv) } };
    fs.mkdirSync(out, { recursive: true });
    if (!fs.existsSync(path.join(out, 'legacy-player-cards.json'))) fs.writeFileSync(path.join(out, 'legacy-player-cards.json'), legacyBytes);
    fs.writeFileSync(path.join(out, 'regular-season-game-logs.csv'), csv);
    fs.writeFileSync(path.join(out, 'player-cards.json'), JSON.stringify({ datasetVersion: 1, coverage: 'recorded-regular-season', players }) + '\n');
    fs.writeFileSync(path.join(out, 'regular-season-era-factors.json'), JSON.stringify({ basis: 'Half-PPR reference, actual full REG recorded games; extended reference for K/DEF', computedOver: `${rows.length} full regular-season game lines`, factors }, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'regular-season-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ players: manifest.players, playerSeasons: manifest.playerSeasons, logRows: manifest.logRows, collisions: collisions.length, missingLegacyIdentities: manifest.missingLegacyIdentities.length, counts }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
