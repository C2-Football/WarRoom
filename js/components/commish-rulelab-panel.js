// ══════════════════════════════════════════════════════════════════
// js/components/commish-rulelab-panel.js — window.WrCommishRuleLabPanel
// The Rule Lab bench + results: stage a scoring proposal, replay the
// season(s) under it, and read the verdict per league.
//
//   <WrCommishRuleLabPanel status seasonUsed proposal onProposalChange
//                          results presets baselineScoring />
//
// Pure presentation + one control surface — every number arrives pre-built:
//   status    'idle' | 'loading' | 'ready' | 'error' | 'empty'
//   seasonUsed  the season being replayed (for the loading line / metas).
//   proposal  the staged override object ({ rec: 1, bonus_rec_te: 0.5 … });
//             CONTROLLED — this panel never keeps its own copy. Chip taps
//             call onProposalChange(nextProposalObject), which the container
//             both stages AND commits immediately (a chip tap is a single
//             deliberate action). The Wind Tunnel's free-typing number grid
//             calls onProposalStage instead — it only stages; the replay
//             below does NOT re-run until onAnalyze() fires (the Analyze
//             button), because re-running the whole season on every
//             keystroke while typing several stats was the bug this split
//             fixes. onReset() clears staged AND committed/analyzed state
//             together. hasUnanalyzedChanges tells the panel whether
//             anything is staged that Analyze hasn't run yet.
//   results   App.Commish.RuleLab.runOmnibus output:
//             [{ leagueId, leagueName, result }] where result is runProposal
//             output (or its { empty:true, reason } form, handled per league).
//   presets   App.Commish.RuleLab.PRESETS ([{ key, label, overrides }]);
//             falls back to the engine global when the prop is absent.
//   leagues / selectedLeagueId / onSelectLeague  the league SCOPE. You amend
//             one constitution at a time, so the container scopes to a single
//             league by default; selectedLeagueId === '__all' is the omnibus.
//             Scope is what makes the editor truthful — only a single league
//             has a real "from" value and a real key set.
//   editorKeys  OPTIONAL explicit key list for the full editor (the scoped
//             league's own keys, or the union across leagues in omnibus).
//             Falls back to Object.keys(baselineScoring).
//   baselineScoring  OPTIONAL single-league current scoring_settings — lets
//             the summary line read "rec 0.5 → 1.0". In an omnibus the
//             baseline differs per league, so omit it and the line reads
//             "rec → 1.0" (never a made-up "from").
//
// Chips COMPOSE: half PPR + TE premium is a valid two-chip proposal
// (Object.assign of overrides, same as the engine documents). A chip is
// "active" when every one of its override keys sits in the proposal at the
// same value — so tapping Full PPR while Half PPR is lit simply retunes
// `rec` and the Half chip goes dark on its own.
//
// NO data fetching here. The methodology caption is doctrine and always
// visible — this panel argues from the replay, never re-crowns a champion.
// ══════════════════════════════════════════════════════════════════
// ── Shared styling tokens + presentational shells (module scope — not
// recreated per render, so React can diff/reuse Section's and
// LeagueResult's DOM across a keystroke instead of remounting it; a
// component defined inside another component's render body gets a new
// identity every render, which is what was unmounting every input on
// every value change (native focus loss, cursor reset, scroll jump). ─
const GOLD = 'var(--gold, #D4AF37)', SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
const GREEN = 'var(--good, #2ECC71)', RED = 'var(--bad, #E74C3C)';
const AMBER = 'var(--warn, #F0A500)', ACCENT = 'var(--co-accent, #5DADE2)';
const PANEL = 'var(--co-surface, #121217)', LINE = 'var(--co-line, #27262E)';
const SURF2 = 'var(--co-surface-2, #1B1B22)', WELL = 'var(--co-well, #0F0F14)';
const ACC_FILL = 'var(--co-accent-fill, #12212B)', ACC_LINE = 'var(--co-accent-line, #2B4B63)';
const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
const MUTED = 'var(--co-muted, #A3ABB8)';
const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
const microHdr = { font: '600 var(--text-micro, var(--co-readable-small, 0.6875rem)) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };

const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Number(v) || 0).toFixed(1);

