// Team comparison totals are known value sums, with separate coverage flags.
// Pick ownership and draft progress are independent evidence.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const valueOf = value => finite(value) !== null && value >= 0 ? value : null;
    const id = value => value == null ? '' : String(value).trim();
    const playerId = value => id(value) !== '' && id(value) !== '0' ? id(value) : null;
    const yearOf = value => /^\d{4}$/.test(String(value ?? '')) ? Number(value) : null;
    const roundsOf = value => value != null && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100 ? Number(value) : null;
    const defaultPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
    const aliases = { DT: 'DL', DE: 'DL', NT: 'DL', EDGE: 'DL', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DST: 'DEF', 'D/ST': 'DEF' };

    function summarize(options) {
        const { roster, playersData = {}, values = {}, normPos, positions = defaultPositions } = options || {};
        const players = [...new Set((Array.isArray(roster?.players) ? roster.players : []).map(playerId).filter(Boolean))];
        const rooms = [...new Set((Array.isArray(positions) ? positions : defaultPositions).map(pos => String(pos).toUpperCase()).filter(Boolean))];
        const posTotals = Object.fromEntries(rooms.map(pos => [pos, 0]));
        const posComplete = Object.fromEntries(rooms.map(pos => [pos, players.length > 0]));
        const known = new Map();
        let total = 0, ageTotal = 0, ageCount = 0, unknownPosition = false;
        players.forEach(pid => {
            const value = valueOf(values[pid]);
            if (value !== null) { known.set(pid, value); total += value; }
            const player = playersData[pid];
            const age = finite(player?.age);
            if (age > 0) { ageTotal += age; ageCount++; }
            const rawPos = String(player?.position || '').toUpperCase();
            let position = aliases[rawPos] || rawPos;
            if (typeof normPos === 'function' && rawPos) {
                try { position = normPos(rawPos) || position; } catch (_) { /* use metadata position */ }
            }
            position = String(position || '').toUpperCase();
            position = aliases[position] || position;
            if (!position || ['?', 'UNKNOWN', 'UNK', 'N/A'].includes(position)) unknownPosition = true;
            else if (Object.hasOwn(posTotals, position)) {
                if (value === null) posComplete[position] = false;
                else posTotals[position] += value;
            }
        });
        // A player with no position may belong to any room. It cannot support
        // a room advantage simply because that player's value was omitted.
        if (unknownPosition) rooms.forEach(pos => { posComplete[pos] = false; });
        const rawStarters = Array.isArray(roster?.starters) ? roster.starters : [];
        const starters = rawStarters.map(playerId);
        const uniqueStarters = [...new Set(starters.filter(Boolean))];
        const playerSet = new Set(players);
        const starterTotal = uniqueStarters.reduce((sum, pid) => sum + (playerSet.has(pid) ? known.get(pid) ?? 0 : 0), 0);
        const starterComplete = starters.length > 0 && uniqueStarters.length === starters.length
            && uniqueStarters.every(pid => playerSet.has(pid) && known.has(pid));
        const settings = roster?.settings || {};
        const recordNumber = key => {
            const value = finite(settings[key]) ?? finite(roster?.[key]);
            return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
        };
        const points = key => {
            const whole = finite(settings[key]);
            if (whole === null) return null;
            const fraction = settings[key + '_decimal'];
            if (fraction != null && finite(fraction) === null) return null;
            return whole + (fraction ?? 0) / 100;
        };
        return {
            total, starterTotal, benchTotal: total - starterTotal,
            playerCount: players.length, knownValueCount: known.size,
            complete: players.length > 0 && known.size === players.length, starterComplete,
            averageAge: ageCount ? ageTotal / ageCount : null,
            posTotals, posComplete,
            record: { wins: recordNumber('wins'), losses: recordNumber('losses'), ties: recordNumber('ties') },
            pointsFor: points('fpts'), pointsAgainst: points('fpts_against'),
        };
    }

    function rank(profiles, metric = 'total') {
        const coverage = { total: 'complete', starterTotal: 'starterComplete', totalAssets: 'assetsComplete' }[metric];
        const rows = (Array.isArray(profiles) ? profiles : []).map((profile, index) => ({
            profile, index, value: valueOf(profile?.[metric]),
            valid: !!coverage && profile?.[coverage] === true && valueOf(profile?.[metric]) !== null,
        }));
        rows.sort((a, b) => Number(b.valid) - Number(a.valid) || (a.valid ? b.value - a.value : 0) || a.index - b.index);
        return rows.map((row, index) => ({
            profile: row.profile,
            rank: row.valid ? rows.findIndex(other => other.valid && other.value === row.value) + 1 : null,
            tied: row.valid && (rows[index - 1]?.valid && rows[index - 1].value === row.value || rows[index + 1]?.valid && rows[index + 1].value === row.value) || false,
        }));
    }

    // The NFL week counter restarts in preseason and postseason. Archived
    // seasons are complete regardless of the current calendar's week number.
    function completedThroughWeek(options) {
        const { season, nflState = {}, leagueWeek } = options || {};
        const year = yearOf(season), nflYear = yearOf(nflState?.season);
        if (year === null) return 0;
        if (nflYear !== null && year < nflYear) return 18;
        if (nflYear !== null && year > nflYear) return 0;
        const sameSeason = year === nflYear;
        if (sameSeason && nflState.season_type === 'post') return 18;
        if (sameSeason && nflState.season_type === 'pre') return 0;
        const validWeek = value => value != null && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 19 ? Number(value) : null;
        const week = validWeek(leagueWeek) ?? (sameSeason ? validWeek(nflState.display_week) ?? validWeek(nflState.week) : null);
        return week === null ? 0 : Math.max(0, Math.min(18, week - 1));
    }

    function meetingScore(row) {
        return finite(row?.custom_points ?? row?.points);
    }

    function draftCapital(options) {
        const { roster, league = {}, skin = {}, tradedPicks, rosterById = {}, getOwnerName, getPickValue } = options || {};
        const empty = note => ({ picks: [], totalValue: null, count: 0, byRound: {}, byYear: {}, topPicks: [], label: 'Picks unavailable', complete: false, valued: false, disabled: false, note });
        const format = String(skin.type || ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' })[league.settings?.type] || '').toLowerCase();
        if (skin.features?.showFuturePicks === false || ['redraft', 'chopped', 'seasonal'].includes(format)) {
            return { ...empty('Future draft capital is not included in this format.'), label: 'Seasonal format', disabled: true };
        }
        if (!['dynasty', 'keeper'].includes(format)) return empty('Draft format is unreported.');
        const rosterId = id(roster?.roster_id), season = yearOf(league.season);
        if (!rosterId || season === null) return empty('Draft ownership context is unavailable.');
        const feed = Array.isArray(league.tradedPicks) ? league.tradedPicks : Array.isArray(tradedPicks) ? tradedPicks : null;
        if (!feed) return empty('Pick ownership has not been imported.');
        if (league._pickFeedState === 'unavailable') return empty('Pick ownership is unavailable.');
        const leagueId = id(league.id || league.league_id);
        const knownRosters = new Set((league.rosters || []).map(item => id(item.roster_id)).filter(Boolean));
        const transfers = new Map();
        for (const pick of feed) {
            const year = yearOf(pick?.season), round = roundsOf(pick?.round);
            const original = id(pick?.roster_id), owner = id(pick?.owner_id);
            if (year === null || round === null || !original || !owner
                || (pick.league_id != null && leagueId && id(pick.league_id) !== leagueId)
                || (knownRosters.size && (!knownRosters.has(original) || !knownRosters.has(owner)))) return empty('Pick ownership contains an invalid source.');
            const key = [year, round, original].join(':');
            if (transfers.has(key) && transfers.get(key).owner !== owner) return empty('Pick ownership contains conflicting transfers.');
            transfers.set(key, { year, round, original, owner });
        }
        const rawInventory = league._draftInventory;
        let inventory = null;
        if (rawInventory && id(rawInventory.draftId) && (!league.draft_id || id(league.draft_id) === id(rawInventory.draftId))
            && yearOf(rawInventory.season) === season && league._draftInventoryState === 'ready'
            && ['pre_draft', 'drafting', 'complete'].includes(rawInventory.phase) && roundsOf(rawInventory.rounds) !== null
            && Array.isArray(rawInventory.consumed)) {
            const consumed = new Map();
            let valid = true;
            for (const pick of rawInventory.consumed) {
                const round = roundsOf(pick?.round), original = id(pick?.rosterId), player = id(pick?.playerId);
                const key = round + ':' + original;
                if (round === null || round > Number(rawInventory.rounds) || !original || !player
                    || (knownRosters.size && !knownRosters.has(original)) || (consumed.has(key) && consumed.get(key) !== player)) { valid = false; break; }
                consumed.set(key, player);
            }
            if (valid && (rawInventory.phase !== 'pre_draft' || consumed.size === 0)) inventory = { ...rawInventory, rounds: Number(rawInventory.rounds), consumed };
        }
        const futureRounds = roundsOf(league.settings?.draft_rounds);
        const notes = [];
        const ownershipReady = (!league._pickFeedState || league._pickFeedState === 'ready') && !league._portfolioStale;
        if (!ownershipReady) notes.push('Pick ownership is stale.');
        if (!inventory) notes.push('Current draft progress is unverified; current picks are omitted.');
        if (futureRounds === null) notes.push('Future draft rounds are unreported.');
        const picks = [];
        const append = (year, round, original) => {
            if (year === season && inventory.consumed.has(round + ':' + original)) return;
            const own = original === rosterId;
            let from = null;
            if (!own) {
                const sourceRoster = rosterById[original] || (league.rosters || []).find(item => id(item.roster_id) === original);
                if (typeof getOwnerName === 'function') { try { from = getOwnerName(sourceRoster, 'Team ' + original); } catch (_) { /* fallback label */ } }
                from = from || 'Team ' + original;
            }
            let value = null;
            if (format === 'dynasty' && typeof getPickValue === 'function') {
                try { value = valueOf(getPickValue(year, round)); } catch (_) { /* unpriced right */ }
            }
            const label = (year === season ? 'R' + round : "'" + String(year).slice(-2) + ' R' + round) + (from ? ' via ' + from : '');
            picks.push({ year, round, own, value, label, ...(from ? { from } : {}) });
        };
        for (let year = season; year <= season + 2; year++) {
            if (year === season && (!inventory || inventory.phase === 'complete')) continue;
            const rounds = year === season ? inventory.rounds : futureRounds;
            if (rounds === null) continue;
            for (let round = 1; round <= rounds; round++) {
                const ownTransfer = transfers.get([year, round, rosterId].join(':'));
                if (!ownTransfer || ownTransfer.owner === rosterId) append(year, round, rosterId);
                transfers.forEach(pick => { if (pick.year === year && pick.round === round && pick.owner === rosterId && pick.original !== rosterId) append(year, round, pick.original); });
            }
        }
        const complete = ownershipReady && inventory !== null && futureRounds !== null;
        const valued = format === 'dynasty' && (picks.length > 0 || complete) && picks.every(pick => pick.value !== null);
        if (format === 'keeper') notes.push('Keeper rights are unpriced without keeper costs and eligibility.');
        else if (!valued) notes.push('Some draft rights are unpriced.');
        const byRound = {}, byYear = {};
        picks.forEach(pick => { byRound[pick.round] = (byRound[pick.round] || 0) + 1; byYear[pick.year] = (byYear[pick.year] || 0) + 1; });
        const topPicks = picks.slice().sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.year - b.year || a.round - b.round).slice(0, 4);
        return {
            picks, totalValue: valued ? picks.reduce((sum, pick) => sum + pick.value, 0) : null,
            count: picks.length, byRound, byYear, topPicks,
            label: picks.length + (complete ? ' picks' : ' known picks'),
            complete, valued, disabled: false, note: notes.join(' ') || 'Imported ownership and draft progress verified.',
        };
    }

    App.TeamComparison = { summarize, rank, draftCapital, completedThroughWeek, meetingScore };
})(typeof window !== 'undefined' ? window : globalThis);
