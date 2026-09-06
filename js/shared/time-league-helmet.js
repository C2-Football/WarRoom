// ══════════════════════════════════════════════════════════════════
// js/shared/time-league-helmet.js — window.App.TimeLeagueHelmet
// A deterministic, backwards-compatible retro football helmet identity.
// The saved spec is intentionally small; the SVG component turns it into
// a detailed shell, stripe, decal and facemask everywhere in The Vault.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const Roster = App.TimeLeagueRoster;

    const HELMET_COLORS = [
        { id: 'crimson', label: 'Crimson', hex: '#8C1D2C' },
        { id: 'navy', label: 'Midnight Navy', hex: '#172A49' },
        { id: 'kelly', label: 'Kelly Green', hex: '#176B3A' },
        { id: 'gold', label: 'Mustard Gold', hex: '#C49316' },
        { id: 'royal', label: 'Royal Blue', hex: '#214F9B' },
        { id: 'purple', label: 'Deep Purple', hex: '#4B2E6F' },
        { id: 'orange', label: 'Burnt Orange', hex: '#C8541E' },
        { id: 'brown', label: 'Leather Brown', hex: '#613B2A' },
        { id: 'maroon', label: 'Maroon', hex: '#641F35' },
        { id: 'powder', label: 'Powder Blue', hex: '#5795C6' },
        { id: 'silver', label: 'Silver', hex: '#969CA5' },
        { id: 'cream', label: 'Vintage Cream', hex: '#D8CBA9' },
        { id: 'white', label: 'Gridiron White', hex: '#F2F2F0' },
        { id: 'black', label: 'Black', hex: '#18191D' },
    ];
    const ACCENT_COLORS = [
        { id: 'white', label: 'White', hex: '#F4F1E8' },
        { id: 'cream', label: 'Cream', hex: '#D8CBA9' },
        { id: 'gold', label: 'Gold', hex: '#F0C43C' },
        { id: 'red', label: 'Red', hex: '#B92E35' },
        { id: 'royal', label: 'Royal', hex: '#285DA8' },
        { id: 'navy', label: 'Navy', hex: '#172A49' },
        { id: 'black', label: 'Black', hex: '#111216' },
        { id: 'silver', label: 'Silver', hex: '#C2C5C9' },
    ];
    const SHELL_STYLES = [
        { id: 'round-70', label: '70s Round', era: '1970s', path: 'M1 57V29h3v-9h5v-6h7V9h10V5h12V2h24v2h11v4h8v6h6v9h3v21h-6v5H74v10h-5v17h-7v9H39v-4H28v-6H16v-3H7v-7H1Z' },
        { id: 'high-80', label: '80s High Dome', era: '1980s', path: 'M1 57V27h3v-9h5v-6h7V7h10V3h12V1h24v2h11v4h8v6h6v9h3v22h-6v5H74v10h-5v17h-7v9H39v-4H28v-6H16v-3H7v-7H1Z' },
        { id: 'low-90', label: '90s Low Crown', era: '1990s', path: 'M1 57V32h3v-8h5v-6h7v-5h10V9h12V6h27v2h11v4h8v6h6v8h3v18h-7v5H74v10h-5v17h-7v9H39v-4H28v-6H16v-3H7v-7H1Z' },
    ];
    const FACEMASK_STYLES = [
        { id: 'single', label: 'Single-Bar', era: '70s Throwback' },
        { id: 'double', label: 'Two-Bar', era: '80s Classic' },
        { id: 'cage', label: 'Full Cage', era: '90s Power' },
        { id: 'none', label: 'No Mask', era: 'Leather' },
    ];
    const DECAL_STYLES = [
        { id: 'monogram', label: 'Monogram', mark: 'AB' },
        { id: 'horseshoe', label: 'Horseshoe', mark: '∪' },
        { id: 'star', label: 'Star', mark: '★' },
        { id: 'bolt', label: 'Bolt', mark: 'ϟ' },
        { id: 'wing', label: 'Wing', mark: '≋' },
        { id: 'shield', label: 'Shield', mark: '◇' },
        { id: 'blank', label: 'No Decal', mark: '—' },
    ];
    const STRIPE_STYLES = [
        { id: 'none', label: 'No Stripe' },
        { id: 'single', label: 'Single' },
        { id: 'double', label: 'Double' },
        { id: 'triple', label: 'Triple' },
    ];
    const FACEMASK_COLORS = ['#C5C7C9', '#F4F1E8', '#111216', '#D7B13B'];
    // Legacy consumers still read this list directly.
    const STRIPE_COLORS = ACCENT_COLORS.map((color) => color.hex);

    const HELMET_PRESETS = [
        { id: 'blue-horseshoe', label: 'Blue Horseshoe', era: 'Pixel Classic', spec: { shell: 'round-70', color: 'white', accentColor: '#285DA8', decal: 'horseshoe', facemask: 'cage', facemaskColor: '#C5C7C9', stripeStyle: 'none', stripeColor: '#285DA8' } },
        { id: 'sunday-gold', label: 'Sunday Gold', era: '1970s', spec: { shell: 'round-70', color: 'gold', accentColor: '#172A49', decal: 'wing', facemask: 'single', facemaskColor: '#C5C7C9', stripeStyle: 'single', stripeColor: '#172A49' } },
        { id: 'kelly-classic', label: 'Kelly Classic', era: '1970s', spec: { shell: 'round-70', color: 'kelly', accentColor: '#F4F1E8', decal: 'monogram', facemask: 'double', facemaskColor: '#F4F1E8', stripeStyle: 'double', stripeColor: '#F4F1E8' } },
        { id: 'midnight', label: 'Monday Night', era: '1980s', spec: { shell: 'high-80', color: 'navy', accentColor: '#F0C43C', decal: 'star', facemask: 'double', facemaskColor: '#F0C43C', stripeStyle: 'triple', stripeColor: '#F0C43C' } },
        { id: 'royal-bolt', label: 'Royal Bolt', era: '1980s', spec: { shell: 'high-80', color: 'royal', accentColor: '#F4F1E8', decal: 'bolt', facemask: 'double', facemaskColor: '#F4F1E8', stripeStyle: 'single', stripeColor: '#F4F1E8' } },
        { id: 'silver-shield', label: 'Silver Shield', era: '1990s', spec: { shell: 'low-90', color: 'silver', accentColor: '#111216', decal: 'shield', facemask: 'cage', facemaskColor: '#111216', stripeStyle: 'double', stripeColor: '#111216' } },
    ];

    function colorById(id) { return HELMET_COLORS.find((color) => color.id === id) || HELMET_COLORS[0]; }
    function shellById(id) { return SHELL_STYLES.find((shell) => shell.id === id) || SHELL_STYLES[0]; }
    function facemaskById(id) { return FACEMASK_STYLES.find((style) => style.id === id) || FACEMASK_STYLES[0]; }
    function decalById(id) { return DECAL_STYLES.find((style) => style.id === id) || DECAL_STYLES[0]; }
    function stripeById(id) { return STRIPE_STYLES.find((style) => style.id === id) || STRIPE_STYLES[1]; }
    function safeHex(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback; }

    function buildHelmet(seedKey) {
        const random = Roster.createSeededRandom(`helmet:${seedKey}`);
        const color = HELMET_COLORS[Math.floor(random() * HELMET_COLORS.length)];
        const accentPool = ACCENT_COLORS.filter((accent) => accent.hex.toLowerCase() !== color.hex.toLowerCase());
        const accent = accentPool[Math.floor(random() * accentPool.length)];
        const shell = SHELL_STYLES[Math.floor(random() * SHELL_STYLES.length)];
        const facemask = FACEMASK_STYLES[Math.floor(random() * 3)];
        const decal = DECAL_STYLES[Math.floor(random() * (DECAL_STYLES.length - 1))];
        const stripeStyle = ['single', 'double', 'triple'][Math.floor(random() * 3)];
        return {
            shell: shell.id,
            color: color.id,
            accentColor: accent.hex,
            decal: decal.id,
            facemask: facemask.id,
            facemaskColor: FACEMASK_COLORS[Math.floor(random() * FACEMASK_COLORS.length)],
            stripe: true,
            stripeStyle,
            stripeColor: accent.hex,
        };
    }

    function defaultHelmet(seedKey) { return buildHelmet(seedKey); }

    function normalizeHelmet(value, seedKey = 'fallback') {
        const fallback = defaultHelmet(seedKey);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
        const stripeStyle = value.stripe === false ? 'none' : stripeById(value.stripeStyle || 'single').id;
        return {
            shell: shellById(value.shell || fallback.shell).id,
            color: colorById(value.color || fallback.color).id,
            accentColor: safeHex(value.accentColor, fallback.accentColor),
            decal: decalById(value.decal || fallback.decal).id,
            facemask: facemaskById(value.facemask || fallback.facemask).id,
            facemaskColor: FACEMASK_COLORS.includes(value.facemaskColor) ? value.facemaskColor : fallback.facemaskColor,
            stripe: stripeStyle !== 'none',
            stripeStyle,
            stripeColor: safeHex(value.stripeColor, fallback.stripeColor),
        };
    }

    function presetHelmet(id) {
        const preset = HELMET_PRESETS.find((item) => item.id === id) || HELMET_PRESETS[0];
        return { ...preset.spec, stripe: preset.spec.stripeStyle !== 'none' };
    }

    function letterFor(name) {
        const trimmed = String(name || '').trim();
        return trimmed ? trimmed[0].toUpperCase() : '?';
    }

    function monogramFor(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
    }

    const api = {
        HELMET_COLORS, ACCENT_COLORS, SHELL_STYLES, FACEMASK_STYLES, FACEMASK_COLORS,
        DECAL_STYLES, STRIPE_STYLES, STRIPE_COLORS, HELMET_PRESETS,
        colorById, shellById, facemaskById, decalById, stripeById,
        defaultHelmet, normalizeHelmet, presetHelmet, letterFor, monogramFor,
    };
    App.TimeLeagueHelmet = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
