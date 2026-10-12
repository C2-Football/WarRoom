// Owner scouting derived only from the league evidence supplied by the caller.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const types = {
        NONE: { label: '— Not Set —', color: 'var(--silver)', desc: '', taxes: [] },
        FLEECER: { label: 'The Fleecer', color: 'var(--k-e74c3c, #e74c3c)', desc: 'High activity, always hunting asymmetric value. Sends lowball offers constantly. Sharp but impatient — will counter-offer if you decline.', strategy: 'Lead with clean surplus. They respect boldness, but the math still moves linearly.', taxes: ['Endowment -5%', 'Surplus hunter'] },
        DOMINATOR: { label: 'The Dominator', color: 'var(--k-e67e22, #e67e22)', desc: 'High ego, requires visible surplus to pull the trigger. Motivated by status and bragging rights above all else.', strategy: 'Frame your offer as giving them the "better" side. Let them feel like they won.', taxes: ['Status Tax -18%', 'Endowment -14%', 'Loss Aversion -8%'] },
        STALWART: { label: 'The Stalwart', color: 'var(--k-5dade2, #5dade2)', desc: 'High stability, emotionally attached to their roster. Slow to move but reliable when they engage.', strategy: 'Lead with clear value. Never low-ball. Highlight how the trade improves both sides.', taxes: ['Endowment -10%', 'Loss Aversion -8%'] },
        ACCEPTOR: { label: 'The Acceptor', color: 'var(--k-2ecc71, #2ecc71)', desc: 'Low attachment, willing to sell current assets for future picks and young players. Rebuilding or just indifferent.', strategy: 'Offer future assets (picks, young upside). They discount current stars through the tax layer.', taxes: ['Rebuilding Discount +10%', 'Endowment -3%'] },
        DESPERATE: { label: 'The Desperate', color: 'var(--k-bb8fce, #bb8fce)', desc: 'High urgency triggered by injuries, bye-weeks, or playoff push. Will overpay for an immediate starter.', strategy: 'Identify their empty slot or injury. Strike fast — desperation fades after their bye.', taxes: ['Panic Premium +14% to +26%', 'Endowment -8%'] },
    };

    function number(value) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function rosterIds(trade) {
        const ids = Array.isArray(trade?.roster_ids) ? trade.roster_ids : Object.keys(trade?.sides || {});
        return [...new Set(ids.filter(id => id !== null && id !== undefined && String(id)).map(String))];
    }

    function completedTrades(intel) {
        return (Array.isArray(intel?.tradeHistory) ? intel.tradeHistory : []).filter(trade => {
            if (!trade || trade.completed === false || trade.is_completed === false) return false;
            if (trade.type && String(trade.type).toLowerCase() !== 'trade') return false;
            // The normalized league ledger omits status after selecting completed trades.
            if (trade.status === null || trade.status === undefined || trade.status === '') return true;
            return ['complete', 'completed', 'accepted', 'processed', 'final'].includes(String(trade.status).toLowerCase());
        });
    }

    function infer(options = {}) {
        const { rosterId, intel = {}, rosters = [] } = options;
        if (rosterId === null || rosterId === undefined || String(rosterId) === '') return null;
        const rid = String(rosterId);
        const allTrades = completedTrades(intel);
        const profile = intel.ownerProfiles?.[rid] || {};
        const trades = allTrades.filter(trade => rosterIds(trade).includes(rid));
        if (trades.length < 2) return null;
        const scores = { FLEECER: 0, DOMINATOR: 0, STALWART: 0, ACCEPTOR: 0, DESPERATE: 0 };
        const signals = [];

        const leagueSize = Math.max(1, intel.rosters?.length || rosters.length || 10);
        const avgTrades = allTrades.length / leagueSize;
        if (avgTrades > 0) {
            const ratio = trades.length / avgTrades;
            if (ratio < 0.5) { scores.STALWART += 4; signals.push('Low trade activity'); }
            else if (ratio > 1.75) { scores.FLEECER += 3; signals.push('High trade volume'); }
        }

        const won = number(profile.tradesWon) ?? 0;
        const lost = number(profile.tradesLost) ?? 0;
        const fair = number(profile.tradesFair) ?? 0;
        const totalGraded = won + lost + fair;
        if (totalGraded >= 2) {
            const winRate = won / totalGraded;
            const lossRate = lost / totalGraded;
            const fairRate = fair / totalGraded;
            if (winRate > 0.55) { scores.FLEECER += Math.round(winRate * 6); signals.push(`Wins ${Math.round(winRate * 100)}% of trades`); }
            if (lossRate > 0.45) { scores.ACCEPTOR += 2; scores.DESPERATE += 2; signals.push(`Loses ${Math.round(lossRate * 100)}% of trades`); }
            if (fairRate > 0.55) { scores.STALWART += 2; signals.push('Prefers balanced deals'); }
        }

        const avgDiff = number(profile.avgValueDiff);
        if (avgDiff !== null) {
            if (avgDiff > 400) { scores.FLEECER += 4; signals.push(`Avg +${Math.round(avgDiff)} DHQ/trade`); }
            else if (avgDiff > 100) { scores.DOMINATOR += 2; signals.push(`Avg +${Math.round(avgDiff)} DHQ/trade`); }
            else if (avgDiff < -300) { scores.DESPERATE += 3; scores.ACCEPTOR += 1; signals.push(`Avg ${Math.round(avgDiff)} DHQ/trade`); }
            else if (Math.abs(avgDiff) <= 150) { scores.STALWART += 2; signals.push('Balanced trade value'); }
        }

        let picksReceived = 0, picksSent = 0, elitePlayersSent = 0, elitePlayersReceived = 0, lateSeasonLosses = 0;
        for (const trade of trades) {
            const mySide = trade.sides?.[rid] || {};
            const otherRid = rosterIds(trade).find(id => id !== rid);
            const theirSide = trade.sides?.[otherRid] || {};
            const myValue = number(mySide.totalValue);
            const theirValue = number(theirSide.totalValue);
            picksReceived += (mySide.picks || []).length;
            picksSent += (theirSide.picks || []).length;
            for (const pid of (theirSide.players || [])) if ((number(intel.playerScores?.[pid]) ?? 0) > 5000) elitePlayersSent++;
            for (const pid of (mySide.players || [])) if ((number(intel.playerScores?.[pid]) ?? 0) > 5000) elitePlayersReceived++;
            if ((number(trade.week) ?? 0) >= 10 && myValue !== null && theirValue !== null && theirValue > myValue * 1.15) lateSeasonLosses++;
        }
        if (picksSent > 1 && picksReceived < picksSent * 0.7) { scores.DOMINATOR += 3; signals.push('Trades picks for players (win-now)'); }
        if (picksReceived > 1 && picksSent < picksReceived * 0.7) { scores.ACCEPTOR += 3; signals.push('Trades players for picks'); }
        if (elitePlayersSent >= 2 && elitePlayersSent > elitePlayersReceived) { scores.DESPERATE += 4; signals.push(`Sold ${elitePlayersSent} elite players`); }
        if (elitePlayersReceived >= 2 && elitePlayersReceived > elitePlayersSent) { scores.FLEECER += 3; signals.push(`Acquired ${elitePlayersReceived} elite players`); }
        if (lateSeasonLosses >= 2) { scores.DESPERATE += 3; signals.push(`${lateSeasonLosses} late-season panic trades`); }

        const ranked = Object.entries(scores).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
        if (!ranked.length || ranked[0][1] < 3) return null;
        const [top, second] = ranked;
        const totalScore = ranked.reduce((sum, [, value]) => sum + value, 0);
        const dominance = second ? (top[1] - second[1]) / top[1] : 1;
        const confidence = Math.min(92, Math.round((top[1] / totalScore * 0.6 + dominance * 0.4) * 100));
        if (confidence < 22) return null;
        return { key: top[0], confidence, reasoning: signals.slice(0, 4).join(' · ') || 'Based on trade patterns' };
    }

    function read(options = {}) {
        const { roster = {}, assessment = {}, league = {}, intel = {} } = options;
        const rosterId = roster.roster_id ?? assessment.rosterId;
        const ownerId = roster.owner_id ?? assessment.ownerId;
        const ownerName = options.ownerName || assessment.ownerName || 'This owner';
        const tradeHistory = completedTrades(intel);
        const tradeCount = rosterId === null || rosterId === undefined ? 0
            : tradeHistory.filter(trade => rosterIds(trade).includes(String(rosterId))).length;
        const saved = typeof options.savedDna === 'string' ? { key: options.savedDna } : options.savedDna;
        const validSaved = !!saved && Object.prototype.hasOwnProperty.call(types, saved.key);
        const derived = validSaved ? null : infer({ rosterId, intel, rosters: league.rosters || [] });
        const key = validSaved ? saved.key : derived?.key || 'NONE';
        const metadata = types[key];
        const source = validSaved ? 'saved' : derived ? 'derived' : 'none';
        const thin = tradeCount < 2;
        const sampleCopy = tradeCount === 0 ? 'No completed trades are on file for this owner.'
            : tradeCount === 1 ? 'Only 1 completed trade is on file; that is too little history to infer an owner style.'
                : `${tradeCount} completed trades are on file; no clear owner DNA pattern stands out.`;
        const neutralApproach = 'Lead with a clear roster need and fair value; there is not enough evidence to predict this owner’s response.';
        const reasoning = validSaved ? (saved.reasoning || (key === 'NONE' ? 'Owner DNA is intentionally unset.' : 'Saved owner DNA.'))
            : derived?.reasoning || sampleCopy;
        const result = {
            key, label: metadata.label, color: metadata.color, source,
            confidence: validSaved ? number(saved.confidence) : derived?.confidence ?? null,
            reasoning, tradeCount,
            facts: [{ code: 'trade_volume', label: 'Completed trades', detail: thin ? sampleCopy : `${tradeCount} completed trades on file.`, value: tradeCount, source: 'tradeHistory' }],
            approach: thin ? neutralApproach : metadata.strategy || 'Use roster need and value clarity; no strong behavioral constraint dominates.',
        };
        if (thin) return result;

        const intelligence = options.intelligence || App.Intelligence;
        if (typeof intelligence?.buildLeagueBehaviorBaselines !== 'function' || typeof intelligence?.buildOwnerBehaviorProfile !== 'function') return result;
        // Explicit empty collections prevent the shared builders from falling back
        // to another league's global LI data while this league is loading.
        const ownerProfiles = Object.fromEntries(Object.entries(intel.ownerProfiles || {}).map(([rid, profile]) => [rid, {
            ...profile, trades: tradeHistory.filter(trade => rosterIds(trade).includes(String(rid))).length,
        }]));
        const ownerProfile = { ...(ownerProfiles[String(rosterId)] || {}), trades: tradeCount };
        const inputs = {
            league, rosters: intel.rosters || league.rosters || [], ownerProfiles, tradeHistory,
            draftOutcomes: Array.isArray(intel.draftOutcomes) ? intel.draftOutcomes : [],
            faabTxns: Array.isArray(intel.faabTxns) ? intel.faabTxns : [],
        };
        const baselines = intelligence.buildLeagueBehaviorBaselines(inputs);
        const behavior = intelligence.buildOwnerBehaviorProfile({
            ...inputs, rosterId, ownerId, ownerName, assessment, ownerProfile, baselines,
            dnaKey: key, dnaLabel: metadata.label, manualDna: validSaved,
        });
        const knownGrade = number(ownerProfile.avgValueDiff) !== null;
        const facts = (behavior?.observedFacts || []).filter(fact => fact && typeof fact.detail === 'string'
            && (fact.code !== 'trade_value' || knownGrade));
        if (facts.length) result.facts = facts;
        if (typeof behavior?.strategy?.offerFrame === 'string' && behavior.strategy.offerFrame.trim()) result.approach = behavior.strategy.offerFrame;
        return result;
    }

    App.OwnerScouting = { types, infer, read };
    if (typeof module !== 'undefined' && module.exports) module.exports = App.OwnerScouting;
})(typeof window !== 'undefined' ? window : globalThis);
