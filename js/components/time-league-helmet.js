// Complete sourced helmet artwork shared across every Vault surface.
(function () {
    'use strict';
    const h = React.createElement;
    const Helmet = window.App.TimeLeagueHelmet;

    function TimeLeagueHelmetIcon({ helmet, letter, size = 32, title }) {
        const spec = Helmet.normalizeHelmet(helmet, letter || 'fallback');
        const artwork = Helmet.artworkById(spec.assetId);
        return h('img', {
            className: 'tl-helmet tl-helmet-artwork',
            src: window.App.TimeLeagueHelmetArtwork?.imageFor(spec) || artwork.src,
            width: size, height: size, alt: title || '', title,
            'aria-hidden': title ? undefined : 'true',
            'data-helmet-artwork': artwork.id, 'data-artwork-mode': spec.artworkMode,
            draggable: false, decoding: 'async',
        });
    }

    function Section({ title, hint, children }) {
        return h('section', { className: 'tl-helmet-control' },
            h('div', { className: 'tl-helmet-control-head' }, h('strong', null, title), hint && h('span', null, hint)), children);
    }

    function TimeLeagueHelmetPicker({ helmet, letter, name, onChange }) {
        const [open, setOpen] = React.useState(false);
        const [draft, setDraft] = React.useState(null);
        const [panel, setPanel] = React.useState('helmets');
        const [saving, setSaving] = React.useState(false);
        const [error, setError] = React.useState('');
        const dialogRef = React.useRef(null);
        const optionsRef = React.useRef(null);
        const savingRef = React.useRef(false);
        React.useEffect(() => { if (optionsRef.current) optionsRef.current.scrollTop = 0; }, [panel]);
        const teamName = name || letter || 'Your team';
        const saved = Helmet.normalizeHelmet(helmet, teamName);
        const spec = draft || saved;
        const artwork = Helmet.artworkById(spec.assetId);
        const set = patch => setDraft(previous => Helmet.normalizeHelmet({ ...(previous || saved), ...patch }, teamName));
        const close = () => { if (!savingRef.current) setOpen(false); };
        const launch = () => { setDraft(saved); setPanel('helmets'); setError(''); setOpen(true); };

        React.useEffect(() => {
            if (!open) return undefined;
            const previousFocus = document.activeElement;
            const previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            dialogRef.current?.querySelector('button')?.focus();
            const keydown = event => {
                if (event.key === 'Escape' && !savingRef.current) setOpen(false);
                if (event.key !== 'Tab') return;
                const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') || [])];
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            };
            document.addEventListener('keydown', keydown);
            return () => {
                document.removeEventListener('keydown', keydown);
                document.body.style.overflow = previousOverflow;
                previousFocus?.focus();
            };
        }, [open]);

        const save = async () => {
            if (savingRef.current) return;
            savingRef.current = true;
            setSaving(true); setError('');
            try {
                const result = await onChange(spec);
                if (result === false || result?.ok === false) setError(result?.error || 'Your helmet could not be saved. Try again.');
                else setOpen(false);
            } catch { setError('Your helmet could not be saved. Try again.'); }
            finally { savingRef.current = false; setSaving(false); }
        };
        const swatches = (colors, selected, action, label) => h('div', { className: 'tl-helmet-color-row' }, colors.map(color => h('button', {
            key: color.id, type: 'button', title: color.label, 'aria-label': `${label}: ${color.label}`, 'aria-pressed': selected === color.hex || selected === color.id,
            className: `tl-helmet-color${selected === color.hex || selected === color.id ? ' selected' : ''}`,
            style: { '--swatch': color.hex }, onClick: () => action(color),
        }, selected === color.hex || selected === color.id ? h('span', { 'aria-hidden': 'true' }, '✓') : null)));
        const customColor = (label, value, field) => h('label', { className: 'tl-studio-custom-color' },
            h('span', null, `Custom ${label.toLowerCase()}`), h('code', null, value.toUpperCase()),
            h('input', { type: 'color', value, 'aria-label': `Custom ${label.toLowerCase()} color`, onChange: event => set({ [field]: event.target.value }) }));
        const modeChoices = h('div', { className: 'tl-artwork-modes', role: 'group', 'aria-label': 'Artwork colors' },
            [['original', 'Original artwork'], ['team-colors', 'Team colors']].map(([id, label]) => h('button', {
                type: 'button', key: id, 'aria-pressed': spec.artworkMode === id, onClick: () => set({ artworkMode: id }),
            }, label)));
        const attribution = h('p', { className: 'tl-artwork-credit' }, 'Artwork by ',
            artwork.sourceUrl ? h('a', { href: artwork.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, artwork.artist) : artwork.artist,
            artwork.license ? ` · ${artwork.license}` : '', '.');
        const editor = open && h('div', { className: 'tl-helmet-workshop-backdrop tl-identity-studio tl-sourced-helmets', onMouseDown: close },
            h('div', { ref: dialogRef, className: 'tl-helmet-workshop', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Choose ${teamName} helmet`, onMouseDown: event => event.stopPropagation() },
                h('header', { className: 'tl-helmet-workshop-head' },
                    h('div', null, h('span', { className: 'tl-eyebrow' }, 'THE VAULT · TEAM IDENTITY'), h('h2', null, 'Choose your helmet.')),
                    h('button', { type: 'button', className: 'tl-helmet-close', 'aria-label': 'Close helmet workshop', disabled: saving, onClick: close }, '×')),
                h('div', { className: 'tl-studio-body' },
                    h('div', { className: 'tl-studio-preview', style: { '--kit-color': Helmet.shellColorFor(spec) } },
                        h('div', { className: 'tl-studio-team' }, h('span', null, 'YOUR TEAM, EVERY SEASON'), h('strong', null, teamName)),
                        h('div', { className: 'tl-studio-helmet' }, h(TimeLeagueHelmetIcon, { helmet: spec, size: 320, title: `${teamName} helmet preview` })),
                        h('div', { className: 'tl-studio-signature' }, h('span', null, h('b', null, artwork.label), h('small', null, spec.artworkMode === 'original' ? 'Original artist colors' : 'In your team colors'))),
                        h('div', { className: 'tl-studio-mini' }, h('span', null, 'ON THE SCOREBOARD'), h(TimeLeagueHelmetIcon, { helmet: spec, size: 32 }), h('b', null, teamName))),
                    h('div', { className: 'tl-studio-edit' },
                        h('nav', { className: 'tl-studio-tabs', 'aria-label': 'Helmet design controls' }, [['helmets', 'Helmets'], ['colors', 'Colors']].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': panel === id, disabled: saving, onClick: () => setPanel(id) }, label))),
                        h('fieldset', { className: 'tl-studio-options', ref: optionsRef, disabled: saving },
                            panel === 'helmets' && h(Section, { title: 'The collection', hint: 'Complete artwork from independent artists' },
                                h('div', { className: 'tl-artwork-grid' }, Helmet.ARTWORKS.map(item => h('button', {
                                    key: item.id, type: 'button', className: 'tl-artwork-choice', 'aria-pressed': spec.assetId === item.id, onClick: () => set({ assetId: item.id }),
                                }, h(TimeLeagueHelmetIcon, { helmet: { ...spec, assetId: item.id, artworkMode: 'original' }, size: 180 }), h('b', null, item.label), h('small', null, `by ${item.artist}`)))),
                                h('p', { className: 'tl-artwork-note' }, 'Each helmet keeps the artist’s complete shell, facemask and details. Choose the original colors or use your team colors.'), modeChoices, attribution),
                            panel === 'colors' && h(React.Fragment, null,
                                h(Section, { title: 'Your colors', hint: 'Color the existing artwork while keeping every detail' }, modeChoices),
                                spec.artworkMode === 'original' ? h('p', { className: 'tl-artwork-note' }, 'You’re using the original artist colors. Choose Team colors to change the shell, stripe and facemask.') : h(React.Fragment, null,
                                    artwork.colors.includes('shell') && h(Section, { title: 'Shell color' }, swatches(Helmet.HELMET_COLORS, spec.shellColor || spec.color, color => set({ color: color.id, shellColor: '' }), 'Shell'), customColor('Shell', Helmet.shellColorFor(spec), 'shellColor')),
                                    artwork.colors.includes('stripe') && h(Section, { title: 'Stripe color' }, swatches(Helmet.ACCENT_COLORS, spec.stripeColor, color => set({ stripeColor: color.hex }), 'Stripe'), customColor('Stripe', spec.stripeColor, 'stripeColor')),
                                    artwork.colors.includes('facemask') && h(Section, { title: 'Facemask color' }, swatches(Helmet.FACEMASK_FINISHES, spec.facemaskColor, color => set({ facemaskColor: color.hex }), 'Facemask'), customColor('Facemask', spec.facemaskColor, 'facemaskColor'))), attribution)))),
                error && h('p', { className: 'tl-studio-error', role: 'alert' }, error),
                h('footer', { className: 'tl-helmet-workshop-actions' },
                    h('button', { type: 'button', className: 'tl-btn', disabled: saving, onClick: close }, 'Cancel'),
                    h('span', null, 'One helmet for every team screen.'),
                    h('button', { type: 'button', className: 'tl-btn primary', disabled: saving, onClick: save }, saving ? 'Saving…' : 'Save helmet'))));
        return h(React.Fragment, null,
            h('span', { className: 'tl-helmet-picker' }, h('button', { type: 'button', className: 'tl-helmet-trigger', title: 'Choose your team helmet', 'aria-label': `Choose ${teamName} helmet`, onClick: launch }, h(TimeLeagueHelmetIcon, { helmet: saved, size: 45 }))),
            editor && window.ReactDOM?.createPortal ? window.ReactDOM.createPortal(editor, document.body) : editor);
    }

    window.TimeLeagueHelmetIcon = TimeLeagueHelmetIcon;
    window.TimeLeagueHelmetPicker = TimeLeagueHelmetPicker;
})();
