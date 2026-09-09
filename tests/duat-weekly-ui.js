'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Engine=require('../js/duat/dynasty.js'),Weekly=require('../js/duat/weekly-flow.js'),Progress=require('../js/duat/weekly-progress.js');
const Home=require('../js/duat/season-home.js');
const World=require('../js/duat/world.js'),Season=globalThis.App.TimeLeagueSeason;
const clone=value=>JSON.parse(JSON.stringify(value));
const cards=JSON.parse(fs.readFileSync('data/duat/player-cards.json','utf8')),csv=fs.readFileSync('data/duat/nflverse-game-logs.csv','utf8'),manifest=JSON.parse(fs.readFileSync('data/duat/manifest.json','utf8'));
const data={cards,manifest,logIndex:Season.buildGameLogIndex(Season.parseGameLogCsv(csv).logs)};
const fixtures=new Map();
function ready(settings={}){
    const key=JSON.stringify(settings);if(fixtures.has(key))return clone(fixtures.get(key));
    let state=Engine.createCampaign({version:4,id:'guided-ui',name:'Guided Fixture',seed:'guided-ui',createdAt:'2026-09-08T12:00:00Z',hostFactionId:'egypt',seasons:[2025],settings:{leagueSize:8,mummyCount:1,bench:1,playoffTeams:4,conquest:false,favors:false,...settings}},data);
    state=Engine.applyAction(state,{type:'start-draft'},data);
    while(state.phase==='draft'){const turn=Engine.draftTurn(state),player=Engine.draftCandidates(state,data)[0];state=Engine.applyAction(state,{type:'draft-pick',factionId:turn.factionId,playerId:player.id},data);}
    while(state.phase==='reveal')state=Engine.applyAction(state,{type:'reveal-next'},data);
    fixtures.set(key,clone(state));return state;
}
const source=Babel.transform(fs.readFileSync('js/tabs/duat.js','utf8'),{presets:['react']}).code;
const uiSource=Babel.transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code;
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.children)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';return typeof tree==='object'?text(tree.children):String(tree);}
function button(tree,label){const found=nodes(tree).find(node=>node.type==='button'&&text(node).includes(label));assert(found,'Missing button: '+label);return found;}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function harness({initial=ready(),online=false,host=true,storage=new Map(),storageFails=false}={}){
    let saved=clone(initial),changed=false,cursor=0,effectCursor=0,effects=[],tree;
    const states=[],deps=[],intervals=[],actions=[];
    if(online&&saved.phase==='complete')saved.nextSeasonYears=Engine.nextSeasonYears(saved,data);
    const room={id:'guided-room',revision:0,self:{factionId:'egypt',role:host?'host':'member'},campaign:saved,seats:[{factionId:'egypt',controller:'human',joined:true,ready:false},{factionId:'rome',controller:'human',joined:true,ready:false}],canAdvance:false};
    const React={Fragment:'fragment',createElement:(type,props,...children)=>{assert(type,'The mounted tab must not contain an unloaded component');return {type,props:props||{},children};},useMemo:fn=>fn(),useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{const next=typeof value==='function'?value(states[i]):value;if(next!==states[i]){states[i]=next;changed=true;}}];},useEffect(callback,dependencies){const i=effectCursor++;if(!deps[i]||dependencies.some((v,n)=>v!==deps[i][n]))effects.push(callback);deps[i]=dependencies;}};
    const location=new URL('https://example.test/WarRoom/index.html?duat=1'+(online?'&duat_invite=test':''));
    const store={getItem:key=>storage.get(key)||null,setItem(key,value){if(storageFails)throw Error('Quota exceeded');storage.set(key,value);},removeItem:key=>storage.delete(key)};
    const Empty=()=>null;
    const App={...globalThis.App,DuatCampaign:{...Engine,applyAction(state,action,archive){actions.push(clone(action));return Engine.applyAction(state,action,archive);}},DuatWeeklyProgress:Progress,DuatWeeklyFlow:Weekly,DuatSeasonHome:Home,DuatSeasonHomeView:function HomeView(){},DuatWorld:World,
        DuatStorage:{list:()=>[{id:saved.id,name:saved.name,factionId:'egypt',week:saved.week,phase:saved.phase}],read:()=>clone(saved),write:value=>{saved=clone(value);}},
        DuatPresentation:{nameOf:id=>World.factionById(id)?.name||id,identity:id=>World.factionById(id),art:id=>id+'.webp',Sigil(){},World(){},Tournaments(){},Land(){},Pantheon(){},Draft(){},Archaeology(){}},
        DuatHeptadUI:{RulesControls:Empty,AllianceIntro:Empty,WeeklyRecap:Empty,Games:Empty},DuatRitualsView(){},DuatLibrary(){},
        OD:{getCurrentUserId:()=>online?'viewer':null,getSessionToken:()=>online?'session':null},
        TimeLeaguePlayerCards:{buildPlayerCardIndex:value=>value},
        DuatRemote:{async request(request){
            if(request.op==='list')return {ok:true,rooms:[{id:room.id,name:'Online Fixture',phase:saved.phase,week:saved.week}]};
            if(request.op==='load')return {ok:true,room:clone(room)};
            if(request.op==='action'){
                actions.push(clone(request.action));
                if(request.action.type==='set-ready')room.seats[0].ready=request.action.ready;
                else {room.campaign=Engine.applyAction(room.campaign,request.action,data);room.seats.forEach(seat=>seat.ready=false);}
                room.canAdvance=host&&room.seats.every(seat=>seat.ready);room.revision++;saved=clone(room.campaign);
                return {ok:true,room:clone(room)};
            }
            throw Error('Unexpected remote operation');
        }}
    };
    const browser={App,location,localStorage:store,sessionStorage:store,addEventListener(){},removeEventListener(){}};
    const sandbox={window:browser,location,sessionStorage:store,React,URLSearchParams,URL,history:{replaceState(){}},crypto:{randomUUID:()=>String(Math.random())},console,
        fetch:async url=>({ok:true,json:async()=>url.includes('manifest')?manifest:cards,text:async()=>csv}),setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout:()=>0,clearTimeout(){}};
    vm.runInNewContext(uiSource,sandbox);vm.runInNewContext(source,sandbox);
    function draw(){for(let pass=0;pass<10;pass++){cursor=effectCursor=0;effects=[];changed=false;tree=browser.DuatGame({onClose(){}});effects.forEach(fn=>fn());if(!changed)return tree;}throw Error('The tab did not settle');}
    draw();await settle();await settle();draw();
    async function open(resume=true){await button(draw(),online?'Online Fixture':'Guided Fixture').props.onClick();draw();if(resume){const home=nodes(draw()).find(node=>node.type===App.DuatSeasonHomeView);assert(home,'A campaign opens its Season Home first');home.props.onResume();draw();}}
    function frame(){return nodes(draw()).find(node=>node.type===App.DuatWeeklyUI.Frame)?.props;}
    async function primary(){const control=frame().primary;assert(!control.disabled,control.label+' is disabled');await control.onClick();return draw();}
    return {App,draw,open,frame,primary,actions,storage,room,saved:()=>saved,async poll(){for(const fn of intervals)await fn();return draw();},component(type){return nodes(draw()).find(node=>node.type===type)?.props;}};
}

