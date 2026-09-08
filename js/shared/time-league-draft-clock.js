// A presentation-independent draft driver. The engine still validates every
// action, and online deadlines are checked again against the server's clock.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const settledAuction = new WeakMap();
    function nextAction(league, cards, now, revealReady = true) {
        if (!league || league.phase !== 'draft' || !revealReady || !cards?.size || league.draftClock?.status !== 'running') return null;
        const stamp = typeof now === 'number' ? now : Date.parse(now);
        if (!Number.isFinite(stamp)) return null;
        const deadline = Date.parse(league.draftClock.deadlineAt);
        if (Number.isFinite(deadline) && stamp >= deadline) return { type: 'draft-timeout' };
        const started = Date.parse(league.draftClock.startedAt);
        const lastAi = Date.parse(league.draftAuction?.lastAiAt);
        const due = Math.max(Number.isFinite(started) ? started : stamp, Number.isFinite(lastAi) ? lastAi : 0) + (league.settings.draftAiSeconds ?? 2) * 1000;
        if (stamp < due) return null;
        if (league.settings.draftFormat === 'auction') {
            // Public snapshots intentionally omit private randomness and drawn
            // editions. Let the server evaluate bids against canonical state.
            if (league.publicSnapshotVersion === 1) {
                if (!league.draftAuction?.nomination) {
                    const seat = App.TimeLeagueEngine.currentDraftSeat(league);
                    if (league.teams.find(team => team.teamId === seat?.teamId)?.manager !== 'ai') return null;
                }
                return league.draftAutomation?.auctionPending === true ? { type: 'auction-ai-step' } : null;
            }
            if (settledAuction.get(league) === cards) return null;
            const next = App.TimeLeagueAI.aiAuctionStep(league, cards, new Date(stamp).toISOString());
            if (next === league) settledAuction.set(league, cards);
            return next !== league ? { type: 'auction-ai-step' } : null;
        }
        const seat = App.TimeLeagueEngine.currentDraftSeat(league);
        if (league.teams.find(team => team.teamId === seat?.teamId)?.manager !== 'ai') return null;
        return { type: 'draft-ai-step' };
    }
    App.TimeLeagueDraftClock = { nextAction };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.TimeLeagueDraftClock;
})(typeof window !== 'undefined' ? window : globalThis);