const Section = ({ title, meta, children, folded }) => folded ? (
    <details className="co-disclosure"><summary>{title}{meta && <small>{meta}</small>}</summary>{children}</details>
) : (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <span style={{ fontSize: 'var(--co-readable-small, 0.72rem)', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
            {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
        </div>
        {children}
    </div>
);
const rowLine = { borderBottom: `1px solid ${LINE}`, color: TEXT, fontSize: 'var(--co-readable-small, 0.75rem)', ...mono };
const shiftGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) 0.55fr 0.55fr 0.7fr', gap: '8px', alignItems: 'center', padding: '5px 10px', minWidth: 0 };
const swingGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 0.9fr 0.9fr 0.7fr', gap: '8px', alignItems: 'center', padding: '5px 10px', minWidth: 0 };
const nameCell = { fontFamily: 'var(--font-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// ── Per-league result block ──────────────────────────────────────
const ReplayDetails = ({ children }) => <details className="co-disclosure co-replay-details"><summary>View details<small>Standings, points, players and position balance</small></summary>{children}</details>;
const LeagueResult = ({ leagueId, leagueName, result, onCopyBallot, onExportBallot, hasUnanalyzedChanges, onRetryReplay, sweepBusy }) => {
    const [showAllTeams, setShowAllTeams] = React.useState(false);
    if (!result || result.empty) {
        return (
            <div data-testid="rulelab-result" data-league-id={leagueId}><Section title={leagueName || 'League'} meta={result && result.seasonUsed ? String(result.seasonUsed) : null}>
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)', lineHeight: 1.5 }}>
                    {(result && result.reason) || 'No completed weeks to replay in this league.'}
                </div>
                {onRetryReplay && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Retry replay</button>}
            </Section></div>
        );
    }
    const allStandings = result.standingsShift || [];
    const shift = allStandings.filter(r => r.delta !== 0);
    const shiftShown = showAllTeams ? allStandings : shift.slice(0, 8);
    const shiftHidden = showAllTeams ? 0 : shift.length - shiftShown.length;
    const unchangedCount = showAllTeams ? 0 : allStandings.length - shift.length;
    const field = result.playoffField || { in: [], out: [], unchanged: true };
    const seed = result.seedOneChanged;
    const tds = result.teamDeltas || [];
    const topTeams = tds.slice(0, Math.min(3, tds.length));
    const botTeams = tds.length > 3 ? tds.slice(Math.max(3, tds.length - 3)) : [];
    const shownTeams = showAllTeams ? tds : topTeams.concat(botTeams);
    const largestSwing = tds.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const pds = result.playerDeltas || [];
    const gainers = pds.filter(d => d.delta > 0).slice(0, 8);
    const losers = pds.filter(d => d.delta < 0).slice(0, 8);
    const note = result.proposerNote;

    const PlayerCol = ({ label, rows, color }) => (
        <div style={{ minWidth: 0 }}>
            <div style={{ ...microHdr, marginBottom: '4px' }}>{label}</div>
            {!rows.length ? (
                <div style={{ color: MUTED, fontSize: 'var(--co-readable-small, 0.74rem)' }}>none — no player moves this way</div>
            ) : rows.map(d => (
                <div key={d.pid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 34px 62px', gap: '8px', alignItems: 'baseline', padding: '3px 0', borderBottom: `1px solid ${LINE}` }}>
                    <span style={{ ...nameCell, fontSize: 'var(--co-readable-small, 0.75rem)', color: TEXT }}>{d.name}</span>
                    <span style={{ ...microHdr, textAlign: 'left' }}>{d.pos}</span>
                    <span style={{ ...mono, fontSize: 'var(--co-readable-small, 0.74rem)', fontWeight: 700, textAlign: 'right', color }}>{signed(d.delta)}</span>
                </div>
            ))}
        </div>
    );

    return (
        <div data-testid="rulelab-result" data-league-id={leagueId} id={'wr-rulelab-ballot-' + String(leagueName || 'league').replace(/\W+/g, '-').toLowerCase()}>
        <Section title={leagueName || 'League'}
            meta={(result.seasonUsed ? result.seasonUsed + ' season · ' : '') + result.weeksCounted + ' week' + (result.weeksCounted === 1 ? '' : 's') + ' replayed'
                + (result.methodology === 'best_lineup' ? ' · BEST-LINEUP REPLAY' : ' · as-played')}>

            <div className="co-rulelab-impact-summary" aria-live="polite" aria-atomic="true">
                <div><span style={microHdr}>Teams changing rank</span><strong>{shift.length} of {allStandings.length}</strong></div>
                {largestSwing && <div><span style={microHdr}>Largest points change</span><strong>{signed(largestSwing.delta)} pts</strong>{Number(largestSwing.delta) !== 0 && <span>{largestSwing.name}</span>}</div>}
            </div>

            {/* Verdict card: the seed + the field, before any table */}
            <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${seed ? GOLD : LINE}`, borderRadius: '0 6px 6px 0', padding: '10px 12px', marginBottom: '12px' }}>
                {seed ? (
                    <div style={{ ...mono, fontSize: 'var(--co-readable-body, 0.82rem)', fontWeight: 700, color: GOLD }}>
                        #1 seed flips: {seed.from} → {seed.to}
                    </div>
                ) : (
                    <div style={{ fontSize: 'var(--co-readable-body, 0.8rem)', fontWeight: 600, color: TEXT }}>No change at the top — the #1 seed holds.</div>
                )}
                <div style={{ marginTop: '6px', fontSize: 'var(--co-readable-small, 0.76rem)', lineHeight: 1.6 }}>
                    {field.unchanged ? (
                        <span style={{ color: TEXT }}>Playoff field unchanged ({field.size}-team cut).</span>
                    ) : (
                        <React.Fragment>
                            <div>
                                <span style={{ ...mono, fontSize: 'var(--co-readable-small, 0.68rem)', fontWeight: 700, color: GREEN, marginRight: '8px' }}>IN</span>
                                <span style={{ color: TEXT, ...mono }}>{(field.in || []).join(', ') || '—'}</span>
                            </div>
                            <div>
                                <span style={{ ...mono, fontSize: 'var(--co-readable-small, 0.68rem)', fontWeight: 700, color: RED, marginRight: '8px' }}>OUT</span>
                                <span style={{ color: TEXT, ...mono }}>{(field.out || []).join(', ') || '—'}</span>
                            </div>
                        </React.Fragment>
                    )}
                </div>
            </div>

            <ReplayDetails>
            {(allStandings.length > shift.slice(0, 8).length || tds.length > topTeams.length + botTeams.length) && <button type="button" className="co-rulelab-all-teams" aria-pressed={showAllTeams} onClick={() => setShowAllTeams(!showAllTeams)}>
                {showAllTeams ? 'Show biggest changes' : 'View all teams'}
            </button>}
            {/* Standings shift — moved rows only */}
            <div style={{ ...microHdr, marginBottom: '6px' }}>Standings shift</div>
            {!shiftShown.length ? (
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-small, 0.76rem)', marginBottom: '10px' }}>Standings hold — no team changes rank under this proposal.</div>
            ) : (
                <div role="region" aria-label="Standings shift. Scroll for all columns." tabIndex={0} style={{ overflowX: 'auto', marginBottom: '10px' }}>
                    <div style={{ minWidth: '380px' }}>
                        <div style={{ ...shiftGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                            <span>Team</span><span style={{ textAlign: 'right' }}>Was</span><span style={{ textAlign: 'right' }}>Now</span><span style={{ textAlign: 'right' }}>Δ</span>
                        </div>
                        {shiftShown.map(r => (
                            <div key={r.rosterId} style={{ ...shiftGrid, ...rowLine }}>
                                <span style={nameCell}>{r.name}</span>
                                <span style={{ textAlign: 'right' }}>{r.baselineRank}</span>
                                <span style={{ textAlign: 'right', color: TEXT }}>{r.proposedRank}</span>
                                <span style={{ textAlign: 'right', fontWeight: 700, color: r.delta > 0 ? GREEN : r.delta < 0 ? RED : MUTED }}>
                                    {r.delta === 0 ? '—' : (r.delta > 0 ? '▲' : '▼') + Math.abs(r.delta)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {(shiftHidden > 0 || unchangedCount > 0) ? (
                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '-4px', marginBottom: '10px' }}>
                    {[shiftHidden > 0 ? '+' + shiftHidden + ' more moved' : null, unchangedCount > 0 ? '+' + unchangedCount + ' unchanged' : null].filter(Boolean).join(' · ')}
                </div>
            ) : null}

            {/* Season points swing — biggest winners and losers by total */}
            {(topTeams.length || botTeams.length) ? (
                <React.Fragment>
                    <div style={{ ...microHdr, marginBottom: '6px' }}>Season points swing</div>
                    <div role="region" aria-label="Season points comparison. Scroll for all columns." tabIndex={0} style={{ overflowX: 'auto', marginBottom: '10px' }}>
                        <div style={{ minWidth: '400px' }}>
                            <div style={{ ...swingGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                                <span>Team</span><span style={{ textAlign: 'right' }}>Current</span><span style={{ textAlign: 'right' }}>Proposed</span><span style={{ textAlign: 'right' }}>Δ pts</span>
                            </div>
                            {shownTeams.map(t => (
                                <div key={t.rosterId} style={{ ...swingGrid, ...rowLine }}>
                                    <span style={nameCell}>{t.name}</span>
                                    <span style={{ textAlign: 'right', opacity: 0.8 }}>{Number(t.baselinePts).toFixed(1)}</span>
                                    <span style={{ textAlign: 'right', color: TEXT }}>{Number(t.proposedPts).toFixed(1)}</span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: TEXT }}>{signed(t.delta)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    {!showAllTeams && tds.length > topTeams.length + botTeams.length ? (
                        <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '-4px', marginBottom: '10px' }}>
                            top 3 and bottom 3 of {tds.length} teams shown
                        </div>
                    ) : null}
                </React.Fragment>
            ) : null}

            {/* Player movers — who the rule actually pays */}
            {(gainers.length || losers.length) ? (
                <React.Fragment>
                    <div style={{ ...microHdr, marginBottom: '6px' }}>Player movers · season total</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px', marginBottom: '10px' }}>
                        <PlayerCol label="Gainers" rows={gainers} color={GREEN} />
                        <PlayerCol label="Losers" rows={losers} color={RED} />
                    </div>
                </React.Fragment>
            ) : (
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-small, 0.76rem)', marginBottom: '10px' }}>No individual player moves under this proposal.</div>
            )}

            {/* Position relevance — the league's shape before and after.
                Always the full set the engine returns (already filtered to
                positions that actually carry share) — never trimmed to
                "significant" movers only, so a position holding steady is
                still on screen for comparison, not just the ones that
                shifted. Ordered by overall share (today's real basePct, not
                the delta) so the row order is stable and reads top-to-bottom
                by importance — it doesn't reshuffle every time you tweak a
                different stat's proposed value. */}
            {(result.positionShare || []).length ? (
                <React.Fragment>
                    <div style={{ ...microHdr, marginBottom: '6px' }}>Position relevance · share of all started points</div>
                    <div style={{ marginBottom: '10px' }}>
                        {(result.positionShare || []).slice().sort((a, b) => b.basePct - a.basePct || b.propPct - a.propPct).map(p => (
                            <div key={p.pos} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 130px', gap: '10px', alignItems: 'center', padding: '4px 0' }}>
                                <span style={{ ...microHdr }}>{p.pos}</span>
                                <div style={{ position: 'relative', height: '6px', background: SURF2, borderRadius: '3px', overflow: 'hidden' }}>
                                    <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: Math.min(100, p.basePct * 2.5) + '%', background: LINE }} />
                                    <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: Math.min(100, p.propPct * 2.5) + '%', background: p.deltaPct >= 0 ? ACCENT : RED, opacity: 1, height: '2px', marginTop: '2px' }} />
                                </div>
                                <span style={{ ...mono, fontSize: 'var(--co-readable-small, 0.72rem)', textAlign: 'right', color: TEXT }}>
                                    {p.basePct}% → <span style={{ fontWeight: 700, color: p.deltaPct >= 0 ? GREEN : RED }}>{p.propPct}%</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </React.Fragment>
            ) : null}

            {/* League shape: volatility + how much the standings reshuffle */}
            {result.balance ? (
                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginBottom: '10px', lineHeight: 1.6 }}>
                    Weekly volatility {result.balance.volatilityDeltaPct > 0 ? '+' : ''}{result.balance.volatilityDeltaPct}%
                    {' · '}top-to-bottom spread {result.balance.baseline.spread} → {result.balance.proposed.spread}
                    {' · '}standings correlation {result.balance.spearman} <span title="1.00 = the proposal reshuffles nothing">ⓘ</span>
                </div>
            ) : null}

            </ReplayDetails>
            {/* Proposer disclosure — the conflict-of-interest line */}
            {note && note.line ? (
                <div style={{ background: WELL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${AMBER}`, borderRadius: '0 6px 6px 0', padding: '10px 12px', marginBottom: '10px' }}>
                    <div style={{ ...microHdr, color: AMBER, marginBottom: '4px' }}>Disclosure</div>
                    <div style={{ fontSize: 'var(--co-readable-body, 0.78rem)', color: TEXT, lineHeight: 1.5 }}>{note.line}</div>
                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>Attach this to the ballot when you put it to a vote.</div>
                </div>
            ) : null}

            {/* The ballot: this league's impact statement, ready to circulate */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {typeof onCopyBallot === 'function' ? (
                    <button disabled={hasUnanalyzedChanges} title={hasUnanalyzedChanges ? 'Preview staged changes before sharing this proposal.' : undefined} onClick={() => onCopyBallot(leagueName, result)}
                        style={{ padding: '7px 12px', cursor: 'pointer', background: ACC_FILL, border: `1px solid ${ACC_LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: ACCENT, font: '700 var(--co-readable-small, 0.625rem) ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Copy ballot text
                    </button>
                ) : null}
                {typeof onExportBallot === 'function' ? (
                    <button disabled={hasUnanalyzedChanges} title={hasUnanalyzedChanges ? 'Preview staged changes before sharing this proposal.' : undefined} onClick={() => onExportBallot(leagueName, result)}
                        style={{ padding: '7px 12px', cursor: 'pointer', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', color: TEXT, font: '700 var(--co-readable-small, 0.625rem) ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Export PNG
                    </button>
                ) : null}
            </div>
        </Section>
        </div>
    );
};

function WrCommishRuleLabPanel({
    phone = false,
    status, seasonUsed, seasons, onSeason,
    onRetryReplay,
    leagues, selectedLeagueId, onSelectLeague,
    proposal, onProposalChange, onProposalStage, rosterProposal, onRosterProposalChange,
    onReset, onAnalyze, hasUnanalyzedChanges,
    results, presets, baselineScoring, editorKeys: editorKeysProp, currentSlotsByLeague,
    sweepResult, onSweep, sweepBusy,
    saved, savedError, savedNotice, canRecoverSaved, hasRecoveryCopy, onRecoverSaved, onExportRecovery,
    onSaveProposal, onLoadProposal, onDeleteProposal, onRatify,
    onCopyBallot, onExportBallot,
}) {
    // ── Derived: proposal + presets ──────────────────────────────────
    const prop = (proposal && typeof proposal === 'object') ? proposal : {};
    const presetList = (Array.isArray(presets) && presets.length) ? presets
        : (window.App?.Commish?.RuleLab?.PRESETS || []);
    const propKeys = Object.keys(prop);

    // Active = every override key present at the same value. Value-match (not
    // key-match) is what lets std/half/full PPR share the `rec` key and still
    // light exactly one chip.
    const isActive = p => {
        const ks = Object.keys(p.overrides || {});
        return ks.length > 0 && ks.every(k =>
            Object.prototype.hasOwnProperty.call(prop, k) && Number(prop[k]) === Number(p.overrides[k]));
    };
    const toggle = p => {
        if (typeof onProposalChange !== 'function') return;
        const next = Object.assign({}, prop);
        if (isActive(p)) { Object.keys(p.overrides || {}).forEach(k => { delete next[k]; }); }
        else Object.assign(next, p.overrides || {});
        onProposalChange(next);
    };

    // "0.5" and "1" both print one decimal so the mono line stays tabular;
    // oddballs like 0.25 keep their own precision rather than lying.
    const fmtNum = v => {
        const n = Number(v) || 0;
        return (Math.round(n * 10) === n * 10) ? n.toFixed(1) : String(n);
    };
    // ── Full scoring editor state ────────────────────────────────────
    const [saveName, setSaveName] = React.useState('');
    const [quickKey, setQuickKey] = React.useState('rec');
    const [ruleSearch, setRuleSearch] = React.useState('');
    const [quickDraft, setQuickDraft] = React.useState(null);
    // Human labels for the common Sleeper scoring keys; anything unknown
    // renders its raw key — honest, and every league has oddballs.
    const KEY_LABELS = {
        pass_yd: 'Passing yards (per yd)', pass_td: 'Passing TD', pass_int: 'Interception thrown', pass_2pt: 'Passing 2-pt',
        rush_yd: 'Rushing yards (per yd)', rush_td: 'Rushing TD', rush_2pt: 'Rushing 2-pt',
        rec: 'Reception (PPR)', rec_yd: 'Receiving yards (per yd)', rec_td: 'Receiving TD', rec_2pt: 'Receiving 2-pt',
        bonus_rec_te: 'TE reception premium', bonus_rush_yd_100: '100-yd rushing bonus', bonus_rec_yd_100: '100-yd receiving bonus', bonus_pass_yd_300: '300-yd passing bonus',
        fum_lost: 'Fumble lost', fum: 'Fumble', fum_rec_td: 'Fumble recovery TD',
        st_td: 'Special teams TD', st_fum_rec: 'ST fumble recovery',
        fgm: 'FG made', fgm_0_19: 'FG 0–19', fgm_20_29: 'FG 20–29', fgm_30_39: 'FG 30–39', fgm_40_49: 'FG 40–49', fgm_50p: 'FG 50+', fgmiss: 'FG missed', xpm: 'XP made', xpmiss: 'XP missed',
        def_td: 'Defensive TD', pts_allow_0: 'Shutout', pts_allow_1_6: 'Pts allowed 1–6', pts_allow_7_13: 'Pts allowed 7–13', pts_allow_14_20: 'Pts allowed 14–20', pts_allow_21_27: 'Pts allowed 21–27', pts_allow_28_34: 'Pts allowed 28–34', pts_allow_35p: 'Pts allowed 35+',
        sack: 'Sack', int: 'Interception (DEF)', ff: 'Forced fumble', fum_rec: 'Fumble recovery', safe: 'Safety', blk_kick: 'Blocked kick',
        idp_tkl: 'IDP tackle', idp_sack: 'IDP sack', idp_int: 'IDP interception',
    };
    // The full known stat catalog across every tracked position (QB/RB/WR/TE,
    // K, DEF, IDP) — every key KEY_LABELS knows how to name. Editable stats
    // are the UNION of this catalog with whatever the league(s) actually
    // score, so a commissioner can stage a stat the league has never scored
    // (e.g. turning on IDP tackles) and not just retune an existing one.
    const FULL_STAT_CATALOG = Object.keys(KEY_LABELS);
    // Fallback for any Sleeper key a league scores that KEY_LABELS doesn't
    // know by name (custom/rare IDP splits, etc.) — split on underscore,
    // expand the common abbreviations this app already uses, title-case the
    // rest. Never show a raw snake_case key on screen.
    const KEY_WORD = {
        idp: 'IDP', td: 'TD', yd: 'Yards', yds: 'Yards', ff: 'Forced Fumble', fum: 'Fumble',
        rec: 'Reception', pts: 'Points', def: 'Defense', st: 'Special Teams', fg: 'FG',
        xp: 'XP', int: 'INT', qb: 'QB', pct: '%', allow: 'Allowed', tkl: 'Tackle',
    };
    const humanizeKey = k => {
        if (KEY_LABELS[k]) return KEY_LABELS[k];
        const segs = String(k).split('_');
        return segs.map((seg, i) => {
            // "rec" reads as Reception almost everywhere, but right after
            // "fum" it means Recovery — the one word that needs context.
            if (seg === 'rec' && segs[i - 1] === 'fum') return 'Recovery';
            return KEY_WORD[seg] || (seg.charAt(0).toUpperCase() + seg.slice(1));
        }).join(' ');
    };
    const summaryBits = propKeys.map(k => {
        const v = prop[k];
        const base = baselineScoring && baselineScoring[k] != null ? Number(baselineScoring[k]) : null;
        return humanizeKey(k) + ' ' + (base != null ? fmtNum(base) + ' → ' : '→ ') + fmtNum(v);
    });
    const KEY_GROUPS = [
        ['Passing', k => k.startsWith('pass')],
        ['Rushing', k => k.startsWith('rush') || k === 'bonus_rush_yd_100'],
        ['Receiving', k => k.startsWith('rec') || k === 'bonus_rec_te' || k === 'bonus_rec_yd_100'],
        ['Turnovers & misc', k => k.startsWith('fum') || k.startsWith('st_') || k.startsWith('bonus_pass')],
        ['Kicking', k => k.startsWith('fg') || k.startsWith('xp')],
        ['Defense & IDP', () => true],   // catch-all last
    ];
    const groupKeys = (keys) => {
        const used = new Set();
        return KEY_GROUPS.map(([name, match]) => {
            const ks = keys.filter(k => !used.has(k) && match(k));
            ks.forEach(k => used.add(k));
            return { name, keys: ks };
        }).filter(g => g.keys.length);
    };
    // Key set comes from the container (the scoped league's own keys, or the
    // union across leagues in omnibus) so a league's oddball rules are never
    // invisible just because some other league doesn't score them.
    const editorKeys = (() => {
        const known = (Array.isArray(editorKeysProp) && editorKeysProp.length)
            ? editorKeysProp
            : Object.keys(baselineScoring || {});
        return Array.from(new Set(known.concat(FULL_STAT_CATALOG))).sort();
    })();

    // ── Wind Tunnel picker state ─────────────────────────────────────
    // Any editor key is sweepable; values: null tells the container to build
    // the ladder itself (engine sweepValuesFor, anchored on live baselines).
    const [swKey, setSwKey] = React.useState('rec');
    const [swAll, setSwAll] = React.useState(false);
    const keyLabel = humanizeKey;
    const multiSeasonOk = (seasons || []).filter(s => s.available).length > 1;
    // Free-typing: stage only (no auto-analyze). Falls back to
    // onProposalChange if the container hasn't wired the split, so a field
    // never goes dead — it would just re-analyze on every keystroke again.
    const stageProposal = typeof onProposalStage === 'function' ? onProposalStage : onProposalChange;
    const setKey = (k, raw) => {
        if (typeof stageProposal !== 'function') return;
        const next = Object.assign({}, prop);
        const v = raw === '' || raw == null ? NaN : Number(raw);
        // Typing the league's own current value clears the override ("back to
        // baseline") — but ONLY when we actually know this league's baseline.
        // In omnibus there is no single "from", and an equality test there
        // would silently drop a real override that happens to equal some
        // OTHER league's value. That was live: the editor was fed league #1's
        // scoring for every league.
        const baseVal = baselineScoring && baselineScoring[k] != null ? Number(baselineScoring[k]) : null;
        if (!Number.isFinite(v) || (baseVal != null && v === baseVal)) delete next[k]; else next[k] = v;
        stageProposal(next);
    };

    // Keep the numeric field's raw string while it is being edited. A blank
    // or an intermediate minus/decimal must not snap back to the baseline.
    // External preset/scope changes invalidate that draft automatically.
    const quickBase = baselineScoring && baselineScoring[quickKey] != null ? Number(baselineScoring[quickKey]) : null;
    const quickOverride = Object.prototype.hasOwnProperty.call(prop, quickKey) ? prop[quickKey] : undefined;
    const quickValue = quickOverride !== undefined ? Number(quickOverride) : quickBase;
    const draftIsCurrent = quickDraft && quickDraft.key === quickKey && quickDraft.scope === selectedLeagueId && quickDraft.base === quickBase
        && quickDraft.expected === quickOverride;
    const quickShown = draftIsCurrent ? quickDraft.raw : (quickValue != null ? quickValue : '');
    const quickStep = /^(rec|bonus_rec_te)$/.test(quickKey) ? 0.25 : /_yd$/.test(quickKey) ? 0.01 : (quickBase != null && Number.isInteger(quickBase) ? 1 : 0.05);
    const canStep = quickValue != null && Number.isFinite(quickValue);
    const quickLabel = humanizeKey(quickKey);
    const matchedKeys = editorKeys.filter(k => !ruleSearch.trim() || (humanizeKey(k) + ' ' + k).toLowerCase().includes(ruleSearch.trim().toLowerCase()));
    const quickOptions = matchedKeys.includes(quickKey) ? matchedKeys : [quickKey, ...matchedKeys];
    const stageKeyInput = (key, raw) => {
        const base = baselineScoring && baselineScoring[key] != null ? Number(baselineScoring[key]) : null;
        const numeric = raw === '' ? NaN : Number(raw);
        const expected = !Number.isFinite(numeric) || (base != null && numeric === base) ? undefined : numeric;
        setQuickDraft({ key, scope: selectedLeagueId, base, raw, expected });
        setKey(key, raw);
    };
    const stepQuickValue = direction => {
        if (!canStep || typeof onProposalChange !== 'function') return;
        const next = { ...prop };
        const value = Math.round((quickValue + direction * quickStep) * 1000000) / 1000000;
        if (quickBase != null && value === quickBase) delete next[quickKey]; else next[quickKey] = value;
        setQuickDraft(null);
        onProposalChange(next);
    };
    const resetQuickValue = () => {
        const next = { ...prop }; delete next[quickKey];
        setQuickDraft(null);
        onProposalChange?.(next);
    };

    // ── Roster structure proposal ────────────────────────────────────
    const SLOT_UNIVERSE = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX', 'K', 'DEF'];
    const rp = (rosterProposal && Array.isArray(rosterProposal.rosterPositions)) ? rosterProposal.rosterPositions : null;
    const setSlots = (slots) => {
        if (typeof onRosterProposalChange !== 'function') return;
        onRosterProposalChange(slots && slots.length ? { rosterPositions: slots } : null);
    };
    // The structures each league runs today, deduped into display strings so
    // "what am I changing FROM" is always on screen.
    const currentStructures = (() => {
        const seen = {};
        Object.keys(currentSlotsByLeague || {}).forEach(name => {
            const key = (currentSlotsByLeague[name] || []).join('·');
            (seen[key] = seen[key] || []).push(name);
        });
        return Object.keys(seen).map(k => ({ slots: k.split('·').filter(Boolean), leagues: seen[k] }));
    })();

    // ── Shells (same idiom as season-odds-panel) ─────────────────────


    // ── Body by status ───────────────────────────────────────────────
    const resultRows = Array.isArray(results) ? results : [];
    const compactResult = status === 'ready' && resultRows.length === 1 && resultRows[0].result && !resultRows[0].result.empty
        ? resultRows[0].result : null;
    const compactMoved = compactResult ? (compactResult.standingsShift || []).filter(r => r.delta !== 0).length : 0;
    const goToImpact = event => {
        const target = event.currentTarget.closest('.co-rulelab')?.querySelector('[data-testid="rulelab-impact"]');
        if (!target) return;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
    };
    let body = null;
    if (status === 'loading') {
        body = (
            <Section title="Replay">
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)', ...mono }}>Replaying the {seasonUsed || 'last'} season…</div>
            </Section>
        );
    } else if (status === 'empty') {
        body = (
            <Section title="Replay">
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)', lineHeight: 1.5 }}>No completed weeks to replay — the lab needs at least one finished week of box scores.</div>
                {onRetryReplay && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Retry replay</button>}
            </Section>
        );
    } else if (status === 'error') {
        body = (
            <Section title="Replay">
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)' }}>The replay could not be run — season stats or lineups failed to load.</div>
                {onRetryReplay && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Retry replay</button>}
            </Section>
        );
    } else if (status === 'ready') {
        body = !resultRows.length ? (
            <Section title="Replay">
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)' }}>No leagues to replay yet.</div>
            </Section>
        ) : (
            <React.Fragment>
                {resultRows.map((row, i) => (
                    <LeagueResult key={row.leagueId || row.leagueName || i} leagueId={row.leagueId} leagueName={row.leagueName} result={row.result} onCopyBallot={onCopyBallot} onExportBallot={onExportBallot} hasUnanalyzedChanges={hasUnanalyzedChanges} onRetryReplay={onRetryReplay} sweepBusy={sweepBusy} />
                ))}
            </React.Fragment>
        );
    } else {
        // idle — the bench is live, the replay hasn't been asked for yet
        body = (
            <Section title="Replay">
                <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)', lineHeight: 1.5 }}>Stage a proposal above and the lab replays the season under it — current rules vs proposed, same lineups, same stat lines.</div>
            </Section>
        );
    }

    const chipBtn = (on, extra) => ({
        padding: '6px 11px', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)',
        font: '600 var(--co-readable-small, 0.7rem) ' + MONO, letterSpacing: '0.03em',
        background: on ? ACC_FILL : 'transparent',
        color: on ? ACCENT : SILVER,
        border: '1px solid ' + (on ? ACC_LINE : LINE),
        ...(extra || {}),
    });

    return (
        <div className="co-rulelab" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Master reset — one click back to current settings, scoring AND
                roster structure both. The per-section "Clear" buttons below
                stay (they're the scoped, in-context undo for the section
                you're looking at); this is the "start over entirely" escape
                hatch, visible only when there's actually something staged. */}
            {(propKeys.length > 0 || rp) ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => {
                        setQuickDraft(null);
                        if (typeof onReset === 'function') { onReset(); return; }
                        // Fallback for a container that hasn't wired onReset —
                        // clears the live proposal (keeping the committed
                        // snapshot in sync becomes that container's problem).
                        if (typeof onProposalChange === 'function') onProposalChange({});
                        if (typeof onRosterProposalChange === 'function') onRosterProposalChange(null);
                    }} style={chipBtn(false, { color: TEXT })}>
                        Reset all changes
                    </button>
                </div>
            ) : null}

            {/* League scope — you amend ONE constitution at a time. Scoping is
                also what makes the full editor truthful: only a single league
                has a real "from" value and a real key set. */}
            {phone && (leagues || []).length > 1 ? <label className="co-scope-select">Amending league<select value={selectedLeagueId || ''} onChange={e => onSelectLeague?.(e.target.value)}>{(leagues || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}<option value="__all">All {(leagues || []).length} leagues</option></select></label> : (leagues || []).length > 1 ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ ...microHdr }}>Amending</span>
                    {(leagues || []).map(l => (
                        <button key={l.id} onClick={() => onSelectLeague && onSelectLeague(l.id)}
                            style={chipBtn(String(selectedLeagueId) === String(l.id))}>
                            {l.name}
                        </button>
                    ))}
                    <button onClick={() => onSelectLeague && onSelectLeague('__all')}
                        title="Run the proposal against every league at once — the cross-league question, with no single baseline to edit against."
                        style={chipBtn(selectedLeagueId === '__all', { marginLeft: '4px' })}>
                        All {(leagues || []).length} leagues
                    </button>
                </div>
            ) : null}

            {/* Stated at SELECTION time, not buried in the editor — the cost of
                the omnibus is exactly what you lose by not scoping. */}
            {!baselineScoring && (leagues || []).length > 1 ? (
                <div style={{ background: 'var(--co-fill-warn, #2A2010)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 11px', fontSize: 'var(--co-readable-small, 0.74rem)', color: TEXT, lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
                    Running across <b>every league at once</b>. Each keeps its own scoring, so proposals show no current value and nothing resets to baseline. Pick a single league to edit against real numbers.
                </div>
            ) : null}

            {/* Season picker — replay any season the league's history chain reaches */}
            {(seasons || []).length > 1 ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ ...microHdr }}>Replay season</span>
                    {(seasons || []).map(s => (
                        <button key={s.season} onClick={() => onSeason && onSeason(s.season)} disabled={!s.available}
                            title={s.available ? undefined : 'No prior league found for this season'}
                            style={chipBtn(Number(seasonUsed) === Number(s.season), s.available ? null : { opacity: 0.45, cursor: 'default' })}>
                            {s.season}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="co-rulelab-workspace">
            <div className="co-rulelab-controls" data-testid="rulelab-controls">
            <Section title="Change the scoring" meta="Pick a preset for an immediate replay, or edit one rule below.">
                {!presetList.length ? (
                    <div style={{ color: TEXT, fontSize: 'var(--co-readable-body, 0.78rem)' }}>No proposal presets available — the Rule Lab engine has not loaded.</div>
                ) : (
                    <div className="co-rule-presets" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        {presetList.map(p => {
                            const on = isActive(p);
                            return (
                                <button key={p.key} type="button" aria-pressed={on} onClick={() => { setQuickDraft(null); toggle(p); }}
                                    style={{
                                        padding: '6px 11px', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)',
                                        font: '600 var(--co-readable-small, 0.7rem) ' + MONO, letterSpacing: '0.03em',
                                        background: on ? 'rgba(212,175,55,0.08)' : 'transparent',
                                        color: on ? GOLD : SILVER,
                                        border: '1px solid ' + (on ? GOLD : LINE),
                                    }}>
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                )}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {summaryBits.length ? (
                        <span style={{ ...mono, fontSize: 'var(--co-readable-small, 0.76rem)', color: TEXT }}>{summaryBits.join(' · ')}</span>
                    ) : (
                        <span style={{ ...mono, fontSize: 'var(--co-readable-small, 0.76rem)', color: MUTED }}>no changes staged — current rules</span>
                    )}
                    {propKeys.length ? (
                        <button onClick={() => { setQuickDraft(null); if (typeof onProposalChange === 'function') onProposalChange({}); }}
                            style={{ padding: '4px 10px', background: 'transparent', color: TEXT, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', font: '700 var(--co-readable-small, 0.62rem) ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>
                            Clear
                        </button>
                    ) : null}
                </div>
                <div className="co-rulelab-quick-editor" data-testid="rulelab-quick-editor">
                    <label className="co-rulelab-search">Find a scoring rule
                        <input type="search" aria-label="Find a scoring rule" placeholder="Search receptions, passing, tackles…" value={ruleSearch} onChange={e => setRuleSearch(e.target.value)} />
                    </label>
                    <label>Scoring rule
                        <select aria-label="Scoring rule" value={quickKey} onChange={e => { setQuickKey(e.target.value); setQuickDraft(null); }}>
                            {quickOptions.map(k => <option key={k} value={k}>{humanizeKey(k)}</option>)}
                        </select>
                    </label>
                    {ruleSearch.trim() && <small role="status">{matchedKeys.length ? matchedKeys.length + ' matching rules' : 'No matching rules. Your current selection is still shown.'}</small>}
                    <div className="co-rulelab-current-value"><span>Current</span><strong>{quickBase != null ? fmtNum(quickBase) : '—'}</strong><small>{quickBase == null ? (baselineScoring ? 'No current value available' : 'Varies by league') : quickLabel}</small></div>
                    <label className="co-rulelab-proposed-value">Proposed
                        <div className="co-rulelab-stepper">
                            <button type="button" aria-label={'Decrease ' + quickLabel} disabled={!canStep} onClick={() => stepQuickValue(-1)}>−</button>
                            <input type="number" aria-label="Proposed value" step={quickStep} inputMode="decimal" value={quickShown} placeholder="Enter a value" onChange={e => stageKeyInput(quickKey, e.target.value)} />
                            <button type="button" aria-label={'Increase ' + quickLabel} disabled={!canStep} onClick={() => stepQuickValue(1)}>+</button>
                        </div>
                    </label>
                    <small>+ / − updates the replay immediately{canStep ? ' (' + quickStep + ' points per step)' : ' once you enter a value'}. Type a value, then preview it.</small>
                    <div className="co-rulelab-edit-actions">
                        <button type="button" onClick={() => { if (hasUnanalyzedChanges) { setQuickDraft(null); onAnalyze?.(); } }} disabled={!hasUnanalyzedChanges}>Preview changes</button>
                        <button type="button" onClick={resetQuickValue} disabled={quickOverride === undefined && !draftIsCurrent}>Reset this rule</button>
                    </div>
                    {hasUnanalyzedChanges && <p className="co-rulelab-staged" role="status">Changes staged. The impact still reflects your last preview.</p>}
                    <div className="co-rulelab-feedback" aria-live="polite" aria-atomic="true">
                        <strong>{hasUnanalyzedChanges ? 'Last preview' : 'Current preview'}</strong>
                        {compactResult ? <>
                            <p>{compactMoved} of {(compactResult.standingsShift || []).length} teams change rank. {compactResult.playoffField?.unchanged
                                ? 'Playoff field unchanged.'
                                : compactResult.playoffField ? (compactResult.playoffField.in || []).length + ' in, ' + (compactResult.playoffField.out || []).length + ' out of the playoff field.' : ''}</p>
                            <p>{compactResult.seedOneChanged ? '#1 seed: ' + compactResult.seedOneChanged.from + ' → ' + compactResult.seedOneChanged.to : '#1 seed holds.'}</p>
                            <small>{compactResult.seasonUsed || seasonUsed} · {compactResult.weeksCounted} weeks replayed</small>
                        </> : <p>{status === 'loading' ? 'Loading season data…' : resultRows.length > 1 ? 'View each league’s replay below.' : 'Replay data is unavailable. See the impact area for details and retry options.'}</p>}
                        <button type="button" className="co-rulelab-impact-jump" aria-controls="wr-rulelab-impact" onClick={goToImpact} style={{ minHeight: 44 }}>See replay impact</button>
                    </div>
                </div>
            </Section>
            </div>
            <section id="wr-rulelab-impact" tabIndex={-1} className="co-rulelab-impact co-rulelab-result" data-testid="rulelab-impact" aria-label="Replay impact">
                <div className="co-rulelab-impact-heading"><h3>Replay impact</h3>{onRetryReplay && status === 'ready' && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Reload season data</button>}</div>
                <p className="co-rulelab-context">Historical lineups, replayed under current league rules and your proposal.</p>
                <div className="co-analysis-state"><p>{hasUnanalyzedChanges ? 'Changes staged. This result still reflects your last preview. Preview changes before sharing.' : 'Current rules compared with your proposed rules.'}</p></div>
                {body}
            </section>
            <div className="co-rulelab-save">
                <label>Proposal name<input aria-label="Proposal name" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="e.g. TE premium for next season" /></label>
                <button type="button" disabled={!!savedError || !saveName.trim() || (!propKeys.length && !rp)} onClick={() => { if (onSaveProposal?.(saveName.trim()) === true) setSaveName(''); }}>Save draft</button>
                {savedNotice && <p role="status" className="co-rulelab-saved-notice">{savedNotice}</p>}
                <small>Saves these settings in your browser. Reopening the draft runs a new replay. League settings stay unchanged.</small>
                {savedError && <p role="alert">{savedError} Open Manage saved proposals below for recovery options.</p>}
            </div>
            </div>
            {/* ── Roster Bench: structure proposals ─────────────────────── */}
            <Section folded title="Starting lineup changes" meta="Optional · add or remove starting slots">
                {currentStructures.length ? (
                    <div style={{ marginBottom: '10px' }}>
                        {currentStructures.map((cs, i) => (
                            <div key={i} style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginBottom: '2px' }}>
                                <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{cs.leagues.join(', ')}</span>
                                {' today: '}<span style={{ ...mono, color: TEXT }}>{cs.slots.join(' · ')}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: rp ? '10px' : 0 }}>
                    <span style={{ ...microHdr }}>Proposed structure</span>
                    {!rp ? (
                        <React.Fragment>
                            <span style={{ fontSize: 'var(--co-readable-small, 0.75rem)', color: MUTED, fontFamily: 'var(--font-body)' }}>none — click a slot to start from the first league's current structure</span>
                            {SLOT_UNIVERSE.slice(0, 6).map(s => (
                                <button key={s} onClick={() => {
                                    const base = currentStructures[0] ? currentStructures[0].slots.slice() : [];
                                    setSlots(base.concat([s]));
                                }} style={chipBtn(false)}>+ {s.replace('_', ' ')}</button>
                            ))}
                        </React.Fragment>
                    ) : (
                        <React.Fragment>
                            {rp.map((s, i) => (
                                <button key={s + i} title="Remove slot" onClick={() => setSlots(rp.filter((_, j) => j !== i))}
                                    style={chipBtn(true)}>{s.replace('_', ' ')} ✕</button>
                            ))}
                            <span style={{ width: '1px', height: '14px', background: LINE }} />
                            {SLOT_UNIVERSE.map(s => (
                                <button key={'add' + s} onClick={() => setSlots(rp.concat([s]))} style={chipBtn(false)}>+ {s.replace('_', ' ')}</button>
                            ))}
                            <button onClick={() => setSlots(null)}
                                style={{ padding: '4px 10px', background: 'transparent', color: TEXT, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', font: '700 var(--co-readable-small, 0.62rem) ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>Clear</button>
                        </React.Fragment>
                    )}
                </div>
                {rp ? (
                    <div style={{ background: ACC_FILL, border: `1px solid ${ACC_LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '9px 12px', fontSize: 'var(--co-readable-small, 0.76rem)', color: TEXT, lineHeight: 1.55, fontFamily: 'var(--font-body)' }}>
                        Structure change staged → the replay switches to <b>best-lineup mode</b>: both runs refield every roster's optimal lineup from the players they actually had, because as-played starters can't sit in slots that didn't exist. The diff still isolates the rule change.
                    </div>
                ) : null}
            </Section>

            {/* ── The Wind Tunnel: threshold sweep ──────────────────────── */}
            <Section folded title="All scoring rules" meta="Optional · edit several stats before previewing">
                {/* Dial in exact numbers — every stat this league tracks,
                    plus the full catalog for every position this app knows
                    how to score (so a rule the league has never turned on
                    is still stageable), grouped by category with the
                    current value as the placeholder. Set as many at once as
                    you want — each one stages straight into the proposal,
                    and the replay below updates immediately. */}
                <div style={{ marginBottom: '14px' }}>
                    {groupKeys(editorKeys).map((g, gi) => (
                        <details open={phone ? undefined : true} className="co-scoring-category" key={g.name} style={{ marginBottom: '16px', paddingTop: gi ? '14px' : 0, borderTop: gi ? `1px solid ${LINE}` : 'none' }}>
                            <summary style={{ fontSize: 'var(--co-readable-small, 0.68rem)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, marginBottom: '8px' }}>{g.name}{phone && <small>{g.keys.filter(k => Object.prototype.hasOwnProperty.call(prop, k)).length} changes</small>}</summary>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '8px 16px' }}>
                                {g.keys.map(k => {
                                    // No baseline (omnibus) → no placeholder. Showing "0.0"
                                    // there would assert the league scores this rule at zero.
                                    const cur = baselineScoring && baselineScoring[k] != null ? Number(baselineScoring[k]) : null;
                                    const overridden = Object.prototype.hasOwnProperty.call(prop, k);
                                    // Ticking (spinner arrows / arrow keys) should move relative
                                    // to the league's real current number — a browser steps an
                                    // EMPTY field from 0, not from its placeholder text, which is
                                    // what made every tick reset back to zero. So the known
                                    // baseline is the starting VALUE here, not just a placeholder;
                                    // only a genuinely unknown stat (omnibus, never scored) still
                                    // shows blank + "—". No min/max on the field either — a
                                    // proposal can go as high or as negative as you type or tick.
                                    const step = (cur != null && Number.isInteger(cur)) ? 1 : 0.05;
                                    const activeDraft = quickDraft && quickDraft.key === k && quickDraft.scope === selectedLeagueId && quickDraft.base === cur
                                        && quickDraft.expected === (overridden ? prop[k] : undefined);
                                    const shownValue = activeDraft ? quickDraft.raw : overridden ? prop[k] : (cur != null ? cur : '');
                                    return (
                                        <label key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 74px', gap: '8px', alignItems: 'center' }}>
                                            <span title={k} style={{ fontSize: 'var(--co-readable-small, 0.72rem)', color: overridden ? TEXT : SILVER, fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {humanizeKey(k)}
                                            </span>
                                            <input type="number" step={step} inputMode="decimal"
                                                value={shownValue}
                                                placeholder={cur == null ? '—' : undefined}
                                                onChange={e => stageKeyInput(k, e.target.value)}
                                                style={{ width: '100%', background: overridden ? ACC_FILL : 'var(--co-page, #08080B)', border: '1px solid ' + (overridden ? ACC_LINE : LINE), borderRadius: 'var(--card-radius-xs, 5px)', color: overridden ? TEXT : SILVER, padding: '5px 8px', fontSize: '16px', ...mono, textAlign: 'right' }} />
                                        </label>
                                    );
                                })}
                            </div>
                        </details>
                    ))}
                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5 }}>
                        {baselineScoring
                            ? 'Values show this league’s current rules. Type a number to stage a change, then preview it. Clear an override by entering its current value.'
                            : 'No single current rule across leagues, so fields show \u201C\u2014\u201D. Blank a field to drop the override.'}
                    </div>
                </div>

                {/* Analyze: the multi-stat grid above only STAGES \u2014 typing
                    doesn't touch the replay below until this fires. Every
                    other control in this panel (chips, roster-slot buttons,
                    Reset, Load) is a single click and commits on its own;
                    this is the one deliberate trigger for free-typed
                    numbers, so several stats can be staged before the
                    season replay re-runs even once. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <button
                        onClick={() => { if (hasUnanalyzedChanges && typeof onAnalyze === 'function') onAnalyze(); }}
                        disabled={!hasUnanalyzedChanges}
                        title={hasUnanalyzedChanges ? 'Run the replay against everything staged above' : 'Nothing staged \u2014 type a value above to stage a change'}
                        style={chipBtn(hasUnanalyzedChanges, {
                            color: hasUnanalyzedChanges ? ACCENT : MUTED,
                            cursor: hasUnanalyzedChanges ? 'pointer' : 'default',
                            opacity: hasUnanalyzedChanges ? 1 : 0.55,
                        })}>
                        {hasUnanalyzedChanges ? 'Preview changes' : 'No changes to preview'}
                    </button>
                    {hasUnanalyzedChanges ? (
                        <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, color: AMBER }}>
                            Staged, not yet analyzed \u2014 the replay below still reflects the last analysis.
                        </span>
                    ) : null}
                </div>
            </Section>

            <Section folded title="Find a scoring threshold" meta="Optional · compare several values and seasons">
                <p style={{ color: TEXT, fontSize: 'var(--co-readable-small, 0.76rem)', lineHeight: 1.5 }}>Test a range of values to see where rankings or playoff qualification change.</p>
                {/* Any-key picker: every rule the editor knows is sweepable. */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select aria-label="Scoring threshold rule" value={swKey} onChange={e => setSwKey(e.target.value)} disabled={!!sweepBusy}
                        style={{ background: 'var(--co-page, #08080B)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '7px 8px', fontSize: 'var(--co-readable-body, 0.78rem)', fontFamily: 'var(--font-body)', maxWidth: '240px' }}>
                        {groupKeys(editorKeys).map(g => (
                            <optgroup key={g.name} label={g.name}>
                                {g.keys.map(k => <option key={k} value={k}>{humanizeKey(k)}</option>)}
                            </optgroup>
                        ))}
                    </select>
                    <button disabled={!!sweepBusy || hasUnanalyzedChanges} onClick={() => onSweep && onSweep(swKey, null, { allSeasons: swAll })} style={chipBtn(true, sweepBusy ? { opacity: 0.5 } : null)}>
                        {sweepBusy ? 'Comparing…' : 'Compare values'}
                    </button>
                    {multiSeasonOk ? (
                        <button onClick={() => setSwAll(!swAll)} disabled={!!sweepBusy}
                            title="Compare the tested values in every available historical season."
                            style={chipBtn(swAll, sweepBusy ? { opacity: 0.5 } : null)}>
                            {swAll ? '✓ ' : ''}Every season
                        </button>
                    ) : null}
                </div>
                {hasUnanalyzedChanges && <p role="status" style={{ fontSize: 'var(--co-readable-small, 0.76rem)', color: AMBER }}>Preview changes before comparing values.</p>}
                {/* The three classic arguments stay one click away. */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                    <span style={{ ...microHdr }}>Quick:</span>
                    {[['rec', 'PPR 0 → 1.5', [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]],
                      ['bonus_rec_te', 'TE premium 0 → 1.5', [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]],
                      ['pass_td', 'Pass TD 4 → 6', [4, 5, 6]]].map(([key, label, values]) => (
                        <button key={key} disabled={!!sweepBusy || hasUnanalyzedChanges} onClick={() => onSweep && onSweep(key, values, { allSeasons: swAll })}
                            style={chipBtn(sweepResult && sweepResult.key === key, sweepBusy ? { opacity: 0.5 } : null)}>
                            {sweepBusy === key ? 'Sweeping…' : label}
                        </button>
                    ))}
                </div>
                {sweepResult && sweepResult.multi && sweepResult.perLeague && sweepResult.perLeague.length ? (
                    /* Multi-season grid: rows = seasons, cols = values. The verdict
                       is the consensus threshold — movement in EVERY replayed year. */
                    <div style={{ marginTop: '12px' }}>
                        {sweepResult.perLeague.map(pl => (
                            <div key={pl.leagueName} style={{ marginBottom: '14px' }}>
                                <div style={{ ...microHdr, marginBottom: '4px' }}>{pl.leagueName}{keyLabel(sweepResult.key) ? ' · ' + keyLabel(sweepResult.key) : ''}</div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ borderCollapse: 'collapse' }}>
                                        <thead><tr>
                                            <th style={{ ...microHdr, textAlign: 'left', padding: '3px 10px 3px 0' }}>Season</th>
                                            {pl.rows.map(r => (
                                                <th key={r.value} style={{ ...mono, fontSize: 'var(--co-readable-small, 0.72rem)', fontWeight: 700, color: r.isCurrent ? ACCENT : SILVER, padding: '3px 7px', textAlign: 'center', borderBottom: `1px solid ${LINE}` }}>
                                                    {r.value}{r.isCurrent ? '•' : ''}
                                                </th>
                                            ))}
                                        </tr></thead>
                                        <tbody>
                                            {pl.seasons.map(season => (
                                                <tr key={season}>
                                                    <td style={{ ...mono, fontSize: 'var(--co-readable-small, 0.72rem)', color: TEXT, padding: '4px 10px 4px 0' }}>{season}</td>
                                                    {pl.rows.map(r => {
                                                        const cell = r.bySeason[season];
                                                        const bg = cell === 'SEED' ? 'var(--co-fill-bad, #2A1512)' : cell === 'FIELD' ? 'var(--co-fill-warn, #2A2010)' : cell && cell !== 'HOLD' ? SURF2 : 'transparent';
                                                        const fg = cell === 'SEED' ? RED : cell === 'FIELD' ? AMBER : cell && cell !== 'HOLD' ? TEXT : MUTED;
                                                        return <td key={r.value} style={{ ...microHdr, fontSize: 'var(--co-readable-small, 0.575rem)', color: fg, background: bg, padding: '5px 7px', textAlign: 'center', border: `1px solid var(--co-line-soft, #201F27)` }}>{cell || '—'}</td>;
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '5px' }}>
                                    {Number(pl.of) === 0 ? (
                                        <div role="status">
                                            <p>No seasons could be replayed. Season data is unavailable; no movement conclusion is available.</p>
                                            {onRetryReplay && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Retry replay</button>}
                                        </div>
                                    ) : pl.consensus != null ? (
                                        <span>At least one tested value changes ranks or playoff qualification in <b style={{ color: TEXT }}>every replayed season</b> ({pl.heldIn} of {pl.of}). Compare the grid to see which values change each year.</span>
                                    ) : pl.heldIn > 0 ? (
                                        <span>Rank or playoff changes in {pl.heldIn} of {pl.of} seasons. First tested movement: <span style={{ ...mono, color: TEXT, fontWeight: 700 }}>{pl.minFlip}</span>. The other seasons hold their rankings in this range.</span>
                                    ) : (
                                        <span>No tested value changes ranks or playoff qualification in the replayed seasons.</span>
                                    )}
                                    {pl.noData && pl.noData.length ? <span style={{ color: MUTED }}> · no data: {pl.noData.join(', ')}</span> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : sweepResult && sweepResult.perLeague && sweepResult.perLeague.length ? (
                    <div style={{ marginTop: '12px' }}>
                        {sweepResult.perLeague.map(pl => {
                            const steps = Array.isArray(pl.steps) ? pl.steps : [];
                            const hasData = steps.some(step => !step.empty);
                            const hasUnavailable = steps.some(step => step.empty);
                            return (
                            <div key={pl.leagueName} style={{ marginBottom: '10px' }}>
                                <div style={{ ...microHdr, marginBottom: '4px' }}>{pl.leagueName}</div>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {steps.map(s => (
                                        <div key={s.value} title={s.empty ? 'Replay data unavailable for this value.' : s.seedFlips ? '#1 seed flips to ' + s.seedTo : (s.ranksMoved + ' ranks move · ' + s.fieldMoves + ' field changes')}
                                            style={{ minWidth: '58px', textAlign: 'center', padding: '6px 4px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid ' + (s.isCurrent ? ACC_LINE : LINE), background: s.seedFlips ? 'var(--co-fill-bad, #2A1512)' : s.fieldMoves > 0 ? 'var(--co-fill-warn, #2A2010)' : s.ranksMoved > 0 ? SURF2 : 'transparent' }}>
                                            <div style={{ ...mono, fontSize: 'var(--co-readable-body, 0.78rem)', fontWeight: 700, color: s.seedFlips ? RED : s.fieldMoves > 0 ? AMBER : s.ranksMoved > 0 ? TEXT : MUTED }}>{s.value}</div>
                                            <div style={{ ...microHdr, fontSize: 'var(--co-readable-small, 0.575rem)' }}>{s.empty ? 'Data unavailable' : s.isCurrent ? 'NOW' : s.seedFlips ? 'SEED' : s.fieldMoves > 0 ? 'FIELD' : s.ranksMoved > 0 ? s.ranksMoved + ' MV' : 'HOLD'}</div>
                                        </div>
                                    ))}
                                </div>
                                {!hasData ? <div role="status" style={{ fontSize: 'var(--co-readable-small, 0.76rem)', lineHeight: 1.5 }}>
                                    <p>Scoring threshold unavailable. Season data could not be replayed; no movement conclusion is available.</p>
                                    {onRetryReplay && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Retry replay</button>}
                                </div> : pl.firstFlipAt != null ? (
                                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>
                                        First tested rank or playoff change: <span style={{ ...mono, color: TEXT, fontWeight: 700 }}>{pl.firstFlipAt}</span>. Other values may still change points.
                                    </div>
                                ) : <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>{hasUnavailable ? 'Available values do not change ranks or playoff qualification.' : 'No tested value changes ranks or playoff qualification.'} Points may still change.</div>}
                                {hasData && hasUnavailable && <div role="status" style={{ fontSize: 'var(--co-readable-small, 0.76rem)', lineHeight: 1.5 }}>
                                    <p>Some values could not be replayed. Retry before comparing the full range.</p>
                                    {onRetryReplay && <button type="button" disabled={!!sweepBusy} onClick={onRetryReplay}>Retry replay</button>}
                                </div>}
                            </div>
                            );
                        })}
                    </div>
                ) : null}
            </Section>

            {/* ── Saved proposals ───────────────────────────────────────── */}
            <Section folded title="Manage saved proposals" meta="Load a draft or record an approved change locally">
                {savedError && <div role="alert" style={{ fontSize: '16px', lineHeight: 1.5, marginBottom: 12 }}>
                    <p>{savedError}</p>
                    {canRecoverSaved && <><button type="button" style={{ ...chipBtn(false), minHeight: 44 }} onClick={onExportRecovery}>Download original data</button>{' '}
                        <button type="button" style={{ ...chipBtn(true), minHeight: 44 }} onClick={onRecoverSaved}>Preserve a copy &amp; start a new list</button></>}
                </div>}
                {hasRecoveryCopy && <div role="status" style={{ fontSize: '16px', lineHeight: 1.5, marginBottom: 12 }}>Your previous proposal data is preserved in this browser. <button type="button" style={{ ...chipBtn(false), minHeight: 44 }} onClick={onExportRecovery}>Download recovery copy</button></div>}
                {!(saved || []).length && !savedError && <p>No saved proposals yet. Name and save your draft above.</p>}
                {(saved || []).map(sp => (
                    <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)`, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 'var(--co-readable-body, 0.8rem)', color: sp.status === 'ratified' ? MUTED : TEXT }}>{sp.name}</span>
                        <span style={{ ...microHdr }}>{Object.keys(sp.overrides || {}).length} rule{Object.keys(sp.overrides || {}).length === 1 ? '' : 's'}{sp.rosterProposal ? ' + structure' : ''}</span>
                        {sp.status === 'ratified' ? <span style={{ ...microHdr, color: GREEN }}>RATIFIED LOCALLY{sp.ratifiedLeagueIds?.length ? ' · ' + sp.ratifiedLeagueIds.length + ' league' + (sp.ratifiedLeagueIds.length === 1 ? '' : 's') : ''}</span> : null}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                            <button onClick={() => onLoadProposal && onLoadProposal(sp.id)} style={chipBtn(false)}>Load</button>
                            {sp.status !== 'ratified' && onRatify ? (
                                <button title="Records proposed changes in the selected leagues' local amendment history. It does not update platform settings."
                                    onClick={() => onRatify(sp.id)} style={chipBtn(false, { color: GREEN, borderColor: 'rgba(46,204,113,0.4)' })}>Ratify</button>
                            ) : null}
                            <button aria-label={'Remove saved proposal ' + sp.name} title="Removes this saved proposal; amendment history already recorded remains."
                                onClick={() => onDeleteProposal && onDeleteProposal(sp.id)} style={chipBtn(false, { color: MUTED })}>✕</button>
                        </span>
                    </div>
                ))}
            </Section>

            <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5, padding: '0 2px' }}>
                {rp
                    ? 'Lineup comparisons use each roster’s optimal starters from the same player pool. '
                    : 'Scoring comparisons use the same historical lineups and stats. '}
                Playoff game results are preserved; only qualification and seeding are recalculated.
            </div>
        </div>
    );
}

window.WrCommishRuleLabPanel = WrCommishRuleLabPanel;
