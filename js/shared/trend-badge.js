// ══════════════════════════════════════════════════════════════════
// js/shared/trend-badge.js — forward-looking upside/downside badge
//
// Single source of truth for turning a player's YoY PPG trend
// (window.App.LI.playerMeta[pid].trend, a percentage — e.g. +23 means
// +23%) into a consistent "Trending Up/Down" read, so the player card,
// draft board, and any future surface agree on thresholds and labels.
//
// This does NOT compute trend — it only classifies the value that
// dhq-engine.js already derives from PPG-vs-last-season.
//
// Depends on: nothing. Exposes: window.App.classifyTrend
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const UP = 'var(--k-2ecc71, #2ecc71)';
    const DOWN = 'var(--k-e74c3c, #e74c3c)';

    function classifyTrend(trend) {
        const t = Number(trend) || 0;
        if (t >= 25) return { dir: 'up', strength: 'strong', label: 'Trending Up', glyph: '▲', color: UP, pct: t };
        if (t >= 10) return { dir: 'up', strength: 'mild', label: 'Trending Up', glyph: '▲', color: UP, pct: t };
        if (t <= -25) return { dir: 'down', strength: 'strong', label: 'Trending Down', glyph: '▼', color: DOWN, pct: t };
        if (t <= -10) return { dir: 'down', strength: 'mild', label: 'Trending Down', glyph: '▼', color: DOWN, pct: t };
        return null;
    }

    window.App = window.App || {};
    window.App.classifyTrend = classifyTrend;
})();
