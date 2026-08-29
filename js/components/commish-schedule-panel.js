// ══════════════════════════════════════════════════════════════════
// js/components/commish-schedule-panel.js
//   window.WrCommishSchedulePanel — SCHEDULE BUILDER: a commissioner-
//     authored week-by-week matchup plan for one league at a time.
//
// This is explicitly a PLANNING tool, like Rule Lab — it never writes
// anything to Sleeper (no platform exposes a matchup-schedule write
// endpoint). The commissioner builds a plan here, then hand-enters it on
// their platform or keeps it as the league's record of intent. Weeks
// already played can be pulled in as read-only ACTUAL results so a plan
// never contradicts what really happened.
//
//   <WrCommishSchedulePanel
//     leagues                [{id, name}] — same shape as Rule Lab's league
//                             scope chips, same prop names, same idiom.
//     selectedLeagueId        current scope; onSelectLeague(id) to change it.
//     teams                   [{id, name}] roster_id + resolved team name
//                             for the SELECTED league only.
//     weeksConfig              { weeks, doubleRoundRobin } — the generator's
//                             current settings for the selected league.
//     onWeeksConfigChange(next)
//     schedule                Commish.Schedule output — [{week, matchups,
//                             bye, source:'planned'|'actual'}] — or null
//                             before the first Generate.
//     validation               Commish.Schedule.validateSchedule() output,
//                             or null.
//     onGenerate()             (Re)builds from weeksConfig. Regenerating
//                             is a fresh plan — this panel does not carry
//                             pin state; it only carries settings + the
//                             produced schedule.
//     currentWeek              NFL current week — gates which weeks
//                             "Sync actuals" will fetch and which weeks
//                             the panel disables editing on.
//     onSyncActuals()          Pulls real Sleeper results for every played
//                             week and merges them (actuals always win).
//     actualsStatus            'idle' | 'loading' | 'done' | 'empty' | 'none'
//                             | 'error'. 'none' = nothing played yet this
//                             season (the sync button disables up front, no
//                             click needed to discover this); 'empty' = it
//                             ran but Sleeper had no results for any played
//                             week; 'done' = actualsSynced weeks merged.
//     actualsSynced            count of weeks merged on the last 'done'.
//     onForcePairing(week, teamA, teamB)
//                             Ad hoc single-week edit — "make these two
//                             play each other this week." Disabled on any
//                             week whose source is 'actual'.
//     onCopyText()             Copies a text export via the office's
//                             existing clipboard helper (same onCopy the
//                             Rule Lab ballot uses) — no new export
//                             plumbing for a v1 tool.
//   />
//
// Pure presentation — props + callbacks only, no fetching, no persistence.
// Calm monochrome per the office's own law (no rgba/opacity/gradient/shadow
// as a SURFACE — the CO_* fill tokens exist for exactly the tinted-status-
// banner case and are used here instead).
// ══════════════════════════════════════════════════════════════════
function WrCommishSchedulePanel({
    leagues, selectedLeagueId, onSelectLeague,
    teams, weeksConfig, onWeeksConfigChange,
    schedule, validation, onGenerate,
    currentWeek, onSyncActuals, actualsStatus, actualsSynced,
    onForcePairing, onCopyText,
}) {
    const GOLD = 'var(--gold, #D4AF37)', SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
    const MUTED = '#8D887E';
    const PANEL = 'var(--co-surface, #121217)', PANEL2 = 'var(--co-surface-2, #1B1B22)', LINE = 'var(--co-line, #27262E)';
    const GOOD = 'var(--k-2ecc71, #2ecc71)', BAD = 'var(--k-e74c3c, #e74c3c)', WARN = 'var(--k-f0a500, #f0a500)';
    const FILL_GOOD = 'var(--co-fill-good, #14281C)', FILL_WARN = 'var(--co-fill-warn, #2A2010)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };
    const chipBtn = (active) => ({
        padding: '6px 12px', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer',
        fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600,
        background: active ? 'var(--co-accent-fill, #12212B)' : PANEL2,
        border: '1px solid ' + (active ? 'var(--co-accent-line, #2B4B63)' : LINE),
        color: active ? 'var(--co-accent, #5DADE2)' : SILVER,
    });

    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );

    const nameFor = (id) => (teams || []).find(t => String(t.id) === String(id))?.name || ('Team ' + id);

    if (!leagues || !leagues.length) {
        return <Section title="Schedule Builder">
            <div style={{ color: TEXT, fontSize: '0.78rem' }}>No commissioned leagues to build a schedule for yet.</div>
        </Section>;
    }

    const cfg = weeksConfig || { weeks: Math.max(1, (teams || []).length - 1), doubleRoundRobin: false };
    const teamCount = (teams || []).length;

    // ── Per-week edit state (which two teams are being force-paired) ──
    const [editWeek, setEditWeek] = React.useState(null);
    const [editA, setEditA] = React.useState('');
    const [editB, setEditB] = React.useState('');
    React.useEffect(() => { setEditWeek(null); setEditA(''); setEditB(''); }, [selectedLeagueId]);

    const applyEdit = () => {
        if (editWeek == null || !editA || !editB || editA === editB) return;
        if (typeof onForcePairing === 'function') onForcePairing(editWeek, editA, editB);
        setEditWeek(null); setEditA(''); setEditB('');
    };

    return (
        <React.Fragment>
            <Section title="Schedule Builder" meta="a plan you keep, not a live Sleeper schedule">
                <div style={{ color: TEXT, fontSize: '0.76rem', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '10px' }}>
                    No platform this app reads exposes a way to WRITE a matchup schedule, so this builds a plan for you to
                    hand-enter or keep as the league's record — never something that silently changes what Sleeper shows.
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ ...microHdr, alignSelf: 'center' }}>League</span>
                    {leagues.map(l => (
                        <button key={l.id} onClick={() => onSelectLeague && onSelectLeague(l.id)} style={chipBtn(String(selectedLeagueId) === String(l.id))}>
                            {l.name}
                        </button>
                    ))}
                </div>
            </Section>

            <Section title="Build" meta={teamCount + ' team' + (teamCount === 1 ? '' : 's') + (teamCount % 2 ? ' · odd — one bye per week' : '')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: TEXT }}>
                        Weeks
                        <input type="number" min={1} max={Math.max(1, (teamCount - 1) * 4)} value={cfg.weeks}
                            onChange={e => onWeeksConfigChange && onWeeksConfigChange({ ...cfg, weeks: Math.max(1, Number(e.target.value) || 1) })}
                            style={{ width: '56px', background: 'var(--co-page, #08080B)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '5px 6px', fontSize: '0.78rem', ...mono }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: TEXT, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!cfg.doubleRoundRobin}
                            onChange={e => {
                                const dbl = e.target.checked;
                                onWeeksConfigChange && onWeeksConfigChange({ ...cfg, doubleRoundRobin: dbl, weeks: Math.max(1, (teamCount - 1) * (dbl ? 2 : 1)) });
                            }} />
                        Double round-robin (play everyone twice)
                    </label>
                    <button onClick={onGenerate} disabled={teamCount < 2}
                        style={{ padding: '7px 16px', borderRadius: 'var(--card-radius-sm, 8px)', cursor: teamCount < 2 ? 'default' : 'pointer', opacity: teamCount < 2 ? 0.5 : 1, background: 'var(--co-accent-fill, #12212B)', border: '1px solid var(--co-accent-line, #2B4B63)', color: 'var(--co-accent, #5DADE2)', fontWeight: 700, fontSize: '0.78rem' }}>
                        {schedule ? 'Regenerate' : 'Generate schedule'}
                    </button>
                    {schedule ? (
                        <React.Fragment>
                            {/* Nothing has been played yet (preseason / week 1) is not a
                                click-time surprise — the button is disabled up front, same
                                as Generate disables on <2 teams, rather than a click that
                                silently does nothing and reads as broken. */}
                            <button onClick={onSyncActuals} disabled={actualsStatus === 'loading' || (currentWeek != null && currentWeek < 2)}
                                title={currentWeek != null && currentWeek < 2 ? 'Nothing has been played yet this season' : undefined}
                                style={{ padding: '7px 14px', borderRadius: 'var(--card-radius-sm, 8px)', cursor: (actualsStatus === 'loading' || (currentWeek != null && currentWeek < 2)) ? 'default' : 'pointer', opacity: (currentWeek != null && currentWeek < 2) ? 0.5 : 1, background: PANEL2, border: `1px solid ${LINE}`, color: SILVER, fontWeight: 600, fontSize: '0.78rem' }}>
                                {actualsStatus === 'loading' ? 'Syncing…' : 'Sync actual results'}
                            </button>
                            <button onClick={onCopyText}
                                style={{ padding: '7px 14px', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', background: PANEL2, border: `1px solid ${LINE}`, color: SILVER, fontWeight: 600, fontSize: '0.78rem' }}>
                                Copy as text
                            </button>
                            {actualsStatus === 'none' ? (
                                <span style={{ fontSize: '0.72rem', color: MUTED, fontStyle: 'italic' }}>Nothing's been played yet this season.</span>
                            ) : actualsStatus === 'empty' ? (
                                <span style={{ fontSize: '0.72rem', color: MUTED, fontStyle: 'italic' }}>Checked — Sleeper has no results posted for any played week yet.</span>
                            ) : actualsStatus === 'done' ? (
                                <span style={{ fontSize: '0.72rem', color: GOOD }}>Synced {actualsSynced} played week{actualsSynced === 1 ? '' : 's'}.</span>
                            ) : actualsStatus === 'error' ? (
                                <span style={{ fontSize: '0.72rem', color: BAD }}>Sync failed — try again.</span>
                            ) : null}
                        </React.Fragment>
                    ) : null}
                </div>
                {schedule && cfg.doubleRoundRobin === undefined ? null : null}
            </Section>

            {validation ? (
                <Section title="Balance">
                    <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: validation.warnings.length ? '10px' : 0 }}>
                        <span style={{ fontSize: '0.78rem', color: TEXT }}>
                            Meetings per pair: <b style={{ ...mono, color: validation.minMeetings === validation.maxMeetings ? GOOD : WARN }}>{validation.minMeetings}{validation.minMeetings !== validation.maxMeetings ? '–' + validation.maxMeetings : ''}</b>
                        </span>
                        <span style={{ fontSize: '0.78rem', color: TEXT }}>
                            Games/team: <b style={mono}>{Object.values(validation.gamesPerTeam).length ? Math.min(...Object.values(validation.gamesPerTeam)) : 0}{Math.min(...Object.values(validation.gamesPerTeam)) !== Math.max(...Object.values(validation.gamesPerTeam)) ? '–' + Math.max(...Object.values(validation.gamesPerTeam)) : ''}</b>
                        </span>
                    </div>
                    {validation.warnings.length ? (
                        <div style={{ background: FILL_WARN, border: '1px solid var(--co-accent-line, #2B4B63)', borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 10px' }}>
                            {validation.warnings.map((w, i) => (
                                <div key={i} style={{ fontSize: '0.74rem', color: WARN, marginBottom: i === validation.warnings.length - 1 ? 0 : '4px' }}>⚠ {w}</div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ background: FILL_GOOD, border: '1px solid rgba(46,204,113,0.3)', borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 10px', color: GOOD, fontSize: '0.76rem' }}>
                            Balanced — every team plays an even slate.
                        </div>
                    )}
                </Section>
            ) : null}

            {schedule ? (
                <Section title="Weeks" meta={schedule.length + ' week' + (schedule.length === 1 ? '' : 's')}>
                    {schedule.map(wk => {
                        const isActual = wk.source === 'actual';
                        const isPast = currentWeek != null && wk.week < currentWeek;
                        const editingThis = editWeek === wk.week;
                        return (
                            <div key={wk.week} style={{ borderBottom: `1px solid ${LINE}`, padding: '8px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ ...mono, fontSize: '0.72rem', fontWeight: 700, color: TEXT, minWidth: '52px' }}>WEEK {wk.week}</span>
                                    {isActual ? (
                                        <span style={{ ...microHdr, color: GOOD, letterSpacing: '0.06em' }}>actual</span>
                                    ) : isPast ? (
                                        <span style={{ ...microHdr, color: WARN }}>past, unsynced</span>
                                    ) : null}
                                    {!isActual && !editingThis ? (
                                        <button onClick={() => { setEditWeek(wk.week); setEditA(''); setEditB(''); }}
                                            style={{ marginLeft: 'auto', fontSize: '0.68rem', color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                                            force a pairing
                                        </button>
                                    ) : null}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                                    {wk.matchups.map((m, i) => (
                                        <span key={i} style={{ fontSize: '0.78rem', color: TEXT }}>{nameFor(m[0])} <span style={{ color: MUTED }}>vs</span> {nameFor(m[1])}</span>
                                    ))}
                                    {wk.bye != null ? <span style={{ fontSize: '0.78rem', color: MUTED, fontStyle: 'italic' }}>{nameFor(wk.bye)} — bye</span> : null}
                                </div>
                                {editingThis ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '0.72rem', color: MUTED }}>Make</span>
                                        <select value={editA} onChange={e => setEditA(e.target.value)}
                                            style={{ background: 'var(--co-page, #08080B)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '5px 6px', fontSize: '0.74rem' }}>
                                            <option value="">team…</option>
                                            {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                        <span style={{ fontSize: '0.72rem', color: MUTED }}>play</span>
                                        <select value={editB} onChange={e => setEditB(e.target.value)}
                                            style={{ background: 'var(--co-page, #08080B)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '5px 6px', fontSize: '0.74rem' }}>
                                            <option value="">team…</option>
                                            {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                        <span style={{ fontSize: '0.72rem', color: MUTED }}>this week</span>
                                        <button onClick={applyEdit} disabled={!editA || !editB || editA === editB}
                                            style={{ padding: '5px 12px', borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', background: 'var(--co-accent-fill, #12212B)', border: '1px solid var(--co-accent-line, #2B4B63)', color: 'var(--co-accent, #5DADE2)', fontSize: '0.72rem', fontWeight: 700, opacity: (!editA || !editB || editA === editB) ? 0.5 : 1 }}>
                                            Apply
                                        </button>
                                        <button onClick={() => setEditWeek(null)} style={{ padding: '5px 10px', background: 'transparent', border: 'none', color: MUTED, fontSize: '0.72rem', cursor: 'pointer' }}>Cancel</button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </Section>
            ) : null}
        </React.Fragment>
    );
}

window.WrCommishSchedulePanel = WrCommishSchedulePanel;
