// ══════════════════════════════════════════════════════════════════
// js/shared/time-league-helmet.js — window.App.TimeLeagueHelmet
// Retro Tecmo-Bowl-style team identity: a shell color, a facemask style,
// an optional center stripe, and the team name's first letter as the
// "logo" — no uploaded art, every team gets a distinct look for free the
// moment a seat exists. Pure, no browser/network/storage dependencies;
// Node-testable like every other time-league-*.js file.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const Roster = App.TimeLeagueRoster;

    // A curated retro palette, not a full color picker — old-school shell
    // colors that stay legible at icon size and read as distinct from a
    // glance, the way a Tecmo Bowl roster screen does.
    const HELMET_COLORS = [
        { id: 'crimson', label: 'Crimson', hex: '#8C1D1D' },
        { id: 'navy', label: 'Navy', hex: '#1B2A4A' },
        { id: 'forest', label: 'Forest', hex: '#1F4D36' },
        { id: 'gold', label: 'Gold', hex: '#B8860B' },
        { id: 'purple', label: 'Purple', hex: '#4B2E6F' },
        { id: 'steel', label: 'Steel', hex: '#3B444B' },
        { id: 'orange', label: 'Orange', hex: '#C1521A' },
        { id: 'teal', label: 'Teal', hex: '#1B6B6B' },
        { id: 'maroon', label: 'Maroon', hex: '#5C1A2E' },
        { id: 'silver', label: 'Silver', hex: '#8A8F98' },
    ];
    const FACEMASK_STYLES = [
        { id: 'single', label: 'Single Bar' },
        { id: 'double', label: 'Double Bar' },
        { id: 'cage', label: 'Cage' },
        { id: 'none', label: 'None' },
    ];
    const STRIPE_COLORS = ['#FFFFFF', '#F4D03F', '#0A0A0A'];

    function colorById(id) { return HELMET_COLORS.find((c) => c.id === id) || HELMET_COLORS[0]; }
    function facemaskById(id) { return FACEMASK_STYLES.find((f) => f.id === id) || FACEMASK_STYLES[0]; }

    /**
     * Deterministic per-seat default — the same seed always produces the
     * same helmet, so reloading a league (or re-deriving a helmet for one
     * founded before this feature existed) never reshuffles a look nobody
     * asked to change. Biased away from 'none' facemask for defaults so a
     * freshly founded league looks fully dressed without anyone touching
     * the picker.
     */
    function defaultHelmet(seedKey) {
        const random = Roster.createSeededRandom(`helmet:${seedKey}`);
        const color = HELMET_COLORS[Math.floor(random() * HELMET_COLORS.length)];
        const dressedStyles = FACEMASK_STYLES.filter((f) => f.id !== 'none');
        const facemask = dressedStyles[Math.floor(random() * dressedStyles.length)];
        const stripe = random() < 0.65;
        const stripeColor = STRIPE_COLORS[Math.floor(random() * STRIPE_COLORS.length)];
        return { color: color.id, facemask: facemask.id, stripe, stripeColor };
    }

    function letterFor(name) {
        const trimmed = String(name || '').trim();
        return trimmed ? trimmed[0].toUpperCase() : '?';
    }

    const api = { HELMET_COLORS, FACEMASK_STYLES, STRIPE_COLORS, colorById, facemaskById, defaultHelmet, letterFor };
    App.TimeLeagueHelmet = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
