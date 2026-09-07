(function () {
    'use strict';
    const h = React.createElement;
    function WrTimeLeagueRivalsPanel({ league, teamId, throughWeek, onTrades, compact = false, onNavigate }) {
        const [expanded, setExpanded] = React.useState(false);
        const storageKey = `tl-rival-read:${league.leagueId}:${teamId}`;
        const [readState, setReadState] = React.useState({});
        React.useEffect(() => {
            try { setReadState({ key: storageKey, ids: JSON.parse(localStorage.getItem(storageKey) || '[]') }); }
            catch (_) { setReadState({ key: storageKey, ids: [] }); }
        }, [storageKey]);
        const read = readState.key === storageKey && Array.isArray(readState.ids) ? readState.ids : [];
        const messages = window.App.TimeLeagueRivals.messagesFor(league, teamId, { throughWeek });
        const unread = messages.filter(message => !read.includes(message.id)).length;
        const markRead = () => {
            const ids = messages.map(message => message.id);
            setReadState({ key: storageKey, ids });
            try { localStorage.setItem(storageKey, JSON.stringify(ids)); } catch (_) { /* Session still works without storage. */ }
        };
        return h('section', { className: 'tl-card tl-rival-mail' + (compact ? ' is-compact' : ''), 'aria-label': 'Rival messages' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Rival mail'), h('small', null, `${unread} unread · ${messages.length} messages`)),
            h('p', { className: 'tl-rival-intro' }, 'The other desks have something to say.'),
            !messages.length ? h('p', null, 'Quiet for now. Rival managers will react to your games, deals and contested pickups.') :
                h('div', { className: 'tl-rival-messages' }, (compact ? messages.slice(0, 2) : !expanded ? messages.slice(0, 4) : messages).map(message =>
                    h('article', { className: `tl-rival-message tl-rival-${message.kind}`, key: message.id },
                        h('header', null, h('strong', null, !read.includes(message.id) ? '● ' : '', message.name), h('small', null, `${message.persona} · W${message.week}`)),
                        h('p', null, message.text),
                        h('footer', null, h('span', null, message.context, message.detail ? ` · ${message.detail}` : ''),
                            message.tradeId && (onTrades || onNavigate) ? h('button', { className: 'tl-btn', onClick: () => onTrades ? onTrades(message.tradeId) : onNavigate('trades') }, 'View trade') : null)))),
            unread ? h('button', { className: 'tl-btn', onClick: markRead }, 'Mark messages read') : null,
            compact && onNavigate ? h('button', { className: 'tl-btn', onClick: () => onNavigate('messages') }, 'Open rival mail') : null,
            !compact && messages.length > 4 ? h('button', { className: 'tl-btn', onClick: () => setExpanded(!expanded), 'aria-expanded': expanded }, expanded ? 'Show recent' : `Show all ${messages.length}`) : null);
    }
    window.WrTimeLeagueRivalsPanel = WrTimeLeagueRivalsPanel;
})();
