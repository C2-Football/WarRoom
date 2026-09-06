// ══════════════════════════════════════════════════════════════════
// js/components/wr-primitives.js — Shared visual primitives
//
// Ports the design language from the Sharp-Terminal mocks into a
// reusable set of components. Every surface that currently rolls its
// own card / badge / chip / delta syntax should migrate to these.
//
// Exposes on window.WR:
//   WR.Card        — standard card wrapper (solid bg, border, radius, padding)
//   WR.Kpi         — KPI tile (label, value, tone, delta/sub sub-line)
//   WR.Badge       — position/type/severity badge with kind→color table
//   WR.Chip        — priority chip (high|medium|low) with label override
//   WR.ConfChip    — AI-confidence chip (auto-classifies pct → HIGH/MED/LOW)
//   WR.DeltaLine   — "↑ +4.1%" / "↓ 2000 → 1850" delta renderer
//   WR.InsightCard — severity-tagged behavioral card with CTA
//   WR.ClampedRead — long-read disclosure: max-height clamp + fade + "Full read"
//   WR.Sheet       — phone (<768) bottom-sheet wrapper (plan D4/D5); at
//                    tablet/desktop it renders `desktop` (or bare children)
//                    so callers keep their existing centered-modal path
//
// Phone pattern kit (iPhone program Phase 0 — CSS partners live in the
// index.html ≤767 block: .wr-seg / .wr-kpi-strip / .wr-sticky-table-wrap /
// .wr-phone-actionbar):
//   WR.HeroCard    — P5 decision hero (kicker / Rajdhani headline / mono
//                    facts / ≤1 solid gold CTA + optional ghost CTA)
//   WR.AssetRow    — P1 56–64px two-line stat-card row (pos badge, name +
//                    tag, ≤3 mono stat slots, verdict chip, chevron)
//   WR.CardList    — P1 grouped AssetRow list w/ gold mono group dividers
//   WR.FilterPill  — P3 trigger pill (mono chip, gold value, 44px on phone)
//   WR.FilterSheet — P3 WR.Sheet wrapper: labeled sections + sticky footer
//   WR.ActionBar   — P6 fixed live-decision strip above the dock; renders
//                    null off-phone / when hidden / while keyboard is open
//
// Depends on: React (loaded globally). WR.Sheet additionally reads
// WR.useViewport from js/shared/viewport.js (a plain script that runs
// before this babel chain — presence is fixed for the page's lifetime).
// ══════════════════════════════════════════════════════════════════

