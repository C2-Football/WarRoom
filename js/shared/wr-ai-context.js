// ══════════════════════════════════════════════════════════════════
// wr-ai-context.js — WarRoom-owned AI context helpers
//
// Two jobs:
//   1. WR.AIContext — close the ReconAI consistency gap. Calls that stay on
//      the generic dhqAI path are blind to league format and quality gates
//      (see RECONAI-CONSISTENCY-REPORT.md). buildFormatPreamble() produces a
//      compact client-side mirror of the edge function's format + quality
//      blocks to prepend to those context strings. buildStructuredBase()
//      shapes the base payload for structured OD.callAI types
//      (team_diagnosis / insight / dashboard_digest), including the
//      stateHash that keys the server response cache.
//   2. WR.AIFeedback — the learning-loop capture point. Fire-and-forget
//      thumbs/acted signals to the ai-feedback edge function via the shared
//      Supabase client. Fails silently: feedback must never break UX.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    function detectFormat(league) {
        const rp = league?.roster_positions || league?.rosterPositions || [];
        const scoring = league?.scoring_settings || league?.scoringSettings || {};
        const sfSlots = rp.filter(s => s === 'SUPER_FLEX').length;
        const idpSlots = rp.filter(s => ['IDP_FLEX', 'DL', 'LB', 'DB', 'DE', 'CB', 'S'].includes(s)).length;
        const recBonus = scoring.rec || 0;
        const teBonus = scoring.bonus_rec_te || scoring.rec_te || 0;
        return {
            isSuperFlex: sfSlots > 0,
            numQBSlots: rp.filter(s => s === 'QB').length + sfSlots,
            isTEP: teBonus > 0,
            tePremiumBonus: teBonus,
            isIDP: idpSlots > 0,
            idpSlots,
            numRBSlots: rp.filter(s => s === 'RB').length,
            scoringType: recBonus >= 1 ? 'ppr' : recBonus >= 0.5 ? 'half_ppr' : recBonus > 0 ? 'custom' : 'std',
        };
    }

    // Never infer retention rules from roster strength or dynasty scores.
    function keeperRules(league) {
        const candidates = [league?.settings?.max_keepers, league?.settings?.keeper_count, league?.metadata?.keeper_count];
        const raw = candidates.find(v => v !== null && v !== undefined && v !== '');
        const n = Number(raw);
        return { slots: raw !== undefined && Number.isInteger(n) && n >= 0 ? n : null,
            costsKnown: false, eligibilityKnown: false,
            valuationBasis: 'Uncalibrated 60% dynasty / 40% rest-of-season blend; not keeper surplus or next-season projection' };
    }

    function decisionContext(league) {
        const override = window.App?.Intelligence?.getLeagueTypeOverride?.(league);
        const resolved = window.App?.LeagueSkin?.build?.({ league });
        const raw = league?.type ?? league?.league_type ?? league?.settings?.type ?? league?.metadata?.type;
        const normalized = ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' })[raw] || String(raw || '').toLowerCase();
        const detected = override || resolved?.type || normalized;
        const leagueType = ['redraft', 'keeper', 'dynasty', 'chopped', 'best_ball'].includes(detected) ? detected : 'unknown';
        return {
            version: 2, leagueId: league?.league_id || league?.id || null,
            leagueType, season: league?.season || null,
            week: window.S?.nflState?.display_week ?? window.S?.nflState?.week ?? null,
            rosterPositions: league?.roster_positions || league?.rosterPositions || [],
            scoringSettings: league?.scoring_settings || league?.scoringSettings || {},
            canTrade: leagueType !== 'chopped' && Number(league?.settings?.disable_trades || 0) !== 1,
            keeperRules: leagueType === 'keeper' ? keeperRules(league) : null,
        };
    }

    function buildFormatPreamble(league) {
        const fmt = detectFormat(league);
        const context = decisionContext(league);
        const lines = ['Decision context: ' + JSON.stringify(context)];
        if (context.leagueType === 'redraft') lines.push('REDRAFT: optimize this week and the remaining fantasy season. Do not recommend multi-year rebuilds, youth stashes for future seasons, or future rookie picks. Separate immediate lineup benefit from rest-of-season value.');
        else if (context.leagueType === 'keeper') lines.push('KEEPER: separate winning this season from next-season retention. Keeper decisions need slot count, player eligibility, round/salary cost, escalation and alternatives. Unknown costs are not free. A blended player score is only a shortlist signal, not a final keep/cut verdict.');
        else if (context.leagueType === 'chopped') lines.push('CHOPPED: prioritize surviving the next elimination and waiver opportunities. No trades, future picks or rebuilding.');
        else if (context.leagueType === 'best_ball') lines.push('BEST BALL: automatic scoring; do not suggest manual start/sit changes. Confirm transaction rules before suggesting moves.');
        else if (context.leagueType === 'unknown') lines.push('League retention format is unknown. Do not assume dynasty; ask for the format when it changes the answer.');
        if (!context.canTrade) lines.push('Trades are disabled: do not propose trades.');
        if (fmt.numQBSlots > 1) lines.push(`${fmt.numQBSlots} QB-eligible slots: compare available starters and alternatives. No fixed scarcity multiplier or automatic priority overriding actual needs.`);
        if (fmt.isTEP) lines.push(`TE receiving bonus: ${fmt.tePremiumBonus}. Use the supplied league-scored values; do not add a second arbitrary premium.`);
        lines.push('EVIDENCE: Use supplied statistics and dated sources. Missing projections, injury updates, ownership, lineup locks, keeper costs or budgets are unknown, not zero. Do not claim live news without retrieved evidence. Do not invent availability, bids or acceptance probabilities.');
        lines.push('WAIVERS: compare legal available adds to the actual drop and starting alternatives, scoring, role, roster depth and remaining budget. No universal DHQ/PPG/age cutoff; useful streamers and role changes can have low historical scores. Recommend holding when no supported improvement exists.');
        lines.push('ANSWER: lead with the decision, its evidence and the main tradeoff. Label estimates and the specific missing fact that could change the call. Respect the requested response format.');
        return '--- LEAGUE DECISION RULES ---\n' + lines.join('\n') + '\n';
    }

    // Cheap stable hash (djb2) — keys the localStorage + server caches to the
    // league's current state. The server re-hashes the full context anyway.
    function hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function stateHashFor(league, roster, extra) {
        const parts = [
            league?.league_id || league?.id || '',
            (roster?.players || []).slice().sort().join(','),
            roster?.settings ? `${roster.settings.wins}-${roster.settings.losses}` : '',
            window.S?.nflState?.week || '',
            JSON.stringify(decisionContext(league)),
            JSON.stringify(roster?.starters || []),
            JSON.stringify(roster?.reserve || []),
            JSON.stringify(roster?.waiver_budget_used ?? roster?.settings?.waiver_budget_used ?? null),
            extra || '',
        ];
        return hashString(parts.join('|'));
    }

    // Base payload for structured OD.callAI types. The edge function's
    // detectLeagueFormat/buildTeamModeBlock read exactly these field names.
    function buildStructuredBase(league, assessment, roster) {
        // GM Strategy — the canonical serialized plan (WR.GmMode.promptBlock):
        // mode directive, timeline, floor, postures, positions, sell rules,
        // untouchable names. '' when no strategy is saved / gm-mode not loaded.
        // The edge function reads ctx.gmStrategy (team_diagnosis + insight).
        // Folded into stateHash so a strategy edit busts the response caches.
        let gmStrategy = '';
        try {
            gmStrategy = window.WR?.GmMode?.promptBlock?.(league?.league_id || league?.id) || '';
        } catch (e) { /* gm-mode optional */ }
        return {
            leagueId: league?.league_id || league?.id || null,
            leagueName: league?.name || '',
            decisionContext: decisionContext(league),
            leagueType: decisionContext(league).leagueType,
            rosterPositions: league?.roster_positions || [],
            roster_positions: league?.roster_positions || [],
            scoringSettings: league?.scoring_settings || {},
            scoring_settings: league?.scoring_settings || {},
            teamTier: assessment?.tier || '',
            teamWindow: assessment?.window || assessment?.tradeWindow || '',
            healthScore: assessment?.healthScore || 0,
            gmStrategy,
            stateHash: stateHashFor(league, roster, gmStrategy),
        };
    }

    window.WR.AIContext = { detectFormat, keeperRules, decisionContext, buildFormatPreamble, buildStructuredBase, stateHashFor };

    // ── Learning-loop feedback capture ────────────────────────────────
    const _sentKeys = new Set();

    async function send(args) {
        try {
            const { leagueId, surface, recId, action, subject } = args || {};
            if (!surface || !recId || !action) return false;
            const key = `${surface}|${recId}|${action}`;
            if (_sentKeys.has(key)) return true; // session-level dedupe
            const client = window.OD && typeof window.OD.getClient === 'function' ? window.OD.getClient() : null;
            if (!client || !client.functions || typeof client.functions.invoke !== 'function') return false;
            _sentKeys.add(key);
            const { error } = await client.functions.invoke('ai-feedback', {
                body: { leagueId: leagueId || null, surface, recId: String(recId).slice(0, 200), action, subject: subject || null },
            });
            if (error) { _sentKeys.delete(key); return false; }
            return true;
        } catch (e) {
            return false;
        }
    }

    window.WR.AIFeedback = { send };
})();
