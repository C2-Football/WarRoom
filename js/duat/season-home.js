/* global module, require */
(function(root,factory){
    const App=root.App=root.App||{},common=typeof module!=='undefined'&&module.exports;
    const api=factory(common?require('./dynasty.js'):App.DuatCampaign,common?require('./weekly-progress.js'):App.DuatWeeklyProgress,common?require('./weekly-flow.js'):App.DuatWeeklyFlow,common?require('./heptad.js'):App.DuatHeptad,common?require('./rules.js'):App.DuatRules,common?require('./favors.js'):App.DuatFavors,common?require('./rituals.js'):App.DuatRituals);
    App.DuatSeasonHome=api;if(common)module.exports=api;
})(typeof window!=='undefined'?window:globalThis,function(Engine,Progress,Weekly,Heptad,Rules,Favors,Rituals){
    'use strict';
    const copy=value=>JSON.parse(JSON.stringify(value)),round=value=>Math.round(value*100)/100;
    const record=(wins,losses,ties)=>wins+'–'+losses+(ties?'–'+ties:'');
    const laneLabel={top:'Challenger path',bottom:'Redemption path',championship:'Championship',rematch:'Championship reset',pinnacle:'Pinnacle Battle'};
    function visibleThrough(campaign,factionId,raw){
        const progress=Progress.normalize(raw,campaign,factionId),weeks=(campaign.completedWeeks||[]).filter(w=>w.finalized!==false).sort((a,b)=>a.week-b.week);
        let cutoff=progress.reviewedThrough;
        for(const week of weeks.filter(w=>w.week>cutoff)){const result=progress.results[week.week];if(week.week!==cutoff+1||!result?.watched||result.clock!==60)break;cutoff=week.week;}
        return {progress,week:Math.max(0,Math.min(17,cutoff))};
    }
    function resumeFor(flow,currentWeek){
        const stage=flow?.stage||'lineup',week=flow?.week||currentWeek;
        const labels={alliance:'Meet your alliance',lineup:'Prepare Week '+week,favors:'Choose Week '+week+' offerings',kickoff:'Resume Week '+week+' kickoff',games:'Resume Week '+week+' games',recap:'Review Week '+week+' result',conquest:'Return to Week '+week+' war council',complete:'View season honors'};
        const details={alliance:'Discover your partner and entrance order.',lineup:'Your lineup and weekly choices are waiting.',favors:'Finish your optional offerings or resolve the waiting recruit.',kickoff:'Continue with the existing readiness gate.',games:'Continue from your saved place in Game Day.',recap:'The result is ready for your review.',conquest:'Resolve earned moves before preparing another week.',complete:'The season is written. Continue from its honors.'};
        return {stage,week,label:labels[stage]||'Resume your week',detail:details[stage]||''};
    }
    function outlookFor(campaign,standings,records,cutoff,battle,factionId){
        const regularSeasonWeeks=Engine.regularSeasonWeeks(campaign),fieldSize=Engine.settingsOf(campaign).playoffTeams,regularCount=records.filter(w=>w.week<=regularSeasonWeeks).length;
        const own=standings.find(row=>row.factionId===factionId),cutline=standings[fieldSize-1],remainingWeeks=Math.max(0,regularSeasonWeeks-regularCount);
        const gamesBack=own&&cutline?Math.max(0,round(cutline.winCredits-own.winCredits)):0;
        const common={available:regularCount>=4,status:'waiting',heading:'The playoff chase takes shape after Week 4',seed:own?.rank||null,fieldSize,regularSeasonWeeks,remainingWeeks,gamesBack,explanation:'Four revealed weeks establish an early picture. Future scores never enter this outlook.'};
        common.cutoffMargin=own&&cutline?round(own.winCredits-cutline.winCredits):0;
        common.cutoffLabel=common.cutoffMargin>0?common.cutoffMargin+' all-play wins above the cutoff':common.cutoffMargin<0?Math.abs(common.cutoffMargin)+' all-play wins below the cutoff':'Level with the cutoff on all-play win credits';
        common.pace=common.available&&own?{projectedWinCredits:round(own.winCredits/regularCount*regularSeasonWeeks),projectedCutoffWinCredits:round(cutline.winCredits/regularCount*regularSeasonWeeks),winCreditsPerWeek:round(own.winCredits/regularCount),label:'At your current pace',explanation:'At your current pace: '+round(own.winCredits/regularCount*regularSeasonWeeks)+' all-play win credits across '+regularSeasonWeeks+' regular-season weeks. The cutoff’s current pace is '+round(cutline.winCredits/regularCount*regularSeasonWeeks)+'. Each is a straight-line extension of revealed results, not a win probability.'}:null;
        if(!common.available||!own)return common;
        const qualified=own.rank<=fieldSize,firstRoundBye=fieldSize>4&&own.rank<=8-fieldSize;
        if(cutoff>=regularSeasonWeeks){
            const match=(battle?.matches||[]).filter(m=>[m.homeId,m.awayId].includes(factionId)).at(-1),eliminated=(battle?.matches||[]).some(m=>m.loserId===factionId&&m.round!=='third-place');
            if(battle?.championId===factionId)return {...common,status:'champion',heading:'Lord of the Duat',explanation:'Your revealed championship result earned the crown.'};
            if(match?.round==='third-place'&&match.winnerId===factionId)return {...common,status:'third-place',heading:'Third place secured',explanation:'Your revealed third-place game completes the season.'};
            if(!qualified)return {...common,status:'eliminated',heading:'Outside the playoff field',explanation:'The final regular-season standings place your faction outside the top '+fieldSize+'.'};
            if(eliminated)return {...common,status:'eliminated',heading:'Your championship run has ended',explanation:'A revealed playoff defeat ended the title chase; any remaining placement game still follows the calendar.'};
            return {...common,status:'qualified',heading:'Playoff place secured · seed '+own.rank,explanation:'The final regular-season field is set.'+(firstRoundBye?' Your seed earns a first-round bye.':' Your faction enters the Heavenly Battle.')};
        }
        const explanation=qualified?'If the season ended now, your faction would qualify in seed '+own.rank+'.'+(firstRoundBye?' This seed would receive a first-round bye.':'')
            :gamesBack>0?'You trail the cutoff by '+gamesBack+' all-play '+(gamesBack===1?'win':'wins')+'. Ties count as half a win; season points break equal records.'
            :'You are level with the cutoff on all-play win credits. Season points break equal all-play records.';
        return {...common,status:qualified?'in-field':'chasing',heading:qualified?'On pace for the playoff field':'Chasing the top '+fieldSize,explanation:explanation+' '+remainingWeeks+' regular-season '+(remainingWeeks===1?'week remains':'weeks remain')+'.'};
    }
    function describe({campaign,factionId,progress:raw,flow}={}){
        const visibility=visibleThrough(campaign,factionId,raw),cutoff=visibility.week,progress=visibility.progress;
        const records=(campaign.completedWeeks||[]).filter(w=>w.week<=cutoff&&w.finalized!==false).sort((a,b)=>a.week-b.week),regularSeasonWeeks=Engine.regularSeasonWeeks(campaign),settings=Engine.settingsOf(campaign);
        const safe={...campaign,week:cutoff+1,phase:cutoff===17?'complete':'season',completedWeeks:records,heptad:null,heavenly:null,pinnacle:null,playoffField:[],championId:null};
        const hasRegular=records.some(w=>w.week<=regularSeasonWeeks),standings=Engine.computeStandings(safe).map(row=>{
            const wins=row.wins-row.ties/2,losses=row.losses-row.ties/2;
            return {factionId:row.factionId,name:row.name,rank:hasRegular?row.rank:null,wins,losses,ties:row.ties,winCredits:row.wins,record:record(wins,losses,row.ties),points:row.points,isMine:row.factionId===factionId,inPlayoffField:hasRegular&&row.rank<=settings.playoffTeams};
        });
        const alliances=campaign.alliances||[],name=Heptad.tournamentName(alliances),allianceOf=id=>alliances.find(a=>a.id===id),mine=alliances.find(a=>a.teamIds.includes(factionId)),locked=!progress.allianceSeen;
        const heptad=Rules.runHeptadGauntlet(alliances,(id,week)=>records.find(w=>w.week===week)?.allianceScores?.find(a=>a.allianceId===id)?.total??null,2);safe.heptad=heptad;
        const playoffStart=18-Math.ceil(Math.log2(settings.playoffTeams));
        if(cutoff>=regularSeasonWeeks){safe.playoffField=standings.slice(0,settings.playoffTeams).map(row=>row.factionId);safe.heavenly=Rules.runHeavenlyBattle(safe.playoffField,(id,week)=>records.find(w=>w.week===week)?.factions?.find(f=>f.factionId===id)?.total??null,playoffStart);safe.championId=safe.heavenly.championId;}
        const pendingResultWeek=(campaign.completedWeeks||[]).filter(w=>w.finalized!==false&&w.week>cutoff).sort((a,b)=>a.week-b.week)[0]?.week||null;
        const currentWeek=Math.max(1,Math.min(17,flow?.week||pendingResultWeek||campaign.week)),resume=resumeFor(flow,currentWeek);
        const decorated=match=>({...copy(match),homeName:allianceOf(match.homeId)?.name||match.homeId,awayName:allianceOf(match.awayId)?.name||match.awayId,winnerName:match.winnerId?allianceOf(match.winnerId)?.name||match.winnerId:null,pathLabel:laneLabel[match.bracket],isMine:[match.homeId,match.awayId].includes(mine?.id)});
        const known=Weekly.knownHeptadFixtures(safe,heptad,cutoff).map(decorated),progression=Heptad.progress(alliances,heptad,2).map(p=>({id:p.id,name:p.name,teamIds:[...p.teamIds],entry:p.entry,status:p.status,lives:p.lives,wins:p.wins,losses:p.losses})),own=progression.find(p=>p.id===mine?.id);
        const next=known[0]?{...known[0],label:'Week '+known[0].week+' · '+known[0].pathLabel+' · '+known[0].homeName+' vs '+known[0].awayName}:null;
        const tournament={name,allianceCount:alliances.length,factionCount:campaign.factions.length,locked,allianceId:locked?null:mine?.id||null,allianceName:locked?null:mine?.name||null,teamIds:locked?[]:[...(mine?.teamIds||[])],entry:locked?null:mine?.entry||null,lives:locked?null:own?.lives||0,status:locked?'sealed':own?.status||'not-entered',label:locked?'Your alliance waits to be revealed.':heptad.complete?'The '+name+' crown has been decided.':own?.status==='waiting'?'Your alliance enters in Week '+(2+Math.max(0,mine.entry-2))+'.':own?.status==='eliminated'?'Your alliance’s run is complete.':'The alliance gauntlet is underway.',next:locked?null:next,nextFixtures:locked?[]:known,matches:locked?[]:(heptad.matches||[]).filter(m=>m.week===cutoff).map(decorated),progress:locked?[]:progression,championName:locked?null:allianceOf(heptad.championId)?.name||null};
        const schedule=Rules.heptadSchedule(alliances.length,2),catalog=campaign.expansionVersion===1?Rituals.CATALOG:Favors.FAVORS;
        const timeline=Array.from({length:17},(_,i)=>{
            const week=i+1,sacred=settings.favors&&Favors.SACRED_WEEKS.includes(week),preseason=settings.favors&&campaign.expansionVersion===1&&week===1;
            const offerings=catalog.filter(f=>sacred?f.timing==='Sacred week':preseason?f.timing==='Before Week 1':false);
            const events=alliances.length>=2?schedule.fixtures.filter(e=>e.week===week).map(e=>({...e,label:laneLabel[e.bracket],conditional:false})):[];
            if(alliances.length>=2&&week===schedule.rematchWeek&&(!heptad.complete||(heptad.matches||[]).some(m=>m.bracket==='rematch')))events.push({bracket:'rematch',week,label:'Championship reset · if needed',conditional:true});
            if(heptad.complete&&campaign.pinnacle&&['scheduled','complete'].includes(campaign.pinnacle.status)&&campaign.pinnacle.week===week)events.push({bracket:'pinnacle',week,label:'Agreed Pinnacle Battle',conditional:false});
            const result=week<=cutoff?Weekly.outcome(safe,factionId,week)?.allPlay:null;
            const roundLabel=week<=regularSeasonWeeks?'Regular season':week<playoffStart?'Playoff preparation':week===17?'Championship':week===16?'Semifinals':'Quarterfinals';
            return {week,label:'Week '+week,roundLabel,state:week===currentWeek?'current':week<=cutoff?'revealed':week<currentWeek?'unseen':'upcoming',sacred,favorNames:offerings.map(f=>f.name),deities:[...new Set(offerings.map(f=>f.deity))],result:result?{points:result.points,record:result.record,headline:result.headline}:null,heptad:events.length>0,allianceLabel:events.length?name+' · '+events.map(e=>e.label).join(' + '):'',events,detail:[roundLabel,sacred?'Sacred week · optional favors':preseason?'Preseason rituals close before kickoff':'',...events.map(e=>e.label)].filter(Boolean).join(' · ')};
        });
        return {visibleThroughWeek:cutoff,standingsThroughWeek:Math.min(cutoff,regularSeasonWeeks),currentWeek,pendingResultWeek,resume,standings,timeline,outlook:outlookFor(campaign,standings,records,cutoff,safe.heavenly,factionId),tournament};
    }
    return Object.freeze({describe,visibleThrough});
});
