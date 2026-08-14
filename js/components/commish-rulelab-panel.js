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
function WrCommishRuleLabPanel({
    status, seasonUsed, seasons, onSeason,
    leagues, selectedLeagueId, onSelectLeague,
    proposal, onProposalChange, rosterProposal, onRosterProposalChange,
    results, presets, baselineScoring, editorKeys: editorKeysProp, currentSlotsByLeague,
    sweepResult, onSweep, sweepBusy,
    saved, onSaveProposal, onLoadProposal, onDeleteProposal, onRatify,
    onCopyBallot, onExportBallot,
}) {
    // CO_* token ladder from the office shell — NOT the app-level --panel /
    // --text / --k-* names, which are undefined and fall back to the exact
    // figure/ground failure the office redesign fixed. Muted is a literal:
    // --text-muted resolves identical to --silver in this app.
    const GOLD = 'var(--gold, #D4AF37)', SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
    const GREEN = 'var(--good, #2ECC71)', RED = 'var(--bad, #E74C3C)';
    const AMBER = 'var(--warn, #F0A500)', ACCENT = 'var(--co-accent, #5DADE2)';
    const PANEL = 'var(--co-surface, #121217)', LINE = 'var(--co-line, #27262E)';
    const SURF2 = 'var(--co-surface-2, #1B1B22)', WELL = 'var(--co-well, #0F0F14)';
    const ACC_FILL = 'var(--co-accent-fill, #12212B)', ACC_LINE = 'var(--co-accent-line, #2B4B63)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const MUTED = '#8D887E';
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

    // ── Full scoring editor state ────────────────────────────────────
    const [saveName, setSaveName] = React.useState('');
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
    const keyLabel = k => KEY_LABELS[k] || k;
    const multiSeasonOk = (seasons || []).filter(s => s.available).length > 1;
    const setKey = (k, raw) => {
        if (typeof onProposalChange !== 'function') return;
        const next = Object.assign({}, prop);
        const v = raw === '' || raw == null ? NaN : Number(raw);
        // Typing the league's own current value clears the override ("back to
        // baseline") — but ONLY when we actually know this league's baseline.
        // In omnibus there is no single "from", and an equality test there
        // would silently drop a real override that happens to equal some
        // OTHER league's value. That was live: the editor was fed league #1's
        // scoring for every league.
        const baseVal = baselineScoring && baselineScoring[k] != null ? Number(baselineScoring[k]) : null;
        if (Number.isNaN(v) || (baseVal != null && v === baseVal)) delete next[k]; else next[k] = v;
        onProposalChange(next);
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
            <div id={'wr-rulelab-ballot-' + String(leagueName || 'league').replace(/\W+/g, '-').toLowerCase()}>
            <Section title={leagueName || 'League'}
                meta={(result.seasonUsed ? result.seasonUsed + ' season · ' : '') + result.weeksCounted + ' week' + (result.weeksCounted === 1 ? '' : 's') + ' replayed'
                    + (result.methodology === 'best_lineup' ? ' · BEST-LINEUP REPLAY' : ' · as-played')}>

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

                {/* Position relevance — the league's shape before and after */}
                {(result.positionShare || []).filter(p => Math.abs(p.deltaPct) >= 0.3).length ? (
                    <React.Fragment>
                        <div style={{ ...microHdr, marginBottom: '6px' }}>Position relevance · share of all started points</div>
                        <div style={{ marginBottom: '10px' }}>
                            {(result.positionShare || []).filter(p => Math.abs(p.deltaPct) >= 0.3).slice(0, 5).map(p => (
                                <div key={p.pos} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 130px', gap: '10px', alignItems: 'center', padding: '4px 0' }}>
                                    <span style={{ ...microHdr }}>{p.pos}</span>
                                    <div style={{ position: 'relative', height: '6px', background: SURF2, borderRadius: '3px', overflow: 'hidden' }}>
                                        <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: Math.min(100, p.basePct * 2.5) + '%', background: LINE }} />
                                        <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: Math.min(100, p.propPct * 2.5) + '%', background: p.deltaPct >= 0 ? ACCENT : RED, opacity: 1, height: '2px', marginTop: '2px' }} />
                                    </div>
                                    <span style={{ ...mono, fontSize: '0.72rem', textAlign: 'right', color: TEXT }}>
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

                {/* Proposer disclosure — the conflict-of-interest line */}
                {note && note.line ? (
                    <div style={{ background: WELL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${AMBER}`, borderRadius: '0 6px 6px 0', padding: '10px 12px', marginBottom: '10px' }}>
                        <div style={{ ...microHdr, color: AMBER, marginBottom: '4px' }}>Disclosure</div>
                        <div style={{ fontSize: '0.78rem', color: TEXT, lineHeight: 1.5 }}>{note.line}</div>
                        <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>Attach this to the ballot when you put it to a vote.</div>
                    </div>
                ) : null}

                {/* The ballot: this league's impact statement, ready to circulate */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {typeof onCopyBallot === 'function' ? (
                        <button onClick={() => onCopyBallot(leagueName, result)}
                            style={{ padding: '7px 12px', cursor: 'pointer', background: ACC_FILL, border: `1px solid ${ACC_LINE}`, borderRadius: '6px', color: ACCENT, font: '700 0.625rem ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            Copy ballot text
                        </button>
                    ) : null}
                    {typeof onExportBallot === 'function' ? (
                        <button onClick={() => onExportBallot(leagueName, result)}
                            style={{ padding: '7px 12px', cursor: 'pointer', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '6px', color: SILVER, font: '700 0.625rem ' + MONO, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            Export PNG
                        </button>
                    ) : null}
                </div>
            </Section>
            </div>
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

    const chipBtn = (on, extra) => ({
        padding: '6px 11px', cursor: 'pointer', borderRadius: '5px',
        font: '600 0.7rem ' + MONO, letterSpacing: '0.03em',
        background: on ? ACC_FILL : 'transparent',
        color: on ? ACCENT : SILVER,
        border: '1px solid ' + (on ? ACC_LINE : LINE),
        ...(extra || {}),
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* League scope — you amend ONE constitution at a time. Scoping is
                also what makes the full editor truthful: only a single league
                has a real "from" value and a real key set. */}
            {(leagues || []).length > 1 ? (
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
                <div style={{ background: 'var(--co-fill-warn, #2A2010)', border: `1px solid ${LINE}`, borderRadius: '6px', padding: '8px 11px', fontSize: '0.74rem', color: TEXT, lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
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

            {/* ── Roster Bench: structure proposals ─────────────────────── */}
            <Section title="Roster Bench" meta="starting-slot changes — superflex, extra flex, the works">
                {currentStructures.length ? (
                    <div style={{ marginBottom: '10px' }}>
                        {currentStructures.map((cs, i) => (
                            <div key={i} style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginBottom: '2px' }}>
                                <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{cs.leagues.join(', ')}</span>
                                {' today: '}<span style={{ ...mono, color: SILVER }}>{cs.slots.join(' · ')}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: rp ? '10px' : 0 }}>
                    <span style={{ ...microHdr }}>Proposed structure</span>
                    {!rp ? (
                        <React.Fragment>
                            <span style={{ fontSize: '0.75rem', color: MUTED, fontFamily: 'var(--font-body)' }}>none — click a slot to start from the first league's current structure</span>
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
                                style={{ padding: '4px 10px', background: 'transparent', color: SILVER, border: `1px solid ${LINE}`, borderRadius: '5px', font: '700 0.62rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>Clear</button>
                        </React.Fragment>
                    )}
                </div>
                {rp ? (
                    <div style={{ background: ACC_FILL, border: `1px solid ${ACC_LINE}`, borderRadius: '6px', padding: '9px 12px', fontSize: '0.76rem', color: TEXT, lineHeight: 1.55, fontFamily: 'var(--font-body)' }}>
                        Structure change staged → the replay switches to <b>best-lineup mode</b>: both runs refield every roster's optimal lineup from the players they actually had, because as-played starters can't sit in slots that didn't exist. The diff still isolates the rule change.
                    </div>
                ) : null}
            </Section>

            {/* ── The Wind Tunnel: threshold sweep ──────────────────────── */}
            <Section title="Wind Tunnel" meta="set any number of stats at once, or sweep one to find where the league flips">
                {/* Dial in exact numbers — every stat this league tracks,
                    plus the full catalog for every position this app knows
                    how to score (so a rule the league has never turned on
                    is still stageable), grouped by category with the
                    current value as the placeholder. Set as many at once as
                    you want — each one stages straight into the proposal,
                    and the replay below updates immediately. */}
                <div style={{ marginBottom: '14px' }}>
                    {groupKeys(editorKeys).map(g => (
                        <div key={g.name} style={{ marginBottom: '12px' }}>
                            <div style={{ ...microHdr, marginBottom: '6px' }}>{g.name}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '8px 16px' }}>
                                {g.keys.map(k => {
                                    // No baseline (omnibus) → no placeholder. Showing "0.0"
                                    // there would assert the league scores this rule at zero.
                                    const cur = baselineScoring && baselineScoring[k] != null ? Number(baselineScoring[k]) : null;
                                    const overridden = Object.prototype.hasOwnProperty.call(prop, k);
                                    return (
                                        <label key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 74px', gap: '8px', alignItems: 'center' }}>
                                            <span title={k} style={{ fontSize: '0.72rem', color: overridden ? TEXT : SILVER, fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {KEY_LABELS[k] || k}
                                            </span>
                                            <input type="number" step="0.05" inputMode="decimal"
                                                value={overridden ? prop[k] : ''}
                                                placeholder={cur == null ? '—' : fmtNum(cur)}
                                                onChange={e => setKey(k, e.target.value)}
                                                style={{ width: '100%', background: overridden ? ACC_FILL : 'var(--co-page, #08080B)', border: '1px solid ' + (overridden ? ACC_LINE : LINE), borderRadius: '5px', color: overridden ? TEXT : SILVER, padding: '5px 8px', fontSize: '16px', ...mono, textAlign: 'right' }} />
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5 }}>
                        {baselineScoring
                            ? 'Placeholders show this league\u2019s current rule \u2014 every position\u2019s full stat catalog is listed, not just what\u2019s already turned on. Type a number to stage it; blank the field \u2014 or retype the current value \u2014 to drop the override.'
                            : 'No single current rule across leagues, so fields show \u201C\u2014\u201D. Blank a field to drop the override.'}
                    </div>
                </div>

                <div style={{ ...microHdr, marginBottom: '8px', paddingTop: '12px', borderTop: `1px solid ${LINE}` }}>Or find the exact threshold for one stat</div>
                {/* Any-key picker: every rule the editor knows is sweepable. */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select value={swKey} onChange={e => setSwKey(e.target.value)} disabled={!!sweepBusy}
                        style={{ background: 'var(--co-page, #08080B)', border: `1px solid ${LINE}`, borderRadius: '5px', color: TEXT, padding: '7px 8px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', maxWidth: '240px' }}>
                        {groupKeys(editorKeys).map(g => (
                            <optgroup key={g.name} label={g.name}>
                                {g.keys.map(k => <option key={k} value={k}>{KEY_LABELS[k] || k}</option>)}
                            </optgroup>
                        ))}
                    </select>
                    <button disabled={!!sweepBusy} onClick={() => onSweep && onSweep(swKey, null, { allSeasons: swAll })} style={chipBtn(true, sweepBusy ? { opacity: 0.5 } : null)}>
                        {sweepBusy ? 'Sweeping…' : 'Sweep it'}
                    </button>
                    {multiSeasonOk ? (
                        <button onClick={() => setSwAll(!swAll)} disabled={!!sweepBusy}
                            title="Replay the sweep through every season the chain reaches — a threshold that holds across seasons is close to unarguable."
                            style={chipBtn(swAll, sweepBusy ? { opacity: 0.5 } : null)}>
                            {swAll ? '✓ ' : ''}Every season
                        </button>
                    ) : null}
                </div>
                {/* The three classic arguments stay one click away. */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                    <span style={{ ...microHdr }}>Quick:</span>
                    {[['rec', 'PPR 0 → 1.5', [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]],
                      ['bonus_rec_te', 'TE premium 0 → 1.5', [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]],
                      ['pass_td', 'Pass TD 4 → 6', [4, 5, 6]]].map(([key, label, values]) => (
                        <button key={key} disabled={!!sweepBusy} onClick={() => onSweep && onSweep(key, values, { allSeasons: swAll })}
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
                                                <th key={r.value} style={{ ...mono, fontSize: '0.72rem', fontWeight: 700, color: r.isCurrent ? ACCENT : SILVER, padding: '3px 7px', textAlign: 'center', borderBottom: `1px solid ${LINE}` }}>
                                                    {r.value}{r.isCurrent ? '•' : ''}
                                                </th>
                                            ))}
                                        </tr></thead>
                                        <tbody>
                                            {pl.seasons.map(season => (
                                                <tr key={season}>
                                                    <td style={{ ...mono, fontSize: '0.72rem', color: SILVER, padding: '4px 10px 4px 0' }}>{season}</td>
                                                    {pl.rows.map(r => {
                                                        const cell = r.bySeason[season];
                                                        const bg = cell === 'SEED' ? 'var(--co-fill-bad, #2A1512)' : cell === 'FIELD' ? 'var(--co-fill-warn, #2A2010)' : cell && cell !== 'HOLD' ? SURF2 : 'transparent';
                                                        const fg = cell === 'SEED' ? RED : cell === 'FIELD' ? AMBER : cell && cell !== 'HOLD' ? TEXT : MUTED;
                                                        return <td key={r.value} style={{ ...microHdr, fontSize: '0.575rem', color: fg, background: bg, padding: '5px 7px', textAlign: 'center', border: `1px solid var(--co-line-soft, #201F27)` }}>{cell || '—'}</td>;
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '5px' }}>
                                    {pl.consensus != null ? (
                                        <span>Moves <b style={{ color: TEXT }}>every replayed season</b> from <span style={{ ...mono, color: ACCENT, fontWeight: 700 }}>{pl.consensus}</span> — held in {pl.heldIn} of {pl.of} season{pl.of === 1 ? '' : 's'}. Close to unarguable.</span>
                                    ) : pl.heldIn > 0 ? (
                                        <span>Movement in {pl.heldIn} of {pl.of} seasons (earliest at <span style={{ ...mono, color: TEXT, fontWeight: 700 }}>{pl.minFlip}</span>) — no value in range moves them all, so the case rests on one year.</span>
                                    ) : (
                                        <span>No value in this range moves this league in any replayed season.</span>
                                    )}
                                    {pl.noData && pl.noData.length ? <span style={{ color: MUTED }}> · no data: {pl.noData.join(', ')}</span> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : sweepResult && sweepResult.perLeague && sweepResult.perLeague.length ? (
                    <div style={{ marginTop: '12px' }}>
                        {sweepResult.perLeague.map(pl => (
                            <div key={pl.leagueName} style={{ marginBottom: '10px' }}>
                                <div style={{ ...microHdr, marginBottom: '4px' }}>{pl.leagueName}</div>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {pl.steps.filter(s => !s.empty).map(s => (
                                        <div key={s.value} title={s.seedFlips ? '#1 seed flips to ' + s.seedTo : (s.ranksMoved + ' ranks move · ' + s.fieldMoves + ' field changes')}
                                            style={{ minWidth: '58px', textAlign: 'center', padding: '6px 4px', borderRadius: '5px', border: '1px solid ' + (s.isCurrent ? ACC_LINE : LINE), background: s.seedFlips ? 'var(--co-fill-bad, #2A1512)' : s.fieldMoves > 0 ? 'var(--co-fill-warn, #2A2010)' : s.ranksMoved > 0 ? SURF2 : 'transparent' }}>
                                            <div style={{ ...mono, fontSize: '0.78rem', fontWeight: 700, color: s.seedFlips ? RED : s.fieldMoves > 0 ? AMBER : s.ranksMoved > 0 ? TEXT : MUTED }}>{s.value}</div>
                                            <div style={{ ...microHdr, fontSize: '0.575rem' }}>{s.isCurrent ? 'NOW' : s.seedFlips ? 'SEED' : s.fieldMoves > 0 ? 'FIELD' : s.ranksMoved > 0 ? s.ranksMoved + ' MV' : 'HOLD'}</div>
                                        </div>
                                    ))}
                                </div>
                                {pl.firstFlipAt != null ? (
                                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>
                                        First movement at <span style={{ ...mono, color: TEXT, fontWeight: 700 }}>{pl.firstFlipAt}</span> — below that, this rule change is cosmetic here.
                                    </div>
                                ) : <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '4px' }}>No value in this range moves this league at all.</div>}
                            </div>
                        ))}
                    </div>
                ) : null}
            </Section>

            {/* ── Saved proposals ───────────────────────────────────────── */}
            <Section title="Saved Proposals" meta="name it, bring it back, ratify it into the amendment ledger">
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: (saved || []).length ? '10px' : 0 }}>
                    <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Name this proposal — 'TE premium 2027'"
                        style={{ flex: 1, minWidth: '200px', background: 'var(--co-page, #08080B)', border: `1px solid ${LINE}`, borderRadius: '5px', color: TEXT, padding: '7px 10px', fontSize: '16px', fontFamily: 'var(--font-body)' }} />
                    <button disabled={!saveName.trim() || (!propKeys.length && !rp)}
                        onClick={() => { if (onSaveProposal) onSaveProposal(saveName.trim()); setSaveName(''); }}
                        style={chipBtn(true, (!saveName.trim() || (!propKeys.length && !rp)) ? { opacity: 0.45, cursor: 'default' } : null)}>
                        Save
                    </button>
                </div>
                {(saved || []).map(sp => (
                    <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: `1px solid var(--co-line-soft, #201F27)`, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.8rem', color: sp.status === 'ratified' ? MUTED : TEXT }}>{sp.name}</span>
                        <span style={{ ...microHdr }}>{Object.keys(sp.overrides || {}).length} rule{Object.keys(sp.overrides || {}).length === 1 ? '' : 's'}{sp.rosterProposal ? ' + structure' : ''}</span>
                        {sp.status === 'ratified' ? <span style={{ ...microHdr, color: GREEN }}>RATIFIED</span> : null}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                            <button onClick={() => onLoadProposal && onLoadProposal(sp.id)} style={chipBtn(false)}>Load</button>
                            {sp.status !== 'ratified' && onRatify ? (
                                <button title="Records every override into each league's amendment ledger — the constitution history the Bylaws desk shows."
                                    onClick={() => onRatify(sp.id)} style={chipBtn(false, { color: GREEN, borderColor: 'rgba(46,204,113,0.4)' })}>Ratify</button>
                            ) : null}
                            <button onClick={() => onDeleteProposal && onDeleteProposal(sp.id)} style={chipBtn(false, { color: MUTED })}>✕</button>
                        </span>
                    </div>
                ))}
            </Section>

            {body}

            <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5, padding: '0 2px' }}>
                {rp
                    ? 'Structure mode: both runs refield each roster’s optimal lineup from identical player pools — the diff isolates the rule change without crediting anyone with lineup skill. '
                    : 'Both runs use identical as-played lineups rescored from raw stat lines — the diff is the rule change and nothing else. '}
                Playoffs were real games: we re-cut the field and seeds, we never re-crown a champion.
            </div>
        </div>
    );
}

window.WrCommishRuleLabPanel = WrCommishRuleLabPanel;
