/* global React, ReactDOM */
(function(root){
    'use strict';
    const App=root.App=root.App||{}, {useState,useEffect,useRef}=React;
    const Rituals=App.DuatRituals,Favors=App.DuatFavors;
    const base=location.pathname.includes('/dist-preview/')?'../':'';
    const portraitStyle=god=>({backgroundImage:`url("${base+god.art}")`,...(god.atlasIndex===null?{}:{backgroundSize:'300% 300%',backgroundPosition:`${god.atlasIndex%3*50}% ${Math.floor(god.atlasIndex/3)*50}%`})});
    function Portrait({god,className=''}){return <span className={'duat-divinity-portrait '+className} style={portraitStyle(god)} role="img" aria-label={`${god.name}, ${god.title}`}/>;}
    function FavorDialog({open,god,index,total,onClose,onStep,children}){
        const dialogRef=useRef(null),closeRef=useRef(null),gesture=useRef(null),returnFocus=useRef(null);
        useEffect(()=>{
            if(!open||typeof document==='undefined')return;
            const background=document.getElementById('root'),body=document.body,html=document.documentElement;
            const oldBody=body.style.overflow,oldHtml=html.style.overflow,oldInert=background?.inert;
            const scrollX=root.scrollX,scrollY=root.scrollY;
            returnFocus.current=document.activeElement;body.style.overflow='hidden';html.style.overflow='hidden';if(background)background.inert=true;
            closeRef.current?.focus({preventScroll:true});
            return()=>{body.style.overflow=oldBody;html.style.overflow=oldHtml;if(background)background.inert=oldInert;root.scrollTo?.(scrollX,scrollY);if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});};
        },[open]);
        useEffect(()=>{if(open&&dialogRef.current)dialogRef.current.scrollTop=0;gesture.current=null;},[god.id,open]);
        function keydown(event){
            if(event.key==='Escape'){event.preventDefault();onClose();return;}
            if(event.key==='Tab'){
                const items=[...dialogRef.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(node=>node.getClientRects().length);
                const first=items[0],last=items.at(-1);if(!first)return;
                if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialogRef.current)){event.preventDefault();last.focus();}
                else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
                return;
            }
            if(!event.target.closest('input,select,textarea,[role="slider"]')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();onStep(event.key==='ArrowLeft'?-1:1);}
        }
        function startGesture(event){gesture.current=null;if(event.target.closest('button,input,select,textarea,a,summary,label,[role="slider"]'))return;gesture.current={x:event.clientX,y:event.clientY,id:event.pointerId};}
        function finishGesture(event){const start=gesture.current;gesture.current=null;if(!start||start.id!==event.pointerId)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.abs(dx)>=60&&Math.abs(dx)>Math.abs(dy)*1.5)onStep(dx<0?1:-1);}
        if(!open)return null;
        const content=<div className="duat-favor-overlay"><section className="duat-favor-dialog duat-divine-court" role="dialog" aria-modal="true" aria-labelledby="duat-favor-title" tabIndex="-1" ref={dialogRef} onKeyDown={keydown} onPointerDown={startGesture} onPointerUp={finishGesture} onPointerCancel={()=>{gesture.current=null;}}>
            <button ref={closeRef} className="duat-favor-close" onClick={onClose} aria-label="Close favor details"><span aria-hidden="true">×</span> Close</button>
            <div className="duat-favor-art">
                <Portrait god={god}/><div className="duat-favor-art-shade"/>
                <div className="duat-favor-art-caption"><span className="duat-eyebrow">{god.title}</span><h2>{god.name}</h2><p>{god.description}</p>
                    <nav className="duat-favor-carousel" aria-label="Browse gods"><button onClick={()=>onStep(-1)} aria-label="Previous god">←</button><span aria-live="polite">{index+1} / {total} gods<small>Swipe left or right to explore</small></span><button onClick={()=>onStep(1)} aria-label="Next god">→</button></nav>
                </div>
            </div><div className="duat-favor-detail">{children}</div>
        </section></div>;
        return typeof ReactDOM!=='undefined'&&ReactDOM.createPortal&&typeof document!=='undefined'?ReactDOM.createPortal(content,document.body):content;
    }
    function DuatRitualsView({campaign,factionId,onAction,busy=false,ready=false,dirty=false,readOnly=false,actionError='',availablePlayers=[],poolLoaded=true,lineup,guided=false}){
        const expanded=campaign.expansionVersion===1,faction=campaign.factions.find(f=>f.id===factionId),army=Rituals.activeArmy(faction),r=faction.rituals||{};
        const preseason=campaign.phase==='season'&&campaign.week===1&&!campaign.completedWeeks.length,champion=campaign.phase==='complete'&&campaign.championId===factionId;
        const catalog=expanded?Rituals.CATALOG:Favors.FAVORS,gods=Rituals.DEITIES.filter(g=>catalog.some(f=>f.deity===g.name));
        const initialGod=expanded?(champion?'amun':preseason?'mahdi':'kratos'):'kratos',initialChoice=expanded?(champion?'amun':preseason?'summon-mahdi':'kratos-1'):'kratos-1';
        const [godId,setGodId]=useState(initialGod),[choice,setChoice]=useState(initialChoice),[open,setOpen]=useState(false),[target,setTarget]=useState(''),[replacement,setReplacement]=useState(''),[position,setPosition]=useState('ALL'),[wager,setWager]=useState(r.ebisu?.wager||10),[sourceWeek,setSourceWeek]=useState(1),[confirm,setConfirm]=useState(false),[sending,setSending]=useState(false),[localError,setLocalError]=useState(''),[success,setSuccess]=useState('');
        const requestRef=useRef(false),pending=expanded?r.pendingMahdi:null,wasPending=useRef(Boolean(pending)),recruitRef=useRef(null);
        const god=gods.find(g=>g.id===godId)||gods[0],options=catalog.filter(f=>f.deity===god.name),selected=options.find(f=>f.id===(pending&&god.id==='mahdi'?pending.ritualId:choice))||options[0],isWeekly=Boolean(Favors.getFavor(selected.id,expanded?1:undefined));
        const availability=App.DuatFavorAvailability?.describe({campaign,factionId,busy:busy||sending,ready,dirty,readOnly,availablePlayers,poolLoaded,lineup,selection:{favorId:selected.id,target,replacement,position,wager,sourceWeek:selected.id==='janus-2'?campaign.week-1:sourceWeek,confirmed:confirm}})||{byId:{},selected:{available:false,reason:'The temple is loading. Please try again shortly.'},pending:{},reserved:0,availableFavor:faction.favorBalance};
        const selectedState=availability.selected,byId=availability.byId,locked=Boolean(availability.lockReason),entryLocked=locked||!byId[selected.id]?.available,reserved=availability.reserved,spare=availability.availableFavor;
        const declarations=expanded?(faction.declaredFavors||r.declaredFavors||[]):faction.declaredFavor?[faction.declaredFavor]:[];
        const targets=(isWeekly?army?.players||[]:selected.id==='amun'?availablePlayers:army?.players||[]).filter(p=>(byId[selected.id]?.targetIds||[]).includes(p.id));
        const buried=faction.armies.filter(a=>a.id!==army?.id&&!a.destroyed),replacementIds=selectedState.replacementIds||[],releaseIds=availability.pending?.releaseIds||[],needsTarget=isWeekly||['midas','anubis','amun'].includes(selected.id);
        const pendingHere=Boolean(pending&&god.id==='mahdi'),needsConfirmation=Boolean(selectedState.requiresConfirmation),numericCost=typeof selected.cost==='number'?selected.cost:null;
        const armyKey=(army?.players||[]).map(p=>p.id).join('|'),targetKey=(byId[selected.id]?.targetIds||[]).join('|');
        useEffect(()=>{setGodId(initialGod);setChoice(initialChoice);setConfirm(false);setOpen(false);setSuccess('');},[campaign.id,campaign.phase,campaign.dynastySeason]);
        useEffect(()=>{setConfirm(false);setReplacement('');setTarget(current=>targets.some(p=>p.id===current)?current:targets[0]?.id||'');},[selected.id,army?.id,armyKey,targetKey,campaign.week]);
        useEffect(()=>{const weeks=selectedState.sourceWeeks||[];if(weeks.length&&!weeks.includes(sourceWeek))setSourceWeek(weeks.at(-1));},[selected.id,target,(selectedState.sourceWeeks||[]).join('|')]);
        useEffect(()=>{if(pending){setGodId('mahdi');setChoice(pending.ritualId);setOpen(true);setConfirm(false);setReplacement('');}else if(wasPending.current)setOpen(false);wasPending.current=Boolean(pending);},[pending?.player?.id,pending?.rerolls]);
        useEffect(()=>{if(open&&pendingHere)recruitRef.current?.scrollIntoView({block:'start',behavior:'instant'});},[open,pending?.player?.id,pending?.rerolls]);
        function resetSelection(){setConfirm(false);setReplacement('');setTarget('');setLocalError('');setSuccess('');}
        function chooseGod(id){const next=gods.find(g=>g.id===id),choices=catalog.filter(f=>f.deity===next.name);setGodId(id);setChoice(id==='mahdi'&&pending?pending.ritualId:(choices.find(f=>byId[f.id]?.available)||choices[0]).id);resetSelection();}
        function stepGod(delta){chooseGod(gods[(gods.findIndex(g=>g.id===god.id)+delta+gods.length)%gods.length].id);}
        function openGod(id){if(id!==god.id)chooseGod(id);else if(id==='mahdi'&&pending)setChoice(pending.ritualId);setOpen(true);}
        function closeDetails(){setOpen(false);setConfirm(false);}
        function chooseTier(id){if(pendingHere)return;setChoice(id);resetSelection();}
        async function perform(action,message){
            if(requestRef.current)return;requestRef.current=true;setSending(true);setLocalError('');setSuccess('');
            try{const result=await onAction(action);if(result===false)setLocalError('This offering could not be completed. Check the message and try again.');else{setSuccess(message);setConfirm(false);}}
            catch(error){setLocalError(error?.message||'This offering could not be completed. Please try again.');}
            finally{requestRef.current=false;setSending(false);}
        }
        function ritual(ritualId,fields={},message='Your offering has been recorded.'){return perform({type:'ritual',ritualId,factionId,...fields},message);}
        function invoke(){
            if(!selectedState.available)return;
            if(isWeekly)return perform({type:'declare-favor',favorId:selected.id,playerId:target,...(selected.id==='janus-2'?{sourceWeek:campaign.week-1}:selected.id==='janus-3'?{sourceWeek}:{})},`${selected.name} is reserved for Week ${campaign.week}.`);
            return ritual(selected.id,{playerId:target,replacementId:replacement,position,wager,confirmed:confirm},selected.id==='ebisu'?'Your wager is reserved for this week.':'Your offering has been recorded.');
        }
        function pendingAction(kind,fields,message){if(!availability.pending?.[kind]?.available)return;return ritual('mahdi-'+kind,fields,message);}
        const offer=selected.id==='midas'&&target?(()=>{try{return Rituals.offeringValue(campaign,factionId,target);}catch{return null;}})():null;
        const guidance=campaign.settings?.favors===false?'Favors are turned off in this campaign. You can still explore the gods.':preseason&&expanded?'Explore the gods, or continue without an offering. Preseason rituals close when Week 1 is played.':champion&&expanded?'The Throne Room is yours. Explore the rewards before the next dynasty begins.':'Choose a god to explore their favors. Dimmed offerings explain when they become available.';
        const costLabel=numericCost===null?selected.cost:numericCost===0?'No favor required':numericCost+' favor';
        return <div className={'duat-divine-court'+(guided?' duat-guided-offerings':'')}>
            <section className="duat-panel duat-treasury"><div><span className="duat-eyebrow">{champion?'THE THRONE ROOM':'THE DIVINE TREASURY'}</span><h2>{pending?'Mahdi awaits your choice':'Call upon the gods'}</h2><p>{pending?'Your recruit is waiting. Accept or decline before continuing.':guidance}</p></div><dl><div><dt>Remaining</dt><dd>{faction.favorBalance}</dd></div><div><dt>Reserved</dt><dd>{reserved}</dd></div><div><dt>Available</dt><dd>{spare}</dd></div></dl></section>
            {success&&!open&&<p className="duat-favor-feedback success" role="status">{success}</p>}
            {pending&&<button className="duat-pending-invitation" onClick={()=>openGod('mahdi')}><strong>Return to Mahdi’s answer</strong><span>{pending.player.name} · accept or decline the waiting recruit →</span></button>}
            <div className="duat-divinity-grid" aria-label="Explore the gods">{gods.map(g=>{const choices=catalog.filter(f=>f.deity===g.name),usable=choices.filter(f=>byId[f.id]?.available),answer=g.id==='mahdi'&&pending,reason=answer?'A recruit is waiting for your answer.':usable.length?'Available now':byId[choices[0].id]?.reason||'Not available right now.';return <button key={g.id} className={'duat-divinity-card '+(!usable.length&&!answer?'unavailable':'')} onClick={()=>openGod(g.id)} aria-label={`${g.name} · ${reason}`}><Portrait god={g}/><span><strong>{g.name}</strong><small className={usable.length||answer?'duat-god-available':''}>{answer?'Recruit waiting':usable.length?'Available now':'Unavailable'}</small><small className="duat-card-reason">{reason}</small></span></button>;})}</div>
            <FavorDialog open={open} god={god} index={gods.findIndex(g=>g.id===god.id)} total={gods.length} onClose={closeDetails} onStep={stepGod}>
                <div className="duat-favor-detail-heading"><span className="duat-eyebrow">{selected.tier} · {selected.timing}</span><h2 id="duat-favor-title">{selected.name}</h2><span className="duat-favor-price">{costLabel}</span></div>
                <p className="duat-ritual-effect">{selected.id==='ebisu'?selected.effect.replace('Heptad contributor scores','Alliance contributor scores'):selected.effect}</p>
                {options.length>1&&!pendingHere&&<div className="duat-favor-tiers" aria-label={`${god.name} favors`}>{options.map(option=><button key={option.id} className={(option.id===selected.id?'selected ':'')+(!byId[option.id]?.available?'unavailable':'')} onClick={()=>chooseTier(option.id)} aria-pressed={option.id===selected.id}><span>{option.tier}</span><strong>{option.name}</strong><small>{typeof option.cost==='number'?(option.cost===0?'No favor required':option.cost+' favor'):option.cost}</small>{!byId[option.id]?.available&&<small className="duat-tier-reason">{byId[option.id]?.reason||'Unavailable'}</small>}</button>)}</div>}
                {selected.consequence&&<p className="duat-ritual-consequence">{selected.consequence}</p>}{selected.adaptation&&<details className="duat-ritual-adaptation"><summary>Historical campaign rule</summary><p>{selected.adaptation}</p></details>}
                {localError&&<p className="duat-favor-feedback error" role="alert">{actionError||localError}</p>}{success&&<p className="duat-favor-feedback success" role="status">{success}</p>}
                {pendingHere?<div className="duat-mahdi-reveal" ref={recruitRef} tabIndex="-1"><span className="duat-eyebrow">MAHDI HAS ANSWERED · D20 {pending.roll}</span><h3>{pending.player.name}</h3><p>{pending.player.position} · {pending.player.season} · {pending.rerolls?'Final draw':'One reroll remains'}</p><p>Your invocation is spent, even if you decline the recruit.</p>
                    <label className="duat-field">Make room in the walking army<select value={replacement} onChange={event=>{setReplacement(event.target.value);setConfirm(false);}} disabled={locked}><option value="">{army.players.length>=App.DuatCampaign.rosterSize(campaign)?'Choose a player to release':'Use an empty roster place'}</option>{army.players.filter(p=>releaseIds.includes(p.id)).map(p=><option key={p.id} value={p.id}>Release {p.name}</option>)}</select></label>
                    {availability.pending.requiresConfirmation&&<label className="duat-ritual-confirm"><input type="checkbox" checked={confirm} onChange={event=>setConfirm(event.target.checked)} disabled={locked}/>I accept {pending.ritualId==='super-mahdi'?(replacement?'releasing the selected player and ':'')+'the permanent loss of one random buried player.':'releasing the selected player from this army.'}</label>}
                    {!!declarations.length&&<div className="duat-pending-offerings"><p>Remove your reserved starter favors before accepting a new player.</p>{declarations.map(d=><button key={d.playerId} className="duat-link" disabled={locked} onClick={()=>perform({type:'clear-favor',playerId:d.playerId},'The reserved starter favor has been removed.')}>Remove {Favors.getFavor(d.favorId,1)?.name} · {army?.players.find(p=>p.id===d.playerId)?.name}</button>)}</div>}
                    {!availability.pending.accept?.available&&<p className="duat-favor-availability">{availability.pending.accept?.reason}</p>}
                    <div className="duat-actions"><button className="duat-button primary" disabled={!availability.pending.accept?.available} onClick={()=>pendingAction('accept',{replacementId:replacement,confirmed:confirm},'The recruit has joined your army.')}>Accept recruit</button><button className="duat-button" disabled={!availability.pending.reroll?.available} onClick={()=>pendingAction('reroll',{},'Mahdi has answered with a new recruit.')}>Roll once more · 20 favor</button>{!availability.pending.reroll?.available&&<small className="duat-favor-availability">{availability.pending.reroll?.reason}</small>}<button className="duat-link" disabled={!availability.pending.decline?.available} onClick={()=>pendingAction('decline',{},'Recruit declined. Your army is unchanged.')}>Decline recruit</button></div>
                </div>:<div className="duat-ritual-controls">
                    {needsTarget&&<label className="duat-field">{selected.id==='amun'?'Choose your next army’s recruit':isWeekly?'Choose a starter':'Choose a player in your walking army'}<select value={target} onChange={event=>{setTarget(event.target.value);setReplacement('');setConfirm(false);}} disabled={entryLocked||!targets.length}><option value="">Choose a player</option>{targets.map(p=><option key={p.id} value={p.id}>{p.name} · {p.position}{selected.id==='amun'?' · '+p.season:''}</option>)}</select></label>}
                    {selected.id==='anubis'&&<label className="duat-field">Call a player from a buried army<select value={replacement} onChange={event=>{setReplacement(event.target.value);setConfirm(false);}} disabled={entryLocked||!replacementIds.length}><option value="">Choose a buried player</option>{buried.map(a=><optgroup key={a.id} label={a.rulerName||String(a.season)}>{a.players.filter(p=>replacementIds.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.name} · {p.position} · {p.season||a.season}</option>)}</optgroup>)}</select></label>}
                    {selected.id.startsWith('janus')&&<label className="duat-field">Remember a completed week<select value={selected.id==='janus-2'?campaign.week-1:sourceWeek} onChange={event=>{setSourceWeek(Number(event.target.value));setConfirm(false);}} disabled={entryLocked||selected.id==='janus-2'||!selectedState.sourceWeeks?.length}><option value="">Choose a recorded week</option>{(selectedState.sourceWeeks||[]).map(week=><option key={week} value={week}>Week {week}</option>)}</select></label>}
                    {['mahdi','summon-mahdi','super-mahdi'].includes(selected.id)&&<label className="duat-field">Recruitment position<select value={position} onChange={event=>{setPosition(event.target.value);setConfirm(false);}} disabled={entryLocked||!selectedState.positionIds?.length}>{['ALL','QB','RB','WR','TE','FLEX'].map(p=><option key={p} value={p} disabled={!selectedState.positionIds?.includes(p)}>{p==='ALL'?'Any position':p}</option>)}</select></label>}
                    {selected.id==='ebisu'&&<div className="duat-ebisu-table" aria-label="Choose your wager">{Rituals.WAGERS.map(w=>{const valid=selectedState.wagerAmounts?.includes(w.amount);return <button key={w.amount} className={(w.amount===wager?'selected ':'')+(!valid?'unavailable':'')} aria-pressed={w.amount===wager} disabled={entryLocked||!valid} onClick={()=>{setWager(w.amount);setConfirm(false);}}><strong>{w.amount} points</strong><span>{w.chance*100}% win chance</span><small>{w.amount} favor reserved</small>{(entryLocked||!valid)&&<small>{byId[selected.id]?.reason||'Not enough available favor'}</small>}</button>;})}</div>}
                    {offer&&<p className="duat-notice">{offer.label}</p>}
                    {needsConfirmation&&<label className="duat-ritual-confirm"><input type="checkbox" checked={confirm} onChange={event=>setConfirm(event.target.checked)} disabled={entryLocked}/>I understand this permanently {selected.id==='shiva'?'destroys the walking ruler and its army.':selected.id==='anubis'?'banishes the replaced player and removes the recruit from its buried army.':'sacrifices the chosen player.'}</label>}
                    <div className={'duat-favor-availability '+(selectedState.available?'available':'')} role="status">{selectedState.available?'Available · your choice is ready.':selectedState.reason}</div>
                    <div className="duat-actions"><button className={'duat-button '+(needsConfirmation?'danger':'primary')} disabled={!selectedState.available} onClick={invoke}>{sending?'Recording your offering…':isWeekly?(declarations.some(d=>expanded?d.playerId===target:true)?'Replace reserved favor':'Reserve favor'):`Invoke ${god.name}`}{numericCost?' · '+numericCost+' favor':''}</button>{selected.id==='ebisu'&&r.ebisu&&<button className="duat-link" disabled={entryLocked} onClick={()=>ritual('ebisu-clear',{},'Your pending wager has been withdrawn.')}>Withdraw pending wager</button>}</div>
                </div>}
                <button className="duat-favor-back" onClick={closeDetails}>Return to the gods</button>
            </FavorDialog>
            {!!declarations.length&&<section className="duat-panel"><span className="duat-eyebrow">RESERVED FOR WEEK {campaign.week}</span><div className="duat-offering-list">{declarations.map(d=><div key={d.playerId}><div><strong>{Favors.getFavor(d.favorId,expanded?1:undefined)?.name}</strong><small>{army?.players.find(p=>p.id===d.playerId)?.name} · {d.cost} favor</small></div><button className="duat-link" disabled={locked} onClick={()=>perform({type:'clear-favor',...(expanded?{playerId:d.playerId}:{})},'The reserved favor has been removed.')}>Remove</button></div>)}</div></section>}
            {!guided&&expanded&&<details className="duat-panel duat-offering-archive"><summary>The ledger of offerings</summary>{r.ledger?.length?<ol className="duat-ritual-ledger">{[...r.ledger].reverse().slice(0,30).map((e,i)=><li key={e.id||i}><span className="duat-ledger-stamp">S{e.cycle} · W{e.week}{e.roll?' · d20 '+e.roll:''}</span><strong>{e.message||Rituals.CATALOG.find(c=>c.id===e.ritualId)?.name||e.ritualId}</strong><small>{e.ritualId==='ebisu-result'?`${e.beforePoints} → ${e.afterPoints} faction points · `:''}{e.credit?'+'+e.credit+' favor ':''}{e.cost?'−'+e.cost+' favor':''}{e.carry?' · '+e.carry+' carried':''}</small></li>)}</ol>:<p className="duat-muted">Your invocations and consequences will be recorded here.</p>}
                {campaign.completedWeeks.some(w=>w.factions.find(f=>f.factionId===factionId)?.favors?.length)&&<details><summary>Completed starter favors</summary>{[...campaign.completedWeeks].reverse().map(w=>{const result=w.factions.find(f=>f.factionId===factionId);return(result?.favors||[]).map((e,i)=><p key={w.week+'-'+i}>Week {w.week} · {result.players.find(p=>p.id===e.playerId)?.name||'Starter'} · {e.name||Favors.getFavor(e.favorId,1)?.name} · {e.status==='applied'?`${e.beforePoints} → ${e.afterPoints} points (${e.delta>=0?'+':''}${e.delta}) · ${e.cost} favor`:`${e.reason} No favor spent.`}</p>);})}</details>}
            </details>}
        </div>;
    }
    App.DuatDeityPortrait=Portrait;App.DuatFavorDialog=FavorDialog;App.DuatRitualsView=DuatRitualsView;
})(typeof window!=='undefined'?window:globalThis);
