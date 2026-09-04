// ══════════════════════════════════════════════════════════════════
// js/components/commish-people-panel.js — window.WrCommishPeoplePanel
// The Commissioner's Office PEOPLE view: member radar ("The Dave Alarm"),
// open seats + recruit bench, and the Day One onboarding folder.
//
//   <WrCommishPeoplePanel radar seats benches prospectuses folders onCopy />
//
// Pure presentation — every prop is a finished engine output, no fetching:
//   radar         App.Commish.Radar.buildRadar()   → { people: [...] worst-first }
//   seats         member graph .seats              → [{ leagueId, leagueName, rosterId, reason }]
//   benches       App.Commish.Bench.candidatesForSeat() per seat (parallel to seats)
//   prospectuses  App.Commish.Bench.buildProspectus() per seat (parallel to seats)
//   folders       App.Commish.Bench.buildDayOneFolder() array, one per open
//                 seat, drafted for that seat's TOP shortlist candidate.
//                 Sleeper has no "recruit accepted" signal to gate on, so
//                 each folder is labelled a draft and names who it was
//                 written for rather than reading as a done deal.
//   onCopy(text)  clipboard fallback — navigator.clipboard is undefined on
//                 non-HTTPS/older WebViews, so the host app owns plan B
// ══════════════════════════════════════════════════════════════════
function WrCommishPeoplePanel({ radar, seats, benches, prospectuses, folders, onCopy }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--k-f0a500, #f0a500)';
    const MUTED = 'var(--text-muted, #8D887E)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };

    // Transient "Copied" flash per button; keyed so two buttons never share it.
    const [copiedKey, setCopiedKey] = React.useState(null);
    const copyTimer = React.useRef(null);
    React.useEffect(() => () => clearTimeout(copyTimer.current), []);
    const doCopy = (key, text) => {
        const fallback = () => { try { if (typeof onCopy === 'function') onCopy(text); } catch (_) { /* no clipboard, no handler — nothing left to try */ } };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
            else fallback();
        } catch (_) { fallback(); }
        setCopiedKey(key);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500);
    };

    // ── Shells ───────────────────────────────────────────────────────
    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: TEXT, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );
    const CopyBtn = ({ k, text, label }) => (
        <button onClick={() => doCopy(k, text)}
            style={{ padding: '4px 10px', background: 'transparent', color: GOLD, border: '1px solid rgba(212,175,55,0.5)', borderRadius: 'var(--card-radius-xs, 5px)', font: '700 0.62rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start' }}>
            {copiedKey === k ? 'Copied' : (label || 'Copy')}
        </button>
    );
    // Drafted-message block: same left-gold quote idiom as Alex reads elsewhere.
    const Quote = ({ children }) => (
        <div style={{ flex: 1, minWidth: 0, background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 6px 6px 0', padding: '8px 11px', fontStyle: 'italic', fontSize: '0.78rem', color: '#C9C9D2', lineHeight: 1.5 }}>
            {children}
        </div>
    );

    // ── The Dave Alarm ───────────────────────────────────────────────
    const people = Array.isArray(radar?.people) ? radar.people : null; // engine ships worst-first — trust its sort
    const darkCount = people ? people.filter(p => p.status === 'DARK_ALL' || p.status === 'DARK_ONE').length : 0;

    // The classification chip is THIS panel's one decision column — the only
    // place semantic color is allowed. Everything around it stays monochrome.
    const chipFor = (p) => {
        if (p.status === 'DARK_ALL') return { label: 'DARK — ALL LEAGUES', color: RED, border: 'rgba(231,76,60,0.45)' };
        if (p.status === 'DARK_ONE') {
            const dark = (p.teams || []).find(t => t.status === 'DARK');
            return { label: 'DARK — ' + (dark ? dark.leagueName : 'ONE LEAGUE'), color: AMBER, border: 'rgba(240,165,0,0.45)' };
        }
        if (p.status === 'FADING') return { label: 'FADING', color: TEXT, border: LINE };
        return { label: p.status || 'ACTIVE', color: MUTED, border: LINE };
    };
    const dotColor = s => s === 'DARK' ? RED : s === 'WATCH' ? AMBER : MUTED;
    const sigTitle = (t) => {
        const sg = t.signals || {};
        const bits = [t.leagueName + ': ' + t.status + (t.inSeason ? '' : ' (offseason thresholds)')];
        bits.push(sg.daysSinceTxn == null ? 'no transactions on record' : sg.daysSinceTxn + 'd since last move');
        if (sg.outStarters) bits.push(sg.outStarters + ' OUT in lineup');
        if (sg.byeStarters) bits.push(sg.byeStarters + ' starter(s) on bye');
        if (sg.emptySlots) bits.push(sg.emptySlots + ' empty slot(s)');
        return bits.join(' · ');
    };

    const seatList = Array.isArray(seats) ? seats : [];
    const folderList = Array.isArray(folders) ? folders : [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Section title="The Dave Alarm" meta={people ? people.length + ' member' + (people.length === 1 ? '' : 's') + ' · ' + darkCount + ' dark' : null}>
                <div style={{ color: TEXT, fontSize: '0.76rem', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '10px' }}>
                    Dark in one league means bored. Dark in all of them means life happened. Different conversations.
                </div>
                {!people || !people.length ? (
                    <div style={{ color: TEXT, fontSize: '0.78rem' }}>The radar hasn't swept yet — it lights up once your commissioned leagues sync.</div>
                ) : people.map((p, i) => {
                    const chip = chipFor(p);
                    const isDark = p.status === 'DARK_ALL' || p.status === 'DARK_ONE';
                    return (
                        <div key={p.userId} style={{ padding: '9px 0', borderBottom: i === people.length - 1 ? 'none' : `1px solid ${LINE}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.82rem', color: TEXT }}>{p.name}{p.isMe ? ' (you)' : ''}</span>
                                <span style={{ ...mono, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: chip.color, border: '1px solid ' + chip.border, borderRadius: 'var(--card-radius-xs, 5px)', padding: '2px 7px', whiteSpace: 'nowrap' }}>{chip.label}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '5px' }}>
                                {(p.teams || []).map(t => (
                                    <span key={t.leagueId + ':' + t.rosterId} title={sigTitle(t)} style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: TEXT, cursor: 'default' }}>
                                        <i style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor(t.status), display: 'inline-block', flexShrink: 0 }} />
                                        {t.leagueName}
                                    </span>
                                ))}
                            </div>
                            {isDark && p.checkin ? (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginTop: '8px' }}>
                                    <Quote>“{p.checkin}”</Quote>
                                    <CopyBtn k={'checkin:' + p.userId} text={p.checkin} />
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </Section>

            <Section title="Open Seats + The Bench" meta={seatList.length ? seatList.length + ' open seat' + (seatList.length === 1 ? '' : 's') : null}>
                {seats == null ? (
                    // No graph yet ≠ no vacancies — the green all-clear would be a lie here.
                    <div style={{ color: TEXT, fontSize: '0.78rem' }}>The seat scan hasn't run yet — it fills in with the member graph.</div>
                ) : seatList.length === 0 ? (
                    <div style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 'var(--card-radius-sm, 8px)', padding: '9px 12px', color: GREEN, fontSize: '0.78rem' }}>
                        Every seat is filled.
                    </div>
                ) : seatList.map((seat, i) => {
                    // benches/prospectuses are parallel arrays to seats — a hole
                    // (engine not run for that seat) gets an honest blank, not a crash.
                    const bench = Array.isArray(benches?.[i]) ? benches[i] : [];
                    const pros = prospectuses?.[i];
                    return (
                        <div key={seat.leagueId + ':' + seat.rosterId} style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px', marginBottom: i === seatList.length - 1 ? 0 : '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '7px' }}>
                                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.82rem', color: TEXT }}>{seat.leagueName}</span>
                                <span style={{ ...mono, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', padding: '2px 7px' }}>
                                    {seat.reason === 'owner_left' ? 'Owner left' : 'Unowned'}
                                </span>
                            </div>
                            {bench.length === 0 ? (
                                <div style={{ color: TEXT, fontSize: '0.76rem' }}>No recruits scored for this seat yet.</div>
                            ) : bench.map((c, ci) => (
                                <div key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '5px 0', borderBottom: ci === bench.length - 1 ? 'none' : `1px solid ${LINE}` }}>
                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.78rem', color: TEXT }}>{c.name}</span>
                                    <span style={{ ...mono, fontSize: '0.68rem', color: TEXT }}>fit {c.score}</span>
                                    {(c.reasons || []).map((r, ri) => (
                                        <span key={ri} style={{ fontSize: '0.62rem', color: MUTED, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', padding: '1px 6px' }}>{r}</span>
                                    ))}
                                </div>
                            ))}
                            {pros && pros.pitch ? (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginTop: '8px' }}>
                                    <Quote>{pros.pitch}</Quote>
                                    <CopyBtn k={'pitch:' + seat.leagueId + ':' + seat.rosterId} text={pros.pitch} label="Copy pitch" />
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </Section>

            <Section title="Day One Folder" meta={folderList.length ? folderList.length + ' drafted' : null}>
                {folderList.length === 0 ? (
                    <div style={{ color: TEXT, fontSize: '0.78rem' }}>Generates once a seat has a shortlist to draft one for.</div>
                ) : folderList.map((f, fi) => {
                    const sections = Array.isArray(f?.sections) ? f.sections : [];
                    const copyAll = sections.map(s => (s.title || '').toUpperCase() + '\n' + (s.body || '')).join('\n\n');
                    return (
                        <div key={fi} style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderTop: `2px solid ${GOLD}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 14px', marginBottom: fi === folderList.length - 1 ? 0 : '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '9px' }}>
                                <span style={{ ...microHdr, color: GOLD }}>Day One Folder{f.leagueName ? ' — ' + f.leagueName : ''}</span>
                                <CopyBtn k={'folder:' + fi} text={copyAll} label="Copy all" />
                            </div>
                            {/* Nobody has accepted anything — Sleeper only tells us a
                                seat is EMPTY, never that a recruit said yes. Say whose
                                name is in the welcome and that it is a draft, so this
                                is never sent out as a done deal. */}
                            <div style={{ fontSize: 'var(--text-micro)', color: MUTED, marginBottom: '9px', lineHeight: 1.5 }}>
                                Draft — written for {f.recruitName || 'the top shortlist candidate'}. Swap the name before you send it.
                            </div>
                            {sections.length === 0 ? (
                                <div style={{ color: TEXT, fontSize: '0.76rem' }}>This folder came back empty — regenerate it from the seat.</div>
                            ) : sections.map((s, si) => (
                                <div key={si} style={{ marginBottom: si === sections.length - 1 ? 0 : '10px' }}>
                                    <div style={{ ...microHdr, marginBottom: '3px' }}>{s.title}</div>
                                    {/* pre-wrap: folder bodies carry deliberate line breaks (rules lists, 90-day plan) */}
                                    <div style={{ fontSize: '0.78rem', color: '#C9C9D2', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{s.body}</div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </Section>
        </div>
    );
}

window.WrCommishPeoplePanel = WrCommishPeoplePanel;
