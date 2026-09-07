// ================================================================
// js/draft/live-decision-engine.js - P3 live draft decision deck
//
// Builds the "what do I do right now?" layer for live/manual draft
// command mode. Pure functions only; UI lives in command-center.js.
// ================================================================

(function() {
    'use strict';

    const SCHEMA = 'draft-live-decision-v1';
    const TARGET_TAGS = new Set(['target', 'must', 'sleeper']);
    const FADE_TAGS = new Set(['fade', 'avoid']);
    const PLAYER_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'DE', 'DT', 'EDGE', 'CB', 'S', 'SS', 'FS']);

    function idKey(value) {
        return value == null ? '' : String(value);
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function num(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function posOf(player) {
        return String(player?.pos || player?.position || player?.csv?.pos || '').toUpperCase();
    }

    function isRedraftLive(state) {
        return state?.mode === 'live-sync' && (state.variant === 'redraft'
            || state.auctionPoolSource === 'redraft'
            || state.draftContext?.leagueFormat?.draftType === 'redraft');
    }

    const FLEX_ELIGIBILITY = {
        FLEX: ['RB', 'WR', 'TE'], WRRBTE_FLEX: ['RB', 'WR', 'TE'],
        WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
        SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], SFLEX: ['QB', 'RB', 'WR', 'TE'], OP: ['QB', 'RB', 'WR', 'TE'],
        IDP_FLEX: ['DL', 'LB', 'DB'], IDP: ['DL', 'LB', 'DB'],
    };

    // Maximum matching handles overlapping FLEX / SFLEX slots without counting
    // the same player twice or greedily spending a flexible slot too early.
    function lineupFit(state, counts, addedPos) {
        const slots = asArray(state.draftContext?.leagueFormat?.rosterSlots)
            .map(s => String(s).toUpperCase()).filter(s => !['BN', 'BE', 'BENCH', 'IR', 'TAXI'].includes(s));
        const players = Object.entries(counts).flatMap(([pos, count]) => Array(Math.min(slots.length, num(count))).fill(pos));
        if (addedPos) players.push(addedPos);
        const occupants = new Map();
        const place = (pi, seen) => {
            for (let si = 0; si < slots.length; si++) {
                if (seen.has(si) || !(FLEX_ELIGIBILITY[slots[si]] || [slots[si]]).includes(players[pi])) continue;
                seen.add(si);
                if (!occupants.has(si) || place(occupants.get(si), seen)) { occupants.set(si, pi); return true; }
            }
            return false;
        };
        players.forEach((_, i) => place(i, new Set()));
        return { filled: occupants.size, total: slots.length,
            openSlots: slots.filter((_, i) => !occupants.has(i)),
            known: slots.length > 0 && !slots.some(s => ['DE', 'DT', 'EDGE', 'CB', 'S', 'SS', 'FS'].includes(s)) };
    }

    // The live draft's additions are authoritative. In a keeper league include
    // the existing roster too, deduplicating players already mirrored as picks.
    // A regular redraft never imports a stale previous-season roster as keepers.
    function rosterSnapshot(state, rosterId) {
        const rid = idKey(rosterId);
        const players = new Map();
        [...asArray(state.originalPool), ...asArray(state.pool)].forEach(p => players.set(idKey(p.pid), p));
        const owned = new Map();
        const add = raw => {
            const pid = idKey(typeof raw === 'object' ? raw?.pid ?? raw?.player_id : raw);
            if (!pid || owned.has(pid)) return;
            const player = typeof raw === 'object' ? raw : players.get(pid) || window.S?.players?.[pid] || {};
            const pos = [posOf(player), posOf(players.get(pid)), posOf(window.S?.players?.[pid])]
                .find(value => PLAYER_POSITIONS.has(value)) || '';
            owned.set(pid, { pid, pos });
        };
        asArray(state.picks).filter(p => idKey(p.rosterId ?? p.roster_id) === rid).forEach(add);
        if (state.draftContext?.leagueFormat?.flags?.keeper) {
            const roster = asArray(window.S?.rosters).find(r => idKey(r.roster_id) === rid);
            asArray(roster?.players).forEach(add);
            if (rid === idKey(state.userRosterId)) asArray(state.draftContext?.teamContext?.currentRoster).forEach(add);
        }
        asArray(state.keepers?.[rid]).forEach(add);
        const counts = {};
        owned.forEach(p => { if (p.pos) counts[p.pos] = num(counts[p.pos]) + 1; });
        return { counts, ownedIds: [...owned.keys()], unknownPlayers: [...owned.values()].filter(p => !p.pos).length };
    }

    function takenCounts(state) {
        const mirrored = {};
        const seen = new Set();
        asArray(state.picks).forEach((p, i) => {
            const pid = idKey(p.pid);
            const event = idKey(p.overall ?? p.sleeperPickNo ?? p.id ?? i) + ':' + pid;
            if (!pid || seen.has(event)) return;
            seen.add(event);
            mirrored[pid] = num(mirrored[pid]) + 1;
        });
        Object.entries(state.draftedPids || {}).forEach(([pid, count]) => { mirrored[pid] = Math.max(num(mirrored[pid]), num(count)); });
        return mirrored;
    }

    function buildRosterPlan(state, rosterId = state?.userRosterId, overrideCounts, atIndex) {
        if (!isRedraftLive(state)) return null;
        const snapshot = rosterSnapshot(state, rosterId);
        const rid = idKey(rosterId);
        const identityKnown = !!rid && (Object.prototype.hasOwnProperty.call(state.personas || {}, rid)
            || Object.prototype.hasOwnProperty.call(state.draftContext?.ownerContext || {}, rid)
            || asArray(state.pickOrder).some(slot => idKey(slot.rosterId) === rid || idKey(slot.originalRosterId) === rid)
            || snapshot.ownedIds.length > 0);
        const counts = overrideCounts || snapshot.counts;
        const fit = lineupFit(state, counts);
        const slots = asArray(state.draftContext?.leagueFormat?.rosterSlots).map(s => String(s).toUpperCase());
        const active = slots.filter(s => !['BN', 'BE', 'BENCH', 'IR', 'TAXI'].includes(s));
        const rosterCapacity = slots.length ? slots.filter(s => !['IR', 'TAXI'].includes(s)).length : null;
        const rosterSize = Object.values(counts).reduce((a, b) => a + num(b), 0) + snapshot.unknownPlayers;
        const index = atIndex == null ? num(state.currentIdx) : atIndex;
        const future = asArray(state.pickOrder).slice(index).filter(s => idKey(s.rosterId) === idKey(rosterId));
        const complete = state.phase === 'complete';
        const remainingPicks = !identityKnown ? null : complete ? 0 : state.draftMechanic === 'auction'
            ? (rosterCapacity == null ? null : Math.max(0, rosterCapacity - rosterSize))
            : asArray(state.pickOrder).length ? Math.min(future.length, rosterCapacity == null ? Infinity : Math.max(0, rosterCapacity - rosterSize)) : null;
        const known = identityKnown && fit.known && snapshot.unknownPlayers === 0;
        const open = known ? fit.total - fit.filled : null;
        const mustFillStarters = known && remainingPicks != null && remainingPicks > 0 && open >= remainingPicks;
        const positionLimits = state.positionLimits || state.draftContext?.leagueFormat?.positionLimits || {};
        const allPositions = [...new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB',
            ...active.flatMap(s => FLEX_ELIGIBILITY[s] || [s]), ...Object.keys(counts), ...asArray(state.pool).map(posOf).filter(Boolean)])];
        const positions = allPositions.map(pos => {
            const have = num(counts[pos]);
            const starterCapacity = active.filter(s => (FLEX_ELIGIBILITY[s] || [s]).includes(pos)).length;
            const fillsStarter = known && lineupFit(state, counts, pos).filled > fit.filled;
            const starterUpgrade = known && pos === 'QB' && have < starterCapacity && starterCapacity > 1;
            const explicit = Object.prototype.hasOwnProperty.call(positionLimits, pos) && Number.isFinite(Number(positionLimits[pos])) && Number(positionLimits[pos]) >= 0
                ? Number(positionLimits[pos]) : null;
            let status = 'unknown';
            let reason = 'Lineup or roster information is incomplete; compare player value.';
            if (explicit != null && have >= explicit) { status = 'blocked'; reason = pos + ' roster limit reached (' + have + '/' + explicit + ').'; }
            else if (fit.known && !starterCapacity) { status = 'blocked'; reason = 'This lineup has no eligible ' + pos + ' slot.'; }
            else if (known) {
                if (remainingPicks === 0) { status = 'blocked'; reason = 'No remaining roster space or draft selections.'; }
                else if (fillsStarter) { status = 'need'; reason = pos + ' fills an open starting slot' + (mustFillStarters ? '; reserve your remaining picks for starters.' : '.'); }
                else if (mustFillStarters) { status = 'blocked'; reason = 'Adding another ' + pos + ' would use a pick needed for an unfilled starting slot.'; }
                else if (starterUpgrade) { status = 'need'; reason = 'Adds a starting quarterback option in superflex; your current coverage relies on a skill player there.'; }
                else if (pos === 'QB' && starterCapacity <= 1) { status = 'set'; reason = 'Your QB starter is covered. Use this pick for an open starter or RB/WR depth.'; }
                else if (['K', 'DEF'].includes(pos)) { status = 'set'; reason = pos + ' is covered; a second specialist adds little weekly flexibility.'; }
                else if (pos === 'QB' && have >= starterCapacity + 1) { status = 'set'; reason = 'Your quarterback starters and a backup are covered.'; }
                else if (pos === 'TE' && have >= Math.max(2, active.filter(s => s === 'TE').length + 1)) { status = 'set'; reason = 'Your tight-end group has starter coverage and depth.'; }
                else { status = 'depth'; reason = pos === 'QB' ? 'A backup supports your multi-QB lineup.' : pos + ' adds bench depth and lineup flexibility.'; }
            }
            return { pos, have, starterCapacity, fillsStarter, starterUpgrade, status, reason };
        });
        const summary = !known ? (snapshot.unknownPlayers ? 'Some player positions are unavailable. Roster fit is uncertain until those positions are known.'
            : 'Roster fit is uncertain until lineup and keeper information are available.')
            : remainingPicks === 0 ? (rosterCapacity != null && rosterSize >= rosterCapacity ? 'Your draft roster is complete.' : 'No draft selections remain for this roster.')
                : mustFillStarters ? open + ' starting slots open with ' + remainingPicks + ' pick' + (remainingPicks === 1 ? '' : 's') + ' left. Fill the lineup now.'
                    : open ? fit.filled + '/' + fit.total + ' starting slots covered. Add useful starters and depth while reserving picks for the open slots.'
                        : 'Starting lineup covered. Build flexible depth for injuries and bye weeks.';
        return { known, identityKnown, unknownPlayers: snapshot.unknownPlayers, counts, ownedIds: snapshot.ownedIds, filled: known ? fit.filled : null, total: fit.total,
            openSlots: known ? fit.openSlots : [], remainingPicks, mustFillStarters, rosterSize, rosterCapacity,
            positions, waitPositions: positions.filter(p => p.status === 'set').map(p => p.pos), summary };
    }

    function rosterFitFor(plan, player) {
        const row = plan?.positions.find(p => p.pos === posOf(player));
        return row || { pos: posOf(player), status: 'unknown', fillsStarter: false, reason: 'Position fit is unknown.' };
    }

    function applyRosterFit(rows, plan) {
        if (!plan) return rows;
        const eligible = rows.filter(row => !['set', 'blocked'].includes(rosterFitFor(plan, row.player).status)
            && !plan.ownedIds.includes(idKey(row.player.pid)));
        const maxValue = Math.max(1, ...eligible.map(row => Math.max(0, row.dhq)));
        return rows.map(row => {
            const fit = rosterFitFor(plan, row.player);
            const useful = !['set', 'blocked'].includes(fit.status) && !plan.ownedIds.includes(idKey(row.player.pid));
            // Compress raw player value before applying marginal roster utility:
            // a 9,000-DHQ backup cannot overpower a 3,000-DHQ usable starter.
            const priority = fit.status === 'need' ? (['K', 'DEF'].includes(fit.pos) && !plan.mustFillStarters ? 18 : 70)
                : fit.status === 'depth' ? (['RB', 'WR'].includes(fit.pos) ? 18 : 5) : 0;
            const score = plan.known ? 45 * Math.max(0, row.dhq) / maxValue + priority
                + Math.max(-8, Math.min(8, row.score - row.dhq / 100)) : row.score;
            const opportunityCost = fit.starterUpgrade && !fit.fillsStarter ? 'Improves superflex quarterback coverage; the remaining open slots still need later picks.'
                : fit.status === 'need' ? 'This pick covers a starting slot; a backup would leave it open.'
                : fit.status === 'depth' ? 'Adds a usable reserve after starting coverage; compare the next player at this position.' : fit.reason;
            return { ...row, score, useful, rosterFit: { ...fit, opportunityCost } };
        });
    }

    function historyLean(persona, pos) {
        const dna = persona?.draftDna;
        // Sparse or inferred history never becomes a confident owner tell.
        if (!dna || dna.inferred || num(dna.picksAnalyzed) < 12) return 0;
        const raw = num(dna.posPct?.[pos]);
        const pct = raw <= 1 ? raw * 100 : raw;
        return Math.min(5, pct / 10) * Math.min(1, num(dna.picksAnalyzed) / 36);
    }

    function lockRedraftForecast(state, now = Date.now()) {
        if (!isRedraftLive(state) || state.phase !== 'drafting' || !state.liveSync?.lastPollAt
            || !['mirroring', 'waiting'].includes(state.liveSync?.status) || state.draftMechanic === 'auction') return state;
        const slot = asArray(state.pickOrder)[num(state.currentIdx)];
        const key = idKey(slot?.overall);
        const existing = state.redraftBroadcast?.forecasts || {};
        if (!key || existing[key] || asArray(state.picks).some(p => num(p.overall) >= num(slot.overall))) return state;
        const read = buildRedraftRoomRead(state);
        const forecast = read?.forecasts[0];
        if (!forecast || num(forecast.slot.overall) !== num(slot.overall)) return state;
        const slim = p => p ? { pid: idKey(p.pid), name: p.name, pos: posOf(p) } : null;
        return { ...state, redraftBroadcast: { ...state.redraftBroadcast, forecasts: { ...existing, [key]: {
            overall: num(slot.overall), rosterId: idKey(slot.rosterId), player: slim(forecast.player),
            alternative: slim(forecast.alternative), reason: forecast.reason, lockedAt: now,
            observedPicks: asArray(state.picks).length, draftId: state.sleeperDraftId,
        } } } };
    }

    function predictionScorecard(state) {
        const records = Object.values(state.redraftBroadcast?.forecasts || {}).filter(f => idKey(f.draftId) === idKey(state.sleeperDraftId));
        const rows = records.map(f => {
            const actual = asArray(state.picks).find(p => num(p.overall) === f.overall && p.source === 'live-sync');
            const outcome = !actual ? 'Pending' : idKey(actual.rosterId) !== f.rosterId ? 'Owner changed'
                : idKey(actual.pid) === f.player.pid ? 'Hit' : idKey(actual.pid) === f.alternative?.pid ? 'Alternate hit' : 'Surprise';
            return { ...f, actual, outcome };
        }).sort((a, b) => b.overall - a.overall);
        const scored = rows.filter(r => r.actual && r.outcome !== 'Owner changed');
        return { rows, total: scored.length, hits: scored.filter(r => r.outcome === 'Hit').length,
            alternates: scored.filter(r => r.outcome === 'Alternate hit').length,
            surprises: scored.filter(r => r.outcome === 'Surprise').length };
    }

    function redraftBroadcastRead(state, read, counts, projectedTaken) {
        const copies = Math.max(1, num(state.playerCopies, 1));
        const actualTaken = takenCounts(state);
        const available = asArray(state.pool).filter(p => num(actualTaken[p.pid]) < copies);
        const usefulOptions = candidates(state, Math.max(40, available.length)).filter(c => !c.fade).map(c => c.player);
        const tracked = asArray(state.redraftBroadcast?.watchPids);
        const marked = asArray(state.originalPool).filter(p => isTarget(boardEntry(state.draftContext?.boardContext, p))).map(p => idKey(p.pid));
        const watchIds = [...new Set([...tracked, ...marked])].slice(0, 8);
        const watch = watchIds.map(pid => {
            const p = asArray(state.originalPool).find(p => idKey(p.pid) === pid) || asArray(state.picks).find(p => idKey(p.pid) === pid);
            if (!p) return null;
            const picks = asArray(state.picks).filter(p => idKey(p.pid) === pid);
            const taken = num(actualTaken[pid]) >= copies;
            const yours = picks.some(p => idKey(p.rosterId) === idKey(state.userRosterId));
            const threats = read.forecasts.filter(f => idKey(f.player.pid) === pid || idKey(f.alternative?.pid) === pid);
            const projectedGone = num(projectedTaken[pid]) >= copies;
            const risk = taken ? (yours ? 'Yours' : 'Taken') : read.next?.picksAway === 0 ? 'Available now'
                : read.isAuction || !read.next ? 'Unknown' : projectedGone ? 'Unlikely'
                    : !read.fullHorizon || threats.length ? 'Toss-up' : 'Likely';
            const backup = usefulOptions.find(x => idKey(x.pid) !== pid && posOf(x) === posOf(p))
                || usefulOptions.find(x => idKey(x.pid) !== pid) || null;
            return { player: p, risk, threats, backup, taken, yours,
                owner: picks.length ? (state.personas?.[idKey(picks[picks.length - 1].rosterId)]?.teamName || 'Team ' + picks[picks.length - 1].rosterId) : null };
        }).filter(Boolean);
        const recommendations = pickCards(state, null).filter(c => ['recommended', 'safe', 'upside'].includes(c.kind));
        const shortlist = recommendations.map(c => available.find(p => idKey(p.pid) === idKey(c.player.pid))).filter(Boolean);
        const stories = Object.entries(counts).map(([rid, build]) => {
            const actual = asArray(state.picks).filter(p => idKey(p.rosterId) === rid);
            const fit = lineupFit(state, build);
            const dominant = Object.entries(build).sort((a, b) => b[1] - a[1])[0];
            if (actual.length < 2) return null;
            return { rosterId: rid, team: state.personas?.[rid]?.teamName || 'Team ' + rid,
                title: dominant?.[1] >= 3 ? dominant[0] + ' collector' : 'Building the starters',
                text: actual.length + ' picks · ' + fit.filled + '/' + fit.total + ' starting slots covered'
                    + (dominant?.[1] >= 3 ? ' · ' + dominant[1] + ' ' + dominant[0] + ' selected' : '') };
        }).filter(Boolean).sort((a, b) => (a.rosterId === idKey(state.userRosterId) ? -1 : b.rosterId === idKey(state.userRosterId) ? 1 : 0)).slice(0, 4);
        return { watch, shortlist, recommendations, stories, scorecard: predictionScorecard(state) };
    }

    // Conditional forecast: walk the real pick order, removing projected picks
    // and updating each manager's build. No random CPU picks or state mutations.
    function buildRedraftRoomRead(state) {
        if (!isRedraftLive(state)) return null;
        const copies = Math.max(1, num(state.playerCopies, 1));
        const taken = takenCounts(state);
        const pool = asArray(state.pool).filter(p => p?.pid && num(taken[p.pid]) < copies);
        const next = nextUserPick(state);
        const counts = {};
        const projectedOwned = {};
        const rosterIds = new Set([...Object.keys(state.personas || {}), ...asArray(state.pickOrder).map(s => idKey(s.rosterId)), idKey(state.userRosterId)]);
        rosterIds.forEach(rid => { const snapshot = rosterSnapshot(state, rid); counts[rid] = snapshot.counts; projectedOwned[rid] = new Set(snapshot.ownedIds); });
        const actualCounts = JSON.parse(JSON.stringify(counts));
        const maxValue = Math.max(1, ...pool.map(p => num(p.dhq)));
        const market = p => {
            const value = window.App?.getRedraftAdp?.(idKey(p.pid))?.adp;
            return num(value) > 0 ? num(value) : null;
        };
        const originalRanks = rankMap(asArray(state.originalPool).map(p => p.pid));
        const playerInputs = new Map(pool.map((p, i) => {
            const adp = market(p);
            return [p, { pos: posOf(p), adp, rank: adp || originalRanks[idKey(p.pid)] || i + 1 }];
        }));
        const forecasts = [];
        const horizon = Math.min(24, Math.max(6, next?.picksAway || 0));
        const order = state.draftMechanic === 'auction' ? [] : asArray(state.pickOrder).slice(num(state.currentIdx), num(state.currentIdx) + horizon);
        for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
            const slot = order[orderIndex];
            const rid = idKey(slot.rosterId);
            if (rid === idKey(state.userRosterId)) break;
            const build = counts[rid] || {};
            const plan = buildRosterPlan(state, rid, build, num(state.currentIdx) + orderIndex);
            const persona = state.personas?.[rid];
            const ranked = pool.filter(p => num(taken[p.pid]) < copies && !projectedOwned[rid]?.has(idKey(p.pid)))
                .filter(p => !['set', 'blocked'].includes(rosterFitFor(plan, p).status)).map(p => {
                const { pos, adp, rank } = playerInputs.get(p);
                const fit = rosterFitFor(plan, p);
                const fillsStarter = fit.fillsStarter;
                const missing = fillsStarter ? 1 : 0;
                // Market demand leads; actual missing starters and repeat-position
                // selections adjust it. Missing ADP falls back to the DHQ board.
                const history = historyLean(persona, pos);
                const scoring = state.draftContext?.leagueFormat?.scoring || {};
                const scoringLean = (pos === 'TE' && scoring.tePremium ? 3 : 0)
                    + (pos === 'QB' && num(scoring.passTd, 4) >= 6 ? 2 : 0);
                const score = 65 / (1 + Math.max(0, rank - num(slot.overall)) / 12)
                    + 20 * num(p.dhq) / maxValue + Math.min(2, missing) * 9
                    + history + scoringLean
                    - (fillsStarter ? 0 : num(build[pos]) * (['QB', 'TE', 'K', 'DEF'].includes(pos) ? 9 : 3));
                return { p, score, adp, missing, pos, history, scoringLean, fillsStarter, rosterFit: fit };
            }).sort((a, b) => b.score - a.score);
            if (!ranked.length) break;
            const locked = state.redraftBroadcast?.forecasts?.[idKey(slot.overall)];
            const lockRow = locked && idKey(locked.draftId) === idKey(state.sleeperDraftId) && locked.rosterId === rid
                ? ranked.find(r => idKey(r.p.pid) === locked.player.pid) : null;
            const validLock = !!lockRow;
            const best = lockRow || ranked[0];
            forecasts.push({ slot, rosterId: rid, team: persona?.teamName || slot.ownerName || 'Team ' + rid,
                player: best.p, alternative: validLock && ranked.some(r => idKey(r.p.pid) === idKey(locked.alternative?.pid)) ? locked.alternative : ranked.find(r => r !== best)?.p || null,
                rosterFit: best.rosterFit,
                reason: validLock && !best.rosterFit?.starterUpgrade ? locked.reason : (best.adp ? 'ADP ' + best.adp.toFixed(1) : 'DHQ board fallback')
                    + (best.fillsStarter ? ' · fills a starting slot (including flex)'
                        : best.rosterFit?.starterUpgrade ? ' · upgrades superflex quarterback coverage' : ' · roster depth')
                    + (best.history > 0 ? ' · history leans ' + best.pos + ' (' + persona.draftDna.picksAnalyzed + ' picks)' : '')
                    + (best.scoringLean ? ' · scoring bonus' : ''),
                confidence: validLock ? 'Locked call' : ranked[1] && best.score - ranked[1].score < 8 ? 'Close call' : 'Stronger lean' });
            taken[best.p.pid] = num(taken[best.p.pid]) + 1;
            (projectedOwned[rid] || (projectedOwned[rid] = new Set())).add(idKey(best.p.pid));
            counts[rid] = { ...build, [best.pos]: num(build[best.pos]) + 1 };
        }
        const recent = asArray(state.picks).slice(-8);
        const positions = {};
        recent.forEach(p => { positions[posOf(p)] = num(positions[posOf(p)]) + 1; });
        const run = Object.entries(positions).sort((a, b) => b[1] - a[1])[0];
        const last = recent[recent.length - 1];
        const commentary = [];
        if (!last) commentary.push('Waiting for the first pick. Forecasts are opening-board estimates; roster builds will sharpen the read as picks arrive.');
        if (last) {
            const adp = market(last);
            const delta = adp ? num(last.overall) - adp : 0;
            commentary.push((state.personas?.[idKey(last.rosterId)]?.teamName || 'Team ' + last.rosterId) + ' selected ' + last.name + ' at #' + last.overall
                + (adp ? ' — ' + (Math.abs(delta) < 5 ? 'near market ADP.' : Math.round(Math.abs(delta)) + ' picks ' + (delta > 0 ? 'after' : 'before') + ' market ADP.') : '. No market ADP available for comparison.'));
        }
        if (run && run[1] >= 3) commentary.push(run[1] + ' of the last ' + recent.length + ' picks were ' + run[0] + '. Compare the remaining options before following the run.');
        const targets = forecasts.filter(f => isTarget(boardEntry(state.draftContext?.boardContext, f.player))).slice(0, 3);
        const rosterPlan = buildRosterPlan(state);
        const userCandidates = candidates(state, Math.max(40, pool.length)).filter(c => !c.fade);
        const survivors = userCandidates.filter(c => num(taken[c.player.pid]) < copies).slice(0, 3).map(c => c.player);
        const read = { forecasts, commentary, targets, survivors, next, isAuction: state.draftMechanic === 'auction',
            fullHorizon: !!next && next.picksAway <= forecasts.length,
            basis: 'Estimates use market ADP, scoring-aware DHQ, lineup/flex needs and available draft history. Likely / toss-up / unlikely are uncalibrated judgments, not measured probabilities.' };
        const broadcast = redraftBroadcastRead(state, read, actualCounts, taken);
        if (next && next.picksAway > 0 && run && run[1] >= 3) {
            const opponents = new Set(forecasts.map(f => f.rosterId));
            const needing = [...opponents].filter(rid => lineupFit(state, actualCounts[rid] || {}, run[0]).filled > lineupFit(state, actualCounts[rid] || {}).filled).length;
            commentary.push(needing + ' of ' + opponents.size + ' managers in this forecast can still use a ' + run[0] + ' in a starting slot. '
                + (needing ? 'Keep a backup at that position on your shortlist.' : 'The run may leave value at another position; compare your shortlist.'));
        }
        const canCompare = read.fullHorizon && !read.isAuction && num(next?.picksAway) > 0;
        const positionOutlook = rosterPlan.positions.filter(position => ['need', 'depth'].includes(position.status)).map(position => {
            const eligible = userCandidates.filter(c => posOf(c.player) === position.pos);
            const projected = eligible.filter(c => num(taken[c.player.pid]) < copies);
            const threats = forecasts.filter(f => posOf(f.player) === position.pos).map(f => ({ rosterId: f.rosterId, team: f.team, overall: f.slot.overall }));
            return { pos: position.pos, eligibleAvailable: eligible.length, projectedSurvivors: canCompare ? projected.length : null,
                bestNow: eligible[0]?.player || null, bestNext: canCompare ? projected[0]?.player || null : null, threats, canCompare,
                basis: canCompare ? 'Conditional on the projected picks before your turn' : 'A full next-turn comparison is unavailable',
                reason: !canCompare ? position.reason : !projected.length ? 'The forecast exhausts the useful ' + position.pos + ' options before your turn.'
                    : projected[0]?.player.pid === eligible[0]?.player.pid ? 'The top useful ' + position.pos + ' survives this forecast; waiting is conditional, not guaranteed.'
                        : 'The forecast removes the leading ' + position.pos + '; compare the next option before waiting.' };
        });
        return { ...read, ...broadcast, rosterPlan, positionOutlook };
    }

    function rankMap(order) {
        const out = {};
        asArray(order).forEach((pid, idx) => {
            const key = idKey(pid);
            if (key && out[key] == null) out[key] = idx + 1;
        });
        return out;
    }

    function activeLane(boardContext) {
        const lane = boardContext?.activeLane || 'dhq';
        return boardContext?.lanes?.[lane] ? lane : 'dhq';
    }

    function boardEntry(boardContext, player) {
        return boardContext?.entries?.[idKey(player?.pid)] || {};
    }

    function boardRank(boardContext, player, lane) {
        const entry = boardEntry(boardContext, player);
        if (lane === 'my') return entry.myRank || null;
        if (lane === 'ai') return entry.aiRank || null;
        return entry.dhqRank || player?.consensusRank || null;
    }

    function isTarget(entry) {
        return !!entry?.target || TARGET_TAGS.has(entry?.tag);
    }

    function isFade(entry) {
        return !!entry?.fade || FADE_TAGS.has(entry?.tag);
    }

    function ageOf(player) {
        const direct = num(player?.age || player?.csv?.age, 0);
        if (direct) return direct;
        const bd = player?.birth_date || player?.birthDate;
        if (!bd) return 0;
        const ms = Date.now() - new Date(bd).getTime();
        return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 31557600000) : 0;
    }

    function projectedValue(player, years) {
        const dhq = num(player?.dhq || player?.val, 0);
        if (!dhq) return 0;
        const project = window.App?.PlayerValue?.projectPlayerValue;
        const age = ageOf(player);
        if (typeof project !== 'function' || !age) return dhq;
        try {
            return num(project(player.pid, dhq, age, posOf(player), years), dhq);
        } catch (_) {
            return dhq;
        }
    }

    function nextUserPick(state) {
        const userRosterId = idKey(state?.userRosterId);
        const userSlot = num(state?.userSlot, 0);
        const currentIdx = num(state?.currentIdx, 0);
        const order = asArray(state?.pickOrder);
        for (let idx = currentIdx; idx < order.length; idx++) {
            const slot = order[idx];
            const byRoster = userRosterId && idKey(slot?.rosterId) === userRosterId;
            const bySlot = state?.mode !== 'live-sync' && userSlot && num(slot?.slot, 0) === userSlot;
            if (byRoster || bySlot) {
                return { slot, index: idx, picksAway: Math.max(0, idx - currentIdx) };
            }
        }
        return null;
    }

    function currentPersona(state) {
        const slot = asArray(state?.pickOrder)[num(state?.currentIdx, 0)] || null;
        if (!slot) return null;
        return state?.personas?.[slot.rosterId] || state?.personas?.[String(slot.rosterId)] || null;
    }

    function userNeedMap(state) {
        if (isRedraftLive(state)) {
            return Object.fromEntries(buildRosterPlan(state).positions.map(row => [row.pos, row.status === 'need' ? 14 : 0]));
        }
        const userPersona = state?.personas?.[state?.userRosterId] || state?.personas?.[String(state?.userRosterId)] || null;
        const intel = userPersona?.ownerIntel || state?.draftContext?.ownerContext?.[String(state?.userRosterId)] || {};
        const needs = asArray(userPersona?.assessment?.needs || intel?.roster?.needs || state?.draftContext?.teamContext?.needs);
        const out = {};
        needs.forEach((need, idx) => {
            const pos = typeof need === 'string' ? need : need?.pos;
            if (!pos) return;
            const urgent = /critical|deficit|thin|priority/i.test(String(need?.urgency || need?.label || ''));
            out[pos] = Math.max(out[pos] || 0, urgent ? 22 : 14 - Math.min(idx, 4));
        });
        return out;
    }

    // GM Strategy terms for the live score — resolved once per candidates()
    // pass, so the Recommended/Safe/Upside cards obey the strategy on the
    // DEFAULT (dhq) board lane, not just the AI lane. Guarded: gm-mode.js is
    // optional; returns null (score unchanged) until a strategy is saved.
    function gmScoreContext(state) {
        try {
            if (typeof window.WR?.GmMode?.effects !== 'function') return null;
            const fx = window.WR.GmMode.effects(state?.leagueId || window.S?.currentLeagueId);
            if (!fx || !fx.hasStrategy) return null;
            return {
                // Same draftStyle → needBias mapping as the AI board lane.
                needBias: (fx.draftStyle === 'positional_need' || fx.draftStyle === 'need') ? 1.35
                    : fx.draftStyle === 'bpa' ? 0.8
                    : num(fx.draftWeights?.needBias, 1) || 1,
                youthPremium: num(fx.draftWeights?.youthPremium, 1) || 1,
                targets: fx.targetPositions instanceof Set ? fx.targetPositions : new Set(),
                fades: fx.sellPositions instanceof Set ? fx.sellPositions : new Set(),
                // Which positions to lean toward (RB-Heavy/Hero-RB/etc.) — same
                // archetype key + multiplier table the Big Board's AI lane uses.
                archetypeKey: fx.draftArchetype || 'balanced',
            };
        } catch (_) { return null; }
    }

    function decorateCandidate(state, player, idx, lane, rankLookup, needs, gm) {
        const boardContext = state?.draftContext?.boardContext || {};
        const entry = boardEntry(boardContext, player);
        const rank = boardRank(boardContext, player, lane) || rankLookup[idKey(player?.pid)] || idx + 1;
        const dhq = num(player?.dhq || player?.val, 0);
        const y5 = isRedraftLive(state) ? dhq : projectedValue(player, 5);
        const growth = y5 - dhq;
        const tagTarget = isTarget(entry);
        const tagFade = isFade(entry);
        const tier = entry.tier || player?.tier || player?.csv?.tier || null;
        // userNeedMap depends only on state, not the player — built once by candidates()
        // and passed in (was rebuilt for every one of the ~300-440 pool candidates).
        const needMap = needs || userNeedMap(state);
        const needBoost = (needMap[posOf(player)] || 0) * (gm ? gm.needBias : 1);
        // GM Strategy steers (0 when no strategy): mild target/fade position
        // shifts plus a youth tilt — rebuild boosts age-24-and-under skill
        // players, win-now fades them (youthPremium 1.2 / 0.6 per preset).
        const age = ageOf(player);
        const gmPosBoost = gm ? (gm.targets.has(posOf(player)) ? 6 : 0) - (gm.fades.has(posOf(player)) ? 6 : 0) : 0;
        const gmYouthBoost = (!isRedraftLive(state) && gm && age && age <= 24 && ['QB', 'RB', 'WR', 'TE'].includes(posOf(player)))
            ? Math.max(-12, Math.min(12, (gm.youthPremium - 1) * 30))
            : 0;
        // Same archetype multiplier table the Big Board's AI lane uses (RB
        // Heavy/Zero-RB/etc.) — scaled down to a ±10 boost, same order as the
        // other GM-steer terms above, so it nudges rather than dominates.
        const gmArchBoost = (gm?.archetypeKey && window.App?.DraftGameplan?.archetypeMultiplier)
            ? Math.max(-10, Math.min(10, (window.App.DraftGameplan.archetypeMultiplier(gm.archetypeKey, posOf(player)) - 1) * 60))
            : 0;
        const score = dhq / 100
            + needBoost
            + gmPosBoost
            + gmYouthBoost
            + gmArchBoost
            + (tagTarget ? 24 : 0)
            - (tagFade ? 42 : 0)
            + Math.max(-12, Math.min(18, growth / 180))
            - Math.max(0, rank - 1) * 0.45
            - (tier ? Math.max(0, tier - 1) * 2 : 0);
        return {
            player,
            entry,
            rank,
            dhq,
            y5,
            growth,
            tier,
            target: tagTarget,
            fade: tagFade,
            needBoost,
            score,
        };
    }

    function candidates(state, limit = 36) {
        const boardContext = state?.draftContext?.boardContext || {};
        const lane = activeLane(boardContext);
        const rankLookup = rankMap(boardContext?.lanes?.[lane]?.order || []);
        const needs = userNeedMap(state);
        const gm = gmScoreContext(state);
        const ldCopies = Math.max(1, Number(state?.playerCopies) || 1);
        const taken = takenCounts(state);
        const rows = asArray(state?.pool)
            .filter(p => p?.pid && num(taken[p.pid]) < ldCopies)
            .map((p, idx) => decorateCandidate(state, p, idx, lane, rankLookup, needs, gm));
        if (isRedraftLive(state)) {
            const plan = buildRosterPlan(state);
            if (state.phase === 'complete' || plan.remainingPicks === 0) return [];
            return applyRosterFit(rows, plan).filter(row => row.useful).sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, limit);
        }
        return rows.sort((a, b) => (a.rank - b.rank) || (b.dhq - a.dhq)).slice(0, limit);
    }

    function card(kind, label, candidate, detail, tone = 'gold', extra = {}) {
        if (!candidate?.player) return null;
        return {
            kind,
            label,
            tone,
            player: {
                pid: candidate.player.pid,
                name: candidate.player.name || candidate.player.full_name || candidate.player.pid,
                pos: posOf(candidate.player),
                dhq: candidate.dhq,
                y5: candidate.y5,
                tier: candidate.tier,
                rank: candidate.rank,
                tag: candidate.entry?.tag || null,
            },
            detail,
            drivers: extra.drivers || [],
            action: extra.action || 'player',
            meta: extra.meta || {},
        };
    }

    function pickCards(state, tradeWindow) {
        const redraft = isRedraftLive(state);
        const rows = candidates(state, 40);
        const clean = rows.filter(c => !c.fade);
        if (redraft) {
            const chosen = [];
            if (clean[0]) chosen.push(clean[0]);
            const differentPosition = clean.find(c => !chosen.some(p => idKey(p.player.pid) === idKey(c.player.pid)) && posOf(c.player) !== posOf(chosen[0]?.player));
            const second = differentPosition || clean.find(c => !chosen.some(p => idKey(p.player.pid) === idKey(c.player.pid)));
            if (second) chosen.push(second);
            const third = clean.find(c => !chosen.some(p => idKey(p.player.pid) === idKey(c.player.pid)));
            if (third) chosen.push(third);
            return chosen.map((row, index) => card(
                ['recommended', 'safe', 'upside'][index], ['Take now', 'Useful alternative', 'Another route'][index], row,
                row.rosterFit?.reason || 'Best available value while roster requirements are unknown.',
                ['gold', 'green', 'purple'][index], {
                    drivers: [row.rosterFit?.status === 'unknown' ? 'roster_unknown' : 'marginal_roster_value',
                        row.rosterFit?.fillsStarter ? 'open_starter' : row.rosterFit?.starterUpgrade ? 'starter_upgrade'
                            : row.rosterFit?.status === 'unknown' ? 'board_value' : 'useful_depth', row.target ? 'user_target' : 'board_value'],
                    meta: { rosterFit: row.rosterFit || null },
                }
            ));
        }
        const recommended = clean.slice().sort((a, b) => b.score - a.score)[0] || rows[0];
        const safe = clean.slice().sort((a, b) => {
            const stabilityA = a.dhq + (a.tier ? (8 - Math.min(8, a.tier)) * 90 : 0) + Math.min(0, a.growth);
            const stabilityB = b.dhq + (b.tier ? (8 - Math.min(8, b.tier)) * 90 : 0) + Math.min(0, b.growth);
            return stabilityB - stabilityA;
        })[0] || recommended;
        const upside = clean.slice().sort((a, b) => {
            const upA = redraft ? a.score + (a.target ? 10 : 0) : a.growth + (a.target ? 450 : 0) + (ageOf(a.player) && ageOf(a.player) <= 24 ? 200 : 0);
            const upB = redraft ? b.score + (b.target ? 10 : 0) : b.growth + (b.target ? 450 : 0) + (ageOf(b.player) && ageOf(b.player) <= 24 ? 200 : 0);
            return upB - upA;
        })[0] || recommended;
        const cards = [
            card('recommended', 'Recommended', recommended, redraft ? 'Current-season value, roster fit and your board priorities.' : 'Best blend of board value, roster fit, and five-year value.', 'gold', {
                drivers: ['board_rank', recommended?.needBoost ? 'roster_need' : 'value', recommended?.target ? 'user_target' : 'projection'],
            }),
            card('safe', 'Safe Pick', safe, 'High-floor value that keeps the room honest.', 'green', {
                drivers: ['dhq_value', safe?.tier ? 'tier' : 'board_rank'],
            }),
            card('upside', redraft ? 'Priority Target' : 'Upside Swing', upside, redraft ? 'A current-season fit weighted toward your marked targets.' : upside?.growth > 0 ? 'Best five-year value gain in the current pocket.' : 'Best ceiling profile in this pocket.', 'purple', {
                drivers: ['y5_projection', upside?.target ? 'user_target' : 'age_curve'],
            }),
        ].filter(Boolean);

        // Avoid Warning: surface the most tempting (highest-score) player the user has
        // tagged fade / do-not-draft, drawn from the UNFILTERED rows.
        const faded = rows.filter(c => c.fade).sort((a, b) => b.score - a.score)[0];
        const avoidCard = faded ? card('avoid', 'Avoid Warning', faded, 'User-board fade or do-not-draft flag is active.', 'red', { drivers: ['user_board'] }) : null;
        if (avoidCard) cards.push(avoidCard);

        if (tradeWindow && !redraft) {
            cards.push({
                kind: 'trade_down',
                label: 'Trade Window',
                tone: tradeWindow.likelihood >= tradeWindow.acceptanceLine ? 'green' : 'amber',
                player: null,
                detail: tradeWindow.likelihood >= tradeWindow.acceptanceLine
                    ? `${tradeWindow.teamName || 'Owner'} · likely to deal (${tradeWindow.likelihood || 0}% to accept)`
                    : `${tradeWindow.teamName || 'Owner'} · unlikely to deal (${tradeWindow.likelihood || 0}% to accept)`,
                drivers: ['owner_trade_intel', 'board_tier', 'buyer_line'],
                action: 'trade',
                meta: { rosterId: tradeWindow.rosterId, tradeWindow },
            });
        }

        return cards.slice(0, 5);
    }

    function tierAlert(rows) {
        const first = rows.find(c => c.tier);
        if (!first) return null;
        const sameTier = rows.filter(c => String(c.tier) === String(first.tier));
        if (sameTier.length > 3) return null;
        return {
            type: 'tier_cliff',
            tone: sameTier.length <= 1 ? 'red' : 'amber',
            title: `Tier ${first.tier} cliff`,
            text: `${sameTier.length} player${sameTier.length === 1 ? '' : 's'} left in the top tier of this pocket.`,
        };
    }

    function targetSurvivalAlert(state, rows) {
        const next = nextUserPick(state);
        if (!next || next.picksAway <= 0) return null;
        const target = rows.find(c => c.target);
        if (!target) return null;
        if (target.rank > next.picksAway + 2) return null;
        return {
            type: 'target_survival',
            tone: 'red',
            title: 'Target at risk',
            text: `${target.player.name || 'Your target'} is unlikely to survive ${next.picksAway} pick${next.picksAway === 1 ? '' : 's'} to your next turn.`,
            player: target.player,
        };
    }

    function ownerAlert(state) {
        const persona = currentPersona(state);
        const intel = persona?.ownerIntel || state?.draftContext?.ownerContext?.[String(persona?.rosterId || '')] || null;
        const reason = asArray(intel?.reasonCodes)[0];
        if (!persona || !reason) return null;
        return {
            type: 'owner_tendency',
            tone: intel?.confidence?.overall === 'high' ? 'green' : 'amber',
            title: `${persona.teamName || 'On-clock owner'} tell`,
            text: reason.detail || reason.label || 'Historical owner intel is influencing this read.',
        };
    }

    function buildDecisionDeck(state, opts = {}) {
        const rows = candidates(state, 40);
        const next = nextUserPick(state);
        const currentSlot = asArray(state?.pickOrder)[num(state?.currentIdx, 0)] || null;
        const cards = pickCards(state, opts.tradeWindow || null);
        const alerts = [tierAlert(rows), targetSurvivalAlert(state, rows), ownerAlert(state)].filter(Boolean).slice(0, 3);
        return {
            schemaVersion: SCHEMA,
            mode: state?.mode || '',
            seasonal: isRedraftLive(state),
            rosterPlan: buildRosterPlan(state),
            currentPick: currentSlot,
            nextUserPick: next,
            cards,
            alerts,
            assumptions: {
                boardLane: activeLane(state?.draftContext?.boardContext || {}),
                poolSize: asArray(state?.pool).length,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    // A forward-looking read for the Alex Live Read panel: who is likely still
    // available at the user's next pick, plus an outlier worth trading up for.
    function buildLiveReadout(state) {
        const next = nextUserPick(state);
        if (!next || !next.slot) return null;
        if (isRedraftLive(state)) {
            const read = buildRedraftRoomRead(state);
            if (!read.fullHorizon || read.isAuction) return null;
            const teams = Math.max(1, num(state.leagueSize, 1));
            const pick = num(next.slot.pickInRound) || ((num(next.slot.overall, 1) - 1) % teams) + 1;
            return { pickLabel: 'R' + next.slot.round + '.' + String(pick).padStart(2, '0'), picksAway: next.picksAway,
                available: read.survivors.map(p => ({ name: p.name, pos: posOf(p), dhq: p.dhq })), outlier: null };
        }
        const picksAway = num(next.picksAway, 0);
        const rows = candidates(state, 60).filter(c => !c.fade);
        if (!rows.length) return null;
        const nm = c => c.player?.name || c.player?.full_name || c.player?.pid || 'Player';
        const ps = c => posOf(c.player) || '';
        const slot = next.slot;
        // Universal round.pick-in-round label — slot.slot is the team column, so
        // derive from overall for saved drafts that predate pickInRound.
        const teams = num(state?.leagueSize, 0);
        const pp = num(slot.pickInRound, 0)
            || (teams > 0 && num(slot.overall, 0) > 0 ? ((num(slot.overall, 0) - 1) % teams) + 1 : num(slot.slot, 0));
        const pickLabel = 'R' + (slot.round || '?') + '.' + String(pp || 0).padStart(2, '0');
        // Heuristic: the ~picksAway top-ranked players are likely gone before our turn.
        const survivors = rows.filter(c => c.rank > picksAway + 1);
        const gone = rows.filter(c => c.rank <= picksAway);
        const pool = survivors.length ? survivors : rows;
        const available = pool.slice(0, 3).map(c => ({ name: nm(c), pos: ps(c), dhq: c.dhq, tier: c.tier }));
        // Outlier: a clearly-superior player projected gone before our pick — a
        // tier or sizeable value jump over the best expected survivor.
        let outlier = null;
        if (picksAway > 0) {
            const bestSurv = survivors[0] || null;
            const topGone = gone.slice().sort((a, b) => b.dhq - a.dhq)[0] || null;
            if (topGone) {
                const tierJump = !!(topGone.tier && bestSurv?.tier && (bestSurv.tier - topGone.tier >= 2));
                const valueJump = !bestSurv || topGone.dhq > bestSurv.dhq * 1.18;
                if (tierJump || valueJump) {
                    outlier = { name: nm(topGone), pos: ps(topGone), dhq: topGone.dhq, tier: topGone.tier };
                }
            }
        }
        return { pickLabel, picksAway, available, outlier };
    }

    // Lightweight, pure signals for the Alex live commentary stream. Returns a
    // bundle the stream effect can dedupe + narrate without any model calls:
    //   tierBreak  — a positional tier that just emptied to its last man (uses
    //                the same tierAlert() cliff logic, surfaced per position).
    //   valueCliff — the steepest DHQ drop-off among the top available players.
    //   needTension— the user's top roster need vs. the board's best-player-available.
    function liveStreamSignals(state) {
        const rows = candidates(state, 48).filter(c => !c.fade);
        const out = { tierBreak: null, valueCliff: null, needTension: null };
        if (!rows.length) return out;
        const nm = c => c.player?.name || c.player?.full_name || c.player?.pid || 'Player';
        const ps = c => posOf(c.player) || '';

        // ── Tier break: a position whose remaining top tier is down to its last
        // player. Reuse tierAlert() over the position's own pocket so the wording
        // and the <=1 cliff threshold stay consistent.
        const byPos = {};
        rows.forEach(c => {
            const pos = ps(c);
            if (!pos) return;
            (byPos[pos] = byPos[pos] || []).push(c);
        });
        let tierBreak = null;
        Object.keys(byPos).forEach(pos => {
            const alert = tierAlert(byPos[pos]);
            if (!alert) return;
            const topTier = byPos[pos].find(c => c.tier);
            const tier = topTier?.tier || null;
            const lastMan = byPos[pos].filter(c => String(c.tier) === String(tier));
            // Only the genuine cliffs (one or zero left in the pocket's top tier).
            if (lastMan.length > 1) return;
            const survivor = byPos[pos][lastMan.length] || null;
            if (!tierBreak || (tier && (!tierBreak.tier || tier < tierBreak.tier))) {
                tierBreak = {
                    pos,
                    tier,
                    lastPlayer: lastMan[0] ? nm(lastMan[0]) : null,
                    nextPlayer: survivor ? nm(survivor) : null,
                    nextTier: survivor?.tier || null,
                };
            }
        });
        out.tierBreak = tierBreak;

        // ── Value cliff: biggest DHQ drop-off between consecutive top-board
        // players. Steep = the gap exceeds ~22% of the higher player's DHQ.
        const top = rows.slice(0, 14);
        let cliff = null;
        for (let i = 0; i < top.length - 1; i++) {
            const a = top[i], b = top[i + 1];
            const dropAbs = num(a.dhq) - num(b.dhq);
            const dropPct = a.dhq ? dropAbs / a.dhq : 0;
            if (dropAbs <= 0) continue;
            if (!cliff || dropPct > cliff.dropPct) {
                cliff = {
                    afterPlayer: nm(a),
                    afterPos: ps(a),
                    afterDhq: Math.round(num(a.dhq)),
                    nextPlayer: nm(b),
                    nextDhq: Math.round(num(b.dhq)),
                    dropAbs: Math.round(dropAbs),
                    dropPct,
                    index: i,
                };
            }
        }
        // Only surface a steep, early cliff (top of the board, >= 22% gap).
        if (cliff && cliff.dropPct >= 0.22 && cliff.index <= 6) out.valueCliff = cliff;

        // ── Need vs. BPA: the user's most urgent need pocket vs. the absolute
        // best player available. Tension when the BPA is off-need but the need
        // is real and the on-need option is a clear step down.
        const needs = userNeedMap(state);
        const needPositions = Object.keys(needs).sort((a, b) => needs[b] - needs[a]);
        const topNeed = needPositions[0];
        if (topNeed) {
            const bpa = rows[0];
            const bpaPos = ps(bpa);
            if (bpa && bpaPos && bpaPos !== topNeed) {
                const onNeed = rows.find(c => ps(c) === topNeed);
                const gap = onNeed ? num(bpa.dhq) - num(onNeed.dhq) : null;
                out.needTension = {
                    needPos: topNeed,
                    bpaName: nm(bpa),
                    bpaPos,
                    onNeedName: onNeed ? nm(onNeed) : null,
                    gap: gap == null ? null : Math.round(gap),
                    urgent: needs[topNeed] >= 22,
                };
            }
        }

        return out;
    }

    // ── Mid-draft trade-evolution signal (rule-based, NO model spend) ──────
    // Buckets state.completedTrades by draft round and compares the per-round and
    // whole-draft trade rate against an EXPECTED baseline derived from the tuning
    // knob (state.draftTuning.tradeActivity, 0-100). Classifies 'heavy'/'typical'/'quiet'.
    // acceptedAt is state.currentIdx — a 0-based pick index; round = floor(idx/size)+1.
    // In live-sync mode completedTrades is empty (read-only), so this is inert there.
    function liveTradeEvolutionSignal(state) {
        const leagueSize = Math.max(1, num(state?.leagueSize, 12));
        const rounds = Math.max(1, num(state?.rounds, 5));
        const trades = asArray(state?.completedTrades);
        const tradedRounds = Math.max(1, Math.floor(num(state?.currentIdx, 0) / leagueSize) + 1);

        const activityRaw = Number(state?.draftTuning?.tradeActivity);
        const activity = Number.isFinite(activityRaw) ? Math.max(0, Math.min(100, activityRaw)) : 50;
        const expectedPerRound = Math.max(0, (0.2 + activity * 0.008));

        const byRound = {};
        let counted = 0;
        trades.forEach(t => {
            const idx = num(t?.acceptedAt, NaN);
            if (!Number.isFinite(idx) || idx < 0) return;
            const round = Math.floor(idx / leagueSize) + 1;
            byRound[round] = (byRound[round] || 0) + 1;
            counted++;
        });

        const total = counted;
        const overallRate = total / tradedRounds;
        const currentRound = Math.min(rounds, Math.floor(num(state?.currentIdx, 0) / leagueSize) + 1);
        const currentRoundCount = byRound[currentRound] || 0;

        const classify = (count, perRoundExpect, roundsSeen) => {
            const expect = Math.max(0.0001, perRoundExpect * Math.max(1, roundsSeen));
            if (count >= Math.max(2, expect * 1.6)) return 'heavy';
            if (roundsSeen >= 2 && count <= expect * 0.4) return 'quiet';
            return 'typical';
        };

        return {
            schemaVersion: SCHEMA,
            leagueSize,
            rounds,
            totalTrades: total,
            tradedRounds,
            currentRound,
            currentRoundCount,
            byRound,
            expectedPerRound: Math.round(expectedPerRound * 100) / 100,
            overallRate: Math.round(overallRate * 100) / 100,
            roundClass: classify(currentRoundCount, expectedPerRound, 1),
            draftClass: classify(total, expectedPerRound, tradedRounds),
            activity,
        };
    }

    // Scout-free gate at the engine seam: every export here is an interpretive
    // read (decision deck recs, predicted-available, tier-break/value-cliff/
    // need-tension advice, trade-evolution narration) → Pro. Gating here covers
    // all consumers (command-center memos + LiveCommandHeader + stream effects)
    // with one seam. Fail-open when pro-gate.js isn't loaded; callers already
    // handle null/{} (their normal "no signal" shape).
    const _ldePro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const _gateNull = fn => function () { return _ldePro() ? fn.apply(null, arguments) : null; };

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.liveDecisionEngine = {
        isRedraftLive,
        lineupFit,
        buildRosterPlan,
        predictionScorecard,
        lockRedraftForecast: state => _ldePro() ? lockRedraftForecast(state) : state,
        buildRedraftRoomRead: _gateNull(buildRedraftRoomRead),
        buildDecisionDeck: _gateNull(buildDecisionDeck),
        buildLiveReadout: _gateNull(buildLiveReadout),
        liveStreamSignals: function () { return _ldePro() ? liveStreamSignals.apply(null, arguments) : {}; },
        liveTradeEvolutionSignal: _gateNull(liveTradeEvolutionSignal),
        tierAlert: _gateNull(tierAlert),
        _private: {
            candidates,
            nextUserPick,
            projectedValue,
            isFade,
            isTarget,
        },
    };
})();
