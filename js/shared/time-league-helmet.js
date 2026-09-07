// ══════════════════════════════════════════════════════════════════
// js/shared/time-league-helmet.js — window.App.TimeLeagueHelmet
// A backwards-compatible team identity backed by complete sourced helmet art.
// Legacy component choices are retained in saves, but only the selected whole
// artwork and its supported colors determine the rendered helmet.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const Roster = App.TimeLeagueRoster;

    const ARTWORKS = [
        { id: 'cyberscooty', label: 'Classic side view', artist: 'cyberscooty', sourceUrl: 'https://openclipart.org/detail/212653/american-football-helmet', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', src: 'images/time-league/helmets/cyberscooty.svg', colors: ['shell', 'stripe', 'facemask'] },
        { id: 'simanek', label: 'Three-quarter view', artist: 'simanek', sourceUrl: 'https://commons.wikimedia.org/wiki/File:FootballHelmet.svg', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', src: 'images/time-league/helmets/simanek.svg', colors: ['shell', 'stripe', 'facemask'] },
    ];
    function artworkById(id) { return ARTWORKS.find(artwork => artwork.id === id) || ARTWORKS[0]; }

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
        { id: 'teal', label: 'Coastal Teal', hex: '#087E87' },
        { id: 'mint', label: 'Fresh Mint', hex: '#75DFC2' },
        { id: 'pink', label: 'Electric Pink', hex: '#D74E96' },
        { id: 'copper', label: 'Copper', hex: '#BA7047' },
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
        { id: 'kelly', label: 'Kelly Green', hex: '#238249' },
        { id: 'teal', label: 'Teal', hex: '#12A9AD' },
        { id: 'orange', label: 'Orange', hex: '#EF792B' },
        { id: 'purple', label: 'Purple', hex: '#9866D7' },
        { id: 'pink', label: 'Pink', hex: '#ED79B7' },
        { id: 'mint', label: 'Mint', hex: '#89EED3' },
    ];
    const SHELL_STYLES = [
        { id: 'round-70', label: '70s Round', era: '1970s' },
        { id: 'high-80', label: '80s High Dome', era: '1980s' },
        { id: 'low-90', label: '90s Low Crown', era: '1990s' },
        { id: 'speed', label: 'Speed Shell', era: 'Swept crown · rear vents' },
        { id: 'sculpted', label: 'Sculpted Shell', era: 'Angular brow · contoured panels' },
        { id: 'impact', label: 'Impact Shell', era: 'Wide crown · split panels' },
    ];
    const FACEMASK_STYLES = [
        { id: 'single', label: 'Single-Bar', era: '70s Throwback' },
        { id: 'double', label: 'Two-Bar', era: '80s Classic' },
        { id: 'cage', label: 'Full Cage', era: '90s Power' },
        { id: 'speed', label: 'Speed Grid', era: 'Angular · open sightline' },
        { id: 'power', label: 'Power Cage', era: 'Extra center protection' },
        { id: 'none', label: 'No Mask', era: 'Leather' },
    ];
    const DECAL_STYLES = [
        { id: 'monogram', label: 'Monogram', mark: 'AB' },
        { id: 'horseshoe', label: 'Horseshoe', mark: '∪' },
        { id: 'star', label: 'Star', mark: '★' },
        { id: 'bolt', label: 'Bolt', mark: 'ϟ' },
        { id: 'wing', label: 'Wing', mark: '≋' },
        { id: 'shield', label: 'Shield', mark: '◇' },
        { id: 'falcon', label: 'Falcon', mark: '' },
        { id: 'wolf', label: 'Wolfpack', mark: '' },
        { id: 'bull', label: 'Stampede', mark: '' },
        { id: 'crown', label: 'Crown', mark: '' },
        { id: 'flame', label: 'Wildfire', mark: '' },
        { id: 'trident', label: 'Trident', mark: '' },
        { id: 'serpent', label: 'Serpent', mark: '' },
        { id: 'mountain', label: 'Summit', mark: '' },
        { id: 'comet', label: 'Comet', mark: '' },
        { id: 'anchor', label: 'Anchor', mark: '' },
        { id: 'blank', label: 'No Decal', mark: '—' },
    ];
    const STRIPE_STYLES = [
        { id: 'none', label: 'No Stripe' },
        { id: 'single', label: 'Single' },
        { id: 'double', label: 'Double' },
        { id: 'triple', label: 'Triple' },
    ];
    const PAINT_STYLES = [
        { id: 'solid', label: 'Solid', hint: 'Let your logo lead' },
        { id: 'winged', label: 'Winged', hint: 'Painted brow and sweeping crown wings' },
        { id: 'tiger', label: 'Tiger', hint: 'Claw stripes across the shell' },
        { id: 'flames', label: 'Flames', hint: 'Fire sweeping from the rear' },
        { id: 'lightning', label: 'Lightning', hint: 'Full-shell lightning flash' },
        { id: 'two-tone', label: 'Two Tone', hint: 'Split shell in your two colors' },
    ];
    const VISOR_STYLES = [
        { id: 'none', label: 'No Visor' },
        { id: 'clear', label: 'Clear' },
        { id: 'smoke', label: 'Smoke' },
        { id: 'amber', label: 'Amber' },
        { id: 'ice', label: 'Ice Mirror' },
    ];
    const FACEMASK_FINISHES = [
        { id: 'silver', label: 'Silver', hex: '#C5C7C9' },
        { id: 'white', label: 'White', hex: '#F4F1E8' },
        { id: 'black', label: 'Black', hex: '#111216' },
        { id: 'gold', label: 'Gold', hex: '#D7B13B' },
        ...ACCENT_COLORS.filter(color => !['silver', 'white', 'black', 'gold'].includes(color.id)),
        { id: 'copper', label: 'Copper', hex: '#CB8862' },
        { id: 'powder', label: 'Powder Blue', hex: '#86BCE7' },
    ];
    const FACEMASK_COLORS = FACEMASK_FINISHES.map(color => color.hex);
    // Legacy consumers still read this list directly.
    const STRIPE_COLORS = ACCENT_COLORS.map((color) => color.hex);

    const HELMET_PRESETS = [
        { id: 'blue-horseshoe', label: 'Blue Horseshoe', era: 'Heritage collection', spec: { shell: 'round-70', color: 'white', accentColor: '#285DA8', decal: 'horseshoe', facemask: 'cage', facemaskColor: '#C5C7C9', stripeStyle: 'none', stripeColor: '#285DA8' } },
        { id: 'sunday-gold', label: 'Sunday Gold', era: '1970s', spec: { shell: 'round-70', color: 'gold', accentColor: '#172A49', decal: 'wing', facemask: 'single', facemaskColor: '#C5C7C9', stripeStyle: 'single', stripeColor: '#172A49' } },
        { id: 'kelly-classic', label: 'Kelly Classic', era: '1970s', spec: { shell: 'round-70', color: 'kelly', accentColor: '#F4F1E8', decal: 'monogram', facemask: 'double', facemaskColor: '#F4F1E8', stripeStyle: 'double', stripeColor: '#F4F1E8' } },
        { id: 'midnight', label: 'Monday Night', era: '1980s', spec: { shell: 'high-80', color: 'navy', accentColor: '#F0C43C', decal: 'star', facemask: 'double', facemaskColor: '#D7B13B', stripeStyle: 'triple', stripeColor: '#F0C43C' } },
        { id: 'royal-bolt', label: 'Royal Bolt', era: '1980s', spec: { shell: 'high-80', color: 'royal', accentColor: '#F4F1E8', decal: 'bolt', facemask: 'double', facemaskColor: '#F4F1E8', stripeStyle: 'single', stripeColor: '#F4F1E8' } },
        { id: 'silver-shield', label: 'Silver Shield', era: '1990s', spec: { shell: 'low-90', color: 'silver', accentColor: '#111216', decal: 'shield', facemask: 'cage', facemaskColor: '#111216', stripeStyle: 'double', stripeColor: '#111216' } },
        { id: 'desert-falcon', label: 'Desert Falcons', era: 'Flight club', spec: { shell: 'round-70', color: 'cream', accentColor: '#B92E35', decal: 'falcon', facemask: 'cage', facemaskColor: '#111216', stripeStyle: 'none', stripeColor: '#B92E35' } },
        { id: 'ice-wolves', label: 'Ice Wolves', era: 'Northern division', spec: { shell: 'round-70', color: 'powder', accentColor: '#F4F1E8', decal: 'wolf', facemask: 'cage', facemaskColor: '#F4F1E8', stripeStyle: 'double', stripeColor: '#F4F1E8' } },
        { id: 'red-stampede', label: 'Red Stampede', era: 'Built for contact', spec: { shell: 'round-70', color: 'crimson', accentColor: '#F4F1E8', decal: 'bull', facemask: 'cage', facemaskColor: '#111216', stripeStyle: 'single', stripeColor: '#F4F1E8' } },
        { id: 'purple-reign', label: 'Purple Reign', era: 'Royal treatment', spec: { shell: 'round-70', color: 'purple', accentColor: '#F0C43C', decal: 'crown', facemask: 'cage', facemaskColor: '#D7B13B', stripeStyle: 'triple', stripeColor: '#F0C43C' } },
        { id: 'wildfire', label: 'Wildfire', era: 'Bring the heat', spec: { shell: 'round-70', color: 'black', accentColor: '#F0C43C', decal: 'flame', facemask: 'cage', facemaskColor: '#C5C7C9', stripeStyle: 'single', stripeColor: '#B92E35' } },
        { id: 'tidal-force', label: 'Tidal Force', era: 'Coastal classics', spec: { shell: 'round-70', color: 'navy', accentColor: '#F4F1E8', decal: 'trident', facemask: 'cage', facemaskColor: '#F4F1E8', stripeStyle: 'double', stripeColor: '#F0C43C' } },
        { id: 'winged-gold', label: 'Winged Gold', era: 'Painted tradition', spec: { shell: 'round-70', color: 'navy', accentColor: '#F0C43C', decal: 'blank', paintStyle: 'winged', facemask: 'double', facemaskColor: '#172A49', stripeStyle: 'none', stripeColor: '#F0C43C' } },
        { id: 'jungle', label: 'Jungle', era: 'Earn your stripes', spec: { shell: 'speed', color: 'orange', accentColor: '#111216', decal: 'blank', paintStyle: 'tiger', facemask: 'speed', facemaskColor: '#111216', visor: 'smoke', stripeStyle: 'none', stripeColor: '#111216' } },
        { id: 'ice-speed', label: 'Ice Speed', era: 'Future classics', spec: { shell: 'sculpted', color: 'white', accentColor: '#12A9AD', decal: 'comet', facemask: 'speed', facemaskColor: '#12A9AD', visor: 'ice', stripeStyle: 'double', stripeColor: '#12A9AD' } },
        { id: 'copperhead', label: 'Copperhead', era: 'Built for impact', spec: { shell: 'impact', color: 'black', accentColor: '#CB8862', decal: 'serpent', facemask: 'power', facemaskColor: '#CB8862', visor: 'amber', paintStyle: 'two-tone', stripeStyle: 'none', stripeColor: '#CB8862' } },
        { id: 'firestorm', label: 'Firestorm', era: 'No quiet entrances', spec: { shell: 'speed', color: 'crimson', accentColor: '#F0C43C', decal: 'blank', facemask: 'speed', facemaskColor: '#111216', visor: 'smoke', paintStyle: 'flames', stripeStyle: 'none', stripeColor: '#F0C43C' } },
    ];

    function colorById(id) { return HELMET_COLORS.find((color) => color.id === id) || HELMET_COLORS[0]; }
    function shellById(id) { return SHELL_STYLES.find((shell) => shell.id === id) || SHELL_STYLES[0]; }
    function facemaskById(id) { return FACEMASK_STYLES.find((style) => style.id === id) || FACEMASK_STYLES[0]; }
    function decalById(id) { return DECAL_STYLES.find((style) => style.id === id) || DECAL_STYLES[0]; }
    function stripeById(id) { return STRIPE_STYLES.find((style) => style.id === id) || STRIPE_STYLES[1]; }
    function paintById(id) { return PAINT_STYLES.find(style => style.id === id) || PAINT_STYLES[0]; }
    function visorById(id) { return VISOR_STYLES.find(style => style.id === id) || VISOR_STYLES[0]; }
    function safeHex(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback; }
    function shellColorFor(spec) { return safeHex(spec?.shellColor, colorById(spec?.color).hex); }

    function buildHelmet(seedKey) {
        const random = Roster.createSeededRandom(`helmet:${seedKey}`);
        const preset = HELMET_PRESETS[Math.floor(random() * HELMET_PRESETS.length)];
        return { assetId: ARTWORKS[0].id, artworkMode: 'team-colors', paintStyle: 'solid', visor: 'none', ...preset.spec, shellColor: '', stripe: preset.spec.stripeStyle !== 'none', monogram: '' };
    }

    function defaultHelmet(seedKey) { return buildHelmet(seedKey); }

    function normalizeHelmet(value, seedKey = 'fallback') {
        const fallback = defaultHelmet(seedKey);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
        const stripeStyle = value.stripe === false ? 'none' : stripeById(value.stripeStyle || 'single').id;
        return {
            assetId: artworkById(value.assetId).id,
            artworkMode: value.artworkMode === 'original' ? 'original' : 'team-colors',
            shell: shellById(value.shell || fallback.shell).id,
            color: colorById(value.color || fallback.color).id,
            shellColor: safeHex(value.shellColor, ''),
            accentColor: safeHex(value.accentColor, fallback.accentColor),
            decal: decalById(value.decal || fallback.decal).id,
            monogram: String(value.monogram || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3),
            facemask: facemaskById(value.facemask || fallback.facemask).id,
            facemaskColor: safeHex(value.facemaskColor, fallback.facemaskColor),
            stripe: stripeStyle !== 'none',
            stripeStyle,
            stripeColor: safeHex(value.stripeColor, fallback.stripeColor),
            paintStyle: paintById(value.paintStyle).id,
            visor: visorById(value.visor).id,
        };
    }

    function presetHelmet(id) {
        const preset = HELMET_PRESETS.find((item) => item.id === id) || HELMET_PRESETS[0];
        return { assetId: ARTWORKS[0].id, artworkMode: 'team-colors', paintStyle: 'solid', visor: 'none', shellColor: '', ...preset.spec, stripe: preset.spec.stripeStyle !== 'none' };
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
        ARTWORKS, artworkById,
        HELMET_COLORS, ACCENT_COLORS, SHELL_STYLES, FACEMASK_STYLES, FACEMASK_COLORS, FACEMASK_FINISHES,
        DECAL_STYLES, STRIPE_STYLES, STRIPE_COLORS, HELMET_PRESETS, PAINT_STYLES, VISOR_STYLES,
        colorById, shellById, facemaskById, decalById, stripeById, paintById, visorById, shellColorFor,
        defaultHelmet, normalizeHelmet, presetHelmet, letterFor, monogramFor,
    };
    App.TimeLeagueHelmet = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
