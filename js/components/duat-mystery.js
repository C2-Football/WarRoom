/* global React */
(function(root){
    'use strict';
    const App=root.App=root.App||{},h=React.createElement;
    const labels={passYd:'Passing yards',passTd:'Passing TD',passInt:'Interceptions',rushYd:'Rushing yards',rushTd:'Rushing TD',rec:'Receptions',recYd:'Receiving yards',recTd:'Receiving TD',fumblesLost:'Fumbles lost',twoPointConversions:'Two-point conversions'};
    function StatLine({stats}){
        return h('dl',{className:'duat-mystery-stats'},Object.entries(stats||{}).map(([key,value])=>h('div',{key},h('dt',null,labels[key]||key),h('dd',null,value))));
    }
    function Explorer({campaign,player,data,throughWeek=0,factionId,compact=false}){
        const [open,setOpen]=React.useState(false),[year,setYear]=React.useState(player.candidateYears?.[0]);
        const mystery=App.DuatMystery;if(!mystery?.enabled(campaign)||!mystery.isCard(player))return null;
        const info=open||throughWeek>0?mystery.inspect(campaign,player,data,{throughWeek,factionId}):null;
        const remaining=info?.archiveReady?info.remaining.length:player.candidateYears.length;
        const selected=info?.candidates.find(row=>row.year===Number(year))||info?.candidates[0];
        const clue=`${player.decade}s · ${remaining} possible ${remaining===1?'season':'seasons'}`;
        const panelId=`duat-lineup-research-${factionId}-${player.id}`;
        const content=open&&h('div',compact?{id:panelId,className:'duat-lineup-research-panel',role:'region','aria-label':`${player.name} historical research`,onKeyDown:event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);root.document?.getElementById(panelId+'-toggle')?.focus();}}}:null,
                h('p',{className:'duat-muted'},'One of these seasons was fixed when this card joined an army. The ruler’s origin year does not choose the player’s scoring year.'),
                info.revealedSeason&&h('p',{className:'duat-notice'},h('strong',null,`Final reveal: ${info.revealedSeason}`)),
                h('h4',null,'What your campaign has revealed'),
                !info.observed.length?h('p',null,'No completed games have been revealed. Every listed season remains possible.'):
                    h(React.Fragment,null,h('p',null,info.archiveReady?`${info.remaining.length} of ${info.candidates.length} seasons still match all revealed box scores.`:'Load the archive to compare the revealed box scores.'),
                        info.observed.map(line=>h('details',{key:line.week},h('summary',null,`Week ${line.week} · ${Number(line.basePoints).toFixed(2)} base points${line.hasRecordedGame?'':' · no recorded game'}`),h(StatLine,{stats:line.stats}),line.effectivePoints!==line.basePoints&&h('p',null,`After offerings: ${Number(line.effectivePoints).toFixed(2)} points. The year comparison uses the original box score.`)))),
                h('h4',null,'Candidate-season archive'),
                h('p',{className:'duat-muted'},'These are all eligible archive seasons. Matching evidence is a possibility, not a probability; exact matches can identify a year.'),
                h('label',null,'Season to inspect',h('select',{value:selected?.year||'',onChange:event=>setYear(Number(event.target.value)),'aria-label':`Inspect ${player.name} candidate season`},info.candidates.map(row=>h('option',{key:row.year,value:row.year},`${row.year}${row.compatible===false?' · ruled out by revealed games':''}`)))),
                selected&&h(React.Fragment,null,h('p',null,selected.compatible===false?`Differs in campaign ${selected.contradictions.length===1?'week':'weeks'} ${selected.contradictions.join(', ')}.`:info.observed.length?'Matches the revealed campaign box scores.':'No campaign evidence yet.'),
                    info.archiveReady?h('div',{className:'duat-table-wrap',tabIndex:0,'aria-label':`${selected.year} archive game log`},h('table',null,h('caption',null,`${player.name} · ${selected.year} · Weeks 1–17`),h('thead',null,h('tr',null,h('th',null,'Week'),h('th',null,'Points'),h('th',null,'Box score'))),h('tbody',null,selected.games.map(game=>h('tr',{key:game.week},h('th',{scope:'row'},game.week),h('td',null,game.points.toFixed(2)),h('td',null,game.hasRecordedGame?h('details',null,h('summary',null,'View stats'),h(StatLine,{stats:game.stats})):'No recorded game')))))):h('p',{role:'status'},'The candidate archive is loading.')));
        if(compact)return h(React.Fragment,null,
            h('button',{type:'button',id:panelId+'-toggle',className:'duat-lineup-research-toggle','aria-expanded':open,'aria-controls':panelId,'aria-label':`Explore ${player.name}'s possible seasons`,'aria-describedby':panelId+'-clue',onClick:()=>setOpen(!open),onKeyDown:event=>{if(event.key==='Escape'&&open){event.stopPropagation();setOpen(false);}}},
                h('span',{className:'duat-player-name'},h('strong',null,player.name),h('small',{id:panelId+'-clue'},clue)),
                h('span',{className:'duat-lineup-research-chevron','aria-hidden':true},open?'⌄':'›')),
            content||h('div',{id:panelId,hidden:true}));
        return h('details',{className:'duat-mystery-explorer',onToggle:event=>setOpen(event.currentTarget.open)},
            h('summary',null,`Explore ${clue}`),content);
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
    App.DuatMysteryUI={Explorer,Recap,StatLine};
})(typeof window!=='undefined'?window:globalThis);
