// ══════════════════════════════════════════════════════════════════
// js/components/commish-governance-panel.js — window.WrCommishGovernancePanel
// The Bylaws & Dues wall (owner ask 2026-08-01: "helping run leagues from a
// bylaws standpoint... integrate with google drive or leaguesafe to keep
// track of dues").
//
// Two desks per commissioned league:
//   BYLAWS — the constitution as a living document: clause-parsed view,
//   question → ruling card grounded ONLY in quoted clauses (App.Commish.
//   Bylaws.buildRulingContext + AlexVoice.enhance one-shot; the instruction
//   block forbids invented rules), and the amendment ledger (acknowledged
//   Drift changes become constitutional history).
//   TREASURY — dues BOOKKEEPING only. DHQ never handles, collects, or moves
//   money: LeagueSafe (linked per league) stays the system of record; the
//   ledger tracks who the commissioner has marked paid. Import paths:
//   published-Google-Sheet CSV URL (zero OAuth) with paste-CSV as the
//   always-works fallback.
//
// Props: { leagues, graph, constitutions: {leagueId: {text, clauses}|null},
//          amendments: {leagueId: rows}, treasuries: {leagueId: buildTreasury
//          output}, onMarkPaid(lid, uid, paid), onSetLeagueSafe(lid, url) →
//          bool, onSetSheet(lid, url) → bool, onFetchSheet(lid) → Promise,
//          onPasteCsv(lid, text) → {applied, unmatched}|null, onAsk(lid,
//          question) → Promise<string|null> }
// ══════════════════════════════════════════════════════════════════
function WrCommishGovernancePanel({ leagues, graph, constitutions, amendments, treasuries, onMarkPaid, onSetLeagueSafe, onSetSheet, onFetchSheet, onPasteCsv, onAsk }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--warn, #F0A500)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: 'var(--text-muted, #8D887E)', letterSpacing: '0.08em', textTransform: 'uppercase' };

    const [openLid, setOpenLid] = React.useState(null);
    const [question, setQuestion] = React.useState('');
    const [ruling, setRuling] = React.useState({});      // lid -> {loading}|{text}|{err}
    const [urlDrafts, setUrlDrafts] = React.useState({}); // lid -> {ls, sheet}
    const [csvDraft, setCsvDraft] = React.useState('');
    const [csvNote, setCsvNote] = React.useState({});     // lid -> result line
    const [sheetBusy, setSheetBusy] = React.useState(null);

    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );
    const btn = (label, onClick, opts) => (
        <button onClick={onClick} disabled={opts && opts.disabled}
            style={{ padding: '5px 12px', cursor: 'pointer', background: 'transparent', color: (opts && opts.color) || GOLD, border: '1px solid ' + ((opts && opts.color) || 'rgba(212,175,55,0.5)'), borderRadius: 'var(--card-radius-xs, 5px)', font: '700 0.66rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: opts && opts.disabled ? 0.5 : 1 }}>
            {label}
        </button>
    );

    const askRuling = async (lid) => {
        if (!question.trim() || typeof onAsk !== 'function') return;
        setRuling(r => ({ ...r, [lid]: { loading: true } }));
        const text = await onAsk(lid, question.trim());
        setRuling(r => ({ ...r, [lid]: text ? { text } : { err: true } }));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Section title="Bylaws & Dues" meta="constitutions as living documents · dues bookkeeping — LeagueSafe stays the system of record; DHQ never touches money">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {(leagues || []).map(l => {
                        const lid = String(l.league_id || l.id);
                        const con = constitutions ? constitutions[lid] : null;
                        const tre = treasuries ? treasuries[lid] : null;
                        const amd = (amendments && amendments[lid]) || [];
                        const open = openLid === lid;
                        const draft = urlDrafts[lid] || {};
                        const rul = ruling[lid];
                        return (
                            <div key={lid} style={{ border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)' }}>
                                <div onClick={() => setOpenLid(open ? null : lid)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}>
                                    <span style={{ color: TEXT, fontWeight: 700, fontSize: '0.85rem' }}>{l.name}</span>
                                    <span style={{ ...microHdr, color: con && con.clauses.length ? GREEN : AMBER }}>
                                        {con && con.clauses.length ? con.clauses.length + ' clauses on file' : 'no constitution on file'}
                                    </span>
                                    {tre ? <span style={{ ...microHdr }}>dues {tre.summary.paid}/{tre.summary.total}</span> : null}
                                    <span style={{ marginLeft: 'auto', color: TEXT }}>{open ? '▾' : '▸'}</span>
                                </div>
                                {open ? (
                                    <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

                                        {/* ── BYLAWS DESK ── */}
                                        <div>
                                            <div style={{ ...microHdr, marginBottom: '6px' }}>Bylaws desk</div>
                                            {!con || !con.clauses.length ? (
                                                <div style={{ color: TEXT, fontSize: '0.78rem', lineHeight: 1.5 }}>
                                                    Upload this league's constitution under Settings → League documents and the desk lights up: clause search, grounded rulings, amendment history.
                                                </div>
                                            ) : (
                                                <React.Fragment>
                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                        <input value={question} onChange={e => setQuestion(e.target.value)}
                                                            placeholder="Ask the constitution — 'can a team trade next year's FAAB?'"
                                                            style={{ flex: 1, minWidth: '220px', background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '8px 10px', fontSize: '16px', fontFamily: 'var(--font-body)' }} />
                                                        {btn(rul && rul.loading ? 'Consulting…' : 'Ruling', () => askRuling(lid), { disabled: rul && rul.loading })}
                                                    </div>
                                                    {rul && rul.text ? (
                                                        <div style={{ marginTop: '8px', background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 6px 6px 0', padding: '10px 12px' }}>
                                                            <div style={{ ...microHdr, color: GOLD, marginBottom: '4px' }}>Ruling — grounded in the constitution</div>
                                                            <div style={{ fontSize: '0.8rem', color: '#C9C9D2', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{rul.text}</div>
                                                            <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '6px' }}>Answers only from quoted clauses — when the constitution is silent, the ruling says so.</div>
                                                        </div>
                                                    ) : rul && rul.err ? <div style={{ marginTop: '8px', color: TEXT, fontSize: '0.76rem' }}>No ruling available — AI is Pro-gated or the call failed.</div> : null}
                                                    {amd.length ? (
                                                        <div style={{ marginTop: '10px' }}>
                                                            <div style={{ ...microHdr, marginBottom: '4px' }}>Amendment ledger</div>
                                                            {amd.slice(0, 5).map((a, i) => (
                                                                <div key={i} style={{ ...mono, fontSize: '0.72rem', color: TEXT, padding: '2px 0' }}>
                                                                    {new Date(a.ts).toLocaleDateString()} · <span style={{ color: TEXT }}>{a.path}</span> <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{String(a.from)}</span> → <span style={{ color: GOLD }}>{String(a.to)}</span> <span style={{ opacity: 0.6 }}>({a.source})</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '8px' }}>No amendments recorded yet — acknowledged Drift changes land here as constitutional history.</div>}
                                                </React.Fragment>
                                            )}
                                        </div>

                                        {/* ── TREASURY DESK ── */}
                                        <div>
                                            <div style={{ ...microHdr, marginBottom: '6px' }}>Treasury — dues bookkeeping</div>
                                            {tre ? (
                                                <React.Fragment>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                                        <span style={{ ...mono, fontSize: '1.1rem', fontWeight: 700, color: tre.summary.pct === 100 ? GREEN : tre.summary.pct >= 50 ? GOLD : AMBER }}>{tre.summary.paid}/{tre.summary.total} paid</span>
                                                        {tre.leagueSafeUrl
                                                            ? <a href={tre.leagueSafeUrl} target="_blank" rel="noopener noreferrer" style={{ ...microHdr, color: 'var(--info, #5DADE2)', textDecoration: 'none', border: '1px solid rgba(93,173,226,0.4)', borderRadius: 'var(--card-radius-xs, 5px)', padding: '3px 8px' }}>Open LeagueSafe ↗</a>
                                                            : null}
                                                    </div>
                                                    <div style={{ maxHeight: '220px', overflowY: 'auto', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)' }}>
                                                        {tre.rows.map(r => (
                                                            <label key={r.userId} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0,1fr) auto', gap: '10px', alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid rgba(255,255,255,0.04)`, cursor: 'pointer' }}>
                                                                <input type="checkbox" checked={!!r.paid} onChange={() => onMarkPaid && onMarkPaid(lid, r.userId, !r.paid)} />
                                                                <span style={{ color: r.paid ? SILVER : TEXT, fontWeight: r.paid ? 400 : 600, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                                                                <span style={{ ...microHdr, color: r.paid ? GREEN : AMBER }}>{r.paid ? 'PAID' : 'UNPAID'}</span>
                                                            </label>
                                                        ))}
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' }}>
                                                        <input value={draft.ls != null ? draft.ls : (tre.leagueSafeUrl || '')} onChange={e => setUrlDrafts(d => ({ ...d, [lid]: { ...d[lid], ls: e.target.value } }))}
                                                            placeholder="https://www.leaguesafe.com/… (this league's page)"
                                                            style={{ flex: 1, minWidth: '200px', background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '7px 10px', fontSize: '16px', fontFamily: MONO }} />
                                                        {btn('Save link', () => { const ok = onSetLeagueSafe && onSetLeagueSafe(lid, draft.ls || ''); setCsvNote(n => ({ ...n, [lid]: ok ? 'LeagueSafe link saved.' : 'Rejected — must be an https leaguesafe.com URL.' })); })}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                                                        <input value={draft.sheet != null ? draft.sheet : (tre.sheetUrl || '')} onChange={e => setUrlDrafts(d => ({ ...d, [lid]: { ...d[lid], sheet: e.target.value } }))}
                                                            placeholder="Published Google Sheet CSV URL (File → Share → Publish to web)"
                                                            style={{ flex: 1, minWidth: '200px', background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '7px 10px', fontSize: '16px', fontFamily: MONO }} />
                                                        {btn('Save', () => { const ok = onSetSheet && onSetSheet(lid, draft.sheet || ''); setCsvNote(n => ({ ...n, [lid]: ok ? 'Sheet link saved.' : 'Rejected — must be an https docs.google.com URL.' })); })}
                                                        {btn(sheetBusy === lid ? 'Fetching…' : 'Sync from sheet', async () => {
                                                            if (!onFetchSheet) return;
                                                            setSheetBusy(lid);
                                                            const res = await onFetchSheet(lid);
                                                            setSheetBusy(null);
                                                            setCsvNote(n => ({ ...n, [lid]: res ? ('Synced — ' + res.applied + ' marked' + (res.unmatched.length ? ' · unmatched: ' + res.unmatched.slice(0, 3).join(', ') : '')) : 'Sheet fetch failed (browser blocked it?) — paste the CSV below instead.' }));
                                                        }, { disabled: !tre.sheetUrl || sheetBusy === lid })}
                                                    </div>
                                                    <textarea value={csvDraft} onChange={e => setCsvDraft(e.target.value)}
                                                        placeholder="…or paste dues CSV here (name, paid) — always works, no publishing needed"
                                                        style={{ width: '100%', minHeight: '54px', marginTop: '8px', background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, padding: '8px 10px', fontSize: '16px', fontFamily: MONO }} />
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
                                                        {btn('Apply pasted CSV', () => {
                                                            const res = onPasteCsv && onPasteCsv(lid, csvDraft);
                                                            setCsvNote(n => ({ ...n, [lid]: res ? ('Applied — ' + res.applied + ' marked' + (res.unmatched.length ? ' · unmatched: ' + res.unmatched.slice(0, 3).join(', ') : '')) : 'Nothing matched — check the name column against Sleeper display names.' }));
                                                        }, { disabled: !csvDraft.trim() })}
                                                        {csvNote[lid] ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{csvNote[lid]}</span> : null}
                                                    </div>
                                                </React.Fragment>
                                            ) : <div style={{ color: TEXT, fontSize: '0.78rem' }}>Treasury unavailable for this league.</div>}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </Section>
        </div>
    );
}

window.WrCommishGovernancePanel = WrCommishGovernancePanel;
