// Live room facts and team draft builds. Pure derivation from the mirrored
// state: never projects selections or writes picks. Common board comparisons
// use the DHQ lane; the shared grade preserves the draft's captured ranks.
(function () {
    'use strict';

    const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI']);
    const DETAILED_IDP = new Set(['DE', 'DT', 'EDGE', 'CB', 'S', 'SS', 'FS']);
    const FLEX = {
        FLEX: ['RB', 'WR', 'TE'], WRRBTE_FLEX: ['RB', 'WR', 'TE'],
        WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
        SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], SFLEX: ['QB', 'RB', 'WR', 'TE'],
        OP: ['QB', 'RB', 'WR', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'], IDP: ['DL', 'LB', 'DB'],
    };
    const arr = value => Array.isArray(value) ? value : [];
    const key = value => value == null ? '' : String(value);
    const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const positive = value => number(value) > 0 ? Number(value) : null;
    const posOf = value => String(value?.pos || value?.position || value?.csv?.pos || '').toUpperCase();
    const rankOf = value => positive(value?.consensusRank) || positive(value?.rank) || positive(value?.analystBoardRank);

    function commonDhqRanks(state) {
        const board = state.draftContext?.boardContext || {};
        const ranks = new Map();
        Object.entries(board.entries || {}).forEach(([pid, entry]) => {
            if (positive(entry?.dhqRank)) ranks.set(key(entry.pid ?? pid), Number(entry.dhqRank));
        });
        arr(board.lanes?.dhq?.order).forEach((pid, index) => {
            if (!ranks.has(key(pid))) ranks.set(key(pid), index + 1);
        });
        if (ranks.size) return { ranks, source: 'Saved DHQ board' };
        // Launching with My Board or AI Board reorders originalPool and rewrites
        // consensusRank. Recover a common order from captured DHQ values only.
        // PID breaks value ties so changing the personal order cannot alter it.
        arr(state.originalPool).filter(p => positive(p?.dhq) && key(p.pid)).slice()
            .sort((a, b) => b.dhq - a.dhq || key(a.pid).localeCompare(key(b.pid)))
            .forEach(p => { if (!ranks.has(key(p.pid))) ranks.set(key(p.pid), ranks.size + 1); });
        return { ranks, source: ranks.size ? 'Draft-pool DHQ values' : 'Unavailable' };
    }

    function pickLabel(slot, leagueSize) {
        const overall = positive(slot?.overall);
        const round = positive(slot?.round) || (overall && leagueSize ? Math.ceil(overall / leagueSize) : null);
        // slot is the original draft column, not the pick within a snake round.
        const inRound = positive(slot?.pickInRound) || (overall && leagueSize ? (overall - 1) % leagueSize + 1 : null);
        return round && inRound ? round + '.' + String(inRound).padStart(2, '0') : overall ? '#' + overall : 'Pick';
    }

    // Maximum matching counts a player once across overlapping FLEX and SFLEX
    // slots. openSlots is one valid arrangement, not a claim that a FLEX can
    // only be filled by the particular position we happened to assign here.
    function lineupFit(slots, counts) {
        const players = Object.entries(counts).flatMap(([pos, count]) => Array(Math.min(slots.length, count)).fill(pos));
        const occupants = new Map();
        const place = (player, seen) => {
            for (let i = 0; i < slots.length; i++) {
                if (seen.has(i) || !(FLEX[slots[i]] || [slots[i]]).includes(players[player])) continue;
                seen.add(i);
                if (!occupants.has(i) || place(occupants.get(i), seen)) {
                    occupants.set(i, player);
                    return true;
                }
            }
            return false;
        };
        players.forEach((_, i) => place(i, new Set()));
        return {
            known: slots.length > 0, total: slots.length, filled: occupants.size,
            open: slots.length - occupants.size, openSlots: slots.filter((_, i) => !occupants.has(i)),
        };
    }

    function rookieNeeds(state, rosterId, counts) {
        const persona = state.personas?.[rosterId] || {};
        const owner = persona.ownerIntel || state.draftContext?.ownerContext?.[rosterId] || {};
        const assessment = persona.assessment || {};
        const candidates = [assessment.needs, owner.roster?.needs,
            rosterId === key(state.userRosterId) ? state.draftContext?.teamContext?.needs : null];
        const raw = candidates.find(list => Array.isArray(list) && list.length) || [];
        // Persona defaults include needs: [] and a made-up neutral health score.
        // Those defaults are insufficient evidence that a roster has no needs.
        const needsKnown = raw.length > 0 || Object.keys(assessment.posAssessment || {}).length > 0;
        const seen = new Set();
        const needs = raw.map(need => {
            const pos = String(typeof need === 'string' ? need : need?.pos || '').toUpperCase();
            if (!pos || seen.has(pos)) return null;
            seen.add(pos);
            const added = counts[pos] || 0;
            return { pos, urgency: need?.urgency || 'need', added, status: added ? 'added' : 'open',
                label: added ? pos + ': ' + added + ' added' : pos + ' need' };
        }).filter(Boolean);
        return { needs, needsKnown, needsBasis: 'Pre-draft roster needs' };
    }

    function draftValue(picks, state, isRookie, isAuction, assessment) {
        const helpers = window.DraftCC?.state || {};
        const ranked = picks.filter(pick => pick.valueDelta != null);
        const gradeRanked = picks.filter(pick => pick.consensusRank > 0);
        const dhqKnown = picks.filter(pick => pick.dhq != null && pick.dhq > 0);
        const threshold = helpers.REACH_STEAL_THRESHOLD || 7;
        const best = ranked.filter(p => p.valueDelta > 0).sort((a, b) => b.valueDelta - a.valueDelta)[0] || null;
        const reach = ranked.filter(p => p.valueDelta < 0).sort((a, b) => a.valueDelta - b.valueDelta)[0] || null;
        const variant = isAuction ? 'auction' : state.variant || (isRookie ? 'rookie' : 'startup');
        const grade = {
            available: false, letter: '—', score: null,
            totalDHQ: dhqKnown.reduce((total, pick) => total + pick.dhq, 0),
            provisional: true, pickCount: picks.length, rankedPicks: gradeRanked.length,
            dhqKnownPicks: dhqKnown.length,
            basis: 'Shared draft grade: ' + (typeof helpers.gradeBasisFor === 'function' ? helpers.gradeBasisFor(variant) : 'vs expected pick value') + '; uses draft-time board ranks',
            reason: !picks.length ? 'Waiting for their first pick' : 'Player values or board ranks are unavailable for some picks',
        };
        // In an auction the order of winning bids is not a ranking comparison.
        // The turn-based shared grade includes that comparison, so do not show
        // a spurious auction letter merely because this team won an early bid.
        if (isAuction) grade.reason = 'Auction selections are not comparable by pick order';
        else if (picks.length && gradeRanked.length === picks.length && dhqKnown.length === picks.length && typeof helpers.gradeDraft === 'function') {
            const result = helpers.gradeDraft(picks, [], {
                assessment: isRookie ? assessment : undefined, variant,
                leagueSize: state.leagueSize, rounds: state.rounds, budget: state.auctionBudget,
            });
            if (Number.isFinite(result?.score)) Object.assign(grade, result, { available: true,
                reason: 'Draft grade so far; based on ' + picks.length + ' pick' + (picks.length === 1 ? '' : 's') });
        } else if (typeof helpers.gradeDraft !== 'function' && picks.length) grade.reason = 'Draft grading is unavailable';
        return { grade, value: {
            basis: 'Common DHQ board', source: picks.find(p => p.dhqRank)?.dhqRankSource || 'Unavailable',
            rankedPicks: ranked.length, totalPicks: picks.length,
            averageDelta: ranked.length ? Math.round(ranked.reduce((sum, p) => sum + p.valueDelta, 0) / ranked.length * 10) / 10 : null,
            bestPick: best, biggestReach: reach,
            steals: ranked.filter(p => p.valueDelta >= threshold), reaches: ranked.filter(p => p.valueDelta <= -threshold),
        } };
    }

    function roomPulse(picks, windowSize) {
        const recentPicks = picks.slice(-windowSize);
        const positionCounts = {};
        recentPicks.forEach(p => { if (p.pos) positionCounts[p.pos] = (positionCounts[p.pos] || 0) + 1; });
        const runs = Object.entries(positionCounts).filter(([, count]) => count >= 3 && count >= recentPicks.length / 2).map(([pos, count]) => {
            let consecutive = 0;
            for (let i = recentPicks.length - 1; i >= 0 && recentPicks[i].pos === pos; i--) consecutive++;
            return { pos, count, window: recentPicks.length, consecutive,
                teamCount: new Set(recentPicks.filter(p => p.pos === pos && p.rosterId !== 'unknown').map(p => p.rosterId)).size };
        }).sort((a, b) => b.count - a.count || b.consecutive - a.consecutive || a.pos.localeCompare(b.pos));
        const leadingRun = runs[0] || null;
        const latestPick = picks[picks.length - 1] || null;
        const summary = leadingRun ? leadingRun.count + ' of the last ' + leadingRun.window + ' picks: ' + leadingRun.pos
            : latestPick ? 'Latest: ' + latestPick.name + (latestPick.pos ? ' · ' + latestPick.pos : '') : 'Waiting for the first pick';
        return { recentPicks, windowSize: recentPicks.length, positionCounts, runs, leadingRun, latestPick, summary };
    }

    function buildLiveRoom(input, options = {}) {
        const state = input || {};
        const order = arr(state.pickOrder);
        const leagueSize = positive(state.leagueSize) || positive(state.draftContext?.leagueFormat?.teams) || 0;
        const isAuction = state.draftMechanic === 'auction' || state.variant === 'auction';
        const isRookie = (isAuction ? state.auctionPoolSource : state.variant) === 'rookie';
        const currentIdx = Math.max(0, Math.floor(number(state.currentIdx) || 0));
        const remoteStatus = String(state.liveSync?.draftStatus || state.liveDraftMeta?.status || '').toLowerCase();
        // Mirroring can lag the remote completion flag. Keep grades provisional
        // until the reducer has the final picks, but never display a live clock
        // for a draft the platform says has not started or has already ended.
        const isComplete = state.phase === 'complete'
            || (!isAuction && order.length > 0 && currentIdx >= order.length);
        const awaitingStart = ['pre_draft', 'pre-draft', 'scheduled'].includes(remoteStatus)
            || (state.mode === 'live-sync' && state.liveSync?.status === 'waiting' && remoteStatus !== 'drafting');
        const userId = key(state.userRosterId);
        const pool = new Map();
        arr(state.originalPool).forEach((p, index) => {
            if (!pool.has(key(p.pid))) pool.set(key(p.pid), { player: p, rank: rankOf(p) || index + 1 });
        });
        const commonBoard = commonDhqRanks(state);
        const orderByOverall = new Map(order.map((slot, index) => [positive(slot.overall) || index + 1, slot]));
        const picks = arr(state.picks).filter(Boolean).map((raw, index) => {
            const pid = key(raw.pid ?? raw.player_id);
            const entry = pool.get(pid);
            const overall = positive(raw.overall) || positive(raw.sleeperPickNo) || index + 1;
            const slot = orderByOverall.get(overall) || {};
            const rosterId = key(raw.rosterId ?? raw.roster_id ?? slot.rosterId) || (raw.isUser ? userId : '') || 'unknown';
            const consensusRank = rankOf(raw) || entry?.rank || null;
            const dhqRank = commonBoard.ranks.get(pid) || null;
            // An explicit missing/zero DHQ from a mirrored pick stays unknown;
            // a later pool score must not silently rewrite its draft snapshot.
            const dhq = number(raw.dhq === undefined ? entry?.player?.dhq : raw.dhq);
            const pick = { ...raw, pid, rosterId, overall,
                round: positive(raw.round) || positive(slot.round),
                pickInRound: positive(raw.pickInRound) || positive(slot.pickInRound),
                name: raw.name || entry?.player?.name || 'Unknown player',
                pos: posOf(raw) || posOf(entry?.player), dhq,
                consensusRank, dhqRank, dhqRankSource: commonBoard.source,
                valueDelta: !isAuction && dhqRank ? overall - dhqRank : null,
            };
            pick.pickLabel = pickLabel(pick, leagueSize);
            return pick;
        }).sort((a, b) => a.overall - b.overall);
        const made = new Set(picks.map(p => p.overall));
        const teamMap = new Map();
        function addTeam(id, fallback) {
            const rosterId = key(id);
            if (!rosterId) return null;
            if (!teamMap.has(rosterId)) {
                const persona = state.personas?.[rosterId] || {};
                const owner = state.draftContext?.ownerContext?.[rosterId] || {};
                teamMap.set(rosterId, { rosterId,
                    teamName: persona.teamName || owner.teamName || fallback || (rosterId === 'unknown' ? 'Unknown team' : 'Team ' + rosterId),
                    ownerName: persona.ownerName || owner.ownerName || '', avatar: persona.avatar || '',
                    isUser: !!userId && rosterId === userId, picks: [], future: [], positionCounts: {} });
            }
            return teamMap.get(rosterId);
        }
        Object.entries(state.personas || {}).forEach(([rid, persona]) => addTeam(persona?.rosterId ?? rid));
        Object.keys(state.draftContext?.ownerContext || {}).forEach(rid => addTeam(rid));
        // Original owners remain in the room even after trading every pick away.
        order.forEach(slot => { addTeam(slot.rosterId, slot.ownerName); addTeam(slot.originalRosterId); });
        if (userId) addTeam(userId);
        picks.forEach(pick => {
            const team = addTeam(pick.rosterId, pick.ownerName);
            team.picks.push(pick);
            if (pick.pos) team.positionCounts[pick.pos] = (team.positionCounts[pick.pos] || 0) + 1;
        });
        const upcoming = [];
        if (!isAuction && !isComplete) order.forEach((slot, index) => {
            if (index < currentIdx || made.has(positive(slot.overall) || index + 1)) return;
            const rosterId = key(slot.rosterId) || 'unknown';
            const team = addTeam(rosterId, slot.ownerName);
            const next = { slot, index, rosterId, teamName: team.teamName, picksAway: upcoming.length,
                pickLabel: pickLabel(slot, leagueSize) };
            upcoming.push(next);
            team.future.push(next);
        });
        const nextUserPick = userId ? upcoming.find(next => next.rosterId === userId) || null : null;
        const currentSlot = upcoming[0]?.slot || null;
        const onClockRosterId = !awaitingStart && !['complete', 'completed', 'paused'].includes(remoteStatus)
            && state.phase !== 'setup' ? upcoming[0]?.rosterId || null : null;
        const slots = arr(state.draftContext?.leagueFormat?.rosterSlots).map(s => String(s).toUpperCase()).filter(s => s && !BENCH.has(s));
        const detailedIdp = slots.some(slot => DETAILED_IDP.has(slot));
        const candidatePositions = [...new Set(slots.flatMap(slot => FLEX[slot] || [slot]))];
        const helpers = window.DraftCC?.state || {};
        const roomValuesKnown = picks.every(pick => pick.dhq > 0 && pick.consensusRank > 0);
        const recapRows = !isAuction && roomValuesKnown && typeof helpers.buildTeamRecaps === 'function' && typeof helpers.leagueTotalsFromPicks === 'function'
            ? helpers.buildTeamRecaps(state, picks, helpers.leagueTotalsFromPicks(picks)) : [];
        const gradesByTeam = new Map(recapRows.map(row => [key(row.rosterId), row]));
        const teams = [...teamMap.values()].map(team => {
            const counts = team.positionCounts;
            const picks = team.picks;
            // Draft pools collapse DE/DT to DL and CB/S to DB. Without the
            // original eligibility a broad defender cannot prove a specific
            // slot is filled. Keep position additions, suppress false coverage.
            const startingLineup = isRookie ? { known: false, total: 0, filled: 0, open: 0, openSlots: [] }
                : detailedIdp ? { known: false, total: slots.length, filled: null, open: null, openSlots: [],
                    reason: 'Detailed IDP eligibility is unavailable in draft pick records' }
                    : lineupFit(slots, counts);
            const needRead = isRookie ? rookieNeeds(state, team.rosterId, counts) : {
                needsKnown: startingLineup.known, needsBasis: 'Open starting slots',
                needs: candidatePositions.filter(pos => startingLineup.known && lineupFit(slots, { ...counts, [pos]: (counts[pos] || 0) + 1 }).filled > startingLineup.filled)
                    .map(pos => ({ pos, urgency: 'open', added: counts[pos] || 0, status: 'open', label: pos + ' fits an open slot' })),
            };
            const positionBuild = Object.entries(counts).map(([pos, count]) => ({ pos, count, share: picks.length ? count / picks.length : 0 }))
                .sort((a, b) => (POSITIONS.includes(a.pos) ? POSITIONS.indexOf(a.pos) : 99) - (POSITIONS.includes(b.pos) ? POSITIONS.indexOf(b.pos) : 99) || a.pos.localeCompare(b.pos));
            const build = positionBuild.map(row => row.count + ' ' + row.pos).join(' · ')
                || picks.length + ' player' + (picks.length === 1 ? '' : 's') + ' added';
            const { grade, value } = draftValue(picks, state, isRookie, isAuction, state.personas?.[team.rosterId]?.assessment);
            const sharedGrade = gradesByTeam.get(team.rosterId);
            if (grade.available && sharedGrade) Object.assign(grade, {
                letter: sharedGrade.grade, score: sharedGrade.score, pct: sharedGrade.score,
                avgPickScore: sharedGrade.valuePct,
                rank: sharedGrade.rank, percentile: sharedGrade.percentile,
                reason: 'Same team grade as the league recap; based on picks so far',
            });
            else if (grade.available && !roomValuesKnown) Object.assign(grade, {
                available: false, letter: '—', score: null,
                reason: 'Some room picks lack player values; league comparisons are not ready',
            });
            grade.provisional = !isComplete;
            const openNeeds = needRead.needs.filter(need => need.status === 'open');
            const story = !picks.length ? 'No picks yet.' : isRookie
                ? build + (openNeeds.length ? '. Still watching ' + openNeeds.map(n => n.pos).join(', ') + ' needs.' : '. Rookie additions so far.')
                : build + (startingLineup.known ? '. ' + startingLineup.filled + '/' + startingLineup.total + ' starting slots covered.'
                    : detailedIdp ? '. Detailed IDP eligibility unavailable.' : '. Lineup requirements unavailable.');
            const { future, ...base } = team;
            return { ...base, pickCount: picks.length, lastPick: picks[picks.length - 1] || null,
                nextPick: future[0] || null, picksAway: future[0]?.picksAway ?? null,
                picksBeforeUser: nextUserPick ? future.filter(next => next.index < nextUserPick.index).length : null,
                remainingPicks: isAuction || (!order.length && !isComplete) ? null : future.length,
                isOnClock: team.rosterId === onClockRosterId, positionBuild, startingLineup,
                ...needRead, grade, value, story };
        });
        return {
            schemaVersion: 'draft-live-room-v1', isComplete, isAuction, isRookie, awaitingStart,
            pickCount: picks.length, totalPicks: order.length || (leagueSize * (positive(state.rounds) || 0)),
            currentSlot, onClockRosterId, nextUserPick, upcoming, teams,
            teamsById: Object.fromEntries(teams.map(team => [team.rosterId, team])),
            pulse: roomPulse(picks, Math.min(20, Math.max(3, positive(options.lookback) || 6))),
        };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.liveRoomEngine = { buildLiveRoom };
})();
