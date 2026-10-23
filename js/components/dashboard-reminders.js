/* Reminder drafts are saved separately from the dashboard preview. */
(function () {
    'use strict';
    window.WR = window.WR || {};
    let nextPanelId = 0;

    function DashboardReminderPanel({ scope, league, views = [], savedViews = [] }) {
        const api = window.WR.DashboardReminders;
        const [expanded, setExpanded] = React.useState(false);
        const [saved, setSaved] = React.useState({ revision: 0, reminders: [] });
        const [editing, setEditing] = React.useState(null);
        const [service, setService] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [message, setMessage] = React.useState('');
        const [error, setError] = React.useState('');
        const [readFailed, setReadFailed] = React.useState(false);
        const [emailCode, setEmailCode] = React.useState('');
        const sequence = React.useRef(0);
        const request = React.useRef(null);
        const scopeRef = React.useRef(scope);
        const panelId = React.useRef(null);
        if (!panelId.current) panelId.current = 'dashboard-reminders-' + (++nextPanelId);
        scopeRef.current = scope;
        const id = panelId.current;
        const leagueId = String(league?.league_id ?? league?.id ?? '');
        const viewOptions = views.filter(view => view?.id).map(view => ({ id: view.id, title: String((view.lensName ? view.lensName + ' · ' : '') + (view.title || view.view?.title || 'Dashboard view')).slice(0, 120) }));
        const selectedView = viewOptions.find(view => view.id === editing?.viewId);
        const records = api.mergeReminders(saved.reminders, service);
        const viewIsSaved = viewId => {
            const current = views.find(view => view.id === viewId);
            const persisted = savedViews.find(view => view.id === viewId);
            return !!current && !!persisted && JSON.stringify(current) === JSON.stringify(persisted);
        };

        React.useEffect(() => {
            sequence.current++;
            request.current?.abort();
            setEditing(null); setService(null); setEmailCode(''); setMessage(''); setError(''); setBusy(false); setReadFailed(false);
            try { setSaved(api.read(scope)); } catch (failure) {
                setSaved({ revision: 0, reminders: [] }); setError(failure.message); setReadFailed(true);
            }
            return () => { sequence.current++; request.current?.abort(); };
        }, [scope, leagueId]);

        async function checkDelivery() {
            if (busy) return;
            const current = ++sequence.current, startedScope = scope;
            const controller = new window.AbortController();
            request.current?.abort(); request.current = controller;
            setBusy(true); setError(''); setMessage('');
            const result = await api.checkService({ scope, leagueId, signal: controller.signal });
            if (current !== sequence.current || startedScope !== scopeRef.current) return;
            setService(result); setBusy(false);
            setMessage(result.status === 'ready' ? 'Delivery status checked.' : result.reason);
        }

        function startDraft() {
            if (!viewOptions.length) return;
            setEditing({ id: api.newId(), viewId: viewOptions[0].id, title: viewOptions[0].title, channel: 'email',
                schedule: { frequency: 'weekly', day: 2, time: '09:00', timeZone: api.timezone() } });
            setError(''); setMessage(''); setExpanded(true);
        }

        function changeSchedule(field, value) {
            setEditing(current => ({ ...current, schedule: { ...current.schedule, [field]: value,
                ...(field === 'frequency' && value === 'weekly' && !Number.isInteger(current.schedule.day) ? { day: 2 } : {}) } }));
        }

        function save(event) {
            event.preventDefault();
            if (!editing || busy || readFailed) return;
            if (!selectedView) { setError('Choose a view currently in your dashboard preview.'); return; }
            try {
                setSaved(api.saveDraft(scope, editing, saved.revision));
                setEditing(null); setError(''); setMessage('Reminder draft saved on this device. Delivery has not been changed.');
            } catch (failure) { setError(failure.message); }
        }

        function remove(draft) {
            try {
                setSaved(api.removeDraft(scope, draft.id, saved.revision));
                if (editing?.id === draft.id) setEditing(null);
                setError(''); setMessage('Reminder draft removed from this device.');
            } catch (failure) { setError(failure.message); }
        }

        async function changeDelivery(draft, action) {
            if (busy) return;
            const current = ++sequence.current, startedScope = scope;
            const controller = new window.AbortController();
            request.current?.abort(); request.current = controller;
            setBusy(true); setError(''); setMessage('');
            try {
                // Every button action rechecks authentication and channel readiness.
                const fresh = await api.checkService({ scope, leagueId, signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                setService(fresh);
                await api.configure({ scope, leagueId, draft, service: fresh, action, viewSaved: viewIsSaved(draft.viewId), signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                const checked = await api.checkService({ scope, leagueId, signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                setService(checked);
                setMessage(checked.status === 'ready' ? (action === 'pause' ? 'Reminder paused.' : 'Reminder schedule confirmed by the delivery service.') : 'The change was accepted. Check delivery status to see the current schedule.');
            } catch (failure) {
                if (current === sequence.current && startedScope === scopeRef.current) {
                    setService(null); setError(failure.message || 'This change could not be confirmed. Check delivery status again.');
                }
            } finally {
                if (current === sequence.current && startedScope === scopeRef.current) setBusy(false);
            }
        }

        async function channelChange(action) {
            if (busy) return;
            const current = ++sequence.current, startedScope = scope;
            const controller = new window.AbortController();
            request.current?.abort(); request.current = controller;
            setBusy(true); setError(''); setMessage('');
            try {
                const fresh = await api.checkService({ scope, leagueId, signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                setService(fresh);
                if (action === 'push-unsubscribe') await api.disconnectPush({ scope, leagueId, service: fresh, signal: controller.signal });
                else await api.channelAction({ scope, leagueId, service: fresh, action, code: emailCode.trim(), signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                const checked = await api.checkService({ scope, leagueId, signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                setService(checked);
                if (action === 'email-confirm' || action === 'email-disable') setEmailCode('');
                const notices = {
                    'email-start': 'Verification code sent to your account email. Enter it below to connect reminders.',
                    'email-confirm': 'Email reminders connected. Enable a saved reminder when you’re ready.',
                    'email-disable': 'Email reminders turned off. Existing email schedules are paused.',
                    'push-unsubscribe': 'Push disconnected on this device. Its push schedules are paused.',
                };
                setMessage(checked.status === 'ready' ? notices[action] : 'The change was accepted. Check delivery status to confirm the current setup.');
            } catch (failure) {
                if (current === sequence.current && startedScope === scopeRef.current) {
                    if (action !== 'email-confirm') setService(null);
                    setError(failure.message || 'Delivery setup could not be confirmed. Check delivery status again.');
                }
            } finally { if (current === sequence.current && startedScope === scopeRef.current) setBusy(false); }
        }

        function connectPush() {
            if (busy) return;
            const current = ++sequence.current, startedScope = scope;
            const controller = new window.AbortController();
            request.current?.abort(); request.current = controller;
            setError(''); setMessage(''); setBusy(true);
            // Keep the permission request in this click's user-activation context.
            let operation;
            try { operation = api.connectPush({ scope, leagueId, service, signal: controller.signal }); }
            catch (failure) { setError(failure.message); setBusy(false); return; }
            Promise.resolve(operation).then(async () => {
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                const checked = await api.checkService({ scope, leagueId, signal: controller.signal });
                if (current !== sequence.current || startedScope !== scopeRef.current) return;
                setService(checked);
                setMessage(checked.channels?.push?.ready ? 'Push connected on this device. Enable a saved reminder when you’re ready.' : 'Push registration was accepted. Check delivery status to confirm this device.');
            }).catch(failure => {
                if (current === sequence.current && startedScope === scopeRef.current) { setService(null); setError(failure.message || 'Push could not be connected. Try again.'); }
            }).finally(() => { if (current === sequence.current && startedScope === scopeRef.current) setBusy(false); });
        }

        const support = api.pushSupport();
        const email = service?.channels?.email;
        const push = service?.channels?.push;
        const zones = [...new Set([api.timezone(), 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'])];
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return <section className="dashboard-reminders" aria-labelledby={id + '-title'}>
            <button type="button" className="dashboard-reminders-toggle" aria-expanded={expanded} aria-controls={id + '-body'} onClick={() => { setExpanded(value => !value); if (!expanded && !service && !busy) checkDelivery(); }}>
                <span><strong id={id + '-title'}>Reminders</strong><span>Come back to the views that matter.</span></span>
                <span aria-hidden="true">{expanded ? '−' : '+'}</span>
            </button>
            {expanded && <div id={id + '-body'} className="dashboard-reminders-body">
                <p className="dashboard-reminders-note">Choose when to review a view by email or push. Connect a delivery method, then enable a saved reminder. Drafts stay in this browser until enabled.</p>
                <div className="dashboard-reminders-service">
                    <strong>{email?.ready || push?.ready ? 'Delivery connected' : service?.status === 'ready' ? 'Choose how to receive reminders' : 'Delivery not connected'}</strong>
                    <button type="button" className="alex-builder-button" disabled={busy} onClick={checkDelivery}>{busy ? 'Checking…' : 'Check delivery status'}</button>
                </div>
                {service?.status === 'ready' && <div className="dashboard-reminders-channels">
                    <div className="dashboard-reminders-channel">
                        <h4>Email reminders</h4>
                        <p className="dashboard-reminders-note">{email?.maskedEmail ? 'Your account email: ' + email.maskedEmail : 'Reminders go to the email on your Dynasty HQ account.'}</p>
                        {!email?.available && <p className="dashboard-reminders-note">Email delivery is temporarily unavailable.</p>}
                        {email?.ready && <p className="dashboard-reminders-connected">Email connected</p>}
                        {email?.available && !email?.ready && <>
                            <p className="dashboard-reminders-note">Verify your email to opt in to the reminders you enable. You can turn them off here or unsubscribe from any reminder email.</p>
                            <button type="button" className="alex-builder-button" disabled={busy} onClick={() => channelChange('email-start')}>Send verification code</button>
                            {email?.verificationPending && <form className="dashboard-reminders-verify" onSubmit={event => { event.preventDefault(); channelChange('email-confirm'); }}>
                                <label htmlFor={id + '-email-code'}>Email verification code</label>
                                <input id={id + '-email-code'} aria-label="Email verification code" value={emailCode} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} onChange={event => setEmailCode(event.target.value.replace(/[^0-9]/g, ''))} disabled={busy} required />
                                <button type="submit" className="alex-builder-button alex-builder-primary" disabled={busy || !/^\d{6}$/.test(emailCode)}>Verify email</button>
                                <p className="dashboard-reminders-note">The code expires after 15 minutes.</p>
                            </form>}
                        </>}
                        {email?.optedIn && <button type="button" className="alex-builder-button" disabled={busy} onClick={() => channelChange('email-disable')}>Turn off email reminders</button>}
                    </div>
                    <div className="dashboard-reminders-channel">
                        <h4>Push on this device</h4>
                        {push?.ready && <p className="dashboard-reminders-connected">Push connected</p>}
                        {!push?.available && <p className="dashboard-reminders-note">Push delivery is temporarily unavailable.</p>}
                        {push?.available && !support.supported && <p className="dashboard-reminders-note">{support.reason}</p>}
                        {push?.available && support.supported && !push?.subscriptionReady && <button type="button" className="alex-builder-button" disabled={busy || !push.vapidPublicKey} onClick={connectPush}>Connect push on this device</button>}
                        {push?.subscriptionReady && <button type="button" className="alex-builder-button" disabled={busy} onClick={() => channelChange('push-unsubscribe')}>Disconnect push on this device</button>}
                        {push?.available && support.supported && !push?.subscriptionReady && <p className="dashboard-reminders-note">Your browser will ask for permission. Only reminders you enable will be sent.</p>}
                    </div>
                </div>}
                {!!records.length && <ul className="dashboard-reminders-list">
                    {records.map(draft => {
                        const remote = service?.status === 'ready' && service.reminders.find(item => item.id === draft.id);
                        const active = remote?.state === 'enabled';
                        const available = service?.channels?.[draft.channel]?.ready;
                        const viewExists = viewOptions.some(view => view.id === draft.viewId);
                        const persisted = viewIsSaved(draft.viewId);
                        const local = saved.reminders.some(item => item.id === draft.id);
                        return <li key={draft.id}>
                            <div className="dashboard-reminders-row-head"><strong>{draft.title}</strong><span>{draft.channel === 'email' ? 'Email' : 'Push'}</span></div>
                            <p>{api.scheduleLabel(draft.schedule)}</p>
                            <p className="dashboard-reminders-state">{api.statusLabel(draft, service)}</p>
                            {active && <p>Next: {new Date(remote.nextRunAt).toLocaleString([], { timeZone: remote.schedule.timeZone })} · {remote.schedule.timeZone.replace(/_/g, ' ')}</p>}
                            {!viewExists && <p>This view is not in the current preview. Restore it before enabling this draft.</p>}
                            {viewExists && !persisted && <p>Save your lens before enabling this reminder.</p>}
                            <div className="dashboard-reminders-actions">
                                <button type="button" className="alex-builder-button" disabled={busy || readFailed} onClick={() => { setEditing(JSON.parse(JSON.stringify(draft))); setError(''); setMessage(''); }}>Edit draft</button>
                                {available && <button type="button" className="alex-builder-button alex-builder-primary" disabled={busy || !persisted} onClick={() => changeDelivery(draft, 'enable')}>{active ? 'Update schedule' : 'Enable reminder'}</button>}
                                {active && <button type="button" className="alex-builder-button" disabled={busy} onClick={() => changeDelivery(draft, 'pause')}>Pause reminder</button>}
                                {local && <button type="button" className="alex-builder-button" disabled={busy || readFailed || active} title={active ? 'Pause delivery before removing this draft.' : undefined} onClick={() => remove(draft)}>Remove draft</button>}
                            </div>
                        </li>;
                    })}
                </ul>}
                {!editing && <button type="button" className="alex-builder-button" disabled={busy || readFailed || !viewOptions.length || saved.reminders.length >= 24} onClick={startDraft}>Add reminder draft</button>}
                {!viewOptions.length && <p className="dashboard-reminders-note">Build a custom view with Alex, then add a reminder here.</p>}
                {editing && <form className="dashboard-reminders-form" onSubmit={save}>
                    <label htmlFor={id + '-view'}>View<select id={id + '-view'} aria-label="Reminder view" value={editing.viewId} onChange={event => {
                        const view = viewOptions.find(item => item.id === event.target.value);
                        if (view) setEditing(current => ({ ...current, viewId: view.id, title: view.title }));
                    }} required>{!selectedView && <option value={editing.viewId}>Choose a current view</option>}{viewOptions.map(view => <option key={view.id} value={view.id}>{view.title}</option>)}</select></label>
                    <label htmlFor={id + '-title-input'}>Reminder title<input id={id + '-title-input'} aria-label="Reminder title" value={editing.title} maxLength={120} onChange={event => setEditing(current => ({ ...current, title: event.target.value }))} required /></label>
                    <div className="dashboard-reminders-fields">
                        <label htmlFor={id + '-channel'}>Delivery<select id={id + '-channel'} aria-label="Delivery" value={editing.channel} onChange={event => setEditing(current => ({ ...current, channel: event.target.value }))}><option value="email">Email</option><option value="push">Push notification</option></select></label>
                        <label htmlFor={id + '-frequency'}>Repeat<select id={id + '-frequency'} aria-label="Repeat" value={editing.schedule.frequency} onChange={event => changeSchedule('frequency', event.target.value)}><option value="weekly">Weekly</option><option value="daily">Daily</option></select></label>
                    </div>
                    <div className="dashboard-reminders-fields">
                        {editing.schedule.frequency === 'weekly' && <label htmlFor={id + '-day'}>Day<select id={id + '-day'} aria-label="Day" value={editing.schedule.day ?? 2} onChange={event => changeSchedule('day', Number(event.target.value))}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
                        <label htmlFor={id + '-time'}>Time<input id={id + '-time'} aria-label="Time" type="time" value={editing.schedule.time} onChange={event => changeSchedule('time', event.target.value)} required /></label>
                    </div>
                    <label htmlFor={id + '-zone'}>Time zone<input id={id + '-zone'} aria-label="Time zone" list={id + '-zones'} value={editing.schedule.timeZone} placeholder="America/Chicago" autoComplete="off" onChange={event => changeSchedule('timeZone', event.target.value)} required /><datalist id={id + '-zones'}>{zones.map(zone => <option key={zone} value={zone} />)}</datalist></label>
                    <p className="dashboard-reminders-note">This is a scheduled reminder to review your view. It does not watch scores or injuries for changes. Save the lens too to keep a new view.</p>
                    <div className="dashboard-reminders-actions"><button type="submit" className="alex-builder-button alex-builder-primary" disabled={busy || readFailed}>Save reminder draft</button><button type="button" className="alex-builder-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
                </form>}
                {error && <p className="dashboard-reminders-error" role="alert">{error}</p>}
                {message && <p className="dashboard-reminders-note" role="status">{message}</p>}
            </div>}
        </section>;
    }

    window.WR.DashboardReminderPanel = DashboardReminderPanel;
})();
