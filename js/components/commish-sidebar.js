// ══════════════════════════════════════════════════════════════════
// js/components/commish-sidebar.js
//   window.WrCommishSidebar    — the office's persistent left nav
//   window.WrCommishActionPanel — the per-item action drawer
//   window.WrCommishSettingsPanel — managed leagues + alert preferences
//
// The sidebar replaces the sticky top rail: seven desks is too many for a
// horizontal strip (they scrolled out of view), and a commissioner moving
// between desks wants the whole map visible, not a carousel. Groups carry the
// same names everywhere in the office — OPEN THE SEASON / HOLD THE ROOM / THE
// BROADCAST — so the vocabulary is learnable in one pass.
//
// Uses the CO_* token ladder defined on the office shell. No rgba, no opacity,
// no gradients: every tint here is a pre-blended solid.
// ══════════════════════════════════════════════════════════════════
(function () {
    const GOLD = 'var(--gold, #D4AF37)', SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
    const MUTED = '#8D887E', ACCENT = 'var(--co-accent, #5DADE2)';
    const SURF = 'var(--co-surface, #121217)', SURF2 = 'var(--co-surface-2, #1B1B22)';
    const SURF3 = 'var(--co-surface-3, #17171D)', WELL = 'var(--co-well, #0F0F14)';
    const LINE = 'var(--co-line, #27262E)', ACC_FILL = 'var(--co-accent-fill, #12212B)';
    const ACC_LINE = 'var(--co-accent-line, #2B4B63)';
    const BAD = 'var(--bad, #E74C3C)', WARN = 'var(--warn, #F0A500)', GOOD = 'var(--good, #2ECC71)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';

    const label = { font: '700 0.6875rem ' + MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, lineHeight: 1 };
    const chip = { font: '700 0.625rem ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase' };
    const num = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };

    // ── Sidebar ──────────────────────────────────────────────────────
    function WrCommishSidebar({ groups, active, counts, onSelect, onOpenSettings, managedCount, leagueCount, phone, open, onClose }) {
        const Row = ({ hub, name, dormant }) => {
            const isActive = active === hub;
            const n = (counts && counts[hub]) || 0;
            return (
                <button key={hub} onClick={() => { onSelect(hub); if (phone && onClose) onClose(); }}
                    title={dormant ? 'Wakes at Week 1' : undefined}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                        padding: '9px 12px', cursor: 'pointer', border: 'none',
                        borderLeft: '3px solid ' + (isActive ? ACCENT : 'transparent'),
                        background: isActive ? ACC_FILL : 'transparent',
                        color: isActive ? TEXT : (dormant ? MUTED : SILVER),
                        font: (isActive ? 700 : 600) + ' 0.75rem ' + MONO,
                        letterSpacing: '0.06em', textTransform: 'uppercase', minHeight: phone ? '44px' : undefined,
                    }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    {dormant ? <span style={{ ...chip, color: MUTED }}>WK 1</span> : null}
                    {n ? (
                        <span style={{ ...chip, ...num, padding: '1px 6px', borderRadius: '999px', background: isActive ? BAD : 'var(--co-fill-bad, #2A1512)', color: isActive ? '#121217' : BAD }}>{n}</span>
                    ) : null}
                </button>
            );
        };

        const body = (
            <nav aria-label="Commissioner desks" style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: phone ? '260px' : '208px', flex: 'none', background: phone ? SURF : 'transparent', height: phone ? '100%' : undefined, overflowY: phone ? 'auto' : undefined, padding: phone ? '12px 0' : 0 }}>
                <button onClick={() => { onSelect('command'); if (phone && onClose) onClose(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                        padding: '10px 12px', cursor: 'pointer', border: '1px solid ' + (active === 'command' ? ACC_LINE : LINE),
                        borderRadius: '6px', marginBottom: '8px',
                        background: active === 'command' ? ACC_FILL : 'transparent',
                        color: active === 'command' ? ACCENT : SILVER,
                        font: '700 0.75rem ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase',
                        minHeight: phone ? '44px' : undefined,
                    }}>
                    ◧ Command
                </button>

                {(groups || []).map(g => (
                    <div key={g.name} style={{ marginBottom: '10px' }}>
                        <div style={{ ...label, padding: '6px 12px 5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                            {g.dormant ? <span style={{ ...chip, color: ACCENT }}>WK 1</span> : null}
                        </div>
                        {g.hubs.map(h => <Row key={h.hub} hub={h.hub} name={h.name} dormant={h.dormant} />)}
                    </div>
                ))}

                <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: `1px solid ${LINE}` }}>
                    <button onClick={() => { onOpenSettings(); if (phone && onClose) onClose(); }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                            padding: '9px 12px', cursor: 'pointer', border: 'none',
                            borderLeft: '3px solid ' + (active === 'settings' ? ACCENT : 'transparent'),
                            background: active === 'settings' ? ACC_FILL : 'transparent',
                            color: active === 'settings' ? TEXT : SILVER,
                            font: '600 0.75rem ' + MONO, letterSpacing: '0.06em', textTransform: 'uppercase',
                            minHeight: phone ? '44px' : undefined,
                        }}>
                        ⚙ Settings
                    </button>
                    <div style={{ ...label, padding: '8px 12px 0', textTransform: 'none', letterSpacing: 0, lineHeight: 1.4 }}>
                        Managing {managedCount} of {leagueCount} league{leagueCount === 1 ? '' : 's'}
                    </div>
                </div>
            </nav>
        );

        if (!phone) return body;
        if (!open) return null;
        return (
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#08080B', display: 'flex' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: SURF, borderRight: `1px solid ${LINE}`, height: '100%' }}>{body}</div>
                <button onClick={onClose} aria-label="Close menu" style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer' }} />
            </div>
        );
    }

    // ── Action panel ─────────────────────────────────────────────────
    // Opens on any queue row. Shows the full item (rows truncate) plus the
    // arithmetic behind its rank, then the four things you can do with it.
    function WrCommishActionPanel({ item, state, onOpen, onDone, onSkip, onHide, onRestore, onClose, skipDays }) {
        if (!item) return null;
        const sevColor = item.tier === 'NOW' ? BAD : item.tier === 'SOON' ? WARN : SILVER;
        const act = (text, handler, opts) => (
            <button onClick={handler}
                style={{
                    flex: opts && opts.wide ? '1 1 100%' : '1 1 auto', minHeight: '38px', padding: '8px 12px', cursor: 'pointer',
                    background: opts && opts.primary ? ACC_FILL : 'transparent',
                    border: '1px solid ' + (opts && opts.primary ? ACC_LINE : LINE),
                    borderRadius: '6px', color: opts && opts.primary ? ACCENT : SILVER,
                    ...chip,
                }}>{text}</button>
        );
        return (
            <div role="dialog" aria-label="Action" onClick={onClose}
                style={{ position: 'fixed', inset: 0, zIndex: 70, background: '#08080B', display: 'flex', justifyContent: 'flex-end' }}>
                <div onClick={e => e.stopPropagation()}
                    style={{ width: 'min(420px, 100%)', height: '100%', background: SURF, borderLeft: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ background: SURF2, borderBottom: `1px solid ${LINE}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ width: '3px', height: '16px', background: sevColor, borderRadius: '2px', flex: 'none' }} />
                        <span style={{ ...label, color: sevColor }}>{item.tier}</span>
                        <span style={{ ...label }}>{item.kicker}</span>
                        <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '6px', color: SILVER, cursor: 'pointer', padding: '4px 10px', ...chip }}>✕</button>
                    </div>

                    <div style={{ padding: '16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <div style={{ font: '600 0.9375rem var(--font-body)', color: TEXT, lineHeight: 1.4 }}>{item.headline}</div>
                            {item.detail ? <div style={{ font: '400 0.8125rem var(--font-body)', color: SILVER, lineHeight: 1.55, marginTop: '6px' }}>{item.detail}</div> : null}
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {(item.leagueNames || []).map((n, i) => (
                                <span key={i} style={{ ...chip, color: SILVER, background: SURF2, border: `1px solid ${LINE}`, borderRadius: '4px', padding: '3px 7px' }}>{n}</span>
                            ))}
                        </div>

                        {item.metric && item.metric.value != null ? (
                            <div style={{ background: WELL, border: `1px solid ${LINE}`, borderRadius: '8px', padding: '12px 14px' }}>
                                <div style={{ ...label }}>{item.metric.unit}</div>
                                <div style={{ ...num, fontSize: '1.5rem', fontWeight: 700, color: item.metric.breach ? sevColor : TEXT, lineHeight: 1, marginTop: '4px' }}>{item.metric.value}</div>
                            </div>
                        ) : null}

                        {/* Printing the arithmetic is what keeps the ranking
                            credible — a queue that won't explain its own order
                            is just an opinion. */}
                        <div style={{ background: WELL, border: `1px solid ${LINE}`, borderRadius: '8px', padding: '12px 14px' }}>
                            <div style={{ ...label, marginBottom: '6px' }}>Why it ranks here</div>
                            <div style={{ ...num, display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: sevColor }}>{item.score}</span>
                                <span style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>of 100 · {item.tier} threshold {item.tier === 'NOW' ? '70' : item.tier === 'SOON' ? '40' : '0'}</span>
                            </div>
                            <div style={{ font: '400 0.75rem var(--font-body)', color: MUTED, marginTop: '6px', lineHeight: 1.5 }}>
                                Signal: <span style={{ fontFamily: MONO, color: SILVER }}>{item.kind}</span>
                                {(item.leagueIds || []).length > 1 ? ' · weighted up for spanning ' + item.leagueIds.length + ' leagues' : ''}
                            </div>
                        </div>

                        {state ? (
                            <div style={{ background: ACC_FILL, border: `1px solid ${ACC_LINE}`, borderRadius: '8px', padding: '10px 12px' }}>
                                <div style={{ ...label, color: ACCENT }}>Currently {state.state}</div>
                                <div style={{ font: '400 0.75rem var(--font-body)', color: SILVER, marginTop: '4px', lineHeight: 1.5 }}>
                                    {state.state === 'done' ? 'Hidden until the underlying number changes — if it gets worse, this comes back on its own.'
                                        : state.state === 'skipped' ? 'Snoozed. Returns automatically when the timer runs out.'
                                            : 'Hidden indefinitely. Only Settings brings it back.'}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div style={{ borderTop: `1px solid ${LINE}`, background: WELL, padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {item.action && item.action.label ? act('▸ ' + item.action.label, onOpen, { primary: true, wide: true }) : null}
                        {state ? act('Restore', onRestore, { wide: true })
                            : (<React.Fragment>
                                {act('✓ Mark done', onDone)}
                                {act('Skip ' + (skipDays || 7) + 'd', onSkip)}
                                {act('Hide', onHide)}
                            </React.Fragment>)}
                    </div>
                </div>
            </div>
        );
    }

    // ── Settings ─────────────────────────────────────────────────────
    function WrCommishSettingsPanel({ leagues, isManaged, onToggleLeague, alerts, onToggleDomain, onSetFloor, domainLabels, suppressed, onRestore }) {
        const Section = ({ title, meta, children }) => (
            <div style={{ background: SURF, border: `1px solid ${LINE}`, borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ background: SURF2, borderBottom: `1px solid ${LINE}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '3px', height: '16px', background: ACCENT, borderRadius: '2px' }} />
                    <span style={{ font: '700 0.9375rem var(--font-title)', letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT }}>{title}</span>
                    {meta ? <span style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
                </div>
                <div style={{ padding: '16px' }}>{children}</div>
            </div>
        );
        const Toggle = ({ on, onChange, children, sub }) => (
            <label style={{ display: 'grid', gridTemplateColumns: '38px minmax(0,1fr)', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)`, cursor: 'pointer', minHeight: '44px' }}>
                <span onClick={e => { e.preventDefault(); onChange(!on); }}
                    style={{ width: '34px', height: '20px', borderRadius: '999px', background: on ? ACC_FILL : '#0C0C10', border: '1px solid ' + (on ? ACC_LINE : LINE), position: 'relative', display: 'inline-block' }}>
                    <span style={{ position: 'absolute', top: '2px', left: on ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '999px', background: on ? ACCENT : MUTED }} />
                </span>
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: '600 0.875rem var(--font-body)', color: on ? TEXT : SILVER }}>{children}</span>
                    {sub ? <span style={{ display: 'block', font: '400 0.75rem var(--font-body)', color: MUTED, marginTop: '2px', lineHeight: 1.45 }}>{sub}</span> : null}
                </span>
                <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
            </label>
        );

        const managedN = (leagues || []).filter(l => isManaged(l.league_id || l.id)).length;
        const FLOORS = [['BACKLOG', 'Everything', 'Every finding, including low-priority backlog.'], ['SOON', 'This week and up', 'Hide the backlog; keep anything time-sensitive.'], ['NOW', 'Only urgent', 'Just the things that need you before anything else.']];

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <Section title="Leagues you manage here" meta={managedN + ' of ' + (leagues || []).length + ' on'}>
                    <div style={{ font: '400 0.8125rem var(--font-body)', color: SILVER, lineHeight: 1.55, marginBottom: '8px', maxWidth: '68ch' }}>
                        Every league you commission is on by default. Switching one off removes it from the queue, the grid and every desk count — it does not leave the league or change anything on Sleeper.
                    </div>
                    {(leagues || []).map(l => {
                        const lid = String(l.league_id || l.id);
                        return <Toggle key={lid} on={isManaged(lid)} onChange={v => onToggleLeague(lid, v)} sub={(l.settings && l.settings.num_teams ? l.settings.num_teams + '-team · ' : '') + (l.season || '')}>{l.name}</Toggle>;
                    })}
                    {managedN === 0 ? (
                        <div style={{ marginTop: '12px', background: 'var(--co-fill-warn, #2A2010)', border: `1px solid ${WARN}`, borderRadius: '8px', padding: '10px 12px', font: '400 0.8125rem var(--font-body)', color: TEXT, lineHeight: 1.5 }}>
                            Every league is switched off, so the office has nothing to show. Turn at least one back on.
                        </div>
                    ) : null}
                </Section>

                <Section title="What you want to be told about">
                    <div style={{ font: '400 0.8125rem var(--font-body)', color: SILVER, lineHeight: 1.55, marginBottom: '8px', maxWidth: '68ch' }}>
                        These control the Command queue and the desk badges. Switching a category off never hides data from its own desk — the desk is the place built to show it.
                    </div>
                    {(domainLabels || []).map(d => (
                        <Toggle key={d.key} on={alerts.domains[d.key] !== false} onChange={v => onToggleDomain(d.key, v)} sub={d.sub}>{d.label}</Toggle>
                    ))}
                    <div style={{ ...label, marginTop: '16px', marginBottom: '8px' }}>Minimum severity</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {FLOORS.map(([k, name, sub]) => (
                            <button key={k} onClick={() => onSetFloor(k)} title={sub}
                                style={{ padding: '8px 12px', minHeight: '38px', cursor: 'pointer', borderRadius: '6px', background: alerts.floor === k ? ACC_FILL : 'transparent', border: '1px solid ' + (alerts.floor === k ? ACC_LINE : LINE), color: alerts.floor === k ? ACCENT : SILVER, ...chip }}>
                                {name}
                            </button>
                        ))}
                    </div>
                </Section>

                <Section title="Dismissed items" meta={(suppressed || []).length + ' hidden by you'}>
                    {!(suppressed || []).length ? (
                        <div style={{ font: '400 0.8125rem var(--font-body)', color: SILVER, lineHeight: 1.55 }}>Nothing dismissed. Items you mark done, skip or hide land here so you can always get them back.</div>
                    ) : (
                        (suppressed || []).map(s => (
                            <div key={s.item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)` }}>
                                <span style={{ ...chip, color: s.state === 'done' ? GOOD : s.state === 'skipped' ? WARN : MUTED, minWidth: '54px' }}>{s.state}</span>
                                <span style={{ flex: 1, minWidth: 0, font: '400 0.8125rem var(--font-body)', color: SILVER, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.item.headline}</span>
                                <button onClick={() => onRestore(s.item.id)} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '6px', color: ACCENT, cursor: 'pointer', padding: '5px 10px', minHeight: '32px', ...chip }}>Restore</button>
                            </div>
                        ))
                    )}
                </Section>
            </div>
        );
    }

    window.WrCommishSidebar = WrCommishSidebar;
    window.WrCommishActionPanel = WrCommishActionPanel;
    window.WrCommishSettingsPanel = WrCommishSettingsPanel;
})();
