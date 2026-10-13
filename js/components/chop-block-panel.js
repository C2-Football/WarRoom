// ══════════════════════════════════════════════════════════════════
// js/components/chop-block-panel.js — window.WrChopBlock
// The Chopping Block: survival odds for a Sleeper CHOPPED league.
//
//   <WrChopBlock active currentLeague myRoster compact? phone? onOpenLeague? />
//
// Renders three things and nothing else:
//   1. YOUR number — chance of being chopped this week, and how many more
//      weeks you can expect to play.
//   2. The block — every living team ordered by danger. This doubles as the
//      corpse preview: the team at the top is the one whose entire roster is
//      most likely to hit the waiver pool next.
//   3. The chopped, in the order they went.
//
// Data: App.Luck.build gives the weekly-score matrix, App.ChopOdds simulates
// forward. Preseason (no played weeks) is labelled as projection-based rather
// than presented as if it were form.
//
// Shared by desktop Home, phone Overview, and the full League view.
// ══════════════════════════════════════════════════════════════════
function WrChopBlock({ active, currentLeague, myRoster, compact = false, phone = false, onOpenLeague }) {
    const SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)';
    const AMBER = 'var(--k-f0a500, #f0a500)', GOLD = 'var(--gold, #D4AF37)';
    const LINE = 'var(--co-line, #27262E)', WELL = 'var(--co-well, #0F0F14)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 0.6875rem ' + MONO, color: '#8D887E', letterSpacing: '0.08em', textTransform: 'uppercase' };

    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const rosters = currentLeague?.rosters || window.S?.rosters || [];
    const week = window.App?.WeeklyProj?.currentWeek?.() || 1;
    // The phone Home can mount before the NFL week and selected roster finish
    // loading. Recompute when those inputs, or an official elimination, change.
    const modelKey = [leagueId, currentLeague?.season, week, myRoster?.roster_id,
        currentLeague?.settings?.last_chopped_leg,
        rosters.map(roster => `${roster.roster_id}:${roster.settings?.eliminated || ''}`).join(',')].join('|');
    const [st, setSt] = React.useState({ status: 'idle' });
    // Run-identity ref, not a cleanup kill switch — the effect depends on its
    // own status, so a cleanup flag would orphan the in-flight run.
    const runRef = React.useRef({ key: null });
    React.useEffect(() => { runRef.current.key = null; setSt({ status: 'idle' }); }, [modelKey]);

    React.useEffect(() => {
        if (!active || st.status !== 'idle') return;
        if (runRef.current.key === modelKey) return;
        const Ch = window.App?.Chopped, CO = window.App?.ChopOdds, Luck = window.App?.Luck;
        if (!Ch || !CO || !Luck || !currentLeague) { setSt({ status: 'unavailable' }); return; }
        if (!Ch.isChopped(currentLeague)) { setSt({ status: 'not-chopped' }); return; }
        runRef.current.key = modelKey;
        const live = () => runRef.current.key === modelKey;
        setSt({ status: 'loading' });
        (async () => {
            try {
                let ledger = { rows: [] };
                try { ledger = await Luck.build({ league: currentLeague }); } catch (e) { /* preseason */ }
                if (!live()) return;
                const sim = CO.simulate({
                    league: currentLeague,
                    rosters,
                    ledger, week, myRosterId: myRoster?.roster_id,
                });
                if (!live()) return;
                setSt(sim ? { status: 'ready', sim } : { status: 'unavailable' });
            } catch (e) { window.wrLog?.('chopBlock', e); if (live()) setSt({ status: 'error' }); }
        })();
    }, [active, st.status, modelKey, currentLeague, myRoster]);

    const Section = ({ title, meta, kind, children }) => (
        <div className={phone ? 'mc-chop-card' + (kind ? ' mc-chop-' + kind : '') : undefined} style={{ background: 'var(--co-surface, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px', marginBottom: '12px' }}>
            <div className={phone ? 'mc-chop-heading' : undefined} style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{ font: '700 0.82rem ' + MONO, color: TEXT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );
    const leagueAction = () => compact && typeof onOpenLeague === 'function' ? <button type="button" className={phone ? 'mc-chop-open' : undefined} onClick={onOpenLeague} style={{ background: 'transparent', border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '7px 10px', minHeight: '40px', color: GOLD, fontSize: '.78rem', cursor: 'pointer' }}>{phone ? 'Survival details →' : 'Open League →'}</button> : null;
    const phoneBranding = phone && <style>{`
        @media(max-width:767px){
            .wr-mission-v8 .mc-chop-panel{--co-surface:linear-gradient(135deg,rgba(48,68,101,.84),rgba(28,42,66,.92));--co-line:rgba(183,206,255,.2);--co-well:rgba(17,31,53,.56);--co-accent-fill:rgba(183,206,255,.11);font-family:var(--font-body,system-ui,sans-serif)}
            .wr-mission-v8 .mc-chop-panel .mc-chop-card{min-width:0;padding:12px!important;border-color:var(--gx-edge,rgba(183,206,255,.3))!important;border-radius:15px!important;box-shadow:inset 0 1px rgba(255,255,255,.09)}
            .wr-mission-v8 .mc-chop-panel .mc-chop-heading{gap:4px!important;flex-direction:column;align-items:flex-start!important;margin-bottom:10px!important}.wr-mission-v8 .mc-chop-panel .mc-chop-heading>span:first-child{font:750 18px/1.25 var(--font-body,system-ui,sans-serif)!important;letter-spacing:0!important;text-transform:none!important;color:var(--cx-ink,var(--white))!important}.wr-mission-v8 .mc-chop-panel .mc-chop-heading>span+span{font:500 11px/1.4 var(--font-body,system-ui,sans-serif)!important;letter-spacing:0!important;text-transform:none!important;color:var(--cx-muted,var(--silver))!important}
            .wr-mission-v8 .mc-chop-panel .mc-chop-metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}.wr-mission-v8 .mc-chop-panel .mc-chop-metric{min-width:0;padding:8px 10px!important;background:var(--co-well)!important;border-left:3px solid var(--chop-metric-color)!important;border-radius:9px!important}.wr-mission-v8 .mc-chop-panel .mc-chop-metric>div:first-child{font:500 11px/1.35 var(--font-body,system-ui,sans-serif)!important;letter-spacing:0!important;text-transform:none!important;color:var(--cx-muted,var(--silver))!important}.wr-mission-v8 .mc-chop-panel .mc-chop-metric>div+div{font:750 24px/1.2 var(--font-body,system-ui,sans-serif)!important;font-variant-numeric:tabular-nums}
            .wr-mission-v8 .mc-chop-panel .mc-chop-method{font:400 12px/1.5 var(--font-body,system-ui,sans-serif)!important;letter-spacing:0!important;text-transform:none!important;color:var(--cx-muted,var(--silver))!important}
            .wr-mission-v8 .mc-chop-block-table-wrap{overflow:visible!important;min-width:0}.wr-mission-v8 .mc-chop-block-table{table-layout:fixed;width:100%}.wr-mission-v8 .mc-chop-block-table :is(th,td){box-sizing:border-box;padding:8px 3px!important;border-bottom:1px solid rgba(183,206,255,.12);font-family:var(--font-body,system-ui,sans-serif)!important;letter-spacing:0!important;text-transform:none!important;white-space:normal!important;overflow-wrap:anywhere}.wr-mission-v8 .mc-chop-block-table th{font-size:10px!important;line-height:1.3;color:var(--cx-muted,var(--silver))!important}.wr-mission-v8 .mc-chop-block-table th:first-child{width:36%}.wr-mission-v8 .mc-chop-block-table th:not(:first-child){width:16%}.wr-mission-v8 .mc-chop-block-table td{font-size:12px!important;line-height:1.35;font-variant-numeric:tabular-nums}.wr-mission-v8 .mc-chop-block-table td:not(:first-child){white-space:nowrap!important;overflow-wrap:normal}.wr-mission-v8 .mc-chop-block-table .is-most-risk{background:rgba(239,190,114,.06)!important}.wr-mission-v8 .mc-chop-block-table .is-most-risk td:first-child{box-shadow:inset 3px 0 var(--chop-risk-color);padding-left:7px!important}.wr-mission-v8 .mc-chop-block-table .is-own{background:rgba(183,206,255,.12)!important}.wr-mission-v8 .mc-chop-own-marker{display:block;color:var(--cx-accent,var(--gold));font-size:10px;line-height:1.3;font-weight:600;margin-top:3px}
            .wr-mission-v8 .mc-chop-eliminated-list{gap:6px!important}.wr-mission-v8 .mc-chop-eliminated-list>span{max-width:100%;box-sizing:border-box;font:500 12px/1.4 var(--font-body,system-ui,sans-serif)!important;background:rgba(183,206,255,.07)!important;border-color:var(--co-line)!important;border-radius:8px!important;padding:6px 8px!important;overflow-wrap:anywhere}.wr-mission-v8 .mc-chop-eliminated-list>span>span{font-family:var(--font-body,system-ui,sans-serif)!important}
            .wr-mission-v8 .mc-chop-panel .mc-chop-block-table td:nth-child(2){color:var(--chop-risk-color)!important}.wr-mission-v8 .mc-chop-panel .mc-chop-block-table td:nth-child(4){color:var(--chop-win-color)!important}.wr-mission-v8 .mc-chop-panel .mc-chop-own-marker{color:var(--cx-accent,var(--gold))!important}
        }
    `}</style>;
    const phoneState = children => phone ? <section className="mc-chop-panel" aria-label="Survival odds">{phoneBranding}{children}</section> : children;

    if (st.status === 'not-chopped') return null;
    if (st.status === 'loading' || st.status === 'idle') {
        return phoneState(<Section title="The Chopping Block"><div className={phone ? 'mc-chop-method' : undefined} style={{ color: SILVER, fontSize: '0.78rem', ...mono }}>Simulating survival…</div>{leagueAction()}</Section>);
    }
    if (st.status !== 'ready') {
        return phoneState(<Section title="The Chopping Block"><div className={phone ? 'mc-chop-method' : undefined} style={{ color: SILVER, fontSize: '0.78rem' }}>Survival odds are unavailable right now — weekly scores could not be loaded.</div>{leagueAction()}</Section>);
    }

    const { sim } = st;
    const me = sim.me;
    const alive = sim.rows.filter(r => r.alive);
    const dead = sim.rows.filter(r => !r.alive);
    const riskCol = p => (p >= 25 ? RED : p >= 12 ? AMBER : p >= 5 ? GOLD : GREEN);
    const projected = sim.basis === 'projected';

    return (
        <div className={phone ? 'mc-chop-panel mc-chop-home' : undefined} aria-label={compact ? 'Survival summary' : 'Survival odds'}>
            {phoneBranding}
            {me && me.alive ? (
                <Section title={phone && compact ? 'The Chopping Block' : 'Your Survival'} kind="survival" meta={phone ? (sim.weeks?.[0] ? 'Next chop · Wk ' + sim.weeks[0] + ' · ' : '') + alive.length + ' alive · ' + dead.length + ' chopped' : (projected ? 'projected form · ' : '') + sim.simCount.toLocaleString() + ' simulations'}>
                    <div className={phone ? 'mc-chop-metrics' : undefined} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                        {[
                            { lbl: 'Chopped this week', val: me.chopThisWeekPct + '%', col: riskCol(me.chopThisWeekPct) },
                            { lbl: phone ? 'Expected weeks left' : 'Weeks left (expected)', val: me.expWeeksLeft, col: TEXT },
                            { lbl: 'Survive the season', val: me.survivePct + '%', col: me.survivePct >= 20 ? GREEN : TEXT },
                            { lbl: 'Last one standing', val: me.winPct + '%', col: GOLD },
                        ].map(k => (
                            <div key={k.lbl} className={phone ? 'mc-chop-metric' : undefined} style={{ '--chop-metric-color': k.col, background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '9px 11px' }}>
                                <div style={{ ...microHdr }}>{k.lbl}</div>
                                <div style={{ ...mono, fontSize: '1.25rem', fontWeight: 700, color: k.col, marginTop: '2px' }}>{k.val}</div>
                            </div>
                        ))}
                    </div>
                    <div className={phone ? 'mc-chop-method' : undefined} style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '9px', lineHeight: 1.55 }}>
                        {phone ? (projected ? 'No scoring history · equal-strength baseline' : 'Scoring form') + ' · ' + sim.simCount.toLocaleString() + ' simulations. Estimates, not live-score odds.' : compact ? (alive.length + ' teams remain. ' + (projected ? 'Based on projected roster strength.' : 'Weekly odds use scoring form.')) : projected
                            ? 'No games played yet — these run off projected roster strength, not form. They will sharpen every week.'
                            : 'Every week the lowest score is chopped. Trust the this-week number most: the season-long figures assume nobody rebuilds off the waiver pool, and in this format everybody does.'}
                    </div>
                    {phone && leagueAction()}
                </Section>
            ) : me && !me.alive ? (
                <Section title="Your Survival" kind="survival" meta={'chopped in week ' + me.eliminatedWeek}>
                    <div style={{ color: SILVER, fontSize: '0.8rem', lineHeight: 1.6 }}>
                        You were chopped in <b style={{ color: TEXT }}>week {me.eliminatedWeek}</b> and your roster went back to the waiver pool. {phone ? alive.length + ' teams remain in the survival race below.' : compact ? 'The remaining field is in League.' : 'The block below is still live.'}
                    </div>
                    {phone && leagueAction()}
                </Section>
            ) : null}

            {!compact && <Section title="The Block" kind="block" meta={alive.length + ' alive · most at risk first'}>
                <div className={phone ? 'mc-chop-block-table-wrap' : undefined} style={{ overflowX: 'auto' }}>
                    <table className={phone ? 'mc-chop-block-table' : undefined} style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>
                            {['Team', 'Chop risk', 'Survive', 'Win', 'Wks left'].map((h, i) => (
                                <th key={h} scope="col" title={h} aria-label={h} style={{ ...microHdr, textAlign: i ? 'right' : 'left', padding: '4px 8px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>{phone ? ['Team', 'Risk', 'Surv.', 'Win', 'Weeks'][i] : h}</th>
                            ))}
                        </tr></thead>
                        <tbody>
                            {alive.map(r => {
                                const isMe = me && String(r.rosterId) === String(me.rosterId);
                                return (
                                    <tr key={r.rosterId} className={phone ? (isMe ? 'is-own' : '') + (r.chopThisWeekPct > 0 && r.chopThisWeekPct === alive[0]?.chopThisWeekPct ? ' is-most-risk' : '') : undefined} style={{ '--chop-risk-color': riskCol(r.chopThisWeekPct), '--chop-win-color': r.winPct >= 10 ? GOLD : SILVER, background: isMe ? 'var(--co-accent-fill, #12212B)' : 'transparent' }}>
                                        <td style={{ padding: '6px 8px', fontSize: '0.78rem', color: isMe ? TEXT : SILVER, fontWeight: isMe ? 700 : 500, fontFamily: 'var(--font-body)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{phone && isMe && <small className="mc-chop-own-marker">You</small>}</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, color: riskCol(r.chopThisWeekPct) }}>{r.chopThisWeekPct}%</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.78rem', color: SILVER }}>{r.survivePct}%</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.78rem', color: r.winPct >= 10 ? GOLD : SILVER }}>{r.winPct}%</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.78rem', color: SILVER }}>{r.expWeeksLeft}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {alive.length > 1 ? (
                    <div className={phone ? 'mc-chop-method' : undefined} style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '8px', lineHeight: 1.55 }}>
                        <b style={{ color: TEXT }}>{alive[0].name}</b> is most likely to go this week — that roster is the one about to hit the waiver pool. Plan your bids before it does.
                    </div>
                ) : null}
            </Section>}

            {!compact && dead.length ? (
                <Section title="Already Chopped" kind="eliminated" meta={dead.length + ' gone'}>
                    <div className={phone ? 'mc-chop-eliminated-list' : undefined} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {dead.slice().sort((a, b) => (a.eliminatedWeek || 0) - (b.eliminatedWeek || 0)).map(r => (
                            <span key={r.rosterId} style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, background: WELL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', padding: '4px 8px', color: SILVER }}>
                                <span style={{ ...mono, color: RED, fontWeight: 700 }}>W{r.eliminatedWeek}</span>{' '}{r.name}
                            </span>
                        ))}
                    </div>
                </Section>
            ) : null}
            {compact && !phone && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px', color: SILVER, fontSize: '.75rem' }}><span>{alive.length} alive · {dead.length} chopped</span>{leagueAction()}</div>}
            {phone && !me && <Section title="The Chopping Block" meta={alive.length + ' alive · ' + dead.length + ' chopped'}><div className="mc-chop-method">Choose your team to see your survival outlook. Follow the field below.</div>{leagueAction()}</Section>}
        </div>
    );
}
window.WrChopBlock = WrChopBlock;
