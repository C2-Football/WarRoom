'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Home=require('../js/duat/season-home.js'),Progress=require('../js/duat/weekly-progress.js'),Engine=require('../js/duat/dynasty.js'),Rules=require('../js/duat/rules.js'),Heptad=require('../js/duat/heptad.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(count=8,playoffTeams=4){
    const factions=Array.from({length:count},(_,i)=>({id:'f'+i,name:'Faction '+i,roster:'duat',armies:[],lineup:[],favorBalance:100}));
    return {id:'home-fixture',version:4,expansionVersion:1,calendarVersion:2,dynastySeason:1,phase:'season',week:1,seasons:[2025],settings:{leagueSize:count,playoffTeams,conquest:false,bench:1},factions,alliances:Array.from({length:count/2},(_,i)=>({id:'a'+i,name:'Alliance '+i,teamIds:['f'+i*2,'f'+(i*2+1)],entry:i+1})),completedWeeks:[],heptad:null,heavenly:null,playoffField:[],championId:null};
}
function record(c,week,totals,allianceTotals){
    const row={week,factions:c.factions.map((f,i)=>({factionId:f.id,season:2025,total:totals?.[i]??100-i,players:[]})),allianceScores:c.alliances.map((a,i)=>({allianceId:a.id,total:allianceTotals?.[i]??100-i}))};c.completedWeeks.push(row);c.week=week+1;c.heptad=Rules.runHeptadGauntlet(c.alliances,(id,w)=>c.completedWeeks.find(r=>r.week===w)?.allianceScores.find(a=>a.allianceId===id)?.total??null,2);row.heptad=copy(c.heptad);return row;
}
function viewed(c,count,allianceSeen=true){let p={...Progress.create(c,'f0'),reviewedThrough:0,allianceSeen};for(let w=1;w<=count;w++)for(const event of [{type:'clock',clock:60},{type:'recap-done'},{type:'conquest-done'}])p=Progress.update(p,c,'f0',{week:w,...event});return p;}
const describe=(c,p,flow={stage:'lineup',week:c.week})=>Home.describe({campaign:c,factionId:'f0',progress:p,flow});

test('alliance naming counts alliance teams rather than factions or conditional matches',()=>{
    for(const [count,name] of [[3,'Triad'],[4,'Tetrad'],[5,'Pentad'],[6,'Hexad'],[7,'Heptad'],[8,'Octad']]){assert.equal(Heptad.tournamentName(count),name);assert.equal(Heptad.tournamentName(Array(count)),name);}
    assert.equal(Heptad.tournamentName(0),'Alliance');
    const c=fixture(14,7);record(c,1);const home=describe(c,viewed(c,1));assert.equal(home.tournament.name,'Heptad');assert.equal(home.tournament.allianceCount,7);assert.equal(home.tournament.factionCount,14);assert.equal(Rules.heptadSchedule(7,2).fixtures.length,12);
});

test('a new Home keeps the alliance reveal sealed and opening it does not acknowledge anything',()=>{
    const c=fixture(),p=Progress.create(c,'f0'),before=copy({c,p}),home=describe(c,p,{stage:'alliance',week:1});assert.equal(home.visibleThroughWeek,0);assert.equal(home.resume.label,'Meet your alliance');assert(home.tournament.locked);assert.equal(home.tournament.allianceName,null);assert.equal(home.tournament.entry,null);assert.deepEqual(home.tournament.teamIds,[]);assert.deepEqual(home.tournament.progress,[]);assert.equal(home.tournament.next,null);assert(!JSON.stringify(home).includes('Alliance 0'));assert(home.standings.every(s=>s.rank===null&&s.points===0&&s.record==='0–0'));assert.deepEqual({c,p},before);
});

