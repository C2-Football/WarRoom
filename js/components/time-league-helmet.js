// ══════════════════════════════════════════════════════════════════
// js/components/time-league-helmet.js — window.TimeLeagueHelmetIcon,
// window.TimeLeagueHelmetPicker
// The visual half of js/shared/time-league-helmet.js's retro team
// identity: an SVG helmet (shell color, facemask, stripe, first-letter
// logo) plus a compact inline editor for it. No uploaded art — every
// team already has a look; the picker just lets you change it.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const h = React.createElement;
    const Helmet = window.App.TimeLeagueHelmet;

    /** helmet = { color, facemask, stripe, stripeColor } (see time-league-helmet.js). */
    function TimeLeagueHelmetIcon({ helmet, letter, size = 32, title }) {
        const spec = helmet || Helmet.defaultHelmet('fallback');
        const shell = Helmet.colorById(spec.color).hex;
        const facemaskId = spec.facemask;
        const stripeOn = spec.stripe !== false;
        const stripeColor = spec.stripeColor || Helmet.STRIPE_COLORS[0];
        return h('svg', { viewBox: '0 0 64 56', width: size, height: size, 'aria-hidden': title ? undefined : 'true', role: title ? 'img' : undefined },
            title && h('title', null, title),
            h('ellipse', { cx: 30, cy: 26, rx: 26, ry: 22, fill: shell, stroke: 'rgba(0,0,0,0.35)', strokeWidth: 1.5 }),
            stripeOn && h('path', { d: 'M30 4 Q34 4 34 26 Q34 44 30 48', stroke: stripeColor, strokeWidth: 5, fill: 'none', strokeLinecap: 'round', opacity: 0.92 }),
            h('text', {
                x: 26, y: 31, fontSize: 18, fontWeight: 800, fill: 'rgba(255,255,255,0.94)',
                textAnchor: 'middle', dominantBaseline: 'middle', fontFamily: 'var(--font-title, sans-serif)',
            }, letter || Helmet.letterFor('')),
            facemaskId !== 'none' && h('g', { stroke: '#e2e2e2', fill: 'none', strokeLinecap: 'round' },
                facemaskId === 'single' && h('path', { d: 'M8 34 Q28 46 52 30', strokeWidth: 2.5 }),
                facemaskId === 'double' && h(React.Fragment, null,
                    h('path', { d: 'M8 32 Q28 42 50 28', strokeWidth: 2.2 }),
                    h('path', { d: 'M8 38 Q28 47 50 34', strokeWidth: 2.2 })),
                facemaskId === 'cage' && h(React.Fragment, null,
                    h('path', { d: 'M8 31 L52 27', strokeWidth: 1.6 }),
                    h('path', { d: 'M8 36 L52 32', strokeWidth: 1.6 }),
                    h('path', { d: 'M8 41 L52 37', strokeWidth: 1.6 }),
                    h('path', { d: 'M14 28 L16 43', strokeWidth: 1.6 }),
                    h('path', { d: 'M28 27 L29 44', strokeWidth: 1.6 }),
                    h('path', { d: 'M42 27.5 L44 40', strokeWidth: 1.6 }))));
    }

    /**
     * Compact inline editor: an icon button that toggles a small swatch +
     * facemask + stripe row open beneath it. Kept collapsed by default so
     * a 12-seat roster doesn't turn the setup screen into a wall of
     * pickers — matches the click-to-expand pattern this app already uses
     * elsewhere (Big Board rows, Rule Lab groups) rather than inventing a
     * new one.
     */
    function TimeLeagueHelmetPicker({ helmet, letter, onChange }) {
        const [open, setOpen] = React.useState(false);
        const spec = helmet || Helmet.defaultHelmet(letter || 'seat');
        const set = (patch) => onChange({ ...spec, ...patch });
        return h('div', { className: 'tl-helmet-picker' },
            h('button', {
                type: 'button', className: 'tl-btn icon', title: 'Customize helmet',
                onClick: () => setOpen((v) => !v),
                style: { padding: 2, display: 'inline-flex', alignItems: 'center' },
            }, h(TimeLeagueHelmetIcon, { helmet: spec, letter, size: 28 })),
            open && h('div', { className: 'tl-helmet-editor' },
                h('div', { className: 'tl-helmet-swatches' },
                    Helmet.HELMET_COLORS.map((c) => h('button', {
                        key: c.id, type: 'button', title: c.label,
                        className: `tl-helmet-swatch${spec.color === c.id ? ' selected' : ''}`,
                        style: { background: c.hex },
                        onClick: () => set({ color: c.id }),
                    }))),
                h('div', { className: 'tl-helmet-row' },
                    h('select', {
                        className: 'tl-select', value: spec.facemask,
                        onChange: (e) => set({ facemask: e.target.value }),
                    }, Helmet.FACEMASK_STYLES.map((f) => h('option', { key: f.id, value: f.id }, f.label))),
                    h('label', { className: 'tl-helmet-stripe-toggle' },
                        h('input', { type: 'checkbox', checked: spec.stripe !== false, onChange: (e) => set({ stripe: e.target.checked }) }),
                        ' Stripe'),
                    spec.stripe !== false && Helmet.STRIPE_COLORS.map((sc) => h('button', {
                        key: sc, type: 'button', title: 'Stripe color',
                        className: `tl-helmet-swatch small${spec.stripeColor === sc ? ' selected' : ''}`,
                        style: { background: sc },
                        onClick: () => set({ stripeColor: sc }),
                    })))));
    }

    window.TimeLeagueHelmetIcon = TimeLeagueHelmetIcon;
    window.TimeLeagueHelmetPicker = TimeLeagueHelmetPicker;
})();
