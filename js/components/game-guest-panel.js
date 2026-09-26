/* global React */
(function (root) {
    'use strict';
    const App = root.App = root.App || {}, h = React.createElement;
    function GameGuestPanel({ game, code = '', onJoined, onError }) {
        const [name, setName] = React.useState(''), [pass, setPass] = React.useState('');
        const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState(''), [showPass, setShowPass] = React.useState(false);
        const [, update] = React.useState(0);
        React.useEffect(() => App.GameGuest?.subscribe(() => update(value => value + 1)), []);
        const guest = App.GameGuest?.getSession(game), actor = App.GameGuest?.getActor(game);
        if (actor?.kind === 'account') return null;
        const run = async action => {
            if (busy) return;
            setBusy(true); setMessage('');
            try {
                const result = await action();
                if (!result.ok) { setMessage(result.error); onError?.(result.error); return; }
                setPass(''); await onJoined?.(result.guest);
            } catch { setMessage('Could not open the room. Your guest pass is saved; try opening it again.'); }
            finally { setBusy(false); }
        };
        return h('section', { className: 'game-guest-panel', 'aria-label': 'Guest access' },
            guest && h('div', { className: 'game-guest-current' },
                h('strong', null, `Playing as ${guest.displayName} · Guest`),
                h('p', null, 'Your seat stays saved in this browser. Save your private guest pass to reopen it on another device or after clearing browser data.'),
                h('div', { className: 'game-guest-actions' },
                    h('button', { type: 'button', disabled: busy, onClick: () => run(() => App.GameGuest.resume(game, guest.token)) }, 'Open my guest seat'),
                    h('button', { type: 'button', onClick: async () => {
                        try { await root.navigator.clipboard.writeText(guest.token); setMessage('Guest pass copied. Keep it private; it controls your seat.'); }
                        catch { setShowPass(true); setMessage('Copy the guest pass below and keep it private.'); }
                    } }, 'Copy guest pass'),
                    h('button', { type: 'button', 'aria-expanded': showPass, onClick: () => setShowPass(value => !value) }, showPass ? 'Hide guest pass' : 'Show guest pass')),
                showPass && h('label', null, 'Private guest pass', h('textarea', { value: guest.token, readOnly: true, rows: 3, onFocus: event => event.target.select() })),
                h('small', null, `Guest access expires ${new Date(guest.expiresAt).toLocaleDateString()}.`)),
            code && h('form', { onSubmit: event => { event.preventDefault(); run(() => App.GameGuest.join(game, code, name)); } },
                h('h3', null, guest ? 'Join this invitation as a guest' : 'Join as a guest'),
                h('p', null, 'No email, password or Dynasty HQ account needed. Your host’s invitation reserves one player seat.'),
                h('label', null, 'Player name', h('input', { value: name, onChange: event => setName(event.target.value), maxLength: 60, required: true, autoComplete: 'nickname', disabled: busy })),
                h('button', { type: 'submit', disabled: busy || !name.trim() }, busy ? 'Opening your seat…' : 'Join as guest')),
            h('details', null, h('summary', null, 'Already have a guest pass?'),
                h('form', { onSubmit: event => { event.preventDefault(); run(() => App.GameGuest.resume(game, pass)); } },
                    h('label', null, 'Guest pass', h('textarea', { value: pass, onChange: event => setPass(event.target.value), rows: 3, required: true, autoComplete: 'off', spellCheck: false, disabled: busy })),
                    h('button', { type: 'submit', disabled: busy || !pass.trim() }, 'Restore guest seat'))),
            message && h('p', { role: 'status' }, message));
    }
    App.GameGuestPanel = GameGuestPanel;
})(window);
