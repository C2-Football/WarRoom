#!/usr/bin/env node
'use strict';
// Real historical games, disposable local saves, and a network mutation deny rule.
// No hosted account or shared backend state is created or changed by this suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/vault-phone-density');
fs.mkdirSync(output, { recursive: true });
const entry = new URL(process.env.VAULT_DENSITY_URL || process.env.READINESS_PREVIEW_URL
 || process.env.READINESS_PREVIEW_PATH || '/dist-preview/', process.env.READINESS_PREVIEW_ORIGIN || 'http://127.0.0.1:3025');
if(['localhost','127.0.0.1'].includes(entry.hostname))entry.searchParams.set('dev', 'true');
else entry.searchParams.delete('dev'); // Hosted checks exercise the public guest route.
entry.searchParams.set('vault', '1');
const phase = process.env.VAULT_DENSITY_PHASE || 'after';
const widths = process.env.VAULT_DENSITY_WIDTHS?.split(',').map(Number) || [320, 390, 667, 1440];
global.window=globalThis;global.App={};
for(const name of ['roster','helmet','rules','draft-room','era-rules','types','season','player-cards','engine','hidden-years','strategy','rivals','ai','actions','gamecast','player-stats','storage']) require('../js/shared/time-league-'+name+'.js');
const E=App.TimeLeagueEngine,A=App.TimeLeagueActions,S=App.TimeLeagueSeason,AI=App.TimeLeagueAI,P=App.TimeLeaguePlayerCards;
const data={cards:P.buildPlayerCardIndex(JSON.parse(fs.readFileSync(path.join(root,'data/time-league/player-cards.json')))),logIndex:S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync(path.join(root,'data/time-league/regular-season-game-logs.csv'),'utf8')).logs),eraFactors:new Map()};
let state=E.normalizeTimeLeague(E.createTimeLeague({name:'My Vault Season',seed:'phone-density-real-archive',createdAt:'2026-09-25T12:00:00Z',seats:[{name:'Commander',manager:'human'},...Array.from({length:5},(_,i)=>E.defaultAiSeat(i+1))],settings:{gameDeckVersion:1,hiddenYears:true,rosterSlots:{QB:1,RB:2,WR:2,TE:1,FLEX:1,BN:5},maxQuarterbacks:2,regularSeasonWeeks:12,playoffTeams:4,scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2},eraRules:{mode:'any-era',decades:[]},waiversEnabled:true,waiverMode:'faab',faabBudget:100,tradesEnabled:true,aiDifficulty:'veteran',draftPickSeconds:0}}));
const act=action=>{state=A.applyOnlineAction(state,action,{seat_team_id:'t1',role:'commissioner'},data,'2026-09-25T12:00:00Z');state=E.normalizeTimeLeague(JSON.parse(JSON.stringify(state)));};
act({type:'draft-clock-start'});while(state.phase==='draft'){if(E.currentDraftSeat(state).teamId==='t1'){const choice=AI.aiDraftChoice(state,data.cards);if(!choice)throw Error('no legal choice');act({type:'draft',identity:choice.identity});}else act({type:'ai-run'});}
act({type:'process-claims'});act({type:'finalize-rosters'});act({type:'week'});act({type:'advance-week'});
// Keep an actually unplayed, newly acquired RB beside observed averages.
const drop=state.teams[0].roster.find(e=>e.slot==='BN');const free=E.freeAgents(state,data.cards).find(c=>c.position==='RB'&&c.seasons.length>5);
act({type:'claim',teamId:'t1',identity:free.identity,dropEntryId:drop.entryId,bidAmount:0});act({type:'process-claims'});
const candidate=state.teams[0].roster.find(e=>e.identity===free.identity);const replacement=state.teams[0].roster.find(e=>e.slot==='RB');state=E.setEntrySlot(state,'t1',candidate.entryId,replacement.slot,replacement.entryId);
assert.equal(state.currentWeek, 2); assert.equal(state.weekStage, 'lineup');
assert.equal(state.finalizedWeeks.length, 1); assert.equal(state.draftPicks.length, 72);
const original = JSON.parse(JSON.stringify(state));
const team = state.teams.find(t => t.teamId === 't1');
const observed = team.roster.find(e => e.name === 'Tom Brady');
const estimated = team.roster.find(e => e.name === 'Emmitt Smith');
const bench = team.roster.find(e => e.name === 'LaDainian Tomlinson');
const observedRead = App.TimeLeaguePlayerStats.signals(state, observed, data.logIndex, data.eraFactors);
const estimatedRead = App.TimeLeagueHiddenYears.read(state, estimated, data.cards, data.logIndex, undefined, data.eraFactors);
assert.equal(observedRead.games, 1); assert.equal(App.TimeLeaguePlayerStats.signals(state, estimated, data.logIndex, data.eraFactors).games, 0);
assert(Number.isFinite(estimatedRead.estimatedAverage));
const median = nums => [...nums].sort((a,b)=>a-b)[Math.floor(nums.length/2)];
function publicYear(league, player, throughWeek) {
 const read=App.TimeLeagueHiddenYears.read(league,player,data.cards,data.logIndex,throughWeek,data.eraFactors);
 return league.seasonsRevealed&&!league.yearsRevealed&&read.candidateYears.length===1&&Number.isInteger(read.candidateYears[0])?read.candidateYears[0]:null;
}
async function checkPublicYear(locator, league, player, throughWeek, stage) {
 // The oracle is the public candidate set, never the private assigned year.
 const year=publicYear(league,player,throughWeek);
 if(year!=null)await expect.poll(()=>locator.innerText(),{message:`${stage}: ${player.name}'s sole public candidate is visibly named`,timeout:30000}).toContain(String(year));
 const text=await locator.innerText(),shown=[...new Set(text.match(/\b(?:19|20)\d{2}\b/g)||[])];
 assert.deepEqual(shown,year==null?[]:[String(year)],`${stage}: ${player.name} exposes exactly its public inference`);
 return {entryId:player.entryId,name:player.name,throughWeek,year};
}
async function checkLineupYears(lineups, league, throughWeek, stage) {
 const checked=[];
 for(const row of await lineups.locator('.tl-live-player[data-entry-id]').all()) {
  const entryId=await row.getAttribute('data-entry-id');
  const player=league.teams.flatMap(team=>team.roster).find(entry=>entry.entryId===entryId)
   ||league.finalizedWeeks.flatMap(week=>week.results.flatMap(result=>result.starters)).find(entry=>entry.entryId===entryId);
  assert(player,`${stage}: displayed player ${entryId} has a public edition`);
  checked.push(await checkPublicYear(row.locator('.tl-live-player-edition'),league,player,throughWeek,stage));
 }
 assert(checked.length>0,`${stage}: player labels were checked`);
 return checked;
}
async function size(locator) { return locator.evaluate(node => { const r=node.getBoundingClientRect(); const style=getComputedStyle(node); return {x:r.x,y:r.y,width:r.width,height:r.height,fontSize:parseFloat(style.fontSize)}; }); }
async function hit(locator, label) {
 // Center content controls in the viewport; nearest scrolling does not account
 // for the fixed game-action bar and dock. The subsequent click is never forced.
 await locator.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest'}));
 const r=await locator.evaluate(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,inView:r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1,hit:node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),top:r.top,bottom:r.bottom,interceptor:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.className};});
 // Phone controls need touch-sized targets. Preserve the existing desktop
 // pointer layout (its menu icons use24px+ widths), while still hit-testing it.
 const minimum=locator.page().viewportSize().width<768?44:24;
 assert(r.width>=minimum&&r.height>=minimum,`${label}: at least${minimum}px target ${JSON.stringify(r)}`);
 assert(r.inView&&r.hit,`${label}: normal pointer click is unobstructed ${JSON.stringify(r)}`);
}
async function layout(page) {
 const value=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,header:document.querySelector('.tl-league-bar').getBoundingClientRect().toJSON(),footer:document.querySelector('.tl-week-action-row').getBoundingClientRect().toJSON(),dock:document.querySelector('.tl-mobile-nav').getBoundingClientRect().toJSON()}));
 assert(!value.overflow,'No page horizontal overflow');return value;
}
async function matchupTextFits(lineups, width, stage) {
 if(width>=768)return;
 const collisions=await lineups.locator('.tl-live-player[data-entry-id]').evaluateAll(nodes=>nodes.flatMap(node=>{
  const rect=element=>{const range=document.createRange();range.selectNodeContents(element);return range.getBoundingClientRect();};
  const points=rect(node.querySelector('.tl-live-player-points')),edition=rect(node.querySelector('.tl-live-edition-compact'));
  const overlapX=Math.min(points.right,edition.right)-Math.max(points.left,edition.left),overlapY=Math.min(points.bottom,edition.bottom)-Math.max(points.top,edition.top);
  return overlapX>0.5&&overlapY>0.5?[{player:node.querySelector('.tl-live-player-name strong').textContent,points:node.querySelector('.tl-live-player-points').textContent,edition:node.querySelector('.tl-live-edition-compact').textContent,overlapX,overlapY}]:[];
 }));
 assert.deepEqual(collisions,[],`${stage}: score and decade/position must not collide inside player cells`);
}
async function save(page) { return page.evaluate(id => App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(id))), original.leagueId); }
(async()=>{
 const vendors = new Map();
 for(const file of ['react@18.3.1/umd/react.production.min.js','react-dom@18.3.1/umd/react-dom.production.min.js','@supabase/supabase-js@2.101.1/dist/umd/supabase.min.js']) {
  const url='https://cdn.jsdelivr.net/npm/'+file, response=await fetch(url,{signal:AbortSignal.timeout(20000)});assert(response.ok);vendors.set(url,await response.text());
 }
 const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath=process.env.PLAYWRIGHT_CHROME_PATH||(fs.existsSync(macChrome)?macChrome:undefined);
 const browser=await chromium.launch({headless:true,executablePath});
 const evidence=[]; let currentPage=null, currentWidth=null;
 const writeEvidence=passed=>fs.writeFileSync(`${output}/${phase}-evidence.json`,JSON.stringify({target:entry.origin+entry.pathname,fixture:'Real 72-pick, 6-team Hidden Years season; Week 1 completed, legal Week 2 free-agent claim; isolated local saves only',plannedWidths:widths,passed,evidence},null,2));
 writeEvidence(false);
 try { for(const width of widths) {
  const height=({320:740,390:844,667:375,1440:1000})[width]; assert(height);
  const context=await browser.newContext({viewport:{width,height}}), blocked=[];
  // Install the deny rule before creating the page or injecting a save.
  await context.route('**/*', route=>{
   const req=route.request(),url=new URL(req.url());
   if(!['GET','HEAD'].includes(req.method())) {blocked.push({method:req.method(),host:url.hostname,path:url.pathname});return route.abort();}
   if(url.origin===entry.origin&&!url.pathname.startsWith('/api/'))return route.continue();
   if(vendors.has(url.href))return route.fulfill({status:200,contentType:'application/javascript',body:vendors.get(url.href)});
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({status:200,contentType:'text/css',body:''});
   blocked.push({method:req.method(),host:url.hostname,path:url.pathname});return route.abort();
  });
  await context.addInitScript(state=>{
   const key='wr-time-league-v1:'+state.leagueId;
   if(localStorage.getItem(key))return;
   localStorage.setItem(key,JSON.stringify(state));
   localStorage.setItem('wr-time-leagues-v1',JSON.stringify([{leagueId:state.leagueId,name:state.name,phase:state.phase,teamCount:state.teams.length,currentWeek:state.currentWeek,createdAt:state.createdAt}]));
   localStorage.setItem('wr-time-league-ui-v1',JSON.stringify({leagueId:state.leagueId,teamId:'t1',tab:'roster'}));
  },original);
  const page=await context.newPage(),errors=[];currentPage=page;currentWidth=width;page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(entry.href,{waitUntil:'domcontentloaded',timeout:60000});
  const rows=page.locator('.tl-lineup-row'); await rows.first().waitFor({timeout:60000});
  const observedRow=rows.filter({has:page.getByRole('button',{name:`Explore ${observed.name}'s history`,exact:true})});
  const estimatedRow=rows.filter({has:page.getByRole('button',{name:`Explore ${estimated.name}'s history`,exact:true})});
  await page.waitForFunction(()=>document.querySelector('.tl-player-average strong')?.textContent!=='—');
  assert.equal((await observedRow.locator('.tl-player-average strong').innerText()).trim(),observedRead.average.toFixed(1));
  assert.equal((await estimatedRow.locator('.tl-player-average strong').innerText()).trim(),estimatedRead.estimatedAverage.toFixed(1));
  assert.match(await observedRow.locator('.tl-player-average').getAttribute('title'),/recorded completed Vault game/);
  assert.match(await estimatedRow.locator('.tl-player-average').getAttribute('title'),/Archive estimate.*no completed Vault games/);
  assert.match(await observedRow.locator('.tl-player-average').innerText(),/PPG|Avg pts/);
  assert.match(await estimatedRow.locator('.tl-player-average').innerText(),/est\.|estimate/i);
  const yearChecks={roster:[]};
  for(const player of team.roster) {
   const row=rows.filter({has:page.getByRole('button',{name:`Explore ${player.name}'s history`,exact:true})});
   yearChecks.roster.push(await checkPublicYear(row.locator('.tl-roster-player-link .meta'),original,player,1,'Roster'));
   await checkPublicYear(row.locator('.tl-player-outlook'),original,player,1,'Roster signal');
  }
  assert(yearChecks.roster.some(item=>item.year!=null)&&yearChecks.roster.some(item=>item.year==null),'The real roster exercises identified and ambiguous players');
  const rosterHeights=await rows.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  const nameSize=await size(observedRow.locator('.name'));
  if(width<768) {
   assert(nameSize.fontSize>=15,'Phone player names remain readable');
   const supportFonts=await page.locator('.tl-roster-player-link .meta:visible, .tl-roster-signals small:visible').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
   assert(supportFonts.every(font=>font>=13),'Phone supporting text stays at least13px');
  }
  await hit(observedRow.getByRole('button',{name:`Explore ${observed.name}'s history`,exact:true}),'Player history');
  await hit(observedRow.getByRole('button',{name:`Move ${observed.name}`,exact:true}),'Move');
  await rows.first().scrollIntoViewIfNeeded();
  const rosterLayout=await layout(page);
  await page.screenshot({path:`${output}/${phase}-roster-${width}.png`});
  // Public inference can identify an edition before the official final reveal.
  // The historical dossier must still explain the completed games behind it.
  await observedRow.getByRole('button',{name:`Explore ${observed.name}'s history`,exact:true}).click();
  const dossier=page.getByRole('complementary',{name:'Historical player dossier'}); await dossier.waitFor();
  assert.match(await dossier.innerText(),/Completed game log/);
  assert.match(await dossier.innerText(),new RegExp(`Vault W1 · ${observedRead.average.toFixed(1).replace('.','\\.')} pts`));
  assert(!/Your edition:/.test(await dossier.innerText()));
  await hit(dossier.getByRole('button',{name:'Close player history',exact:true}),'Close history');
  await dossier.getByRole('button',{name:'Close player history',exact:true}).click();
  await estimatedRow.getByRole('button',{name:`Move ${estimated.name}`,exact:true}).click();
  const sheet=page.getByRole('dialog',{name:`Move ${estimated.name}`,exact:true});await sheet.waitFor();
  assert.match(await sheet.locator('.tl-roster-current-player .tl-player-average').getAttribute('title'),/Archive estimate/);
  yearChecks.move=[await checkPublicYear(sheet.locator('.tl-roster-current-player .tl-player-outlook'),original,estimated,1,'Move current player')];
  for(const candidateRow of await sheet.locator('.tl-roster-candidate').all()) {
   const name=await candidateRow.locator('.tl-roster-candidate-player strong').innerText(),player=team.roster.find(entry=>entry.name===name);
   assert(player,`Move candidate ${name} belongs to the public roster`);
   yearChecks.move.push(await checkPublicYear(candidateRow.locator('.tl-roster-candidate-player small').first(),original,player,1,'Move candidate'));
   await checkPublicYear(candidateRow.locator('.tl-player-outlook'),original,player,1,'Move candidate signal');
  }
  await hit(sheet.getByRole('button',{name:'Close lineup choices',exact:true}),'Close Move');
  await page.screenshot({path:`${output}/${phase}-move-${width}.png`});
  await page.keyboard.press('Escape'); await sheet.waitFor({state:'hidden'});
  await estimatedRow.getByRole('button',{name:`Move ${estimated.name}`,exact:true}).click();
  const swap=page.getByRole('button',{name:`Swap ${estimated.name} with ${bench.name}`,exact:true});
  await hit(swap,'Atomic lineup swap');await swap.click();
  await page.waitForFunction(({id,eid})=>{const s=App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(id)));return s.teams[0].roster.find(e=>e.entryId===eid).slot==='BN';},{id:original.leagueId,eid:estimated.entryId});
  await page.reload({waitUntil:'domcontentloaded'});await rows.first().waitFor({timeout:60000});
  const afterSwap=await save(page),own=afterSwap.teams.find(t=>t.teamId==='t1');
  assert.equal(own.roster.find(e=>e.entryId===estimated.entryId).slot,'BN');
  assert.equal(own.roster.find(e=>e.entryId===bench.entryId).slot,'RB');
  assert.deepEqual(own.roster.map(e=>e.entryId).sort(),team.roster.map(e=>e.entryId).sort());
  const nav=page.locator(width<768?'.tl-mobile-nav':'.tl-sidenav');
  await nav.getByRole('button',{name:/^Game.?day$/i}).click();
  const lineups=page.locator('.tl-live-lineups');await lineups.scrollIntoViewIfNeeded();
  const zeroes=await lineups.locator('.tl-live-player-points').allInnerTexts();assert(zeroes.length>0&&zeroes.every(t=>t==='0.00'),'Pregame reveals no saved or future scores');
  yearChecks.pregame=await checkLineupYears(lineups,afterSwap,1,'Pregame');
  const matchupHeights=await lineups.locator('.tl-live-lineup-row').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  await matchupTextFits(lineups,width,'Pregame');
  const gamedayLayout=await layout(page);await page.screenshot({path:`${output}/${phase}-gameday-${width}.png`});
  if(width<768) {
   assert(median(rosterHeights)<=124,`Phone roster density: median ${median(rosterHeights)}px exceeds124px`);
   assert(median(matchupHeights)<=112,`Phone matchup density: median ${median(matchupHeights)}px exceeds112px`);
   assert((await lineups.innerText()).split('Awaiting kickoff').length-1<=1,'Pregame status is stated once instead of per player');
   for(const button of await page.locator('.tl-mobile-nav > button').all())await hit(button,'Phone navigation');
  }
  const options=page.getByRole('button',{name:'Week options',exact:true});
  await hit(options,'Week options');await options.click();
  await page.locator('#vault-week-options').waitFor();
  assert.equal(await page.locator('#vault-week-options .tl-stage-track li').count(),4);
  const lastStage=page.locator('#vault-week-options .tl-stage-track li').last();
  await lastStage.evaluate(node=>node.scrollIntoView({block:'nearest'}));
  assert(await lastStage.evaluate(node=>{const r=node.getBoundingClientRect(),p=node.closest('#vault-week-options').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;}),'Last week stage remains reachable within menu scroll');
  await page.screenshot({path:`${output}/${phase}-week-options-${width}.png`});
  const closeOptions=page.getByRole('button',{name:'Close week options',exact:true});await hit(closeOptions,'Close week options');await closeOptions.click();
  if(width===667) {
   assert(gamedayLayout.footer.height+gamedayLayout.dock.height<=120,'Short-landscape fixed actions leave room to read the lineup');
   await page.locator('.tl-root').evaluate(node=>node.style.setProperty('--sat','24px'));
   await options.click();await hit(closeOptions,'Close week options with emulated24px top safe area');
   assert(await closeOptions.evaluate(node=>node.getBoundingClientRect().top>=document.querySelector('.tl-league-bar').getBoundingClientRect().bottom),'Emulated safe-area menu close remains below sticky header');
   await page.screenshot({path:`${output}/${phase}-safe-top-${width}.png`});
   await closeOptions.click();await page.locator('.tl-root').evaluate(node=>node.style.removeProperty('--sat'));
  }
  await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Set lineup',exact:true}).click();
  const lock=page.locator('.tl-week-action-buttons').getByRole('button',{name:'Lock lineup',exact:true});await hit(lock,'Lock lineup');await lock.click();
  const kickoff=page.locator('.tl-week-action-buttons').getByRole('button',{name:'Start game day',exact:true});await hit(kickoff,'Start game day');await kickoff.click();
  const quarter=page.locator('.tl-week-action-buttons').getByRole('button',{name:'Next quarter',exact:true});await hit(quarter,'Next quarter');await quarter.click();
  await page.waitForFunction(()=>document.querySelector('.tl-cast-clock')?.textContent==='END Q1');
  const played=await save(page),week=played.finalizedWeeks.find(w=>w.week===2);
  const timeline=App.TimeLeagueGamecast.buildGamecast({...week,seed:played.seed,scoring:played.settings.scoring,simulatedAvailability:true});
  const cents=new Map();for(const event of timeline.events.filter(e=>e.t<=15))cents.set(event.entryId,(cents.get(event.entryId)||0)+Math.round(event.points*100));
  const shown=await lineups.locator('.tl-live-player[data-entry-id]').evaluateAll(nodes=>nodes.map(node=>({entryId:node.dataset.entryId,points:node.querySelector('.tl-live-player-points').textContent})));
  for(const item of shown)assert.equal(item.points,((cents.get(item.entryId)||0)/100).toFixed(2),'Playback renders landed moments only');
  assert(shown.some(item=>Number(item.points)!==week.results.flatMap(r=>r.starters).find(e=>e.entryId===item.entryId).points),'Quarter1 is not the final score');
  yearChecks.quarter1=await checkLineupYears(lineups,played,1,'Quarter1');
  assert.deepEqual(yearChecks.quarter1,yearChecks.pregame,'Precomputed Week2 results do not change public year labels before the final whistle');
  await matchupTextFits(lineups,width,'Quarter1');
  await lineups.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${phase}-playback-${width}.png`});
  // Checking these normal clicks catches fixed overlays intercepting controls,
  // including the375px-high landscape case missed by geometry-only tests.
  await hit(page.locator('.tl-week-action-buttons').getByRole('button',{name:'Resume',exact:true}),'Resume playback');
  await page.getByRole('button',{name:'INSTANT',exact:true}).click();
  await nav.getByRole('button',{name:/^Game.?day$/i}).click();
  await lineups.waitFor();
  await matchupTextFits(lineups,width,'Final');
  const finalShown=await lineups.locator('.tl-live-player[data-entry-id]').evaluateAll(nodes=>nodes.map(node=>({entryId:node.dataset.entryId,points:node.querySelector('.tl-live-player-points').textContent})));
  for(const item of finalShown)assert.equal(item.points,week.results.flatMap(r=>r.starters).find(e=>e.entryId===item.entryId).points.toFixed(2),'Final lineup agrees with the saved historical score');
  yearChecks.final=await checkLineupYears(lineups,played,2,'Final');
  assert(yearChecks.final.some(item=>item.year!=null&&yearChecks.pregame.find(before=>before.entryId===item.entryId)?.year===null),'The real fixture identifies an additional player only after the final whistle');
  await lineups.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${phase}-final-${width}.png`});
  assert.deepEqual(errors,[]);
  evidence.push({width,height,rosterMedian:median(rosterHeights),rosterFirst:rosterHeights[0],rosterHeights,matchupMedian:median(matchupHeights),matchupFirst:matchupHeights[0],matchupHeights,nameFontSize:nameSize.fontSize,rosterLayout,gamedayLayout,yearChecks,checks:['Observed PPG versus archive estimate','Singleton public year named for each player; ambiguous years hidden','Public year inference capped before final whistle','History and completed game log','Move dialog close and Escape','Week options open and close','Atomic legal swap','Reload persistence','Pregame zeroes','Quarter1 matches landed historical events','Final equals saved results','Points and metadata never overlap','44px controls and unblocked clicks','No horizontal overflow',...(width===667?['Emulated24px safe-area menu reachability']:[])],blocked,errors});
  writeEvidence(false);
  console.log(`PASS ${width}x${height}: roster ${median(rosterHeights).toFixed(1)}px, matchup ${median(matchupHeights).toFixed(1)}px; history, swap/reload, pregame and exact Q1 playback`);
  await context.close();currentPage=null;
 }
 writeEvidence(true);
 }catch(error){if(currentPage)await currentPage.screenshot({path:`${output}/${phase}-failure-${currentWidth}.png`}).catch(()=>{});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
