/* global module, require */
// Version four adds a continuing dynasty. Older saves keep their original reducer.
(function(root, factory) {
    const common = typeof module !== 'undefined' && module.exports;
    const get = (path, name) => common ? require(path) : root.App[name];
    const api = factory(get('./campaign.js', 'DuatCampaign'), get('./rules.js', 'DuatRules'),
        get('./army-generation.js', 'DuatArmies'), get('./conquest.js', 'DuatConquest'),
        get('./world.js', 'DuatWorld'), get('./lore.js', 'DuatLore'), get('./favors.js', 'DuatFavors'),
        get('./rituals.js', 'DuatRituals'), get('./heptad.js', 'DuatHeptad'), root.App.TimeLeagueSeason);
    root.App.DuatCampaign = api;
    if (common) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function(Legacy, Rules, Armies, Conquest, World, Lore, Favors, Rituals, Heptad, Season) {
    'use strict';
    const copy = value => JSON.parse(JSON.stringify(value));
    const round = value => Math.round(value * 100) / 100;
    const modern = state => state?.version === 4;
    function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
    function factionOf(state, id) {
        const faction = state.factions.find(f => f.id === id);
        if (!faction) fail('UNKNOWN_FACTION', 'Choose a faction in this dynasty.');
        return faction;
    }
    const activeArmy = Legacy.activeArmy;
    const settingsOf = Legacy.settingsOf;
    const livingArmies = faction => faction.armies.filter(army => !army.destroyed);
    function expansionOptions(input = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !['heptad', 'conquestMode', 'worldScale'].includes(key))) fail('INVALID_SETTINGS', 'Choose valid dynasty rules.');
        const value = { conquestMode:'combat', worldScale:'countries', ...input, heptad:Heptad.normalizeOptions(input.heptad || {}) };
        if (!['combat','original'].includes(value.conquestMode) || !['countries','provinces'].includes(value.worldScale)) fail('INVALID_SETTINGS', 'Choose a supported world and conquest format.');
        return value;
    }
    function availableYears(data) { return data?.availableSeasons || Legacy.availableSeasons(data); }
    function requiredYears(state) {
        return [...new Set(state.factions.flatMap(f => livingArmies(f).flatMap(a => [a.season, ...a.players.map(p => p.season || a.season)])))].sort((a,b)=>b-a);
    }
    function nextSeasonYears(state, data) {
        const all = availableYears(data), present = new Set(requiredYears(state));
        const promised = state.factions.find(f=>f.rituals?.amunClaim)?.rituals.amunClaim.season;
        if(promised && all.includes(promised) && !present.has(promised)) return [promised];
        const used = new Set(state.dynasty?.usedYears || state.seasons);
        return [...all.filter(year=>!present.has(year)&&!used.has(year)), ...all.filter(year=>!present.has(year)&&used.has(year))];
    }
    function bandArmies(faction) {
        const alive = livingArmies(faction);
        alive.forEach((army,i) => {
            const min = Math.floor(i*20/alive.length)+1, max = Math.floor((i+1)*20/alive.length);
            army.rulerNumber = i+1; army.rollBand = {min,max,label:min+'–'+max};
        });
    }
    function buildQueue(plans, order, size) {
        const queue = [];
        const armies = order.map(id=>plans.filter(p=>p.factionId===id));
        for (let layer=0;layer<Math.max(...armies.map(a=>a.length));layer++) {
            for (let roundIndex=0;roundIndex<size;roundIndex++) {
                const ids = roundIndex%2 ? [...order].reverse() : order;
                for (let position=0;position<ids.length;position++) {
                    const army = plans.filter(p=>p.factionId===ids[position])[layer];
                    if (!army || roundIndex < army.startingPlayerIds.length) continue;
                    queue.push({number:queue.length+1,factionId:army.factionId,armyId:army.armyId,armyNumber:army.armyNumber,
                        round:roundIndex+1,pickInRound:position+1,season:army.season});
                }
            }
        }
        return queue;
    }
    function createQueue(state) {
        const plans=state.factions.flatMap(f=>livingArmies(f).map(a=>({factionId:f.id,armyId:a.id,armyNumber:a.rulerNumber,season:a.season,startingPlayerIds:a.players.map(p=>p.id)})));
        state.draft.plans=plans;state.draft.queue=buildQueue(plans,state.draft.order,Legacy.rosterSize(state));
        state.draft.totalPicks=state.draft.queue.length;
        return state.draft.queue;
    }
    function namedArmies(state) {
        for (const faction of state.factions) {
            const retiredNames = state.dynasty.retiredRulers.filter(r=>r.factionId===faction.id).map(r=>r.rulerName);
            faction.armies = Lore.nameArmies(faction,{retiredNames});
        }
    }
    function createCampaign(input, data) {
        if (input.version !== 4) return Legacy.createCampaign(input,data);
        const state = Legacy.createCampaign({...input,version:3},data);
        state.version = 4; state.expansionVersion = 1; state.expansionSettings = expansionOptions(input.expansionSettings);
        state.dynastySeason = 1; state.dynasty = {cycle:1,seasons:[],retiredRulers:[],journal:[],honors:{},usedYears:[...state.seasons]};
        state.treasuryLedger = []; state.pinnacle = null;
        for (const faction of state.factions) {
            faction.declaredFavors = []; faction.treasuryOpening = faction.favorBalance;
            Object.assign(faction,Rituals.initializeFaction(faction));
        }
        namedArmies(state); createQueue(state);
        // The world extension supplies province data; country saves retain their map.
        if (Conquest.createDynastyConquest) state.conquest = Conquest.createDynastyConquest({season:1,
            factionIds:state.factions.map(f=>f.id),seed:state.seed+':world',...state.expansionSettings});
        validateCampaign(state);
        return state;
    }
    function draftTurn(state) {
        if (!modern(state)) return Legacy.draftTurn(state);
        return state.phase === 'draft' && state.draft.status === 'active' ? state.draft.queue[state.draft.cursor] || null : null;
    }
    function unusedPool(state, data, season) {
        const used = new Set(state.factions.flatMap(f=>livingArmies(f).flatMap(a=>a.players.map(p=>p.id))));
        return Legacy.draftPool(data,season,state.scoring).filter(player=>!used.has(player.id));
    }
    function draftCandidates(state, data, options = {}) {
        if (!modern(state)) return Legacy.draftCandidates(state,data,options);
        const turn = draftTurn(state);
        if (!turn) return [];
        const faction = factionOf(state,turn.factionId), army = faction.armies.find(a=>a.id===turn.armyId);
        const pool = unusedPool(state,data,turn.season).filter(p=>!faction.rituals?.banishedPlayerIds?.includes(p.id)&&!faction.rituals?.banishedPlayerIdentities?.includes(p.identity)), slots = Legacy.slotsOf(faction), size = Legacy.rosterSize(state);
        const peers = state.factions.flatMap(f=>livingArmies(f).filter(a=>a.season===turn.season && a.id!==army.id).map(a=>({army:a,faction:f})));
        const query = String(options.query||'').trim().toLowerCase();
        const counts = Object.fromEntries(['QB','RB','WR','TE'].map(p=>[p,pool.filter(card=>card.position===p).length]));
        return pool.filter(player=> {
            if (options.position && player.position!==options.position || query && !player.name.toLowerCase().includes(query)) return false;
            if (settingsOf(state).roster==='duat' && player.position==='QB' && army.players.filter(p=>p.position==='QB').length>=2) return false;
            const needs = Legacy.shortages([...army.players,player],slots);
            if (Object.values(needs).reduce((a,b)=>a+b,0)>size-army.players.length-1) return false;
            for (const peer of peers) {
                const other = Legacy.shortages(peer.army.players,Legacy.slotsOf(peer.faction));
                for (const key of Object.keys(needs)) needs[key]+=other[key];
            }
            const left = {...counts}; left[player.position]--;
            for (const position of ['QB','RB','WR','TE']) { left[position]-=needs[position]; if(left[position]<0)return false; }
            return left.RB+left.WR+left.TE>=needs.FLEX && Object.values(left).reduce((a,b)=>a+b,0)>=needs.FLEX+needs.SUPER_FLEX;
        }).map(player=>({...player}));
    }
    function savePick(state, player, createdAt) {
        const turn = draftTurn(state), faction = factionOf(state,turn.factionId), army = faction.armies.find(a=>a.id===turn.armyId);
        army.players.push(copy(player));
        state.draft.picks.push({...turn,playerId:player.id,playerName:player.name,position:player.position});
        state.draft.cursor++;
        if (state.draft.cursor===state.draft.totalPicks) {
            state.draft.status='complete'; state.phase='reveal';
            state.activity.push({week:0,cycle:state.dynastySeason,type:'draft-complete',message:'The tombs are sealed. The Archaeologist begins the next expedition.',createdAt});
        }
    }
    function draftAI(state,data,createdAt) {
        while (state.phase==='draft') {
            const turn=draftTurn(state); if(!turn || state.humanFactionIds.includes(turn.factionId)) break;
            const faction=factionOf(state,turn.factionId), army=faction.armies.find(a=>a.id===turn.armyId);
            const candidates=draftCandidates(state,data), needs=Legacy.shortages(army.players,Legacy.slotsOf(faction));
            if(!candidates.length) fail('INSUFFICIENT_PLAYERS','This year cannot fill the remaining armies.');
            const random=Rules.createSeededRandom(state.seed+':'+state.dynastySeason+':draft:'+state.draft.cursor);
            const ranked=candidates.map(player=>({player,value:player.referencePoints*(needs[player.position]>0?1.2:.55)+random()*.2})).sort((a,b)=>b.value-a.value||a.player.id.localeCompare(b.player.id));
            savePick(state,ranked[0].player,createdAt);
        }
    }
    function updateLatest(state, faction, createdAt, addJournal=true) {
        const army=activeArmy(faction);
        if(!army)return;
        const stages=['discovery','ruler','roster','record'].map(stage=>Lore.expedition({factionId:faction.id,stage,rulerName:army.rulerName,playerCount:army.players.length,season:army.season}));
        const lines=stages.flatMap(stage=>stage.lines || (stage.text?[stage.text]:[]));
        const latest={factionId:faction.id,factionName:faction.name,armyId:army.id,rulerName:army.rulerName,
            rulerRoll:faction.rulerRoll,season:army.season,players:copy(army.players),stages,
            narration:{title:'The return of '+army.rulerName,lines:lines.length?lines:[army.rulerName+' has returned to '+faction.name+'.']}};
        if(state.archaeology.revealedFactionIds.at(-1)===faction.id)state.archaeology.latest=latest;
        if(addJournal)state.dynasty.journal.push(Lore.journalEntry({factionId:faction.id,rulerName:army.rulerName,playerCount:army.players.length,season:army.season,cycle:state.dynastySeason,createdAt}));
    }
    function reveal(state,id,createdAt) {
        const faction=factionOf(state,id); bandArmies(faction);
        const random=Rules.createSeededRandom(state.seed+':cycle:'+state.dynastySeason+':ruler:'+id);
        faction.rulerRoll=1+Math.floor(random()*20);
        const army=livingArmies(faction).find(a=>faction.rulerRoll>=a.rollBand.min&&faction.rulerRoll<=a.rollBand.max);
        if(!army)fail('NO_RULER','This faction has no ruler to awaken.');
        faction.activeArmyId=army.id; faction.lineup=Legacy.recommendedLineup(state,id);
        state.archaeology.revealedFactionIds.push(id); updateLatest(state,faction,createdAt);
        state.activity.push({week:0,cycle:state.dynastySeason,type:'archaeology',factionId:id,message:army.rulerName+' returns to lead '+faction.name+'.',createdAt});
        if(state.archaeology.revealedFactionIds.length===state.factions.length)state.phase='season';
    }
    function planningPlayers(faction) {
        return activeArmy(faction).players.map(p=>({...p,starter:faction.lineup.includes(p.id)}));
    }
    function adjustTreasury(state,faction,before,kind,createdAt) {
        if(before===faction.favorBalance)return;
        state.treasuryLedger.push({cycle:state.dynastySeason,week:state.week,factionId:faction.id,
            delta:round(faction.favorBalance-before),balance:faction.favorBalance,kind,createdAt});
    }
    function ritualCandidates(state,data,factionId,season) {
        const faction=factionOf(state,factionId), army=activeArmy(faction);
        const targets=season?[season]:state.phase==='complete'?[nextSeasonYears(state,data)[0]]:[army?.season,Math.max(...state.seasons),faction.rituals?.pendingMahdi?.season];
        const banished=new Set(faction.rituals?.banishedPlayerIds||[]),identities=new Set(faction.rituals?.banishedPlayerIdentities||[]);
        const reserved=new Set(state.factions.flatMap(f=>[f.rituals?.pendingMahdi?.player?.id,f.rituals?.amunClaim?.id]).filter(Boolean));
        return [...new Set(targets.filter(Boolean))].flatMap(target=>unusedPool(state,data,target)).filter(p=>!banished.has(p.id)&&!identities.has(p.identity)&&!reserved.has(p.id));
    }
    function unresolvedClaims(state) {
        return settingsOf(state).conquest ? state.humanFactionIds.filter(id=>state.conquest.pendingClaims[id]>0&&(Conquest.eligibleTerritories(state.conquest,id).length
            ||state.expansionSettings?.conquestMode==='original'&&Conquest.attackableTerritories(state.conquest,id).some(territoryId=>Conquest.previewAttack(state.conquest,{factionId:id,territoryId}).canAttack))) : [];
    }
    function settleAIWorld(state,createdAt) {
        if(!settingsOf(state).conquest||unresolvedClaims(state).length)return;
        for(const faction of state.factions.filter(f=>f.controller==='ai')) {
            let guard=0;
            while(state.conquest.pendingClaims[faction.id]>0&&guard++<50) {
                const frontier=Conquest.eligibleTerritories(state.conquest,faction.id);if(!frontier.length)break;
                const random=Rules.createSeededRandom(state.seed+':'+state.dynastySeason+':claim:'+state.week+':'+faction.id+':'+state.conquest.events.length);
                state.conquest=Conquest.claimTerritory(state.conquest,{factionId:faction.id,territoryId:frontier[Math.floor(random()*frontier.length)],createdAt});
            }
            guard=0;
            while((state.phase==='season'||state.phase==='complete'&&state.expansionSettings.conquestMode==='original')&&state.conquest.campaignActions?.[faction.id]>0&&guard++<50) {
                const attacks=Conquest.attackableTerritories(state.conquest,faction.id).map(territoryId=>({territoryId,...Conquest.previewAttack(state.conquest,{factionId:faction.id,territoryId})})).filter(p=>p.canAttack).sort((a,b)=>b.winChance-a.winChance||a.territoryId.localeCompare(b.territoryId));
                if(attacks[0]?.winChance>=.5)state.conquest=Conquest.attackTerritory(state.conquest,{factionId:faction.id,territoryId:attacks[0].territoryId,createdAt});
                else {const fort=Conquest.fortifiableTerritories(state.conquest,faction.id)[0];if(!fort)break;state.conquest=Conquest.fortifyTerritory(state.conquest,{factionId:faction.id,territoryId:fort,createdAt});}
            }
        }
    }
    function aiFavors(state,faction) {
        if(!settingsOf(state).favors||!Rules.SACRED_WEEKS.includes(state.week))return [];
        let remaining=faction.favorBalance;
        const ranked=[...faction.lineup].sort((a,b)=>Legacy.estimatePlayer(state,faction.id,b).points-Legacy.estimatePlayer(state,faction.id,a).points);
        const result=[];
        for(const playerId of ranked.slice(0,state.week>=14?3:1)) {
            const favorId=state.week>=15&&remaining>=60?'kratos-3':state.week>=10&&remaining>=40?'kratos-2':'kratos-1';
            const favor=Favors.FAVORS.find(f=>f.id===favorId);if(!favor||remaining<favor.cost)break;
            result.push({favorId,playerId});remaining-=favor.cost;
        }
        return Favors.validateDeclarations({declarations:result,playerResults:planningPlayers(faction),history:Legacy.historyFor(state,faction.id),week:state.week,balance:faction.favorBalance,expansionVersion:1});
    }
    function recordSeason(state,createdAt) {
        if(state.dynasty.seasons.some(s=>s.cycle===state.dynastySeason))return;
        const season={cycle:state.dynastySeason,championId:state.championId,thirdPlaceId:state.heavenly?.thirdPlaceId||null,
            standings:Legacy.computeStandings(state),heptad:copy(state.heptad),alliances:copy(state.alliances),pinnacle:copy(state.pinnacle),
            landTotals:Object.fromEntries(state.factions.map(f=>[f.id,Object.values(state.conquest.owners).filter(id=>id===f.id).length])),
            rulers:state.factions.map(f=>({factionId:f.id,...copy(activeArmy(f))})),completedAt:createdAt,
            completedWeeks:state.completedWeeks.map(week=>({...copy(week),factions:week.factions.map(f=>({...copy(f),players:f.players.map(p=>{const {stats:_stats,...rest}=p;return rest;})}))}))};
        state.dynasty.seasons.push(season);
        if(Lore.honors)state.dynasty.honors=Lore.honors(state.dynasty.seasons);
    }
    function resolveWeek(state,data,createdAt) {
        const covered=new Set(Legacy.availableSeasons(data));
        if(requiredYears(state).some(year=>!covered.has(year)))fail('INCOMPLETE_DATA','Every living player year needs recorded NFL data through Week 17.');
        if(unresolvedClaims(state).length)fail('CLAIMS_PENDING','Choose your earned territory before advancing.');
        if(state.factions.some(f=>f.rituals?.pendingMahdi))fail('RITUAL_PENDING','Finish each pending recruitment before playing this week.');
        settleAIWorld(state,createdAt);
        for(const faction of state.factions) {
            if(faction.controller==='ai'){faction.lineup=Legacy.recommendedLineup(state,faction.id);faction.declaredFavors=aiFavors(state,faction);}
            if(!Legacy.legalLineup(faction,faction.lineup))fail('INVALID_LINEUP',faction.name+' needs a legal starting lineup.');
        }
        const results=state.factions.map(faction=> {
            const army=activeArmy(faction), before=faction.favorBalance;
            const raw=army.players.map(player=> {
                const log=data.logIndex.get(Season.gameLogKey(player.identity,player.season||army.season,state.week));
                const points=log?Season.scoreStatLine(log.stats,state.scoring,{}):0;
                return {...player,starter:faction.lineup.includes(player.id),basePoints:points,effectivePoints:points,stats:log?copy(log.stats):null,hasRecordedGame:Boolean(log)};
            });
            const applied=Favors.applyFavors({declarations:faction.declaredFavors||[],playerResults:raw,
                history:Legacy.historyFor(state,faction.id),week:state.week,balance:before,seed:state.seed+':'+state.dynastySeason+':'+faction.id,expansionVersion:1});
            faction.favorBalance=round(before-applied.cost);
            adjustTreasury(state,faction,before,'weekly-offerings',createdAt);
            const players=applied.players, baseTotal=round(players.filter(p=>p.starter).reduce((sum,p)=>sum+p.basePoints,0));
            let total=round(players.filter(p=>p.starter).reduce((sum,p)=>sum+p.effectivePoints,0));
            const events=applied.events||[];
            faction.declaredFavors=[];faction.declaredFavor=null;
            const wager=Rituals.resolveEbisu({faction,week:state.week,total,seed:state.seed,cycle:state.dynastySeason,createdAt});
            let teamAdjustment=0;
            if(wager?.event){const balance=faction.favorBalance;total=wager.total;teamAdjustment=round(total-players.filter(p=>p.starter).reduce((sum,p)=>sum+p.effectivePoints,0));Object.assign(faction,wager.faction);adjustTreasury(state,faction,balance,'ebisu-resolution',createdAt);events.push(wager.event);}
            const result={factionId:faction.id,armyId:army.id,rulerName:army.rulerName,season:army.season,baseTotal,total,teamAdjustment,
                players,favor:events[0]||null,favors:events,favorCost:round(before-faction.favorBalance),favorBalance:faction.favorBalance};
            faction.declaredFavors=[];faction.declaredFavor=null;
            return result;
        });
        const allianceScores=Heptad.scoreWeek(state.alliances,results,Legacy.slotsOf(state.factions[0]),state.expansionSettings.heptad);
        const completed={week:state.week,factions:results,allianceScores,standings:[],heptad:null,heavenly:null};
        state.completedWeeks.push(completed);completed.standings=Legacy.computeStandings(state);
        const allianceTotal=(id,week)=>state.completedWeeks.find(w=>w.week===week)?.allianceScores.find(a=>a.allianceId===id)?.total??null;
        state.heptad=Rules.runHeptadGauntlet(state.alliances,allianceTotal,2);
        if(state.week===Legacy.regularSeasonWeeks(state))state.playoffField=completed.standings.slice(0,settingsOf(state).playoffTeams).map(f=>f.factionId);
        const factionTotal=(id,week)=>state.completedWeeks.find(w=>w.week===week)?.factions.find(f=>f.factionId===id)?.total??null;
        state.heavenly=state.playoffField.length?Rules.runHeavenlyBattle(state.playoffField,factionTotal,18-Math.ceil(Math.log2(settingsOf(state).playoffTeams))):null;
        completed.heptad=copy(state.heptad);completed.heavenly=copy(state.heavenly);
        if(!state.pinnacle&&state.heptad?.complete)state.pinnacle=Heptad.createPinnacle({heptad:state.heptad,alliances:state.alliances,startWeek:2,lastWeek:17});
        if(state.pinnacle?.status==='offered' && state.pinnacle.participantFactionIds.every(id=>!state.humanFactionIds.includes(id))) {
            const week=Math.max(state.week+1,state.pinnacle.earliestWeek);
            if(week<=17)state.pinnacle=Heptad.proposePinnacle(state.pinnacle,{week,currentWeek:state.week+1,factionId:state.pinnacle.participantFactionIds[0],autoApproveFactionIds:state.pinnacle.participantFactionIds});
        }
        if(state.pinnacle)state.pinnacle=Heptad.resolvePinnacle(state.pinnacle,completed);
        if(settingsOf(state).conquest) {
            const ranks=[...results].sort((a,b)=>b.total-a.total||a.factionId.localeCompare(b.factionId));
            state.conquest=Conquest.recordWeek(state.conquest,{week:state.week,createdAt,regularSeasonWeeks:Legacy.regularSeasonWeeks(state),
                advancingFactionIds:[...(state.heavenly?.matches||[]).filter(m=>m.week===state.week).map(m=>m.winnerId),
                    ...(settingsOf(state).playoffTeams>4&&state.week===18-Math.ceil(Math.log2(settingsOf(state).playoffTeams))?state.playoffField.slice(0,8-settingsOf(state).playoffTeams):[])],
                results:ranks.map((f,i)=>({factionId:f.factionId,place:i+1,score:f.total}))});
        }
        state.activity.push({week:state.week,cycle:state.dynastySeason,type:'week',message:'Week '+state.week+' joins the annals of dynasty season '+state.dynastySeason+'.',createdAt});
        if(state.week===17){if(!state.heavenly?.complete)fail('INCOMPLETE_CHAMPIONSHIP','The championship must finish.');state.championId=state.heavenly.championId;state.phase='complete';}
        state.week++;settleAIWorld(state,createdAt);
        if(state.phase==='complete')recordSeason(state,createdAt);
    }
    function nextSeason(state,data,action,createdAt) {
        if(state.phase!=='complete')fail('INVALID_PHASE','Finish the current season before beginning the next dynasty.');
        if(unresolvedClaims(state).length)fail('CLAIMS_PENDING','Resolve each faction’s earned final conquest before continuing the dynasty.');
        if(state.factions.some(f=>f.rituals?.pendingMahdi))fail('RITUAL_PENDING','Finish pending rituals before continuing.');
        const year=action.season??nextSeasonYears(state,data)[0];
        if(!Number.isInteger(year)||!nextSeasonYears(state,data).includes(year))fail('INVALID_SEASON','Choose a complete historical year outside the living tombs.');
        const oldCycle=state.dynastySeason, champion=state.championId;
        for(const faction of state.factions) {
            const walking=activeArmy(faction);
            for(const army of faction.armies.filter(a=>a.destroyed||a.id===walking.id)) {
                if(!state.dynasty.retiredRulers.some(r=>r.id===army.id))state.dynasty.retiredRulers.push({...copy(army),factionId:faction.id,retiredCycle:oldCycle,reason:army.destroyed?'Destroyed by Shiva':'Completed reign',champion:faction.id===champion&&!army.destroyed});
            }
            const survivors=livingArmies(faction).filter(a=>a.id!==walking.id);
            // Each annual draft adds one new ruler; Shiva permanently reduces the reserve.
            survivors.push({id:faction.id+':'+year+':'+(oldCycle+1),season:year,rulerNumber:survivors.length+1,players:[]});
            faction.armies=survivors;bandArmies(faction);
            faction.activeArmyId=null;faction.rulerRoll=null;faction.lineup=[];faction.declaredFavors=[];faction.declaredFavor=null;
            const rolled=Rituals.rolloverFaction(faction,{favorBudget:settingsOf(state).favors?settingsOf(state).favorBudget:0,cycle:oldCycle+1});
            if(rolled)Object.assign(faction,rolled);
            faction.treasuryOpening=faction.favorBalance;
        }
        state.previousChampionId=champion;state.dynastySeason++;state.dynasty.cycle=state.dynastySeason;
        state.dynasty.usedYears=[...new Set([...state.dynasty.usedYears,year])];
        state.phase='draft';state.week=1;state.completedWeeks=[];state.playoffField=[];state.heavenly=null;state.heptad=null;state.pinnacle=null;state.championId=null;state.treasuryLedger=[];
        state.draft={status:'waiting',order:Armies.seededShuffle(state.factions.map(f=>f.id),state.seed+':draft:'+state.dynastySeason),cursor:0,picks:[]};
        state.archaeology={order:Armies.seededShuffle(state.factions.map(f=>f.id),state.seed+':archaeology:'+state.dynastySeason),revealedFactionIds:[],latest:null};
        state.alliances=Rules.buildHeptadAlliances(state.factions.map(f=>f.id),{allianceSize:2,scoring:'best-ball',startWeek:2},state.seed+':alliances:'+state.dynastySeason,id=>factionOf(state,id).name);
        namedArmies(state);
        for(const faction of state.factions) {
            const claim=faction.rituals?.amunClaim;
            if(claim) {
                const candidate=unusedPool(state,data,year).find(p=>p.id===claim.id);
                if(!candidate)fail('AMUN_CLAIM_UNAVAILABLE','The reserved champion recruit must be available in the next draft.');
                faction.armies.at(-1).players.push(copy(candidate));
                faction.rituals.amunClaim=null;
            }
        }
        state.seasons=requiredYears(state);createQueue(state);
        if(Conquest.continueSeason)state.conquest=Conquest.continueSeason(state.conquest,{season:state.dynastySeason,createdAt});
        else state.conquest={...state.conquest,season:state.dynastySeason,events:[],pendingClaims:Object.fromEntries(state.factions.map(f=>[f.id,0])),campaignActions:Object.fromEntries(state.factions.map(f=>[f.id,0]))};
        state.activity.push({week:0,cycle:state.dynastySeason,type:'succession',message:'The old rulers retire. One new tomb joins each surviving dynasty; the realm and its history endure.',createdAt});
    }
    function applyAction(state,action,data) {
        if(!modern(state))return Legacy.applyAction(state,action,data);
        validateCampaign(state);
        if(!action||typeof action.type!=='string')fail('INVALID_ACTION','Choose a dynasty action.');
        let next=copy(state);const createdAt=action.createdAt||state.updatedAt;
        if(typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))fail('INVALID_TIME','Use a valid action time.');
        const actor=action.factionId||state.hostFactionId;
        if(!state.humanFactionIds.includes(actor))fail('NOT_YOUR_FACTION','Only a human manager can submit this action.');
        const hostActions=['start-draft','reveal-next','advance-week','next-season'];
        if(hostActions.includes(action.type)&&actor!==state.hostFactionId)fail('HOST_REQUIRED','Only the host can advance the dynasty.');
        const faction=factionOf(next,actor);
        if(action.type==='next-season')nextSeason(next,data,action,createdAt);
        else if(action.type==='name-ruler') {
            if(!['draft','reveal'].includes(state.phase)&&!(state.phase==='season'&&state.week===1))fail('NAME_LOCKED','Rulers can be named before Week 1 is played.');
            const army=faction.armies.find(a=>a.id===action.armyId&&!a.destroyed);
            if(!army)fail('UNKNOWN_RULER','Choose one of your living rulers.');
            const named=Lore.chooseRuler({factionId:actor,customName:action.name,usedNames:faction.armies.filter(a=>a.id!==army.id).map(a=>a.rulerName),retiredNames:state.dynasty.retiredRulers.filter(r=>r.factionId===actor).map(r=>r.rulerName)});
            army.rulerName=named.name;army.rulerId=named.id;army.rulerOrigin=named.origin;army.rulerRealm=named.realm;army.rulerSource=named.source;
            if(faction.activeArmyId)updateLatest(next,faction,createdAt,false);
        } else if(action.type==='name-alliance') {
            if(state.completedWeeks.length)fail('NAME_LOCKED','Alliance names are sealed when the first week is played.');
            const alliance=next.alliances.find(a=>a.teamIds.includes(actor));
            next.alliances=Heptad.renameAlliance(next.alliances,alliance.id,action.name);
        } else if(['propose-pinnacle','approve-pinnacle','decline-pinnacle'].includes(action.type)) {
            if(state.phase!=='season'||!next.pinnacle)fail('INVALID_PHASE','The Pinnacle challenge is not open.');
            if(action.type==='propose-pinnacle')next.pinnacle=Heptad.proposePinnacle(next.pinnacle,{week:action.week,currentWeek:state.week,factionId:actor,autoApproveFactionIds:next.factions.filter(f=>f.controller==='ai'&&next.pinnacle.participantFactionIds.includes(f.id)).map(f=>f.id)});
            else if(action.type==='approve-pinnacle')next.pinnacle=Heptad.approvePinnacle(next.pinnacle,{factionId:actor,currentWeek:state.week});
            else next.pinnacle=Heptad.declinePinnacle(next.pinnacle,{factionId:actor});
        } else if(action.type==='ritual') {
            if(!settingsOf(state).favors)fail('FAVORS_DISABLED','Favors are turned off in this dynasty.');
            const before=faction.favorBalance;
            next=Rituals.applyAction(next,{...action,factionId:actor},{pool:ritualCandidates(next,data,actor),maxRosterSize:Legacy.rosterSize(next),createdAt});
            const changed=factionOf(next,actor);adjustTreasury(next,changed,before,action.ritualId,createdAt);
            next.seasons=requiredYears(next);
            if(changed.activeArmyId)updateLatest(next,changed,createdAt,action.ritualId==='shiva');
        } else if(action.type==='start-draft') {
            if(next.phase!=='draft'||next.draft.status!=='waiting')fail('INVALID_PHASE','The draft has already started.');
            next.draft.status='active';draftAI(next,data,createdAt);
        } else if(action.type==='draft-pick') {
            const turn=draftTurn(next);if(!turn||turn.factionId!==actor)fail('DRAFT_TURN','Wait for your faction to draft.');
            const candidate=draftCandidates(next,data).find(p=>p.id===action.playerId);if(!candidate)fail('INVALID_PICK','Choose an available player who leaves a legal roster.');
            savePick(next,candidate,createdAt);draftAI(next,data,createdAt);
        } else if(action.type==='reveal-next') {
            if(next.phase!=='reveal')fail('INVALID_PHASE','Complete the draft before opening the tombs.');
            reveal(next,next.archaeology.order[next.archaeology.revealedFactionIds.length],createdAt);
        } else {
            if(next.phase!=='season'&&!(next.phase==='complete'&&['claim','attack'].includes(action.type)))fail('INVALID_PHASE','This action requires an active season.');
            if(action.type==='advance-week')resolveWeek(next,data,createdAt);
            else if(action.type==='set-lineup') {
                if(!Legacy.legalLineup(faction,action.playerIds))fail('INVALID_LINEUP','Choose a legal starting lineup.');
                if(faction.declaredFavors.some(f=>!action.playerIds.includes(f.playerId)))fail('FAVOR_TARGET_BENCHED','Remove the offering before benching its target.');
                faction.lineup=[...action.playerIds];
            } else if(['declare-favor','clear-favor'].includes(action.type)) {
                if(!settingsOf(state).favors)fail('FAVORS_DISABLED','Favors are turned off in this dynasty.');
                if(action.type==='clear-favor')faction.declaredFavors=action.playerId?faction.declaredFavors.filter(f=>f.playerId!==action.playerId):[];
                else faction.declaredFavors=Favors.validateDeclarations({declarations:[...faction.declaredFavors.filter(f=>f.playerId!==action.playerId),{favorId:action.favorId,playerId:action.playerId,...(action.sourceWeek===undefined?{}:{sourceWeek:action.sourceWeek})}],
                    playerResults:planningPlayers(faction),history:Legacy.historyFor(next,actor),week:next.week,balance:faction.favorBalance-(faction.rituals?.ebisu?.wager||0),expansionVersion:1});
            } else if(['claim','attack','fortify'].includes(action.type)) {
                if(!settingsOf(state).conquest)fail('CONQUEST_DISABLED','Conquest is turned off in this dynasty.');
                const method={claim:'claimTerritory',attack:'attackTerritory',fortify:'fortifyTerritory'}[action.type];
                next.conquest=Conquest[method](next.conquest,{factionId:actor,territoryId:action.territoryId,createdAt});settleAIWorld(next,createdAt);
                if(next.phase==='complete') {
                    const archived=next.dynasty.seasons.find(s=>s.cycle===next.dynastySeason);
                    archived.landTotals=Object.fromEntries(next.factions.map(f=>[f.id,Object.values(next.conquest.owners).filter(id=>id===f.id).length]));
                }
            } else fail('INVALID_ACTION','Choose a supported dynasty action.');
        }
        next.updatedAt=createdAt;
        validateCampaign(next);
        return next;
    }
    function projectCampaign(state,viewerFactionId,data) {
        if(!modern(state))return Legacy.projectCampaign(state,viewerFactionId,data);
        factionOf(state,viewerFactionId);const projected=copy(state);delete projected.seed;delete projected.conquest.seed;
        for(const faction of projected.factions) {
            if(faction.id===viewerFactionId)continue;
            faction.lineup=[];faction.declaredFavors=[];faction.declaredFavor=null;
            // Private recruitment draws and buried-player sacrifices stay with their manager.
            faction.rituals=null;
            if(!state.archaeology.revealedFactionIds.includes(faction.id)){faction.armies=[];faction.activeArmyId=null;faction.rulerRoll=null;}
            else faction.armies=faction.armies.map(a=>a.id===faction.activeArmyId?a:{id:a.id,season:a.season,rulerNumber:a.rulerNumber,rollBand:a.rollBand,sealed:true,players:[]});
        }
        projected.draft.picks=state.draft.picks.map(p=>p.factionId===viewerFactionId?copy(p):{number:p.number,factionId:p.factionId,armyNumber:p.armyNumber,round:p.round,season:p.season,sealed:true});
        projected.draft.plans=state.draft.plans.map(p=>p.factionId===viewerFactionId?copy(p):{...p,startingPlayerIds:[]});
        projected.activity=projected.activity.filter(e=>e.type!=='ritual'||e.factionId===viewerFactionId);
        projected.draft.turn=draftTurn(state);
        projected.draft.candidates=projected.draft.turn?.factionId===viewerFactionId&&data?draftCandidates(state,data):[];
        projected.archaeology.progress=Legacy.revealProgress(state);
        if(data&&settingsOf(state).favors&&['season','complete'].includes(state.phase))projected.ritualCandidates=ritualCandidates(state,data,viewerFactionId);
        if(state.phase==='complete'&&data)projected.nextSeasonYears=nextSeasonYears(state,data);
        return projected;
    }
    function validateCampaign(state) {
        if(!modern(state))return Legacy.validateCampaign(state);
        try {
            const invalid=message=>fail('INVALID_CAMPAIGN',message), settings=settingsOf(state), size=Legacy.rosterSize(state);
            const finite=n=>typeof n==='number'&&Number.isFinite(n), ids=state.factions?.map(f=>f.id)||[];
            const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=240;
            const nameKey=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
            const sameFields=(actual,expected)=>actual&&Object.keys(expected).every(key=>actual[key]===expected[key]);
            const sameValue=(a,b)=>a===b||Boolean(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)
                &&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&sameValue(a[key],b[key])));
            const year=value=>Number.isInteger(value)&&value>=1920&&value<=2100;
            const unique=values=>Array.isArray(values)&&new Set(values).size===values.length;
            if(state.expansionVersion!==1||!state.expansionSettings||!sameValue(expansionOptions(state.expansionSettings),state.expansionSettings))invalid('Invalid dynasty rules.');
            if(!state.dynasty||!Number.isInteger(state.dynastySeason)||state.dynastySeason<1||state.dynasty.cycle!==state.dynastySeason
                ||!Array.isArray(state.dynasty.seasons)||!Array.isArray(state.dynasty.retiredRulers)||!Array.isArray(state.dynasty.journal))invalid('Invalid dynasty history.');
            if(!['draft','reveal','season','complete'].includes(state.phase)||!Number.isInteger(state.week)||state.week<1||state.week>18
                ||(['draft','reveal'].includes(state.phase)&&state.week!==1)||(state.phase==='complete'&&state.week!==18)||(state.phase==='season'&&state.week>17))invalid('Invalid dynasty phase.');
            for(const key of ['id','name','seed','createdAt','updatedAt'])if(!text(state[key])||state[key].length>160)invalid('Invalid campaign identity.');
            if(!Number.isFinite(Date.parse(state.createdAt))||!Number.isFinite(Date.parse(state.updatedAt)))invalid('Invalid timestamp.');
            if(!state.settings||!sameFields(state.settings,settings)||!state.scoring||!sameFields(state.scoring,Legacy.normalizeScoring(state.scoring)))invalid('Missing campaign rules.');
            if(state.calendarVersion!==2||ids.length!==settings.leagueSize||new Set(ids).size!==ids.length||ids.some(id=>!World.factionById(id)))invalid('Invalid factions.');
            if(!state.humanFactionIds?.includes(state.hostFactionId)||new Set(state.humanFactionIds).size!==state.humanFactionIds.length||state.humanFactionIds.some(id=>!ids.includes(id)))invalid('Invalid managers.');
            if(!unique(state.seasons)||!state.seasons.length||state.seasons.some(y=>!year(y)))invalid('Invalid historical years.');
            if(!unique(state.dynasty.usedYears)||!state.dynasty.usedYears.length||state.dynasty.usedYears.some(y=>!year(y))||state.seasons.some(y=>!state.dynasty.usedYears.includes(y)))invalid('Invalid dynasty year history.');
            const exact=values=>Array.isArray(values)&&values.length===ids.length&&new Set(values).size===ids.length&&values.every(id=>ids.includes(id));
            const draft=state.draft, archaeology=state.archaeology;
            if(!draft||!exact(draft.order)||!Array.isArray(draft.queue)||draft.queue.length!==draft.totalPicks||!Number.isInteger(draft.cursor)||draft.cursor<0||draft.cursor>draft.totalPicks||!Array.isArray(draft.picks)||draft.picks.length!==draft.cursor)invalid('Invalid dynasty draft.');
            if(state.phase==='draft'?!['active','waiting'].includes(draft.status)||draft.cursor>=draft.totalPicks:draft.status!=='complete'||draft.cursor!==draft.totalPicks)invalid('Draft progress does not match its phase.');
            if(draft.status==='waiting'&&draft.cursor!==0)invalid('A waiting draft cannot contain picks.');
            const plannedArmies=state.factions.flatMap(f=>(f.armies||[]).map(a=>({factionId:f.id,armyId:a.id,armyNumber:a.rulerNumber,season:a.season})));
            if(!Array.isArray(draft.plans)||draft.plans.length!==plannedArmies.length||!unique(draft.plans.map(p=>p.armyId)))invalid('Missing original draft plans.');
            const draftedCards=new Set();
            for(const [index,plan]of draft.plans.entries()) {
                if(!sameFields(plan,plannedArmies[index])||!unique(plan.startingPlayerIds)||plan.startingPlayerIds.length>size||plan.startingPlayerIds.some(id=>!text(id)||draftedCards.has(id)))invalid('Invalid original tomb inventory.');
                plan.startingPlayerIds.forEach(id=>draftedCards.add(id));
            }
            const expectedQueue=buildQueue(draft.plans,draft.order,size);
            if(expectedQueue.length!==draft.queue.length||draft.queue.some((turn,index)=>!sameFields(turn,expectedQueue[index])||Object.keys(turn).length!==Object.keys(expectedQueue[index]).length))invalid('Draft queue does not follow the planned snake order.');
            for(const [index,pick]of draft.picks.entries()) {
                if(!sameFields(pick,expectedQueue[index])||!text(pick.playerId)||!pick.playerId.endsWith(':'+pick.season)||!text(pick.playerName)||!['QB','RB','WR','TE'].includes(pick.position)||draftedCards.has(pick.playerId))invalid('Invalid draft receipt.');
                draftedCards.add(pick.playerId);
            }
            if(!archaeology||!exact(archaeology.order)||!Array.isArray(archaeology.revealedFactionIds)||archaeology.revealedFactionIds.some((id,i)=>id!==archaeology.order[i]))invalid('Invalid archaeology order.');
            const revealed=archaeology.revealedFactionIds.length;
            if(state.phase==='draft'?revealed!==0:state.phase==='reveal'?revealed>=ids.length:revealed!==ids.length)invalid('Invalid reveal progress.');
            const retiredIds=new Set(),retiredNames=new Map(ids.map(id=>[id,new Set()])),allArmyIds=new Set(),used=new Set();
            for(const ruler of state.dynasty.retiredRulers) {
                if(!ids.includes(ruler.factionId)||!text(ruler.id)||retiredIds.has(ruler.id)||!Number.isInteger(ruler.retiredCycle)||ruler.retiredCycle<1||ruler.retiredCycle>=state.dynastySeason||!['Completed reign','Destroyed by Shiva'].includes(ruler.reason)||!year(ruler.season)||!Array.isArray(ruler.players))invalid('Invalid retired ruler record.');
                Lore.validateName(ruler.rulerName);
                const names=retiredNames.get(ruler.factionId),key=nameKey(ruler.rulerName);
                if(names.has(key))invalid('A ruler cannot retire twice.');
                names.add(key);retiredIds.add(ruler.id);
            }
            for(const faction of state.factions) {
                if(faction.roster!==settings.roster||faction.controller!==(state.humanFactionIds.includes(faction.id)?'human':'ai'))invalid('Invalid faction settings.');
                if(!Array.isArray(faction.armies)||!livingArmies(faction).length||livingArmies(faction).length>settings.mummyCount||new Set(faction.armies.map(a=>a.id)).size!==faction.armies.length)invalid('Invalid tomb collection.');
                Rituals.validateFaction(faction,{cycle:state.dynastySeason,week:state.week});
                const currentNames=new Set();
                for(const [index,army]of faction.armies.entries()) {
                    if(!text(army.id)||allArmyIds.has(army.id)||retiredIds.has(army.id)||!year(army.season)||!Array.isArray(army.players)||army.players.length>size+2||army.destroyed!==undefined&&typeof army.destroyed!=='boolean')invalid('Invalid ruler.');
                    Lore.validateName(army.rulerName);
                    const key=nameKey(army.rulerName);
                    if(currentNames.has(key)||retiredNames.get(faction.id).has(key))invalid('A retired or duplicate ruler cannot return.');
                    currentNames.add(key);allArmyIds.add(army.id);
                    // Destroyed tombs keep the original lottery bands until succession.
                    const min=Math.floor(index*20/faction.armies.length)+1,max=Math.floor((index+1)*20/faction.armies.length);
                    if(army.rulerNumber!==index+1||!sameFields(army.rollBand,{min,max}))invalid('Invalid ruler roll band.');
                    if(Boolean(army.destroyed)!==faction.rituals.destroyedArmyIds.includes(army.id))invalid('Destroyed tombs must match their permanent ritual history.');
                    if(army.destroyed)continue;
                    if(!state.seasons.includes(army.season)||!Number.isInteger(army.rollBand?.min)||!Number.isInteger(army.rollBand?.max)||army.rollBand.min<1||army.rollBand.max>20||army.rollBand.max<army.rollBand.min)invalid('Invalid ruler roll band.');
                    for(const p of army.players) {
                        const season=p.season||army.season;
                        if(typeof p.identity!=='string'||!p.identity||p.id!==p.identity+':'+season||typeof p.name!=='string'||!p.name||!['QB','RB','WR','TE'].includes(p.position)||used.has(p.id)||!finite(p.referencePoints)||!state.seasons.includes(season)||p.referenceSeason!==null&&(!Number.isInteger(p.referenceSeason)||p.referenceSeason>=season))invalid('Invalid or duplicated player.');
                        used.add(p.id);
                    }
                    if(army.id===faction.activeArmyId&&Legacy.bestLineup(army.players,Legacy.slotsOf(faction)).length!==Legacy.slotsOf(faction).length)invalid('The walking ruler cannot fill its lineup.');
                    if(state.phase==='draft') {
                        const plan=draft.plans.find(p=>p.armyId===army.id),picks=draft.picks.filter(p=>p.armyId===army.id),expected=[...plan.startingPlayerIds,...picks.map(p=>p.playerId)];
                        if(army.players.length!==expected.length||army.players.some((p,i)=>p.id!==expected[i])||picks.some(p=>!sameFields(army.players.find(card=>card.id===p.playerId),{name:p.playerName,position:p.position})))invalid('Drafted cards do not match the original tomb and pick receipts.');
                    }
                }
                if(!finite(faction.favorBalance)||faction.favorBalance<0||!finite(faction.treasuryOpening)||faction.treasuryOpening<0)invalid('Invalid treasury.');
                if(!Array.isArray(faction.declaredFavors))invalid('Invalid offering list.');
                const sealed=state.phase==='draft'||!archaeology.revealedFactionIds.includes(faction.id);
                if(!Array.isArray(faction.lineup)||(sealed?faction.activeArmyId!==null||faction.rulerRoll!==null||faction.lineup.length:!activeArmy(faction)||activeArmy(faction).destroyed||!Legacy.legalLineup(faction,faction.lineup)))invalid('Invalid walking ruler.');
                if(!sealed) {
                    const active=activeArmy(faction),shiva=faction.rituals.ledger.filter(e=>e.ritualId==='shiva'&&e.cycle===state.dynastySeason).at(-1);
                    if(!Number.isInteger(faction.rulerRoll)||faction.rulerRoll<1||faction.rulerRoll>20)invalid('Invalid ruler die.');
                    if(shiva) {
                        if(shiva.replacementArmyId!==active.id||shiva.roll!==faction.rulerRoll||!faction.armies.some(a=>a.id===shiva.destroyedArmyId&&a.destroyed))invalid('The walking ruler does not match Shiva’s recorded replacement.');
                    } else if(faction.rulerRoll<active.rollBand.min||faction.rulerRoll>active.rollBand.max)invalid('The ruler die does not awaken the recorded ruler.');
                }
                if(faction.declaredFavors.length) {
                    if(!settings.favors||state.phase!=='season')invalid('Offerings are unavailable.');
                    Favors.validateDeclarations({declarations:faction.declaredFavors,playerResults:planningPlayers(faction),history:Legacy.historyFor(state,faction.id),week:state.week,balance:faction.favorBalance-(faction.rituals.ebisu?.wager||0),expansionVersion:1});
                }
            }
            if(requiredYears(state).length!==state.seasons.length||requiredYears(state).some(y=>!state.seasons.includes(y)))invalid('Historical years do not match the living rosters.');
            const reserved=new Set();
            for(const faction of state.factions)for(const player of [faction.rituals.pendingMahdi?.player,faction.rituals.amunClaim].filter(Boolean)) {
                if(used.has(player.id)||reserved.has(player.id))invalid('A reserved recruit cannot also belong to another roster or draw.');
                reserved.add(player.id);
            }
            if(!Array.isArray(state.treasuryLedger))invalid('Missing treasury ledger.');
            for(const entry of state.treasuryLedger)if(!ids.includes(entry.factionId)||!finite(entry.delta)||!finite(entry.balance)||entry.balance<0||entry.cycle!==state.dynastySeason||!Number.isInteger(entry.week)||entry.week<1||entry.week>state.week||!text(entry.kind)||!Number.isFinite(Date.parse(entry.createdAt)))invalid('Invalid treasury entry.');
            for(const faction of state.factions) {
                let balance=faction.treasuryOpening;
                for(const entry of state.treasuryLedger.filter(e=>e.factionId===faction.id)){if(!finite(entry.delta)||entry.cycle!==state.dynastySeason)invalid('Invalid treasury entry.');balance=round(balance+entry.delta);if(balance<0||entry.balance!==balance)invalid('Invalid treasury running balance.');}
                if(balance!==faction.favorBalance)invalid('Treasury does not match its ledger.');
            }
            const validateWeeks=(weeks,alliances,count)=>{
            if(!Array.isArray(weeks)||weeks.length!==count)invalid('Weeks must be consecutive.');
            for(const [index,week]of weeks.entries()) {
                if(week.week!==index+1||!exact(week.factions?.map(f=>f.factionId)))invalid('Invalid weekly results.');
                for(const result of week.factions) {
                    const starters=result.players?.filter(p=>p.starter),slots=Legacy.slotsOf(factionOf(state,result.factionId));
                    if(!Array.isArray(result.players)||new Set(result.players.map(p=>p.id)).size!==result.players.length||result.players.some(p=>!finite(p.basePoints)||!finite(p.effectivePoints)||typeof p.starter!=='boolean')||starters.length!==slots.length||Legacy.bestLineup(starters,slots).length!==slots.length)invalid('Invalid recorded lineup.');
                    if(!finite(result.total)||!finite(result.baseTotal)||!finite(result.teamAdjustment)||!finite(result.favorCost)||result.favorCost<0
                        ||result.baseTotal!==round(starters.reduce((sum,p)=>sum+p.basePoints,0))||result.total!==round(starters.reduce((sum,p)=>sum+p.effectivePoints,0)+result.teamAdjustment))invalid('Invalid recorded scores.');
                }
                if(week.allianceScores?.length!==ids.length/2||!unique(week.allianceScores.map(a=>a.allianceId)))invalid('Missing alliance results.');
                for(const score of week.allianceScores) {
                    const alliance=alliances.find(a=>a.id===score.allianceId),slots=Legacy.slotsOf(state.factions[0]);
                    if(!alliance||!Array.isArray(score.contributors)||score.contributors.length!==slots.length||!unique(score.contributors.map(p=>p.factionId+':'+p.playerId)))invalid('Invalid alliance contributors.');
                    if(!sameFields(score.options,state.expansionSettings.heptad)||!finite(score.total)||Math.abs(score.total-round(score.contributors.reduce((sum,p)=>sum+p.points,0)))>.011)invalid('Invalid alliance score.');
                    for(const player of score.contributors) {
                        const source=week.factions.find(f=>f.factionId===player.factionId)?.players.find(p=>p.id===player.playerId);
                        if(!alliance.teamIds.includes(player.factionId)||!source||player.points!==(state.expansionSettings.heptad.favorPoints?source.effectivePoints:source.basePoints)||state.expansionSettings.heptad.pool==='starters'&&!source.starter)invalid('Alliance scoring must use its partners’ eligible recorded players.');
                    }
                    if(Legacy.bestLineup(score.contributors,slots).length!==slots.length||state.expansionSettings.heptad.duplicates==='unique-athlete'&&!unique(score.contributors.map(p=>p.identity)))invalid('Invalid alliance starting lineup.');
                }
            }
            };
            validateWeeks(state.completedWeeks,state.alliances,state.week-1);
            if(!Array.isArray(state.alliances)||state.alliances.length!==ids.length/2||!exact(state.alliances.flatMap(a=>a.teamIds))||new Set(state.alliances.map(a=>a.id)).size!==ids.length/2)invalid('Invalid alliances.');
            const archivedCount=state.dynastySeason-1+(state.phase==='complete'?1:0);
            if(state.dynasty.seasons.length!==archivedCount)invalid('Missing completed dynasty seasons.');
            for(const [index,season]of state.dynasty.seasons.entries()) {
                if(season.cycle!==index+1||!ids.includes(season.championId)||!Number.isFinite(Date.parse(season.completedAt))||!exact(season.rulers?.map(r=>r.factionId))||!exact(season.standings?.map(s=>s.factionId))||!exact(season.alliances?.flatMap(a=>a.teamIds)))invalid('Invalid dynasty season archive.');
                validateWeeks(season.completedWeeks,season.alliances,17);
                const final=season.completedWeeks.at(-1).heavenly;
                if(!final?.complete||final.championId!==season.championId||final.thirdPlaceId!==season.thirdPlaceId||season.rulers.some(r=>r.id!==season.completedWeeks.at(-1).factions.find(f=>f.factionId===r.factionId).armyId))invalid('Archived rulers and champion must match the final results.');
                const standings=Legacy.computeStandings({...state,completedWeeks:season.completedWeeks});
                if(season.standings.some((row,i)=>!sameFields(row,standings[i])))invalid('Archived standings do not match the scored season.');
                if(!season.landTotals||Object.keys(season.landTotals).length!==ids.length||ids.some(id=>!Number.isInteger(season.landTotals[id])||season.landTotals[id]<0))invalid('Invalid archived territory totals.');
            }
            if(archivedCount&&!sameValue(state.dynasty.honors,Lore.honors(state.dynasty.seasons)))invalid('Dynasty honors do not match the championship records.');
            if(!unique(state.dynasty.journal.map(e=>e.id))||state.dynasty.journal.some(e=>!text(e.id)||!ids.includes(e.factionId)||!Number.isInteger(e.cycle)||e.cycle<1||e.cycle>state.dynastySeason||e.cycle===state.dynastySeason&&!archaeology.revealedFactionIds.includes(e.factionId)||!Array.isArray(e.paragraphs)||e.paragraphs.some(p=>typeof p!=='string'||p.length>4000)))invalid('Invalid Archaeologist journal.');
            const map=Conquest.catalogFor(state.conquest),territories=new Set(map.TERRITORIES.map(t=>t.id));
            if(state.conquest.expansionVersion!==1||state.conquest.worldId!==(state.expansionSettings.worldScale==='provinces'?'earth-provinces-v1':World.WORLD_ID)||state.conquest.conquestMode!==state.expansionSettings.conquestMode||state.conquest.worldScale!==state.expansionSettings.worldScale)invalid('The conquest board does not match the dynasty rules.');
            if(state.conquest.routes!==undefined&&(!Array.isArray(state.conquest.routes)||state.conquest.routes.some(r=>!territories.has(r.from)||!territories.has(r.to)||r.from===r.to||r.type!=='sea'||r.origin!=='declared-campaign-passage'||!text(r.name))))invalid('Invalid campaign passage.');
            if(!exact(state.conquest.factionIds)||!state.conquest.events||!state.conquest.owners)invalid('Invalid conquest state.');
            for(const [id,owner]of Object.entries(state.conquest.owners))if(!territories.has(id)||!ids.includes(owner))invalid('Invalid land ownership.');
            for(const id of ids)if(!Number.isInteger(state.conquest.pendingClaims[id])||state.conquest.pendingClaims[id]<0||!Array.isArray(state.conquest.claimOrder[id])||state.conquest.claimOrder[id].some(t=>state.conquest.owners[t]!==id))invalid('Invalid conquest reserve.');
            if(state.phase==='complete'?!state.heavenly?.complete||state.championId!==state.heavenly.championId:state.championId!==null)invalid('Invalid champion.');
            return true;
        } catch(error){if(error.code==='INVALID_CAMPAIGN')throw error;fail('INVALID_CAMPAIGN','This dynasty save is malformed: '+error.message);}
    }
    return {...Legacy,createCampaign,applyAction,validateCampaign,projectCampaign,draftTurn,draftCandidates,
        expansionOptions,nextSeasonYears,requiredYears,ritualCandidates,unresolvedClaims,livingArmies};
});
