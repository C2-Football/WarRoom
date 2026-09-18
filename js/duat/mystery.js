/* global module, require */
// Hidden-year Historical Replay: the roster card is public; its fixed scoring
// season lives only in the authoritative assignment map. Inference reads the
// same completed box scores as the manager, never that map.
(function(root,factory){
    const common=typeof module!=='undefined'&&module.exports;
    const api=factory(common?require('./rules.js'):root.App.DuatRules,root.App.TimeLeagueSeason);
    (root.App=root.App||{}).DuatMystery=api;if(common)module.exports=api;
})(typeof window!=='undefined'?window:globalThis,function(Rules,Season){
    'use strict';
    const clone=value=>JSON.parse(JSON.stringify(value));
    const enabled=state=>state?.version===4&&state.era?.mode==='historical'&&state.era?.hiddenYears===true;
    const round=value=>Math.round(value*100)/100;
    const fail=message=>{const error=new Error(message);error.code='INVALID_MYSTERY';throw error;};
    const archiveYears=data=>(data?.availableSeasons||data?.manifest?.availableSeasons||[]).filter(Number.isInteger);
    const cardsOf=data=>data?.cards?.values?[...data.cards.values()]:Array.isArray(data?.cards)?data.cards:data?.cards?.players||[];
    const cardId=(identity,decade,origin,cycle)=>identity+':veil:'+cycle+':'+origin+':'+decade;
    const statKeys=new Set([...Object.keys(Season.emptyStatLine()),...(Season.EXTENDED_STAT_IDS||[])]);
    const numericStats=stats=>Object.fromEntries(Object.entries(stats||{}).filter(([key,value])=>statKeys.has(key)&&typeof value==='number'&&Number.isFinite(value)).sort(([a],[b])=>a.localeCompare(b)));
    const signature=(stats,recorded)=>JSON.stringify({recorded:Boolean(recorded),stats:numericStats(stats)});
    const caches=new WeakMap();
    function pool(state,data,originSeason){
        if(!data?.cards||!data?.logIndex)fail('The historical archive must load before choosing mystery players.');
        let cache=caches.get(data.cards);if(!cache){cache=new Map();caches.set(data.cards,cache);}
        const years=archiveYears(data).length?archiveYears(data):[...new Set([...data.logIndex.values()].map(log=>log.season))];
        const key=originSeason+':'+state.dynastySeason+':'+JSON.stringify(state.scoring)+':'+years.join(',');
        if(!cache.has(key)){
            const supported=new Set(years),rows=[];
            for(const card of cardsOf(data)){
                if(!['QB','RB','WR','TE'].includes(card.position)||!card.identity)continue;
                const byDecade=new Map();
                for(const entry of card.seasons||[]){
                    if(!supported.has(entry.season))continue;
                    const games=[];for(let week=1;week<=17;week++){const log=data.logIndex.get(Season.gameLogKey(card.identity,entry.season,week));if(log)games.push(log);}
                    if(!games.length)continue;
                    const decade=Math.floor(entry.season/10)*10,values=byDecade.get(decade)||[];
                    values.push({year:entry.season,points:games.reduce((sum,log)=>sum+Season.scoreStatLine(log.stats,state.scoring,{}),0)/17});byDecade.set(decade,values);
                }
                for(const [decade,values] of byDecade){
                    const candidateYears=values.map(value=>value.year).sort((a,b)=>a-b);
                    // season is the ruler's origin, NOT the secretly assigned NFL year.
                    rows.push({id:cardId(card.identity,decade,originSeason,state.dynastySeason),identity:card.identity,name:card.name,position:card.position,season:originSeason,decade,candidateYears,mysteryCycle:state.dynastySeason,referenceSeason:null,referencePoints:round(values.reduce((sum,value)=>sum+value.points,0)/values.length)});
                }
            }
            cache.set(key,rows.sort((a,b)=>b.referencePoints-a.referencePoints||a.id.localeCompare(b.id)));
        }
        return cache.get(key).map(player=>({...player,candidateYears:[...player.candidateYears]}));
    }
    function snapshotCard(state,player,data){
        const prior=state.hiddenYears?.assignments?.[player.id];
        if(!prior)return player;
        // Reacquisition keeps the original public candidate set as well as the
        // private year. A larger archive cannot quietly create a different card.
        const candidateYears=[...prior.candidateYears];
        let total=0;
        for(const year of candidateYears)for(let week=1;week<=17;week++){
            const log=data.logIndex.get(Season.gameLogKey(player.identity,year,week));
            if(log)total+=Season.scoreStatLine(log.stats,state.scoring,{});
        }
        return {...player,candidateYears,referencePoints:round(total/(17*candidateYears.length))};
    }
    function isCard(player){return Number.isInteger(player?.decade)&&Array.isArray(player?.candidateYears)&&player.id===cardId(player.identity,player.decade,player.season,player.mysteryCycle);}
    function assign(state,player){
        if(!enabled(state)||!isCard(player))return;
        if(!state.hiddenYears||state.hiddenYears.version!==1)fail('The hidden-year ledger is missing.');
        if(state.hiddenYears.assignments[player.id])return;
        if(typeof state.seed!=='string'||!state.seed)fail('Only the authoritative campaign can assign a scoring year.');
        const random=Rules.createSeededRandom(state.seed+':hidden-year:'+player.id);
        const season=player.candidateYears[Math.floor(random()*player.candidateYears.length)];
        state.hiddenYears.assignments[player.id]={season,identity:player.identity,decade:player.decade,candidateYears:[...player.candidateYears]};
    }
    function assignRosters(state){
        if(!enabled(state))return;
        for(const faction of state.factions)for(const player of [...faction.armies.flatMap(army=>army.players),faction.rituals?.pendingMahdi?.player,faction.rituals?.amunClaim].filter(Boolean))assign(state,player);
    }
    function scoringSeason(state,player,fallback){
        if(!enabled(state))return player.season||fallback;
        const entry=state.hiddenYears?.assignments?.[player.id];
        if(!isCard(player)||!entry||!player.candidateYears.includes(entry.season))fail('This player has no valid fixed hidden year.');
        return entry.season;
    }
    function validate(state,data){
        if(!enabled(state)){if(state.hiddenYears!==undefined)fail('Hidden years require a Historical Replay mystery campaign.');return true;}
        const book=state.hiddenYears;
        if(!book||book.version!==1||!book.assignments||typeof book.assignments!=='object'||Array.isArray(book.assignments))fail('Invalid hidden-year ledger.');
        const expectedPools=new Map();
        const allowedReveals=new Set([...(state.phase==='complete'?state.completedWeeks:[]),...state.dynasty.seasons.flatMap(season=>season.completedWeeks||[])].flatMap(week=>week.factions.flatMap(f=>f.players.map(p=>p.id))));
        const factions=new Set(state.factions.map(f=>f.id));
        if(!book.revealedByFaction||typeof book.revealedByFaction!=='object'||Array.isArray(book.revealedByFaction)||Object.entries(book.revealedByFaction).some(([factionId,ids])=>!factions.has(factionId)||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!book.assignments[id]||!allowedReveals.has(id))))fail('Invalid year-reveal history.');
        for(const [id,entry] of Object.entries(book.assignments)){
            if(!entry||typeof entry.identity!=='string'||!id.startsWith(entry.identity+':veil:')||!Number.isInteger(entry.decade)||entry.decade%10||!Array.isArray(entry.candidateYears)||!entry.candidateYears.length||new Set(entry.candidateYears).size!==entry.candidateYears.length||entry.candidateYears.some(year=>!Number.isInteger(year)||Math.floor(year/10)*10!==entry.decade)||!entry.candidateYears.includes(entry.season))fail('Invalid hidden-year assignment.');
            const random=Rules.createSeededRandom(state.seed+':hidden-year:'+id);
            if(entry.season!==entry.candidateYears[Math.floor(random()*entry.candidateYears.length)])fail('A fixed hidden scoring year was changed.');
        }
        for(const faction of state.factions)for(const player of [...faction.armies.flatMap(army=>army.players),faction.rituals?.pendingMahdi?.player,faction.rituals?.amunClaim].filter(Boolean)){
            if(!isCard(player)||player.referenceSeason!==null||!player.candidateYears.length||new Set(player.candidateYears).size!==player.candidateYears.length||player.candidateYears.some(year=>!Number.isInteger(year)||Math.floor(year/10)*10!==player.decade))fail('Invalid player and decade card.');
            if(data){const poolKey=player.mysteryCycle+':'+player.season;if(!expectedPools.has(poolKey))expectedPools.set(poolKey,new Map(pool({...state,dynastySeason:player.mysteryCycle},data,player.season).map(card=>[card.id,card])));const expected=expectedPools.get(poolKey).get(player.id);if(!expected||player.candidateYears.some(year=>!expected.candidateYears.includes(year)))fail('This player and decade contains an unavailable archive season.');}
            const entry=book.assignments[player.id];
            if(!entry||entry.identity!==player.identity||entry.decade!==player.decade||JSON.stringify(entry.candidateYears)!==JSON.stringify(player.candidateYears))fail('A roster card does not match its fixed hidden-year assignment.');
        }
        return true;
    }
    function observations(state,player,throughWeek){
        const cap=Math.max(0,Math.min(Number.isInteger(throughWeek)?throughWeek:state.week-1,state.week-1));
        return (state.completedWeeks||[]).filter(week=>week.week<=cap).flatMap(week=>week.factions.flatMap(f=>f.players.filter(p=>p.id===player.id).map(p=>({week:week.week,basePoints:p.basePoints,effectivePoints:p.effectivePoints,hasRecordedGame:Boolean(p.hasRecordedGame),stats:numericStats(p.stats)}))));
    }
    function inspect(state,player,data,options={}){
        const observed=observations(state,player,options.throughWeek),years=[...(player.candidateYears||[])];
        const candidates=years.map(year=>{
            const games=Array.from({length:17},(_,index)=>{const week=index+1,log=data?.logIndex?.get(Season.gameLogKey(player.identity,year,week));return {week,hasRecordedGame:Boolean(log),stats:numericStats(log?.stats),points:log?round(Season.scoreStatLine(log.stats,state.scoring,{})):0};});
            const hasArchive=Boolean(data?.logIndex?.size);
            const contradictions=hasArchive?observed.filter(line=>signature(line.stats,line.hasRecordedGame)!==signature(games[line.week-1].stats,games[line.week-1].hasRecordedGame)).map(line=>line.week):[];
            return {year,games,compatible:hasArchive?!contradictions.length:null,contradictions,points:round(games.reduce((sum,game)=>sum+game.points,0))};
        });
        return {label:playerLabel(player),observed,candidates,remaining:candidates.filter(row=>row.compatible!==false).map(row=>row.year),archiveReady:Boolean(data?.logIndex?.size),revealedSeason:player.revealedSeason||(state.hiddenYears?.revealedByFaction?.[options.factionId]?.includes(player.id)?state.hiddenYears.assignments[player.id]?.season:null)||null};
    }
    function playerLabel(player){return isCard(player)?player.decade+'s · '+(player.revealedSeason?player.revealedSeason+' revealed':'year hidden'):(player?.season?String(player.season):'Historical player');}
    function reveal(state,factionId){
        if(!enabled(state)||state.phase!=='complete'||!state.factions.some(f=>f.id===factionId))fail('Scoring years can be revealed from the final season recap.');
        const played=[...new Set(state.completedWeeks.flatMap(week=>week.factions.flatMap(f=>f.players.map(p=>p.id))))];
        state.hiddenYears.revealedByFaction[factionId]=[...new Set([...(state.hiddenYears.revealedByFaction[factionId]||[]),...played])];
    }
    function project(state,viewerFactionId){
        if(!enabled(state))return state;
        const projected=clone(state),assignments=state.hiddenYears?.assignments||{};delete projected.hiddenYears;delete projected.seed;if(projected.conquest)delete projected.conquest.seed;
        const known=new Set(state.hiddenYears?.revealedByFaction?.[viewerFactionId]||[]);
        projected.hiddenYearRevealAvailable=state.phase==='complete'&&state.completedWeeks.some(week=>week.factions.some(f=>f.players.some(p=>!known.has(p.id))));
        const walk=value=>{
            if(!value||typeof value!=='object')return;
            if(Array.isArray(value)){for(const item of value)walk(item);return;}
            if(isCard(value)){
                delete value.revealedSeason;
                if(known.has(value.id)&&assignments[value.id])value.revealedSeason=assignments[value.id].season;
                if(value.stats)value.stats=numericStats(value.stats);
            }
            for(const item of Object.values(value))walk(item);
        };
        walk(projected);
        return projected;
    }
    return {enabled,pool,snapshotCard,isCard,assign,assignRosters,scoringSeason,validate,observations,inspect,playerLabel,reveal,project,numericStats};
});
