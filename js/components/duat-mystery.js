/* global React */
(function(root){
    'use strict';
    const App=root.App=root.App||{},h=React.createElement;
    const labels={passYd:'Passing yards',passTd:'Passing TD',passInt:'Interceptions',rushYd:'Rushing yards',rushTd:'Rushing TD',rec:'Receptions',recYd:'Receiving yards',recTd:'Receiving TD',fumblesLost:'Fumbles lost',twoPointConversions:'Two-point conversions'};
    function StatLine({stats}){
        return h('dl',{className:'duat-mystery-stats'},Object.entries(stats||{}).map(([key,value])=>h('div',{key},h('dt',null,labels[key]||key),h('dd',null,value))));
    }
    const number=value=>Number.isFinite(value)?value.toFixed(1):'—';
    function Scouting({report}){
        if(!report?.available)return h('span',{className:'duat-scouting-unavailable'},'Scouting unavailable');
        return h('span',{className:'duat-scouting',title:'Current-week archive estimate compared with this player’s possible seasons. Stars are an outlook, not a start/bench recommendation.'},
            report.stars&&h('span',{className:'duat-scouting-stars',role:'img','aria-label':`${report.stars} of 5 stars · Week ${report.week} archive outlook`},h('span',{'aria-hidden':true},'★'.repeat(report.stars)),h('span',{className:'is-empty','aria-hidden':true},'☆'.repeat(5-report.stars))),
            h('small',null,report.outlook));
    }
    function DecisionStats({report}){
        if(!report)return null;
        return h(React.Fragment,null,h('div',{className:'duat-research-scouting'},h(Scouting,{report}),h('span',null,report.week<=17?`Week ${report.week} outlook`:'Season complete')),
            h('dl',{className:'duat-research-metrics'},
                h('div',null,h('dt',null,report.week<=17?`W${report.week} ${report.exact?'base pts':'est. pts'}`:'Week pts'),h('dd',null,number(report.points))),
                h('div',null,h('dt',null,report.exact?'Base pts left':'Est. pts left'),h('dd',null,number(report.pointsLeft))),
                h('div',null,h('dt',null,'Weeks left'),h('dd',null,Math.max(0,18-report.week))),
                h('div',null,h('dt',null,'Possible seasons'),h('dd',null,report.candidateCount))),
            h('p',{className:'duat-muted'},!report.available?'Load the archive to see scouting estimates.':report.exact?'Base points come from the public season archive. Divine offerings can change your actual score.':`An equal-weight average of the ${report.candidateCount} matching archive seasons, not a probability. This week spans ${number(report.range[0])}–${number(report.range[1])} base points; ${number(report.remainingRange[0])}–${number(report.remainingRange[1])} remain before offerings.`));
    }
    function GameLog({campaign,player,candidate,data,report}){
        const keys=player.position==='QB'?['passYd','passTd','passInt','rushYd','rushTd']:player.position==='RB'?['rushYd','rushTd','rec','recYd','recTd']:['rec','recYd','recTd','rushYd','rushTd'];
        const short={passYd:'Pass yd',passTd:'Pass TD',passInt:'INT',rushYd:'Rush yd',rushTd:'Rush TD',rec:'Rec',recYd:'Rec yd',recTd:'Rec TD'};
        const games=App.DuatMystery.archiveGames(campaign,player,candidate,data);
        return h('div',{className:'duat-table-wrap duat-season-game-log',tabIndex:0,role:'region','aria-label':`${candidate.year} archive game log`},
            h('table',null,h('caption',null,`${player.name} · ${candidate.year} regular season · campaign scoring`),
                h('thead',null,h('tr',null,['NFL week','Base pts',...keys.map(key=>short[key]),'Campaign'].map(label=>h('th',{key:label,scope:'col'},label)))),
                h('tbody',null,games.map(game=>h('tr',{key:game.week,className:report?.knownYear===candidate.year&&report?.week===game.week?'is-current-week':!game.inCampaign?'is-outside-campaign':''},
                    h('th',{scope:'row'},`W${game.week}`),h('td',{className:'duat-log-points'},game.available?number(game.points):'—'),
                    ...keys.map(key=>h('td',{key},game.available&&game.hasRecordedGame?game.stats[key]??'—':'—')),
                    h('td',null,!game.inCampaign?'Outside Duat season':!game.hasRecordedGame?'No recorded game':report?.knownYear===candidate.year&&game.week===report.week?'This week':`Duat W${game.week}`))))));
    }
    function Explorer({campaign,player,data,throughWeek=0,factionId,compact=false,report:passedReport}){
        const [open,setOpen]=React.useState(false),[year,setYear]=React.useState(null);
        const mystery=App.DuatMystery;if(!mystery?.enabled(campaign)||!mystery.isCard(player))return null;
        const viewedThroughWeek=Number.isInteger(throughWeek)&&throughWeek>=0?throughWeek:0;
        const info=open||viewedThroughWeek>0?mystery.inspect(campaign,player,data,{throughWeek:viewedThroughWeek,factionId}):null;
        const remainingYears=info?.archiveReady?info.remaining:player.candidateYears;
        const revealedYear=viewedThroughWeek>=17&&campaign.phase==='complete'&&player.candidateYears.includes(player.revealedSeason)?player.revealedSeason:null;
        const identifiedYear=revealedYear||(remainingYears.length===1?remainingYears[0]:null);
        const report=passedReport||mystery.scouting(campaign,player,data,{throughWeek:viewedThroughWeek});
        const selected=info?.candidates.find(row=>row.year===Number(year??identifiedYear))||info?.candidates[0];
        const clue=identifiedYear?String(identifiedYear):`${player.decade}s · ${remainingYears.length} possible ${remainingYears.length===1?'season':'seasons'}`;
        const panelId=`duat-lineup-research-${factionId}-${player.id}`;
        const content=open&&h('div',compact?{id:panelId,className:'duat-lineup-research-panel',role:'region','aria-label':`${player.name} historical research`,onKeyDown:event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);root.document?.getElementById(panelId+'-toggle')?.focus();}}}:null,
            h('header',{className:'duat-research-heading'},h('div',null,h('h3',null,player.name),h('strong',{className:identifiedYear?'duat-player-season':'duat-muted'},clue)),h('span',{className:'duat-position'},player.position)),
            h(DecisionStats,{report}),
            h('div',{className:'duat-research-season-control'},h('h4',null,'Season game log'),
                h('label',null,'Archive season',h('select',{value:selected?.year||'',onChange:event=>setYear(Number(event.target.value)),'aria-label':`Inspect ${player.name} candidate season`},info.candidates.map(row=>h('option',{key:row.year,value:row.year},`${row.year}${row.compatible===false?' · ruled out by revealed games':''}`))))),
            selected&&h(React.Fragment,null,
                info.archiveReady&&h('p',{className:'duat-muted'},selected.compatible===false?`Differs in campaign ${selected.contradictions.length===1?'week':'weeks'} ${selected.contradictions.join(', ')}.`:info.observed.length?'Matches the revealed campaign box scores.':'No campaign evidence yet.'),
                info.archiveReady?h(GameLog,{campaign,player,candidate:selected,data,report}):h('p',{role:'status'},'The candidate archive is loading.')),
            h('p',{className:'duat-muted'},'Duat uses NFL weeks 1–17 in order. Week 18 is archive context only. A dash means no available stat; no recorded game is not automatically a bye.'),
            h('details',{className:'duat-research-evidence'},h('summary',null,'Revealed games & season clues'),
                h('p',{className:'duat-muted'},'Matching evidence is a possibility, not a probability. The ruler’s origin year does not choose the player’s scoring year.'),
                info.revealedSeason&&h('p',{className:'duat-notice'},h('strong',null,`Final reveal: ${info.revealedSeason}`)),
                !info.observed.length?h('p',null,'No completed games have been revealed. Every listed season remains possible.'):
                    h(React.Fragment,null,h('p',null,info.archiveReady?`${info.remaining.length} of ${info.candidates.length} seasons still match all revealed box scores.`:'Load the archive to compare the revealed box scores.'),
                        info.observed.map(line=>h('details',{key:line.week},h('summary',null,`Week ${line.week} · ${Number(line.basePoints).toFixed(2)} base points${line.hasRecordedGame?'':' · no recorded game'}`),h(StatLine,{stats:line.stats}),line.effectivePoints!==line.basePoints&&h('p',null,`After offerings: ${Number(line.effectivePoints).toFixed(2)} points. The year comparison uses the original box score.`))))));
        if(compact)return h(React.Fragment,null,
            h('button',{type:'button',id:panelId+'-toggle',className:'duat-lineup-research-toggle','aria-expanded':open,'aria-controls':panelId,'aria-label':`Explore ${player.name}'s possible seasons`,'aria-describedby':panelId+'-clue',onClick:()=>setOpen(!open),onKeyDown:event=>{if(event.key==='Escape'&&open){event.stopPropagation();setOpen(false);}}},
                h('span',{className:'duat-player-name'},h('strong',null,player.name),h('small',{id:panelId+'-clue',className:identifiedYear?'duat-player-season':undefined},clue),h(Scouting,{report})),
                h('span',{className:'duat-lineup-research-chevron','aria-hidden':true},open?'⌄':'›')),
            content||h('div',{id:panelId,hidden:true}));
        return h('details',{className:'duat-mystery-explorer',onToggle:event=>setOpen(event.currentTarget.open)},
            h('summary',null,'Explore ',h('span',{className:identifiedYear?'duat-player-season':undefined},clue)),content);
    }
    function Recap({campaign,factionId,data,throughWeek=0,onAction,busy}){
        if(!App.DuatMystery?.enabled(campaign)||campaign.phase!=='complete'||!Number.isInteger(throughWeek)||throughWeek<17)return null;
        const view=campaign.hiddenYears?App.DuatMystery.project(campaign,factionId):campaign;
        const factions=new Map();
        for(const week of view.completedWeeks)for(const faction of week.factions){if(!factions.has(faction.factionId))factions.set(faction.factionId,new Map());for(const player of faction.players)factions.get(faction.factionId).set(player.id,player);}
        const played=[...factions].map(([factionId,players])=>({factionId,players:[...players.values()]}));
        return h('section',{className:'duat-panel duat-mystery-recap'},h('span',{className:'duat-eyebrow'},'THE SEALED YEARS'),h('h3',null,'Which seasons walked with you?'),
            view.hiddenYearRevealAvailable?h(React.Fragment,null,h('p',null,'The seventeen-week story is complete. Reveal the fixed seasons of players who appeared in this campaign. Buried future armies stay sealed.'),h('button',{className:'duat-button',disabled:busy||!onAction,onClick:()=>onAction({type:'reveal-years'})},'Reveal the scoring years')):
                h('div',null,played.map(f=>h('details',{key:f.factionId,open:f.factionId===factionId},h('summary',null,App.DuatPresentation?.nameOf(f.factionId)||f.factionId),f.players.map(player=>h('article',{key:player.id},h('strong',null,player.name),h('p',null,`${player.decade}s · ${player.revealedSeason||'Year sealed'}`),h(Explorer,{campaign:view,player,data,throughWeek:17,factionId})))))));
    }
    App.DuatMysteryUI={Explorer,Recap,StatLine,Scouting,DecisionStats,GameLog};
})(typeof window!=='undefined'?window:globalThis);
