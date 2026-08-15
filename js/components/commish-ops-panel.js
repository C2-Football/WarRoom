// ══════════════════════════════════════════════════════════════════
// js/components/commish-ops-panel.js — window.WrCommishOpsPanel
// Commissioner ops: drift sentinel + master calendar + conflict radar,
// three stacked sections in one panel.
//
//   <WrCommishOpsPanel drift calendar conflicts leagues
//     onAcknowledge onAddTask onToggleTask onRemoveTask />
//
// Pure presentation — every prop arrives pre-built by the container:
//   drift     [{leagueId, leagueName, result}] where result is
//             App.Commish.Drift.checkLeague output (null | {firstRun:true,
//             changes:[]} | {firstRun:false, changes:[{path,from,to,
//             detectedAt}], baselineTs}). A null result means the league
//             wasn't hydrated when the check ran — surfaced as muted,
//             never counted as quiet (silence must be earned, not assumed).
//   calendar  {events: App.Commish.Calendar.buildCalendar output, already
//             merged with App.Commish.Tasks.asEvents manual rows via
//             Tasks.mergeSorted} — also tolerates the bare sorted array,
//             so the container can pass either without a wrapper dance.
//             Manual rows carry custom:true, id and done; this panel is the
//             only place those render the toggle/remove controls.
//   conflicts App.Commish.Calendar.findConflicts output.
//   leagues   [{id, name}] — for the add-task form's league picker.
//   onAcknowledge(leagueId) — ratify a league's pending drift. The
//             container owns the Drift.acknowledge call + re-check; this
//             panel just reports the click.
//   onAddTask({title, type, dueTs, leagueId, note}) — add a manual entry.
//   onToggleTask(id) / onRemoveTask(id) — mutate a manual entry.
// ══════════════════════════════════════════════════════════════════
function WrCommishOpsPanel({ drift, calendar, conflicts, leagues, onAcknowledge, onAddTask, onToggleTask, onRemoveTask }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)';
    const AMBER = 'var(--warn, #F0A500)', BLUE = 'var(--co-accent, #5DADE2)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: 'var(--text-muted, #8D887E)', letterSpacing: '0.08em', textTransform: 'uppercase' };

    // ── Drift buckets ────────────────────────────────────────────────
    // Split once up front so the render below reads as policy, not sorting.
    const driftRows = Array.isArray(drift) ? drift : [];
    const changed = driftRows.filter(d => d.result && !d.result.firstRun && (d.result.changes || []).length > 0);
    const firstRuns = driftRows.filter(d => d.result && d.result.firstRun);
    const unchecked = driftRows.filter(d => !d.result);
    const quietCount = driftRows.length - changed.length - firstRuns.length - unchecked.length;
    // "All quiet" is the strong claim — only make it when EVERY league was
    // actually checked against a real baseline and came back clean.
    const allQuiet = driftRows.length > 0 && quietCount === driftRows.length;

    // ── Calendar grouping ────────────────────────────────────────────
    // buildCalendar returns a bare ts-asc array (nulls last); accept that or
    // an {events} wrapper. Map keyed by year-month keeps grouping correct
    // even if a hand-built events list arrives unsorted.
    const events = Array.isArray(calendar) ? calendar
        : (calendar && Array.isArray(calendar.events)) ? calendar.events : [];
    const monthMap = new Map();
    const unscheduled = [];
    events.forEach(ev => {
        if (!Number.isFinite(ev.ts)) { unscheduled.push(ev); return; }
        const d = new Date(ev.ts);
        const key = d.getFullYear() + '-' + d.getMonth();
        if (!monthMap.has(key)) monthMap.set(key, { label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase(), rows: [] });
        monthMap.get(key).rows.push(ev);
    });
    const months = Array.from(monthMap.values());

    const conflictRows = Array.isArray(conflicts) ? conflicts : [];
    const leagueOptions = Array.isArray(leagues) ? leagues : [];

    // ── Add-task form (local UI state only — the item itself lives in the
    // container via onAddTask) ────────────────────────────────────────
    const [showAdd, setShowAdd] = React.useState(false);
    const [form, setForm] = React.useState({ title: '', type: 'task', dueDate: '', leagueId: '', note: '' });
    const resetForm = () => setForm({ title: '', type: 'task', dueDate: '', leagueId: '', note: '' });
    const submitTask = () => {
        if (!form.title.trim() || typeof onAddTask !== 'function') return;
        const dueTs = form.dueDate ? Date.parse(form.dueDate) : null;
        onAddTask({
            title: form.title.trim(), type: form.type,
            dueTs: Number.isFinite(dueTs) ? dueTs : null,
            leagueId: form.leagueId || null,
            note: form.note.trim(),
        });
        resetForm();
        setShowAdd(false);
    };

    // ── Formatters ───────────────────────────────────────────────────
    const fmtVal = v => (v === null || v === undefined || v === '') ? '—' : String(v);
    const fmtDate = ts => Number.isFinite(ts) ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const fmtEventDay = ev => {
        const d = new Date(ev.ts);
        let s = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        // Drafts carry a real clock time (Sleeper start_time); week-derived
        // deadline/playoff dates are UTC-midnight approximations, so a time
        // there would be false precision.
        if (ev.type === 'draft' && !ev.approximate) s += ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return (ev.approximate ? '≈ ' : '') + s;
    };
    const CHIP = {
        draft:     { text: 'DRAFT',     color: GOLD,   border: 'rgba(212,175,55,0.45)', bg: 'rgba(212,175,55,0.08)' },
        deadline:  { text: 'DEADLINE',  color: AMBER,  border: 'rgba(240,165,0,0.4)',   bg: 'rgba(240,165,0,0.08)' },
        playoffs:  { text: 'PLAYOFFS',  color: TEXT, border: 'rgba(255,255,255,0.14)', bg: 'rgba(255,255,255,0.04)' },
        task:      { text: 'TASK',      color: TEXT, border: 'rgba(255,255,255,0.18)', bg: 'rgba(255,255,255,0.03)' },
        milestone: { text: 'MILESTONE', color: BLUE,   border: 'rgba(93,173,226,0.4)',  bg: 'rgba(93,173,226,0.08)' },
        event:     { text: 'EVENT',     color: GREEN,  border: 'rgba(46,204,113,0.35)', bg: 'rgba(46,204,113,0.08)' },
    };

    // ── Shells (same idiom as season-odds-panel) ─────────────────────
    const Section = ({ title, meta, action, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
                {action ? <span style={{ marginLeft: 'auto' }}>{action}</span> : null}
            </div>
            {children}
        </div>
    );
    const TypeChip = ({ type }) => {
        const c = CHIP[type] || CHIP.playoffs;
        return <span style={{ ...mono, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', color: c.color, border: `1px solid ${c.border}`, background: c.bg, borderRadius: '4px', padding: '2px 6px', whiteSpace: 'nowrap' }}>{c.text}</span>;
    };
    const calGrid = { display: 'grid', gridTemplateColumns: '128px 78px minmax(0,1fr) minmax(0,1.4fr)', gap: '10px', alignItems: 'center', padding: '5px 10px', minWidth: 0 };
    // One row, scheduled or unscheduled. Manual (custom:true) rows get a
    // done toggle + remove control; auto-derived rows (draft/deadline/
    // playoffs) stay read-only — the office reads Sleeper, it never writes.
    const EventRow = ({ ev, dateCell }) => (
        <div style={{ ...calGrid, ...rowLine, opacity: (ev.past || ev.done) ? 0.55 : 1 }}>
            <span style={{ color: TEXT }}>{dateCell}</span>
            <TypeChip type={ev.type} />
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.leagueName}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: ev.done ? 'line-through' : 'none' }}>{ev.label}</span>
                {ev.custom ? (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <button title={ev.done ? 'Mark not done' : 'Mark done'} onClick={() => { if (typeof onToggleTask === 'function') onToggleTask(ev.id); }}
                            style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: '4px', color: ev.done ? GREEN : SILVER, cursor: 'pointer', font: '700 0.62rem ' + MONO, padding: '2px 5px', lineHeight: 1 }}>
                            {ev.done ? '✓' : '○'}
                        </button>
                        <button title="Remove" onClick={() => { if (typeof onRemoveTask === 'function') onRemoveTask(ev.id); }}
                            style={{ background: 'none', border: 'none', color: TEXT, cursor: 'pointer', fontSize: '0.72rem', padding: '2px 4px', lineHeight: 1 }}>
                            ✕
                        </button>
                    </span>
                ) : null}
            </span>
        </div>
    );
    const rowLine = { borderBottom: `1px solid ${LINE}`, color: TEXT, fontSize: '0.75rem', ...mono };
    const quietLine = (text, color, bg) => (
        <div style={{ background: bg, borderLeft: `3px solid ${color}`, borderRadius: '0 5px 5px 0', padding: '9px 12px', fontSize: '0.78rem', color: TEXT, lineHeight: 1.5 }}>{text}</div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Section title="Drift Sentinel" meta={driftRows.length ? driftRows.length + ' league' + (driftRows.length === 1 ? '' : 's') + ' watched' : null}>
                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginBottom: '10px', lineHeight: 1.5 }}>
                    Nightly diff of live settings against the last state you ratified. The silent co-commish edit, caught.
                </div>
                {!driftRows.length ? (
                    <div style={{ color: TEXT, fontSize: '0.78rem' }}>No commissioned leagues on the watch yet — the sentinel arms once a league is hydrated.</div>
                ) : allQuiet ? (
                    quietLine('Settings match the last state you signed off on — all ' + driftRows.length + ' league' + (driftRows.length === 1 ? '' : 's') + '.', GREEN, 'rgba(46,204,113,0.07)')
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {changed.map(lg => (
                            <div key={lg.leagueId} style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${AMBER}`, borderRadius: '0 6px 6px 0', padding: '10px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.8rem', color: TEXT }}>{lg.leagueName}</span>
                                    <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>
                                        {lg.result.changes.length + ' change' + (lg.result.changes.length === 1 ? '' : 's') + ' since ' + fmtDate(lg.result.baselineTs)}
                                    </span>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                    <div style={{ minWidth: '440px' }}>
                                        {lg.result.changes.map(ch => (
                                            <div key={ch.path} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1.5fr) 88px', gap: '10px', alignItems: 'baseline', padding: '4px 0', borderBottom: `1px solid ${LINE}`, fontSize: '0.74rem', ...mono }}>
                                                <span style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.path}</span>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    <span style={{ color: TEXT, textDecoration: 'line-through' }}>{fmtVal(ch.from)}</span>
                                                    <span style={{ color: TEXT, margin: '0 6px' }}>→</span>
                                                    <span style={{ color: GOLD, fontWeight: 700 }}>{fmtVal(ch.to)}</span>
                                                </span>
                                                <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, textAlign: 'right' }}>{fmtDate(ch.detectedAt)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <button onClick={() => { if (typeof onAcknowledge === 'function') onAcknowledge(lg.leagueId); }}
                                    style={{ marginTop: '10px', padding: '6px 12px', background: 'transparent', color: AMBER, border: '1px solid rgba(240,165,0,0.5)', borderRadius: '5px', font: '700 0.66rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>
                                    Acknowledge &amp; ratify
                                </button>
                            </div>
                        ))}
                        {firstRuns.map(lg => (
                            <div key={lg.leagueId} style={{ color: TEXT, fontSize: '0.76rem', padding: '2px 0' }}>
                                Baseline recorded — <span style={{ color: TEXT }}>{lg.leagueName}</span>. Drift tracking starts from here.
                            </div>
                        ))}
                        {unchecked.map(lg => (
                            <div key={lg.leagueId} style={{ color: 'var(--text-muted, #8D887E)', fontSize: '0.76rem', padding: '2px 0' }}>
                                {lg.leagueName} — not checked yet (league settings not loaded).
                            </div>
                        ))}
                        {quietCount > 0 ? quietLine('The other ' + quietCount + ' league' + (quietCount === 1 ? ' matches' : 's match') + ' the last state you signed off on.', GREEN, 'rgba(46,204,113,0.07)') : null}
                    </div>
                )}
            </Section>

            <Section title="Master Calendar" meta={events.length ? events.length + ' event' + (events.length === 1 ? '' : 's') + ' · every league, one board' : null}
                action={typeof onAddTask === 'function' ? (
                    <button onClick={() => setShowAdd(s => !s)}
                        style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: '5px', color: showAdd ? TEXT : SILVER, cursor: 'pointer', font: '700 0.66rem ' + MONO, letterSpacing: '0.05em', padding: '5px 10px' }}>
                        {showAdd ? 'Cancel' : '+ Add task / milestone / event'}
                    </button>
                ) : null}>
                {showAdd ? (
                    <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: '6px', padding: '10px 12px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder='Title (e.g. "Collect dues")'
                            style={{ padding: '7px 9px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: '4px', color: TEXT, fontSize: '0.78rem', fontFamily: 'inherit' }} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                                style={{ padding: '7px 9px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: '4px', color: TEXT, fontSize: '0.76rem', fontFamily: 'inherit' }}>
                                <option value="task">Task</option>
                                <option value="milestone">Milestone</option>
                                <option value="event">Event</option>
                            </select>
                            <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                                style={{ padding: '7px 9px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: '4px', color: TEXT, fontSize: '0.76rem', fontFamily: 'inherit' }} />
                            <select value={form.leagueId} onChange={e => setForm({ ...form, leagueId: e.target.value })}
                                style={{ padding: '7px 9px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: '4px', color: TEXT, fontSize: '0.76rem', fontFamily: 'inherit', flex: '1 1 140px' }}>
                                <option value="">All leagues</option>
                                {leagueOptions.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </div>
                        <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Note (optional)"
                            style={{ padding: '7px 9px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: '4px', color: TEXT, fontSize: '0.78rem', fontFamily: 'inherit' }} />
                        <button onClick={submitTask} disabled={!form.title.trim()}
                            style={{ alignSelf: 'flex-start', padding: '6px 14px', background: form.title.trim() ? GOLD : LINE, color: form.title.trim() ? '#121217' : SILVER, border: 'none', borderRadius: '5px', font: '700 0.7rem ' + MONO, letterSpacing: '0.05em', cursor: form.title.trim() ? 'pointer' : 'default' }}>
                            Add to board
                        </button>
                    </div>
                ) : null}
                {!events.length ? (
                    <div style={{ color: TEXT, fontSize: '0.78rem', lineHeight: 1.5 }}>Nothing on the board yet — drafts, trade deadlines and playoff starts land here as leagues schedule them, and anything you add above.</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <div style={{ minWidth: '520px' }}>
                            {months.map(m => (
                                <React.Fragment key={m.label}>
                                    <div style={{ ...microHdr, color: GOLD, padding: '8px 10px 4px', borderBottom: `1px solid ${LINE}` }}>{m.label}</div>
                                    {/* past events stay on the board (history is honest) but dim — the
                                        eye should land on what's still ahead. Done manual items dim too. */}
                                    {m.rows.map((ev, i) => <EventRow key={ev.leagueId + ':' + ev.type + ':' + (ev.id || i)} ev={ev} dateCell={fmtEventDay(ev)} />)}
                                </React.Fragment>
                            ))}
                            {unscheduled.length ? (
                                <React.Fragment>
                                    <div style={{ ...microHdr, padding: '8px 10px 4px', borderBottom: `1px solid ${LINE}` }}>UNSCHEDULED</div>
                                    {unscheduled.map((ev, i) => <EventRow key={ev.leagueId + ':' + ev.type + ':' + (ev.id || i)} ev={ev} dateCell={<span style={{ color: 'var(--text-muted, #8D887E)' }}>no date set</span>} />)}
                                </React.Fragment>
                            ) : null}
                        </div>
                    </div>
                )}
                {events.some(ev => ev.approximate) ? (
                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '8px' }}>≈ week-derived date — the league sets the week, the NFL sets the day.</div>
                ) : null}
            </Section>

            <Section title="Conflicts" meta={conflictRows.length ? conflictRows.length + ' flagged' : null}>
                {!conflictRows.length ? (
                    <div style={{ color: TEXT, fontSize: '0.78rem' }}>No collisions on the board.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {conflictRows.map((c, i) => (
                            <div key={i} style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${RED}`, borderRadius: '0 6px 6px 0', padding: '10px 12px' }}>
                                {c.kind === 'draft_overlap' ? (
                                    <React.Fragment>
                                        <div style={{ fontWeight: 600, fontSize: '0.8rem', color: TEXT, marginBottom: '4px' }}>
                                            {c.a.leagueName} and {c.b.leagueName} draft within 3 hours
                                        </div>
                                        {(c.sharedHumans || []).length ? (
                                            <div style={{ color: TEXT, fontSize: '0.75rem', marginBottom: '4px', lineHeight: 1.5 }}>
                                                {c.sharedHumans.length} of your people {c.sharedHumans.length === 1 ? 'is' : 'are'} in both — <span style={{ ...mono, color: TEXT }}>{c.sharedHumans.join(', ')}</span>
                                            </div>
                                        ) : (
                                            <div style={{ color: 'var(--text-muted, #8D887E)', fontSize: '0.75rem', marginBottom: '4px' }}>No shared members beyond you — still one commissioner, two clocks.</div>
                                        )}
                                        {c.suggestion ? <div style={{ color: TEXT, fontSize: '0.76rem', lineHeight: 1.5 }}>{c.suggestion}</div> : null}
                                    </React.Fragment>
                                ) : (
                                    <React.Fragment>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.8rem', color: TEXT }}>Deadline cluster</span>
                                            {c.week != null ? <span style={{ ...microHdr }}>WK {c.week}</span> : null}
                                        </div>
                                        {c.note ? <div style={{ color: TEXT, fontSize: '0.76rem', lineHeight: 1.5 }}>{c.note}</div> : null}
                                        {(c.leagues || []).length ? <div style={{ ...mono, color: 'var(--text-muted, #8D887E)', fontSize: '0.72rem', marginTop: '4px' }}>{c.leagues.join(' · ')}</div> : null}
                                    </React.Fragment>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Section>
        </div>
    );
}

window.WrCommishOpsPanel = WrCommishOpsPanel;