test('Home exposes only contiguous watched results and never reveals later standings, titles, lives or costs',()=>{
    const c=fixture();for(let w=1;w<=6;w++)record(c,w);let p=viewed(c,3);p=Progress.update(p,c,'f0',{type:'clock',week:4,clock:30});const before=copy({c,p});let home=describe(c,p,{stage:'games',week:4});assert.equal(home.visibleThroughWeek,3);assert.equal(home.currentWeek,4);assert.equal(home.pendingResultWeek,4);assert.equal(home.standings.find(f=>f.isMine).points,300);assert(!home.outlook.available);assert(home.timeline.filter(w=>w.week>=4).every(w=>w.result===null));assert.deepEqual({c,p},before);
    const visible=copy(home);c.factions[0].favorBalance=0;c.factions[0].titles=['FUTURE TITLE'];c.championId='f1';c.playoffField=['f1','f2'];c.heavenly={championId:'f1',matches:[{week:17,homeScore:999999}]};c.heptad={complete:true,championId:'a3'};c.completedWeeks[4].factions[0].total=999999;c.pinnacle={status:'complete',week:10,result:{winnerId:'a3'}};
    assert.deepEqual(describe(c,p,{stage:'games',week:4}),visible);p=Progress.update(p,c,'f0',{type:'clock',week:4,clock:60});home=describe(c,p,{stage:'recap',week:4});assert.equal(home.visibleThroughWeek,4);assert(home.outlook.available);assert.equal(home.standings.find(f=>f.isMine).points,400);assert(home.timeline[3].result);
    p=Progress.update(p,c,'f0',{type:'clock',week:6,clock:60});assert.equal(describe(c,p).visibleThroughWeek,4,'A later watched result cannot jump the unseen Week5 gap');
});

test('backup rollback invalidates stale acknowledgements and legacy progress keeps only its established history',()=>{
    const c=fixture();for(let w=1;w<=5;w++)record(c,w);const p=viewed(c,5);c.completedWeeks[3].factions[0].total=900;const home=describe(c,p,{stage:'games',week:4});assert.equal(home.visibleThroughWeek,3);assert.equal(home.standings.find(f=>f.isMine).points,300);
    for(const version of [1,2,3]){const old=copy(c);old.version=version;delete old.expansionVersion;delete old.calendarVersion;const model=describe(old,Progress.create(old,'f0'),{stage:'games',week:5});assert.equal(model.visibleThroughWeek,4);assert.equal(model.outlook.regularSeasonWeeks,14);assert.equal(model.timeline[16].roundLabel,'Championship');}
});

test('cumulative table follows canonical half-win ties and points tiebreaks while displaying truthful W-L-T records',()=>{
    const c=fixture();record(c,1,[80,80,70,60,50,40,30,-5]);record(c,2,[70,90,60,50,40,30,20,-10]);const home=describe(c,viewed(c,2)),own=home.standings.find(s=>s.isMine),canonical=Engine.computeStandings(c).find(s=>s.factionId==='f0');assert.equal(own.rank,2);assert.equal(own.winCredits,canonical.wins);assert.equal(own.wins,12);assert.equal(own.losses,1);assert.equal(own.ties,1);assert.equal(own.record,'12–1–1');assert.equal(home.standings.at(-1).points,-15);assert.equal(home.outlook.gamesBack,0);
    const zero=fixture();record(zero,1,Array(8).fill(0));const tied=describe(zero,viewed(zero,1));assert(tied.standings.every(s=>s.record==='0–0–7'&&s.winCredits===3.5&&s.points===0));
});