test('the mounted solo tab guides alliance, valid lineup, games, recap and next preparation with one engine advance',async()=>{
    const page=await harness();assert.match(text(page.draw()),/Build a dynasty/);await page.open();
    assert.equal(page.frame().stage,'alliance');await page.primary();assert.equal(page.frame().stage,'lineup');
    const prep=page.component(page.App.DuatWeeklyUI.Preparation),original=prep.lineup;
    prep.onChange(original.slice(1));assert(page.frame().primary.disabled,'An incomplete lineup cannot be confirmed');
    page.component(page.App.DuatWeeklyUI.Preparation).onChange(original);await page.primary();assert.equal(page.frame().stage,'kickoff');
    await page.primary();assert.equal(page.saved().week,2);assert.equal(page.frame().stage,'games');assert.equal(page.frame().week,1);
    assert(!text(page.draw()).includes('Explore the realm'),'No standings or Heptad spoilers during the replay');
    await page.primary();assert.equal(page.frame().stage,'recap');
    const recap=page.component(page.App.DuatWeeklyUI.Recap);assert.equal(recap.week,1);assert.equal(recap.result.allPlay.fieldSize,8);
    await page.primary();assert.equal(page.frame().stage,'lineup');assert.equal(page.frame().week,2);
    assert.equal(page.actions.filter(action=>action.type==='advance-week').length,1);
    const reopened=await harness({initial:page.saved(),storage:page.storage});await reopened.open();assert.equal(reopened.frame().stage,'lineup');assert.equal(reopened.frame().week,2);
});

