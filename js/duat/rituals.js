/* global module, require */
(function (root, factory) {
    const api = factory(typeof module !== 'undefined' && module.exports ? require('./favors.js') : root.App.DuatFavors);
    (root.App = root.App || {}).DuatRituals = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Favors) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const round = value => Math.round(value * 100) / 100;
    const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
    const slotsFor = roster => ({duat:['QB','FLEX','FLEX','FLEX','FLEX'],classic:['QB','RB','RB','WR','WR','TE','FLEX'],superflex:['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX']}[roster || 'duat']);
    const DEITIES = Object.freeze([
        ['kratos','Kratos','Strength made divine','Turn a single performance into an overwhelming force.',null],
        ['horus','Horus','Guardian of the sky','Protect a walking starter against a disappointing score.',null],
        ['janus','Janus','Keeper of two horizons','Borrow a performance from the past you have already witnessed.',null],
        ['patecatl','Patecatl','Keeper of healing','Offer shelter when a starter cannot take the field.',0],
        ['nyx','Nyx','Mother of the sacred night','Keep vigil and grant one starter the strength of the stars.',1],
        ['midas','Midas','The golden bargain','Trade a member of your army for renewed divine favor.',2],
        ['ebisu','Ebisu','Fortune on the tide','Risk this week’s points on the turn of a twenty-sided die.',3],
        ['mahdi','Mahdi','The awaited guide','Summon a new player from beyond your sealed tombs.',4],
        ['anubis','Anubis','Guardian of the burial chamber','Bring a buried player into the walking army at a permanent price.',5],
        ['shiva','Shiva','Destroyer and renewer','Destroy the walking ruler and awaken another from your tombs.',6],
        ['amun','Amun','Lord of the hidden crown','Reward a champion with a first claim on the next army.',7],
        ['plutus','Plutus','Keeper of enduring wealth','Carry a champion’s unspent favor into the next chapter.',8]
    ].map(([id,name,title,description,atlasIndex])=>Object.freeze({id,name,title,description,
        art:atlasIndex===null?'images/duat/'+id+'.webp':'images/duat/pantheon-atlas.webp',atlasIndex})));
    const RITUALS = Object.freeze([
        {id:'midas',name:'Midas’ Touch',deity:'Midas',tier:'Legendary',cost:0,timing:'Sacred week',effect:'Sacrifice a player for 1–50 favor, based on their observed positional standing.',consequence:'The player leaves this army permanently. You must still be able to field a legal lineup.',adaptation:'The offering is valued using only completed weeks in this campaign. With no observed performance, it returns 1 favor.'},
        {id:'ebisu',name:'Ebisu’s Good Fortune',deity:'Ebisu',tier:'Legendary',cost:'Wager',timing:'Sacred week',effect:'Wager 10, 25, 50, 75 or 100 faction points on a d20. Ebisu changes all-play and playoff scores; Heptad contributor scores stay the same.',consequence:'A losing score below zero costs the shortfall in favor. One roll per sacred week.',adaptation:'Declare before the week resolves. Reserve the full wager in favor so the worst loss is covered. Faction points cannot finish below zero.'},
        {id:'summon-mahdi',name:'Summon the Mahdi',deity:'Mahdi',tier:'Mythic',cost:0,timing:'Before Week 1',effect:'Roll for an undrafted player from your walking ruler’s year.',consequence:'One reroll costs 20 favor. One Mahdi or Super Mahdi invocation every 17 campaign weeks.'},
        {id:'mahdi',name:'The Mahdi II',deity:'Mahdi',tier:'Legendary',cost:0,timing:'Sacred week',effect:'Choose a position and roll for an undrafted player from your ruler’s year.',consequence:'One reroll costs 20 favor. One Mahdi or Super Mahdi invocation every 17 campaign weeks.',adaptation:'The twenty-place draw uses available players and prior-season estimates. Shorter pools spread their players evenly across the die.'},
        {id:'super-mahdi',name:'The Super Mahdi',deity:'Mahdi',tier:'Legendary',cost:0,timing:'Sacred week',effect:'Summon from the newest historical year in this campaign.',consequence:'One random player is lost from a buried army when the recruit is accepted. Shares Mahdi’s cooldown.',adaptation:'The newest ruler year takes the place of the original live fantasy season; its future performances stay sealed.'},
        {id:'anubis',name:'Free Them, Anubis!',deity:'Anubis',tier:'Mythic',cost:0,timing:'Before Week 1',effect:'Replace an active player with a player from one of your buried armies.',consequence:'The buried army loses its player. The replaced player is permanently banished from this faction. Once per dynasty season.'},
        {id:'shiva',name:'Shiva the Destroyer',deity:'Shiva',tier:'Mythic',cost:0,timing:'Before Week 1',effect:'Destroy the walking ruler and randomly awaken another buried ruler.',consequence:'The destroyed ruler and army can never return. At least one other legal army must survive.'},
        {id:'amun',name:'Amun’s Spoils',deity:'Amun',tier:'Throne',cost:'1 claim / 10 reroll',timing:'Reigning champion',effect:'Choose a recruit for your next army. Roll 5 or 7 to secure the claim.',consequence:'The first roll is free. Further rolls cost 10 favor; success costs 1 favor and reserves the recruit for next season.',adaptation:'The historical snake draft uses a 1-favor first claim in place of the original $1 auction purchase.'},
        {id:'plutus',name:'Plutus’ Wealth',deity:'Plutus',tier:'Throne',cost:0,timing:'Reigning champion',effect:'Roll to carry your remaining favor into the next dynasty season.',consequence:'One attempt. Success on 5, 7, 10, 12, 14, 15 or 17.'}
    ].map(Object.freeze));
    const CATALOG = Object.freeze([...Favors.EXPANDED_FAVORS.map(favor=>Object.freeze({...favor,timing:'Sacred week'})),...RITUALS]);
    const WAGERS = Object.freeze([
        {amount:10,rolls:Array.from({length:14},(_,i)=>i+7)},
        {amount:25,rolls:Array.from({length:10},(_,i)=>i*2+2)},
        {amount:50,rolls:Array.from({length:8},(_,i)=>i+1)},
        {amount:75,rolls:[5,7,10,14]}, {amount:100,rolls:[5,7]}
    ].map(item=>Object.freeze({...item,chance:item.rolls.length/20})));
    const cycleOf = state => Number.isInteger(state.dynastySeason) ? state.dynastySeason : state.dynasty?.cycle || 1;
    const ordinal = state => (cycleOf(state)-1)*17 + Math.min(17,Math.max(1,state.week));
    function initializeFaction(faction) {
        return {...clone(faction),rituals:{ledger:[],banishedPlayerIds:[],banishedPlayerIdentities:[],destroyedArmyIds:[],cooldowns:{},pendingMahdi:null,ebisu:null,plutusCarry:0,amunClaim:null,...clone(faction.rituals || {})}};
    }
    function activeArmy(faction) { return faction.armies.find(a=>a.id===faction.activeArmyId && !a.destroyed); }
    function bestLineup(players, slots, value = p=>p.referencePoints || 0) {
        const states=new Map([[0,{points:0,players:[]}]]);
        for(const p of players)for(const [mask,entry]of [...states])for(let i=0;i<slots.length;i++){
            if(mask&(1<<i) || !(slots[i]===p.position || slots[i]==='SUPER_FLEX' || slots[i]==='FLEX' && p.position!=='QB'))continue;
            const next=mask|(1<<i),points=entry.points+value(p);
            if(!states.has(next)||points>states.get(next).points){const list=[...entry.players];list[i]=p;states.set(next,{points,players:list});}
        }
        return states.get((1<<slots.length)-1)?.players || [];
    }
    function canField(faction,players) { return bestLineup(players,slotsFor(faction.roster)).length===slotsFor(faction.roster).length; }
    function repairLineup(faction) {
        const army=activeArmy(faction); if(!army || !canField(faction,army.players))fail('RITUAL_ILLEGAL_ARMY','This ritual would leave no legal starting lineup.');
        const current=army.players.filter(p=>faction.lineup.includes(p.id));
        if(current.length!==slotsFor(faction.roster).length || !canField(faction,current)) faction.lineup=bestLineup(army.players,slotsFor(faction.roster)).map(p=>p.id);
    }
    function seededRoll(seed,key) {
        if(typeof seed!=='string'||!seed)fail('RITUAL_SEED','Only the authoritative campaign can roll a ritual.');
        let hash=2166136261; for(const c of seed+'|'+key){hash^=c.codePointAt(0);hash=Math.imul(hash,16777619);} hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;hash=Math.imul(hash,0x846ca68b);hash^=hash>>>16;
        return(hash>>>0)%20+1;
    }
    function reservedBalance(faction) {
        const declarations=faction.declaredFavors || faction.rituals?.declaredFavors || (faction.declaredFavor?[faction.declaredFavor]:[]);
        return declarations.reduce((sum,d)=>sum+(Favors.getFavor(d.favorId,1)?.cost || 0),0)+(faction.rituals?.ebisu?.wager || 0);
    }
    function spend(faction,amount) {
        if(!Number.isFinite(amount)||amount<0||faction.favorBalance-reservedBalance(faction)<amount)fail('RITUAL_BUDGET','The unreserved favor treasury cannot cover this ritual.');
        faction.favorBalance=round(faction.favorBalance-amount);
    }
    function cleanPlayer(p) {
        if(!p || typeof p.id!=='string'||!p.id || typeof p.identity!=='string'||!p.identity || !['QB','RB','WR','TE'].includes(p.position) || !Number.isInteger(p.season))fail('RITUAL_POOL','The ritual player pool is invalid.');
        return {id:p.id,identity:p.identity,name:String(p.name),position:p.position,season:p.season,referencePoints:Number.isFinite(p.referencePoints)?p.referencePoints:0,referenceSeason:Number.isInteger(p.referenceSeason)&&p.referenceSeason<p.season?p.referenceSeason:null};
    }
    function playerPool(state,factionId,pool,options={}) {
        const faction=state.factions.find(f=>f.id===factionId); if(!faction)fail('UNKNOWN_FACTION','Choose a faction in this campaign.');
        if(!Array.isArray(pool))fail('RITUAL_POOL','The historical recruitment pool has not loaded.');
        const used=new Set(state.factions.flatMap(f=>f.armies.flatMap(a=>a.players.map(p=>p.id))).concat(faction.rituals?.banishedPlayerIds||[]));
        const banishedIdentities=new Set(faction.rituals?.banishedPlayerIdentities||[]);
        const seen=new Set(); const season=options.season ?? activeArmy(faction)?.season;
        return pool.map(cleanPlayer).filter(p=>{
            if(seen.has(p.id)||used.has(p.id)||banishedIdentities.has(p.identity)||p.season!==season)return false;seen.add(p.id);
            return !options.position || options.position==='ALL' || options.position==='FLEX'&&p.position!=='QB' || p.position===options.position;
        }).sort((a,b)=>b.referencePoints-a.referencePoints||a.id.localeCompare(b.id)).slice(0,options.limit || 20);
    }
    function offeringValue(state,factionId,playerId) {
        const faction=state.factions.find(f=>f.id===factionId),player=activeArmy(faction)?.players.find(p=>p.id===playerId);
        if(!player)fail('UNKNOWN_PLAYER','Choose a player in the walking army.');
        const totals=new Map();
        for(const week of state.completedWeeks || [])if(week.week<state.week)for(const f of week.factions)for(const p of f.players || [])if(p.position===player.position && Number.isFinite(p.basePoints) && p.hasRecordedGame){totals.set(p.id,(totals.get(p.id)||0)+p.basePoints);}
        if(!totals.has(playerId))return {favor:1,percentile:null,rank:null,pool:totals.size,label:'No observed game · 1 favor'};
        const sorted=[...totals].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),rank=sorted.findIndex(([id])=>id===playerId)+1;
        const percentile=rank/sorted.length, favor=percentile<=.05?50:percentile<=.25?25:percentile<=.5?13:percentile<=.75?5:1;
        return {favor,percentile,rank,pool:sorted.length,label:'Observed '+player.position+' rank '+rank+' of '+sorted.length+' · '+favor+' favor'};
    }
    function requireConfirmed(action) { if(action.confirmed!==true)fail('RITUAL_CONFIRM','Confirm the permanent consequence before invoking this ritual.'); }
    function requireSacred(state) {if(state.phase!=='season'||!Favors.SACRED_WEEKS.includes(state.week))fail('RITUAL_WINDOW','This ritual opens only during a sacred week.');}
    function requirePreseason(state){if(state.phase!=='season'||state.week!==1||(state.completedWeeks||[]).length)fail('RITUAL_WINDOW','This ritual is available after the reveal and before Week 1.');}
    function pushEvent(state,faction,ritualId,context,details={}) {
        const event={id:'ritual-'+cycleOf(state)+'-'+state.week+'-'+faction.id+'-'+(faction.rituals.ledger.length+1),ritualId,cycle:cycleOf(state),week:state.week,cost:0,credit:0,...details,createdAt:context.createdAt || state.updatedAt};
        faction.rituals.ledger.push(event);return event;
    }
    function applyAction(input,action,context={}) {
        if(input?.expansionVersion!==1)fail('RITUAL_EDITION','These rituals require a sourcebook campaign.');
        if(input.settings?.favors===false)fail('FAVORS_DISABLED','Favors are turned off for this campaign.');
        const state=clone(input),index=state.factions.findIndex(f=>f.id===action.factionId);
        if(index<0)fail('UNKNOWN_FACTION','Choose a faction in this campaign.');
        const faction=state.factions[index]=initializeFaction(state.factions[index]),r=faction.rituals,army=activeArmy(faction),id=action.ritualId;
        if(!army && !['amun','plutus'].includes(id))fail('RITUAL_ARMY','Reveal a walking ruler before calling on the gods.');
        const pendingActions=['mahdi-reroll','mahdi-accept','mahdi-decline'];
        if(r.pendingMahdi&&!pendingActions.includes(id))fail('MAHDI_PENDING','Accept or decline the waiting Mahdi recruit first.');
        if(!pendingActions.includes(id)&&id!=='ebisu-clear'&&typeof state.seed!=='string')fail('RITUAL_SEED','Only the authoritative campaign can resolve rituals.');
        let event;
        const roll=purpose=>seededRoll(state.seed,faction.id+':'+cycleOf(state)+':'+state.week+':'+r.ledger.length+':'+purpose);
        const rosterChange=()=>{if((faction.declaredFavors||r.declaredFavors||[]).length||faction.declaredFavor)fail('RITUAL_DECLARATIONS','Clear declared starter favors before changing the army.');};
        if(id==='midas'){
            requireSacred(state);requireConfirmed(action);rosterChange();
            const player=army.players.find(p=>p.id===action.playerId);if(!player)fail('UNKNOWN_PLAYER','Choose a player in the walking army.');
            const value=offeringValue(state,faction.id,player.id),remaining=army.players.filter(p=>p.id!==player.id);
            if(!canField(faction,remaining))fail('RITUAL_ILLEGAL_ARMY','Keep enough players to fill every starting slot.');
            army.players=remaining;faction.favorBalance=round(faction.favorBalance+value.favor);r.banishedPlayerIds.push(player.id);repairLineup(faction);
            event=pushEvent(state,faction,id,context,{playerId:player.id,playerName:player.name,credit:value.favor,message:player.name+' entered Midas’ gold pits. '+value.favor+' favor returns to the treasury.',valuation:value});
        } else if(id==='ebisu'){
            requireSacred(state);const wager=WAGERS.find(w=>w.amount===action.wager);if(!wager)fail('RITUAL_WAGER','Choose a wager of 10, 25, 50, 75 or 100.');
            if(r.ledger.some(e=>e.ritualId==='ebisu-result'&&e.cycle===cycleOf(state)&&e.week===state.week))fail('RITUAL_USED','Ebisu has already rolled this sacred week.');
            r.ebisu=null;if(faction.favorBalance-reservedBalance(faction)<wager.amount)fail('RITUAL_BUDGET','Reserve enough favor to cover the full Ebisu wager.');
            r.ebisu={wager:wager.amount,week:state.week,cycle:cycleOf(state)};
            event=pushEvent(state,faction,id,context,{wager:wager.amount,message:'Ebisu awaits the week’s result. '+wager.amount+' points are at stake.'});
        } else if(id==='ebisu-clear'){
            if(!r.ebisu)fail('RITUAL_WAGER','There is no pending wager.');r.ebisu=null;event=pushEvent(state,faction,id,context,{message:'The pending Ebisu wager was withdrawn.'});
        } else if(['mahdi','summon-mahdi','super-mahdi'].includes(id)){
            if(id==='summon-mahdi')requirePreseason(state);else requireSacred(state);
            if((r.cooldowns.mahdi||0)>ordinal(state)){const next=r.cooldowns.mahdi;fail('RITUAL_COOLDOWN','Mahdi must rest until dynasty season '+(Math.floor((next-1)/17)+1)+', Week '+((next-1)%17+1)+'.');}
            if(id==='super-mahdi'&&!faction.armies.some(a=>a.id!==army.id&&!a.destroyed&&a.players.length))fail('RITUAL_BURIED','Super Mahdi needs a buried army from which to take a player.');
            const season=id==='super-mahdi'?Math.max(...state.seasons):army.season;
            if(!['ALL','QB','RB','WR','TE','FLEX'].includes(action.position||'ALL'))fail('RITUAL_POSITION','Choose a supported position.');
            const pool=playerPool(state,faction.id,context.pool,{season,position:action.position||'ALL'});if(!pool.length)fail('RITUAL_POOL','No undrafted players remain for this year and position.');
            const die=roll(id);r.pendingMahdi={ritualId:id,player:pool[Math.floor((die-1)*pool.length/20)],roll:die,position:action.position||'ALL',season,rerolls:0,poolIds:pool.map(p=>p.id)};
            r.cooldowns.mahdi=ordinal(state)+17;event=pushEvent(state,faction,id,context,{roll:die,message:'Mahdi reveals '+r.pendingMahdi.player.name+'. Accept, decline, or pay 20 favor for one reroll.'});
        } else if(id==='mahdi-reroll'){
            const pending=r.pendingMahdi;if(!pending)fail('MAHDI_PENDING','Summon Mahdi before requesting a reroll.');
            if(pending.rerolls>=1)fail('RITUAL_USED','Only one Mahdi reroll is allowed.');spend(faction,20);
            const pool=playerPool(state,faction.id,context.pool,{season:pending.season,position:pending.position}).filter(p=>pending.poolIds.includes(p.id));
            if(!pool.length)fail('RITUAL_POOL','No eligible players remain in the original draw.');
            const die=roll(id);pending.player=pool[Math.floor((die-1)*pool.length/20)];pending.roll=die;pending.rerolls=1;
            event=pushEvent(state,faction,id,context,{cost:20,roll:die,message:'The final Mahdi draw reveals '+pending.player.name+'.'});
        } else if(id==='mahdi-accept'){
            const pending=r.pendingMahdi;if(!pending)fail('MAHDI_PENDING','There is no waiting recruit.');rosterChange();
            const eligible=playerPool(state,faction.id,context.pool,{season:pending.season,position:pending.position,limit:10000});
            const recruit=eligible.find(p=>p.id===pending.player.id);if(!recruit)fail('RITUAL_UNAVAILABLE','This recruit is no longer available. Decline this draw to continue.');
            const max=context.maxRosterSize || slotsFor(faction.roster).length+(state.settings?.bench||3);
            let released=null;
            if(army.players.length>=max){released=army.players.find(p=>p.id===action.replacementId);if(!released)fail('RITUAL_REPLACE','Choose the active player who will make room for this recruit.');requireConfirmed(action);army.players=army.players.filter(p=>p.id!==released.id);}
            army.players.push(recruit);repairLineup(faction);
            let sacrifice=null;
            if(pending.ritualId==='super-mahdi'){
                requireConfirmed(action);const buried=faction.armies.filter(a=>a.id!==army.id&&!a.destroyed).flatMap(a=>a.players.map(p=>({army:a,player:p})));
                if(!buried.length)fail('RITUAL_BURIED','No buried player remains for Super Mahdi’s cost.');const die=roll('super-mahdi-cost');
                const lost=buried[Math.floor((die-1)*buried.length/20)];lost.army.players=lost.army.players.filter(p=>p.id!==lost.player.id);r.banishedPlayerIds.push(lost.player.id);sacrifice={armyId:lost.army.id,playerId:lost.player.id,playerName:lost.player.name,roll:die};
            }
            r.pendingMahdi=null;event=pushEvent(state,faction,id,context,{playerId:recruit.id,playerName:recruit.name,releasedPlayerId:released?.id||null,sacrifice,message:recruit.name+' joined the walking army.'+(sacrifice?' '+sacrifice.playerName+' was taken from a buried army.':'')});
        } else if(id==='mahdi-decline'){
            if(!r.pendingMahdi)fail('MAHDI_PENDING','There is no waiting recruit.');r.pendingMahdi=null;event=pushEvent(state,faction,id,context,{message:'The Mahdi recruit was declined. The invocation’s cooldown remains.'});
        } else if(id==='anubis'){
            requirePreseason(state);requireConfirmed(action);rosterChange();
            if(r.cooldowns.anubis===cycleOf(state))fail('RITUAL_USED','Anubis can transfer one player per dynasty season.');
            const target=army.players.find(p=>p.id===action.playerId),buried=faction.armies.find(a=>a.id!==army.id&&!a.destroyed&&a.players.some(p=>p.id===action.replacementId));
            if(!target||!buried)fail('RITUAL_TRANSFER','Choose an active player and a player from a different, buried army.');
            const source=buried.players.find(p=>p.id===action.replacementId);if(r.banishedPlayerIds.includes(source.id)||r.banishedPlayerIdentities.includes(source.identity))fail('RITUAL_BANISHED','A banished player cannot return.');
            army.players=army.players.filter(p=>p.id!==target.id).concat({...source,season:source.season||buried.season});buried.players=buried.players.filter(p=>p.id!==source.id);
            r.banishedPlayerIds.push(target.id);if(!r.banishedPlayerIdentities.includes(target.identity))r.banishedPlayerIdentities.push(target.identity);r.cooldowns.anubis=cycleOf(state);repairLineup(faction);
            event=pushEvent(state,faction,id,context,{playerId:source.id,banishedPlayerId:target.id,sourceArmyId:buried.id,message:source.name+' leaves the tomb to replace '+target.name+', who is banished permanently.'});
        } else if(id==='shiva'){
            requirePreseason(state);requireConfirmed(action);rosterChange();
            const choices=faction.armies.filter(a=>a.id!==army.id&&!a.destroyed&&canField(faction,a.players));if(!choices.length)fail('RITUAL_LAST_RULER','At least one other legal buried army must survive Shiva.');
            const die=roll(id),replacement=choices[Math.floor((die-1)*choices.length/20)];army.destroyed=true;r.destroyedArmyIds.push(army.id);faction.activeArmyId=replacement.id;faction.rulerRoll=die;faction.lineup=[];repairLineup(faction);
            event=pushEvent(state,faction,id,context,{roll:die,destroyedArmyId:army.id,replacementArmyId:replacement.id,message:army.rulerName+' is destroyed forever. '+replacement.rulerName+' now walks.'});
        } else if(id==='amun'||id==='plutus'){
            if(state.phase!=='complete'||state.championId!==faction.id)fail('RITUAL_CHAMPION','The reigning Lord of the Duat alone may enter the Throne Room.');
            if(id==='plutus'){
                if(r.ledger.some(e=>e.ritualId===id&&e.cycle===cycleOf(state)))fail('RITUAL_USED','Plutus grants one attempt per championship.');
                const die=roll(id),won=[5,7,10,12,14,15,17].includes(die);r.plutusCarry=won?faction.favorBalance:0;
                event=pushEvent(state,faction,id,context,{roll:die,success:won,carry:r.plutusCarry,message:won?'Plutus permits up to '+r.plutusCarry+' remaining favor to cross into the next season.':'Plutus closes the treasury at this season’s end.'});
            }else{
                if(r.amunClaim)fail('RITUAL_USED','Amun has already reserved your champion’s recruit.');
                const candidate=(context.pool||[]).map(cleanPlayer).find(p=>p.id===action.playerId);if(!candidate||r.banishedPlayerIds.includes(candidate.id)||r.banishedPlayerIdentities.includes(candidate.identity))fail('RITUAL_POOL','Choose an eligible player from the next ruler’s draft pool.');
                const attempts=r.ledger.filter(e=>e.ritualId===id&&e.cycle===cycleOf(state)).length,cost=attempts?10:0;spend(faction,cost);
                if(faction.favorBalance<1)fail('RITUAL_BUDGET','Keep 1 favor available for a successful champion’s claim.');
                const die=roll(id),won=die===5||die===7;if(won){spend(faction,1);r.amunClaim=candidate;}
                event=pushEvent(state,faction,id,context,{roll:die,success:won,cost:cost+(won?1:0),playerId:candidate.id,message:won?'Amun reserves '+candidate.name+' for your next army.':'Amun declines this request. Another roll costs 10 favor.'});
            }
        } else fail('UNKNOWN_RITUAL','Choose an available ritual.');
        if(event){state.activity=state.activity||[];state.activity.push({type:'ritual',factionId:faction.id,week:state.week,message:event.message,createdAt:event.createdAt});}
        return state;
    }
    function resolveEbisu({faction:input,week,total,seed,cycle=1,createdAt}) {
        const faction=initializeFaction(input),pending=faction.rituals.ebisu;
        if(!Number.isFinite(total))fail('RITUAL_SCORE','Ebisu requires a finalized team score.');
        if(!pending)return{faction,total,cost:0,event:null};
        if(pending.week!==week||pending.cycle!==cycle)fail('RITUAL_WAGER','This wager belongs to a different week.');
        const wager=WAGERS.find(w=>w.amount===pending.wager);if(!wager)fail('RITUAL_WAGER','This wager is invalid.');
        const die=seededRoll(seed,faction.id+':'+cycle+':'+week+':ebisu-result'),won=wager.rolls.includes(die);
        const before=Math.max(0,total),raw=before+(won?wager.amount:-wager.amount),cost=round(Math.max(0,-raw));
        faction.rituals.ebisu=null;spend(faction,cost);
        const event={id:'ebisu-'+cycle+'-'+week+'-'+faction.id,ritualId:'ebisu-result',cycle,week,roll:die,wager:wager.amount,success:won,cost,credit:0,beforePoints:total,afterPoints:round(Math.max(0,raw)),delta:round(Math.max(0,raw)-total),createdAt,message:'Ebisu rolls '+die+'. '+(won?'The wager wins.':'The wager loses.')+(cost?' '+cost+' favor covers the shortfall.':'')+' All-play and playoff points change; Heptad contributor scores stay the same.'};
        faction.rituals.ledger.push(event);return{faction,total:event.afterPoints,cost,event};
    }
    function rolloverFaction(input,{favorBudget=100,cycle=2}={}) {
        const faction=initializeFaction(input),r=faction.rituals;
        const carry=Math.min(r.plutusCarry||0,faction.favorBalance);faction.favorBalance=round(favorBudget+carry);r.plutusCarry=0;r.pendingMahdi=null;r.ebisu=null;faction.declaredFavor=null;faction.declaredFavors=[];
        r.ledger.push({id:'treasury-'+cycle+'-'+faction.id,ritualId:'new-season',cycle,week:0,cost:0,credit:carry,baseTreasury:favorBudget,message:carry+' favor carried into the new dynasty season.'});
        return faction;
    }
    function validateFaction(faction,{cycle=1,week=1}={}) {
        const invalid=message=>fail('INVALID_RITUAL_STATE',message),r=faction.rituals;
        const money=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
        const uniqueStrings=value=>Array.isArray(value)&&new Set(value).size===value.length&&value.every(s=>typeof s==='string'&&s.length>0&&s.length<=240);
        if(!r||typeof r!=='object'||Array.isArray(r)||!Array.isArray(r.ledger)||!uniqueStrings(r.banishedPlayerIds)||!uniqueStrings(r.destroyedArmyIds)||!uniqueStrings(r.banishedPlayerIdentities||[])||!r.cooldowns||typeof r.cooldowns!=='object')invalid('Invalid permanent ritual history.');
        const ids=new Set(),known=new Set([...RITUALS.map(x=>x.id),'mahdi-reroll','mahdi-accept','mahdi-decline','ebisu-clear','ebisu-result','new-season']);
        for(const e of r.ledger){
            if(!e||typeof e.id!=='string'||ids.has(e.id)||!known.has(e.ritualId)||!Number.isInteger(e.cycle)||e.cycle<1||e.cycle>cycle||!Number.isInteger(e.week)||e.week<0||e.week>18||!money(e.cost)||!money(e.credit))invalid('Invalid ritual receipt.');
            ids.add(e.id);if(e.roll!==undefined&&(!Number.isInteger(e.roll)||e.roll<1||e.roll>20))invalid('Invalid recorded ritual die.');
            if(e.ritualId==='ebisu-result'&&(!WAGERS.some(w=>w.amount===e.wager)||typeof e.success!=='boolean'||!money(e.afterPoints)))invalid('Invalid Ebisu receipt.');
            if(['amun','plutus'].includes(e.ritualId)&&typeof e.success!=='boolean')invalid('Invalid champion ritual receipt.');
        }
        for(const [key,value]of Object.entries(r.cooldowns))if(!['mahdi','anubis'].includes(key)||!Number.isInteger(value)||value<0||value>(key==='anubis'?cycle:cycle*17+17))invalid('Invalid ritual cooldown.');
        if(!money(r.plutusCarry))invalid('Invalid Plutus treasury carry.');
        if(r.amunClaim!==null&&r.amunClaim!==undefined){try{cleanPlayer(r.amunClaim);}catch{invalid('Invalid Amun claim.');}if((r.banishedPlayerIdentities||[]).includes(r.amunClaim.identity)||r.banishedPlayerIds.includes(r.amunClaim.id))invalid('Amun cannot claim a banished player.');}
        if(r.ebisu!==null&&r.ebisu!==undefined){const w=r.ebisu;if(!WAGERS.some(x=>x.amount===w.wager)||w.week!==week||w.cycle!==cycle||!Favors.SACRED_WEEKS.includes(week))invalid('Invalid pending Ebisu wager.');}
        if(r.pendingMahdi!==null&&r.pendingMahdi!==undefined){
            const p=r.pendingMahdi;if(!['mahdi','summon-mahdi','super-mahdi'].includes(p.ritualId)||!['ALL','QB','RB','WR','TE','FLEX'].includes(p.position)||!Number.isInteger(p.roll)||p.roll<1||p.roll>20||![0,1].includes(p.rerolls)||!Number.isInteger(p.season)||!uniqueStrings(p.poolIds)||!p.poolIds.length||p.poolIds.length>20||!p.poolIds.includes(p.player?.id)||p.player?.season!==p.season)invalid('Invalid pending Mahdi draw.');
            try{cleanPlayer(p.player);}catch{invalid('Invalid pending Mahdi recruit.');}
            if(!r.cooldowns.mahdi)invalid('Mahdi invocation is missing its cooldown.');
        }
        if(!money(faction.favorBalance)||reservedBalance(faction)>faction.favorBalance)invalid('Reserved rituals exceed the favor treasury.');
        return true;
    }
    return Object.freeze({DEITIES,CATALOG,RITUALS,WAGERS,initializeFaction,activeArmy,bestLineup,canField,seededRoll,reservedBalance,playerPool,offeringValue,applyAction,resolveEbisu,rolloverFaction,validateFaction});
});
