/* global module, require */
(function (root, factory) {
    const App = root.App = root.App || {};
    const common = typeof module !== 'undefined' && module.exports;
    const api = factory(common ? require('./dynasty.js') : App.DuatCampaign,
        common ? require('./rules.js') : App.DuatRules, common ? require('./heptad.js') : App.DuatHeptad,
        common ? require('./favors.js') : App.DuatFavors, common ? require('./rituals.js') : App.DuatRituals,
        common ? require('./conquest.js') : App.DuatConquest);
    App.DuatWeeklyFlow = api;
    if (common) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Engine, Rules, Heptad, Favors, Rituals, Conquest) {
    'use strict';
    const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
    const round = value => Math.round(value * 100) / 100;
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const cycleOf = campaign => campaign.dynastySeason || campaign.dynasty?.cycle || 1;
    const factionOf = (campaign, id) => campaign.factions?.find(f => f.id === id);
    const nameOf = (campaign, id) => factionOf(campaign, id)?.name || id;
    const alliancesOf = campaign => campaign.alliances || [];
    const allianceOf = (campaign, factionId) => alliancesOf(campaign).find(a => a.teamIds.includes(factionId));
    const allianceName = (campaign, id) => alliancesOf(campaign).find(a => a.id === id)?.name || id;
    const completed = (campaign, week) => Number.isInteger(week) && week >= 1 && week <= 17
        ? (campaign.completedWeeks || []).find(w => w.week === week && w.finalized !== false) : null;
    const through = (campaign, week) => (campaign.completedWeeks || []).filter(w => w.week <= week && w.finalized !== false);
    const settingsOf = campaign => Engine.settingsOf(campaign);
    const active = faction => faction?.armies?.find(a => a.id === faction.activeArmyId && !a.destroyed);
    const matchFor = (matches, id, week) => matches.find(m => m.week === week && [m.homeId, m.awayId].includes(id));
    const roundName = id => ({quarterfinal:'Quarterfinal',semifinal:'Semifinal',championship:'Championship','third-place':'Third-place game',top:'Challenger path',bottom:'Redemption path',rematch:'Championship reset',pinnacle:'Pinnacle Battle'}[id] || id);

    function allianceIntro(campaign, factionId) {
        const alliance = allianceOf(campaign, factionId);
        if (!alliance) return null;
        const entranceWeek = 2 + Math.max(0, alliance.entry - 2);
        return {alliance:copy(alliance),partners:alliance.teamIds.filter(id => id !== factionId).map(id => {
            const f = factionOf(campaign,id); return {id,name:f?.name || id,color:f?.color,sigil:f?.sigil};
        }),startWeek:2,entranceWeek,entry:alliance.entry,
        label:alliance.name,entryLabel:alliance.entry <= 2 ? 'Your alliance opens the Games in Week 2.' : 'Your alliance enters in Week '+entranceWeek+'.',
        explanation:'The Heptad Games begin in Week 2. Your partners combine their best eligible players into one lineup. One loss sends an alliance to redemption; a second ends its run.',
        options:copy(Heptad.normalizeOptions(campaign.expansionSettings?.heptad || campaign.heptadOptions || {}))};
    }

    function heptadAt(campaign, week) {
        const snapshot = completed(campaign,week)?.heptad;
        if (snapshot) return {...copy(snapshot),matches:(snapshot.matches || []).filter(m => m.week <= week)};
        const records = through(campaign,week);
        return Rules.runHeptadGauntlet(alliancesOf(campaign), (id,w) => {
            const score = records.find(row => row.week === w)?.allianceScores?.find(a => a.allianceId === id)?.total;
            return finite(score) ? score : null;
        },2);
    }

    // Both paths can play in the same week. The runner's single `next` stops at
    // the first missing score, so also expose already-known redemption fixtures.
    // No future winner or future football score is used to construct these pairs.
    function knownHeptadFixtures(campaign, heptad, week) {
        if (heptad?.complete) return [];
        const entries = [...alliancesOf(campaign)].sort((a,b) => a.entry-b.entry),matches = heptad?.matches || [],fixtures = [];
        if (entries.length < 2) return fixtures;
        const drops = [];let top = entries[0].id,bottom = null,topComplete = true,bottomComplete = true;
        for (let r=1;r<entries.length;r++) {
            const m = matches.find(m => m.bracket === 'top' && m.round === r);
            if (m) {top=m.winnerId;drops.push(m.loserId);}
            else {if (1+r>week) fixtures.push({bracket:'top',round:r,week:1+r,homeId:top,awayId:entries[r].id});topComplete=false;break;}
        }
        for (let r=1;r<=entries.length-2;r++) {
            const m=matches.find(m => m.bracket==='bottom' && m.round===r);
            if (m) bottom=m.winnerId;
            else {const home=r===1?drops[0]:bottom,away=drops[r];if(home&&away&&3+r>week)fixtures.push({bracket:'bottom',round:r,week:3+r,homeId:home,awayId:away});bottomComplete=false;break;}
        }
        if(entries.length===2)bottom=drops[0];
        if(topComplete&&bottomComplete&&bottom) {
            const final=matches.find(m=>m.bracket==='championship');
            if(!final&&2+entries.length>week)fixtures.push({bracket:'championship',week:2+entries.length,homeId:top,awayId:bottom});
            else if(final&&final.winnerId!==top&&!matches.some(m=>m.bracket==='rematch')&&3+entries.length>week)fixtures.push({bracket:'rematch',week:3+entries.length,homeId:top,awayId:bottom});
        }
        return fixtures.sort((a,b)=>a.week-b.week);
    }

    function nextHeptad(campaign, alliance, heptad, progress, week) {
        if (['champion','eliminated'].includes(progress.status)) return null;
        const fixture=knownHeptadFixtures(campaign,heptad,week).find(m=>[m.homeId,m.awayId].includes(alliance.id));
        if(fixture){const opponentId=fixture.homeId===alliance.id?fixture.awayId:fixture.homeId;return {...copy(fixture),opponentId,opponentName:allianceName(campaign,opponentId),label:'Week '+fixture.week+' · '+roundName(fixture.bracket)+' vs '+allianceName(campaign,opponentId)};}
        if(progress.status==='waiting') {const entranceWeek=2+Math.max(0,alliance.entry-2);return {week:entranceWeek,opponentId:null,label:'Enter the Heptad in Week '+entranceWeek+'; the surviving opponent is still to be decided.'};}
        return null;
    }

    function heptadOutcome(campaign,factionId,week) {
        const intro=allianceIntro(campaign,factionId);if(!intro)return {status:'not-entered',label:'Your faction is not entered in the Heptad Games.'};
        const snapshot=completed(campaign,week);if(!snapshot)return null;
        const heptad=heptadAt(campaign,week),alliance=intro.alliance;
        const progress=Heptad.progress(alliancesOf(campaign),heptad,2).find(a=>a.id===alliance.id);
        const match=matchFor(heptad.matches || [],alliance.id,week);
        let score=snapshot.allianceScores?.find(s=>s.allianceId===alliance.id) || null;
        if(score&&!score.contributors){try {const receipt=Heptad.scoreAlliance(alliance,snapshot.factions,Engine.slotsOf(factionOf(campaign,factionId)),intro.options);if(receipt.total===score.total)score=receipt;}catch(_){/* Preserve legacy totals without inventing a receipt. */}}
        const status=match?(match.winnerId===alliance.id?'won':'lost'):'idle';
        const opponentId=match?(match.homeId===alliance.id?match.awayId:match.homeId):null;
        const tied=Boolean(match&&match.homeScore===match.awayScore);
        const label=match?(tied?'Heptad scores tied · '+(status==='won'?'your alliance holds the arena':'the reigning alliance holds the arena'):'Heptad '+(status==='won'?'win':'loss')+' vs '+allianceName(campaign,opponentId))
            :progress.status==='waiting'?'No Heptad match this week · waiting to enter':progress.status==='eliminated'?'No Heptad match · your alliance’s run is complete':progress.status==='champion'?'No Heptad match · your alliance holds the crown':'No Heptad match this week · your alliance rests';
        return {...intro,status,entryStatus:progress.status,lives:progress.lives,wins:progress.wins,losses:progress.losses,match:copy(match),tied,opponentId,opponentName:opponentId?allianceName(campaign,opponentId):null,
            points:match?(match.homeId===alliance.id?match.homeScore:match.awayScore):null,opponentPoints:match?(match.homeId===alliance.id?match.awayScore:match.homeScore):null,
            score:score?copy(score):null,contributors:copy(score?.contributors || []),mvp:copy(score?.mvp),matchMvp:match?copy(match.mvp || Heptad.matchMVP(match,through(campaign,week))):null,
            next:nextHeptad(campaign,alliance,heptad,progress,week),label};
    }

    function playoffOutcome(campaign,factionId,week) {
        const snapshot=completed(campaign,week);let battle=snapshot?.heavenly || null;
        if(!battle&&week>=Engine.regularSeasonWeeks(campaign)){
            const field=campaign.heavenly?.field?.map(f=>f.teamId) || campaign.playoffField || [];
            if(field.length>=2)battle=Rules.runHeavenlyBattle(field,(id,w)=>w<=week?through(campaign,week).find(row=>row.week===w)?.factions.find(f=>f.factionId===id)?.total:null,18-Math.ceil(Math.log2(field.length)));
        }
        const matches=(battle?.matches || []).filter(m=>m.week<=week),match=matchFor(matches,factionId,week),entered=Boolean(battle?.field?.some(f=>f.teamId===factionId));
        if(!match){const eliminated=matches.some(m=>m.loserId===factionId&&m.round!=='third-place');return {status:!battle?'not-started':!entered?'not-qualified':eliminated?'eliminated':'idle',match:null,advanced:false,eliminated,champion:false,tied:false,
            label:!battle?'The Heavenly Battle has not begun.':!entered?'Outside the Heavenly Battle field.':eliminated?'No playoff game this week · eliminated from the championship.':'No playoff game this week.'};}
        const won=match.winnerId===factionId,tied=match.homeScore===match.awayScore,opponentId=match.homeId===factionId?match.awayId:match.homeId;
        const champion=won&&match.round==='championship',advanced=won&&['quarterfinal','semifinal'].includes(match.round),eliminated=!won&&match.round!=='third-place';
        const label=roundName(match.round)+(tied?' tied · '+(won?'your better seed wins the tie':'the better seed wins the tie'):won?' win':' loss')+(champion?' · Lord of the Duat':advanced?' · you advance':eliminated?' · championship run ends':'');
        return {status:won?'won':'lost',match:copy(match),opponentId,opponentName:nameOf(campaign,opponentId),points:match.homeId===factionId?match.homeScore:match.awayScore,opponentPoints:match.homeId===factionId?match.awayScore:match.homeScore,tied,advanced,eliminated,champion,label};
    }

    function outcome(campaign,factionId,resultWeek) {
        const snapshot=completed(campaign,resultWeek),own=snapshot?.factions?.find(f=>f.factionId===factionId);
        if(!own||!finite(own.total))return null;
        const rivals=snapshot.factions.filter(f=>f.factionId!==factionId&&finite(f.total));
        const wins=rivals.filter(f=>f.total<own.total).length,losses=rivals.filter(f=>f.total>own.total).length,ties=rivals.length-wins-losses;
        const record=wins+'–'+losses+(ties?'–'+ties:''),performance=wins>losses?'winning':wins<losses?'losing':'level';
        const label=(performance==='winning'?'Winning week':performance==='losing'?'Losing week':'Level week')+' · '+wins+'–'+losses+' against the field'+(ties?' · '+ties+' '+(ties===1?'tied rival':'tied rivals'):'');
        const players=own.players || [],playerDelta=round(players.filter(p=>p.starter&&finite(p.effectivePoints)&&finite(p.basePoints)).reduce((n,p)=>n+p.effectivePoints-p.basePoints,0));
        const baseTotal=finite(own.baseTotal)?own.baseTotal:players.filter(p=>p.starter&&finite(p.basePoints)).reduce((n,p)=>n+p.basePoints,0);
        const events=own.favors || (own.favor?[own.favor]:[]),teamAdjustment=finite(own.teamAdjustment)?own.teamAdjustment:round(own.total-baseTotal-playerDelta);
        const pinnacle=campaign.pinnacle?.result?.week===resultWeek?copy(campaign.pinnacle.result):null;
        return {week:resultWeek,allPlay:{wins,losses,ties,place:losses+1,fieldSize:rivals.length+1,tiedForPlace:ties>0,record,points:own.total,performance,label,headline:label},
            playoff:playoffOutcome(campaign,factionId,resultWeek),favors:{events:copy(events),playerDelta,teamAdjustment,totalDelta:round(own.total-baseTotal),spent:finite(own.favorCost)?own.favorCost:round(events.reduce((n,e)=>n+(e.cost || 0),0))},
            heptad:heptadOutcome(campaign,factionId,resultWeek),pinnacle:pinnacle&&allianceOf(campaign,factionId)&&[pinnacle.homeId,pinnacle.awayId].includes(allianceOf(campaign,factionId).id)?pinnacle:null};
    }

    function preparation(campaign,factionId,preparationWeek,options={}) {
        const faction=factionOf(campaign,factionId),settings=settingsOf(campaign),army=active(faction),r=faction?.rituals || {};
        const current=Number.isInteger(preparationWeek)&&preparationWeek===campaign.week,season=current&&campaign.phase==='season';
        const preseason=season&&preparationWeek===1&&!campaign.completedWeeks?.length,sacred=season&&Favors.SACRED_WEEKS.includes(preparationWeek);
        const pendingMahdi=Boolean(r.pendingMahdi),declarations=faction?.declaredFavors || (faction?.declaredFavor?[faction.declaredFavor]:[]);
        const reservedFavor=faction?Rituals.reservedBalance(faction):0,availableFavor=round((faction?.favorBalance || 0)-reservedFavor);
        const eligibleFavorIds=[],eligibleRitualIds=[],eligibleTargets={},notes=[],claims={pending:0,actionable:false,territoryIds:[],attackIds:[]};
        const history=through(campaign,preparationWeek-1).map(w=>({week:w.week,players:w.factions.find(f=>f.factionId===factionId)?.players || []}));
        const planning=(army?.players || []).map(p=>({...p,starter:faction.lineup.includes(p.id)}));
        if(settings.favors&&sacred&&!pendingMahdi&&army)for(const favor of campaign.expansionVersion===1?Favors.EXPANDED_FAVORS:Favors.FAVORS){
            const usable=planning.filter(p=>p.starter).filter(player=>{
                const old=declarations.find(d=>d.playerId===player.id),balance=availableFavor+(old?Favors.getFavor(old.favorId,campaign.expansionVersion)?.cost || 0:0);
                const sourceWeeks=favor.kind==='recall'?(favor.previousWeekOnly?[preparationWeek-1]:history.map(w=>w.week)):[undefined];
                return sourceWeeks.some(sourceWeek=>{try{Favors.validateDeclaration({declaration:{favorId:favor.id,playerId:player.id,sourceWeek},week:preparationWeek,balance,playerResults:planning,history,expansionVersion:campaign.expansionVersion});return true;}catch(_){return false;}});
            });if(usable.length){eligibleFavorIds.push(favor.id);eligibleTargets[favor.id]=usable.map(p=>p.id);}
        }
        if(settings.favors&&campaign.expansionVersion===1&&current&&faction){
            const ordinal=(cycleOf(campaign)-1)*17+Math.min(17,preparationWeek),cooldown=(r.cooldowns?.mahdi || 0)>ordinal;
            const pool=options.ritualCandidates || campaign.ritualCandidates || [],buried=(faction.armies || []).filter(a=>a.id!==army?.id&&!a.destroyed);
            const legalPlayers=players=>{try{return Rituals.canField(faction,players);}catch(_){return false;}};
            if(pendingMahdi){eligibleRitualIds.push('mahdi-accept','mahdi-decline');if(r.pendingMahdi.rerolls<1&&availableFavor>=20)eligibleRitualIds.push('mahdi-reroll');}
            else if(army){
                const ownPool=pool.some(p=>p.season===army.season),newestPool=pool.some(p=>p.season===Math.max(...campaign.seasons));
                if(preseason&&!cooldown&&ownPool)eligibleRitualIds.push('summon-mahdi');
                if(preseason&&!declarations.length){
                    if(r.cooldowns?.anubis!==cycleOf(campaign)&&buried.some(b=>b.players.some(p=>!(r.banishedPlayerIds || []).includes(p.id)&&!(r.banishedPlayerIdentities || []).includes(p.identity)&&army.players.some(old=>legalPlayers(army.players.filter(x=>x.id!==old.id).concat(p))))))eligibleRitualIds.push('anubis');
                    if(buried.some(b=>legalPlayers(b.players)))eligibleRitualIds.push('shiva');
                }
                if(sacred){
                    if(!declarations.length&&army.players.some(p=>legalPlayers(army.players.filter(x=>x.id!==p.id))))eligibleRitualIds.push('midas');
                    if(!cooldown&&ownPool)eligibleRitualIds.push('mahdi');
                    if(!cooldown&&newestPool&&buried.some(b=>b.players.length))eligibleRitualIds.push('super-mahdi');
                    if(!(r.ledger || []).some(e=>e.ritualId==='ebisu-result'&&e.cycle===cycleOf(campaign)&&e.week===preparationWeek)&&availableFavor+(r.ebisu?.wager || 0)>=10)eligibleRitualIds.push('ebisu');
                }
            }
            if(!pendingMahdi&&campaign.phase==='complete'&&campaign.championId===factionId){
                if(!(r.ledger || []).some(e=>e.ritualId==='plutus'&&e.cycle===cycleOf(campaign)))eligibleRitualIds.push('plutus');
                const attempts=(r.ledger || []).filter(e=>e.ritualId==='amun'&&e.cycle===cycleOf(campaign)).length;
                if(!r.amunClaim&&pool.length&&availableFavor>=(attempts?11:1))eligibleRitualIds.push('amun');
            }
        }
        if(settings.conquest&&current&&campaign.conquest&&faction){
            claims.pending=campaign.conquest.pendingClaims?.[factionId] || 0;
            if(claims.pending>0){claims.territoryIds=Conquest.eligibleTerritories(campaign.conquest,factionId);if(campaign.expansionSettings?.conquestMode==='original')claims.attackIds=Conquest.attackableTerritories(campaign.conquest,factionId).filter(territoryId=>Conquest.previewAttack(campaign.conquest,{factionId,territoryId}).canAttack);claims.actionable=Boolean(claims.territoryIds.length||claims.attackIds.length);}
        }
        if(!settings.favors)notes.push('Favors are off for this campaign.');
        else if(pendingMahdi)notes.push('Accept or decline the waiting Mahdi recruit before playing the week.');
        else if(preseason)notes.push('Preseason rituals close when Week 1 is played. Every offering is optional.');
        else if(sacred)notes.push('This is a sacred week. Offerings are optional and reserve favor before scoring.');
        else if(season){const next=Favors.SACRED_WEEKS.find(w=>w>preparationWeek);notes.push(next?'The next sacred week is Week '+next+'.':'No sacred week remains this season.');}
        if(claims.actionable)notes.push('Choose your earned territory before playing the next week.');
        if(!settings.conquest)notes.push('Conquest is off for this campaign.');
        let lineupValid=false;try{lineupValid=Boolean(faction&&Engine.legalLineup(faction,faction.lineup));}catch(_){/* Sealed or incomplete armies cannot be submitted. */}
        const recentWeek=through(campaign,preparationWeek-1).at(-1)?.week;
        const heptad=recentWeek?heptadOutcome(campaign,factionId,recentWeek):null;
        const pinnacle=campaign.pinnacle&&current&&campaign.pinnacle.participantFactionIds?.includes(factionId)?copy(campaign.pinnacle):null;
        return {week:preparationWeek,current,preseason,sacred,favorsEnabled:settings.favors,conquestEnabled:settings.conquest,pendingMahdi,claims,eligibleFavorIds,eligibleRitualIds,eligibleTargets,eligibleIds:[...eligibleFavorIds,...eligibleRitualIds],
            hasUsableOptions:Boolean(settings.favors&&current&&(eligibleFavorIds.length||eligibleRitualIds.length||declarations.length||r.ebisu)),reservedFavor,availableFavor,lineupValid,notes,heptad,pinnacle};
    }
    function describe({campaign,factionId,preparationWeek,resultWeek,ritualCandidates}={}) {
        return {preparationWeek,resultWeek,result:outcome(campaign,factionId,resultWeek),preparation:preparation(campaign,factionId,preparationWeek,{ritualCandidates}),allianceIntro:allianceIntro(campaign,factionId)};
    }
    return Object.freeze({describe,outcome,preparation,allianceIntro,heptadOutcome});
});