test('host and friend preparation respects shared readiness without allowing a friend to advance',async()=>{
    for(const host of [true,false]){
        const page=await harness({online:true,host});await page.open();await page.primary();await page.primary();
        assert.match(page.frame().primary.label,/Mark ready/);await page.primary();
        assert(page.frame().primary.disabled);assert.equal(page.actions.filter(action=>action.type==='advance-week').length,0);
        page.room.seats[1].ready=true;page.room.canAdvance=host;page.room.revision++;await page.poll();
        if(host){assert.match(page.frame().primary.label,/Start Week 1/);await page.primary();assert.equal(page.frame().stage,'games');}
        else {assert.match(page.frame().primary.label,/Waiting for the host/);assert(page.frame().primary.disabled);}
    }
});

test('a remote result stays on its viewed week through polling, and refreshed progress resumes the same playback',async()=>{
    const page=await harness({online:true,host:false});await page.open();await page.primary();await page.primary();await page.primary();
    page.room.campaign=Engine.applyAction(page.room.campaign,{type:'advance-week'},data);page.room.seats.forEach(seat=>seat.ready=false);page.room.revision++;
    await page.poll();assert.equal(page.frame().stage,'games');assert.equal(page.frame().week,1);
    const game=nodes(page.draw()).find(node=>node.type?.name==='GameDay');game.props.onProgress(27);
    page.room.revision++;await page.poll();assert.equal(page.frame().week,1);
    const reopened=await harness({initial:page.room.campaign,online:true,host:false,storage:page.storage});await reopened.open();
    assert.equal(reopened.frame().stage,'games');assert.equal(reopened.frame().week,1);
    assert.equal(nodes(reopened.draw()).find(node=>node.type?.name==='GameDay').props.initialClock,27);
});

test('presentation storage failure keeps the mounted weekly sequence usable in memory',async()=>{
    const page=await harness({storageFails:true});await page.open();await page.primary();await page.primary();
    assert.equal(page.frame().stage,'kickoff');await page.primary();await page.primary();assert.equal(page.frame().stage,'recap');
    await page.primary();assert.equal(page.frame().stage,'lineup');assert.equal(page.frame().week,2);
});

test('a changed legal lineup is saved before kickoff and a preseason recruit cannot be skipped',async()=>{
    const page=await harness({initial:ready({favors:true,bench:3})});await page.open();await page.primary();
    const prep=page.component(page.App.DuatWeeklyUI.Preparation),faction=page.saved().factions.find(f=>f.id==='egypt'),army=Engine.activeArmy(faction);
    const bench=army.players.find(p=>!prep.lineup.includes(p.id)&&p.position!=='QB'),out=army.players.find(p=>prep.lineup.includes(p.id)&&p.position!=='QB');
    const changed=prep.lineup.filter(id=>id!==out.id).concat(bench.id);prep.onChange(changed);assert.match(page.frame().primary.label,/Save and confirm/);
    await page.primary();assert.equal(page.actions.at(-1).type,'set-lineup');assert.deepEqual([...page.saved().factions.find(f=>f.id==='egypt').lineup].sort(),[...changed].sort());
    assert.equal(page.frame().stage,'favors');
    const temple=page.component(page.App.DuatRitualsView);assert(temple.guided);assert(temple.eligibleIds.includes('summon-mahdi'));
    await temple.onAction({type:'ritual',ritualId:'summon-mahdi',position:'WR'});
    assert.equal(page.frame().stage,'favors');assert(page.frame().primary.disabled,'A waiting recruit cannot be skipped');
    await page.component(page.App.DuatRitualsView).onAction({type:'ritual',ritualId:'mahdi-decline'});
    if(page.frame().stage==='favors')await page.primary();assert.equal(page.frame().stage,'kickoff');
});

