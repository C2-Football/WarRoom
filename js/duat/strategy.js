/* global module, require */
(function (root) {
    'use strict';
    const App = root.App = root.App || {}, common = typeof module !== 'undefined' && module.exports;
    const Rules = common ? require('./rules.js') : App.DuatRules;
    if (common && !App.DuatPersonalities) App.DuatPersonalities = require('./personalities.js');
    const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
    function forFaction(state, factionId, options = {}) {
        const fields = state.settings || {}, field = fields.playoffTeams || 7;
        const regular = state.calendarVersion === 2 ? 17 - Math.ceil(Math.log2(field)) : 14;
        const limit = Math.min(options.throughWeek ?? Infinity, Math.max(0, (state.week || 1) - 1));
        const weeks = (state.completedWeeks || []).filter(row => row.week <= limit && row.week <= regular && row.finalized !== false);
        const rows = (state.factions || []).map(f => ({ id: f.id, wins: 0, points: 0 }));
        for (const week of weeks) for (const own of rows) {
            const result = (week.factions || []).find(f => f.factionId === own.id);
            if (!result || !Number.isFinite(result.total)) continue;
            own.points += result.total;
            for (const other of week.factions) if (other.factionId !== own.id && Number.isFinite(other.total)) own.wins += result.total > other.total ? 1 : result.total === other.total ? .5 : 0;
        }
        rows.sort((a, b) => b.wins - a.wins || b.points - a.points || a.id.localeCompare(b.id));
        const rank = rows.findIndex(row => row.id === factionId) + 1, own = rows[rank - 1];
        const completed = Math.max(0, ...weeks.map(row => row.week)), remaining = Math.max(0, regular - completed);
        const edge = rank <= field ? rows[field] : rows[field - 1], margin = own && edge ? own.wins - edge.wins : 0;
        const oneWeek = Math.max(1, rows.length - 1), capacity = remaining * oneWeek;
        let status = 'building', label = 'Learning the field', urgency = .2;
        let reason = 'Early revealed games are building the picture.';
        if (own && completed >= 3) {
            if (!remaining) {
                status = rank <= field ? 'playoffs' : 'legacy'; urgency = rank <= field ? .95 : .35;
                label = rank <= field ? 'The Heavenly Battle' : 'Protecting the dynasty';
                reason = rank <= field ? `The regular-season field is set; seed ${rank}.` : 'The playoff field is set. Alliance results, territory and the dynasty still matter.';
            } else if (rows.filter(row => row.id !== factionId && row.wins > own.wins + capacity).length >= field) {
                status = 'legacy'; label = 'Protecting the dynasty'; urgency = .35;
                reason = 'The remaining all-play games cannot close the gap. The faction still has alliance and dynasty interests.';
            } else if (rows.filter(row => row.id !== factionId && row.wins + capacity >= own.wins).length < field) {
                status = 'secured'; label = 'Place secured'; urgency = .25;
                reason = `The all-play cushion secures a place. ${remaining} regular-season weeks remain to protect resources and improve seeding.`;
            } else if (rank > field) {
                status = 'chasing'; label = 'Chasing the field'; urgency = clamp(.4 + .5 * completed / regular, .4, .95);
                reason = `${Math.abs(margin)} all-play win credits behind the cutoff; ${remaining} regular-season weeks remain.`;
            } else if (margin <= oneWeek) {
                status = 'bubble'; label = 'Defending a narrow place'; urgency = .35 + .5 * completed / regular;
                reason = `${margin} all-play win credits above the first faction outside; ${remaining} regular-season weeks remain.`;
            } else {
                status = 'contender'; label = 'Protecting a strong position'; urgency = .3;
                reason = `${margin} all-play win credits above the first faction outside. The place is not secured yet.`;
            }
        }
        if (state.phase === 'complete' && limit >= 17) {
            status = state.championId === factionId ? 'champion' : 'complete'; urgency = 0;
            label = status === 'champion' ? 'Lord of the Duat' : 'Dynasty season complete';
            reason = 'The final battle is in the record. The next dynasty will begin a new campaign.';
        }
        return { status, label, reason, urgency, rank: own ? rank : null, completedWeeks: completed, remainingWeeks: remaining, cutoffMargin: margin };
    }
    function favorPlan(state, faction, ranked) {
        if (!Rules.SACRED_WEEKS.includes(state.week)) return [];
        const profile = App.DuatPersonalities?.profileFor(faction);
        const traits = profile?.decisionTraits || { aggression: .5, prudence: .5, ambition: .5 };
        const strategy = forFaction(state, faction.id), balance = Math.max(0, faction.favorBalance || 0);
        const fraction = clamp(.16 + traits.aggression * .2 + strategy.urgency * .36 - traits.prudence * .08, .12, .8);
        const lastSacred = !Rules.SACRED_WEEKS.some(week => week > state.week);
        let budget = Math.min(balance, lastSacred ? balance : Math.floor(balance * fraction / 10) * 10);
        if (balance >= 10 && strategy.urgency > .65) budget = Math.max(10, budget);
        const maxTargets = strategy.urgency > .8 ? 3 : strategy.urgency > .5 ? 2 : 1;
        const completed = (state.completedWeeks || []).filter(week => week.week < state.week).flatMap(week => (week.factions || [])
            .filter(row => row.factionId === faction.id).flatMap(row => row.players || []));
        const average = id => {
            const games = completed.filter(p => p.id === id || p.playerId === id).filter(p => p.hasRecordedGame !== false);
            const values = games.map(p => p.basePoints).filter(Number.isFinite);
            return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        };
        const targets = [...ranked];
        if (traits.prudence > .7) targets.sort((a, b) => (average(a) ?? Infinity) - (average(b) ?? Infinity));
        const result = [];
        for (const playerId of targets.slice(0, maxTargets)) {
            if (budget < 10) break;
            const points = average(playerId);
            const protective = traits.prudence > traits.aggression && points !== null && points < 15;
            const tier = !protective && budget >= 30 && strategy.urgency >= .65 ? 3 : budget >= 20 && strategy.urgency >= .4 ? 2 : 1;
            const favorId = `${protective ? 'horus' : 'kratos'}-${Math.min(protective ? 2 : 3, tier)}`;
            const cost = Math.min(protective ? 2 : 3, tier) * 10;
            result.push({ favorId, playerId }); budget -= cost;
        }
        return result;
    }
    const api = { forFaction, favorPlan };
    App.DuatStrategy = api;
    if (common) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
