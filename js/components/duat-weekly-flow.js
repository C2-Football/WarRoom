/* global React */
(function(root){
    'use strict';
    const App=root.App=root.App||{};
    const titles={alliance:'Your alliance enters the Games',lineup:'Set your starting lineup',favors:'Choose your offerings',kickoff:'Ready for kickoff',games:'Your games are underway',recap:'The week is written',conquest:'Take the result to your war council',complete:'Your dynasty season is complete'};
    const labels={alliance:'Alliance',lineup:'Lineup',favors:'Favors',kickoff:'Kickoff',games:'Games',recap:'Recap',conquest:'Conquest',complete:'Season complete'};
    const guidance={
        alliance:['Meet the faction fighting beside you.','Your individual score still competes against every rival. The alliance tournament is a separate chance at glory, using a combined lineup under your campaign rules.'],
        lineup:['Choose the players who will score for you this week.','An army is your roster. Starters score; the bench rests. Estimated points help you compare players, but are not a promise of this week’s result. Use the suggested legal lineup if you want a starting point.'],
        favors:['Spend for an edge, or save your treasury.','Offerings are optional. Read the cost, eligible target and effect before choosing. Your starting favor budget covers the season, so saving it is a valid move. Resolve any pending recruit before continuing.'],
        kickoff:['Check your choices before the scores are revealed.','The game uses historical NFL performances. In a friends campaign, each person marks ready and the host starts the week once everyone is ready.'],
        games:['Watch your starters turn history into points.','The replay reveals this week’s scores. You can go straight to the result with the week action when you are ready.'],
        recap:['See what your lineup earned against the field.','All-play means one result against every other faction: a win for each lower score, a loss for each higher score, and a tie for each equal score. Your alliance tournament is tracked separately.'],
        conquest:['Turn an earned move into a place on the map.','Use highlighted legal choices for earned claims. Read the preview before an attack: a war can put your land at risk. If you have no required move, you can continue to the next week.'],
        complete:['Your season has a place in the dynasty’s history.','Review the honors and annals. In a continuing dynasty, rulers retire while surviving tombs and conquered land carry forward.']
    };
    function Frame({stage,week,cycle,children,primary,secondary,note,busy,extra,favors=true,conquest=true,pendingRecruit=false,actionError='',onDismissError}){
        const ref=React.useRef(null),actionRef=React.useRef(null),wasPending=React.useRef(pendingRecruit);
        React.useEffect(()=>{ref.current?.focus({preventScroll:true});const target=root.matchMedia?.('(min-width:1024px)').matches?ref.current?.closest('.duat-game'):ref.current;target?.scrollIntoView({block:'start',behavior:'instant'});},[stage,week,cycle]);
        React.useEffect(()=>{if(wasPending.current&&!pendingRecruit&&stage==='favors'){actionRef.current?.focus({preventScroll:true});if(root.getComputedStyle?.(actionRef.current)?.position!=='fixed')actionRef.current?.scrollIntoView({block:'start',behavior:'instant'});}wasPending.current=pendingRecruit;},[pendingRecruit,stage]);
        React.useEffect(()=>{
            const node=actionRef.current,game=node?.closest?.('.duat-game');if(!node||!game)return;
            const measure=()=>game.style.setProperty('--duat-week-action-height',Math.ceil(node.getBoundingClientRect().height)+'px');
            measure();const observer=root.ResizeObserver?new root.ResizeObserver(measure):null;observer?.observe(node);root.addEventListener?.('resize',measure);
            return ()=>{observer?.disconnect();root.removeEventListener?.('resize',measure);game.style.removeProperty('--duat-week-action-height');};
        },[stage,week,cycle]);
        const steps=['lineup',...(favors?['favors']:[]),'games','recap',...(conquest?['conquest']:[])],step=stage==='alliance'?0:stage==='kickoff'?steps.indexOf('games')+1:steps.indexOf(stage)+1;
        const action=<footer className="duat-weekly-next" ref={actionRef} tabIndex="-1" aria-label="Week actions"><span className="duat-weekly-action-heading">NEXT STEP</span><div className="duat-weekly-feedback">{actionError&&<div className="duat-weekly-action-error" role="alert"><span>{actionError}</span>{onDismissError&&<button className="duat-link" onClick={onDismissError}>Dismiss error</button>}</div>}{note&&<p className="duat-weekly-note" role="status">{note}</p>}</div><div className="duat-weekly-action-buttons">{primary&&<button className="duat-button primary" onClick={primary.onClick} disabled={busy||primary.disabled}>{busy?'Saving your move…':primary.label}</button>}{secondary&&<button className="duat-link" onClick={secondary.onClick} disabled={busy||secondary.disabled}>{secondary.label}</button>}</div>{extra}</footer>;
        return <section className={'duat-weekly-flow is-'+stage} aria-label={`Week ${week} · ${labels[stage]}`}>
            <header className="duat-weekly-heading" ref={ref} tabIndex="-1"><div><span className="duat-eyebrow">DYNASTY {cycle} · WEEK {week}</span><h2>{titles[stage]}</h2></div><span className="duat-weekly-stage">{labels[stage]}</span></header>
            <div className="duat-weekly-path" aria-label="The weekly journey">{steps.map((id,index)=><span key={id} aria-current={index+1===step?'step':undefined} className={index+1<step?'done':index+1===step?'current':''}>{labels[id]}</span>)}</div>
            {guidance[stage]&&<aside className="duat-weekly-guide" aria-label="Help with this step"><details><summary>How this works</summary><p>{guidance[stage][1]}</p></details></aside>}
            {stage==='favors'&&action}
            <div className="duat-weekly-content">{children}</div>
            {stage!=='favors'&&action}
        </section>;
    }
    function lineupComparison(campaign,factionId,lineup,data,throughWeek=0) {
        const E=App.DuatCampaign,faction=campaign.factions.find(item=>item.id===factionId),army=E.activeArmy(faction),mystery=App.DuatMystery?.enabled(campaign);
        const viewed=Number.isInteger(throughWeek)&&throughWeek>=0&&throughWeek<=17?Math.min(throughWeek,Math.max(0,(campaign.week||1)-1)):0;
        const publicCampaign={...campaign,week:viewed+1,completedWeeks:(campaign.completedWeeks||[]).filter(result=>result.week<=viewed)};
        const rows=(army?.players||[]).map(player=>{
            const report=mystery&&App.DuatMystery.isCard(player)?App.DuatMystery.scouting(campaign,player,data,{throughWeek:viewed}):null;
            const estimate=E.estimatePlayer(publicCampaign,factionId,player.id);
            const last=(publicCampaign.completedWeeks||[]).filter(result=>result.factions.some(item=>item.factionId===factionId&&item.players.some(item=>item.id===player.id))).at(-1);
            const result=last?.factions.find(item=>item.factionId===factionId)?.players.find(item=>item.id===player.id);
            return {...player,starting:lineup.includes(player.id),report,estimate,lastWeek:last?.week,lastPoints:result?.effectivePoints,
                comparisonPoints:report?.available?report.points:!mystery&&Number.isFinite(estimate?.points)?estimate.points:null};
        });
        const available=rows.length>0&&rows.every(player=>Number.isFinite(player.comparisonPoints));
        const best=available&&E.bestLineup?E.bestLineup(rows,E.slotsOf(faction),player=>player.comparisonPoints):[];
        const bestIds=new Set(best.map(player=>player.id)),legal=E.legalLineup(faction,lineup);
        const metric=mystery?`W${rows.find(player=>player.report)?.report.week||viewed+1} base-point estimate`:'estimated points per game';
        const fmt=value=>Number.isFinite(value)?value.toFixed(1):'—';
        const scoutingForRow=player=>{
            let reason=player.starting?'Selected to start.':'Currently on your bench.';
            if(!Number.isFinite(player.comparisonPoints))reason+=' Scouting is unavailable; review the archive and starting positions before deciding.';
            else if(legal){
                const swaps=rows.filter(other=>other.starting!==player.starting&&Number.isFinite(other.comparisonPoints)&&E.legalLineup(faction,player.starting?lineup.filter(id=>id!==player.id).concat(other.id):lineup.filter(id=>id!==other.id).concat(player.id)));
                const better=player.starting?swaps.filter(other=>other.comparisonPoints>player.comparisonPoints).sort((a,b)=>b.comparisonPoints-a.comparisonPoints)[0]:swaps.filter(other=>other.comparisonPoints<player.comparisonPoints).sort((a,b)=>a.comparisonPoints-b.comparisonPoints)[0];
                if(better){const gain=Math.abs(better.comparisonPoints-player.comparisonPoints);reason+=player.starting?` A legal swap to ${better.name} adds ${fmt(gain)} ${metric}.`:` Starting over ${better.name} is legal and adds ${fmt(gain)} ${metric}.`;}
                else if(bestIds.has(player.id))reason+=` Fits the strongest legal lineup by ${metric}.`;
                else reason+=' No higher-scoring one-player swap is shown by the available scouting.';
            } else reason+=bestIds.has(player.id)?` Fits a legal starting combination by ${metric}; finish filling your starting slots.`:'Finish filling your starting slots before comparing one-player swaps.';
            const report=player.report;
            return {subtitle:(player.starting?'Starting':'Bench')+' · '+player.position,
                summary:report?.available?`W${report.week}: ${fmt(report.points)} ${report.exact?'known':'estimated'} base points; ${fmt(report.pointsLeft)} ${report.exact?'base':'estimated'} points remain in Weeks ${report.week}–17.`:!mystery?`${fmt(player.estimate?.points)} estimated PPG · ${player.estimate?.label||'prior reference and viewed results'}. Weekly projection and remaining points are unavailable.`:'Load the public archive to compare this week and remaining points.',
                reason,confidence:report?.available?(report.exact?'One public season matches. Base points exclude divine offerings.':`${report.candidateCount} public seasons match. Estimates are equal-weight averages, not probabilities; offerings can change actual points.`):'Compare like periods. Estimated PPG is not a current-week projection.',
                metrics:[{label:report?`Week ${report.week} base pts`:'Estimated PPG',value:fmt(player.comparisonPoints)},{label:report?'Base pts left':player.lastWeek?'W'+player.lastWeek+' final pts':'Viewed result',value:fmt(report?.available?report.pointsLeft:player.lastPoints)}]};
        };
        return {rows,mystery,legal,scoutingForRow,viewed,week:viewed+1};
    }
    function Preparation({campaign,factionId,lineup,onChange,disabled,previous,data,throughWeek=0}){
        const E=App.DuatCampaign,faction=campaign.factions.find(item=>item.id===factionId),army=E.activeArmy(faction),rules=E.settingsOf(campaign),required=E.ROSTERS[rules.roster].slots.length;
        const mystery=App.DuatMystery?.enabled(campaign);
        const comparison=lineupComparison(campaign,factionId,lineup,data,throughWeek),legal=comparison.legal,visiblePrevious=previous&&previous.week<=comparison.viewed?previous:null,number=value=>Number.isFinite(value)?value.toFixed(1):'—';
        const columns=mystery?[{key:'week',label:`W${comparison.week} base pts`,getValue:player=>player.report?.available?player.report.points:null,render:player=>player.report?.available?(player.report.exact?'':'~')+number(player.report.points):'—'},{key:'left',label:'Base pts left',getValue:player=>player.report?.available?player.report.pointsLeft:null,render:player=>player.report?.available?(player.report.exact?'':'~')+number(player.report.pointsLeft):'—'},{key:'stars',label:`W${comparison.week} outlook`,getValue:player=>player.report?.stars,render:player=>player.report?.stars?'★'.repeat(player.report.stars)+'☆'.repeat(5-player.report.stars):'—'}]:[{key:'ppg',label:'Est. PPG',getValue:player=>player.estimate?.points,render:player=>number(player.estimate?.points)},{key:'last',label:'Last viewed pts',getValue:player=>player.lastPoints,render:player=>player.lastWeek?'W'+player.lastWeek+' · '+number(player.lastPoints):'—'}];
        return <section className="duat-panel duat-weekly-lineup">
            <div className={'duat-lineup-completion'+(legal?' is-complete':'')} role="status"><strong>{lineup.length} / {required} starters</strong><span>{legal?'Lineup complete':lineup.length<required?'Choose '+(required-lineup.length)+' more':lineup.length>required?'Move '+(lineup.length-required)+' to the bench':'Check the starting positions below'}</span></div>
            <div className="duat-lineup-context"><p>{disabled?'Viewing your starting lineup.':'Select a position to change starters.'}{mystery?' Select a name for its season game log.':''}</p><details className="duat-lineup-positions" open={!legal&&lineup.length===required}><summary>Positions & scouting</summary><p>{E.ROSTERS[rules.roster].slots.join(' · ').replaceAll('SUPER_FLEX','Superflex')}. Your bench rests this week.</p><p>{mystery?'Stars compare this week with the player’s possible archive seasons. Weekly and remaining points use matching public seasons; a known year gives exact base points before offerings.':'Est. PPG blends the archive reference with completed games. It is an estimate, not this week’s score.'} {visiblePrevious?`W${visiblePrevious.week} shows the last completed result, including offerings.`:'Your first result appears after the first completed week.'}</p></details></div>
            <div className="duat-roster duat-lineup-list">{army?.players.map(player=>{
                const compared=comparison.rows.find(item=>item.id===player.id),estimate=compared.estimate;
                const starting=lineup.includes(player.id),research=mystery&&App.DuatMystery?.isCard(player)&&App.DuatMysteryUI;
                const report=research?compared.report:null;
                return <div key={player.id} className={'duat-player-entry duat-lineup-entry'+(starting?' is-starting':'')} data-player-id={player.id}>
                    <label className={'duat-player duat-lineup-toggle'+(starting?' starting':'')} title={disabled?'Starting lineup':`${starting?'Bench':'Start'} ${player.name}`}>
                        <input type="checkbox" aria-label={`${player.name}, ${player.position}, starting lineup`} disabled={disabled} checked={starting} onChange={()=>onChange(starting?lineup.filter(id=>id!==player.id):[...lineup,player.id])}/>
                        <span className={'duat-position duat-lineup-position is-'+player.position.toLowerCase()} aria-hidden="true">{player.position}<span className="duat-lineup-selected-mark">✓</span></span>
                    </label>
                    {research?<App.DuatMysteryUI.Explorer compact campaign={campaign} player={player} data={data} throughWeek={throughWeek} factionId={factionId} report={report}/>:<span className="duat-player-name duat-lineup-name"><strong>{player.name}</strong><small>{mystery?App.DuatMystery.playerLabel(player):estimate.label}</small></span>}
                    <div className="duat-lineup-stats">
                        {report?<><span className="duat-player-points duat-lineup-estimate" title={report.exact?'Known historical base points before offerings.':'This week’s average base points across matching public archive seasons.'}><strong>{report.available?Number(report.points).toFixed(1):'—'}</strong><small>{report.week<=17?`W${report.week} ${report.exact?'base':'est.'}`:'Complete'}</small></span><span className="duat-player-points duat-lineup-remaining" title="Remaining Duat weeks 1–17, including this week, before divine offerings."><strong>{report.available?`${report.exact?'':'~'}${Number(report.pointsLeft).toFixed(1)}`:'—'}</strong><small aria-label={report.exact?'Base points left':'Estimated points left'}><span className="duat-stat-prefix">{report.exact?'Base pts':'Est. pts'} </span>left</small></span></>:<span className="duat-player-points duat-lineup-estimate" title={`${estimate.label}. Estimated points per game, not a weekly projection.`}><strong>{Number(estimate.points||0).toFixed(1)}</strong><small>Est. PPG</small></span>}
                        {compared.lastWeek&&<span className="duat-player-points duat-lineup-last" title={`Week ${compared.lastWeek} completed score, including offerings`}><strong>{number(compared.lastPoints)}</strong><small>W{compared.lastWeek}</small></span>}
                    </div>
                </div>;
            })}</div>
            {App.GamePlayerComparison&&<div className="duat-lineup-comparison"><App.GamePlayerComparison rows={comparison.rows} columns={columns} scoutingForRow={comparison.scoutingForRow} workspaceKey={['duat-lineup',campaign.id,campaign.dynastySeason||1,factionId,army?.id,throughWeek].join(':')} title="Compare your start / bench choices" onSelect={mystery?player=>{const toggle=root.document?.getElementById(`duat-lineup-research-${factionId}-${player.id}-toggle`);if(toggle){if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();toggle.focus({preventScroll:true});toggle.scrollIntoView({block:'center',behavior:'smooth'});}}:undefined}/><p className="duat-muted">Choose two or three players. Legal-swap reasons use the same public scouting shown here, before offerings. Comparing players never changes your lineup.</p></div>}
            <button className="duat-link" disabled={disabled} onClick={()=>onChange(E.recommendedLineup(campaign,factionId))}>Suggest a legal lineup</button>
        </section>;
    }
    function Kickoff({campaign,factionId,room,ready,preparation}){
        const faction=campaign.factions.find(item=>item.id===factionId),declared=faction.declaredFavors||[];
        return <section className="duat-panel duat-weekly-kickoff"><span className="duat-eyebrow">WEEK {campaign.week} · YOUR PREPARATION</span><h3>Your army is ready to take the field.</h3><div className="duat-weekly-checks"><p><span aria-hidden="true">✓</span>{faction.lineup.length} starters confirmed</p><p><span aria-hidden="true">✓</span>{declared.length?`${declared.length} divine ${declared.length===1?'offering':'offerings'} reserved`:'No starter offerings reserved'}</p></div>{preparation?.heptad?.next?.label&&<p className="duat-notice"><strong>The {App.DuatHeptad.tournamentName(campaign.alliances)} · </strong>{preparation.heptad.next.label}</p>}{preparation?.notes?.filter(note=>typeof note==='string').map((note,index)=><p className="duat-muted" key={index}>{note}</p>)}{room&&<><p>{ready?'Your faction is ready. The host starts the games once everyone is ready.':'Mark your faction ready when your choices are final.'}</p><div className="duat-weekly-seats">{room.seats.filter(seat=>seat.controller==='human').map(seat=><span key={seat.factionId} className={seat.ready?'is-ready':''}>{App.DuatPresentation.nameOf(seat.factionId)} · {seat.ready?'Ready':seat.joined?'Preparing':'Not joined'}</span>)}</div></>}</section>;
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
    function RivalMoment({rows=[],factionId}){
        const own=rows.find(row=>row.factionId===factionId);
        if(!own||!Number.isFinite(own.points))return null;
        const rivals=rows.filter(row=>row.factionId!==factionId&&Number.isFinite(row.points));
        const above=rivals.filter(row=>row.points>own.points).sort((a,b)=>a.points-b.points)[0];
        const tied=rivals.find(row=>row.points===own.points);
        const below=rivals.filter(row=>row.points<own.points).sort((a,b)=>b.points-a.points)[0];
        const rival=above||tied||below;if(!rival)return null;
        const gap=Math.abs(own.points-rival.points).toFixed(2);
        return <section className="duat-rival-moment" aria-label="The margin that mattered"><span className="duat-eyebrow">{above?'ONE MORE RIVAL TO CATCH':tied?'A SHARED SUMMIT':'YOU LED THE FIELD'}</span><h3>{above?`${gap} points behind ${rival.name}`:tied?`Level with ${rival.name}`:`${gap} points clear of ${rival.name}`}</h3><p>{above?'That was the gap to your nearest higher-scoring rival this week. Matching their score would turn that all-play loss into a tie.':tied?'You shared the highest score this week. Equal scores count as ties in the all-play standings.':'Your lineup outscored every rival this week. Each lower score adds a win to your all-play record.'}</p></section>;
    }
    function Recap({campaign,factionId,week,result,data,onAction,busy}){
        if(!result)return <p>The weekly report is unavailable.</p>;
        const all=result.allPlay,playoff=result.playoff,favors=result.favors;
        const meaningfulPlayoff=Boolean(playoff?.match&&playoff.label);
        return <div className="duat-weekly-recap">{App.DuatMysteryUI&&<App.DuatMysteryUI.Recap campaign={campaign} factionId={factionId} data={data} throughWeek={week} onAction={onAction} busy={busy}/>}<section className="duat-panel"><span className="duat-eyebrow">WEEK {week} · {App.DuatPresentation.nameOf(factionId)}</span><h3 className="duat-weekly-recap-outcome">{meaningfulPlayoff?playoff.label:all?.label||'Your weekly result'}</h3><div className="duat-weekly-recap-grid"><div><strong>{Number(all?.points||0).toFixed(2)}</strong><small>Fantasy points</small></div><div><strong>{all?.wins||0}–{all?.losses||0}{all?.ties?`–${all.ties}`:''}</strong><small>All-play W–L{all?.ties?'–T':''}</small></div><div><strong>{all?.tiedForPlace?'=':''}{all?.place||'—'} / {all?.fieldSize||campaign.factions.length}</strong><small>Weekly place</small></div></div><p className="duat-muted">Your score faced every rival. {all?.ties?'Tied scores share the result.':'Every lower score is a win; every higher score is a loss.'}</p>{!meaningfulPlayoff&&playoff?.status!=='not-started'&&playoff?.label&&<p className="duat-notice">{playoff.label}</p>}{meaningfulPlayoff&&playoff.opponentName&&<p>{playoff.opponentName}: {Number(playoff.opponentPoints||0).toFixed(2)} points.</p>}{favors&&(favors.events?.length>0||favors.spent>0)&&<details className="duat-weekly-recap-section"><summary>Divine receipts · {favors.spent||0} favor spent</summary><p>{Number(favors.playerDelta||0).toFixed(1)} points from player favors · {Number(favors.teamAdjustment||0).toFixed(1)} from team rituals.</p>{favors.events.map((event,index)=><p key={event.id||index}>{event.name||event.message||'Divine offering'}{event.reason?' · '+event.reason:''}{event.ritualId==='ebisu-result'?` · ${event.success?'Wager won':'Wager lost'} · ${event.beforePoints} → ${event.afterPoints} points`:event.status==='applied'?` · ${event.beforePoints} → ${event.afterPoints} points`:''}</p>)}</details>}</section><RivalMoment rows={result.weeklyStandings} factionId={factionId}/><div className="duat-weekly-recap-section"><WeeklyStandings week={week} rows={result.weeklyStandings} factionId={factionId}/></div><div className="duat-weekly-recap-section"><App.DuatHeptadUI.WeeklyRecap campaign={campaign} factionId={factionId} week={week}/></div></div>;
    }
    App.DuatWeeklyUI={Frame,Preparation,Kickoff,ConquestNote,WeeklyStandings,RivalMoment,Recap,lineupComparison};
})(typeof window!=='undefined'?window:globalThis);