test('the war council holds an earned claim, then next preparation performs no second kickoff',async()=>{
    let state=ready({conquest:true});for(let guard=0;guard<5&&!Engine.unresolvedClaims(state).includes('egypt');guard++)state=Engine.applyAction(state,{type:'advance-week'},data);
    assert(Engine.unresolvedClaims(state).includes('egypt'),'Actual weekly scores must earn a human claim in this fixture');
    const page=await harness({initial:state});await page.open();await page.primary();assert.equal(page.frame().stage,'recap');await page.primary();
    assert.equal(page.frame().stage,'conquest');assert(page.frame().primary.disabled);
    const map=page.component(page.App.DuatPresentation.World);assert(map.guided);
    const territoryId=globalThis.App.DuatConquest.eligibleTerritories(state.conquest,'egypt')[0];assert(territoryId);
    await map.onAction({type:'claim',territoryId});
    while(Engine.unresolvedClaims(page.saved()).includes('egypt')){const target=globalThis.App.DuatConquest.eligibleTerritories(page.saved().conquest,'egypt')[0];assert(target);await page.component(page.App.DuatPresentation.World).onAction({type:'claim',territoryId:target});}
    assert(!page.frame().primary.disabled);await page.primary();assert.equal(page.frame().stage,'lineup');assert.equal(page.frame().week,state.week);
    assert.equal(page.actions.filter(action=>action.type==='advance-week').length,0);
    const restored=await harness({initial:state,storage:page.storage});await restored.open();await restored.primary();
    assert.equal(restored.frame().stage,'kickoff');assert(restored.frame().primary.disabled);
    assert.equal(restored.frame().secondary.label,'Return to your war council');await restored.frame().secondary.onClick();
    assert.equal(restored.frame().stage,'conquest','Restoring unspent claims cannot leave kickoff at a dead end.');
});

test('final shared report reaches an explicit readiness gate and only then continues the dynasty',async()=>{
    let state=ready();while(state.phase==='season')state=Engine.applyAction(state,{type:'advance-week'},data);
    const page=await harness({initial:state,online:true});await page.open();assert.equal(page.frame().week,17);assert.equal(page.frame().stage,'games');
    assert(!text(page.draw()).includes('LORD OF THE DUAT'),'The completion banner cannot spoil the final replay');
    await page.primary();await page.primary();assert.equal(page.frame(),undefined);assert(text(page.draw()).includes('LORD OF THE DUAT'));
    await button(page.draw(),'Mark ready for the next dynasty').props.onClick();assert(button(page.draw(),'Waiting for the other factions').props.disabled);
    page.room.seats[1].ready=true;page.room.canAdvance=true;page.room.revision++;await page.poll();
    assert(!button(page.draw(),'Continue dynasty · Season 2').props.disabled);await button(page.draw(),'Continue dynasty · Season 2').props.onClick();assert.equal(page.saved().dynastySeason,2);assert.equal(page.saved().phase,'draft');
});

test('existing v1, v2 and v3 saves enter the guided week and preserve their original scored rules',async()=>{
    const Legacy=require('../js/duat/campaign.js');
    for(const version of [1,2,3]){
        let state=Legacy.createCampaign({version,id:'guided-legacy-'+version,name:'Guided Fixture',seed:'legacy-flow-'+version,createdAt:'2026-09-08T12:00:00Z',hostFactionId:'egypt',seasons:version===3?[2025]:[2025,2024,2023,2022],settings:{leagueSize:8,mummyCount:1,bench:1,playoffTeams:4,conquest:false,favors:false}},data);
        if(state.phase==='preseason')state=Legacy.applyAction(state,{type:'reveal-rulers'},data);
        else {
            state=Legacy.applyAction(state,{type:'start-draft'},data);
            while(state.phase==='draft'){const turn=Legacy.draftTurn(state),player=Legacy.draftCandidates(state,data)[0];state=Legacy.applyAction(state,{type:'draft-pick',factionId:turn.factionId,playerId:player.id},data);}
            while(state.phase==='reveal')state=Legacy.applyAction(state,{type:'reveal-next'},data);
        }
        const baseline=Legacy.applyAction(state,{type:'advance-week'},data),page=await harness({initial:state});
        await page.open();assert.equal(page.frame().stage,'alliance');await page.primary();await page.primary();
        if(page.frame().stage==='favors')await page.primary();assert.equal(page.frame().stage,'kickoff');
        await page.primary();assert.equal(page.frame().stage,'games');assert.equal(page.frame().week,1);assert.equal(page.saved().version,version);
        assert.deepEqual(page.saved().completedWeeks,baseline.completedWeeks,'The presentation must not modify legacy scoring or outcomes.');
        await page.primary();assert.equal(page.frame().stage,'recap');assert.equal(page.component(page.App.DuatWeeklyUI.Recap).result.week,1);
    }
});


