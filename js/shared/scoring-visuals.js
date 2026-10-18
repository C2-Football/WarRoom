// Presentation-only comparisons. Never supplies or reconstructs a score.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    function completedWeekLimit(season, state = {}) {
        const selected = Number(season), current = Number(state.season);
        if (!Number.isInteger(selected) || !Number.isInteger(current)) return 0;
        if (selected < current) return 18;
        if (selected > current || state.season_type === 'pre') return 0;
        if (state.season_type === 'post' || state.season_type === 'off') return 18;
        return Math.max(0, Math.min(18, (Number(state.display_week || state.week) || 1) - 1));
    }
    function summarize(values) {
        const sorted = (values || []).filter(finite).sort((a, b) => a - b);
        if (sorted.length < 3) return null;
        const half = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
        return { median, count: sorted.length, band: Math.max(Math.abs(median) * .2, 1) };
    }
    function compare(value, reference, { complete = true, lowerIsBetter = false } = {}) {
        if (!finite(value) || !finite(reference)) return { tone: 'neutral', label: 'No comparison' };
        if (!complete) return { tone: 'neutral', label: 'In progress' };
        const delta = value - reference, band = Math.max(Math.abs(reference) * .2, 1);
        const direction = lowerIsBetter ? -delta : delta;
        return { tone: direction > band ? 'strong' : direction < -band ? 'quiet' : 'typical',
            label: delta > band ? 'Above usual' : delta < -band ? 'Below usual' : 'Typical', delta, reference, band };
    }
    function classify(value, summary, options) {
        return compare(value, summary?.count >= 3 ? summary.median : null, options);
    }
    App.ScoringVisuals = { completedWeekLimit, summarize, compare, classify };
})(typeof window !== 'undefined' ? window : globalThis);
