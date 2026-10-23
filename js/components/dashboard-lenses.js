/* Personal dashboard lenses: one active canvas, with Alex as the editor. */
(function () {
    'use strict';
    window.WR = window.WR || {};
    let nextWorkspaceId = 0;
    const clone = value => JSON.parse(JSON.stringify(value));
    const customViews = lens => lens.layout.filter(item => item.key === 'custom-view' && item.view).map(item => ({ ...item, lensName: lens.name }));

    function DashboardLenses(props) {
        // A scope change removes the entire old workspace and its in-flight editor
        // before the new account or league can render a frame of private content.
        return <DashboardLensesWorkspace key={props.scope || 'unconnected'} {...props} />;
    }

    function DashboardLensesWorkspace({ scope, legacyLayout, catalog, league, renderCanvas, renderPreview, assertCurrentScope }) {
        const store = window.WR.DashboardLensesStore;
        const [initial] = React.useState(() => {
            try { return { document: store.read(scope, legacyLayout, catalog), error: '' }; }
            catch (failure) { return { document: null, error: failure.message || 'Your lenses could not be opened.' }; }
        });
        const [saved, setSaved] = React.useState(initial.document);
        const [error, setError] = React.useState(initial.error);
        const [notice, setNotice] = React.useState('');
        const [form, setForm] = React.useState(null);
        const [name, setName] = React.useState('');
        const [optionsOpen, setOptionsOpen] = React.useState(false);
        const [removeOpen, setRemoveOpen] = React.useState(false);
        const [editing, setEditing] = React.useState(null);
        const [externalChange, setExternalChange] = React.useState(false);
        const [motion, setMotion] = React.useState('none');
        const documentRef = React.useRef(saved);
        const editingRef = React.useRef(editing);
        const inputRef = React.useRef(null);
        const workspaceRef = React.useRef(null);
        const canvasRef = React.useRef(null);
        const tabsRef = React.useRef(null);
        const newRef = React.useRef(null);
        const optionsRef = React.useRef(null);
        const buildRef = React.useRef(null);
        const changeRef = React.useRef(null);
        const suppressClickUntil = React.useRef(0);
        const propsRef = React.useRef({ legacyLayout, catalog });
        const idRef = React.useRef(null);
        if (!idRef.current) idRef.current = 'dashboard-lenses-' + (++nextWorkspaceId);
        const id = idRef.current;
        documentRef.current = saved;
        editingRef.current = editing;
        propsRef.current = { legacyLayout, catalog };
        const active = saved?.lenses.find(lens => lens.id === saved.activeId);
        const activeIndex = saved?.lenses.findIndex(lens => lens.id === saved.activeId) ?? -1;
        const count = saved?.lenses.length || 0;

        function reload() {
            try {
                const next = store.read(scope, propsRef.current.legacyLayout, propsRef.current.catalog);
                documentRef.current = next;
                setSaved(next); setError(''); setExternalChange(false);
                return next;
            } catch (failure) {
                setError(failure.message || 'Your lenses could not be opened.');
                return null;
            }
        }

        React.useEffect(() => {
            const onStorage = event => {
                if (!scope || (event.key !== null && event.key !== store.storageKey(scope))) return;
                if (editingRef.current || form) { setExternalChange(true); return; }
                const next = reload();
                if (next) setNotice('Lenses updated from another tab.');
            };
            window.addEventListener('storage', onStorage);
            return () => window.removeEventListener('storage', onStorage);
        }, [scope, form]);

        React.useEffect(() => {
            if (form) inputRef.current?.focus();
        }, [form]);

        React.useEffect(() => {
            const tab = tabsRef.current?.querySelector('[aria-selected="true"]');
            // Scroll the tab strip only, rather than scrollIntoView moving the
            // whole page when a long lens is switched near its bottom.
            if (tab && tabsRef.current) {
                const strip = tabsRef.current;
                const left = tab.offsetLeft - strip.offsetLeft;
                if (left < strip.scrollLeft) strip.scrollLeft = left;
                else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth;
            }
        }, [active?.id, count]);

        function apply(action, message, expected = documentRef.current) {
            assertCurrentScope?.();
            const next = store.change(scope, expected, action, propsRef.current.catalog);
            documentRef.current = next;
            setSaved(next); setError(''); setNotice(message || '');
            return next;
        }

        function act(action, message) {
            try { return apply(action, message); }
            catch (failure) { setError(failure.message || 'That change could not be saved. Please try again.'); return null; }
        }

        function selectLens(lensId, focusTab = false) {
            const current = documentRef.current;
            if (!current || current.activeId === lensId || editingRef.current || form) return;
            const target = current.lenses.find(lens => lens.id === lensId);
            if (!target) return;
            const from = current.lenses.findIndex(lens => lens.id === current.activeId);
            const to = current.lenses.findIndex(lens => lens.id === lensId);
            const next = act({ type: 'select', id: lensId }, 'Viewing ' + target.name + '. Lens ' + (to + 1) + ' of ' + current.lenses.length + '.');
            if (!next) return;
            setOptionsOpen(false); setRemoveOpen(false); setMotion(to > from ? 'next' : 'previous');
            if (focusTab) requestAnimationFrame(() => document.getElementById(id + '-tab-' + lensId)?.focus({ preventScroll: true }));
        }
        changeRef.current = delta => {
            const current = documentRef.current;
            if (!current) return;
            const index = current.lenses.findIndex(lens => lens.id === current.activeId);
            const target = current.lenses[index + delta];
            if (target) selectLens(target.id);
        };

        function tabKey(event, index) {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
            selectLens(saved.lenses[next].id, true);
        }

        React.useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return undefined;
            let gesture = null;
            function blockedTarget(target) {
                if (target.closest?.('input,select,textarea,summary,[role="slider"],[contenteditable="true"],[data-lens-no-swipe]')) return true;
                let element = target;
                while (element && element !== canvas) {
                    // Leave horizontally scrollable charts and tables entirely
                    // native, including when the scroll is already at an edge.
                    if (element.scrollWidth > element.clientWidth + 3 && /auto|scroll/.test(window.getComputedStyle(element).overflowX)) return true;
                    element = element.parentElement;
                }
                return false;
            }
            const start = event => {
                gesture = null;
                if (event.touches.length !== 1 || editingRef.current || blockedTarget(event.target) || window.getSelection?.()?.toString()) return;
                const point = event.touches[0];
                gesture = { x: point.clientX, y: point.clientY, at: Date.now(), dx: 0, dy: 0, horizontal: false };
            };
            const move = event => {
                if (!gesture || event.touches.length !== 1) { gesture = null; return; }
                const point = event.touches[0];
                gesture.dx = point.clientX - gesture.x;
                gesture.dy = point.clientY - gesture.y;
                if (!gesture.horizontal && Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) >= Math.abs(gesture.dx)) { gesture = null; return; }
                if (Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) gesture.horizontal = true;
                if (gesture.horizontal && event.cancelable) event.preventDefault();
            };
            const end = () => {
                const finished = gesture; gesture = null;
                if (!finished?.horizontal) return;
                suppressClickUntil.current = Date.now() + 450;
                if (Math.abs(finished.dx) < 56 || Math.abs(finished.dx) < Math.abs(finished.dy) * 1.5 || Date.now() - finished.at > 1200) return;
                changeRef.current(finished.dx < 0 ? 1 : -1);
            };
            const cancel = () => { gesture = null; };
            canvas.addEventListener('touchstart', start, { passive: true });
            canvas.addEventListener('touchmove', move, { passive: false });
            canvas.addEventListener('touchend', end, { passive: true });
            canvas.addEventListener('touchcancel', cancel, { passive: true });
            return () => {
                canvas.removeEventListener('touchstart', start); canvas.removeEventListener('touchmove', move);
                canvas.removeEventListener('touchend', end); canvas.removeEventListener('touchcancel', cancel);
            };
        }, [Boolean(active)]);

        function beginForm(type) {
            setName(type === 'rename' ? active.name : '');
            setForm(type); setRemoveOpen(false); setOptionsOpen(false); setError(''); setNotice('');
        }

        function cancelForm() {
            const was = form;
            setForm(null); setError('');
            if (externalChange) reload();
            requestAnimationFrame(() => (was === 'create' ? newRef.current : optionsRef.current)?.focus({ preventScroll: true }));
        }

        function submitName(event) {
            event.preventDefault();
            const next = act(form === 'create' ? { type: 'create', name: name.trim() }
                : { type: 'rename', id: active.id, name: name.trim() }, form === 'create' ? 'Lens created. Tell Alex what you want to see.' : 'Lens renamed.');
            if (!next) return;
            const created = form === 'create';
            setForm(null); setName(''); setExternalChange(false);
            if (created) openBuilder(next);
            else requestAnimationFrame(() => optionsRef.current?.focus({ preventScroll: true }));
        }

        function openBuilder(document = documentRef.current) {
            const lens = document?.lenses.find(item => item.id === document.activeId);
            if (!lens) return;
            setOptionsOpen(false); setRemoveOpen(false); setError('');
            setEditing({ id: lens.id, expected: clone(document), layout: clone(lens.layout) });
        }

        function saveLens(layout) {
            const session = editingRef.current;
            if (!session || session.id !== documentRef.current.activeId) throw new Error('This lens changed. Close Alex and reopen the lens before saving.');
            const next = apply({ type: 'save', id: session.id, layout }, 'Lens saved on this device.', session.expected);
            const persisted = next.lenses.find(lens => lens.id === session.id);
            const nextSession = { ...session, expected: clone(next), layout: clone(persisted.layout) };
            editingRef.current = nextSession; setEditing(nextSession); setExternalChange(false);
            return persisted.layout;
        }

        function closeBuilder() {
            setEditing(null); editingRef.current = null;
            if (externalChange) reload();
            requestAnimationFrame(() => buildRef.current?.focus({ preventScroll: true }));
        }

        function duplicate() {
            const next = act({ type: 'duplicate', id: active.id }, 'Lens duplicated. Edit this copy with Alex.');
            if (next) {
                setOptionsOpen(false); setMotion('next');
                requestAnimationFrame(() => buildRef.current?.focus({ preventScroll: true }));
            }
        }

        function remove() {
            const next = act({ type: 'remove', id: active.id }, 'Lens removed. You can restore it below.');
            if (next) { setRemoveOpen(false); setOptionsOpen(false); requestAnimationFrame(() => buildRef.current?.focus({ preventScroll: true })); }
        }

        if (!active) return <section className="dashboard-lenses dashboard-lenses-unavailable" aria-label="Dashboard lenses">
            <h2>Your lenses</h2><p role="alert">{error || 'Connect your league to create personal lenses.'}</p>
            <button type="button" className="dashboard-lenses-button" onClick={reload}>Try again</button>
        </section>;

        return <section className="dashboard-lenses" ref={workspaceRef} aria-label="Your dashboard lenses" data-active-lens={active.id}>
            <header className="dashboard-lenses-header">
                <div className="dashboard-lenses-heading">
                    <span className="dashboard-lenses-eyebrow">YOUR LENSES <span aria-hidden="true">/</span> {league?.name || 'YOUR LEAGUE'}</span>
                    <h2>{active.name}</h2>
                    <p>Different questions. Your own ways to see the league.</p>
                </div>
                <div className="dashboard-lenses-header-actions">
                    <button type="button" ref={newRef} className="dashboard-lenses-button dashboard-lenses-new" onClick={() => beginForm('create')} disabled={Boolean(form) || count >= store.MAX_LENSES}><span aria-hidden="true">＋</span> New lens</button>
                    <button type="button" ref={buildRef} className="dashboard-lenses-button dashboard-lenses-primary dhq-builder-launch" onClick={() => openBuilder()} disabled={Boolean(form)}>Build with Alex <span aria-hidden="true">↗</span></button>
                    <button type="button" ref={optionsRef} className="dashboard-lenses-button dashboard-lenses-options-button" aria-expanded={optionsOpen} aria-controls={id + '-options'} onClick={() => { setOptionsOpen(value => !value); setRemoveOpen(false); }} disabled={Boolean(form)} aria-label="Lens options"><span aria-hidden="true">•••</span></button>
                </div>
            </header>

            <div className="dashboard-lenses-navigation">
                <div className="dashboard-lenses-tabs" ref={tabsRef} role="tablist" aria-label="Dashboard lenses">
                    {saved.lenses.map((lens, index) => <button type="button" role="tab" className="dashboard-lenses-tab" key={lens.id} id={id + '-tab-' + lens.id} aria-controls={id + '-canvas'} aria-selected={active.id === lens.id} tabIndex={active.id === lens.id ? 0 : -1} onKeyDown={event => tabKey(event, index)} onClick={() => selectLens(lens.id)} disabled={Boolean(form)}><span>{lens.name}</span></button>)}
                </div>
                <div className="dashboard-lenses-stepper" data-multiple={count > 1 ? 'true' : 'false'}>
                    <span className="dashboard-lenses-position" aria-hidden="true">{activeIndex + 1} / {count}</span>
                    <button type="button" className="dashboard-lenses-button" aria-label="Previous lens" onClick={() => changeRef.current(-1)} disabled={activeIndex === 0 || Boolean(form)}><span aria-hidden="true">←</span></button>
                    <button type="button" className="dashboard-lenses-button" aria-label="Next lens" onClick={() => changeRef.current(1)} disabled={activeIndex === count - 1 || Boolean(form)}><span aria-hidden="true">→</span></button>
                </div>
            </div>

            {optionsOpen && <div className="dashboard-lenses-options" id={id + '-options'}>
                <span>Make this lens yours</span>
                <button type="button" className="dashboard-lenses-button" onClick={() => beginForm('rename')}>Rename lens</button>
                <button type="button" className="dashboard-lenses-button" onClick={duplicate} disabled={count >= store.MAX_LENSES}>Duplicate lens</button>
                <button type="button" className="dashboard-lenses-button" onClick={() => act({ type: 'undo', id: active.id }, 'Previous version of this lens restored.')} disabled={!active.history.length}>Undo last save</button>
                <button type="button" className="dashboard-lenses-button dashboard-lenses-remove" onClick={() => setRemoveOpen(true)} disabled={count <= 1}>Remove lens</button>
                {count <= 1 && <small>Keep at least one lens.</small>}
            </div>}

            {form && <form className="dashboard-lenses-form" onSubmit={submitName} aria-labelledby={id + '-form-title'}>
                <div><h3 id={id + '-form-title'}>{form === 'create' ? 'Create a lens' : 'Rename lens'}</h3><p>{form === 'create' ? 'Give it a name, then tell Alex what you want to see.' : 'Choose a name that tells you what this lens is for.'}</p></div>
                <label htmlFor={id + '-name'}>Lens name<input id={id + '-name'} ref={inputRef} value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="e.g. Sunday decisions" autoComplete="off" required onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelForm(); } }} /></label>
                <div className="dashboard-lenses-form-actions"><button type="submit" className="dashboard-lenses-button dashboard-lenses-primary" disabled={!name.trim()}>{form === 'create' ? 'Create lens' : 'Save name'}</button><button type="button" className="dashboard-lenses-button" onClick={cancelForm}>Cancel</button></div>
            </form>}

            {removeOpen && <div className="dashboard-lenses-remove-confirm" role="group" aria-labelledby={id + '-remove-title'}>
                <div><h3 id={id + '-remove-title'}>Remove this lens?</h3><p>“{active.name}” will leave your lens list. You can undo this removal.</p><p>Existing reminders keep their schedules. You can pause them in Alex.</p></div>
                <button type="button" className="dashboard-lenses-button dashboard-lenses-remove" onClick={remove}>Remove lens</button>
                <button type="button" className="dashboard-lenses-button" onClick={() => setRemoveOpen(false)}>Keep lens</button>
            </div>}

            {saved.removed && <div className="dashboard-lenses-restore"><p>Removed “{saved.removed.name}”.</p><button type="button" className="dashboard-lenses-button" onClick={() => act({ type: 'restore' }, 'Lens restored.')} disabled={count >= store.MAX_LENSES}>Restore lens</button></div>}
            {externalChange && <div className="dashboard-lenses-sync" role="status">Your lenses changed in another tab. Close the editor to load those changes; your open preview has been kept.</div>}
            {error && <div className="dashboard-lenses-error" role="alert"><p>{error}</p>{!editing && <button type="button" className="dashboard-lenses-button" onClick={() => { if (reload()) { setForm(null); setNotice('Latest saved lenses loaded.'); } }}>Load saved lenses</button>}</div>}
            <p className="dashboard-lenses-status" role="status" aria-live="polite">{notice}</p>

            <div className="dashboard-lenses-canvas" ref={canvasRef} id={id + '-canvas'} role="tabpanel" aria-labelledby={id + '-tab-' + active.id} tabIndex={0} onClickCapture={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}>
                {active.layout.length ? <div key={active.id} className={'dashboard-lenses-page dashboard-lenses-page-' + motion}>{renderCanvas(active.layout)}</div> : <div className="dashboard-lenses-empty">
                    <span className="dashboard-lenses-empty-mark" aria-hidden="true">◎</span>
                    <span className="dashboard-lenses-eyebrow">A NEW PERSPECTIVE</span>
                    <h3>What should {active.name} help you see?</h3>
                    <p>Ask for a comparison, a roster breakdown, or the numbers you check most. Alex will build a view you can make your own.</p>
                    <button type="button" className="dashboard-lenses-button dashboard-lenses-primary" onClick={() => openBuilder()} disabled={Boolean(form)}>Start with Alex</button>
                </div>}
            </div>
            {count > 1 && <p className="dashboard-lenses-swipe-hint"><span aria-hidden="true">↔</span> Swipe the view to change lenses</p>}
            {editing && <window.WR.DashboardBuilderPanel key={scope + ':' + editing.id} layout={editing.layout} catalog={catalog} league={league} scope={scope} lensId={editing.id} lensName={saved.lenses.find(lens => lens.id === editing.id)?.name || active.name} otherReminderViews={saved.lenses.filter(lens => lens.id !== editing.id).flatMap(customViews)} normalizeLayout={layout => store.prepareLayout(editing.expected, editing.id, layout, catalog)} onSave={saveLens} onClose={closeBuilder} renderPreview={renderPreview} />}
        </section>;
    }
    window.WR.DashboardLenses = DashboardLenses;
})();
