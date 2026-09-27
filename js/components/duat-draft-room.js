/* global React */
(function () {
    'use strict';
    const {useState, useEffect, useLayoutEffect, useMemo, useRef} = React;
    const App = window.App, positions = ['QB', 'RB', 'WR', 'TE'];
    const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
    const pointsOf = player => [player.estimate?.points, player.estimatedPoints, player.referencePoints].find(Number.isFinite);
    const queueKey = (campaign, factionId, army) => 'wr-duat-draft-queue:' + [campaign.id, campaign.dynastySeason || 1, factionId, army?.id || 'waiting'].map(encodeURIComponent).join(':');
    function readQueue(key) {
        try { const value = JSON.parse(window.localStorage.getItem(key) || '[]'); return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))].slice(0, 100) : []; } catch (_) { return []; }
    }
    function priorSeasons(player, data, campaign) {
        // Never use the scoring season, private year or unwatched results.
        if (!Number.isInteger(player.season) || Number.isInteger(player.decade)) return [];
        const cards = data?.cards?.values ? [...data.cards.values()] : Array.isArray(data?.cards) ? data.cards : data?.cards?.players || [];
        const card = cards.find(item => item.identity === player.identity);
        return (card?.seasons || []).filter(item => Number.isInteger(item.season) && item.season < player.season && item.games > 0).map(item => {
            const points = campaign.version >= 3 && App.TimeLeagueSeason?.scoreStatLine ? App.TimeLeagueSeason.scoreStatLine(item, campaign.scoring, {}) : item.points;
            return {year: item.season, games: item.games, points, ppg: Number.isFinite(points) ? points / item.games : null};
        }).sort((a, b) => b.year - a.year);
    }
    function readWorkspace(key) {
        try {const value=JSON.parse(window.localStorage.getItem(key+':view')||'{}');return {query:typeof value.query==='string'?value.query.slice(0,160):'',decade:['ALL','2000','2010','2020'].includes(value.decade)?value.decade:'ALL'};} catch(_){return {query:'',decade:'ALL'};}
    }
    function candidateRows(source, {busy, myTurn, ownedIds=new Set()}) {
        return source.map((player, index) => {
            const drafted=ownedIds.has(player.id),researchOnly=!myTurn;
            return {...player,rank:index+1,drafted,draftedBy:drafted?'Your army':undefined,researchOnly,
                detail:Number.isInteger(player.decade)?`${player.decade}s · ${player.candidateYears?.length||0} possible seasons`:player.referenceSeason?`${player.referenceSeason} reference season`:'No prior season · baseline estimate',
                canDraft:myTurn&&!busy&&!drafted&&player.eligible!==false&&player.canDraft!==false,
                draftDisabledReason:!myTurn?'Research between picks. Availability is checked on your turn.':busy?'Saving your pick…':drafted?'Already in your army.':player.eligible===false||player.canDraft===false?'This pick would not leave a legal army.':''};
        });
    }
    function scoutingForRow(player, {needs={},mystery=false}={}) {
        const estimate=number(pointsOf(player)),count=player.candidateYears?.length||0;
        const fit=needs[player.position]>0?`Fills one of your ${player.position} starting places.`:player.position!=='QB'&&needs.FLEX>0?'Can fill one of your open flex places.':needs.SUPER_FLEX>0?'Can fill your open superflex place.':`Adds ${player.position} depth to this army.`;
        return {subtitle:player.drafted?'Already recruited':player.researchOnly?'Research only · availability checked on your turn':'Eligible for your current pick',
            summary:mystery?`${estimate} points per calendar week across ${count} eligible archive seasons (NFL Weeks 1–17).`:player.referenceSeason?`${estimate} points per recorded game in ${player.referenceSeason}, used as the draft reference.`:`${estimate} points per game is the position baseline; no prior-season reference is available.`,
            reason:fit,confidence:mystery?(count===1?'One public candidate season.':'The fixed scoring year remains unresolved; the average is not a probability.'):(player.referenceSeason?'Prior-season reference; current season results remain sealed.':'Limited evidence · position baseline.'),
            metrics:[{label:mystery?'Archive avg / week':'Reference PPG',value:estimate},{label:mystery?'Possible seasons':'Reference season',value:mystery?String(count):player.referenceSeason||'Baseline'},{label:'Roster fit',value:needs[player.position]>0?player.position:player.position!=='QB'&&needs.FLEX>0?'Flex':needs.SUPER_FLEX>0?'Superflex':'Depth'}]};
    }
    function PlayerCard({player, campaign, factionId, data, mystery, queued, onQueue, onDraft, onClose, returnFocus, scouting}) {
        const panel = useRef(null), close = useRef(null);
        useLayoutEffect(() => {
            const previous = returnFocus || document.activeElement, overflow = document.body.style.overflow;
            close.current?.focus(); document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
        }, []);
        const onKeyDown = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
            if (event.key !== 'Tab') return;
            const items = [...panel.current.querySelectorAll('button:not([disabled]), select, input, textarea, a[href], [tabindex="0"], summary')].filter(item => item.getClientRects().length);
            if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        };
        const seasons = useMemo(() => mystery ? [] : priorSeasons(player, data, campaign), [player, data, campaign, mystery]);
        return <div className="duat-draft-card-backdrop" onClick={event => {if (event.target === event.currentTarget) onClose();}}>
            <section ref={panel} className="duat-draft-player-card" role="dialog" aria-modal="true" aria-labelledby="duat-draft-card-name" onKeyDown={onKeyDown}>
                <header><div><span className="duat-eyebrow">DRAFT SCOUTING · {player.position}</span><h2 id="duat-draft-card-name">{player.name}</h2><strong className="duat-player-season">{mystery ? `${player.decade}s` : `${player.season} army`}</strong></div><button type="button" ref={close} className="duat-button" aria-label="Close player card" onClick={onClose}>Close ✕</button></header>
                <dl className="duat-draft-card-metrics"><div><dt>{mystery ? 'Archive avg/week' : 'Est. PPG'}</dt><dd>{number(pointsOf(player))}</dd></div><div><dt>{mystery ? 'Possible seasons' : 'Reference season'}</dt><dd>{mystery ? player.candidateYears?.length || '—' : player.referenceSeason || 'Baseline'}</dd></div><div><dt>Availability</dt><dd>{player.drafted ? 'Your army' : player.researchOnly ? 'Unconfirmed' : 'Available'}</dd></div></dl>
                <p className="duat-muted">{mystery ? 'This average covers the eligible archive seasons. The ruler’s origin does not identify the fixed scoring year.' : `The estimate uses a prior season or a position baseline. ${player.season} scoring results remain sealed.`}</p>
                {scouting&&<section className="duat-draft-fit"><h3>Why this player fits</h3><p>{scouting.reason}</p><small>{scouting.confidence}</small></section>}
                {mystery && App.DuatMysteryUI?.Explorer ? <App.DuatMysteryUI.Explorer campaign={campaign} player={player} data={data} throughWeek={0} factionId={factionId}/> : <section className="duat-draft-history"><h3>Previous seasons</h3>{seasons.length ? <div className="duat-table-wrap"><table><caption>Public history before the {player.season} army season · campaign scoring</caption><thead><tr><th scope="col">Season</th><th scope="col">Games</th><th scope="col">Points</th><th scope="col">PPG</th></tr></thead><tbody>{seasons.map(season => <tr key={season.year} className={season.year === player.referenceSeason ? 'is-reference' : ''}><th scope="row">{season.year}{season.year === player.referenceSeason && <small> Reference</small>}</th><td>{season.games}</td><td>{number(season.points)}</td><td>{number(season.ppg)}</td></tr>)}</tbody></table></div> : <p className="duat-muted">{data ? 'No prior-season history is available for this player. Use the labeled baseline estimate.' : 'The historical archive is loading. The public estimate above remains available.'}</p>}</section>}
                <footer>{!player.drafted && <button type="button" className="duat-button" aria-pressed={queued} onClick={() => onQueue(player)}>{queued ? 'Remove from queue' : 'Add to queue'}</button>}<button type="button" className="duat-button primary" disabled={!player.canDraft} title={player.draftDisabledReason} onClick={() => onDraft(player)}>{player.drafted ? 'Already in your army' : player.researchOnly ? 'Available to draft on your turn' : 'Draft ' + player.name}</button></footer>
            </section>
        </div>;
    }
    function Draft({campaign, factionId, data, online, host, canAdvance, onAction, busy, actionError}) {
        const Engine = App.DuatCampaign, {Sigil, nameOf, art} = App.DuatPresentation;
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false, ArmyContainer = phone ? 'details' : 'aside';
        const [selectedId,setSelectedId]=useState(''),[pending,setPending]=useState(null);
        const cardTrigger=useRef(null),pendingRef=useRef(null);
        const selectPlayer=(player,event)=>{cardTrigger.current=event?.currentTarget?.querySelector?.('.game-draft-player-link')||event?.currentTarget||document.activeElement;setSelectedId(player.id);};
        const mystery=App.DuatMystery?.enabled(campaign),turn=online?campaign.draft.turn:Engine.draftTurn(campaign);
        const faction=campaign.factions.find(item=>item.id===factionId),waiting=campaign.draft.status==='waiting',myTurn=!waiting&&turn?.factionId===factionId;
        const personalArmies=faction.armies.filter(army=>!army.destroyed);
        const scouting=useMemo(()=>online?campaign.draft.scouting:data&&Engine.draftScouting?Engine.draftScouting(campaign,factionId,data):null,[campaign,factionId,data,online]);
        const currentIndex=Math.max(0,(turn?.armyNumber?turn.armyNumber-1:undefined)??Math.floor(campaign.draft.cursor/(campaign.factions.length*Engine.rosterSize(campaign))));
        const active=personalArmies.find(army=>army.id===(myTurn?turn?.armyId:scouting?.armyId))||personalArmies.find(army=>army.id===scouting?.armyId)||personalArmies[Math.min(personalArmies.length-1,currentIndex)];
        const armyIndex=Math.max(0,personalArmies.indexOf(active)),key=queueKey(campaign,factionId,active);
        const [workspace,setWorkspace]=useState(()=>({key,...readWorkspace(key)}));
        const view=workspace.key===key?workspace:readWorkspace(key),decade=view.decade,query=view.query;
        const saveWorkspace=patch=>{const next={key,...view,...patch};setWorkspace(next);try{window.localStorage.setItem(key+':view',JSON.stringify({query:next.query,decade:next.decade}));}catch(_){/* In-memory preferences remain usable. */}};
        const setDecade=decade=>saveWorkspace({decade});
        const [queue,setQueue]=useState(()=>({key,ids:readQueue(key)})),queuedIds=queue.key===key?queue.ids:readQueue(key);
        const source=useMemo(()=>{
            if(waiting)return [];
            // The online research board comes only from the approved server
            // view; never derive availability from an archive or rival rosters.
            if(!myTurn)return scouting?.version===1?scouting.rows||[]:[];
            return online?campaign.draft.candidates||[]:data?Engine.draftCandidates(campaign,data):[];
        },[campaign,data,online,myTurn,waiting,scouting]);
        const ownPlayers=personalArmies.flatMap(army=>army.players),ownedIds=new Set(ownPlayers.map(player=>player.id));
        const currentPending=pending?.key===key?pending:null,pickSaving=['saving','confirming'].includes(currentPending?.status);
        const rows=useMemo(()=>candidateRows(source,{busy:busy||pickSaving,myTurn,ownedIds}),[source,busy,pickSaving,myTurn,ownPlayers.map(player=>player.id).join('|')]);
        const legalIds=new Set(rows.filter(player=>!player.drafted).map(player=>player.id));
        const availableQueue=queuedIds.filter(id=>!ownedIds.has(id)&&(!myTurn||legalIds.has(id))),queueRows=availableQueue.map(id=>rows.find(player=>player.id===id)).filter(Boolean);
        const recruitedArmy=personalArmies.find(army=>army.players.some(player=>player.id===selectedId)),recruited=recruitedArmy?.players.find(player=>player.id===selectedId);
        const selected=rows.find(player=>player.id===selectedId)||recruited&&{...recruited,season:recruitedArmy.season,drafted:true,canDraft:false};
        const nextTurnIndex=(campaign.draft.queue||[]).findIndex((pick,index)=>index>=campaign.draft.cursor&&pick.factionId===factionId);
        const slots=Engine.slotsOf(faction),needs=Engine.shortages?Engine.shortages(active?.players||[],slots):{};
        const needText=Object.entries(needs).filter(([,count])=>count>0).map(([position,count])=>`${count} ${position.replace('SUPER_FLEX','Superflex')}`).join(' · ');
        const scoutPlayer=player=>scoutingForRow(player,{needs,mystery});
        const lastOwnPick=(campaign.draft.picks||[]).filter(pick=>pick.factionId===factionId).at(-1);
        useEffect(()=>{setSelectedId('');setPending(null);pendingRef.current=null;},[key]);
        useEffect(()=>{if(selectedId&&!selected)setSelectedId('');},[selectedId,selected]);
        useEffect(()=>{
            if(currentPending&&ownedIds.has(currentPending.playerId)&&currentPending.status!=='success'){
                setPending(previous=>previous?.key===key?{...previous,status:'success'}:previous);pendingRef.current=null;setSelectedId('');
            }
        },[key,currentPending?.playerId,currentPending?.status,ownPlayers.map(player=>player.id).join('|')]);
        const saveQueue=ids=>{const unique=[...new Set(ids)].slice(0,100);setQueue({key,ids:unique});try{window.localStorage.setItem(key,JSON.stringify(unique));}catch(_){/* Queue still works for this visit. */}};
        const toggleQueue=player=>saveQueue(queuedIds.includes(player.id)?queuedIds.filter(id=>id!==player.id):[...availableQueue,player.id]);
        const draft=async player=>{
            if(!player.canDraft||!myTurn||busy||pendingRef.current)return;
            const attempt={key,playerId:player.id,name:player.name,status:'saving'};pendingRef.current=attempt;setPending(attempt);
            try{
                const accepted=await onAction({type:'draft-pick',playerId:player.id});
                if(pendingRef.current!==attempt)return;
                if(accepted===false){setPending({...attempt,status:'rejected'});pendingRef.current=null;}
                else setPending({...attempt,status:'confirming'});
            }catch(error){if(pendingRef.current===attempt){setPending({...attempt,status:'rejected',message:error?.message});pendingRef.current=null;}}
        };
        const columns = [{key: 'estimate', label: mystery ? 'Archive avg/week' : 'Est. PPG', title: mystery ? 'Average across every eligible archive season, not the hidden selected year.' : 'Prior-season points per game or a position baseline.', getValue: pointsOf, render: player => number(pointsOf(player)), defaultDirection: 'desc'}, mystery ? {key: 'seasons', label: 'Seasons', title: 'Eligible public archive seasons', getValue: player => player.candidateYears?.length} : {key: 'reference', label: 'Reference', title: 'Prior season used for the estimate', getValue: player => player.referenceSeason, render: player => player.referenceSeason || 'Baseline', defaultDirection: 'desc'}];
        const overview = <>
            <div className="duat-chapter-banner" style={{backgroundImage: `linear-gradient(90deg,rgba(13,19,25,.94),rgba(13,19,25,.25)),url(${art('hero')})`}}><span className="duat-eyebrow">CHAPTER I · THE MUSTERING</span><h2>{campaign.dynastySeason > 1 ? 'The dynasty continues.' : personalArmies.length + ' ' + (personalArmies.length === 1 ? 'army.' : 'armies.')} Your choices.</h2><p>Draft {Engine.rosterSize(campaign)} players for each ruler. The archaeologist will discover which army returns to command the season.</p><div className="duat-chapter-steps"><span className="active">I · Draft</span><span>II · Excavation</span><span>III · {Engine.settingsOf(campaign).conquest ? 'Conquest' : 'The season'}</span></div></div>
            <div className="duat-draft-years">{personalArmies.map((army, index) => <div key={army.id} className={index === armyIndex ? 'active' : army.players.length === Engine.rosterSize(campaign) ? 'complete' : ''}><span>{campaign.version === 4 ? army.rulerName : <>Ruler {index + 1}</>}</span><strong>{mystery ? 'Origin ' + army.season : army.season}</strong><small>{army.players.length}/{Engine.rosterSize(campaign)} recruited</small></div>)}</div>
        </>;
        return <section className="duat-draft-scene duat-draft-room">
            {phone ? <details className="duat-phone-disclosure duat-draft-overview"><summary>Your draft · {personalArmies.length} {personalArmies.length === 1 ? 'army' : 'armies'}</summary>{overview}</details> : <details className="duat-draft-overview duat-panel"><summary>Draft overview · {personalArmies.length} {personalArmies.length === 1 ? 'army' : 'armies'} · {Engine.rosterSize(campaign)} players each</summary>{overview}</details>}
            {waiting ? <div className="duat-panel duat-draft-start"><span className="duat-eyebrow">THE COUNCIL IS ASSEMBLED</span><h2>Build the army you want to command.</h2><p>{campaign.version === 4 ? `${campaign.draft.queue.filter(pick => pick.factionId === factionId).length} picks remain for your faction. Surviving players keep their places; new rulers and depleted tombs are filled in snake order.` : `${campaign.seasons.length} snake drafts of ${Engine.rosterSize(campaign)} rounds.`} Each army must fill {slots.join(' · ').replaceAll('SUPER_FLEX', 'Superflex')}, plus {Engine.settingsOf(campaign).bench} bench {Engine.settingsOf(campaign).bench === 1 ? 'place' : 'places'}. You make every pick for your faction; AI rulers make their own.</p><button className="duat-button primary" disabled={busy || !host || !canAdvance || !data} onClick={() => onAction({type: 'start-draft'})}>{busy ? 'Opening the draft…' : 'Open the draft'}</button>{online && !canAdvance && <p className="duat-muted">Every human faction must join and mark ready before the host opens the draft.</p>}</div> : <>
                <div className="duat-draft-command-bar"><div><span className="duat-eyebrow">{mystery ? 'ORIGIN ' : ''}{turn?.season || active?.season} · RULER {turn?.armyNumber || armyIndex + 1} · ROUND {turn?.round || Math.floor(campaign.draft.cursor % (campaign.factions.length * Engine.rosterSize(campaign)) / campaign.factions.length) + 1}</span><h2>{myTurn ? 'You’re on the clock.' : `${nameOf(turn?.factionId)} is choosing.`}</h2></div><div><strong>Pick {campaign.draft.cursor + 1}<small> / {campaign.draft.totalPicks}</small></strong><span>{myTurn ? 'Choose a player below' : nextTurnIndex >= 0 ? `Your next pick: ${nextTurnIndex + 1}` : 'Waiting for your faction'}</span></div><div className="duat-replay-track"><div style={{width: `${campaign.draft.cursor / campaign.draft.totalPicks * 100}%`}}/></div></div>
                {currentPending&&<div className={'duat-draft-pick-feedback is-'+currentPending.status} role={currentPending.status==='rejected'?'alert':'status'} aria-live="polite"><strong>{currentPending.status==='success'?currentPending.name+' joined your army.':currentPending.status==='rejected'?'Pick not saved.':currentPending.status==='confirming'?'Checking your saved pick…':'Saving '+currentPending.name+'…'}</strong><span>{currentPending.status==='success'?(myTurn?'You are on the clock again. Compare the board and choose your next recruit.':'Keep scouting and queueing while the other factions choose.'):currentPending.status==='rejected'?(currentPending.message||actionError||'The room may have changed. Review the refreshed board and select your pick again.'):'Your shortlist stays in place. A pick is confirmed only when it appears in your army.'}</span>{currentPending.status==='rejected'&&<button type="button" className="duat-button" onClick={()=>setPending(null)}>Return to board</button>}</div>}
                <div className="duat-draft-layout"><section className="duat-panel duat-draft-board"><div className="duat-draft-roster-summary"><strong>{active?.rulerName || 'Your army'} · {active?.players.length || 0}/{Engine.rosterSize(campaign)}</strong><span>{needText ? `Starting slots to fill: ${needText}` : 'Starting positions covered · build your bench'}</span></div>
                    {(myTurn||scouting?.version===1) ? <App.GameDraftTable key={key} preferenceKey="duat" workspaceKey={key} scoutingForRow={scoutPlayer} query={query} onQueryChange={query=>saveWorkspace({query})} countNoun={myTurn?undefined:"scouting cards"} rows={rows.filter(player => decade === 'ALL' || player.decade === Number(decade))} columns={columns} title="Draft board" statusText={!myTurn?'Public research for your next army. Availability is checked on your turn; rival selections remain sealed.':mystery ? 'Archive averages cover every eligible season. The fixed scoring year remains hidden.' : `Estimates use seasons before ${turn?.season || active?.season}. This season’s results remain sealed.`} positionOptions={['QB', 'RB', 'WR', 'TE', {value: 'FLEX', label: 'Flex', positions: ['RB', 'WR', 'TE']}]} selectedId={selectedId} onSelect={selectPlayer} queuedIds={availableQueue} onToggleQueue={toggleQueue} onDraft={draft} draftLabel="Draft" pageSize={phone ? 20 : 40} filterControls={mystery ? <label>Decade<select aria-label="Draft decade" value={decade} onChange={event => setDecade(event.target.value)}><option value="ALL">All decades</option>{[...new Set(rows.map(player => player.decade))].sort().map(year => <option key={year} value={year}>{year}s</option>)}</select></label> : null} externalFilterKey={decade} hasExternalFilters={decade !== 'ALL'} onClearFilters={() => saveWorkspace({decade:'ALL',query:''})} emptyText={!data && !online ? 'Loading the historical archive…' : 'No eligible players match these filters.'}/> : <p className="duat-notice" role="status">The room updates automatically. Your draft board opens when the draft reaches {nameOf(factionId)}. You can review your army while you wait.</p>}
                </section><ArmyContainer className="duat-side-stack duat-draft-army-details">{phone && <summary>Your queue & army · {active?.players.length || 0}/{Engine.rosterSize(campaign)} recruited</summary>}
                    <section className="duat-panel duat-draft-queue"><div className="duat-panel-heading"><h3>Your queue</h3><span className="duat-pill">{availableQueue.length}</span></div><p className="duat-muted">Saved for this army on this browser. Queuing never makes a pick.</p>{queueRows.length ? <ol>{queueRows.map(player => <li key={player.id}><button type="button" className="duat-draft-player-link" onClick={event => selectPlayer(player, event)}><strong>{player.name}</strong><small>{player.position} · {mystery ? player.decade + 's · ' : ''}{number(pointsOf(player))} {mystery ? 'avg/wk' : 'est. PPG'}</small></button><button type="button" className="duat-button" aria-label={'Remove ' + player.name + ' from queue'} onClick={() => toggleQueue(player)}>×</button></li>)}</ol> : <p className="duat-muted">{availableQueue.length ? 'Your queued players will appear when your board opens and they are still eligible.' : 'Use the star beside a player to build your shortlist.'}</p>}</section>
                    <section className="duat-panel duat-drafted-army"><span className="duat-eyebrow">YOUR {mystery ? 'ORIGIN ' : ''}{active?.season} ARMY</span><h3><Sigil id={factionId}/>{nameOf(factionId)}</h3><div className="duat-draft-position-counts">{positions.map(position => <span key={position}><strong>{active?.players.filter(player => player.position === position).length || 0}</strong> {position}</span>)}</div>{active?.players.map(player => <button type="button" className={'duat-army-player duat-draft-player-link'+(lastOwnPick?.playerId===player.id?' is-new-pick':'')} key={player.id} onClick={event => selectPlayer(player, event)}><span>{player.position}</span><strong>{player.name}</strong><small>{lastOwnPick?.playerId===player.id?'Latest pick · View card ›':'View card ›'}</small></button>)}{!active?.players.length && <p className="duat-muted">Your first recruit will appear here.</p>}<p className="duat-muted">{Math.max(0, Engine.rosterSize(campaign) - (active?.players.length || 0))} places left · {slots.join(' · ').replaceAll('SUPER_FLEX', 'Superflex')}</p></section>
                    <section className="duat-panel duat-draft-recent"><h3>Recent picks</h3>{campaign.draft.picks.slice(-6).reverse().map(pick => <div key={pick.number}><Sigil id={pick.factionId}/><span><strong>{nameOf(pick.factionId)}</strong><small>{pick.factionId === factionId ? pick.playerName : 'A sealed recruit joins the army'} · Pick {pick.number}</small></span></div>)}{!campaign.draft.picks.length && <p className="duat-muted">The first pick is on the clock.</p>}</section>
                    <details className="duat-panel"><summary>Your mummy armies</summary>{faction.armies.map(army => <div key={army.id}><h3>{army.rulerName || army.season}</h3><p className="duat-muted">{mystery ? 'Origin ' : ''}{army.season} · {army.players.length}/{Engine.rosterSize(campaign)} recruited</p>{army.players.map(player => <p className="duat-muted" key={player.id}>{player.position} · {player.name}</p>)}</div>)}</details>
                </ArmyContainer></div>
                <details className="duat-panel duat-draft-history-board"><summary>View draft board · {campaign.draft.picks.length} picks made</summary><p className="duat-muted">Follow every round. Rival recruits stay sealed until the excavation.</p><div className="duat-table-wrap" tabIndex="0" role="region" aria-label="Complete draft pick history"><table><caption>Draft history · all armies</caption><thead><tr><th scope="col">Pick</th><th scope="col">Round</th><th scope="col">Ruler</th><th scope="col">Faction</th><th scope="col">Player</th></tr></thead><tbody>{campaign.draft.picks.map(pick => <tr key={pick.number} className={pick.factionId === factionId ? 'is-mine' : ''}><th scope="row">{pick.number}</th><td>{pick.round}</td><td>{pick.armyNumber}</td><td>{nameOf(pick.factionId)}</td><td>{pick.factionId === factionId ? <button type="button" className="duat-draft-player-link" onClick={event => selectPlayer({id: pick.playerId}, event)}>{pick.playerName}</button> : 'Sealed recruit'}</td></tr>)}</tbody></table>{!campaign.draft.picks.length && <p className="duat-muted">No selections yet.</p>}</div></details>
            </>}
            {selected && <PlayerCard key={selected.id} player={selected} campaign={campaign} factionId={factionId} data={data} mystery={mystery} queued={availableQueue.includes(selected.id)} onQueue={toggleQueue} onDraft={draft} onClose={() => setSelectedId('')} returnFocus={cardTrigger.current} scouting={scoutPlayer(selected)}/>}
        </section>;
    }
    App.DuatDraftRoom = Draft;
    App.DuatDraftBoard = {candidateRows, priorSeasons, queueKey, readQueue, readWorkspace, scoutingForRow, PlayerCard};
})();
