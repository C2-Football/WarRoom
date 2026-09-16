/* global React */
(function(root){
    'use strict';
    const App=root.App=root.App||{}, {useState,useEffect,useRef}=React;
    function DuatCouncil({campaign,factionId,viewerFactionId,visibleThroughWeek=0,allianceVisible=false,onIntent,busy=false,error=null}){
        const Engine=App.DuatPersonalities;
        const available=(campaign?.factions||[]).filter(f=>Engine?.isAwake(campaign,f.id));
        const initial=factionId||available.find(f=>f.controller==='ai')?.id||available[0]?.id||'';
        const [selected,setSelected]=useState(initial),[localError,setLocalError]=useState(null),[sending,setSending]=useState(false);
        const scroll=useRef(null),requests=useRef({ids:{},inFlight:false}),pending=busy||sending;
        const targetId=available.some(f=>f.id===selected)?selected:initial;
        const view=Engine?.council({campaign,factionId:targetId,viewerFactionId,visibleThroughWeek,allianceVisible});
        useEffect(()=>{root.scrollTo?.({top:0,left:0,behavior:'auto'});},[]);
        useEffect(()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[targetId,view?.conversation?.at(-1)?.id]);
        if(!Engine)return null;
        if(!view?.awake)return <section className="duat-panel duat-council"><span className="duat-eyebrow">ROYAL COUNCIL</span><h2>The council is quiet</h2><p>Awaken a ruler to open their court.</p></section>;
        const {profile}=view;
        async function address(intent){
            if(pending||requests.current.inFlight||!onIntent)return;
            const requestKey=[campaign.id,campaign.dynastySeason,targetId,view.profile.rulerId,intent,view.throughWeek].join('|');
            const messageId=requests.current.ids[requestKey]||(requests.current.ids[requestKey]=root.crypto?.randomUUID?.()||'council_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));
            requests.current.inFlight=true;
            setSending(true);setLocalError(null);
            try{const saved=await onIntent({targetFactionId:targetId,intent,seenThroughWeek:view.throughWeek,messageId});if(saved===false)throw new Error('The audience could not be saved. Please try again.');delete requests.current.ids[requestKey];}
            catch(cause){setLocalError(cause?.message||'The audience could not be saved. Please try again.');}
            finally{requests.current.inFlight=false;setSending(false);}
        }
        return <section className="duat-panel duat-council" aria-labelledby="duat-council-title">
            <div className="duat-council-heading"><div><span className="duat-eyebrow">ROYAL COUNCIL</span><h2 id="duat-council-title">An audience with the ruler</h2></div><span className="duat-council-fiction">Written Duat fiction</span></div>
            <label className="duat-council-select">Visit a court<select value={targetId} disabled={pending} onChange={event=>{setSelected(event.target.value);setLocalError(null);}}>{available.map(f=>{const p=Engine.profileFor(f);return <option key={f.id} value={f.id}>{f.name} · {p?.name||'Ruler'}{f.controller==='human'?' · player controlled':''}</option>;})}</select></label>
            <div className="duat-council-ruler"><div><h3>{profile.name}</h3><p>{profile.realm} · {profile.archetypeLabel}</p></div><span className={'duat-council-stance is-'+view.stance.id}>{view.humanControlled?'Player controlled':view.stance.label}</span></div>
            {view.strategy?.completedWeeks>=3&&<p className="duat-council-strategy"><strong>{view.strategy.label}</strong><span>{view.strategy.reason}</span></p>}
            {view.humanControlled?<p className="duat-council-human">This ruler is controlled by a player. Their character profile is available below; the council does not speak on their behalf.</p>:<>
                <div className="duat-council-conversation" ref={scroll} role="log" aria-label={'Audience with '+profile.name} aria-live="polite" aria-relevant="additions">
                    {view.lines.slice(0,view.conversation.length?1:3).map(line=><div className="duat-council-speech" key={line.id}><span>{line.speaker}</span><p>{line.text}</p></div>)}
                    {view.conversation.map(message=><React.Fragment key={message.id}><div className="duat-council-speech is-you"><span>You · {message.week?'After Week '+message.week:'Before the first game'}</span><p>{message.prompt||({respect:'I offer my respect.',counsel:'What would you advise?',challenge:'I challenge your view.',alliance:'Let us discuss our common interests.'}[message.intent]||'An audience')}</p></div><div className="duat-council-speech"><span>{message.speaker}</span><p>{message.text}</p></div></React.Fragment>)}
                </div>
                <div className="duat-council-choices" aria-label="Address the ruler">{view.choices.map(choice=><button className="duat-button" key={choice.id} disabled={pending||!onIntent} onClick={()=>address(choice.intent)}>{choice.label}</button>)}</div>
                {pending&&<p className="duat-council-status" role="status">Saving your audience…</p>}
                {(error||localError)&&<p className="duat-council-error" role="alert">{error||localError}</p>}
                {!onIntent&&<p className="duat-council-status">Council replies are not connected in this view.</p>}
                <p className="duat-council-boundary">{view.relationship.exchanges>1?view.relationship.label+'. ':''}An audience remembers your words. It does not make trades, spend favors or change alliances.</p>
            </>}
            <details className="duat-council-profile"><summary>Character &amp; court</summary><div className="duat-council-profile-body"><p className="duat-council-provenance"><strong>{profile.identityStatus.label}</strong> · {profile.identityStatus.note}</p><dl><div><dt>Values</dt><dd>{profile.values.join(' · ')}</dd></div><div><dt>Wants</dt><dd>{profile.wants}</dd></div><div><dt>Fears</dt><dd>{profile.fears}</dd></div><div><dt>Temperament</dt><dd>{profile.temperament}</dd></div><div><dt>At court</dt><dd>{profile.tells[0]}</dd></div><div><dt>Voice</dt><dd>{profile.voice.cadence}</dd></div></dl><p>{profile.culturalContext}</p><p className="duat-council-fiction-note">{profile.fictionNote} Sources ground the cultural setting, not the invented psychology.</p><ul className="duat-council-sources">{profile.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a></li>)}</ul></div></details>
            {view.memories.length>0&&<details className="duat-council-memory"><summary>The record behind this audience · {view.memories.length}</summary><ul>{view.memories.map(memory=><li key={memory.id}>{memory.text}</li>)}</ul><p>Only revealed results through Week {view.throughWeek} are considered.</p></details>}
        </section>;
    }
    App.DuatCouncil=DuatCouncil;
})(typeof window!=='undefined'?window:globalThis);
