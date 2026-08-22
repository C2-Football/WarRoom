// ══════════════════════════════════════════════════════════════════
// js/widgets/analyst-mock.js — Analyst Mock widget (v3 dashboard)
//
// Surfaces a live, one-round Analyst Mock projection on Home — the same
// engine (js/draft/analyst-mock.js generateProjectedMock, "league-history"
// preset) that powers the in-draft-room Analyst Mock card, run standalone
// with a lightweight synthetic draft state (no boardPoolForContext/
// draftProjectionMeta machinery required — generateProjectedMock builds
// its own pool/pick order when none is supplied).
//
// The draft module scripts are lazy-loaded (data-wr-defer="draft"), so this
// widget triggers that load itself on mount and shows a "loading" state
// until window.DraftCC is available.
//
// sizes: sm (hero = your projected R1 pick) · md/lg (+ headline + CTA)
// Depends on: module-loader.js (wrLoadModuleGroup), league-skin.js, and the
// deferred "draft" module group (js/draft/state.js, analyst-mock.js, etc.)
// Exposes:    window.AnalystMockWidget
// ══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    function AnalystMockWidget({ size, myRoster, currentLeague, setActiveTab, navigateWidget }) {
        const cardStyle = window.WrTheme?.cardStyle?.() || { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius)' };
        const go = () => { if (navigateWidget) navigateWidget('draft'); else if (setActiveTab) setActiveTab('draft'); };
        const lid = currentLeague?.league_id || currentLeague?.id || '';

        const [groupReady, setGroupReady] = React.useState(!!window.__wrModuleGroupsLoaded?.draft);
        React.useEffect(() => {
            if (groupReady) return;
            let alive = true;
            const p = window.wrLoadModuleGroup ? window.wrLoadModuleGroup('draft') : Promise.reject(new Error('no loader'));
            p.then(() => { if (alive) setGroupReady(true); }).catch(() => {});
            return () => { alive = false; };
        }, [groupReady]);

        // Non-dynasty formats already lost their in-draft-room Analyst Mock
        // surface (War Room tab is hidden there); this widget projects a
        // 'redraft' variant board for them. Dynasty/keeper project 'startup'.
        const variant = React.useMemo(() => {
            try {
                const t = window.App?.LeagueSkin?.build?.({ league: currentLeague })?.type;
                return (t === 'dynasty' || t === 'keeper') ? 'startup' : 'redraft';
            } catch (e) { return 'redraft'; }
        }, [currentLeague]);

        const [report, setReport] = React.useState(null); // null | {loading} | {r} | {err}
        React.useEffect(() => {
            if (!groupReady || !lid) { setReport(null); return; }
            const engine = window.DraftCC?.analystMock;
            const stateFns = window.DraftCC?.state;
            if (!engine?.generateProjectedMock) { setReport({ err: true }); return; }
            setReport({ loading: true });
            try {
                const leagueSize = currentLeague?.rosters?.length || currentLeague?.settings?.num_teams || 12;
                const state = stateFns?.initialDraftState
                    ? stateFns.initialDraftState({
                        leagueId: lid, variant, leagueSize,
                        userRosterId: myRoster?.roster_id || null,
                    })
                    : { leagueId: lid, variant, leagueSize, rounds: 5, draftType: 'snake', userRosterId: myRoster?.roster_id || null, userSlot: 1 };
                const r = engine.generateProjectedMock({
                    state, currentLeague, myRoster,
                    presetId: 'league-history', roundLimit: 1,
                });
                setReport(r ? { r } : { err: true });
            } catch (e) { setReport({ err: true }); }
        }, [groupReady, lid, variant, myRoster?.roster_id]);

        const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #bdb8ad)', WHITE = 'var(--white, #f5f2ea)';
        const monoFont = 'var(--font-mono, monospace)';
        const base = { ...cardStyle, height: '100%', padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', cursor: 'pointer', boxSizing: 'border-box' };
        const label = (
            <div style={{ fontSize: size === 'sm' ? '0.64rem' : '0.72rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>ANALYST MOCK</div>
        );

        if (!groupReady || !report || report.loading) {
            return (
                <div style={base} onClick={go}>
                    {label}
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>Running this league's projected board…</div>
                </div>
            );
        }
        if (report.err || !report.r) {
            return (
                <div style={base} onClick={go}>
                    {label}
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>No projection available for this league yet.</div>
                </div>
            );
        }

        const r = report.r;
        const brief = r.summary?.reportBrief || {};
        const firstUserPick = (r.summary?.userPicks || [])[0] || null;

        if (size === 'sm') {
            return (
                <div style={base} onClick={go}>
                    {label}
                    <div style={{ marginTop: 'auto' }}>
                        {firstUserPick ? (
                            <React.Fragment>
                                <div style={{ fontFamily: monoFont, fontSize: '1.3rem', fontWeight: 700, color: GOLD, lineHeight: 1.15 }}>{firstUserPick.name}</div>
                                <div style={{ fontSize: '0.7rem', color: SILVER, marginTop: '2px' }}>{firstUserPick.round}.{String(firstUserPick.pickInRound || firstUserPick.slot).padStart(2, '0')} · {firstUserPick.pos} · {firstUserPick.confidence || 'projected'}</div>
                            </React.Fragment>
                        ) : (
                            <div style={{ fontSize: '0.8rem', color: SILVER }}>No user pick inside Rd 1.</div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div style={base} onClick={go}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: '0.72rem', letterSpacing: '0.07em', color: GOLD, fontWeight: 700 }}>ANALYST MOCK</div>
                    <div style={{ fontSize: '0.62rem', color: SILVER, opacity: 0.8 }}>Round 1 projection</div>
                </div>
                {firstUserPick ? (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                        <span style={{ fontFamily: monoFont, fontSize: '1.7rem', fontWeight: 700, color: GOLD, lineHeight: 1 }}>{firstUserPick.name}</span>
                        <span style={{ fontSize: '0.78rem', color: SILVER }}>{firstUserPick.pos} · {firstUserPick.round}.{String(firstUserPick.pickInRound || firstUserPick.slot).padStart(2, '0')}</span>
                    </div>
                ) : (
                    <div style={{ marginTop: '8px', fontSize: '0.9rem', color: WHITE }}>No user pick lands inside this projection window.</div>
                )}
                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: SILVER }}>{brief.headline || brief.userPath || ''}</div>
                <div style={{ marginTop: 'auto', paddingTop: '8px', fontSize: '0.68rem', color: GOLD, opacity: 0.85 }}>Open Draft Center →</div>
            </div>
        );
    }

    window.AnalystMockWidget = AnalystMockWidget;
})();
