function LegacyWoeppelCupPanel({ league, getOwnerName, myRoster }) {
    const key='wr_woeppel_v1_'+(league.league_id||league.id)+'_'+league.season;
    const blank=()=>({groups:{A:[],B:[],C:[]},drawMargin:4,weeks:{},locked:false});
    const [state,setState]=React.useState(()=>{try{const saved=JSON.parse(localStorage.getItem(key));if(!saved)return blank();if(!saved.groups||!saved.weeks||!['A','B','C'].every(g=>Array.isArray(saved.groups[g])))return blank();if(saved.locked){window.WoeppelCup.validate(saved);window.WoeppelCup.tables(saved);}return saved;}catch{return blank();}});
    const [honourNotice,setHonourNotice]=React.useState('');
    const [manage,setManage]=React.useState(false);
    const [rulingIds,setRulingIds]=React.useState(Array(8).fill(''));
    const [rulingReason,setRulingReason]=React.useState('');
    const [week,setWeek]=React.useState(6),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
    const engine=window.WoeppelCup;
    const [access,setAccess]=React.useState({ready:false,canManage:false,revision:0,updatedAt:null});
    const [saving,setSaving]=React.useState(false);
    const [localDraft]=React.useState(state);
    const call=async body=>{const db=window.App?.OD?.getClient?.()||window.OD?.getClient?.();if(!db)throw Error('Sign in to connect the shared Cup.');const {data,error:err}=await db.functions.invoke('league-cup',{body:{leagueId:String(league.league_id||league.id),season:String(league.season),...body}});if(err){let message=err.message;try{message=(await err.context.json()).error||message;}catch{}throw Error(message);}if(data.error)throw Error(data.error);return data;};
    const refresh=async()=>{try{const data=await call({action:'load'});setState(data.cup?.state||blank());setAccess({ready:true,canManage:data.canManage,revision:data.cup?.revision||0,updatedAt:data.cup?.updated_at});setError('');}catch(e){setError(e.message);}};
    React.useEffect(()=>{refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);return()=>clearInterval(timer);},[]);
    const save=async next=>{if(!access.canManage||saving)return;setSaving(true);try{const data=await call({action:'save',state:next,revision:access.revision});setState(data.cup.state);setAccess({...access,revision:data.cup.revision,updatedAt:data.cup.updated_at});try{localStorage.setItem(key,JSON.stringify(next));}catch{}setError('');}catch(e){setError(e.message);}finally{setSaving(false);}};
    const name=id=>getOwnerName(Number(id))||('Team '+id);
    const rosters=league.rosters||[];
    const assign=(id,g)=>{const next={...state,groups:Object.fromEntries(['A','B','C'].map(k=>[k,state.groups[k].filter(x=>x!==id)]))};if(g)next.groups[g].push(id);save(next);};
    let tables=null,rounds=[],bracketNote='';
    if(state.locked){try{tables=engine.tables(state);rounds=engine.knockout(state);}catch(e){bracketNote=e.message;}}
    const pull=async()=>{setBusy(true);setError('');try{const rows=await window.fetchMatchups(league.league_id||league.id,week);if(!Array.isArray(rows))throw Error('Scores unavailable.');const scores={};rows.forEach(r=>{if(typeof r.points==='number'&&Number.isFinite(r.points))scores[String(r.roster_id)]=r.points;});if(Object.values(state.groups).flat().some(id=>!Number.isFinite(scores[id])))throw Error('Not all twelve teams have scores yet.');save({...state,weeks:{...state.weeks,[week]:{scores,final:false,fetchedAt:new Date().toISOString()}}});}catch(e){setError(e.message);}finally{setBusy(false);}};
    const exportFile=()=>{const blob=new Blob([JSON.stringify({leagueId:String(league.league_id||league.id),season:String(league.season),state},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='woeppel-cup-'+league.season+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const myId=String(myRoster?.roster_id||'');
    const myGroup=tables&&Object.keys(tables).find(g=>tables[g].some(r=>r.id===myId));
    const myRow=myGroup?tables[myGroup].find(r=>r.id===myId):null;
    const matches=state.locked?(week<12?engine.fixtures(state).filter(f=>f.week===week):rounds.flat().filter(f=>f.week===week)):[];
    const mine=matches.find(f=>f.a===myId||f.b===myId);
    const champion=rounds[2]?.[0]?.winner;
    const score=id=>Number.isFinite(state.weeks[week]?.scores[id])?state.weeks[week].scores[id].toFixed(2):'—';
    const archiveChampion=async()=>{if(!champion||!access.canManage)return;setSaving(true);try{const history=await call({action:'history'});const previous=history.records?.find(r=>r.season===String(league.season));if(!window.confirm((previous?'Update':'Record')+' the '+league.season+' Hall of Fame Cup result with '+name(champion)+' as champion?'))return;const final=rounds[2][0];const runner=final.a===champion?final.b:final.a;await call({action:'save-history',revision:previous?.revision||0,state:{winner:name(champion),runnerUp:name(runner),winnerScore:state.weeks[17].scores[champion],runnerScore:state.weeks[17].scores[runner],notes:'Confirmed from the finalized Woeppel Cup tracker.'}});setHonourNotice('Saved to Hall of Fame → Woeppel Cup.');}catch(e){setError(e.message);}finally{setSaving(false);}};
    const trophy=<svg className="cup-trophy" viewBox="0 0 80 96" aria-hidden="true"><path d="M22 10h36v25c0 16-8 25-18 25S22 51 22 35V10Z" fill="currentColor"/><path d="M22 17H9v13c0 13 8 20 19 20M58 17h13v13c0 13-8 20-19 20" fill="none" stroke="currentColor" strokeWidth="5"/><path d="M40 59v18M25 81h30M20 88h40" stroke="currentColor" strokeWidth="7"/><path d="m40 21 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#101b21"/></svg>;
    return <section className="cup-panel">
        <header className="cup-hero">{trophy}<div><span className="cup-eyebrow">CTB THE ONE · {league.season}</span><h2>WOEPPEL <em>CUP</em></h2><p>{champion?'The crown has a home.':state.locked?'Twelve teams. One name on the trophy.':'The road to the Cup starts with the draw.'}</p></div><div className="cup-hero-actions">{access.canManage&&<button aria-pressed={manage} onClick={()=>setManage(v=>!v)}>{manage?'Back to the Cup':'Manage Cup'}</button>}<button onClick={refresh} disabled={saving}>Refresh</button></div></header>
        {manage&&<div className="cup-admin-tools"><button onClick={exportFile}>Export backup</button><label hidden={!access.canManage}>Import backup<input type="file" accept="application/json" onChange={async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(data.leagueId!==String(league.league_id||league.id)||data.season!==String(league.season))throw Error('This backup belongs to another league or season.');engine.validate(data.state);if(!data.state.weeks || typeof data.state.weeks!=='object')throw Error('Invalid week data.');engine.tables(data.state);if(Object.values(data.state.groups).flat().some(id=>!rosters.some(r=>String(r.roster_id)===id)))throw Error('Unknown roster in backup.');if(!window.confirm('Replace the shared league Cup with this backup?'))return;save(data.state);}catch(err){setError(err.message);}}}/></label></div>}
        <div className="cup-stage-rail" aria-label="Tournament stages">{[['GROUPS','W6–11'],['QUARTERFINALS','W15'],['SEMIFINALS','W16'],['FINAL','W17']].map(([label,time],i)=><div key={label} className={(week<12?0:week-14)===i?'is-current':''}><span>{label}</span><b>{time}</b></div>)}</div>
        {champion&&<section className="cup-champion">{trophy}<div><span className="cup-eyebrow">WOEPPEL CUP CHAMPION</span><h3>{name(champion)}</h3><p>{league.season} · The last team standing.</p>{access.canManage&&<button disabled={saving} onClick={archiveChampion}>Record in Hall of Fame</button>}{honourNotice&&<p role="status">{honourNotice}</p>}</div></section>}
        {myRow&&<section className="cup-your-team"><div><span className="cup-eyebrow">YOUR CUP · GROUP {myGroup}</span><strong>{name(myId)}</strong></div><div><b>{myRow.points} PTS</b><span>{myRow.played?`Position ${tables[myGroup].indexOf(myRow)+1} · ${6-myRow.played} group games left`:'Group games have not started'}</span></div><div><strong>{mine?'vs '+name(mine.a===myId?mine.b:mine.a):'No fixture in this round'}</strong><span>{mine?score(myId)+' — '+score(mine.a===myId?mine.b:mine.a):'Follow the road to the Cup below'}</span></div></section>}
        <p>Group play W6–11 · Quarterfinals W15 · Semifinals W16 · Final W17</p>
        <p className="cup-note">Shared league Cup · {access.ready?(access.canManage?'Commissioner controls':'View only'):'Connecting…'}{saving?' · Saving…':''}{access.updatedAt?' · Updated '+new Date(access.updatedAt).toLocaleString():''}. Refreshes every 30 seconds.</p>
        {manage&&access.ready&&access.canManage&&access.revision===0&&Object.values(localDraft.groups).flat().length>0&&<button disabled={saving} onClick={()=>{if(window.confirm('Publish this device’s existing Cup as the shared league Cup?'))save(localDraft);}}>Publish existing local Cup</button>}
        {error&&<p role="alert">{error}</p>}
        {!state.locked&&!manage&&<div className="cup-awaiting"><span className="cup-eyebrow">DRAW NIGHT AWAITS</span><h3>Three groups. Four contenders each.</h3><p>The commissioner will reveal the groups here. Top two in each group and two wildcards advance.</p></div>}
        {!state.locked?<fieldset hidden={!manage} disabled={!access.canManage||saving||!access.ready} style={{border:0,padding:0,margin:0,minWidth:0}}><h3>Record the group draw</h3><p>Assign two Tier A and two Tier B teams to each group after Week 5. Tier calculation and the draw remain commissioner decisions.</p><div className="cup-setup">{rosters.map(r=><label key={r.roster_id}>{name(r.roster_id)}<select aria-label={'Group for '+name(r.roster_id)} value={Object.keys(state.groups).find(g=>state.groups[g].includes(String(r.roster_id)))||''} onChange={e=>assign(String(r.roster_id),e.target.value)}><option value="">Unassigned</option>{['A','B','C'].map(g=><option key={g}>{g}</option>)}</select></label>)}</div><label>Group draw threshold <select value={state.drawMargin} onChange={e=>save({...state,drawMargin:Number(e.target.value)})}><option value={4}>Within 4 points, inclusive</option><option value={0}>Exact-score ties only</option></select></label><button onClick={()=>{try{engine.validate(state);save({...state,locked:true});}catch(e){setError(e.message);}}}>Lock groups &amp; create fixtures</button></fieldset>:<>
        <div className="cup-tools"><select aria-label="Cup week" value={week} onChange={e=>setWeek(Number(e.target.value))}>{[6,7,8,9,10,11,15,16,17].map(w=><option key={w} value={w}>Week {w}{state.weeks[w]?.final?' · Final':''}</option>)}</select><fieldset hidden={!manage} disabled={!access.canManage||saving} style={{border:0,padding:0,display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={busy||state.weeks[week]?.final} onClick={pull}>{busy?'Loading…':'Fetch Sleeper scores'}</button><button disabled={!state.weeks[week]||state.weeks[week]?.final} onClick={()=>{if(window.confirm('Confirm Week '+week+' is complete and scores are final?'))save({...state,weeks:{...state.weeks,[week]:{...state.weeks[week],final:true}}});}}>Finalize week</button>{state.weeks[week]?.final&&<button onClick={()=>{if(window.confirm('Reopen this week? Standings and downstream bracket results will recalculate.'))save({...state,weeks:{...state.weeks,[week]:{...state.weeks[week],final:false}}});}}>Reopen week</button>}</fieldset></div>
        <p>{state.weeks[week]?.final?'Finalized':state.weeks[week]?'Preview only — not counted in standings':'No scores loaded'}{state.weeks[week]?.fetchedAt?' · Fetched '+new Date(state.weeks[week].fetchedAt).toLocaleString():''}</p>
        <div className="cup-groups">{tables&&Object.entries(tables).map(([g,rows])=><section key={g}><div className="cup-group-head"><span className="cup-group-letter">{g}</span><div><h3>GROUP {g}</h3><span>Top 2 + wildcard race</span></div></div><table><thead><tr>{['Team','P','W-D-L','Pts','PF'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id} className={[r.id===myId?'is-mine':'',r.played?(i<2?'cup-top-two':i===2?'cup-wildcard':''):''].join(' ')}><td><span className="cup-rank">{r.played?i+1:'—'}</span>{name(r.id)}</td><td>{r.played}</td><td>{r.w}-{r.d}-{r.l}</td><td><b>{r.points}</b></td><td>{r.pf.toFixed(1)}</td></tr>)}</tbody></table><p className="cup-note">{rows.every(r=>r.played===6)?'Group play complete; qualification subject to tiebreaks.':'Positions are provisional, not clinched places.'}</p></section>)}</div>
        <div className="cup-section-heading"><h3>MATCHDAY {week<12?week-5:week-14}</h3><span>Week {week} · {state.weeks[week]?.final?'FINAL SCORES':'SCORE PREVIEW'}</span></div>
        <div className="cup-fixtures">{matches.map(f=>{const x=state.weeks[week]?.scores[f.a],y=state.weeks[week]?.scores[f.b];const close=Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=state.drawMargin;return <article key={f.a+'-'+f.b} className="cup-match"><span className="cup-eyebrow">{f.group?'GROUP '+f.group:'KNOCKOUT'}{close&&week<12?' · '+(state.weeks[week]?.final?'DRAW':'WITHIN DRAW RANGE'):''}</span><div><strong>{name(f.a)}</strong><b>{score(f.a)}</b></div><div><strong>{name(f.b)}</strong><b>{score(f.b)}</b></div>{f.winner&&<small>{name(f.winner)} advances</small>}</article>;})}</div>{!matches.length&&<p className="cup-note">Matchups appear when the previous stage is settled.</p>}
        <div className="cup-section-heading"><h3>ROAD TO THE CUP</h3><span>8 contenders → 1 champion</span></div>
        {bracketNote&&<p className="cup-note">{bracketNote}</p>}
        <div className="cup-bracket">{['Quarterfinals','Semifinals','Final'].map((title,i)=><section className="cup-round" key={title}><h4>{title} <span>W{15+i}</span></h4><div className="cup-round-matches">{Array.from({length:4/Math.pow(2,i)},(_,j)=>{const r=rounds[i]?.[j];return <article className="cup-bracket-match" key={j}>{[0,1].map(k=>{const id=r?.[k?'b':'a'];return <div className={id&&r.winner===id?'is-winner':''} key={k}><span>{id?name(id):i===0?'Qualifier TBD':`Winner ${i===1?'QF':'SF'} ${j*2+k+1}`}</span><b>{id&&Number.isFinite(state.weeks[15+i]?.scores[id])?state.weeks[15+i].scores[id].toFixed(2):'—'}</b></div>;})}</article>;})}</div></section>)}</div>
        </>}
        {manage && state.locked && access.canManage && <details><summary>Commissioner rulings</summary><p>Only use a seeding override to apply an unresolved tiebreak or a league-approved correction. Record the evidence (Cup Max PF, PA, or the agreed fallback). This overrides automatic qualification and seeding.</p><div className="cup-setup">{rulingIds.map((id,i)=><label key={i}>Seed {i+1}<select value={id} onChange={e=>setRulingIds(prev=>prev.map((x,k)=>k===i?e.target.value:x))}><option value="">Choose team</option>{rosters.map(r=><option key={r.roster_id} value={String(r.roster_id)}>{name(r.roster_id)}</option>)}</select></label>)}</div><input aria-label="Reason and evidence for seeding ruling" value={rulingReason} onChange={e=>setRulingReason(e.target.value)} placeholder="Reason and supporting tiebreak evidence"/><button disabled={!rulingReason.trim()||rulingIds.some(x=>!x)||new Set(rulingIds).size!==8} onClick={()=>{try{const next={...state,seedRuling:{ids:rulingIds,reason:rulingReason,at:new Date().toISOString()}};engine.bracket(next);if(window.confirm('Apply this commissioner seeding override?'))save(next);}catch(e){setError(e.message);}}}>Apply seeding ruling</button>{state.seedRuling&&<p>Seeding ruling: {state.seedRuling.reason} <button onClick={()=>save({...state,seedRuling:null})}>Restore automatic seeding</button></p>}{rounds.flat().filter(r=>state.weeks[r.week]?.final&&r.x===r.y).map(r=><div key={r.a}><p>Week {r.week}: {name(r.a)} / {name(r.b)} exact tie</p>{[r.a,r.b].map(id=><button key={id} onClick={()=>{const reason=window.prompt('Record the agreed tiebreak and evidence for advancing '+name(id));if(reason?.trim())save({...state,tieRulings:{...state.tieRulings,[r.week+':'+r.a+':'+r.b]:{winner:id,reason,at:new Date().toISOString()}}});}}>Advance {name(id)}</button>)}{state.tieRulings?.[r.week+':'+r.a+':'+r.b]&&<p>{state.tieRulings[r.week+':'+r.a+':'+r.b].reason}</p>}</div>)}</details>}
        <details><summary>Rules &amp; limits</summary><p>Group wins earn 3 points, draws 1. Standings use Cup points then Cup PF. Missing Max PF is never estimated: ties on those criteria block automatic seeding for commissioner review. Exact-score knockout ties also block advancement. No prize amount or payout is recorded until the conflicting bylaws are resolved.</p></details>
    </section>;
}


function WoeppelCupPanel(props) {
    const { league, getOwnerName, myRoster } = props;
    const engine = window.WoeppelCup.tournament;
    const formats = engine.formats;
    const [saved, setSaved] = React.useState(null);
    const [draft, setDraft] = React.useState(() => engine.defaults(league));
    const [access, setAccess] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [connection, setConnection] = React.useState('');
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [explore, setExplore] = React.useState(false);
    const [sample, setSample] = React.useState(null);
    const [week, setWeek] = React.useState(null);
    const [scores, setScores] = React.useState({});
    const [seedIds, setSeedIds] = React.useState([]);
    const [survivorIds, setSurvivorIds] = React.useState([]);
    const [reason, setReason] = React.useState('');
    const touched = React.useRef(false);
    const name = id => id == null ? 'Bye' : getOwnerName?.(Number(id)) || 'Team ' + id;
    const myId = String(myRoster?.roster_id || '');
    const icons = { points: '◎', 'round-robin': '↔', 'all-play': '✦', median: '↑', knockout: '⚡', survivor: '♜' };
    const isQualifier = s => !['knockout', 'survivor'].includes(s.format);
    const formatOf = s => formats.find(f => f.id === s.format) || formats[0];
    const call = async body => {
        const db = window.App?.OD?.getClient?.() || window.OD?.getClient?.();
        if (!db) throw Error('Sign in to connect your league tournament.');
        const { data, error: failure } = await db.functions.invoke('league-cup', { body: { leagueId: String(league.league_id || league.id), season: String(league.season), ...body } });
        if (failure) { let message = failure.message; try { message = (await failure.context.json()).error || message; } catch {} throw Error(message); }
        if (data?.error) throw Error(data.error);
        return data;
    };
    const load = async () => {
        setBusy(true);
        try {
            const data = await call({ action: 'load' });
            setSaved(data.cup?.state || null);
            if (!touched.current) setDraft(data.cup?.state || engine.defaults(league));
            setAccess({ canManage: data.canManage, revision: data.cup?.revision || 0 });
            setConnection('');
        } catch (e) { setConnection(e.message); }
        finally { setBusy(false); }
    };
    React.useEffect(() => { load(); }, []);
    const save = async next => {
        if (!access?.canManage || busy || sample) return;
        try { engine.validate(next); } catch (e) { setError(e.message); return; }
        setBusy(true);
        try {
            const data = await call({ action: 'save', revision: access.revision, state: next });
            setSaved(data.cup.state); setDraft(data.cup.state); touched.current = false;
            setAccess({ ...access, revision: data.cup.revision }); setError(''); setNotice('Saved for your league.');
            if (next.locked) setExplore(false);
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const update = (key, value) => { touched.current = true; setDraft(d => ({ ...d, [key]: value })); setError(''); };
    const chooseFormat = id => {
        touched.current = true;
        setDraft(d => {
            const next = engine.configure(league, id, d);
            if (d.name === 'League Cup' || formats.some(f => f.name === d.name)) next.name = formats.find(f => f.id === id).name;
            return next;
        });
        setError(''); setNotice('');
    };
    const active = sample || (saved?.locked && !explore ? saved : null);
    const state = active || draft;
    let schedule = [], setupError = '', rows = [], rounds = [], survival = [], result = null, bracketNote = '';
    try { engine.validate(draft); } catch (e) { setupError = e.message; }
    try { schedule = engine.schedule(state); } catch {}
    const selectedWeek = schedule.includes(week) ? week : schedule[0];
    React.useEffect(() => { setScores(active?.weeks?.[selectedWeek]?.scores || {}); setSurvivorIds([]); }, [active, selectedWeek]);
    if (saved && saved.version !== 2) return <LegacyWoeppelCupPanel {...props}/>;
    if (active) {
        try {
            rows = engine.tables(active);
            if (active.format === 'survivor') survival = engine.survivor(active);
            else rounds = engine.knockout(active);
            result = engine.result(active);
        } catch (e) { bracketNote = e.message; }
    }
    const viewFormat = formatOf(state), chosen = formatOf(draft);
    const currentSurvival = survival.find(r => r.week === selectedWeek);
    let requiredTeams = [], scoresBlocked = '';
    if (active) { try { requiredTeams = engine.requiredScoreIds(active, selectedWeek); } catch (e) { scoresBlocked = e.message; } }
    const formatWeeks = s => { try { const weeks = engine.schedule(s); return weeks.length ? 'W' + weeks[0] + '–' + weeks[weeks.length - 1] : 'Choose dates'; } catch { return 'Choose dates'; } };
    const clearAfter = (s, from, include = true) => ({
        ...s,
        weeks: Object.fromEntries(Object.entries(s.weeks).map(([w, data]) => [w, Number(w) >= from + (include ? 0 : 1) ? { ...data, final: false } : data])),
        tieRulings: Object.fromEntries(Object.entries(s.tieRulings || {}).filter(([key]) => Number(key.split(':')[0]) < from + (include ? 0 : 1))),
        survivorRulings: Object.fromEntries(Object.entries(s.survivorRulings || {}).filter(([key]) => Number(key) < from + (include ? 0 : 1))),
        ...(isQualifier(s) && from < s.knockoutStart ? { seedRuling: null } : {})
    });
    const startSample = () => {
        if (setupError) return;
        setSample({ ...draft, enabled: true, locked: true, weeks: {}, seedRuling: null, tieRulings: {}, survivorRulings: {} });
        setExplore(false); setWeek(null); setNotice(''); setError('');
    };
    const sampleWeek = () => {
        const nextWeek = engine.schedule(sample).find(w => !sample.weeks[w]?.final);
        if (!nextWeek) return;
        // Illustrative, unique scores: separate from every live league score.
        const values = Object.fromEntries(sample.teams.map((id, i) => [id, Math.round((80 + ((i * 37 + nextWeek * 23) % 79) + i / 100) * 100) / 100]));
        let next = { ...sample, weeks: { ...sample.weeks, [nextWeek]: { final: true, scores: values } } };
        // All-play/median sample ties use a declared sample-only points tiebreak.
        if (isQualifier(next) && nextWeek === next.startWeek + next.groupWeeks - 1) {
            try { engine.qualifiers(next); } catch {
                const order = engine.tables(next).map(r => r.id).slice(0, next.qualifierCount);
                next.seedRuling = { ids: order, reason: 'Sample only: tied seeds use the displayed order.' };
            }
        }
        setSample(next); setWeek(nextWeek);
    };
    const persistScores = finalize => {
        let required;
        try { required = engine.requiredScoreIds(active, selectedWeek); } catch (e) { setError(e.message); return; }
        const parsed = {};
        for (const id of required) {
            if (scores[id] === '' || scores[id] === undefined || !Number.isFinite(Number(scores[id]))) { setError('Enter a score for every team competing this week, including zero where appropriate.'); return; }
            parsed[id] = Number(scores[id]);
        }
        const next = clearAfter(active, selectedWeek);
        save({ ...next, weeks: { ...next.weeks, [selectedWeek]: { scores: parsed, final: finalize } } });
    };
    const pull = async () => {
        setBusy(true);
        try {
            const data = await window.fetchMatchups(league.league_id || league.id, selectedWeek);
            if (!Array.isArray(data)) throw Error('Scores are unavailable. Enter them manually.');
            const values = data.map(r => [String(r.roster_id), Number.isFinite(r.custom_points) ? r.custom_points : r.points]);
            setScores(Object.fromEntries(values.filter(([, value]) => Number.isFinite(value))));
            setNotice('Scores loaded for review. Finalize after the week and stat corrections are complete.'); setError('');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const archive = async () => {
        if (!result || sample) return;
        setBusy(true);
        try {
            const history = await call({ action: 'history' }), previous = history.records?.find(r => r.season === String(league.season));
            if (previous && !window.confirm('Replace this season’s existing Cup honour?')) return;
            await call({ action: 'save-history', revision: previous?.revision || 0, state: { cupName: active.name, winner: name(result.champion), runnerUp: result.runnerUp ? name(result.runnerUp) : '', winnerScore: result.winnerScore, runnerScore: result.runnerScore, notes: 'Confirmed from the finalized ' + active.name + ' tournament (' + viewFormat.name + ').' } });
            setNotice('Champion recorded in Hall of Fame → Cup history.');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const roundLabel = (index, count) => count - index === 1 ? 'Final' : count - index === 2 ? 'Semifinals' : count - index === 3 ? 'Quarterfinals' : 'Round ' + (index + 1);
    const canManage = access?.canManage && !sample;
    const points = value => Number.isFinite(value) ? value.toFixed(2) : '—';
    const fixtures = active && isQualifier(active) && selectedWeek < active.knockoutStart ? engine.fixtures(active).filter(f => f.week === selectedWeek) : rounds.flat().filter(f => f.week === selectedWeek);
    return <section className="cup-panel cup-studio" aria-label="League Cup">
        <header className="cup-hero">
            <span className="cup-studio-emblem" aria-hidden="true">🏆</span>
            <div><span className="cup-eyebrow">{league.name} · {league.season}</span><h2>{active ? active.name : 'Make it a Cup season.'}</h2><p>{active ? viewFormat.tagline : 'Six ways to compete. One more reason to care about every week.'}</p></div>
            <div className="cup-hero-actions">{active && <button onClick={() => { setSample(null); setExplore(true); setError(''); }}>Explore formats</button>}{saved?.locked && !active && <button onClick={() => { setExplore(false); setSample(null); setDraft(saved); touched.current = false; }}>Back to your Cup</button>}<button disabled={busy} onClick={load}>{busy ? 'Connecting…' : 'Refresh Cup'}</button></div>
        </header>
        {error && <p className="cup-message" role="alert">{error}</p>}{notice && <p className="cup-message" role="status">{notice}</p>}
        {!sample && (connection || (access && !access.canManage)) && <div className="cup-connection"><strong>{connection ? 'Explore now. Connect to save.' : 'Build a Cup your commissioner can run.'}</strong><span>{connection ? 'Format previews work here. Shared setup needs a verified commissioner account.' : 'Everyone can try the formats. Your commissioner starts the shared league tournament.'}</span>{connection && <details><summary>Connection details</summary><p>{connection}</p><a href={window.location?.pathname?.includes('/dist-preview/') ? '../login.html' : 'login.html'}>Open sign-in</a></details>}</div>}
        {!active && <>
            <div className="cup-section-heading"><h3>CHOOSE YOUR COMPETITION</h3><span>Uses your league’s weekly fantasy scores</span></div>
            <div className="cup-format-grid" role="radiogroup" aria-label="Cup format">
                {formats.map(f => <button type="button" role="radio" aria-checked={draft.format === f.id} className={'cup-format-card' + (draft.format === f.id ? ' is-selected' : '')} key={f.id} onClick={() => chooseFormat(f.id)}>
                    <span className="cup-format-icon" aria-hidden="true">{icons[f.id]}</span><span className="cup-format-copy"><strong>{f.name}</strong><span>{f.tagline}</span><small>{f.description}</small></span><span className="cup-format-check" aria-hidden="true">{draft.format === f.id ? '✓' : '○'}</span>
                </button>)}
            </div>
            <div className="cup-plan-layout">
                <form className="cup-plan-form" onSubmit={e => { e.preventDefault(); if (!saved?.locked) save({ ...draft, enabled: true, locked: true }); }}>
                    <h3>Make it yours</h3><label className="cup-field">Cup name<input maxLength={80} required value={draft.name} onChange={e => update('name', e.target.value)} placeholder="Your league’s next tradition"/></label>
                    <div className="cup-plan-fields"><label className="cup-field">First week<input type="number" min="1" max="18" value={draft.startWeek} onChange={e => { const start = Number(e.target.value); touched.current = true; setDraft(d => ({ ...d, startWeek: start, knockoutStart: d.knockoutStart + start - d.startWeek })); }}/></label>
                    {draft.format !== 'knockout' && <label className="cup-field">{draft.format === 'survivor' ? 'Survival weeks' : 'Qualifying weeks'}<input type="number" min="1" max="18" value={draft.groupWeeks} onChange={e => { const count = Number(e.target.value); touched.current = true; setDraft(d => ({ ...d, groupWeeks: count, ...(isQualifier(d) ? { knockoutStart: d.startWeek + count } : {}) })); }}/></label>}
                    {isQualifier(draft) && <label className="cup-field">Teams advancing<select value={draft.qualifierCount} onChange={e => update('qualifierCount', Number(e.target.value))}>{[2, 4, 8, 16, 32, 64].filter(n => n <= draft.teams.length).map(n => <option key={n} value={n}>{n} teams</option>)}</select></label>}</div>
                    <details><summary>Teams, seeding &amp; advanced rules · {draft.teams.length} entered</summary>
                        <div className="cup-participants">{(league.rosters || []).map(r => { const id = String(r.roster_id); return <label key={id}><input type="checkbox" checked={draft.teams.includes(id)} onChange={e => { const teams = e.target.checked ? [...draft.teams, id] : draft.teams.filter(x => x !== id); touched.current = true; setDraft(d => engine.configure(league, d.format, { ...d, teams })); }}/>{name(id)}</label>; })}</div>
                        {draft.format === 'knockout' && <div className="cup-seeding"><p>Seed order sets the bracket. The highest seeds receive any first-round byes.</p>{draft.teams.map((id, i) => <div key={id}><span><b>{i + 1}</b> {name(id)}</span><button type="button" disabled={i === 0} aria-label={'Move ' + name(id) + ' up one seed'} onClick={() => { const teams = [...draft.teams]; [teams[i - 1], teams[i]] = [teams[i], teams[i - 1]]; update('teams', teams); }}>↑</button></div>)}</div>}
                        {isQualifier(draft) && <label className="cup-field">First knockout week<input type="number" min="2" max="18" value={draft.knockoutStart} onChange={e => update('knockoutStart', Number(e.target.value))}/></label>}
                        {draft.format === 'round-robin' && <label className="cup-field">Draw margin · fantasy points<input type="number" min="0" max="100" step="0.01" value={draft.drawMargin} onChange={e => update('drawMargin', Number(e.target.value))}/></label>}
                        <button type="button" onClick={() => { touched.current = true; setDraft(d => engine.configure(league, d.format, d)); }}>Suggest dates for this field</button>
                    </details>
                    {setupError && <p className="cup-validation" role="status">{setupError}</p>}
                    <div className="cup-plan-actions"><button type="button" className="cup-primary" disabled={!!setupError} onClick={startSample}>Try a sample Cup <span aria-hidden="true">→</span></button>{access?.canManage && !saved?.locked && <><button type="submit" disabled={busy || !!setupError}>Start league Cup</button><button type="button" disabled={busy || !!setupError} onClick={() => save({ ...draft, enabled: true })}>Save setup</button></>}</div>
                    <p className="cup-note">The sample uses made-up scores. Starting a league Cup saves the rules for everyone. One shared Cup per league season.</p>
                </form>
                <aside className="cup-plan-preview" aria-label="Tournament preview"><span className="cup-eyebrow">YOUR CUP AT A GLANCE</span><h3>{draft.name || chosen.name}</h3><p>{chosen.description}</p><div className="cup-plan-numbers"><div><strong>{draft.teams.length}</strong><span>teams</span></div><div><strong>{setupError ? '—' : engine.schedule(draft).length}</strong><span>game weeks</span></div><div><strong>1</strong><span>champion</span></div></div><div className="cup-plan-road"><span>{formatWeeks(draft)}</span><strong>{draft.format === 'survivor' ? 'Survive each cut → Last team standing' : draft.format === 'knockout' ? 'Win and advance → Championship' : 'Qualify → ' + draft.qualifierCount + '-team bracket → Championship'}</strong></div><p className="cup-note">{draft.format === 'round-robin' ? 'Every team plays a full cycle. Odd fields get rotating byes.' : draft.format === 'survivor' ? 'Only this week’s score decides the cut. Earlier points cannot save you.' : draft.format === 'knockout' ? 'One loss ends the run. Set seeds before starting.' : 'Your normal lineup counts. No extra roster to manage.'}</p><p className="cup-note">Suggested dates aim to finish before your league playoffs. You can choose any valid schedule through Week 18.</p></aside>
            </div>
        </>}
        {active && <>
            {sample && <div className="cup-sample-banner"><div><strong>SAMPLE CUP · MADE-UP SCORES</strong><span>Play through the format. Your league Cup is unchanged.</span></div><button className="cup-primary" disabled={!!result || engine.schedule(sample).every(w => sample.weeks[w]?.final)} onClick={sampleWeek}>{result ? 'Sample complete' : 'Play next sample week'}</button><button onClick={() => { setSample({ ...sample, weeks: {}, seedRuling: null, tieRulings: {}, survivorRulings: {} }); setWeek(null); }}>Restart sample</button></div>}
            <div className="cup-live-summary"><span>{viewFormat.name}</span><span>{active.teams.length} teams</span><span>{formatWeeks(active)}</span><span>{sample ? 'Preview' : active.enabled ? 'Active' : 'Paused'}</span></div>
            {result && <div className="cup-champion"><span className="cup-studio-emblem" aria-hidden="true">🏆</span><div><span className="cup-eyebrow">{sample ? 'SAMPLE CHAMPION' : active.name + ' CHAMPION'}</span><h3>{name(result.champion)}</h3>{result.runnerUp && <p>Runner-up: {name(result.runnerUp)} · {points(result.winnerScore)}–{points(result.runnerScore)}</p>}{canManage && <button disabled={busy} onClick={archive}>Record in Hall of Fame</button>}</div></div>}
            {active.teams.includes(myId) && <div className="cup-your-team"><div><span className="cup-eyebrow">YOUR CUP</span><strong>{name(myId)}</strong></div><div><strong>{active.format === 'survivor' ? survival.some(r => r.eliminated?.includes(myId)) ? 'Eliminated' : result?.champion === myId ? 'Champion' : 'Still in the hunt' : rounds.flat().some(r => r.winner && [r.a, r.b].includes(myId) && r.winner !== myId) ? 'Knocked out' : result?.champion === myId ? 'Champion' : 'Follow your road to the trophy'}</strong><span>{sample ? 'Sample results' : 'Finalized results only'}</span></div></div>}
            <div className="cup-tools"><label>Week<select aria-label="Tournament week" value={selectedWeek} onChange={e => setWeek(Number(e.target.value))}>{schedule.map(w => <option key={w} value={w}>Week {w}{active.weeks[w]?.final ? ' · Final' : ''}</option>)}</select></label><span className="cup-note">{active.weeks[selectedWeek]?.final ? 'Finalized' : active.weeks[selectedWeek] ? 'Score preview · not counted yet' : 'Awaiting scores'}</span></div>
            {isQualifier(active) && <div className="cup-groups"><section><div className="cup-section-heading"><h3>Qualification race</h3><span>Top {active.qualifierCount} advance</span></div><table><thead><tr><th>Team</th><th>Weeks / games</th><th>{active.format === 'points' ? 'Fantasy points' : 'Cup points'}</th><th>PF</th></tr></thead><tbody>{rows.map((r, i) => <tr key={r.id} className={r.id === myId ? 'is-mine' : ''}><td><span className="cup-rank">{i + 1}</span>{name(r.id)}</td><td>{r.played}</td><td><b>{points(r.points)}</b></td><td>{points(r.pf)}</td></tr>)}</tbody></table><p className="cup-note">Finalized weeks only. Positions are provisional until qualifying ends.</p></section></div>}
            {active.format === 'survivor' && <section className="cup-survival"><div className="cup-section-heading"><h3>THE SURVIVAL LINE</h3><span>Week {selectedWeek}{currentSurvival ? ' · ' + currentSurvival.active.length + ' entered · ' + currentSurvival.cutCount + ' to leave' : ''}</span></div>{currentSurvival ? <><div className="cup-survival-rows">{(currentSurvival.ranked.length ? currentSurvival.ranked.map(r => r.id) : currentSurvival.active).map(id => <div key={id} className={currentSurvival.eliminated.includes(id) ? 'is-eliminated' : ''}><strong>{name(id)}</strong><b>{points(active.weeks[selectedWeek]?.scores[id])}</b><span>{currentSurvival.eliminated.includes(id) ? 'OUT' : currentSurvival.survivors.includes(id) ? 'THROUGH' : currentSurvival.pendingTie?.ids.includes(id) ? 'TIE AT CUT' : 'PENDING'}</span></div>)}</div>{currentSurvival.pendingTie && <p className="cup-validation">A tie at the cut needs a commissioner ruling before anyone advances.</p>}</> : <p>Finalize the previous cut to reveal this round’s field.</p>}</section>}
            {!!fixtures.length && <div className="cup-fixtures">{fixtures.map(f => <article className="cup-match" key={f.a + ':' + f.b}><div><strong>{name(f.a)}</strong><b>{points(active.weeks[selectedWeek]?.scores[f.a])}</b></div><div><strong>{name(f.b)}</strong><b>{f.b == null ? 'BYE' : points(active.weeks[selectedWeek]?.scores[f.b])}</b></div>{f.winner && <small>{name(f.winner)} advances</small>}</article>)}</div>}
            {bracketNote && <p className="cup-message">{bracketNote}</p>}
            {active.format !== 'survivor' && <><div className="cup-section-heading"><h3>ROAD TO THE TROPHY</h3><span>{engine.roundCount(active)} rounds</span></div><div className="cup-bracket cup-studio-bracket">{Array.from({ length: engine.roundCount(active) }, (_, i) => <section className="cup-round" key={i}><h4>{roundLabel(i, engine.roundCount(active))} · W{active.knockoutStart + i}</h4>{rounds[i]?.map(r => <article className="cup-bracket-match" key={r.a + ':' + r.b}>{[r.a, r.b].map((id, j) => <div key={j} className={id && r.winner === id ? 'is-winner' : ''}><span>{name(id)}</span><b>{id == null ? 'BYE' : points(j ? r.y : r.x)}</b></div>)}</article>) || <p className="cup-note">Awaiting previous results</p>}</section>)}</div></>}
            {canManage && <>
                <details><summary>Manage Week {selectedWeek} scores</summary>{scoresBlocked && <p className="cup-note">{scoresBlocked}</p>}<fieldset disabled={busy || !active.enabled || !!scoresBlocked || active.weeks[selectedWeek]?.final} className="cup-settings"><button onClick={pull}>Fetch Sleeper scores</button><p>Review actual fantasy points for the teams competing this week. The Cup uses your existing lineups; eliminated teams and knockout byes need no score.</p><div className="cup-setup">{requiredTeams.map(id => <label key={id}>{name(id)}<input type="number" step="0.01" value={scores[id] ?? ''} onChange={e => setScores({ ...scores, [id]: e.target.value })}/></label>)}</div><div className="cup-plan-actions"><button onClick={() => persistScores(false)}>Save score preview</button><button onClick={() => { if (window.confirm('Confirm all Week ' + selectedWeek + ' scores are final?')) persistScores(true); }}>Finalize week</button></div></fieldset>{active.weeks[selectedWeek]?.final && <button disabled={busy || !active.enabled} onClick={() => { if (window.confirm('Reopen this week? Later weeks and rulings will need review again.')) save(clearAfter(active, selectedWeek)); }}>Reopen week</button>}</details>
                <details><summary>Commissioner tiebreak rulings</summary><fieldset disabled={busy || !active.enabled} className="cup-settings"><p>Ties never advance a team automatically. Apply your league’s agreed tiebreak and record the evidence.</p>
                    {isQualifier(active) && <><div className="cup-setup">{Array.from({ length: active.qualifierCount }, (_, i) => <label key={i}>Seed {i + 1}<select value={seedIds[i] || ''} onChange={e => setSeedIds(ids => Array.from({ length: active.qualifierCount }, (_, j) => j === i ? e.target.value : ids[j] || ''))}><option value="">Choose team</option>{active.teams.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>)}</div><label>Reason and evidence<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button onClick={() => { try { if (!reason.trim()) throw Error('Record the reason for this ruling.'); const next = { ...clearAfter(active, active.knockoutStart), seedRuling: { ids: seedIds, reason } }; engine.qualifiers(next); save(next); } catch (e) { setError(e.message); } }}>Apply seeding ruling</button>{active.seedRuling && <p>Recorded ruling: {active.seedRuling.reason}</p>}</>}
                    {currentSurvival?.pendingTie && <><p>Select {currentSurvival.requiredSurvivors} survivors. Teams above the tied cutoff must advance.</p><div className="cup-participants">{currentSurvival.active.map(id => <label key={id}><input type="checkbox" checked={survivorIds.includes(id)} onChange={e => setSurvivorIds(ids => e.target.checked ? [...ids, id] : ids.filter(x => x !== id))}/>{name(id)} · {points(active.weeks[selectedWeek]?.scores[id])}</label>)}</div><label>Survival tiebreak evidence<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button onClick={() => { try { if (!reason.trim()) throw Error('Record the tiebreak evidence.'); const base = clearAfter(active, selectedWeek, false); const next = { ...base, survivorRulings: { ...base.survivorRulings, [selectedWeek]: { ids: survivorIds, reason } } }; engine.survivor(next); save(next); } catch (e) { setError(e.message); } }}>Apply survival ruling</button></>}
                    {rounds.flat().filter(r => r.a && r.b && active.weeks[r.week]?.final && r.x === r.y && !r.winner).map(r => <div key={r.a}><p>Week {r.week}: {name(r.a)} / {name(r.b)} tied</p>{[r.a, r.b].map(id => <button key={id} onClick={() => { const explanation = window.prompt('Record the tiebreak evidence for advancing ' + name(id)); if (explanation?.trim()) { const next = clearAfter(active, r.week, false); save({ ...next, tieRulings: { ...next.tieRulings, [r.week + ':' + r.a + ':' + r.b]: { winner: id, reason: explanation } } }); } }}>Advance {name(id)}</button>)}</div>)}
                </fieldset></details>
                <details><summary>Tournament settings</summary><fieldset disabled={busy} className="cup-settings"><label>Name<input maxLength={80} value={draft.name} onChange={e => update('name', e.target.value)}/></label><div className="cup-plan-actions"><button onClick={() => save({ ...active, name: draft.name })}>Save name</button><button onClick={() => save({ ...active, enabled: !active.enabled })}>{active.enabled ? 'Pause tournament' : 'Resume tournament'}</button>{!Object.values(active.weeks).some(w => w.final) && <button onClick={() => save({ ...active, locked: false, weeks: {}, seedRuling: null, tieRulings: {}, survivorRulings: {} })}>Edit setup</button>}</div></fieldset></details>
            </>}
            <details><summary>How {viewFormat.name} works</summary><p>{viewFormat.description} {active.format === 'all-play' ? 'Earn 1 Cup point for every opponent beaten and half a point for each tied opponent.' : active.format === 'median' ? 'Earn 1 Cup point above the field’s median score, half a point on the median, and 0 below it.' : active.format === 'round-robin' ? 'Wins earn 3 Cup points and draws earn 1; PF breaks standings ties.' : active.format === 'points' ? 'Total qualifying fantasy points set the seeds.' : active.format === 'survivor' ? 'Each round removes enough low scorers to leave one champion in the final week. Only that week’s score determines survival.' : 'Seed order sets the opening bracket. Highest seeds receive byes when needed.'} {isQualifier(active) && 'The selected qualifiers enter a seeded knockout bracket; PF breaks Cup-points ties.'} Finalized scores count; unresolved exact ties require a commissioner ruling. {sample ? 'This is a sample with illustrative scores.' : 'One shared Cup is stored per league season.'}</p></details>
        </>}
    </section>;
}
window.WoeppelCupPanel = WoeppelCupPanel;