(function () {
    const h = React.createElement;

    // ── Token tables ──────────────────────────────────────────────
    const KIND_COLORS = {
        // positions
        qb: 'var(--k-60a5fa, #60a5fa)', rb: 'var(--k-2ecc71, #2ecc71)', wr: 'var(--k-d4af37, #d4af37)', te: 'var(--k-fbbf24, #fbbf24)',
        k: 'var(--k-a8acb8, #a8acb8)', dl: 'var(--k-fb923c, #fb923c)', lb: 'var(--k-a78bfa, #a78bfa)', db: 'var(--k-f472b6, #f472b6)',
        def: 'var(--k-f87171, #f87171)',
        // transaction / event types
        trade: 'var(--k-9b8afb, #9b8afb)', waiver: 'var(--k-2ecc71, #2ecc71)', fa: 'var(--k-3498db, #3498db)',
        injury: 'var(--k-e74c3c, #e74c3c)', news: 'var(--k-d0d0d0, #d0d0d0)', draft: 'var(--k-f0a500, #f0a500)',
        // fallback / neutral
        neutral: 'var(--k-d0d0d0, #d0d0d0)',
    };

    const SEVERITY = {
        warning:     { color: 'var(--k-e74c3c, #e74c3c)', icon: '\u26A0',  label: 'WARNING' },
        edge:        { color: 'var(--k-2ecc71, #2ecc71)', icon: '\u25CE',  label: 'EDGE' },
        pattern:     { color: 'var(--k-f0a500, #f0a500)', icon: '\u3030',  label: 'PATTERN' },
        opportunity: { color: 'var(--k-3498db, #3498db)', icon: '\uD83D\uDCA1', label: 'OPPORTUNITY' },
    };

    // ── Card ──────────────────────────────────────────────────────
    // Standard solid-bg card — replaces the murky rgba(255,255,255,0.0X)
    // card backgrounds scattered across surfaces.
    function Card({ children, padding, style, accent, onClick, ...rest }) {
        const css = {
            background: 'var(--off-black, var(--k-1a1a1a, #1a1a1a))',
            border: accent ? ('1px solid ' + accent + '33') : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
            borderRadius: 'var(--card-radius, 10px)',
            padding: padding || '14px 16px',
            transition: 'background 0.15s',
            cursor: onClick ? 'pointer' : 'default',
            ...style,
        };
        return h('div', { style: css, onClick, ...rest }, children);
    }

    // ── Badge ─────────────────────────────────────────────────────
    // Compact label tag. `kind` maps to a semantic color via KIND_COLORS.
    function Badge({ label, kind, size }) {
        const color = KIND_COLORS[(kind || '').toLowerCase()] || KIND_COLORS.neutral;
        const s = size === 'sm' ? { fs: '0.56rem', pad: '1px 6px' } : { fs: '0.62rem', pad: '2px 7px' };
        return h('span', {
            style: {
                display: 'inline-flex', alignItems: 'center',
                fontSize: s.fs, fontWeight: 700,
                padding: s.pad, borderRadius: '3px',
                background: wrAlpha(color, '22'), color: color,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'nowrap',
            }
        }, label);
    }

    // ── Chip (priority / generic pill) ────────────────────────────
    function Chip({ level, label }) {
        const tbl = {
            high:   { c: 'var(--k-e74c3c, #e74c3c)', l: label || 'HIGH' },
            medium: { c: 'var(--k-f0a500, #f0a500)', l: label || 'MEDIUM' },
            low:    { c: 'var(--k-d0d0d0, #d0d0d0)', l: label || 'LOW' },
        };
        const t = tbl[(level || 'medium').toLowerCase()] || tbl.medium;
        return h('span', {
            style: {
                display: 'inline-flex', alignItems: 'center',
                fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700,
                padding: '1px 7px', borderRadius: 'var(--card-radius, 10px)',
                background: wrAlpha(t.c, '22'), color: t.c,
                border: '1px solid ' + wrAlpha(t.c, '4d'),
                letterSpacing: '0.08em',
                fontFamily: 'JetBrains Mono, monospace',
            }
        }, t.l);
    }

    // ── ConfChip (AI confidence %) ────────────────────────────────
    // Auto-classifies: ≥80 → HIGH/green, ≥55 → MED/amber, else LOW/silver.
    function ConfChip({ pct, compact }) {
        const n = Math.max(0, Math.min(100, Math.round(pct || 0)));
        const level = n >= 80 ? 'hi' : n >= 55 ? 'med' : 'lo';
        const tbl = {
            hi:  { c: 'var(--k-2ecc71, #2ecc71)', label: 'HIGH' },
            med: { c: 'var(--k-f0a500, #f0a500)', label: 'MEDIUM' },
            lo:  { c: 'var(--k-d0d0d0, #d0d0d0)', label: 'LOW' },
        };
        const t = tbl[level];
        const text = compact ? (n + '%') : (n + '% \u00B7 ' + t.label);
        return h('span', {
            style: {
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 'var(--text-label, 0.75rem)', letterSpacing: '0.08em',
                padding: '1px 7px', borderRadius: 'var(--card-radius, 10px)',
                background: wrAlpha(t.c, '26'), color: t.c,
                border: '1px solid ' + wrAlpha(t.c, '4d'),
                fontWeight: 600,
            }
        }, text);
    }

    // ── DeltaLine ─────────────────────────────────────────────────
    // Renders a change: "↑ +4.1%", "↓ 2000 → 1850", "↗ Bills +4.5 → +3".
    // Self-hides (returns null) when there's no actual change to show.
    //   direction: 'up'|'down'|'flat' — optional; inferred from from/to.
    //   from, to: numeric endpoints. If both set, renders "from → to".
    //   magnitude: pre-formatted string (used when endpoints don't apply).
    //   subject: optional prefix label.
    //   unit: optional suffix (e.g. "%", "DHQ", "pts").
    function DeltaLine({ direction, subject, from, to, magnitude, unit, style }) {
        let dir = direction;
        if (!dir && from != null && to != null) {
            dir = from < to ? 'up' : from > to ? 'down' : 'flat';
        }
        // Nothing to render — silent self-hide prevents empty chrome.
        if (from == null && to == null && magnitude == null) return null;
        const color = dir === 'up' ? 'var(--good)' : dir === 'down' ? 'var(--bad)' : 'var(--silver)';
        const arrow = dir === 'up' ? '\u2191' : dir === 'down' ? '\u2193' : '\u2192';
        const body = magnitude != null
            ? String(magnitude)
            : ((subject ? subject + ' ' : '') + from + ' \u2192 ' + to + (unit ? ' ' + unit : ''));
        return h('span', {
            style: {
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: 'var(--text-label, 0.75rem)', color: color,
                fontFamily: 'JetBrains Mono, monospace',
                ...style,
            }
        }, h('span', null, arrow), h('span', null, body));
    }

    // ── KPI tile ──────────────────────────────────────────────────
    // Large-number tile with label, value, and either a DeltaLine
    // (preferred) or a static sub string underneath.
    //   tone: 'win'|'loss'|'gold'|'mute'|'plain'
    function Kpi({ label, value, sub, tone, delta, onClick }) {
        const valColor = tone === 'win' ? 'var(--k-2ecc71, #2ecc71)'
                       : tone === 'loss' ? 'var(--k-e74c3c, #e74c3c)'
                       : tone === 'gold' ? 'var(--k-d4af37, #d4af37)'
                       : tone === 'mute' ? 'var(--k-d0d0d0, #d0d0d0)'
                       : 'var(--white)';
        const deltaEl = delta ? h(DeltaLine, delta) : null;
        const subEl = !deltaEl && sub
            ? h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '6px', fontFamily: 'JetBrains Mono, monospace' } }, sub)
            : null;
        return h(Card, { padding: '14px 16px', onClick },
            h('div', {
                style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: '8px' }
            }, label),
            h('div', {
                style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.85rem', fontWeight: 700, lineHeight: 1, color: valColor, letterSpacing: 0 }
            }, value != null && value !== '' ? value : '\u2014'),
            deltaEl
                ? h('div', { style: { marginTop: '6px' } }, deltaEl)
                : subEl
        );
    }

    // ── InsightCard ───────────────────────────────────────────────
    // Severity-tagged behavioral insight. The flagship pattern from the
    // Sharp-Terminal mock — mirrored here so any surface (Home widget,
    // Alex Insights tab, drawer) can render one identically.
    // Optional `feedback` prop wires the AI learning loop:
    //   { onUp, onDown, given } — given ('up'|'down') collapses the buttons.
    function InsightCard({ severity, confidence, title, body, ctaLabel, ctaOnClick, icon, compact, feedback }) {
        const s = SEVERITY[(severity || 'pattern').toLowerCase()] || SEVERITY.pattern;
        const color = s.color;
        const bg = wrAlpha(color, '1a');
        const border = wrAlpha(color, '59');
        const iconSize = compact ? 34 : 44;
        const titleSize = compact ? '0.88rem' : '1rem';
        const bodySize = compact ? '0.74rem' : '0.82rem';
        const pad = compact ? '14px 16px' : '18px 20px';
        return h('div', {
            style: {
                position: 'relative', overflow: 'hidden',
                display: 'grid', gridTemplateColumns: iconSize + 'px 1fr',
                gap: compact ? '12px' : '14px', alignItems: 'flex-start',
                background: 'var(--off-black, var(--k-1a1a1a, #1a1a1a))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                borderRadius: 'var(--card-radius-lg, 14px)', padding: pad,
            }
        },
            h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, ' + bg + ' 0%, transparent 55%)', opacity: 0.5, borderRadius: 'var(--card-radius-lg, 14px)' } }),
            h('div', {
                style: {
                    width: iconSize + 'px', height: iconSize + 'px', borderRadius: 'var(--card-radius, 10px)', flexShrink: 0,
                    background: bg, border: '1px solid ' + border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: compact ? '1rem' : '1.25rem', color: color,
                    position: 'relative', zIndex: 1,
                }
            }, icon || s.icon),
            h('div', { style: { position: 'relative', zIndex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px', flexWrap: 'wrap' } },
                    h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: color, letterSpacing: '0.12em', textTransform: 'uppercase' } }, s.label),
                    confidence != null && h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, letterSpacing: '0.06em' } },
                        'CONF ',
                        h('strong', { style: { color: 'var(--silver)', opacity: 0.9, fontWeight: 700 } }, confidence + '%')
                    )
                ),
                h('h3', { style: { fontSize: titleSize, fontWeight: 700, color: 'var(--white)', lineHeight: 1.35, margin: '0 0 5px' } }, title),
                body && h('p', { style: { fontSize: bodySize, color: 'var(--silver)', opacity: 0.85, lineHeight: 1.55, margin: '0 0 ' + (ctaLabel ? '12px' : '0') } }, body),
                ctaLabel && h('button', {
                    onClick: ctaOnClick,
                    style: {
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '6px 12px', borderRadius: 'var(--card-radius-xs, 5px)', minHeight: '44px',
                        background: bg, border: '1px solid ' + border, color: color,
                        fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'DM Sans, sans-serif',
                    }
                }, ctaLabel, h('span', { style: { fontSize: '1rem', lineHeight: 0.8 } }, '\u203A')),
                feedback && h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' } },
                    feedback.given
                        ? h('span', { style: { fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.5 } }, 'Thanks \u2014 Alex learns from this.')
                        : [
                            h('span', { key: 'q', style: { fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.45 } }, 'Useful?'),
                            h('button', { key: 'up', onClick: feedback.onUp, style: { background: 'none', border: 'none', color: 'var(--silver)', opacity: 0.5, cursor: 'pointer', fontSize: '0.78rem', padding: '0 4px' } }, '\uD83D\uDC4D'),
                            h('button', { key: 'down', onClick: feedback.onDown, style: { background: 'none', border: 'none', color: 'var(--silver)', opacity: 0.5, cursor: 'pointer', fontSize: '0.78rem', padding: '0 4px' } }, '\uD83D\uDC4E'),
                        ]
                )
            )
        );
    }

    // ── TradeIdeaCard ─────────────────────────────────────────────
    // Renders a TRADE_CARD block (yourSide/theirSide/target/sleeperDM) —
    // the structured trade proposal 'trade-chat' emits. Extracted from the
    // Ask-Alex chat renderer (league-detail.js) so a one-shot trigger
    // (player card, My Roster) gets the same fairness-bar/Copy-DM/Save
    // treatment without needing the chat panel it used to live inside.
    function TradeIdeaCard({ tradeCard, leagueId }) {
        if (!tradeCard) return null;
        const yours = (tradeCard.yourSide || []).reduce((s, a) => s + (a.dhq || 0), 0);
        const theirs = (tradeCard.theirSide || []).reduce((s, a) => s + (a.dhq || 0), 0);
        const diff = theirs - yours;
        const pct = yours > 0 ? Math.round((diff / yours) * 100) : 0;
        const color = pct >= 5 ? 'var(--k-2ecc71, #2ecc71)' : pct >= -5 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)';
        const label = pct >= 5 ? 'You win by ' + pct + '%' : pct >= -5 ? 'Fair trade' : 'You lose by ' + Math.abs(pct) + '%';
        const side = (assets, headLabel) => h('div', null,
            h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px', fontFamily: 'var(--font-body)', textTransform: 'uppercase' } }, headLabel),
            (assets || []).map((a, j) => h('div', { key: j, style: { padding: '3px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' } },
                h('span', { style: { color: 'var(--text-primary)' } }, a.name),
                h('span', { style: { color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', marginLeft: '4px' } }, (a.dhq || 0).toLocaleString() + ' DHQ')
            )),
            h('div', { style: { marginTop: '4px', fontWeight: 700, color: 'var(--gold)', fontSize: 'var(--text-label, 0.75rem)' } },
                'Total: ' + (assets || []).reduce((s, a) => s + (a.dhq || 0), 0).toLocaleString())
        );
        return h('div', { style: { marginTop: '10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', padding: '10px', fontSize: 'var(--text-body, 1rem)' } },
            h('div', { style: { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' } },
                'Proposed Trade' + (tradeCard.target ? ' → ' + tradeCard.target : '')),
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'start' } },
                side(tradeCard.yourSide, 'You Give'),
                h('div', { style: { display: 'flex', alignItems: 'center', fontSize: '1.2rem', color: 'var(--gold)', paddingTop: '16px' } }, '⇄'),
                side(tradeCard.theirSide, 'You Get')
            ),
            h('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' } },
                h('div', { style: { flex: 1, height: '4px', borderRadius: '2px', background: 'var(--ov-5, rgba(255,255,255,0.08))', overflow: 'hidden' } },
                    h('div', { style: { width: Math.min(100, 50 + pct) + '%', height: '100%', background: color, borderRadius: '2px' } })),
                h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color, fontFamily: 'var(--font-body)' } }, label)
            ),
            h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
                tradeCard.sleeperDM && h('button', {
                    onClick: () => { try { navigator.clipboard.writeText(tradeCard.sleeperDM); } catch (_) {} },
                    style: { padding: '5px 12px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', background: 'linear-gradient(135deg, var(--k-7c6bf8, #7c6bf8), var(--k-9b8afb, #9b8afb))', color: 'var(--k-ffffff, #ffffff)', border: 'none', borderRadius: 'var(--card-radius-lg, 14px)', cursor: 'pointer', minHeight: '32px' },
                }, 'Copy DM'),
                h('button', {
                    onClick: () => {
                        if (!leagueId) return;
                        const P = window.WrTradePipeline;
                        if (P) { P.append(leagueId, P.fromAlexCard(tradeCard)); return; }
                        // trade-calc.js (WrTradePipeline's home) is deferred — if it
                        // hasn't loaded yet, write the legacy shape; normalizeAll()
                        // migrates it on the next Trade Log read.
                        const keys = window.App?.WR_KEYS || window.WR_KEYS;
                        const storage = window.App?.WrStorage || window.WrStorage;
                        if (!keys?.SAVED_TRADES || !storage) return;
                        const saved = storage.get(keys.SAVED_TRADES(leagueId)) || [];
                        saved.unshift({ ...tradeCard, savedAt: Date.now() });
                        storage.set(keys.SAVED_TRADES(leagueId), saved.slice(0, 60));
                    },
                    style: { padding: '5px 12px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-lg, 14px)', cursor: 'pointer', minHeight: '32px' },
                }, 'Save')
            )
        );
    }

    // ── ClampedRead ───────────────────────────────────────────────
    // Long-read disclosure, extracted from the My Roster Dynasty Read
    // pattern (js/tabs/my-team.js): clamps content to `maxHeight` px with
    // a gradient fade + "▾ Full read" toggle. Only clamps when the content
    // actually overflows (short reads render in full, zero extra chrome).
    //   text      — plain string content (styled via `style`), OR
    //   children  — pre-styled content nodes (text wins if both given).
    //   maxHeight — collapsed height in px (default 104 ≈ 4 lines).
    //   style     — style object for the content div (both modes).
    //   fadeColor — color the fade dissolves into (match the surface bg).
    // Consume guarded: window.WR?.ClampedRead (script-order safety).
    function ClampedRead({ text, children, maxHeight, style, fadeColor }) {
        const limit = maxHeight || 104;
        const [open, setOpen] = React.useState(false);
        const [overflow, setOverflow] = React.useState(false);
        const ref = React.useRef(null);
        // Measure the UNclamped inner div (it grows freely inside the hidden-
        // overflow wrapper, so scrollHeight is the true content height). The
        // ResizeObserver catches async content swaps (AI text replacing a
        // template) and container reflow without extra deps.
        React.useLayoutEffect(() => {
            const el = ref.current;
            if (!el) return;
            const measure = () => setOverflow(el.scrollHeight > limit + 8);
            measure();
            if (typeof ResizeObserver === 'undefined') return;
            const ro = new ResizeObserver(measure);
            ro.observe(el);
            return () => ro.disconnect();
        }, [text, limit]);
        const clamped = overflow && !open;
        const fade = fadeColor || 'var(--surf-solid, rgba(12,12,18,0.99))';
        return h('div', null,
            h('div', { style: { position: 'relative', maxHeight: clamped ? limit + 'px' : 'none', overflow: clamped ? 'hidden' : 'visible' } },
                h('div', { ref: ref, style: style }, text != null ? text : children),
                clamped ? h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '38px', background: 'linear-gradient(180deg, transparent, ' + fade + ')', pointerEvents: 'none' } }) : null
            ),
            overflow ? h('button', {
                onClick: (e) => { e.stopPropagation(); setOpen(v => !v); },
                style: { marginTop: '6px', fontSize: '0.72rem', color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)' }
            }, open ? '▴ Show less' : '▾ Full read') : null
        );
    }

    // ── Sheet (phone bottom sheet — plan D4/D5) ───────────────────
    // Full-width bottom sheet at the phone tier (<768). Contract:
    //   open      — render gate; false → null.
    //   onClose   — called by scrim tap, ✕, and drag-down past ~80px.
    //   title     — optional mono micro-caps header label.
    //   children  — sheet content; the sheet BODY is the scroll container.
    //   height    — max height, default '85dvh' (D9 landscape-safe cap).
    //   showClose — default true (44px ✕ in the header row); pass false
    //               when the content carries its own 44px close control
    //               (e.g. the player-card hero ✕) to avoid a duplicate.
    //   desktop   — optional element returned at ≥768; defaults to bare
    //               children. Callers normally branch on
    //               WR.useViewport().isPhone and keep their existing
    //               centered-modal markup for tablet/desktop, so the
    //               desktop path here is only a rotation-mid-open safety.
    // Keyboard (D5): when WR.useViewport reports kbOpen, the sheet lifts
    // by kbHeight (bottom offset) and its max-height shrinks so content
    // compresses instead of hiding under the keyboard; any input focused
    // inside the body re-centers after a ~320ms keyboard-settle delay.
    // Body scroll is locked while a phone sheet is open. z sits at
    // var(--wr-z-sheet, 200) — above the phone dock (100), below toasts.
    function ensureSheetCss() {
        if (document.getElementById('wr-sheet-css')) return;
        const st = document.createElement('style');
        st.id = 'wr-sheet-css';
        st.textContent = [
            '@keyframes wrSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}',
            '@keyframes wrSheetScrim{from{opacity:0}to{opacity:1}}',
            /* Shared: horizontal scroll strips (tab strips, chip rows) hide their
               scrollbar; scroll-padding keeps the first/last chip off the hard
               container edge (owner iPhone pass 2026-07-12). */
            '.wr-hscroll{scrollbar-width:none;scroll-padding-inline:8px}',
            '.wr-hscroll::-webkit-scrollbar{display:none}',
            /* Media/charts inside a sheet never force horizontal scroll (D4). */
            '.wr-sheet-body img,.wr-sheet-body svg,.wr-sheet-body canvas{max-width:100%}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function Sheet({ open, onClose, title, children, height, showClose, desktop }) {
        // Hook-order safety: viewport.js is a plain script loaded before the
        // babel chain, so this branch is fixed for the page's lifetime.
        const useVp = window.WR && window.WR.useViewport;
        const vp = useVp ? useVp() : { isPhone: false, kbOpen: false, kbHeight: 0 };
        const sheetRef = React.useRef(null);
        const dragRef = React.useRef(null);
        const locked = !!(open && vp.isPhone);
        React.useEffect(() => {
            if (!locked) return undefined;
            const prev = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = prev; };
        }, [locked]);

        if (!open) return null;
        if (!vp.isPhone) return (desktop !== undefined ? desktop : children) || null;

        ensureSheetCss();
        // Landscape phones (SE at 667×375 stays in the phone tier): the 85dvh
        // default leaves ~320px — take the full height; the kbOpen min() at
        // the style site still shrinks it when a keyboard is up.
        // Landscape phones took the full height, which also removed the scrim —
        // leaving a sheet with no tap-outside escape. Keep a strip of backdrop.
        const maxH = vp.height <= 520 ? '94dvh' : (height || '85dvh');
        // A full-height sheet reaches the top of the screen, so its header row
        // lands under the status bar / notch — the body already pads for --sab
        // but nothing padded the top. Only full-height sheets need it; the
        // default 85dvh never gets near the inset.
        const topInset = /^(9[2-9]|100)dvh$/.test(String(maxH)) ? 'var(--sat, env(safe-area-inset-top, 0px))' : '';
        const lift = vp.kbOpen ? vp.kbHeight : 0;
        const hasHeaderRow = !!title || showClose !== false;

        // Drag-to-dismiss on the grab strip: ref-based (no re-render per move);
        // >80px pull releases into onClose, anything less springs back.
        function onGrabStart(e) {
            if (!e.touches || e.touches.length !== 1) return;
            dragRef.current = { y0: e.touches[0].clientY, dy: 0 };
            if (sheetRef.current) sheetRef.current.style.transition = 'none';
        }
        function onGrabMove(e) {
            const d = dragRef.current;
            if (!d || !e.touches || !e.touches.length) return;
            d.dy = Math.max(0, e.touches[0].clientY - d.y0);
            if (sheetRef.current) sheetRef.current.style.transform = 'translateY(' + d.dy + 'px)';
        }
        function onGrabEnd() {
            const d = dragRef.current;
            dragRef.current = null;
            const el = sheetRef.current;
            if (el) el.style.transition = '';
            if (d && d.dy > 80) { if (onClose) onClose(); }
            else if (el) el.style.transform = '';
        }
        // D5 contract: focused input re-centers in the (scrolling) sheet body
        // after the iOS keyboard settles. React's onFocus bubbles (focusin).
        function onBodyFocus(e) {
            const t = e.target;
            if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
            setTimeout(() => {
                try { if (t.isConnected) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { /* noop */ }
            }, 320);
        }

        return h('div', {
            className: 'wr-sheet-backdrop',
            style: {
                position: 'fixed', inset: 0,
                zIndex: 'var(--wr-z-sheet, 200)',
                background: 'rgba(3, 4, 7, 0.6)',
                animation: 'wrSheetScrim 0.18s ease',
                // iOS ignores body overflow:hidden for touch — the scrim is a
                // pure tap target, so killing its touch gestures stops drags
                // from rubber-banding the page behind the sheet.
                touchAction: 'none',
            },
            onClick: (e) => { if (e.target === e.currentTarget && onClose) onClose(); },
        },
            h('div', {
                ref: sheetRef,
                className: 'wr-sheet',
                role: 'dialog',
                'aria-modal': 'true',
                style: {
                    position: 'absolute', left: 0, right: 0, bottom: lift + 'px',
                    display: 'flex', flexDirection: 'column',
                    maxHeight: vp.kbOpen ? 'min(' + maxH + ', calc(100dvh - ' + (lift + 12) + 'px))' : maxH,
                    background: 'var(--k-0a0b0d, #0a0b0d)',
                    borderTop: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                    borderRadius: '14px 14px 0 0',
                    boxShadow: '0 -18px 60px rgba(0,0,0,0.7)',
                    animation: 'wrSheetUp 0.24s cubic-bezier(0.22, 0.9, 0.32, 1)',
                    transition: 'bottom 0.2s ease, max-height 0.2s ease',
                },
            },
                h('div', {
                    className: 'wr-sheet-grab',
                    style: {
                        flex: 'none', position: 'relative',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                        minHeight: hasHeaderRow ? '44px' : '24px',
                        padding: hasHeaderRow
                            ? 'calc(10px + ' + (topInset || '0px') + ') 10px 2px 16px'
                            : (topInset ? topInset + ' 0 0' : '0'),
                        touchAction: 'none',
                    },
                    onTouchStart: onGrabStart,
                    onTouchMove: onGrabMove,
                    onTouchEnd: onGrabEnd,
                    onTouchCancel: onGrabEnd,
                },
                    h('div', {
                        'aria-hidden': 'true',
                        style: { position: 'absolute', top: 'calc(6px + ' + (topInset || '0px') + ')', left: '50%', transform: 'translateX(-50%)', width: '38px', height: '4px', borderRadius: '2px', background: 'var(--ov-6, rgba(255,255,255,0.16))' }
                    }),
                    title
                        ? h('div', {
                            style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', paddingTop: '8px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                        }, title)
                        : (hasHeaderRow ? h('span') : null),
                    showClose !== false ? h('button', {
                        onClick: onClose,
                        'aria-label': 'Close',
                        style: { background: 'none', border: '1px solid var(--ov-6, rgba(255,255,255,0.12))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
                    }, '✕') : null
                ),
                h('div', {
                    className: 'wr-sheet-body',
                    onFocus: onBodyFocus,
                    style: {
                        flex: '1 1 auto', minHeight: 0,
                        overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
                        paddingBottom: 'calc(12px + var(--sab, env(safe-area-inset-bottom, 0px)))',
                    },
                }, children)
            )
        );
    }

    // ══ Phone pattern kit (iPhone program Phase 0) ════════════════════
    // Design source: mockups/_gallery/screens (approved phone panes).
    // All kit components are plain h() function components. HeroCard /
    // AssetRow / CardList render on ANY tier (callers gate on
    // WR.useViewport().isPhone); FilterSheet gates via WR.Sheet;
    // ActionBar and FilterPill call WR.useViewport themselves —
    // unconditionally, so hook order stays stable across resizes.

    // Shared tone → color table for slot values / ActionBar value.
    const TONE_COLORS = {
        good: 'var(--good, #2ecc71)',
        bad:  'var(--bad, #e74c3c)',
        warn: 'var(--warn, #f0a500)',
        gold: 'var(--gold, #d4af37)',
        mute: 'var(--text-muted, #8B8B96)',
    };
    const toneColor = (tone) => TONE_COLORS[tone] || 'var(--white, #f5f5f5)';

    // Position badge tints — the calm desaturated scheme from the approved
    // mockup design system (QB red / RB green / WR blue / TE amber /
    // K purple / DEF silver); IDP + unknown fall back to neutral.
    const POS_TINTS = {
        QB:  { bg: 'rgba(231,76,60,0.16)',   fg: '#F0997B' },
        RB:  { bg: 'rgba(46,204,113,0.14)',  fg: '#5DCAA5' },
        WR:  { bg: 'rgba(93,173,226,0.16)',  fg: '#85B7EB' },
        TE:  { bg: 'rgba(240,165,0,0.15)',   fg: '#FAC775' },
        K:   { bg: 'rgba(155,138,251,0.15)', fg: '#B4A9F7' },
        PK:  { bg: 'rgba(155,138,251,0.15)', fg: '#B4A9F7' },
        DEF: { bg: 'rgba(189,184,173,0.12)', fg: 'var(--silver, #BDB8AD)' },
    };

    // ── HeroCard (P5 decision hero) ───────────────────────────────
    // Gold-bordered card: mono gold caps kicker → Rajdhani headline →
    // mono silver facts → ≤1 solid gold CTA + optional ghost CTA.
    function HeroCard({ kicker, headline, facts, cta, ctaGhost, onCta, onCtaGhost, children }) {
        const ctaBase = {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginTop: '9px', minHeight: '44px', padding: '8px 14px',
            borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer',
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
        };
        return h('div', {
            style: {
                background: 'var(--black, #121217)',
                border: '1px solid var(--acc-line3, rgba(212,175,55,0.4))',
                borderRadius: 'var(--card-radius, 10px)',
                padding: '12px 14px',
            }
        },
            kicker != null && h('div', {
                style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' }
            }, kicker),
            headline != null && h('div', {
                style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.02em', lineHeight: 1.15, margin: '3px 0 1px' }
            }, headline),
            facts != null && h('div', {
                style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 500, color: 'var(--silver)', lineHeight: 1.5 }
            }, facts),
            children,
            (cta || ctaGhost) && h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                cta && h('button', {
                    onClick: onCta,
                    style: { ...ctaBase, background: 'var(--gold)', color: 'var(--page-bg, #0A0A0F)', border: 'none' }
                }, cta),
                ctaGhost && h('button', {
                    onClick: onCtaGhost,
                    style: { ...ctaBase, background: 'transparent', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.5)' }
                }, ctaGhost)
            )
        );
    }

    // ── AssetRow (P1 stat-card row) ───────────────────────────────
    // 56–64px two-line row: pos badge (or player photo, see `pid`) · name+tag
    // · up to 3 mono stat slots [{label, value, tone}] · `verdict` node · chevron.
    //   accent   — 'gold' | 'risk' border tint.
    //   pid      — optional Sleeper player id. When present the leading
    //              30×30 badge shows the real sleepercdn headshot (falling
    //              back to the same pos-tinted initials square on image
    //              error/missing photo) instead of the plain position
    //              letters. Same pattern as free-agency.js's PlayerAvatar —
    //              omit `pid` for non-player rows and the letter square is
    //              unchanged.
    //   expanded — renders `children` full-width below the row inside
    //              the same card (row tap is the only toggle; children
    //              clicks don't re-toggle).
    //   ...rest  — forwarded to the card root (data-* hooks etc.).
    function AssetRow({ pos, pid, name, tag, slots, verdict, onClick, expanded, children, accent, ...rest }) {
        const tint = POS_TINTS[String(pos || '').toUpperCase()] || { bg: 'var(--ov-4, rgba(255,255,255,0.06))', fg: 'var(--silver, #BDB8AD)' };
        const borderColor = accent === 'gold' ? 'rgba(212,175,55,0.4)'
            : accent === 'risk' ? 'rgba(240,165,0,0.4)'
            : 'rgba(255,255,255,0.06)';
        const onKey = onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined;
        return h('div', {
            style: {
                background: 'var(--black, #121217)',
                border: '1px solid ' + borderColor,
                borderRadius: 'var(--card-radius, 10px)',
                overflow: 'hidden',
            },
            ...rest,
            // Babel's shared browser helpers can leak onClick into rest when
            // deferred scripts load. Only the header should toggle this card.
            onClick: undefined,
        },
            h('div', {
                role: onClick ? 'button' : undefined,
                'aria-expanded': onClick && expanded !== undefined ? !!expanded : undefined,
                tabIndex: onClick ? 0 : undefined,
                onClick: onClick,
                onKeyDown: onKey,
                style: {
                    display: 'flex', alignItems: 'center', gap: '9px',
                    minHeight: '56px', padding: '9px 10px',
                    cursor: onClick ? 'pointer' : 'default',
                },
            },
                pid ? h('span', {
                    style: {
                        width: '30px', height: '30px', borderRadius: 'var(--card-radius-sm, 8px)', flexShrink: 0,
                        position: 'relative', display: 'inline-flex', overflow: 'hidden',
                        background: tint.bg, border: '1px solid rgba(255,255,255,0.14)',
                    }
                },
                    h('img', {
                        src: 'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg',
                        alt: '',
                        onError: (e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'; },
                        style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' },
                    }),
                    // Initials fallback — same pos-tinted look as the plain
                    // letter badge below, shown only if the photo 404s.
                    h('span', {
                        style: {
                            display: 'none', position: 'absolute', inset: 0,
                            alignItems: 'center', justifyContent: 'center',
                            color: tint.fg, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                            fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700,
                        }
                    }, String(name || pos || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase())
                ) : h('span', {
                    style: {
                        width: '30px', height: '30px', borderRadius: 'var(--card-radius-sm, 8px)', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: tint.bg, color: tint.fg,
                        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                        fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700,
                    }
                }, pos),
                h('div', { style: { flex: '1 1 76px', minWidth: 0 } },
                    // flex-basis 76px (not the bare 0% that `flex: 1` implies) gives the
                    // name a real starting share before the fixed-width slots/verdict/
                    // chevron eat the row — without it, names were squeezed to ~2-3
                    // visible characters ("Danie…") on 375px phones. Two-line clamp
                    // (vs. single-line ellipsis) so a still-tight name reads in full
                    // ("Aaron / Rodgers") instead of truncating mid-word.
                    h('div', { style: { fontFamily: 'var(--font-body, "DM Sans", sans-serif)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--white)', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' } }, name),
                    tag != null && h('div', { style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 500, color: 'var(--text-muted, #8B8B96)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' } }, tag)
                ),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 } },
                    ...(slots || []).slice(0, 3).map((s, i) => h('div', { key: 'slot-' + i, style: { textAlign: 'right', minWidth: '32px' } },
                        // `strong` slots (the signature DHQ value) render gold +
                        // a notch larger so they read as the row's headline stat.
                        h('div', { style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: s.strong ? 700 : 500, color: s.strong ? 'var(--gold)' : 'var(--text-muted, #55555f)', textTransform: 'uppercase', letterSpacing: '0.02em' } }, s.label),
                        h('div', { style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: s.strong ? '0.98rem' : '0.8rem', fontWeight: s.strong ? 700 : 600, color: s.strong ? 'var(--gold)' : toneColor(s.tone) } }, s.value != null && s.value !== '' ? s.value : '—')
                    )),
                    // Verdict clamp (owner iPhone pass 2026-07-12, widened 2026-08-09):
                    // an unclamped chip here squeezed the name column to ~2 chars on
                    // 375px rows with three slots — cap and ellipsize. 92px cut off
                    // two-word verdicts mid-word ("Build Around" → "BUILD AROUN…");
                    // 108px is still well short of the original bug's threshold but
                    // fits the longest current verdict label in full.
                    verdict ? h('div', { style: { maxWidth: '108px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 } }, verdict) : null,
                    h('span', { 'aria-hidden': 'true', style: { color: 'var(--text-muted, #55555f)', fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: '0.9rem', fontWeight: 600, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } }, '›')
                )
            ),
            expanded && children ? h('div', {
                // Children carry their own interactive controls — don't let
                // taps inside the dossier re-toggle the row.
                onClick: (e) => e.stopPropagation(),
                style: { borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.07))', padding: '10px 12px' },
            }, children) : null
        );
    }

    // ── CardList (P1 grouped list) ────────────────────────────────
    // groups: [{ label, sub, rows }] — rows are prebuilt nodes (normally
    // AssetRows). `label` null/'' skips the divider (group mode "none").
    function CardList({ groups }) {
        const out = [];
        (groups || []).forEach((g, gi) => {
            if (g.label) {
                out.push(h('div', { key: 'div-' + gi, style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: gi === 0 ? 0 : '2px' } },
                    h('span', { style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' } }, g.label),
                    g.sub != null && h('span', { style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' } }, g.sub),
                    h('span', { 'aria-hidden': 'true', style: { flex: 1, height: '1px', background: 'rgba(212,175,55,0.25)' } })
                ));
            }
            out.push.apply(out, g.rows || []);
        });
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, out);
    }

    // ── FilterPill (P3 trigger pill) ──────────────────────────────
    // Mono chip w/ gold value. 44px tap height on the phone tier only —
    // hook called unconditionally (hook-order safety), tiers just style.
    function FilterPill({ label, value, onClick }) {
        const useVp = window.WR && window.WR.useViewport;
        const vp = useVp ? useVp() : { isPhone: false };
        return h('button', {
            onClick: onClick,
            style: {
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                minHeight: vp.isPhone ? '44px' : undefined,
                background: 'var(--black, #121217)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '16px', padding: '7px 11px',
                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600,
                color: 'var(--silver)', letterSpacing: '0.03em',
                textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: 'pointer',
                flexShrink: 0,
            }
        },
            label,
            // Value clamp (owner iPhone pass 2026-07-12): partner/team names
            // ride in pills (Trade Desk) — a 20-char name ballooned the pill.
            value != null && value !== '' ? h('b', { style: { color: 'var(--gold)', fontWeight: 600, maxWidth: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' } }, value) : null
        );
    }

    // ── FilterSheet (P3 filter/controls sheet) ────────────────────
    // WR.Sheet wrapper: `sections` [{label, node}] with mono caps labels
    // + a sticky `footer` row (Reset/Apply area) pinned inside the sheet
    // body scroller. Phone-only by construction — WR.Sheet gates, and
    // `desktop: null` keeps a rotation-mid-open from dumping the controls
    // inline on tablet/desktop.
    function FilterSheet({ open, onClose, title, sections, footer }) {
        return h(Sheet, { open: open, onClose: onClose, title: title, desktop: null },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px 16px 0' } },
                ...(sections || []).map((s, i) => h('div', { key: 'sec-' + i },
                    s.label != null && h('div', {
                        style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--silver)', opacity: 0.65, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }
                    }, s.label),
                    s.node
                ))
            ),
            footer ? h('div', {
                style: {
                    position: 'sticky', bottom: 0, marginTop: '14px',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 16px',
                    background: 'var(--k-0a0b0d, #0a0b0d)',
                    borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.07))',
                }
            }, footer) : null
        );
    }

    // ── Select (one filter control for every screen) ──────────────
    // Replaces the app's 64 hand-styled native <select>s and their six
    // competing style objects (league-map selectStyle, my-team
    // rosterSelectStyle, free-agency rkSelectStyle/_faSheetSelect,
    // trade-calc + command-center selStyle). One API, two presentations:
    // a FilterPill-styled trigger everywhere, opening an anchored popover
    // listbox on desktop/tablet and the existing WR.Sheet on phone — so the
    // pill row that shipped on phone is now the control on every tier.
    //
    //   WR.Select({ label, value, options, onChange })
    //   options: ['a','b'] | [{ value, label, sub, disabled }]
    //
    // A native <select> can't style its own option list (the OS draws it),
    // which is the actually-dated part on desktop; this owns the list. The
    // trigger keeps button semantics + aria-haspopup/expanded, and the list
    // is a real listbox with arrow/Home/End/Enter/Escape keys, so it stays
    // keyboard- and screen-reader-usable without the native element.
    function Select(opts) {
        const o = opts || {};
        const useVp = window.WR && window.WR.useViewport;
        const vp = useVp ? useVp() : { isPhone: false };
        const [open, setOpen] = React.useState(false);
        const [activeIdx, setActiveIdx] = React.useState(-1);
        const wrapRef = React.useRef(null);
        const listRef = React.useRef(null);

        const items = (o.options || []).map(it => (
            it && typeof it === 'object' ? it : { value: it, label: String(it) }
        ));
        const selIdx = items.findIndex(it => String(it.value) === String(o.value));
        const current = selIdx >= 0 ? items[selIdx] : null;
        const disabled = !!o.disabled || !items.length;

        // Close on outside pointer / Escape / scroll of an ancestor. Pointerdown
        // (not click) so the popover is gone before the click lands underneath.
        React.useEffect(() => {
            if (!open || vp.isPhone) return undefined;
            const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
            const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); } };
            document.addEventListener('pointerdown', onDown, true);
            document.addEventListener('keydown', onKey, true);
            return () => {
                document.removeEventListener('pointerdown', onDown, true);
                document.removeEventListener('keydown', onKey, true);
            };
        }, [open, vp.isPhone]);

        React.useEffect(() => { if (open) setActiveIdx(selIdx >= 0 ? selIdx : 0); }, [open]);
        React.useEffect(() => {
            if (!open || vp.isPhone || activeIdx < 0 || !listRef.current) return;
            const el = listRef.current.children[activeIdx];
            if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older WebKit */ } }
        }, [open, activeIdx, vp.isPhone]);

        function choose(it) {
            setOpen(false);
            if (it && !it.disabled && o.onChange) o.onChange(it.value, it);
        }
        function onTriggerKey(e) {
            if (disabled) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); setOpen(true);
            }
        }
        function onListKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(items[activeIdx]); return; }
            let next = activeIdx;
            if (e.key === 'ArrowDown') next = Math.min(items.length - 1, activeIdx + 1);
            else if (e.key === 'ArrowUp') next = Math.max(0, activeIdx - 1);
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = items.length - 1;
            else return;
            e.preventDefault();
            setActiveIdx(next);
        }

        // Trigger — FilterPill's exact language so a Select and a FilterPill
        // can sit in the same row without reading as two different controls.
        const isSet = !!o.active || (current && o.defaultValue !== undefined && String(o.value) !== String(o.defaultValue));
        const trigger = h('button', {
            type: 'button',
            disabled: disabled,
            'aria-haspopup': 'listbox',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': o.title || o.label || undefined,
            title: o.title || undefined,
            onClick: () => { if (!disabled) setOpen(v => !v); },
            onKeyDown: onTriggerKey,
            style: {
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                minHeight: vp.isPhone ? '44px' : '30px',
                maxWidth: '100%',
                background: 'var(--black, #121217)',
                border: '1px solid ' + (open || isSet ? 'var(--acc-line2, rgba(212,175,55,0.32))' : 'rgba(255,255,255,0.08)'),
                borderRadius: '16px', padding: '5px 10px',
                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600,
                color: 'var(--silver)', letterSpacing: '0.03em',
                textTransform: 'uppercase', whiteSpace: 'nowrap',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.45 : 1,
                flexShrink: 0, position: 'relative',
            },
        },
            o.label ? h('span', null, o.label) : null,
            h('b', {
                // Was a hard 112px cap, which truncated mid-word in a narrow
                // cell — "7.01 - THE BENGHAZI BULLIES" rendered "7.01 - THE BE…"
                // even when the pill had room. Shrink to fit the trigger instead
                // and only ellipsize when it actually runs out.
                style: { color: 'var(--gold)', fontWeight: 600, flex: '0 1 auto', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }
            }, current ? current.label : (o.placeholder || 'Any')),
            h('span', {
                'aria-hidden': 'true',
                style: { color: 'var(--silver)', opacity: 0.7, fontSize: '0.6rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.12s ease', lineHeight: 1 }
            }, '▾')
        );

        const rows = (onPick) => items.map((it, i) => h('div', {
            key: String(it.value) + ':' + i,
            role: 'option',
            'aria-selected': i === selIdx ? 'true' : 'false',
            'aria-disabled': it.disabled ? 'true' : undefined,
            onClick: () => { if (!it.disabled) onPick(it); },
            onMouseEnter: () => { if (!vp.isPhone) setActiveIdx(i); },
            style: {
                display: 'flex', alignItems: 'center', gap: '8px',
                minHeight: vp.isPhone ? '44px' : '30px',
                padding: vp.isPhone ? '9px 14px' : '5px 10px',
                cursor: it.disabled ? 'default' : 'pointer',
                opacity: it.disabled ? 0.4 : 1,
                background: i === selIdx ? 'var(--acc-fill2, rgba(212,175,55,0.12))'
                    : (!vp.isPhone && i === activeIdx ? 'var(--ov-3, rgba(255,255,255,0.05))' : 'transparent'),
                color: i === selIdx ? 'var(--gold)' : 'var(--white)',
                fontFamily: 'var(--font-body)', fontSize: vp.isPhone ? '0.9rem' : '0.78rem',
            },
        },
            h('span', { 'aria-hidden': 'true', style: { width: '11px', flexShrink: 0, color: 'var(--gold)', fontSize: '0.7rem' } }, i === selIdx ? '✓' : ''),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.label),
            it.sub ? h('span', { style: { flexShrink: 0, color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-micro, 0.6875rem)' } }, it.sub) : null
        ));

        // Phone: reuse the shipped sheet rather than floating a popover over a
        // 375px screen. Desktop/tablet: anchored popover.
        if (vp.isPhone) {
            return h('span', { ref: wrapRef, style: { display: 'inline-flex', maxWidth: '100%' } },
                trigger,
                Sheet && open ? h(Sheet, { open: true, onClose: () => setOpen(false), title: o.label || 'Select', desktop: null },
                    h('div', { role: 'listbox', style: { padding: '4px 0 8px' } }, rows(choose))
                ) : null
            );
        }
        return h('span', { ref: wrapRef, style: { display: 'inline-flex', position: 'relative', maxWidth: '100%' } },
            trigger,
            open ? h('div', {
                role: 'listbox',
                tabIndex: -1,
                onKeyDown: onListKey,
                // Callback ref doubles as the autofocus hook so arrow keys work
                // the moment the list opens, without a second effect.
                ref: (el) => { listRef.current = el; if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } } },
                style: {
                    position: 'absolute', top: 'calc(100% + 4px)', zIndex: 'var(--wr-z-popover, 400)',
                    [o.align === 'right' ? 'right' : 'left']: 0,
                    minWidth: '100%', maxWidth: '260px', width: 'max-content',
                    maxHeight: '272px', overflowY: 'auto', overscrollBehavior: 'contain',
                    background: 'var(--k-0a0b0d, #0a0b0d)',
                    border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))',
                    borderRadius: 'var(--card-radius-sm, 8px)',
                    boxShadow: '0 14px 38px rgba(0,0,0,0.62)',
                    padding: '4px 0', outline: 'none',
                },
            }, rows(choose)) : null
        );
    }

    // ── ActionBar (P6 live-decision strip) ────────────────────────
    // Fixed .wr-phone-actionbar above the dock (z --wr-z-actionbar, bottom
    // --wr-bottom-inset+8px — both from the index.html ≤767 block). Whole
    // bar taps → onOpen; the gold `actionLabel ▸` taps → onAction. Renders
    // null unless phone && visible && keyboard closed (mirrors the dock).
    // Hook-order safety: WR.useViewport is called unconditionally.
    function ActionBar({ visible, label, value, tone, actionLabel, onAction, onOpen }) {
        const useVp = window.WR && window.WR.useViewport;
        const vp = useVp ? useVp() : { isPhone: false, kbOpen: false };
        if (!vp.isPhone || !visible || vp.kbOpen) return null;
        return h('div', {
            className: 'wr-phone-actionbar',
            role: 'button',
            tabIndex: 0,
            onClick: onOpen,
            onKeyDown: onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e); } } : undefined,
            style: { cursor: onOpen ? 'pointer' : 'default' },
        },
            label != null && h('span', { style: { color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 } }, label),
            value != null && h('span', { style: { color: toneColor(tone), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value),
            actionLabel != null && h('button', {
                onClick: onAction ? (e) => { e.stopPropagation(); onAction(e); } : undefined,
                style: {
                    marginLeft: 'auto', flexShrink: 0,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--gold)', fontFamily: 'inherit', fontSize: 'inherit',
                    fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    padding: '4px 0 4px 8px',
                }
            }, actionLabel + ' ▸')
        );
    }

    // ── dragReorderGrip: pointer-based drag-to-reorder (owner ask 2026-07-13) ──
    // Grip-driven so it never fights list scrolling: spread the returned props
    // onto a handle INSIDE a row that carries data-reorder-key="<key>". A fixed
    // clone of the row follows the pointer, the source row dims, the row under
    // the pointer gets an inset gold insertion line (top/bottom half), and the
    // nearest scrollable ancestor auto-scrolls near its edges. On release,
    // onDrop(dragKey, targetKey, after) fires — consumers keep their own order
    // state. No React state: one module-level session (one pointer drags at a
    // time), all feedback is direct DOM mutation restored on end, so it works
    // identically for mouse, touch, and pencil without re-render churn.
    let _dragSes = null;
    function _dragCleanup() {
        const s = _dragSes;
        if (!s) return;
        _dragSes = null;
        if (s.raf) cancelAnimationFrame(s.raf);
        try { if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost); } catch (e) { /* detached */ }
        try { s.row.style.opacity = s.rowOpacity; } catch (e) { /* row unmounted */ }
        try { if (s.marked) s.marked.style.boxShadow = s.markedShadow; } catch (e) { /* row unmounted */ }
    }
    function _dragRetarget(s) {
        const el = document.elementFromPoint(s.lastX, s.lastY);
        const row = el && el.closest ? el.closest('[data-reorder-key]') : null;
        let targetKey = null, after = false, targetEl = null;
        if (row && row !== s.row) {
            targetKey = row.getAttribute('data-reorder-key');
            const r = row.getBoundingClientRect();
            after = s.lastY > r.top + r.height / 2;
            targetEl = row;
        }
        if (s.marked && (s.marked !== targetEl || s.after !== after)) {
            try { s.marked.style.boxShadow = s.markedShadow; } catch (e) { /* row unmounted */ }
            s.marked = null;
        }
        if (targetEl && (s.marked !== targetEl || s.after !== after)) {
            s.markedShadow = targetEl.style.boxShadow || '';
            targetEl.style.boxShadow = after ? 'inset 0 -2px 0 0 var(--gold, #d4af37)' : 'inset 0 2px 0 0 var(--gold, #d4af37)';
            s.marked = targetEl;
        }
        s.targetKey = targetKey;
        s.after = after;
    }
    function dragReorderGrip(opts) {
        const key = opts && opts.key;
        return {
            onPointerDown: (e) => {
                if (!opts || opts.disabled || _dragSes) return;
                if (e.button != null && e.button !== 0) return;
                const grip = e.currentTarget;
                const row = grip.closest('[data-reorder-key]');
                if (!row) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = row.getBoundingClientRect();
                let scroller = row.parentElement;
                while (scroller && scroller !== document.body) {
                    const cs = getComputedStyle(scroller);
                    if (/(auto|scroll)/.test(cs.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
                    scroller = scroller.parentElement;
                }
                const ghost = row.cloneNode(true);
                ghost.style.cssText += ';position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;margin:0;z-index:9999;pointer-events:none;opacity:0.97;background:var(--black, #121217);border:1px solid var(--acc-line4, rgba(212,175,55,0.55));border-radius:var(--card-radius-sm, 8px);box-shadow:0 12px 30px rgba(0,0,0,0.55);transition:none;';
                document.body.appendChild(ghost);
                _dragSes = {
                    key, grip, row, ghost,
                    onDrop: opts.onDrop,
                    startX: e.clientX, startY: e.clientY,
                    lastX: e.clientX, lastY: e.clientY,
                    scroller: scroller === document.body ? null : scroller,
                    rowOpacity: row.style.opacity || '',
                    marked: null, markedShadow: '', targetKey: null, after: false,
                    scrollVel: 0, raf: 0,
                };
                row.style.opacity = '0.25';
                try { grip.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
                const tick = () => {
                    const ss = _dragSes;
                    if (!ss || ss.key !== key) return;
                    if (ss.scroller && ss.scrollVel) { ss.scroller.scrollTop += ss.scrollVel; _dragRetarget(ss); }
                    ss.raf = requestAnimationFrame(tick);
                };
                _dragSes.raf = requestAnimationFrame(tick);
            },
            onPointerMove: (e) => {
                const s = _dragSes;
                if (!s || s.key !== key) return;
                s.lastX = e.clientX; s.lastY = e.clientY;
                s.ghost.style.transform = 'translate(' + (e.clientX - s.startX) + 'px,' + (e.clientY - s.startY) + 'px)';
                if (s.scroller) {
                    const cr = s.scroller.getBoundingClientRect();
                    const zone = 52;
                    s.scrollVel = e.clientY < cr.top + zone ? -Math.ceil((cr.top + zone - e.clientY) / 6)
                        : e.clientY > cr.bottom - zone ? Math.ceil((e.clientY - (cr.bottom - zone)) / 6) : 0;
                }
                _dragRetarget(s);
            },
            onPointerUp: () => {
                const s = _dragSes;
                if (!s || s.key !== key) return;
                const targetKey = s.targetKey, after = s.after, onDrop = s.onDrop;
                _dragCleanup();
                if (targetKey != null && targetKey !== String(key) && typeof onDrop === 'function') onDrop(key, targetKey, after);
            },
            onPointerCancel: () => { const s = _dragSes; if (s && s.key === key) _dragCleanup(); },
            onClick: (e) => { e.preventDefault(); e.stopPropagation(); },
            onDragStart: (e) => e.preventDefault(),
            style: { touchAction: 'none', cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none' },
        };
    }

    window.WR = window.WR || {};
    window.WR.Card = Card;
    window.WR.Badge = Badge;
    window.WR.Chip = Chip;
    window.WR.ConfChip = ConfChip;
    window.WR.DeltaLine = DeltaLine;
    window.WR.TradeIdeaCard = TradeIdeaCard;
    window.WR.Kpi = Kpi;
    window.WR.InsightCard = InsightCard;
    window.WR.ClampedRead = ClampedRead;
    window.WR.Sheet = Sheet;
    // Phone pattern kit (Phase 0)
    window.WR.HeroCard = HeroCard;
    window.WR.AssetRow = AssetRow;
    window.WR.CardList = CardList;
    window.WR.FilterPill = FilterPill;
    window.WR.FilterSheet = FilterSheet;
    window.WR.Select = Select;
    window.WR.ActionBar = ActionBar;
    window.WR.dragReorderGrip = dragReorderGrip;
    // Inject the shared sheet/hscroll CSS up front (idempotent) so the
    // .wr-hscroll scrollbar-hiding rules exist before any consumer renders.
    ensureSheetCss();
})();
