/* global module */
// Evidence for making roster room. A low rank by itself is not a drop reason.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function number(value) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function slots(value, minimum = 0) {
        const parsed = number(value);
        return parsed !== null && Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
    }

    function candidates(options = {}) {
        const { league = {}, roster, cutdownInfo, adjustedValue } = options;
        const rowsKnown = Array.isArray(options.rows);
        const rows = [...new Map((rowsKnown ? options.rows : [])
            .filter(row => row && row.pid !== null && row.pid !== undefined && String(row.pid))
            .map(row => [String(row.pid), row])).values()];
        const owned = Array.isArray(roster?.players)
            ? new Set(roster.players.filter(pid => pid !== null && pid !== undefined && String(pid)).map(String))
            : rowsKnown ? new Set(rows.map(row => String(row.pid))) : null;
        const reserve = new Set((roster?.reserve || []).map(String));
        const taxi = new Set((roster?.taxi || []).map(String));
        const starters = new Set((roster?.starters || []).map(String));
        const protectedIds = new Set([...(roster?.locked_players || []), ...(roster?.keepers || [])].map(String));
        rows.forEach(row => {
            const pid = String(row.pid);
            if (row.isIR) reserve.add(pid);
            if (row.isTaxi) taxi.add(pid);
            if (row.isStarter) starters.add(pid);
        });
        const positions = Array.isArray(league.roster_positions)
            ? league.roster_positions.map(position => String(position || '').trim().toUpperCase()).filter(Boolean)
            : [];
        const activePositions = positions.filter(position => !['IR', 'RES', 'RESERVE', 'TAXI'].includes(position));
        const currentActiveCap = activePositions.length > 0 ? activePositions.length : null;
        const configuredTaxi = slots(league.settings?.taxi_slots ?? league.taxi_slots);
        const currentTaxiCap = configuredTaxi !== null ? configuredTaxi
            : positions.includes('TAXI') ? positions.filter(position => position === 'TAXI').length : null;
        const nearCutdown = cutdownInfo?.status?.isNear === true || cutdownInfo?.status?.isPast === true;
        const activeCap = (nearCutdown ? slots(cutdownInfo?.rule?.activeSlots, 1) : null) ?? currentActiveCap;
        const taxiCap = (nearCutdown ? slots(cutdownInfo?.rule?.taxiSlots) : null) ?? currentTaxiCap;
        const activeCount = owned ? [...owned].filter(pid => !reserve.has(pid) && !taxi.has(pid)).length : null;
        const taxiCount = owned ? [...owned].filter(pid => taxi.has(pid) && !reserve.has(pid)).length : null;
        const activeOver = activeCap !== null && activeCount !== null ? Math.max(0, activeCount - activeCap) : null;
        const taxiOver = taxiCap !== null && taxiCount !== null ? Math.max(0, taxiCount - taxiCap) : null;
        const dropCandidatePids = new Set();
        const taxiCandidatePids = new Set();
        const reasons = {};
        const rank = row => {
            try { return number(typeof adjustedValue === 'function' ? adjustedValue(row) : row.dhq); }
            catch (_) { return null; }
        };
        const available = row => owned?.has(String(row.pid)) && !reserve.has(String(row.pid))
            && !starters.has(String(row.pid)) && !protectedIds.has(String(row.pid))
            && !row.gmIsUntouchable && !row.isUntouchable && !row.isLocked
            && !/^untouchable$/i.test(String(row.rec || ''));
        const ranked = inTaxi => rows.filter(row => available(row) && taxi.has(String(row.pid)) === inTaxi)
            .map(row => ({ row, value: rank(row) })).filter(item => item.value !== null)
            .sort((a, b) => a.value - b.value || String(a.row.pid).localeCompare(String(b.row.pid)))
            .map(item => item.row);
        const bench = ranked(false);
        const taxiPlayers = ranked(true);
        const type = String(options.leagueType || '').toLowerCase();
        const supportsTaxi = ['dynasty', 'keeper'].includes(type) && options.showTaxi !== false;
        const taxiYears = slots(league.settings?.taxi_years);
        const taxiEligible = row => {
            const years = number(row.p?.years_exp);
            return supportsTaxi && taxiYears !== null && years !== null && years >= 0 && years <= taxiYears;
        };
        // Pending room is insufficient: a move needs room under today's cap too.
        let taxiRoom = currentTaxiCap !== null && taxiCount !== null
            ? Math.max(0, Math.min(currentTaxiCap, taxiCap ?? currentTaxiCap) - taxiCount) : 0;
        const addTaxi = row => {
            taxiCandidatePids.add(row.pid);
            reasons[row.pid] = 'Taxi eligible with ' + taxiRoom + ' open taxi ' + (taxiRoom === 1 ? 'spot' : 'spots')
                + '. Move to taxi to preserve the active roster spot.';
            taxiRoom--;
        };
        if (activeOver > 0) {
            bench.slice(0, activeOver).forEach(row => {
                if (taxiEligible(row) && taxiRoom > 0) addTaxi(row);
                else {
                    dropCandidatePids.add(row.pid);
                    reasons[row.pid] = 'Active roster is ' + activeOver + ' over its ' + activeCap
                        + '-player limit. Compare this bench option before making room.';
                }
            });
        } else if (supportsTaxi && taxiRoom > 0) {
            bench.filter(taxiEligible).slice(0, Math.min(3, taxiRoom)).forEach(addTaxi);
        }
        if (taxiOver > 0) {
            taxiPlayers.slice(0, taxiOver).forEach(row => {
                dropCandidatePids.add(row.pid);
                reasons[row.pid] = 'Taxi squad is ' + taxiOver + ' over its ' + taxiCap
                    + '-player limit. Compare this taxi option before making room.';
            });
        }
        return { dropCandidatePids, taxiCandidatePids, reasons, activeOver, taxiOver };
    }

    App.RosterReview = { candidates };
    if (typeof module !== 'undefined' && module.exports) module.exports = App.RosterReview;
})(typeof window !== 'undefined' ? window : globalThis);
