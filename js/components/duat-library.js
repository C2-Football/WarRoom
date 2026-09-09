/* global React */
(function (root) {
    'use strict';
    const {useState} = React;
    const App = root.App = root.App || {}, Lore = App.DuatLore;
    const base = root.location?.pathname.includes('/dist-preview/') ? '../' : '';
    const imagePath = value => !value || /^(data:|https?:)/.test(value) ? value : base + value;
    const label = id => Lore.faction(id)?.name || id || 'Unknown faction';
    const points = value => Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : '—';
    function Source({source}) {
        if (!source) return null;
        return <small className="duat-library-source">{source.url&&/^https:\/\//.test(source.url)?<a href={source.url} target="_blank" rel="noreferrer">{source.title||'Name source'} ↗</a>:source.file}{source.chapter ? ` · Chapter ${source.chapter}` : ''}{source.pages ? ` · pp. ${source.pages.join('–')}` : ''}{source.sheet ? ` · ${source.sheet}` : ''}{source.cell || source.range ? ` · ${source.cell || source.range}` : ''}</small>;
    }
    function Crest({id,decorative = false,className = ''}) {
        return <App.DuatFactionMark id={id} className={`duat-crest ${className}`} decorative={decorative} label={`${label(id)} crest`}/>;
    }
    function Army({army,campaign,onAction,busy,active,retired = false}) {
        const [editing,setEditing] = useState(false), [name,setName] = useState(army.rulerName || ''), [error,setError] = useState('');
        const mayName = !retired && !army.destroyed && onAction && (['draft','reveal'].includes(campaign.phase) || campaign.phase === 'season' && campaign.week === 1);
        const save = async event => {
            event.preventDefault();setError('');
            try {const value=Lore.validateName(name);const saved=await onAction({type:'name-ruler',armyId:army.id,name:value});if(saved===false)throw new Error('The name was not saved. Your current name is unchanged.');setEditing(false);}
            catch (problem) {setError(problem?.message || 'This ruler could not be renamed.');}
        };
        return <article className={'duat-library-army ' + (active ? 'walking' : retired || army.destroyed ? 'retired' : '')}>
            <div className="duat-library-army-heading"><span className="duat-eyebrow">{retired ? `RETIRED · DYNASTY ${army.retiredCycle || '—'}` : army.destroyed ? 'DESTROYED TOMB' : active ? 'THE WALKING RULER' : 'SEALED TOMB'}</span><span className="duat-library-seal" aria-hidden="true">{active ? '☀' : retired || army.destroyed ? '✦' : '◈'}</span></div>
            <h3>{army.rulerName || `${army.season} Ruler`}</h3>
            <p>{army.rulerRealm || 'A ruler of your faction'}<br/><small>{army.season} scoring season{army.rosteredYear ? ` · Buried in ${army.rosteredYear}` : ''}</small></p>
            {army.rollBand && !retired && <span className="duat-library-d20">d20 · {army.rollBand.min}–{army.rollBand.max}</span>}
            {retired && <p className="duat-library-retirement">{army.reason === 'destroyed' || army.reason === 'shiva' ? 'The tomb was destroyed. This ruler will not return.' : 'This ruler has completed the journey and will not be awakened again.'}</p>}
            {army.players?.length > 0 && <details><summary>{army.players.length} companions</summary><ul className="duat-library-roster">{army.players.map((p,i)=><li key={p.id || i}><span>{p.position}</span>{p.name}</li>)}</ul></details>}
            {army.rulerSource && <details className="duat-library-provenance"><summary>{army.rulerOrigin?.startsWith('supplied')?'From the original archives':'About this name'}</summary><Source source={army.rulerSource}/><p>Preserved as a Duat game identity. Names need not follow a historical succession.</p></details>}
            {army.rulerOrigin === 'new-game-name'&&<small className="duat-library-source">An authored Duat identity.</small>}
            {army.rulerOrigin === 'new-game-title' && <small className="duat-library-source">A new, customizable game title.</small>}
            {army.rulerOrigin === 'player-named' && <small className="duat-library-source">Named by this faction’s manager.</small>}
            {mayName && !editing && <button className="duat-link" disabled={busy} onClick={()=>{setName(army.rulerName || '');setEditing(true);}}>Name this ruler</button>}
            {mayName && editing && <form className="duat-library-name" onSubmit={save}><label>Ruler name<input value={name} onChange={event=>setName(event.target.value)} maxLength={64} autoComplete="off" required disabled={busy}/></label><div><button className="duat-button" type="submit" disabled={busy}>Save name</button><button className="duat-link" type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></div><p className="duat-muted">A retired name stays in the dynasty’s history.</p>{error && <p role="alert" className="duat-notice">{error}</p>}</form>}
        </article>;
    }
    function Honors({chosenFive,allTimeTeam}) {
        return <div className="duat-library-honors"><section className="duat-panel"><span className="duat-eyebrow">CHAMPIONSHIP PERFORMANCES</span><h3>The Chosen Five</h3><p className="duat-muted">Each athlete’s best championship starter score, before favors. The five highest enter the record.</p>{chosenFive.length ? <ol className="duat-library-honor-list">{chosenFive.map(player=><li key={player.identity}><span><strong>{player.name}</strong><small>{player.position} · {label(player.factionId)} · Dynasty {player.cycle}</small></span><b>{points(player.points)}</b></li>)}</ol> : <p className="duat-library-empty">The first championship will begin this record.</p>}</section><section className="duat-panel"><span className="duat-eyebrow">RETURNING CHAMPIONS</span><h3>The All Time Team</h3><p className="duat-muted">Athletes rostered on winning championship teams in at least two different dynasty seasons.</p>{allTimeTeam.length ? <ul className="duat-library-honor-list">{allTimeTeam.map(player=><li key={player.identity}><span><strong>{player.name}</strong><small>{player.position} · Dynasties {player.titles.map(title=>title.cycle).join(', ')}</small></span><b>{player.titles.length} titles</b></li>)}</ul> : <p className="duat-library-empty">A second championship appearance on a winning roster earns a place here.</p>}</section></div>;
    }
    function Journals({entries,factionId}) {
        const discovery = Lore.expedition({factionId,stage:'discovery'});
        return <section className="duat-library-journal"><div className="duat-panel-heading"><div><span className="duat-eyebrow">FIELD NOTES · T.A.</span><h2>The Archaeologist’s journal</h2></div><span className="duat-pill">{entries.length} {entries.length===1?'entry':'entries'}</span></div>
            {entries.length ? [...entries].reverse().map((entry,index)=><article className="duat-library-journal-entry" key={entry.id || index}><span className="duat-eyebrow">DYNASTY {entry.cycle || '—'}{entry.scoringSeason ? ` · ${entry.scoringSeason} ARMY` : ''}</span><h3>{entry.title || 'An entry in the record'}</h3>{entry.rulerName && <p className="duat-library-byline">{entry.rulerName} · {label(entry.factionId)}</p>}{(entry.paragraphs || [entry.message].filter(Boolean)).map((text,i)=><p key={i}>{text}</p>)}<small>{entry.attribution || (entry.origin==='new-expedition' ? 'A new expedition for this faction' : 'Your campaign journal')}</small><Source source={entry.source}/></article>) : <article className="duat-library-journal-entry"><span className="duat-eyebrow">THE NEXT EXPEDITION</span><h3>{discovery.title}</h3><p>{discovery.text}</p><p className="duat-muted">The completed discovery will be kept here after the ruler is revealed.</p><small>{discovery.attribution}</small></article>}
        </section>;
    }
    function OriginalHistory() {
        const history=Lore.ORIGINAL_HISTORY;
        return <div className="duat-library-original"><div className="duat-library-exhibit"><span className="duat-eyebrow">THE FOUNDER’S ARCHIVES</span><h2>{history.label}</h2><p>{history.description}</p></div><div className="duat-library-finals">{history.finals.map(final=><article key={final.year} className="duat-panel"><span className="duat-eyebrow">THE HEAVENLY BATTLE · {final.year}</span><div className="duat-library-crown"><Crest id={final.champion.factionId}/><div><h3>{final.champion.ruler}</h3><span>{final.champion.label} · Lord of the Duat</span></div></div><div className="duat-library-final-score"><strong>{points(final.champion.points)}</strong><span>to</span><strong>{points(final.runnerUp.points)}</strong></div><p>{final.runnerUp.ruler} · {final.runnerUp.label}</p><Source source={final.source}/></article>)}</div>
            <section className="duat-panel"><span className="duat-eyebrow">ORIGINAL ALLIANCES</span><h3>The Heptad roll of honor</h3><div className="duat-library-roll">{history.heptad.map(alliance=><article key={alliance.year}><span>{alliance.year}</span><div className="duat-library-paired-crests">{alliance.factionIds.map(id=><Crest key={id} id={id}/>)}</div><div><strong>{alliance.name}</strong><small>{alliance.factionIds.map(label).join(' & ')}</small></div></article>)}</div></section>
            <section className="duat-panel"><span className="duat-eyebrow">THE ORIGINAL EXPEDITION CHRONICLE</span><h3>Fifteen discoveries</h3><p className="duat-muted">The source story follows its own rulers and events. These chapters inspire new expeditions without replacing your campaign’s identities or results.</p><div className="duat-library-chapters">{Lore.CHAPTERS.map(chapter=><details key={chapter.chapter}><summary><span>{String(chapter.chapter).padStart(2,'0')}</span>{chapter.sourceFaction} · {chapter.ruler}</summary><p>{chapter.sourceSummary}</p><p className="duat-library-artifact">{chapter.artifact}</p>{!chapter.gameFactionId && <p className="duat-muted">A distinct source identity, preserved separately from the current factions.</p>}<Source source={{file:'The Duat (2021).pdf',pages:chapter.pdfPages}}/></details>)}</div></section>
        </div>;
    }
    function Pantheon({deities}) {
        const catalog=App.DuatRituals?.CATALOG || [];
        const ritualsFor=deity=>catalog.filter(ritual=>String(ritual.deity?.id || ritual.deity || '').toLowerCase()===deity.id);
        const Portrait=App.DuatDeityPortrait;
        return <section><div className="duat-panel-heading"><div><span className="duat-eyebrow">FAVORS OF THE GODS</span><h2>The divine codex</h2></div><span className="duat-pill">{deities.length} deities</span></div><p className="duat-muted">The gods’ roles in the Duat. The offering screen shows eligibility, costs and consequences under this campaign’s rules.</p><div className="duat-library-deities">{deities.map(deity=><article className="duat-library-deity" key={deity.id}>{Portrait ? <Portrait god={deity} className="duat-library-deity-portrait"/> : deity.art && <div className="duat-library-deity-portrait" role="img" aria-label={deity.name} style={{backgroundImage:`url(${imagePath(deity.art)})`,...(Number.isInteger(deity.atlasIndex)?{backgroundSize:'300% 300%',backgroundPosition:`${deity.atlasIndex%3*50}% ${Math.floor(deity.atlasIndex/3)*50}%`}:{backgroundSize:'cover'})}}/>}<div><span className="duat-eyebrow">{deity.title || 'THE PANTHEON'}</span><h3>{deity.name}</h3><p>{deity.description}</p>{ritualsFor(deity).length>0 && <details><summary>Offerings in the Duat</summary><ul>{ritualsFor(deity).map(ritual=><li key={ritual.id}><strong>{ritual.name}</strong><small>{ritual.timing}</small></li>)}</ul></details>}</div></article>)}</div></section>;
    }
    function Library({campaign,factionId,archive,journal,deities,onAction,busy = false,ready=false,actionError='',allianceVisible=false}) {
        const [section,setSection] = useState('dynasty');
        const faction=campaign?.factions?.find(item=>item.id===factionId), identity=Lore.faction(factionId);
        if (!faction || !identity) return <div className="duat-notice">Choose a faction to open its Royal Library.</div>;
        const summary=Lore.dynastySummary(campaign,factionId,archive), entries=journal ? journal.filter(item=>item.factionId===factionId) : summary.journal;
        const gods=deities || App.DuatRituals?.DEITIES || [], active=faction.armies?.find(army=>army.id===faction.activeArmyId);
        const tabs=[['dynasty','Your dynasty'],['names','Names & banners'],['journal','The Archaeologist'],['original','Original chronicles'],...(gods.length ? [['gods','The divine codex']] : [])];
        return <div className="duat-library"><header className="duat-library-hero" style={{backgroundImage:`linear-gradient(90deg,rgba(12,23,30,.98),rgba(12,23,30,.5)),url(${imagePath('images/duat/excavation.webp')})`}}><Crest id={factionId}/><div><span className="duat-eyebrow">THE ROYAL LIBRARY · {identity.name.toUpperCase()}</span><h2>{active?.rulerName || 'A dynasty waiting to return'}</h2><p>{active ? `${active.rulerRealm || identity.realm} · ${active.season} scoring season` : 'Names, tombs and the story your faction leaves behind.'}</p><span className="duat-library-cycle">Dynasty {campaign.dynasty?.cycle || 1}</span></div></header>
            <nav className="duat-library-tabs" aria-label="Royal Library sections">{tabs.map(([id,name])=><button key={id} className={section===id?'selected':''} aria-pressed={section===id} onClick={()=>setSection(id)}>{name}</button>)}</nav>
            {section==='dynasty' && <><div className="duat-library-record"><div><strong>{summary.record.titles}</strong><span>Lord of the Duat</span></div><div><strong>{summary.record.heptadTitles}</strong><span>Alliance titles</span></div><div><strong>{summary.record.camel}</strong><span>Camels</span></div><div><strong>{summary.record.wins}–{summary.record.losses}</strong><span>All-play record · {summary.record.seasons} completed seasons</span></div></div>
                <section><div className="duat-panel-heading"><div><span className="duat-eyebrow">THE KEEPERS OF YOUR FUTURE</span><h2>The royal tombs</h2></div><span className="duat-pill">{(faction.armies || []).filter(army=>!army.destroyed).length} armies</span></div><div className="duat-library-armies">{(faction.armies || []).map(army=><Army key={army.id} army={army} campaign={campaign} active={army.id===faction.activeArmyId} onAction={onAction} busy={busy||ready}/>)}</div></section>
                {summary.retired.length>0 && <section><span className="duat-eyebrow">THE DYNASTY REMEMBERS</span><h2>Lineage of rulers</h2><div className="duat-library-armies">{[...summary.retired].reverse().map((army,index)=><Army key={`${army.id}-${army.retiredCycle}-${index}`} army={army} campaign={campaign} retired/>)}</div></section>}
                <Honors chosenFive={summary.chosenFive} allTimeTeam={summary.allTimeTeam}/>
                {summary.seasons.length>0 && <section className="duat-panel"><span className="duat-eyebrow">YOUR CAMPAIGN ANNALS</span><h3>Seasons remembered</h3><div className="duat-library-roll">{[...summary.seasons].reverse().map(season=><article key={season.id || season.cycle}><span>Dynasty {season.cycle}</span><Crest id={season.championId}/><div><strong>{season.rulers?.find(army=>army.factionId===season.championId)?.rulerName || label(season.championId)}</strong><small>{label(season.championId)} · Lord of the Duat</small></div></article>)}</div></section>}</>}
            {section==='names'&&<App.DuatIdentityLibraryView campaign={campaign} factionId={factionId} onAction={onAction} busy={busy} ready={ready} actionError={actionError} allianceVisible={allianceVisible}/>}
            {section==='journal' && <Journals entries={entries} factionId={factionId}/>}
            {section==='original' && <OriginalHistory/>}
            {section==='gods' && <Pantheon deities={gods}/>}
        </div>;
    }
    App.DuatCrest=Crest;
    App.DuatLibrary=Library;
})(typeof window !== 'undefined' ? window : globalThis);
