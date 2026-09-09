/* global module */
(function(root,factory){
    'use strict';
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    root.App=root.App||{};root.App.DuatWeeklyProgress=api;
})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const PREFIX='dhq-duat-weekly-ui-v1:';
    const cycleOf=campaign=>campaign.dynastySeason||campaign.dynasty?.cycle||1;
    const completed=campaign=>[...(campaign.completedWeeks||[])].sort((a,b)=>a.week-b.week);
    const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
    function resultFingerprint(snapshot){
        // Keep presentation acknowledgements attached to the actual played
        // result, including after backup rollback or an authoritative refresh.
        const value=JSON.stringify([snapshot.week,(snapshot.factions||[]).map(f=>[f.factionId,f.season,f.total,f.baseTotal,f.favorCost,f.teamAdjustment,(f.players||[]).map(p=>[p.id,p.starter,p.basePoints,p.effectivePoints]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
        let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
        return 'result-'+(hash>>>0).toString(36)+'-'+value.length;
    }
    function key(campaign,factionId,scope='solo'){
        return PREFIX+[scope,campaign.id,cycleOf(campaign),factionId].map(encodeURIComponent).join(':');
    }
    function create(campaign,factionId){
        const latest=completed(campaign).at(-1)?.week||0;
        return {version:1,campaignId:campaign.id,cycle:cycleOf(campaign),factionId,
            allianceSeen:campaign.week>1||latest>0,reviewedThrough:Math.max(0,latest-1),results:{},preparations:{}};
    }
    function normalize(raw,campaign,factionId){
        const fresh=create(campaign,factionId);
        if(!raw||raw.version!==1||raw.campaignId!==campaign.id||raw.cycle!==cycleOf(campaign)||raw.factionId!==factionId)return fresh;
        const latest=completed(campaign).at(-1)?.week||0;
        const value={...fresh,allianceSeen:raw.allianceSeen===true,reviewedThrough:integer(raw.reviewedThrough,0,latest)?raw.reviewedThrough:fresh.reviewedThrough};
        for(const [week,result] of Object.entries(raw.results||{})){
            if(!integer(Number(week),1,17)||!result||typeof result!=='object')continue;
            const snapshot=completed(campaign).find(item=>item.week===Number(week));
            if(!snapshot||result.fingerprint!==resultFingerprint(snapshot)){
                if(snapshot&&Number(week)<=value.reviewedThrough)value.reviewedThrough=Math.max(0,Number(week)-1);
                continue;
            }
            const clock=Number.isFinite(result.clock)?Math.max(0,Math.min(60,result.clock)):0;
            value.results[week]={fingerprint:result.fingerprint,clock,watched:result.watched===true&&clock===60,recapSeen:result.recapSeen===true&&clock===60};
        }
        for(const [week,prep] of Object.entries(raw.preparations||{})){
            if(integer(Number(week),1,17)&&prep&&typeof prep.fingerprint==='string'&&prep.fingerprint.length<20000)
                value.preparations[week]={fingerprint:prep.fingerprint,favorsSeen:prep.favorsSeen===true};
        }
        return value;
    }
    function read(campaign,factionId,storage,scope){
        try{return normalize(JSON.parse(storage.getItem(key(campaign,factionId,scope))),campaign,factionId);}
        catch{return create(campaign,factionId);}
    }
    function write(progress,campaign,factionId,storage,scope){
        const value=normalize(progress,campaign,factionId);
        storage.setItem(key(campaign,factionId,scope),JSON.stringify(value));
        return value;
    }
    function fingerprint(faction,lineup){
        const army=faction?.armies?.find(item=>item.id===faction.activeArmyId);
        return JSON.stringify([army?.id||'',(army?.players||[]).map(player=>player.id).sort(),[...(lineup||[])].sort()]);
    }
    function describe(raw,campaign,factionId,context={}){
        const progress=normalize(raw,campaign,factionId),weeks=completed(campaign);
        const pending=weeks.find(snapshot=>snapshot.week>progress.reviewedThrough);
        if(pending){
            const result=progress.results[pending.week]||{clock:0,watched:false,recapSeen:false};
            return {stage:!result.watched?'games':!result.recapSeen?'recap':'conquest',week:pending.week,resultWeek:pending.week,preparationWeek:null,clock:result.clock,progress,
                caughtUp:pending.week===(weeks.at(-1)?.week||0)};
        }
        if(campaign.phase==='complete')return {stage:'complete',week:17,resultWeek:null,preparationWeek:null,progress,caughtUp:true};
        const week=campaign.week,prep=progress.preparations[week];
        let stage='kickoff';
        if(!progress.allianceSeen&&week===1)stage='alliance';
        else if(context.dirty||!context.legal||!prep||prep.fingerprint!==context.fingerprint)stage='lineup';
        else if(context.pendingMahdi||context.hasFavors&&!prep.favorsSeen)stage='favors';
        return {stage,week,resultWeek:null,preparationWeek:week,progress,caughtUp:true};
    }
    function update(raw,campaign,factionId,event){
        const next=normalize(raw,campaign,factionId),week=Number(event.week||campaign.week);
        if(event.type==='alliance-seen')next.allianceSeen=true;
        if(event.type==='lineup-confirm'&&integer(week,1,17))next.preparations[week]={fingerprint:event.fingerprint,favorsSeen:false};
        if(event.type==='edit-lineup'&&next.preparations[week])delete next.preparations[week];
        if(event.type==='edit-favors'&&next.preparations[week])next.preparations[week].favorsSeen=false;
        if(event.type==='favors-done'&&next.preparations[week])next.preparations[week].favorsSeen=true;
        if(completed(campaign).some(item=>item.week===week)){
            const result=next.results[week]||{fingerprint:resultFingerprint(completed(campaign).find(item=>item.week===week)),clock:0,watched:false,recapSeen:false};
            if(event.type==='clock'){
                result.clock=Math.max(result.clock,Math.max(0,Math.min(60,Number(event.clock)||0)));
                if(result.clock===60)result.watched=true;
                next.results[week]=result;
            }
            if(event.type==='recap-done'&&result.watched){result.recapSeen=true;next.results[week]=result;}
            if(event.type==='conquest-reopen'&&result.watched&&result.recapSeen)next.reviewedThrough=Math.min(next.reviewedThrough,week-1);
            if(event.type==='conquest-done'&&result.watched&&result.recapSeen&&completed(campaign).find(item=>item.week>next.reviewedThrough)?.week===week)next.reviewedThrough=week;
        }
        return next;
    }
    return {PREFIX,key,cycleOf,create,normalize,read,write,fingerprint,resultFingerprint,describe,update};
});