test('Season Home opens without advancing and Resume returns to the exact paused Game Day',async()=>{
    const page=await harness();await page.open(false);let home=page.component(page.App.DuatSeasonHomeView);assert(home.model.tournament.locked);assert.equal(home.model.visibleThroughWeek,0);assert.equal(page.frame(),undefined);assert.equal(page.actions.length,0);
    home.onResume();assert.equal(page.frame().stage,'alliance');await page.primary();await page.primary();await page.primary();assert.equal(page.frame().stage,'games');
    const game=nodes(page.draw()).find(node=>node.type?.name==='GameDay');game.props.onProgress(27);
    button(page.draw(),'Season Home').props.onClick();home=page.component(page.App.DuatSeasonHomeView);const saved=JSON.stringify(page.saved()),presentation=JSON.stringify([...page.storage]);assert.equal(home.model.visibleThroughWeek,0);assert.equal(home.model.currentWeek,1);assert.equal(home.model.resume.stage,'games');assert(!nodes(page.draw()).some(node=>node.type?.name==='GameDay'));assert.equal(page.frame(),undefined);
    await page.poll();assert(page.component(page.App.DuatSeasonHomeView));assert.equal(JSON.stringify(page.saved()),saved);assert.equal(JSON.stringify([...page.storage]),presentation);home.onResume();assert.equal(page.frame().stage,'games');assert.equal(nodes(page.draw()).find(node=>node.type?.name==='GameDay').props.initialClock,27);assert.equal(page.actions.filter(a=>a.type==='advance-week').length,1);
});

test('shared polling keeps Home selected, conceals a newly scored week and preserves readiness when resumed',async()=>{
    const page=await harness({online:true,host:false});await page.open();await page.primary();await page.primary();await page.primary();button(page.draw(),'Season Home').props.onClick();let home=page.component(page.App.DuatSeasonHomeView);assert.equal(home.model.resume.stage,'kickoff');
    page.room.campaign=Engine.applyAction(page.room.campaign,{type:'advance-week'},data);page.room.seats.forEach(s=>s.ready=false);page.room.revision++;await page.poll();home=page.component(page.App.DuatSeasonHomeView);assert(home);assert.equal(home.model.visibleThroughWeek,0);assert.equal(home.model.resume.stage,'games');assert.equal(home.model.resume.week,1);assert.equal(page.frame(),undefined);assert(!home.onExplore);assert(home.model.standings.every(s=>s.points===0));home.onResume();assert.equal(page.frame().week,1);assert.equal(page.frame().stage,'games');assert.equal(page.actions.filter(a=>a.type==='advance-week').length,0);
});

test('Home Resume cannot skip a pending Mahdi draw or an unresolved war council',async()=>{
    const page=await harness({initial:ready({favors:true,bench:3})});await page.open();await page.primary();await page.primary();await page.component(page.App.DuatRitualsView).onAction({type:'ritual',ritualId:'summon-mahdi',position:'WR'});assert(page.frame().primary.disabled);button(page.draw(),'Season Home').props.onClick();const home=page.component(page.App.DuatSeasonHomeView);assert.equal(home.model.resume.stage,'favors');const before=JSON.stringify(page.saved());home.onResume();assert.equal(page.frame().stage,'favors');assert(page.frame().primary.disabled);assert.equal(JSON.stringify(page.saved()),before);
    let state=ready({conquest:true});for(let n=0;n<5&&!Engine.unresolvedClaims(state).includes('egypt');n++)state=Engine.applyAction(state,{type:'advance-week'},data);const war=await harness({initial:state});await war.open();await war.primary();await war.primary();assert.equal(war.frame().stage,'conquest');assert(war.frame().primary.disabled);button(war.draw(),'Season Home').props.onClick();const warHome=war.component(war.App.DuatSeasonHomeView);assert.equal(warHome.model.resume.stage,'conquest');warHome.onResume();assert(war.frame().primary.disabled);assert.equal(war.actions.filter(a=>a.type==='advance-week').length,0);
});
