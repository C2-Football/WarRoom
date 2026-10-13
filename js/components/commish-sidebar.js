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
    const MUTED = 'var(--co-muted, #A3ABB8)', ACCENT = 'var(--co-accent, #5DADE2)';
    const SURF = 'var(--co-surface, #121217)', SURF2 = 'var(--co-surface-2, #1B1B22)';
    const SURF3 = 'var(--co-surface-3, #17171D)', WELL = 'var(--co-well, #0F0F14)';
    const LINE = 'var(--co-line, #27262E)', ACC_FILL = 'var(--co-accent-fill, #12212B)';
    const ACC_LINE = 'var(--co-accent-line, #2B4B63)';
    const BAD = 'var(--bad, #E74C3C)', WARN = 'var(--warn, #F0A500)', GOOD = 'var(--good, #2ECC71)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';

    const label = { font: '500 var(--co-readable-small, 0.75rem) ' + MONO, color: MUTED, lineHeight: 1 };
    const chip = { font: '600 var(--co-readable-small, 0.6875rem) ' + MONO };
    const num = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };

    // ── Sidebar ──────────────────────────────────────────────────────
    function WrCommishSidebar({ groups, active, counts, onSelect, onOpenSettings, managedCount, leagueCount, phone, open, onClose }) {
        const dialog = React.useRef(null);
        React.useEffect(() => {
            if (!phone || !open || !dialog.current) return undefined;
            const opener = document.activeElement;
            const node = dialog.current;
            node.showModal();
            return () => { node.close(); if (opener?.isConnected) opener.focus(); };
        }, [phone, open]);
        const Row = ({ hub, name, dormant }) => {
            const isActive = active === hub;
            const n = (counts && counts[hub]) || 0;
            return (
                <button key={hub} aria-current={isActive ? 'page' : undefined} onClick={() => { onSelect(hub); if (phone && onClose) onClose(); }}
                    title={dormant ? 'Wakes at Week 1' : undefined}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                        padding: '9px 12px', cursor: 'pointer', border: 'none',
                        borderLeft: '3px solid ' + (isActive ? ACCENT : 'transparent'),
                        background: isActive ? ACC_FILL : 'transparent',
                        color: isActive ? TEXT : (dormant ? MUTED : SILVER),
                        font: (isActive ? 600 : 400) + ' 0.875rem ' + MONO,
                        minHeight: '44px',
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
            <nav aria-label="Commissioner workspaces" style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: phone ? '100%' : '208px', flex: 'none', background: phone ? SURF : 'transparent', padding: phone ? '12px 0' : 0 }}>
                <button aria-current={active === 'command' ? 'page' : undefined} onClick={() => { onSelect('command'); if (phone && onClose) onClose(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                        padding: '10px 12px', cursor: 'pointer', border: '1px solid ' + (active === 'command' ? ACC_LINE : LINE),
                        borderRadius: 'var(--card-radius-sm, 8px)', marginBottom: '8px',
                        background: active === 'command' ? ACC_FILL : 'transparent',
                        color: active === 'command' ? ACCENT : SILVER,
                        font: '600 0.875rem ' + MONO,
                        minHeight: '44px',
                    }}>
                    Overview
                </button>

                {(groups || []).map(g => {
                    const selected = g.hubs.some(h => h.hub === active);
                    const count = g.hubs.reduce((n, h) => n + ((counts && counts[h.hub]) || 0), 0);
                    return <div key={g.name} style={{ marginBottom: '4px' }}>
                        <button type="button" aria-current={selected ? 'page' : undefined} onClick={() => { onSelect(g.hubs[0].hub); if (phone && onClose) onClose(); }}
                            style={{ width: '100%', minHeight: '44px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px', border: '1px solid ' + (selected ? ACC_LINE : 'transparent'), borderRadius: 'var(--card-radius-sm, 8px)', background: selected ? ACC_FILL : 'transparent', color: selected ? ACCENT : SILVER, font: '500 0.875rem ' + MONO, cursor: 'pointer' }}>
                            <span style={{ flex: 1 }}>{g.name}</span>
                            {count ? <span style={{ ...chip, color: BAD }}>{count}</span> : g.dormant ? <span style={{ ...chip, color: MUTED }}>WK 1</span> : null}
                        </button>
                        {selected && !phone ? g.hubs.map(h => <Row key={h.hub} hub={h.hub} name={h.name} dormant={h.dormant} />) : null}
                    </div>;
                })}

                <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: `1px solid ${LINE}` }}>
                    <button aria-current={active === 'settings' ? 'page' : undefined} onClick={() => { onOpenSettings(); if (phone && onClose) onClose(); }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                            padding: '9px 12px', cursor: 'pointer', border: 'none',
                            borderLeft: '3px solid ' + (active === 'settings' ? ACCENT : 'transparent'),
                            background: active === 'settings' ? ACC_FILL : 'transparent',
                            color: active === 'settings' ? TEXT : SILVER,
                            font: '500 0.875rem ' + MONO,
                            minHeight: '44px',
                        }}>
                        Settings
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
            <dialog ref={dialog} className="co-workspace-dialog" aria-label="Commissioner menu"
                onCancel={e => { e.preventDefault(); onClose?.(); }} onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
                <div className="co-workspace-dialog-head"><h2>Workspaces</h2><button type="button" onClick={onClose} aria-label="Close menu">Close ×</button></div>
                {body}
            </dialog>
        );
    }

    // ── Action panel ─────────────────────────────────────────────────
    // Opens on any queue row. Shows the full item (rows truncate) plus the
    // arithmetic behind its rank, then the four things you can do with it.
    function WrCommishActionPanel({ item, state, followup, onOpen, onDone, onSkip, onIgnore, onHide, onRestore, onClose, onSaveFollowup, onCopyMessage, onDiscard, onDismissFailure, saveFailure, skipDays, taskSync, onRetrySync }) {
        const [message, setMessage] = React.useState('');
        const [note, setNote] = React.useState('');
        const [dueAt, setDueAt] = React.useState('');
        const [saveNote, setSaveNote] = React.useState(null);
        const [copyBusy, setCopyBusy] = React.useState(false);
        const [actionBusy, setActionBusy] = React.useState(false);
        const actionPending = React.useRef(false);
        const taskSyncRef = React.useRef(taskSync);
        taskSyncRef.current = taskSync;
        const actionRun = React.useRef(0);
        React.useEffect(() => () => { actionRun.current++; }, []);
        const saved = React.useRef({ message: '', note: '', dueAt: '' });
        const latest = React.useRef(saved.current);
        const dialog = React.useRef(null);
        const closeButton = React.useRef(null);
        latest.current = { message, note, dueAt };
        React.useEffect(() => {
            const value = { message: followup?.message || '', note: followup?.note || '', dueAt: followup?.dueAt || '' };
            saved.current = value; latest.current = { ...value };
            setMessage(value.message); setNote(value.note); setDueAt(value.dueAt); setSaveNote(null);
        }, [item?.id]);
        const dirty = () => ['message', 'note', 'dueAt'].some(key => latest.current[key] !== saved.current[key]);
        const canLeave = () => {
            if (actionPending.current || taskSyncRef.current?.status === 'saving') { setSaveNote({ error: true, text: 'Your task choice is still syncing. Wait for confirmation before leaving.' }); return false; }
            if (!dirty()) return true;
            setSaveNote({ error: true, text: 'Your edits are not saved. Save the follow-up or discard these edits before leaving.' });
            return false;
        };
        React.useEffect(() => window.App?.NavigationGuard?.register(canLeave), [item?.id]);
        React.useEffect(() => {
            const warn = event => { if (dirty() || actionPending.current || taskSyncRef.current?.status === 'saving') { event.preventDefault(); event.returnValue = ''; } };
            window.addEventListener('beforeunload', warn);
            return () => window.removeEventListener('beforeunload', warn);
        }, [item?.id]);
        React.useEffect(() => {
            const node = dialog.current;
            if (!item || !node) return undefined;
            const canFocus = target => target?.isConnected && target !== document.body && target !== document.documentElement
                && !target.disabled && typeof target.focus === 'function' && target.tabIndex >= 0
                && !target.closest?.('[hidden], [inert]') && target.getClientRects?.().length !== 0;
            const reviewButtons = () => Array.from(document.querySelectorAll('.co-office [data-testid="commish-task-review"], .co-office button[aria-label^="Review "]')).filter(canFocus);
            const matchingReview = () => reviewButtons().find(button => button.closest('[data-task-id]')?.getAttribute('data-task-id') === String(item.id));
            // Safari touch can leave focus on the page body instead of the
            // tapped button. Capture the task row without interpolating its ID.
            const opener = canFocus(document.activeElement) ? document.activeElement : matchingReview();
            const overflow = document.body.style.overflow;
            node.showModal();
            document.body.style.overflow = 'hidden';
            closeButton.current?.focus();
            return () => {
                node.close();
                document.body.style.overflow = overflow;
                // Done/Ignore can remove the opening row. Keep keyboard users
                // in the office by returning to the next task or active desk.
                const target = canFocus(opener) ? opener : (matchingReview() || reviewButtons()[0]
                    || Array.from(document.querySelectorAll('.co-office .co-workspace-trigger, .co-office [aria-current="page"]')).find(canFocus));
                target?.focus();
            };
        }, [item?.id]);
        if (!item) return null;
        const sevColor = item.tier === 'NOW' ? BAD : item.tier === 'SOON' ? WARN : SILVER;
        const commit = () => {
            const patch = { ...latest.current };
            if (onSaveFollowup?.(patch) !== true) {
                setSaveNote({ error: true, text: 'Follow-up not saved. Your draft and private note remain here. Retry after freeing browser storage.' });
                return false;
            }
            saved.current = patch;
            setSaveNote({ text: 'Saved locally in this browser. Nothing was sent.' });
            return true;
        };
        const discard = () => {
            const value = saved.current;
            latest.current = { ...value };
            setMessage(value.message); setNote(value.note); setDueAt(value.dueAt);
            setSaveNote(null); onDiscard?.();
        };
        const close = () => { if (canLeave()) onClose?.(); };
        const finish = handler => {
            if (actionPending.current) return false;
            if (!commit()) return false;
            actionPending.current = true;
            let result;
            try { result = handler?.(); }
            catch { actionPending.current = false; setSaveNote({ error: true, text: 'This task choice could not be confirmed. Your saved follow-up remains here.' }); return false; }
            if (result && typeof result.then === 'function') {
                const run = ++actionRun.current;
                setActionBusy(true);
                return Promise.resolve(result).then(confirmed => {
                    if (run === actionRun.current && confirmed !== true) setSaveNote({ error: true, text: 'This task action is incomplete. Your saved follow-up remains here. Review the save or sync message before retrying.' });
                    return confirmed === true;
                }).catch(() => {
                    if (run === actionRun.current) setSaveNote({ error: true, text: 'This task choice could not be confirmed. Your saved follow-up remains here.' });
                    return false;
                }).finally(() => { actionPending.current = false; if (run === actionRun.current) setActionBusy(false); });
            }
            actionPending.current = false;
            if (result !== true) {
                setSaveNote({ error: true, text: 'This task change was not fully saved. Your follow-up remains here. Retry the save before leaving.' });
                return false;
            }
            return true;
        };
        const copy = async () => {
            if (copyBusy || !commit()) return;
            setCopyBusy(true);
            try {
                const result = await onCopyMessage?.(latest.current.message);
                setSaveNote(result?.copied ? { text: 'Message copied. Nothing was sent.' } : { error: true, text: result?.error || 'Could not copy. Your draft remains saved locally.' });
            } catch { setSaveNote({ error: true, text: 'Could not copy. Your draft remains saved locally.' }); }
            finally { setCopyBusy(false); }
        };
        const act = (text, handler, opts) => (
            <button type="button" onClick={handler} disabled={opts?.disabled || actionBusy || taskSync?.status === 'saving'}
                style={{
                    flex: opts && opts.wide ? '1 1 100%' : '1 1 auto', minHeight: '44px', padding: '8px 12px', cursor: 'pointer',
                    background: opts && opts.primary ? ACC_FILL : 'transparent',
                    border: '1px solid ' + (opts && opts.primary ? ACC_LINE : LINE),
                    borderRadius: 'var(--card-radius-sm, 8px)', color: opts && opts.primary ? ACCENT : SILVER,
                    ...chip,
                }}>{text}</button>
        );
        return (
            <dialog ref={dialog} className="co-action-dialog" aria-label="Action" aria-modal="true"
                onCancel={event => { event.preventDefault(); close(); }}
                onClick={event => { if (event.target === event.currentTarget) close(); }}
                style={{ position: 'fixed', inset: '0 0 0 auto', margin: 0, padding: 0, width: 'min(420px, 100vw)', maxWidth: '100vw', height: '100%', maxHeight: '100%', border: 'none', color: TEXT, background: SURF, boxSizing: 'border-box' }}>
                <style>{'.co-action-dialog::backdrop { background: rgba(3, 4, 7, 0.6); } .co-action-dialog :focus-visible { outline: 2px solid var(--co-accent, #5DADE2); outline-offset: 3px; }'}</style>
                <div onClick={e => e.stopPropagation()}
                    style={{ width: '100%', height: '100%', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', background: SURF, borderLeft: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                    <div style={{ background: SURF2, borderBottom: `1px solid ${LINE}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                        <span style={{ width: '3px', height: '16px', background: sevColor, borderRadius: '2px', flex: 'none' }} />
                        <span style={{ ...label, color: sevColor }}>{item.tier}</span>
                        <span style={{ ...label }}>{item.kicker}</span>
                        <button ref={closeButton} type="button" onClick={close} aria-label="Close" style={{ marginLeft: 'auto', minWidth: '44px', minHeight: '44px', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: TEXT, cursor: 'pointer', padding: '4px 10px', ...chip }}>✕</button>
                    </div>

                    <div style={{ padding: '16px', overflowY: 'auto', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <h2 style={{ margin: 0, font: '600 0.9375rem var(--font-body)', color: TEXT, lineHeight: 1.4 }}>{item.headline}</h2>
                            {item.detail ? <div style={{ font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, lineHeight: 1.55, marginTop: '6px' }}>{item.detail}</div> : null}
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {(item.leagueNames || []).map((n, i) => (
                                <span key={i} style={{ ...chip, color: TEXT, background: SURF2, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', padding: '3px 7px' }}>{n}</span>
                            ))}
                        </div>

                        {item.metric && item.metric.value != null ? (
                            <div style={{ background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 14px' }}>
                                <div style={{ ...label }}>{item.metric.unit}</div>
                                <div style={{ ...num, fontSize: '1.5rem', fontWeight: 700, color: item.metric.breach ? sevColor : TEXT, lineHeight: 1, marginTop: '4px' }}>{item.metric.value}</div>
                            </div>
                        ) : null}

                        {/* Printing the arithmetic is what keeps the ranking
                            credible — a queue that won't explain its own order
                            is just an opinion. */}
                        <div style={{ background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 14px' }}>
                            <div style={{ ...label, marginBottom: '6px' }}>Why it ranks here</div>
                            <div style={{ ...num, display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: sevColor }}>{item.score}</span>
                                <span style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>of 100 · {item.tier} threshold {item.tier === 'NOW' ? '70' : item.tier === 'SOON' ? '40' : '0'}</span>
                            </div>
                            <div style={{ font: '400 var(--co-readable-small, 0.75rem) var(--font-body)', color: MUTED, marginTop: '6px', lineHeight: 1.5 }}>
                                Signal: <span style={{ fontFamily: MONO, color: TEXT }}>{item.kind}</span>
                                {(item.leagueIds || []).length > 1 ? ' · weighted up for spanning ' + item.leagueIds.length + ' leagues' : ''}
                            </div>
                        </div>

                        {state ? (
                            <div style={{ background: ACC_FILL, border: `1px solid ${ACC_LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px' }}>
                                <div style={{ ...label, color: ACCENT }}>Currently {state.state === 'hidden' || state.state === 'ignored' ? 'ignored' : state.state === 'skipped' ? 'snoozed' : state.state}</div>
                                <div style={{ font: '400 var(--co-readable-small, 0.75rem) var(--font-body)', color: TEXT, marginTop: '4px', lineHeight: 1.5 }}>
                                    {state.state === 'done' ? 'Hidden until the underlying number changes — if it gets worse, this comes back on its own.'
                                        : state.state === 'skipped' ? 'Snoozed. Returns automatically when the timer runs out.'
                                            : 'Ignored until you restore it in Settings → Ignored tasks. Account choices follow your signed-in devices; older browser choices can be synced in Settings.'}
                                </div>
                            </div>
                        ) : null}

                        <div style={{ background: SURF2, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 14px' }} data-testid="commish-followup-editor">
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '9px' }}>
                                <div style={{ ...label, color: ACCENT }}>Follow-up</div>
                                <div style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>{followup?.status || 'OPEN'}</div>
                            </div>
                            <label style={{ ...label, display: 'block', marginBottom: '5px' }}>Message draft</label>
                            <textarea aria-label="Message draft" disabled={actionBusy} value={message} onChange={e => { latest.current.message = e.target.value; setMessage(e.target.value); setSaveNote(null); }} placeholder="Draft a commissioner message"
                                style={{ width: '100%', minHeight: '92px', resize: 'vertical', boxSizing: 'border-box', background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '9px 10px', color: TEXT, font: '400 var(--co-readable-small, 0.8125rem)/1.5 var(--font-body)' }} />
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px', gap: '8px', marginTop: '8px' }}>
                                <input aria-label="Private note" disabled={actionBusy} value={note} onChange={e => { latest.current.note = e.target.value; setNote(e.target.value); setSaveNote(null); }} placeholder="Private note"
                                    style={{ minWidth: 0, minHeight: '44px', boxSizing: 'border-box', background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 9px', color: TEXT, font: '400 var(--co-readable-small, 0.75rem) var(--font-body)' }} />
                                <input type="date" disabled={actionBusy} value={dueAt} onChange={e => { latest.current.dueAt = e.target.value; setDueAt(e.target.value); setSaveNote(null); }} aria-label="Follow-up date"
                                    style={{ minWidth: 0, minHeight: '44px', boxSizing: 'border-box', background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 9px', color: TEXT, font: '600 var(--co-readable-small, 0.75rem) var(--font-mono)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                {act('Save follow-up', commit)}
                                {act(copyBusy ? 'Copying…' : 'Copy message', copy, { primary: true, disabled: copyBusy })}
                                {dirty() && act('Discard unsaved edits', discard)}
                            </div>
                            {saveNote && !(saveNote.error && saveFailure) && <div role={saveNote.error ? 'alert' : 'status'} style={{ marginTop: 10, color: saveNote.error ? BAD : TEXT, fontSize: 16, lineHeight: 1.5 }}>{saveNote.text}</div>}
                            {taskSync?.status === 'saving' && <div role="status" style={{ marginTop: 10 }}>Saving task choice…</div>}
                            {taskSync?.status === 'failed' && <div data-testid="commish-ignore-sync-error" role="alert" style={{ marginTop: 10, color: BAD, fontSize: 16, lineHeight: 1.5 }}>
                                <div>{taskSync.message}</div>
                                {act('Retry task sync', () => finish(onRetrySync))}
                            </div>}
                            {saveFailure && <div role="alert" style={{ marginTop: 10, color: BAD, fontSize: 16, lineHeight: 1.5 }}>
                                {saveFailure.message}
                                {saveFailure.retry && act(saveFailure.retryLabel || (saveFailure.key?.startsWith('activity:') ? 'Retry activity save' : 'Retry save'), () => {
                                    // A preference retry can finish the whole action and
                                    // close this drawer. Save any edits typed since the
                                    // original failure before allowing that close.
                                    const preferenceRetry = saveFailure.area === 'settings' || saveFailure.key?.startsWith('item-state:');
                                    if (preferenceRetry && !commit()) return false;
                                    const confirmed = saveFailure.retry() === true;
                                    if (confirmed) setSaveNote(null);
                                    return confirmed;
                                })}
                                {onDismissFailure && <div style={{ marginTop: 8 }}>
                                    {act(saveFailure.key?.startsWith('activity:') ? 'Leave activity unrecorded' : 'Dismiss save error', onDismissFailure)}
                                    <div style={{ color: TEXT }}>Saved changes remain. Any unsaved edits stay in this form.</div>
                                </div>}
                            </div>}
                            {followup?.history?.length ? (
                                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${LINE}` }}>
                                    <div style={{ ...label, marginBottom: '7px' }}>Activity</div>
                                    {followup.history.slice(-4).reverse().map((event, i) => (
                                        <div key={event.ts + ':' + i} style={{ display: 'flex', gap: '8px', padding: '4px 0', font: '400 var(--co-readable-small, 0.72rem) var(--font-body)', color: TEXT }}>
                                            <span style={{ ...chip, color: ACCENT, minWidth: '62px' }}>{event.type}</span>
                                            <span style={{ flex: 1 }}>{event.detail || new Date(event.ts).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div style={{ borderTop: `1px solid ${LINE}`, background: WELL, padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
                        {item.action && item.action.label ? act('▸ ' + item.action.label, () => finish(onOpen), { primary: true, wide: true }) : null}
                        {state ? act('Restore', () => finish(onRestore), { wide: true })
                            : (<React.Fragment>
                                {act('✓ Mark done', () => finish(onDone))}
                                {act('Snooze ' + (skipDays || 7) + ' days', () => finish(onSkip))}
                                {act('Ignore task', () => finish(onIgnore || onHide))}
                            </React.Fragment>)}
                        {!state && <div style={{ flexBasis: '100%', font: '400 var(--co-readable-small, 0.75rem)/1.45 var(--font-body)', color: MUTED }}>Ignore keeps this task out of your overview across your signed-in devices until you restore it in Settings. Snooze brings it back in this browser after {skipDays || 7} days.</div>}
                    </div>
                </div>
            </dialog>
        );
    }

    // ── Settings ─────────────────────────────────────────────────────
    function WrCommishSettingsPanel({ leagues, isManaged, onToggleLeague, alerts, onToggleDomain, onSetFloor, domainLabels, suppressed, ignored, onRestore, followups, onRemoveFollowup, onSyncChoice, taskSync }) {
        const Section = ({ title, meta, children }) => (
            <div style={{ background: SURF, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius, 10px)', overflow: 'hidden' }}>
                <div style={{ background: SURF2, borderBottom: `1px solid ${LINE}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '3px', height: '16px', background: ACCENT, borderRadius: '2px' }} />
                    <span style={{ font: '700 0.9375rem var(--font-title)', color: TEXT }}>{title}</span>
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
                    {sub ? <span style={{ display: 'block', font: '400 var(--co-readable-small, 0.75rem) var(--font-body)', color: MUTED, marginTop: '2px', lineHeight: 1.45 }}>{sub}</span> : null}
                </span>
                <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
            </label>
        );

        const managedN = (leagues || []).filter(l => isManaged(l.league_id || l.id)).length;
        const ignoredRows = Array.isArray(ignored) ? ignored : (suppressed || []).filter(s => s.state === 'ignored' || s.state === 'hidden');
        const dismissedRows = (suppressed || []).filter(s => s.state !== 'ignored' && s.state !== 'hidden');
        const FLOORS = [['BACKLOG', 'Everything', 'Every finding, including low-priority backlog.'], ['SOON', 'This week and up', 'Hide the backlog; keep anything time-sensitive.'], ['NOW', 'Only urgent', 'Just the things that need you before anything else.']];

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <Section title="Leagues you manage here" meta={managedN + ' of ' + (leagues || []).length + ' on'}>
                    <div style={{ font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, lineHeight: 1.55, marginBottom: '8px', maxWidth: '68ch' }}>
                        Every league you commission is on by default. Switching one off removes it from the queue, the grid and every desk count — it does not leave the league or change anything on Sleeper.
                    </div>
                    {(leagues || []).map(l => {
                        const lid = String(l.league_id || l.id);
                        return <Toggle key={lid} on={isManaged(lid)} onChange={v => onToggleLeague(lid, v)} sub={(l.settings && l.settings.num_teams ? l.settings.num_teams + '-team · ' : '') + (l.season || '')}>{l.name}</Toggle>;
                    })}
                    {managedN === 0 ? (
                        <div style={{ marginTop: '12px', background: 'var(--co-fill-warn, #2A2010)', border: `1px solid ${WARN}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px', font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, lineHeight: 1.5 }}>
                            Every league is switched off, so the office has nothing to show. Turn at least one back on.
                        </div>
                    ) : null}
                </Section>

                <Section title="What you want to be told about">
                    <div style={{ font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, lineHeight: 1.55, marginBottom: '8px', maxWidth: '68ch' }}>
                        These control the Command queue and the desk badges. Switching a category off never hides data from its own desk — the desk is the place built to show it.
                    </div>
                    {(domainLabels || []).map(d => (
                        <Toggle key={d.key} on={alerts.domains[d.key] !== false} onChange={v => onToggleDomain(d.key, v)} sub={d.sub}>{d.label}</Toggle>
                    ))}
                    <div style={{ ...label, marginTop: '16px', marginBottom: '8px' }}>Minimum severity</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {FLOORS.map(([k, name, sub]) => (
                            <button key={k} onClick={() => onSetFloor(k)} title={sub}
                                style={{ padding: '8px 12px', minHeight: '44px', cursor: 'pointer', borderRadius: 'var(--card-radius-sm, 8px)', background: alerts.floor === k ? ACC_FILL : 'transparent', border: '1px solid ' + (alerts.floor === k ? ACC_LINE : LINE), color: alerts.floor === k ? ACCENT : SILVER, ...chip }}>
                                {name}
                            </button>
                        ))}
                    </div>
                </Section>

                <Section title="Ignored tasks" meta={ignoredRows.length + ' ignored'}>
                    <div data-testid="commish-ignored-tasks">
                        <div style={{ font: '400 var(--co-readable-small, 0.8125rem)/1.55 var(--font-body)', color: TEXT, marginBottom: '8px' }}>Account choices follow you across your signed-in devices. Restore a task here to allow it back on every device.</div>
                        {!ignoredRows.length ? <div style={{ font: '400 var(--co-readable-small, 0.8125rem)/1.55 var(--font-body)', color: MUTED }}>No ignored tasks.</div> : ignoredRows.map(s => (
                            <div key={s.item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)` }}>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', font: '400 var(--co-readable-small, 0.8125rem)/1.45 var(--font-body)', color: TEXT, overflowWrap: 'anywhere' }}>{s.item.headline}</span>
                                    <span style={{ display: 'block', marginTop: '3px', fontSize: 'var(--co-readable-small, 0.75rem)', color: MUTED }}>{s.source === 'cloud' && s.confirmed ? 'Synced to your account' : s.source === 'cache' ? 'Last known account choice · checking sync' : 'Only in this browser'}</span>
                                    {s.missing && <span style={{ display: 'block', marginTop: '3px', font: '400 var(--co-readable-small, 0.75rem)/1.45 var(--font-body)', color: MUTED }}>Not present in the latest league data. Restore it to allow it back when applicable.</span>}
                                </span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                                    {s.source === 'local' && onSyncChoice && <button type="button" disabled={taskSync?.status === 'saving'} onClick={() => onSyncChoice(s.item)} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: ACCENT, cursor: 'pointer', padding: '5px 10px', minHeight: '44px', ...chip }}>Sync choice</button>}
                                    <button type="button" disabled={taskSync?.status === 'saving'} onClick={() => onRestore(s.item.id)} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: ACCENT, cursor: 'pointer', padding: '5px 10px', minHeight: '44px', ...chip }}>Restore</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title="Done and snoozed tasks" meta={dismissedRows.length + ' set aside'}>
                    {!dismissedRows.length ? (
                        <div style={{ font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, lineHeight: 1.55 }}>Nothing marked done or snoozed. You can restore those tasks here.</div>
                    ) : (
                        dismissedRows.map(s => (
                            <div key={s.item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)` }}>
                                <span style={{ ...chip, color: s.state === 'done' ? GOOD : s.state === 'skipped' ? WARN : MUTED, minWidth: '54px' }}>{s.state === 'skipped' ? 'snoozed' : s.state}</span>
                                <span style={{ flex: 1, minWidth: 0, font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.item.headline}</span>
                                <button type="button" onClick={() => onRestore(s.item.id)} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: ACCENT, cursor: 'pointer', padding: '5px 10px', minHeight: '44px', ...chip }}>Restore</button>
                            </div>
                        ))
                    )}
                </Section>

                <Section title="Follow-up history" meta={(followups || []).length + ' tracked'}>
                    {!(followups || []).length ? (
                        <div style={{ font: '400 var(--co-readable-small, 0.8125rem) var(--font-body)', color: TEXT, lineHeight: 1.55 }}>No follow-ups yet. Open any Command item to draft outreach, leave a private note or set a review date.</div>
                    ) : (
                        (followups || []).slice(0, 50).map(f => {
                            const last = (f.history || [])[f.history.length - 1];
                            return (
                                <div key={f.itemId} style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,1fr) auto', gap: '10px', alignItems: 'start', padding: '10px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)` }}>
                                    <span style={{ ...chip, color: f.status === 'DONE' ? GOOD : ACCENT }}>{f.status}</span>
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: 'block', font: '600 var(--co-readable-small, 0.8125rem)/1.35 var(--font-body)', color: TEXT }}>{f.headline}</span>
                                        <span style={{ display: 'block', marginTop: '3px', font: '400 var(--co-readable-small, 0.72rem)/1.4 var(--font-body)', color: MUTED }}>{f.note || f.message}{f.dueAt ? ' · due ' + f.dueAt : ''}{last ? ' · last ' + last.type.toLowerCase() : ''}</span>
                                    </span>
                                    <button onClick={() => onRemoveFollowup?.(f.itemId)} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: MUTED, cursor: 'pointer', padding: '5px 9px', minHeight: '44px', ...chip }}>Remove</button>
                                </div>
                            );
                        })
                    )}
                </Section>
            </div>
        );
    }

    window.WrCommishSidebar = WrCommishSidebar;
    window.WrCommishActionPanel = WrCommishActionPanel;
    window.WrCommishSettingsPanel = WrCommishSettingsPanel;
})();
