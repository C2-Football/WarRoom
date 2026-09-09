/* global React */
(function(root){
    'use strict';
    const App=root.App=root.App||{};
    const titles={alliance:'Your alliance enters the Heptad',lineup:'Set your starting lineup',favors:'Choose your offerings',kickoff:'Ready for kickoff',games:'Your games are underway',recap:'The week is written',conquest:'Take the result to your war council',complete:'Your dynasty season is complete'};
    const labels={alliance:'Alliance',lineup:'Lineup',favors:'Favors',kickoff:'Kickoff',games:'Games',recap:'Recap',conquest:'Conquest',complete:'Season complete'};
    function Frame({stage,week,cycle,children,primary,secondary,note,busy,extra,favors=true,conquest=true,pendingRecruit=false}){
        const ref=React.useRef(null),actionRef=React.useRef(null),wasPending=React.useRef(pendingRecruit);
        React.useEffect(()=>{ref.current?.focus({preventScroll:true});ref.current?.scrollIntoView({block:'start',behavior:'instant'});},[stage,week,cycle]);
        React.useEffect(()=>{if(wasPending.current&&!pendingRecruit&&stage==='favors'){actionRef.current?.focus({preventScroll:true});actionRef.current?.scrollIntoView({block:'start',behavior:'instant'});}wasPending.current=pendingRecruit;},[pendingRecruit,stage]);
        const steps=['lineup',...(favors?['favors']:[]),'games','recap',...(conquest?['conquest']:[])],step=stage==='alliance'?0:stage==='kickoff'?steps.indexOf('games')+1:steps.indexOf(stage)+1;
        const action=<footer className="duat-weekly-next" ref={actionRef} tabIndex="-1">{note&&<p className="duat-weekly-note" role="status">{note}</p>}<div>{secondary&&<button className="duat-link" onClick={secondary.onClick} disabled={busy||secondary.disabled}>{secondary.label}</button>}{primary&&<button className="duat-button primary" onClick={primary.onClick} disabled={busy||primary.disabled}>{busy?'Saving your move…':primary.label}</button>}</div>{extra}</footer>;
        return <section className={'duat-weekly-flow is-'+stage} aria-label={`Week ${week} · ${labels[stage]}`}>
            <header className="duat-weekly-heading" ref={ref} tabIndex="-1"><div><span className="duat-eyebrow">DYNASTY {cycle} · WEEK {week}</span><h2>{titles[stage]}</h2></div><span className="duat-weekly-stage">{labels[stage]}</span></header>
            <div className="duat-weekly-path" aria-label="The weekly journey">{steps.map((id,index)=><span key={id} className={index+1<step?'done':index+1===step?'current':''}>{labels[id]}</span>)}</div>
            {stage==='favors'&&action}
            <div className="duat-weekly-content">{children}</div>
            {stage!=='favors'&&action}
        </section>;
    }
    function Preparation({campaign,factionId,lineup,onChange,disabled,previous}){
        const E=App.DuatCampaign,faction=campaign.factions.find(item=>item.id===factionId),army=E.activeArmy(faction),rules=E.settingsOf(campaign);
        return <section className="duat-panel duat-weekly-lineup"><p className="duat-muted">Choose {E.ROSTERS[rules.roster].slots.length} starters: {E.ROSTERS[rules.roster].slots.join(' · ').replaceAll('SUPER_FLEX','Superflex')}. Your bench rests this week.</p><div className="duat-roster">{army?.players.map(player=>{const estimate=E.estimatePlayer(campaign,factionId,player.id),last=previous?.factions.find(item=>item.factionId===factionId)?.players.find(item=>item.id===player.id);return <label key={player.id} className={'duat-player '+(lineup.includes(player.id)?'starting':'')}><input type="checkbox" disabled={disabled} checked={lineup.includes(player.id)} onChange={()=>onChange(lineup.includes(player.id)?lineup.filter(id=>id!==player.id):[...lineup,player.id])}/><span className="duat-position">{player.position}</span><span className="duat-player-name"><strong>{player.name}</strong><small>{estimate.label}</small></span><span className="duat-player-points"><strong>{Number(estimate.points||0).toFixed(1)}</strong><small>Est. PPG</small></span>{last&&<span className="duat-player-points"><strong>{Number(last.effectivePoints||0).toFixed(1)}</strong><small>W{previous.week}</small></span>}</label>;})}</div><button className="duat-link" disabled={disabled} onClick={()=>onChange(E.recommendedLineup(campaign,factionId))}>Suggest a legal lineup</button></section>;
    }
    function Kickoff({campaign,factionId,room,ready,preparation}){
        const faction=campaign.factions.find(item=>item.id===factionId),declared=faction.declaredFavors||[];
        return <section className="duat-panel duat-weekly-kickoff"><span className="duat-eyebrow">WEEK {campaign.week} · YOUR PREPARATION</span><h3>Your army is ready to take the field.</h3><div className="duat-weekly-checks"><p><span aria-hidden="true">✓</span>{faction.lineup.length} starters confirmed</p><p><span aria-hidden="true">✓</span>{declared.length?`${declared.length} divine ${declared.length===1?'offering':'offerings'} reserved`:'No starter offerings reserved'}</p></div>{preparation?.heptad?.next?.label&&<p className="duat-notice"><strong>The Heptad · </strong>{preparation.heptad.next.label}</p>}{preparation?.notes?.filter(note=>typeof note==='string').map((note,index)=><p className="duat-muted" key={index}>{note}</p>)}{room&&<><p>{ready?'Your faction is ready. The host starts the games once everyone is ready.':'Mark your faction ready when your choices are final.'}</p><div className="duat-weekly-seats">{room.seats.filter(seat=>seat.controller==='human').map(seat=><span key={seat.factionId} className={seat.ready?'is-ready':''}>{App.DuatPresentation.nameOf(seat.factionId)} · {seat.ready?'Ready':seat.joined?'Preparing':'Not joined'}</span>)}</div></>}</section>;
    }
    function ConquestNote({resultWeek,ownClaim,waitingClaim,enabled,catchingUp}){
        return <section className="duat-panel duat-weekly-war-note"><span className="duat-eyebrow">AFTER WEEK {resultWeek}</span><h3>{!enabled?'The armies return home':catchingUp?'Your journal catches up with the realm':ownClaim?'You have earned a move on the map':'Your borders are ready for the next week'}</h3><p>{!enabled?'Conquest is turned off in this campaign. Continue to prepare your next lineup.':catchingUp?'Review the remaining results first. Your current conquest choices will be waiting after the most recent week.':ownClaim?'Choose a highlighted claim or legal attack below. Complete your earned move before preparing the next week.':waitingClaim?'Another human faction still has an earned move to use. You can prepare your lineup while they finish; kickoff waits for everyone.':'You can inspect your realm or continue to the next week. Optional attacks and defenses remain available in Explore.'}</p></section>;
    }
    function WeeklyStandings({week,rows=[],factionId}){
        return <section className="duat-panel duat-weekly-standings">
            <span className="duat-eyebrow">THE FULL FIELD</span><h3>Week {week} standings</h3>
            <p className="duat-muted">Final fantasy scores and all-play records for this week only.</p>
            {rows.length?<table>
                <caption>Week {week} fantasy points and wins, losses, and ties</caption>
                <colgroup><col className="duat-weekly-rank-col"/><col/><col className="duat-weekly-points-col"/><col className="duat-weekly-record-col"/></colgroup>
                <thead><tr><th scope="col">Rank</th><th scope="col">Faction</th><th scope="col">Points</th><th scope="col"><span>All-play</span><abbr title="Wins–Losses–Ties">W–L–T</abbr></th></tr></thead>
                <tbody>{rows.map(row=><tr key={row.factionId} className={row.factionId===factionId?'is-you':''}>
                    <td className="duat-weekly-rank"><span aria-label={row.tiedForRank?`Tied for rank ${row.rank}`:`Rank ${row.rank}`}>{row.tiedForRank?'=':''}{row.rank}</span></td>
                    <th scope="row"><span>{row.name}</span>{row.factionId===factionId&&<small className="duat-weekly-you">You</small>}</th>
                    <td className="duat-weekly-points">{Number(row.points).toFixed(2)}</td>
                    <td className="duat-weekly-record">{row.wins}–{row.losses}–{row.ties}</td>
                </tr>)}</tbody>
            </table>:<p className="duat-muted">No finalized scores are available for this week.</p>}
        </section>;
    }
    function Recap({campaign,factionId,week,result}){
        if(!result)return <p>The weekly report is unavailable.</p>;
        const all=result.allPlay,playoff=result.playoff,favors=result.favors;
        const meaningfulPlayoff=Boolean(playoff?.match&&playoff.label);
        return <div className="duat-weekly-recap"><section className="duat-panel"><span className="duat-eyebrow">WEEK {week} · {App.DuatPresentation.nameOf(factionId)}</span><h3 className="duat-weekly-recap-outcome">{meaningfulPlayoff?playoff.label:all?.label||'Your weekly result'}</h3><div className="duat-weekly-recap-grid"><div><strong>{Number(all?.points||0).toFixed(2)}</strong><small>Fantasy points</small></div><div><strong>{all?.wins||0}–{all?.losses||0}{all?.ties?`–${all.ties}`:''}</strong><small>All-play W–L{all?.ties?'–T':''}</small></div><div><strong>{all?.tiedForPlace?'=':''}{all?.place||'—'} / {all?.fieldSize||campaign.factions.length}</strong><small>Weekly place</small></div></div><p className="duat-muted">Your score faced every rival. {all?.ties?'Tied scores share the result.':'Every lower score is a win; every higher score is a loss.'}</p>{!meaningfulPlayoff&&playoff?.status!=='not-started'&&playoff?.label&&<p className="duat-notice">{playoff.label}</p>}{meaningfulPlayoff&&playoff.opponentName&&<p>{playoff.opponentName}: {Number(playoff.opponentPoints||0).toFixed(2)} points.</p>}{favors&&(favors.events?.length>0||favors.spent>0)&&<details className="duat-weekly-recap-section"><summary>Divine receipts · {favors.spent||0} favor spent</summary><p>{Number(favors.playerDelta||0).toFixed(1)} points from player favors · {Number(favors.teamAdjustment||0).toFixed(1)} from team rituals.</p>{favors.events.map((event,index)=><p key={event.id||index}>{event.name||event.message||'Divine offering'}{event.reason?' · '+event.reason:''}{event.ritualId==='ebisu-result'?` · ${event.success?'Wager won':'Wager lost'} · ${event.beforePoints} → ${event.afterPoints} points`:event.status==='applied'?` · ${event.beforePoints} → ${event.afterPoints} points`:''}</p>)}</details>}</section><div className="duat-weekly-recap-section"><WeeklyStandings week={week} rows={result.weeklyStandings} factionId={factionId}/></div><div className="duat-weekly-recap-section"><App.DuatHeptadUI.WeeklyRecap campaign={campaign} factionId={factionId} week={week}/></div></div>;
    }
    App.DuatWeeklyUI={Frame,Preparation,Kickoff,ConquestNote,WeeklyStandings,Recap};
})(typeof window!=='undefined'?window:globalThis);
