/* Build with Alex edits a private draft. Only Save commits to Home. */
(function () {
    'use strict';
    window.WR = window.WR || {};
    const copy = value => JSON.parse(JSON.stringify(value));
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    let nextDialogId = 0;

    function DashboardBuilderPanel({ layout, catalog, league, scope, focusId, onSave, onClose, renderPreview }) {
        const [draft, setDraft] = React.useState(() => copy(layout || []));
        const [saved, setSaved] = React.useState(() => copy(layout || []));
        const [history, setHistory] = React.useState([]);
        const [messages, setMessages] = React.useState([]);
        const [input, setInput] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [saving, setSaving] = React.useState(false);
        const [error, setError] = React.useState('');
        const [status, setStatus] = React.useState('');
        const [tab, setTab] = React.useState('edit');
        const [discardOpen, setDiscardOpen] = React.useState(false);
        const [lastAttempt, setLastAttempt] = React.useState(null);
        const dialogRef = React.useRef(null);
        const overlayRef = React.useRef(null);
        const inputRef = React.useRef(null);
        const logRef = React.useRef(null);
        const previewRef = React.useRef(null);
        const requestRef = React.useRef(0);
        const timeoutRef = React.useRef(null);
        const mountedRef = React.useRef(true);
        const closeRef = React.useRef(null);
        const idRef = React.useRef(null);
        if (!idRef.current) idRef.current = 'alex-builder-' + (++nextDialogId);
        const id = idRef.current;
        const dirty = !same(draft, saved);
        const focused = (layout || []).find(item => item.id === focusId);
        const focusedLabel = focused && catalog.find(item => item.key === focused.key)?.label;
        const leagueName = league?.name || 'Your league';

        function cancelRequest() {
            requestRef.current += 1;
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            setBusy(false);
            setLastAttempt(null);
            setMessages(current => [...current, { role: 'assistant', content: 'Cancelled that request. No changes were made to your preview.' }]);
            setStatus('Request cancelled. Your preview is unchanged.');
        }

        function close() {
            if (saving) return;
            if (dirty || busy || input.trim()) { setDiscardOpen(true); return; }
            onClose();
        }
        closeRef.current = close;

        React.useEffect(() => {
            mountedRef.current = true;
            const dialog = dialogRef.current;
            const opener = document.activeElement;
            const overflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            const controls = () => Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                .filter(element => !element.disabled && element.tabIndex >= 0 && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[inert]') && element.getClientRects().length);
            // Focusing the title/close control avoids opening the phone keyboard on entry.
            (controls()[0] || dialog).focus();
            const onKey = event => {
                const childDialog = event.target.closest?.('[role="dialog"], dialog[open]');
                if (childDialog && childDialog !== dialog) return;
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
                if (event.key !== 'Tab') return;
                const items = controls();
                if (!items.length) { event.preventDefault(); dialog.focus(); return; }
                const first = items[0], last = items[items.length - 1];
                if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
                else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            };
            const onFocus = event => {
                if (dialog.contains(event.target) || event.target.closest?.('[role="dialog"], dialog[open]')) return;
                (controls()[0] || dialog).focus();
            };
            const updateViewport = () => {
                const viewport = window.visualViewport;
                if (!viewport || !overlayRef.current) return;
                overlayRef.current.style.setProperty('--alex-viewport-height', viewport.height + 'px');
                overlayRef.current.style.setProperty('--alex-viewport-top', viewport.offsetTop + 'px');
                overlayRef.current.classList.toggle('alex-builder-compact', viewport.height <= 520);
                overlayRef.current.classList.toggle('alex-builder-tight', viewport.height <= 360);
            };
            updateViewport();
            window.visualViewport?.addEventListener('resize', updateViewport);
            window.visualViewport?.addEventListener('scroll', updateViewport);
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('focusin', onFocus);
            return () => {
                mountedRef.current = false;
                requestRef.current += 1;
                clearTimeout(timeoutRef.current);
                window.visualViewport?.removeEventListener('resize', updateViewport);
                window.visualViewport?.removeEventListener('scroll', updateViewport);
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('focusin', onFocus);
                document.body.style.overflow = overflow;
                const restoreFocus = () => {
                    // Saving can replace the original section/launcher node.
                    // Wait until the portal has left the DOM before restoring.
                    if (document.querySelector('.alex-builder-overlay')) return;
                    const target = opener?.isConnected && opener !== document.body && !dialog.contains(opener)
                        ? opener
                        : Array.from(document.querySelectorAll('.dhq-builder-launch')).find(element => element.getClientRects().length);
                    target?.focus({ preventScroll: true });
                };
                restoreFocus();
                requestAnimationFrame(restoreFocus);
            };
        }, [scope]);

        React.useEffect(() => {
            if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        }, [messages, busy, error]);

        React.useEffect(() => {
            // Keep preview data in the accessibility tree while removing actions
            // from the tab order. Async widget content follows the same rule.
            const preview = previewRef.current;
            if (!preview) return undefined;
            const disableActions = () => {
                preview.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').forEach(element => {
                    element.setAttribute('tabindex', '-1');
                    element.setAttribute('aria-disabled', 'true');
                });
            };
            disableActions();
            const observer = new MutationObserver(disableActions);
            observer.observe(preview, { childList: true, subtree: true });
            return () => observer.disconnect();
        }, []);

        async function runRequest(attempt, retry = false) {
            if (busy || saving) return;
            const sequence = ++requestRef.current;
            const requestScope = scope;
            setError(''); setStatus(''); setBusy(true); setLastAttempt(attempt);
            setDiscardOpen(false);
            if (!retry) setMessages([...attempt.messages, { role: 'user', content: attempt.prompt }]);
            setInput('');
            try {
                const result = await Promise.race([
                    window.WR.DashboardBuilder.request({
                        prompt: attempt.prompt, messages: attempt.messages,
                        layout: attempt.layout, catalog, league, focusId,
                    }),
                    new Promise((_, reject) => {
                        timeoutRef.current = setTimeout(() => reject(new Error('Alex is taking longer than expected. Try your request again.')), 45000);
                    }),
                ]);
                if (!mountedRef.current || sequence !== requestRef.current || requestScope !== scope) return;
                if (!same(attempt.layout, result.layout)) {
                    setHistory(previous => [...previous.slice(-19), copy(attempt.layout)]);
                    setDraft(copy(result.layout));
                }
                setMessages([...attempt.messages, { role: 'user', content: attempt.prompt }, { role: 'assistant', content: result.reply }]);
                setStatus(same(attempt.layout, result.layout) ? 'Alex replied. Your preview is unchanged.' : 'Preview updated. Save when you’re ready.');
                setLastAttempt(null);
            } catch (failure) {
                if (!mountedRef.current || sequence !== requestRef.current) return;
                setError(failure?.message || 'Alex could not update your preview. Please try again.');
                setMessages([...attempt.messages, { role: 'user', content: attempt.prompt }, { role: 'assistant', content: 'That request was not applied. Your dashboard preview is unchanged.' }]);
                setInput(attempt.prompt);
            } finally {
                if (sequence === requestRef.current) {
                    clearTimeout(timeoutRef.current); timeoutRef.current = null;
                    if (mountedRef.current) setBusy(false);
                }
            }
        }

        function submit(event) {
            event?.preventDefault();
            const prompt = input.trim();
            if (!prompt || busy || saving) return;
            runRequest({ prompt, layout: copy(draft), messages: messages.slice(-12) });
        }

        function undo() {
            if (!history.length || busy || saving) return;
            const previous = history[history.length - 1];
            setDraft(copy(previous));
            setHistory(history.slice(0, -1));
            setMessages(current => [...current, { role: 'assistant', content: 'Undid the last preview change.' }]);
            setError(''); setStatus('Last preview change undone.'); setLastAttempt(null);
        }

        async function save() {
            if (!dirty || busy || saving) return;
            setSaving(true); setError(''); setStatus('');
            try {
                await onSave(copy(draft));
                if (!mountedRef.current) return;
                setSaved(copy(draft)); setHistory([]); setDiscardOpen(false);
                setStatus('Saved on this device.');
            } catch (failure) {
                if (mountedRef.current) {
                    setError(failure?.message || 'Your dashboard could not be saved. Your preview is still here.');
                    setTab('edit');
                }
            } finally { if (mountedRef.current) setSaving(false); }
        }

        const suggestions = focusedLabel
            ? ['Move this section to the top', 'Show more detail in this section', 'Remove this section']
            : ['Build my weekly dashboard', 'Focus on my roster and draft picks', 'Put my matchup first'];
        const chooseSuggestion = prompt => { setInput(prompt); setTab('edit'); inputRef.current?.focus(); };
        const changeTab = next => { if (next === 'preview') inputRef.current?.blur(); setTab(next); setDiscardOpen(false); };
        const tabKeyDown = event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'edit' : event.key === 'End' ? 'preview' : tab === 'edit' ? 'preview' : 'edit';
            changeTab(next);
            document.getElementById(id + '-' + next + '-tab')?.focus();
        };
        const panel = (
            <div className="alex-builder-overlay" ref={overlayRef}>
                <section className="alex-builder" role="dialog" aria-modal="true" aria-labelledby={id + '-title'} aria-describedby={id + '-description'} ref={dialogRef} tabIndex={-1}>
                    <header className="alex-builder-header">
                        <div>
                            <span className="alex-builder-eyebrow">YOUR HOME · {leagueName}</span>
                            <h2 id={id + '-title'}>Build with Alex</h2>
                            <p id={id + '-description'}>Describe what matters. Preview it here, then save to Home.</p>
                        </div>
                        <button type="button" className="alex-builder-button alex-builder-close" aria-label="Close builder" onClick={close} disabled={saving}>Close</button>
                    </header>
                    {discardOpen && (
                        <div className="alex-builder-discard" role="alert">
                            <p>Leave without saving your changes?</p>
                            <div className="alex-builder-inline-actions">
                                <button type="button" className="alex-builder-button" onClick={() => setDiscardOpen(false)}>Keep editing</button>
                                <button type="button" className="alex-builder-button" onClick={() => { requestRef.current += 1; onClose(); }}>Discard changes</button>
                            </div>
                        </div>
                    )}
                    <div className="alex-builder-tabs" role="tablist" aria-label="Dashboard builder">
                        <button type="button" role="tab" id={id + '-edit-tab'} aria-controls={id + '-edit'} aria-selected={tab === 'edit'} tabIndex={tab === 'edit' ? 0 : -1} className="alex-builder-button" onKeyDown={tabKeyDown} onClick={() => changeTab('edit')}>Edit</button>
                        <button type="button" role="tab" id={id + '-preview-tab'} aria-controls={id + '-preview'} aria-selected={tab === 'preview'} tabIndex={tab === 'preview' ? 0 : -1} className="alex-builder-button" onKeyDown={tabKeyDown} onClick={() => changeTab('preview')}>Preview</button>
                    </div>
                    <div className={'alex-builder-body alex-builder-show-' + tab}>
                        <div className="alex-builder-editor" id={id + '-edit'} role="tabpanel" aria-labelledby={id + '-edit-tab'}>
                            <div className="alex-builder-conversation" ref={logRef}>
                                {focusedLabel && <p className="alex-builder-focus">Editing: <strong>{focusedLabel}</strong></p>}
                                {!messages.length && <div className="alex-builder-welcome">
                                    <h3>What should Home help you do?</h3>
                                    <p>Choose a starting point or describe your own. You can keep refining the preview.</p>
                                    <div className="alex-builder-suggestions">
                                        {suggestions.map(prompt => <button type="button" key={prompt} className="alex-builder-button" onClick={() => chooseSuggestion(prompt)}>{prompt}</button>)}
                                    </div>
                                </div>}
                                <div className="alex-builder-log" role="log" aria-label="Conversation with Alex" aria-live="polite" aria-relevant="additions text">
                                    {messages.map((message, index) => <div key={index} className={'alex-builder-message alex-builder-message-' + message.role}>
                                        <strong>{message.role === 'user' ? 'You' : 'Alex'}</strong>
                                        <p>{message.content}</p>
                                    </div>)}
                                </div>
                                {busy && <div className="alex-builder-working" aria-hidden="true">Alex is updating your preview…</div>}
                            </div>
                            <form className="alex-builder-composer" onSubmit={submit}>
                                {error && <div className="alex-builder-error" role="alert"><p>{error}</p>{lastAttempt && !busy && <button type="button" className="alex-builder-button" onClick={() => runRequest(lastAttempt, true)}>Retry request</button>}</div>}
                                <label htmlFor={id + '-prompt'}>Describe your dashboard</label>
                                <textarea ref={inputRef} id={id + '-prompt'} value={input} onChange={event => setInput(event.target.value)} maxLength={2000} rows={2} placeholder={focusedLabel ? 'Make this section more detailed…' : 'Show my matchup, roster health, and upcoming league dates…'} disabled={busy || saving} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event); }} />
                                {busy
                                    ? <button type="button" className="alex-builder-button" onClick={cancelRequest}>Cancel request</button>
                                    : <button type="submit" className="alex-builder-button alex-builder-primary" disabled={!input.trim() || saving}>Update preview</button>}
                            </form>
                        </div>
                        <div className="alex-builder-preview" id={id + '-preview'} role="tabpanel" aria-labelledby={id + '-preview-tab'}>
                            <div className="alex-builder-preview-heading"><h3>Home preview</h3><span>{draft.length} {draft.length === 1 ? 'section' : 'sections'} · {dirty ? 'Unsaved changes' : 'Saved layout'}</span></div>
                            <div className="alex-builder-preview-content" ref={previewRef} onClickCapture={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDownCapture={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); } }}>{renderPreview(draft)}</div>
                            {!draft.length && <p className="alex-builder-empty">Your Home is clear. Ask Alex to add a section.</p>}
                        </div>
                    </div>
                    <footer className="alex-builder-footer">
                        <p role="status" className="alex-builder-status">{saving ? 'Saving your dashboard…' : busy ? 'Alex is updating your preview…' : status || (dirty ? 'Your Home stays unchanged until you save.' : 'Layouts are saved on this device.')}</p>
                        <div className="alex-builder-footer-actions">
                            <button type="button" className="alex-builder-button" onClick={undo} disabled={!history.length || busy || saving}>Undo</button>
                            <button type="button" className="alex-builder-button alex-builder-primary" onClick={save} disabled={!dirty || busy || saving}>Save dashboard</button>
                        </div>
                    </footer>
                </section>
            </div>
        );
        return window.ReactDOM?.createPortal ? window.ReactDOM.createPortal(panel, document.body) : panel;
    }
    window.WR.DashboardBuilderPanel = DashboardBuilderPanel;
})();
