(function () {
    'use strict';
    const h = React.createElement;
    function WrTimeLeagueRivalsPanel({ league, teamId, throughWeek, onTrades, compact = false, onNavigate, onSend, saving = false, isPrivate = false }) {
        const R = window.App.TimeLeagueRivals;
        const storageKey = `tl-rival-read:${league.leagueId}:${teamId}`;
        const [readState, setReadState] = React.useState({});
        const [selection, setSelection] = React.useState(null);
        const [drafts, setDrafts] = React.useState({});
        const [replyVariants, setReplyVariants] = React.useState({});
        const [sending, setSending] = React.useState(false);
        const [error, setError] = React.useState(null);
        const endRef = React.useRef(null);
        const inboxRef = React.useRef(null);
        const sendingRef = React.useRef(false);
        React.useEffect(() => {
            try { setReadState({ key: storageKey, ids: JSON.parse(localStorage.getItem(storageKey) || '[]') }); }
            catch (_) { setReadState({ key: storageKey, ids: [] }); }
        }, [storageKey]);
        const read = readState.key === storageKey && Array.isArray(readState.ids) ? readState.ids : [];
        const threads = R.threadsFor(league, teamId, { throughWeek });
        const messages = threads.flatMap(thread => thread.messages).filter(message => message.toTeamId === teamId);
        const unread = messages.filter(message => !read.includes(message.id)).length;
        const selectedId = selection?.key === storageKey ? selection.teamId : null;
        const active = threads.find(thread => thread.team.teamId === selectedId) || threads[0];
        const draftKey = `${storageKey}:${active?.team.teamId || ''}`;
        const draft = drafts[draftKey] || { text: '', tone: 'neutral', messageId: '' };
        const suggestedReplies = active ? R.quickRepliesFor(league, teamId, active.team.teamId, { throughWeek, variant: replyVariants[draftKey] || 0 }) : [];
        const relationship = active?.relationship;
        const affinity = relationship ? 6 - relationship.heat : 6;
        const pending = saving || sending;
        const markRead = ids => {
            const next = [...new Set([...read, ...ids])];
            setReadState({ key: storageKey, ids: next });
            try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) { /* Session still works without storage. */ }
        };
        const open = thread => {
            setSelection({ key: storageKey, teamId: thread.team.teamId });
            setError(null);
            markRead(thread.messages.filter(message => message.toTeamId === teamId).map(message => message.id));
        };
        const newestId = active?.latest?.id;
        React.useEffect(() => {
            if (!compact && active && selectedId) {
                endRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
                const unseen = active.messages.filter(message => message.toTeamId === teamId && !read.includes(message.id));
                if (unseen.length) markRead(unseen.map(message => message.id));
            }
        }, [storageKey, selectedId, newestId]);
        React.useEffect(() => {
            if (compact || !inboxRef.current || !window.document) return undefined;
            const inbox = inboxRef.current;
            let frame = null;
            const measure = () => {
                frame = null;
                if (!window.matchMedia?.('(max-width: 900px)').matches) { inbox.style.removeProperty('--tl-chat-available-height'); return; }
                const viewport = window.visualViewport;
                const viewportHeight = viewport?.height || window.innerHeight;
                const top = Math.max(0, inbox.getBoundingClientRect().top - (viewport?.offsetTop || 0));
                const navHeight = document.querySelector('.tl-mobile-nav')?.getBoundingClientRect().height || 70;
                // The measured nav includes its bottom safe-area padding. Actual
                // inbox position includes the league header and top safe area.
                const available = Math.max(96, Math.floor(viewportHeight - top - navHeight - 12));
                const value = `${available}px`;
                if (inbox.style.getPropertyValue('--tl-chat-available-height') !== value) inbox.style.setProperty('--tl-chat-available-height', value);
            };
            const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(measure); };
            schedule();
            window.addEventListener('resize', schedule);
            window.addEventListener('scroll', schedule, { passive: true });
            window.visualViewport?.addEventListener('resize', schedule);
            window.visualViewport?.addEventListener('scroll', schedule);
            const observer = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
            if (inbox.parentElement) observer?.observe(inbox.parentElement);
            return () => {
                if (frame !== null) window.cancelAnimationFrame(frame);
                window.removeEventListener('resize', schedule);
                window.removeEventListener('scroll', schedule);
                window.visualViewport?.removeEventListener('resize', schedule);
                window.visualViewport?.removeEventListener('scroll', schedule);
                observer?.disconnect();
            };
        }, [compact, storageKey]);
        const avatar = team => window.TimeLeagueHelmetIcon && window.App.TimeLeagueHelmet
            ? h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 38 })
            : h('span', { className: 'tl-chat-avatar', 'aria-hidden': true }, team.name.slice(0, 2));
        const patchDraft = patch => {
            // The desktop preview follows the latest owner until a conversation
            // starts. Pin its recipient before typing so incoming mail cannot
            // move the composer to another thread while a reply is in progress.
            if (!selectedId && active) setSelection({ key: storageKey, teamId: active.team.teamId });
            setDrafts(previous => ({ ...previous, [draftKey]: { ...draft, ...patch, messageId: '', replyToId: '' } }));
        };
        const send = async event => {
            event?.preventDefault?.();
            if (!onSend || pending || sendingRef.current || !active || !draft.text.trim()) return;
            const messageId = draft.messageId || window.crypto?.randomUUID?.() || `mail_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
            const replyToId = draft.messageId ? draft.replyToId : active.messages.find(message => message.toTeamId === teamId)?.id;
            const payload = { toTeamId: active.team.teamId, text: draft.text.trim(), tone: draft.tone, messageId, ...(replyToId ? { replyToId } : {}) };
            setDrafts(previous => ({ ...previous, [draftKey]: { ...draft, messageId, replyToId } }));
            sendingRef.current = true;
            setSending(true); setError(null);
            try {
                const result = await onSend(payload);
                if (result === false) throw new Error('Message could not be sent. Your draft is saved here.');
                setDrafts(previous => ({ ...previous, [draftKey]: { text: '', tone: 'neutral', messageId: '' } }));
            } catch (err) { setError({ key: draftKey, text: err.message || 'Message could not be sent. Try again.' }); }
            finally { sendingRef.current = false; setSending(false); }
        };
        if (compact) return h('section', { className: 'tl-card tl-rival-mail is-compact', 'aria-label': 'Rival mail' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Rival mail'), unread ? h('small', null, `${unread} unread`) : null),
            h('div', { className: 'tl-rival-previews' }, threads.filter(thread => thread.latest).slice(0, 2).map(thread => h('button', {
                type: 'button', className: 'tl-rival-preview', key: thread.team.teamId, onClick: () => onNavigate?.('messages'),
            }, avatar(thread.team), h('span', null, h('strong', null, thread.team.name), h('span', null, thread.latest.fromTeamId === teamId ? 'You: ' : '', thread.latest.text))))),
            !messages.length ? h('p', { className: 'tl-rival-intro' }, 'Send a good game, make a deal, or start a rivalry.') : null,
            onNavigate ? h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('messages') }, 'Open conversations') : null);
        return h('section', { ref: inboxRef, className: `tl-card tl-rival-mail tl-inbox${selectedId ? ' has-thread' : ''}`, 'aria-label': 'Rival conversations' },
            h('aside', { className: 'tl-inbox-owners', 'aria-label': 'League managers' },
                h('div', { className: 'tl-inbox-title' }, h('h2', null, 'Rival mail'), unread ? h('span', { className: 'tl-chat-unread' }, unread) : null),
                h('nav', { className: 'tl-inbox-list', 'aria-label': 'Conversations' }, threads.map(thread => {
                    const count = thread.messages.filter(message => message.toTeamId === teamId && !read.includes(message.id)).length;
                    return h('button', { type: 'button', key: thread.team.teamId, className: `tl-inbox-owner${active === thread ? ' is-active' : ''}`, onClick: () => open(thread), 'aria-current': active === thread ? 'true' : undefined },
                        avatar(thread.team), h('span', { className: 'tl-inbox-owner-copy' }, h('strong', null, thread.team.name), h('span', null, thread.latest ? `${thread.latest.fromTeamId === teamId ? 'You: ' : ''}${thread.latest.text}` : 'Start a conversation')),
                        count ? h('span', { className: 'tl-chat-unread', 'aria-label': `${count} unread` }, count) : null);
                }))),
            active ? h('div', { className: 'tl-chat' },
                h('header', { className: 'tl-chat-header' },
                    h('button', { type: 'button', className: 'tl-chat-back', onClick: () => setSelection(null), 'aria-label': 'Back to conversations' }, '‹'),
                    avatar(active.team), h('div', { className: 'tl-chat-heading' }, h('h3', null, active.team.name), h('small', null, active.team.manager === 'ai' ? (R.voices[active.team.aiPersona] || R.voices.steward).label : 'League manager')),
                    active.relationship ? h('span', { className: `tl-chat-mood${active.relationship.heat > 2 ? ' is-heated' : ''}`, title: 'Your tone can change how this manager negotiates and competes for waivers.' }, active.relationship.label) : null),
                relationship ? h('div', { className: 'tl-relationship', role: 'meter', 'aria-label': `Your relationship with ${active.team.name}`,
                    'aria-valuemin': 0, 'aria-valuemax': 12, 'aria-valuenow': affinity,
                    'aria-valuetext': relationship.heat === 0 ? 'Neutral. Halfway between Hot rival and Friend.' : `${relationship.label}. ${Math.abs(relationship.heat)} of 6 toward ${relationship.heat > 0 ? 'Hot rival' : 'Friend'}.`,
                }, h('div', { className: 'tl-relationship-track', 'aria-hidden': true },
                    h('span', { className: 'tl-relationship-midpoint' }),
                    h('span', { className: 'tl-relationship-marker', style: { left: `${affinity / 12 * 100}%` } })),
                h('div', { className: 'tl-relationship-labels', 'aria-hidden': true }, h('span', null, 'Hot rival'), h('span', null, 'Neutral'), h('span', null, 'Friend'))) : null,
                h('div', { className: 'tl-chat-history', role: 'log', 'aria-label': `Conversation with ${active.team.name}`, 'aria-live': 'polite', 'aria-relevant': 'additions text' },
                    !active.messages.length ? h('div', { className: 'tl-chat-empty' }, avatar(active.team), h('strong', null, `Say something to ${active.team.name}`), h('p', null, active.team.manager === 'ai' ? 'Keep it friendly or add a little fuel to the rivalry.' : 'Your conversation starts here.')) : null,
                    [...active.messages].reverse().map((message, index, rows) => h(React.Fragment, { key: message.id },
                        !index || rows[index - 1].week !== message.week ? h('div', { className: 'tl-chat-divider' }, `Week ${message.week}`) : null,
                        h('article', { className: `tl-chat-message${message.fromTeamId === teamId ? ' is-own' : ''}`, 'aria-label': message.fromTeamId === teamId ? 'You' : active.team.name },
                            h('div', { className: 'tl-chat-bubble' }, message.context ? h('small', { className: 'tl-chat-context' }, message.context) : null,
                                h('p', null, message.text), message.detail ? h('small', { className: 'tl-chat-detail' }, message.detail) : null,
                                message.tradeId && (onTrades || onNavigate) ? h('button', { type: 'button', className: 'tl-chat-trade', onClick: () => onTrades ? onTrades(message.tradeId) : onNavigate('trades') }, 'View trade →') : null),
                            message.kind === 'chat' ? h('small', { className: 'tl-chat-time' }, new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : null))),
                    h('div', { ref: endRef })),
                onSend ? h('form', { className: 'tl-chat-compose', onSubmit: send },
                    h('div', { className: 'tl-chat-quick', 'aria-label': 'Suggested replies' }, suggestedReplies.map(reply => h('button', { type: 'button', key: reply.tone, disabled: pending, title: reply.text, onClick: () => patchDraft({ text: reply.text, tone: reply.tone }) }, reply.label)), h('button', { type: 'button', className: 'tl-chat-new-replies', disabled: pending, onClick: () => { if (!selectedId) setSelection({ key: storageKey, teamId: active.team.teamId }); setReplyVariants(previous => ({ ...previous, [draftKey]: (previous[draftKey] || 0) + 1 })); } }, 'New replies')),
                    h('label', { className: 'tl-chat-tone' }, 'Tone', h('select', { 'aria-label': 'Message tone', value: draft.tone, disabled: pending, onChange: event => patchDraft({ tone: event.target.value }) },
                        h('option', { value: 'neutral' }, 'Casual'), h('option', { value: 'friendly' }, 'Friendly'), h('option', { value: 'competitive' }, 'Competitive'), h('option', { value: 'dismissive' }, 'Dismissive'))),
                    h('div', { className: 'tl-chat-input-row' }, h('textarea', { 'aria-label': `Message ${active.team.name}`, placeholder: 'Message…', value: draft.text, rows: 2, maxLength: 500, disabled: pending,
                        onChange: event => patchDraft({ text: event.target.value }),
                        onKeyDown: event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send(event); } }),
                        h('button', { className: 'tl-chat-send', type: 'submit', disabled: pending || !draft.text.trim(), 'aria-label': `Send message to ${active.team.name}` }, sending ? '…' : '↑')),
                    h('div', { className: 'tl-chat-compose-note' }, h('small', null, active.team.manager === 'ai' ? 'Tone shapes the rivalry. Scores stay on the field.' : isPrivate ? 'Only you and this manager can see these messages.' : 'Send a message to the other desk.'), h('small', null, `${draft.text.length}/500`)),
                    error?.key === draftKey ? h('p', { className: 'tl-chat-error', role: 'alert' }, error.text) : null) : h('p', { className: 'tl-chat-readonly' }, 'Open your own manager seat to send messages.'))
                : h('p', { className: 'tl-chat-empty' }, 'No other managers have joined this league yet.'));
    }
    window.WrTimeLeagueRivalsPanel = WrTimeLeagueRivalsPanel;
})();
