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
//             call onProposalChange(nextProposalObject) and the container
//             re-renders with the new prop (and re-runs the lab when ready).
//   results   App.Commish.RuleLab.runOmnibus output:
//             [{ leagueId, leagueName, result }] where result is runProposal
//             output (or its { empty:true, reason } form, handled per league).
//   presets   App.Commish.RuleLab.PRESETS ([{ key, label, overrides }]);
//             falls back to the engine global when the prop is absent.
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
function WrCommishRuleLabPanel({ status, seasonUsed, proposal, onProposalChange, results, presets, baselineScoring }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)';
    const AMBER = 'var(--warn, #F0A500)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const MUTED = 'var(--text-muted, #8D887E)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };

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
    const summaryBits = propKeys.map(k => {
        const v = prop[k];
        const base = baselineScoring && baselineScoring[k] != null ? Number(baselineScoring[k]) : null;
        if (base != null && base !== Number(v)) return k + ' ' + fmtNum(base) + ' → ' + fmtNum(v);
        if (k.indexOf('bonus_') === 0) return k + ' ' + (Number(v) >= 0 ? '+' : '') + fmtNum(v);
        return k + ' → ' + fmtNum(v);
    });

    const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Number(v) || 0).toFixed(1);

    // ── Shells (same idiom as season-odds-panel) ─────────────────────
    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );
    const rowLine = { borderBottom: `1px solid ${LINE}`, color: SILVER, fontSize: '0.75rem', ...mono };
    const shiftGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) 0.55fr 0.55fr 0.7fr', gap: '8px', alignItems: 'center', padding: '5px 10px', minWidth: 0 };
    const swingGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 0.9fr 0.9fr 0.7fr', gap: '8px', alignItems: 'center', padding: '5px 10px', minWidth: 0 };
    const nameCell = { fontFamily: 'var(--font-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

    // ── Per-league result block ──────────────────────────────────────
    const LeagueResult = ({ leagueName, result }) => {
        if (!result || result.empty) {
            return (
                <Section title={leagueName || 'League'} meta={result && result.seasonUsed ? String(result.seasonUsed) : null}>
                    <div style={{ color: SILVER, fontSize: '0.78rem', lineHeight: 1.5 }}>
                        {(result && result.reason) || 'No completed weeks to replay in this league.'}
                    </div>
                </Section>
            );
        }
        const shift = (result.standingsShift || []).filter(r => r.delta !== 0);
        const shiftShown = shift.slice(0, 8);
        const shiftHidden = shift.length - shiftShown.length;
        const unchangedCount = (result.standingsShift || []).length - shift.length;
        const field = result.playoffField || { in: [], out: [], unchanged: true };
        const seed = result.seedOneChanged;
        const tds = result.teamDeltas || [];
        const topTeams = tds.slice(0, Math.min(3, tds.length));
        const botTeams = tds.length > 3 ? tds.slice(Math.max(3, tds.length - 3)) : [];
        const pds = result.playerDeltas || [];
        const gainers = pds.filter(d => d.delta > 0).slice(0, 8);
        const losers = pds.filter(d => d.delta < 0).slice(0, 8);
        const note = result.proposerNote;

        const PlayerCol = ({ label, rows, color }) => (
            <div style={{ minWidth: 0 }}>
                <div style={{ ...microHdr, marginBottom: '4px' }}>{label}</div>
                {!rows.length ? (
                    <div style={{ color: MUTED, fontSize: '0.74rem' }}>none — no player moves this way</div>
                ) : rows.map(d => (
                    <div key={d.pid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 34px 62px', gap: '8px', alignItems: 'baseline', padding: '3px 0', borderBottom: `1px solid ${LINE}` }}>
                        <span style={{ ...nameCell, fontSize: '0.75rem', color: TEXT }}>{d.name}</span>
                        <span style={{ ...microHdr, textAlign: 'left' }}>{d.pos}</span>
                        <span style={{ ...mono, fontSize: '0.74rem', fontWeight: 700, textAlign: 'right', color }}>{signed(d.delta)}</span>
                    </div>
                ))}
            </div>
        );

        return (
            <Section title={leagueName || 'League'}
                meta={(result.seasonUsed ? result.seasonUsed + ' season · ' : '') + result.weeksCounted + ' week' + (result.weeksCounted === 1 ? '' : 's') + ' replayed'}>

                {/* Verdict card: the seed + the field, before any table */}
                <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${seed ? GOLD : LINE}`, borderRadius: '0 6px 6px 0', padding: '10px 12px', marginBottom: '12px' }}>
                    {seed ? (
                        <div style={{ ...mono, fontSize: '0.82rem', fontWeight: 700, color: GOLD }}>
                            #1 seed flips: {seed.from} → {seed.to}
                        </div>
                    ) : (
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: TEXT }}>No change at the top — the #1 seed holds.</div>
                    )}
                    <div style={{ marginTop: '6px', fontSize: '0.76rem', lineHeight: 1.6 }}>
                        {field.unchanged ? (
                            <span style={{ color: SILVER }}>Playoff field unchanged ({field.size}-team cut).</span>
                        ) : (
                            <React.Fragment>
                                <div>
                                    <span style={{ ...mono, fontSize: '0.68rem', fontWeight: 700, color: GREEN, marginRight: '8px' }}>IN</span>
                                    <span style={{ color: TEXT, ...mono }}>{(field.in || []).join(', ') || '—'}</span>
                                </div>
                                <div>
                                    <span style={{ ...mono, fontSize: '0.68rem', fontWeight: 700, color: RED, marginRight: '8px' }}>OUT</span>
                                    <span style={{ color: TEXT, ...mono }}>{(field.out || []).join(', ') || '—'}</span>
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                </div>

                {/* Standings shift — moved rows only */}
                <div style={{ ...microHdr, marginBottom: '6px' }}>Standings shift</div>
                {!shift.length ? (
                    <div style={{ color: SILVER, fontSize: '0.76rem', marginBottom: '10px' }}>Standings hold — no team changes rank under this proposal.</div>
                ) : (
                    <div style={{ overflowX: 'auto', marginBottom: '10px' }}>
                        <div style={{ minWidth: '380px' }}>
                            <div style={{ ...shiftGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                                <span>Team</span><span style={{ textAlign: 'right' }}>Was</span><span style={{ textAlign: 'right' }}>Now</span><span style={{ textAlign: 'right' }}>Δ</span>
                            </div>
                            {shiftShown.map(r => (
                                <div key={r.rosterId} style={{ ...shiftGrid, ...rowLine }}>
                                    <span style={nameCell}>{r.name}</span>
                                    <span style={{ textAlign: 'right' }}>{r.baselineRank}</span>
                                    <span style={{ textAlign: 'right', color: TEXT }}>{r.proposedRank}</span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: r.delta > 0 ? GREEN : RED }}>
                                        {r.delta > 0 ? '▲' : '▼'}{Math.abs(r.delta)}
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
                        <div style={{ overflowX: 'auto', marginBottom: '10px' }}>
                            <div style={{ minWidth: '400px' }}>
                                <div style={{ ...swingGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                                    <span>Team</span><span style={{ textAlign: 'right' }}>Current</span><span style={{ textAlign: 'right' }}>Proposed</span><span style={{ textAlign: 'right' }}>Δ pts</span>
                                </div>
                                {topTeams.concat(botTeams).map(t => (
                                    <div key={t.rosterId} style={{ ...swingGrid, ...rowLine }}>
                                        <span style={nameCell}>{t.name}</span>
                                        <span style={{ textAlign: 'right', opacity: 0.8 }}>{Number(t.baselinePts).toFixed(1)}</span>
                                        <span style={{ textAlign: 'right', color: TEXT }}>{Number(t.proposedPts).toFixed(1)}</span>
                                        <span style={{ textAlign: 'right', fontWeight: 700, color: TEXT }}>{signed(t.delta)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {tds.length > topTeams.length + botTeams.length ? (
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
                    <div style={{ color: SILVER, fontSize: '0.76rem', marginBottom: '10px' }}>No individual player moves under this proposal.</div>
                )}

                {/* Proposer disclosure — the conflict-of-interest line */}
                {note && note.line ? (
                    <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${AMBER}`, borderRadius: '0 6px 6px 0', padding: '10px 12px' }}>
                        <div style={{ ...microHdr, color: AMBER, marginBottom: '4px' }}>Disclosure</div>
                        <div style={{ fontSize: '0.78rem', color: TEXT, lineHeight: 1.5 }}>{note.line}</div>
                        <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>Attach this to the ballot when you put it to a vote.</div>
                    </div>
                ) : null}
            </Section>
        );
    };

    // ── Body by status ───────────────────────────────────────────────
    const resultRows = Array.isArray(results) ? results : [];
    let body = null;
    if (status === 'loading') {
        body = (
            <Section title="Replay">
                <div style={{ color: SILVER, fontSize: '0.78rem', ...mono }}>Replaying the {seasonUsed || 'last'} season…</div>
            </Section>
        );
    } else if (status === 'empty') {
        body = (
            <Section title="Replay">
                <div style={{ color: SILVER, fontSize: '0.78rem', lineHeight: 1.5 }}>No completed weeks to replay — the lab needs at least one finished week of box scores.</div>
            </Section>
        );
    } else if (status === 'error') {
        body = (
            <Section title="Replay">
                <div style={{ color: SILVER, fontSize: '0.78rem' }}>The replay could not be run — season stats or lineups failed to load.</div>
            </Section>
        );
    } else if (status === 'ready') {
        body = !resultRows.length ? (
            <Section title="Replay">
                <div style={{ color: SILVER, fontSize: '0.78rem' }}>No leagues to replay yet.</div>
            </Section>
        ) : (
            <React.Fragment>
                {resultRows.map((row, i) => (
                    <LeagueResult key={row.leagueId || row.leagueName || i} leagueName={row.leagueName} result={row.result} />
                ))}
            </React.Fragment>
        );
    } else {
        // idle — the bench is live, the replay hasn't been asked for yet
        body = (
            <Section title="Replay">
                <div style={{ color: SILVER, fontSize: '0.78rem', lineHeight: 1.5 }}>Stage a proposal above and the lab replays the season under it — current rules vs proposed, same lineups, same stat lines.</div>
            </Section>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Section title="Proposal Bench" meta="chips compose — stack a PPR change with a TE premium">
                {!presetList.length ? (
                    <div style={{ color: SILVER, fontSize: '0.78rem' }}>No proposal presets available — the Rule Lab engine has not loaded.</div>
                ) : (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        {presetList.map(p => {
                            const on = isActive(p);
                            return (
                                <button key={p.key} onClick={() => toggle(p)}
                                    style={{
                                        padding: '6px 11px', cursor: 'pointer', borderRadius: '5px',
                                        font: '600 0.7rem ' + MONO, letterSpacing: '0.03em',
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
                        <span style={{ ...mono, fontSize: '0.76rem', color: TEXT }}>{summaryBits.join(' · ')}</span>
                    ) : (
                        <span style={{ ...mono, fontSize: '0.76rem', color: MUTED }}>no changes staged — current rules</span>
                    )}
                    {propKeys.length ? (
                        <button onClick={() => { if (typeof onProposalChange === 'function') onProposalChange({}); }}
                            style={{ padding: '4px 10px', background: 'transparent', color: SILVER, border: `1px solid ${LINE}`, borderRadius: '5px', font: '700 0.62rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>
                            Clear
                        </button>
                    ) : null}
                </div>
            </Section>

            {body}

            <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5, padding: '0 2px' }}>
                Both runs use identical as-played lineups rescored from raw stat lines — the diff is the rule change and nothing else. Playoffs were real games: we re-cut the field and seeds, we never re-crown a champion.
            </div>
        </div>
    );
}

window.WrCommishRuleLabPanel = WrCommishRuleLabPanel;