test('each supported league and playoff field retains the real Week17 calendar and conditional alliance reset',()=>{
    for(const count of [8,10,12,14,16])for(const playoffTeams of [2,4,6,7,8].filter(n=>n<=count)){
        const c=fixture(count,playoffTeams),home=describe(c,Progress.create(c,'f0'),{stage:'alliance',week:1}),regular=17-Math.ceil(Math.log2(playoffTeams));assert.equal(home.timeline.length,17);assert.equal(home.outlook.regularSeasonWeeks,regular);assert.equal(home.timeline[16].roundLabel,'Championship');assert.equal(home.timeline[regular-1].roundLabel,'Regular season');assert.equal(home.timeline[regular].roundLabel,playoffTeams===2?'Championship':playoffTeams===4?'Semifinals':'Quarterfinals');assert.deepEqual(home.timeline.filter(w=>w.sacred).map(w=>w.week),[5,7,10,14,15,16,17]);assert(home.timeline[0].favorNames.includes('Summon the Mahdi'));const reset=home.timeline.find(w=>w.week===3+count/2);assert(reset.events.some(e=>e.bracket==='rematch'&&e.conditional));assert(!home.timeline.some(w=>w.events.some(e=>e.bracket==='pinnacle')),'Optional unagreed challenges are not scheduled games');
    }
    const c=fixture();c.settings.favors=false;const home=describe(c,Progress.create(c,'f0'));assert(home.timeline.every(w=>!w.sacred&&!w.favorNames.length));
});

test('the tournament panel rebuilds both known paths, keeps exact live scores and never borrows current champions',()=>{
    const c=fixture();for(let w=1;w<=4;w++)record(c,w);const p=viewed(c,4);const home=describe(c,p);assert.equal(home.tournament.matches.length,2);assert.deepEqual(home.tournament.matches.map(m=>m.bracket),['top','bottom']);assert.equal(home.tournament.next.week,5);assert.equal(home.tournament.progress.find(a=>a.id==='a0').lives,2);assert.equal(home.tournament.championName,null);
    const before=copy(home.tournament);for(let w=5;w<=10;w++)record(c,w);assert.deepEqual(describe(c,p).tournament,before);const final=describe(c,viewed(c,6));assert.equal(final.tournament.championName,'Alliance 0');assert(!final.timeline[6].events.some(e=>e.bracket==='rematch'),'A revealed unbeaten championship needs no reset');
});

test('playoff outlook uses observed seeds and win-credit gaps, then revealed qualification and playoff results only',()=>{
    const c=fixture(8,2);for(let w=1;w<=17;w++)record(c,w,Array.from({length:8},(_,i)=>i*10));const early=describe(c,viewed(c,4),{stage:'lineup',week:5});assert.equal(early.outlook.status,'chasing');assert.equal(early.outlook.seed,8);assert.equal(early.outlook.gamesBack,24);assert.match(early.outlook.explanation,/all-play wins/);assert(!early.outlook.explanation.includes('%'));assert.equal(early.outlook.cutoffMargin,-24);assert.equal(early.outlook.pace.projectedWinCredits,0);assert.equal(early.outlook.pace.projectedCutoffWinCredits,96);assert.match(early.outlook.pace.explanation,/current pace/);
    c.championId='f0';c.heavenly={championId:'f0'};assert.equal(describe(c,viewed(c,15)).outlook.status,'chasing');const excluded=describe(c,viewed(c,16));assert.equal(excluded.outlook.status,'eliminated');
    const champion=fixture(8,4);for(let w=1;w<=17;w++)record(champion,w);const leader=describe(champion,viewed(champion,4)).outlook;assert.equal(leader.cutoffMargin,12);assert.equal(leader.pace.projectedWinCredits,105);assert.equal(leader.pace.projectedCutoffWinCredits,60);assert.equal(describe(champion,viewed(champion,15)).outlook.status,'qualified');assert.equal(describe(champion,viewed(champion,16)).outlook.status,'qualified');assert.equal(describe(champion,viewed(champion,17)).outlook.status,'champion');assert.equal(describe(champion,viewed(champion,17)).standingsThroughWeek,15);
});

test('Home preserves each existing Resume stage including pending recruits and earned claims',()=>{
    const c=fixture();const p=Progress.create(c,'f0');for(const stage of ['alliance','lineup','favors','kickoff','games','recap','conquest','complete']){const before=copy(p),home=describe(c,p,{stage,week:stage==='complete'?17:1});assert.equal(home.resume.stage,stage);assert.equal(home.resume.week,stage==='complete'?17:1);assert.deepEqual(p,before);}
});
