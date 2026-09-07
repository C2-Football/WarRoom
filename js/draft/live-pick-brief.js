// One roster-aware next-pick brief shared by the live room and phone board.
(function() {
    const COLORS = { QB: '#f18bab', RB: '#61d7b4', WR: '#72baf0', TE: '#efc477', K: '#baa1eb', DEF: '#a7b9d1' };
    const color = pos => COLORS[pos] || 'var(--silver)';
    const fmt = n => Number(n || 0).toLocaleString();
    const openPlayer = p => {
        if (!p?.pid) return;
        if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid);
        else if (typeof window.WR?.openPlayerCard === 'function') window.WR.openPlayerCard(p.pid);
    };
    const isPro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const CSS = `
        .pick-brief{--brief-line:var(--ov-6,rgba(255,255,255,.12));font-family:var(--font-body,'DM Sans',sans-serif);color:var(--white);min-width:0}
        .pick-brief *{box-sizing:border-box}.pick-brief button{font-family:inherit;cursor:pointer}.pick-brief button:focus-visible,.pick-roster button:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
        .pick-brief-header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:12px}.pick-brief-eyebrow{font-size:.64rem;letter-spacing:.13em;font-weight:900;text-transform:uppercase;color:var(--gold)}
        .pick-brief h2{font:700 clamp(1.4rem,2.2vw,2rem)/1.05 var(--font-display,Rajdhani,sans-serif);margin:6px 0;color:var(--white);letter-spacing:.015em}.pick-brief-summary{font-size:.76rem;line-height:1.5;color:var(--silver);margin:6px 0 0;max-width:680px}
        .pick-brief-timing{border:1px solid var(--brief-line);padding:10px 13px;border-radius:8px;flex-shrink:0;text-align:right;min-width:94px}.pick-brief-timing strong{display:block;color:var(--gold);font:700 1.35rem var(--font-display,Rajdhani,sans-serif)}.pick-brief-timing span{display:block;color:var(--silver);font-size:.61rem;margin-top:2px}
        .pick-brief-build{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 15px}.pick-brief-build>span{display:flex;align-items:center;gap:7px;border:1px solid var(--brief-line);border-radius:6px;padding:6px 8px;font-size:.69rem;background:var(--ov-2,rgba(255,255,255,.025))}.pick-brief-build b{color:var(--pos)}.pick-brief-build small{color:var(--silver);font-size:.6rem}.pick-brief-build .is-needed{border-color:color-mix(in srgb,var(--pos) 48%,transparent);background:color-mix(in srgb,var(--pos) 6%,transparent)}
        .pick-brief-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:12px}.pick-brief-choice{border:1px solid color-mix(in srgb,var(--gold) 42%,transparent);border-radius:10px;background:linear-gradient(130deg,color-mix(in srgb,var(--gold) 11%,transparent),var(--ov-1,rgba(255,255,255,.01)) 75%);padding:15px;min-width:0;position:relative;overflow:hidden}
        .pick-brief-choice-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.pick-brief-choice-head small{font-size:.66rem;color:var(--silver)}.pick-brief-player{display:flex;align-items:center;gap:12px;border:0;background:transparent;padding:10px 0 7px;color:var(--white);text-align:left;width:100%;min-height:68px}
        .pick-brief-portrait{width:62px;height:62px;border-radius:50%;background:var(--ov-3,rgba(255,255,255,.04));object-fit:cover;object-position:top;flex-shrink:0}.pick-brief-player strong{display:block;font:700 clamp(1.3rem,2.1vw,1.9rem)/1.05 var(--font-display,Rajdhani,sans-serif);overflow-wrap:anywhere}.pick-brief-player small{display:block;font-size:.69rem;color:var(--silver);margin-top:6px}.pick-brief-choice p{margin:5px 0 0;font-size:.78rem;line-height:1.6;color:var(--silver)}
        .pick-brief-impact{border-top:1px solid color-mix(in srgb,var(--gold) 20%,transparent);padding-top:10px;margin-top:10px!important;color:var(--gold)!important;font-size:.72rem!important}
        .pick-brief-alts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.pick-brief-alt{min-height:76px;border:1px solid var(--brief-line);border-radius:8px;padding:10px;color:var(--white);background:var(--ov-1,rgba(255,255,255,.02));text-align:left;min-width:0}.pick-brief-alt>span{display:block;font-size:.59rem;text-transform:uppercase;font-weight:800;letter-spacing:.07em;color:var(--pos)}.pick-brief-alt strong{display:block;overflow-wrap:anywhere;font-size:.79rem;margin:4px 0}.pick-brief-alt small{font-size:.66rem;color:var(--silver);line-height:1.4;display:block}
        .pick-brief-pressure{border:1px solid var(--brief-line);border-radius:10px;padding:14px;background:var(--ov-1,rgba(255,255,255,.02));min-width:0}.pick-brief-pressure h3{font:700 1.15rem var(--font-display,Rajdhani,sans-serif);margin:4px 0 3px}.pick-brief-pressure p{font-size:.72rem;line-height:1.5;margin:7px 0;color:var(--silver)}.pick-brief-position-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0}.pick-brief-position-tabs button{min-height:36px;min-width:42px;border:1px solid var(--brief-line);border-radius:5px;background:transparent;color:var(--silver);font-size:.7rem;font-weight:700;padding:5px 9px}.pick-brief-position-tabs button[aria-pressed=true]{color:var(--pos);border-color:var(--pos);background:color-mix(in srgb,var(--pos) 7%,transparent)}
        .pick-brief-runway{display:grid;gap:10px;margin:12px 0}.pick-brief-runway-row>div:first-child{display:flex;gap:8px;align-items:baseline;justify-content:space-between;font-size:.69rem}.pick-brief-runway-row strong{font-size:.76rem;overflow-wrap:anywhere;text-align:right}.pick-brief-runway-row small{color:var(--silver);display:block;font-size:.65rem;margin-top:4px}.pick-brief-bar{height:5px;border-radius:8px;background:var(--ov-5,rgba(255,255,255,.08));overflow:hidden;margin-top:6px}.pick-brief-bar>i{height:100%;display:block;background:var(--pos);border-radius:8px}.pick-brief-runway-row.is-next .pick-brief-bar>i{opacity:.5}
        .pick-brief-threat{border-top:1px solid var(--brief-line);padding-top:9px;margin-top:11px!important}.pick-brief-threat strong{color:var(--white)}.pick-brief-method{font-size:.61rem!important;color:var(--silver);opacity:.8;line-height:1.5!important}
        .pick-brief-empty{padding:20px;border:1px dashed var(--brief-line);border-radius:9px;color:var(--silver);font-size:.78rem;line-height:1.6}.pick-brief-set{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:rgba(97,215,180,.045);border:1px solid rgba(97,215,180,.16);border-radius:7px;margin-top:12px;font-size:.73rem;color:var(--silver);line-height:1.5}.pick-brief-set strong{color:var(--good,#61d7b4)}
        .pick-brief-wire{font-size:.68rem;color:var(--silver);border-top:1px solid var(--brief-line);padding-top:10px;margin:12px 0 0;line-height:1.5}.pick-brief-wire strong{color:var(--white)}
        .pick-roster{display:flex;flex-direction:column;min-height:0;min-width:0;border:1px solid var(--acc-line1,rgba(212,175,55,.2));border-radius:10px;background:var(--surf-solid,#10161e);padding:13px;font-family:var(--font-body,'DM Sans',sans-serif);color:var(--white)}.pick-roster.is-contained{height:100%;max-height:100%;box-sizing:border-box;overflow:hidden}.pick-roster.is-contained>div:first-of-type,.pick-roster.is-contained>p{flex-shrink:0}.pick-roster.is-contained .pick-roster-scroll{flex:1}.pick-roster h3{font:700 1.1rem var(--font-display,Rajdhani,sans-serif);margin:0}.pick-roster>p{font-size:.72rem;color:var(--silver);line-height:1.5;margin:6px 0 12px}.pick-roster-scroll{min-height:0;overflow:auto;overscroll-behavior:contain}.pick-roster-group{border-top:1px solid var(--ov-5,rgba(255,255,255,.08));padding:10px 0}.pick-roster-group>div:first-child{display:flex;gap:8px;align-items:center;justify-content:space-between}.pick-roster-group strong{font-size:.76rem;color:var(--pos)}.pick-roster-group span{font-size:.67rem;color:var(--silver)}.pick-roster-players{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.pick-roster button{font-family:inherit;min-height:36px;padding:5px 7px;border:1px solid var(--ov-5,rgba(255,255,255,.08));border-radius:5px;color:var(--white);background:transparent;font-size:.69rem;cursor:pointer;text-align:left}
        .redraft-extra-details{border-top:1px solid var(--ov-5,rgba(255,255,255,.08));margin-top:12px;padding-top:8px}.redraft-extra-details>summary{min-height:44px;display:list-item;align-content:center;cursor:pointer;font-size:.72rem;color:var(--gold);font-weight:700}.redraft-extra-details[open]>summary{margin-bottom:10px}
        @media(max-width:1050px){.pick-brief-grid{grid-template-columns:1fr 1fr}.pick-brief-portrait{width:48px;height:48px}}
        .pick-brief.is-compact .pick-brief-grid{grid-template-columns:1fr}
        @media(max-width:767px){.pick-brief-grid{grid-template-columns:1fr}.pick-brief-header{gap:8px}.pick-brief h2{font-size:1.5rem}.pick-brief-timing{padding:7px;min-width:69px}.pick-brief-timing strong{font-size:1.15rem}.pick-brief-timing span{font-size:.58rem}.pick-brief-build{gap:5px;margin:10px 0}.pick-brief-build>span{padding:5px 6px;gap:5px}.pick-brief-choice{padding:12px}.pick-brief-alts{grid-template-columns:1fr}.pick-brief-position-tabs button,.pick-roster button{min-height:44px}.pick-brief-pressure{padding:12px}}
    `;

    function BriefStyles() { return <style>{CSS}</style>; }
    const statusLabel = row => row.status === 'need' ? 'OPEN' : ['set', 'blocked'].includes(row.status) ? 'SET' : row.status === 'depth' ? 'DEPTH' : '—';

    const fitLabel = fit => fit?.status === 'unknown' ? 'Compare roster fit' : fit?.starterUpgrade ? 'Improves starting options' : fit?.fillsStarter ? 'Fills a starter' : 'Adds useful depth';

    function PositionRunway({ read, hero, awaitingTurn }) {
        const [selectedPos, setSelectedPos] = React.useState(null);
        const outlooks = read.positionOutlook || [];
        const preferred = selectedPos || hero?.player?.pos;
        const outlook = outlooks.find(r => r.pos === preferred) || outlooks.find(r => r.bestNow) || outlooks[0];
        const priorSlots = new Set((read.forecasts || []).map(f => Number(f.slot?.overall)));
        const knownThreats = (outlook?.threats || []).filter(t => priorSlots.has(Number(t.overall)));
        const threatTeams = [...new Set(knownThreats.map(t => t.team))];
        const next = read.next;
        const value = p => Number(p?.dhq || 0);
        const drop = outlook?.canCompare && outlook.bestNow && outlook.bestNext ? Math.max(0, value(outlook.bestNow) - value(outlook.bestNext)) : null;
        return <section className="pick-brief-pressure" aria-label="The cost of waiting">
            <div className="pick-brief-eyebrow">Before it gets back to you</div>
            <h3>{read.isAuction ? 'Where your roster needs value' : 'The cost of waiting'}</h3>
            <p>{read.isAuction ? 'Compare useful positions before the next nomination.' : next?.picksAway === 0 ? (awaitingTurn ? 'You have the next selection when drafting resumes.' : 'You’re up. Compare the positions that still improve your team.') : next ? next.picksAway + ' picks separate you from your next selection.' : read.rosterPlan?.remainingPicks === 0 ? 'Your draft is finished.' : 'Next-pick timing is unavailable. Compare the useful options on the board.'}</p>
            <div className="pick-brief-position-tabs" role="group" aria-label="Compare positional options">{outlooks.map(row => <button type="button" key={row.pos} style={{ '--pos': color(row.pos) }} aria-pressed={outlook?.pos === row.pos} onClick={() => setSelectedPos(row.pos)}>{row.pos}</button>)}</div>
            {outlook ? <>
                <div className="pick-brief-runway" style={{ '--pos': color(outlook.pos) }}>
                    {[{ label: 'Available now', p: outlook.bestNow, next: false }, ...(outlook.canCompare ? [{ label: 'At your next turn*', p: outlook.bestNext, next: true }] : [])].map(row => <div className={'pick-brief-runway-row' + (row.next ? ' is-next' : '')} key={row.label}>
                        <div><span>{row.label}</span><strong>{row.p?.name || 'No eligible option'}</strong></div>
                        <div className="pick-brief-bar" aria-hidden="true"><i style={{ width: row.p && value(outlook.bestNow) > 0 ? Math.min(100, value(row.p) / value(outlook.bestNow) * 100) + '%' : '0%' }} /></div>
                        <small>{row.p ? (value(row.p) > 0 ? fmt(value(row.p)) + ' DHQ' : 'Value unavailable') : 'None left in this projected sequence'}</small>
                    </div>)}
                </div>
                {drop != null && <p><strong style={{ color: drop > 0 ? 'var(--gold)' : 'var(--good,#61d7b4)' }}>{drop > 0 ? fmt(drop) + ' DHQ could come off the top' : String(outlook.bestNow.pid) === String(outlook.bestNext.pid) ? 'The top option survives this forecast' : 'Comparable value remains in this forecast'}</strong></p>}
                {outlook.canCompare && outlook.bestNow && !outlook.bestNext && <p><strong style={{ color: 'var(--gold)' }}>No useful {outlook.pos} is projected to remain.</strong></p>}
                <p className="pick-brief-threat">{threatTeams.length ? <><strong>{threatTeams.join(', ')}</strong> {threatTeams.length === 1 ? 'is' : 'are'} projected to select {outlook.pos} before you.</> : outlook.canCompare ? 'No ' + outlook.pos + ' selections in this forecast before your turn.' : outlook.reason || 'No complete next-turn forecast is available.'}</p>
                <p className="pick-brief-method">{outlook.canCompare ? '* A conditional forecast, not a guarantee. Another manager can change the order.' : outlook.basis || 'Based on your roster and the available pool.'}</p>
            </> : <p>Position comparisons appear when roster and board information are available.</p>}
        </section>;
    }

    function LivePickBrief({ state, read: suppliedRead, compact = false }) {
        const deck = React.useMemo(() => window.DraftCC.liveDecisionEngine?.buildDecisionDeck(state), [state]);
        const read = React.useMemo(() => suppliedRead || window.DraftCC.liveDecisionEngine?.buildRedraftRoomRead(state), [suppliedRead, state]);
        if (!read || !deck || !isPro()) return null;
        const plan = read.rosterPlan || deck.rosterPlan || {};
        const noPicks = plan.remainingPicks === 0;
        const remoteStatus = state.liveSync?.draftStatus || state.liveDraftMeta?.status;
        const awaitingTurn = ['pre_draft', 'pre-draft', 'scheduled', 'paused', 'complete', 'completed'].includes(remoteStatus)
            || (state.liveSync?.status === 'waiting' && remoteStatus !== 'drafting');
        const cards = (deck.cards || []).filter(c => c.player && ['recommended', 'safe', 'upside'].includes(c.kind));
        const hero = noPicks ? null : cards[0];
        const next = read.next;
        const mission = noPicks ? 'Your draft is in the books.' : plan.mustFillStarters ? 'Finish the starting lineup.'
            : plan.known && plan.filled === plan.total ? (plan.remainingPicks === 1 ? 'Make the last pick count.' : 'Your starters are covered. Build depth.')
                : 'Make the next pick fit.';
        const setPositions = (plan.positions || []).filter(p => ['set', 'blocked'].includes(p.status) && p.have > 0);
        const last = [...(state.picks || [])].sort((a, b) => Number(a.overall) - Number(b.overall)).at(-1);
        return <section className={'pick-brief' + (compact || noPicks ? ' is-compact' : '')} aria-label="Your next pick brief">
            <BriefStyles />
            <header className="pick-brief-header"><div><span className="pick-brief-eyebrow">Alex · Your next move</span><h2>{mission}</h2><p className="pick-brief-summary">{plan.summary || 'Recommendations follow the available board and your league settings.'}</p></div>
                <div className="pick-brief-timing"><strong>{noPicks ? 'DONE' : read.isAuction ? 'AUCTION' : next?.picksAway === 0 ? (awaitingTurn ? 'UP NEXT' : 'YOU’RE UP') : next ? next.picksAway : '—'}</strong><span>{noPicks ? 'Review your class' : read.isAuction ? 'Build by value' : next?.picksAway === 0 ? 'Your selection' : 'picks to your turn'}</span></div>
            </header>
            {plan.known && <div className="pick-brief-build" aria-label="Your position groups">{(plan.positions || []).filter(row => row.have > 0 || row.starterCapacity > 0 || row.fillsStarter).map(row => <span className={row.status === 'need' ? 'is-needed' : ''} style={{ '--pos': color(row.pos) }} key={row.pos} title={row.reason}><b>{row.pos}</b><span>{row.have}</span><small>{statusLabel(row)}</small></span>)}</div>}
            <div className="pick-brief-grid">
                <div>{hero ? <>
                    <article className="pick-brief-choice">
                        <div className="pick-brief-choice-head"><span className="pick-brief-eyebrow">{plan.known ? 'Best fit for this pick' : 'Available board option'}</span><small>{fitLabel(hero.meta?.rosterFit)}</small></div>
                        <button type="button" className="pick-brief-player" onClick={() => openPlayer(hero.player)}>
                            <img className="pick-brief-portrait" src={'https://sleepercdn.com/content/nfl/players/thumb/' + encodeURIComponent(hero.player.pid) + '.jpg'} onError={e => { e.currentTarget.style.display = 'none'; }} alt="" />
                            <span><strong>{hero.player.name}</strong><small><b style={{ color: color(hero.player.pos) }}>{hero.player.pos}</b> · {fmt(hero.player.dhq)} DHQ · View player →</small></span>
                        </button>
                        <p>{hero.detail}</p>
                        {hero.meta?.rosterFit?.opportunityCost && <p className="pick-brief-impact">{hero.meta.rosterFit.opportunityCost}</p>}
                    </article>
                    <div className="pick-brief-alts">{cards.slice(1, 3).map(card => <button type="button" className="pick-brief-alt" key={card.player.pid} style={{ '--pos': color(card.player.pos) }} onClick={() => openPlayer(card.player)}><span>{fitLabel(card.meta?.rosterFit)}</span><strong>{card.player.name} · {card.player.pos}</strong><small>{card.detail}</small></button>)}</div>
                </> : <div className="pick-brief-empty">{noPicks ? 'All your selections are accounted for. Browse the team tracker to compare the completed builds.' : 'No useful recommendation is available with the current roster information. Check the board and league requirements.'}</div>}
                {setPositions.length > 0 && !noPicks && <div className="pick-brief-set"><strong>Covered ✓</strong><span>{setPositions.map(p => p.pos + ' (' + p.have + ')').join(' · ')}<br />Your next pick is focused on positions that still help.</span></div>}
                </div>
                {!compact && !noPicks && <PositionRunway read={read} hero={hero} awaitingTurn={awaitingTurn} />}
            </div>
            {!compact && last && <p className="pick-brief-wire"><strong>Just happened:</strong> {(state.personas || {})[String(last.rosterId)]?.teamName || 'Team ' + last.rosterId} selected {last.name} · {last.pos} · #{last.overall}</p>}
        </section>;
    }

    function LiveRosterBuildCard({ state, grade, contained = false }) {
        const model = React.useMemo(() => window.DraftCC.liveRoomEngine?.buildLiveRoom(state), [state]);
        const plan = React.useMemo(() => window.DraftCC.liveDecisionEngine?.buildRosterPlan?.(state), [state]);
        const team = model?.teamsById?.[String(state.userRosterId)];
        const positions = plan?.positions || [];
        const playerById = new Map([...(state.originalPool || []), ...(state.pool || []), ...(team?.picks || [])].map(p => [String(p.pid), p]));
        const ownedPlayers = plan?.ownedIds?.length ? plan.ownedIds.map(pid => {
            const p = playerById.get(String(pid)) || window.S?.players?.[pid] || {};
            return { ...p, pid, pos: p.pos || p.position, name: p.name || p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Player ' + pid };
        }) : team?.picks || [];
        if (!team) return null;
        return <section className={'pick-roster' + (contained ? ' is-contained' : '')} aria-label="Your actual roster build"><BriefStyles />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><h3>Your roster blueprint</h3>{isPro() && grade?.letter && <strong style={{ color: 'var(--gold)' }}>{grade.letter}</strong>}</div>
            <p>{plan?.known ? plan.filled + '/' + plan.total + ' starting slots filled' : 'Lineup settings unavailable'} · {team.pickCount} drafted<br />{plan?.known && plan.openSlots?.length ? 'Still open: ' + plan.openSlots.join(' · ') : plan?.known ? 'Starters covered. Every extra selection should earn its place.' : 'Showing the actual players you selected.'}</p>
            <div className="pick-roster-scroll">{(positions.length ? positions.filter(r => r.have > 0 || r.starterCapacity > 0 || r.fillsStarter) : team.positionBuild.map(p => ({ pos: p.pos, have: p.count, status: 'unknown' }))).map(row => <div key={row.pos} className="pick-roster-group" style={{ '--pos': color(row.pos) }}>
                <div><strong>{row.pos} · {row.have}</strong><span title={row.reason}>{statusLabel(row)}</span></div>
                <div className="pick-roster-players">{ownedPlayers.filter(p => p.pos === row.pos).map(p => <button key={p.pid} type="button" onClick={() => openPlayer(p)}>{p.name}</button>)}</div>
            </div>)}</div>
        </section>;
    }

    window.DraftCC.LivePickBrief = LivePickBrief;
    window.DraftCC.LiveRosterBuildCard = LiveRosterBuildCard;
})();
