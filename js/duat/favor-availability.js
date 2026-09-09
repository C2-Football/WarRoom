/* global module, require */
// Read-only planning guidance. The campaign reducer still authorizes every
// offering; browsing must never roll a die or inspect this week's hidden result.
(function(root,factory){
    const App=root.App=root.App||{},common=typeof module!=='undefined'&&module.exports;
    const api=factory(common?require('./dynasty.js'):App.DuatCampaign,common?require('./favors.js'):App.DuatFavors,common?require('./rituals.js'):App.DuatRituals);
    App.DuatFavorAvailability=api;if(common)module.exports=api;
})(typeof window!=='undefined'?window:globalThis,function(Engine,Favors,Rituals){
    'use strict';
    const status=reason=>({available:!reason,reason:reason||''});
    const positions=['ALL','QB','RB','WR','TE','FLEX'];
    const round=value=>Math.round(value*100)/100;
    function describe({campaign,factionId,busy=false,ready=false,dirty=false,readOnly=false,availablePlayers=[],poolLoaded=true,lineup,selection={}}){
        const expanded=campaign.expansionVersion===1,catalog=expanded?Rituals.CATALOG:Favors.FAVORS;
        const faction=campaign.factions.find(f=>f.id===factionId),army=faction&&Engine.activeArmy(faction),r=faction?.rituals||{},draw=r.pendingMahdi;
        const cycle=campaign.dynastySeason||campaign.dynasty?.cycle||1,ordinal=(cycle-1)*17+Math.min(17,campaign.week),settings=Engine.settingsOf(campaign);
        const declarations=expanded?(faction?.declaredFavors||r.declaredFavors||(faction?.declaredFavor?[faction.declaredFavor]:[])):(faction?.declaredFavor?[faction.declaredFavor]:[]);
        const reserved=declarations.reduce((n,d)=>n+(Favors.getFavor(d.favorId,expanded?1:undefined)?.cost||0),0)+(expanded?r.ebisu?.wager||0:0),availableFavor=round((faction?.favorBalance||0)-reserved);
        const lockReason=!faction?'Choose your faction.':readOnly?'Only this faction’s controller can make an offering.':busy?'Wait for the current offering to finish saving.':ready?'Unready your faction before changing an offering.':dirty?'Save your lineup before calling on the gods.':!settings.favors?'Favors are turned off for this campaign.':'';
        const preseason=campaign.phase==='season'&&campaign.week===1&&!campaign.completedWeeks.length,sacred=campaign.phase==='season'&&Favors.SACRED_WEEKS.includes(campaign.week),champion=campaign.phase==='complete'&&campaign.championId===factionId;
        const planning=(army?.players||[]).map(p=>{const {hasRecordedGame:_sealed,...card}=p;return expanded?{...card,starter:(lineup||faction.lineup).includes(p.id)}:{id:p.id,starter:(lineup||faction.lineup).includes(p.id)};});
        const history=(campaign.completedWeeks||[]).filter(w=>w.week<campaign.week&&w.finalized!==false).map(w=>({week:w.week,finalized:w.finalized,status:w.status,players:w.factions.find(f=>f.factionId===factionId)?.players||[]}));
        const buried=(faction?.armies||[]).filter(a=>a.id!==army?.id&&!a.destroyed),notBanished=p=>!(r.banishedPlayerIds||[]).includes(p.id)&&!(r.banishedPlayerIdentities||[]).includes(p.identity);
        const canField=players=>Boolean(faction&&Rituals.canField(faction,players));
        const poolState={...campaign,factions:campaign.factions.map(f=>({...f,armies:(f.armies||[]).map(a=>({...a,players:a.players||[]}))}))};
        const pool=(season,position='ALL',limit=10000)=>{try{return Rituals.playerPool(poolState,factionId,availablePlayers,{season,position,limit});}catch(_){return [];}};
        const activeIds=(army?.players||[]).map(p=>p.id),rosterFull=Boolean(army&&army.players.length>=Engine.rosterSize(campaign));
        const anubisReplacements=target=>(buried.flatMap(a=>a.players||[])).filter(p=>notBanished(p)&&army?.players.some(a=>a.id===target)&&canField(army.players.filter(a=>a.id!==target).concat(p))).map(p=>p.id);
        const cooldownReason=(r.cooldowns?.mahdi||0)>ordinal?'Mahdi returns in dynasty season '+(Math.floor((r.cooldowns.mahdi-1)/17)+1)+', Week '+((r.cooldowns.mahdi-1)%17+1)+'.':'';
        const used=id=>(r.ledger||[]).some(e=>e.ritualId===id&&e.cycle===cycle),byId={};
        function weeklyEntry(favor){
            const sourceWeeksByTarget={},targetIds=[],reasons=[];
            for(const player of planning.filter(p=>p.starter)){
                const old=expanded?declarations.find(d=>d.playerId===player.id):declarations[0];
                const credit=old?Favors.getFavor(old.favorId,expanded?1:undefined)?.cost||0:0;
                const weeks=favor.kind==='recall'?(favor.previousWeekOnly?[campaign.week-1]:history.map(w=>w.week)):[undefined];
                for(const sourceWeek of weeks)try{Favors.validateDeclaration({declaration:{favorId:favor.id,playerId:player.id,sourceWeek},week:campaign.week,balance:availableFavor+credit,playerResults:planning,history,expansionVersion:expanded?1:undefined});if(!targetIds.includes(player.id))targetIds.push(player.id);if(sourceWeek!==undefined)(sourceWeeksByTarget[player.id]||=[]).push(sourceWeek);}catch(error){reasons.push(error.message);}
            }
            return {...status(lockReason||(!army?'Reveal your walking ruler first.':!sacred?'Available in sacred weeks 5, 7, 10, 14, 15, 16 and 17.':draw?'Accept or decline the waiting Mahdi recruit first.':!targetIds.length?reasons[0]||'No eligible starter has a recorded score for this favor.':'')),targetIds,sourceWeeksByTarget,positionIds:[],wagerAmounts:[]};
        }
        for(const favor of expanded?Favors.EXPANDED_FAVORS:Favors.FAVORS)byId[favor.id]=weeklyEntry(favor);
        if(expanded)for(const ritual of Rituals.RITUALS){
            const id=ritual.id,targetIds=[],positionIds=[],wagerAmounts=[];
            const throne=['amun','plutus'].includes(id),preOnly=['anubis','shiva','summon-mahdi'].includes(id);
            let reason=lockReason||draw&&'Accept or decline the waiting Mahdi recruit first.'||!throne&&!army&&'Reveal your walking ruler first.'||throne&&!champion&&'The reigning champion may invoke this after Week 17.'||preOnly&&!preseason&&'Available after the reveal and before Week 1.'||!throne&&!preOnly&&!sacred&&'Available in sacred weeks 5, 7, 10, 14, 15, 16 and 17.'||'';
            if(['midas','anubis','shiva'].includes(id)&&declarations.length)reason=reason||'Clear starter favors before changing the army.';
            if(id==='midas'){
                targetIds.push(...(army?.players||[]).filter(p=>canField(army.players.filter(x=>x.id!==p.id))).map(p=>p.id));
                reason=reason||(!targetIds.length?'Keep enough players to fill every starting slot.':'');
            }else if(id==='anubis'){
                targetIds.push(...activeIds.filter(id=>anubisReplacements(id).length));
                reason=reason||(r.cooldowns?.anubis===cycle?'Anubis has already answered this dynasty season.':!targetIds.length?'No eligible buried player can join a legal walking lineup.':'');
            }else if(id==='shiva')reason=reason||(!buried.some(a=>canField(a.players))?'At least one other legal buried army must survive Shiva.':'');
            else if(['mahdi','summon-mahdi','super-mahdi'].includes(id)){
                const season=id==='super-mahdi'?Math.max(...campaign.seasons):army?.season;
                positionIds.push(...positions.filter(position=>pool(season,position).length));
                reason=reason||cooldownReason||(id==='super-mahdi'&&!buried.some(a=>a.players.length)?'Super Mahdi needs a buried player for its sacrifice.':!poolLoaded?'Loading recruitment choices.':!positionIds.length?'No eligible recruits remain for this year.':'');
            }else if(id==='ebisu'){
                wagerAmounts.push(...Rituals.WAGERS.filter(w=>w.amount<=availableFavor+(r.ebisu?.wager||0)).map(w=>w.amount));
                reason=reason||((r.ledger||[]).some(e=>e.ritualId==='ebisu-result'&&e.cycle===cycle&&e.week===campaign.week)?'Ebisu has already rolled this sacred week.':!wagerAmounts.length?'Reserve at least 10 favor for an Ebisu wager.':'');
            }else if(id==='plutus')reason=reason||(used(id)?'Plutus grants one attempt per championship.':'');
            else if(id==='amun'){
                const usedIds=new Set(campaign.factions.flatMap(f=>(f.armies||[]).flatMap(a=>(a.players||[]).map(p=>p.id))));
                targetIds.push(...availablePlayers.filter(p=>p?.id&&notBanished(p)&&!usedIds.has(p.id)).map(p=>p.id));
                reason=reason||(r.amunClaim?'Amun has already reserved your next recruit.':availableFavor<(used(id)?11:1)?(used(id)?'Keep 11 favor available: 10 for the roll and 1 for a successful claim.':'Keep 1 favor available for a successful claim.'):!poolLoaded?'Loading champion recruitment choices.':!targetIds.length?'No eligible recruit remains in the next ruler’s pool.':'');
            }
            byId[id]={...status(reason),targetIds,sourceWeeksByTarget:{},positionIds,wagerAmounts};
        }
        const chosen=catalog.find(f=>f.id===selection.favorId),entry=byId[selection.favorId];
        const selected={...(entry||status('Choose a favor.')),targetIds:entry?.targetIds||[],replacementIds:[],sourceWeeks:entry?.sourceWeeksByTarget?.[selection.target]||[],positionIds:entry?.positionIds||[],wagerAmounts:entry?.wagerAmounts||[],requiresConfirmation:['midas','anubis','shiva'].includes(selection.favorId)};
        let selectedReason=selected.reason;
        if(chosen&&!selectedReason){
            if(Favors.getFavor(chosen.id,expanded?1:undefined)){
                selectedReason=!entry.targetIds.includes(selection.target)?'Choose an eligible starter.':chosen.kind==='recall'&&!selected.sourceWeeks.includes(chosen.previousWeekOnly?campaign.week-1:Number(selection.sourceWeek))?'Choose a recorded earlier week for this starter.':'';
            }else if(['midas','anubis','amun'].includes(chosen.id))selectedReason=!entry.targetIds.includes(selection.target)?'Choose an eligible player.':'';
            else if(['mahdi','summon-mahdi','super-mahdi'].includes(chosen.id))selectedReason=!entry.positionIds.includes(selection.position||'ALL')?'No eligible recruits remain at this position.':'';
            else if(chosen.id==='ebisu')selectedReason=!entry.wagerAmounts.includes(selection.wager??10)?'Choose a wager your available favor can cover.':'';
        }
        if(chosen?.id==='anubis'){selected.replacementIds=anubisReplacements(selection.target);selectedReason=selectedReason||(!selected.replacementIds.includes(selection.replacement)?'Choose an eligible player from a buried army.':'');}
        if(selected.requiresConfirmation&&!selection.confirmed)selectedReason=selectedReason||'Confirm the permanent consequence before invoking this ritual.';
        Object.assign(selected,status(selectedReason));
        const pending={accept:status('There is no waiting recruit.'),reroll:status('There is no waiting recruit.'),decline:status('There is no waiting recruit.'),releaseIds:[],requiresConfirmation:false};
        if(draw){
            pending.releaseIds=rosterFull?(army?.players||[]).filter(p=>canField(army.players.filter(x=>x.id!==p.id).concat(draw.player))).map(p=>p.id):[];
            pending.requiresConfirmation=rosterFull||draw.ritualId==='super-mahdi';
            const eligible=pool(draw.season,draw.position),rerollPool=pool(draw.season,draw.position,20).filter(p=>(draw.poolIds||[]).includes(p.id));
            let acceptReason=lockReason||!army&&'Reveal your walking ruler first.'||declarations.length&&'Clear starter favors before accepting the recruit.'||!poolLoaded&&'Loading recruitment choices.'||!eligible.some(p=>p.id===draw.player.id)&&'This recruit is no longer available. Decline this draw to continue.'||rosterFull&&!pending.releaseIds.includes(selection.replacement)&&'Choose a player to release while keeping a legal lineup.'||!rosterFull&&!canField((army?.players||[]).concat(draw.player))&&'The recruit must leave a legal starting lineup.'||draw.ritualId==='super-mahdi'&&!buried.some(a=>a.players.length)&&'No buried player remains for Super Mahdi’s sacrifice.'||'';
            if(pending.requiresConfirmation&&!selection.confirmed)acceptReason=acceptReason||'Confirm the permanent consequence before accepting the recruit.';
            pending.accept=status(acceptReason);pending.decline=status(lockReason);
            pending.reroll=status(lockReason||draw.rerolls>=1&&'Only one Mahdi reroll is allowed.'||availableFavor<20&&'A Mahdi reroll requires 20 available favor.'||!poolLoaded&&'Loading recruitment choices.'||!rerollPool.length&&'No eligible players remain in the original draw.'||'');
        }
        return {byId,selected,pending,reserved,availableFavor,lockReason};
    }
    return Object.freeze({describe});
});
