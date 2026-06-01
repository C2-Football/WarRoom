// ══════════════════════════════════════════════════════════════════
// js/draft/ask-window.js — Floating "Ask Alex" answer window
//
// One-shot AI action buttons (the quick-prompt chips, etc.) open a
// dedicated, dismissible window over the draft board instead of dumping
// their answer into the shared Alex stream. Clone of the TradeModal
// pattern: fixed position, backdrop, × close. One window at a time —
// opening another replaces the current one.
//
// Also exposes a SHARED rich-context builder (buildAskContext) used by
// both this window and the free-text chat in alex-stream.js, so the AI
// actually sees the board, roster needs, and league settings.
//
// Open a window from anywhere:
//   window.dispatchEvent(new CustomEvent('wr:ask-open',
//     { detail: { title: 'Who should I target?', prompt: '…' } }));
//
// Depends on: styles.js, window.dhqAI
// Exposes:    window.DraftCC.AskAnswerWindow, window.DraftCC.buildAskContext
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL } = window.DraftCC.styles;

    // ── Shared context builder ──────────────────────────────────────
    // Turns the live draft state into a rich, specific context block so
    // the model can give board-aware advice ("At 1.05 target the best
    // RB…") instead of generic filler.
    function buildAskContext(state) {
        if (!state) return '';
        const lines = [];

        // League format
        const lf = state.draftContext?.leagueFormat || {};
        const fmt = [];
        if (lf.teams) fmt.push(`${lf.teams}-team`);
        fmt.push(lf.flags?.superflex ? 'Superflex' : '1-QB');
        if (lf.scoring?.ppr) {
            fmt.push(lf.scoring.ppr === 'ppr' ? 'Full PPR' : lf.scoring.ppr === 'half_ppr' ? 'Half PPR' : 'Standard');
        }
        if (lf.flags?.tePremium) fmt.push('TE-premium');
        if (lf.draftType) fmt.push(`${lf.draftType} draft`);
        if (fmt.length) lines.push(`League: ${fmt.join(', ')}.`);

        // On the clock
        const slot = state.pickOrder?.[state.currentIdx];
        if (slot) {
            lines.push(`On the clock: Round ${slot.round}, pick ${slot.overall} of ${state.pickOrder.length}.`);
        }

        // My roster so far + position counts
        const myPicks = (state.picks || []).filter(
            p => p.isUser || String(p.rosterId) === String(state.userRosterId)
        );
        if (myPicks.length) {
            lines.push(`My roster so far (${myPicks.length}): ${myPicks.map(p => `${p.pos} ${p.name}`).join(', ')}.`);
            const counts = {};
            myPicks.forEach(p => { const k = (p.pos || '?').toUpperCase(); counts[k] = (counts[k] || 0) + 1; });
            lines.push(`My position counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
        } else {
            lines.push('My roster so far: no picks yet.');
        }

        // Flagged needs (from persona assessment or team context)
        const needs = (state.personas?.[state.userRosterId]?.assessment?.needs
            || state.draftContext?.teamContext?.needs || [])
            .map(n => (typeof n === 'string' ? n : n?.pos))
            .filter(Boolean);
        if (needs.length) lines.push(`Flagged roster needs: ${needs.join(', ')}.`);

        // Top available on the board (the single most important context)
        const top = (state.pool || []).slice(0, 15).map((p, i) => {
            const val = Math.round(p.dhq || p.val || 0);
            const age = p.age ? `, age ${p.age}` : '';
            return `${i + 1}. ${p.name} (${p.pos}${p.team ? '-' + p.team : ''}, DHQ ${val}${age})`;
        });
        if (top.length) lines.push(`Top available players right now:\n${top.join('\n')}`);

        // Pinned opponent (if the user is watching a specific team)
        if (state.pinnedRosterId) {
            const per = state.personas?.[state.pinnedRosterId];
            if (per) {
                lines.push(`Pinned opponent: ${per.teamName || 'team'} — DNA ${per.draftDna?.label || '?'}, posture ${per.posture?.label || '?'}.`);
            }
        }

        return lines.filter(Boolean).join('\n');
    }

    // ── Lightweight rich-text renderer ──────────────────────────────
    // Handles **bold**, bullet/numbered lines, and paragraph spacing so
    // the board breakdowns render readably without a markdown lib.
    function renderRichText(text) {
        const raw = String(text || '');
        const lines = raw.split(/\r?\n/);
        const nodes = [];
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) { nodes.push(<div key={'sp' + i} style={{ height: 6 }} />); return; }
            const isBullet = /^([-*•]|\d+[.)])\s+/.test(trimmed);
            const body = trimmed.replace(/^([-*•]|\d+[.)])\s+/, '');
            // Split on **bold**
            const segs = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((seg, j) => {
                if (/^\*\*[^*]+\*\*$/.test(seg)) {
                    return <strong key={j} style={{ color: 'var(--white)', fontWeight: 700 }}>{seg.slice(2, -2)}</strong>;
                }
                return <span key={j}>{seg}</span>;
            });
            nodes.push(
                <div key={'ln' + i} style={{
                    display: 'flex',
                    gap: isBullet ? 6 : 0,
                    marginBottom: 3,
                    lineHeight: 1.5,
                }}>
                    {isBullet && <span style={{ color: 'var(--gold)', flexShrink: 0 }}>
                        {/^\d/.test(trimmed) ? trimmed.match(/^\d+/)[0] + '.' : '•'}
                    </span>}
                    <span style={{ flex: 1 }}>{segs}</span>
                </div>
            );
        });
        return nodes;
    }

    // ── The floating answer window ──────────────────────────────────
    function AskAnswerWindow({ state }) {
        const [open, setOpen] = React.useState(false);
        const [title, setTitle] = React.useState('');
        const [prompt, setPrompt] = React.useState('');
        const [pending, setPending] = React.useState(false);
        const [answer, setAnswer] = React.useState('');
        const [error, setError] = React.useState('');

        // Keep the freshest state available to the (async) event handler.
        const stateRef = React.useRef(state);
        stateRef.current = state;

        const close = React.useCallback(() => {
            setOpen(false);
            setAnswer('');
            setError('');
            setPending(false);
        }, []);

        // Run one AI call for the given prompt/title.
        const ask = React.useCallback(async (askTitle, askPrompt) => {
            setOpen(true);
            setTitle(askTitle || 'Ask Alex');
            setPrompt(askPrompt || '');
            setAnswer('');
            setError('');

            if (typeof window.dhqAI !== 'function') {
                setError('AI engine is not loaded. Try reloading the page.');
                return;
            }
            setPending(true);
            try {
                const context = buildAskContext(stateRef.current);
                const response = await window.dhqAI('draft-chat', askPrompt, context);
                const text = typeof response === 'string'
                    ? response
                    : (response?.content || response?.text || JSON.stringify(response));
                setAnswer(text);
                window.OD?.track?.('alex_response_actioned', {
                    platform: 'warroom',
                    module: 'draft',
                    leagueId: window.S?.currentLeagueId || null,
                    entityType: 'ai_call',
                    entityId: 'draft-chat',
                    metadata: { action: 'draft_ask_window', title: askTitle || null },
                });
            } catch (e) {
                setError(String(e?.message || e).slice(0, 240));
                if (window.wrLog) window.wrLog('ask.window', e);
            } finally {
                setPending(false);
            }
        }, []);

        // Listen for open requests from any action button.
        React.useEffect(() => {
            const handler = (e) => {
                const { title: t, prompt: p } = e.detail || {};
                ask(t, p);
            };
            window.addEventListener('wr:ask-open', handler);
            return () => window.removeEventListener('wr:ask-open', handler);
        }, [ask]);

        // Escape closes the window.
        React.useEffect(() => {
            if (!open) return;
            const onKey = (e) => { if (e.key === 'Escape') close(); };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, [open, close]);

        if (!open) return null;

        return (
            <div
                onClick={close}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 600,
                    background: 'rgba(0,0,0,0.62)',
                    backdropFilter: 'blur(2px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px',
                    fontFamily: FONT_UI,
                }}
            >
                <div
                    onClick={e => e.stopPropagation()}
                    style={{
                        width: 'min(560px, 100%)',
                        maxHeight: '82vh',
                        display: 'flex',
                        flexDirection: 'column',
                        background: 'linear-gradient(180deg, var(--k-14121c, #14121c) 0%, var(--k-0d0b12, #0d0b12) 100%)',
                        border: '1px solid rgba(124,107,248,0.32)',
                        borderRadius: '12px',
                        boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
                        overflow: 'hidden',
                    }}
                >
                    {/* Header */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        flexShrink: 0,
                    }}>
                        <span style={{ fontSize: '1rem', color: 'var(--k-9b8afb, #9b8afb)' }}>✦</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontFamily: FONT_DISPL,
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                letterSpacing: '0.04em',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}>{title}</div>
                            <div style={{ fontSize: '0.55rem', color: 'var(--silver)', opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                Alex · Draft War Room
                            </div>
                        </div>
                        <button
                            onClick={close}
                            aria-label="Close"
                            style={{
                                width: 26, height: 26,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--ov-3, rgba(255,255,255,0.05))',
                                border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: '6px',
                                color: 'var(--silver)',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                flexShrink: 0,
                            }}
                        >×</button>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '14px', overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
                        {pending && (
                            <div style={{ color: 'var(--gold)', fontSize: '0.72rem', fontStyle: 'italic', opacity: 0.8 }}>
                                Alex is thinking<AnimatedDots />
                            </div>
                        )}
                        {!pending && error && (
                            <div style={{ color: 'var(--k-e74c3c, #e74c3c)', fontSize: '0.72rem', lineHeight: 1.5 }}>
                                {error}
                            </div>
                        )}
                        {!pending && !error && answer && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.92 }}>
                                {renderRichText(answer)}
                            </div>
                        )}
                    </div>

                    {/* Footer — show the question that was asked */}
                    {prompt && (
                        <div style={{
                            padding: '8px 14px',
                            borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                            fontSize: '0.56rem',
                            color: 'var(--silver)',
                            opacity: 0.5,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}>
                            You asked: {prompt}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function AnimatedDots() {
        const [n, setN] = React.useState(0);
        React.useEffect(() => {
            const id = setInterval(() => setN(x => (x + 1) % 4), 400);
            return () => clearInterval(id);
        }, []);
        return <span>{'.'.repeat(n)}</span>;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.AskAnswerWindow = AskAnswerWindow;
    window.DraftCC.buildAskContext = buildAskContext;
})();
